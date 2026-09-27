import { STRUCTURES, STRUCT_TYPES, TUNING, heatToCelsius } from '../sim/defs.js';
import { PLANET_RADIUS as R } from '../sim/terrain.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

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
        <span class="key">${i + 1}</span><div class="icon">${d.icon}</div>
        <div class="name">${esc(d.name)}</div><div class="cost">⚡${d.cost}</div></div>`;
    }).join('');
    this.slots = [...document.querySelectorAll('.slot')];
  }

  setSelected(type) {
    for (const s of this.slots) s.classList.toggle('active', s.dataset.type === type);
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
    $('hold-fill').style.strokeDashoffset = String(276.5 * (1 - Math.min(1, world.hold / TUNING.winHold)));

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
