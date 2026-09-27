// Structure catalogue and tuning shared by host simulation, renderer and HUD.
export const STRUCT_TYPES = ['pylon', 'scrubber', 'condenser', 'heater', 'seed'];

export const STRUCTURES = {
  pylon: {
    name: 'Solar Pylon',
    cost: 20,
    icon: '☀',
    color: '#ffd166',
    desc: 'Generates energy. Output follows the sun, so spread them around the planet.',
  },
  scrubber: {
    name: 'Air Scrubber',
    cost: 30,
    icon: '≋',
    color: '#8affc1',
    desc: 'Filters toxins and releases oxygen. Uses 0.35 energy/s.',
  },
  condenser: {
    name: 'Vapor Condenser',
    cost: 30,
    icon: '💧',
    color: '#5cc8ff',
    desc: 'Pulls water from the air, but only once the planet is above freezing. Uses 0.35 energy/s.',
  },
  heater: {
    name: 'Thermal Core',
    cost: 25,
    icon: '🔥',
    color: '#ff8a3d',
    desc: 'Warms the planet. Too many will cook your forests. Uses 0.3 energy/s.',
  },
  seed: {
    name: 'Seed Pod',
    cost: 10,
    icon: '🌱',
    color: '#9dff6a',
    desc: 'Grows into a tree once water, air and heat allow. Mature trees spread on their own.',
  },
};

export const TUNING = {
  maxPlayers: 6,
  startEnergy: 70,
  maxEnergy: 600,
  oreValue: 12,
  meteorBounty: 10,
  maxStructures: 110,
  maxTrees: 75,
  structSpacing: 2.2,
  treeSpacing: 1.6,
  blastRadius: 4.5,
  dayLength: 150,
  firstShower: 55,
  winBio: 90,
  winHold: 12,
  upkeep: { scrubber: 0.35, condenser: 0.35, heater: 0.3 },
};

export const PLAYER_COLORS = ['#7cf7d4', '#ff7eb6', '#ffd166', '#8ab4ff', '#c792ff', '#ff9f5a'];

/** Sun direction as a function of simulation time. Everyone computes the same sun. */
export function sunDir(simTime) {
  const a = (simTime / TUNING.dayLength) * Math.PI * 2;
  const x = Math.cos(a);
  const z = Math.sin(a);
  const y = 0.28;
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}

/** Maps heat (0-100) to a displayed temperature in °C. */
export const heatToCelsius = (heat) => Math.round(heat * 0.9 - 30);

/** 0-100 score for how close heat is to the comfortable band. */
export function heatScore(heat) {
  if (heat >= 45 && heat <= 65) return 100;
  const off = heat < 45 ? 45 - heat : heat - 65;
  return Math.max(0, 100 - off * 3);
}

export function biosphere(stats) {
  return (stats.air + stats.water + heatScore(stats.heat) + stats.life) / 4;
}
