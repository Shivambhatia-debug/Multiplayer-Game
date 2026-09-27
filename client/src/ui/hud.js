import { STRUCTURES, STRUCT_TYPES, TUNING, heatToCelsius } from '../sim/defs.js';
import { PLANET_RADIUS as R } from '../sim/terrain.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Line icons for the build hotbar (24×24, stroked with the structure colour). */
const ICONS = {
  pylon: '<path d="M4 9l9-5 7 4-9 5z"/><path d="M8.5 6.5l7 4M11 13v8M7 21h8"/>',
  scrubber: '<circle cx="12" cy="12" r="8.5"/><path d="M12 12c0-3 1.5-5 4-5M12 12c2.6 1.5 3.3 3.9 2 6.1M12 12c-2.6 1.5-5 .9-6.2-1.3"/><circle cx="12" cy="12" r="1.3"/>',
  condenser: '<path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z"/><path d="M9 14.5a3 3 0 0 0 3 3"/>',
  heater: '<path d="M12 3c1 4 5 5.5 5 10a5 5 0 0 1-10 0c0-2.3 1.2-3.6 2.4-4.6.3 1.6 1.2 2.4 2.1 2.6C11 8.5 11 6 12 3z"/>',
  seed: '<path d="M12 21v-8"/><path d="M12 13c0-4 3-7 8-7 0 5-3.2 7-8 7zM12 15c0-3-2.4-5.5-7-5.5 0 4 2.7 5.5 7 5.5z"/>',
};

export function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function toast(text, kind = '', ms = 3800) {
  const box = $('toasts');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = text;
  box.appendChild(el);
  while (box.children.length > 6) box.firstChild.remove();
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 400);
  }, ms);
}

export function renderPlayerList(el, members, hostId, meId) {
  el.innerHTML = members
    .map(
      (m) =>
        `<li><span class="dot" style="color:${esc(m.color)}"></span>${esc(m.name)}${m.id === meId ? ' <small>(you)</small>' : ''}${
          m.id === hostId ? '<span class="tag">host</span>' : ''
        }</li>`,
    )
    .join('');
}

/** Picks the single most useful next step for the team, like a mission computer. */
function objective(world) {
  const s = world.stats;
  const count = {};
  for (const st of world.structures.values()) count[st.type] = (count[st.type] || 0) + 1;
  if (world.power < 0.95) return '⚠ Brownout! Build Solar Pylons [1] or salvage a machine [X].';
  const eating = [...world.creatures.values()].some((c) => c.eating);
  if (eating) return '👾 Crawlers are eating your base! Follow the purple dots on the radar and shoot them.';
  if ((count.pylon || 0) < 2) return 'Mine cyan crystals for energy, then build Solar Pylons [1].';
  if (s.heat > 74) return '🔥 The planet is overheating. Salvage a Thermal Core [X].';
  if (s.heat < 33) return '❄ The planet is frozen. Build Thermal Cores [4] to warm it.';
  if (s.air < 30) return 'The air is toxic. Build Air Scrubbers [2].';
  if (s.water < 25) return 'Oceans are dry. Build Vapor Condensers [3].';
  if ((count.seed || 0) < 10) return 'Conditions are right: plant Seed Pods [5] on high ground.';
  if (s.heat < 45) return 'Still chilly. One more Thermal Core [4] will help the forests.';
  if (s.bio >= TUNING.winBio) return '✦ Biosphere stable. Hold it there!';
  return 'Grow the forest and protect it from meteors. Reach 90% biosphere.';
}

export function missionText(m) {
  if (m.kind === 'kill') return `Destroy ${m.n} meteors or crawlers`;
  if (m.kind === 'ore') return `Mine ${m.n} crystals`;
  if (m.type === 'pylon') return `Build ${m.n} Solar Pylons`;
  if (m.type === 'seed') return `Plant ${m.n} Seed Pods`;
  return `Build ${m.n} structures`;
}

