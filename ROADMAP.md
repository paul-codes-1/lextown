# LEXTOWN-01 — Roadmap

LEXTOWN is a free, open-source (MIT) block simulator of downtown Lexington, KY —
walk, drive, fly a jetpack, wrangle loose thoroughbreds, and shoot a news
chopper out of the sky over the Central Bank Tower, all in one shared browser
world. It's three days old and moving fast. This is where it's headed.

The guiding number: right now the **median session is 48 seconds**. Framerate is
fine (60fps mean), the world is dense, and the missions are good once you find
them — the gap is the *first minute*. Almost everything in NOW is about getting a
brand-new player from "what is this" to "oh, I have a job to do" before they
close the tab. After that, it's about giving them a reason to come back.

We build in the open. Items move between phases as telemetry tells us what's
actually working. Nothing here promises a date.

---

## NOW — the first-minute release (Phase 1)

The retention release. Detailed build spec lives in `PHASE1-SPEC.md`.

- **You always know where to go.** A new on-screen objective marker points at
  your next mission from the moment you spawn — a diamond when it's in view, a
  clamped edge-arrow with a distance readout when it's not. The 130-meter walk
  from spawn to the ribbon-cutting ring stops being a guessing game.
- **A guided first 90 seconds.** Close the tutorial and Dispatch hands you one
  clear objective, a pulsing waypoint, and a short banner that fades once you
  arrive. One job, impossible to miss.
- **Mission 5: DEADLINE.** NEWS 630 THE BLOCK needs footage for the six o'clock.
  Grab the news car and hit a string of glowing checkpoints across the real
  downtown grid before the clock runs out — a proper race that finally leans on
  the one-way streets, signals, and radio the city already simulates. New global
  leaderboard.
- **The city talks again.** The six-persona ambient NPC chatter process gets
  wired into production so a near-solo session still feels populated — Lexington
  small-talk in the chat log, a couple of them walking near spawn.
- **HORSEPOWER gets found.** Mission 4 has *zero* recorded completions. The new
  waypoint plus per-horse guidance and a first-attempt coaching line fix the
  "I never found the green ring" problem; difficulty tuning follows the data.

---

## NEXT — depth and company

Once people are staying past the first minute, give them reasons to stay for the
tenth.

- **Ride shotgun.** Hop into a friend's car as a passenger — hand on the door,
  they drive, you watch downtown roll by with the radio on. The single
  most-requested kind of "play together" moment.
- **Private worlds / rooms.** A shareable room code so you and your friends get
  your own instance of Lexington instead of the public commons.
- **It remembers you.** Account-less persistence — your name and your mission
  best-times follow you back without ever creating an account (privacy promise
  intact).
- **More missions.** A sixth and seventh job that lean on under-used systems —
  the jetpack, the freeze blaster, the horse farms past New Circle.
- **Mobile that feels native.** Tighter touch controls, a cleaner first-touch
  onboarding, performance headroom on mid-range phones.
- **HORSEPOWER, tuned.** With completion data in hand, adjust the spook radius
  and run-speed threshold so it's hard, not impossible.

---

## LATER — scale, seasons, and the Lexington of it all

- **Spatial interest management.** Only sync the players near you, so the
  commons can hold a crowd instead of a handful.
- **Seasons & live events.** Keeneland meets, a real snow day, First Friday —
  time-boxed events that change the city and the leaderboards.
- **Weather beyond the storm.** Rain, fog, and heat-shimmer to go with the snow
  emergency the plow mission already ships.
- **Spectate & share.** Watch the current chopper pilot, drop into a running
  race, capture a clean replay clip.
- **Cosmetics, no pay-to-win.** Avatar colors, hats, plate frames — all free.
- **Civic-data crossovers.** LEXTOWN is one repo in a whole Lexington-news
  system. A live tie-in — real weather, a real council headline on the ticker,
  a real Lexington event lighting up on the map — is the long game.
- **Community modding.** It's MIT and it's two files. Make it easy to fork the
  city.

---

*Have an idea? It's open source — open an issue, or just fork it and build the
Lexington you want to walk around in.*
