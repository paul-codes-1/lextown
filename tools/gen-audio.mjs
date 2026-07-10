#!/usr/bin/env node
// Generates the LEXTOWN audio suite via the ElevenLabs API into web/audio/.
//
//   ELEVENLABS_API_KEY=sk_... node tools/gen-audio.mjs [--force] [--only key1,key2]
//
// Idempotent: existing files are skipped unless --force. Designed voices are
// cached in tools/voices.json (voice ids are not secrets) so re-runs reuse
// them instead of designing new ones. If the API key lacks voices_write the
// script falls back to the stock voice ids in FALLBACK_VOICES.
//
// The game never talks to ElevenLabs — this script bakes MP3s that ship as
// static files. Keep the key out of the repo.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) { console.error('ELEVENLABS_API_KEY is required'); process.exit(1); }

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'web', 'audio');
const VOICES_CACHE = path.join(ROOT, 'tools', 'voices.json');
const FORCE = process.argv.includes('--force');
const onlyArg = process.argv.find((a) => a.startsWith('--only'));
const ONLY = onlyArg ? (onlyArg.split('=')[1] || process.argv[process.argv.indexOf(onlyArg) + 1]).split(',') : null;

const API = 'https://api.elevenlabs.io/v1';
const HDRS = { 'xi-api-key': KEY, 'Content-Type': 'application/json' };

// Stock voices (paulBot podcast voices) used when voice design is not
// permitted by the key.
const FALLBACK_VOICES = {
  dj: '2mIhRGnbSLpdWW5ajMz0',      // HOST_A
  anchor: 'DODLEQrClDo8wCz460ld',  // HOST_B
  caller: '8quEMRkSpwEaWBzHvTLv',  // CALLER
  dispatch: 'q3KniSHytXL7c5BfdHin' // TTS
};

// Voice designs — one radio character each.
const VOICE_DESIGNS = {
  dj: {
    name: 'LEXTOWN DJ BLUE',
    description:
      'Warm, easygoing middle-aged male FM radio DJ with a gentle Kentucky drawl. Smooth, unhurried, smiling delivery, classic drive-time energy.',
    sample:
      "Well hey there, Lexington. You're cruising with Big Blue Radio, one hundred point one. Windows down, banjo up. This next one goes out to everybody stuck at the light on Main — which is all of you. Stay gold, Lextown."
  },
  anchor: {
    name: 'LEXTOWN NEWS ANCHOR',
    description:
      'Crisp, brisk female broadcast news anchor, mid-atlantic accent, authoritative but slightly deadpan, reading local news headlines on AM radio.',
    sample:
      "Good afternoon. You're on News six-thirty, The Block. Our top story: city officials confirm the statue is, in fact, a horse. More on that as it develops. Elsewhere downtown, traffic is moving in formation. Again."
  },
  caller: {
    name: 'LEXTOWN TALK CALLER',
    description:
      'Older man calling into AM talk radio on a bad phone line, slightly confused and excitable, thin telephone-quality voice, rambling.',
    sample:
      "Yeah hi, first time caller, long time — listen. I seen three horses downtown this morning. Three of em. One was standing real still, like a statue? Am I crazy? Hello? Am I on?"
  },
  dispatch: {
    name: 'LEXTOWN DISPATCH',
    description:
      'Calm, dry, professional female emergency dispatcher speaking over a two-way radio, measured and faintly amused, short clipped phrasing.',
    sample:
      'Dispatch to all units, dispatch to all units. Be advised: the gold ring by City Hall is active again. Any available player, walk up and press E on it. Yes, the ring. No, I cannot explain it over the air. Trust me on this one. Dispatch out.'
  }
};

// ---------------------------------------------------------------- assets
const A = [];
const music = (key, prompt, ms) => A.push({ key, kind: 'music', prompt, ms });
const sfx = (key, prompt, secs, loop) => A.push({ key, kind: 'sfx', prompt, secs, loop: !!loop });
const tts = (key, voice, text) => A.push({ key, kind: 'tts', voice, text });

