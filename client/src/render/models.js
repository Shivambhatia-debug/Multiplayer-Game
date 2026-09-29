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
 * The Xal: armoured humanoid warriors with plasma blades.
 * 0 = Stalker (lean, fast, one green blade), 1 = Juggernaut (huge, red double-bladed staff),
 * 2 = Caster (tall, hooded, violet orb staff and an acid sac; attacks from range).
 * Returns a group with a `body` child (scaled per kind) and userData { rig, skin, sac, kind, scale }.
 */
const XAL = [
  { scale: 1.05, blade: 0x4dff6a, eye: 0x9dff6a, armor: 0x1a2420, plate: 0x0d1411, vein: 0x2dff6a },
  { scale: 1.45, blade: 0xff2a2a, eye: 0xff6a3a, armor: 0x2a1f24, plate: 0x140c10, vein: 0xff3a2a },
  { scale: 1.15, blade: 0xb45aff, eye: 0xd49aff, armor: 0x221c2c, plate: 0x110d18, vein: 0xa04aff },
];
const bladeGeo = {
  core: new THREE.CylinderGeometry(0.018, 0.018, 1, 8),
  glow: new THREE.CylinderGeometry(0.055, 0.04, 1, 10, 1, true),
  hilt: new THREE.CylinderGeometry(0.03, 0.035, 1, 8),
  orb: new THREE.SphereGeometry(0.5, 16, 12),
};
const bladeMats = new Map();
function bladeMaterials(color) {
  if (!bladeMats.has(color)) {
    const c = new THREE.Color(color);
    bladeMats.set(color, {
      core: new THREE.MeshBasicMaterial({ color: c.clone().lerp(new THREE.Color(0xffffff), 0.65).multiplyScalar(3) }),
      glow: new THREE.MeshBasicMaterial({
        color: c.clone().multiplyScalar(2.2),
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    });
  }
  return bladeMats.get(color);
}

/** A glowing plasma blade along +y from `y0`, `length` metres long. */
function plasmaBlade(color, length, y0 = 0, dir = 1) {
  const m = bladeMaterials(color);
  const g = new THREE.Group();
  const core = new THREE.Mesh(bladeGeo.core, m.core);
  core.scale.set(1, length, 1);
  core.position.y = y0 + (dir * length) / 2;
  const glow = new THREE.Mesh(bladeGeo.glow, m.glow);
  glow.scale.set(1, length * 1.02, 1);
  glow.position.y = core.position.y;
  g.add(core, glow);
  return g;
}

/** Limb segment for the Xal: shares the capsule geometry, no shadow (cheap for big waves). */
function xalSeg(parent, mat, radius, length, y) {
  const pivot = new THREE.Group();
  pivot.position.y = y;
  const seg = new THREE.Mesh(geo.capsule, mat);
  seg.scale.set(radius / 0.4, length / 1.5, radius / 0.4);
  seg.position.y = -length / 2;
  pivot.add(seg);
  parent.add(pivot);
  return pivot;
}

const xalShared = new Map();
function xalMaterials(kind) {
  if (!xalShared.has(kind)) {
    const d = XAL[kind];
    xalShared.set(kind, {
      plate: std(d.plate, { metalness: 0.75, roughness: 0.3 }),
      vein: std(d.vein, { emissive: d.vein, emissiveIntensity: 2.6 }),
      eye: std(d.eye, { emissive: d.eye, emissiveIntensity: 7 }),
      cloth: std(0x15121c, { roughness: 0.9, side: THREE.DoubleSide }),
    });
  }
  return xalShared.get(kind);
}

export function buildAlien(kind) {
  const d = XAL[kind];
  const shared = xalMaterials(kind);
  // Armour gets its own material per alien so hits can flash it.
  const skin = std(d.armor, { metalness: 0.55, roughness: 0.32, emissive: d.vein, emissiveIntensity: 0.15 });
  const g = new THREE.Group();
  const body = new THREE.Group();
  body.name = 'body';
  body.scale.setScalar(d.scale);
  g.add(body);

  const hips = new THREE.Group();
  hips.position.y = 0.98;
  body.add(hips);
  const legs = [];
  const knees = [];
  for (const x of [-0.13, 0.13]) {
    const hip = new THREE.Group();
    hip.position.x = x;
    hips.add(hip);
    const thigh = xalSeg(hip, skin, 0.1, 0.48, 0);
    thigh.add(part(geo.box, shared.plate, [0.2, 0.26, 0.12], [0, -0.2, 0.07], false));
    const knee = xalSeg(thigh, skin, 0.08, 0.46, -0.48);
    knee.add(part(geo.cone, shared.plate, [0.12, 0.16, 0.12], [0, 0.02, 0.08], false).rotateX(-0.4));
    knee.add(part(geo.box, shared.plate, [0.13, 0.08, 0.3], [0, -0.48, 0.07], false));
    legs.push(thigh);
    knees.push(knee);
  }

  const torso = new THREE.Group();
  hips.add(torso);
  const chest = part(geo.capsule, skin, [kind === 1 ? 0.7 : 0.55, 0.36, 0.42], [0, 0.34, 0], true);
  torso.add(chest);
  torso.add(part(geo.box, shared.plate, [0.5, 0.28, 0.12], [0, 0.42, 0.17], false));
  torso.add(part(geo.box, shared.vein, [0.04, 0.26, 0.02], [0, 0.4, 0.235], false));
  torso.add(part(geo.box, shared.vein, [0.36, 0.025, 0.02], [0, 0.28, 0.235], false));
  // Shoulder pauldrons, swept back.
  for (const side of [-1, 1]) {
    const pad = part(geo.ico, shared.plate, [0.3, 0.2, 0.34], [side * 0.34, 0.66, -0.02], false);
    pad.rotation.z = side * 0.5;
    torso.add(pad);
  }
  if (kind === 1) {
    // Juggernaut: spiked back plates.
    for (let i = 0; i < 4; i++) torso.add(part(geo.cone, shared.plate, [0.1, 0.36, 0.1], [(i - 1.5) * 0.14, 0.72, -0.22], false).rotateX(-0.6));
  }
  if (kind === 2) {
    // Caster: a ragged cloak and a glowing acid sac on the back.
    const cloak = part(geo.cone, shared.cloth, [0.8, 1.1, 0.55], [0, 0.08, -0.08], false);
    torso.add(cloak);
    const sac = part(geo.sphere, mats.sac, [0.42, 0.5, 0.36], [0, 0.46, -0.3], false);
    sac.name = 'sac';
    torso.add(sac);
  }

  // Elongated head with a swept crest and a glowing visor slit.
  const head = new THREE.Group();
  head.position.y = 0.8;
  torso.add(head);
  head.add(part(geo.sphere, skin, [0.24, 0.3, 0.34], [0, 0.04, 0.02], true));
  head.add(part(geo.box, shared.plate, [0.22, 0.1, 0.16], [0, -0.05, 0.12], false));
  head.add(part(geo.box, shared.eye, [0.2, 0.035, 0.03], [0, 0.07, 0.18], false));
  for (let i = 0; i < 3; i++) {
    const crest = part(geo.cone, shared.plate, [0.07, 0.34 - i * 0.06, 0.07], [0, 0.2 - i * 0.02, -0.06 - i * 0.1], false);
    crest.rotation.x = -1.1 - i * 0.15;
    head.add(crest);
  }
  if (kind === 2) head.add(part(geo.cone, shared.cloth, [0.4, 0.46, 0.44], [0, 0.18, -0.04], false));

  const arms = [];
  const elbows = [];
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * (kind === 1 ? 0.36 : 0.3), 0.6, 0);
    torso.add(shoulder);
    const upper = xalSeg(shoulder, skin, 0.08, 0.34, 0);
    const fore = xalSeg(upper, skin, 0.07, 0.32, -0.34);
    fore.add(part(geo.box, shared.plate, [0.15, 0.22, 0.15], [0, -0.14, 0], false));
    fore.add(part(geo.sphere, shared.plate, [0.11, 0.12, 0.11], [0, -0.35, 0], false));
    arms.push(upper);
    elbows.push(fore);
  }

  // The weapon sits in the right hand, pointing forward along the forearm.
  const weapon = new THREE.Group();
  weapon.position.set(0, -0.36, 0.02);
  weapon.rotation.x = Math.PI / 2;
  elbows[1].add(weapon);
  const hilt = new THREE.Mesh(bladeGeo.hilt, shared.plate);
  if (kind === 0) {
    hilt.scale.set(1, 0.26, 1);
    weapon.add(hilt, plasmaBlade(d.blade, 1.05, 0.13));
  } else if (kind === 1) {
    // Double-bladed staff held at the centre.
    hilt.scale.set(1.2, 0.7, 1.2);
    weapon.add(hilt, plasmaBlade(d.blade, 1.1, 0.35), plasmaBlade(d.blade, 1.1, -0.35, -1));
  } else {
    // A staff crowned with a violet orb and a short blade.
    hilt.scale.set(0.9, 1.5, 0.9);
    hilt.position.y = 0.2;
    const orb = new THREE.Mesh(bladeGeo.orb, bladeMaterials(d.blade).core);
    orb.scale.setScalar(0.16);
    orb.position.y = 0.98;
    const halo = new THREE.Mesh(bladeGeo.orb, bladeMaterials(d.blade).glow);
    halo.scale.setScalar(0.34);
    halo.position.y = 0.98;
    weapon.add(hilt, orb, halo, plasmaBlade(d.blade, 0.35, -0.55, -1));
  }

  g.userData = { rig: { hips, torso, head, legs, knees, arms, elbows, weapon }, skin, kind, scale: d.scale, sac: torso.getObjectByName('sac') };
  return g;
}

