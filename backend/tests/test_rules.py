import json
from pathlib import Path

import pytest

from app.sim.physics import ShotEvents
from app.sim.rules import apply_shot, begin_shot, new_game, place_cue

FIXTURES = json.loads((Path(__file__).parents[2] / "contracts/rules-fixtures.json").read_text())
KEYS = {
    "returnOrder": "return_order",
    "breakShot": "break_shot",
    "ballInHand": "ball_in_hand",
    "kitchenShot": "kitchen_shot",
    "firstContact": "first_contact",
    "offTable": "off_table",
    "railAfterContact": "rail_after_contact",
    "cuePotted": "cue_potted",
    "firstContactX": "first_contact_x",
    "cueLeftKitchen": "cue_left_kitchen",
    "objectRails": "object_rails",
}


@pytest.mark.parametrize("case", FIXTURES, ids=lambda c: c["name"])
def test_shared_rules(case):
    gs = new_game(1, {"preset": case.get("preset", "bar")})
    for k, v in case["state"].items():
        setattr(gs, KEYS.get(k, k), v)
    for b in gs.balls:
        if b.n in case.get("pottedBefore", []):
            b.potted = True
    begin_shot(gs, *case.get("call", [None, None]))
    ev = ShotEvents(**{KEYS.get(k, k): v for k, v in case["ev"].items()})
    for b in gs.balls:
        if b.n is not None and (b.n in ev.potted or b.n in ev.off_table):
            b.potted = True
    apply_shot(gs, ev)
    for k, v in case["expected"].items():
        assert getattr(gs, KEYS.get(k, k)) == v
    for n in case.get("respot", []):
        assert not next(b for b in gs.balls if b.n == n).potted


def test_placement_policy():
    gs = new_game()
    assert not place_cue(gs, 0.3, 0.6)
    gs.ball_in_hand, gs.placement = True, "kitchen"
    assert not place_cue(gs, 0.635, 0.6)
    assert not place_cue(gs, float("nan"), 0.6)
    assert not place_cue(gs, gs.balls[1].x, gs.balls[1].y)
    assert place_cue(gs, 0.3, 0.6)
    assert gs.kitchen_shot and not gs.ball_in_hand


def test_bar_soft_dry_break_keeps_layout_and_passes_open_table():
    gs = new_game()
    begin_shot(gs)
    gs.balls[1].x, gs.balls[1].y = 0.8, 0.3
    layout = [(b.x, b.y) for b in gs.balls]
    apply_shot(gs, ShotEvents(first_contact=1, rail_after_contact=True, object_rails=[1]))
    assert [(b.x, b.y) for b in gs.balls] == layout
    assert gs.current == 1 and gs.open and not gs.break_shot and not gs.ball_in_hand
    begin_shot(gs)
    apply_shot(gs, ShotEvents(first_contact=2, rail_after_contact=True))
    assert gs.current == 0 and gs.open
    assert [(b.x, b.y) for b in gs.balls] == layout
