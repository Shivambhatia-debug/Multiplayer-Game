// The colony simulation. The host runs `step()` and `handleAction()`; every other client
// mirrors the host through `applyWorld()` / `applyTick()`. If the host leaves, the next
// player starts stepping its mirrored copy (host migration).
import { mulberry32 } from './noise.js';
import { createTerrain, BASE_DIR, PLANET_RADIUS as R } from './terrain.js';
import { STRUCTURES, STRUCT_TYPES, ENEMIES, TUNING } from './defs.js';
import { norm, dist, clamp, round, roundVec, randomDir, offsetDir } from './vec.js';
import { createRuins, ruinColliders } from './ruins.js';

const POD_ALTITUDE = 70;

export function newSeed() {
  return (Math.random() * 0x7fffffff) | 0;
}

/** Position of a falling drop pod at simulation time `t`, as [x, y, z]. */
export function podPos(p, t, terrain) {
  const k = clamp((t - p.t0) / p.dur, 0, 1);
  const e = k * k;
  const start = p.from.map((v) => v * (R + POD_ALTITUDE));
  const end = p.dir.map((v) => v * terrain.surfaceRadius(p.dir));
  return [start[0] + (end[0] - start[0]) * e, start[1] + (end[1] - start[1]) * e, start[2] + (end[2] - start[2]) * e];
}

/** Metres along the surface between two unit directions (chord approximation). */
const metres = (a, b) => dist(a, b) * R;

export class World {
  constructor(seed = newSeed()) {
    this.reset(seed, 'lobby');
  }

  reset(seed, phase = 'lobby') {
    this.seed = seed;
    this.terrain = createTerrain(seed);
    this.baseDir = BASE_DIR;
    this.ruins = createRuins(seed, BASE_DIR);
    this.colliders = [{ dir: BASE_DIR, r: 3 }, ...ruinColliders(this.ruins)];
    this.rand = mulberry32(seed ^ 0x5eed5);
    this.phase = phase;
    this.simTime = 0;
    this.playStart = 0;
    this.endedAt = 0;
    this.energy = TUNING.startEnergy;
    this.reactor = { hp: TUNING.reactorHp, max: TUNING.reactorHp };
    this.reactorHitAt = -99;
    this.structures = new Map();
    this.cells = new Map();
    this.enemies = new Map();
    this.pods = new Map();
    this.players = new Map();
    this.wave = 0;
    this.waveActive = false;
    this.nextWaveAt = TUNING.firstWave;
    this.queue = [];
    this.spawnTimer = 0;
    this.gates = [];
    this.cellTimer = 0;
    this.counters = { built: 0, kills: 0, pods: 0, cells: 0, deaths: 0 };
    this.nextId = 1;
    this.version = 1;
    this.hpDirty = false;
    for (let i = 0; i < 22; i++) this.spawnCell([this.baseDir]);
  }

  // ---- Helpers --------------------------------------------------------------

  placementError(type, dir) {
    if (!STRUCTURES[type]) return 'Unknown structure';
    const maxStructs = TUNING.structuresBase + TUNING.structuresPerPlayer * Math.max(1, this.players.size);
    if (this.structures.size >= maxStructs) return `Building limit reached (${maxStructs})`;
    if (metres(dir, this.baseDir) < TUNING.reactorClearance) return 'Too close to the reactor';
    if (type === 'turret') {
      const cap = TUNING.turretsBase + TUNING.turretsPerPlayer * Math.max(1, this.players.size);
      const have = [...this.structures.values()].filter((s) => s.type === 'turret').length;
      if (have >= cap) return `Turret limit reached (${cap})`;
    }
    for (const o of this.structures.values()) {
      if (metres(o.dir, dir) < TUNING.structSpacing) return 'Too close to another structure';
    }
    for (const c of this.colliders) {
      if (metres(c.dir, dir) < c.r + 1) return 'Blocked by ruins';
    }
    return null;
  }

  addStructure(type, dir, owner) {
    const s = { id: this.nextId++, type, dir, hp: STRUCTURES[type].hp, owner, cooldown: 0 };
    this.structures.set(s.id, s);
    this.version++;
    return s;
  }

  spawnCell(anchors = []) {
    const anchor = anchors.length && this.rand() < 0.8 ? anchors[Math.floor(this.rand() * anchors.length)] : null;
    const dir = anchor ? offsetDir(anchor, this.rand, 7, 34, R) : randomDir(this.rand);
    const id = this.nextId++;
    this.cells.set(id, { id, dir });
    this.version++;
  }

