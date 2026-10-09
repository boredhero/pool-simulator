"""Google Identity Services: browser-bound, single-use login and explicit account linking."""

import os
import secrets
import time
from functools import lru_cache
from typing import Literal

import cachecontrol
import requests
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from google.auth.exceptions import GoogleAuthError
from google.auth.transport.requests import Request as GoogleRequest
from google.oauth2 import id_token
from pydantic import BaseModel, Field
from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError

from app.api.passkeys import lock_owner
from app.models.db import (
    Account,
    GoogleFlow,
    GoogleIdentity,
    LoginSession,
    Passkey,
    Session,
    TermsAcceptance,
)
from app.services.auth import (
    COOKIE,
    HASHER,
    current_account,
    digest,
    mutation_guard,
    normalize_recovery,
    public_account,
    rate_limit,
    recovery_code,
    set_session,
    username_key,
)
from app.services.terms import terms_version

router = APIRouter(prefix="/account/google")
BIND_COOKIE = "pool_google"
TTL = 300


def client_id():
    return os.environ.get("GOOGLE_CLIENT_ID", "").strip()


def guard(request: Request, response: Response):
    mutation_guard(request)
    response.headers["Cache-Control"] = "no-store"
    if not client_id():
        raise HTTPException(503, "Google sign-in is not configured.")
    if request.headers.get("origin") != os.environ.get(
        "GOOGLE_ORIGIN", "https://pool.martinospizza.dev"
    ):
        raise HTTPException(403, "Google sign-in must start from this site.")
    rate_limit("google-ip", request.client.host if request.client else "unknown", 60)


class Start(BaseModel):
    purpose: Literal["login", "link"] = "login"


class Finish(BaseModel):
    flow: str = Field(min_length=64, max_length=64)
    credential: str = Field(min_length=1, max_length=16384)


class Signup(BaseModel):
    flow: str = Field(min_length=64, max_length=64)
    username: str = Field(min_length=3, max_length=20)
    terms_version: str
    adult: bool = False


@lru_cache(maxsize=1)
def google_request():
    # Respect Google's certificate cache headers; bound outbound verification latency.
    transport = GoogleRequest(session=cachecontrol.CacheControl(requests.Session()))
    return lambda *args, **kwargs: transport(*args, **{**kwargs, "timeout": 8})


def verify_token(credential, nonce):
    try:
        claims = id_token.verify_oauth2_token(credential, google_request(), client_id())
        subject = claims.get("sub")
        if (
            not isinstance(subject, str)
            or not subject
            or len(subject) > 255
            or not isinstance(claims.get("nonce"), str)
            or not secrets.compare_digest(claims["nonce"].encode(), nonce.encode())
        ):
            raise ValueError("Invalid identity or nonce")
        return subject
    except (ValueError, GoogleAuthError) as exc:
        raise HTTPException(401, "Google verification failed. Please try again.") from exc
    except requests.RequestException as exc:
        raise HTTPException(503, "Google verification is unavailable. Please try again.") from exc


def bound_flow(db, request, flow_id, purpose=None):
    flow = db.get(GoogleFlow, flow_id)
    if not flow or flow.expires_at <= int(time.time()) or (purpose and flow.purpose != purpose):
        raise HTTPException(401, "Google sign-in expired. Please start again.")
    binding = request.cookies.get(COOKIE if flow.account_id else BIND_COOKIE, "")
    if not binding or not secrets.compare_digest(flow.binding, digest(binding)):
        raise HTTPException(401, "Google sign-in belongs to another browser or session.")
    return flow


@router.get("")
def status(request: Request, response: Response):
    response.headers["Cache-Control"] = "no-store"
    account = current_account(request)
    with Session() as db:
        linked = bool(
            account
            and db.scalar(
                select(GoogleIdentity.subject).where(GoogleIdentity.account_id == account["id"])
            )
        )
    return {"enabled": bool(client_id()), "linked": linked}


@router.post("/start", dependencies=[Depends(guard)])
def start(payload: Start, request: Request, response: Response):
    account = current_account(request)
    if payload.purpose == "login" and account:
        raise HTTPException(
            409, "Sign out before switching accounts. To link Google, use account settings."
        )
    if payload.purpose == "link" and not account:
        raise HTTPException(401, "Sign in before linking Google.")
    now = int(time.time())
    with Session.begin() as db:
        if account:
            lock_owner(db, request, account["id"])
        binding = request.cookies.get(COOKIE if account else BIND_COOKIE)
        if not binding or len(binding) > 128:
            binding = secrets.token_urlsafe(32)
        if not account:
            response.set_cookie(
                BIND_COOKIE,
                binding,
                max_age=TTL * 2,
                httponly=True,
                secure=os.environ.get("GOOGLE_ORIGIN", "https:").startswith("https:"),
                samesite="strict",
                path="/",
            )
        db.execute(delete(GoogleFlow).where(GoogleFlow.expires_at <= now))
        flow = GoogleFlow(
            id=secrets.token_hex(32),
            nonce=secrets.token_hex(32),
            binding=digest(binding),
            purpose=payload.purpose,
            account_id=account["id"] if account else None,
            expires_at=now + TTL,
        )
        db.add(flow)
        return {"flow": flow.id, "nonce": flow.nonce, "clientId": client_id()}


