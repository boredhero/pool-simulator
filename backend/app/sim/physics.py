"""Custom 2D + 3-axis-spin pool physics. Fixed dt=1/240, semi-implicit Euler
for friction + swept (analytic TOI) ball-ball / cushion / jaw collisions.
Mirror of frontend/src/sim/physics.ts — keep constants + behavior in sync.
Golden behavior is cross-checked by pytest/vitest suites, not bit-identical.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.sim.table import BALL_R, POCKETS, TABLE_H, TABLE_W, capture_radius, cushions, jaws

DT = 1.0 / 240.0
G = 9.81
MU_S = 0.20
MU_R = 0.013  # rolling resistance (slightly heavy cloth for pace)
E_BALL = 0.95
E_CUSH = 0.85
MU_BB = 0.06
MU_RAIL = 0.30
RAIL_RET = 0.92
SPIN_DECAY = 8.0
SLEEP_V = 1e-3
SLEEP_W = 0.5
TIP_C = 0.8
TIP_MAX = 0.55
SQUIRT_K = 4.5 * 3.141592653589793 / 180.0

_CUSHIONS = cushions()
_JAWS = jaws()


@dataclass
class Ball:
    id: int = 0
    n: int | None = None  # ball number 1..15, None = cue
    x: float = 0.0
    y: float = 0.0
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


def shoot_speed(power: float) -> float:
    p = min(1.0, max(0.0, power))
    return 0.4 + (p**1.6) * (8 - 0.4)


def strike(b: Ball, dx: float, dy: float, power: float, tip_x: float, tip_y: float) -> None:
    tx = max(-TIP_MAX, min(TIP_MAX, tip_x))
    ty = max(-TIP_MAX, min(TIP_MAX, tip_y))
    v = shoot_speed(power)
    import math

    sq = tx * SQUIRT_K
    c, s = math.cos(sq), math.sin(sq)
    rx, ry = dx * c - dy * s, dx * s + dy * c
    b.vx, b.vy = rx * v, ry * v
    sx, sy = -ry, rx
    w_side = TIP_C * v * ty / BALL_R
    b.wx, b.wy = sx * w_side, sy * w_side
    b.wz = -TIP_C * v * tx / BALL_R
    b.asleep = False


def _friction(b: Ball, dt: float) -> None:
    ux = b.vx - BALL_R * b.wy
    uy = b.vy + BALL_R * b.wx
    s = (ux**2 + uy**2) ** 0.5
    slip_min = max(1e-4, 1.5 * MU_S * G * dt)
    if s > slip_min:
        ax, ay = -MU_S * G * ux / s, -MU_S * G * uy / s
        b.vx += ax * dt
        b.vy += ay * dt
        k = (5 * MU_S * G) / (2 * BALL_R) * dt
        b.wx += -k * uy / s
        b.wy += k * ux / s
    else:
        v = (b.vx**2 + b.vy**2) ** 0.5
        if v > 1e-9:
            d = min(v, MU_R * G * dt)
            b.vx -= d * b.vx / v
            b.vy -= d * b.vy / v
        k = min(1.0, 10 * dt)
        b.wx += (-b.vy / BALL_R - b.wx) * k
        b.wy += (b.vx / BALL_R - b.wy) * k
    if b.wz != 0:
        d = min(abs(b.wz), SPIN_DECAY * dt)
        b.wz -= (1 if b.wz > 0 else -1) * d


def _earliest_contact(balls: list[Ball], dt: float):
    best = None
    r2 = BALL_R * 2
    live = [b for b in balls if not b.potted]
    for i, a in enumerate(live):
        if a.asleep and a.vx == 0 and a.vy == 0:
            continue
        for b in live[i + 1 :]:
            dx, dy = a.x - b.x, a.y - b.y
            dvx, dvy = a.vx - b.vx, a.vy - b.vy
            qa = dvx * dvx + dvy * dvy
            if qa < 1e-12:
                continue
            qb = 2 * (dx * dvx + dy * dvy)
            qc = dx * dx + dy * dy - r2 * r2
            if qc < 0:
                d = (dx * dx + dy * dy) ** 0.5 or 1e-9
                best = (0.0, "bb", a.id, b.id, dx / d, dy / d)
                continue
            if qb >= 0:
                continue
            disc = qb * qb - 4 * qa * qc
            if disc < 0:
                continue
            t = (-qb - disc**0.5) / (2 * qa)
            if 0 <= t <= dt and (best is None or t < best[0]):
                best = (t, "bb", a.id, b.id, (dx + dvx * t) / r2, (dy + dvy * t) / r2)
    for a in live:
        for cu in _CUSHIONS:
            x1, y1, x2, y2 = cu.x1, cu.y1, cu.x2, cu.y2
            if y1 == y2:
                if a.vy == 0:
                    continue
                target = BALL_R if y1 == 0 else TABLE_H - BALL_R
                if (y1 == 0 and a.vy >= 0) or (y1 == TABLE_H and a.vy <= 0):
                    continue
                t = (target - a.y) / a.vy
                if t < 0 or t > dt or (best is not None and t >= best[0]):
                    continue
                cx = a.x + a.vx * t
                if not (min(x1, x2) - 1e-6 <= cx <= max(x1, x2) + 1e-6):
                    continue
                best = (t, "rail", a.id, -1, 0.0, 1.0 if y1 == 0 else -1.0)
            else:
                if a.vx == 0:
                    continue
                target = BALL_R if x1 == 0 else TABLE_W - BALL_R
                if (x1 == 0 and a.vx >= 0) or (x1 == TABLE_W and a.vx <= 0):
                    continue
                t = (target - a.x) / a.vx
                if t < 0 or t > dt or (best is not None and t >= best[0]):
                    continue
                cy = a.y + a.vy * t
                if not (min(y1, y2) - 1e-6 <= cy <= max(y1, y2) + 1e-6):
                    continue
                best = (t, "rail", a.id, -1, 1.0 if x1 == 0 else -1.0, 0.0)
        for j in _JAWS:
            dx, dy = a.x - j[0], a.y - j[1]
            rr = BALL_R + j[2]
            qa = a.vx * a.vx + a.vy * a.vy
            if qa < 1e-12:
                continue
            qb = 2 * (dx * a.vx + dy * a.vy)
            qc = dx * dx + dy * dy - rr * rr
            if qc < 0:
                d = (dx * dx + dy * dy) ** 0.5 or 1e-9
                if best is None or 0 < best[0]:
                    best = (0.0, "jaw", a.id, -1, dx / d, dy / d)
                continue
            if qb >= 0:
                continue
            disc = qb * qb - 4 * qa * qc
            if disc < 0:
                continue
            t = (-qb - disc**0.5) / (2 * qa)
            if 0 <= t <= dt and (best is None or t < best[0]):
                best = (t, "jaw", a.id, -1, (dx + a.vx * t) / rr, (dy + a.vy * t) / rr)
    return best


def _resolve_bb(a: Ball, b: Ball, nx: float, ny: float, ev: ShotEvents, cue_id: int) -> None:
    tx, ty = -ny, nx
    vn = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny
    vt = (a.vx - b.vx) * tx + (a.vy - b.vy) * ty + BALL_R * (a.wz + b.wz)
    if vn < 0:
        jn = -(1 + E_BALL) * vn / 2
        a.vx += jn * nx
        a.vy += jn * ny
        b.vx -= jn * nx
        b.vy -= jn * ny
        jt = max(-MU_BB * jn, min(MU_BB * jn, -vt / 2))
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
    else:
        ox, oy = a.x - b.x, a.y - b.y
        d = (ox * ox + oy * oy) ** 0.5 or 1e-9
        push = (BALL_R * 2 - d) / 2 + 1e-6
        a.x += ox / d * push
        a.y += oy / d * push
        b.x -= ox / d * push
        b.y -= oy / d * push


def _resolve_rail(a: Ball, nx: float, ny: float, ev: ShotEvents, contact_made: dict) -> None:
    vn = a.vx * nx + a.vy * ny
    if vn >= 0:
        return
    tx, ty = -ny, nx
    rx, ry = -nx * BALL_R, -ny * BALL_R
    vt_rel = (a.vx * tx + a.vy * ty) + ((-a.wz * ry) * tx + (a.wz * rx) * ty)
    jn = -(1 + E_CUSH) * vn
    a.vx += jn * nx
    a.vy += jn * ny
    jt = max(-MU_RAIL * jn, min(MU_RAIL * jn, -(1 - RAIL_RET) * vt_rel))
    a.vx += jt * tx
    a.vy += jt * ty
    a.wz += 2.5 * (rx * (jt * ty) - ry * (jt * tx)) / (BALL_R * BALL_R)
    a.asleep = False
    if contact_made["v"] or ev.first_contact is not None or ev.potted:
        ev.rail_after_contact = True


def step(balls: list[Ball], dt: float, ev: ShotEvents, cue_id: int, contact_made: dict) -> None:
    if ev.first_contact is not None or ev.potted:
        contact_made["v"] = True
    prev: dict[int, tuple[float, float]] = {}
    for b in balls:
        if not b.potted and not b.asleep:
            prev[b.id] = (b.x, b.y)
            _friction(b, dt)
    remaining = dt
    for _ in range(6):
        if remaining <= 1e-9:
            break
        c = _earliest_contact(balls, remaining)
        if c is None:
            break
        t = min(c[0], remaining)
        for b in balls:
            if not b.potted and not b.asleep:
                b.x += b.vx * t
                b.y += b.vy * t
        remaining -= t
        by_id = {b.id: b for b in balls}
        if c[1] == "bb":
            _resolve_bb(by_id[c[2]], by_id[c[3]], c[4], c[5], ev, cue_id)
        else:
            _resolve_rail(by_id[c[2]], c[4], c[5], ev, contact_made)
        if c[0] == 0:
            break
    if remaining > 1e-9:
        for b in balls:
            if not b.potted and not b.asleep:
                b.x += b.vx * remaining
                b.y += b.vy * remaining

    def seg_dist(x1: float, y1: float, x2: float, y2: float, px: float, py: float) -> float:
        dx, dy = x2 - x1, y2 - y1
        l2 = dx * dx + dy * dy
        t = ((px - x1) * dx + (py - y1) * dy) / l2 if l2 > 0 else 0.0
        t = max(0.0, min(1.0, t))
        return ((px - (x1 + dx * t)) ** 2 + (py - (y1 + dy * t)) ** 2) ** 0.5

    for b in balls:
        if b.potted:
            continue
        captured = False
        pr = prev.get(b.id)
        spd = (b.vx**2 + b.vy**2) ** 0.5
        for p in POCKETS:
            cr = capture_radius(p[2], spd)
            if pr is not None:
                d = seg_dist(pr[0], pr[1], b.x, b.y, p[0], p[1])
            else:
                d = ((b.x - p[0]) ** 2 + (b.y - p[1]) ** 2) ** 0.5
            if d < cr:
                b.potted = True
                b.asleep = True
                b.vx = b.vy = b.wx = b.wy = b.wz = 0.0
                if b.n is not None:
                    ev.potted.append(b.n)
                else:
                    ev.cue_potted = True
                captured = True
                break
        if not captured and (
            b.x < -0.12 or b.x > TABLE_W + 0.12 or b.y < -0.12 or b.y > TABLE_H + 0.12
        ):
            b.potted = True
            b.asleep = True
            b.vx = b.vy = b.wx = b.wy = b.wz = 0.0
            ev.off_table.append(b.n)
            if b.n is None:
                ev.cue_potted = True
            continue
        if (
            not b.potted
            and (b.vx**2 + b.vy**2) ** 0.5 < SLEEP_V
            and (b.wx**2 + b.wy**2) ** 0.5 < SLEEP_W
            and abs(b.wz) < 2
        ):
            b.vx = b.vy = b.wx = b.wy = b.wz = 0.0
            b.asleep = True


def all_asleep(balls: list[Ball]) -> bool:
    return all(b.potted or b.asleep for b in balls)


def simulate_shot(balls: list[Ball], cue_id: int, max_sim: float = 30.0) -> ShotEvents:
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
        for v in (b.x, b.y, b.vx, b.vy, b.wx, b.wy, b.wz):
            h ^= round(v * 1e9) & 0xFFFFFFFF
            h = (h * 0x01000193) & 0xFFFFFFFF
        h ^= 1 if b.potted else 0
        h = (h * 0x01000193) & 0xFFFFFFFF
    return format(h, "x")