  spawnEnemy(kind, near) {
    const dir = offsetDir(near, this.rand, 0, 4, R);
    const def = ENEMIES[kind];
    // Tougher with more pilots and in later waves.
    const scale = (1 + 0.3 * (Math.max(1, this.players.size) - 1)) * (1 + 0.07 * Math.max(0, this.wave - 1));
    const hp = Math.ceil(def.hp * scale);
    const id = this.nextId++;
    this.enemies.set(id, { id, kind, dir, hp, maxHp: hp, attacking: false, retarget: 0, target: null, cooldown: 1 });
  }

  dropPod(target) {
    const id = this.nextId++;
    this.pods.set(id, { id, dir: target, from: offsetDir(target, this.rand, 8, 16, R), t0: this.simTime + 1, dur: 9 });
  }

  start() {
    if (this.phase !== 'lobby') return [];
    this.phase = 'play';
    this.playStart = this.simTime;
    this.nextWaveAt = this.simTime + TUNING.firstWave;
    return [{ e: 'start' }];
  }

  // ---- Simulation -----------------------------------------------------------

  /** `players` is [{ id, dir }] for everyone currently connected. */
  step(dt, players = []) {
    this.simTime += dt;
    if (this.phase !== 'play') return [];
    const events = [];
    const t = this.simTime;

    this.syncPlayers(players, events);

    for (const st of this.structures.values()) {
      if (st.type === 'generator') this.energy += TUNING.genRate * dt;
    }
    this.energy = Math.min(TUNING.maxEnergy, this.energy);

    // Healing: med stations heal fast, everyone regenerates slowly out of combat.
    const meds = [...this.structures.values()].filter((s) => s.type === 'medbay');
    for (const p of this.players.values()) {
      if (p.dead || !p.dir) continue;
      let heal = t - p.lastHit > 5 ? TUNING.regen : 0;
      if (meds.some((m) => metres(m.dir, p.dir) < TUNING.medRange)) heal += TUNING.medRate;
      if (heal) p.hp = Math.min(TUNING.playerHp, p.hp + heal * dt);
    }
    // The reactor slowly repairs itself between waves.
    if (!this.waveActive) this.reactor.hp = Math.min(this.reactor.max, this.reactor.hp + 4 * dt);

    this.stepWaves(dt, events);
    this.stepEnemies(dt, events);
    this.stepTurrets(dt, events);
    this.stepPods(events);

    this.cellTimer += dt;
    if (this.cells.size < 16 + players.length * 3 && this.cellTimer > 3) {
      this.cellTimer = 0;
      this.spawnCell([this.baseDir, ...players.map((p) => p.dir).filter(Boolean)]);
    }

    if (this.reactor.hp <= 0 && this.phase === 'play') {
      this.reactor.hp = 0;
      this.phase = 'lost';
      this.endedAt = t;
      events.push({ e: 'lost' });
    }
    return events;
  }

  syncPlayers(list, events) {
    const seen = new Set();
    for (const { id, dir } of list) {
      seen.add(id);
      let p = this.players.get(id);
      if (!p) {
        p = { hp: TUNING.playerHp, dead: false, respawnAt: 0, lastHit: -99, dir: null };
        this.players.set(id, p);
      }
      if (!p.dead) p.dir = dir;
      if (p.dead && this.simTime >= p.respawnAt) {
        p.dead = false;
        p.hp = TUNING.playerHp;
        p.dir = null;
        events.push({ e: 'respawn', id });
      }
    }
    for (const id of this.players.keys()) if (!seen.has(id)) this.players.delete(id);
  }

  waveComposition(n) {
    const p = Math.max(1, this.players.size);
    const list = [];
    const drones = 5 + n * 3 + (p - 1) * 4;
    const brutes = n >= 2 ? Math.floor(n / 2) + Math.floor((p - 1) / 2) : 0;
    const spitters = n >= 3 ? Math.floor(n / 2) : 0;
    const pods = n >= 2 ? Math.floor(n / 2) + Math.floor((p - 1) / 2) : 0;
    for (let i = 0; i < drones; i++) list.push({ kind: 0 });
    for (let i = 0; i < brutes; i++) list.push({ kind: 1 });
    for (let i = 0; i < spitters; i++) list.push({ kind: 2 });
    for (let i = 0; i < pods; i++) list.push({ pod: true });
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }

