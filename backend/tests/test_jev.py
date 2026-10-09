import json
import time
from dataclasses import asdict

import httpx
import pytest
from fastapi.testclient import TestClient

from app.api import jev
from app.main import app
from app.models.db import JevGame, Session, TermsAcceptance
from app.services.terms import terms_version
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
            "terms_version": terms_version(),
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


def test_free_game_resumes_and_other_accounts_have_independent_allowances():
    game = start()
    assert start()["id"] == game["id"]
    assert (
        client.get("/api/opponents/jev").json()["usage"]["budget"]["remainingNano"] == 150_000_000
    )
    client.cookies.clear()
    register("secondjev")
    assert client.post("/api/opponents/jev/games", headers=HEADERS, json={}).status_code == 200
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
    assert client.post("/api/opponents/jev/games", headers=HEADERS, json={}).status_code == 200


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
    monkeypatch.setattr(jev, "plan_shots", lambda gs: plans())

    async def evaluate(payload, key):
        calls.append(payload)
        return jev.Evaluation(payload.candidates[0]["id"], 1200, 30)

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
    monkeypatch.setattr(jev, "plan_shots", lambda gs: plans())
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


def plans():
    return [
        {
            "id": "s0",
            "family": "direct",
            "aim": 0.0,
            "power": 0.2,
            "tipX": 0,
            "tipY": 0,
            "calledBall": 1,
            "calledPocket": 0,
            "evidence": {"verified": True, "legal": True, "continues": True, "nextShots": 2},
        },
        {
            "id": "s1",
            "family": "safety",
            "aim": 0.1,
            "power": 0.2,
            "tipX": 0,
            "tipY": 0,
            "calledBall": 1,
            "calledPocket": 1,
            "evidence": {"verified": True, "legal": True, "opponentShots": 0},
        },
    ]


@pytest.mark.asyncio
async def test_provider_contract_validates_selection_and_usage(monkeypatch):
    original = httpx.AsyncClient
    result = {
        "answers": {
            "tactic": {"type": "choice", "choice": "safety"},
            "shot_safety": {"type": "choice", "choice": "s1"},
        },
        "usage": {"input_tokens": 200, "output_tokens": 20},
    }

    async def handler(request):
        body = json.loads(request.content)
        assert body["model"] == "jev-1.13.0"
        assert set(body["questions"]) == {"tactic", "shot_direct", "shot_safety"}
        assert set(body["questions"]["shot_safety"]["criteria"]) == {"s1"}
        # Questions are evaluated independently: tactic selection needs the
        # same useful-energy priorities as the within-family shot choice.
        for question in body["questions"].values():
            assert "newly shootable targets" in question["instructions"]
            assert "Keep controlled pace" in question["instructions"]
        assert "power" not in body["questions"]["shot_safety"]["criteria"]["s1"]
        assert "username" not in request.content.decode()
        assert (
            body["questions"]["shot_safety"]["criteria"]["s1"]["evidence"]
            == "settled physics preview"
        )
        return httpx.Response(200, json=result)

    monkeypatch.setattr(
        jev.httpx,
        "AsyncClient",
        lambda **kw: original(transport=httpx.MockTransport(handler), **kw),
    )
    payload = jev.Selection(candidates=plans(), state={"legal_targets": [1, 2]})
    assert await jev.evaluate(payload, "test-placeholder") == jev.Evaluation("s1", 200, 20)
    # A real candidate from the wrong family is not accepted either.
    for choice in ("s0", "unknown", {"aim": 1}):
        result["answers"]["shot_safety"]["choice"] = choice
        assert await jev.evaluate(payload, "test-placeholder") == jev.Evaluation(None, 200, 20)
    result["answers"]["shot_safety"]["choice"] = "s1"
    result["usage"] = {"input_tokens": True, "output_tokens": -1}
    assert await jev.evaluate(payload, "test-placeholder") == jev.Evaluation("s1", None, None)


def test_invalid_choice_with_valid_usage_is_metered(monkeypatch):
    game = start()
    set_cpu_turn(game)
    monkeypatch.setattr(jev, "plan_shots", lambda gs: plans())

    async def evaluate(payload, key):
        return jev.Evaluation(None, 500, 20)

    monkeypatch.setattr(jev, "evaluate", evaluate)
    response = client.post(
        f"/api/opponents/jev/games/{game['id']}/turn", headers=HEADERS, json={"revision": 0}
    )
    assert response.status_code == 200, response.text
    assert response.json()["source"] == "cpu-fallback"
    with Session() as db:
        row = db.get(JevGame, game["id"])
        assert (row.requests, row.input_tokens, row.unmetered_requests) == (1, 500, 0)


