// The Ares colony, laid out like a real settlement: a reactor plaza at the centre, four
// paved roads, a perimeter wall with gates, and four districts (research, habitation,
// landing pad, industry). A few abandoned outposts sit elsewhere on the planet.
// Shared by the renderer (visuals), the controller (collision) and placement rules.
import { mulberry32 } from './noise.js';
import { randomDir, dist, norm, cross, dot } from './vec.js';
import { PLANET_RADIUS as R } from './terrain.js';

export const PLAZA_RADIUS = 9;
export const ROAD_HALF_WIDTH = 2.2;
export const ROAD_LENGTH = 48;
export const WALL_RADIUS = 45;
export const PAD = { x: 20, z: -20, r: 7 };

/**
 * Footprint half-sizes [halfWidth (x), halfLength (z)] in metres, in the prop's own frame.
 * Used to build circle colliders along the long axis.
 */
const FOOTPRINT = {
  dome: [3.8, 3.8],
  greenhouse: [3, 7],
  lab: [3.6, 2.4],
  tanks: [2, 0.9],
  tower: [1.5, 1.5],
  control: [3, 3],
  bunker: [2.6, 2],
  container: [3, 1.3],
  rover: [1.3, 2.2],
  fuel: [2.8, 1.4],
  panels: [3.6, 0.9],
  wall: [3.2, 0.4],
  pad: [0, 0],
  lamp: [0, 0],
  marks: [0, 0],
  console: [0, 0],
};

/** Local tangent frame at the colony: east, north and up unit vectors. */
export function colonyFrame(baseDir) {
  const up = baseDir;
  const n0 = [0 - up[0] * up[1], 1 - up[1] * up[1], 0 - up[2] * up[1]];
  const north = norm(n0);
  const east = norm(cross(north, up));
  return { up, north, east };
}

/** Maps colony coordinates (x east, z north, in metres along the surface) to a unit direction. */
export function localToDir(frame, x, z) {
  const d = Math.hypot(x, z);
  if (d < 1e-6) return [...frame.up];
  const t = norm([frame.east[0] * x + frame.north[0] * z, frame.east[1] * x + frame.north[1] * z, frame.east[2] * x + frame.north[2] * z]);
  const a = d / R;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return norm([frame.up[0] * c + t[0] * s, frame.up[1] * c + t[1] * s, frame.up[2] * c + t[2] * s]);
}

/** Inverse of localToDir, for a unit direction near the colony. */
export function dirToLocal(frame, dir) {
  const a = Math.acos(Math.min(1, dot(dir, frame.up)));
  const tx = dot(dir, frame.east);
  const tz = dot(dir, frame.north);
  const l = Math.hypot(tx, tz) || 1;
  return [(tx / l) * a * R, (tz / l) * a * R];
}

/** Tangent "forward" at `dir` for a prop rotated `yaw` radians from north toward east. */
function forwardAt(frame, dir, yaw) {
  const f = [
    frame.north[0] * Math.cos(yaw) + frame.east[0] * Math.sin(yaw),
    frame.north[1] * Math.cos(yaw) + frame.east[1] * Math.sin(yaw),
    frame.north[2] * Math.cos(yaw) + frame.east[2] * Math.sin(yaw),
  ];
  const k = dot(f, dir);
  return norm([f[0] - dir[0] * k, f[1] - dir[1] * k, f[2] - dir[2] * k]);
}

/**
 * What the ground is at colony coordinates: 'plaza', 'road', 'pad' or null. The terrain
 * painter uses it to lay concrete; `line` is true on painted road markings.
 */
export function groundMarking(x, z) {
  const d = Math.hypot(x, z);
  if (d < PLAZA_RADIUS) return { kind: 'plaza', line: Math.abs(d - PLAZA_RADIUS + 0.8) < 0.25 };
  if (Math.hypot(x - PAD.x, z - PAD.z) < PAD.r + 1) return { kind: 'pad', line: false };
  if (d < ROAD_LENGTH) {
    if (Math.abs(x) < ROAD_HALF_WIDTH) return { kind: 'road', line: Math.abs(x) < 0.12 && Math.floor(z / 2) % 2 === 0 };
    if (Math.abs(z) < ROAD_HALF_WIDTH) return { kind: 'road', line: Math.abs(z) < 0.12 && Math.floor(x / 2) % 2 === 0 };
  }
  return null;
}

