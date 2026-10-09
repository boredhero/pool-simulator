"""Regression cases shared with the browser's real rendered-cushion checks."""

import json
import math
from pathlib import Path

import pytest

from app.sim.cue import cue_elevation
from app.sim.physics import Ball
from app.sim.table import BALL_R

CASES = json.loads(
    (Path(__file__).resolve().parents[2] / "contracts/cue-clearance.json").read_text()
)


@pytest.mark.parametrize("case", CASES, ids=lambda c: c["name"])
def test_shared_clearance_contract(case):
    e = cue_elevation(
        case["x"],
        case["y"],
        case["aim"],
        case["pull"],
        [Ball(**b) for b in case["balls"]],
        case["tipX"],
        case["tipY"],
    )
    assert e == pytest.approx(case["elevation"], abs=1e-10)
    assert case["minDegrees"] - 1e-9 <= math.degrees(e) < case["maxDegrees"]


def test_full_rotation_near_rail_and_pocket_jaws():
    for x, y in [(BALL_R, 0.635), (1.33, BALL_R), (0.03, 0.03)]:
        last = cue_elevation(x, y, 0, 0, [])
        for i in range(1, 721):
            next_angle = cue_elevation(x, y, i * math.pi / 360, 0, [])
            if x != 1.33:
                assert math.degrees(abs(next_angle - last)) < 4
            assert math.degrees(next_angle) < 40
            last = next_angle
        assert last == pytest.approx(cue_elevation(x, y, 0, 0, []), abs=1e-10)


def test_side_spin_corner_symmetry():
    positive = cue_elevation(0.08, 0.08, math.pi / 4, 0, [], 0.4, -0.3)
    negative = cue_elevation(0.08, 0.08, math.pi / 4, 0, [], -0.4, -0.3)
    assert positive == pytest.approx(negative, abs=1e-12)
