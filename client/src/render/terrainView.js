// The Martian surface: a smooth, high-resolution heightfield in iron-oxide tones with dark
// basaltic sand, bright dust, basalt cliffs and a southern ice cap. A custom shader adds
// gravel-scale bump detail; the colony's plaza, roads and landing pad are paved.
// Instanced, noise-shaped boulders complete the ground at human scale.
import * as THREE from 'three';
import { PLANET_RADIUS as R, BASE_DIR } from '../sim/terrain.js';
import { createNoise3D, mulberry32 } from '../sim/noise.js';
import { colonyFrame, localToDir, groundMarking, WALL_RADIUS } from '../sim/ruins.js';

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

const ROCKS_PER_VARIANT = 420;
// Terrain grid spacing: fine inside the colony (for road markings), growing toward the horizon.
const INNER = 60;
const INNER_STEP = 0.7;
const OUTER = 420;
const GROWTH = 1.085;

/** Grid coordinates from -OUTER to OUTER metres: uniform near the centre, then stretching out. */
function gridCoords() {
  const half = [];
  let x = 0;
  let step = INNER_STEP;
  while (x < OUTER) {
    half.push(x);
    if (x >= INNER) step *= GROWTH;
    x += step;
  }
  half.push(OUTER);
  return [...half.slice(1).reverse().map((v) => -v), ...half];
}

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
        '#include <worldpos_vertex>\nvGroundPos = transformed;\nvPaved = paved;',
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
        // Each layer also fades once a pixel covers more ground than its detail, which
        // keeps the ground from sparkling at low resolution.
        float gGround(vec3 p, float detail, float px) {
          float h = gNoise(p * 0.7) * 0.5 + gNoise(p * 2.3) * 0.28 * (1.0 - smoothstep(0.08, 0.2, px));
          h += gNoise(p * 7.1) * 0.14 * smoothstep(0.0, 0.4, detail) * (1.0 - smoothstep(0.025, 0.07, px));
          float pebbles = smoothstep(0.66, 0.82, gNoise(p * 11.0));
          return h + pebbles * 0.14 * detail * (1.0 - smoothstep(0.015, 0.045, px));
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
        float gPx = length(fwidth(vGroundPos));
        float gH = gGround(vGroundPos, gDetail, gPx);
        float grain = mix(0.8 + gH * 0.3, 0.92 + gNoise(vGroundPos * 9.0) * 0.12 * gDetail * (1.0 - smoothstep(0.02, 0.06, gPx)), vPaved);
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
    const frame = colonyFrame(BASE_DIR);
    const up = new THREE.Vector3(...frame.up);
    const east = new THREE.Vector3(...frame.east);
    const north = new THREE.Vector3(...frame.north);
    // The mesh sits at the colony and stores positions relative to it, so shaders and
    // floats stay precise far from the planet's centre.
    this.origin = up.clone().multiplyScalar(R);
    const coords = gridCoords();
    const m = coords.length;
    const n = m * m;
    const pos = new Float32Array(n * 3);
    this.vDir = new Float32Array(n * 3);
    this.vH = new Float32Array(n);
    this.vJit = new Float32Array(n);
    this.vPatch = new Float32Array(n);
    this.vLocal = new Float32Array(n * 2);
    const noise = createNoise3D(world.seed + 3);
    const v = new THREE.Vector3();
    const dir = [0, 0, 0];
    for (let j = 0; j < m; j++) {
      for (let i = 0; i < m; i++) {
        const k = j * m + i;
        const x = coords[i];
        const z = coords[j];
        v.copy(this.origin).addScaledVector(east, x).addScaledVector(north, z).normalize();
        dir[0] = v.x;
        dir[1] = v.y;
        dir[2] = v.z;
        const h = terrain.height(dir);
        this.vDir.set(dir, k * 3);
        this.vH[k] = h;
        this.vLocal[k * 2] = x;
        this.vLocal[k * 2 + 1] = z;
        // Colour variation in metres: small grain, large dark sand fields and bright dust streaks.
        const px = v.x * R;
        const py = v.y * R;
        const pz = v.z * R;
        this.vJit[k] = Math.max(0, Math.min(1, 0.5 + noise(px / 26, py / 26, pz / 26) * 0.55 + noise(px / 7, py / 7, pz / 7) * 0.35));
        this.vPatch[k] = noise(px / 90 + 11, py / 90, pz / 90 - 5) + noise(px / 34 - 3, py / 34, pz / 34) * 0.4;
        v.multiplyScalar(R + h).sub(this.origin);
        pos[k * 3] = v.x;
        pos[k * 3 + 1] = v.y;
        pos[k * 3 + 2] = v.z;
      }
    }
    const index = new Uint32Array((m - 1) * (m - 1) * 6);
    let t = 0;
    for (let j = 0; j < m - 1; j++) {
      for (let i = 0; i < m - 1; i++) {
        const a = j * m + i;
        const b = a + 1;
        const c = a + m;
        const d = c + 1;
        index[t++] = a;
        index[t++] = c;
        index[t++] = b;
        index[t++] = b;
        index[t++] = c;
        index[t++] = d;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    geo.computeVertexNormals();
    // Make sure the winding faces up; flip if the frame came out left-handed.
    const nor = geo.attributes.normal;
    const mid = Math.floor(m / 2) * m + Math.floor(m / 2);
    if (nor.getX(mid) * up.x + nor.getY(mid) * up.y + nor.getZ(mid) * up.z < 0) {
      for (let q = 0; q < index.length; q += 3) [index[q + 1], index[q + 2]] = [index[q + 2], index[q + 1]];
      geo.computeVertexNormals();
    }
    this.vSlope = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const d = this.vDir[k * 3] * nor.getX(k) + this.vDir[k * 3 + 1] * nor.getY(k) + this.vDir[k * 3 + 2] * nor.getZ(k);
      this.vSlope[k] = 1 - d;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('paved', new THREE.BufferAttribute(new Float32Array(n), 1));
    geo.computeBoundingSphere();
    this.mesh = new THREE.Mesh(geo, groundMaterial());
    this.mesh.position.copy(this.origin);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
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
      this.rockShadow = true;
      rocks.receiveShadow = true;
      for (let i = 0; i < ROCKS_PER_VARIANT; i++) {
        // Keep the colony inside the wall clear; most rocks sit on the nearby plains.
        const ang = rand() * Math.PI * 2;
        const big = rand() < 0.05;
        const dist = (big ? 70 : WALL_RADIUS + 3) + rand() ** 1.7 * 230;
        let lx = Math.sin(ang) * dist;
        const lz = Math.cos(ang) * dist;
        // Keep the roads out of the gates clear.
        if (dist < 70 && (Math.abs(lx) < 4.5 || Math.abs(lz) < 4.5)) lx += Math.sign(lx || 1) * 6;
        const d = localToDir(frame, lx, lz);
        const size = big ? 1.4 + rand() * 2.6 : 0.15 + rand() ** 2.2 * 0.9;
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
    const colors = this.mesh.geometry.attributes.color;
    const pavedAttr = this.mesh.geometry.attributes.paved;
    const arr = colors.array;
    const c = new THREE.Color();
    const n = this.vH.length;
    for (let i = 0; i < n; i++) {
      const h = this.vH[i];
      const j = this.vJit[i];
      const slope = this.vSlope[i];
      c.copy(PAL.dust).lerp(PAL.regolith, j);
      const patch = this.vPatch[i];
      if (patch > 0.25) c.lerp(PAL.darkSand, Math.min(1, (patch - 0.25) * 2.2) * 0.75);
      if (patch < -0.35) c.lerp(PAL.paleDust, Math.min(1, (-0.35 - patch) * 2) * 0.6);
      c.lerp(PAL.paleDust, Math.max(0, Math.min(1, (h - 8) / 18)) * 0.45);
      if (h < -1.2) c.lerp(PAL.crater, Math.min(1, (-1.2 - h) / 3));
      if (slope > 0.06) c.lerp(PAL.basalt, Math.min(1, (slope - 0.06) * 4));

      // Paved colony ground: plaza, roads with painted lines, landing pad.
      let paved = 0;
      const x = this.vLocal[i * 2];
      const z = this.vLocal[i * 2 + 1];
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
