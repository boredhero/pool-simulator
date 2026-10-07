from fastapi import APIRouter

router = APIRouter()


@router.get("/scores")
def list_scores() -> list[dict]:
    return []


@router.post("/scores")
def post_score(payload: dict) -> dict:
    return {"ok": True, "echo": payload}


@router.post("/replays")
def post_replay(payload: dict) -> dict:
    # v1: store seed + shot log; validation happens in P2/P3
    return {"ok": True, "id": "replay-stub"}


@router.get("/replays/{rid}")
def get_replay(rid: str) -> dict:
    return {"id": rid, "seed": 0, "shots": []}
