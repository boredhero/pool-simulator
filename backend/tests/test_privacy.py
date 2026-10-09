import time

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.api.privacy import cleanup
from app.main import app
from app.models.db import FeatureEvent, Session, VisitorSession
from app.services.terms import terms_version

HEADERS = {"X-Pool-Request": "1"}


def count(model):
    with Session() as db:
        return db.scalar(select(func.count()).select_from(model))


def test_no_optional_tracking_before_consent_and_withdrawal_deletes_session():
    with TestClient(app) as client:
        assert (
            client.post(
                "/api/privacy/events", headers=HEADERS, json={"name": "settings"}
            ).status_code
            == 204
        )
        assert count(VisitorSession) == count(FeatureEvent) == 0
        consent = client.post(
            "/api/privacy/consent",
            headers=HEADERS,
            json={"allow": True, "adult": True, "version": "2026-10-09", "device": "touch"},
        )
        assert consent.json()["analytics"] is True
        assert "HttpOnly" in consent.headers["set-cookie"]
        assert (
            client.post(
                "/api/privacy/events", headers=HEADERS, json={"name": "settings"}
            ).status_code
            == 204
        )
        assert count(VisitorSession) == count(FeatureEvent) == 1
        client.post(
            "/api/privacy/consent", headers=HEADERS, json={"allow": False, "version": "2026-10-09"}
        )
        assert count(VisitorSession) == count(FeatureEvent) == 0
        client.post("/api/privacy/events", headers=HEADERS, json={"name": "settings"})
        assert count(FeatureEvent) == 0


def test_global_privacy_signal_overrides_opt_in_and_events_are_bounded():
    with TestClient(app) as client:
        result = client.post(
            "/api/privacy/consent",
            headers={**HEADERS, "Sec-GPC": "1"},
            json={"allow": True, "adult": True, "version": "2026-10-09"},
        )
        assert result.json()["analytics"] is False
        assert count(VisitorSession) == 0
        assert (
            client.post(
                "/api/privacy/events", headers=HEADERS, json={"name": "arbitrary", "text": "secret"}
            ).status_code
            == 422
        )
        assert client.get("/api/privacy/events").status_code in (404, 405)


def test_retention_removes_old_events_sessions():
    old = int(time.time()) - 31 * 86400
    with Session.begin() as db:
        db.add(
            VisitorSession(
                id="old",
                started_at=old,
                last_seen=old,
                consent_version="2026-10-09",
                device="touch",
            )
        )
        db.flush()
        db.add(FeatureEvent(id="old-event", session_id="old", name="settings", occurred_at=old))
    with Session.begin() as db:
        cleanup(db)
    assert count(VisitorSession) == count(FeatureEvent) == 0


def test_terms_cannot_be_accepted_without_adult_affirmation():
    with TestClient(app) as client:
        credentials = {"username": "PrivacyPlayer", "password": "a long password for testing"}
        assert (
            client.post("/api/account/register", headers=HEADERS, json=credentials).status_code
            == 400
        )
        credentials.update(adult=True, terms_version=terms_version())
        assert (
            client.post("/api/account/register", headers=HEADERS, json=credentials).status_code
            == 200
        )
        assert (
            client.post(
                "/api/privacy/terms",
                headers=HEADERS,
                json={"adult": False, "version": "2026-10-09"},
            ).status_code
            == 422
        )


def test_daily_id_reuse_visit_deduplication_and_owner_aggregates(monkeypatch):
    from app.api.admin import visitor_counts
    from app.api.privacy import VERSION
    from app.services.auth import digest

    now = int(time.time())
    monkeypatch.setattr("app.api.privacy.time.time", lambda: now)
    with TestClient(app) as client:
        payload = {"allow": True, "adult": True, "version": VERSION}
        client.post("/api/privacy/consent", headers=HEADERS, json=payload)
        token = client.cookies["pool_analytics"]
        client.post("/api/privacy/events", headers=HEADERS, json={"name": "session_start"})
        client.post("/api/privacy/consent", headers=HEADERS, json=payload)
        assert client.cookies["pool_analytics"] == token
        client.post("/api/privacy/events", headers=HEADERS, json={"name": "session_start"})
        assert count(VisitorSession) == count(FeatureEvent) == 1
        with Session.begin() as db:
            db.get(VisitorSession, digest(token)).last_seen = now - 1801
        client.post("/api/privacy/events", headers=HEADERS, json={"name": "session_start"})
        with Session() as db:
            assert visitor_counts(db) == {"day": 2, "week": 2, "month": 2, "dailyVisitors": 1}
        assert client.get("/api/admin/overview").status_code == 404
        client.post("/api/privacy/consent", headers={**HEADERS, "DNT": "1"}, json=payload)
        assert count(VisitorSession) == count(FeatureEvent) == 0


def test_old_consent_requires_renewal_and_stale_ids_are_rejected():
    from app.api.privacy import VERSION

    with TestClient(app) as client:
        assert (
            client.post(
                "/api/privacy/consent",
                headers=HEADERS,
                json={"allow": True, "adult": True, "version": "2026-10-08"},
            ).status_code
            == 422
        )
        client.post(
            "/api/privacy/consent",
            headers=HEADERS,
            json={"allow": True, "adult": True, "version": VERSION},
        )
        with Session.begin() as db:
            for row in db.query(VisitorSession):
                row.started_at = int(time.time()) - 86401
        client.post("/api/privacy/events", headers=HEADERS, json={"name": "session_start"})
        assert count(FeatureEvent) == 0
        client.post(
            "/api/privacy/consent", headers=HEADERS, json={"allow": False, "version": VERSION}
        )
