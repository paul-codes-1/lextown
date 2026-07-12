# PHASE 4 — THE COMEBACK RELEASE

Phase 2 made the city remember you. Phase 3 gave you a postcard. Phase 4 is
about the *return trip*: a bus you can catch, a challenge that's different
every day, and a scooter for the distance between everything else. All three
are reasons to come back tomorrow.

Constraints that bind every feature (same as Phases 1–3):

- `web/app.js` is ES5: `var`, function statements, no arrows / `let` /
  `const` / template literals / spread. `server.js` is modern Node.
- Top-level statement order in app.js matters — registries (`colliders`,
  `labels`, `vehicles`, …) before the sections that fill them.
- Gate: `node --check web/app.js && node --check server.js && node
  test/smoke.mjs` must pass at every commit.
- New controls go in FOUR places together: tutorial grid (`index.html #tut`),
  `#help` bar, README controls table, `test/CHECKLIST.md`.
- localStorage access always `try/catch`-wrapped.
- User-visible strings ASCII-safe when they round-trip the server.
- Never log chat content. No new data collection (privacy.html promise).

---

## F1 — RIDE THE BUS

**One-liner:** a LexTran bus loops downtown on a real schedule. Wait at a
stop, doors open, press E, ride. Every player sees the same bus in the same
place — with zero new network protocol.

### The determinism trick
The bus position is a pure function of wall-clock time, same as weather
(`wxRand`, app.js ~3271). Build a piecewise timeline at boot:
segments (constant speed 8.5 m/s along the route polyline) and dwells
(14 s stopped at each stop, doors open). `busStateAt(tMs)` maps
`tMs mod PERIOD` → `{x, z, th, stopIdx, doorOpen, nextStopIdx, etaMs}`.
Every client computes it from `Date.now()`, so the bus is bit-identical
everywhere (private rooms included) and survives reloads mid-route.
No server changes at all.

### Route (legal per the EW/NS one-way tables, app.js:51)
Counter-clockwise downtown loop, driving in the correct lane offset
(match how ambient `lane` traffic offsets from street centerline):

1. **MAIN ST eastbound** (z=0, dirs `[1]`) from Broadway (x=-200) to MLK (x=200)
2. **MLK BLVD southbound** (two-way) z=0 → z=100
3. **VINE ST westbound** (z=100, dirs `[-1]`) x=200 → x=-200
4. **BROADWAY northbound** (two-way) z=100 → z=0

Corners get 2–3 interpolated points so the bus arcs the turn instead of
pivoting. Heading `th` from segment direction, lerped through corners.

### Stops (4, curb side of travel direction, real-Lexington names)
- **VICTORIAN SQUARE** — Main St just east of Broadway
- **PHOENIX PARK** — Main St just west of Limestone
- **LIBRARY** — Vine St westbound near MLK/Rose end
- **TRANSIT CENTER** — Vine St near Mill (real LexTran hub is 220 W Vine)

Each stop gets: a small shelter mesh (post + roof + bench, canvas-textured
sign "LEXTOWN TRANSIT — <NAME>"), a `colliders` entry with `h`, and a
`labels` push (`'BUS — <NAME>'`, ambient color, NOT mission gold).

