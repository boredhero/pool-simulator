// Custom 2D + 3-axis-spin pool physics. Fixed dt=1/240, semi-implicit Euler
// for friction + swept (analytic TOI) ball-ball / cushion / jaw collisions.
// Mirror of backend/app/sim/physics.py — keep constants + behavior in sync.
import { BALL_R, CAPTURE_R, JAW_R, POCKETS, TABLE_H, TABLE_W, cushions, jaws } from './table';

const CUSHIONS = cushions();
const JAWS = jaws();

export const DT = 1 / 240;
const G = 9.81;
const MU_S = 0.2; // sliding friction
const MU_R = 0.01; // rolling resistance
const E_BALL = 0.95;
const E_CUSH = 0.85;
const MU_BB = 0.06; // ball-ball tangential clamp
const MU_RAIL = 0.3; // rail tangential clamp (for extreme spin)
const RAIL_RET = 0.92; // rail tangential velocity retention
const SPIN_DECAY = 8; // rad/s^2, sidespin decay on cloth
const SLEEP_V = 1e-3;
const SLEEP_W = 0.5;
const TIP_C = 0.8; // tip offset -> spin efficiency
const TIP_MAX = 0.55; // miscue limit (fraction of R)
const SQUIRT_K = (4.5 * Math.PI) / 180; // aim deflect per unit side offset

export interface Ball {
  id: number; // 0..15 index
  n: number | null; // ball number 1..15, null = cue
  x: number; y: number;
  vx: number; vy: number;
  wx: number; wy: number; wz: number;
  asleep: boolean;
  potted: boolean;
}

export interface ShotEvents {
  firstContact: number | null; // ball number (or -1 = cue? use id) first hit by cue
  potted: number[]; // ball numbers in order
  offTable: Array<number | null>; // driven off the table (null = cue)
  railAfterContact: boolean;
  cuePotted: boolean;
}

export function makeBall(id: number, n: number | null, x: number, y: number): Ball {
  return { id, n, x, y, vx: 0, vy: 0, wx: 0, wy: 0, wz: 0, asleep: true, potted: false };
}

/** Power [0,1] -> cue-ball speed m/s. Soft midrange, lively top end. */
export function shootSpeed(power: number): number {
  const p = Math.min(1, Math.max(0, power));
  return 0.2 + Math.pow(p, 2.0) * (8 - 0.2);
}

/** Apply cue strike to ball: velocity along (dx,dy) + spin from tip offset. */
export function strike(b: Ball, dx: number, dy: number, power: number, tipX: number, tipY: number): void {
  const tx = Math.max(-TIP_MAX, Math.min(TIP_MAX, tipX));
  const ty = Math.max(-TIP_MAX, Math.min(TIP_MAX, tipY));
  const v = shootSpeed(power);
  // Squirt: sidespin deflects departure opposite the tip side.
  const sq = tx * SQUIRT_K;
  const c = Math.cos(sq), s = Math.sin(sq);
  const rx = dx * c - dy * s, ry = dx * s + dy * c;
  b.vx = rx * v;
  b.vy = ry * v;
  // Spin: tipY (vertical) -> rotation about side axis; tipX (side) -> vertical spin.
  const sx = -ry, sy = rx; // side axis (perp to shot)
  const wSide = ((TIP_C * v * ty) / BALL_R);
  b.wx = sx * wSide;
  b.wy = sy * wSide;
  b.wz = (-TIP_C * v * tx) / BALL_R;
  b.asleep = false;
}

