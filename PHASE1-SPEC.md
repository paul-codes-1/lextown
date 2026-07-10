# LEXTOWN-01 — Phase 1 Build Spec ("The First-Minute Release")

Scope for one session, three devs. Four features, sized to roughly one
mission-sized island plus two smaller systems plus two micro-fixes. The whole
release exists to move the **48-second median session** — everything is
retention-first.

Ground rules that bind all four (from CLAUDE.md, do not violate):
- ES5 style only: `var`, function statements, no modules/arrow-only/transpiled
  syntax. No new dependencies (server stays `ws`-only). Textures stay
  canvas-generated; no image assets.
- User-visible strings that round-trip the server stay printable ASCII.
- The privacy promise (`web/privacy.html`) is load-bearing: no accounts, no new
  data collection, chat never stored/logged. Nothing here may falsify it.
- No map growth this phase. If any feature ever needed to extend the world
  bounds, `WORLD` in `server.js` must move in lockstep with `X0/X1/Z0/Z1` in
  `app.js` — but nothing in Phase 1 does, and that's deliberate.
- Verification is the standing one: `node --check web/app.js && node --check
  server.js`, then two browser tabs against localhost exercising the feature.

### Work split at a glance
| Feature | Primary file(s) | Suggested dev |
|---|---|---|
| F1 Onboarding + Objective Waypoint | `web/app.js`, `web/index.html`, `README.md` | Client dev A |
| F2 Mission 5: DEADLINE | `web/app.js` (island), `server.js` (board), `web/index.html`, `README.md` | Mission dev B |
| F3 Ambient NPCs in production | `bots/npcs.mjs`, `server.js` (light), deploy/systemd | Server/ops dev C |
| F4 m4 discoverability + pointer guard | `web/app.js` | Whoever finishes first (A) |

F2's server board (`m5`) is a ~15-line addition to `server.js` that dev C should
own alongside F3 so B stays entirely in `app.js`/`index.html`.

---

## F1 — First-90-Seconds Onboarding + Objective Waypoint

**The problem, mechanically.** Spawn is `x:14, z:-9.5`. The first mission ring
(`MISSION_TRIG x:146, z:14`) is ~130 m east — almost always off-screen at spawn.
`drawOverlay`'s label loop bails on off-screen markers (`if (!lp) continue;`,
~app.js:5155), so the only guidance a new player gets is a one-time Dispatch
caption and a line of hint text. Most of them never see the ring. This is the
48-second gap.

### User story
As a first-time player, the moment I close the tutorial I can see exactly where
to go, how far it is, and that arriving is the point — so I start a mission
instead of wandering off.

### UX flow
1. On first-ever load, the tutorial auto-opens (already true). On close
   (`tutClose`), the existing Dispatch line fires (already true) **and** the
   objective waypoint turns on.
2. A persistent **objective marker** renders on the overlay canvas pointing at
   the current objective (see "current objective" below):
   - **On-screen:** a gold diamond at the projected objective position with a
     small label + distance in meters (e.g. `RIBBON CUTTING · 128m`).
   - **Off-screen or behind camera:** the marker clamps to the screen edge as an
     arrow pointing toward the objective, still showing distance.
3. A one-line **objective banner** ("OBJECTIVE — THE RIBBON CUTTING") sits under
   the top HUD for the first session; it fades out permanently once the player
   first comes within ~15 m of the objective (the existing `E — START MISSION`
   hint takes over from there). Banner is first-session-only; the edge marker is
   persistent (see toggle).
4. When the player reaches the ring, the marker gives one arrival pulse and the
   existing start-mission hint/flow is unchanged.
5. As the player completes missions, the marker automatically retargets to the
   next incomplete one (ribbon cutting → City Hall door → data center → horses →
   deadline). When all are beaten, the marker turns itself off.

