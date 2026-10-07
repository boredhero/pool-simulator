"""FastAPI entry: serves API + frontend/dist in prod, /healthz."""

from pathlib import Path

from fastapi import FastAPI, WebSocket
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api.routes import router
from app.net.rooms import handle as handle_room_ws

app = FastAPI(title="pool-simulator")
app.include_router(router, prefix="/api")


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket) -> None:
    await handle_room_ws(ws)


DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


# Prod static serving (mounted only if built)
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{full_path:path}")
    def spa(full_path: str = ""):
        if full_path.startswith("api/"):
            return {"detail": "not found"}
        f = DIST / full_path
        if full_path and f.is_file():
            return FileResponse(f)
        return FileResponse(DIST / "index.html")
