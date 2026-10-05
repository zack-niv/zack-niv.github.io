// =============================================================================
// Train renderer: one InstancedMesh per car model (4 material groups each:
// body, glass, interior, emissive). Per-instance attribute iA =
//   (door open amount on local +z side, on local -z side, LED slot, lamp)
// lamp: 1 = headlights on the cab end, 0 = tail lights, -1 = both off.
// Draw calls are independent of the number of trains: ≤ 4 per model in view.
// =============================================================================
import * as THREE from 'three';
import { buildCar, SPECS } from './cars.js';
import { buildCarAtlas, buildInteriorAtlas, buildEmissiveAtlas, ROW_H } from './textures.js';

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
if (aKind > 2.5) vColor.rgb *= ((iA.w > -0.5 && iA.w < 0.5) ? 1.0 : 0.05);
#endif`);
  };
  mat.customProgramCacheKey = () => 'nb-train-' + mat.type + (mat.transparent ? 't' : '');
  return mat;
}

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
  }
  begin() { for (const k in this.models) this.models[k].n = 0; }
  // yaw: rotation about Y so that local +x points along (cos yaw, 0, -sin yaw)
  add(key, x, y, z, yaw, openP, openN, slot, lamp) {
    const m = this.models[key]; if (!m || m.n >= m.cap) return;
    const i = m.n++;
    _q.setFromAxisAngle(_up, yaw);
    _p.set(x, y, z);
    _m.compose(_p, _q, _s);
    m.im.setMatrixAt(i, _m);
    const a = m.iA.array; a[i * 4] = openP; a[i * 4 + 1] = openN; a[i * 4 + 2] = slot; a[i * 4 + 3] = lamp;
  }
  end() {
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
