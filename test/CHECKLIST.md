# LEXTOWN-01 — Phase 1 Manual QA Checklist

Two-tab localhost verification for the "First-Minute Release" (F1–F4). Run the
automated smoke test first (`npm test` / `node test/smoke.mjs`), then work this
list by hand — the WS relay makes most bugs visible only with 2+ clients.

## Setup

```bash
node --check web/app.js && node --check server.js   # standing syntax gate
ADMIN_TOKEN=qa-admin NPC_TOKEN=qa-npc PORT=8080 node server.js
```

Open **two tabs**: `http://localhost:8080/?v=1` (Tab A) and a second at
`http://localhost:8080/?v=1` (Tab B). Keep DevTools console open in both.

Useful URL knobs (from CLAUDE.md): `?v=N` cache-bust · `#name=X` · `#h=13` start
hour · `#x=..&z=..` deep-link spawn · `#debug=1` exposes `window.__lt` ·
`#wp=0` forces the objective waypoint off · `#ws=<url>` explicit relay.

**Reset "first-time" state** (the F1 flow keys) before an onboarding run — in the
tab's console:

```js
['lt_tut_seen','lt_obj_banner_seen','lt_waypt',
 'lt_heli_unlock','lt_m2_best','lt_m3_best','lt_m4_best','lt_m5_best',
 'lt_m4_coached'].forEach(k => localStorage.removeItem(k));
location.reload();
```

**Fast-forward mission progression** (to test retarget / gates without playing
each mission). These are the real keys read at boot in `web/app.js`
(`heliUnlocked` ← `lt_heli_unlock==='1'`; `m2Best/m3Best/m4Best/m5Best` ←
`parseInt(lt_mN_best)`). Set a nonzero best to mark a mission "beaten":

```js
localStorage.setItem('lt_heli_unlock','1'); // mission 1 done → gates m2 door + heli
localStorage.setItem('lt_m2_best','45000');
localStorage.setItem('lt_m3_best','61000');
localStorage.setItem('lt_m4_best','90000');
localStorage.setItem('lt_m5_best','150000');
location.reload();
```

Key coordinates (verified in `web/app.js`): spawn `x:14, z:-9.5` ·
`MISSION_TRIG {x:146, z:14}` (m1) · `DOOR_P {x:161.6, z:30.5}` (m2) ·
`M3_TRIG {x:122, z:76}` · `M4_TRIG {x:247, z:74}` · `M5_TRIG {x:60, z:14}` (m5).

---

## F1 — Onboarding + Objective Waypoint

Reset first-time state (above), then reload Tab A.

- [ ] **Fresh load → tutorial auto-opens.** With `lt_tut_seen` cleared, the `#tut`
      modal opens on its own.
- [ ] **Close tutorial → waypoint turns on.** On `tutClose`, the existing Dispatch
      caption fires **and** a gold objective marker appears.
- [ ] **On-screen marker at spawn.** Facing the objective, a gold diamond sits at
      the projected `MISSION_TRIG` position with a label + live distance in meters
      (e.g. `RIBBON CUTTING · 128m`). Distance updates as you move.
- [ ] **Off-screen → edge arrow.** Turn so the ring is behind you: the marker
      clamps to the screen edge as an arrow pointing toward the objective, still
      showing distance. Spin a full 360° — the arrow tracks smoothly with no jump
      or disappearance when the target crosses behind the camera (the behind-camera
      bearing math, not a null projected point).
- [ ] **Objective banner fades permanently.** The "OBJECTIVE — THE RIBBON CUTTING"
      banner under the top HUD fades out for good once you first come within ~15 m
      of the objective, and the `E — START MISSION` hint takes over. It does **not**
      come back this session; `lt_obj_banner_seen` is now `'1'`.
