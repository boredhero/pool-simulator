"""FastAPI entry: serves API + frontend/dist in prod, /healthz."""

import asyncio
import logging
import secrets
import time
from contextlib import asynccontextmanager, suppress
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app import observability
from app.api.accounts import router as accounts_router
from app.api.admin import router as admin_router
from app.api.google import router as google_router
from app.api.jev import router as jev_router
from app.api.passkeys import router as passkeys_router
from app.api.privacy import cleanup
from app.api.privacy import router as privacy_router
from app.api.routes import router
from app.models.db import Session, init_db
from app.net.rooms import handle as handle_room_ws
from app.security import BodyLimit
from app.services.matches import interrupt_matches


@asynccontextmanager
async def lifespan(app: FastAPI):
    observability.configure()
    interrupt_matches()
    init_db()
    with Session.begin() as db:
        cleanup(db)

    async def retention():
        while True:
            await asyncio.sleep(3600)
            await asyncio.to_thread(observability.maintenance)
            with Session.begin() as db:
                cleanup(db)

    maintenance = asyncio.create_task(retention())
    try:
        yield
    finally:
        maintenance.cancel()
        with suppress(asyncio.CancelledError):
            await maintenance


app = FastAPI(
    title="pool-simulator", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None
)
app.add_middleware(BodyLimit)
app.include_router(router, prefix="/api")
app.include_router(jev_router, prefix="/api")
app.include_router(privacy_router, prefix="/api")
app.include_router(accounts_router, prefix="/api")
app.include_router(passkeys_router, prefix="/api")
app.include_router(google_router, prefix="/api")
app.include_router(admin_router, prefix="/api")


@app.exception_handler(RequestValidationError)
async def validation_error(request, exc):
    if request.url.path.startswith("/api/account/google"):
        return JSONResponse(
            status_code=422,
            content={"detail": "Check your username and Google sign-in request, then try again."},
        )
    if request.url.path.startswith("/api/account/username"):
        return JSONResponse(
            status_code=422,
            content={"detail": "Username must be 3–20 letters, numbers, or underscores."},
        )
    if request.url.path.startswith("/api/account"):
        return JSONResponse(
            status_code=422,
            content={"detail": "Check the username and password length (15–128 characters)."},
        )
    return await request_validation_exception_handler(request, exc)


@app.middleware("http")
async def diagnostics(request, call_next):
    request_id = secrets.token_hex(12)
    context_token = observability.request_id_context.set(request_id)
    start = time.monotonic()
    status = 500
    logger = logging.getLogger("pool.http")
    try:
        response = await call_next(request)
        status = response.status_code
        response.headers["X-Request-ID"] = request_id
        return response
    except Exception:
        logger.exception("request_failed", extra={"request_id": request_id})
        return JSONResponse(
            status_code=500,
            content={"detail": "Internal server error", "requestId": request_id},
            headers={"X-Request-ID": request_id},
        )
    finally:
        route = getattr(request.scope.get("route"), "path", "unmatched")
        if route != "/healthz":
            logger.info(
                "http_request",
                extra={
                    "request_id": request_id,
                    "method": request.method,
                    "route": route,
                    "status": status,
                    "duration_ms": round((time.monotonic() - start) * 1000, 2),
                },
            )

        observability.request_id_context.reset(context_token)


@app.middleware("http")
async def account_cache_control(request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Cross-Origin-Opener-Policy"] = "same-origin-allow-popups"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self' https://accounts.google.com/gsi/client; "
        "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style; "
        "img-src 'self' data: blob:; connect-src 'self' https://accounts.google.com/gsi/; "
        "frame-src https://accounts.google.com/gsi/; object-src 'none'; "
        "base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
    )
    if request.url.scheme == "https":
        response.headers["Strict-Transport-Security"] = "max-age=31536000"
    if request.url.path.startswith(
        ("/api/account", "/api/opponents/jev", "/api/privacy", "/api/admin")
    ):
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
        if full_path.startswith("api/") or full_path.rstrip("/") in {
            "docs",
            "docs/oauth2-redirect",
            "redoc",
            "openapi.json",
        }:
            raise HTTPException(404, "Not found")
        f = (DIST / full_path).resolve()
        if not f.is_relative_to(DIST.resolve()):
            raise HTTPException(404, "Not found")
        if full_path and f.is_file():
            return FileResponse(f)
        return FileResponse(DIST / "index.html")
