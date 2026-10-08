from fastapi import APIRouter

from app.version import get_info

router = APIRouter()


@router.get("/version")
def version() -> dict[str, str]:
    return get_info()
