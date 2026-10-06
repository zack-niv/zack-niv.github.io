// =============================================================================
// Human model library for the crowd (v2): rigged CC0 glTF people (Quaternius
// "Ultimate Modular Men / Women", packed by assets/humans/tools/pack.mjs).
//
//   assets/humans/humans_m.glb / humans_f.glb: one rig per gender, 4 outfits
//   each (full mesh + two simplified LODs, one skinned primitive per mesh with
//   a per-vertex material index `_mat`), and the clips Walk / Idle /
//   Idle_Neutral / Wave / Interact / Run.
//
// At load we add, per rig:
//   * procedural clips made from the real ones (sit, eat, phone, photo, bow,
//     nod, browse, look-up, cart push, suitcase pull, escalator stand),
//   * accessory parts (briefcase, bags, backpack, suitcase, phone, cup, cap,
//     apron, face mask, cleaning cart) merged into every outfit geometry and
//     switched per person by the look's bit flags (looks.js BIT),
//   * a bone texture: every clip sampled at 30 fps into skinning matrices, so
//     the far crowd is GPU-skinned instanced geometry (one draw per outfit/LOD),
//   * materials: colours come from a per-outfit table; "tint" entries take the
//     person's look colours (skin, hair, top, bottom, shoes, inner, bags).
//
// The near crowd uses real SkinnedMesh clones (SkeletonUtils.clone) driven by
// AnimationMixer actions with the SAME clips and the same clip time as the
// baked far version, so the LOD hand-over is seamless.
// =============================================================================
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skClone } from 'three/addons/utils/SkeletonUtils.js';
import { BIT } from './looks.js';

export const TINT = { KEEP: 0, SKIN: 1, HAIR: 2, TOP: 3, BOTTOM: 4, SHOES: 5, INNER: 6, ACC: 7, ACC2: 8 };
const MAX_MATS = 24;
const FPS = 30;
const BASE = new URL('../../assets/humans/', import.meta.url).href;

// clip ids (shared by both rigs, same order => same bone-texture layout logic)
export const CLIP = {
  walk: 'Walk', run: 'Run', idle: 'Idle_Neutral', idle2: 'Idle', wave: 'Wave', interact: 'Interact',
  sit: null, eat: null, phone: null, phonewalk: null, photo: null, bow: null, nod: null, browse: null,
  lookup: null, cart: null, walkcase: null, idlecase: null, ride: null,
};
export const CLIP_IDS = Object.keys(CLIP);
// clips whose playback rate follows the walking speed (value = which base it was made from)
export const LOCO = { walk: 1, run: 1, phonewalk: 1, cart: 1, walkcase: 1 };

// ---------------------------------------------------------------------------
// variant choice from a crowd look (deterministic)
const VARIANTS = { m: ['M_Suit', 'M_Casual', 'M_Hoodie', 'M_Backpacker'], f: ['F_Suit', 'F_Casual', 'F_Dress', 'F_Backpacker'] };
export function variantFor(look, kind) {
  const f = look.flags, has = (b) => (f >> b) & 1;
  const g = look.female ? 'f' : 'm';
  const hsh = ((look.colA[0] * 7 + look.colB[0] * 13 + (look.h * 1000 | 0)) >>> 0) % 100;
  let v;
  if (g === 'm') {
    if (kind === 'commuter' || kind === 'staff_station' || kind === 'security' || has(BIT.JACKET) || has(BIT.TIE) || has(BIT.COAT)) v = 'M_Suit';
    else if (kind === 'tourist' && has(BIT.BACKPACK) && hsh < 70) v = 'M_Backpacker';
    else if ((kind === 'student' || kind === 'child' || kind === 'tourist') && hsh < 35) v = 'M_Hoodie';
    else v = 'M_Casual';
  } else {
    if (has(BIT.SKIRT)) v = 'F_Dress';
    else if (kind === 'commuter' || kind === 'staff_station' || kind === 'security' || has(BIT.JACKET) || has(BIT.COAT)) v = 'F_Suit';
    else if (kind === 'tourist' && has(BIT.BACKPACK) && hsh < 60) v = 'F_Backpacker';
    else v = 'F_Casual';
  }
  return { g, v };
}

// ---------------------------------------------------------------------------
export async function loadHumanLibrary(ctx, opts = {}) {
  const loader = new GLTFLoader();
  const lib = new HumanLibrary(ctx);
  const res = await Promise.allSettled(['m', 'f'].map(g => loader.loadAsync(BASE + `humans_${g}.glb`).then(gl => lib.addRig(g, gl))));
  for (const r of res) if (r.status === 'rejected') console.warn('[crowd] human model failed to load:', r.reason && r.reason.message || r.reason);
  if (!lib.rigs.m && !lib.rigs.f) return null;
  // one gender missing: the other one stands in (never leave the game without people)
  if (!lib.rigs.m) lib.rigs.m = lib.rigs.f;
  if (!lib.rigs.f) lib.rigs.f = lib.rigs.m;
  return lib;
}

export class HumanLibrary {
  constructor(ctx) { this.ctx = ctx; this.rigs = {}; }

