"""Bounded, authoritative-physics shot previews for Jev.

Geometry proposes shots; completed physics and the actual rules establish their
outcomes. No preview mutates its input. Wall-clock exhaustion returns the best
completed choice, or an explicitly unverified geometric fallback. Confidence is
deterministic simulation evidence, never an invented probability of success.
"""

from __future__ import annotations

import copy
import math
import time

from app.sim.cpu import candidates, clear, fallback
from app.sim.cue import cue_elevation
from app.sim.physics import DT, VMIN, ShotEvents, all_asleep, shoot_speed, step, strike
from app.sim.rules import (
    GameState,
    apply_shot,
    begin_shot,
    can_place,
    legal_targets,
    place_cue,
)
from app.sim.table import BALL_R, POCKETS, TABLE_H, TABLE_W, cushions


def _inside(x, y):
    return BALL_R <= x <= TABLE_W - BALL_R and BALL_R <= y <= TABLE_H - BALL_R


def _ghost(ball, destination):
    dx, dy = destination[0] - ball.x, destination[1] - ball.y
    length = math.hypot(dx, dy)
    if length < 1e-9:
        return None
    return ball.x - 2 * BALL_R * dx / length, ball.y - 2 * BALL_R * dy / length


def _reflection_path(start, end, rail):
    """Ideal mirror seed, using the ball-center collision plane and real gaps."""
    horizontal = rail.y1 == rail.y2
    axis = 1 if horizontal else 0
    edge = rail.y1 if horizontal else rail.x1
    extent = TABLE_H if horizontal else TABLE_W
    plane = BALL_R if edge == 0 else extent - BALL_R
    reflected = list(end)
    reflected[axis] = 2 * plane - end[axis]
    delta = reflected[axis] - start[axis]
    if abs(delta) < 1e-9:
        return None
    t = (plane - start[axis]) / delta
    if not 0 < t < 1:
        return None
    point = tuple(start[i] + t * (reflected[i] - start[i]) for i in (0, 1))
    lo, hi = (rail.x1, rail.x2) if horizontal else (rail.y1, rail.y2)
    # Stay away from the mouth/jaw ends, which do not behave as plane cushions.
    if not min(lo, hi) + BALL_R < point[1 - axis] < max(lo, hi) - BALL_R:
        return None
    return point


def _shot(cue, point, target, pocket, family, power=0.4, score=0.0):
    return {
        "aim": math.atan2(point[1] - cue.y, point[0] - cue.x),
        "power": power,
        "tipX": 0.0,
        "tipY": 0.0,
        "calledBall": target.n,
        "calledPocket": pocket,
        "firstContact": target.n,
        "family": family,
        "score": score,
    }


def _power_for_speed(speed, vmax):
    return min(1.0, max(0.0, (speed - VMIN) / (vmax - VMIN))) ** (1 / 1.55)


def _firm_variant(shot, gs):
    """Sample an extra 0.65 m/s, not an arbitrary percentage of nonlinear power."""
    vmax = gs.rules["breakMax" if gs.break_shot else "normalMax"]
    power = _power_for_speed(shoot_speed(shot["power"], vmax) + 0.65, vmax)
    return {**shot, "power": power, "pace": "firm"}


def _features(gs, numbers):
    """Local congestion and distinct object-ball pocket routes, independent of cue leave."""
    live = [b for b in gs.balls if b.n is not None and not b.potted]
    pairs = {
        (min(a.id, b.id), max(a.id, b.id))
        for i, a in enumerate(live)
        for b in live[i + 1 :]
        if (a.n in numbers or b.n in numbers)
        and math.hypot(a.x - b.x, a.y - b.y) < 2 * BALL_R + 0.055
    }
    open_balls = {
        b.n
        for b in live
        if b.n in numbers and any(clear(b.x, b.y, *p[:2], gs.balls, [0, b.id]) for p in POCKETS)
    }
    return pairs, open_balls


