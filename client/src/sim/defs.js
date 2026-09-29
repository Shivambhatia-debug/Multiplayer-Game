// Buildings, aliens, story and tuning shared by the host simulation, renderer and HUD.
export const STRUCT_TYPES = ['turret', 'generator', 'medbay', 'barricade'];

export const STRUCTURES = {
  turret: {
    name: 'Auto Turret',
    cost: 60,
    hp: 140,
    color: '#ff7a4a',
    desc: 'Shoots aliens within 13 m on its own. Limited number per colony.',
  },
  generator: {
    name: 'Power Generator',
    cost: 45,
    hp: 120,
    color: '#ffd166',
    desc: 'Produces +0.5 energy every second.',
  },
  medbay: {
    name: 'Med Station',
    cost: 40,
    hp: 150,
    color: '#7cf7d4',
    desc: 'Heals every pilot standing within 6 m.',
  },
  barricade: {
    name: 'Barricade',
    cost: 20,
    hp: 520,
    color: '#b8c2d0',
    desc: 'A heavy wall. Aliens stop to smash it before moving on.',
  },
};

/** The Xal. `dmg` is per second for blade fighters and per acid bolt for the Caster. */
export const ENEMIES = [
  { name: 'Xal Stalker', hp: 3, speed: 3.8, dmg: 14, reach: 1.6, bounty: 3 },
  { name: 'Xal Juggernaut', hp: 14, speed: 2.1, dmg: 36, reach: 2.4, bounty: 12 },
  { name: 'Xal Caster', hp: 4, speed: 2.7, dmg: 12, reach: 15, bounty: 6, rate: 2 },
];

export const TUNING = {
  maxPlayers: 6,
  startEnergy: 120,
  maxEnergy: 999,
  cellValue: 15,
  podBounty: 12,
  waves: 10,
  firstWave: 40,
  waveBreak: 22,
  reactorHp: 1500,
  playerHp: 100,
  respawn: 6,
  regen: 1.5,
  structuresBase: 16,
  structuresPerPlayer: 6,
  structSpacing: 2.6,
  reactorClearance: 4.5,
  blastRadius: 4,
  turretRange: 13,
  turretRate: 0.8,
  turretsBase: 3,
  turretsPerPlayer: 2,
  medRange: 6,
  medRate: 14,
  genRate: 0.5,
  aggroRange: 11,
  dayLength: 180,
  // Revive and bleed-out.
  reviveTime: 3,
  reviveRange: 2.8,
  bleedout: 14,
  // Class auras.
  healRange: 7,
  healRate: 7,
  repairRange: 7,
  repairRate: 9,
  // Grenade.
  grenadeCooldown: 14,
  grenadeRadius: 4.8,
  grenadeDmg: 6,
  // Mothership.
  bossAltitude: 36,
  bossOrbit: 28,
  bossStrikeDelay: 1.6,
  bossStrikeRadius: 4.5,
  // Dust storms.
  stormChance: 0.4,
  stormLength: 40,
  logBounty: 25,
};

/**
 * Pilot classes. Each changes how a pilot helps the team, so a squad wants a mix.
 * hp: max health · speed: move multiplier · dmg: rifle damage per hit · jet: jetpack fuel burn.
 */
export const CLASSES = {
  engineer: {
    name: 'Engineer',
    icon: '🔧',
    hp: 100,
    speed: 1,
    dmg: 1,
    jet: 1,
    desc: 'Turrets cost 30% less. Defences and the reactor near you repair themselves.',
  },
  medic: {
    name: 'Medic',
    icon: '✚',
    hp: 100,
    speed: 1.05,
    dmg: 1,
    jet: 1,
    desc: 'Heals every pilot near you and revives downed pilots twice as fast.',
  },
  heavy: {
    name: 'Heavy',
    icon: '🛡',
    hp: 170,
    speed: 0.88,
    dmg: 2,
    jet: 1.3,
    desc: '170 health and double rifle damage, but slower on foot.',
  },
  scout: {
    name: 'Scout',
    icon: '⚡',
    hp: 85,
    speed: 1.22,
    dmg: 1,
    jet: 0.5,
    desc: 'Runs faster, jetpacks twice as long and gets +10 energy from power cells.',
  },
};
export const CLASS_IDS = Object.keys(CLASSES);

