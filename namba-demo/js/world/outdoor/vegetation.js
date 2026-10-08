// =============================================================================
// Vegetation: procedural species built from leaf cards (alpha-tested atlas)
// and tapered limbs, drawn with InstancedMesh. One shared wind uniform sways
// branches (vertex shader); foliage normals are "spherical" (crown centre) so
// canopies shade as volumes. Distance LOD: trees switch to a sparse-card far
// model, small plants are dropped beyond their range (instance compaction —
// one draw call per model either way).
//
//   const veg = new Vegetation(ctx, parentGroup)
//   veg.add(kind, x, y, z, scale, rotY, tint)   kind: see SPECIES / PLANTS
//   veg.build();  veg.update(dt, cameraPosition)
// =============================================================================
import * as THREE from 'three';
import { rng } from '../../core/rng.js?v=5f764cf';
import { foliage, bark, FOLIAGE_TILES, tileUV } from './textures.js?v=5f764cf';
import { MeshAcc } from './meshacc.js?v=5f764cf';

export const WIND = { uTime: { value: 0 }, uWind: { value: 1 } };

// ---------------------------------------------------------------------------
// shader patches
function windPatch(shader, foliageFix) {
  Object.assign(shader.uniforms, WIND);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;\nattribute float aWind;')
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        vec3 iw = vec3(0.0);
        #ifdef USE_INSTANCING
          iw = instanceMatrix[3].xyz;
        #endif
        float ph = dot(iw.xz, vec2(0.13, 0.171));
        float t = uTime;
        vec2 sway = vec2(sin(t * 0.8 + ph) + 0.35 * sin(t * 2.3 + ph * 1.7), 0.6 * cos(t * 0.63 + ph * 1.3));
        transformed.xz += sway * aWind * uWind;
        transformed += normal * sin(t * 6.5 + dot(position, vec3(3.1, 2.3, 4.7)) + ph) * aWind * uWind * 0.12;
      }`);
  if (foliageFix) {
    // two-sided cards keep their outward (crown) normal on the back face
    const nfb = THREE.ShaderChunk.normal_fragment_begin.replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', nfb)
      // mip-aware alpha so distant canopies don't thin out
      .replace('#include <alphatest_fragment>', `
        #ifdef USE_MAP
          { vec2 sz = vec2(textureSize(map, 0)); vec2 dx = dFdx(vMapUv * sz), dy = dFdy(vMapUv * sz);
            float lod = max(0.0, 0.5 * log2(max(dot(dx, dx), dot(dy, dy))));
            diffuseColor.a *= 1.0 + lod * 0.28; }
        #endif
        #include <alphatest_fragment>`);
  }
}

let mats = null;
export function vegMaterials(ctx) {
  if (mats) return mats;
  const leaf = new THREE.MeshStandardMaterial({ map: foliage(ctx), alphaTest: 0.42, side: THREE.DoubleSide, vertexColors: true, roughness: 0.78, metalness: 0 });
  leaf.name = 'veg_leaf';
  leaf.onBeforeCompile = (s) => windPatch(s, true);
  leaf.userData.nbReflect = 0;
  const trunk = new THREE.MeshStandardMaterial({ map: bark(ctx), vertexColors: true, roughness: 0.92 });
  trunk.name = 'veg_bark';
  trunk.onBeforeCompile = (s) => windPatch(s, false);
  trunk.userData.nbReflect = 0;
  mats = { leaf, trunk };
  return mats;
}

