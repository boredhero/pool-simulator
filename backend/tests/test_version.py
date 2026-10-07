def test_version():
    from fastapi.testclient import TestClient

    from app.main import app

    c = TestClient(app)
    r = c.get("/api/version")
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "pool-simulator"
    assert body["version"]
