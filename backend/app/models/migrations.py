"""Explicit, idempotent upgrade from the pre-premium schema (including live SQLite)."""

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import Boolean, Column, Integer, String, false, inspect, text


def upgrade_premium(connection) -> None:
    op = Operations(MigrationContext.configure(connection))
    columns = {column["name"]: column for column in inspect(connection).get_columns("accounts")}
    if "premium" not in columns:
        op.add_column(
            "accounts", Column("premium", Boolean, nullable=False, server_default=false())
        )
    day = next(c for c in inspect(connection).get_columns("jev_games") if c["name"] == "day")
    if not day["nullable"]:
        # SQLite needs a table copy to relax NOT NULL. Name reflected unique
        # constraints so Alembic preserves both free-game allowance guarantees.
        with op.batch_alter_table(
            "jev_games",
            naming_convention={"uq": "uq_%(table_name)s_%(column_0_name)s_%(column_1_name)s"},
        ) as batch:
            batch.alter_column("day", existing_type=Integer, nullable=True)


def upgrade_terms(connection) -> None:
    """Widen new hashes and preserve only provably identical legacy agreements."""
    from app.services.terms import LEGACY_HASH, LEGACY_VERSION, terms_version

    version = next(
        c for c in inspect(connection).get_columns("terms_acceptances") if c["name"] == "version"
    )
    if getattr(version["type"], "length", None) == 32:
        op = Operations(MigrationContext.configure(connection))
        with op.batch_alter_table("terms_acceptances") as batch:
            batch.alter_column(
                "version", existing_type=String(32), type_=String(64), existing_nullable=False
            )
    current = terms_version()
    if current == LEGACY_HASH:
        connection.execute(
            text("UPDATE terms_acceptances SET version = :current WHERE version = :legacy"),
            {"current": current, "legacy": LEGACY_VERSION},
        )


def upgrade_match_modes(connection) -> None:
    """Existing ledger rows describe online matches; preserve their counters."""
    op = Operations(MigrationContext.configure(connection))
    columns = {c["name"] for c in inspect(connection).get_columns("game_matches")}
    if "mode" not in columns:
        op.add_column(
            "game_matches", Column("mode", String(16), nullable=False, server_default="online")
        )
    if "shot_stats_complete" not in columns:
        op.add_column(
            "game_matches",
            Column("shot_stats_complete", Boolean, nullable=False, server_default="1"),
        )
