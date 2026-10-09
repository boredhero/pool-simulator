import json
from pathlib import Path

import pytest

from app.sim.config import match_config
from app.sim.physics import shoot_speed

CASES = json.loads(
    (Path(__file__).resolve().parents[2] / "contracts/match-speeds.json").read_text()
)


@pytest.mark.parametrize("case", CASES)
def test_shared_normal_and_break_speed_contract(case):
    rules = match_config(case["input"])
    assert rules["normalMax"] == case["normalMax"]
    assert rules["breakMax"] == case["breakMax"]
    assert shoot_speed(1, rules["normalMax"]) == case["normalMax"]
    assert shoot_speed(1, rules["breakMax"]) == case["breakMax"]
