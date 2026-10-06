// =============================================================================
// Crowd system (ctx.crowd): purpose-driven pedestrians for the whole complex.
//
//   sim.js      movement core: flow fields, avoidance, escalator lanes, gates, LOD
//   behave.js   trip legs (go / queue / dine / browse / board / stroll / …)
//   trips.js    Director: population vs. time of day, trip planning, surges
//   places.js   portals, platforms + door markings, shops, gardens, staff posts
//   fields.js   flow-field store (Web Worker), grid collision, local paths
//   humans.js   v2 people: rigged CC0 glTF humans (assets/humans), clips, bone texture, materials
//   render.js   v2 hybrid LOD: near SkinnedMesh + AnimationMixer, far GPU-skinned instancing, blobs
//   render_v1.js / humanGeo.js / humanMat.js   v1 procedural people (fallback, ?v1crowd)
//   counters.js staff behind every ctx.counters counter (barista / chef / clerk)
//
// Public API (see notes/crowd.md):
//   ctx.crowd.count                       live agents
//   ctx.crowd.densityNear(level,x,z,r)    people per m² around a point
//   ctx.crowd.countNear(level,x,z,r)
//   ctx.crowd.agentsNear(level,x,z,r)     [{x,y,z,level,yaw,speed,kind,pose,…}] (read-only views)
//   ctx.crowd.queueLength(slotId)         people queueing outside a business
//   ctx.crowd.collide(body, radius)       push a body {x,z,level} out of nearby people; returns true if pushed
//   ctx.crowd.debugText()
// Events emitted: 'crowd:excuse' {level,x,y,z,ja,en,kind,female}  (someone says すみません to the player)
//                 'crowd:callout' {level,x,y,z,ja,en,kind}         (shop staff: いらっしゃいませ)
//                 'crowd:gate' {gate,lane,dir,level,x,z,near}       (an NPC passed a ticket gate lane)
// Listens: 'train:arrive', 'train:depart', 'player:teleport'
// =============================================================================
import { CrowdSim, POSE, MODE } from './sim.js';
import { Behave } from './behave.js';
import { CrowdRenderer } from './render.js';
import { CrowdRendererV1 } from './render_v1.js';
import { loadHumanLibrary } from './humans.js';
import { CounterStaff } from './counters.js';

const POSE_NAME = Object.fromEntries(Object.entries(POSE).map(([k, v]) => [v, k.toLowerCase()]));

export class Crowd {
  constructor(ctx) {
    this.ctx = ctx;
    this.sim = null; this.renderer = null;
    this.disabled = !!ctx.params.nocrowd;
    this._msAvg = 0;
  }
  get count() { return this.sim ? this.sim.count : 0; }

  async init() {
    if (this.disabled) return;
    const ctx = this.ctx;
    const t0 = performance.now();
    this.sim = new CrowdSim({ world: ctx.world, nav: ctx.nav, events: ctx.events, clock: ctx.clock, params: ctx.params, quality: ctx.engine.quality, ctx });
    this.behave = new Behave(this.sim, ctx);
    this.sim.behave = this.behave;
    const levels = ctx.engine.levels;
    this.sim.visibleLevel = (lv, a) => {
      const r = levels[lv];
      if (r && r.visible === false) {
        if (a && a.ramp >= 0) { const up = levels[this.sim.places.ramps[a.ramp].r.upper]; return !up || up.visible !== false; }
        return false;
      }
      return true;
    };
    // people: rigged glTF humans (v2); the procedural v1 figures are the fallback if the models can't load
    let lib = null;
    if (!(ctx.params.has && ctx.params.has('v1crowd'))) {
      try { lib = await loadHumanLibrary(ctx); } catch (e) { console.warn('[crowd] human models unavailable, using procedural people', e); lib = null; }
    }
    this.humans = lib;
    try { this.renderer = lib ? new CrowdRenderer(ctx, this.sim, lib) : new CrowdRendererV1(ctx, this.sim); this.renderer.init(); }
    catch (e) { console.warn('[crowd] renderer v2 failed, falling back to v1', e); this.renderer = new CrowdRendererV1(ctx, this.sim); this.renderer.init(); }
    try { this.counterStaff = new CounterStaff(this); } catch (e) { console.warn('[crowd] counter staff', e); this.counterStaff = null; }
    const E = ctx.events;
    E.on('train:arrive', (ev) => { try { this.behave.director.onTrainArrive(ev || {}, true); } catch (e) { console.warn('[crowd] train:arrive', e); } });
    E.on('player:teleport', () => { if (this.behave) { this.behave.director.burst = 1; this.behave.director._dkT = 0; } });
    E.on('train:depart', (ev) => { try { this.behave.director.onTrainDepart(ev || {}); } catch (e) { console.warn('[crowd] train:depart', e); } });
    this.initMs = performance.now() - t0;
  }

