"""Explicit consent for optional first-party analytics; no analytics read endpoints."""

import os
import secrets
import time
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict
from sqlalchemy import delete

from app.models.db import FeatureEvent, JevGame, Session, TermsAcceptance, VisitorSession, init_db
from app.services.auth import current_account, digest, mutation_guard, rate_limit
from app.services.terms import terms_version

router = APIRouter(prefix="/privacy")
VERSION = "2026-10-08"
COOKIE = "pool_analytics"


def require_terms(account):
    with Session() as db:
        accepted = db.get(TermsAcceptance, account["id"])
        if not accepted or accepted.version != terms_version():
            raise HTTPException(
                403, "Accept the current Terms in your Account panel before using Jev AI."
            )


class Agreement(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    version: str
    adult: Literal[True]
    accountId: str | None = None


@router.get("/terms")
def terms_status(request: Request, response: Response):
    response.headers["Cache-Control"] = "no-store"
    account = current_account(request)
    version = terms_version()
    accepted = False
    if account:
        with Session() as db:
            row = db.get(TermsAcceptance, account["id"])
            accepted = row is not None and row.version == version
    return {
        "version": version,
        "accepted": accepted,
        "authenticated": account is not None,
        "accountId": account["id"] if account else None,
    }


@router.post("/terms", dependencies=[Depends(mutation_guard)])
def accept_terms(payload: Agreement, request: Request):
    account = current_account(request)
    if not account:
        raise HTTPException(401, "Sign in first.")
    if payload.accountId is not None and payload.accountId != account["id"]:
        raise HTTPException(409, "Account changed. Review the Terms for your current account.")
    version = terms_version()
    if payload.version != version:
        raise HTTPException(409, "Terms changed. Review and accept the current Terms.")
    with Session.begin() as db:
        db.merge(
            TermsAcceptance(account_id=account["id"], version=version, accepted_at=int(time.time()))
        )
    return {"accepted": version}


def cleanup(db):
    # Analytics: 30 days. Private Jev usage/game records: 90 days.
    cutoff = int(time.time()) - 30 * 86400
    old = db.query(VisitorSession.id).filter(VisitorSession.last_seen < cutoff)
    db.execute(delete(FeatureEvent).where(FeatureEvent.session_id.in_(old)))
    db.execute(delete(VisitorSession).where(VisitorSession.last_seen < cutoff))
    db.execute(delete(JevGame).where(JevGame.updated_at < int(time.time()) - 90 * 86400))


class Consent(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    allow: bool
    version: Literal["2026-10-08"]
    adult: bool = False
    device: Literal["touch", "pointer"] = "pointer"


def remove_session(db, token):
    if token and len(token) <= 128:
        identity = digest(token)
        db.execute(delete(FeatureEvent).where(FeatureEvent.session_id == identity))
        db.execute(delete(VisitorSession).where(VisitorSession.id == identity))


@router.post("/consent", dependencies=[Depends(mutation_guard)])
def consent(payload: Consent, request: Request, response: Response):
    init_db()
    token = request.cookies.get(COOKIE)
    allowed = (
        payload.allow
        and payload.adult
        and request.headers.get("sec-gpc") != "1"
        and request.headers.get("dnt") != "1"
    )
    if allowed:
        rate_limit(
            "analytics-consent", request.client.host if request.client else "unknown", 20, 60
        )
    with Session.begin() as db:
        if not allowed:
            remove_session(db, token)
        cleanup(db)
        if allowed:
            token = secrets.token_urlsafe(32)
            now = int(time.time())
            db.add(
                VisitorSession(
                    id=digest(token),
                    started_at=now,
                    last_seen=now,
                    consent_version=VERSION,
                    device=payload.device,
                )
            )
            response.set_cookie(
                COOKIE,
                token,
                max_age=86400,
                httponly=True,
                secure=os.environ.get("COOKIE_SECURE", "true").lower() == "true",
                samesite="strict",
                path="/",
            )
            return {"analytics": True}
    response.delete_cookie(COOKIE, path="/")
    return {"analytics": False}


class Event(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    name: Literal[
        "session_start",
        "settings",
        "help",
        "camera",
        "online",
        "cpu",
        "jev",
        "new_rack",
        "spin_reset",
        "changelog",
    ]


@router.post("/events", dependencies=[Depends(mutation_guard)])
def feature(payload: Event, request: Request):
    token = request.cookies.get(COOKIE)
    if (
        not token
        or len(token) > 128
        or request.headers.get("sec-gpc") == "1"
        or request.headers.get("dnt") == "1"
    ):
        return Response(status_code=204)
    with Session() as db:
        session = db.get(VisitorSession, digest(token))
        now = int(time.time())
        if not session or session.consent_version != VERSION or session.started_at < now - 86400:
            return Response(status_code=204)
        # Bound writes per consented session; no cookie means no rate-limit identifier.
        identity = session.id
    rate_limit("analytics-events", identity, 200, 86400)
    rate_limit(
        "analytics-write-ip", request.client.host if request.client else "unknown", 2000, 86400
    )
    rate_limit("analytics-write-global", "all", 100000, 86400)
    with Session.begin() as db:
        session = db.get(VisitorSession, identity)
        if not session:
            return Response(status_code=204)
        session.last_seen = now
        db.add(
            FeatureEvent(
                id=secrets.token_hex(16), session_id=session.id, name=payload.name, occurred_at=now
            )
        )
    return Response(status_code=204)
