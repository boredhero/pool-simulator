"""Geometry candidates for the server-owned Jev game; SI meters."""

import math

from app.sim.rules import legal_targets
from app.sim.table import BALL_R, POCKETS, TABLE_H, TABLE_W


def clear(x1, y1, x2, y2, balls, ignore):
    dx, dy = x2 - x1, y2 - y1
    length = dx * dx + dy * dy
    for ball in balls:
        if ball.potted or ball.id in ignore:
            continue
        t = max(0, min(1, ((ball.x - x1) * dx + (ball.y - y1) * dy) / length)) if length else 0
        if math.hypot(ball.x - x1 - dx * t, ball.y - y1 - dy * t) < BALL_R * 2 + 0.004:
            return False
    return True


def candidates(gs):
    cue = gs.balls[0]
    targets = legal_targets(gs)
    result = []
    for b in gs.balls:
        if b.potted or b.n not in targets or (gs.kitchen_shot and b.x < TABLE_W / 4):
            continue
        for i, p in enumerate(POCKETS):
            dx, dy = b.x - p[0], b.y - p[1]
            distance = math.hypot(dx, dy) or 1
            gx, gy = b.x + dx / distance * BALL_R * 2, b.y + dy / distance * BALL_R * 2
            ax, ay = gx - cue.x, gy - cue.y
            travel = math.hypot(ax, ay) or 1
            cut = math.acos(
                max(-1, min(1, (ax * (p[0] - b.x) + ay * (p[1] - b.y)) / (travel * distance)))
            )
            if cut > 65 * math.pi / 180:
                continue
            if not clear(cue.x, cue.y, gx, gy, gs.balls, [0, b.id]):
                continue
            if not clear(b.x, b.y, p[0], p[1], gs.balls, [0, b.id]):
                continue
            result.append(
                {
                    "aim": math.atan2(ay, ax),
                    "power": min(0.9, max(0.15, 0.15 + (travel + distance) * 0.22)),
                    "tipX": 0,
                    "tipY": 0,
                    "calledBall": b.n,
                    "calledPocket": i,
                    "cutDegrees": cut * 180 / math.pi,
                    "cueDistance": travel,
                    "pocketDistance": distance,
                    "score": (1 - cut / math.pi) * 2
                    - (travel + distance) / (TABLE_W + TABLE_H)
                    + (0.1 if p[3] else 0),
                }
            )
    return sorted(result, key=lambda item: -item["score"])[:12]


def fallback(gs):
    cue = gs.balls[0]
    targets = legal_targets(gs)
    target = next(
        (
            b
            for b in gs.balls
            if not b.potted and b.n in targets and (not gs.kitchen_shot or b.x >= TABLE_W / 4)
        ),
        None,
    )
    if target is None:
        target = next(b for b in gs.balls if b.id and not b.potted)
    return {
        "aim": math.atan2(target.y - cue.y, target.x - cue.x),
        "power": 1 if gs.break_shot else 0.4,
        "tipX": 0,
        "tipY": 0.1 if gs.break_shot else 0,
        "calledBall": target.n,
        "calledPocket": 0,
    }
