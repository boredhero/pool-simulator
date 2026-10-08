import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.main import app
from app.models.db import GameMatch, MatchPlayer, MatchShot, Session
from app.net.rooms import Room, lobby
from app.services.matches import record_shot, start_match
from app.sim.physics import ShotEvents
from app.sim.rules import apply_shot, begin_shot, new_game


def pair(w1, w2, rules=None):
    w1.send_json({"t": "create", "name": "A", "rules": rules or {"preset": "bar"}})
    r1 = w1.receive_json()
    assert len(r1["code"]) == 8 and not r1["state"]["ready"]
    w2.send_json({"t": "join", "code": r1["code"], "name": "B"})
    r2 = w2.receive_json()
    assert r2["you"] == 1 and r2["state"]["names"] == ["A", "B"]
    assert w1.receive_json()["t"] == "joined"
    assert w1.receive_json()["ready"]
    assert w2.receive_json()["ready"]
    return r1["code"]


def test_guest_create_join_and_server_result_without_done():
    with (
        TestClient(app).websocket_connect("/ws") as w1,
        TestClient(app).websocket_connect("/ws") as w2,
    ):
        code = pair(w1, w2)
        w1.send_json(
            {"t": "shot", "revision": 0, "shot": {"aim": 0, "power": 0.2, "tipX": 0, "tipY": 0}}
        )
        assert w1.receive_json()["t"] == "shot"
        assert w2.receive_json()["t"] == "shot"
        # No client acknowledgement is necessary to commit results and statistics.
        result = w1.receive_json()
        assert result["t"] == "result" and result["revision"] == 1
        assert w2.receive_json()["t"] == "result"
        w1.send_json({"t": "done", "ev": {"potted": [8]}})
        with Session() as db:
            assert db.query(MatchShot).count() == 1
            assert db.query(MatchPlayer).filter_by(seat=0).one().shots == 1
            assert db.query(GameMatch).one().winner_seat is None
        w1.send_json({"t": "create"})
        assert "Leave" in w1.receive_json()["error"]
        assert len(lobby.rooms) == 1
    assert code not in lobby.rooms
    with Session() as db:
        assert db.query(GameMatch).one().status == "forfeit"


def test_bad_code_waiting_room_and_cross_origin():
    with TestClient(app).websocket_connect("/ws") as ws:
        ws.send_json({"t": "join", "code": "ZZZZZZZZ"})
        assert ws.receive_json()["t"] == "error"
        ws.send_json({"t": "create"})
        assert ws.receive_json()["you"] == 0
        ws.send_json({"t": "shot", "revision": 0, "shot": {"aim": 0, "power": 0.1}})
        assert "Waiting" in ws.receive_json()["error"]
    with pytest.raises(WebSocketDisconnect):
        with TestClient(app).websocket_connect("/ws", headers={"Origin": "https://evil.example"}):
            pass


def test_room_rules_revision_and_authoritative_calls():
    with (
        TestClient(app).websocket_connect("/ws") as ws,
        TestClient(app).websocket_connect("/ws") as other,
    ):
        code = pair(ws, other, {"preset": "custom", "calls": "all", "normalMax": 4.2})
        room = lobby.get(code)
        assert room.gs.rules["normalMax"] == 4.2
        ws.send_json({"t": "shot", "revision": 1, "shot": {"aim": 0, "power": 0.5}})
        assert ws.receive_json()["error"] == "stale table state"
        assert ws.receive_json()["revision"] == 0
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
        assert shot["elevation"] < 0.2 and shot["vmax"] == 4.2
        assert ws.receive_json()["t"] == "result"


def test_room_state_carries_capture_order():
    gs = new_game()
    gs.break_shot = False
    begin_shot(gs)
    for n in [12, 3, 10]:
        next(b for b in gs.balls if b.n == n).potted = True
    apply_shot(gs, ShotEvents(first_contact=3, potted=[12, 3, 10], rail_after_contact=True))
    assert Room(code="TEST", gs=gs).state_msg()["return_order"] == [12, 3, 10]


def test_registered_identity_and_authoritative_lifetime_stats():
    client = TestClient(app)
    response = client.post(
        "/api/account/register",
        headers={"X-Pool-Request": "1"},
        json={"username": "ActualPlayer", "password": "long secure pool password"},
    )
    account = response.json()["account"]
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"t": "create", "name": "Spoofed", "account_id": "invented"})
        state = ws.receive_json()["state"]
        assert state["names"][0] == "ActualPlayer"
        assert state["registered"] == [True, False]
        assert lobby.get(state["code"]).accounts[0] == account["id"]
    match = start_match(["ActualPlayer", "Guest"], [account["id"], None], {"preset": "bar"})
    facts = {"potted": [3, 8], "cue_potted": False, "off_table": []}
    record_shot(match, 1, 0, {"aim": 0}, facts, 0, False)
    record_shot(match, 1, 0, {"aim": 0}, facts, 0, False)
    stats = client.get("/api/account").json()["stats"]
    assert stats["matches"] == stats["wins"] == stats["shots"] == 1
    assert stats["ballsPocketed"] == 2 and stats["losses"] == 0


