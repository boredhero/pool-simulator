// Pure sim — no three.js imports. Mirror of backend/app/sim/physics.py
// Contract: dt=1/240 fixed, SI units, swept TOI (TODO P1).
export const DT = 1 / 240;
export const BALL_R = 0.028575;
export interface Ball { x:number;y:number;vx:number;vy:number;wx:number;wy:number;wz:number }
export function step(_balls: Ball[], dt = DT): void {
  for (const b of _balls) { b.x += b.vx * dt; b.y += b.vy * dt; }
}