export class Hud {
  constructor() {
    this.statEls = {};
    for (const el of document.querySelectorAll('.stat')) {
      this.statEls[el.dataset.stat] = { bar: el.querySelector('i'), val: el.querySelector('.val') };
    }
    this.history = [];
    this.lastEnergy = null;
    this.energyRate = 0;
    this.buildHotbar();
  }

  buildHotbar() {
    $('hotbar').innerHTML = STRUCT_TYPES.map((type, i) => {
      const d = STRUCTURES[type];
      return `<div class="slot" data-type="${type}" style="--slot-color:${d.color}" title="${esc(d.desc)}">
        <span class="key">${i + 1}</span><svg viewBox="0 0 24 24">${ICONS[type]}</svg>
        <div class="name">${esc(d.name)}</div><div class="cost">⚡${d.cost}</div></div>`;
    }).join('');
    this.slots = [...document.querySelectorAll('.slot')];
  }

  setSelected(type) {
    for (const s of this.slots) s.classList.toggle('active', s.dataset.type === type);
    const info = $('build-info');
    info.classList.toggle('hidden', !type);
    if (type) {
      const d = STRUCTURES[type];
      info.innerHTML = `<b>${esc(d.name)} · ⚡${d.cost}</b>${esc(d.desc)}`;
    }
  }

  update(world, dt) {
    const s = world.stats;
    const now = world.simTime;
    this.history.push({ t: now, ...s });
    while (this.history.length > 2 && now - this.history[0].t > 4) this.history.shift();
    const old = this.history[0];
    const span = Math.max(0.5, now - old.t);
    const trend = (key) => {
      const d = (s[key] - old[key]) / span;
      if (d > 0.05) return ' <span class="trend-up">▲</span>';
      if (d < -0.05) return ' <span class="trend-down">▼</span>';
      return '';
    };

    for (const key of ['air', 'water', 'life']) {
      this.statEls[key].bar.style.width = `${s[key]}%`;
      this.statEls[key].val.innerHTML = `${Math.round(s[key])}%${trend(key)}`;
    }
    this.statEls.heat.bar.style.width = `${s.heat}%`;
    this.statEls.heat.val.innerHTML = `${heatToCelsius(s.heat)}°C${trend('heat')}`;

    const bio = Math.round(s.bio);
    $('bio-value').textContent = `${bio}%`;
    const fill = $('bio-fill');
    fill.style.strokeDashoffset = String(326.7 * (1 - s.bio / 100));
    fill.style.stroke = s.bio >= TUNING.winBio ? '#ffffff' : s.bio > 60 ? 'var(--accent)' : s.bio > 30 ? 'var(--warn)' : 'var(--danger)';
    $('hold-fill').style.strokeDashoffset = String(270.2 * (1 - Math.min(1, world.hold / TUNING.winHold)));

    if (this.lastEnergy !== null && dt > 0) {
      const inst = (s.energy - this.lastEnergy) / dt;
      if (Math.abs(inst) < 5) this.energyRate += (inst - this.energyRate) * Math.min(1, dt * 1.5);
    }
    this.lastEnergy = s.energy;
    $('energy-value').textContent = Math.floor(s.energy);
    const rate = this.energyRate;
    const rateEl = $('energy-rate');
    rateEl.textContent = `${rate >= 0 ? '+' : ''}${rate.toFixed(1)}/s`;
    rateEl.className = rate >= 0 ? 'trend-up' : 'trend-down';
    $('brownout').classList.toggle('hidden', world.power >= 0.95 || world.phase !== 'play');

    const elapsed = (world.phase === 'play' ? now : world.wonAt) - world.playStart;
    const left = TUNING.timeLimit - elapsed;
    $('time-value').textContent = formatTime(left);
    $('time-value').style.color = left < 120 ? 'var(--danger)' : left < 300 ? 'var(--warn)' : '';

    const m = world.mission;
    $('mission').classList.toggle('hidden', !m || world.phase !== 'play');
    if (m) {
      $('mission-text').textContent = missionText(m);
      $('mission-reward').textContent = `+${m.reward}⚡`;
      $('mission-bar').style.width = `${(m.progress / m.n) * 100}%`;
      const secs = Math.max(0, m.expires - now);
      $('mission-time').textContent = `${m.progress}/${m.n} · ${Math.ceil(secs)}s left`;
      $('mission').classList.toggle('urgent', secs < 15);
    }
    const incoming = world.meteors.size;
    $('shower-value').textContent = incoming ? `☄ ${incoming} incoming` : formatTime(world.nextShowerAt - now);
    $('shower-value').style.color = incoming ? 'var(--danger)' : '';

    for (const slot of this.slots) slot.classList.toggle('poor', s.energy < STRUCTURES[slot.dataset.type].cost);
    $('objective').textContent = world.phase === 'play' ? objective(world) : '';
  }

