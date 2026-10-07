// Headless escalator / stair congestion probe (Node), v4 crowd flow.
//   node js/npc/flowprobe.mjs [--spawn start] [--secs 90] [--time 12:10] [--walk 1] [--train 1] [--radius 3.5] [--json out.json] [--seed N]
// Builds world + nav, runs the crowd sim at 30 Hz with the viewer at a spawn (optionally walking at 1.4 m/s towards
// --to x,z, to mimic the player), and for EVERY ramp end within --range m of the viewer path logs:
//   max / p95 local density (non-riding people within --radius m of the mouth or landing),
//   max queue length (people with rampNext = this ramp, waiting at the mouth), median / p90 / max wait-to-board,
//   boarded count, "blockers" = stationary non-queueing people within 2 m of the landing (exit side).
// --train 1 reproduces the demo's forced rapi:t train at 0.3 s (js/game/demo.js).
import { World } from '../world/world.js';
import { Nav } from '../world/nav.js';
import { LAYOUT } from '../world/layout.js';
import { Events } from '../core/events.js';
import fs from 'fs';
import { CrowdSim, MODE } from './sim.js';
import { Behave } from './behave.js';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => { if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]); return a; }, []));
const spName = args.spawn || 'start', secs = +(args.secs || 90), tm = args.time || '12:10';
const R_NEAR = +(args.radius || 3.5), RANGE = +(args.range || 70);
const [hh, mm] = tm.split(':').map(Number);
const clock = {
  minutes: hh * 60 + mm, scale: 6,
  get hours() { return this.minutes / 60; },
  get rush() { const h = this.hours; const g = (c, w) => Math.exp(-((h - c) * (h - c)) / (2 * w * w)); return Math.min(1, 0.25 + 0.75 * Math.max(g(8.4, 0.8), g(18.4, 0.9)) + 0.3 * g(12.3, 0.7)); },
};
if (args.seed != null) { let s = (+args.seed >>> 0) || 1; Math.random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const world = new World();
const nav = new Nav(world);
const events = new Events();
const sim = new CrowdSim({ world, nav, events, clock, params: {}, quality: { crowdMax: 600, drawDist: 200 }, worker: false });
const behave = new Behave(sim, { params: args.seed != null ? { seed: +args.seed } : {} });
sim.behave = behave;
sim.fields.syncInUpdate = false;
const S = LAYOUT.spawns[spName] || LAYOUT.spawns.start;
const lvOrder = LAYOUT.LEVEL_ORDER;
const V = { level: S.level, x: S.x, z: S.z, vx: 0, vz: 0, yaw: S.yaw || 0, ramp: -1, has: true };
sim.viewer = V;
sim.visibleLevel = (lv) => Math.abs(lvOrder.indexOf(lv) - lvOrder.indexOf(V.level)) <= 1;
const DT = 1 / 30;
const step = () => { sim.update(DT); if (sim.fields.pending) sim.fields.flushSync(); clock.minutes += DT * 6 / 60; };
// ramp bookkeeping: waits
const P = sim.places, ramps = P.ramps;
const stat = ramps.map(R => ({ low: mk(), high: mk() }));
function mk() { return { dens: [], q: [], waits: [], boarded: 0, block: [], starve: 0, last: 0, maxDens: 0, maxQ: 0, ahead: [] }; }
const ob = sim._beginRamp.bind(sim), os = sim._startRide.bind(sim);
sim._beginRamp = function (a, ri, ...rest) { const had = a._rq && a._rq.t0 != null && a.rampNext >= 0; ob(a, ri, ...rest); if (!had || a._rq.ri !== a.rampNext) a._rq = { ri: a.rampNext, t0: sim.time }; };
const useCount = {}; let totalBoard = 0, tier2Board = 0;
sim._startRide = function (a) { const R = ramps[a.rampNext]; if (R && sim.time > sim.time0) { useCount[R.r.id] = (useCount[R.r.id] || 0) + 1; totalBoard++; if (a.tier === 2) tier2Board++; } if (a._rq && R && a._rq.ri === a.rampNext) { stat[R.ri][a.rampFromLow ? 'low' : 'high'].waits.push(sim.time - a._rq.t0); stat[R.ri][a.rampFromLow ? 'low' : 'high'].boarded++; stat[R.ri][a.rampFromLow ? 'low' : 'high'].last = sim.time; } a._rq = null; os(a); };
let walking = !!(args.walk && +args.walk);
const to = (args.to ? String(args.to).split(',').map(Number) : null);
const idOf = (R) => R.r.id;
// warm-up
step();
let k = 0; while (sim.fields.pending > 0 && k++ < 400) { sim.fields.flushSync(); sim.update(DT); }
for (let i = 0; i < 90; i++) step();
sim.time0 = sim.time;
// the demo's opening train
if (args.train == null || +args.train) {
  const D = behave.director;
  // the browser also emits transit's own arrivals at game start: the player's rapi:t (real, start:true) and 'initial' arrivals of trains already at the doors
  if (!args.nodouble) { D.onTrainArrive({ track: 'nk_track_4', line: 'nankai', platform: 'nk_plat_2', dwell: 40, initial: true, start: true }, true); for (const [tr, pl] of [['nk_track_2', 'nk_plat_1'], ['nk_track_6', 'nk_plat_3']]) D.onTrainArrive({ track: tr, line: 'nankai', platform: pl, dwell: 40, initial: true }, true); }
  D.onTrainArrive({ track: 'nk_track_4', line: 'nankai', platform: 'nk_plat_2', dwell: 40, force: true }, false);
}
const near = (R, e) => R.r;
let t = 0, sampleT = 0;
const samples = [];
const ends = [];
ramps.forEach(R => { ends.push([R, 'low', R.ends.low, R.r.lower], [R, 'high', R.ends.high, R.r.upper]); });
const hist = [];   // density timeline for the worst end
let peak = { d: 0 };
while (t < secs) {
  step(); t += DT;
  if (walking && to) { const dx = to[0] - V.x, dz = to[1] - V.z, l = Math.hypot(dx, dz); if (l > 0.5 && t > 8) { V.vx = dx / l * 1.4; V.vz = dz / l * 1.4; V.x += V.vx * DT; V.z += V.vz * DT; } else V.vx = V.vz = 0; }
  if (t >= sampleT) {
    sampleT += 0.5;
    for (const [R, which, e, lv] of ends) {
      if (Math.hypot(e.x - V.x, e.z - V.z) > RANGE || V.level !== lv && Math.abs(lvOrder.indexOf(V.level) - lvOrder.indexOf(lv)) > 1) continue;
      let n = 0, q = 0, blk = 0;
      sim.near(lv, e.x, e.z, R_NEAR, (a) => {
        if (a.ramp >= 0 || !a.alive) return;
        n++;
        if (a.rampNext >= 0 && P.ramps[a.rampNext] === R && (a.rampFromLow === (which === 'low'))) q++;
        const dl = Math.hypot(a.x - e.x, a.z - e.z);
        if (dl < 2 && a.spd < 0.2 && !(a.rampNext >= 0) && a.mode !== MODE.STAND) blk++;
      });
      const st = stat[R.ri][which];
      st.dens.push(n); st.q.push(q); st.block.push(blk);
      if (q >= 2 && sim.time - Math.max(st.last, sim.time0) > 6) { st.starve += 0.5; if (args.dumpstarve && !st.dumped) { st.dumped = 1; console.log('STARVE', idOf(R), which, 't', t.toFixed(1), 'nextStand', R.nextStand.toFixed(1), 'nextWalk', R.nextWalk.toFixed(1), 'time', sim.time.toFixed(1)); for (const k of which === 'low' ? ['qLs', 'qLw', 'qL'] : ['qHs', 'qHw', 'qH']) { const qq = R[k]; if (!qq || !qq.length) continue; console.log(' ', k); sim.near(lv, e.x, e.z, 3.2, (b) => { if (b.ramp < 0) console.log('     near:', b.serial, 'dm', Math.hypot(b.x - e.x, b.z - e.z).toFixed(2), 'x', b.x.toFixed(2), 'z', b.z.toFixed(2), 'mode', b.mode, 'spd', b.spd.toFixed(2), 'rampNext', b.rampNext, 'q?', !!b.rampQ, 'aim', b.aimX.toFixed(2), b.aimZ.toFixed(2), 'pose', b.pose, 'blockT', (b.blockT||0).toFixed(1)); }); console.log('     mouth', e.x, e.z, e.dx, e.dz); qq.forEach((b, i) => console.log('   ', i, 'd-mouth', Math.hypot(b.x - e.x, b.z - e.z).toFixed(2), 'aimd', Math.hypot(b.x - b.aimX, b.z - b.aimZ).toFixed(2), 'spd', b.spd.toFixed(2), 'tier', b.tier, 'mode', b.mode, 'headT', (b.headT || 0).toFixed(1), 'walk', b.walkLane, 'rampNext', b.rampNext, b.kind)); } } }
      if (n > peak.d) peak = { d: n, id: idOf(R), which, t: +t.toFixed(1) };
      // exclude agents standing on purpose (restaurant queue etc.): the metric is raw headcount
    }
  }
}
if (args.debug) { console.log('surge', behave.director.counts.surge, 'trains', behave.director.counts.trains); const cnt = {}; for (const a of sim.agents) if (a.alive && a.level === '3F') { const L = a.legs && a.legs[a.leg]; const k = (a.rampNext >= 0 ? 'ramp:' + ramps[a.rampNext].r.id : L ? L.t : 'none'); cnt[k] = (cnt[k] || 0) + 1; } { const g = {}; for (const a of sim.agents) if (a.alive && a.level === '3F') { const k = Math.round(a.x / 10) * 10 + ',' + Math.round(a.z / 10) * 10; g[k] = (g[k] || 0) + 1; } console.log('3F grid(10m)', JSON.stringify(g)); }
console.log('3F agents by leg', JSON.stringify(cnt)); }
if (args.dump) { const R = ramps.find(r => r.r.id === args.dump), fl = args.dumpend !== 'high'; for (const k of fl ? ['qLs', 'qLw', 'qL'] : ['qHs', 'qHw', 'qH']) { const q = R[k]; if (!q || !q.length) continue; console.log('queue', k, q.length); const end = fl ? R.ends.low : R.ends.high; q.forEach((b, i) => console.log(' ', i, 'alive', b.alive, 'lvl', b.level, 'd-end', Math.hypot(b.x - end.x, b.z - end.z).toFixed(2), 'aimd', Math.hypot(b.x - b.aimX, b.z - b.aimZ).toFixed(2), 'spd', b.spd.toFixed(2), 'tier', b.tier, 'mode', b.mode, 'rampNext', b.rampNext, 'blockT', (b.blockT || 0).toFixed(1), 'kind', b.kind)); } console.log('nextStand', R.nextStand, 'nextWalk', R.nextWalk, 'time', sim.time, 'riders', R.riders.length); }
const pct = (arr, p) => { if (!arr.length) return 0; const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const rows = [];
ramps.forEach((R, i) => {
  for (const which of ['low', 'high']) {
    const st = stat[i][which];
    if (!st.dens.length) continue;
    const mx = Math.max(...st.dens);
    if (mx < 2 && !st.boarded) continue;
    rows.push({ ramp: idOf(R) + '.' + R.r.kind[0] + (R.r.move || 0), end: which, level: which === 'low' ? R.r.lower : R.r.upper, maxDens: mx, p95Dens: pct(st.dens, 0.95), maxQ: Math.max(...st.q), boarded: st.boarded,
      waitMed: +pct(st.waits, 0.5).toFixed(1), waitP90: +pct(st.waits, 0.9).toFixed(1), waitMax: +(Math.max(0, ...st.waits)).toFixed(1), blockMax: Math.max(...st.block), starve: st.starve, blockMean: +(st.block.reduce((a, b) => a + b, 0) / st.block.length).toFixed(2) });
  }
});
rows.sort((a, b) => b.maxDens - a.maxDens);
console.log(`spawn ${spName} t=${secs}s agents ${sim.count} radius ${R_NEAR}m  peak ${JSON.stringify(peak)}`);
console.log('ramp end level maxDens p95 maxQ boarded waitMed waitP90 waitMax blockMax blockMean starve');
for (const r of rows.slice(0, +(args.top || 14))) console.log([r.ramp.padEnd(14), r.end.padEnd(4), r.level.padEnd(3), String(r.maxDens).padStart(3), String(r.p95Dens).padStart(3), String(r.maxQ).padStart(3), String(r.boarded).padStart(4), String(r.waitMed).padStart(5), String(r.waitP90).padStart(5), String(r.waitMax).padStart(5), String(r.blockMax).padStart(3), String(r.blockMean).padStart(5), String(r.starve).padStart(5)].join(' '));
{ const top = Object.entries(useCount).sort((a, b) => b[1] - a[1]); console.log('boardings total', totalBoard, '(tier2 hop', tier2Board + ')', 'per agent-min', (totalBoard / (sim.count * secs / 60)).toFixed(2), ' top:', top.slice(0, 8).map(x => x.join('=')).join(' ')); }
if (args.json) fs.writeFileSync(args.json, JSON.stringify({ spawn: spName, secs, peak, rows }, null, 1));
process.exit(0);
