// Headless proof for "heads spin": steps the crowd for N seconds of sim time at several spots,
// and for every NEAR (skinned) person samples the head bone's world yaw relative to the body.
//   node tools/headtest.mjs [--secs 20] [--spawns start,nankai_gate,city_2f,walk] [--stress 1]
// For every near person and frame it measures the head bone's world yaw relative to the body twice: with the bones as the
// renderer left them (total) and with the Neck/Head put back to the clean animated pose (clean). Their difference is the
// look turn the renderer applied ("applied"). Asserts: |applied yaw| <= 70 deg, |applied pitch| <= 25 deg, applied yaw
// rate <= 180 deg/s (+tolerance), no NaN; also reports the total head-yaw-vs-body (clean animation can add a few degrees,
// e.g. seated poses) and which clips have constant Neck/Head tracks (the ones the old code made spin).
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
    for (const mode of stress ? [0, 1, 2] : [0]) {
      const res = await page.evaluate(async ({ secs, stress, mode0 }) => {
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
        const clipScan = {};
        for (const g of ['m', 'f']) { const rig = n.crowd.humans && n.crowd.humans.rigs[g]; if (!rig) continue;
          for (const id of Object.keys(rig.clips)) { const c = rig.clips[id]; let st = true, any = false;
            for (const tr of c.tracks) if (/^(Neck|Head)\.quaternion$/.test(tr.name)) { any = true; const v = tr.values, k = 4; for (let i = k; i < v.length; i++) if (Math.abs(v[i] - v[i % k]) > 1e-5) { st = false; break; } }
            clipScan[g + ':' + id] = !any ? 'no-track' : st ? 'CONSTANT' : 'animated'; } }
        const flat = {};   // per clip: share of consecutive 30 fps frame pairs whose Neck and Head values are bit-identical (the mixer then does not rewrite the bones)
        for (const g of ['m']) { const rig = n.crowd.humans && n.crowd.humans.rigs[g]; if (!rig) continue;
          for (const id of Object.keys(rig.clips)) { const c = rig.clips[id]; const trs = c.tracks.filter(tr => /^(Neck|Head)\.quaternion$/.test(tr.name)); if (!trs.length) continue;
            const N = Math.max(2, Math.round(c.duration * 30)); let same = 0; const prev = trs.map(() => null);
            for (let f = 0; f < N; f++) { let eq = true; trs.forEach((tr, k) => { const r = Array.from(tr.createInterpolant().evaluate(c.duration * f / N)); if (!prev[k] || r.some((x, j) => x !== prev[k][j])) eq = false; prev[k] = r; }); if (eq) same++; }
            flat[id] = +(same / N).toFixed(2); } }
        const frame0 = () => n.engine.stats.frame;
        let lastFrame = frame0();
        const qa = new T.Quaternion(), qb = new T.Quaternion(), sv = new T.Quaternion(), sn = new T.Quaternion();
        const yawOf = (s, a) => { s.root.updateMatrixWorld(true); s.by.Head.getWorldQuaternion(qh); v.copy(fwdOf(s.variant)).applyQuaternion(qh); return [wrap(Math.atan2(-v.x, -v.z) - a.yaw), Math.asin(Math.max(-1, Math.min(1, v.y)))]; };
        const last = new Map();   // serial -> {slot, rel}
        const st = { maxPHY: 0, maxPHP: 0, maxPStep: 0, pSpikes: 0, maxApplied: 0, maxAppliedPitch: 0, maxAppStep: 0, appSpikes: 0, appSamples: 0, samples: 0, agents: new Set(), maxRel: 0, maxStep: 0, spikes20: 0, spikes45: 0, ramp: 0, queue: 0, turning: 0, near1m: 0, nan: 0, maxPerSecDeg: 0, poses: {} };
        let t = 0;
        for (let i = 0; i < steps; i++) {
          if (stress && R.slots) {   // adversarial look targets on near agents
            for (const s of R.slots) {
              const a = s.agent; if (!a || !a.alive) continue;
              if (((i + a.serial) % 20) === 0) {
                const k = (a.serial + (i / 20 | 0)) % 6;
                a.lookYaw = [3.1, -3.1, 6.5, -9, 1.2, -1.2][k]; a.lookPitch = stress === 2 ? [0.9, -0.9, 3, 0, 0.3, 0][k] : 0; a.lookT = 0.8;
                if (k === 0 || k === 1) { const V = n.crowd.sim.viewer; n.crowd.sim.lookAt(a, V.x + (k ? 5 : -5), V.z - 1, 0.8); }
              }
            }
          }
          const jumped = frame0() !== lastFrame;   // an engine frame ran between two of our steps (much larger dt): not compared
          n.crowd.update(dt); n.crowd.lateUpdate(dt); t += dt;
          for (const s of R.slots) {
            const a = s.agent; if (!a || !a.alive || !s.root.visible || s.alpha <= 0) continue;
            const [rel, elev] = yawOf(s, a);
            if (!isFinite(rel)) { st.nan++; continue; }
            // clean pose (what the clip alone gives) -> applied look = total - clean
            let applied = 0, appliedP = 0;
            if (s.hClean) {
              sv.copy(s.by.Head.quaternion); sn.copy(s.by.Neck.quaternion);
              s.by.Head.quaternion.copy(s.hClean); s.by.Neck.quaternion.copy(s.nClean);
              const [rc, ec] = yawOf(s, a);
              s.by.Head.quaternion.copy(sv); s.by.Neck.quaternion.copy(sn); s.root.updateMatrixWorld(true);
              applied = wrap(rel - rc); appliedP = elev - ec;
              if (Math.abs(applied) > st.maxApplied) st.maxApplied = Math.abs(applied);
              if (Math.abs(appliedP) > st.maxAppliedPitch) st.maxAppliedPitch = Math.abs(appliedP);
              st.appSamples++;
            }
            const p = last.get(a.serial);
            { const ay = Math.abs(a.pHY), ap = Math.abs(a.pHP); if (ay > st.maxPHY) st.maxPHY = ay; if (ap > st.maxPHP) st.maxPHP = ap; if (p && p.slot === s && p.i === i - 1 && !jumped) { const d = Math.abs(a.pHY - p.pHY); if (d > st.maxPStep) st.maxPStep = d; } }
            st.samples++; st.agents.add(a.serial);
            const ar = Math.abs(rel); if (ar > st.maxRel) st.maxRel = ar;
            if (a.ramp >= 0) st.ramp++; if (a.queueing) st.queue++;
            if (a._ac) st.poses[a._ac] = (st.poses[a._ac] || 0) + 1;
            if (p && p.slot === s && p.i === i - 1 && !jumped) {
              const da = Math.abs(wrap(applied - p.applied));
              if (da > st.maxAppStep) st.maxAppStep = da;
              if (da > 7 * Math.PI / 180) st.appSpikes++;
              const d = Math.abs(wrap(rel - p.rel));
              if (d > st.maxStep) st.maxStep = d;
              if (d > 20 * Math.PI / 180) st.spikes20++;
              if (d > 45 * Math.PI / 180) st.spikes45++;
            }
            last.set(a.serial, { slot: s, rel, i, applied, pHY: a.pHY, skip: jumped });
          }
          lastFrame = frame0();
          if (i % 10 === 9) await new Promise(r => setTimeout(r, 4));   // let the flow-field worker answer (the engine may render a frame here)
        }
        const D = 180 / Math.PI;
        return { clipScan: mode0 ? clipScan : undefined, flatFrameShare: mode0 ? flat : undefined, stateYawMaxDeg: +(st.maxPHY * D).toFixed(1), statePitchMaxDeg: +(st.maxPHP * D).toFixed(1), stateYawStepMaxDeg: +(st.maxPStep * D).toFixed(2), appliedYawMaxDeg: +(st.maxApplied * D).toFixed(1), appliedPitchMaxDeg: +(st.maxAppliedPitch * D).toFixed(1), appliedStepMaxDeg: +(st.maxAppStep * D).toFixed(2), appliedRateMaxDegPerSec: +(st.maxAppStep * D * 30).toFixed(0), appliedSpikes: st.appSpikes, appliedSamples: st.appSamples, samples: st.samples, agents: st.agents.size, maxRelDeg: +(st.maxRel * D).toFixed(1), maxStepDeg: +(st.maxStep * D).toFixed(1), maxDegPerSec: +(st.maxStep * D * 30).toFixed(0), spikesOver20: st.spikes20, spikesOver45: st.spikes45, onRamp: st.ramp, queueing: st.queue, nan: st.nan, poses: st.poses };
      }, { secs, stress: mode, mode0: sp === spawns[0] && !mode });
      res.spawn = sp; res.stress = mode; all.push(res);
      console.log(JSON.stringify(res));
    }

    if (sp === spawns[0] || args.mech) {
      // mechanism probe: replay the OLD behaviour (no clean-pose restore before the mixer => the turn is re-applied on
      // top of the previous frame's turn whenever the clip does not rewrite the bone) next to the fixed behaviour.
      const m = await page.evaluate(async () => {
        const n = window.__namba, T = n.THREE, R = n.crowd.renderer;
        const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
        const qh = new T.Quaternion(), v = new T.Vector3(), tmpl = new Map();
        const yawRel = (s, a) => { s.root.updateMatrixWorld(true); s.by.Head.getWorldQuaternion(qh);
          if (!tmpl.has(s.variant)) { const t = s.variant.template; t.updateMatrixWorld(true); let h; t.traverse(o => { if (o.isBone && o.name === 'Head') h = o; }); const q = new T.Quaternion(); h.getWorldQuaternion(q); tmpl.set(s.variant, new T.Vector3(0, 0, 1).applyQuaternion(q.invert())); }
          v.copy(tmpl.get(s.variant)).applyQuaternion(qh); return wrap(Math.atan2(-v.x, -v.z) - a.yaw) * 180 / Math.PI; };
        const rows = [];
        for (const old of [true, false]) {
          const picks = R.slots.filter(s => s.agent && s.agent.alive && s.root.visible).slice(0, 8);
          const ser = picks.map(s => s.agent.serial), res = [];
          const pre = picks.map(s => yawRel(s, s.agent));
          for (let i = 0; i < 60; i++) {   // 2 s of normal frames with a held look target (34 deg)
            for (const s of picks) { const a = s.agent; if (!a || !a.alive) continue; a.lookYaw = 0.6; a.lookT = 100; a.lookAbs = undefined; if (old) { s.hClean = null; s.nClean = null; } }
            n.crowd.update(1 / 30); n.crowd.lateUpdate(1 / 30);
            if (i % 10 === 9) await new Promise(r => setTimeout(r, 4));
          }
          const settled = picks.map(s => s.agent ? yawRel(s, s.agent) : NaN);
          for (let i = 0; i < 30; i++) {   // then 1 s of frames with dt = 0 (pause menu / duplicate rAF timestamp): the clip time does not move
            for (const s of picks) { const a = s.agent; if (!a || !a.alive) continue; if (old) { s.hClean = null; s.nClean = null; } }
            n.crowd.lateUpdate(0);
          }
          picks.forEach((s, k) => { const a = s.agent; if (a && a.serial === ser[k]) res.push({ clip: a._ac, afterNormalFrames: +settled[k].toFixed(1), afterPausedSecond: +yawRel(s, a).toFixed(1) }); });
          rows.push({ replayOldBehaviour: old, headYawVsBody_lookTarget_34deg: res });
          for (const s of picks) { const a = s.agent; if (a) { a.lookYaw = 0; a.lookT = 0; } }
          for (let i = 0; i < 40; i++) { n.crowd.update(1 / 30); n.crowd.lateUpdate(1 / 30); if (i % 10 === 9) await new Promise(r => setTimeout(r, 4)); }
        }
        return rows;
      });
      console.log('MECHANISM', JSON.stringify(m));
    }
  }
  const W = { natRel: 0, natStep: 0, stRel: 0, stY: 0, stP: 0, stStep: 0, appY: 0, appStepY: 0, appP: 0, appSp: 0, n: 0, agents: 0, nan: 0, ramp: 0, queue: 0 };
  for (const r of all) {
    W.n += r.samples; W.agents += r.agents; W.nan += r.nan; W.ramp += r.onRamp; W.queue += r.queueing;
    W.stY = Math.max(W.stY, r.stateYawMaxDeg); W.stP = Math.max(W.stP, r.statePitchMaxDeg); W.stStep = Math.max(W.stStep, r.stateYawStepMaxDeg);
    if (!r.stress) { W.natRel = Math.max(W.natRel, r.maxRelDeg); W.natStep = Math.max(W.natStep, r.maxStepDeg); }
    else W.stRel = Math.max(W.stRel, r.maxRelDeg);
    if (r.stress !== 2) { W.appY = Math.max(W.appY, r.appliedYawMaxDeg); W.appStepY = Math.max(W.appStepY, r.appliedStepMaxDeg); W.appSp += r.appliedSpikes; }   // yaw-only runs: bone-level check of the yaw clamp / rate
    if (r.stress === 2 || !r.stress) W.appP = Math.max(W.appP, r.appliedPitchMaxDeg);
  }
  console.log('TOTAL', JSON.stringify(W));
  const ok = W.stY <= 70.01 && W.stP <= 25.01 && W.stStep <= 6.01 && W.appY <= 71 && W.appStepY <= 6.6 && W.appSp === 0 && W.appP <= 25.8 && W.nan === 0 && W.n > 1000;
  console.log(ok ? 'PASS' : 'FAIL', `state: |yaw| <= ${W.stY} deg (limit 70), |pitch| <= ${W.stP} (25), yaw step <= ${W.stStep} deg/frame@30Hz = ${(W.stStep * 30).toFixed(0)} deg/s (limit 180); on the bones (yaw-only runs): applied yaw <= ${W.appY} deg, step <= ${W.appStepY} deg/frame, spikes>7deg: ${W.appSp}; applied pitch <= ${W.appP} deg; natural total head-vs-body yaw max ${W.natRel} deg, max natural frame step ${W.natStep} deg; extreme-target runs total max ${W.stRel} deg; samples ${W.n} (${W.ramp} on escalators, ${W.queue} queueing)`);
  if (!ok) code = 1;
} catch (e) { console.log('HARNESS ERROR', e.message); code = 2; }
if (errors.length) console.log('console errors:', [...new Set(errors)].join(' | '));
await browser.close(); releaseSlot(); server.kill();
process.exit(code);