def _development_seeds(gs):
    if gs.break_shot:
        return []
    cue = gs.balls[0]
    options = []
    for ball in gs.balls:
        if (
            ball.potted
            or ball.n not in legal_targets(gs)
            or ball.n == 8
            or gs.kitchen_shot
            and ball.x < TABLE_W / 4
        ):
            continue
        neighbors = sum(
            not other.potted
            and other.id not in (0, ball.id)
            and math.hypot(ball.x - other.x, ball.y - other.y) < 2 * BALL_R + 0.055
            for other in gs.balls
        )
        distance = math.hypot(ball.x - cue.x, ball.y - cue.y)
        if not neighbors or distance <= 2 * BALL_R:
            continue
        # Cue stops at first contact, not at the object's center. Checking all the
        # way to its center falsely rejects reachable faces of tightly packed balls.
        gx = ball.x - 2 * BALL_R * (ball.x - cue.x) / distance
        gy = ball.y - 2 * BALL_R * (ball.y - cue.y) / distance
        if not _inside(gx, gy) or not clear(cue.x, cue.y, gx, gy, gs.balls, [0, ball.id]):
            continue
        pocket = min(range(6), key=lambda i: math.dist((ball.x, ball.y), POCKETS[i][:2]))
        # Keep both centered energy samples, then offer glancing contacts that
        # let the cue continue through/along the cluster instead of always
        # stopping head-on. Every option still needs the settled legal preview.
        ux, uy = (ball.x - cue.x) / distance, (ball.y - cue.y) / distance
        for side, speed in ((0, 2.05), (0, 2.85), (-0.55, 2.85), (0.55, 2.85)):
            contact = math.sqrt(1 - side * side)
            point = (
                ball.x - 2 * BALL_R * (ux * contact + uy * side),
                ball.y - 2 * BALL_R * (uy * contact - ux * side),
            )
            if not _inside(*point) or not clear(cue.x, cue.y, *point, gs.balls, [0, ball.id]):
                continue
            launch = math.sqrt(speed * speed + 2 * 0.01 * 9.81 * max(0, distance - 0.75))
            shot = _shot(
                cue,
                point,
                ball,
                pocket,
                "development",
                _power_for_speed(launch, gs.rules["normalMax"]),
                neighbors - distance,
            )
            shot["pace"] = "controlled firm" if speed == 2.05 else "strong"
            shot["contactStyle"] = "glancing" if side else "head-on"
            options.append(shot)
    return sorted(options, key=lambda s: -s["score"])[:6]


