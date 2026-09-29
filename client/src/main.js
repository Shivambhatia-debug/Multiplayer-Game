import './styles.css';
import * as THREE from 'three';
import { GameRenderer } from './render/scene.js';
import { World, podPos } from './sim/world.js';
import { STRUCTURES, STRUCT_TYPES, PLAYER_COLORS, TUNING, ENEMIES, STORY, RADIO } from './sim/defs.js';
import { PLANET_RADIUS as R } from './sim/terrain.js';
import { dist } from './sim/vec.js';
import { Session } from './net/session.js';
import { LocalTransport } from './net/transports.js';
import { createTransport, lookupRoom, makeRoomCode, makePlayerId } from './net/api.js';
import { LocalPlayer } from './game/controller.js';
import { Input } from './game/input.js';
import { TouchControls } from './game/touch.js';
import { Sound } from './audio.js';
import { Hud, toast, renderPlayerList, formatTime } from './ui/hud.js';
import { Juice } from './ui/juice.js';
import { Intro } from './render/intro.js';
import { RESCUE } from './render/survivors.js';
import { fitFov } from './render/fov.js';

const $ = (id) => document.getElementById(id);
const canvas = $('scene');
const renderer = new GameRenderer(canvas);
const input = new Input(canvas);
const sound = new Sound();
const hud = new Hud();
const juice = new Juice();
const intro = new Intro(renderer.renderer, sound);
const player = new LocalPlayer();
const demo = World.demo();
const raycaster = new THREE.Raycaster();

// Phones and tablets get on-screen controls (add ?touch=1 to force them on a desktop).
const forceTouch = new URLSearchParams(location.search).get('touch') === '1';
const isTouch = forceTouch || ((navigator.maxTouchPoints > 0 || 'ontouchstart' in window) && matchMedia('(hover: none), (pointer: coarse)').matches);
if (isTouch) {
  document.body.classList.add('touch');
  input.touchMode = true;
}
/** Short phone vibrations for hits, damage and kills (Android; ignored elsewhere). */
function buzz(ms) {
  if (!isTouch || !navigator.vibrate) return;
  try {
    navigator.vibrate(ms);
  } catch {
    // vibration blocked
  }
}

const touchPrefs = (() => {
  try {
    return { lookSpeed: 1.7, autoFire: true, ...JSON.parse(localStorage.getItem('ares:touch') || '{}') };
  } catch {
    return { lookSpeed: 1.7, autoFire: true };
  }
})();
function saveTouchPrefs() {
  try {
    localStorage.setItem('ares:touch', JSON.stringify(touchPrefs));
  } catch {
    // storage unavailable
  }
}

const TAKE_CONTROL = isTouch ? 'Left thumb moves, right thumb looks. Tap ? for the field manual.' : 'Click the screen to take control. Press H for the field manual.';

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
let radarTimer = 0;
let jetSoundTimer = 0;
let storyOpen = false;
let ending = null;
let storySeen = false;
let wasDead = false;
let lastHp = TUNING.playerHp;
let hurtSoundAt = 0;
let playersTimer = 0;
let touch = null;
const pendingCells = new Map();

// ---------------------------------------------------------------- profile

function loadProfile() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem('ares:profile') || '{}');
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
    localStorage.setItem('ares:profile', JSON.stringify(profile));
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
  $('splash').classList.toggle('hidden', name !== 'splash');
  $('menu').classList.toggle('hidden', name !== 'menu');
  $('lobby').classList.toggle('hidden', name !== 'lobby');
  $('hud').classList.toggle('hidden', name !== 'game');
  input.enabled = name === 'game';
  if (name !== 'game') {
    touch?.reset();
    input.unlock();
    renderer.setGhost(null);
  }
}

// ---------------------------------------------------------------- session lifecycle

/** On phones, go fullscreen and landscape when a mission starts (needs the tap's user gesture). */
function goFullscreen() {
  if (!isTouch || document.fullscreenElement) return;
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!req) return;
  try {
    const p = req.call(el, { navigationUI: 'hide' });
    const lock = () => window.screen.orientation?.lock?.('landscape').catch(() => {});
    if (p?.then) p.then(lock).catch(() => {});
    else lock();
  } catch {
    // fullscreen not allowed here; play in the page instead
  }
}

