// The abandoned Ares colony: habitat domes, experiment labs with specimen tanks,
// a comms tower, cargo containers, wrecked rovers, lamps and solar arrays.
// Everything is static, so meshes are merged per material into a handful of draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../sim/noise.js';

const UP = new THREE.Vector3(0, 1, 0);
const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.15, ...extra });

const M = {
  concrete: std(0x8a817a, { roughness: 0.95 }),
  hull: std(0xcfd2d4, { roughness: 0.55, side: THREE.DoubleSide }),
  hullDirty: std(0x9c948c, { roughness: 0.8 }),
  dark: std(0x2b2f35, { metalness: 0.5, roughness: 0.55 }),
  metal: std(0x7f868f, { metalness: 0.7, roughness: 0.4 }),
  rust: std(0x7a3f26, { roughness: 0.9 }),
  hazard: std(0xe0a22e, { roughness: 0.6 }),
  containerA: std(0xa4532e, { roughness: 0.85 }),
  containerB: std(0x2f5d8a, { roughness: 0.85 }),
  containerC: std(0xc9c4b8, { roughness: 0.85 }),
  containerD: std(0x3f6b4a, { roughness: 0.85 }),
  panel: std(0x14234a, { emissive: 0x1a3a8a, emissiveIntensity: 0.25, metalness: 0.8, roughness: 0.25 }),
  glass: new THREE.MeshPhysicalMaterial({ color: 0xbfeaff, roughness: 0.05, transparent: true, opacity: 0.25, depthWrite: false }),
  liquid: std(0x5fcf4a, { emissive: 0x3dff2a, emissiveIntensity: 1, transparent: true, opacity: 0.8 }),
  specimen: std(0x16201a, { roughness: 0.4 }),
  puddle: std(0x5aff3a, { emissive: 0x3dff2a, emissiveIntensity: 1.6, roughness: 0.1 }),
  window: std(0xffe7b0, { emissive: 0xffc870, emissiveIntensity: 2.4 }),
  lamp: std(0xfff0c8, { emissive: 0xffd08a, emissiveIntensity: 4 }),
  lampFlicker: std(0xfff0c8, { emissive: 0xffd08a, emissiveIntensity: 4 }),
  towerLight: std(0xff3a2a, { emissive: 0xff2a1a, emissiveIntensity: 6 }),
  visor: std(0x0e141c, { metalness: 0.9, roughness: 0.15 }),
};
const CONTAINERS = [M.containerA, M.containerB, M.containerC, M.containerD];

const unit = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 14),
  cyl6: new THREE.CylinderGeometry(0.5, 0.5, 1, 6),
  sphere: new THREE.SphereGeometry(0.5, 12, 8),
  capsule: new THREE.CapsuleGeometry(0.35, 1, 4, 8),
  disc: new THREE.CircleGeometry(1, 20),
};

function signMaterial(text, sub) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0c1116';
  ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = '#e0a22e';
  ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, 500, 116);
  ctx.fillStyle = '#e6edf3';
  ctx.font = '700 58px "Chakra Petch", system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 26, 52);
  ctx.fillStyle = '#e0a22e';
  ctx.font = '600 26px "Chakra Petch", system-ui, sans-serif';
  ctx.fillText(sub, 28, 100);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.6, roughness: 0.6 });
}

