import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { PLANET_RADIUS as R } from '../sim/terrain.js';
import { sunDir, TUNING } from '../sim/defs.js';
import { podPos } from '../sim/world.js';
import {
  buildStructure,
  buildGhost,
  buildCell,
  buildPod,
  buildWarning,
  buildAvatar,
  buildAlien,
  buildReactor,
  hash01,
} from './models.js';
import { Effects } from './fx.js';
import { SkyDome } from './sky.js';
import { TerrainView } from './terrainView.js';
import { RuinsView } from './ruinsView.js';

const UP = new THREE.Vector3(0, 1, 0);
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpM = new THREE.Matrix4();

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

/** Orients `obj` upright at `up`, facing tangent direction `fwd`. */
function face(obj, up, fwd) {
  const right = tmpV2.crossVectors(up, fwd).normalize();
  tmpM.makeBasis(right, up, fwd);
  obj.quaternion.setFromRotationMatrix(tmpM);
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
    this.buildAtmosphere();
    this.sky = new SkyDome(this.scene);
    this.terrainView = new TerrainView(this.scene);
    this.ruinsView = new RuinsView(this.scene);
    this.fog = new THREE.FogExp2(0x000000, 0.01);
    this.mode = null;

    this.fx = new Effects(this.scene);
    this.entities = new THREE.Group();
    this.scene.add(this.entities);
    this.structs = new Map();
    this.cells = new Map();
    this.pods = new Map();
    this.enemies = new Map();
    this.avatars = new Map();
    this.reactor = null;
    this.ghost = null;
    this.ghostType = null;
    this.seed = null;
    this.shake = 0;
    this.clock = 0;
    this.night = 0;

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
    this.sun = new THREE.DirectionalLight(0xffe2c4, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);
    this.fill = new THREE.DirectionalLight(0x6b8cff, 0.35);
    this.scene.add(this.fill);
    this.ambient = new THREE.AmbientLight(0x5a4a48, 0.55);
    this.scene.add(this.ambient);
    this.hemi = new THREE.HemisphereLight(0xd9a070, 0x3a2016, 0);
    this.scene.add(this.hemi);
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
      const c = new THREE.Color().setHSL(0.55 + Math.random() * 0.15, 0.4, 0.65 + Math.random() * 0.35);
      col.set([c.r, c.g, c.b], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.stars = new THREE.Points(
      g,
      new THREE.PointsMaterial({
        size: 1.7,
        sizeAttenuation: false,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        fog: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.stars.renderOrder = -9;
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
    this.sunSprite.scale.setScalar(80);
    this.scene.add(this.sunSprite);

    // Phobos and Deimos: two small, lumpy moons.
    const moonMat = new THREE.MeshStandardMaterial({ color: 0x8a7d72, flatShading: true, roughness: 1, fog: false });
    this.moons = [
      { mesh: new THREE.Mesh(new THREE.IcosahedronGeometry(16, 1), moonMat), dist: 520, speed: 0.05, tilt: 0.3, scale: [1.3, 0.9, 1] },
      { mesh: new THREE.Mesh(new THREE.IcosahedronGeometry(9, 1), moonMat), dist: 760, speed: 0.02, tilt: -0.5, scale: [1, 0.8, 1.1] },
    ];
    for (const m of this.moons) {
      m.mesh.scale.set(...m.scale);
      this.scene.add(m.mesh);
    }
  }

  buildAtmosphere() {
    this.atmoUniforms = {
      uColor: { value: new THREE.Color(0xff9a5a) },
      uSun: { value: new THREE.Vector3(1, 0, 0) },
      uStrength: { value: 1.1 },
    };
    this.atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.2, 96, 64),
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

  /** Rebuilds terrain, ruins and the reactor when the planet seed changes. */
  setWorld(world) {
    if (world.seed === this.seed) return;
    this.seed = world.seed;
    for (const map of [this.structs, this.cells, this.pods, this.enemies]) {
      for (const entry of map.values()) {
        this.entities.remove(entry.obj);
        if (entry.warn) this.entities.remove(entry.warn);
      }
      map.clear();
    }
    this.terrainView.build(world);
    this.terrainView.paint(world);
    this.terrainMesh = this.terrainView.mesh;
    this.ruinsView.build(world);
    if (this.reactor) this.entities.remove(this.reactor.obj);
    const obj = buildReactor();
    obj.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });
    orient(obj, world.baseDir, world.terrain.surfaceRadius(world.baseDir) - 0.1);
    this.entities.add(obj);
    this.reactor = {
      obj,
      core: obj.getObjectByName('core'),
      rings: [obj.getObjectByName('ring0'), obj.getObjectByName('ring1')],
      beacon: obj.getObjectByName('beacon'),
    };
  }

  surfaceAt(dir) {
    return this.world ? this.world.terrain.surfaceRadius(dir) : R;
  }

  /** Switches between the orbital view (menus) and standing on the surface (playing). */
  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    const surface = mode === 'surface';
    this.scene.fog = surface ? this.fog : null;
    this.sky.mesh.visible = surface;
    this.atmosphere.visible = !surface;
    const sc = this.sun.shadow.camera;
    const half = surface ? 45 : R + 10;
    sc.left = sc.bottom = -half;
    sc.right = sc.top = half;
    sc.near = surface ? 1 : 20;
    sc.far = surface ? 300 : 320;
    sc.updateProjectionMatrix();
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
        const obj = buildStructure(st.type);
        orient(obj, st.dir, world.terrain.surfaceRadius(st.dir) - 0.05, hash01(st.id) * Math.PI * 2);
        this.entities.add(obj);
        entry = {
          obj,
          type: st.type,
          born: now,
          head: obj.getObjectByName('head'),
          spin: obj.getObjectByName('spin'),
          pulse: obj.getObjectByName('pulse'),
          phase: hash01(st.id + 11) * 10,
          fireAt: 0,
          yaw: 0,
        };
        this.structs.set(st.id, entry);
      }
      const age = now - entry.born;
      entry.obj.scale.setScalar(age < 0.7 ? Math.max(0.01, easeOutBack(age / 0.7)) : 1);
      if (entry.spin) entry.spin.rotation.y += 0.04;
      if (entry.pulse) entry.pulse.scale.setScalar(1.4 + ((now * 0.8 + entry.phase) % 1) * 1.6);
      if (st.type === 'turret') this.animateTurret(entry, now);
    }
  }

  /** Turrets swivel toward the nearest alien and fire tracer bolts (the host applies the damage). */
  animateTurret(entry, now) {
    let best = null;
    let bestD = TUNING.turretRange;
    for (const e of this.enemies.values()) {
      const d = e.obj.position.distanceTo(entry.obj.position);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    if (!best) return;
    const local = entry.obj.worldToLocal(best.obj.position.clone());
    const target = Math.atan2(local.x, local.z);
    entry.yaw += Math.atan2(Math.sin(target - entry.yaw), Math.cos(target - entry.yaw)) * 0.25;
    entry.head.rotation.y = entry.yaw;
    if (now >= entry.fireAt) {
      entry.fireAt = now + TUNING.turretRate;
      const muzzle = entry.head.localToWorld(new THREE.Vector3(0, 0, 1.4));
      const hit = best.obj.position.clone().addScaledVector(best.up, best.kind === 1 ? 1.8 : 0.8);
      this.fx.beam(muzzle, hit, 0xff7a4a);
    }
  }

  syncCells(world, now) {
    for (const [id, entry] of this.cells) {
      if (!world.cells.has(id)) {
        this.entities.remove(entry.obj);
        this.cells.delete(id);
      }
    }
    for (const cell of world.cells.values()) {
      let entry = this.cells.get(cell.id);
      if (!entry) {
        const obj = buildCell();
        orient(obj, cell.dir, world.terrain.surfaceRadius(cell.dir), hash01(cell.id) * 6);
        this.entities.add(obj);
        entry = { obj, base: obj.position.clone(), phase: hash01(cell.id) * 6 };
        this.cells.set(cell.id, entry);
      }
      tmpV.copy(entry.base).normalize();
      entry.obj.position.copy(entry.base).addScaledVector(tmpV, 0.15 + Math.sin(now * 2 + entry.phase) * 0.12);
    }
  }

  syncPods(world) {
    const t = world.simTime;
    for (const [id, entry] of this.pods) {
      if (!world.pods.has(id)) {
        this.entities.remove(entry.obj, entry.warn);
        this.pods.delete(id);
      }
    }
    for (const p of world.pods.values()) {
      let entry = this.pods.get(p.id);
      if (!entry) {
        const obj = buildPod();
        const warn = buildWarning();
        orient(warn, p.dir, world.terrain.surfaceRadius(p.dir));
        this.entities.add(obj, warn);
        entry = { obj, warn, shell: obj.getObjectByName('rock'), trail: obj.getObjectByName('trail') };
        this.pods.set(p.id, entry);
      }
      const pos = podPos(p, t, world.terrain);
      entry.obj.position.set(pos[0], pos[1], pos[2]);
      entry.obj.visible = t >= p.t0;
      const start = tmpV.set(p.from[0], p.from[1], p.from[2]).multiplyScalar(R + 70);
      const back = start.sub(entry.obj.position).normalize();
      entry.trail.quaternion.setFromUnitVectors(UP, back);
      entry.shell.quaternion.setFromUnitVectors(UP, back.negate());
      const k = Math.max(0, Math.min(1, (t - p.t0) / p.dur));
      const pulse = 0.5 + 0.5 * Math.sin(t * (6 + k * 14));
      const [ringMat, discMat] = entry.warn.userData.mats;
      ringMat.opacity = 0.35 + pulse * 0.6;
      discMat.opacity = 0.05 + k * 0.2;
    }
  }

  syncEnemies(world, dt) {
    for (const [id, entry] of this.enemies) {
      if (!world.enemies.has(id)) {
        this.entities.remove(entry.obj);
        this.enemies.delete(id);
      }
    }
    const k = 1 - Math.exp(-9 * dt);
    for (const e of world.enemies.values()) {
      let entry = this.enemies.get(e.id);
      if (!entry) {
        const obj = buildAlien(e.kind);
        obj.traverse((o) => {
          if (o.isMesh) o.castShadow = true;
        });
        this.entities.add(obj);
        entry = {
          obj,
          kind: e.kind,
          up: new THREE.Vector3(...e.dir),
          fwd: new THREE.Vector3(1, 0, 0),
          body: obj.getObjectByName('body'),
          data: obj.userData,
          phase: hash01(e.id) * 10,
          flash: 0,
          born: this.clock,
        };
        this.enemies.set(e.id, entry);
        const p = entry.up.clone().multiplyScalar(world.terrain.surfaceRadius(e.dir) + 0.6);
        this.fx.burst(p, 0x6dff5a, 26, 5, 0.7);
      }
      const target = tmpV.set(...e.dir);
      const move = target.clone().sub(entry.up);
      if (move.lengthSq() > 1e-9) {
        move.addScaledVector(entry.up, -move.dot(entry.up));
        if (move.lengthSq() > 1e-10) entry.fwd.lerp(move.normalize(), 0.15);
      } else if (e.attacking) {
        // Face the reactor while attacking in place.
        const toBase = tmpV2.set(...world.baseDir).sub(entry.up);
        toBase.addScaledVector(entry.up, -toBase.dot(entry.up));
        if (toBase.lengthSq() > 1e-8) entry.fwd.lerp(toBase.normalize(), 0.05);
      }
      entry.up.lerp(target, k).normalize();
      entry.fwd.addScaledVector(entry.up, -entry.fwd.dot(entry.up)).normalize();
      const r = world.terrain.surfaceRadius([entry.up.x, entry.up.y, entry.up.z]);
      entry.obj.position.copy(entry.up).multiplyScalar(r);
      face(entry.obj, entry.up, entry.fwd);

      const t = this.clock * (e.kind === 0 ? 14 : e.kind === 1 ? 6 : 9) + entry.phase;
      entry.body.scale.setScalar(Math.min(1, (this.clock - entry.born) / 0.4));
      entry.data.legs.forEach((leg, i) => {
        leg.rotation.x = Math.sin(t + i * 1.7) * (e.attacking ? 0.15 : 0.45);
      });
      if (e.attacking) {
        entry.body.rotation.x = Math.sin(t * 1.5) * 0.18;
        entry.body.position.y = Math.abs(Math.sin(t * 1.5)) * 0.1;
      } else {
        entry.body.rotation.x = 0;
        entry.body.position.y = Math.abs(Math.sin(t)) * 0.06;
      }
      if (entry.data.sac) entry.data.sac.scale.set(0.8, 0.8, 0.9).multiplyScalar(1 + Math.sin(t * 0.7) * 0.12);
      entry.flash = Math.max(0, entry.flash - dt * 5);
      entry.data.skin.emissiveIntensity = 0.4 + entry.flash * 8;
    }
  }

  flashEnemy(id) {
    const entry = this.enemies.get(id);
    if (entry) entry.flash = 1;
  }

  /** Players are smoothed toward their latest pose; downed players are hidden. */
  syncAvatars(players, world, dt) {
    const seen = new Set();
    for (const p of players) {
      if (!p.pose || p.dead) continue;
      seen.add(p.id);
      let a = this.avatars.get(p.id);
      if (!a || a.color !== p.color || a.name !== p.name) {
        if (a) this.entities.remove(a.obj);
        const obj = buildAvatar(p.color, p.name);
        obj.traverse((o) => {
          if (o.isMesh) o.castShadow = true;
        });
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
      const teleport = a.dir.distanceTo(tmpV.set(...p.pose.d)) > 0.2;
      a.dir.lerp(tmpV.set(...p.pose.d), teleport ? 1 : k).normalize();
      a.fwd.lerp(tmpV.set(...p.pose.f), k);
      a.fwd.addScaledVector(a.dir, -a.fwd.dot(a.dir)).normalize();
      a.alt += (p.pose.h - a.alt) * k;
      const surface = world.terrain.surfaceRadius([a.dir.x, a.dir.y, a.dir.z]);
      a.obj.position.copy(a.dir).multiplyScalar(surface + a.alt);
      face(a.obj, a.dir, a.fwd);
      if (p.pose.a === 3) {
        const down = a.dir.clone().multiplyScalar(-7);
        const nozzle = a.obj.position.clone().addScaledVector(a.dir, 0.9).addScaledVector(a.fwd, -0.5);
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
    const sunV = new THREE.Vector3(...sunDir(world.simTime));
    this.setMode(focus ? 'surface' : 'orbit');

    // The sun's shadow camera follows the player so shadows stay crisp on a big planet.
    const center = focus ? tmpV.copy(focus).multiplyScalar(R) : tmpV.set(0, 0, 0);
    this.sun.target.position.copy(center);
    this.sun.position.copy(center).addScaledVector(sunV, 150);
    this.fill.position.copy(sunV).multiplyScalar(-60);
    this.sunSprite.position.copy(this.camera.position).addScaledVector(sunV, 700);
    this.atmoUniforms.uSun.value.copy(sunV);
    this.moons.forEach((m, i) => {
      const a = world.simTime * m.speed + i * 2.4;
      m.mesh.position.set(Math.cos(a) * m.dist, Math.sin(a * 0.7 + m.tilt) * m.dist * 0.4, Math.sin(a) * m.dist);
      m.mesh.rotation.y += dt * 0.05;
    });

    if (focus) {
      this.sky.update(this.camera, focus, sunV, 0);
      const day = this.sky.daylight;
      this.night = 1 - day;
      this.fog.color.copy(this.sky.horizon).lerp(this.sky.zenith, 0.12);
      this.fog.density = 0.013 + (1 - day) * 0.004;
      this.hemi.position.copy(focus);
      this.hemi.color.copy(this.sky.zenith).lerp(this.sky.horizon, 0.5);
      this.hemi.groundColor.setRGB(0.25, 0.12, 0.08);
      this.hemi.intensity = 0.35 + day * 0.6;
      this.ambient.intensity = 0.14 + (1 - day) * 0.16;
      this.sun.intensity = 2.3 * Math.max(0.05, day);
      this.sun.color.copy(this.sky.uniforms.uSunTint.value);
      this.fill.intensity = 0.12;
      this.headlamp.intensity = (1 - day) * 5;
      this.stars.material.opacity = Math.max(0, 1 - day * 1.3);
      this.sunSprite.material.opacity = day > 0.01 ? 1 : 0.3;
    } else {
      this.night = 0;
      this.scene.background.setRGB(0.008, 0.012, 0.035);
      this.hemi.intensity = 0;
      this.ambient.intensity = 0.55;
      this.sun.intensity = 2.4;
      this.sun.color.set(0xffe2c4);
      this.fill.intensity = 0.35;
      this.headlamp.intensity = 0;
      this.stars.material.opacity = 1;
      this.sunSprite.material.opacity = 1;
    }
    this.ruinsView.update(this.clock, this.night);

    if (this.reactor) {
      const hp = world.reactor.hp / world.reactor.max;
      const hurt = world.simTime - world.reactorHitAt < 0.4;
      this.reactor.core.rotation.y += dt * 0.6;
      this.reactor.core.material.emissiveIntensity = (hurt ? 6 : 2.2 + Math.sin(this.clock * 2) * 0.6) * (0.3 + hp * 0.7);
      this.reactor.rings[0].rotation.x = Math.PI / 2 + Math.sin(this.clock) * 0.2;
      this.reactor.rings[0].rotation.z += dt * 0.8;
      this.reactor.rings[1].rotation.x = Math.PI / 2 - Math.sin(this.clock * 1.3) * 0.2;
      this.reactor.rings[1].rotation.z -= dt * 1.1;
      this.reactor.beacon.visible = Math.sin(this.clock * (hp < 0.35 ? 12 : 3)) > 0;
    }
  }

  // ---- Event effects ----------------------------------------------------------

  podLanded(dir) {
    const p = new THREE.Vector3(...dir).multiplyScalar(this.surfaceAt(dir) + 1);
    this.fx.burst(p, 0x6dff5a, 140, 14, 1.4);
    this.fx.burst(p, 0xffb070, 80, 9, 1);
    this.fx.shockwave(p, 0x6dff5a, TUNING.blastRadius * 2, 0.9);
    this.shakeFrom(p, 1.2);
  }

  podDestroyed(pos) {
    const p = new THREE.Vector3(...pos);
    this.fx.burst(p, 0x6dff5a, 110, 12, 1.2);
    this.fx.burst(p, 0xffffff, 30, 6, 0.6);
    this.fx.shockwave(p, 0x6dff5a, 5, 0.6);
    this.shakeFrom(p, 0.4);
  }

  alienDeath(pos, kind) {
    const p = new THREE.Vector3(...pos);
    const big = kind === 1;
    this.fx.burst(p, 0x7dff3a, big ? 150 : 60, big ? 11 : 8, 1);
    this.fx.shockwave(p, 0x6dff5a, big ? 5 : 2.5, 0.5);
    this.shakeFrom(p, big ? 0.5 : 0.15);
  }

  acid(fromDir, toDir) {
    const a = new THREE.Vector3(...fromDir).multiplyScalar(this.surfaceAt(fromDir) + 2.6);
    const b = new THREE.Vector3(...toDir).multiplyScalar(this.surfaceAt(toDir) + 1.2);
    this.fx.beam(a, b, 0x9dff3a);
    this.fx.burst(b, 0x9dff3a, 24, 4, 0.7);
  }

  sparkle(dir, color, lift = 1) {
    const p = new THREE.Vector3(...dir);
    p.multiplyScalar(this.surfaceAt(dir) + lift + 1.5);
    this.fx.burst(p, color, 40, 5, 1);
  }

  shakeFrom(position, amount) {
    const d = position.distanceTo(this.camera.position);
    this.shake = Math.max(this.shake, amount * Math.max(0, 1 - d / 45));
  }

  update(dt, { world, players, focus, headlampPos }) {
    this.clock += dt;
    this.world = world;
    this.setWorld(world);
    this.syncEnemies(world, dt);
    this.syncStructures(world, this.clock);
    this.syncCells(world, this.clock);
    this.syncPods(world);
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