// --- radio: BIG BLUE RADIO 100.1 (music) ---
music('radio_bg_1',
  'Upbeat bluegrass instrumental with lively banjo, fiddle and upright bass. Sunny Kentucky front-porch driving song. No vocals. Loopable.',
  90000);
music('radio_bg_2',
  'Retro synthwave driving instrumental with a subtle country twang guitar lead. Neon city at night, steady confident groove. No vocals. Loopable.',
  90000);
music('radio_bg_3',
  'Playful honky-tonk saloon piano rag with brushed drums and upright bass, trotting horse rhythm, cheerful. No vocals. Loopable.',
  90000);
tts('radio_id_1', 'dj',
  "One hundred point one, W L E X — BIG BLUE RADIO. All killer, no filler, and absolutely no roosters after nine.");
tts('radio_id_2', 'dj',
  "You're cruising LEXTOWN with Big Blue Radio. Windows down, banjo up. Don't make me play the fiddle one again. I'll do it.");

// --- radio: NEWS 630 THE BLOCK (talk) ---
tts('news_id', 'anchor',
  "You're on News six-thirty, THE BLOCK. All Lexington. All the time. Whether it likes it or not.");
tts('news_1', 'anchor',
  "Our top story: City Hall will dedicate a horse statue on the plaza this afternoon. The mayor is expected. The news chopper is expected. Witnesses report a ceremonial rocket launcher is — hold on — also expected.");
tts('news_2', 'anchor',
  "Officials continue to deny the data center rumors in Phoenix Park. In unrelated news, a man with a camera was observed following a sedan at exactly walking speed for forty-five minutes. Police describe the behavior as, quote, probably a mission.");
tts('news_wx', 'anchor',
  "Your Block weather: it is one o'clock. It has been one o'clock for some time. Highs downtown, lows in the fog. If snow starts falling, the city reminds you: the plow does not drive itself.");
tts('news_traffic', 'anchor',
  "Time for traffic, live from the LEX NEWS CHOPPER. Vehicles on Main are moving at the speed limit, in perfect formation, forever. Nobody knows why. Nobody has ever known why. Back to you.");
tts('news_caller', 'caller',
  "Yeah hi, first time caller — listen, I seen three horses downtown. Three! One of em was standing real still like a statue, just, pretending? And a fella chased it with a rope. Am I crazy? Hello? Am I on the air?");

// --- shared ad pool ---
tts('ad_als', 'dj',
  "Al's Bar. North Limestone. The burgers are real, the jukebox is loud, and nobody asks how you got a jetpack. Al's Bar. You'll find it. Or you won't. That's on you.");
tts('ad_park', 'caller',
  "This weekend! Come on down to Thoroughbred Park! We got grass. We got a fence. We got statues of horses and — as of recently — some regular horses. Bring a rope! Thoroughbred Park: East Main at Midland.");
tts('ad_psa', 'dispatch',
  "A message from the Lextown Department of Gravity. Your jetpack fuel gauge is not a suggestion. The ground refills it. The sidewalk enforces it. Rooftops are landable. Sidewalks are sudden. Fly responsibly.");
tts('ad_cars', 'dj',
  "Need a car? See a car? That's basically your car. Just walk up and press E. LEXTOWN CARS: any car, any time. No paperwork, no keys, no questions. LEXTOWN CARS. We are not a dealership. We're barely a concept.");

// --- dispatch VO ---
tts('vo_welcome', 'dispatch',
  'Welcome to Lextown. See the gold ring by City Hall? Go press E on it. Trust me.');

// --- mission stingers ---
sfx('st_start', 'Cinematic mission briefing stinger, rising brass hit with a tight tension drum roll, punchy ending', 3.5);
sfx('st_win', 'Short triumphant retro video game victory fanfare with brass and bright chimes', 4);
sfx('st_fail', 'Comedic sad trombone, wah wah wah waaah, failure jingle', 3.5);