### The bus itself
Box-geometry bus (~11 × 2.6 × 3 m), LexTran-ish teal/green canvas livery,
"THE LOOP" head sign, 4 wheels, interior floor. Added to `scene` directly —
NOT in `vehicles` (it can't be driven, only ridden). No moving collider
(ambient cars don't collide with the player either). Doors "open" =
doorOpen flag from timeline; render a lit door strip when open.

### Riding
- Board: on foot, `doorOpen` true, within 6 m of the door point →
  `tryEnterExit` (E / touch bCar) sets `player.bus = seatIdx`. Insert the
  bus branch in the tryEnterExit chain right after the `player.ride` hop-out
  (bus hop-out first, then mission gates — mirror `player.ride` exactly).
- While riding: each frame the player's x/z/y mirror the deterministic seat
  position (bus floor + seat offset); avatar visible, seated at-rest pose;
  camera follows like ride-shotgun (`updateRideAlong` pattern, app.js ~5539).
  Caption: `'THE LOOP — NEXT: <STOP> · E — HOP OUT'`.
- Net: send `m: 4` (passenger) — the server cap (h:38) already covers 8.5 m/s,
  and remote clients' unbound-m:4 fallback (app.js:5700) renders them at
  their netted position. **Improvement:** in the `r.m === 4` remote branch,
  when `ridePairs[id]` is empty AND the netted position is within 4.5 m of
  the locally computed bus, snap-render them into a deterministic bus seat
  (seat index = simple hash of id) so they don't trail 1.4 m out the back
  of a moving bus.
- Exit: E anywhere (bus is slow) → drop at curb side, `groundY` placement,
  `collide()` settle. Also auto-audit: every site that checks
  `player.ride` / `player.veh` / `inCar()` (pvp target gate, fireDart,
  freeze, mission gates, seat pose write at ~5270, netTick mode pick ~5789)
  must treat `player.bus` like `player.ride`. Extend `inCar()` to include
  the bus so the radio works on board (R — it's a bus with a radio).

### Waiting UX
Within 25 m of a stop (on foot, no mission running): DOM status line shows
`'BUS IN 0:42 — <NAME>'`, or `'DOORS OPEN — E TO BOARD'` while dwelling
there. Countdown straight from the timeline — it is never wrong.

### Surfaces
Tutorial grid row (E — RIDE THE BUS), #help bar, README table +
feature blurb, CHECKLIST entries (board / ride past 2+ stops / exit /
remote rider renders in seat / radio on bus / countdown accuracy).

### Telemetry
`{t:'mev', k}` enum 60–69: 60 boarded, 61 exited, 62 rode a full loop.

---

## F2 — DAILY DASH (daily challenge)

**One-liner:** one rotating checkpoint route a day, its own leaderboard,
resets at midnight. Same course for everyone — argue about it in chat.

### Day seed (shared client + server, EST-anchored)
`function dayIndex(){ return Math.floor((Date.now() - 5*3600e3) / 86400e3); }`
Fixed UTC-5 anchor (no tz lib, no DST drama): resets 1 a.m. Lexington summer
/ midnight winter. Client and server MUST use the identical formula.

### Course generation (client)
Pool of ~12 named checkpoint landmarks spread across the whole map (harvest
coords from existing labels/landmarks: courthouse, Rupp, Transit Center,
Phoenix Park, Thoroughbred Park, Kroger Field, UK campus, Ashland, Distillery
District, Loudon/north side, Chevy Chase, water tower…). Seeded
Fisher–Yates over the pool with `wxRand(dayIndex() * 40503 + i)`-style
draws → first **5** in order are today's route. Deterministic: every client,
same day, same course.

### The run
- Start ring: fixed spot downtown (courthouse plaza on Main — pick clear
  ground, verify with groundY/colliders). Gold `★ DAILY: THE DASH` label +
  ring, joins the standard gates: `allIdle()` must include
  `missionD.stage === 'idle'`; start via the tryEnterExit chain (on foot).
- Mission island `missionD` (state obj + start/update/cleanup) exactly per
  MODDING.md. Checkpoints render like DEADLINE's (m5) rings; route ribbon /
  edge arrow via the existing `missionTarget()` plumbing.
- **Any locomotion allowed** — run, drive, jetpack, scooter, even the bus.
  That's the fun: the route decides the optimal mix.
- Finish → `{t:'score', m: 10, ms}` to the server (suppressed in private
  rooms client-side, same as other boards). Device best:
  `lt_dailyBest = {day, ms}` (try/catch), only submitted-best per day shown.

### Server (server.js) — the six-edit recipe, daily variant
1. Storage: `scores.d = []` array + `scores.dDay = 0` int, BOTH seeded in
   the literal (fresh-box crash lesson) and explicitly loaded (the
   `BOARDS.forEach` loader won't pick them up — add explicit lines).
2. `rollDaily()`: if `scores.dDay !== dayIndex()` → `scores.d = []`,
   `scores.dDay = dayIndex()`, `saveScores()`. Call it lazily at the top of
   score handling AND topScores().
3. Board map: `10: 'd'` in the score handler's `{2:'m2',…}[msg.m]` map.
4. WIN window `d: [20000, 900000]`.
5. Announce line: `` `${n} won the DAILY DASH in ${sec}s` ``.
6. `topScores()` returns `d: top('d'), dDay: scores.dDay` (old clients
   ignore unknown keys — additive-safe).
Private-room early-return already covers m:10 (it's before the map). Keep
the 15 s per-client score rate limit as-is.

### Scores modal + hint chain
- New DAILY section at the TOP of the scores modal: today's top-10
  (`fill('scoreListD', m.d || [])`) + `'NEW ROUTE IN 4H 12M'` countdown
  (client-computed from dayIndex boundary) + device best.
- `nextMissionName()`: after the m9 line, if all mission bests exist and
  `lt_dailyBest.day !== dayIndex()` return `'THE DASH'`; hint suffix map
  entry: `'THE DASH': 'GOLD RING AT THE COURTHOUSE — NEW ROUTE DAILY'`.
- `missionTarget()` + `currentObjective()` entries for missionD (next
  unvisited checkpoint, `'CHECKPOINT i/5'`).

### Telemetry
mev 40–49: 40 started, 41 checkpoint, 42 finished, 43 abandoned.

### Smoke tests (server side, mirror existing harness patterns)
- m:10 score lands on the `d` board and comes back in topScores with dDay.
- m:10 outside WIN window rejected; from private room dropped.
- Day roll: fake `scores.dDay` to yesterday, submit → board reset first.

---

## F3 — SCOOTER SHARE

**One-liner:** kick-scooters racked around downtown. E to grab one, ride at
double walk speed, drop it anywhere. The missing rung between walking and
driving.

### Placement
~4 racks × 2 scooters (8 total), fixed points on wide sidewalk/plaza spots:
Transit Center, courthouse plaza, Triangle Park, UK campus edge. Verify each
against colliders/groundY. Small rack mesh + `labels` push (`'SCOOTERS'`).

### The scooter
Simple mesh: deck + stem + handlebar + 2 small wheels, bright rental-green
canvas accent. Local objects in a `scooters` array `{g, x, z, th, taken}` —
NOT in `vehicles` (different physics, avatar stays visible). Scooters are
LOCAL-ONLY (each client its own set, like ambient traffic) — v1, noted in
README honestly. Riders themselves ARE synced (below).

### Riding
- Mount: on foot, within 2.2 m, `tryEnterExit` chain (after bus branch,
  before car-enter) → `player.scoot = s`; avatar stays VISIBLE, standing
  pose, hands forward on the bars (arms ~-1.1 rad), no walk swing.
- Physics (`updateScoot(dt)` mirroring `updateDrive` shape): accel 8 m/s²,
  max 9.5 m/s, brake/reverse to -2, steering `1.9 * dt` factor scaled by
  speed like the car but livelier at low speed; `collide(p, 0.6, y)` with
  crunch slowdown; grounded only (no jump while mounted); works on grass.
- Dismount: E → scooter parks at the drop spot (`taken = false`,
  re-mountable), player steps off to the side.
- Frozen (freeze-tag) while riding: inputs zeroed, same as drive.

### Net: new mode m:5
- `netTick` sends `m: 5` when `player.scoot`.
- **server.js**: `CAPS[5] = { h: 13, v: 12 }` (9.5 max + jitter slack).
  Without this the server rewrites m:5 → 0 AND caps at walk speed —
  riders would rubber-band. One line, plus a smoke check that m:5 state
  packets at 9.5 m/s survive where walk-cap would reject.
- Remote render: new `r.m === 5` branch in `updateRemotes` — standing
  avatar, no swing, plus a shared `buildRemoteScooter()` mesh positioned
  under them (cache on `r.scootG` like `r.carG`; hide in every other
  branch that hides carG). Stale-cache clients see m:5 in the walk
  fallback (slides standing) — acceptable, self-heals on reload.
- Audit the same `player.ride`-style sites as the bus: pvp/fireDart (allow
  firing from a scooter? NO — two hands on the bars, same rule as driving),
  mission start gates (must dismount first), seat-pose write, `inCar()`
  (scooter is NOT inCar — no radio, wind is the radio).

### Surfaces
Tutorial row (E — GRAB A SCOOTER), #help, README, CHECKLIST (mount / speed
vs walk / crunch / dismount-remount / remote rider shows scooter / no
firing while mounted / DAILY DASH rideable on one).

---

## Build order & ownership (no two agents in one file at once)

| Wave | Feature | Files owned |
|------|---------|-------------|
| 1a | F1 bus | `web/app.js`, `web/index.html`, `README.md`, `test/CHECKLIST.md` |
| 1b | F2 daily — server half | `server.js`, `test/smoke.mjs` |
| 2 | F2 daily — client half | `web/app.js`, `web/index.html`, `README.md`, `test/CHECKLIST.md` |
| 3 | F3 scooter | `web/app.js`, `server.js` (CAPS line), `web/index.html`, `README.md`, `test/smoke.mjs`, `test/CHECKLIST.md` |

Commits: one per feature (bus → daily → scooter), team lead commits.
Verification gate + adversarial review before each commit.
