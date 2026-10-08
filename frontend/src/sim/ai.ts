// L1 geometry AI: ghost-ball aiming with clearance checks + aim noise.
// Later: L2 Monte-Carlo rollouts over (aim, power, tip).
import { BALL_R, POCKETS, TABLE_H, TABLE_W } from './table';
import type { Ball } from './physics';
import { groupOf } from './rules';

export interface AiShot { angle: number; power: number; tipX: number; tipY: number; ball?: number; pocket?: number }

function segClear(
  x1: number, y1: number, x2: number, y2: number, balls: Ball[], ignore: number[], margin = 0.004,
): boolean {
  const dx = x2 - x1, dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  for (const b of balls) {
    if (b.potted || ignore.includes(b.id)) continue;
    let t = l2 > 0 ? ((b.x - x1) * dx + (b.y - y1) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    if (Math.hypot(b.x - (x1 + dx * t), b.y - (y1 + dy * t)) < BALL_R * 2 + margin) return false;
  }
  return true;
}

/** Gaussian noise via Box-Muller. */
function gauss(rnd: () => number): number {
  let u = 0, v = 0;
  while (u === 0) u = rnd();
  while (v === 0) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function chooseShot(
  balls: Ball[], targets: number[], difficulty: 'easy' | 'medium' | 'hard' = 'medium', rnd: () => number = Math.random,
): AiShot | null {
  const cue = balls[0];
  const sigma = difficulty === 'easy' ? (2.5 * Math.PI) / 180 : difficulty === 'hard' ? (0.3 * Math.PI) / 180 : (1.0 * Math.PI) / 180;
  interface Cand { angle: number; power: number; score: number; ball: number; pocket: number }
  const cands: Cand[] = [];
  for (const b of balls) {
    if (b.id === 0 || b.potted || b.n === null || !targets.includes(b.n)) continue;
    for (const p of POCKETS) {
      const pdx = b.x - p.x, pdy = b.y - p.y;
      const pd = Math.hypot(pdx, pdy) || 1;
      // Ghost: cue center position at contact, 2R from target along pocket line.
      const gx = b.x + (pdx / pd) * BALL_R * 2;
      const gy = b.y + (pdy / pd) * BALL_R * 2;
      const aimX = gx - cue.x, aimY = gy - cue.y;
      const aimLen = Math.hypot(aimX, aimY) || 1;
      // Angle between cue travel and object travel (cut angle).
      const dot = (aimX * (p.x - b.x) + aimY * (p.y - b.y)) / (aimLen * (pd || 1));
      const cut = Math.acos(Math.max(-1, Math.min(1, dot)));
      if (cut > (65 * Math.PI) / 180) continue;
      if (!segClear(cue.x, cue.y, gx, gy, balls, [0, b.id])) continue;
      if (!segClear(b.x, b.y, p.x, p.y, balls, [0, b.id])) continue;
      const dist = aimLen + pd;
      const score = (1 - cut / Math.PI) * 2 - dist / (TABLE_W + TABLE_H) + (p.corner ? 0.1 : 0);
      cands.push({ angle: Math.atan2(aimY, aimX), power: Math.min(0.9, Math.max(0.15, 0.15 + dist * 0.22)), score, ball: b.n, pocket: POCKETS.indexOf(p) });
    }
  }
  if (cands.length === 0) return null;
  cands.sort((a, b) => b.score - a.score);
  const best = cands[0];
  return { angle: best.angle + gauss(rnd) * sigma, power: best.power, tipX: 0, tipY: 0, ball: best.ball, pocket: best.pocket };
}

/** Break fallback: full power at the apex ball. */
export function breakShot(balls: Ball[]): AiShot {
  const cue = balls[0];
  const apex = balls.find((b) => b.n === 1) ?? balls[1];
  return { angle: Math.atan2(apex.y - cue.y, apex.x - cue.x), power: 1.0, tipX: 0, tipY: 0.1 };
}

export function legalTargets(balls: Ball[], group: string | null, open: boolean): number[] {
  const out: number[] = [];
  for (const b of balls) {
    if (b.id === 0 || b.potted || b.n === null) continue;
    if (open) {
      if (b.n !== 8) out.push(b.n);
    } else if (group === 'solid' || group === 'stripe') {
      if (groupOf(b.n) === group) out.push(b.n);
    } else if (group === 'eight') {
      if (b.n === 8) out.push(b.n);
    }
  }
  return out;
}
