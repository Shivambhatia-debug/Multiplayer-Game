import { World } from '../sim/world.js';

const TICK_INTERVAL = 0.2;
const WORLD_MIN_INTERVAL = 0.25;
const GROWTH_INTERVAL = 1;

/**
 * Glue between a transport and the simulation. The earliest player in the room is
 * the host: it steps the world and broadcasts snapshots. Everyone else mirrors it.
 *
 * Message types: w=world, k=tick, e=events, p=pose, a=action, s=shot fx, g=ping, r=request state.
 */
export class Session {
  constructor({ transport, room, me, solo = false }) {
    this.transport = transport;
    this.room = room;
    this.me = me;
    this.solo = solo;
    this.world = new World();
    this.members = [];
    this.hostId = null;
    this.remotes = new Map();
    this.gotWorld = false;
    this.tickAcc = 0;
    this.worldAcc = 0;
    this.sentVersion = -1;
    this.growthAcc = 0;
    /** Where the local player stands; set by the game loop so the host can spawn crystals nearby. */
    this.localDir = null;

    this.onMembers = () => {};
    this.onEvents = () => {};
    this.onShot = () => {};
    this.onPing = () => {};
    this.onError = () => {};
    this.onHostChange = () => {};
  }

  get isHost() {
    return this.hostId === this.me.id;
  }

  memberName(id) {
    return this.members.find((m) => m.id === id)?.name || 'Pilot';
  }

  async connect() {
    this.transport.onMessage = (data, from) => this.handleMessage(data, from);
    this.transport.onPresence = (list) => this.handlePresence(list);
    this.transport.onError = (msg) => this.onError(msg);
    await this.transport.connect({ room: this.room, id: this.me.id, meta: { name: this.me.name, color: this.me.color } });
    // Ask the host for state in case its presence-triggered broadcast raced our subscription.
    setTimeout(() => {
      if (!this.isHost && !this.gotWorld) this.transport.send({ t: 'r' });
    }, 1500);
  }

  leave() {
    this.transport.close();
  }

  handlePresence(list) {
    const sorted = [...list].sort((a, b) => a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : 1));
    const known = new Set(this.members.map((m) => m.id));
    const newcomers = sorted.filter((m) => !known.has(m.id) && m.id !== this.me.id);
    const wasHost = this.isHost;
    const prevHost = this.hostId;
    this.members = sorted;
    this.hostId = sorted[0]?.id || this.me.id;

    const ids = new Set(sorted.map((m) => m.id));
    for (const id of this.remotes.keys()) if (!ids.has(id)) this.remotes.delete(id);

    if (prevHost && prevHost !== this.hostId) this.onHostChange(this.memberName(this.hostId), this.isHost);
    if (this.isHost && (!wasHost || newcomers.length)) this.broadcastState();
    this.onMembers(sorted);
  }

  handleMessage(data, from) {
    if (!data || typeof data !== 'object') return;
    const fromHost = from === this.hostId;
    switch (data.t) {
      case 'w':
        if (!this.isHost && fromHost) {
          this.world.applyWorld(data);
          this.gotWorld = true;
        }
        break;
      case 'k':
        if (!this.isHost && fromHost) this.world.applyTick(data);
        break;
      case 'e':
        if (!this.isHost && fromHost && Array.isArray(data.ev)) this.onEvents(data.ev);
        break;
      case 'p':
        this.remotes.set(from, { ...data, at: performance.now() });
        break;
      case 'a':
        if (this.isHost) this.applyAction(data, from);
        break;
      case 's':
        this.onShot({ ...data, from });
        break;
      case 'g':
        this.onPing({ ...data, from });
        break;
      case 'r':
        if (this.isHost) this.broadcastState();
        break;
      default:
    }
  }

  /** Requests an action. The host applies it directly; others forward it. */
  act(action) {
    if (this.isHost) this.applyAction(action, this.me.id);
    else this.transport.send({ t: 'a', ...action });
  }

  applyAction(action, fromId) {
    if ((action.k === 'start' || action.k === 'restart') && fromId !== this.hostId) return;
    const events = this.world.handleAction(action, { id: fromId, name: this.memberName(fromId) });
    this.emitEvents(events);
    if (events.length) {
      this.worldAcc = WORLD_MIN_INTERVAL;
      this.tickAcc = TICK_INTERVAL;
    }
  }

  emitEvents(events) {
    if (!events.length) return;
    this.transport.send({ t: 'e', ev: events });
    this.onEvents(events);
  }

  broadcastState() {
    this.transport.send(this.world.serializeWorld());
    this.transport.send(this.world.serializeTick());
    this.sentVersion = this.world.version;
  }

  sendPose(pose) {
    this.transport.send({ t: 'p', ...pose });
  }

  sendShot(shot) {
    this.transport.send({ t: 's', ...shot });
  }

  sendPing(ping) {
    this.transport.send({ t: 'g', ...ping });
  }

  update(dt) {
    const world = this.world;
    if (!this.isHost) {
      world.simTime += dt;
      return;
    }
    const dirs = [...this.remotes.values()].map((p) => p.d).filter(Array.isArray);
    if (this.localDir) dirs.push(this.localDir);
    this.emitEvents(world.step(dt, Math.max(1, this.members.length), dirs));
    if (this.solo) return;

    this.tickAcc += dt;
    this.worldAcc += dt;
    if (this.tickAcc >= TICK_INTERVAL) {
      this.tickAcc = 0;
      this.transport.send(world.serializeTick());
    }
    this.growthAcc += dt;
    const structural = world.version !== this.sentVersion;
    const growth = world.growthDirty && this.growthAcc >= GROWTH_INTERVAL;
    if (this.worldAcc >= WORLD_MIN_INTERVAL && (structural || growth)) {
      this.worldAcc = 0;
      this.sentVersion = world.version;
      this.growthAcc = 0;
      world.growthDirty = false;
      this.transport.send(world.serializeWorld());
    }
  }
}
