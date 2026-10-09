import json
import time
from dataclasses import asdict

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text

from app.api import jev
from app.api.privacy import cleanup
from app.main import app
from app.models.db import GameMatch, JevGame, MatchPlayer, MatchShot, Session, init_db
from app.models.migrations import upgrade_match_modes
from app.premium import set_premium
from app.services.matches import account_stats, interrupt_matches, record_shot, start_match
from app.services.terms import terms_version
from app.sim.physics import ShotEvents
from app.sim.rules import new_game

HEADERS = {"X-Pool-Request": "1"}


@pytest.fixture
def player(monkeypatch):
    monkeypatch.setenv("JEV_API_KEY", "test-placeholder")
    with TestClient(app) as client:
        registered = client.post(
            "/api/account/register",
            headers=HEADERS,
            json={
                "username": "JevStatsPlayer",
                "password": "long stats testing password",
                "terms_version": terms_version(),
                "adult": True,
            },
        )
        assert registered.status_code == 200
        account = registered.json()["account"]
        set_premium(account["username"], True)
        yield client, account


def start(client, fresh=False):
    response = client.post("/api/opponents/jev/games", headers=HEADERS, json={"new_game": fresh})
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.parametrize("loss", [False, True])
def test_authoritative_jev_finish_updates_owned_durable_stats_once(player, monkeypatch, loss):
    client, account = player
    game = start(client)
    state = new_game(7)
    state.current, state.break_shot, state.open = 0, False, False
    state.groups = ["solid", "stripe"]
    for ball in state.balls:
        if ball.n in range(1, 8):
            ball.potted = True
    with Session.begin() as db:
        db.get(JevGame, game["id"]).state = json.dumps(asdict(state))

    def final_shot(balls, _cue_id):
        next(ball for ball in balls if ball.n == 8).potted = True
        return ShotEvents(
            first_contact=8,
            potted=[8],
            cue_potted=loss,
            pockets=[{"n": 8, "pocket": 0}],
            rail_after_contact=True,
        )

    monkeypatch.setattr(jev, "simulate_shot", final_shot)
    url = f"/api/opponents/jev/games/{game['id']}/turn"
    payload = {
        "revision": 0,
        "shot": {"aim": 0.0, "power": 0.3, "calledBall": 8, "calledPocket": 0},
    }
    result = client.post(url, headers=HEADERS, json=payload)
    assert result.status_code == 200, result.text
    assert result.json()["state"]["winner"] == int(loss)
    assert client.post(url, headers=HEADERS, json=payload).status_code == 409
    stats = client.get("/api/account").json()["stats"]
    assert stats["matches"] == stats["shots"] == 1
    assert stats["wins"] == int(not loss) and stats["losses"] == int(loss)
    assert stats["scratches"] == int(loss) and stats["shotStatsComplete"]
    assert stats["byMode"]["jev"] == {"matches": 1, "wins": int(not loss), "losses": int(loss)}
    assert stats["byMode"]["online"]["matches"] == 0
    assert stats["recent"][0]["opponent"] == "Jev AI"
    assert stats["recent"][0]["mode"] == "jev"
    assert account_stats("unrelated-account")["matches"] == 0
    with Session.begin() as db:
        assert db.query(MatchShot).filter_by(match_id=game["id"]).count() == 1
        assert db.get(MatchPlayer, (game["id"], 0)).account_id == account["id"]
        assert db.get(MatchPlayer, (game["id"], 1)).account_id is None
        db.get(JevGame, game["id"]).updated_at = int(time.time()) - 91 * 86400
        cleanup(db)
    assert account_stats(account["id"])["matches"] == 1
    with Session() as db:
        assert db.get(JevGame, game["id"]) is None
        assert db.get(GameMatch, game["id"]).status == "completed"


def test_replacing_unfinished_jev_game_is_not_a_loss_and_restart_preserves_it(player):
    client, account = player
    first = start(client)
    second = start(client, True)
    assert first["id"] != second["id"]
    interrupt_matches()
    stats = account_stats(account["id"])
    assert stats["matches"] == stats["wins"] == stats["losses"] == 0
    assert stats["abandoned"] == 1
    with Session() as db:
        assert db.get(GameMatch, first["id"]).status == "abandoned"
        assert db.get(GameMatch, second["id"]).status == "active"


