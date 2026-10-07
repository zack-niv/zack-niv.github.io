// =============================================================================
// Intrusion clip (v3, World). Some exterior/transit structures are built from
// their own extents and pass straight through indoor spaces of other zones:
// the Nankai viaduct deck (transit/env.js: deck underside at 3F - 2.35 m =
// 9.65 m, parapets, catenary portals) runs south from the platform ends to
// z = 245, i.e. under the Namba CITY 2F ceiling (10.0 m) and through the
// Parks 2F hall (ceiling 10.2 m), its escalator well and the Parks 3F/4F
// floors. From inside it reads as a flat, unlit concrete ceiling that the Parks
// escalators "rise straight into".
//
// This removes, once after build, every triangle of the listed systems' meshes
// whose centroid lies inside the volume of an indoor walkable space (incl. the
// plenum up to 0.6 m above its ceiling) that belongs to a different zone than
// the structure's own (`keepZones`). Geometry over SOLID cells, outdoors, or in
// the station itself is untouched. Pure data pass; no per-frame cost.
// The proper fix is upstream (transit/env.js: stop the viaduct structures at
// the CITY south end); see notes/v3-world.md. With that fix this pass is a no-op.
// =============================================================================
import * as THREE from 'three';
import { LEVELS, LEVEL_ORDER } from '../world/layout.js';
import { CELL } from '../world/world.js';

const RULES = [
  { prefix: 'transit_env:', keepZones: new Set(['nankai']) },
];

export function clipIntrusions(ctx) {
  const { engine, world } = ctx;
  const L = world.layout;
  const ys = LEVEL_ORDER.map(l => LEVELS[l].y);
  const levelOf = (y) => { let k = -1; for (let i = 0; i < ys.length; i++) if (y >= ys[i] - 0.05) k = i; return k < 0 ? null : LEVEL_ORDER[k]; };
  // indoor space at a world point (null when solid / outdoor / unknown)
  const spaceIn = (x, y, z) => {
    const lv = levelOf(y); if (!lv) return null;
    const g = world.grids[lv]; if (!g) return null;
    const i = g.cellOf(x, z); if (i < 0) return null;
    const t = g.type[i];
    if (t !== CELL.WALK && t !== CELL.VOID && t !== CELL.RAMP) return null;
    let zone, ceil;
    const si = g.space[i];
    const sp = si >= 0 ? L.spaces[si] : null;
    if (sp) { if (sp.outdoor) return null; zone = sp.zone; ceil = sp.ceil || 3.5; }
    else if (t === CELL.RAMP && g.ramp[i] >= 0) { const r = L.ramps[g.ramp[i]]; zone = r.zone; ceil = 4; }
    else return null;
    if (y > LEVELS[lv].y + ceil + 0.6) return null;
    return zone;
  };
  let tris = 0, meshes = 0;
  const t0 = performance.now();
  for (const lv of LEVEL_ORDER) {
    const root = engine.levelRoot(lv); if (!root) continue;
    root.traverse(o => {
      if (!o.isMesh || !o.geometry || o.geometry.index) return;
      const rule = RULES.find(r => o.name && o.name.startsWith(r.prefix));
      if (!rule) return;
      o.updateMatrixWorld();
      if (!o.matrixWorld.equals(IDENT)) return; // batches are built in world space
      const g = o.geometry, pos = g.attributes.position, n = pos.count / 3;
      const keep = new Uint8Array(n);
      let drop = 0;
      for (let f = 0; f < n; f++) {
        let cx = 0, cy = 0, cz = 0;
        for (let k = 0; k < 3; k++) { cx += pos.getX(f * 3 + k); cy += pos.getY(f * 3 + k); cz += pos.getZ(f * 3 + k); }
        cx /= 3; cy /= 3; cz /= 3;
        const zone = spaceIn(cx, cy, cz);
        const bad = zone && !rule.keepZones.has(zone);
        keep[f] = bad ? 0 : 1;
        if (bad) drop++;
      }
      if (!drop) return;
      if (drop === n) { o.visible = false; o.layers.disableAll(); tris += drop; meshes++; return; }
      for (const name of Object.keys(g.attributes)) {
        const a = g.attributes[name], is = a.itemSize, src = a.array;
        const out = new src.constructor((n - drop) * 3 * is);
        let w = 0;
        for (let f = 0; f < n; f++) if (keep[f]) { out.set(src.subarray(f * 3 * is, (f + 1) * 3 * is), w); w += 3 * is; }
        g.setAttribute(name, new a.constructor(out, is, a.normalized));
      }
      g.computeBoundingSphere(); g.computeBoundingBox();
      tris += drop; meshes++;
    });
  }
  const ms = performance.now() - t0;
  console.log(`[render] intrusion clip: ${tris} triangles removed from ${meshes} meshes (${ms.toFixed(0)} ms)`);
  return { tris, meshes, ms };
}

const IDENT = new THREE.Matrix4();
