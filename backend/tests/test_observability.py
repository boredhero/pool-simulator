import gzip
import json
import logging
import os
import time

from fastapi.testclient import TestClient

from app.main import app
from app.observability import JsonLog, RetainedLog


def test_size_rotation_compression_fifo_and_restart_retention(tmp_path):
    path = tmp_path / "application.jsonl"
    handler = RetainedLog(path, max_bytes=80, total_bytes=300)
    handler.setFormatter(logging.Formatter("%(message)s"))
    for index in range(20):
        handler.handle(logging.makeLogRecord({"msg": f"{index:04d}" + "x" * 60}))
    archives = sorted(tmp_path.glob("*.gz"))
    assert archives
    assert all(gzip.open(p, "rt").read().endswith("\n") for p in archives)
    assert sum(p.stat().st_size for p in tmp_path.iterdir()) <= 300
    assert "0000" not in "".join(gzip.open(p, "rt").read() for p in archives)
    handler.close()
    old = time.time() - 15 * 86400
    for p in tmp_path.iterdir():
        os.utime(p, (old, old))
    reopened = RetainedLog(path)
    assert not list(tmp_path.glob("*.gz"))
    assert not path.exists()
    reopened.close()


def test_daily_rotation_and_exception_redaction(tmp_path):
    handler = RetainedLog(tmp_path / "application.jsonl")
    handler.handle(logging.makeLogRecord({"msg": "yesterday"}))
    handler.opened = time.time() - 86400
    handler.maintain()
    assert len(list(tmp_path.glob("*.gz"))) == 1
    try:
        raise ValueError("password=SECRET")
    except ValueError:
        import sys

        record = logging.makeLogRecord({"msg": "request_failed", "exc_info": sys.exc_info()})
    rendered = JsonLog().format(record)
    assert "SECRET" not in rendered
    assert json.loads(rendered)["error_type"] == "ValueError"
    assert json.loads(rendered)["frames"]
    handler.close()


def test_http_diagnostics_exclude_query_and_unmatched_path():
    records = []

    class Capture(logging.Handler):
        def emit(self, record):
            records.append(JsonLog().format(record))

    logger = logging.getLogger("pool.http")
    capture = Capture()
    logger.addHandler(capture)
    try:
        with TestClient(app) as client:
            response = client.get(
                "/api/missing-SECRET?token=SECRET", headers={"Cookie": "secret=SECRET"}
            )
        assert response.headers["x-request-id"]
        assert any("http_request" in record for record in records)
        assert "SECRET" not in "".join(records)
    finally:
        logger.removeHandler(capture)


def test_failed_request_returns_safe_correlation_id():
    async def broken():
        raise ValueError("private credential must not escape")

    app.add_api_route("/api/test-diagnostic-failure", broken)
    route = app.router.routes.pop()
    app.router.routes.insert(0, route)
    try:
        with TestClient(app) as client:
            response = client.get("/api/test-diagnostic-failure")
        assert response.status_code == 500
        assert response.json()["requestId"] == response.headers["x-request-id"]
        assert "private credential" not in response.text
        assert response.headers["x-content-type-options"] == "nosniff"
    finally:
        app.router.routes.remove(route)


def test_nested_service_logs_share_request_id_and_clear_context():
    from app.observability import request_id_context

    records = []

    class Capture(logging.Handler):
        def emit(self, record):
            records.append(json.loads(JsonLog().format(record)))

    logger = logging.getLogger("pool.jev")
    capture = Capture()
    logger.addHandler(capture)

    async def service():
        logger.warning("jev_fallback", extra={"reason": "provider_timeout", "game_id": "test-game"})
        return {"ok": True}

    app.add_api_route("/api/test-service-context", service)
    route = app.router.routes.pop()
    app.router.routes.insert(0, route)
    try:
        with TestClient(app) as client:
            first = client.get("/api/test-service-context")
            second = client.get("/api/test-service-context")
        assert [r["request_id"] for r in records] == [
            first.headers["x-request-id"],
            second.headers["x-request-id"],
        ]
        assert records[0]["request_id"] != records[1]["request_id"]
        assert records[0]["reason"] == "provider_timeout"
        assert request_id_context.get() is None
    finally:
        logger.removeHandler(capture)
        app.router.routes.remove(route)


def test_request_duration_includes_body_and_health_checks(monkeypatch, caplog):
    import asyncio
    from types import SimpleNamespace

    from app.observability import RequestDiagnostics

    clock = [10.0]
    monkeypatch.setattr("app.observability.time.perf_counter", lambda: clock[0])

    async def endpoint(scope, receive, send):
        scope["route"] = SimpleNamespace(path="/healthz")
        clock[0] += 0.1
        await send({"type": "http.response.start", "status": 200, "headers": []})
        clock[0] += 0.4
        await send({"type": "http.response.body", "body": b"part", "more_body": True})
        clock[0] += 0.5
        await send({"type": "http.response.body", "body": b"done"})
        # Background work after sending the response is not response latency.
        clock[0] += 5

    sent = []

    async def send(message):
        sent.append(message)

    with caplog.at_level(logging.INFO, logger="pool.http"):
        asyncio.run(RequestDiagnostics(endpoint)({"type": "http", "method": "GET"}, None, send))
    record = next(r for r in caplog.records if r.msg == "http_request")
    assert record.route == "/healthz"
    assert record.duration_ms == 1000
    assert record.headers_duration_ms == 100
    assert record.response_complete is True
    assert (b"x-request-id", record.request_id.encode()) in sent[0]["headers"]


def test_interrupted_response_keeps_status_and_logs_duration(caplog):
    import asyncio

    import pytest

    from app.observability import RequestDiagnostics

    async def endpoint(scope, receive, send):
        await send({"type": "http.response.start", "status": 200, "headers": []})
        raise ValueError("stream interrupted")

    sent = []

    async def send(message):
        sent.append(message)

    with caplog.at_level(logging.INFO, logger="pool.http"), pytest.raises(ValueError):
        asyncio.run(RequestDiagnostics(endpoint)({"type": "http", "method": "GET"}, None, send))
    record = next(r for r in caplog.records if r.msg == "http_request")
    assert record.status == 200
    assert record.duration_ms >= 0
    assert record.response_complete is False
    assert len(sent) == 1