  stepWaves(dt, events) {
    const t = this.simTime;
    if (!this.waveActive && t >= this.nextWaveAt) {
      this.wave++;
      this.waveActive = true;
      this.queue = this.waveComposition(this.wave);
      const gateCount = this.wave >= 6 ? 3 : this.wave >= 3 ? 2 : 1;
      // Aliens gather outside the perimeter wall.
      this.gates = Array.from({ length: gateCount }, () => offsetDir(this.baseDir, this.rand, 50, 58, R));
      this.spawnTimer = 0;
      events.push({ e: 'wave', n: this.wave, count: this.queue.length });
    }
    if (!this.waveActive) return;
    this.spawnTimer -= dt;
    if (this.queue.length && this.spawnTimer <= 0) {
      this.spawnTimer = Math.max(0.35, 1.3 - this.wave * 0.08);
      const next = this.queue.shift();
      if (next.pod) this.dropPod(offsetDir(this.baseDir, this.rand, 6, 24, R));
      else this.spawnEnemy(next.kind, this.gates[Math.floor(this.rand() * this.gates.length)]);
    }
    if (!this.queue.length && !this.enemies.size && !this.pods.size) {
      this.waveActive = false;
      const bonus = 25 + this.wave * 5;
      this.energy = Math.min(TUNING.maxEnergy, this.energy + bonus);
      events.push({ e: 'waveclear', n: this.wave, bonus });
      if (this.wave >= TUNING.waves) {
        this.phase = 'won';
        this.endedAt = t;
        events.push({ e: 'won' });
      } else {
        this.nextWaveAt = t + TUNING.waveBreak;
      }
    }
  }

  /** Picks what an alien goes after: a nearby pilot, a nearby building, or the reactor. */
  chooseTarget(e) {
    let best = null;
    let bestD = TUNING.aggroRange;
    for (const [id, p] of this.players) {
      if (p.dead || !p.dir) continue;
      const d = metres(p.dir, e.dir);
      if (d < bestD) {
        bestD = d;
        best = { type: 'p', id };
      }
    }
    if (best) return best;
    bestD = 11;
    for (const st of this.structures.values()) {
      // Barricades pull aggro from further away.
      const d = metres(st.dir, e.dir) - (st.type === 'barricade' ? 5 : 0);
      if (d < bestD) {
        bestD = d;
        best = { type: 's', id: st.id };
      }
    }
    return best || { type: 'r' };
  }

  targetDir(target) {
    if (!target) return null;
    if (target.type === 'r') return this.baseDir;
    if (target.type === 's') return this.structures.get(target.id)?.dir ?? null;
    const p = this.players.get(target.id);
    return p && !p.dead ? p.dir : null;
  }

  damageTarget(target, amount, events) {
    if (target.type === 'r') {
      this.reactor.hp -= amount;
      this.reactorHitAt = this.simTime;
    } else if (target.type === 's') {
      const st = this.structures.get(target.id);
      if (!st) return;
      st.hp -= amount;
      this.hpDirty = true;
      if (st.hp <= 0) {
        this.structures.delete(st.id);
        this.version++;
        events.push({ e: 'destroyed', type: st.type, dir: st.dir });
      }
    } else {
      this.hurtPlayer(target.id, amount, events);
    }
  }

  hurtPlayer(id, amount, events) {
    const p = this.players.get(id);
    if (!p || p.dead) return;
    p.hp -= amount;
    p.lastHit = this.simTime;
    if (p.hp <= 0) {
      p.hp = 0;
      p.dead = true;
      p.respawnAt = this.simTime + TUNING.respawn;
      this.counters.deaths++;
      events.push({ e: 'down', id });
    }
  }

  stepEnemies(dt, events) {
    for (const e of this.enemies.values()) {
      const def = ENEMIES[e.kind];
      e.retarget -= dt;
      let tdir = this.targetDir(e.target);
      if (e.retarget <= 0 || !tdir) {
        e.retarget = 0.6;
        e.target = this.chooseTarget(e);
        tdir = this.targetDir(e.target);
      }
      if (!tdir) continue;
      const reach = e.target.type === 'r' ? Math.max(def.reach, 3.5) : def.reach;
      const d = metres(e.dir, tdir);
      e.attacking = d <= reach;
      if (!e.attacking) {
        const k = Math.min(1, (def.speed * dt) / d);
        e.dir = norm(e.dir.map((v, i) => v + (tdir[i] - v) * k));
        continue;
      }
      if (e.kind === 2) {
        e.cooldown -= dt;
        if (e.cooldown <= 0) {
          e.cooldown = def.rate;
          this.damageTarget(e.target, def.dmg, events);
          events.push({ e: 'spit', from: roundVec(e.dir, 3), to: roundVec(tdir, 3) });
        }
      } else {
        this.damageTarget(e.target, def.dmg * dt, events);
      }
    }
  }

