"""Finite tapered cue clearance, mirrored by frontend/src/sim/cue.ts."""

import math

from app.sim.table import BALL_R, POCKETS, TABLE_H, TABLE_W, cushions, jaws

CUE_LENGTH = 1.45
# Rendered shaft/ring envelope plus 0.5 mm clearance, not the butt radius at tip.
TIP_RADIUS, TAPER = 0.0065, 0.006
CUSHION_W, RAIL_W = 0.035, 0.17


def _cushion_boxes():
    """Conservative sloped cloth/jaw strips, at most 0.82 mm height error."""
    boxes, ends = [], jaws()
    for c in cushions():
        along_x = c.y1 == c.y2
        nx = 0 if along_x else (-1 if c.x1 == 0 else 1)
        ny = (-1 if c.y1 == 0 else 1) if along_x else 0
        tx, ty = -ny, nx
        forward = tx + ty > 0
        sx, sy = (c.x1, c.y1) if forward else (c.x2, c.y2)
        ex, ey = (c.x2, c.y2) if forward else (c.x1, c.y1)
        length = math.hypot(ex - sx, ey - sy)
        first = min(ends, key=lambda j: math.hypot(j[0] - sx, j[1] - sy))
        last = min(ends, key=lambda j: math.hypot(j[0] - ex, j[1] - ey))
        for i in range(16):
            lo, hi = CUSHION_W * i / 16, CUSHION_W * (i + 1) / 16

            def bound(jaw, end):
                across = (jaw[0] - sx) * nx + (jaw[1] - sy) * ny
                along = (jaw[0] - sx) * tx + (jaw[1] - sy) * ty
                d = jaw[2] ** 2 - (max(lo, min(hi, across)) - across) ** 2
                if d <= 0:
                    return length if end else 0
                return max(length, along + math.sqrt(d)) if end else min(0, along - math.sqrt(d))

            a, b = bound(first, False), bound(last, True)
            xs, ys = (
                [sx + nx * lo + tx * a, sx + nx * hi + tx * b],
                [sy + ny * lo + ty * a, sy + ny * hi + ty * b],
            )
            boxes.append(
                (min(xs), max(xs), min(ys), max(ys), 0.036 + 0.013 * hi / CUSHION_W, False)
            )
    return boxes


BOXES = [
    *_cushion_boxes(),
    (-RAIL_W, -CUSHION_W, -RAIL_W, TABLE_H + RAIL_W, 0.054, True),
    (TABLE_W + CUSHION_W, TABLE_W + RAIL_W, -RAIL_W, TABLE_H + RAIL_W, 0.054, True),
    (-CUSHION_W, TABLE_W + CUSHION_W, -RAIL_W, -CUSHION_W, 0.054, True),
    (-CUSHION_W, TABLE_W + CUSHION_W, TABLE_H + CUSHION_W, TABLE_H + RAIL_W, 0.054, True),
]


def _interval(planes, length):
    """Intersect a + b*s >= 0 along the finite shaft without spatial sampling."""
    lo, hi = 0.0, length
    for a, b in planes:
        if abs(b) < 1e-12:
            if a < 0:
                return None
        elif b > 0:
            lo = max(lo, -a / b)
        else:
            hi = min(hi, -a / b)
        if lo > hi:
            return None
    return lo, hi


def _box_interval(box, x, y, z, dx, dy, dz, r, k, length):
    left, right, top, bottom, height, _ = box
    return _interval(
        (
            (x - left + r, dx + k),
            (right - x + r, -dx + k),
            (y - top + r, dy + k),
            (bottom - y + r, -dy + k),
            (height - z + r, -dz + k),
        ),
        length,
    )


def _hits_box(box, x, y, z, dx, dy, dz, length):
    """Continuous tapered-sphere sweep: broad-phase square corners are not solid."""
    left, right, top, bottom, height, _ = box
    cuts = [0, length]
    for origin, direction, edge in [
        (x, dx, left),
        (x, dx, right),
        (y, dy, top),
        (y, dy, bottom),
        (z, dz, height),
    ]:
        if abs(direction) > 1e-12:
            s = (edge - origin) / direction
            if 0 < s < length:
                cuts.append(s)
    cuts.sort()
    for lo, hi in zip(cuts, cuts[1:]):
        mid = (lo + hi) / 2
        a, b, c = -TAPER * TAPER, -2 * TIP_RADIUS * TAPER, -TIP_RADIUS * TIP_RADIUS
        for origin, direction, lower, upper in [
            (x, dx, left, right),
            (y, dy, top, bottom),
            (z, dz, -math.inf, height),
        ]:
            value = origin + direction * mid
            edge = lower if value < lower else upper if value > upper else None
            if edge is None:
                continue
            d = origin - edge
            a += direction * direction
            b += 2 * d * direction
            c += d * d
        at = max(lo, min(hi, -b / (2 * a))) if a > 0 else lo
        if min(a * lo * lo + b * lo + c, a * hi * hi + b * hi + c, a * at * at + b * at + c) < 0:
            return True
    return False