  addRig(g, gltf) {
    const t0 = performance.now();
    const scene = gltf.scene;
    scene.updateMatrixWorld(true);
    const meshes = {}; let skel = null;
    scene.traverse(o => { if (o.isSkinnedMesh) { meshes[o.name] = o; skel = skel || o.skeleton; } });
    if (!skel) throw new Error('no skin in humans_' + g);
    const rig = {
      g, bones: skel.bones, boneInverses: skel.boneInverses, nb: skel.bones.length,
      boneIdx: Object.fromEntries(skel.bones.map((b, i) => [b.name, i])),
      rootBone: skel.bones[0], clips: {}, info: {}, variants: {}, height: 1.8,
    };
    // the armature node (the root bone's non-bone parent, e.g. 'CharacterArmature')
    rig.armature = rig.rootBone.parent && !rig.rootBone.parent.isBone ? rig.rootBone.parent : rig.rootBone;
    // a private sampling copy of the skeleton
    rig.sampler = this._skeletonCopy(rig);
    for (const c of gltf.animations) rig.clips[c.name] = c;
    // procedural clips
    this._procClips(rig);
    // accessory parts (need the idle pose)
    const acc = this._accessories(rig);
    // outfits
    for (const name of VARIANTS[g]) {
      const m0 = meshes[name]; if (!m0) continue;
      const mats = (m0.userData && m0.userData.mats) || [];
      const table = mats.map(m => ({ color: new THREE.Color(m.color), tint: m.tint | 0, name: m.name }));
      const accBase = table.length;
      for (const e of ACC_MATS) table.push({ color: new THREE.Color(e.color), tint: e.tint, name: 'acc:' + e.name });
      const hasPack = name.endsWith('Backpacker');
      const geos = [];
      for (const suf of ['', '_lod', '_lod2']) {
        const m = meshes[name + suf] || m0;
        geos.push(this._withAccessories(m.geometry, acc, accBase, suf === '_lod2'));
      }
      const mat = new Float32Array(MAX_MATS * 4);
      table.slice(0, MAX_MATS).forEach((e, i) => { mat[i * 4] = e.color.r; mat[i * 4 + 1] = e.color.g; mat[i * 4 + 2] = e.color.b; mat[i * 4 + 3] = e.tint; });
      const matU = Array.from({ length: MAX_MATS }, (_, i) => new THREE.Vector4(mat[i * 4], mat[i * 4 + 1], mat[i * 4 + 2], mat[i * 4 + 3]));
      // parts this outfit never shows (the backpacker already wears a pack)
      let mask = 0xffffff; if (hasPack) mask &= ~(1 << BIT.BACKPACK);
      rig.variants[name] = { name, rig, geos, matU, mask, tris: geos.map(q => q.index.count / 3) };
    }
    // standing height (top of the head in the idle pose)
    rig.height = this._height(rig);
    // natural speeds of the locomotion clips (feet planted => no sliding)
    for (const id of CLIP_IDS) { const c = rig.clips[id]; if (c) rig.info[id] = { dur: c.duration, speed: LOCO[id] ? this._clipSpeed(rig, c) : 0 }; }
    this._bakeBones(rig);
    this.rigs[g] = rig;
    rig.loadMs = performance.now() - t0;
    return rig;
  }

  // bones only, same names / order (for sampling poses)
  _skeletonCopy(rig) {
    const root = new THREE.Group();
    const top = rig.armature.clone(false); root.add(top);
    const copyKids = (src, dst) => { for (const c of src.children) if (c.isBone) { const n = c.clone(false); dst.add(n); copyKids(c, n); } };
    copyKids(rig.armature, top);
    const by = {}; root.traverse(o => { by[o.name] = o; });
    const bones = rig.bones.map(b => by[b.name]);
    root.updateMatrixWorld(true);
    const mixer = new THREE.AnimationMixer(root);
    const rest = bones.map(b => [b.position.clone(), b.quaternion.clone(), b.scale.clone()]);
    return { root, bones, by, mixer, rest };
  }

  // pose the sampler at clip time t (clips: name or AnimationClip)
  _pose(rig, clip, t) {
    const S = rig.sampler, mx = S.mixer;
    let a = S.cur && S.curClip === clip ? S.cur : null;
    if (!a) { mx.stopAllAction(); this._restore(rig); a = mx.clipAction(clip); a.reset(); a.play(); a.weight = 1; S.cur = a; S.curClip = clip; }
    a.time = t;
    mx.update(0);
    S.root.updateMatrixWorld(true);
  }

  _restore(rig) {
    const S = rig.sampler;
    for (let i = 0; i < S.bones.length; i++) { const r = S.rest[i], b = S.bones[i]; b.position.copy(r[0]); b.quaternion.copy(r[1]); b.scale.copy(r[2]); }
  }

  _height(rig) {
    const c = rig.clips.idle; if (!c) return 1.8;
    this._pose(rig, c, 0);
    const h = rig.sampler.by.Head; if (!h) return 1.8;
    const p = new THREE.Vector3().setFromMatrixPosition(h.matrixWorld);
    return p.y + 0.24;
  }

