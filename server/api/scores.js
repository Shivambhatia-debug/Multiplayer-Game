import { applyCors, sendJson } from '../lib/http.js';
import { cleanEntry, cleanMode, redisAdd, redisTop, upstashConfigured } from '../lib/scores.js';

// GET /api/scores?mode=normal  → top 10.  POST /api/scores {mode, score, name, …} → saves a run.
export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (!upstashConfigured()) {
    sendJson(res, 503, { error: 'Leaderboard storage is not configured (connect an Upstash Redis database to this project).' });
    return;
  }
  try {
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
      const entry = cleanEntry(body);
      if (!entry) {
        sendJson(res, 400, { error: 'Invalid score.' });
        return;
      }
      await redisAdd(entry);
      sendJson(res, 200, { ok: true, scores: await redisTop(entry.mode) });
      return;
    }
    const mode = cleanMode(req.query?.mode);
    if (!mode) {
      sendJson(res, 400, { error: 'Unknown mode.' });
      return;
    }
    sendJson(res, 200, { mode, scores: await redisTop(mode) });
  } catch {
    sendJson(res, 502, { error: 'Leaderboard is unavailable right now.' });
  }
}