async function startSession({ solo = false, creating = false, code = '' }) {
  goFullscreen();
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
  endEnding();
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
    renderPlayerList($('hud-players'), members, s.hostId, meId, s.world);
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
    endEnding();
    enterGame();
  } else if (phase === 'won' || phase === 'lost') {
    if (screen !== 'game') enterGame();
    startEnding(phase);
  }
}

// iPhone browsers cannot go fullscreen from a web page; a home-screen shortcut can.
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let iosTipShown = false;
function iosFullscreenTip() {
  if (!isIOS || navigator.standalone || iosTipShown) return;
  iosTipShown = true;
  setTimeout(() => toast('📱 Fullscreen on iPhone: open in Safari → Share → Add to Home Screen, then play from the icon.', 'warn', 7000), 6000);
}

function enterGame() {
  iosFullscreenTip();
  showScreen('game');
  player.spawn(session.world);
  wasDead = false;
  lastHp = TUNING.playerHp;
  $('downed').classList.add('hidden');
  $('hud-room').textContent = session.solo ? 'Solo' : session.room;
  if (!storySeen) showStory();
  else toast(TAKE_CONTROL, '', 5000);
}

// ---------------------------------------------------------------- story

/** The mission briefing shown when a pilot first lands: one line of story and three cards. */
function showStory() {
  storySeen = true;
  storyOpen = true;
  input.unlock();
  const [when, text] = STORY[STORY.length - 1];
  $('story-lines').innerHTML = `<li class="mission"><b>${when}</b><span>${text}</span></li>`;
  $('briefing').classList.remove('hidden');
  $('story-go').textContent = 'Defend the colony';
  $('story').classList.remove('hidden');
  sound.play('type');
}

function closeStory() {
  if (!storyOpen) return;
  storyOpen = false;
  $('story').classList.add('hidden');
  sound.play('ui');
  toast(TAKE_CONTROL, '', 5000);
}

// ---------------------------------------------------------------- intro & endings

function startIntro() {
  sound.unlock();
  showScreen('intro');
  intro.start(() => {
    showScreen('menu');
    sound.play('ui');
  });
}

const ENDING_LINES = {
  won: [
    [0, 'ARK-7 · Evacuation', 'The beacon is charged. An evacuation ship is breaking through the dust.'],
    [RESCUE.rampOpen, 'All survivors', 'Everyone aboard, now! Scientists first. Pilots cover the ramp!'],
    [RESCUE.rampClose, 'ARK-7 is away', '214 survivors saved. Humanity lives on.'],
  ],
  lost: [
    [0, 'Reactor critical', 'The Xal broke through. The reactor is going up.'],
    [2.5, 'Ares Colony', 'Transmission lost. The last colony has fallen.'],
  ],
};

function startEnding(phase) {
  ending = { phase, shown: false, line: -1, cues: new Set() };
  selected = null;
  hud.setSelected(null);
  input.unlock();
  $('hud').classList.add('cinematic');
  $('downed').classList.add('hidden');
  $('ending').classList.remove('hidden');
}

function endEnding() {
  ending = null;
  $('hud').classList.remove('cinematic');
  $('ending').classList.add('hidden');
}

function finishEnding() {
  if (!ending || ending.shown) return;
  ending.shown = true;
  $('ending').classList.add('hidden');
  showVictory(ending.phase === 'lost');
}

/** Runs the rescue (or defeat) cinematic: camera, captions and sounds, then the results. */
function updateEnding(world) {
  const t = world.simTime - world.endedAt;
  renderer.endingCamera(world);
  const lines = ENDING_LINES[ending.phase];
  let idx = 0;
  for (let i = 0; i < lines.length; i++) if (t >= lines[i][0]) idx = i;
  if (idx !== ending.line) {
    ending.line = idx;
    $('ending-year').textContent = lines[idx][1];
    $('ending-text').textContent = lines[idx][2];
  }
  const cue = (name, at, fn) => {
    if (t >= at && !ending.cues.has(name)) {
      ending.cues.add(name);
      fn();
    }
  };
  if (ending.phase === 'won') {
    cue('arrive', 0.2, () => sound.play('engine'));
    cue('land', RESCUE.descend - 1, () => sound.play('engine', 0.7));
    cue('leave', RESCUE.rampClose, () => sound.play('engine'));
    cue('cheer', RESCUE.rampClose + 3, () => sound.play('win'));
  } else {
    cue('boom', 0, () => sound.play('explosion'));
  }
  const length = ending.phase === 'won' ? RESCUE.gone + 1 : 6;
  if (t > length) finishEnding();
}

