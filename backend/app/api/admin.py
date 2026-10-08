"""Owner-only account management. Never expose credentials or private game state."""

import secrets
import time
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, select

from app.models.db import Account, AdminAudit, JevGame, JevUsage, Session
from app.services.auth import current_account, is_admin, mutation_guard


def require_admin(request: Request) -> dict:
    account = current_account(request)
    if not account or not is_admin(account["id"]):
        raise HTTPException(404, "Not found")
    return account


router = APIRouter(prefix="/admin", dependencies=[Depends(require_admin)], include_in_schema=False)
METRICS = ("requests", "input_tokens", "output_tokens", "estimated_cost_nano", "unmetered_requests")


def game_totals():
    return (
        select(
            JevGame.account_id,
            func.count().label("games"),
            func.max(JevGame.updated_at).label("last_activity"),
            *(func.sum(getattr(JevGame, key)).label(key) for key in METRICS),
        )
        .group_by(JevGame.account_id)
        .subquery()
    )


def usage_dict(row) -> dict:
    return {key: int(row[key] or 0) for key in ("games", *METRICS)} | {
        "last_activity": row["last_activity"]
    }


@router.get("/overview")
def overview():
    with Session() as db:
        accounts = db.scalar(select(func.count()).select_from(Account))
        premium = db.scalar(select(func.count()).select_from(Account).where(Account.premium))
        totals = (
            db.execute(
                select(
                    func.count().label("games"),
                    func.max(JevGame.updated_at).label("last_activity"),
                    *(func.sum(getattr(JevGame, key)).label(key) for key in METRICS),
                )
            )
            .mappings()
            .one()
        )
        lifetime = db.execute(
            select(func.sum(JevUsage.attempts), func.sum(JevUsage.completed))
        ).one()
        return {
            "accounts": accounts,
            "premium": premium,
            "usage": usage_dict(totals),
            "lifetimeAttempts": lifetime[0] or 0,
            "lifetimeCompleted": lifetime[1] or 0,
            "retentionDays": 90,
        }


@router.get("/accounts")
def accounts(
    search: str = Query(default="", max_length=20),
    premium: Literal["all", "premium", "free"] = "all",
    sort: Literal["username", "joined", "cost", "requests"] = "joined",
    direction: Literal["asc", "desc"] = "desc",
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=100),
):
    totals = game_totals()
    filters = [Account.username_key.contains(search.lower().strip(), autoescape=True)]
    if premium != "all":
        filters.append(Account.premium == (premium == "premium"))
    order = {
        "username": Account.username_key,
        "joined": Account.created_at,
        "cost": func.coalesce(totals.c.estimated_cost_nano, 0),
        "requests": func.coalesce(totals.c.requests, 0),
    }[sort]
    with Session() as db:
        count = db.scalar(select(func.count()).select_from(Account).where(*filters))
        rows = db.execute(
            select(Account, totals)
            .outerjoin(totals, totals.c.account_id == Account.id)
            .where(*filters)
            .order_by(order.asc() if direction == "asc" else order.desc(), Account.id)
            .offset(offset)
            .limit(limit)
        ).mappings()
        return {
            "total": count,
            "offset": offset,
            "limit": limit,
            "accounts": [
                {
                    "id": row["Account"].id,
                    "username": row["Account"].username,
                    "createdAt": row["Account"].created_at,
                    "premium": row["Account"].premium,
                    "isAdmin": is_admin(row["Account"].id),
                    "usage": usage_dict(row),
                }
                for row in rows
            ],
        }


@router.get("/accounts/{account_id}")
def account_detail(account_id: str):
    with Session() as db:
        account = db.get(Account, account_id)
        if not account:
            raise HTTPException(404, "Account not found")
        lifetime = db.get(JevUsage, account_id)
        games = db.scalars(
            select(JevGame)
            .where(JevGame.account_id == account_id)
            .order_by(JevGame.started_at.desc(), JevGame.id)
            .limit(20)
        )
        audits = db.scalars(
            select(AdminAudit)
            .where(AdminAudit.account_id == account_id)
            .order_by(AdminAudit.occurred_at.desc(), AdminAudit.id)
            .limit(10)
        )
        return {
            "username": account.username,
            "lifetimeAttempts": lifetime.attempts if lifetime else 0,
            "lifetimeCompleted": lifetime.completed if lifetime else 0,
            "games": [
                {
                    "id": game.id,
                    "status": game.status,
                    "startedAt": game.started_at,
                    "updatedAt": game.updated_at,
                    "premiumGame": game.day is None,
                    **{key: getattr(game, key) for key in METRICS},
                }
                for game in games
            ],
            "audit": [
                {"at": a.occurred_at, "from": a.old_premium, "to": a.new_premium} for a in audits
            ],
        }


class PremiumChange(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    premium: bool


@router.patch("/accounts/{account_id}/premium", dependencies=[Depends(mutation_guard)])
def set_account_premium(account_id: str, payload: PremiumChange, actor=Depends(require_admin)):
    with Session.begin() as db:
        account = db.get(Account, account_id)
        if not account:
            raise HTTPException(404, "Account not found")
        if account.premium != payload.premium:
            db.add(
                AdminAudit(
                    id=secrets.token_hex(16),
                    actor_id=actor["id"],
                    account_id=account.id,
                    old_premium=account.premium,
                    new_premium=payload.premium,
                    occurred_at=int(time.time()),
                )
            )
            account.premium = payload.premium
        return {"id": account.id, "premium": account.premium}