def test_planned_kitchen_placement_committed_only_after_selection(monkeypatch):
    game = start()
    gs = new_game(3)
    gs.current, gs.break_shot = 1, False
    gs.ball_in_hand, gs.placement, gs.kitchen_shot = True, "kitchen", True
    with Session.begin() as db:
        db.get(JevGame, game["id"]).state = json.dumps(asdict(gs))
    options = plans()
    for i, option in enumerate(options):
        option["placement"] = {"x": 0.3, "y": 0.3 + i * 0.1}

    def planner(state):
        assert state.ball_in_hand and state.placement == "kitchen"
        return options

    async def evaluate(payload, key):
        assert payload.state["ball_in_hand"]
        return jev.Evaluation("s1", 300, 20)

    monkeypatch.setattr(jev, "plan_shots", planner)
    monkeypatch.setattr(jev, "evaluate", evaluate)
    response = client.post(
        f"/api/opponents/jev/games/{game['id']}/turn", headers=HEADERS, json={"revision": 0}
    )
    assert response.status_code == 200, response.text
    assert response.json()["placement"] == {"x": 0.3, "y": 0.4}
    assert response.json()["family"] == "safety"
    assert response.json()["state"]["revision"] == 1


def test_client_cannot_supply_candidates_or_game_state():
    game = start()
    for extra in ({"candidates": plans()}, {"state": {"current": 1}}, {"placement": {"x": 1}}):
        response = client.post(
            f"/api/opponents/jev/games/{game['id']}/turn",
            headers=HEADERS,
            json={"revision": 0, **extra},
        )
        assert response.status_code == 422


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [401, 422, 429, 529])
async def test_provider_http_errors_are_not_retried(monkeypatch, status):
    original = httpx.AsyncClient
    calls = []

    async def handler(request):
        calls.append(request)
        return httpx.Response(status, json={"detail": "private provider error"})

    monkeypatch.setattr(
        jev.httpx,
        "AsyncClient",
        lambda **kw: original(transport=httpx.MockTransport(handler), **kw),
    )
    with pytest.raises(httpx.HTTPStatusError):
        await jev.evaluate(jev.Selection(plans(), {}), "test-placeholder")
    assert len(calls) == 1


def test_invalid_planned_placement_does_not_consume_turn(monkeypatch):
    game = start()
    gs = new_game(3)
    gs.current, gs.break_shot = 1, False
    gs.ball_in_hand, gs.placement, gs.kitchen_shot = True, "kitchen", True
    raw = json.dumps(asdict(gs))
    with Session.begin() as db:
        db.get(JevGame, game["id"]).state = raw
    invalid = plans()[0]
    invalid["placement"] = {"x": 2.0, "y": 0.5}
    monkeypatch.setattr(jev, "plan_shots", lambda state: [invalid])
    response = client.post(
        f"/api/opponents/jev/games/{game['id']}/turn", headers=HEADERS, json={"revision": 0}
    )
    assert response.status_code == 409
    assert not jev.active_games
    with Session() as db:
        row = db.get(JevGame, game["id"])
        assert row.revision == 0 and row.state == raw


@pytest.mark.parametrize("starter", [0, 1])
def test_coin_toss_is_persisted_only_for_new_jev_games(monkeypatch, starter):
    calls = []

    def toss():
        calls.append(starter)
        return starter

    monkeypatch.setattr(jev.opening, "choose_breaker", toss)
    first = start()
    assert first["created"] is True
    assert first["state"]["current"] == starter
    assert first["state"]["break_shot"] is True
    with Session() as db:
        assert json.loads(db.get(JevGame, first["id"]).state)["current"] == starter
    resumed = start()
    assert resumed["id"] == first["id"] and resumed["created"] is False
    assert resumed["state"]["current"] == starter
    available = client.get("/api/opponents/jev").json()["game"]
    assert available["created"] is False and available["state"]["current"] == starter
    assert calls == [starter]
    if starter == 1:
        rejected = client.post(
            f"/api/opponents/jev/games/{first['id']}/turn",
            headers=HEADERS,
            json={"revision": 0, "shot": {"aim": 0.0, "power": 0.05}},
        )
        assert rejected.status_code == 409
    from app.premium import set_premium

    set_premium("jevtester", True)
    monkeypatch.setattr(jev.opening, "choose_breaker", lambda: 1 - starter)
    fresh = client.post("/api/opponents/jev/games", headers=HEADERS, json={"new_game": True}).json()
    assert fresh["created"] is True and fresh["id"] != first["id"]
    assert fresh["state"]["current"] == 1 - starter
    assert start()["state"]["current"] == 1 - starter


