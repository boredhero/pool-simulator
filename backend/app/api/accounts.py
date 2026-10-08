"""Optional accounts. Guest room creation never depends on these endpoints."""

import secrets
import time

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, update
from sqlalchemy.exc import IntegrityError

from app.models.db import Account, LoginSession, Session, init_db
from app.services.auth import (
    COOKIE,
    DUMMY_HASH,
    HASHER,
    current_account,
    digest,
    mutation_guard,
    normalize_recovery,
    rate_limit,
    recovery_code,
    set_session,
    username_key,
    verify,
)
from app.services.matches import account_stats

router = APIRouter(prefix="/account")


class Credentials(BaseModel):
    username: str = Field(min_length=3, max_length=20)
    password: str = Field(min_length=15, max_length=128)


class Recovery(Credentials):
    recovery: str = Field(min_length=1, max_length=128)


def attempts(request: Request, username: str) -> str:
    key = username_key(username)
    ip = request.client.host if request.client else "unknown"
    rate_limit("auth-ip", ip, 30)
    rate_limit("auth-user", key, 12)
    return key


@router.get("")
def me(request: Request, response: Response) -> dict:
    response.headers["Cache-Control"] = "no-store"
    user = current_account(request)
    if user is None and request.cookies.get(COOKIE):
        response.delete_cookie(COOKIE, path="/")
    return {"account": user, "stats": account_stats(user["id"]) if user else None}


@router.post("/register", dependencies=[Depends(mutation_guard)])
def register(payload: Credentials, request: Request, response: Response) -> dict:
    key = attempts(request, payload.username)
    code = recovery_code()
    user = Account(
        id=secrets.token_hex(16),
        username=payload.username,
        username_key=key,
        password_hash=HASHER.hash(payload.password),
        recovery_hash=HASHER.hash(normalize_recovery(code)),
        created_at=int(time.time()),
    )
    try:
        with Session.begin() as db:
            db.add(user)
            db.flush()
            set_session(db, response, request, user.id)
            result = {"id": user.id, "username": user.username, "createdAt": user.created_at}
    except IntegrityError as exc:
        raise HTTPException(409, "That username is already taken.") from exc
    return {"account": result, "recovery": code}


@router.post("/login", dependencies=[Depends(mutation_guard)])
def login(payload: Credentials, request: Request, response: Response) -> dict:
    key = attempts(request, payload.username)
    with Session.begin() as db:
        user = db.query(Account).filter_by(username_key=key).first()
        valid = verify(user.password_hash if user else DUMMY_HASH, payload.password)
        if not valid or user is None:
            raise HTTPException(401, "Username or password is incorrect.")
        # Serialize session issuance against password recovery. A stale verified password
        # must not create a new session after a concurrent reset revoked older sessions.
        old_hash = user.password_hash
        new_hash = (
            HASHER.hash(payload.password) if HASHER.check_needs_rehash(old_hash) else old_hash
        )
        changed = db.execute(
            update(Account)
            .where(Account.id == user.id, Account.password_hash == old_hash)
            .values(password_hash=new_hash)
        )
        if changed.rowcount != 1:
            raise HTTPException(401, "Credentials changed. Sign in again.")
        # Rotate rather than accepting an existing session token supplied by a client.
        old = request.cookies.get(COOKIE)
        if old:
            db.execute(delete(LoginSession).where(LoginSession.token_hash == digest(old)))
        set_session(db, response, request, user.id)
        return {"account": {"id": user.id, "username": user.username, "createdAt": user.created_at}}


@router.post("/logout", dependencies=[Depends(mutation_guard)])
def logout(request: Request, response: Response) -> dict:
    init_db()
    token = request.cookies.get(COOKIE)
    if token:
        with Session.begin() as db:
            db.execute(delete(LoginSession).where(LoginSession.token_hash == digest(token)))
    response.delete_cookie(COOKIE, path="/")
    response.headers["Cache-Control"] = "no-store"
    return {"ok": True}


@router.post("/recover", dependencies=[Depends(mutation_guard)])
def recover(payload: Recovery, request: Request, response: Response) -> dict:
    key = attempts(request, payload.username)
    code = recovery_code()
    with Session.begin() as db:
        user = db.query(Account).filter_by(username_key=key).first()
        old_hash = user.recovery_hash if user else DUMMY_HASH
        if not verify(old_hash, normalize_recovery(payload.recovery)) or user is None:
            raise HTTPException(401, "Username or recovery code is incorrect.")
        # Compare-and-swap makes concurrent reuse of the one-time code fail.
        changed = db.execute(
            update(Account)
            .where(Account.id == user.id, Account.recovery_hash == old_hash)
            .values(
                password_hash=HASHER.hash(payload.password),
                recovery_hash=HASHER.hash(normalize_recovery(code)),
            )
        )
        if changed.rowcount != 1:
            raise HTTPException(401, "Username or recovery code is incorrect.")
        db.execute(delete(LoginSession).where(LoginSession.account_id == user.id))
    response.delete_cookie(COOKIE, path="/")
    response.headers["Cache-Control"] = "no-store"
    return {"ok": True, "recovery": code}
