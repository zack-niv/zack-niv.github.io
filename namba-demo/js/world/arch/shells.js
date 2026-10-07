// =============================================================================
// v4 shells: close the back of the set.
//
// Every walkable space is drawn as one-sided skins seen from inside: an
// up-facing floor, a down-facing ceiling and inward-facing walls. There is no
// structure between the skins, so from any vantage point OUTSIDE a space
// (an atrium void, an escalator well, the canyon, a terrace, a glass skywalk)
// the skins are culled and the furnished interior floats in the air:
//   · floors seen from below (furniture "hanging from the ceiling"),
//   · room walls seen from behind (open back rooms behind skywalk glass),
//   · ceilings seen from above (roofless restaurants from the escalators).
// This pass adds the outward-facing half of the shell, merged into the same
// arch chunk batches (materials the chunk already uses, so ~no new draw calls):
//   1. slab soffits: a down-facing face under every indoor floor cell that has
//      no ceiling below it (void / ramp / solid / outdoor below);
//   2. room outer walls: an outward-facing face on every room boundary that is
//      not already walled from the other side (solid mass, outdoor spaces, glass
//      partitions), from the soffit line up to the next slab.
// Slab edges at wells (surfaces.js buildSlabEdges) and roof slabs complete it.
// =============================================================================
import { CELL, EDGE } from '../world.js';
import { styleOf } from './styles.js';
import { face } from './surfaces.js';

const SOFFIT = 0.1;     // soffit line below a floor (m)
const IN = 0.008;       // outer room faces sit this far inside the boundary (behind glass / facades)

export function buildShells(K) {
  const { world, L } = K;
  const st = { soffitQuads: 0, wallFaces: 0 };
  for (const lv of Object.keys(world.grids)) {
    const g = world.grids[lv], y = K.y(lv);
    const bl = K.below(lv), up = K.above(lv);
    // ---- 1. slab soffits ------------------------------------------------------------
    if (bl) {
      for (let cz = 0; cz < g.h; cz++) {
        let run = null;
        const flush = (cx) => {
          if (run === null) return;
          const z0 = g.z0 + cz, x0 = g.x0 + run, x1 = g.x0 + cx;
          K.B(lv, (x0 + x1) / 2, z0 + 0.5).rectH('arch_slab', x0, z0, x1, z0 + 1, y - SOFFIT, false);
          st.soffitQuads++;
          run = null;
        };
        for (let cx = 0; cx <= g.w; cx++) {
          let need = false;
          if (cx < g.w) {
            const i = cz * g.w + cx;
            if (g.type[i] === CELL.WALK && !L.spaces[g.space[i]].outdoor) {
              const c = K.cell(bl, g.x0 + cx + 0.5, g.z0 + cz + 0.5);
              // an indoor space below draws its own ceiling here (void cells too: ceilings.js
              // continues the space's ceiling over its atrium void)
              const ceiled = (c.t === CELL.WALK || c.t === CELL.VOID) && c.sp && !c.sp.outdoor && styleOf(c.sp).ceil && styleOf(c.sp).ceilSys;
              need = !ceiled;
            }
          }
          if (need && run === null) run = cx;
          if (!need) flush(cx);
        }
      }
    }
    // ---- 2. room outer walls --------------------------------------------------------
    const y0 = y - SOFFIT;
    for (const e of world.edges[lv]) {
      const spA = e.spaceA >= 0 ? L.spaces[e.spaceA] : null, spB = e.spaceB >= 0 ? L.spaces[e.spaceB] : null;
      const outs = [];   // [room, outward normal]
      if (e.kind === EDGE.WALL) {
        const walkSp = e.nx < 0 || e.nz < 0 ? spA : e.nx > 0 || e.nz > 0 ? spB : spA;
        if (walkSp && walkSp.kind === 'room' && !walkSp.outdoor) outs.push([walkSp, -e.nx, -e.nz]);
      } else if (e.kind === EDGE.PARTITION) {
        const vert = e.ax === e.bx;
        const nA = vert ? [-1, 0] : [0, -1], nB = vert ? [1, 0] : [0, 1];
        // the other side shows no opaque wall here: outdoors, or a glazed space (skywalk)
        const open = (sp) => !sp || sp.outdoor || styleOf(sp).wall === 'glass';
        if (spA && spA.kind === 'room' && !spA.outdoor && open(spB)) outs.push([spA, nB[0], nB[1]]);
        if (spB && spB.kind === 'room' && !spB.outdoor && open(spA)) outs.push([spB, nA[0], nA[1]]);
      }
      if (!outs.length) continue;
      const b = K.B(lv, (e.ax + e.bx) / 2, (e.az + e.bz) / 2);
      for (const [sp, nx, nz] of outs) {
        const top = up ? K.y(up) - 0.12 : y + sp.ceil + 0.3;
        const mat = styleOf(sp).wall === 'glass' ? 'wall_stone_warm' : styleOf(sp).wall;
        face(b, mat, e.ax, e.az, e.bx, e.bz, y0, top, nx, nz, -IN);
        st.wallFaces++;
      }
    }
  }
  return st;
}
