"""Private 1v1 rooms over WebSocket. Turn-based shot-event sync.
Server is authoritative on rules + turn order + ball state; clients predict
locally for instant feel and reconcile at rest (loose event-set match, since
TS and Python sims are not bit-identical).
"""

from __future__ import annotations

import math
import random
import string
from dataclasses import dataclass, field

from fastapi import WebSocket

from app.sim.physics import Ball, ShotEvents, hash_state, simulate_shot, strike
from app.sim.rules import GameState, apply_shot, new_game, place_cue

POS_TOL = 0.05  # position reconciliation tolerance (m)


def _code() -> str:
    return "".join(
        random.choice(string.ascii_uppercase.replace("O", "").replace("I", "")) for _ in range(4)
    )


def ball_dump(balls: list[Ball]) -> list[dict]:
    return [
        {"id": b.id, "n": b.n, "x": round(b.x, 5), "y": round(b.y, 5), "potted": b.potted}
        for b in balls
    ]


def ball_load(balls: list[Ball], data: list[dict]) -> None:
    by_id = {b.id: b for b in balls}
    for d in data:
        b = by_id.get(d["id"])
        if b is None:
            continue
        b.x, b.y = float(d["x"]), float(d["y"])
        b.potted = bool(d["potted"])
        b.vx = b.vy = b.wx = b.wy = b.wz = 0.0
        b.asleep = True


def ev_dump(ev: ShotEvents) -> dict:
    return {
        "first_contact": ev.first_contact,
        "potted": ev.potted,
        "off_table": ev.off_table,
        "rail_after_contact": ev.rail_after_contact,
        "cue_potted": ev.cue_potted,
    }


@dataclass
class Room:
    code: str
    gs: GameState = field(default_factory=lambda: new_game(random.randint(1, 1 << 30)))
    players: list[WebSocket | None] = field(default_factory=lambda: [None, None])
    names: list[str] = field(default_factory=lambda: ["Player 1", "Player 2"])
    busy: bool = False  # shot in flight

    def state_msg(self) -> dict:
        return {
            "t": "state",
            "code": self.code,
            "balls": ball_dump(self.gs.balls),
            "current": self.gs.current,
            "groups": self.gs.groups,
            "open": self.gs.open,
            "ball_in_hand": self.gs.ball_in_hand,
            "winner": self.gs.winner,
            "message": self.gs.message,
        }

    async def broadcast(self, msg: dict, exclude: int = -1) -> None:
        for i, ws in enumerate(self.players):
            if ws is not None and i != exclude:
                try:
                    await ws.send_json(msg)
                except Exception:
                    pass


class Lobby:
    def __init__(self) -> None:
        self.rooms: dict[str, Room] = {}

    def create(self) -> Room:
        code = _code()
        while code in self.rooms:
            code = _code()
        room = Room(code=code)
        self.rooms[code] = room
        return room

    def get(self, code: str) -> Room | None:
        return self.rooms.get(code.upper())


lobby = Lobby()


def _events_match(a: ShotEvents, b: ShotEvents) -> bool:
    return (
        a.first_contact == b.first_contact
        and sorted(a.potted) == sorted(b.potted)
        and sorted(x for x in a.off_table if x is not None)
        == sorted(x for x in b.off_table if x is not None)
        and a.cue_potted == b.cue_potted
    )


def _positions_close(balls: list[Ball], data: list[dict]) -> bool:
    by_id = {b.id: b for b in balls}
    for d in data:
        b = by_id.get(d["id"])
        if b is None or b.potted != bool(d["potted"]):
            return False
        if not b.potted and math.hypot(b.x - float(d["x"]), b.y - float(d["y"])) > POS_TOL:
            return False
    return True


