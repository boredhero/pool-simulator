"""Ephemeral private rooms with authenticated identities and a durable server match ledger."""

from __future__ import annotations

import asyncio
import json
import logging
import math
import random
import secrets
import time
from dataclasses import dataclass, field

from fastapi import HTTPException, WebSocket, WebSocketDisconnect

from app.services.auth import COOKIE, account_for_token, allowed_origin, rate_limit
from app.services.matches import abandon_match, record_shot, start_match
from app.sim.config import match_config
from app.sim.cue import cue_elevation
from app.sim.physics import Ball, ShotEvents, simulate_shot, strike
from app.sim.rules import (
    GameState,
    apply_shot,
    begin_shot,
    call_required,
    eight_ball,
    legal_targets,
    new_game,
    place_cue,
)

logger = logging.getLogger(__name__)


def _code() -> str:
    return "".join(secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(8))


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


def valid_message(msg: dict) -> bool:
    """Only accept finite, bounded protocol inputs; never trust browser state."""
    kind = msg.get("t")
    if not isinstance(kind, str):
        return False
    if kind in ("leave", "done"):
        return True  # Legacy playback facts are deliberately ignored.
    if kind in ("create", "join"):
        if not isinstance(msg.get("name", ""), str) or len(msg.get("name", "")) > 24:
            return False
        if kind == "create":
            return isinstance(msg.get("rules", {}), dict)
        code = msg.get("code")
        return isinstance(code, str) and len(code) == 8 and code.isascii() and code.isalnum()
    if kind not in ("shot", "place") or type(msg.get("revision")) is not int:
        return False
    if not 0 <= msg["revision"] <= 2**31 - 1:
        return False

    def finite(value, bound=1e6):
        return type(value) in (int, float) and -bound <= value <= bound and math.isfinite(value)

    if kind == "place":
        return finite(msg.get("x")) and finite(msg.get("y"))
    shot = msg.get("shot")
    if not isinstance(shot, dict):
        return False
    if not all(finite(shot.get(key, 0)) for key in ("aim", "power", "tipX", "tipY")):
        return False
    for key, low, high in (("calledBall", 1, 15), ("calledPocket", 0, 5)):
        value = shot.get(key)
        if value is not None and (type(value) is not int or not low <= value <= high):
            return False
    return "aim" in shot and "power" in shot


@dataclass
class Room:
    code: str
    gs: GameState = field(default_factory=lambda: new_game(random.randint(1, 1 << 30)))
    players: list[WebSocket | None] = field(default_factory=lambda: [None, None])
    names: list[str] = field(default_factory=lambda: ["Player 1", "Player 2"])
    accounts: list[str | None] = field(default_factory=lambda: [None, None])
    revision: int = 0
    busy: bool = False
    closed: bool = False
    match_id: str | None = None
    started: bool = False
    touched: float = field(default_factory=time.monotonic)

    def state_msg(self) -> dict:
        return {
            "t": "state",
            "code": self.code,
            "names": self.names,
            "ready": all(self.players) and not self.closed,
            "registered": [account is not None for account in self.accounts],
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
            "ruleset": {"id": eight_ball.id, "version": eight_ball.version},
            "revision": self.revision,
            "winner": self.gs.winner,
            "message": self.gs.message,
        }

    async def broadcast(self, msg: dict, exclude: int = -1) -> None:
        for i, ws in enumerate(self.players):
            if ws is not None and i != exclude:
                try:
                    await asyncio.wait_for(ws.send_json(msg), timeout=5)
                except Exception:
                    pass  # Disconnect cleanup runs in the socket handler.


class Lobby:
    def __init__(self) -> None:
        self.rooms: dict[str, Room] = {}
        self.connections: dict[str, int] = {}
        self.simulations = 0
        self.draining = False

    def create(self) -> Room:
        if len(self.rooms) >= 200:
            raise HTTPException(429, "Rooms are full. Try again shortly.")
        code = _code()
        while code in self.rooms:
            code = _code()
        room = Room(code=code)
        self.rooms[code] = room
        return room

    def get(self, code: str) -> Room | None:
        return self.rooms.get(code.upper())


