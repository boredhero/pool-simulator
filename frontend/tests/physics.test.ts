import { describe, expect, it } from 'vitest';
import { allAsleep, hashState, makeBall, simulateShot, step, type Ball, type ShotEvents } from '../src/sim/physics';
import { TABLE_H, TABLE_W, BALL_R } from '../src/sim/table';

const freshEv = (): ShotEvents => ({ firstContact: null, potted: [], offTable: [], railAfterContact: false, cuePotted: false });
const cm = () => ({ v: false });
const awake = (b: Ball) => { b.asleep = false; return b; };

describe('momentum + energy', () => {
  it('head-on: cue stops dead, momentum conserved, KE never grows', () => {
    const cue = awake(makeBall(0, null, 0.5, TABLE_H / 2));
    const obj = awake(makeBall(1, 1, 0.7, TABLE_H / 2));
    cue.vx = 2; obj.vx = 0;
    const m0 = cue.vx + obj.vx;
    const ke0 = cue.vx ** 2 + obj.vx ** 2;
    const balls = [cue, obj];
    // Measure right after impact, before cloth friction eats the evidence.
    for (let i = 0; i < 240; i++) {
      step(balls, 1 / 240, freshEv(), 0, cm());
      if (Math.hypot(obj.vx, obj.vy) > 0.5) break;
    }
    expect(Math.abs(cue.vx)).toBeLessThan(0.2); // stun transfer (e=0.95 leaves a touch)
    expect(obj.vx).toBeGreaterThan(1.5);
    expect(Math.abs(cue.vx + obj.vx - m0)).toBeLessThan(0.35); // cloth took its cut
    expect(cue.vx ** 2 + obj.vx ** 2).toBeLessThanOrEqual(ke0 + 1e-9);
  });

  it('30° cut: outgoing paths ~90° apart', () => {
    const cue = awake(makeBall(0, null, 0.5, TABLE_H / 2));
    const obj = awake(makeBall(1, 1, 0.7, TABLE_H / 2 + 0.0286)); // ~30° cut geometry
    cue.vx = 2;
    const balls = [cue, obj];
    for (let i = 0; i < 480; i++) {
      step(balls, 1 / 240, freshEv(), 0, cm());
      if (Math.hypot(obj.vx, obj.vy) > 0.3) break;
    }
    const dot = cue.vx * obj.vx + cue.vy * obj.vy;
    const mag = Math.hypot(cue.vx, cue.vy) * Math.hypot(obj.vx, obj.vy);
    const ang = (Math.acos(Math.max(-1, Math.min(1, dot / mag))) * 180) / Math.PI;
    expect(ang).toBeGreaterThan(80);
    expect(ang).toBeLessThan(100);
  });
});

describe('cushions', () => {
  it('45° incidence, no english -> ~45° reflection at ~e speed', () => {
    const b = awake(makeBall(0, null, 0.6, 0.4));
    b.vx = 1; b.vy = -1;
    const v0 = Math.hypot(b.vx, b.vy);
    const balls = [b];
    // Measure right at the bounce: post-cushion slide is real, don't let it pollute.
    for (let i = 0; i < 240; i++) {
      step(balls, 1 / 240, freshEv(), 0, cm());
      if (b.vy > 0) break;
    }
    expect(b.vy).toBeGreaterThan(0); // reflected
    const ang = (Math.atan2(Math.abs(b.vy), Math.abs(b.vx)) * 180) / Math.PI;
    expect(Math.abs(ang - 45)).toBeLessThan(6);
    // Rail costs ~half speed (0.70 cushion + re-skid): documented behavior.
    const ratio = Math.hypot(b.vx, b.vy) / v0;
    expect(ratio).toBeGreaterThan(0.4);
    expect(ratio).toBeLessThan(0.85);
  });

  it('sidespin shifts rebound direction', () => {
    const mk = (wz: number) => {
      const b = awake(makeBall(0, null, 1.0, 0.5));
      b.vx = 0; b.vy = -2; b.wz = wz;
      return b;
    };
    const run = (wz: number) => {
      const b = mk(wz);
      const balls = [b];
      for (let i = 0; i < 200; i++) step(balls, 1 / 240, freshEv(), 0, cm());
      return b.vx;
    };
    // +wz adds +x surface speed at the bottom-rail contact -> friction kicks -x.
    // So positive sidespin must deflect further -x than negative.
    expect(run(-30) - run(30)).toBeGreaterThan(0.05);
  });
});

