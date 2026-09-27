import { STRUCTURES, STRUCT_TYPES, TUNING, heatToCelsius } from '../sim/defs.js';

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

    const elapsed = (world.phase === 'won' ? world.wonAt : now) - world.playStart;
    $('time-value').textContent = formatTime(elapsed);
    const incoming = world.meteors.size;
    $('shower-value').textContent = incoming ? `☄ ${incoming} incoming` : formatTime(world.nextShowerAt - now);
    $('shower-value').style.color = incoming ? 'var(--danger)' : '';

    for (const slot of this.slots) slot.classList.toggle('poor', s.energy < STRUCTURES[slot.dataset.type].cost);
    $('objective').textContent = world.phase === 'play' ? objective(world) : '';
  }
}
