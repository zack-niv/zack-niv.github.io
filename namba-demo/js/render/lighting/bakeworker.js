// Module worker: bakes light-field levels off the main thread (lighting.js
// splits the levels over a few workers). Receives a plain-data snapshot of the
// world (grids, edges, obstacles, the space flags the bake reads).
import { bakeLevel } from './bake.js?v=f150c03';

class GridProxy {
  constructor(g) { Object.assign(this, g); }
  cellOf(x, z) {
    const cx = Math.floor(x - this.x0), cz = Math.floor(z - this.z0);
    if (cx < 0 || cz < 0 || cx >= this.w || cz >= this.h) return -1;
    return cz * this.w + cx;
  }
  typeAt(x, z) { const i = this.cellOf(x, z); return i < 0 ? 0 : this.type[i]; }
  spaceAt(x, z) { const i = this.cellOf(x, z); return i < 0 ? -1 : this.space[i]; }
}

export function worldFromSnapshot(snap) {
  const grids = {};
  for (const lv in snap.grids) grids[lv] = new GridProxy(snap.grids[lv]);
  return { grids, edges: snap.edges, obstacles: snap.obstacles, layout: { spaces: snap.spaces, ramps: snap.ramps } };
}

self.onmessage = (ev) => {
  const { snap, jobs } = ev.data;
  try {
    const world = worldFromSnapshot(snap);
    for (const j of jobs) {
      const upper = j.upper ? { level: j.upper.level, grid: world.grids[j.upper.level], lights: j.upper.lights } : null;
      const r = bakeLevel(world, j.level, j.lights, upper, {});
      self.postMessage({ ok: true, r }, [r.A.buffer, r.B.buffer, r.C.buffer]);
    }
    self.postMessage({ done: true });
  } catch (e) {
    self.postMessage({ ok: false, error: String(e && e.stack || e) });
  }
};
