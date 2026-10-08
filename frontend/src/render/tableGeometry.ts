import * as THREE from 'three';
import { POCKETS, TABLE_H, TABLE_W } from '../sim/table';

export const RAIL_W = 0.17;
export const CUSHION_W = 0.035;

export const CORNER_RADIUS = .14;
export function roundedOutline(left:number,top:number,width:number,height:number,radius:number): THREE.Shape {
  const shape=new THREE.Shape(),right=left+width,bottom=top+height;
  shape.moveTo(left+radius,top);shape.lineTo(right-radius,top);
  shape.absarc(right-radius,top+radius,radius,-Math.PI/2,0,false);
  shape.lineTo(right,bottom-radius);shape.absarc(right-radius,bottom-radius,radius,0,Math.PI/2,false);
  shape.lineTo(left+radius,bottom);shape.absarc(left+radius,bottom-radius,radius,Math.PI/2,Math.PI,false);
  shape.lineTo(left,top+radius);shape.absarc(left+radius,top+radius,radius,Math.PI,Math.PI*1.5,false);shape.closePath();return shape;
}

export function bedGeometry(): THREE.BufferGeometry {
  // Extend the pocket shelf behind the noses, then cut through the bed.
  // All six circles lie entirely inside this outline, including the corners.
  // Inset the outside faces to avoid coplanar wood/cloth flicker.
  const shelf = RAIL_W - 0.0001;
  const bed = roundedOutline(-shelf,-shelf,TABLE_W+2*shelf,TABLE_H+2*shelf,CORNER_RADIUS);
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
  const surround = roundedOutline(-RAIL_W,-RAIL_W,TABLE_W+2*RAIL_W,TABLE_H+2*RAIL_W,CORNER_RADIUS);
  surround.holes.push(opening);
  const surroundGeo = new THREE.ExtrudeGeometry(surround, { curveSegments: 32, depth: 0.12, bevelEnabled: true, bevelSegments: 5, steps: 1, bevelSize: 0.008, bevelThickness: 0.008 });
  surroundGeo.rotateX(Math.PI / 2);
  surroundGeo.translate(-TABLE_W / 2, 0.044, -TABLE_H / 2);
  return surroundGeo;
}
