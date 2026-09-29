// Shared helpers for the Vercel functions.
export const ROOM_PREFIX = 'seedfall:';
export const MAX_PLAYERS = 6;
const CODE_RE = /^[A-Z2-9]{5}$/;

export function applyCors(req, res) {
  const allowed = (process.env.ALLOWED_ORIGINS || '*').split(',').map((o) => o.trim()).filter(Boolean);
  const origin = req.headers.origin;
  if (allowed.includes('*')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return true;
  }
  return false;
}

export function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export function normalizeCode(raw) {
  const code = String(raw || '').toUpperCase().trim();
  return CODE_RE.test(code) ? code : null;
}

export function sanitizeClientId(raw) {
  const id = String(raw || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
  return id.length >= 4 ? id : null;
}
