// =============================================================================
// Crowd navigation support built on top of world/nav.js:
//
//  * FieldStore — destination-keyed flow fields (Uint16 decimetres), computed
//    in a Web Worker (sync fallback in Node / if workers fail), LRU-cached and
//    ref-counted so thousands of agents share a few dozen fields.
//    Fields add crowd-specific costs the shared nav doesn't have:
//      - wall clearance penalty (people walk away from walls, not hugging them)
//      - paid-area penalty for trips that aren't catching a train
//      - cut edges across ticket-gate fences (only gate lanes are passable)
//  * Cheap grid collision (per-cell open-side masks) for thousands of agents
//  * Local BFS paths inside a rectangle (platforms, shop interiors, gardens)
// =============================================================================
import { CELL } from '../world/world.js';
import { dijkstra } from './fieldworker.js';

const UNREACH = 65535;

export class FieldStore {
  constructor(nav, world, opts = {}) {
    this.nav = nav; this.world = world;
    this.N = nav.N;
    this.entries = new Map();     // key -> entry
    this.queue = [];              // pending entries (not yet sent)
    this.inflight = 0;
    this.maxFields = opts.maxFields || 140;
    this.stats = { computed: 0, ms: 0, evicted: 0 };
    this._seq = 0;
    this._idc = 0;
    this._byId = new Map();
    this._prep();
    this._startWorker(opts.worker !== false);
  }

  // ---------------------------------------------------------------------------
  _prep() {
    const nav = this.nav, W = this.world, N = this.N;
    // --- clearance penalty per node --------------------------------------------
    const penalty = new Float32Array(N);
    this.clear = new Uint8Array(N); // clearance in cells (1 = touching a wall), capped 6
    for (const lv of nav.levelNames) {
      const g = W.grids[lv], map = nav.cellNode[lv];
      const w = g.w, h = g.h, n = w * h;
      const d = new Uint8Array(n).fill(255);
      const q = new Int32Array(n); let qh = 0, qt = 0;
      for (let i = 0; i < n; i++) if (map[i] < 0 && g.type[i] !== CELL.RAMP) { d[i] = 0; q[qt++] = i; }
      // ramps are walkable-ish: treat their footprint as distance 1 so mouths aren't penalised much
      for (let i = 0; i < n; i++) if (g.type[i] === CELL.RAMP) { d[i] = 1; q[qt++] = i; }
      while (qh < qt) {
        const i = q[qh++]; const cx = i % w, cz = (i / w) | 0; const nd = d[i] + 1;
        if (nd > 6) continue;
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const x = cx + dx, z = cz + dz; if (x < 0 || z < 0 || x >= w || z >= h) continue;
          const j = z * w + x; if (d[j] > nd) { d[j] = nd; q[qt++] = j; }
        }
      }
      for (let i = 0; i < n; i++) {
        const v = map[i]; if (v < 0) continue;
        const c = Math.min(6, d[i]);
        this.clear[v] = c;
        penalty[v] = c <= 1 ? 0.9 : c === 2 ? 0.3 : c === 3 ? 0.06 : 0;
      }
    }
    for (let v = 0; v < N; v++) if (nav.rmp[v] >= 0) this.clear[v] = 2;
    this.penalty = penalty;

