// Third-person movement on a spherical planet. Gravity always points to the core.
import * as THREE from 'three';
import { offsetDir } from '../sim/vec.js';
import { PLANET_RADIUS } from '../sim/terrain.js';

const WALK = 7.5;
const SPRINT = 12;
const JUMP = 8;
const GRAVITY = 21;
const JET_THRUST = 36;
const JET_BURN = 0.5;
const JET_REFILL = 0.7;
const MAX_ALT = 22;
const CAM_DIST = 6.2;
const tmp = new THREE.Vector3();
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
  }

  /** Drops the pilot next to the colony reactor, facing outward toward the wasteland. */
  spawn(world) {
    this.dir.set(...offsetDir(world.baseDir, Math.random, 11, 13, PLANET_RADIUS));
    const base = new THREE.Vector3(...world.baseDir);
    this.fwd.copy(this.dir).sub(base);
    this.fwd.addScaledVector(this.dir, -this.fwd.dot(this.dir)).normalize();
    this.fuel = 1;
    this.alt = 3;
    this.vAlt = 0;
    const g = this.groundRadius(world);
    this.ground = g.ground;
    this.surface = g.surface;
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
    if (allowMove) {
      f = (input.down('KeyW', 'ArrowUp') ? 1 : 0) - (input.down('KeyS', 'ArrowDown') ? 1 : 0);
      s = (input.down('KeyD', 'ArrowRight') ? 1 : 0) - (input.down('KeyA', 'ArrowLeft') ? 1 : 0);
    }
    const { ground } = this.groundRadius(world);
    this.moving = f !== 0 || s !== 0;
    this.sprinting = this.moving && input.down('ShiftLeft', 'ShiftRight');
    if (this.moving) {
      right.crossVectors(this.fwd, this.dir).normalize();
      const speed = (input.down('ShiftLeft', 'ShiftRight') ? SPRINT : WALK);
      tmp.copy(this.fwd).multiplyScalar(f).addScaledVector(right, s).normalize().multiplyScalar(speed * dt);
      const radius = ground + this.alt;
      this.dir.multiplyScalar(radius).add(tmp).normalize();
      this.fwd.addScaledVector(this.dir, -this.fwd.dot(this.dir)).normalize();
    }

    // Jump from the ground; keep holding Space after the jump's peak to fire the jetpack.
    const space = allowMove && input.down('Space');
    this.jetting = false;
    if (space && this.grounded) {
      this.vAlt = JUMP;
      this.grounded = false;
    } else if (space && !this.grounded && this.fuel > 0 && this.vAlt < 3) {
      this.jetting = true;
      this.vAlt = Math.min(7, this.vAlt + JET_THRUST * dt);
      this.fuel = Math.max(0, this.fuel - JET_BURN * dt);
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

  updateCamera(camera, world) {
    const target = this.position(tmp).addScaledVector(this.dir, 1.85);
    right.crossVectors(this.fwd, this.dir).normalize();
    target.addScaledVector(right, 0.75);
    this.aim
      .copy(this.fwd)
      .multiplyScalar(Math.cos(this.pitch))
      .addScaledVector(this.dir, -Math.sin(this.pitch))
      .normalize();
    const probe = [0, 0, 0];
    let d = CAM_DIST;
    for (; d > 1.2; d -= 0.4) {
      this.camPos.copy(target).addScaledVector(this.aim, -d);
      const r = this.camPos.length();
      probe[0] = this.camPos.x / r;
      probe[1] = this.camPos.y / r;
      probe[2] = this.camPos.z / r;
      const ground = world.terrain.surfaceRadius(probe);
      if (r > ground + 0.6 && !this.insideBuilding(world, probe, r - ground)) break;
    }
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
    const r = (v) => Math.round(v * 1000) / 1000;
    return {
      d: [r(this.dir.x), r(this.dir.y), r(this.dir.z)],
      f: [r(this.fwd.x), r(this.fwd.y), r(this.fwd.z)],
      h: Math.round(this.heightAboveTerrain() * 100) / 100,
      a: this.jetting ? 3 : !this.grounded ? 2 : this.moving ? 1 : 0,
    };
  }
}