// ---------------------------------------------------------------- gameplay

function proximity(dir) {
  return Math.max(0.15, 1 - (dist(dir, player.dir.toArray()) * R) / 55);
}

function surfacePoint(dir, lift) {
  return new THREE.Vector3(...dir).multiplyScalar(session.world.terrain.surfaceRadius(dir) + lift);
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
      case 'cell':
        renderer.sparkle(ev.dir, 0x5fc8ff, 0);
        if (ev.pid === meId) {
          sound.play('collect');
          juice.float(surfacePoint(ev.dir, 2.5), `+${TUNING.cellValue}⚡`, '#8fd8ff');
        }
        break;
      case 'podshot': {
        renderer.podDestroyed(ev.pos);
        const p = new THREE.Vector3(...ev.pos);
        sound.play('hit', proximity(p.clone().normalize().toArray()));
        juice.float(p, `+${TUNING.podBounty}⚡`, '#7dff5a');
        if (ev.pid === meId) onMyKill('Pod destroyed');
        else toast(`☄ ${ev.by} shot down a drop pod`);
        break;
      }
      case 'podland':
        renderer.podLanded(ev.dir);
        sound.play('boom', proximity(ev.dir));
        toast('☄ A drop pod landed. More Xal incoming!', 'bad');
        break;
      case 'kill': {
        renderer.alienDeath(ev.pos, ev.kind);
        const p = new THREE.Vector3(...ev.pos);
        sound.play('squish', proximity(p.clone().normalize().toArray()));
        if (ev.bounty) juice.float(p, `+${ev.bounty}⚡`, '#7dff5a');
        if (ev.pid === meId) onMyKill(ev.kind === 1 ? 'Brute down' : null);
        break;
      }
      case 'hurt':
        renderer.flashEnemy(ev.id);
        if (ev.pid === meId) {
          juice.hitmarker();
          buzz(8);
          sound.play('squish', 0.4);
        }
        break;
      case 'spit':
        renderer.acid(ev.from, ev.to);
        sound.play('spit', proximity(ev.from));
        break;
      case 'destroyed':
        renderer.sparkle(ev.dir, 0xff7a4a);
        sound.play('boom', proximity(ev.dir) * 0.6);
        toast(`💥 The Xal destroyed a ${STRUCTURES[ev.type].name}!`, 'bad');
        break;
      case 'wave': {
        const line = RADIO[(ev.n - 1) % RADIO.length];
        juice.banner(`Wave ${ev.n}`, '#ff5a6a', `${ev.count} hostiles incoming`, 3000);
        toast(`📻 CMDR. REYES: ${line}`, 'warn', 7000);
        sound.play('swarm');
        sound.play('alarm');
        break;
      }
      case 'waveclear':
        juice.banner(`Wave ${ev.n} cleared`, '#7cf7d4', `+${ev.bonus}⚡ · Beacon ${Math.round((ev.n / TUNING.waves) * 100)}% charged`);
        sound.play('bounty');
        break;
      case 'down':
        if (ev.id !== meId) toast(`☠ ${session.memberName(ev.id)} is down!`, 'bad');
        break;
      case 'respawn':
        if (ev.id !== meId) toast(`${session.memberName(ev.id)} is back in the fight.`);
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
        else toast(`Salvaged ${STRUCTURES[ev.type].name} (+${ev.refund}⚡)`);
        break;
      case 'won':
        sound.play('win');
        break;
      case 'lost':
        sound.play('lose');
        break;
      case 'restart':
        toast('🔄 A new colony defence begins.', 'warn');
        break;
      default:
    }
  }
}

function onMyKill(label) {
  const streak = juice.kill();
  buzz(streak >= 2 ? 45 : 20);
  juice.hitmarker();
  if (streak >= 2) sound.play('streak', streak);
  const names = { 2: 'Double kill', 3: 'Triple kill', 4: 'Quad kill' };
  if (streak >= 2) juice.banner(names[streak] || `${streak}× Rampage`, '#ffd166', '', 1300);
  else if (label) juice.banner(label, '#ffb14a', '', 1200);
}

