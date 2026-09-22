const socket = io();
const $ = (id) => document.getElementById(id);
let state = null;
let myRole = null;
let spectrumData = [];

const screens = ["landing", "lobby", "game", "result"];
const showScreen = (id) => screens.forEach((screen) => $(screen).classList.toggle("hidden", screen !== id));

function toast(text) {
  $("toast").textContent = text;
  $("toast").classList.add("show");
  setTimeout(() => $("toast").classList.remove("show"), 2200);
}

function nameValue() {
  return $("name").value.trim() || "Researcher";
}

$("create").onclick = () => {
  socket.emit("createRoom", { name: nameValue() }, handleEntry);
};

$("join").onclick = () => {
  socket.emit("joinRoom", { name: nameValue(), code: $("code").value }, handleEntry);
};

$("code").addEventListener("input", (event) => {
  event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
});

$("code").addEventListener("keydown", (event) => {
  if (event.key === "Enter") $("join").click();
});

function handleEntry(response) {
  if (!response?.ok) {
    $("landing-error").textContent = response?.error || "Unable to open expedition channel.";
    return;
  }
  myRole = response.role;
  $("landing-error").textContent = "";
  showScreen("lobby");
}

$("copy-code").onclick = async () => {
  try {
    await navigator.clipboard.writeText(state.code);
    toast("Expedition code copied");
  } catch {
    toast(`Room code: ${state.code}`);
  }
};

$("start").onclick = () => socket.emit("startGame");
$("again").onclick = () => socket.emit("startGame");
$("deploy").onclick = () => socket.emit("deployHydrophone");
$("tag").onclick = () => socket.emit("tagSignal");

document.querySelectorAll("[data-helm]").forEach((button) => {
  button.onclick = () => {
    const action = button.dataset.helm;
    socket.emit("helm", {
      turn: action === "left" ? -1 : action === "right" ? 1 : 0,
      throttle: action === "up" ? 1 : action === "down" ? -1 : 0,
    });
  };
});

document.addEventListener("keydown", (event) => {
  if (myRole !== "captain" || state?.phase !== "playing") return;
  const keyMap = {
    ArrowLeft: { turn: -1, throttle: 0 },
    ArrowRight: { turn: 1, throttle: 0 },
    ArrowUp: { turn: 0, throttle: 1 },
    ArrowDown: { turn: 0, throttle: -1 },
  };
  if (keyMap[event.key]) {
    event.preventDefault();
    socket.emit("helm", keyMap[event.key]);
  }
});

$("frequency").oninput = () => {
  $("frequency-value").textContent = $("frequency").value;
};
$("scan").onclick = () => socket.emit("scan", { frequency: Number($("frequency").value) });

document.querySelectorAll("[data-dir]").forEach((button) => {
  button.onclick = () => socket.emit("guide", { direction: button.dataset.dir });
});

socket.on("notice", toast);
socket.on("state", (nextState) => {
  state = nextState;
  myRole = nextState.role;
  if (nextState.spectrum) spectrumData = nextState.spectrum;
  render();
});

function render() {
  if (!state) return;
  if (state.phase === "lobby") renderLobby();
  else if (state.phase === "playing") renderGame();
  else renderResult();
}

function renderLobby() {
  showScreen("lobby");
  $("copy-code").textContent = state.code;
  const captain = state.players.captain;
  const analyst = state.players.analyst;
  $("crew").innerHTML = `
    <div class="crew-member ${captain?.connected ? "" : "offline"}"><span>VESSEL CAPTAIN</span><b>${escapeHtml(captain?.name || "Open station")}</b></div>
    <div class="crew-member ${analyst?.connected ? "" : "offline"}"><span>ACOUSTIC ANALYST</span><b>${escapeHtml(analyst?.name || "Open station")}</b></div>
  `;
  $("role-briefing").innerHTML = myRole === "captain"
    ? "<b>You are the Vessel Captain.</b><br>Navigate the Pacific, avoid storms, and deploy three hydrophones. You cannot see the signal—trust your analyst."
    : "<b>You are the Acoustic Analyst.</b><br>Tune the receiver, interpret noisy bearings, and send directions. You cannot steer the vessel—guide your captain.";
  const canStart = myRole === "captain" && captain?.connected && analyst?.connected;
  $("start").classList.toggle("hidden", !canStart);
  $("waiting").classList.toggle("hidden", canStart);
  if (myRole === "analyst" && captain?.connected && analyst?.connected) $("waiting").textContent = "Captain is preparing the launch…";
}

function renderGame() {
  showScreen("game");
  const captain = myRole === "captain";
  $("role-label").textContent = captain ? "VESSEL CAPTAIN" : "ACOUSTIC ANALYST";
  $("room-mini").textContent = state.code;
  $("captain-console").classList.toggle("hidden", !captain);
  $("analyst-console").classList.toggle("hidden", captain);
  $("captain-help").classList.toggle("hidden", !captain);
  $("analyst-help").classList.toggle("hidden", captain);
  $("console-title").textContent = captain ? "NAVIGATION CHART • LIVE" : "HYDROPHONE SPECTRUM • LIVE";
  $("mission-title").textContent = captain ? "Follow the unseen voice" : "Separate signal from noise";
  $("mission-copy").textContent = captain
    ? "Your chart shows weather and instruments, not the animal. Use your partner's acoustic bearings."
    : "The unusual call hides among ships, ice, and known whales. Find its frequency and hold a clean lock.";

  $("timer").textContent = formatTime(state.remaining);
  $("message").textContent = state.message;
  $("lock-value").textContent = `${state.signalLock}%`;
  $("speed").textContent = `${state.ship.speed.toFixed(1)} kn`;
  $("fuel").textContent = `${Math.round(state.ship.fuel)}%`;
  $("hull").textContent = `${Math.round(state.ship.hull)}%`;
  $("fuel-bar").style.width = `${state.ship.fuel}%`;
  $("hull-bar").style.width = `${state.ship.hull}%`;
  $("hydrophones").textContent = `${state.hydrophones.length} / 3`;
  $("score").textContent = state.score;
  $("buoy-count").textContent = `${3 - state.hydrophones.length} REMAINING`;

  if (captain) {
    const arrows = { N: "↑ N", NE: "↗ NE", E: "→ E", SE: "↘ SE", S: "↓ S", SW: "↙ SW", W: "← W", NW: "↖ NW", HOLD: "• HOLD" };
    $("guide-arrow").textContent = state.guidance ? arrows[state.guidance.direction] : "—";
    drawOcean();
  } else {
    drawSpectrum();
    renderReadings();
  }
}

