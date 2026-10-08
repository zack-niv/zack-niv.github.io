// Escalator boarding / exit continuity probe (Node, no browser): per-frame step / yaw rate / sideways speed of near agents around ramps.
//   node tools/boardprobe.mjs [--js DIR (default ../js; point at an older copy of js/ to compare)] [--spawn nankai_gate] [--secs 150] [--seed 1] [--hz 60] [--trace out.json] [--dbg 1]
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const __tooldir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__tooldir, '..');
const argv = process.argv.slice(2);
const args = Object.fromEntries(argv.reduce((a, v, i, arr) => { if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]); return a; }, []));
const JS = path.resolve(args.js && args.js !== true ? args.js : path.join(ROOT, 'js'));
const imp = (p) => import(pathToFileURL(path.join(JS, p)).href);
const { World } = await imp('world/world.js'); const { Nav } = await imp('world/nav.js'); const { LAYOUT } = await imp('world/layout.js');
const { Events } = await imp('core/events.js'); const { CrowdSim, MODE } = await imp('npc/sim.js'); const { Behave } = await imp('npc/behave.js');
const spName = args.spawn || 'nankai_gate', secs = +(args.secs || 150), HZ = +(args.hz || 60), DT = 1 / HZ;
const clock = { minutes: 12 * 60 + 10, scale: 6, get hours() { return this.minutes / 60; }, get rush() { return 0.6; } };
let s = ((+args.seed || 1) >>> 0) || 1; Math.random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const world = new World(), nav = new Nav(world), events = new Events();
const sim = new CrowdSim({ world, nav, events, clock, params: {}, quality: { crowdMax: 1500, drawDist: 200 }, worker: false });
const behave = new Behave(sim, { params: { seed: +args.seed || 1 } }); sim.behave = behave; sim.fields.syncInUpdate = false;
const S = LAYOUT.spawns[spName]; const lvOrder = LAYOUT.LEVEL_ORDER;
const V = { level: S.level, x: S.x, z: S.z, vx: 0, vz: 0, yaw: S.yaw || 0, ramp: -1, has: true };
sim.viewer = V; sim.visibleLevel = (lv) => Math.abs(lvOrder.indexOf(lv) - lvOrder.indexOf(V.level)) <= 1;
const step = () => { sim.update(DT); if (sim.fields.pending) sim.fields.flushSync(); clock.minutes += DT * 6 / 60; };
step(); let k = 0; while (sim.fields.pending > 0 && k++ < 400) { sim.fields.flushSync(); sim.update(DT); }
for (let i = 0; i < 120; i++) step();
if (!args.notrain) { const D = behave.director; D.onTrainArrive({ track: 'nk_track_4', line: 'nankai', platform: 'nk_plat_2', dwell: 40, initial: true, start: true }, true); D.onTrainArrive({ track: 'nk_track_4', line: 'nankai', platform: 'nk_plat_2', dwell: 40, force: true }, false); }
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
// context tracking
const osr = sim._startRide.bind(sim);
const yawErr = []; const lat0 = [];
sim._startRide = function (a) { if (a.tier === 0) { const R0 = sim.places.ramps[a.rampNext]; const e0 = a.rampFromLow ? R0.ends.low : R0.ends.high; yawErr.push(Math.abs(wrap(a.yaw - Math.atan2(e0.dx, e0.dz))) * 57.3); if (args.dbg) { const al = (a.x - e0.x) * e0.dx + (a.z - e0.z) * e0.dz; console.log('BOARD yawErr', (Math.abs(wrap(a.yaw - Math.atan2(e0.dx, e0.dz))) * 57.3).toFixed(0), 'along', al.toFixed(2), 'lat', ((a.x - e0.x) * -e0.dz + (a.z - e0.z) * e0.dx).toFixed(2), 'u', a.rampU.toFixed(2), 'spd', a.spd.toFixed(2), 'walk', a.walkLane, 'headT', (a.headT||0).toFixed(1), 'rampFromLow', a.rampFromLow, R0.r.id); }
 if (args.path && a.__hist && yawErr[yawErr.length-1] > 60 && (globalThis.__np = (globalThis.__np||0)+1) <= 5) { console.log('PATH ramp', R0.r.id, 'lane u', a.rampU.toFixed(2), 'walk', a.walkLane, 'mode', a.mode, 'queueing', a.queueing, 'faceSet', a.faceSet); for (let i = 0; i < a.__hist.length; i += 4) { const h = a.__hist[i]; console.log('   t', h[0], 'along', ((h[1]-e0.x)*e0.dx+(h[2]-e0.z)*e0.dz).toFixed(2), 'lat', ((h[1]-e0.x)*-e0.dz+(h[2]-e0.z)*e0.dx).toFixed(2), 'yawErr', (Math.abs(wrap(h[3]-Math.atan2(e0.dx,e0.dz)))*57.3).toFixed(0), 'spd', h[6]); } }
 lat0.push(Math.abs((a.x - e0.x) * -e0.dz + (a.z - e0.z) * e0.dx)); } const R = sim.places.ramps[a.rampNext]; a.__board = { t: sim.time, id: R.r.id, esc: R.esc, walk: a.walkLane, tier: a.tier, rows: [] }; if (a.tier === 0) a.__trace = { kind: 'board', id: R.r.id, walk: a.walkLane, rows: (a.__hist || []).slice() }; osr(a); };
