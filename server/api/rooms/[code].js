import * as Ably from 'ably';
import { applyCors, sendJson, normalizeCode, ROOM_PREFIX, MAX_PLAYERS } from '../../lib/http.js';

// A room exists while at least one player is present on its channel.
export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  const code = normalizeCode(req.query?.code);
  if (!code) {
    sendJson(res, 400, { error: 'Room codes are 5 letters or digits.' });
    return;
  }
  const key = process.env.ABLY_API_KEY;
  if (!key) {
    sendJson(res, 503, { error: 'ABLY_API_KEY is not set on the server.' });
    return;
  }
  try {
    const rest = new Ably.Rest({ key });
    const page = await rest.channels.get(`${ROOM_PREFIX}${code}`).presence.get();
    const players = page.items.length;
    sendJson(res, 200, { code, exists: players > 0, players, full: players >= MAX_PLAYERS });
  } catch (error) {
    sendJson(res, 500, { error: 'Could not look up the room.' });
  }
}
