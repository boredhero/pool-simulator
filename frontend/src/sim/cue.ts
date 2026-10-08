import { BALL_R, TABLE_H, TABLE_W } from './table';
const RAIL_W = 0.17;

export const CUE_LENGTH = 1.45;
const CLEARANCE = 0.0165; // thick end of the shaft plus a small clearance

/** Automatic assisted elevation about the cue-ball center, in radians.
 * Conservative obstacle bounds keep the full shaft above rails and balls.
 * Shared by rendering and the physical cue impulse.
 */
export function cueElevation(
  x: number, y: number, angle: number, pull: number,
  balls: ReadonlyArray<{ x: number; y: number; n: number | null; potted: boolean }>,
  tipX = 0, tipY = 0,
): number {
  const dx = -Math.cos(angle), dy = -Math.sin(angle);
  const reach = CUE_LENGTH + BALL_R + pull;
  const scale = Math.min(1, .55 / (Math.hypot(tipX, tipY) || 1));
  x -= Math.sin(angle) * BALL_R * tipX * scale;
  y += Math.cos(angle) * BALL_R * tipX * scale;
  let elevation = 3 * Math.PI / 180;
  const clear = (distance: number, height: number) => {
    if (distance > reach) return;
    const d = Math.max(0.001, distance), h = height + CLEARANCE - BALL_R;
    // Backspin lowers the shaft; solve its tilted height at the obstacle.
    // Topspin keeps the conservative neutral clearance.
    const drop = BALL_R * Math.max(0, -tipY * scale);
    const required = Math.atan2(h, d) + Math.asin(Math.min(1, drop / Math.hypot(d, h)));
    elevation = Math.max(elevation, Math.min(Math.PI / 2 - .001, required));
  };
  // Slab ray intersections, expanded by the cue radius. Treat pocket gaps as
  // solid here too: raising over a pocket is safer than catching its facing.
  for (const [left, right, top, bottom] of [
    [-RAIL_W, 0, -RAIL_W, TABLE_H + RAIL_W],
    [TABLE_W, TABLE_W + RAIL_W, -RAIL_W, TABLE_H + RAIL_W],
    [0, TABLE_W, -RAIL_W, 0],
    [0, TABLE_W, TABLE_H, TABLE_H + RAIL_W],
  ]) {
    let near = 0, far = reach;
    for (const [origin, direction, lo, hi] of [[x, dx, left, right], [y, dy, top, bottom]]) {
      if (Math.abs(direction) < 1e-9) {
        if (origin < lo - CLEARANCE || origin > hi + CLEARANCE) far = -1;
      } else {
        const a = (lo - CLEARANCE - origin) / direction;
        const b = (hi + CLEARANCE - origin) / direction;
        near = Math.max(near, Math.min(a, b));
        far = Math.min(far, Math.max(a, b));
      }
    }
    if (near <= far && far >= 0) clear(near, 0.054);
  }
  for (const ball of balls) {
    if (ball.potted || ball.n === null) continue;
    const bx = ball.x - x, by = ball.y - y;
    const along = bx * dx + by * dy;
    const sideways = Math.abs(bx * dy - by * dx);
    const radius = BALL_R + CLEARANCE;
    if (along <= 0 || sideways >= radius) continue;
    clear(along - Math.sqrt(radius * radius - sideways * sideways), BALL_R * 2);
  }
  return elevation;
}
