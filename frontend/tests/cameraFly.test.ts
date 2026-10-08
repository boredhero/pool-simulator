import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { translateCamera } from '../src/render/cameraFly';
import { TABLE_H, TABLE_W } from '../src/sim/table';

function fixture() {
  const camera = new PerspectiveCamera();
  camera.position.set(0, 2, 3);
  const target = new Vector3();
  camera.lookAt(target);
  return { camera, target };
}
describe('ground-plane camera flight', () => {
  it('moves relative to the camera, preserving height and viewing offset', () => {
    const { camera, target } = fixture();
    const offset = camera.position.clone().sub(target);
    translateCamera(camera, target, 1, 0, 1);
    expect(target.z).toBeCloseTo(-1.25);
    expect(target.y).toBe(0);
    expect(camera.position.y).toBe(2);
    expect(camera.position.clone().sub(target).distanceTo(offset)).toBeLessThan(1e-10);
    camera.position.copy(target).add(new Vector3(3, 2, 0));
    camera.lookAt(target);
    translateCamera(camera, target, 1, 0, 1);
    expect(target.x).toBeCloseTo(-1.25);
  });
  it('is frame-rate independent and normalizes diagonal speed', () => {
    const a = fixture(), b = fixture(), diagonal = fixture();
    for (let frame = 0; frame < 30; frame++) translateCamera(a.camera, a.target, 1, 0, 1 / 30);
    for (let frame = 0; frame < 120; frame++) translateCamera(b.camera, b.target, 1, 0, 1 / 120);
    expect(a.target.distanceTo(b.target)).toBeLessThan(1e-10);
    translateCamera(diagonal.camera, diagonal.target, 1, 1, 1);
    expect(diagonal.target.length()).toBeCloseTo(a.target.length());
  });
  it('clamps the target near the table and supports an overhead view', () => {
    const { camera, target } = fixture();
    translateCamera(camera, target, 1, 1, 100);
    expect(target.x).toBeCloseTo(TABLE_W / 2 + 3);
    expect(target.z).toBeCloseTo(-TABLE_H / 2 - 3);
    target.set(0, 0, 0);
    camera.position.set(0, 3, 0);
    camera.lookAt(target);
    translateCamera(camera, target, 1, 0, .1);
    expect(target.length()).toBeCloseTo(.125);
    expect(camera.position.y).toBe(3);
  });
});
