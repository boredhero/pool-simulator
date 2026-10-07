// 8-ball rules (WPA, casual: no called shots). Pure logic over sim ShotEvents.
import { Ball, ShotEvents, makeBall } from './physics';
import { HEAD_SPOT, TABLE_H, TABLE_W, rackOrder, rackPositions } from './table';

export type Group = 'solid' | 'stripe' | null;

export interface GameState {
  balls: Ball[]; // id 0 = cue (n=null), ids 1..15 hold ball numbers
  current: 0 | 1;
  groups: [Group, Group]; // per player; null until assigned
  open: boolean;
  ballInHand: boolean;
  breakShot: boolean; // first shot of the game (8 potted here respots, not loss)
  winner: 0 | 1 | null;
  message: string;
}

export function newGame(seed = 1): GameState {
  const balls: Ball[] = [makeBall(0, null, HEAD_SPOT[0], HEAD_SPOT[1])];
  const order = rackOrder(seed);
  const pos = rackPositions();
  order.forEach((n, i) => balls.push(makeBall(i + 1, n, pos[i][0], pos[i][1])));
  return { balls, current: 0, groups: [null, null], open: true, ballInHand: false, breakShot: true, winner: null, message: 'Player 1 to break' };
}

export function groupOf(n: number): 'solid' | 'stripe' | 'eight' {
  if (n === 8) return 'eight';
  return n < 8 ? 'solid' : 'stripe';
}

function aliveBalls(gs: GameState, player: 0 | 1): number[] {
  const g = gs.groups[player];
  return gs.balls.filter((b) => !b.potted && b.n !== null && (gs.open || g === null ? b.n !== 8 : groupOf(b.n) === g)).map((b) => b.n!);
}

/** Apply a finished shot. Returns updated state (mutates gs). */
export function applyShot(gs: GameState, ev: ShotEvents): GameState {
  if (gs.winner !== null) return gs;
  const me = gs.current;
  const other = (1 - me) as 0 | 1;
  const myGroup = gs.groups[me];

  const first = ev.firstContact; // ball number or null
  let foul: string | null = null;

  const potted8 = ev.potted.includes(8) || ev.offTable.includes(8);
  const myRemainingBefore = aliveBalls(gs, me);

  // --- 8-ball terminal cases (checked against pre-shot state) ---
  const onEight = !gs.open && myGroup !== null && myRemainingBefore.length === 0;

  if (first === null) {
    foul = 'No contact';
  } else if (!gs.open && !onEight && myGroup !== null) {
    if (first === 8 || groupOf(first) !== myGroup) foul = 'Wrong first contact';
  } else if (!gs.open && onEight) {
    if (first !== 8) foul = 'Must contact the 8-ball';
  } else if (gs.open) {
    if (first === 8 && ev.potted.length === 0 && !ev.railAfterContact) foul = 'Illegal break contact';
    else if (first === 8) {
      // 8 first on open table: legal only if 8 potted (does not win, respotted) — casual rule.
      if (!ev.potted.includes(8)) foul = 'Wrong first contact';
    }
  }
  if (!foul && ev.potted.length === 0 && !ev.railAfterContact) foul = 'No rail after contact';
  if (!foul && ev.cuePotted) foul = 'Scratch';
  if (!foul && ev.offTable.length > 0) foul = 'Ball off the table';

  // --- 8-ball win/loss ---
  if (potted8) {
    // 8 on a legal break respots (casual WPA); any other early 8 loses.
    if (gs.open && gs.breakShot && !foul) {
      respot8(gs);
      gs.message = '8-ball on the break — respotted, table open';
    } else if (onEight && !foul) {
      gs.winner = me;
      gs.message = `Player ${me + 1} wins!`;
      return gs;
    } else {
      gs.winner = other;
      gs.message = foul
        ? `Player ${me + 1} fouled on the 8 — Player ${other + 1} wins`
        : `Early 8-ball — Player ${other + 1} wins`;
      return gs;
    }
  }

  if (foul) {
    gs.current = other;
    gs.ballInHand = true;
    gs.breakShot = false;
    gs.message = `Foul (${foul}) — Player ${other + 1} ball in hand`;
    return gs;
  }

  // --- Group assignment on first pot while open ---
  if (gs.open && ev.potted.length > 0) {
    const firstPot = ev.potted[0];
    if (firstPot !== 8) {
      const g = groupOf(firstPot);
      gs.groups[me] = g === 'eight' ? null : (g as Group);
      gs.groups[other] = g === 'solid' ? 'stripe' : g === 'stripe' ? 'solid' : null;
      gs.open = false;
      gs.message = `Player ${me + 1} is ${gs.groups[me]}s`;
    }
  }

  // --- Continue or pass turn ---
  const pottedOwn = ev.potted.some((n) => {
    if (n === 8) return false;
    if (gs.open) return true; // any pot on open table continues (after assignment)
    return groupOf(n) === gs.groups[me];
  });
  if (pottedOwn) {
    gs.message = `Player ${me + 1} shoots again`;
  } else {
    gs.current = other;
    gs.message = `Player ${other + 1} to shoot`;
  }
  gs.ballInHand = false;
  gs.breakShot = false;
  return gs;
}

function respot8(gs: GameState): void {
  const eight = gs.balls.find((b) => b.n === 8)!;
  // Foot spot, else nearest free point along long string.
  const cands: Array<[number, number]> = [[(TABLE_W * 3) / 4, TABLE_H / 2]];
  for (let dx = 0.06; dx < 1.2; dx += 0.06) {
    cands.push([(TABLE_W * 3) / 4 - dx, TABLE_H / 2], [(TABLE_W * 3) / 4 + dx, TABLE_H / 2]);
  }
  for (const [x, y] of cands) {
    const free = gs.balls.every((b) => b.potted || b.id === eight.id || Math.hypot(b.x - x, b.y - y) > 0.065);
    if (x > 0.05 && x < TABLE_W - 0.05) {
      if (free) {
        eight.x = x; eight.y = y; eight.potted = false; eight.asleep = true;
        return;
      }
    }
  }
  eight.x = (TABLE_W * 3) / 4; eight.y = TABLE_H / 2; eight.potted = false; eight.asleep = true;
}

/** Place cue ball (ball in hand). Returns false if blocked. */
export function placeCue(gs: GameState, x: number, y: number): boolean {
  const cue = gs.balls[0];
  if (x < 0.03 || x > TABLE_W - 0.03 || y < 0.03 || y > TABLE_H - 0.03) return false;
  const blocked = gs.balls.some((b) => b.id !== 0 && !b.potted && Math.hypot(b.x - x, b.y - y) < 0.062);
  if (blocked) return false;
  cue.x = x; cue.y = y;
  cue.vx = cue.vy = cue.wx = cue.wy = cue.wz = 0;
  cue.potted = false; cue.asleep = true;
  return true;
}
