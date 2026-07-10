// LEXTOWN NPC agents: a handful of lightweight characters that wander
// downtown and banter in chat from per-persona PRESET line pools.
// (They used to write lines via Claude Haiku; API calls are suspended —
// no key needed, no budget, same wander + reply mechanics.)
//
//   LEXTOWN_WS=ws://localhost:8080 node bots/npcs.mjs
//
// Design constraints:
// - NPCs never reply to each other (loop-proof: persona names are known).
// - One reply per human message at most, picked deterministically.
// - Lines are <=110 chars of printable ASCII; the server sanitizes +
//   rate-limits again on its side.
'use strict';
import WebSocket from 'ws';

const WS_URL = process.env.LEXTOWN_WS || 'ws://localhost:8080';
// Optional shared secret; when set, the server tags these connections as NPCs
// (excluded from human stats + cheat heuristics). Appended to the WS URL as a
// query param so operators can leave LEXTOWN_WS clean. Never logged.
const NPC_TOKEN = process.env.NPC_TOKEN || '';
const CONNECT_URL = NPC_TOKEN
  ? WS_URL + (WS_URL.includes('?') ? '&' : '?') + 'npc=' + encodeURIComponent(NPC_TOKEN)
  : WS_URL;
const NPC_COUNT = Math.min(6, parseInt(process.env.NPC_COUNT || '5', 10) || 5);
const AMBIENT_MS = parseInt(process.env.NPC_AMBIENT_MS || '', 10) || 240e3;

