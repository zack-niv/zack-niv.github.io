// =============================================================================
// Parks Garden: each terrace gets a network of curving paths joining its
// entrances (stairs, bridges, skywalks); everything else becomes raised beds
// with stone kerbs (marching-squares outlines of a distance field), densely
// planted: trees, shrubs, grasses, flowers, ground cover. Plus timber decks,
// a pond, a vegetable plot, benches and lamps. Beds/benches/lamps/trunks are
// registered with world.addBox so collision and crowd nav match the visuals.
// =============================================================================
import * as THREE from 'three';
import { CELL } from '../world.js?v=517b401';
import { LEVELS } from '../layout.js?v=517b401';
import { rng } from '../../core/rng.js?v=517b401';
import { MeshAcc, lin, mulc } from './meshacc.js?v=517b401';
import { Vegetation } from './vegetation.js?v=517b401';
import { PALETTE } from './canyon.js?v=517b401';
import { canyonFloor } from './canyonfloor.js?v=517b401';

// Paths per terrace: polylines [x,z] + width. 'deck' areas are timber.
export const GARDENS = {
  '3F': { space: 'garden_3F', theme: ['keyaki', 'kusu', 'sakura', 'momiji'], paths: [
    { w: 3.4, pts: [[53, 224], [60, 225], [68, 228], [77, 233], [84, 238], [86, 242.6]] },
    { w: 3.0, pts: [[50.2, 239], [56, 239.5], [63, 238], [70, 235], [77, 233]] },
    { w: 2.4, pts: [[68, 228], [72, 219], [82, 212], [96, 209], [108, 212], [115, 220], [116, 232], [112, 243], [100, 247], [90, 246], [86, 242.6]] },
    { w: 2.2, pts: [[96, 209], [98, 222], [94, 232], [86, 238]] },
  ], decks: [[100, 222, 110, 232]] },
  '4F': { space: 'garden_4F', theme: ['kusu', 'momiji', 'keyaki', 'pine'], pond: { x: 105, z: 264, rx: 6.5, rz: 4.2 }, paths: [
    { w: 3.4, pts: [[86, 252.4], [85, 258], [80, 266], [72, 272], [62, 277], [52.2, 279]] },
    { w: 3.0, pts: [[85, 258], [92, 266], [97, 274], [102, 280.6]] },
    { w: 2.4, pts: [[97, 274], [108, 275], [116, 272], [116, 258], [110, 255], [96, 255], [85, 258]] },
    { w: 2.2, pts: [[72, 272], [70, 284], [62, 288], [56, 285], [55, 279]] },
  ] },
  '5F': { space: 'garden_5F', theme: ['sakura', 'keyaki', 'olive', 'momiji'], paths: [
    { w: 3.4, pts: [[102, 290.4], [98, 297], [90, 303], [80, 307], [78, 310.6]] },
    { w: 3.2, pts: [[69, 290.4], [70, 296], [76, 302], [84, 305]] },
    { w: 2.4, pts: [[98, 297], [108, 294], [116, 300], [115, 312], [104, 316], [92, 314], [84, 305]] },
    { w: 2.2, pts: [[70, 296], [62, 300], [58, 310], [64, 316], [74, 314], [78, 310.6]] },
  ] },
  '6F': { space: 'garden_6F', theme: ['kusu', 'sakura', 'pine', 'olive'], paths: [
    { w: 3.4, pts: [[78, 320.4], [74, 325], [64, 328], [56.2, 328]] },
    { w: 3.2, pts: [[78, 320.4], [86, 326], [96, 330], [104, 334], [106, 336.6]] },
    { w: 2.4, pts: [[96, 330], [108, 324], [116, 330], [116, 340], [110, 343], [106, 336.6]] },
    { w: 2.2, pts: [[64, 328], [62, 337], [70, 342], [82, 340], [90, 333], [96, 330]] },
  ], decks: [[66, 336, 78, 344]] },
  '7F': { space: 'garden_7F', theme: ['momiji', 'olive', 'pine', 'sakura'], veg: [70, 358, 78, 364], paths: [
    { w: 3.2, pts: [[106, 346.4], [100, 350], [90, 352], [82, 356.6]] },
    { w: 3.2, pts: [[58.2, 354], [64, 352.5], [72, 351.5], [82, 352.5], [90, 352]] },
    { w: 2.4, pts: [[100, 350], [112, 350], [116, 356], [112, 363], [100, 363], [90, 359], [82, 356.6]] },
  ] },
  '8F': { space: 'garden_8F', theme: ['pine', 'olive', 'momiji', 'kusu'], paths: [
    { w: 3.4, pts: [[82, 366.4], [84, 371], [90, 375]] },
    { w: 3.2, pts: [[60.2, 374], [66, 374.5], [74, 375.5], [84, 371]] },
    { w: 2.6, pts: [[90, 375], [100, 372], [110, 370], [116, 376], [114, 384], [104, 386], [94, 383], [90, 375]] },
  ], decks: [[93, 373, 109, 383]] },
};

