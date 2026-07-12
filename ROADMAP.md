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

---

## NOW — the company release (Phase 2)

You stayed past the first minute. This release is about who's in the city with
you — and the city knowing you when you walk back in.

**Status: built.** Every item below (plus Mission 8, pulled forward from NEXT)
is complete on the `feature/next-wave` branch — specs in `PHASE2-SPEC.md`, the
smoke suite grown 24 → 51 checks — awaiting merge + deploy.

- **Ride shotgun.** Hop into a friend's car as a passenger — hand on the door,
  they drive, you watch downtown roll by with the radio on. The single
  most-requested kind of "play together" moment. *(built)*
- **It remembers you.** Account-less persistence — your name, your look, and
  your mission best-times follow you back without ever creating an account
  (privacy promise intact). *(built)*
- **Private worlds / rooms.** A shareable room code so you and your friends get
  your own instance of Lexington instead of the public commons. *(built)*
- **Weather beyond the storm.** Rain and fog rolling through on a real
  schedule — the same sky for everyone, no server required. *(built)*
- **HORSEPOWER, tuned.** With completion data in hand (1 finisher in 138
  players; 86s median session), every friction knob eased — plus a mission
  funnel beacon so the next pass tunes on data. *(built)*
- **Mission 8: LOOSE IN THE PADDOCK.** The freeze blaster finally gets a job —
  settle three escaped foals at Elmendorf before the Keeneland sale. *(built)*

---

## NEXT — depth and reasons to return

- **Mission 9: AIR MAIL.** The jetpack's showcase — a rooftop ring-run over
  the downtown skyline, fuel as the clock. *(specced in PHASE2-SPEC.md)*
- **Ghost racers + photo mode.** Specced ahead in `PHASE3-SPEC.md` ("the
  postcard release") — your best DEADLINE run as a translucent ghost, and
  frame-it-letterbox-it-download-it postcards from LEXTOWN.
- **Ride the bus.** A LexTran route through downtown you can actually board —
  the passenger seat tech, pointed at an NPC driver on a loop.
- **Daily challenge.** One rotating objective a day with its own board —
  a reason to check back in that isn't a friend.
- **Scooter share.** Rentable kick-scooters scattered downtown — the missing
  rung between walking and driving.
- **Mobile that feels native.** Tighter touch controls, a cleaner first-touch
  onboarding, performance headroom on mid-range phones.

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
