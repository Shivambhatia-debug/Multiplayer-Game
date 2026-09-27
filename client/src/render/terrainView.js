// The planet surface: a smooth, high-resolution heightfield coloured from the simulation,
// plus instanced rocks and grass tufts that make the ground read at human scale.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { PLANET_RADIUS as R } from '../sim/terrain.js';
import { createNoise3D, mulberry32 } from '../sim/noise.js';
import { randomDir } from '../sim/vec.js';

const C = (hex) => new THREE.Color(hex);
const PAL = {
  rockA: C(0x5e4d44),
  rockB: C(0x8a7263),
  cliff: C(0x4a3f3a),
  toxicTint: C(0x7d6a32),
  sand: C(0xd9c28c),
  wetSand: C(0x8a7452),
  seabed: C(0x33444c),
  grassA: C(0x4f9e3c),
  grassB: C(0x2e7a3e),
  grassDry: C(0x8a9a3e),
  snow: C(0xe4ecf3),
  frost: C(0x9eabb5),
};

const DETAIL = 96;
const GREEN_RADIUS = 7;
const CELL = GREEN_RADIUS / R;
const GRASS_COUNT = 16000;
const ROCK_COUNT = 1100;

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const cellKey = (x, y, z) => `${Math.floor((x + 1) / CELL)},${Math.floor((y + 1) / CELL)},${Math.floor((z + 1) / CELL)}`;

/** Buckets static unit-sphere points so a tree only touches the points near it. */
class PointBuckets {
  constructor(dirs) {
    this.dirs = dirs;
    this.cells = new Map();
    for (let i = 0; i < dirs.length / 3; i++) {
      const k = cellKey(dirs[i * 3], dirs[i * 3 + 1], dirs[i * 3 + 2]);
      let list = this.cells.get(k);
      if (!list) this.cells.set(k, (list = []));
      list.push(i);
    }
  }

  /** Adds each tree's influence (falling off over GREEN_RADIUS) into `out`. */
  accumulate(trees, out) {
    const infl = CELL * CELL;
    const d = this.dirs;
    for (let t = 0; t < trees.length; t += 4) {
      const tx = trees[t];
      const ty = trees[t + 1];
      const tz = trees[t + 2];
      const w = trees[t + 3];
      const cx = Math.floor((tx + 1) / CELL);
      const cy = Math.floor((ty + 1) / CELL);
      const cz = Math.floor((tz + 1) / CELL);
      for (let ix = cx - 1; ix <= cx + 1; ix++) {
        for (let iy = cy - 1; iy <= cy + 1; iy++) {
          for (let iz = cz - 1; iz <= cz + 1; iz++) {
            const list = this.cells.get(`${ix},${iy},${iz}`);
            if (!list) continue;
            for (const i of list) {
              const ex = d[i * 3] - tx;
              const ey = d[i * 3 + 1] - ty;
              const ez = d[i * 3 + 2] - tz;
              const d2 = ex * ex + ey * ey + ez * ez;
              if (d2 < infl) out[i] += w * (1 - d2 / infl);
            }
          }
        }
      }
    }
  }
}