def test_restart_marks_active_matches_interrupted_without_awarding_wins():
    from app.services.matches import interrupt_matches

    match_id = start_match(["A", "B"], [None, None], {"preset": "bar"})
    interrupt_matches()
    with Session() as db:
        match = db.get(GameMatch, match_id)
        assert match.status == "interrupted" and match.winner_seat is None


@pytest.mark.parametrize(
    "payload",
    [
        {"t": []},
        {"t": "shot", "revision": True, "shot": {}},
        {"t": "shot", "revision": 0, "shot": []},
        {"t": "shot", "revision": 0, "shot": {"aim": float("nan"), "power": 1}},
        {"t": "shot", "revision": 0, "shot": {"aim": 0, "power": True}},
        {"t": "place", "revision": 0, "x": float("inf"), "y": 1},
    ],
)
def test_malformed_messages_cannot_mutate_or_close_a_room(payload):
    with TestClient(app).websocket_connect("/ws") as ws:
        ws.send_json({"t": "create"})
        code = ws.receive_json()["code"]
        ws.send_text(__import__("json").dumps(payload))
        assert ws.receive_json()["error"] == "Invalid message fields"
        assert not lobby.get(code).closed and lobby.get(code).revision == 0


def test_message_flood_is_disconnected():
    with TestClient(app).websocket_connect("/ws") as ws:
        for _ in range(30):
            ws.send_json({"t": "unknown"})
            assert ws.receive_json()["t"] == "error"
        ws.send_json({"t": "unknown"})
        with pytest.raises(WebSocketDisconnect):
            ws.receive_json()


def test_forfeit_stats_and_server_interruption_are_distinct():
    from app.services.matches import abandon_match

    match = start_match(["A", "B"], [None, None], {"preset": "bar"})
    abandon_match(match, 0, started=True)
    abandon_match(match, 1, started=True)
    with Session() as db:
        game = db.get(GameMatch, match)
        assert game.status == "forfeit" and game.winner_seat == 1
    match = start_match(["A", "B"], [None, None], {"preset": "custom"})
    abandon_match(match, 0, started=True, interrupted=True)
    with Session() as db:
        game = db.get(GameMatch, match)
        assert game.status == "interrupted" and game.winner_seat is None


def test_client_close_code_cannot_impersonate_server_shutdown():
    with TestClient(app) as client:
        with client.websocket_connect("/ws") as ws, client.websocket_connect("/ws") as other:
            room = lobby.get(pair(ws, other))
            room.started = True
            match_id = room.match_id
            ws.close(code=1012)
            assert other.receive_json()["t"] == "left"
            with Session() as db:
                assert db.get(GameMatch, match_id).status == "forfeit"


def test_casual_forfeit_counts_loss_and_cannot_be_recorded_twice():
    from app.services.matches import abandon_match, account_stats

    client = TestClient(app)
    import secrets

    response = client.post(
        "/api/account/register",
        headers={"X-Pool-Request": "1"},
        json={"username": "ForfeitPlayer", "password": secrets.token_urlsafe(24)},
    )
    account = response.json()["account"]["id"]
    match = start_match(["Player", "Guest"], [account, None], {"preset": "custom"})
    abandon_match(match, 0, started=True)
    abandon_match(match, 1, started=True)
    stats = account_stats(account)
    assert stats["losses"] == stats["matches"] == stats["abandoned"] == 1
    assert stats["wins"] == 0 and stats["ranked"] is False
    assert stats["category"] == "casual"


def test_production_shutdown_marks_draining_before_socket_cleanup(monkeypatch):
    import signal

    import uvicorn

    from app.server import PoolServer

    server = PoolServer(uvicorn.Config(app))
    monkeypatch.setattr(lobby, "draining", False)
    server.handle_exit(signal.SIGTERM, None)
    assert lobby.draining and server.should_exit


def test_connection_cap_releases_slots_on_disconnect():
    from contextlib import ExitStack

    with TestClient(app) as client:
        with ExitStack() as stack:
            for _ in range(8):
                stack.enter_context(client.websocket_connect("/ws"))
            with pytest.raises(WebSocketDisconnect):
                with client.websocket_connect("/ws"):
                    pass
        with client.websocket_connect("/ws") as ws:
            ws.send_json({"t": "create"})
            assert ws.receive_json()["t"] == "room"


def test_simulation_capacity_rejects_shot_without_mutation(monkeypatch):
    with TestClient(app) as client:
        with client.websocket_connect("/ws") as ws, client.websocket_connect("/ws") as other:
            room = lobby.get(pair(ws, other))
            monkeypatch.setattr(lobby, "simulations", 4)
            ws.send_json({"t": "shot", "revision": 0, "shot": {"aim": 0, "power": 0.5}})
            assert "busy" in ws.receive_json()["error"]
            assert not room.started and room.revision == 0 and not room.busy
