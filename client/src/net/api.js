import { API_URL } from '../config.js';
import { AblyTransport, WsTransport } from './transports.js';

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function makeRoomCode() {
  let code = '';
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  for (const b of bytes) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return code;
}

export function makePlayerId() {
  return `p${crypto.getRandomValues(new Uint32Array(2)).join('').slice(0, 14)}`;
}

async function getJson(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${API_URL}${path}`, { signal: controller.signal });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Server error (${res.status})`);
    return body;
  } catch (error) {
    if (error.name === 'AbortError' || error instanceof TypeError) {
      throw new Error('Backend is offline. Try Solo mode or check VITE_API_URL.');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

let cachedConfig = null;

export async function createTransport() {
  cachedConfig ||= await getJson('/api/config');
  if (cachedConfig.realtime === 'ably') return { transport: new AblyTransport(API_URL), config: cachedConfig };
  if (cachedConfig.realtime === 'ws') return { transport: new WsTransport(cachedConfig.wsUrl), config: cachedConfig };
  throw new Error('Backend returned an unknown realtime mode.');
}

export function lookupRoom(code) {
  return getJson(`/api/rooms/${encodeURIComponent(code)}`);
}
