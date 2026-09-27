// Procedural models: colony defences, the reactor, the Xal, drop pods and pilots.
// Geometries and materials are shared so large waves stay cheap to draw.
import * as THREE from 'three';

const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.1, ...extra });

export const mats = {
  metal: std(0x9aa3ae, { metalness: 0.7, roughness: 0.38 }),
  darkMetal: std(0x2e333b, { metalness: 0.6, roughness: 0.5 }),
  hull: std(0xd9dee4, { roughness: 0.5 }),
  concrete: std(0x8f8781, { roughness: 0.95, flatShading: true }),
  hazard: std(0xf2b233, { roughness: 0.6 }),
  redEye: std(0xff3b2a, { emissive: 0xff2a1a, emissiveIntensity: 5 }),
  coil: std(0xffd166, { emissive: 0xffb020, emissiveIntensity: 3.5 }),
  medGlow: std(0x7cf7d4, { emissive: 0x3dffc0, emissiveIntensity: 3.5 }),
  reactorCore: std(0x9fe8ff, { emissive: 0x39b8ff, emissiveIntensity: 2.5 }),
  reactorRing: std(0x9fe8ff, { emissive: 0x39b8ff, emissiveIntensity: 1.6 }),
  reactorGlass: new THREE.MeshPhysicalMaterial({
    color: 0x8fd8ff,
    roughness: 0.05,
    metalness: 0,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
  }),
  cell: std(0x8ff7ff, { emissive: 0x2fe6ff, emissiveIntensity: 3.6, roughness: 0.2 }),
  chitin: std(0x1c2622, { emissive: 0x0b3a1c, emissiveIntensity: 0.4, flatShading: true, roughness: 0.45, metalness: 0.2 }),
  bruteHide: std(0x2a2330, { emissive: 0x2a0b1a, emissiveIntensity: 0.4, flatShading: true, roughness: 0.6 }),
  alienEye: std(0x9dff6a, { emissive: 0x6dff3a, emissiveIntensity: 7 }),
  bruteEye: std(0xff6a3a, { emissive: 0xff3a1a, emissiveIntensity: 7 }),
  sac: std(0xb6ff5a, { emissive: 0x7dff2a, emissiveIntensity: 3, transparent: true, opacity: 0.9 }),
  podShell: std(0x1a1f1c, { emissive: 0x2dff6a, emissiveIntensity: 1.4, flatShading: true, roughness: 0.4, fog: false }),
  trail: new THREE.MeshBasicMaterial({
    color: new THREE.Color(0x6dff8a).multiplyScalar(2.5),
    transparent: true,
    opacity: 0.45,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  }),
  visor: std(0x0b1020, { emissive: 0x4ad8ff, emissiveIntensity: 0.6, metalness: 0.9, roughness: 0.1 }),
};

const geo = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 12),
  cyl6: new THREE.CylinderGeometry(0.5, 0.5, 1, 6),
  oct: new THREE.CylinderGeometry(0.5, 0.6, 1, 8),
  sphere: new THREE.SphereGeometry(0.5, 16, 12),
  ico: new THREE.IcosahedronGeometry(0.5, 0),
  ico1: new THREE.IcosahedronGeometry(0.5, 1),
  torus: new THREE.TorusGeometry(1, 0.06, 8, 40),
  cone: new THREE.ConeGeometry(0.5, 1, 6),
  trail: new THREE.CylinderGeometry(0.05, 1.05, 10, 10, 1, true),
  warnRing: new THREE.RingGeometry(3.6, 4, 56),
  warnDisc: new THREE.CircleGeometry(4, 56),
  capsule: new THREE.CapsuleGeometry(0.4, 0.7, 6, 12),
};
geo.trail.translate(0, 5, 0);

export function hash01(id) {
  let x = Math.imul(id, 2654435761) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return (x % 1000) / 1000;
}

/** A mesh from a unit primitive, scaled and positioned in one call. */
function part(g, m, [sx, sy, sz], [x, y, z] = [0, 0, 0], cast = true) {
  const o = new THREE.Mesh(g, m);
  o.scale.set(sx, sy, sz);
  o.position.set(x, y, z);
  o.castShadow = cast;
  o.receiveShadow = true;
  return o;
}

