// Screen-space feedback: floating numbers, banners, combo counter, hit markers.
import * as THREE from 'three';

const $ = (id) => document.getElementById(id);
const tmp = new THREE.Vector3();

export class Juice {
  constructor() {
    this.floaters = [];
    this.bannerTimer = null;
    this.combo = 0;
    this.lastKillAt = 0;
  }

  /** Text that rises from a world position. */
  float(position, text, color = '#ffd166') {
    const el = document.createElement('div');
    el.className = 'floater';
    el.textContent = text;
    el.style.color = color;
    $('floaters').appendChild(el);
    this.floaters.push({ el, pos: position.clone(), t: 0 });
    if (this.floaters.length > 24) this.floaters.shift().el.remove();
  }

  banner(text, color = '#7cf7d4', sub = '', ms = 2200) {
    const el = $('banner');
    el.style.color = color;
    el.innerHTML = '';
    el.append(text);
    if (sub) {
      const s = document.createElement('small');
      s.textContent = sub;
      el.append(s);
    }
    el.classList.add('show');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  hitmarker() {
    const c = $('crosshair');
    c.classList.add('hit');
    clearTimeout(this.hitTimer);
    this.hitTimer = setTimeout(() => c.classList.remove('hit'), 110);
  }

  hurt() {
    const v = $('vignette');
    v.classList.add('hurt');
    clearTimeout(this.hurtTimer);
    this.hurtTimer = setTimeout(() => v.classList.remove('hurt'), 350);
  }

  /** Registers a kill by the local player and returns the current streak. */
  kill() {
    const now = performance.now();
    this.combo = now - this.lastKillAt < 3500 ? this.combo + 1 : 1;
    this.lastKillAt = now;
    const el = $('combo');
    if (this.combo >= 2) {
      el.textContent = `${this.combo}× STREAK`;
      el.classList.remove('show');
      void el.offsetWidth;
      el.classList.add('show');
    }
    return this.combo;
  }

  update(dt, camera) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.floaters = this.floaters.filter((f) => {
      f.t += dt;
      if (f.t > 1.3) {
        f.el.remove();
        return false;
      }
      tmp.copy(f.pos).project(camera);
      if (tmp.z > 1) {
        f.el.style.opacity = '0';
        return true;
      }
      const x = (tmp.x * 0.5 + 0.5) * w;
      const y = (-tmp.y * 0.5 + 0.5) * h - f.t * 60;
      const s = 1 + Math.max(0, 0.3 - f.t) * 1.5;
      f.el.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px) scale(${s})`;
      f.el.style.opacity = String(Math.min(1, (1.3 - f.t) * 2.5));
      return true;
    });
    if (this.combo >= 2 && performance.now() - this.lastKillAt > 3500) {
      this.combo = 0;
      $('combo').classList.remove('show');
    }
  }
}
