// Procedural low-poly models. Geometries and materials are shared so hundreds of
// structures stay cheap to draw.
import * as THREE from 'three';

const geo = {
  pylonBase: new THREE.CylinderGeometry(0.45, 0.6, 0.4, 8),
  pylonPole: new THREE.CylinderGeometry(0.09, 0.12, 2.2, 6),
  pylonPanel: new THREE.BoxGeometry(1.9, 0.08, 1.15),
  bulb: new THREE.SphereGeometry(0.12, 8, 6),
  scrubBody: new THREE.CylinderGeometry(0.8, 0.95, 1.0, 10),
  scrubRing: new THREE.TorusGeometry(0.72, 0.09, 8, 28),
  blade: new THREE.BoxGeometry(1.2, 0.04, 0.22),
  stack: new THREE.CylinderGeometry(0.13, 0.16, 0.9, 8),
  tank: new THREE.SphereGeometry(0.72, 18, 12),
  leg: new THREE.CylinderGeometry(0.06, 0.08, 1.1, 5),
  condRing: new THREE.TorusGeometry(0.82, 0.05, 6, 32),
  heatBase: new THREE.CylinderGeometry(0.9, 1.1, 0.5, 8),
  heatCore: new THREE.OctahedronGeometry(0.55, 0),
  cage: new THREE.BoxGeometry(0.1, 1.5, 0.1),
  pod: new THREE.SphereGeometry(0.28, 10, 8),
  trunk: new THREE.CylinderGeometry(0.1, 0.16, 1.1, 6),
  pine: new THREE.ConeGeometry(0.75, 1.5, 7),
  pineTop: new THREE.ConeGeometry(0.52, 1.1, 7),
  blob: new THREE.IcosahedronGeometry(0.8, 0),
  ore: new THREE.OctahedronGeometry(0.34, 0),
  rock: new THREE.IcosahedronGeometry(1.3, 0),
  trail: new THREE.CylinderGeometry(0.05, 1.05, 10, 10, 1, true),
  warnRing: new THREE.RingGeometry(4.1, 4.5, 56),
  warnDisc: new THREE.CircleGeometry(4.5, 56),
  capsule: new THREE.CapsuleGeometry(0.4, 0.7, 6, 12),
  visor: new THREE.SphereGeometry(0.3, 14, 10),
  pack: new THREE.BoxGeometry(0.46, 0.55, 0.24),
  hoverRing: new THREE.TorusGeometry(0.45, 0.04, 6, 24),
  gun: new THREE.BoxGeometry(0.12, 0.12, 0.5),
};
geo.pineTop.translate(0, 0.6, 0);
geo.trail.translate(0, 5, 0);

const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.1, ...extra });

export const mats = {
  metal: std(0xaab4c3, { metalness: 0.65, roughness: 0.35 }),
  darkMetal: std(0x3a4150, { metalness: 0.6, roughness: 0.45 }),
  hull: std(0xe3e9f1, { roughness: 0.45 }),
  panel: std(0x1b2a6b, { emissive: 0x2a5cff, emissiveIntensity: 0.55, metalness: 0.8, roughness: 0.2 }),
  bulb: std(0xffe39a, { emissive: 0xffc94a, emissiveIntensity: 4 }),
  scrubGlow: std(0x3dffa0, { emissive: 0x3dffa0, emissiveIntensity: 3.5 }),
  tank: new THREE.MeshPhysicalMaterial({
    color: 0x7fdcff,
    emissive: 0x1b8fd6,
    emissiveIntensity: 0.7,
    roughness: 0.08,
    metalness: 0.1,
    transparent: true,
    opacity: 0.85,
    clearcoat: 1,
  }),
  condGlow: std(0x5cc8ff, { emissive: 0x5cc8ff, emissiveIntensity: 3.8 }),
  heatCore: std(0xff7a2a, { emissive: 0xff5a1a, emissiveIntensity: 7 }),
  pod: std(0xb6ff7a, { emissive: 0x7dff3a, emissiveIntensity: 3 }),
  bark: std(0x6b4a33, { roughness: 0.95 }),
  ore: std(0x8ff7ff, { emissive: 0x2fe6ff, emissiveIntensity: 3.6, roughness: 0.2, metalness: 0.3 }),
  rock: std(0x4a2f25, { emissive: 0xff4a12, emissiveIntensity: 8, flatShading: true, roughness: 1 }),
  trail: new THREE.MeshBasicMaterial({
    color: new THREE.Color(0xff8a3a).multiplyScalar(3),
    transparent: true,
    opacity: 0.5,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  }),
  visor: std(0x0b1020, { emissive: 0x4ad8ff, emissiveIntensity: 0.6, metalness: 0.9, roughness: 0.1 }),
};

