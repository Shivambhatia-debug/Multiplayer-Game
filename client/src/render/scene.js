import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { PLANET_RADIUS as R } from '../sim/terrain.js';
import { createNoise3D } from '../sim/noise.js';
import { sunDir, TUNING } from '../sim/defs.js';
import { meteorPos } from '../sim/world.js';
import {
  buildStructure,
  buildGhost,
  buildOre,
  buildMeteor,
  buildWarning,
  buildAvatar,
  buildCrawler,
  setGridPower,
  hash01,
} from './models.js';
import { Effects } from './fx.js';

const UP = new THREE.Vector3(0, 1, 0);
// Clouds hug the planet in orbit views and sit above the camera when playing.
const CLOUD_ORBIT_R = R + 4.5;
const CLOUD_PLAY_R = R + 13;
const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpM = new THREE.Matrix4();

const C = (hex) => new THREE.Color(hex);
const PALETTE = {
  rockA: C(0x6e5a52),
  rockB: C(0x8a6f5c),
  toxicRock: C(0x7a6a3a),
  sand: C(0xd8c08a),
  wetSand: C(0x8f7a55),
  grassA: C(0x4caf50),
  grassB: C(0x2f8f4e),
  snow: C(0xcfdce8),
  seabed: C(0x3b4a52),
  atmoToxic: C(0xff8c3a),
  atmoClean: C(0x5aa8ff),
  skyToxic: C(0x4a2a12),
  skyClean: C(0x3d7fd1),
  oceanToxic: C(0x4f7a3a),
  oceanClean: C(0x1766b0),
};

function easeOutBack(k) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (k - 1) ** 3 + c1 * (k - 1) ** 2;
}

/** Places `obj` on the planet at unit direction `dir`, standing upright, with a yaw. */
function orient(obj, dir, radius, yaw = 0) {
  tmpV.set(dir[0], dir[1], dir[2]);
  obj.position.copy(tmpV).multiplyScalar(radius);
  obj.quaternion.setFromUnitVectors(UP, tmpV);
  if (yaw) obj.quaternion.multiply(tmpQ.setFromAxisAngle(UP, yaw));
}