async def handle(ws: WebSocket) -> None:
    await ws.accept()
    room: Room | None = None
    seat = -1
    try:
        while True:
            msg = await ws.receive_json()
            typ = msg.get("t")

            if typ == "create":
                room = lobby.create()
                seat = 0
                room.players[0] = ws
                room.names[0] = str(msg.get("name", "Player 1"))[:24]
                await ws.send_json(
                    {"t": "room", "code": room.code, "you": 0, "state": room.state_msg()}
                )

            elif typ == "join":
                room = lobby.get(str(msg.get("code", "")))
                if room is None:
                    await ws.send_json({"t": "error", "error": "no such room"})
                    continue
                seat = 1 if room.players[0] is not None else 0
                if seat == 1 and room.players[1] is not None:
                    await ws.send_json({"t": "error", "error": "room full"})
                    room, seat = None, -1
                    continue
                room.players[seat] = ws
                room.names[seat] = str(msg.get("name", f"Player {seat + 1}"))[:24]
                await ws.send_json(
                    {"t": "room", "code": room.code, "you": seat, "state": room.state_msg()}
                )
                await room.broadcast({"t": "joined", "names": room.names}, exclude=seat)
                await room.broadcast(room.state_msg())

            elif room is None or seat < 0:
                await ws.send_json({"t": "error", "error": "join a room first"})

            elif typ == "shot":
                if seat != room.gs.current or room.gs.winner is not None or room.busy:
                    await ws.send_json({"t": "error", "error": "not your turn"})
                    continue
                s = msg.get("shot", {})
                try:
                    aim, power = float(s["aim"]), float(s["power"])
                    tip_x, tip_y = float(s.get("tipX", 0)), float(s.get("tipY", 0))
                except (KeyError, TypeError, ValueError):
                    await ws.send_json({"t": "error", "error": "bad shot"})
                    continue
                import math as _m

                cue = room.gs.balls[0]
                if cue.potted:
                    await ws.send_json({"t": "error", "error": "cue ball in hand — place it first"})
                    continue
                room.busy = True
                strike(cue, _m.cos(aim), _m.sin(aim), power, tip_x, tip_y)
                server_ev = simulate_shot(room.gs.balls, 0)
                room.__dict__["pending_ev"] = server_ev
                room.__dict__["pending_hash"] = hash_state(room.gs.balls)
                await room.broadcast(
                    {
                        "t": "shot",
                        "by": seat,
                        "shot": {"aim": aim, "power": power, "tipX": tip_x, "tipY": tip_y},
                    }
                )

            elif typ == "done":
                if seat != room.gs.current or not room.busy:
                    continue
                server_ev: ShotEvents = room.__dict__.get("pending_ev", ShotEvents())
                balls_data = msg.get("balls", [])
                client_ev = msg.get("ev")
                use_server = True
                if isinstance(client_ev, dict) and isinstance(balls_data, list):
                    ce = ShotEvents(
                        first_contact=client_ev.get("first_contact"),
                        potted=list(client_ev.get("potted", [])),
                        off_table=list(client_ev.get("off_table", [])),
                        rail_after_contact=bool(client_ev.get("rail_after_contact")),
                        cue_potted=bool(client_ev.get("cue_potted")),
                    )
                    if _events_match(server_ev, ce) and _positions_close(room.gs.balls, balls_data):
                        ball_load(room.gs.balls, balls_data)  # smoother: keep client's rest pose
                        use_server = False
                final_ev = server_ev if use_server else ce
                room.busy = False
                apply_shot(room.gs, final_ev)
                await room.broadcast(
                    {
                        **room.state_msg(),
                        "t": "result",
                        "ev": ev_dump(final_ev),
                        "corrected": use_server,
                    }
                )

            elif typ == "place":
                if seat != room.gs.current or not room.gs.ball_in_hand:
                    continue
                try:
                    x, y = float(msg["x"]), float(msg["y"])
                except (KeyError, TypeError, ValueError):
                    continue
                if place_cue(room.gs, x, y):
                    room.gs.ball_in_hand = False
                    await room.broadcast(room.state_msg())

            else:
                await ws.send_json({"t": "error", "error": "unknown message"})
    except Exception:
        pass
    finally:
        if room is not None and 0 <= seat <= 1 and room.players[seat] is ws:
            room.players[seat] = None
            try:
                await room.broadcast({"t": "left", "names": room.names})
            except Exception:
                pass
