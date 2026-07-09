// LEXTOWN-01 — static file server + WebSocket relay for multiplayer.
// Run: npm install && npm start   then open http://localhost:8080/
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const WEB_ROOT = path.join(__dirname, 'web');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/admin/stats') {   // curl-able live counters (token-gated)
    const q = new URL(req.url, 'http://x').searchParams;
    if (!ADMIN_TOKEN || q.get('token') !== ADMIN_TOKEN) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(JSON.stringify({
      stats, online: [...clients.values()].map((c) => ({
        id: c.id, name: c.name, ip: c.ip, pvp: c.pvp,
        secs: Math.round((Date.now() - c.joinedAt) / 1000),
      })),
    }, null, 2));
  }
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(WEB_ROOT, path.normalize(urlPath));
  if (!filePath.startsWith(WEB_ROOT)) {
    res.writeHead(403);
    return res.end('forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('not found');
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(data);
  });
});

// --- multiplayer relay with server-side validation -----------------------
// Protocol (JSON, one object per message):
//   server -> client on connect:  {t:'welcome', id, peers:[...], heli:{...}}
//   client -> server ~10Hz:       {t:'state', n:<name>, c:<color>, m, p, x,y,z, ry}
//   server -> others (relayed):   {t:'state', id, n, c, m, p, x,y,z, ry}
//   server -> cheater (rejected): {t:'correct', x,y,z}  (client must snap back)
//   client -> server:             {t:'chat', msg}       (<=120 chars, rate limited)
//   server -> everyone:           {t:'chat', id, n, msg}
//   server -> others on drop:     {t:'leave', id}
//   news chopper:                 {t:'heli', a:'enter'|'exit'|'deny'|'snap'|'hp'|'down', ...}
//   RPG rockets (cosmetic relay): {t:'rocket', ox..dz}; hit claim {t:'rhit'}
//   water cannon:                 {t:'spray', ox..dz} relay; {t:'push', target, vx,vy,vz}
//                                 -> validated, sent to all as {t:'pushed', id, vx,vy,vz}
//
// Movement validation: the server is authoritative about *plausibility*, not
// physics. Each accepted state must be inside the world bounds and reachable
// from the last accepted state at legal speed (run 13.5 m/s, jump ~11.5 m/s
// vertical — enforced with tolerance for network jitter). Violations are not
// relayed; the client gets a {t:'correct'} snapping it back.

// KEEP IN SYNC with X0/X1/Z0/Z1 in web/app.js (+25 clamp slack): the client
// clamps to extents+20, and anything outside these bounds gets move-rejected
// (the "invisible wall" bug of 2026-07-09 was this constant going stale).
const WORLD = { x0: -545, x1: 645, z0: -1525, z1: 825, y0: -1, y1: 190 };
const FREEZE_MS = 4000;
const HIT_RANGE = 80;          // max shooter->target distance for a valid tag
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

