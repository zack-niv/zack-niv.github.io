// =============================================================================
// ShopCtx: one shop slot in its own local frame + a cell occupancy grid that
// keeps every piece of furniture nav-safe.
//
// Local frame: a = lateral (0..W), d = depth into the shop (0 at the front
// line, W×D cells exactly matching the world's 1 m walk grid), y = up from the
// floor. d < 0 is the corridor in front of the shop.
//
// solid(a0,a1,d0,d1) registers a collision box (world.addBox) only if the door
// stays connected to the rest of the shop (BFS over the cells). The shop's
// centre cell and door cells are reserved: the directory's (x,z) and door
// points are always reachable.
// =============================================================================
import { GeoBatch } from '../../render/geobatch.js';
import { Frame, Painter } from './kit.js';
import { rng, hash } from '../../core/rng.js';
import { CELL } from '../world.js';
import { LEVELS, spaceById } from '../layout.js';

const FREE = 0, SOLID = 1, RESERVED = 2;

export class ShopCtx {
  constructor(env, slot, b) {
    this.env = env; this.slot = slot; this.b = b; this.level = slot.level;
    const [x0, z0, x1, z1] = slot.rect;
    let ox, oz, rot, W, D;
    switch (slot.front) {
      case 'n': ox = x0; oz = z0; rot = 0; W = x1 - x0; D = z1 - z0; break;
      case 's': ox = x1; oz = z1; rot = Math.PI; W = x1 - x0; D = z1 - z0; break;
      case 'w': ox = x0; oz = z1; rot = Math.PI / 2; W = z1 - z0; D = x1 - x0; break;
      default:  ox = x1; oz = z0; rot = -Math.PI / 2; W = z1 - z0; D = x1 - x0; break; // 'e'
    }
    this.W = W; this.D = D;
    this.y = LEVELS[slot.level].y;
    this.f = new Frame(ox, this.y, oz, rot);
    this.r = rng(hash('shop:' + slot.id));
    const sp = spaceById[slot.id];
    this.ceil = sp ? sp.ceil : 3.4;
    // corridor outside
    const mid = this.world(W / 2, -0.5);
    const out = env.world.spaceAt(slot.level, mid.x, mid.z);
    this.outSpace = out;
    this.outCeil = out ? (out.outdoor ? 4.5 : out.ceil) : 3.2;
    this.top = Math.max(this.ceil, this.outCeil);
    this.doorTop = Math.min(2.75, Math.min(this.ceil, this.outCeil) - 0.45);
    // door in local lateral coords
    const [dx0, dz0, dx1, dz1] = slot.door;
    const la = this.local(dx0, dz0).a, lb = this.local(dx1, dz1).a;
    this.doorA0 = Math.round(Math.min(la, lb)); this.doorA1 = Math.round(Math.max(la, lb));
    // painters
    const cw = this.world(W / 2, D / 2);
    this.cx = cw.x; this.cz = cw.z;
    this.front = new Painter(env.chunks.get(slot.level, cw.x, cw.z), this.f);
    this.inner = new Painter(new GeoBatch(), this.f);
    // occupancy
    this.occ = new Uint8Array(W * D);
    for (let i = this.doorA0; i < this.doorA1; i++) this.occ[i] = RESERVED;
    // centre cell (directory point) reserved
    const cc = this.local(b.x, b.z);
    this.ci = Math.min(W - 1, Math.max(0, Math.floor(cc.a))); this.cj = Math.min(D - 1, Math.max(0, Math.floor(cc.d)));
    this.occ[this.cj * W + this.ci] = RESERVED;
    this.reach = this._bfs();
    this.spots = []; this.queue = []; this.counterPt = null; this.boxes = [];
    this.lights = [];
  }
  // world <-> local
  world(a, d) { return { x: this.f.x(a, d), z: this.f.z(a, d) }; }
  local(x, z) {
    const dx = x - this.f.ox, dz = z - this.f.oz, c = this.f.c, s = this.f.s;
    return { a: dx * c - dz * s, d: dx * s + dz * c };
  }
  _cellsIn(a0, a1, d0, d1) {
    const out = [];
    const A0 = Math.min(a0, a1) - 0.2, A1 = Math.max(a0, a1) + 0.2, D0 = Math.min(d0, d1) - 0.2, D1 = Math.max(d0, d1) + 0.2;
    for (let j = Math.max(0, Math.floor(D0)); j <= Math.min(this.D - 1, Math.floor(D1)); j++) {
      if (j + 0.5 <= D0 || j + 0.5 >= D1) continue;
      for (let i = Math.max(0, Math.floor(A0)); i <= Math.min(this.W - 1, Math.floor(A1)); i++) {
        if (i + 0.5 <= A0 || i + 0.5 >= A1) continue;
        out.push(j * this.W + i);
      }
    }
    return out;
  }
  _bfs() {
    const W = this.W, D = this.D, seen = new Uint8Array(W * D), q = [];
    for (let i = this.doorA0; i < this.doorA1; i++) if (this.occ[i] !== SOLID) { seen[i] = 1; q.push(i); }
    while (q.length) {
      const c = q.pop(); const i = c % W, j = (c / W) | 0;
      const nb = [];
      if (i > 0) nb.push(c - 1); if (i < W - 1) nb.push(c + 1); if (j > 0) nb.push(c - W); if (j < D - 1) nb.push(c + W);
      for (const n of nb) if (!seen[n] && this.occ[n] !== SOLID) { seen[n] = 1; q.push(n); }
    }
    return seen;
  }
  free(i, j) { return i >= 0 && j >= 0 && i < this.W && j < this.D && this.occ[j * this.W + i] !== SOLID && this.reach[j * this.W + i]; }
  // Register an interior obstacle. opts.force: skip connectivity test.
  // opts.fill: area is sealed off (back-of-house) — cells become solid.
  solid(a0, a1, d0, d1, opts = {}) {
    const cells = this._cellsIn(a0, a1, d0, d1);
    for (const c of cells) if (this.occ[c] === RESERVED && !opts.force) return false;
    const prev = cells.map(c => this.occ[c]);
    for (const c of cells) this.occ[c] = SOLID;
    const reach = this._bfs();
    if (!opts.force) {
      let lost = 0, door = false;
      for (let k = 0; k < reach.length; k++) if (this.reach[k] && !reach[k] && this.occ[k] !== SOLID) lost++;
      for (let i = this.doorA0; i < this.doorA1; i++) if (this.occ[i] !== SOLID && !reach[i]) door = true;
      const cc = this.cj * this.W + this.ci;
      if (lost > (opts.pocket ?? 2) || door || !reach[cc]) { cells.forEach((c, k) => { this.occ[c] = prev[k]; }); return false; }
    }
    this.reach = reach;
    this._addBox(a0, a1, d0, d1);
    return true;
  }
  _addBox(a0, a1, d0, d1) {
    const p = this.world(a0, d0), q = this.world(a1, d1);
    const cx = (p.x + q.x) / 2, cz = (p.z + q.z) / 2, hx = Math.abs(q.x - p.x) / 2, hz = Math.abs(q.z - p.z) / 2;
    this.env.world.addBox(this.level, cx, cz, Math.max(0.02, hx), Math.max(0.02, hz), 0);
    this.boxes.push([cx, cz, hx, hz]);
  }
  // test whether a free (unblocked) area exists in the shop: all cells free & reachable
  areaFree(a0, a1, d0, d1) {
    const cells = this._cellsIn(a0, a1, d0, d1);
    return cells.every(c => this.occ[c] === FREE && this.reach[c]);
  }
  // Corridor obstacle in front of the shop (d < 0). Only if the corridor
  // stays clear for `clear` metres beyond it.
  outside(a0, a1, d0, d1, clear = 3) {
    const g = this.env.world.grids[this.level];
    const A0 = Math.min(a0, a1), A1 = Math.max(a0, a1);
    for (let a = Math.floor(A0) + 0.5; a < A1 + 0.5; a += 1) {
      for (let d = Math.min(d0, d1) - clear; d < Math.max(d0, d1) + 0.01; d += 0.5) {
        if (d > -0.05) continue;
        const w = this.world(Math.min(Math.max(a, A0), A1), d);
        const i = g.cellOf(w.x, w.z);
        if (i < 0 || g.type[i] !== CELL.WALK || g.blocked[i]) return false;
        const s = this.env.world.layout.spaces[g.space[i]];
        if (!s || s.kind === 'room') return false;
      }
    }
    this._addBox(a0, a1, d0, d1);
    return true;
  }
  // corridor area check without registering
  outsideClear(a0, a1, d0, d1, clear = 3) {
    const g = this.env.world.grids[this.level];
    for (let a = Math.min(a0, a1) + 0.25; a < Math.max(a0, a1); a += 0.5) {
      for (let d = Math.min(d0, d1) - clear; d < Math.max(d0, d1); d += 0.5) {
        if (d > -0.05) continue;
        const w = this.world(a, d);
        const i = g.cellOf(w.x, w.z);
        if (i < 0 || g.type[i] !== CELL.WALK || g.blocked[i]) return false;
        const s = this.env.world.layout.spaces[g.space[i]];
        if (!s || s.kind === 'room') return false;
      }
    }
    return true;
  }
  // a spot for the crowd: kind browse|counter|queue|seat|staff; facing local dir
  spot(kind, a, d, fa = 0, fd = 1) {
    const w = this.world(a, d);
    const s = { x: w.x, z: w.z, level: this.level, yaw: this.f.yaw(fa, fd), kind };
    this.spots.push(s);
    if (kind === 'queue') this.queue.push(s);
    if (kind === 'counter' && !this.counterPt) this.counterPt = s;
    return s;
  }
  light(a, y, d, color, intensity, range, kind = 'panel') {
    const w = this.world(a, d);
    this.lights.push({ level: this.level, x: w.x, y: this.y + y, z: w.z, color, intensity, range, kind, shop: this.slot.id });
  }
}
