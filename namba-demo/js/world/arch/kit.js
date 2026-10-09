// =============================================================================
// Architecture kit: shared state for every arch/* builder.
//   K.B(level, x, z)            -> GeoBatch for the 48 m chunk containing (x, z)
//   K.light({...})              -> ctx.lighting.addLight (guarded, counted)
//   K.cell(level, x, z)         -> { t, si, sp, ri } at a world point
//   K.isHole(level, x, z)       -> open to the level below (void / ramp well)
//   K.ceilAt(level, x, z)       -> absolute ceiling height of the walkable
//                                  space there (null if outdoor / none)
//   K.reserve(level, x, z, r)   -> keep a disc clear of structure (columns)
//   K.clear(level, x, z, r)     -> true if no reservation / obstacle overlaps
// =============================================================================
import { GeoBatch } from '../../render/geobatch.js?v=454ed73';
import { CELL } from '../world.js?v=454ed73';
import { LEVELS, LEVEL_ORDER } from '../layout.js?v=454ed73';

export const CHUNK = 48;
// Namba Parks (z >= 212, every floor from 2F up) is merged into ONE chunk per level: from the canyon, the
// gardens and the dining floors dozens of 48 m chunk x material meshes were visible at once (700+ draw calls).
export const PARKS_MERGE = { z0: 212, yMin: 6, x: 49, z: 300, r: 132 };

// light colours (sRGB hex) by mood — colour temperature approximations
export const KELVIN = {
  metro: 0xe8f0ff,     // ~6000 K cool white (Osaka Metro)
  terminal: 0xf3f1ec,  // ~4800 K neutral (Nankai)
  passage: 0xeef2fa,   // ~5500 K
  mall: 0xffeadb,      // ~3800 K (Namba CITY, NAMBAWALK courts)
  arcade: 0xfff0dc,    // ~4000 K (NAMBAWALK)
  depachika: 0xffe3c4, // ~3400 K warm & bright
  parks: 0xffd6a6,     // ~3000 K
  dining: 0xffc890,    // ~2700 K
};

export class Kit {
  constructor(ctx) {
    this.ctx = ctx;
    this.world = ctx.world;
    this.L = ctx.world.layout;
    this.batches = new Map();
    this.lightCount = 0;
    this.reserved = {};   // level -> [{x,z,r}]
    this.lightLog = [];
    this.ceilFns = {};    // space id -> (x, z) => absolute ceiling height (vaults, roofs)
  }
  B(lv, x, z) {
    const k = z >= PARKS_MERGE.z0 && LEVELS[lv].y >= PARKS_MERGE.yMin ? `${lv}|P|P` : `${lv}|${Math.floor(x / CHUNK)}|${Math.floor(z / CHUNK)}`;
    let b = this.batches.get(k);
    if (!b) this.batches.set(k, b = new GeoBatch());
    return b;
  }
  light(o) {
    this.lightCount++;
    const lt = this.ctx.lighting;
    if (lt && lt.addLight) {
      try { return lt.addLight(o); } catch (e) { /* lighting not ready */ }
    }
    return -1;
  }
  y(lv) { return LEVELS[lv].y; }
  grid(lv) { return this.world.grids[lv]; }
  below(lv) { const i = LEVEL_ORDER.indexOf(lv); return i > 0 ? LEVEL_ORDER[i - 1] : null; }
  above(lv) { const i = LEVEL_ORDER.indexOf(lv); return i >= 0 && i < LEVEL_ORDER.length - 1 ? LEVEL_ORDER[i + 1] : null; }
  cell(lv, x, z) {
    const g = this.grid(lv);
    if (!g) return { t: CELL.SOLID, si: -1, sp: null, ri: -1 };
    const i = g.cellOf(x, z);
    if (i < 0) return { t: CELL.SOLID, si: -1, sp: null, ri: -1 };
    const si = g.space[i];
    return { t: g.type[i], si, sp: si >= 0 ? this.L.spaces[si] : null, ri: g.ramp[i] };
  }
  // open to the level below at (x, z) on level lv
  isHole(lv, x, z) {
    const c = this.cell(lv, x, z);
    if (c.t === CELL.VOID) return true;
    if (c.t === CELL.RAMP) return this.L.ramps[c.ri].upper === lv;
    return false;
  }
  ceilAt(lv, x, z) {
    const c = this.cell(lv, x, z);
    if (c.t !== CELL.WALK || !c.sp || c.sp.outdoor) return null;
    const f = this.ceilFns[c.sp.id];
    return f ? f(x, z) : this.y(lv) + c.sp.ceil;
  }
  reserve(lv, x, z, r) { (this.reserved[lv] || (this.reserved[lv] = [])).push({ x, z, r }); }
  clear(lv, x, z, r) {
    for (const q of this.reserved[lv] || []) if (Math.hypot(q.x - x, q.z - z) < q.r + r) return false;
    for (const o of this.world.obstacles[lv] || []) if (Math.abs(o.cx - x) < o.hx + r && Math.abs(o.cz - z) < o.hz + r) return false;
    return true;
  }
  // all cells of a level whose space index is si
  forCells(lv, si, fn) {
    const g = this.grid(lv);
    for (let cz = 0; cz < g.h; cz++) for (let cx = 0; cx < g.w; cx++) {
      const i = cz * g.w + cx;
      if (g.space[i] === si && g.type[i] === CELL.WALK) fn(g.x0 + cx, g.z0 + cz, i);
    }
  }
  // runs of cells along a line (axis 'x' at z=c or 'z' at x=c) from a to b
  // where pred(cellInfo) is true; returns [[a0, a1], ...]
  runs(lv, axis, c, a, b, pred) {
    const out = [];
    let s = null;
    for (let p = Math.floor(a); p < Math.ceil(b); p++) {
      const ok = pred(axis === 'x' ? this.cell(lv, p + 0.5, c) : this.cell(lv, c, p + 0.5), p);
      if (ok && s === null) s = Math.max(p, a);
      if (!ok && s !== null) { out.push([s, p]); s = null; }
    }
    if (s !== null) out.push([s, Math.min(Math.ceil(b), b)]);
    return out;
  }
}
