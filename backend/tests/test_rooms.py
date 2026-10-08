from fastapi.testclient import TestClient

from app.main import app

c1 = TestClient(app)
c2 = TestClient(app)


def test_create_join_shot_flow():
    with c1.websocket_connect("/ws") as w1, c2.websocket_connect("/ws") as w2:
        w1.send_json({"t": "create", "name": "A"})
        r1 = w1.receive_json()
        assert r1["t"] == "room" and r1["you"] == 0
        code = r1["code"]
        assert len(code) == 4
        assert len(r1["state"]["balls"]) == 16
        assert r1["state"]["return_order"] == []

        w2.send_json({"t": "join", "code": code, "name": "B"})
        r2 = w2.receive_json()
        assert r2["you"] == 1
        assert w1.receive_json()["t"] == "joined"  # join notice
        s1 = w1.receive_json()  # state broadcast
        assert s1["t"] == "state" and len(s1["balls"]) == 16
        assert w2.receive_json()["t"] == "state"  # state broadcast

        # Player 0 shoots soft straight up-table (likely misses everything -> turn passes).
        w1.send_json({"t": "shot", "shot": {"aim": 0.0, "power": 0.2, "tipX": 0, "tipY": 0}})
        assert w1.receive_json()["t"] == "shot"  # echo first (sequential reads)
        m = w2.receive_json()
        assert m["t"] == "shot" and m["by"] == 0

        # Shooter reports rest state (reuse server-sent state balls).
        w1.send_json(
            {
                "t": "done",
                "balls": s1["balls"],
                "ev": {
                    "first_contact": None,
                    "potted": [],
                    "off_table": [],
                    "rail_after_contact": False,
                    "cue_potted": False,
                },
            }
        )
        res = w1.receive_json()
        assert res["t"] == "result"
        assert w2.receive_json()["t"] == "result"
        # Client ev (a whiff) mismatches the server sim (straight into the rack),
        # so the server corrects: turn/rules outcomes are unit-tested in test_rules.
        assert res["corrected"] is True
        assert res["current"] in (0, 1) and isinstance(res["message"], str)


def test_bad_code_and_turn_order():
    with c1.websocket_connect("/ws") as w1:
        w1.send_json({"t": "join", "code": "ZZZZ"})
        assert w1.receive_json()["t"] == "error"
        w1.send_json({"t": "create"})
        r = w1.receive_json()
        assert r["you"] == 0
        # Solo player shoots (allowed, no opponent yet).
        w1.send_json({"t": "shot", "shot": {"aim": 0.0, "power": 0.1, "tipX": 0, "tipY": 0}})
        assert w1.receive_json()["t"] == "shot"


def test_room_rules_revision_and_authoritative_calls():
    with c1.websocket_connect("/ws") as ws:
        ws.send_json(
            {"t": "create", "rules": {"preset": "custom", "calls": "all", "normalMax": 4.2}}
        )
        msg = ws.receive_json()
        state = msg["state"]
        assert state["rules"]["normalMax"] == 4.2
        assert state["ruleset"] == {"id": "eight-ball", "version": 1}
        assert state["break_shot"] and state["placement"] == "none"
        ws.send_json({"t": "shot", "revision": -1, "shot": {"aim": 0, "power": 0.5}})
        assert ws.receive_json()["error"] == "stale table state"
        assert ws.receive_json()["revision"] == 0
        from app.net.rooms import lobby

        room = lobby.get(msg["code"])
        room.gs.break_shot = False
        ws.send_json({"t": "shot", "revision": 0, "shot": {"aim": 0, "power": 0.5}})
        assert ws.receive_json()["error"] == "call a legal ball and pocket"
        ws.send_json(
            {
                "t": "shot",
                "revision": 0,
                "shot": {
                    "aim": 0,
                    "power": 0.2,
                    "calledBall": 1,
                    "calledPocket": 2,
                    "elevation": 1.5,
                },
            }
        )
        shot = ws.receive_json()["shot"]
        assert shot["elevation"] < 0.2  # Server derives clearance, ignoring invented angle.
        assert shot["vmax"] == 4.2
        ws.send_json({"t": "done", "ev": {"potted": [8]}})
        result = ws.receive_json()
        assert result["revision"] == 1
        assert result["winner"] is None  # Fake client 8-Ball event cannot decide the match.


def test_room_state_carries_capture_order_for_joining_players():
    from app.net.rooms import Room
    from app.sim.physics import ShotEvents
    from app.sim.rules import apply_shot, begin_shot, new_game

    gs = new_game()
    gs.break_shot = False
    begin_shot(gs)
    for n in [12, 3, 10]:
        next(b for b in gs.balls if b.n == n).potted = True
    apply_shot(gs, ShotEvents(first_contact=3, potted=[12, 3, 10], rail_after_contact=True))
    assert Room(code="TEST", gs=gs).state_msg()["return_order"] == [12, 3, 10]
