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

async function main() {
  // snapshot the real scores.json (gitignored) so the m5 submit can't clobber it
  let scoresBackup = null, scoresExisted = false;
  try { scoresBackup = fs.readFileSync(SCORES); scoresExisted = true; } catch { scoresExisted = false; }

  let child;
  try {
    child = await bootServer();
    await runAssertions();
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
