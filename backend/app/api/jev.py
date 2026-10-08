"""Authenticated, server-owned daily Jev games and private cost accounting."""

import asyncio
import ipaddress
import json
import math
import os
import random
import secrets
import time
from dataclasses import asdict, dataclass

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.api.privacy import require_terms
from app.models.db import JevGame, JevUsage, Session
from app.net.rooms import Room
from app.services.auth import current_account, digest, mutation_guard, rate_limit
from app.sim import opening
from app.sim.cue import cue_elevation
from app.sim.physics import Ball, simulate_shot, strike
from app.sim.planner import plan_shots
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


@dataclass
class Selection:
    candidates: list[dict]
    state: dict


@dataclass
class Evaluation:
    candidate_id: str | None
    input_tokens: int | None
    output_tokens: int | None


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


def public_game(game, premium=False, *, created=False):
    state = Room(code="", gs=decode(game.state)).state_msg()
    state["names"] = ["Player 1", "Jev AI"]
    state["revision"] = game.revision
    return {
        "id": game.id,
        "created": created,
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
        state = new_game(secrets.randbelow(2**30))
        state.current = opening.choose_breaker()
        state.message = f"Player {state.current + 1} breaks — coin toss"
        game = JevGame(
            id=secrets.token_hex(16),
            account_id=account["id"],
            day=None if premium else day,
            network_hash=network_key(request),
            started_at=now,
            updated_at=now,
            state=json.dumps(asdict(state)),
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
        return public_game(game, premium, created=True)


def decision_context(gs: GameState) -> dict:
    """Only server-owned game facts; never account identity or client descriptions."""
    return {
        "phase": "break" if gs.break_shot else "open table" if gs.open else "assigned groups",
        "group": gs.groups[gs.current],
        "legal_targets": legal_targets(gs),
        "ball_in_hand": gs.ball_in_hand,
        "placement_zone": gs.placement,
        "called_shot_rule": gs.rules["calls"],
        "opponent_remaining": sum(
            1
            for b in gs.balls
            if not b.potted
            and b.n is not None
            and b.n != 8
            and (gs.open or ("solid" if b.n < 8 else "stripe") == gs.groups[1 - gs.current])
        ),
    }


def describe_plan(plan: dict) -> dict:
    """Expose consequences, not an invitation for the model to invent shot physics."""
    ev = plan.get("evidence", {})
    return {
        "family": plan["family"],
        "target_ball": plan["calledBall"],
        "called_pocket": plan["calledPocket"],
        "placement": "planned legal placement" if plan.get("placement") else "current cue position",
        "evidence": "settled physics preview"
        if ev.get("verified")
        else "geometry only; unverified",
        "legality": "legal in preview" if ev.get("legal") else "not verified legal",
        "result": "wins rack"
        if ev.get("won")
        else "loses rack"
        if ev.get("lost")
        else "retains turn"
        if ev.get("continues")
        else "turn passes or outcome unverified",
        "scratch": "cue scratched"
        if ev.get("scratch")
        else "no scratch in preview"
        if ev.get("verified")
        else "unknown",
        "potted": ev.get("potted", []),
        "next_position": "multiple direct options"
        if ev.get("nextShots", 0) > 1
        else "one direct option"
        if ev.get("nextShots", 0) == 1
        else "no direct option found",
        "opponent_reply": "multiple direct options"
        if ev.get("opponentShots", 0) > 1
        else "one direct option"
        if ev.get("opponentShots", 0) == 1
        else "no direct option found",
        "cue_region": ev.get("cueRegion", "unknown"),
        "pace": plan.get("pace", "controlled"),
        "development_result": "congestion opened with new direct shot options"
        if ev.get("clusterLinksOpened", 0) and ev.get("newTargetsAvailable", 0)
        else "nearby balls separated, without new direct shot options"
        if ev.get("clusterLinksOpened", 0)
        else "no measured cluster opening"
        if ev.get("verified")
        else "unknown",
        "cluster_development": {
            "separated_nearby_pairs": ev.get("clusterLinksOpened", 0),
            "new_clear_object_ball_routes": ev.get("newObjectRoutes", 0),
            "new_shootable_targets": ev.get("newTargetsAvailable", 0),
        }
        if ev.get("verified")
        else "unknown",
        "opponent_development": {
            "separated_nearby_pairs": ev.get("opponentClusterLinksOpened", 0),
            "new_clear_object_ball_routes": ev.get("opponentNewObjectRoutes", 0),
        }
        if ev.get("verified")
        else "unknown",
    }


async def evaluate(payload: Selection, key: str) -> Evaluation:
    ordered = list(payload.candidates)
    random.Random(json.dumps(payload.state, sort_keys=True)).shuffle(ordered)
    criteria = {plan["id"]: describe_plan(plan) for plan in ordered}
    families = list(dict.fromkeys(plan["family"] for plan in ordered))
    instructions = (
        "Choose the offered executable pool plan that best advances winning this rack. "
        "Use the supplied preview consequences. Prefer winning, legal shots and useful "
        "continuations; consider defense when an attack leaves the opponent an easy reply. "
        "A settled preview is one deterministic outcome, not a success probability. "
        "No direct option found does not prove a snooker. Geometry-only plans are unverified. "
        "Do not calculate aim, speed or spin. Pocket 1 and 4 are side pockets."
    )
    questions = {}
    if len(families) > 1:
        questions["tactic"] = {
            "type": "choice",
            "instructions": "Which offered shot family best serves this turn? Compare its "
            "provided plans, including defense, continuation and immediate rack outcomes.",
            "criteria": {
                family: {pid: plan for pid, plan in criteria.items() if plan["family"] == family}
                for family in families
            },
        }
    for family in families:
        questions["shot_" + family] = {
            "type": "choice",
            "instructions": "If using the " + family + " family: " + instructions,
            "criteria": {pid: plan for pid, plan in criteria.items() if plan["family"] == family},
        }
    async with asyncio.timeout(8), httpx.AsyncClient(timeout=7) as client:
        response = await client.post(
            "https://api.typesafe.ai/v1/systemone",
            headers={"Authorization": f"Bearer {key}"},
            json={"model": MODEL, "state": payload.state, "questions": questions},
        )
        response.raise_for_status()
        body = response.json()
        if not isinstance(body, dict):
            return Evaluation(None, None, None)
        usage = body.get("usage", {})
        tokens = (
            [usage.get("input_tokens"), usage.get("output_tokens")]
            if isinstance(usage, dict)
            else []
        )
        metered = len(tokens) == 2 and all(type(n) is int and 0 <= n <= 1000000 for n in tokens)
        # Meter independently of choice validation: invalid answers may still be billed.
        result = Evaluation(None, tokens[0] if metered else None, tokens[1] if metered else None)
        answers = body.get("answers", {})
        if not isinstance(answers, dict):
            return result
        family = families[0]
        if len(families) > 1:
            tactic = answers.get("tactic", {})
            if not isinstance(tactic, dict) or tactic.get("type") != "choice":
                return result
            family = tactic.get("choice")
            if not isinstance(family, str) or family not in families:
                return result
        answer = answers.get("shot_" + family, {})
        if isinstance(answer, dict) and answer.get("type") == "choice":
            choice = answer.get("choice")
            if (
                isinstance(choice, str)
                and choice in criteria
                and criteria[choice]["family"] == family
            ):
                result.candidate_id = choice
        return result


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
            # Planner previews copied state and jointly chooses legal placement plus shot.
            # CPU work runs off the event loop under the existing admission cap.
            options = await asyncio.to_thread(plan_shots, gs)
            if not options:
                raise HTTPException(409, "No legal shot plan. Resume your game.")
            s = options[0]
            source = "planner"
            if len(options) > 1 and not gs.break_shot:
                source = "cpu-fallback"
                try:
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
                    result = await evaluate(
                        Selection(candidates=options, state=decision_context(gs)),
                        os.environ["JEV_API_KEY"],
                    )
                    chosen = next((o for o in options if o["id"] == result.candidate_id), None)
                    with Session.begin() as db:
                        game = db.get(JevGame, game_id)
                        if result.input_tokens is not None and result.output_tokens is not None:
                            game.input_tokens += result.input_tokens
                            game.output_tokens += result.output_tokens
                            game.estimated_cost_nano += result.input_tokens * game.token_price_nano
                            game.unmetered_requests -= 1
                        if chosen is not None:
                            db.get(JevUsage, account["id"]).completed += 1
                    if chosen is not None:
                        s, source = chosen, "jev"
                except (
                    httpx.HTTPError,
                    TimeoutError,
                    ValueError,
                    KeyError,
                    TypeError,
                    HTTPException,
                ):
                    pass  # Preserve a playable deterministic fallback and private errors.
            if gs.ball_in_hand:
                position = s.get("placement")
                if not position or not place_cue(gs, position["x"], position["y"]):
                    raise HTTPException(409, "No legal cue placement. Resume your game.")
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
            "family": s.get("family") if by == 1 else None,
            "intent": ("Jev chose a " if source == "jev" else "CPU chose a ")
            + s.get("family", "direct")
            + " shot"
            if by == 1
            else None,
        }
    finally:
        active_games.discard(game_id)
