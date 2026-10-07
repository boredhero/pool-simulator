"""8-ball rules (WPA, casual: no called shots). Mirror of frontend/src/sim/rules.ts."""

from __future__ import annotations

from dataclasses import dataclass, field

from app.sim.physics import Ball, ShotEvents
from app.sim.table import TABLE_H, TABLE_W, rack_order, rack_positions


@dataclass
class GameState:
    balls: list[Ball] = field(default_factory=list)
    current: int = 0
    groups: list[str | None] = field(default_factory=lambda: [None, None])
    open: bool = True
    ball_in_hand: bool = False
    break_shot: bool = True
    winner: int | None = None
    message: str = "Player 1 to break"


def new_game(seed: int = 1) -> GameState:
    from app.sim.table import HEAD_SPOT

    balls = [Ball(id=0, n=None, x=HEAD_SPOT[0], y=HEAD_SPOT[1])]
    for i, (n, (x, y)) in enumerate(zip(rack_order(seed), rack_positions())):
        balls.append(Ball(id=i + 1, n=n, x=x, y=y))
    return GameState(balls=balls)


def group_of(n: int) -> str:
    if n == 8:
        return "eight"
    return "solid" if n < 8 else "stripe"


def _alive(gs: GameState, player: int) -> list[int]:
    g = gs.groups[player]
    out = []
    for b in gs.balls:
        if b.potted or b.n is None:
            continue
        if gs.open or g is None:
            if b.n != 8:
                out.append(b.n)
        elif group_of(b.n) == g:
            out.append(b.n)
    return out


def apply_shot(gs: GameState, ev: ShotEvents) -> GameState:
    if gs.winner is not None:
        return gs
    me, other = gs.current, 1 - gs.current
    my_group = gs.groups[me]
    first = ev.first_contact
    foul: str | None = None
    potted8 = 8 in ev.potted or 8 in ev.off_table
    remaining = _alive(gs, me)
    on_eight = not gs.open and my_group is not None and len(remaining) == 0

    if first is None:
        foul = "No contact"
    elif not gs.open and not on_eight and my_group is not None:
        if first == 8 or group_of(first) != my_group:
            foul = "Wrong first contact"
    elif not gs.open and on_eight:
        if first != 8:
            foul = "Must contact the 8-ball"
    elif gs.open and first == 8 and 8 not in ev.potted:
        foul = "Wrong first contact"
    if foul is None and not ev.potted and not ev.rail_after_contact:
        foul = "No rail after contact"
    if foul is None and ev.cue_potted:
        foul = "Scratch"
    if foul is None and ev.off_table:
        foul = "Ball off the table"

    if potted8:
        if gs.open and gs.break_shot and foul is None:
            _respot8(gs)
            gs.message = "8-ball on the break — respotted, table open"
        elif on_eight and foul is None:
            gs.winner = me
            gs.message = f"Player {me + 1} wins!"
            return gs
        else:
            gs.winner = other
            gs.message = (
                f"Player {me + 1} fouled on the 8 — Player {other + 1} wins"
                if foul
                else f"Early 8-ball — Player {other + 1} wins"
            )
            return gs

    if foul is not None:
        gs.current, gs.ball_in_hand, gs.break_shot = other, True, False
        gs.message = f"Foul ({foul}) — Player {other + 1} ball in hand"
        return gs

    if gs.open and ev.potted:
        fp = ev.potted[0]
        if fp != 8:
            g = group_of(fp)
            gs.groups[me] = g if g in ("solid", "stripe") else None
            gs.groups[other] = "stripe" if g == "solid" else "solid" if g == "stripe" else None
            gs.open = False
            gs.message = f"Player {me + 1} is {gs.groups[me]}s"

    continues = any(n != 8 and (gs.open or group_of(n) == gs.groups[me]) for n in ev.potted)
    if continues:
        gs.message = f"Player {me + 1} shoots again"
    else:
        gs.current = other
        gs.message = f"Player {other + 1} to shoot"
    gs.ball_in_hand, gs.break_shot = False, False
    return gs


def _respot8(gs: GameState) -> None:
    eight = next(b for b in gs.balls if b.n == 8)
    cands = [(TABLE_W * 3 / 4, TABLE_H / 2)]
    dx = 0.06
    while dx < 1.2:
        cands.append((TABLE_W * 3 / 4 - dx, TABLE_H / 2))
        cands.append((TABLE_W * 3 / 4 + dx, TABLE_H / 2))
        dx += 0.06
    for x, y in cands:
        if 0.05 < x < TABLE_W - 0.05 and all(
            b.potted or b.id == eight.id or ((b.x - x) ** 2 + (b.y - y) ** 2) ** 0.5 > 0.065
            for b in gs.balls
        ):
            eight.x, eight.y, eight.potted, eight.asleep = x, y, False, True
            return
    eight.x, eight.y, eight.potted, eight.asleep = TABLE_W * 3 / 4, TABLE_H / 2, False, True


def place_cue(gs: GameState, x: float, y: float) -> bool:
    if not (0.03 < x < TABLE_W - 0.03 and 0.03 < y < TABLE_H - 0.03):
        return False
    if any(
        b.id != 0 and not b.potted and ((b.x - x) ** 2 + (b.y - y) ** 2) ** 0.5 < 0.062
        for b in gs.balls
    ):
        return False
    cue = gs.balls[0]
    cue.x, cue.y = x, y
    cue.vx = cue.vy = cue.wx = cue.wy = cue.wz = 0.0
    cue.potted, cue.asleep = False, True
    return True
