// =============================================================================
// MB: a small multi-material mesh builder for transit models. Produces ONE
// BufferGeometry with material groups, plus two custom vertex attributes used
// by the patched train/PSD materials:
//   aDoor (vec2): x = signed slide distance of a door leaf (0 = static),
//                 y = which side (+1 local +z, -1 local -z)
//   aKind (float): 0 static, 1 LED destination panel, 2 headlight, 3 taillight
// =============================================================================
import * as THREE from 'three';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _n = new THREE.Vector3();

export class MB {
  constructor(nMat = 4) {
    this.L = []; for (let i = 0; i < nMat; i++) this.L.push({ p: [], n: [], uv: [], c: [], d: [], k: [] });
  }
  _v(m, p, n, uv, col, o) {
    const l = this.L[m];
    l.p.push(p[0], p[1], p[2]); l.n.push(n[0], n[1], n[2]); l.uv.push(uv[0], uv[1]);
    l.c.push(col[0], col[1], col[2]);
    const d = o.door; if (d) l.d.push(d[0], d[1]); else l.d.push(0, 0);
    l.k.push(o.kind || 0);
  }
  _uv(o, p, i) {
    if (o.uvs) return o.uvs[i];
    if (o.uvf) return o.uvf(p);
    return o.uv || [0.5, 0.5];
  }
  _col(o, p, i) {
    if (o.cols) return o.cols[i];
    if (o.colf) return o.colf(p);
    return o.col || [1, 1, 1];
  }
  tri(m, a, b, c, o = {}, idx = [0, 1, 2]) {
    _a.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]); _b.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    _n.crossVectors(_a, _b).normalize();
    const N = [_n.x, _n.y, _n.z];
    const P = [a, b, c];
    for (let i = 0; i < 3; i++) this._v(m, P[i], o.ns ? o.ns[idx[i]] : N, this._uv(o, P[i], idx[i]), this._col(o, P[i], idx[i]), o);
  }
  // a,b,c,d counter-clockwise seen from the front
  quad(m, a, b, c, d, o = {}) {
    this.tri(m, a, b, c, o, [0, 1, 2]);
    this.tri(m, a, c, d, o, [0, 2, 3]);
  }
  // axis-aligned box (optionally rotated about Y by rotY around its centre)
  box(m, cx, cy, cz, sx, sy, sz, o = {}) {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const r = o.rotY || 0, cs = Math.cos(r), sn = Math.sin(r);
    const P = (x, y, z) => [cx + x * cs + z * sn, cy + y, cz - x * sn + z * cs];
    const v = [P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, hy, -hz), P(-hx, hy, -hz), P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz)];
    const f = o.faces || 'nsewtb';
    if (f.includes('s')) this.quad(m, v[4], v[5], v[6], v[7], o);
    if (f.includes('n')) this.quad(m, v[1], v[0], v[3], v[2], o);
    if (f.includes('e')) this.quad(m, v[5], v[1], v[2], v[6], o);
    if (f.includes('w')) this.quad(m, v[0], v[4], v[7], v[3], o);
    if (f.includes('t')) this.quad(m, v[7], v[6], v[2], v[3], o);
    if (f.includes('b')) this.quad(m, v[0], v[1], v[5], v[4], o);
  }
  // a box spanning from point a to point b (thickness w x h), any orientation
  beam(m, a, b, w, h, o = {}) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
    const len = A.distanceTo(B);
    const g = new THREE.BoxGeometry(w, h, len);
    const M = new THREE.Matrix4();
    const mid = A.clone().add(B).multiplyScalar(0.5);
    const up = Math.abs(B.y - A.y) > 0.99 * len ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    M.lookAt(A, B, up); M.setPosition(mid);
    this.geom(m, g, M, o);
    g.dispose();
  }
  cyl(m, a, b, r, seg, o = {}) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
    const len = A.distanceTo(B);
    const g = new THREE.CylinderGeometry(r, r, len, seg, 1, !!o.open);
    g.rotateX(Math.PI / 2); // axis along z
    const M = new THREE.Matrix4();
    const up = Math.abs(B.y - A.y) > 0.99 * len ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    M.lookAt(A, B, up); M.setPosition(A.clone().add(B).multiplyScalar(0.5));
    this.geom(m, g, M, o);
    g.dispose();
  }
  // merge a geometry (keeps its uvs unless o.uv/o.uvf given)
  geom(m, geom, matrix, o = {}) {
    const g = geom.index ? geom.toNonIndexed() : geom;
    const P = g.attributes.position, N = g.attributes.normal, UV = g.attributes.uv;
    const nm = new THREE.Matrix3(); if (matrix) nm.getNormalMatrix(matrix);
    const v = new THREE.Vector3(), n = new THREE.Vector3();
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i); if (matrix) v.applyMatrix4(matrix);
      if (N) { n.fromBufferAttribute(N, i); if (matrix) n.applyMatrix3(nm).normalize(); } else n.set(0, 1, 0);
      const p = [v.x, v.y, v.z];
      let uv;
      if (o.uv || o.uvf) uv = this._uv(o, p, 0);
      else uv = UV ? [UV.getX(i), UV.getY(i)] : [0.5, 0.5];
      this._v(m, p, [n.x, n.y, n.z], uv, this._col(o, p, 0), o);
    }
    if (g !== geom) g.dispose();
  }
  // flat polygon from a THREE.Shape (with holes), placed by a mapper (sx, sy) -> [x,y,z]
  // flip reverses winding. Normal given explicitly.
  shape(m, shape, map, normal, o = {}, flip = false, segs = 6) {
    const g = new THREE.ShapeGeometry(shape, segs);
    const P = g.attributes.position, I = g.index;
    const pts = []; for (let i = 0; i < P.count; i++) pts.push(map(P.getX(i), P.getY(i)));
    const tri = I ? I.array : [...Array(P.count).keys()];
    for (let i = 0; i < tri.length; i += 3) {
      let a = tri[i], b = tri[i + 1], c = tri[i + 2];
      if (flip) [b, c] = [c, b];
      const oo = Object.assign({}, o, { ns: [normal, normal, normal] });
      this.tri(m, pts[a], pts[b], pts[c], oo);
    }
    g.dispose();
  }
  get count() { let s = 0; for (const l of this.L) s += l.p.length / 3; return s; }
  build() {
    const g = new THREE.BufferGeometry();
    const cat = (k) => { const out = []; for (const l of this.L) for (const v of l[k]) out.push(v); return out; };
    g.setAttribute('position', new THREE.Float32BufferAttribute(cat('p'), 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(cat('n'), 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(cat('uv'), 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(cat('c'), 3));
    g.setAttribute('aDoor', new THREE.Float32BufferAttribute(cat('d'), 2));
    g.setAttribute('aKind', new THREE.Float32BufferAttribute(cat('k'), 1));
    let start = 0;
    this.L.forEach((l, i) => { const n = l.p.length / 3; if (n) g.addGroup(start, n, i); start += n; });
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

// rounded rectangle path / shape helpers (in a 2D plane)
export function roundRectPath(path, x0, y0, x1, y1, r) {
  r = Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2);
  path.moveTo(x0 + r, y0);
  path.lineTo(x1 - r, y0); if (r > 0) path.quadraticCurveTo(x1, y0, x1, y0 + r);
  path.lineTo(x1, y1 - r); if (r > 0) path.quadraticCurveTo(x1, y1, x1 - r, y1);
  path.lineTo(x0 + r, y1); if (r > 0) path.quadraticCurveTo(x0, y1, x0, y1 - r);
  path.lineTo(x0, y0 + r); if (r > 0) path.quadraticCurveTo(x0, y0, x0 + r, y0);
  return path;
}
export function ellipsePath(path, cx, cy, rx, ry) { path.absellipse(cx, cy, rx, ry, 0, Math.PI * 2, false, 0); return path; }
