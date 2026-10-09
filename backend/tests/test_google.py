"""Exercise real Google JWT verification using a local signing key and certificate response."""

import json
import time
from concurrent.futures import ThreadPoolExecutor

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from google.auth import crypt, jwt
from test_accounts import PASSWORD, signup
from test_passkeys import enroll

from app.api import google
from app.main import app
from app.models.db import (
    Account,
    AuthFresh,
    GoogleFlow,
    GoogleIdentity,
    LoginSession,
    Passkey,
    Session,
)
from app.services.auth import COOKIE, digest
from app.services.terms import terms_version

ORIGIN = "https://pool.martinospizza.dev"
HEADERS = {"X-Pool-Request": "1", "Origin": ORIGIN}
AUD = "test.apps.googleusercontent.com"


def client():
    return TestClient(app, base_url=ORIGIN, headers=HEADERS)


@pytest.fixture
def token(monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", AUD)
    monkeypatch.setenv("GOOGLE_ORIGIN", ORIGIN)
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private = key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    )
    public = (
        key.public_key()
        .public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
        .decode()
    )
    signer = crypt.RSASigner.from_string(private, key_id="test")

    class CertResponse:
        status = 200
        data = json.dumps({"test": public}).encode()

    monkeypatch.setattr(google, "google_request", lambda: lambda *a, **kw: CertResponse())

    def sign(nonce, subject="google-user", **overrides):
        claims = {
            "iss": "https://accounts.google.com",
            "aud": AUD,
            "iat": int(time.time()),
            "exp": int(time.time()) + 600,
            "sub": subject,
            "nonce": nonce,
            "email": "ignored@example.com",
        }
        claims.update(overrides)
        return jwt.encode(signer, claims).decode()

    return sign


def start(c, purpose="login"):
    r = c.post("/api/account/google/start", json={"purpose": purpose})
    assert r.status_code == 200, r.text
    return r.json()


def finish(c, token, purpose="login", subject="google-user"):
    flow = start(c, purpose)
    return c.post(
        "/api/account/google/finish",
        json={"flow": flow["flow"], "credential": token(flow["nonce"], subject)},
    )


def register(c, token, name="GooglePlayer", subject="google-user"):
    r = finish(c, token, subject=subject)
    assert r.status_code == 200, r.text
    ticket = r.json()["signup"]
    r = c.post(
        "/api/account/google/register",
        json={"flow": ticket, "username": name, "adult": True, "terms_version": terms_version()},
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_signup_login_recovery_and_no_password(token):
    c = client()
    data = register(c, token)
    account = data["account"]
    assert account["hasPassword"] is False
    assert c.get("/api/account").json()["account"]["id"] == account["id"]
    with Session() as db:
        assert db.get(Account, account["id"]).password_hash == "!"
        assert db.query(GoogleIdentity).one().subject == "google-user"
    c.post("/api/account/logout")
    assert (
        c.post(
            "/api/account/login", json={"username": "GooglePlayer", "password": PASSWORD}
        ).status_code
        == 401
    )
    signed = finish(c, token)
    assert signed.json()["account"]["id"] == account["id"]
    reset = c.post(
        "/api/account/recover",
        json={"username": "GooglePlayer", "password": PASSWORD, "recovery": data["recovery"]},
    )
    assert reset.status_code == 200
    with Session() as db:
        assert db.query(GoogleIdentity).count() == 0
        assert db.query(LoginSession).count() == 0
    assert (
        c.post(
            "/api/account/login", json={"username": "GooglePlayer", "password": PASSWORD}
        ).json()["account"]["hasPassword"]
        is True
    )


@pytest.mark.parametrize(
    "overrides",
    [
        {"aud": "wrong"},
        {"iss": "evil.example"},
        {"exp": 1},
        {"iat": 9999999999},
        {"nonce": "wrong"},
        {"nonce": "non-ascii-α"},
        {"sub": ""},
    ],
)
def test_real_jwt_rejects_wrong_claims_and_consumes_flow(token, overrides):
    c = client()
    flow = start(c)
    claims = {"nonce": flow["nonce"], **overrides}
    credential = (
        token(**claims) if "sub" not in claims else token(claims["nonce"], subject=claims["sub"])
    )
    payload = {"flow": flow["flow"], "credential": credential}
    assert c.post("/api/account/google/finish", json=payload).status_code == 401
    assert c.post("/api/account/google/finish", json=payload).status_code == 401


def test_signature_tampering_browser_binding_csrf_and_expiry(token):
    c = client()
    flow = start(c)
    credential = token(flow["nonce"])
    payload = {"flow": flow["flow"], "credential": credential}
    assert client().post("/api/account/google/finish", json=payload).status_code == 401
    assert (
        c.post(
            "/api/account/google/finish", json=payload, headers={"Origin": "https://evil.example"}
        ).status_code
        == 403
    )
    pieces = credential.split(".")
    pieces[2] = ("A" if pieces[2][0] != "A" else "B") + pieces[2][1:]
    assert (
        c.post(
            "/api/account/google/finish", json={**payload, "credential": ".".join(pieces)}
        ).status_code
        == 401
    )
    flow = start(c)
    with Session.begin() as db:
        db.get(GoogleFlow, flow["flow"]).expires_at = 1
    assert (
        c.post(
            "/api/account/google/finish",
            json={"flow": flow["flow"], "credential": token(flow["nonce"])},
        ).status_code
        == 401
    )
    assert TestClient(app).post("/api/account/google/start", json={}).status_code == 403


def test_signup_requires_terms_allows_name_retry_and_prevents_replay(token):
    c = client()
    signup(client(), "Taken")
    ticket = finish(c, token).json()["signup"]
    payload = {"flow": ticket, "username": "Taken", "adult": True, "terms_version": terms_version()}
    assert (
        c.post("/api/account/google/register", json={**payload, "adult": False}).status_code == 400
    )
    assert (
        c.post("/api/account/google/register", json={**payload, "terms_version": "old"}).status_code
        == 400
    )
    assert c.post("/api/account/google/register", json=payload).status_code == 409
    payload["username"] = "Available"
    assert c.post("/api/account/google/register", json=payload).status_code == 200
    c.post("/api/account/logout")
    assert c.post("/api/account/google/register", json=payload).status_code == 401


def test_explicit_link_identity_preservation_unique_link_and_unlink(token, monkeypatch):
    c = client()
    original = signup(c)["account"]
    monkeypatch.setenv("ADMIN_ACCOUNT_ID", original["id"])
    with Session.begin() as db:
        user = db.get(Account, original["id"])
        user.premium = True
        user.monthly_budget_nano = 12345
    assert finish(c, token, "link").json() == {"linked": True}
    other = client()
    signup(other, "Other")
    assert finish(other, token, "link").status_code == 409
    assert c.post("/api/account/google/start", json={"purpose": "login"}).status_code == 409
    second = client()
    data = finish(second, token).json()["account"]
    assert data["id"] == original["id"] and data["isAdmin"] and data["premium"]
    assert c.post("/api/account/google/unlink").status_code == 200
    assert second.get("/api/account").json()["account"] is None
    assert c.get("/api/account").json()["account"]["id"] == original["id"]
    assert finish(client(), token).json().get("signup")


def test_recent_auth_disabled_and_last_method_protection(token):
    c = client()
    account = register(c, token)["account"]
    assert c.post("/api/account/google/unlink").status_code == 409
    with Session.begin() as db:
        db.get(AuthFresh, digest(c.cookies.get(COOKIE))).expires_at = 1
    assert c.post("/api/account/google/unlink").status_code == 403
    c.post("/api/account/logout")
    assert finish(c, token).status_code == 200
    key, _ = enroll(c)
    assert c.post("/api/account/google/unlink").status_code == 200
    with Session() as db:
        pk = db.query(Passkey).one().id
    assert c.delete("/api/account/passkeys/" + pk).status_code == 409
    with Session() as db:
        assert db.query(Passkey).count() == 1
    assert finish(c, token, "link").status_code == 200
    assert c.delete("/api/account/passkeys/" + pk).status_code == 200
    with Session.begin() as db:
        db.get(Account, account["id"]).disabled = True
    assert finish(client(), token).status_code == 401


def test_concurrent_callback_only_one_wins(token):
    c = client()
    flow = start(c)
    payload = {"flow": flow["flow"], "credential": token(flow["nonce"])}

    def send(_):
        peer = client()
        peer.cookies.update(c.cookies)
        return peer.post("/api/account/google/finish", json=payload).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(send, range(2)))
    assert sorted(results) == [200, 401]


