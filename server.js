const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_req, res) => res.json({ ok: true }));

const rooms = new Map();
const WORLD = 100;
const ROUND_SECONDS = 180;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const roomCode = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  } while (rooms.has(code));
  return code;
};

function makeRoom(code) {
  return {
    code,
    phase: "lobby",
    players: {},
    endsAt: 0,
    score: 0,
    message: "Waiting for both researchers.",
    ship: { x: 12, y: 76, heading: -35, speed: 0, fuel: 100, hull: 100 },
    target: { x: 78, y: 24, angle: Math.random() * Math.PI * 2 },
    frequency: 52,
    hydrophones: [],
    scans: [],
    guidance: null,
    signalLock: 0,
    storm: { x: 48, y: 50, radius: 14 },
    nextStormShift: Date.now() + 12000,
    lastTick: Date.now(),
  };
}

function publicPlayers(room) {
  return Object.fromEntries(
    Object.entries(room.players).map(([role, player]) => [role, { name: player.name, connected: player.connected }])
  );
}

function stateFor(room, role) {
  const now = Date.now();
  const remaining = room.phase === "playing" ? Math.max(0, Math.ceil((room.endsAt - now) / 1000)) : 0;
  const base = {
    code: room.code,
    phase: room.phase,
    role,
    players: publicPlayers(room),
    remaining,
    score: Math.round(room.score),
    message: room.message,
    ship: room.ship,
    hydrophones: room.hydrophones,
    guidance: room.guidance,
    storm: room.storm,
    signalLock: Math.round(room.signalLock),
  };

  if (role === "analyst") {
    base.scans = room.scans.slice(-8);
    base.spectrum = [
      { frequency: 24, strength: 20 + Math.random() * 12, label: "shipping noise" },
      { frequency: 38, strength: 24 + Math.random() * 20, label: "fin whale" },
      { frequency: 52, strength: clamp(98 - distance(room.ship, room.target) * 0.7, 12, 94), label: "unclassified" },
      { frequency: 67, strength: 15 + Math.random() * 18, label: "ice resonance" },
    ];
  }

  if (room.phase === "won" || room.phase === "lost") {
    base.target = room.target;
  }
  return base;
}

function emitRoom(room) {
  for (const [role, player] of Object.entries(room.players)) {
    if (player.connected) io.to(player.id).emit("state", stateFor(room, role));
  }
}

function resetRound(room) {
  room.phase = "playing";
  room.endsAt = Date.now() + ROUND_SECONDS * 1000;
  room.score = 1000;
  room.message = "A 52 Hz call has returned. Find its source before the storm closes in.";
  room.ship = { x: 12, y: 76, heading: -35, speed: 0, fuel: 100, hull: 100 };
  room.target = { x: 64 + Math.random() * 24, y: 12 + Math.random() * 28, angle: Math.random() * Math.PI * 2 };
  room.hydrophones = [];
  room.scans = [];
  room.guidance = null;
  room.signalLock = 0;
  room.storm = { x: 35 + Math.random() * 30, y: 35 + Math.random() * 30, radius: 12 + Math.random() * 5 };
  room.lastTick = Date.now();
}