@router.post("/finish", dependencies=[Depends(guard)])
def finish(payload: Finish, request: Request, response: Response):
    # Consume before external verification, so parallel/replayed callbacks cannot win twice.
    with Session.begin() as db:
        flow = bound_flow(db, request, payload.flow)
        if flow.purpose not in ("login", "link"):
            raise HTTPException(401, "Start Google sign-in again.")
        consumed = db.execute(
            delete(GoogleFlow).where(GoogleFlow.id == flow.id).returning(GoogleFlow.id)
        ).scalar_one_or_none()
        if not consumed:
            raise HTTPException(401, "Google sign-in was already used.")
        nonce, purpose, account_id, binding = (
            flow.nonce,
            flow.purpose,
            flow.account_id,
            flow.binding,
        )
    subject = verify_token(payload.credential, nonce)
    try:
        with Session.begin() as db:
            if purpose == "link":
                lock_owner(db, request, account_id)
                if db.scalar(select(GoogleIdentity).where(GoogleIdentity.account_id == account_id)):
                    raise HTTPException(
                        409, "Google is already linked. Unlink it before changing Google accounts."
                    )
                db.add(
                    GoogleIdentity(
                        subject=subject, account_id=account_id, created_at=int(time.time())
                    )
                )
                db.flush()
                return {"linked": True}
            if current_account(request):
                raise HTTPException(409, "Your account changed. Reopen account settings.")
            # Serialize login with recovery, unlink, disable and deletion on SQLite.
            db.execute(
                update(Account)
                .where(
                    Account.id.in_(
                        select(GoogleIdentity.account_id).where(GoogleIdentity.subject == subject)
                    )
                )
                .values(last_active_at=int(time.time()))
            )
            identity = db.get(GoogleIdentity, subject)
            if identity:
                user = db.get(Account, identity.account_id)
                if not user or user.disabled:
                    raise HTTPException(401, "This account is unavailable.")
                old = request.cookies.get(COOKIE)
                if old:
                    db.execute(delete(LoginSession).where(LoginSession.token_hash == digest(old)))
                set_session(db, response, request, user.id)
                response.delete_cookie(BIND_COOKIE, path="/")
                return {"account": public_account(user)}
            ticket = secrets.token_hex(32)
            db.add(
                GoogleFlow(
                    id=ticket,
                    nonce="",
                    binding=binding,
                    purpose="signup",
                    subject=subject,
                    expires_at=int(time.time()) + TTL,
                )
            )
            return {"signup": ticket}
    except IntegrityError as exc:
        raise HTTPException(409, "That Google account is already linked to an account.") from exc


@router.post("/register", dependencies=[Depends(guard)])
def register(payload: Signup, request: Request, response: Response):
    if current_account(request):
        raise HTTPException(409, "Sign out before creating an account.")
    version = terms_version()
    if payload.terms_version != version or not payload.adult:
        raise HTTPException(400, "Review the current Terms and confirm you are 18 or older.")
    key = username_key(payload.username)
    code = recovery_code()
    try:
        with Session.begin() as db:
            flow = bound_flow(db, request, payload.flow, "signup")
            consumed = db.execute(
                delete(GoogleFlow).where(GoogleFlow.id == flow.id).returning(GoogleFlow.id)
            ).scalar_one_or_none()
            if not consumed:
                raise HTTPException(401, "Google signup was already used.")
            user = Account(
                id=secrets.token_hex(16),
                username=payload.username,
                username_key=key,
                password_hash="!",
                recovery_hash=HASHER.hash(normalize_recovery(code)),
                created_at=int(time.time()),
            )
            db.add(user)
            db.flush()
            db.add(
                GoogleIdentity(
                    subject=flow.subject, account_id=user.id, created_at=int(time.time())
                )
            )
            db.add(
                TermsAcceptance(account_id=user.id, version=version, accepted_at=int(time.time()))
            )
            set_session(db, response, request, user.id)
            result = public_account(user)
    except IntegrityError as exc:
        raise HTTPException(
            409,
            "That username or Google account is already in use. "
            "Choose another name, or sign in again.",
        ) from exc
    response.delete_cookie(BIND_COOKIE, path="/")
    return {"account": result, "recovery": code}


@router.post("/unlink", dependencies=[Depends(guard)])
def unlink(request: Request):
    account = current_account(request)
    if not account:
        raise HTTPException(401, "Sign in first.")
    with Session.begin() as db:
        session_hash = lock_owner(db, request, account["id"])
        user = db.get(Account, account["id"])
        if user.password_hash == "!" and not db.scalar(
            select(Passkey.id).where(Passkey.account_id == user.id)
        ):
            raise HTTPException(
                409, "Add a passkey before unlinking Google so you can still sign in."
            )
        db.execute(delete(GoogleIdentity).where(GoogleIdentity.account_id == user.id))
        db.execute(delete(GoogleFlow).where(GoogleFlow.account_id == user.id))
        db.execute(
            delete(LoginSession).where(
                LoginSession.account_id == user.id, LoginSession.token_hash != session_hash
            )
        )
    return {"linked": False}
