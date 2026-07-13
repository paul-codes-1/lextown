#!/usr/bin/env node
// LEXTOWN-01 — headless multiplayer smoke test.
//
//   npm test            (or)   node test/smoke.mjs
//   SMOKE_PORT=18999 node test/smoke.mjs    # pin the throwaway port
//
// Boots server.js as a child on a throwaway port with test ADMIN/NPC tokens,
// drives two (then three) real `ws` clients through the relay, and asserts the
// welcome handshake, state/chat relay, the m5 DEADLINE board (valid + rejected
// score), NPC tagging in /admin/stats, and out-of-bounds move correction.
// A second cast then exercises "Ride Shotgun" — the server-arbitrated passenger
// seat ({t:'ride'} enter/exit/deny/eject, welcome.seats snapshot, CAPS[4] relay
// integrity) over more real ws connections (see runRideAssertions). A third cast
// exercises "Private Worlds / Rooms" — ?room=<code> partitioning: presence /
// chat / leave isolation, welcome.peers filtering, per-room heli independence,
// the private-room score gate, sanitization equivalence, and NPC-forced-PUBLIC
// (see runRoomAssertions). A further pass exercises the fire-and-forget "mev"
// telemetry beacon — validated, rate-limited, log-only, never broadcast (see
// runMevAssertions). Five board passes (runM8/runM9/runM10/runM11/runM12Assertions)
// verify the foal + airmail + HIGH WATER flood + VP-motorcade + THRILLER
// leaderboards end-to-end (the wire ladder 11->'m10', 12->'m11', 13->'m12' all sit
// one notch off the m:10 daily board, so each guards the ladder trap). A DAILY DASH pass covers the m:10 daily
// board: a valid score lands on `d` with the dDay stamp + announce, below-window
// + private-room submits are dropped, and a throwaway second server (booted from
// a stale scores.json) proves rollDaily() empties the board on the EST day flip
// (see runDailyAssertions + runDailyRollAssertion).
// PASS/FAIL per check; exits non-zero if any check fails. Uses only `ws`
// (already a dependency) + node builtins. Re-runnable.
//
// scores.json lives at path.join(__dirname, 'scores.json') in server.js —
// that's REPO-RELATIVE (via __dirname), not CWD-relative, so setting the
// child's cwd does NOT redirect it. We therefore snapshot the repo's real
// scores.json before the run and restore it byte-for-byte afterward. The run
// also appends a handful of join/leave/mission lines to logs/ (gitignored,
// 14-day auto-pruned telemetry) — harmless and left in place.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SERVER = path.join(ROOT, 'server.js');
const SCORES = path.join(ROOT, 'scores.json');
const PORT = Number(process.env.SMOKE_PORT) || (18900 + Math.floor(Math.random() * 80));
const ADMIN_TOKEN = 'smoke-admin-tok';
const NPC_TOKEN = 'smoke-npc-tok';
const WS_URL = `ws://127.0.0.1:${PORT}`;
const HTTP_URL = `http://127.0.0.1:${PORT}`;

