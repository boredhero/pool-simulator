"""Reduced compliant cue contact. Browser mirror: sim/stroke.ts.

The tip is a unilateral damped spring with Coulomb friction; the cue has
axial mass and a smaller transverse effective end mass. See docs/stroke.md.
"""

import math

from app.sim.chalk import contact, level
from app.sim.physics import VMAX_NORMAL, ShotEvents, shoot_speed, simulate_shot, step
from app.sim.table import BALL_R, POCKETS, TABLE_H, TABLE_W

BALL_MASS = 0.17
CUE_MASS = 0.54
END_MASS = 0.012
TIP_RADIUS = 0.006
CONTACT_DT = 0.0000125
CONTACT_TIME = 0.0012
RESTITUTION = 0.75


def _dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def _cross(a, b):
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


def strike_balls(
    balls, cue_id, dx, dy, power, tip_x, tip_y, vmax=VMAX_NORMAL, elevation=0.0, chalk_level=1.0
):
    """Advance the first 20 ms of a shot and return events to KEEP thereafter.

    No stroke state is attached to serialized balls. Subsequent step/simulate
    calls must use these events, because a nearby ball can already be struck.
    """
    cue = next(b for b in balls if b.id == cue_id)
    ev = ShotEvents()
    made = {"v": False}
    ev._stroke_contacts = []
    tx, ty, _, _ = contact(chalk_level, tip_x, tip_y)
    theta = max(0.0, min(math.pi / 2 - 0.01, elevation))
    ct, st = math.cos(theta), math.sin(theta)
    axis, side, up = [dx * ct, dy * ct, -st], [-dy, dx, 0.0], [dx * st, dy * st, ct]
    radius = BALL_R + TIP_RADIUS
    back = radius * math.sqrt(1 - tx * tx - ty * ty)
    center = [cue.x, cue.y, cue.z + BALL_R]
    tip = [center[i] - axis[i] * back + radius * (tx * side[i] + ty * up[i]) for i in range(3)]
    speed = shoot_speed(power, vmax) * (1 + BALL_MASS / CUE_MASS) / (1 + RESTITUTION)
    velocity = [speed * a for a in axis]
    frozen = {
        b.id
        for b in balls
        if b.id != cue_id
        and not b.potted
        and math.dist([b.x, b.y, b.z], [cue.x, cue.y, cue.z]) <= 2 * BALL_R + 1e-7
    }
    near = min(cue.x, cue.y, TABLE_W - cue.x, TABLE_H - cue.y) < 0.20 or any(
        b.id != cue_id and not b.potted and math.dist([b.x, b.y], [cue.x, cue.y]) < 0.20
        for b in balls
    )
    mu = 0.25 + 0.45 * level(chalk_level)
    inertia = 0.4 * BALL_MASS * BALL_R * BALL_R
    reduced = 1 / (1 / BALL_MASS + 1 / CUE_MASS)
    decay = -math.log(RESTITUTION) / CONTACT_TIME
    stiffness = reduced * ((math.pi / CONTACT_TIME) ** 2 + decay * decay)
    damping = 2 * reduced * decay
    touching, contacts, elapsed = False, 0, 0.0
    slate_z = cue.z
    slate_time = 0.0008
    slate_decay = -math.log(0.5) / slate_time
    slate_k = BALL_MASS * ((math.pi / slate_time) ** 2 + slate_decay**2)
    slate_c = 2 * BALL_MASS * slate_decay

    def inv_cue(v):
        axial = _dot(v, axis)
        return [axis[i] * axial / CUE_MASS + (v[i] - axis[i] * axial) / END_MASS for i in range(3)]

    while elapsed < 0.02 - 1e-12 and not cue.potted:
        dt = CONTACT_DT if elapsed < 0.004 or touching else 0.0001
        center = [cue.x, cue.y, cue.z + BALL_R]
        delta = [center[i] - tip[i] for i in range(3)]
        distance = math.sqrt(_dot(delta, delta))
        compression = radius - distance
        active = compression > 0
        if active:
            if not touching:
                contacts += 1
                if contacts > 1:
                    ev.cue_double_hit = True
            normal = [v / distance for v in delta]
            arm = [-BALL_R * v for v in normal]
            ball_v = [cue.vx, cue.vy, cue.vz]
            spin_v = _cross([cue.wx, cue.wy, cue.wz], arm)
            relative = [velocity[i] - ball_v[i] - spin_v[i] for i in range(3)]
            closing = _dot(relative, normal)
            impulse_n = max(0.0, stiffness * compression + damping * closing) * dt
            tangent = [relative[i] - normal[i] * closing for i in range(3)]
            slip = math.sqrt(_dot(tangent, tangent))
            impulse = [v * impulse_n for v in normal]
            if slip > 1e-12:
                direction = [v / slip for v in tangent]
                inverse = (
                    1 / BALL_MASS + BALL_R * BALL_R / inertia + _dot(direction, inv_cue(direction))
                )
                jt = min(mu * impulse_n, slip / inverse)
                impulse = [impulse[i] + direction[i] * jt for i in range(3)]
            change = inv_cue(impulse)
            velocity = [velocity[i] - change[i] for i in range(3)]
            cue.vx += impulse[0] / BALL_MASS
            cue.vy += impulse[1] / BALL_MASS
            cue.vz += impulse[2] / BALL_MASS
            torque = _cross(arm, impulse)
            cue.wx += torque[0] / inertia
            cue.wy += torque[1] / inertia
            cue.wz += torque[2] / inertia
            cue.asleep = False
        if contacts and not active and not near and slate_z >= -1e-8:
            break
        touching = active
        previous_contacts = len(ev._stroke_contacts)
        tip = [tip[i] + velocity[i] * dt for i in range(3)]
        # Resolve ball/slate compliance within the tip contact timescale.
        # The ordinary rigid landing solver would erase each tiny downward
        # impulse at its low-bounce cutoff before a jump could develop.
        supported = (
            slate_z <= 0
            and (cue.vz < 0 or slate_z < 0)
            and not any((cue.x - p[0]) ** 2 + (cue.y - p[1]) ** 2 < p[2] ** 2 for p in POCKETS)
        )
        if supported:
            cue.vz += max(0.0, -slate_k * slate_z - slate_c * cue.vz) * dt / BALL_MASS
            vertical = cue.vz
            cue.z, cue.vz = 0.0, 0.0
            step(balls, dt, ev, cue_id, made)
            cue.vz += vertical
            slate_z += cue.vz * dt
            cue.z = max(0.0, slate_z)
            cue.asleep = False
        else:
            step(balls, dt, ev, cue_id, made)
            slate_z = cue.z
        if active:
            for hit in ev._stroke_contacts[previous_contacts:]:
                if (
                    hit["id"] not in frozen
                    and abs(_dot([hit["nx"], hit["ny"], hit["nz"]], axis)) > 0.15
                ):
                    ev.cue_double_hit = True
        elapsed += dt
        # A passive cue, rather than a motor, cannot force continued contact.
    del ev._stroke_contacts
    return ev


def simulate_stroke(
    balls, cue_id, dx, dy, power, tip_x, tip_y, vmax=VMAX_NORMAL, elevation=0.0, chalk_level=1.0
):
    """Resolve the complete shot, preserving contacts made during the stroke."""
    events = strike_balls(balls, cue_id, dx, dy, power, tip_x, tip_y, vmax, elevation, chalk_level)
    return simulate_shot(balls, cue_id, events=events)
