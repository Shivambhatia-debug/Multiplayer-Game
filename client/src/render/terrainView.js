// The Martian surface: a smooth, high-resolution heightfield in iron-oxide tones with dark
// basaltic sand, bright dust, basalt cliffs and a southern ice cap. A custom shader adds
// gravel-scale bump detail; the colony's plaza, roads and landing pad are paved.
// Instanced, noise-shaped boulders complete the ground at human scale.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { PLANET_RADIUS as R, BASE_DIR } from '../sim/terrain.js';
import { createNoise3D, mulberry32 } from '../sim/noise.js';
import { randomDir } from '../sim/vec.js';
import { colonyFrame, dirToLocal, groundMarking, WALL_RADIUS } from '../sim/ruins.js';

const C = (hex) => new THREE.Color(hex);
// Colours sampled from rover imagery: rust dust, darker regolith, basaltic sand, pale dust.
const PAL = {
  dust: C(0xb8703f),
  regolith: C(0x9a5433),
  darkSand: C(0x4f332a),
  paleDust: C(0xd4a070),
  basalt: C(0x3a2621),
  crater: C(0x6b3a26),
  ice: C(0xe8e4de),
  plaza: C(0x8d8580),
  road: C(0x4d4744),
  pad: C(0x5a5552),
  lineYellow: C(0xd9a032),
  lineWhite: C(0xd8d8d0),
};

const DETAIL = 96;
const ROCKS_PER_VARIANT = 650;

const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Standard lit ground plus two procedural layers driven by 3D noise on world position:
 * colour grain, and bump-mapped normals for pebbles and small ridges. Paved areas
 * (the `paved` vertex attribute) get a flatter, finer finish.
 */
function groundMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float paved;\nvarying vec3 vGroundPos;\nvarying float vPaved;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvGroundPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvPaved = paved;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vGroundPos;
        varying float vPaved;
        float gHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        float gNoise(vec3 x) {
          vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(gHash(i), gHash(i + vec3(1,0,0)), f.x), mix(gHash(i + vec3(0,1,0)), gHash(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(gHash(i + vec3(0,0,1)), gHash(i + vec3(1,0,1)), f.x), mix(gHash(i + vec3(0,1,1)), gHash(i + vec3(1,1,1)), f.x), f.y), f.z);
        }
        // Fine detail fades out with distance so far terrain does not shimmer.
        float gGround(vec3 p, float detail) {
          float h = gNoise(p * 0.7) * 0.5 + gNoise(p * 2.3) * 0.28;
          h += gNoise(p * 7.1) * 0.14 * smoothstep(0.0, 0.4, detail);
          float pebbles = smoothstep(0.66, 0.82, gNoise(p * 11.0));
          return h + (pebbles * 0.14 + gNoise(p * 23.0) * 0.03) * detail;
        }
        vec3 gBump(vec3 surfPos, vec3 surfNorm, float h) {
          vec3 sx = dFdx(surfPos);
          vec3 sy = dFdy(surfPos);
          vec3 r1 = cross(sy, surfNorm);
          vec3 r2 = cross(surfNorm, sx);
          float det = dot(sx, r1);
          vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
          return normalize(abs(det) * surfNorm - grad);
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float gDetail = clamp(1.0 - length(vViewPosition) / 28.0, 0.0, 1.0);
        float gH = gGround(vGroundPos, gDetail);
        float grain = mix(0.8 + gH * 0.3, 0.92 + gNoise(vGroundPos * 9.0) * 0.12 * gDetail, vPaved);
        diffuseColor.rgb *= grain;`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        normal = gBump(-vViewPosition, normal, gH * mix(0.55, 0.08, vPaved) * (0.3 + 0.7 * gDetail));`,
      );
  };
  return mat;
}

