#!/usr/bin/env node
// gen-voice.mjs - build the recorded announcement/voice files for Lost in Namba (v20).
//
//   node tools/audio/gen-voice.mjs lines.json --cache <dir> [--limit N] [--only style] [--dry] [--concurrency 4]
//                                              [--out assets/audio/voice] [--manifest assets/audio/manifest.json]
//                                              [--reprocess] [--no-process]
//
// lines.json : [{ key, text, read, style, voices }]
//   key    8 hex digits = voiceKey(text) from js/audio/phrases.js (recomputed; a mismatch is reported)
//   text   caption text; read  the text sent to the speech model (falls back to text)
//   style  pa-station | pa-mall | staff | passerby
//   voices number of variants wanted (1..n, default 1); or an array of voice names; or "all"
//
// Step 1 (network, only for variants whose raw file is not in --cache): POST to the AI gateway with curl.
// Step 2 (local, ffmpeg): raw -> mono, 80 Hz high-pass, silence trimmed (60 ms head / 150 ms tail), one linear
//         gain to -19 LUFS (ebur128 on a copy tiled to >= 2 s), peak limiter at -3 dBFS, 44.1 kHz, MP3 56 kbps CBR.
// Step 3: rebuild the "voice" section of manifest.json from the mp3 files present ("loops" is kept as is).
//
// No npm dependencies. Needs `curl` and `ffmpeg` on PATH. The gateway key comes from AI_GATEWAY_API_KEY (default "dummy").
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..'); // namba-demo/
const { voiceKey } = await import(pathToFileURL(path.join(ROOT, 'js/audio/phrases.js')).href);

// ---- configuration -----------------------------------------------------------------------------------------
const ENDPOINT = 'https://ai-gateway.vercel.sh/v4/ai/speech-model';
const MODEL = 'google/gemini-3.8-flash-tts';
const LANGUAGE = 'ja';
const TARGET_LUFS = -19; // integrated loudness of every clip
const LIMIT_DBFS = -3; // sample-peak ceiling before MP3 (keeps true peak of the MP3 under -2 dBTP)
const HEAD_S = 0.06, TAIL_S = 0.15; // silence left around the speech
const SILENCE_DBFS = -50; // frame RMS under this counts as silence (10 ms frames, after the 80 Hz high-pass)
const MP3_BITRATE = '56k';
const SR = 44100;

// this exact text produced the sample the owner chose; do not edit
const PA_STATION = 'A Japanese railway station platform announcement in standard Japanese. Young female announcer with a bright, clear, high-pitched, slightly cute voice, like an anime-style station announcement. Very polite, very even measured pace, crisp pauses at each comma, smiling tone. No added words.';
const STYLES = {
  'pa-station': { voices: ['Zephyr'], instructions: PA_STATION },
  'pa-mall': {
    voices: ['Zephyr'],
    instructions: 'A Japanese department store / shopping mall floor announcement in standard Japanese. Young female announcer with the same bright, clear, high-pitched, slightly cute voice as a railway station announcement, but a little softer and warmer. Very polite, very even measured pace, crisp pauses at each comma, smiling tone. No added words.',
  },
  staff: {
    voices: ['Zephyr', 'Leda'],
    instructions: 'A shop or restaurant staff member in Japan calling out a short greeting to customers, cheerful and natural, not an announcement. No added words.',
  },
  passerby: {
    voices: ['Leda', 'Puck', 'Aoede'],
    instructions: 'An ordinary person in a crowd in Japan saying a short polite phrase in passing, quiet and natural. No added words.',
  },
};
const SUFFIX = ['', '_b', '_c'];

// ---- args -------------------------------------------------------------------------------------------------
function parseArgs(argv) {
  const a = { _: [], concurrency: 4 };
  for (let i = 0; i < argv.length; i++) {
    const s = argv[i];
    if (s === '--dry') a.dry = true;
    else if (s === '--reprocess') a.reprocess = true;
    else if (s === '--no-process') a.noProcess = true;
    else if (['--cache', '--limit', '--only', '--concurrency', '--out', '--manifest'].includes(s)) a[s.slice(2)] = argv[++i];
    else if (s.startsWith('--')) throw new Error('unknown option ' + s);
    else a._.push(s);
  }
  a.concurrency = Math.max(1, parseInt(a.concurrency, 10) || 4);
  a.limit = a.limit === undefined ? Infinity : parseInt(a.limit, 10);
  return a;
}