    // --- gate lines: cut edges that cross the gate line outside lanes ----------
    const cutIn = new Uint8Array(nav.inSrc.length);
    const cutOut = new Uint8Array(nav.outDst.length);
    const flood = new Uint8Array(nav.outDst.length); // edges cut for the paid-area flood (whole line)
    this.gates = [];
    for (const gt of W.layout.gates) {
      const lv = gt.level; if (!W.grids[lv] || nav.levelIdx[lv] == null) continue;
      const lvI = nav.levelIdx[lv];
      const lanes = [];
      const m = gt.machines || [];
      for (let i = 0; i + 1 < m.length; i++) lanes.push((m[i] + m[i + 1]) / 2);
      const fence = gt.fence || [[gt.from - 30, gt.from], [gt.to, gt.to + 30]];
      const lo = fence[0][0], hi = fence[1][1];
      const G = { gt, id: gt.id, level: lv, axis: gt.axis, at: gt.at, from: gt.from, to: gt.to, lo, hi, lanes, laneW: gt.laneWidth || 1,
        busy: new Float32Array(lanes.length), occDir: new Int8Array(lanes.length), load: new Float32Array(lanes.length), paidSide: 0 };
      this.gates.push(G);
      const crosses = (u, v) => {
        if (nav.lvl[u] !== lvI || nav.lvl[v] !== lvI || nav.rmp[u] >= 0 || nav.rmp[v] >= 0) return null;
        const a = gt.axis === 'x' ? nav.z[u] : nav.x[u], b = gt.axis === 'x' ? nav.z[v] : nav.x[v];
        if ((a - gt.at) * (b - gt.at) >= 0) return null;
        const t = (gt.at - a) / (b - a);
        const p = gt.axis === 'x' ? nav.x[u] + (nav.x[v] - nav.x[u]) * t : nav.z[u] + (nav.z[v] - nav.z[u]) * t;
        if (p < lo - 1 || p > hi + 1) return null;
        return p;
      };
      const allowed = (p) => {
        if (p <= gt.from + 0.3 || p >= gt.to - 0.3) return false;
        for (const mx of m) if (Math.abs(p - mx) < 0.45) return false;
        return true;
      };
      // candidate nodes: the two rows/columns of cells either side of the line
      const g = W.grids[lv], map = nav.cellNode[lv];
      for (const off of [-0.5, 0.5]) {
        for (let p = Math.floor(lo) - 1; p <= Math.ceil(hi) + 1; p++) {
          const x = gt.axis === 'x' ? p + 0.5 : gt.at + off, z = gt.axis === 'x' ? gt.at + off : p + 0.5;
          const ci = g.cellOf(x, z); if (ci < 0) continue;
          const u = map[ci]; if (u < 0) continue;
          for (let e = nav.outStart[u]; e < nav.outStart[u + 1]; e++) {
            const c = crosses(u, nav.outDst[e]); if (c == null) continue;
            flood[e] = 1;
            if (!allowed(c)) cutOut[e] = 1;
          }
          for (let e = nav.inStart[u]; e < nav.inStart[u + 1]; e++) {
            const c = crosses(nav.inSrc[e], u); if (c == null) continue;
            if (!allowed(c)) cutIn[e] = 1;
          }
        }
      }
    }
    this.cutIn = cutIn; this.cutOut = cutOut;

