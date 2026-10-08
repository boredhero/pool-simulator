"""The same policy examples cover every supported categorical custom configuration."""

import itertools
import json
from pathlib import Path

import pytest

from app.sim.physics import ShotEvents
from app.sim.rules import apply_shot, begin_shot, new_game

MATRIX = json.loads((Path(__file__).parents[2] / "contracts/custom-rules-matrix.json").read_text())
CONFIGS = [
    dict(zip(MATRIX["axes"], values)) for values in itertools.product(*MATRIX["axes"].values())
]
KEYS = {
    "breakShot": "break_shot",
    "ballInHand": "ball_in_hand",
    "firstContact": "first_contact",
    "offTable": "off_table",
    "railAfterContact": "rail_after_contact",
    "cuePotted": "cue_potted",
    "objectRails": "object_rails",
}


@pytest.mark.parametrize("options", CONFIGS)
def test_custom_rule_policy_matrix(options):
    for case in MATRIX["cases"]:
        gs = new_game(1, {"preset": "custom", **options})
        for key, value in case["state"].items():
            setattr(gs, KEYS.get(key, key), value.copy() if isinstance(value, list) else value)
        for ball in gs.balls:
            ball.potted = ball.n in case.get("pottedBefore", [])
        begin_shot(gs, *case.get("call", [None, None]))
        ev = ShotEvents(**{KEYS.get(key, key): value for key, value in case["ev"].items()})
        for ball in gs.balls:
            if ball.n in ev.potted:
                ball.potted = True
        apply_shot(gs, ev)
        matches = [
            v for v in case["variants"] if all(options[k] == x for k, x in v["when"].items())
        ]
        assert len(matches) == 1
        for key, expected in matches[0]["expected"].items():
            assert getattr(gs, KEYS.get(key, key)) == expected, (case["name"], options, key)