// --- telemetry -----------------------------------------------------------
// Structured JSONL event log for post-hoc analytics + bug hunting. Rotates
// daily, pruned after 14 days (matches the privacy policy's "routinely
// discarded" operational-log language). Never logs chat content.
const LOG_DIR = path.join(__dirname, 'logs');
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch {}
let logStream = null, logDay = '';
function pruneLogs() {
  try {
    for (const f of fs.readdirSync(LOG_DIR)) {
      const m = f.match(/^events-(\d{4}-\d{2}-\d{2})\.jsonl$/);
      if (m && Date.now() - Date.parse(m[1]) > 14 * 86400e3)
        fs.unlinkSync(path.join(LOG_DIR, f));
    }
  } catch {}
}
function logEvent(e, data) {
  const day = new Date().toISOString().slice(0, 10);
  if (day !== logDay) {
    try { if (logStream) logStream.end(); } catch {}
    logDay = day;
    logStream = fs.createWriteStream(path.join(LOG_DIR, `events-${day}.jsonl`), { flags: 'a' });
    pruneLogs();
  }
  try {
    logStream.write(JSON.stringify(Object.assign({ ts: new Date().toISOString(), e }, data)) + '\n');
  } catch {}
}
const stats = {
  boot: Date.now(), joins: 0, peak: 0, chats: 0, shots: 0, hits: 0,
  corrections: 0, clientErrs: 0, kicks: 0, bans: 0,
  heliFlights: 0, heliDowns: 0, rockets: 0, pushes: 0, missions: 0,
};
function statsLine() {
  const up = Math.round((Date.now() - stats.boot) / 60000);
  return `up ${up}m · online ${clients.size} (peak ${stats.peak}) · joins ${stats.joins}` +
    ` · chats ${stats.chats} · shots ${stats.shots} · freezes ${stats.hits}` +
    ` · heli flights ${stats.heliFlights} · heli downs ${stats.heliDowns}` +
    ` · rockets ${stats.rockets} · pushes ${stats.pushes} · missions ${stats.missions}` +
    ` · move-rejects ${stats.corrections} · client-errs ${stats.clientErrs}` +
    ` · kicks ${stats.kicks} · bans ${stats.bans}`;
}
setInterval(() => {
  logEvent('metrics', {
    online: clients.size, peak: stats.peak, joins: stats.joins, chats: stats.chats,
    shots: stats.shots, hits: stats.hits, corrections: stats.corrections,
    clientErrs: stats.clientErrs, rssMb: Math.round(process.memoryUsage().rss / 1048576),
  });
}, 5 * 60 * 1000).unref();
process.on('uncaughtException', (err) => {
  logEvent('fatal', { msg: String(err && err.stack || err).slice(0, 500) });
  console.error('[fatal]', err);
  process.exit(1);   // systemd restarts us
});
process.on('unhandledRejection', (err) => {
  logEvent('rejection', { msg: String(err && err.stack || err).slice(0, 500) });
});

// mission leaderboards, persisted to scores.json (gitignored), top 50 each:
//   m1 = THE RIBBON CUTTING (fastest chopper takedown)
//   m2 = SNOW EMERGENCY (fastest plow, penalties included)
//   m3 = THE DATA CENTER (fastest investigation)
//   m4 = HORSEPOWER (fastest horse roundup)
// Migration: an old plain-array scores.json becomes the m1 board.
const SCORES_PATH = path.join(__dirname, 'scores.json');
const BOARDS = ['m1', 'm2', 'm3', 'm4'];
let scores = { m1: [], m2: [], m3: [], m4: [] };
try {
  const parsed = JSON.parse(fs.readFileSync(SCORES_PATH, 'utf8'));
  if (Array.isArray(parsed)) scores.m1 = parsed;
  else BOARDS.forEach((b) => { scores[b] = parsed[b] || []; });
} catch { /* fresh file */ }
function saveScores() {
  try { fs.writeFileSync(SCORES_PATH, JSON.stringify(scores, null, 2)); }
  catch (e) { console.log('[warn] could not persist scores:', e.message); }
}
function topScores() {
  const top = (b) => scores[b].slice(0, 10).map((s) => ({ n: s.n, ms: s.ms }));
  return { m1: top('m1'), m2: top('m2'), m3: top('m3'), m4: top('m4') };
}

// persistent ban list: [{ip, name}]
const BANS_PATH = path.join(__dirname, 'bans.json');
let bans = [];
try { bans = JSON.parse(fs.readFileSync(BANS_PATH, 'utf8')); } catch { bans = []; }
function saveBans() {
  try { fs.writeFileSync(BANS_PATH, JSON.stringify(bans, null, 2)); }
  catch (e) { console.log('[warn] could not persist bans:', e.message); }
}
function isBanned(ip, name) {
  const n = (name || '').toLowerCase();
  return bans.some((b) => b.ip === ip || (n && b.name && b.name.toLowerCase() === n));
}
// per-mode speed caps (m/s): m=0 walk (run 13.5), m=1 jetpack (fly 15 h,
// 13 v up), m=2 driving (30 h), m=3 news chopper (36 h, 17 climb). Mode is
// client-declared, so a cheater can claim the highest cap — this bounds
// absurdity, not honesty.
// `v` caps UPWARD speed only; falling is capped separately at terminal
// velocity, otherwise legitimate falls past ~4m get rejected (rubber-band).
const CAPS = { 0: { h: 18, v: 14 }, 1: { h: 20, v: 16 }, 2: { h: 38, v: 12 }, 3: { h: 42, v: 20 } };
const MAX_FALL = 34;   // client terminal velocity is 30

