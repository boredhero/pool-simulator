"""Optional discoverable passkeys. Challenges are single-use and browser/session bound."""

import json
import os
import secrets
import time
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError
from webauthn import (
    generate_authentication_options,
    generate_registration_options,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url, options_to_json
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from app.models.db import Account, AuthFresh, LoginSession, Passkey, PasskeyChallenge, Session
from app.services.auth import (
    COOKIE,
    current_account,
    digest,
    mutation_guard,
    public_account,
    rate_limit,
    set_session,
    verify,
)

router = APIRouter(prefix="/account/passkeys")
BIND_COOKIE = "pool_passkey"
TTL = 300


class Finish(BaseModel):
    ceremony: str = Field(min_length=32, max_length=64)
    credential: dict
    name: str = Field(default="My passkey", min_length=1, max_length=64)


class Password(BaseModel):
    password: str = Field(min_length=1, max_length=128)


class Name(BaseModel):
    name: str = Field(min_length=1, max_length=64)


def config():
    # Never trust Host or forwarded headers to choose the relying party or origin.
    origin = os.environ.get("WEBAUTHN_ORIGIN", "https://pool.martinospizza.dev").rstrip("/")
    parsed = urlsplit(origin)
    rp_id = os.environ.get("WEBAUTHN_RP_ID", parsed.hostname or "")
    if (
        (
            parsed.scheme != "https"
            and not (parsed.scheme == "http" and parsed.hostname in ("localhost", "127.0.0.1"))
        )
        or parsed.path
        or parsed.query
        or parsed.fragment
        or not rp_id
        or (parsed.hostname != rp_id and not (parsed.hostname or "").endswith("." + rp_id))
    ):
        raise HTTPException(503, "Passkeys are not configured for this site.")
    return origin, rp_id


def guard(request: Request, response: Response):
    response.headers["Cache-Control"] = "no-store"
    mutation_guard(request)
    origin, _ = config()
    if request.headers.get("origin") != origin:
        raise HTTPException(403, "Passkeys must be used from this site's configured origin.")
    rate_limit("passkeys-ip", request.client.host if request.client else "unknown", 60)


def owner(request: Request):
    account = current_account(request)
    if account is None:
        raise HTTPException(401, "Sign in first.")
    return account


def lock_owner(db, request: Request, account_id: str, fresh=True):
    # Acquire the account write lock before reading sessions/credentials. Recovery,
    # disable and deletion cannot race with credential changes or session issuance.
    changed = db.execute(
        update(Account)
        .where(Account.id == account_id, Account.disabled.is_(False))
        .values(last_active_at=int(time.time()))
    )
    session_hash = digest(request.cookies.get(COOKIE, ""))
    session = db.get(LoginSession, session_hash)
    if (
        changed.rowcount != 1
        or not session
        or session.account_id != account_id
        or (session.expires_at <= int(time.time()))
    ):
        raise HTTPException(401, "Sign in again.")
    proof = db.get(AuthFresh, session_hash)
    if fresh and (not proof or proof.expires_at <= int(time.time())):
        raise HTTPException(403, "Verify your identity before changing passkeys.")
    return session_hash


def issue(db, request, response, purpose, options, account_id=None):
    origin, rp_id = config()
    now = int(time.time())
    db.execute(delete(PasskeyChallenge).where(PasskeyChallenge.expires_at <= now))
    binding = request.cookies.get(COOKIE) if account_id else request.cookies.get(BIND_COOKIE)
    if not binding or len(binding) > 128:
        binding = secrets.token_urlsafe(32)
    if not account_id:
        response.set_cookie(
            BIND_COOKIE,
            binding,
            max_age=TTL + 60,
            httponly=True,
            secure=origin.startswith("https:"),
            samesite="strict",
            path="/",
        )
    ceremony = secrets.token_hex(32)
    db.add(
        PasskeyChallenge(
            id=ceremony,
            challenge=bytes_to_base64url(options.challenge),
            purpose=purpose,
            binding=digest(binding),
            account_id=account_id,
            origin=origin,
            rp_id=rp_id,
            expires_at=now + TTL,
        )
    )
    response.headers["Cache-Control"] = "no-store"
    return {"ceremony": ceremony, "options": json.loads(options_to_json(options))}


def consume(request, ceremony, purpose):
    # Commit consumption even if verification fails. Replays and concurrent finishes fail.
    with Session.begin() as db:
        row = db.execute(
            delete(PasskeyChallenge)
            .where(
                PasskeyChallenge.id == ceremony,
                PasskeyChallenge.purpose == purpose,
                PasskeyChallenge.expires_at > int(time.time()),
                PasskeyChallenge.binding
                == digest(request.cookies.get(COOKIE if purpose != "login" else BIND_COOKIE, "")),
            )
            .returning(PasskeyChallenge)
        ).scalar_one_or_none()
        if row is None:
            raise HTTPException(400, "Passkey request expired or was already used. Try again.")
        result = {key: getattr(row, key) for key in ("challenge", "account_id", "origin", "rp_id")}
    if (result["origin"], result["rp_id"]) != config():
        raise HTTPException(400, "Passkey configuration changed. Try again.")
    return result


def same_origin_credential(credential):
    data = json.loads(base64url_to_bytes(credential["response"]["clientDataJSON"]))
    if data.get("crossOrigin", False) is not False or data.get("topOrigin"):
        raise ValueError("Embedded cross-origin authentication is not supported")


def listed(key):
    return {
        "id": key.id,
        "name": key.name,
        "createdAt": key.created_at,
        "lastUsedAt": key.last_used_at,
        "backedUp": key.backed_up,
    }


@router.get("")
def keys(request: Request, response: Response):
    account = owner(request)
    response.headers["Cache-Control"] = "no-store"
    with Session() as db:
        proof = db.get(AuthFresh, digest(request.cookies.get(COOKIE, "")))
        return {
            "passkeys": [
                listed(key)
                for key in db.scalars(
                    select(Passkey)
                    .where(Passkey.account_id == account["id"])
                    .order_by(Passkey.created_at)
                )
            ],
            "recentlyVerified": bool(proof and proof.expires_at > int(time.time())),
        }


@router.post("/reauth/password", dependencies=[Depends(guard)])
def reauth_password(payload: Password, request: Request):
    account = owner(request)
    rate_limit("passkey-reauth", account["id"], 8)
    with Session.begin() as db:
        session_hash = lock_owner(db, request, account["id"], fresh=False)
        user = db.get(Account, account["id"])
        if not verify(user.password_hash, payload.password):
            raise HTTPException(401, "Password is incorrect.")
        db.merge(
            AuthFresh(
                session_hash=session_hash, account_id=user.id, expires_at=int(time.time()) + TTL
            )
        )
    return {"ok": True}


@router.post("/register/options", dependencies=[Depends(guard)])
def registration_options(request: Request, response: Response):
    account = owner(request)
    with Session.begin() as db:
        lock_owner(db, request, account["id"])
        existing = db.scalars(select(Passkey).where(Passkey.account_id == account["id"])).all()
        if len(existing) >= 20:
            raise HTTPException(409, "Remove an unused passkey before adding another (limit 20).")
        options = generate_registration_options(
            rp_id=config()[1],
            rp_name="Pool Simulator",
            user_id=account["id"].encode(),
            user_name=account["username"],
            timeout=TTL * 1000,
            authenticator_selection=AuthenticatorSelectionCriteria(
                resident_key=ResidentKeyRequirement.REQUIRED,
                user_verification=UserVerificationRequirement.REQUIRED,
            ),
            exclude_credentials=[
                PublicKeyCredentialDescriptor(id=base64url_to_bytes(key.credential_id))
                for key in existing
            ],
        )
        return issue(db, request, response, "register", options, account["id"])


@router.post("/register/verify", dependencies=[Depends(guard)])
def registration_verify(payload: Finish, request: Request):
    proof = consume(request, payload.ceremony, "register")
    try:
        same_origin_credential(payload.credential)
        checked = verify_registration_response(
            credential=payload.credential,
            expected_challenge=base64url_to_bytes(proof["challenge"]),
            expected_rp_id=proof["rp_id"],
            expected_origin=proof["origin"],
            require_user_verification=True,
        )
    except Exception as exc:
        raise HTTPException(400, "Could not verify this passkey. Try again.") from exc
    try:
        with Session.begin() as db:
            lock_owner(db, request, proof["account_id"])
            if (
                len(
                    db.scalars(
                        select(Passkey.id).where(Passkey.account_id == proof["account_id"])
                    ).all()
                )
                >= 20
            ):
                raise HTTPException(409, "Passkey limit reached.")
            transports = payload.credential.get("response", {}).get("transports", [])
            allowed = {"usb", "nfc", "ble", "internal", "hybrid", "smart-card"}
            key = Passkey(
                id=secrets.token_hex(16),
                account_id=proof["account_id"],
                credential_id=bytes_to_base64url(checked.credential_id),
                public_key=bytes_to_base64url(checked.credential_public_key),
                sign_count=checked.sign_count,
                name=payload.name.strip() or "My passkey",
                transports=json.dumps(
                    [t for t in transports if isinstance(t, str) and t in allowed]
                )
                if isinstance(transports, list)
                else "[]",
                backed_up=checked.credential_backed_up,
                created_at=int(time.time()),
            )
            db.add(key)
            db.flush()
            return {"passkey": listed(key)}
    except IntegrityError as exc:
        raise HTTPException(409, "That passkey is already registered.") from exc


def authentication_options(request, response, purpose):
    account = owner(request) if purpose == "reauth" else None
    with Session.begin() as db:
        descriptors = []
        if account:
            lock_owner(db, request, account["id"], fresh=False)
            descriptors = [
                PublicKeyCredentialDescriptor(id=base64url_to_bytes(key.credential_id))
                for key in db.scalars(select(Passkey).where(Passkey.account_id == account["id"]))
            ]
            if not descriptors:
                raise HTTPException(400, "Use your password to verify your identity.")
        options = generate_authentication_options(
            rp_id=config()[1],
            timeout=TTL * 1000,
            allow_credentials=descriptors,
            user_verification=UserVerificationRequirement.REQUIRED,
        )
        return issue(db, request, response, purpose, options, account["id"] if account else None)


def authentication_verify(payload, request, response, purpose):
    proof = consume(request, payload.ceremony, purpose)
    try:
        credential_id = bytes_to_base64url(base64url_to_bytes(payload.credential["id"]))
    except Exception as exc:
        raise HTTPException(400, "Invalid passkey response.") from exc
    with Session.begin() as db:
        # Write first to serialize sign counters and revocation with concurrent logins.
        changed = db.execute(
            update(Passkey)
            .where(Passkey.credential_id == credential_id)
            .values(sign_count=Passkey.sign_count)
        )
        if changed.rowcount != 1:
            raise HTTPException(401, "Passkey not recognized. Use another sign-in method.")
        key = db.scalar(select(Passkey).where(Passkey.credential_id == credential_id))
        user = db.get(Account, key.account_id)
        if not user or user.disabled or (purpose == "reauth" and user.id != proof["account_id"]):
            raise HTTPException(401, "Passkey sign-in unavailable.")
        try:
            same_origin_credential(payload.credential)
            handle = payload.credential.get("response", {}).get("userHandle")
            if purpose == "login" and not handle:
                raise ValueError("Discoverable login requires a user handle")
            if handle and base64url_to_bytes(handle) != user.id.encode():
                raise ValueError("Wrong account handle")
            checked = verify_authentication_response(
                credential=payload.credential,
                expected_challenge=base64url_to_bytes(proof["challenge"]),
                expected_rp_id=proof["rp_id"],
                expected_origin=proof["origin"],
                credential_public_key=base64url_to_bytes(key.public_key),
                credential_current_sign_count=key.sign_count,
                require_user_verification=True,
            )
        except Exception as exc:
            raise HTTPException(401, "Could not verify this passkey. Try again.") from exc
        key.sign_count = checked.new_sign_count
        key.backed_up = checked.credential_backed_up
        key.last_used_at = int(time.time())
        if purpose == "reauth":
            session_hash = lock_owner(db, request, user.id, fresh=False)
            db.merge(
                AuthFresh(
                    session_hash=session_hash, account_id=user.id, expires_at=int(time.time()) + TTL
                )
            )
            return {"ok": True}
        old = request.cookies.get(COOKIE)
        if old:
            db.execute(delete(LoginSession).where(LoginSession.token_hash == digest(old)))
        set_session(db, response, request, user.id)
        return {"account": public_account(user)}


@router.post("/login/options", dependencies=[Depends(guard)])
def login_options(request: Request, response: Response):
    return authentication_options(request, response, "login")


@router.post("/login/verify", dependencies=[Depends(guard)])
def login_verify(payload: Finish, request: Request, response: Response):
    return authentication_verify(payload, request, response, "login")


@router.post("/reauth/options", dependencies=[Depends(guard)])
def reauth_options(request: Request, response: Response):
    return authentication_options(request, response, "reauth")


@router.post("/reauth/verify", dependencies=[Depends(guard)])
def reauth_verify(payload: Finish, request: Request, response: Response):
    return authentication_verify(payload, request, response, "reauth")


@router.patch("/{key_id}", dependencies=[Depends(guard)])
def rename(key_id: str, payload: Name, request: Request):
    account = owner(request)
    with Session.begin() as db:
        lock_owner(db, request, account["id"])
        key = db.get(Passkey, key_id)
        if not key or key.account_id != account["id"]:
            raise HTTPException(404, "Passkey not found.")
        key.name = payload.name.strip() or "My passkey"
    return {"ok": True}


@router.delete("/{key_id}", dependencies=[Depends(guard)])
def remove(key_id: str, request: Request):
    account = owner(request)
    with Session.begin() as db:
        session_hash = lock_owner(db, request, account["id"])
        changed = db.execute(
            delete(Passkey).where(Passkey.id == key_id, Passkey.account_id == account["id"])
        )
        if changed.rowcount != 1:
            raise HTTPException(404, "Passkey not found.")
        # A removed/lost authenticator may already have issued a session.
        db.execute(
            delete(LoginSession).where(
                LoginSession.account_id == account["id"], LoginSession.token_hash != session_hash
            )
        )
    return {"ok": True}