  killEnemy(e, events, by) {
    this.enemies.delete(e.id);
    const def = ENEMIES[e.kind];
    // Only pilots earn energy from kills, so turrets support the team instead of replacing it.
    const bounty = by.turret ? 0 : def.bounty;
    this.energy = Math.min(TUNING.maxEnergy, this.energy + bounty);
    this.counters.kills++;
    const pos = roundVec(e.dir.map((v) => v * (this.terrain.surfaceRadius(e.dir) + 0.8)), 2);
    events.push({ e: 'kill', id: e.id, kind: e.kind, pos, bounty, by: by.name, pid: by.id ?? null });
  }

  stepTurrets(dt, events) {
    for (const st of this.structures.values()) {
      if (st.type !== 'turret') continue;
      st.cooldown -= dt;
      if (st.cooldown > 0) continue;
      let best = null;
      let bestD = TUNING.turretRange;
      for (const e of this.enemies.values()) {
        const d = metres(e.dir, st.dir);
        if (d < bestD) {
          bestD = d;
          best = e;
        }
      }
      if (!best) continue;
      st.cooldown = TUNING.turretRate;
      best.hp -= 1;
      if (best.hp <= 0) this.killEnemy(best, events, { name: 'Turret', turret: true });
    }
  }

  stepPods(events) {
    for (const p of [...this.pods.values()]) {
      if (this.simTime < p.t0 + p.dur) continue;
      this.pods.delete(p.id);
      for (let i = 0; i < 3; i++) this.spawnEnemy(0, p.dir);
      for (const st of [...this.structures.values()]) {
        if (metres(st.dir, p.dir) < TUNING.blastRadius) this.damageTarget({ type: 's', id: st.id }, 90, events);
      }
      for (const [id, pl] of this.players) {
        if (!pl.dead && pl.dir && metres(pl.dir, p.dir) < TUNING.blastRadius) this.hurtPlayer(id, 30, events);
      }
      if (metres(p.dir, this.baseDir) < TUNING.blastRadius + 2) {
        this.reactor.hp -= 60;
        this.reactorHitAt = this.simTime;
      }
      events.push({ e: 'podland', dir: p.dir });
    }
  }

  // ---- Player actions (host only) -------------------------------------------

  handleAction(act, by) {
    if (!act || typeof act !== 'object') return [];
    if (act.k === 'start') return this.start();
    if (act.k === 'restart') {
      this.reset(newSeed(), 'play');
      return [{ e: 'restart' }];
    }
    if (this.phase !== 'play') return [];
    if (this.players.get(by.id)?.dead) return [];

    if (act.k === 'build') {
      const def = STRUCTURES[act.type];
      if (!def || !Array.isArray(act.dir)) return [];
      const dir = norm(act.dir.map(Number));
      if (dir.some((v) => !Number.isFinite(v))) return [];
      if (this.energy < def.cost) return [{ e: 'deny', to: by.id, msg: 'Not enough energy' }];
      const err = this.placementError(act.type, dir);
      if (err) return [{ e: 'deny', to: by.id, msg: err }];
      this.energy -= def.cost;
      const st = this.addStructure(act.type, dir, by.id);
      this.counters.built++;
      return [{ e: 'build', type: act.type, id: st.id, by: by.name, pid: by.id, dir }];
    }
    if (act.k === 'collect') {
      const cell = this.cells.get(act.id);
      if (!cell) return [];
      this.cells.delete(cell.id);
      this.version++;
      this.energy = Math.min(TUNING.maxEnergy, this.energy + TUNING.cellValue);
      this.counters.cells++;
      return [{ e: 'cell', dir: cell.dir, pid: by.id }];
    }
    if (act.k === 'hit') {
      const e = this.enemies.get(act.id);
      if (e) {
        e.hp -= 1;
        const events = [];
        if (e.hp <= 0) this.killEnemy(e, events, by);
        else events.push({ e: 'hurt', id: e.id, pid: by.id });
        return events;
      }
      const p = this.pods.get(act.id);
      if (!p || this.simTime < p.t0 || this.simTime > p.t0 + p.dur) return [];
      const pos = podPos(p, this.simTime, this.terrain);
      this.pods.delete(p.id);
      this.energy = Math.min(TUNING.maxEnergy, this.energy + TUNING.podBounty);
      this.counters.pods++;
      return [{ e: 'podshot', id: p.id, by: by.name, pid: by.id, pos: roundVec(pos, 2) }];
    }
    if (act.k === 'salvage') {
      const st = this.structures.get(act.id);
      if (!st) return [];
      this.structures.delete(st.id);
      this.version++;
      const refund = Math.floor(STRUCTURES[st.type].cost * 0.5);
      this.energy = Math.min(TUNING.maxEnergy, this.energy + refund);
      return [{ e: 'salvage', type: st.type, by: by.name, pid: by.id, refund, dir: st.dir }];
    }
    return [];
  }

