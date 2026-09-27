// The Ares colony: habitat domes, greenhouse, labs with specimen tanks, landing pad,
// control tower, fuel tanks, containers, rovers, solar arrays, perimeter wall and lamps.
// Everything is static, so meshes are merged per material into a handful of draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../sim/noise.js';
import { TEX, triplanar } from './materials.js';

const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.15, ...extra });

const M = {
  concrete: triplanar(std(0x9a928a, { roughness: 0.95 }), TEX.concrete, 0.25),
  hull: triplanar(std(0xd6d8da, { roughness: 0.5, metalness: 0.3, side: THREE.DoubleSide }), TEX.panels, 0.3),
  hullDirty: triplanar(std(0xa89c90, { roughness: 0.75, metalness: 0.2 }), TEX.panels, 0.3),
  dark: triplanar(std(0x33373d, { metalness: 0.55, roughness: 0.5 }), TEX.panels, 0.4, 0.6),
  metal: std(0x80878f, { metalness: 0.8, roughness: 0.35 }),
  rust: std(0x6e3a24, { roughness: 0.9 }),
  hazard: std(0xe0a22e, { roughness: 0.6 }),
  containerA: triplanar(std(0xa4532e, { roughness: 0.8, metalness: 0.3 }), TEX.corrugated, 0.5),
  containerB: triplanar(std(0x2f5d8a, { roughness: 0.8, metalness: 0.3 }), TEX.corrugated, 0.5),
  containerC: triplanar(std(0xc9c4b8, { roughness: 0.8, metalness: 0.3 }), TEX.corrugated, 0.5),
  containerD: triplanar(std(0x3f6b4a, { roughness: 0.8, metalness: 0.3 }), TEX.corrugated, 0.5),
  panel: std(0x14234a, { emissive: 0x1a3a8a, emissiveIntensity: 0.2, metalness: 0.85, roughness: 0.2 }),
  glass: new THREE.MeshPhysicalMaterial({ color: 0xbfeaff, roughness: 0.05, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }),
  greenGlass: new THREE.MeshPhysicalMaterial({ color: 0x9fdca0, roughness: 0.1, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide }),
  plants: std(0x3f7a34, { roughness: 0.9, flatShading: true }),
  deadPlants: std(0x5a4a2a, { roughness: 0.95, flatShading: true }),
  liquid: std(0x5fcf4a, { emissive: 0x3dff2a, emissiveIntensity: 1, transparent: true, opacity: 0.8 }),
  specimen: std(0x16201a, { roughness: 0.4 }),
  puddle: std(0x5aff3a, { emissive: 0x3dff2a, emissiveIntensity: 1.4, roughness: 0.1 }),
  window: std(0xffe7b0, { emissive: 0xffc870, emissiveIntensity: 2.4 }),
  screen: std(0x6fd8ff, { emissive: 0x3ab8ff, emissiveIntensity: 2.6 }),
  lamp: std(0xfff0c8, { emissive: 0xffd08a, emissiveIntensity: 4 }),
  lampFlicker: std(0xfff0c8, { emissive: 0xffd08a, emissiveIntensity: 4 }),
  towerLight: std(0xff3a2a, { emissive: 0xff2a1a, emissiveIntensity: 6 }),
  padLight: std(0x7cf7d4, { emissive: 0x3dffc0, emissiveIntensity: 3 }),
  visor: std(0x0e141c, { metalness: 0.9, roughness: 0.15 }),
};
const CONTAINERS = [M.containerA, M.containerB, M.containerC, M.containerD];

const unit = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 18),
  cyl6: new THREE.CylinderGeometry(0.5, 0.5, 1, 6),
  sphere: new THREE.SphereGeometry(0.5, 14, 10),
  capsule: new THREE.CapsuleGeometry(0.35, 1, 4, 8),
  disc: new THREE.CircleGeometry(1, 28),
  ico: new THREE.IcosahedronGeometry(0.5, 0),
};

function labelMaterial(draw, w = 512, h = 128, glow = 0.6) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: glow, roughness: 0.6, transparent: true });
}

