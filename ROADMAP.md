# LEXTOWN-01 — Roadmap

LEXTOWN is a free, open-source (MIT) block simulator of downtown Lexington, KY —
walk, drive, fly a jetpack, wrangle loose thoroughbreds, and shoot a news
chopper out of the sky over the Central Bank Tower, all in one shared browser
world. It's days old and moving fast. This is where it's headed.

The guiding number when this doc was born: the **median session was 48
seconds**. Phase 1 (below, shipped) attacked the first minute. Phase 2 attacks
the *second visit* — you stayed, you did a job, now why come back, and why
bring a friend? Almost everything in NOW is about playing *together* and being
remembered when you return.

We build in the open. Items move between phases as telemetry tells us what's
actually working. Nothing here promises a date.

---

## SHIPPED

**Phase 1 — the first-minute release** (July 2026): objective waypoint +
edge-arrow with distance readout, guided first 90 seconds via Dispatch,
Mission 5 DEADLINE (checkpoint race + global board), ambient NPC chatter in
production, HORSEPOWER discoverability, the full New Circle Road loop,
cinematic mode (`#cine=1` + `__lt.cine`), MODDING.md.

**Follow-ons since:** street-following route ribbon + destination beacon;
missions 6 + 7 ripped from the July 2026 headlines (THE MELT, TAILGATE
COMPLIANCE); the radio dial grew to four stations (BIG BLUE 100.1, NEWS 630
THE BLOCK, 98.5 THE CAT, TRACKSIDE 1450) with per-station no-repeat rotations.

**Phase 2 — the company release** (July 2026): who's in the city with you, and
the city knowing you when you walk back in. **Ride shotgun** (passenger seats,
the most-requested play-together moment) · **It remembers you** (your name,
your look, and your bests survive the reload — no account) · **Private
worlds** (share a `#room=` link, get your own Lexington) · **Weather** (rain,
fog, and overcast on a shared real-world schedule) · **HORSEPOWER, tuned**
(from real telemetry: 1 finisher in 138 players) · **Mission 8: LOOSE IN THE
PADDOCK** (the freeze blaster gets a job). Specs in `PHASE2-SPEC.md`; the
smoke suite grew 24 → 51 checks.

**Phase 3 — the postcard release** (July 2026): what you take away.
**Mission 9: AIR MAIL** (the jetpack's showcase — rooftop ring-run, fuel as
the clock) · **Ghost racers** (your best DEADLINE run rides beside you) ·
**Photo mode** (frame it, letterbox it, download a stamped postcard). Specs
in `PHASE2-SPEC.md` §F7 + `PHASE3-SPEC.md`; suite at 56 checks.

**Phase 4 — the comeback release** (July 2026): reasons to come back
tomorrow. **Ride the bus** (THE LOOP circles Main→MLK→Vine→Broadway on a
real schedule — a pure function of the clock, so every player sees the same
bus with zero new protocol) · **Daily Dash** (one seeded checkpoint route a
day, any wheels, its own board that rolls at midnight — and the server's day
beats a spoofed clock) · **Scooter share** (racked kick-scooters, the
missing rung between walking and driving, new net mode `m:5`). Spec in
`PHASE4-SPEC.md`; suite at 62 checks.

---

## NEXT — depth and reasons to return

- **Mobile that feels native.** Tighter touch controls, a cleaner first-touch
  onboarding, performance headroom on mid-range phones.
- **Ride the bus, together.** The LOOP is deterministic — next: bus-stop
  social hooks (a bench you can actually sit on, a schedule board, a second
  crosstown route past Rupp and the campus).
- **Daily Dash seasons.** Weekly recap in chat, streak tracking on the
  device, a monthly hall of fame for most dailies won.

---

## LATER — scale, seasons, and the Lexington of it all

- **Spatial interest management.** Only sync the players near you, so the
  commons can hold a crowd instead of a handful.
- **Seasons & live events.** Keeneland meets, a real snow day, First Friday —
  time-boxed events that change the city and the leaderboards.
- **Leaderboard seasons.** Monthly resets with archived halls of fame, so a
  new player can ever crack a board.
- **Spectate & share.** Watch the current chopper pilot, drop into a running
  race, capture a clean replay clip.
- **Cosmetics, no pay-to-win.** Avatar colors, hats, plate frames — all free.
- **Civic-data crossovers.** LEXTOWN is one repo in a whole Lexington-news
  system. A live tie-in — real weather, a real council headline on the ticker,
  a real Lexington event lighting up on the map — is the long game.
- **Community modding.** It's MIT and it's two files. MODDING.md exists; make
  the first community landmark PR effortless to accept.

---

*Have an idea? It's open source — open an issue, or just fork it and build the
Lexington you want to walk around in.*
