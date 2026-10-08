// In-browser boarding probe: steps the crowd sim + renderer by hand at 1/60 s, records near-LOD agents, then shoots a head boarding.
//   node tools/browserprobe.mjs [--root DIR (default namba-demo)] --ramp esc_nk_3_1 --end high --out DIR [--secs 60] [--shots 8] [--every 6] [--q low] [--w 640] [--h 360]
//   writes OUT/rec.json (per-frame rows), OUT/f00.png.. and OUT/shots.json; summarise rec.json by hand (step / yaw rate per serial).
import { chromium } from 'playwright';
import { acquireSlot } from './slot.mjs';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __tooldir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__tooldir, '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => { if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]); return a; }, []));
const root = path.resolve(args.root && args.root !== true ? args.root : ROOT), out = path.resolve(args.out); fs.mkdirSync(out, { recursive: true });
const port = 8000 + Math.floor(Math.random() * 900);
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 700));
const rel = await acquireSlot('browserprobe');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +(args.w || 800), height: +(args.h || 450) } });
const errors = []; page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); }); page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
let result = {};
try {
  await page.goto(`http://127.0.0.1:${port}/index.html?test&quality=${args.q || 'medium'}&time=12:10`);
  await page.waitForFunction(() => window.__namba && window.__namba.ready, null, { timeout: 400000 });
  const rampId = args.ramp || 'esc_nk_3_1', endName = args.end || 'high';
  const pose = await page.evaluate(([rampId, endName]) => {
    const n = window.__namba, sim = n.crowd.sim, R = sim.places.ramps.find(r => r.r.id === rampId);
    const e = R.ends[endName], lv = endName === 'low' ? R.r.lower : R.r.upper;
    // camera 3.6 m outside the end, 1.9 m to the side of the lane axis, looking at the mouth
    const px = -e.dz, pz = e.dx;     // perpendicular
    const cx = e.x + e.dx * 3.4 + px * 2.2, cz = e.z + e.dz * 3.4 + pz * 2.2;
    const tx = e.x + e.dx * 0.2, tz = e.z + e.dz * 0.2;
    const yaw = Math.atan2(-(tx - cx), -(tz - cz));
    return { level: lv, x: cx, z: cz, yaw, pitch: -0.12, end: e, rid: R.ri };
  }, [rampId, endName]);
  await page.evaluate(p => window.__namba.teleport({ level: p.level, x: p.x, z: p.z, yaw: p.yaw, pitch: p.pitch }), pose);
  const f0 = await page.evaluate(() => window.__namba.engine.stats.frame);
  await page.waitForFunction(n => window.__namba.engine.stats.frame >= n, f0 + 25, { timeout: 600000 });
  // freeze the natural loop; step the sim + renderer by hand at 60 Hz
  await page.evaluate(() => {
    const n = window.__namba, C = n.crowd;
    C.update = () => {}; C.lateUpdate = () => {};
    const sim = C.sim, rr = C.renderer;
    window.__rec = []; window.__events = [];
    const prevRamp = new Map();
    window.__stepN = (k, rec, camR, rid, endName) => {
      for (let i = 0; i < k; i++) {
        C._viewer(); sim.update(1 / 60); rr.update(1 / 60);
        const V = sim.viewer;
        if (!rec) continue;
        for (const a of sim.agents) {
          if (!a.alive || !a._slot) continue;
          const d = Math.hypot(a.x - V.x, a.z - V.z); if (d > camR) continue;
          window.__rec.push([a.serial, +sim.time.toFixed(4), +a._rx.toFixed(4), +a._rz.toFixed(4), +a.yaw.toFixed(4), a.ramp, a._ac, a._ap || '', +(a._aw || 0).toFixed(3), +(a.y + (a._dy || 0)).toFixed(4), a.walkLane ? 1 : 0, +(a.boardK === undefined ? 1 : a.boardK).toFixed(2)]);
        }
      }
    };
    // find a head agent about to step on at this ramp end
    window.__findHead = (rid, endName) => {
      for (const a of sim.agents) if (a.alive && a._slot && a.rampNext === rid && a.rampFromLow === (endName === 'low') && a.queueing) {
        const e = sim.places.ramps[rid].ends[endName]; const along = (a.x - e.x) * e.dx + (a.z - e.z) * e.dz;
        if (along < 2.2 && along > 0.2) return { serial: a.serial, along, walk: a.walkLane };
      }
      return null;
    };
    window.__agent = (serial) => { const a = sim.agents.find(b => b.alive && b.serial === serial); return a ? { x: a.x, z: a.z, yaw: a.yaw, ramp: a.ramp, rs: a.rs, ac: a._ac, ap: a._ap, aw: a._aw, spd: a.spd, bk: a.boardK === undefined ? 1 : a.boardK, slot: !!a._slot } : null; };
  });
  // (A) long run, recording every near agent each 1/60 s
  const secs = +(args.secs || 60);
  const t0 = Date.now();
  for (let s = 0; s < secs; s += 5) await page.evaluate(([k, rid, e]) => window.__stepN(k, true, 14, rid, e), [300, pose.rid, endName]);
  console.log(`recorded ${secs}s in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  const rec = await page.evaluate(() => window.__rec); fs.writeFileSync(path.join(out, 'rec.json'), JSON.stringify(rec));
  await page.evaluate(() => { window.__rec = []; });
  // (B) shot sequence: step (not recording) until a head is lined up, then screenshot every 0.1 s
  const nShots = +(args.shots || 12);
  let head = null, tries = 0;
  while (!head && tries++ < 400) { await page.evaluate(([rid, e]) => window.__stepN(15, false, 0, rid, e), [pose.rid, endName]); head = await page.evaluate(([rid, e]) => window.__findHead(rid, e), [pose.rid, endName]); }
  console.log('head', head);
  const shots = [];
  if (head) for (let i = 0; i < nShots; i++) {
    await page.evaluate(() => window.__stepN(0, false)); // no-op
    await page.screenshot({ path: path.join(out, `f${String(i).padStart(2, '0')}.png`), timeout: 240000 });
    shots.push(await page.evaluate(s => window.__agent(s), head.serial));
    await page.evaluate(([k, rid, e]) => window.__stepN(k, false, 0, rid, e), [+(args.every || 6), pose.rid, endName]);
  }
  fs.writeFileSync(path.join(out, 'shots.json'), JSON.stringify({ head, shots }, null, 1));
  const st = await page.evaluate(() => ({ errors: window.__namba.errors.slice(), calls: window.__namba.engine.stats.calls }));
  result = st;
} catch (e) { console.log('HARNESS ERROR', e.message); }
console.log('errors', JSON.stringify(errors.filter(e => !/ERR_CERT|fonts/.test(e))), JSON.stringify(result));
await browser.close(); rel(); server.kill();
