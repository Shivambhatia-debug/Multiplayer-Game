// Deterministic layout of the abandoned Ares colony and outlying outposts.
// Shared by the renderer (visuals), the player controller (collision) and placement rules.
import { mulberry32 } from './noise.js';
import { offsetDir, randomDir, dist } from './vec.js';
import { PLANET_RADIUS as R } from './terrain.js';

/** Collision radius in metres for each ruin kind. */
export const RUIN_RADIUS = {
  dome: 3.8,
  lab: 3.6,
  tanks: 2.1,
  tower: 1.4,
  container: 2.9,
  rover: 2,
  lamp: 0.3,
  panels: 1.6,
  wall: 1.8,
};

export function createRuins(seed, baseDir) {
  const rand = mulberry32(seed ^ 0xa2e5);
  const items = [];
  const clear = (dir, r) => items.every((it) => dist(it.dir, dir) * R > r + it.r);
  const place = (kind, near, min, max, extra = {}) => {
    for (let i = 0; i < 30; i++) {
      const dir = offsetDir(near, rand, min, max, R);
      const r = RUIN_RADIUS[kind];
      if (dist(dir, baseDir) * R < 5 + r) continue;
      if (!clear(dir, r + 0.8)) continue;
      const item = { kind, dir, yaw: rand() * Math.PI * 2, r, broken: rand() < 0.45, seed: Math.floor(rand() * 1e6), ...extra };
      items.push(item);
      return item;
    }
    return null;
  };

  // The colony itself, in rings around the reactor.
  place('tower', baseDir, 9, 12);
  for (let i = 0; i < 3; i++) place('lab', baseDir, 12, 24);
  for (let i = 0; i < 4; i++) place('dome', baseDir, 14, 30);
  for (let i = 0; i < 3; i++) place('tanks', baseDir, 8, 22);
  for (let i = 0; i < 9; i++) place('container', baseDir, 10, 32);
  for (let i = 0; i < 2; i++) place('rover', baseDir, 12, 30);
  for (let i = 0; i < 3; i++) place('panels', baseDir, 16, 30);
  for (let i = 0; i < 5; i++) place('wall', baseDir, 18, 26);
  for (let i = 0; i < 10; i++) place('lamp', baseDir, 6, 22);

  // Abandoned outposts scattered around the planet.
  const kinds = ['lab', 'container', 'container', 'rover', 'dome', 'tanks', 'panels', 'lamp'];
  for (let s = 0; s < 14; s++) {
    let center = randomDir(rand);
    if (dist(center, baseDir) * R < 45) center = randomDir(rand);
    const n = 2 + Math.floor(rand() * 3);
    for (let i = 0; i < n; i++) place(kinds[Math.floor(rand() * kinds.length)], center, 0, 9);
  }
  return items;
}

/** Colliders the player cannot walk through (lamps are too thin to matter). */
export function ruinColliders(items) {
  return items.filter((it) => it.kind !== 'lamp').map((it) => ({ dir: it.dir, r: it.r }));
}
