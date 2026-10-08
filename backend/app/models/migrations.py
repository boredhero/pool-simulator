"""Explicit, idempotent upgrade from the pre-premium schema (including live SQLite)."""

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import Boolean, Column, Integer, false, inspect


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