    // --- paid region: flood from platforms / paid spaces without crossing gates
    const paid = new Uint8Array(N);
    const L = W.layout;
    const seeds = [];
    for (const lv of nav.levelNames) {
      const g = W.grids[lv], map = nav.cellNode[lv];
      for (let i = 0; i < map.length; i++) {
        const v = map[i]; if (v < 0) continue;
        const s = L.spaces[g.space[i]];
        if (s && (s.kind === 'platform' || s.paid)) seeds.push(v);
      }
    }
    const q = new Int32Array(N); let qh = 0, qt = 0;
    for (const v of seeds) { if (!paid[v]) { paid[v] = 1; q[qt++] = v; } }
    while (qh < qt) {
      const u = q[qh++];
      for (let e = nav.outStart[u]; e < nav.outStart[u + 1]; e++) {
        if (flood[e]) continue;
        const v = nav.outDst[e]; if (!paid[v]) { paid[v] = 1; q[qt++] = v; }
      }
    }
    if (qt > N * 0.35) { console.warn('[crowd] paid-area flood leaked; ignoring paid areas'); paid.fill(0); }
    this.paid = paid;
    this.paidCount = qt;
    for (const G of this.gates) {
      const g = W.grids[G.level], map = nav.cellNode[G.level];
      const mid = (G.from + G.to) / 2;
      const probe = (off) => { const x = G.axis === 'x' ? mid : G.at + off, z = G.axis === 'x' ? G.at + off : mid; const i = g.cellOf(x, z); return i >= 0 && map[i] >= 0 ? paid[map[i]] : 0; };
      G.paidSide = probe(1.5) ? 1 : probe(-1.5) ? -1 : 0;
    }
  }

  _startWorker(want) {
    this.worker = null;
    if (!want || typeof Worker === 'undefined') return;
    try {
      const w = new Worker(new URL('./fieldworker.js', import.meta.url), { type: 'module' });
      const nav = this.nav;
      w.postMessage({ type: 'init', N: this.N, inStart: nav.inStart, inSrc: nav.inSrc, inCost: nav.inCost, penalty: this.penalty, paid: this.paid, cut: this.cutIn });
      w.onmessage = (ev) => this._onResult(ev.data);
      w.onerror = (e) => { console.warn('[crowd] field worker failed, falling back to main thread', e.message || e); this.worker = null; this.inflight = 0; for (const en of this._byId.values()) { if (!en.ready) this.queue.unshift(en); } this._byId.clear(); };
      this.worker = w;
    } catch (e) { console.warn('[crowd] no field worker', e); this.worker = null; }
  }

  _onResult(m) {
    const en = this._byId.get(m.id); this._byId.delete(m.id);
    this.inflight = Math.max(0, this.inflight - 1);
    if (!en) return;
    en.dist = m.dist; en.ready = true;
    this.stats.computed++; this.stats.ms += m.ms || 0;
  }

  // Request a field. goals: array of node ids (or a function returning one).
  // Returns the entry (may not be ready yet). priority: lower = sooner.
  request(key, goals, { paidOk = false, priority = 5 } = {}) {
    let en = this.entries.get(key);
    if (en) { en.used = this._seq; if (!en.ready && priority < en.priority) { en.priority = priority; this._sortQ = true; } return en; }
    en = { key, ready: false, dist: null, goals: null, goalsFn: goals, paidOk, priority, refs: 0, used: this._seq, id: 0 };
    this.entries.set(key, en);
    this.queue.push(en); this._sortQ = true;
    return en;
  }
  get(key) { return this.entries.get(key) || null; }
  ref(en) { if (en) en.refs++; }
  unref(en) { if (en) en.refs = Math.max(0, en.refs - 1); }

  // Pump the queue. Call every frame. budgetMs applies to the sync fallback.
  update(budgetMs = 6) {
    this._seq++;
    if (this._sortQ) { this.queue.sort((a, b) => a.priority - b.priority); this._sortQ = false; }
    if (this.worker) {
      while (this.queue.length && this.inflight < 3) {
        const en = this.queue.shift();
        const goals = this._goals(en);
        en.id = ++this._idc;
        this._byId.set(en.id, en);
        this.inflight++;
        this.worker.postMessage({ type: 'field', id: en.id, goals, paidOk: en.paidOk });
      }
    } else if (this.syncInUpdate !== false) {
      const t0 = now();
      while (this.queue.length && now() - t0 < budgetMs) this.computeNow(this.queue.shift());
    }
    if (this.entries.size > this.maxFields) this._evict();
  }
  computeNow(en) {
    const t = now();
    if (!this._G) this._G = { N: this.N, inStart: this.nav.inStart, inSrc: this.nav.inSrc, inCost: this.nav.inCost, penalty: this.penalty, paid: this.paid, cut: this.cutIn };
    en.dist = dijkstra(this._G, this._goals(en), en.paidOk);
    en.ready = true;
    this.stats.computed++; this.stats.ms += now() - t;
  }
  flushSync() { while (this.queue.length) this.computeNow(this.queue.shift()); }
  _goals(en) {
    if (!en.goals) {
      let g = typeof en.goalsFn === 'function' ? en.goalsFn() : en.goalsFn;
      en.goals = Int32Array.from((g || []).filter(v => v >= 0));
      en.goalsFn = null;
    }
    return en.goals;
  }
  _evict() {
    const list = [...this.entries.values()].filter(e => e.ready && e.refs <= 0 && !e.pinned).sort((a, b) => a.used - b.used);
    let n = this.entries.size - this.maxFields;
    for (const e of list) { if (n-- <= 0) break; this.entries.delete(e.key); this.stats.evicted++; }
  }
  get pending() { return this.queue.length + this.inflight; }

  // --- descent -----------------------------------------------------------------
  // Next node from v descending field en (or -1 at goal / unreachable).
  next(en, v) {
    const d = en.dist, nav = this.nav, cut = this.cutOut;
    let best = -1, bd = d[v];
    if (bd === 0 || bd === UNREACH) return -1;
    for (let e = nav.outStart[v], e1 = nav.outStart[v + 1]; e < e1; e++) {
      if (cut[e]) continue;
      const w = nav.outDst[e];
      const dw = d[w];
      if (dw < bd) { bd = dw; best = w; }
    }
    return best;
  }
  dist(en, v) { const d = en.dist[v]; return d === UNREACH ? Infinity : d * 0.1; }
}

function now() { return (typeof performance !== 'undefined' ? performance : Date).now(); }

