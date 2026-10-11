"""Geometric pocket termination after shelf traversal, without speed-based capture."""

import math

import pytest

from app.sim.physics import BALL_R, DT, Ball, ShotEvents, simulate_shot, step
from app.sim.table import CORNER_HALF, CORNER_SHELF, POCKETS, SIDE_SHELF, TABLE_W


def run(ball, dt=DT, seconds=2):
    events, contact = ShotEvents(), {"v": False}
    for _ in range(math.ceil(seconds / dt)):
        step([ball], dt, events, 0, contact)
        if ball.potted or ball.asleep:
            break
    return events


def test_actual_slate_cut_matches_mouth_and_selected_shelf():
    assert math.sqrt(2) * CORNER_HALF == pytest.approx(0.1143)
    px, py, r, _ = POCKETS[0]
    lip = (px + py) / math.sqrt(2) + r
    assert 0.1143 / 2 - lip == pytest.approx(CORNER_SHELF)
    assert -POCKETS[1][1] - POCKETS[1][2] == pytest.approx(SIDE_SHELF)


@pytest.mark.parametrize("speed", [0.5, 1, 3, 7])
def test_center_entries_score_once(speed):
    b = Ball(id=1, n=1, x=TABLE_W / 2, y=0.04, vy=-speed, asleep=False)
    ev = run(b)
    assert ev.potted == [1]
    assert ev.off_table == []
    run(b)
    assert ev.potted == [1]


def test_hanger_on_shelf_is_not_pulled_into_pocket():
    b = Ball(id=1, n=1, x=TABLE_W / 2, y=0.002, asleep=False)
    ev = run(b)
    assert not ev.potted
    assert b.y == 0.002
    assert b.z == 0


def test_stationary_ball_cannot_hover_over_hole():
    p = POCKETS[1]
    b = Ball(id=1, n=1, x=p[0], y=p[1], asleep=False)
    assert simulate_shot([b], 0).potted == [1]


def test_airborne_ball_can_cross_pocket_without_capture():
    b = Ball(id=1, n=1, x=TABLE_W / 2, y=0.04, z=0.18, vy=-3, asleep=False)
    ev = ShotEvents()
    for _ in range(10):
        step([b], DT, ev, 0, {"v": False})
    assert not b.potted and not ev.potted and b.z > 0.1


def test_geometric_capture_converges_when_outer_step_halved():
    def fall(dt):
        b = Ball(id=1, n=1, x=TABLE_W / 2, y=0.01, vy=-1, asleep=False)
        ev = run(b, dt, 0.1)
        return b, ev

    a, ea = fall(DT)
    b, eb = fall(DT / 2)
    assert ea.potted == eb.potted
    assert a.y == pytest.approx(b.y, abs=0.001)
    assert a.z == pytest.approx(b.z, abs=0.001)


@pytest.mark.parametrize("offset,speed,depth", [(0.045, 1, 0.02)])
def test_existing_incoming_jaw_rejections_remain_live_without_energy_gain(offset, speed, depth):
    b = Ball(id=1, n=1, x=TABLE_W / 2 + offset, y=0.08, vy=-speed, asleep=False)
    ev, contact = ShotEvents(), {"v": False}
    minimum_y = 0.08
    returned = False
    for _ in range(1200):
        step([b], DT, ev, 0, contact)
        minimum_y = min(minimum_y, b.y)
        energy = (
            b.vx**2
            + b.vy**2
            + b.vz**2
            + 0.4 * BALL_R**2 * (b.wx**2 + b.wy**2 + b.wz**2)
            + 2 * 9.81 * b.z
        )
        assert energy <= speed**2 + 1e-5
        if b.vy > 0 and b.y > 0.08:
            returned = True
            break
    assert minimum_y < depth
    assert returned and not b.potted and ev.potted == []


def test_two_arrivals_in_same_pocket_score_once_each():
    balls = [
        Ball(id=1, n=1, x=TABLE_W / 2 - 0.01, y=0.04, vy=-1, asleep=False),
        Ball(id=2, n=2, x=TABLE_W / 2 + 0.01, y=0.13, vy=-1.2, asleep=False),
    ]
    ev, contact = ShotEvents(), {"v": False}
    for _ in range(1200):
        step(balls, DT, ev, 0, contact)
        if all(b.potted for b in balls):
            break
    assert sorted(ev.potted) == [1, 2]
    assert len(ev.pockets) == 2
    assert ev.off_table == []
