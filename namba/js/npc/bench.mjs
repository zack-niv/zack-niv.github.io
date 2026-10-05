// Headless crowd simulation benchmark (Node):
//   node js/npc/bench.mjs [agents=1800] [frames=900] [time=12:10] [spawn=nankai_gate]
// Builds world + nav, fills the crowd, computes all requested fields
// synchronously (warm-up, not timed), then times CrowdSim.update at 60 Hz with
// the viewer standing at a spawn point. Prints ms/frame percentiles and stats.
import { World } from '../world/world.js';
import { Nav } from '../world/nav.js';
import { LAYOUT } from '../world/layout.js';
import { Events } from '../core/events.js';
import { CrowdSim, MODE } from './sim.js';
import { Behave } from './behave.js';

const [nA = '1800', nF = '900', tm = '12:10', sp = 'nankai_gate'] = process.argv.slice(2);
const [hh, mm] = tm.split(':').map(Number);
const clock = {
  minutes: hh * 60 + mm, scale: 6,
  get hours() { return this.minutes / 60; },
  get rush() { const h = this.hours; const g = (c, w) => Math.exp(-((h - c) * (h - c)) / (2 * w * w)); return Math.min(1, 0.25 + 0.75 * Math.max(g(8.4, 0.8), g(18.4, 0.9)) + 0.3 * g(12.3, 0.7)); },
};
let t = performance.now();
const world = new World();
const nav = new Nav(world);
console.log(`world+nav ${(performance.now() - t).toFixed(0)} ms, ${nav.N} nodes`);
const events = new Events();
let excuses = 0; events.on('crowd:excuse', () => excuses++);
t = performance.now();
const sim = new CrowdSim({ world, nav, events, clock, params: {}, quality: { crowdMax: +nA, drawDist: 200 }, worker: false });
const behave = new Behave(sim, { params: {} });
sim.behave = behave;
console.log(`crowd init ${(performance.now() - t).toFixed(0)} ms (fields prep, places)`);
const S = LAYOUT.spawns[sp] || LAYOUT.spawns.start;
const lvOrder = LAYOUT.LEVEL_ORDER;
sim.viewer = { level: S.level, x: S.x, z: S.z, vx: 0, vz: 0, ramp: -1, has: true };
sim.visibleLevel = (lv) => Math.abs(lvOrder.indexOf(lv) - lvOrder.indexOf(S.level)) <= 1;
// warm-up: initial fill + all fields
t = performance.now();
sim.update(1 / 60);
const fillMs = performance.now() - t;
t = performance.now();
let k = 0;
while (sim.fields.pending > 0 && k++ < 400) { sim.fields.flushSync(); sim.update(1 / 60); }
console.log(`fill ${fillMs.toFixed(0)} ms; fields ${sim.fields.entries.size} computed in ${(performance.now() - t).toFixed(0)} ms (avg ${(sim.fields.stats.ms / Math.max(1, sim.fields.stats.computed)).toFixed(1)} ms/field)`);
for (let i = 0; i < 120; i++) { sim.update(1 / 60); sim.fields.flushSync(); }
const times = [];
let maxPending = 0;
for (let i = 0; i < +nF; i++) {
  const t0 = performance.now();
  sim.update(1 / 60);
  times.push(performance.now() - t0);
  if (sim.fields.pending) { maxPending = Math.max(maxPending, sim.fields.pending); sim.fields.flushSync(); }
  clock.minutes += (1 / 60) * 6 / 60;
}
times.sort((a, b) => a - b);
const pct = (p) => times[Math.min(times.length - 1, Math.floor(times.length * p))].toFixed(2);
const avg = times.reduce((a, b) => a + b, 0) / times.length;
const modes = {}; const kinds = {}; const legs = {};
for (const a of sim.agents) if (a.alive) {
  modes[Object.keys(MODE).find(k => MODE[k] === a.mode)] = (modes[Object.keys(MODE).find(k => MODE[k] === a.mode)] || 0) + 1;
  kinds[a.kind] = (kinds[a.kind] || 0) + 1;
  const L = a.legs && a.legs[a.leg]; const lt = a.leader ? 'follower' : L ? L.t : 'none'; legs[lt] = (legs[lt] || 0) + 1;
}
console.log(`agents ${sim.count} (target ${behave.director.target()})  tiers t0 ${sim.stats.t0} t1 ${sim.stats.t1} t2 ${sim.stats.t2}`);
console.log(`update ms: avg ${avg.toFixed(2)}  p50 ${pct(0.5)}  p90 ${pct(0.9)}  p99 ${pct(0.99)}  max ${pct(1)}`);
console.log('modes', JSON.stringify(modes));
console.log('kinds', JSON.stringify(kinds));
console.log('legs ', JSON.stringify(legs));
console.log('director', JSON.stringify(behave.director.counts), 'excuses', excuses, 'maxPendingFields', maxPending);
// queue lengths at the busiest restaurants
const qs = sim.places.biz.filter(B => B.queue.length).sort((a, b) => b.queue.length - a.queue.length).slice(0, 6).map(B => `${B.id}:${B.queue.length}/${B.seated}of${B.cap}`);
console.log('queues', qs.join(' '));
// density around the viewer
console.log('near viewer (8 m):', sim.countNear(S.level, S.x, S.z, 8), ' density', sim.densityNear(S.level, S.x, S.z, 8).toFixed(3), '/m²');
const byLv = {}; for (const a of sim.agents) if (a.alive) byLv[a.level] = (byLv[a.level] || 0) + 1;
console.log('by level', JSON.stringify(byLv));