def _geometry(gs):
    cue = gs.balls[0]
    targets = [b for b in gs.balls if not b.potted and b.n in legal_targets(gs)]
    direct = [{**s, "family": "direct", "firstContact": s["calledBall"]} for s in candidates(gs)]
    special = {"bank": [], "kick": [], "combination": [], "safety": []}
    for ball in targets:
        start = (cue.x, cue.y)
        ball_xy = (ball.x, ball.y)
        kitchen_direct = gs.kitchen_shot and ball.x < TABLE_W / 4
        nearest = min(range(6), key=lambda i: math.dist(ball_xy, POCKETS[i][:2]))
        if not kitchen_direct and clear(*start, *ball_xy, gs.balls, [0, ball.id]):
            special["safety"].append(
                _shot(cue, ball_xy, ball, nearest, "safety", 0.42, -math.dist(start, ball_xy))
            )
        for pocket, p in enumerate(POCKETS):
            ghost = _ghost(ball, p)
            if ghost is None or not _inside(*ghost):
                continue
            object_clear = clear(*ball_xy, *p[:2], gs.balls, [0, ball.id])
            for rail in cushions():
                # Bank: the object ball banks, with legal first contact on ball.
                bounce = _reflection_path(ball_xy, p[:2], rail)
                if bounce and not kitchen_direct:
                    bank_ghost = _ghost(ball, bounce)
                    if (
                        bank_ghost
                        and _inside(*bank_ghost)
                        and clear(*start, *bank_ghost, gs.balls, [0, ball.id])
                        and clear(*ball_xy, *bounce, gs.balls, [0, ball.id])
                        and clear(*bounce, *p[:2], gs.balls, [0, ball.id])
                        and (bank_ghost[0] - cue.x) * (bounce[0] - ball.x)
                        + (bank_ghost[1] - cue.y) * (bounce[1] - ball.y)
                        > 0
                    ):
                        length = math.dist(start, bank_ghost) + math.dist(ball_xy, bounce)
                        special["bank"].append(
                            _shot(cue, bank_ghost, ball, pocket, "bank", 0.55, -length)
                        )
                # Kick: cue banks before first contact. Kitchen targets are valid
                # if the path leaves the kitchen before coming back to contact.
                bounce = _reflection_path(start, ghost, rail)
                if (
                    bounce
                    and object_clear
                    and (not kitchen_direct or bounce[0] >= TABLE_W / 4)
                    and clear(*start, *bounce, gs.balls, [0])
                    and clear(*bounce, *ghost, gs.balls, [0, ball.id])
                    and (ghost[0] - bounce[0]) * (p[0] - ball.x)
                    + (ghost[1] - bounce[1]) * (p[1] - ball.y)
                    > 0
                ):
                    length = math.dist(start, bounce) + math.dist(bounce, ghost)
                    power = min(1.0, 0.45 + length * 0.15)
                    special["kick"].append(_shot(cue, bounce, ball, pocket, "kick", power, -length))
            # Legal A -> own B -> pocket. The call is B, never the first contact A.
            if object_clear:
                for first in targets:
                    if first.id == ball.id or (gs.kitchen_shot and first.x < TABLE_W / 4):
                        continue
                    first_ghost = _ghost(first, ghost)
                    if (
                        first_ghost
                        and _inside(*first_ghost)
                        and clear(*start, *first_ghost, gs.balls, [0, first.id])
                        and clear(first.x, first.y, *ghost, gs.balls, [0, first.id, ball.id])
                        and (ghost[0] - first.x) * (p[0] - ball.x)
                        + (ghost[1] - first.y) * (p[1] - ball.y)
                        > 0
                        and (first_ghost[0] - cue.x) * (ghost[0] - first.x)
                        + (first_ghost[1] - cue.y) * (ghost[1] - first.y)
                        > 0
                    ):
                        shot = _shot(cue, first_ghost, ball, pocket, "combination", 0.5)
                        shot["firstContact"] = first.n
                        shot["score"] = -math.dist(start, first_ghost)
                        special["combination"].append(shot)
        # Contact-only kicks remain useful when no ball-to-pocket path exists.
        for rail in cushions():
            bounce = _reflection_path(start, ball_xy, rail)
            if (
                bounce
                and (not kitchen_direct or bounce[0] >= TABLE_W / 4)
                and clear(*start, *bounce, gs.balls, [0])
                and clear(*bounce, *ball_xy, gs.balls, [0, ball.id])
            ):
                length = math.dist(start, bounce) + math.dist(bounce, ball_xy)
                power = min(1.0, 0.45 + length * 0.15)
                special["kick"].append(_shot(cue, bounce, ball, nearest, "kick", power, -10))
    for family in special.values():
        family.sort(key=lambda s: -s["score"])
    # Keep distinct tactics, rather than spending the budget on near-identical pots.
    seeds = direct[:3]
    for family in ("safety", "bank", "kick", "combination"):
        seeds.extend(special[family][:1])
    seeds.extend(direct[3:6])
    for family in ("kick", "safety", "bank", "combination"):
        seeds.extend(special[family][1:3])
    development = _development_seeds(gs)
    return seeds[:1] + development[:2] + seeds[1:3] + development[2:4] + seeds[3:] + development[4:]


def _placements(gs):
    """Promising pot lines first, then deterministic legal grid escape points."""
    points = []
    for ball in gs.balls:
        if ball.potted or ball.n not in legal_targets(gs):
            continue
        for pocket in POCKETS:
            ghost = _ghost(ball, pocket)
            if ghost is None:
                continue
            dx, dy = ghost[0] - ball.x, ghost[1] - ball.y
            for distance in (0.24, 0.45):
                points.append(
                    (
                        ghost[0] + dx * distance / (2 * BALL_R),
                        ghost[1] + dy * distance / (2 * BALL_R),
                    )
                )
    points.extend((x / 100, y / 100) for x in range(10, 250, 20) for y in range(10, 125, 20))
    return [(x, y) for x, y in points if can_place(gs, x, y)]


def _seeds(gs):
    if not gs.ball_in_hand:
        return _geometry(gs)
    result = []
    # Evaluate placements geometrically before spending any simulation budget.
    for x, y in _placements(gs)[:48]:
        state = copy.deepcopy(gs)
        place_cue(state, x, y)
        choices = candidates(state)
        if choices:
            result.append(
                {
                    **choices[0],
                    "family": "direct",
                    "placement": {"x": x, "y": y},
                    "firstContact": choices[0]["calledBall"],
                }
            )
    result.sort(key=lambda s: -s["score"])
    # Cover different target/pocket pairs instead of 12 almost-identical placements.
    diverse, seen = [], set()
    for shot in result:
        key = shot["calledBall"], shot["calledPocket"]
        if key not in seen:
            seen.add(key)
            diverse.append(shot)
    if diverse:
        return diverse[:8]
    points = _placements(gs)
    if not points:
        return []
    x, y = points[0]
    state = copy.deepcopy(gs)
    place_cue(state, x, y)
    return [{**s, "placement": {"x": x, "y": y}} for s in _geometry(state)]