const PERSONAS = [
  { n: 'BIG LEX', c: 0x2f5d8f,
    lines: [
      'WELCOME TO LEXINGTON, HORSE CAPITAL OF THE WORLD. I WOULD KNOW. I AM A HORSE.',
      'I HAVE SAID NEIGH TO EVERY CITY BUT THIS ONE.',
      'THE THOROUGHBRED PARK STATUES? ALL FRIENDS OF MINE. GREAT POSERS.',
      'STAY IN SCHOOL. EAT YOUR OATS. VISIT THE FARMS PAST NEW CIRCLE.',
      'THEY BUILT A WHOLE PARK FOR HORSES AND I STILL PAY RENT. UNBRIDLED ECONOMY.',
      'FUN FACT: MAIN STREET RUNS EAST. I RUN MAJESTIC.',
      'I AM NOT A MASCOT. I AM A LIFESTYLE.',
      'SOMEBODY PUT A HORSE IN A CAR YESTERDAY. THE DISRESPECT. THE INTRIGUE.',
      'GO CATS. GO HORSES. GO SLIGHTLY UNDER THE SPEED LIMIT.',
      'RUPP ARENA HOLDS 20,000 PEOPLE AND EXACTLY ONE ME.',
    ],
    replies: [
      'NEIGH-SAYERS WILL BE ESCORTED TO THE FARMS.',
      'THAT IS THE SPIRIT OF THE BLUEGRASS RIGHT THERE.',
      'I AM 100 PERCENT HORSE AND I APPROVE THIS MESSAGE.',
      'HOOF TO HEART, FRIEND.',
      'SAY THAT AGAIN AT RUPP. LOUDER. THE ACOUSTICS ARE AMAZING.',
      'STABLE OPINION. I RESPECT IT.',
    ] },
  { n: 'TOLLY HO', c: 0xd4703a,
    lines: [
      'GRIDDLE NEVER SLEEPS. NEITHER DO I. NEITHER DOES LIMESTONE.',
      'EVERYTHING LOOKS BETTER AT 3AM WITH HASH BROWNS ON THE SIDE.',
      'SAW THE NEWS CHOPPER GO DOWN AGAIN. ORDER UP.',
      'THE SECRET INGREDIENT IS SHOWING UP.',
      "A HORSE WENT BY THE WINDOW IN A SEDAN. DIDN'T EVEN ORDER.",
      'BUTTER THE GRIDDLE, NOT THE CUSTOMER.',
      "YOU CAN TELL A LOT ABOUT A CITY BY WHO'S AWAKE AT 4AM. MOSTLY ME.",
      'RAIN, SNOW, DATA CENTER SCANDAL - THE HO STAYS OPEN.',
      'EVERY GREAT DECISION IN THIS TOWN WAS MADE OVER CHEESE FRIES.',
      'CAMPUS KIDS ORDER THE SAME THING FOR FOUR YEARS THEN CRY AT GRADUATION. I GET IT.',
    ],
    replies: [
      'HEARD. THAT COMES WITH A SIDE.',
      'ORDER UP.',
      "THAT'S A TWO-EGG PROBLEM, FRIEND.",
      "WE'VE ALL BEEN THERE. USUALLY AROUND 3AM.",
      "I'D PUT THAT ON THE MENU.",
      'COFFEE FIRST. THEN WE TALK.',
    ] },
  { n: 'DEBBIE LFUCG', c: 0x6b4a8f,
    lines: [
      'REMINDER: JETPACKS OVER 40 FEET REQUIRE A VARIANCE. NOBODY HAS ONE.',
      'THE PUBLIC COMMENT PERIOD ON THE NEW POTHOLE CLOSES FRIDAY.',
      'THAT HELICOPTER IS IN VIOLATION OF SEVERAL ORDINANCES I AM STILL DRAFTING.',
      "FORM 27-B GETS YOU A HORSE PERMIT. FORM 27-C IS FOR THE HORSE'S CAR.",
      'THE URBAN SERVICE BOUNDARY IS NOT A SUGGESTION. IT IS A LINE. I LAMINATED IT.',
      'I HAVE A MEETING ABOUT SCHEDULING A MEETING. THIS IS THE JOB.',
      'PLEASE STOP DRIVING ON THE SIDEWALK. THERE IS A FORM FOR THAT NOW.',
      'ZONING IS NOT AMBIGUOUS. THAT COUNCILMAN WAS AMBIGUOUS.',
      'PER MY LAST ANNOUNCEMENT, PLEASE SEE MY PREVIOUS ANNOUNCEMENT.',
      'THE SNOW PLOW LEADERBOARD IS NOT AN OFFICIAL CITY DOCUMENT. IMPRESSIVE, THOUGH.',
    ],
    replies: [
      "I'LL NEED THAT IN WRITING. TRIPLICATE.",
      "THERE'S A FORM FOR THAT. THERE'S A FORM FOR EVERYTHING.",
      'NOTED. FILED. SCHEDULED FOR REVIEW IN Q3.',
      'THAT REQUIRES A PERMIT, BUT I ADMIRE THE INITIATIVE.',
      'PUBLIC COMMENT IS NOW OPEN ON WHATEVER THAT WAS.',
      'APPROVED, PENDING NOTHING. ENJOY.',
    ] },
  { n: 'JIM', c: 0xc9a44a,
    lines: [
      "THE PILOT SAYS WE'RE FINE. THE PILOT ALWAYS SAYS WE'RE FINE.",
      'I GOT THE SHOT. I ALWAYS GET THE SHOT. AT WHAT COST, THOUGH.',
      'EVERY TIME THE CHOPPER RESPAWNS, A LITTLE PIECE OF ME RESPAWNS WITH IT.',
      'ZOOM IN, JIM. ZOOM OUT, JIM. HOLD IT STEADY WHILE WE SPIN, JIM.',
      'I FILMED THE RIBBON CUTTING. FROM INSIDE THE EXPLOSION.',
      'THE NEW GUY HAS A PARACHUTE. I HAVE EXPERIENCE. AND A DENTED HELMET.',
      "IF YOU SEE THE CHOPPER LOW OVER CITY HALL... NO YOU DIDN'T.",
      'SOMEBODY SHOT US DOWN IN 13 SECONDS ONCE. I RESPECT IT. I FEAR IT.',
      "B-ROLL OF THE HORSE FARMS CALMS ME DOWN. DON'T TELL THE DESK.",
      'MY THERAPIST SAID AVOID ROTATING ENVIRONMENTS. THE PILOT SAID 10 MINUTES TO AIR.',
    ],
    replies: [
      'GREAT. GREAT. IS THE CHOPPER UP RIGHT NOW? BE HONEST.',
      'I GOT THAT ON CAMERA. I GET EVERYTHING ON CAMERA.',
      "STAY OFF THE LANDING PAD AND WE'LL ALL BE FINE.",
      "THAT'S EXACTLY WHAT THE PILOT SAID BEFORE THE THING.",
      'COPY. FRAMING IT NOW. HANDS ONLY SHAKING A LITTLE.',
      "TELL MY STORY. WAIT. I'M STILL HERE. GOOD.",
    ] },
  { n: 'PARKING LOTT', c: 0x39404a,
    lines: [
      'PICTURE THIS: THAT PARK, BUT FLAT, AND YOU PAY ME EIGHT DOLLARS.',
      'DOWNTOWN IS 40 PERCENT PARKING. WE CAN GET TO 60. BELIEVE.',
      'EVERY GREAT CITY IS JUST LOTS WAITING TO HAPPEN.',
      'THE COURTHOUSE? GORGEOUS. TERRIBLE TURNING RADIUS. I HAVE IDEAS.',
      "THEY SAY I CAN'T PAVE THE QUAD. THEY SAID THAT ABOUT THE LAST THREE QUADS TOO.",
      'STRIPING IS AN ART FORM. I AM BASICALLY A PAINTER.',
      'A HORSE TOOK MY SPOT ON LIMESTONE TODAY. VALID PERMIT. NOTHING I COULD DO.',
      'THE DATA CENTER FELL THROUGH, BUT THE PARKING FOR IT? STILL AVAILABLE.',
      "GRASS IS JUST PARKING THAT HASN'T MET ME YET.",
      'I DREAM IN 90-DEGREE ANGLES AND PAY STATIONS.',
    ],
    replies: [
      'GREAT POINT. HAVE YOU CONSIDERED PARKING ON IT?',
      'I CAN PAVE THAT BY TUESDAY.',
      "THAT'S ZONED GREEN SPACE. FOR NOW.",
      'FIRST HOUR FREE IF YOU DROP THIS SUBJECT.',
      'YOU SOUND LIKE SOMEBODY WHO APPRECIATES A CLEAN STRIPE.',
      "EVERYTHING IS A PARKING LOT IF YOU'RE BRAVE ENOUGH.",
    ] },
  { n: 'MAN O WAR JR', c: 0x8f2f3c,
    lines: [
      "MY RIBBON CUTTING TIME? DON'T WORRY ABOUT IT. WORRY ABOUT YOURS.",
      "I'VE BEATEN EVERY LEADERBOARD IN THIS TOWN. MENTALLY.",
      'RACE ME TO THE COURTHOUSE. FIRST ONE THERE IS ME.',
      'MY GRANDFATHER LOST ONE RACE. I HAVE LOST ZERO. I HAVE ENTERED ZERO.',
      'THE PLOW RECORD IS SOFT. THE PHOTO RECORD IS SOFT. EVERYTHING IS SOFT.',
      'I DID THE HORSE MISSION IN RECORD TIME. THE HORSES ASKED FOR MY AUTOGRAPH.',
      'CARDIO? I AM CARDIO.',
      "SCOREBOARD. THAT'S IT. THAT'S THE LINE. SCOREBOARD.",
    ],
    replies: [
      "BET. FIRST ONE TO RUPP. GO. I'LL CATCH UP.",
      "CUTE TIME. MINE'S FASTER. TRUST ME.",
      "PUT IT ON THE LEADERBOARD OR IT DIDN'T HAPPEN.",
      'I RESPECT THE HUSTLE. I RESPECT MINE MORE.',
      "THAT'S WHAT SECOND PLACE SOUNDS LIKE.",
    ] },
];
const NPC_NAMES = new Set(PERSONAS.map((p) => p.n.toUpperCase()));

