// Rules consume immutable pre-shot context and physical facts; no UI/net imports.
import { Ball, ShotEvents, makeBall } from './physics';
import { BALL_R, HEAD_SPOT, TABLE_H, TABLE_W, rackOrder, rackPositions } from './table';
import { BAR_RULES, matchConfig, type MatchConfig } from './config';

export type Group = 'solid' | 'stripe' | null;
export type Placement = 'none' | 'kitchen' | 'anywhere';
export interface ShotContext {
  current: 0 | 1; open: boolean; breakShot: boolean; group: Group;
  remaining: number[]; kitchen: boolean; calledBall: number | null; calledPocket: number | null;
}
export interface GameState {
  returnOrder: number[];
  balls: Ball[]; current: 0 | 1; groups: [Group, Group]; open: boolean;
  ballInHand: boolean; placement: Placement; kitchenShot: boolean; breakShot: boolean;
  winner: 0 | 1 | null; message: string; rules: MatchConfig; shot?: ShotContext;
}
// Future games implement this boundary while reusing balls/table/shot facts.
export interface Ruleset<S, C> {
  id: string; version: number;
  create(seed: number, options: MatchConfig): S;
  begin(state: S, calledBall?: number | null, calledPocket?: number | null): C;
  resolve(state: S, facts: ShotEvents, before?: C): S;
  targets(state: S): number[];
  canPlace(state: S, x: number, y: number): boolean;
}
export function newGame(seed = 1, options: MatchConfig = BAR_RULES): GameState {
  const balls = [makeBall(0, null, ...HEAD_SPOT)];
  const order = rackOrder(seed), pos = rackPositions();
  order.forEach((n, i) => balls.push(makeBall(i + 1, n, ...pos[i])));
  return { returnOrder: [], balls, current: 0, groups: [null, null], open: true, ballInHand: false, placement: 'none', kitchenShot: false, breakShot: true, winner: null, message: 'Player 1 to break', rules: matchConfig(options) };
}
export function groupOf(n: number): 'solid' | 'stripe' | 'eight' { return n === 8 ? 'eight' : n < 8 ? 'solid' : 'stripe'; }
function remaining(gs: GameState): number[] {
  const group = gs.groups[gs.current];
  return gs.balls.filter(b => !b.potted && b.n !== null && b.n !== 8 && (gs.open || group === null || groupOf(b.n) === group)).map(b => b.n!);
}
export function legalTargets(gs: GameState): number[] {
  const targets = remaining(gs);
  return targets.length || gs.open ? targets : [8];
}
export function callRequired(gs: GameState): boolean {
  return !gs.breakShot && (gs.rules.calls === 'all' || (gs.rules.calls === 'eight' && legalTargets(gs).includes(8)));
}
export function beginShot(gs: GameState, calledBall: number | null = null, calledPocket: number | null = null): ShotContext {
  const before = { current: gs.current, open: gs.open, breakShot: gs.breakShot, group: gs.groups[gs.current], remaining: remaining(gs), kitchen: gs.kitchenShot, calledBall, calledPocket };
  gs.shot = before;
  return before;
}
export function spotBall(gs: GameState, n: number): void {
  const ball = gs.balls.find(b => b.n === n);
  if (!ball) return;
  const candidates: Array<[number, number]> = [[TABLE_W * .75, TABLE_H / 2]];
  for (let d = BALL_R * 2 + .001; d < TABLE_W; d += BALL_R * 2 + .001) {
    candidates.push([TABLE_W * .75 - d, TABLE_H / 2], [TABLE_W * .75 + d, TABLE_H / 2]);
  }
  for (let x = .1; x < TABLE_W - .1; x += .07) for (let y = .1; y < TABLE_H - .1; y += .07) candidates.push([x, y]);
  const point = candidates.find(([x, y]) => x > BALL_R && x < TABLE_W - BALL_R && gs.balls.every(b => b.id === ball.id || b.potted || Math.hypot(b.x - x, b.y - y) >= 2 * BALL_R + .001));
  if (!point) throw new Error('No free spot for object ball');
  gs.returnOrder = gs.returnOrder.filter(value => value !== n);
  Object.assign(ball, makeBall(ball.id, n, ...point));
}
function grantPlacement(gs: GameState, zone: Placement): void {
  gs.ballInHand = true; gs.placement = zone; gs.kitchenShot = zone === 'kitchen';
  // A kitchen-only layout must still offer a legal direct target.
  const targets = gs.balls.filter(b => !b.potted && b.n !== null && legalTargets(gs).includes(b.n));
  if (zone === 'kitchen' && targets.length && targets.every(b => b.x < TABLE_W / 4)) {
    targets.sort((a, b) => b.x - a.x);
    spotBall(gs, targets[0].n!);
  }
}
export function applyShot(gs: GameState, ev: ShotEvents, before = gs.shot ?? beginShot(gs)): GameState {
  if (gs.winner !== null) return gs;
  delete gs.shot;
  for (const n of ev.potted) if (!gs.returnOrder.includes(n)) gs.returnOrder.push(n);
  const me = before.current, other = (1 - me) as 0 | 1;
  const onEight = !before.open && before.group !== null && before.remaining.length === 0;
  const tournament = gs.rules.preset === 'tournament';
  const breakOff = tournament && before.breakShot && ev.offTable.length > 0;
  const eightDown = ev.potted.includes(8), eightOff = ev.offTable.includes(8);
  const scratch = ev.cuePotted || ev.offTable.includes(null);
  let foul: string | null = null;
  if (ev.firstContact === null) foul = 'No contact';
  else if (before.open ? ev.firstContact === 8 : onEight ? ev.firstContact !== 8 : groupOf(ev.firstContact) !== before.group) foul = 'Wrong first contact';
  if (!foul && before.kitchen && (ev.firstContactX ?? TABLE_W) < TABLE_W / 4 && !ev.cueLeftKitchen) foul = 'The cue ball must leave the kitchen first';
  if (!foul && !ev.potted.length && !ev.railAfterContact) foul = 'No rail after contact';
  if (!foul && scratch) foul = 'Scratch';
  if ((!foul || tournament) && ev.offTable.length) foul = 'Ball off the table';
  const called = before.calledBall !== null && ev.pockets?.some(p => p.n === before.calledBall && p.pocket === before.calledPocket);
  const eightCalled = gs.rules.calls === 'none' || (before.calledBall === 8 && called);
  const spotBreakEight = before.breakShot && (eightDown || (tournament && eightOff)) && gs.rules.eightOnBreak === 'spot';
  if (spotBreakEight) spotBall(gs, 8);
  if ((eightOff && !spotBreakEight) || (onEight && scratch && gs.rules.scratchOnEightLoss) || (eightDown && !spotBreakEight && !(before.breakShot && !foul) && !(onEight && !foul && eightCalled))) {
    gs.winner = other; gs.message = `Player ${other + 1} wins — ${foul ?? (onEight ? '8-Ball in the wrong pocket' : 'early 8-Ball')}`; return gs;
  }
  if (eightDown && before.breakShot && !foul) {
    if (gs.rules.eightOnBreak === 'win') { gs.winner = me; gs.message = `Player ${me + 1} wins — 8-Ball on the break`; return gs; }
    spotBall(gs, 8);
  } else if (eightDown && onEight && !foul && eightCalled) {
    gs.winner = me; gs.message = `Player ${me + 1} wins!`; return gs;
  }
  if (before.breakShot && gs.rules.strictBreak && !breakOff && !ev.potted.length && (ev.objectRails?.length ?? 0) < 4) {
    const options = gs.rules;
    Object.assign(gs, newGame(1, options)); gs.current = other; gs.message = `Illegal break — reracked for Player ${other + 1}`;
    return gs;
  }
  for (const n of ev.offTable) if (n !== null && n !== 8) {
    if (tournament) { if (!gs.returnOrder.includes(n)) gs.returnOrder.push(n); }
    else spotBall(gs, n);
  }
  gs.breakShot = false; gs.kitchenShot = false;
  if (foul) {
    gs.current = other;
    const zone = breakOff || (scratch && (gs.rules.scratch === 'kitchen' || before.breakShot)) ? 'kitchen' : 'anywhere';
    grantPlacement(gs, zone);
    gs.message = `Foul: ${foul} · Player ${other + 1}, place ${zone === 'kitchen' ? 'behind the head string' : 'anywhere'}`;
    return gs;
  }
  const validPot = before.breakShot || gs.rules.calls !== 'all' || !!called;
  const pots = ev.potted.filter(n => n !== 8);
  if (gs.open && (!before.breakShot || gs.rules.assignOnBreak) && validPot && pots.length) {
    const groups = new Set(pots.map(groupOf));
    const group = gs.rules.calls === 'all' && before.calledBall !== null ? groupOf(before.calledBall) : groups.size === 1 ? groupOf(pots[0]) : null;
    if (group === 'solid' || group === 'stripe') { gs.groups[me] = group; gs.groups[other] = group === 'solid' ? 'stripe' : 'solid'; gs.open = false; }
  }
  const continues = validPot && pots.some(n => gs.open || groupOf(n) === gs.groups[me]);
  gs.current = continues ? me : other; gs.ballInHand = false; gs.placement = 'none';
  gs.message = `Player ${gs.current + 1} ${continues ? 'shoots again' : 'to shoot'}`;
  if (before.breakShot && gs.open) gs.message += gs.rules.assignOnBreak && pots.length ? ' · mixed break pots, table open' : ' · table open after the break';
  else if (before.open && !gs.open) gs.message += ` · Player ${me + 1} has ${gs.groups[me] === 'solid' ? 'solids' : 'stripes'}`;
  return gs;
}
export function canPlace(gs: GameState, x: number, y: number): boolean {
  if (!gs.ballInHand || gs.winner !== null || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  if (x < BALL_R + .001 || x > TABLE_W - BALL_R - .001 || y < BALL_R + .001 || y > TABLE_H - BALL_R - .001) return false;
  if (gs.placement === 'kitchen' && x >= TABLE_W / 4) return false;
  return gs.balls.every(b => b.id === 0 || b.potted || Math.hypot(b.x - x, b.y - y) >= 2 * BALL_R + .001);
}
export function placeCue(gs: GameState, x: number, y: number): boolean {
  if (!canPlace(gs, x, y)) return false;
  Object.assign(gs.balls[0], makeBall(0, null, x, y));
  gs.kitchenShot = gs.placement === 'kitchen'; gs.ballInHand = false; gs.placement = 'none';
  return true;
}
export const eightBall: Ruleset<GameState, ShotContext> = { id: 'eight-ball', version: 1, create: newGame, begin: beginShot, resolve: applyShot, targets: legalTargets, canPlace };
