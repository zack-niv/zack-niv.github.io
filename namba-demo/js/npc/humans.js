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
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { BIT } from './looks.js';
import { ESC_STAND_SIDE } from './sim.js';

export const TINT = { KEEP: 0, SKIN: 1, HAIR: 2, TOP: 3, BOTTOM: 4, SHOES: 5, INNER: 6, ACC: 7, ACC2: 8, PACK: 9, CASE: 10, CORD: 11, SCREEN: 12, CAP: 13 };
const MAX_MATS = 28;   // polish: + phone screen (was 23 / 24 used)
const FPS = 30;
const BASE = new URL('../../assets/humans/', import.meta.url).href;

// clip ids (shared by both rigs, same order => same bone-texture layout logic)
export const CLIP = {
  walk: 'Walk', run: 'Run', idle: 'Idle_Neutral', idle2: 'Idle', wave: 'Wave', interact: 'Interact',
  sit: null, eat: null, phone: null, phonewalk: null, photo: null, bow: null, nod: null, browse: null,
  lookup: null, cart: null, walkcase: null, idlecase: null, ride: null,
  // v4: seated variants: chair (seat ~0.5 m) and high stool (seat ~0.8 m), each sitting / eating / on the phone
  sitphone: null, sit2: null, eat2: null, sitphone2: null,
};
// design heights of the seated clips: the pelvis bone ('Body') sits at the seat top; render.js lifts / lowers each person so the
// pelvis lands exactly on the real seat (SEAT_BODY[kind] is the clip's own Body height at scale 1)
export const SEAT_BODY = { chair: 0.5, stool: 0.8 };
export const SEAT_CLIPS = { sit: 'chair', eat: 'chair', sitphone: 'chair', sit2: 'stool', eat2: 'stool', sitphone2: 'stool' };
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
    const acc = this._accessories(rig, meshes);
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
    // The legs' IK feet ('FootL' / 'FootR' are controls under Root, NOT children of the shin) and the shin's own axis (child-to-
    // foot direction at rest, in the knee's frame) are what the old pose got wrong: `aim(LowerLeg, Foot)` aimed at the PLANTED
    // foot, so the shin pointed diagonally (and the foot stayed under the hip, legs through the chair).
    this._pose(rig, C.idle, 0);
    const shinAx = {}, shinLen = {};
    for (const sd of ['L', 'R']) {
      const kn = B['LowerLeg' + sd], ft = B['Foot' + sd];
      va.setFromMatrixPosition(kn.matrixWorld); vb.setFromMatrixPosition(ft.matrixWorld).sub(va);
      shinLen[sd] = vb.length();
      kn.getWorldQuaternion(qb); shinAx[sd] = vb.clone().normalize().applyQuaternion(qb.clone().invert());
    }
    const aimAxis = (bn, axisLocal, dir) => {
      const b = B[bn]; if (!b) return;
      b.getWorldQuaternion(qb);
      vb.copy(axisLocal).applyQuaternion(qb);
      qa.setFromUnitVectors(vb, dir);
      qa.multiply(qb);
      b.parent.getWorldQuaternion(qp); b.quaternion.copy(qp.invert().multiply(qa));
      b.updateMatrixWorld(true);
    };
    const SEAT = {
      chair: { body: SEAT_BODY.chair, thigh: (sx) => V(0.09 * sx, -0.10, 1), shin: (sx) => V(0.02 * sx, -1, 0.08) },
      stool: { body: SEAT_BODY.stool, thigh: (sx) => V(0.10 * sx, -1.0, 1), shin: (sx) => V(0.0, -1, -0.10) },
    };
    const sitPose = (kind = 'chair') => {
      const cfg = SEAT[kind], by = footY();
      moveBody(cfg.body - by, -0.04);
      for (const s of ['L', 'R']) {
        const sx = s === 'L' ? 1 : -1;
        aim('UpperLeg' + s, 'LowerLeg' + s, cfg.thigh(sx));
        const sd = cfg.shin(sx);
        aimAxis('LowerLeg' + s, shinAx[s], sd);
        // foot control at the end of the shin (keeps the idle foot's orientation: flat)
        const kn = B['LowerLeg' + s], ft = B['Foot' + s];
        va.setFromMatrixPosition(kn.matrixWorld).addScaledVector(sd, shinLen[s]);
        ft.parent.worldToLocal(va); ft.position.copy(va); ft.updateMatrixWorld(true);
        aim('UpperArm' + s, 'LowerArm' + s, V(0.18 * sx, -0.9, 0.45));
        aim('LowerArm' + s, 'Wrist' + s, V(-0.25 * sx, -0.38, 1));
      }
      bend('Abdomen', X, 0.05);
    };
    // palm normal of each hand in its wrist bone's frame (idle: palms face the body's midline; the phone is authored on that side)
    const palmAx = {};
    for (const sd of ['L', 'R']) { B['Wrist' + sd].getWorldQuaternion(qb); palmAx[sd] = new THREE.Vector3(sd === 'R' ? 1 : -1, 0, 0).applyQuaternion(qb.clone().invert()); }
    const eyes = new THREE.Vector3(), eyeOff = new THREE.Vector3(0, 0.08, 0.1);
    // roll the forearm (60%) and wrist (40%) about the forearm's own axis so the palm (and what it holds) faces the eyes, or the
    // model-space direction `dir`; the wrist does not move, only the hand turns
    const palmTo = (s, tilt = 0, dir = null) => {
      const lo = B['LowerArm' + s], wr = B['Wrist' + s]; if (!lo || !wr || !B.Head) return;
      eyes.setFromMatrixPosition(B.Head.matrixWorld).add(eyeOff);   // of THIS pose (seated clips sit ~0.4 m lower)
      const ax = new THREE.Vector3().setFromMatrixPosition(wr.matrixWorld);
      const want = dir ? dir.clone() : eyes.clone().sub(ax);
      ax.sub(va.setFromMatrixPosition(lo.matrixWorld)).normalize();
      wr.getWorldQuaternion(qb);
      const n = palmAx[s].clone().applyQuaternion(qb);
      n.addScaledVector(ax, -n.dot(ax)); want.addScaledVector(ax, -want.dot(ax));
      if (n.lengthSq() < 1e-8 || want.lengthSq() < 1e-8) return;
      n.normalize(); want.normalize();
      let ang = Math.acos(Math.max(-1, Math.min(1, n.dot(want))));
      if (vb.crossVectors(n, want).dot(ax) < 0) ang = -ang;
      bend('LowerArm' + s, ax, ang * 0.6); bend('Wrist' + s, ax, ang * 0.4);
      // then bend the hand at the wrist (capped) so the palm faces its target squarely rather than only as far as the roll allows
      if (!tilt) return;
      wr.getWorldQuaternion(qb); n.copy(palmAx[s]).applyQuaternion(qb);
      if (dir) want.copy(dir); else want.setFromMatrixPosition(wr.matrixWorld).negate().add(eyes).normalize();
      const t = Math.acos(Math.max(-1, Math.min(1, n.dot(want))));
      vb.crossVectors(n, want); if (vb.lengthSq() < 1e-8) return;
      bend('Wrist' + s, vb.normalize(), Math.min(0.75, t * tilt));
    };
    // close the fingers round the far long edge of what the palm holds (the thumb a little over its face): flex each joint about
    // finger x palm-normal, so the fingertips move towards the palm side whatever the arm pose
    const grip = (s, a2, a3, th) => {
      const wr = B['Wrist' + s]; if (!wr) return;
      wr.getWorldQuaternion(qb); const n = palmAx[s].clone().applyQuaternion(qb);
      const flex = (bn, cn, ang) => {
        const b = B[bn], c = B[cn]; if (!b || !c) return;
        va.setFromMatrixPosition(b.matrixWorld); vb.setFromMatrixPosition(c.matrixWorld).sub(va);
        if (vb.lengthSq() < 1e-8) return;
        vb.normalize().cross(n); if (vb.lengthSq() < 1e-6) return;
        bend(bn, vb.normalize(), ang);
      };
      for (const f of ['Index', 'Middle', 'Ring', 'Pinky']) { flex(f + '2' + s, f + '3' + s, a2); flex(f + '3' + s, f + '4' + s, a3); }
      flex('Thumb2' + s, 'Thumb3' + s, th);
    };
    // v4 critic ROOT CAUSE of "empty hand": the old forearm aim (0.42, 0.62, 0.66) brought the hand up against the chin with the
    // palm (and the phone on it) turned to the face, so the phone was sandwiched between hand and face, invisible from anywhere.
    // Now: elbow by the side, forearm forward, in across the body and a little up, hand in front of the chest, palm rolled up to
    // the eyes and fingers loosely closed: the phone lies ON the hand and pokes out past it, so it reads from every side.
    // polish: the palm (and the lit screen) faces UP and a little forward instead of straight at the eyes, the way people hold a
    // phone low at the chest with the head bowed: still readable for its owner, and the glowing screen now shows to people in front.
    const phoneArm = (k = 1) => {
      aim('UpperArmR', 'LowerArmR', V(-0.1, -1, 0.18), k);
      aim('LowerArmR', 'WristR', V(0.5, 0.35, 1), k);
      if (k > 0) { palmTo('R', 1, V(0, 1, 0.38)); grip('R', 0.4, 0.35, 0.3); }
    };
    const caseArm = () => { aim('UpperArmL', 'LowerArmL', V(0.32, -1, -0.28)); aim('LowerArmL', 'WristL', V(0.3, -1, -0.38)); };
    const eatLoop = (u) => {
      const k = smooth(clamp01((u - 0.2) / 0.15)) * (1 - smooth(clamp01((u - 0.55) / 0.15)));
      aim('LowerArmR', 'WristR', V(0.15 + 0.2 * k, -0.38 + 1.1 * k, 1 - 0.4 * k));
      aim('LowerArmL', 'WristL', V(-0.35, -0.2, 1));
      head(0.18 - 0.1 * k);
    };
    const seatMake = (id, kind, fn, dur = C.idle.duration, keys = 8) => { C[id] = this._resample(rig, id, C.idle, dur, keys, (u) => { sitPose(kind); fn(u); }, true); };
    seatMake('sit', 'chair', () => {});
    seatMake('eat', 'chair', eatLoop, 2.4, 16);
    seatMake('sitphone', 'chair', () => { phoneArm(); head(0.32); });
    seatMake('sit2', 'stool', () => {});
    seatMake('eat2', 'stool', eatLoop, 2.4, 16);
    seatMake('sitphone2', 'stool', () => { phoneArm(); head(0.32); });
    make('phone', C.idle, C.idle.duration, 8, () => { phoneArm(); aim('UpperArmL', 'LowerArmL', V(0.1, -1, 0.15)); head(0.32); });
    make('phonewalk', C.walk, C.walk.duration, 16, () => { phoneArm(); head(0.28); });
    // v4 critic: both hands used to meet (and cross) in front of the chin, burying the phone. Now a one-handed shot: the right hand
    // holds the phone up in front of the face, palm (and phone) turned OUT to what is photographed, so the phone shows landscape
    // to everyone in front (a palm turned to the eyes would put the hand between the phone and every onlooker); fingers barely
    // closed so they do not cover it; the left arm stays relaxed.
    make('photo', C.idle, C.idle.duration, 8, () => {
      aim('UpperArmR', 'LowerArmR', V(-0.1, -0.05, 1)); aim('LowerArmR', 'WristR', V(0.1, 0.45, 0.9));
      palmTo('R', 1, V(0, 0.15, 1)); grip('R', 0.12, 0.1, 0.2);
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
    // escalator: the hand on the standing side (sim.js ESC_STAND_SIDE) rests on the handrail
    make('ride', C.idle, C.idle.duration, 8, () => {
      const s = ESC_STAND_SIDE > 0 ? 'R' : 'L', sx = ESC_STAND_SIDE > 0 ? -1 : 1;
      aim('UpperArm' + s, 'LowerArm' + s, V(0.4 * sx, -0.9, 0.12)); aim('LowerArm' + s, 'Wrist' + s, V(0.25 * sx, -0.35, 1));
    });
    // v7: IC-card tap at a ticket gate. Not a clip: a layered upper-body override applied by render.js on top of the walk (near LOD
    // only), so the walk, the feet and the other arm are untouched. Two key poses per hand, stored as the arm bones' LOCAL
    // quaternions (relative to the shoulder, so independent of the walk's torso sway): `up` = forearm forward, hand at the reader
    // (~0.95 m on a 1.7 m person), palm down, and `press` = the hand pushed ~4 cm on to the pad. R = right hand, L = mirrored.
    rig.tapPose = {};
    for (const s of ['R', 'L']) {
      const sx = s === 'R' ? -1 : 1, names = ['UpperArm' + s, 'LowerArm' + s, 'Wrist' + s];
      const grab = (fn) => {
        S.cur = null; S.curClip = null; this._restore(rig); this._pose(rig, C.idle, 0);
        fn();
        return names.map(n => B[n] ? B[n].quaternion.clone() : null);
      };
      const tp = { names };
      tp.up = grab(() => {
        aim('UpperArm' + s, 'LowerArm' + s, V(0.02 * sx, -1, 0.3));
        aim('LowerArm' + s, 'Wrist' + s, V(0.2 * sx, -0.12, 1));
        palmTo(s, 1, V(0, -1, 0.12));
      });
      tp.press = grab(() => {
        aim('UpperArm' + s, 'LowerArm' + s, V(0.02 * sx, -1, 0.5));
        aim('LowerArm' + s, 'Wrist' + s, V(0.2 * sx, -0.2, 1));
        palmTo(s, 1, V(0, -1, 0.12));
      });
      rig.tapPose[s] = tp;
    }
    S.cur = null; S.curClip = null; this._restore(rig);
  }

  // sample `base` over `dur` (looping) at `keys` keys, run fn(u) to modify the pose, bake all bone tracks
  _resample(rig, id, base, dur, keys, fn, feet = false) {
    const S = rig.sampler, bones = S.bones;
    const times = new Float32Array(keys + 1);
    const q = bones.map(() => new Float32Array((keys + 1) * 4));
    const bodyP = new Float32Array((keys + 1) * 3);
    const body = S.by.Body || S.by.Hips;
    S.cur = null; S.curClip = null;   // v4: the previous clip's pose function edited bones directly; never trust the mixer's "value unchanged" shortcut
    const feetB = feet ? ['FootL', 'FootR'].map(n => S.by[n]).filter(Boolean) : [];
    const feetP = feetB.map(() => new Float32Array((keys + 1) * 3));
    for (let k = 0; k <= keys; k++) {
      const u = k / keys;
      times[k] = u * dur;
      this._restore(rig);
      this._pose(rig, base, (u * base.duration) % base.duration);
      fn(u);
      for (let i = 0; i < bones.length; i++) bones[i].quaternion.toArray(q[i], k * 4);
      body.position.toArray(bodyP, k * 3);
      feetB.forEach((f, i) => f.position.toArray(feetP[i], k * 3));
    }
    feetP.forEach(a => { for (let c = 0; c < 3; c++) a[keys * 3 + c] = a[c]; });
    // loop seam: last key = first key
    for (let i = 0; i < bones.length; i++) for (let c = 0; c < 4; c++) q[i][keys * 4 + c] = q[i][c];
    for (let c = 0; c < 3; c++) bodyP[keys * 3 + c] = bodyP[c];
    const tracks = bones.map((b, i) => new THREE.QuaternionKeyframeTrack(b.name + '.quaternion', times, q[i]));
    tracks.push(new THREE.VectorKeyframeTrack(body.name + '.position', times, bodyP));
    feetB.forEach((f, i) => tracks.push(new THREE.VectorKeyframeTrack(f.name + '.position', times, feetP[i])));
    // the base clip's constant position offsets (shoulders, fingers…); seated clips own the feet
    for (const t of base.tracks) if (t.name.endsWith('.position') && !t.name.startsWith(body.name + '.') && !feetB.some(f => t.name.startsWith(f.name + '.'))) tracks.push(t);
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
  _accessories(rig, meshes = {}) {
    const S = rig.sampler, B = S.by;
    // v4 ROOT CAUSE of "phone not in the hand": the last procedural clip ('ride', which bends the right arm onto the handrail) left
    // the sampler in its pose; _pose() then saw "idle at t=0 == last evaluated value" and did not rewrite the arm, so every
    // right-hand prop (phone, briefcase, bag) was authored at the RIDE hand position, ~0.28 m in front of the real hand.
    S.cur = null; S.curClip = null; this._restore(rig); S.mixer.stopAllAction();
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
    // bevelled box (108 tris): bags read as soft goods, not crates
    const rbox = (bit, bone, mat, cx, cy, cz, sx, sy, sz, rad, rx = 0, ry = 0, rz = 0) => parts.push({ bit, bone, mat, g: new RoundedBoxGeometry(sx, sy, sz, 1, rad), c: [cx, cy, cz], r: [rx, ry, rz] });
    const body = this._bodyPts(rig, meshes);
    // polish: a thin bar from p0 to p1 (straps, handles); its thickness runs along `side` (the surface normal) when given
    const seg = (bit, bone, mat, p0, p1, w, t, side = null) => {
      const d = new THREE.Vector3().subVectors(p1, p0), len = d.length(); if (len < 1e-4) return;
      const g = new THREE.BoxGeometry(w, len + t, t), y = d.normalize();
      const z = side ? side.clone().addScaledVector(y, -side.dot(y)) : null;
      if (z && z.lengthSq() > 1e-6) { z.normalize(); g.applyMatrix4(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(y, z), y, z)); }
      else g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), y));
      g.translate((p0.x + p1.x) / 2, (p0.y + p1.y) / 2, (p0.z + p1.z) / 2);
      parts.push({ bit, bone, mat, g, c: [0, 0, 0], r: [0, 0, 0] });
    };
    const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
    const cyl = (bit, bone, mat, cx, cy, cz, r, h) => parts.push({ bit, bone, mat, g: new THREE.CylinderGeometry(r, r * 0.85, h, 8), c: [cx, cy, cz], r: [0, 0, 0] });
    const A = ACC_IDX;
    // hands (v4 hotfix: real proportions; the old ones were plain crates)
    // briefcase ~0.42 x 0.31 x 0.07, hanging from a small handle in the right hand, long side along the walk
    const bcTop = hR.y - 0.06;
    rbox(BIT.BRIEFCASE, 'WristR', A.case, hR.x - 0.015, bcTop - 0.155, hR.z, 0.07, 0.31, 0.42, 0.012);
    box(BIT.BRIEFCASE, 'WristR', A.dark, hR.x - 0.015, hR.y - 0.012, hR.z, 0.018, 0.016, 0.12);
    for (const dz of [-0.052, 0.052]) box(BIT.BRIEFCASE, 'WristR', A.dark, hR.x - 0.015, (hR.y - 0.012 + bcTop) / 2, hR.z + dz, 0.016, hR.y - 0.012 - bcTop, 0.016);
    // paper shopping bags ~0.30 x 0.32 x 0.12 with two thin cord handles up to the hand
    const paperBag = (bit, bone, h, sx) => {
      const top = h.y - 0.09;
      box(bit, bone, A.acc2, h.x + sx * 0.035, top - 0.16, h.z, 0.12, 0.32, 0.30);
      box(bit, bone, A.acc2, h.x + sx * 0.035, top - 0.004, h.z, 0.124, 0.012, 0.304);   // folded rim
      for (const dx of [-0.045, 0.045]) for (const dz of [-1, 1]) {
        // each cord rises from the rim (z +-5.5 cm) to the fist (z +-1.2 cm): a tilted thin bar
        const x0 = h.x + sx * 0.035 + dx * 0.6, z0 = h.z + dz * 0.055, z1 = h.z + dz * 0.012, y1 = h.y - 0.005;
        const len = Math.hypot(y1 - top, z1 - z0);
        box(bit, bone, A.cord, x0, (top + y1) / 2, (z0 + z1) / 2, 0.007, len, 0.007, -dz * Math.atan2(z0 * dz - z1 * dz, y1 - top), 0, 0);
      }
    };
    paperBag(BIT.SHOPBAG, 'WristL', hL, 1);
    paperBag(BIT.SHOPBAG2, 'WristR', hR, -1);
    // v4 critic: the phone sat 5 mm off the hand's centre line, i.e. INSIDE the 3 cm-thick hand mesh, so it never showed. Hold it
    // against the palm (the palm faces the body's midline in the idle pose the parts are authored in), a bit proud of the fingers.
    // v4 hotfix: with the box's long side ALONG the fingers the whole phone hid behind the (mitten) hand, and a near-black phone
    // vanished against dark suits. A phone is gripped across the palm (fingers round one long edge, thumb on the other), so its
    // long side runs across the palm (+-z in the idle pose) and pokes out ~3 cm on both sides of the hand.
    // v4 critic, pass 2: the phone was always drawn; it was the old phone POSE (hand at the chin, palm to the face) that buried it
    // between hand and face, see phoneArm. Graphite case + a black screen face on the side away from the palm.
    const palm = hR.x < 0 ? 1 : -1;
    box(BIT.PHONE, 'WristR', A.phone, hR.x + palm * 0.028, hR.y - 0.025, hR.z + 0.005, 0.014, 0.078, 0.16);
    box(BIT.PHONE, 'WristR', A.screen, hR.x + palm * 0.0355, hR.y - 0.025, hR.z + 0.005, 0.002, 0.07, 0.148);   // polish: lit screen
    cyl(BIT.CUP, 'WristL', A.cup, hL.x - 0.01, hL.y - 0.05, hL.z + 0.03, 0.04, 0.12);
    // body
    const chestZ = this._frontZ(rig, 1.25), hipZ = this._frontZ(rig, 0.85);
    // polish: shoulder bag = a soft bevelled satchel with a flap and a clasp on the left hip, and a cross-body strap that follows
    // the measured body surface: up across the chest to the right shoulder, over it, and down the back to the bag (~250 tris)
    {
      const bx = hips.x + 0.2, by = hips.y + 0.03, bz = hips.z + 0.03, top = by + 0.1;
      rbox(BIT.SHOULDERBAG, 'Hips', A.acc, bx, by, bz, 0.075, 0.2, 0.26, 0.022);
      rbox(BIT.SHOULDERBAG, 'Hips', A.acc, bx + 0.038, by + 0.035, bz, 0.012, 0.135, 0.268, 0.005);   // flap
      box(BIT.SHOULDERBAG, 'Hips', A.dark, bx + 0.046, by - 0.03, bz, 0.006, 0.026, 0.034);             // clasp
      const sx = chest.x - 0.115, sTop = body.top(sx, chest.y + 0.02, chest.y + 0.32, chest.y + 0.18);
      const F = (t) => { const x = bx - 0.03 + (sx - bx + 0.03) * t, y = top + (sTop - 0.045 - top) * t; return v3(x, y, body.front(x, y, chest.z + 0.11) + 0.008); };
      const Bk = (t) => { const x = bx - 0.03 + (sx - bx + 0.03) * t, y = top + (sTop - 0.045 - top) * t; return v3(x, y, body.back(x, y - 0.03, y + 0.03, 0.02, chest.z - 0.1) - 0.008); };
      const f1 = F(0.4), f2 = F(0.7), f3 = F(1), b3 = Bk(1), b2 = Bk(0.6);
      const ov = v3(sx, sTop + 0.006, (f3.z + b3.z) / 2), fwd = v3(0, 0, 1), up = v3(0, 1, 0);
      const chain = [v3(bx - 0.02, top - 0.005, bz + 0.05), f1, f2, f3, ov, b3, b2, v3(bx - 0.02, top - 0.005, bz - 0.06)];
      for (let i = 0; i + 1 < chain.length; i++) seg(BIT.SHOULDERBAG, 'Chest', A.acc, chain[i], chain[i + 1], 0.032, 0.008, i === 3 || i === 4 ? up : fwd);
    }
    // polish: tote = a soft, thin, wide bevelled bag at the left hip with two flat handles up over the left shoulder (~150 tris)
    {
      const tx = hips.x + 0.25, ty = hips.y + 0.11, tz = hips.z - 0.02, top = ty + 0.165;
      const tg = new RoundedBoxGeometry(0.06, 0.33, 0.32, 1, 0.016), tp = tg.attributes.position;   // tapered: wider at the mouth
      for (let i = 0; i < tp.count; i++) tp.setZ(i, tp.getZ(i) * (1 + 0.28 * tp.getY(i) / 0.33));
      parts.push({ bit: BIT.TOTE, bone: 'ShoulderL', mat: A.acc, g: tg, c: [tx, ty, tz], r: [0, 0, 0] });
      const shx = chest.x + 0.14, shy = body.top(shx, chest.y + 0.02, chest.y + 0.32, chest.y + 0.18) + 0.006;
      for (const dz of [-1, 1]) seg(BIT.TOTE, 'ShoulderL', A.acc, v3(tx - 0.01, top - 0.01, tz + dz * 0.085), v3(shx, shy, chest.z - 0.01 + dz * 0.03), 0.028, 0.006, v3(1, 0.4, 0));
    }
    // backpack (v4 hotfix): ~0.28 x 0.38 x 0.12 bevelled body snug on the back (measured back surface), front pocket, top grab
    // loop, and two shoulder straps that run over the shoulders and down the chest; muted palette colour (TINT.PACK)
    {
      const cy = chest.y - 0.07, back = body.back(chest.x, cy - 0.12, cy + 0.12, 0.12, chest.z - 0.13) - 0.004;
      rbox(BIT.BACKPACK, 'Chest', A.pack, chest.x, cy, back - 0.06, 0.28, 0.38, 0.12, 0.035);
      rbox(BIT.BACKPACK, 'Chest', A.pack, chest.x, cy - 0.085, back - 0.12 - 0.018, 0.21, 0.15, 0.045, 0.018);
      box(BIT.BACKPACK, 'Chest', A.dark, chest.x, cy - 0.012, back - 0.163, 0.17, 0.008, 0.006);   // pocket zip
      // straps: a chain of thin bars hugging the measured surface: chest -> collarbone -> over the trapezius -> down to the pack top
      const bar = (y0, z0, y1, z1, x) => { const dy = y1 - y0, dz = z1 - z0; box(BIT.BACKPACK, 'Chest', A.pack, x, (y0 + y1) / 2, (z0 + z1) / 2, 0.042, Math.hypot(dy, dz) + 0.01, 0.01, Math.atan2(dz, dy), 0, 0); };
      for (const sd of [-1, 1]) {
        const x = chest.x + sd * 0.105;
        const top = body.top(x, chest.y + 0.02, chest.y + 0.32, chest.y + 0.18) + 0.005;
        const yF0 = chest.y - 0.13, yF1 = top - 0.035;
        const zF0 = body.front(x, yF0, chest.z + 0.1) + 0.006, zF1 = body.front(x, yF1, chest.z + 0.06) + 0.006;
        const zB1 = body.back(x, yF1 - 0.03, yF1 + 0.03, 0.02, chest.z - 0.08) - 0.006;
        const zT = (zF1 + zB1) / 2, yB0 = cy + 0.17, zB0 = back - 0.012;
        bar(yF0, zF0, yF1, zF1, x); bar(yF1, zF1, top, zT, x); bar(top, zT, yF1, zB1, x); bar(yF1, zB1, yB0, zB0, x);
      }
    }
    box(BIT.CART, 'Root', A.acc, 0, 0.5, 0.78, 0.5, 0.86, 0.62);
    box(BIT.CART, 'Root', A.dark, 0, 0.98, 0.5, 0.48, 0.035, 0.035);
    box(BIT.SUITCASE, 'Root', A.acc2, hC.x + 0.04, 0.33, hC.z - 0.2, 0.22, 0.56, 0.38, 0.25, 0, 0);
    box(BIT.SUITCASE, 'Root', A.dark, hC.x + 0.04, (0.62 + hC.y) / 2, hC.z - 0.04, 0.025, Math.max(0.1, hC.y - 0.6), 0.025, 0.25, 0, 0);
    // v8: staff apron that hugs the body (the v1 version was two rigid slabs at fixed offsets that floated off the profile, "weird
    // blocks"). A tapered bib on the chest's measured front surface (collarbone -> waist), a flared skirt on the hips / thigh front
    // (waist -> mid-thigh), a neck strap over the trapezius and a waist tie round to a back bow. Panels are thin slabs whose
    // vertices are pushed onto body.front(x, y) per grid point (1-3 cm proud, a little more at the hem), ~400 tris.
    {
      const yW = hips.y + 0.07, yHem = hips.y - 0.36, yTop = chest.y + 0.1;   // waist, hem (mid-thigh), bib top (below the collarbone)
      // foremost z at (x, y); the legs leave a gap at x = 0 below the crotch, so widen the search sideways until something is found
      const fz = (x, y, fb) => {
        for (const dx of [0, 0.03, -0.03, 0.06, -0.06, 0.09, -0.09]) for (const lv of [[0], [0.045, -0.045], [0.09, -0.09]]) {
          let r = null;   // the surface is sampled from mesh vertices (sparse on dresses / coats): the foremost one in a widening height window
          for (const dy of lv) { const q = body.front(x + dx, y + dy, null); if (q !== null && (r === null || q > r)) r = q; }
          if (r !== null) return r;
        }
        return fb;
      };
      // a slab panel from yA (top) to yB (bottom): half width hwA -> hwB, standing off the surface by offA -> offB, thick t
      const panel = (bone, yA, yB, hwA, hwB, offA, offB, fb, nx = 6, ny = 5, t = 0.009) => {
        const g = new THREE.BoxGeometry(1, 1, 1, nx, ny, 1), pp = g.attributes.position;
        const zs = [];   // surface z per grid point (smoothed along x so a stray vertex can't spike the panel)
        for (let j = 0; j <= ny; j++) {
          const v = j / ny, y = yA + (yB - yA) * v, hw = hwA + (hwB - hwA) * v, row = [];
          for (let i = 0; i <= nx; i++) row.push(fz((i / nx - 0.5) * 2 * hw, y, fb));
          zs.push(row);
        }
        // fill dents (a grid point lower than both neighbours along x or y = a vertex gap in the sampled surface: the cloth beneath
        // would poke through the panel), smooth along x, then stand the panel off the surface
        for (let pass = 0; pass < 2; pass++) for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
          let z = zs[j][i];
          if (i > 0 && i < nx) z = Math.max(z, Math.min(zs[j][i - 1], zs[j][i + 1]) - 0.008);
          if (j > 0 && j < ny) z = Math.max(z, Math.min(zs[j - 1][i], zs[j + 1][i]) - 0.008);
          zs[j][i] = z;
        }
        // cloth is convex: no point of a row may sit far behind that row's foremost central sample (missed centre vertices)
        for (let j = 0; j <= ny; j++) { const row = zs[j]; let zc = -Infinity; for (let i = 0; i <= nx; i++) if (Math.abs(i / nx - 0.5) <= 0.26) zc = Math.max(zc, row[i]); for (let i = 0; i <= nx; i++) { const e = (i / nx - 0.5) * 2; row[i] = Math.max(row[i], zc - 0.035 * e * e); } }
        for (let j = 0; j <= ny; j++) { const row = zs[j], v = j / ny; zs[j] = row.map((z, i) => (row[Math.max(0, i - 1)] + 2 * z + row[Math.min(nx, i + 1)]) / 4 + offA + (offB - offA) * v); }
        for (let k = 0; k < pp.count; k++) {
          const u = pp.getX(k) + 0.5, v = 0.5 - pp.getY(k), side = Math.sign(pp.getZ(k));
          const i = Math.round(u * nx), j = Math.round(v * ny), hw = hwA + (hwB - hwA) * v;
          pp.setXYZ(k, hips.x + (u - 0.5) * 2 * hw, yA + (yB - yA) * v, zs[j][i] + side * t / 2);
        }
        g.computeVertexNormals();
        parts.push({ bit: BIT.APRON, bone, mat: A.acc2, g, c: [0, 0, 0], r: [0, 0, 0] });
        return zs;
      };
      const zb = panel('Chest', yTop, yW + 0.03, 0.105, 0.155, 0.016, 0.02, chest.z + chestZ, 4, 3);        // bib
      const zk = panel('Hips', yW + 0.005, yHem, 0.168, 0.205, 0.022, 0.03, hips.z + hipZ, 8, 6);            // skirt (flared)
      // waist tie: a band across the skirt top, side ties round the flanks to a back bow
      const bw = (x, y, o) => v3(x, y, fz(x, y, hips.z + hipZ) + o);
      const wb = yW - 0.012;
      for (let i = 0; i < 2; i++) { const x0 = -0.17 + i * 0.17, x1 = x0 + 0.17; seg(BIT.APRON, 'Hips', A.acc2, bw(x0, wb, 0.024), bw(x1, wb, 0.024), 0.022, 0.012, v3(0, 0, 1)); }
      for (const sd of [-1, 1]) {
        const sx = hips.x + sd * 0.175, bk = body.back(0, wb - 0.04, wb + 0.04, 0.12, hips.z - 0.11) - 0.008;
        const fzS = fz(sd * 0.17, wb, hips.z + hipZ - 0.05);
        seg(BIT.APRON, 'Hips', A.acc2, bw(sd * 0.17, wb, 0.024), v3(sx + sd * 0.004, wb, (fzS + bk) / 2 + 0.006), 0.02, 0.012, v3(sd, 0, 0));
        seg(BIT.APRON, 'Hips', A.acc2, v3(sx + sd * 0.004, wb, (fzS + bk) / 2 + 0.006), v3(sd * 0.05, wb, bk), 0.02, 0.012, v3(0, 0, -1));
        seg(BIT.APRON, 'Hips', A.acc2, v3(sd * 0.04, wb, bk), v3(sd * 0.075, wb - 0.11, bk - 0.01), 0.026, 0.01, v3(0, 0, -1));   // bow tail
      }
      // neck strap: bib corner -> up the chest to the collar -> over the trapezius -> across the back of the neck
      const bar = (a, b, side) => seg(BIT.APRON, 'Chest', A.acc2, a, b, 0.024, 0.008, side);
      const nT = body.top(0.06, chest.y + 0.02, chest.y + 0.32, chest.y + 0.18) + 0.004;
      const sFront = (x, y) => v3(x, y, fz(x, y, chest.z + chestZ) + 0.009);
      const bkNeck = body.back(0.05, nT - 0.05, nT, 0.03, chest.z - 0.08) - 0.007;
      const pts = [];
      for (const sd of [-1, 1]) {
        const cF = sFront(sd * 0.1, yTop + 0.005), nF = sFront(sd * 0.055, nT - 0.045);
        const ovr = v3(sd * 0.058, nT, (nF.z + bkNeck) / 2), nB = v3(sd * 0.055, nT - 0.03, bkNeck);
        bar(cF, nF, v3(0, 0, 1)); bar(nF, ovr, v3(0, 1, 0)); bar(ovr, nB, v3(0, 1, 0)); pts.push(nB);
      }
      seg(BIT.APRON, 'Chest', A.acc2, pts[0], pts[1], 0.024, 0.008, v3(0, 0, -1));
    }
    // head (bind pose == idle pose for the head shape; author around the idle head)
    const hz = this._frontZ(rig, headB.y + 0.08, true);
    // polish: a baseball cap = a soft dome crown (hemisphere) + a curved-down front brim + a top button (~110 tris), not a slab
    {
      const cy = headB.y + 0.205, cz = headB.z - 0.006;
      const crown = new THREE.SphereGeometry(1, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2); crown.scale(0.12, 0.1, 0.132);
      parts.push({ bit: BIT.CAP, bone: 'Head', mat: A.cap, g: crown, c: [headB.x, cy, cz], r: [0, 0, 0] });
      const brim = new THREE.CylinderGeometry(1, 1, 0.01, 10, 1, false, -Math.PI / 2, Math.PI); brim.scale(0.108, 1, hz * 0.5 + 0.16);
      parts.push({ bit: BIT.CAP, bone: 'Head', mat: A.cap, g: brim, c: [headB.x, cy + 0.006, cz + 0.01], r: [0.2, 0, 0] });
      cyl(BIT.CAP, 'Head', A.cap, headB.x, cy + 0.102, cz, 0.012, 0.012);
    }
    box(BIT.MASK, 'Head', A.white, headB.x, headB.y + 0.055, headB.z + hz + 0.012, 0.12, 0.075, 0.03);
    // to bind space
    const out = [];
    const mInv = new THREE.Matrix4(), mOne = new THREE.Matrix4(), e = new THREE.Euler();
    for (const p of parts) {
      const bi = rig.boneIdx[p.bone]; if (bi === undefined) continue;
      const g = p.g.index ? p.g.toNonIndexed() : p.g; g.deleteAttribute('uv');   // RoundedBoxGeometry is already non-indexed
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
  // Idle-pose body surface samples (every non-backpacker outfit, each vertex moved by its dominant bone; hair / head excluded),
  // used to put straps and packs ON the clothes: back(x, y0, y1, halfWidth) = rearmost z, front(x, y) = foremost z,
  // top(x, y0, y1) = highest point (shoulder line). Fallbacks when nothing is found.
  _bodyPts(rig, meshes) {
    const S = rig.sampler, pts = [];
    const mats = S.bones.map((b, i) => new THREE.Matrix4().multiplyMatrices(b.matrixWorld, rig.boneInverses[i]));
    const skipB = new Set(['Head', 'Neck'].map(n => rig.boneIdx[n]).filter(i => i !== undefined));
    const v = new THREE.Vector3();
    for (const name of VARIANTS[rig.g] || []) {
      const m = meshes[name]; if (!m || name.endsWith('Backpacker')) continue;
      const P = m.geometry.attributes.position, I = m.geometry.attributes.skinIndex, W = m.geometry.attributes.skinWeight;
      for (let i = 0; i < P.count; i++) {
        let bi = I.getX(i), bw = W.getX(i);
        for (const k of [1, 2, 3]) { const w = W.getComponent(i, k); if (w > bw) { bw = w; bi = I.getComponent(i, k); } }
        if (skipB.has(bi)) continue;
        v.fromBufferAttribute(P, i).applyMatrix4(mats[bi]);
        pts.push(v.x, v.y, v.z);
      }
    }
    const scan = (test, pick, init) => { let r = init; for (let i = 0; i < pts.length; i += 3) if (test(pts[i], pts[i + 1], pts[i + 2])) r = pick(r, pts[i], pts[i + 1], pts[i + 2]); return r; };
    return {
      back: (x, y0, y1, hw, fb) => { const r = scan((px, py) => Math.abs(px - x) < hw && py > y0 && py < y1, (r, px, py, pz) => Math.min(r, pz), Infinity); return isFinite(r) ? r : fb; },
      front: (x, y, fb) => { const r = scan((px, py) => Math.abs(px - x) < 0.025 && Math.abs(py - y) < 0.04, (r, px, py, pz) => Math.max(r, pz), -Infinity); return isFinite(r) ? r : fb; },
      top: (x, y0, y1, fb) => { const r = scan((px, py, pz) => Math.abs(px - x) < 0.02 && py > y0 && py < y1 && Math.abs(pz) < 0.06, (r, px, py) => Math.max(r, py), -Infinity); return isFinite(r) ? r : fb; },
    };
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
  { name: 'phone', color: '#5d6168', tint: TINT.KEEP },
  { name: 'pack', color: '#3a3f48', tint: TINT.PACK },     // backpack: muted palette pick (shader crowdColour)
  { name: 'case', color: '#2b1c13', tint: TINT.CASE },     // briefcase: black / dark brown leather
  { name: 'cord', color: '#3a2a1e', tint: TINT.CORD },     // paper-bag handles: contrast with the bag
  { name: 'screen', color: '#a9c4ea', tint: TINT.SCREEN }, // polish: phone screen, faintly self-lit (cool white-blue)
  { name: 'cap', color: '#222222', tint: TINT.CAP },       // polish: cap = the person's acc2 colour, muted
];
const ACC_IDX = { acc: 0, acc2: 1, dark: 2, white: 3, cup: 4, phone: 5, pack: 6, case: 7, cord: 8, screen: 9, cap: 10 };

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
varying float vCrowdGlow;
float crowdGlow() { return int(crMat[int(aMat + 0.5)].w + 0.5) == 12 ? 1.0 : 0.0; }
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
  if (t == 12) return m.rgb;
  if (t == 13) { vec3 a = crowdUnpack(cB.w); return mix(vec3(dot(a, vec3(0.2126, 0.7152, 0.0722))), a, 0.55) * 0.8; }   // cap: muted
  if (t >= 9) {
    // per-person pick from a small palette (stable: hashed from the person's colours)
    float h = fract(cA.x * 0.000131 + cB.x * 0.000097 + cA.w * 0.000071 + cA.y * 0.000053);
    vec3 a = crowdUnpack(cB.z);
    if (t == 9) {   // backpack: keep a clearly coloured bag (tourist red ...), else navy / olive / grey / beige / slate
      if (max(a.r, max(a.g, a.b)) - min(a.r, min(a.g, a.b)) > 0.06) return a * 0.8;
      int k = int(h * 5.0);
      vec3 c = k == 0 ? vec3(0.165, 0.204, 0.314) : k == 1 ? vec3(0.31, 0.325, 0.22) : k == 2 ? vec3(0.36, 0.37, 0.39) : k == 3 ? vec3(0.63, 0.56, 0.45) : vec3(0.2, 0.24, 0.27);
      return pow(c, vec3(2.2));
    }
    if (t == 10) {  // briefcase: the person's bag colour if it is dark, else black or dark brown leather
      if (dot(a, vec3(0.2126, 0.7152, 0.0722)) < 0.05) return a;
      return h < 0.5 ? vec3(0.0075) : pow(vec3(0.24, 0.15, 0.09), vec3(2.2));
    }
    vec3 b = crowdUnpack(cB.w);   // 11: paper-bag cord, contrasting with the bag
    return dot(b, vec3(0.2126, 0.7152, 0.0722)) > 0.2 ? pow(vec3(0.3, 0.22, 0.15), vec3(2.2)) : vec3(0.75, 0.73, 0.68);
  }
  return crowdUnpack(cB.w);
}
// v4 hotfix ROOT CAUSE of "no phone / bag / briefcase on anybody": the old code did int(crMask + 0.5). crMask is 0xffffff
// (16777215) for every outfit but the backpackers; 16777215.5 is not a float32, it rounds (ties-to-even) to 16777216 = 1 << 24,
// so the mask became 0 in bits 0..23 and EVERY accessory was collapsed (near and far). Flags / masks are exact integers in
// float32 (<= 2^24): convert with round(), never by adding 0.5.
bool crowdHidden(float flags) {
  int p = int(round(aPart));
  if (p == 0) return false;
  int f = int(round(flags)) & int(round(crMask));
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
vCrowdGlow = crowdGlow();
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
  vCrowdGlow = crowdGlow();
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
varying float vCrowdGlow;
`;
// polish: a phone screen is a dim diffuse surface plus a low self-glow, so it reads as a lit phone against a dark suit
const FRAG_GLOW = /* glsl */`
#include <emissivemap_fragment>
totalEmissiveRadiance += vCrowdCol * (0.55 * vCrowdGlow);
`;
const FRAG_COLOR = /* glsl */`
  diffuseColor.rgb *= vCrowdCol * (1.0 - 0.7 * vCrowdGlow);
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
    sh.fragmentShader = FRAG_HEAD + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG_COLOR).replace('#include <emissivemap_fragment>', FRAG_GLOW);
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
    sh.fragmentShader = FRAG_HEAD + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG_COLOR).replace('#include <emissivemap_fragment>', FRAG_GLOW);
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
    sh.fragmentShader = FRAG_HEAD + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG_COLOR).replace('#include <emissivemap_fragment>', FRAG_GLOW);
  };
  m.customProgramCacheKey = () => blend ? 'namba_people_far_blend_v1' : 'namba_people_far_v1';
  m.name = blend ? 'crowd_people_far_fade' : 'crowd_people_far';
  return m;
}
