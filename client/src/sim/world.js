// The planet simulation. The host runs `step()` and `handleAction()`; every other
// client mirrors the host through `applyWorld()` / `applyTick()`. If the host leaves,
// the next player simply starts stepping its mirrored copy (host migration).
import { mulberry32 } from './noise.js';
import { createTerrain, waterRadius, PLANET_RADIUS as R } from './terrain.js';
import { STRUCTURES, STRUCT_TYPES, TUNING, sunDir, biosphere } from './defs.js';
import { norm, dot, dist, clamp, round, roundVec, randomDir, offsetDir } from './vec.js';

const METEOR_ALTITUDE = 70;

export function newSeed() {
  return (Math.random() * 0x7fffffff) | 0;
}

/** Position of a meteor at simulation time `t`, as [x, y, z]. */
export function meteorPos(m, t, terrain) {
  const k = clamp((t - m.t0) / m.dur, 0, 1);
  const e = k * k;
  const start = m.from.map((v) => v * (R + METEOR_ALTITUDE));
  const end = m.dir.map((v) => v * terrain.surfaceRadius(m.dir));
  return [start[0] + (end[0] - start[0]) * e, start[1] + (end[1] - start[1]) * e, start[2] + (end[2] - start[2]) * e];
}

export class World {
  constructor(seed = newSeed()) {
    this.reset(seed, 'lobby');
  }

  reset(seed, phase = 'lobby') {
    this.seed = seed;
    this.terrain = createTerrain(seed);
    this.rand = mulberry32(seed ^ 0x5eed5);
    this.phase = phase;
    this.simTime = 0;
    this.playStart = 0;
    this.wonAt = 0;
    this.stats = { air: 4, water: 0, heat: 10, life: 0, energy: TUNING.startEnergy, bio: 0 };
    this.power = 1;
    this.hold = 0;
    this.structures = new Map();
    this.ores = new Map();
    this.meteors = new Map();
    this.nextId = 1;
    this.nextShowerAt = TUNING.firstShower;
    this.oreTimer = 0;
    this.counters = { built: 0, shot: 0, impacts: 0, ore: 0 };
    this.version = 1;
    this.growthDirty = false;
    this.stats.bio = biosphere(this.stats);
    for (let i = 0; i < 18; i++) this.spawnOre();
  }

  get waterR() {
    return waterRadius(this.stats.water);
  }

  isUnderwater(dir, margin = 0.15) {
    return this.terrain.surfaceRadius(dir) < this.waterR + margin;
  }

  treeCount() {
    let n = 0;
    for (const s of this.structures.values()) if (s.type === 'seed') n++;
    return n;
  }

  /** Returns null when the structure can be placed, otherwise a human-readable reason. */
  placementError(type, dir) {
    if (!STRUCTURES[type]) return 'Unknown structure';
    if (this.structures.size >= TUNING.maxStructures) return 'Structure limit reached';
    if (type === 'seed' && this.treeCount() >= TUNING.maxTrees) return 'The forest is at capacity';
    if (this.isUnderwater(dir)) return 'Too close to water';
    for (const o of this.structures.values()) {
      const min = type === 'seed' && o.type === 'seed' ? TUNING.treeSpacing : TUNING.structSpacing;
      if (dist(o.dir, dir) * R < min) return 'Too close to another structure';
    }
    return null;
  }

  addStructure(type, dir, owner, growth = 0) {
    const s = { id: this.nextId++, type, dir, hp: 100, growth, owner };
    this.structures.set(s.id, s);
    this.version++;
    return s;
  }

  spawnOre() {
    for (let tries = 0; tries < 12; tries++) {
      const dir = randomDir(this.rand);
      if (this.isUnderwater(dir, 0.3)) continue;
      const id = this.nextId++;
      this.ores.set(id, { id, dir });
      this.version++;
      return;
    }
  }

  start() {
    if (this.phase !== 'lobby') return [];
    this.phase = 'play';
    this.playStart = this.simTime;
    this.nextShowerAt = this.simTime + TUNING.firstShower;
    return [{ e: 'start' }];
  }

