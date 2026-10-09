"""A collision into a rail-frozen object must not tunnel through the cushion."""

import pytest

from app.sim.physics import DT, Ball, ShotEvents, step
from app.sim.table import BALL_R, TABLE_H, TABLE_W

RAILS = [
    (1.0, BALL_R, 0, 1),
    (1.0, TABLE_H - BALL_R, 0, -1),
    (BALL_R, 0.6, 1, 0),
    (TABLE_W - BALL_R, 0.6, -1, 0),
]


@pytest.mark.parametrize("x,y,nx,ny", RAILS)
@pytest.mark.parametrize("penetration", [1e-12, 1e-6, 1e-4])
def test_grounded_object_recovers_cushion_overlap(x, y, nx, ny, penetration):
    ball = Ball(
        id=1,
        n=1,
        x=x - nx * penetration,
        y=y - ny * penetration,
        vx=-nx,
        vy=-ny,
        asleep=False,
    )
    events = ShotEvents()
    step([ball], DT, events, 0, {"v": True})
    assert ball.vx * nx + ball.vy * ny > 0
    assert (ball.x - x) * nx + (ball.y - y) * ny >= -1e-12
    assert ball.z == 0 and events.rail_after_contact
    for _ in range(240):
        step([ball], DT, events, 0, {"v": True})
    assert not ball.potted and not events.off_table


@pytest.mark.parametrize("x,y,nx,ny", RAILS)
def test_ball_collision_cannot_push_rail_frozen_object_through_wall(x, y, nx, ny):
    cue = Ball(
        x=x + nx * (2 * BALL_R - 1e-6),
        y=y + ny * (2 * BALL_R - 1e-6),
        vx=-nx,
        vy=-ny,
        asleep=False,
    )
    obj = Ball(id=1, n=1, x=x, y=y)
    events, contact = ShotEvents(), {"v": False}
    for _ in range(240):
        step([cue, obj], DT, events, 0, contact)
        assert (obj.x - x) * nx + (obj.y - y) * ny >= -1e-9
        assert obj.z == 0 and not obj.potted
    assert events.first_contact == 1 and events.rail_after_contact
    assert not events.off_table


@pytest.mark.parametrize("x,y,nx,ny", RAILS)
def test_object_clearing_rail_still_jumps_off_table(x, y, nx, ny):
    ball = Ball(
        id=1,
        n=1,
        x=x - nx * 1e-6,
        y=y - ny * 1e-6,
        z=0.1,
        vx=-4 * nx,
        vy=-4 * ny,
        asleep=False,
    )
    events = ShotEvents()
    step([ball], DT, events, 0, {"v": True})
    assert ball.z > 0.05 and ball.vx * nx + ball.vy * ny < 0
    assert not events.rail_after_contact
    for _ in range(24):
        step([ball], DT, events, 0, {"v": True})
    assert events.off_table == [1]
