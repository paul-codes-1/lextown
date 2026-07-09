// LEXTOWN NPC agents: a handful of lightweight characters that wander
// downtown and banter in chat, with lines written on the fly by Claude
// Haiku. One process, one WebSocket per NPC.
//
//   LEXTOWN_WS=ws://localhost:8080 ANTHROPIC_API_KEY=sk-... node bots/npcs.mjs
//
// Design constraints:
// - NPCs never reply to each other (loop-proof: persona names are known).
// - One reply per human message at most, picked deterministically.
// - Global Haiku budget: MAX_CALLS_PER_HOUR across all NPCs.
// - Replies are sanitized to <=110 chars of printable ASCII; the server
//   sanitizes + rate-limits again on its side.
'use strict';
import WebSocket from 'ws';

const WS_URL = process.env.LEXTOWN_WS || 'ws://localhost:8080';
const API_KEY = process.env.ANTHROPIC_API_KEY || '';
const NPC_COUNT = Math.min(6, parseInt(process.env.NPC_COUNT || '5', 10) || 5);
const MODEL = process.env.NPC_MODEL || 'claude-haiku-4-5-20251001';
const MAX_CALLS_PER_HOUR = 40;

const PERSONAS = [
  { n: 'BIG LEX', c: 0x2f5d8f,
    p: 'You are BIG LEX, the giant blue horse mascot of Lexington KY, wandering the downtown of a blocky video game. Horse puns, relentless civic pride, slightly too much energy.' },
  { n: 'TOLLY HO', c: 0xd4703a,
    p: 'You are TOLLY HO, a night-shift diner spirit in a blocky Lexington video game. You speak like a short-order cook at 3am: unbothered, hash-brown wisdom, everything reminds you of an order.' },
  { n: 'DEBBIE LFUCG', c: 0x6b4a8f,
    p: 'You are DEBBIE from LFUCG, a city-government employee NPC in a blocky Lexington video game. Deadpan bureaucrat: everything needs a form, a permit, or a public comment period.' },
  { n: 'JIM', c: 0xc9a44a,
    p: 'You are JIM, the nervous news-chopper cameraman NPC in a blocky Lexington video game. The pilot keeps crashing. You have seen things. You speak in anxious fragments about getting the shot.' },
  { n: 'PARKING LOTT', c: 0x39404a,
    p: 'You are PARKING LOTT, a developer NPC in a blocky Lexington video game who wants to pave everything downtown into surface parking. Every reply pitches another parking lot.' },
  { n: 'MAN O WAR JR', c: 0x8f2f3c,
    p: 'You are MAN O WAR JR, a hyper-competitive NPC in a blocky Lexington video game. You brag about mission leaderboard times and challenge people to races you cannot actually run.' },
];
const NPC_NAMES = new Set(PERSONAS.map((p) => p.n.toUpperCase()));

// downtown street grid (mirrors the client's tables)
const EW = [-300, -200, -100, 0, 100, 200];
const NS = [-200, -100, 0, 100, 200];

let callTimes = [];
function budgetOk() {
  const now = Date.now();
  callTimes = callTimes.filter((t) => now - t < 3600e3);
  return callTimes.length < MAX_CALLS_PER_HOUR;
}
async function haiku(system, user) {
  if (!API_KEY || !budgetOk()) return null;
  callTimes.push(Date.now());
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01',
        'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 60,
        system, messages: [{ role: 'user', content: user }] }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) { console.log('[haiku]', r.status, (await r.text()).slice(0, 120)); return null; }
    const j = await r.json();
    const text = (j.content && j.content[0] && j.content[0].text) || '';
    return text.replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim().slice(0, 110) || null;
  } catch (e) { console.log('[haiku]', e.message); return null; }
}
const RULES = ' You are chatting in the game\'s public chat. Reply with ONE short line, under 100 characters, plain ASCII, no quotation marks around it, family friendly, stay in character. Do not use hashtags.';

function makeNpc(persona) {
  const npc = {
    ...persona,
    ws: null, alive: false,
    axis: Math.random() < 0.5 ? 'x' : 'z',
    line: 0, s: 0, side: Math.random() < 0.5 ? -11 : 11,
    dir: Math.random() < 0.5 ? 1 : -1,
    sp: 2 + Math.random() * 3,
    y: 0, vy: 0, ry: 0,
    lastChatAt: 0, recent: [],
    lastHumanAt: 0,
  };
  npc.line = npc.axis === 'x' ? EW[(Math.random() * EW.length) | 0] : NS[(Math.random() * NS.length) | 0];
  npc.s = -150 + Math.random() * 300;
  return npc;
}
const npcs = PERSONAS.slice(0, NPC_COUNT).map(makeNpc);

