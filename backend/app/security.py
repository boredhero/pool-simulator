"""Bound HTTP request bodies before parsing or password hashing."""

import asyncio

from starlette.responses import JSONResponse

MAX_BODY = 16384


class BodyLimit:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] not in ("POST", "PUT", "PATCH"):
            return await self.app(scope, receive, send)
        buffered = bytearray()
        size = 0
        try:
            async with asyncio.timeout(10):
                while True:
                    message = await receive()
                    if message["type"] == "http.disconnect":
                        return
                    body = message.get("body", b"")
                    size += len(body)
                    if size > MAX_BODY:
                        await JSONResponse({"detail": "Request too large"}, 413)(
                            scope, receive, send
                        )
                        return
                    buffered.extend(body)
                    if not message.get("more_body", False):
                        break
        except TimeoutError:
            await JSONResponse({"detail": "Request timed out"}, 408)(scope, receive, send)
            return
        delivered = False

        async def bounded_receive():
            nonlocal delivered
            if delivered:
                return await receive()
            delivered = True
            return {"type": "http.request", "body": bytes(buffered), "more_body": False}

        await self.app(scope, bounded_receive, send)
