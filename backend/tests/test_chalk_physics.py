import json
from pathlib import Path

import pytest

from app.sim.chalk import contact, wear
from app.sim.physics import Ball, strike

CASES = json.loads((Path(__file__).resolve().parents[2] / "contracts/chalk.json").read_text())


@pytest.mark.parametrize("case", CASES)
def test_shared_chalk_impulse(case):
    c = case
    b = Ball(id=0, n=None, x=1, y=0.6)
    strike(b, 1, 0, c["power"], c["tipX"], c["tipY"], 3.5, c["elevation"], c["level"])
    assert [b.vx, b.vy, b.vz, b.wx, b.wy, b.wz] == pytest.approx(c["velocity"], abs=1e-11)
    assert contact(c["level"], c["tipX"], c["tipY"])[3] == pytest.approx(c["grip"])
    assert wear(c["level"], c["power"], c["tipX"], c["tipY"]) == pytest.approx(c["remaining"])


def test_successful_grip_is_unchanged_and_center_needs_no_chalk():
    for level in (0, 0.5, 1):
        a, b = Ball(id=0, n=None, x=1, y=0.6), Ball(id=0, n=None, x=1, y=0.6)
        strike(a, 1, 0, 0.7, 0, 0)
        strike(b, 1, 0, 0.7, 0, 0, chalk_level=level)
        assert a == b
    assert contact(1, 0.55, 0)[3] == 1
    assert contact(0, 0.55, 0)[3] < 1
