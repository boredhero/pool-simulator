import { describe, expect, it } from 'vitest';
import { applyShot, beginShot, groupOf, newGame, placeCue } from '../src/sim/rules';
import { allAsleep, simulateShot } from '../src/sim/physics';
import fixtures from '../../contracts/rules-fixtures.json';
import { matchConfig } from '../src/sim/config';
import type { ShotEvents } from '../src/sim/physics';

const ev = (p: Partial<ShotEvents>): ShotEvents => ({
  firstContact: null, potted: [], offTable: [], railAfterContact: false, cuePotted: false, ...p,
});

describe('rack', () => {
  it('15 balls, 8 center, corners mixed', () => {
    const gs = newGame(1);
    expect(gs.balls.length).toBe(16);
    const order = gs.balls.slice(1).map((b) => b.n!);
    expect(new Set(order).size).toBe(15);
    expect(order).toContain(15);
    expect(order[4]).toBe(8);
    const corners = [order[10], order[14]].map(groupOf).sort();
    expect(corners).toEqual(['solid', 'stripe']);
    // No overlaps.
    for (let i = 0; i < gs.balls.length; i++)
      for (let j = i + 1; j < gs.balls.length; j++) {
        const a = gs.balls[i], b = gs.balls[j];
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(0.056);
      }
  });
});

describe('placement policy', () => {
  it('requires ball in hand, rejects kitchen boundary, overlap, and nonfinite input', () => {
    const gs = newGame();
    expect(placeCue(gs, .3, .6)).toBe(false);
    gs.ballInHand = true; gs.placement = 'kitchen';
    expect(placeCue(gs, .635, .6)).toBe(false);
    expect(placeCue(gs, NaN, .6)).toBe(false);
    expect(placeCue(gs, gs.balls[1].x, gs.balls[1].y)).toBe(false);
    expect(placeCue(gs, .3, .6)).toBe(true);
    expect(gs.kitchenShot).toBe(true);
    expect(gs.ballInHand).toBe(false);
  });
});

describe('full break containment', () => {
  it('nothing escapes, everything sleeps, sane timing', () => {
    const gs = newGame(7);
    const cue = gs.balls[0];
    cue.asleep = false;
    cue.vx = 8;
    const t0 = performance.now();
    const sev = simulateShot(gs.balls, 0);
    const ms = performance.now() - t0;
    expect(sev.firstContact).not.toBe(null);
    expect(ms).toBeLessThan(2000);
    for (const b of gs.balls) {
      if (!b.potted) {
        expect(b.x).toBeGreaterThan(-0.13);
        expect(b.x).toBeLessThan(2.67);
        expect(b.y).toBeGreaterThan(-0.13);
        expect(b.y).toBeLessThan(1.4);
      }
    }
    expect(allAsleep(gs.balls)).toBe(true);
  });
});

for (const f of fixtures) it(f.name, () => {
  const gs = newGame(1, matchConfig({preset: f.preset === 'tournament' ? 'tournament' : 'bar'}));
  Object.assign(gs, f.state);
  for (const b of gs.balls) if (b.n !== null && f.pottedBefore?.includes(b.n)) b.potted = true;
  beginShot(gs, f.call?.[0] ?? null, f.call?.[1] ?? null);
  const facts = ev(f.ev);
  for (const b of gs.balls) if (b.n !== null && (facts.potted.includes(b.n) || facts.offTable.includes(b.n))) b.potted = true;
  applyShot(gs, facts);
  expect(gs).toMatchObject(f.expected);
  for (const n of f.respot ?? []) expect(gs.balls.find(b => b.n === n)?.potted).toBe(false);
});

it('keeps a legal dry-break layout and passes turns on the open table until a legal pot',()=>{
  const gs=newGame();beginShot(gs);
  gs.balls[1].x=.8;gs.balls[1].y=.3;
  const layout=gs.balls.map(b=>[b.x,b.y]);
  applyShot(gs,ev({firstContact:1,railAfterContact:true,objectRails:[1,2,3,4]}));
  expect(gs.balls.map(b=>[b.x,b.y])).toEqual(layout);
  expect(gs.current).toBe(1);expect(gs.breakShot).toBe(false);expect(gs.open).toBe(true);expect(gs.ballInHand).toBe(false);
  beginShot(gs);applyShot(gs,ev({firstContact:2,railAfterContact:true}));
  expect(gs.current).toBe(0);expect(gs.open).toBe(true);expect(gs.balls.map(b=>[b.x,b.y])).toEqual(layout);
  beginShot(gs);gs.balls.find(b=>b.n===1)!.potted=true;applyShot(gs,ev({firstContact:1,potted:[1]}));
  expect(gs.groups).toEqual(['solid','stripe']);expect(gs.current).toBe(0);expect(gs.open).toBe(false);
});
