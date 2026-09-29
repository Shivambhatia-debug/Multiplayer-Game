// Martian atmosphere up close: fine dust drifting past the camera, and a couple of
// dust devils wandering the plains.
import * as THREE from 'three';
import { PLANET_RADIUS as R } from '../sim/terrain.js';

function softDot() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

const MOTES = 600;
const BOX = 28;
const DEVIL_PARTICLES = 500;
const helperA = new THREE.Vector3(0, 1, 0);
const helperB = new THREE.Vector3(1, 0, 0);
const e1 = new THREE.Vector3();
const e2 = new THREE.Vector3();
const t1 = new THREE.Vector3();
const t2 = new THREE.Vector3();
const center = new THREE.Vector3();
const dirV = new THREE.Vector3();
const base = new THREE.Vector3();

export class Dust {
  constructor(scene) {
    this.scene = scene;
    const tex = softDot();

    // Motes live in a box that follows the camera; positions wrap as it moves.
    this.offsets = new Float32Array(MOTES * 3);
    for (let i = 0; i < MOTES * 3; i++) this.offsets[i] = (Math.random() - 0.5) * BOX;
    const g = new THREE.BufferGeometry();
    this.motePos = new Float32Array(MOTES * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.motePos, 3));
    this.motes = new THREE.Points(
      g,
      new THREE.PointsMaterial({ map: tex, color: 0xd9a57a, size: 0.09, transparent: true, opacity: 0.55, depthWrite: false, fog: false }),
    );
    this.motes.frustumCulled = false;
    scene.add(this.motes);
    this.wind = new THREE.Vector3(1.2, 0.1, 0.6);

    // Dust devils: particle columns that spin and wander.
    this.devils = [0, 1].map((k) => {
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(DEVIL_PARTICLES * 3);
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const pts = new THREE.Points(
        geo,
        new THREE.PointsMaterial({ map: tex, color: 0xc98b5e, size: 1.1, transparent: true, opacity: 0.22, depthWrite: false }),
      );
      pts.frustumCulled = false;
      scene.add(pts);
      const seeds = Float32Array.from({ length: DEVIL_PARTICLES * 3 }, () => Math.random());
      return { pts, pos, seeds, phase: k * 3.1 };
    });
    this.visible = false;
  }

  setVisible(v) {
    this.visible = v;
    this.motes.visible = v;
    for (const d of this.devils) d.pts.visible = v && !this.lowQuality;
  }

  update(dt, t, camera, world, focus) {
    if (!this.visible || !focus) return;
    const cam = camera.position;
    const half = BOX / 2;
    // Storms blow the dust sideways, hard.
    const gust = 1 + (this.storm || 0) * 9;
    for (let i = 0; i < MOTES; i++) {
      const j = i * 3;
      this.offsets[j] += this.wind.x * gust * dt + Math.sin(t * 0.7 + i) * 0.01;
      this.offsets[j + 1] += this.wind.y * dt + Math.cos(t * 0.5 + i * 1.3) * 0.01;
      this.offsets[j + 2] += this.wind.z * gust * dt;
      for (let k = 0; k < 3; k++) {
        if (this.offsets[j + k] > half) this.offsets[j + k] -= BOX;
        else if (this.offsets[j + k] < -half) this.offsets[j + k] += BOX;
      }
      this.motePos[j] = cam.x + this.offsets[j];
      this.motePos[j + 1] = cam.y + this.offsets[j + 1];
      this.motePos[j + 2] = cam.z + this.offsets[j + 2];
    }
    this.motes.geometry.attributes.position.needsUpdate = true;
    this.motes.material.size = 0.09 + (this.storm || 0) * 0.08;
    this.motes.material.opacity = 0.55 + (this.storm || 0) * 0.35;

    // Each devil circles the player at a distance, drifting slowly.
    const up = focus;
    if (this.lowQuality) return;
    const helper = Math.abs(up.y) < 0.9 ? helperA : helperB;
    e1.crossVectors(up, helper).normalize();
    e2.crossVectors(up, e1);
    for (const d of this.devils) {
      const a = t * 0.03 + d.phase;
      const dist = 55 + Math.sin(t * 0.05 + d.phase) * 12;
      center.copy(up).multiplyScalar(R).addScaledVector(e1, Math.cos(a) * dist).addScaledVector(e2, Math.sin(a) * dist);
      const dir = dirV.copy(center).normalize();
      base.copy(dir).multiplyScalar(world.terrain.surfaceRadius([dir.x, dir.y, dir.z]));
      t1.crossVectors(dir, helper).normalize();
      t2.crossVectors(dir, t1);
      for (let i = 0; i < DEVIL_PARTICLES; i++) {
        const s0 = d.seeds[i * 3];
        const s1 = d.seeds[i * 3 + 1];
        const s2 = d.seeds[i * 3 + 2];
        const h = ((s0 + t * 0.15) % 1) * 22;
        const radius = 0.8 + h * 0.22 + s2 * 1.2;
        const ang = s1 * Math.PI * 2 + t * (3.2 - h * 0.08);
        const j = i * 3;
        const cx = Math.cos(ang) * radius;
        const sx = Math.sin(ang) * radius;
        d.pos[j] = base.x + dir.x * h + t1.x * cx + t2.x * sx;
        d.pos[j + 1] = base.y + dir.y * h + t1.y * cx + t2.y * sx;
        d.pos[j + 2] = base.z + dir.z * h + t1.z * cx + t2.z * sx;
      }
      d.pts.geometry.attributes.position.needsUpdate = true;
    }
  }
}
