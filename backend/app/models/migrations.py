"""Explicit, idempotent upgrade from the pre-premium schema (including live SQLite)."""

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import Boolean, Column, Integer, String, Text, false, inspect, text


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
    if current == LEGACY_HASH and connection.scalar(
        text("SELECT EXISTS (SELECT 1 FROM terms_acceptances WHERE version = :legacy)"),
        {"legacy": LEGACY_VERSION},
    ):
        # SQLite takes a write lock even when an UPDATE would affect no rows.
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


def upgrade_jev_allowance(connection) -> None:
    """Replace legacy limits once; saved games and cost history remain intact."""
    if "daily_slot" in {c["name"] for c in inspect(connection).get_columns("jev_games")}:
        return
    op = Operations(MigrationContext.configure(connection))
    constraints = inspect(connection).get_unique_constraints("jev_games")
    with op.batch_alter_table(
        "jev_games",
        naming_convention={"uq": "uq_%(table_name)s_%(column_0_name)s_%(column_1_name)s"},
    ) as batch:
        batch.add_column(Column("daily_slot", Integer, nullable=True))
        for constraint in constraints:
            columns = constraint["column_names"]
            if columns in (["account_id", "day"], ["network_hash", "day"]):
                name = constraint["name"] or f"uq_jev_games_{columns[0]}_{columns[1]}"
                batch.drop_constraint(name, type_="unique")
        batch.create_unique_constraint("uq_jev_daily_slot", ["account_id", "day", "daily_slot"])
    # Existing rows have no slot: the new five-game allowance starts unused.


def upgrade_account_status(connection) -> None:
    if "disabled" not in {c["name"] for c in inspect(connection).get_columns("accounts")}:
        Operations(MigrationContext.configure(connection)).add_column(
            "accounts", Column("disabled", Boolean, nullable=False, server_default=false())
        )


def upgrade_easter_eggs(connection) -> None:
    columns = {c["name"] for c in inspect(connection).get_columns("accounts")}
    op = Operations(MigrationContext.configure(connection))
    if "settings_json" not in columns:
        op.add_column(
            "accounts", Column("settings_json", Text, nullable=False, server_default="{}")
        )
    for name in ("easter_eggs_enabled", "chalk_sim"):
        if name not in columns:
            op.add_column("accounts", Column(name, Boolean, nullable=False, server_default=false()))


def upgrade_simulation(connection) -> None:
    """Preserve used daily slots while adding owner-granted spectator games."""
    op = Operations(MigrationContext.configure(connection))
    if "sim_enabled" not in {c["name"] for c in inspect(connection).get_columns("accounts")}:
        op.add_column(
            "accounts", Column("sim_enabled", Boolean, nullable=False, server_default=false())
        )
    columns = {c["name"] for c in inspect(connection).get_columns("jev_games")}
    if "daily_cost" not in columns:
        op.add_column(
            "jev_games", Column("daily_cost", Integer, nullable=False, server_default="1")
        )
    if "simulation" not in columns:
        op.add_column(
            "jev_games", Column("simulation", String(16), nullable=False, server_default="")
        )


def upgrade_monthly_budget(connection) -> None:
    if "monthly_budget_nano" not in {
        c["name"] for c in inspect(connection).get_columns("accounts")
    }:
        Operations(MigrationContext.configure(connection)).add_column(
            "accounts", Column("monthly_budget_nano", Integer, nullable=True)
        )

    if "last_active_at" not in {c["name"] for c in inspect(connection).get_columns("accounts")}:
        Operations(MigrationContext.configure(connection)).add_column(
            "accounts", Column("last_active_at", Integer, nullable=True)
        )


def upgrade_username_changes(connection) -> None:
    if "username_changed_at" not in {
        c["name"] for c in inspect(connection).get_columns("accounts")
    }:
        Operations(MigrationContext.configure(connection)).add_column(
            "accounts", Column("username_changed_at", Integer, nullable=True)
        )
