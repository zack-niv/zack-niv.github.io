// Browser probe (v8): where do boarding NPCs end up relative to the nearest REAL door of the stopped train?
//   node js/npc/doorprobe.mjs [--sec 150] [--out DIR] [--shots 0,3,6,10,15,20] [--teleport start]
// Samples every frame: for each alive agent on a 'board' leg, the lateral distance (along the platform edge) from the nearest door
// of the train standing at its track, taken the first time it crosses the platform edge toward the train ("entry") and at the
// last sample before it vanishes. Prints max / mean / count of entries further than 0.6 m from a door.
import { chromium } from '/home/user/zack-niv.github.io/namba-demo/tools/node_modules/playwright/index.mjs';
import { acquireSlot } from '../../tools/slot.mjs';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => { if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]); return a; }, []));
const root = path.resolve(args.root || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'));
const out = path.resolve(args.out || '/tmp/namba-doorprobe'); fs.mkdirSync(out, { recursive: true });
const SEC = +(args.sec || 150);
const shots = (args.shots || '').split(',').filter(Boolean).map(Number);
const port = 8000 + Math.floor(Math.random() * 900);
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 600));
const release = await acquireSlot('doorprobe');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
try {
  await page.goto(`http://127.0.0.1:${port}/index.html?test&quality=high${args.extra || ''}`);
  await page.waitForFunction(() => window.__namba && window.__namba.ready, null, { timeout: 400000 });
  await page.evaluate(() => {
    const N = window.__namba, S = N.crowd.sim, TR = N.transit;
    const rec = (window.__dp = { ag: {}, t0: S.time, lat: [], log: [] });
    const doorsFor = (T) => {
      const tr = TR.trains.find(t => t.track === T.id && (t.state === 'doors' || t.state === 'stopped' || t.state === 'closing'));
      if (!tr) return null;
      const cfg = TR.cfg[T.id];
      return { cfg, doors: TR._doorList(cfg, tr.svc), tr };
    };
    const sample = () => {
      for (const a of S.agents) {
        if (!a.alive) continue;
        const L = a.legs && a.legs[a.leg];
        if (!L || L.t !== 'board') continue;
        const T = L.T, D = doorsFor(T); if (!D) continue;
        const { cfg, doors } = D;
        const along = cfg.axis === 'z' ? a.z : a.x, cross = cfg.axis === 'z' ? a.x : a.z;
        let best = 1e9, bd = null;
        for (const d of doors) { const l = Math.abs(d.along - along); if (l < best) { best = l; bd = d; } }
        const into = (cfg.edge - cross) * cfg.inward;       // > 0: beyond the platform edge, toward / inside the train
        const r = rec.ag[a.serial] || (rec.ag[a.serial] = { serial: a.serial, track: T.id, line: T.line, entry: null, last: null });
        const s = { form: D.tr.svc.formation, tst: D.tr.state, t: S.time - rec.t0, st: a.st, lat: best, into, car: bd && bd.car, door: bd && bd.door, nDoors: doors.length, fade: a.fadeDir };
        r.last = s;
        if (!r.entry && into > -0.15 && a.st === 2) r.entry = s;
      }
    };
    // no rendering: step the whole game at 30 Hz from here (SwiftShader frames take seconds); screenshots restore the renderer
    window.__render = N.engine.render.bind(N.engine);
    N.engine.render = () => {};
    window.__step = (n) => { for (let i = 0; i < n; i++) { N.tick(1 / 30); sample(); } };
  });
  const t0 = Date.now();
  let si = 0;
  while (true) {
    const st = await page.evaluate(() => ({ t: window.__namba.crowd.sim.time - window.__dp.t0, n: window.__namba.crowd.sim.count }));
    if (si < shots.length && st.t >= shots[si]) { await page.evaluate(() => { window.__namba.engine.render = (dt) => window.__render(dt); }); await page.evaluate(() => window.__step(2)); await page.screenshot({ path: path.join(out, `t${String(shots[si]).padStart(2, "0")}.png`), timeout: 180000 }); await page.evaluate(() => { window.__namba.engine.render = () => {}; }); si++; }
    if (Date.now() - (globalThis.__lp || 0) > 20000) { globalThis.__lp = Date.now(); console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s wall] sim ${st.t.toFixed(1)}s agents ${st.n}`); }
    if (st.t >= SEC) break;
    if (Date.now() - t0 > 3000 * 1000) break;
    await page.evaluate(() => window.__step(30));
  }
  const res = await page.evaluate(() => Object.values(window.__dp.ag).map(r => ({ serial: r.serial, track: r.track, entry: r.entry, last: r.last })));
  // "final" = the last sample of everyone who ended their boarding walk (fade started): that is where they vanish into the train
  const fin = res.filter(r => r.last && r.last.st === 2 && r.last.fade < 0);
  const lats = fin.map(r => r.last.lat).sort((a, b) => a - b);
  const bad = fin.filter(r => r.last.lat > 0.5);
  const mean = lats.reduce((a, b) => a + b, 0) / Math.max(1, lats.length);
  console.log(`boarding agents seen ${res.length}, finished the walk (vanished into the train) ${fin.length}`);
  console.log(`final lateral distance from nearest real door: max ${(lats[lats.length - 1] || 0).toFixed(2)} m, mean ${mean.toFixed(2)} m, p90 ${(lats[Math.floor(lats.length * 0.9)] || 0).toFixed(2)} m, > 0.5 m (wall): ${bad.length}`);
  const by = {}, byF = {};
  for (const r of bad) { by[r.track] = (by[r.track] || 0) + 1; byF[r.last.form] = (byF[r.last.form] || 0) + 1; }
  console.log('wall boarders by track', JSON.stringify(by), 'by formation', JSON.stringify(byF));
  const allF = {}; for (const r of fin) allF[r.last.form] = (allF[r.last.form] || 0) + 1; console.log('finished by formation', JSON.stringify(allF));
  const ent = res.filter(r => r.entry);
  console.log(`crossed the platform edge: ${ent.length}, edge-time lateral max ${Math.max(0, ...ent.map(r => r.entry.lat)).toFixed(2)} m`);
  const still = res.filter(r => r.last && r.last.st === 2 && r.last.fade >= 0);
  console.log('still walking to a door at the end', still.length);
  fs.writeFileSync(path.join(out, 'doorprobe.json'), JSON.stringify(res, null, 1));
  console.log('errors', JSON.stringify([...new Set(errors)].filter(e => !/ERR_CERT|fonts/.test(e))));
} catch (e) { console.log('HARNESS ERROR', e.message); }
await browser.close(); release(); server.kill();