const SIGNS = [
  ['LAB-07', 'XENOBIOLOGY · SEALED'],
  ['LAB-03', 'SENTINEL RELAY · NO ENTRY'],
  ['LAB-11', 'SPECIMEN CONTAINMENT'],
  ['HAB-A', 'ARES COLONY · AURORA INIT.'],
];

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
    add(g, unit.cyl, M.concrete, [7.4, 0.5, 7.4], [0, 0.1, 0]);
    const arc = it.broken ? Math.PI * 2 * 0.72 : Math.PI * 2;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(3.4, 22, 10, 0, arc, 0, Math.PI / 2), M.hull);
    dome.position.y = 0.3;
    g.add(dome);
    for (let i = 0; i < 4; i++) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(3.45, 0.07, 6, 24, Math.PI), M.metal);
      rib.position.y = 0.3;
      rib.rotation.y = (i / 4) * Math.PI;
      g.add(rib);
    }
    add(g, unit.box, M.hullDirty, [1.6, 2, 1.6], [0, 1, 3.6]);
    add(g, unit.box, M.dark, [0.9, 1.6, 0.1], [0, 0.9, 4.42]);
    add(g, unit.box, M.window, [2.6, 0.18, 0.05], [0, 1.9, 3.1], [-0.5, 0, 0]);
    if (it.broken) {
      for (let i = 0; i < 6; i++) {
        add(g, unit.box, M.hull, [0.6 + rand(), 0.05, 0.4 + rand()], [2 + rand() * 2.5, 0.2, -2 + rand() * 2], [rand(), rand() * 3, rand()]);
      }
    }
  },
  lab(g, rand, it) {
    add(g, unit.box, M.concrete, [7.6, 0.3, 5.2], [0, 0.15, 0]);
    add(g, unit.box, M.hull, [7, 3.2, 4.6], [0, 1.9, 0]);
    add(g, unit.box, M.dark, [7.2, 0.35, 4.8], [0, 3.6, 0]);
    for (const z of [-2.31, 2.31]) add(g, unit.box, M.window, [5.4, 0.45, 0.05], [0, 2.4, z]);
    add(g, unit.box, M.dark, [1.3, 2.2, 0.1], [2.5, 1.4, 2.32]);
    add(g, unit.box, M.hazard, [1.5, 0.15, 0.12], [2.5, 2.6, 2.33]);
    add(g, unit.cyl, M.metal, [0.12, 3, 0.12], [-2.8, 5.1, -1.5]);
    add(g, unit.cyl, M.metal, [0.08, 2, 0.08], [-2.3, 4.6, -1.8]);
    const dish = new THREE.Mesh(new THREE.SphereGeometry(0.8, 12, 6, 0, Math.PI * 2, 0, 1.1), M.hull);
    dish.position.set(2, 4.3, -1.2);
    dish.rotation.x = -0.8;
    g.add(dish);
    add(g, unit.box, M.metal, [1.6, 0.8, 1.2], [-1, 4.2, 0.8]);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.8), signMaterial(...SIGNS[it.seed % SIGNS.length]));
    sign.position.set(-1.2, 3.05, 2.33);
    g.add(sign);
    if (it.broken) {
      add(g, unit.box, M.dark, [3.2, 0.3, 4.9], [2.2, 3.1, 0], [0, 0, 0.35]);
      for (let i = 0; i < 5; i++) add(g, unit.box, M.concrete, [0.4 + rand(), 0.3 + rand() * 0.5, 0.4 + rand()], [4 + rand() * 1.5, 0.3, -2 + rand() * 4], [rand(), rand(), rand()]);
    }
  },
  tanks(g, rand, it) {
    add(g, unit.box, M.dark, [3.6, 0.25, 1.6], [0, 0.12, 0]);
    for (let i = 0; i < 3; i++) {
      const x = (i - 1) * 1.2;
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
    const h = 13;
    for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      add(g, unit.box, M.metal, [0.14, h, 0.14], [x * 0.7, h / 2, z * 0.7], [z * 0.06, 0, -x * 0.06]);
    }
    for (let y = 1.5; y < h; y += 2) {
      const w = 1.4 - (y / h) * 0.7;
      add(g, unit.box, M.metal, [w * 1.9, 0.08, 0.08], [0, y, w * 0.95]);
      add(g, unit.box, M.metal, [w * 1.9, 0.08, 0.08], [0, y, -w * 0.95]);
      add(g, unit.box, M.metal, [0.08, 0.08, w * 1.9], [w * 0.95, y, 0]);
      add(g, unit.box, M.metal, [0.08, 0.08, w * 1.9], [-w * 0.95, y, 0]);
    }
    const dish = new THREE.Mesh(new THREE.SphereGeometry(1.4, 14, 6, 0, Math.PI * 2, 0, 1.1), M.hull);
    dish.position.set(0, h - 1.5, 0.6);
    dish.rotation.x = -1;
    g.add(dish);
    add(g, unit.sphere, M.towerLight, [0.35, 0.35, 0.35], [0, h + 0.3, 0]);
    add(g, unit.box, M.dark, [2.2, 1.6, 2.2], [0, 0.8, 0]);
  },
  container(g, rand, it) {
    const m = CONTAINERS[it.seed % CONTAINERS.length];
    const tilt = it.broken ? (rand() - 0.5) * 0.4 : 0;
    add(g, unit.box, m, [2.4, 2.5, 5.8], [0, 1.25, 0], [0, 0, tilt]);
    for (let z = -2.4; z <= 2.4; z += 0.6) add(g, unit.box, M.rust, [2.44, 2.3, 0.08], [0, 1.25, z], [0, 0, tilt]);
    if (it.seed % 3 === 0) {
      const m2 = CONTAINERS[(it.seed + 1) % CONTAINERS.length];
      add(g, unit.box, m2, [2.4, 2.5, 5.8], [0.2, 3.75, 0.3], [0, 0.15, 0]);
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
    if (it.broken) body.rotation.set(0.12, 0, 0.35);
    g.add(body);
  },
  lamp(g, rand, it) {
    add(g, unit.cyl6, M.dark, [0.35, 0.3, 0.35], [0, 0.15, 0]);
    add(g, unit.cyl6, M.metal, [0.12, 4.2, 0.12], [0, 2.2, 0]);
    add(g, unit.box, M.metal, [0.1, 0.1, 1.1], [0, 4.2, 0.5]);
    add(g, unit.box, it.broken ? M.lampFlicker : M.lamp, [0.4, 0.14, 0.5], [0, 4.1, 1]);
  },
  panels(g, rand, it) {
    for (let i = 0; i < 3; i++) {
      const x = (i - 1) * 2.3;
      const fallen = it.broken && i === 2;
      add(g, unit.cyl6, M.metal, [0.1, 1.2, 0.1], [x, 0.6, 0]);
      add(g, unit.box, M.panel, [2, 0.06, 1.3], fallen ? [x + 0.5, 0.2, 0.6] : [x, 1.25, 0], fallen ? [0.2, 0.4, 0.1] : [-0.5, 0, 0]);
    }
  },
  wall(g, rand) {
    let x = -3;
    while (x < 3) {
      const len = 1 + rand() * 1.2;
      const h = 0.8 + rand() * 1.4;
      add(g, unit.box, M.concrete, [len, h, 0.5], [x + len / 2, h / 2, 0], [0, 0, (rand() - 0.5) * 0.15]);
      if (rand() < 0.5) add(g, unit.box, M.hazard, [len, 0.12, 0.52], [x + len / 2, h * 0.7, 0]);
      x += len + rand() * 0.8;
    }
  },
};

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
    const dir = new THREE.Vector3();
    const q = new THREE.Quaternion();
    for (const it of world.ruins) {
      const g = new THREE.Group();
      props[it.kind](g, mulberry32(it.seed), it);
      dir.set(...it.dir);
      g.position.copy(dir).multiplyScalar(world.terrain.surfaceRadius(it.dir) - 0.15);
      g.quaternion.setFromUnitVectors(UP, dir).multiply(q.setFromAxisAngle(UP, it.yaw));
      temp.add(g);
    }
    temp.updateMatrixWorld(true);

    // Merge every static mesh that shares a material into one draw call.
    const buckets = new Map();
    temp.traverse((o) => {
      if (!o.isMesh) return;
      const geom = o.geometry.index ? o.geometry.clone() : o.geometry.clone();
      geom.applyMatrix4(o.matrixWorld);
      const key = o.material.uuid;
      if (!buckets.has(key)) buckets.set(key, { material: o.material, geoms: [] });
      buckets.get(key).geoms.push(geom.index ? geom : geom);
    });
    this.group = new THREE.Group();
    for (const { material, geoms } of buckets.values()) {
      const indexed = geoms.filter((g) => g.index);
      const plain = geoms.filter((g) => !g.index);
      for (const set of [indexed, plain]) {
        if (!set.length) continue;
        const merged = mergeGeometries(set, false);
        if (!merged) continue;
        const mesh = new THREE.Mesh(merged, material);
        const glowing = material === M.window || material === M.lamp || material === M.lampFlicker || material === M.towerLight;
        mesh.castShadow = !material.transparent && !glowing;
        mesh.receiveShadow = !material.transparent;
        this.group.add(mesh);
      }
    }
    this.scene.add(this.group);

    // A few real lights around the colony so it glows at night.
    const near = world.ruins.filter((it) => it.kind === 'lamp' || it.kind === 'lab').slice(0, 5);
    for (const it of near) {
      const light = new THREE.PointLight(0xffc98a, 0, 16, 1.4);
      dir.set(...it.dir);
      light.position.copy(dir).multiplyScalar(world.terrain.surfaceRadius(it.dir) + 4);
      this.scene.add(light);
      this.lights.push(light);
    }
  }

  /** Flickering lab windows and lamps, a blinking tower beacon, pulsing specimen tanks. */
  update(t, night) {
    const flick = (k) => (Math.sin(t * 23 + k) * Math.sin(t * 7.3 + k * 2) > 0.55 ? 0.15 : 1);
    M.window.emissiveIntensity = 2.4 * (0.85 + 0.15 * Math.sin(t * 3)) * flick(1);
    M.lampFlicker.emissiveIntensity = 4 * flick(4) * (Math.sin(t * 1.3) > -0.7 ? 1 : 0.1);
    M.towerLight.emissiveIntensity = Math.sin(t * 3) > 0.3 ? 7 : 0.3;
    M.liquid.emissiveIntensity = 0.9 + Math.sin(t * 1.7) * 0.3;
    for (const l of this.lights) l.intensity = night * 14;
  }
}