/** Irregular boulder shapes: an icosphere pushed around by noise, then flattened a little. */
function rockGeometry(seed) {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const noise = createNoise3D(seed);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = noise(v.x * 1.4, v.y * 1.4, v.z * 1.4) * 0.35 + noise(v.x * 4, v.y * 4, v.z * 4) * 0.12;
    v.multiplyScalar(1 + n);
    v.y *= 0.72;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export class TerrainView {
  constructor(scene) {
    this.scene = scene;
    this.mesh = null;
    this.rocks = [];
  }

  dispose() {
    for (const o of [this.mesh, ...this.rocks]) {
      if (!o) continue;
      this.scene.remove(o);
      o.geometry.dispose();
    }
    this.rocks = [];
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
    this.vPatch = new Float32Array(n);
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
      this.vJit[i] = Math.max(0, Math.min(1, 0.5 + noise(v.x * 7, v.y * 7, v.z * 7) * 0.55 + noise(v.x * 22, v.y * 22, v.z * 22) * 0.35));
      // Large dark sand fields and bright dust streaks.
      this.vPatch[i] = noise(v.x * 2.2 + 11, v.y * 2.2, v.z * 2.2 - 5) + noise(v.x * 5 - 3, v.y * 5, v.z * 5) * 0.4;
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
    geo.setAttribute('paved', new THREE.BufferAttribute(new Float32Array(n), 1));
    this.mesh = new THREE.Mesh(geo, groundMaterial());
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = true;
    this.scene.add(this.mesh);
    this.buildRocks(world);
    this.painted = null;
  }

  buildRocks(world) {
    const rand = mulberry32(world.seed ^ 0xb0b);
    const frame = colonyFrame(BASE_DIR);
    const color = new THREE.Color();
    const q = new THREE.Quaternion();
    const q2 = new THREE.Quaternion();
    for (let variant = 0; variant < 3; variant++) {
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92 });
      const rocks = new THREE.InstancedMesh(rockGeometry(world.seed + variant * 17), mat, ROCKS_PER_VARIANT);
      rocks.castShadow = true;
      rocks.receiveShadow = true;
      for (let i = 0; i < ROCKS_PER_VARIANT; i++) {
        let d = randomDir(rand);
        // Keep the colony inside the wall clear; a few rocks sit just outside it.
        for (let k = 0; k < 8; k++) {
          const [x, z] = dirToLocal(frame, d);
          if (Math.hypot(x, z) > WALL_RADIUS + 3) break;
          d = randomDir(rand);
        }
        const big = rand() < 0.05;
        const size = big ? 1.4 + rand() * 2.2 : 0.1 + rand() ** 2.2 * 0.8;
        tmpP.set(d[0], d[1], d[2]);
        const r = world.terrain.surfaceRadius(d) + size * 0.08;
        q.setFromUnitVectors(UP, tmpP).multiply(q2.setFromEuler(new THREE.Euler((rand() - 0.5) * 0.4, rand() * 6.28, (rand() - 0.5) * 0.4)));
        tmpS.set(size * (0.8 + rand() * 0.5), size * (0.7 + rand() * 0.5), size * (0.8 + rand() * 0.5));
        rocks.setMatrixAt(i, new THREE.Matrix4().compose(tmpP.clone().multiplyScalar(r), q, tmpS));
        color.setHSL(0.03 + rand() * 0.035, 0.28 + rand() * 0.2, 0.16 + rand() * 0.14);
        rocks.setColorAt(i, color);
      }
      this.rocks.push(rocks);
      this.scene.add(rocks);
    }
  }

  /** Colours the ground once per planet. */
  paint(world) {
    if (this.painted === world.seed) return;
    this.painted = world.seed;
    const frame = colonyFrame(BASE_DIR);
    const colors = this.mesh.geometry.attributes.color;
    const pavedAttr = this.mesh.geometry.attributes.paved;
    const arr = colors.array;
    const c = new THREE.Color();
    const n = this.vH.length;
    const dir = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      const h = this.vH[i];
      const j = this.vJit[i];
      const slope = this.vSlope[i];
      dir[0] = this.vDir[i * 3];
      dir[1] = this.vDir[i * 3 + 1];
      dir[2] = this.vDir[i * 3 + 2];
      c.copy(PAL.dust).lerp(PAL.regolith, j);
      const patch = this.vPatch[i];
      if (patch > 0.25) c.lerp(PAL.darkSand, Math.min(1, (patch - 0.25) * 2.2) * 0.75);
      if (patch < -0.35) c.lerp(PAL.paleDust, Math.min(1, (-0.35 - patch) * 2) * 0.6);
      c.lerp(PAL.paleDust, Math.max(0, Math.min(1, (h - 3) / 5)) * 0.45);
      if (h < -1.5) c.lerp(PAL.crater, Math.min(1, (-1.5 - h) / 3));
      if (slope > 0.05) c.lerp(PAL.basalt, Math.min(1, (slope - 0.05) * 5));
      if (dir[1] < -0.78) c.lerp(PAL.ice, Math.min(1, (-0.78 - dir[1]) * 8) * (0.6 + j * 0.4));

      // Paved colony ground: plaza, roads with painted lines, landing pad.
      let paved = 0;
      const [x, z] = dirToLocal(frame, dir);
      const d = Math.hypot(x, z);
      if (d < 52) {
        const mark = groundMarking(x, z);
        if (mark) {
          paved = 1;
          const base = mark.kind === 'plaza' ? PAL.plaza : mark.kind === 'pad' ? PAL.pad : PAL.road;
          c.copy(base).multiplyScalar(0.85 + j * 0.25).lerp(PAL.dust, 0.12 + j * 0.15);
          if (mark.line) c.copy(mark.kind === 'plaza' ? PAL.lineYellow : PAL.lineWhite).lerp(PAL.dust, 0.25);
        } else if (d < 48) {
          // Trampled, dusty ground inside the colony.
          c.lerp(PAL.paleDust, 0.18);
        }
      }
      pavedAttr.array[i] = paved;
      arr[i * 3] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
    }
    colors.needsUpdate = true;
    pavedAttr.needsUpdate = true;
  }
}