// =============================================================================
// Grid collision: per level, per cell bitmask of open sides.
// bit 1: +x open, 2: -x open, 4: +z open, 8: -z open, 16: cell walkable
// =============================================================================
export class GridCollider {
  constructor(nav, world) {
    this.world = world; this.nav = nav;
    this.levels = {};
    for (const lv of nav.levelNames) {
      const g = world.grids[lv], map = nav.cellNode[lv];
      const m = new Uint8Array(g.w * g.h);
      for (let i = 0; i < m.length; i++) {
        const u = map[i]; if (u < 0) continue;
        let bits = 16;
        for (let e = nav.outStart[u]; e < nav.outStart[u + 1]; e++) {
          const v = nav.outDst[e]; if (nav.rmp[v] >= 0) continue;
          const dx = Math.round(nav.x[v] - nav.x[u]), dz = Math.round(nav.z[v] - nav.z[u]);
          if (dx === 1 && dz === 0) bits |= 1; else if (dx === -1 && dz === 0) bits |= 2;
          else if (dz === 1 && dx === 0) bits |= 4; else if (dz === -1 && dx === 0) bits |= 8;
        }
        m[i] = bits;
      }
      this.levels[lv] = { g, m, x0: g.x0, z0: g.z0, w: g.w, h: g.h };
    }
  }
  walkable(level, x, z) {
    const L = this.levels[level]; if (!L) return false;
    const cx = Math.floor(x - L.x0), cz = Math.floor(z - L.z0);
    if (cx < 0 || cz < 0 || cx >= L.w || cz >= L.h) return false;
    return (L.m[cz * L.w + cx] & 16) !== 0;
  }
  // Move a body {x,z,level} from its current position by (dx,dz) with radius r.
  move(b, dx, dz, r) {
    const L = this.levels[b.level]; if (!L) { b.x += dx; b.z += dz; return; }
    const { m, w, h, x0, z0 } = L;
    let cx = Math.floor(b.x - x0), cz = Math.floor(b.z - z0);
    if (cx < 0 || cz < 0 || cx >= w || cz >= h || !(m[cz * w + cx] & 16)) { b.x += dx; b.z += dz; return; }
    // x axis
    let nx = b.x + dx;
    let ncx = Math.floor(nx - x0);
    if (ncx !== cx) {
      const bits = m[cz * w + cx];
      if ((ncx > cx && !(bits & 1)) || (ncx < cx && !(bits & 2)) || Math.abs(ncx - cx) > 1) nx = b.x; else cx = ncx;
    }
    let nz = b.z + dz;
    let ncz = Math.floor(nz - z0);
    if (ncz !== cz) {
      const bits = m[cz * w + cx];
      if ((ncz > cz && !(bits & 4)) || (ncz < cz && !(bits & 8)) || Math.abs(ncz - cz) > 1) nz = b.z; else cz = ncz;
    }
    // radius push from closed sides of the current cell
    const bits = m[cz * w + cx];
    const fx = nx - x0 - cx, fz = nz - z0 - cz;
    if (!(bits & 1) && fx > 1 - r) nx = x0 + cx + 1 - r;
    if (!(bits & 2) && fx < r) nx = x0 + cx + r;
    if (!(bits & 4) && fz > 1 - r) nz = z0 + cz + 1 - r;
    if (!(bits & 8) && fz < r) nz = z0 + cz + r;
    // convex corners: diagonal cell solid while both sides open
    const ffx = nx - x0 - cx, ffz = nz - z0 - cz;
    const sx = ffx > 0.5 ? 1 : -1, sz = ffz > 0.5 ? 1 : -1;
    const ox = sx > 0 ? (bits & 1) : (bits & 2), oz = sz > 0 ? (bits & 4) : (bits & 8);
    if (ox && oz) {
      const ddx = cx + sx, ddz = cz + sz;
      if (ddx >= 0 && ddz >= 0 && ddx < w && ddz < h) {
        const db = m[ddz * w + ddx];
        // diagonal blocked if not walkable or the sides between are closed
        const blocked = !(db & 16) || !(sx > 0 ? (db & 2) : (db & 1)) || !(sz > 0 ? (db & 8) : (db & 4));
        if (blocked) {
          const px = x0 + cx + (sx > 0 ? 1 : 0), pz = z0 + cz + (sz > 0 ? 1 : 0);
          const qx = nx - px, qz = nz - pz, d2 = qx * qx + qz * qz;
          if (d2 < r * r) { const d = Math.sqrt(d2) || 1e-4; nx = px + qx / d * r; nz = pz + qz / d * r; }
        }
      }
    }
    b.x = nx; b.z = nz;
  }
}

