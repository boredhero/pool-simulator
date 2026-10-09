"""Deterministic cue-tip friction and wear, mirrored by the browser."""

import math

from app.sim.numeric import norm


def finite(value, fallback=0.0):
    return float(value) if isinstance(value, (int, float)) and math.isfinite(value) else fallback


def level(value):
    return max(0.0, min(1.0, finite(value, 1.0)))


def contact(chalk, tip_x, tip_y):
    tx, ty = finite(tip_x), finite(tip_y)
    offset = norm(tx, ty)
    if offset > 0.55:
        tx, ty = tx * (0.55 / offset), ty * (0.55 / offset)
    offset = norm(tx, ty)
    h = math.sqrt(1 - offset * offset)
    grip = min(1.0, (0.25 + 0.45 * level(chalk)) * h / offset) if offset else 1.0
    return tx, ty, h, grip


def wear(chalk, power, tip_x, tip_y):
    tx, ty, _, _ = contact(chalk, tip_x, tip_y)
    return max(
        0.0,
        level(chalk) - (0.12 + 0.08 * max(0, min(1, finite(power))) + 0.1 * norm(tx, ty) / 0.55),
    )
