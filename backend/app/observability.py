"""Bounded, persistent diagnostics for the single-process deployment."""

import gzip
import json
import logging
import logging.handlers
import os
import secrets
import shutil
import time
from contextvars import ContextVar
from pathlib import Path

from starlette.responses import JSONResponse

request_id_context = ContextVar("request_id", default=None)


class RequestDiagnostics:
    """Measure HTTP responses through the final body sent to the ASGI server."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        request_id = secrets.token_hex(12)
        token = request_id_context.set(request_id)
        start = time.perf_counter()
        status, started, completed = 500, False, False
        headers_ms = duration_ms = None
        logger = logging.getLogger("pool.http")

        async def measured_send(message):
            nonlocal status, started, completed, headers_ms, duration_ms
            if message["type"] == "http.response.start":
                status = message["status"]
                headers_ms = (time.perf_counter() - start) * 1000
                message = dict(message)
                message["headers"] = [
                    (key, value)
                    for key, value in message.get("headers", [])
                    if key.lower() != b"x-request-id"
                ] + [(b"x-request-id", request_id.encode("ascii"))]
                started = True
            await send(message)
            if message["type"] == "http.response.body" and not message.get("more_body", False):
                completed = True
                duration_ms = (time.perf_counter() - start) * 1000

        try:
            await self.app(scope, receive, measured_send)
        except Exception:
            logger.exception("request_failed", extra={"request_id": request_id})
            if started:
                raise
            await JSONResponse(
                status_code=500,
                content={"detail": "Internal server error", "requestId": request_id},
            )(scope, receive, measured_send)
        finally:
            logger.info(
                "http_request",
                extra={
                    "request_id": request_id,
                    "method": scope["method"],
                    "route": getattr(scope.get("route"), "path", "unmatched"),
                    "status": status,
                    "duration_ms": round(
                        duration_ms
                        if duration_ms is not None
                        else (time.perf_counter() - start) * 1000,
                        2,
                    ),
                    "headers_duration_ms": round(headers_ms, 2) if headers_ms is not None else None,
                    "response_complete": completed,
                },
            )
            request_id_context.reset(token)


class RetainedLog(logging.handlers.BaseRotatingHandler):
    def __init__(self, path, max_bytes=10 * 1024**2, total_bytes=100 * 1024**2, days=14):
        self.max_bytes, self.total_bytes, self.days = max_bytes, total_bytes, days
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.opened = path.stat().st_mtime if path.exists() else time.time()
        super().__init__(path, "a", encoding="utf-8", delay=True)
        self.maintain()

    def shouldRollover(self, record):
        path = Path(self.baseFilename)
        size = path.stat().st_size if path.exists() else 0
        return size > 0 and (
            int(self.opened // 86400) != int(time.time() // 86400)
            or size + len(self.format(record).encode("utf-8")) + 1 > self.max_bytes
        )

    def doRollover(self):
        if self.stream:
            self.stream.close()
            self.stream = None
        path = Path(self.baseFilename)
        if path.exists() and path.stat().st_size:
            modified = path.stat().st_mtime
            archive = path.with_name(f"{path.name}.{time.time_ns()}.gz")
            temporary = archive.with_suffix(".tmp")
            with path.open("rb") as source, gzip.open(temporary, "wb") as target:
                shutil.copyfileobj(source, target)
            os.chmod(temporary, 0o600)
            temporary.replace(archive)
            os.utime(archive, (modified, modified))
            path.unlink()
        self.opened = time.time()
        self.prune()

    def prune(self):
        path = Path(self.baseFilename)
        archives = sorted(
            path.parent.glob(path.name + ".*.gz"), key=lambda p: (p.stat().st_mtime, p.name)
        )
        size = path.stat().st_size if path.exists() else 0
        size += sum(p.stat().st_size for p in archives)
        cutoff = time.time() - self.days * 86400
        for archive in archives:
            if archive.stat().st_mtime < cutoff or size > self.total_bytes - self.max_bytes:
                size -= archive.stat().st_size
                archive.unlink()

    def maintain(self):
        self.acquire()
        try:
            path = Path(self.baseFilename)
            if path.exists() and int(self.opened // 86400) != int(time.time() // 86400):
                self.doRollover()
            self.prune()
        finally:
            self.release()

    def _open(self):
        stream = super()._open()
        os.chmod(self.baseFilename, 0o600)
        return stream


class JsonLog(logging.Formatter):
    def format(self, record):
        result = {"time": record.created, "level": record.levelname, "event": record.getMessage()}
        if request_id_context.get():
            result["request_id"] = request_id_context.get()
        for key in (
            "request_id",
            "method",
            "route",
            "status",
            "duration_ms",
            "headers_duration_ms",
            "response_complete",
            "error_type",
            "game_id",
            "reason",
            "revision",
            "seat",
        ):
            if hasattr(record, key):
                result[key] = getattr(record, key)
        # Exception messages and local variables can contain credentials/provider payloads.
        if record.exc_info:
            result["error_type"] = record.exc_info[0].__name__
            tb, frames = record.exc_info[2], []
            while tb:
                frames.append(
                    {
                        "file": Path(tb.tb_frame.f_code.co_filename).name,
                        "function": tb.tb_frame.f_code.co_name,
                        "line": tb.tb_lineno,
                    }
                )
                tb = tb.tb_next
            result["frames"] = frames
        return json.dumps(result, separators=(",", ":"))


file_handler = None


def configure():
    global file_handler
    logger = logging.getLogger("pool")
    if logger.handlers:
        return
    logger.setLevel(logging.INFO)
    logger.propagate = False
    stream = logging.StreamHandler()
    stream.setFormatter(JsonLog())
    logger.addHandler(stream)
    directory = os.environ.get("POOL_LOG_DIR")
    if directory:
        file_handler = RetainedLog(Path(directory) / "application.jsonl")
        file_handler.setFormatter(JsonLog())
        logger.addHandler(file_handler)


def maintenance():
    if file_handler:
        file_handler.maintain()
