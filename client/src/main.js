import './styles.css';
import * as THREE from 'three';
import { GameRenderer } from './render/scene.js';
import { World, meteorPos } from './sim/world.js';
import { STRUCTURES, STRUCT_TYPES, PLAYER_COLORS, TUNING } from './sim/defs.js';
import { PLANET_RADIUS as R } from './sim/terrain.js';
import { dist } from './sim/vec.js';
import { Session } from './net/session.js';
import { LocalTransport } from './net/transports.js';
import { createTransport, lookupRoom, makeRoomCode, makePlayerId } from './net/api.js';
import { LocalPlayer } from './game/controller.js';
import { Input } from './game/input.js';
import { Sound } from './audio.js';
import { Hud, toast, renderPlayerList, formatTime } from './ui/hud.js';

const $ = (id) => document.getElementById(id);
const canvas = $('scene');
const renderer = new GameRenderer(canvas);
const input = new Input(canvas);
const sound = new Sound();
const hud = new Hud();
const player = new LocalPlayer();
const demo = World.demo();
const raycaster = new THREE.Raycaster();

const NAMES = ['Nova', 'Kepler', 'Vega', 'Lyra', 'Atlas', 'Juno', 'Echo', 'Orion', 'Sol', 'Zephyr'];
const profile = loadProfile();
let meId = makePlayerId();
let session = null;
let screen = 'menu';
let selected = null;
let lastPhase = null;
let lastSeed = null;
let helpOpen = false;
let poseTimer = 0;
let poseKey = '';
let poseIdle = 0;
let fireCooldown = 0;
let hudTimer = 0;
let moodTimer = 0;
let orbitAngle = 0.6;
const pendingOre = new Map();

// ---------------------------------------------------------------- profile

function loadProfile() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem('seedfall:profile') || '{}');
  } catch {
    saved = {};
  }
  return {
    name: typeof saved.name === 'string' && saved.name ? saved.name : NAMES[Math.floor(Math.random() * NAMES.length)],
    color: PLAYER_COLORS.includes(saved.color) ? saved.color : PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)],
  };
}

function saveProfile() {
  try {
    localStorage.setItem('seedfall:profile', JSON.stringify(profile));
  } catch {
    // storage unavailable; the profile just won't persist
  }
}

// ---------------------------------------------------------------- menu

function setupMenu() {
  const nameInput = $('name-input');
  nameInput.value = profile.name;
  nameInput.addEventListener('input', () => {
    profile.name = nameInput.value.replace(/[<>]/g, '').trim().slice(0, 16) || 'Pilot';
    saveProfile();
  });

  const sw = $('swatches');
  sw.innerHTML = PLAYER_COLORS.map((c) => `<button class="swatch" data-color="${c}" style="background:${c};color:${c}" aria-label="Colour ${c}"></button>`).join('');
  const markSwatch = () => sw.querySelectorAll('.swatch').forEach((b) => b.classList.toggle('active', b.dataset.color === profile.color));
  sw.addEventListener('click', (e) => {
    const b = e.target.closest('.swatch');
    if (!b) return;
    profile.color = b.dataset.color;
    saveProfile();
    markSwatch();
    sound.unlock();
    sound.play('ui');
  });
  markSwatch();

  const codeInput = $('code-input');
  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  });
  codeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('join-btn').click();
  });

  $('create-btn').addEventListener('click', () => startSession({ creating: true }));
  $('join-btn').addEventListener('click', () => {
    const code = codeInput.value.trim();
    if (code.length !== 5) {
      menuStatus('Enter the 5-character room code.');
      return;
    }
    startSession({ code });
  });
  $('solo-btn').addEventListener('click', () => startSession({ solo: true }));

  const fromUrl = new URLSearchParams(location.search).get('room');
  if (fromUrl) {
    codeInput.value = fromUrl.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    menuStatus('Invite found. Pick a name and press Join.');
  }
}

function menuStatus(text) {
  $('menu-status').textContent = text;
}

function setBusy(busy) {
  for (const id of ['create-btn', 'join-btn', 'solo-btn']) $(id).disabled = busy;
  if (busy) menuStatus('Connecting…');
}

