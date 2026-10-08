// =============================================================================
// Intrusion clip (v3, World). Some transit / exterior structures are built from
// their own extents and pass straight through indoor spaces of other zones:
//  * the Nankai viaduct (transit/env.js) runs straight south from the platform
//    ends to z = 245: its deck underside (9.65 m) sits under the Namba CITY 2F
//    ceiling (10.0 m) and the Parks 2F ceiling (10.2 m), so both read as a flat
//    unlit concrete plane that the escalators "rise straight into"; its ballast
//    top (10.89 m) is the speckled "ground" seen at the bottom of the Parks
//    3F->2F well; a catenary portal beam crosses the Parks 4F corridor at knee
//    height (18.6 m);
//  * the city ground plane (outdoor/street.js, asphalt at y = -0.4) covers every
//    street stair well that descends to B1 (the stairs "run into a ground").
// This pass runs once after the build (from Visibility.init) and removes the
// offending triangles: large triangles are split (longest edge) until they are
// <= 3 m before being classified, so only the parts inside a foreign indoor
// space (or a ramp well) go; stair wells are cut out of the ground plane.
// No per-frame cost. Upstream fixes are requested in notes/v3-world.md; with
// them in place this pass finds nothing to do.
// =============================================================================
import * as THREE from 'three';
import { LEVELS, LEVEL_ORDER } from '../world/layout.js?v=488c31e';
import { CELL } from '../world/world.js?v=488c31e';

const TRANSIT_ZONES = new Set(['nankai', 'midosuji', 'sennichimae']);
const RULES = [
  { prefix: 'transit_env:', keepZones: TRANSIT_ZONES },
];
const MAX_EDGE = 3;

export function clipIntrusions(ctx) {
  const t0 = performance.now();
  const res = { tris: 0, added: 0, meshes: [], ground: 0 };
  clipStructures(ctx, res);
  try { res.ground = cutGround(ctx); } catch (e) { console.warn('[render] ground cut failed', e); }
  res.ms = Math.round(performance.now() - t0);
  console.log(`[render] intrusion clip: -${res.tris} / +${res.added} triangles in ${res.meshes.length} meshes, ${res.ground} wells cut from the ground plane (${res.ms} ms)`);
  return res;
}

