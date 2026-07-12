# PHASE 5 — THE POCKET RELEASE

Mobile that feels native. Grounded in production telemetry (2026-07-08→12):
**46% of joins are touch devices**; touch fps holds 60 at the median but the
bottom decile runs at 32; touch devicePixelRatio is 3.0–3.8 native. And two
hard gaps found in code: **sprint is unreachable on touch** (Shift-only), and
the one context button just says "E-VEH" forever.

Same constraints as every phase: app.js is ES5, gate is
`node --check web/app.js && node --check server.js && node test/smoke.mjs`,
controls docs update in four places together, localStorage in try/catch,
no new data collection.

## P1 — Full-tilt sprint
`updatePlayer`'s speed pick (`keysDown.shift ? 13.5 : 7.5`) learns the stick:
pushing the joystick to its rim (magnitude² > 0.85) sprints. No new UI — the
gesture IS the intent. Horse-spook already keys off playerSpeed (13.5 > 12
threshold), so mobile sprinting spooks horses exactly like desktop sprinting —
that's correct and now consistent.

## P2 — Context action button
On coarse pointers the E-VEH button relabels to what E would actually do,
mirroring tryEnterExit's chain order: EXIT (heli/car) · HOP OFF
(shotgun/bus/scooter) · START (any mission/daily ring) · CALM (wild horse) ·
FLY (chopper pad) · SHOTGUN · BOARD (bus doors open) · SCOOT (rack) · DRIVE
(near a car) · E-VEH (idle default). Throttled ~150ms, textContent written
only on change, desktop untouched.

## P3 — Adaptive render quality
A rolling fps window (reuse the diag tracker's counters): sustained < 30fps
for a full window steps `renderer.setPixelRatio` down 0.15 (from the current
1.5 coarse / 2.0 fine cap, floor 1.0), one step per window, never back up
(no oscillation). Diag beacon gains `rq` (current ratio ×10, int) and the
server's diag whitelist logs it — so the next telemetry read shows how often
the bottom decile actually degrades.

## P4 — Haptics
`buzz(pattern)` helper: coarse-only, `navigator.vibrate` guarded in try/catch
(no-op on iOS Safari — fine). Call sites: you get frozen (80ms), mission win
jingle (40-60-40), checkpoint bank m5 + daily (25ms), bus board (20ms),
scooter mount (15ms). No settings toggle in v1 — patterns are short and rare.

## P5 — Touch-first tutorial
On coarse pointers, the existing "ON A PHONE" section (h2 + grid) moves to
the top of the modal (right after the call-sign/room block) at boot — phone
players currently scroll past five keyboard sections to find their controls.
Copy updated: full-tilt = sprint, the context button, JUMP hold = jetpack.
Desktop order unchanged.

## P6 — Landscape tip
One-shot caption ("TIP: LANDSCAPE PLAYS BETTER") the first time a coarse
portrait player closes the tutorial. `lt_rot_seen` in localStorage; never
repeats, never a modal.

## Verification
Gate + emulated-device pass (Chrome DPR/touch emulation): stick full-tilt
reaches 13.5 m/s, button relabels at a bus stop / rack / ring, tut leads
with the phone section, haptic call sites fire (API presence, not feel).
Adversarial review before merge; deploy per runbook.
