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
import { LEVEL_ORDER } from '../../world/layout.js';

export const STRIDE = 7;

export function walkPath(nav, f, v, maxLen = 18, rampExtra = 5) {
  const L = nav.world.layout;
  let x = nav.x[v], z = nav.z[v];
  let acc = 0, ramp = -1, rampAt = 0, dir = 0, toLevel = -1, onRampAcc = 0;
  let prevLevel = nav.levelNames[nav.lvl[v]];
  let cur = v;
  for (let i = 0; i < 400; i++) {
    const w = nav.next(f, cur);
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
    const f = nav.field(key, goals);
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
  for (let i = 0; i < maxNodes; i++) {
    const w = nav.next(f, cur);
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