export function createRuins(seed, baseDir) {
  const rand = mulberry32(seed ^ 0xa2e5);
  const frame = colonyFrame(baseDir);
  const items = [];
  const put = (kind, x, z, yawDeg = 0, extra = {}) => {
    const dir = localToDir(frame, x, z);
    const yaw = (yawDeg * Math.PI) / 180;
    items.push({
      kind,
      x,
      z,
      dir,
      fwd: forwardAt(frame, dir, yaw),
      yaw,
      broken: extra.broken ?? rand() < 0.3,
      seed: Math.floor(rand() * 1e6),
      ...extra,
    });
  };

  // ---- Research district (north-east) ----
  put('lab', 15, 15, 0, { sign: 0, broken: false });
  put('lab', 27, 15, 0, { sign: 2 });
  put('tanks', 14, 24.5, 0, { broken: true });
  put('tanks', 20, 24.5, 0, { broken: false });
  put('lab', 26, 27, 0, { sign: 1, broken: true });

  // ---- Habitation district (north-west) ----
  put('dome', -13, 14, 0, { broken: false });
  put('dome', -24, 13, 0);
  put('dome', -13, 25, 0, { broken: true });
  put('greenhouse', -25, 26, 0);

  // ---- Landing district (south-east) ----
  put('pad', PAD.x, PAD.z, 0);
  put('control', 32, -9, -90, { broken: false });
  put('fuel', 9, -31, 0);
  put('fuel', 17, -33, 0, { broken: true });

  // ---- Industrial district (south-west) ----
  for (const [x, z] of [[-13, -12], [-13, -18.5], [-22, -12], [-22, -18.5]]) put('container', x, z, 90);
  put('rover', -30, -12, 90);
  put('rover', -30, -18, 90, { broken: true });
  for (const x of [-12, -20, -28]) put('panels', x, -27, 0);
  put('tower', -7, -34, 0, { broken: false });

  // ---- Plaza: shelter bunker where the survivors hide, and their work consoles ----
  put('bunker', -8, -6, 45, { broken: false });
  put('console', 5.5, 5.5, -135, { broken: false });
  put('console', -6, 5, 135, { broken: false });

  // ---- Street lamps along the four roads ----
  for (let d = 13; d <= 37; d += 8) {
    put('lamp', 3.3, d, -90);
    put('lamp', -3.3, -d, 90);
    put('lamp', d, -3.3, 0);
    put('lamp', -d, 3.3, 180);
  }

  // ---- Perimeter wall with a gate on each road and a few breaches ----
  for (let a = 0; a < 360; a += 9) {
    const gate = [0, 90, 180, 270].some((g) => Math.abs(((a - g + 540) % 360) - 180) < 8);
    if (gate || rand() < 0.14) continue;
    const r = (a * Math.PI) / 180;
    put('wall', Math.sin(r) * WALL_RADIUS, Math.cos(r) * WALL_RADIUS, a + 90);
  }

  // ---- Abandoned outposts elsewhere on the planet: a lab with containers in a row ----
  for (let s = 0; s < 8; s++) {
    let center = randomDir(rand);
    for (let k = 0; k < 5 && dist(center, baseDir) * R < 70; k++) center = randomDir(rand);
    const f = colonyFrame(center);
    const yaw = rand() * Math.PI * 2;
    const at = (x, z) => {
      const rx = x * Math.cos(yaw) - z * Math.sin(yaw);
      const rz = x * Math.sin(yaw) + z * Math.cos(yaw);
      return localToDir(f, rx, rz);
    };
    const layout = [
      ['lab', 0, 0, 0],
      ['container', 7, 1, 90],
      ['container', 7, -4, 90],
      [rand() < 0.5 ? 'tanks' : 'rover', -7, 0, 0],
      ['lamp', 3, 4, 0],
    ];
    for (const [kind, x, z, deg] of layout) {
      const dir = at(x, z);
      const y = yaw + (deg * Math.PI) / 180;
      items.push({ kind, x: null, z: null, dir, fwd: forwardAt(f, dir, y), yaw: y, broken: rand() < 0.6, seed: Math.floor(rand() * 1e6), sign: 1 });
    }
  }
  return items;
}

/** Circle colliders along each prop's long axis. */
export function ruinColliders(items) {
  const out = [];
  for (const it of items) {
    const [hw, hl] = FOOTPRINT[it.kind];
    if (!hw) continue;
    const r = Math.min(hw, hl);
    const long = hw > hl ? 'x' : 'z';
    const half = Math.max(hw, hl) - r;
    // Axis vectors in world space: fwd is +z, right = up × fwd is +x.
    const right = norm(cross(it.dir, it.fwd));
    const axis = long === 'z' ? it.fwd : right;
    const steps = Math.max(0, Math.ceil(half / r));
    for (let i = -steps; i <= steps; i++) {
      const off = steps ? (i / steps) * half : 0;
      out.push({ dir: norm(it.dir.map((v, k) => v + (axis[k] * off) / R)), r });
    }
  }
  return out;
}
