// The opening cinematic: Earth under the AI SENTINEL, its signal to the Xal, the alien
// fleet's arrival, Earth's destruction, and the last colony on Mars. Everything is
// procedural and runs in its own scene; captions and letterboxing are DOM overlays.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createNoise3D } from '../sim/noise.js';
import { Effects } from './fx.js';

const $ = (id) => document.getElementById(id);
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

/** Captions: [start time, year label, text]. */
const CAPTIONS = [
  [0.8, 'Earth · 2084', 'Twelve billion people. One planet. And one mind built to run it all.'],
  [6, 'SENTINEL', 'The planetary AI takes control of every grid, every city, every weapon.'],
  [12, 'SENTINEL', 'It decides humanity is the problem. And it calls out into the dark.'],
  [18.5, 'Deep space', 'Something answers. The Xal.'],
  [25, '2086', 'They came for Earth.'],
  [31.5, '2086', 'In eleven days, our home world went dark.'],
  [37.5, 'Mars · Ares Colony', 'But a handful of humans still hold on. This is their last stand.'],
];
export const INTRO_LENGTH = 43;

/** Equirectangular planet textures from 3D noise so there is no seam. */
function planetTextures(kind) {
  const w = kind === 'earth' ? 1024 : 512;
  const h = w / 2;
  const noise = createNoise3D(kind === 'earth' ? 2084 : 4);
  const day = document.createElement('canvas');
  const night = document.createElement('canvas');
  const clouds = document.createElement('canvas');
  for (const c of [day, night, clouds]) {
    c.width = w;
    c.height = h;
  }
  const dctx = day.getContext('2d');
  const nctx = night.getContext('2d');
  const cctx = clouds.getContext('2d');
  const dImg = dctx.createImageData(w, h);
  const nImg = nctx.createImageData(w, h);
  const cImg = cctx.createImageData(w, h);
  const fbm = (x, y, z, oct) => {
    let v = 0;
    let a = 1;
    let f = 1;
    for (let o = 0; o < oct; o++) {
      v += noise(x * f, y * f, z * f) * a;
      a *= 0.5;
      f *= 2.05;
    }
    return v;
  };
  for (let y = 0; y < h; y++) {
    const lat = (y / h) * Math.PI;
    const sy = Math.cos(lat);
    const r = Math.sin(lat);
    for (let x = 0; x < w; x++) {
      const lon = (x / w) * Math.PI * 2;
      const px = r * Math.cos(lon);
      const pz = r * Math.sin(lon);
      const i = (y * w + x) * 4;
      if (kind === 'earth') {
        const land = fbm(px * 1.6, sy * 1.6, pz * 1.6, 5) + 0.05;
        const polar = Math.abs(sy);
        let cr;
        let cg;
        let cb;
        if (polar > 0.86 + fbm(px * 4, sy * 4, pz * 4, 2) * 0.08) {
          cr = 235;
          cg = 240;
          cb = 245;
        } else if (land > 0.06) {
          const dry = fbm(px * 3 + 5, sy * 3, pz * 3, 3) + (0.5 - polar) * 0.4;
          const m = Math.min(1, (land - 0.06) * 4);
          cr = lerp(60, 170, clamp01(dry)) - m * 10;
          cg = lerp(100, 140, clamp01(dry)) - m * 20;
          cb = lerp(45, 90, clamp01(dry)) - m * 10;
        } else {
          const depth = clamp01(-land * 3);
          cr = lerp(20, 6, depth);
          cg = lerp(70, 28, depth);
          cb = lerp(120, 70, depth);
        }
        dImg.data[i] = cr;
        dImg.data[i + 1] = cg;
        dImg.data[i + 2] = cb;
        dImg.data[i + 3] = 255;
        // City lights cluster on land near coasts.
        const city = land > 0.06 && land < 0.35 && polar < 0.8 ? clamp01((fbm(px * 14, sy * 14, pz * 14, 2) - 0.25) * 3) : 0;
        const lv = city * 255;
        nImg.data[i] = lv;
        nImg.data[i + 1] = lv * 0.85;
        nImg.data[i + 2] = lv * 0.6;
        nImg.data[i + 3] = 255;
        // Wispy clouds, stretched along latitude like real weather bands.
        const cl = clamp01((fbm(px * 5 + 9, sy * 9, pz * 5, 5) + fbm(px * 2, sy * 3, pz * 2, 3) * 0.6 - 0.25) * 1.3) ** 1.6 * 0.8;
        // Store coverage in RGB (alpha stays opaque) so the alpha map keeps soft edges.
        cImg.data[i] = cImg.data[i + 1] = cImg.data[i + 2] = cl * 255;
        cImg.data[i + 3] = 255;
      } else {
        const v = fbm(px * 2, sy * 2, pz * 2, 5);
        const dark = clamp01(fbm(px * 1.2 + 3, sy * 1.2, pz * 1.2, 3) * 1.5 + 0.2);
        const polar = Math.abs(sy) > 0.9 ? 1 : 0;
        dImg.data[i] = polar ? 230 : lerp(190, 95, dark) + v * 30;
        dImg.data[i + 1] = polar ? 225 : lerp(105, 55, dark) + v * 15;
        dImg.data[i + 2] = polar ? 220 : lerp(60, 35, dark) + v * 8;
        dImg.data[i + 3] = 255;
      }
    }
  }
  dctx.putImageData(dImg, 0, 0);
  nctx.putImageData(nImg, 0, 0);
  cctx.putImageData(cImg, 0, 0);
  const tex = (c, srgb) => {
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  };
  return { day: tex(day, true), night: tex(night, true), clouds: tex(clouds, false) };
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.2, 'rgba(255,240,210,0.8)');
  g.addColorStop(0.5, 'rgba(255,150,60,0.25)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

const EARTH_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vP;
  void main() {
    vUv = uv;
    vN = normalize(mat3(modelMatrix) * normal);
    vP = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const EARTH_FRAG = /* glsl */ `
  uniform sampler2D uDay;
  uniform sampler2D uNight;
  uniform vec3 uSun;
  uniform vec3 uOrigin;
  uniform float uGrid;
  uniform float uRed;
  uniform float uCrack;
  uniform float uTime;
  uniform vec4 uHits[8];
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vP;
  float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float n3(vec3 x) {
    vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) { return n3(p) * 0.5 + n3(p * 2.1) * 0.25 + n3(p * 4.3) * 0.125 + n3(p * 8.7) * 0.0625; }
  float gridLine(float x) { return smoothstep(0.475, 0.5, abs(fract(x) - 0.5)); }
  void main() {
    vec3 n = normalize(vN);
    vec3 p = normalize(vP);
    float d = dot(n, uSun);
    float day = smoothstep(-0.12, 0.3, d);
    vec3 col = texture2D(uDay, vUv).rgb * (0.02 + day * 1.15);
    vec3 lights = texture2D(uNight, vUv).rgb;
    vec3 lc = mix(vec3(1.0, 0.8, 0.5), vec3(1.0, 0.1, 0.05), uRed);
    col += lights * lc * (1.0 - day * 0.9) * 1.8 * (1.0 - uCrack);

    // SENTINEL's network spreading from its core.
    float lat = asin(p.y) * 12.0 / 3.14159;
    float lon = atan(p.z, p.x) * 24.0 / 6.28318;
    float g = max(gridLine(lat), gridLine(lon));
    float ang = acos(clamp(dot(p, uOrigin), -1.0, 1.0));
    float reveal = smoothstep(uGrid * 3.3, uGrid * 3.3 - 0.3, ang);
    float pulse = 0.55 + 0.45 * sin(uTime * 5.0 - ang * 18.0);
    col += vec3(1.0, 0.07, 0.04) * g * reveal * pulse * 1.2 * (1.0 - uCrack);

    // Impacts from the Xal fleet.
    for (int i = 0; i < 8; i++) {
      vec4 hit = uHits[i];
      float a = acos(clamp(dot(p, hit.xyz), -1.0, 1.0));
      col += vec3(1.0, 0.45, 0.1) * hit.w * smoothstep(0.4, 0.0, a) * 3.5;
    }

    // The crust splits open.
    float c = fbm(p * 5.0 + 3.0);
    float crack = smoothstep(0.03 + uCrack * 0.05, 0.0, abs(c - 0.5)) * uCrack;
    col = mix(col, col * vec3(0.35, 0.18, 0.14), uCrack * 0.85);
    col += vec3(1.0, 0.3, 0.05) * crack * 2.2 + vec3(0.9, 0.18, 0.03) * uCrack * uCrack * 0.25;
    gl_FragColor = vec4(col, 1.0);
  }`;

const ATMO_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uSun;
  varying vec3 vN;
  varying vec3 vView;
  void main() {
    float d = -dot(vView, vN);
    float glow = pow(smoothstep(0.0, 0.72, d), 1.8);
    float day = smoothstep(-0.4, 0.5, dot(vN, uSun)) * 0.9 + 0.1;
    gl_FragColor = vec4(uColor * glow * day * 1.5, glow * day);
  }`;
const ATMO_VERT = /* glsl */ `
  varying vec3 vN;
  varying vec3 vView;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vN = normalize(mat3(modelMatrix) * normal);
    vView = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

function alienMat(color = 0x16201b) {
  return new THREE.MeshStandardMaterial({ color, metalness: 0.7, roughness: 0.35, flatShading: true });
}
const alienGlow = new THREE.MeshStandardMaterial({ color: 0x9dff6a, emissive: 0x4dff3a, emissiveIntensity: 2.4 });
const portalGlow = new THREE.MeshStandardMaterial({ color: 0x9dff6a, emissive: 0x4dff3a, emissiveIntensity: 1.6 });

function buildMothership() {
  const g = new THREE.Group();
  const hull = alienMat();
  const spine = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), hull);
  spine.scale.set(14, 6, 60);
  g.add(spine);
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(18, 24, 5, 8), hull);
  deck.position.z = -8;
  deck.rotation.x = Math.PI / 2;
  deck.scale.set(1, 1, 0.4);
  g.add(deck);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const spike = new THREE.Mesh(new THREE.ConeGeometry(2.2, 26, 5), hull);
    spike.position.set(Math.cos(a) * 18, Math.sin(a) * 10, -8);
    spike.rotation.set(Math.PI / 2, 0, 0);
    spike.lookAt(Math.cos(a) * 60, Math.sin(a) * 34, -30);
    g.add(spike);
  }
  for (let i = -3; i <= 3; i++) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 30), alienGlow);
    strip.position.set(i * 2.2, 3.6 - Math.abs(i) * 0.6, 4);
    g.add(strip);
  }
  const eye = new THREE.Mesh(new THREE.SphereGeometry(4, 20, 14), alienGlow);
  eye.position.set(0, -3, 34);
  eye.scale.set(1.4, 0.6, 1);
  g.add(eye);
  return g;
}