// =============================================================================
// Local BFS path inside a rectangle on one level (grid cells, 8-connected).
// Returns an array of [x,z] waypoints (string-pulled) or null.
// =============================================================================
export function localPath(col, level, rect, ax, az, bx, bz) {
  const L = col.levels[level]; if (!L) return null;
  const { m, w, x0, z0 } = L;
  const rx0 = Math.max(0, Math.floor(rect[0] - x0) - 1), rz0 = Math.max(0, Math.floor(rect[1] - z0) - 1);
  const rx1 = Math.min(L.w - 1, Math.ceil(rect[2] - x0) + 1), rz1 = Math.min(L.h - 1, Math.ceil(rect[3] - z0) + 1);
  const RW = rx1 - rx0 + 1, RH = rz1 - rz0 + 1;
  if (RW <= 0 || RH <= 0 || RW * RH > 40000) return null;
  const cell = (x, z) => { const cx = Math.floor(x - x0) - rx0, cz = Math.floor(z - z0) - rz0; return (cx < 0 || cz < 0 || cx >= RW || cz >= RH) ? -1 : cz * RW + cx; };
  const s = cell(ax, az), t = cell(bx, bz);
  if (s < 0 || t < 0) return null;
  const prev = new Int32Array(RW * RH).fill(-2);
  const q = new Int32Array(RW * RH); let qh = 0, qt = 0;
  prev[t] = -1; q[qt++] = t; // BFS from target so we can walk prev from start
  const gi = (i) => (rz0 + ((i / RW) | 0)) * w + rx0 + (i % RW);
  while (qh < qt) {
    const i = q[qh++]; if (i === s) break;
    const bits = m[gi(i)];
    const cx = i % RW, cz = (i / RW) | 0;
    const tryN = (nx, nz, need) => {
      if (nx < 0 || nz < 0 || nx >= RW || nz >= RH) return;
      const j = nz * RW + nx; if (prev[j] !== -2) return;
      if (!(m[gi(j)] & 16) || !need) return;
      prev[j] = i; q[qt++] = j;
    };
    tryN(cx + 1, cz, bits & 1); tryN(cx - 1, cz, bits & 2); tryN(cx, cz + 1, bits & 4); tryN(cx, cz - 1, bits & 8);
  }
  if (prev[s] === -2) return null;
  const pts = [];
  let i = s;
  while (i >= 0) { pts.push([x0 + rx0 + (i % RW) + 0.5, z0 + rz0 + ((i / RW) | 0) + 0.5]); i = prev[i]; }
  pts[0] = [ax, az]; pts[pts.length - 1] = [bx, bz];
  // string pulling with grid line-of-sight
  const out = [pts[0]];
  let k = 0;
  while (k < pts.length - 1) {
    let j = pts.length - 1;
    while (j > k + 1 && !lineClear(col, level, pts[k][0], pts[k][1], pts[j][0], pts[j][1])) j--;
    out.push(pts[j]); k = j;
  }
  out.shift();
  return out;
}

// Grid line-of-sight between two points on one level (respects closed sides).
export function lineClear(col, level, ax, az, bx, bz) {
  const L = col.levels[level]; if (!L) return false;
  const d = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.ceil(d / 0.35));
  const { m, w, h, x0, z0 } = L;
  let pcx = Math.floor(ax - x0), pcz = Math.floor(az - z0);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
    const cx = Math.floor(x - x0), cz = Math.floor(z - z0);
    if (cx < 0 || cz < 0 || cx >= w || cz >= h) return false;
    const b = m[cz * w + cx];
    if (!(b & 16)) return false;
    if (cx !== pcx || cz !== pcz) {
      const pb = m[pcz * w + pcx];
      if (cx > pcx && !(pb & 1)) return false;
      if (cx < pcx && !(pb & 2)) return false;
      if (cz > pcz && !(pb & 4)) return false;
      if (cz < pcz && !(pb & 8)) return false;
      if (cx !== pcx && cz !== pcz) {
        // diagonal step: require an orthogonal route
        const a1 = m[pcz * w + cx], a2 = m[cz * w + pcx];
        if (!(a1 & 16) && !(a2 & 16)) return false;
      }
      pcx = cx; pcz = cz;
    }
  }
  return true;
}