  // ground-contact speed of a looping in-place locomotion clip (m/s)
  _clipSpeed(rig, clip) {
    const S = rig.sampler, fl = S.by.FootL, fr = S.by.FootR; if (!fl || !fr) return 1.3;
    const N = 48, ys = [], zs = [];
    const p = new THREE.Vector3();
    for (let i = 0; i <= N; i++) {
      this._pose(rig, clip, clip.duration * i / N);
      p.setFromMatrixPosition(fl.matrixWorld); ys.push(p.y); zs.push(p.z);
    }
    const ymin = Math.min(...ys);
    let v = 0, n = 0;
    for (let i = 0; i < N; i++) if (ys[i] < ymin + 0.025 && ys[i + 1] < ymin + 0.025) { v += -(zs[i + 1] - zs[i]) / (clip.duration / N); n++; }
    const sp = n ? v / n : 0;
    return sp > 0.3 && sp < 6 ? sp : (clip.name === 'Run' ? 3.2 : 1.3);
  }

  // ---------------------------------------------------------------------------
  // procedural clips: real clip + model-space bone aims / bends, resampled
  _procClips(rig) {
    const C = rig.clips;
    C.walk = C.Walk; C.run = C.Run; C.idle = C.Idle_Neutral || C.Idle; C.idle2 = C.Idle || C.idle; C.wave = C.Wave || C.idle; C.interact = C.Interact || C.idle;
    if (!C.walk || !C.idle) throw new Error('rig without Walk / Idle');
    if (!C.run) C.run = C.walk;
    const S = rig.sampler, B = S.by;
    const V = (x, y, z) => new THREE.Vector3(x, y, z).normalize();
    const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), qp = new THREE.Quaternion(), va = new THREE.Vector3(), vb = new THREE.Vector3();
    // rotate bone so that (child - bone) points along dir (model space), blend k
    const aim = (bn, cn, dir, k = 1) => {
      const b = B[bn], c = B[cn]; if (!b || !c || k <= 0) return;
      va.setFromMatrixPosition(b.matrixWorld); vb.setFromMatrixPosition(c.matrixWorld).sub(va).normalize();
      qa.setFromUnitVectors(vb, dir);
      if (k < 1) qa.slerp(qb.identity(), 1 - k);
      b.getWorldQuaternion(qb); qa.multiply(qb);
      b.parent.getWorldQuaternion(qp); b.quaternion.copy(qp.invert().multiply(qa));
      b.updateMatrixWorld(true);
    };
    // rotate bone about a model-space axis
    const bend = (bn, axis, ang) => {
      const b = B[bn]; if (!b || !ang) return;
      qa.setFromAxisAngle(axis, ang);
      b.getWorldQuaternion(qb); qa.multiply(qb);
      b.parent.getWorldQuaternion(qp); b.quaternion.copy(qp.invert().multiply(qa));
      b.updateMatrixWorld(true);
    };
    const X = new THREE.Vector3(1, 0, 0);
    const moveBody = (dy, dz) => {
      const b = B.Body || B.Hips; if (!b) return;
      va.setFromMatrixPosition(b.matrixWorld); va.y += dy; va.z += dz;
      b.parent.worldToLocal(va); b.position.copy(va); b.updateMatrixWorld(true);
    };
    const footY = () => { va.setFromMatrixPosition(B.Body.matrixWorld); return va.y; };
    const make = (id, base, dur, keys, fn) => { C[id] = this._resample(rig, id, base, dur, keys, fn); };
    const head = (a) => { bend('Neck', X, a * 0.45); bend('Head', X, a * 0.55); };
    const sitPose = (u) => {
      const by = footY();
      moveBody(0.47 - by, -0.04);
      for (const s of ['L', 'R']) {
        const sx = s === 'L' ? 1 : -1;
        aim('UpperLeg' + s, 'LowerLeg' + s, V(0.09 * sx, -0.06, 1));
        aim('LowerLeg' + s, 'Foot' + s, V(0.02 * sx, -1, 0.12));
        aim('UpperArm' + s, 'LowerArm' + s, V(0.18 * sx, -0.9, 0.45));
        aim('LowerArm' + s, 'Wrist' + s, V(-0.25 * sx, -0.38, 1));
      }
      bend('Abdomen', X, 0.05);
    };
    const phoneArm = (k = 1) => {
      aim('UpperArmR', 'LowerArmR', V(-0.12, -1, 0.32), k);
      aim('LowerArmR', 'WristR', V(0.42, 0.62, 0.66), k);
    };
    const caseArm = () => { aim('UpperArmL', 'LowerArmL', V(0.32, -1, -0.28)); aim('LowerArmL', 'WristL', V(0.3, -1, -0.38)); };
    make('sit', C.idle, C.idle.duration, 8, () => sitPose());
    make('eat', C.idle, 2.4, 16, (u) => {
      sitPose();
      const k = smooth(clamp01((u - 0.2) / 0.15)) * (1 - smooth(clamp01((u - 0.55) / 0.15)));
      aim('LowerArmR', 'WristR', V(0.15 + 0.2 * k, -0.38 + 1.1 * k, 1 - 0.4 * k));
      aim('LowerArmL', 'WristL', V(-0.35, -0.2, 1));
      head(0.18 - 0.1 * k);
    });
    make('phone', C.idle, C.idle.duration, 8, () => { phoneArm(); aim('UpperArmL', 'LowerArmL', V(0.1, -1, 0.15)); head(0.32); });
    make('phonewalk', C.walk, C.walk.duration, 16, () => { phoneArm(); head(0.28); });
    make('photo', C.idle, C.idle.duration, 8, () => {
      for (const s of ['L', 'R']) { const sx = s === 'L' ? 1 : -1; aim('UpperArm' + s, 'LowerArm' + s, V(0.12 * sx, -0.35, 1)); aim('LowerArm' + s, 'Wrist' + s, V(-0.42 * sx, 0.45, 0.8)); }
      head(0.05);
    });
    make('bow', C.idle, 1.3, 14, (u) => {
      const k = Math.sin(Math.min(1, u / 0.85) * Math.PI);
      bend('Abdomen', X, 0.16 * k); bend('Torso', X, 0.16 * k); bend('Chest', X, 0.1 * k); head(0.2 * k);
    });
    make('nod', C.idle, 1.6, 12, (u) => { const k = Math.sin(clamp01(u / 0.45) * Math.PI); head(0.32 * k); bend('Chest', X, 0.05 * k); });
    make('browse', C.idle, C.idle.duration, 8, () => { head(0.38); aim('UpperArmR', 'LowerArmR', V(-0.12, -0.75, 0.62)); aim('LowerArmR', 'WristR', V(0.12, -0.15, 1)); });
    make('lookup', C.idle, C.idle.duration, 8, () => head(-0.42));
    make('cart', C.walk, C.walk.duration, 16, () => {
      for (const s of ['L', 'R']) { const sx = s === 'L' ? 1 : -1; aim('UpperArm' + s, 'LowerArm' + s, V(0.16 * sx, -0.7, 0.72)); aim('LowerArm' + s, 'Wrist' + s, V(-0.05 * sx, -0.25, 1)); }
      bend('Abdomen', X, 0.08);
    });
    make('walkcase', C.walk, C.walk.duration, 16, () => caseArm());
    make('idlecase', C.idle, C.idle.duration, 8, () => caseArm());
    make('ride', C.idle, C.idle.duration, 8, () => { aim('UpperArmR', 'LowerArmR', V(-0.4, -0.9, 0.12)); aim('LowerArmR', 'WristR', V(-0.25, -0.35, 1)); });
  }

  // sample `base` over `dur` (looping) at `keys` keys, run fn(u) to modify the pose, bake all bone tracks
  _resample(rig, id, base, dur, keys, fn) {
    const S = rig.sampler, bones = S.bones;
    const times = new Float32Array(keys + 1);
    const q = bones.map(() => new Float32Array((keys + 1) * 4));
    const bodyP = new Float32Array((keys + 1) * 3);
    const body = S.by.Body || S.by.Hips;
    for (let k = 0; k <= keys; k++) {
      const u = k / keys;
      times[k] = u * dur;
      this._restore(rig);
      this._pose(rig, base, (u * base.duration) % base.duration);
      fn(u);
      for (let i = 0; i < bones.length; i++) bones[i].quaternion.toArray(q[i], k * 4);
      body.position.toArray(bodyP, k * 3);
    }
    // loop seam: last key = first key
    for (let i = 0; i < bones.length; i++) for (let c = 0; c < 4; c++) q[i][keys * 4 + c] = q[i][c];
    for (let c = 0; c < 3; c++) bodyP[keys * 3 + c] = bodyP[c];
    const tracks = bones.map((b, i) => new THREE.QuaternionKeyframeTrack(b.name + '.quaternion', times, q[i]));
    tracks.push(new THREE.VectorKeyframeTrack(body.name + '.position', times, bodyP));
    // the base clip's constant position offsets (shoulders, fingers…)
    for (const t of base.tracks) if (t.name.endsWith('.position') && !t.name.startsWith(body.name + '.')) tracks.push(t);
    return new THREE.AnimationClip(id, dur, tracks);
  }

  // ---------------------------------------------------------------------------
  // Bone texture: per clip, per frame, per bone a 3x4 skinning matrix (3 RGBA texels)
  _bakeBones(rig) {
    const nb = rig.nb, frames = [];
    let total = 0;
    for (const id of CLIP_IDS) {
      const c = rig.clips[id];
      const n = Math.max(2, Math.round(c.duration * FPS));
      rig.info[id].start = total; rig.info[id].frames = n; rig.info[id].dur = c.duration;
      total += n;
      frames.push([c, n]);
    }
    const W = nb * 3, H = total;
    const data = new Float32Array(W * H * 4);
    const m = new THREE.Matrix4();
    const S = rig.sampler;
    let row = 0;
    for (const [c, n] of frames) {
      for (let f = 0; f < n; f++, row++) {
        this._pose(rig, c, c.duration * f / n);
        for (let b = 0; b < nb; b++) {
          m.multiplyMatrices(S.bones[b].matrixWorld, rig.boneInverses[b]);
          const e = m.elements, o = (row * W + b * 3) * 4;
          // rows of the 3x4 (column-major elements: e[col*4+row])
          data[o] = e[0]; data[o + 1] = e[4]; data[o + 2] = e[8]; data[o + 3] = e[12];
          data[o + 4] = e[1]; data[o + 5] = e[5]; data[o + 6] = e[9]; data[o + 7] = e[13];
          data[o + 8] = e[2]; data[o + 9] = e[6]; data[o + 10] = e[10]; data[o + 11] = e[14];
        }
      }
    }
    const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.FloatType);
    tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
    tex.name = 'crowd_bones_' + rig.g;
    rig.boneTex = tex; rig.frames = H;
    S.mixer.stopAllAction(); S.cur = null;
  }

  // ---------------------------------------------------------------------------
  // accessory parts, authored in model space around the idle pose, converted to bind space
  _accessories(rig) {
    const S = rig.sampler, B = S.by;
    this._pose(rig, rig.clips.idle, 0);
    const P = (n) => B[n] ? new THREE.Vector3().setFromMatrixPosition(B[n].matrixWorld) : new THREE.Vector3();
    const hand = (s) => { const w = P('Wrist' + s), m = P('Middle1' + s); return w.clone().add(m.sub(w).normalize().multiplyScalar(0.05)); };
    const hR = hand('R'), hL = hand('L');
    const headB = P('Head'), chest = P('Chest'), hips = P('Hips');
    // case pose: where the left hand is when pulling a suitcase
    this._pose(rig, rig.clips.idlecase, 0);
    const hC = hand('L');
    this._pose(rig, rig.clips.idle, 0);
    const parts = [];
    const box = (bit, bone, mat, cx, cy, cz, sx, sy, sz, rx = 0, ry = 0, rz = 0) => parts.push({ bit, bone, mat, g: new THREE.BoxGeometry(sx, sy, sz), c: [cx, cy, cz], r: [rx, ry, rz] });
    const cyl = (bit, bone, mat, cx, cy, cz, r, h) => parts.push({ bit, bone, mat, g: new THREE.CylinderGeometry(r, r * 0.85, h, 8), c: [cx, cy, cz], r: [0, 0, 0] });
    const A = ACC_IDX;
    // hands
    box(BIT.BRIEFCASE, 'WristR', A.acc, hR.x - 0.02, hR.y - 0.19, hR.z, 0.085, 0.3, 0.4);
    box(BIT.SHOPBAG, 'WristL', A.acc2, hL.x + 0.03, hL.y - 0.21, hL.z, 0.11, 0.32, 0.3);
    box(BIT.SHOPBAG2, 'WristR', A.acc2, hR.x - 0.03, hR.y - 0.2, hR.z, 0.1, 0.28, 0.26);
    box(BIT.PHONE, 'WristR', A.dark, hR.x + 0.005, hR.y - 0.04, hR.z + 0.03, 0.012, 0.15, 0.075);
    cyl(BIT.CUP, 'WristL', A.cup, hL.x - 0.01, hL.y - 0.05, hL.z + 0.03, 0.04, 0.12);
    // body
    const chestZ = this._frontZ(rig, 1.25), hipZ = this._frontZ(rig, 0.85);
    box(BIT.SHOULDERBAG, 'Hips', A.acc, hips.x + 0.21, hips.y + 0.04, hips.z + 0.03, 0.08, 0.22, 0.28);
    box(BIT.SHOULDERBAG, 'Chest', A.acc, chest.x, chest.y + 0.02, chest.z + chestZ + 0.01, 0.035, 0.62, 0.012, 0, 0, -0.62);
    box(BIT.TOTE, 'ShoulderL', A.acc, hips.x + 0.25, hips.y + 0.12, hips.z - 0.02, 0.1, 0.36, 0.33);
    box(BIT.BACKPACK, 'Chest', A.acc, chest.x, chest.y - 0.06, chest.z - 0.22, 0.32, 0.42, 0.17);
    box(BIT.CART, 'Root', A.acc, 0, 0.5, 0.78, 0.5, 0.86, 0.62);
    box(BIT.CART, 'Root', A.dark, 0, 0.98, 0.5, 0.48, 0.035, 0.035);
    box(BIT.SUITCASE, 'Root', A.acc2, hC.x + 0.04, 0.33, hC.z - 0.2, 0.22, 0.56, 0.38, 0.25, 0, 0);
    box(BIT.SUITCASE, 'Root', A.dark, hC.x + 0.04, (0.62 + hC.y) / 2, hC.z - 0.04, 0.025, Math.max(0.1, hC.y - 0.6), 0.025, 0.25, 0, 0);
    box(BIT.APRON, 'Hips', A.acc2, hips.x, hips.y - 0.22, hips.z + hipZ + 0.02, 0.38, 0.6, 0.02);
    box(BIT.APRON, 'Chest', A.acc2, chest.x, chest.y + 0.02, chest.z + chestZ + 0.015, 0.27, 0.3, 0.02);
    // head (bind pose == idle pose for the head shape; author around the idle head)
    const hz = this._frontZ(rig, headB.y + 0.08, true);
    box(BIT.CAP, 'Head', A.acc2, headB.x, headB.y + 0.255, headB.z + 0.0, 0.215, 0.09, 0.235);
    box(BIT.CAP, 'Head', A.acc2, headB.x, headB.y + 0.215, headB.z + hz * 0.5 + 0.12, 0.19, 0.015, 0.1);
    box(BIT.MASK, 'Head', A.white, headB.x, headB.y + 0.055, headB.z + hz + 0.012, 0.12, 0.075, 0.03);
    // to bind space
    const out = [];
    const mInv = new THREE.Matrix4(), mOne = new THREE.Matrix4(), e = new THREE.Euler();
    for (const p of parts) {
      const bi = rig.boneIdx[p.bone]; if (bi === undefined) continue;
      const g = p.g.toNonIndexed(); g.deleteAttribute('uv');
      g.rotateX(p.r[0]); g.rotateY(p.r[1]); g.rotateZ(p.r[2]);
      g.translate(p.c[0], p.c[1], p.c[2]);
      mOne.multiplyMatrices(S.bones[bi].matrixWorld, rig.boneInverses[bi]);
      mInv.copy(mOne).invert();
      g.applyMatrix4(mInv);
      out.push({ g, bone: bi, bit: p.bit, mat: p.mat, big: p.bit === BIT.SUITCASE || p.bit === BIT.BACKPACK || p.bit === BIT.CART || p.bit === BIT.BRIEFCASE || p.bit === BIT.TOTE || p.bit === BIT.SHOPBAG });
    }
    S.mixer.stopAllAction(); S.cur = null;
    return out;
  }
  // how far the body surface sits in front of the bone column at height y (bind mesh, rough)
  _frontZ(rig, y, head = false) {
    const v = rig.variants && Object.values(rig.variants)[0];
    return head ? 0.12 : (y > 1.1 ? 0.13 : 0.12);
  }

  _withAccessories(src, acc, base, small) {
    const n0 = src.attributes.position.count;
    const list = acc.filter(a => !small || a.big);
    let n = n0; for (const a of list) n += a.g.attributes.position.count;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), si = new Uint8Array(n * 4), sw = new Float32Array(n * 4), mat = new Float32Array(n), part = new Float32Array(n);
    const P = src.attributes.position, N = src.attributes.normal, I = src.attributes.skinIndex, Wt = src.attributes.skinWeight, M = src.attributes._mat || src.attributes.mat;
    // fast copies (the packer writes plain arrays: float positions, int8-normalised normals, uint8 joints, uint8-normalised weights)
    const plain = (A) => !A.isInterleavedBufferAttribute;
    if (plain(P) && P.array instanceof Float32Array) pos.set(P.array.subarray(0, n0 * 3)); else for (let i = 0; i < n0; i++) { pos[i * 3] = P.getX(i); pos[i * 3 + 1] = P.getY(i); pos[i * 3 + 2] = P.getZ(i); }
    if (plain(N) && N.array instanceof Int8Array && N.itemSize === 3) { const a = N.array; for (let i = 0; i < n0 * 3; i++) nor[i] = Math.max(-1, a[i] / 127); }
    else for (let i = 0; i < n0; i++) { nor[i * 3] = N.getX(i); nor[i * 3 + 1] = N.getY(i); nor[i * 3 + 2] = N.getZ(i); }
    if (plain(I) && I.itemSize === 4 && (I.array instanceof Uint8Array)) si.set(I.array.subarray(0, n0 * 4)); else for (let i = 0; i < n0; i++) for (let k = 0; k < 4; k++) si[i * 4 + k] = I.getComponent(i, k);
    if (plain(Wt) && Wt.itemSize === 4 && Wt.array instanceof Uint8Array && Wt.normalized) { const a = Wt.array; for (let i = 0; i < n0 * 4; i++) sw[i] = a[i] / 255; }
    else for (let i = 0; i < n0; i++) for (let k = 0; k < 4; k++) sw[i * 4 + k] = Wt.getComponent(i, k);
    if (M) { const a = M.array; if (plain(M) && M.itemSize === 1) for (let i = 0; i < n0; i++) mat[i] = a[i]; else for (let i = 0; i < n0; i++) mat[i] = M.getX(i); }
    const idx = [];
    const src0 = src.index.array; for (let i = 0; i < src0.length; i++) idx.push(src0[i]);
    let o = n0;
    for (const a of list) {
      const ap = a.g.attributes.position, an = a.g.attributes.normal, c = ap.count;
      for (let i = 0; i < c; i++) {
        const j = o + i;
        pos[j * 3] = ap.getX(i); pos[j * 3 + 1] = ap.getY(i); pos[j * 3 + 2] = ap.getZ(i);
        nor[j * 3] = an.getX(i); nor[j * 3 + 1] = an.getY(i); nor[j * 3 + 2] = an.getZ(i);
        si[j * 4] = a.bone; sw[j * 4] = 1;
        mat[j] = base + a.mat; part[j] = a.bit + 1;
        idx.push(j);
      }
      o += c;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    g.setAttribute('aMat', new THREE.BufferAttribute(mat, 1));
    g.setAttribute('aPart', new THREE.BufferAttribute(part, 1));
    g.setIndex(n < 65536 ? new THREE.Uint16BufferAttribute(idx, 1) : new THREE.Uint32BufferAttribute(idx, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.6);
    return g;
  }

  // ---------------------------------------------------------------------------
  // a near (skinned) person of one outfit: SkeletonUtils.clone of a template
  makeNear(variant) {
    const rig = variant.rig;
    if (!variant.template) {
      const root = new THREE.Group(); root.name = 'person_' + variant.name;
      const sk = this._skeletonCopy(rig);
      const arm = sk.root.children[0]; root.add(arm);
      const skel = new THREE.Skeleton(sk.bones, rig.boneInverses);
      const mesh = new THREE.SkinnedMesh(variant.geos[0], new THREE.MeshBasicMaterial());
      mesh.name = 'body'; mesh.frustumCulled = false;
      root.add(mesh); root.updateMatrixWorld(true);
      mesh.bind(skel, new THREE.Matrix4());
      variant.template = root;
    }
    const root = skClone(variant.template);
    let mesh = null; root.traverse(o => { if (o.isSkinnedMesh) mesh = o; });
    mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = true;
    const mixer = new THREE.AnimationMixer(root);
    const actions = {};
    for (const id of CLIP_IDS) { const a = mixer.clipAction(rig.clips[id]); a.setLoop(THREE.LoopRepeat, Infinity); a.enabled = false; actions[id] = a; }
    const by = {}; root.traverse(o => { if (o.isBone) by[o.name] = o; });
    return { root, mesh, mixer, actions, by, variant };
  }
}

