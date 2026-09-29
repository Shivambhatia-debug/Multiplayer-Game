// Third-person movement on the planet's surface. Gravity always points to the core.
// Movement accelerates and brakes smoothly, and the camera eases after the pilot.
import * as THREE from 'three';
import { colonyFrame, localToDir } from '../sim/ruins.js';
import { PLANET_RADIUS } from '../sim/terrain.js';
import { CLASSES } from '../sim/defs.js';

const WALK = 6;
const SPRINT = 9.5;
const JUMP = 8;
const GRAVITY = 21;
const JET_THRUST = 36;
const JET_BURN = 0.5;
const JET_REFILL = 0.7;
const MAX_ALT = 22;
const CAM_DIST = 6.2;
const tmp = new THREE.Vector3();
const desired = new THREE.Vector3();
const right = new THREE.Vector3();

export class LocalPlayer {
  constructor() {
    this.dir = new THREE.Vector3(0, 1, 0);
    this.fwd = new THREE.Vector3(0, 0, 1);
    this.alt = 0;
    this.vAlt = 0;
    this.grounded = true;
    this.pitch = 0.12;
    this.moving = false;
    this.fuel = 1;
    this.jetting = false;
    this.sprinting = false;
    this.aim = new THREE.Vector3();
    this.camPos = new THREE.Vector3();
    this.sensitivity = 0.0024;
    this.ground = PLANET_RADIUS;
    this.surface = PLANET_RADIUS;
    this.vel = new THREE.Vector3();
    this.camDist = CAM_DIST;
    this.camRadius = 0;
    /** Third-person distance; phones sit a little further back to see more of the fight. */
    this.camBase = CAM_DIST;
    /** Pilot class id; changes speed and jetpack endurance. */
    this.cls = 'engineer';
  }

  /** Drops the pilot on one of the four roads next to the reactor, facing out toward the wall. */
  spawn(world) {
    const frame = colonyFrame(world.baseDir);
    const road = Math.floor(Math.random() * 4) * (Math.PI / 2);
    const d = 12 + Math.random() * 2;
    const side = (Math.random() - 0.5) * 2;
    const x = Math.sin(road) * d + Math.cos(road) * side;
    const z = Math.cos(road) * d - Math.sin(road) * side;
    this.dir.set(...localToDir(frame, x, z));
    const out = localToDir(frame, Math.sin(road) * (d + 5), Math.cos(road) * (d + 5));
    this.fwd.set(...out).sub(this.dir);
    this.fwd.addScaledVector(this.dir, -this.fwd.dot(this.dir)).normalize();
    this.camDist = CAM_DIST;
    this.fuel = 1;
    this.alt = 3;
    this.vAlt = 0;
    this.vel.set(0, 0, 0);
    const g = this.groundRadius(world);
    this.ground = g.ground;
    this.surface = g.surface;
    this.camRadius = 0;
  }

  /** Radius of the ground under the player. */
  groundRadius(world) {
    const surface = world.terrain.surfaceRadius([this.dir.x, this.dir.y, this.dir.z]);
    return { surface, ground: surface };
  }

  update(dt, input, world, allowMove) {
    const [lx, ly] = input.consumeLook();
    this.fwd.applyAxisAngle(this.dir, -lx * this.sensitivity);
    this.pitch = Math.max(-0.95, Math.min(1.25, this.pitch + ly * this.sensitivity));

    let f = 0;
    let s = 0;
    if (allowMove) [f, s] = input.moveAxis();
    const amount = Math.min(1, Math.hypot(f, s));
    const { ground } = this.groundRadius(world);
    this.sprinting = amount > 0.1 && input.sprinting();
    right.crossVectors(this.fwd, this.dir).normalize();
    desired.set(0, 0, 0);
    if (amount > 0.05) {
      const speed = (this.sprinting ? SPRINT : WALK) * amount * (CLASSES[this.cls]?.speed || 1);
      desired.copy(this.fwd).multiplyScalar(f).addScaledVector(right, s).normalize().multiplyScalar(speed);
    }
    // Quick to start and stop on the ground, floaty in the air.
    const accel = this.grounded ? (amount > 0.05 ? 11 : 14) : 3;
    this.vel.lerp(desired, 1 - Math.exp(-accel * dt));
    this.vel.addScaledVector(this.dir, -this.vel.dot(this.dir));
    const speedNow = this.vel.length();
    this.moving = speedNow > 0.8;
    if (speedNow > 0.01) {
      const radius = ground + this.alt;
      this.dir.multiplyScalar(radius).addScaledVector(this.vel, dt).normalize();
      this.fwd.addScaledVector(this.dir, -this.fwd.dot(this.dir)).normalize();
    }

    // Jump from the ground; keep holding jump after the jump's peak to fire the jetpack.
    const space = allowMove && input.jumping();
    this.jetting = false;
    if (space && this.grounded) {
      this.vAlt = JUMP;
      this.grounded = false;
    } else if (space && !this.grounded && this.fuel > 0 && this.vAlt < 3) {
      this.jetting = true;
      this.vAlt = Math.min(7, this.vAlt + JET_THRUST * dt);
      this.fuel = Math.max(0, this.fuel - JET_BURN * (CLASSES[this.cls]?.jet || 1) * dt);
    }
    if (this.grounded) this.fuel = Math.min(1, this.fuel + JET_REFILL * dt);
    this.vAlt -= GRAVITY * dt;
    if (this.alt > MAX_ALT) this.vAlt = Math.min(this.vAlt, 0);
    this.alt += this.vAlt * dt;
    this.collide(world);
    // Terrain under the new position may be higher or lower; keep the player on top of it.
    const next = this.groundRadius(world);
    const absolute = ground + this.alt;
    this.alt = absolute - next.ground;
    // Walking down a gentle slope keeps the feet on the ground instead of hopping.
    if (this.grounded && this.vAlt <= 0 && this.alt < 0.6) this.alt = 0;
    if (this.alt <= 0) {
      this.alt = 0;
      this.vAlt = 0;
      this.grounded = true;
    } else if (this.alt > 0.05) {
      this.grounded = false;
    }
    this.ground = next.ground;
    this.surface = next.surface;
  }