def enable_sim():
    from app.models.db import Account

    account = client.get("/api/account").json()["account"]
    with Session.begin() as db:
        db.get(Account, account["id"]).sim_enabled = True
    return account


def sim_start(mode):
    return client.post(
        "/api/opponents/jev/games", headers=HEADERS, json={"new_game": True, "simulation": mode}
    )


def test_sim_permission_shared_weighted_allowance_and_spectator_ledger():
    from sqlalchemy import select

    from app.models.db import GameMatch, MatchPlayer

    assert sim_start("jev-jev").status_code == 403
    account = enable_sim()
    first = sim_start("jev-jev")
    assert first.status_code == 200, first.text
    game = first.json()
    assert game["simulation"] == "jev-jev"
    assert game["state"]["names"] == ["Jev AI 1", "Jev AI 2"]
    assert (
        client.get("/api/opponents/jev").json()["usage"]["budget"]["remainingNano"] == 150_000_000
    )
    with Session() as db:
        assert db.get(GameMatch, game["id"]).mode == "simulation"
        players = db.scalars(select(MatchPlayer).where(MatchPlayer.match_id == game["id"])).all()
        assert len(players) == 2 and all(p.account_id is None for p in players)
    assert sim_start("jev-cpu").status_code == 200
    for _ in range(6):
        assert sim_start("jev-jev").status_code == 200
    assert client.get("/api/opponents/jev").json()["usage"]["budget"]["spentNano"] == 0
    assert account["premium"] is False


def test_sim_revocation_blocks_turn_and_resume_and_premium_does_not_grant_permission():
    from app.models.db import Account

    account = enable_sim()
    game = sim_start("jev-jev").json()
    with Session.begin() as db:
        row = db.get(Account, account["id"])
        row.sim_enabled = False
        row.premium = True
    assert (
        client.post(
            f"/api/opponents/jev/games/{game['id']}/turn", headers=HEADERS, json={"revision": 0}
        ).status_code
        == 403
    )
    assert client.post("/api/opponents/jev/games", headers=HEADERS, json={}).status_code == 403
    assert sim_start("jev-jev").status_code == 403
    enable_sim()
    for _ in range(4):
        assert sim_start("jev-jev").status_code == 200
    assert client.get("/api/opponents/jev").json()["usage"]["budget"]["unlimited"] is True


@pytest.mark.parametrize(
    "mode,seat,provider_calls", [("jev-cpu", 0, 1), ("jev-cpu", 1, 0), ("jev-jev", 1, 1)]
)
def test_sim_automates_both_seats_and_cpu_never_calls_provider(
    monkeypatch, mode, seat, provider_calls
):
    enable_sim()
    game = sim_start(mode).json()
    set_cpu_turn(game)
    with Session.begin() as db:
        row = db.get(JevGame, game["id"])
        state = json.loads(row.state)
        state["current"] = seat
        row.state = json.dumps(state)
    calls = []
    monkeypatch.setattr(jev, "plan_shots", lambda gs: plans())

    async def evaluate(payload, key):
        calls.append(payload)
        return jev.Evaluation(payload.candidates[0]["id"], 10, 2)

    monkeypatch.setattr(jev, "evaluate", evaluate)
    url = f"/api/opponents/jev/games/{game['id']}/turn"
    assert (
        client.post(
            url, headers=HEADERS, json={"revision": 0, "shot": {"aim": 0.0, "power": 0.1}}
        ).status_code
        == 409
    )
    response = client.post(url, headers=HEADERS, json={"revision": 0})
    assert response.status_code == 200, response.text
    assert response.json()["by"] == seat
    assert len(calls) == provider_calls


def test_spin_boundary_roundoff_accepted_but_real_overspin_rejected():
    game = start()
    url = f"/api/opponents/jev/games/{game['id']}/turn"
    bad = client.post(
        url,
        headers=HEADERS,
        json={"revision": 0, "shot": {"aim": 0.0, "power": 0.1, "tipX": 0.4, "tipY": 0.4}},
    )
    assert bad.status_code == 422
    response = client.post(
        url,
        headers=HEADERS,
        json={
            "revision": 0,
            "shot": {
                "aim": 0.0,
                "power": 0.1,
                "tipX": 0.029955471237928386,
                "tipY": 0.5491836393620205,
            },
        },
    )
    assert response.status_code == 200, response.text