const builders = {
  turret() {
    const g = new THREE.Group();
    g.add(part(geo.oct, mats.darkMetal, [2, 0.4, 2], [0, 0.2, 0]));
    g.add(part(geo.cyl, mats.metal, [0.5, 1.1, 0.5], [0, 0.9, 0]));
    const head = new THREE.Group();
    head.name = 'head';
    head.position.y = 1.6;
    head.add(part(geo.box, mats.hull, [0.9, 0.6, 1.1]));
    head.add(part(geo.box, mats.hazard, [0.92, 0.12, 0.5], [0, 0.26, -0.2]));
    for (const x of [-0.2, 0.2]) {
      const barrel = part(geo.cyl6, mats.darkMetal, [0.14, 1.1, 0.14], [x, 0, 0.9]);
      barrel.rotation.x = Math.PI / 2;
      head.add(barrel);
    }
    head.add(part(geo.sphere, mats.redEye, [0.18, 0.18, 0.18], [0, 0.1, 0.56], false));
    g.add(head);
    return g;
  },
  generator() {
    const g = new THREE.Group();
    g.add(part(geo.box, mats.darkMetal, [2, 0.3, 1.4], [0, 0.15, 0]));
    g.add(part(geo.box, mats.hull, [1.7, 1.1, 1.2], [0, 0.85, 0]));
    for (const x of [-0.55, 0, 0.55]) g.add(part(geo.box, mats.darkMetal, [0.12, 0.8, 1.22], [x, 0.85, 0]));
    g.add(part(geo.cyl, mats.metal, [0.25, 1.1, 0.25], [0.6, 1.9, -0.3]));
    const coil = part(geo.torus, mats.coil, [0.45, 0.45, 0.45], [0, 1.55, 0], false);
    coil.rotation.x = Math.PI / 2;
    coil.name = 'spin';
    g.add(coil);
    return g;
  },
  medbay() {
    const g = new THREE.Group();
    g.add(part(geo.cyl, mats.hull, [2.2, 0.25, 2.2], [0, 0.12, 0]));
    g.add(part(geo.cyl, mats.metal, [0.3, 1.8, 0.3], [0, 1.1, 0]));
    const cross = new THREE.Group();
    cross.position.y = 2.2;
    cross.name = 'spin';
    cross.add(part(geo.box, mats.medGlow, [0.9, 0.3, 0.3], [0, 0, 0], false));
    cross.add(part(geo.box, mats.medGlow, [0.3, 0.9, 0.3], [0, 0, 0], false));
    g.add(cross);
    const ring = part(geo.torus, mats.medGlow, [1.6, 1.6, 1.6], [0, 0.3, 0], false);
    ring.rotation.x = Math.PI / 2;
    ring.name = 'pulse';
    g.add(ring);
    return g;
  },
  barricade() {
    const g = new THREE.Group();
    for (const x of [-1.05, 0, 1.05]) {
      g.add(part(geo.box, mats.concrete, [1, 1.3, 0.7], [x, 0.65, 0]));
    }
    g.add(part(geo.box, mats.hazard, [3.1, 0.14, 0.72], [0, 1.1, 0]));
    g.add(part(geo.box, mats.darkMetal, [3.2, 0.1, 0.8], [0, 1.35, 0]));
    return g;
  },
};

export function buildStructure(type) {
  const g = builders[type]();
  g.userData.type = type;
  return g;
}

/** A translucent copy used to preview placement. */
export function buildGhost(type) {
  const g = builders[type]();
  const ok = new THREE.MeshBasicMaterial({ color: 0x7cf7d4, transparent: true, opacity: 0.45, depthWrite: false });
  g.traverse((o) => {
    if (o.isMesh) {
      o.material = ok;
      o.castShadow = false;
    }
  });
  g.userData.material = ok;
  return g;
}

