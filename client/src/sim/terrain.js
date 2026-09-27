import { createNoise3D, mulberry32 } from './noise.js';
import { randomDir, dot } from './vec.js';

export const PLANET_RADIUS = 24;

/** Radius of the ocean surface for a given water percentage. */
export function waterRadius(water) {
  return PLANET_RADIUS - 2.3 + (water / 100) * 3.3;
}

/** Deterministic planet heightfield. `height(dir)` returns the offset from PLANET_RADIUS. */
export function createTerrain(seed) {
  const noise = createNoise3D(seed);
  const rand = mulberry32(seed ^ 0x9e3779b9);
  const craters = Array.from({ length: 6 }, () => ({ dir: randomDir(rand), size: 0.12 + rand() * 0.16, depth: 0.8 + rand() * 1.2 }));

  function height(dir) {
    const [x, y, z] = dir;
    let h = 0;
    let amp = 1;
    let f = 1.2;
    for (let o = 0; o < 4; o++) {
      h += noise(x * f + o * 17.1, y * f - o * 3.7, z * f + o * 9.3) * amp;
      amp *= 0.5;
      f *= 2.15;
    }
    h *= 2.2;
    h += noise(x * 0.55 + 40, y * 0.55 - 12, z * 0.55 + 7) * 2.6;
    for (const c of craters) {
      const d = Math.acos(Math.min(1, dot(dir, c.dir)));
      if (d < c.size * 1.35) {
        const t = d / c.size;
        h += t < 1 ? -c.depth * (1 - t * t) : c.depth * 0.6 * Math.sin(((t - 1) / 0.35) * Math.PI);
      }
    }
    return h;
  }

  return {
    seed,
    height,
    surfaceRadius: (dir) => PLANET_RADIUS + height(dir),
  };
}
