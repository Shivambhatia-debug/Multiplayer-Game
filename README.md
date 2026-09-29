# ARES: Last Colony

**A co-op 3D alien-invasion survival game for 1–6 players.**

> **2071:** The Aurora Initiative founds the Ares Colony on Mars.
> **2084:** On Earth, the AI network SENTINEL seizes control.
> **2085:** SENTINEL signals deep space, and the alien Xal answer.
> **2086:** Earth goes dark.
> **Today:** The last humans hide in the ruins of Ares. The Xal have found them.

**Your mission:** keep the colony **reactor** alive through **10 waves** of the Xal while the evacuation beacon charges. If the reactor falls, humanity falls with it.

- **Opening cinematic (~45 s, skippable):** Earth under SENTINEL's red network, the signal into deep space, the Xal portal and mothership, the attack, Earth breaking apart, and the camera arriving at Mars.
- **A planned colony:** a reactor plaza, four paved roads with lamps, a perimeter wall with gates, and four districts: research labs with specimen tanks, habitation domes and a greenhouse, the evac landing pad with control tower and fuel tanks, and an industrial yard with containers, rovers, a solar farm and a comms tower. Outposts elsewhere lie abandoned. Buildings block movement and the camera.
- **Human survivors:** pilots are humans in pressure suits with bubble helmets and walk cycles. Six colony scientists type at consoles, stand guard and haul crates around the plaza.
- **The rescue:** survive all 10 waves and the evacuation ship ARK-7 lands on the pad. Scientists and pilots run up the ramp and the ship lifts off. If the reactor falls instead, it explodes.
- **Realistic Mars:** a wide, flat plain with a far horizon (the planet is 1.2 km in radius, so the ground no longer curves like a small ball), dunes, craters, distant mountain ranges, rust dust, dark basaltic sand, bump-mapped gravel, noise-shaped boulders, floating dust, dust devils, a butterscotch sky with blue sunsets, and the moons Phobos and Deimos. Rendering uses MSAA, bloom and a cinematic grade.
- **Smooth on any device:** movement accelerates and brakes smoothly and the camera eases after you. Graphics has High, Medium and Low presets (phones and weaker PCs start on Medium), and the render resolution adapts automatically to keep the frame rate up.
- **Plays on phones:** a floating thumb stick, drag-to-look and thumb buttons (Fire, Jump, Run, Build, Ping and Salvage), auto-fire with sticky aim (🎯 toggle), vibration on hits and damage, an adjustable look speed, and a layout that fits landscape and portrait screens. Phones use a Medium graphics preset (sharp resolution, 2x MSAA, soft shadows), and every camera, including the intro, widens its lens on narrow screens so nothing is cropped. Starting a mission on a phone switches to fullscreen landscape.
- **The Xal** are armoured humanoid warriors with glowing plasma blades: fast **Stalkers** (green blade), huge **Juggernauts** (red double-bladed staff) and hooded **Casters** that throw acid from range.
- **Pilot classes:** Engineer (30% cheaper turrets, repairs defences and the reactor nearby), Medic (heals everyone nearby, revives twice as fast), Heavy (170 health, double damage, slower) and Scout (faster, longer jetpack, extra energy from cells).
- **Revive:** a downed pilot lies where they fell. Stand next to them to revive them in place; otherwise they respawn at the reactor after the bleed-out timer.
- **Mothership boss** on waves 5 and 10: it circles the colony and calls in orbital strikes (dodge the green rings). Shoot the glowing core underneath.
- **Armory upgrades** (rifle damage, fire rate) and a **plasma grenade** with a cooldown.
- **Data logs:** gold light pillars mark six abandoned outposts. Walk in to recover the story of SENTINEL and bonus energy.
- **Difficulty** (Easy, Normal, Nightmare), random **dust storms** that hide Xal ambushes, and a **daily challenge** with the same planet and waves for everyone.
- **Leaderboards** (online with Upstash Redis, or this device's best runs) and 12 **achievements**.
- **Customisation:** helmet (bubble, visor, tactical), suit pattern (plain, stripes, camo) and emotes (wave, cheer).
- Adaptive music, radio voice lines, slow motion on big moments, and an installable **PWA** that plays Solo offline.
- Every pilot has **health**. The Xal attack pilots, buildings and the reactor.
- Room codes, invite links, drop-in/drop-out play and host migration. Everything is procedural, with no downloaded models, textures or sounds.

## How to play

| Key | Action |
| --- | --- |
| `W A S D` | Move (`Shift` sprints, `Space` jumps, hold `Space` in the air for the jetpack) |
| Mouse | Look around (click the screen to lock the mouse) |
| `1`–`4` | Pick a defence, then **click** (or `E`) to build it |
| Click (nothing selected) | Shoot. Aim assist locks on when the crosshair turns red |
| Right click / `Esc` | Cancel building |
| `X` | Salvage the nearest defence (50% refund) |
| `Q` | Ping a spot for your team |
| `G` | Plasma grenade |
| `U` | Armory (upgrades) |
| `T` / `Y` | Emotes: wave / cheer |
| `H` / `M` | Field manual / mute |

**On a phone or tablet:** drag on the left half of the screen to move (push to the edge to run), and drag on the right half to look. Hold **Fire** to shoot, tap **Jump** and hold it in the air for the jetpack, tap a slot at the bottom and then **Build** to place it, and tap **?** for the field manual. Add `?touch=1` to the URL to try the touch controls on a desktop.

| Defence | Cost | What it does |
| --- | --- | --- |
| Auto Turret | 60 | Shoots aliens within 13 m on its own. Limited to 3 + 2 per pilot |
| Power Generator | 45 | +0.5 energy per second |
| Med Station | 40 | Heals pilots standing within 6 m |
| Barricade | 20 | 520 HP wall. Aliens stop to smash it |

**Energy** is shared by the team. You earn it from glowing power cells (walk into them), from alien and pod kills (turret kills give nothing) and from a bonus for each cleared wave.

**The Xal:** *Drones* are fast and weak. *Brutes* (from wave 2) are slow and hit very hard. *Spitters* (from wave 3) spit acid from 15 m away. *Drop pods* (from wave 2) fall from orbit onto a red ring. Shoot them before they land, or they release three drones and damage everything nearby. Aliens attack the nearest pilot within 16 m, then nearby buildings, then the reactor. Later waves are bigger and tougher.

## Architecture

```
┌─────────────── Netlify (static) ────────────────┐        ┌──────── Vercel (serverless) ────────┐
│ client/  Vite + three.js                         │  HTTPS │ server/api/config.js   which transport│
│  ├ sim/     waves, aliens, combat, colony layout │ ─────► │ server/api/token.js    Ably tokens    │
│  ├ render/  Mars terrain, ruins, sky, bloom, FX  │        │ server/api/rooms/[code].js  lookup    │
│  ├ net/     Session (host logic) + transports    │        └──────────────────────────────────────┘
│  └ game/    controller, keyboard + touch input   │                       │ API key stays here
└──────────────────────────────────────────────────┘                       ▼
              ▲   realtime pub/sub + presence (WebSocket)          ┌──────────────┐
              └────────────────────────────────────────────────────│     Ably     │
                                                                   └──────────────┘
```

**Why Ably is involved:** Vercel functions are short-lived HTTP handlers and cannot keep a WebSocket open, so a multiplayer game cannot run its realtime traffic *on* Vercel. The Vercel backend handles the parts that fit serverless: room lookup, config, and signing short-lived realtime tokens so your API key never reaches the browser. [Ably](https://ably.com) carries the live messages over WebSockets.

**Netcode (host-authoritative):**

- The first player in a room is the **host**. The host runs the waves, alien AI, turrets and all damage, and broadcasts a tick (reactor, energy, pilot health, aliens and pods) 5 times a second. It sends the world (defences and power cells) only when something changes.
- Every other client mirrors that state. Players send build, mine, shoot and salvage *requests*, and the host validates them. Energy, spacing, ruins, turret and building caps are all checked on the host.
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
5. Optional, for online leaderboards: add a free **Upstash Redis** database (Vercel → Storage / Marketplace, or upstash.com) and set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. Without them the game shows each player's own best runs.

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
  src/net/                 session.js (host logic), transports.js (Ably / WS / local), api.js
  src/sim/                 world.js (waves, aliens, combat), ruins.js (colony layout), defs.js (units + story)
  src/render/              scene.js (lights, reactor, aliens, turrets, post-processing), intro.js (opening cinematic),
                           terrainView.js (Mars ground, rocks), ruinsView.js (colony buildings), survivors.js
                           (scientists + rescue ship), dust.js, materials.js, sky.js, models.js, fx.js
  src/game/                controller.js (movement + camera), input.js, touch.js (phone controls)
  src/ui/hud.js            HUD, objectives, toasts
  src/audio.js             procedural music and sound effects
server/                    Vercel project
  api/                     config, token, health, scores, rooms/[code]
  ws-server.js             self-hosted relay (local dev / Render)
netlify.toml               Netlify build config
```

## Roadmap to the next level

1. **More maps:** a second colony (polar ice base) with its own layout.
2. **Weapon variety:** a shotgun for Heavies and a sniper rifle for Scouts.
3. **Server-side validation:** if the game grows public, move the host simulation into a Durable Object or a small Fly.io service so no player can cheat as host.
