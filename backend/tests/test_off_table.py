import json
import math
from pathlib import Path

import pytest

from app.sim.cue import cue_elevation
from app.sim.physics import DT, Ball, ShotEvents, all_asleep, step, strike
from app.sim.rules import apply_shot, begin_shot, new_game
from app.sim.table import BALL_R, jaws

CONTRACTS = Path(__file__).parents[2] / "contracts"


@pytest.mark.parametrize(
    "case", json.loads((CONTRACTS / "off-table-rules.json").read_text()), ids=lambda c: c["name"]
)
def test_off_table_rules(case):
    gs = new_game(42, {"preset": case["preset"]})
    gs.break_shot = case["breakShot"]
    gs.open = False
    gs.groups = ["solid", "stripe"]
    if case.get("onEight"):
        for b in gs.balls:
            if b.n in range(1, 8):
                b.potted = True
    begin_shot(gs, 8 if case.get("onEight") else 2, 0)
    for b in gs.balls:
        if b.n == case["off"] or b.n in case["potted"]:
            b.potted = True
    ev = ShotEvents(
        first_contact=8 if case.get("onEight") else 1,
        off_table=[case["off"]],
        potted=case["potted"],
        rail_after_contact=True,
        pockets=[{"n": n, "pocket": 0} for n in case["potted"]],
    )
    apply_shot(gs, ev)
    assert gs.winner == case["winner"]
    assert gs.placement == case["placement"]
    if gs.winner is None:
        assert gs.current == 1 and gs.ball_in_hand and not gs.break_shot
    for n in case["removed"]:
        assert n in gs.return_order
        assert next(b for b in gs.balls if b.n == n).potted
    for n in case["respot"]:
        assert not next(b for b in gs.balls if b.n == n).potted


@pytest.mark.parametrize(
    "case", json.loads((CONTRACTS / "off-table-flight.json").read_text()), ids=lambda c: c["name"]
)
def test_production_clearance_departure(case):
    b = Ball(x=case["x"], y=case["y"])
    angle = -case["aim"] if case["mirrorY"] else case["aim"]
    elevation = cue_elevation(b.x, b.y, angle, 0, [b])
    strike(b, math.cos(angle), math.sin(angle), case["power"], 0, 0, case["vmax"], elevation)
    ev, contact = ShotEvents(), {"v": False}
    for _ in range(5000):
        step([b], DT, ev, 0, contact)
        if all_asleep([b]):
            break
    assert all_asleep([b])
    assert ev.off_table == ([None] if case["off"] else [])
    assert ev.cue_potted == case["off"]
    assert not ev.potted


def test_descending_ball_above_overlapped_jaw_does_not_hit_phantom_wall():
    x, y, r = jaws()[0]
    b = Ball(x=x + BALL_R + r - 0.002, y=y, z=0.08, vz=-0.1, vx=-0.2, asleep=False)
    ev = ShotEvents()
    step([b], DT, ev, 0, {"v": False})
    assert b.vx < 0 and b.z > 0.05
    assert not ev.off_table and not ev.cue_potted