  /** True when a camera at unit direction `probe`, `height` above ground, would sit inside a building. */
  insideBuilding(world, probe, height) {
    if (height > 7) return false;
    for (const c of world.colliders) {
      const dx = probe[0] - c.dir[0];
      const dy = probe[1] - c.dir[1];
      const dz = probe[2] - c.dir[2];
      if (Math.hypot(dx, dy, dz) * PLANET_RADIUS < c.r + 0.3) return true;
    }
    return false;
  }

  /** Pushes the pilot out of ruins and the reactor so buildings feel solid. */
  collide(world) {
    if (this.alt > 5) return;
    for (const c of world.colliders) {
      tmp.set(c.dir[0], c.dir[1], c.dir[2]);
      const d = this.dir.distanceTo(tmp) * PLANET_RADIUS;
      const min = c.r + 0.45;
      if (d >= min || d < 1e-6) continue;
      // Move along the tangent plane directly away from the collider centre.
      right.copy(this.dir).sub(tmp);
      right.addScaledVector(this.dir, -right.dot(this.dir)).normalize();
      this.dir.addScaledVector(right, (min - d) / PLANET_RADIUS).normalize();
    }
    this.fwd.addScaledVector(this.dir, -this.fwd.dot(this.dir)).normalize();
  }

  /** World-space feet position. */
  position(out = new THREE.Vector3()) {
    return out.copy(this.dir).multiplyScalar(this.ground + this.alt);
  }

  /** Altitude above terrain, which is what remote clients and the renderer use. */
  heightAboveTerrain() {
    return this.ground + this.alt - this.surface;
  }

  updateCamera(camera, world, dt = 1 / 60) {
    // The camera's height eases after the pilot, so bumps and landings don't jolt the view.
    const r = this.ground + this.alt;
    if (!this.camRadius || Math.abs(this.camRadius - r) > 6) this.camRadius = r;
    this.camRadius += (r - this.camRadius) * (1 - Math.exp(-14 * dt));
    const target = tmp.copy(this.dir).multiplyScalar(this.camRadius).addScaledVector(this.dir, 1.85);
    right.crossVectors(this.fwd, this.dir).normalize();
    target.addScaledVector(right, 0.75);
    this.aim
      .copy(this.fwd)
      .multiplyScalar(Math.cos(this.pitch))
      .addScaledVector(this.dir, -Math.sin(this.pitch))
      .normalize();
    const probe = [0, 0, 0];
    let d = this.camBase;
    for (; d > 1.2; d -= 0.4) {
      this.camPos.copy(target).addScaledVector(this.aim, -d);
      const len = this.camPos.length();
      probe[0] = this.camPos.x / len;
      probe[1] = this.camPos.y / len;
      probe[2] = this.camPos.z / len;
      const ground = world.terrain.surfaceRadius(probe);
      if (len > ground + 0.6 && !this.insideBuilding(world, probe, len - ground)) break;
    }
    // Pull in fast when something blocks the view, drift back out gently.
    const k = d < this.camDist ? 1 - Math.exp(-30 * dt) : 1 - Math.exp(-4 * dt);
    this.camDist += (d - this.camDist) * k;
    this.camPos.copy(target).addScaledVector(this.aim, -this.camDist);
    camera.position.copy(this.camPos);
    camera.up.copy(this.dir);
    camera.lookAt(tmp.copy(this.camPos).add(this.aim));
  }

  /** Where a structure would be placed: a few metres in front of the player. */
  buildDir() {
    const p = tmp.copy(this.dir).multiplyScalar(PLANET_RADIUS).addScaledVector(this.fwd, 3.4).normalize();
    return [p.x, p.y, p.z];
  }

  pose() {
    // Directions need ~1e-6 precision on a 1200 m planet (about 1 mm); facing is coarser.
    const r = (v) => Math.round(v * 1e6) / 1e6;
    const rf = (v) => Math.round(v * 1000) / 1000;
    return {
      d: [r(this.dir.x), r(this.dir.y), r(this.dir.z)],
      f: [rf(this.fwd.x), rf(this.fwd.y), rf(this.fwd.z)],
      h: Math.round(this.heightAboveTerrain() * 100) / 100,
      a: this.jetting ? 3 : !this.grounded ? 2 : this.moving ? 1 : 0,
    };
  }
}