  /** Advances the authoritative simulation. Returns events for the HUD and effects. */
  step(dt, playerCount) {
    this.simTime += dt;
    if (this.phase !== 'play') return [];
    const events = [];
    const s = this.stats;
    const sun = sunDir(this.simTime);

    let gen = 0;
    let upkeep = 0;
    let heaters = 0;
    let scrubbers = 0;
    let condensers = 0;
    let treeMass = 0;
    for (const st of this.structures.values()) {
      if (st.type === 'pylon') gen += 0.25 + 0.85 * Math.max(0, dot(st.dir, sun));
      else if (st.type === 'heater') heaters++;
      else if (st.type === 'scrubber') scrubbers++;
      else if (st.type === 'condenser') condensers++;
      else if (st.type === 'seed') treeMass += st.growth;
      upkeep += TUNING.upkeep[st.type] || 0;
    }
    if (s.energy + (gen - upkeep) * dt >= 0) {
      this.power = 1;
      s.energy += (gen - upkeep) * dt;
    } else {
      this.power = clamp((s.energy / dt + gen) / upkeep, 0, 1);
      s.energy = 0;
    }
    s.energy = Math.min(TUNING.maxEnergy, s.energy);

    const p = this.power;
    const condEff = clamp((s.heat - 33) / 15, 0, 1);
    s.heat += (0.2 * heaters * p - 0.02 * (s.heat - 8)) * dt;
    s.water += (0.2 * condensers * p * condEff - 0.006 * s.water * (s.heat > 75 ? 2.5 : 1) - 0.003 * treeMass) * dt;
    s.air += (0.16 * scrubbers * p + 0.02 * treeMass - 0.006 * s.air) * dt;
    s.heat = clamp(s.heat, 0, 100);
    s.water = clamp(s.water, 0, 100);
    s.air = clamp(s.air, 0, 100);

    this.stepTrees(dt, events);

    s.life = Math.min(100, treeMass * 2.4);
    s.bio = biosphere(s);

    if (s.bio >= TUNING.winBio) this.hold += dt;
    else this.hold = Math.max(0, this.hold - dt * 2);
    if (this.hold >= TUNING.winHold) {
      this.phase = 'won';
      this.wonAt = this.simTime;
      this.meteors.clear();
      events.push({ e: 'won' });
      return events;
    }

    const oreTarget = 14 + playerCount * 3;
    this.oreTimer += dt;
    if (this.ores.size < oreTarget && this.oreTimer > 3.5) {
      this.oreTimer = 0;
      this.spawnOre();
    }

    this.stepMeteors(playerCount, events);
    return events;
  }

  stepTrees(dt, events) {
    const s = this.stats;
    const waterR = this.waterR;
    const canSpread = s.water > 35 && s.air > 30 && this.treeCount() < TUNING.maxTrees;
    for (const t of [...this.structures.values()]) {
      if (t.type !== 'seed') continue;
      const underwater = this.terrain.surfaceRadius(t.dir) < waterR - 0.1;
      if (underwater) t.hp -= 6 * dt;
      else if (s.heat > 80) t.hp -= 2.5 * dt;
      else if (s.water > 12 && s.air > 15 && s.heat >= 25 && t.growth < 1) {
        const q = Math.min(1, s.water / 40) * Math.min(1, s.air / 40) * (s.heat >= 35 && s.heat <= 72 ? 1 : 0.5);
        t.growth = Math.min(1, t.growth + (dt / 55) * q);
        this.growthDirty = true;
      }
      if (t.hp <= 0) {
        this.structures.delete(t.id);
        this.version++;
        events.push({ e: 'wither', id: t.id });
        continue;
      }
      if (canSpread && t.growth >= 1 && this.rand() < 0.018 * dt) {
        const dir = offsetDir(t.dir, this.rand, 2, 4.5, R);
        if (!this.placementError('seed', dir)) this.addStructure('seed', dir, 'planet', 0.05);
      }
    }
  }

  stepMeteors(playerCount, events) {
    const t = this.simTime;
    if (t >= this.nextShowerAt) {
      const elapsed = t - this.playStart;
      const count = Math.min(8, 2 + Math.floor(playerCount / 2) + Math.floor(elapsed / 200));
      const targets = [...this.structures.values()];
      for (let i = 0; i < count; i++) {
        const dir =
          targets.length && this.rand() < 0.7
            ? offsetDir(targets[Math.floor(this.rand() * targets.length)].dir, this.rand, 0, 3, R)
            : randomDir(this.rand);
        const id = this.nextId++;
        this.meteors.set(id, { id, dir, from: offsetDir(dir, this.rand, 8, 16, R), t0: t + 2 + i * 1.4, dur: 9 });
      }
      this.nextShowerAt = t + 45 + this.rand() * 30;
      events.push({ e: 'shower', n: count });
    }
    for (const m of [...this.meteors.values()]) {
      if (t < m.t0 + m.dur) continue;
      this.meteors.delete(m.id);
      let lost = 0;
      for (const st of [...this.structures.values()]) {
        if (dist(st.dir, m.dir) * R < TUNING.blastRadius) {
          this.structures.delete(st.id);
          lost++;
        }
      }
      if (lost) this.version++;
      const s = this.stats;
      s.air = Math.max(0, s.air - 3);
      s.water = Math.min(100, s.water + 2.5);
      s.heat = Math.min(100, s.heat + 2);
      this.counters.impacts++;
      events.push({ e: 'impact', dir: m.dir, lost });
    }
  }

