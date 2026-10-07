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
import { LEVELS, LEVEL_ORDER } from '../world/layout.js';
import { CELL } from '../world/world.js';

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
      // any foreign volume inside an AABB? (1 m sampling of the box)
      const boxHit = (b) => {
        for (let y = b[1]; y <= b[4] + 1e-6; y += Math.max(0.5, (b[4] - b[1]) / 4 || 1)) {
          for (let x = b[0]; x <= b[3] + 1e-6; x += 1) for (let z = b[2]; z <= b[5] + 1e-6; z += 1) if (foreign(x, y, z)) return true;
          if (b[4] - b[1] < 1e-3) break;
        }
        return false;
      };
      const g = o.geometry, names = Object.keys(g.attributes);
      const attrs = names.map(n => g.attributes[n]);
      if (attrs.some(a => a.isInterleavedBufferAttribute) || Object.keys(g.morphAttributes).length) return;
      const pos = g.attributes.position, n = pos.count / 3;
      // quick reject: whole mesh clear of foreign volumes
      g.computeBoundingBox();
      const bb = g.boundingBox;
      if (!boxHit([bb.min.x, bb.min.y, bb.min.z, bb.max.x, bb.max.y, bb.max.z])) return;
      const out = attrs.map(() => []);
      let dropped = 0, kept = 0;
      const emit = (V) => { for (let a = 0; a < attrs.length; a++) for (let k = 0; k < 3; k++) out[a].push(...V[k][a]); kept++; };
      const P = (v) => v[0]; // vertex = [posArray, ...otherAttrArrays]
      const proc = (V, depth) => {
        const p0 = P(V[0]), p1 = P(V[1]), p2 = P(V[2]);
        const e = [dist(p1, p2), dist(p2, p0), dist(p0, p1)];
        const big = Math.max(e[0], e[1], e[2]);
        const b = [Math.min(p0[0], p1[0], p2[0]), Math.min(p0[1], p1[1], p2[1]), Math.min(p0[2], p1[2], p2[2]), Math.max(p0[0], p1[0], p2[0]), Math.max(p0[1], p1[1], p2[1]), Math.max(p0[2], p1[2], p2[2])];
        if (big > MAX_EDGE && depth < 24) {
          if (!boxHit(b)) { emit(V); return; }
          // split the longest edge
          const k = e[0] >= e[1] && e[0] >= e[2] ? 0 : e[1] >= e[2] ? 1 : 2; // edge opposite vertex k
          const a = (k + 1) % 3, c = (k + 2) % 3;
          const M = V[a].map((arr, i) => arr.map((v, j) => (v + V[c][i][j]) / 2));
          const T1 = [], T2 = [];
          T1[k] = V[k]; T1[a] = V[a]; T1[c] = M;
          T2[k] = V[k]; T2[a] = M; T2[c] = V[c];
          proc(T1, depth + 1); proc(T2, depth + 1);
          return;
        }
        const cx = (p0[0] + p1[0] + p2[0]) / 3, cy = (p0[1] + p1[1] + p2[1]) / 3, cz = (p0[2] + p1[2] + p2[2]) / 3;
        if (foreign(cx, cy, cz)) { dropped++; return; }
        emit(V);
      };
      for (let f = 0; f < n; f++) {
        const V = [0, 1, 2].map(k => attrs.map(a => Array.from(a.array.subarray((f * 3 + k) * a.itemSize, (f * 3 + k + 1) * a.itemSize))));
        proc(V, 0);
      }
      if (!dropped) return;
      res.tris += dropped; res.added += Math.max(0, kept - (n - dropped));
      res.meshes.push(`${o.name}@${lv}: ${n} -> ${kept}`);
      if (!kept) { o.layers.disableAll(); o.visible = false; return; }
      names.forEach((nm, a) => { const at = attrs[a]; g.setAttribute(nm, new THREE.BufferAttribute(new at.array.constructor(out[a]), at.itemSize, at.normalized)); });
      g.computeBoundingSphere(); g.computeBoundingBox();
    });
  }
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

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
