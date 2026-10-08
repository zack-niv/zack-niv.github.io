// =============================================================================
// Route helpers on the nav flow fields (no THREE / DOM — worker-safe).
//
// computeDirections(nav, faces, dests)
//   For every sign face (a viewer point) and every destination, descend the
//   destination's flow field from the viewer for ~18 m (or into the first
//   escalator/stairs) and report where the true shortest path heads first.
//   Returns Float32Array [NF * ND * STRIDE]:
//     0 dist      field cost to the destination (≈ metres), NaN = unreachable
//     1 ex, 2 ez  point ~18 m along the path (bearing target)
//     3 ramp      index of first ramp the path enters (−1 none)
//     4 rampAt    path length (m) at which that ramp is entered
//     5 dir       +1 path goes up there, −1 down, 0 none
//     6 toLevel   LEVEL_ORDER index of the level the ramp leads to
// =============================================================================
import { LEVEL_ORDER } from '../../world/layout.js?v=6c67dba';

export const STRIDE = 7;

// ---- fare-gate audience ------------------------------------------------------
// Signs and phone directions for anything that is not a train line must never
// send you INTO the paid area (through the ticket gates, onto a platform).
// paidMasks() floods the paid region (platforms + paid spaces) without crossing
// any gate line and marks edges free -> paid; fieldNoEntry() builds a field
// that refuses them and walkPath/routeLegs honour f.cutOut.
export function paidMasks(nav) {
  if (nav._wayPaid) return nav._wayPaid;
  const W = nav.world, L = W.layout, N = nav.N;
  const flood = new Uint8Array(nav.outDst.length);
  for (const gt of L.gates) {
    const lv = gt.level; if (!W.grids[lv] || nav.levelIdx[lv] == null) continue;
    const lvI = nav.levelIdx[lv];
    const fence = gt.fence || [[gt.from - 30, gt.from], [gt.to, gt.to + 30]];
    const lo = fence[0][0], hi = fence[1][1];
    const g = W.grids[lv], map = nav.cellNode[lv];
    for (const off of [-0.5, 0.5]) for (let p = Math.floor(lo) - 1; p <= Math.ceil(hi) + 1; p++) {
      const x = gt.axis === 'x' ? p + 0.5 : gt.at + off, z = gt.axis === 'x' ? gt.at + off : p + 0.5;
      const ci = g.cellOf(x, z); if (ci < 0) continue;
      const u = map[ci]; if (u < 0) continue;
      for (let e = nav.outStart[u]; e < nav.outStart[u + 1]; e++) {
        const w = nav.outDst[e];
        if (nav.lvl[u] !== lvI || nav.lvl[w] !== lvI || nav.rmp[u] >= 0 || nav.rmp[w] >= 0) continue;
        const a = gt.axis === 'x' ? nav.z[u] : nav.x[u], b = gt.axis === 'x' ? nav.z[w] : nav.x[w];
        if ((a - gt.at) * (b - gt.at) >= 0) continue;
        const t = (gt.at - a) / (b - a);
        const pp = gt.axis === 'x' ? nav.x[u] + (nav.x[w] - nav.x[u]) * t : nav.z[u] + (nav.z[w] - nav.z[u]) * t;
        if (pp < lo - 1 || pp > hi + 1) continue;
        flood[e] = 1;
      }
    }
  }
  const paid = new Uint8Array(N), q = new Int32Array(N); let qh = 0, qt = 0;
  for (const lv of nav.levelNames) {
    const g = W.grids[lv], map = nav.cellNode[lv];
    for (let i = 0; i < map.length; i++) {
      const v = map[i]; if (v < 0) continue;
      const s = L.spaces[g.space[i]];
      if (s && (s.kind === 'platform' || s.paid) && !paid[v]) { paid[v] = 1; q[qt++] = v; }
    }
  }
  while (qh < qt) {
    const u = q[qh++];
    for (let e = nav.outStart[u]; e < nav.outStart[u + 1]; e++) { if (flood[e]) continue; const v = nav.outDst[e]; if (!paid[v]) { paid[v] = 1; q[qt++] = v; } }
  }
  if (qt > N * 0.35) paid.fill(0);   // leaked: don't pretend
  const cutOut = new Uint8Array(nav.outDst.length), cutIn = new Uint8Array(nav.inSrc.length);
  for (let u = 0; u < N; u++) if (!paid[u]) for (let e = nav.outStart[u]; e < nav.outStart[u + 1]; e++) if (paid[nav.outDst[e]]) cutOut[e] = 1;
  for (let v = 0; v < N; v++) if (paid[v]) for (let e = nav.inStart[v]; e < nav.inStart[v + 1]; e++) if (!paid[nav.inSrc[e]]) cutIn[e] = 1;
  return (nav._wayPaid = { paid, cutOut, cutIn, count: qt });
}