const SIGNS = [
  ['LAB-07', 'XENOBIOLOGY · SEALED'],
  ['LAB-03', 'SENTINEL RELAY · NO ENTRY'],
  ['LAB-11', 'SPECIMEN CONTAINMENT'],
];
const signMats = SIGNS.map(([title, sub]) =>
  labelMaterial((ctx, w, h) => {
    ctx.fillStyle = '#0c1116';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#e0a22e';
    ctx.lineWidth = 6;
    ctx.strokeRect(6, 6, w - 12, h - 12);
    ctx.fillStyle = '#e6edf3';
    ctx.font = '700 58px "Chakra Petch", system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(title, 26, 52);
    ctx.fillStyle = '#e0a22e';
    ctx.font = '600 26px "Chakra Petch", system-ui, sans-serif';
    ctx.fillText(sub, 28, 100);
  }),
);
const padMat = labelMaterial(
  (ctx, w) => {
    ctx.clearRect(0, 0, w, w);
    ctx.strokeStyle = 'rgba(240,240,240,0.85)';
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.arc(w / 2, w / 2, w / 2 - 20, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(224,162,46,0.9)';
    ctx.lineWidth = 8;
    ctx.setLineDash([30, 22]);
    ctx.beginPath();
    ctx.arc(w / 2, w / 2, w / 2 - 50, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(240,240,240,0.9)';
    ctx.font = '700 260px "Chakra Petch", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('H', w / 2, w / 2 + 10);
    ctx.font = '700 44px "Chakra Petch", system-ui, sans-serif';
    ctx.fillText('ARES · EVAC 1', w / 2, w / 2 + 170);
  },
  512,
  512,
  0.25,
);
const bunkerSign = labelMaterial((ctx, w, h) => {
  ctx.fillStyle = '#e0a22e';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#111';
  ctx.font = '700 54px "Chakra Petch", system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText('SHELTER B-1', 24, 50);
  ctx.font = '600 26px "Chakra Petch", system-ui, sans-serif';
  ctx.fillText('SURVIVORS INSIDE · 214', 26, 100);
});

/** Adds a scaled, positioned, optionally rotated primitive to a prop group. */
function add(group, g, m, s, p, r = [0, 0, 0]) {
  const o = new THREE.Mesh(g, m);
  o.scale.set(...s);
  o.position.set(...p);
  o.rotation.set(...r);
  group.add(o);
  return o;
}

const props = {
  dome(g, rand, it) {
    add(g, unit.cyl, M.concrete, [7.6, 0.5, 7.6], [0, 0.1, 0]);
    const arc = it.broken ? Math.PI * 2 * 0.72 : Math.PI * 2;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(3.4, 28, 12, 0, arc, 0, Math.PI / 2), M.hull);
    dome.position.y = 0.3;
    g.add(dome);
    for (let i = 0; i < 6; i++) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(3.45, 0.07, 6, 28, Math.PI), M.metal);
      rib.position.y = 0.3;
      rib.rotation.y = (i / 6) * Math.PI;
      g.add(rib);
    }
    add(g, unit.box, M.hullDirty, [1.8, 2.1, 1.8], [0, 1.05, 3.7]);
    add(g, unit.box, M.dark, [1, 1.7, 0.1], [0, 0.95, 4.62]);
    add(g, unit.box, M.hazard, [1.2, 0.12, 0.12], [0, 1.9, 4.64]);
    add(g, unit.box, M.window, [2.8, 0.2, 0.05], [0, 2.1, 3.0], [-0.5, 0, 0]);
    if (it.broken) {
      for (let i = 0; i < 7; i++) {
        add(g, unit.box, M.hull, [0.6 + rand(), 0.05, 0.4 + rand()], [2 + rand() * 2.5, 0.2, -2 + rand() * 2], [rand(), rand() * 3, rand()]);
      }
    }
  },
  greenhouse(g, rand) {
    add(g, unit.box, M.concrete, [6.2, 0.4, 14.2], [0, 0.2, 0]);
    const tunnel = new THREE.Mesh(new THREE.CylinderGeometry(2.9, 2.9, 13.6, 20, 1, true, -Math.PI / 2, Math.PI), M.greenGlass);
    tunnel.rotation.x = Math.PI / 2;
    tunnel.position.y = 0.4;
    g.add(tunnel);
    for (let z = -6.5; z <= 6.5; z += 1.625) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(2.92, 0.06, 6, 20, Math.PI), M.metal);
      rib.position.set(0, 0.4, z);
      g.add(rib);
    }
    for (const x of [-1.4, 1.4]) {
      add(g, unit.box, M.dark, [1.1, 0.5, 12.5], [x, 0.65, 0]);
      for (let z = -5.8; z <= 5.8; z += 0.9) {
        add(g, unit.ico, rand() < 0.35 ? M.plants : M.deadPlants, [0.5 + rand() * 0.4, 0.4 + rand() * 0.5, 0.5], [x + (rand() - 0.5) * 0.4, 1.05, z]);
      }
    }
    add(g, unit.box, M.hullDirty, [2.2, 2.4, 1.2], [0, 1.2, 7.4]);
  },
  lab(g, rand, it) {
    add(g, unit.box, M.concrete, [7.8, 0.3, 5.4], [0, 0.15, 0]);
    add(g, unit.box, M.hull, [7, 3.2, 4.6], [0, 1.9, 0]);
    add(g, unit.box, M.dark, [7.2, 0.35, 4.8], [0, 3.6, 0]);
    for (const z of [-2.31, 2.31]) add(g, unit.box, M.window, [5.4, 0.45, 0.05], [0, 2.4, z]);
    add(g, unit.box, M.dark, [1.3, 2.2, 0.1], [2.5, 1.4, 2.32]);
    add(g, unit.box, M.hazard, [1.5, 0.15, 0.12], [2.5, 2.6, 2.33]);
    add(g, unit.cyl, M.metal, [0.12, 3, 0.12], [-2.8, 5.1, -1.5]);
    add(g, unit.cyl, M.metal, [0.08, 2, 0.08], [-2.3, 4.6, -1.8]);
    const dish = new THREE.Mesh(new THREE.SphereGeometry(0.8, 14, 6, 0, Math.PI * 2, 0, 1.1), M.hull);
    dish.position.set(2, 4.3, -1.2);
    dish.rotation.x = -0.8;
    g.add(dish);
    add(g, unit.box, M.metal, [1.6, 0.8, 1.2], [-1, 4.2, 0.8]);
    for (const x of [-3.2, 3.2]) add(g, unit.cyl, M.metal, [0.25, 3.4, 0.25], [x, 1.8, -2.4]);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.8), signMats[(it.sign ?? it.seed) % signMats.length]);
    sign.position.set(-1.2, 3.05, 2.33);
    g.add(sign);
    if (it.broken) {
      add(g, unit.box, M.dark, [3.2, 0.3, 4.9], [2.2, 3.1, 0], [0, 0, 0.35]);
      for (let i = 0; i < 5; i++) {
        add(g, unit.box, M.concrete, [0.4 + rand(), 0.3 + rand() * 0.5, 0.4 + rand()], [4 + rand() * 1.5, 0.3, -2 + rand() * 4], [rand(), rand(), rand()]);
      }
    }
  },
  tanks(g, rand, it) {
    add(g, unit.box, M.dark, [3.9, 0.25, 1.7], [0, 0.12, 0]);
    for (let i = 0; i < 3; i++) {
      const x = (i - 1) * 1.25;
      const shattered = it.broken && i === 1;
      add(g, unit.cyl, M.metal, [1.05, 0.3, 1.05], [x, 0.4, 0]);
      add(g, unit.cyl, M.metal, [1.05, 0.25, 1.05], [x, 2.8, 0]);
      if (!shattered) {
        const fill = 0.6 + rand() * 0.35;
        add(g, unit.cyl, M.liquid, [0.9, 2.2 * fill, 0.9], [x, 0.55 + 1.1 * fill, 0]);
        add(g, unit.capsule, M.specimen, [0.5, 0.7, 0.5], [x, 1.5, 0], [0.2, rand(), 0.15]);
        add(g, unit.cyl, M.glass, [1, 2.3, 1], [x, 1.65, 0]);
      } else {
        add(g, unit.disc, M.puddle, [1.4, 1.2, 1], [x + 0.4, 0.27, 0.9], [-Math.PI / 2, 0, 0]);
        add(g, unit.capsule, M.specimen, [0.5, 0.7, 0.5], [x + 0.6, 0.45, 1.1], [Math.PI / 2, 0.6, 0]);
      }
      add(g, unit.cyl6, M.metal, [0.14, 1.5, 0.14], [x, 3.5, -0.3], [0.5, 0, 0]);
    }
  },
  tower(g) {
    const h = 15;
    for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      add(g, unit.box, M.metal, [0.16, h, 0.16], [x * 0.8, h / 2, z * 0.8], [z * 0.06, 0, -x * 0.06]);
    }
    for (let y = 1.5; y < h; y += 2) {
      const w = 1.6 - (y / h) * 0.8;
      add(g, unit.box, M.metal, [w * 1.9, 0.08, 0.08], [0, y, w * 0.95]);
      add(g, unit.box, M.metal, [w * 1.9, 0.08, 0.08], [0, y, -w * 0.95]);
      add(g, unit.box, M.metal, [0.08, 0.08, w * 1.9], [w * 0.95, y, 0]);
      add(g, unit.box, M.metal, [0.08, 0.08, w * 1.9], [-w * 0.95, y, 0]);
    }
    const dish = new THREE.Mesh(new THREE.SphereGeometry(1.6, 16, 6, 0, Math.PI * 2, 0, 1.1), M.hull);
    dish.position.set(0, h - 1.5, 0.7);
    dish.rotation.x = -1;
    g.add(dish);
    add(g, unit.sphere, M.towerLight, [0.35, 0.35, 0.35], [0, h + 0.3, 0]);
    add(g, unit.box, M.dark, [2.4, 1.8, 2.4], [0, 0.9, 0]);
  },
  control(g) {
    add(g, unit.box, M.concrete, [6.2, 0.3, 6.2], [0, 0.15, 0]);
    add(g, unit.box, M.hullDirty, [5.2, 3, 5.2], [0, 1.8, 0]);
    add(g, unit.box, M.dark, [5.6, 0.3, 5.6], [0, 3.4, 0]);
    add(g, unit.cyl, M.hull, [3.2, 2.2, 3.2], [0, 4.6, 0]);
    add(g, unit.cyl, M.window, [3.25, 0.7, 3.25], [0, 4.8, 0]);
    add(g, unit.cyl, M.dark, [3.6, 0.25, 3.6], [0, 5.8, 0]);
    add(g, unit.cyl6, M.metal, [0.1, 3, 0.1], [0.8, 7.3, 0]);
    add(g, unit.sphere, M.towerLight, [0.25, 0.25, 0.25], [0.8, 8.9, 0]);
    add(g, unit.box, M.dark, [1.3, 2.2, 0.1], [0, 1.4, 2.62]);
  },
  bunker(g) {
    add(g, unit.box, M.concrete, [5.4, 2.4, 4.2], [0, 1.2, 0]);
    add(g, unit.box, M.concrete, [5.8, 0.4, 4.6], [0, 2.6, 0]);
    add(g, unit.box, M.dark, [2.2, 1.9, 0.15], [0, 1, 2.1]);
    add(g, unit.box, M.hazard, [2.6, 0.18, 0.2], [0, 2.1, 2.12]);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6), bunkerSign);
    sign.position.set(0, 2.55, 2.32);
    g.add(sign);
    for (const x of [-2.4, 2.4]) add(g, unit.box, M.window, [0.12, 0.12, 0.12], [x, 2.2, 2.12]);
    add(g, unit.cyl, M.metal, [0.4, 1.2, 0.4], [1.8, 3.2, -1]);
  },
  console(g) {
    add(g, unit.box, M.dark, [1.4, 1, 0.6], [0, 0.5, 0]);
    add(g, unit.box, M.screen, [1.2, 0.6, 0.05], [0, 1.35, -0.1], [-0.35, 0, 0]);
    add(g, unit.box, M.metal, [0.08, 0.5, 0.08], [0, 1.05, -0.2]);
  },
  pad(g) {
    add(g, unit.cyl, M.concrete, [15, 0.3, 15], [0, 0.12, 0]);
    const marks = new THREE.Mesh(new THREE.PlaneGeometry(13.4, 13.4), padMat);
    marks.rotation.x = -Math.PI / 2;
    marks.position.y = 0.29;
    g.add(marks);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      add(g, unit.cyl, M.padLight, [0.25, 0.12, 0.25], [Math.cos(a) * 7.2, 0.3, Math.sin(a) * 7.2]);
    }
  },
  fuel(g, rand, it) {
    add(g, unit.box, M.concrete, [5.8, 0.3, 3], [0, 0.15, 0]);
    for (const x of [-1.4, 1.4]) {
      const tank = add(g, unit.capsule, M.hull, [1.6, 1.3, 1.6], [x, 1.35, 0], [0, 0, Math.PI / 2]);
      if (it.broken && x > 0) tank.rotation.set(0.3, 0.4, Math.PI / 2 + 0.2);
      for (const z of [-0.7, 0.7]) add(g, unit.box, M.dark, [0.2, 0.9, 0.2], [x, 0.5, z]);
    }
    add(g, unit.box, M.hazard, [5.4, 0.1, 0.1], [0, 2.2, 0]);
  },
  container(g, rand, it) {
    const m = CONTAINERS[it.seed % CONTAINERS.length];
    const tilt = it.broken ? (rand() - 0.5) * 0.3 : 0;
    add(g, unit.box, m, [2.4, 2.5, 5.8], [0, 1.25, 0], [0, 0, tilt]);
    add(g, unit.box, M.dark, [2.45, 0.12, 5.85], [0, 0.06, 0]);
    if (it.seed % 3 === 0) {
      add(g, unit.box, CONTAINERS[(it.seed + 1) % CONTAINERS.length], [2.4, 2.5, 5.8], [0.15, 3.75, 0.2], [0, 0.06, 0]);
    }
    if (it.broken) add(g, unit.box, m, [2.3, 0.08, 2.3], [1.3, 1.2, 2.9], [0, 0, 1.3]);
  },
  rover(g, rand, it) {
    const body = new THREE.Group();
    add(body, unit.box, M.hullDirty, [2.4, 0.7, 4.2], [0, 1.1, 0]);
    add(body, unit.box, M.hull, [2.2, 1.1, 1.8], [0, 1.9, 0.8]);
    add(body, unit.box, M.visor, [2.1, 0.55, 0.06], [0, 2.05, 1.72], [-0.3, 0, 0]);
    add(body, unit.cyl6, M.metal, [0.06, 1.6, 0.06], [-0.8, 3.1, -0.4]);
    add(body, unit.box, M.hazard, [2.42, 0.12, 0.6], [0, 1.45, -1.9]);
    for (const z of [-1.4, 0, 1.4]) {
      for (const x of [-1.35, 1.35]) add(body, unit.cyl, M.dark, [0.9, 0.45, 0.9], [x, 0.45, z], [0, 0, Math.PI / 2]);
    }
    if (it.broken) body.rotation.set(0.1, 0, 0.3);
    g.add(body);
  },
  lamp(g, rand, it) {
    add(g, unit.cyl6, M.dark, [0.35, 0.3, 0.35], [0, 0.15, 0]);
    add(g, unit.cyl6, M.metal, [0.12, 4.4, 0.12], [0, 2.3, 0]);
    add(g, unit.box, M.metal, [0.1, 0.1, 1.2], [0, 4.4, 0.55]);
    add(g, unit.box, it.broken ? M.lampFlicker : M.lamp, [0.45, 0.14, 0.55], [0, 4.3, 1.1]);
  },
  panels(g, rand, it) {
    for (let i = 0; i < 3; i++) {
      const x = (i - 1) * 2.4;
      const fallen = it.broken && i === 2;
      add(g, unit.cyl6, M.metal, [0.1, 1.2, 0.1], [x, 0.6, 0]);
      add(g, unit.box, M.panel, [2.1, 0.06, 1.4], fallen ? [x + 0.5, 0.2, 0.6] : [x, 1.25, 0], fallen ? [0.2, 0.4, 0.1] : [-0.55, 0, 0]);
      add(g, unit.box, M.metal, [2.15, 0.04, 0.06], fallen ? [x + 0.5, 0.25, 0.6] : [x, 1.3, -0.62], fallen ? [0.2, 0.4, 0.1] : [-0.55, 0, 0]);
    }
  },
  wall(g, rand, it) {
    const h = it.broken ? 1 + rand() * 1.2 : 2.6;
    add(g, unit.box, M.concrete, [6.6, h, 0.7], [0, h / 2, 0], [0, 0, it.broken ? (rand() - 0.5) * 0.1 : 0]);
    add(g, unit.box, M.concrete, [7, 0.25, 1], [0, 0.12, 0]);
    if (!it.broken) {
      add(g, unit.box, M.hazard, [6.6, 0.15, 0.72], [0, 2.1, 0]);
      for (const x of [-3.1, 3.1]) add(g, unit.box, M.dark, [0.35, 3.1, 0.9], [x, 1.55, 0]);
    }
  },
};

