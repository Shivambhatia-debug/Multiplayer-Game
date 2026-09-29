// Screens narrower than 16:9 (tablets, phones held upright) would crop the sides of every
// shot. Widening the vertical field of view keeps at least a 16:9 frame's horizontal view.
const REFERENCE_ASPECT = 16 / 9;

/** Vertical FOV (degrees) for `aspect` that shows what `baseFov` shows at 16:9, capped at `maxFov`. */
export function fitFov(baseFov, aspect, maxFov = 100) {
  if (aspect >= REFERENCE_ASPECT) return baseFov;
  const half = (baseFov * Math.PI) / 360;
  const fov = (Math.atan((Math.tan(half) * REFERENCE_ASPECT) / aspect) * 360) / Math.PI;
  return Math.min(maxFov, fov);
}
