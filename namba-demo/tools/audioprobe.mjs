// Audio level probe (v11): per zone, the RMS (dBFS) of each bus (ambience / music / sfx / voice), the master mix and the
// limiter peak, measured between announcements, then again while a PA line is "spoken" (stubbed ja voice, 3.5 s).
//   node tools/audioprobe.mjs [--zones start,nankai_gate,city_2f] [--out file.json] [--cadence 0]
// Rendering is switched off after load so the audio sim runs at real time. speechSynthesis itself cannot be measured
// (it is outside Web Audio); the speech volume handed to the browser is logged instead.
import { chromium } from 'playwright';
import { acquireSlot } from './slot.mjs';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => { if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]); return a; }, []));
const root = args.root ? path.resolve(args.root) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const zones = (args.zones || 'start,nankai_gate,nankai_2f,city_1f,city_2f,parks_6f,canyon,midosuji').split(',');
const port = 8000 + Math.floor(Math.random() * 900);
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 600));
const release = await acquireSlot('audioprobe');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errs = [];
page.on('console', m => { if (m.type() === 'error' && !/ERR_CERT|fonts\.g/.test(m.text())) errs.push(m.text().slice(0, 200)); });
page.on('pageerror', e => errs.push('pageerror ' + e.message));
await page.goto(`http://127.0.0.1:${port}/index.html?test&quality=medium&play`);
await page.waitForFunction(() => window.__namba && window.__namba.ready, null, { timeout: 1200000 });
console.log('ready');
await page.evaluate(() => {
  const n = window.__namba, a = n.audio, m = a.mixer, ac = a.ac;
  n.engine.render = () => {};            // audio sim only
  if (n.start) n.start();
  a.resume();
  const P = window.__probe = { taps: {}, acc: null, fired: [] };
  const tap = (name, node) => { const an = ac.createAnalyser(); an.fftSize = 2048; node.connect(an); P.taps[name] = { an, buf: new Float32Array(2048) }; };
  for (const b of ['ambience', 'music', 'sfx', 'voice']) tap(b, m.bus[b].vol);
  tap('master', m.master); tap('out', m.lim);
  P.sample = () => {
    if (!P.acc) return;
    for (const k in P.taps) {
      const t = P.taps[k]; t.an.getFloatTimeDomainData(t.buf);
      let s = 0, pk = 0; for (const v of t.buf) { s += v * v; if (Math.abs(v) > pk) pk = Math.abs(v); }
      const a2 = P.acc[k] || (P.acc[k] = { sum: 0, n: 0, pk: 0 });
      a2.sum += s / t.buf.length; a2.n++; a2.pk = Math.max(a2.pk, pk);
    }
  };
  setInterval(P.sample, 90);
  P.begin = () => { P.acc = {}; };
  P.end = () => { const o = {}; for (const k in P.acc) { const v = P.acc[k]; o[k] = { rms: +(10 * Math.log10(Math.max(1e-12, v.sum / Math.max(1, v.n)))).toFixed(1), pk: +(20 * Math.log10(Math.max(1e-6, v.pk))).toFixed(1) }; } P.acc = null; return o; };
  // stub ja voice: starts after 0.1 s, "speaks" for 3.5 s
  window.SpeechSynthesisUtterance = function (t) { this.text = t; };
  const an = a.announcer;
  an.speech = { speak(u) { P.fired.push({ vol: u.volume, text: u.text }); setTimeout(() => u.onstart && u.onstart(), 100); setTimeout(() => u.onend && u.onend(), 3500); }, cancel() {}, pause() {}, resume() {}, getVoices() { return []; }, addEventListener() {} };
  an.voices.ja = { name: 'stub-ja', lang: 'ja-JP' };
  an.unlock = () => {};
  P.events = []; n.events.on('announce', (e) => P.events.push({ t: performance.now() / 1000, kind: e.kind, track: e.track, line: e.line }));
});
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const results = {};
if (args.series) {
  await page.evaluate((z) => window.__namba.teleport(z), args.series);
  await sleep(25000);
  const ser = await page.evaluate(async () => {
    const n = window.__namba, a = n.audio, P = window.__probe, an = a.announcer, out = [];
    const rms = (k) => { const t = P.taps[k]; t.an.getFloatTimeDomainData(t.buf); let s = 0; for (const v of t.buf) s += v * v; return +(10 * Math.log10(Math.max(1e-12, s / t.buf.length))).toFixed(1); };
    const t0 = performance.now(); let said = false;
    await new Promise((res) => { const iv = setInterval(() => {
      const t = (performance.now() - t0) / 1000;
      if (t > 1.5 && !said) { said = true; a.testPA(); }
      out.push({ t: +t.toFixed(1), duck: +an.duck.toFixed(2), dryGain: +a.mixer.bus.ambience.dry.gain.value.toFixed(3), amb: rms('ambience'), sfx: rms('sfx'), voice: rms('voice'), cur: an.cur ? an.cur.kind : null, step: an.cur ? an.cur.step : null });
      if (t > 14) { clearInterval(iv); res(); } }, 500); });
    return out;
  });
  for (const r of ser) console.log(JSON.stringify(r));
}
for (const z of zones) {
  await page.evaluate((z) => { window.__namba.teleport(z); }, z);
  // settle: cross-fade + beds synthesized
  for (let i = 0; i < 40; i++) {
    await sleep(1000);
    const ld = await page.evaluate(() => window.__namba.audio.ambience.debug().loading.length);
    if (i >= 12 && !ld) break;
  }
  const info = await page.evaluate(() => { const d = window.__namba.audio.debug(); return { area: d.zone.area, mood: d.zone.mood, layers: d.layers, ppl: d.people }; });
  await page.evaluate(() => window.__probe.begin()); await sleep(8000);
  const bed = await page.evaluate(() => window.__probe.end());
  // PA 1: a train line (only where a platform is clearly audible); PA 2: the zone's own area notice (forced now)
  const measure = async (mode) => page.evaluate(async (mode) => {
    const n = window.__namba, a = n.audio, P = window.__probe, an = a.announcer, amb = a.ambience;
    P.fired.length = 0;
    let gain = null, ok = false;
    if (mode === 'train') { const r = a.testPA(); if (!r || r.gain < 0.3) { an.cancelKind('train'); return null; } gain = r.gain; ok = true; }
    else { amb.timers.pa = 0; ok = true; }
    const duckMin = { amb: 1, sfx: 1 };
    P.begin();
    const t0 = performance.now(); let started = null;
    await new Promise((res) => { const iv = setInterval(() => {
      duckMin.amb = Math.min(duckMin.amb, an.duck); duckMin.sfx = Math.min(duckMin.sfx, an.duckSfx);
      if (an.cur && started == null) started = an.last && { kind: an.last.kind, ja: an.last.ja.slice(0, 18), vol: an.last.vol, t: +((performance.now() - t0) / 1000).toFixed(1) };
      if (performance.now() - t0 > (mode === 'train' ? 7500 : 12000)) { clearInterval(iv); res(); } }, 80); });
    return { mode, platformGain: gain, started, duck: duckMin, spoke: P.fired.map(f => +f.vol.toFixed(2)), levels: P.end() };
  }, mode);
  const pa = await measure('train');
  await sleep(4000);
  const pa2 = await measure('area');
  await sleep(2500);
  results[z] = { info, bed, pa, pa2 };
  const f = (o) => o ? `${o.rms}` : '-';
  const line = (tag, p) => !p ? `${tag}: none` : `${tag}: g=${p.platformGain ?? '-'} start=${p.started ? p.started.t + 's' : 'NO'} duck amb ${p.duck.amb.toFixed(2)} sfx ${p.duck.sfx.toFixed(2)} | amb ${f(p.levels.ambience)} mus ${f(p.levels.music)} sfx ${f(p.levels.sfx)} chime ${f(p.levels.voice)} out-peak ${p.levels.out.pk} speechVol ${p.spoke.join(',')}`;
  console.log(`${z.padEnd(13)} ${info.area}/${info.mood} ppl ${info.ppl}\n   BED amb ${f(bed.ambience)} mus ${f(bed.music)} sfx ${f(bed.sfx)} master ${f(bed.master)} out-peak ${bed.out.pk}\n   ${line('TRAIN', pa)}\n   ${line('AREA ', pa2)}`);
}
if (args.cadence) {
  // how often does a line actually START (announcer log) while standing in a zone
  results.cadence = {};
  for (const z of (args.cz || 'start,city_2f').split(',')) {
    await page.evaluate((z) => { window.__namba.teleport(z); window.__probe.starts = []; const an = window.__namba.audio.announcer; if (!window.__probe.hooked) { window.__probe.hooked = true; const st = an._start.bind(an); an._start = (it) => { window.__probe.starts.push({ t: +an.t.toFixed(0), kind: it.kind, ja: (it.parts[0] || {}).text.slice(0, 14) }); st(it); }; } }, z);
    await sleep(+args.cadence * 1000);
    results.cadence[z] = await page.evaluate(() => window.__probe.starts);
    console.log('cadence', z, +args.cadence + ' s:', results.cadence[z].length, JSON.stringify(results.cadence[z].map(s => s.t + ':' + s.kind)));
  }
}
results.errors = errs.concat(await page.evaluate(() => window.__namba.errors.slice()));
console.log('errors', results.errors);
if (args.out) fs.writeFileSync(args.out, JSON.stringify(results, null, 1));
await browser.close(); release(); server.kill();