const UP = new THREE.Vector3(0, 1, 0);

export class RuinsView {
  constructor(scene) {
    this.scene = scene;
    this.group = null;
    this.lights = [];
  }

  build(world) {
    if (this.group) {
      this.scene.remove(this.group);
      this.group.traverse((o) => o.geometry?.dispose());
    }
    for (const l of this.lights) this.scene.remove(l);
    this.lights = [];

    const temp = new THREE.Group();
    const up = new THREE.Vector3();
    const fwd = new THREE.Vector3();
    const right = new THREE.Vector3();
    const basis = new THREE.Matrix4();
    for (const it of world.ruins) {
      const g = new THREE.Group();
      props[it.kind](g, mulberry32(it.seed), it);
      up.set(...it.dir);
      fwd.set(...it.fwd);
      right.crossVectors(up, fwd).normalize();
      basis.makeBasis(right, up, fwd);
      g.quaternion.setFromRotationMatrix(basis);
      g.position.copy(up).multiplyScalar(world.terrain.surfaceRadius(it.dir) - 0.12);
      temp.add(g);
    }
    temp.updateMatrixWorld(true);

    // Merge every static mesh that shares a material into one draw call.
    const buckets = new Map();
    temp.traverse((o) => {
      if (!o.isMesh) return;
      const geom = o.geometry.clone();
      geom.applyMatrix4(o.matrixWorld);
      if (!buckets.has(o.material.uuid)) buckets.set(o.material.uuid, { material: o.material, geoms: [] });
      buckets.get(o.material.uuid).geoms.push(geom);
    });
    this.group = new THREE.Group();
    const glowing = new Set([M.window, M.lamp, M.lampFlicker, M.towerLight, M.screen, M.padLight]);
    for (const { material, geoms } of buckets.values()) {
      const merged = mergeGeometries(geoms, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = !material.transparent && !glowing.has(material);
      mesh.receiveShadow = !material.transparent;
      this.group.add(mesh);
    }
    this.scene.add(this.group);

    // Real lights on the main roads so the colony glows at night.
    const lamps = world.ruins.filter((it) => it.kind === 'lamp' && it.x !== null && Math.hypot(it.x, it.z) < 22).slice(0, 6);
    for (const it of lamps) {
      const light = new THREE.PointLight(0xffc98a, 0, 18, 1.4);
      up.set(...it.dir);
      light.position.copy(up).multiplyScalar(world.terrain.surfaceRadius(it.dir) + 4.2);
      this.scene.add(light);
      this.lights.push(light);
    }
    void UP;
  }

  /** Flickering windows and lamps, a blinking tower beacon, pulsing tanks and landing lights. */
  update(t, night) {
    const flick = (k) => (Math.sin(t * 23 + k) * Math.sin(t * 7.3 + k * 2) > 0.55 ? 0.15 : 1);
    M.window.emissiveIntensity = 2.4 * (0.85 + 0.15 * Math.sin(t * 3)) * flick(1);
    M.lampFlicker.emissiveIntensity = 4 * flick(4) * (Math.sin(t * 1.3) > -0.7 ? 1 : 0.1);
    M.towerLight.emissiveIntensity = Math.sin(t * 3) > 0.3 ? 7 : 0.3;
    M.liquid.emissiveIntensity = 0.9 + Math.sin(t * 1.7) * 0.3;
    M.screen.emissiveIntensity = 2.2 + Math.sin(t * 9) * 0.3;
    M.padLight.emissiveIntensity = 1.5 + (Math.sin(t * 4) > 0 ? 2.5 : 0);
    for (const l of this.lights) l.intensity = night * 16;
  }
}
