// GeoBatch: accumulate lots of quads/boxes/geometries per material and emit
// one merged mesh per material. Use it for anything static and numerous
// (architecture, shelving, signage frames…) to keep draw calls low.
//
//   const gb = new GeoBatch();
//   gb.quad('wall_tile_white', a, b, c, d);   // a..d: [x,y,z] counter-clockwise seen from the front
//   gb.box('steel', cx, cy, cz, sx, sy, sz, rotY);
//   gb.geometry('steel', someBufferGeometry, matrix4);
//   const meshes = gb.build(materials);       // -> THREE.Mesh[] (add to a level root)
//
// Also: cylinder(), tri(), sweep() (profile along a 3D path, u = arc length).
// UVs are world-planar (1 unit = 1 m) unless given, so tiled textures line up
// across merged walls. Optional per-vertex colour `col` [r,g,b] multiplies
// the material (enable material.vertexColors) — used for baked AO / dirt.
import * as THREE from 'three';

const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _m3 = new THREE.Matrix3();

export class GeoBatch {
  constructor() { this.lists = new Map(); }
  _list(mat) {
    let l = this.lists.get(mat);
    if (!l) { l = { p: [], n: [], uv: [], c: [], hasC: false }; this.lists.set(mat, l); }
    return l;
  }
  // vertex colours are stored lazily: back-fill white for earlier vertices
  _col(l, col) {
    if (!l.hasC) { l.hasC = true; const n = l.p.length / 3 - 1; for (let i = 0; i < n; i++) l.c.push(1, 1, 1); }
    l.c.push(col[0], col[1], col[2]);
  }
  // a,b,c,d counter-clockwise when viewed from the side the normal points to
  quad(mat, a, b, c, d, opt = {}) {
    const l = this._list(mat);
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    const pts = [a, b, c, a, c, d];
    const s = opt.uvScale || 1;
    let uvs;
    if (opt.uv) { const [ua, ub, uc, ud] = opt.uv; uvs = [ua, ub, uc, ua, uc, ud]; }
    else {
      const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
      uvs = pts.map(p => ay >= ax && ay >= az ? [p[0] * s, p[2] * s] : ax >= az ? [p[2] * s * -Math.sign(nx), p[1] * s] : [p[0] * s * Math.sign(nz), p[1] * s]);
    }
    const sn = opt.smoothN;
    for (let i = 0; i < 6; i++) {
      const p = pts[i];
      l.p.push(p[0], p[1], p[2]);
      if (sn) { const q = sn[[0, 1, 2, 0, 2, 3][i]]; l.n.push(q[0], q[1], q[2]); } else l.n.push(nx, ny, nz);
      l.uv.push(uvs[i][0], uvs[i][1]);
      const col = opt.cols ? opt.cols[[0, 1, 2, 0, 2, 3][i]] : opt.col;
      if (col) this._col(l, col); else if (l.hasC) l.c.push(1, 1, 1);
    }
  }
  // horizontal rectangle at height y; up=true faces +Y (floor), false faces -Y (ceiling)
  rectH(mat, x0, z0, x1, z1, y, up = true, opt) {
    if (up) this.quad(mat, [x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], opt);
    else this.quad(mat, [x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], opt);
  }
  // vertical wall from (ax,az) to (bx,bz), y0..y1, facing the left side of a->b
  // (i.e. normal = (dz, -dx) normalised... use `flip` to face the other way)
  wall(mat, ax, az, bx, bz, y0, y1, flip = false, opt) {
    if (flip) [ax, az, bx, bz] = [bx, bz, ax, az];
    this.quad(mat, [ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az], opt);
  }
  box(mat, cx, cy, cz, sx, sy, sz, rotY = 0, opt = {}) {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const c = Math.cos(rotY), s = Math.sin(rotY);
    const P = (x, y, z) => [cx + x * c + z * s, cy + y, cz - x * s + z * c];
    const v = [P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, hy, -hz), P(-hx, hy, -hz), P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz)];
    const f = opt.faces || 'nsewtb';
    if (f.includes('s')) this.quad(mat, v[4], v[5], v[6], v[7], opt); // +z
    if (f.includes('n')) this.quad(mat, v[1], v[0], v[3], v[2], opt); // -z
    if (f.includes('e')) this.quad(mat, v[5], v[1], v[2], v[6], opt); // +x
    if (f.includes('w')) this.quad(mat, v[0], v[4], v[7], v[3], opt); // -x
    if (f.includes('t')) this.quad(mat, v[7], v[6], v[2], v[3], opt); // +y
    if (f.includes('b')) this.quad(mat, v[0], v[1], v[5], v[4], opt); // -y
  }
  // merge an arbitrary geometry (indexed or not) with a transform
  geometry(mat, geom, matrix, col) {
    const l = this._list(mat);
    const g = geom.index ? geom.toNonIndexed() : geom;
    const P = g.attributes.position, N = g.attributes.normal, UV = g.attributes.uv, C = g.attributes.color;
    if (matrix) _m3.getNormalMatrix(matrix);
    for (let i = 0; i < P.count; i++) {
      _v.fromBufferAttribute(P, i); if (matrix) _v.applyMatrix4(matrix);
      l.p.push(_v.x, _v.y, _v.z);
      if (N) { _n.fromBufferAttribute(N, i); if (matrix) _n.applyMatrix3(_m3).normalize(); l.n.push(_n.x, _n.y, _n.z); } else l.n.push(0, 1, 0);
      if (UV) l.uv.push(UV.getX(i), UV.getY(i)); else l.uv.push(0, 0);
      if (C) this._col(l, [C.getX(i), C.getY(i), C.getZ(i)]);
      else if (col) this._col(l, col); else if (l.hasC) l.c.push(1, 1, 1);
    }
    if (g !== geom) g.dispose();
  }
  // vertical cylinder (or N-gon prism) centred at (cx, cz) from y0 to y1.
  // UVs: u = arc length (m), v = y (m). opt.caps adds top/bottom discs.
  cylinder(mat, cx, cz, r, y0, y1, seg = 16, opt = {}) {
    const a0 = opt.a0 || 0, a1 = opt.a1 != null ? opt.a1 : Math.PI * 2;
    for (let i = 0; i < seg; i++) {
      const t0 = a0 + (a1 - a0) * i / seg, t1 = a0 + (a1 - a0) * (i + 1) / seg;
      const x0 = cx + Math.cos(t0) * r, z0 = cz + Math.sin(t0) * r, x1 = cx + Math.cos(t1) * r, z1 = cz + Math.sin(t1) * r;
      const u0 = t0 * r, u1 = t1 * r;
      this.quad(mat, [x1, y0, z1], [x0, y0, z0], [x0, y1, z0], [x1, y1, z1], { uv: [[-u1, y0], [-u0, y0], [-u0, y1], [-u1, y1]], smoothN: [[Math.cos(t1), 0, Math.sin(t1)], [Math.cos(t0), 0, Math.sin(t0)], [Math.cos(t0), 0, Math.sin(t0)], [Math.cos(t1), 0, Math.sin(t1)]] });
      if (opt.caps) {
        this.tri(mat, [cx, y1, cz], [x1, y1, z1], [x0, y1, z0]);
        if (opt.caps === 2) this.tri(mat, [cx, y0, cz], [x0, y0, z0], [x1, y0, z1]);
      }
    }
  }
  // single triangle (counter-clockwise from the front), world-planar UVs
  tri(mat, a, b, c, opt = {}) {
    const l = this._list(mat);
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    for (const p of [a, b, c]) {
      l.p.push(p[0], p[1], p[2]); l.n.push(nx, ny, nz);
      if (ay >= ax && ay >= az) l.uv.push(p[0], p[2]); else if (ax >= az) l.uv.push(p[2] * -Math.sign(nx), p[1]); else l.uv.push(p[0] * Math.sign(nz), p[1]);
      const col = opt.col; if (col) this._col(l, col); else if (l.hasC) l.c.push(1, 1, 1);
    }
  }
  // Sweep a closed/open 2D profile along a 3D polyline. profile: [[a, b], ...]
  // in the local frame (a = side vector, b = up-ish vector). UVs: u = arc
  // length along the path (m) * uScale, v = profile perimeter (m).
  sweep(mat, path, profile, opt = {}) {
    const up = opt.up || [0, 1, 0];
    const n = path.length;
    if (n < 2) return;
    const frames = [];
    let arc = 0;
    for (let i = 0; i < n; i++) {
      const p = path[i], q = path[Math.min(n - 1, i + 1)], o = path[Math.max(0, i - 1)];
      let tx = q[0] - o[0], ty = q[1] - o[1], tz = q[2] - o[2];
      const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      // side = t × up
      let sx = ty * up[2] - tz * up[1], sy = tz * up[0] - tx * up[2], sz = tx * up[1] - ty * up[0];
      let sl = Math.hypot(sx, sy, sz);
      if (sl < 1e-4) { sx = 1; sy = 0; sz = 0; sl = 1; }
      sx /= sl; sy /= sl; sz /= sl;
      // b = side × t
      const bx = sy * tz - sz * ty, by = sz * tx - sx * tz, bz = sx * ty - sy * tx;
      if (i > 0) arc += Math.hypot(p[0] - path[i - 1][0], p[1] - path[i - 1][1], p[2] - path[i - 1][2]);
      frames.push({ p, s: [sx, sy, sz], b: [bx, by, bz], arc });
    }
    const us = opt.uScale || 1;
    const closed = opt.closed !== false;
    const m = profile.length, segs = closed ? m : m - 1;
    const per = [0];
    for (let k = 1; k <= m; k++) { const a = profile[k - 1], b = profile[k % m]; per.push(per[k - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
    const P = (f, k) => { const pr = profile[k % m]; return [f.p[0] + f.s[0] * pr[0] + f.b[0] * pr[1], f.p[1] + f.s[1] * pr[0] + f.b[1] * pr[1], f.p[2] + f.s[2] * pr[0] + f.b[2] * pr[1]]; };
    for (let i = 0; i < n - 1; i++) {
      const f0 = frames[i], f1 = frames[i + 1];
      for (let k = 0; k < segs; k++) {
        const a = P(f0, k), b = P(f0, k + 1), c = P(f1, k + 1), d = P(f1, k);
        const uv = [[f0.arc * us, per[k]], [f0.arc * us, per[k + 1]], [f1.arc * us, per[k + 1]], [f1.arc * us, per[k]]];
        // counter-clockwise profiles (in the side/up plane) face outwards
        if (!opt.flip) this.quad(mat, a, d, c, b, { uv: [uv[0], uv[3], uv[2], uv[1]] }); else this.quad(mat, a, b, c, d, { uv });
      }
    }
  }
  get empty() { return this.lists.size === 0; }
  build(materials, { castShadow = false, receiveShadow = true, name = '' } = {}) {
    const meshes = [];
    for (const [mat, l] of this.lists) {
      if (!l.p.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(l.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(l.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(l.uv, 2));
      if (l.hasC) g.setAttribute('color', new THREE.Float32BufferAttribute(l.c, 3));
      g.computeBoundingSphere(); g.computeBoundingBox();
      const material = typeof mat === 'string' ? materials.get(mat) : mat;
      const mesh = new THREE.Mesh(g, material);
      mesh.name = name + ':' + (typeof mat === 'string' ? mat : material.name);
      mesh.castShadow = castShadow; mesh.receiveShadow = receiveShadow;
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      meshes.push(mesh);
    }
    this.lists.clear();
    return meshes;
  }
}