  /** Validates and applies a player action. Only the host calls this. */
  handleAction(act, by) {
    if (!act || typeof act !== 'object') return [];
    const name = by.name;
    if (act.k === 'start') return this.start();
    if (act.k === 'restart') {
      this.reset(newSeed(), 'play');
      this.nextShowerAt = TUNING.firstShower;
      return [{ e: 'restart' }];
    }
    if (this.phase !== 'play') return [];
    const s = this.stats;

    if (act.k === 'build') {
      const def = STRUCTURES[act.type];
      if (!def || !Array.isArray(act.dir)) return [];
      const dir = norm(act.dir.map(Number));
      if (dir.some((v) => !Number.isFinite(v))) return [];
      if (s.energy < def.cost) return [{ e: 'deny', to: by.id, msg: 'Not enough energy' }];
      const err = this.placementError(act.type, dir);
      if (err) return [{ e: 'deny', to: by.id, msg: err }];
      s.energy -= def.cost;
      const st = this.addStructure(act.type, dir, by.id);
      this.counters.built++;
      return [{ e: 'build', type: act.type, id: st.id, by: name, pid: by.id, dir }];
    }
    if (act.k === 'collect') {
      const ore = this.ores.get(act.id);
      if (!ore) return [];
      this.ores.delete(ore.id);
      this.version++;
      s.energy = Math.min(TUNING.maxEnergy, s.energy + TUNING.oreValue);
      this.counters.ore++;
      return [{ e: 'ore', by: name, dir: ore.dir, pid: by.id }];
    }
    if (act.k === 'hit') {
      const m = this.meteors.get(act.id);
      if (!m || this.simTime < m.t0 || this.simTime > m.t0 + m.dur) return [];
      const pos = meteorPos(m, this.simTime, this.terrain);
      this.meteors.delete(m.id);
      s.energy = Math.min(TUNING.maxEnergy, s.energy + TUNING.meteorBounty);
      this.counters.shot++;
      return [{ e: 'shot', id: m.id, by: name, pid: by.id, pos: roundVec(pos, 2) }];
    }
    if (act.k === 'salvage') {
      const st = this.structures.get(act.id);
      if (!st) return [];
      this.structures.delete(st.id);
      this.version++;
      const refund = st.type === 'seed' ? 0 : Math.floor(STRUCTURES[st.type].cost * 0.5);
      s.energy = Math.min(TUNING.maxEnergy, s.energy + refund);
      return [{ e: 'salvage', type: st.type, by: name, pid: by.id, refund, dir: st.dir }];
    }
    return [];
  }

  // ---- Snapshots -------------------------------------------------------------

  serializeWorld() {
    return {
      t: 'w',
      v: this.version,
      seed: this.seed,
      n: this.nextId,
      s: [...this.structures.values()].map((st) => [
        st.id,
        STRUCT_TYPES.indexOf(st.type),
        ...roundVec(st.dir, 4),
        Math.round(st.hp),
        round(st.growth, 2),
      ]),
      o: [...this.ores.values()].map((o) => [o.id, ...roundVec(o.dir, 4)]),
    };
  }

  serializeTick() {
    const s = this.stats;
    return {
      t: 'k',
      seed: this.seed,
      st: round(this.simTime, 2),
      ph: this.phase,
      ps: round(this.playStart, 2),
      wa: round(this.wonAt, 2),
      s: [s.air, s.water, s.heat, s.life, s.energy, s.bio].map((v) => round(v, 1)),
      pw: round(this.power, 2),
      h: round(this.hold, 1),
      ns: round(this.nextShowerAt, 1),
      c: this.counters,
      m: [...this.meteors.values()].map((m) => [m.id, ...roundVec(m.dir, 4), ...roundVec(m.from, 4), round(m.t0, 2), m.dur]),
    };
  }

  applyWorld(msg) {
    if (msg.seed !== this.seed) this.reset(msg.seed, this.phase);
    this.nextId = Math.max(this.nextId, msg.n || 0);
    this.version = msg.v;
    this.structures = new Map(
      msg.s.map(([id, ti, x, y, z, hp, growth]) => [id, { id, type: STRUCT_TYPES[ti], dir: [x, y, z], hp, growth }]),
    );
    this.ores = new Map(msg.o.map(([id, x, y, z]) => [id, { id, dir: [x, y, z] }]));
  }

  applyTick(msg) {
    if (msg.seed !== this.seed) this.reset(msg.seed, msg.ph);
    const drift = msg.st - this.simTime;
    this.simTime = Math.abs(drift) > 1 ? msg.st : this.simTime + drift * 0.25;
    this.phase = msg.ph;
    this.playStart = msg.ps;
    this.wonAt = msg.wa;
    const [air, water, heat, life, energy, bio] = msg.s;
    Object.assign(this.stats, { air, water, heat, life, energy, bio });
    this.power = msg.pw;
    this.hold = msg.h;
    this.nextShowerAt = msg.ns;
    this.counters = msg.c;
    this.meteors = new Map(
      msg.m.map(([id, dx, dy, dz, fx, fy, fz, t0, dur]) => [id, { id, dir: [dx, dy, dz], from: [fx, fy, fz], t0, dur }]),
    );
  }

  /** A lush, pre-built planet for the title screen. */
  static demo() {
    const w = new World(1337);
    w.phase = 'demo';
    Object.assign(w.stats, { air: 80, water: 62, heat: 55, life: 70 });
    const rand = mulberry32(99);
    for (let i = 0; i < 140 && w.structures.size < 90; i++) {
      const dir = randomDir(rand);
      const type = i % 9 === 0 ? STRUCT_TYPES[Math.floor(rand() * 4)] : 'seed';
      if (!w.placementError(type, dir)) w.addStructure(type, dir, 'demo', type === 'seed' ? 0.4 + rand() * 0.6 : 0);
    }
    return w;
  }
}