const olr = sim._leaveRide.bind(sim);
sim._leaveRide = function (a) { if (a.ramp >= 0 && ((a.rs >= 1 && a.rdir > 0) || (a.rs <= 0 && a.rdir < 0))) { a.__exit = { t: sim.time, id: sim.places.ramps[a.ramp].r.id, walk: a.walkLane, tier: a.tier }; if (a.tier === 0) a.__trace2 = { kind: 'exit', id: sim.places.ramps[a.ramp].r.id, walk: a.walkLane, rows: (a.__hist || []).slice() }; } olr(a); };
const ctxs = { board: [], ride: [], exit: [], approach: [], free: [] };
const stat = {}; const mk = () => ({ n: 0, maxStep: 0, maxYaw: 0, maxLat: 0, maxDy: 0, over: 0, overYaw: 0, overLat: 0, worst: null });
for (const c of Object.keys(ctxs)) stat[c] = mk();
const traces = [];
const BW = 1.6; // seconds after start of boarding / exit that count as that context
let t = 0;
const prev = new Map();
while (t < secs) {
  step(); t += DT;
  for (const a of sim.agents) {
    if (!a.alive || a.tier !== 0) { prev.delete(a); a.__hist = null; continue; }
    const p = prev.get(a);
    const cur = { x: a.x, z: a.z, y: a.y, yaw: a.yaw, ramp: a.ramp, lv: a.level, t: sim.time, spd: a.spd };
    prev.set(a, cur);
    const h = a.__hist || (a.__hist = []); h.push([+(sim.time).toFixed(3), +a.x.toFixed(3), +a.z.toFixed(3), +a.yaw.toFixed(3), +a.y.toFixed(3), a.ramp, +a.spd.toFixed(2)]); if (h.length > 40) h.shift();
    if (a.__trace && sim.time - a.__board.t < BW) a.__trace.rows.push(h[h.length - 1]); else if (a.__trace) { traces.push(a.__trace); a.__trace = null; }
    if (a.__trace2 && sim.time - a.__exit.t < BW) a.__trace2.rows.push(h[h.length - 1]); else if (a.__trace2) { traces.push(a.__trace2); a.__trace2 = null; }
    if (!p || p.t >= sim.time - 1e-6 || sim.time - p.t > DT * 1.5) continue;   // only consecutive-frame samples
    const dx = a.x - p.x, dz = a.z - p.z, st = Math.hypot(dx, dz), dtt = sim.time - p.t;
    const dyaw = Math.abs(wrap(a.yaw - p.yaw)) / dtt * 180 / Math.PI;
    const vx = dx / dtt, vz = dz / dtt, sp = Math.hypot(vx, vz);
    let lat = 0; if (sp > 0.3) { const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw); lat = Math.abs(vx * fz - vz * fx); }
    const dy = Math.abs(a.y - p.y);
    let c = 'free';
    if (a.__board && sim.time - a.__board.t < BW && a.__board.tier === 0) c = 'board'; else if (a.__exit && sim.time - a.__exit.t < BW && a.__exit.tier === 0) c = 'exit'; else if (a.ramp >= 0) c = 'ride'; else if (a.rampNext >= 0) c = 'approach';
    if (c === 'free' && st > 0.15 / (HZ / 60)) { let nr = 9e9, rid = ''; for (const R of sim.places.ramps) for (const e of [R.ends.low, R.ends.high]) { const d = Math.hypot(e.x - a.x, e.z - a.z); if (d < nr) { nr = d; rid = R.r.id; } } console.log('FREEJUMP', a.serial, 't', sim.time.toFixed(2), 'step', st.toFixed(3), 'mode', a.mode, 'pose', a.pose, 'leg', a.legs && a.legs[a.leg] ? a.legs[a.leg].t : '-', 'lvl', a.level, 'nearestRampEnd', rid, nr.toFixed(1), 'spd', a.spd.toFixed(2), 'tier', a.tier, 'prevRampNext', a.rampNext, 'sinceExit', a.__exit ? (sim.time - a.__exit.t).toFixed(2) : '-', 'sinceBoard', a.__board ? (sim.time - a.__board.t).toFixed(1) : '-'); }
    const S2 = stat[c]; S2.n++;
    const stepN = st * (HZ / 60) ; // normalised to metres per 1/60 s
    if (stepN > S2.maxStep) { S2.maxStep = stepN; S2.worst = { id: (a.__board || a.__exit || {}).id, t: +sim.time.toFixed(2), step: +st.toFixed(3), yaw: +dyaw.toFixed(0), serial: a.serial, walk: a.walkLane }; }
    if (dyaw > S2.maxYaw) S2.maxYaw = dyaw; if (lat > S2.maxLat) S2.maxLat = lat; if (dy * (HZ / 60) > S2.maxDy) S2.maxDy = dy * (HZ / 60);
    if (stepN > 0.15) S2.over++; if (dyaw > 360) S2.overYaw++; if (lat > 0.35) S2.overLat++;
  }
}
const sum = {};
for (const c of Object.keys(stat)) { const q = stat[c]; sum[c] = { frames: q.n, maxStep_m_per_60th: +q.maxStep.toFixed(3), framesOver0_15: q.over, maxYaw_dps: +q.maxYaw.toFixed(0), framesYawOver360: q.overYaw, maxLatSpeed: +q.maxLat.toFixed(2), framesLatOver0_35: q.overLat, maxDy: +q.maxDy.toFixed(3), worst: q.worst }; }
let nb = 0, ne = 0; for (const tr of traces) { if (tr.kind === 'board') nb++; else ne++; }
console.log(`spawn ${spName} secs ${secs} hz ${HZ} near boardings traced ${nb} exits traced ${ne}`);
for (const c of ['approach', 'board', 'exit', 'ride', 'free']) console.log(c.padEnd(6), JSON.stringify(sum[c]));
{ const q = (arr, p) => arr.slice().sort((a, b) => a - b)[Math.floor(arr.length * p)] || 0; console.log('boarding heading error deg p50/p90/max', q(yawErr, 0.5).toFixed(0), q(yawErr, 0.9).toFixed(0), Math.max(...yawErr).toFixed(0), ' lateral m p50/p90/max', q(lat0, 0.5).toFixed(2), q(lat0, 0.9).toFixed(2), Math.max(...lat0).toFixed(2), 'n', yawErr.length); }
if (args.trace) { const fs = await import('fs'); fs.writeFileSync(args.trace, JSON.stringify({ sum, traces: traces.slice(0, 60) })); }
process.exit(0);