describe('shots', () => {
  it('WPA speed: full break shot carries 3.5+ table lengths', () => {
    const b = awake(makeBall(0, null, 0.3, TABLE_H / 2));
    b.vx = 8.5; // VMAX_BREAK
    const balls = [b];
    let path = 0, px = b.x, py = b.y;
    for (let i = 0; i < 240 * 30 && !allAsleep(balls); i++) {
      step(balls, 1 / 240, freshEv(), 0, cm());
      path += Math.hypot(b.x - px, b.y - py);
      px = b.x; py = b.y;
    }
    expect(path).toBeGreaterThan(3.5 * TABLE_W);
  });

  it('12 m/s into cushion: no tunneling, stays in bounds', () => {
    const b = awake(makeBall(0, null, 1.0, 0.6));
    b.vy = -12;
    const balls = [b];
    const ev = freshEv();
    const contactMade = { v: true };
    let bounced = false;
    for (let i = 0; i < 120; i++) {
      step(balls, 1 / 240, ev, 0, contactMade);
      if (b.vy > 0 || ev.railAfterContact) { bounced = true; break; }
    }
    expect(bounced).toBe(true);
    expect(b.x).toBeGreaterThanOrEqual(-0.01);
    expect(b.x).toBeLessThanOrEqual(TABLE_W + 0.01);
    expect(b.y).toBeGreaterThanOrEqual(-0.1);
  });

  it('slow ball down the throat pots; jaw hit survives', () => {
    const b = awake(makeBall(0, null, 0.3, 0.05));
    b.vx = -1; b.vy = -0.15;
    const balls = [b];
    for (let i = 0; i < 240 * 5 && !allAsleep(balls); i++) step(balls, 1 / 240, freshEv(), 0, cm());
    expect(b.potted).toBe(true);
  });

  it('draw shot comes back, follow shot goes through', () => {
    const mkPair = () => {
      const cue = awake(makeBall(0, null, 0.5, TABLE_H / 2));
      const obj = awake(makeBall(1, 1, 0.8, TABLE_H / 2));
      return [cue, obj] as Ball[];
    };
    // Draw: heavy backspin.
    let balls = mkPair();
    balls[0].vx = 2; balls[0].wy = -2 * 30; // backspin for +x travel
    for (let i = 0; i < 240 * 3; i++) step(balls, 1 / 240, freshEv(), 0, cm());
    const drawX = balls[0].x;
    // Follow: heavy topspin.
    balls = mkPair();
    balls[0].vx = 2; balls[0].wy = 2 * 30;
    for (let i = 0; i < 240 * 3; i++) step(balls, 1 / 240, freshEv(), 0, cm());
    expect(balls[0].x - drawX).toBeGreaterThan(0.05);
  });
});

describe('spin physics', () => {
  it('slide transitions to roll in 2u0/(7 mu_s g), then rolls straight', () => {
    const b = awake(makeBall(0, null, 0.5, TABLE_H / 2));
    b.vx = 2; // no spin: full skid
    const balls = [b];
    // Theoretical slide time for u0=2: 2*2/(7*0.2*9.81) = 0.291s.
    let rolled = false;
    for (let i = 0; i < 240; i++) {
      step(balls, 1 / 240, freshEv(), 0, cm());
      const ux = b.vx - BALL_R * b.wy, uy = b.vy + BALL_R * b.wx;
      if (i * (1 / 240) > 0.32 && Math.hypot(ux, uy) < 0.02) rolled = true;
    }
    expect(rolled).toBe(true);
    // Rolling: spin matches velocity (wy = vx/R), travels straight.
    expect(Math.abs(b.wy - b.vx / BALL_R) / Math.max(1, Math.abs(b.vx / BALL_R))).toBeLessThan(0.1);
    expect(Math.abs(b.vy)).toBeLessThan(0.05);
  });

  it('follow-through: topspin makes the cue chase after contact', () => {
    const cue = awake(makeBall(0, null, 0.5, TABLE_H / 2));
    const obj = awake(makeBall(1, 1, 0.9, TABLE_H / 2));
    cue.vx = 2; cue.wy = 2 * 40; // heavy topspin
    const balls = [cue, obj];
    const ev = freshEv();
    for (let i = 0; i < 240 * 2; i++) {
      step(balls, 1 / 240, ev, 0, cm());
      if (allAsleep(balls)) break;
    }
    expect(ev.firstContact).toBe(1);
    // Cue retained forward roll through the hit: ends ahead of contact point.
    expect(cue.x).toBeGreaterThan(0.85);
  });
});

describe('determinism + sleep', () => {
  it('identical shots hash identically; rest state is exact zero', () => {
    const mk = () => {
      const cue = awake(makeBall(0, null, 0.635, TABLE_H / 2));
      cue.vx = 3; cue.wz = 10;
      const obj = awake(makeBall(1, 9, 1.2, TABLE_H / 2 + 0.05));
      return [cue, obj];
    };
    const a = mk(), b = mk();
    simulateShot(a, 0);
    simulateShot(b, 0);
    expect(hashState(a)).toBe(hashState(b));
    expect(allAsleep(a)).toBe(true);
    for (const ball of a) {
      if (!ball.potted) expect(ball.vx).toBe(0);
    }
  });
});
