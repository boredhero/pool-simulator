"""Physical rescue routes and complete, bounded continuation evidence."""

import copy

from app.sim.planner import _advanced_seeds, _preview, plan_shots
from app.sim.rules import new_game


def layout(positions):
    state = new_game()
    state.break_shot, state.open = False, False
    state.groups = ["solid", "stripe"]
    for ball in state.balls:
        ball.potted = (ball.n or 0) not in positions
        if not ball.potted:
            ball.x, ball.y = positions[ball.n or 0]
    return state


def test_jump_clears_a_blocker_that_the_same_level_stroke_hits():
    state = layout({0: (0.5, 0.635), 1: (1.4, 0.635), 9: (0.7, 0.592), 8: (2, 0.3)})
    shot = next(
        s
        for s in _advanced_seeds(state)
        if s["family"] == "jump" and s["calledPocket"] == 1 and s["elevation"] == 0.7
    )
    jumped = _preview(state, shot, None)
    level = _preview(state, {**shot, "elevation": 0}, None)
    assert jumped["evidence"]["legal"]
    assert jumped["evidence"]["firstContact"] == 1
    assert jumped["evidence"]["peakHeight"] > 0.01
    assert level["evidence"]["firstContact"] == 9
    assert not level["evidence"]["legal"]


def test_masse_route_is_measured_and_does_not_mutate_table():
    state = layout({0: (0.5, 0.635), 1: (1.4, 0.635), 9: (0.85, 0.635), 8: (2, 0.3)})
    original = copy.deepcopy(state)
    choices = plan_shots(state, budget_seconds=None)
    curved = next(s for s in choices if s["family"] == "masse")
    assert curved["evidence"]["legal"] and curved["evidence"]["firstContact"] == 1
    assert curved["evidence"]["curveDisplacement"] > 0.01
    assert curved["elevation"] >= 1.05
    assert state == original


def test_runout_evidence_can_be_replayed_and_search_stays_inside_total_budget(monkeypatch):
    import app.sim.planner as planner

    state = layout({0: (1.27, 0.6), 1: (1.27, 0.12), 2: (2.36, 0.16), 8: (0.18, 0.15)})
    original = copy.deepcopy(state)
    preview, calls = planner._preview, []

    def counted(*args, **kwargs):
        calls.append(1)
        return preview(*args, **kwargs)

    monkeypatch.setattr(planner, "_preview", counted)
    choices = planner.plan_shots(state, max_trials=16, budget_seconds=None)
    assert len(calls) <= 16
    runout = next(s for s in choices if s["evidence"].get("runout"))
    assert runout["evidence"]["lookaheadDepth"] == 3
    assert len(runout["evidence"]["continuation"]) == 2
    replay = state
    for action in [runout, *runout["evidence"]["continuation"]]:
        result = preview(replay, action, None, keep_state=True)
        assert result["evidence"]["legal"] and result["evidence"]["continues"]
        replay = result["_state"]
    assert replay.winner == original.current
    assert state == original


def test_zero_budget_never_invents_advanced_or_runout_evidence():
    state = layout({0: (0.5, 0.635), 1: (1.4, 0.635), 9: (0.85, 0.635), 8: (2, 0.3)})
    choice = plan_shots(state, budget_seconds=0)[0]
    assert not choice["evidence"]["verified"]
    assert not choice["evidence"].get("runout")
