# Modding LEXTOWN-01

So you want to build your own Lexington. Or your own city. Or a new mission, a
new radio station, a talking horse with opinions. Good news: LEXTOWN is MIT,
it's basically two files, there's no build step, and you can fork it and have
your own thing running by dinner.

This guide is written for two readers at once: a **human modder** poking at the
code, and an **AI coding agent** someone has pointed at the repo and told to
"mod whatever you want." If you're the agent, read [`CLAUDE.md`](CLAUDE.md) and
this whole file first, then jump to the [Brief for AI agents](#brief-for-ai-agents)
at the bottom for the compressed rules.

Every technical claim below was checked against the code. When something is
load-bearing (break-the-game important), it's called out. The recipes are
anchored to **function and section names**, not line numbers, because the two
big files move around a lot — search for the name, don't scroll to a number.

---

## 1. What you can mod

The whole game is:

- **`web/app.js`** — the entire client. One big IIFE: renderer, the city, cars,
  pedestrians, the avatar, the missions, the netcode, the HUD. Plain
  ES5-style JavaScript. No framework, no bundler.
- **`server.js`** — the whole backend. A static file host plus a WebSocket relay
  that referees multiplayer. One file, one dependency (`ws`).

That's the game. There's also `web/index.html` (the HUD + SEO), `bots/npcs.mjs`
(ambient chatter characters), `tools/gen-audio.mjs` (bakes the radio/voice MP3s),
and a `deploy/` folder for running it online. No database, no accounts, no build
tooling, no TypeScript. Textures are drawn on a `<canvas>` at boot — there are
no image assets to wrangle except `og.jpg`.

It's [MIT](LICENSE). Fork it, sell it, rename it, tear the city out and build
your own. A short taste of what "a mod" can be:

- **A new mission** — a heist, a delivery run, a scavenger hunt, with its own
  global leaderboard. (There are five shipped missions to copy from.)
- **A new landmark** — drop your building, your statue, your weird local
  monument into the skyline, walkable and labelled.
- **Your own neighborhood** — extend the street grid one block at a time until
  the map reaches your street.
- **A new radio station** — another dial position with its own music and DJ.
- **A new NPC persona** — a character who wanders downtown and has things to say.
- **A total conversion** — keep the engine, replace the city. LEXTOWN is
  Lexington; nothing stops it from being your town instead.

---

## 2. Run it locally in 60 seconds

You need [Node.js](https://nodejs.org/) 18 or newer. Then:

```bash
git clone https://github.com/paul-codes-1/lextown
cd lextown
npm install        # one dependency: ws
npm start          # http://localhost:8080  (HTTP + WebSocket on the same port)
```

Open **two** browser tabs at `http://localhost:8080/`. Two tabs is not optional:
this is a multiplayer game, and a whole class of bugs (movement relay,
interpolation, freeze tag, the chopper, score announces) only shows up with 2+
clients on the wire. Each tab is a separate player; you'll see one move in the
other in real time.

**No server at all?** Open `web/index.html` straight off disk (`file://`) or
host the `web/` folder on any static host. The client detects there's no relay
to talk to and falls back to single-player with three local bot walkers standing
in for peers. (Mechanically: the WebSocket bootstrap only connects for
`http(s)` origins or an explicit `#ws=`; on `file://` it never connects, `online`
stays false, and `runBots()` drives the stand-ins through the same pipeline a
real peer would use.)

### URL params (all on the hash, except `?v`)

Handy while modding and testing — every one of these is real, parsed in `app.js`:

| Param | Effect |
|---|---|
| `#name=YOURNAME` | Set your player name (else a random `LEX-###`). Sanitized to letters/digits/`-`/`_`, max 14, upper-cased. |
| `#h=13` | Start the day/night clock at that hour (0-23.99). Great for testing night materials — try `#h=22`. |
| `#x=..&z=..` | Deep-link your spawn point, e.g. `#x=200&z=100`. Clamped to the world bounds. |
| `#debug=1` | Exposes `window.__lt` in the console: `__lt.pos()`, `__lt.tp(x,z)`, `__lt.tpcar()`, `__lt.stage()`, `__lt.unlock()`, `__lt.radio()`, `__lt.tick()` (pump one frame in a hidden tab), and more. Your fastest way to jump around while building. |
| `#ws=<url>` | Point at a specific relay, e.g. `#ws=wss://your-host`. `#ws=1` means "same origin." Default is same-origin over http(s). |
| `#wp=0` | Force the objective waypoint off — the diamond marker, the on-street route ribbon, and the destination beacon. |
| `#cine=1` | **Cinematic capture:** chrome-free frame — no HUD, overlay, or captions, plus letterbox bars. Add `#debug=1` and drive scripted shots from the console via `window.__lt.cine`: `.shot({from,to,dur,ease})` (pose = `{x,y,z,ry,pitch}`, ry=yaw / pitch=tilt), `.orbit({x,z,r,y,degStart,degEnd,dur,lookY})`, `.follow({what:'car'\|'heli'\|'player',dist,height,dur})`, `.stop()`. Poll `__lt.cine.busy` to sequence moves; `.setBars(false)` drops the letterbox. |
| `#admin=<token>` | Auto-run `/admin <token>` on connect (see admin commands). |
| `?v=N` | A cache-bust query on the *page* URL. The game doesn't read it; it just changes the URL so a browser/CDN refetches `app.js`. The origin server already sends `no-cache` for `app.js`, so this mostly matters behind a CDN. |

### Environment knobs

Set these in the server's environment (or a systemd drop-in in prod):

- **`PORT`** — HTTP + WS port. Default `8080`.
- **`ADMIN_TOKEN`** — enables in-game admin (`/admin <token>` in chat) and the
  `GET /admin/stats?token=...` endpoint. If unset, admin is disabled and the
  stats endpoint 404s.
- **`NPC_TOKEN`** — a shared secret so the ambient-NPC process (`bots/npcs.mjs`)
  is tagged and kept out of the human player stats. If unset, NPCs still work,
  they just count as ordinary players. The NPC process reads `NPC_TOKEN` too,
  plus `LEXTOWN_WS` (which relay to join), `NPC_COUNT` (up to 6), and
  `NPC_AMBIENT_MS` (chatter cadence).

---

## 3. The 10-minute architecture tour

Two files own everything. Here's the shape.

### `web/app.js` is one IIFE, and the order of the top level matters

The client is a single `(function(){ ... })()` with sections in a fixed order,
each marked by an `// ---------- name ----------` comment. Roughly:

> renderer/scene -> street grid -> canvas texture helpers -> ground/streets ->
> block slabs + procedural buildings -> residential blocks -> landmarks ->
> UK campus -> Chevy Chase -> NoLi -> horse farms -> instanced houses ->
> street lights -> signals -> street signs -> cars -> pedestrians -> avatar ->
> identity -> local player -> darts -> chopper -> water cannon -> RPGs ->
> sound (synth) -> asset audio -> car radio -> missions 1-5 -> net layer ->
> chat -> diagnostics -> local bots -> day/night -> camera -> HUD -> tutorial ->
> overlay -> main loop.

**Top-level statement order is load-bearing.** The world-building sections
*push* into shared registries that must already be *declared* before the code
that fills them runs, and be fully filled before the code that *reads* them
runs. Concretely:

- The registries are plain arrays declared up top: `colliders` (with per-entry
  height `h`), `slabRects`, `labels`, `nightMats` (filled via `regNight`),
  `acPts`, `treePts`, `parkedPts`, `housePts`, `vehicles`, `pedStreets`.
- The landmark/mission sections push into them.
- Consumers run later — e.g. the instanced-house `InstancedMesh` builder must
  come *after* every `resBlock()` call, and a mission's overlay label push must
  come *after* its trigger constant is declared.

Get this wrong and you get a `ReferenceError` on load (the documented
"`vehicles`-before-init" crash class). **A clean browser console on load is the
gate** that says your statement order is right.

The registries a mod usually touches: `colliders` (make things solid /
landable), `labels` (name things on the HUD), `nightMats` (make windows light up
at night), `vehicles` (drivable things), `treePts` / `parkedPts` (instanced
props), `housePts` (instanced bungalows), `pedStreets` (where crowds and bots
walk).

### The one net pipeline

Everything remote flows through a single path:

```
server broadcast  ->  handleNet(m)  ->  remotes{}  ->  updateRemotes(dt)
```

`handleNet` is the *only* inbound message router (`welcome`, `state`, `chat`,
`correct`, `frozen`, `shot`, `heli`, `pushed`, `rocket`, `spray`, `scores`,
`sys`, `leave`). `netTick` sends your own state out at ~10 Hz. `updateRemotes`
renders other players through a ~160 ms interpolation buffer so motion is smooth.

**The offline bots ride this exact pipeline** — `runBots()` literally calls
`handleNet({t:'state', ...})` with synthetic packets. That's the load-bearing
consequence: **any multiplayer feature has to ride a relayed message to work.**
If your new toy just mutates local state, remote players won't see it and it
won't work at all offline. Add it as a message type: send it in `netTick` (or an
event handler), validate + rebroadcast it in `server.js`, handle it in
`handleNet`. (See [recipe (f)](#f-a-new-multiplayer-toy).)

### `server.js` is a plausibility cop, not a physics engine

The server never simulates the world. It relays messages and refuses obviously
impossible ones. Every message-type block has the same shape:

```
rate-limit  ->  validate (bounds / opt-in / who-are-you)  ->  broadcast
```

Movement gets a token-bucket speed check per declared mode (walk/jetpack/
drive/heli); out-of-bounds or too-fast states are dropped and the offender gets
a `{t:'correct'}` snap-back instead of a relay. Chat is ASCII-sanitized and
token-bucketed. Scores are range-checked per board. Because the mode flag is
client-declared, this bounds absurdity — it doesn't prove honesty, and it
doesn't try to.

### Two clocks, kept apart

Day/night runs on **`simH`** — a *scaled, pausable* clock (the `1`/`2`/`3` speed
keys and `P` pause drive it). Traffic, signals, missions, and everything
gameplay runs on **real time** (`performance.now()` / `dt`). **Don't couple
them** — if you tie a gameplay timer to `simH`, pausing the city or cranking the
day speed will warp your mission clock.

### The WORLD-bounds lockstep rule (the invisible-wall trap)

The client's map extents live in `app.js` as `X0`, `X1`, `Z0`, `Z1`. The
server's authoritative bounds live in `server.js` as `WORLD`. **These must move
together.** The rule: `WORLD` has to *cover* the client's clamp range, which is
the extents plus about 20-25 units of slack. There's a `KEEP IN SYNC` comment
right above `WORLD` spelling this out.

If you grow the map on the client but forget to grow `WORLD`, the server starts
move-rejecting anyone who walks past the *old* edge — they hit an invisible wall
and rubber-band. This is real; it has bitten this repo. Any time you touch
`X0/X1/Z0/Z1`, touch `WORLD` in the same commit.

### Headings wrap to ±pi

Before `netTick` sends your heading, it normalizes it with
`Math.atan2(Math.sin(ry), Math.cos(ry))`. The server bounds-checks `ry` to a
small range. If you send a raw heading that accumulates past ±2pi (easy to do
when a car or chopper keeps turning the same way), the server starts rejecting
*every* state packet. Keep any heading you put on the wire wrapped to ±pi.

---

## 4. Mod recipes

The heart of the guide. Each recipe names the section to read, the existing
thing to copy, the surfaces you must touch, and how to verify.

### (a) A new landmark or building

**Read:** the `// ---------- landmarks ----------` section.
**Copy:** the Big Blue build, `addTower(-127, 32, 34, 26, 128, 7, 'LEXINGTON FINANCIAL CENTER · BIG BLUE')`.

`addTower(x, z, w, d, h, variantIndex, name)` is the workhorse. In one call it:
adds the mesh, pushes a **`colliders`** entry *with height `h`* (so the jetpack
clears it and you can land a chopper on the roof), registers its facade as a
**night material** (windows that light up after dark), scatters rooftop AC, and
— if you pass a `name` — pushes a **`labels`** entry so it shows on the HUD.

Checklist:

1. Lay a ground slab under it: `slab(x0, z0, x1, z1)` (optionally a park/parking
   material). Add storefronts with `addStorefront(...)`, trees via
   `treePts.push([x, z])`.
2. Place the massing with one or more `addTower(...)` calls. The `variantIndex`
   picks a facade from the `VARIANTS` palette (brick, buff, limestone, glass...).
3. Want it landable / solid but it's *not* a tower? Push your own `colliders`
   entry with an `h`. Want lit windows on custom geometry? Wrap the material in
   `regNight(material, k)` — it auto-brightens with the night factor.
4. Name it: pass a `name` to `addTower`, or `labels.push({name:'YOUR THING', x, y, z})`.
5. Fancy crowns/spires/fountains go in a local `(function(){ ... })()` right
   after, exactly like First Presbyterian and the Big Blue crown do.

**Verify:** load with `#h=22` to check the windows light up; jetpack onto the
roof (or `#debug=1` then `__lt.tp(x,z)` nearby) to confirm the collider height;
toggle **LBL** to see the label.

### (b) A new street (growing the map)

**Read:** the `// ---------- street grid ----------` section.
**Copy:** the existing `EW` / `NS` table rows.

Streets are data. `EW` is the east-west streets (each `{name, z, dirs, ...}`),
`NS` is north-south. `dirs` encodes the real one-way directions
(`[1]`, `[-1]`, or `[1,-1]` for two-way). A street can carry a **partial extent**
(`x0`/`x1` on an EW row, `z0`/`z1` on an NS row) so it ends where it really ends
instead of slicing across the whole map.

Load-bearing rules:

- **`EW` must stay sorted north-to-south; `NS` west-to-east.** The block-fill
  loop pairs *consecutive* rows to find city blocks, so an out-of-order row
  makes malformed blocks.
- Intersections are computed by `meets(e, n)` and collected into `XINGS`. Every
  per-corner consumer (crosswalks, signals, street-name blades, lamps, lane
  stop-lines) iterates `XINGS`/`meets`, so a correctly-placed row lights up the
  whole city automatically. You usually don't touch those consumers — just the
  tables.
- **If your new street pushes past the current map extent, grow `X0/X1/Z0/Z1`
  AND `WORLD` in `server.js` in the same change** (see the lockstep rule above).
  This is the single easiest way to ship an invisible wall.
- Hand-built landmark blocks are listed in `SKIP` (keyed by
  `"<west NS name>|<north EW name>"`) so they don't get a procedural building
  dropped on them. If your new street reshapes a block you hand-built, keep
  `SKIP` in sync.

**Verify:** drive a car out to and *past* the old edge in the direction you
grew — no rubber-band, no invisible wall. Confirm signals and street-name blades
appear at the new intersections. Toggle **LBL** and check nothing overlaps.

### (c) A new mission

**Read:** the `// ---------- mission 5: DEADLINE ----------` section — it's the
freshest mission in the tree, and it lands every surface a mission needs.
**Copy:** Mission 5 end to end.

Missions run **entirely client-side**. Only the final time touches the server,
as a `{t:'score', ms, m}` submission. Here's the whole checklist, cross-checked
against how DEADLINE actually landed:

1. **Island layout (statement order!).** Declare your trigger + data as top-level
   `var`s *before* the mission-label `labels.push` block runs — DEADLINE declares
   `M5_TRIG`, `M5_CPS`, `M5_BUDGET`, `m5Best`, and the `mission5` state object,
   then builds its ring meshes in an `(function(){ ... })()`. Read your local
   best from `localStorage` (`lt_m5_best`) at declare time.
2. **Join `allIdle()`.** Add `&& mission5.stage === 'idle'` (use your mission's
   state). **This is the single easiest thing to forget** — miss it and two
   missions can run at once. It is a real, documented failure mode.
3. **Gold star label.** `labels.push({name:'★ MISSION: DEADLINE', x, y, z, col: MISSION_COL, mission:true})`.
   The `mission:true` flag hides it while any mission is running; `MISSION_COL`
   is the shared gold so mission UI is instantly distinct from player tags.
4. **`nextMissionHint()`.** Add your `if (!m5Best) return 'NEXT MISSION: ...'`
   branch so the onboarding hint chain points players at it.
5. **The `E` branch in `tryEnterExit()`.** Add
   `if (allIdle() && !player.veh && !isFrozen() && nearM5Trig()){ startMission5(); return; }`
   next to the other `nearMxTrig()` checks, and write the `nearM5Trig()` helper.
6. **The per-frame tick.** Write `updateMission5(dt)` (ticked from the main loop)
   as your state machine — DEADLINE runs `idle -> driving`, then `won -> post -> idle`
   on a win or straight `fail -> idle` on timeout.
   Show progress and the countdown through the HUD hint chain, timed off
   `performance.now()` and your budget constant (not `simH`).
7. **The leaderboard UI.** On win, call `showScores(ms, <boardNumber>)`;
   `renderScores` fills the matching `#scoreListN` list. Add that `<ol>` block
   (and its `<h2>`) to `web/index.html`.
8. **The server board.** In `server.js`: add your board id to `BOARDS`, to the
   `scores` init object, and to `topScores()`; add your mission number to the
   `{2:'m2', 3:'m3', 4:'m4', 5:'m5'}` map in the `score` block; and add a
   plausible-time `WIN` window (DEADLINE uses 30s-8min). Everything else
   (rate-limit, top-50 persist, top-10 broadcast, chat announce) is already
   board-generic.
9. **README + tutorial.** Add the mission blurb to the README mission list and a
   line to the `#tut` grid in `index.html`.

> **The numeric-`m` trap.** The score message uses a **number**:
> `ws.send(JSON.stringify({t:'score', ms: ..., m: 5}))` — *not* `m:'m5'`. The
> server maps it with `{2:'m2', 3:'m3', 4:'m4', 5:'m5'}[msg.m] || 'm1'`. If you
> send the string `'m5'`, it misses the map, falls through to `|| 'm1'`, and your
> mission's times land on the **ribbon-cutting** board. Send the number.

**Verify:** run the fast-forward `localStorage` recipe in
[`test/CHECKLIST.md`](test/CHECKLIST.md) to mark the earlier missions beaten, then
play yours start to finish in two tabs. Confirm: the star label shows and hides
correctly, `E` only starts it when everything's idle, the win submits, the
`#scoreListN` board and the chat announce both appear, and `lt_<id>_best`
persists across reload.

### (d) A new radio station

**Read:** the `// --- car radio ---` section (`RADIO_STATIONS`, `radioPick`,
`radioNext`).
**Copy:** an existing `RADIO_STATIONS` entry.

`RADIO_STATIONS` is an array; index `0` is `RADIO OFF`, and each real station is
`{name, ...}` with either a `music` + `breaks` pool or a `talk` pool. The pool
entries are **clip keys** that resolve to `web/audio/<key>.mp3`. Two ways to fill
a new station:

- **Reuse existing baked clips** — point your pools at clip keys that already
  exist in `web/audio/`. Zero new assets. Easiest start.
- **Bake new audio** — add your lines/voices to `tools/gen-audio.mjs` and run it
  (`ELEVENLABS_API_KEY=... node tools/gen-audio.mjs`). It calls ElevenLabs and
  writes MP3s into `web/audio/`; it's idempotent (`--force` to overwrite,
  `--only key1,key2` to bake a subset). **The game never calls ElevenLabs** — it
  only loads the baked static files, so keep your API key out of the repo.
- **Or skip assets entirely** — the `// ---------- sound (WebAudio, fully
  synthesized ...) ----------` section generates SFX with the WebAudio API (no
  files). If you want a synthesized jingle instead of a voice track, that's the
  place.

Checklist: add the entry to `RADIO_STATIONS`; make sure every clip key you
reference exists in `web/audio/` (or is synthesized); update the `R`-key radio
copy in the README controls table and the `#tut` grid if you rename the dial.

**Verify:** `#debug=1`, then `__lt.tpcar()` to hop into a car, press `R` to cycle
to your station, watch `__lt.radio()` in the console report it playing.

### (e) A new NPC persona

**Read:** `bots/npcs.mjs` (`PERSONAS`, `pickLine`, `maybeReply`, `ambient`).
**Copy:** an existing `PERSONAS` entry (BIG LEX, TOLLY HO, DEBBIE LFUCG...).

Each persona is `{n: 'NAME', c: 0xRRGGBB, lines: [...], replies: [...]}`. `lines`
are unprompted ambient one-liners; `replies` fire when a human addresses them.
Rules that keep them from being annoying:

- **Stay well under the server chat token bucket** (3-message burst, ~1 per
  1.2s refill). The bot process already self-throttles hard: a world-wide reply
  cooldown, a per-persona cooldown, and a slow ambient interval. Don't remove
  those — flooding trips the server's rate limit and your lines get dropped.
- **Keep lines printable ASCII, <=110 chars.** The server strips non-ASCII from
  chat, so a smart-quote or emoji will come out mangled.
- NPCs never reply to each other (their names are in a known set) — keep that
  invariant if you touch the reply logic.
- **Tag them with `NPC_TOKEN`** so they stay out of the human counters and cheat
  heuristics. The process appends it as `?npc=<token>` on the relay URL; the
  server compares it to its own `NPC_TOKEN` env and, on a match, marks the
  connection `npc:1` (visible in-world and in `/admin/stats`, excluded from
  `joins`/`peak`/human count). Same literal token must be set on *both* sides.

**Verify:** run the server with `NPC_TOKEN=x`, then
`LEXTOWN_WS=ws://localhost:8080 NPC_TOKEN=x node bots/npcs.mjs`. Watch your lines
appear in a browser tab's chat, spaced out; confirm
`curl "http://localhost:8080/admin/stats?token=<ADMIN_TOKEN>"` shows your persona
tagged `npc:1` and *not* counted in `humans`.

### (f) A new multiplayer toy

**Read:** the `shot` handling — client `fireDart`/`spawnDart`, the `shot` block
in `server.js`, and the `else if (m.t === 'shot')` branch in `handleNet`.
**Copy:** that triad. It's the smallest complete full-stack mod.

Anything that other players must *see* (a thrown snowball, a horn honk, a paint
splat) is three small pieces, and you need all three:

1. **Send** a cosmetic message from the client — e.g.
   `ws.send(JSON.stringify({t:'splat', ox, oy, oz, dx, dy, dz}))`.
2. **Referee** it in `server.js`: add a message block that rate-limits (copy the
   `shotTimes`/`sprayTimes` sliding-window pattern), validates with `num(v, lo, hi)`
   and any opt-in/pilot check, then `broadcast(...)` it to everyone but the
   sender.
3. **Receive** it in `handleNet`: add an `else if (m.t === 'splat')` branch that
   renders it for `m.id !== myId`.

Study how `shot` (PvP-gated, 4/s), `rocket` (2/s, anti-chopper), `spray` (pilot
only, 6/s), and `push` (pilot only, bounded impulse -> rebroadcast as `pushed`)
each fill that template with different validation. If you skip the server step,
nothing relays; if you skip the `handleNet` step, only you see it; if you do it
right, it also works offline because the local bots go through `handleNet` too.

**Verify:** two tabs. Trigger it in Tab A, see it in Tab B. Then hammer it and
confirm the server's rate limit kicks in (it silently stops relaying) rather than
letting one client spam everyone.

### (g) Reskin / textures

**Read:** the `// ---------- canvas texture helpers ----------` section
(`makeTex`, `asphaltBase`, `facadeVariant`, `storefrontVariant`) and the
`VARIANTS` / roof-material palette right after it.

There are **no image files** to swap (except `og.jpg`, the social-preview
thumbnail). Every road, facade, storefront, and sign texture is *drawn on a
`<canvas>` at boot* by a `draw(ctx, w, h)` callback passed to `makeTex`. To
reskin:

- Change the colors in `VARIANTS` (the facade palette), `AWNING_COLS`, the roof
  materials (`roofWhite`/`roofDark`/`roofGreen`), or the base colors in
  `asphaltBase` / the road-texture builders.
- For a different *look* (not just color), edit the `draw` callbacks — they're
  just 2D canvas drawing calls (`fillRect`, gradients, loops of windows).
- Want a surface to glow at night? Register its material with
  `regNight(material, k)`; the day/night loop scales its emissive by the night
  factor.

**Verify:** load at `#h=9` (daylight) and `#h=22` (night) and eyeball both. The
console must stay clean — a texture helper that reads a palette before it's
declared is the same statement-order trap as everything else.

---

## 5. Verify like the maintainers

There's no heavyweight CI; the loop is deliberately fast and manual.

1. **Syntax gate (always):**
   ```bash
   node --check web/app.js && node --check server.js
   ```
   This is the "did I leave a bracket open" check. Run it after every edit.

2. **Headless smoke test:**
   ```bash
   npm test        # == node test/smoke.mjs
   ```
   It boots `server.js` on a throwaway port, drives two-then-three real `ws`
   clients through the relay, and asserts the welcome handshake, state + chat
   relay, a valid *and* a rejected leaderboard score, NPC tagging in
   `/admin/stats`, and out-of-bounds move correction. It snapshots and restores
   the real `scores.json` so running it is safe. If your mod adds a message type,
   add a check here.

3. **The clean-console load = the statement-order gate.** Open the game with the
   DevTools console up. A `ReferenceError` on load almost always means a registry
   got read before it was declared/filled. No red = order's good.

4. **The two-tab rule.** Open two tabs on localhost and actually exercise the
   feature. Multiplayer, interpolation, and relay bugs are invisible with one
   client.

5. **Manual pass:** [`test/CHECKLIST.md`](test/CHECKLIST.md) is the maintainers'
   hand-QA template (with a `localStorage` reset/fast-forward recipe for jumping
   between mission states). Copy its style for your own feature.

---

## 6. Run it online (self-host)

Any small VPS with Node 18+ (a $5 box is plenty — the server is a static file
host plus a JSON relay, no database). The shipped setup is one Ubuntu box with
**systemd** keeping the process up and **Caddy** terminating TLS.

The short version (full runbook in [`deploy/SETUP.md`](deploy/SETUP.md)):

```bash
sudo git clone https://github.com/<you>/lextown /opt/lextown
cd /opt/lextown && sudo npm ci --omit=dev
sudo cp deploy/lextown.service /etc/systemd/system/     # templates in deploy/
sudo systemctl daemon-reload && sudo systemctl enable --now lextown
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile           # reverse_proxy 127.0.0.1:8080
sudo systemctl reload caddy
```

Point a DNS `A` record at the box. Caddy gets a Let's Encrypt cert automatically;
the client then connects over `wss://` on its own (it derives the relay URL from
the page origin — no client config needed). WebSockets need no special proxy
config in Caddy.

- **Secrets go in systemd drop-ins, never the repo.** `PORT`, `ADMIN_TOKEN`, and
  `NPC_TOKEN` live in `/etc/systemd/system/lextown.service.d/*.conf` on the box.
  For ambient NPCs, install `deploy/lextown-npcs.service` and put the *same*
  `NPC_TOKEN` literal in both units' drop-ins (systemd `Environment=` lines
  don't expand a variable from another unit — see the SETUP note).
- **State lives on the box, gitignored:** `bans.json`, `scores.json`, and
  `logs/` are written next to the code and never committed.
- **Deploy = push + pull + restart:**
  ```bash
  cd /opt/lextown && sudo git pull && sudo systemctl restart lextown
  ```
  Restarting mid-session is safe: connected players briefly drop to LOCAL-SIM and
  the client auto-reconnects with backoff (2s -> 30s cap), re-syncing on the
  welcome handshake. Only the leaderboards persist a restart; there's no world
  state to lose.

**The zero-server option.** You don't have to run a relay at all:

- **Static + a relay elsewhere:** host the `web/` folder on any static host/CDN
  and point it at a relay with `#ws=wss://your-relay`.
- **Fully offline:** serve (or open) `web/` with no relay reachable and the
  client runs single-player with local bots. Good for a kiosk, a demo, or a fork
  that's purely single-player.

---

## 7. House rules for forks

MIT means go wild. Five things to get right anyway:

1. **Never bake Google 3D Tiles imagery into a repo.** The city was hand-drawn
   from *reference captures* of Google's photoreal tiles (via the
   `situation.lexingtonky.news` screenshot rig) — reference-and-redraw only.
   Redrawing what you see is fine; committing the tile imagery itself violates
   Google's ToS. Keep it that way in your fork.
2. **If you keep the privacy page, keep it true.** `web/privacy.html` promises no
   accounts, minimal data, and that **chat is never stored** (the server logs
   volume and operational events only, never message content). Don't add data
   collection that falsifies it — or rewrite the page to match what your fork
   actually does.
3. **Swap or remove the SEO/analytics.** The GA4 tag (`G-YP3SXMD9KK`), the
   JSON-LD block, and the canonical/OpenGraph URLs in `web/index.html` (and the
   GA tag on `privacy.html`/`terms.html`) all point at the original. Replace them
   with your own or strip them out — don't ship traffic to someone else's
   analytics.
4. **Rename your public instance.** `playlextown.com` is the original; the title,
   canonical URL, and structured data all name it. Give your fork its own name so
   the two don't fight over identity in search or confuse players.
5. **Lock down admin.** Set a strong `ADMIN_TOKEN`. Know the chat commands
   (`/admin <token>`, then `/list`, `/kick`, `/ban`, `/unban`, `/unfreeze`,
   `/announce`, `/stats`) and the live counters at
   `GET /admin/stats?token=<ADMIN_TOKEN>`. With no token set, admin is disabled
   and the stats endpoint 404s — which is a fine default, but means you have no
   moderation until you set one.

---

## Brief for AI agents

Hand this block, plus the repo, to any coding agent you want to mod LEXTOWN.

```
You are modding LEXTOWN-01, an MIT browser game. Two files carry everything:
web/app.js (the whole client, one IIFE) and server.js (static host + WebSocket
relay). No build step, no database.

FIRST: read CLAUDE.md and MODDING.md in full. The mod recipes in MODDING.md
(landmark, street, mission, radio, NPC, multiplayer toy, reskin) are
authoritative — follow the one that matches the task literally, including its
"surfaces to touch" checklist.

STYLE CONTRACT (match it exactly):
- ES5-style JS: var and function statements. No ES modules, no arrow-only
  rewrites, no TypeScript, no transpiled syntax. It must parse as-is.
- No new dependencies. The server stays ws-only. No build tooling.
- Textures are drawn on canvas at boot; there are NO image assets. Don't add any.
- Three.js is r147 UMD (window.THREE). examples/jsm addons are NOT available.
- User-visible strings that round-trip the server stay printable ASCII (the
  server strips non-ASCII from names and chat).

THE FIVE GOTCHAS THAT ACTUALLY BREAK THINGS:
1. Statement order in app.js is load-bearing. Declare registries/constants
   before the code that fills them; fill them before the code that reads them.
   A ReferenceError on load means you got this wrong.
2. WORLD lockstep. If you change X0/X1/Z0/Z1 in app.js, change WORLD in
   server.js in the same edit (WORLD must cover the extents + ~25 slack), or
   players hit an invisible wall at the old edge.
3. allIdle() membership. Every new mission must add its idle check to allIdle()
   or two missions can run at once.
4. Ride the net pipeline or it desyncs. Anything other players must see needs a
   relayed message: send in netTick/handler, validate+broadcast in server.js,
   render in handleNet. Local-only state won't sync and won't work offline.
5. Wrap headings to +/-pi before putting them on the wire (atan2(sin,cos)), or
   the server rejects every state packet once a heading accumulates.

MISSION SCORE TRAP: submit {t:'score', ms, m:<number>} with a NUMBER, not the
string 'm5'. The server maps {2:'m2',3:'m3',4:'m4',5:'m5'}[m] || 'm1'.

GATES BEFORE YOU CLAIM DONE:
- node --check web/app.js && node --check server.js   (must pass)
- npm test                                            (headless ws smoke; must pass)
- Load http://localhost:8080 in TWO tabs with the console open: no errors, and
  the feature actually works with 2 clients.
```
