// Pooled visual effects: particle bursts, shockwaves, laser beams and ping pillars.
import * as THREE from 'three';

function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

const MAX_PARTICLES = 2000;
const UP = new THREE.Vector3(0, 1, 0);

export class Effects {
  constructor(scene) {
    this.scene = scene;
    const geoP = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX_PARTICLES * 3);
    this.col = new Float32Array(MAX_PARTICLES * 3);
    this.base = new Float32Array(MAX_PARTICLES * 3);
    this.vel = new Float32Array(MAX_PARTICLES * 3);
    this.life = new Float32Array(MAX_PARTICLES);
    this.maxLife = new Float32Array(MAX_PARTICLES);
    geoP.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geoP.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(
      geoP,
      new THREE.PointsMaterial({
        size: 0.55,
        map: dotTexture(),
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.cursor = 0;

    this.transient = [];
    this.ringGeo = new THREE.RingGeometry(0.7, 1, 48);
    this.beamGeo = new THREE.CylinderGeometry(0.06, 0.06, 1, 6, 1, true);
    this.beamGeo.translate(0, 0.5, 0);
    this.pillarGeo = new THREE.CylinderGeometry(0.35, 0.35, 30, 12, 1, true);
    this.pillarGeo.translate(0, 15, 0);
  }

  burst(position, color, count = 60, speed = 8, life = 1.2) {
    // Over-bright colours so particles pass the bloom threshold.
    const c = new THREE.Color(color).multiplyScalar(3);
    const n = new THREE.Vector3().copy(position).normalize();
    for (let k = 0; k < count; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % MAX_PARTICLES;
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      dir.addScaledVector(n, 0.6).normalize();
      const s = speed * (0.3 + Math.random() * 0.7);
      this.pos.set([position.x, position.y, position.z], i * 3);
      this.vel.set([dir.x * s, dir.y * s, dir.z * s], i * 3);
      const tint = 0.7 + Math.random() * 0.3;
      this.base.set([c.r * tint, c.g * tint, c.b * tint], i * 3);
      this.life[i] = this.maxLife[i] = life * (0.6 + Math.random() * 0.4);
    }
  }

  /** Emits particles with an explicit velocity (jetpack flames, muzzle flashes). */
  emit(position, velocity, color, count = 3, life = 0.45, spread = 1.2) {
    const c = new THREE.Color(color).multiplyScalar(3);
    for (let k = 0; k < count; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % MAX_PARTICLES;
      this.pos.set([position.x, position.y, position.z], i * 3);
      this.vel.set(
        [
          velocity.x + (Math.random() - 0.5) * spread,
          velocity.y + (Math.random() - 0.5) * spread,
          velocity.z + (Math.random() - 0.5) * spread,
        ],
        i * 3,
      );
      this.base.set([c.r, c.g, c.b], i * 3);
      this.life[i] = this.maxLife[i] = life * (0.6 + Math.random() * 0.4);
    }
  }

  shockwave(position, color, radius = 6, duration = 0.8) {
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color).multiplyScalar(2.5),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(this.ringGeo, mat);
    m.position.copy(position);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), position.clone().normalize());
    this.scene.add(m);
    this.transient.push({
      obj: m,
      t: 0,
      d: duration,
      tick: (k) => {
        m.scale.setScalar(0.2 + k * radius);
        mat.opacity = (1 - k) * 0.9;
      },
    });
  }

  beam(from, to, color) {
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color).multiplyScalar(4),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const m = new THREE.Mesh(this.beamGeo, mat);
    const dir = to.clone().sub(from);
    m.position.copy(from);
    m.scale.set(1, dir.length(), 1);
    m.quaternion.setFromUnitVectors(UP, dir.normalize());
    this.scene.add(m);
    this.transient.push({
      obj: m,
      t: 0,
      d: 0.22,
      tick: (k) => {
        mat.opacity = 1 - k;
        m.scale.x = m.scale.z = 1 + k * 2;
      },
    });
    this.burst(to, color, 10, 3, 0.4);
  }

  pillar(position, color) {
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color).multiplyScalar(2),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(this.pillarGeo, mat);
    m.position.copy(position);
    m.quaternion.setFromUnitVectors(UP, position.clone().normalize());
    this.scene.add(m);
    this.transient.push({
      obj: m,
      t: 0,
      d: 5,
      tick: (k) => {
        mat.opacity = 0.55 * (1 - k) * (0.75 + 0.25 * Math.sin(k * 40));
      },
    });
    this.shockwave(position, color, 3, 1);
  }

  update(dt) {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const j = i * 3;
      const px = this.pos[j];
      const py = this.pos[j + 1];
      const pz = this.pos[j + 2];
      const r = Math.hypot(px, py, pz) || 1;
      // gentle pull toward the planet and drag
      this.vel[j] = this.vel[j] * (1 - dt * 1.5) - (px / r) * 6 * dt;
      this.vel[j + 1] = this.vel[j + 1] * (1 - dt * 1.5) - (py / r) * 6 * dt;
      this.vel[j + 2] = this.vel[j + 2] * (1 - dt * 1.5) - (pz / r) * 6 * dt;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      const k = Math.max(0, this.life[i] / this.maxLife[i]);
      this.col[j] = this.base[j] * k;
      this.col[j + 1] = this.base[j + 1] * k;
      this.col[j + 2] = this.base[j + 2] * k;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;

    this.transient = this.transient.filter((fx) => {
      fx.t += dt;
      const k = Math.min(1, fx.t / fx.d);
      fx.tick(k);
      if (k >= 1) {
        this.scene.remove(fx.obj);
        fx.obj.material.dispose();
        return false;
      }
      return true;
    });
  }
}
