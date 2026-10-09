"""Planar rolling plus 3D flight and spin. Fixed dt=1/240, semi-implicit Euler
for friction + swept (analytic TOI) ball-ball / cushion / jaw collisions.
Mirror of frontend/src/sim/physics.ts — keep constants + behavior in sync.
Golden behavior is cross-checked by pytest/vitest suites, not bit-identical.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from app.sim.numeric import norm
from app.sim.table import BALL_R, POCKETS, TABLE_H, TABLE_W, capture_radius, cushions, jaws

DT = 1.0 / 240.0
G = 9.81
MU_S = 0.20
MU_R = 0.01
E_BALL = 0.94
E_CUSH_N = 0.76
MU_CUSH = 0.17
SPIN_DECAY = 10.0
SLEEP_V = 0.005
SLEEP_W = 0.5
TIP_C = 2.5
TIP_MAX = 0.55
SQUIRT_K = 5.7 * 3.141592653589793 / 180.0
VMAX_NORMAL = 3.5
VMAX_BREAK = 8.5
VMIN = 0.55

_CUSHIONS = cushions()
_JAWS = jaws()


@dataclass
class Ball:
    id: int = 0
    n: int | None = None  # ball number 1..15, None = cue
    x: float = 0.0
    y: float = 0.0
    z: float = 0.0  # Bottom height above cloth.
    vz: float = 0.0
    vx: float = 0.0
    vy: float = 0.0
    wx: float = 0.0
    wy: float = 0.0
    wz: float = 0.0
    asleep: bool = True
    potted: bool = False


@dataclass
class ShotEvents:
    first_contact: int | None = None
    potted: list[int] = field(default_factory=list)
    off_table: list[int | None] = field(default_factory=list)
    rail_after_contact: bool = False
    cue_potted: bool = False
    pockets: list[dict] = field(default_factory=list)
    first_contact_x: float | None = None
    cue_left_kitchen: bool = False
    object_rails: list[int] = field(default_factory=list)


def shoot_speed(power: float, vmax: float = VMAX_NORMAL) -> float:
    p = min(1.0, max(0.0, power))
    return VMIN + (p**1.55) * (vmax - VMIN)


def throw_mu(v_rel: float) -> float:
    return max(0.02, min(0.235, 0.016 + 0.219 * math.exp(-0.691 * abs(v_rel))))


def strike(
    b: Ball,
    dx: float,
    dy: float,
    power: float,
    tip_x: float,
    tip_y: float,
    vmax: float = VMAX_NORMAL,
    elevation: float = 0.0,
    chalk_level: float = 1.0,
) -> None:
    """Rigid cue impulse, then slate rebound; mirrors the browser model."""
    offset = norm(tip_x, tip_y)
    scale = TIP_MAX / offset if offset > TIP_MAX else 1.0
    tx, ty = tip_x * scale, tip_y * scale
    theta = max(0.0, min(math.pi / 2 - 0.01, elevation))
    ct, st = math.cos(theta), math.sin(theta)
    v = shoot_speed(power, vmax)
    sq = tx * SQUIRT_K
    c, s = math.cos(sq), math.sin(sq)
    rx, ry = dx * c - dy * s, dx * s + dy * c
    b.vx, b.vy, b.vz = rx * v * ct, ry * v * ct, -v * st
    w = TIP_C * v / BALL_R
    b.wx = w * (-tx * st * rx - ty * ry)
    b.wy = w * (-tx * st * ry + ty * rx)
    b.wz = -w * tx * ct
    from app.sim.chalk import contact

    _, _, h, grip = contact(chalk_level, tx, ty)
    if grip < 1:
        forward = h * h + grip * (1 - h * h)
        side, up = -h * tx * (1 - grip), -h * ty * (1 - grip)
        b.vx = v * (forward * rx * ct - side * ry + up * rx * st)
        b.vy = v * (forward * ry * ct + side * rx + up * ry * st)
        b.vz = v * (-forward * st + up * ct)
        b.wx *= grip
        b.wy *= grip
        b.wz *= grip
    b.asleep = False
    if b.z <= 1e-9 and b.vz < 0:
        land(b)


def land(b: Ball) -> None:
    """Restitution plus Coulomb-limited friction at the bottom contact."""

    b.z = 0.0
    if b.vz >= 0:
        return
    normal = -1.5 * b.vz
    ux, uy = b.vx - BALL_R * b.wy, b.vy + BALL_R * b.wx
    slip = norm(ux, uy)
    if slip > 1e-12:
        impulse = min(2 * slip / 7, MU_S * normal)
        ix, iy = -impulse * ux / slip, -impulse * uy / slip
        b.vx += ix
        b.vy += iy
        b.wx += 2.5 * iy / BALL_R
        b.wy -= 2.5 * ix / BALL_R
    b.vz *= -0.5
    if b.vz * b.vz / (2 * G) < 0.0005:
        b.vz = 0.0


def _advance(b: Ball, dt: float, ev: ShotEvents, cue_id: int) -> None:
    if b.potted or b.asleep:
        return
    b.x += b.vx * dt
    b.y += b.vy * dt
    if b.z > 0 or b.vz != 0:
        b.z += b.vz * dt - 0.5 * G * dt * dt
        b.vz -= G * dt
        if -1e-7 < b.z < 0:
            b.z = 0.0
    if b.id == cue_id and ev.first_contact is None and b.x >= TABLE_W / 4:
        ev.cue_left_kitchen = True


def _friction(b: Ball, dt: float) -> None:
    speed = norm(b.vx, b.vy)
    if speed < 1.5:
        for px, py, radius, _ in POCKETS:
            dx, dy = px - b.x, py - b.y
            distance = norm(dx, dy)
            capture = capture_radius(radius, speed)
            if 1e-6 < distance < capture + BALL_R:
                acceleration = 0.5 + 3 * (1 - distance / (capture + BALL_R))
                b.vx += acceleration * dx / distance * dt
                b.vy += acceleration * dy / distance * dt
    ux = b.vx - BALL_R * b.wy
    uy = b.vy + BALL_R * b.wx
    s = norm(ux, uy)
    # Exact solid-sphere slip transition; never reverse friction past zero slip.
    slide_time = min(dt, s / (3.5 * MU_S * G))
    if s > 1e-12:
        impulse = MU_S * G * slide_time
        b.vx -= impulse * ux / s
        b.vy -= impulse * uy / s
        b.wx -= 2.5 * impulse * uy / (BALL_R * s)
        b.wy += 2.5 * impulse * ux / (BALL_R * s)
    if slide_time < dt:
        speed = norm(b.vx, b.vy)
        deceleration = min(speed, MU_R * G * (dt - slide_time))
        if speed > 1e-12:
            b.vx -= deceleration * b.vx / speed
            b.vy -= deceleration * b.vy / speed
        b.wx = -b.vy / BALL_R
        b.wy = b.vx / BALL_R
    if b.wz != 0:
        d = min(abs(b.wz), SPIN_DECAY * dt)
        b.wz -= (1 if b.wz > 0 else -1) * d


def _earliest_contact(balls: list[Ball], dt: float):
    best = None
    r2 = BALL_R * 2
    live = [b for b in balls if not b.potted]
    for i, a in enumerate(live):
        for b in live[i + 1 :]:
            dx, dy, dz = a.x - b.x, a.y - b.y, a.z - b.z
            dvx, dvy, dvz = a.vx - b.vx, a.vy - b.vy, a.vz - b.vz
            qa = dvx * dvx + dvy * dvy + dvz * dvz
            qb = 2 * (dx * dvx + dy * dvy + dz * dvz)
            qc = dx * dx + dy * dy + dz * dz - r2 * r2
            if qc < 0:
                d = norm(dx, dy, dz)
                nx, ny = (dx / d, dy / d) if d > 1e-9 else (1.0, 0.0)
                best = (0.0, "bb", a.id, b.id, nx, ny, dz / d if d > 1e-9 else 0.0)
                continue
            if qa < 1e-12 or qb >= 0:
                continue
            disc = qb * qb - 4 * qa * qc
            if disc < 0:
                continue
            t = (-qb - math.sqrt(disc)) / (2 * qa)
            if 0 <= t <= dt and (best is None or t < best[0]):
                best = (
                    t,
                    "bb",
                    a.id,
                    b.id,
                    (dx + dvx * t) / r2,
                    (dy + dvy * t) / r2,
                    (dz + dvz * t) / r2,
                )
    for a in live:
        if a.z > 0 or a.vz != 0:
            t = (a.vz + math.sqrt(a.vz * a.vz + 2 * G * max(0, a.z))) / G
            if 0 <= t <= dt and (best is None or t < best[0]):
                best = (t, "floor", a.id, -1, 0.0, 0.0)
        for cu in _CUSHIONS:
            x1, y1, x2, y2 = cu.x1, cu.y1, cu.x2, cu.y2
            if y1 == y2:
                if a.vy == 0:
                    continue
                target = BALL_R if y1 == 0 else TABLE_H - BALL_R
                if (y1 == 0 and a.vy >= 0) or (y1 == TABLE_H and a.vy <= 0):
                    continue
                # Ball-ball separation can push a rail-frozen ball past the
                # inset plane. Airborne balls may already have legitimately
                # cleared that nose on an earlier step; recover grounded ones.
                crossing = (target - a.y) / a.vy
                if crossing < 0 and (a.z > 1e-9 or a.vz != 0):
                    continue
                t = max(0.0, crossing)
                if a.y < 0 or a.y > TABLE_H or t > dt or (best is not None and t >= best[0]):
                    continue
                cx = a.x + a.vx * t
                if (
                    not (min(x1, x2) - 1e-6 <= cx <= max(x1, x2) + 1e-6)
                    or a.z + a.vz * t - 0.5 * G * t * t > 0.05
                ):
                    continue
                best = (t, "rail", a.id, -1, 0.0, 1.0 if y1 == 0 else -1.0)
            else:
                if a.vx == 0:
                    continue
                target = BALL_R if x1 == 0 else TABLE_W - BALL_R
                if (x1 == 0 and a.vx >= 0) or (x1 == TABLE_W and a.vx <= 0):
                    continue
                crossing = (target - a.x) / a.vx
                if crossing < 0 and (a.z > 1e-9 or a.vz != 0):
                    continue
                t = max(0.0, crossing)
                if a.x < 0 or a.x > TABLE_W or t > dt or (best is not None and t >= best[0]):
                    continue
                cy = a.y + a.vy * t
                if (
                    not (min(y1, y2) - 1e-6 <= cy <= max(y1, y2) + 1e-6)
                    or a.z + a.vz * t - 0.5 * G * t * t > 0.05
                ):
                    continue
                best = (t, "rail", a.id, -1, 1.0 if x1 == 0 else -1.0, 0.0)
        for j in _JAWS:
            if a.z > 0.05 and a.vz >= 0:
                continue
            dx, dy = a.x - j[0], a.y - j[1]
            rr = BALL_R + j[2]
            qa = a.vx * a.vx + a.vy * a.vy
            if qa < 1e-12:
                continue
            qb = 2 * (dx * a.vx + dy * a.vy)
            qc = dx * dx + dy * dy - rr * rr
            if qc < 0:
                if a.z > 0.05:
                    continue
                if qb >= 0:  # Already leaving the jaw.
                    continue
                d = norm(dx, dy) or 1e-9
                if best is None or 0 < best[0]:
                    best = (0.0, "jaw", a.id, -1, dx / d, dy / d)
                continue
            if qb >= 0:
                continue
            disc = qb * qb - 4 * qa * qc
            if disc < 0:
                continue
            t = (-qb - math.sqrt(disc)) / (2 * qa)
            if 0 <= t <= dt and (best is None or t < best[0]):
                if a.z + a.vz * t - 0.5 * G * t * t <= 0.05:
                    best = (t, "jaw", a.id, -1, (dx + a.vx * t) / rr, (dy + a.vy * t) / rr)
    return best


def _resolve_bb(
    a: Ball, b: Ball, nx: float, ny: float, ev: ShotEvents, cue_id: int, nz: float = 0.0
) -> None:
    tx, ty = -ny, nx
    vn = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny + (a.vz - b.vz) * nz
    vt = (a.vx - b.vx) * tx + (a.vy - b.vy) * ty + BALL_R * (a.wz + b.wz)
    if vn < 0:
        jn = -(1 + E_BALL) * vn / 2
        a.vx += jn * nx
        a.vy += jn * ny
        a.vz += jn * nz
        b.vx -= jn * nx
        b.vy -= jn * ny
        b.vz -= jn * nz
        jt = max(-throw_mu(vn) * jn, min(throw_mu(vn) * jn, -vt / 2))
        a.vx += jt * tx
        a.vy += jt * ty
        b.vx -= jt * tx
        b.vy -= jt * ty
        dwz = 2.5 * jt / BALL_R
        a.wz += dwz
        b.wz += dwz
        a.asleep = b.asleep = False
        if ev.first_contact is None and (a.id == cue_id or b.id == cue_id):
            other = b if a.id == cue_id else a
            ev.first_contact = other.n
            ev.first_contact_x = other.x
    # Position-only correction, including impacts and coincident centers.
    distance = norm(a.x - b.x, a.y - b.y, a.z - b.z)
    if distance < BALL_R * 2:
        push = (BALL_R * 2 - distance) / 2 + 1e-8
        a.x += nx * push
        a.y += ny * push
        a.z = max(0.0, a.z + nz * push)
        b.x -= nx * push
        b.y -= ny * push
        b.z = max(0.0, b.z - nz * push)


def _resolve_rail(a: Ball, nx: float, ny: float, ev: ShotEvents, contact_made: dict) -> None:
    vn = a.vx * nx + a.vy * ny
    if vn >= 0:
        return
    tx, ty = -ny, nx
    rx, ry = -nx * BALL_R, -ny * BALL_R
    vt_rel = (a.vx * tx + a.vy * ty) + ((-a.wz * ry) * tx + (a.wz * rx) * ty)
    jn = -(1 + E_CUSH_N) * vn
    a.vx += jn * nx
    a.vy += jn * ny
    jt = max(-MU_CUSH * jn, min(MU_CUSH * jn, -vt_rel))
    a.vx += jt * tx
    a.vy += jt * ty
    a.wz += 2.5 * (rx * (jt * ty) - ry * (jt * tx)) / (BALL_R * BALL_R)
    a.asleep = False
    if contact_made["v"] or ev.first_contact is not None or ev.potted:
        ev.rail_after_contact = True
        if a.n is not None and a.n not in ev.object_rails:
            ev.object_rails.append(a.n)


def step(balls: list[Ball], dt: float, ev: ShotEvents, cue_id: int, contact_made: dict) -> None:
    if ev.first_contact is not None or ev.potted:
        contact_made["v"] = True
    prev: dict[int, tuple[float, float]] = {}
    for b in balls:
        if not b.potted and not b.asleep:
            prev[b.id] = (b.x, b.y)
            if b.z <= 1e-9 and b.vz == 0:
                _friction(b, dt)
    remaining = dt
    for _ in range(64):
        if remaining <= 1e-9:
            break
        c = _earliest_contact(balls, remaining)
        if c is None:
            break
        t = min(c[0], remaining)
        for b in balls:
            if not b.potted and not b.asleep:
                _advance(b, t, ev, cue_id)
        remaining -= t
        by_id = {b.id: b for b in balls}
        if c[1] == "bb":
            _resolve_bb(by_id[c[2]], by_id[c[3]], c[4], c[5], ev, cue_id, c[6])
        elif c[1] == "floor":
            land(by_id[c[2]])
        else:
            ball = by_id[c[2]]
            if c[1] == "rail":
                if c[4] > 0:
                    ball.x = max(ball.x, BALL_R)
                elif c[4] < 0:
                    ball.x = min(ball.x, TABLE_W - BALL_R)
                if c[5] > 0:
                    ball.y = max(ball.y, BALL_R)
                elif c[5] < 0:
                    ball.y = min(ball.y, TABLE_H - BALL_R)
            _resolve_rail(ball, c[4], c[5], ev, contact_made)
    if remaining > 1e-9:
        for b in balls:
            if not b.potted and not b.asleep:
                _advance(b, remaining, ev, cue_id)
                if b.z < 0:
                    land(b)

    def seg_dist(x1: float, y1: float, x2: float, y2: float, px: float, py: float) -> float:
        dx, dy = x2 - x1, y2 - y1
        l2 = dx * dx + dy * dy
        t = ((px - x1) * dx + (py - y1) * dy) / l2 if l2 > 0 else 0.0
        t = max(0.0, min(1.0, t))
        return norm(px - (x1 + dx * t), py - (y1 + dy * t))

    for b in balls:
        if b.potted:
            continue
        captured = False
        pr = prev.get(b.id)
        spd = norm(b.vx, b.vy)
        for pocket, p in enumerate(POCKETS):
            if b.z > 0.005:
                continue
            cr = capture_radius(p[2], spd)
            if pr is not None:
                d = seg_dist(pr[0], pr[1], b.x, b.y, p[0], p[1])
            else:
                d = norm(b.x - p[0], b.y - p[1])
            if d < cr:
                b.potted = True
                b.asleep = True
                b.z = b.vz = b.vx = b.vy = b.wx = b.wy = b.wz = 0.0
                if b.n is not None:
                    ev.potted.append(b.n)
                    ev.pockets.append({"n": b.n, "pocket": pocket})
                else:
                    ev.cue_potted = True
                captured = True
                break
        if not captured and (
            b.x < -0.12 or b.x > TABLE_W + 0.12 or b.y < -0.12 or b.y > TABLE_H + 0.12
        ):
            b.potted = True
            b.asleep = True
            b.z = b.vz = b.vx = b.vy = b.wx = b.wy = b.wz = 0.0
            ev.off_table.append(b.n)
            if b.n is None:
                ev.cue_potted = True
            continue
        if (
            not b.potted
            and b.z <= 1e-9
            and b.vz == 0
            and norm(b.vx, b.vy) < SLEEP_V
            and norm(b.wx, b.wy) < SLEEP_W
        ):
            b.z = b.vz = b.vx = b.vy = b.wx = b.wy = b.wz = 0.0
            b.asleep = True


def all_asleep(balls: list[Ball]) -> bool:
    return all(b.potted or b.asleep for b in balls)


def simulate_shot(balls: list[Ball], cue_id: int, max_sim: float = 45.0) -> ShotEvents:
    ev = ShotEvents()
    contact_made: dict = {"v": False}
    t = 0.0
    while t < max_sim and not all_asleep(balls):
        step(balls, DT, ev, cue_id, contact_made)
        t += DT
    return ev


def hash_state(balls: list[Ball]) -> str:
    h = 0x811C9DC5
    for b in sorted(balls, key=lambda q: q.id):
        for v in (b.x, b.y, b.z, b.vx, b.vy, b.vz, b.wx, b.wy, b.wz):
            h ^= round(v * 1e9) & 0xFFFFFFFF
            h = (h * 0x01000193) & 0xFFFFFFFF
        h ^= 1 if b.potted else 0
        h = (h * 0x01000193) & 0xFFFFFFFF
    return format(h, "x")