const OFF4 = [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]];
const BOX = new THREE.BoxGeometry(1, 1, 1);
const M4 = () => new THREE.Matrix4();

function segDist(px, pz, ax, az, bx, bz) {
  const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez;
  let t = l2 > 0 ? ((px - ax) * ex + (pz - az) * ez) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + ex * t - px, qz = az + ez * t - pz;
  return Math.sqrt(qx * qx + qz * qz);
}
// Catmull-Rom densify
function smoothPath(pts, step = 1) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const L = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), n = Math.max(2, Math.ceil(L / step));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

export function buildGardens(ctx, parks) {
  const { world, materials, engine } = ctx;
  const L = world.layout;
  const veg = parks.veg = new Vegetation(ctx, parks.root);
  const kerb = new MeshAcc(), soil = new MeshAcc(), pave = new MeshAcc(), deck = new MeshAcc(), water = new MeshAcc();
  const wood = new MeshAcc(), metal = new MeshAcc(), glow = new MeshAcc(), stone = new MeshAcc();
  const cols = parks.columns || [];
  let boxes = 0;

  for (const [lv, G] of Object.entries(GARDENS)) {
    const sp = L.spaces.find(s => s.id === G.space);
    if (!sp) continue;
    const g = world.grids[lv];
    const si = world.spaceIndex.get(G.space);
    const y = LEVELS[lv].y;
    const [x0, z0, x1, z1] = sp.rect;
    const R = rng(4000 + Math.round(y));
    const paths = G.paths.map(p => ({ w: p.w, pts: smoothPath(p.pts, 0.8) }));
    const decks = G.decks || [];
    const stairs = L.ramps.filter(r => r.zone === 'parksGarden' && (r.lower === lv || r.upper === lv)).map(r => r.rect);
    const pond = G.pond;
    // ---- distance field (0.5 m samples) --------------------------------------
    const S = 0.5, NX = Math.round((x1 - x0) / S) + 1, NZ = Math.round((z1 - z0) / S) + 1;
    const D = new Float32Array(NX * NZ);
    const walkAt = (x, z) => { const i = g.cellOf(x, z); return i >= 0 && g.type[i] === CELL.WALK && g.space[i] === si; };
    const pathD = (x, z) => {
      let d = 1e9;
      for (const p of paths) for (let k = 0; k < p.pts.length - 1; k++) {
        const a = p.pts[k], b = p.pts[k + 1];
        d = Math.min(d, segDist(x, z, a[0], a[1], b[0], b[1]) - p.w / 2);
      }
      for (const [a0, b0, a1, b1] of decks) { const dx = Math.max(a0 - x, 0, x - a1), dz = Math.max(b0 - z, 0, z - b1); d = Math.min(d, Math.hypot(dx, dz) - 0.0001 - (x > a0 && x < a1 && z > b0 && z < b1 ? 1 : 0)); }
      for (const [a0, b0, a1, b1] of stairs) { const dx = Math.max(a0 - 1.2 - x, 0, x - a1 - 1.2), dz = Math.max(b0 - 1.2 - z, 0, z - b1 - 1.2); d = Math.min(d, Math.hypot(dx, dz) - 0.3); }
      return d;
    };
    // stamp path / deck / stair distances locally (fields clamp at FAR metres)
    const FAR = 7;
    D.fill(FAR);
    const stamp = (bx0, bz0, bx1, bz1, fn) => {
      const i0 = Math.max(0, Math.floor((bx0 - x0) / S)), i1 = Math.min(NX - 1, Math.ceil((bx1 - x0) / S));
      const j0 = Math.max(0, Math.floor((bz0 - z0) / S)), j1 = Math.min(NZ - 1, Math.ceil((bz1 - z0) / S));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const k = j * NX + i; const d = fn(x0 + i * S, z0 + j * S); if (d < D[k]) D[k] = d; }
    };
    for (const p of paths) for (let k = 0; k < p.pts.length - 1; k++) {
      const a = p.pts[k], b = p.pts[k + 1], r = p.w / 2 + FAR;
      stamp(Math.min(a[0], b[0]) - r, Math.min(a[1], b[1]) - r, Math.max(a[0], b[0]) + r, Math.max(a[1], b[1]) + r, (x, z) => segDist(x, z, a[0], a[1], b[0], b[1]) - p.w / 2);
    }
    for (const [a0, b0, a1, b1] of decks) stamp(a0 - FAR, b0 - FAR, a1 + FAR, b1 + FAR, (x, z) => { const dx = Math.max(a0 - x, 0, x - a1), dz = Math.max(b0 - z, 0, z - b1); return Math.hypot(dx, dz) - (x > a0 && x < a1 && z > b0 && z < b1 ? 1 : 0); });
    for (const [a0, b0, a1, b1] of stairs) stamp(a0 - FAR, b0 - FAR, a1 + FAR, b1 + FAR, (x, z) => { const dx = Math.max(a0 - 1.2 - x, 0, x - a1 - 1.2), dz = Math.max(b0 - 1.2 - z, 0, z - b1 - 1.2); return Math.hypot(dx, dz) - 0.3; });
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
      const x = x0 + i * S, z = z0 + j * S;
      let inside = true;
      for (const [ox, oz] of OFF4) if (!walkAt(x + ox, z + oz)) { inside = false; break; }
      const k = j * NX + i;
      D[k] = inside ? D[k] - 0.4 : -1;
    }
    const dAt = (x, z) => { const i = Math.round((x - x0) / S), j = Math.round((z - z0) / S); if (i < 0 || j < 0 || i >= NX || j >= NZ) return -1; return D[j * NX + i]; };
    // ---- marching squares: soil fill + kerbs ---------------------------------
    const ys = y + 0.42, yk = y + 0.48;
    const lerpP = (ax, az, va, bx, bz, vb) => { const t = va / (va - vb); return [ax + (bx - ax) * t, az + (bz - az) * t]; };
    // fully-inside cells are merged into one quad per horizontal run (the soil mesh was 70k+ triangles)
    const soilRun = (j, i0, i1) => {
      const xa = x0 + i0 * S, xb = x0 + i1 * S, za = z0 + j * S, zb = za + S;
      const A = [xa, za], B = [xb, za], C = [xb, zb], Dd = [xa, zb];
      const T = (p) => [p[0] / 3, p[1] / 3];
      soil.tri([A[0], ys, A[1]], [C[0], ys, C[1]], [B[0], ys, B[1]], [0, 1, 0], [T(A), T(C), T(B)]);
      soil.tri([A[0], ys, A[1]], [Dd[0], ys, Dd[1]], [C[0], ys, C[1]], [0, 1, 0], [T(A), T(Dd), T(C)]);
    };
    for (let j = 0; j < NZ - 1; j++) {
      let run = -1;
      for (let i = 0; i < NX - 1; i++) {
      const xa = x0 + i * S, za = z0 + j * S, xb = xa + S, zb = za + S;
      const v = [D[j * NX + i], D[j * NX + i + 1], D[(j + 1) * NX + i + 1], D[(j + 1) * NX + i]]; // (xa,za) (xb,za) (xb,zb) (xa,zb)
      const P = [[xa, za], [xb, za], [xb, zb], [xa, zb]];
      const inside = v.map(q => q > 0);
      const nIn = inside.filter(Boolean).length;
      if (nIn === 4) { if (run < 0) run = i; if (i < NX - 2) continue; }
      if (run >= 0) { soilRun(j, run, nIn === 4 ? i + 1 : i); run = -1; if (nIn === 4) continue; }
      if (nIn === 0) continue;
      // polygon of the inside part (walk the square's edges)
      const poly = [], cut = [];
      for (let k = 0; k < 4; k++) {
        const k2 = (k + 1) % 4;
        if (inside[k]) poly.push(P[k]);
        if (inside[k] !== inside[k2]) { const p = lerpP(P[k][0], P[k][1], v[k], P[k2][0], P[k2][1], v[k2]); poly.push(p); cut.push(p); }
      }
      for (let k = 1; k < poly.length - 1; k++) soil.tri([poly[0][0], ys, poly[0][1]], [poly[k + 1][0], ys, poly[k + 1][1]], [poly[k][0], ys, poly[k][1]], [0, 1, 0], [[poly[0][0] / 3, poly[0][1] / 3], [poly[k + 1][0] / 3, poly[k + 1][1] / 3], [poly[k][0] / 3, poly[k][1] / 3]]);
      // kerb along the contour (pairs of cut points)
      for (let k = 0; k + 1 < cut.length; k += 2) {
        const a = cut[k], b = cut[k + 1];
        // outward direction: from the inside centroid towards the cut
        let cx = 0, cz = 0, n = 0; for (let q = 0; q < 4; q++) if (inside[q]) { cx += P[q][0]; cz += P[q][1]; n++; }
        cx /= n; cz /= n;
        const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
        let ox = -(b[1] - a[1]), oz = b[0] - a[0]; const ol = Math.hypot(ox, oz) || 1; ox /= ol; oz /= ol;
        if ((mx - cx) * ox + (mz - cz) * oz < 0) { ox = -ox; oz = -oz; }
        // outer face (faces outward), top strip inward 0.2
        const A = [a[0], y, a[1]], B = [b[0], y, b[1]];
        const face = (p, q) => { const ux = q[0] - p[0], uz = q[2] - p[2]; return (-uz * ox + ux * oz) > 0; };
        const [p, q] = face(A, B) ? [A, B] : [B, A];
        const c = mulc(PALETTE.cream, 0.92);
        kerb.quad(p, q, [q[0], yk, q[2]], [p[0], yk, p[2]], [ox, 0, oz], [[0, 0], [ol, 0], [ol, 0.5], [0, 0.5]], [mulc(c, 0.75), mulc(c, 0.75), c, c]);
        const ia = [p[0] - ox * 0.2, yk, p[2] - oz * 0.2], ib = [q[0] - ox * 0.2, yk, q[2] - oz * 0.2];
        kerb.quadAuto([p[0], yk, p[2]], [q[0], yk, q[2]], ib, ia, null, c);
      }
    }
    }
    // collision: cells well inside beds
    for (let cz = z0; cz < z1; cz++) {
      let run = -1;
      const flush = (end) => { if (run >= 0) { world.addBox(lv, (run + end) / 2, cz + 0.5, (end - run) / 2, 0.5); boxes++; } run = -1; };
      for (let cx = x0; cx <= x1; cx++) {
        const ok = cx < x1 && dAt(cx + 0.5, cz + 0.5) > 0.55 && dAt(cx + 0.1, cz + 0.1) > 0.05 && dAt(cx + 0.9, cz + 0.1) > 0.05 && dAt(cx + 0.1, cz + 0.9) > 0.05 && dAt(cx + 0.9, cz + 0.9) > 0.05;
        if (ok && run < 0) run = cx;
        if (!ok) flush(cx);
      }
    }
    // ---- path surface & decks ------------------------------------------------
    pave.quad([x0, y + 0.012, z1], [x1, y + 0.012, z1], [x1, y + 0.012, z0], [x0, y + 0.012, z0], [0, 1, 0], [[x0 / 2.4, z1 / 2.4], [x1 / 2.4, z1 / 2.4], [x1 / 2.4, z0 / 2.4], [x0 / 2.4, z0 / 2.4]]);
    for (const [a0, b0, a1, b1] of decks) {
      deck.quad([a0, y + 0.1, b1], [a1, y + 0.1, b1], [a1, y + 0.1, b0], [a0, y + 0.1, b0], [0, 1, 0], [[a0 / 2, b1 / 2], [a1 / 2, b1 / 2], [a1 / 2, b0 / 2], [a0 / 2, b0 / 2]]);
      for (const [ax, az, bx, bz] of [[a0, b0, a1, b0], [a1, b1, a0, b1], [a0, b1, a0, b0], [a1, b0, a1, b1]]) wood.geometry(BOX, M4().makeTranslation((ax + bx) / 2, y + 0.05, (az + bz) / 2).multiply(M4().makeScale(Math.abs(bx - ax) + 0.08, 0.1, Math.abs(bz - az) + 0.08)));
    }
    // ---- pond ------------------------------------------------------------------
    if (pond) {
      const N = 40;
      for (let k = 0; k < N; k++) {
        const a0 = k / N * Math.PI * 2, a1 = (k + 1) / N * Math.PI * 2;
        const p0 = [pond.x + Math.cos(a0) * pond.rx, pond.z + Math.sin(a0) * pond.rz], p1 = [pond.x + Math.cos(a1) * pond.rx, pond.z + Math.sin(a1) * pond.rz];
        water.tri([pond.x, ys - 0.1, pond.z], [p1[0], ys - 0.1, p1[1]], [p0[0], ys - 0.1, p0[1]], [0, 1, 0], [[0.5, 0.5], [0.5 + Math.cos(a1) / 2, 0.5 + Math.sin(a1) / 2], [0.5 + Math.cos(a0) / 2, 0.5 + Math.sin(a0) / 2]]);
        // rocks on the rim
        if (k % 2 === 0) {
          const rr = R.range(0.35, 0.7);
          stone.geometry(ROCK, M4().makeTranslation(p0[0], ys - 0.05, p0[1]).multiply(M4().makeRotationY(R.range(0, 6))).multiply(M4().makeScale(rr * 1.3, rr * 0.7, rr)), mulc(lin(0x8d877c), R.range(0.8, 1.1)));
        }
      }
      if (ctx.lighting) ctx.lighting.addLight({ level: lv, x: pond.x, y: y + 0.5, z: pond.z, color: 0xbfe6ff, intensity: 0.2, range: 6, kind: 'lamp' });
    }
    // ---- vegetable plot (allotment rows) -----------------------------------------
    if (G.veg) {
      const [a0, b0, a1, b1] = G.veg;
      for (let z = b0 + 0.6; z < b1; z += 0.9) for (let x = a0 + 0.5; x < a1; x += 0.55) if (dAt(x, z) > 0.3) veg.add('fern', x, ys, z, R.range(0.6, 0.85), R.range(0, 6), [0.85, 1.1, 0.7]);
    }
    // ---- planting -------------------------------------------------------------------
    const theme = G.theme;
    const trees = [];
    const underDeck = (x, z) => x > 47 && x < 74 && z > 229 && z < 292;
    const nearCol = (x, z, r) => cols.some(c => c.level === lv && Math.hypot(c.x - x, c.z - z) < r);
    const inPond = (x, z, m = 0) => pond && ((x - pond.x) / (pond.rx + m)) ** 2 + ((z - pond.z) / (pond.rz + m)) ** 2 < 1;
    for (let z = z0 + 2; z < z1 - 1; z += 4.6) for (let x = x0 + 2; x < x1 - 1; x += 4.6) {
      const px = x + R.range(-1.6, 1.6), pz = z + R.range(-1.6, 1.6);
      const d = dAt(px, pz);
      if (d < 1.5 || inPond(px, pz, 1.5) || nearCol(px, pz, 2.5)) continue;
      if (R.chance(0.22)) continue;
      const deck = underDeck(px, pz);
      let kind = theme[Math.floor((Math.sin(px * 0.11 + pz * 0.07) * 0.5 + 0.5) * theme.length * 0.999)];
      if (R.chance(0.25)) kind = R.pick(theme);
      if (deck) kind = R.pick(['momiji', 'olive']);
      const s = R.range(0.8, 1.15) * (kind === 'keyaki' && y > 25 ? 0.85 : 1);
      const tint = kind === 'kusu' ? [0.8, 0.9, 0.78] : [R.range(0.9, 1.08), R.range(0.92, 1.06), R.range(0.85, 1.0)];
      veg.add(kind, px, ys, pz, s, R.range(0, Math.PI * 2), tint);
      trees.push([px, pz]);
    }
    for (let z = z0 + 0.6; z < z1; z += 1.25) for (let x = x0 + 0.6; x < x1; x += 1.25) {
      const px = x + R.range(-0.5, 0.5), pz = z + R.range(-0.5, 0.5);
      const d = dAt(px, pz);
      if (d < 0.5 || inPond(px, pz, 0.6)) continue;
      if (trees.some(t => Math.hypot(t[0] - px, t[1] - pz) < 1.1)) continue;
      const n = Math.sin(px * 0.31 + pz * 0.17) + Math.sin(px * 0.07 - pz * 0.23);
      if (d < 1.6 && n > 0.4 && R.chance(0.7)) { veg.add('flower', px, ys, pz, R.range(0.8, 1.2), R.range(0, 6)); continue; }
      if (n < -0.9 && R.chance(0.8)) { veg.add('grass', px, ys, pz, R.range(0.8, 1.3), R.range(0, 6)); continue; }
      const kind = n > 1.1 ? 'azalea' : (R.chance(0.15) ? 'fern' : 'shrub');
      if (R.chance(d > 3 ? 0.55 : 0.85)) veg.add(kind, px, ys, pz, R.range(0.75, 1.35), R.range(0, 6), [R.range(0.85, 1.05), R.range(0.9, 1.08), R.range(0.8, 1.0)]);
      if (d < 1.1 && R.chance(0.35)) veg.add('grass', px + R.range(-0.4, 0.4), ys, pz + R.range(-0.4, 0.4), R.range(0.6, 0.9), R.range(0, 6));
    }
    // ---- benches & lamps along the paths --------------------------------------------
    for (const p of paths) {
      let acc = 6 + R.range(0, 6);
      for (let k = 1; k < p.pts.length - 1; k++) {
        const a = p.pts[k - 1], b = p.pts[k];
        acc += Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (acc < 13) continue;
        acc = R.range(0, 4);
        const tx = b[0] - a[0], tz = b[1] - a[1], tl = Math.hypot(tx, tz) || 1;
        const nx = -tz / tl, nz = tx / tl;
        const side = R.chance(0.5) ? 1 : -1;
        const off = p.w / 2 - 0.35;
        const bx = b[0] + nx * off * side, bz = b[1] + nz * off * side;
        // a bench needs a bed (or the parapet) behind it and clear path in front
        if (dAt(bx + nx * side * 0.9, bz + nz * side * 0.9) > 0 && pathD(bx - nx * side * 1.2, bz - nz * side * 1.2) < -0.6 && !nearCol(bx, bz, 1.5)) {
          const rot = Math.atan2(-tz, tx);
          bench(wood, metal, bx, y, bz, rot, side);
          world.addBox(lv, bx, bz, 0.95, 0.3, Math.atan2(tz, tx)); boxes++;
        }
        // lamp in the bed on the other side
        const lx = b[0] - nx * (p.w / 2 + 0.45) * side, lz = b[1] - nz * (p.w / 2 + 0.45) * side;
        if (dAt(lx, lz) > 0.1) {
          lamp(metal, glow, lx, ys, lz);
          if (ctx.lighting) ctx.lighting.addLight({ level: lv, x: lx, y: ys + 3.4, z: lz, color: 0xffd6a0, intensity: 0.5, range: 9, kind: 'lamp' });
        }
      }
    }
  }
  // ---- planter strips from the canyon & facades ------------------------------------
  const R = rng(777);
  for (const p of parks.planters) {
    const [ax, ay, az] = p.a, [bx, , bz] = p.b, [cx, , cz] = p.a2, [dx, , dz] = p.b2;
    const ysl = ay + (p.kind === 'rim' ? 0.02 : 0.25);
    upQuad(soil, [ax, ysl, az], [bx, ysl, bz], [dx, ysl, dz], [cx, ysl, cz]);
    if (p.kind === 'rim') {
      // inner face towards the terrace walk
      kerb.quadAuto([cx, ay - 0.62, cz], [dx, ay - 0.62, dz], [dx, ay, dz], [cx, ay, cz], null, mulc(PALETTE.sand, 0.9));
    }
    const len = Math.hypot(bx - ax, bz - az);
    const depth = Math.hypot(cx - ax, cz - az);
    const rot = Math.atan2(p.n[0], p.n[1]);
    // hanging greenery over the front edge
    if (R.chance(p.outer ? 0.5 : 0.75)) veg.add('hang', ax + p.n[0] * 0.1, ay + 0.05, az + p.n[1] * 0.1, R.range(0.8, 1.4), rot, [R.range(0.85, 1.0), R.range(0.95, 1.1), 0.85]);
    if (p.outer) continue;
    // shrubs / grasses in the strip
    if (depth > 0.8 && R.chance(Math.min(1, len * 0.9))) {
      const t = R.range(0.2, 0.8);
      const k = R.range(0.25, 0.75);
      const x = ax + (cx - ax) * k + (bx - ax) * t, z = az + (cz - az) * k + (bz - az) * t;
      const kind = R.chance(0.6) ? 'shrub' : R.chance(0.6) ? 'grass' : 'azalea';
      veg.add(kind, x, ysl, z, R.range(0.8, 1.3), R.range(0, 6));
      if (depth > 4 && R.chance(0.08)) veg.add(R.pick(['olive', 'momiji', 'pine']), x, ysl, z, R.range(0.7, 1.0), R.range(0, 6));
    }
  }
  try { canyonFloor(ctx, parks, veg); } catch (e) { console.error('[canyonFloor]', e); ctx.errors.push('canyonFloor: ' + e.message); }
  veg.build();
  const M = materials;
  const vc = (name, color, r, m) => { if (!M.factories.has(name)) M.define(name, () => new THREE.MeshStandardMaterial({ color, roughness: r, metalness: m, vertexColors: true })); return M.get(name); };
  parks.root.add(kerb.mesh(vc('parks_vcol_stone', 0xffffff, 0.8, 0), { name: 'parks:kerbs' }));
  parks.root.add(soil.mesh(M.get('parks_groundcover'), { name: 'parks:soil', cast: false }));
  parks.root.add(pave.mesh(M.get('parks_paving'), { name: 'parks:paths', cast: false }));
  if (!deck.empty) parks.root.add(deck.mesh(M.get('parks_deck'), { name: 'parks:decks', cast: false }));
  if (!water.empty) parks.root.add(water.mesh(waterMat(ctx), { name: 'parks:water', cast: false }));
  if (!wood.empty) parks.root.add(wood.mesh(M.get('parks_bench_wood'), { name: 'parks:wood' }));
  if (!metal.empty) parks.root.add(metal.mesh(M.get('parks_steel_dark'), { name: 'parks:metal' }));
  if (!glow.empty) parks.root.add(glow.mesh(M.get('parks_lamp_glow'), { name: 'parks:lampglow', cast: false }));
  if (!stone.empty) parks.root.add(stone.mesh(vc('parks_vcol_rock', 0xffffff, 0.9, 0), { name: 'parks:rocks' }));
  parks.gardenStats = { boxes, plants: veg.count() };
  return {
    update(dt) {
      const cam = ctx.camera.getWorldPosition(_cam);
      veg.update(dt, cam);
      if (waterU) waterU.uTime.value += dt;
    },
  };
}
const _cam = new THREE.Vector3();
// horizontal quad, wound to face up whatever the input order
function upQuad(acc, a, b, c, d) {
  const ux = b[0] - a[0], uz = b[2] - a[2], vx = d[0] - a[0], vz = d[2] - a[2];
  const ny = uz * vx - ux * vz;
  const uv = (p) => [p[0] / 3, p[2] / 3];
  if (ny > 0) acc.quad(a, b, c, d, [0, 1, 0], [uv(a), uv(b), uv(c), uv(d)]);
  else acc.quad(a, d, c, b, [0, 1, 0], [uv(a), uv(d), uv(c), uv(b)]);
}
const ROCK = new THREE.DodecahedronGeometry(1, 0);