/** Chest height (metres) of each kind, where shots and turret bolts aim. */
export const XAL_CHEST = [1.35, 1.95, 1.5];

/**
 * Poses a Xal. `state`: idle | run | attack. `t` is the gait/attack clock.
 * Stalkers slash, Juggernauts spin their staff, Casters raise the orb and cast.
 */
export function animateXal(rig, kind, state, t) {
  const { hips, torso, head, legs, knees, arms, elbows, weapon } = rig;
  const s = Math.sin(t);
  const c = Math.cos(t);
  let stride = state === 'run' ? 0.9 : 0;
  legs[0].rotation.x = s * stride;
  legs[1].rotation.x = -s * stride;
  knees[0].rotation.x = Math.max(0, -c) * stride * 1.3;
  knees[1].rotation.x = Math.max(0, c) * stride * 1.3;
  hips.position.y = 0.98 + (stride ? Math.abs(c) * 0.06 : Math.sin(t * 0.3) * 0.01);
  torso.rotation.set(stride ? 0.28 : 0.08, 0, 0);
  head.rotation.set(stride ? -0.2 : 0, 0, 0);
  // Off hand swings; blade hand held low and forward, ready to strike.
  arms[0].rotation.set(-s * stride * 0.8, 0, -0.2);
  elbows[0].rotation.set(-0.5, 0, 0);
  arms[1].rotation.set(-0.7 + s * stride * 0.2, 0, 0.35);
  elbows[1].rotation.set(-0.6, 0, 0);
  weapon.rotation.set(Math.PI / 2 + 0.5, 0, 0);

  if (state === 'attack') {
    // Crouched stance.
    legs[0].rotation.x = -0.45;
    legs[1].rotation.x = 0.25;
    knees[0].rotation.x = 0.7;
    knees[1].rotation.x = 0.5;
    hips.position.y = 0.88;
    const k = (t % (Math.PI * 2)) / (Math.PI * 2);
    if (kind === 0) {
      // Wind up slowly, slash down fast.
      const swing = k < 0.65 ? k / 0.65 : 1 - (k - 0.65) / 0.35;
      arms[1].rotation.set(-2.6 * swing + 0.3, 0, 0.5 - swing * 0.3);
      elbows[1].rotation.set(-0.9 * swing, 0, 0);
      torso.rotation.set(0.2, -0.5 + swing * 0.7, 0);
    } else if (kind === 1) {
      // Twirl the double staff in front of the body.
      arms[1].rotation.set(-1.3, 0, 0.3);
      elbows[1].rotation.set(-0.4, 0, 0);
      weapon.rotation.set(Math.PI / 2, t * 2.2, 0);
      arms[0].rotation.set(-1.1, 0, -0.3);
      torso.rotation.set(0.15, Math.sin(t * 0.5) * 0.3, 0);
    } else {
      // Raise the orb and thrust the off hand forward to cast.
      arms[1].rotation.set(-2.4, 0, 0.2);
      elbows[1].rotation.set(-0.2, 0, 0);
      weapon.rotation.set(Math.PI / 2 - 1.2, 0, 0);
      const push = Math.max(0, Math.sin(t * 1.5));
      arms[0].rotation.set(-1.4 - push * 0.2, 0, -0.1);
      elbows[0].rotation.set(-0.2 + push * 0.2, 0, 0);
      torso.rotation.set(-0.05, 0, 0);
    }
  }
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

const SKIN = [0xf1c7a5, 0xd9a07a, 0xb57a52, 0x8d5a3b, 0x5e3a26, 0xe8b894];
const HAIR = [0x1c1410, 0x3b2616, 0x6b4a2a, 0xc9a26a, 0x2a2a2a, 0x8a3b1e];
const glassMat = new THREE.MeshPhysicalMaterial({
  color: 0xdff4ff,
  roughness: 0.04,
  metalness: 0,
  transparent: true,
  opacity: 0.2,
  depthWrite: false,
  clearcoat: 1,
});
const eyeMat = std(0x111111, { roughness: 0.3 });
const bootMat = std(0x2b2d31, { roughness: 0.8 });
const gloveMat = std(0x3a3d42, { roughness: 0.7 });
const rifleMat = std(0x2a2e34, { metalness: 0.6, roughness: 0.4 });

/** A limb segment hanging from a pivot, so rotating the pivot swings the whole segment. */
function segment(parent, mat, radius, length, y) {
  const pivot = new THREE.Group();
  pivot.position.y = y;
  const seg = new THREE.Mesh(geo.capsule, mat);
  // geo.capsule is radius 0.4, length 0.7 (total 1.5); scale it to the requested size.
  seg.scale.set(radius / 0.4, length / 1.5, radius / 0.4);
  seg.position.y = -length / 2;
  seg.castShadow = true;
  pivot.add(seg);
  parent.add(pivot);
  return pivot;
}

/**
 * A human in a pressure suit with a clear bubble helmet, so you can see the face.
 * Options: suit/accent colours, skin/hair indexes, whether they carry a rifle.
 * Returns a group whose userData.rig holds the joints used by animateHuman().
 */
export function buildHuman({ suit = 0xe6e3dc, accent = 0x7cf7d4, skin = 0, hair = 0, rifle = false, glow = true, helmet = 'bubble', pattern = 'plain', badge = null } = {}) {
  const g = new THREE.Group();
  const suitMat = std(pattern === 'camo' ? 0x9a9170 : suit, { roughness: 0.65 });
  const accentMat = glow ? std(accent, { emissive: accent, emissiveIntensity: 1.6 }) : std(accent, { roughness: 0.5 });
  const skinMat = std(SKIN[skin % SKIN.length], { roughness: 0.6 });
  const hairMat = std(HAIR[hair % HAIR.length], { roughness: 0.9 });

  const hips = new THREE.Group();
  hips.position.y = 0.95;
  g.add(hips);
  const legs = [];
  const knees = [];
  for (const x of [-0.12, 0.12]) {
    const hip = new THREE.Group();
    hip.position.x = x;
    hips.add(hip);
    const thigh = segment(hip, suitMat, 0.095, 0.46, 0);
    const knee = segment(thigh, suitMat, 0.085, 0.44, -0.46);
    const boot = part(geo.box, bootMat, [0.16, 0.12, 0.28], [0, -0.46, 0.05]);
    knee.add(boot);
    legs.push(thigh);
    knees.push(knee);
  }

  const torso = new THREE.Group();
  hips.add(torso);
  torso.add(part(geo.capsule, suitMat, [0.52, 0.34, 0.4], [0, 0.3, 0]));
  torso.add(part(geo.box, bootMat, [0.44, 0.08, 0.28], [0, 0.04, 0]));
  torso.add(part(geo.box, accentMat, [0.42, 0.05, 0.02], [0, 0.42, 0.17], false));
  torso.add(part(geo.box, mats.darkMetal, [0.36, 0.46, 0.2], [0, 0.34, -0.22]));
  torso.add(part(geo.box, accentMat, [0.04, 0.3, 0.02], [0.12, 0.34, -0.33], false));
  torso.add(part(geo.cyl, mats.metal, [0.3, 0.06, 0.3], [0, 0.62, 0]));

  const head = new THREE.Group();
  head.position.y = 0.72;
  torso.add(head);
  head.add(part(geo.sphere, skinMat, [0.2, 0.24, 0.22], [0, 0.03, 0.01]));
  head.add(part(geo.sphere, hairMat, [0.215, 0.2, 0.23], [0, 0.08, -0.02]));
  for (const x of [-0.045, 0.045]) head.add(part(geo.sphere, eyeMat, [0.03, 0.025, 0.02], [x, 0.05, 0.1], false));
  if (helmet === 'bubble') {
    head.add(part(geo.sphere, glassMat, [0.42, 0.42, 0.42], [0, 0.03, 0.01], false));
    head.add(part(geo.box, accentMat, [0.05, 0.03, 0.03], [0.14, 0.17, 0.1], false));
  } else {
    // Hard shell helmet with a mirrored visor (and, for tactical, a rail and antenna).
    head.add(part(geo.sphere, suitMat, [0.4, 0.4, 0.42], [0, 0.04, 0], true));
    head.add(part(geo.sphere, mats.visor, [0.3, helmet === 'tactical' ? 0.12 : 0.2, 0.2], [0, helmet === 'tactical' ? 0.06 : 0.03, 0.14], false));
    head.add(part(geo.box, accentMat, [0.34, 0.03, 0.05], [0, 0.2, 0.12], false));
    if (helmet === 'tactical') {
      for (const x of [-0.19, 0.19]) head.add(part(geo.box, mats.darkMetal, [0.05, 0.14, 0.24], [x, 0.04, 0], false));
      head.add(part(geo.cyl6, mats.darkMetal, [0.015, 0.3, 0.015], [-0.14, 0.34, -0.1], false));
    }
  }

  // Suit patterns: racing stripes, or camouflage blotches over a khaki suit.
  if (pattern === 'stripes') {
    for (const x of [-0.1, 0.1]) torso.add(part(geo.box, accentMat, [0.04, 0.5, 0.02], [x, 0.3, 0.2], false));
  } else if (pattern === 'camo') {
    const blotch = std(0x5a5a3c, { roughness: 0.8 });
    for (const [x, y] of [[-0.12, 0.2], [0.1, 0.4], [0.05, 0.12]]) torso.add(part(geo.sphere, blotch, [0.16, 0.12, 0.05], [x, y, 0.19], false));
  }
  // Class badge: a coloured shoulder plate.
  if (badge) torso.add(part(geo.box, std(badge, { emissive: badge, emissiveIntensity: 0.8 }), [0.14, 0.05, 0.16], [-0.3, 0.64, 0], false));

  const arms = [];
  const elbows = [];
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.27, 0.56, 0);
    torso.add(shoulder);
    const upper = segment(shoulder, suitMat, 0.075, 0.32, 0);
    upper.rotation.z = side * 0.12;
    if (pattern === 'stripes') upper.add(part(geo.box, accentMat, [0.16, 0.05, 0.16], [0, -0.1, 0], false));
    const fore = segment(upper, suitMat, 0.068, 0.3, -0.32);
    fore.add(part(geo.sphere, gloveMat, [0.1, 0.11, 0.1], [0, -0.33, 0]));
    arms.push(upper);
    elbows.push(fore);
  }

  let gun = null;
  if (rifle) {
    gun = new THREE.Group();
    gun.add(part(geo.box, rifleMat, [0.07, 0.1, 0.6], [0, 0, 0.18]));
    gun.add(part(geo.box, rifleMat, [0.05, 0.14, 0.08], [0, -0.1, 0.02]));
    gun.add(part(geo.cyl6, rifleMat, [0.04, 0.3, 0.04], [0, 0.02, 0.58], false).rotateX(Math.PI / 2));
    gun.add(part(geo.box, accentMat, [0.072, 0.02, 0.2], [0, 0.06, 0.2], false));
    // Point the barrel along the forearm, out of the gloved hand.
    gun.position.set(0, -0.33, 0.02);
    gun.rotation.x = Math.PI / 2;
    elbows[1].add(gun);
  }
  g.userData.rig = { hips, torso, head, legs, knees, arms, elbows, gun };
  return g;
}

