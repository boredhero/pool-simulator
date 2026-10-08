from fastapi.testclient import TestClient

from app.main import app

c = TestClient(app)


def test_version():
    r = c.get("/api/version")
    assert r.status_code == 200 and r.json()["name"] == "pool-simulator"


def test_removed_legacy_routes_and_models():
    from app.models.db import Base

    paths = app.openapi()["paths"]
    for path in ("/api/scores", "/api/replays", "/api/replays/1"):
        assert path not in paths
        assert c.get(path).status_code == 404
        assert c.post(path, json={}).status_code in (404, 405)
    assert "scores" not in Base.metadata.tables
    assert "replays" not in Base.metadata.tables


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


def test_api_documentation_and_schema_are_not_public():
    assert app.docs_url is None
    assert app.redoc_url is None
    assert app.openapi_url is None
    for path in (
        "/docs",
        "/docs/",
        "/docs/oauth2-redirect",
        "/redoc",
        "/redoc/",
        "/openapi.json",
        "/api/docs",
        "/api/openapi.json",
    ):
        response = c.get(path)
        assert response.status_code == 404, path
        assert "swagger-ui" not in response.text.lower()
    assert c.get("/healthz").status_code == 200
    assert c.get("/api/version").status_code == 200
