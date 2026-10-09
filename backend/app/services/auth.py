"""Opaque cookie sessions and one-use account recovery. Never store credentials reversibly."""

import base64
import hashlib
import os
import re
import secrets
import threading
import time
from urllib.parse import urlsplit

from argon2 import PasswordHasher
from argon2.exceptions import VerificationError
from fastapi import HTTPException, Request, Response
from sqlalchemy import delete, or_, update

from app.models.db import Account, AuthFresh, AuthThrottle, LoginSession, Session, init_db

HASHER = PasswordHasher(time_cost=2, memory_cost=19456, parallelism=1)
DUMMY_HASH = HASHER.hash(secrets.token_urlsafe(32))
COOKIE = "pool_session"
USERNAME_CHANGE_SECONDS = 365 * 24 * 3600
SESSION_SECONDS = 30 * 24 * 3600
throttle_lock = threading.Lock()


def is_admin(account_id: str) -> bool:
    """Pin the operator's immutable ID; usernames never confer privileges."""
    owner = os.environ.get("ADMIN_ACCOUNT_ID", "")
    return bool(owner) and secrets.compare_digest(account_id, owner)


def public_account(user: Account) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "usernameChangedAt": user.username_changed_at,
        "usernameChangeAvailableAt": (
            user.username_changed_at + USERNAME_CHANGE_SECONDS
            if user.username_changed_at is not None
            else None
        ),
        "hasPassword": user.password_hash != "!",
        "createdAt": user.created_at,
        "lastActiveAt": user.last_active_at,
        "premium": user.premium,
        "simEnabled": user.sim_enabled,
        "isAdmin": is_admin(user.id),
    }


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def verify(encoded: str, value: str) -> bool:
    if encoded == "!":  # Explicitly disabled password for Google-created accounts.
        return False
    try:
        return HASHER.verify(encoded, value)
    except VerificationError:
        return False


def username_key(value: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_]{3,20}", value):
        raise HTTPException(422, "Username must be 3–20 letters, numbers, or underscores.")
    return value.lower()


def recovery_code() -> str:
    raw = base64.b32encode(secrets.token_bytes(20)).decode()
    return "-".join(raw[i : i + 4] for i in range(0, len(raw), 4))


def normalize_recovery(value: str) -> str:
    return re.sub(r"[\s-]", "", value).upper()


def allowed_origin(origin: str | None, host: str) -> bool:
    if not origin:  # Non-browser clients do not use ambient cookies automatically.
        return True
    allowed = os.environ.get("ALLOWED_ORIGINS", "").split(",")
    if origin in [item.strip() for item in allowed if item.strip()]:
        return True
    parsed = urlsplit(origin)
    return parsed.scheme in ("http", "https") and parsed.netloc == host


def mutation_guard(request: Request) -> None:
    if request.headers.get("x-pool-request") != "1" or not allowed_origin(
        request.headers.get("origin"), request.headers.get("host", "")
    ):
        raise HTTPException(403, "Request must come from this site.")


def rate_limit(scope: str, identity: str, limit: int, seconds: int = 600) -> None:
    """Durable fixed windows; single-worker room server serializes increments."""
    init_db()
    now = int(time.time())
    key = digest(scope + ":" + identity)
    with throttle_lock, Session.begin() as db:
        db.execute(delete(AuthThrottle).where(AuthThrottle.expires_at <= now))
        row = db.get(AuthThrottle, key)
        if row and row.attempts >= limit:
            raise HTTPException(429, "Too many attempts. Try again later.")
        if row:
            row.attempts += 1
        else:
            db.add(AuthThrottle(key=key, attempts=1, expires_at=now + seconds))


def account_for_token(token: str | None) -> dict | None:
    if not token or len(token) > 128:
        return None
    init_db()
    with Session() as db:
        session = db.get(LoginSession, digest(token))
        if not session or session.expires_at <= int(time.time()):
            return None
        user = db.get(Account, session.account_id)
        if not user or user.disabled:
            return None
        now = int(time.time())
        if user.last_active_at is None or user.last_active_at <= now - 60:
            db.execute(
                update(Account)
                .where(
                    Account.id == user.id,
                    Account.disabled.is_(False),
                    or_(Account.last_active_at.is_(None), Account.last_active_at <= now - 60),
                )
                .values(last_active_at=now)
            )
            db.commit()
        return public_account(user)


def current_account(request: Request) -> dict | None:
    return account_for_token(request.cookies.get(COOKIE))


def set_session(db, response: Response, request: Request, account_id: str) -> None:
    db.execute(
        update(Account).where(Account.id == account_id).values(last_active_at=int(time.time()))
    )
    token = secrets.token_urlsafe(32)
    now = int(time.time())
    db.execute(delete(LoginSession).where(LoginSession.expires_at <= now))
    db.execute(delete(AuthFresh).where(AuthFresh.expires_at <= now))
    db.add(AuthFresh(session_hash=digest(token), account_id=account_id, expires_at=now + 300))
    db.add(
        LoginSession(
            token_hash=digest(token), account_id=account_id, expires_at=now + SESSION_SECONDS
        )
    )
    secure = os.environ.get("COOKIE_SECURE", str(request.url.scheme == "https")).lower() == "true"
    response.set_cookie(
        COOKIE,
        token,
        max_age=SESSION_SECONDS,
        httponly=True,
        secure=secure,
        samesite="lax",
        path="/",
    )
    response.headers["Cache-Control"] = "no-store"
