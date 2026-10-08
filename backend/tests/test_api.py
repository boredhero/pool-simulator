from fastapi.testclient import TestClient

from app.main import app

c = TestClient(app)


def test_version():
    r = c.get("/api/version")
    assert r.status_code == 200 and r.json()["name"] == "pool-simulator"


def test_legacy_writes_are_retired():
    from app.models.db import Replay, Score, Session

    with Session() as db:
        before = (db.query(Score).count(), db.query(Replay).count())
    for path in ("scores", "replays"):
        assert c.post(f"/api/{path}", json={"winner": "invented"}).status_code == 410
    with Session() as db:
        assert (db.query(Score).count(), db.query(Replay).count()) == before
    assert c.get("/api/scores").status_code == 200


def test_body_limits_and_browser_headers():
    assert c.post("/api/account/register", content=b"x" * 16385).status_code == 413
    response = c.get("/healthz")
    assert response.headers["x-content-type-options"] == "nosniff"
    assert "frame-ancestors 'none'" in response.headers["content-security-policy"]
    assert "strict-transport-security" not in response.headers
    response = TestClient(app, base_url="https://testserver").get("/healthz")
    assert response.headers["strict-transport-security"] == "max-age=31536000"


async def test_streaming_body_limit_works_without_content_length():
    from app.security import BodyLimit

    called = False
    messages = iter(
        [
            {"type": "http.request", "body": b"x" * 10000, "more_body": True},
            {"type": "http.request", "body": b"x" * 10000, "more_body": False},
        ]
    )
    sent = []

    async def app(scope, receive, send):
        nonlocal called
        called = True

    async def receive():
        return next(messages)

    async def send(message):
        sent.append(message)

    await BodyLimit(app)({"type": "http", "method": "POST"}, receive, send)
    assert not called and sent[0]["status"] == 413
