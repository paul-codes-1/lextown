# LEXTOWN-01

An open-source, browser-based multiplayer block simulator of **downtown Lexington, Kentucky** — think Roblox-meets-OSINT-feed. Walk a blocky avatar around a stylized model of the real downtown grid, with live traffic, pedestrians, a full day/night cycle, and a tactical detection-overlay HUD.

**Play it live: https://playlextown.com** — everyone on the page shares one world.

Built with [Three.js](https://threejs.org/) (vendored, no build step) and a small Node WebSocket relay. No accounts, no database, no build tooling — clone it and run it.

## The city

The map runs from the horse farms north of New Circle Road down through NoLi, the downtown core, the UK campus, and Chevy Chase, stylized:

- **Streets** — Fourth through Seventh, Loudon, and New Circle up north; Third, Second, Short, Main, Vine, High, Maxwell, and Euclid crossed by Broadway, Mill, Upper, Limestone, MLK, Rose, Woodland, and Ashland — with the correct one-way pairs (Main/Short/Maxwell eastbound, Vine/Second westbound, Upper northbound, Limestone southbound) and working traffic signals. Streets end where they really end — MLK and Upper stop at Euclid; Rose starts at Main; north of New Circle the grid gives way entirely. New Circle Road itself is a full beltline loop enclosing the whole built city — north, south, east, and west legs joined at the corners, two-way the whole way around, with an open grassy shoulder between the outer grid and the ring.
- **The horse farms** — past the Urban Service Boundary (New Circle Rd, board fence and all), Broadway becomes Paris Pike and Limestone becomes Russell Cave Road, running between black four-board paddocks: Elmendorf (with the lone white columns standing in the pasture), Gainesway, Mt. Brilliant, and Spendthrift. Tobacco-black and green-roofed barns, ponds, and grazing horses in five coat colors.
- **NoLi** — shotgun houses line the North Limestone corridor, with Al's Bar on the corner at Sixth & Lime, Duncan Park beside it, and Castlewood Park up by Loudon.
- **Landmarks** — Big Blue (Lexington Financial Center), the Central Bank Tower, City Center, 21c Museum Hotel, the old courthouse dome on Cheapside, the Circuit Court towers, City Hall, Central Library, Phoenix Park, Triangle Park, Thoroughbred Park (bronze horses included), and Rupp Arena.
- **The University of Kentucky** — Memorial Coliseum, the Gatton Student Center, the Main Building, Memorial Hall's white steeple, Patterson Office Tower, William T. Young Library, and the quad walks — with Kroger Field's blue ring glowing off S Broadway at night.
- **Chevy Chase & the neighborhoods** — the Euclid storefront strip (say hi to Wheeler Pharmacy), Woodland Park, the wooded Ashland Henry Clay estate, and instanced bungalow blocks with lit windows filling the south and east sides.
- **Life** — ~100 cars that queue and obey signals (steal any of them with `E`), 64 pedestrians, surface parking lots, Lexington-style green street-name blades at every corner, streetlights and neon that come on at dusk, sun shadows that rake through the afternoon.
- **Sound** — a generated audio suite on top of the synth SFX: hop in any car and the **radio is already on** — BIG BLUE RADIO 100.1 FM (bluegrass, synthwave, and honky-tonk instrumentals with DJ breaks and fake local ads) NEWS 630 THE BLOCK (a deadpan anchor, chopper traffic reports, and one very confused caller), 98.5 THE CAT (UK play-by-play from Rupp and Kroger Field, hot-take callers, Tailgate Depot spots), and TRACKSIDE 1450 AM (call to post, live race calls from Keeneland, a deeply unreliable tip sheet), cycled with `R` or the on-screen dial chip — and when someone triggers SNOW EMERGENCY, an EAS alert cuts into the broadcast. Plus a jetpack thrust loop, mission stingers, a dispatch voice, church bells from First Presbyterian at 6/noon/6, park birdsong, downtown hum, storm wind, and horse SFX. Assets are baked by `tools/gen-audio.mjs` (ElevenLabs) into `web/audio/` and lazy-loaded; SND OFF mutes everything.
- **The news chopper** — a helipad juts off Big Blue's roof with the **LEXINGTON KY NEWS** helicopter parked on it. One pilot at a time; its belly-mounted water cannon shoves players around. While it's airborne, RPG crates unlock around downtown — three rockets bring it down (it respawns on the pad). **Flying it is locked until you beat the mission below** (once per device).
- **Mission: THE RIBBON CUTTING** — press `E` at the gold ring by City Hall. The mayor is dedicating "a horse statue" and the news chopper keeps buzzing her press conference; take the ceremonial RPG (first-person aim) and shoot it down. The pilot bails out with a parachute, the ribbon gets cut, and your time goes to a **global high-score board** (SIM menu → SCORES). Fully replayable, with synthesized sound effects and live captions throughout.
- **Mission 2: SNOW EMERGENCY** — beating the ribbon cutting unlocks the **City Hall door**. Inside, the mayor hands you a snow plow: a freak storm has buried five downtown streets. `Space` raises/lowers the blade — down on snow clears it, down on bare pavement grinds up the road for time penalties. And whatever you do, **don't plow the mayor's street** — half of reddit is camped out there watching for the plows. Timed, with its own global board.
- **Mission 3: THE DATA CENTER** — the mayor (off the record, on a Phoenix Park bench) has you tail Councilman Graft up Limestone to Al's Bar, where he and a developer plan to hide a data center inside luxury student housing at UK — they just have to bulldoze a few historic buildings that are *definitely not already falling down*. Eavesdrop, beat them to the quad, photograph the scouting trip (`F` is the camera — don't get made), and bring back the photos. They leak on r/lexington, the data center dies, and the councilman resigns to spend more time with his data. Timed, global board.
- **Mission 4: HORSEPOWER** — three thoroughbreds got loose the night before the auction: one tailgating at the Kroger Field lots, one eating the flowers at Chevy Chase, and one in Thoroughbred Park **pretending to be a statue**. Walk up slow (run at a horse and the horse wins), take the lead rope with `E`, and get them home to the Elmendorf paddock — a calm horse follows you, and if you get in a car, **the horse gets in the car**. Timed, global board.
- **Mission 5: DEADLINE** — NEWS 630 THE BLOCK needs art for the six o'clock. Press `E` at the gold ring outside the newsroom on Main St, grab a car, and drive five downtown checkpoints — Thoroughbred Park, MLK & High, Rupp Arena, the Cheapside courthouse, back to The Block — against a 180-second clock. Checkpoints only bank while you're **in a car** (on foot the ring shows but doesn't count), and the route flows with the one-way grid. Beat the clock and your time lands on a global board.
- **Mission 6: THE MELT** — ripped from the July 2026 headlines: Crank & Boom is Lexington's shop in a national **fan-voted ice cream bracket** (against two Louisville shops), and the voters haven't tasted a spoonful. Press `E` at the pink ring at the stand on W Main by the Distillery District, grab a car, and make five scoop stops across town before the cooler is soup. The clock **is** the melt — and every crash sloshes the cooler and melts it 20 seconds faster. Timed, global board.
- **Mission 7: TAILGATE COMPLIANCE** — also ripped from the headlines: UK Athletics' new tailgating guidelines say every structure must be **tagged with the owner's contact info**, setup doesn't begin until August 8, and no deep ground stakes near tree roots. Eight canopies just appeared in the Kroger Field lots. In July. Press `E` at the blue ring by the lots and tag all eight before kickoff — on foot, with a clipboard (it doesn't work from a car window). The two with deep stakes take a two-second pull. Timed, global board.

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
| RPG | While the chopper is up, crates glow at five spots downtown. Walk over one to grab a launcher (2 rockets); `F` fires. Holding it locks you into first-person aim. Three hits down the chopper; rockets are harmless to people |
| `E` at City Hall's gold ring | Start **THE RIBBON CUTTING** mission (see above) |
| `E` at the City Hall door | Start **SNOW EMERGENCY** (after beating mission 1) — `Space` works the plow blade |
| `E` at the pink ring (W Main, Distillery District) | Start **THE MELT** — five scoop stops by car before the cooler melts; crashes melt it faster |
| `E` at the blue ring (Kroger Field lots) | Start **TAILGATE COMPLIANCE** — tag all 8 canopies on foot before kickoff |
| `C` | First-person / third-person camera (scrolling all the way in works too) |
| Drag / wheel | Orbit / zoom camera |
| `G` | Draw/holster the nerf blaster — **drawing opts you into PvP**; holstered players can't be tagged |
| `F` / left-click | Fire a foam dart (a hit freezes the target in an ice cube for 4 s — no health, no scores) |
| Right-click (hold) | Aim-down-sights zoom while the blaster is out |
| `Enter` | Chat (Esc to cancel; messages appear in the log and as a bubble over your head) |
| `V` | Toggle player / drone camera (drone mode has an auto-tour: `C`) |
| `P` | Pause the city sim |
| `R` | Cycle the car radio (in a vehicle): BIG BLUE RADIO 100.1 → NEWS 630 THE BLOCK → 98.5 THE CAT → TRACKSIDE 1450 → off (or tap the on-screen dial) |
| `B` / `L` | Toggle player detection boxes / landmark labels |
| `1` `2` `3` | Time speed 1× / 60× / 300× |

