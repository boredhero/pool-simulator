def test_healthz():
    from fastapi.testclient import TestClient

    from app.main import app

    c = TestClient(app)
    r = c.get("/healthz")
    assert r.status_code == 200 and r.json()["status"] == "ok"
