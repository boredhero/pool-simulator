import json
import math
import statistics
import time

from app.sim.cue import cue_elevation
from app.sim.physics import DT, ShotEvents, all_asleep, step, strike
from app.sim.rules import new_game

rows = []
start = time.perf_counter()
for seed in range(1, 17):
    g = new_game(seed)
    b = g.balls[0]
    angle = (seed % 5 - 2) * 0.004
    strike(
        b,
        math.cos(angle),
        math.sin(angle),
        0.8 + (seed % 3) * 0.1,
        0,
        0.1,
        8.5,
        cue_elevation(b.x, b.y, angle, 0, g.balls),
    )
    ev = ShotEvents()
    contact = {"v": False}
    seconds = 0
    while seconds < 45 and not all_asleep(g.balls):
        step(g.balls, DT, ev, 0, contact)
        seconds += DT
    rows.append(
        {
            "seed": seed,
            "seconds": round(seconds, 3),
            "asleep": all_asleep(g.balls),
            "pots": len(ev.potted),
        }
    )
print(
    json.dumps(
        {
            "shots": rows,
            "median": statistics.median(r["seconds"] for r in rows),
            "mean": statistics.mean(r["seconds"] for r in rows),
            "elapsed": time.perf_counter() - start,
        },
        indent=2,
    )
)
