"""Physical invariants of the finite cue-contact model."""

import math

import pytest

from app.sim import stroke
from app.sim.physics import Ball, shoot_speed
from app.sim.table import BALL_R


def ball():
    return Ball(x=1.0, y=0.6)


def energy(b):
    return 0.5 * 0.17 * (b.vx * b.vx + b.vy * b.vy + b.vz * b.vz) + 0.2 * 0.17 * BALL_R**2 * (
        b.wx * b.wx + b.wy * b.wy + b.wz * b.wz
    )


@pytest.mark.parametrize("power", [0, 0.25, 0.5, 1])
def test_center_contact_preserves_power_calibration(power):
    b = ball()
    events = stroke.strike_balls([b], 0, 1, 0, power, 0, 0)
    assert b.vx == pytest.approx(shoot_speed(power), rel=0.025)
    assert b.vy == b.wz == 0
    assert not events.cue_double_hit and not events.cue_push
    # Contact genuinely advances position, by millimetres rather than a whole stroke.
    assert 1 < b.x < 1.006
    initial_cue_speed = shoot_speed(power) * (1 + 0.17 / 0.54) / 1.75
    assert energy(b) <= 0.5 * 0.54 * initial_cue_speed**2


def test_spin_mirrors_and_effective_endmass_controls_squirt(monkeypatch):
    left, right = ball(), ball()
    stroke.strike_balls([left], 0, 1, 0, 1, -0.3, 0)
    stroke.strike_balls([right], 0, 1, 0, 1, 0.3, 0)
    assert left.vx == pytest.approx(right.vx, abs=1e-12)
    assert left.vy == pytest.approx(-right.vy, abs=1e-12)
    assert left.wz == pytest.approx(-right.wz, abs=1e-10)
    monkeypatch.setattr(stroke, "END_MASS", 0.006)
    low = ball()
    stroke.strike_balls([low], 0, 1, 0, 1, 0.3, 0)
    assert abs(math.atan2(low.vy, low.vx)) < abs(math.atan2(right.vy, right.vx))


@pytest.mark.parametrize("gap,foul", [(0, False), (0.0005, True), (0.005, True), (0.02, False)])
def test_actual_close_ball_contact_and_frozen_exception(gap, foul):
    cue = ball()
    target = Ball(id=1, n=1, x=cue.x + 2 * BALL_R + gap, y=cue.y)
    events = stroke.strike_balls([cue, target], 0, 1, 0, 0.5, 0, 0)
    assert events.first_contact == 1
    assert events.cue_double_hit is foul
    assert not events.cue_push
    assert target.vx > 0


def test_contact_step_converges(monkeypatch):
    a, b = ball(), ball()
    stroke.strike_balls([a], 0, 1, 0, 0.7, 0.3, -0.2)
    monkeypatch.setattr(stroke, "CONTACT_DT", stroke.CONTACT_DT / 2)
    stroke.strike_balls([b], 0, 1, 0, 0.7, 0.3, -0.2)
    assert a.vx == pytest.approx(b.vx, rel=0.015)
    assert a.vy == pytest.approx(b.vy, rel=0.025)
    assert a.wz == pytest.approx(b.wz, rel=0.025)


def test_simulation_preserves_contact_foul():
    cue = ball()
    target = Ball(id=1, n=1, x=cue.x + 2 * BALL_R + 0.0005, y=cue.y)
    events = stroke.simulate_stroke([cue, target], 0, 1, 0, 0.2, 0, 0)
    assert events.cue_double_hit and events.first_contact == 1


def test_frozen_ball_does_not_exempt_a_later_tip_recontact():
    cue = ball()
    first = Ball(id=1, n=1, x=cue.x + 2 * BALL_R, y=cue.y)
    second = Ball(id=2, n=2, x=cue.x + 4 * BALL_R + 0.005, y=cue.y)
    events = stroke.strike_balls([cue, first, second], 0, 1, 0, 0.5, 0, 0)
    assert events.first_contact == 1
    assert events.cue_double_hit


def test_elevated_contact_builds_a_jump_before_tip_separation():
    cue = ball()
    events = stroke.strike_balls([cue], 0, 1, 0, 1, 0, 0.1, 3.5, 0.95)
    assert cue.vz > 0.5
    assert cue.z >= 0
    assert not events.cue_double_hit
    initial_speed = shoot_speed(1) * (1 + 0.17 / 0.54) / 1.75
    assert energy(cue) <= 0.5 * 0.54 * initial_speed**2
