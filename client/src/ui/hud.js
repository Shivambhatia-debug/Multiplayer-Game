import { STRUCTURES, STRUCT_TYPES, TUNING } from '../sim/defs.js';
import { PLANET_RADIUS as R } from '../sim/terrain.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Line icons for the build hotbar (24×24, stroked with the structure colour). */
const ICONS = {
  turret: '<path d="M5 20h14M8 20v-4h8v4M12 16v-4"/><rect x="7" y="7" width="10" height="5" rx="1"/><path d="M17 9h5"/>',
  generator: '<rect x="4" y="8" width="16" height="11" rx="1.5"/><path d="M13 3l-3 6h4l-3 6"/>',
  medbay: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8v8M8 12h8"/>',
  barricade: '<path d="M3 18h18M5 18V9h14v9"/><path d="M5 9l4 4M9 9l4 4M13 9l4 4"/>',
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

export function renderPlayerList(el, members, hostId, meId, world) {
  el.innerHTML = members
    .map((m) => {
      const p = world?.players.get(m.id);
      const hp = p ? Math.max(0, p.hp) : TUNING.playerHp;
      return `<li class="${p?.dead ? 'down' : ''}"><span class="dot" style="color:${esc(m.color)}"></span>${esc(m.name)}${
        m.id === meId ? ' <small>(you)</small>' : ''
      }${m.id === hostId ? '<span class="tag">host</span>' : ''}${
        world ? `<span class="mini"><i style="width:${hp}%"></i></span>` : ''
      }</li>`;
    })
    .join('');
}

/** A single urgent instruction, shown under the compass only when something needs attention. */
function alert(world, me) {
  if (me?.dead) return '';
  const r = world.reactor.hp / world.reactor.max;
  if (world.simTime - world.reactorHitAt < 1.5) return r < 0.35 ? '⚠ REACTOR CRITICAL! Get back to the base!' : '⚠ The reactor is under attack!';
  if (me && me.hp < 35) return '❤ Low health! Stand near a Med Station or back off to recover.';
  if (world.pods.size) return '☄ Drop pods incoming. Shoot them before they land in the red rings!';
  if (!world.waveActive && world.wave === 0) {
    if (!world.structures.size) return 'Grab the glowing power cells, then press 1 to build an Auto Turret near the reactor.';
    return 'The first wave is coming. Build more defences around the reactor.';
  }
  if (!world.waveActive) return 'Wave cleared. Repair, collect power cells and build before the next wave.';
  return '';
}

export class Hud {
  constructor() {
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

  update(world, meId) {
    const me = world.players.get(meId);
    const hp = me ? Math.max(0, Math.round(me.hp)) : TUNING.playerHp;
    $('hp-value').textContent = me?.dead ? 'DOWN' : String(hp);
    $('hp-bar').style.width = `${hp}%`;
    $('hp-bar').style.backgroundPosition = `${-(1 - hp / 100) * 160}px 0`;
    $('hp-bar').classList.toggle('low', hp < 30);

    const r = Math.max(0, world.reactor.hp / world.reactor.max);
    $('reactor-value').textContent = `${Math.round(r * 100)}%`;
    $('reactor-bar').style.width = `${r * 100}%`;
    $('reactor-bar').classList.toggle('low', r < 0.3);

    $('energy-value').textContent = Math.floor(world.energy);
    $('wave-value').textContent = `${world.wave} / ${TUNING.waves}`;
    if (world.waveActive) {
      const left = world.enemies.size + world.pods.size + world.queue.length;
      $('wave-label').textContent = 'Aliens left';
      $('wave-status').textContent = String(left);
      $('wave-status').style.color = 'var(--danger)';
    } else {
      $('wave-label').textContent = world.phase === 'play' ? 'Next wave in' : 'Status';
      $('wave-status').textContent = world.phase === 'play' ? formatTime(world.nextWaveAt - world.simTime) : '—';
      $('wave-status').style.color = '';
    }

    for (const slot of this.slots) slot.classList.toggle('poor', world.energy < STRUCTURES[slot.dataset.type].cost);
    $('objective').textContent = world.phase === 'play' ? alert(world, me) : '';
  }

  /**
   * Heading strip across the top: cardinal directions relative to the planet's north pole,
   * with markers for the reactor, aliens, drop pods and the nearest power cells.
   */
  drawCompass(world, player) {
    const canvas = $('compass');
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    const span = Math.PI * 0.9;
    const up = player.dir;
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
      if (label) {
        ctx.font = `700 ${label.length === 1 ? 34 : 26}px "Chakra Petch", sans-serif`;
        ctx.fillStyle = label === 'N' ? '#ff6b6b' : '#edf3fb';
        ctx.fillText(label, x, 47);
      } else {
        const tall = deg % 15 === 0;
        ctx.fillStyle = 'rgba(237,243,251,0.45)';
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
      } else if (shape === 'home') {
        ctx.moveTo(x, 0);
        ctx.lineTo(x + 13, 11);
        ctx.lineTo(x + 9, 11);
        ctx.lineTo(x + 9, 25);
        ctx.lineTo(x - 9, 25);
        ctx.lineTo(x - 9, 11);
        ctx.lineTo(x - 13, 11);
      } else {
        ctx.arc(x, 13, 9, 0, Math.PI * 2);
      }
      ctx.fill();
      if (label && Math.abs(x - W / 2) > 40) {
        ctx.font = '700 20px "Chakra Petch", sans-serif';
        ctx.fillText(label, x, 82);
      }
    };
    const cells = [...world.cells.values()]
      .map((c) => ({ c, m: meters(c.dir) }))
      .sort((a, b) => a.m - b.m)
      .slice(0, 3);
    for (const { c, m } of cells) marker(c.dir, '#5fc8ff', 'diamond', `${m}m`);
    for (const e of world.enemies.values()) marker(e.dir, e.kind === 1 ? '#ff9a3a' : '#7dff5a', 'dot', `${meters(e.dir)}m`);
    for (const p of world.pods.values()) if (world.simTime > p.t0 - 2) marker(p.dir, '#ff4a5a', 'down', `${meters(p.dir)}m`);
    const baseM = meters(world.baseDir);
    if (baseM > 6) marker(world.baseDir, '#ffd166', 'home', `${baseM}m`);

    const deg = Math.round(((heading * 180) / Math.PI + 360) % 360);
    ctx.fillStyle = '#7cf7d4';
    ctx.fillRect(W / 2 - 2, 24, 4, 46);
    ctx.fillStyle = 'rgba(7,11,19,0.9)';
    ctx.fillRect(W / 2 - 34, 70, 68, 24);
    ctx.font = '700 18px "Chakra Petch", sans-serif';
    ctx.fillStyle = '#7cf7d4';
    ctx.fillText(`${String(deg).padStart(3, '0')}°`, W / 2, 83);
  }

  /** Top-down radar around the player. */
  drawRadar(world, player) {
    const canvas = $('radar');
    const ctx = canvas.getContext('2d');
    const size = canvas.width;
    const c = size / 2;
    const range = 45;
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
    for (const r of world.ruins) if (r.kind !== 'lamp') plot(r.dir, 'rgba(160,140,130,0.35)', 4);
    for (const st of world.structures.values()) plot(st.dir, 'rgba(234,242,255,0.85)', 5);
    for (const cell of world.cells.values()) plot(cell.dir, '#5fc8ff', 4);
    plot(world.baseDir, '#ffd166', 9, true);
    const t = world.simTime;
    for (const p of world.pods.values()) if (t > p.t0 - 2) plot(p.dir, Math.sin(t * 12) > 0 ? '#ff4a5a' : '#ffb14a', 9, true);
    for (const e of world.enemies.values()) plot(e.dir, e.kind === 1 ? '#ff9a3a' : '#7dff5a', e.kind === 1 ? 8 : 5, true);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(c, c - 12);
    ctx.lineTo(c - 8, c + 8);
    ctx.lineTo(c + 8, c + 8);
    ctx.closePath();
    ctx.fill();
  }
}
