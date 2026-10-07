"""SQLite (WAL) via SQLAlchemy 2.0. Swap DATABASE_URL for Postgres later."""

from __future__ import annotations

import os
from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text, create_engine, func
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
    Base.metadata.create_all(engine)
