// The Martian surface: a smooth, high-resolution heightfield in iron-oxide reds with dark
// basalt cliffs and a southern ice cap, plus instanced boulders at human scale.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { PLANET_RADIUS as R, BASE_DIR } from '../sim/terrain.js';
import { createNoise3D, mulberry32 } from '../sim/noise.js';
import { randomDir } from '../sim/vec.js';

const C = (hex) => new THREE.Color(hex);
const PAL = {
  dustA: C(0xb0603a),
  dustB: C(0x8e4428),
  highland: C(0xc98b5e),
  basalt: C(0x3e2620),
  crater: C(0x6a3321),
  colony: C(0x8a6a58),
  ice: C(0xe8e4de),
};

const DETAIL = 96;
const ROCK_COUNT = 1700;

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
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
    for (const o of [this.mesh, this.rocks]) {
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
    this.buildRocks(world);
    this.painted = null;
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
      // Keep the colony plateau clear of boulders.
      let d = randomDir(rand);
      for (let k = 0; k < 6 && Math.acos(Math.min(1, d[0] * BASE_DIR[0] + d[1] * BASE_DIR[1] + d[2] * BASE_DIR[2])) * R < 26; k++) {
        d = randomDir(rand);
      }
      const big = rand() < 0.06;
      const size = big ? 1.2 + rand() * 1.8 : 0.12 + rand() ** 2 * 0.7;
      const r = world.terrain.surfaceRadius(d) + size * 0.15;
      tmpP.set(d[0], d[1], d[2]);
      // Mostly upright with a slight tilt, squashed so boulders sit on the ground.
      tmpQ.setFromUnitVectors(UP, tmpP).multiply(tmpQ2.setFromEuler(new THREE.Euler((rand() - 0.5) * 0.5, rand() * 6.28, (rand() - 0.5) * 0.5)));
      tmpS.set(size * (0.9 + rand() * 0.6), size * (0.45 + rand() * 0.35), size * (0.9 + rand() * 0.6));
      const matrix = new THREE.Matrix4().compose(tmpP.clone().multiplyScalar(r), tmpQ.clone(), tmpS.clone());
      rocks.setMatrixAt(i, matrix);
      color.setHSL(0.03 + rand() * 0.04, 0.35 + rand() * 0.2, 0.18 + rand() * 0.16);
      rocks.setColorAt(i, color);
      this.rockData.push({ dir: d, r, matrix });
    }
    this.rocks = rocks;
    this.scene.add(rocks);
  }

  /** Colours the ground once per planet: dust plains, highlands, basalt cliffs, ice cap. */
  paint(world) {
    if (this.painted === world.seed) return;
    this.painted = world.seed;
    const colors = this.mesh.geometry.attributes.color;
    const arr = colors.array;
    const c = new THREE.Color();
    const n = this.vH.length;
    for (let i = 0; i < n; i++) {
      const h = this.vH[i];
      const j = this.vJit[i];
      const slope = this.vSlope[i];
      const dx = this.vDir[i * 3];
      const dy = this.vDir[i * 3 + 1];
      const dz = this.vDir[i * 3 + 2];
      c.copy(PAL.dustA).lerp(PAL.dustB, j);
      c.lerp(PAL.highland, Math.max(0, Math.min(1, (h - 2) / 5)) * 0.7);
      if (h < -1.5) c.lerp(PAL.crater, Math.min(1, (-1.5 - h) / 3));
      if (slope > 0.06) c.lerp(PAL.basalt, Math.min(1, (slope - 0.06) * 5));
      // Trampled, lighter ground around the colony.
      const fromBase = Math.acos(Math.min(1, dx * BASE_DIR[0] + dy * BASE_DIR[1] + dz * BASE_DIR[2])) * R;
      if (fromBase < 30) c.lerp(PAL.colony, (1 - fromBase / 30) * 0.45);
      // Southern polar ice cap.
      if (dy < -0.78) c.lerp(PAL.ice, Math.min(1, (-0.78 - dy) * 8) * (0.6 + j * 0.4));
      arr[i * 3] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
    }
    colors.needsUpdate = true;
  }
}