def _preview(gs, shot, deadline):
    state = copy.deepcopy(gs)
    if state.ball_in_hand:
        placement = shot.get("placement")
        if not placement or not place_cue(state, placement["x"], placement["y"]):
            return None
    cue, me = state.balls[0], state.current
    begin_shot(state, shot["calledBall"], shot["calledPocket"])
    strike(
        cue,
        math.cos(shot["aim"]),
        math.sin(shot["aim"]),
        shot["power"],
        shot["tipX"],
        shot["tipY"],
        state.rules["breakMax" if state.break_shot else "normalMax"],
        cue_elevation(cue.x, cue.y, shot["aim"], 0, state.balls, shot["tipX"], shot["tipY"]),
    )
    events, contact, elapsed, ticks = ShotEvents(), {"v": False}, 0.0, 0
    while elapsed < 45 and not all_asleep(state.balls):
        if ticks % 24 == 0 and deadline is not None and time.monotonic() >= deadline:
            return None
        step(state.balls, DT, events, 0, contact)
        elapsed += DT
        ticks += 1
    if not all_asleep(state.balls):
        return None
    apply_shot(state, events)
    lost, won = state.winner == 1 - me, state.winner == me
    legal = not lost and not state.ball_in_hand and not state.message.startswith("Illegal break")
    continues = legal and state.current == me
    # Cheap positional evaluation, always from the original shooter's perspective.
    state.current = me
    own = candidates(state) if state.winner is None else []
    comparison = copy.copy(gs)
    comparison.current, comparison.groups, comparison.open = me, state.groups, state.open
    own_numbers = legal_targets(comparison)
    before_pairs, before_routes = _features(comparison, own_numbers)
    after_pairs, after_routes = _features(state, own_numbers)
    before_targets = {s["calledBall"] for s in candidates(comparison)}
    next_targets = {s["calledBall"] for s in own}
    # Pots already receive a separate reward: only surviving pairs count as opened.
    live_ids = {b.id for b in state.balls if not b.potted}
    opened = sum(a in live_ids and b in live_ids for a, b in before_pairs - after_pairs)
    new_routes = len(after_routes - before_routes)
    new_targets = len(next_targets - before_targets)
    state.current = 1 - me
    opponent = candidates(state) if state.winner is None else []
    comparison.current = 1 - me
    opponent_numbers = legal_targets(comparison)
    opponent_before, opponent_routes_before = _features(comparison, opponent_numbers)
    opponent_after, opponent_routes_after = _features(state, opponent_numbers)
    opponent_opened = sum(
        a in live_ids and b in live_ids for a, b in opponent_before - opponent_after
    )
    opponent_routes = len(opponent_routes_after - opponent_routes_before)
    mobility = sum(max(0, s["score"]) * w for s, w in zip(own, (1, 0.3, 0.1)))
    danger = sum(max(0, s["score"]) * w for s, w in zip(opponent, (1, 0.3, 0.1)))
    called = any(
        p["n"] == shot["calledBall"] and p["pocket"] == shot["calledPocket"] for p in events.pockets
    )
    score = 10000 if won else -10000 if lost else 0
    score += (30 if legal else -500) + (50 if continues else 0) + (15 if called else 0)
    score += 6 * mobility if continues else -5 * danger
    score -= 100 if events.cue_potted else 0
    if legal and before_pairs:
        # Development matters even when handing over the table, but do not reward
        # scattering indiscriminately or outweigh a verified pot/retained turn.
        score += min(20, min(6, 0.5 * opened) + min(4, 2 * new_routes) + min(12, 6 * new_targets))
        score -= min(15, 0.8 * opponent_opened + 4 * opponent_routes)
    score -= 0.2 * shot["power"]  # Prefer controlled energy when outcomes tie.
    target = next(b for b in state.balls if b.n == shot["calledBall"])
    miss = math.dist((target.x, target.y), POCKETS[shot["calledPocket"]][:2])
    return {
        **shot,
        "score": score,
        "evidence": {
            "verified": True,
            "legal": legal,
            "continues": continues,
            "potted": events.potted,
            "scratch": events.cue_potted,
            "won": won,
            "lost": lost,
            "calledPot": called,
            "nextShots": len(own),
            "opponentShots": len(opponent),
            "cueRegion": (
                "left" if cue.x < TABLE_W / 3 else "right" if cue.x > TABLE_W * 2 / 3 else "center"
            ),
            "cueFinish": {"x": cue.x, "y": cue.y},
            "targetMiss": miss,
            "firstContact": events.first_contact,
            "railAfterContact": events.rail_after_contact,
            "leftKitchen": events.cue_left_kitchen,
            "launchSpeed": shoot_speed(
                shot["power"], gs.rules["breakMax" if gs.break_shot else "normalMax"]
            ),
            "clusterLinksOpened": opened,
            "newObjectRoutes": new_routes,
            "newTargetsAvailable": new_targets,
            "opponentClusterLinksOpened": opponent_opened,
            "opponentNewObjectRoutes": opponent_routes,
        },
    }