// accessory colours (appended to every outfit table)
const ACC_MATS = [
  { name: 'acc', color: '#222222', tint: TINT.ACC },
  { name: 'acc2', color: '#222222', tint: TINT.ACC2 },
  { name: 'dark', color: '#141416', tint: TINT.KEEP },
  { name: 'white', color: '#e9e9e6', tint: TINT.KEEP },
  { name: 'cup', color: '#efe9df', tint: TINT.KEEP },
];
const ACC_IDX = { acc: 0, acc2: 1, dark: 2, white: 3, cup: 4 };

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
function smooth(x) { return x * x * (3 - 2 * x); }

// ---------------------------------------------------------------------------
// Materials (MeshStandardMaterial + injected colour table / accessory switches;
// the far version also does instanced GPU skinning from the bone texture).
const COMMON_VERT_HEAD = /* glsl */`
attribute float aMat;
attribute float aPart;
uniform vec4 crMat[${MAX_MATS}];
uniform float crMask;
varying vec3 vCrowdCol;
varying float vCrowdFade;
vec3 crowdUnpack(float v) {
  float r = floor(v / 65536.0);
  float g = floor((v - r * 65536.0) / 256.0);
  float b = v - r * 65536.0 - g * 256.0;
  return pow(vec3(r, g, b) / 255.0, vec3(2.2));
}
vec3 crowdColour(vec4 cA, vec4 cB) {
  vec4 m = crMat[int(aMat + 0.5)];
  int t = int(m.w + 0.5);
  if (t == 0) return m.rgb;
  if (t == 1) return crowdUnpack(cB.x);
  if (t == 2) return crowdUnpack(cA.w);
  if (t == 3) return crowdUnpack(cA.x);
  if (t == 4) return crowdUnpack(cA.y);
  if (t == 5) return crowdUnpack(cA.z);
  if (t == 6) return crowdUnpack(cB.y);
  if (t == 7) return crowdUnpack(cB.z);
  return crowdUnpack(cB.w);
}
bool crowdHidden(float flags) {
  int p = int(aPart + 0.5);
  if (p == 0) return false;
  int f = int(flags + 0.5) & int(crMask + 0.5);
  return ((f >> (p - 1)) & 1) == 0;
}
`;

