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
            json={"allow": True, "adult": True, "version": "2026-10-08", "device": "touch"},
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
            "/api/privacy/consent", headers=HEADERS, json={"allow": False, "version": "2026-10-08"}
        )
        assert count(VisitorSession) == count(FeatureEvent) == 0
        client.post("/api/privacy/events", headers=HEADERS, json={"name": "settings"})
        assert count(FeatureEvent) == 0


def test_global_privacy_signal_overrides_opt_in_and_events_are_bounded():
    with TestClient(app) as client:
        result = client.post(
            "/api/privacy/consent",
            headers={**HEADERS, "Sec-GPC": "1"},
            json={"allow": True, "adult": True, "version": "2026-10-08"},
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
                consent_version="2026-10-08",
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
                json={"adult": False, "version": "2026-10-08"},
            ).status_code
            == 422
        )
