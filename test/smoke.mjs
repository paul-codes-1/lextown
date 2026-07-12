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
// (see runRoomAssertions).
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

// --- tiny ws client harness ----------------------------------------------
function connect(query) {
  const c = { ws: new WebSocket(WS_URL + '/' + (query || '')), msgs: [], waiters: new Set() };
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

function bootServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(PORT), ADMIN_TOKEN, NPC_TOKEN },
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
