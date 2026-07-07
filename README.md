# LEXTOWN-01

An open-source, browser-based multiplayer block simulator of **downtown Lexington, Kentucky** — think Roblox-meets-OSINT-feed. Walk a blocky avatar around a stylized model of the real downtown grid, with live traffic, pedestrians, a full day/night cycle, and a tactical detection-overlay HUD.

Built with [Three.js](https://threejs.org/) (vendored, no build step) and a ~100-line Node WebSocket relay. No accounts, no database, no build tooling — clone it and run it.

## The city

The map is the real downtown core, stylized:

- **Streets** — Third, Second, Short, Main, Vine, and High crossed by Broadway, Mill, Upper, Limestone, and MLK, with the correct one-way pairs (Main/Short eastbound, Vine/Second westbound, Upper northbound, Limestone southbound) and working traffic signals.
- **Landmarks** — Big Blue (Lexington Financial Center), Kincaid Tower, City Center, Central Bank, 21c Museum Hotel, the old courthouse dome on Cheapside, the Circuit Court towers, Central Library, Phoenix Park, Triangle Park, and Rupp Arena.
- **Life** — 66 cars that queue and obey signals (steal any of them with `E`), 46 pedestrians, surface parking lots, Lexington-style green street-name blades at every corner, streetlights and neon that come on at dusk, sun shadows that rake through the afternoon.

## Quick start

```bash
npm install
npm start          # serves http://localhost:8080 + WebSocket relay on the same port
```

Open `http://localhost:8080/` in two browser windows — each gets an avatar, and you'll see each other move in real time. Anyone who can reach the server joins the same world.

No server? Opening `web/index.html` directly (or hosting `web/` statically) runs single-player with three bot walkers standing in for peers.

## Controls

| Input | Action |
|---|---|
| `WASD` / arrows | Walk (relative to camera) |
| `Shift` | Run |
| `Space` | Jump — **hold in mid-air to fly the jetpack** (fuel drains, recharges on the ground; land on rooftops) |
| `E` | Enter / exit the nearest car — W/S to drive, A/D to steer, up to 108 km/h |
| Drag / wheel | Orbit / zoom camera |
| `Enter` | Chat (Esc to cancel; messages appear in the log and as a bubble over your head) |
| `V` | Toggle player / drone camera (drone mode has an auto-tour: `C`) |
| `P` | Pause the city sim |
| `B` / `T` / `L` | Toggle detection boxes / motion tracks / landmark labels |
| `1` `2` `3` | Time speed 1× / 60× / 300× |

Touch: left half of the screen is a virtual movement stick, right half orbits the camera, JUMP button in the control rail.

### URL options

- `#name=YOURNAME` — set your player name (default: random `LEX-###`)
- `#h=7.5` — start the day cycle at a given hour (default: dusk)
- `#ws=ws://host:8080` — connect to a specific relay (default: same origin when served over http/https)

## How multiplayer works

`server.js` serves the static client and relays `{t:'state', x,y,z,ry}` packets (sent at 10 Hz) between connections, with server-side sanity enforcement:

- **Movement validation** — every accepted state must be inside the world bounds and reachable from the last accepted state at legal speed, with per-mode caps (walking, jetpack, driving — the mode flag is client-declared, so this bounds absurdity rather than proving honesty). Rejected moves are not relayed; the offending client gets a `{t:'correct'}` that snaps it back. Names are sanitized and pinned server-side on first contact.
- **Chat** — `{t:'chat', msg}` messages are stripped to printable ASCII, capped at 120 chars, and rate-limited per client (3-message burst, ~1/1.2 s refill) before being broadcast to everyone. The client shows them in the log and as a speech bubble over the sender's head.
- **Packet-rate limiting** — state packets beyond 15/s per client are dropped.

The client renders remote players through a small interpolation buffer (~160 ms), so movement is smooth at any reasonable latency. There is no persistence — the world resets when the server does.

Ideas for where to take it: spatial interest management, persistence, private worlds, riding the cars.

## Deploying

Any box that runs Node ≥18 works:

```bash
PORT=80 node server.js
```

Put it behind a TLS proxy (Caddy, nginx, Cloudflare) and the client automatically uses `wss://`. The static `web/` directory can also be served by a CDN with `#ws=wss://your-relay` pointing at the relay.

## License

MIT — see [LICENSE](LICENSE).
