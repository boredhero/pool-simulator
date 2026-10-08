"""Private 1v1 rooms over WebSocket. Turn-based shot-event sync.
Server is authoritative on rules + turn order + ball state; clients predict
locally for instant feel and reconcile to authoritative resting state.
"""

from __future__ import annotations

import math
import random
import string
from dataclasses import dataclass, field

from fastapi import WebSocket

from app.sim.config import match_config
from app.sim.cue import cue_elevation
from app.sim.physics import (
    Ball,
    ShotEvents,
    hash_state,
    simulate_shot,
    strike,
)
from app.sim.rules import (
    GameState,
    apply_shot,
    begin_shot,
    call_required,
    legal_targets,
    new_game,
    place_cue,
)


def _code() -> str:
    return "".join(
        random.choice(string.ascii_uppercase.replace("O", "").replace("I", "")) for _ in range(4)
    )


def ball_dump(balls: list[Ball]) -> list[dict]:
    return [
        {"id": b.id, "n": b.n, "x": round(b.x, 5), "y": round(b.y, 5), "potted": b.potted}
        for b in balls
    ]


def ev_dump(ev: ShotEvents) -> dict:
    return {
        "first_contact": ev.first_contact,
        "potted": ev.potted,
        "off_table": ev.off_table,
        "rail_after_contact": ev.rail_after_contact,
        "cue_potted": ev.cue_potted,
        "pockets": ev.pockets,
        "first_contact_x": ev.first_contact_x,
        "cue_left_kitchen": ev.cue_left_kitchen,
        "object_rails": ev.object_rails,
    }


@dataclass
class Room:
    code: str
    gs: GameState = field(default_factory=lambda: new_game(random.randint(1, 1 << 30)))
    players: list[WebSocket | None] = field(default_factory=lambda: [None, None])
    names: list[str] = field(default_factory=lambda: ["Player 1", "Player 2"])
    revision: int = 0
    busy: bool = False  # shot in flight

    def state_msg(self) -> dict:
        return {
            "t": "state",
            "code": self.code,
            "balls": ball_dump(self.gs.balls),
            "return_order": self.gs.return_order,
            "current": self.gs.current,
            "groups": self.gs.groups,
            "open": self.gs.open,
            "ball_in_hand": self.gs.ball_in_hand,
            "break_shot": self.gs.break_shot,
            "placement": self.gs.placement,
            "kitchen_shot": self.gs.kitchen_shot,
            "rules": self.gs.rules,
            "ruleset": {"id": "eight-ball", "version": 1},
            "revision": self.revision,
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
                room.gs.rules = match_config(msg.get("rules"))
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

            elif typ in ("shot", "place") and msg.get("revision", room.revision) != room.revision:
                await ws.send_json({"t": "error", "error": "stale table state"})
                await ws.send_json(room.state_msg())

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
                if cue.potted or room.gs.ball_in_hand:
                    await ws.send_json({"t": "error", "error": "cue ball in hand — place it first"})
                    continue
                if not all(math.isfinite(v) for v in (aim, power, tip_x, tip_y)):
                    await ws.send_json({"t": "error", "error": "bad shot"})
                    continue
                called_ball, called_pocket = s.get("calledBall"), s.get("calledPocket")
                if call_required(room.gs) and (
                    called_ball not in legal_targets(room.gs)
                    or type(called_pocket) is not int
                    or not 0 <= called_pocket < 6
                ):
                    await ws.send_json({"t": "error", "error": "call a legal ball and pocket"})
                    continue
                begin_shot(room.gs, called_ball, called_pocket)
                room.busy = True
                vmax = room.gs.rules["breakMax" if room.gs.break_shot else "normalMax"]
                elevation = cue_elevation(cue.x, cue.y, aim, 0, room.gs.balls)
                strike(cue, _m.cos(aim), _m.sin(aim), power, tip_x, tip_y, vmax, elevation)
                server_ev = simulate_shot(room.gs.balls, 0)
                room.__dict__["pending_ev"] = server_ev
                room.__dict__["pending_hash"] = hash_state(room.gs.balls)
                await room.broadcast(
                    {
                        "t": "shot",
                        "by": seat,
                        "shot": {
                            "aim": aim,
                            "power": power,
                            "tipX": tip_x,
                            "tipY": tip_y,
                            "elevation": elevation,
                            "vmax": vmax,
                            "calledBall": called_ball,
                            "calledPocket": called_pocket,
                        },
                    }
                )

            elif typ == "done":
                if seat != room.gs.current or not room.busy:
                    continue
                server_ev: ShotEvents = room.__dict__.get("pending_ev", ShotEvents())
                # Always adjudicate authoritative physical facts and resting positions.
                final_ev = server_ev
                use_server = True
                room.busy = False
                apply_shot(room.gs, final_ev)
                room.revision += 1
                await room.broadcast(
                    {
                        **room.state_msg(),
                        "t": "result",
                        "ev": ev_dump(final_ev),
                        "corrected": use_server,
                    }
                )

            elif typ == "place":
                if seat != room.gs.current or not room.gs.ball_in_hand or room.busy:
                    continue
                try:
                    x, y = float(msg["x"]), float(msg["y"])
                except (KeyError, TypeError, ValueError):
                    continue
                if place_cue(room.gs, x, y):
                    room.revision += 1
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