const NEAR_VERT_HEAD = /* glsl */`
uniform vec4 crColA;
uniform vec4 crColB;
uniform vec4 crMisc; // fade, flags
`;
const NEAR_VERT_BEGIN = /* glsl */`
vCrowdCol = crowdColour(crColA, crColB);
vCrowdFade = crMisc.x;
vec3 transformed = vec3(position);
if (crowdHidden(crMisc.y)) transformed = vec3(0.0);
`;

const FAR_VERT_HEAD = /* glsl */`
attribute vec4 skinIndex;
attribute vec4 skinWeight;
attribute vec4 iPos;   // x, y, z, yaw (yaw 0 faces -Z)
attribute vec4 iAnim;  // frame A, frame B, weight B, height scale
attribute vec4 iColA;
attribute vec4 iColB;
attribute vec4 iMisc;  // fade, flags, width scale, -
uniform highp sampler2D crBones;
mat4 crBone(int b, int f) {
  int x = b * 3;
  vec4 r0 = texelFetch(crBones, ivec2(x, f), 0);
  vec4 r1 = texelFetch(crBones, ivec2(x + 1, f), 0);
  vec4 r2 = texelFetch(crBones, ivec2(x + 2, f), 0);
  return mat4(r0.x, r1.x, r2.x, 0.0, r0.y, r1.y, r2.y, 0.0, r0.z, r1.z, r2.z, 0.0, r0.w, r1.w, r2.w, 1.0);
}
mat4 crSkin(int f) {
  mat4 m = skinWeight.x * crBone(int(skinIndex.x + 0.5), f);
  if (skinWeight.y > 0.0) m += skinWeight.y * crBone(int(skinIndex.y + 0.5), f);
  if (skinWeight.z > 0.0) m += skinWeight.z * crBone(int(skinIndex.z + 0.5), f);
  if (skinWeight.w > 0.0) m += skinWeight.w * crBone(int(skinIndex.w + 0.5), f);
  return m;
}
`;
const FAR_VERT_BODY = /* glsl */`
  vCrowdCol = crowdColour(iColA, iColB);
  vCrowdFade = iMisc.x;
  vec3 crP = crowdHidden(iMisc.y) ? vec3(0.0) : position;
  mat4 crM = crSkin(int(iAnim.x + 0.5));
  if (iAnim.z > 0.001) crM = crM * (1.0 - iAnim.z) + crSkin(int(iAnim.y + 0.5)) * iAnim.z;
  crP = (crM * vec4(crP, 1.0)).xyz;
  vec3 objectNormal = mat3(crM) * normal;
  crP.xz *= iMisc.z; crP *= iAnim.w;
  objectNormal.xz /= iMisc.z;
  float crA = iPos.w + 3.14159265;
  float crC = cos(crA), crS = sin(crA);
  crP = vec3(crC * crP.x + crS * crP.z, crP.y, -crS * crP.x + crC * crP.z) + iPos.xyz;
  objectNormal = vec3(crC * objectNormal.x + crS * objectNormal.z, objectNormal.y, -crS * objectNormal.x + crC * objectNormal.z);
`;

