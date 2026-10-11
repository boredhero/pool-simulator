"""Shared entry point preserves established impulse physics and event ownership."""

from dataclasses import asdict

import pytest

from app.sim.physics import Ball, shoot_speed, strike
from app.sim.stroke import simulate_stroke, strike_balls
from app.sim.table import BALL_R


@pytest.mark.parametrize(
    "power,tx,ty,elevation", [(0, 0, 0, 0), (0.5, 0.3, -0.2, 0.05), (1, 0, 0, 0.15)]
)
def test_shared_entry_preserves_impulse_model(power, tx, ty, elevation):
    actual, reference = Ball(x=1, y=0.6), Ball(x=1, y=0.6)
    events = strike_balls([actual], 0, 1, 0, power, tx, ty, elevation=elevation)
    strike(reference, 1, 0, power, tx, ty, elevation=elevation)
    assert asdict(actual) == asdict(reference)
    assert events.first_contact is None
    assert "cue_double_hit" not in asdict(events) and "cue_push" not in asdict(events)
    assert actual.x == 1 and actual.y == 0.6


def test_solid_sphere_angular_impulse_relation():
    b = Ball(x=1, y=0.6)
    strike_balls([b], 0, 1, 0, 0.5, 0, 0.3)
    # I = 2/5 mR² and angular impulse R*b*m*v give omega=2.5*b*v/R.
    assert b.wy == pytest.approx(2.5 * 0.3 * shoot_speed(0.5) / BALL_R)
    assert b.vx == shoot_speed(0.5)


def test_complete_simulation_records_contacts_without_inventing_stroke_fouls():
    cue = Ball(x=1, y=0.6)
    target = Ball(id=1, n=1, x=1 + 2 * BALL_R + 0.0005, y=0.6)
    events = simulate_stroke([cue, target], 0, 1, 0, 0.2, 0, 0)
    assert events.first_contact == 1
    assert "cue_double_hit" not in asdict(events) and "cue_push" not in asdict(events)
