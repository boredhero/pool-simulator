"""Eight-ball strategy: pre-shot context + physics facts -> match state.

No renderer/network dependencies. Mirror of frontend/src/sim/rules.ts.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Protocol

from app.sim.config import match_config
from app.sim.physics import Ball, ShotEvents
from app.sim.table import BALL_R, HEAD_SPOT, TABLE_H, TABLE_W, rack_order, rack_positions


@dataclass
class ShotContext:
    current: int
    open: bool
    break_shot: bool
    group: str | None
    remaining: list[int]
    kitchen: bool
    called_ball: int | None
    called_pocket: int | None


@dataclass
class GameState:
    balls: list[Ball] = field(default_factory=list)
    return_order: list[int] = field(default_factory=list)
    current: int = 0
    groups: list[str | None] = field(default_factory=lambda: [None, None])
    open: bool = True
    ball_in_hand: bool = False
    placement: str = "none"
    kitchen_shot: bool = False
    break_shot: bool = True
    winner: int | None = None
    message: str = "Player 1 to break"
    rules: dict = field(default_factory=match_config)
    shot: ShotContext | None = None


def new_game(seed: int = 1, options=None) -> GameState:
    balls = [Ball(id=0, n=None, x=HEAD_SPOT[0], y=HEAD_SPOT[1])]
    for i, (n, (x, y)) in enumerate(zip(rack_order(seed), rack_positions())):
        balls.append(Ball(id=i + 1, n=n, x=x, y=y))
    return GameState(balls=balls, rules=match_config(options))


def group_of(n: int) -> str:
    return "eight" if n == 8 else "solid" if n < 8 else "stripe"


def remaining(gs: GameState) -> list[int]:
    group = gs.groups[gs.current]
    return [
        b.n
        for b in gs.balls
        if not b.potted
        and b.n is not None
        and b.n != 8
        and (gs.open or group is None or group_of(b.n) == group)
    ]


def legal_targets(gs: GameState) -> list[int]:
    targets = remaining(gs)
    return targets if targets or gs.open else [8]


def call_required(gs: GameState) -> bool:
    return not gs.break_shot and (
        gs.rules["calls"] == "all" or (gs.rules["calls"] == "eight" and 8 in legal_targets(gs))
    )


def begin_shot(gs: GameState, called_ball=None, called_pocket=None) -> ShotContext:
    gs.shot = ShotContext(
        gs.current,
        gs.open,
        gs.break_shot,
        gs.groups[gs.current],
        remaining(gs),
        gs.kitchen_shot,
        called_ball,
        called_pocket,
    )
    return gs.shot


def spot_ball(gs: GameState, n: int) -> None:
    ball = next((b for b in gs.balls if b.n == n), None)
    if ball is None:
        return
    candidates = [(TABLE_W * 0.75, TABLE_H / 2)]
    d = BALL_R * 2 + 0.001
    while d < TABLE_W:
        candidates.extend([(TABLE_W * 0.75 - d, TABLE_H / 2), (TABLE_W * 0.75 + d, TABLE_H / 2)])
        d += BALL_R * 2 + 0.001
    x = 0.1
    while x < TABLE_W - 0.1:
        y = 0.1
        while y < TABLE_H - 0.1:
            candidates.append((x, y))
            y += 0.07
        x += 0.07
    for x, y in candidates:
        if BALL_R < x < TABLE_W - BALL_R and all(
            b.id == ball.id or b.potted or math.hypot(b.x - x, b.y - y) >= 2 * BALL_R + 0.001
            for b in gs.balls
        ):
            gs.return_order = [value for value in gs.return_order if value != n]
            ball.__dict__.update(Ball(id=ball.id, n=n, x=x, y=y).__dict__)
            return
    raise ValueError("No free spot for object ball")


def grant_placement(gs: GameState, zone: str) -> None:
    gs.ball_in_hand, gs.placement, gs.kitchen_shot = True, zone, zone == "kitchen"
    targets = [b for b in gs.balls if not b.potted and b.n in legal_targets(gs)]
    if zone == "kitchen" and targets and all(b.x < TABLE_W / 4 for b in targets):
        spot_ball(gs, max(targets, key=lambda b: b.x).n)


def apply_shot(gs: GameState, ev: ShotEvents, before: ShotContext | None = None) -> GameState:
    if gs.winner is not None:
        return gs
    before = before or gs.shot or begin_shot(gs)
    gs.shot = None
    for n in ev.potted:
        if n not in gs.return_order:
            gs.return_order.append(n)
    me, other = before.current, 1 - before.current
    on_eight = not before.open and before.group is not None and not before.remaining
    eight_down, eight_off = 8 in ev.potted, 8 in ev.off_table
    scratch = ev.cue_potted or None in ev.off_table
    foul = None
    if ev.first_contact is None:
        foul = "No contact"
    elif (before.open and ev.first_contact == 8) or (
        not before.open
        and (ev.first_contact != 8 if on_eight else group_of(ev.first_contact) != before.group)
    ):
        foul = "Wrong first contact"
    if (
        not foul
        and before.kitchen
        and (ev.first_contact_x if ev.first_contact_x is not None else TABLE_W) < TABLE_W / 4
        and not ev.cue_left_kitchen
    ):
        foul = "The cue ball must leave the kitchen first"
    if not foul and not ev.potted and not ev.rail_after_contact:
        foul = "No rail after contact"
    if not foul and scratch:
        foul = "Scratch"
    if not foul and ev.off_table:
        foul = "Ball off the table"
    called = before.called_ball is not None and any(
        p["n"] == before.called_ball and p["pocket"] == before.called_pocket for p in ev.pockets
    )
    eight_called = gs.rules["calls"] == "none" or (before.called_ball == 8 and called)
    spot_break_eight = before.break_shot and eight_down and gs.rules["eightOnBreak"] == "spot"
    if spot_break_eight:
        spot_ball(gs, 8)
    if (
        eight_off
        or (on_eight and scratch and gs.rules["scratchOnEightLoss"])
        or (
            eight_down
            and not spot_break_eight
            and not (before.break_shot and not foul)
            and not (on_eight and not foul and eight_called)
        )
    ):
        gs.winner = other
        reason = foul or ("8-Ball in the wrong pocket" if on_eight else "early 8-Ball")
        gs.message = f"Player {other + 1} wins — {reason}"
        return gs
    if eight_down and before.break_shot and not foul:
        if gs.rules["eightOnBreak"] == "win":
            gs.winner, gs.message = me, f"Player {me + 1} wins — 8-Ball on the break"
            return gs
        spot_ball(gs, 8)
    elif eight_down and on_eight and not foul and eight_called:
        gs.winner, gs.message = me, f"Player {me + 1} wins!"
        return gs
    if before.break_shot and gs.rules["strictBreak"] and not ev.potted and len(ev.object_rails) < 4:
        gs.__dict__.update(new_game(1, gs.rules).__dict__)
        gs.current, gs.message = other, f"Illegal break — reracked for Player {other + 1}"
        return gs
    for n in ev.off_table:
        if n is not None and n != 8:
            spot_ball(gs, n)
    gs.break_shot, gs.kitchen_shot = False, False
    if foul:
        gs.current = other
        zone = (
            "kitchen"
            if scratch and (gs.rules["scratch"] == "kitchen" or before.break_shot)
            else "anywhere"
        )
        grant_placement(gs, zone)
        where = "behind the head string" if zone == "kitchen" else "anywhere"
        gs.message = f"Foul: {foul} · Player {other + 1}, place {where}"
        return gs
    valid_pot = before.break_shot or gs.rules["calls"] != "all" or called
    pots = [n for n in ev.potted if n != 8]
    if gs.open and (not before.break_shot or gs.rules["assignOnBreak"]) and valid_pot and pots:
        groups = set(map(group_of, pots))
        group = (
            group_of(before.called_ball)
            if gs.rules["calls"] == "all" and before.called_ball is not None
            else group_of(pots[0])
            if len(groups) == 1
            else None
        )
        if group in ("solid", "stripe"):
            gs.groups[me], gs.groups[other] = group, "stripe" if group == "solid" else "solid"
            gs.open = False
    continues = valid_pot and any(gs.open or group_of(n) == gs.groups[me] for n in pots)
    gs.current = me if continues else other
    gs.ball_in_hand, gs.placement = False, "none"
    action = "shoots again" if continues else "to shoot"
    gs.message = f"Player {gs.current + 1} {action}"
    if before.break_shot and gs.open:
        gs.message += (
            " · mixed break pots, table open"
            if gs.rules["assignOnBreak"] and pots
            else " · table open after the break"
        )
    elif before.open and not gs.open:
        group_name = "solids" if gs.groups[me] == "solid" else "stripes"
        gs.message += f" · Player {me + 1} has {group_name}"
    return gs


def can_place(gs: GameState, x: float, y: float) -> bool:
    if not gs.ball_in_hand or gs.winner is not None or not math.isfinite(x) or not math.isfinite(y):
        return False
    if not (
        BALL_R + 0.001 <= x <= TABLE_W - BALL_R - 0.001
        and BALL_R + 0.001 <= y <= TABLE_H - BALL_R - 0.001
    ):
        return False
    if gs.placement == "kitchen" and x >= TABLE_W / 4:
        return False
    return all(
        b.id == 0 or b.potted or math.hypot(b.x - x, b.y - y) >= 2 * BALL_R + 0.001
        for b in gs.balls
    )


def place_cue(gs: GameState, x: float, y: float) -> bool:
    if not can_place(gs, x, y):
        return False
    gs.balls[0].__dict__.update(Ball(id=0, n=None, x=x, y=y).__dict__)
    gs.kitchen_shot, gs.ball_in_hand, gs.placement = gs.placement == "kitchen", False, "none"
    return True


class Ruleset(Protocol):
    id: str
    version: int

    def create(self, seed: int, options: dict) -> GameState: ...
    def begin(self, state: GameState, called_ball=None, called_pocket=None) -> ShotContext: ...
    def resolve(self, state: GameState, facts: ShotEvents, before=None) -> GameState: ...
    def targets(self, state: GameState) -> list[int]: ...
    def can_place(self, state: GameState, x: float, y: float) -> bool: ...


class EightBall:
    id, version = "eight-ball", 1
    create = staticmethod(new_game)
    begin = staticmethod(begin_shot)
    resolve = staticmethod(apply_shot)
    targets = staticmethod(legal_targets)
    can_place = staticmethod(can_place)


eight_ball: Ruleset = EightBall()
