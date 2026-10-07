// Headless proof for "heads spin": steps the crowd for N seconds of sim time at several spots,
// and for every NEAR (skinned) person samples the head bone's world yaw relative to the body.
//   node tools/headtest.mjs [--secs 20] [--spawns start,nankai_gate,city_2f,walk] [--stress 1]
// Asserts: |head yaw rel. body| never beyond the clamp (+ animation slack), and no |delta| spikes.
// --stress also forces extreme look targets (behind the body, +-pi wrap, huge values) on near agents.
import { chromium } from 'playwright';
import { acquireSlot } from './slot.mjs';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => { if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]); return a; }, []));
const port = 8000 + Math.floor(Math.random() * 900);
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 600));
const releaseSlot = await acquireSlot('headtest');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
let code = 0;
try {
  await page.goto(`http://127.0.0.1:${port}/index.html?test&quality=${args.q || 'high'}&time=12:10`);
  await page.waitForFunction(() => window.__namba && window.__namba.ready, null, { timeout: 300000 });
  const spawns = (args.spawns || 'start,nankai_gate,nankai_2f,city_1f,city_2f,walk,midosuji_gate').split(',');
  const secs = +(args.secs || 20), stress = args.stress != null ? +args.stress : 1;
  const all = [];
  for (const sp of spawns) {
    await page.evaluate(s => window.__namba.teleport(s), sp);
    await page.waitForTimeout(1500);
    await page.evaluate(async () => { const n = window.__namba; for (let i = 0; i < 450; i++) { n.crowd.update(1 / 30); n.crowd.lateUpdate(1 / 30); if (i % 10 === 9) await new Promise(r => setTimeout(r, 4)); } });   // 15 s warm-up: director fills the area
    for (const mode of stress ? [0, 1] : [0]) {
      const res = await page.evaluate(async ({ secs, stress }) => {
        const n = window.__namba, T = n.THREE, R = n.crowd.renderer;
        const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
        const qh = new T.Quaternion(), v = new T.Vector3(), fwdCache = new Map();
        const fwdOf = (variant) => {
          if (!fwdCache.has(variant)) {
            const t = variant.template; t.updateMatrixWorld(true);
            let h = null; t.traverse(o => { if (o.isBone && o.name === 'Head') h = o; });
            const q = new T.Quaternion(); h.getWorldQuaternion(q);
            fwdCache.set(variant, new T.Vector3(0, 0, 1).applyQuaternion(q.invert()));
          }
          return fwdCache.get(variant);
        };
        const dt = 1 / 30, steps = Math.round(secs / dt);
        const last = new Map();   // serial -> {slot, rel}
        const st = { samples: 0, agents: new Set(), maxRel: 0, maxStep: 0, spikes20: 0, spikes45: 0, ramp: 0, queue: 0, turning: 0, near1m: 0, nan: 0, maxPerSecDeg: 0, poses: {} };
        let t = 0;
        for (let i = 0; i < steps; i++) {
          if (stress && R.slots) {   // adversarial look targets on near agents
            for (const s of R.slots) {
              const a = s.agent; if (!a || !a.alive) continue;
              if (((i + a.serial) % 20) === 0) {
                const k = (a.serial + (i / 20 | 0)) % 6;
                a.lookYaw = [3.1, -3.1, 6.5, -9, 1.2, -1.2][k]; a.lookPitch = [0.9, -0.9, 3, 0, 0.3, 0][k]; a.lookT = 0.8;
                if (k === 0 || k === 1) { const V = n.crowd.sim.viewer; n.crowd.sim.lookAt(a, V.x + (k ? 5 : -5), V.z - 1, 0.8); }
              }
            }
          }
          n.crowd.update(dt); n.crowd.lateUpdate(dt); t += dt;
          if (i % 10 === 9) await new Promise(r => setTimeout(r, 4));   // let the flow-field worker answer
          for (const s of R.slots) {
            const a = s.agent; if (!a || !a.alive || !s.root.visible || s.alpha <= 0) continue;
            s.root.updateMatrixWorld(true);
            s.by.Head.getWorldQuaternion(qh);
            v.copy(fwdOf(s.variant)).applyQuaternion(qh);
            const rel = wrap(Math.atan2(-v.x, -v.z) - a.yaw);
            if (!isFinite(rel)) { st.nan++; continue; }
            const p = last.get(a.serial);
            st.samples++; st.agents.add(a.serial);
            const ar = Math.abs(rel); if (ar > st.maxRel) st.maxRel = ar;
            if (a.ramp >= 0) st.ramp++; if (a.queueing) st.queue++;
            if (a._ac) st.poses[a._ac] = (st.poses[a._ac] || 0) + 1;
            if (p && p.slot === s && p.i === i - 1) {
              const d = Math.abs(wrap(rel - p.rel));
              if (d > st.maxStep) st.maxStep = d;
              if (d > 20 * Math.PI / 180) st.spikes20++;
              if (d > 45 * Math.PI / 180) st.spikes45++;
            }
            last.set(a.serial, { slot: s, rel, i });
          }
        }
        const D = 180 / Math.PI;
        return { samples: st.samples, agents: st.agents.size, maxRelDeg: +(st.maxRel * D).toFixed(1), maxStepDeg: +(st.maxStep * D).toFixed(1), maxDegPerSec: +(st.maxStep * D * 30).toFixed(0), spikesOver20: st.spikes20, spikesOver45: st.spikes45, onRamp: st.ramp, queueing: st.queue, nan: st.nan, poses: st.poses };
      }, { secs, stress: mode });
      res.spawn = sp; res.stress = !!mode; all.push(res);
      console.log(JSON.stringify(res));
    }
  }
  const worst = all.reduce((m, r) => ({ rel: Math.max(m.rel, r.maxRelDeg), step: Math.max(m.step, r.maxStepDeg), sp20: m.sp20 + r.spikesOver20, n: m.n + r.samples, nan: m.nan + r.nan }), { rel: 0, step: 0, sp20: 0, n: 0, nan: 0 });
  console.log('TOTAL', JSON.stringify(worst));
  const CLAMP = 70 + 12;   // clamp + animation sway slack (walk / nod clips move the head a little by themselves)
  const ok = worst.rel <= CLAMP && worst.sp20 === 0 && worst.nan === 0 && worst.n > 100;
  console.log(ok ? 'PASS' : 'FAIL', `(max |head yaw rel body| ${worst.rel} deg <= ${CLAMP}, max step ${worst.step} deg/step @30Hz, spikes>20deg: ${worst.sp20}, samples ${worst.n})`);
  if (!ok) code = 1;
} catch (e) { console.log('HARNESS ERROR', e.message); code = 2; }
if (errors.length) console.log('console errors:', [...new Set(errors)].join(' | '));
await browser.close(); releaseSlot(); server.kill();
process.exit(code);