function cloudTexture() {
  const w = 512;
  const h = 256;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const n = createNoise3D(7);
  for (let y = 0; y < h; y++) {
    const lat = (y / h) * Math.PI;
    for (let x = 0; x < w; x++) {
      const lon = (x / w) * Math.PI * 2;
      const px = Math.sin(lat) * Math.cos(lon);
      const py = Math.cos(lat);
      const pz = Math.sin(lat) * Math.sin(lon);
      let v = 0;
      let a = 1;
      let f = 2;
      for (let o = 0; o < 4; o++) {
        v += n(px * f, py * f, pz * f) * a;
        a *= 0.5;
        f *= 2;
      }
      const alpha = Math.max(0, Math.min(1, (v - 0.12) * 2.6));
      const i = (y * w + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = alpha * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function glowTexture(inner, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, inner);
  g.addColorStop(0.18, inner);
  g.addColorStop(0.4, outer);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class GameRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x02030a);
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 3000);
    this.camera.position.set(0, 20, 80);

    this.buildLights();
    this.buildSky();
    this.buildPlanetShells();

    this.fx = new Effects(this.scene);
    this.entities = new THREE.Group();
    this.scene.add(this.entities);
    this.structs = new Map();
    this.ores = new Map();
    this.meteors = new Map();
    this.creatures = new Map();
    this.avatars = new Map();
    this.ghost = null;
    this.ghostType = null;
    this.seed = null;
    this.colorTimer = 0;
    this.shake = 0;
    this.clock = 0;

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.7, 0.5, 1.5);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  buildLights() {
    this.sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -R - 6;
    sc.right = sc.top = R + 6;
    sc.near = 20;
    sc.far = 180;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);
    this.fill = new THREE.DirectionalLight(0x6b8cff, 0.35);
    this.scene.add(this.fill);
    this.ambient = new THREE.AmbientLight(0x4a5878, 0.55);
    this.scene.add(this.ambient);
    this.headlamp = new THREE.PointLight(0xffe2b8, 0, 18, 1);
    this.scene.add(this.headlamp);
  }

  buildSky() {
    const count = 5000;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(900 + Math.random() * 300);
      pos.set([v.x, v.y, v.z], i * 3);
      const t = Math.random();
      const c = new THREE.Color().setHSL(0.55 + t * 0.15, 0.4, 0.65 + Math.random() * 0.35);
      col.set([c.r, c.g, c.b], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.stars = new THREE.Points(
      g,
      new THREE.PointsMaterial({ size: 1.7, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false }),
    );
    this.scene.add(this.stars);

    this.sunSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture('rgba(255,248,230,0.95)', 'rgba(255,190,110,0.12)'),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    this.sunSprite.material.color.setScalar(3);
    this.sunSprite.scale.setScalar(110);
    this.scene.add(this.sunSprite);

    // A distant moon for scale and silhouette.
    const moon = new THREE.Mesh(
      new THREE.IcosahedronGeometry(9, 2),
      new THREE.MeshStandardMaterial({ color: 0x8b8fa3, flatShading: true, roughness: 1 }),
    );
    moon.position.set(-160, 70, -220);
    this.scene.add(moon);
    this.moon = moon;
  }

  buildPlanetShells() {
    this.ocean = new THREE.Mesh(
      new THREE.SphereGeometry(1, 128, 96),
      new THREE.MeshPhysicalMaterial({
        color: PALETTE.oceanClean,
        roughness: 0.12,
        metalness: 0.05,
        transparent: true,
        opacity: 0.84,
        clearcoat: 1,
        clearcoatRoughness: 0.2,
      }),
    );
    this.ocean.receiveShadow = true;
    this.scene.add(this.ocean);

    this.clouds = new THREE.Mesh(
      new THREE.SphereGeometry(1, 64, 48),
      new THREE.MeshStandardMaterial({
        map: cloudTexture(),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        roughness: 1,
      }),
    );
    this.scene.add(this.clouds);

    this.atmoUniforms = {
      uColor: { value: PALETTE.atmoToxic.clone() },
      uSun: { value: new THREE.Vector3(1, 0, 0) },
      uStrength: { value: 1 },
    };
    this.atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.38, 96, 64),
      new THREE.ShaderMaterial({
        uniforms: this.atmoUniforms,
        vertexShader: /* glsl */ `
          varying vec3 vN;
          varying vec3 vView;
          void main() {
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vN = normalize(mat3(modelMatrix) * normal);
            vView = normalize(cameraPosition - wp.xyz);
            gl_Position = projectionMatrix * viewMatrix * wp;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          uniform vec3 uSun;
          uniform float uStrength;
          varying vec3 vN;
          varying vec3 vView;
          void main() {
            float d = -dot(vView, vN);
            float glow = pow(smoothstep(0.0, 0.72, d), 1.6);
            float day = smoothstep(-0.45, 0.55, dot(vN, uSun)) * 0.92 + 0.08;
            gl_FragColor = vec4(uColor * glow * day * uStrength, glow * day);
          }`,
        side: THREE.BackSide,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.scene.add(this.atmosphere);
  }

  /** Rebuilds the terrain mesh when the planet seed changes. */
  setWorld(world) {
    if (world.seed === this.seed) return;
    this.seed = world.seed;
    if (this.terrainMesh) {
      this.scene.remove(this.terrainMesh);
      this.terrainMesh.geometry.dispose();
    }
    for (const map of [this.structs, this.ores, this.meteors, this.creatures]) {
      for (const entry of map.values()) {
        this.entities.remove(entry.obj);
        if (entry.warn) this.entities.remove(entry.warn);
      }
      map.clear();
    }

    const geo = new THREE.IcosahedronGeometry(1, 36);
    const pos = geo.attributes.position;
    const v = new THREE.Vector3();
    const dirArr = [0, 0, 0];
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).normalize();
      dirArr[0] = v.x;
      dirArr[1] = v.y;
      dirArr[2] = v.z;
      v.multiplyScalar(world.terrain.surfaceRadius(dirArr));
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    const faces = pos.count / 3;
    this.faceDir = new Float32Array(faces * 3);
    this.faceH = new Float32Array(faces);
    this.faceJitter = new Float32Array(faces);
    const noise = createNoise3D(world.seed + 3);
    for (let f = 0; f < faces; f++) {
      v.set(0, 0, 0);
      for (let k = 0; k < 3; k++) v.add(tmpV.fromBufferAttribute(pos, f * 3 + k));
      v.divideScalar(3);
      this.faceH[f] = v.length() - R;
      v.normalize();
      this.faceDir.set([v.x, v.y, v.z], f * 3);
      this.faceJitter[f] = noise(v.x * 6, v.y * 6, v.z * 6) * 0.5 + 0.5;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3));
    this.terrainMesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.92, metalness: 0 }),
    );
    this.terrainMesh.castShadow = true;
    this.terrainMesh.receiveShadow = true;
    this.scene.add(this.terrainMesh);
    this.colorTimer = 0;
    this.paintTerrain(world);
  }

  /** Recolours every terrain face from the world state: rock, sand, grass, frost. */
  paintTerrain(world) {
    const colors = this.terrainMesh.geometry.attributes.color;
    const arr = colors.array;
    const s = world.stats;
    const air = s.air / 100;
    const waterR = world.waterR;
    const cold = Math.max(0, Math.min(1, (32 - s.heat) / 24));
    const lifeGlobal = (s.life / 100) * 0.35;
    const trees = [];
    for (const st of world.structures.values()) {
      if (st.type === 'seed' && st.growth > 0.05) trees.push(st.dir[0], st.dir[1], st.dir[2], 0.35 + st.growth);
    }
    const rock = new THREE.Color();
    const grass = new THREE.Color();
    const c = new THREE.Color();
    const infl = (6 / R) ** 2;
    const faces = this.faceH.length;
    for (let f = 0; f < faces; f++) {
      const dx = this.faceDir[f * 3];
      const dy = this.faceDir[f * 3 + 1];
      const dz = this.faceDir[f * 3 + 2];
      const h = this.faceH[f];
      const j = this.faceJitter[f];
      let green = lifeGlobal;
      for (let t = 0; t < trees.length; t += 4) {
        const ex = dx - trees[t];
        const ey = dy - trees[t + 1];
        const ez = dz - trees[t + 2];
        const d2 = ex * ex + ey * ey + ez * ez;
        if (d2 < infl) green += trees[t + 3] * (1 - d2 / infl);
      }
      green = Math.min(1, green);
      rock.copy(PALETTE.rockA).lerp(PALETTE.rockB, j).lerp(PALETTE.toxicRock, (1 - air) * 0.35);
      grass.copy(PALETTE.grassA).lerp(PALETTE.grassB, j);
      const r = R + h;
      if (r < waterR - 0.05) {
        c.copy(PALETTE.seabed).lerp(PALETTE.wetSand, Math.max(0, 1 - (waterR - r) / 1.5));
      } else if (r < waterR + 0.45 && s.water > 1) {
        c.copy(PALETTE.sand).lerp(grass, green * 0.4);
      } else {
        c.copy(rock).lerp(grass, green);
        const frost = Math.min(0.9, cold * (0.2 + j * 0.45 + Math.max(0, h) * 0.18) + (h > 3.4 ? 0.35 : 0));
        c.lerp(PALETTE.snow, frost * (1 - green * 0.6));
      }
      for (let k = 0; k < 3; k++) {
        const i = (f * 3 + k) * 3;
        arr[i] = c.r;
        arr[i + 1] = c.g;
        arr[i + 2] = c.b;
      }
    }
    colors.needsUpdate = true;
  }

  syncStructures(world, now) {
    for (const [id, entry] of this.structs) {
      if (!world.structures.has(id)) {
        this.entities.remove(entry.obj);
        this.structs.delete(id);
      }
    }
    for (const st of world.structures.values()) {
      let entry = this.structs.get(st.id);
      if (!entry || entry.type !== st.type) {
        const obj = buildStructure(st.type, st.id);
        orient(obj, st.dir, world.terrain.surfaceRadius(st.dir) - 0.05, hash01(st.id) * Math.PI * 2);
        this.entities.add(obj);
        entry = {
          obj,
          type: st.type,
          born: now,
          spin: obj.getObjectByName('spin'),
          blink: obj.getObjectByName('blink'),
          bob: obj.getObjectByName('bob'),
          pod: obj.getObjectByName('pod'),
          tree: obj.getObjectByName('tree'),
          phase: hash01(st.id + 11) * 10,
          growth: st.growth,
        };
        this.structs.set(st.id, entry);
      }
      const age = now - entry.born;
      const pop = age < 0.7 ? Math.max(0.01, easeOutBack(age / 0.7)) : 1;
      if (st.type === 'seed') {
        entry.growth += (st.growth - entry.growth) * 0.08;
        const g = entry.growth;
        entry.pod.visible = g < 0.2;
        entry.tree.visible = g >= 0.12;
        entry.tree.scale.setScalar(0.25 + g * 1.05);
        entry.pod.scale.setScalar(1 + Math.sin(now * 3 + entry.phase) * 0.12);
        const wilt = st.hp < 100 ? 1 - (100 - st.hp) / 250 : 1;
        entry.obj.scale.setScalar(pop * wilt);
      } else {
        entry.obj.scale.setScalar(pop);
      }
      if (entry.spin) entry.spin.rotation.y += 0.04 * world.power;
      if (entry.blink) entry.blink.visible = Math.sin(now * 3 + entry.phase) > -0.2;
      if (entry.bob) entry.bob.position.y = 1.35 + Math.sin(now * 2 + entry.phase) * 0.35;
    }
  }

  syncOres(world, now) {
    for (const [id, entry] of this.ores) {
      if (!world.ores.has(id)) {
        this.entities.remove(entry.obj);
        this.ores.delete(id);
      }
    }
    for (const ore of world.ores.values()) {
      let entry = this.ores.get(ore.id);
      if (!entry) {
        const obj = buildOre();
        orient(obj, ore.dir, world.terrain.surfaceRadius(ore.dir));
        this.entities.add(obj);
        entry = { obj, base: obj.position.clone(), phase: hash01(ore.id) * 6 };
        this.ores.set(ore.id, entry);
      }
      const bob = 0.25 + Math.sin(now * 2 + entry.phase) * 0.18;
      tmpV.copy(entry.base).normalize();
      entry.obj.position.copy(entry.base).addScaledVector(tmpV, bob);
      entry.obj.rotateY(0.02);
    }
  }

  syncMeteors(world) {
    const t = world.simTime;
    for (const [id, entry] of this.meteors) {
      if (!world.meteors.has(id)) {
        this.entities.remove(entry.obj, entry.warn);
        this.meteors.delete(id);
      }
    }
    for (const m of world.meteors.values()) {
      let entry = this.meteors.get(m.id);
      if (!entry) {
        const obj = buildMeteor();
        const warn = buildWarning();
        orient(warn, m.dir, world.terrain.surfaceRadius(m.dir));
        this.entities.add(obj, warn);
        entry = { obj, warn, rock: obj.getObjectByName('rock'), trail: obj.getObjectByName('trail') };
        this.meteors.set(m.id, entry);
      }
      const p = meteorPos(m, t, world.terrain);
      entry.obj.position.set(p[0], p[1], p[2]);
      entry.obj.visible = t >= m.t0;
      const start = tmpV.set(m.from[0], m.from[1], m.from[2]).multiplyScalar(R + 70);
      const back = start.sub(entry.obj.position).normalize();
      entry.trail.quaternion.setFromUnitVectors(UP, back);
      entry.rock.rotation.x += 0.05;
      entry.rock.rotation.y += 0.03;
      const k = Math.max(0, Math.min(1, (t - m.t0) / m.dur));
      const pulse = 0.5 + 0.5 * Math.sin(t * (6 + k * 14));
      const [ringMat, discMat] = entry.warn.userData.mats;
      ringMat.opacity = 0.35 + pulse * 0.6;
      discMat.opacity = 0.05 + k * 0.2;
    }
  }

  syncCreatures(world, dt) {
    for (const [id, entry] of this.creatures) {
      if (!world.creatures.has(id)) {
        this.entities.remove(entry.obj);
        this.creatures.delete(id);
      }
    }
    const k = 1 - Math.exp(-8 * dt);
    for (const c of world.creatures.values()) {
      let entry = this.creatures.get(c.id);
      if (!entry) {
        const obj = buildCrawler(c.kind);
        this.entities.add(obj);
        entry = {
          obj,
          dir: new THREE.Vector3(...c.dir),
          fwd: new THREE.Vector3(1, 0, 0),
          body: obj.getObjectByName('body'),
          core: obj.getObjectByName('core'),
          phase: hash01(c.id) * 10,
          flash: 0,
          born: this.clock,
        };
        this.creatures.set(c.id, entry);
        this.fx.burst(entry.dir.clone().multiplyScalar(world.terrain.surfaceRadius(c.dir) + 0.5), 0xc04bff, 30, 5, 0.8);
      }
      const target = tmpV.set(...c.dir);
      const move = target.clone().sub(entry.dir);
      if (move.lengthSq() > 1e-10) {
        move.addScaledVector(entry.dir, -move.dot(entry.dir));
        if (move.lengthSq() > 1e-10) entry.fwd.lerp(move.normalize(), 0.2);
      }
      entry.dir.lerp(target, k).normalize();
      entry.fwd.addScaledVector(entry.dir, -entry.fwd.dot(entry.dir)).normalize();
      const r = world.terrain.surfaceRadius([entry.dir.x, entry.dir.y, entry.dir.z]);
      entry.obj.position.copy(entry.dir).multiplyScalar(r);
      const right = new THREE.Vector3().crossVectors(entry.dir, entry.fwd).normalize();
      tmpM.makeBasis(right, entry.dir, entry.fwd);
      entry.obj.quaternion.setFromRotationMatrix(tmpM);
      const t = this.clock + entry.phase;
      const pop = Math.min(1, (this.clock - entry.born) / 0.4);
      if (c.eating) {
        entry.body.position.y = Math.abs(Math.sin(t * 14)) * 0.18;
        entry.body.rotation.x = Math.sin(t * 14) * 0.25;
      } else {
        entry.body.position.y = Math.abs(Math.sin(t * 9)) * 0.12;
        entry.body.rotation.x = 0;
      }
      entry.body.scale.set(pop * (1 + Math.sin(t * 9) * 0.06), pop * (1 - Math.sin(t * 9) * 0.06), pop);
      entry.flash = Math.max(0, entry.flash - dt * 5);
      entry.core.material.emissiveIntensity = 0.5 + entry.flash * 8;
      if (c.eating && Math.random() < dt * 6) {
        this.fx.burst(entry.obj.position.clone().addScaledVector(entry.dir, 0.6), 0xb04bff, 3, 3, 0.5);
      }
    }
  }

  flashCreature(id) {
    const entry = this.creatures.get(id);
    if (entry) entry.flash = 1;
  }

  creatureDeath(pos, brute) {
    const p = new THREE.Vector3(...pos);
    this.fx.burst(p, 0xd24bff, brute ? 140 : 70, brute ? 11 : 8, 1);
    this.fx.burst(p, 0x7dff3a, 20, 4, 0.8);
    this.fx.shockwave(p, 0xd24bff, brute ? 5 : 3, 0.5);
    this.shakeFrom(p, brute ? 0.5 : 0.2);
  }

  /** Remote players are smoothed toward their latest pose; the local player is exact. */
  syncAvatars(players, world, dt) {
    const seen = new Set();
    for (const p of players) {
      if (!p.pose) continue;
      seen.add(p.id);
      let a = this.avatars.get(p.id);
      if (!a || a.color !== p.color || a.name !== p.name) {
        if (a) this.entities.remove(a.obj);
        const obj = buildAvatar(p.color, p.name);
        this.entities.add(obj);
        a = {
          obj,
          color: p.color,
          name: p.name,
          dir: new THREE.Vector3(...p.pose.d),
          fwd: new THREE.Vector3(...p.pose.f),
          alt: p.pose.h,
          body: obj.getObjectByName('body'),
          label: obj.getObjectByName('label'),
          walk: 0,
        };
        this.avatars.set(p.id, a);
      }
      a.label.visible = !p.isLocal;
      const k = p.isLocal ? 1 : 1 - Math.exp(-14 * dt);
      a.dir.lerp(tmpV.set(...p.pose.d), k).normalize();
      a.fwd.lerp(tmpV.set(...p.pose.f), k);
      a.fwd.addScaledVector(a.dir, -a.fwd.dot(a.dir)).normalize();
      a.alt += (p.pose.h - a.alt) * k;
      const surface = world.terrain.surfaceRadius([a.dir.x, a.dir.y, a.dir.z]);
      a.obj.position.copy(a.dir).multiplyScalar(surface + a.alt);
      const right = tmpV.crossVectors(a.dir, a.fwd).normalize();
      tmpM.makeBasis(right, a.dir, a.fwd);
      a.obj.quaternion.setFromRotationMatrix(tmpM);
      if (p.pose.a === 3) {
        const down = a.dir.clone().multiplyScalar(-7);
        const nozzle = a.obj.position.clone().addScaledVector(a.dir, 0.7).addScaledVector(a.fwd, -0.45);
        this.fx.emit(nozzle, down, 0xff9a3a, 2, 0.35, 1.5);
        this.fx.emit(nozzle, down, 0x7cf7d4, 1, 0.25, 1);
      }
      a.walk += dt * (p.pose.a === 1 ? 12 : 2);
      a.body.position.y = p.pose.a === 1 ? Math.abs(Math.sin(a.walk)) * 0.12 : Math.sin(a.walk) * 0.04;
      a.body.rotation.z = p.pose.a === 1 ? Math.sin(a.walk) * 0.06 : 0;
    }
    for (const [id, a] of this.avatars) {
      if (!seen.has(id)) {
        this.entities.remove(a.obj);
        this.avatars.delete(id);
      }
    }
  }

  setGhost(type, dir, valid, world) {
    if (type !== this.ghostType) {
      if (this.ghost) this.entities.remove(this.ghost);
      this.ghost = type ? buildGhost(type) : null;
      this.ghostType = type;
      if (this.ghost) this.entities.add(this.ghost);
    }
    if (!this.ghost || !dir) {
      if (this.ghost) this.ghost.visible = false;
      return;
    }
    this.ghost.visible = true;
    orient(this.ghost, dir, world.terrain.surfaceRadius(dir));
    this.ghost.userData.material.color.set(valid ? 0x7cf7d4 : 0xff5a6a);
    this.ghost.userData.material.opacity = 0.35 + Math.sin(this.clock * 6) * 0.1;
  }

  updateEnvironment(world, dt, focus) {
    const s = world.stats;
    const sun = sunDir(world.simTime);
    const sunV = new THREE.Vector3(...sun);
    this.sun.position.copy(sunV).multiplyScalar(90);
    this.sun.target.position.set(0, 0, 0);
    this.fill.position.copy(sunV).multiplyScalar(-60);
    this.sunSprite.position.copy(sunV).multiplyScalar(700);
    this.atmoUniforms.uSun.value.copy(sunV);

    const air = s.air / 100;
    this.atmoUniforms.uColor.value.copy(PALETTE.atmoToxic).lerp(PALETTE.atmoClean, air);
    // From the surface we are inside the shell, so keep its glow subtle.
    this.atmoUniforms.uStrength.value = focus ? 0.25 + air * 0.15 : 0.8 + air * 0.6;

    const waterR = world.waterR;
    this.ocean.visible = s.water > 0.5;
    this.ocean.scale.setScalar(waterR);
    this.ocean.material.color.copy(PALETTE.oceanToxic).lerp(PALETTE.oceanClean, air);
    // Fade clouds as the camera passes through the layer so it never sees a hard edge.
    const cloudR = focus ? CLOUD_PLAY_R : CLOUD_ORBIT_R;
    this.clouds.scale.setScalar(cloudR);
    const camGap = Math.abs(this.camera.position.length() - cloudR);
    const fade = focus ? Math.max(0.15, Math.min(1, camGap / 3)) : 1;
    this.clouds.material.opacity = Math.max(0, Math.min(0.7, (s.water - 18) / 55)) * fade;
    this.clouds.rotation.y += dt * 0.012;
    this.clouds.rotation.x += dt * 0.004;
    this.moon.rotation.y += dt * 0.05;

    setGridPower(world.power);

    // Sky colour depends on where the camera is standing: blue by day on a healthy planet.
    let daylight = 0;
    if (focus) {
      daylight = Math.max(0, Math.min(1, focus.dot(sunV) * 1.6 + 0.35));
      const sky = PALETTE.skyToxic.clone().lerp(PALETTE.skyClean, air);
      this.scene.background.setRGB(0.008, 0.012, 0.035).lerp(sky, daylight * (0.3 + air * 0.3));
      this.headlamp.intensity = (1 - daylight) * 3;
    } else {
      this.scene.background.setRGB(0.008, 0.012, 0.035);
      this.headlamp.intensity = 0;
    }
    this.stars.material.opacity = 1 - daylight * 0.9;

    this.colorTimer -= dt;
    if (this.colorTimer <= 0) {
      this.colorTimer = 0.7;
      this.paintTerrain(world);
    }
  }

  /** Event-driven effects from the host. */
  impact(dir) {
    const p = new THREE.Vector3(...dir).multiplyScalar(R + 1);
    this.fx.burst(p, 0xff7a2a, 160, 16, 1.6);
    this.fx.burst(p, 0xffe0a0, 60, 8, 0.9);
    this.fx.shockwave(p, 0xff9a4a, TUNING.blastRadius * 1.8, 0.9);
    this.shakeFrom(p, 1.2);
  }

  meteorDestroyed(pos) {
    const p = new THREE.Vector3(...pos);
    this.fx.burst(p, 0xffb14a, 110, 12, 1.2);
    this.fx.burst(p, 0x8ff7ff, 40, 6, 0.8);
    this.fx.shockwave(p, 0xffc070, 5, 0.6);
    this.shakeFrom(p, 0.4);
  }

  sparkle(dir, color, lift = 1) {
    const p = new THREE.Vector3(...dir);
    p.multiplyScalar(R + lift + 1.5);
    this.fx.burst(p, color, 40, 5, 1);
  }

  shakeFrom(position, amount) {
    const d = position.distanceTo(this.camera.position);
    this.shake = Math.max(this.shake, amount * Math.max(0, 1 - d / 45));
  }

  update(dt, { world, players, focus, headlampPos }) {
    this.clock += dt;
    this.setWorld(world);
    this.syncStructures(world, this.clock);
    this.syncOres(world, this.clock);
    this.syncMeteors(world);
    this.syncCreatures(world, dt);
    this.syncAvatars(players, world, dt);
    this.updateEnvironment(world, dt, focus);
    if (headlampPos) this.headlamp.position.copy(headlampPos);
    this.fx.update(dt);
  }

  render(dt) {
    if (this.shake > 0.001) {
      const s = this.shake;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
      this.camera.position.z += (Math.random() - 0.5) * s;
      this.shake *= Math.exp(-6 * dt);
    }
    this.composer.render(dt);
  }
}
