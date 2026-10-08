import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect
from sqlalchemy.exc import IntegrityError

from app.main import app
from app.models.db import Account, JevGame, Session
from app.models.migrations import upgrade_premium
from app.premium import set_premium
from app.services.terms import terms_version

HEADERS = {"X-Pool-Request": "1"}
PASSWORD = "a long premium testing password"


def test_bulk_operator_command_only_enables_existing_accounts(monkeypatch, capsys):
    from app.premium import main

    client = TestClient(app)
    register(client, "ExistingOne")
    register(client, "ExistingTwo")
    monkeypatch.setattr("sys.argv", ["premium", "--all-existing", "on"])
    main()
    assert "2 existing accounts: premium on" in capsys.readouterr().out
    with Session() as db:
        assert all(account.premium for account in db.query(Account).all())
    assert register(client, "NewAccount")["account"]["premium"] is False


def register(client, username="PremiumPlayer", **extra):
    response = client.post(
        "/api/account/register",
        headers=HEADERS,
        json={
            "username": username,
            "password": PASSWORD,
            "adult": True,
            "terms_version": terms_version(),
            **extra,
        },
    )
    assert response.status_code == 200
    return response.json()


def start(client, fresh=False):
    return client.post("/api/opponents/jev/games", headers=HEADERS, json={"new_game": fresh})


def test_only_operator_can_toggle_premium_and_existing_sessions_see_changes():
    client = TestClient(app)
    data = register(client, premium=True)
    assert data["account"]["premium"] is False
    assert set_premium("premiumplayer", True) == "PremiumPlayer"
    assert client.get("/api/account").json()["account"]["premium"] is True
    login = client.post(
        "/api/account/login",
        headers=HEADERS,
        json={"username": "PremiumPlayer", "password": PASSWORD, "premium": False},
    )
    assert login.json()["account"]["premium"] is True
    set_premium("PREMIUMPLAYER", False)
    assert client.get("/api/account").json()["account"]["premium"] is False
    with pytest.raises(ValueError, match="Account not found"):
        set_premium("MissingPlayer", True)
    # Recovery changes credentials, not the operator-controlled entitlement.
    set_premium("PremiumPlayer", True)
    response = client.post(
        "/api/account/recover",
        headers=HEADERS,
        json={"username": "PremiumPlayer", "password": PASSWORD, "recovery": data["recovery"]},
    )
    assert response.status_code == 200
    with Session() as db:
        assert db.get(Account, data["account"]["id"]).premium is True


def test_premium_new_games_resume_midnight_and_do_not_consume_network_allowance(monkeypatch):
    monkeypatch.setenv("JEV_API_KEY", "test-placeholder")
    client, free = TestClient(app), TestClient(app)
    register(client)
    set_premium("PremiumPlayer", True)
    first = start(client).json()
    assert first["expiresAt"] is None
    assert start(client).json()["id"] == first["id"]
    usage = client.get("/api/opponents/jev").json()["usage"]
    assert usage["unlimited"] is True and usage["budget"]["unlimited"] is True
    assert usage["resetsAt"] > 0
    second = start(client, fresh=True).json()
    assert second["id"] != first["id"]
    with Session.begin() as db:
        assert db.get(JevGame, first["id"]).status == "abandoned"
        record = db.get(JevGame, second["id"])
        assert record.day is None
        record.started_at -= 86400
    assert start(client).json()["id"] == second["id"]
    response = client.post(
        f"/api/opponents/jev/games/{second['id']}/turn",
        headers=HEADERS,
        json={"revision": 0, "shot": {"aim": 0.0, "power": 0.05}},
    )
    assert response.status_code == 200
    assert response.json()["state"]["revision"] == 1
    with Session.begin() as db:
        db.get(JevGame, second["id"]).status = "completed"
    third = start(client).json()
    assert third["id"] not in (first["id"], second["id"])
    register(free, "FreePlayer")
    assert start(free).status_code == 200
    assert start(free, fresh=True).status_code == 200
    # Even after the network has a free game, premium can create another.
    assert start(client, fresh=True).status_code == 200


