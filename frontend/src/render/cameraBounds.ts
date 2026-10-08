import { MathUtils, PerspectiveCamera, Spherical, Vector3 } from 'three';

const MAX_POLAR_ANGLE = Math.PI * .49;
const RAIL_TOP = .058;

/** Keep the eye and its entire near plane above the table while preserving zoom. */
export function constrainTableCamera(camera: PerspectiveCamera, controls: {target: Vector3; maxPolarAngle: number}): void {
  const halfHeight = camera.near * Math.tan(MathUtils.degToRad(camera.getEffectiveFOV()) / 2);
  const nearRadius = Math.hypot(camera.near, halfHeight, halfHeight * camera.aspect);
  const minimumY = RAIL_TOP + nearRadius + .02;
  const offset = camera.position.clone().sub(controls.target);
  const orbit = new Spherical().setFromVector3(offset);
  const requiredHeight = minimumY - controls.target.y;
  orbit.radius = Math.max(orbit.radius, requiredHeight);
  controls.maxPolarAngle = Math.min(MAX_POLAR_ANGLE, Math.acos(MathUtils.clamp(requiredHeight / orbit.radius, -1, 1)));
  if (orbit.phi > controls.maxPolarAngle) {
    orbit.phi = controls.maxPolarAngle;
    camera.position.copy(controls.target).add(offset.setFromSpherical(orbit));
    camera.lookAt(controls.target);
    camera.updateMatrixWorld();
  }
}
