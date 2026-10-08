import copy
import json
import math
from dataclasses import asdict
from pathlib import Path

import pytest

from app.sim.cue import cue_elevation
from app.sim.physics import all_asleep, simulate_shot, strike
from app.sim.planner import _geometry, _preview, plan_shots
from app.sim.rules import apply_shot, begin_shot, can_place, new_game, place_cue

CASES = json.loads(Path(__file__).with_name("planner_fixtures.json").read_text())


def fixture_state(case):
    gs = new_game(1, {"preset": "tournament"})
    gs.break_shot, gs.open = False, False
    gs.groups = ["solid", "stripe"]
    positions = {n: (x, y) for n, x, y in case["balls"]}
    for b in gs.balls:
        b.potted = (b.n or 0) not in positions
        if not b.potted:
            b.x, b.y = positions[b.n or 0]
    if case.get("placement"):
        gs.ball_in_hand, gs.placement = True, case["placement"]
        gs.kitchen_shot = gs.placement == "kitchen"
    if case.get("kitchen"):
        gs.kitchen_shot = True
    return gs


def execute(gs, shot):
    gs = copy.deepcopy(gs)
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
        gs.rules["normalMax"],
        cue_elevation(cue.x, cue.y, shot["aim"], 0, gs.balls),
    )
    ev = simulate_shot(gs.balls, 0)
    assert all_asleep(gs.balls)
    apply_shot(gs, ev)
    return gs, ev


@pytest.mark.parametrize("case", CASES, ids=lambda c: c["name"])
def test_planner_plays_legal_fixture_and_never_mutates_input(case):
    gs = fixture_state(case)
    before = asdict(gs)
    choices = plan_shots(gs, max_trials=16, budget_seconds=None)
    assert asdict(gs) == before
    best = choices[0]
    assert best["evidence"]["verified"] and best["evidence"]["legal"]
    assert all(s["evidence"]["legal"] for s in choices)
    if gs.ball_in_hand:
        assert can_place(gs, **best["placement"])
    result, events = execute(gs, best)
    assert not result.ball_in_hand and result.winner != 1
    assert events.potted == best["evidence"]["potted"]
    assert events.cue_potted == best["evidence"]["scratch"]
    if case["name"] in ("straight-side", "ball-in-hand", "eight-call"):
        assert best["evidence"]["calledPot"]
    if case["name"] == "kitchen-return-kick":
        assert best["family"] == "kick"
        assert events.cue_left_kitchen and events.first_contact_x < 0.635
        assert events.rail_after_contact
    if case["name"] == "called-combination":
        assert best["family"] == "combination"
        assert best["calledBall"] == 2 and events.first_contact == 1
        assert best["evidence"]["calledPot"] and result.current == gs.current


def test_zero_budget_is_explicit_fallback_with_valid_placement():
    gs = fixture_state(CASES[3])
    before = asdict(gs)
    shot = plan_shots(gs, budget_seconds=0)[0]
    assert not shot["evidence"]["verified"]
    assert shot["evidence"]["legal"] is None
    assert can_place(gs, **shot["placement"])
    assert asdict(gs) == before


def test_expired_preview_never_reports_a_partial_simulation_as_verified():
    gs = fixture_state(CASES[0])
    assert _preview(gs, _geometry(gs)[0], deadline=0) is None


def test_kitchen_return_kicks_are_generated():
    gs = fixture_state({"balls": [[0, 0.25, 0.7], [1, 0.4, 0.5], [8, 2.1, 1.0]]})
    gs.kitchen_shot = True
    shots = _geometry(gs)
    assert shots and any(s["family"] == "kick" for s in shots)
    assert not any(s["family"] in ("direct", "bank", "safety") for s in shots)


def test_completed_game_has_no_shots():
    gs = fixture_state(CASES[0])
    gs.winner = 0
    assert plan_shots(gs) == []