let waterU = null;
function waterMat(ctx) {
  const M = ctx.materials;
  if (!M.factories.has('parks_water_anim')) M.define('parks_water_anim', () => {
    const m = new THREE.MeshStandardMaterial({ color: 0x23423f, roughness: 0.05, metalness: 0.1 });
    waterU = { uTime: { value: 0 } };
    m.onBeforeCompile = (s) => {
      s.uniforms.uTime = waterU.uTime;
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPw;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPw = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying vec3 vWPw;')
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          { vec2 p = vWPw.xz; float t = uTime;
            vec2 g = vec2(sin(p.x * 3.1 + t * 1.7) + sin(p.x * 1.3 - p.y * 2.1 + t * 1.1), cos(p.y * 2.7 + t * 1.3) + sin(p.y * 1.7 + p.x * 0.9 - t * 0.9)) * 0.035;
            normal = normalize(normal + (viewMatrix * vec4(g.x, 0.0, g.y, 0.0)).xyz); }`);
    };
    m.userData.nbReflect = 1;
    return m;
  });
  return M.get('parks_water_anim');
}

function bench(wood, metal, x, y, z, rot, side) {
  // backrest towards the bed (local +z = side)
  const m = M4().makeTranslation(x, y, z).multiply(M4().makeRotationY(rot));
  const put = (acc, cx, cy, cz, sx, sy, sz, col) => acc.geometry(BOX, m.clone().multiply(M4().makeTranslation(cx, cy, cz)).multiply(M4().makeScale(sx, sy, sz)), col);
  for (let k = 0; k < 4; k++) put(wood, 0, 0.44, -0.2 + k * 0.11, 1.8, 0.04, 0.09);
  for (let k = 0; k < 3; k++) put(wood, 0, 0.62 + k * 0.12, 0.26 * side, 1.8, 0.08, 0.03);
  for (const sx of [-0.75, 0.75]) { put(metal, sx, 0.21, 0, 0.06, 0.42, 0.5); put(metal, sx, 0.62, 0.25 * side, 0.05, 0.5, 0.05); }
}
function lamp(metal, glow, x, y, z) {
  metal.geometry(CYL, M4().makeTranslation(x, y + 1.7, z).multiply(M4().makeScale(0.05, 3.4, 0.05)));
  metal.geometry(BOX, M4().makeTranslation(x, y + 3.45, z).multiply(M4().makeScale(0.32, 0.06, 0.32)));
  glow.geometry(BOX, M4().makeTranslation(x, y + 3.3, z).multiply(M4().makeScale(0.22, 0.24, 0.22)));
}
const CYL = new THREE.CylinderGeometry(1, 1, 1, 8);
