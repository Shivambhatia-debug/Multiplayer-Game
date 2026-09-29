import { applyCors, sendJson } from '../lib/http.js';

export default function handler(req, res) {
  if (applyCors(req, res)) return;
  sendJson(res, 200, { ok: true, service: 'seedfall-api', realtime: process.env.ABLY_API_KEY ? 'ably' : 'unconfigured' });
}
