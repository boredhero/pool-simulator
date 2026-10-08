"""FastAPI entry: serves API + frontend/dist in prod, /healthz."""

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.api.accounts import router as accounts_router
from app.api.routes import router
from app.net.rooms import handle as handle_room_ws
from app.services.matches import interrupt_matches


@asynccontextmanager
async def lifespan(app: FastAPI):
    interrupt_matches()
    yield


app = FastAPI(title="pool-simulator", lifespan=lifespan)
app.include_router(router, prefix="/api")
app.include_router(accounts_router, prefix="/api")


@app.exception_handler(RequestValidationError)
async def validation_error(request, exc):
    if request.url.path.startswith("/api/account"):
        return JSONResponse(
            status_code=422,
            content={"detail": "Check the username and password length (15–128 characters)."},
        )
    return await request_validation_exception_handler(request, exc)


@app.middleware("http")
async def account_cache_control(request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/api/account"):
        response.headers["Cache-Control"] = "no-store"
    return response


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
        f = (DIST / full_path).resolve()
        if not f.is_relative_to(DIST.resolve()):
            raise HTTPException(404, "Not found")
        if full_path and f.is_file():
            return FileResponse(f)
        return FileResponse(DIST / "index.html")