function clipStructures(ctx, res) {
  const { engine, world } = ctx;
  const L = world.layout;
  const ys = LEVEL_ORDER.map(l => LEVELS[l].y);
  const levelOf = (y) => { let k = -1; for (let i = 0; i < ys.length; i++) if (y >= ys[i] - 0.05) k = i; return k < 0 ? null : LEVEL_ORDER[k]; };
  // zone of the indoor volume containing a world point (null: solid, outdoor, above the plenum)
  const zoneAt = (x, y, z) => {
    const lv = levelOf(y); if (!lv) return null;
    const g = world.grids[lv]; if (!g) return null;
    const i = g.cellOf(x, z); if (i < 0) return null;
    const t = g.type[i];
    if (t === CELL.RAMP && g.ramp[i] >= 0) return L.ramps[g.ramp[i]].zone; // a well: open its full height
    if (t !== CELL.WALK && t !== CELL.VOID) return null;
    const si = g.space[i];
    const sp = si >= 0 ? L.spaces[si] : null;
    if (!sp || sp.outdoor) return null;
    if (y > LEVELS[lv].y + (sp.ceil || 3.5) + 0.6) return null;
    return sp.zone;
  };
  const IDENT = new THREE.Matrix4();
  for (const lv of LEVEL_ORDER) {
    const root = engine.levelRoot(lv); if (!root) continue;
    root.traverse(o => {
      if (!o.isMesh || !o.geometry || o.geometry.index) return;
      const rule = RULES.find(r => o.name && o.name.startsWith(r.prefix));
      if (!rule) return;
      o.updateMatrixWorld();
      if (!o.matrixWorld.equals(IDENT)) return; // batches are built in world space
      const foreign = (x, y, z) => { const zn = zoneAt(x, y, z); return !!zn && !rule.keepZones.has(zn); };
      const masks = rule._masks || (rule._masks = []);
      // does an AABB touch a foreign indoor volume? (cell flags per level band, conservative)
      const boxHit = (b) => {
        for (let li = 0; li < LEVEL_ORDER.length; li++) {
          const lo = ys[li] - 0.05, hi = li + 1 < ys.length ? ys[li + 1] - 0.05 : Infinity;
          if (b[4] < lo || b[1] >= hi) continue;
          if (masks[li] === undefined) { const tm = performance.now(); masks[li] = levelMask(world, LEVEL_ORDER[li], rule.keepZones, ys[li]); res.maskMs = (res.maskMs || 0) + performance.now() - tm; }
          const m = masks[li]; if (!m) continue;
          const yMin = Math.max(b[1], lo);
          const g = m.g;
          const cx0 = Math.max(0, Math.floor(b[0] - g.x0)), cx1 = Math.min(g.w - 1, Math.floor(b[3] - g.x0));
          const cz0 = Math.max(0, Math.floor(b[2] - g.z0)), cz1 = Math.min(g.h - 1, Math.floor(b[5] - g.z0));
          for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) if (m.top[cz * g.w + cx] >= yMin) return true;
        }
        return false;
      };
      const g = o.geometry, names = Object.keys(g.attributes).sort((a, b) => (a === 'position' ? -1 : b === 'position' ? 1 : 0));
      const attrs = names.map(n => g.attributes[n]);
      if (attrs.some(a => a.isInterleavedBufferAttribute) || Object.keys(g.morphAttributes).length) return;
      const pos = g.attributes.position, n = pos.count / 3;
      // quick reject: whole mesh clear of foreign volumes
      g.computeBoundingBox();
      const bb = g.boundingBox;
      if (!boxHit([bb.min.x, bb.min.y, bb.min.z, bb.max.x, bb.max.y, bb.max.z])) return;
      // vertex = Float32Array of all attributes (stride S, position first)
      const sizes = attrs.map(a => a.itemSize), S = sizes.reduce((x, y) => x + y, 0);
      const out = [];
      let dropped = 0, kept = 0;
      const emit = (A, B, C) => { for (const v of [A, B, C]) for (let j = 0; j < S; j++) out.push(v[j]); kept++; };
      const d3 = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
      const proc = (A, B, C, depth) => {
        const eA = d3(B, C), eB = d3(C, A), eC = d3(A, B);
        const big = Math.max(eA, eB, eC);
        if (big > MAX_EDGE && depth < 24) {
          const bx = [Math.min(A[0], B[0], C[0]), Math.min(A[1], B[1], C[1]), Math.min(A[2], B[2], C[2]), Math.max(A[0], B[0], C[0]), Math.max(A[1], B[1], C[1]), Math.max(A[2], B[2], C[2])];
          if (!boxHit(bx)) { emit(A, B, C); return; }
          // split the longest edge (keeps the winding)
          const mid = (p, q) => { const m = new Float32Array(S); for (let j = 0; j < S; j++) m[j] = (p[j] + q[j]) / 2; return m; };
          if (eA === big) { const M = mid(B, C); proc(A, B, M, depth + 1); proc(A, M, C, depth + 1); }
          else if (eB === big) { const M = mid(C, A); proc(B, C, M, depth + 1); proc(B, M, A, depth + 1); }
          else { const M = mid(A, B); proc(C, A, M, depth + 1); proc(C, M, B, depth + 1); }
          return;
        }
        if (foreign((A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3, (A[2] + B[2] + C[2]) / 3)) { dropped++; return; }
        emit(A, B, C);
      };
      const vert = (i) => { const v = new Float32Array(S); let o = 0; for (let a = 0; a < attrs.length; a++) { const it = sizes[a]; v.set(attrs[a].array.subarray(i * it, (i + 1) * it), o); o += it; } return v; };
      for (let f = 0; f < n; f++) proc(vert(f * 3), vert(f * 3 + 1), vert(f * 3 + 2), 0);
      if (!dropped) return;
      res.tris += dropped; res.added += Math.max(0, kept - (n - dropped));
      res.meshes.push(`${o.name}@${lv}: ${n} -> ${kept}`);
      if (!kept) { o.layers.disableAll(); o.visible = false; return; }
      const nv = out.length / S;
      let off = 0;
      names.forEach((nm, a) => {
        const at = attrs[a], it = sizes[a], arr = new at.array.constructor(nv * it);
        for (let i = 0; i < nv; i++) for (let j = 0; j < it; j++) arr[i * it + j] = out[i * S + off + j];
        off += it;
        g.setAttribute(nm, new THREE.BufferAttribute(arr, it, at.normalized));
      });
      g.computeBoundingSphere(); g.computeBoundingBox();
    });
  }
}
// one level: top[cell] = highest y (absolute) of a foreign indoor volume over that cell, -Inf if none
function levelMask(world, lv, keepZones, y0) {
  const L = world.layout;
  const g = world.grids[lv]; if (!g) return null;
  const top = new Float32Array(g.w * g.h).fill(-Infinity);
  let any = false;
  for (let i = 0; i < top.length; i++) {
    const t = g.type[i];
    let zone = null, y = -Infinity;
    if (t === CELL.RAMP && g.ramp[i] >= 0) { zone = L.ramps[g.ramp[i]].zone; y = Infinity; }
    else if (t === CELL.WALK || t === CELL.VOID) {
      const sp = g.space[i] >= 0 ? L.spaces[g.space[i]] : null;
      if (sp && !sp.outdoor) { zone = sp.zone; y = y0 + (sp.ceil || 3.5) + 0.6; }
    }
    if (zone && !keepZones.has(zone)) { top[i] = y; any = true; }
  }
  return any ? { g, top } : null;
}

