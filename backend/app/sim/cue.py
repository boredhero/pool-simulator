"""Automatic cue clearance, mirrored by frontend/src/sim/cue.ts."""

import math

from app.sim.table import BALL_R, TABLE_H, TABLE_W


def cue_elevation(x, y, angle, pull, balls, tip_x=0, tip_y=0):
    dx, dy = -math.cos(angle), -math.sin(angle)
    reach, clearance, rail = 1.45 + BALL_R + pull, 0.0165, 0.17
    scale = min(1, 0.55 / (math.hypot(tip_x, tip_y) or 1))
    x -= math.sin(angle) * BALL_R * tip_x * scale
    y += math.cos(angle) * BALL_R * tip_x * scale
    elevation = 3 * math.pi / 180

    def clear(distance, height):
        nonlocal elevation
        if distance <= reach:
            d, h = max(0.001, distance), height + clearance - BALL_R
            # Backspin lowers the shaft; solve its height at the obstacle.
            drop = BALL_R * max(0, -tip_y * scale)
            required = math.atan2(h, d) + math.asin(min(1, drop / math.hypot(d, h)))
            elevation = max(elevation, min(math.pi / 2 - 0.001, required))

    for left, right, top, bottom in [
        (-rail, 0, -rail, TABLE_H + rail),
        (TABLE_W, TABLE_W + rail, -rail, TABLE_H + rail),
        (0, TABLE_W, -rail, 0),
        (0, TABLE_W, TABLE_H, TABLE_H + rail),
    ]:
        near, far = 0, reach
        for origin, direction, lo, hi in [(x, dx, left, right), (y, dy, top, bottom)]:
            if abs(direction) < 1e-9:
                if origin < lo - clearance or origin > hi + clearance:
                    far = -1
            else:
                a, b = (lo - clearance - origin) / direction, (hi + clearance - origin) / direction
                near, far = max(near, min(a, b)), min(far, max(a, b))
        if near <= far and far >= 0:
            clear(near, 0.054)
    for ball in balls:
        if ball.potted or ball.n is None:
            continue
        bx, by = ball.x - x, ball.y - y
        along, sideways, radius = bx * dx + by * dy, abs(bx * dy - by * dx), BALL_R + clearance
        if along > 0 and sideways < radius:
            clear(along - math.sqrt(radius * radius - sideways * sideways), BALL_R * 2)
    return elevation
