// =============================================================================
// Environment dressing kit: materials, local frames, low-poly prototypes and
// helpers shared by shops.js and props.js.
//
// Everything static goes through GeoBatch (merged geometry per material).
// Colour comes from vertex colours on a few shared materials (env_matte,
// env_gloss, env_metal, env_wood, env_glow), so hundreds of differently
// coloured objects still cost one draw call per material per batch.
// =============================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GeoBatch } from '../../render/geobatch.js?v=c81de75';

// ---- colours -----------------------------------------------------------------
export function rgb(hex, k = 1) {
  if (Array.isArray(hex)) return [hex[0] * k, hex[1] * k, hex[2] * k];
  const c = new THREE.Color(hex);
  return [c.r * k, c.g * k, c.b * k];
}
export function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
export const WHITE = [1, 1, 1];

// ---- materials -----------------------------------------------------------------
// `boost`: a little self-illumination proportional to albedo, so shop
// interiors read as brightly lit rooms whatever the global lighting does.
function boosted(m, boost) {
  if (!boost) return m;
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += diffuseColor.rgb * ${boost.toFixed(3)};`);
  };
  const base = THREE.Material.prototype.customProgramCacheKey;
  m.customProgramCacheKey = function () { return (base ? base.call(this) : '') + '|envboost' + boost.toFixed(3); };
  return m;
}

function woodTexture() {
  // v2: designed at 256, rasterised at 512 (x2) so floors and counters hold up at 1-2 m
  const K = 2;
  const c = document.createElement('canvas'); c.width = c.height = 256 * K;
  const g = c.getContext('2d');
  g.scale(K, K);
  g.fillStyle = '#c8a27a'; g.fillRect(0, 0, 256, 256);
  let s = 7;
  const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < 90; i++) {
    const y = r() * 256, a = 0.05 + r() * 0.12;
    g.strokeStyle = r() < 0.5 ? `rgba(90,55,25,${a})` : `rgba(255,235,200,${a * 0.7})`;
    g.lineWidth = 0.5 + r() * 2.5;
    g.beginPath(); g.moveTo(0, y);
    for (let x = 0; x <= 256; x += 16) g.lineTo(x, y + Math.sin(x * 0.03 + i) * 2.5 + (r() - 0.5));
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
function tileTexture() {
  const K = 2;
  const c = document.createElement('canvas'); c.width = c.height = 128 * K;
  const g = c.getContext('2d');
  g.scale(K, K);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.fillRect(0, 0, 128, 2); g.fillRect(0, 0, 2, 128); g.fillRect(0, 63, 128, 2); g.fillRect(63, 0, 2, 128);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
function shutterTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 128;
  const g = c.getContext('2d');
  for (let y = 0; y < 128; y += 8) {
    const gr = g.createLinearGradient(0, y, 0, y + 8);
    gr.addColorStop(0, '#d9dcdf'); gr.addColorStop(0.5, '#aeb2b6'); gr.addColorStop(0.9, '#7d8186'); gr.addColorStop(1, '#5c6064');
    g.fillStyle = gr; g.fillRect(0, y, 64, 8);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function defineMaterials(materials) {
  if (materials._envDefined) return;
  materials._envDefined = true;
  const vc = (o, boost) => () => boosted(new THREE.MeshStandardMaterial({ vertexColors: true, ...o }), boost);
  materials.define('env_matte', vc({ roughness: 0.78 }, 0.10));
  materials.define('env_gloss', vc({ roughness: 0.26 }, 0.10));
  materials.define('env_metal', vc({ roughness: 0.34, metalness: 0.75 }, 0.06));
  materials.define('env_wood', () => boosted(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, map: woodTexture() }), 0.12));
  materials.define('env_tile', () => boosted(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, map: tileTexture() }), 0.08));
  materials.define('env_water', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.04, metalness: 0.15, transparent: true, opacity: 0.88, emissive: 0x1a4a66, emissiveIntensity: 0.5 }));
  materials.define('env_glow', () => new THREE.MeshBasicMaterial({ vertexColors: true }));
  materials.define('env_glass', () => new THREE.MeshStandardMaterial({ color: 0xcfe4ea, roughness: 0.04, metalness: 0.2, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }));
  materials.define('env_glass_case', () => new THREE.MeshStandardMaterial({ color: 0xe8f6ff, roughness: 0.03, metalness: 0.1, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide, emissive: 0x9fb8c0, emissiveIntensity: 0.15 }));
  materials.define('env_shutter', () => new THREE.MeshStandardMaterial({ map: shutterTexture(), roughness: 0.45, metalness: 0.55, color: 0xd0d4d8 }));
}

// ---- local frames ----------------------------------------------------------------
// Local coordinates (a, y, d): a = lateral, d = depth. GeoBatch.box rotation
// convention: local x -> (cos r, -sin r), local z -> (sin r, cos r).
export class Frame {
  constructor(ox, oy, oz, rot) {
    this.ox = ox; this.oy = oy; this.oz = oz; this.rot = rot;
    this.c = Math.cos(rot); this.s = Math.sin(rot);
  }
  x(a, d) { return this.ox + a * this.c + d * this.s; }
  z(a, d) { return this.oz - a * this.s + d * this.c; }
  p(a, y, d) { return [this.ox + a * this.c + d * this.s, this.oy + y, this.oz - a * this.s + d * this.c]; }
  // world yaw (player convention: 0 = looking -Z) of a direction given in local (da, dd)
  yaw(da, dd) { const wx = da * this.c + dd * this.s, wz = -da * this.s + dd * this.c; return Math.atan2(-wx, -wz); }
}

// ---- prototype geometries ----------------------------------------------------------
const PROTO = new Map();
function nonIndexed(g) { const n = g.index ? g.toNonIndexed() : g; if (!n.attributes.normal) n.computeVertexNormals(); return n; }
function boxG(sx, sy, sz, x = 0, y = 0, z = 0) { const g = new THREE.BoxGeometry(sx, sy, sz); g.translate(x, y, z); return g; }
export function proto(name) {
  let g = PROTO.get(name);
  if (g) return g;
  switch (name) {
    case 'cyl': g = new THREE.CylinderGeometry(1, 1, 1, 10, 1); g.translate(0, 0.5, 0); break;          // r=1, y 0..1
    case 'cyl6': g = new THREE.CylinderGeometry(1, 1, 1, 6, 1); g.translate(0, 0.5, 0); break;
    case 'cylOpen': g = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true); g.translate(0, 0.5, 0); break;
    case 'sphere': g = new THREE.SphereGeometry(1, 8, 6); break;
    case 'blob': g = new THREE.IcosahedronGeometry(1, 0); break;
    case 'bowl': g = new THREE.LatheGeometry([[0.001, 0], [0.55, 0], [0.62, 0.05], [0.85, 0.4], [1.0, 0.75], [0.97, 0.78]].map(([x, y]) => new THREE.Vector2(x, y)), 8); break;
    case 'plate': g = new THREE.LatheGeometry([[0.001, 0], [0.7, 0], [0.95, 0.06], [1.0, 0.1], [0.96, 0.11], [0.001, 0.05]].map(([x, y]) => new THREE.Vector2(x, y)), 10); break;
    case 'disk': g = new THREE.CircleGeometry(1, 10); g.rotateX(-Math.PI / 2); break;                // facing up, uv 0..1
    case 'bottle': g = new THREE.LatheGeometry([[0.001, 0], [0.33, 0], [0.35, 0.05], [0.35, 0.55], [0.22, 0.72], [0.13, 0.8], [0.13, 0.97], [0.001, 1]].map(([x, y]) => new THREE.Vector2(x, y)), 6); break;
    case 'lantern': { // chochin: unit height 1, radius 0.5, rings top/bottom
      const pts = []; for (let i = 0; i <= 7; i++) { const t = i / 7; pts.push(new THREE.Vector2(0.06 + 0.44 * Math.sin(Math.PI * (0.08 + 0.84 * t)), t)); }
      g = new THREE.LatheGeometry(pts, 10); break;
    }
    case 'chair_frame': g = mergeGeometries([   // v2: slim legs + rails instead of two solid side slabs
      boxG(0.035, 0.45, 0.035, -0.2, 0.225, -0.2), boxG(0.035, 0.45, 0.035, 0.2, 0.225, -0.2),
      boxG(0.035, 0.95, 0.035, -0.2, 0.475, 0.2), boxG(0.035, 0.95, 0.035, 0.2, 0.475, 0.2),
      boxG(0.4, 0.035, 0.03, 0, 0.4, -0.2), boxG(0.4, 0.035, 0.03, 0, 0.4, 0.2), boxG(0.03, 0.035, 0.4, -0.2, 0.4, 0), boxG(0.03, 0.035, 0.4, 0.2, 0.4, 0),
      boxG(0.4, 0.05, 0.03, 0, 0.93, 0.2)].map(nonIndexed)); break;
    case 'chair_seat': g = mergeGeometries([boxG(0.44, 0.05, 0.44, 0, 0.47, 0), boxG(0.42, 0.24, 0.04, 0, 0.74, 0.21)].map(nonIndexed)); break;
    // v4 critic: + a footrest ring (feet of people on high stools rest on it instead of hovering)
    case 'stool': g = mergeGeometries([new THREE.CylinderGeometry(0.18, 0.18, 0.06, 6).translate(0, 0.7, 0), new THREE.CylinderGeometry(0.03, 0.03, 0.68, 5, 1, true).translate(0, 0.35, 0), new THREE.CylinderGeometry(0.2, 0.2, 0.02, 8, 1, true).translate(0, 0.01, 0),
      new THREE.TorusGeometry(0.22, 0.013, 4, 10).rotateX(Math.PI / 2).translate(0, 0.08, 0), boxG(0.44, 0.014, 0.018, 0, 0.08, 0), boxG(0.018, 0.014, 0.44, 0, 0.08, 0)].map(nonIndexed)); break;
    case 'table_leg': g = mergeGeometries([new THREE.CylinderGeometry(0.035, 0.035, 0.72, 5, 1, true).translate(0, 0.36, 0), new THREE.CylinderGeometry(0.22, 0.24, 0.03, 6).translate(0, 0.015, 0)].map(nonIndexed)); break;
    case 'mannequin': {
      const parts = [
        new THREE.SphereGeometry(0.11, 8, 6).scale(0.9, 1.15, 1).translate(0, 1.66, 0),   // head
        new THREE.CylinderGeometry(0.045, 0.05, 0.1, 6).translate(0, 1.52, 0),             // neck
        new THREE.CylinderGeometry(0.19, 0.15, 0.5, 8).scale(1, 1, 0.62).translate(0, 1.23, 0), // torso
        new THREE.CylinderGeometry(0.15, 0.17, 0.22, 8).scale(1, 1, 0.66).translate(0, 0.9, 0),  // hips
        new THREE.CylinderGeometry(0.07, 0.05, 0.8, 6).translate(-0.08, 0.42, 0),           // legs
        new THREE.CylinderGeometry(0.07, 0.05, 0.8, 6).translate(0.08, 0.42, 0),
        new THREE.CylinderGeometry(0.045, 0.035, 0.6, 6).rotateZ(0.12).translate(-0.24, 1.15, 0), // arms
        new THREE.CylinderGeometry(0.045, 0.035, 0.6, 6).rotateZ(-0.12).translate(0.24, 1.15, 0),
      ];
      g = mergeGeometries(parts.map(nonIndexed)); break;
    }
    case 'garment': g = mergeGeometries([boxG(0.42, 0.62, 0.05, 0, -0.31, 0), boxG(0.03, 0.12, 0.03, 0, 0.04, 0)].map(nonIndexed)); break; // hangs from y=0
    case 'plant': g = mergeGeometries([new THREE.IcosahedronGeometry(0.32, 0).translate(0, 0.35, 0), new THREE.IcosahedronGeometry(0.26, 0).translate(0.15, 0.6, 0.05), new THREE.IcosahedronGeometry(0.22, 0).translate(-0.12, 0.72, -0.06), new THREE.IcosahedronGeometry(0.18, 0).translate(0.02, 0.92, 0.04)].map(nonIndexed)); break;
    case 'tallplant': g = mergeGeometries([new THREE.CylinderGeometry(0.03, 0.04, 1.2, 5).translate(0, 0.6, 0), new THREE.IcosahedronGeometry(0.36, 0).scale(1, 0.8, 1).translate(0, 1.35, 0), new THREE.IcosahedronGeometry(0.3, 0).translate(0.22, 1.05, 0.1), new THREE.IcosahedronGeometry(0.28, 0).translate(-0.2, 1.6, -0.1)].map(nonIndexed)); break;
    case 'aframe': { // A-frame menu board, 0.6 wide, 1.0 tall, faces ±z
      const a = boxG(0.6, 1.0, 0.025, 0, 0.5, 0); a.rotateX(0.1); a.translate(0, 0, -0.1);
      const b = boxG(0.6, 1.0, 0.025, 0, 0.5, 0); b.rotateX(-0.1); b.translate(0, 0, 0.1);
      g = mergeGeometries([a, b].map(nonIndexed)); break;
    }
    case 'person': { // simple waiting-figure silhouette (unused if crowd present)
      g = mergeGeometries([new THREE.CapsuleGeometry(0.17, 0.9, 3, 8).translate(0, 0.95, 0), new THREE.SphereGeometry(0.11, 8, 6).translate(0, 1.6, 0)].map(nonIndexed)); break;
    }
    default: throw new Error('unknown proto ' + name);
  }
  g = nonIndexed(g);
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  PROTO.set(name, g);
  return g;
}

// remap a proto's uv (0..1) into an atlas region (for lanterns, food disks...)
const REMAP = new Map();
export function protoUV(name, r) {
  if (r.stub) return proto(name);
  const key = name + '|' + r.page + '|' + r.x + '|' + r.y + '|' + r.atlas.name;
  let g = REMAP.get(key);
  if (g) return g;
  g = proto(name).clone();
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, r.u0 + (r.u1 - r.u0) * uv.getX(i), r.v0 + (r.v1 - r.v0) * uv.getY(i));
  REMAP.set(key, g);
  return g;
}

// ---- painter: GeoBatch + frame helpers -------------------------------------------------
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();

export class Painter {
  constructor(gb, frame) { this.gb = gb || new GeoBatch(); this.f = frame; this.tris = 0; }
  with(frame) { const p = new Painter(this.gb, frame); return p; }
  // axis-aligned (in local frame) box given by ranges; col required for vertex-colour materials
  box(mat, a0, a1, y0, y1, d0, d1, col = WHITE, faces) {
    const f = this.f;
    const ca = (a0 + a1) / 2, cd = (d0 + d1) / 2;
    this.gb.box(mat, f.x(ca, cd), f.oy + (y0 + y1) / 2, f.z(ca, cd), Math.abs(a1 - a0), Math.abs(y1 - y0), Math.abs(d1 - d0), f.rot, faces ? { col, faces } : { col });
    this.tris += faces ? faces.length * 2 : 12;
  }
  // rotated box around its centre (local yaw rl)
  rbox(mat, ca, cy, cd, sa, sy, sd, rl, col = WHITE, faces) {
    const f = this.f;
    this.gb.box(mat, f.x(ca, cd), f.oy + cy, f.z(ca, cd), sa, sy, sd, f.rot + rl, faces ? { col, faces } : { col }); this.tris += faces ? faces.length * 2 : 12;
  }
  // vertical quad in the a-y plane at depth d. face: -1 faces outward (-d), +1 inward (+d)
  qd(mat, a0, a1, y0, y1, d, face = -1, col = WHITE, uv) {
    const P = (a, y) => this.f.p(a, y, d);
    const o = uv ? { col, uv } : { col };
    if (face < 0) this.gb.quad(mat, P(a1, y0), P(a0, y0), P(a0, y1), P(a1, y1), o);
    else this.gb.quad(mat, P(a0, y0), P(a1, y0), P(a1, y1), P(a0, y1), o);
    this.tris += 2;
  }
  // vertical quad in the d-y plane at lateral a. face: +1 faces +a, -1 faces -a
  qa(mat, d0, d1, y0, y1, a, face = 1, col = WHITE, uv) {
    const P = (d, y) => this.f.p(a, y, d);
    const o = uv ? { col, uv } : { col };
    if (face > 0) this.gb.quad(mat, P(d1, y0), P(d0, y0), P(d0, y1), P(d1, y1), o);
    else this.gb.quad(mat, P(d0, y0), P(d1, y0), P(d1, y1), P(d0, y1), o);
    this.tris += 2;
  }
  // horizontal quad
  qh(mat, a0, a1, d0, d1, y, up = true, col = WHITE, uv) {
    const P = (a, d) => this.f.p(a, y, d);
    const o = uv ? { col, uv } : { col };
    if (up) this.gb.quad(mat, P(a0, d1), P(a1, d1), P(a1, d0), P(a0, d0), o);
    else this.gb.quad(mat, P(a0, d0), P(a1, d0), P(a1, d1), P(a0, d1), o);
    this.tris += 2;
  }
  // textured atlas quad facing outward (-d) / inward / ±a
  tq(r, a0, a1, y0, y1, d, face = -1, col = WHITE, flip = false) { this.qd(r.atlas.mat(r), a0, a1, y0, y1, d, face, col, r.atlas.uv(r, flip)); }
  ta(r, d0, d1, y0, y1, a, face = 1, col = WHITE, flip = false) { this.qa(r.atlas.mat(r), d0, d1, y0, y1, a, face, col, r.atlas.uv(r, flip)); }
  th(r, a0, a1, d0, d1, y, col = WHITE) { this.qh(r.atlas.mat(r), a0, a1, d0, d1, y, true, col, r.atlas.uv(r)); }
  // box whose outward (-d) face carries an atlas region; other faces get `col` in `mat`
  tbox(mat, r, a0, a1, y0, y1, d0, d1, col = WHITE, faceCol = WHITE) {
    this.box(mat, a0, a1, y0, y1, d0, d1, col, 'ewtbs');
    this.tq(r, a0, a1, y0, y1, d0, -1, faceCol);
  }
  // merge a prototype geometry at local (a, y, d), local yaw rl, scale (number or [sx,sy,sz])
  geo(mat, g, a, y, d, rl = 0, sc = 1, col = WHITE) {
    const f = this.f;
    _p.set(f.x(a, d), f.oy + y, f.z(a, d));
    _e.set(0, f.rot + rl, 0); _q.setFromEuler(_e);
    if (Array.isArray(sc)) _s.set(sc[0], sc[1], sc[2]); else _s.set(sc, sc, sc);
    _m.compose(_p, _q, _s);
    this.gb.geometry(mat, typeof g === 'string' ? proto(g) : g, _m, col);
    this.tris += (typeof g === 'string' ? proto(g) : g).attributes.position.count / 3;
  }
  // geometry with an extra local tilt (rx around local a-axis)
  geoT(mat, g, a, y, d, rl, rx, sc, col = WHITE) {
    const f = this.f;
    _p.set(f.x(a, d), f.oy + y, f.z(a, d));
    _e.set(rx, f.rot + rl, 0, 'YXZ'); _q.setFromEuler(_e);
    if (Array.isArray(sc)) _s.set(sc[0], sc[1], sc[2]); else _s.set(sc, sc, sc);
    _m.compose(_p, _q, _s);
    this.gb.geometry(mat, typeof g === 'string' ? proto(g) : g, _m, col);
  }
  cyl(mat, a, y0, y1, d, r, col = WHITE, kind = 'cyl') { this.geo(mat, kind, a, y0, d, 0, [r, y1 - y0, r], col); }
}

// A painter that draws nothing: used for the logic-only pass (obstacles,
// spots) at load time. Geometry is produced later by a replay.
const NOGB = { quad() {}, box() {}, geometry() {}, rectH() {}, wall() {}, cylinder() {}, tri() {}, empty: true };
export class NullPainter extends Painter {
  constructor(frame) { super(NOGB, frame); }
  get isNull() { return true; }
  box() {} rbox() {} qd() {} qa() {} qh() {} tq() {} ta() {} th() {} tbox() {} geo() {} geoT() {} cyl() {}
}
// Stub atlas region returned during the logic pass (never drawn)
const STUB_ATLAS = { name: 'stub', mat: () => null, uv: () => null, sub: (r) => r, pages: [] };
export const STUB_REGION = { stub: true, atlas: STUB_ATLAS, page: 0, x: 0, y: 0, w: 400, h: 72, u0: 0, u1: 1, v0: 0, v1: 1 };

// Chunked batches: one GeoBatch per (level, chunk) so static dressing is
// culled with the rest of the level.
export class ChunkBatches {
  constructor(size = 32, prefix = 'env') { this.size = size; this.prefix = prefix; this.map = new Map(); }
  get(level, x, z) {
    const cx = Math.floor(x / this.size), cz = Math.floor(z / this.size);
    const k = `${level}|${cx}|${cz}`;
    let e = this.map.get(k);
    if (!e) this.map.set(k, e = { level, cx, cz, gb: new GeoBatch() });
    return e.gb;
  }
  build(ctx) {
    const groups = [];
    for (const [k, e] of this.map) {
      if (e.gb.empty) continue;
      const grp = new THREE.Group();
      grp.name = `${this.prefix}:${k}`;
      grp.userData.chunk = { level: e.level, x: (e.cx + 0.5) * this.size, z: (e.cz + 0.5) * this.size, r: this.size * 0.75 };
      for (const m of e.gb.build(ctx.materials, { name: this.prefix })) { m.receiveShadow = false; grp.add(m); }
      ctx.engine.levelRoot(e.level).add(grp);
      groups.push(grp);
    }
    this.map.clear();
    return groups;
  }
}

// font stack used for all canvas text
export const FONT_JA = '"Noto Sans JP", "Hiragino Kaku Gothic ProN", "Hiragino Sans", "Yu Gothic", Meiryo, "IPAGothic", "IPAPGothic", "WenQuanYi Zen Hei", sans-serif';
export const FONT_EN = '"Inter", "Helvetica Neue", Arial, ' + FONT_JA;
export const FONT_SERIF = '"Noto Serif JP", "Hiragino Mincho ProN", "Yu Mincho", "IPAMincho", serif, ' + FONT_JA;

// Load the font glyph subsets we actually draw (Google Fonts serves Noto Sans
// JP in unicode-range slices: load() must be given the text).
export async function loadFonts(texts, timeoutMs = 3500) {
  if (typeof document === 'undefined' || !document.fonts) return;
  const all = [...new Set(texts.join(''))].join('');
  const jobs = [];
  for (const w of [400, 700, 900]) jobs.push(document.fonts.load(`${w} 32px "Noto Sans JP"`, all).catch(() => null));
  jobs.push(document.fonts.load('700 32px "Inter"', 'ABCabc0123').catch(() => null));
  await Promise.race([Promise.all(jobs), new Promise(r => setTimeout(r, timeoutMs))]);
}
