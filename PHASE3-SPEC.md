# LEXTOWN-01 — Phase 3 Build Spec ("The Postcard Release")

Phase 1 fixed the first minute; Phase 2 was about playing *together* and being
remembered. Phase 3 is about what you *take away* — a personal best to chase and a
picture to keep. Both features here turn the world you already move through into
something that persists past the session: your fastest DEADLINE run rides along as
a ghost you can beat, and any view worth keeping becomes a downloadable postcard.
Both are **client-only** — no server surface, no new protocol, nothing leaves the
device unless the player saves a file themselves.

Ground rules that bind every feature (from CLAUDE.md, do not violate):
- ES5 style only: `var`, function statements, no modules/arrow-only/transpiled
  syntax. No new dependencies (server stays `ws`-only). Textures stay
  canvas-generated; no image assets.
- User-visible strings that round-trip the server stay printable ASCII. (Neither
  feature here round-trips anything — but captions/filenames stay ASCII anyway.)
- The privacy promise (`web/privacy.html`) is load-bearing: no accounts, no new
  data collection, chat never stored/logged. A saved photo and a locally-stored
  ghost are on-device only and must not falsify it.
- No map growth. Neither feature touches `WORLD`.
- Verification is the standing one: `node --check web/app.js && node --check
  server.js`, then two browser tabs against localhost exercising the feature.
- Performance floor is real: bottom-decile mobile already runs at ~30fps. Neither
  feature may add per-frame GPU cost to the common path (this rules out
  `preserveDrawingBuffer` and per-frame upscales — see F2).

### Work split at a glance
| Feature | Primary file(s) | Suggested dev |
|---|---|---|
| F1 Ghost Racers (DEADLINE replay) | `web/app.js`, `web/index.html`, `README.md` | Client dev (no server work) |
| F2 Photo Mode | `web/app.js`, `web/index.html`, `README.md` | Client dev (no server work) |

*(F3+ appended below this line.)*

---

## F1 — Ghost Racers (DEADLINE replay)

**Why this matters.** A leaderboard is a number; a ghost is an *opponent*. Right
now the only way to feel your DEADLINE improvement is to read a smaller time in a
modal. A translucent replay of your best run turns every attempt into a live race
against yourself — the single cheapest way to make a solo time-trial addictive,
and the "beat yourself, then beat the board" rung the roadmap calls out. It's
pure client-side polish on the mission that already has the most-simulated system
in the game (the car + street grid).

**The problem, mechanically.** m5 records only *time + checkpoint progress* today
(`mission5 = {stage, tStage, t0, ms, cur, capIdx}`, app.js:3932; elapsed is
`(now - mission5.t0)/1000`, checkpoints in `M5_CPS`, app.js:3922). There is no
positional history — so **recording is net-new**. Nothing about playback is
exotic, though: the game already renders remote cars as meshes at interpolated
positions, and translucent `depthWrite:false` materials are used all over the tree
(e.g. the drop/ring meshes). A ghost is a *self-recorded remote* that never talks
to the server.

### User story
As someone grinding DEADLINE, the moment I start a run my best lap peels off the
line as a faint car beside me — I can see whether I'm ahead or behind at every
corner, and when I finish I know I beat myself before the board even updates.

### Recording (net-new)
- **Sample in `updateMission5`'s driving branch** (app.js:3973) at **10 Hz**
  (decimated from the frame rate) whenever `mission5.stage === 'driving'`. Because
  the stage flips to `'driving'` the instant the mission starts — while you're
  still on foot running to the news car (app.js:3955) — this captures the **whole
  run**, on-foot dash included.
- **Each sample is `{x, z, ry, m}`** — position, heading, and the movement mode
  (`0` on foot / `2` in car), so playback can render you running *then* driving,
  faithfully. (~1200 samples for a 2-minute run.)
- **On a win that beats your best**, quantize + pack the buffer (fixed-point
  positions within `WORLD`, heading to a byte, mode to a nibble), base64 it, and
  store to `localStorage lt_m5_ghost` — ~15–20 KB, comfortably under quota. On a
  non-improving win or a fail, discard the buffer.
- **Version it with a CPS-hash header** — a short hash of `M5_CPS` (+ a map/format
  version). If the checkpoints or the packing format ever change, a stale ghost is
  detected on load and ignored, so a ghost never plays against a course it didn't
  run.

