"""Isolated databases; tests must never open a developer's account database."""

import os
import tempfile

import pytest

_db_directory = tempfile.TemporaryDirectory(prefix="pool-tests-")
os.environ["DATABASE_URL"] = f"sqlite:///{_db_directory.name}/pool.db"
os.environ["COOKIE_SECURE"] = "false"


@pytest.fixture(autouse=True)
def clean_accounts_and_matches():
    from app.models.db import (
        Account,
        AdminAudit,
        AuthFresh,
        AuthThrottle,
        FeatureEvent,
        GameMatch,
        JevBudgetAdjustment,
        JevBudgetSetting,
        JevGame,
        JevRequest,
        JevUsage,
        LoginSession,
        MatchPlayer,
        MatchShot,
        Passkey,
        PasskeyChallenge,
        Session,
        TermsAcceptance,
        VisitorSession,
        init_db,
    )
    from app.net.rooms import lobby

    init_db()
    lobby.rooms.clear()
    with Session.begin() as db:
        for model in (
            JevRequest,
            JevBudgetSetting,
            JevBudgetAdjustment,
            AdminAudit,
            MatchShot,
            MatchPlayer,
            GameMatch,
            LoginSession,
            AuthFresh,
            Passkey,
            PasskeyChallenge,
            AuthThrottle,
            JevUsage,
            JevGame,
            TermsAcceptance,
            VisitorSession,
            FeatureEvent,
            JevGame,
            TermsAcceptance,
            FeatureEvent,
            VisitorSession,
            Account,
        ):
            db.query(model).delete()
    yield


@pytest.fixture(autouse=True)
def deterministic_breaker(monkeypatch):
    # Existing shot-flow tests intentionally exercise seat zero first. Coin tests override this.
    monkeypatch.setattr("app.sim.opening.choose_breaker", lambda: 0)
