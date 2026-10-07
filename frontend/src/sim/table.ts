// Shared table geometry + rack layout. SI meters, origin at corner pocket.
// Mirror of backend/app/sim/table.py — keep in sync.
export const TABLE_W = 2.54;
export const TABLE_H = 1.27;
export const BALL_R = 0.028575;
export const BALL_M = 0.17;
export const POCKET_CORNER_W = 0.114;
export const POCKET_SIDE_W = 0.127;
export const CAPTURE_R = 0.075;
export const JAW_R = 0.006;

export interface Pocket { x: number; y: number; corner: boolean }
export const POCKETS: Pocket[] = [
  { x: 0, y: 0, corner: true },
  { x: TABLE_W / 2, y: -0.02, corner: false },
  { x: TABLE_W, y: 0, corner: true },
  { x: 0, y: TABLE_H, corner: true },
  { x: TABLE_W / 2, y: TABLE_H + 0.02, corner: false },
  { x: TABLE_W, y: TABLE_H, corner: true },
];

export interface Cushion { x1: number; y1: number; x2: number; y2: number }
export function cushions(): Cushion[] {
  const W = TABLE_W, H = TABLE_H;
  const gc = POCKET_CORNER_W / 2 + 0.01;
  const gs = POCKET_SIDE_W / 2 + 0.01;
  return [
    { x1: gc, y1: 0, x2: W / 2 - gs, y2: 0 },
    { x1: W / 2 + gs, y1: 0, x2: W - gc, y2: 0 },
    { x1: gc, y1: H, x2: W / 2 - gs, y2: H },
    { x1: W / 2 + gs, y1: H, x2: W - gc, y2: H },
    { x1: 0, y1: gc, x2: 0, y2: H - gc },
    { x1: W, y1: gc, x2: W, y2: H - gc },
  ];
}

/** Jaw bumpers: small static circles at cushion ends for rattle physics. */
export function jaws(): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (const c of cushions()) {
    out.push({ x: c.x1, y: c.y1 }, { x: c.x2, y: c.y2 });
  }
  return out;
}

/** Deterministic rack order: 1 apex, 8 center, corners mixed solid/stripe. */
export function rackOrder(seed = 1): number[] {
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const solids = [2, 3, 4, 5, 6, 7];
  const stripes = [9, 10, 11, 12, 13, 14];
  for (let i = solids.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [solids[i], solids[j]] = [solids[j], solids[i]];
    const k = Math.floor(rnd() * (i + 1));
    [stripes[i], stripes[k]] = [stripes[k], stripes[i]];
  }
  // Triangle slots row by row: [apex, row1..., row4...]; center slot index 4 = 8.
  // Corners (last row ends) must be one solid + one stripe.
  const slots = [1, solids[0], stripes[0], solids[1], 8, stripes[1], solids[2], stripes[2], solids[3], stripes[3], 0, 0, 0, 0, 0];
  const rest = [...solids.slice(4), ...stripes.slice(4)];
  let a = 0, b = 0;
  // slot 10,14 = corners: force one solid one stripe
  slots[10] = solids[4]; slots[14] = stripes[4];
  const middle = [11, 12, 13];
  const pool = [rest[0] ?? solids[5], rest[1] ?? stripes[5], rest[2] ?? solids[5]];
  for (const m of middle) slots[m] = pool[a++] ?? 8;
  void b;
  return slots;
}

export function rackPositions(): Array<[number, number]> {
  const apexX = (TABLE_W * 3) / 4;
  const apexY = TABLE_H / 2;
  const dx = BALL_R * 2 * 0.8660254 + 0.0004;
  const dy = BALL_R * 2 + 0.0004;
  const pos: Array<[number, number]> = [];
  for (let row = 0; row < 5; row++)
    for (let i = 0; i <= row; i++) pos.push([apexX + row * dx, apexY + (i - row / 2) * dy]);
  return pos;
}

export const HEAD_SPOT: [number, number] = [TABLE_W / 4, TABLE_H / 2];