function showScreen(name) {
  screen = name;
  $('menu').classList.toggle('hidden', name !== 'menu');
  $('lobby').classList.toggle('hidden', name !== 'lobby');
  $('hud').classList.toggle('hidden', name !== 'game');
  input.enabled = name === 'game';
  if (name !== 'game') {
    input.unlock();
    renderer.setGhost(null);
  }
}

// ---------------------------------------------------------------- session lifecycle

async function startSession({ solo = false, creating = false, code = '' }) {
  sound.unlock();
  sound.play('ui');
  setBusy(true);
  try {
    const me = { id: meId, name: profile.name, color: profile.color };
    let transport;
    if (solo) {
      transport = new LocalTransport();
      code = 'SOLO';
    } else {
      ({ transport } = await createTransport());
      if (creating) {
        for (let i = 0; i < 5; i++) {
          code = makeRoomCode();
          const info = await lookupRoom(code);
          if (!info.exists) break;
        }
      } else {
        const info = await lookupRoom(code);
        if (!info.exists) throw new Error(`Room ${code} doesn't exist (or everyone left).`);
        if (info.full) throw new Error('That room is full (6 pilots max).');
      }
    }
    const s = new Session({ transport, room: code, me, solo });
    wireSession(s);
    await s.connect();
    session = s;
    lastPhase = null;
    lastSeed = null;
    menuStatus('');
    if (solo) {
      history.replaceState(null, '', location.pathname);
      s.act({ k: 'start' });
    } else {
      history.replaceState(null, '', `${location.pathname}?room=${code}`);
      showLobby();
    }
  } catch (error) {
    menuStatus(error.message || 'Could not connect.');
  } finally {
    setBusy(false);
    if (session) menuStatus('');
  }
}

function leaveSession() {
  session?.leave();
  session = null;
  meId = makePlayerId();
  lastPhase = null;
  selected = null;
  hud.setSelected(null);
  $('victory').classList.add('hidden');
  history.replaceState(null, '', location.pathname);
  showScreen('menu');
}

function wireSession(s) {
  s.onMembers = (members) => {
    renderPlayerList($('lobby-players'), members, s.hostId, meId);
    renderPlayerList($('hud-players'), members, s.hostId, meId);
    updateLobbyButton();
    updateVictoryButtons();
  };
  s.onEvents = (events) => handleEvents(events);
  s.onShot = (shot) => {
    renderer.fx.beam(new THREE.Vector3(...shot.o), new THREE.Vector3(...shot.e), shot.c);
    sound.play('shoot', proximity(new THREE.Vector3(...shot.o).normalize().toArray()) * 0.6);
  };
  s.onPing = (ping) => {
    const p = new THREE.Vector3(...ping.p);
    renderer.fx.pillar(p, ping.c);
    sound.play('ping', 0.8);
    toast(`📍 ${s.memberName(ping.from)} pinged a location`);
  };
  s.onError = (msg) => toast(msg, 'bad', 5000);
  s.onHostChange = (name, isMe) => toast(isMe ? '👑 You are now the host.' : `👑 ${name} is now the host.`, 'warn');
}

function showLobby() {
  showScreen('lobby');
  $('room-code').textContent = session.room;
  updateLobbyButton();
}

function updateLobbyButton() {
  if (!session) return;
  const btn = $('launch-btn');
  btn.disabled = !session.isHost;
  btn.textContent = session.isHost ? 'Launch mission' : 'Waiting for host to launch…';
  $('lobby-status').textContent = session.members.length < 2 && session.isHost ? 'Share the code — or launch now and friends can drop in later.' : '';
}

function setupLobby() {
  $('launch-btn').addEventListener('click', () => {
    sound.play('ui');
    session?.act({ k: 'start' });
  });
  $('leave-btn').addEventListener('click', leaveSession);
  $('room-code').addEventListener('click', async () => {
    const link = `${location.origin}${location.pathname}?room=${session?.room}`;
    try {
      await navigator.clipboard.writeText(link);
      $('copy-hint').textContent = 'Invite link copied!';
    } catch {
      $('copy-hint').textContent = link;
    }
  });
}

/** Reacts to phase transitions observed in the (host or mirrored) world. */
function onPhase(phase) {
  if (phase === 'lobby') {
    $('victory').classList.add('hidden');
    showLobby();
  } else if (phase === 'play') {
    $('victory').classList.add('hidden');
    enterGame();
  } else if (phase === 'won') {
    if (screen !== 'game') enterGame();
    showVictory();
  }
}