### Playback
- **A dedicated ghost object, NOT in the `remotes` map.** This is the load-bearing
  isolation: the ghost is never taggable, never counted in `peerCount`, never
  relayed, never a freeze/PvP target — it simply doesn't exist to any system that
  walks `remotes`.
- **Render:** a translucent replay avatar/car — reuse `buildRemoteCar` for `m:2`
  samples and `makeAvatar` for `m:0` samples (the same avatar/car switch the
  remote pipeline already does), at **opacity ~0.35, `depthWrite:false`**, in a
  cool desaturated cyan-white "ghost" tint so it never reads as a real player's
  car. An optional faint `BEST` tag floats above it (default on, subtle).
- **Time-lerp against the live clock.** Both your current run and the recording
  share `t0 = mission start`, so the ghost's pose at any instant is the linear
  interpolation between the two samples bracketing your live elapsed time. When
  your run passes the ghost's total duration (you're slower), the ghost has
  finished and parks/fades at its last sample.
- **Pure replay — no determinism needed.** The ghost is fixed data, so there are no
  physics-sync issues. AI traffic and signals differ run-to-run, so the ghost may
  occasionally clip a car that isn't there this lap — **acceptable and expected**
  for a replay; note it, don't fight it.

### HUD — the delta
- **Per-checkpoint split delta.** When you bank checkpoint *k*, compare your split
  time to the ghost's split at *k* and show `±X.Xs vs BEST` in the m5 HUD hint
  line, colored **green when ahead, red when behind**. This is the precise,
  legible signal.
- The **visible ghost car is the ambient signal** — seeing it pull ahead or fall
  back is the moment-to-moment feedback; the split number is the confirmation at
  each corner.

### Controls / HUD surfaces
- **SIM tray (`#tray`):** a `GHOST` toggle (default **on**), persisted to
  `localStorage lt_ghost`, same pattern as the `WAYPT`/`WX` toggles. Off = no
  ghost renders and no split delta shows (recording still happens silently so a
  new best is always saved).
- **First-ghost discovery caption:** the first time a ghost appears (you start m5
  with a saved best), a one-shot caption — `YOUR BEST RUN RIDES WITH YOU` — gated
  by a `localStorage lt_ghost_seen` flag, never repeated.
