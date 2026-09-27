# Seedfall

**A co-op 3D terraforming simulation for 1–6 players.** You land on a tiny planet that is frozen, toxic and dry. Your team builds machines, mines energy, plants forests and shoots down meteors until the planet can support life on its own.

- Walk on a real spherical planet (Mario Galaxy style gravity), with a day/night cycle driven by a moving sun.
- The simulation reacts: oceans rise and flood low ground, clouds form, the sky turns from toxic orange to blue, snow melts and grass spreads out from your trees.
- Room codes and invite links, a lobby, and drop-in/drop-out play. If the host leaves, another player takes over and the game keeps going.
- Everything is procedural: no downloaded models, textures or sound files. The audio is synthesized with WebAudio and the soundtrack brightens as the planet heals.

## How to play

| Key | Action |
| --- | --- |
| `W A S D` | Move (`Shift` sprints, `Space` jumps, hold `Space` in the air for the jetpack) |
| Mouse | Look around (click the planet to lock the mouse) |
| `1`–`5` | Pick a structure, then **click** (or `E`) to build it |
| Click (nothing selected) | Shoot meteors and crawlers. Aim assist locks on when the crosshair turns red |
| Right click / `Esc` | Cancel building |
| `X` | Salvage the nearest structure (50% refund) |
| `Q` | Ping a spot for your team |
| `H` / `M` | Field manual / mute |

**Goal:** hold the Biosphere index at **90% or higher for 12 seconds** before the colony ship arrives (16 minutes). The index is the average of Air, Water, Heat comfort and Life. If time runs out, the mission fails. Finish in under 8 minutes for gold and under 12 for silver.

| Structure | Cost | What it does |
| --- | --- | --- |
| ☀ Solar Pylon | 20 | Makes energy. Output follows the sun, so spread pylons around the planet |
| ≋ Air Scrubber | 30 | Raises Air. Uses 0.35 energy/s |
| 💧 Vapor Condenser | 30 | Raises Water, but only once the planet is above freezing. Uses 0.35 energy/s |
| 🔥 Thermal Core | 25 | Raises Heat. Too many will cook your forests. Uses 0.3 energy/s |
| 🌱 Seed Pod | 10 | Grows into a tree. Mature trees add oxygen and spread on their own |

Meteor showers arrive every 35–55 seconds, and red rings on the ground show where each meteor will land. An impact destroys everything inside its ring, but it also brings heat and ice. Walk into the cyan crystals to mine shared energy.

**Blight crawlers** start appearing after about 45 seconds. They walk to your nearest machine and eat it, and every living crawler poisons the air. A crawler dies in 2 shots and a brute in 5. Waves get bigger over time, and the radar in the bottom-left corner shows crawlers in purple and meteor targets in red.

**Bounties** are short missions such as "Destroy 4 threats" or "Plant 5 Seed Pods". Each one has a 75-second timer and pays a large energy reward. Kill streaks, floating energy numbers and banners show your progress.

## Architecture

```
┌─────────────── Netlify (static) ────────────────┐        ┌──────── Vercel (serverless) ────────┐
│ client/  Vite + three.js                         │  HTTPS │ server/api/config.js   which transport│
│  ├ sim/     deterministic planet simulation      │ ─────► │ server/api/token.js    Ably tokens    │
│  ├ render/  terrain, water, clouds, bloom, FX    │        │ server/api/rooms/[code].js  lookup    │
│  ├ net/     Session (host logic) + transports    │        └──────────────────────────────────────┘
│  └ game/    sphere-walking controller, input     │                       │ API key stays here
└──────────────────────────────────────────────────┘                       ▼
              ▲   realtime pub/sub + presence (WebSocket)          ┌──────────────┐
              └────────────────────────────────────────────────────│     Ably     │
                                                                   └──────────────┘
```