// Spawn-fix spawn position (in-bounds, near the real spawn x:14,z:-9.5).
const AX = 14, AY = 1, AZ = -9.5;

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}${detail ? '  — ' + detail : ''}`); }
}
// soft assertion for OPTIONAL coverage: a miss prints SKIP and does NOT fail the
// suite (used for R9, the admin /list room column, which the contract lists as
// optional). A pass still counts toward the total.
function softCheck(name, cond, detail) {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { console.log(`SKIP  ${name} (optional)${detail ? '  — ' + detail : ''}`); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// EST-anchored day seed — MUST match server.js dayIndex() byte-for-byte (the
// DAILY DASH board rolls on this; any drift here is a split-brain test).
const dayIndex = () => Math.floor((Date.now() - 5 * 3600e3) / 86400e3);

// --- tiny ws client harness ----------------------------------------------
// `base` overrides WS_URL so a throwaway second server (D4 day-roll) can be
// driven on its own port; omitted everywhere else (defaults to the shared box).
function connect(query, base) {
  const c = { ws: new WebSocket((base || WS_URL) + '/' + (query || '')), msgs: [], waiters: new Set() };
  c.ws.on('message', (d) => {
    let m; try { m = JSON.parse(d); } catch { return; }
    c.msgs.push(m);
    for (const w of [...c.waiters]) w(m);
  });
  c.ws.on('error', () => {}); // swallow late errors on close races
  return c;
}
function opened(c) {
  return new Promise((resolve, reject) => {
    if (c.ws.readyState === WebSocket.OPEN) return resolve();
    c.ws.once('open', resolve);
    c.ws.once('error', reject);
  });
}
function send(c, obj) { c.ws.send(JSON.stringify(obj)); }
// resolve with the first message (from index `from` in the backlog, then
// future) matching pred; reject on timeout.
function expect(c, pred, opts) {
  const { timeout = 2500, from = 0 } = opts || {};
  return new Promise((resolve, reject) => {
    for (let i = from; i < c.msgs.length; i++) if (pred(c.msgs[i])) return resolve(c.msgs[i]);
    const t = setTimeout(() => { c.waiters.delete(w); reject(new Error('timeout')); }, timeout);
    const w = (m) => { if (pred(m)) { clearTimeout(t); c.waiters.delete(w); resolve(m); } };
    c.waiters.add(w);
  });
}

function bootServer(port = PORT) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(port), ADMIN_TOKEN, NPC_TOKEN },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '', settled = false;
    const to = setTimeout(() => { if (!settled) { settled = true; reject(new Error('server did not start in 8s:\n' + out)); } }, 8000);
    child.stdout.on('data', (d) => {
      out += d;
      if (!settled && out.includes('LEXTOWN-01 on')) { settled = true; clearTimeout(to); resolve(child); }
    });
    child.stderr.on('data', (d) => process.stderr.write('[server] ' + d));
    child.on('exit', (code) => { if (!settled) { settled = true; clearTimeout(to); reject(new Error('server exited early (code ' + code + '):\n' + out)); } });
  });
}

async function runAssertions() {
  // 1. welcome handshake, both clients; B's peers reflect A.
  const A = connect();
  await opened(A);
  const wA = await expect(A, (m) => m.t === 'welcome');
  check('1a. A receives welcome handshake', wA && typeof wA.id === 'string' && Array.isArray(wA.peers), JSON.stringify(wA).slice(0, 100));

  // A fixes its spawn with a named state packet BEFORE B joins, so it shows in
  // B's welcome.peers (peers = clients with an accepted state).
  send(A, { t: 'state', n: 'ALICE', c: 0x3a76c4, m: 0, p: 0, x: AX, y: AY, z: AZ, ry: 0 });
  await sleep(150);

  const B = connect();
  await opened(B);
  const wB = await expect(B, (m) => m.t === 'welcome');
  const peerA = (wB.peers || []).find((p) => p.id === wA.id);
  check('1b. B welcome/peers reflects A', !!peerA && peerA.n === 'ALICE', 'peers=' + JSON.stringify(wB.peers));

  // 2. A's valid state packet is relayed to B.
  send(A, { t: 'state', n: 'ALICE', c: 0x3a76c4, m: 0, p: 0, x: AX, y: AY, z: AZ, ry: 0.2 });
  const relayed = await expect(B, (m) => m.t === 'state' && m.id === wA.id);
  check('2. B receives A relayed state', relayed && Math.abs(relayed.x - AX) < 1e-6 && Math.abs(relayed.ry - 0.2) < 1e-6, JSON.stringify(relayed));

  // 3. A's chat reaches B.
  send(A, { t: 'chat', msg: 'hello from A' });
  const chat = await expect(B, (m) => m.t === 'chat' && m.id === wA.id);
  check('3. B receives A chat', chat && chat.msg === 'hello from A' && chat.n === 'ALICE', JSON.stringify(chat));

  // 4. valid m5 DEADLINE score (m:5 numeric, 120s ∈ [30s,480s]) → board entry +
  //    chat announce. {t:'scores'} is sent only to the submitter (A); the
  //    announce is broadcast (B sees it).
  send(A, { t: 'score', m: 5, ms: 120000 });
  const scoresMsg = await expect(A, (m) => m.t === 'scores');
  const m5entry = (scoresMsg.m5 || []).find((s) => s.ms === 120000 && s.n === 'ALICE');
  const announce = await expect(B, (m) => m.t === 'chat' && m.n === '* MISSION');
  check('4a. valid m5 score lands on the board', !!m5entry, 'm5=' + JSON.stringify(scoresMsg.m5));
  check('4b. m5 score fires the chat announce', !!announce && /beat the deadline/.test(announce.msg || ''), JSON.stringify(announce));

  // 5. below-floor m5 score (10s < 30s) is rejected by the WIN window before it
  //    ever touches the board (this check precedes the 15s rate-limit in
  //    server.js, so it's rejected on merit, not throttling). Re-query the board
  //    and confirm no 10s entry appeared.
  const from = A.msgs.length;
  send(A, { t: 'score', m: 5, ms: 10000 });
  await sleep(200);
  send(A, { t: 'scores' });
  const scores2 = await expect(A, (m) => m.t === 'scores', { from });
  const hasLow = (scores2.m5 || []).some((s) => s.ms === 10000);
  const keptValid = (scores2.m5 || []).some((s) => s.ms === 120000);
  check('5. below-floor m5 score rejected (board unchanged)', !hasLow && keptValid, 'm5=' + JSON.stringify(scores2.m5));

  // 6. NPC-tagged client (?npc=<token>) is excluded from human count but present
  //    in total + roster.
  const C = connect('?npc=' + NPC_TOKEN);
  await opened(C);
  await expect(C, (m) => m.t === 'welcome');
  const res = await fetch(`${HTTP_URL}/admin/stats?token=${ADMIN_TOKEN}`);
  const st = await res.json();
  const roster = st.online || [];
  const npcRows = roster.filter((o) => o.npc === 1);
  const humanRows = roster.filter((o) => !o.npc);
  check('6a. /admin/stats humans excludes NPC (=2)', st.humans === 2, 'humans=' + st.humans);
  check('6b. /admin/stats total includes NPC (=3)', st.total === 3, 'total=' + st.total);
  check('6c. roster = 2 humans + exactly 1 npc', humanRows.length === 2 && npcRows.length === 1, JSON.stringify(roster));

  // 7. out-of-bounds state packet: server sends A a `correct` snap-back (to its
  //    last accepted pos) and does NOT relay the bad state to B.
  const bfrom = B.msgs.length;
  send(A, { t: 'state', n: 'ALICE', c: 0x3a76c4, m: 0, p: 0, x: 99999, y: AY, z: AZ, ry: 0 });
  const corr = await expect(A, (m) => m.t === 'correct');
  await sleep(300);
  const leaked = B.msgs.slice(bfrom).some((m) => m.t === 'state' && m.id === wA.id && m.x === 99999);
  check('7a. out-of-bounds move gets a `correct` snap-back', !!corr && Math.abs(corr.x - AX) < 1e-6, JSON.stringify(corr));
  check('7b. out-of-bounds move is not relayed to B', !leaked, 'leaked=' + leaked);

  A.ws.close(); B.ws.close(); C.ws.close();
}

// --- Ride Shotgun: server-arbitrated passenger seat (task #7) ----------------
// A fresh cast exercises the {t:'ride'} enter/exit/deny/eject protocol, the
// welcome.seats snapshot, and CAPS[4] relay integrity, all over real ws
// connections. The server pins each client's position from ACCEPTED state
// packets and reads client.pos/lastM for the ride range + mode checks, so every
// client fixes its spawn with a couple of state packets first (m:2 for drivers
// so lastM===2; m:0 for walkers). Positions stay inside WORLD (x -745..845,
// z -1525..1025, y -1..190) and every hop is 0-3 m so the token-bucket travel
// budget never false-rejects; packets are spaced >100ms to respect MAX_STATE_HZ.
//   Cast: RA/RD drive; RB walks then rides (main subject); RC observes every
//   broadcast; RE/RF are second-seat passengers. RIDE_RANGE is 12 m server-side.
async function runRideAssertions() {
  // timeout-tolerant expect: a miss becomes a failed check, not an aborted run.
  // Ride broadcasts are instant, so a short timeout keeps failures cheap.
  const want = async (c, pred, opts) => {
    try { return await expect(c, pred, { timeout: 1500, ...(opts || {}) }); }
    catch { return null; }
  };
  const state = (cl, m, x, z, n) =>
    send(cl, { t: 'state', n, c: 0x3a76c4, m, p: 0, x, y: 1, z, ry: 0 });
  const rideEnter = (cl, drv) => send(cl, { t: 'ride', a: 'enter', drv });
  const isEnter = (drv, pax) => (m) => m.t === 'ride' && m.a === 'enter' && m.drv === drv && m.pax === pax;
  const isExit  = (drv, pax) => (m) => m.t === 'ride' && m.a === 'exit'  && m.drv === drv && m.pax === pax;
  const isEject = (drv, pax) => (m) => m.t === 'ride' && m.a === 'eject' && m.drv === drv && m.pax === pax;

  // cast + welcome ids
  const RA = connect(); await opened(RA); const A = (await expect(RA, (m) => m.t === 'welcome')).id;
  const RB = connect(); await opened(RB); const B = (await expect(RB, (m) => m.t === 'welcome')).id;
  const RC = connect(); await opened(RC); const C = (await expect(RC, (m) => m.t === 'welcome')).id;

  // fix spawns: A drives (m:2) at the spawn point; B & C walk (m:0) 3 m either
  // side of A (well inside RIDE_RANGE=12). Two packets each so lastM + pos stick.
  for (let i = 0; i < 2; i++) {
    state(RA, 2, 14, -9.5, 'RADRIVER');
    state(RB, 0, 17, -9.5, 'RBRIDER');
    state(RC, 0, 11, -9.5, 'RCWATCH');
    await sleep(140);
  }

  // E1: B boards A -> the enter grant broadcasts to BOTH requester B and observer C.
  rideEnter(RB, A);
  const e1b = await want(RB, isEnter(A, B));
  const e1c = await want(RC, isEnter(A, B));
  check('E1a. ride enter grant reaches requester B', !!e1b, JSON.stringify(e1b));
  check('E1b. ride enter grant reaches observer C', !!e1c, JSON.stringify(e1c));

  // E1c: a client joining mid-ride sees the live seat in welcome.seats.
  const RL = connect(); await opened(RL);
  const wRL = await expect(RL, (m) => m.t === 'welcome');
  const seatSnap = (wRL.seats || []).find((s) => s.drv === A && s.pax === B);
  check('E1c. welcome.seats snapshot reflects the active ride', !!seatSnap, 'seats=' + JSON.stringify(wRL.seats));
  RL.ws.close();

  // E2: C tries to board the taken seat -> deny to C, and NO second enter
  // broadcast reaches B (negative window, like the non-relay check #7b).
  const bMark = RB.msgs.length, cDenyMark = RC.msgs.length;
  state(RC, 0, 12, -9.5, 'RCWATCH');   // "moves near A" (already in range; 1 m hop)
  await sleep(120);
  rideEnter(RC, A);
  const e2deny = await want(RC, (m) => m.t === 'ride' && m.a === 'deny', { from: cDenyMark });
  await sleep(300);
  const doubled = RB.msgs.slice(bMark).some(isEnter(A, C));
  check('E2a. second boarder C is denied (seat taken)', !!e2deny, JSON.stringify(e2deny));
  check('E2b. denied board sends no enter broadcast to B', !doubled, 'doubled=' + doubled);

  // E3: seated B sends an m:4 state -> C receives it relayed with m===4 (CAPS[4]
  // relay integrity; unknown modes used to be rewritten to 0). B hops to A's seat.
  const cMark = RC.msgs.length;
  state(RB, 4, 14, -9.5, 'RBRIDER');
  const e3 = await want(RC, (m) => m.t === 'state' && m.id === B && m.m === 4, { from: cMark });
  check('E3. m:4 passenger state relays as m:4 (not rewritten to 0)', !!e3, JSON.stringify(e3));

  // E4: driver A leaves drive mode (m:0) -> everyone gets eject{drv:A,pax:B}.
  await sleep(140);
  const e4bMark = RB.msgs.length, e4cMark = RC.msgs.length;
  state(RA, 0, 14, -9.5, 'RADRIVER');   // mode-switch slack covers the 0 m hop
  const e4b = await want(RB, isEject(A, B), { from: e4bMark });
  const e4c = await want(RC, isEject(A, B), { from: e4cMark });
  check('E4. driver leaving drive mode ejects the passenger (broadcast)', !!e4b && !!e4c,
    `B=${JSON.stringify(e4b)} C=${JSON.stringify(e4c)}`);

  // E5: rebind (A resumes m:2, B re-boards), then A disconnects -> B gets eject.
  await sleep(140);
  state(RA, 2, 14, -9.5, 'RADRIVER');   // back to driving
  await sleep(140);
  state(RB, 0, 14, -9.5, 'RBRIDER');    // B on foot at the car
  await sleep(140);
  const e5cMark = RC.msgs.length;
  rideEnter(RB, A);
  const e5bind = await want(RC, isEnter(A, B), { from: e5cMark });
  const e5Mark = RB.msgs.length;
  RA.ws.close();                        // driver vanishes
  const e5eject = await want(RB, isEject(A, B), { from: e5Mark });
  check('E5a. passenger re-boards after driver resumes driving', !!e5bind, JSON.stringify(e5bind));
  check('E5b. driver disconnect ejects the passenger', !!e5eject, JSON.stringify(e5eject));

  // E6: B (on foot at the old spot) tries to board a NEW driver D ~40 m away ->
  // deny purely on proximity (seat empty, D is driving, B is walking).
  const RD = connect(); await opened(RD); const D = (await expect(RD, (m) => m.t === 'welcome')).id;
  for (let i = 0; i < 2; i++) { state(RD, 2, 14, -50, 'RDDRIVER'); await sleep(140); }
  const e6Mark = RB.msgs.length;
  rideEnter(RB, D);                     // dist ~40.5 m > RIDE_RANGE
  const e6 = await want(RB, (m) => m.t === 'ride' && m.a === 'deny', { from: e6Mark });
  check('E6. out-of-range board request is denied', !!e6, JSON.stringify(e6));

  // E7: E binds D, E disconnects -> observer sees exit{drv:D,pax:E} and the seat
  // frees so F can then board D successfully.
  const RE = connect(); await opened(RE); const E = (await expect(RE, (m) => m.t === 'welcome')).id;
  const RF = connect(); await opened(RF); const F = (await expect(RF, (m) => m.t === 'welcome')).id;
  for (let i = 0; i < 2; i++) { state(RE, 0, 16, -50, 'RERIDER'); state(RF, 0, 12, -50, 'RFRIDER'); await sleep(140); }
  const e7bindMark = RC.msgs.length;
  rideEnter(RE, D);
  const e7bind = await want(RC, isEnter(D, E), { from: e7bindMark });
  const e7exitMark = RC.msgs.length;
  RE.ws.close();
  const e7exit = await want(RC, isExit(D, E), { from: e7exitMark });
  const e7reMark = RC.msgs.length;
  rideEnter(RF, D);
  const e7reboard = await want(RC, isEnter(D, F), { from: e7reMark });
  check('E7a. passenger disconnect frees the seat (exit broadcast)', !!e7bind && !!e7exit,
    `bind=${JSON.stringify(e7bind)} exit=${JSON.stringify(e7exit)}`);
  check('E7b. freed seat accepts a new passenger', !!e7reboard, JSON.stringify(e7reboard));

  RB.ws.close(); RC.ws.close(); RD.ws.close(); RF.ws.close();
}

// --- Private Worlds / Rooms: ?room=<code> partitioning (task #29) ------------
// A third cast verifies room isolation. The relay partitions on a per-connection
// room derived from `?room=<code>` (sanitized to [A-Z0-9_-], <=12, uppercased;
// absent/invalid -> PUBLIC = the commons). Nothing about the message SHAPES
// changes — only WHO receives each broadcast — so these assertions reuse the
// same state/chat/heli/leave/score envelopes as the rest of the suite and check
// cross-room leakage with the existing negative-window pattern (mark, trigger,
// sleep, scan). Heli tests stand a client on HELI_PAD (x:-127, y:129.8, z:11 in
// server.js) so the proximity gate passes; a client's FIRST state packet fixes
// its spawn anywhere in-bounds, so we place pilots on the pad directly.
//   Names deliberately avoid the substring "DERBY"/"ROSE" so R9's room-column
//   probe can't false-positive off a player name.
async function runRoomAssertions() {
  const want = async (c, pred, opts) => {
    try { return await expect(c, pred, { timeout: 1500, ...(opts || {}) }); }
    catch { return null; }
  };
  const st = (cl, m, x, y, z, n) => send(cl, { t: 'state', n, c: 0x3a76c4, m, p: 0, x, y, z, ry: 0 });
  const isState = (id) => (m) => m.t === 'state' && m.id === id;
  const isChat = (id) => (m) => m.t === 'chat' && m.id === id;
  // HELI_PAD from server.js — the only spot a heli `enter` is accepted.
  const PADX = -127, PADY = 129.8, PADZ = 11;

  // cast: A & B share room DERBY; C is PUBLIC (the commons).
  const A_ = connect('?room=DERBY'); await opened(A_); const A = (await expect(A_, (m) => m.t === 'welcome')).id;
  const B_ = connect('?room=DERBY'); await opened(B_); const B = (await expect(B_, (m) => m.t === 'welcome')).id;
  const C_ = connect();              await opened(C_); const C = (await expect(C_, (m) => m.t === 'welcome')).id;

  // R1 presence isolation: A's state reaches DERBY peer B, never PUBLIC C.
  const r1b = B_.msgs.length, r1c = C_.msgs.length;
  st(A_, 0, 14, 1, -9.5, 'ALPHA');
  const r1pos = await want(B_, isState(A), { from: r1b });
  await sleep(300);
  const r1leak = C_.msgs.slice(r1c).some(isState(A));
  check('R1a. state relays to a same-room peer (DERBY->DERBY)', !!r1pos, JSON.stringify(r1pos));
  check('R1b. state does NOT cross into PUBLIC', !r1leak, 'leaked=' + r1leak);

  // R2 welcome filtering: A now has state in DERBY. A fresh DERBY joiner sees A
  // in welcome.peers; a fresh PUBLIC joiner does not.
  const D2 = connect('?room=DERBY'); await opened(D2); const wD2 = await expect(D2, (m) => m.t === 'welcome');
  const P2 = connect();              await opened(P2); const wP2 = await expect(P2, (m) => m.t === 'welcome');
  check('R2a. new DERBY joiner welcome.peers includes DERBY player A', (wD2.peers || []).some((p) => p.id === A), 'peers=' + JSON.stringify(wD2.peers));
  check('R2b. new PUBLIC joiner welcome.peers excludes DERBY player A', !(wP2.peers || []).some((p) => p.id === A), 'peers=' + JSON.stringify(wP2.peers));
  D2.ws.close(); P2.ws.close();

  // R3 chat isolation: A's chat reaches DERBY peer B, never PUBLIC C.
  const r3b = B_.msgs.length, r3c = C_.msgs.length;
  send(A_, { t: 'chat', msg: 'derby only' });
  const r3pos = await want(B_, (m) => isChat(A)(m) && m.msg === 'derby only', { from: r3b });
  await sleep(300);
  const r3leak = C_.msgs.slice(r3c).some(isChat(A));
  check('R3a. chat relays to a same-room peer', !!r3pos, JSON.stringify(r3pos));
  check('R3b. chat does NOT cross into PUBLIC', !r3leak, 'leaked=' + r3leak);

  // R4 per-room heli: a DERBY pilot's enter is seen in DERBY only; the PUBLIC
  // heli is then independently pilotable (two simultaneous pilots, two rooms).
  const HA = connect('?room=DERBY'); await opened(HA); const H = (await expect(HA, (m) => m.t === 'welcome')).id;
  st(HA, 0, PADX, PADY, PADZ, 'HAPILOT');   // stand on the pad
  await sleep(140);
  const r4b = B_.msgs.length, r4c = C_.msgs.length;
  send(HA, { t: 'heli', a: 'enter' });
  const r4derby = await want(B_, (m) => m.t === 'heli' && m.a === 'enter' && m.id === H, { from: r4b });
  await sleep(300);
  const r4leak = C_.msgs.slice(r4c).some((m) => m.t === 'heli' && m.a === 'enter' && m.id === H);
  st(C_, 0, PADX, PADY, PADZ, 'CHARLIE');   // C's first state, on the PUBLIC pad
  await sleep(140);
  const r4c2 = C_.msgs.length;
  send(C_, { t: 'heli', a: 'enter' });
  const r4pub = await want(C_, (m) => m.t === 'heli' && m.a === 'enter' && m.id === C, { from: r4c2 });
  const r4deny = C_.msgs.slice(r4c2).some((m) => m.t === 'heli' && m.a === 'deny');
  check('R4a. heli enter broadcasts inside the room (DERBY sees it)', !!r4derby, JSON.stringify(r4derby));
  check('R4b. heli enter does NOT cross into PUBLIC', !r4leak, 'leaked=' + r4leak);
  check('R4c. PUBLIC heli is independently pilotable (granted, not denied)', !!r4pub && !r4deny,
    `grant=${JSON.stringify(r4pub)} deny=${r4deny}`);

  // R5 leave scoped: closing A tells DERBY peer B, not PUBLIC C.
  const r5b = B_.msgs.length, r5c = C_.msgs.length;
  A_.ws.close();
  const r5pos = await want(B_, (m) => m.t === 'leave' && m.id === A, { from: r5b });
  await sleep(300);
  const r5leak = C_.msgs.slice(r5c).some((m) => m.t === 'leave' && m.id === A);
  check('R5a. leave broadcasts to a same-room peer', !!r5pos, JSON.stringify(r5pos));
  check('R5b. leave does NOT cross into PUBLIC', !r5leak, 'leaked=' + r5leak);

  // R6 score gate: a private-room {t:score} is silently dropped — no {t:scores}
  // reply to the scorer, no MISSION announce to anyone. (PUBLIC score checks in
  // runAssertions remain the positive control.)
  const r6b = B_.msgs.length, r6c = C_.msgs.length;
  send(B_, { t: 'score', m: 5, ms: 120000 });
  await sleep(400);
  const r6reply = B_.msgs.slice(r6b).some((m) => m.t === 'scores');
  const r6announceB = B_.msgs.slice(r6b).some((m) => m.t === 'chat' && m.n === '* MISSION');
  const r6announceC = C_.msgs.slice(r6c).some((m) => m.t === 'chat' && m.n === '* MISSION');
  check('R6a. private-room score gets no {t:scores} reply', !r6reply, 'reply=' + r6reply);
  check('R6b. private-room score fires no MISSION announce', !r6announceB && !r6announceC, `B=${r6announceB} C=${r6announceC}`);

  // R7 sanitization equivalence: 'rose' and 'ROSE!!' both sanitize to ROSE and
  // land together (G1's state reaches G2).
  const G1 = connect('?room=rose');   await opened(G1); const g1 = (await expect(G1, (m) => m.t === 'welcome')).id;
  const G2 = connect('?room=ROSE!!'); await opened(G2); await expect(G2, (m) => m.t === 'welcome');
  const r7g2 = G2.msgs.length;
  st(G1, 0, 14, 1, -9.5, 'GEEONE');
  const r7 = await want(G2, isState(g1), { from: r7g2 });
  check('R7. room-code sanitization equivalence (rose === ROSE!!)', !!r7, JSON.stringify(r7));
  G1.ws.close(); G2.ws.close();

  // R8 NPC forced PUBLIC: ?npc=<token>&room=DERBY ignores the room — a PUBLIC
  // client sees its state, a DERBY client does not.
  const N = connect('?npc=' + NPC_TOKEN + '&room=DERBY'); await opened(N); const nId = (await expect(N, (m) => m.t === 'welcome')).id;
  const P3 = connect(); await opened(P3); await expect(P3, (m) => m.t === 'welcome');
  const r8p3 = P3.msgs.length, r8b = B_.msgs.length;
  st(N, 0, 14, 1, -9.5, 'NPCBOT');
  const r8pos = await want(P3, isState(nId), { from: r8p3 });
  await sleep(300);
  const r8leak = B_.msgs.slice(r8b).some(isState(nId));
  check('R8a. NPC token forces PUBLIC despite ?room (PUBLIC sees it)', !!r8pos, JSON.stringify(r8pos));
  check('R8b. NPC ?room=DERBY does NOT reach the DERBY room', !r8leak, 'leaked=' + r8leak);
  N.ws.close(); P3.ws.close();

  // R9 (optional): admin /list carries a room column. Soft — the contract lists
  // this as optional, so a miss SKIPs rather than failing the suite.
  const ADM = connect(); await opened(ADM); await expect(ADM, (m) => m.t === 'welcome');
  send(ADM, { t: 'chat', msg: '/admin ' + ADMIN_TOKEN });
  await want(ADM, (m) => m.t === 'sys' && /admin: granted/.test(m.msg || ''));
  send(ADM, { t: 'chat', msg: '/list' });
  const listMsg = await want(ADM, (m) => m.t === 'sys' && /online:/.test(m.msg || ''));
  softCheck('R9. admin /list includes a room column', !!listMsg && /derby/i.test(listMsg.msg || ''),
    listMsg ? listMsg.msg : 'no /list response');
  ADM.ws.close();

  B_.ws.close(); C_.ws.close(); HA.ws.close();
}

// --- mev beacon: fire-and-forget telemetry ping (task #44) -------------------
// {t:'mev', k:<int 0-99>} is validated + rate-limited (8/s) and logged server-
// side ONLY — no broadcast, no reply, and invalid/over-limit k is silently
// ignored. Since there's nothing to observe on success, every check verifies by
// ABSENCE (a second client sees no traffic) plus LIVENESS (the sender can still
// chat and receive relays afterward — proving the server didn't crash and the
// sender wasn't disconnected). A crash (process.exit on uncaughtException) or a
// dropped connection would make the follow-up chat relay fail.
async function runMevAssertions() {
  const want = async (c, pred, opts) => {
    try { return await expect(c, pred, { timeout: 1500, ...(opts || {}) }); }
    catch { return null; }
  };
  const MA = connect(); await opened(MA); const MAID = (await expect(MA, (m) => m.t === 'welcome')).id;
  const MB = connect(); await opened(MB); await expect(MB, (m) => m.t === 'welcome');
  // MA fixes a spawn so it's a fully in-world player; not required for the mev
  // path but keeps the sender realistic.
  send(MA, { t: 'state', n: 'MEVMAN', c: 0x3a76c4, m: 0, p: 0, x: 14, y: 1, z: -9.5, ry: 0 });
  await sleep(140);

  // M1: one valid beacon → no broadcast to the second client, sender still live.
  const m1mark = MB.msgs.length;
  send(MA, { t: 'mev', k: 10 });
  await sleep(300);
  const m1quiet = MB.msgs.slice(m1mark).length === 0;
  check('M1a. valid mev beacon produces no broadcast to a second client', m1quiet, 'got=' + JSON.stringify(MB.msgs.slice(m1mark)));
  send(MA, { t: 'chat', msg: 'still here' });
  const m1chat = await want(MB, (m) => m.t === 'chat' && m.id === MAID && m.msg === 'still here');
  check('M1b. sender still relays after mev (not disconnected, server up)', !!m1chat, JSON.stringify(m1chat));

  // M2: burst 12 beacons in <1s (over the 8/s cap) → no crash/leak; relay works.
  const m2mark = MB.msgs.length;
  for (let i = 0; i < 12; i++) send(MA, { t: 'mev', k: 11 });
  await sleep(300);
  const m2quiet = MB.msgs.slice(m2mark).length === 0;
  send(MA, { t: 'chat', msg: 'post-burst' });
  const m2chat = await want(MB, (m) => m.t === 'chat' && m.id === MAID && m.msg === 'post-burst');
  check('M2. mev rate-limit burst does not crash or leak; relay still works', m2quiet && !!m2chat,
    `quiet=${m2quiet} chat=${JSON.stringify(m2chat)}`);

  // M3: malformed beacons (bad type, out-of-range, negative, missing k) ignored.
  const m3mark = MB.msgs.length;
  send(MA, { t: 'mev', k: 'x' });
  send(MA, { t: 'mev', k: 999 });
  send(MA, { t: 'mev', k: -1 });
  send(MA, { t: 'mev' });
  await sleep(300);
  const m3quiet = MB.msgs.slice(m3mark).length === 0;
  send(MA, { t: 'chat', msg: 'post-malformed' });
  const m3chat = await want(MB, (m) => m.t === 'chat' && m.id === MAID && m.msg === 'post-malformed');
  check('M3. malformed mev is silently ignored; no crash, relay still works', m3quiet && !!m3chat,
    `quiet=${m3quiet} chat=${JSON.stringify(m3chat)}`);

  MA.ws.close(); MB.ws.close();
}

// --- m8 leaderboard: the "settled the foals" board (task #49) -----------------
// Verifies the new board wired through the score handler end-to-end. Each score
// costs the submitter a 15s cooldown, so every submission uses its own client.
// Distinctive names + distinct ms values make each entry identifiable in the
// top-10 {t:'scores'} snapshot. Notable JS trap under test (B3): the board map
// { ..., 8:'m8' }[msg.m] is an object lookup, so BOTH numeric 8 and the string
// '8' coerce to the same key and land on m8 — while the string 'm8' would MISS
// the map and fall through to 'm1'. B3a guards that numeric m:8 doesn't leak to
// the ribbon board; B3b documents (soft) where the string '8' actually lands.
async function runM8Assertions() {
  const want = async (c, pred, opts) => {
    try { return await expect(c, pred, { timeout: 1500, ...(opts || {}) }); }
    catch { return null; }
  };
  const named = async (query, name) => {   // fresh client with a fixed name + spawn
    const c = connect(query); await opened(c); await expect(c, (m) => m.t === 'welcome');
    send(c, { t: 'state', n: name, c: 0x3a76c4, m: 0, p: 0, x: 14, y: 1, z: -9.5, ry: 0 });
    await sleep(140);
    return c;
  };
  const OBS = connect(); await opened(OBS); await expect(OBS, (m) => m.t === 'welcome');

  // B1: valid PUBLIC m8 score -> lands on .m8 in the reply + fires the announce.
  const S1 = await named('', 'FOALGUY');
  const obsB1 = OBS.msgs.length;
  send(S1, { t: 'score', m: 8, ms: 120000 });
  const rep1 = await want(S1, (m) => m.t === 'scores');
  const ann1 = await want(OBS, (m) => m.t === 'chat' && m.n === '* MISSION', { from: obsB1 });
  const b1m8 = !!(rep1 && (rep1.m8 || []).some((e) => e.n === 'FOALGUY' && e.ms === 120000));
  const b1announce = !!(ann1 && /foal/i.test(ann1.msg || ''));
  check('B1a. valid m8 score lands on the m8 board (topScores includes m8)', b1m8, 'm8=' + JSON.stringify(rep1 && rep1.m8));
  check('B1b. m8 score fires the mission announce to a second client (matches "foal")', b1announce, 'announce=' + JSON.stringify(ann1));

  // B3a: numeric m:8 must NOT leak onto the m1 ribbon board (reuse S1's reply).
  const b3aLeak = !!(rep1 && (rep1.m1 || []).some((e) => e.n === 'FOALGUY' && e.ms === 120000));
  check('B3a. numeric m:8 does NOT leak onto the m1 ribbon board', !b3aLeak, 'm1=' + JSON.stringify(rep1 && rep1.m1));

  // B2: below-floor m8 score (5s < 15s floor) -> no reply, no announce, no entry.
  const S2 = await named('', 'LOWBALL');
  const obsB2 = OBS.msgs.length, s2mark = S2.msgs.length;
  send(S2, { t: 'score', m: 8, ms: 5000 });
  await sleep(400);
  const s2reply = S2.msgs.slice(s2mark).some((m) => m.t === 'scores');
  const s2announce = OBS.msgs.slice(obsB2).some((m) => m.t === 'chat' && m.n === '* MISSION');
  send(OBS, { t: 'scores' });
  const req2 = await want(OBS, (m) => m.t === 'scores');
  const s2onBoard = !!(req2 && (req2.m8 || []).some((e) => e.ms === 5000));
  check('B2. below-floor m8 score rejected (no reply, no announce, no board entry)',
    !s2reply && !s2announce && !s2onBoard, `reply=${s2reply} announce=${s2announce} onBoard=${s2onBoard}`);

  // B3b (soft): string m:'8' coerces to the m8 key in JS object lookup, so it
  // should land on m8 too. Document the real behavior; don't fail the suite.
  const S3 = await named('', 'STRINGY');
  const s3mark = S3.msgs.length;
  send(S3, { t: 'score', m: '8', ms: 130000 });
  const rep3 = await want(S3, (m) => m.t === 'scores', { from: s3mark });
  const s3OnM8 = !!(rep3 && (rep3.m8 || []).some((e) => e.ms === 130000));
  const s3OnM1 = !!(rep3 && (rep3.m1 || []).some((e) => e.ms === 130000));
  softCheck("B3b. string m:'8' coerces onto the m8 board (JS object-key coercion)", s3OnM8,
    `gotReply=${!!rep3} onM8=${s3OnM8} onM1=${s3OnM1}`);

  // B4: an m8 score from a private room is dropped (F4 gate composes with m8).
  const S4 = await named('?room=DERBY', 'DERBYFOAL');
  const obsB4 = OBS.msgs.length, s4mark = S4.msgs.length;
  send(S4, { t: 'score', m: 8, ms: 125000 });
  await sleep(400);
  const s4reply = S4.msgs.slice(s4mark).some((m) => m.t === 'scores');
  const s4announce = OBS.msgs.slice(obsB4).some((m) => m.t === 'chat' && m.n === '* MISSION');
  check('B4. m8 score from a private room is dropped (no reply, no announce)', !s4reply && !s4announce,
    `reply=${s4reply} announce=${s4announce}`);

  S1.ws.close(); S2.ws.close(); S3.ws.close(); S4.ws.close(); OBS.ws.close();
}

// --- m9 leaderboard: the "flew the airmail route" board (task #50) ------------
// Same end-to-end wiring as m8, one board over: numeric m:9 lands on .m9 + fires
// the announce; a below-floor time (< the 25s m9 floor) is rejected; numeric m:9
// must NOT leak to the m1 ribbon board; a private-room score is dropped. Each
// submission uses a fresh client (the 1-per-15s cooldown is per-client).
async function runM9Assertions() {
  const want = async (c, pred, opts) => {
    try { return await expect(c, pred, { timeout: 1500, ...(opts || {}) }); }
    catch { return null; }
  };
  const named = async (query, name) => {   // fresh client with a fixed name + spawn
    const c = connect(query); await opened(c); await expect(c, (m) => m.t === 'welcome');
    send(c, { t: 'state', n: name, c: 0x3a76c4, m: 0, p: 0, x: 14, y: 1, z: -9.5, ry: 0 });
    await sleep(140);
    return c;
  };
  const OBS = connect(); await opened(OBS); await expect(OBS, (m) => m.t === 'welcome');

  // C1: valid PUBLIC m9 score -> lands on .m9 in the reply + fires the announce.
  const S1 = await named('', 'FLYGUY');
  const obsC1 = OBS.msgs.length;
  send(S1, { t: 'score', m: 9, ms: 120000 });
  const rep1 = await want(S1, (m) => m.t === 'scores');
  const ann1 = await want(OBS, (m) => m.t === 'chat' && m.n === '* MISSION', { from: obsC1 });
  const c1m9 = !!(rep1 && (rep1.m9 || []).some((e) => e.n === 'FLYGUY' && e.ms === 120000));
  const c1announce = !!(ann1 && /airmail/i.test(ann1.msg || ''));
  check('C1a. valid m9 score lands on the m9 board (topScores includes m9)', c1m9, 'm9=' + JSON.stringify(rep1 && rep1.m9));
  check('C1b. m9 score fires the mission announce to a second client (matches "airmail")', c1announce, 'announce=' + JSON.stringify(ann1));

  // C1c: numeric m:9 must NOT leak onto the m1 ribbon board (reuse S1's reply).
  const c1Leak = !!(rep1 && (rep1.m1 || []).some((e) => e.n === 'FLYGUY' && e.ms === 120000));
  check('C1c. numeric m:9 does NOT leak onto the m1 ribbon board', !c1Leak, 'm1=' + JSON.stringify(rep1 && rep1.m1));

  // C2: below-floor m9 score (10s < 25s floor) -> no reply, no announce, no entry.
  const S2 = await named('', 'LOWFLYER');
  const obsC2 = OBS.msgs.length, s2mark = S2.msgs.length;
  send(S2, { t: 'score', m: 9, ms: 10000 });
  await sleep(400);
  const s2reply = S2.msgs.slice(s2mark).some((m) => m.t === 'scores');
  const s2announce = OBS.msgs.slice(obsC2).some((m) => m.t === 'chat' && m.n === '* MISSION');
  send(OBS, { t: 'scores' });
  const req2 = await want(OBS, (m) => m.t === 'scores');
  const s2onBoard = !!(req2 && (req2.m9 || []).some((e) => e.ms === 10000));
  check('C2. below-floor m9 score rejected (no reply, no announce, no board entry)',
    !s2reply && !s2announce && !s2onBoard, `reply=${s2reply} announce=${s2announce} onBoard=${s2onBoard}`);

  // C3: an m9 score from a private room is dropped (F4 gate composes with m9).
  const S3 = await named('?room=ROOFTOP', 'ROOMFLYER');
  const obsC3 = OBS.msgs.length, s3mark = S3.msgs.length;
  send(S3, { t: 'score', m: 9, ms: 125000 });
  await sleep(400);
  const s3reply = S3.msgs.slice(s3mark).some((m) => m.t === 'scores');
  const s3announce = OBS.msgs.slice(obsC3).some((m) => m.t === 'chat' && m.n === '* MISSION');
  check('C3. m9 score from a private room is dropped (no reply, no announce)', !s3reply && !s3announce,
    `reply=${s3reply} announce=${s3announce}`);

  S1.ws.close(); S2.ws.close(); S3.ws.close(); OBS.ws.close();
}

// --- HIGH WATER: the m10 board (mission 10, wire m:11) -----------------------
// Mission 10 ships as board key 'm10' on wire number 11 — deliberately NOT 10,
// which stays DAILY DASH ('d'). THE regression is the 11-vs-10 trap: a valid
// m:11 run must land on .m10 ONLY, never the daily 'd' board nor m1 (the object-
// map fall-through). WIN m10 = [25000, 300000]; announce is "held back the
// flood". Mirrors runM8/runM9Assertions; each submitter is its own client (the
// 1-per-15s score cooldown is per-client). The mev-band check confirms the new
// mission's beacon k values (already inside the 0-99 validator) still no-op —
// asserting current behavior, since #58 shipped no mev change.
async function runM10Assertions() {
  const want = async (c, pred, opts) => {
    try { return await expect(c, pred, { timeout: 1500, ...(opts || {}) }); }
    catch { return null; }
  };
  const named = async (query, name) => {   // fresh client with a fixed name + spawn
    const c = connect(query); await opened(c); await expect(c, (m) => m.t === 'welcome');
    send(c, { t: 'state', n: name, c: 0x3a76c4, m: 0, p: 0, x: 14, y: 1, z: -9.5, ry: 0 });
    await sleep(140);
    return c;
  };
  const OBS = connect(); await opened(OBS); await expect(OBS, (m) => m.t === 'welcome');

  // H1: valid PUBLIC m:11 -> lands on .m10 + fires the "held back the flood" announce.
  const S1 = await named('', 'FLOODGUY');
  const obsH1 = OBS.msgs.length;
  send(S1, { t: 'score', m: 11, ms: 120000 });
  const rep1 = await want(S1, (m) => m.t === 'scores');
  const ann1 = await want(OBS, (m) => m.t === 'chat' && m.n === '* MISSION', { from: obsH1 });
  const onM10 = !!(rep1 && (rep1.m10 || []).some((e) => e.n === 'FLOODGUY' && e.ms === 120000));
  const onD = !!(rep1 && (rep1.d || []).some((e) => e.n === 'FLOODGUY' && e.ms === 120000));
  const onM1 = !!(rep1 && (rep1.m1 || []).some((e) => e.n === 'FLOODGUY' && e.ms === 120000));
  const h1announce = !!(ann1 && /flood/i.test(ann1.msg || ''));
  check('H1a. valid m:11 score lands on the m10 board (topScores includes m10)', onM10, 'm10=' + JSON.stringify(rep1 && rep1.m10));
  check('H1b. m:11 score fires the mission announce to a second client (matches "flood")', h1announce, 'announce=' + JSON.stringify(ann1));
  // THE 11-vs-10 regression: the run is on m10 ONLY — not the daily d board, not m1.
  check('H1c. m:11 lands on m10 ONLY — not the daily d board (10 trap) nor the m1 ribbon board',
    onM10 && !onD && !onM1, `onM10=${onM10} onD=${onD} onM1=${onM1}`);

  // H2: below-window m:11 (1s < 25s floor) -> no reply, no announce, no entry.
  const S2 = await named('', 'PUDDLE');
  const obsH2 = OBS.msgs.length, s2mark = S2.msgs.length;
  send(S2, { t: 'score', m: 11, ms: 1000 });
  await sleep(400);
  const s2reply = S2.msgs.slice(s2mark).some((m) => m.t === 'scores');
  const s2announce = OBS.msgs.slice(obsH2).some((m) => m.t === 'chat' && m.n === '* MISSION');
  send(OBS, { t: 'scores' });
  const req2 = await want(OBS, (m) => m.t === 'scores');
  const s2onBoard = !!(req2 && (req2.m10 || []).some((e) => e.ms === 1000));
  check('H2. below-window m:11 score rejected (no reply, no announce, no board entry)',
    !s2reply && !s2announce && !s2onBoard, `reply=${s2reply} announce=${s2announce} onBoard=${s2onBoard}`);

  // H3: mission-10 mev band — {t:'mev', k:50}/{k:54} are inside the existing 0-99
  // validator, so they no-op (log-only, no rebroadcast) and never disconnect the
  // sender. Asserting current behavior (#58 shipped no mev change).
  const MB = await named('', 'BEACONER');
  const obsH3 = OBS.msgs.length;
  send(MB, { t: 'mev', k: 50 });
  send(MB, { t: 'mev', k: 54 });
  await sleep(300);
  const h3quiet = OBS.msgs.slice(obsH3).length === 0;
  send(MB, { t: 'chat', msg: 'beacon ok' });
  const h3live = await want(OBS, (m) => m.t === 'chat' && m.n === 'BEACONER' && m.msg === 'beacon ok');
  check('H3. mev band k:50/k:54 accepted quietly (no rebroadcast, sender stays live)',
    h3quiet && !!h3live, `quiet=${h3quiet} live=${JSON.stringify(h3live)}`);

  // H4: an m:11 score from a private room is dropped (F4 gate composes with m10).
  const S4 = await named('?room=LEVEE', 'ROOMFLOOD');
  const obsH4 = OBS.msgs.length, s4mark = S4.msgs.length;
  send(S4, { t: 'score', m: 11, ms: 125000 });
  await sleep(400);
  const s4reply = S4.msgs.slice(s4mark).some((m) => m.t === 'scores');
  const s4announce = OBS.msgs.slice(obsH4).some((m) => m.t === 'chat' && m.n === '* MISSION');
  check('H4. m:11 score from a private room is dropped (no reply, no announce)', !s4reply && !s4announce,
    `reply=${s4reply} announce=${s4announce}`);

  S1.ws.close(); S2.ws.close(); MB.ws.close(); S4.ws.close(); OBS.ws.close();
}

// --- VP MOTORCADE: the m11 board (mission 11, wire m:12) ----------------------
// Mission 11 ships as board key 'm11' on wire number 12. THE regression is the
// full 12-vs-11-vs-10 ladder: a valid m:12 run must land on .m11 ONLY — never
// .m10 (that's wire 11), never the daily 'd' (wire 10), never m1 (the object-map
// fall-through). WIN m11 = [25000, 300000]; announce is "ran the motorcade to
// the tee". Clones runM10Assertions exactly; each submitter is its own client
// (1-per-15s score cooldown). The mev-band check confirms the mission's beacon
// k values stay inside the existing 0-99 validator (no server change).
async function runM11Assertions() {
  const want = async (c, pred, opts) => {
    try { return await expect(c, pred, { timeout: 1500, ...(opts || {}) }); }
    catch { return null; }
  };
  const named = async (query, name) => {   // fresh client with a fixed name + spawn
    const c = connect(query); await opened(c); await expect(c, (m) => m.t === 'welcome');
    send(c, { t: 'state', n: name, c: 0x3a76c4, m: 0, p: 0, x: 14, y: 1, z: -9.5, ry: 0 });
    await sleep(140);
    return c;
  };
  const OBS = connect(); await opened(OBS); await expect(OBS, (m) => m.t === 'welcome');

  // V1: valid PUBLIC m:12 -> lands on .m11 + fires the "ran the motorcade to the tee" announce.
  const S1 = await named('', 'CADDIE');
  const obsV1 = OBS.msgs.length;
  send(S1, { t: 'score', m: 12, ms: 120000 });
  const rep1 = await want(S1, (m) => m.t === 'scores');
  const ann1 = await want(OBS, (m) => m.t === 'chat' && m.n === '* MISSION', { from: obsV1 });
  const onM11 = !!(rep1 && (rep1.m11 || []).some((e) => e.n === 'CADDIE' && e.ms === 120000));
  const onM10 = !!(rep1 && (rep1.m10 || []).some((e) => e.n === 'CADDIE' && e.ms === 120000));
  const onD = !!(rep1 && (rep1.d || []).some((e) => e.n === 'CADDIE' && e.ms === 120000));
  const onM1 = !!(rep1 && (rep1.m1 || []).some((e) => e.n === 'CADDIE' && e.ms === 120000));
  const v1announce = !!(ann1 && /motorcade/i.test(ann1.msg || ''));
  check('V1a. valid m:12 score lands on the m11 board (topScores includes m11)', onM11, 'm11=' + JSON.stringify(rep1 && rep1.m11));
  check('V1b. m:12 score fires the mission announce to a second client (matches "motorcade")', v1announce, 'announce=' + JSON.stringify(ann1));
  // THE 12-vs-11-vs-10 ladder regression: the run is on m11 ONLY.
  check('V1c. m:12 lands on m11 ONLY — not m10 (wire 11), not the daily d board (wire 10), not m1',
    onM11 && !onM10 && !onD && !onM1, `onM11=${onM11} onM10=${onM10} onD=${onD} onM1=${onM1}`);

  // V2: below-window m:12 (1s < 25s floor) -> no reply, no announce, no entry.
  const S2 = await named('', 'SLOWCART');
  const obsV2 = OBS.msgs.length, s2mark = S2.msgs.length;
  send(S2, { t: 'score', m: 12, ms: 1000 });
  await sleep(400);
  const s2reply = S2.msgs.slice(s2mark).some((m) => m.t === 'scores');
  const s2announce = OBS.msgs.slice(obsV2).some((m) => m.t === 'chat' && m.n === '* MISSION');
  send(OBS, { t: 'scores' });
  const req2 = await want(OBS, (m) => m.t === 'scores');
  const s2onBoard = !!(req2 && (req2.m11 || []).some((e) => e.ms === 1000));
  check('V2. below-window m:12 score rejected (no reply, no announce, no board entry)',
    !s2reply && !s2announce && !s2onBoard, `reply=${s2reply} announce=${s2announce} onBoard=${s2onBoard}`);

  // V3: mission-11 mev band — {t:'mev', k:70}/{k:74} inside the existing 0-99
  // validator, so they no-op (log-only, no rebroadcast) and never disconnect.
  const MB = await named('', 'BEACONTWO');
  const obsV3 = OBS.msgs.length;
  send(MB, { t: 'mev', k: 70 });
  send(MB, { t: 'mev', k: 74 });
  await sleep(300);
  const v3quiet = OBS.msgs.slice(obsV3).length === 0;
  send(MB, { t: 'chat', msg: 'beacon2 ok' });
  const v3live = await want(OBS, (m) => m.t === 'chat' && m.n === 'BEACONTWO' && m.msg === 'beacon2 ok');
  check('V3. mev band k:70/k:74 accepted quietly (no rebroadcast, sender stays live)',
    v3quiet && !!v3live, `quiet=${v3quiet} live=${JSON.stringify(v3live)}`);

  // V4: an m:12 score from a private room is dropped (F4 gate composes with m11).
  const S4 = await named('?room=FAIRWAY', 'VALETDROP');
  const obsV4 = OBS.msgs.length, s4mark = S4.msgs.length;
  send(S4, { t: 'score', m: 12, ms: 125000 });
  await sleep(400);
  const s4reply = S4.msgs.slice(s4mark).some((m) => m.t === 'scores');
  const s4announce = OBS.msgs.slice(obsV4).some((m) => m.t === 'chat' && m.n === '* MISSION');
  check('V4. m:12 score from a private room is dropped (no reply, no announce)', !s4reply && !s4announce,
    `reply=${s4reply} announce=${s4announce}`);

  S1.ws.close(); S2.ws.close(); MB.ws.close(); S4.ws.close(); OBS.ws.close();
}

// --- THE THRILLER: the m12 board (mission 12, wire m:13) ----------------------
// Mission 12 ships as board key 'm12' on wire number 13 — the last board of the
// run, so the wire ladder reads 2..13 complete. THE regression is the full
// 13-vs-12-vs-11-vs-10 ladder: a valid m:13 run must land on .m12 ONLY — never
// .m11 (wire 12), never .m10 (wire 11), never the daily 'd' (wire 10), never m1
// (the object-map fall-through). WIN m12 = [30000, 900000] — the floor was
// lowered from 60s after QA's spawn-stagger math showed a hot legit clear lands
// 40-70s; T2b guards that exact boundary. Announce is "cleared THE THRILLER and
// saved City Hall". Clones runM11Assertions exactly; each
// submitter is its own client (1-per-15s score cooldown). The mev-band check
// confirms the mission's beacon k values stay inside the existing 0-99 validator.
async function runM12Assertions() {
  const want = async (c, pred, opts) => {
    try { return await expect(c, pred, { timeout: 1500, ...(opts || {}) }); }
    catch { return null; }
  };
  const named = async (query, name) => {   // fresh client with a fixed name + spawn
    const c = connect(query); await opened(c); await expect(c, (m) => m.t === 'welcome');
    send(c, { t: 'state', n: name, c: 0x3a76c4, m: 0, p: 0, x: 14, y: 1, z: -9.5, ry: 0 });
    await sleep(140);
    return c;
  };
  const OBS = connect(); await opened(OBS); await expect(OBS, (m) => m.t === 'welcome');

  // T1: valid PUBLIC m:13 -> lands on .m12 + fires the "cleared THE THRILLER..." announce.
  const S1 = await named('', 'ZOMBIE');
  const obsT1 = OBS.msgs.length;
  send(S1, { t: 'score', m: 13, ms: 180000 });
  const rep1 = await want(S1, (m) => m.t === 'scores');
  const ann1 = await want(OBS, (m) => m.t === 'chat' && m.n === '* MISSION', { from: obsT1 });
  const onM12 = !!(rep1 && (rep1.m12 || []).some((e) => e.n === 'ZOMBIE' && e.ms === 180000));
  const onM11 = !!(rep1 && (rep1.m11 || []).some((e) => e.n === 'ZOMBIE' && e.ms === 180000));
  const onM10 = !!(rep1 && (rep1.m10 || []).some((e) => e.n === 'ZOMBIE' && e.ms === 180000));
  const onD = !!(rep1 && (rep1.d || []).some((e) => e.n === 'ZOMBIE' && e.ms === 180000));
  const onM1 = !!(rep1 && (rep1.m1 || []).some((e) => e.n === 'ZOMBIE' && e.ms === 180000));
  const t1announce = !!(ann1 && /thriller/i.test(ann1.msg || ''));
  check('T1a. valid m:13 score lands on the m12 board (topScores includes m12)', onM12, 'm12=' + JSON.stringify(rep1 && rep1.m12));
  check('T1b. m:13 score fires the mission announce to a second client (matches "thriller")', t1announce, 'announce=' + JSON.stringify(ann1));
  // THE 13-vs-12-vs-11-vs-10 ladder regression: the run is on m12 ONLY.
  check('T1c. m:13 lands on m12 ONLY — not m11 (wire 12), not m10 (wire 11), not the daily d (wire 10), not m1',
    onM12 && !onM11 && !onM10 && !onD && !onM1, `onM12=${onM12} onM11=${onM11} onM10=${onM10} onD=${onD} onM1=${onM1}`);

  // T2: below-window m:13 (1s < 30s floor) -> no reply, no announce, no entry.
  const S2 = await named('', 'SLOWPOKE');
  const obsT2 = OBS.msgs.length, s2mark = S2.msgs.length;
  send(S2, { t: 'score', m: 13, ms: 1000 });
  await sleep(400);
  const s2reply = S2.msgs.slice(s2mark).some((m) => m.t === 'scores');
  const s2announce = OBS.msgs.slice(obsT2).some((m) => m.t === 'chat' && m.n === '* MISSION');
  send(OBS, { t: 'scores' });
  const req2 = await want(OBS, (m) => m.t === 'scores');
  const s2onBoard = !!(req2 && (req2.m12 || []).some((e) => e.ms === 1000));
  check('T2. below-window m:13 score rejected (no reply, no announce, no board entry)',
    !s2reply && !s2announce && !s2onBoard, `reply=${s2reply} announce=${s2announce} onBoard=${s2onBoard}`);

  // T2b: the floor is 30s, NOT the original 60s. QA's spawn-stagger math put an
  // optimized legit clear at 40-70s, so a 45s run MUST rank — under the old 60s
  // floor this exact submit was silently rejected. Regression guard for the
  // [30000, 900000] window; if someone reverts the floor, this check goes red.
  const S2B = await named('', 'SPEEDRUN');
  send(S2B, { t: 'score', m: 13, ms: 45000 });
  const rep2b = await want(S2B, (m) => m.t === 'scores');
  const t2bOn = !!(rep2b && (rep2b.m12 || []).some((e) => e.n === 'SPEEDRUN' && e.ms === 45000));
  check('T2b. 45s m:13 clear ACCEPTED and ranks (floor is 30s, not the original 60s)',
    t2bOn, 'm12=' + JSON.stringify(rep2b && rep2b.m12));
  S2B.ws.close();

  // T3: mission-12 mev band — {t:'mev', k:80}/{k:84} inside the existing 0-99
  // validator, so they no-op (log-only, no rebroadcast) and never disconnect.
  const MB = await named('', 'BEACONTRI');
  const obsT3 = OBS.msgs.length;
  send(MB, { t: 'mev', k: 80 });
  send(MB, { t: 'mev', k: 84 });
  await sleep(300);
  const t3quiet = OBS.msgs.slice(obsT3).length === 0;
  send(MB, { t: 'chat', msg: 'beacon3 ok' });
  const t3live = await want(OBS, (m) => m.t === 'chat' && m.n === 'BEACONTRI' && m.msg === 'beacon3 ok');
  check('T3. mev band k:80/k:84 accepted quietly (no rebroadcast, sender stays live)',
    t3quiet && !!t3live, `quiet=${t3quiet} live=${JSON.stringify(t3live)}`);

  // T4: an m:13 score from a private room is dropped (F4 gate composes with m12).
  const S4 = await named('?room=CRYPT', 'CRYPTROOM');
  const obsT4 = OBS.msgs.length, s4mark = S4.msgs.length;
  send(S4, { t: 'score', m: 13, ms: 185000 });
  await sleep(400);
  const s4reply = S4.msgs.slice(s4mark).some((m) => m.t === 'scores');
  const s4announce = OBS.msgs.slice(obsT4).some((m) => m.t === 'chat' && m.n === '* MISSION');
  check('T4. m:13 score from a private room is dropped (no reply, no announce)', !s4reply && !s4announce,
    `reply=${s4reply} announce=${s4announce}`);

  S1.ws.close(); S2.ws.close(); MB.ws.close(); S4.ws.close(); OBS.ws.close();
}

// --- DAILY DASH: the m:10 daily board (F2) -----------------------------------
// The daily board `d` is the mission-board wiring one notch over (score-handler
// map 10:'d', WIN [20000,900000], DAILY DASH announce) plus two twists topScores
// carries a `dDay` stamp (which dayIndex() the board holds), and rollDaily()
// empties the board when the EST day flips. D1-D3 run against the shared server;
// D4 needs its OWN throwaway server because the shared board is already today's
// (runAssertions rolled it), so the flip can only be observed on a fresh boot
// that loads a stale scores.json. Each submitter is a fresh client (the 1-per-15s
// score cooldown is per-client). scores.json is restored in main()'s finally.
async function runDailyAssertions() {
  const want = async (c, pred, opts) => {
    try { return await expect(c, pred, { timeout: 1500, ...(opts || {}) }); }
    catch { return null; }
  };
  const named = async (query, name) => {   // fresh client with a fixed name + spawn
    const c = connect(query); await opened(c); await expect(c, (m) => m.t === 'welcome');
    send(c, { t: 'state', n: name, c: 0x3a76c4, m: 0, p: 0, x: 14, y: 1, z: -9.5, ry: 0 });
    await sleep(140);
    return c;
  };
  const OBS = connect(); await opened(OBS); await expect(OBS, (m) => m.t === 'welcome');

  // D1: valid PUBLIC m:10 score (60s in [20s,900s]) -> lands on the .d board,
  // fires the DAILY DASH announce, and the {t:scores} reply carries the d list +
  // dDay === today's dayIndex().
  const S1 = await named('', 'DASHER');
  const obsD1 = OBS.msgs.length;
  send(S1, { t: 'score', m: 10, ms: 60000 });
  const rep1 = await want(S1, (m) => m.t === 'scores');
  const ann1 = await want(OBS, (m) => m.t === 'chat' && m.n === '* MISSION', { from: obsD1 });
  const d1land = !!(rep1 && (rep1.d || []).some((e) => e.n === 'DASHER' && e.ms === 60000));
  const d1day = !!(rep1 && rep1.dDay === dayIndex());
  const d1ann = !!(ann1 && /DAILY DASH/i.test(ann1.msg || ''));
  check('D1. valid m:10 lands on the d board (topScores includes d + dDay===today) and announces',
    d1land && d1day && d1ann, `land=${d1land} dDay=${rep1 && rep1.dDay} today=${dayIndex()} ann=${d1ann}`);

  // D2: below-window m:10 score (19s < 20s floor) -> rejected before the board
  // (no {t:scores} reply, no entry on a re-queried board).
  const S2 = await named('', 'SLOWPOKE');
  const s2mark = S2.msgs.length;
  send(S2, { t: 'score', m: 10, ms: 19000 });
  await sleep(400);
  const s2reply = S2.msgs.slice(s2mark).some((m) => m.t === 'scores');
  send(OBS, { t: 'scores' });
  const req2 = await want(OBS, (m) => m.t === 'scores');
  const s2onBoard = !!(req2 && (req2.d || []).some((e) => e.ms === 19000));
  check('D2. below-window m:10 score rejected (no reply, board unchanged)',
    !s2reply && !s2onBoard, `reply=${s2reply} onBoard=${s2onBoard}`);

  // D3: an m:10 score from a private room is dropped (the private-room gate sits
  // before the board map, so it covers m:10 like every other board). Mirrors C3.
  const S3 = await named('?room=DASHRM', 'ROOMDASH');
  const obsD3 = OBS.msgs.length, s3mark = S3.msgs.length;
  send(S3, { t: 'score', m: 10, ms: 61000 });
  await sleep(400);
  const s3reply = S3.msgs.slice(s3mark).some((m) => m.t === 'scores');
  const s3announce = OBS.msgs.slice(obsD3).some((m) => m.t === 'chat' && m.n === '* MISSION');
  check('D3. m:10 score from a private room is dropped (no reply, no announce)', !s3reply && !s3announce,
    `reply=${s3reply} announce=${s3announce}`);

  S1.ws.close(); S2.ws.close(); S3.ws.close(); OBS.ws.close();
}

// --- DAILY DASH day roll (D4) ------------------------------------------------
// rollDaily() empties the d board when scores.dDay drifts off dayIndex(). The
// shared server already rolled to today, so we seed scores.json with a STALE
// dDay (yesterday) + a phantom entry, boot a throwaway server on its OWN port
// that loads that file, submit one valid m:10, and assert the stale entry is gone
// (board reset FIRST) while the fresh one is present with dDay advanced to today.
// The shared server stays idle during this (D4 is last), so it never re-saves
// over the seed; main()'s finally restores scores.json byte-for-byte regardless.
async function runDailyRollAssertion() {
  const D4PORT = PORT + 1;
  const D4WS = `ws://127.0.0.1:${D4PORT}`;
  const stale = { d: [{ n: 'YESTERDAY', ms: 50000, ts: new Date().toISOString() }], dDay: dayIndex() - 1 };
  fs.writeFileSync(SCORES, JSON.stringify(stale, null, 2));
  let child2 = null;
  try {
    child2 = await bootServer(D4PORT);
    const S = connect('', D4WS); await opened(S); await expect(S, (m) => m.t === 'welcome');
    send(S, { t: 'state', n: 'ROLLER', c: 0x3a76c4, m: 0, p: 0, x: 14, y: 1, z: -9.5, ry: 0 });
    await sleep(140);
    send(S, { t: 'score', m: 10, ms: 60000 });
    const rep = await expect(S, (m) => m.t === 'scores', { timeout: 2500 });
    const staleGone = !((rep.d || []).some((e) => e.ms === 50000));
    const freshPresent = (rep.d || []).some((e) => e.n === 'ROLLER' && e.ms === 60000);
    const rolledDay = rep.dDay === dayIndex();
    check('D4. day roll: stale board reset before the new score lands (dDay advances to today)',
      staleGone && freshPresent && rolledDay,
      `staleGone=${staleGone} fresh=${freshPresent} dDay=${rep.dDay} today=${dayIndex()}`);
    S.ws.close();
  } catch (e) {
    check('D4. day roll', false, String((e && e.stack) || e));
  } finally {
    if (child2) { try { child2.kill('SIGKILL'); } catch {} }
  }
}

