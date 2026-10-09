"""Versioned eight-ball house presets. Wire keys match the browser."""

import math

BAR_RULES = dict(
    preset="bar",
    chalkSim=False,
    scratch="kitchen",
    calls="eight",
    eightOnBreak="win",
    scratchOnEightLoss=True,
    assignOnBreak=True,
    strictBreak=False,
    normalMax=3.5,
    breakMax=9.5,
)
TOURNAMENT_RULES = {
    **BAR_RULES,
    "preset": "tournament",
    "scratch": "anywhere",
    "calls": "all",
    "eightOnBreak": "spot",
    "scratchOnEightLoss": False,
    "assignOnBreak": False,
    "strictBreak": True,
}


def match_config(value=None):
    data = value if isinstance(value, dict) else {}
    extra = {"chalkSim": data.get("chalkSim") is True}
    if data.get("preset") == "tournament":
        return {**TOURNAMENT_RULES, **extra}
    if data.get("preset") != "custom":
        return {**BAR_RULES, **extra}
    out = {**BAR_RULES, **extra, "preset": "custom"}
    for key, choices in (
        ("scratch", ("kitchen", "anywhere")),
        ("calls", ("none", "eight", "all")),
        ("eightOnBreak", ("win", "spot")),
    ):
        if data.get(key) in choices:
            out[key] = data[key]
    for key in ("scratchOnEightLoss", "assignOnBreak", "strictBreak"):
        if isinstance(data.get(key), bool):
            out[key] = data[key]
    for key, maximum in (("normalMax", 8.5), ("breakMax", 12)):
        n = data.get(key)
        if isinstance(n, (int, float)) and not isinstance(n, bool) and math.isfinite(n):
            out[key] = max(1, min(maximum, n))
    return out
