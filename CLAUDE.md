# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

LEXTOWN-01 — a free, open-source (MIT) multiplayer browser game: a stylized 3D
recreation of downtown Lexington, KY. Live at **https://playlextown.com**.
Three.js client + a single-file Node WebSocket relay. No build step, no
bundler, no database, no TypeScript — plain ES5-style JS, vendored
`web/vendor/three.min.js` (r147 UMD; `examples/jsm` addons are NOT available).

## Commands

```bash
npm install                 # one dep: ws
npm start                   # serves http://localhost:8080 + WS relay on same port
ADMIN_TOKEN=x PORT=8080 node server.js   # env knobs

node --check web/app.js && node --check server.js   # the only "lint/test" gate
```

There is no test framework. Verification is: syntax-check, then load two
browser tabs against localhost and exercise the feature (the WS relay makes
most bugs visible only with 2+ clients). Useful URL params when testing:
`?v=N` (cache-bust), `#name=X`, `#h=13` (start hour), `#ws=<url>` (explicit
relay; same-origin is automatic over http/https, bots-only fallback otherwise).

## Deploy (production)

Lightsail box `playlextown`, tree at `/opt/lextown` (ubuntu-owned), systemd
unit `lextown`, Caddy TLS in front. Deploy = push to GitHub `main`, then:

```bash
ssh -i ~/.ssh/lextown.pem ubuntu@44.211.95.210 \
  'cd /opt/lextown && git pull -q && sudo systemctl restart lextown'
```

- Restarting the server drops connected players to LOCAL-SIM until they
  refresh (no client auto-reconnect yet) — deploy accordingly.
- `ADMIN_TOKEN` lives in `/etc/systemd/system/lextown.service.d/admin.conf`
  on the box, never in the repo. Bans persist to `/opt/lextown/bans.json`
  (gitignored).
- Telemetry: JSONL event log in `/opt/lextown/logs/` (14-day auto-prune),
  live counters via in-game `/stats` or `GET /admin/stats?token=…`. **Never
  log chat content** — privacy.html promises it isn't stored.
- The box has **no static IP** (account quota). IP survives reboots but
  changes on stop/start — then fix the `@` and `www` A records in Route53
  zone `Z0193083291ALXGNIZKM6`.
- Full runbook: `deploy/SETUP.md`.

## Architecture

Two files carry everything:

**`server.js`** — static file host for `web/` + WS relay with server-side
sanity enforcement. Message types: `welcome` (includes a heli snapshot),
`state` (10 Hz, per-mode speed caps — mode `m` is client-declared
walk/fly/drive/heli so caps bound absurdity, not dishonesty; a mode *switch*
gets a one-packet 7 m slack because entering vehicles teleports the avatar),
`chat` (token bucket, ASCII-sanitized; leading `/` routes to admin commands
gated by `ADMIN_TOKEN`), `shot` (cosmetic dart relay), `hit` (freeze-tag
validation: both opted in via `p` flag, ≤80 m, no re-freeze → broadcasts
`frozen`), `heli` (single-pilot arbitration: enter needs proximity, exit can
carry `crash:1`, pilot disconnect = crash), `rhit` (rocket-hit claim: in
range, not the pilot, rate-limited → `hp`/`down` broadcasts, hp resets to 3
at the pad), `rocket`/`spray` (cosmetic relays), `push` (water-cannon shove:
pilot only, bounded impulse, target near heli → `pushed` to everyone),
`correct` (movement rejection snap-back), `sys`, `leave`.
Names are sanitized server-side; IP+name bans are checked at connect.
Gotcha: client headings must be wrapped to ±π before sending (`ry` is
bounds-checked ±10) — un-wrapped accumulating headings (heli/car circling)
eventually get every state packet rejected.

**`web/app.js`** — one IIFE, ~2,000 lines, ordered sections (renderer → grid →
textures → world building → cars/peds → avatar/player → net/chat → bots →
day/night → cameras → controls → HUD → overlay → main loop). **Top-level
statement order matters**: world-building sections push into registries
(`colliders` with heights, `slabRects`, `labels`, `nightMats`, `vehicles`,
`treePts`, `acPts`, `parkedPts`) that must be declared before the section that
fills them runs — a `vehicles`-before-init crash has happened once already.

