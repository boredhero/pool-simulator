import time

from fastapi.testclient import TestClient

from app.main import app
from app.models.db import Account, AdminAudit, JevGame, JevUsage, LoginSession, Session
from app.services.terms import terms_version

HEADERS = {"X-Pool-Request": "1"}


def register(name):
    client = TestClient(app)
    response = client.post(
        "/api/account/register",
        headers=HEADERS,
        json={
            "username": name,
            "password": "a long admin test password",
            "adult": True,
            "terms_version": terms_version(),
            "isAdmin": True,
        },
    )
    assert response.status_code == 200
    return client, response.json()["account"]


def owner(monkeypatch):
    client, account = register("god")
    monkeypatch.setenv("ADMIN_ACCOUNT_ID", account["id"])
    return client, account


def test_admin_is_pinned_to_id_and_guests_other_accounts_cannot_read_or_write(monkeypatch):
    admin, account = owner(monkeypatch)
    other, target = register("AnotherPlayer")
    assert admin.get("/api/account").json()["account"]["isAdmin"] is True
    assert other.get("/api/account").json()["account"]["isAdmin"] is False
    paths = ["/api/admin/overview", "/api/admin/accounts", f"/api/admin/accounts/{target['id']}"]
    for client in (TestClient(app), other):
        for path in paths:
            response = client.get(path)
            assert response.status_code == 404
            assert response.headers["cache-control"] == "no-store"
        assert (
            client.patch(
                f"/api/admin/accounts/{target['id']}/premium",
                headers=HEADERS,
                json={"premium": True},
            ).status_code
            == 404
        )
    with Session() as db:
        assert db.get(Account, target["id"]).premium is False
        assert db.query(AdminAudit).count() == 0
    # Username alone grants nothing, and configuration changes revoke access immediately.
    monkeypatch.delenv("ADMIN_ACCOUNT_ID")
    assert admin.get("/api/admin/overview").status_code == 404
    monkeypatch.setenv("ADMIN_ACCOUNT_ID", target["id"])
    assert admin.get("/api/admin/overview").status_code == 404
    assert other.get("/api/admin/overview").status_code == 200
    assert not any(path.startswith("/api/admin") for path in app.openapi()["paths"])


def test_premium_mutation_requires_csrf_strict_boolean_and_logs_real_changes(monkeypatch):
    admin, actor = owner(monkeypatch)
    user, target = register("ManagedPlayer")
    path = f"/api/admin/accounts/{target['id']}/premium"
    assert admin.patch(path, json={"premium": True}).status_code == 403
    assert (
        admin.patch(
            path, headers={**HEADERS, "Origin": "https://untrusted.example"}, json={"premium": True}
        ).status_code
        == 403
    )
    for payload in ({"premium": "true"}, {"premium": True, "isAdmin": True}):
        assert admin.patch(path, headers=HEADERS, json=payload).status_code == 422
    for flag in (True, True, False):
        result = admin.patch(path, headers=HEADERS, json={"premium": flag})
        assert result.json() == {"id": target["id"], "premium": flag}
        assert user.get("/api/account").json()["account"]["premium"] is flag
    with Session() as db:
        audits = db.query(AdminAudit).all()
        assert len(audits) == 2
        assert all(a.actor_id == actor["id"] and a.account_id == target["id"] for a in audits)
        assert {(a.old_premium, a.new_premium) for a in audits} == {(False, True), (True, False)}
    assert (
        admin.patch(
            "/api/admin/accounts/missing/premium", headers=HEADERS, json={"premium": True}
        ).status_code
        == 404
    )
    with Session.begin() as db:
        db.query(LoginSession).filter(LoginSession.account_id == actor["id"]).update(
            {"expires_at": 0}
        )
    assert admin.get("/api/admin/accounts").status_code == 404


def test_dashboard_filters_paginates_and_sums_stored_cost_without_exposing_secrets(monkeypatch):
    admin, _ = owner(monkeypatch)
    _, target = register("MeteredPlayer")
    _, free = register("FreePlayer")
    now = int(time.time())
    with Session.begin() as db:
        db.get(Account, target["id"]).premium = True
        db.add(JevUsage(account_id=target["id"], attempts=12, completed=9))
        for i in range(2):
            db.add(
                JevGame(
                    id=f"g{i}",
                    account_id=target["id"],
                    day=None,
                    network_hash="private-network-hash",
                    started_at=now - i,
                    updated_at=now,
                    state="private-saved-state",
                    requests=3,
                    input_tokens=100,
                    output_tokens=20,
                    estimated_cost_nano=4200,
                    unmetered_requests=1,
                )
            )
    overview = admin.get("/api/admin/overview")
    assert overview.headers["cache-control"] == "no-store"
    data = overview.json()
    assert (data["accounts"], data["premium"], data["lifetimeAttempts"]) == (3, 1, 12)
    assert data["usage"]["estimated_cost_nano"] == 8400
    assert data["usage"]["unmetered_requests"] == 2
    result = admin.get("/api/admin/accounts?premium=premium&search=METERED&sort=cost").json()
    assert result["total"] == 1 and result["accounts"][0]["id"] == target["id"]
    assert result["accounts"][0]["usage"]["requests"] == 6
    assert admin.get("/api/admin/accounts?search=%25").json()["total"] == 0
    page = admin.get("/api/admin/accounts?sort=username&direction=asc&limit=1&offset=1").json()
    assert page["total"] == 3 and len(page["accounts"]) == 1
    assert admin.get("/api/admin/accounts?limit=1000").status_code == 422
    detail = admin.get(f"/api/admin/accounts/{target['id']}")
    assert detail.json()["lifetimeCompleted"] == 9
    assert len(detail.json()["games"]) == 2
    assert admin.get(f"/api/admin/accounts/{free['id']}").json()["games"] == []
    for response in (overview, detail, admin.get("/api/admin/accounts")):
        for secret in (
            "password_hash",
            "recovery_hash",
            "token_hash",
            "network_hash",
            "private-saved-state",
            "private-network-hash",
        ):
            assert secret not in response.text
