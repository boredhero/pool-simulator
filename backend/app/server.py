"""Production entrypoint: mark shutdown before Uvicorn closes player sockets."""

import uvicorn

from app.net.rooms import lobby


class PoolServer(uvicorn.Server):
    def handle_exit(self, sig, frame):
        lobby.draining = True
        super().handle_exit(sig, frame)

    async def shutdown(self, sockets=None):
        lobby.draining = True
        await super().shutdown(sockets)


if __name__ == "__main__":
    PoolServer(
        uvicorn.Config(
            "app.main:app",
            host="0.0.0.0",
            port=8000,
            ws_max_size=16384,
            ws_max_queue=8,
            ws_per_message_deflate=False,
            limit_concurrency=512,
            backlog=128,
        )
    ).run()