Desktop mouse: click the game once to enter mouse-look (pointer lock) — the camera follows your mouse with no buttons held, settles in behind you while you walk or drive, and Esc releases the cursor.

The HUD keeps just chat, status, and a `?` help button on screen; everything else (drone cam, first-person toggle, overlay toggles, sim speed) lives under the **SIM** menu in the corner. On touch devices the NERF / FIRE / E-VEH / JUMP buttons appear alongside it.

A persistent **gold objective marker** always points to your next unbeaten mission — an on-screen diamond with its label and range, or a screen-edge arrow when the objective is behind you — and a **gold route line follows the real streets to it**, turning at the intersections, with a tall light beacon marking the destination over the skyline. A one-time onboarding banner shows for first-timers; toggle it all with **WAYPT** in the SIM menu (or force it off with `#wp=0`).

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
- **Mission leaderboards** — `{t:'score', ms, m}` submissions are bounds-checked per board (each board has its own plausible-time window, e.g. m1: 3s–10min, m6: 40s–15min) and rate-limited; the top 50 of each persist in `scores.json` (`{m1:[], m2:[], …, m7:[]}`) and the top 10 are served back via `{t:'scores'}`. Wins are announced in chat. The missions themselves run entirely client-side (the mission chopper is a local NPC, not the shared one).
- **Chat** — `{t:'chat', msg}` messages are stripped to printable ASCII, capped at 120 chars, and rate-limited per client (3-message burst, ~1/1.2 s refill) before being broadcast to everyone. The client shows them in the log and as a speech bubble over the sender's head.
- **Packet-rate limiting** — state packets beyond 15/s per client are dropped.

