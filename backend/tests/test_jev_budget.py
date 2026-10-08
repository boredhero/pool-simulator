from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime

import pytest
from sqlalchemy import create_engine, text
from test_admin import HEADERS, owner, register
from test_jev import plans, set_cpu_turn

from app.api import jev
from app.models.db import Account, JevRequest, Session
from app.models.migrations import upgrade_monthly_budget
from app.services import jev_budget as budget


def snapshot(account_id):
    with Session() as db:
        return budget.balance(db, db.get(Account, account_id))


def test_metered_unknown_and_idempotent_settlement():
    _, a = register("LedgerUser")
    identity = budget.reserve(a["id"], "rack", 0, 1, jev.MODEL)
    assert snapshot(a["id"])["reservedNano"] == budget.REQUEST_RESERVE
    budget.settle(identity, jev.Evaluation(None, 333, 25))
    budget.settle(identity, jev.Evaluation(None, 999, 25))
    assert snapshot(a["id"])["spentNano"] == 333 * 42
    assert snapshot(a["id"])["reservedNano"] == 0
    unknown = budget.reserve(a["id"], "rack", 1, 1, jev.MODEL)
    budget.settle(unknown)
    with Session() as db:
        row = db.get(JevRequest, unknown)
        assert row.status == "unknown" and row.cost_nano is None
    assert snapshot(a["id"])["unknownRequests"] == 1
    assert snapshot(a["id"])["reservedNano"] == budget.REQUEST_RESERVE


def test_monthly_topups_limits_authorization_retries_and_rollover(monkeypatch):
    admin, _ = owner(monkeypatch)
    user, a = register("BudgetUser")
    path = f"/api/admin/accounts/{a['id']}/budget/topup"
    payload = {"dollars": "0.07", "requestId": "topup-request-00001"}
    assert user.post(path, headers=HEADERS, json=payload).status_code == 404
    assert admin.post(path, json=payload).status_code == 403
    assert admin.post(path, headers=HEADERS, json=payload).json()["limitNano"] == 220_000_000
    assert admin.post(path, headers=HEADERS, json=payload).json()["topupsNano"] == 70_000_000
    assert admin.post(path, headers=HEADERS, json={**payload, "dollars": "0.08"}).status_code == 409
    for value in ["-0.01", "NaN", "0.001", 0.15, "1e2"]:
        assert (
            admin.post(path, headers=HEADERS, json={**payload, "dollars": value}).status_code == 422
        )
    response = admin.post(
        path.replace("topup", "limit"),
        headers=HEADERS,
        json={"dollars": "0.10", "requestId": "limit-request-00001"},
    )
    assert response.json()["limitNano"] == 170_000_000
    reset = snapshot(a["id"])["resetsAt"]
    monkeypatch.setattr(budget.time, "time", lambda: reset)
    assert snapshot(a["id"])["topupsNano"] == 0
    assert snapshot(a["id"])["baseNano"] == 100_000_000
    assert budget.period(datetime(2026, 12, 31, tzinfo=UTC).timestamp())[0] == "2026-12"
    assert budget.period(datetime(2026, 12, 31, tzinfo=UTC).timestamp())[1] == int(
        datetime(2027, 1, 1, tzinfo=UTC).timestamp()
    )


def test_default_and_concurrent_reservations(monkeypatch):
    admin, _ = owner(monkeypatch)
    _, a = register("ConcurrentUser")
    assert (
        admin.patch(
            "/api/admin/budget-default",
            headers=HEADERS,
            json={"dollars": "0.10", "requestId": "default-request-001"},
        ).status_code
        == 200
    )
    assert snapshot(a["id"])["baseNano"] == 100_000_000
    with Session.begin() as db:
        db.get(Account, a["id"]).monthly_budget_nano = 0
        db.add(
            JevRequest(
                id="previous",
                account_id=a["id"],
                game_id="rack",
                revision=0,
                seat=1,
                month=budget.period()[0],
                started_at=1,
                model=jev.MODEL,
                status="metered",
                input_price_nano=42,
                cost_nano=budget.GRACE_NANO - budget.REQUEST_RESERVE,
                reserved_nano=0,
            )
        )
    with ThreadPoolExecutor(max_workers=4) as pool:
        attempts = list(
            pool.map(lambda seat: budget.reserve(a["id"], "rack", 1, seat, jev.MODEL), range(4))
        )
    assert sum(x is not None for x in attempts) == 1
    with Session.begin() as db:
        db.get(Account, a["id"]).premium = True
    assert budget.reserve(a["id"], "rack", 2, 1, jev.MODEL) is not None


@pytest.mark.parametrize(
    "mode,seat,calls",
    [("", 1, 1), ("jev-cpu", 0, 1), ("jev-cpu", 1, 0), ("jev-jev", 0, 1), ("jev-jev", 1, 1)],
)
def test_real_turn_records_each_provider_call_once(monkeypatch, mode, seat, calls):
    monkeypatch.setenv("JEV_API_KEY", "test-placeholder")
    client, a = register("TurnBudget")
    with Session.begin() as db:
        db.get(Account, a["id"]).sim_enabled = True
    game = client.post(
        "/api/opponents/jev/games", headers=HEADERS, json={"simulation": mode}
    ).json()
    set_cpu_turn(game)
    import json

    from app.models.db import JevGame

    with Session.begin() as db:
        row = db.get(JevGame, game["id"])
        state = json.loads(row.state)
        state["current"] = seat
        row.state = json.dumps(state)
    monkeypatch.setattr(jev, "plan_shots", lambda gs: plans())

    async def evaluate(payload, key):
        return jev.Evaluation(None, 1000, 5)

    monkeypatch.setattr(jev, "evaluate", evaluate)
    response = client.post(
        f"/api/opponents/jev/games/{game['id']}/turn", headers=HEADERS, json={"revision": 0}
    )
    assert response.status_code == 200, response.text
    assert snapshot(a["id"])["spentNano"] == calls * 42000
    with Session() as db:
        assert db.query(JevRequest).count() == calls