const FRAG_HEAD = /* glsl */`
varying vec3 vCrowdCol;
varying float vCrowdFade;
`;
const FRAG_COLOR = /* glsl */`
  diffuseColor.rgb *= vCrowdCol;
  #ifdef CROWD_BLEND
    diffuseColor.a *= clamp(vCrowdFade, 0.0, 1.0);
  #endif
`;

export function makeNearMaterial(variant, blend) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0.0, envMapIntensity: 0.55 });
  if (blend) { m.transparent = true; m.depthWrite = true; m.defines = { CROWD_BLEND: 1 }; }
  const U = {
    crMat: { value: variant.matU }, crMask: { value: variant.mask },
    crColA: { value: new THREE.Vector4() }, crColB: { value: new THREE.Vector4() }, crMisc: { value: new THREE.Vector4(1, 0, 1, 0) },
  };
  m.userData.crowd = U;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = COMMON_VERT_HEAD + NEAR_VERT_HEAD + sh.vertexShader.replace('#include <begin_vertex>', NEAR_VERT_BEGIN);
    sh.fragmentShader = FRAG_HEAD + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG_COLOR);
  };
  m.customProgramCacheKey = () => blend ? 'namba_people_near_blend_v1' : 'namba_people_near_v1';
  m.name = blend ? 'crowd_person_fade' : 'crowd_person';
  return m;
}
// near material that shares the uniforms of another (opaque <-> fade twin)
export function twinNearMaterial(variant, base, blend) {
  const m = makeNearMaterial(variant, blend);
  m.userData.crowd = base.userData.crowd;
  const U = base.userData.crowd;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = COMMON_VERT_HEAD + NEAR_VERT_HEAD + sh.vertexShader.replace('#include <begin_vertex>', NEAR_VERT_BEGIN);
    sh.fragmentShader = FRAG_HEAD + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG_COLOR);
  };
  return m;
}

export function makeFarMaterial(variant, blend) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0.0, envMapIntensity: 0.55 });
  if (blend) { m.transparent = true; m.depthWrite = true; m.defines = { CROWD_BLEND: 1 }; }
  const U = { crMat: { value: variant.matU }, crMask: { value: variant.mask }, crBones: { value: variant.rig.boneTex } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = COMMON_VERT_HEAD + FAR_VERT_HEAD + sh.vertexShader
      .replace('#include <beginnormal_vertex>', FAR_VERT_BODY)
      .replace('#include <begin_vertex>', 'vec3 transformed = crP;');
    sh.fragmentShader = FRAG_HEAD + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG_COLOR);
  };
  m.customProgramCacheKey = () => blend ? 'namba_people_far_blend_v1' : 'namba_people_far_v1';
  m.name = blend ? 'crowd_people_far_fade' : 'crowd_people_far';
  return m;
}