// --- the news chopper -----------------------------------------------------
// One shared helicopter; the server arbitrates who flies it, tracks its hp,
// and validates shoot-down claims. Position rides along on the pilot's state
// packets (m=3). Pad = the helipad on Big Blue.
const HELI_PAD = { x: -127, y: 129.8, z: 11, th: 1.5708 };
const HELI = { pilot: null, hp: 3, x: HELI_PAD.x, y: HELI_PAD.y, z: HELI_PAD.z, th: HELI_PAD.th };
function heliSnap() {
  return { t: 'heli', a: 'snap', pilot: HELI.pilot, hp: HELI.hp,
    x: HELI.x, y: HELI.y, z: HELI.z, th: HELI.th };
}
function heliDown(by) {
  stats.heliDowns++;
  logEvent('heli_down', { by });
  broadcast({ t: 'heli', a: 'down', by }, null);
  HELI.pilot = null; HELI.hp = 3;
  HELI.x = HELI_PAD.x; HELI.y = HELI_PAD.y; HELI.z = HELI_PAD.z; HELI.th = HELI_PAD.th;
}
const MAX_STATE_HZ = 15;   // packets/sec before we start dropping
const NAME_RE = /[^A-Za-z0-9 _-]/g;

const wss = new WebSocketServer({ server });
const clients = new Map(); // ws -> client record
let nextId = 1;

function broadcast(msg, except) {
  const s = JSON.stringify(msg);
  for (const ws of clients.keys()) {
    if (ws !== except && ws.readyState === ws.OPEN) ws.send(s);
  }
}

function num(v, lo, hi) {
  return typeof v === 'number' && isFinite(v) && v >= lo && v <= hi;
}

function validMove(c, msg, now) {
  if (!num(msg.x, WORLD.x0, WORLD.x1) || !num(msg.z, WORLD.z0, WORLD.z1) ||
      !num(msg.y, WORLD.y0, WORLD.y1) || !num(msg.ry, -10, 10)) return false;
  if (!c.pos) return true; // first packet fixes the spawn
  const m = CAPS[msg.m] ? msg.m : 0;
  const caps = CAPS[m];
  // entering/exiting a vehicle teleports the avatar a few meters — allow a
  // one-packet hop when the declared mode changes
  const slack = m !== c.lastM ? 7 : 0;
  const dt = Math.min(2, Math.max(0, (now - c.posAt) / 1000));
  // token-bucket travel budgets, not per-packet caps: network jitter batches
  // packets (a 400ms stall, then four arrive at once) and a strict cap*dt
  // check false-rejects the burst — the "invisible wall at times" bug of
  // 2026-07-09. Banked allowance absorbs bursts while still bounding
  // sustained speed at the caps and any single hop at ~1.2s of travel.
  c.bh = Math.min(caps.h * 1.2, (c.bh === undefined ? caps.h * 0.4 : c.bh) + caps.h * dt);
  c.bv = Math.min(caps.v * 1.2, (c.bv === undefined ? caps.v * 0.4 : c.bv) + caps.v * dt);
  c.bf = Math.min(MAX_FALL * 1.2, (c.bf === undefined ? MAX_FALL * 0.4 : c.bf) + MAX_FALL * dt);
  const dh = Math.hypot(msg.x - c.pos.x, msg.z - c.pos.z);
  const up = msg.y - c.pos.y;   // + rising, - falling
  const ok = dh <= c.bh + 0.5 + slack &&
    up <= c.bv + 0.5 + slack &&
    -up <= c.bf + 0.5 + slack;
  if (ok) {
    c.bh -= dh;
    if (up > 0) c.bv -= up; else c.bf -= -up;
  }
  return ok;
}

