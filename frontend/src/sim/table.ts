// Shared table geometry + rack layout. SI meters, origin at corner pocket.
// Mirror of backend/app/sim/table.py — keep in sync.
export const TABLE_W = 2.54;
export const TABLE_H = 1.27;
export const BALL_R = 0.028575;
export const BALL_M = 0.17;
// WPA mouths: corner 4.5in, side 5.0in. Cushion noses end at the mouth edges.
const CORNER_HALF = 0.0572;
const SIDE_HALF = 0.0635;

export interface Pocket { x: number; y: number; r: number; corner: boolean }
// Capture circles sit behind the nose line (pooltool layout, SI).
const CB = 0.0287; // 1.6in along the corner bisector per axis
export const POCKETS: Pocket[] = [
  { x: -CB, y: -CB, r: 0.061, corner: true },
  { x: TABLE_W / 2, y: -0.066, r: 0.0635, corner: false },
  { x: TABLE_W + CB, y: -CB, r: 0.061, corner: true },
  { x: -CB, y: TABLE_H + CB, r: 0.061, corner: true },
  { x: TABLE_W / 2, y: TABLE_H + 0.066, r: 0.0635, corner: false },
  { x: TABLE_W + CB, y: TABLE_H + CB, r: 0.061, corner: true },
];

/** Effective capture radius shrinks for fast balls (rattle-out). v in m/s. */
export function captureRadius(p: Pocket, v: number): number {
  if (v <= 1.0) return p.r;
  const shave = 0.01016 * (v - 1.0); // 0.4in per m/s
  return Math.max(0.6 * p.r, p.r - shave);
}

export interface Cushion { x1: number; y1: number; x2: number; y2: number }
export function cushions(): Cushion[] {
  const W = TABLE_W, H = TABLE_H;
  return [
    { x1: CORNER_HALF, y1: 0, x2: W / 2 - SIDE_HALF, y2: 0 },
    { x1: W / 2 + SIDE_HALF, y1: 0, x2: W - CORNER_HALF, y2: 0 },
    { x1: CORNER_HALF, y1: H, x2: W / 2 - SIDE_HALF, y2: H },
    { x1: W / 2 + SIDE_HALF, y1: H, x2: W - CORNER_HALF, y2: H },
    { x1: 0, y1: CORNER_HALF, x2: 0, y2: H - CORNER_HALF },
    { x1: W, y1: CORNER_HALF, x2: W, y2: H - CORNER_HALF },
  ];
}

/** Jaw bumpers: corner r=0.83in, side r=0.31in, tucked behind the nose line. */
export function jaws(): Array<{ x: number; y: number; r: number }> {
  const W = TABLE_W, H = TABLE_H;
  const cj = 0.021, sj = 0.0079;
  const co = 0.0076, so = 0.0071; // outboard offsets
  return [
    { x: CORNER_HALF + co, y: -cj, r: cj }, { x: -cj, y: CORNER_HALF + co, r: cj },
    { x: W - CORNER_HALF - co, y: -cj, r: cj }, { x: W + cj, y: CORNER_HALF + co, r: cj },
    { x: CORNER_HALF + co, y: H + cj, r: cj }, { x: -cj, y: H - CORNER_HALF - co, r: cj },
    { x: W - CORNER_HALF - co, y: H + cj, r: cj }, { x: W + cj, y: H - CORNER_HALF - co, r: cj },
    { x: W / 2 - SIDE_HALF - so, y: -sj, r: sj }, { x: W / 2 + SIDE_HALF + so, y: -sj, r: sj },
    { x: W / 2 - SIDE_HALF - so, y: H + sj, r: sj }, { x: W / 2 + SIDE_HALF + so, y: H + sj, r: sj },
  ];
}

/** Deterministic rack order: 1 apex, 8 center, corners one solid + one stripe. */
export function rackOrder(seed = 1): number[] {
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const shuffled = (arr: number[]) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  // Slots in triangle order: idx0 = apex, idx4 = center, idx10/idx14 = back corners.
  const solids = shuffled([2, 3, 4, 5, 6, 7]);
  const stripes = shuffled([9, 10, 11, 12, 13, 14, 15]);
  const slots: number[] = [1, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  // Back corners: one solid, one stripe (random side).
  if (rnd() < 0.5) {
    slots[10] = solids.pop()!;
    slots[14] = stripes.pop()!;
  } else {
    slots[10] = stripes.pop()!;
    slots[14] = solids.pop()!;
  }
  const rest = shuffled([...solids, ...stripes]);
  for (let i = 0; i < slots.length; i++) if (slots[i] === 0) slots[i] = rest.pop()!;
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