- [ ] **Retarget chain.** Using the fast-forward keys, mark missions beaten one at a
      time and reload; confirm the marker retargets in order:
      ribbon (`MISSION_TRIG`) → City Hall door (`DOOR_P`) → data center (`M3_TRIG`)
      → horses (`M4_TRIG`) → deadline (`M5_TRIG`).
- [ ] **All beaten → marker off.** With all five bests set, the marker is gone (no
      empty/stuck arrow). `currentObjective()` returns null.
- [ ] **WAYPT tray toggle + persistence.** Open the SIM tray (`#tray`); toggle
      `WAYPT` off → marker disappears; reload → still off (`lt_waypt==='0'`). Toggle
      on → reappears and persists.
- [ ] **`#wp=0` forces off.** Load `http://localhost:8080/?v=1#wp=0` → no marker
      regardless of the tray toggle.
- [ ] **Hidden during active missions.** Start any mission (not idle): the waypoint
      marker hides and the mission's own target overlay (`drawMissionTarget`) takes
      over. Confirm in drone and first-person camera too (it's world-space
      projected, so it must still hide during a mission in every camera mode).
- [ ] **Returning player, no banner.** With progress in localStorage but the tutorial
      already seen, the banner does not show, but the marker still points at the next
      unbeaten mission.

---

## F2 — Mission 5: DEADLINE (checkpoint drive race)

All 5 checkpoints and the 180 s budget are in `web/app.js` (`M5_CPS`,
`M5_BUDGET`). Checkpoints, in order: THOROUGHBRED PARK → MLK AND HIGH →
RUPP ARENA → CHEAPSIDE COURTHOUSE → THE BLOCK - WRAP.

Precondition: all of m1–m4 beaten and every mission idle. Set the four bests via
fast-forward keys, leave `lt_m5_best` cleared, reload.

- [ ] **Start gate is `allIdle`-only.** Walk to `M5_TRIG {x:60, z:14}`; the
      `E — START MISSION: DEADLINE` hint shows and `E` starts it **only when every
      mission is idle**. (Confirm the negative in the two-mission check below.)
- [ ] **Gold ★ label present.** Before starting, the `★ MISSION: DEADLINE` gold
      label renders at `M5_TRIG`, alongside the other four mission labels; it hides
      during any active mission.
- [ ] **Anchor VO + stage → driving.** `E` fires the Dispatch/anchor caption and
      the mission enters the `driving` stage; the HUD hint switches to
      `DEADLINE · CP 1/5 · <n>s LEFT` and counts down.
- [ ] **Only the current checkpoint is lit.** Exactly one checkpoint ring is
      visible/lit at a time; the next lights only on arrival at the current one.
- [ ] **On-foot pass does NOT bank.** Walk (no car) through the lit checkpoint ring —
      the counter does **not** advance. Reinforces "must be in a car."
- [ ] **In-car banking + full run wins.** Steal a car (`E`), drive all 5
      checkpoints in under 180 s → win: the scores modal opens showing the **m5**
      board ("DEADLINE — FASTEST DRIVES", `#scoreList5`) with your time, and the
      other tab's chat log shows `* MISSION  <name> beat the deadline in <t>s`.
      (The client submits `{t:'score', ms, m:5}` — numeric `m:5`, mapped to board
      `m5` server-side.)
- [ ] **Local best persists.** `lt_m5_best` is now set; `m5Best` gates F1's waypoint
      (deadline no longer a pending objective).
