"""Authenticated, server-owned Jev games and private cost accounting."""

import asyncio
import json
import math
import os
import random
import secrets
import time
from dataclasses import asdict, dataclass
from typing import Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.privacy import require_terms
from app.models.db import Account, JevGame, JevUsage, Session
from app.net.rooms import Room
from app.services import jev_budget
from app.services.auth import current_account, mutation_guard
from app.services.matches import ensure_jev_match, record_shot_in_session
from app.sim import opening
from app.sim.config import match_config
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
    tipX: float = Field(default=0, ge=-0.550000000001, le=0.550000000001, allow_inf_nan=False)
    tipY: float = Field(default=0, ge=-0.550000000001, le=0.550000000001, allow_inf_nan=False)
    calledBall: int | None = Field(default=None, ge=1, le=15)
    calledPocket: int | None = Field(default=None, ge=0, le=5)
    x: float | None = Field(default=None, ge=0, le=2.54, allow_inf_nan=False)
    y: float | None = Field(default=None, ge=0, le=1.27, allow_inf_nan=False)


class Turn(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    revision: int = Field(ge=0, le=1000000)
    shot: HumanShot | None = None


class RuleSettings(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    preset: Literal["bar", "tournament", "custom"] = "bar"
    scratch: Literal["kitchen", "anywhere"] = "kitchen"
    calls: Literal["none", "eight", "all"] = "eight"
    eightOnBreak: Literal["win", "spot"] = "win"
    scratchOnEightLoss: bool = True
    assignOnBreak: bool = True
    strictBreak: bool = False
    normalMax: float = Field(default=3.5, ge=1, le=8.5, allow_inf_nan=False)
    breakMax: float = Field(default=9.5, ge=1, le=12, allow_inf_nan=False)


class StartGame(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    new_game: bool = False
    simulation: Literal["", "jev-cpu", "jev-jev"] = ""
    rules: RuleSettings | None = None


def require_account(request: Request) -> dict:
    account = current_account(request)
    if account is None:
        raise HTTPException(401, "Sign in to play against Jev AI.")
    require_terms(account)
    return account


def decode(raw):
    state = json.loads(raw)
    state["balls"] = [Ball(**ball) for ball in state["balls"]]
    if state["shot"]:
        state["shot"] = ShotContext(**state["shot"])
    return GameState(**state)


def public_game(game, premium=False, *, created=False):
    state = Room(code="", gs=decode(game.state)).state_msg()
    state["names"] = (
        ["Jev AI", "CPU"]
        if game.simulation == "jev-cpu"
        else ["Jev AI 1", "Jev AI 2"]
        if game.simulation == "jev-jev"
        else ["Player 1", "Jev AI"]
    )
    state["revision"] = game.revision
    return {
        "id": game.id,
        "created": created,
        "simulation": game.simulation,
        "state": state,
        "status": game.status,
        "expiresAt": None,
    }


def resumable_game(db, account, day):
    query = select(JevGame).where(JevGame.account_id == account["id"], JevGame.status == "active")
    return db.scalar(query.order_by(JevGame.started_at.desc(), JevGame.id.desc()).limit(1))


@router.get("")
def availability(request: Request, response: Response, account: dict = Depends(require_account)):
    response.headers["Cache-Control"] = "no-store"
    day = int(time.time()) // 86400
    with Session() as db:
        game = resumable_game(db, account, day)
        budget = jev_budget.balance(db, db.get(Account, account["id"]))
        total = db.get(JevUsage, account["id"])
        return {
            "available": bool(os.environ.get("JEV_API_KEY")),
            "model": MODEL,
            "game": public_game(game, account["premium"]) if game else None,
            "usage": {
                "unlimited": account["premium"],
                "budget": budget,
                "resetsAt": budget["resetsAt"],
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
    with Session.begin() as db:
        current = jev_budget.lock_account(db, account["id"])
        if current is None or current.disabled:
            raise HTTPException(401, "Account access is unavailable.")
        simulation = payload.simulation if payload else ""
        if simulation and not current.sim_enabled:
            raise HTTPException(403, "Sim mode is not enabled for this account.")
        premium = current.premium
        existing = resumable_game(db, account, day)
        if existing and existing.status == "active" and not fresh:
            if existing.simulation and not current.sim_enabled:
                raise HTTPException(403, "Sim mode is not enabled for this account.")
            return public_game(existing, premium)
        budget = jev_budget.balance(db, current, now)
        if not premium and budget["remainingNano"] <= 0:
            raise HTTPException(
                429,
                "Your monthly Jev allowance is used. Resume your existing game, "
                "play CPU, or ask the admin for a top-up.",
            )
        if existing and existing.status == "active":
            if existing.id in active_games:
                raise HTTPException(409, "Wait for your current shot to finish.")
            ledger = ensure_jev_match(db, existing)
            ledger.status, ledger.ended_at, ledger.ended_by = "abandoned", now, 0
            existing.status = "abandoned"
            existing.updated_at = now
        state = new_game(
            secrets.randbelow(2**30),
            payload.rules.model_dump() if payload and payload.rules else None,
        )
        state.current = opening.choose_breaker()
        state.message = f"Player {state.current + 1} breaks — coin toss"
        game = JevGame(
            id=secrets.token_hex(16),
            account_id=account["id"],
            day=None if premium else day,
            daily_slot=None,
            daily_cost=0,
            simulation=simulation,
            network_hash="",
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
                409, "Another game was just started. Retry to refresh your allowance."
            ) from None
        ensure_jev_match(db, game, historical=False)
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
        "rules": match_config(gs.rules),
        "call_required": call_required(gs),
        "on_eight": not gs.open and gs.groups[gs.current] is not None and legal_targets(gs) == [8],
        "kitchen_shot": gs.kitchen_shot,
        "kitchen_first_contact": "cue must leave kitchen before contacting a target inside it"
        if gs.kitchen_shot
        else "no kitchen restriction",
        "break_scratch_placement": "kitchen",
        "illegal_break_result": (
            "rerack for opponent if no pot and fewer than four object balls reach rails; "
            "tournament off-table breaks instead give opponent kitchen placement"
        )
        if gs.rules["strictBreak"]
        else "normal foul and turn rules",
        "off_table_policy": (
            "tournament: ordinary balls stay down; eight off on break is spotted with foul; "
            "eight off after break loses rack"
        )
        if gs.rules["preset"] == "tournament"
        else "house: object balls are spotted; eight off loses rack",
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
        "contact_style": plan.get("contactStyle", "planned contact"),
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
    development_goal = (
        "When choosing between legal plans with comparable pot and defensive outcomes, "
        "prefer measured progress: newly shootable targets and useful cluster openings "
        "over a soft tap that leaves the position blocked. A strong or glancing shot is "
        "useful only when its preview supports that progress; avoid gratuitous power, "
        "scratches, early eight-ball losses, and opening an easier table for the opponent. "
        "Keep controlled pace for an easy pot or a genuinely stronger safety. "
    )
    instructions = (
        "Choose the offered executable pool plan that best advances winning this rack. "
        "Respect the supplied canonical rules and current kitchen/eight-ball state; "
        "server preview consequences determine shot legality. "
        "Prefer winning, legal shots and useful "
        "continuations; consider defense when an attack leaves the opponent an easy reply. "
        "A settled preview is one deterministic outcome, not a success probability. "
        "No direct option found does not prove a snooker. Geometry-only plans are unverified. "
        + development_goal
        + "Do not calculate aim, speed or spin. Pocket 1 and 4 are side pockets."
    )
    questions = {}
    if len(families) > 1:
        questions["tactic"] = {
            "type": "choice",
            "instructions": "Which offered shot family best serves this turn? Compare its "
            "provided plans, including defense, continuation and immediate rack outcomes. "
            + development_goal,
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
    if game_id in active_games or len(active_games) >= 4:
        raise HTTPException(409, "Game is busy. Resume after this shot.")
    with Session() as db:
        current = db.get(Account, account["id"])
        if current is None or current.disabled:
            raise HTTPException(401, "Account access is unavailable.")
        record = db.get(JevGame, game_id)
        if record is None or record.account_id != account["id"]:
            raise HTTPException(404, "Game not found.")
        if record.status != "active":
            raise HTTPException(409, "This game has ended.")
        if payload.revision != record.revision:
            raise HTTPException(409, "Table changed. Resume your game.")
        simulation = record.simulation
        if simulation and not current.sim_enabled:
            raise HTTPException(403, "Sim mode is not enabled for this account.")
        gs = decode(record.state)
    by = gs.current
    human = not simulation and by == 0
    use_jev = not simulation or simulation == "jev-jev" or by == 0
    if human != (payload.shot is not None):
        raise HTTPException(409, "Not that player's turn.")
    active_games.add(game_id)
    source = "human"
    try:
        if human:
            s = payload.shot.model_dump()
            if math.hypot(s["tipX"], s["tipY"]) > 0.55 + 1e-12:
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
            if use_jev and len(options) > 1 and not gs.break_shot:
                source = "cpu-fallback"
                attempt = jev_budget.reserve(account["id"], game_id, payload.revision, by, MODEL)
                result = None
                try:
                    if attempt is None:
                        source = "budget-fallback"
                        raise HTTPException(429, "Monthly allowance and completion grace used.")
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
                finally:
                    if attempt is not None:
                        jev_budget.settle(attempt, result)
            if gs.ball_in_hand:
                position = s.get("placement")
                if not position or not place_cue(gs, position["x"], position["y"]):
                    raise HTTPException(409, "No legal cue placement. Resume your game.")
        cue = gs.balls[0]
        placement = {"x": cue.x, "y": cue.y}
        shot = {k: s[k] for k in ("aim", "power", "tipX", "tipY", "calledBall", "calledPocket")}
        vmax = gs.rules["breakMax" if gs.break_shot else "normalMax"]
        elevation = cue_elevation(
            cue.x, cue.y, shot["aim"], 0, gs.balls, shot["tipX"], shot["tipY"]
        )
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
            ensure_jev_match(db, game)
            game.state = json.dumps(asdict(gs))
            game.revision += 1
            game.updated_at = int(time.time())
            if gs.winner is not None:
                game.status = "completed"
            facts = {
                "potted": events.potted,
                "off_table": events.off_table,
                "cue_potted": events.cue_potted,
                "first_contact": events.first_contact,
            }
            foul = (
                gs.ball_in_hand
                or gs.message.startswith("Illegal break")
                or (gs.winner is not None and gs.winner != by)
            )
            record_shot_in_session(
                db,
                game.id,
                game.revision,
                by,
                {**shot, "vmax": vmax, "elevation": elevation},
                facts,
                gs.winner,
                foul,
            )
            result = public_game(game, account["premium"])
        return {
            **result,
            "by": by,
            "shot": {**shot, "vmax": vmax, "elevation": elevation},
            "placement": placement,
            "source": source,
            "family": s.get("family") if not human else None,
            "intent": ("Jev chose a " if source == "jev" else "CPU chose a ")
            + s.get("family", "direct")
            + " shot"
            if not human
            else None,
        }
    finally:
        active_games.discard(game_id)
