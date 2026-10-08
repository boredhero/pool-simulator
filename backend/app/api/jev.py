"""Authenticated, server-owned daily Jev games and private cost accounting."""

import asyncio
import ipaddress
import json
import math
import os
import secrets
import time
from dataclasses import asdict

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.api.privacy import require_terms
from app.models.db import JevGame, JevUsage, Session
from app.net.rooms import Room
from app.services.auth import current_account, digest, mutation_guard, rate_limit
from app.sim.cpu import candidates, fallback
from app.sim.cue import cue_elevation
from app.sim.physics import Ball, simulate_shot, strike
from app.sim.rules import (
    GameState,
    ShotContext,
    apply_shot,
    begin_shot,
    call_required,
    legal_targets,
    new_game,
    place_cue,
)

router = APIRouter(prefix="/opponents/jev")
MODEL = "jev-1.13.0"
active_games: set[str] = set()


class Candidate(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    ball: int = Field(ge=1, le=15)
    pocket: int = Field(ge=0, le=5)
    cutDegrees: float = Field(ge=0, le=65, allow_inf_nan=False)
    cueDistance: float = Field(ge=0, le=5, allow_inf_nan=False)
    pocketDistance: float = Field(ge=0, le=5, allow_inf_nan=False)
    power: float = Field(ge=0, le=1, allow_inf_nan=False)


class Selection(BaseModel):
    candidates: list[Candidate]
    remaining: int


class HumanShot(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    aim: float = Field(ge=-100, le=100, allow_inf_nan=False)
    power: float = Field(gt=0, le=1, allow_inf_nan=False)
    tipX: float = Field(default=0, ge=-0.55, le=0.55, allow_inf_nan=False)
    tipY: float = Field(default=0, ge=-0.55, le=0.55, allow_inf_nan=False)
    calledBall: int | None = Field(default=None, ge=1, le=15)
    calledPocket: int | None = Field(default=None, ge=0, le=5)
    x: float | None = Field(default=None, ge=0, le=2.54, allow_inf_nan=False)
    y: float | None = Field(default=None, ge=0, le=1.27, allow_inf_nan=False)


class Turn(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    revision: int = Field(ge=0, le=1000000)
    shot: HumanShot | None = None


class StartGame(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    new_game: bool = False


def require_account(request: Request) -> dict:
    account = current_account(request)
    if account is None:
        raise HTTPException(401, "Sign in to play against Jev AI.")
    require_terms(account)
    return account


def network_key(request):
    ip = request.client.host if request.client else "unknown"
    try:
        address = ipaddress.ip_address(ip)
        if address.version == 6:
            ip = str(ipaddress.ip_network(f"{ip}/64", strict=False))
    except ValueError:
        pass
    return digest("jev-network:" + ip)


def decode(raw):
    state = json.loads(raw)
    state["balls"] = [Ball(**ball) for ball in state["balls"]]
    if state["shot"]:
        state["shot"] = ShotContext(**state["shot"])
    return GameState(**state)


def public_game(game, premium=False):
    state = Room(code="", gs=decode(game.state)).state_msg()
    state["names"] = ["Player 1", "Jev AI"]
    state["revision"] = game.revision
    return {
        "id": game.id,
        "state": state,
        "status": game.status,
        "expiresAt": None if premium or game.day is None else (game.day + 1) * 86400,
    }


def resumable_game(db, account, day):
    query = select(JevGame).where(JevGame.account_id == account["id"])
    if account["premium"]:
        query = query.where(JevGame.status == "active")
    else:
        query = query.where(JevGame.day == day)
    return db.scalar(query.order_by(JevGame.started_at.desc(), JevGame.id.desc()).limit(1))


@router.get("")
def availability(request: Request, response: Response, account: dict = Depends(require_account)):
    response.headers["Cache-Control"] = "no-store"
    day = int(time.time()) // 86400
    with Session() as db:
        game = resumable_game(db, account, day)
        network_used = db.scalar(
            select(JevGame.id).where(
                JevGame.network_hash == network_key(request), JevGame.day == day
            )
        )
        total = db.get(JevUsage, account["id"])
        return {
            "available": bool(os.environ.get("JEV_API_KEY")),
            "model": MODEL,
            "game": public_game(game, account["premium"]) if game else None,
            "usage": {
                "unlimited": account["premium"],
                "gamesRemaining": None
                if account["premium"]
                else int(game is None and network_used is None),
                "resetsAt": None if account["premium"] else (day + 1) * 86400,
                "attempts": total.attempts if total else 0,
                "completed": total.completed if total else 0,
            },
        }


@router.post("/games", dependencies=[Depends(mutation_guard)])
async def start_game(
    request: Request, account: dict = Depends(require_account), payload: StartGame | None = None
):
    if not os.environ.get("JEV_API_KEY"):
        raise HTTPException(503, "Jev AI is not configured.")
    now = int(time.time())
    day = now // 86400
    premium = account["premium"]
    fresh = payload is not None and payload.new_game
    if fresh and not premium:
        raise HTTPException(403, "Starting another Jev game requires Premium.")
    # A short request throttle is independent of the daily game allowance.
    rate_limit("jev-start", account["id"] if premium else network_key(request), 10, 60)
    with Session.begin() as db:
        existing = resumable_game(db, account, day)
        if existing:
            if fresh:
                if existing.id in active_games:
                    raise HTTPException(409, "Wait for your current shot to finish.")
                existing.status = "abandoned"
                existing.updated_at = now
            elif existing.status == "active":
                return public_game(existing, premium)
            else:
                raise HTTPException(
                    429, "Your daily Jev game is finished. Try CPU or return tomorrow (UTC)."
                )
        if not premium and db.scalar(
            select(JevGame.id).where(
                JevGame.network_hash == network_key(request), JevGame.day == day
            )
        ):
            raise HTTPException(
                429, "This network has used today's Jev game. Try CPU or return tomorrow (UTC)."
            )
        # Hard admission guard, independent of optional analytics or account creation.
        count = db.scalar(select(func.count()).select_from(JevGame).where(JevGame.day == day))
        if not premium and count >= 100:
            raise HTTPException(429, "Today's Jev capacity is full. CPU remains available.")
        game = JevGame(
            id=secrets.token_hex(16),
            account_id=account["id"],
            day=None if premium else day,
            network_hash=network_key(request),
            started_at=now,
            updated_at=now,
            state=json.dumps(asdict(new_game(secrets.randbelow(2**30)))),
            status="active",
            revision=0,
        )
        db.add(game)
        try:
            db.flush()
        except IntegrityError:
            raise HTTPException(
                409, "A daily game was already started. Refresh to resume."
            ) from None
        return public_game(game, premium)


async def evaluate(payload: Selection, key: str) -> tuple[int, int, int]:
    criteria = {str(i): candidate.model_dump() for i, candidate in enumerate(payload.candidates)}
    async with asyncio.timeout(8), httpx.AsyncClient(timeout=7) as client:
        response = await client.post(
            "https://api.typesafe.ai/v1/systemone",
            headers={"Authorization": f"Bearer {key}"},
            json={
                "model": MODEL,
                "state": {"legal_targets_remaining": payload.remaining},
                "questions": {
                    "shot": {
                        "type": "choice",
                        "instructions": (
                            "Choose the most dependable pot in this 8-Ball turn. "
                            "Each option is a geometrically clear shot at a legal target. "
                            "Distances are meters; a smaller cutDegrees is straighter. "
                            "Balance cut difficulty, cue travel, object travel to pocket "
                            "and power. Prefer reliable shots over thin cuts and long pots. "
                            "Pocket 1 and 4 are side pockets; others are corners. "
                            "Ball 8 is only offered when legal to win. These are geometry "
                            "estimates, not simulated outcomes or success probabilities."
                        ),
                        "criteria": criteria,
                    }
                },
            },
        )
        response.raise_for_status()
        answer = response.json()["answers"]["shot"]
        choice = answer["choice"]
        if answer["type"] != "choice" or choice not in criteria:
            raise ValueError("Invalid selection")
        usage = response.json().get("usage", {})
        tokens = [usage.get("input_tokens"), usage.get("output_tokens")]
        if any(type(n) is not int or n < 0 or n > 1000000 for n in tokens):
            raise ValueError("Missing provider usage")
        return int(choice), tokens[0], tokens[1]


@router.post("/games/{game_id}/turn", dependencies=[Depends(mutation_guard)])
async def play_turn(
    game_id: str, payload: Turn, request: Request, account: dict = Depends(require_account)
):
    rate_limit("jev-turn", account["id"], 30, 60)
    if game_id in active_games or len(active_games) >= 4:
        raise HTTPException(409, "Game is busy. Resume after this shot.")
    with Session() as db:
        record = db.get(JevGame, game_id)
        if record is None or record.account_id != account["id"]:
            raise HTTPException(404, "Game not found.")
        if record.status != "active" or (
            not account["premium"] and record.day != int(time.time()) // 86400
        ):
            raise HTTPException(409, "This daily game has ended.")
        if payload.revision != record.revision:
            raise HTTPException(409, "Table changed. Resume your game.")
        gs = decode(record.state)
    by = gs.current
    if (by == 0) != (payload.shot is not None):
        raise HTTPException(409, "Not that player's turn.")
    active_games.add(game_id)
    source = "human"
    try:
        if by == 0:
            s = payload.shot.model_dump()
            if math.hypot(s["tipX"], s["tipY"]) > 0.55:
                raise HTTPException(422, "Spin is out of range.")
            if gs.ball_in_hand and (
                s["x"] is None or s["y"] is None or not place_cue(gs, s["x"], s["y"])
            ):
                raise HTTPException(422, "Place the cue ball legally first.")
            if call_required(gs) and (
                s["calledBall"] not in legal_targets(gs) or s["calledPocket"] is None
            ):
                raise HTTPException(422, "Call a legal ball and pocket.")
        else:
            if gs.ball_in_hand:
                placed = False
                for x in range(15, 254, 10):
                    for y in range(15, 127, 10):
                        if place_cue(gs, x / 100, y / 100):
                            placed = True
                            break
                    if placed:
                        break
                if not placed:
                    raise HTTPException(409, "No legal cue placement.")
            options = [] if gs.break_shot else candidates(gs)
            s = options[0] if options else fallback(gs)
            source = "geometry"
            if len(options) > 1:
                source = "cpu-fallback"
                try:
                    # Emergency global paid-call cap. It never ends a player's rack;
                    # exhausted/provider-down games continue with a visible CPU fallback.
                    rate_limit("jev-global", "all", 1000, 86400)
                    with Session.begin() as db:
                        total = db.get(JevUsage, account["id"])
                        if total is None:
                            total = JevUsage(account_id=account["id"], attempts=0, completed=0)
                            db.add(total)
                        total.attempts += 1
                        game = db.get(JevGame, game_id)
                        game.requests += 1
                        game.unmetered_requests += 1
                    selection = Selection(
                        remaining=len(legal_targets(gs)),
                        candidates=[
                            Candidate(
                                ball=o["calledBall"],
                                pocket=o["calledPocket"],
                                cutDegrees=o["cutDegrees"],
                                cueDistance=o["cueDistance"],
                                pocketDistance=o["pocketDistance"],
                                power=o["power"],
                            )
                            for o in options
                        ],
                    )
                    index, inputs, outputs = await evaluate(selection, os.environ["JEV_API_KEY"])
                    s = options[index]
                    source = "jev"
                    with Session.begin() as db:
                        game = db.get(JevGame, game_id)
                        game.input_tokens += inputs
                        game.output_tokens += outputs
                        game.estimated_cost_nano += inputs * game.token_price_nano
                        game.unmetered_requests -= 1
                        db.get(JevUsage, account["id"]).completed += 1
                except (
                    httpx.HTTPError,
                    TimeoutError,
                    ValueError,
                    KeyError,
                    TypeError,
                    HTTPException,
                ):
                    pass  # Never expose provider error bodies or credentials.
        cue = gs.balls[0]
        placement = {"x": cue.x, "y": cue.y}
        shot = {k: s[k] for k in ("aim", "power", "tipX", "tipY", "calledBall", "calledPocket")}
        vmax = gs.rules["breakMax" if gs.break_shot else "normalMax"]
        elevation = cue_elevation(cue.x, cue.y, shot["aim"], 0, gs.balls)
        begin_shot(gs, shot["calledBall"], shot["calledPocket"])
        strike(
            cue,
            math.cos(shot["aim"]),
            math.sin(shot["aim"]),
            shot["power"],
            shot["tipX"],
            shot["tipY"],
            vmax,
            elevation,
        )
        events = await asyncio.to_thread(simulate_shot, gs.balls, 0)
        apply_shot(gs, events)
        with Session.begin() as db:
            game = db.get(JevGame, game_id)
            game.state = json.dumps(asdict(gs))
            game.revision += 1
            game.updated_at = int(time.time())
            if gs.winner is not None:
                game.status = "completed"
            result = public_game(game, account["premium"])
        return {
            **result,
            "by": by,
            "shot": {**shot, "vmax": vmax, "elevation": elevation},
            "placement": placement,
            "source": source,
        }
    finally:
        active_games.discard(game_id)
