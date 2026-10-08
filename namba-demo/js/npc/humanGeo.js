// =============================================================================
// Procedural low-poly human for the crowd, modelled at 1.70 m facing -Z, feet
// at y = 0. Every vertex carries aPart = (bone, region, selGroup, selValue):
//   bone    rigid limb the vertex follows in the vertex-shader animation
//   region  colour slot (skin, hair, top, inner, bottom, shoes, acc, …)
//   sel     variant selector: 0 always · 1 hairStyle==v · 2 bit v set ·
//           3 bit v clear  (hidden variants collapse to a degenerate point)
// One mesh holds every hairstyle / garment / accessory; per-instance flags
// pick what shows. LOD 0 ≈ 1.4k tris, LOD 1 ≈ 400, LOD 2 ≈ 90.
// =============================================================================
import * as THREE from 'three';
import { BIT } from './looks.js?v=6c67dba';

export const BONE = { PELVIS: 0, TORSO: 1, HEAD: 2, UARM_L: 3, FARM_L: 4, UARM_R: 5, FARM_R: 6, THIGH_L: 7, SHIN_L: 8, THIGH_R: 9, SHIN_R: 10, GROUND: 11 };
export const REG = { SKIN: 0, HAIR: 1, TOP: 2, INNER: 3, BOTTOM: 4, SHOES: 5, ACC: 6, ACC2: 7, DARK: 8, WHITE: 9, METAL: 10, LEGWEAR: 11, EYE: 12, SCREEN: 13 };

const ALWAYS = [0, 0], hair = (v) => [1, v], has = (b) => [2, b], not = (b) => [3, b];