/**
 * Poses a human rig. `state`: idle | walk | run | air | aim | type | guard | carry | sit.
 * `t` is a running animation clock.
 */
export function animateHuman(rig, state, t, aiming = false) {
  const { hips, torso, head, legs, knees, arms, elbows } = rig;
  let stride = 0;
  let swing = 0;
  if (state === 'walk' || state === 'carry') stride = 0.55;
  if (state === 'run') stride = 0.85;
  const s = Math.sin(t);
  legs[0].rotation.x = s * stride;
  legs[1].rotation.x = -s * stride;
  knees[0].rotation.x = Math.max(0, -Math.cos(t)) * stride * 1.2;
  knees[1].rotation.x = Math.max(0, Math.cos(t)) * stride * 1.2;
  swing = stride * 0.8;
  hips.position.y = 0.95 + (stride ? Math.abs(Math.cos(t)) * 0.04 : Math.sin(t * 0.25) * 0.005);
  // Lean into a run.
  torso.rotation.set(stride * (state === 'run' ? 0.2 : 0.12), 0, 0);
  head.rotation.set(0, 0, 0);
  arms[0].rotation.set(-s * swing, 0, -0.12);
  arms[1].rotation.set(s * swing, 0, 0.12);
  elbows[0].rotation.set(-0.3 - swing * 0.4, 0, 0);
  elbows[1].rotation.set(-0.3 - swing * 0.4, 0, 0);

  if (state === 'air') {
    legs[0].rotation.x = -0.5;
    legs[1].rotation.x = 0.2;
    knees[0].rotation.x = 0.9;
    knees[1].rotation.x = 0.4;
  }
  if (aiming || state === 'aim' || state === 'guard') {
    // Rifle up at shoulder height.
    arms[1].rotation.set(-1.4, 0, -0.08);
    elbows[1].rotation.set(-0.12, 0, 0);
    arms[0].rotation.set(-1.3, 0, 0.5);
    elbows[0].rotation.set(-0.7, 0, 0);
  }
  if (state === 'guard') head.rotation.y = Math.sin(t * 0.3) * 0.7;
  if (state === 'wave') {
    arms[0].rotation.set(0.1, 0, -2.7 + Math.sin(t * 9) * 0.35);
    elbows[0].rotation.set(-0.4, 0, 0);
  }
  if (state === 'cheer') {
    const hop = Math.abs(Math.sin(t * 6));
    arms[0].rotation.set(-0.2, 0, -2.6);
    arms[1].rotation.set(-0.2, 0, 2.6);
    elbows[0].rotation.set(-0.3, 0, 0);
    elbows[1].rotation.set(-0.3, 0, 0);
    hips.position.y = 0.95 + hop * 0.12;
    legs[0].rotation.x = -hop * 0.3;
    legs[1].rotation.x = -hop * 0.3;
    knees[0].rotation.x = hop * 0.6;
    knees[1].rotation.x = hop * 0.6;
  }
  if (state === 'type') {
    arms[0].rotation.set(-0.9, 0, -0.1);
    arms[1].rotation.set(-0.9, 0, 0.1);
    elbows[0].rotation.set(-0.5 + Math.sin(t * 9) * 0.08, 0, 0);
    elbows[1].rotation.set(-0.5 + Math.cos(t * 11) * 0.08, 0, 0);
    head.rotation.x = 0.25;
  }
  if (state === 'carry') {
    arms[0].rotation.set(-0.8, 0, -0.1);
    arms[1].rotation.set(-0.8, 0, 0.1);
    elbows[0].rotation.set(-0.9, 0, 0);
    elbows[1].rotation.set(-0.9, 0, 0);
  }
  if (state === 'sit') {
    hips.position.y = 0.52;
    legs[0].rotation.x = -1.45;
    legs[1].rotation.x = -1.4;
    knees[0].rotation.x = 1.45;
    knees[1].rotation.x = 1.5;
    arms[0].rotation.set(-0.4, 0, -0.15);
    arms[1].rotation.set(-0.4, 0, 0.15);
    head.rotation.set(0.15, Math.sin(t * 0.2) * 0.4, 0);
  }
}

