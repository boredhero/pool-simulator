import math

import pytest

from app.sim.cue import cue_elevation
from app.sim.table import BALL_R


@pytest.mark.parametrize("angle", [0, math.pi / 4])
def test_backspin_clears_corner_facing(angle):
    neutral = cue_elevation(0.08, 0.08, angle, 0, [])
    elevation = cue_elevation(0.08, 0.08, angle, 0, [], 0, -0.55)
    assert elevation > neutral
    distance = (0.08 - 0.0165) / math.cos(angle)
    height = BALL_R - BALL_R * 0.55 / math.cos(elevation) + distance * math.tan(elevation)
    assert height >= 0.054 + 0.0165 - 1e-12


def test_side_spin_corner_symmetry():
    positive = cue_elevation(0.08, 0.08, math.pi / 4, 0, [], 0.4, -0.3)
    negative = cue_elevation(0.08, 0.08, math.pi / 4, 0, [], -0.4, -0.3)
    assert positive == pytest.approx(negative, abs=1e-12)
    assert positive > cue_elevation(0.08, 0.08, math.pi / 4, 0, [], 0, -0.3)
