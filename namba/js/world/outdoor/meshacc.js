// Tiny geometry accumulator with explicit per-vertex normals / uvs / colours
// (GeoBatch computes flat normals; curved strata need smooth ones).
import * as THREE from 'three';

export class MeshAcc {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.idx = []; this.v = 0; this.k = null; this.kv = 0; }
  // optional per-vertex scalar (shader 'aKind'): set acc.kv before adding faces
  _k(n) { if (this.kv !== 0 && !this.k) { this.k = new Array(this.v).fill(0); } if (this.k) for (let i = 0; i < n; i++) this.k.push(this.kv); }
  // quad a,b,c,d counter-clockwise seen from the front. n: one normal or [na,nb,nc,nd]
  quad(a, b, c, d, n, uv, col) {
    const ns = Array.isArray(n[0]) ? n : [n, n, n, n];
    const cs = col ? (Array.isArray(col[0]) ? col : [col, col, col, col]) : [[1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1]];
    const uvs = uv || [[0, 0], [1, 0], [1, 1], [0, 1]];
    const pts = [a, b, c, d];
    for (let i = 0; i < 4; i++) {
      this.p.push(pts[i][0], pts[i][1], pts[i][2]);
      this.n.push(ns[i][0], ns[i][1], ns[i][2]);
      this.uv.push(uvs[i][0], uvs[i][1]);
      this.c.push(cs[i][0], cs[i][1], cs[i][2]);
    }
    const v = this.v;
    this._k(4);
    this.idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
    this.v += 4;
  }
  // quad with automatic flat normal (from winding)
  quadAuto(a, b, c, d, uv, col) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    this.quad(a, b, c, d, [nx / l, ny / l, nz / l], uv, col);
  }
  tri(a, b, c, n, uv, col) {
    const cs = col ? (Array.isArray(col[0]) ? col : [col, col, col]) : [[1, 1, 1], [1, 1, 1], [1, 1, 1]];
    const uvs = uv || [[0, 0], [1, 0], [0, 1]];
    const ns = Array.isArray(n[0]) ? n : [n, n, n];
    for (const [i, p] of [a, b, c].entries()) { this.p.push(...p); this.n.push(...ns[i]); this.uv.push(...uvs[i]); this.c.push(...cs[i]); }
    this._k(3);
    this.idx.push(this.v, this.v + 1, this.v + 2); this.v += 3;
  }
  // merge a THREE geometry with a matrix (and optional colour)
  geometry(geom, m, col) {
    const g = geom.index ? geom : geom;
    const P = g.attributes.position, N = g.attributes.normal, UV = g.attributes.uv;
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const v = new THREE.Vector3(), nn = new THREE.Vector3();
    const base = this.v;
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(m); this.p.push(v.x, v.y, v.z);
      if (N) { nn.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); this.n.push(nn.x, nn.y, nn.z); } else this.n.push(0, 1, 0);
      if (UV) this.uv.push(UV.getX(i), UV.getY(i)); else this.uv.push(0, 0);
      const c = col || [1, 1, 1]; this.c.push(c[0], c[1], c[2]);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) this.idx.push(base + g.index.getX(i));
    else for (let i = 0; i < P.count; i++) this.idx.push(base + i);
    this._k(P.count);
    this.v += P.count;
  }
  get empty() { return this.v === 0; }
  build(withColor = true) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (withColor) g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    if (this.k) g.setAttribute('aKind', new THREE.Float32BufferAttribute(this.k, 1));
    g.setIndex(this.v > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
  mesh(material, { cast = true, receive = true, name = '' } = {}) {
    const m = new THREE.Mesh(this.build(!!material.vertexColors), material);
    m.castShadow = cast; m.receiveShadow = receive; m.name = name;
    m.matrixAutoUpdate = false; m.updateMatrix();
    return m;
  }
}

// sRGB hex -> linear [r,g,b]
export function lin(hex) { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; }
export function mulc(c, k) { return [c[0] * k, c[1] * k, c[2] * k]; }