/** The colony reactor: the thing the whole team is defending. */
export function buildReactor() {
  const g = new THREE.Group();
  g.add(part(geo.oct, mats.darkMetal, [5.4, 0.8, 5.4], [0, 0.4, 0]));
  g.add(part(geo.oct, mats.metal, [4.2, 0.5, 4.2], [0, 1.05, 0]));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    g.add(part(geo.box, mats.hull, [0.45, 4.6, 0.45], [Math.cos(a) * 1.7, 3.3, Math.sin(a) * 1.7]));
    g.add(part(geo.box, mats.hazard, [0.5, 0.3, 0.5], [Math.cos(a) * 1.7, 1.5, Math.sin(a) * 1.7]));
  }
  const core = part(geo.ico1, mats.reactorCore, [1.5, 2.6, 1.5], [0, 3.2, 0], false);
  core.name = 'core';
  g.add(core);
  g.add(part(geo.cyl, mats.reactorGlass, [2.4, 4.2, 2.4], [0, 3.2, 0], false));
  g.add(part(geo.oct, mats.darkMetal, [3.2, 0.5, 3.2], [0, 5.7, 0]));
  g.add(part(geo.cyl, mats.metal, [0.3, 2, 0.3], [0, 6.9, 0]));
  const beacon = part(geo.sphere, mats.redEye, [0.4, 0.4, 0.4], [0, 8, 0], false);
  beacon.name = 'beacon';
  g.add(beacon);
  for (let i = 0; i < 2; i++) {
    const ring = part(geo.torus, mats.reactorRing, [2, 2, 2], [0, 2.4 + i * 1.6, 0], false);
    ring.name = `ring${i}`;
    g.add(ring);
  }
  return g;
}

/** A glowing power cell lying on the ground. */
export function buildCell() {
  const g = new THREE.Group();
  const body = new THREE.Group();
  body.add(part(geo.cyl, mats.cell, [0.32, 0.7, 0.32], [0, 0.5, 0], false));
  body.add(part(geo.cyl6, mats.darkMetal, [0.4, 0.14, 0.4], [0, 0.15, 0]));
  body.add(part(geo.cyl6, mats.darkMetal, [0.4, 0.14, 0.4], [0, 0.88, 0]));
  body.rotation.z = 0.25;
  g.add(body);
  return g;
}

