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
import { GeoBatch } from '../../render/geobatch.js?v=517b401';
import { Frame, Painter, NullPainter } from './kit.js?v=517b401';
import { rng, hash } from '../../core/rng.js?v=517b401';
import { CELL } from '../world.js?v=517b401';
import { LEVELS, spaceById } from '../layout.js?v=517b401';

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
    // logic pass: nothing is drawn; begin() switches to a real replay
    this.front = new NullPainter(this.f);
    this.inner = new NullPainter(this.f);
    this.log = []; this.replay = false; this.ri = 0;
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
    this.svc = null;     // service point published to ctx.counters (see service())
  }
  // Replay the build with real painters: every obstacle/clearance query
  // returns what the logic pass decided, so the result is identical.
  // frontGB / innerGB may be null: that half is then not drawn (and, because
  // atlas regions are lazy, costs no canvas work either).
  begin(frontGB, innerGB) {
    this.replay = true; this.ri = 0;
    this.r = rng(hash('shop:' + this.slot.id));
    this.front = frontGB ? new Painter(frontGB, this.f) : new NullPainter(this.f);
    this.inner = innerGB ? new Painter(innerGB, this.f) : new NullPainter(this.f);
    this._spots = this.spots; this._queue = this.queue; this._counter = this.counterPt; this._lights = this.lights;
    this.spots = []; this.queue = []; this.counterPt = null; this.lights = [];
    this.doorCells = this._doorCells0 !== undefined ? this._doorCells0 : this.doorCells;
  }
  end() {
    this.spots = this._spots; this.queue = this._queue; this.counterPt = this._counter; this.lights = this._lights;
    this.replay = false;
  }
  _log(v) { this.log.push(v); return v; }
  // restrict the door to cells [i0, i1) of the front row (counter-type fronts)
  setDoor(i0, i1) {
    i0 = Math.max(this.doorA0, Math.floor(i0)); i1 = Math.min(this.doorA1, Math.ceil(i1));
    if (i1 <= i0) return;
    for (let i = this.doorA0; i < this.doorA1; i++) {
      if (i >= i0 && i < i1) this.occ[i] = RESERVED; else if (this.occ[i] === RESERVED && !(this.cj === 0 && this.ci === i)) this.occ[i] = FREE;
    }
    this.doorCells = [i0, i1];
  }
  // world <-> local
  world(a, d) { return { x: this.f.x(a, d), z: this.f.z(a, d) }; }
  local(x, z) {
    const dx = x - this.f.ox, dz = z - this.f.oz, c = this.f.c, s = this.f.s;
    return { a: dx * c - dz * s, d: dx * s + dz * c };
  }
  _cellsIn(a0, a1, d0, d1) {
    const out = [];
    const A0 = Math.min(a0, a1) - 0.21, A1 = Math.max(a0, a1) + 0.21, D0 = Math.min(d0, d1) - 0.21, D1 = Math.max(d0, d1) + 0.21;
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
    if (this.replay) return this.log[this.ri++];
    return this._log(this._solid(a0, a1, d0, d1, opts));
  }
  _solid(a0, a1, d0, d1, opts) {
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
    // shrink a hair so float error never blocks more cells than _cellsIn predicted
    const cx = (p.x + q.x) / 2, cz = (p.z + q.z) / 2, hx = Math.abs(q.x - p.x) / 2 - 0.01, hz = Math.abs(q.z - p.z) / 2 - 0.01;
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
  // lateral cell range in front of the door that must stay clear
  doorKeep() {
    if (this.doorCells) return this.doorCells;
    const n = this.doorA1 - this.doorA0;
    return n >= 4 ? [this.doorA0 + 1, this.doorA1 - 1] : [this.doorA0, this.doorA1];
  }
  blocksDoor(a0, a1, d0, d1) {
    if (Math.max(d0, d1) < -2.6) return false;
    const [k0, k1] = this.doorKeep();
    const A0 = Math.min(a0, a1) - 0.2, A1 = Math.max(a0, a1) + 0.2;
    for (let i = k0; i < k1; i++) if (i + 0.5 > A0 && i + 0.5 < A1) return true;
    return false;
  }
  nearTactile(a0, a1, d0, d1, m = 0.45) {
    const T = this.env.tactile && this.env.tactile[this.level];
    if (!T) return false;
    const p = this.world((a0 + a1) / 2, (d0 + d1) / 2);
    const r = Math.hypot(a1 - a0, d1 - d0) / 2 + m;
    for (const [ax, az, bx, bz] of T) {
      const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez;
      let t = l2 ? ((p.x - ax) * ex + (p.z - az) * ez) / l2 : 0; t = Math.max(0, Math.min(1, t));
      if (Math.hypot(p.x - ax - ex * t, p.z - az - ez * t) < r) return true;
    }
    return false;
  }
  outside(a0, a1, d0, d1, clear = 3) {
    if (this.replay) return this.log[this.ri++];
    return this._log(this._outside(a0, a1, d0, d1, clear));
  }
  _outside(a0, a1, d0, d1, clear) {
    const g = this.env.world.grids[this.level];
    const A0 = Math.min(a0, a1), A1 = Math.max(a0, a1);
    if (this.blocksDoor(a0, a1, d0, d1) || this.nearTactile(a0, a1, d0, d1)) return false;
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
    if (this.replay) return this.log[this.ri++];
    return this._log(this._outsideClear(a0, a1, d0, d1, clear));
  }
  _outsideClear(a0, a1, d0, d1, clear) {
    const g = this.env.world.grids[this.level];
    if (this.blocksDoor(a0, a1, d0, d1) || this.nearTactile(a0, a1, d0, d1)) return false;
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
  spot(kind, a, d, fa = 0, fd = 1, extra = null) {
    if (this.replay) return null;
    const w = this.world(a, d);
    const s = { x: w.x, z: w.z, level: this.level, yaw: this.f.yaw(fa, fd), kind };
    if (extra) Object.assign(s, extra);
    this.spots.push(s);
    if (kind === 'queue') this.queue.push(s);
    if (kind === 'counter' && !this.counterPt) this.counterPt = s;
    return s;
  }
  // Service point (v2 contract, ctx.counters): where the staff member stands (behind the counter) and where the
  // customer stands to order. Local coords (a, d); staff faces the order spot. Logic pass only (the replay never
  // re-registers). A later call replaces an earlier one.
  service(role, order, staff, extra = null) {
    if (this.replay) return null;
    this.svc = { role, order: { a: order[0], d: order[1] }, staff: { a: staff[0], d: staff[1] } };
    // also keep the crowd-facing spots in step: staff spot (does not path), counter spot (customers queue here)
    const w = this.world(staff[0], staff[1]);
    this.spots = this.spots.filter(s => !(s.kind === 'staff' && s.svc));
    this.spot('staff', staff[0], staff[1], order[0] - staff[0], order[1] - staff[1], { svc: true, role, ...(extra || {}) });
    this.spots = this.spots.filter(s => !(s.kind === 'counter' && s.svc));
    const c = this.spot('counter', order[0], order[1], staff[0] - order[0], staff[1] - order[1], { svc: true });
    if (c) this.counterPt = c;
    void w;
    return this.svc;
  }
  light(a, y, d, color, intensity, range, kind = 'panel') {
    // aggregate: one interior panel + one sign light per shop (featured get extras)
    if (kind !== 'panel' && kind !== 'sign' && !this.b.key) return;
    if (this.lights.some(l => l.kind === kind) && !this.b.key) return;
    const w = this.world(a, d);
    const l = { level: this.level, x: w.x, y: this.y + y, z: w.z, color, intensity, range, kind, shop: this.slot.id };
    if (kind === 'sign') l.dir = [-this.f.s, 0, -this.f.c];   // faces the corridor (local -d)
    this.lights.push(l);
  }
}
