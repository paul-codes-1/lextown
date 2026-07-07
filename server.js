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
  '.ico': 'image/x-icon',
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
    res.writeHead(200, { 'content-type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

// --- multiplayer relay ---------------------------------------------------
// Protocol (JSON, one object per message):
//   server -> client on connect:  {t:'welcome', id, peers:[<last state of each peer>]}
//   client -> server ~10Hz:       {t:'state', n:<name>, c:<color>, x,y,z, ry}
//   server -> others (relayed):   {t:'state', id, n, c, x,y,z, ry}
//   server -> others on drop:     {t:'leave', id}

const wss = new WebSocketServer({ server });
const clients = new Map(); // ws -> {id, state}
let nextId = 1;

function broadcast(msg, except) {
  const s = JSON.stringify(msg);
  for (const ws of clients.keys()) {
    if (ws !== except && ws.readyState === ws.OPEN) ws.send(s);
  }
}

wss.on('connection', (ws) => {
  const id = 'P' + nextId++;
  const client = { id, state: null };
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
    if (msg.t === 'state') {
      msg.id = client.id;
      client.state = msg;
      broadcast(msg, ws);
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
