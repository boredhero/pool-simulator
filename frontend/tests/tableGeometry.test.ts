import { createCabinet, returnPosition } from '../src/render/cabinet';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { bedGeometry, surroundGeometry, RAIL_W, CORNER_RADIUS } from '../src/render/tableGeometry';
import { POCKETS, TABLE_H, TABLE_W } from '../src/sim/table';

function surface(geometry: THREE.BufferGeometry) {
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.updateMatrixWorld();
  return (x: number, y: number) => new THREE.Raycaster(
    new THREE.Vector3(x - TABLE_W / 2, 1, y - TABLE_H / 2),
    new THREE.Vector3(0, -1, 0),
  ).intersectObject(mesh).length > 0;
}

describe('table geometry', () => {
  it('leaves all six capture circles open through the felt and wooden surround', () => {
    const felt = surface(bedGeometry()), wood = surface(surroundGeometry());
    for (const p of POCKETS) {
      for (let i = 0; i < 16; i++) {
        const angle = i * Math.PI / 8;
        const x = p.x + Math.cos(angle) * p.r * 0.8;
        const y = p.y + Math.sin(angle) * p.r * 0.8;
        expect(felt(x, y), `felt blocks pocket at ${x},${y}`).toBe(false);
        expect(wood(x, y), `wood blocks pocket at ${x},${y}`).toBe(false);
      }
    }
    expect(felt(TABLE_W / 2, TABLE_H / 2)).toBe(true);
    expect(wood(TABLE_W / 2, TABLE_H / 2)).toBe(false);
  });

  it('rounds the outside corners without exposing felt beyond the frame', () => {
    const wood=surface(surroundGeometry()),felt=surface(bedGeometry());
    expect(wood(-RAIL_W+.01,-RAIL_W+.01)).toBe(false);
    expect(felt(-RAIL_W+.01,-RAIL_W+.01)).toBe(false);
    for(const sx of [-1,1])for(const sy of [-1,1])for(let i=0;i<=16;i++) {
      const x=sx<0?-RAIL_W+CORNER_RADIUS:TABLE_W+RAIL_W-CORNER_RADIUS;
      const y=sy<0?-RAIL_W+CORNER_RADIUS:TABLE_H+RAIL_W-CORNER_RADIUS;
      const angle=i/16*Math.PI/2;
      expect(wood(x+sx*(CORNER_RADIUS-.01)*Math.cos(angle),y+sy*(CORNER_RADIUS-.01)*Math.sin(angle))).toBe(true);
    }
  });

  it('keeps a continuous outer frame behind the pockets on all four sides', () => {
    const wood = surface(surroundGeometry());
    const inset = RAIL_W - 0.01;
    for (let i = 0; i <= 100; i++) {
      const x = CORNER_RADIUS - inset + (TABLE_W + 2 * inset - 2 * CORNER_RADIUS) * i / 100;
      const y = CORNER_RADIUS - inset + (TABLE_H + 2 * inset - 2 * CORNER_RADIUS) * i / 100;
      expect(wood(x, -inset)).toBe(true);
      expect(wood(x, TABLE_H + inset)).toBe(true);
      expect(wood(-inset, y)).toBe(true);
      expect(wood(TABLE_W + inset, y)).toBe(true);
    }
  });
});

it('keeps the glass return channel open in front of every stored ball', () => {
  const cabinet=createCabinet(new THREE.MeshBasicMaterial());cabinet.updateMatrixWorld(true);
  for(let i=0;i<15;i++) {
    const p=returnPosition(i);
    const hits=new THREE.Raycaster(new THREE.Vector3(p.x,p.y,3),new THREE.Vector3(0,0,-1)).intersectObject(cabinet,true);
    const opaque=hits.find(hit=>!((hit.object as THREE.Mesh).material as THREE.Material).transparent);
    expect(opaque).toBeDefined();
    expect(opaque!.point.z).toBeLessThan(p.z-.028575);
  }
  expect(cabinet.children.filter(o=>o.name==='Adjustable foot')).toHaveLength(4);
});
