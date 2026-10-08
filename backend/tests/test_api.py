from fastapi.testclient import TestClient

from app.main import app

c = TestClient(app)


def test_version():
    r = c.get("/api/version")
    assert r.status_code == 200 and r.json()["name"] == "pool-simulator"


def test_scores_roundtrip():
    assert c.get("/api/scores").status_code == 200
    r = c.post("/api/scores", json={"device_id": "t", "winner": "P1"})
    assert r.json()["ok"]
    assert any(s["device_id"] == "t" for s in c.get("/api/scores").json())


def test_replays_roundtrip():
    r = c.post("/api/replays", json={"seed": 7, "shots": [{"aim": 1.0}]})
    rid = r.json()["id"]
    g = c.get(f"/api/replays/{rid}")
    assert g.json()["shots"] == [{"aim": 1.0}]