/** A player: a human survivor in a suit trimmed with their colour, carrying a rifle. */
const CLASS_BADGE = { engineer: 0xffd166, medic: 0xff5a6a, heavy: 0x8ab4ff, scout: 0x7cf7d4 };

export function buildAvatar(color, name, style = {}, cls = 'engineer') {
  const col = new THREE.Color(color);
  const seed = [...name].reduce((a, c) => a + c.charCodeAt(0), 0);
  const g = buildHuman({
    suit: 0xe9e6df,
    accent: col,
    skin: seed,
    hair: seed >> 1,
    rifle: true,
    helmet: style.helmet || 'bubble',
    pattern: style.pattern || 'plain',
    badge: CLASS_BADGE[cls],
  });
  // Heavies carry a bigger, armoured pack.
  if (cls === 'heavy') g.userData.rig.torso.add(part(geo.box, mats.darkMetal, [0.46, 0.56, 0.26], [0, 0.34, -0.26]));
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(name, color), depthWrite: false, transparent: true }));
  label.scale.set(2.4, 0.6, 1);
  label.position.y = 2.3;
  label.name = 'label';
  g.add(label);
  return g;
}

/** The evacuation dropship ARK-7. Nose points along +Z; the rear ramp hinges at -Z. */
export function buildShip() {
  const g = new THREE.Group();
  const hullMat = std(0xd5d8dc, { metalness: 0.45, roughness: 0.4 });
  const darkMat = std(0x2c3036, { metalness: 0.6, roughness: 0.45 });
  const stripe = std(0xe0a22e, { roughness: 0.5 });
  const engineGlow = std(0x9fd8ff, { emissive: 0x4ab8ff, emissiveIntensity: 6 });
  const cockpit = std(0x10202c, { emissive: 0x2a6a8a, emissiveIntensity: 0.6, metalness: 0.9, roughness: 0.1 });
  const lights = std(0xff3a2a, { emissive: 0xff2a1a, emissiveIntensity: 5 });

  const body = part(geo.capsule, hullMat, [4.2, 5.2, 4], [0, 3, 0]);
  body.rotation.x = Math.PI / 2;
  g.add(body);
  g.add(part(geo.box, hullMat, [4.6, 2.2, 7], [0, 2.4, -1.5]));
  g.add(part(geo.box, stripe, [4.7, 0.3, 7.1], [0, 3.2, -1.5]));
  const nose = part(geo.sphere, cockpit, [2.6, 1.6, 3], [0, 3.6, 4.9]);
  g.add(nose);
  for (const side of [-1, 1]) {
    const wing = part(geo.box, hullMat, [6.5, 0.35, 4], [side * 5, 2.7, -1.8]);
    wing.rotation.z = side * -0.12;
    g.add(wing);
    g.add(part(geo.box, darkMat, [0.4, 1.4, 3], [side * 8.1, 3.1, -2.2]));
    g.add(part(geo.sphere, lights, [0.35, 0.35, 0.35], [side * 8.3, 3.9, -2.2], false));
    for (const z of [-4.5, -2.5]) {
      const pod = part(geo.cyl, darkMat, [1.4, 2.2, 1.4], [side * 3.3, 2.4, z]);
      pod.rotation.x = Math.PI / 2;
      g.add(pod);
    }
    const glow = part(geo.cyl, engineGlow, [1.2, 0.3, 1.2], [side * 3.3, 1.2, -3.5], false);
    glow.name = 'engine';
    g.add(glow);
    for (const z of [-3.5, 2]) {
      g.add(part(geo.cyl, darkMat, [0.2, 1.4, 0.2], [side * 1.8, 0.7, z]));
      g.add(part(geo.box, darkMat, [0.7, 0.12, 0.9], [side * 1.8, 0.06, z]));
    }
  }
  g.add(part(geo.box, darkMat, [0.5, 2.4, 2.2], [0, 5.1, -4]));
  const ramp = new THREE.Group();
  ramp.position.set(0, 1.4, -5.1);
  ramp.name = 'ramp';
  ramp.add(part(geo.box, darkMat, [2.6, 0.18, 3.2], [0, 0, -1.6]));
  ramp.add(part(geo.box, stripe, [2.62, 0.2, 0.25], [0, 0, -3.1]));
  g.add(ramp);
  g.userData.engines = [];
  g.traverse((o) => {
    if (o.name === 'engine') g.userData.engines.push(o);
  });
  g.userData.engineMat = engineGlow;
  return g;
}

