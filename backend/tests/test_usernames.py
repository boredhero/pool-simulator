import time
from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from test_accounts import HEADERS, PASSWORD, signup
from test_passkeys import client, enroll, login

from app.main import app
from app.models.db import Account, Session
from app.models.migrations import upgrade_username_changes
from app.services.auth import COOKIE, USERNAME_CHANGE_SECONDS


def rename(c, username):
    return c.post("/api/account/username", headers=HEADERS, json={"username": username})


def test_rename_preserves_owner_identity_password_passkeys_and_releases_old_name(monkeypatch):
    c = client()
    original = signup(c, "Original")["account"]
    monkeypatch.setenv("ADMIN_ACCOUNT_ID", original["id"])
    key, _ = enroll(c)
    with Session.begin() as db:
        user = db.get(Account, original["id"])
        user.premium = True
        user.sim_enabled = True
        user.monthly_budget_nano = 3456789
    result = rename(c, "Developer")
    assert result.status_code == 200, result.text
    account = result.json()["account"]
    assert account["id"] == original["id"] and account["isAdmin"]
    assert account["premium"] and account["simEnabled"]
    assert account["createdAt"] == original["createdAt"]
    assert (
        account["usernameChangeAvailableAt"] - account["usernameChangedAt"]
        == USERNAME_CHANGE_SECONDS
    )
    assert c.get("/api/account").json()["account"]["username"] == "Developer"
    with Session() as db:
        assert db.get(Account, original["id"]).monthly_budget_nano == 3456789
    new_account = signup(TestClient(app), "ORIGINAL")["account"]
    assert new_account["id"] != original["id"] and not new_account["isAdmin"]
    signed_in = TestClient(app).post(
        "/api/account/login", headers=HEADERS, json={"username": "developer", "password": PASSWORD}
    )
    assert signed_in.status_code == 200
    assert signed_in.json()["account"]["id"] == original["id"]
    assert login(client(), key)[0].json()["account"]["id"] == original["id"]


def test_collision_invalid_and_noop_do_not_consume_change():
    c = TestClient(app)
    data = signup(c)
    signup(TestClient(app), "Taken")
    assert rename(c, "tAkEn").status_code == 409
    assert rename(c, "Pool_Player").status_code == 400
    assert rename(c, "../name").status_code == 422
    assert rename(c, "x").status_code == 422
    with Session() as db:
        assert db.get(Account, data["account"]["id"]).username_changed_at is None
    assert c.get("/api/account/username/availability", params={"username": "TAKEN"}).json() == {
        "available": False
    }
    assert c.get(
        "/api/account/username/availability", params={"username": "pool_player"}
    ).json() == {"available": True}
    assert rename(c, "NewName").status_code == 200
    assert rename(c, "Another").status_code == 409


def test_cooldown_exact_boundary_and_no_calendar_year_reset(monkeypatch):
    c = TestClient(app)
    data = signup(c)
    now = int(time.time())
    monkeypatch.setattr("app.api.accounts.time.time", lambda: now)
    with Session.begin() as db:
        db.get(Account, data["account"]["id"]).username_changed_at = (
            now - USERNAME_CHANGE_SECONDS + 1
        )
    assert rename(c, "NextName").status_code == 409
    with Session.begin() as db:
        db.get(Account, data["account"]["id"]).username_changed_at = now - USERNAME_CHANGE_SECONDS
    assert rename(c, "NextName").status_code == 200


def test_auth_csrf_and_disabled_accounts():
    assert rename(TestClient(app), "NoSession").status_code == 401
    c = TestClient(app)
    data = signup(c)
    assert c.post("/api/account/username", json={"username": "Unsafe"}).status_code == 403
    assert (
        c.post(
            "/api/account/username",
            headers={**HEADERS, "Origin": "https://evil.example"},
            json={"username": "Unsafe"},
        ).status_code
        == 403
    )
    assert (
        TestClient(app)
        .get("/api/account/username/availability", params={"username": "Name"})
        .status_code
        == 401
    )
    with Session.begin() as db:
        db.get(Account, data["account"]["id"]).disabled = True
    assert rename(c, "Disabled").status_code == 401


def test_concurrent_renames_have_one_winner_and_names_are_unique():
    c = TestClient(app)
    signup(c)
    token = c.cookies.get(COOKIE)

    def attempt(name):
        contender = TestClient(app)
        contender.cookies.set(COOKIE, token)
        return rename(contender, name).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(attempt, ["NameOne", "NameTwo"])) == [200, 409]
    a, b = TestClient(app), TestClient(app)
    signup(a, "AnotherOne")
    signup(b, "AnotherTwo")
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(
            pool.map(lambda candidate: rename(candidate, "SameTarget").status_code, [a, b])
        )
    assert sorted(results) == [200, 409]


def test_username_migration_is_idempotent_and_preserves_existing_account():
    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE accounts (id TEXT PRIMARY KEY, username TEXT)"))
        connection.execute(text("INSERT INTO accounts VALUES ('owner', 'developer')"))
        upgrade_username_changes(connection)
        upgrade_username_changes(connection)
        assert connection.execute(text("SELECT * FROM accounts")).one() == (
            "owner",
            "developer",
            None,
        )