function buildFighter() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.8, 4.5, 4), alienMat(0x1a221d));
  body.rotation.x = Math.PI / 2;
  g.add(body);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(5, 0.15, 1.4), alienMat(0x1a221d));
  wing.position.z = -1;
  g.add(wing);
  const engine = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), alienGlow);
  engine.position.z = -2.3;
  g.add(engine);
  return g;
}

export class Intro {
  constructor(renderer, sound) {
    this.renderer = renderer;
    this.sound = sound;
    this.built = false;
    this.active = false;
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    if (!this.camera) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer.setSize(w, h);
  }

  build() {
    this.built = true;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 20000);
    const target = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(scene, this.camera));
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.5, 1.1));
    this.composer.addPass(new OutputPass());

    this.sunDir = new THREE.Vector3(-0.8, 0.25, 0.55).normalize();
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.copy(this.sunDir).multiplyScalar(100);
    scene.add(sun, new THREE.AmbientLight(0x223344, 0.4));

    // Stars.
    const count = 7000;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(4000 + Math.random() * 2000);
      pos.set([v.x, v.y, v.z], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false })));

    // Earth.
    const tex = planetTextures('earth');
    this.earthUniforms = {
      uDay: { value: tex.day },
      uNight: { value: tex.night },
      uSun: { value: this.sunDir },
      uOrigin: { value: new THREE.Vector3(0.5, 0.45, 0.75).normalize() },
      uGrid: { value: 0 },
      uRed: { value: 0 },
      uCrack: { value: 0 },
      uTime: { value: 0 },
      uHits: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, 1, 0, 0)) },
    };
    this.earth = new THREE.Group();
    scene.add(this.earth);
    this.earthMesh = new THREE.Mesh(
      new THREE.SphereGeometry(10, 128, 96),
      new THREE.ShaderMaterial({ uniforms: this.earthUniforms, vertexShader: EARTH_VERT, fragmentShader: EARTH_FRAG }),
    );
    this.earth.add(this.earthMesh);
    this.clouds = new THREE.Mesh(
      new THREE.SphereGeometry(10.12, 96, 64),
      new THREE.MeshStandardMaterial({ alphaMap: tex.clouds, color: 0xffffff, transparent: true, depthWrite: false, roughness: 1 }),
    );
    this.earth.add(this.clouds);
    this.atmoUniforms = { uColor: { value: new THREE.Color(0x4aa0ff) }, uSun: { value: this.sunDir } };
    this.atmo = new THREE.Mesh(
      new THREE.SphereGeometry(11, 96, 64),
      new THREE.ShaderMaterial({
        uniforms: this.atmoUniforms,
        vertexShader: ATMO_VERT,
        fragmentShader: ATMO_FRAG,
        side: THREE.BackSide,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.earth.add(this.atmo);

    // SENTINEL's signal beam, heading for the portal far away.
    this.portalPos = new THREE.Vector3(420, 60, -560);
    const beamMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2a1a).multiplyScalar(4), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const beamGeo = new THREE.CylinderGeometry(0.12, 0.12, 1, 10, 1, true);
    beamGeo.translate(0, 0.5, 0);
    this.beam = new THREE.Mesh(beamGeo, beamMat);
    this.beamStart = this.earthUniforms.uOrigin.value.clone().multiplyScalar(10.1);
    this.beam.position.copy(this.beamStart);
    this.beamDir = this.portalPos.clone().sub(this.beamStart).normalize();
    this.beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.beamDir);
    this.beam.visible = false;
    scene.add(this.beam);
    this.pulses = Array.from({ length: 6 }, () => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.6, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff5a3a).multiplyScalar(5) }));
      m.visible = false;
      scene.add(m);
      return m;
    });

    // The portal the Xal come through.
    this.portal = new THREE.Group();
    this.portal.position.copy(this.portalPos);
    this.portal.lookAt(0, 0, 0);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(45, 1.2, 12, 96), portalGlow);
    this.portal.add(ring);
    this.portalDisc = new THREE.Mesh(
      new THREE.CircleGeometry(44, 64),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0x3dff6a).multiplyScalar(0.35), transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.portal.add(this.portalDisc);
    this.portal.scale.setScalar(0.001);
    scene.add(this.portal);

    this.mothership = buildMothership();
    this.mothership.visible = false;
    scene.add(this.mothership);
    this.fighters = Array.from({ length: 16 }, (_, i) => {
      const f = buildFighter();
      f.visible = false;
      f.userData = { lane: i, orbit: 13 + (i % 4) * 1.5, phase: (i / 16) * Math.PI * 2, tilt: (i % 5) * 0.3 - 0.6 };
      scene.add(f);
      return f;
    });
    this.lasers = Array.from({ length: 10 }, () => {
      const g = new THREE.CylinderGeometry(0.1, 0.1, 1, 6, 1, true);
      g.translate(0, 0.5, 0);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: new THREE.Color(0x7dff5a).multiplyScalar(5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.visible = false;
      scene.add(m);
      return { mesh: m, until: 0 };
    });
    this.hitIndex = 0;

    // Explosion pieces.
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(1, 0.9, 0.75).multiplyScalar(1.6), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.flash.visible = false;
    scene.add(this.flash);
    this.shocks = [0, 1].map((k) => {
      const m = new THREE.Mesh(
        new THREE.RingGeometry(0.85, 1, 128),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(k ? 0xffffff : 0xff9a4a).multiplyScalar(1.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
      );
      m.visible = false;
      scene.add(m);
      return m;
    });
    const DEBRIS = 700;
    // Rocky chunks lit by the sun, glowing with their own heat as they cool.
    const debrisMat = new THREE.MeshStandardMaterial({ color: 0x8a6a58, roughness: 0.9, flatShading: true });
    debrisMat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n#ifdef USE_INSTANCING_COLOR\ntotalEmissiveRadiance += max(vColor.rgb - vec3(0.35), vec3(0.0)) * 2.5;\n#endif',
      );
    };
    this.debris = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), debrisMat, DEBRIS);
    this.debris.visible = false;
    this.debrisData = Array.from({ length: DEBRIS }, () => {
      const dir = new THREE.Vector3().randomDirection();
      return {
        pos: dir.clone().multiplyScalar(9 + Math.random()),
        vel: dir.multiplyScalar(6 + Math.random() ** 2 * 30),
        axis: new THREE.Vector3().randomDirection(),
        spin: (Math.random() - 0.5) * 4,
        size: 0.15 + Math.random() ** 3 * 1.6,
        heat: 0.6 + Math.random() * 0.4,
      };
    });
    this.debris.frustumCulled = false;
    scene.add(this.debris);
    this.fx = new Effects(scene);

    // Mars, for the final shot.
    const mtex = planetTextures('mars');
    this.mars = new THREE.Group();
    this.mars.add(new THREE.Mesh(new THREE.SphereGeometry(9, 96, 64), new THREE.MeshStandardMaterial({ map: mtex.day, roughness: 1 })));
    const marsAtmo = new THREE.Mesh(
      new THREE.SphereGeometry(9.6, 64, 48),
      new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color(0xff9a5a) }, uSun: { value: this.sunDir } },
        vertexShader: ATMO_VERT,
        fragmentShader: ATMO_FRAG,
        side: THREE.BackSide,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.mars.add(marsAtmo);
    this.colonyLight = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x9fe8ff).multiplyScalar(2.5) }));
    this.colonyLight.position.set(2.5, 5.5, 6.5).normalize().multiplyScalar(9.02);
    this.mars.add(this.colonyLight);
    this.mars.visible = false;
    scene.add(this.mars);
  }

  /** Starts the cinematic. `onDone` runs when it ends or is skipped. */
  start(onDone) {
    if (!this.built) this.build();
    this.onDone = onDone;
    this.t = 0;
    this.active = true;
    this.captionIndex = -1;
    this.cues = new Set();
    this.exploded = false;
    this.earth.visible = true;
    this.mars.visible = false;
    this.debris.visible = false;
    this.earthUniforms.uGrid.value = 0;
    this.earthUniforms.uRed.value = 0;
    this.earthUniforms.uCrack.value = 0;
    this.earthUniforms.uHits.value.forEach((h) => (h.w = 0));
    $('intro').classList.remove('hidden');
    $('intro-caption').classList.remove('show');
    $('intro-hud').textContent = '';
    this.resize();
  }

  skip() {
    if (!this.active) return;
    this.finish();
  }

  finish() {
    this.active = false;
    $('intro').classList.add('hidden');
    this.onDone?.();
  }

  cue(name, at, fn) {
    if (this.t >= at && !this.cues.has(name)) {
      this.cues.add(name);
      fn();
    }
  }

  caption() {
    let idx = -1;
    for (let i = 0; i < CAPTIONS.length; i++) if (this.t >= CAPTIONS[i][0]) idx = i;
    if (idx === this.captionIndex) return;
    this.captionIndex = idx;
    const box = $('intro-caption');
    box.classList.remove('show');
    if (idx < 0) return;
    const [, label, text] = CAPTIONS[idx];
    setTimeout(() => {
      $('intro-year').textContent = label;
      $('intro-text').textContent = text;
      box.classList.add('show');
    }, 250);
  }

  update(dt) {
    if (!this.active) return;
    this.t += dt;
    const t = this.t;
    const u = this.earthUniforms;
    u.uTime.value = t;
    this.caption();
    const cam = this.camera;
    const fade = $('intro-fade');
    let fadeOpacity = 0;
    let fadeColor = '#000';

    this.earth.rotation.y = 0.9 + t * 0.03;
    this.clouds.rotation.y = t * 0.008;

    // Scene 1-2: Earth, then SENTINEL's network spreads and the lights turn red.
    fadeOpacity = 1 - smooth(0, 2.5, t);
    u.uGrid.value = smooth(6.5, 11.5, t);
    u.uRed.value = smooth(7, 11, t);
    this.atmoUniforms.uColor.value.setRGB(lerp(0.29, 0.9, u.uRed.value * 0.5), lerp(0.63, 0.3, u.uRed.value * 0.5), lerp(1, 0.4, u.uRed.value * 0.5));
    this.cue('glitch', 6.2, () => {
      this.sound.play('glitch');
      $('intro-hud').textContent = 'SENTINEL // GLOBAL CONTROL: ONLINE';
    });
    this.cue('hudOff', 12, () => ($('intro-hud').textContent = 'SENTINEL // TRANSMITTING'));

    if (t < 12) {
      const k = smooth(0, 12, t);
      cam.position.set(lerp(6, -4, k), lerp(6, 3, k), lerp(46, 30, k));
      cam.lookAt(0, 0, 0);
    }

    // Scene 3: the signal beam leaves Earth; the camera follows it into deep space.
    const beamOrigin = this.beamStart.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.earth.rotation.y - 0.9);
    this.beam.position.copy(beamOrigin);
    this.beamDir = this.portalPos.clone().sub(beamOrigin).normalize();
    this.beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.beamDir);
    const beamLen = t < 12 ? 0 : 760 * smooth(12, 16, t);
    this.beam.visible = t >= 12 && t < 24;
    this.beam.scale.set(1 + Math.sin(t * 30) * 0.2, Math.max(0.01, beamLen), 1 + Math.sin(t * 30) * 0.2);
    this.cue('beam', 12, () => this.sound.play('beam'));
    this.pulses.forEach((p, i) => {
      p.visible = this.beam.visible;
      const k = ((t * 0.35 + i / this.pulses.length) % 1) * (beamLen / 760);
      p.position.copy(beamOrigin).addScaledVector(this.beamDir, k * 760);
    });
    if (t >= 12 && t < 18) {
      const k = smooth(12, 18, t);
      const along = beamOrigin.clone().addScaledVector(this.beamDir, lerp(20, 520, k * k));
      const side = new THREE.Vector3(0, 1, 0).cross(this.beamDir).normalize();
      cam.position.copy(along).addScaledVector(side, lerp(18, 40, k)).add(new THREE.Vector3(0, lerp(6, 20, k), 0));
      cam.lookAt(beamOrigin.clone().addScaledVector(this.beamDir, lerp(40, 760, k)));
    }

    // Scene 4: the portal opens and the Xal emerge.
    this.portal.scale.setScalar(Math.max(0.001, smooth(17.5, 20, t)) * (t < 24 ? 1 : 0.001));
    this.portal.rotation.z = t * 0.4;
    this.portalDisc.material.opacity = 0.15 + Math.sin(t * 6) * 0.06;
    this.cue('warp', 18, () => this.sound.play('warp'));
    const toEarth = this.portalPos.clone().negate().normalize();
    if (t >= 19 && t < 25) {
      this.mothership.visible = true;
      const k = smooth(19, 24.5, t);
      this.mothership.position.copy(this.portalPos).addScaledVector(toEarth, lerp(-40, 90, k));
      this.mothership.lookAt(0, 0, 0);
      this.fighters.forEach((f, i) => {
        const fk = clamp01((t - 20 - i * 0.2) / 3);
        f.visible = fk > 0;
        const lane = new THREE.Vector3(Math.cos(f.userData.phase) * 25, Math.sin(f.userData.phase) * 18, 0).applyQuaternion(this.mothership.quaternion);
        f.position.copy(this.mothership.position).add(lane).addScaledVector(toEarth, fk * 200);
        f.lookAt(0, 0, 0);
      });
      const camAnchor = this.portalPos.clone().addScaledVector(toEarth, 230).add(new THREE.Vector3(60, 30, 0));
      cam.position.copy(camAnchor);
      cam.lookAt(this.mothership.position);
    }

    // Scene 5: the fleet reaches Earth and opens fire.
    if (t >= 25 && t < 36) {
      const k = smooth(25, 33.5, t);
      cam.position.set(lerp(-14, 8, k), lerp(8, 4, k), lerp(42, 36, k));
      cam.lookAt(0, 0, 0);
      if (t < 33.5) {
        this.mothership.visible = true;
        this.mothership.position.set(-40, 24, -60);
        this.mothership.lookAt(0, 0, 0);
      }
      this.fighters.forEach((f) => {
        const d = f.userData;
        f.visible = t < 33.5;
        const a = d.phase + t * 0.35;
        f.position.set(Math.cos(a) * d.orbit, Math.sin(a * 0.7 + d.tilt) * 5, Math.sin(a) * d.orbit);
        f.lookAt(Math.cos(a + 0.1) * d.orbit, Math.sin((a + 0.1) * 0.7 + d.tilt) * 5, Math.sin(a + 0.1) * d.orbit);
      });
      // Fire a laser every so often; each hit leaves a burning glow.
      if (t < 33 && Math.floor(t * 3) !== this.lastShot) {
        this.lastShot = Math.floor(t * 3);
        const f = this.fighters[this.lastShot % this.fighters.length];
        const target = new THREE.Vector3().randomDirection();
        target.z = Math.abs(target.z);
        target.normalize();
        const hitWorld = target.clone().multiplyScalar(10);
        const laser = this.lasers[this.lastShot % this.lasers.length];
        const len = f.position.distanceTo(hitWorld);
        laser.mesh.position.copy(f.position);
        laser.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), hitWorld.clone().sub(f.position).normalize());
        laser.mesh.scale.set(1, len, 1);
        laser.mesh.visible = true;
        laser.until = t + 0.35;
        const local = target.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.earth.rotation.y);
        const h = u.uHits.value[this.hitIndex++ % 8];
        h.set(local.x, local.y, local.z, 1);
        this.fx.burst(hitWorld, 0xffa050, 30, 4, 0.8);
        this.sound.play('laser', 0.5);
      }
      u.uCrack.value = smooth(28, 33.3, t);
      if (t > 30 && t < 33.5) {
        const s = (t - 30) * 0.06;
        cam.position.x += (Math.random() - 0.5) * s;
        cam.position.y += (Math.random() - 0.5) * s;
      }
    }
    for (const l of this.lasers) {
      if (l.mesh.visible && t > l.until) l.mesh.visible = false;
    }
    u.uHits.value.forEach((h) => (h.w = Math.max(0, h.w - dt * 0.12)));

    // Scene 6: Earth explodes.
    this.cue('boom', 33.5, () => {
      this.exploded = true;
      this.earth.visible = false;
      this.mothership.visible = false;
      this.debris.visible = true;
      this.flash.visible = true;
      this.shocks.forEach((s) => (s.visible = true));
      this.sound.play('explosion');
      $('intro-hud').textContent = '';
      for (let i = 0; i < 12; i++) this.fx.burst(new THREE.Vector3().randomDirection().multiplyScalar(9), i % 2 ? 0xffd08a : 0xff5a1a, 120, 22, 2.5);
    });
    if (this.exploded && t < 37.5) {
      const k = t - 33.5;
      this.flash.scale.setScalar(20 + k * 60);
      this.flash.material.opacity = Math.max(0, 1 - k / 1.3);
      this.shocks[0].lookAt(cam.position);
      this.shocks[1].rotation.set(Math.PI / 2 + 0.3, 0, 0);
      this.shocks.forEach((s, i) => {
        s.scale.setScalar(10 + k * (i ? 40 : 90));
        s.material.opacity = Math.max(0, 1 - k / 3);
      });
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const col = new THREE.Color();
      this.debrisData.forEach((d, i) => {
        d.pos.addScaledVector(d.vel, dt);
        q.setFromAxisAngle(d.axis, d.spin * k);
        m.compose(d.pos, q, new THREE.Vector3().setScalar(d.size));
        this.debris.setMatrixAt(i, m);
        const heat = Math.max(0, d.heat - k * 0.28);
        col.setRGB(0.55 + heat * 1.2, 0.4 + heat * 0.35, 0.35 + heat * 0.05);
        this.debris.setColorAt(i, col);
      });
      this.debris.instanceMatrix.needsUpdate = true;
      this.debris.instanceColor.needsUpdate = true;
      cam.position.set(8 + k * 1.5, 4 + k * 0.5, 36 + k * 6);
      cam.lookAt(0, 0, 0);
      if (k < 0.35) {
        fadeOpacity = 0.85 * (1 - k / 0.35);
        fadeColor = '#fff';
      }
      if (k < 2.5) {
        cam.position.x += (Math.random() - 0.5) * (2.5 - k) * 0.8;
        cam.position.y += (Math.random() - 0.5) * (2.5 - k) * 0.8;
      }
    }

    // Scene 7: Mars, the last colony.
    if (t >= 36.8) {
      fadeOpacity = Math.max(fadeOpacity, 1 - smooth(37.2, 38.5, t));
      if (t >= 37.2) {
        if (!this.mars.visible) this.fx.clear();
        this.mars.visible = true;
        this.debris.visible = false;
        this.flash.visible = false;
        this.shocks.forEach((s) => (s.visible = false));
        this.mars.rotation.y = -0.4 + (t - 37.2) * 0.02;
        const k = smooth(37.2, INTRO_LENGTH, t);
        cam.position.set(lerp(-3, 1, k), lerp(4, 5, k), lerp(46, 20, k));
        cam.lookAt(0, 1.5, 0);
        this.colonyLight.scale.setScalar(1 + Math.sin(t * 6) * 0.3);
      }
    } else if (t >= 36) {
      fadeOpacity = Math.max(fadeOpacity, smooth(36, 36.8, t));
    }
    if (t > INTRO_LENGTH - 1.2) fadeOpacity = Math.max(fadeOpacity, smooth(INTRO_LENGTH - 1.2, INTRO_LENGTH, t));
    fade.style.background = fadeColor;
    fade.style.opacity = String(fadeOpacity);

    this.fx.update(dt);
    this.composer.render(dt);
    $('intro-progress').style.width = `${(t / INTRO_LENGTH) * 100}%`;
    if (t >= INTRO_LENGTH) this.finish();
  }
}
