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

from app.sim.stroke import simulate_stroke
from app.sim.physics import Ball, simulate_shot
from app.sim.table import BALL_R, TABLE_W
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
    events = simulate_stroke(balls, 0, *args)
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
# Contact boundaries and physical pocket transitions use the same live engines.
for gap in (0.0, .0005, .005, .02):
    balls = [Ball(x=1, y=.6), Ball(id=1, n=1, x=1+2*BALL_R+gap, y=.6)]
    args = [1, 0, .5, 0, 0, 3.5, 0, 1]
    before = [asdict(ball) for ball in balls]
    events = simulate_stroke(balls, 0, *args)
    cases.append({"name": f"contact-gap-{gap}", "aim": 0, "balls": before, "args": args,
                  "expected": [asdict(ball) for ball in balls], "events": asdict(events)})
for offset, speed in ((0, .5), (0, 7), (.045, 1), (.03, 3)):
    balls = [Ball(potted=True), Ball(id=1, n=1, x=TABLE_W/2+offset, y=.15, vy=-speed, asleep=False)]
    before = [asdict(ball) for ball in balls]
    events = simulate_shot(balls, 0)
    cases.append({"name": f"pocket-{offset}-{speed}", "balls": before, "args": None,
                  "expected": [asdict(ball) for ball in balls], "events": asdict(events)})
json.dump(cases, sys.stdout, allow_nan=False)
