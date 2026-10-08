import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { bedGeometry, surroundGeometry, RAIL_W } from '../src/render/tableGeometry';
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

  it('keeps a continuous outer frame behind the pockets on all four sides', () => {
    const wood = surface(surroundGeometry());
    const inset = RAIL_W - 0.01;
    for (let i = 0; i <= 100; i++) {
      const x = -inset + (TABLE_W + 2 * inset) * i / 100;
      const y = -inset + (TABLE_H + 2 * inset) * i / 100;
      expect(wood(x, -inset)).toBe(true);
      expect(wood(x, TABLE_H + inset)).toBe(true);
      expect(wood(-inset, y)).toBe(true);
      expect(wood(TABLE_W + inset, y)).toBe(true);
    }
  });
});