// ---- helpers ----------------------------------------------------------------------------------------------
const run = (cmd, args, opts = {}) => new Promise((res, rej) => {
  const p = execFile(cmd, args, { maxBuffer: 1 << 28, encoding: opts.binary ? 'buffer' : 'utf8', ...opts }, (e, so, se) => {
    if (e) { e.stderr = String(se); rej(e); } else res({ stdout: so, stderr: String(se) });
  });
  if (opts.input) p.stdin.end(opts.input);
});

// ffmpeg with raw f32le mono 44.1 kHz on stdin
function ffmpegStdin(args, pcm) {
  return new Promise((res, rej) => {
    const p = spawn('ffmpeg', ['-v', 'error', '-nostats', ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [], err = [];
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', (d) => err.push(d));
    p.on('error', rej);
    p.on('close', (c) => (c === 0 ? res({ stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString() }) : rej(new Error('ffmpeg failed: ' + Buffer.concat(err).toString().slice(0, 400)))));
    p.stdin.on('error', () => {});
    p.stdin.end(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
  });
}

async function decodeToPcm(file, hp = true) {
  // mono 44.1 kHz float, 80 Hz high-pass (2nd order)
  const { stdout } = await run('ffmpeg', ['-v', 'error', '-i', file, ...(hp ? ['-af', 'highpass=f=80'] : []), '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { binary: true });
  const b = stdout;
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength - (b.byteLength % 4)));
}

// first / last 10 ms frame whose RMS is above the silence threshold
function speechBounds(x) {
  const N = Math.round(SR * 0.01), thr = Math.pow(10, SILENCE_DBFS / 20);
  const nf = Math.floor(x.length / N);
  let first = -1, last = -1;
  for (let f = 0; f < nf; f++) {
    let s = 0;
    for (let i = f * N; i < (f + 1) * N; i++) s += x[i] * x[i];
    if (Math.sqrt(s / N) > thr) { if (first < 0) first = f; last = f; }
  }
  if (first < 0) return null;
  return [first * N, (last + 1) * N];
}

async function measureLufs(pcm) {
  // gated integrated loudness is undefined under 400 ms and unreliable under ~1 s: measure a tiled copy (>= 2 s)
  const reps = Math.max(1, Math.ceil((2 * SR) / pcm.length));
  const t = new Float32Array(pcm.length * reps);
  for (let r = 0; r < reps; r++) t.set(pcm, r * pcm.length);
  const { stderr } = await ffmpegStdin(['-v', 'info', '-nostats', '-f', 'f32le', '-ar', String(SR), '-ac', '1', '-i', '-', '-af', 'ebur128=peak=true', '-f', 'null', '-'], t);
  const s = stderr.slice(stderr.lastIndexOf('Summary'));
  const m = /I:\s+(-?[\d.]+) LUFS/.exec(s);
  return m ? parseFloat(m[1]) : null;
}

// raw gateway audio -> final mp3. Returns {seconds, gainDb, lufsBefore, speechSeconds}
export async function processRaw(rawFile, mp3File) {
  let pcm = await decodeToPcm(rawFile);
  const b = speechBounds(pcm);
  if (!b) throw new Error('no speech found (silent audio): ' + rawFile);
  const head = Math.round(HEAD_S * SR), tail = Math.round(TAIL_S * SR);
  // keep real samples where there are enough, otherwise pad with digital silence
  const lo = Math.max(0, b[0] - head), hi = Math.min(pcm.length, b[1] + tail);
  const trimmed = new Float32Array(head + (b[1] - b[0]) + tail);
  trimmed.set(pcm.subarray(lo, hi), head - (b[0] - lo));
  // the 10 ms-frame bound can clip a soft consonant onset: leave it (head is 60 ms of quiet)
  const speech = trimmed.subarray(head, trimmed.length - tail);
  const I = await measureLufs(speech);
  if (I === null || I < -69) throw new Error('could not measure loudness: ' + rawFile);
  // gain + peak limiter + encode in one ffmpeg chain. The limiter can take loudness back off peaky clips, so the
  // loudness of the encoded result is measured and the gain corrected (up to 3 more tries) until it is within 0.3 LU.
  const lim = Math.pow(10, LIMIT_DBFS / 20);
  fs.mkdirSync(path.dirname(mp3File), { recursive: true });
  const tmp = mp3File + '.tmp.mp3';
  const encode = (g) => ffmpegStdin([
    '-f', 'f32le', '-ar', String(SR), '-ac', '1', '-i', '-',
    '-af', `volume=${g.toFixed(3)}dB,alimiter=limit=${lim.toFixed(4)}:attack=2:release=40:level=disabled`,
    '-c:a', 'libmp3lame', '-b:a', MP3_BITRATE, '-abr', '0', '-ar', String(SR), '-ac', '1',
    '-map_metadata', '-1', '-id3v2_version', '0', '-write_id3v1', '0', '-y', tmp,
  ], trimmed);
  let gainDb = TARGET_LUFS - I, outLufs = null;
  for (let it = 0; it < 4; it++) {
    await encode(gainDb);
    const dec = await decodeToPcm(tmp, false);
    outLufs = await measureLufs(dec.subarray(head, dec.length - tail));
    const err = TARGET_LUFS - outLufs;
    if (Math.abs(err) < 0.3 || it === 3) break;
    gainDb += err;
  }
  fs.renameSync(tmp, mp3File);
  return { seconds: trimmed.length / SR, gainDb, lufsBefore: I, lufsOut: outLufs, speechSeconds: speech.length / SR };
}

// decoded length of an mp3 (ffmpeg honours the LAME/Xing gapless info, like Chrome does)
async function mp3Seconds(file) {
  const { stdout } = await run('ffmpeg', ['-v', 'error', '-i', file, '-f', 's16le', '-ac', '1', '-ar', String(SR), '-'], { binary: true });
  return stdout.length / 2 / SR;
}

// ---- gateway request --------------------------------------------------------------------------------------
async function requestSpeech({ read, voice, instructions }) {
  const body = JSON.stringify({ text: read, voice, instructions, language: LANGUAGE });
  const tmp = path.join(fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'genvoice-')), 'body.json');
  fs.writeFileSync(tmp, body);
  try {
    const { stdout } = await run('curl', [
      '-sS', '-m', '120', ENDPOINT,
      '-H', 'Authorization: Bearer ' + (process.env.AI_GATEWAY_API_KEY || 'dummy'),
      '-H', 'ai-gateway-auth-method: api-key',
      '-H', 'ai-gateway-protocol-version: 0.0.1',
      '-H', 'Content-Type: application/json',
      '-H', 'ai-speech-model-specification-version: 4',
      '-H', 'ai-model-id: ' + MODEL,
      '-d', '@' + tmp, '-w', '\n%{http_code}',
    ]);
    const nl = stdout.lastIndexOf('\n');
    const status = parseInt(stdout.slice(nl + 1), 10);
    const text = stdout.slice(0, nl);
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    if (status !== 200 || !json || !json.audio) {
      const msg = json ? JSON.stringify(json.error || json).slice(0, 400) : text.slice(0, 400);
      return { ok: false, status, message: msg };
    }
    const a = json.audio;
    const b64 = typeof a === 'string' ? a : a.base64;
    const gw = json.providerMetadata && json.providerMetadata.gateway;
    const mime = (json.providerMetadata && json.providerMetadata.google && json.providerMetadata.google.mimeType) || json.mediaType || 'audio/wav';
    return { ok: true, audio: Buffer.from(b64, 'base64'), mime, cost: gw && gw.cost !== undefined ? Number(gw.cost) : null, meta: json.providerMetadata, warnings: json.warnings };
  } finally {
    fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
  }
}

const EXT = { 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/ogg': 'ogg', 'audio/opus': 'opus', 'audio/aac': 'aac', 'audio/flac': 'flac' };

// ---- main -------------------------------------------------------------------------------------------------
function expandVariants(line) {
  const st = STYLES[line.style];
  if (!st) return { error: `unknown style "${line.style}"` };
  let names;
  if (Array.isArray(line.voices)) names = line.voices;
  else {
    const n = line.voices === 'all' ? st.voices.length : Math.max(1, Math.min(st.voices.length, parseInt(line.voices, 10) || 1));
    names = st.voices.slice(0, n);
  }
  if (names.length > SUFFIX.length) names = names.slice(0, SUFFIX.length);
  return { variants: names.map((voice, i) => ({ voice, suffix: SUFFIX[i], instructions: st.instructions })) };
}

function findRaw(cache, name) {
  for (const ext of new Set(Object.values(EXT))) {
    const f = path.join(cache, name + '.' + ext);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

async function writeManifest(manifestFile, voiceDir) {
  let m = { v: 1, voice: {}, loops: {} };
  try { m = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); } catch { /* new file */ }
  const rel = path.relative(path.dirname(manifestFile), voiceDir).split(path.sep).join('/');
  const byKey = {};
  for (const f of fs.existsSync(voiceDir) ? fs.readdirSync(voiceDir).sort() : []) {
    const mm = /^([0-9a-f]{8})(_b|_c)?\.mp3$/.exec(f);
    if (mm) (byKey[mm[1]] ||= []).push(f);
  }
  const voice = {};
  for (const key of Object.keys(byKey).sort()) {
    const files = byKey[key].sort((a, b) => a.length - b.length || (a < b ? -1 : 1)); // key.mp3, key_b.mp3, key_c.mp3
    voice[key] = { f: files.map((f) => `${rel}/${f}`), d: Math.round((await mp3Seconds(path.join(voiceDir, files[0]))) * 100) / 100 };
  }
  const out = { v: m.v || 1, voice, loops: m.loops || {} };
  const vlines = Object.entries(voice).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  const llines = Object.entries(out.loops).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  const text = `{\n  "v": ${out.v},\n  "voice": {${vlines.length ? '\n' + vlines.join(',\n') + '\n  ' : ''}},\n  "loops": {\n${llines.join(',\n')}\n  }\n}\n`;
  JSON.parse(text);
  fs.writeFileSync(manifestFile, text);
  return voice;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = args._[0];
  if (!input) throw new Error('usage: gen-voice.mjs lines.json --cache <dir> [--limit N] [--only style] [--dry] [--concurrency N]');
  if (!args.cache && !args.dry) throw new Error('--cache <dir> is required (a folder outside the repo for the raw responses)');
  const cache = args.cache ? path.resolve(args.cache) : null;
  const outDir = path.resolve(args.out || path.join(ROOT, 'assets/audio/voice'));
  const manifestFile = path.resolve(args.manifest || path.join(ROOT, 'assets/audio/manifest.json'));
  if (cache) fs.mkdirSync(cache, { recursive: true });
  if (cache && !path.relative(path.resolve(ROOT, '..'), cache).startsWith('..')) throw new Error('--cache must be outside the repository: ' + cache);

  const lines = JSON.parse(fs.readFileSync(input, 'utf8'));
  const jobs = []; // one per line variant
  const problems = [];
  const seenKeys = new Set();
  for (const line of lines) {
    if (args.only && line.style !== args.only) continue;
    const key = voiceKey(line.text);
    if (line.key && line.key !== key) problems.push(`key mismatch for "${line.text}": file says ${line.key}, voiceKey() gives ${key} (using ${key})`);
    if (seenKeys.has(key)) continue; // same spoken text twice
    seenKeys.add(key);
    const ex = expandVariants(line);
    if (ex.error) { problems.push(`${key}: ${ex.error}`); continue; }
    for (const v of ex.variants) jobs.push({ key, line, ...v, name: key + v.suffix, read: line.read || line.text });
  }

  const sum = { lines: seenKeys.size, variants: jobs.length, cached: 0, requested: 0, failed: 0, cost: 0, costKnown: 0, rejectedVoices: new Set(), processed: 0 };
  const todo = [];
  for (const j of jobs) {
    j.raw = cache ? findRaw(cache, j.name) : null;
    if (j.raw) sum.cached++; else todo.push(j);
  }

  if (args.dry) {
    const n = Math.min(todo.length, args.limit);
    console.log(`[dry] ${jobs.length} variants over ${seenKeys.size} lines; ${sum.cached} already in cache; ${todo.length} would be requested${Number.isFinite(args.limit) ? ` (limit ${args.limit} -> ${n})` : ''}`);
    todo.slice(0, n).forEach((j, i) => {
      console.log(`[dry] #${i + 1} ${j.name}  style=${j.line.style}  voice=${j.voice}`);
      console.log(`        POST ${ENDPOINT}  model=${MODEL}`);
      console.log(`        body: ${JSON.stringify({ text: j.read, voice: j.voice, instructions: j.instructions, language: LANGUAGE })}`);
    });
    for (const p of problems) console.log('[warn] ' + p);
    return;
  }

  // ---- requests
  const queue = todo.slice(0, args.limit);
  let next = 0;
  async function worker() {
    for (;;) {
      const j = queue[next++];
      if (!j) return;
      let r;
      try { r = await requestSpeech(j); } catch (e) { r = { ok: false, status: 0, message: String(e.message || e).slice(0, 300) }; }
      if (!r.ok) {
        sum.failed++;
        const voiceBad = /voice/i.test(r.message || '');
        if (voiceBad) sum.rejectedVoices.add(j.voice);
        console.log(`[fail] ${j.name} voice=${j.voice} http ${r.status}: ${r.message}${voiceBad ? '  <- voice name rejected, continuing' : ''}`);
        continue;
      }
      const ext = EXT[r.mime.split(';')[0]] || 'bin';
      const rawFile = path.join(cache, `${j.name}.${ext}`);
      fs.writeFileSync(rawFile, r.audio);
      fs.writeFileSync(path.join(cache, `${j.name}.json`), JSON.stringify({ name: j.name, key: j.key, voice: j.voice, style: j.line.style, read: j.read, instructions: j.instructions, model: MODEL, mime: r.mime, cost: r.cost, warnings: r.warnings, providerMetadata: r.meta }, null, 1));
      j.raw = rawFile;
      sum.requested++;
      if (r.cost !== null) { sum.cost += r.cost; sum.costKnown++; }
      console.log(`[ok]   ${j.name} voice=${j.voice} ${r.audio.length} bytes ${r.mime} cost=${r.cost}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(args.concurrency, queue.length || 1) }, worker));

  // ---- post-process
  if (!args.noProcess) {
    fs.mkdirSync(outDir, { recursive: true });
    const todoProc = jobs.filter((j) => j.raw && (args.reprocess || !fs.existsSync(path.join(outDir, j.name + '.mp3')) || fs.statSync(j.raw).mtimeMs > fs.statSync(path.join(outDir, j.name + '.mp3')).mtimeMs));
    let k = 0;
    async function pw() {
      for (;;) {
        const j = todoProc[k++];
        if (!j) return;
        try {
          const r = await processRaw(j.raw, path.join(outDir, j.name + '.mp3'));
          sum.processed++;
          console.log(`[mp3]  ${j.name}.mp3  ${r.seconds.toFixed(2)} s  measured ${r.lufsBefore.toFixed(1)} LUFS -> ${r.lufsOut.toFixed(1)} LUFS out, gain ${r.gainDb >= 0 ? '+' : ''}${r.gainDb.toFixed(1)} dB`);
        } catch (e) { sum.failed++; console.log(`[fail] process ${j.name}: ${e.message}`); }
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, todoProc.length || 1) }, pw));
  }

  // ---- manifest + summary
  const voice = await writeManifest(manifestFile, outDir);
  let bytes = 0;
  for (const f of fs.readdirSync(outDir)) if (f.endsWith('.mp3')) bytes += fs.statSync(path.join(outDir, f)).size;
  let cacheCost = 0;
  if (cache) for (const f of fs.readdirSync(cache)) if (f.endsWith('.json')) { try { const c = JSON.parse(fs.readFileSync(path.join(cache, f), 'utf8')).cost; if (typeof c === 'number') cacheCost += c; } catch { /* skip */ } }
  const skipped = todo.length - queue.length;
  console.log('\n---- summary ----');
  console.log(`lines in input:        ${sum.lines}`);
  console.log(`variants wanted:       ${sum.variants}`);
  console.log(`already cached:        ${sum.cached}`);
  console.log(`new requests made:     ${sum.requested}${skipped > 0 ? `  (${skipped} more not requested because of --limit)` : ''}`);
  console.log(`failed:                ${sum.failed}${sum.rejectedVoices.size ? '  rejected voices: ' + [...sum.rejectedVoices].join(', ') : ''}`);
  console.log(`cost of this run:      ${sum.cost.toFixed(6)} (${sum.costKnown} responses reported a cost)`);
  console.log(`cost of whole cache:   ${cacheCost.toFixed(6)}`);
  console.log(`mp3 files processed:   ${sum.processed}`);
  console.log(`manifest voice keys:   ${Object.keys(voice).length}  (${path.relative(process.cwd(), manifestFile)})`);
  console.log(`voice folder size:     ${bytes} bytes (${(bytes / 1024).toFixed(1)} KiB) in ${outDir}`);
  for (const p of problems) console.log('[warn] ' + p);
  if (sum.failed) process.exitCode = 1;
}

// run only when executed directly (processRaw can be imported by other tools)
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error('error: ' + e.message); process.exit(2); });
}
