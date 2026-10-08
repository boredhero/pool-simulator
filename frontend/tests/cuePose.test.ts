import { expect, it } from 'vitest';
import { cueElevation } from '../src/render/cuePose';
import { BALL_R, TABLE_H, TABLE_W } from '../src/sim/table';

it('raises the full cue above each nearby rail', () => {
  for (const [x, y, angle] of [
    [0.035, TABLE_H / 2, 0],
    [TABLE_W - 0.035, TABLE_H / 2, Math.PI],
    [TABLE_W / 2, 0.035, Math.PI / 2],
    [TABLE_W / 2, TABLE_H - 0.035, -Math.PI / 2],
  ]) {
    const elevation = cueElevation(x, y, angle, 0.02, []);
    expect(BALL_R + 0.035 * Math.tan(elevation)).toBeGreaterThan(0.054 + 0.009);
    expect(elevation).toBeLessThan(Math.PI / 2);
  }
});

it('clears an object ball behind the cue and ignores pocketed balls', () => {
  const ball = { n: 1, x: 0.9, y: TABLE_H / 2, potted: false };
  const elevation = cueElevation(1, TABLE_H / 2, 0, 0.2, [ball]);
  expect(BALL_R + 0.1 * Math.tan(elevation)).toBeGreaterThan(2 * BALL_R + 0.009);
  expect(cueElevation(1, TABLE_H / 2, 0, 0.2, [{ ...ball, potted: true }])).toBeLessThan(elevation);
});

it('does not raise the butt for a ball in front of the shot', () => {
  const empty = cueElevation(1, TABLE_H / 2, 0, 0.02, []);
  expect(cueElevation(1, TABLE_H / 2, 0, 0.02, [{ n: 2, x: 1.1, y: TABLE_H / 2, potted: false }])).toBe(empty);
});

it('clears a rail with backspin, including a shallow corner approach', () => {
  for (const angle of [0, Math.PI / 4]) {
    const x = .08, y = .08;
    const neutral = cueElevation(x, y, angle, 0, []);
    const backspin = cueElevation(x, y, angle, 0, [], 0, -.55);
    expect(backspin).toBeGreaterThan(neutral);
    const distance = (.08 - .0165) / Math.cos(angle);
    const shaftHeight = BALL_R - BALL_R * .55 / Math.cos(backspin) + distance * Math.tan(backspin);
    expect(shaftHeight).toBeGreaterThanOrEqual(.054 + .0165 - 1e-12);
  }
});

it('accounts for sideways spin when the shaft approaches a corner facing', () => {
  const a = cueElevation(.08, .08, Math.PI / 4, 0, [], .4, -.3);
  const b = cueElevation(.08, .08, Math.PI / 4, 0, [], -.4, -.3);
  expect(a).toBeCloseTo(b, 12);
  expect(a).toBeGreaterThan(cueElevation(.08, .08, Math.PI / 4, 0, [], 0, -.3));
});