/** Aim assist: the alien or drop pod closest to the crosshair, within a small cone. */
function findTarget(world) {
  const cam = renderer.camera.position;
  let best = null;
  // Thumbs are less precise than a mouse, so aim assist is stronger on touch screens.
  const assist = isTouch ? 1.6 : 1;
  let bestAngle = 0.2 * assist;
  const consider = (id, p, cone) => {
    const v = p.clone().sub(cam);
    if (v.length() > 150) return;
    const angle = v.angleTo(player.aim);
    if (angle < Math.min(bestAngle, cone * assist)) {
      bestAngle = angle;
      best = { id, p };
    }
  };
  for (const pod of world.pods.values()) {
    if (world.simTime < pod.t0) continue;
    consider(pod.id, new THREE.Vector3(...podPos(pod, world.simTime, world.terrain)), 0.2);
  }
  for (const e of world.enemies.values()) {
    const entry = renderer.enemies.get(e.id);
    if (!entry) continue;
    const lift = e.kind === 1 ? 1.9 : e.kind === 2 ? 1.8 : 0.8;
    consider(e.id, entry.obj.position.clone().addScaledVector(entry.up, lift), 0.17);
  }
  return best;
}

const aimV = new THREE.Vector3();
const aimT = new THREE.Vector3();
const aimR = new THREE.Vector3();
function stickyAim(point, dt) {
  const up = player.dir;
  aimV.copy(point).sub(renderer.camera.position);
  const vertical = aimV.dot(up);
  aimT.copy(aimV).addScaledVector(up, -vertical);
  const flat = aimT.length();
  if (flat < 1e-3) return;
  aimR.crossVectors(player.fwd, up).normalize();
  const yaw = Math.atan2(aimT.dot(aimR), aimT.dot(player.fwd));
  const k = 1 - Math.exp(-3.5 * dt);
  player.fwd.applyAxisAngle(up, -yaw * k);
  const pitch = -Math.atan2(vertical, flat);
  player.pitch += (Math.max(-0.95, Math.min(1.25, pitch)) - player.pitch) * k;
}

function gunPosition() {
  const right = new THREE.Vector3().crossVectors(player.fwd, player.dir).normalize();
  return player.position().addScaledVector(player.dir, 1.05).addScaledVector(right, 0.5);
}

function isDead() {
  return !!session?.world.players.get(meId)?.dead;
}

function fire() {
  if (fireCooldown > 0 || !session || isDead()) return;
  fireCooldown = 0.2;
  const world = session.world;
  const target = findTarget(world);
  const from = gunPosition();
  const to = target ? target.p : renderer.camera.position.clone().addScaledVector(player.aim, 70);
  renderer.fx.beam(from, to, profile.color);
  renderer.fx.emit(from, player.aim.clone().multiplyScalar(6), profile.color, 4, 0.2, 2);
  sound.play('shoot');
  const r = (v) => Math.round(v * 100) / 100;
  session.sendShot({ o: from.toArray().map(r), e: to.toArray().map(r), c: profile.color });
  if (target) session.act({ k: 'hit', id: target.id });
}

