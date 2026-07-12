# LEXTOWN-01 — Phase 2 Build Spec ("The Company Release")

Phase 1 attacked the first minute. Phase 2 attacks the *second visit* — you
stayed, you did a job, now why come back, and why bring a friend? Almost
everything here is about playing *together* and being remembered when you
return. Features land as `F1`, `F2`, … each sized to a session and owned by one
dev; this file grows as later features are appended.

Ground rules that bind every feature (from CLAUDE.md, do not violate):
- ES5 style only: `var`, function statements, no modules/arrow-only/transpiled
  syntax. No new dependencies (server stays `ws`-only). Textures stay
  canvas-generated; no image assets.
- User-visible strings that round-trip the server stay printable ASCII.
- The privacy promise (`web/privacy.html`) is load-bearing: no accounts, no new
  data collection, chat never stored/logged. Nothing here may falsify it.
- No map growth unless a feature explicitly says so. If any feature ever needs
  to extend the world, `WORLD` in `server.js` must move in lockstep with
  `X0/X1/Z0/Z1` in `app.js` — nothing in F1 does, and that's deliberate.
- Verification is the standing one: `node --check web/app.js && node --check
  server.js`, then two browser tabs against localhost exercising the feature.
  Ride-along features only reveal their bugs with 2+ clients — one tab drives,
  one tab rides.

### Work split at a glance
| Feature | Primary file(s) | Suggested dev |
|---|---|---|
| F1 Ride Shotgun (passenger seat) | `web/app.js`, `server.js` (arbitration + `m:4` cap), `web/index.html`, `README.md` | Client dev + server dev (paired) |
| F2 It Remembers You (account-less persistence) | `web/app.js`, `web/index.html`, `web/privacy.html`, `README.md` | Client dev (no server work) |
| F3 Weather Beyond the Storm (rain + fog) | `web/app.js`, `web/index.html`, `web/privacy.html`, `README.md` | Client dev (no server work) |
| F4 Private Worlds / Rooms | `server.js` (room-scoped broadcast + per-room heli), `web/app.js`, `web/index.html`, `web/privacy.html`, `README.md` | Server dev + client dev (paired) |
| F6 Mission 8: LOOSE IN THE PADDOCK | `web/app.js` (mission island), `server.js` (board), `web/index.html`, `README.md` | Mission dev |
| F7 Mission 9: AIR MAIL | `web/app.js` (mission island), `server.js` (board), `web/index.html`, `README.md` | Mission dev |

*(F5 is HORSEPOWER tuning — data-driven, tracked as a build task, no spec section here. F8+ appended below.)*

---

## F1 — Ride Shotgun (passenger seat)

**Why this matters.** This is the phase-2 thesis in its purest form. Ride
shotgun is the lowest-friction co-op moment in the game: no mission, no skill
gate, no leaderboard — just two people in one car with the radio on, watching
downtown roll by. It converts "two strangers happen to be near each other" into
"we did a thing together," which is exactly the second-visit hook the roadmap is
chasing. It's also the single most-requested kind of "play together" moment, and
it's the reusable tech under two NEXT items ("Ride the bus," "Scooter share").

**The problem, mechanically.** Today a car only ever carries the one player who
stole it. A remote player driving renders as a car mesh at their interpolated
position (`updateRemotes`, app.js:4877 — `r.m === 2` → `buildRemoteCar`). There
is no way for a second player to occupy that car. So the most-simulated system
in the game (100 stealable cars, four radio stations, real one-way grid) is a
strictly solo experience even in a shared world. The whole feature is: let one
player bind to another player's car as a passenger, ride the driver's motion,
and hear the radio — all through the existing net pipeline, with the seat
handshake carried in a dedicated message type (cars are not server objects, so
the pairing can't live in the state packet, which the server strips of extra
fields anyway).

### User story
As a player standing next to a friend who's driving, I press one key, hop into
the shotgun seat, and just ride — I look around, cycle the radio, chat, and
watch the city go by while they drive. When I'm done, I press the same key and
step out at the curb.

### Design decisions (resolved — these are the contested picks, settled)
1. **One passenger per car.** "Shotgun" is literal. Mirrors the heli's
   single-pilot arbitration: the seat is a mutex, second boarder gets `deny`.
2. **Board at any speed** (fun beats realism), gated only by proximity to the
   driver's *interpolated* car position with a generous window (~8 m — wider
   than the on-foot 6.5 m enter check to absorb the ~160 ms interp trail). No
   low-speed gate; teleporting into a moving car is the fun of it, and the
   server's one-packet mode-switch slack already covers the board jump.
3. **Passenger is a spectator with a radio.** They get free mouse-look,
   first-person toggle, chat, and local radio (`R`). They do **not** drive, do
   **not** fire the nerf blaster, do **not** take mission photos, and cannot
   start a mission or board the heli while seated. Riding is a lean-back state.
4. **Radio is per-listener, not shared.** The passenger picks their own station
   locally; it does not sync to the driver. (Shared/synced radio is a NEXT idea,
   flagged below.)