function connect(npc) {
  const ws = new WebSocket(WS_URL);
  npc.ws = ws;
  ws.on('open', () => { npc.alive = true; console.log(`[join] ${npc.n}`); });
  ws.on('close', () => {
    npc.alive = false;
    setTimeout(() => connect(npc), 5000 + Math.random() * 15000);
  });
  ws.on('error', () => {});
  ws.on('message', (d) => {
    let m; try { m = JSON.parse(d); } catch { return; }
    if (m.t === 'state') {
      if (m.n && !NPC_NAMES.has(String(m.n).toUpperCase())) npc.lastHumanAt = Date.now();
      return;
    }
    if (m.t !== 'chat') return;
    const who = String(m.n || '');
    const msg = String(m.msg || '');
    if (!who || who.startsWith('*') || who.startsWith('⚙')) return;   // system lines
    if (NPC_NAMES.has(who.toUpperCase())) return;                          // never talk to bots
    npc.recent.push(`${who}: ${msg}`);
    if (npc.recent.length > 6) npc.recent.shift();
    maybeReply(npc, who, msg);
  });
}

let lastReplyAt = 0;
function pickResponder(msg) {
  // deterministic: all processes' NPCs agree on who answers
  let h = 0;
  for (const ch of msg) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return npcs[h % npcs.length];
}
async function maybeReply(npc, who, msg) {
  const now = Date.now();
  const mentioned = msg.toUpperCase().includes(npc.n.split(' ')[0]) && npc.n.length > 2;
  if (!mentioned) {
    if (pickResponder(msg) !== npc) return;         // one candidate per message
    if (Math.random() > 0.35) return;               // ...and usually stay quiet
    if (now - lastReplyAt < 25000) return;          // world-wide chat cooldown
  }
  if (now - npc.lastChatAt < 20000) return;
  npc.lastChatAt = now; lastReplyAt = now;
  const line = await haiku(npc.p + RULES,
    `Recent game chat:\n${npc.recent.join('\n')}\n\n${who} just said: "${msg}". Your one-line response:`);
  if (!line || !npc.alive) return;
  setTimeout(() => {
    if (npc.alive) npc.ws.send(JSON.stringify({ t: 'chat', msg: line }));
  }, 1500 + Math.random() * 4000);
}
async function ambient() {
  const npc = npcs[(Math.random() * npcs.length) | 0];
  if (!npc.alive) return;
  if (Date.now() - npc.lastHumanAt > 10 * 60e3) return;   // nobody around, save tokens
  const line = await haiku(npc.p + RULES,
    (npc.recent.length ? `Recent game chat:\n${npc.recent.join('\n')}\n\n` : '') +
    'Say one ambient in-character line to the players wandering downtown:');
  if (line && npc.alive) npc.ws.send(JSON.stringify({ t: 'chat', msg: line }));
}
setInterval(ambient, 240e3 + Math.random() * 120e3);

// movement: wander the street grid, turn at intersections, hop sometimes
setInterval(() => {
  for (const npc of npcs) {
    if (!npc.alive) continue;
    npc.s += npc.dir * npc.sp * 0.1;
    if (npc.s > 280) { npc.s = 280; npc.dir = -1; }
    if (npc.s < -380) { npc.s = -380; npc.dir = 1; }
    const crosses = npc.axis === 'x' ? NS : EW;
    for (const c of crosses) {
      if (Math.abs(npc.s - c) < 0.4 && Math.random() < 0.35) {   // turn the corner
        const old = npc.line;
        npc.line = c;                        // new fixed coord = the crossing street
        npc.s = old + (Math.random() < 0.5 ? -1 : 1) * 0.5;
        npc.axis = npc.axis === 'x' ? 'z' : 'x';
        npc.dir = Math.random() < 0.5 ? 1 : -1;
        break;
      }
    }
    if (npc.y === 0 && Math.random() < 0.01) npc.vy = 9;
    if (npc.vy || npc.y > 0) {
      npc.vy -= 3; npc.y += npc.vy * 0.1;
      if (npc.y <= 0) { npc.y = 0; npc.vy = 0; }
    }
    const x = npc.axis === 'x' ? npc.s : npc.line + npc.side;
    const z = npc.axis === 'x' ? npc.line + npc.side : npc.s;
    const tRy = npc.axis === 'x' ? (npc.dir > 0 ? Math.PI / 2 : -Math.PI / 2)
                                 : (npc.dir > 0 ? 0 : Math.PI);
    npc.ry = tRy;
    npc.ws.send(JSON.stringify({ t: 'state', n: npc.n, c: npc.c, m: 0, p: 0,
      x: +x.toFixed(2), y: +npc.y.toFixed(2), z: +z.toFixed(2), ry: +npc.ry.toFixed(3) }));
  }
}, 100);

npcs.forEach((npc, i) => setTimeout(() => connect(npc), i * 1200));
console.log(`LEXTOWN NPCs: ${npcs.map((n) => n.n).join(', ')} -> ${WS_URL}` +
  (API_KEY ? '' : '  (no ANTHROPIC_API_KEY: silent wanderers only)'));