def test_exhaustion_preserves_resume_and_finishes_with_cpu(monkeypatch):
    monkeypatch.setenv("JEV_API_KEY", "test-placeholder")
    client, a = register("EmptyBudget")
    game = client.post("/api/opponents/jev/games", headers=HEADERS, json={}).json()
    set_cpu_turn(game)
    with Session.begin() as db:
        db.get(Account, a["id"]).monthly_budget_nano = 0
        db.add(
            JevRequest(
                id="spent",
                account_id=a["id"],
                game_id=game["id"],
                revision=0,
                seat=1,
                month=budget.period()[0],
                started_at=1,
                model=jev.MODEL,
                status="metered",
                input_price_nano=42,
                cost_nano=budget.GRACE_NANO,
                reserved_nano=0,
            )
        )
    assert (
        client.post(
            "/api/opponents/jev/games", headers=HEADERS, json={"new_game": True}
        ).status_code
        == 429
    )
    assert (
        client.post("/api/opponents/jev/games", headers=HEADERS, json={}).json()["id"] == game["id"]
    )
    monkeypatch.setattr(jev, "plan_shots", lambda gs: plans())

    async def fail(*args):
        pytest.fail("Must not call provider after completion grace")

    monkeypatch.setattr(jev, "evaluate", fail)
    response = client.post(
        f"/api/opponents/jev/games/{game['id']}/turn", headers=HEADERS, json={"revision": 0}
    )
    assert response.status_code == 200, response.text
    assert response.json()["source"] == "budget-fallback"


def test_migration_preserves_accounts_and_last_active_is_throttled(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as c:
        c.exec_driver_sql("CREATE TABLE accounts (id TEXT PRIMARY KEY)")
        c.exec_driver_sql("INSERT INTO accounts VALUES ('old')")
        upgrade_monthly_budget(c)
        upgrade_monthly_budget(c)
        assert c.execute(
            text("SELECT id,monthly_budget_nano,last_active_at FROM accounts")
        ).one() == ("old", None, None)
    from app.services import auth

    now = 2_000_000_000
    monkeypatch.setattr(auth.time, "time", lambda: now)
    client, a = register("ActiveUser")
    assert client.get("/api/account").json()["account"]["lastActiveAt"] == now
    now += 30
    assert client.get("/api/account").json()["account"]["lastActiveAt"] == now - 30
    now += 31
    assert client.get("/api/account").json()["account"]["lastActiveAt"] == now


def test_provider_failure_is_unknown_not_free_and_deletion_cleans_ledger(monkeypatch):
    monkeypatch.setenv("JEV_API_KEY", "test-placeholder")
    admin, _ = owner(monkeypatch)
    client, account = register("TimeoutUser")
    game = client.post("/api/opponents/jev/games", headers=HEADERS, json={}).json()
    set_cpu_turn(game)
    monkeypatch.setattr(jev, "plan_shots", lambda gs: plans())

    async def timeout(*args):
        raise TimeoutError()

    monkeypatch.setattr(jev, "evaluate", timeout)
    response = client.post(
        f"/api/opponents/jev/games/{game['id']}/turn", headers=HEADERS, json={"revision": 0}
    )
    assert response.status_code == 200
    assert snapshot(account["id"])["unknownRequests"] == 1
    assert snapshot(account["id"])["spentNano"] == 0
    assert snapshot(account["id"])["reservedNano"] == budget.REQUEST_RESERVE
    assert (
        admin.request(
            "DELETE",
            f"/api/admin/accounts/{account['id']}",
            headers=HEADERS,
            json={"username": "TimeoutUser"},
        ).status_code
        == 200
    )
    with Session() as db:
        assert db.query(JevRequest).count() == 0


def test_simultaneous_starts_keep_one_active_rack(monkeypatch):
    monkeypatch.setenv("JEV_API_KEY", "test-placeholder")
    client, account = register("TabsUser")
    with ThreadPoolExecutor(max_workers=3) as pool:
        responses = list(
            pool.map(
                lambda _: client.post(
                    "/api/opponents/jev/games", headers=HEADERS, json={"new_game": True}
                ),
                range(3),
            )
        )
    assert all(r.status_code == 200 for r in responses)
    from app.models.db import JevGame

    with Session() as db:
        assert db.query(JevGame).filter_by(account_id=account["id"], status="active").count() == 1


def test_activity_endpoint_requires_session_and_csrf(monkeypatch):
    admin, _ = owner(monkeypatch)
    client, account = register("ActivityUser")
    assert client.post("/api/account/activity").status_code == 403
    assert client.post("/api/account/activity", headers=HEADERS).json()["lastActiveAt"]
    users = admin.get("/api/admin/accounts").json()["accounts"]
    assert next(a for a in users if a["id"] == account["id"])["lastActiveAt"]
