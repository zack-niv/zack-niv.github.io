// =============================================================================
// Navigation graph + flow fields.
//
// Nodes: every walkable 1 m cell on every level (not obstacle-blocked) plus a
// chain of nodes along the centreline of every ramp. Edges are directed
// (escalators only go one way). A "field" is the cost-to-destination for every
// node, computed by reverse Dijkstra; agents descend it. Fields are cached by
// key, so a few dozen shared destinations serve thousands of agents.
// =============================================================================
import { CELL } from './world.js?v=f150c03';
import { LEVELS, rampLength, rampEnds } from './layout.js?v=f150c03';

export class Nav {
  constructor(world) {
    this.world = world;
    this.fields = new Map();
    this._build();
  }

  _build() {
    const W = this.world, L = W.layout;
    this.levelBase = {};
    let n = 0;
    const nodeX = [], nodeZ = [], nodeLevel = [], nodeRamp = [];
    this.levelNames = Object.keys(W.grids);
    this.levelIdx = Object.fromEntries(this.levelNames.map((l, i) => [l, i]));
    // cell -> node maps per level
    this.cellNode = {};
    for (const lv of this.levelNames) {
      const g = W.grids[lv];
      const map = new Int32Array(g.w * g.h).fill(-1);
      for (let i = 0; i < map.length; i++) {
        if (g.type[i] === CELL.WALK && !g.blocked[i]) {
          map[i] = n++;
          nodeX.push(g.x0 + (i % g.w) + 0.5); nodeZ.push(g.z0 + Math.floor(i / g.w) + 0.5);
          nodeLevel.push(this.levelIdx[lv]); nodeRamp.push(-1);
        }
      }
      this.cellNode[lv] = map;
    }
    // ramp nodes: one per metre along the centreline
    this.rampNodes = [];
    L.ramps.forEach((r, ri) => {
      const len = rampLength(r);
      const list = [];
      const ends = rampEnds(r);
      for (let k = 0; k < len; k++) {
        const t = (k + 0.5) / len; // 0 at low end
        const x = ends.low.x + (ends.high.x - ends.low.x) * t;
        const z = ends.low.z + (ends.high.z - ends.low.z) * t;
        list.push(n++);
        nodeX.push(x); nodeZ.push(z); nodeLevel.push(this.levelIdx[r.lower]); nodeRamp.push(ri);
      }
      this.rampNodes[ri] = list;
    });
    this.N = n;
    this.x = Float32Array.from(nodeX); this.z = Float32Array.from(nodeZ);
    this.lvl = Uint8Array.from(nodeLevel); this.rmp = Int16Array.from(nodeRamp);

    // directed edges u -> v with cost
    const eu = [], ev = [], ec = [];
    const add = (u, v, c) => { eu.push(u); ev.push(v); ec.push(c); };
    for (const lv of this.levelNames) {
      const g = W.grids[lv], map = this.cellNode[lv];
      const open = (ia, ib, ax, az, bx, bz) => W._edgeKind(lv, g, ia, ib, ax, az, bx, bz) === null;
      for (let cz = 0; cz < g.h; cz++) for (let cx = 0; cx < g.w; cx++) {
        const ia = cz * g.w + cx, u = map[ia];
        if (u < 0) continue;
        const X = g.x0 + cx, Z = g.z0 + cz;
        // east / south (add both directions)
        if (cx + 1 < g.w) { const ib = ia + 1, v = map[ib]; if (v >= 0 && open(ia, ib, X + 1, Z, X + 1, Z + 1)) { add(u, v, 1); add(v, u, 1); } }
        if (cz + 1 < g.h) { const ib = ia + g.w, v = map[ib]; if (v >= 0 && open(ia, ib, X, Z + 1, X + 1, Z + 1)) { add(u, v, 1); add(v, u, 1); } }
        // diagonals SE and SW, only if both orthogonal paths are open
        if (cx + 1 < g.w && cz + 1 < g.h) {
          const ie = ia + 1, is = ia + g.w, ise = ia + g.w + 1, v = map[ise];
          if (v >= 0 && map[ie] >= 0 && map[is] >= 0 &&
            open(ia, ie, X + 1, Z, X + 1, Z + 1) && open(ia, is, X, Z + 1, X + 1, Z + 1) &&
            open(ie, ise, X + 1, Z + 1, X + 2, Z + 1) && open(is, ise, X + 1, Z + 1, X + 1, Z + 2)) { add(u, v, 1.414); add(v, u, 1.414); }
        }
        if (cx > 0 && cz + 1 < g.h) {
          const iw = ia - 1, is = ia + g.w, isw = ia + g.w - 1, v = map[isw];
          if (v >= 0 && map[iw] >= 0 && map[is] >= 0 &&
            open(iw, ia, X, Z, X, Z + 1) && open(ia, is, X, Z + 1, X + 1, Z + 1) &&
            open(isw, is, X, Z + 1, X, Z + 2) && open(iw, isw, X - 1, Z + 1, X, Z + 1)) { add(u, v, 1.414); add(v, u, 1.414); }
        }
      }
    }
    // ramps: chain + connect ends to adjacent level cells
    L.ramps.forEach((r, ri) => {
      const list = this.rampNodes[ri];
      const esc = r.kind === 'escalator';
      // escalators feel "cheap" (you stand and ride) but are one-way; stairs cost more
      const c = esc ? 0.7 : r.kind === 'stairs' ? 1.6 : 1.1;
      for (let k = 0; k + 1 < list.length; k++) {
        if (r.move >= 0) add(list[k], list[k + 1], c);   // upward
        if (r.move <= 0) add(list[k + 1], list[k], c);   // downward
      }
      const ends = rampEnds(r);
      const link = (lv, end, rampNode, upward) => {
        const g = W.grids[lv], map = this.cellNode[lv];
        // cells just outside the end line, across the walk width
        const hw = Math.max(0.5, r.walkWidth / 2);
        const px = end.x + end.dx * 0.5, pz = end.z + end.dz * 0.5;
        const tx = -end.dz, tz = end.dx;
        for (let o = -hw + 0.5; o <= hw - 0.5 + 1e-6; o += 1) {
          const i = g.cellOf(px + tx * o, pz + tz * o);
          if (i < 0) continue;
          const v = map[i]; if (v < 0) continue;
          // entering the ramp from this end goes "up" from the low end
          if (upward) { if (r.move >= 0) add(v, rampNode, 1); if (r.move <= 0) add(rampNode, v, 1); }
          else { if (r.move <= 0) add(v, rampNode, 1); if (r.move >= 0) add(rampNode, v, 1); }
        }
      };
      link(r.lower, ends.low, list[0], true);
      link(r.upper, ends.high, list[list.length - 1], false);
    });
    // reverse CSR (incoming edges per node) for reverse Dijkstra
    const E = eu.length;
    const start = new Int32Array(this.N + 1);
    for (let i = 0; i < E; i++) start[ev[i] + 1]++;
    for (let i = 0; i < this.N; i++) start[i + 1] += start[i];
    const fill = start.slice(0, this.N);
    const src = new Int32Array(E), cost = new Float32Array(E);
    for (let i = 0; i < E; i++) { const p = fill[ev[i]]++; src[p] = eu[i]; cost[p] = ec[i]; }
    this.inStart = start; this.inSrc = src; this.inCost = cost;
    // forward CSR for descending a field
    const fs = new Int32Array(this.N + 1);
    for (let i = 0; i < E; i++) fs[eu[i] + 1]++;
    for (let i = 0; i < this.N; i++) fs[i + 1] += fs[i];
    const ff = fs.slice(0, this.N);
    const dst = new Int32Array(E), fc = new Float32Array(E);
    for (let i = 0; i < E; i++) { const p = ff[eu[i]]++; dst[p] = ev[i]; fc[p] = ec[i]; }
    this.outStart = fs; this.outDst = dst; this.outCost = fc;
    this.edgeCount = E;
  }