// The city ground plane (a 1.5 km asphalt disc just under street level) is rebuilt with a hole over
// every 1F cell that opens to B1 (street stair wells, voids), so wells descend to their landing.
function cutGround(ctx) {
  const { world } = ctx;
  const scene = ctx.engine.scene;
  let mesh = null;
  scene.traverse(o => { if (!mesh && o.isMesh && o.name === 'street:ground') mesh = o; });
  if (!mesh) return 0;
  const g1 = world.grids['1F'];
  if (!g1) return 0;
  const y = mesh.position.y;
  // hole rects: 1F hole cells (ramp wells whose upper level is 1F, voids) merged per row run,
  // then merged vertically when identical
  const L = world.layout;
  const rects = [];
  for (const r of L.ramps) if (r.upper === '1F' && LEVELS[r.lower].y < y) rects.push(r.rect.slice());
  for (const v of L.voids) if (v.level === '1F') rects.push(v.rect.slice());
  if (!rects.length) return 0;
  // merge touching / overlapping rects (adjacent lanes of a bank) so holes never share edges
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < rects.length && !merged; i++) for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      if (a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]) {
        rects[i] = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
        rects.splice(j, 1); merged = true; break;
      }
    }
  }
  // shape in the plane's local XY (the disc was built in XY and rotated -90° about X: local y = -z)
  const shape = new THREE.Shape();
  const R = 1500, SEG = 64;
  for (let i = 0; i <= SEG; i++) { const a = i / SEG * Math.PI * 2; i ? shape.lineTo(Math.cos(a) * R, Math.sin(a) * R) : shape.moveTo(R, 0); }
  for (const [x0, z0, x1, z1] of rects) {
    const h = new THREE.Path();
    h.moveTo(x0, -z0); h.lineTo(x0, -z1); h.lineTo(x1, -z1); h.lineTo(x1, -z0); h.lineTo(x0, -z0);
    shape.holes.push(h);
  }
  const geo = new THREE.ShapeGeometry(shape, 1);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 10, pos.getZ(i) / 10);
  geo.computeBoundingSphere();
  const old = mesh.geometry;
  mesh.geometry = geo;
  old.dispose();
  void g1;
  return rects.length;
}