function sys(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ t: 'sys', msg }));
}
function findByName(name) {
  const n = (name || '').toLowerCase();
  for (const [ws, c] of clients) if ((c.name || '').toLowerCase() === n) return [ws, c];
  return [null, null];
}
function handleCommand(ws, client, text) {
  const [cmd, ...rest] = text.slice(1).split(/\s+/);
  const arg = rest.join(' ');
  if (cmd === 'admin') {
    if (ADMIN_TOKEN && arg === ADMIN_TOKEN) { client.admin = true; sys(ws, 'admin: granted'); }
    else sys(ws, ADMIN_TOKEN ? 'admin: bad token' : 'admin: disabled (no ADMIN_TOKEN set)');
    return;
  }
  if (!client.admin) { sys(ws, 'unknown command'); return; }
  logEvent('admin_cmd', { by: client.name, cmd, arg: arg.slice(0, 60) });
  switch (cmd) {
    case 'stats':
      sys(ws, statsLine());
      break;
    case 'list': {
      const lines = [...clients.values()].map((c) =>
        `${c.id} ${c.name || '?'} ${c.ip || '?'}${c.admin ? ' [admin]' : ''}`);
      sys(ws, 'online: ' + (lines.join(' | ') || 'nobody'));
      break;
    }
    case 'kick': {
      const [tws, tc] = findByName(arg);
      if (!tc) { sys(ws, `no player "${arg}"`); break; }
      sys(tws, 'you were kicked by an admin');
      tws.close(4001, 'kicked');
      stats.kicks++;
      sys(ws, `kicked ${tc.name}`);
      console.log(`[admin] ${client.name} kicked ${tc.name}`);
      break;
    }
    case 'ban': {
      const [tws, tc] = findByName(arg);
      if (!tc) { sys(ws, `no player "${arg}"`); break; }
      bans.push({ ip: tc.ip, name: tc.name });
      saveBans();
      sys(tws, 'you were banned by an admin');
      tws.close(4003, 'banned');
      stats.bans++;
      sys(ws, `banned ${tc.name} (${tc.ip})`);
      console.log(`[admin] ${client.name} banned ${tc.name} ${tc.ip}`);
      break;
    }
    case 'unban': {
      const before = bans.length;
      bans = bans.filter((b) => b.ip !== arg && (b.name || '').toLowerCase() !== arg.toLowerCase());
      saveBans();
      sys(ws, `removed ${before - bans.length} ban(s)`);
      break;
    }
    case 'unfreeze': {
      const [, tc] = findByName(arg);
      if (!tc) { sys(ws, `no player "${arg}"`); break; }
      tc.frozenUntil = 0;
      broadcast({ t: 'frozen', id: tc.id, dur: 0 }, null);
      sys(ws, `unfroze ${tc.name}`);
      break;
    }
    case 'announce':
      broadcast({ t: 'chat', id: 'SERVER', n: '⚙ ANNOUNCE', msg: arg.slice(0, 120) }, null);
      break;
    default:
      sys(ws, 'commands: /stats /list /kick <name> /ban <name> /unban <name|ip> /unfreeze <name> /announce <msg>');
  }
}

