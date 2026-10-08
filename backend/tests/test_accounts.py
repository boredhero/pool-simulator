import time

from fastapi.testclient import TestClient

from app.main import app
from app.models.db import Account, LoginSession, Session
from app.services.auth import COOKIE

HEADERS = {"X-Pool-Request": "1"}
PASSWORD = "a sufficiently long pool password"


def signup(client, name="Pool_Player"):
    response = client.post(
        "/api/account/register", headers=HEADERS, json={"username": name, "password": PASSWORD}
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_register_hashes_credentials_and_uses_cookie_session(monkeypatch):
    client = TestClient(app)
    data = signup(client)
    assert len(data["recovery"].replace("-", "")) == 32
    cookie = client.cookies.get(COOKIE)
    profile = client.get("/api/account")
    assert profile.json()["account"]["username"] == "Pool_Player"
    assert profile.json()["stats"]["matches"] == 0
    assert profile.headers["cache-control"] == "no-store"
    with Session() as db:
        user = db.get(Account, data["account"]["id"])
        assert user.password_hash.startswith("$argon2id$")
        assert PASSWORD not in user.password_hash
        assert data["recovery"] not in user.recovery_hash
        session = db.query(LoginSession).one()
        assert session.token_hash != cookie
    monkeypatch.setenv("COOKIE_SECURE", "true")
    response = client.post(
        "/api/account/login",
        headers=HEADERS,
        json={"username": "pool_player", "password": PASSWORD},
    )
    assert response.status_code == 200
    for attribute in ("HttpOnly", "Secure", "SameSite=lax"):
        assert attribute in response.headers["set-cookie"]


def test_unique_casefolded_names_and_validation_do_not_echo_passwords():
    client = TestClient(app)
    signup(client)
    response = client.post(
        "/api/account/register",
        headers=HEADERS,
        json={"username": "pool_player", "password": PASSWORD},
    )
    assert response.status_code == 409
    for name in ("xy", "space name", "../bad", "üsername", "x" * 21):
        assert (
            client.post(
                "/api/account/register",
                headers=HEADERS,
                json={"username": name, "password": PASSWORD},
            ).status_code
            == 422
        )
    response = client.post(
        "/api/account/register",
        headers=HEADERS,
        json={"username": "valid", "password": "secret-short"},
    )
    assert response.status_code == 422
    assert "secret-short" not in response.text


def test_recovery_rotates_code_revokes_all_sessions_and_requires_new_login():
    first, second = TestClient(app), TestClient(app)
    data = signup(first)
    assert (
        second.post(
            "/api/account/login",
            headers=HEADERS,
            json={"username": "pool_player", "password": PASSWORD},
        ).status_code
        == 200
    )
    new_password = "a completely different long password"
    payload = {
        "username": "POOL_PLAYER",
        "password": new_password,
        "recovery": data["recovery"].lower().replace("-", " "),
    }
    recovered = TestClient(app).post("/api/account/recover", headers=HEADERS, json=payload)
    assert recovered.status_code == 200
    assert recovered.json()["recovery"] != data["recovery"]
    assert first.get("/api/account").json()["account"] is None
    assert second.get("/api/account").json()["account"] is None
    assert first.post("/api/account/recover", headers=HEADERS, json=payload).status_code == 401
    assert (
        first.post(
            "/api/account/login",
            headers=HEADERS,
            json={"username": "Pool_Player", "password": PASSWORD},
        ).status_code
        == 401
    )
    assert (
        first.post(
            "/api/account/login",
            headers=HEADERS,
            json={"username": "Pool_Player", "password": new_password},
        ).status_code
        == 200
    )
    assert first.post("/api/account/logout", headers=HEADERS, json={}).status_code == 200
    assert first.get("/api/account").json()["account"] is None


def test_csrf_expired_sessions_and_rate_limits():
    client = TestClient(app)
    payload = {"username": "PlayerOne", "password": PASSWORD}
    assert client.post("/api/account/register", json=payload).status_code == 403
    assert (
        client.post(
            "/api/account/register",
            json=payload,
            headers={**HEADERS, "Origin": "https://evil.example"},
        ).status_code
        == 403
    )
    signup(client)
    with Session.begin() as db:
        db.query(LoginSession).update({"expires_at": int(time.time()) - 1})
    assert client.get("/api/account").json()["account"] is None
    for _ in range(12):
        assert client.post("/api/account/login", headers=HEADERS, json=payload).status_code == 401
    assert client.post("/api/account/login", headers=HEADERS, json=payload).status_code == 429


def test_database_survives_engine_reconnection_and_session_revokes_on_logout():
    from app.models.db import engine

    client = TestClient(app)
    data = signup(client)
    engine.dispose()
    assert client.get("/api/account").json()["account"]["id"] == data["account"]["id"]
    assert client.post("/api/account/logout", headers=HEADERS, json={}).status_code == 200
    with Session() as db:
        assert db.query(LoginSession).count() == 0


def test_static_files_cannot_escape_frontend_dist():
    from app.main import DIST

    if DIST.exists():
        response = TestClient(app).get("/%2e%2e%2f%2e%2e%2fbackend%2fpyproject.toml")
        assert response.status_code == 404
        assert "dependencies" not in response.text


def test_live_sqlite_backup_captures_accounts_without_overwriting(tmp_path):
    import importlib.util
    import sqlite3
    from pathlib import Path

    client = TestClient(app)
    data = signup(client)
    script = Path(__file__).parents[1] / "scripts" / "backup_db.py"
    spec = importlib.util.spec_from_file_location("pool_backup", script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    output = tmp_path / "backup.db"
    module.backup(output)
    with sqlite3.connect(output) as db:
        assert db.execute("SELECT id FROM accounts").fetchone()[0] == data["account"]["id"]
    assert output.stat().st_mode & 0o777 == 0o600
    import pytest

    with pytest.raises(FileExistsError):
        module.backup(output)