- [ ] **Timer expiry = clean fail.** Start again and let the clock run out → fail
      caption, mission resets to `idle`, **no** score submitted (watch the other
      tab's chat — no announce; `#scoreList5` unchanged).
- [ ] **Exit car mid-race.** Leave the car mid-run: the timer keeps running (does
      not pause on foot); re-enter any car and continue banking checkpoints.
- [ ] **Replayable.** After a win or fail, the mission is startable again from the
      ring like every other mission.
- [ ] **Other mission rings dead while m5 active.** During a DEADLINE run, `E` at the
      m1/m3/m4 rings does nothing (the `allIdle()` guard).

---

## F3 — Ambient NPCs

Server must be running with `NPC_TOKEN` set (see Setup). In a separate terminal:

```bash
LEXTOWN_WS=ws://localhost:8080 NPC_TOKEN=qa-npc node bots/npcs.mjs
```

(Confirm the exact env var names `bots/npcs.mjs` reads before running — match
what dev C landed.)

- [ ] **Chatter appears.** Within a few seconds, preset Lexington small-talk lines
      from the NPC personas show up in both tabs' chat logs, spaced out (they
      throttle well under the 3-burst / ~1-per-1.2s chat bucket — no rate-limit
      drops, no flooding).
- [ ] **No AI text.** Lines are from the preset pools only (the Haiku hook stays
      suspended) — no generated/dynamic text.
- [ ] **Walking avatars.** Two walkers (BIG LEX,
      TOLLY HO) are visible near spawn (`x:14, z:-9.5`), moving via the normal
      remote-avatar pipeline.
- [ ] **Graceful degradation.** Kill the NPC process (Ctrl-C) → the game is
      unaffected: no errors in either tab, human players keep playing, existing NPC
      avatars simply leave.
- [ ] **Honest counts.** With tokens set, `curl "http://localhost:8080/admin/stats?token=qa-admin"`
      shows `humans` excluding the NPCs and `total` including them; each NPC row in
      `online[]` is tagged `npc:1`. In-game `/stats` (as admin) shows the
      `human +N npc` split. NPCs must **not** inflate `joins`/`peak`.
- [ ] **No moderation/cheat side effects.** NPC movement/chat never trips
      `cheat_suspect` logging or consumes ban/kick slots.

---

## F4a — HORSEPOWER Discoverability

Precondition: m1–m3 beaten, m4 not; every mission idle. Reset `lt_m4_coached`.

- [ ] **Waypoint points to `M4_TRIG`.** With m3 beaten and m4 not, F1's marker
      targets the green ring at `M4_TRIG {x:247, z:74}`.
- [ ] **Edge arrows to all three horses.** Start HORSEPOWER; during the `wrangle`
      stage, edge arrows point to each of the three un-penned horses (scattered:
      Kroger Field lots, Chevy Chase, Thoroughbred Park) so the player knows there
      are three and where. Arrows use the same edge-arrow primitive as F1.
- [ ] **One-time coaching caption, first attempt only.** On the first-ever attempt
      (`lt_m4_coached` unset) the caption reads
      `THE TRAINER — WALK UP SLOW - RUN AND THE HORSE BOLTS.` and sets
      `lt_m4_coached='1'`. On the next attempt the coaching line is replaced by the
      flavor intro — the spook-rule caption does **not** repeat.
- [ ] **Spook mechanic unchanged.** Radius/speed threshold is as-is this phase
      (discoverability only) — running at a horse still makes it bolt.

---

## F4b — Pointer-lock guard (regression sanity)

- [ ] **No `client_err` from pointer/lock paths.** Rapidly click-to-lock and
      blur/refocus the tab during drag; the session logs no new `client_err`
      (check `logs/events-*.jsonl` on the server, `jq 'select(.e=="client_err")'`).
      No visual glitch or stuck pointer.

---

## Cross-cutting (all features)

- [ ] **Clean console on load.** Both tabs load with **no** `ReferenceError` or
      other errors — specifically none from top-level statement order (a registry
      read before its declaration, e.g. the documented `vehicles`-before-init /
      `M5_TRIG`-before-`labels.push` class of crash).
- [ ] **Two-mission exclusion.** Start DEADLINE; walk to the m3 / m4 rings and press
      `E` — nothing happens (no second mission starts). Repeat starting a different
      mission and confirming `E` at `M5_TRIG` is dead while it runs. `allIdle()` must
      include `mission5`.