class GB {
  constructor() { this.p = []; this.n = []; this.a = []; }
  v(x, y, z, nx, ny, nz, part) { this.p.push(x, y, z); this.n.push(nx, ny, nz); this.a.push(part[0], part[1], part[2], part[3]); }
  // rings: [[y, cx, cz, rx, rz], ...] bottom to top. seg around.
  lathe(rings, seg, bone, region, sel, { capBot = false, capTop = false, phase = 0 } = {}) {
    const part = [bone, region, sel[0], sel[1]];
    const pts = rings.map(([y, cx, cz, rx, rz]) => {
      const out = [];
      for (let i = 0; i <= seg; i++) {
        const t = (i / seg) * Math.PI * 2 + phase;
        const c = Math.cos(t), s = Math.sin(t);
        const nl = Math.hypot(c / Math.max(rx, 1e-3), s / Math.max(rz, 1e-3)) || 1;
        out.push([cx + c * rx, y, cz + s * rz, (c / Math.max(rx, 1e-3)) / nl, 0, (s / Math.max(rz, 1e-3)) / nl]);
      }
      return out;
    });
    for (let k = 0; k + 1 < pts.length; k++) {
      const A = pts[k], B = pts[k + 1];
      for (let i = 0; i < seg; i++) {
        const a = A[i], b = A[i + 1], c = B[i + 1], d = B[i];
        this.v(...a, part); this.v(...c, part); this.v(...b, part);
        this.v(...a, part); this.v(...d, part); this.v(...c, part);
      }
    }
    const cap = (R, up) => {
      const y = R[0][1]; let cx = 0, cz = 0; for (let i = 0; i < seg; i++) { cx += R[i][0]; cz += R[i][2]; } cx /= seg; cz /= seg;
      for (let i = 0; i < seg; i++) {
        const a = R[i], b = R[i + 1];
        if (up) { this.v(cx, y, cz, 0, 1, 0, part); this.v(b[0], y, b[2], 0, 1, 0, part); this.v(a[0], y, a[2], 0, 1, 0, part); }
        else { this.v(cx, y, cz, 0, -1, 0, part); this.v(a[0], y, a[2], 0, -1, 0, part); this.v(b[0], y, b[2], 0, -1, 0, part); }
      }
    };
    if (capBot) cap(pts[0], false);
    if (capTop) cap(pts[pts.length - 1], true);
  }
  // ellipsoid with optional per-vertex deform(dx,dy,dz) -> [x,y,z] | null(collapse inward)
  ellipsoid(c, r, segU, segV, bone, region, sel, deform = null) {
    const part = [bone, region, sel[0], sel[1]];
    const grid = [];
    for (let j = 0; j <= segV; j++) {
      const phi = (j / segV) * Math.PI; // 0 top
      const row = [];
      for (let i = 0; i <= segU; i++) {
        const th = (i / segU) * Math.PI * 2;
        const dx = Math.sin(phi) * Math.sin(th), dy = Math.cos(phi), dz = -Math.sin(phi) * Math.cos(th); // th=0 -> front (-z)
        let p = [c[0] + dx * r[0], c[1] + dy * r[1], c[2] + dz * r[2]];
        if (deform) { const q = deform(dx, dy, dz, p); if (q) p = q; else p = [c[0] + dx * r[0] * 0.8, c[1] + dy * r[1] * 0.8, c[2] + dz * r[2] * 0.8]; }
        const nl = Math.hypot(dx / r[0], dy / r[1], dz / r[2]) || 1;
        row.push([p[0], p[1], p[2], dx / r[0] / nl, dy / r[1] / nl, dz / r[2] / nl]);
      }
      grid.push(row);
    }
    for (let j = 0; j < segV; j++) for (let i = 0; i < segU; i++) {
      const a = grid[j][i], b = grid[j][i + 1], cc = grid[j + 1][i + 1], d = grid[j + 1][i];
      if (j > 0) { this.v(...a, part); this.v(...b, part); this.v(...cc, part); }
      if (j < segV - 1) { this.v(...a, part); this.v(...cc, part); this.v(...d, part); }
    }
  }
  // box centred at c with half sizes h; optional rotation about X (rx) around pivot, then Y (ry)
  box(c, h, bone, region, sel, { rx = 0, ry = 0, pivot = null, taper = 1 } = {}) {
    const part = [bone, region, sel[0], sel[1]];
    const P = pivot || c;
    const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry);
    const tf = (x, y, z) => {
      let X = x - P[0], Y = y - P[1], Z = z - P[2];
      let y2 = Y * cx - Z * sx, z2 = Y * sx + Z * cx; Y = y2; Z = z2;
      let x3 = X * cy + Z * sy, z3 = -X * sy + Z * cy; X = x3; Z = z3;
      return [X + P[0], Y + P[1], Z + P[2]];
    };
    const tn = (x, y, z) => { let y2 = y * cx - z * sx, z2 = y * sx + z * cx; return [x * cy + z2 * sy, y2, -x * sy + z2 * cy]; };
    const [X, Y, Z] = c, [a, b, d] = h;
    const tp = (sy_) => (sy_ > 0 ? taper : 1);
    const corner = (i, j, k) => tf(X + i * a * tp(j), Y + j * b, Z + k * d * tp(j));
    const face = (n, q) => { const N = tn(...n); const [p0, p1, p2, p3] = q; this.v(...p0, ...N, part); this.v(...p1, ...N, part); this.v(...p2, ...N, part); this.v(...p0, ...N, part); this.v(...p2, ...N, part); this.v(...p3, ...N, part); };
    const C = (i, j, k) => corner(i, j, k);
    face([0, 0, -1], [C(-1, -1, -1), C(-1, 1, -1), C(1, 1, -1), C(1, -1, -1)]);
    face([0, 0, 1], [C(1, -1, 1), C(1, 1, 1), C(-1, 1, 1), C(-1, -1, 1)]);
    face([1, 0, 0], [C(1, -1, -1), C(1, 1, -1), C(1, 1, 1), C(1, -1, 1)]);
    face([-1, 0, 0], [C(-1, -1, 1), C(-1, 1, 1), C(-1, 1, -1), C(-1, -1, -1)]);
    face([0, 1, 0], [C(-1, 1, -1), C(-1, 1, 1), C(1, 1, 1), C(1, 1, -1)]);
    face([0, -1, 0], [C(-1, -1, 1), C(-1, -1, -1), C(1, -1, -1), C(1, -1, 1)]);
  }
  // rounded box (superellipsoid), optional rotation about X around a pivot like box()
  sup(c, h, bone, region, sel, { p = 4, su = 12, sv = 7, rx = 0, pivot = null, taper = 1 } = {}) {
    const part = [bone, region, sel[0], sel[1]];
    const P = pivot || c, e = 2 / p, e2 = 2 - e;
    const cx = Math.cos(rx), sx = Math.sin(rx);
    const sg = (v, k) => Math.sign(v) * Math.pow(Math.abs(v), k);
    const grid = [];
    for (let j = 0; j <= sv; j++) {
      const ph = -Math.PI / 2 + (j / sv) * Math.PI, cp = Math.cos(ph), sp = Math.sin(ph);
      const row = [];
      for (let i = 0; i <= su; i++) {
        const th = (i / su) * Math.PI * 2, ct = Math.cos(th), st = Math.sin(th);
        const tp = sp > 0 ? taper : 1;
        let X = c[0] + h[0] * tp * sg(cp, e) * sg(ct, e), Y = c[1] + h[1] * sg(sp, e), Z = c[2] + h[2] * tp * sg(cp, e) * sg(st, e);
        let nx = sg(cp, e2) * sg(ct, e2) / h[0], ny = sg(sp, e2) / h[1], nz = sg(cp, e2) * sg(st, e2) / h[2];
        const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
        let y0 = Y - P[1], z0 = Z - P[2];
        const Yr = y0 * cx - z0 * sx + P[1], Zr = y0 * sx + z0 * cx + P[2];
        const nyr = ny * cx - nz * sx, nzr = ny * sx + nz * cx;
        row.push([X, Yr, Zr, nx, nyr, nzr]);
      }
      grid.push(row);
    }
    for (let j = 0; j < sv; j++) for (let i = 0; i < su; i++) {
      const a = grid[j][i], b = grid[j][i + 1], cc = grid[j + 1][i + 1], d = grid[j + 1][i];
      if (j > 0) { this.v(...a, part); this.v(...cc, part); this.v(...b, part); }
      if (j < sv - 1) { this.v(...a, part); this.v(...d, part); this.v(...cc, part); }
    }
  }
  // accessory body: rounded where there is budget, plain box otherwise
  acc(lod, c, h, bone, region, sel, o = {}) {
    if (lod >= 2) return this.box(c, h, bone, region, sel, o);
    return this.sup(c, h, bone, region, sel, { p: o.p || 4, su: lod === 0 ? 10 : 6, sv: lod === 0 ? 6 : 3, rx: o.rx || 0, pivot: o.pivot || null, taper: o.taper || 1 });
  }
  // thin quad facing -z (front) at depth z
  panel(x0, x1, y0, y1, z, bone, region, sel, { topX0 = x0, topX1 = x1, nz = -1 } = {}) {
    const part = [bone, region, sel[0], sel[1]];
    const a = [x0, y0, z], b = [x1, y0, z], c = [topX1, y1, z], d = [topX0, y1, z];
    if (nz < 0) { this.v(...a, 0, 0, -1, part); this.v(...c, 0, 0, -1, part); this.v(...b, 0, 0, -1, part); this.v(...a, 0, 0, -1, part); this.v(...d, 0, 0, -1, part); this.v(...c, 0, 0, -1, part); }
    else { this.v(...a, 0, 0, 1, part); this.v(...b, 0, 0, 1, part); this.v(...c, 0, 0, 1, part); this.v(...a, 0, 0, 1, part); this.v(...c, 0, 0, 1, part); this.v(...d, 0, 0, 1, part); }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('aPart', new THREE.Float32BufferAttribute(this.a, 4));
    g.computeBoundingSphere();
    return g;
  }
}

