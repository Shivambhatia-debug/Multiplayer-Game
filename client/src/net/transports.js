// Three interchangeable transports with the same tiny interface:
//   connect({ room, id, meta })   send(data)   updateMeta(meta)   close()
//   onMessage(data, fromId)       onPresence(members[])   onError(message)
// Members are { id, name, color, joinedAt } and the earliest joinedAt is the host.

class BaseTransport {
  constructor() {
    this.onMessage = () => {};
    this.onPresence = () => {};
    this.onError = () => {};
  }
}

/** Solo play: no network at all. */
export class LocalTransport extends BaseTransport {
  async connect({ id, meta }) {
    this.id = id;
    queueMicrotask(() => this.onPresence([{ id, ...meta, joinedAt: 1 }]));
  }

  updateMeta(meta) {
    this.onPresence([{ id: this.id, ...meta, joinedAt: 1 }]);
  }

  send() {}

  close() {}
}

/** Talks to server/ws-server.js (local dev, Render, Railway, Fly.io). */
export class WsTransport extends BaseTransport {
  constructor(wsUrl) {
    super();
    this.wsUrl = wsUrl;
    this.ws = null;
  }

  connect({ room, id, meta }) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;
      let joined = false;
      ws.onopen = () => ws.send(JSON.stringify({ type: 'join', room, id, meta }));
      ws.onmessage = (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        if (msg.type === 'joined') {
          joined = true;
          resolve();
        } else if (msg.type === 'presence') this.onPresence(msg.members);
        else if (msg.type === 'msg') this.onMessage(msg.data, msg.from);
        else if (msg.type === 'error') {
          if (!joined) reject(new Error(msg.message));
          else this.onError(msg.message);
        }
      };
      ws.onerror = () => {
        if (!joined) reject(new Error('Could not reach the realtime server.'));
      };
      ws.onclose = () => {
        if (joined) this.onError('Disconnected from the realtime server.');
      };
    });
  }

  send(data) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'msg', data }));
  }

  updateMeta(meta) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'meta', meta }));
  }

  close() {
    this.ws?.close();
  }
}

/** Ably pub/sub with presence. Tokens come from the Vercel /api/token function. */
export class AblyTransport extends BaseTransport {
  constructor(apiUrl) {
    super();
    this.apiUrl = apiUrl;
    this.client = null;
    this.channel = null;
  }

  async connect({ room, id, meta, maxPlayers = 6 }) {
    const Ably = await import('ably');
    this.client = new Ably.Realtime({
      authUrl: `${this.apiUrl}/api/token`,
      authParams: { clientId: id },
      clientId: id,
      echoMessages: false,
    });
    this.client.connection.on('failed', () => this.onError('Realtime connection failed.'));
    this.client.connection.on('suspended', () => this.onError('Connection lost. Trying to reconnect…'));

    const channel = this.client.channels.get(`seedfall:${room}`);
    this.channel = channel;
    await channel.subscribe('m', (msg) => this.onMessage(msg.data, msg.clientId));

    const existing = await channel.presence.get();
    if (existing.length >= maxPlayers) {
      this.close();
      throw new Error('Room is full.');
    }
    // joinedAt must be later than everyone already here, even if our clock is behind.
    const joinedAt = Math.max(Date.now(), ...existing.map((m) => (m.data?.joinedAt || 0) + 1));
    const refresh = async () => {
      const members = await channel.presence.get();
      this.onPresence(members.map((m) => ({ id: m.clientId, ...m.data })));
    };
    channel.presence.subscribe(() => refresh().catch(() => {}));
    this.joinedAt = joinedAt;
    await channel.presence.enter({ ...meta, joinedAt });
    await refresh();
  }

  send(data) {
    this.channel?.publish('m', data).catch(() => {});
  }

  updateMeta(meta) {
    this.channel?.presence.update({ ...meta, joinedAt: this.joinedAt }).catch(() => {});
  }

  close() {
    try {
      this.channel?.presence.leave().catch(() => {});
      this.client?.close();
    } catch {
      // closing twice is harmless
    }
  }
}