- [ ] **Multiplayer sanity (2 tabs).** In Tab B you see Tab A moving, chatting, and
      driving (remote car) live; a DEADLINE run in A shows only A's car in B (no
      relayed checkpoints — the mission is client-side). Score announce reaches both
      tabs' chat.
- [ ] **Surfaces updated together.** New/changed content is reflected in the tutorial
      grid (`#tut`), the `README.md` HUD/mission sections, and (where a keypress) the
      `#help` bar — per the 4-surface control rule. F1 adds the tutorial "gold marker"
      line + README HUD line + WAYPT tray toggle; F2 adds the README Mission 5 blurb +
      `#scoreList5` block.
- [ ] **Privacy promise intact.** No new accounts, no new data collection; chat is
      never stored/logged (server logs volume only). `web/privacy.html` still true.
- [ ] **Standing gate green.** `node --check web/app.js && node --check server.js`
      passes, and `npm test` (`node test/smoke.mjs`) is all green.

---

## F5 — Ride Shotgun (passenger seat)

Phase 2 F1. The seat only reveals its bugs with 2+ clients — one tab drives, one
tab rides — so run this with **Tab A = the driver** and **Tab B = the passenger**,
distinct names via `#name=DRIVER` / `#name=PAX`. Standing gate first
(`node --check web/app.js && node --check server.js`, then `npm test`), then work
the list by hand. Keep both consoles open.

Reset the ride tip flag before an onboarding run — in Tab B's console:

```js
localStorage.removeItem('lt_ride_seen'); location.reload();
```

- [ ] **Prompt only near a live driver.** In Tab B on foot, walk near Tab A while
      A is **not** driving → no ride prompt. A steals a car (`E`) and drives near B
      → B's `#hint` shows `E — RIDE SHOTGUN`. Confirm the prompt never appears in a
      solo/offline tab (bots don't drive, so it's self-gating).
- [ ] **First-opportunity TIP caption, once.** The first time an eligible driver is
      in range, B sees the one-shot `TIP — …ride along` caption; it sets
      `lt_ride_seen` and does **not** fire again this session or after reload.
- [ ] **Board while moving.** With A driving, B presses `E` (or the touch **E-VEH**
      button) → B snaps into A's shotgun seat, B's caption reads
      `RIDING SHOTGUN — DRIVER`, B's blaster holsters, and the radio chip appears
      for B. Works while A is moving.
- [ ] **Seated avatar stays glued (all three screens).** As A drives hard around
      downtown, B's avatar + camera stay pinned to A's car at the shotgun offset —
      no `W/A/S/D` movement from B, no relative jitter between B's avatar and the
      car. Confirm on all three views: B's own screen, A's screen (B in A's shotgun
      seat), and a **third** spectator tab (B seated with name tag over the seat, A
      at the wheel).
- [ ] **Driver sees the pickup.** Tab A gets the one-shot `PAX hopped in — shotgun`
      caption when B boards.
- [ ] **Radio is per-listener.** In Tab B, `R` cycles stations (persists
      `lt_radio`), independent of A's station; `lt_snd` mute silences it. A's own
      station does **not** change when B cycles.
- [ ] **First-person + chat while seated.** `C` toggles B into first-person
      (looking out the window); B chats (`Enter`) and the bubble/log appear in both
      tabs.
- [ ] **Single seat / deny.** Open a third tab (`#name=PAX2`), drive-adjacent, try
      to board A while B is seated → denied with the brief deny caption, no second
      figure appears; A still carries exactly one passenger.
- [ ] **Passenger hops out.** B presses `E` → B drops at the car's current position
      on foot, the on-foot prompt returns, and the seat frees (a new passenger can
      now board). All tabs drop the seated figure.
- [ ] **Driver exits car → auto-eject.** With B seated, A presses `E` to leave the
      car → B is ejected to the car's parked spot on foot with the
      `DRIVER parked — you hopped out` caption; both end up on foot in all tabs.