def cue_elevation(x, y, angle, pull, balls, tip_x=0, tip_y=0):
    """Lowest clear shaft pose against cushions, pocket openings and balls."""
    dx, dy = -math.cos(angle), -math.sin(angle)
    scale = min(1, 0.55 / (math.hypot(tip_x, tip_y) or 1))
    tx, ty = tip_x * scale, tip_y * scale
    x -= math.sin(angle) * BALL_R * tx
    y += math.cos(angle) * BALL_R * tx
    contact, length = math.sqrt(1 - tx * tx - ty * ty), CUE_LENGTH + max(0, pull)
    active = [
        b
        for b in BOXES
        if _box_interval(
            b, x - dx * 0.02, y - dy * 0.02, 0, dx, dy, 0, 0.04, 0, length + BALL_R + pull + 0.04
        )
    ]
    objects = [
        b
        for b in balls
        if not b.potted
        and b.n is not None
        and math.hypot(b.x - x, b.y - y) < length + BALL_R * 3 + pull
    ]

    def collides(e):
        ct, st = math.cos(e), math.sin(e)
        along = BALL_R * (contact * ct - ty * st)
        ox, oy = x + dx * along, y + dy * along
        oz = BALL_R + BALL_R * (ty * ct + contact * st)
        vx, vy = dx * ct, dy * ct
        for box in active:
            hit = _box_interval(box, ox, oy, oz, vx, vy, st, TIP_RADIUS, TAPER, length)
            if hit is None:
                continue
            if not box[5]:
                if _hits_box(box, ox, oy, oz, vx, vy, st, length):
                    return True
                continue
            remaining = [hit]
            for px, py, radius, _ in POCKETS:
                px, py, r = ox - px, oy - py, radius + 0.007 - TIP_RADIUS
                a = vx * vx + vy * vy - TAPER * TAPER
                b = 2 * (px * vx + py * vy + r * TAPER)
                c = px * px + py * py - r * r
                disc = b * b - 4 * a * c
                holes = []
                if abs(a) < 1e-12:
                    if abs(b) < 1e-12:
                        if c <= 0:
                            holes = [(-math.inf, math.inf)]
                    else:
                        holes = [(-math.inf, -c / b)] if b > 0 else [(-c / b, math.inf)]
                elif disc <= 0:
                    if a < 0:
                        holes = [(-math.inf, math.inf)]
                else:
                    roots = sorted(
                        [(-b - math.sqrt(disc)) / (2 * a), (-b + math.sqrt(disc)) / (2 * a)]
                    )
                    holes = (
                        [(roots[0], roots[1])]
                        if a > 0
                        else [(-math.inf, roots[0]), (roots[1], math.inf)]
                    )
                for start, end in holes:
                    next_remaining = []
                    for lo, hi in remaining:
                        if end <= lo or start >= hi:
                            next_remaining.append((lo, hi))
                        else:
                            if start > lo:
                                next_remaining.append((lo, start))
                            if end < hi:
                                next_remaining.append((end, hi))
                    remaining = next_remaining
                if not remaining:
                    break
            if remaining:
                return True
        for ball in objects:
            bx, by, bz = ox - ball.x, oy - ball.y, oz - BALL_R
            r, a = BALL_R + TIP_RADIUS, 1 - TAPER * TAPER
            q = bx * vx + by * vy + bz * st - r * TAPER
            s = max(0, min(length, -q / a))
            if a * s * s + 2 * q * s + bx * bx + by * by + bz * bz - r * r < 0:
                return True
        return False

    low = 3 * math.pi / 180
    if not collides(low):
        return low
    # A jaw can create disjoint clear intervals as the tip retracts. Bracket
    # the first one at quarter-degree resolution before refining its boundary.
    high = low
    while True:
        low = high
        high = min(math.pi / 2, high + math.pi / 720)
        if high >= math.pi / 2 or not collides(high):
            break
    for _ in range(14):
        mid = (low + high) / 2
        if collides(mid):
            low = mid
        else:
            high = mid
    return high
