// The colony's surviving scientists going about their work, and the evacuation dropship
// that lands on the pad when the beacon is charged. Both are cosmetic and driven purely
// by the shared simulation clock, so every client sees the same thing.
import * as THREE from 'three';
import { buildHuman, animateHuman, buildShip } from './models.js';
import { colonyFrame, localToDir, PAD } from '../sim/ruins.js';

const tmpM = new THREE.Matrix4();
const right = new THREE.Vector3();

/** Places `obj` at colony coords (x, z) standing on the ground, facing `yaw` (0 = north). */
function placeLocal(obj, world, frame, x, z, yaw, lift = 0) {
  const dir = localToDir(frame, x, z);
  const up = new THREE.Vector3(...dir);
  const north = new THREE.Vector3(...frame.north);
  const east = new THREE.Vector3(...frame.east);
  const fwd = north.multiplyScalar(Math.cos(yaw)).addScaledVector(east, Math.sin(yaw));
  fwd.addScaledVector(up, -fwd.dot(up)).normalize();
  obj.position.copy(up).multiplyScalar(world.terrain.surfaceRadius(dir) + lift);
  right.crossVectors(up, fwd).normalize();
  tmpM.makeBasis(right, up, fwd);
  obj.quaternion.setFromRotationMatrix(tmpM);
  return { up, fwd };
}

/** What each survivor does: [role, x, z, yaw (deg), extra]. */
const ROLES = [
  ['type', 4.6, 4.6, 45],
  ['type', -5.1, 4.2, -45],
  ['guard', -5.2, -3.4, 225],
  ['guard', 0.5, 8.2, 0],
  ['carry', -5, -2, 90],
  ['sit', -11, -1, 90],
];

export const RESCUE = { descend: 8, rampOpen: 9.5, board: 16, rampClose: 17.5, gone: 24 };