- [ ] **Driver disconnects → gentle set-down.** Reboard, then close Tab A → B is set
      down at the last car position (no crash, no console error), seat cleared
      server-side.
- [ ] **Passenger disconnects → seat frees.** Reboard, then close Tab B → A keeps
      driving solo, A's seated figure clears, and a fresh passenger can board.
- [ ] **Frozen can't board; seated can't be frozen.** With both opted into PvP on
      foot, freeze B with a dart → while frozen, B's `E` board is denied. Once
      seated, B is not a valid freeze target (blaster holstered, PvP opt-in dropped).
- [ ] **No mission / heli / fire from the seat.** While seated, B at a mission ring
      or the helipad → `E` does not start a mission or board the heli, and RPG
      crates don't grab; B can't fire the blaster. The mission start-gates
      (`allIdle`) still behave.
- [ ] **Bounds hold.** A drives to the edge of `WORLD` (server clamps A) → B stays
      glued and in-bounds; no `correct` snap-back storms on B, no console errors.
- [ ] **Surfaces updated together.** The tutorial `CARS` grid (`#tut`) and the
      README controls table both describe ride shotgun, and the seated/on-foot
      `#hint` strings match; the `#help` bar's `E VEHICLE` token still covers it (no
      new token).
- [ ] **Privacy intact.** `lt_ride_seen` (a boolean tip flag) is the only new
      localStorage key; no new server-side storage or logging; chat still never
      stored. `web/privacy.html` remains true.
- [ ] **Standing gate green.** `node --check web/app.js && node --check server.js`
      pass and `npm test` (`node test/smoke.mjs`) is all green.

---

## F6 — Private rooms

Phase 2 F4. **Three tabs:** A and B share a room code, C stays in the PUBLIC
commons. Standing gate first (`node --check web/app.js && node --check
server.js`, then `npm test`), then work the list by hand. Keep all three
consoles open.

```bash
ADMIN_TOKEN=qa-admin NPC_TOKEN=qa-npc PORT=8080 node server.js
```

- Tab A: `http://localhost:8080/?v=1#room=DERBY&name=ALICE`
- Tab B: `http://localhost:8080/?v=1#room=DERBY&name=BOB`
- Tab C: `http://localhost:8080/?v=1#name=CAROL` (PUBLIC commons)

- [ ] **Isolation — presence.** A and B see each other move; C sees neither, and
      C's movement never reaches A or B. Each net chip's peer count reflects only
      same-room peers.
- [ ] **Isolation — chat.** A chat line typed in DERBY shows for A and B only; a
      line typed in PUBLIC (Tab C) shows for C only. Nothing crosses rooms.
- [ ] **Isolation — heli.** A boards the chopper in DERBY and B sees A fly; C sees
      the PUBLIC chopper still parked and can board it independently. Two rooms,
      two choppers, no interference — downing one doesn't touch the other.
- [ ] **Isolation — leave.** Close Tab A → B sees ALICE leave; C sees no change. If
      A was DERBY's pilot, DERBY's heli crashes/resets while PUBLIC's is untouched.
- [ ] **Net chip shows the room.** A and B show `ROOM DERBY`; C shows the PUBLIC
      `NET: ONLINE · PEERS …` (no room, or `COMMONS`).