def test_revocation_rechecks_access_and_preserves_free_daily_limits(monkeypatch):
    monkeypatch.setenv("JEV_API_KEY", "test-placeholder")
    client = TestClient(app)
    register(client)
    free_game = start(client).json()
    with Session.begin() as db:
        db.get(JevGame, free_game["id"]).status = "completed"
    set_premium("PremiumPlayer", True)
    premium_game = start(client).json()
    assert premium_game["id"] != free_game["id"]
    set_premium("PremiumPlayer", False)
    assert (
        client.get("/api/opponents/jev").json()["usage"]["budget"]["remainingNano"] == 150_000_000
    )
    assert start(client).json()["id"] == premium_game["id"]
    assert (
        client.post(
            f"/api/opponents/jev/games/{premium_game['id']}/turn",
            headers=HEADERS,
            json={"revision": 0, "shot": {"aim": 0.0, "power": 0.05}},
        ).status_code
        == 200
    )
    assert start(client, fresh=True).status_code == 200


def test_premium_upgrades_expired_free_game_but_keeps_turn_and_ownership_guards(monkeypatch):
    monkeypatch.setenv("JEV_API_KEY", "test-placeholder")
    client, other = TestClient(app), TestClient(app)
    register(client)
    game = start(client).json()
    with Session.begin() as db:
        db.get(JevGame, game["id"]).day -= 1
    set_premium("PremiumPlayer", True)
    assert start(client).json()["id"] == game["id"]
    turn_url = f"/api/opponents/jev/games/{game['id']}/turn"
    assert client.post(turn_url, headers=HEADERS, json={"revision": 0}).status_code == 409
    shot = {"revision": 0, "shot": {"aim": 0.0, "power": 0.05}}
    assert client.post(turn_url, headers=HEADERS, json=shot).status_code == 200
    assert client.post(turn_url, headers=HEADERS, json=shot).status_code == 409
    register(other, "OtherPremium")
    set_premium("OtherPremium", True)
    assert other.post(turn_url, headers=HEADERS, json=shot).status_code == 404


def test_legacy_sqlite_migration_preserves_data_indexes_and_free_uniqueness(tmp_path):
    # Reconstruct the deployed pre-premium tables, including unnamed constraints.
    engine = create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    with engine.begin() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys=ON")
        connection.exec_driver_sql("""CREATE TABLE accounts (
            id VARCHAR(32) PRIMARY KEY, username VARCHAR(20) NOT NULL,
            username_key VARCHAR(20) NOT NULL UNIQUE, password_hash TEXT NOT NULL,
            recovery_hash TEXT NOT NULL, created_at INTEGER NOT NULL)""")
        connection.exec_driver_sql("""CREATE TABLE jev_games (
            id VARCHAR(32) PRIMARY KEY, account_id VARCHAR(32) NOT NULL REFERENCES accounts(id),
            day INTEGER NOT NULL, network_hash VARCHAR(64) NOT NULL, state TEXT NOT NULL,
            UNIQUE(account_id, day), UNIQUE(network_hash, day))""")
        connection.exec_driver_sql("CREATE INDEX ix_jev_games_day ON jev_games(day)")
        connection.exec_driver_sql(
            "INSERT INTO accounts VALUES ('a','Player','player','hash','recovery',1)"
        )
        connection.exec_driver_sql(
            "INSERT INTO jev_games VALUES ('g','a',123,'network','saved game')"
        )
        upgrade_premium(connection)
        upgrade_premium(connection)
        assert connection.exec_driver_sql("SELECT premium, password_hash FROM accounts").one() == (
            0,
            "hash",
        )
        assert (
            connection.exec_driver_sql("SELECT state FROM jev_games WHERE id='g'").scalar()
            == "saved game"
        )
        assert inspect(connection).get_indexes("jev_games")[0]["name"] == "ix_jev_games_day"
        assert inspect(connection).get_foreign_keys("jev_games")[0]["referred_table"] == "accounts"
        for identity in ("p1", "p2"):
            connection.exec_driver_sql(
                "INSERT INTO jev_games VALUES (?, 'a', NULL, 'network', '{}')", (identity,)
            )
        connection.exec_driver_sql(
            "INSERT INTO accounts VALUES ('b','Other','other','hash','recovery',1,0)"
        )
        for account, network in [("a", "other"), ("b", "network")]:
            with pytest.raises(IntegrityError):
                with connection.begin_nested():
                    connection.exec_driver_sql(
                        "INSERT INTO jev_games VALUES ('bad', ?, 123, ?, '{}')", (account, network)
                    )
