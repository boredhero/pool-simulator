import * as THREE from 'three';
import { POCKETS, TABLE_H, TABLE_W } from '../sim/table';

export const RAIL_W = 0.17;
export const CUSHION_W = 0.035;

export function bedGeometry(): THREE.BufferGeometry {
  // Extend the pocket shelf behind the noses, then cut through the bed.
  // All six circles lie entirely inside this outline, including the corners.
  // Inset the outside faces to avoid coplanar wood/cloth flicker.
  const shelf = RAIL_W - 0.0001;
  const bed = new THREE.Shape();
  bed.moveTo(-shelf, -shelf);
  bed.lineTo(TABLE_W + shelf, -shelf);
  bed.lineTo(TABLE_W + shelf, TABLE_H + shelf);
  bed.lineTo(-shelf, TABLE_H + shelf);
  bed.closePath();
  for (const p of POCKETS) {
    const hole = new THREE.Path();
    hole.absarc(p.x, p.y, p.r, 0, Math.PI * 2, true);
    bed.holes.push(hole);
  }
  const bedGeo = new THREE.ExtrudeGeometry(bed, { depth: 0.04, bevelEnabled: false, curveSegments: 32 });
  bedGeo.rotateX(Math.PI / 2);
  bedGeo.translate(-TABLE_W / 2, 0, -TABLE_H / 2);
  return bedGeo;
}

export function surroundGeometry(): THREE.BufferGeometry {
  // A continuous wooden surround with one scalloped inner opening. The
  // opening is the union of the cloth rectangle and the six pocket circles.
  const inner = { left: -CUSHION_W, right: TABLE_W + CUSHION_W, top: -CUSHION_W, bottom: TABLE_H + CUSHION_W };
  const cuts = POCKETS.map(p => ({ ...p, r: p.r + 0.012 }));
  type Cut = typeof cuts[number];
  type Point = [number, number];
  const atY = (p: Cut, y: number, sign: number): Point => [p.x + sign * Math.sqrt(p.r ** 2 - (y - p.y) ** 2), y];
  const atX = (p: Cut, x: number, sign: number): Point => [x, p.y + sign * Math.sqrt(p.r ** 2 - (x - p.x) ** 2)];
  // Trace the actual boundary, including the reentrant corner arcs. Sorting
  // points around the table center would cut chords across these pockets.
  const opening = new THREE.Path();
  const start = atY(cuts[0], inner.top, 1);
  opening.moveTo(...start);
  const arc = (p: Cut, from: Point, to: Point) => {
    opening.lineTo(...from);
    const a = Math.atan2(from[1] - p.y, from[0] - p.x);
    let b = Math.atan2(to[1] - p.y, to[0] - p.x);
    while (b <= a) b += Math.PI * 2;
    opening.absarc(p.x, p.y, p.r, a, b, false);
  };
  arc(cuts[1], atY(cuts[1], inner.top, -1), atY(cuts[1], inner.top, 1));
  arc(cuts[2], atY(cuts[2], inner.top, -1), atX(cuts[2], inner.right, 1));
  arc(cuts[5], atX(cuts[5], inner.right, -1), atY(cuts[5], inner.bottom, -1));
  arc(cuts[4], atY(cuts[4], inner.bottom, 1), atY(cuts[4], inner.bottom, -1));
  arc(cuts[3], atY(cuts[3], inner.bottom, 1), atX(cuts[3], inner.left, -1));
  arc(cuts[0], atX(cuts[0], inner.left, 1), start);
  opening.closePath();
  const surround = new THREE.Shape();
  surround.moveTo(-RAIL_W, -RAIL_W);
  surround.lineTo(TABLE_W + RAIL_W, -RAIL_W);
  surround.lineTo(TABLE_W + RAIL_W, TABLE_H + RAIL_W);
  surround.lineTo(-RAIL_W, TABLE_H + RAIL_W);
  surround.closePath();
  surround.holes.push(opening);
  const surroundGeo = new THREE.ExtrudeGeometry(surround, { curveSegments: 32, depth: 0.19, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: 0.002, bevelThickness: 0.002 });
  surroundGeo.rotateX(Math.PI / 2);
  surroundGeo.translate(-TABLE_W / 2, 0.05, -TABLE_H / 2);
  return surroundGeo;
}
