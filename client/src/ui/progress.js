// Achievements (kept on this device) and leaderboards (online when the backend has a
// scores store, otherwise this device's personal bests).
import { API_URL } from '../config.js';
import { DIFFICULTY, TUNING } from '../sim/defs.js';

export const ACHIEVEMENTS = [
  { id: 'first_win', icon: '🚀', name: 'Evacuated', desc: 'Win a mission.' },
  { id: 'nightmare', icon: '💀', name: 'Nightmare survivor', desc: 'Win on Nightmare.' },
  { id: 'no_turret', icon: '🗡', name: 'No turrets needed', desc: 'Win without the squad building a single turret.' },
  { id: 'untouched', icon: '🛡', name: 'Untouchable', desc: 'Win without going down once.' },
  { id: 'boss', icon: '🛸', name: 'Skybreaker', desc: 'Destroy a Xal mothership.' },
  { id: 'pods10', icon: '☄', name: 'Pod sniper', desc: 'Shoot down 10 drop pods in total.' },
  { id: 'jugg10', icon: '⚔', name: 'Giant slayer', desc: 'Kill 10 Juggernauts in total.' },
  { id: 'medic3', icon: '✚', name: 'Field medic', desc: 'Revive 3 pilots in one mission.' },
  { id: 'logs', icon: '📡', name: 'Archivist', desc: 'Recover all 6 data logs in one mission.' },
  { id: 'storm', icon: '🌪', name: 'Storm chaser', desc: 'Survive a dust storm.' },
  { id: 'upgrade', icon: '⬆', name: 'Fully loaded', desc: 'Max out a rifle upgrade.' },
  { id: 'daily', icon: '📅', name: 'Daily grind', desc: 'Finish a daily challenge.' },
];

const KEY = 'ares:progress';

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { ach: d.ach || {}, stats: d.stats || {}, best: d.best || {} };
  } catch {
    return { ach: {}, stats: {}, best: {} };
  }
}

export class Progress {
  constructor() {
    this.data = load();
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      // storage unavailable; progress lasts for this visit only
    }
  }

  has(id) {
    return !!this.data.ach[id];
  }

  /** Unlocks an achievement; returns its definition if it is new. */
  unlock(id) {
    if (this.has(id)) return null;
    const def = ACHIEVEMENTS.find((a) => a.id === id);
    if (!def) return null;
    this.data.ach[id] = Date.now();
    this.save();
    return def;
  }

  /** Adds to a career counter and returns the new total. */
  bump(stat, by = 1) {
    this.data.stats[stat] = (this.data.stats[stat] || 0) + by;
    this.save();
    return this.data.stats[stat];
  }

  /** Keeps the ten best local runs per mode. */
  record(mode, entry) {
    const list = [...(this.data.best[mode] || []), entry].sort((a, b) => b.score - a.score).slice(0, 10);
    this.data.best[mode] = list;
    this.save();
  }

  localBoard(mode) {
    return this.data.best[mode] || [];
  }
}

/** Mission score: waves, kills and pods, a win bonus, scaled by difficulty. */
export function scoreFor(world, won) {
  const c = world.counters;
  const reactor = Math.max(0, world.reactor.hp / world.reactor.max);
  const raw = world.wave * 1000 + c.kills * 10 + c.pods * 25 + (c.bosses || 0) * 750 + world.logs.size * 100 + (won ? 5000 + Math.round(reactor * 2000) : 0);
  return Math.round(raw * (DIFFICULTY[world.diff]?.score || 1));
}

export function modeFor(world, dailyKey) {
  return world.daily ? `daily-${dailyKey}` : world.diff;
}

export async function submitScore(entry) {
  const res = await fetch(`${API_URL}/api/scores`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
  });
  if (!res.ok) throw new Error('Leaderboard unavailable');
  return res.json();
}

export async function fetchBoard(mode) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(`${API_URL}/api/scores?mode=${encodeURIComponent(mode)}`, { signal: controller.signal });
    if (!res.ok) throw new Error('Leaderboard unavailable');
    const body = await res.json();
    return Array.isArray(body.scores) ? body.scores : [];
  } finally {
    clearTimeout(timer);
  }
}

export const MAX_WAVES = TUNING.waves;