/** A tuft of five thin blades, darker at the root. */
function tuftGeometry() {
  const pos = [];
  const col = [];
  const blades = 7;
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2 + b * 0.7;
    const lean = 0.18 + (b % 3) * 0.08;
    const h = 0.35 + (b % 3) * 0.15;
    const w = 0.045;
    const cx = Math.cos(a);
    const cz = Math.sin(a);
    const px = -cz * w;
    const pz = cx * w;
    pos.push(px, 0, pz, -px, 0, -pz, cx * lean, h, cz * lean);
    col.push(0.35, 0.45, 0.3, 0.35, 0.45, 0.3, 1, 1, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * Standard lit ground material plus world-space grain, so the surface reads as soil and
 * stone up close instead of smooth plaster. Uses 3D value noise on the world position.
 */
function groundMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGroundPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGroundPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vGroundPos;
        float gHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        float gNoise(vec3 x) {
          vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(gHash(i), gHash(i + vec3(1,0,0)), f.x), mix(gHash(i + vec3(0,1,0)), gHash(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(gHash(i + vec3(0,0,1)), gHash(i + vec3(1,0,1)), f.x), mix(gHash(i + vec3(0,1,1)), gHash(i + vec3(1,1,1)), f.x), f.y), f.z);
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float grain = gNoise(vGroundPos * 0.9) * 0.5 + gNoise(vGroundPos * 3.1) * 0.3 + gNoise(vGroundPos * 11.0) * 0.2;
        diffuseColor.rgb *= 0.72 + grain * 0.5;`,
      );
  };
  return mat;
}

export class TerrainView {
  constructor(scene) {
    this.scene = scene;
    this.mesh = null;
  }

  dispose() {
    for (const o of [this.mesh, this.rocks, this.grass]) {
      if (!o) continue;
      this.scene.remove(o);
      o.geometry.dispose();
    }
  }

  build(world) {
    this.dispose();
    const terrain = world.terrain;
    let geo = new THREE.IcosahedronGeometry(1, DETAIL);
    geo.deleteAttribute('normal');
    geo.deleteAttribute('uv');
    geo = mergeVertices(geo);
    const pos = geo.attributes.position;
    const n = pos.count;
    this.vDir = new Float32Array(n * 3);
    this.vH = new Float32Array(n);
    this.vJit = new Float32Array(n);
    const noise = createNoise3D(world.seed + 3);
    const v = new THREE.Vector3();
    const dir = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(pos, i).normalize();
      dir[0] = v.x;
      dir[1] = v.y;
      dir[2] = v.z;
      const h = terrain.height(dir);
      this.vDir.set(dir, i * 3);
      this.vH[i] = h;
      this.vJit[i] = Math.max(
        0,
        Math.min(1, 0.5 + noise(v.x * 7, v.y * 7, v.z * 7) * 0.55 + noise(v.x * 22, v.y * 22, v.z * 22) * 0.35),
      );
      v.multiplyScalar(R + h);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    const nor = geo.attributes.normal;
    this.vSlope = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const d = this.vDir[i * 3] * nor.getX(i) + this.vDir[i * 3 + 1] * nor.getY(i) + this.vDir[i * 3 + 2] * nor.getZ(i);
      this.vSlope[i] = 1 - d;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.mesh = new THREE.Mesh(geo, groundMaterial());
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = true;
    this.scene.add(this.mesh);
    this.vBuckets = new PointBuckets(this.vDir);
    this.vGreen = new Float32Array(n);

    this.buildRocks(world);
    this.buildGrass(world);
  }

  buildRocks(world) {
    const rand = mulberry32(world.seed ^ 0xb0b);
    const geo = new THREE.DodecahedronGeometry(1, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true });
    const rocks = new THREE.InstancedMesh(geo, mat, ROCK_COUNT);
    rocks.castShadow = true;
    rocks.receiveShadow = true;
    this.rockData = [];
    const color = new THREE.Color();
    for (let i = 0; i < ROCK_COUNT; i++) {
      const d = randomDir(rand);
      const big = rand() < 0.06;
      const size = big ? 1.2 + rand() * 1.8 : 0.12 + rand() ** 2 * 0.7;
      const r = world.terrain.surfaceRadius(d) + size * 0.15;
      tmpP.set(d[0], d[1], d[2]);
      // Mostly upright with a slight tilt, squashed so boulders sit on the ground.
      tmpQ.setFromUnitVectors(UP, tmpP).multiply(tmpQ2.setFromEuler(new THREE.Euler((rand() - 0.5) * 0.5, rand() * 6.28, (rand() - 0.5) * 0.5)));
      tmpS.set(size * (0.9 + rand() * 0.6), size * (0.45 + rand() * 0.35), size * (0.9 + rand() * 0.6));
      const matrix = new THREE.Matrix4().compose(tmpP.clone().multiplyScalar(r), tmpQ.clone(), tmpS.clone());
      rocks.setMatrixAt(i, matrix);
      color.setHSL(0.06 + rand() * 0.05, 0.12 + rand() * 0.1, 0.22 + rand() * 0.18);
      rocks.setColorAt(i, color);
      this.rockData.push({ dir: d, r, matrix });
    }
    this.rocks = rocks;
    this.scene.add(rocks);
  }

  buildGrass(world) {
    const rand = mulberry32(world.seed ^ 0x6a55);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.85 });
    const grass = new THREE.InstancedMesh(tuftGeometry(), mat, GRASS_COUNT);
    grass.receiveShadow = true;
    const dirs = new Float32Array(GRASS_COUNT * 3);
    this.grassData = [];
    const color = new THREE.Color();
    for (let i = 0; i < GRASS_COUNT; i++) {
      const d = randomDir(rand);
      dirs.set(d, i * 3);
      const r = world.terrain.surfaceRadius(d) - 0.05;
      tmpP.set(d[0], d[1], d[2]);
      const q = new THREE.Quaternion().setFromUnitVectors(UP, tmpP).multiply(tmpQ2.setFromAxisAngle(UP, rand() * 6.28));
      this.grassData.push({ pos: tmpP.clone().multiplyScalar(r), q, size: 0.6 + rand() * 0.8, r, dir: d });
      color.copy(PAL.grassA).lerp(PAL.grassB, rand()).lerp(PAL.grassDry, rand() * 0.3);
      grass.setColorAt(i, color);
      grass.setMatrixAt(i, tmpM.makeScale(0, 0, 0));
    }
    this.grassBuckets = new PointBuckets(dirs);
    this.grassGreen = new Float32Array(GRASS_COUNT);
    this.grass = grass;
    this.scene.add(grass);
  }

  /** Recolours the ground and regrows grass from the current world state. */
  paint(world) {
    const s = world.stats;
    const air = s.air / 100;
    const waterR = world.waterR;
    const cold = Math.max(0, Math.min(1, (34 - s.heat) / 26));
    const lifeGlobal = (s.life / 100) * 0.3;
    const trees = [];
    for (const st of world.structures.values()) {
      if (st.type === 'seed' && st.growth > 0.05) trees.push(st.dir[0], st.dir[1], st.dir[2], 0.3 + st.growth);
    }
    this.vGreen.fill(lifeGlobal);
    this.vBuckets.accumulate(trees, this.vGreen);

    const colors = this.mesh.geometry.attributes.color;
    const arr = colors.array;
    const rock = new THREE.Color();
    const grass = new THREE.Color();
    const c = new THREE.Color();
    const n = this.vH.length;
    for (let i = 0; i < n; i++) {
      const h = this.vH[i];
      const j = this.vJit[i];
      const slope = this.vSlope[i];
      const green = Math.min(1, this.vGreen[i]) * (1 - Math.min(1, slope * 6));
      rock.copy(PAL.rockA).lerp(PAL.rockB, j).lerp(PAL.toxicTint, (1 - air) * 0.3);
      if (slope > 0.08) rock.lerp(PAL.cliff, Math.min(1, (slope - 0.08) * 6));
      grass.copy(PAL.grassA).lerp(PAL.grassB, j).lerp(PAL.grassDry, Math.max(0, (s.heat - 65) / 20));
      const r = R + h;
      if (r < waterR - 0.05) {
        c.copy(PAL.seabed).lerp(PAL.wetSand, Math.max(0, 1 - (waterR - r) / 2));
      } else if (r < waterR + 0.7 && s.water > 1) {
        c.copy(PAL.sand).lerp(rock, j * 0.25).lerp(grass, green * 0.3);
      } else {
        c.copy(rock).lerp(grass, green);
        const peak = Math.max(0, (h - 5.2) / 2.5);
        // Frost collects in patches and on high ground; cliffs stay bare rock.
        const patch = Math.max(0, j - 0.35) * 1.6;
        const frost = Math.min(0.9, cold * (0.1 + patch * 0.6 + Math.max(0, h) * 0.05) + peak * (1 - Math.min(1, s.heat / 90)));
        c.lerp(frost > 0.55 ? PAL.snow : PAL.frost, frost * (1 - green * 0.7) * (1 - Math.min(1, slope * 5)));
      }
      arr[i * 3] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
    }
    colors.needsUpdate = true;

    // Grass grows where trees have greened the ground, never underwater or on cliffs.
    this.grassGreen.fill(lifeGlobal);
    this.grassBuckets.accumulate(trees, this.grassGreen);
    const growOk = s.heat > 25 && s.heat < 85;
    for (let i = 0; i < GRASS_COUNT; i++) {
      const g = this.grassData[i];
      const green = Math.min(1, this.grassGreen[i]);
      const show = growOk && green > 0.18 && g.r > waterR + 0.3;
      const k = show ? g.size * Math.min(1, (green - 0.18) * 2.2 + 0.25) : 0;
      tmpS.setScalar(k);
      this.grass.setMatrixAt(i, tmpM.compose(g.pos, g.q, tmpS));
    }
    this.grass.instanceMatrix.needsUpdate = true;

    // Rocks disappear below the waterline so the sea floor stays clean.
    for (let i = 0; i < ROCK_COUNT; i++) {
      const rd = this.rockData[i];
      this.rocks.setMatrixAt(i, rd.r < waterR - 0.2 ? tmpM.makeScale(0, 0, 0) : rd.matrix);
    }
    this.rocks.instanceMatrix.needsUpdate = true;
  }
}
