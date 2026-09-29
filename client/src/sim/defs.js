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
};

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
