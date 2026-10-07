// v3 crowd+sound check: (1) the PA speaks Japanese only (stubbed speechSynthesis with a ja and an en voice; then with an en
// voice only => nothing spoken, caption + chime only), caption channels; (2) escalator stand-side: warms the crowd, finds people riding escalators and screenshots them from behind
// (so "right of travel" is the right of the picture). Prints per-lane stats: standers vs walkers and their side.
//   node tools/escshot.mjs [--out notes/v3-shots/crowd] [--n 3]
import { chromium } from 'playwright';
import { acquireSlot } from './slot.mjs';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => { if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]); return a; }, []));
const out = path.resolve(root, args.out || 'notes/v3-shots/crowd'); fs.mkdirSync(out, { recursive: true });
const port = 8000 + Math.floor(Math.random() * 900);
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 600));
const releaseSlot = await acquireSlot('escshot');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
await page.addInitScript(() => {
  const spoken = []; window.__spoken = spoken; window.__voiceMode = 'both';
  const V = { ja: { name: 'Kyoko', lang: 'ja-JP', localService: true }, en: { name: 'Samantha', lang: 'en-US', localService: true } };
  const ss = { getVoices: () => window.__voiceMode === 'both' ? [V.ja, V.en] : window.__voiceMode === 'en' ? [V.en] : [], addEventListener() {}, cancel() {}, pause() {}, resume() {}, speaking: false,
    speak(u) { spoken.push({ lang: u.lang, voice: u.voice && u.voice.name, text: u.text, vol: +(+u.volume).toFixed(2) }); setTimeout(() => u.onstart && u.onstart({}), 5); setTimeout(() => u.onend && u.onend({}), 120); } };
  Object.defineProperty(window, 'speechSynthesis', { value: ss, configurable: true });
  window.SpeechSynthesisUtterance = function (t) { this.text = t; this.volume = 1; this.lang = ''; };
});
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
try {
  await page.goto(`http://127.0.0.1:${port}/index.html?test&quality=medium&time=12:10`);
  await page.waitForFunction(() => window.__namba && window.__namba.ready, null, { timeout: 300000 });
  // ---- (1) speech: Japanese only ----
  const speech = await page.evaluate(async () => {
    const n = window.__namba, A = n.audio, caps = []; n.events.on('caption', c => caps.push({ en: c.en, ja: c.ja, kind: c.kind, channel: c.channel }));
    n.teleport('start'); for (let i = 0; i < 20; i++) A.update(0.2);
    const run = async (mode) => {
      window.__voiceMode = mode; window.__spoken.length = 0; A.announcer.refreshVoices(); caps.length = 0;
      A.say({ ja: 'まもなく、1番線に、関西空港行き、特急ラピートが、まいります。', en: 'The limited express Rapi:t bound for Kansai Airport is now arriving.', kind: 'station', gain: 1 });
      const p = n.player.body;
      A.announcer.say({ kind: 'escalator', parts: [{ lang: 'ja', text: 'エスカレーターをご利用の際は、手すりにおつかまりください。' }, { lang: 'en', text: 'Please hold the handrail.' }], gain: 1, chime: 'esc', caption: true, maxAge: 20 });
      n.events.emit('crowd:excuse', { level: p.level, x: p.x + 1, z: p.z, y: 1.6, ja: 'すみません', en: 'Excuse me', kind: 'commuter' });
      for (let i = 0; i < 150; i++) { A.update(0.1); if (i % 10 === 9) await new Promise(r => setTimeout(r, 5)); }
      return { mode, spoken: window.__spoken.slice(), captions: caps.slice(), ja: A.announcer.debug().ja, en: A.announcer.debug().en, pa: A.debug().pa.last };
    };
    return [await run('both'), await run('en'), await run('none')];
  });
  for (const r of speech) console.log('SPEECH', JSON.stringify({ voices: r.mode, ja: r.ja, en: r.en, spoken: r.spoken, captions: r.captions }));
  const shots = [];
  for (const sp of (args.spawns || 'nankai_2f,nankai_gate,city_1f').split(',')) {
    await page.evaluate(s => window.__namba.teleport(s), sp);
    await page.waitForTimeout(1200);
    const found = await page.evaluate(async () => {
      const n = window.__namba, S = n.crowd.sim;
      for (let i = 0; i < 900; i++) {
        n.crowd.update(1 / 30); n.crowd.lateUpdate(1 / 30);
        if (i % 10 === 9) await new Promise(r => setTimeout(r, 4));
        if (i > 300 && i % 30 === 0) {   // somebody standing on an escalator near the player?
          const p = n.player.body;
          const c = S.agents.filter(a => a.alive && a.ramp >= 0 && S.places.ramps[a.ramp].esc && Math.hypot(a.x - p.x, a.z - p.z) < 60 && a.fade > 0.9);
          if (c.length >= 2) return true;
        }
      }
      return false;
    });
    const info = await page.evaluate(() => {
      const n = window.__namba, S = n.crowd.sim, p = n.player.body;
      const rows = [];
      const riders = S.agents.filter(a => a.alive && a.ramp >= 0 && S.places.ramps[a.ramp].esc && a.fade > 0.9).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
      // per rider: side of travel (+ = right), stander or walker
      for (const a of riders.slice(0, 40)) {
        const R = S.places.ramps[a.ramp]; const sp = Math.hypot(a.vx, a.vz) || 1;
        const tx = a.vx / sp, tz = a.vz / sp;
        // lane centre = rampU stored at boarding (right of travel when facing into the ramp)
        rows.push({ ramp: R.r.id, level: a.level, walk: !!a.walkLane, u: +(a.rampU || 0).toFixed(2), pose: a.pose });
      }
      return rows;
    });
    console.log(sp, 'found riders:', found, JSON.stringify(info.slice(0, 12)));
    const pick = await page.evaluate(() => {
      const n = window.__namba, S = n.crowd.sim, p = n.player.body;
      const R = S.places.ramps;
      const c = S.agents.filter(a => a.alive && a.ramp >= 0 && R[a.ramp].esc && a.fade > 0.9 && !a.walkLane);
      if (!c.length) return null;
      c.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
      const a = c[0], rr = R[a.ramp];
      // direction of travel: from the low end to the high end if going up, else reverse (use the ramp's own geometry)
      const lo = rr.ends.low, hi = rr.ends.high;
      const dirUp = rr.r.move > 0;
      const sx = dirUp ? hi.x - lo.x : lo.x - hi.x, sz = dirUp ? hi.z - lo.z : lo.z - hi.z, sl = Math.hypot(sx, sz) || 1;
      return { x: a.x, z: a.z, level: dirUp ? rr.r.lower : rr.r.upper, tx: sx / sl, tz: sz / sl, id: rr.r.id, move: rr.r.move };
    });
    if (!pick) { console.log(sp, 'no standing rider found'); continue; }
    // stand 4.5 m behind the rider (against the travel direction), camera looking along travel
    const yaw = Math.atan2(-pick.tx, -pick.tz);
    await page.evaluate(({ pick, yaw }) => { window.__namba.teleport({ level: pick.level, x: pick.x - pick.tx * 4.5, z: pick.z - pick.tz * 4.5, yaw, pitch: 0.12 }); }, { pick, yaw });
    await page.waitForTimeout(500);
    const f0 = await page.evaluate(() => window.__namba.engine.stats.frame);
    await page.waitForFunction(n => window.__namba.engine.stats.frame >= n, f0 + 12, { timeout: 300000 });
    const name = `esc_${sp}_${pick.id}.png`;
    await page.screenshot({ path: path.join(out, name), timeout: 180000 });
    console.log('shot', name, 'ramp', pick.id, 'move', pick.move);
    shots.push(name);
  }
} catch (e) { console.log('HARNESS ERROR', e.message); }
if (errors.length) console.log('console errors:', [...new Set(errors)].join(' | '));
await browser.close(); releaseSlot(); server.kill();
