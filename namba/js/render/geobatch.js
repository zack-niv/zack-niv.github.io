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
    for (let i = 0; i < 6; i++) {
      const p = pts[i];
      l.p.push(p[0], p[1], p[2]); l.n.push(nx, ny, nz); l.uv.push(uvs[i][0], uvs[i][1]);
      const col = opt.cols ? opt.cols[[0, 1, 2, 0, 2, 3][i]] : opt.col;
      if (col) { l.hasC = true; l.c.push(col[0], col[1], col[2]); } else l.c.push(1, 1, 1);
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
      if (C) { l.hasC = true; l.c.push(C.getX(i), C.getY(i), C.getZ(i)); }
      else if (col) { l.hasC = true; l.c.push(col[0], col[1], col[2]); } else l.c.push(1, 1, 1);
    }
    if (g !== geom) g.dispose();
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
