# LEXTOWN-01

An open-source, browser-based multiplayer block simulator of **downtown Lexington, Kentucky** — think Roblox-meets-OSINT-feed. Walk a blocky avatar around a stylized model of the real downtown grid, with live traffic, pedestrians, a full day/night cycle, and a tactical detection-overlay HUD.

Built with [Three.js](https://threejs.org/) (vendored, no build step) and a ~100-line Node WebSocket relay. No accounts, no database, no build tooling — clone it and run it.

## The city

The map is the real downtown core, stylized:

- **Streets** — Third, Second, Short, Main, Vine, and High crossed by Broadway, Mill, Upper, Limestone, and MLK, with the correct one-way pairs (Main/Short eastbound, Vine/Second westbound, Upper northbound, Limestone southbound) and working traffic signals.
- **Landmarks** — Big Blue (Lexington Financial Center), Kincaid Tower, City Center, Central Bank, 21c Museum Hotel, the old courthouse dome on Cheapside, the Circuit Court towers, Central Library, Phoenix Park, Triangle Park, and Rupp Arena.
- **Life** — 66 cars that queue and obey signals, 46 pedestrians, streetlights and neon that come on at dusk, sun shadows that rake through the afternoon.

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
| `Space` | Jump |
| Drag / wheel | Orbit / zoom camera |
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

`server.js` is a dumb relay: it assigns each connection an id, forwards `{t:'state', x,y,z,ry}` packets (sent at 10 Hz) to everyone else, and broadcasts `{t:'leave'}` on disconnect. The client renders remote players through a small interpolation buffer (~160 ms), so movement is smooth at any reasonable latency. There is no server-side validation or persistence — it's a toy MMO skeleton meant to be easy to read and extend.

Ideas for where to take it: chat bubbles, server-authoritative movement, spatial interest management, persistence, riding the cars.

## Deploying

Any box that runs Node ≥18 works:

```bash
PORT=80 node server.js
```

Put it behind a TLS proxy (Caddy, nginx, Cloudflare) and the client automatically uses `wss://`. The static `web/` directory can also be served by a CDN with `#ws=wss://your-relay` pointing at the relay.

## License

MIT — see [LICENSE](LICENSE).
