"""Emit live Python shot results for the browser differential regression.

Only Python's standard library is needed. Keep this seed and case construction
stable: expected results come from the actual server solver, never a golden-file
rewrite. Full-precision inputs are passed to the browser solver unchanged.
"""

import json
import math
import random
import sys
from dataclasses import asdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.sim.physics import simulate_shot, strike
from app.sim.rules import new_game

cases = []
rng = random.Random(541)
for index in range(60):
    balls = new_game(index + 1).balls
    angle = (index % 10 - 4.5) * 0.0123
    args = [
        math.cos(angle),
        math.sin(angle),
        1 if index < 20 else rng.uniform(0.35, 1),
        0 if index < 20 else rng.uniform(-0.4, 0.4),
        0 if index < 20 else rng.uniform(-0.3, 0.3),
        9.5,
        0 if index < 20 else rng.uniform(0, 0.3),
        1 if index < 40 else 0.1,
    ]
    before = [asdict(ball) for ball in balls]
    strike(balls[0], *args)
    events = simulate_shot(balls, 0)
    cases.append(
        {
            "name": f"rack-{index}",
            "aim": angle,
            "balls": before,
            "args": args,
            "expected": [asdict(ball) for ball in balls],
            "events": asdict(events),
        }
    )
json.dump(cases, sys.stdout, allow_nan=False)