  _viewer() {
    const V = this.sim.viewer, p = this.ctx.player;
    if (!p || !p.body) { V.has = false; return; }
    const b = p.body;
    const dt = Math.max(1e-3, this._dt || 0.016);
    if (V.has && V.level === b.level) { V.vx = (b.x - V.x) / dt; V.vz = (b.z - V.z) / dt; if (Math.hypot(V.vx, V.vz) > 12) { V.vx = V.vz = 0; } }
    else { V.vx = V.vz = 0; }
    V.x = b.x; V.z = b.z; V.level = b.level; V.ramp = b.ramp; V.yaw = p.yaw || 0; V.has = true;
  }

  update(dt) {
    if (!this.sim) return;
    this._dt = dt;
    if (this.ctx.paused) return;
    this._viewer();
    this.sim.drawDist = (this.ctx.engine.quality && this.ctx.engine.quality.drawDist) || 200;
    const sdt = this.ctx.params.freeze ? (this.sim.time < 3 ? dt : 0.0001) : dt;
    if (this.counterStaff) { try { this.counterStaff.update(sdt); } catch (e) { console.warn('[crowd] counter staff', e); this.counterStaff = null; } }
    this.sim.update(sdt);
    this._msAvg = this.sim.stats.msAvg;
  }
  lateUpdate(dt) {
    if (!this.renderer) return;
    this.renderer.update(this.ctx.paused ? 0 : dt);
  }

  // ---------------------------------------------------------------------------
  densityNear(level, x, z, r = 6) { return this.sim ? this.sim.densityNear(level, x, z, r) : 0; }
  countNear(level, x, z, r = 6) { return this.sim ? this.sim.countNear(level, x, z, r) : 0; }
  agentsNear(level, x, z, r = 6) {
    if (!this.sim) return [];
    return this.sim.agentsNear(level, x, z, r).map(a => ({
      id: a.serial, x: a.x, y: a.y, z: a.z, level: a.level, yaw: a.yaw, speed: a.spd, vx: a.vx, vz: a.vz,
      kind: a.kind, pose: POSE_NAME[a.pose] || 'walk', trip: a.trip, height: 1.7 * (a.look ? a.look.h : 1), female: a.look ? a.look.female : false,
      onRamp: a.ramp >= 0, group: a.leader ? a.leader.serial : (a.followers && a.followers.length ? a.serial : 0),
    }));
  }
  queueLength(slotId) {
    if (!this.sim) return 0;
    const B = this.sim.places.bizBySlot[slotId];
    return B ? B.queue.length : 0;
  }
  seated(slotId) { const B = this.sim && this.sim.places.bizBySlot[slotId]; return B ? B.seated : 0; }
  // Push a body out of people around it (for the player controller, optional).
  collide(body, radius = 0.3) {
    if (!this.sim || !body) return false;
    let pushed = false;
    this.sim.near(body.level, body.x, body.z, 1.2, (a) => {
      if (a.ramp >= 0 || !a.alive || a.fade < 0.5) return;
      const dx = body.x - a.x, dz = body.z - a.z, d = Math.hypot(dx, dz), m = radius + 0.24;
      if (d < m && d > 1e-4) { const k = (m - d) * 0.5; body.x += dx / d * k; body.z += dz / d * k; pushed = true; }
    });
    return pushed;
  }
  debugText() {
    if (!this.sim) return this.disabled ? 'crowd off' : 'crowd …';
    const S = this.sim, R = this.renderer, D = this.behave.director, F = S.fields;
    const v = S.viewer;
    return `crowd ${S.count}/${D.target()}  sim ${S.stats.msAvg.toFixed(2)}ms (t0 ${S.stats.t0} t1 ${S.stats.t1} t2 ${S.stats.t2})  ` +
      `draw ${R ? R.stats.lod.join('/') : '-'} blobs ${R ? R.stats.blobs : 0} ${R ? (R.stats.tris / 1000).toFixed(0) + 'k tris' : ''}  ` +
      `fields ${F.entries.size}(${F.pending} pend)  near ${S.countNear(v.level, v.x, v.z, 8)}  trains ${D.counts.trains}`;
  }
}
