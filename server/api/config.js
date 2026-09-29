import { applyCors, sendJson, MAX_PLAYERS } from '../lib/http.js';

// Tells the frontend which realtime transport this backend provides.
export default function handler(req, res) {
  if (applyCors(req, res)) return;
  if (!process.env.ABLY_API_KEY) {
    sendJson(res, 503, { error: 'ABLY_API_KEY is not set on the server.' });
    return;
  }
  sendJson(res, 200, { realtime: 'ably', maxPlayers: MAX_PLAYERS });
}