// ---------------------------------------------------------------------------
// geometry helpers
function limb(acc, wind, a, b, r0, r1, H, amp, col) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length(); dir.normalize();
  const up = Math.abs(dir.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(dir, up).normalize();
  const v = new THREE.Vector3().crossVectors(u, dir).normalize();
  const S = 6;
  for (let i = 0; i < S; i++) {
    const t0 = i / S * Math.PI * 2, t1 = (i + 1) / S * Math.PI * 2;
    const c0 = Math.cos(t0), s0 = Math.sin(t0), c1 = Math.cos(t1), s1 = Math.sin(t1);
    const p = (pt, r, c, s) => [pt.x + (u.x * c + v.x * s) * r, pt.y + (u.y * c + v.y * s) * r, pt.z + (u.z * c + v.z * s) * r];
    const n = (c, s) => [u.x * c + v.x * s, u.y * c + v.y * s, u.z * c + v.z * s];
    const A = p(a, r0, c0, s0), B = p(a, r0, c1, s1), C = p(b, r1, c1, s1), D = p(b, r1, c0, s0);
    acc.quad(A, B, C, D, [n(c0, s0), n(c1, s1), n(c1, s1), n(c0, s0)], [[i / S, 0], [(i + 1) / S, 0], [(i + 1) / S, len / 2], [i / S, len / 2]], col);
    for (const q of [A, B, C, D]) wind.push(Math.pow(Math.max(0, q[1]) / H, 2) * amp);
  }
}
function card(acc, wind, R, c, center, w, h, tile, H, amp, shade, orient) {
  // random orientation: normal mostly horizontal-ish, some tilted
  const yaw = orient != null ? orient : R.range(0, Math.PI * 2);
  const tilt = R.range(-0.7, 0.7);
  const ax = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw));
  const ay = new THREE.Vector3(-Math.sin(yaw) * Math.sin(tilt), Math.cos(tilt), Math.cos(yaw) * Math.sin(tilt));
  const [u0, v0, u1, v1] = tileUV(tile);
  const e = 0.004;
  const P = (sx, sy) => [c.x + ax.x * sx * w / 2 + ay.x * sy * h / 2, c.y + ax.y * sx * w / 2 + ay.y * sy * h / 2, c.z + ax.z * sx * w / 2 + ay.z * sy * h / 2];
  const pts = [P(-1, -1), P(1, -1), P(1, 1), P(-1, 1)];
  const ns = pts.map(p => { const d = new THREE.Vector3(p[0] - center.x, (p[1] - center.y) * 1.3 + 0.35, p[2] - center.z).normalize(); return [d.x, d.y, d.z]; });
  acc.quad(pts[0], pts[1], pts[2], pts[3], ns, [[u0 + e, v0 + e], [u1 - e, v0 + e], [u1 - e, v1 - e], [u0 + e, v1 - e]], [shade, shade, shade, shade]);
  for (const q of pts) wind.push(Math.pow(Math.max(0, q[1]) / H, 2) * amp);
}

// Species definitions: dims in metres (before per-instance scale)
export const SPECIES = {
  keyaki:  { H: 11, trunkH: 2.6, trunkR: 0.26, crownR: 4.6, crownH: 6.5, crownY: 7.4, cards: 120, far: 18, tile: 'broad', alt: 'autumn', altP: 0.12, cardS: 2.0, branches: 7, shape: 'vase', amp: 0.35 },
  kusu:    { H: 9, trunkH: 2.0, trunkR: 0.3, crownR: 4.0, crownH: 5.0, crownY: 6.0, cards: 110, far: 16, tile: 'broad', alt: 'shrub', altP: 0.3, cardS: 1.9, branches: 5, shape: 'round', amp: 0.25 },
  momiji:  { H: 5.2, trunkH: 1.2, trunkR: 0.13, crownR: 2.8, crownH: 2.6, crownY: 3.6, cards: 70, far: 12, tile: 'autumn', alt: 'broad', altP: 0.45, cardS: 1.5, branches: 6, shape: 'layer', amp: 0.3 },
  sakura:  { H: 6.5, trunkH: 1.6, trunkR: 0.2, crownR: 3.8, crownH: 3.2, crownY: 4.6, cards: 85, far: 14, tile: 'autumn', alt: 'broad', altP: 0.55, cardS: 1.8, branches: 6, shape: 'umbrella', amp: 0.3 },
  ginkgo:  { H: 13, trunkH: 2.4, trunkR: 0.28, crownR: 2.9, crownH: 9, crownY: 7.6, cards: 110, far: 16, tile: 'ginkgo', alt: 'ginkgo', altP: 0, cardS: 1.8, branches: 9, shape: 'column', amp: 0.22 },
  pine:    { H: 6, trunkH: 1.0, trunkR: 0.2, crownR: 3.0, crownH: 2.2, crownY: 4.2, cards: 50, far: 10, tile: 'pine', alt: 'pine', altP: 0, cardS: 1.7, branches: 5, shape: 'pine', amp: 0.18 },
  olive:   { H: 3.6, trunkH: 0.9, trunkR: 0.1, crownR: 1.6, crownH: 2.2, crownY: 2.5, cards: 40, far: 8, tile: 'shrub', alt: 'narrow', altP: 0.4, cardS: 1.1, branches: 4, shape: 'round', amp: 0.25 },
};
export const PLANTS = {
  shrub:   { tile: 'shrub', alt: 'broad', altP: 0.2, cards: 12, r: 0.75, h: 0.9, cardS: 0.9, range: 75, amp: 0.05 },
  azalea:  { tile: 'shrub', alt: 'flower', altP: 0.15, cards: 10, r: 0.6, h: 0.65, cardS: 0.75, range: 65, amp: 0.04 },
  grass:   { tile: 'grass', cards: 4, r: 0.35, h: 0.9, cardS: 0.95, upright: true, range: 55, amp: 0.25 },
  flower:  { tile: 'flower', cards: 4, r: 0.35, h: 0.7, cardS: 0.75, upright: true, range: 45, amp: 0.2 },
  fern:    { tile: 'narrow', cards: 6, r: 0.45, h: 0.5, cardS: 0.8, range: 50, amp: 0.1 },
  hang:    { tile: 'shrub', alt: 'narrow', altP: 0.4, cards: 7, r: 0.5, h: -1.6, cardS: 1.1, hanging: true, range: 120, amp: 0.15 },
};