const FOLIAGE = [0x3f9e4a, 0x4fb35a, 0x2f8a5a, 0x6cbf3f, 0x2d7a3d, 0x8fcf4a];
const foliageMats = FOLIAGE.map((c) => std(c, { flatShading: true, roughness: 0.85 }));
/** Glow materials whose brightness follows the power grid. */
export const poweredMats = [mats.scrubGlow, mats.condGlow, mats.heatCore, mats.tank];
const poweredBase = poweredMats.map((m) => m.emissiveIntensity);
export function setGridPower(p) {
  poweredMats.forEach((m, i) => {
    m.emissiveIntensity = poweredBase[i] * (0.15 + 0.85 * p);
  });
}

function mesh(g, m, y = 0, cast = true) {
  const o = new THREE.Mesh(g, m);
  o.position.y = y;
  o.castShadow = cast;
  o.receiveShadow = true;
  return o;
}

export function hash01(id) {
  let x = Math.imul(id, 2654435761) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return (x % 1000) / 1000;
}

const builders = {
  pylon() {
    const g = new THREE.Group();
    g.add(mesh(geo.pylonBase, mats.metal, 0.2));
    g.add(mesh(geo.pylonPole, mats.metal, 1.3));
    const panel = mesh(geo.pylonPanel, mats.panel, 2.45);
    panel.rotation.x = -0.45;
    g.add(panel);
    const bulb = mesh(geo.bulb, mats.bulb, 2.8, false);
    bulb.name = 'blink';
    g.add(bulb);
    return g;
  },
  scrubber() {
    const g = new THREE.Group();
    g.add(mesh(geo.scrubBody, mats.hull, 0.5));
    const ring = mesh(geo.scrubRing, mats.scrubGlow, 1.02, false);
    ring.rotation.x = Math.PI / 2;
    g.add(ring);
    const fan = new THREE.Group();
    fan.position.y = 1.08;
    for (let i = 0; i < 3; i++) {
      const b = mesh(geo.blade, mats.darkMetal);
      b.rotation.y = (i / 3) * Math.PI * 2;
      fan.add(b);
    }
    fan.name = 'spin';
    g.add(fan);
    const s1 = mesh(geo.stack, mats.metal, 1.1);
    s1.position.x = 0.55;
    s1.position.z = 0.35;
    g.add(s1);
    return g;
  },
  condenser() {
    const g = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const l = mesh(geo.leg, mats.metal, 0.5);
      const a = (i / 3) * Math.PI * 2;
      l.position.x = Math.cos(a) * 0.45;
      l.position.z = Math.sin(a) * 0.45;
      g.add(l);
    }
    g.add(mesh(geo.tank, mats.tank, 1.35));
    const ring = mesh(geo.condRing, mats.condGlow, 1.35, false);
    ring.rotation.x = Math.PI / 2;
    ring.name = 'bob';
    g.add(ring);
    return g;
  },
  heater() {
    const g = new THREE.Group();
    g.add(mesh(geo.heatBase, mats.darkMetal, 0.25));
    const core = mesh(geo.heatCore, mats.heatCore, 1.25, false);
    core.name = 'spin';
    g.add(core);
    for (let i = 0; i < 4; i++) {
      const c = mesh(geo.cage, mats.metal, 1.2);
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      c.position.x = Math.cos(a) * 0.72;
      c.position.z = Math.sin(a) * 0.72;
      g.add(c);
    }
    return g;
  },
  seed(id) {
    const g = new THREE.Group();
    const pod = mesh(geo.pod, mats.pod, 0.25, false);
    pod.name = 'pod';
    g.add(pod);
    const tree = new THREE.Group();
    tree.name = 'tree';
    tree.add(mesh(geo.trunk, mats.bark, 0.55));
    const h = hash01(id);
    const leaf = foliageMats[Math.floor(h * foliageMats.length)];
    if (h < 0.55) {
      tree.add(mesh(geo.pine, leaf, 1.55));
      tree.add(mesh(geo.pineTop, leaf, 1.85));
    } else {
      const b = mesh(geo.blob, leaf, 1.6);
      b.scale.set(1, 0.9 + h * 0.3, 1);
      tree.add(b);
    }
    g.add(tree);
    return g;
  },
};

