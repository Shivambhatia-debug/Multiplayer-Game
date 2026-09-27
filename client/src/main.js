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
import { Sound } from './audio.js';
import { Hud, toast, renderPlayerList, formatTime } from './ui/hud.js';
import { Juice } from './ui/juice.js';

const $ = (id) => document.getElementById(id);
const canvas = $('scene');
const renderer = new GameRenderer(canvas);
const input = new Input(canvas);
const sound = new Sound();
const hud = new Hud();
const juice = new Juice();
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
let radarTimer = 0;
let jetSoundTimer = 0;
let storyOpen = false;
let storySeen = false;
let wasDead = false;
let lastHp = TUNING.playerHp;
let hurtSoundAt = 0;
let playersTimer = 0;
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
    enterGame();
  } else if (phase === 'won' || phase === 'lost') {
    if (screen !== 'game') enterGame();
    showVictory(phase === 'lost');
  }
}

function enterGame() {
  showScreen('game');
  player.spawn(session.world);
  wasDead = false;
  lastHp = TUNING.playerHp;
  $('downed').classList.add('hidden');
  $('hud-room').textContent = session.solo ? 'Solo' : session.room;
  if (!storySeen) showStory();
  else toast('Click the screen to take control. Press H for the field manual.', '', 5000);
}

// ---------------------------------------------------------------- story

/** The opening transmission: the story types in line by line, then the three-card briefing. */
function showStory() {
  storySeen = true;
  storyOpen = true;
  input.unlock();
  const list = $('story-lines');
  list.innerHTML = '';
  $('briefing').classList.add('hidden');
  $('story-go').textContent = 'Skip';
  $('story').classList.remove('hidden');
  let i = 0;
  const next = () => {
    if (!storyOpen) return;
    if (i < STORY.length) {
      const [when, text] = STORY[i];
      const li = document.createElement('li');
      if (i === STORY.length - 1) li.className = 'mission';
      li.innerHTML = '<b></b><span></span>';
      li.firstChild.textContent = when;
      li.lastChild.textContent = text;
      list.appendChild(li);
      sound.play('type');
      i++;
      storyTimer = setTimeout(next, 1700);
    } else {
      $('briefing').classList.remove('hidden');
      $('story-go').textContent = 'Defend the colony';
    }
  };
  next();
}

let storyTimer = null;
function closeStory() {
  if (!storyOpen) return;
  // First press finishes the text; the second one starts the game.
  if ($('briefing').classList.contains('hidden')) {
    clearTimeout(storyTimer);
    const list = $('story-lines');
    list.innerHTML = STORY.map(
      ([w, t], i) => `<li class="${i === STORY.length - 1 ? 'mission' : ''}"><b>${w}</b><span>${t}</span></li>`,
    ).join('');
    $('briefing').classList.remove('hidden');
    $('story-go').textContent = 'Defend the colony';
    return;
  }
  storyOpen = false;
  $('story').classList.add('hidden');
  sound.play('ui');
  toast('Click the screen to take control. Press H for the field manual.', '', 5000);
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
  let bestAngle = 0.2;
  const consider = (id, p, cone) => {
    const v = p.clone().sub(cam);
    if (v.length() > 150) return;
    const angle = v.angleTo(player.aim);
    if (angle < Math.min(bestAngle, cone)) {
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
  input.onKey = (code) => {
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
    $('victory-eyebrow').textContent = 'Evacuation beacon charged';
    $('victory-title').textContent = 'The ark ships are coming. Humanity survives.';
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
  if (selected && !dead) {
    const dir = player.buildDir();
    const def = STRUCTURES[selected];
    const err = world.placementError(selected, dir) || (world.energy < def.cost ? `Need ⚡${def.cost}` : null);
    renderer.setGhost(selected, dir, !err, world);
    text = err ? `✕ ${err}` : `Click to build ${def.name} (⚡${def.cost}) · Right-click to cancel`;
  } else {
    renderer.setGhost(null);
    const st = dead ? null : nearestStructure(world);
    if (st) text = `[X] Salvage ${STRUCTURES[st.type].name} (+${Math.floor(STRUCTURES[st.type].cost / 2)}⚡)`;
  }
  if (!dead && !input.active && !helpOpen && !storyOpen) text = 'Click to take control';
  else if (!dead && input.dragMode && !text) text = 'Right-drag to look · Left-click to act';
  prompt.textContent = dead ? '' : text;
  $('crosshair').classList.toggle('lock', !selected && !dead && !!findTarget(world));

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
let last = performance.now();

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

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
    const canMove = !helpOpen && !storyOpen && !dead && world.phase === 'play';
    player.update(dt, input, world, canMove);
    player.updateCamera(renderer.camera, world);
    updateGameplay(dt, world);
    const cam = renderer.camera;
    const fov = 62 + (player.sprinting ? 7 : 0) + (player.jetting ? 5 : 0);
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov += (fov - cam.fov) * Math.min(1, dt * 6);
      cam.updateProjectionMatrix();
    }
    juice.update(dt, cam);
    radarTimer -= dt;
    if (radarTimer <= 0) {
      radarTimer = 0.05;
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
    orbitAngle += dt * 0.05;
    const d = R * (screen === 'lobby' ? 2.7 : 3.05);
    const cam = renderer.camera;
    // Orbit around the colony side of the planet.
    const base = new THREE.Vector3(...world.baseDir);
    const side = new THREE.Vector3(1, 0, 0).cross(base).normalize();
    const around = side.clone().applyAxisAngle(base, orbitAngle);
    cam.position.copy(base).multiplyScalar(d * 0.75).addScaledVector(around, d * 0.65);
    cam.up.copy(base);
    if (cam.fov !== 62) {
      cam.fov = 62;
      cam.updateProjectionMatrix();
    }
    const shift = window.innerWidth > 900 ? R * (screen === 'lobby' ? 0.85 : 0.3) : 0;
    const right = new THREE.Vector3().subVectors(orbitTarget.set(0, 0, 0), cam.position).cross(cam.up).normalize();
    orbitTarget.set(0, 0, 0).addScaledVector(right, shift);
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
  window.__seedfall = {
    get session() {
      return session;
    },
    player,
    renderer,
  };
}