  // node for a body {level, x, z, ramp}
  nodeAt(body) {
    if (body.ramp >= 0) {
      const r = this.world.layout.ramps[body.ramp];
      const list = this.rampNodes[body.ramp];
      const ends = rampEnds(r);
      const len = list.length;
      const ax = r.axis === 'x';
      const p = ax ? body.x : body.z, a = ax ? ends.low.x : ends.low.z, b = ax ? ends.high.x : ends.high.z;
      const t = (p - a) / (b - a);
      return list[Math.max(0, Math.min(len - 1, Math.floor(t * len)))];
    }
    const g = this.world.grids[body.level];
    const i = g.cellOf(body.x, body.z);
    if (i < 0) return -1;
    let v = this.cellNode[body.level][i];
    if (v >= 0) return v;
    // blocked/edge cell: search neighbours
    const map = this.cellNode[body.level];
    const cx = i % g.w, cz = (i / g.w) | 0;
    for (let rad = 1; rad <= 2; rad++) for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) {
      const x = cx + dx, z = cz + dz; if (x < 0 || z < 0 || x >= g.w || z >= g.h) continue;
      v = map[z * g.w + x]; if (v >= 0) return v;
    }
    return -1;
  }
  nodeAtPoint(level, x, z) { return this.nodeAt({ level, x, z, ramp: -1 }); }
  nodeLevel(v) { return this.levelNames[this.lvl[v]]; }

  // Cost-to-goal field for a set of goal nodes. Cached by key.
  field(key, goals) {
    let f = this.fields.get(key);
    if (f) return f;
    const N = this.N;
    const dist = new Float32Array(N).fill(Infinity);
    // binary heap of (dist, node)
    const heapN = new Int32Array(N + 16), heapD = new Float32Array(N + 16);
    let hs = 0;
    const push = (v, d) => {
      let i = hs++;
      while (i > 0) { const p = (i - 1) >> 1; if (heapD[p] <= d) break; heapN[i] = heapN[p]; heapD[i] = heapD[p]; i = p; }
      heapN[i] = v; heapD[i] = d;
    };
    const pop = () => {
      const v = heapN[0]; const last = --hs; const ln = heapN[last], ld = heapD[last];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1; if (c >= hs) break;
        if (c + 1 < hs && heapD[c + 1] < heapD[c]) c++;
        if (heapD[c] >= ld) break;
        heapN[i] = heapN[c]; heapD[i] = heapD[c]; i = c;
      }
      heapN[i] = ln; heapD[i] = ld;
      return v;
    };
    // settled flags: float32 rounding otherwise lets equal-cost duplicates re-expand (cascading work)
    const done = new Uint8Array(N);
    for (const gl of goals) { if (gl >= 0) { dist[gl] = 0; push(gl, 0); } }
    const { inStart, inSrc, inCost } = this;
    while (hs > 0) {
      const d0 = heapD[0];
      const v = pop();
      if (done[v]) continue;
      done[v] = 1;
      for (let e = inStart[v]; e < inStart[v + 1]; e++) {
        const u = inSrc[e]; if (done[u]) continue;
        const nd = Math.fround(d0 + inCost[e]);
        if (nd < dist[u]) { dist[u] = nd; if (hs < heapN.length) push(u, nd); }
      }
    }
    f = { key, dist };
    this.fields.set(key, f);
    return f;
  }
  // Field towards a point (snapped to its node).
  fieldToPoint(key, level, x, z) { return this.field(key, [this.nodeAtPoint(level, x, z)]); }

  // Best next node from v in field f (or -1 at goal / unreachable).
  next(f, v) {
    let best = -1, bd = f.dist[v];
    for (let e = this.outStart[v]; e < this.outStart[v + 1]; e++) {
      const w = this.outDst[e];
      const d = f.dist[w] + this.outCost[e] * 0.001; // tie-break
      if (d < bd) { bd = d; best = w; }
    }
    return best;
  }
  // Walking distance (approx metres) from a body to the field's goal.
  distance(f, body) { const v = this.nodeAt(body); return v < 0 ? Infinity : f.dist[v]; }

  // Polyline path (array of nodes) following a field, max n steps.
  path(f, v, n = 2000) {
    const out = [v];
    for (let i = 0; i < n; i++) { const w = this.next(f, v); if (w < 0) break; out.push(w); v = w; }
    return out;
  }
}
