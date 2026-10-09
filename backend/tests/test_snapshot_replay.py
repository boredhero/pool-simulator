"""Published snapshots must replay from the same state used by the server."""

import json
import math
from dataclasses import asdict
from pathlib import Path

from app.net.rooms import Room, ball_dump
from app.sim.physics import DT, Ball, ShotEvents, all_asleep, simulate_shot, step, strike
from app.sim.rules import apply_shot, begin_shot, new_game

FIXTURES = json.loads((Path(__file__).parents[2] / "contracts/snapshot-replay.json").read_text())


def replay(balls, shot):
    strike(
        balls[0],
        math.cos(shot["aim"]),
        math.sin(shot["aim"]),
        shot["power"],
        shot["tipX"],
        shot["tipY"],
        shot["vmax"],
        shot["elevation"],
    )
    return simulate_shot(balls, 0)


def test_snapshot_json_roundtrip_preserves_every_physics_field_exactly():
    ball = Ball(
        id=1,
        n=7,
        x=0.02857500000001,
        y=1.123456789012345,
        z=0.0123456789012345,
        vx=0.123456789012345,
        vy=-1.123456789012345,
        vz=0.234567890123456,
        wx=-4.56789012345678,
        wy=3.45678901234567,
        wz=-2.34567890123456,
        asleep=False,
    )
    assert json.loads(json.dumps(ball_dump([ball]))) == [asdict(ball)]


def test_full_precision_snapshot_replay_has_no_false_pocket_then_resurrection():
    fixture = FIXTURES["precisionBreak"]
    gs = new_game(1)
    gs.balls = [Ball(**b) for b in fixture["balls"]]
    published = json.loads(json.dumps(Room(code="REPLAY", gs=gs).state_msg()))
    copied = [Ball(**b) for b in published["balls"]]
    assert [asdict(b) for b in copied] == [asdict(b) for b in gs.balls]
    original_events = replay(gs.balls, fixture["shot"])
    copied_events = replay(copied, fixture["shot"])
    assert copied_events == original_events
    assert original_events.potted == fixture["potted"]
    assert [asdict(b) for b in copied] == [asdict(b) for b in gs.balls]
    # This was the old wire format. Even the same physics implementation
    # pockets a different ball when fed the truncated initial coordinates.
    rounded = [Ball(**b) for b in fixture["balls"]]
    for ball in rounded:
        ball.x, ball.y = round(ball.x, 5), round(ball.y, 5)
    assert replay(rounded, fixture["shot"]).potted == fixture["roundedPotted"]


def test_sequential_object_pockets_stay_down_through_rules_and_public_snapshot():
    fixture = FIXTURES["sequentialPots"]
    gs = new_game(1)
    gs.balls = [Ball(**b) for b in fixture["balls"]]
    gs.break_shot = False
    begin_shot(gs)
    # The fixture begins after the cue's contact, as the first object rolls
    # toward a second object near the corner mouth.
    events = ShotEvents(first_contact=1)
    contact, pocket_steps = {"v": True}, []
    for tick in range(2400):
        before = len(events.potted)
        step(gs.balls, DT, events, 0, contact)
        if len(events.potted) > before:
            pocket_steps.append(tick)
        if all_asleep(gs.balls):
            break
    assert events.potted == fixture["potted"]
    assert pocket_steps == fixture["pocketSteps"]
    apply_shot(gs, events)
    state = json.loads(json.dumps(Room(code="TWO", gs=gs).state_msg()))
    assert state["return_order"] == [2, 1]
    assert all(b["potted"] for b in state["balls"] if b["n"] in (1, 2))
    assert gs.current == 0 and not gs.ball_in_hand
