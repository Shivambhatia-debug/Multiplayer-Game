import { createNoise3D, mulberry32 } from './noise.js';
import { dot } from './vec.js';

// A big planet, so the ground around the colony reads as a flat plain with a far horizon
// rather than a small ball. All terrain features are sized in metres, not in angles.
export const PLANET_RADIUS = 1200;

/** Where the Ares colony (and its reactor) stands. The ground there is levelled. */
export const BASE_DIR = (() => {
  const v = [0.28, 0.92, 0.27];
  const l = Math.hypot(...v);
  return v.map((x) => x / l);
})();
const BASE_HEIGHT = 0.4;
const FLAT_RADIUS = 58; // metres of levelled ground around the reactor (the wall is at 45 m)
const BLEND = 45; // metres over which the plateau blends into the wild terrain

const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Deterministic heightfield. `height(dir)` returns metres above PLANET_RADIUS.
 * Gentle dunes and rolling plains near the colony, rocky hills further out, and ridged
 * mountain ranges ringing the horizon. A few impact craters sit out on the plains.
 */
export function createTerrain(seed) {
  const noise = createNoise3D(seed);
  const rand = mulberry32(seed ^ 0x9e3779b9);
  const R = PLANET_RADIUS;
  // Crater centres in metres around the colony (placed on the plains outside the wall).
  const craters = Array.from({ length: 7 }, () => {
    const a = rand() * Math.PI * 2;
    const d = 85 + rand() * 170;
    return { a, d, size: 7 + rand() * 13, depth: 1 + rand() * 2 };
  });
  const up = BASE_DIR;
  const north = (() => {
    const n = [-up[0] * up[1], 1 - up[1] * up[1], -up[2] * up[1]];
    const l = Math.hypot(...n);
    return n.map((x) => x / l);
  })();
  const east = [north[1] * up[2] - north[2] * up[1], north[2] * up[0] - north[0] * up[2], north[0] * up[1] - north[1] * up[0]];
  const craterDirs = craters.map((c) => {
    const x = Math.sin(c.a) * c.d;
    const z = Math.cos(c.a) * c.d;
    const v = [up[0] * R + east[0] * x + north[0] * z, up[1] * R + east[1] * x + north[1] * z, up[2] * R + east[2] * x + north[2] * z];
    const l = Math.hypot(...v);
    return v.map((k) => k / l);
  });

  function height(dir) {
    // Position on the sphere in metres; noise wavelengths below are in metres too.
    const x = dir[0] * R;
    const y = dir[1] * R;
    const z = dir[2] * R;
    const fromBase = Math.acos(Math.min(1, dot(dir, BASE_DIR))) * R;

    // Rolling plains: long, low swells.
    let h = noise(x / 140 + 40, y / 140 - 12, z / 140 + 7) * 3.2;
    h += noise(x / 55 + 3.1, y / 55 - 7.7, z / 55 + 1.9) * 1.3;
    // Dunes and ripples.
    h += noise(x / 16 - 9, y / 16 + 4, z / 16 + 12) * 0.35;
    // Hills and mountains rise with distance, so the colony sits in a wide valley.
    const wild = smooth(70, 320, fromBase);
    if (wild > 0) {
      const r1 = 1 - Math.abs(noise(x / 120 - 31, y / 120 + 5, z / 120 + 13));
      const r2 = 1 - Math.abs(noise(x / 48 + 17, y / 48 - 23, z / 48 - 5));
      h += (r1 * r1 * 30 + r2 * r2 * 7) * wild;
      h += noise(x / 30 - 2, y / 30 + 9, z / 30 - 4) * 2.2 * wild;
    }
    for (let i = 0; i < craters.length; i++) {
      const c = craters[i];
      const d = Math.acos(Math.min(1, dot(dir, craterDirs[i]))) * R;
      if (d < c.size * 1.4) {
        const t = d / c.size;
        h += t < 1 ? -c.depth * (1 - t * t) : c.depth * 0.5 * Math.sin(((t - 1) / 0.4) * Math.PI);
      }
    }
    // Level a plateau for the colony, blending smoothly into the surrounding land.
    if (fromBase < FLAT_RADIUS + BLEND) {
      const k = smooth(FLAT_RADIUS, FLAT_RADIUS + BLEND, fromBase);
      h = BASE_HEIGHT + (h - BASE_HEIGHT) * k;
    }
    return h;
  }

  return {
    seed,
    height,
    surfaceRadius: (dir) => PLANET_RADIUS + height(dir),
  };
}
