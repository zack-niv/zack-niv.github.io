// =============================================================================
// Architecture: the built fabric of Namba, generated from the master plan so
// visuals match collision exactly. Builders live in js/world/arch/*:
//   stations.js   platform edges, subway back walls, Midosuji vault, Nankai
//                 platform roofs/columns/service beams, 3F trussed concourse roof
//   surfaces.js   floors (+borders, inlays, joints, thresholds), banded walls,
//                 glass balustrades, slab edges, shop bulkheads (sign band),
//                 ceiling steps
//   ceilings.js   ceiling systems + light fixtures (all declared to lighting)
//   columns.js    structural column grids (registered with world.addBox)
//   tactile.js    yellow tactile paving routes
//   escalators.js escalators (instanced moving steps, scrolling handrails) and
//                 stairs, exit wells + canopies
// Static geometry is batched per (level, 48 m chunk, material) in chunk groups.
//
// ctx.architecture exposes (see notes/architecture.md):
//   columns, fascia, adFrames, serviceBeams, platformColumns, exitCanopies,
//   hangPoints, wallItems (hose cabinets, doors, lockers... {level,type,x,z,nx,nz,w}), isClear(level, x, z, r), stats
// =============================================================================
import * as THREE from 'three';
import { Kit, CHUNK, PARKS_MERGE } from './arch/kit.js?v=517b401';
import { STYLE, styleOf } from './arch/styles.js?v=517b401';
import { buildSurfaces } from './arch/surfaces.js?v=517b401';
import { buildCeilings } from './arch/ceilings.js?v=517b401';
import { buildColumns } from './arch/columns.js?v=517b401';
import { buildTactile } from './arch/tactile.js?v=517b401';
import { buildStations } from './arch/stations.js?v=517b401';
import { Ramps } from './arch/escalators.js?v=517b401';
import { wallKit, wearKit } from './arch/details.js?v=517b401';
import { buildPortals } from './arch/portals.js?v=517b401';
import { buildShells } from './arch/shells.js?v=517b401';

export { STYLE, styleOf };

export class Architecture {
  constructor(ctx) {
    this.ctx = ctx;
    this.columns = []; this.fascia = {}; this.adFrames = []; this.serviceBeams = []; this.platformColumns = [];
    this.exitCanopies = []; this.hangPoints = []; this.stats = {};
  }

  init() {
    const ctx = this.ctx;
    const t0 = performance.now();
    const K = this.K = new Kit(ctx);
    const step = (name, fn) => {
      const t = performance.now();
      try { fn(); } catch (e) { console.error(`[architecture] ${name} failed`, e); ctx.errors.push(`architecture.${name}: ${e.message}`); }
      this.stats[name + 'Ms'] = Math.round(performance.now() - t);
    };
    step('stations', () => { const s = buildStations(K); this.adFrames = s.adFrames; this.serviceBeams = s.serviceBeams; this.platformColumns = s.platformColumns; });
    step('tactile', () => { this.stats.tactileSegs = buildTactile(K); });
    step('columns', () => { this.columns = K.columns = buildColumns(K); });
    step('surfaces', () => { this.fascia = buildSurfaces(K).fascia; });
    step('ceilings', () => buildCeilings(K));
    step('shells', () => { this.stats.shells = buildShells(K); });
    step('ramps', () => { this.ramps = new Ramps(K); this.ramps.build(); this.exitCanopies = this.ramps.exitCanopies || []; });
    this.hangPoints = K.hangPoints || [];
    this.wallItems = K.wallItems || [];
    step('portals', () => { this.stats.portals = buildPortals(K); });
    step('walls', () => { this.stats.wallKit = wallKit(K); });
    step('wear', () => { this.stats.wearDecals = wearKit(K); });
    // emit static meshes into chunk groups
    step('emit', () => {
      let meshes = 0;
      for (const [k, b] of K.batches) {
        const [lv, cx, cz] = k.split('|');
        const grp = new THREE.Group();
        grp.name = `arch:${k}`;
        grp.userData.chunk = cx === 'P' ? { level: lv, x: PARKS_MERGE.x, z: PARKS_MERGE.z, r: PARKS_MERGE.r } : { level: lv, x: (+cx + 0.5) * CHUNK, z: (+cz + 0.5) * CHUNK, r: CHUNK * 0.75 };
        for (const m of b.build(ctx.materials, { name: 'arch' })) { grp.add(m); meshes++; }
        ctx.engine.levelRoot(lv).add(grp);
      }
      this.stats.meshes = meshes;
      K.batches.clear();
    });
    this.stats.lights = K.lightCount;
    this.stats.columns = this.columns.length;
    this.stats.totalMs = Math.round(performance.now() - t0);
  }

  // is (x, z) on `level` clear of structure (columns, ramps + run-off)?
  isClear(level, x, z, r = 0.5) {
    if (this.K && !this.K.clear(level, x, z, r)) return false;
    for (const rp of this.ctx.world.layout.ramps) {
      if (rp.lower !== level && rp.upper !== level) continue;
      const [x0, z0, x1, z1] = rp.rect;
      if (x > x0 - r && x < x1 + r && z > z0 - r && z < z1 + r) return false;
    }
    return true;
  }

  update(dt) { if (this.ramps) this.ramps.update(dt); }
}
