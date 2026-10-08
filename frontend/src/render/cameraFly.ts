import { MathUtils, PerspectiveCamera, Vector3 } from 'three';
import { TABLE_H, TABLE_W } from '../sim/table';

/** Translate eye and target together: planar WASD plus world-vertical rise/descent. */
export function translateCamera(camera: PerspectiveCamera, target: Vector3, forward: number, right: number, seconds: number, up = 0): void {
  if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isFinite(forward) || !Number.isFinite(right) || !Number.isFinite(up)) return;
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
  delta.y = up;
  if (delta.lengthSq() > 1) delta.normalize();
  delta.multiplyScalar(seconds * 1.25);
  const nextX = MathUtils.clamp(target.x + delta.x, -TABLE_W / 2 - 3, TABLE_W / 2 + 3);
  const nextZ = MathUtils.clamp(target.z + delta.z, -TABLE_H / 2 - 3, TABLE_H / 2 + 3);
  // Match the table/near-plane clearance before translating either eye or target.
  const halfHeight=camera.near*Math.tan(MathUtils.degToRad(camera.getEffectiveFOV())/2);
  const floor=Math.max(.15,.058+Math.hypot(camera.near,halfHeight,halfHeight*camera.aspect)+.02);
  const height = MathUtils.clamp(camera.position.y + delta.y, floor, 8);
  delta.set(nextX - target.x, height - camera.position.y, nextZ - target.z);
  target.add(delta);
  camera.position.add(delta);
  camera.updateMatrixWorld();
}