def plan_shots(gs: GameState, *, max_trials=16, budget_seconds=2.0):
    """Return ranked executable options. None budget is for deterministic CI only.

    A safety may still need a legal ball/pocket call under call-all rules; such a
    call does not assert it will pot. No live model or network calls occur here.
    """
    if gs.winner is not None:
        return []
    deadline = None if budget_seconds is None else time.monotonic() + max(0, budget_seconds)
    state = copy.deepcopy(gs)
    placement = None
    if state.ball_in_hand:
        points = _placements(state)
        if not points:
            return []
        x, y = points[0]
        place_cue(state, x, y)
        placement = {"x": x, "y": y}
    backup = {
        **fallback(state),
        "family": "break" if state.break_shot else "escape",
        "score": -1000,
        "evidence": {"verified": False, "legal": None},
    }
    if placement:
        backup["placement"] = placement
    seeds = [backup] if state.break_shot else _seeds(gs)
    # Geometry powers were tuned at 3.5 m/s. Preserve that physical speed
    # under custom caps; development seeds already express physical energy.
    if not state.break_shot:
        for shot in [backup, *seeds]:
            if shot["family"] != "development":
                shot["power"] = _power_for_speed(
                    shoot_speed(shot["power"], 3.5), state.rules["normalMax"]
                )
    # Power and follow/draw variants produce different cue leaves. Side spin is
    # deliberately not guessed: it would require matching squirt compensation.
    # Reserve early coverage for energy/development before aim refinements consume
    # the deadline. Always retain the original controlled option as a comparison.
    queue = list(seeds[:1])
    if seeds and not state.break_shot:
        queue.append(_firm_variant(seeds[0], state))
    queue.extend(s for s in seeds[1:8])
    # Cushion friction/restitution make the ideal mirror only a starting point.
    # Reserve a small correction sweep for a bank, without unbounded angle search.
    bank = next((s for s in seeds if s["family"] == "bank"), None)
    if bank:
        queue.extend(
            {**bank, "aim": bank["aim"] + offset, "refined": True} for offset in (-0.09, 0.09)
        )
    for seed in seeds[:3]:
        queue.extend(
            [
                {**seed, "power": max(0.08, seed["power"] * 0.65), "tipY": 0.18},
                {**seed, "tipY": -0.22},
            ]
        )
    queue.extend(seeds[8:])
    completed = []
    trial = 0
    while queue and trial < max(0, min(max_trials, 64)):
        if deadline is not None and time.monotonic() >= deadline:
            break
        shot = queue.pop(0)
        trial += 1
        preview = _preview(gs, shot, deadline)
        if preview is None:
            continue
        completed.append(preview)
        # Small throw corrections around promising near misses, not random aim.
        evidence = preview["evidence"]
        if (
            shot["family"] == "direct"
            and not shot.get("refined")
            and not evidence["calledPot"]
            and evidence["targetMiss"] < 0.22
        ):
            for offset in (-0.012, 0.012):
                queue.insert(
                    min(4, len(queue)), {**shot, "aim": shot["aim"] + offset, "refined": True}
                )
    safe = [s for s in completed if s["evidence"]["legal"] and not s["evidence"]["lost"]]
    winners = [s for s in safe if s["evidence"]["won"]]
    choices = winners or safe or [s for s in completed if not s["evidence"]["lost"]] or [backup]
    choices.sort(key=lambda s: -s["score"])
    return [{**s, "id": f"shot-{i}", "trials": trial} for i, s in enumerate(choices[:12])]