// Cost-to-goal field that never enters the paid area from outside.
export function fieldNoEntry(nav, key, goals) {
  let f = nav.fields.get(key); if (f) return f;
  const { cutIn, cutOut } = paidMasks(nav);
  const N = nav.N, dist = new Float32Array(N).fill(Infinity), done = new Uint8Array(N);
  const heapN = new Int32Array(N + 16), heapD = new Float32Array(N + 16); let hs = 0;
  const push = (v, d) => { let i = hs++; while (i > 0) { const p = (i - 1) >> 1; if (heapD[p] <= d) break; heapN[i] = heapN[p]; heapD[i] = heapD[p]; i = p; } heapN[i] = v; heapD[i] = d; };
  for (const gl of goals) if (gl >= 0) { dist[gl] = 0; push(gl, 0); }
  const { inStart, inSrc, inCost } = nav;
  while (hs > 0) {
    const d0 = heapD[0], v = heapN[0]; const last = --hs; const ln = heapN[last], ld = heapD[last]; let i = 0;
    for (;;) { let c = 2 * i + 1; if (c >= hs) break; if (c + 1 < hs && heapD[c + 1] < heapD[c]) c++; if (heapD[c] >= ld) break; heapN[i] = heapN[c]; heapD[i] = heapD[c]; i = c; }
    heapN[i] = ln; heapD[i] = ld;
    if (done[v]) continue; done[v] = 1;
    for (let e = inStart[v]; e < inStart[v + 1]; e++) {
      if (cutIn[e]) continue;
      const u = inSrc[e]; if (done[u]) continue;
      const nd = Math.fround(d0 + inCost[e]);
      if (nd < dist[u]) { dist[u] = nd; if (hs < heapN.length) push(u, nd); }
    }
  }
  f = { key, dist, cutOut };
  nav.fields.set(key, f);
  return f;
}
function stepNext(nav, f, v) {
  if (!f.cutOut) return nav.next(f, v);
  let best = -1, bd = f.dist[v];
  for (let e = nav.outStart[v]; e < nav.outStart[v + 1]; e++) {
    if (f.cutOut[e]) continue;
    const w = nav.outDst[e];
    const d = f.dist[w] + nav.outCost[e] * 0.001;
    if (d < bd) { bd = d; best = w; }
  }
  return best;
}

export function walkPath(nav, f, v, maxLen = 18, rampExtra = 5) {
  const L = nav.world.layout;
  let x = nav.x[v], z = nav.z[v];
  let acc = 0, ramp = -1, rampAt = 0, dir = 0, toLevel = -1, onRampAcc = 0;
  let prevLevel = nav.levelNames[nav.lvl[v]];
  let cur = v;
  for (let i = 0; i < 400; i++) {
    const w = stepNext(nav, f, cur);
    if (w < 0) break;
    const wx = nav.x[w], wz = nav.z[w];
    const step = Math.hypot(wx - x, wz - z);
    const ri = nav.rmp[w];
    if (ri >= 0 && ramp < 0) {
      ramp = ri; rampAt = acc;
      const r = L.ramps[ri];
      dir = prevLevel === r.lower ? 1 : -1;
      toLevel = LEVEL_ORDER.indexOf(dir > 0 ? r.upper : r.lower);
    }
    if (ri < 0) prevLevel = nav.levelNames[nav.lvl[w]];
    acc += step; x = wx; z = wz; cur = w;
    if (ramp >= 0) { onRampAcc += step; if (onRampAcc >= rampExtra) break; }
    if (acc >= maxLen) break;
  }
  return { x, z, acc, ramp, rampAt, dir, toLevel, end: cur };
}