def test_completed_retained_games_backfill_once_without_inventing_shots(player):
    client, account = player
    ids = []
    for status, winner in [
        ("completed", 0),
        ("completed", 1),
        ("active", None),
        ("abandoned", None),
    ]:
        game = start(client, True)
        ids.append(game["id"])
        state = new_game(8)
        state.winner = winner
        with Session.begin() as db:
            # Remove new tracking to represent historical records from before this feature.
            db.query(MatchPlayer).filter_by(match_id=game["id"]).delete()
            db.query(GameMatch).filter_by(id=game["id"]).delete()
            legacy = db.get(JevGame, game["id"])
            legacy.status, legacy.state, legacy.requests = status, json.dumps(asdict(state)), 77
    init_db()
    init_db()
    stats = account_stats(account["id"])
    assert stats["matches"] == 2 and stats["wins"] == stats["losses"] == 1
    assert stats["shots"] == stats["ballsPocketed"] == stats["fouls"] == 0
    assert not stats["shotStatsComplete"]
    with Session() as db:
        assert db.query(MatchShot).count() == 0
        for identity in ids[:2]:
            match = db.get(GameMatch, identity)
            assert match.mode == "jev" and not match.shot_stats_complete
            assert match.game_version == "historical-unknown"
        assert db.get(GameMatch, ids[-1]) is None


def test_online_totals_still_work_and_breakdown_does_not_double_count(player):
    _, account = player
    match = start_match([account["username"], "Guest"], [account["id"], None], {"preset": "bar"})
    facts = {"potted": [1], "cue_potted": False, "off_table": []}
    record_shot(match, 1, 0, {"aim": 0}, facts, 0, False)
    record_shot(match, 1, 0, {"aim": 0}, facts, 0, False)
    stats = account_stats(account["id"])
    assert stats["matches"] == stats["wins"] == stats["shots"] == 1
    assert stats["byMode"]["online"] == {"matches": 1, "wins": 1, "losses": 0}
    assert stats["byMode"]["jev"]["matches"] == 0 and stats["shotStatsComplete"]


def test_additive_ledger_migration_preserves_online_rows():
    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        connection.execute(
            text("CREATE TABLE game_matches (id VARCHAR(32) PRIMARY KEY, status VARCHAR(16))")
        )
        connection.execute(text("INSERT INTO game_matches VALUES ('old', 'completed')"))
        upgrade_match_modes(connection)
        upgrade_match_modes(connection)
        assert connection.execute(
            text("SELECT mode, shot_stats_complete FROM game_matches")
        ).one() == ("online", 1)
        assert {c["name"] for c in inspect(connection).get_columns("game_matches")} >= {
            "mode",
            "shot_stats_complete",
        }


def test_jev_winning_stroke_counts_account_loss_without_crediting_ai_shots_to_user(
    player, monkeypatch
):
    client, account = player
    game = start(client)
    state = new_game(8)
    state.current, state.break_shot, state.open = 1, False, False
    state.groups = ["solid", "stripe"]
    for ball in state.balls:
        if ball.n is not None and ball.n > 8:
            ball.potted = True
    with Session.begin() as db:
        db.get(JevGame, game["id"]).state = json.dumps(asdict(state))
    monkeypatch.setattr(
        jev,
        "plan_shots",
        lambda gs: [
            {
                "aim": 0,
                "power": 0.3,
                "tipX": 0,
                "tipY": 0,
                "calledBall": 8,
                "calledPocket": 0,
                "family": "direct",
            }
        ],
    )

    def final_shot(balls, _cue_id):
        next(ball for ball in balls if ball.n == 8).potted = True
        return ShotEvents(first_contact=8, potted=[8], pockets=[{"n": 8, "pocket": 0}])

    monkeypatch.setattr(jev, "simulate_shot", final_shot)
    result = client.post(
        f"/api/opponents/jev/games/{game['id']}/turn", headers=HEADERS, json={"revision": 0}
    )
    assert result.status_code == 200, result.text
    assert result.json()["state"]["winner"] == 1
    stats = account_stats(account["id"])
    assert stats["losses"] == stats["matches"] == 1
    assert stats["shots"] == stats["ballsPocketed"] == stats["wins"] == 0
    with Session() as db:
        assert db.get(MatchPlayer, (game["id"], 1)).shots == 1


def test_ledger_failure_cannot_commit_jev_state_without_its_stats(player, monkeypatch):
    client, _ = player
    game = start(client)
    with Session() as db:
        original = db.get(JevGame, game["id"]).state

    def fail(*args, **kwargs):
        raise RuntimeError("ledger unavailable")

    monkeypatch.setattr(jev, "record_shot_in_session", fail)
    response = client.post(
        f"/api/opponents/jev/games/{game['id']}/turn",
        headers=HEADERS,
        json={"revision": 0, "shot": {"aim": 0, "power": 0.05}},
    )
    assert response.status_code == 500
    assert response.json()["requestId"] == response.headers["X-Request-ID"]
    assert "ledger unavailable" not in response.text
    with Session() as db:
        record = db.get(JevGame, game["id"])
        assert record.state == original and record.revision == 0
        assert db.get(GameMatch, game["id"]).status == "active"
        assert db.get(MatchPlayer, (game["id"], 0)).shots == 0
        assert db.query(MatchShot).filter_by(match_id=game["id"]).count() == 0