function enterGame() {
  showScreen('game');
  player.spawn(session.world);
  hud.history = [];
  $('hud-room').textContent = session.solo ? 'Solo' : session.room;
  toast('Click the planet to take control. Press H for the field manual.', '', 6000);
}

// ---------------------------------------------------------------- gameplay

function proximity(dir) {
  return Math.max(0.15, 1 - (dist(dir, player.dir.toArray()) * R) / 55);
}

function handleEvents(events) {
  for (const ev of events) {
    switch (ev.e) {
      case 'build': {
        const def = STRUCTURES[ev.type];
        renderer.sparkle(ev.dir, def.color);
        sound.play('build', proximity(ev.dir));
        if (ev.pid !== meId) toast(`${ev.by} built a ${def.name}`);
        break;
      }
      case 'ore':
        renderer.sparkle(ev.dir, 0x8ff7ff, 0);
        if (ev.pid === meId) sound.play('collect');
        break;
      case 'shot':
        renderer.meteorDestroyed(ev.pos);
        sound.play('hit', proximity(new THREE.Vector3(...ev.pos).normalize().toArray()));
        toast(`☄ ${ev.pid === meId ? 'You' : ev.by} shot down a meteor  +${TUNING.meteorBounty}⚡`);
        break;
      case 'impact':
        renderer.impact(ev.dir);
        sound.play('boom', proximity(ev.dir));
        if (ev.lost) toast(`💥 Impact! ${ev.lost} structure${ev.lost > 1 ? 's' : ''} destroyed.`, 'bad');
        break;
      case 'shower':
        toast(`☄ Meteor shower incoming: ${ev.n} meteors. Shoot them before they land in the red rings!`, 'warn big', 6000);
        sound.play('alarm');
        break;
      case 'deny':
        if (ev.to === meId) {
          toast(ev.msg, 'bad', 2200);
          sound.play('deny');
        }
        break;
      case 'salvage':
        renderer.sparkle(ev.dir, 0xffd166);
        if (ev.pid !== meId) toast(`${ev.by} salvaged a ${STRUCTURES[ev.type].name}`);
        else toast(`Salvaged ${STRUCTURES[ev.type].name}${ev.refund ? ` (+${ev.refund}⚡)` : ''}`);
        break;
      case 'won':
        sound.play('win');
        break;
      case 'restart':
        toast('🌍 A new planet has been generated.', 'warn');
        break;
      default:
    }
  }
}

function findMeteorTarget(world) {
  const cam = renderer.camera.position;
  let best = null;
  let bestAngle = 0.2;
  for (const m of world.meteors.values()) {
    if (world.simTime < m.t0) continue;
    const p = new THREE.Vector3(...meteorPos(m, world.simTime, world.terrain));
    const v = p.clone().sub(cam);
    const d = v.length();
    if (d > 150) continue;
    const angle = v.angleTo(player.aim);
    if (angle < bestAngle) {
      bestAngle = angle;
      best = { m, p };
    }
  }
  return best;
}

function gunPosition() {
  const right = new THREE.Vector3().crossVectors(player.fwd, player.dir).normalize();
  return player.position().addScaledVector(player.dir, 1.05).addScaledVector(right, 0.5);
}

function fire() {
  if (fireCooldown > 0 || !session) return;
  fireCooldown = 0.22;
  const world = session.world;
  const target = findMeteorTarget(world);
  const from = gunPosition();
  const to = target ? target.p : renderer.camera.position.clone().addScaledVector(player.aim, 70);
  renderer.fx.beam(from, to, profile.color);
  sound.play('shoot');
  const r = (v) => Math.round(v * 100) / 100;
  session.sendShot({ o: from.toArray().map(r), e: to.toArray().map(r), c: profile.color });
  if (target) session.act({ k: 'hit', id: target.m.id });
}

function tryBuild() {
  const world = session.world;
  const dir = player.buildDir();
  const def = STRUCTURES[selected];
  const err = world.placementError(selected, dir) || (world.stats.energy < def.cost ? `Need ⚡${def.cost}. Mine crystals!` : null);
  if (err) {
    toast(err, 'bad', 2000);
    sound.play('deny');
    return;
  }
  session.act({ k: 'build', type: selected, dir });
}