export class Survivors {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.people = [];
    this.ship = buildShip();
    this.ship.visible = false;
    scene.add(this.ship);
    this.shipLight = new THREE.PointLight(0x9fd8ff, 0, 40, 1.2);
    scene.add(this.shipLight);
    this.seed = null;
  }

  build(world) {
    if (this.seed === world.seed) return;
    this.seed = world.seed;
    this.group.clear();
    this.people = [];
    this.frame = colonyFrame(world.baseDir);
    ROLES.forEach(([role, x, z, yaw], i) => {
      const obj = buildHuman({
        suit: i % 2 ? 0xf2efe8 : 0xdad6ce,
        accent: role === 'guard' ? 0xe0a22e : 0xff7a3a,
        skin: i * 2 + 1,
        hair: i + 2,
        rifle: role === 'guard',
        glow: false,
      });
      obj.traverse((o) => {
        if (o.isMesh) o.castShadow = true;
      });
      if (role === 'carry') {
        const crate = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.4), new THREE.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 0.8 }));
        crate.position.set(0, 1.12, 0.38);
        crate.castShadow = true;
        obj.add(crate);
      }
      if (role === 'sit') {
        const seat = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.6), new THREE.MeshStandardMaterial({ color: 0x5a6068, roughness: 0.7 }));
        placeLocal(seat, world, this.frame, x, z - 0.05, (yaw * Math.PI) / 180, 0.25);
        this.group.add(seat);
      }
      this.group.add(obj);
      this.people.push({ obj, role, x, z, yaw: (yaw * Math.PI) / 180, phase: i * 1.7, board: null });
    });
  }

  /** Where the ship's ramp meets the ground, in world space. */
  rampFoot(world) {
    const dir = localToDir(this.frame, PAD.x + 6.5, PAD.z);
    return new THREE.Vector3(...dir).multiplyScalar(world.terrain.surfaceRadius(dir));
  }

  update(dt, clock, world, avatars) {
    this.build(world);
    const rescueT = world.phase === 'won' ? world.simTime - world.endedAt : -1;
    this.updateShip(world, rescueT);

    for (const p of this.people) {
      if (rescueT >= RESCUE.rampOpen) {
        this.board(p, world, rescueT, clock);
        continue;
      }
      p.obj.visible = true;
      let { x, z, yaw } = p;
      let state = p.role;
      if (p.role === 'carry') {
        // Walk back and forth across the plaza with a crate.
        const k = (Math.sin(clock * 0.18 + p.phase) + 1) / 2;
        const going = Math.cos(clock * 0.18 + p.phase) > 0;
        x = -5 + k * 10;
        z = -2 - k * 1.5;
        yaw = going ? Math.PI / 2 : -Math.PI / 2;
        state = 'carry';
      }
      placeLocal(p.obj, world, this.frame, x, z, yaw);
      animateHuman(p.obj.userData.rig, state, clock * (state === 'carry' ? 5 : 1) + p.phase);
    }

    // Players walk up the ramp too.
    for (const a of avatars) {
      if (rescueT >= RESCUE.rampOpen) this.board(a, world, rescueT, clock);
      else a.board = null;
    }
  }

  /** Moves a person from wherever they were toward the ramp, then hides them inside. */
  board(p, world, t, clock) {
    const foot = this.rampFoot(world);
    if (!p.board) p.board = { from: p.obj.position.clone(), delay: Math.random() * 1.5 };
    const k = Math.max(0, Math.min(1, (t - RESCUE.rampOpen - p.board.delay) / (RESCUE.board - RESCUE.rampOpen - 2)));
    if (k >= 1) {
      p.obj.visible = false;
      return;
    }
    const pos = p.board.from.clone().lerp(foot, k);
    const up = pos.clone().normalize();
    pos.copy(up).multiplyScalar(world.terrain.surfaceRadius([up.x, up.y, up.z]));
    const fwd = foot.clone().sub(pos);
    fwd.addScaledVector(up, -fwd.dot(up));
    if (fwd.lengthSq() > 1e-6) {
      fwd.normalize();
      right.crossVectors(up, fwd).normalize();
      tmpM.makeBasis(right, up, fwd);
      p.obj.quaternion.setFromRotationMatrix(tmpM);
    }
    p.obj.position.copy(pos);
    p.obj.visible = true;
    if (p.obj.userData.rig) animateHuman(p.obj.userData.rig, 'run', clock * 9 + (p.phase || 0));
  }

  /** Descend, open the ramp, wait for everyone, close up and leave. */
  updateShip(world, t) {
    const ship = this.ship;
    if (t < 0 || t > RESCUE.gone + 2) {
      ship.visible = false;
      this.shipLight.intensity = 0;
      return;
    }
    ship.visible = true;
    const padDir = localToDir(this.frame, PAD.x, PAD.z);
    const up = new THREE.Vector3(...padDir);
    const ground = world.terrain.surfaceRadius(padDir) + 0.3;
    let alt = 0;
    let drift = 0;
    if (t < RESCUE.descend) {
      const k = t / RESCUE.descend;
      alt = 90 * (1 - k) ** 3;
    } else if (t > RESCUE.rampClose) {
      const k = t - RESCUE.rampClose;
      alt = k * k * 2.2;
      drift = k * k * 1.4;
    }
    const fwdW = new THREE.Vector3(...this.frame.east).multiplyScalar(-1);
    fwdW.addScaledVector(up, -fwdW.dot(up)).normalize();
    ship.position.copy(up).multiplyScalar(ground + alt).addScaledVector(fwdW, drift);
    right.crossVectors(up, fwdW).normalize();
    tmpM.makeBasis(right, up, fwdW);
    ship.quaternion.setFromRotationMatrix(tmpM);
    if (t > RESCUE.rampClose) ship.rotateX(-Math.min(0.35, (t - RESCUE.rampClose) * 0.06));

    // Ramp: closed (up), opens after landing, closes before take-off.
    const ramp = ship.getObjectByName('ramp');
    let open = 0;
    if (t > RESCUE.descend && t < RESCUE.rampClose) open = Math.min(1, (t - RESCUE.descend) / 1.2);
    if (t >= RESCUE.board) open = Math.max(0, 1 - (t - RESCUE.board) / 1.2);
    ramp.rotation.x = Math.PI / 2 - open * (Math.PI / 2 + 0.45);

    const thrust = t < RESCUE.descend ? 1 : t > RESCUE.rampClose ? 1.4 : 0.35;
    ship.userData.engineMat.emissiveIntensity = 3 + thrust * 5 + Math.sin(t * 40) * 0.6;
    this.shipLight.position.copy(ship.position);
    this.shipLight.intensity = 20 * thrust;
  }

  /** Cinematic camera for the rescue: a slow orbit around the landing pad. */
  rescueCamera(world, camera, t) {
    const padDir = localToDir(this.frame, PAD.x, PAD.z);
    const up = new THREE.Vector3(...padDir);
    const east = new THREE.Vector3(...this.frame.east);
    const north = new THREE.Vector3(...this.frame.north);
    const a = 2.2 + t * 0.035;
    const ground = world.terrain.surfaceRadius(padDir);
    const target = this.ship.visible ? this.ship.position.clone().addScaledVector(up, 2.5) : up.clone().multiplyScalar(ground + 3);
    const cam = up.clone().multiplyScalar(ground + 5 + Math.min(12, t * 0.6)).addScaledVector(east, Math.cos(a) * 24).addScaledVector(north, Math.sin(a) * 24);
    camera.position.copy(cam);
    camera.up.copy(up);
    camera.lookAt(target);
  }
}