function renderResult() {
  showScreen("result");
  const won = state.phase === "won";
  $("result-icon").textContent = won ? "◉" : "⌁";
  $("result-title").textContent = won ? "The voice has a body." : "The ocean kept its secret.";
  $("result-copy").textContent = state.message;
  $("final-score").textContent = state.score;
  $("again").classList.toggle("hidden", myRole !== "captain");
}

function renderReadings() {
  if (!state.scans?.length) {
    $("readings").innerHTML = "<p>No usable signal yet. Sweep the receiver.</p>";
    return;
  }
  $("readings").innerHTML = [...state.scans].reverse().map((scan) => `
    <div class="reading">
      <strong>${scan.frequency} Hz</strong>
      <span>${scan.quality}% confidence${scan.distance ? ` • ~${scan.distance} nm` : ""}</span>
      <em>${scan.direction}</em>
    </div>
  `).join("");
}

function drawOcean() {
  const canvas = $("ocean");
  const ctx = canvas.getContext("2d");
  const { width: w, height: h } = canvas;
  ctx.clearRect(0, 0, w, h);
  const gradient = ctx.createLinearGradient(0, 0, w, h);
  gradient.addColorStop(0, "#062430");
  gradient.addColorStop(1, "#03131c");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = "rgba(114,244,207,.08)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= w; x += w / 10) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = 0; y <= h; y += h / 10) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

  const sx = (x) => x / 100 * w;
  const sy = (y) => y / 100 * h;
  const storm = ctx.createRadialGradient(sx(state.storm.x), sy(state.storm.y), 2, sx(state.storm.x), sy(state.storm.y), state.storm.radius / 100 * w);
  storm.addColorStop(0, "rgba(255,118,95,.38)");
  storm.addColorStop(1, "rgba(255,118,95,0)");
  ctx.fillStyle = storm;
  ctx.beginPath();
  ctx.arc(sx(state.storm.x), sy(state.storm.y), state.storm.radius / 100 * w, 0, Math.PI * 2);
  ctx.fill();

  state.hydrophones.forEach((buoy) => {
    ctx.strokeStyle = "rgba(114,244,207,.23)";
    ctx.beginPath(); ctx.arc(sx(buoy.x), sy(buoy.y), 27, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = "#72f4cf";
    ctx.beginPath(); ctx.arc(sx(buoy.x), sy(buoy.y), 4, 0, Math.PI * 2); ctx.fill();
    ctx.font = "10px DM Mono"; ctx.fillText(`H${buoy.id}`, sx(buoy.x) + 8, sy(buoy.y) - 8);
  });

  ctx.save();
  ctx.translate(sx(state.ship.x), sy(state.ship.y));
  ctx.rotate(state.ship.heading * Math.PI / 180);
  ctx.fillStyle = "#f4d06f";
  ctx.shadowColor = "#f4d06f"; ctx.shadowBlur = 12;
  ctx.beginPath(); ctx.moveTo(0, -13); ctx.lineTo(8, 10); ctx.lineTo(0, 6); ctx.lineTo(-8, 10); ctx.closePath(); ctx.fill();
  ctx.restore();

  ctx.fillStyle = "rgba(217,247,238,.35)";
  ctx.font = "9px DM Mono";
  ctx.fillText("ALEUTIAN RESEARCH SECTOR / GRID 52-NP", 16, 22);
}

function drawSpectrum() {
  const canvas = $("spectrum");
  const ctx = canvas.getContext("2d");
  const { width: w, height: h } = canvas;
  ctx.fillStyle = "#03151e";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(114,244,207,.08)";
  for (let y = 30; y < h; y += 30) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

  const points = [];
  for (let hz = 15; hz <= 80; hz += 0.5) {
    let strength = 7 + Math.random() * 9;
    spectrumData.forEach((signal) => {
      strength += signal.strength * Math.exp(-Math.pow(hz - signal.frequency, 2) / 2.8);
    });
    points.push({ x: (hz - 15) / 65 * w, y: h - Math.min(h - 20, strength * 2.15) });
  }
  const fill = ctx.createLinearGradient(0, 0, 0, h);
  fill.addColorStop(0, "rgba(114,244,207,.5)");
  fill.addColorStop(1, "rgba(114,244,207,.01)");
  ctx.beginPath();
  points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
  ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
  ctx.beginPath();
  points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
  ctx.strokeStyle = "#72f4cf"; ctx.lineWidth = 1.5; ctx.stroke();

  ctx.font = "10px DM Mono";
  for (let hz = 20; hz <= 80; hz += 10) {
    const x = (hz - 15) / 65 * w;
    ctx.fillStyle = "rgba(217,247,238,.42)";
    ctx.fillText(`${hz}Hz`, x - 13, h - 10);
  }
}

function formatTime(seconds) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}