function buildTree(sp, seed, far) {
  const R = rng(seed);
  const trunk = new MeshAcc(), leaves = new MeshAcc();
  const tw = [], lw = [];
  const H = sp.H, amp = sp.amp;
  const base = new THREE.Vector3(0, 0, 0);
  const top = new THREE.Vector3(R.range(-0.2, 0.2), sp.trunkH, R.range(-0.2, 0.2));
  const bc = [0.95, 0.9, 0.85];
  if (!far) limb(trunk, tw, base, top, sp.trunkR * 1.25, sp.trunkR, H, amp, bc);
  const center = new THREE.Vector3(0, sp.crownY, 0);
  // branches
  const tips = [];
  for (let i = 0; i < sp.branches; i++) {
    const a = i / sp.branches * Math.PI * 2 + R.range(-0.3, 0.3);
    let rr = sp.crownR * R.range(0.45, 0.8), yy = sp.crownY + R.range(-0.2, 0.5) * sp.crownH * 0.5;
    if (sp.shape === 'column') { rr *= 0.6; yy = sp.trunkH + (i / sp.branches) * sp.crownH * 0.9; }
    if (sp.shape === 'umbrella' || sp.shape === 'layer' || sp.shape === 'pine') yy = sp.crownY - sp.crownH * 0.15 + R.range(-0.4, 0.6);
    const tip = new THREE.Vector3(top.x + Math.cos(a) * rr, yy, top.z + Math.sin(a) * rr);
    tips.push(tip);
    if (!far) {
      const mid = new THREE.Vector3().lerpVectors(top, tip, 0.5).add(new THREE.Vector3(0, R.range(0, 0.6), 0));
      limb(trunk, tw, top, mid, sp.trunkR * 0.6, sp.trunkR * 0.38, H, amp, bc);
      limb(trunk, tw, mid, tip, sp.trunkR * 0.38, sp.trunkR * 0.12, H, amp, bc);
    }
  }
  if (!far && sp.shape === 'column') limb(trunk, tw, top, new THREE.Vector3(0, H * 0.92, 0), sp.trunkR * 0.7, sp.trunkR * 0.15, H, amp, bc);
  // leaf cards
  const n = far ? sp.far : sp.cards;
  const sc = far ? sp.cardS * 2.1 : sp.cardS;
  for (let i = 0; i < n; i++) {
    let p;
    const t = R();
    if (sp.shape === 'pine' || sp.shape === 'layer') {
      // flat pads around branch tips
      const tip = tips[i % tips.length];
      p = new THREE.Vector3(tip.x + R.range(-1, 1) * sp.crownR * 0.35, tip.y + R.range(-0.25, 0.35) * (sp.shape === 'pine' ? 0.8 : 1.4) + (i % 3) * 0.25, tip.z + R.range(-1, 1) * sp.crownR * 0.35);
    } else {
      // ellipsoid shell, biased to the surface
      const u = R.range(-1, 1), th = R.range(0, Math.PI * 2);
      const r = Math.pow(R(), 0.35);
      let cy = sp.crownY, rh = sp.crownH / 2, rx = sp.crownR;
      if (sp.shape === 'umbrella') { rh *= 0.75; if (u < 0) { r * 0.6; } }
      const sxz = Math.sqrt(1 - u * u);
      p = new THREE.Vector3(Math.cos(th) * sxz * rx * r, cy + u * rh * r, Math.sin(th) * sxz * rx * r);
      if (sp.shape === 'column') { const k = 1 - (p.y - (cy - rh)) / (2 * rh); p.x *= 0.45 + 0.75 * k; p.z *= 0.45 + 0.75 * k; }
      if (sp.shape === 'vase') { const k = (p.y - (cy - rh)) / (2 * rh); p.x *= 0.55 + 0.6 * k; p.z *= 0.55 + 0.6 * k; }
    }
    const dist = Math.hypot(p.x, (p.y - sp.crownY) * 1.2, p.z) / Math.max(sp.crownR, sp.crownH / 2);
    const shade = Math.min(1.05, 0.45 + 0.6 * dist) * R.range(0.85, 1.1);
    const tile = R.chance(sp.altP) ? FOLIAGE_TILES[sp.alt] : FOLIAGE_TILES[sp.tile];
    const s = sc * R.range(0.8, 1.2);
    card(leaves, lw, R, p, center, s, s, tile, H, amp, shade);
  }
  return { trunk: far ? null : finish(trunk, tw), leaves: finish(leaves, lw) };
}

