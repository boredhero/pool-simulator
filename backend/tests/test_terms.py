import hashlib
import json

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text

from app.api.privacy import require_terms
from app.main import app
from app.models.db import Session, TermsAcceptance
from app.models.migrations import upgrade_terms
from app.services import terms

HEADERS = {"X-Pool-Request": "1"}


def test_contract_matches_current_agreement_and_markup_is_not_a_new_agreement():
    source = (terms.ROOT / "frontend/public/terms.html").read_text()
    version = hashlib.sha256(terms.canonical_terms(source).encode()).hexdigest()
    assert json.loads((terms.ROOT / "contracts/terms.json").read_text())["version"] == version
    assert terms.canonical_terms(
        "<main><nav>old menu</nav><p>A &amp; B</p></main>"
    ) == terms.canonical_terms(
        "<main><nav>new menu</nav><p> A   &amp; B </p><style>hidden</style></main>"
    )
    assert terms.canonical_terms("<main>A B</main>") != terms.canonical_terms("<main>A C</main>")


@pytest.mark.parametrize("same_text", [True, False])
def test_legacy_migration_widens_hash_and_only_grandfathers_identical_text(monkeypatch, same_text):
    engine = create_engine("sqlite://")
    current = terms.LEGACY_HASH if same_text else "0" * 64
    monkeypatch.setattr(terms, "terms_version", lambda: current)
    with engine.begin() as connection:
        connection.execute(
            text(
                "CREATE TABLE terms_acceptances (account_id VARCHAR(32) PRIMARY KEY, "
                "version VARCHAR(32) NOT NULL, accepted_at INTEGER NOT NULL)"
            )
        )
        connection.execute(
            text("INSERT INTO terms_acceptances VALUES ('existing', '2026-10-08', 123)")
        )
        upgrade_terms(connection)
        upgrade_terms(connection)
        row = connection.execute(text("SELECT version, accepted_at FROM terms_acceptances")).one()
        assert row == (current if same_text else terms.LEGACY_VERSION, 123)
        column = next(
            c
            for c in inspect(connection).get_columns("terms_acceptances")
            if c["name"] == "version"
        )
        assert column["type"].length == 64
        assert not column["nullable"]


def test_account_acceptance_tracks_actual_text_across_sessions(monkeypatch, tmp_path):
    source = (terms.ROOT / "frontend/public/terms.html").read_text()
    path = tmp_path / "terms.html"
    path.write_text(source)
    monkeypatch.setattr(terms, "terms_path", lambda: path)
    with TestClient(app) as client:
        initial = client.get("/api/privacy/terms")
        version = initial.json()["version"]
        assert initial.headers["cache-control"] == "no-store"
        assert initial.json() == {
            "version": version,
            "accepted": False,
            "authenticated": False,
            "accountId": None,
        }
        credentials = {
            "username": "TermReader",
            "password": "this is a long test password",
            "adult": True,
        }
        assert (
            client.post(
                "/api/account/register",
                headers=HEADERS,
                json={**credentials, "terms_version": "2026-10-08"},
            ).status_code
            == 400
        )
        registered = client.post(
            "/api/account/register", headers=HEADERS, json={**credentials, "terms_version": version}
        )
        assert registered.status_code == 200
        account = registered.json()["account"]
        assert client.get("/api/privacy/terms").json()["accountId"] == account["id"]
        assert client.get("/api/privacy/terms").json()["accepted"] is True
        with Session.begin() as db:
            saved = db.get(TermsAcceptance, account["id"])
            saved.version = terms.LEGACY_VERSION
            saved.accepted_at = 123
        assert client.get("/api/privacy/terms").json()["accepted"] is True
        with Session() as db:
            assert db.get(TermsAcceptance, account["id"]).accepted_at == 123
        client.cookies.clear()
        assert client.get("/api/privacy/terms").json()["accepted"] is False
        assert (
            client.post("/api/account/login", headers=HEADERS, json=credentials).status_code == 200
        )
        assert client.get("/api/privacy/terms").json()["accepted"] is True
        path.write_text(source.replace("No gambling", "No betting or gambling"))
        changed = client.get("/api/privacy/terms").json()
        assert (
            changed["version"] != version and not changed["accepted"] and changed["authenticated"]
        )
        with pytest.raises(HTTPException, match="Accept the current Terms"):
            require_terms(account)
        assert (
            client.post(
                "/api/privacy/terms",
                headers=HEADERS,
                json={"version": changed["version"], "adult": True, "accountId": "other-account"},
            ).status_code
            == 409
        )
        assert client.get("/api/privacy/terms").json()["accepted"] is False
        assert (
            client.post(
                "/api/privacy/terms", headers=HEADERS, json={"version": version, "adult": True}
            ).status_code
            == 409
        )
        assert (
            client.post(
                "/api/privacy/terms",
                headers=HEADERS,
                json={"version": changed["version"], "adult": False},
            ).status_code
            == 422
        )
        assert client.post(
            "/api/privacy/terms",
            headers=HEADERS,
            json={"version": changed["version"], "adult": True, "accountId": account["id"]},
        ).json() == {"accepted": changed["version"]}
        assert client.get("/api/privacy/terms").json()["accepted"] is True
        require_terms(account)
