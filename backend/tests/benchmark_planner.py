"""Offline deterministic fixtures: python -m tests.benchmark_planner is unnecessary.

Run from backend: PYTHONPATH=.:tests .venv/bin/python tests/benchmark_planner.py
No API calls, production database, or account data are accessed.
"""

import copy
import json
import time

from test_planner import CASES, CLUSTERS, execute, fixture_state

from app.sim.cpu import candidates, fallback
from app.sim.planner import _geometry, _preview, plan_shots
from app.sim.rules import place_cue


def baseline(gs):
    state = copy.deepcopy(gs)
    placement = None
    if state.ball_in_hand:
        for x in range(15, 254, 10):
            for y in range(15, 127, 10):
                if place_cue(state, x / 100, y / 100):
                    placement = {"x": x / 100, "y": y / 100}
                    break
            if placement:
                break
    choices = candidates(state)
    shot = choices[0] if choices else fallback(state)
    return {**shot, **({"placement": placement} if placement else {})}


def run():
    rows = []
    for case in CASES:
        gs = fixture_state(case)
        for policy in ("geometry", "planner"):
            start = time.perf_counter()
            shot = (
                baseline(gs)
                if policy == "geometry"
                else plan_shots(gs, max_trials=16, budget_seconds=None)[0]
            )
            elapsed = time.perf_counter() - start
            result, ev = execute(gs, shot)
            rows.append(
                {
                    "fixture": case["name"],
                    "policy": policy,
                    "legal": not result.ball_in_hand and result.winner != 1,
                    "retained": result.current == gs.current,
                    "calledPot": any(
                        p["n"] == shot["calledBall"] and p["pocket"] == shot["calledPocket"]
                        for p in ev.pockets
                    ),
                    "scratch": ev.cue_potted,
                    "win": result.winner == gs.current,
                    "seconds": round(elapsed, 4),
                }
            )
    summary = {
        policy: {
            metric: sum(row[metric] for row in rows if row["policy"] == policy)
            for metric in ("legal", "retained", "calledPot", "scratch", "win")
        }
        for policy in ("geometry", "planner")
    }
    cluster_rows = []
    for case in CLUSTERS:
        gs = fixture_state(case)
        seed = next(s for s in _geometry(gs) if s["family"] in ("safety", "development"))
        plans = [
            (f"matched-power-{power}", _preview(gs, {**seed, "power": power}, None))
            for power in (0.42, 0.65, 0.85, 1.0)
        ]
        plans.append(("planner-four-trials", plan_shots(gs, max_trials=4, budget_seconds=None)[0]))
        for policy, shot in plans:
            ev = shot["evidence"]
            cluster_rows.append(
                {
                    "fixture": case["name"],
                    "policy": policy,
                    "power": round(shot["power"], 4),
                    "score": round(shot["score"], 3),
                    **{
                        k: ev[k]
                        for k in (
                            "legal",
                            "scratch",
                            "lost",
                            "nextShots",
                            "opponentShots",
                            "clusterLinksOpened",
                            "newObjectRoutes",
                            "newTargetsAvailable",
                        )
                    },
                }
            )
    print(
        json.dumps(
            {
                "fixtures": len(CASES),
                "summary": summary,
                "rows": rows,
                "cluster_comparisons": cluster_rows,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    run()