function buildPlant(pl, seed) {
  const R = rng(seed);
  const acc = new MeshAcc(), w = [];
  const H = Math.max(0.5, Math.abs(pl.h));
  const center = new THREE.Vector3(0, pl.hanging ? 0 : pl.h * 0.45, 0);
  for (let i = 0; i < pl.cards; i++) {
    const tile = pl.alt && R.chance(pl.altP) ? FOLIAGE_TILES[pl.alt] : FOLIAGE_TILES[pl.tile];
    if (pl.upright) {
      const yaw = i / pl.cards * Math.PI + R.range(-0.2, 0.2);
      const c = new THREE.Vector3(R.range(-0.08, 0.08), pl.h * 0.5, R.range(-0.08, 0.08));
      const ax = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw));
      const [u0, v0, u1, v1] = tileUV(tile);
      const hw = pl.cardS / 2;
      const pts = [[c.x - ax.x * hw, 0, c.z - ax.z * hw], [c.x + ax.x * hw, 0, c.z + ax.z * hw], [c.x + ax.x * hw, pl.h, c.z + ax.z * hw], [c.x - ax.x * hw, pl.h, c.z - ax.z * hw]];
      const nrm = [0, 1, 0];
      const sh = R.range(0.85, 1.05);
      acc.quad(pts[0], pts[1], pts[2], pts[3], [[-ax.z * 0.4, 0.6, ax.x * 0.4], [ax.z * 0.4, 0.6, -ax.x * 0.4], nrm, nrm], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], [[0.6 * sh, 0.6 * sh, 0.6 * sh], [0.6 * sh, 0.6 * sh, 0.6 * sh], [sh, sh, sh], [sh, sh, sh]]);
      for (const q of pts) w.push(Math.pow(q[1] / H, 2) * pl.amp);
    } else if (pl.hanging) {
      // curtain of cards hanging down from y=0 (mounted at a rim)
      const c = new THREE.Vector3(R.range(-0.6, 0.6), -R.range(0.3, 1.4), R.range(0, 0.25));
      card(acc, w, R, c, new THREE.Vector3(c.x, c.y, -1), pl.cardS, pl.cardS * 1.4, tile, 2, pl.amp, R.range(0.6, 1.0), R.range(-0.5, 0.5));
    } else {
      const u = R.range(0, 1), th = R.range(0, Math.PI * 2);
      const r = Math.pow(R(), 0.4) * pl.r;
      const c = new THREE.Vector3(Math.cos(th) * r, pl.h * (0.25 + 0.6 * u), Math.sin(th) * r);
      card(acc, w, R, c, new THREE.Vector3(0, 0, 0), pl.cardS * R.range(0.8, 1.2), pl.cardS * R.range(0.8, 1.2), tile, H, pl.amp, R.range(0.55, 1.0));
    }
  }
  // wind for hanging: grows downward
  if (pl.hanging) for (let i = 0; i < w.length; i++) w[i] = pl.amp * 0.5;
  return finish(acc, w);
}
function finish(acc, w) {
  const g = acc.build(true);
  g.setAttribute('aWind', new THREE.Float32BufferAttribute(w, 1));
  return g;
}

// ---------------------------------------------------------------------------
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