function friction(b: Ball, dt: number): void {
  // Slip velocity at cloth contact: u = v + R*zhat x w  => (vx - R*wy, vy + R*wx)
  const ux = b.vx - BALL_R * b.wy;
  const uy = b.vy + BALL_R * b.wx;
  const s = Math.hypot(ux, uy);
  // One sliding step removes |du| = 1.5*MU_S*G*dt of slip; below that the
  // explicit torque update would overshoot and go unstable -> roll instead.
  const SLIP_MIN = 1.5 * MU_S * G * dt;
  if (s > Math.max(1e-4, SLIP_MIN)) {
    // Sliding branch.
    const ax = (-MU_S * G * ux) / s;
    const ay = (-MU_S * G * uy) / s;
    b.vx += ax * dt;
    b.vy += ay * dt;
    const k = ((5 * MU_S * G) / (2 * BALL_R)) * dt;
    // Torque r x F with r = -R*zhat: wx_dot = -k*uy/s, wy_dot = +k*ux/s.
    b.wx += (-k * uy) / s;
    b.wy += (k * ux) / s;
  } else {
    // Rolling branch.
    const v = Math.hypot(b.vx, b.vy);
    if (v > 1e-9) {
      const d = Math.min(v, MU_R * G * dt);
      b.vx -= (d * b.vx) / v;
      b.vy -= (d * b.vy) / v;
    }
    // Relax spin toward pure rolling (vx = R*wy, vy = -R*wx).
    const k = Math.min(1, 10 * dt);
    b.wx += ((-b.vy / BALL_R - b.wx) * k);
    b.wy += ((b.vx / BALL_R - b.wy) * k);
  }
  // Sidespin decay.
  if (b.wz !== 0) {
    const d = Math.min(Math.abs(b.wz), SPIN_DECAY * dt);
    b.wz -= Math.sign(b.wz) * d;
  }
}

interface Contact { t: number; kind: 'bb' | 'rail' | 'jaw'; a: number; b: number; nx: number; ny: number }

function earliestContact(balls: Ball[], dt: number): Contact | null {
  let best: Contact | null = null;
  const R2 = BALL_R * 2;
  const live = balls.filter((b) => !b.potted);
  // Ball-ball swept TOI.
  for (let i = 0; i < live.length; i++) {
    const A = live[i];
    if (A.asleep && Math.hypot(A.vx, A.vy) === 0) continue;
    for (let j = i + 1; j < live.length; j++) {
      const B = live[j];
      const dx = A.x - B.x, dy = A.y - B.y;
      const dvx = A.vx - B.vx, dvy = A.vy - B.vy;
      const a = dvx * dvx + dvy * dvy;
      if (a < 1e-12) continue;
      const bq = 2 * (dx * dvx + dy * dvy);
      const c = dx * dx + dy * dy - R2 * R2;
      if (c < 0) {
        // Overlapping: resolve now along line of centers.
        const d = Math.hypot(dx, dy) || 1e-9;
        best = { t: 0, kind: 'bb', a: A.id, b: B.id, nx: dx / d, ny: dy / d };
        continue;
      }
      if (bq >= 0) continue; // separating
      const disc = bq * bq - 4 * a * c;
      if (disc < 0) continue;
      const t = (-bq - Math.sqrt(disc)) / (2 * a);
      if (t >= 0 && t <= dt && (!best || t < best.t)) {
        const nx = (dx + dvx * t) / R2, ny = (dy + dvy * t) / R2;
        best = { t, kind: 'bb', a: A.id, b: B.id, nx, ny };
      }
    }
  }
  // Cushion swept TOI (axis-aligned segments, line inset by R).
  for (const A of live) {
    for (const cu of CUSHIONS) {
      const horiz = cu.y1 === cu.y2;
      if (horiz) {
        if (A.vy === 0) continue;
        const lineY = cu.y1;
        const target = lineY === 0 ? BALL_R : TABLE_H - BALL_R;
        if ((lineY === 0 && A.vy >= 0) || (lineY === TABLE_H && A.vy <= 0)) continue;
        const t = (target - A.y) / A.vy;
        if (t < 0 || t > dt || (best && t >= best.t)) continue;
        const cx = A.x + A.vx * t;
        const lo = Math.min(cu.x1, cu.x2) - 1e-6, hi = Math.max(cu.x1, cu.x2) + 1e-6;
        if (cx < lo || cx > hi) continue;
        best = { t, kind: 'rail', a: A.id, b: -1, nx: 0, ny: lineY === 0 ? 1 : -1 };
      } else {
        if (A.vx === 0) continue;
        const lineX = cu.x1;
        const target = lineX === 0 ? BALL_R : TABLE_W - BALL_R;
        if ((lineX === 0 && A.vx >= 0) || (lineX === TABLE_W && A.vx <= 0)) continue;
        const t = (target - A.x) / A.vx;
        if (t < 0 || t > dt || (best && t >= best.t)) continue;
        const cy = A.y + A.vy * t;
        const lo = Math.min(cu.y1, cu.y2) - 1e-6, hi = Math.max(cu.y1, cu.y2) + 1e-6;
        if (cy < lo || cy > hi) continue;
        best = { t, kind: 'rail', a: A.id, b: -1, nx: lineX === 0 ? 1 : -1, ny: 0 };
      }
    }
    // Jaw bumpers as static circles.
    for (const j of JAWS) {
      const dx = A.x - j.x, dy = A.y - j.y;
      const rr = BALL_R + JAW_R;
      const a = A.vx * A.vx + A.vy * A.vy;
      if (a < 1e-12) continue;
      const bq = 2 * (dx * A.vx + dy * A.vy);
      const c = dx * dx + dy * dy - rr * rr;
      if (c < 0) {
        const d = Math.hypot(dx, dy) || 1e-9;
        if (!best || 0 < best.t) best = { t: 0, kind: 'jaw', a: A.id, b: -1, nx: dx / d, ny: dy / d };
        continue;
      }
      if (bq >= 0) continue;
      const disc = bq * bq - 4 * a * c;
      if (disc < 0) continue;
      const t = (-bq - Math.sqrt(disc)) / (2 * a);
      if (t >= 0 && t <= dt && (!best || t < best.t)) {
        const nx = (dx + A.vx * t) / rr, ny = (dy + A.vy * t) / rr;
        best = { t, kind: 'jaw', a: A.id, b: -1, nx, ny };
      }
    }
  }
  return best;
}

