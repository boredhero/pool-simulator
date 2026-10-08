"""Verify real WebAuthn signatures and hostile ceremony variants."""

import hashlib
import json
import secrets

import cbor2
import pytest
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient
from test_accounts import PASSWORD, signup
from webauthn.helpers import base64url_to_bytes
from webauthn.helpers import bytes_to_base64url as b64

from app.main import app
from app.models.db import Account, AuthFresh, Passkey, PasskeyChallenge, Session

ORIGIN = "https://pool.martinospizza.dev"
RP = "pool.martinospizza.dev"
HEADERS = {"X-Pool-Request": "1", "Origin": ORIGIN}
BASE = "/api/account/passkeys"


@pytest.fixture(autouse=True)
def rp_config(monkeypatch):
    monkeypatch.setenv("WEBAUTHN_ORIGIN", ORIGIN)
    monkeypatch.setenv("WEBAUTHN_RP_ID", RP)


def client():
    return TestClient(app, base_url=ORIGIN)


def post(c, path, payload=None):
    return c.post(BASE + path, json=payload or {}, headers=HEADERS)


class Authenticator:
    def __init__(self):
        self.private = ec.generate_private_key(ec.SECP256R1())
        self.id = secrets.token_bytes(32)
        self.account = None

    def response(self, opts, register=False, origin=ORIGIN, rp=RP, uv=True, count=0):
        options = opts["options"]
        data = json.dumps(
            {
                "type": "webauthn.create" if register else "webauthn.get",
                "challenge": options["challenge"],
                "origin": origin,
            }
        ).encode()
        flags = 1 | (4 if uv else 0) | 8 | 16 | (64 if register else 0)
        auth = hashlib.sha256(rp.encode()).digest() + bytes([flags]) + count.to_bytes(4, "big")
        if register:
            self.account = options["user"]["id"]
            pub = self.private.public_key().public_numbers()
            cose = cbor2.dumps(
                {1: 2, 3: -7, -1: 1, -2: pub.x.to_bytes(32, "big"), -3: pub.y.to_bytes(32, "big")}
            )
            auth += bytes(16) + len(self.id).to_bytes(2, "big") + self.id + cose
            response = {
                "attestationObject": b64(
                    cbor2.dumps({"fmt": "none", "attStmt": {}, "authData": auth})
                ),
                "transports": ["internal", "hybrid"],
            }
        else:
            signature = self.private.sign(
                auth + hashlib.sha256(data).digest(), ec.ECDSA(hashes.SHA256())
            )
            response = {
                "authenticatorData": b64(auth),
                "signature": b64(signature),
                "userHandle": self.account,
            }
        response["clientDataJSON"] = b64(data)
        return {
            "ceremony": opts["ceremony"],
            "name": "Personal passkey",
            "credential": {
                "id": b64(self.id),
                "rawId": b64(self.id),
                "type": "public-key",
                "response": response,
                "clientExtensionResults": {},
            },
        }


def enroll(c, auth=None):
    auth = auth or Authenticator()
    options = post(c, "/register/options")
    assert options.status_code == 200, options.text
    response = post(c, "/register/verify", auth.response(options.json(), register=True))
    assert response.status_code == 200, response.text
    return auth, response.json()["passkey"]


def login(c, auth, **kwargs):
    options = post(c, "/login/options")
    assert options.status_code == 200, options.text
    payload = auth.response(options.json(), **kwargs)
    return post(c, "/login/verify", payload), payload