class Bucket {
  constructor(geo, mat, cap, name, cast) {
    this.mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, cap));
    this.mesh.name = name;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, cap) * 3), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = cast; this.mesh.receiveShadow = true;
    this.mesh.count = 0;
  }
}

export class Vegetation {
  constructor(ctx, parent) {
    this.ctx = ctx; this.parent = parent;
    this.items = new Map(); // kind -> [{m: Float32Array(16), c:[r,g,b], x,y,z}]
    this.models = new Map();
    this.time = 0; this._t = 1e9;
    this.q = ctx.engine.qualityName || 'high';
    this.rangeMul = this.q === 'low' ? 0.55 : this.q === 'medium' ? 0.8 : this.q === 'ultra' ? 1.3 : 1;
  }
  add(kind, x, y, z, scale = 1, rotY = 0, tint = null) {
    let l = this.items.get(kind); if (!l) this.items.set(kind, l = []);
    _p.set(x, y, z); _q.setFromAxisAngle(UP, rotY); _s.set(scale, scale, scale);
    _m.compose(_p, _q, _s);
    l.push({ m: Float32Array.from(_m.elements), c: tint || [1, 1, 1], x, y, z, s: scale });
  }
  count() { let n = 0; for (const l of this.items.values()) n += l.length; return n; }
  build() {
    const { leaf, trunk } = vegMaterials(this.ctx);
    for (const [kind, list] of this.items) {
      const sp = SPECIES[kind], pl = PLANTS[kind];
      const variants = [];
      if (sp) {
        const near = buildTree(sp, 100 + kind.length * 7, false), far = buildTree(sp, 100 + kind.length * 7, true);
        variants.push({ lod: 'near', b: new Bucket(near.leaves, leaf, list.length, `veg:${kind}:leaf`, true), t: new Bucket(near.trunk, trunk, list.length, `veg:${kind}:trunk`, true) });
        variants.push({ lod: 'far', b: new Bucket(far.leaves, leaf, list.length, `veg:${kind}:far`, false) });
      } else if (pl) {
        variants.push({ lod: 'near', b: new Bucket(buildPlant(pl, 900 + kind.length * 13), leaf, list.length, `veg:${kind}`, false) });
      }
      for (const v of variants) { this.parent.add(v.b.mesh); if (v.t) this.parent.add(v.t.mesh); }
      this.models.set(kind, { sp, pl, list, variants });
    }
  }
  // repartition instances by distance (cheap; every ~0.25 s or after a jump)
  _refresh(cam) {
    for (const [kind, M] of this.models) {
      const nearR = M.sp ? 70 * this.rangeMul : M.pl.range * 0.7 * this.rangeMul;
      const farR = M.sp ? 700 : nearR;
      const near = M.variants[0], far = M.variants[1];
      let nn = 0, nf = 0;
      const nm = near.b.mesh, tm = near.t ? near.t.mesh : null, fm = far ? far.b.mesh : null;
      for (const it of M.list) {
        const dx = it.x - cam.x, dy = (it.y - cam.y) * 0.5, dz = it.z - cam.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        const r = nearR * Math.min(1.6, Math.max(0.7, it.s));
        if (d2 < r * r) {
          nm.instanceMatrix.array.set(it.m, nn * 16); nm.instanceColor.array.set(it.c, nn * 3);
          if (tm) { tm.instanceMatrix.array.set(it.m, nn * 16); tm.instanceColor.array.set(it.c, nn * 3); }
          nn++;
        } else if (fm && d2 < farR * farR) {
          fm.instanceMatrix.array.set(it.m, nf * 16); fm.instanceColor.array.set(it.c, nf * 3);
          nf++;
        }
      }
      const up = (mesh, n) => { mesh.count = n; for (const a of [mesh.instanceMatrix, mesh.instanceColor]) { a.clearUpdateRanges(); if (n) a.addUpdateRange(0, n * a.itemSize); a.needsUpdate = n > 0; } };
      up(nm, nn); if (tm) up(tm, nn); if (fm) up(fm, nf);
    }
  }
  update(dt, cam, advanceWind = true) {
    if (advanceWind) WIND.uTime.value += dt;
    this._t += dt;
    const moved = !this._last || Math.abs(cam.x - this._last.x) + Math.abs(cam.z - this._last.z) + Math.abs(cam.y - this._last.y) > 6;
    if (this._t > 0.5 || moved) { this._t = 0; this._refresh(cam); this._last = cam.clone(); }
  }
}
