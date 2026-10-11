// Audio level probe (v11): per zone, legacy (v10) vs current mix in the SAME page at the SAME crowd density.
//   node tools/audioprobe.mjs [--zones start,nankai_gate,...] [--out file.json] [--ff 300]
// For each zone: bus RMS (dBFS, analyser taps on each bus.vol, master and the limiter) between announcements ("bed"), then
// while a PA line is "spoken" (stubbed ja voice: the speech phase only, first 1.2 s excluded), once for a train line (where a
// platform is clearly audible) and once for the zone's own area notice (forced). "legacy" = the v10 constants (no bus trim,
// PA_DUCK -12/-12/-9 dB), switched at runtime through the exported BUS_TRIM / PA_DUCK objects.
// --ff N: fast-forwards N game-seconds per zone through ambience.update + announcer.update (synchronous speech stub) and
// reports how many lines start, when, and which (area-PA cadence; transit train lines are not simulated there).
// speechSynthesis itself is outside Web Audio and cannot be measured: the volume handed to it is logged instead.
// NOTE: under machine load the game runs at a few fps and announcer time (dt capped 0.25/frame) lags wall time, so every wait
// below is on state (announcer idle / speaking), not on wall seconds.
import { chromium } from 'playwright';
import { acquireSlot } from './slot.mjs';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => { if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]); return a; }, []));
const root = args.root ? path.resolve(args.root) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const zones = (args.zones || 'start,nankai_gate,midosuji,city_1f,city_2f,canyon').split(',');
const port = 8000 + Math.floor(Math.random() * 900);
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 600));
const release = await acquireSlot('audioprobe');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errs = [];
page.on('console', m => { if (m.type() === 'error' && !/ERR_CERT|fonts\.g/.test(m.text())) errs.push(m.text().slice(0, 200)); });
page.on('pageerror', e => errs.push('pageerror ' + e.message));
await page.goto(`http://127.0.0.1:${port}/index.html?test&quality=low&play`);
await page.waitForFunction(() => window.__namba && window.__namba.ready, null, { timeout: 1800000 });
console.log('ready');
await page.evaluate(async () => {
  const n = window.__namba, a = n.audio, m = a.mixer, ac = a.ac;
  n.engine.render = () => {};            // audio sim only
  if (n.start) n.start();
  a.resume();
  const P = window.__probe = { taps: {}, acc: null, gate: null, fired: [], starts: [] };
  const tap = (name, node) => { const an = ac.createAnalyser(); an.fftSize = 2048; node.connect(an); P.taps[name] = { an, buf: new Float32Array(2048) }; };
  for (const b of ['ambience', 'music', 'sfx', 'voice']) tap(b, m.bus[b].vol);
  tap('master', m.master); tap('out', m.lim);
  P.sample = () => {
    if (!P.acc || (P.gate && !P.gate())) return;
    for (const k in P.taps) {
      const t = P.taps[k]; t.an.getFloatTimeDomainData(t.buf);
      let s = 0, pk = 0; for (const v of t.buf) { s += v * v; if (Math.abs(v) > pk) pk = Math.abs(v); }
      const a2 = P.acc[k] || (P.acc[k] = { sum: 0, n: 0, pk: 0 });
      a2.sum += s / t.buf.length; a2.n++; a2.pk = Math.max(a2.pk, pk);
    }
  };
  setInterval(P.sample, 60);
  P.begin = (gate) => { P.acc = {}; P.gate = gate || null; };
  P.end = () => { const o = {}; for (const k in P.acc) { const v = P.acc[k]; o[k] = { rms: +(10 * Math.log10(Math.max(1e-12, v.sum / Math.max(1, v.n)))).toFixed(1), pk: +(20 * Math.log10(Math.max(1e-6, v.pk))).toFixed(1), n: v.n }; } P.acc = null; P.gate = null; return o; };
  window.SpeechSynthesisUtterance = function (t) { this.text = t; };
  const an = a.announcer;
  P.ff = false;
  an.speech = { speak(u) { P.fired.push({ vol: u.volume }); if (P.ff) { u.onstart && u.onstart(); u.onend && u.onend(); return; } setTimeout(() => u.onstart && u.onstart(), 100); setTimeout(() => u.onend && u.onend(), 5000); }, cancel() {}, pause() {}, resume() {}, getVoices() { return []; }, addEventListener() {} };
  an.voices.ja = { name: 'stub-ja', lang: 'ja-JP' };
  an.unlock = () => {};
  const st = an._start.bind(an); an._start = (it) => { P.starts.push({ t: +an.t.toFixed(1), kind: it.kind, ja: (it.parts[0] || {}).text.slice(0, 16), pa: !!it.pa, platform: !!it.platform }); st(it); };
  const mm = await import('./js/audio/mixer.js'), aa = await import('./js/audio/announcer.js');
  const NEW = { trim: { ...mm.BUS_TRIM }, duck: { ...aa.PA_DUCK } };
  P.setLegacy = (on) => {
    if (on) { mm.BUS_TRIM.ambience = 1; mm.BUS_TRIM.music = 1; Object.assign(aa.PA_DUCK, { ambience: 0.25, music: 0.25, sfx: 0.355 }); }
    else { Object.assign(mm.BUS_TRIM, NEW.trim); Object.assign(aa.PA_DUCK, NEW.duck); }
    for (const b of ['music', 'sfx', 'voice', 'ambience', 'master']) m.setVolume(b, m.volumes[b]);
  };
  P.idle = async (maxMs = 150000) => {
    const t0 = performance.now();
    while (performance.now() - t0 < maxMs) { if (!an.cur && !an.queue.length && an.duck > 0.97 && an.t - (an.lastEnd ?? -99) > 7.5) return true; await new Promise(r => setTimeout(r, 200)); }
    return false;
  };
});
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const results = {};
const f = (o) => o ? `${o.rms}` : '-';
for (const z of zones) {
  await page.evaluate((z) => { window.__namba.teleport(z); }, z);
  for (let i = 0; i < 60; i++) { await sleep(1000); const ld = await page.evaluate(() => window.__namba.audio.ambience.debug().loading.length); if (i >= 12 && !ld) break; }
  const info = await page.evaluate(() => { const d = window.__namba.audio.debug(); return { area: d.zone.area, mood: d.zone.mood, ppl: d.people }; });
  results[z] = { info };
  for (const cfg of ['legacy', 'v11']) {
    await page.evaluate((cfg) => window.__probe.setLegacy(cfg === 'legacy'), cfg);
    await sleep(2500);
    await page.evaluate(() => window.__probe.begin()); await sleep(6000);
    const bed = await page.evaluate(() => window.__probe.end());
    const run = async (mode) => page.evaluate(async (mode) => {
      const n = window.__namba, a = n.audio, P = window.__probe, an = a.announcer;
      if (!(await P.idle())) return { err: 'announcer never idle' };
      P.fired.length = 0; P.starts.length = 0;
      let gain = null;
      if (mode === 'train') { const r = a.testPA(); if (!r || r.gain < 0.3) { an.cancelKind('train'); return null; } gain = r.gain; }
      else a.ambience.timers.pa = 0;
      // wait for the line to start (area notices need idle + the mood weights), then sample only the speech phase
      const t0 = performance.now(); const duck = { amb: 1, sfx: 1 }; let uStart = null; let begun = false;
      while (performance.now() - t0 < 120000) {
        await new Promise(r => setTimeout(r, 50));
        duck.amb = Math.min(duck.amb, an.duck); duck.sfx = Math.min(duck.sfx, an.duckSfx);
        if (!begun && an.cur && an.cur.utter) { uStart = performance.now(); begun = true; P.begin(() => performance.now() - uStart > 1500 && an.cur && an.cur.utter); }
        if (begun && !(an.cur && an.cur.utter) && performance.now() - uStart > 1800) break;
      }
      const lv = begun ? P.end() : null;
      return { mode, platformGain: gain, started: P.starts[0] || null, duck, speechVol: P.fired.map(x => +x.vol.toFixed(2)), levels: lv };
    }, mode);
    const train = await run('train');
    const area = await run('area');
    results[z][cfg] = { bed, train, area };
    const sp = (p) => !p ? 'none' : p.err ? p.err : !p.levels ? `no-start (started=${JSON.stringify(p.started)})` : `g=${p.platformGain ?? '-'} duck ${p.duck.amb.toFixed(2)}/${p.duck.sfx.toFixed(2)} | amb ${f(p.levels.ambience)} mus ${f(p.levels.music)} sfx ${f(p.levels.sfx)} chime/voice ${f(p.levels.voice)} peak ${p.levels.out.pk} speechVol ${p.speechVol.join(',')}`;
    console.log(`${z.padEnd(12)} ${cfg.padEnd(6)} ${info.area}/${info.mood} ppl ${info.ppl} | BED amb ${f(bed.ambience)} mus ${f(bed.music)} sfx ${f(bed.sfx)} master ${f(bed.master)} peak ${bed.out.pk}\n    TRAIN ${sp(train)}\n    AREA  ${sp(area)}`);
  }
}
if (args.ff) {
  // fast-forward: area-PA cadence per zone (synchronous speech), v11 constants
  await page.evaluate(() => window.__probe.setLegacy(false));
  results.ff = {};
  for (const z of zones) {
    await page.evaluate((z) => window.__namba.teleport(z), z);
    await sleep(3000);
    results.ff[z] = await page.evaluate(async (secs) => {
      const n = window.__namba, a = n.audio, P = window.__probe, an = a.announcer;
      await P.idle(); P.ff = true; P.starts.length = 0;
      const t0 = an.t; let guard = 0;
      while (an.t - t0 < secs && guard++ < 20000) { a.update(0.25); }
      P.ff = false;
      return { mood: a.ambience.mood, starts: P.starts.map(s => ({ ...s, t: +(s.t - t0).toFixed(0) })) };
    }, +args.ff);
    const r = results.ff[z];
    console.log(`ff ${z.padEnd(12)} ${r.mood.padEnd(10)} ${args.ff}s: ${r.starts.length} lines  at ${r.starts.map(s => s.t).join(',')}`);
  }
}
results.errors = errs.concat(await page.evaluate(() => window.__namba.errors.slice()));
console.log('errors', results.errors);
if (args.out) fs.writeFileSync(args.out, JSON.stringify(results, null, 1));
await browser.close(); release(); server.kill();