Key models to keep straight:

- **World grid**: stylized orthogonal, 1 unit = 1 m, x=east z=south, 100 m
  blocks. `EW`/`NS` street tables encode real one-way directions. Procedural
  blocks fill the grid except hand-built landmark blocks listed in `SKIP`
  (keyed `"<nsGap>-<ewGap>"`). All facade/road/sign textures are generated on
  canvas at boot — there are no image assets except `og.jpg`.
- **Height-aware ground**: `groundY(x,z,yRef)` and `collide(p,r,y)` consult
  collider heights so the jetpack clears buildings and rooftops are landable.
  Anything hand-built that should block or carry the player needs a
  `colliders` entry with `h`.
- **Sim clocks**: day/night runs on `simH` (scaled, pausable); traffic,
  signals, and gameplay run on real time. Don't couple them.
- **Net pipeline**: everything remote (players AND offline bots) flows through
  `handleNet` → `remotes` map → `updateRemotes` interpolation (~160 ms
  buffer). Bots are just locally-generated state packets, so multiplayer
  features must work through that one pipeline to work offline.
- **The news chopper is a single shared object** (`heli`), not a vehicle in
  `vehicles`. Whoever pilots it (local via `player.heli`, remote via `m:3`
  state packets) drives the one mesh; parked position comes from
  `heli`/`exit` messages. The pilot mirrors the heli into `player.x/y/z`
  (y − 1.2) so netTick/camera just follow. RPG crates (`rpgSpots`) unlock
  when `heliActive()`; rockets only damage the chopper; the water cannon
  pushes via `{t:'push'}`→`{t:'pushed'}` with client-side knockback
  (`player.kx/kz`) that scales walking input down so the combined speed
  stays under the server's per-mode cap.
- **HUD is two layers**: DOM chips/buttons (`index.html`) + a 2D overlay
  canvas (detection boxes, name tags, labels, joystick, crosshair) drawn in
  `drawOverlay` every frame.
- **Cameras**: player mode uses pointer lock (mouse-look, LMB fire, RMB ADS
  with over-the-shoulder offset) + soft follow-cam, plus a first-person
  toggle (`camFP`, key C / scroll all the way in; C in drone mode still
  toggles the auto-tour). FP hides the avatar every frame in
  `updatePlayerCam` — restore visibility when leaving player mode. Drone
  mode is the orbit/auto-tour rig. `IS_COARSE` (touch) disables pointer
  lock, shadows, and antialiasing and swaps in the floating joystick.
- **HUD**: desktop shows only chat + status + `?` + the SIM menu button;
  overlay/sim toggles live in the `#tray` popover and the touch action
  buttons (`#touchbtns`) render only on coarse pointers. New controls belong
  in the tutorial grid, the README table, the `#help` bar, AND usually the
  SIM tray.

## Conventions & gotchas

- Match the existing style: `var`, function statements, no modules, no
  transpiled syntax (the file must parse as-is in old-ish browsers).
- Keep user-visible strings ASCII-safe where they round-trip the server (the
  server strips non-printable/unicode from names and chat).
- Visual accuracy comes from Google 3D Tiles reference captures via
  `https://situation.lexingtonky.news/?screenshot=1&hires3d=1&lat=..&lon=..&alt=..&heading=..&pitch=..`
  — reference-and-redraw only; **never bake Google tile imagery into the repo**
  (ToS). Known naming trap: 300 W Vine is the Central Bank Tower (ex-"Kincaid
  Towers" — don't reintroduce that label).
- SEO/analytics surface area that must survive edits: GA4 gtag
  (`G-YP3SXMD9KK`) on all three pages, canonical/OG/JSON-LD in
  `web/index.html`, `robots.txt`, `sitemap.xml`, and the Search Console DNS
  TXT record in Route53. `web/privacy.html` promises "no accounts, minimal
  data, GA4 aggregate only" — don't add data collection that falsifies it.
- The tutorial modal (`#tut`) and legal pages are real product surface:
  new controls belong in the tutorial grid, the README table, and the
  `#help` bar together.