// --- SCOOTER SHARE: the m:5 mode (F3) ----------------------------------------
// CAPS[5] = { h: 13, v: 12 } gives scooter mode a horizontal travel budget that
// comfortably admits the client's 9.5 m/s top speed, AND — because m:5 is now a
// KNOWN mode — the relay preserves m===5 instead of rewriting it to 0 (an unknown
// m coerces to 0, which would make a remote rider render as a plain walker with
// no scooter mesh). S1 rides one client at scooter speed for 15 packets and
// asserts zero `correct` snap-backs; S2 asserts a peer receives the m:5 state with
// the mode preserved (same relay-integrity pattern as E3's m:4 check).
async function runScooterAssertions() {
  const want = async (c, pred, opts) => {
    try { return await expect(c, pred, { timeout: 1500, ...(opts || {}) }); }
    catch { return null; }
  };
  const S = connect(); await opened(S); const SID = (await expect(S, (m) => m.t === 'welcome')).id;
  const P = connect(); await opened(P); await expect(P, (m) => m.t === 'welcome');

  // fix S's spawn with a first m:5 packet (the first packet is uncapped).
  let x = 14; const z = -9.5;
  send(S, { t: 'state', n: 'SCOOTZ', c: 0x3a76c4, m: 5, p: 0, x, y: 1, z, ry: Math.PI / 2 });
  await sleep(140);

  // S1: ride 15 packets at 9.5 m/s (~1.14 m per 120 ms hop, all m:5). A sustained
  // scooter-speed run must never trip a `correct` snap-back — CAPS[5]'s budget
  // admits it, where an absent CAPS entry would leave m:5 an unknown mode.
  const sMark = S.msgs.length;
  const HOP = 9.5 * 0.12;
  for (let i = 0; i < 15; i++) {
    x += HOP;
    send(S, { t: 'state', n: 'SCOOTZ', c: 0x3a76c4, m: 5, p: 0, x, y: 1, z, ry: Math.PI / 2 });
    await sleep(120);
  }
  await sleep(200);
  const corrections = S.msgs.slice(sMark).filter((m) => m.t === 'correct').length;
  check('F13a. m:5 scooter at 9.5 m/s is not move-rejected (CAPS[5] admits it; zero corrections)',
    corrections === 0, 'corrections=' + corrections);

  // S2: a fresh m:5 state relays to peer P with the mode preserved as 5 (an
  // unknown mode would be rewritten to 0 — cf. runAssertions #2 and E3).
  const pMark = P.msgs.length;
  x += HOP;
  send(S, { t: 'state', n: 'SCOOTZ', c: 0x3a76c4, m: 5, p: 0, x, y: 1, z, ry: Math.PI / 2 });
  const relayed = await want(P, (m) => m.t === 'state' && m.id === SID && m.m === 5, { from: pMark });
  check('F13b. m:5 scooter state relays to a peer with m preserved as 5 (not rewritten to 0)',
    !!relayed, JSON.stringify(relayed));

  S.ws.close(); P.ws.close();
}

async function main() {
  // snapshot the real scores.json (gitignored) so the m5 submit can't clobber it
  let scoresBackup = null, scoresExisted = false;
  try { scoresBackup = fs.readFileSync(SCORES); scoresExisted = true; } catch { scoresExisted = false; }

  let child;
  try {
    child = await bootServer();
    await runAssertions();
    await runRideAssertions();
    await runRoomAssertions();
    await runMevAssertions();
    await runM8Assertions();
    await runM9Assertions();
    await runM10Assertions();
    await runM11Assertions();
    await runM12Assertions();
    await runDailyAssertions();
    await runScooterAssertions();
    await runDailyRollAssertion();
  } catch (e) {
    check('harness ran to completion', false, String((e && e.stack) || e));
  } finally {
    if (child) { try { child.kill('SIGKILL'); } catch {} }
    try {
      if (scoresExisted) fs.writeFileSync(SCORES, scoresBackup);
      else fs.unlinkSync(SCORES);
    } catch {}
    console.log(`\n${passed} passed, ${failed} failed  (port ${PORT}, scores.json ${scoresExisted ? 'restored' : 'removed (was absent)'})`);
    process.exit(failed ? 1 : 0);
  }
}

main();