// --- ambience loops ---
sfx('amb_birds', 'Gentle city park ambience, songbirds chirping, light breeze through leaves, seamless loop', 15, true);
sfx('amb_hum', 'Distant downtown traffic ambience, low city hum with an occasional passing car, seamless loop', 15, true);
sfx('amb_wind', 'Cold winter wind blowing with light snow hiss, storm ambience, seamless loop', 12, true);
sfx('amb_bells', 'Church bell tower slowly tolling three times, heard from a city street, with decay', 9);

// --- world SFX ---
sfx('sfx_whinny', 'Single loud horse whinny outdoors', 2.5);
sfx('sfx_gallop', 'Horse galloping on grass, rhythmic hoofbeats, seamless loop', 6, true);
sfx('sfx_door', 'Car door opens then shuts firmly', 1.8);
sfx('sfx_engine', 'Compact car engine cranks and starts, settles to an idle', 3);
sfx('sfx_static', 'Brief burst of radio static while tuning between stations', 0.8);

// ---------------------------------------------------------------- helpers
async function call(url, body, label){
  const res = await fetch(url, { method: 'POST', headers: HDRS, body: JSON.stringify(body) });
  if (!res.ok){
    const txt = await res.text();
    throw new Error(`${label}: HTTP ${res.status} ${txt.slice(0, 300)}`);
  }
  return res;
}

async function ensureVoices(){
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(VOICES_CACHE, 'utf8')); } catch {}
  for (const [role, d] of Object.entries(VOICE_DESIGNS)){
    if (cache[role]) continue;
    try {
      const design = await call(`${API}/text-to-voice/design`, {
        voice_description: d.description,
        text: d.sample,
        model_id: 'eleven_multilingual_ttv_v2'
      }, `design ${role}`).then((r) => r.json());
      const preview = design.previews && design.previews[0];
      if (!preview) throw new Error('no previews returned');
      const created = await call(`${API}/text-to-voice`, {
        voice_name: d.name,
        voice_description: d.description,
        generated_voice_id: preview.generated_voice_id
      }, `create ${role}`).then((r) => r.json());
      cache[role] = created.voice_id;
      console.log(`voice ${role}: designed -> ${created.voice_id}`);
    } catch (e){
      console.warn(`voice ${role}: design failed (${e.message.slice(0, 140)}) — using fallback`);
      cache[role] = FALLBACK_VOICES[role];
    }
    fs.writeFileSync(VOICES_CACHE, JSON.stringify(cache, null, 2) + '\n');
  }
  return cache;
}

async function genOne(a, voices){
  const file = path.join(OUT, a.key + '.mp3');
  if (!FORCE && fs.existsSync(file)){ console.log(`skip ${a.key} (exists)`); return; }
  let res;
  if (a.kind === 'music'){
    res = await call(`${API}/music?output_format=mp3_44100_96`,
      { prompt: a.prompt, music_length_ms: a.ms }, a.key);
  } else if (a.kind === 'sfx'){
    const body = { text: a.prompt, duration_seconds: a.secs };
    if (a.loop) body.loop = true;
    try {
      res = await call(`${API}/sound-generation?output_format=mp3_44100_96`, body, a.key);
    } catch (e){
      if (a.loop){ delete body.loop; res = await call(`${API}/sound-generation?output_format=mp3_44100_96`, body, a.key); }
      else throw e;
    }
  } else {
    res = await call(`${API}/text-to-speech/${voices[a.voice]}?output_format=mp3_44100_96`, {
      text: a.text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.35 }
    }, a.key);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(file, buf);
  console.log(`gen  ${a.key}.mp3  ${(buf.length / 1024).toFixed(0)} KB`);
}

fs.mkdirSync(OUT, { recursive: true });
const voices = await ensureVoices();
let failed = 0;
for (const a of A){
  if (ONLY && !ONLY.includes(a.key)) continue;
  try { await genOne(a, voices); }
  catch (e){ failed++; console.error(`FAIL ${a.key}: ${e.message}`); }
}
const total = fs.readdirSync(OUT).filter((f) => f.endsWith('.mp3'))
  .reduce((s, f) => s + fs.statSync(path.join(OUT, f)).size, 0);
console.log(`done. web/audio total ${(total / 1048576).toFixed(1)} MB${failed ? `, ${failed} FAILED` : ''}`);
