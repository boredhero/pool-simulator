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
        AuthThrottle,
        GameMatch,
        LoginSession,
        MatchPlayer,
        MatchShot,
        Session,
        init_db,
    )
    from app.net.rooms import lobby

    init_db()
    lobby.rooms.clear()
    with Session.begin() as db:
        for model in (MatchShot, MatchPlayer, GameMatch, LoginSession, AuthThrottle, Account):
            db.query(model).delete()
    yield