export function buildStructure(type, id) {
  const g = builders[type](id);
  g.userData.type = type;
  return g;
}

/** A translucent copy used to preview placement. */
export function buildGhost(type) {
  const g = builders[type](7);
  const ok = new THREE.MeshBasicMaterial({ color: 0x7cf7d4, transparent: true, opacity: 0.45, depthWrite: false });
  g.traverse((o) => {
    if (o.isMesh) {
      o.material = ok;
      o.castShadow = false;
    }
  });
  if (type === 'seed') g.getObjectByName('tree').visible = false;
  g.userData.material = ok;
  return g;
}

export function buildOre() {
  const g = new THREE.Group();
  const specs = [
    [0, 0.55, 0, 1.6, 0],
    [0.3, 0.35, 0.15, 1.0, 0.5],
    [-0.25, 0.3, -0.2, 0.9, -0.6],
  ];
  for (const [x, y, z, s, r] of specs) {
    const c = mesh(geo.ore, mats.ore, y, false);
    c.position.x = x;
    c.position.z = z;
    c.scale.set(s * 0.8, s * 1.6, s * 0.8);
    c.rotation.z = r;
    g.add(c);
  }
  return g;
}

export function buildMeteor() {
  const g = new THREE.Group();
  const rock = mesh(geo.rock, mats.rock, 0, false);
  rock.name = 'rock';
  g.add(rock);
  const trail = new THREE.Mesh(geo.trail, mats.trail);
  trail.name = 'trail';
  g.add(trail);
  return g;
}

export function buildWarning() {
  const g = new THREE.Group();
  const ringMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0xff3b3b).multiplyScalar(2.5),
    transparent: true,
    opacity: 0.8,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const discMat = ringMat.clone();
  discMat.opacity = 0.12;
  const ring = new THREE.Mesh(geo.warnRing, ringMat);
  const disc = new THREE.Mesh(geo.warnDisc, discMat);
  ring.rotation.x = disc.rotation.x = -Math.PI / 2;
  ring.position.y = 0.35;
  disc.position.y = 0.3;
  g.add(ring, disc);
  g.userData.mats = [ringMat, discMat];
  return g;
}

function labelTexture(name, color) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.font = '600 30px "Space Grotesk", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const w = Math.min(250, ctx.measureText(name).width + 34);
  ctx.fillStyle = 'rgba(6, 10, 20, 0.62)';
  ctx.beginPath();
  ctx.roundRect((256 - w) / 2, 8, w, 48, 24);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillText(name, 128, 33);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildAvatar(color, name) {
  const g = new THREE.Group();
  const col = new THREE.Color(color);
  const suit = std(col, { roughness: 0.4, metalness: 0.25 });
  const glow = std(col, { emissive: col, emissiveIntensity: 4 });
  const body = new THREE.Group();
  body.name = 'body';
  body.add(mesh(geo.capsule, suit, 0.95));
  const visor = mesh(geo.visor, mats.visor, 1.3);
  visor.scale.set(1, 0.65, 0.7);
  visor.position.z = 0.24;
  body.add(visor);
  const pack = mesh(geo.pack, glow, 1.0);
  pack.position.z = -0.38;
  body.add(pack);
  const gun = mesh(geo.gun, mats.darkMetal, 0.95);
  gun.position.set(0.48, 0, 0.25);
  gun.position.y = 0.95;
  body.add(gun);
  g.add(body);
  const ring = mesh(geo.hoverRing, glow, 0.08, false);
  ring.rotation.x = Math.PI / 2;
  g.add(ring);
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(name, color), depthWrite: false, transparent: true }));
  label.scale.set(2.4, 0.6, 1);
  label.position.y = 2.35;
  label.name = 'label';
  g.add(label);
  return g;
}
