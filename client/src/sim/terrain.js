import { createNoise3D, mulberry32 } from './noise.js';
import { randomDir, dot } from './vec.js';

export const PLANET_RADIUS = 50;

/** Radius of the ocean surface for a given water percentage. */
export function waterRadius(water) {
  return PLANET_RADIUS - 4.4 + (water / 100) * 3.6;
}

/**
 * Deterministic planet heightfield. `height(dir)` returns the offset from PLANET_RADIUS.
 * Rolling continents, ridged mountain ranges, small-scale bumps and impact craters.
 */
export function createTerrain(seed) {
  const noise = createNoise3D(seed);
  const rand = mulberry32(seed ^ 0x9e3779b9);
  const craters = Array.from({ length: 9 }, () => ({ dir: randomDir(rand), size: 0.05 + rand() * 0.08, depth: 1.2 + rand() * 1.6 }));

  function height(dir) {
    const [x, y, z] = dir;
    // Continents: very low frequency, decides lowland versus highland.
    const continent = noise(x * 0.9 + 40, y * 0.9 - 12, z * 0.9 + 7);
    // Rolling hills.
    let hills = 0;
    let amp = 1;
    let f = 2.4;
    for (let o = 0; o < 4; o++) {
      hills += noise(x * f + o * 17.1, y * f - o * 3.7, z * f + o * 9.3) * amp;
      amp *= 0.5;
      f *= 2.1;
    }
    // Ridged mountains, only on high ground.
    let ridge = 0;
    amp = 1;
    f = 1.8;
    for (let o = 0; o < 3; o++) {
      const r = 1 - Math.abs(noise(x * f - 31, y * f + 5, z * f + 13 * o));
      ridge += r * r * amp;
      amp *= 0.45;
      f *= 2.2;
    }
    const highland = Math.max(0, Math.min(1, (continent + 0.05) * 3));
    let h = continent * 4.2 + hills * 1.6 + ridge * highland * 4.2 - 1;
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