  /**
   * Heading strip across the top: cardinal directions relative to the planet's north pole,
   * with markers for meteors, crawlers and the nearest crystals, labelled in metres.
   */
  drawCompass(world, player) {
    const canvas = $('compass');
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    const span = Math.PI * 0.9;
    const up = player.dir;
    // Local north and east on the tangent plane.
    let nx = -up.y * up.x;
    let ny = 1 - up.y * up.y;
    let nz = -up.y * up.z;
    let nl = Math.hypot(nx, ny, nz);
    if (nl < 1e-4) {
      nx = 1;
      ny = 0;
      nz = 0;
      nl = 1;
    }
    nx /= nl;
    ny /= nl;
    nz /= nl;
    const ex = ny * up.z - nz * up.y;
    const ey = nz * up.x - nx * up.z;
    const ez = nx * up.y - ny * up.x;
    const f = player.fwd;
    const heading = Math.atan2(f.x * ex + f.y * ey + f.z * ez, f.x * nx + f.y * ny + f.z * nz);
    const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
    const xOf = (bearing) => W / 2 + (wrap(bearing - heading) / (span / 2)) * (W / 2);
    const bearingOf = (dir) => {
      const d = dir[0] * up.x + dir[1] * up.y + dir[2] * up.z;
      const tx = dir[0] - up.x * d;
      const ty = dir[1] - up.y * d;
      const tz = dir[2] - up.z * d;
      return Math.atan2(tx * ex + ty * ey + tz * ez, tx * nx + ty * ny + tz * nz);
    };
    const meters = (dir) => Math.round(Math.acos(Math.max(-1, Math.min(1, dir[0] * up.x + dir[1] * up.y + dir[2] * up.z))) * R);

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(7,11,19,0.55)';
    ctx.fillRect(0, 26, W, 42);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const labels = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    for (let deg = 0; deg < 360; deg += 5) {
      const x = xOf((deg * Math.PI) / 180);
      if (x < -20 || x > W + 20) continue;
      const label = labels[deg];
      ctx.fillStyle = label ? '#edf3fb' : 'rgba(237,243,251,0.45)';
      if (label) {
        ctx.font = `700 ${label.length === 1 ? 34 : 26}px "Chakra Petch", sans-serif`;
        ctx.fillStyle = label === 'N' ? '#ff6b6b' : '#edf3fb';
        ctx.fillText(label, x, 47);
      } else {
        const tall = deg % 15 === 0;
        ctx.fillRect(x - 1.5, tall ? 30 : 34, 3, tall ? 12 : 7);
        if (tall) {
          ctx.font = '600 18px "Chakra Petch", sans-serif';
          ctx.fillStyle = 'rgba(237,243,251,0.5)';
          ctx.fillText(String(deg), x, 56);
        }
      }
    }
    const marker = (dir, color, shape, label) => {
      const x = xOf(bearingOf(dir));
      if (x < 10 || x > W - 10) return;
      ctx.fillStyle = color;
      ctx.beginPath();
      if (shape === 'down') {
        ctx.moveTo(x - 13, 2);
        ctx.lineTo(x + 13, 2);
        ctx.lineTo(x, 24);
      } else if (shape === 'diamond') {
        ctx.moveTo(x, 2);
        ctx.lineTo(x + 10, 13);
        ctx.lineTo(x, 24);
        ctx.lineTo(x - 10, 13);
      } else {
        ctx.arc(x, 13, 10, 0, Math.PI * 2);
      }
      ctx.fill();
      if (label && Math.abs(x - W / 2) > 40) {
        ctx.font = '700 20px "Chakra Petch", sans-serif';
        ctx.fillStyle = color;
        ctx.fillText(label, x, 82);
      }
    };
    const ores = [...world.ores.values()]
      .map((o) => ({ o, m: meters(o.dir) }))
      .sort((a, b) => a.m - b.m)
      .slice(0, 3);
    for (const { o, m } of ores) marker(o.dir, '#5ff3ff', 'diamond', `${m}m`);
    for (const c of world.creatures.values()) marker(c.dir, c.eating ? '#ff5ae0' : '#c792ff', 'dot', `${meters(c.dir)}m`);
    for (const m of world.meteors.values()) if (world.simTime > m.t0 - 2) marker(m.dir, '#ff4a5a', 'down', `${meters(m.dir)}m`);
    // Heading readout.
    const deg = Math.round(((heading * 180) / Math.PI + 360) % 360);
    ctx.fillStyle = '#7cf7d4';
    ctx.fillRect(W / 2 - 2, 24, 4, 46);
    ctx.fillStyle = 'rgba(7,11,19,0.9)';
    ctx.fillRect(W / 2 - 34, 70, 68, 24);
    ctx.font = '700 18px "Chakra Petch", sans-serif';
    ctx.fillStyle = '#7cf7d4';
    ctx.fillText(`${String(deg).padStart(3, '0')}°`, W / 2, 83);
  }

