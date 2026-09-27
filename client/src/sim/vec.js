// Tiny array-based vector helpers so the simulation stays independent of three.js.
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a) => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const round = (v, digits = 3) => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};
export const roundVec = (a, digits = 3) => [round(a[0], digits), round(a[1], digits), round(a[2], digits)];
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function randomDir(rand) {
  const z = rand() * 2 - 1;
  const t = rand() * Math.PI * 2;
  const r = Math.sqrt(1 - z * z);
  return [r * Math.cos(t), r * Math.sin(t), z];
}

/** Moves along the sphere from `dir` by a random arc distance in [minD, maxD] (world units on radius R). */
export function offsetDir(dir, rand, minD, maxD, R) {
  const helper = Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const t1 = norm(cross(dir, helper));
  const t2 = cross(dir, t1);
  const a = rand() * Math.PI * 2;
  const d = (minD + rand() * (maxD - minD)) / R;
  const tangent = add(scale(t1, Math.cos(a)), scale(t2, Math.sin(a)));
  return norm(add(dir, scale(tangent, Math.tan(d))));
}
