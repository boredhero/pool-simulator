import json

from fastapi import APIRouter
from pydantic import BaseModel

from app.models.db import Replay, Score, Session, init_db
from app.version import get_info

router = APIRouter()


class ScoreIn(BaseModel):
    device_id: str = ""
    winner: str = ""


class ReplayIn(BaseModel):
    seed: int = 0
    shots: list[dict] = []


@router.get("/version")
def version() -> dict[str, str]:
    return get_info()


@router.get("/scores")
def list_scores() -> list[dict]:
    init_db()
    with Session() as s:
        rows = s.query(Score).order_by(Score.id.desc()).limit(50).all()
        return [{"id": r.id, "device_id": r.device_id, "winner": r.winner} for r in rows]


@router.post("/scores")
def post_score(payload: ScoreIn) -> dict:
    init_db()
    with Session() as s:
        r = Score(device_id=payload.device_id, winner=payload.winner)
        s.add(r)
        s.commit()
        s.refresh(r)
        return {"ok": True, "id": r.id}


@router.post("/replays")
def post_replay(payload: ReplayIn) -> dict:
    init_db()
    with Session() as s:
        r = Replay(seed=payload.seed, shots=json.dumps(payload.shots))
        s.add(r)
        s.commit()
        s.refresh(r)
        return {"ok": True, "id": r.id}


@router.get("/replays/{rid}")
def get_replay(rid: int) -> dict:
    init_db()
    with Session() as s:
        r = s.get(Replay, rid)
        if r is None:
            return {"detail": "not found"}
        return {"id": r.id, "seed": r.seed, "shots": json.loads(r.shots)}
