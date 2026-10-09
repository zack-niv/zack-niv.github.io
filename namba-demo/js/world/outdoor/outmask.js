// Outdoor mask + "distance to daylight" field per level, from the walk grid.
//   isOutdoor(level, x, z)      -> true on outdoor walk cells / garden stairs
//   distance(level, x, z)       -> metres (walking) to the nearest outdoor cell, capped at 255
import { CELL } from '../world.js?v=454ed73';

export class OutdoorMask {
  constructor(world) {
    this.world = world;
    const L = world.layout;
    this.mask = {}; this.dist = {};
    // ramp outdoorness: a ramp is outdoor when both ends land in outdoor spaces
    const rampOut = L.ramps.map(r => r.zone === 'parksGarden');
    this.rampOut = rampOut;
    const rampLeak = L.ramps.map(r => /^stair_exit/.test(r.bank || r.id) || r.zone === 'parksGarden');
    for (const lv in world.grids) {
      const g = world.grids[lv];
      const n = g.w * g.h;
      const m = new Uint8Array(n), d = new Uint8Array(n).fill(255);
      const q = new Int32Array(n * 2);
      let qh = 0, qt = 0;
      for (let i = 0; i < n; i++) {
        const t = g.type[i];
        if (t === CELL.WALK) {
          const s = L.spaces[g.space[i]];
          if (s.outdoor) { m[i] = 1; d[i] = 0; q[qt++] = i; }
          else if (s.outdoorish) { d[i] = 8; q[qt++] = i; }
        } else if (t === CELL.RAMP) {
          const ri = g.ramp[i];
          if (rampOut[ri]) { m[i] = 1; d[i] = 0; q[qt++] = i; }
          else if (rampLeak[ri]) { d[i] = 6; q[qt++] = i; }
        }
      }
      // BFS (unit cost) through walkable / ramp / void cells (voids carry light)
      while (qh < qt) {
        const i = q[qh++];
        const cx = i % g.w, cz = (i / g.w) | 0;
        const nd = d[i] + 1;
        if (nd >= 255) continue;
        const nb = [cx > 0 ? i - 1 : -1, cx < g.w - 1 ? i + 1 : -1, cz > 0 ? i - g.w : -1, cz < g.h - 1 ? i + g.w : -1];
        for (const j of nb) {
          if (j < 0 || d[j] <= nd) continue;
          const t = g.type[j];
          if (t === CELL.SOLID || t === CELL.TRACK) continue;
          d[j] = nd; q[qt++] = j;
        }
      }
      this.mask[lv] = m; this.dist[lv] = d;
    }
  }
  isOutdoor(level, x, z) {
    const g = this.world.grids[level]; if (!g) return false;
    const i = g.cellOf(x, z); if (i < 0) return false;
    return this.mask[level][i] === 1;
  }
  distance(level, x, z) {
    const g = this.world.grids[level]; if (!g) return 255;
    const i = g.cellOf(x, z); if (i < 0) return 255;
    return this.dist[level][i];
  }
}