lobby = Lobby()


def guest_name(value, seat: int) -> str:
    text = str(value or "").strip()
    text = "".join(c for c in text if c.isprintable())[:24]
    return text or f"Guest {seat + 1}"


async def handle(ws: WebSocket) -> None:
    if not allowed_origin(ws.headers.get("origin"), ws.headers.get("host", "")):
        await ws.close(code=1008)
        return
    ip = ws.client.host if ws.client else "unknown"
    if (
        lobby.draining
        or lobby.connections.get(ip, 0) >= 8
        or sum(lobby.connections.values()) >= 400
    ):
        await ws.close(code=1013)
        return
    lobby.connections[ip] = lobby.connections.get(ip, 0) + 1
    tokens, last_message = 30.0, time.monotonic()
    server_failure = False
    room: Room | None = None
    seat = -1
    identity: dict | None = None
    token = ws.cookies.get(COOKIE)
    try:
        await ws.accept()
        await asyncio.to_thread(rate_limit, "ws-connect", ip, 60)
        identity = await asyncio.to_thread(account_for_token, token)
        if token and identity is None:
            await ws.send_json(
                {
                    "t": "error",
                    "error": "Session expired. Sign in again or sign out to play as a guest.",
                }
            )
            return
        while True:
            raw = await asyncio.wait_for(ws.receive_text(), timeout=900 if room else 30)
            now = time.monotonic()
            tokens = min(30.0, tokens + (now - last_message))
            last_message = now
            if tokens < 1:
                await ws.close(code=1008, reason="Message rate exceeded")
                return
            tokens -= 1
            if len(raw.encode("utf-8")) > 16384:
                await ws.close(code=1009)
                return
            try:
                msg = json.loads(raw)
            except (ValueError, RecursionError):
                await ws.send_json({"t": "error", "error": "Invalid message"})
                continue
            if not isinstance(msg, dict):
                continue
            typ = msg.get("t")
            if not valid_message(msg):
                await ws.send_json({"t": "error", "error": "Invalid message fields"})
                continue
            if identity and await asyncio.to_thread(account_for_token, token) is None:
                await ws.send_json({"t": "error", "error": "Session ended. Sign in again."})
                return
            if room and room.closed:
                return
            if room:
                room.touched = time.monotonic()

            if typ in ("create", "join"):
                if room is not None:
                    await ws.send_json({"t": "error", "error": "Leave your current room first."})
                    continue
                await asyncio.to_thread(rate_limit, "room-entry", ip, 30)
                if typ == "create":
                    room = lobby.create()
                    room.gs.rules = match_config(msg.get("rules"))
                    seat = 0
                else:
                    candidate = lobby.get(str(msg.get("code", "")))
                    if candidate is None or candidate.closed:
                        await ws.send_json({"t": "error", "error": "Room not found or expired."})
                        continue
                    if candidate.players[1] is not None or candidate.match_id:
                        await ws.send_json({"t": "error", "error": "Room is full."})
                        continue
                    if identity and identity["id"] == candidate.accounts[0]:
                        await ws.send_json(
                            {
                                "t": "error",
                                "error": "Use another account or a guest for the other seat.",
                            }
                        )
                        continue
                    room, seat = candidate, 1
                room.players[seat] = ws
                room.names[seat] = (
                    identity["username"] if identity else guest_name(msg.get("name"), seat)
                )
                room.accounts[seat] = identity["id"] if identity else None
                if seat == 1:
                    room.match_id = await asyncio.to_thread(
                        start_match, room.names, room.accounts, room.gs.rules
                    )
                await ws.send_json(
                    {"t": "room", "code": room.code, "you": seat, "state": room.state_msg()}
                )
                if seat == 1:
                    await room.broadcast({"t": "joined", "names": room.names}, exclude=seat)
                    await room.broadcast(room.state_msg())

            elif room is None or seat < 0:
                await ws.send_json({"t": "error", "error": "Join a room first."})

            elif typ == "leave":
                return

            elif typ in ("shot", "place") and msg.get("revision") != room.revision:
                await ws.send_json({"t": "error", "error": "stale table state"})
                await ws.send_json(room.state_msg())

            elif typ == "shot":
                if not all(room.players) or not room.match_id:
                    await ws.send_json(
                        {"t": "error", "error": "Waiting for your opponent to join."}
                    )
                    continue
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
                cue = room.gs.balls[0]
                if cue.potted or room.gs.ball_in_hand:
                    await ws.send_json({"t": "error", "error": "cue ball in hand — place it first"})
                    continue
                if (
                    not all(math.isfinite(v) for v in (aim, power, tip_x, tip_y))
                    or not 0 < power <= 1
                    or math.hypot(tip_x, tip_y) > 0.55
                ):
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
                if lobby.simulations >= 4:
                    await ws.send_json({"t": "error", "error": "Server busy. Try again shortly."})
                    continue
                begin_shot(room.gs, called_ball, called_pocket)
                room.started = True
                room.busy = True
                vmax = room.gs.rules["breakMax" if room.gs.break_shot else "normalMax"]
                elevation = cue_elevation(cue.x, cue.y, aim, 0, room.gs.balls)
                shot = {
                    "aim": aim,
                    "power": power,
                    "tipX": tip_x,
                    "tipY": tip_y,
                    "elevation": elevation,
                    "vmax": vmax,
                    "calledBall": called_ball,
                    "calledPocket": called_pocket,
                }
                strike(cue, math.cos(aim), math.sin(aim), power, tip_x, tip_y, vmax, elevation)
                await room.broadcast({"t": "shot", "by": seat, "shot": shot})
                lobby.simulations += 1
                try:
                    server_ev = await asyncio.to_thread(simulate_shot, room.gs.balls, 0)
                finally:
                    lobby.simulations -= 1
                if room.closed:
                    return
                apply_shot(room.gs, server_ev)
                room.revision += 1
                facts = ev_dump(server_ev)
                foul = (
                    room.gs.ball_in_hand
                    or room.gs.message.startswith("Illegal break")
                    or (room.gs.winner is not None and room.gs.winner != seat)
                )
                await asyncio.to_thread(
                    record_shot,
                    room.match_id,
                    room.revision,
                    seat,
                    shot,
                    facts,
                    room.gs.winner,
                    foul,
                )
                room.busy = False
                await room.broadcast(
                    {**room.state_msg(), "t": "result", "ev": facts, "corrected": True}
                )

            elif typ == "done":
                pass  # Playback acknowledgement is not evidence and cannot create statistics.

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
    except WebSocketDisconnect:
        pass  # Peer-supplied close codes cannot waive a forfeit.
    except TimeoutError:
        pass
    except asyncio.CancelledError:
        server_failure = True
        raise
    except HTTPException as exc:
        await ws.send_json({"t": "error", "error": exc.detail})
    except Exception:
        server_failure = True
        logger.exception("Room handler failed")
    finally:
        lobby.connections[ip] -= 1
        if not lobby.connections[ip]:
            del lobby.connections[ip]
        if room is not None and 0 <= seat <= 1 and room.players[seat] is ws:
            room.players[seat] = None
            room.closed = True
            lobby.rooms.pop(room.code, None)
            if room.match_id:
                await asyncio.to_thread(
                    abandon_match,
                    room.match_id,
                    seat,
                    room.started,
                    server_failure or lobby.draining,
                )
            await room.broadcast(
                {
                    "t": "left",
                    "names": room.names,
                    "message": (
                        "Room closed. Leaving a started game counts as a casual forfeit; "
                        "server interruptions do not."
                    ),
                }
            )
            for peer in room.players:
                if peer is not None:
                    try:
                        await peer.close()
                    except Exception:
                        pass
        try:
            await ws.close()
        except Exception:
            pass