/** An alien drop pod falling from orbit. */
export function buildPod() {
  const g = new THREE.Group();
  const shell = part(geo.ico1, mats.podShell, [1.6, 2.4, 1.6], [0, 0, 0], false);
  shell.name = 'rock';
  g.add(shell);
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
    fog: false,
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

/**
 * The Xal. 0 = drone (fast six-legged hunter), 1 = brute (hulking tank),
 * 2 = spitter (tall, with a glowing acid sac). Returns a group with a `body`
 * child for animation, `legs` for gait and a per-alien `skin` material for hit flashes.
 */
export function buildAlien(kind) {
  const g = new THREE.Group();
  const body = new THREE.Group();
  body.name = 'body';
  const skin = (kind === 1 ? mats.bruteHide : mats.chitin).clone();
  const eye = kind === 1 ? mats.bruteEye : mats.alienEye;
  const legs = [];
  const leg = (x, z, len, thick, spread) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.55 * len, z);
    const l = part(geo.cyl6, skin, [thick, len, thick], [0, -len * 0.45, 0]);
    pivot.add(l);
    pivot.rotation.z = spread;
    body.add(pivot);
    legs.push(pivot);
  };
  if (kind === 0) {
    body.add(part(geo.ico1, skin, [0.9, 0.55, 1.3], [0, 0.75, 0]));
    body.add(part(geo.ico, skin, [0.55, 0.45, 0.6], [0, 0.85, 0.8]));
    for (const x of [-0.14, 0.14]) body.add(part(geo.sphere, eye, [0.12, 0.12, 0.12], [x, 0.95, 1.08], false));
    for (const x of [-0.12, 0.12]) body.add(part(geo.cone, skin, [0.08, 0.5, 0.08], [x, 0.7, 1.2]));
    for (const z of [-0.4, 0, 0.4]) {
      leg(0.4, z, 1.1, 0.07, 0.9);
      leg(-0.4, z, 1.1, 0.07, -0.9);
    }
  } else if (kind === 1) {
    body.add(part(geo.ico1, skin, [1.9, 1.7, 1.6], [0, 1.9, 0]));
    body.add(part(geo.ico, skin, [0.9, 0.8, 0.9], [0, 2.3, 0.95]));
    for (const x of [-0.22, 0.22]) body.add(part(geo.sphere, eye, [0.16, 0.16, 0.16], [x, 2.4, 1.38], false));
    for (const x of [-1.05, 1.05]) body.add(part(geo.box, skin, [0.5, 1.7, 0.55], [x, 1.3, 0.4]));
    for (let i = 0; i < 5; i++) body.add(part(geo.cone, skin, [0.22, 0.8, 0.22], [(i - 2) * 0.35, 2.75, -0.35 - Math.abs(i - 2) * 0.1]));
    leg(0.5, -0.2, 1.3, 0.3, 0.15);
    leg(-0.5, -0.2, 1.3, 0.3, -0.15);
  } else {
    body.add(part(geo.ico1, skin, [0.7, 1.3, 0.7], [0, 1.6, 0]));
    body.add(part(geo.cyl6, skin, [0.2, 0.9, 0.2], [0, 2.5, 0.2]));
    body.add(part(geo.ico, skin, [0.45, 0.4, 0.6], [0, 2.95, 0.4]));
    for (const x of [-0.12, 0.12]) body.add(part(geo.sphere, eye, [0.1, 0.1, 0.1], [x, 3.02, 0.68], false));
    const sac = part(geo.sphere, mats.sac, [0.8, 0.8, 0.9], [0, 1.7, -0.55], false);
    sac.name = 'sac';
    body.add(sac);
    for (const z of [-0.3, 0.3]) {
      leg(0.3, z, 1.4, 0.08, 0.5);
      leg(-0.3, z, 1.4, 0.08, -0.5);
    }
  }
  g.add(body);
  g.userData = { skin, legs, sac: body.getObjectByName('sac') };
  return g;
}

function labelTexture(name, color) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.font = '600 30px "Chakra Petch", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const w = Math.min(250, ctx.measureText(name).width + 34);
  ctx.fillStyle = 'rgba(6, 10, 20, 0.62)';
  ctx.beginPath();
  ctx.roundRect((256 - w) / 2, 8, w, 48, 12);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillText(name, 128, 33);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A survivor in an EVA suit with a coloured helmet stripe and backpack light. */
export function buildAvatar(color, name) {
  const g = new THREE.Group();
  const col = new THREE.Color(color);
  const suit = std(0xd8d4cc, { roughness: 0.6 });
  const trim = std(col, { roughness: 0.4, metalness: 0.2 });
  const glow = std(col, { emissive: col, emissiveIntensity: 2.6 });
  const body = new THREE.Group();
  body.name = 'body';
  body.add(part(geo.capsule, suit, [1, 1, 1], [0, 0.95, 0]));
  body.add(part(geo.box, trim, [0.82, 0.14, 0.62], [0, 1.05, 0]));
  body.add(part(geo.sphere, suit, [0.62, 0.6, 0.62], [0, 1.55, 0]));
  body.add(part(geo.sphere, mats.visor, [0.48, 0.34, 0.3], [0, 1.57, 0.2]));
  body.add(part(geo.box, mats.darkMetal, [0.52, 0.62, 0.3], [0, 1.05, -0.38]));
  body.add(part(geo.box, glow, [0.4, 0.08, 0.05], [0, 1.2, -0.54], false));
  body.add(part(geo.box, mats.darkMetal, [0.13, 0.13, 0.6], [0.46, 0.98, 0.3]));
  g.add(body);
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(name, color), depthWrite: false, transparent: true }));
  label.scale.set(2.4, 0.6, 1);
  label.position.y = 2.45;
  label.name = 'label';
  g.add(label);
  return g;
}