def test_multiple_discoverable_passkeys_rename_remove_and_session_revocation():
    c = client()
    account = signup(c)["account"]
    one, first = enroll(c)
    two, _ = enroll(c)
    options = post(c, "/register/options").json()["options"]
    assert options["authenticatorSelection"]["residentKey"] == "required"
    assert options["authenticatorSelection"]["userVerification"] == "required"
    assert "authenticatorAttachment" not in options["authenticatorSelection"]
    assert len(options["excludeCredentials"]) == 2
    other = client()
    result, payload = login(other, one)
    assert result.status_code == 200, result.text
    assert result.json()["account"]["id"] == account["id"]
    assert post(other, "/login/verify", payload).status_code == 400
    assert (
        other.patch(BASE + "/" + first["id"], json={"name": "Phone"}, headers=HEADERS).status_code
        == 200
    )
    listed = other.get(BASE).json()["passkeys"]
    assert listed[0]["lastUsedAt"] and listed[0]["backedUp"] and listed[0]["name"] == "Phone"
    assert "public_key" not in str(listed)
    assert other.delete(BASE + "/" + first["id"], headers=HEADERS).status_code == 200
    assert c.get("/api/account").json()["account"] is None
    assert login(client(), one)[0].status_code == 401
    assert login(client(), two)[0].status_code == 200


@pytest.mark.parametrize(
    "kwargs", [{"origin": "https://evil.example"}, {"rp": "evil.example"}, {"uv": False}]
)
def test_registration_verification(kwargs):
    c = client()
    signup(c)
    opts = post(c, "/register/options").json()
    payload = Authenticator().response(opts, register=True, **kwargs)
    assert post(c, "/register/verify", payload).status_code == 400
    assert post(c, "/register/verify", payload).status_code == 400
    assert c.get(BASE).json()["passkeys"] == []


@pytest.mark.parametrize("variant", ["origin", "rp", "uv", "signature", "handle", "challenge"])
def test_login_rejects_tampering(variant):
    c = client()
    signup(c)
    auth, _ = enroll(c)
    stranger = client()
    opts = post(stranger, "/login/options").json()
    kwargs = {
        "origin": {"origin": "https://evil.example"},
        "rp": {"rp": "evil.example"},
        "uv": {"uv": False},
    }.get(variant, {})
    payload = auth.response(opts, **kwargs)
    response = payload["credential"]["response"]
    if variant == "signature":
        response["signature"] = b64(b"bad")
    if variant == "handle":
        response["userHandle"] = b64(b"other-user")
    if variant == "challenge":
        data = json.loads(base64url_to_bytes(response["clientDataJSON"]))
        data["challenge"] = b64(secrets.token_bytes(32))
        response["clientDataJSON"] = b64(json.dumps(data).encode())
    assert post(stranger, "/login/verify", payload).status_code == 401
    assert post(stranger, "/login/verify", payload).status_code == 400
    assert stranger.get("/api/account").json()["account"] is None


def test_binding_expiry_duplicate_and_fresh_authentication():
    c = client()
    signup(c)
    auth, key = enroll(c)
    opts = post(c, "/register/options").json()
    assert post(c, "/register/verify", auth.response(opts, register=True)).status_code == 409
    stranger = client()
    opts = post(c, "/login/options").json()
    payload = auth.response(opts)
    assert post(stranger, "/login/verify", payload).status_code == 400
    with Session.begin() as db:
        db.query(PasskeyChallenge).update({"expires_at": 0})
        db.query(AuthFresh).update({"expires_at": 0})
    assert post(c, "/login/verify", payload).status_code == 400
    assert post(c, "/register/options").status_code == 403
    assert c.delete(BASE + "/" + key["id"], headers=HEADERS).status_code == 403
    assert post(c, "/reauth/password", {"password": "wrong"}).status_code == 401
    assert post(c, "/reauth/password", {"password": PASSWORD}).status_code == 200
    assert post(c, "/register/options").status_code == 200
    with Session.begin() as db:
        db.query(AuthFresh).update({"expires_at": 0})
    opts = post(c, "/reauth/options").json()
    assert post(c, "/reauth/verify", auth.response(opts)).status_code == 200
    assert c.get(BASE).json()["recentlyVerified"]