const HEAD_C = [0, 1.615, -0.005], HEAD_R = [0.081, 0.106, 0.094];

// hair shells: deform a slightly larger ellipsoid around the head
function hairDeform(style) {
  const C = HEAD_C, R = [HEAD_R[0] * 1.13, HEAD_R[1] * 1.08, HEAD_R[2] * 1.12];
  return (dx, dy, dz) => {
    const front = -dz; // 1 at the face
    const faceZone = front > 0.25 && dy < 0.32 && Math.abs(dx) < 0.66;
    const sp = Math.hypot(dx, dz) || 1e-3, fr = -dz / sp; // fr: 1 at the face, -1 at the nape
    let thr;
    if (style === 4) thr = (fr >= 0 ? -0.05 + 0.55 * Math.pow(fr, 1.5) : -0.05 + 0.3 * fr) + 0.08;
    else thr = (fr >= 0 ? -0.12 + 0.64 * Math.pow(fr, 1.5) : -0.12 + 0.33 * fr) + 0.045 * Math.sin(dx * 13);
    if (style === 1 || style === 2) thr = 0.34;
    const x = C[0] + dx * R[0], y = C[1] + dy * R[1], z = C[2] + dz * R[2];
    if (style === 0 || style === 3 || style === 4) {
      if (dy >= thr) return [x, y, z];
      // clamp onto the hairline rim (a clean edge instead of collapsed, jagged triangles)
      const k = Math.sqrt(Math.max(0, 1 - thr * thr)) / Math.sqrt(Math.max(1e-3, 1 - dy * dy));
      return [C[0] + dx * R[0] * k, C[1] + thr * R[1], C[2] + dz * R[2] * k];
    }
    // bob (1) / long (2)
    if (faceZone || (front > 0.55 && dy < 0.34)) {
      if (dy >= 0.34) return [x, y, z];
      const k = Math.sqrt(1 - 0.34 * 0.34) / Math.sqrt(Math.max(1e-3, 1 - dy * dy));
      return [C[0] + dx * R[0] * k, C[1] + 0.34 * R[1], C[2] + dz * R[2] * k];
    }
    if (dy >= 0.15) return [x, y, z];
    const len = style === 1 ? 0.14 : 0.33;
    const t = (0.15 - dy) / 1.15; // 0..1 downwards
    const yy = C[1] + 0.15 * R[1] - t * (0.15 * R[1] + len + (style === 2 && dz > 0 ? 0.02 : 0));
    const spread = (style === 2 ? 1.0 + 0.16 * Math.sin(Math.min(1, t * 1.6) * 2.4) : 1.0 + 0.1 * Math.sin(Math.min(1, t * 1.8) * 2.2)) + 0.012 * Math.sin(dx * 11 + t * 7);
    const zz = C[2] + dz * R[2] * spread + (style === 2 ? 0.02 * t : 0);
    return [C[0] + dx * R[0] * spread, yy, front > 0 ? Math.min(zz, C[2] - 0.0) : zz];
  };
}