### "Current objective" helper
Add `currentObjective()` returning `{x, y, z, label}` for the next incomplete
mission, mirroring the exact progression logic already in `nextMissionHint()`
(app.js:3865): `!heliUnlocked` → `MISSION_TRIG`; else `!m2Best` → `DOOR_P`; else
`!m3Best` → `M3_TRIG`; else `!m4Best` → `M4_TRIG`; else `!m5Best` → `M5_TRIG`
(F2's new trigger); else `null`. During an active mission (`!allIdle()`), the
waypoint hides and defers to the mission's own `drawMissionTarget()` overlay,
which already handles live objectives.

### Controls / HUD surfaces touched
The waypoint is a HUD element, not a new key-control, so the full 4-surface
control rule doesn't fully apply — but touch these:
- **SIM tray (`#tray`):** add a `WAYPT` toggle (default on) so power users can
  hide it, persisted to `localStorage` (`lt_waypt`), same pattern as the
  existing `box`/`lbl` toggles in `show`.
- **README.md:** one line in the HUD section describing the objective marker.
- **Tutorial grid (`#tut`):** one line ("A gold marker always points to your
  next mission").
- No `#help` bar entry needed (it's not a keypress).
- Optional URL param `?wp=0` to force-off, matching the existing `#`-param style.

### Multiplayer behavior
None. This is a pure client-side overlay reading local mission progress. Nothing
relays through `handleNet`. Works identically online, offline, and bots-only.

### Edge cases
- **Behind-camera targets:** `project()` returns null when the point is behind
  the camera — the edge-arrow direction must be computed from the
  camera-relative bearing (angle between camera forward and the target vector in
  world space, mapped to a screen-edge position), **not** from a null projected
  point. This is the one non-trivial bit of math.
- **Touch users:** overlay renders identically; keep the marker clear of the
  virtual stick zone (left 40% of screen) and the touch button rail.
- **Drone/first-person camera:** marker still works (it's world-space
  projected); just ensure it hides during an active mission regardless of
  camera mode.
- **Returning players** (localStorage shows progress): no banner, but the
  marker still points at their next unbeaten mission.
- **All missions beaten:** `currentObjective()` returns null → marker off, no
  empty arrow.

### Non-goals
- No minimap. No pathfinding line/route. No turn-by-turn. Just a bearing +
  range.
- No new data collection or server round-trips.
- No change to how missions start or score.

---

## F2 — Mission 5: "DEADLINE" (checkpoint drive race)

**Why this mission.** The car system (100 stealable cars, real one-way pairs,
working signals, four radio stations) is the most-simulated, least-used-in-a-
mission part of the game. m1–m4 are on-foot/photo/wrangle; none is a driving
challenge. DEADLINE turns the existing grid into content with almost no new
tech, and it's on-brand: the game is built by The Lexington Times, and NEWS 630
THE BLOCK is already a radio station in every car.

### User story
As a player who just unlocked the city, I steal the news car and race a
deadline — hitting checkpoints across downtown against the clock — and my best
time lands on a global board.

### Premise / UX flow
1. A gold ★ start ring (`M5_TRIG`) sits at a sensible downtown spot (proposed:
   the NEWS 630 "newsroom" near City Center / Main). Reachable on foot; visible
   via F1's waypoint once m4 is beaten.
2. `E` at the ring (only when `allIdle()`): Dispatch/anchor VO — "The Block
   needs art for the six o'clock. Grab the news car out front and get me these
   five shots before we go to air." Mission state → `driving`.
3. A sequence of ~5–6 **checkpoint rings** light up on real downtown corners
   (e.g. courthouse on Cheapside, Rupp/City Center, Thoroughbred Park, Al's Bar
   at Sixth & Lime, the UK quad edge, 21c). Only the **current** checkpoint is
   lit; the next lights on arrival. A countdown timer runs (proposed budget
   ~150–210 s, tuned in playtest).
4. Player must be **in a car** to bank a checkpoint (drive the ring). On foot,
   the ring shows but doesn't count — reinforces "this is a driving mission."
5. Hit all checkpoints before the clock → win, final `ms` submits to the `m5`
   board, chat announcement fires (existing mechanism). Miss the clock → fail
   caption, mission resets to `idle`, no submit.
6. Fully replayable, like every other mission. Local best in
   `localStorage lt_m5_best`; `m5Best` variable gates F1's waypoint progression.

### Controls / HUD surfaces
No new key-control — reuses `E` enter/exit car and `W/S/A/D` driving that
already exist, so the tutorial/README/#help control tables don't need a new
row. But the **mission-integration surfaces** all must land together (this is
the "5 small edits to shared surfaces" pattern from mission 1):
- `allIdle()` (app.js:3847): add `&& mission5.stage === 'idle'`.
- Gold ★ overlay label: push a `labels` entry for `★ MISSION: DEADLINE` at
  `M5_TRIG` with `mission:true` (hides during any active mission), next to the
  existing four (app.js:3860–3863).
- `nextMissionHint()` (app.js:3865): add the `!m5Best` branch.
- `frameStep` hint chain (app.js:~5247–5273): add branches for the `driving`
  stage (show `checkpoints X/N · time left`) and the near-`M5_TRIG` start hint,
  plus wire `E` handling next to the other `nearMxTrig()` checks
  (app.js:3983–3999).
- `web/index.html`: add an `m5` `#scoreList` block + WIN window; `renderScores`
  and the `{t:'scores'}` handler must render the `m5` top-10.
- `README.md`: add the Mission 5 blurb to the mission list.

### Server (`server.js`) changes
- Add `'m5'` to `BOARDS` (server.js:151) and to the `scores` init object and
  `topScores()` (server.js:152, 164). The array-migration branch is unaffected.
- Add an `m5` range to the per-board score validation (mirror the m1/m2 bounds;
  proposed `30s–8min`). Everything else (rate-limit, top-50 persist, top-10
  broadcast, chat announce) is already board-generic.

### Multiplayer behavior
- The mission runs **entirely client-side**, like m1–m4. Checkpoint rings are
  local objects, never relayed. Only the final `{t:'score', m:'m5', ms}`
  touches the server → validated per board → `scores.json` → `{t:'scores'}`
  broadcast.
- Other players simply see you driving via the existing remote-car render
  (`m:2` → `buildRemoteCar`, app.js:4366). No new `handleNet` message type.

### Edge cases
- **Touch users:** drive with the existing E-VEH button + virtual stick; no new
  input.
- **Offline / bots-only:** mission fully playable; score submit no-ops when
  offline (already how scoring works); local best still saved to localStorage.
- **Mid-session joiners:** unaffected — they see your car, not your mission.
- **Player exits the car mid-race / car gets destroyed:** allow re-entering any
  car to continue; the timer keeps running (don't pause on foot). If they walk
  away entirely, the timer expiring fails the mission cleanly.
- **Checkpoint placement:** every checkpoint must sit on drivable roadway
  inside current `WORLD` bounds and be reachable respecting one-way streets —
  verify by actually driving the route in playtest, not just by coordinates.
- **Concurrent mission guard:** `allIdle()` must include `mission5` or two
  missions can run at once (the documented failure mode).

### Non-goals
- **No co-op / shared race** this phase (no relayed checkpoints, no
  head-to-head). Racing is against the clock and the leaderboard only.
- No `takePhoto` requirement — keep it a pure drive race; photo-op flavor is a
  NEXT idea, not Phase 1 scope.
- No new vehicle type, no map growth, no new radio content.

---

## F3 — Ambient NPCs in Production

**The problem.** `bots/npcs.mjs` (the six-persona chatter process) exists but
is not wired into the prod deploy, and at a 48-second median session most
sessions are near-solo — so the chat log and the streets read as empty even
though the city was designed to feel inhabited.

### User story
As a player who joins when few humans are online, the city still feels alive —
there's Lexington small-talk in the chat and a couple of people moving near
me — so it doesn't feel like a ghost town I should leave.

### Behavior
- Run `bots/npcs.mjs` as a managed process alongside the server (systemd unit
  or supervised child) that connects to the relay as ordinary WS clients and
  emits chat from the **preset line pools only**. The Haiku/AI hook **stays
  suspended** (cost + the current suspended state) — that's an explicit
  non-goal.
- **Stretch (same feature, if time):** 2–3 of the personas also send `state`
  packets so they appear as walking avatars near spawn, riding the exact same
  `handleNet → remotes → updateRemotes` pipeline every remote uses. If time is
  tight, chat-only is the acceptable minimum.
- Personas throttle themselves well under the server's chat token bucket
  (3-burst, ~1/1.2s refill) so they never trip rate-limiting or crowd out
  humans.

### Multiplayer / architecture
- NPCs are WS clients; their chat and (optional) movement flow through the same
  relay path as any player — nothing new server-side except making them
  **immune to accidental moderation** and **uncounted where it matters**:
  - Don't let them consume ban/kick slots or trip cheat heuristics: connect
    from localhost and/or tag them so `logEvent`/cheat-suspect logging ignores
    them.
  - Decide whether they count toward the public player count — recommend
    **not** counting them in `peerCount()`/stats so telemetry stays honest, but
    showing them in-world. Document the choice.
- The privacy promise is intact: they *generate* chat, which is broadcast and
  never stored — same as human chat.

### Controls / HUD surfaces
None. No client control changes.

### Edge cases
- **They must degrade gracefully:** if the NPC process dies, the game is
  unaffected (it's just fewer chatters). No hard dependency.
- **Determinism near spawn:** if doing the walking-avatar stretch, bias 1–2
  persona spawn points near the player spawn (`x:14, z:-9.5`) so the "alive"
  impression lands in the first ten seconds.
- **Deploy:** the box is `playlextown` (`/opt/lextown`, systemd `lextown`); the
  NPC process needs its own unit/drop-in. This is an ops task — Paul handles
  the actual deploy; dev C delivers the unit file + a `README`/runbook note.

### Non-goals
- **No AI text generation** (Haiku hook stays off). Preset pools only.
- No new persona content authored this phase (use what's in `npcs.mjs`).
- No persistence, no accounts, no logging of generated lines.

---

## F4 — HORSEPOWER Discoverability + Pointer Guard (micro-fixes)

### F4a — Mission 4 has zero completions
Two plausible causes: players never reach the green ring (discoverability), or
the "run at a horse and the horse wins" spook mechanic is too punishing
(difficulty). Phase 1 fixes discoverability and *measures* difficulty rather
than guessing:
- F1's waypoint already points players to `M4_TRIG` once m3 is beaten — that's
  the primary fix.
- During the `wrangle` stage, add edge-arrow guidance to each un-penned horse
  (the three are scattered: Kroger Field lots, Chevy Chase, Thoroughbred Park)
  so players know there are three and where they are. Reuse the same edge-arrow
  primitive built for F1.
- Add a one-time first-attempt coaching caption spelling out the spook rule
  ("Walk up slow — run and the horse bolts").
- Leave the spook radius / speed threshold **as-is** this phase; instrument it
  so we can see completion rate after the discoverability fixes and tune in
  NEXT with data.

### F4b — setPointerCapture / pointer-lock guard
The two `setPointerCapture` calls at app.js:4627 and 4632 are already
`try/catch`-wrapped, so the benign `client_err` telemetry is coming from a
*different* unguarded pointer/lock call (a `releasePointerCapture`, a
`pointercancel`/`lostpointercapture` path, or a `requestPointerLock` race).
- Driven by telemetry, not guesswork: pull the actual line from the logs
  first — `jq 'select(.e=="client_err")' logs/events-*.jsonl` on the box gives
  the `src` `file:line`. Wrap that specific call defensively.
- Confirm the fix by reproducing the interaction (rapid click-to-lock /
  tab-blur during drag) in two tabs and watching for a clean
  `client_err`-free session.

### Controls / HUD / multiplayer
None — pure hardening. No new controls, no relay changes, no server changes.

### Non-goals
- No difficulty rebalance of m4 yet (that's a measured NEXT item).
- No broad refactor of the pointer/drag code — fix the one call the logs name.

---

## Sequencing & integration notes for the architect
- **F1's edge-arrow primitive is a shared dependency** for F4a — build it once
  in the overlay layer and reuse it. Land F1 first so F4a can lean on it.
- **F2 and F3 both touch `server.js`** but in disjoint spots (F2 =
  `BOARDS`/score validation; F3 = client-side process + optional
  moderation-exemption). Give the `m5` board edit to dev C so dev B stays in
  `app.js`/`index.html` and there's one owner per file region.
- **Top-level statement order in `app.js` is load-bearing** — F2's new mission
  island must declare its registries/objects before the sections that fill
  them run (the documented `vehicles`-before-init crash class). Mission 1
  (app.js:2530+) is the reference layout to copy.
- **Every new mission must join `allIdle()`** — this is the single easiest
  thing to forget and it lets two missions run at once.
- Ship gate for all four: `node --check` both files, then a real two-tab
  localhost pass exercising each feature (waypoint retarget across a full
  mission chain, a DEADLINE run end-to-end, NPC chatter visible, and a clean
  `client_err` log).
