// The colony simulation. The host runs `step()` and `handleAction()`; every other client
// mirrors the host through `applyWorld()` / `applyTick()`. If the host leaves, the next
// player starts stepping its mirrored copy (host migration).
import { mulberry32 } from './noise.js';
import { createTerrain, BASE_DIR, PLANET_RADIUS as R } from './terrain.js';
import { STRUCTURES, STRUCT_TYPES, ENEMIES, TUNING, CLASSES, DIFFICULTY, UPGRADES, BOSS_WAVES } from './defs.js';
import { norm, dist, clamp, round, roundVec, offsetDir } from './vec.js';
import { createRuins, ruinColliders, colonyFrame } from './ruins.js';

const POD_ALTITUDE = 70;

export function newSeed() {
  return (Math.random() * 0x7fffffff) | 0;
}

/** Today's shared seed for the daily challenge (same planet and waves for everyone). */
export function dailySeed(date = new Date()) {
  const key = date.getUTCFullYear() * 10000 + (date.getUTCMonth() + 1) * 100 + date.getUTCDate();
  let h = key ^ 0x5bd1e995;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) & 0x7fffffff;
}

export function dailyKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

/** Position of a falling drop pod at simulation time `t`, as [x, y, z]. */
export function podPos(p, t, terrain) {
  const k = clamp((t - p.t0) / p.dur, 0, 1);
  const e = k * k;
  const start = p.from.map((v) => v * (R + POD_ALTITUDE));
  const end = p.dir.map((v) => v * terrain.surfaceRadius(p.dir));
  return [start[0] + (end[0] - start[0]) * e, start[1] + (end[1] - start[1]) * e, start[2] + (end[2] - start[2]) * e];
}

const FRAME = colonyFrame(BASE_DIR);

/**
 * Where the mothership hangs at time `t`: it drops in from high orbit, then circles the
 * colony. Deterministic, so every client draws it in the same place. Returns [x, y, z].
 */
export function bossPos(boss, t) {
  const age = t - boss.t0;
  const a = age * 0.07 + boss.phase;
  const drop = Math.max(0, 1 - age / 7);
  const alt = R + TUNING.bossAltitude + drop * drop * 140;
  const r = TUNING.bossOrbit;
  const out = [0, 0, 0];
  for (let i = 0; i < 3; i++) out[i] = FRAME.up[i] * alt + (FRAME.east[i] * Math.cos(a) + FRAME.north[i] * Math.sin(a)) * r;
  return out;
}

/** Metres along the surface between two unit directions (chord approximation). */
const metres = (a, b) => dist(a, b) * R;
const classOf = (id) => (CLASSES[id] ? id : 'engineer');

export class World {
  constructor(seed = newSeed()) {
    this.diff = 'normal';
    this.daily = false;
    this.reset(seed, 'lobby');
  }

  reset(seed, phase = 'lobby') {
    this.seed = seed;
    this.terrain = createTerrain(seed);
    this.baseDir = BASE_DIR;
    this.ruins = createRuins(seed, BASE_DIR);
    this.colliders = [{ dir: BASE_DIR, r: 3 }, ...ruinColliders(this.ruins)];
    // Data logs sit in the labs of the abandoned outposts.
    this.logSites = this.ruins.filter((it) => it.kind === 'lab' && it.x === null).map((it) => it.dir);
    this.logs = new Set();
    this.rand = mulberry32(seed ^ 0x5eed5);
    this.phase = phase;
    this.simTime = 0;
    this.playStart = 0;
    this.endedAt = 0;
    const d = DIFFICULTY[this.diff];
    this.energy = d.energy;
    this.reactor = { hp: d.reactor, max: d.reactor };
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
    this.boss = null;
    this.storm = null;
    this.counters = { built: 0, kills: 0, pods: 0, cells: 0, deaths: 0, revives: 0, bosses: 0, juggernauts: 0 };
    this.nextId = 1;
    this.version = 1;
    this.hpDirty = false;
    for (let i = 0; i < 22; i++) this.spawnCell([this.baseDir]);
  }

  get difficulty() {
    return DIFFICULTY[this.diff] || DIFFICULTY.normal;
  }

  // ---- Helpers --------------------------------------------------------------