export function buildHuman(lod = 0) {
  const g = new GB();
  const B = BONE, R = REG;
  const segL = lod === 0 ? 12 : lod === 1 ? 7 : 4;
  const segT = lod === 0 ? 20 : lod === 1 ? 10 : 4;
  // ---- legs --------------------------------------------------------------
  for (const side of [-1, 1]) {
    const x = 0.09 * side;
    const thigh = side < 0 ? B.THIGH_L : B.THIGH_R, shin = side < 0 ? B.SHIN_L : B.SHIN_R;
    // trousers
    g.lathe([[0.5, x, 0, 0.064, 0.07], [0.92, x * 1.05, 0, 0.085, 0.09]], segL, thigh, R.BOTTOM, not(BIT.SKIRT));
    g.lathe([[0.075, x, 0.005, 0.052, 0.055], [0.3, x, 0, 0.058, 0.062], [0.5, x, 0, 0.064, 0.07]], segL, shin, R.BOTTOM, not(BIT.SKIRT));
    // bare/tights legs under skirts
    g.lathe([[0.075, x, 0.005, 0.042, 0.045], [0.32, x, 0.005, 0.05, 0.055], [0.52, x, 0, 0.055, 0.06]], segL, shin, R.LEGWEAR, has(BIT.SKIRT));
    if (lod < 2) g.lathe([[0.5, x, 0, 0.058, 0.062], [0.8, x, 0, 0.07, 0.074]], segL, thigh, R.LEGWEAR, has(BIT.SKIRT));
    // knee cap hides the seam when the leg bends
    if (lod < 2) g.ellipsoid([x, 0.5, 0], [0.068, 0.06, 0.07], lod === 0 ? 10 : 6, lod === 0 ? 7 : 4, shin, R.BOTTOM, not(BIT.SKIRT));
    if (lod < 2) g.ellipsoid([x, 0.5, 0], [0.058, 0.06, 0.06], lod === 0 ? 10 : 6, lod === 0 ? 7 : 4, shin, R.LEGWEAR, has(BIT.SKIRT));
    // shoes
    if (lod === 0) {
      g.ellipsoid([x, 0.043, -0.045], [0.047, 0.043, 0.125], 12, 8, shin, R.SHOES, ALWAYS, (dx, dy, dz, p) => [p[0], Math.max(0.004, p[1]), p[2]]);
      g.ellipsoid([x, 0.009, -0.047], [0.039, 0.011, 0.118], 10, 4, shin, R.WHITE, ALWAYS, (dx, dy, dz, p) => [p[0], Math.max(0.0, p[1]), p[2]]); // sole
    } else if (lod === 1) g.ellipsoid([x, 0.043, -0.045], [0.047, 0.043, 0.125], 6, 4, shin, R.SHOES, ALWAYS, (dx, dy, dz, p) => [p[0], Math.max(0.004, p[1]), p[2]]);
    else g.box([x, 0.04, -0.035], [0.05, 0.04, 0.13], shin, R.SHOES, ALWAYS, { taper: 0.9 });
  }
  // ---- pelvis / skirt / coat --------------------------------------------
  g.lathe([[0.84, 0, 0, 0.165, 0.11], [0.98, 0, 0, 0.165, 0.112]], segT, B.PELVIS, R.BOTTOM, ALWAYS, { capBot: true });
  g.lathe([[lod === 2 ? 0.5 : 0.46, 0, 0.01, 0.235, 0.19], [0.7, 0, 0.005, 0.2, 0.15], [0.98, 0, 0, 0.168, 0.115]], segT, B.PELVIS, R.BOTTOM, has(BIT.SKIRT), { capBot: lod === 2 });
  if (lod < 2) g.lathe([[0.5, 0, 0.015, 0.215, 0.17], [0.75, 0, 0.01, 0.19, 0.14], [0.99, 0, 0, 0.172, 0.118]], segT, B.PELVIS, R.TOP, has(BIT.COAT));
  // ---- torso -------------------------------------------------------------
  const torso = lod === 0
    ? [[0.96, 0, 0, 0.16, 0.108], [1.03, 0, 0, 0.152, 0.104], [1.1, 0, 0, 0.15, 0.104], [1.19, 0, -0.002, 0.162, 0.112], [1.27, 0, -0.005, 0.18, 0.12], [1.34, 0, -0.003, 0.19, 0.118], [1.395, 0, 0, 0.192, 0.108], [1.435, 0, 0.004, 0.172, 0.094], [1.465, 0, 0.008, 0.12, 0.075], [1.49, 0, 0.01, 0.062, 0.058]]
    : [[0.96, 0, 0, 0.16, 0.108], [1.1, 0, 0, 0.158, 0.106], [1.27, 0, -0.004, 0.18, 0.118], [1.38, 0, 0, 0.192, 0.112], [1.45, 0, 0.005, 0.16, 0.09], [1.485, 0, 0.01, 0.07, 0.06]];
  g.lathe(lod === 2 ? [torso[0], torso[2], torso[4]] : torso, segT, B.TORSO, R.TOP, ALWAYS, { capTop: lod === 2 });
  if (lod < 2) {
    // open jacket: shirt V + tie
    g.panel(-0.055, 0.055, 1.13, 1.43, -0.121, B.TORSO, R.INNER, has(BIT.JACKET), { topX0: -0.07, topX1: 0.07 });
    if (lod === 0) g.panel(-0.016, 0.016, 1.12, 1.42, -0.1235, B.TORSO, R.ACC2, has(BIT.TIE), { topX0: -0.012, topX1: 0.012 });
    // apron
    g.panel(-0.15, 0.15, 0.55, 1.3, -0.128, B.TORSO, R.ACC2, has(BIT.APRON), { topX0: -0.12, topX1: 0.12 });
  }
  // neck
  g.lathe([[1.46, 0, 0.01, 0.045, 0.045], [1.56, 0, 0.012, 0.042, 0.042]], lod === 0 ? 8 : 4, B.HEAD, R.SKIN, ALWAYS);
  if (lod === 0) {
    g.lathe([[1.5, 0, 0.012, 0.056, 0.056], [1.535, 0, 0.012, 0.052, 0.052]], 14, B.TORSO, R.INNER, has(BIT.JACKET)); // shirt collar
    g.lathe([[0.955, 0, 0, 0.1655, 0.1125], [0.985, 0, 0, 0.1655, 0.1125]], 20, B.PELVIS, R.DARK, not(BIT.SKIRT)); // belt
  }
  // ---- head --------------------------------------------------------------
  const hu = lod === 0 ? 18 : lod === 1 ? 8 : 4, hv = lod === 0 ? 13 : lod === 1 ? 6 : 3;
  // head: slightly narrower jaw and a chin, flatter face plane
  const headDeform = (dx, dy, dz, p) => {
    const t = Math.max(0, -dy - 0.15) / 0.85; // 0 above the cheek line .. 1 at the chin
    const sx = 1 - 0.3 * t * t - 0.05 * t, sz = 1 - 0.12 * t;
    return [HEAD_C[0] + dx * HEAD_R[0] * sx, p[1] + (dy < -0.5 ? 0.004 * (-dy - 0.5) : 0), HEAD_C[2] + dz * HEAD_R[2] * sz + (dz < 0 && dy < -0.5 ? -0.01 * t : 0)];
  };
  g.ellipsoid(HEAD_C, HEAD_R, hu, hv, B.HEAD, R.SKIN, ALWAYS, lod < 2 ? headDeform : null);
  if (lod === 0) {
    // ears, nose (eyes, brows and mouth are painted in the fragment shader)
    for (const s_ of [-1, 1]) g.ellipsoid([0.082 * s_, 1.612, 0.006], [0.009, 0.024, 0.016], 8, 6, B.HEAD, R.SKIN, ALWAYS);
    g.ellipsoid([0, 1.598, -0.093], [0.0075, 0.016, 0.011], 8, 6, B.HEAD, R.SKIN, ALWAYS, (dx, dy, dz, p) => [p[0] * (1 + 0.5 * Math.max(0, -dy)), p[1], p[2] - 0.003 * Math.max(0, -dy)]);
    // mask (white), glasses (dark frame)
    g.ellipsoid([0, 1.578, -0.03], [0.083, 0.045, 0.075], 8, 4, B.HEAD, R.WHITE, has(BIT.MASK), (dx, dy, dz) => (dz < -0.15 ? [dx * 0.083, 1.578 + dy * 0.045, -0.03 + dz * 0.075] : null));
    g.box([0, 1.629, -0.094], [0.06, 0.0045, 0.004], B.HEAD, R.DARK, has(BIT.GLASSES));
    // hair styles
    for (const st of [0, 1, 2, 3, 4]) g.ellipsoid(HEAD_C, [HEAD_R[0] * 1.13, HEAD_R[1] * 1.08, HEAD_R[2] * 1.12], 18, 12, B.HEAD, R.HAIR, hair(st), hairDeform(st));
    g.ellipsoid([0, 1.69, 0.085], [0.04, 0.04, 0.035], 6, 4, B.HEAD, R.HAIR, hair(3));
    // cap
    g.lathe([[1.66, 0, 0.0, 0.094, 0.104], [1.72, 0, 0.0, 0.088, 0.098], [1.735, 0, 0, 0.05, 0.06]], 10, B.HEAD, R.ACC2, has(BIT.CAP), { capTop: true });
    g.box([0, 1.665, -0.12], [0.075, 0.006, 0.05], B.HEAD, R.ACC2, has(BIT.CAP));
  } else if (lod === 1) {
    for (const st of [0, 1, 2, 3, 4]) g.ellipsoid(HEAD_C, [HEAD_R[0] * 1.13, HEAD_R[1] * 1.08, HEAD_R[2] * 1.12], 7, 5, B.HEAD, R.HAIR, hair(st), hairDeform(st));
    g.lathe([[1.66, 0, 0.0, 0.094, 0.104], [1.735, 0, 0, 0.06, 0.07]], 6, B.HEAD, R.ACC2, has(BIT.CAP), { capTop: true });
  } else {
    g.box([0, 1.67, 0.01], [0.088, 0.06, 0.1], B.HEAD, R.HAIR, ALWAYS);
  }
  // ---- arms --------------------------------------------------------------
  for (const side of [-1, 1]) {
    const ua = side < 0 ? B.UARM_L : B.UARM_R, fa = side < 0 ? B.FARM_L : B.FARM_R;
    const sx = 0.198 * side;
    g.lathe([[1.13, sx + 0.017 * side, 0, 0.044, 0.046], [1.3, sx + 0.008 * side, 0, 0.05, 0.052], [1.42, sx, 0, 0.055, 0.058]], segL, ua, R.TOP, ALWAYS, { capTop: lod === 2 });
    g.lathe([[0.875, sx + 0.025 * side, 0, 0.033, 0.035], [1.0, sx + 0.021 * side, 0, 0.038, 0.04], [1.14, sx + 0.017 * side, 0, 0.043, 0.045]], segL, fa, R.TOP, ALWAYS);
    // shoulder cap closes the joint between torso and sleeve
    if (lod < 2) g.ellipsoid([sx - 0.004 * side, 1.392, 0], [0.057, 0.058, 0.058], lod === 0 ? 10 : 6, lod === 0 ? 8 : 4, ua, R.TOP, ALWAYS);
    // hand
    if (lod === 0) {
      g.ellipsoid([sx + 0.026 * side, 0.82, -0.004], [0.024, 0.06, 0.036], 10, 7, fa, R.SKIN, ALWAYS);
      g.ellipsoid([sx + 0.026 * side - 0.019 * side, 0.835, -0.03], [0.011, 0.034, 0.012], 6, 5, fa, R.SKIN, ALWAYS); // thumb
      g.lathe([[0.89, sx + 0.024 * side, 0, 0.0365, 0.0385], [0.93, sx + 0.0235 * side, 0, 0.0375, 0.039]], 10, fa, R.INNER, has(BIT.JACKET)); // shirt cuff
    }
    else g.box([sx + 0.026 * side, 0.825, 0], [0.024, 0.05, 0.035], fa, R.SKIN, ALWAYS);
  }
  // ---- accessories ---------------------------------------------------------
  const hx = 0.198 + 0.026; // hand x
  // briefcase (right hand)
  g.acc(lod, [hx, 0.6, 0], [0.04, 0.14, 0.19], B.FARM_R, R.ACC, has(BIT.BRIEFCASE), { p: 6 });
  if (lod === 0) g.box([hx, 0.76, 0], [0.012, 0.02, 0.05], B.FARM_R, R.DARK, has(BIT.BRIEFCASE));
  // backpack
  g.acc(lod, [0, 1.17, 0.19], [0.15, 0.21, 0.08], B.TORSO, R.ACC, has(BIT.BACKPACK), { taper: 0.9, p: 3 });
  if (lod === 0) for (const s of [-1, 1]) g.box([0.1 * s, 1.3, -0.005], [0.022, 0.15, 0.125], B.TORSO, R.ACC, has(BIT.BACKPACK));
  // shoulder bag (left hip) + strap
  g.acc(lod, [-0.23, 0.98, 0.02], [0.045, 0.1, 0.13], B.TORSO, R.ACC, has(BIT.SHOULDERBAG), { p: 3 });
  if (lod === 0) { g.panel(-0.2, -0.17, 1.06, 1.43, -0.123, B.TORSO, R.ACC, has(BIT.SHOULDERBAG), { topX0: 0.08, topX1: 0.11 }); g.panel(-0.2, -0.17, 1.06, 1.43, 0.123, B.TORSO, R.ACC, has(BIT.SHOULDERBAG), { topX0: 0.08, topX1: 0.11, nz: 1 }); }
  // tote (left hand)
  g.acc(lod, [-hx, 0.65, 0], [0.05, 0.16, 0.16], B.FARM_L, R.ACC, has(BIT.TOTE), { taper: 1.1, p: 3 });
  // shopping bags (left hand; second one in right)
  g.acc(lod, [-hx - 0.01, 0.6, 0], [0.06, 0.16, 0.14], B.FARM_L, R.ACC2, has(BIT.SHOPBAG), { p: 6 });
  if (lod < 2) g.acc(lod, [hx + 0.01, 0.62, 0], [0.055, 0.14, 0.12], B.FARM_R, R.ACC2, has(BIT.SHOPBAG2), { p: 6 });
  // rolling suitcase: on the ground behind-left, tilted towards the left hand
  {
    const piv = [-0.27, 0.0, 0.62];
    g.acc(lod, [-0.27, 0.32, 0.62], [0.19, 0.29, 0.12], B.GROUND, R.ACC2, has(BIT.SUITCASE), { rx: -0.42, pivot: piv, p: 5 });
    if (lod < 2) {
      g.box([-0.27, 0.78, 0.62], [0.11, 0.18, 0.012], B.GROUND, R.DARK, has(BIT.SUITCASE), { rx: -0.42, pivot: piv });
      for (const s of [-1, 1]) g.box([-0.27 + 0.14 * s, 0.03, 0.62], [0.02, 0.03, 0.03], B.GROUND, R.DARK, has(BIT.SUITCASE));
    }
  }
  if (lod === 0) {
    // phone (right hand): lies across the palm, screen up at rest, so a raised forearm tilts it to the face
    g.box([hx - 0.01, 0.8, -0.05], [0.036, 0.0055, 0.074], B.FARM_R, R.DARK, has(BIT.PHONE));
    g.box([hx - 0.01, 0.806, -0.05], [0.031, 0.0012, 0.066], B.FARM_R, R.SCREEN, has(BIT.PHONE));
    // takeaway cup (right hand)
    g.lathe([[0.78, hx, -0.04, 0.03, 0.03], [0.9, hx, -0.04, 0.036, 0.036]], 7, B.FARM_R, R.WHITE, has(BIT.CUP), { capTop: true });
    // umbrella (closed, right hand)
    g.lathe([[0.02, hx + 0.005, -0.02, 0.012, 0.012], [0.25, hx + 0.005, -0.02, 0.035, 0.035], [0.78, hx + 0.005, -0.02, 0.012, 0.012]], 6, B.FARM_R, R.ACC, has(BIT.UMBRELLA));
  }
  // cleaner's trolley, pushed in front: chassis, wheels, frame, bin, bin bag, mop
  if (lod < 2) {
    const C = has(BIT.CART), G = B.GROUND, cz = -0.8;
    g.box([0, 0.11, cz], [0.25, 0.012, 0.21], G, R.METAL, C);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      g.box([0.235 * sx, 0.44, cz + 0.2 * sz], [0.009, 0.33, 0.009], G, R.METAL, C);
      if (lod === 0) g.lathe([[0.0, 0.235 * sx, cz + 0.2 * sz, 0.04, 0.04], [0.08, 0.235 * sx, cz + 0.2 * sz, 0.04, 0.04]], 8, G, R.DARK, C, { capTop: true });
    }
    g.box([0, 0.77, cz + 0.2], [0.245, 0.01, 0.01], G, R.METAL, C);
    g.box([0, 0.77, cz - 0.2], [0.245, 0.01, 0.01], G, R.METAL, C);
    for (const sx of [-1, 1]) g.box([0.235 * sx, 0.77, cz], [0.009, 0.009, 0.21], G, R.METAL, C);
    g.box([0, 0.97, -0.54], [0.25, 0.012, 0.012], G, R.METAL, C); // push bar
    for (const sx of [-1, 1]) g.box([0.235 * sx, 0.58, -0.6], [0.009, 0.4, 0.009], G, R.METAL, C, { rx: -0.14, pivot: [0.235 * sx, 0.11, cz + 0.2] });
    // yellow bin and its lid
    g.lathe([[0.125, -0.1, cz - 0.02, 0.13, 0.13], [0.56, -0.1, cz - 0.02, 0.165, 0.165]], lod === 0 ? 12 : 7, G, R.ACC, C, { capBot: true });
    g.lathe([[0.56, -0.1, cz - 0.02, 0.17, 0.17], [0.59, -0.1, cz - 0.02, 0.15, 0.15]], lod === 0 ? 12 : 7, G, R.DARK, C, { capTop: true });
    // hanging black bag on a hoop at the side
    g.ellipsoid([0.15, 0.6, cz - 0.02], [0.1, 0.17, 0.12], lod === 0 ? 9 : 6, lod === 0 ? 6 : 4, G, R.DARK, C);
    // mop: handle + head
    g.box([0.2, 0.82, cz - 0.17], [0.007, 0.5, 0.007], G, R.METAL, C, { rx: 0.12, pivot: [0.2, 0.3, cz - 0.17] });
    g.ellipsoid([0.2, 1.3, cz - 0.07], [0.07, 0.05, 0.04], lod === 0 ? 8 : 5, lod === 0 ? 5 : 3, G, R.WHITE, C);
  }
  return g.geometry();
}

// soft contact shadow quad (unit, on the ground plane)
export function buildBlob() {
  const g = new THREE.PlaneGeometry(1, 1, 1, 1);
  g.rotateX(-Math.PI / 2);
  return g;
}
