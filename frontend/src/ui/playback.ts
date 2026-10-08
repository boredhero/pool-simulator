import { allAsleep, DT, step, type Ball, type ShotEvents } from '../sim/physics';
import { BALL_R } from '../sim/table';

export function playbackRate(balls: Ball[], enabled: boolean): number {
  if (!enabled || allAsleep(balls)) return 1;
  return balls.every(b => b.potted || b.asleep || (
    b.z <= 1e-9 && b.vz === 0 && Math.hypot(b.vx,b.vy) < .25 &&
    BALL_R*Math.hypot(b.wx,b.wy) < .25
  )) ? 4 : 1;
}

/** Spend wall time on fixed physics steps; never change DT or skip contacts. */
export function advancePlayback(balls: Ball[], events: ShotEvents, contact: {v:boolean}, budget: number, fast: boolean) {
  let steps=0, simulated=0, accelerated=false;
  while (!allAsleep(balls) && steps<240) {
    const rate=playbackRate(balls,fast),cost=DT/rate;
    if (budget+1e-12<cost) break;
    step(balls,DT,events,0,contact);budget=Math.max(0,budget-cost);steps++;simulated+=DT;accelerated ||= rate>1;
  }
  return {remaining:budget,simulated,accelerated};
}