def test_owner_isolation_logout_disabled_and_recovery():
    c = client()
    data = signup(c)
    auth, key = enroll(c)
    other = client()
    signup(other, "AnotherPlayer")
    other_auth, _ = enroll(other)
    assert other.delete(BASE + "/" + key["id"], headers=HEADERS).status_code == 404
    assert (
        other.patch(BASE + "/" + key["id"], json={"name": "Stolen"}, headers=HEADERS).status_code
        == 404
    )
    opts = post(c, "/reauth/options").json()
    assert post(c, "/reauth/verify", other_auth.response(opts)).status_code == 401
    opts = post(c, "/register/options").json()
    c.post("/api/account/logout", json={}, headers=HEADERS)
    assert (
        post(c, "/register/verify", Authenticator().response(opts, register=True)).status_code
        == 400
    )
    with Session.begin() as db:
        db.get(Account, data["account"]["id"]).disabled = True
    assert login(client(), auth)[0].status_code == 401
    with Session.begin() as db:
        db.get(Account, data["account"]["id"]).disabled = False
    assert login(c, auth)[0].status_code == 200
    assert (
        c.post(
            "/api/account/recover",
            headers=HEADERS,
            json={
                "username": "Pool_Player",
                "password": secrets.token_urlsafe(24),
                "recovery": data["recovery"],
            },
        ).status_code
        == 200
    )
    assert login(client(), auth)[0].status_code == 401
    with Session() as db:
        assert db.query(Passkey).filter_by(account_id=data["account"]["id"]).count() == 0


def test_origin_csrf_and_counter_replay():
    c = client()
    signup(c)
    auth, _ = enroll(c)
    for headers in [
        {},
        {"X-Pool-Request": "1"},
        {"X-Pool-Request": "1", "Origin": "https://evil.example"},
    ]:
        assert c.post(BASE + "/login/options", headers=headers, json={}).status_code == 403
    assert login(client(), auth, count=1)[0].status_code == 200
    assert login(client(), auth, count=1)[0].status_code == 401
    assert login(client(), auth, count=2)[0].status_code == 200


def test_concurrent_finish_can_only_issue_one_session():
    from concurrent.futures import ThreadPoolExecutor

    from app.api.passkeys import BIND_COOKIE

    c = client()
    signup(c)
    auth, _ = enroll(c)
    source = client()
    opts = post(source, "/login/options").json()
    payload = auth.response(opts)

    def finish():
        contender = client()
        contender.cookies.set(BIND_COOKIE, source.cookies.get(BIND_COOKIE))
        return post(contender, "/login/verify", payload).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        codes = list(pool.map(lambda _: finish(), range(2)))
    assert sorted(codes) == [200, 400]


def test_cross_origin_frame_is_rejected():
    c = client()
    signup(c)
    options = post(c, "/register/options").json()
    payload = Authenticator().response(options, register=True)
    response = payload["credential"]["response"]
    data = json.loads(base64url_to_bytes(response["clientDataJSON"]))
    data["crossOrigin"] = True
    response["clientDataJSON"] = b64(json.dumps(data).encode())
    assert post(c, "/register/verify", payload).status_code == 400


def test_admin_deletion_cleans_credentials_and_pending_enrollment(monkeypatch):
    admin = client()
    owner = signup(admin, "Owner")["account"]
    monkeypatch.setenv("ADMIN_ACCOUNT_ID", owner["id"])
    c = client()
    account = signup(c)["account"]
    auth, _ = enroll(c)
    post(c, "/register/options")
    result = admin.request(
        "DELETE",
        "/api/admin/accounts/" + account["id"],
        headers=HEADERS,
        json={"username": account["username"]},
    )
    assert result.status_code == 200, result.text
    assert login(client(), auth)[0].status_code == 401
    with Session() as db:
        for model in (AuthFresh, Passkey, PasskeyChallenge):
            assert db.query(model).filter_by(account_id=account["id"]).count() == 0
