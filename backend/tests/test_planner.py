import copy
import json
import math
from dataclasses import asdict
from pathlib import Path

import pytest

from app.sim.cue import cue_elevation
from app.sim.physics import all_asleep, simulate_shot, strike
from app.sim.planner import _development_seeds, _geometry, _preview, plan_shots
from app.sim.rules import apply_shot, begin_shot, can_place, new_game, place_cue

CASES = json.loads(Path(__file__).with_name("planner_fixtures.json").read_text())
CLUSTERS = json.loads(Path(__file__).with_name("cluster_fixtures.json").read_text())


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


@pytest.mark.parametrize("case", CLUSTERS, ids=lambda c: c["name"])
def test_dense_cluster_gets_useful_energy_within_four_trials(case):
    gs = fixture_state(case)
    original = asdict(gs)
    seed = next(s for s in _geometry(gs) if s["family"] in ("safety", "development"))
    soft = _preview(gs, {**seed, "power": 0.42}, None)
    hardest = _preview(gs, {**seed, "power": 1.0}, None)
    selected = plan_shots(gs, max_trials=4, budget_seconds=None)[0]
    assert soft["evidence"]["legal"] and hardest["evidence"]["legal"]
    assert selected["evidence"]["legal"] and selected["family"] == "development"
    assert 0.6 < selected["power"] < 1
    assert selected["evidence"]["clusterLinksOpened"] > soft["evidence"]["clusterLinksOpened"]
    assert selected["evidence"]["nextShots"] > soft["evidence"]["nextShots"]
    assert selected["score"] > hardest["score"]
    replay, events = execute(gs, selected)
    assert events.first_contact == 1 and not events.cue_potted
    assert replay.winner is None and not replay.ball_in_hand
    assert asdict(gs) == original


def test_dangerous_development_does_not_concede_early_eight():
    gs = fixture_state(
        {"balls": [[0, 0.9, 0.8], [1, 0.34, 0.28], [8, 0.27, 0.22], [2, 1.8, 0.7], [9, 2.0, 0.5]]}
    )
    development = [_preview(gs, s, None) for s in _development_seeds(gs)]
    assert any(s["evidence"]["lost"] for s in development)
    plans = plan_shots(gs, max_trials=8, budget_seconds=None)
    assert all(s["evidence"]["legal"] and not s["evidence"]["lost"] for s in plans)
    result, ev = execute(gs, plans[0])
    assert result.winner != 1 and not result.ball_in_hand and 8 not in ev.potted


def test_unclustered_easy_pot_keeps_controlled_power():
    selected = plan_shots(fixture_state(CASES[0]), budget_seconds=None)[0]
    assert selected["evidence"]["calledPot"] and selected["evidence"]["legal"]
    assert selected["power"] < 0.7


def test_development_description_reports_outcomes_not_success_probabilities():
    from app.api.jev import describe_plan

    selected = plan_shots(fixture_state(CLUSTERS[0]), max_trials=4, budget_seconds=None)[0]
    description = describe_plan(selected)
    assert description["pace"] == "strong"
    assert description["development_result"] == "congestion opened with new direct shot options"
    assert description["cluster_development"]["new_shootable_targets"] > 0
    assert description["opponent_development"]["new_clear_object_ball_routes"] == 0


def test_glancing_cluster_option_adds_useful_energy_and_a_distinct_cue_leave():
    gs = fixture_state(CLUSTERS[0])
    seeds = _development_seeds(gs)
    glancing = next(s for s in seeds if s["contactStyle"] == "glancing")
    straight = next(s for s in seeds if s["contactStyle"] == "head-on" and s["pace"] == "strong")
    firm = _preview(gs, glancing, None)
    soft = _preview(gs, {**glancing, "power": 0.42}, None)
    head_on = _preview(gs, straight, None)
    assert firm["evidence"]["legal"] and not firm["evidence"]["scratch"]
    assert not soft["evidence"]["legal"]  # A weak glance fails to drive a ball to a rail.
    assert firm["evidence"]["clusterLinksOpened"] > 0
    assert firm["evidence"]["newTargetsAvailable"] > 0
    assert firm["evidence"]["nextShots"] > soft["evidence"]["nextShots"]
    assert firm["evidence"]["cueFinish"] != head_on["evidence"]["cueFinish"]
    assert firm["power"] == straight["power"]  # New contact geometry, no blanket power boost.
    assert 2.8 < firm["evidence"]["launchSpeed"] < 3.0


def test_creative_contacts_are_previewed_within_existing_trial_budget(monkeypatch):
    import app.sim.planner as planner

    attempted = []
    preview = planner._preview

    def record(gs, shot, deadline):
        attempted.append(shot)
        return preview(gs, shot, deadline)

    monkeypatch.setattr(planner, "_preview", record)
    choices = planner.plan_shots(fixture_state(CLUSTERS[0]), max_trials=8, budget_seconds=None)
    assert len(attempted) == 8
    assert any(s.get("contactStyle") == "glancing" for s in attempted)
    assert all(s["evidence"]["legal"] and not s["evidence"]["lost"] for s in choices)
