# Signal 52

A real-time, two-player ocean mystery simulation inspired by the real 52-hertz whale recordings.

One player is the **Vessel Captain** and controls the research ship. The other is the **Acoustic Analyst** and searches the live hydrophone spectrum. Neither player has enough information to succeed alone.

## Play locally

```bash
npm install
npm start
```

Open `http://localhost:3000` on two devices or browser windows. Create an expedition on one and join with its five-character code on the other.

## Rules

1. The Captain steers, changes speed, avoids the storm, and deploys up to three hydrophones.
2. The Analyst tunes the receiver, scans suspicious frequencies, and sends compass directions.
3. Build at least 55% signal lock, move within 9 nautical miles of the source, and document it before three minutes expire.
4. Scans, hydrophones, storm damage, and wasted time reduce the research score.

## Deployment

The app is a single Node.js service and works on hosts that support WebSockets, including Render and Railway.

- Build command: `npm install`
- Start command: `npm start`
- Health check: `/health`

## Scientific note

The game is inspired by a real unidentified 52 Hz whale call first recorded in 1989 and tracked for years through hydrophone arrays. “The loneliest whale” is a popular nickname, not a confirmed scientific conclusion.
