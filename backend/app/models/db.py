"""SQLite (WAL) via SQLAlchemy 2.0. Swap DATABASE_URL for Postgres later."""

from __future__ import annotations

import os
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, create_engine, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./pool.db")


class Base(DeclarativeBase):
    pass


class Score(Base):
    __tablename__ = "scores"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    device_id: Mapped[str] = mapped_column(String(64), default="")
    winner: Mapped[str] = mapped_column(String(16), default="")
    created: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class Replay(Base):
    __tablename__ = "replays"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    seed: Mapped[int] = mapped_column(Integer, default=0)
    shots: Mapped[str] = mapped_column(Text, default="[]")  # JSON shot log
    created: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


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


class Account(Base):
    __tablename__ = "accounts"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    username: Mapped[str] = mapped_column(String(20))
    username_key: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(Text)
    recovery_hash: Mapped[str] = mapped_column(Text)
    created_at: Mapped[int] = mapped_column(Integer)


class LoginSession(Base):
    __tablename__ = "login_sessions"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"), index=True)
    expires_at: Mapped[int] = mapped_column(Integer, index=True)


class AuthThrottle(Base):
    __tablename__ = "auth_throttles"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    attempts: Mapped[int] = mapped_column(Integer)
    expires_at: Mapped[int] = mapped_column(Integer, index=True)


class GameMatch(Base):
    __tablename__ = "game_matches"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    status: Mapped[str] = mapped_column(String(16), default="active", index=True)
    ruleset: Mapped[str] = mapped_column(String(32), default="eight-ball:1")
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
