import time

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError
from test_premium import register, start

from app.api import jev
from app.main import app
from app.models.db import JevGame, Session
from app.models.migrations import upgrade_jev_allowance


def test_five_starts_resume_exhaustion_and_next_day(monkeypatch):
    monkeypatch.setenv("JEV_API_KEY", "test-placeholder")
    now = int(time.time())
    monkeypatch.setattr(jev.time, "time", lambda: now)
    client = TestClient(app)
    register(client)
    ids = []
    for remaining in range(4, -1, -1):
        response = start(client, fresh=True)
        assert response.status_code == 200, response.text
        game = response.json()
        ids.append(game["id"])
        assert start(client).json()["id"] == game["id"]
        assert client.get("/api/opponents/jev").json()["usage"]["gamesRemaining"] == remaining
    assert len(set(ids)) == 5
    assert start(client, fresh=True).status_code == 429
    with Session() as db:
        assert db.get(JevGame, ids[-1]).status == "active"
        assert all(db.get(JevGame, identity).status == "abandoned" for identity in ids[:-1])
    now += 86400
    assert client.get("/api/opponents/jev").json()["usage"]["gamesRemaining"] == 5
    assert start(client).json()["id"] == ids[-1]
    assert start(client, fresh=True).status_code == 200


def test_new_allowance_migration_preserves_history_and_resets_old_usage_once():
    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.exec_driver_sql("CREATE TABLE accounts (id TEXT PRIMARY KEY)")
        connection.exec_driver_sql("INSERT INTO accounts VALUES ('a')")
        connection.exec_driver_sql("""CREATE TABLE jev_games (
            id TEXT PRIMARY KEY, account_id TEXT REFERENCES accounts(id), day INTEGER,
            network_hash TEXT, state TEXT, estimated_cost_nano INTEGER,
            UNIQUE(account_id,day), UNIQUE(network_hash,day))""")
        connection.exec_driver_sql(
            "INSERT INTO jev_games VALUES ('legacy','a',123,'net','saved',42)"
        )
        upgrade_jev_allowance(connection)
        assert connection.execute(
            text("SELECT state,estimated_cost_nano,daily_slot FROM jev_games")
        ).one() == ("saved", 42, None)
        for slot in range(1, 6):
            connection.execute(
                text("INSERT INTO jev_games VALUES (:id,'a',123,'net','new',0,:slot)"),
                {"id": str(slot), "slot": slot},
            )
        upgrade_jev_allowance(connection)
        assert (
            connection.scalar(text("SELECT count(*) FROM jev_games WHERE daily_slot IS NOT NULL"))
            == 5
        )
        assert inspect(connection).get_foreign_keys("jev_games")[0]["referred_table"] == "accounts"
        with pytest.raises(IntegrityError):
            with connection.begin_nested():
                connection.execute(
                    text("INSERT INTO jev_games VALUES ('race','a',123,'net','new',0,5)")
                )
