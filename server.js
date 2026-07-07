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

wss.on('connection', (ws) => {
  const id = 'P' + nextId++;
  const client = {
    id,
    state: null,          // last accepted state (relayed to new joiners)
    pos: null, posAt: 0,  // last accepted position for speed checks
    name: null,
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
        if (nm) client.name = nm;
      }
      if (client.name === null) client.name = id;

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
        x: msg.x, y: msg.y, z: msg.z, ry: msg.ry };
      client.state = clean;
      broadcast(clean, ws);
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