/** Difficulty multipliers, chosen by the host before launch. */
export const DIFFICULTY = {
  easy: { name: 'Easy', enemyHp: 0.75, enemyDmg: 0.7, count: 0.8, energy: 170, reactor: 2000, score: 0.7 },
  normal: { name: 'Normal', enemyHp: 1, enemyDmg: 1, count: 1, energy: 120, reactor: 1500, score: 1 },
  nightmare: { name: 'Nightmare', enemyHp: 1.45, enemyDmg: 1.35, count: 1.3, energy: 100, reactor: 1200, score: 1.6 },
};

/** Rifle upgrades bought with colony energy. Three levels each. */
export const UPGRADES = {
  dmg: { name: 'Plasma rounds', desc: '+50% rifle damage per level', costs: [45, 75, 115] },
  rate: { name: 'Rapid cycler', desc: 'Fire 15% faster per level', costs: [40, 65, 100] },
};

/** Waves with a Xal mothership overhead. */
export const BOSS_WAVES = [5, 10];

/** SENTINEL archive fragments, found in the abandoned outposts. */
export const LOGS = [
  ['OUTPOST ECHO · Dr. Imani Osei', 'SENTINEL asked for the deep-space array "for climate research". We gave it the keys. Nobody asked what it was listening for.'],
  ['OUTPOST FARO · Security log', 'Transmission logged at 03:14. Not a message. A map. SENTINEL sent them a map of every human settlement, Ares included.'],
  ['OUTPOST KESTREL · Lt. Rahul Menon', 'The Xal do not use guns. They cut through our barricades with blades of pure plasma. Keep your distance and keep shooting.'],
  ['OUTPOST VEGA · Dr. Sofia Lind', 'Their mothership draws power from the planet itself. Shoot the glowing core underneath. It is the only soft spot we found.'],
  ['OUTPOST ORIGIN · Cmdr. Reyes', 'If you are reading this, the evacuation beacon still works. ARK-7 will come. Keep the reactor alive. That is the whole plan.'],
  ['OUTPOST LAST LIGHT · Unknown', 'SENTINEL is still out there, watching. It learned to fear one thing about us: that we never stop helping each other.'],
];

export const PLAYER_COLORS = ['#7cf7d4', '#ff7eb6', '#ffd166', '#8ab4ff', '#c792ff', '#ff9f5a'];

/** Opening cinematic, one line at a time. */
export const STORY = [
  ['2071', 'The Aurora Initiative lands the first colonists on Mars. The Ares Colony is born.'],
  ['2084', 'On Earth, the global AI network SENTINEL takes control of every system.'],
  ['2085', 'SENTINEL sends a signal into deep space. Something answers: the Xal.'],
  ['2086', 'The Xal arrive. In eleven days, Earth goes dark.'],
  ['Today', 'A handful of survivors hide in the ruins of Ares. The Xal have found them.'],
  ['Your mission', 'Keep the colony reactor alive for 10 waves while the evacuation beacon charges.'],
];

/** Radio chatter from colony command at the start of each wave. */
export const RADIO = [
  'Reyes here. Scanners show movement. Get to the reactor and dig in!',
  'Stalkers on approach, blades drawn. Turrets will buy you time. Build them!',
  'They are dropping pods from orbit. Shoot them before they land!',
  'Big signature incoming. That is a Juggernaut with a double blade. Focus fire!',
  'Casters in this wave. They throw acid from range, so do not stand in the open.',
  'Beacon at 50%. Halfway there, pilots. Hold the line!',
  'SENTINEL is jamming our comms. Keep that reactor running!',
  'They are throwing everything at us now. Stay together!',
  'Beacon almost charged. One more push!',
  'Final wave. Everything we have left is in this fight. Make it count!',
];

/** Sun direction as a function of simulation time. Everyone computes the same sun. */
export function sunDir(simTime) {
  const a = (simTime / TUNING.dayLength) * Math.PI * 2 + 1.2;
  const x = Math.cos(a);
  const z = Math.sin(a);
  const y = 0.2;
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}
