from sqlalchemy import create_engine, event, text

from app.models.migrations import upgrade_terms
from app.services import terms


def test_repeated_terms_checks_do_not_issue_noop_updates(monkeypatch):
    monkeypatch.setattr(terms, "terms_version", lambda: terms.LEGACY_HASH)
    engine = create_engine("sqlite://")
    statements = []
    with engine.begin() as connection:
        connection.execute(
            text(
                "CREATE TABLE terms_acceptances (account_id VARCHAR(32) PRIMARY KEY, "
                "version VARCHAR(64) NOT NULL, accepted_at INTEGER NOT NULL)"
            )
        )
        event.listen(
            engine,
            "before_cursor_execute",
            lambda conn, cursor, statement, parameters, context, many: statements.append(statement),
        )
        upgrade_terms(connection)
        upgrade_terms(connection)
        assert sum(s.startswith("SELECT EXISTS") for s in statements) == 2
        assert not any(s.startswith("UPDATE") for s in statements)
        # A later legacy row must still migrate: this is deliberately not a global cache.
        connection.execute(text("INSERT INTO terms_acceptances VALUES ('old', '2026-10-08', 123)"))
        upgrade_terms(connection)
        upgrade_terms(connection)
        assert sum(s.startswith("UPDATE") for s in statements) == 1
        assert connection.execute(
            text("SELECT version, accepted_at FROM terms_acceptances WHERE account_id = 'old'")
        ).one() == (terms.LEGACY_HASH, 123)