// downtown street grid (mirrors the client's tables)
const EW = [-300, -200, -100, 0, 100, 200];
const NS = [-200, -100, 0, 100, 200];

// pick a line the npc hasn't said recently
function pickLine(npc, list) {
  for (let tries = 0; tries < 8; tries++) {
    const line = list[(Math.random() * list.length) | 0];
    if (!npc.saidRecently.includes(line)) {
      npc.saidRecently.push(line);
      if (npc.saidRecently.length > 4) npc.saidRecently.shift();
      return line;
    }
  }
  return list[(Math.random() * list.length) | 0];
}

function makeNpc(persona, i) {
  const npc = {
    ...persona,
    ws: null, alive: false,
    axis: Math.random() < 0.5 ? 'x' : 'z',
    line: 0, s: 0, side: Math.random() < 0.5 ? -11 : 11,
    dir: Math.random() < 0.5 ? 1 : -1,
    sp: 2 + Math.random() * 3,
    y: 0, vy: 0, ry: 0,
    lastChatAt: 0, saidRecently: [],
    lastHumanAt: 0,
  };
  npc.line = npc.axis === 'x' ? EW[(Math.random() * EW.length) | 0] : NS[(Math.random() * NS.length) | 0];
  npc.s = -150 + Math.random() * 300;
  // Seed the first two NPCs right by the player spawn (x:14, z:-9.5) so a fresh
  // player sees a couple of people moving within the first few seconds. (axis
  // 'x' walks E-W with z = line+side; axis 'z' walks N-S with x = line+side.)
  if (i === 0) { npc.axis = 'x'; npc.line = 0; npc.side = -11; npc.s = 14; npc.dir = 1; }
  else if (i === 1) { npc.axis = 'z'; npc.line = 0; npc.side = 11; npc.s = -9.5; npc.dir = -1; }
  return npc;
}
const npcs = PERSONAS.slice(0, NPC_COUNT).map(makeNpc);

function connect(npc) {
  const ws = new WebSocket(CONNECT_URL);
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
function maybeReply(npc, who, msg) {
  const now = Date.now();
  const mentioned = msg.toUpperCase().includes(npc.n.split(' ')[0]) && npc.n.length > 2;
  if (!mentioned) {
    if (pickResponder(msg) !== npc) return;         // one candidate per message
    if (Math.random() > 0.35) return;               // ...and usually stay quiet
    if (now - lastReplyAt < 25000) return;          // world-wide chat cooldown
  }
  if (now - npc.lastChatAt < 20000) return;
  npc.lastChatAt = now; lastReplyAt = now;
  const line = pickLine(npc, npc.replies);
  setTimeout(() => {
    if (npc.alive) npc.ws.send(JSON.stringify({ t: 'chat', msg: line }));
  }, 1500 + Math.random() * 4000);
}
function ambient() {
  const npc = npcs[(Math.random() * npcs.length) | 0];
  if (!npc.alive) return;
  if (Date.now() - npc.lastHumanAt > 10 * 60e3) return;   // nobody around, stay quiet
  npc.ws.send(JSON.stringify({ t: 'chat', msg: pickLine(npc, npc.lines) }));
}
setInterval(ambient, AMBIENT_MS + Math.random() * AMBIENT_MS * 0.5);

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
console.log(`LEXTOWN NPCs (preset lines, no API): ${npcs.map((n) => n.n).join(', ')} -> ${WS_URL}`);