The client renders remote players through a small interpolation buffer (~160 ms), so movement is smooth at any reasonable latency, and auto-reconnects with backoff if the relay drops. There is no world persistence — only the mission leaderboards survive a server restart.

Ideas for where to take it: spatial interest management, persistence, private worlds, riding the cars.

## Ambient NPCs

`bots/npcs.mjs` runs a few preset-line characters (BIG LEX the talking horse, a
LFUCG permits clerk, a shell-shocked news cameraman, and friends) that connect
to the relay like any other client so the streets and chat feel inhabited when
few humans are online. They speak from fixed line pools only — **no AI calls**
(the old Claude hook is suspended) — and throttle themselves well under the chat
rate limit. Run them locally against a dev server:

```bash
LEXTOWN_WS=ws://localhost:8080 node bots/npcs.mjs
```

They connect as ordinary WS clients but are **excluded from the human join/peak
counters and cheat heuristics** (so telemetry stays honest) while still being
visible in-world; in `/admin/stats` they show up tagged `npc:1`. In production
they run under their own `lextown-npcs` systemd unit — see
[`deploy/SETUP.md`](deploy/SETUP.md) for the token-shared-between-two-drop-ins
setup and the graceful-degradation note.

## Deploying

Any box that runs Node ≥18 works:

```bash
PORT=80 node server.js
```

Put it behind a TLS proxy (Caddy, nginx, Cloudflare) and the client automatically uses `wss://`. The static `web/` directory can also be served by a CDN with `#ws=wss://your-relay` pointing at the relay.

## Modding

It's MIT and it's basically two files with no build step — forkable in an
afternoon. [`MODDING.md`](MODDING.md) is a full guide for humans and AI agents
alike: run it locally, the architecture tour, copy-paste recipes for new
landmarks / streets / missions / radio stations / NPCs / multiplayer toys, how
to self-host, and a ready-to-hand-off brief for pointing a coding agent at the
repo.

## License

MIT — see [LICENSE](LICENSE).
