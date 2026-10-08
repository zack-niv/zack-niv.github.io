// =============================================================================
// Train renderer: one InstancedMesh per car model (4 material groups each:
// body, glass, interior, emissive). Per-instance attribute iA =
//   (door open amount on local +z side, on local -z side, LED slot, lamp)
// lamp: 1 = headlights on the cab end, 0 = tail lights, -1 = both off.
// Draw calls are independent of the number of trains: ≤ 4 per model in view.
// =============================================================================
import * as THREE from 'three';
import { buildCar, SPECS, lampPoints } from './cars.js?v=6c67dba';
import { buildCarAtlas, buildInteriorAtlas, buildEmissiveAtlas, ROW_H } from './textures.js?v=6c67dba';

export function patchTrainMaterial(mat, uniforms) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev.call(mat, sh, r);
    sh.uniforms.uLang = uniforms.uLang; sh.uniforms.uRowH = uniforms.uRowH;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec2 aDoor;
attribute float aKind;
attribute vec4 iA;
uniform float uLang;
uniform float uRowH;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
{ float nbOpen = aDoor.y > 0.0 ? iA.x : iA.y; transformed.x += aDoor.x * nbOpen; }`)
      .replace('#include <uv_vertex>', `#include <uv_vertex>
#ifdef USE_MAP
if (aKind > 0.5 && aKind < 1.5) { vMapUv.x += uLang * 0.5; vMapUv.y -= iA.z * uRowH; }
#endif`)
      .replace('#include <color_vertex>', `#include <color_vertex>
#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
if (aKind > 1.5 && aKind < 2.5) vColor.rgb *= (iA.w > 0.5 ? 1.0 : 0.05);
if (aKind > 2.5 && aKind < 3.5) vColor.rgb *= ((iA.w > -0.5 && iA.w < 0.5) ? 1.0 : 0.05);
if (aKind > 3.5) vColor.rgb *= ((aDoor.y > 0.0 ? iA.x : iA.y) > 0.02 ? 1.0 : 0.06);
#endif`);
  };
  mat.customProgramCacheKey = () => 'nb-train-' + mat.type + (mat.transparent ? 't' : '');
  return mat;
}

const _v = new THREE.Vector3(), _m2 = new THREE.Matrix4(), _s2 = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _up = new THREE.Vector3(0, 1, 0);

export class TrainRenderer {
  constructor(ctx, slots) {
    this.ctx = ctx; this.slots = slots;
    this.models = {};
    this.uniforms = { uLang: { value: 0 }, uRowH: { value: ROW_H } };
  }
  build(modelLevels, caps = {}) {
    const car = buildCarAtlas();
    this.interiorTex = buildInteriorAtlas();
    this.emissiveTex = buildEmissiveAtlas(this.slots);
    const body = patchTrainMaterial(new THREE.MeshStandardMaterial({ map: car.color, roughnessMap: car.rough, metalnessMap: car.rough, roughness: 1, metalness: 1, envMapIntensity: 1.0 }), this.uniforms);
    body.name = 'transit_train_body';
    const glass = patchTrainMaterial(new THREE.MeshStandardMaterial({ color: 0x223038, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.6 }), this.uniforms);
    glass.name = 'transit_train_glass';
    const int = patchTrainMaterial(new THREE.MeshBasicMaterial({ map: this.interiorTex, vertexColors: true, side: THREE.DoubleSide }), this.uniforms);
    int.name = 'transit_train_interior';
    int.userData.nbUnlit = true;
    const emit = patchTrainMaterial(new THREE.MeshBasicMaterial({ map: this.emissiveTex, vertexColors: true, side: THREE.DoubleSide }), this.uniforms);
    emit.name = 'transit_train_emit';
    emit.userData.nbUnlit = true;
    this.mats = [body, glass, int, emit];
    for (const [key, level] of Object.entries(modelLevels)) {
      const geo = buildCar(key);
      const cap = caps[key] || 48;
      const iA = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
      iA.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('iA', iA);
      const im = new THREE.InstancedMesh(geo, this.mats, cap);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.count = 0;
      im.name = 'transit_cars:' + key;
      im.frustumCulled = true;
      im.castShadow = false; im.receiveShadow = false;
      this.ctx.engine.levelRoot(level).add(im);
      this.models[key] = { im, iA, cap, n: 0, level, spec: SPECS[key], tris: geo.attributes.position.count / 3 };
    }
    this._buildGlow([...new Set(Object.values(modelLevels))]);
  }
  _buildGlow(levels) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,255,255,0.55)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.12)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    mat.name = 'transit_glow'; mat.userData.nbUnlit = true;
    this.glow = {};
    for (const lv of levels) {
      const im = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, 64);
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(64 * 3), 3);
      im.count = 0; im.frustumCulled = false; im.renderOrder = 5; im.name = 'transit_glow:' + lv;
      this.ctx.engine.levelRoot(lv).add(im);
      this.glow[lv] = { im, n: 0 };
    }
    this.lampPts = {};
    for (const k in this.models) this.lampPts[k] = lampPoints(k);
  }
  begin() { for (const k in this.models) this.models[k].n = 0; if (this.glow) for (const lv in this.glow) this.glow[lv].n = 0; }
  // yaw: rotation about Y so that local +x points along (cos yaw, 0, -sin yaw)
  add(key, x, y, z, yaw, openP, openN, slot, lamp) {
    const m = this.models[key]; if (!m || m.n >= m.cap) return;
    const i = m.n++;
    _q.setFromAxisAngle(_up, yaw);
    _p.set(x, y, z);
    _m.compose(_p, _q, _s);
    m.im.setMatrixAt(i, _m);
    const lp = this.lampPts && this.lampPts[key];
    if (lp && lamp >= 0 && this.glow[m.level]) {
      const pts = lamp > 0.5 ? lp.head : lp.tail, col = lamp > 0.5 ? [1.0, 0.95, 0.85] : [0.9, 0.06, 0.03], sz = lamp > 0.5 ? 1.1 : 0.45;
      const G = this.glow[m.level], cq = this.ctx.camera.quaternion;
      for (const p of pts) {
        if (G.n >= 64) break;
        _v.set(p[0], p[1], p[2]).applyQuaternion(_q).add(_p);
        _m2.compose(_v, cq, _s2.set(sz, sz, sz));
        G.im.setMatrixAt(G.n, _m2); G.im.instanceColor.setXYZ(G.n, col[0], col[1], col[2]); G.n++;
      }
    }
    const a = m.iA.array; a[i * 4] = openP; a[i * 4 + 1] = openN; a[i * 4 + 2] = slot; a[i * 4 + 3] = lamp;
  }
  end() {
    if (this.glow) for (const lv in this.glow) { const G = this.glow[lv]; G.im.count = G.n; G.im.visible = G.n > 0; if (G.n) { G.im.instanceMatrix.needsUpdate = true; G.im.instanceColor.needsUpdate = true; } }
    for (const k in this.models) {
      const m = this.models[k];
      const changed = m.n !== m.im.count || m.n > 0;
      m.im.count = m.n;
      m.im.visible = m.n > 0;
      if (changed && m.n > 0) {
        m.im.instanceMatrix.needsUpdate = true;
        m.iA.needsUpdate = true;
        m.im.computeBoundingSphere();
      }
    }
  }
}
