import { MathUtils, PerspectiveCamera, Vector3 } from 'three';
import { TABLE_H, TABLE_W } from '../sim/table';

/** Translate eye and orbit target together along the viewing direction's ground plane. */
export function translateCamera(camera: PerspectiveCamera, target: Vector3, forward: number, right: number, seconds: number): void {
  if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isFinite(forward) || !Number.isFinite(right)) return;
  const ahead = camera.getWorldDirection(new Vector3());
  ahead.y = 0;
  // At a directly overhead view, screen-up supplies a stable ground-plane direction.
  if (ahead.lengthSq() < 1e-8) {
    ahead.set(0, 1, 0).applyQuaternion(camera.quaternion);
    ahead.y = 0;
  }
  ahead.normalize();
  const side = new Vector3().crossVectors(ahead, new Vector3(0, 1, 0));
  const delta = ahead.multiplyScalar(forward).addScaledVector(side, right);
  if (delta.lengthSq() > 1) delta.normalize();
  delta.multiplyScalar(seconds * 1.25);
  const nextX = MathUtils.clamp(target.x + delta.x, -TABLE_W / 2 - 3, TABLE_W / 2 + 3);
  const nextZ = MathUtils.clamp(target.z + delta.z, -TABLE_H / 2 - 3, TABLE_H / 2 + 3);
  delta.set(nextX - target.x, 0, nextZ - target.z);
  target.add(delta);
  camera.position.add(delta);
  camera.updateMatrixWorld();
}
