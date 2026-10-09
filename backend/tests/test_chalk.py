"""Account access and authoritative Chalk-Sim actions, without model calls for chalking."""

import json
from dataclasses import asdict

import pytest
from fastapi.testclient import TestClient

from app.api import jev
from app.main import app
from app.models.db import Account, GameMatch, JevGame, JevRequest, MatchShot, Session
from app.net.rooms import lobby
from app.services.terms import terms_version
from app.sim.chalk import wear

HEADERS = {"X-Pool-Request": "1"}
PASSWORD = "a long chalk testing password"


@pytest.fixture
def socket_client():
    # A room broadcasts between sockets. They must share one lifespan portal;
    # separate TestClient portals can deadlock their cross-loop memory streams.
    with TestClient(app) as client:
        yield client


def register(client, name="chalkplayer"):
    response = client.post(
        "/api/account/register",
        headers=HEADERS,
        json={
            "username": name,
            "password": PASSWORD,
            "adult": True,
            "terms_version": terms_version(),
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["account"]


def unlock(client):
    response = client.post("/api/account/easter-eggs/unlock", headers=HEADERS, json={})
    assert response.status_code == 200, response.text
    return response.json()["account"]


def start(client, simulation=""):
    response = client.post(
        "/api/opponents/jev/games",
        headers=HEADERS,
        json={"rules": {"chalkSim": True}, "simulation": simulation},
    )
    assert response.status_code == 200, response.text
    return response.json()


def edit_state(game, **changes):
    with Session.begin() as db:
        row = db.get(JevGame, game["id"])
        state = jev.decode(row.state)
        for name, value in changes.items():
            setattr(state, name, value)
        row.state = json.dumps(asdict(state))


def join(host, other, *, host_chalk=True, join_chalk=False):
    host.send_json({"t": "create", "rules": {"chalkSim": host_chalk}})
    waiting = host.receive_json()
    assert waiting["t"] == "room", waiting
    other.send_json({"t": "join", "code": waiting["code"], "chalkSim": join_chalk})
    joined = other.receive_json()
    assert joined["t"] == "room", joined
    assert host.receive_json()["t"] == "joined"
    for state in (joined["state"], host.receive_json(), other.receive_json()):
        assert state["rules"]["chalkSim"] is (host_chalk or join_chalk)
        assert state["chalk"] == [1.0, 1.0]
    return lobby.get(waiting["code"])


def no_model_calls(monkeypatch):
    def forbidden(*args, **kwargs):
        pytest.fail("Chalking/CPU actions must not reserve allowance or call Jev")

    monkeypatch.setattr(jev, "evaluate", forbidden)
    monkeypatch.setattr(jev.jev_budget, "reserve", forbidden)


def assert_no_usage():
    with Session() as db:
        assert db.query(JevRequest).count() == 0
        for game in db.query(JevGame):
            assert game.requests == game.input_tokens == game.output_tokens == 0
            assert game.estimated_cost_nano == game.unmetered_requests == 0


def test_unlock_does_not_enable_chalk_and_preferences_follow_account_across_devices():
    first, second, other = TestClient(app), TestClient(app), TestClient(app)
    account = register(first)
    assert not account["easterEggsEnabled"] and not account["chalkSim"]
    assert (
        first.post("/api/account/preferences", headers=HEADERS, json={"chalkSim": True}).status_code
        == 403
    )
    unlocked = unlock(first)
    assert unlocked["easterEggsEnabled"] and not unlocked["chalkSim"]
    assert first.post("/api/account/preferences", headers=HEADERS, json={"chalkSim": True}).json()[
        "account"
    ]["chalkSim"]
    login = second.post(
        "/api/account/login",
        headers=HEADERS,
        json={"username": "chalkplayer", "password": PASSWORD},
    )
    assert login.status_code == 200, login.text
    assert second.get("/api/account").json()["account"]["chalkSim"]
    settings = {"pool:felt": "#336644", "pool:sights": "diamonds", "pool:auto-camera": "0"}
    saved = first.post("/api/account/preferences", headers=HEADERS, json={"settings": settings})
    assert saved.status_code == 200, saved.text
    assert second.get("/api/account").json()["account"]["settings"] == settings
    changed = second.post(
        "/api/account/preferences",
        headers=HEADERS,
        json={"settings": {"pool:sights": "squares"}},
    )
    assert changed.status_code == 200, changed.text
    assert first.get("/api/account").json()["account"]["settings"] == {
        **settings,
        "pool:sights": "squares",
    }
    assert first.get("/api/account").json()["account"]["chalkSim"]
    invalid = second.post(
        "/api/account/preferences",
        headers=HEADERS,
        json={"chalkSim": False, "settings": {"pool:sights": "unknown"}},
    )
    assert invalid.status_code == 422
    assert first.get("/api/account").json()["account"]["chalkSim"]
    other_account = register(other, "otherchalk")
    assert not other_account["easterEggsEnabled"] and not other_account["chalkSim"]
    assert other_account["settings"] == {}
    assert (
        second.post(
            "/api/account/preferences", headers=HEADERS, json={"chalkSim": False}
        ).status_code
        == 200
    )
    assert not first.get("/api/account").json()["account"]["chalkSim"]
    assert first.get("/api/account").json()["account"]["easterEggsEnabled"]


def test_chalk_preferences_require_account_csrf_and_real_booleans():
    client = TestClient(app)
    assert (
        client.post(
            "/api/account/preferences", headers=HEADERS, json={"chalkSim": True}
        ).status_code
        == 401
    )
    register(client)
    unlock(client)
    assert client.post("/api/account/preferences", json={"chalkSim": True}).status_code == 403
    for value in [1, "true"]:
        assert (
            client.post(
                "/api/account/preferences", headers=HEADERS, json={"chalkSim": value}
            ).status_code
            == 422
        )
    assert (
        client.post(
            "/api/account/preferences", headers=HEADERS, json={"chalkSim": None}
        ).status_code
        == 200
    )
    assert not client.get("/api/account").json()["account"]["chalkSim"]


def test_host_chalk_propagates_and_guest_can_only_rechalk_own_idle_turn(socket_client):
    client = socket_client
    register(client)
    unlock(client)
    with (
        client.websocket_connect("/ws") as host,
        client.websocket_connect("/ws", headers={"cookie": ""}) as guest,
    ):
        room = join(host, guest)
        room.gs.chalk = [0.3, 0.2]
        guest.send_json({"t": "chalk", "revision": 0})
        assert guest.receive_json()["error"] == "Cannot chalk now."
        assert room.gs.chalk == [0.3, 0.2] and room.revision == 0
        room.gs.current = 1
        room.busy = True
        guest.send_json({"t": "chalk", "revision": 0})
        assert guest.receive_json()["state"]["busy"]
        room.busy = False
        guest.send_json({"t": "chalk", "revision": 1})
        assert guest.receive_json()["error"] == "stale table state"
        guest.send_json({"t": "chalk", "revision": True})
        assert guest.receive_json()["error"] == "Invalid message fields"
        assert room.gs.chalk == [0.3, 0.2] and room.revision == 0
        guest.send_json({"t": "chalk", "revision": 0})
        for socket in (guest, host):
            state = socket.receive_json()
            assert state["chalk"] == [0.3, 1.0] and state["revision"] == 1
        guest.send_json({"t": "chalk", "revision": 0})
        assert guest.receive_json()["error"] == "stale table state"
        with Session() as db:
            assert db.query(MatchShot).count() == 0
            assert json.loads(db.get(GameMatch, room.match_id).rules)["chalkSim"]


def test_joiner_can_enable_shared_chalk_after_unlocking_on_connected_socket(socket_client):
    client = socket_client
    register(client)
    with (
        client.websocket_connect("/ws", headers={"cookie": ""}) as host,
        client.websocket_connect("/ws") as other,
    ):
        # Refresh authorization at room entry, even if the socket predates unlock.
        unlock(client)
        room = join(host, other, host_chalk=False, join_chalk=True)
        assert room.gs.rules["chalkSim"]
        with Session() as db:
            assert json.loads(db.get(GameMatch, room.match_id).rules)["chalkSim"]


def test_guest_cannot_enable_chalk_for_host_or_joined_room(socket_client):
    with (
        socket_client.websocket_connect("/ws", headers={"cookie": ""}) as host,
        socket_client.websocket_connect("/ws", headers={"cookie": ""}) as guest,
    ):
        host.send_json({"t": "create", "rules": {"chalkSim": True}})
        assert "Unlock" in host.receive_json()["error"]
        host.send_json({"t": "create"})
        code = host.receive_json()["code"]
        guest.send_json({"t": "join", "code": code, "chalkSim": True})
        assert "Unlock" in guest.receive_json()["error"]
        assert not lobby.get(code).gs.rules["chalkSim"]


def test_room_chalk_rejects_waiting_disabled_and_finished_games(socket_client):
    client = socket_client
    register(client)
    unlock(client)
    with client.websocket_connect("/ws") as host:
        host.send_json({"t": "create", "rules": {"chalkSim": True}})
        code = host.receive_json()["code"]
        host.send_json({"t": "chalk", "revision": 0})
        assert host.receive_json()["error"] == "Cannot chalk now."
        with client.websocket_connect("/ws", headers={"cookie": ""}) as guest:
            guest.send_json({"t": "join", "code": code})
            assert guest.receive_json()["t"] == "room"
            assert host.receive_json()["t"] == "joined"
            host.receive_json()
            guest.receive_json()
            room = lobby.get(code)
            room.gs.chalk = [0.2, 0.3]
            room.gs.rules["chalkSim"] = False
            host.send_json({"t": "chalk", "revision": 0})
            assert host.receive_json()["error"] == "Cannot chalk now."
            room.gs.rules["chalkSim"] = True
            room.gs.winner = 0
            host.send_json({"t": "chalk", "revision": 0})
            assert host.receive_json()["error"] == "Cannot chalk now."
            assert room.gs.chalk == [0.2, 0.3] and room.revision == 0


@pytest.mark.parametrize("enabled", [True, False])
def test_room_only_wears_accepted_shots_and_broadcasts_authoritative_chalk(enabled, socket_client):
    client = socket_client
    register(client)
    unlock(client)
    with (
        client.websocket_connect("/ws") as host,
        client.websocket_connect("/ws", headers={"cookie": ""}) as guest,
    ):
        room = join(host, guest, host_chalk=enabled)
        room.gs.chalk = [0.4, 0.7]
        shot = {"aim": 0, "power": 0.1, "tipX": 0.5, "tipY": 0}
        host.send_json({"t": "shot", "revision": 9, "shot": shot})
        assert host.receive_json()["error"] == "stale table state"
        assert room.gs.chalk == [0.4, 0.7]
        host.send_json({"t": "shot", "revision": 0, "shot": shot})
        for socket in (host, guest):
            message = socket.receive_json()
            assert message["t"] == "shot"
            if enabled:
                assert message["shot"]["chalkLevel"] == 0.4
                assert message["shot"]["miscue"]
            else:
                assert "chalkLevel" not in message["shot"]
            result = socket.receive_json()
            assert result["t"] == "result" and result["revision"] == 1
            assert result["chalk"] == pytest.approx(
                [wear(0.4, 0.1, 0.5, 0) if enabled else 0.4, 0.7]
            )


@pytest.fixture
def player(monkeypatch):
    monkeypatch.setenv("JEV_API_KEY", "test-placeholder")
    client = TestClient(app)
    register(client)
    unlock(client)
    return client


def test_jev_start_cannot_enable_chalk_without_unlock(monkeypatch):
    monkeypatch.setenv("JEV_API_KEY", "test-placeholder")
    client = TestClient(app)
    register(client)
    response = client.post(
        "/api/opponents/jev/games", headers=HEADERS, json={"rules": {"chalkSim": True}}
    )
    assert response.status_code == 403
    with Session() as db:
        assert db.query(JevGame).count() == db.query(GameMatch).count() == 0


def test_jev_chalk_requires_owner_current_turn_revision_and_idle_game_without_cost(
    player, monkeypatch
):
    game = start(player)
    edit_state(game, chalk=[0.2, 0.3])
    url = f"/api/opponents/jev/games/{game['id']}/chalk"
    no_model_calls(monkeypatch)
    other = TestClient(app)
    register(other, "otherchalk")
    assert other.post(url, headers=HEADERS, json={"revision": 0}).status_code == 404
    assert player.post(url, headers=HEADERS, json={"revision": 1}).status_code == 409
    assert player.post(url, headers=HEADERS, json={"revision": True}).status_code == 422
    edit_state(game, current=1)
    assert player.post(url, headers=HEADERS, json={"revision": 0}).status_code == 409
    edit_state(game, current=0)
    jev.active_games.add(game["id"])
    try:
        assert player.post(url, headers=HEADERS, json={"revision": 0}).status_code == 409
    finally:
        jev.active_games.discard(game["id"])
    with Session() as db:
        row = db.get(JevGame, game["id"])
        assert row.revision == 0 and jev.decode(row.state).chalk == [0.2, 0.3]
    result = player.post(url, headers=HEADERS, json={"revision": 0})
    assert result.status_code == 200, result.text
    assert result.json()["state"]["chalk"] == [1.0, 0.3]
    assert result.json()["state"]["revision"] == 1
    assert player.post(url, headers=HEADERS, json={"revision": 0}).status_code == 409
    with Session() as db:
        assert db.query(MatchShot).count() == 0
    assert_no_usage()


def test_jev_rejects_invalid_shot_without_wear_then_persists_accepted_shot(player, monkeypatch):
    game = start(player)
    edit_state(game, chalk=[0.4, 0.7])
    no_model_calls(monkeypatch)
    url = f"/api/opponents/jev/games/{game['id']}/turn"
    invalid = {"revision": 0, "shot": {"aim": 0, "power": 0.1, "tipX": 0.5, "tipY": 0.5}}
    assert player.post(url, headers=HEADERS, json=invalid).status_code == 422
    with Session() as db:
        row = db.get(JevGame, game["id"])
        assert row.revision == 0 and jev.decode(row.state).chalk == [0.4, 0.7]
    valid = {"revision": 0, "shot": {"aim": 0, "power": 0.1, "tipX": 0.5}}
    response = player.post(url, headers=HEADERS, json=valid)
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["shot"]["chalkLevel"] == 0.4 and result["shot"]["miscue"]
    assert result["state"]["chalk"] == pytest.approx([wear(0.4, 0.1, 0.5, 0), 0.7])
    with Session() as db:
        assert db.query(MatchShot).count() == 1
    assert_no_usage()


def test_simulation_cpu_rechalks_before_planning_without_model_or_allowance(player, monkeypatch):
    account = player.get("/api/account").json()["account"]
    with Session.begin() as db:
        db.get(Account, account["id"]).sim_enabled = True
    game = start(player, "jev-cpu")
    edit_state(game, current=1, break_shot=False, chalk=[0.6, 0.1])
    no_model_calls(monkeypatch)
    observed = []

    def plans(state):
        observed.append(state.chalk.copy())
        return [
            dict(
                id=f"s{i}",
                family="direct",
                aim=0.0,
                power=0.1,
                tipX=0.4,
                tipY=0.0,
                calledBall=1,
                calledPocket=0,
            )
            for i in range(2)
        ]

    monkeypatch.setattr(jev, "plan_shots", plans)
    response = player.post(
        f"/api/opponents/jev/games/{game['id']}/turn", headers=HEADERS, json={"revision": 0}
    )
    assert response.status_code == 200, response.text
    result = response.json()
    assert observed == [[0.6, 1.0]]
    assert result["source"] == "planner" and result["by"] == 1
    assert result["shot"]["chalkLevel"] == 1.0 and not result["shot"]["miscue"]
    assert result["state"]["chalk"] == pytest.approx([0.6, wear(1, 0.1, 0.4, 0)])
    assert_no_usage()


def test_jev_autochalk_adds_no_model_request_or_budget_reservation(player, monkeypatch):
    game = start(player)
    edit_state(game, current=1, break_shot=False, chalk=[0.6, 0.1])
    evaluations, reservations = [], []
    original_reserve = jev.jev_budget.reserve

    def reserve(*args, **kwargs):
        reservations.append(args)
        return original_reserve(*args, **kwargs)

    def plans(state):
        assert state.chalk == [0.6, 1.0]
        return [
            dict(
                id=f"s{i}",
                family="direct",
                aim=0.0,
                power=0.1,
                tipX=0.4,
                tipY=0.0,
                calledBall=1,
                calledPocket=0,
            )
            for i in range(2)
        ]

    async def evaluate(selection, key):
        evaluations.append(selection)
        return jev.Evaluation("s1", 1200, 30)

    monkeypatch.setattr(jev, "plan_shots", plans)
    monkeypatch.setattr(jev, "evaluate", evaluate)
    monkeypatch.setattr(jev.jev_budget, "reserve", reserve)
    result = player.post(
        f"/api/opponents/jev/games/{game['id']}/turn", headers=HEADERS, json={"revision": 0}
    )
    assert result.status_code == 200, result.text
    assert result.json()["source"] == "jev"
    assert result.json()["shot"]["chalkLevel"] == 1.0
    assert len(evaluations) == len(reservations) == 1
    with Session() as db:
        row = db.get(JevGame, game["id"])
        assert row.requests == db.query(JevRequest).count() == 1
        assert row.input_tokens == 1200 and row.output_tokens == 30
