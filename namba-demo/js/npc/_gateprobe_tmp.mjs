import { World } from '../world/world.js';
import { Nav } from '../world/nav.js';
import { LAYOUT } from '../world/layout.js';
import { Events } from '../core/events.js';
import { CrowdSim } from './sim.js';
import { Behave } from './behave.js';
const off = process.argv[2] === 'off', secs = +(process.argv[3] || 150);
let s = 12345; Math.random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const clock = { minutes: 12 * 60 + 10, scale: 6, get hours() { return this.minutes / 60; }, get rush() { return 0.8; } };
const world = new World(), nav = new Nav(world), events = new Events();
const sim = new CrowdSim({ world, nav, events, clock, params: {}, quality: { crowdMax: 1500, drawDist: 200 }, worker: false });
const behave = new Behave(sim, { params: { seed: 7 } }); sim.behave = behave; sim.fields.syncInUpdate = false;
const S = LAYOUT.spawns.nankai_gate;
const V = { level: S.level, x: S.x, z: S.z, vx: 0, vz: 0, yaw: S.yaw || 0, ramp: -1, has: true }; sim.viewer = V;
sim.visibleLevel = () => true;
if (off) { const g = sim._gateCheck.bind(sim); sim._gateCheck = (a, G) => { const r = g(a, G); if (r) a.tapDone = true; return r; }; }
let passes = 0, nearPasses = 0, taps = 0; const lat = [];
events.on('crowd:gate', (e) => { if (e.gate === 'g_nk_central') { passes++; if (e.near) nearPasses++; } });
const DT = 1 / 30;
const step = () => { sim.update(DT); if (sim.fields.pending) sim.fields.flushSync(); clock.minutes += DT * 6 / 60; };
step(); let k = 0; while (sim.fields.pending > 0 && k++ < 400) { sim.fields.flushSync(); sim.update(DT); }
const tapSeen = new Set(); const delta = [];
for (let i = 0; i < 90; i++) step();
passes = 0; nearPasses = 0;
for (let t = 0; t < secs; t += DT) {
  step();
  for (const a of sim.agents) if (a.alive && a.gate && a.gate.id === 'g_nk_central' && a.tapDone && a.tapAt > -5 && !tapSeen.has(a.serial + ':' + a.tapAt)) { tapSeen.add(a.serial + ':' + a.tapAt); taps++; }
  if (t % 1 < DT) for (const a of sim.agents) if (a.alive && a.gPassed && a.gate && a.gate.id === 'g_nk_central' && a.tapAt > -5 && sim.time - a.tapAt < 1.2 && !a._pd) { a._pd = 1; delta.push(sim.time - a.tapAt); }
}
console.log(JSON.stringify({ mode: off ? 'off' : 'on', secs, passes, perMin: +(passes / secs * 60).toFixed(1), nearPasses, taps }));