function resolveBallBall(A: Ball, B: Ball, nx: number, ny: number, ev: ShotEvents, cueId: number): void {
  const tx = -ny, ty = nx;
  const vn = (A.vx - B.vx) * nx + (A.vy - B.vy) * ny;
  // Contact-point tangential relative velocity (includes sidespin coupling).
  const vt = (A.vx - B.vx) * tx + (A.vy - B.vy) * ty + BALL_R * (A.wz + B.wz);
  if (vn < 0) {
    const jn = (-(1 + E_BALL) * vn) / 2; // per-unit-mass (equal masses)
    A.vx += jn * nx; A.vy += jn * ny;
    B.vx -= jn * nx; B.vy -= jn * ny;
    // Coulomb-clamped tangential impulse (throw + gear-effect spin transfer).
    let jt = -vt / 2;
    const maxJ = MU_BB * jn;
    jt = Math.max(-maxJ, Math.min(maxJ, jt));
    A.vx += jt * tx; A.vy += jt * ty;
    B.vx -= jt * tx; B.vy -= jt * ty;
    const dwz = (2.5 * jt) / BALL_R; // dw = R*J/I with J = jt*m
    A.wz += dwz;
    B.wz += dwz;
    A.asleep = B.asleep = false;
    if (ev.firstContact === null && (A.id === cueId || B.id === cueId)) {
      const other = A.id === cueId ? B : A;
      ev.firstContact = other.n;
    }
  } else {
    // Resting overlap: positional split (no energy).
    const ox = (A.x - B.x), oy = (A.y - B.y);
    const d = Math.hypot(ox, oy) || 1e-9;
    const push = ((BALL_R * 2 - d) / 2 + 1e-6);
    A.x += (ox / d) * push; A.y += (oy / d) * push;
    B.x -= (ox / d) * push; B.y -= (oy / d) * push;
  }
}

function resolveRail(A: Ball, nx: number, ny: number, ev: ShotEvents, contactMade: { v: boolean }): void {
  const vn = A.vx * nx + A.vy * ny;
  if (vn >= 0) return;
  const tx = -ny, ty = nx;
  // Contact offset from center to rail point ~ -n*R; rotational velocity (w x r).
  const rx = -nx * BALL_R, ry = -ny * BALL_R;
  const vrx = -A.wz * ry;
  const vry = A.wz * rx;
  const vtRel = (A.vx * tx + A.vy * ty) + (vrx * tx + vry * ty);
  const jn = -(1 + E_CUSH) * vn;
  A.vx += jn * nx; A.vy += jn * ny;
  // Cushions are springy: keep most tangential speed, Coulomb-clamped for spin extremes.
  let jt = -(1 - RAIL_RET) * vtRel;
  const maxJ = MU_RAIL * jn;
  jt = Math.max(-maxJ, Math.min(maxJ, jt));
  A.vx += jt * tx; A.vy += jt * ty;
  // Torque about center: dwz = (r x J)/I, J = jt*m*t.
  A.wz += (2.5 * (rx * (jt * ty) - ry * (jt * tx))) / (BALL_R * BALL_R);
  A.asleep = false;
  if (contactMade.v || ev.firstContact !== null || ev.potted.length > 0) ev.railAfterContact = true;
}

