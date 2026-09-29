import * as Ably from 'ably';
import { applyCors, sendJson, sanitizeClientId, ROOM_PREFIX } from '../lib/http.js';

// Issues short-lived Ably token requests so the API key never reaches the browser.
export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  const key = process.env.ABLY_API_KEY;
  if (!key) {
    sendJson(res, 503, { error: 'ABLY_API_KEY is not set on the server.' });
    return;
  }
  const clientId = sanitizeClientId(req.query?.clientId);
  if (!clientId) {
    sendJson(res, 400, { error: 'A valid clientId is required.' });
    return;
  }
  try {
    const rest = new Ably.Rest({ key });
    const tokenRequest = await rest.auth.createTokenRequest({
      clientId,
      ttl: 3 * 60 * 60 * 1000,
      capability: { [`${ROOM_PREFIX}*`]: ['publish', 'subscribe', 'presence'] },
    });
    sendJson(res, 200, tokenRequest);
  } catch (error) {
    sendJson(res, 500, { error: 'Could not create realtime token.' });
  }
}
