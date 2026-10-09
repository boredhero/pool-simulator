/** Match Python's operation order for bounded simulation coordinates/velocities.
 * Runtime hypot implementations use different scaling/rounding algorithms.
 * Other libm calls can still differ; this is not a bitwise determinism claim. */
export function norm(x: number, y: number, z = 0): number {
  return Math.sqrt(x * x + y * y + z * z);
}