wss.on('connection', (ws, req) => {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket.remoteAddress;
  if (isBanned(ip, null)) { ws.close(4003, 'banned'); return; }
  const id = 'P' + nextId++;
  const client = {
    id, ip,
    state: null,          // last accepted state (relayed to new joiners)
    pos: null, posAt: 0,  // last accepted position for speed checks
    name: null,
    pvp: 0, frozenUntil: 0,
    shotTimes: [],
    admin: false,
    stateTimes: [],       // sliding window for packet-rate limiting
    lastM: 0,             // last accepted mode (for mode-switch slack)
    rocketTimes: [], sprayTimes: [], pushTimes: [], lastRhit: 0,
    chatTokens: 3, chatAt: Date.now(),
    strikes: 0,
    joinedAt: Date.now(), chatCount: 0, shotCount: 0, tagCount: 0, errCount: 0,
  };
  clients.set(ws, client);
  stats.joins++;
  stats.peak = Math.max(stats.peak, clients.size);
  logEvent('join', { id, ip, online: clients.size,
    ua: String(req.headers['user-agent'] || '').slice(0, 120) });
  const peers = [...clients.values()]
    .filter((c) => c.id !== id && c.state)
    .map((c) => c.state);
  ws.send(JSON.stringify({ t: 'welcome', id, peers, heli: heliSnap() }));
  console.log(`[join] ${id} (${clients.size} online)`);

  ws.on('message', (data) => {
    if (data.length > 512) return; // oversized packet, drop
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    const now = Date.now();

    if (msg.t === 'state') {
      // packet-rate limit
      client.stateTimes = client.stateTimes.filter((t) => now - t < 1000);
      if (client.stateTimes.length >= MAX_STATE_HZ) return;
      client.stateTimes.push(now);

      // sanitized name, updatable (players can rename from the welcome modal)
      if (typeof msg.n === 'string') {
        const nm = msg.n.replace(NAME_RE, '').slice(0, 14);
        if (nm && nm !== client.name) {
          if (isBanned(null, nm)) { ws.close(4003, 'banned'); return; }
          logEvent(client.name === null ? 'name' : 'rename', { id, n: nm });
          client.name = nm;
        }
      }
      if (client.name === null) client.name = id;
      client.pvp = msg.p === 1 ? 1 : 0;

      if (!validMove(client, msg, now)) {
        client.strikes++;
        stats.corrections++;
        if (client.strikes % 5 === 1 && client.pos) // don't spam corrections
          ws.send(JSON.stringify({ t: 'correct', x: client.pos.x, y: client.pos.y, z: client.pos.z }));
        if (client.strikes === 20) {
          console.log(`[cheat?] ${id}/${client.name} ${client.strikes} rejected moves`);
          logEvent('cheat_suspect', { id, n: client.name, strikes: client.strikes });
        }
        return; // rejected: not relayed
      }
      client.pos = { x: msg.x, y: msg.y, z: msg.z };
      client.posAt = now;
      const cleanM = CAPS[msg.m] ? msg.m : 0;
      client.lastM = cleanM;
      const clean = { t: 'state', id, n: client.name || id,
        c: typeof msg.c === 'number' ? msg.c : 0x3a76c4,
        m: cleanM,
        p: client.pvp,
        x: msg.x, y: msg.y, z: msg.z, ry: msg.ry };
      client.state = clean;
      if (HELI.pilot === id && cleanM === 3) {   // heli rides the pilot's state
        HELI.x = msg.x; HELI.y = msg.y + 1.2; HELI.z = msg.z; HELI.th = msg.ry;
      }
      broadcast(clean, ws);
      return;
    }

    if (msg.t === 'shot') {
      // cosmetic dart relay: PvP only, max 4/s
      if (!client.pvp) return;
      client.shotTimes = client.shotTimes.filter((t) => now - t < 1000);
      if (client.shotTimes.length >= 4) return;
      client.shotTimes.push(now);
      client.shotCount++;
      stats.shots++;
      if (![msg.ox, msg.oy, msg.oz, msg.dx, msg.dy, msg.dz].every((v) => num(v, -1000, 1000))) return;
      broadcast({ t: 'shot', id, ox: msg.ox, oy: msg.oy, oz: msg.oz,
        dx: msg.dx, dy: msg.dy, dz: msg.dz }, ws);
      return;
    }

    if (msg.t === 'hit') {
      // freeze tag: both opted in, in range, target not already frozen
      if (!client.pvp || !client.pos) return;
      const target = [...clients.values()].find((c) => c.id === msg.target);
      if (!target || !target.pvp || !target.pos) return;
      if (now < target.frozenUntil) return;
      const d = Math.hypot(client.pos.x - target.pos.x, client.pos.z - target.pos.z);
      if (d > HIT_RANGE) return;
      target.frozenUntil = now + FREEZE_MS;
      client.tagCount++;
      stats.hits++;
      logEvent('freeze', { by: id, target: target.id });
      broadcast({ t: 'frozen', id: target.id, dur: FREEZE_MS, by: id }, null);
      return;
    }

    if (msg.t === 'heli') {
      if (msg.a === 'enter') {
        if (HELI.pilot) { ws.send(JSON.stringify({ t: 'heli', a: 'deny' })); return; }
        if (!client.pos ||
            Math.hypot(client.pos.x - HELI.x, client.pos.z - HELI.z) > 12 ||
            Math.abs(client.pos.y - HELI.y) > 8) return;
        HELI.pilot = id;
        stats.heliFlights++;
        logEvent('heli_enter', { id, n: client.name });
        broadcast({ t: 'heli', a: 'enter', id }, null);
        return;
      }
      if (msg.a === 'exit') {
        if (HELI.pilot !== id) return;
        HELI.pilot = null;
        if (msg.crash) { heliDown(id); return; }
        if (num(msg.x, WORLD.x0, WORLD.x1) && num(msg.y, 0, WORLD.y1) &&
            num(msg.z, WORLD.z0, WORLD.z1)) {
          HELI.x = msg.x; HELI.y = msg.y; HELI.z = msg.z;
          if (num(msg.th, -10, 10)) HELI.th = msg.th;
        }
        broadcast({ t: 'heli', a: 'exit', id, x: HELI.x, y: HELI.y, z: HELI.z, th: HELI.th }, ws);
        return;
      }
      return;
    }

    if (msg.t === 'rocket') {
      // cosmetic RPG-rocket relay (anti-chopper play; no PvP opt-in needed), max 2/s
      client.rocketTimes = client.rocketTimes.filter((t) => now - t < 1000);
      if (client.rocketTimes.length >= 2) return;
      client.rocketTimes.push(now);
      stats.rockets++;
      if (![msg.ox, msg.oy, msg.oz, msg.dx, msg.dy, msg.dz].every((v) => num(v, -1000, 1000))) return;
      broadcast({ t: 'rocket', id, ox: msg.ox, oy: msg.oy, oz: msg.oz,
        dx: msg.dx, dy: msg.dy, dz: msg.dz }, ws);
      return;
    }

    if (msg.t === 'rhit') {
      // rocket hit the chopper: only while piloted, not by the pilot, ranged,
      // and at most one claimed hit per shooter per rocket cooldown
      if (!HELI.pilot || HELI.pilot === id) return;
      if (now - client.lastRhit < 1100) return;
      client.lastRhit = now;
      if (!client.pos || Math.hypot(client.pos.x - HELI.x, client.pos.z - HELI.z) > 320) return;
      HELI.hp--;
      logEvent('heli_hit', { by: id, hp: HELI.hp });
      if (HELI.hp > 0) broadcast({ t: 'heli', a: 'hp', hp: HELI.hp }, null);
      else heliDown(id);
      return;
    }

    if (msg.t === 'spray') {
      // cosmetic water-cannon relay: pilot only, max 6/s
      if (HELI.pilot !== id) return;
      client.sprayTimes = client.sprayTimes.filter((t) => now - t < 1000);
      if (client.sprayTimes.length >= 6) return;
      client.sprayTimes.push(now);
      if (![msg.ox, msg.oy, msg.oz, msg.dx, msg.dy, msg.dz].every((v) => num(v, -1000, 1000))) return;
      broadcast({ t: 'spray', id, ox: msg.ox, oy: msg.oy, oz: msg.oz,
        dx: msg.dx, dy: msg.dy, dz: msg.dz }, ws);
      return;
    }

    if (msg.t === 'push') {
      // water-cannon shove: pilot only, bounded impulse, target near the heli
      if (HELI.pilot !== id) return;
      client.pushTimes = client.pushTimes.filter((t) => now - t < 1000);
      if (client.pushTimes.length >= 10) return;
      client.pushTimes.push(now);
      if (!num(msg.vx, -16, 16) || !num(msg.vz, -16, 16) || !num(msg.vy, 0, 8)) return;
      const target = [...clients.values()].find((c) => c.id === msg.target);
      if (!target || !target.pos) return;
      if (Math.hypot(HELI.x - target.pos.x, HELI.z - target.pos.z) > 55 ||
          Math.abs(HELI.y - target.pos.y) > 45) return;
      stats.pushes++;
      broadcast({ t: 'pushed', id: target.id, vx: msg.vx, vy: msg.vy, vz: msg.vz }, null);
      return;
    }

    if (msg.t === 'score') {
      // mission completion: plausible time window per board, 1 per 15s per client
      const board = { 2: 'm2', 3: 'm3', 4: 'm4' }[msg.m] || 'm1';
      const WIN = { m1: [3000, 600000], m2: [20000, 900000],
                    m3: [20000, 900000], m4: [30000, 1500000] }[board];
      if (!num(msg.ms, WIN[0], WIN[1])) return;
      if (client.lastScoreAt && now - client.lastScoreAt < 15000) return;
      client.lastScoreAt = now;
      const n = client.name || id;
      scores[board].push({ n, ms: Math.round(msg.ms), ts: new Date().toISOString() });
      scores[board].sort((a, b) => a.ms - b.ms);
      scores[board] = scores[board].slice(0, 50);
      saveScores();
      stats.missions++;
      logEvent('mission_score', { id, n, m: board, ms: Math.round(msg.ms) });
      const sec = (msg.ms / 1000).toFixed(1);
      broadcast({ t: 'chat', id: 'SERVER', n: '* MISSION',
        msg: { m1: `${n} downed the chopper in ${sec}s`,
               m2: `${n} plowed downtown in ${sec}s`,
               m3: `${n} broke the data center story in ${sec}s`,
               m4: `${n} got the horses home in ${sec}s` }[board] }, null);
      ws.send(JSON.stringify(Object.assign({ t: 'scores' }, topScores())));
      return;
    }

    if (msg.t === 'scores') {
      ws.send(JSON.stringify(Object.assign({ t: 'scores' }, topScores())));
      return;
    }

    if (msg.t === 'err') {
      // client-side uncaught errors (max 3/session, content truncated)
      if (client.errCount >= 3) return;
      client.errCount++;
      stats.clientErrs++;
      logEvent('client_err', { id, n: client.name,
        msg: String(msg.msg || '').slice(0, 200), src: String(msg.src || '').slice(0, 100) });
      return;
    }

    if (msg.t === 'diag') {
      // periodic client perf beacon (fps etc.), max ~1/min enforced client-side
      if (!client.lastDiag || now - client.lastDiag > 45000) {
        client.lastDiag = now;
        logEvent('diag', { id, fps: num(msg.fps, 0, 1000) ? msg.fps : null,
          coarse: msg.coarse ? 1 : 0, dpr: num(msg.dpr, 0, 10) ? msg.dpr : null,
          peers: num(msg.peers, 0, 1000) ? msg.peers : null });
      }
      return;
    }

    if (msg.t === 'chat') {
      // token bucket: 3 burst, ~1 msg / 1.2s refill
      client.chatTokens = Math.min(3, client.chatTokens + (now - client.chatAt) / 1200);
      client.chatAt = now;
      if (client.chatTokens < 1) return;
      client.chatTokens -= 1;
      if (typeof msg.msg !== 'string') return;
      const text = msg.msg.replace(/[^\x20-\x7E]/g, '').trim().slice(0, 120);
      if (!text) return;
      if (text[0] === '/') { handleCommand(ws, client, text); return; }
      client.chatCount++;
      stats.chats++;   // volume only — content is never logged
      broadcast({ t: 'chat', id, n: client.name || id, msg: text }, null); // echo to sender too
      return;
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    if (HELI.pilot === id) heliDown(null);   // pilot vanished: chopper crashes
    broadcast({ t: 'leave', id });
    logEvent('leave', { id, n: client.name, secs: Math.round((Date.now() - client.joinedAt) / 1000),
      chats: client.chatCount, shots: client.shotCount, tags: client.tagCount,
      strikes: client.strikes, online: clients.size });
    console.log(`[leave] ${id} (${clients.size} online)`);
  });
  ws.on('error', () => ws.close());
});

server.listen(PORT, () => {
  console.log(`LEXTOWN-01 on http://localhost:${PORT}  (WebSocket relay on same port)`);
});
