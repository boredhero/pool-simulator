import { describe, expect, it } from 'vitest';
import { applyShot, groupOf, newGame, placeCue, type GameState } from '../src/sim/rules';
import type { ShotEvents } from '../src/sim/physics';

const ev = (p: Partial<ShotEvents>): ShotEvents => ({
  firstContact: null, potted: [], railAfterContact: false, cuePotted: false, ...p,
});

describe('rack', () => {
  it('15 balls, 8 center, corners mixed', () => {
    const gs = newGame(1);
    expect(gs.balls.length).toBe(16);
    const order = gs.balls.slice(1).map((b) => b.n!);
    expect(new Set(order).size).toBe(15);
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

describe('fouls', () => {
  it('no contact is a foul with ball in hand', () => {
    const gs = newGame();
    applyShot(gs, ev({ firstContact: null }));
    expect(gs.current).toBe(1);
    expect(gs.ballInHand).toBe(true);
  });

  it('wrong group first contact is a foul once grouped', () => {
    const gs = newGame();
    // Player 0 pots a solid -> grouped solids.
    applyShot(gs, ev({ firstContact: 2, potted: [2], railAfterContact: true }));
    expect(gs.open).toBe(false);
    expect(gs.groups[0]).toBe('solid');
    // Player 0 (shoots again) hits a stripe first -> foul.
    applyShot(gs, ev({ firstContact: 9, railAfterContact: true }));
    expect(gs.current).toBe(1);
    expect(gs.ballInHand).toBe(true);
  });

  it('scratch passes turn with ball in hand', () => {
    const gs = newGame();
    applyShot(gs, ev({ firstContact: 1, potted: [1], railAfterContact: true, cuePotted: true }));
    expect(gs.current).toBe(1);
    expect(gs.ballInHand).toBe(true);
  });

  it('no rail and no pot is a foul', () => {
    const gs = newGame();
    applyShot(gs, ev({ firstContact: 3, potted: [], railAfterContact: false }));
    expect(gs.ballInHand).toBe(true);
  });
});

describe('win/loss', () => {
  const cleared = (gs: GameState, player: 0 | 1) => {
    const g = player === 0 ? 'solid' : 'stripe';
    gs.groups = player === 0 ? ['solid', 'stripe'] : ['stripe', 'solid'];
    gs.open = false;
    for (const b of gs.balls) {
      if (b.n !== null && b.n !== 8 && groupOf(b.n) === g) b.potted = true;
    }
    gs.current = player;
  };
  it('legal 8-ball after clearing wins', () => {
    const gs = newGame();
    cleared(gs, 0);
    applyShot(gs, ev({ firstContact: 8, potted: [8], railAfterContact: true }));
    expect(gs.winner).toBe(0);
  });
  it('early 8-ball loses (after the break)', () => {
    const gs = newGame();
    applyShot(gs, ev({ firstContact: 1, potted: [1], railAfterContact: true })); // break, assigns solids
    applyShot(gs, ev({ firstContact: 2, potted: [2, 8], railAfterContact: true })); // early 8
    expect(gs.winner).toBe(1);
  });
  it('8-ball on a legal break respots, no loss', () => {
    const gs = newGame();
    applyShot(gs, ev({ firstContact: 1, potted: [1, 8], railAfterContact: true }));
    expect(gs.winner).toBe(null);
    expect(gs.balls.find((b) => b.n === 8)!.potted).toBe(false);
  });
  it('foul on the 8 loses', () => {
    const gs = newGame();
    cleared(gs, 1);
    applyShot(gs, ev({ firstContact: 8, potted: [8], railAfterContact: true, cuePotted: true }));
    expect(gs.winner).toBe(0);
  });
});

describe('placeCue', () => {
  it('rejects off-table and overlapping spots', () => {
    const gs = newGame();
    expect(placeCue(gs, -1, -1)).toBe(false);
    const blocker = gs.balls[1];
    expect(placeCue(gs, blocker.x, blocker.y)).toBe(false);
    expect(placeCue(gs, 1.0, 0.635)).toBe(true);
    expect(gs.balls[0].potted).toBe(false);
  });
});
