import json
import time
from dataclasses import asdict

import httpx
import pytest
from fastapi.testclient import TestClient

from app.api import jev
from app.main import app
from app.models.db import JevGame, Session, TermsAcceptance
from app.sim.rules import new_game

HEADERS = {"X-Pool-Request": "1"}
client = TestClient(app)


def register(name="jevtester"):
    response = client.post(
        "/api/account/register",
        headers=HEADERS,
        json={
            "username": name,
            "password": "a long test password only",
            "adult": True,
            "terms_version": "2026-10-08",
        },
    )
    assert response.status_code == 200
    return response.json()["account"]


@pytest.fixture(autouse=True)
def signed_in(monkeypatch):
    client.cookies.clear()
    monkeypatch.setenv("JEV_API_KEY", "test-placeholder")
    register()
    yield
    client.cookies.clear()


def start():
    response = client.post("/api/opponents/jev/games", headers=HEADERS, json={})
    assert response.status_code == 200, response.text
    return response.json()


def test_guests_and_unaccepted_terms_cannot_use_jev():
    account = client.get("/api/account").json()["account"]
    with Session.begin() as db:
        db.delete(db.get(TermsAcceptance, account["id"]))
    assert client.get("/api/opponents/jev").status_code == 403
    assert client.post("/api/opponents/jev/games", headers=HEADERS, json={}).status_code == 403
    client.cookies.clear()
    assert client.get("/api/opponents/jev").status_code == 401
    assert client.post("/api/opponents/jev/games", headers=HEADERS, json={}).status_code == 401


def test_one_game_per_account_and_network_with_resume():
    game = start()
    assert start()["id"] == game["id"]
    assert client.get("/api/opponents/jev").json()["usage"]["gamesRemaining"] == 0
    client.cookies.clear()
    register("secondjev")
    assert client.post("/api/opponents/jev/games", headers=HEADERS, json={}).status_code == 429
    assert (
        client.post(
            f"/api/opponents/jev/games/{game['id']}/turn",
            headers=HEADERS,
            json={"revision": 0, "shot": None},
        ).status_code
        == 404
    )


def test_server_owns_state_and_rejects_replayed_turns():
    game = start()
    url = f"/api/opponents/jev/games/{game['id']}/turn"
    assert client.post(url, headers=HEADERS, json={"revision": 0}).status_code == 409
    result = client.post(
        url, headers=HEADERS, json={"revision": 0, "shot": {"aim": 0.0, "power": 0.05}}
    )
    assert result.status_code == 200, result.text
    assert result.json()["state"]["revision"] == 1
    assert (
        client.post(
            url, headers=HEADERS, json={"revision": 0, "shot": {"aim": 0.0, "power": 0.05}}
        ).status_code
        == 409
    )
    assert start()["state"]["revision"] == 1
    with Session.begin() as db:
        db.get(JevGame, game["id"]).status = "completed"
    assert client.post("/api/opponents/jev/games", headers=HEADERS, json={}).status_code == 429


def set_cpu_turn(game):
    gs = new_game(3)
    for b in gs.balls:
        b.potted = True
    cue = gs.balls[0]
    cue.potted = False
    cue.x, cue.y = 0.5, 0.3
    ball = gs.balls[1]
    ball.potted = False
    ball.n = 1
    ball.x, ball.y = 0.25, 0.15
    ball = gs.balls[2]
    ball.potted = False
    ball.n = 2
    ball.x, ball.y = 1.8, 0.8
    gs.current = 1
    gs.break_shot = False
    with Session.begin() as db:
        db.get(JevGame, game["id"]).state = json.dumps(asdict(gs))


def test_tokens_cost_and_failures_are_private_game_records(monkeypatch):
    game = start()
    set_cpu_turn(game)
    calls = []

    async def evaluate(payload, key):
        calls.append(payload)
        return 0, 1200, 30

    monkeypatch.setattr(jev, "evaluate", evaluate)
    response = client.post(
        f"/api/opponents/jev/games/{game['id']}/turn", headers=HEADERS, json={"revision": 0}
    )
    assert response.status_code == 200, response.text
    assert response.json()["source"] == "jev"
    assert len(calls) == 1
    with Session() as db:
        row = db.get(JevGame, game["id"])
        assert (
            row.requests,
            row.input_tokens,
            row.output_tokens,
            row.estimated_cost_nano,
            row.unmetered_requests,
        ) == (1, 1200, 30, 50400, 0)
    assert "input_tokens" not in client.get("/api/opponents/jev").text


def test_provider_failure_finishes_turn_with_cpu(monkeypatch):
    game = start()
    set_cpu_turn(game)

    async def evaluate(payload, key):
        raise httpx.ConnectError("private provider details")

    monkeypatch.setattr(jev, "evaluate", evaluate)
    response = client.post(
        f"/api/opponents/jev/games/{game['id']}/turn", headers=HEADERS, json={"revision": 0}
    )
    assert response.status_code == 200, response.text
    assert response.json()["source"] == "cpu-fallback"
    assert "private" not in response.text
    assert not jev.active_games
    with Session() as db:
        assert db.get(JevGame, game["id"]).unmetered_requests == 1


def test_no_configuration_and_expired_game(monkeypatch):
    game = start()
    with Session.begin() as db:
        db.get(JevGame, game["id"]).day = int(time.time()) // 86400 - 1
    assert (
        client.post(
            f"/api/opponents/jev/games/{game['id']}/turn", headers=HEADERS, json={"revision": 0}
        ).status_code
        == 409
    )
    monkeypatch.delenv("JEV_API_KEY")
    assert client.post("/api/opponents/jev/games", headers=HEADERS, json={}).status_code == 503


@pytest.mark.asyncio
async def test_provider_contract_validates_selection_and_usage(monkeypatch):
    original = httpx.AsyncClient
    result = {
        "answers": {"shot": {"type": "choice", "choice": "1"}},
        "usage": {"input_tokens": 200, "output_tokens": 20},
    }

    async def handler(request):
        body = json.loads(request.content)
        assert body["model"] == "jev-1.13.0"
        assert set(body["questions"]["shot"]["criteria"]) == {"0", "1"}
        return httpx.Response(200, json=result)

    monkeypatch.setattr(
        jev.httpx,
        "AsyncClient",
        lambda **kw: original(transport=httpx.MockTransport(handler), **kw),
    )
    item = jev.Candidate(
        ball=1, pocket=0, cutDegrees=10.0, cueDistance=0.5, pocketDistance=0.3, power=0.3
    )
    payload = jev.Selection(candidates=[item, item], remaining=7)
    assert await jev.evaluate(payload, "test-placeholder") == (1, 200, 20)
    result["answers"]["shot"]["choice"] = "99"
    with pytest.raises(ValueError):
        await jev.evaluate(payload, "test-placeholder")
