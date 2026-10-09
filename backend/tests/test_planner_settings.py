"""Actual bounded planning and physics across representative custom settings."""

import copy
import math

import pytest

from app.sim.cue import cue_elevation
from app.sim.physics import all_asleep, simulate_shot, strike
from app.sim.planner import plan_shots
from app.sim.rules import apply_shot, begin_shot, legal_targets, new_game, place_cue

SETTINGS = [
    {"preset": "bar"},
    {"preset": "tournament"},
    *[
        {
            "preset": "custom",
            "calls": calls,
            "scratch": scratch,
            "normalMax": maximum,
            "breakMax": 1 if maximum == 1 else 12,
            "strictBreak": maximum == 1,
            "assignOnBreak": maximum != 1,
            "scratchOnEightLoss": maximum == 1,
            "eightOnBreak": "spot" if maximum == 1 else "win",
        }
        for calls in ["none", "eight", "all"]
        for scratch, maximum in [("kitchen", 1), ("anywhere", 8.5)]
    ],
]


def fixture(settings):
    gs = new_game(1, settings)
    gs.break_shot = gs.open = False
    gs.groups = ["solid", "stripe"]
    positions = {0: (1.27, 0.95), 1: (1.27, 0.38), 8: (2.1, 1.1)}
    for b in gs.balls:
        b.potted = (b.n or 0) not in positions
        if not b.potted:
            b.x, b.y = positions[b.n or 0]
    return gs


def execute(gs, shot):
    if gs.ball_in_hand:
        assert place_cue(gs, **shot["placement"])
    cue = gs.balls[0]
    begin_shot(gs, shot["calledBall"], shot["calledPocket"])
    strike(
        cue,
        math.cos(shot["aim"]),
        math.sin(shot["aim"]),
        shot["power"],
        shot["tipX"],
        shot["tipY"],
        gs.rules["breakMax" if gs.break_shot else "normalMax"],
        cue_elevation(cue.x, cue.y, shot["aim"], 0, gs.balls),
    )
    events = simulate_shot(gs.balls, 0)
    assert all_asleep(gs.balls)
    apply_shot(gs, events)
    return events


@pytest.mark.parametrize("settings", SETTINGS)
def test_selected_plan_executes_under_custom_rules(settings):
    gs = fixture(settings)
    original = copy.deepcopy(gs)
    selected = plan_shots(gs, max_trials=4, budget_seconds=None)[0]
    assert gs == original
    assert selected["calledBall"] in legal_targets(gs)
    assert 0 <= selected["calledPocket"] < 6 and 0 <= selected["power"] <= 1
    events = execute(gs, selected)
    assert selected["evidence"]["verified"]
    assert selected["evidence"]["legal"] == (not gs.ball_in_hand)
    assert selected["evidence"]["potted"] == events.potted
    if gs.rules["normalMax"] > 1:
        assert not gs.ball_in_hand


@pytest.mark.parametrize("maximum", [1, 9.5, 12])
def test_break_cap_is_used_by_actual_plan_and_replay(maximum):
    gs = new_game(1, {"preset": "custom", "breakMax": maximum, "strictBreak": True})
    selected = plan_shots(gs, max_trials=1, budget_seconds=None)[0]
    assert selected["power"] == 1
    events = execute(gs, selected)  # Low caps may foul but must finish.
    if maximum == 9.5:
        assert not events.off_table


def test_exhausted_budget_kitchen_fallback_calls_own_ball():
    gs = fixture({"preset": "custom", "calls": "all", "normalMax": 1})
    gs.groups = ["stripe", "solid"]
    gs.kitchen_shot = True
    own = next(b for b in gs.balls if b.n == 9)
    own.potted, own.x, own.y = False, 0.4, 0.6
    selected = plan_shots(gs, max_trials=0, budget_seconds=None)[0]
    assert selected["calledBall"] == 9
    assert selected["power"] == 1
    assert selected["evidence"] == {"verified": False, "legal": None}
    execute(gs, selected)  # Valid input is not a claim of foul-free fallback play.


def test_unverified_fallback_preserves_physical_energy_under_custom_caps():
    from app.sim.physics import shoot_speed

    powers = {}
    for maximum in [1, 3.5, 8.5]:
        gs = fixture({"preset": "custom", "normalMax": maximum})
        shot = plan_shots(gs, max_trials=0, budget_seconds=None)[0]
        assert not shot["evidence"]["verified"]
        powers[maximum] = shot["power"]
    assert powers[1] == 1
    assert shoot_speed(powers[8.5], 8.5) == pytest.approx(shoot_speed(powers[3.5], 3.5))