function tryBuild() {
  const world = session.world;
  const dir = player.buildDir();
  const def = STRUCTURES[selected];
  const err = world.placementError(selected, dir) || (world.energy < def.cost ? `Need ⚡${def.cost}. Grab power cells!` : null);
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
  window.addEventListener('keydown', (e) => {
    if (intro.active && ['Escape', 'Space', 'Enter'].includes(e.code)) intro.skip();
    else if (screen === 'splash' && ['Space', 'Enter'].includes(e.code)) startIntro();
  });
  $('splash-go').addEventListener('click', startIntro);
  $('intro-skip').addEventListener('click', () => intro.skip());
  $('intro-btn').addEventListener('click', startIntro);
  const qualityBtn = $('quality-btn');
  const QUALITY_NAMES = { high: 'High', medium: 'Medium', low: 'Low' };
  const applyQuality = (q) => {
    renderer.setQuality(q);
    intro.setQuality(renderer.quality);
    qualityBtn.textContent = `Graphics: ${QUALITY_NAMES[renderer.quality]}`;
    try {
      localStorage.setItem('ares:quality2', renderer.quality);
    } catch {
      // storage unavailable
    }
  };
  // Phones and small laptops start on Medium (Low on very weak ones); the choice is remembered.
  const cores = navigator.hardwareConcurrency || 8;
  const memory = navigator.deviceMemory || 8;
  const weak = isTouch || cores <= 4 || memory <= 4;
  let savedQuality = cores <= 2 || memory <= 2 ? 'low' : weak ? 'medium' : 'high';
  try {
    // v2 key: earlier builds saved Low for every phone.
    savedQuality = localStorage.getItem('ares:quality2') || savedQuality;
  } catch {
    // storage unavailable
  }
  applyQuality(savedQuality);
  const NEXT = { high: 'medium', medium: 'low', low: 'high' };
  qualityBtn.addEventListener('click', () => applyQuality(NEXT[renderer.quality]));
  $('ending-skip').addEventListener('click', finishEnding);
  input.onKey = (code) => {
    if (ending) {
      if (code === 'Escape' || code === 'Space') finishEnding();
      return;
    }
    if (storyOpen) {
      if (code === 'Space' || code === 'Enter' || code === 'Escape') closeStory();
      return;
    }
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
    if (storyOpen || helpOpen || !session || session.world.phase !== 'play') return;
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
  $('help-leave').addEventListener('click', () => {
    toggleHelp();
    leaveSession();
  });
  if (isTouch) {
    touch = new TouchControls($('hud'), input, {
      onAction: () => {
        if (storyOpen || helpOpen || !session || session.world.phase !== 'play') return;
        if (selected) tryBuild();
        else fire();
      },
      onPing: () => ping(),
      onCancel: () => select(null),
      onSalvage: () => {
        const st = session && nearestStructure(session.world);
        if (st) session.act({ k: 'salvage', id: st.id });
      },
      onHelp: () => toggleHelp(),
      onMute: () => sound.toggleMute(),
      onAutoFire: (on) => {
        touchPrefs.autoFire = on;
        saveTouchPrefs();
        toast(on ? '🎯 Auto-fire on: aim at an alien and your rifle fires by itself' : '🎯 Auto-fire off: hold Fire to shoot', '', 2600);
      },
      lookSpeed: touchPrefs.lookSpeed,
      autoFire: touchPrefs.autoFire,
    });
    player.camBase = 7;
    const sens = $('look-speed');
    sens.value = String(touchPrefs.lookSpeed);
    sens.addEventListener('input', () => {
      touchPrefs.lookSpeed = Number(sens.value);
      touch.lookSpeed = touchPrefs.lookSpeed;
      saveTouchPrefs();
    });
  }
  $('story-go').addEventListener('click', closeStory);
  $('again-btn').addEventListener('click', () => session?.act({ k: 'restart' }));
  $('menu-btn').addEventListener('click', leaveSession);
}

function toggleHelp() {
  helpOpen = !helpOpen;
  $('help').classList.toggle('hidden', !helpOpen);
  if (helpOpen) input.unlock();
}

function showVictory(lost = false) {
  const w = session.world;
  const time = w.endedAt - w.playStart;
  const c = w.counters;
  if (lost) {
    $('victory-eyebrow').textContent = 'Transmission lost';
    $('victory-title').textContent = `The reactor fell on wave ${w.wave}. Ares is gone.`;
    $('medal').textContent = '💀';
    $('again-btn').textContent = 'Try again';
  } else {
    $('victory-eyebrow').textContent = 'Evacuation complete';
    $('victory-title').textContent = 'ARK-7 is away. 214 survivors saved.';
    const reactor = w.reactor.hp / w.reactor.max;
    $('medal').textContent = reactor > 0.7 ? '🥇' : reactor > 0.35 ? '🥈' : '🥉';
    $('again-btn').textContent = 'Defend again';
  }
  $('victory-stats').innerHTML = [
    [formatTime(time), 'Time'],
    [`${w.wave}/${TUNING.waves}`, 'Waves'],
    [c.kills + c.pods, 'Xal destroyed'],
    [c.built, 'Defences built'],
  ]
    .map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`)
    .join('');
  updateVictoryButtons();
  $('victory').classList.remove('hidden');
  $('downed').classList.add('hidden');
  input.unlock();
}

function updateVictoryButtons() {
  if (!session) return;
  $('again-btn').disabled = !session.isHost;
  $('victory-wait').textContent = session.isHost ? '' : 'Waiting for the host to restart…';
}

/** Tracks the local pilot's health: hurt feedback, the downed screen and respawning. */
function updateVitals(world) {
  const me = world.players.get(meId);
  if (!me) return;
  if (me.hp < lastHp - 0.5 && !me.dead) {
    juice.hurt();
    buzz(25);
    const now = performance.now();
    if (now - hurtSoundAt > 350) {
      hurtSoundAt = now;
      sound.play('hurt');
    }
  }
  lastHp = me.hp;
  if (me.dead && !wasDead) {
    wasDead = true;
    selected = null;
    hud.setSelected(null);
    sound.play('down');
    buzz([80, 60, 160]);
    $('downed').classList.remove('hidden');
  }
  if (me.dead) {
    $('downed-timer').textContent = `Respawning at the reactor in ${Math.max(0, Math.ceil(me.respawnAt - world.simTime))}…`;
  } else if (wasDead) {
    wasDead = false;
    $('downed').classList.add('hidden');
    player.spawn(world);
    toast('Back in the fight. Protect the reactor!');
  }
}

function updateGameplay(dt, world) {
  fireCooldown -= dt;
  const prompt = $('prompt');
  if (world.phase !== 'play') {
    renderer.setGhost(null);
    prompt.textContent = '';
    touch?.update({ building: false, salvage: null, dead: false });
    return;
  }
  updateVitals(world);
  const dead = isDead();

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

  // Walk into power cells to collect them.
  const here = player.dir.toArray();
  const now = performance.now();
  for (const [id, at] of pendingCells) if (now - at > 2500) pendingCells.delete(id);
  if (!dead && player.heightAboveTerrain() < 3) {
    for (const cell of world.cells.values()) {
      if (pendingCells.has(cell.id)) continue;
      if (dist(cell.dir, here) * R < 2.1) {
        pendingCells.set(cell.id, now);
        session.act({ k: 'collect', id: cell.id });
      }
    }
  }

  let text = '';
  let salvageLabel = null;
  if (selected && !dead) {
    const dir = player.buildDir();
    const def = STRUCTURES[selected];
    const err = world.placementError(selected, dir) || (world.energy < def.cost ? `Need ⚡${def.cost}` : null);
    renderer.setGhost(selected, dir, !err, world);
    text = err ? `✕ ${err}` : isTouch ? `Tap Build for ${def.name} (⚡${def.cost})` : `Click to build ${def.name} (⚡${def.cost}) · Right-click to cancel`;
  } else {
    renderer.setGhost(null);
    const st = dead ? null : nearestStructure(world);
    if (st && !isTouch) text = `[X] Salvage ${STRUCTURES[st.type].name} (+${Math.floor(STRUCTURES[st.type].cost / 2)}⚡)`;
    salvageLabel = st ? `Salvage +${Math.floor(STRUCTURES[st.type].cost / 2)}⚡` : null;
  }
  if (!dead && !input.active && !helpOpen && !storyOpen) text = 'Click to take control';
  else if (!dead && input.dragMode && !text) text = 'Right-drag to look · Left-click to act';
  prompt.textContent = dead ? '' : text;
  const target = !selected && !dead ? findTarget(world) : null;
  $('crosshair').classList.toggle('lock', !!target);
  if (touch) {
    touch.update({ building: selected && !dead, salvage: salvageLabel, dead });
    const free = !selected && !dead && !helpOpen && !storyOpen;
    // Holding Fire keeps shooting; with auto-fire on, the rifle fires whenever it is on a target.
    if (free && (touch.firing || (touch.autoFire && target))) fire();
    // Sticky aim: the view drifts gently onto the locked target so thumbs don't have to be precise.
    if (free && target) stickyAim(target.p, dt);
  }

  const fuel = $('fuel');
  fuel.firstElementChild.style.height = `${player.fuel * 100}%`;
  fuel.classList.toggle('full', player.fuel >= 1);
  jetSoundTimer -= dt;
  if (player.jetting && jetSoundTimer <= 0) {
    jetSoundTimer = 0.1;
    sound.play('jet');
  }
}

// ---------------------------------------------------------------- main loop

const orbitTarget = new THREE.Vector3();
const menuUp = new THREE.Vector3();
const menuHelper = new THREE.Vector3();
const menuE1 = new THREE.Vector3();
const menuE2 = new THREE.Vector3();

/** A wider lens on narrow screens so phones held upright still see enough of the battlefield. */
function baseFov() {
  return fitFov(62, window.innerWidth / window.innerHeight, 92);
}
let last = performance.now();

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (intro.active) {
    renderer.adaptResolution(dt);
    intro.update(dt);
    requestAnimationFrame(frame);
    return;
  }

  let world = demo;
  if (session) {
    const dead = isDead();
    session.localDir = screen === 'game' && !dead ? player.dir.toArray() : null;
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
    const dead = isDead();
    const canMove = !helpOpen && !storyOpen && !dead && world.phase === 'play' && !ending;
    player.update(dt, input, world, canMove);
    if (ending) updateEnding(world);
    else player.updateCamera(renderer.camera, world, dt);
    updateGameplay(dt, world);
    const cam = renderer.camera;
    const fov = baseFov() + (player.sprinting ? 7 : 0) + (player.jetting ? 5 : 0);
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov += (fov - cam.fov) * Math.min(1, dt * 6);
      cam.updateProjectionMatrix();
    }
    juice.update(dt, cam);
    radarTimer -= dt;
    if (radarTimer <= 0) {
      radarTimer = isTouch ? 0.1 : 0.05;
      hud.drawRadar(world, player);
      hud.drawCompass(world, player);
    }
    focus = player.dir;
    headlampPos = player.position().addScaledVector(player.dir, 5).addScaledVector(player.fwd, 2);
    players.push({ id: meId, name: profile.name, color: profile.color, pose: player.pose(), isLocal: true, dead });
    for (const m of session.members) {
      if (m.id !== meId) {
        players.push({ id: m.id, name: m.name, color: m.color, pose: session.remotes.get(m.id), dead: !!world.players.get(m.id)?.dead });
      }
    }
    hudTimer -= dt;
    if (hudTimer <= 0) {
      hudTimer = 0.1;
      hud.update(world, meId);
    }
    playersTimer -= dt;
    if (playersTimer <= 0) {
      playersTimer = 0.5;
      renderPlayerList($('hud-players'), session.members, session.hostId, meId, world);
    }
    moodTimer -= dt;
    if (moodTimer <= 0) {
      moodTimer = 1;
      sound.setMood(world.waveActive ? 20 : 70);
    }
  } else {
    // Menus: a slow cinematic drone shot circling the colony.
    orbitAngle += dt * 0.035;
    const cam = renderer.camera;
    const up = menuUp.set(...world.baseDir);
    const helper = Math.abs(up.y) < 0.9 ? menuHelper.set(0, 1, 0) : menuHelper.set(1, 0, 0);
    const e1 = menuE1.crossVectors(up, helper).normalize();
    const e2 = menuE2.crossVectors(up, e1);
    const ground = world.terrain.surfaceRadius(world.baseDir);
    const dist = screen === 'lobby' ? 34 : 42;
    const height = screen === 'lobby' ? 11 : 15;
    cam.position.copy(up).multiplyScalar(ground + height).addScaledVector(e1, Math.cos(orbitAngle) * dist).addScaledVector(e2, Math.sin(orbitAngle) * dist);
    cam.up.copy(up);
    const fov = baseFov();
    if (cam.fov !== fov) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    // On wide screens the colony sits beside the menu card rather than behind it.
    orbitTarget.copy(up).multiplyScalar(ground + 3);
    if (window.innerWidth > 900) {
      const right = menuE1.subVectors(orbitTarget, cam.position).cross(up).normalize();
      orbitTarget.addScaledVector(right, screen === 'lobby' ? 14 : 9);
    }
    cam.lookAt(orbitTarget);
    focus = up;
  }

  renderer.update(dt, { world, players, focus, headlampPos });
  renderer.render(dt);
  requestAnimationFrame(frame);
}

setupMenu();
setupLobby();
setupControls();
showScreen('splash');
requestAnimationFrame((t) => {
  last = t;
  frame(t);
  $('loading').classList.add('done');
});
window.addEventListener('beforeunload', () => session?.leave());

// Debug handle for local testing only (stripped from production builds).
if (import.meta.env.DEV) {
  window.__seedfall = {
    get session() {
      return session;
    },
    player,
    renderer,
    intro,
  };
}
