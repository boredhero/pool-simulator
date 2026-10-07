import time

from app.sim.physics import (
    Ball,
    ShotEvents,
    all_asleep,
    hash_state,
    simulate_shot,
    step,
)
from app.sim.table import TABLE_H


def _ev() -> ShotEvents:
    return ShotEvents()


def _cm() -> dict:
    return {"v": False}


def _ball(i: int, n, x: float, y: float) -> Ball:
    b = Ball(id=i, n=n, x=x, y=y)
    b.asleep = False
    return b


def test_head_on_transfer():
    cue, obj = _ball(0, None, 0.5, TABLE_H / 2), _ball(1, 1, 0.7, TABLE_H / 2)
    cue.vx = 2.0
    balls = [cue, obj]
    for _ in range(240):
        step(balls, 1 / 240, _ev(), 0, _cm())
        if abs(obj.vx) + abs(obj.vy) > 0.5:
            break
    assert abs(cue.vx) < 0.2
    assert obj.vx > 1.5


def test_cushion_45():
    import math

    b = _ball(0, None, 0.6, 0.4)
    b.vx, b.vy = 1.0, -1.0
    v0 = math.hypot(b.vx, b.vy)
    balls = [b]
    for _ in range(240):
        step(balls, 1 / 240, _ev(), 0, _cm())
        if b.vy > 0:
            break
    assert b.vy > 0
    ang = math.degrees(math.atan2(abs(b.vy), abs(b.vx)))
    assert abs(ang - 45) < 5
    assert 0.6 < math.hypot(b.vx, b.vy) / v0 < 0.99


def test_determinism_and_sleep():
    def mk():
        cue = _ball(0, None, 0.635, TABLE_H / 2)
        cue.vx, cue.wz = 3.0, 10.0
        return [cue, _ball(1, 9, 1.2, TABLE_H / 2 + 0.05)]

    a, b = mk(), mk()
    simulate_shot(a, 0)
    simulate_shot(b, 0)
    assert hash_state(a) == hash_state(b)
    assert all_asleep(a)


def test_break_no_tunnel_fast():
    from app.sim.rules import new_game

    gs = new_game(7)
    cue = gs.balls[0]
    cue.asleep = False
    cue.vx = 8.0
    t0 = time.time()
    ev = simulate_shot(gs.balls, 0)
    dt = time.time() - t0
    assert ev.first_contact is not None
    assert dt < 10, f"sim too slow: {dt:.2f}s"
    for i, a in enumerate(gs.balls):
        for c in gs.balls[i + 1 :]:
            if not a.potted and not c.potted:
                assert ((a.x - c.x) ** 2 + (a.y - c.y) ** 2) ** 0.5 >= 2 * 0.028575 - 1e-6
    assert all_asleep(gs.balls)


def test_pocket_capture():
    b = _ball(0, None, 0.3, 0.05)
    b.vx, b.vy = -1.0, -0.15
    balls = [b]
    for _ in range(240 * 5):
        step(balls, 1 / 240, _ev(), 0, _cm())
        if all_asleep(balls):
            break
    assert b.potted
