import { MathUtils, PerspectiveCamera, Spherical, Vector3 } from 'three';

const MAX_POLAR_ANGLE = Math.PI * .49;
const RAIL_TOP = .058;

/** Keep the near plane above the rails by limiting zoom, without tipping the view overhead. */
export function constrainTableCamera(camera: PerspectiveCamera, controls: {target: Vector3; maxPolarAngle: number; minDistance?: number; maxDistance?: number}, preserveInclination = false): void {
  const halfHeight = camera.near * Math.tan(MathUtils.degToRad(camera.getEffectiveFOV()) / 2);
  const nearRadius = Math.hypot(camera.near, halfHeight, halfHeight * camera.aspect);
  const minimumY = RAIL_TOP + nearRadius + .02;
  const offset = camera.position.clone().sub(controls.target);
  const orbit = new Spherical().setFromVector3(offset);
  if (!preserveInclination) {
    const requiredHeight = minimumY - controls.target.y;
    orbit.radius = Math.max(orbit.radius, requiredHeight);
    controls.minDistance = .6;
    controls.maxPolarAngle = Math.min(MAX_POLAR_ANGLE, Math.acos(MathUtils.clamp(requiredHeight / orbit.radius, -1, 1)));
    if (orbit.phi > controls.maxPolarAngle) {
      orbit.phi = controls.maxPolarAngle;
      camera.position.copy(controls.target).add(offset.setFromSpherical(orbit));
      camera.lookAt(controls.target);
      camera.updateMatrixWorld();
    }
    return;
  }
  const originalPhi = orbit.phi;
  orbit.phi = Math.min(orbit.phi, MAX_POLAR_ANGLE);
  const maximumDistance = controls.maxDistance ?? 8;
  // At a nearly horizontal angle, raise the orbit together rather than demand
  // a radius beyond OrbitControls' zoom range or sharply steepen the view.
  const targetLift = Math.max(0, minimumY - controls.target.y - maximumDistance * Math.cos(orbit.phi));
  if (targetLift) {
    controls.target.y += targetLift;
    camera.position.y += targetLift;
  }
  const requiredHeight = Math.max(0, minimumY - controls.target.y);
  const minimumDistance = Math.min(maximumDistance, Math.max(.6, requiredHeight / Math.cos(orbit.phi)));
  controls.maxPolarAngle = MAX_POLAR_ANGLE;
  controls.minDistance = minimumDistance;
  if (orbit.radius < minimumDistance || orbit.phi !== originalPhi || targetLift > 0) {
    orbit.radius = Math.max(orbit.radius, minimumDistance);
    camera.position.copy(controls.target).add(offset.setFromSpherical(orbit));
    camera.lookAt(controls.target);
    camera.updateMatrixWorld();
  }
}