export function computeDirections(nav, faces, dests, { dropFields = true } = {}) {
  const NF = faces.length, ND = dests.length;
  const out = new Float32Array(NF * ND * STRIDE).fill(NaN);
  const nodes = faces.map(f => nav.nodeAtPoint(f.level, f.x, f.z));
  for (let d = 0; d < ND; d++) {
    const goals = dests[d].goals.map(([lv, x, z]) => nav.nodeAtPoint(lv, x, z)).filter(v => v >= 0);
    if (!goals.length) continue;
    const key = 'wayfind:' + dests[d].id;
    const had = nav.fields.has(key);
    const f = dests[d].kind === 'line' || dests[d].kind === 'gate' ? nav.field(key, goals) : fieldNoEntry(nav, key, goals);
    for (let i = 0; i < NF; i++) {
      const v = nodes[i];
      if (v < 0 || !isFinite(f.dist[v])) continue;
      const p = walkPath(nav, f, v, faces[i].len || 18);
      const o = (i * ND + d) * STRIDE;
      out[o] = f.dist[v]; out[o + 1] = p.x; out[o + 2] = p.z;
      out[o + 3] = p.ramp; out[o + 4] = p.rampAt; out[o + 5] = p.dir; out[o + 6] = p.toLevel;
    }
    if (dropFields && !had) nav.fields.delete(key);
  }
  return out;
}

// Full node path from a start node along field f, split into per-level legs.
// Returns [{ level, pts: [[x,z],...], ramp: rampIndex|-1 (ramp ending the leg), dir }]
export function routeLegs(nav, f, v, maxNodes = 4000) {
  const L = nav.world.layout;
  const legs = [];
  let leg = { level: nav.levelNames[nav.lvl[v]], pts: [[nav.x[v], nav.z[v]]], ramp: -1, dir: 0, len: 0 };
  let cur = v, inRamp = -1;
  // Start ON a ramp (the player is riding an escalator): the leg that ends in
  // this ramp has a single point (where the player is), its floor transition
  // comes from the ramp's REAL direction of travel -- the level the field
  // leaves the ramp at -- and the next leg starts on that level.
  if (nav.rmp[v] >= 0) {
    const ri0 = nav.rmp[v], r0 = L.ramps[ri0];
    let toLv = null, w = v;
    for (let k = 0; k < 400; k++) {
      const n = stepNext(nav, f, w); if (n < 0) break;
      if (nav.rmp[n] !== ri0) { if (nav.rmp[n] < 0) toLv = nav.levelNames[nav.lvl[n]]; break; }
      w = n;
    }
    if (toLv === r0.upper || toLv === r0.lower) {
      const dir0 = toLv === r0.upper ? 1 : -1, list = nav.rampNodes[ri0], ix = list ? list.indexOf(v) : -1;
      const tLH = ix >= 0 && list.length > 1 ? ix / (list.length - 1) : 0;          // 0 = low end .. 1 = high end
      leg = { level: dir0 > 0 ? r0.lower : r0.upper, pts: [[nav.x[v], nav.z[v]]], ramp: ri0, dir: dir0, len: 0, rampStart: dir0 > 0 ? tLH : 1 - tLH, onRamp: true };
      legs.push(leg);
      leg = { level: toLv, pts: [], ramp: -1, dir: 0, len: 0 };
      inRamp = ri0;
    }
  }
  for (let i = 0; i < maxNodes; i++) {
    const w = stepNext(nav, f, cur);
    if (w < 0) break;
    const ri = nav.rmp[w];
    if (ri >= 0 && inRamp < 0) {
      // leg ends at the ramp mouth
      const r = L.ramps[ri];
      leg.ramp = ri; leg.dir = leg.level === r.lower ? 1 : -1;
      leg.pts.push([nav.x[w], nav.z[w]]);
      legs.push(leg);
      inRamp = ri;
      leg = { level: leg.dir > 0 ? r.upper : r.lower, pts: [], ramp: -1, dir: 0, len: 0 };
    } else if (ri < 0) {
      inRamp = -1;
      const lv = nav.levelNames[nav.lvl[w]];
      if (lv !== leg.level) { legs.push(leg); leg = { level: lv, pts: [], ramp: -1, dir: 0, len: 0 }; }
      const last = leg.pts[leg.pts.length - 1];
      if (last) leg.len += Math.hypot(nav.x[w] - last[0], nav.z[w] - last[1]);
      leg.pts.push([nav.x[w], nav.z[w]]);
    }
    cur = w;
  }
  if (leg.pts.length) legs.push(leg);
  return legs;
}

// Douglas–Peucker simplification for drawing route polylines.
export function simplify(pts, eps = 0.8) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, az] = pts[a], [bx, bz] = pts[b];
    const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1;
    let best = -1, bd = eps;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dz - (pts[i][1] - az) * dx) / l;
      if (d > bd) { bd = d; best = i; }
    }
    if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
