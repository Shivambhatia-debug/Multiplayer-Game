// Standalone realtime relay. Used for local development, and deployable to any
// host that keeps WebSockets open (Render, Railway, Fly.io) as an alternative to Ably.
// It exposes the same /api/* routes as the Vercel functions.
import http from 'node:http';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT) || 8787;
const MAX_PLAYERS = 6;
const MAX_MESSAGE_BYTES = 32 * 1024;
const CODE_RE = /^[A-Z2-9]{5}$/;
const ALLOWED = (process.env.ALLOWED_ORIGINS || '*').split(',').map((o) => o.trim()).filter(Boolean);

/** @type {Map<string, Map<string, {ws: import('ws').WebSocket, meta: object}>>} */
const rooms = new Map();
let joinCounter = 0;

function cors(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED.includes('*')) res.setHeader('Access-Control-Allow-Origin', '*');
  else if (origin && ALLOWED.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/health' || url.pathname === '/health') {
    json(res, 200, { ok: true, service: 'seedfall-ws', rooms: rooms.size });
    return;
  }
  if (url.pathname === '/api/config') {
    const secure = req.headers['x-forwarded-proto'] === 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    json(res, 200, { realtime: 'ws', wsUrl: `${secure ? 'wss' : 'ws'}://${host}/ws`, maxPlayers: MAX_PLAYERS });
    return;
  }
  const roomMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)$/);
  if (roomMatch) {
    const code = decodeURIComponent(roomMatch[1]).toUpperCase();
    if (!CODE_RE.test(code)) {
      json(res, 400, { error: 'Room codes are 5 letters or digits.' });
      return;
    }
    const players = rooms.get(code)?.size || 0;
    json(res, 200, { code, exists: players > 0, players, full: players >= MAX_PLAYERS });
    return;
  }
  json(res, 404, { error: 'Not found' });
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_MESSAGE_BYTES });

function presence(code) {
  const room = rooms.get(code);
  if (!room) return;
  const members = [...room.entries()].map(([id, { meta }]) => ({ id, ...meta }));
  const payload = JSON.stringify({ type: 'presence', members });
  for (const { ws } of room.values()) if (ws.readyState === ws.OPEN) ws.send(payload);
}

function clean(text, max) {
  return String(text || '').replace(/[<>]/g, '').slice(0, max);
}

wss.on('connection', (ws) => {
  let code = null;
  let id = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.type === 'join' && !code) {
      const wanted = String(msg.room || '').toUpperCase();
      const wantedId = String(msg.id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
      if (!CODE_RE.test(wanted) || wantedId.length < 4) {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid room or player id.' }));
        return;
      }
      const room = rooms.get(wanted) || new Map();
      if (room.size >= MAX_PLAYERS) {
        ws.send(JSON.stringify({ type: 'error', message: 'Room is full.' }));
        return;
      }
      code = wanted;
      id = wantedId;
      room.set(id, {
        ws,
        meta: {
          name: clean(msg.meta?.name, 16) || 'Pilot',
          color: /^#[0-9a-f]{6}$/i.test(msg.meta?.color) ? msg.meta.color : '#7cf7d4',
          joinedAt: ++joinCounter,
        },
      });
      rooms.set(code, room);
      ws.send(JSON.stringify({ type: 'joined', room: code }));
      presence(code);
      return;
    }
    if (msg.type === 'msg' && code) {
      const payload = JSON.stringify({ type: 'msg', from: id, data: msg.data });
      for (const [peerId, peer] of rooms.get(code) || []) {
        if (peerId !== id && peer.ws.readyState === peer.ws.OPEN) peer.ws.send(payload);
      }
    }
  });

  ws.on('close', () => {
    if (!code) return;
    const room = rooms.get(code);
    if (room?.get(id)?.ws === ws) room.delete(id);
    if (room && room.size === 0) rooms.delete(code);
    else presence(code);
  });
});

// Drop dead connections so presence stays accurate.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 15000);

server.listen(PORT, () => {
  console.log(`Seedfall relay on http://localhost:${PORT} (ws path /ws)`);
});
