"""USD accounting from TypeSafe-reported usage, independent of prepaid funding."""

import secrets
import time
from datetime import UTC, datetime

from sqlalchemy import func, select, update

from app.models.db import Account, JevBudgetAdjustment, JevBudgetSetting, JevRequest, Session

PRICE_NANO = 42  # $0.042 per million input tokens; output is free.
REQUEST_RESERVE = 64000 * PRICE_NANO  # Published maximum context; not a reported charge.
DEFAULT_NANO = 150_000_000
GRACE_NANO = 20_000_000


def period(now=None):
    dt = datetime.fromtimestamp(time.time() if now is None else now, UTC)
    end = datetime(dt.year + (dt.month == 12), dt.month % 12 + 1, 1, tzinfo=UTC)
    return dt.strftime("%Y-%m"), int(end.timestamp())


def lock_account(db, account_id):
    # First statement is a write: serializes admission/reservation on SQLite,
    # and obtains a row lock on PostgreSQL. Never hold it across provider I/O.
    db.execute(update(Account).where(Account.id == account_id).values(disabled=Account.disabled))
    return db.get(Account, account_id, populate_existing=True)


def defaults(db):
    item = db.get(JevBudgetSetting, "monthly_default")
    return item.value if item else DEFAULT_NANO


def balance(db, account, now=None):
    month, reset = period(now)
    base = account.monthly_budget_nano
    if base is None:
        base = defaults(db)
    topups = db.scalar(
        select(func.coalesce(func.sum(JevBudgetAdjustment.amount_nano), 0)).where(
            JevBudgetAdjustment.account_id == account.id,
            JevBudgetAdjustment.month == month,
            JevBudgetAdjustment.kind == "topup",
        )
    )
    spent, reserved, unknown = db.execute(
        select(
            func.coalesce(func.sum(JevRequest.cost_nano), 0),
            func.coalesce(func.sum(JevRequest.reserved_nano), 0),
            func.count().filter(JevRequest.cost_nano.is_(None)),
        ).where(JevRequest.account_id == account.id, JevRequest.month == month)
    ).one()
    return dict(
        month=month,
        resetsAt=reset,
        unlimited=account.premium,
        baseNano=base,
        overrideNano=account.monthly_budget_nano,
        topupsNano=topups,
        limitNano=base + topups,
        spentNano=spent,
        reservedNano=reserved,
        unknownRequests=unknown,
        remainingNano=max(0, base + topups - spent - reserved),
        graceNano=GRACE_NANO,
    )


def reserve(account_id, game_id, revision, seat, model):
    with Session.begin() as db:
        account = lock_account(db, account_id)
        if account is None or account.disabled:
            return None
        budget = balance(db, account)
        # An admitted rack can exceed the normal budget by up to the grace.
        # After that the existing CPU planner finishes it without more calls.
        if (
            not account.premium
            and budget["spentNano"] + budget["reservedNano"] + REQUEST_RESERVE
            > budget["limitNano"] + GRACE_NANO
        ):
            return None
        identity = secrets.token_hex(16)
        db.add(
            JevRequest(
                id=identity,
                account_id=account_id,
                game_id=game_id,
                revision=revision,
                seat=seat,
                month=budget["month"],
                started_at=int(time.time()),
                model=model,
                input_price_nano=PRICE_NANO,
                reserved_nano=REQUEST_RESERVE,
                status="pending",
            )
        )
        return identity


def settle(identity, result=None):
    with Session.begin() as db:
        entry = db.get(JevRequest, identity)
        if entry is None or entry.status != "pending":
            return
        entry.finished_at = int(time.time())
        if (
            result is not None
            and result.input_tokens is not None
            and result.output_tokens is not None
        ):
            entry.input_tokens, entry.output_tokens = result.input_tokens, result.output_tokens
            entry.cost_nano = result.input_tokens * entry.input_price_nano
            entry.reserved_nano = 0
            entry.status = "metered"
        else:
            entry.status = "unknown"
