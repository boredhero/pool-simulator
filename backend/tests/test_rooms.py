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