def test_unconfigured_and_no_secret_exposure(monkeypatch):
    monkeypatch.delenv("GOOGLE_CLIENT_ID", raising=False)
    c = client()
    assert c.get("/api/account/google").json() == {"enabled": False, "linked": False}
    assert c.post("/api/account/google/start", json={}).status_code == 503


def test_link_requires_original_live_session_and_pending_signup_is_browser_bound(token):
    c = client()
    signup(c)
    flow = start(c, "link")
    c.post("/api/account/logout")
    assert (
        c.post(
            "/api/account/google/finish",
            json={"flow": flow["flow"], "credential": token(flow["nonce"])},
        ).status_code
        == 401
    )
    ticket = finish(c, token).json()["signup"]
    payload = {
        "flow": ticket,
        "username": "NewPlayer",
        "adult": True,
        "terms_version": terms_version(),
    }
    assert client().post("/api/account/google/register", json=payload).status_code == 401
    with Session.begin() as db:
        db.get(GoogleFlow, ticket).expires_at = 1
    assert c.post("/api/account/google/register", json=payload).status_code == 401


def test_admin_deletion_cleans_google_records(token, monkeypatch):
    admin = client()
    owner = signup(admin, "Owner")["account"]
    monkeypatch.setenv("ADMIN_ACCOUNT_ID", owner["id"])
    c = client()
    user = register(c, token)["account"]
    start(c, "link")
    response = admin.request(
        "DELETE", "/api/admin/accounts/" + user["id"], json={"username": user["username"]}
    )
    assert response.status_code == 200, response.text
    with Session() as db:
        assert db.get(Account, user["id"]) is None
        assert db.query(GoogleIdentity).count() == 0
        assert db.query(GoogleFlow).filter_by(account_id=user["id"]).count() == 0


def test_deploy_reads_only_public_id_without_executing_environment(tmp_path):
    import runpy
    from pathlib import Path

    reader = runpy.run_path(
        str(Path(__file__).resolve().parents[2] / "scripts/google-client-id.py")
    )
    read = reader["configured_client_id"]
    key = reader["KEY"]
    path = tmp_path / "environment"
    path.write_text(
        'UNRELATED="$(never execute)"\n' + key + '="test.apps.googleusercontent.com" # comment\n'
    )
    assert read({}, path) == AUD
    assert read({key: "override.apps.googleusercontent.com"}, path).startswith("override.")
    path.write_text(key + '="$(touch unsafe)"\n')
    with pytest.raises(ValueError):
        read({}, path)
    path.write_text("UNRELATED=anything\n")
    assert read({}, path) == ""