- **README + tutorial:** one line each ("Your best DEADLINE run replays as a ghost
  car — race yourself"). Not a keypress, so no `#help` row.

### Multiplayer behavior
None. The ghost is local replay data; nothing relays, nothing touches the server
or the board. Other players never see your ghost. Works identically online,
offline, and bots-only. The DEADLINE score submit is completely unchanged.

### Performance
- Playback is **one extra mesh** (a car or avatar) updated once per frame during a
  DEADLINE run only — negligible, and only present while racing.
- The recording is a 10 Hz array push during the mission — trivial.
- On `IS_COARSE`, the ghost still renders (one translucent mesh is cheap); the
  `GHOST` tray toggle is the escape hatch if a low-end device wants it off.

### Edge cases
- **No saved best:** no ghost, no delta, no caption — first-timers race clean and
  the recording quietly banks their first ghost on a win.
- **Stale/foreign ghost** (CPS-hash mismatch, corrupt/oversized value, or
  `localStorage` throws): detected on load and ignored; the mission plays without a
  ghost, no console error. Every storage access is `try/catch`.
- **You beat your best mid-session:** the new recording replaces `lt_m5_ghost` on
  that win; the *next* run races the improved ghost (don't hot-swap the ghost
  mid-run).
- **On-foot vs in-car segment:** handled by the per-sample mode — translucent
  avatar while the ghost is running to the car, translucent car once it's driving.
  *(If the team wants the simplest possible first cut, starting the ghost at first
  car-entry is a fallback — but recording the whole run per the brief is the
  faithful version and reuses the existing avatar/car switch, so it's recommended.)*
- **Ghost toggled off mid-run:** it vanishes immediately; toggled on again, it
  resumes at the correct time-lerped pose (it's stateless replay).
- **Fail or quit:** the in-progress recording is discarded; the saved best ghost is
  untouched.

### Non-goals (F1)
- **No sharing ghosts between players or devices** — that would need a server to
  store/transfer the blob and is a genuine future feature; flag it, don't build it.
- **No ghosts for other missions** — DEADLINE only this phase (it's the one driving
  time-trial; the others aren't lap-shaped).
- **No ghost collision or interaction** — it's a visual replay you pass *through*.
- **No multi-ghost / medal ghosts** (global-record ghost, friend ghosts) — future,
  and server-dependent.

### Acceptance checklist — F1 Ghost Racers

Precondition: m1–m4 beaten (so DEADLINE is startable), every mission idle. One tab
is enough (ghost is local); standing gate first (`node --check` both files,
`npm test`).

- [ ] **No best → no ghost, first ghost banks.** With `lt_m5_ghost` cleared, run
      DEADLINE — no ghost, no delta. Win → `lt_m5_ghost` is now set (~15–20 KB).
- [ ] **Ghost appears next run + discovery caption.** Start DEADLINE again → the
      translucent ghost peels off the line, and the one-shot `YOUR BEST RUN RIDES
      WITH YOU` caption fires once (sets `lt_ghost_seen`, never repeats).
- [ ] **Whole-run fidelity.** The ghost runs *on foot* to the news car, then drives
      — a translucent avatar then a translucent car, matching your recorded run.
- [ ] **Time-aligned + split delta.** The ghost is where you were at the same
      elapsed time; each checkpoint shows `±X.Xs vs BEST`, green when ahead, red
      when behind.
- [ ] **Beating your best replaces the ghost.** A faster win overwrites
      `lt_m5_ghost`; the next run races the improved ghost.
- [ ] **Never taggable/counted.** The ghost is not in `remotes` — `peerCount` is
      unaffected, darts pass through it, it never appears in any player list.
- [ ] **GHOST tray toggle + persistence.** Toggle `GHOST` off → no ghost/no delta,
      persists across reload (`lt_ghost==='0'`); recording still banks a new best.
      Toggle on → resumes.
- [ ] **Stale ghost ignored.** Hand-edit `lt_m5_ghost` to a bad/again-hashed value
      → it's ignored on load, the run plays ghost-free, no console error.
- [ ] **No multiplayer leakage.** In a second tab, the racer's ghost is invisible;
      no new WS traffic; the score submit/announce is unchanged.
- [ ] **Standing gate green.** `node --check web/app.js && node --check server.js`
      pass and `npm test` is all green.

### Notes for the architect (F1)
- **The ghost lives beside `mission5`, never inside `remotes`.** A single module
  object (`ghost = {samples, dur, mesh, ...}`) built at mission start from
  `lt_m5_ghost`, updated in `updateMission5`, torn down on mission end.
- **Sample `{x, z, ry, m}` at 10 Hz** by accumulating `dt` in the driving branch;
  quantize on save, not per-sample. Version the blob with a `M5_CPS` hash so a
  checkpoint edit invalidates old ghosts.
- **Reuse the avatar/car switch** from `updateRemotes` for playback so on-foot and
  driving segments both render; force the material translucent
  (`transparent:true, opacity:0.35, depthWrite:false`) and a ghost tint.
- **Split delta = compare banked split times**, not continuous path distance —
  it's exact and cheap, and it reuses the checkpoint-advance point already in
  `updateMission5` (app.js:3989).
- **Every `localStorage` touch is `try/catch`**; a bad ghost never breaks a run.

---

## F2 — Photo Mode

**Why this matters.** LEXTOWN is a *place* — a stylized downtown people already
orbit with the drone camera. Photo Mode lets them keep a piece of it: frame a
shot, letterbox it, download a clean `lextown-….jpg`. Every saved postcard is a
free, watermarked share that points back at the game, and it's the natural payoff
for the cinematic camera work that already exists. Almost the entire feature is
composition of parts the engine already has.

**The problem, mechanically.** The posing rig, the pause, and the letterbox all
exist — they've just never been pointed at "save a picture." The **drone camera**
(`mode === 'drone'`, `toggleMode()` at app.js:5531, `V`) is already a
player-controlled orbit/pan/zoom rig; the **sim pause** (`paused`, `togglePause()`
at app.js:5610) freezes traffic and peds; **letterbox bars** already draw on the
2D overlay canvas (`cineLetterbox()`, app.js:5315); and the **HUD-strip** pattern
exists (CINE mode hides all chrome, app.js:5892). The only net-new piece is the
**capture**: grabbing the rendered frame and compositing it to a downloadable JPEG
without paying the global GPU cost of `preserveDrawingBuffer`.

### User story
As a player who just lined up the Central Bank Tower against a pink dusk, I open
Photo Mode, the HUD melts away behind two letterbox bars, I nudge the camera, tap
the shutter, and a clean postcard downloads with a little LEXTOWN stamp in the
corner.

### The capture technique (the one careful bit)
- **No `preserveDrawingBuffer`.** Setting it imposes a permanent per-frame GPU cost
  on *every* session, and bottom-decile mobile is already at 30fps — unacceptable.
- Instead, a **grab-next-frame flag**: the shutter sets `captureNext = true`;
  immediately **after** `renderer.render(scene, camera)` (app.js:6429), while the
  drawing buffer is still valid, if `captureNext` the code composites and clears
  the flag. This pays the readback cost only on the frames a photo is actually
  taken.
- **Composite on an offscreen 2D canvas:** draw the WebGL canvas, then the
  letterbox bars (reuse `cineLetterbox`'s geometry), then a small `LEXTOWN`
  corner stamp → `canvas.toBlob(blob => …, 'image/jpeg', 0.92)`.
- **Save:** an `<a download="lextown-<timestamp>.jpg">` click on the blob URL.
  **Mobile-Safari fallback** (no programmatic download): open the blob URL in a new
  tab so the user can long-press → Save Image.

### UX flow
1. **Enter** via a **PHOTO button in the SIM tray** (the collision-free home next
   to the drone/first-person/overlay toggles — no global hotkey, since `P` is
   pause and `V` is the mode toggle). Entering Photo Mode:
   - switches to the **drone rig** (if not already there) so the camera is
     free-flying;
   - **pauses the sim** (freeze traffic/peds for a clean frame) — with an on-screen
     toggle to un-pause if the player wants motion;
   - **hides all HUD/chrome** (reuse the CINE strip) and draws the **letterbox
     bars**.
2. **Pose** with the existing drone controls — `WASD`/drag to pan and orbit, wheel
   to zoom — all already player-driven.
3. **Shutter:** an on-screen **camera button** (bottom-center; works on touch and
   desktop). Desktop convenience: **Enter** acts as the shutter while Photo Mode is
   active (chat is suppressed in Photo Mode, so Enter is free) — the architect
   confirms no other collision.
4. **A photo downloads** (`lextown-<timestamp>.jpg`); a brief screen-flash /
   shutter cue confirms the grab.
5. **Exit** returns the HUD, unpauses if Photo Mode paused it, and drops back to
   whatever camera mode you came from.

### What's in / out of the frame
- **Hidden:** the entire DOM HUD + the 2D overlay chrome (detection boxes, joystick,
  crosshair, tags) — same set CINE hides.
- **Name tags:** **off by default** (a clean postcard), with a small **TAGS** toggle
  in the Photo Mode panel for players who want their friends labeled.
- **Letterbox:** **on by default**, toggleable off (some people want the full
  frame).
- **The LEXTOWN stamp** is always on — it's the watermark that makes a shared
  postcard point home; small, bottom-right, low-opacity wordmark on the 2D
  composite.

### Controls / HUD surfaces
- **SIM tray:** the `PHOTO` entry button; inside Photo Mode a minimal panel —
  **shutter**, **PAUSE** toggle, **BARS** toggle, **TAGS** toggle, **EXIT**.
- **README + tutorial:** one line ("Photo Mode: pose with the drone camera,
  letterbox it, download a postcard"). The shutter/Enter is documented in the Photo
  Mode panel itself (contextual), not the global `#help` bar.
- No persisted preference is required (Photo Mode is a transient state); if the
  team wants the BARS/TAGS choices remembered, a `lt_photo` pref is optional and
  would join the privacy "preference toggles" clause — flagged, not required.

### Multiplayer behavior
None. Photo Mode is a local camera + capture state. Other players are unaffected
(and if any are visible in-frame, they're rendered exactly as always). Nothing
relays; the sim pause is local (it already is). The photo never leaves the device
unless the user saves the file.

### Performance
- **Zero added cost on the common path** — the capture flag is read once per frame
  and is false except on an actual shutter press; the readback + `toBlob` happen
  only when a photo is taken.
- **Resolution = the current canvas size.** Upscaling via `renderer.setSize` for a
  higher-res export is a **non-goal** (it's a heavy resize mid-session and risks the
  mobile budget) — postcards are at display resolution.
- The letterbox + stamp are cheap 2D-canvas draws only at capture time.

### Edge cases
- **Mobile Safari** can't trigger a programmatic download → open the blob in a new
  tab for long-press-save (above).
- **`toBlob` unsupported / returns null** (very old browsers): fail quietly with a
  one-line caption ("couldn't save that shot"), no crash.
- **Shutter pressed the same frame as a mode change / resize:** the flag is honored
  on the next valid post-render; a resize between set and read just captures the new
  size — harmless.
- **Entering Photo Mode from player (first-person) mode:** it switches to the drone
  rig; exiting restores the prior mode and camera.
- **Pause interaction:** if the sim was already paused before entering, exiting
  Photo Mode leaves it paused (don't un-pause something the player set); only
  auto-un-pause what Photo Mode itself paused.
- **Tags/bars toggles** affect only the composite and the live preview, never the
  underlying game state.

### Non-goals (F2)
- **No filters, no color grading, no stickers** — the visual presets belong to a
  different surface; Photo Mode is frame + letterbox + stamp.
- **No in-game gallery / history** — the browser's download is the gallery; nothing
  is stored.
- **Nothing leaves the device** — no upload, no share endpoint, no server. A saved
  file is the only output.
- **No super-resolution / upscaled export** — display resolution only.
- **No new global hotkey** — Photo Mode is entered from the tray to avoid key
  collisions.

### Acceptance checklist — F2 Photo Mode

One tab; standing gate first (`node --check` both files, `npm test`).

- [ ] **Enter from the tray.** The SIM-tray `PHOTO` button switches to the drone
      rig, pauses the sim, hides all HUD, and shows the letterbox bars.
- [ ] **Pose freely.** `WASD`/drag/wheel pan, orbit, and zoom the camera in Photo
      Mode exactly as in drone mode.
- [ ] **Shutter downloads a clean JPEG.** The on-screen shutter (and Enter on
      desktop) downloads `lextown-<timestamp>.jpg` — the 3D frame + letterbox bars +
      a small LEXTOWN corner stamp, no HUD, name tags off by default.
- [ ] **No `preserveDrawingBuffer`.** Confirm the renderer is *not* created with
      `preserveDrawingBuffer` and capture still works (grab-next-frame after
      `renderer.render`); the common-path frame rate is unchanged.
- [ ] **Bars / tags / pause toggles.** BARS off = full frame; TAGS on = name tags in
      the shot; PAUSE toggle resumes/freezes the sim in the live preview and the
      capture.
- [ ] **Exit restores state.** Leaving Photo Mode brings back the HUD, un-pauses
      only if Photo Mode paused it, and returns to the prior camera mode.
- [ ] **Mobile fallback.** On a browser without programmatic download, the shutter
      opens the image in a new tab for long-press-save; no crash.
- [ ] **Nothing leaves the device.** No network request accompanies a capture; the
      only output is the saved file.
- [ ] **Standing gate green.** `node --check web/app.js && node --check server.js`
      pass and `npm test` is all green.

### Notes for the architect (F2)
- **Reuse, don't rebuild:** drone rig for posing, `paused` for the freeze,
  `cineLetterbox` geometry for the bars, the CINE chrome-strip for hiding the HUD.
  Photo Mode is mostly a small state flag that composes these.
- **Capture = a `captureNext` flag read right after `renderer.render`**
  (app.js:6429). Do **not** enable `preserveDrawingBuffer` (global GPU cost on the
  30fps mobile floor). Composite gl-canvas + bars + stamp on an offscreen 2D canvas
  → `toBlob('image/jpeg', 0.92)` → `<a download>`; new-tab fallback for mobile
  Safari.
- **Entry is the SIM-tray `PHOTO` button**, not a hotkey — `P`/`V` are taken. The
  shutter is an on-screen button; bind Enter as the desktop shutter only while
  Photo Mode is active (chat is suppressed there).
- **Resolution stays at canvas size** — no `setSize` upscale (heavy + mobile risk).
- **No persisted state required**; if BARS/TAGS memory is wanted, a `lt_photo` pref
  joins the privacy "preference toggles" clause (ships with the disclosure edit,
  per the F2/F3 discipline in the Phase 2 spec).