/**
 * The Xal mothership that hangs over the colony on boss waves: a dark armoured wedge with
 * a spinning ring and a glowing green core underneath (its weak point).
 */
export function buildMothership() {
  const g = new THREE.Group();
  const hull = std(0x141a18, { metalness: 0.75, roughness: 0.35, emissive: 0x0b2a14, emissiveIntensity: 0.3 });
  const plate = std(0x0a0e0c, { metalness: 0.85, roughness: 0.3 });
  const glow = std(0x7dff6a, { emissive: 0x4dff3a, emissiveIntensity: 5 });
  const body = part(geo.ico1, hull, [26, 5, 34], [0, 0, 0], false);
  g.add(body);
  g.add(part(geo.ico1, plate, [14, 4, 22], [0, 2.6, -2], false));
  for (const side of [-1, 1]) {
    const fin = part(geo.box, plate, [1.2, 3.5, 16], [side * 9, 2.2, -6], false);
    fin.rotation.z = side * 0.35;
    g.add(fin);
    for (let i = 0; i < 5; i++) g.add(part(geo.box, glow, [0.5, 0.3, 1.4], [side * (5 + i * 1.7), -1.6, 8 - i * 3.2], false));
  }
  for (let i = 0; i < 3; i++) g.add(part(geo.cone, plate, [3, 12, 3], [(i - 1) * 7, 0, 16 + (i === 1 ? 3 : 0)], false).rotateX(Math.PI / 2));
  const ring = new THREE.Mesh(geo.torus, glow);
  ring.scale.set(9, 9, 18);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -2.6;
  ring.name = 'ring';
  g.add(ring);
  const core = part(geo.sphere, std(0xb6ff9a, { emissive: 0x7dff4a, emissiveIntensity: 9 }), [5, 5, 5], [0, -3.2, 0], false);
  core.name = 'core';
  g.add(core);
  const halo = new THREE.Mesh(
    geo.sphere,
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0x6dff4a).multiplyScalar(1.6), transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  halo.scale.setScalar(11);
  halo.position.y = -3.2;
  halo.name = 'halo';
  g.add(halo);
  return g;
}

/** A holographic data terminal marker: a tall gold light pillar and a spinning diamond. */
export function buildLogBeacon() {
  const g = new THREE.Group();
  const beamMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0xffc24a).multiplyScalar(1.8),
    transparent: true,
    opacity: 0.35,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.6, 40, 12, 1, true), beamMat);
  beam.position.y = 20;
  g.add(beam);
  const gem = part(new THREE.OctahedronGeometry(0.6), std(0xffd166, { emissive: 0xffb020, emissiveIntensity: 5 }), [1, 1.4, 1], [0, 3.2, 0], false);
  gem.name = 'gem';
  g.add(gem);
  return g;
}
