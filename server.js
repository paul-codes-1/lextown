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
//   server -> client on connect:  {t:'welcome', id, peers:[<last state of each peer>]}
//   client -> server ~10Hz:       {t:'state', n:<name>, c:<color>, x,y,z, ry}
//   server -> others (relayed):   {t:'state', id, n, c, x,y,z, ry}
//   server -> cheater (rejected): {t:'correct', x,y,z}  (client must snap back)
//   client -> server:             {t:'chat', msg}       (<=120 chars, rate limited)
//   server -> everyone:           {t:'chat', id, n, msg}
//   server -> others on drop:     {t:'leave', id}
//
// Movement validation: the server is authoritative about *plausibility*, not
// physics. Each accepted state must be inside the world bounds and reachable
// from the last accepted state at legal speed (run 13.5 m/s, jump ~11.5 m/s
// vertical — enforced with tolerance for network jitter). Violations are not
// relayed; the client gets a {t:'correct'} snapping it back.

const WORLD = { x0: -545, x1: 325, z0: -425, z1: 325, y0: -1, y1: 190 };
const FREEZE_MS = 4000;
const HIT_RANGE = 80;          // max shooter->target distance for a valid tag
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

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
// 13 v), m=2 driving (30 h). Mode is client-declared, so a cheater can claim
// "driving" for the highest cap — this bounds absurdity, not dishonesty.
const CAPS = { 0: { h: 18, v: 15 }, 1: { h: 20, v: 16 }, 2: { h: 38, v: 12 } };
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
  const caps = CAPS[msg.m === 1 || msg.m === 2 ? msg.m : 0];
  const dt = Math.min(2, Math.max(0.03, (now - c.posAt) / 1000));
  const dh = Math.hypot(msg.x - c.pos.x, msg.z - c.pos.z);
  const dv = Math.abs(msg.y - c.pos.y);
  return dh <= caps.h * dt + 0.5 && dv <= caps.v * dt + 0.5;
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
  switch (cmd) {
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
      sys(ws, 'commands: /list /kick <name> /ban <name> /unban <name|ip> /unfreeze <name> /announce <msg>');
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
    chatTokens: 3, chatAt: Date.now(),
    strikes: 0,
  };
  clients.set(ws, client);
  const peers = [...clients.values()]
    .filter((c) => c.id !== id && c.state)
    .map((c) => c.state);
  ws.send(JSON.stringify({ t: 'welcome', id, peers }));
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
          client.name = nm;
        }
      }
      if (client.name === null) client.name = id;
      client.pvp = msg.p === 1 ? 1 : 0;

      if (!validMove(client, msg, now)) {
        client.strikes++;
        if (client.strikes % 5 === 1 && client.pos) // don't spam corrections
          ws.send(JSON.stringify({ t: 'correct', x: client.pos.x, y: client.pos.y, z: client.pos.z }));
        if (client.strikes === 20)
          console.log(`[cheat?] ${id}/${client.name} ${client.strikes} rejected moves`);
        return; // rejected: not relayed
      }
      client.pos = { x: msg.x, y: msg.y, z: msg.z };
      client.posAt = now;
      const clean = { t: 'state', id, n: client.name || id,
        c: typeof msg.c === 'number' ? msg.c : 0x3a76c4,
        m: msg.m === 1 || msg.m === 2 ? msg.m : 0,
        p: client.pvp,
        x: msg.x, y: msg.y, z: msg.z, ry: msg.ry };
      client.state = clean;
      broadcast(clean, ws);
      return;
    }

    if (msg.t === 'shot') {
      // cosmetic dart relay: PvP only, max 4/s
      if (!client.pvp) return;
      client.shotTimes = client.shotTimes.filter((t) => now - t < 1000);
      if (client.shotTimes.length >= 4) return;
      client.shotTimes.push(now);
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
      broadcast({ t: 'frozen', id: target.id, dur: FREEZE_MS, by: id }, null);
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
      broadcast({ t: 'chat', id, n: client.name || id, msg: text }, null); // echo to sender too
      return;
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    broadcast({ t: 'leave', id });
    console.log(`[leave] ${id} (${clients.size} online)`);
  });
  ws.on('error', () => ws.close());
});

server.listen(PORT, () => {
  console.log(`LEXTOWN-01 on http://localhost:${PORT}  (WebSocket relay on same port)`);
});
