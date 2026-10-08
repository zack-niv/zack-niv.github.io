// =============================================================================
// Namba Parks: the canyon strata, bridges & skywalks, terraced roof gardens
// (planting, paths, decks, water, furniture). Everything big lives under
// ctx.engine.globalRoot (visible from every terrace); the Exterior system
// hides it when the player is deep indoors.
// =============================================================================
import * as THREE from 'three';
import { defineOutdoorMaterials } from './outdoor/mats.js?v=488c31e';

export class Parks {
  constructor(ctx) {
    this.ctx = ctx;
    this.planters = [];   // rim / ledge planter strips from the canyon builder
    this.beds = [];       // planting areas for the vegetation scatter
    this.updaters = [];
  }
  async init() {
    const { ctx } = this;
    defineOutdoorMaterials(ctx);
    this.root = new THREE.Group(); this.root.name = 'parks';
    (ctx.exterior && ctx.exterior.root ? ctx.exterior.root : ctx.engine.globalRoot).add(this.root);
    const steps = [
      ['./outdoor/canyon.js?v=488c31e', 'buildCanyon'],
      ['./outdoor/structures.js?v=488c31e', 'buildStructures'],
      ['./outdoor/terraces.js?v=488c31e', 'buildTerraces'],
      ['./outdoor/garden.js?v=488c31e', 'buildGardens'],
    ];
    this.timings = {};
    for (const [path, fn] of steps) {
      try {
        const m = await import(path);
        const t0 = performance.now();
        const r = m[fn] && await m[fn](ctx, this);
        this.timings[fn] = Math.round(performance.now() - t0);
        if (r && r.update) this.updaters.push(r);
      } catch (e) { console.error('[parks]', path, e); ctx.errors.push(`parks ${path}: ${e.message}`); }
    }
  }
  // (timings in ms per build step: ctx.parks.timings)
  update(dt) { for (const u of this.updaters) u.update(dt, this); }
}
