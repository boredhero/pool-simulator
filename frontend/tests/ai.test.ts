import { describe, expect, it } from 'vitest';
import { breakShot, chooseShot, legalTargets } from '../src/sim/ai';
import { newGame } from '../src/sim/rules';
import { strike, simulateShot } from '../src/sim/physics';

describe('ai', () => {
  it('break aims at the apex with full power', () => {
    const gs = newGame(3);
    const s = breakShot(gs.balls);
    expect(s.power).toBe(1);
    expect(Number.isFinite(s.angle)).toBe(true);
  });

  it('finds a silk road on an open shot and pots sometimes', () => {
    // Cue + one object ball lined up to a corner pocket.
    const gs = newGame(3);
    for (const b of gs.balls) b.potted = true;
    const cue = gs.balls[0];
    cue.potted = false; cue.x = 0.5; cue.y = 0.3;
    const obj = gs.balls[1];
    obj.potted = false; obj.n = 1; obj.x = 0.25; obj.y = 0.15;
    // Reassign ids to stay valid (simulateShot only needs ids unique).
    const s = chooseShot(gs.balls, [1], 'hard', () => 0.5);
    expect(s).not.toBe(null);
    strike(cue, Math.cos(s!.angle), Math.sin(s!.angle), s!.power, 0, 0);
    const ev = simulateShot(gs.balls, 0);
    expect(ev.firstContact).toBe(1);
  });

  it('legalTargets respects groups', () => {
    const gs = newGame(3);
    expect(legalTargets(gs.balls, null, true).length).toBe(14); // all but 8
    expect(legalTargets(gs.balls, 'eight', false)).toEqual([8]);
  });
});