  // ---- Snapshots ------------------------------------------------------------

  serializeWorld() {
    return {
      t: 'w',
      v: this.version,
      seed: this.seed,
      n: this.nextId,
      s: [...this.structures.values()].map((st) => [st.id, STRUCT_TYPES.indexOf(st.type), ...roundVec(st.dir, 4), Math.round(st.hp)]),
      o: [...this.cells.values()].map((c) => [c.id, ...roundVec(c.dir, 4)]),
    };
  }

  serializeTick() {
    return {
      t: 'k',
      seed: this.seed,
      st: round(this.simTime, 2),
      ph: this.phase,
      ps: round(this.playStart, 2),
      ea: round(this.endedAt, 2),
      en: round(this.energy, 1),
      rh: Math.round(this.reactor.hp),
      rt: round(this.reactorHitAt, 1),
      wv: this.wave,
      wa: this.waveActive ? 1 : 0,
      nw: round(this.nextWaveAt, 1),
      q: this.queue.length,
      g: this.gates.map((d) => roundVec(d, 3)),
      c: this.counters,
      pl: [...this.players.entries()].map(([id, p]) => [id, Math.round(p.hp), p.dead ? 1 : 0, round(p.respawnAt, 1)]),
      e: [...this.enemies.values()].map((e) => [e.id, e.kind, ...roundVec(e.dir, 4), e.hp, e.maxHp, e.attacking ? 1 : 0]),
      m: [...this.pods.values()].map((p) => [p.id, ...roundVec(p.dir, 4), ...roundVec(p.from, 4), round(p.t0, 2), p.dur]),
    };
  }

  applyWorld(msg) {
    if (msg.seed !== this.seed) this.reset(msg.seed, this.phase);
    this.nextId = Math.max(this.nextId, msg.n || 0);
    this.version = msg.v;
    this.structures = new Map(
      msg.s.map(([id, ti, x, y, z, hp]) => [id, { id, type: STRUCT_TYPES[ti], dir: [x, y, z], hp, cooldown: 0 }]),
    );
    this.cells = new Map(msg.o.map(([id, x, y, z]) => [id, { id, dir: [x, y, z] }]));
  }

  applyTick(msg) {
    if (msg.seed !== this.seed) this.reset(msg.seed, msg.ph);
    const drift = msg.st - this.simTime;
    this.simTime = Math.abs(drift) > 1 ? msg.st : this.simTime + drift * 0.25;
    this.phase = msg.ph;
    this.playStart = msg.ps;
    this.endedAt = msg.ea;
    this.energy = msg.en;
    this.reactor.hp = msg.rh;
    this.reactorHitAt = msg.rt;
    this.wave = msg.wv;
    this.waveActive = !!msg.wa;
    this.nextWaveAt = msg.nw;
    this.queue = new Array(msg.q).fill({ kind: 0 });
    this.gates = msg.g;
    this.counters = msg.c;
    const players = new Map();
    for (const [id, hp, dead, respawnAt] of msg.pl) {
      const prev = this.players.get(id);
      players.set(id, { hp, dead: !!dead, respawnAt, lastHit: prev?.lastHit ?? -99, dir: prev?.dir ?? null });
    }
    this.players = players;
    const enemies = new Map();
    for (const [id, kind, x, y, z, hp, maxHp, attacking] of msg.e) {
      enemies.set(id, { id, kind, dir: [x, y, z], hp, maxHp, attacking: !!attacking, retarget: 0, target: null, cooldown: 1 });
    }
    this.enemies = enemies;
    this.pods = new Map(msg.m.map(([id, dx, dy, dz, fx, fy, fz, t0, dur]) => [id, { id, dir: [dx, dy, dz], from: [fx, fy, fz], t0, dur }]));
  }

  /** A defended colony for the title screen. */
  static demo() {
    const w = new World(1337);
    w.phase = 'demo';
    const rand = mulberry32(99);
    for (let i = 0; i < 40 && w.structures.size < 12; i++) {
      const dir = offsetDir(w.baseDir, rand, 6, 16, R);
      const type = STRUCT_TYPES[i % STRUCT_TYPES.length];
      if (!w.placementError(type, dir)) w.addStructure(type, dir, 'demo');
    }
    for (let i = 0; i < 6; i++) w.spawnEnemy(i % 3, offsetDir(w.baseDir, rand, 20, 30, R));
    return w;
  }
}