export function step(balls: Ball[], dt: number, ev: ShotEvents, cueId: number, contactMade: { v: boolean }): void {
  if (ev.firstContact !== null || ev.potted.length > 0) contactMade.v = true;
  const prev = new Map<number, [number, number]>();
  for (const b of balls) {
    if (b.potted || b.asleep) continue;
    prev.set(b.id, [b.x, b.y]);
    friction(b, dt);
  }
  let remaining = dt;
  for (let iter = 0; iter < 6 && remaining > 1e-9; iter++) {
    const c = earliestContact(balls, remaining);
    if (!c) break;
    const adv = Math.min(c.t, remaining);
    for (const b of balls) {
      if (b.potted || b.asleep) continue;
      b.x += b.vx * adv;
      b.y += b.vy * adv;
    }
    remaining -= adv;
    const byId = (id: number) => balls.find((b) => b.id === id)!;
    if (c.kind === 'bb') resolveBallBall(byId(c.a), byId(c.b), c.nx, c.ny, ev, cueId);
    else resolveRail(byId(c.a), c.nx, c.ny, ev, contactMade);
    if (c.t === 0 && iter > 2) break;
  }
  if (remaining > 1e-9) {
    for (const b of balls) {
      if (b.potted || b.asleep) continue;
      b.x += b.vx * remaining;
      b.y += b.vy * remaining;
    }
  }
  // Pockets (swept: segment vs capture circle) + off-table + sleep.
  const segDist = (x1: number, y1: number, x2: number, y2: number, px: number, py: number) => {
    const dx = x2 - x1, dy = y2 - y1;
    const l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
  };
  for (const b of balls) {
    if (b.potted) continue;
    let captured = false;
    const pr = prev.get(b.id);
    for (const p of POCKETS) {
      const d = pr
        ? segDist(pr[0], pr[1], b.x, b.y, p.x, p.y)
        : Math.hypot(b.x - p.x, b.y - p.y);
      if (d < CAPTURE_R) {
        b.potted = true;
        b.asleep = true;
        b.vx = b.vy = b.wx = b.wy = b.wz = 0;
        if (b.n !== null) ev.potted.push(b.n);
        else ev.cuePotted = true;
        captured = true;
        break;
      }
    }
    if (!captured && (b.x < -0.12 || b.x > TABLE_W + 0.12 || b.y < -0.12 || b.y > TABLE_H + 0.12)) {
      // Escaped through a gap edge: off the table (foul, stays down).
      b.potted = true;
      b.asleep = true;
      b.vx = b.vy = b.wx = b.wy = b.wz = 0;
      ev.offTable.push(b.n);
      if (b.n === null) ev.cuePotted = true;
      continue;
    }
    if (!b.potted && Math.hypot(b.vx, b.vy) < SLEEP_V && Math.hypot(b.wx, b.wy) < SLEEP_W && Math.abs(b.wz) < 2) {
      b.vx = b.vy = b.wx = b.wy = b.wz = 0;
      b.asleep = true;
    }
  }
}

export function allAsleep(balls: Ball[]): boolean {
  return balls.every((b) => b.potted || b.asleep);
}

/** Run the shot to rest. Mutates balls. Returns events for rules. */
export function simulateShot(balls: Ball[], cueId: number, maxSim = 30): ShotEvents {
  const ev: ShotEvents = { firstContact: null, potted: [], offTable: [], railAfterContact: false, cuePotted: false };
  const contactMade = { v: false };
  let t = 0;
  while (t < maxSim && !allAsleep(balls)) {
    step(balls, DT, ev, cueId, contactMade);
    t += DT;
  }
  return ev;
}

/** State hash for determinism tests (FNV over quantized floats). */
export function hashState(balls: Ball[]): string {
  let h = 0x811c9dc5;
  for (const b of [...balls].sort((a, z) => a.id - z.id)) {
    for (const v of [b.x, b.y, b.vx, b.vy, b.wx, b.wy, b.wz]) {
      const q = Math.round(v * 1e9);
      h ^= q & 0xffffffff;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    h ^= b.potted ? 1 : 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h >>> 0).toString(16);
}
