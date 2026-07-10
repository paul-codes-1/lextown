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