  /** What a structure costs this pilot (Engineers build turrets cheaper). */
  costFor(type, cls) {
    const base = STRUCTURES[type].cost;
    return type === 'turret' && cls === 'engineer' ? Math.round(base * 0.7) : base;
  }

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
    const dir = anchor ? offsetDir(anchor, this.rand, 7, 34, R) : offsetDir(this.baseDir, this.rand, 10, 44, R);
    const id = this.nextId++;
    this.cells.set(id, { id, dir });
    this.version++;
  }

  spawnEnemy(kind, near) {
    const dir = offsetDir(near, this.rand, 0, 4, R);
    const def = ENEMIES[kind];
    // Tougher with more pilots, in later waves and on harder difficulties.
    const scale = (1 + 0.3 * (Math.max(1, this.players.size) - 1)) * (1 + 0.07 * Math.max(0, this.wave - 1)) * this.difficulty.enemyHp;
    const hp = Math.max(1, Math.ceil(def.hp * scale));
    const id = this.nextId++;
    this.enemies.set(id, { id, kind, dir, hp, maxHp: hp, attacking: false, retarget: 0, target: null, cooldown: 1 });
  }

  dropPod(target) {
    const id = this.nextId++;
    this.pods.set(id, { id, dir: target, from: offsetDir(target, this.rand, 8, 16, R), t0: this.simTime + 1, dur: 9 });
  }

  start(opts = {}) {
    if (this.phase !== 'lobby') return [];
    if (DIFFICULTY[opts.diff]) this.diff = opts.diff;
    this.daily = !!opts.daily;
    const d = this.difficulty;
    this.energy = d.energy;
    this.reactor = { hp: d.reactor, max: d.reactor };
    this.phase = 'play';
    this.playStart = this.simTime;
    this.nextWaveAt = this.simTime + TUNING.firstWave;
    return [{ e: 'start', diff: this.diff, daily: this.daily }];
  }

  // ---- Simulation -----------------------------------------------------------

  /** `players` is [{ id, dir, cls }] for everyone currently connected. */
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

    this.stepSupport(dt);
    this.stepRevives(dt, events);
    // The reactor slowly repairs itself between waves.
    if (!this.waveActive) this.reactor.hp = Math.min(this.reactor.max, this.reactor.hp + 4 * dt);

    this.stepWaves(dt, events);
    this.stepEnemies(dt, events);
    this.stepTurrets(dt, events);
    this.stepPods(events);
    this.stepBoss(events);
    this.stepStorm(events);

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
    for (const { id, dir, cls } of list) {
      seen.add(id);
      let p = this.players.get(id);
      const c = classOf(cls);
      if (!p) {
        p = { hp: CLASSES[c].hp, maxHp: CLASSES[c].hp, cls: c, dead: false, respawnAt: 0, lastHit: -99, dir: null, downDir: null, revive: 0, up: { dmg: 0, rate: 0 }, grenadeAt: 0 };
        this.players.set(id, p);
      }
      if (p.cls !== c) {
        const frac = p.hp / p.maxHp;
        p.cls = c;
        p.maxHp = CLASSES[c].hp;
        p.hp = frac * p.maxHp;
      }
      if (!p.dead) p.dir = dir;
      if (p.dead && this.simTime >= p.respawnAt) {
        p.dead = false;
        p.hp = p.maxHp;
        p.dir = null;
        p.downDir = null;
        p.revive = 0;
        events.push({ e: 'respawn', id });
      }
    }
    for (const id of this.players.keys()) if (!seen.has(id)) this.players.delete(id);
  }

  /** Class auras: med stations and Medics heal, Engineers repair defences and the reactor. */
  stepSupport(dt) {
    const t = this.simTime;
    const meds = [...this.structures.values()].filter((s) => s.type === 'medbay');
    const alive = [...this.players.values()].filter((p) => !p.dead && p.dir);
    const medics = alive.filter((p) => p.cls === 'medic');
    const engineers = alive.filter((p) => p.cls === 'engineer');
    for (const p of alive) {
      let heal = t - p.lastHit > 5 ? TUNING.regen : 0;
      if (meds.some((m) => metres(m.dir, p.dir) < TUNING.medRange)) heal += TUNING.medRate;
      if (medics.some((m) => metres(m.dir, p.dir) < TUNING.healRange)) heal += TUNING.healRate;
      if (heal) p.hp = Math.min(p.maxHp, p.hp + heal * dt);
    }
    for (const eng of engineers) {
      for (const st of this.structures.values()) {
        const max = STRUCTURES[st.type].hp;
        if (st.hp < max && metres(st.dir, eng.dir) < TUNING.repairRange) {
          st.hp = Math.min(max, st.hp + TUNING.repairRate * dt);
          this.hpDirty = true;
        }
      }
      if (metres(this.baseDir, eng.dir) < TUNING.repairRange + 2) this.reactor.hp = Math.min(this.reactor.max, this.reactor.hp + 3 * dt);
    }
  }

  /** A downed pilot is revived in place by a teammate standing close for a few seconds. */
  stepRevives(dt, events) {
    for (const [id, p] of this.players) {
      if (!p.dead || !p.downDir) continue;
      let rate = 0;
      let by = null;
      for (const [oid, o] of this.players) {
        if (oid === id || o.dead || !o.dir) continue;
        if (metres(o.dir, p.downDir) < TUNING.reviveRange) {
          const r = 1 / (TUNING.reviveTime * (o.cls === 'medic' ? 0.5 : 1));
          if (r > rate) {
            rate = r;
            by = oid;
          }
        }
      }
      p.revive = rate ? p.revive + rate * dt : Math.max(0, p.revive - dt * 0.5);
      if (p.revive >= 1) {
        p.dead = false;
        p.hp = p.maxHp * 0.5;
        p.dir = p.downDir;
        p.downDir = null;
        p.revive = 0;
        p.lastHit = this.simTime;
        this.counters.revives++;
        events.push({ e: 'revived', id, by });
      }
    }
  }

  waveComposition(n) {
    const p = Math.max(1, this.players.size);
    const k = this.difficulty.count * (BOSS_WAVES.includes(n) ? 0.6 : 1);
    const list = [];
    const drones = Math.round((5 + n * 3 + (p - 1) * 4) * k);
    const brutes = n >= 2 ? Math.round((Math.floor(n / 2) + Math.floor((p - 1) / 2)) * k) : 0;
    const spitters = n >= 3 ? Math.round(Math.floor(n / 2) * k) : 0;
    const pods = n >= 2 ? Math.round((Math.floor(n / 2) + Math.floor((p - 1) / 2)) * k) : 0;
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
      events.push({ e: 'wave', n: this.wave, count: this.queue.length, boss: BOSS_WAVES.includes(this.wave) });
      if (BOSS_WAVES.includes(this.wave)) this.spawnBoss(events);
      if (this.wave >= 2 && !this.storm && this.rand() < TUNING.stormChance) {
        const start = t + 8 + this.rand() * 20;
        this.storm = { start, end: start + TUNING.stormLength, ambushed: false };
      }
    }
    if (!this.waveActive) return;
    this.spawnTimer -= dt;
    if (this.queue.length && this.spawnTimer <= 0) {
      this.spawnTimer = Math.max(0.35, 1.3 - this.wave * 0.08);
      const next = this.queue.shift();
      if (next.pod) this.dropPod(offsetDir(this.baseDir, this.rand, 6, 24, R));
      else this.spawnEnemy(next.kind, this.gates[Math.floor(this.rand() * this.gates.length)]);
    }
    if (!this.queue.length && !this.enemies.size && !this.pods.size && !this.boss) {
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

  // ---- Mothership -----------------------------------------------------------

  spawnBoss(events) {
    const p = Math.max(1, this.players.size);
    const base = this.wave >= 10 ? 190 : 120;
    const hp = Math.round(base * (1 + 0.55 * (p - 1)) * this.difficulty.enemyHp);
    this.boss = { hp, maxHp: hp, t0: this.simTime, phase: this.rand() * Math.PI * 2, nextStrike: this.simTime + 8, strikes: [], strikeId: 1 };
    events.push({ e: 'boss', hp });
  }

  /** The mothership fires orbital strikes at the reactor, defences and pilots. */
  stepBoss(events) {
    const b = this.boss;
    if (!b) return;
    const t = this.simTime;
    if (t >= b.nextStrike) {
      b.nextStrike = t + (this.wave >= 10 ? 6.5 : 7);
      const count = this.wave >= 10 ? 2 : 1;
      for (let i = 0; i < count; i++) {
        let target = this.baseDir;
        const r = this.rand();
        const alive = [...this.players.values()].filter((p) => !p.dead && p.dir);
        if (r < 0.4 && alive.length) target = alive[Math.floor(this.rand() * alive.length)].dir;
        else if (r < 0.75 && this.structures.size) {
          const list = [...this.structures.values()];
          target = list[Math.floor(this.rand() * list.length)].dir;
        }
        const dir = offsetDir(target, this.rand, 0, 2.5, R);
        b.strikes.push({ id: b.strikeId++, dir, at: t + TUNING.bossStrikeDelay });
      }
    }
    for (const s of [...b.strikes]) {
      if (t < s.at) continue;
      b.strikes.splice(b.strikes.indexOf(s), 1);
      const dmg = this.difficulty.enemyDmg;
      for (const st of [...this.structures.values()]) {
        if (metres(st.dir, s.dir) < TUNING.bossStrikeRadius) this.damageTarget({ type: 's', id: st.id }, 70 * dmg, events);
      }
      for (const [id, p] of this.players) {
        if (!p.dead && p.dir && metres(p.dir, s.dir) < TUNING.bossStrikeRadius) this.hurtPlayer(id, 32 * dmg, events);
      }
      if (metres(s.dir, this.baseDir) < TUNING.bossStrikeRadius + 2) {
        this.reactor.hp -= 32 * dmg;
        this.reactorHitAt = t;
      }
      events.push({ e: 'strike', dir: roundVec(s.dir, 6) });
    }
  }

  hitBoss(amount, by, events) {
    const b = this.boss;
    if (!b || this.simTime - b.t0 < 5) return;
    b.hp -= amount;
    if (b.hp > 0) {
      events.push({ e: 'bosshit', pid: by.id });
      return;
    }
    const pos = roundVec(bossPos(b, this.simTime), 2);
    this.boss = null;
    this.counters.bosses++;
    this.energy = Math.min(TUNING.maxEnergy, this.energy + 80);
    events.push({ e: 'bossdown', pos, by: by.name, pid: by.id ?? null });
  }

  // ---- Dust storms ------------------------------------------------------------

  stepStorm(events) {
    const s = this.storm;
    if (!s) return;
    const t = this.simTime;
    if (!s.ambushed && t >= s.start) {
      s.ambushed = true;
      events.push({ e: 'storm' });
      // The Xal use the storm as cover: a pack of Stalkers slips in from a random side.
      const from = offsetDir(this.baseDir, this.rand, 46, 52, R);
      const n = 3 + Math.min(4, this.wave >> 1);
      for (let i = 0; i < n; i++) this.spawnEnemy(0, from);
    }
    if (t >= s.end) {
      this.storm = null;
      events.push({ e: 'stormend' });
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
      p.downDir = p.dir;
      p.revive = 0;
      // Alone you respawn quickly; with a squad you wait longer, unless someone revives you.
      p.respawnAt = this.simTime + (this.players.size > 1 ? TUNING.bleedout : TUNING.respawn);
      this.counters.deaths++;
      events.push({ e: 'down', id });
    }
  }

  stepEnemies(dt, events) {
    const dmgMul = this.difficulty.enemyDmg;
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
          this.damageTarget(e.target, def.dmg * dmgMul, events);
          events.push({ e: 'spit', from: roundVec(e.dir, 6), to: roundVec(tdir, 6) });
        }
      } else {
        this.damageTarget(e.target, def.dmg * dmgMul * dt, events);
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
    if (e.kind === 1) this.counters.juggernauts++;
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
    const dmg = this.difficulty.enemyDmg;
    for (const p of [...this.pods.values()]) {
      if (this.simTime < p.t0 + p.dur) continue;
      this.pods.delete(p.id);
      for (let i = 0; i < 3; i++) this.spawnEnemy(0, p.dir);
      for (const st of [...this.structures.values()]) {
        if (metres(st.dir, p.dir) < TUNING.blastRadius) this.damageTarget({ type: 's', id: st.id }, 90 * dmg, events);
      }
      for (const [id, pl] of this.players) {
        if (!pl.dead && pl.dir && metres(pl.dir, p.dir) < TUNING.blastRadius) this.hurtPlayer(id, 30 * dmg, events);
      }
      if (metres(p.dir, this.baseDir) < TUNING.blastRadius + 2) {
        this.reactor.hp -= 60 * dmg;
        this.reactorHitAt = this.simTime;
      }
      events.push({ e: 'podland', dir: p.dir });
    }
  }

  /** Rifle damage per hit for a pilot: class base times upgrades. */
  shotDamage(p) {
    const cls = CLASSES[p?.cls] || CLASSES.engineer;
    return cls.dmg * (1 + 0.5 * (p?.up.dmg || 0));
  }

  // ---- Player actions (host only) -------------------------------------------

  handleAction(act, by) {
    if (!act || typeof act !== 'object') return [];
    if (act.k === 'start') return this.start({ diff: act.diff, daily: act.daily });
    if (act.k === 'restart') {
      this.reset(this.daily ? this.seed : newSeed(), 'lobby');
      const events = this.start({ diff: this.diff, daily: this.daily });
      return [{ e: 'restart' }, ...events];
    }
    if (this.phase !== 'play') return [];
    const me = this.players.get(by.id);
    if (me?.dead) return [];

    if (act.k === 'build') {
      const def = STRUCTURES[act.type];
      if (!def || !Array.isArray(act.dir)) return [];
      const dir = norm(act.dir.map(Number));
      if (dir.some((v) => !Number.isFinite(v))) return [];
      const cost = this.costFor(act.type, me?.cls);
      if (this.energy < cost) return [{ e: 'deny', to: by.id, msg: 'Not enough energy' }];
      const err = this.placementError(act.type, dir);
      if (err) return [{ e: 'deny', to: by.id, msg: err }];
      this.energy -= cost;
      const st = this.addStructure(act.type, dir, by.id);
      this.counters.built++;
      return [{ e: 'build', type: act.type, id: st.id, by: by.name, pid: by.id, dir }];
    }
    if (act.k === 'collect') {
      const cell = this.cells.get(act.id);
      if (!cell) return [];
      this.cells.delete(cell.id);
      this.version++;
      const value = TUNING.cellValue + (me?.cls === 'scout' ? 10 : 0);
      this.energy = Math.min(TUNING.maxEnergy, this.energy + value);
      this.counters.cells++;
      return [{ e: 'cell', dir: cell.dir, pid: by.id, value }];
    }
    if (act.k === 'hit') {
      const events = [];
      const dmg = this.shotDamage(me);
      if (act.id === 'boss') {
        this.hitBoss(dmg, by, events);
        return events;
      }
      const e = this.enemies.get(act.id);
      if (e) {
        e.hp -= dmg;
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
    if (act.k === 'grenade') {
      if (!me || !Array.isArray(act.dir) || this.simTime < me.grenadeAt) return [];
      const dir = norm(act.dir.map(Number));
      if (dir.some((v) => !Number.isFinite(v)) || (me.dir && metres(dir, me.dir) > 30)) return [];
      me.grenadeAt = this.simTime + TUNING.grenadeCooldown;
      const events = [{ e: 'grenade', dir: roundVec(dir, 6), pid: by.id }];
      const dmg = TUNING.grenadeDmg * (1 + 0.5 * me.up.dmg);
      for (const e of [...this.enemies.values()]) {
        if (metres(e.dir, dir) > TUNING.grenadeRadius) continue;
        e.hp -= dmg;
        if (e.hp <= 0) this.killEnemy(e, events, by);
      }
      return events;
    }
    if (act.k === 'upgrade') {
      const u = UPGRADES[act.what];
      if (!u || !me) return [];
      const level = me.up[act.what];
      if (level >= u.costs.length) return [{ e: 'deny', to: by.id, msg: 'Already fully upgraded' }];
      const cost = u.costs[level];
      if (this.energy < cost) return [{ e: 'deny', to: by.id, msg: `Need ⚡${cost}` }];
      this.energy -= cost;
      me.up[act.what] = level + 1;
      return [{ e: 'upgraded', pid: by.id, what: act.what, level: level + 1, by: by.name }];
    }
    if (act.k === 'log') {
      const site = this.logSites[act.id];
      if (!site || this.logs.has(act.id) || !me?.dir || metres(site, me.dir) > 6) return [];
      this.logs.add(act.id);
      this.energy = Math.min(TUNING.maxEnergy, this.energy + TUNING.logBounty);
      return [{ e: 'log', id: act.id, pid: by.id, by: by.name }];
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
      s: [...this.structures.values()].map((st) => [st.id, STRUCT_TYPES.indexOf(st.type), ...roundVec(st.dir, 6), Math.round(st.hp)]),
      o: [...this.cells.values()].map((c) => [c.id, ...roundVec(c.dir, 6)]),
    };
  }

  serializeTick() {
    const b = this.boss;
    return {
      t: 'k',
      seed: this.seed,
      st: round(this.simTime, 2),
      ph: this.phase,
      ps: round(this.playStart, 2),
      ea: round(this.endedAt, 2),
      en: round(this.energy, 1),
      rh: Math.round(this.reactor.hp),
      rm: this.reactor.max,
      rt: round(this.reactorHitAt, 1),
      wv: this.wave,
      wa: this.waveActive ? 1 : 0,
      nw: round(this.nextWaveAt, 1),
      q: this.queue.length,
      g: this.gates.map((d) => roundVec(d, 6)),
      c: this.counters,
      df: this.diff,
      dy: this.daily ? 1 : 0,
      lg: [...this.logs],
      sm: this.storm ? [round(this.storm.start, 1), round(this.storm.end, 1)] : 0,
      b: b ? [Math.round(b.hp), b.maxHp, round(b.t0, 2), round(b.phase, 3), b.strikes.map((s) => [s.id, ...roundVec(s.dir, 6), round(s.at, 2)])] : 0,
      pl: [...this.players.entries()].map(([id, p]) => [
        id,
        Math.round(p.hp),
        p.dead ? 1 : 0,
        round(p.respawnAt, 1),
        p.maxHp,
        p.cls,
        round(p.revive, 2),
        p.dead && p.downDir ? roundVec(p.downDir, 6) : 0,
        p.up.dmg,
        p.up.rate,
        round(p.grenadeAt, 1),
      ]),
      e: [...this.enemies.values()].map((e) => [e.id, e.kind, ...roundVec(e.dir, 6), round(e.hp, 1), e.maxHp, e.attacking ? 1 : 0]),
      m: [...this.pods.values()].map((p) => [p.id, ...roundVec(p.dir, 6), ...roundVec(p.from, 6), round(p.t0, 2), p.dur]),
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
    this.reactor.max = msg.rm || this.reactor.max;
    this.reactorHitAt = msg.rt;
    this.wave = msg.wv;
    this.waveActive = !!msg.wa;
    this.nextWaveAt = msg.nw;
    this.queue = new Array(msg.q).fill({ kind: 0 });
    this.gates = msg.g;
    this.counters = msg.c;
    if (DIFFICULTY[msg.df]) this.diff = msg.df;
    this.daily = !!msg.dy;
    this.logs = new Set(msg.lg || []);
    this.storm = msg.sm ? { start: msg.sm[0], end: msg.sm[1], ambushed: true } : null;
    this.boss = msg.b
      ? {
          hp: msg.b[0],
          maxHp: msg.b[1],
          t0: msg.b[2],
          phase: msg.b[3],
          nextStrike: Infinity,
          strikes: msg.b[4].map(([id, x, y, z, at]) => ({ id, dir: [x, y, z], at })),
          strikeId: 0,
        }
      : null;
    const players = new Map();
    for (const [id, hp, dead, respawnAt, maxHp, cls, revive, downDir, dmg, rate, grenadeAt] of msg.pl) {
      const prev = this.players.get(id);
      players.set(id, {
        hp,
        maxHp: maxHp || 100,
        cls: classOf(cls),
        dead: !!dead,
        respawnAt,
        lastHit: prev?.lastHit ?? -99,
        dir: prev?.dir ?? null,
        downDir: downDir || null,
        revive: revive || 0,
        up: { dmg: dmg || 0, rate: rate || 0 },
        grenadeAt: grenadeAt || 0,
      });
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