- [ ] **Reconnect keeps the room.** Restart the server (or drop A's socket) → A
      auto-reconnects into DERBY, not PUBLIC, re-syncing B and the room's heli.
- [ ] **COPY ROOM LINK works and excludes the name.** In Tab B's tutorial, click
      **COPY ROOM LINK**, then open the copied URL in a fresh tab with a different
      name → it lands in DERBY (room preserved, `#name=` not carried over so the
      invitee names themselves).
- [ ] **Private scores don't rank.** Beat a mission in DERBY → no global-board
      write, no chat announce in any tab, the WIN modal shows
      `PRIVATE ROOM · TIMES DON'T RANK`, and `lt_mN_best` still updates locally.
      Beat the same mission in PUBLIC (Tab C) → it *does* hit the board and
      announce. Also confirm a raw `{t:'score'}` forced from a DERBY client's
      console is ignored server-side (no board write).
- [ ] **`/room` switches via reload.** In Tab C, type `/room DERBY` in chat → the
      hash rewrites and the tab reloads into DERBY alongside A and B; `/room` with
      no code (or an empty one) returns to the PUBLIC commons.
- [ ] **NPCs are PUBLIC-only.** With `bots/npcs.mjs` running (see the F3 setup
      above), NPC chatter and walkers appear in PUBLIC (Tab C) only — never in
      DERBY.
- [ ] **Implicit + sanitized.** `#room=derby`, `#room=DERBY`, and `#room=Derby!!`
      all resolve to the same sanitized `DERBY` (one shared world); an absent room
      is PUBLIC and behaves exactly like a current URL.
- [ ] **Admin sees rooms.** `/list` (as admin) shows a room column — ALICE/BOB in
      DERBY, CAROL in PUBLIC; `/announce hi` reaches all three tabs; a `/ban`
      persists globally (the target can't rejoin via a different room code).
- [ ] **Privacy honest.** `web/privacy.html` states a room code is handled like a
      player name — visible to others in the room and possibly in the short-lived
      server logs, not a password, nothing about rooms stored permanently. No new
      localStorage key (the room rides the URL hash); no new persisted server data.
- [ ] **Standing gate green.** `node --check web/app.js && node --check server.js`
      pass and `npm test` (`node test/smoke.mjs`) is all green.

---

## F7 — LOOSE IN THE PADDOCK (Mission 8: freeze blaster at the horse farms)

Phase 2 F6. **Precondition:** m1–m7 beaten, every mission idle, `lt_m8_best`
cleared. Extend the Setup fast-forward recipe with the remaining bests (m1's
"best" is the heli unlock):

```js
localStorage.setItem('lt_heli_unlock','1');
['lt_m2_best','lt_m3_best','lt_m4_best','lt_m5_best','lt_m6_best','lt_m7_best']
  .forEach(k => localStorage.setItem(k, '90000'));
localStorage.removeItem('lt_m8_best');
localStorage.removeItem('lt_m8_coached');
location.reload();
```

Standing gate first (`node --check web/app.js && node --check server.js`, then
`npm test`). Two tabs for the PvP / announce checks — **Tab A** plays, **Tab B**
observes.

- [ ] **Waypoint carries you north.** With m7 beaten and m8 not, F1's gold marker
      and route ribbon point to `M8_TRIG` in the Elmendorf paddocks (north, past New
      Circle); the `★ MISSION: LOOSE IN THE PADDOCK` label renders at the amber ring
      and hides during any active mission.
- [ ] **Start gate is `allIdle` + on-foot + not-riding.** On foot at the amber ring,
      `E` starts it only when every mission is idle and you're not driving or riding
      shotgun; the foreman brief fires and the ~180 s countdown begins. Confirm the
      negatives: `E` does nothing during another mission, while a passenger, or while
      frozen.
- [ ] **Dart settles a foal.** Draw the blaster (`G`), fire (`F`/click) at a loose
      foal → it shimmers ice-blue, calms, and trots into the central pen; the HUD
      hint ticks `PENNED 1/3`. On foot only (the blaster holsters in a car).
- [ ] **Start issues the blaster WITHOUT a PvP opt-in (two tabs).** Firing the first
      mission dart does NOT draw Tab A into PvP: in Tab B, confirm A is not a
      freezable target during the wrangle and can't be frozen mid-mission (contrast
      with normal freeze-tag, where the first `G`/`F` opts you in).
- [ ] **Foals bolt on the spook rule.** Rushing within a foal's spook radius makes
      it break and run (the m4 mechanic), so you lead darts on moving targets from a
      few meters out.
- [ ] **Re-thaw if not penned in time.** A foal darted far from the pen whose ~8 s
      calm lapses before it pens re-bolts and can be re-darted — no stuck-"calm"
      soft-lock. A foal darted near the pen reaches it and pens on the first dart.
- [ ] **First-attempt coaching, once.** The first-ever attempt shows
      `AIM AHEAD OF A MOVING FOAL - THE DART TAKES A BEAT TO GET THERE.` and sets
      `lt_m8_coached`; it does not repeat on later attempts.
- [ ] **Win → board + announce + device best.** Pen all three under 180 s → win; the
      scores modal opens on the **m8** board (`#scoreList8`, `FOALS PENNED IN …`)
      with your time, `lt_m8_best` updates locally, and Tab B's chat shows
      `* MISSION  <name> settled the foals in <t>s`. Verify the time lands on the m8
      board, NOT the ribbon board (client sent numeric `m:8`).
- [ ] **Local best gates the chain.** `lt_m8_best` is set; `m8Best` removes m8 from
      the waypoint progression (the objective chain is now complete — no marker).
- [ ] **Timer expiry = clean fail + instant retry.** Let the clock run out → fail
      caption (`THEY BOLTED FOR PARIS PIKE. RESET AND TRY AGAIN.`), mission resets to
      `idle`, no submit (Tab B chat unchanged, `#scoreList8` unchanged); `E` at the
      ring restarts immediately where you stand (foals respawn).
- [ ] **No mission overlap.** During a wrangle, `E` at other rings does nothing;
      `allIdle()` includes `mission8`.
- [ ] **Blaster restored to its PvP state after cleanup.** On win or fail, the
      blaster returns to whatever PvP state it had before the mission — a player who
      was never opted in is still un-taggable afterward (the mission didn't silently
      leave them opted in).
- [ ] **Private-room run doesn't rank.** Play m8 in a `#room=` private room → the
      mission plays and `lt_m8_best` still saves, but there's no global-board write
      and no chat announce (inherits F4's score gate). In PUBLIC it ranks normally.
- [ ] **Server plumbing complete.** `m8` is in `BOARDS`, the `scores` literal, the
      score map, the `WIN` object (`[15000, 300000]`), and the announce map — a win
      persists to `scores.json` under `m8` and survives a server restart.
- [ ] **Surfaces updated together.** README mission list, the `#tut` MISSION 8 grid
      line, and the `#scoreList8` scores-modal block are all present.
- [ ] **Standing gate green.** `node --check web/app.js && node --check server.js`
      pass and `npm test` (`node test/smoke.mjs`) is all green.

## F8 — AIR MAIL (Mission 9: jetpack rooftop delivery run)

Phase 2 F7. **Precondition:** m1–m8 beaten, every mission idle, `lt_m9_best`
cleared. Extend the Setup fast-forward recipe with all eight prior bests (m1's
"best" is the heli unlock):

```js
localStorage.setItem('lt_heli_unlock','1');
['lt_m2_best','lt_m3_best','lt_m4_best','lt_m5_best','lt_m6_best','lt_m7_best','lt_m8_best']
  .forEach(k => localStorage.setItem(k, '90000'));
localStorage.removeItem('lt_m9_best');
localStorage.removeItem('lt_m9_coached');
location.reload();
```

Standing gate first (`node --check web/app.js && node --check server.js`, then
`npm test`). Two tabs for the announce check — **Tab A** plays, **Tab B**
observes. Tip: `#debug=1` + `__lt.tp(x,z)` to hop between rooftops while testing.

- [ ] **Waypoint closes the chain.** With m8 beaten and m9 not, F1's gold marker
      and route ribbon point to `M9_TRIG` (the violet ring downtown by spawn); the
      `★ MISSION: AIR MAIL` label renders at the ring and hides during any mission.
- [ ] **Start gate is `allIdle` + on-foot + not-riding.** On foot at the violet ring,
      `E` starts it only when every mission is idle and you're not driving or riding
      shotgun; the postmaster brief fires and the ~180 s countdown begins. Confirm the
      negatives: `E` does nothing during another mission, while a passenger, or while
      frozen.
- [ ] **First ring is fresh-user reachable.** From a full tank at the start, air-ring
      1 (`LOW HOP`, low and close) is clearable on a single first hold-Space hop.
- [ ] **Pads bank + refuel; rings fly-through.** Landing on a lit rooftop pad banks the
      stop and tops the tank (the stock 30/s ground regen); an air-ring banks by flying
      your body through it. Only the current waypoint's violet mesh is lit; the next
      lights on arrival. The HUD reads `AIR MAIL · STOP n/6 · FUEL m% · <s>s LEFT`.
- [ ] **Fuel forces the pads.** You cannot reach the Big Blue roof (`h≈128`) from the
      ground on one tank; refueling on the Central Bank Tower pad (`h≈88`) is required
      to make the final hop. (Try skipping the tower pad — you run dry short of Big Blue.)
- [ ] **Missed ring re-threads, no reset.** Overshoot an air-ring → it stays lit, loop
      back through it, progress intact, no course reset.
- [ ] **Fall = time cost, not reset.** Run the tank dry mid-air → you sink, the
      `TANK IS DRY - GET DOWN AND IT REFILLS ON THE GROUND.` nudge fires once, fuel
      regens on the ground, you relaunch, and your banked stops + current target
      persist. No walk-back (you're mid-cluster). The nudge re-arms after you touch down.
- [ ] **First-attempt coaching, once.** The first-ever attempt shows
      `HOLD SPACE TO CLIMB, EASE OFF TO GLIDE. LAND ON A ROOF PAD TO TOP OFF THE TANK.`
      and sets `lt_m9_coached`; later attempts show the postmaster flavor brief instead.
- [ ] **Win → board + announce + device best.** Fly the whole route under 180 s → win;
      the scores modal opens on the **m9** board (`#scoreList9`, `ROUTE FLOWN IN …`)
      with your time, `lt_m9_best` updates locally, and Tab B's chat shows
      `* MISSION  <name> flew the airmail route in <t>s`. Verify the time lands on the
      m9 board, NOT the ribbon board (client sent numeric `m:9`).
- [ ] **Local best gates the chain.** `lt_m9_best` is set; `m9Best` removes m9 from the
      waypoint progression (the objective chain is now complete — no marker).
- [ ] **Timer expiry = clean fail + instant retry.** Let the clock run out → fail
      caption (`THE CLOCK BEAT YOU - THE TRUCK LEFT WITHOUT THE BAG.`), mission resets
      to `idle`, no submit (Tab B chat unchanged, `#scoreList9` unchanged); `E` at the
      ring restarts immediately where you stand (waypoint 1 relit, clock reset).
- [ ] **No mission overlap.** During a run, `E` at other rings does nothing;
      `allIdle()` includes `mission9`.
- [ ] **Private-room run doesn't rank.** Play m9 in a `#room=` private room → the
      mission plays and `lt_m9_best` still saves, but there's no global-board write and
      no chat announce (inherits F4's score gate). In PUBLIC it ranks normally.
- [ ] **Server plumbing complete.** `m9` is in `BOARDS`, the `scores` literal, the
      score map, the `WIN` object (`[25000, 300000]`), and the announce map — a win
      persists to `scores.json` under `m9` and survives a server restart.
- [ ] **Surfaces updated together.** README mission list, the `#tut` MISSION 9 grid
      line, and the `#scoreList9` scores-modal block are all present.
- [ ] **Standing gate green.** `node --check web/app.js && node --check server.js`
      pass and `npm test` (`node test/smoke.mjs`) is all green.