  /** Top-down radar around the player: machines, trees, crystals, crawlers and meteor targets. */
  drawRadar(world, player) {
    const canvas = $('radar');
    const ctx = canvas.getContext('2d');
    const size = canvas.width;
    const c = size / 2;
    const range = 40;
    const scale = (c - 10) / range;
    const up = player.dir;
    const fwd = player.fwd;
    const rx = fwd.y * up.z - fwd.z * up.y;
    const ry = fwd.z * up.x - fwd.x * up.z;
    const rz = fwd.x * up.y - fwd.y * up.x;
    ctx.clearRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(160,200,255,0.18)';
    ctx.lineWidth = 2;
    for (const r of [0.33, 0.66]) {
      ctx.beginPath();
      ctx.arc(c, c, (c - 10) * r, 0, Math.PI * 2);
      ctx.stroke();
    }
    const plot = (dir, color, radius, clampEdge = false) => {
      const facing = dir[0] * up.x + dir[1] * up.y + dir[2] * up.z;
      let x = (dir[0] * rx + dir[1] * ry + dir[2] * rz) * R;
      let y = (dir[0] * fwd.x + dir[1] * fwd.y + dir[2] * fwd.z) * R;
      const arc = Math.acos(Math.max(-1, Math.min(1, facing))) * R;
      const flat = Math.hypot(x, y) || 1;
      x = (x / flat) * arc;
      y = (y / flat) * arc;
      if (arc > range) {
        if (!clampEdge) return;
        x = (x / arc) * range;
        y = (y / arc) * range;
      }
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(c + x * scale, c - y * scale, radius, 0, Math.PI * 2);
      ctx.fill();
    };
    for (const st of world.structures.values()) plot(st.dir, st.type === 'seed' ? 'rgba(157,255,106,0.55)' : 'rgba(234,242,255,0.8)', st.type === 'seed' ? 3 : 5);
    for (const o of world.ores.values()) plot(o.dir, '#5ff3ff', 4);
    const t = world.simTime;
    for (const m of world.meteors.values()) {
      if (t < m.t0 - 2) continue;
      const blink = Math.sin(t * 12) > 0 ? '#ff4a5a' : '#ffb14a';
      plot(m.dir, blink, 9, true);
    }
    for (const cr of world.creatures.values()) plot(cr.dir, cr.eating ? '#ff5ae0' : '#c792ff', cr.kind ? 9 : 6, true);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(c, c - 12);
    ctx.lineTo(c - 8, c + 8);
    ctx.lineTo(c + 8, c + 8);
    ctx.closePath();
    ctx.fill();
  }
}
