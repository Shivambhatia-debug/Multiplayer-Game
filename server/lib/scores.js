// Leaderboard helpers shared by the Vercel function and the standalone relay.
// Scores live in Upstash Redis (free tier, via the Vercel Marketplace) when
// UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are set.

const MODE_RE = /^(easy|normal|nightmare|daily-\d{4}-\d{2}-\d{2})$/;
const CLASSES = ['engineer', 'medic', 'heavy', 'scout'];
export const MAX_SCORE = 200000;
const TOP = 10;

export function cleanMode(raw) {
  const mode = String(raw || 'normal');
  return MODE_RE.test(mode) ? mode : null;
}

/** Validates a submitted run. Returns a clean entry or null. */
export function cleanEntry(body) {
  if (!body || typeof body !== 'object') return null;
  const mode = cleanMode(body.mode);
  const score = Math.round(Number(body.score));
  const wave = Math.round(Number(body.wave));
  if (!mode || !Number.isFinite(score) || score < 0 || score > MAX_SCORE) return null;
  if (!Number.isFinite(wave) || wave < 0 || wave > 10) return null;
  return {
    mode,
    score,
    name: String(body.name || 'Pilot').replace(/[<>]/g, '').slice(0, 16) || 'Pilot',
    wave,
    won: !!body.won,
    cls: CLASSES.includes(body.cls) ? body.cls : 'engineer',
    squad: Math.max(1, Math.min(6, Math.round(Number(body.squad) || 1))),
    at: Date.now(),
  };
}

export function upstashConfigured() {
  return !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

async function upstash(commands) {
  const res = await fetch(`${process.env.UPSTASH_REDIS_REST_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error(`Upstash error ${res.status}`);
  return res.json();
}

const keyFor = (mode) => `ares:scores:${mode}`;

export async function redisTop(mode) {
  const [result] = await upstash([['ZREVRANGE', keyFor(mode), 0, TOP - 1]]);
  return (result.result || []).map((member) => {
    try {
      return JSON.parse(member);
    } catch {
      return null;
    }
  }).filter(Boolean);
}

export async function redisAdd(entry) {
  const key = keyFor(entry.mode);
  const commands = [
    ['ZADD', key, entry.score, JSON.stringify(entry)],
    // Keep each board small.
    ['ZREMRANGEBYRANK', key, 0, -101],
  ];
  // Daily boards expire after a week.
  if (entry.mode.startsWith('daily-')) commands.push(['EXPIRE', key, 7 * 24 * 3600]);
  await upstash(commands);
}

/** In-memory boards for the standalone relay (reset when it restarts). */
export class MemoryBoards {
  constructor() {
    this.boards = new Map();
  }

  top(mode) {
    return (this.boards.get(mode) || []).slice(0, TOP);
  }

  add(entry) {
    const list = [...(this.boards.get(entry.mode) || []), entry].sort((a, b) => b.score - a.score).slice(0, 100);
    this.boards.set(entry.mode, list);
  }
}
