# LEXTOWN-01

An open-source, browser-based multiplayer block simulator of **downtown Lexington, Kentucky** — think Roblox-meets-OSINT-feed. Walk a blocky avatar around a stylized model of the real downtown grid, with live traffic, pedestrians, a full day/night cycle, and a tactical detection-overlay HUD.

**Play it live: https://playlextown.com** — everyone on the page shares one world.

Built with [Three.js](https://threejs.org/) (vendored, no build step) and a small Node WebSocket relay. No accounts, no database, no build tooling — clone it and run it.

## The city

The map is the real downtown core, stylized:

- **Streets** — Third, Second, Short, Main, Vine, and High crossed by Broadway, Mill, Upper, Limestone, and MLK, with the correct one-way pairs (Main/Short eastbound, Vine/Second westbound, Upper northbound, Limestone southbound) and working traffic signals.
- **Landmarks** — Big Blue (Lexington Financial Center), the Central Bank Tower, City Center, 21c Museum Hotel, the old courthouse dome on Cheapside, the Circuit Court towers, City Hall, Central Library, Phoenix Park, Triangle Park, and Rupp Arena.
- **Life** — 66 cars that queue and obey signals (steal any of them with `E`), 46 pedestrians, surface parking lots, Lexington-style green street-name blades at every corner, streetlights and neon that come on at dusk, sun shadows that rake through the afternoon.
- **The news chopper** — a helipad juts off Big Blue's roof with the **LEXINGTON KY NEWS** helicopter parked on it. One pilot at a time; its belly-mounted water cannon shoves players around. While it's airborne, RPG crates unlock around downtown — three rockets bring it down (it respawns on the pad).

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
| `E` | Enter / exit the nearest car — W/S to drive, A/D to steer, up to 108 km/h. On Big Blue's helipad it boards the **news chopper** instead |
| In the chopper | W/S fly, A/D turn, `Space` climb, `Shift` descend, `E` lands (mid-air it bails out and the chopper crashes). Hold `F`/click for the **water cannon** — the jet pushes players around |
| RPG | While the chopper is up, crates glow at five spots downtown. Walk over one to grab a launcher (2 rockets); `F` fires. Three hits down the chopper; rockets are harmless to people |
| `C` | First-person / third-person camera (scrolling all the way in works too) |
| Drag / wheel | Orbit / zoom camera |
| `G` | Draw/holster the nerf blaster — **drawing opts you into PvP**; holstered players can't be tagged |
| `F` / left-click | Fire a foam dart (a hit freezes the target in an ice cube for 4 s — no health, no scores) |
| Right-click (hold) | Aim-down-sights zoom while the blaster is out |
| `Enter` | Chat (Esc to cancel; messages appear in the log and as a bubble over your head) |
| `V` | Toggle player / drone camera (drone mode has an auto-tour: `C`) |
| `P` | Pause the city sim |
| `B` / `T` / `L` | Toggle detection boxes / motion tracks / landmark labels |
| `1` `2` `3` | Time speed 1× / 60× / 300× |

Desktop mouse: click the game once to enter mouse-look (pointer lock) — the camera follows your mouse with no buttons held, settles in behind you while you walk or drive, and Esc releases the cursor.

The HUD keeps just chat, status, and a `?` help button on screen; everything else (drone cam, first-person toggle, overlay toggles, sim speed) lives under the **SIM** menu in the corner. On touch devices the NERF / FIRE / E-VEH / JUMP buttons appear alongside it.

Touch: left half of the screen is a virtual movement stick, right half orbits the camera, JUMP/FIRE/NERF buttons in the control rail.

## Admin

Set `ADMIN_TOKEN` in the server environment (e.g. a systemd drop-in). In-game, an admin authenticates and moderates through chat:

```
/admin <token>      become admin for this session
/list               players with ids + ips
/kick <name>        disconnect a player
/ban <name>         kick + persist an ip/name ban (bans.json)
/unban <name|ip>    lift a ban
/unfreeze <name>    thaw someone
/announce <msg>     server-wide message
/stats              live counters (uptime, peak, joins, shots, freezes…)
```

## Diagnostics

The server writes a structured event log to `logs/events-YYYY-MM-DD.jsonl`
(joins/leaves with session stats, freezes, admin actions, cheat suspects,
client error reports, fps samples — chat content is never logged), rotated
daily and pruned after 14 days. Live counters are also at
`GET /admin/stats?token=<ADMIN_TOKEN>`. Clients report up to 3 uncaught
errors and a once-a-minute fps sample per session.

Handy queries on the box:

```bash
jq -r 'select(.e=="leave") | [.n, .secs] | @tsv' logs/events-*.jsonl   # session lengths
jq 'select(.e=="client_err")' logs/events-*.jsonl                     # bugs in the wild
jq 'select(.e=="metrics") | {ts,online,rssMb}' logs/events-*.jsonl    # 5-min health snapshots
```

### URL options

- `#name=YOURNAME` — set your player name (default: random `LEX-###`)
- `#h=7.5` — start the day cycle at a given hour (default: dusk)
- `#ws=ws://host:8080` — connect to a specific relay (default: same origin when served over http/https)

## How multiplayer works

`server.js` serves the static client and relays `{t:'state', x,y,z,ry}` packets (sent at 10 Hz) between connections, with server-side sanity enforcement:

- **Movement validation** — every accepted state must be inside the world bounds and reachable from the last accepted state at legal speed, with per-mode caps (walking, jetpack, driving, helicopter — the mode flag is client-declared, so this bounds absurdity rather than proving honesty). Rejected moves are not relayed; the offending client gets a `{t:'correct'}` that snaps it back. Names are sanitized and pinned server-side on first contact.
- **The news chopper** — the server arbitrates the single pilot seat (`{t:'heli'}` enter/exit), tracks hull points, validates rocket-hit claims (`{t:'rhit'}`: shooter in range, not the pilot, rate-limited) and water-cannon shoves (`{t:'push'}`: pilot only, bounded impulse, target near the heli — relayed to everyone as `{t:'pushed'}`). Rockets and spray are cosmetic relays like darts. If the pilot disconnects, the chopper crashes and respawns on the pad.
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