**Why Ably is involved:** Vercel functions are short-lived HTTP handlers and cannot keep a WebSocket open, so a multiplayer game cannot run its realtime traffic *on* Vercel. The Vercel backend handles the parts that fit serverless: room lookup, config, and signing short-lived realtime tokens so your API key never reaches the browser. [Ably](https://ably.com) carries the live messages over WebSockets.

**Netcode (host-authoritative):**

- The first player in a room is the **host**. The host steps the simulation and broadcasts a tick (stats and meteors) 5 times a second. It sends the world (structures and crystals) only when something changes.
- Every other client mirrors that state. Players send build, mine, shoot and salvage *requests*, and the host validates them. Energy, spacing, water level and structure caps are all checked on the host.
- Each client moves its own avatar and broadcasts its pose 5–12 times a second, depending on room size. Poses are only sent when they change, and remote avatars are smoothed.
- **Host migration:** presence decides the host (earliest `joinedAt`). If the host leaves, the next player already holds a mirrored copy of the world and continues stepping it.
- Terrain is generated from a shared seed, so it never has to be sent over the network.

The same transport interface also has a plain WebSocket relay (`server/ws-server.js`) for local development. You can deploy that relay to Render, Railway or Fly.io if you would rather not use Ably. There is also an offline transport for Solo mode.

## Run locally

```bash
npm run setup      # installs server/ and client/ dependencies
npm run dev        # relay on :8787 + Vite on :5173
```

Open http://localhost:5173 in two browser windows. Create a room in one and join it from the other with the code. Solo mode works without any backend.

## Deploy: backend on Vercel, frontend on Netlify

### 1. Realtime (Ably, free tier)

1. Create an account at ably.com, then create an app.
2. Copy an API key that has **Publish, Subscribe and Presence** capabilities.

### 2. Backend on Vercel

1. Go to Vercel, choose **Add New → Project**, and import this repo.
2. Set **Root Directory** to `server`. Leave Framework Preset as **Other** and leave the build command empty.
3. Add these environment variables:
   - `ABLY_API_KEY`: the key from step 1
   - `ALLOWED_ORIGINS`: `https://<your-site>.netlify.app` (use `*` while you test)
4. Deploy, then open `https://<project>.vercel.app/api/health`. It should return `{"ok":true,...,"realtime":"ably"}`.

### 3. Frontend on Netlify

1. Go to Netlify, choose **Add new site → Import an existing project**, and pick this repo. The build settings are read from `netlify.toml` (base `client`, publish `dist`).
2. Under Site settings → Environment variables, add `VITE_API_URL` = `https://<project>.vercel.app` with no trailing slash.
3. Deploy. Share links look like `https://<your-site>.netlify.app/?room=ABCDE`.

If you change `VITE_API_URL` later, redeploy the site. Vite bakes the value in at build time.

### Alternative: no Ably

Deploy `server/` to **Render** as a Web Service instead (build `npm install`, start `npm start`, health check `/api/health`). Point `VITE_API_URL` at the Render URL. The frontend reads `/api/config`, sees `realtime: "ws"` and switches to the WebSocket relay automatically. The trade-off is that free Render instances sleep when idle, so the first connection can take about 30 seconds.

### Cost check

A 4-player, 10-minute match uses roughly 80–100k Ably messages, because every publish is counted once per recipient. Check Ably's current free-tier limits. If you outgrow them, lower the pose rate in `client/src/main.js` (`poseTimer`) or switch to the Render relay, which has no per-message limits.

## Project layout

```
client/                    Netlify site
  index.html               menus, lobby, HUD, overlays
  src/main.js              app flow, input → actions, game loop
  src/sim/                 world.js (simulation + snapshots), terrain.js, defs.js (tuning), noise.js, vec.js
  src/net/                 session.js (host logic), transports.js (Ably / WS / local), api.js
  src/render/              scene.js (planet, sky, water, clouds, bloom), models.js, fx.js
  src/game/                controller.js (sphere movement + camera), input.js
  src/ui/hud.js            HUD, objectives, toasts
  src/audio.js             procedural music and sound effects
server/                    Vercel project
  api/                     config, token, health, rooms/[code]
  ws-server.js             self-hosted relay (local dev / Render)
netlify.toml               Netlify build config
```

## Roadmap to the next level

1. **Touch controls** for phones (virtual stick, tap to build, auto-fire), plus a quality toggle that turns off shadows and bloom on weak GPUs.
2. **Planet biomes and events:** volcanic, ocean and ice worlds, plus dust storms that cut solar output and acid rain that corrodes machines.
3. **Roles:** Engineer (cheaper builds), Botanist (faster trees), Gunner (bigger aim assist). This gives each player a reason to coordinate.
4. **Persistence:** an Upstash Redis leaderboard (through the Vercel Marketplace) of fastest terraforms per player count, and screenshots of the finished planet you can share.
5. **Spectator and replay:** move the host onto a fixed timestep. A replay then only needs the seed plus a timestamped action log.
6. **Server-side validation:** if the game grows public, move the host simulation into a Durable Object or a small Fly.io service so no player can cheat as host.
