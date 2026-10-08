import json

from fastapi import APIRouter, HTTPException

from app.models.db import Replay, Score, Session, init_db
from app.version import get_info

router = APIRouter()


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
@router.post("/replays")
def retired_write() -> None:
    raise HTTPException(410, "Client-submitted scores and replays are no longer accepted.")


@router.get("/replays/{rid}")
def get_replay(rid: int) -> dict:
    init_db()
    with Session() as s:
        r = s.get(Replay, rid)
        if r is None:
            return {"detail": "not found"}
        return {"id": r.id, "seed": r.seed, "shots": json.loads(r.shots)}