function nearestStructure(world, maxDist = 3.5) {
  let best = null;
  let bestD = maxDist;
  const here = player.dir.toArray();
  for (const st of world.structures.values()) {
    const d = dist(st.dir, here) * R;
    if (d < bestD) {
      bestD = d;
      best = st;
    }
  }
  return best;
}

function ping() {
  if (!session) return;
  raycaster.set(renderer.camera.position, player.aim);
  const hit = renderer.terrainMesh ? raycaster.intersectObject(renderer.terrainMesh, false)[0] : null;
  const point = hit ? hit.point : player.position().addScaledVector(player.fwd, 6);
  renderer.fx.pillar(point, profile.color);
  sound.play('ping');
  const r = (v) => Math.round(v * 100) / 100;
  session.sendPing({ p: point.toArray().map(r), c: profile.color });
}

function select(type) {
  selected = selected === type ? null : type;
  hud.setSelected(selected);
  sound.play('ui');
}

function setupControls() {
  input.onKey = (code) => {
    if (code === 'KeyH') {
      toggleHelp();
      return;
    }
    if (helpOpen || !session) return;
    if (code.startsWith('Digit')) {
      const i = Number(code.slice(5)) - 1;
      if (STRUCT_TYPES[i]) select(STRUCT_TYPES[i]);
    } else if (code === 'Escape') select(null);
    else if (code === 'KeyE' && selected) tryBuild();
    else if (code === 'KeyQ') ping();
    else if (code === 'KeyM') toast(sound.toggleMute() ? '🔇 Sound off' : '🔊 Sound on');
    else if (code === 'KeyX') {
      const st = nearestStructure(session.world);
      if (st) session.act({ k: 'salvage', id: st.id });
    }
  };
  input.onClick = (button) => {
    if (helpOpen || !session || session.world.phase !== 'play') return;
    if (button === 2) {
      selected = null;
      hud.setSelected(null);
    } else if (button === 0) {
      if (selected) tryBuild();
      else fire();
    }
  };
  input.onLockChange = () => sound.unlock();
  $('hotbar').addEventListener('click', (e) => {
    const slot = e.target.closest('.slot');
    if (slot) select(slot.dataset.type);
  });
  $('help-close').addEventListener('click', toggleHelp);
  $('again-btn').addEventListener('click', () => session?.act({ k: 'restart' }));
  $('menu-btn').addEventListener('click', leaveSession);
}

function toggleHelp() {
  helpOpen = !helpOpen;
  $('help').classList.toggle('hidden', !helpOpen);
  if (helpOpen) input.unlock();
}