io.on("connection", (socket) => {
  socket.on("createRoom", ({ name }, reply) => {
    const code = roomCode();
    const room = makeRoom(code);
    room.players.captain = { id: socket.id, name: cleanName(name), connected: true };
    rooms.set(code, room);
    socket.data = { code, role: "captain" };
    socket.join(code);
    reply?.({ ok: true, code, role: "captain" });
    emitRoom(room);
  });

  socket.on("joinRoom", ({ code, name }, reply) => {
    code = String(code || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return reply?.({ ok: false, error: "Expedition code not found." });
    const openRole = !room.players.captain ? "captain" : !room.players.analyst ? "analyst" : null;
    if (!openRole) return reply?.({ ok: false, error: "This expedition already has two researchers." });
    room.players[openRole] = { id: socket.id, name: cleanName(name), connected: true };
    socket.data = { code, role: openRole };
    socket.join(code);
    reply?.({ ok: true, code, role: openRole });
    emitRoom(room);
  });

  socket.on("startGame", () => {
    const room = currentRoom(socket);
    if (!room || socket.data.role !== "captain") return;
    if (!room.players.captain?.connected || !room.players.analyst?.connected) {
      return socket.emit("notice", "Both researchers must be connected.");
    }
    resetRound(room);
    emitRoom(room);
  });

  socket.on("helm", ({ turn = 0, throttle = 0 }) => {
    const room = currentRoom(socket);
    if (!room || socket.data.role !== "captain" || room.phase !== "playing") return;
    room.ship.heading = (room.ship.heading + clamp(Number(turn), -1, 1) * 14 + 360) % 360;
    room.ship.speed = clamp(room.ship.speed + clamp(Number(throttle), -1, 1) * 0.7, 0, 3.5);
  });

  socket.on("deployHydrophone", () => {
    const room = currentRoom(socket);
    if (!room || socket.data.role !== "captain" || room.phase !== "playing") return;
    if (room.hydrophones.length >= 3) return socket.emit("notice", "All three hydrophones are already deployed.");
    room.hydrophones.push({ x: room.ship.x, y: room.ship.y, id: room.hydrophones.length + 1 });
    room.score -= 35;
    room.message = `Hydrophone ${room.hydrophones.length} deployed. Signal confidence improved.`;
    emitRoom(room);
  });

  socket.on("scan", ({ frequency }) => {
    const room = currentRoom(socket);
    if (!room || socket.data.role !== "analyst" || room.phase !== "playing") return;
    const hz = clamp(Number(frequency), 15, 80);
    const error = Math.abs(hz - room.frequency);
    const range = distance(room.ship, room.target);
    const bearing = (Math.atan2(room.target.x - room.ship.x, -(room.target.y - room.ship.y)) * 180) / Math.PI;
    const noisyBearing = (bearing + (Math.random() - 0.5) * (28 / (room.hydrophones.length + 1)) + 360) % 360;
    const quality = clamp(100 - error * 18 - range * 0.28 + room.hydrophones.length * 11, 2, 99);
    const names = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    const direction = names[Math.round(noisyBearing / 45) % 8];
    const scan = {
      frequency: Math.round(hz),
      quality: Math.round(quality),
      direction: error <= 3 ? direction : "unstable",
      distance: error <= 2 && room.hydrophones.length >= 2 ? Math.round(range) : null,
      time: Date.now(),
    };
    room.scans.push(scan);
    room.score -= 8;
    if (error <= 2) room.signalLock = clamp(room.signalLock + 18 + room.hydrophones.length * 4, 0, 100);
    else room.signalLock = clamp(room.signalLock - 7, 0, 100);
    room.message = error <= 2 ? `Signal acquired at ${Math.round(hz)} Hz — bearing ${direction}.` : "Frequency mismatch. Sweep closer to the unusual call.";
    emitRoom(room);
  });

  socket.on("guide", ({ direction }) => {
    const room = currentRoom(socket);
    if (!room || socket.data.role !== "analyst" || room.phase !== "playing") return;
    const allowed = ["N", "NE", "E", "SE", "S", "SW", "W", "NW", "HOLD"];
    if (!allowed.includes(direction)) return;
    room.guidance = { direction, at: Date.now() };
    room.message = `Acoustics recommends: ${direction}.`;
    emitRoom(room);
  });

  socket.on("tagSignal", () => {
    const room = currentRoom(socket);
    if (!room || socket.data.role !== "captain" || room.phase !== "playing") return;
    const range = distance(room.ship, room.target);
    if (range <= 9 && room.signalLock >= 55) {
      room.phase = "won";
      room.score += Math.max(0, Math.ceil((room.endsAt - Date.now()) / 1000) * 3);
      room.message = "Visual confirmed: a healthy blue–fin hybrid. Mystery documented without disturbing it.";
    } else {
      room.score -= 60;
      room.message = room.signalLock < 55 ? "Signal lock is too weak. The analyst must scan 52 Hz." : "Nothing in visual range. Move closer.";
    }
    emitRoom(room);
  });

  socket.on("disconnect", () => {
    const room = currentRoom(socket);
    if (!room) return;
    const player = room.players[socket.data.role];
    if (player?.id === socket.id) player.connected = false;
    room.message = "Connection interrupted. The expedition can continue when your partner rejoins.";
    emitRoom(room);
    if (!Object.values(room.players).some((p) => p.connected)) {
      setTimeout(() => {
        const stale = rooms.get(room.code);
        if (stale && !Object.values(stale.players).some((p) => p.connected)) rooms.delete(room.code);
      }, 10 * 60 * 1000);
    }
  });
});

function cleanName(name) {
  return String(name || "Researcher").trim().slice(0, 18) || "Researcher";
}

function currentRoom(socket) {
  return rooms.get(socket.data?.code);
}

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.phase !== "playing") continue;
    const dt = Math.min(1, (now - room.lastTick) / 1000);
    room.lastTick = now;

    const radians = (room.ship.heading * Math.PI) / 180;
    room.ship.x = clamp(room.ship.x + Math.sin(radians) * room.ship.speed * dt, 1, WORLD - 1);
    room.ship.y = clamp(room.ship.y - Math.cos(radians) * room.ship.speed * dt, 1, WORLD - 1);
    room.ship.fuel = clamp(room.ship.fuel - room.ship.speed * 0.022 * dt, 0, 100);

    room.target.angle += (Math.random() - 0.5) * 0.08;
    room.target.x = clamp(room.target.x + Math.cos(room.target.angle) * 0.12 * dt, 4, 96);
    room.target.y = clamp(room.target.y + Math.sin(room.target.angle) * 0.12 * dt, 4, 96);

    const inStorm = distance(room.ship, room.storm) < room.storm.radius;
    if (inStorm) {
      room.ship.hull = clamp(room.ship.hull - 0.6 * dt, 0, 100);
      room.score -= 0.25;
    }
    if (now >= room.nextStormShift) {
      room.storm.x = clamp(room.storm.x + (Math.random() - 0.5) * 12, 18, 82);
      room.storm.y = clamp(room.storm.y + (Math.random() - 0.5) * 12, 18, 82);
      room.nextStormShift = now + 12000;
    }
    room.signalLock = clamp(room.signalLock - 0.45 * dt, 0, 100);
    room.score = Math.max(0, room.score - 0.08 * dt);

    if (now >= room.endsAt || room.ship.fuel <= 0 || room.ship.hull <= 0) {
      room.phase = "lost";
      room.message = room.ship.hull <= 0 ? "The storm forced an emergency retreat." : "The signal faded into the Pacific. Review the evidence and try again.";
    }
    emitRoom(room);
  }
}, 500);

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`Signal 52 listening on http://localhost:${port}`));