5. **Freeze-tag can't touch a seated player.** Boarding holsters the blaster and
   drops PvP opt-in, so a passenger is never a valid tag target. A frozen player
   cannot board until they thaw (mirrors `canEnterHeliBase`'s `!isFrozen()`).
6. **Exit drops you at the car's current position**, on foot, at any speed. Every
   involuntary eject (driver leaves the car, driver disconnects) drops the
   passenger the same gentle way — no crash, no penalty (unlike the heli pilot's
   disconnect-crash; a passenger losing their ride is a non-event).

### Premise / UX flow
1. **See the prompt.** On foot, within ~8 m of a *remote human's car that is
   actively being driven* (`remotes[id].m === 2`), and eligible (not frozen, not
   already driving/flying/seated), the `#hint` line shows `E — RIDE SHOTGUN`.
   Because bots never drive, this prompt only ever appears near a real human — it
   is self-gating for discoverability.
2. **Board.** Press `E` (or the touch **E-VEH** button, `#bCar`). The client
   sends the seat request; on grant the passenger snaps into the shotgun seat of
   that car, mode flips to passenger (`m:4`), the blaster holsters, and a caption
   confirms: `RIDING SHOTGUN — <DRIVER NAME>`. The radio comes on (see below).
3. **Ride.** The passenger's avatar and camera are pinned to the driver's
   interpolated car position at the shotgun offset. `W/A/S/D` do nothing (you're
   not driving); the car's motion carries you. Mouse-look is free; `C` toggles
   first-person (look out the window); `R` cycles the radio; `Enter` chats. The
   seated `#hint` reads `E — HOP OUT   R — RADIO   C — VIEW`.
4. **Exit.** Press `E` → you step out at the car's current position, on foot
   (`m:0`), and the on-foot prompt/hint returns. If the driver leaves the car,
   disconnects, or otherwise ends the drive, you're auto-ejected to the same
   spot with a one-line caption (`<DRIVER> parked — you hopped out`).

### Seat model & arbitration rules
- The seat is a **server-arbitrated mutex keyed on the driver's player id**,
  exactly like `HELI.pilot`. The server holds a `seats` map (driver id →
  passenger id, and the reverse) so it can reject a second boarder, and so it
  can eject the passenger when the driver's drive ends.
- A **passenger is bound to a driver (a player id), not to a car mesh** — cars
  aren't server objects. The passenger's client renders itself at whatever
  position the bound driver's car currently interpolates to.
- **Only an `m:2` driver is boardable.** A passenger is `m:4`, never `m:2`, so
  you can't ride a passenger — no passenger-of-a-passenger chains, no need to
  special-case them.
- Boarding is denied (server sends `deny`, client shows a brief caption) if: the
  seat is taken, the target isn't currently driving, the boarder is frozen, or
  the boarder is out of range by the time the request lands.

### What the passenger CAN do
- Look around freely (mouse-look / drag-orbit), toggle first-person (`C`).
- Chat (`Enter`) — bubbles and log work unchanged; still never stored.
- Cycle the radio locally (`R`) and mute (`lt_snd`), independent of the driver.
- Hop out at any time (`E`).

### What the passenger CANNOT do (while seated)
- Drive or steer (`W/A/S/D` inert), or take the wheel from the driver.
- Fire the nerf blaster or be a freeze-tag target (blaster auto-holsters on
  board; PvP opt-in drops). *Firing out the window is a deliberate NEXT idea, not
  F1.*
- Start a mission, take a mission photo, or grab an RPG crate — the seat is not
  an actor state. (The mission start-gates all route through `allIdle()`; a
  seated player is not idle-on-foot, so they simply can't trigger a ring.)
- Board the heli. To fly, hop out first, then walk to the pad.

### Radio while riding
`radioActive()` (app.js:2415) currently gates on `!!player.veh`. Extend the "am
I in a car" test to also count riding shotgun (introduce/route through an
`inCar()` helper that is true when `player.veh` **or** the passenger seat is
bound). The radio chip (`#radiochip`) shows for the passenger too, `R` cycles
`radio.st` and persists to `lt_radio` as always, and the per-station shuffle-bag
rotation is unchanged. The passenger's station is their own; nothing about the
radio relays to the driver or anyone else.

### Controls / HUD surfaces touched
`E` already means "enter/exit vehicle," so this rides the existing control; the
`#help` bar's `E VEHICLE` token already covers it and needs **no** new entry
(keeping the long bar short). But these surfaces must land together:
- **Tutorial `CARS` grid (`#tut`, index.html:297–302):** add one row —
  `<kbd>E</kbd>` → "near a friend who's driving, **ride shotgun** — they drive,
  you watch the city roll by with the radio on."
- **README controls table (README.md:43–65):** add one row under the `E` /
  vehicle rows — "`E` near a player who's driving | Ride shotgun in their car —
  they drive, you watch, `R` works the radio, `E` hops out."
- **`#hint` line:** on-foot eligible prompt `E — RIDE SHOTGUN`; seated prompt
  `E — HOP OUT   R — RADIO   C — VIEW` (wired into the existing hint chain in
  `frameStep`, app.js:~6270, alongside the driver/heli hint branches).
- **Touch:** the existing **E-VEH** button (`#bCar`) doubles as board/hop-out —
  no new touch button. The radio button (`#bRadio`) already exists.
- **SIM tray (`#tray`):** no toggle needed — this is opt-in per action, not an
  ambient overlay.
- **One-time caption (discoverability):** the first time an eligible remote
  driver comes within range, fire a one-shot tip caption (`TIP — walk up to a
  car someone's driving and press E to ride along`), gated by a localStorage
  flag (`lt_ride_seen`), never repeated. This is the only "teach it exists"
  surface that fires in-world, and it only fires when the feature is actually
  usable (a human is driving nearby).

### Multiplayer behavior & server support
The seat handshake is a **new dedicated message type** (`{t:'ride', ...}`),
mirroring the heli's `{t:'heli', a:'enter'|'exit'|'deny'}` arbitration — because
the state packet is stripped of extra fields, pairing data cannot travel in
`state`. Two small server additions:
1. **Add `m:4` to `CAPS`** (server.js:194) with the same bounds as drive
   (`m:2`), so passenger state packets validate instead of being force-demoted to
   walk. The passenger declares `m:4` and broadcasts state that **mirrors the
   bound driver's interpolated car position** each netTick (app.js:~4976), so
   the existing remote pipeline (`handleNet → remotes → updateRemotes`) renders
   them with no new render path — CLAUDE.md's "every multiplayer feature must
   work through that one pipeline" holds. Because the passenger's declared
   position tracks the driver's server-clamped car, it stays in `WORLD` bounds
   automatically; the mode-switch one-packet slack absorbs the board teleport.
2. **The `seats` mutex + eject watch** (see arbitration below). No `WORLD`
   change, no new dependency, no persisted state — the seat lives in server
   memory for the duration of the ride, exactly like `HELI.pilot`.

`scores.json`, the boards, and every existing message type are untouched. The
privacy posture is intact: the seat binding is ephemeral relay state (like heli
piloting), the passenger's chat is broadcast-and-forgotten like anyone's, and no
new data is stored or logged.

### Server arbitration (message flow — for the architect to implement)
Mirror the heli pattern (server.js:469–490, 625). Verbs: `enter`, `deny`,
`exit`, `eject`.
- **Board request** — passenger → server: `{t:'ride', a:'enter', drv:<driverId>}`.
  Server checks, in order: `drv` exists and is currently `m:2`; that driver has
  no passenger (`!seats[drv]`); requester isn't already a driver/pilot/passenger;
  requester isn't frozen; requester is within range of the driver's last known
  position. **On success:** record `seats[drv] = pax` (and reverse), broadcast
  `{t:'ride', a:'enter', drv, pax}` to everyone. **On any failure:** send
  `{t:'ride', a:'deny'}` to the requester only.
- **Passenger hops out** — passenger → server: `{t:'ride', a:'exit'}`. Server
  clears both sides of the binding and broadcasts `{t:'ride', a:'exit', drv,
  pax}` so the driver's local "+passenger" render clears and all clients drop the
  seated figure.
- **Driver ends the drive (auto-eject)** — the server has no car object, so it
  detects this from the driver's **state stream**: when an accepted state packet
  from a driver who has a bound passenger arrives with `m !== 2` (they exited the
  car, switched to jetpack, etc.), the server clears the binding and broadcasts
  `{t:'ride', a:'eject', drv, pax}`.
- **Disconnects** — on `leave` (server.js:~625, next to the heli
  pilot-disconnect crash): if the leaver was a driver with a passenger →
  broadcast `eject`; if the leaver was a passenger → clear the binding and
  broadcast `exit` so the driver's seat frees for a new boarder.
- **Client handling of the broadcasts** flows through `handleNet` (app.js:4760):
  `enter` binds the render (driver draws the pax avatar in-seat; the pax pins to
  the car); `exit`/`eject` unbind and place the ex-passenger avatar back at the
  car's last position on foot.

### Visuals — what everyone sees
- **Other players** see the passenger's avatar seated in the driver's remote car
  at a fixed **shotgun offset** (passenger side of `buildRemoteCar`,
  app.js:4749), with their name tag floating over the seat exactly as it floats
  over any avatar (the tag pipeline at app.js:5896 already reads the car position
  for `m:2`; extend it to place a seated `m:4` remote at the bound car's seat).
- **The driver** sees the passenger's avatar in their own car's shotgun seat,
  bound from the `ride enter` broadcast's `pax` id → `remotes[pax]` avatar pinned
  to the local car mesh. The driver gets a one-shot caption on board
  (`<PAX> hopped in — shotgun`) so they know they picked someone up; the seated
  figure + name tag is the persistent indicator (no extra HUD chip needed).
- **The passenger** sees themselves in-seat (their own avatar pinned to the
  bound car), the driver at the wheel, and the normal follow-cam / first-person
  view. Because the seat and the car are the same interpolated object in the
  passenger's view, there's no relative jitter between avatar and car even though
  the whole rig trails the driver's true position by ~160 ms.

### Edge cases (spell out the outcome for each)
- **Passenger presses `E`:** hops out at the car's current position, `m:0`,
  on-foot prompt returns. Sends `{t:'ride', a:'exit'}`.
- **Driver exits their car:** server sees the driver's `m` leave `2`, auto-ejects
  → passenger drops at the car's parked position; both end up on foot.
- **Driver disconnects:** `leave` handler broadcasts `eject`; passenger drops at
  the driver's last car position (gentle drop, no crash — unlike the heli pilot).
- **Driver enters the heli:** they must exit the car first, which is just the
  "driver ends the drive" eject — no separate case.
- **Passenger's client disconnects:** server clears the binding, tells the driver
  the seat is free (broadcast `exit`); the driver keeps driving solo and a new
  passenger can board.
- **Driver drives out of world bounds:** can't — the server clamps/rejects the
  driver via the existing move validation; the passenger mirrors the *corrected*
  car position on the next netTick, so it stays glued and in-bounds.
- **Two players board the same driver at once:** server grants the first
  `{t:'ride', a:'enter'}`, denies the second (single-seat mutex) — same race
  resolution as the heli.
- **Boarder is frozen / gets frozen mid-request:** boarding is denied
  (`!isFrozen()` gate). A seated passenger can't be frozen at all (not a PvP
  target).
- **Driver is destroyed/replaced (car swap):** the binding is to the driver id,
  not the car, so a driver who exits and re-enters a *different* car has already
  been ejected on the first exit; the passenger re-boards if they want the new
  car.
- **Passenger tries to start a mission / grab an RPG while seated:** inert — the
  seat state fails the on-foot idle checks and the ring/crate triggers.
- **Offline / bots-only:** the prompt never appears (bots don't drive); the
  feature is correctly invisible with no live human driver, and nothing errors.
- **Mid-session joiner:** a client that connects after a ride is in progress
  learns the binding from the ongoing `state` stream + the next `ride` broadcast;
  a seated pair renders correctly for them once the next `enter` state settles.
  (Architect: confirm the welcome handshake or a re-broadcast covers a joiner who
  missed the original `enter` — an occupied seat should reconcile within a
  netTick or two, same tolerance as the heli snapshot in `welcome`.)

### Non-goals (F1)
- **No second/rear seats** — one shotgun seat per car this phase.
- **No firing from the seat** (drive-by nerf), **no shared/synced radio**, **no
  passenger-triggered missions** — all flagged as NEXT ideas, none in F1.
- **No AI/NPC drivers to ride** ("Ride the bus" is a separate NEXT item that
  reuses this tech pointed at an NPC loop).
- **No map growth, no new dependency, no new persisted data.**

---

## Acceptance checklist — F1 Ride Shotgun

Two-tab localhost verification. Run the standing gate first
(`node --check web/app.js && node --check server.js`, then `npm test`), then work
this by hand. **Tab A = driver, Tab B = passenger.**

```bash
ADMIN_TOKEN=qa-admin PORT=8080 node server.js
```

Open `http://localhost:8080/?v=1` in **two tabs**, distinct names via
`#name=DRIVER` / `#name=PAX`. Keep both consoles open.

- [ ] **Prompt only near a live driver.** In Tab B on foot, walk near Tab A while
      A is **not** driving → no ride prompt. A steals a car and drives near B →
      B's `#hint` shows `E — RIDE SHOTGUN`. (Confirm the prompt never appears in a
      solo/offline tab — bots don't drive.)
- [ ] **First-opportunity tip caption, once.** The first time an eligible driver
      is in range, B sees the one-shot `TIP — …ride along` caption; it sets
      `lt_ride_seen` and does **not** fire again this session or after reload.
- [ ] **Board at speed.** With A driving, B presses `E` → B snaps into A's
      shotgun seat, B's caption reads `RIDING SHOTGUN — DRIVER`, B's blaster
      holsters, and the radio chip appears for B. Works while A is moving.
- [ ] **Passenger rides glued.** As A drives around downtown, B's avatar + camera
      stay pinned to A's car (shotgun offset), no `W/A/S/D` movement from B, no
      relative jitter between B's avatar and the car.
- [ ] **Radio works for the passenger.** In Tab B, `R` cycles stations
      (persists `lt_radio`), independent of A's station; mute via `lt_snd` works.
- [ ] **First-person + chat while seated.** `C` toggles B into first-person
      (looking out the window); B chats and the bubble/log appear in both tabs.
- [ ] **Others see the seated pair.** Open a **third** tab (spectator): it shows
      B's avatar seated in A's car with B's name tag over the seat, and A at the
      wheel.
- [ ] **Driver sees the passenger.** Tab A shows B's avatar in A's own shotgun
      seat and gets the one-shot `PAX hopped in — shotgun` caption.
- [ ] **Single seat / deny.** Open a third tab (`#name=PAX2`), drive-adjacent,
      try to board A while B is seated → denied (brief caption), no second figure
      appears; A still carries exactly one passenger.
- [ ] **Passenger hops out.** B presses `E` → B drops at the car's current
      position on foot, prompt returns, seat frees (a new passenger can now
      board). All tabs drop the seated figure.
- [ ] **Driver exits car → auto-eject.** With B seated, A presses `E` to leave
      the car → B is ejected to the car's parked spot on foot with the
      `DRIVER parked — you hopped out` caption; both on foot in all tabs.
- [ ] **Driver disconnects → gentle eject.** Reboard, then close Tab A → B is
      ejected at the last car position (no crash, no error), seat cleared
      server-side.
- [ ] **Passenger disconnects → seat frees.** Reboard, then close Tab B → A keeps
      driving solo, A's seated figure clears, and a fresh passenger can board.
- [ ] **Frozen can't board / seated can't be frozen.** Freeze B with a dart
      (both opted into PvP, on foot) → while frozen B's `E` board is denied. Once
      seated, B is not a valid freeze target (blaster holstered, PvP off).
- [ ] **No mission/heli from the seat.** While seated, B at a mission ring or the
      helipad → `E` does not start a mission or board the heli; RPG crates don't
      grab.
- [ ] **Bounds hold.** A drives to the edge of `WORLD` (server clamps A) → B
      stays glued and in-bounds; no `correct` snap-back storms on B, no console
      errors.
- [ ] **Surfaces updated together.** The tutorial `CARS` grid, the README
      controls table, and the seated/on-foot `#hint` strings all describe ride
      shotgun; the `#help` bar's `E VEHICLE` still covers it (no new token).
- [ ] **Privacy intact.** No new localStorage beyond `lt_ride_seen` (a boolean
      tip flag) and the existing `lt_radio`; no new server-side storage or
      logging; chat still never stored. `web/privacy.html` remains true.
- [ ] **Standing gate green.** `node --check` both files pass and `npm test`
      (`node test/smoke.mjs`) is all green.

---

## Sequencing & integration notes for the architect
- **Two owners, one handshake.** The client (board/exit input, seat render,
  radio gate, hints, tutorial/README) and the server (`m:4` cap, `seats` mutex,
  eject watch, `ride` broadcasts) are the two halves; land the server message
  contract first so the client can code against it, exactly like the heli.
- **Copy the heli, don't invent.** `{t:'heli', a:'enter'|'exit'|'deny'}`
  (server.js:469–490) + the pilot-disconnect crash (server.js:625) is the
  reference. Ride is the same shape minus the shared-object hp/damage — the seat
  binding replaces `HELI.pilot`, the auto-eject-on-mode-change replaces the
  crash-on-disconnect.
- **One render pipeline.** The seated passenger must render through
  `handleNet → remotes → updateRemotes` (add an `r.m === 4` seat-offset branch
  next to the `r.m === 2` car branch at app.js:4877), so it works identically
  online and — trivially, by being absent — offline.
- **Top-level statement order in `app.js` is load-bearing.** Any new registry or
  helper (`inCar()`, seat state) must be declared before the sections that read
  it — the documented crash class.
- **The seat-offset constant is the one visual tuning knob** — pick a shotgun
  offset that reads as "passenger side" on `buildRemoteCar` and reuse it for both
  the local-driver render and the remote render so the figure sits in the same
  spot everywhere.

---

## F2 — It Remembers You (account-less persistence)

**Why this matters.** This is the other half of the phase-2 thesis: the city
*knowing you when you walk back in*. The storage already works — your name and
all seven mission bests survive a reload today — but nothing *shows* it, and one
piece of identity actively resets. A returning player gets a re-randomized color
and zero acknowledgment they've been here before, so the game feels like a fresh
start every time instead of a place you're building a history in. F2 is polish,
not plumbing: make the memory that already exists visible and stable, and drag
the privacy disclosure back in line with what's actually stored. It's the
cheapest retention lever in the phase — no new systems, just making what's
remembered *feel* remembered.

**The problem, mechanically.** Three gaps sitting on top of a data layer that
already persists:
1. **Color re-randomizes every load.** `myColor` (app.js:1598) is drawn fresh
   from `PLAYER_COLS` (six colors, app.js:1588) on every boot and shipped in
   every state packet (`c: myColor`, app.js:4978). Name and best times come
   back, but you show up to everyone — and to yourself — as a different-colored
   stranger. Nothing writes the color to storage; there is no color UI at all.
2. **No welcome-back moment.** The only first-run acknowledgment is the Dispatch
   caption fired from `tutClose` (app.js:5553–5561), gated to first-timers
   (`!heliUnlocked`) and reachable only by closing the tutorial modal — which
   returning players (`lt_tut_seen==='1'`) never open (app.js:5570). So a
   returning player lands in the world greeted by nothing; persistence is
   invisible except for the score modal's "DEVICE BEST" line (app.js:2804).
3. **Privacy disclosure has drifted.** `web/privacy.html` (L59–63) lists
   on-device storage as "tutorial flag, player name, sound pref, mission
   progress" — but reality is ~16 keys (`lt_name`, `lt_tut_seen`, `lt_snd`,
   `lt_radio`, `lt_waypt`, `lt_obj_banner_seen`, `lt_m4_coached`,
   `lt_heli_unlock`, `lt_mission_best`, `lt_m2_best`..`lt_m7_best`). F1 adds
   `lt_ride_seen`; F2 adds `lt_color`. The list has to be regrouped to stay
   honest as keys accrete.

### User story
As someone coming back for a second session, I show up as *me* — same name, same
color everyone saw last time — and the city greets me by name and points me at
the job I still haven't finished.

### Design decisions (resolved)
1. **Persist the color, and let players pick it.** Silently lock in the assigned
   color (store the `PLAYER_COLS` index in `lt_color`, clamped on read exactly
   like `lt_radio` at app.js:2414) so *every* returning player is stable with
   zero effort — this alone fixes the stranger bug. On top of that, add a minimal
   six-swatch picker in the tutorial's CALL SIGN block so the color feels chosen,
   not assigned. Read `lt_color` at boot **before** `makeAvatar` (app.js:1598
   before 1614) so the silent path needs no recolor; a picker change applies at
   `tutClose` (alongside `applyName`) and recolors the avatar.
2. **Welcome-back is a Dispatch caption, ~3.5 s after load, once.** It fires only
   for returning players, gated hard so it never stacks with the first-time shove
   and never fires under `#cine=1`. Caption-only — no new audio asset (audio is
   baked via `tools/gen-audio.mjs`; a new VO clip is out of scope).
3. **Yes, the greeting nudges the next objective.** It names the next unbeaten
   mission and defers the *pointing* to F1's gold waypoint — the cheapest
   retention lever available, and it reuses the existing progression logic
   instead of duplicating it.
4. **Storage shape is unchanged:** client-side localStorage only, exactly one new
   key (`lt_color`), every access wrapped in `try/catch`. No server identity, no
   device UUID, no fingerprint — the privacy promise forbids all three.
5. **The privacy list gets regrouped, not itemized forever** — plain categories
   that already cover F1's key and any future ones.

### UX flow — A. Color identity
1. **First load:** `myColor` resolves from `lt_color` if present, else a random
   `PLAYER_COLS` pick; if `lt_color` was absent it is written immediately, so the
   first random color becomes permanently *yours* even if you never touch the
   picker. This is the load-bearing fix.
2. **Optional pick:** the tutorial's CALL SIGN block (below the name input) shows
   the six palette swatches with the current one highlighted. Click one to
   choose; the choice applies on `tutClose` (with `applyName`), writes
   `lt_color`, and recolors your avatar. The `c:` field in every subsequent state
   packet carries the chosen color, so everyone sees the same you.
3. **Returning load:** `lt_color` is read at boot; your avatar and your relayed
   color match last session with no action from you.

### UX flow — B. Welcome-back moment
1. At boot, capture `returning = (lt_tut_seen === '1')` **before** anything can
   flip the flag.
2. If `returning && !CINE`, set the shared `_welcomed` guard true and schedule a
   ~3.5 s Dispatch caption. (For a returning player the tutorial never opens, so
   `tutClose` and its first-time block never run; sharing `_welcomed` is
   belt-and-suspenders against a mid-session tutorial reopen via `?`.)
3. At fire time, if `allIdle()`, show `welcomeBackLine()`:
   - **Missions remain:** `WELCOME BACK, <NAME>. <MISSION> IS STILL OPEN -
     FOLLOW THE GOLD MARKER.` (e.g. "WELCOME BACK, PAUL. HORSEPOWER IS STILL OPEN
     - FOLLOW THE GOLD MARKER.") — `<MISSION>` comes from the same next-unbeaten
     logic as `nextMissionHint()` / `currentObjective()`.
   - **All beaten:** `WELCOME BACK, <NAME>. YOU BEAT EVERY MISSION - CHASE A
     FASTER TIME.`
4. It fires once per load, works online and offline (it's a pure local read of
   localStorage, no dependency on the `welcome` handshake), and never repeats or
   stacks with the first-time Dispatch line.

### Controls / HUD surfaces touched
- **Tutorial CALL SIGN block (`#tut`, index.html ~284–289):** add the six-swatch
  color row under the name input, current color highlighted. Not a keypress — no
  `#help` bar or README control-table row is needed.
- **README:** one line in the intro/features area — "LEXTOWN remembers your name,
  color, and best times on your device (no account; nothing leaves your
  browser)."
- **No new key-control, no SIM tray toggle, no touch button.** Color is chosen
  once in the modal; the welcome-back is automatic.

### Multiplayer behavior
- Color already rides the existing `c:` state field — persisting it changes
  nothing on the wire, only that `myColor` is now stable across sessions. Others
  render your consistent color through the normal `handleNet → remotes` avatar
  path (`makeAvatar(m.c ...)`).
- The welcome-back caption is purely local, so it works identically online,
  offline, and bots-only. Nothing new touches the server, the boards, or
  `scores.json`.

### Privacy sync (load-bearing — ships in the same change as the code)
Replace the "WHAT WE STORE ON YOUR DEVICE" paragraph (`web/privacy.html`
L59–63) with a grouped, forward-compatible description. Proposed copy:

> A small set of localStorage values, all kept on your device and never sent up
> as an account: the **name and avatar color** you chose, your **preference
> toggles** (sound, radio station, and the objective waypoint), a few **flags
> that remember what you've already seen** (the tutorial and one-time tips), and
> your **mission progress** — your best times and which missions and vehicles
> you've unlocked. No advertising, no fingerprinting; clearing your browser
> storage resets all of it.

This covers every current key plus F1's `lt_ride_seen` and F2's `lt_color`
without enumerating internals forever. **Secondary honesty touch-up (same
edit):** the "MISSION HIGH SCORES" paragraph (L49–54) still says "the City Hall
mission" (singular) though there are now seven boards — worth generalizing to
"the mission high-score boards." That paragraph is about *server-side* storage
and is separate from the on-device list F2 owns, but it should be corrected in
the same pass so the whole page is honest.

### Edge cases
- **localStorage throws (private mode / disabled):** every read and write stays
  wrapped in `try/catch` (the existing pattern at app.js:1595, 5540, etc.). On
  throw: color falls back to a random pick (unstable but functional), `lt_color`
  isn't written, no welcome-back state persists — the game runs normally with no
  console error.
- **First-timer vs returning is mutually exclusive:** a first-timer has
  `!lt_tut_seen` at boot, so `returning` is false and the welcome-back never
  schedules; closing the tutorial then sets the flag and fires the *first-time*
  line instead. The shared `_welcomed` guard prevents any overlap even if a
  returning player reopens the tutorial via `?`.
- **Returning player who never beat m1:** `heliUnlocked` is false but
  `lt_tut_seen` is '1' — welcome-back still fires and points at THE RIBBON
  CUTTING (the first unbeaten objective).
- **`#cine=1`:** suppresses the welcome-back exactly as it suppresses the
  tutorial (app.js:5570) — no chrome, no captions during cinematic capture.
- **`#name=` override:** a URL name still wins over `lt_name` (app.js:1593–1596)
  unchanged; the welcome-back greets whatever `myName` resolved to.
- **Stale / garbage `lt_color`:** clamp on read like `lt_radio` — an
  out-of-range or non-numeric value falls back to a random valid palette entry,
  never an invalid color.
- **Picker changes color after the avatar exists:** apply at `tutClose` and
  recolor the avatar's materials; the silent path (no picker interaction) never
  needs a recolor because `lt_color` is read before `makeAvatar`.

### Non-goals (F2)
- **No name-collision handling** — two players can still share a name, unchanged.
- **No cross-device sync** — localStorage is per-device; that's the whole
  account-less premise.
- **No server-side identity, no accounts, no device UUID, no fingerprinting** —
  the privacy promise forbids it.
- **No leaderboard/board changes**, no new score categories, no change to how
  scores persist.
- **No new audio asset** for the welcome-back (caption-only).
- **No expansion of what's stored** beyond the single new `lt_color` key.

### Acceptance checklist — F2 It Remembers You

One tab covers most of this (persistence is local); use a second tab only to
confirm others see your color. Standing gate first (`node --check` both files,
`npm test`).

- [ ] **Identity round-trips; welcome-back on return.** Clear all keys → first
      load opens the tutorial; set name `PAUL`, click a swatch, close (the
      *first-time* Dispatch shove fires; **no** welcome-back). Reload → the
      tutorial does **not** open, the avatar is the same color, the name is still
      `PAUL`, and ~3.5 s in a welcome-back Dispatch caption fires **once**.
- [ ] **Silent color persistence (no picker).** Clear keys, load, note the random
      avatar color, reload → same color (the first random pick was written to
      `lt_color`).
- [ ] **Picker sets and persists.** Open the tutorial, click a different swatch,
      close → avatar recolors; reload → the chosen color returns; `lt_color`
      holds the palette index.
- [ ] **Others see your stable color.** In a second tab, confirm your avatar
      shows the persisted color; reload your tab and confirm it does **not**
      change for the observer.
- [ ] **Welcome-back names the right mission.** Set bests via the fast-forward
      keys so only HORSEPOWER remains → the caption names HORSEPOWER and F1's gold
      waypoint points at the green ring.
- [ ] **All-beaten variant.** With all seven bests set → the caption reads
      `WELCOME BACK, PAUL. YOU BEAT EVERY MISSION - CHASE A FASTER TIME.`
- [ ] **First-timer gets the first-time line, not welcome-back.** Fully reset
      storage → tutorial opens; on close the first-time Dispatch shove fires and
      the welcome-back does not.
- [ ] **No stacking on tutorial reopen.** As a returning player, reopen the
      tutorial via `?` and close it → no first-time shove (the `_welcomed` guard
      held); welcome-back still fired only once at boot.
- [ ] **`#cine=1` suppresses.** Load `?v=1#cine=1` as a returning player → no
      tutorial and no welcome-back caption.
- [ ] **Private-mode / storage-throw degrades silently.** With `localStorage`
      writes throwing, color falls back to random, no welcome-back state
      persists, no console error, the game plays normally.
- [ ] **Privacy disclosure matches reality.** `web/privacy.html` "WHAT WE STORE
      ON YOUR DEVICE" lists name+color, preference toggles, seen-flags, and
      mission progress; no key stored on device is unaccounted for (`lt_color`
      and `lt_ride_seen` included), and the high-scores paragraph no longer says
      a single mission.
- [ ] **Standing gate green.** `node --check web/app.js && node --check
      server.js` pass and `npm test` is all green.

### Notes for the architect (F2)
- **Read `lt_color` at boot before `makeAvatar`** (app.js:1598 → 1614) so silent
  persistence needs no recolor; store/read the `PLAYER_COLS` index with the same
  clamp pattern as `lt_radio` (app.js:2414).
- **Write `lt_color` immediately on first load when absent**, so a never-touched
  random color still becomes permanent — that's what fixes the stranger bug for
  the majority who never open the picker.
- **Capture `returning` before `tutClose` can set `lt_tut_seen`**, and reuse the
  existing `_welcomed` flag (app.js:5547) so the two greetings are mutually
  exclusive.
- **Factor a `nextMissionName()`** out of the existing `nextMissionHint()`
  progression so the welcome-back line and the hint can never disagree about
  "what's next."
- **The privacy edit ships in the same change as the code** — the disclosure
  must not lag the new key; keeping them in lockstep is the point of the feature.

---

## F3 — Weather Beyond the Storm (rain + fog)

**Why this matters.** The snow emergency proved a moody, weather-changed
Lexington is one of the game's best "look at this" moments — but it's locked
behind a mission almost nobody triggers, so most sessions only ever see the same
bright afternoon. Rolling weather is a cheap, always-on reason for the city to
look different every time you come back, and it makes the shared world feel like
a real place two people are standing in together ("wait, is it raining for you
too?"). It's atmosphere as retention: no new content to author, just the sky the
engine can already paint, turned loose on a schedule.

**The problem, mechanically.** Every piece of a weather system already exists —
it's just wired hard to mission 2. The storm is a single smoothed blend scalar
`m2Sky` (app.js:3020, driven at :3256–3258 by `mission2.stage`) that the
environment block reads to lerp the sky and fog toward an overcast color, cut the
sun, raise the ambient floor, and thicken `scene.fog` (frame() app.js:6233–6241).
Precipitation is a camera-locked `THREE.Points` box that falls and wraps
(`ensureSnowPts`/`updateSnowPts`, app.js:3155–3181). Storm audio is a gain-steered
ambience bed (`ambSet('amb_wind', m2Sky*0.55)`, app.js:2558), and the engine
already has a synthesized white-noise source (`noiseBuf`, app.js:2244) feeding the
rotor. F3 is a refactor, not new tech: **generalize that storm machinery into an
ambient `updateWeather(dt)` engine** that runs on a real-world schedule, with the
mission-2 storm as its highest-priority source.

### User story
As a player wandering downtown on my second or third visit, sometimes it's a
clear afternoon and sometimes the rain rolls in and the streetlights bloom in the
fog — and my friend two blocks over is standing in the same rain, without either
of us doing anything to make it happen.

### Design decisions (resolved)
1. **Shared weather with zero server cost: a wall-clock-seeded deterministic
   schedule.** The current weather is a pure function of real wall-clock time —
   `period = floor(Date.now() / PERIOD_MS)`, then a tiny deterministic hash of
   `period` picks the state + intensity. Every client with a roughly correct
   clock computes the *same* weather for the same real minute with **no relay, no
   server change, no state-packet field**, and it works offline. This is the
   whole reason F3 needs no backend work. (Rejected: per-client random — breaks
   the shared world; server-authoritative — needless server + message-type cost
   for something derivable from the clock.)
2. **Weather runs on real time, decoupled from `simH`.** Per CLAUDE.md's sim-clock
   rule (day/night is scaled/pausable `simH`; traffic, signals, gameplay are real
   time — don't couple them), weather is real-wall-clock like traffic. Pressing
   time-speed `2`/`3` or setting `#h=` does **not** fast-forward the weather, and
   rain can fall at any `simH` time-of-day. The two axes are independent.
3. **Four states, mostly clear.** `CLEAR` (~60% of periods), `RAIN` (~20%),
   `FOG` (~12%), `OVERCAST` (~8%) — proposed weights, tuned in playtest. A period
   is ~8 min real time with ~25 s smooth transitions (the same
   `+= (target-cur) * min(1, dt*rate)` easing `m2Sky` uses). Clear dominates so
   the game's default bright look is the norm and weather is an occasional mood
   change, never constant gloom.
4. **Rain reuses the snow-particle pattern; fog reuses `scene.fog`.** Rain is a
   camera-locked `THREE.Points` box (generalized out of `ensureSnowPts`) with a
   faster fall, minimal drift, and a cool bluish-white tint. Fog is a smoothed
   bump to the existing `FogExp2` density plus a grey desaturation of the sky/fog
   color — essentially free, and on mobile a net perf *win* (shorter draw
   distance).
5. **Rain audio is synthesized, not a new asset.** A looping `noiseBuf` source
   through a bandpass filter, gain-steered by rain intensity (mirroring the rotor
   chain at app.js:2249–2259 and the `ambSet` steering pattern). No new baked
   audio file. **Do not reuse `amb_wind`** — it's a winter-flavored snow hiss
   baked for the storm and reads wrong under rain; if fog wants a whisper of wind,
   synthesize a separate low-passed noise bed, don't borrow the snow one.
6. **Yes to occasional thunder — cheap and synthesized.** During *heavy* rain
   only, a rare thunder one-shot (an enveloped low-pass `noiseBuf` burst, no
   asset) pairs with a single-frame renderer clear-color flash (a brief
   light-intensity spike — the only "lightning" possible with no post-processing).
   Long random intervals (proposed ~20–60 s, low probability), gated by `lt_snd`
   mute. It's the one beat of drama in an otherwise ambient system.
7. **The mission-2 storm always wins.** Ambient weather suppresses itself whenever
   `m2Sky` is active, so snow and rain are never on screen together and the
   snow emergency's storm is always the dominant sky.
8. **Weather is cosmetic only.** No effect on car handling, collisions, hit
   registration, or any mission timer (THE MELT keeps its own clock). Wet-road
   physics is a deliberate NEXT idea, not F3.

### The weather engine
- **State + schedule (`updateWeather(dt)`):** compute `period` from `Date.now()`,
  hash it to a target `{state, intensity}`, and smooth per-effect blend scalars
  (`wxRain`, `wxFog`, `wxGrey` 0→1) toward that target with `m2Sky`-style easing.
  Called once per frame in `frameStep` next to the other updaters (app.js:6200–6221
  region), before the environment block reads the scalars.
- **Applying it (environment block, frame() app.js:6231+):** extend the existing
  sky/fog math so the weather scalars contribute alongside `m2Sky` — lerp `skyC`/
  `fogC` toward the weather grey by `wxGrey`, cut `env.sun`, raise the hemi floor,
  and add a `wxFog * K` term to `scene.fog.density` (currently
  `0.0007 + env.night*0.00045 + m2Sky*0.0012` at :6241; weather adds one more
  term). Cap the total density so a heavy-fog period is still navigable (drive and
  read a block ahead — proposed ceiling ~0.003, tuned in playtest).
- **Precip:** generalize `ensureSnowPts`/`updateSnowPts` into a parameterized
  precip helper (color, size, fall speed, drift, count) so snow (mission) and rain
  (weather) are two instances of one system, camera-locked and wrapping the same
  way. Rain visibility/opacity follows `wxRain`.

### What it looks / sounds like
- **CLEAR:** the game exactly as today — full sun, base fog, no precip, no weather
  audio.
- **OVERCAST:** sky/fog desaturate toward grey, sun cut ~40%, a slight fog bump;
  no precip, no rain audio. The "something's coming" state.
- **RAIN:** rain falls (light→heavy by intensity) in a cool bluish-white — a
  deliberately *different* tint and a lighter sun cut (~55%) than the storm's
  snow-white `_snowSkyC` at 75%, so the snow emergency still reads as the worst
  sky in the game. Moderate fog bump, the synth rain hiss fading in with
  intensity, and — at heavy intensity — the occasional thunder boom + clear-color
  flash.
- **FOG:** heavy `FogExp2` density and grey desaturation, sun cut ~30%,
  negligible precip, and (optionally) a faint *separately-synthesized* wind bed —
  not the winter `amb_wind`. Streetlights and headlights (already night-driven)
  read beautifully through it.
- **Transitions:** every change eases over ~25 s — weather rolls in, it never
  hard-cuts.

### m2Sky / mission-storm precedence
`updateWeather` checks `m2Sky` first: while the snow emergency is active
(`m2Sky > 0.01`), the weather scalars are driven to 0 (fade out, don't snap) and
the ambient precip is hidden, so the mission's snow + overcast is the only weather
on screen. The existing `m2Sky` block in frame() (app.js:6233–6238) stays the
authority; weather only contributes when the storm scalar is idle. This guarantees
snow and rain are mutually exclusive and the mission always looks like the mission.

### Interactions with the rest of the game
- **Driving / jetpack:** purely visual — no handling change, the server's per-mode
  speed caps are untouched, and flying the jetpack through rain is fine.
- **Missions:** weather keeps running under every mission *except* SNOW EMERGENCY,
  which overrides it (above). A DEADLINE run or a horse wrangle can happen in the
  rain with no rule change.
- **Radio, happy accident:** NEWS 630's `news_wx` segment already reads a weather
  report that mentions fog, so on that station the world occasionally "reports" the
  weather with zero new work. Leave it as-is — don't try to sync the words to the
  actual sky (they're on independent schedules and the mismatch is harmless flavor).

### Controls / HUD surfaces touched
Weather is ambient, not a key-control, so the 4-surface control rule is light —
but:
- **SIM tray (`#tray`):** add a `WX` toggle (default on), persisted to
  `localStorage` (`lt_wx`), same pattern as the `WAYPT`/`box`/`lbl` toggles. Off
  forces clear — a clean-city preference and a perf escape hatch on weak devices.
- **Optional status readout:** a short weather word in the status chip row next to
  `SIG` (e.g. `WX RAIN` / `WX FOG` / `WX CLEAR`) — low priority, flavor only.
- **URL param `#wx=<state>`:** `clear|rain|fog|overcast` pins a fixed state
  (deterministic testing + capture); `#wx=off` disables weather entirely. Mirrors
  the `#h=` / `#wp=0` param style.
- **Dev hook:** under `#debug=1`, expose `window.__lt.wx` (get/set current state +
  intensity) so a CDP-driven capture can compose a deterministic rainy or foggy
  shot.
- **README:** one line in the world/atmosphere section — "Weather rolls through
  on a real-world schedule (rain, fog, overcast); everyone online sees the same
  sky." No new control-table row (it's not a keypress).

### Multiplayer behavior
- **Deterministic, zero relay.** Because the state is a pure function of the wall
  clock, every client computes the same weather with no server involvement, no new
  message type, and no state-packet field. Players near each other see the same
  rain; nothing new touches the server, `scores.json`, or the WS protocol.
- **Offline / bots-only:** identical — it's a local computation. Bots need no
  awareness of weather; it's a pure render layer.

### Performance / mobile degrade
- **Rain particle count scales with `IS_COARSE`** (app.js:8): full count (~1300,
  matching `snowPts`) on desktop, a reduced count (~500, tuned) on touch/coarse,
  and the per-particle sideways-drift `sin()` is skipped on coarse (rain falls
  straight down on mobile) to save the trig. No new shader, no new render pass —
  same `THREE.Points` the snow already uses. (`snowPts` isn't reduced on coarse
  today; rain must self-limit because it wants a denser field than snow.)
- **Fog is free-to-cheap:** `FogExp2` is already evaluated every frame; heavier
  fog shortens the visible range, which if anything *helps* the mobile fill rate.
- **The `WX` tray toggle + `#wx=off`** are the explicit escape hatches for any
  device that still struggles.

### Cine / capture hooks
- Under `#cine=1`, weather defaults to **clear** (deterministic — no random rain
  ruining a trailer take) unless `#wx=` pins a state or `__lt.wx` sets one.
- `#wx=rain`/`fog`/`overcast` + `__lt.wx` give the scripted-capture rig (the same
  `window.__lt` surface the route/cine primitives use) full control over a
  reproducible weather shot.

### Privacy
The only new key is `lt_wx` (weather on/off preference). It falls under the
"preference toggles" group the F2 privacy rewrite already introduced — F3 adds the
word "weather" to that clause (e.g. "...the objective waypoint, and weather") so
`web/privacy.html` stays exhaustive. Every storage access stays `try/catch`. No
new data is collected; `Date.now()` is the wall clock, not a fingerprint.

### Edge cases
- **Clock skew between clients:** sub-second differences are invisible (periods
  are ~8 min, transitions ~25 s). A client whose system clock is minutes wrong
  sees different weather — a rare, purely cosmetic edge; acceptable, and noted.
- **Mission 2 starts mid-rain:** ambient rain fades out (not a hard cut) as
  `m2Sky` rises; on mission end, ambient weather eases back to whatever the
  schedule now says.
- **Time-speed / `#h=`:** changing `simH` speed or start hour never moves the
  weather (real-time decoupled); rain at "night" `simH` is fine — the effects are
  additive on top of the day/night color.
- **`WX` off or `#wx=off`:** `updateWeather` drives all scalars to 0 and hides
  precip; the sky is exactly the vanilla day/night look.
- **localStorage throws:** `lt_wx` read/write is wrapped; on throw, default to
  weather-on, no console error.
- **Fog vs. gameplay fairness:** fog is visual only — freeze-tag hit validation is
  server-side by distance and unaffected; car collision is unchanged. Nobody is
  disadvantaged by not seeing as far.
- **Precip and the storm colliding:** guarded by the `m2Sky` precedence — snow and
  rain can never both be visible.

### Non-goals (F3)
- **No gameplay effect** — no wet-road handling, no fog-reduced hit ranges, no
  weather-driven mission changes (THE MELT keeps its own timer). Cosmetic only.
- **No server-authoritative weather, no new message type, no state-packet field.**
- **No new baked audio asset** — rain and thunder are synthesized from the
  existing noise path.
- **No post-processed lightning bolts, no wind-blown objects, no
  puddles/reflections/wet-street shaders** — thunder is a synth boom plus a cheap
  clear-color flash and nothing more; the rest is NEXT-tier polish.
- **No coupling to `simH`** (time-of-day) — weather is its own real-time axis.

### Acceptance checklist — F3 Weather Beyond the Storm

Two tabs for the sync check; one tab covers the rest. Standing gate first
(`node --check` both files, `npm test`).

- [ ] **Deterministic shared weather.** Open two tabs at the same time → both show
      the same state + intensity (rain in both, or clear in both). Confirm **no**
      new WS traffic drives it (it's clock-derived, not relayed).
- [ ] **Smooth transitions, not hard cuts.** Force a change (e.g. `#wx=rain` then
      toggle off, or a shortened `PERIOD_MS` in dev) → the sky/precip/fog ease over
      ~25 s.
- [ ] **Rain renders and is camera-locked.** In `#wx=rain`, precipitation falls,
      follows the camera across the whole map (no empty gaps while driving), and
      reads as rain, not snow.
- [ ] **Fog reduces visibility but stays navigable.** In `#wx=fog`, draw distance
      drops and the sky greys, yet you can still drive a block and read the road.
- [ ] **Rain audio via synth noise.** RAIN adds a rain hiss from the synthesized
      noise path (no new file in `web/audio/`); `lt_snd` mute silences it; it fades
      with intensity.
- [ ] **Thunder + flash, heavy rain only, respects mute.** In sustained heavy rain,
      an occasional thunder boom pairs with a brief screen flash; it never fires in
      light rain/fog/clear, and `lt_snd` mute silences the boom (the flash may still
      show — it's visual). No new audio file appears in `web/audio/`.
- [ ] **Mission storm wins.** Start SNOW EMERGENCY → ambient rain fades out; only
      the mission's snow + overcast shows. End the mission → ambient weather eases
      back. Snow and rain are never on screen together.
- [ ] **`#wx=` forces a state.** `?v=1#wx=fog` loads straight into fog;
      `#wx=clear` forces clear; `#wx=off` disables weather (vanilla sky).
- [ ] **`WX` tray toggle + persistence.** SIM tray `WX` off → weather clears and
      stays off after reload (`lt_wx==='0'`); on → resumes.
- [ ] **Time-speed independence.** Press `2`/`3` (fast day/night) or load `#h=13`
      → the weather does not fast-forward or reset; it stays on its real-time
      schedule.
- [ ] **`#cine=1` deterministic.** Under cine, default is clear (no random rain in
      a trailer take) unless `#wx=` pins a state; `__lt.wx` can set state for a
      scripted shot.
- [ ] **Mobile degrade.** On a coarse-pointer profile (or emulated touch), rain
      uses the reduced particle count and the frame rate holds; fog is unaffected.
- [ ] **Privacy honest.** `lt_wx` is the only new key and is covered by the
      privacy page's "preference toggles" clause (now including weather); storage
      access is `try/catch`.
- [ ] **Standing gate green.** `node --check web/app.js && node --check server.js`
      pass and `npm test` is all green.

### Notes for the architect (F3)
- **Generalize, don't fork.** Extract a precip helper from
  `ensureSnowPts`/`updateSnowPts` (app.js:3155–3181) parameterized by
  color/size/speed/drift/count; snow and rain become two instances. Extract the
  overcast sky-blend so `m2Sky` and the weather scalars feed one application path,
  with `m2Sky` taking precedence.
- **Weather scalars live with the other blend state and are read in the
  environment block** (frame() app.js:6231+) exactly like `m2Sky` — add one
  `wxFog*K` term to the `scene.fog.density` line (:6241) and one `wxGrey` lerp
  next to the `m2Sky` sky lerp (:6234–6235).
- **`updateWeather(dt)` is a real-time updater** — call it in `frameStep`
  alongside `updateCars`/`updatePeds` (which are also real-time), **not** gated by
  `paused`/`simH`. Keep the `Date.now()`-seeded hash tiny and deterministic
  (mulberry32 or a sine-hash) so all clients agree.
- **Respect top-level statement order** — declare the weather registries/scalars
  (`wxRain`, `wxFog`, `wxGrey`, the rain `Points`) before the sections that read
  them, per the documented crash class.
- **The privacy one-word addition ships with the code** — `lt_wx` joins the
  preference-toggles clause F2 wrote; don't let the disclosure lag the key.

---

## F4 — Private Worlds / Rooms

**Why this matters.** F1–F3 make the *shared commons* better; F4 lets you leave
it. A shareable room code turns "the public Lexington everyone is in" into "*our*
Lexington" — you and the friends you invited, no strangers, no leaderboard
farmers, no moderation surface. It's the strongest together-play retention lever
in the phase: the reason you send a friend a link is that the link drops them
into a world that's yours. And it's almost free — the relay already has one
`clients` Map and one `broadcast()` chokepoint, so "rooms" is a *scoping* layer,
not a new subsystem: no new message type, no database, no create/validate
round-trip.

**The problem, mechanically.** There is no room concept today — it's greenfield.
Every connection lands in one global world: `broadcast(msg, except)` (server.js:228)
fans every relay out to *all* `clients` (the ~20 call sites: state, chat, heli,
shot, frozen, ride, pushed, rocket, spray, mission announce, leave…), the
`welcome` peers list (server.js:388) is everyone, and the news chopper is a single
module-level `HELI` singleton. F4 threads a sanitized room code from a connect-time
`?room=<code>` query param (the exact precedent already exists for
`?npc=<token>`, parsed crash-safely inside the connect `try/catch`) into a
`client.room` field, and scopes the three things that leak across worlds:
**broadcast fan-out**, the **welcome peers/heli snapshot**, and the **singleton
heli** (which becomes per-room). Everything else — rate limits (per-client), bans
(global by design), the score boards — is either already room-agnostic or is
*deliberately* kept global.

### User story
As someone who wants to mess around with two friends and not thirty strangers, I
open the game, type a room code (or click a link one of them sent), and the three
of us get our own downtown Lexington — our chopper, our chat, our chaos — while
the public commons keeps running without us.

### Design decisions (resolved)
1. **Implicit rooms — a code is a room the instant someone uses it.** No
   create/register/validate step, no server round-trip: connecting with a new
   `?room=DERBY` *is* the room. Codes are sanitized like names (`A-Z0-9_-`, ≤12
   chars, case-folded up). Absent or empty room = the **PUBLIC commons**, and
   every existing URL behaves exactly as today. A code collision between strangers
   just means they share a world — a curiosity for strangers, the whole point for
   friends. (Matches the `?npc=` precedent and keeps the server stateless.)
2. **No global-board writes from private rooms.** The public leaderboard is
   called "public" in `web/privacy.html` and is a farming/pollution vector, so a
   `{t:'score'}` from any non-PUBLIC room is dropped. The player still gets their
   **DEVICE BEST** (localStorage `lt_mN_best`, which already saves in every room)
   and the WIN modal shows a subtle honest line — `PRIVATE ROOM · TIMES DON'T
   RANK`. No room-local board (that would need per-room server state + persistence,
   against the stateless design). Enforced in **both** layers: the client
   suppresses the submit, and the server ignores score from a non-PUBLIC client
   (clients are untrusted).
3. **Ambient NPCs are PUBLIC-only.** `bots/npcs.mjs` connects without `?room`, so
   it lands in the commons and needs no change. Private rooms are quiet by design —
   the life in your room is the friends you invited, not synthetic chatter. (This
   also means the F3-phase-1 NPC feature scopes itself correctly for free.)
4. **The share mechanism is the link; a little UI makes it discoverable.**
   Primary: a hash-link `#room=CODE`, parsed next to `#name=` (app.js:1593) and
   **baked once into the ws URL** (app.js:4918) so auto-reconnect keeps the room
   with zero extra work. Discoverability: a small **PRIVATE ROOM** field in the
   tutorial modal near `#nameIn`, plus a **COPY ROOM LINK** button that copies the
   current URL *with* `#room=` but *without* `#name=` (your friend picks their own
   name). Optional nicety: a `/room CODE` chat command that rewrites the hash and
   reloads. **No live room-switch protocol** — switching rooms is a reload with a
   new hash (cheap, and the welcome handshake already re-syncs cleanly).
5. **Every room gets its own chopper.** The singleton `HELI` becomes a per-room
   map (research says it's ~6 numbers + a pilot id each), created lazily at the pad
   and dropped by empty-room GC. The mission-1 heli unlock is client-local
   (`lt_heli_unlock`), so a player who's earned it can fly in *any* room, including
   a brand-new private one.
6. **A room is a code, not a lock.** Codes are guessable and there's no password —
   stated plainly in the tutorial and one line of `web/privacy.html`. This is a
   "your own instance," not a security boundary; the honesty is the feature.
7. **Admin and bans stay global.** Bans are checked at connect against ip+name
   regardless of room (rooms must not become a ban-evasion trick). A global admin
   acts across all rooms; `/list` and `/stats` gain a room column/breakdown, and
   `/announce` stays global by default with an optional room argument.

### The scoping model (what changes, centrally)
- **Connect (`?room=<code>`):** parse + sanitize the room in the same crash-safe
  `try/catch` that reads `?npc=` today; store `client.room` (a PUBLIC sentinel
  when absent). Bans are checked here, unchanged and global.
- **`broadcast(msg, except, room)`:** the one chokepoint (server.js:228) gains a
  room filter; every call site passes the acting `client.room`. This single change
  scopes state, chat, freeze, ride, pushed, shot/rocket/spray, mission announce,
  and leave — the whole relay — to the sender's world. It also *reduces* fan-out
  cost (O(room), not O(everyone)).
- **`welcome` (server.js:388):** the peers list and heli snapshot are filtered to
  `client.room`. The client's welcome handler is already room-agnostic — it renders
  whatever peers/heli it's handed.
- **Per-room heli:** a `helis` Map keyed by room; `enter`/`exit`/`deny`/`hp`/
  `down`/`snap` and the pilot-disconnect crash all operate on the room's heli.
- **Empty-room GC:** when the last client leaves a room, discard the room and its
  heli. Nothing GCs today — this is the one genuinely new lifecycle bit, and it
  bounds the room count to the live-connection count (so no separate room cap is
  needed; per-connection caps are an accepted, out-of-scope risk per the research).
- **Ride-shotgun (F1) interaction:** the `seats`/`seatOf` maps stay keyed by
  global player id — no change needed. Because state is now room-scoped, a player
  only ever *sees* (and can only board) a driver in their own room, so no
  cross-room seat binding is possible for free.

### Scores in a private room (precise behavior)
- Client: when `room !== PUBLIC`, `submitScore()` / the mission `{t:'score'}`
  sends are skipped; the mission still saves `lt_mN_best` and opens the WIN modal
  with the `PRIVATE ROOM · TIMES DON'T RANK` line.
- Server: a `{t:'score'}` from a client whose `room !== PUBLIC` is ignored (no
  board write, no announce broadcast) — defense-in-depth against a hacked client.
- The global board, its top-50 persistence, and the `{t:'scores'}` broadcast are
  otherwise untouched.

### Controls / HUD surfaces touched
- **Net chip (`setNetChip`, app.js:4740):** show `ROOM <CODE>` when in a private
  room; the PUBLIC commons keeps the existing `NET: ONLINE · PEERS N` (optionally
  `· COMMONS`). This is the always-visible "which world am I in" signal.
- **Tutorial modal (`#tut`, near `#nameIn`):** a **PRIVATE ROOM** field (type a
  code) + a **COPY ROOM LINK** button + one line: "Share this link and you get
  your own Lexington — a room code is a code, not a password." 
- **URL param `#room=<code>`:** the canonical share/enter mechanism, listed in the
  README URL-params table next to `#name=`, `#h=`, `#wx=`.
- **Optional `/room CODE` chat command:** rewrites the hash and reloads (no
  live-switch). If included, mention it in the tutorial; it's not a keypress so the
  `#help` bar is unaffected.
- **README:** a "Private rooms" blurb in the multiplayer section + the `#room=`
  row in the params table.
- **`web/privacy.html`:** one sentence — a room code, like your name, is visible to
  others in the room and may appear in the short-lived server logs (the roster and
  JSONL events gain a room field). Ships with the code, per the F2/F3 privacy
  discipline.

### Multiplayer behavior
- **No new message type.** Rooms are a connect-time param plus a broadcast filter
  plus per-room heli state — the entire client/server message protocol is
  unchanged. This is the elegance of the design and the reason it's low-risk.
- **PUBLIC is the default everywhere.** Absent `?room`, every current URL, the NPC
  process, and the score path behave identically to today — F4 is strictly
  additive.
- **Offline / LOCAL-SIM:** you're alone regardless of room; the `#room=` hash is
  still parsed and baked into the ws URL so that *when* you reconnect online you
  land in the right world.

### Edge cases
- **Malformed `?room` in `req.url`:** the connect parse is already inside the
  crash-safe `try/catch` (the `?npc=` precedent); any parse failure sanitizes to
  empty → PUBLIC. A never-crash guarantee, not a best-effort.
- **Room empties then someone rejoins the same code later:** it's a *fresh* room
  (heli reset, no history) — correct for an ephemeral, stateless design.
- **Reconnect after a server restart / drop:** the room is baked into the ws URL
  once at boot, so the auto-reconnect/backoff path preserves it and the welcome
  handshake re-syncs the room's peers + heli.
- **Ban evasion via a new room:** impossible — bans are global (ip+name at
  connect), independent of room.
- **Score submitted from a private room by a modified client:** server drops it
  (layer 2), board stays clean.
- **NPC in a private room:** can't happen — NPCs never pass `?room`, so they're
  always PUBLIC.
- **Heli unlock in a fresh private room:** works — the unlock is client-local
  (`lt_heli_unlock`), so an earned chopper is available in any room.
- **COPY ROOM LINK carrying a name:** the copied URL includes `#room=` but strips
  `#name=`, so the invitee names themselves.
- **Admin across rooms:** `/kick`/`/ban` reach a target in any room; `/announce`
  hits every room unless a room arg is given; `/list`/`/stats` show the room so an
  operator can tell worlds apart.

### Non-goals (F4)
- **No registered/reserved rooms, no passwords, no ownership/roles** — implicit,
  ephemeral, code-is-not-a-lock.
- **No per-room leaderboards or per-room persistence** — the only board is the
  global PUBLIC one; private-room times live only as local DEVICE BEST.
- **No live room-switching protocol** — switching is a reload with a new hash.
- **No connection caps / anti-abuse limits** — none exist today; the research flags
  this as an accepted, out-of-scope risk (empty-room GC is the only lifecycle F4
  adds).
- **No new message type, no database, no cross-room presence** ("who's in which
  room" beyond the admin roster).

### Acceptance checklist — F4 Private Worlds / Rooms

**Three tabs:** A and B share a code, C is PUBLIC. Standing gate first
(`node --check` both files, `npm test`).

```bash
ADMIN_TOKEN=qa-admin PORT=8080 node server.js
```

- Tab A: `http://localhost:8080/?v=1#room=DERBY&name=ALICE`
- Tab B: `http://localhost:8080/?v=1#room=DERBY&name=BOB`
- Tab C: `http://localhost:8080/?v=1#name=CAROL` (PUBLIC commons)

- [ ] **Isolation — presence.** A and B see each other move/chat; C sees neither.
      C's movement/chat never reaches A or B. `peerCount` in each chip reflects
      only same-room peers.
- [ ] **Isolation — chat.** A chat line in DERBY appears for A and B only; a line
      in PUBLIC appears for C only.
- [ ] **Isolation — heli.** A boards the chopper in DERBY; B sees A flying; C sees
      the PUBLIC chopper still parked and can board it independently. Two choppers,
      two rooms, no interference. Downing one doesn't affect the other.
- [ ] **Isolation — leave.** Close Tab A → B sees ALICE leave; C sees nothing
      change. If A was DERBY's pilot, DERBY's heli crashes/resets but PUBLIC's is
      untouched.
- [ ] **Net chip.** A and B show `ROOM DERBY`; C shows the PUBLIC `NET: ONLINE ·
      PEERS …` (no room / `COMMONS`).
- [ ] **Reconnect keeps the room.** Restart the server (or drop A's socket) → A
      auto-reconnects back into DERBY (not PUBLIC), re-syncing B and the room heli.
- [ ] **Share link works.** Use COPY ROOM LINK in B; open the copied URL in a
      fresh tab with a new name → it lands in DERBY (room preserved, name not
      carried over).
- [ ] **Scores policy.** Beat a mission in DERBY → no global-board write, no chat
      announce in any tab, the WIN modal shows `PRIVATE ROOM · TIMES DON'T RANK`,
      and `lt_mN_best` still updates locally. Beat the same mission in PUBLIC (Tab
      C) → it *does* hit the board and announce. (Also confirm a raw `{t:'score'}`
      forced from a DERBY client is ignored server-side.)
- [ ] **NPC placement.** With `bots/npcs.mjs` running, NPC chatter/walkers appear
      in PUBLIC (Tab C) only — never in DERBY.
- [ ] **Implicit + sanitized.** `#room=derby`, `#room=DERBY`, and
      `#room=Derby!!` all resolve to the same sanitized `DERBY`; an absent room is
      PUBLIC and behaves exactly like a current URL.
- [ ] **Admin across rooms.** `/list` (as admin) shows a room column with ALICE/BOB
      in DERBY and CAROL in PUBLIC; `/announce hi` reaches all three; a `/ban`
      persists globally (target can't rejoin via a different room).
- [ ] **Privacy honest.** `web/privacy.html` states room codes are handled like
      names (visible in-room, may appear in short-lived logs); the roster/JSONL
      gain a room field; no new persisted user data.
- [ ] **Standing gate green.** `node --check web/app.js && node --check server.js`
      pass and `npm test` is all green.

### Notes for the architect (F4)
- **Scope the chokepoint, don't touch the call sites' logic.** Add the room filter
  inside `broadcast` (server.js:228) and pass `client.room` from each site; the
  message shapes don't change. Watch the handful of `broadcast(msg, null)` calls
  (freeze, heli, ride, pushed, mission announce) — they must pass the acting
  client's room explicitly since there's no `except` ws to derive it from.
- **`client.room` is set once at connect** from the sanitized `?room=`; reuse the
  name-sanitizer (`A-Z0-9_-`, ≤12, upper). PUBLIC is a sentinel (e.g. empty
  string) so "no room" and "commons" are the same code path.
- **Per-room heli = a `Map`, plus the one new GC.** Everywhere that reads/writes
  the `HELI` singleton keys by room; when a room hits zero clients, delete its heli
  and room entry. This is the only new lifecycle — test the pilot-disconnect and
  last-leaver paths per room.
- **Score gate is two-sided.** Client skips the send when `room !== PUBLIC`; server
  ignores `{t:'score'}` when the sender's `room !== PUBLIC`. Don't rely on the
  client alone.
- **Bake the room into the ws URL once** (app.js:4918) so reconnect is automatic;
  parse `#room=` next to `#name=` (app.js:1593). Don't thread the room through
  every reconnect call — one baked URL is the whole mechanism.
- **The privacy line + the roster/JSONL `room` field ship with the code**, per the
  F2/F3 discipline — the disclosure names the new field the moment it exists.

---

## F6 — Mission 8: "LOOSE IN THE PADDOCK" (freeze blaster at the horse farms)

**Why this mission.** It pays off the roadmap's exact NEXT wording ("a mission
that leans on the under-used systems — the jetpack, the freeze blaster, the horse
farms past New Circle") with the smallest honest build: it reuses the m7 "tag N
against a timer" skeleton and the m4 horse-state machine, and sends players to the
gorgeous Elmendorf bluegrass belt north of New Circle that almost nobody ever
sees. The freeze blaster is the game's most-built, least-purposeful toy — it only
exists for PvP freeze-tag today — and this hands it a job. One well-scoped new
mechanic (a dart that can hit a *mission entity*, not just an opted-in player)
unlocks the whole thing.

**The HORSEPOWER lesson, applied.** m4 is the cautionary tale: median session is
**86 seconds**, m4's only-ever completion took **9.4 minutes**, and **1 of 138**
players who started it finished. m8 is designed against that data:
- **Target first-timer completion: 90–150 seconds.** Not a marathon.
- **Restart-friendly:** the start ring sits *inside* the paddock, so a fail is an
  instant `E`-to-retry where you're standing — never a long walk back from
  downtown (m4's ring is downtown, its horses are scattered to three corners of
  the map; that walk-back is half of why it fails).
- **Failure is cheap and legible:** a generous countdown, a clear "you missed"
  caption, foals respawn on retry.
- **Forgiving core loop:** one clean dart reliably settles a foal; the skill is
  *aim on a moving target against the clock*, not a punishing tiptoe-or-it-bolts
  timing window like m4's spook rule.

### The HORSEPOWER lesson in numbers (for the server board)
- **In-mission budget (fail deadline): ~180 s.** A competent first-timer finishes
  in the 90–150 s target with real margin; a fumbled first run times out at 180 s
  and retries instantly.
- **Server board WIN plausibility window: `m8: [15000, 300000]` ms** (15 s floor,
  5 min ceiling). The floor rejects implausibly-fast submits (you physically
  cannot reach and dart three scattered foals in under ~15 s); the ceiling sits
  well above the 180 s budget so every legitimate win validates. This is anti-cheat
  plausibility, *distinct* from the in-mission budget — both numbers tuned in
  playtest.
- **Score = elapsed time to pen all three** (lower is better), exactly like m5/m7.

### User story
As a player who's beaten the downtown jobs, my gold marker points me north across
New Circle to a bluegrass horse farm I've never seen. Three foals are loose before
the yearling sale; I settle each one with a calming dart and they trot into the
pen — and my time lands on a new board.

### Premise & personality
LEXTOWN missions are Lexington-flavored comedies (THE MELT = an ice-cream run;
TAILGATE COMPLIANCE = canopy tagging). **LOOSE IN THE PADDOCK**: the night before
the Keeneland yearling sale, three foals jumped the rail at Elmendorf, and the
farm foreman needs them settled and penned before the sales inspectors show up at
dawn. Caption beats via the existing `capIdx` + `#caption` DOM bar (no new audio —
like m4/m7), all printable ASCII:
- **Brief (`capIdx` 0):** `THE FOREMAN - THREE FOALS JUMPED THE RAIL BEFORE THE
  SALE. SETTLE THEM WITH THE DART AND THEY WALK THEMSELVES TO THE PEN.`
- **First-attempt coaching (once, `lt_m8_coached`):** `AIM AHEAD OF A MOVING FOAL -
  THE DART TAKES A BEAT TO GET THERE.`
- **Progress:** `ONE SETTLED - TWO STILL OUT.` then `TWO PENNED - ONE MORE.`
- **Win:** `THAT IS ALL THREE, HOME BEFORE THE INSPECTORS. GOOD HANDS.`
- **Fail:** `THEY BOLTED FOR PARIS PIKE. RESET AND TRY AGAIN.`
- **Radio flavor (optional, needs an audio regen — not required to ship):** a
  TRACKSIDE 1450 tip-sheet line for the `tr_tips` pool — `And a live one from
  Elmendorf: three yearlings slipped the fence before the sale, so if you spot a
  foal on Paris Pike, that is not a mirage.` Ships whenever audio is next baked; the
  mission itself needs no new asset.

### UX flow
1. **Get there.** After m7 is beaten, F1's gold waypoint + route ribbon point
   north to `M8_TRIG` in the Elmendorf paddocks (past New Circle). Reachable on
   foot, by car, or by jetpack; the ★ label marks the ring.
2. **Start.** On foot at the ring, idle, `E` → the foreman brief fires and the
   mission enters its `wrangle` stage; a ~180 s countdown starts (shown in the HUD
   hint). Three foals are loose in the paddock, wandering and scattering.
3. **Settle each foal.** Draw the blaster (`G`) and fire (`F`/click). A dart that
   strikes a `loose` foal **calms** it (an ice-blue settle shimmer — the freeze
   vocabulary players already know from tag); the calmed foal trots itself toward
   the central pen ring and **pens**. The counter ticks `1/3 → 2/3 → 3/3`.
4. **Foals bolt.** Rush within a foal's spook radius (the m4 mechanic) and it
   breaks and runs — so you line up darts on moving targets from a few meters out,
   leading them slightly (darts travel ~38 m/s). This is the whole skill.
5. **Win.** All three penned before the clock → win; the elapsed time submits to
   the new `m8` board (`{t:'score', ms, m: 8}`), the WIN modal shows the `m8`
   leaderboard, and the chat announce fires. **Miss the clock** → fail caption,
   mission resets to `idle`, no submit — `E` at the ring restarts immediately.
6. **Replayable** like every mission; local best in `localStorage lt_m8_best`;
   `m8Best` gates the waypoint progression (and closes the objective chain).

### The one net-new mechanic: a dart that hits a mission entity
Today darts only test against `remotes` (opted-in players + bots) in
`updateDarts` (app.js:1680–1715); nothing else is dart-hittable. m8 adds a
**mission-entity hit path**, specified at the product level:
- **What it hits:** while `mission8.stage === 'wrangle'`, each in-flight *mine*
  dart also tests against each `loose` foal (a small proximity check, ~2.5 m). Only
  *your* darts matter — the mission is client-side/solo, so other players' dart
  relays are cosmetic and never touch your foals.
- **What it feels like:** a hit consumes the dart and flips the foal `loose →
  calm` — a brief ice-blue shimmer (reusing the frozen look), a soft settle chime
  (reuse the existing freeze SFX, no new asset), then the foal trots to the pen.
- **Re-thaw timer:** the calm lasts ~8 s — long enough that a foal darted anywhere
  near the (centrally placed) pen reaches it and pens in normal play. If a foal is
  darted far out and the calm lapses before it pens, it **re-bolts** (the re-thaw
  fallback) and you re-dart it. So the timer is real and teaches "settle them near
  the pen," but normal play pens on the first dart — deliberately forgiving.
- **PvP opt-in — the surprising side effect, fixed.** `fireDart()` currently
  auto-opts you into PvP on the first press (`setPvp(true)`, app.js:1646), which
  would make a foal-wrangling player suddenly freezable by strangers — a genuinely
  confusing side effect. **Decision: while a blaster mission is active, darts do
  NOT auto-opt you into PvP.** The first press fires the calming dart directly; you
  stay un-taggable for the duration (thematically right — you're working, not
  dueling), and you're not left opted-in when the mission ends. This mirrors the
  existing context-guard precedent where `setPvp` already refuses to opt in a
  passenger (`if (on && player.ride) return`, app.js:1637). A stray mission dart
  that happens to strike an opted-in bystander still freezes them per existing
  logic — harmless and vanishingly rare up in the empty paddocks, not worth
  special-casing.

### Design decisions (resolved)
1. **Concept #2, LOOSE IN THE PADDOCK** — freeze blaster + horse farms, per the
   roadmap and the team steer. (#1 AIR MAIL is the cheaper jetpack mission and is a
   great *F7* later; #3 SKY MARSHAL blends jetpack+freeze but is a bigger build.
   Blending would blow the 90–150 s target — one mission, one system pairing.)
2. **Three foals, one dart each to settle**, forgiving by design (the HORSEPOWER
   lesson). Difficulty comes from foals scattering/bolting, not from a punishing
   timing window.
3. **Start ring inside the paddock** so retry is instant where you stand — no
   walk-back. The waypoint carries first-timers there.
4. **On-foot mission** — the blaster only fires on foot (`!player.veh &&
   !player.ride`), so the wrangle is on foot; get there however you like.
5. **No PvP auto-opt while wrangling** (above) — the one behavioral tweak to the
   shared blaster.
6. **Instrument the funnel from day one** — emit start / first-pen / win / fail
   telemetry events (the same instrumentation F5 is retrofitting onto m4) so we can
   *measure* completion rate instead of guessing, and tune the budget/spook radius
   with data. Applying the HORSEPOWER lesson proactively is a first-class goal.

### Discoverability
- **Gold ★ label:** `labels.push({name:'★ MISSION: LOOSE IN THE PADDOCK', x, y, z,
  col: MISSION_COL, mission:true})` at `M8_TRIG`, next to the other seven
  (app.js:4354–4360). `mission:true` hides it during any active mission.
- **`nextMissionHint()`:** append `if (!m8Best) return 'NEXT MISSION: LOOSE IN THE
  PADDOCK - AMBER RING AT ELMENDORF (NORTH, PAST NEW CIRCLE)';` before the final
  `return ''` (app.js hint chain, after the m7 branch).
- **F1 waypoint:** `currentObjective()` retargets to `M8_TRIG` once m7 is beaten,
  and the route ribbon draws the road north — this is the primary "how do I find
  the north map" answer.
- **Ring color + location:** a **warm amber / chestnut** ring (the color of a bay
  coat), visually distinct from the existing teal (m3) / green (m4) / pink (m6) /
  blue (m7) / gold (m1,m5) rings. Proposed `M8_TRIG` near the Elmendorf paddock
  gate (roughly `{x:-430, z:-1300}`, inside the `paddock(-505,-1480,-350,-1300)`
  block) with a central pen ring (~`{x:-410, z:-1360}`) — **verify both sit on
  walkable paddock ground in playtest**, not inside a barn or pond.
- **Start gate includes `!player.ride`:** the `E` check is `allIdle() &&
  !player.veh && !player.ride && !isFrozen() && nearM8Trig()` — passenger mode
  (F1) landed, so every new mission must gate on `!player.ride` alongside
  `!player.veh` (mirroring `fireDart`/`inCar()` at app.js:1645/2416).

### Build checklist (follow MODDING.md §"(c) A new mission", lines 286–341)
The published 9-step recipe is the build spec; the mission-8 specifics per step:
1. **Island layout (statement order!):** declare `M8_TRIG`, `M8_PEN`, `M8_BUDGET`,
   `m8Best` (from `lt_m8_best`), the `mission8` state object (`{stage:'idle',
   tStage, t0, ms, penned:0, capIdx:0}`), and the `m8Foals` array as top-level
   `var`s **before** the `labels.push` block and any builder that fills them — the
   documented `vehicles`-before-init crash class.
2. **Join `allIdle()`** (app.js:4339): add `&& mission8.stage === 'idle'`. **The
   single easiest thing to forget** — miss it and two missions run at once.
3. **Gold ★ label** (above).
4. **`nextMissionHint()` branch** (above).
5. **`E` branch in the enter/fire handler:** `if (allIdle() && !player.veh &&
   !player.ride && !isFrozen() && nearM8Trig()){ startMission8(); return; }` next
   to the other `nearMxTrig()` checks, plus the `nearM8Trig()` helper.
6. **Per-frame `updateMission8(dt)`:** the `idle → wrangle → won → post → idle`
   (win) / `wrangle → fail → idle` (timeout) state machine; per-foal
   `loose/calm/trot/penned` sub-states (copy m4's horse machine, drop the
   follow/riding states); countdown off `performance.now()` + `M8_BUDGET` (**not**
   `simH`); HUD hint shows `LOOSE IN THE PADDOCK · PENNED n/3 · <s>s LEFT`. Extend
   `updateDarts` with the foal hit path (above).
7. **Leaderboard UI:** on win `showScores(mission8.ms, 8)`; add `#scoreList8`
   (`<ol>` + `<h2>` + its CSS rule) to `web/index.html`; add the `board === 8`
   verb (`FOALS PENNED IN `) + `m8Best` to the score modal (app.js:2801–2815) and
   `'scoreList8'` to the `renderScores` forEach.
8. **Server board (server.js) — FOUR edits, all easy to miss:**
   - `BOARDS` (:160) → add `'m8'`.
   - the `scores` init literal (:163) → add `m8: []`. *(This is the exact literal
     that was missing m6/m7 before — don't repeat that bug.)*
   - the score map (:602) → add `8: 'm8'`.
   - the per-board `WIN` object (:603–606) → add `m8: [15000, 300000]`.
   - and the chat-announce map (:618–625) → add `m8: `${n} settled the foals in
     ${sec}s``.
9. **README + tutorial:** add the LOOSE IN THE PADDOCK blurb to the README mission
   list and a `#tut` grid line in `index.html`.

> **The numeric-`m` trap (MODDING.md).** Send `{t:'score', ms, m: 8}` — the
> **number** 8, not the string `'m8'`. The server maps `{…, 8:'m8'}[msg.m] ||
> 'm1'`; a string `'m8'` misses the map and lands your times on the
> **ribbon-cutting** board.

### Multiplayer behavior
- **Entirely client-side**, like every mission. Foals, the pen, darts-vs-foals,
  and the countdown are all local; nothing is relayed. Only the final `{t:'score',
  ms, m:8}` touches the server → validated against `WIN.m8` → `scores.json` →
  `{t:'scores'}` broadcast + chat announce (all board-generic already).
- Other players just see you on foot firing your blaster via the existing cosmetic
  `shot` relay; they never see your foals or your mission.
- **Offline / bots-only:** fully playable; the score submit no-ops offline (as
  scoring already does), local best still saves.
- **Private rooms (F4):** in a non-PUBLIC room the score doesn't rank (F4's gate),
  but the mission plays and `lt_m8_best` still saves — no extra work, it inherits
  F4's behavior.

### Edge cases
- **Player enters a car / jetpacks mid-wrangle:** the blaster holsters (can't fire
  from a vehicle), but the countdown keeps running; land/exit and resume darting.
  (Don't pause the clock — same as m5.)
- **A foal's calm lapses before it pens:** it re-bolts (re-thaw fallback); re-dart
  it. Guarantees no soft-lock where a foal is stuck "calm" forever.
- **Player frozen by a stray PvP dart before starting:** the start gate includes
  `!isFrozen()`, so they can't start while frozen; during the wrangle they're not
  opted into PvP (above), so they can't be frozen mid-mission.
- **Foal pathing into a fence/pond/barn:** the pen is placed centrally on open
  paddock ground; verify foal trot paths don't clip landmarks in playtest (the m4
  trot-to-`M4_PEN_T` logic is the reference).
- **Concurrent-mission guard:** `allIdle()` must include `mission8` or two missions
  run at once (the documented failure mode).
- **Retry spam:** `E` re-inits cleanly (foals removed + respawned), like m4's
  `resetMission4`.

### Non-goals (F6)
- **No jetpack requirement** — this is the freeze-blaster mission; AIR MAIL (the
  jetpack mission) is a separate future F7, per the steer.
- **No new multiplayer/co-op wrangle** — solo against the clock and the board, like
  every mission.
- **No new mechanic beyond the dart-vs-entity hit path** — no lasso, no riding, no
  new vehicle.
- **No new baked audio** to ship the mission (captions carry it; the TRACKSIDE
  line is an optional future flavor add).
- **No map growth** — the Elmendorf paddocks already exist; the ring and pen live
  inside current `WORLD` bounds.
- **No change to the freeze-tag PvP rules** beyond suppressing the auto-opt-in
  during a blaster mission.

### Acceptance checklist — F6 Mission 8: LOOSE IN THE PADDOCK

Precondition: m1–m7 beaten, every mission idle. Use the fast-forward
`localStorage` recipe in `test/CHECKLIST.md` to set the seven bests, leave
`lt_m8_best` cleared, reload. Standing gate first (`node --check` both files,
`npm test`). Two tabs for the multiplayer/announce checks.

- [ ] **Waypoint carries you north.** With m7 beaten and m8 not, F1's gold marker +
      route ribbon point to `M8_TRIG` in the Elmendorf paddocks; the ★ LOOSE IN THE
      PADDOCK label renders at the ring and hides during any active mission.
- [ ] **Start gate is `allIdle` + on-foot + not-riding.** On foot at the amber
      ring, `E` starts it only when every mission is idle and you're not in/​riding a
      car; the foreman brief fires and the ~180 s countdown begins. (Confirm the
      negative: `E` at the ring does nothing during another mission, and while a
      passenger.)
- [ ] **Dart settles a foal.** Draw the blaster (`G`), fire (`F`/click) at a loose
      foal → it shimmers ice-blue, calms, and trots into the pen; the HUD ticks
      `PENNED 1/3`. On-foot only (holster in a car).
- [ ] **No PvP auto-opt while wrangling.** In Tab B, confirm the wrangling player in
      Tab A is NOT a freezable PvP target during the mission (their first dart press
      did not draw them into PvP), and they can't be frozen mid-wrangle.
- [ ] **Foals bolt / re-thaw.** Rushing a foal makes it bolt (m4 spook); a foal
      darted far from the pen whose calm lapses re-bolts and can be re-darted — no
      stuck-calm soft-lock.
- [ ] **First-attempt coaching, once.** The first-ever attempt shows the
      `AIM AHEAD OF A MOVING FOAL…` caption and sets `lt_m8_coached`; it does not
      repeat on later attempts.
- [ ] **Win → board + announce.** Pen all three under 180 s → win; the scores modal
      opens on the **m8** board (`#scoreList8`, `FOALS PENNED IN …`) with your time,
      and the other tab's chat shows `* MISSION  <name> settled the foals in <t>s`.
      (Client sent numeric `m:8`, mapped to `m8` server-side — verify the time is on
      the m8 board, NOT the ribbon board.)
- [ ] **Local best persists + gates the chain.** `lt_m8_best` is set; `m8Best`
      removes m8 from the waypoint progression (objective chain complete).
- [ ] **Timer expiry = clean fail + instant retry.** Let the clock run out → fail
      caption, mission resets to `idle`, no submit (other tab's chat unchanged,
      `#scoreList8` unchanged); `E` at the ring restarts immediately where you stand.
- [ ] **Concurrent-mission exclusion.** During a wrangle, `E` at other rings does
      nothing; `allIdle()` includes `mission8`.
- [ ] **Server plumbing complete.** `m8` is in `BOARDS`, the `scores` literal, the
      score map, the `WIN` object (`[15000, 300000]`), and the announce map — a win
      persists to `scores.json` under `m8` and survives a server restart.
- [ ] **Surfaces updated together.** README mission list + `#tut` grid line +
      `#scoreList8` block all present.
- [ ] **Standing gate green.** `node --check web/app.js && node --check server.js`
      pass and `npm test` is all green.

### Notes for the architect / mission dev (F6)
- **Copy Mission 5 end-to-end** (MODDING.md's instruction) for the island shell,
  then swap the body: the state machine is m4's horse loop (minus follow/riding)
  and the entity-count/timer frame is m7's.
- **The dart-vs-foal hit is the only engine change** — a few lines inside
  `updateDarts` gated on `mission8.stage === 'wrangle'`, testing `m8Foals`. Keep it
  client-side; the server never hears about foals.
- **Guard the PvP auto-opt** in `fireDart` (app.js:1646) with a
  `blasterMissionActive()` check so the first press fires without `setPvp(true)`
  during m8 — the one shared-code touch; verify it doesn't leak the player into
  PvP after the mission ends.
- **Five server edits, not one** — `BOARDS`, the `scores` literal, the score map,
  the `WIN` object, and the announce map. The `scores` literal is the one that was
  missing m6/m7; don't repeat it for m8.
- **Ship the funnel telemetry** (start/first-pen/win/fail) with the mission so F5's
  measurement approach applies to m8 from launch — we tune the budget and spook
  radius from data, not vibes.
- **Statement order** — `m8Foals`, `M8_TRIG`, `mission8` declared before the label
  push and any builder that fills them.

---

## F7 — Mission 9: "AIR MAIL" (jetpack rooftop run)

**Why this mission.** The jetpack is required by **zero** missions today — it's a
toy players find by accident and never have a reason to master. AIR MAIL is its
showcase: a timed rooftop delivery run across the downtown towers where **fuel is
the whole game**. It's also the cheapest possible build — no new mechanic, just a
y-aware ring/pad check over rooftops that are *already* landable (colliders carry
heights; `groundY`/`collide` at app.js:1542/1561 let you stand on any roof). And
it finally gives players a reason to fly up to the Central Bank Tower and Big
Blue and *look at the city* — the best view in the game, currently unvisited.

**The problem, mechanically.** The jetpack model already is the mission: fuel
starts at 100 and burns ~9/s airborne, regenerates **only on the ground** at 30/s
(app.js:1941), climb is capped at `vy ≤ 13`, and the flight ceiling is `y = 185`.
A full tank buys ~11 s of flight; refilling from empty takes ~3.3 s on the
ground. So a straight climb to Big Blue's roof (`h = 128`) costs ~90 fuel in
vertical alone — you *cannot* reach the top on one tank. AIR MAIL turns that
constraint into content: a course that alternates **air-rings** (fly through) with
**rooftop pads** (land to bank the checkpoint *and* refuel), so the route is a
fuel puzzle — burn to the next ring, touch down on a pad to top off, climb again.

### The HORSEPOWER lesson, applied
- **Target first-timer completion: 90–150 s.** In-mission budget (fail deadline):
  **~180 s**.
- **The whole course is a tight downtown cluster** (Big Blue, Central Bank Tower,
  the old courthouse, Victorian Square — all within a ~200 m box around spawn), so
  a fall never means a long walk-back; you're always mid-course.
- **A fall is a time cost, not a reset** (see recovery below) — the single most
  important forgiveness decision.
- **The first air-ring is deliberately low and close** so a player who just learned
  "hold Space" clears it on their first hop with a full tank; the course escalates
  from there.
- **Ship the funnel telemetry** (start / each-pad / win / fall / fail) from day one,
  like F6 and F5, so we tune fuel/heights from data.

### The board (server plumbing)
- **Board `m9`. Score = elapsed time** to complete the route (lower is better).
- **WIN plausibility window: `m9: [25000, 300000]` ms** — 25 s floor (you cannot
  thread a multi-rooftop, fuel-gated climb in under ~25 s), 5 min ceiling (well
  above the 180 s budget). Anti-cheat plausibility, distinct from the in-mission
  budget; both tuned in playtest.

### User story
As a player who never had a reason to use the jetpack, my gold marker points me to
a violet ring downtown; a postmaster hands me the day's airmail and I fly it
rooftop to rooftop — climbing higher each leg, dropping onto pads to catch my
breath and refuel — until I'm standing on top of Big Blue with the whole city
below me and a time on the board.

### Premise & personality
**AIR MAIL**: the street is a parking lot (a parade, a Keeneland-traffic snarl) and
the mail truck rolls at six, so the downtown postmaster straps you into the
jetpack to run the day's airmail across the rooftops — a nod to Lexington's real
rooftop-mail-drop era. Caption beats (`capIdx` + `#caption`, no new audio, ASCII):
- **Brief (`capIdx` 0):** `THE POSTMASTER - STREET IS A PARKING LOT AND THE TRUCK
  ROLLS AT SIX. STRAP ON THE JETPACK AND RUN THE MAIL ROOFTOP TO ROOFTOP. THE PADS
  ARE WHERE YOU CATCH YOUR BREATH - FUEL ONLY FILLS ON THE GROUND.`
- **First-attempt coaching (once, `lt_m9_coached`):** `HOLD SPACE TO CLIMB, EASE OFF
  TO GLIDE. LAND ON A ROOF PAD TO TOP OFF THE TANK.`
- **Progress:** `STOP 2 MADE.` … `HALFWAY UP - KEEP CLIMBING.`
- **Out-of-fuel nudge (contextual, not a fail):** `TANK IS DRY - GET DOWN AND IT
  REFILLS ON THE GROUND.`
- **Win:** `WHOLE ROUTE FLOWN, CAUGHT THE TRUCK. THE ROOFTOP MAIL PILOTS WOULD BE
  PROUD.`
- **Fail:** `THE CLOCK BEAT YOU - THE TRUCK LEFT WITHOUT THE BAG.`
- **Radio flavor (optional, needs an audio regen — not required to ship):** a NEWS
  630 `news_*` line — `And police are asking the courier with the jetpack over Vine
  Street to please come down; the mail can wait.` Ships whenever audio is next
  baked; the mission itself needs no new asset.

### The course (design)
A ~6–8 waypoint route that **alternates air-rings and rooftop pads** and
**escalates in height**, anchored to the real downtown tower cluster (all
coordinates existing colliders — verify exact ring placement in playtest):
1. **START `M9_TRIG`** — a violet ring at ground level in the downtown plaza near
   spawn (`x:14, z:-9.5`), reachable on foot. `E` starts the mission.
2. **Air-ring 1 — low & close:** just above street level over Victorian Square
   (`addTower(-170,-32,…,13)`), a single easy hop on a full tank — the fresh-user
   gate.
3. **Pad 1 — Victorian Square / old courthouse roof** (`h ≈ 13–16`, courthouse
   collider at app.js:672): land to bank + refuel.
4. **Air-ring 2 — mid climb** toward the Central Bank Tower.
5. **Pad 2 — Central Bank Tower roof** (`addTower(-126,72,…,88)`, `h = 88`): a real
   climb; land to refuel. *(Naming trap, per CLAUDE.md: it is the Central Bank
   Tower, never "Kincaid Towers.")*
6. **Air-ring 3 — the gap** between Central Bank and Big Blue near the ceiling.
7. **Pad 3 / FINISH — Big Blue roof / helipad** (`LEXINGTON FINANCIAL CENTER · BIG
   BLUE`, `addTower(-127,32,…,128)`, `h = 128`, the existing helipad `PAD`): land
   here to deliver the mail and win — the climactic money-shot view.

The fuel model makes the pads mandatory: you can't reach `h = 128` from the ground
on one tank, so Pad 2 (`h = 88`) is a forced refuel before the final hop up to Big
Blue. That *is* the puzzle.

### Ring vs pad, and what a miss costs
- **Air-rings** are pure fly-through (an elevated torus you pass your body through);
  **pads** require a **landing** (grounded on the roof, `vy ≈ 0`) to bank — which
  also refuels you. Only the *current* waypoint is lit; the next lights on arrival.
- **Missed ring → re-thread, never reset.** A ring you overshoot stays lit; loop
  back through it. There is **no course reset** on a miss — the only thing that
  punishes you is the clock. (Forgiveness over purity, per the HORSEPOWER lesson.)
- **Fall / out-of-fuel recovery → a time cost, not a reset.** Run dry and you sink;
  land on whatever's below (a lower roof or the street), fuel regenerates on the
  ground (30/s), and you relaunch — **your banked pads/rings persist and the
  current target stays lit.** Because the course is a tight cluster, a fall costs
  ~10–20 s of re-climbing, never a long trek. The only failure state is the 180 s
  clock.

### Discoverability
- **Gold ★ label:** `labels.push({name:'★ MISSION: AIR MAIL', x, y, z, col:
  MISSION_COL, mission:true})` at `M9_TRIG`, next to the others.
- **`nextMissionHint()`:** append `if (!m9Best) return 'NEXT MISSION: AIR MAIL -
  VIOLET RING DOWNTOWN (JETPACK - HOLD SPACE)';` after the m8 branch.
- **F1 waypoint** retargets to `M9_TRIG` once m8 is beaten (closes the objective
  chain).
- **Ring color:** **violet/purple** — the one clearly-distinct color left after
  teal (m3) / green (m4) / pink (m6) / blue (m7) / amber (m8) / gold (m1,m5). The
  start ring and all air-rings use it so the route reads as one system.
- **Start gate includes `!player.ride`:** `E` check is `allIdle() && !player.veh &&
  !player.ride && !isFrozen() && nearM9Trig()`. The mission is flown on foot →
  jetpack (`player.thrusting`, mode 1 — a foot sub-state, not a vehicle), so the
  on-foot start is correct.

### Build checklist (follow MODDING.md §"(c) A new mission", lines 286–341)
Same recipe as F6; the mission-9 specifics:
1. **Island layout (statement order!):** declare `M9_TRIG`, `M9_RINGS`/`M9_PADS`
   (the ordered waypoint list with per-waypoint `{x, y, z, pad:bool}`),
   `M9_BUDGET`, `m9Best` (from `lt_m9_best`), and the `mission9` state object
   (`{stage:'idle', tStage, t0, ms, cur:0, capIdx:0}`) as top-level `var`s **before**
   the `labels.push` block and any ring-builder.
2. **Join `allIdle()`** (app.js:4339): add `&& mission9.stage === 'idle'`.
3. **Gold ★ label** (above).
4. **`nextMissionHint()` branch** (above).
5. **`E` branch** with the `!player.ride` gate (above) + a `nearM9Trig()` helper.
6. **Per-frame `updateMission9(dt)`:** `idle → flying → won → post → idle` /
   `flying → fail → idle`; light only `M9_*[mission9.cur]`; on reaching an air-ring
   (body within radius) or landing on a pad (grounded on the roof at the pad
   position), advance `cur`; win when `cur` passes the last waypoint; countdown off
   `performance.now()` + `M9_BUDGET`; HUD hint shows `AIR MAIL · STOP n/N · FUEL m% ·
   <s>s LEFT`. **No engine change** — this is a y-aware position/grounded check over
   existing rooftops.
7. **Leaderboard UI:** on win `showScores(mission9.ms, 9)`; add `#scoreList9`
   (`<ol>` + `<h2>` + CSS) to `web/index.html`; add the `board === 9` verb (`ROUTE
   FLOWN IN `) + `m9Best` to the score modal and `'scoreList9'` to the
   `renderScores` forEach.
8. **Server board (server.js) — the same FIVE edits as F6:** `BOARDS` (:160) → add
   `'m9'`; the `scores` init literal (:163) → add `m9: []`; the score map (:602) →
   add `9: 'm9'`; the per-board `WIN` object (:603–606) → add `m9: [25000,
   300000]`; the chat-announce map (:618–625) → add `m9: `${n} flew the airmail
   route in ${sec}s``. *(If F6's `m8` plumbing hasn't landed yet, this adds `m8`
   AND `m9` — five edits each.)*
9. **README + tutorial:** AIR MAIL blurb in the README mission list + a `#tut` grid
   line.

> **The numeric-`m` trap (MODDING.md).** Send `{t:'score', ms, m: 9}` — the number
> `9`, not `'m9'`. A string misses the `{…,9:'m9'}` map and lands your times on the
> ribbon board.

### Multiplayer behavior
- **Entirely client-side**, like every mission. Rings, pads, fuel, and the
  countdown are local; nothing relays. Only the final `{t:'score', ms, m:9}`
  touches the server → validated against `WIN.m9` → `scores.json` → `{t:'scores'}`
  + chat announce.
- Other players just see you flying the jetpack via the existing `m:1` remote
  render (flames + arms-up pose); they never see your rings or mission.
- **Offline / bots-only:** fully playable; score submit no-ops offline; local best
  saves. **Private rooms (F4):** plays fine, score doesn't rank in a non-PUBLIC
  room, `lt_m9_best` still saves — inherited from F4.

### Edge cases
- **Runs out of fuel mid-hop:** sinks, lands, refuels on the ground, relaunches;
  progress persists, current target stays lit; the contextual `TANK IS DRY` nudge
  fires (once per dry-out, not spammed).
- **Overshoots an air-ring:** it stays lit; re-thread it — no reset.
- **Lands on the wrong roof:** nothing banks; only the lit pad at the target
  position counts. (Standing on Central Bank when Pad 3/Big Blue is lit does
  nothing.)
- **Enters a car / heli mid-mission:** the mission is jetpack-only; entering a
  vehicle isn't possible mid-air, and on the ground the start gate already excluded
  vehicles — but if a player somehow boards, treat it like being on foot off-course
  (countdown continues; get back on the jetpack). Simplest: the mission doesn't
  care what you ride, only whether you hit the lit waypoint.
- **Flies to the `y = 185` ceiling:** the existing jetpack clamp handles it; no ring
  is placed above a reachable altitude (top pad is Big Blue at `h = 128`, well under
  the ceiling).
- **Concurrent-mission guard:** `allIdle()` must include `mission9`.
- **Retry:** `E` at the ring re-inits (relights waypoint 1, resets fuel/clock),
  like every mission — and you're standing right at the start, no walk-back.

### Non-goals (F7)
- **No new mechanic** — no new flight model, no glider, no fuel pickups in the air
  (ground-only refuel is the point); just rings/pads over existing rooftops.
- **No combat** — AIR MAIL is a pure flight-skill course; no darts, no chopper.
- **No new baked audio** to ship (captions carry it; the NEWS 630 line is optional
  future flavor).
- **No map growth / no new buildings** — the course uses rooftops that already
  exist inside current `WORLD` bounds.
- **No co-op / shared race** — solo against the clock and the board.

### Acceptance checklist — F7 Mission 9: AIR MAIL

Precondition: m1–m8 beaten, every mission idle (fast-forward the eight bests via
`test/CHECKLIST.md`, leave `lt_m9_best` cleared, reload). Standing gate first
(`node --check` both files, `npm test`). Two tabs for the announce check.

- [ ] **Waypoint carries you downtown.** With m8 beaten and m9 not, F1's marker
      points to `M9_TRIG`; the ★ AIR MAIL label renders at the violet ring and hides
      during any active mission.
- [ ] **Start gate is `allIdle` + on-foot + not-riding.** `E` at the ring starts it
      only when every mission is idle and you're not in/​riding a car; the postmaster
      brief fires and the ~180 s countdown begins. (Negative: `E` does nothing during
      another mission or while a passenger.)
- [ ] **First ring is fresh-user reachable.** From a full tank at the start, air-ring
      1 (low, over Victorian Square) is clearable on a single first hold-Space hop.
- [ ] **Pads bank + refuel; rings fly-through.** Landing on a lit rooftop pad banks
      the stop and tops the tank; an air-ring banks by flying your body through it.
      Only the current waypoint is lit; the next lights on arrival.
- [ ] **Fuel forces the pads.** You cannot reach the Big Blue roof (`h=128`) from the
      ground on one tank; refueling on the Central Bank pad (`h=88`) is required to
      make the final hop. The HUD shows `FUEL m%`.
- [ ] **Missed ring re-threads, no reset.** Overshoot an air-ring → it stays lit,
      loop back through it, progress intact, no course reset.
- [ ] **Fall = time cost, not reset.** Run the tank dry mid-air → you land, the
      `TANK IS DRY` nudge fires, fuel regens on the ground, you relaunch, and your
      banked stops + current target persist. No walk-back (you're mid-cluster).
- [ ] **First-attempt coaching, once.** First-ever attempt shows the `HOLD SPACE TO
      CLIMB…` caption and sets `lt_m9_coached`; not repeated later.
- [ ] **Win → board + announce.** Complete the route under 180 s → win; scores modal
      opens on the **m9** board (`#scoreList9`, `ROUTE FLOWN IN …`) with your time,
      other tab's chat shows `* MISSION  <name> flew the airmail route in <t>s`.
      Numeric `m:9` → verify the time is on the m9 board, not the ribbon board.
- [ ] **Local best persists + closes the chain.** `lt_m9_best` set; `m9Best` removes
      m9 from the waypoint progression.
- [ ] **Timer expiry = clean fail + instant retry.** Clock runs out → fail caption,
      reset to `idle`, no submit; `E` restarts immediately at the ring.
- [ ] **Concurrent-mission exclusion.** During the run, `E` at other rings does
      nothing; `allIdle()` includes `mission9`.
- [ ] **Server plumbing complete.** `m9` in `BOARDS`, the `scores` literal, the score
      map, the `WIN` object (`[25000, 300000]`), and the announce map — a win
      persists under `m9` and survives a restart.
- [ ] **Surfaces updated together.** README mission list + `#tut` grid line +
      `#scoreList9` block all present.
- [ ] **Standing gate green.** `node --check web/app.js && node --check server.js`
      pass and `npm test` is all green.

### Notes for the architect / mission dev (F7)
- **Copy Mission 5 end-to-end** for the island shell; the body is a waypoint walker
  over `M9_RINGS`/`M9_PADS` with a `cur` index — closer to m5's checkpoint loop than
  to a state-heavy mission.
- **No engine change.** Advancing on an air-ring is a body-in-radius test; advancing
  on a pad is "grounded (`player.grounded`) at the pad's roof position." Rooftops are
  already landable via collider heights (`groundY`/`collide`, app.js:1542/1561) — you
  add zero physics.
- **Fuel is untouched** — the existing 9/s burn, 30/s ground regen, `vy ≤ 13`,
  `y = 185` ceiling *are* the difficulty. Do not add air refuels; the design leans
  entirely on the stock model.
- **Place rings in playtest, not from coordinates alone** — fly the route and set
  ring heights/positions so the low-first, escalating ramp actually reads and the
  fuel math forces the Pad-2 refuel. Verify every pad sits on a real roof collider.
- **Five server edits** (BOARDS, `scores` literal, score map, `WIN`, announce) — and
  if m8 hasn't landed, do both m8 and m9.
- **Ship funnel telemetry** (start/per-pad/fall/win/fail) so we tune fuel + heights
  from data.
- **Statement order** — `M9_TRIG`, the waypoint arrays, and `mission9` declared
  before the label push and the ring-builder.