function showVictory() {
  const w = session.world;
  const time = w.wonAt - w.playStart;
  const [medal, title] = time < 600 ? ['🥇', 'Gold'] : time < 900 ? ['🥈', 'Silver'] : ['🥉', 'Bronze'];
  $('victory-title').textContent = `It breathes. ${title} terraformers.`;
  $('medal').textContent = medal;
  const c = w.counters;
  $('victory-stats').innerHTML = [
    [formatTime(time), 'Time'],
    [c.built, 'Built'],
    [c.shot, 'Meteors shot'],
    [c.ore, 'Crystals mined'],
  ]
    .map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`)
    .join('');
  updateVictoryButtons();
  $('victory').classList.remove('hidden');
  input.unlock();
}

function updateVictoryButtons() {
  if (!session) return;
  $('again-btn').disabled = !session.isHost;
  $('victory-wait').textContent = session.isHost ? '' : 'Waiting for the host to start a new planet…';
}

function updateGameplay(dt, world) {
  fireCooldown -= dt;
  const prompt = $('prompt');
  if (world.phase !== 'play') {
    renderer.setGhost(null);
    prompt.textContent = '';
    return;
  }

  // Share our pose, faster in small rooms, and only when it changes (keeps realtime costs low).
  poseTimer -= dt;
  poseIdle += dt;
  if (poseTimer <= 0 && !session.solo) {
    poseTimer = Math.min(0.18, Math.max(0.08, session.members.length * 0.028));
    const pose = player.pose();
    const key = JSON.stringify(pose);
    if (key !== poseKey || poseIdle > 1) {
      session.sendPose(pose);
      poseKey = key;
      poseIdle = 0;
    }
  }

  // Walk into crystals to mine them.
  const here = player.dir.toArray();
  const now = performance.now();
  for (const [id, at] of pendingOre) if (now - at > 2500) pendingOre.delete(id);
  if (player.heightAboveTerrain() < 3) {
    for (const ore of world.ores.values()) {
      if (pendingOre.has(ore.id)) continue;
      if (dist(ore.dir, here) * R < 2.1) {
        pendingOre.set(ore.id, now);
        session.act({ k: 'collect', id: ore.id });
      }
    }
  }

  let text = '';
  if (selected) {
    const dir = player.buildDir();
    const def = STRUCTURES[selected];
    const err = world.placementError(selected, dir) || (world.stats.energy < def.cost ? `Need ⚡${def.cost}` : null);
    renderer.setGhost(selected, dir, !err, world);
    text = err ? `✕ ${err}` : `Click to build ${def.name} (⚡${def.cost}) · Right-click to cancel`;
  } else {
    renderer.setGhost(null);
    const st = nearestStructure(world);
    if (st) {
      const refund = st.type === 'seed' ? 0 : Math.floor(STRUCTURES[st.type].cost / 2);
      text = `[X] Salvage ${STRUCTURES[st.type].name}${refund ? ` (+${refund}⚡)` : ''}`;
    }
  }
  if (!input.active && !helpOpen) text = 'Click to take control';
  else if (input.dragMode && !text) text = 'Right-drag to look · Left-click to act';
  prompt.textContent = text;
  $('crosshair').classList.toggle('lock', !selected && !!findMeteorTarget(world));
}

// ---------------------------------------------------------------- main loop

const orbitTarget = new THREE.Vector3();
let last = performance.now();

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  let world = demo;
  if (session) {
    session.update(dt);
    world = session.world;
    if (world.phase !== lastPhase) {
      lastPhase = world.phase;
      lastSeed = world.seed;
      onPhase(world.phase);
    } else if (world.seed !== lastSeed) {
      lastSeed = world.seed;
      if (screen === 'game') player.spawn(world);
    }
  } else {
    demo.simTime += dt;
  }

  const players = [];
  let focus = null;
  let headlampPos = null;
  if (screen === 'game' && session) {
    const canMove = !helpOpen && world.phase === 'play';
    player.update(dt, input, world, canMove);
    player.updateCamera(renderer.camera, world);
    updateGameplay(dt, world);
    focus = player.dir;
    headlampPos = player.position().addScaledVector(player.dir, 5).addScaledVector(player.fwd, 2);
    players.push({ id: meId, name: profile.name, color: profile.color, pose: player.pose(), isLocal: true });
    for (const m of session.members) {
      if (m.id !== meId) players.push({ id: m.id, name: m.name, color: m.color, pose: session.remotes.get(m.id) });
    }
    hudTimer -= dt;
    if (hudTimer <= 0) {
      hudTimer = 0.1;
      hud.update(world, 0.1);
    }
    moodTimer -= dt;
    if (moodTimer <= 0) {
      moodTimer = 1;
      sound.setMood(world.stats.bio);
    }
  } else {
    orbitAngle += dt * 0.05;
    const d = screen === 'lobby' ? 64 : 74;
    const cam = renderer.camera;
    cam.position.set(Math.sin(orbitAngle) * d, 14 + Math.sin(orbitAngle * 0.7) * 8, Math.cos(orbitAngle) * d);
    cam.up.set(0, 1, 0);
    // Shift the planet away from the UI card on the right.
    const shift = window.innerWidth > 900 ? (screen === 'lobby' ? 20 : 8) : 0;
    orbitTarget.set(Math.cos(orbitAngle) * shift, 0, -Math.sin(orbitAngle) * shift);
    cam.lookAt(orbitTarget);
  }

  renderer.update(dt, { world, players, focus, headlampPos });
  renderer.render(dt);
  requestAnimationFrame(frame);
}

setupMenu();
setupLobby();
setupControls();
showScreen('menu');
requestAnimationFrame((t) => {
  last = t;
  frame(t);
  $('loading').classList.add('done');
});
window.addEventListener('beforeunload', () => session?.leave());

// Debug handle for local testing only (stripped from production builds).
if (import.meta.env.DEV) {
  window.__seedfall = { get session() { return session; }, player, renderer };
}
