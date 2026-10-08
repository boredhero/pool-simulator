import math

from app.sim.physics import DT, Ball, ShotEvents, all_asleep, step, strike
from app.sim.table import BALL_R


def test_elevated_rebound_and_landing():
    flat, raised = Ball(x=1, y=0.6), Ball(x=1, y=0.6)
    strike(flat, 1, 0, 0.6, 0.2, 0.1)
    strike(raised, 1, 0, 0.6, 0.2, 0.1, 3.5, math.pi / 4)
    assert raised.vz > 0.5 and raised.vx < flat.vx and raised.wx != flat.wx
    apex, ev = 0, ShotEvents()
    for _ in range(2400):
        step([raised], DT, ev, 0, {"v": False})
        apex = max(apex, raised.z)
        assert raised.z >= 0
        if all_asleep([raised]):
            break
    assert apex > 0.01 and raised.z == 0 and raised.vz == 0 and raised.asleep


def test_airborne_clearance():
    a, b = Ball(x=1, y=0.6, z=0.15, vx=2, asleep=False), Ball(id=1, n=1, x=1.08, y=0.6)
    ev = ShotEvents()
    for _ in range(20):
        step([a, b], DT, ev, 0, {"v": False})
    assert a.x > b.x and ev.first_contact is None and b.asleep


def test_low_airborne_collision():
    a, b = Ball(x=1, y=0.6, z=0.025, vx=2, asleep=False), Ball(id=1, n=1, x=1.065, y=0.6)
    ev = ShotEvents()
    for _ in range(12):
        step([a, b], DT, ev, 0, {"v": False})
    assert ev.first_contact == 1 and b.vx > 0
    assert math.dist((a.x, a.y, a.z), (b.x, b.y, b.z)) >= 2 * BALL_R - 1e-6


def test_resting_sidespin_does_not_delay_turn():
    b = Ball(x=1, y=0.6, wz=180, asleep=False)
    step([b], DT, ShotEvents(), 0, {"v": False})
    assert b.asleep


def test_shared_flight_fixtures():
    import json
    from pathlib import Path

    fixtures = json.loads(
        (Path(__file__).parents[2] / "contracts/flight-fixtures.json").read_text()
    )
    for f in fixtures:
        b = Ball(x=1, y=0.6)
        strike(b, 1, 0, 0.7, f["tipX"], f["tipY"], 3.5, f["elevation"])
        ev = ShotEvents()
        for _ in range(f["frames"]):
            step([b], DT, ev, 0, {"v": False})
        for k, v in f["expected"].items():
            assert abs(getattr(b, k) - v) < 1e-7
