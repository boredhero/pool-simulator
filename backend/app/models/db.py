"""SQLite (WAL) via SQLAlchemy 2.0. Swap DATABASE_URL for Postgres later."""

from __future__ import annotations

import os

from sqlalchemy import (
    Boolean,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    create_engine,
    false,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./pool.db")


class Base(DeclarativeBase):
    pass


engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
)
Session = sessionmaker(bind=engine)


if DATABASE_URL.startswith("sqlite") and ":memory:" not in DATABASE_URL:
    from sqlalchemy import event as _sa_event

    @_sa_event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_conn, _conn_record) -> None:
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL;")
        cur.execute("PRAGMA busy_timeout=5000;")
        cur.execute("PRAGMA foreign_keys=ON;")
        cur.close()


def init_db() -> None:
    if DATABASE_URL.startswith("sqlite") and ":memory:" not in DATABASE_URL:
        path = DATABASE_URL.split("///")[-1]
        parent = os.path.dirname(os.path.abspath(path))
        os.makedirs(parent, exist_ok=True)
        try:
            fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            os.close(fd)
        except FileExistsError:
            pass
    Base.metadata.create_all(engine)
    from app.models.migrations import (
        upgrade_account_status,
        upgrade_jev_allowance,
        upgrade_match_modes,
        upgrade_premium,
        upgrade_terms,
    )

    with engine.begin() as connection:
        upgrade_account_status(connection)
        upgrade_premium(connection)
        upgrade_jev_allowance(connection)
        upgrade_terms(connection)
        upgrade_match_modes(connection)
        from app.services.matches import backfill_jev_matches

        backfill_jev_matches(connection)


class Account(Base):
    __tablename__ = "accounts"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    username: Mapped[str] = mapped_column(String(20))
    username_key: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(Text)
    recovery_hash: Mapped[str] = mapped_column(Text)
    created_at: Mapped[int] = mapped_column(Integer)
    premium: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    disabled: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())


class LoginSession(Base):
    __tablename__ = "login_sessions"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"), index=True)
    expires_at: Mapped[int] = mapped_column(Integer, index=True)


class AdminAudit(Base):
    __tablename__ = "admin_audit"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    actor_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"))
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"), index=True)
    old_premium: Mapped[bool] = mapped_column(Boolean)
    new_premium: Mapped[bool] = mapped_column(Boolean)
    occurred_at: Mapped[int] = mapped_column(Integer, index=True)


class AuthThrottle(Base):
    __tablename__ = "auth_throttles"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    attempts: Mapped[int] = mapped_column(Integer)
    expires_at: Mapped[int] = mapped_column(Integer, index=True)


class GameMatch(Base):
    __tablename__ = "game_matches"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    status: Mapped[str] = mapped_column(String(16), default="active", index=True)
    mode: Mapped[str] = mapped_column(String(16), default="online", server_default="online")
    shot_stats_complete: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1")
    ruleset: Mapped[str] = mapped_column(String(32), default="eight-ball:2")
    rules: Mapped[str] = mapped_column(Text)
    game_version: Mapped[str] = mapped_column(String(32))
    started_at: Mapped[int] = mapped_column(Integer)
    ended_at: Mapped[int | None] = mapped_column(Integer, nullable=True)
    winner_seat: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ended_by: Mapped[int | None] = mapped_column(Integer, nullable=True)


class MatchPlayer(Base):
    __tablename__ = "match_players"
    match_id: Mapped[str] = mapped_column(ForeignKey("game_matches.id"), primary_key=True)
    seat: Mapped[int] = mapped_column(Integer, primary_key=True)
    account_id: Mapped[str | None] = mapped_column(
        ForeignKey("accounts.id"), nullable=True, index=True
    )
    display_name: Mapped[str] = mapped_column(String(24))
    shots: Mapped[int] = mapped_column(Integer, default=0)
    potted: Mapped[int] = mapped_column(Integer, default=0)
    scratches: Mapped[int] = mapped_column(Integer, default=0)
    fouls: Mapped[int] = mapped_column(Integer, default=0)


class MatchShot(Base):
    __tablename__ = "match_shots"
    match_id: Mapped[str] = mapped_column(ForeignKey("game_matches.id"), primary_key=True)
    sequence: Mapped[int] = mapped_column(Integer, primary_key=True)
    seat: Mapped[int] = mapped_column(Integer)
    shot: Mapped[str] = mapped_column(Text)
    facts: Mapped[str] = mapped_column(Text)


class JevUsage(Base):
    """Lifetime provider attempts, independent of the daily game-start allowance."""

    __tablename__ = "jev_usage"
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"), primary_key=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    completed: Mapped[int] = mapped_column(Integer, default=0)


class JevGame(Base):
    __tablename__ = "jev_games"
    __table_args__ = (
        UniqueConstraint("account_id", "day", "daily_slot", name="uq_jev_daily_slot"),
    )
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"), index=True)
    # Free allowance day; premium games do not consume daily slots.
    day: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    daily_slot: Mapped[int | None] = mapped_column(Integer, nullable=True)
    network_hash: Mapped[str] = mapped_column(String(64), index=True)
    started_at: Mapped[int] = mapped_column(Integer)
    updated_at: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(16), default="active")
    state: Mapped[str] = mapped_column(Text)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    requests: Mapped[int] = mapped_column(Integer, default=0)
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    # Provider input price in nano-USD per token at creation: $0.042 / million.
    token_price_nano: Mapped[int] = mapped_column(Integer, default=42)
    estimated_cost_nano: Mapped[int] = mapped_column(Integer, default=0)
    unmetered_requests: Mapped[int] = mapped_column(Integer, default=0)


class TermsAcceptance(Base):
    __tablename__ = "terms_acceptances"
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"), primary_key=True)
    version: Mapped[str] = mapped_column(String(64))
    accepted_at: Mapped[int] = mapped_column(Integer)


class VisitorSession(Base):
    __tablename__ = "visitor_sessions"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    started_at: Mapped[int] = mapped_column(Integer, index=True)
    last_seen: Mapped[int] = mapped_column(Integer)
    consent_version: Mapped[str] = mapped_column(String(32))
    device: Mapped[str] = mapped_column(String(16))
    # No account link, IP, user agent, URL, referrer, or fingerprint in analytics.


class FeatureEvent(Base):
    __tablename__ = "feature_events"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("visitor_sessions.id"), index=True)
    name: Mapped[str] = mapped_column(String(32))
    occurred_at: Mapped[int] = mapped_column(Integer, index=True)


class AdminAccountAction(Base):
    __tablename__ = "admin_account_actions"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    actor_id: Mapped[str] = mapped_column(String(32))
    account_id: Mapped[str] = mapped_column(String(32), index=True)
    action: Mapped[str] = mapped_column(String(16))
    occurred_at: Mapped[int] = mapped_column(Integer)
