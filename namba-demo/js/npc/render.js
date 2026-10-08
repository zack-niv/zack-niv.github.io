// =============================================================================
// Crowd rendering v2: rigged glTF people (humans.js), hybrid LOD.
//
//   near  the closest ~32 people on screen (inside ~16 m): SkinnedMesh clones
//         (SkeletonUtils.clone of an outfit template) with an AnimationMixer;
//         head turns towards what they look at, kids get a bigger head.
//   far   everyone else inside the draw distance: GPU-skinned instanced
//         meshes (bone texture baked from the very same clips), one draw call
//         per outfit and LOD (30% mesh to ~34 m, 10% mesh beyond).
//   fade  people fading in / out (spawns, exits, boarding) are drawn through
//         alpha-blended twins of the far meshes; a person crossing the
//         near/far boundary is drawn both ways for ~0.3 s while the near
//         version cross-fades (same clip, same clip time => no pop).
//   blobs one instanced draw of soft contact / sun shadows (as v1).
//
// Every visible person carries an animation state (clip, clip time, previous
// clip + blend weight). Locomotion clips play at speed / natural clip speed
// (measured from the planted foot), so feet do not slide.
// =============================================================================
import * as THREE from 'three';
import { buildBlob } from './humanGeo.js';
import { makeBlobMaterial } from './humanMat.js';
import { POSE } from './sim.js';
import { BIT } from './looks.js';
import { variantFor, makeNearMaterial, twinNearMaterial, makeFarMaterial, CLIP_IDS, LOCO, SEAT_BODY, SEAT_CLIPS } from './humans.js';

const FAR_CAP = 320, FADE_CAP = 64;
const TIERS = {
  low: { near: 8, nearD: 9, lod1D: 18 },
  medium: { near: 18, nearD: 13, lod1D: 26 },
  high: { near: 32, nearD: 16, lod1D: 34 },
  ultra: { near: 44, nearD: 20, lod1D: 44 },
};
const PHONE_CLIPS = new Set(['phone', 'phonewalk', 'photo', 'sitphone', 'sitphone2']);   // clips with a hand up at a phone ('browse' reaches for a shelf: no phone)
const XFADE = 0.3;   // near <-> far hand-over (s)
const BLEND = 0.28;  // clip cross-fade (s)
const HEAD_YAW_MAX = 70 * Math.PI / 180, HEAD_PITCH_MAX = 25 * Math.PI / 180, HEAD_RATE = Math.PI;   // head look limits: +-70 / +-25 deg, 180 deg/s
const wrapA = (a) => { a = a % (2 * Math.PI); return a > Math.PI ? a - 2 * Math.PI : a < -Math.PI ? a + 2 * Math.PI : a; };
const ATTRS = ['iPos', 'iAnim', 'iColA', 'iColB', 'iMisc'];

export class CrowdRenderer {
  constructor(ctx, sim, lib) {
    this.ctx = ctx; this.sim = sim; this.lib = lib;
    this.stats = { lod: [0, 0, 0], blobs: 0, ms: 0, tris: 0, near: 0, slots: 0 };
    this.tier = TIERS.high;
  }

  init() {
    const scene = this.ctx.engine.scene;
    this.group = new THREE.Group(); this.group.name = 'crowd';
    scene.add(this.group);
    // outfits (a rig may stand in for both genders)
    const seen = new Set(); this.variants = [];
    for (const g of ['m', 'f']) { const rig = this.lib.rigs[g]; if (!rig || seen.has(rig)) continue; seen.add(rig); for (const v of Object.values(rig.variants)) this.variants.push(v); }
    for (const v of this.variants) {
      v.far = [null, this._farMesh(v, 1, false), this._farMesh(v, 2, false)];
      v.fade = [null, this._farMesh(v, 1, true), this._farMesh(v, 2, true)];
      v.pool = [];
    }
    this.slots = [];
    // warm-up: one near person of each material kind so the shared programs are precompiled with the scene
    this._warm = [];
    for (const blend of [false, true]) { const s = this._newSlot(this.variants[0]); s.mesh.material = blend ? s.matF : s.matO; s.root.position.set(0, -500, 0); s.root.visible = true; this._warm.push(s); }
    // blob shadows (v1)
    const bg = new THREE.InstancedBufferGeometry();
    const bb = buildBlob();
    bg.setIndex(bb.getIndex()); bg.setAttribute('position', bb.getAttribute('position')); bg.setAttribute('uv', bb.getAttribute('uv'));
    const bcap = 1200;
    this.blobA = new THREE.InstancedBufferAttribute(new Float32Array(bcap * 4), 4); this.blobA.setUsage(THREE.DynamicDrawUsage);
    this.blobB = new THREE.InstancedBufferAttribute(new Float32Array(bcap * 4), 4); this.blobB.setUsage(THREE.DynamicDrawUsage);
    bg.setAttribute('iBlob', this.blobA); bg.setAttribute('iBlobB', this.blobB);
    bg.instanceCount = 0; bg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.blobMesh = new THREE.Mesh(bg, makeBlobMaterial());
    this.blobMesh.frustumCulled = false; this.blobMesh.renderOrder = 1; this.blobMesh.name = 'crowd_blobs';
    this.blobCap = bcap;
    this.group.add(this.blobMesh);
    this._frustum = new THREE.Frustum(); this._m = new THREE.Matrix4();
    this._list = [];
    this._q = new THREE.Quaternion(); this._q2 = new THREE.Quaternion(); this._v = new THREE.Vector3();
    this._Y = new THREE.Vector3(0, 1, 0);
    this._P = new THREE.Quaternion(); this._R = new THREE.Quaternion(); this._ax = new THREE.Vector3();
    this._frame = 0;
  }
  setVisible(v) { if (this.group) this.group.visible = v; }

  _farMesh(v, lod, blend) {
    const base = v.geos[lod];
    const g = new THREE.InstancedBufferGeometry();
    for (const k of ['position', 'normal', 'skinIndex', 'skinWeight', 'aMat', 'aPart']) g.setAttribute(k, base.getAttribute(k));
    g.setIndex(base.getIndex());
    const cap = blend ? FADE_CAP : FAR_CAP;
    const attrs = {};
    for (const name of ATTRS) {
      const at = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
      at.setUsage(THREE.DynamicDrawUsage); g.setAttribute(name, at); attrs[name] = at;
    }
    g.instanceCount = 0;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const mesh = new THREE.Mesh(g, makeFarMaterial(v, blend));
    mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = true;
    if (blend) mesh.renderOrder = 2;
    mesh.name = `crowd_${v.name}_lod${lod}${blend ? '_fade' : ''}`;
    this.group.add(mesh);
    return { g, mesh, attrs, cap, n: 0, tris: base.index.count / 3 };
  }

  _newSlot(v) {
    const s = this.lib.makeNear(v);
    s.matO = makeNearMaterial(v, false);
    s.matF = twinNearMaterial(v, s.matO, true);
    s.U = s.matO.userData.crowd;
    s.mesh.material = s.matO;
    s.root.visible = false;
    s.agent = null; s.alpha = 0; s.out = false; s.on = new Set();
    this.group.add(s.root);
    this.slots.push(s);
    return s;
  }
  _takeSlot(v) {
    const s = v.pool.pop() || this._newSlot(v);
    s.alpha = 0; s.out = false; s.root.visible = true;
    return s;
  }
  _freeSlot(s) {
    if (s.agent && s.agent._slot === s) s.agent._slot = null;
    s.agent = null; s.root.visible = false;
    for (const id of s.on) s.actions[id].enabled = false;
    s.on.clear();
    s.variant.pool.push(s);
  }

  // ---------------------------------------------------------------------------
  update(dt) {
    const t0 = performance.now();
    this._frame++;
    if (this._warm.length && this._frame > 2) { for (const s of this._warm) { s.root.visible = false; s.mesh.material = s.matO; s.variant.pool.push(s); } this._warm.length = 0; }
    const { engine } = this.ctx;
    this.tier = TIERS[engine.qualityName] || TIERS.high;
    const cam = engine.camera;
    cam.updateMatrixWorld();
    this._m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._m);
    const planes = this._frustum.planes;
    const cx = cam.position.x, cy = cam.position.y, cz = cam.position.z;
    const drawD = (engine.quality && engine.quality.drawDist) || 200;
    const dd2 = drawD * drawD;
    const levels = engine.levels || {};
    const S = this.sim, A = S.agents, simT = S.time;
    const ramps = S.places.ramps;
    const list = this._list; list.length = 0;
    for (let i = 0; i < A.length; i++) {
      const a = A[i];
      if (!a.alive || a.fade <= 0.01) { if (a._slot) this._release(a); continue; }
      const root = levels[a.level];
      let vis = !root || root.visible !== false;
      if (!vis && a.ramp >= 0) { const up = levels[ramps[a.ramp].r.upper]; vis = !up || up.visible !== false; }
      let x = a.x, z = a.z;
      if (vis && a.tier > 0 && a.mode !== 3) { const age = Math.min(0.25, simT - a.lastUpd); x += a.vx * age; z += a.vz * age; }
      const y = a.y;
      const dx = x - cx, dy = y + 0.9 - cy, dz = z - cz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (vis && d2 > dd2) vis = false;
      if (vis) for (let p = 0; p < 6; p++) { const pl = planes[p]; if (pl.normal.x * x + pl.normal.y * (y + 0.9) + pl.normal.z * z + pl.constant < -1.2) { vis = false; break; } }
      if (!vis) { if (a._slot) this._release(a); continue; }
      a._rx = x; a._rz = z; a._d2 = d2;
      list.push(a);
    }
    list.sort((p, q) => p._d2 - q._d2);
    // near set: nearest first, with hysteresis for those already near
    const T = this.tier, nd2 = T.nearD * T.nearD, ndOut = (T.nearD + 2) * (T.nearD + 2);
    let nNear = 0;
    for (let k = 0; k < list.length; k++) {
      const a = list[k];
      this._look(a);
      this._anim(a, dt);
      const want = nNear < T.near && (a._d2 < (a._slot ? ndOut : nd2));
      if (want) {
        nNear++;
        if (!a._slot) { const s = this._takeSlot(a._v); s.agent = a; a._slot = s; s.alpha = this._frame < 3 ? 1 : 0; }
        else if (a._slot.variant !== a._v) { this._release(a, true); const s = this._takeSlot(a._v); s.agent = a; a._slot = s; s.alpha = 1; }
        a._slot.out = false;
      } else if (a._slot && !a._slot.out) a._slot.out = true;
    }
    // far instances
    const V = this.variants;
    for (const v of V) { v.far[1].n = v.far[2].n = v.fade[1].n = v.fade[2].n = 0; }
    const l1 = T.lod1D * T.lod1D;
    let nb = 0;
    const BA = this.blobA.array, BB = this.blobB.array;
    const lighting = this.ctx.lighting, sunO = this.ctx.exterior && this.ctx.exterior.sun;
    let sunI = 0, shX = 0, shZ = 1, shL = 1;
    if (sunO && sunO.direction && sunO.direction.y > 0.05) {
      const d = sunO.direction; sunI = Math.min(1, sunO.intensity || 0);
      const hl = Math.hypot(d.x, d.z) || 1; shX = -d.x / hl; shZ = -d.z / hl; shL = hl / d.y;
    }
    let nearN = 0, l1n = 0, l2n = 0, tris = 0;
    for (let k = 0; k < list.length; k++) {
      const a = list[k], s = a._slot;
      // the near version replaces the far one once it is fully faded in
      if (s) {
        s.alpha = s.out ? Math.max(0, s.alpha - dt / XFADE) : Math.min(1, s.alpha + dt / XFADE);
        if (s.out && s.alpha <= 0) { this._release(a); }
      }
      const s2 = a._slot;
      if (s2) { this._near(s2, a, dt); nearN++; tris += s2.variant.tris[0]; }
      if (!s2 || s2.alpha < 1 || s2.out) {
        const lod = a._d2 < l1 ? 1 : 2;
        const v = a._v;
        const set = a.fade < 0.999 ? v.fade[lod] : v.far[lod];
        if (set.n < set.cap) { this._write(set, set.n++, a); if (lod === 1) l1n++; else l2n++; tris += v.tris[lod]; }
      }
      // blobs
      if (nb < this.blobCap && a._d2 < 60 * 60) {
        const o = nb * 4, h = a.look ? a.look.h : 1;
        const sitting = !!SEAT_CLIPS[a._ac];
        BA[o] = a._rx; BA[o + 1] = a.y; BA[o + 2] = a._rz; BA[o + 3] = (sitting ? 0.7 : 0.56) * h;
        BB[o] = a.fade * (a.ramp >= 0 ? 0.6 : 0.9); BB[o + 1] = 1.25; BB[o + 2] = a.yaw; BB[o + 3] = 0;
        nb++;
        if (sunI > 0.12 && a._d2 < 45 * 45 && nb < this.blobCap) {
          if (((this._frame + a.serial) & 7) === 0 || a._sunV === undefined) a._sunV = lighting && lighting.sample ? lighting.sample(a.level, a._rx, a._rz).sun : 0;
          if (a._sunV > 0.2) {
            const o3 = nb * 4, len = Math.min(3.8 * h, 1.5 * h * shL), wid = 0.5 * h;
            BA[o3] = a._rx + shX * (len * 0.5 - 0.1); BA[o3 + 1] = a.y; BA[o3 + 2] = a._rz + shZ * (len * 0.5 - 0.1); BA[o3 + 3] = wid;
            BB[o3] = a.fade * Math.min(0.7, 0.8 * a._sunV * sunI); BB[o3 + 1] = len / wid; BB[o3 + 2] = Math.atan2(shX, shZ); BB[o3 + 3] = 0;
            nb++;
          }
        }
      }
    }
    for (const v of V) for (const set of [v.far[1], v.far[2], v.fade[1], v.fade[2]]) {
      set.g.instanceCount = set.n; set.mesh.visible = set.n > 0;
      if (set.n) for (const name of ATTRS) { const at = set.attrs[name]; at.clearUpdateRanges(); at.addUpdateRange(0, set.n * 4); at.needsUpdate = true; }
    }
    this.blobMesh.geometry.instanceCount = nb;
    if (nb) for (const at of [this.blobA, this.blobB]) { at.clearUpdateRanges(); at.addUpdateRange(0, nb * 4); at.needsUpdate = true; }
    const st = this.stats;
    st.lod[0] = nearN; st.lod[1] = l1n; st.lod[2] = l2n; st.blobs = nb; st.tris = tris; st.slots = this.slots.length;
    st.ms = performance.now() - t0;
  }

  _release(a) {
    const s = a._slot; if (!s) return;
    a._slot = null;
    this._freeSlot(s);
  }

  // outfit + scale for this person's look (cached; a new look object re-resolves, e.g. Aya)
  _look(a) {
    if (a._lookRef === a.look && a._v) return;
    const lk = a.look;
    const { g, v } = variantFor(lk, a.kind);
    const rig = this.lib.rigs[g];
    a._v = rig.variants[v] || Object.values(rig.variants)[0];
    a._rig = a._v.rig;
    a._lookRef = lk;
    a._sc = lk.h * 1.7 / a._rig.height;
    const kid = (lk.flags >> BIT.KID) & 1;
    a._wsc = kid ? 0.92 : Math.max(0.88, Math.min(1.14, 1 + (lk.build - (lk.female ? 0.93 : 1.02)) * 0.8));
    // clothes must never read as bare skin: a top / bottom too close to the skin tone gets a darker shade
    a._colA = lk.colA.slice(); a._colB = lk.colB.slice();
    const skin = lk.colB[0];
    for (const k of [0, 1]) if (colDist(a._colA[k], skin) < 70) a._colA[k] = shade(a._colA[k], 0.55);
    if (a._slot && a._slot.variant !== a._v) this._release(a);
  }

  // ---------------------------------------------------------------------------
  // animation state machine (same for near and far)
  _clipFor(a) {
    const riding = a.ramp >= 0;
    const R = riding ? this.sim.places.ramps[a.ramp] : null;
    let spd = a.spd;
    // v5: boardK (0 -> 1 over ~0.55 s after stepping on) blends the walk into the ride: a stander keeps walking until boardK 0.4, then the
    // ride clip cross-fades in (BLEND); a walker's foot speed slides from its ground speed to the speed relative to the belt
    const bk = riding && a.boardK !== undefined ? a.boardK : 1;
    if (riding && R.esc) {
      const g = a.curRideSpd != null ? a.curRideSpd : a.rspd;
      spd = a.walkLane ? g + (Math.max(0, g - 0.5) - g) * bk : (bk < 0.4 ? a.spd : 0);
    }
    let pose = a.pose;
    if (riding && R.esc && !a.walkLane && bk >= 0.4) pose = a.phoneUser > 0.55 ? POSE.PHONE : POSE.RIDE;
    if (riding && (R.stairs || a.walkLane)) pose = POSE.WALK;
    const flags = a.flags | a.dyn;
    const moving = spd > 0.18;
    a._spd = spd;
    const loco = () => {
      if (flags & (1 << BIT.CART)) return 'cart';
      if (flags & (1 << BIT.SUITCASE)) return 'walkcase';
      if (flags & (1 << BIT.PHONE) && a.phoneWalk) return 'phonewalk';
      return spd > 2.5 ? 'run' : 'walk';
    };
    switch (pose) {
      case POSE.WALK: case POSE.CART: return moving ? loco() : ((flags & (1 << BIT.SUITCASE)) ? 'idlecase' : 'idle');
      case POSE.PHONE: return moving ? 'phonewalk' : 'phone';
      case POSE.SIT: case POSE.EAT: {
        // v4: a seated clip only ever plays on a real seat (a.seatH); anything else stands instead of showing a broken sit
        if (!a.seatH) return moving ? loco() : 'idle';
        const base = pose === POSE.EAT ? 'eat' : a.seatPhone ? 'sitphone' : 'sit';
        return a.seatStool ? base + '2' : base;
      }
      case POSE.RIDE: return 'ride';
      case POSE.WAVE: return 'wave';
      case POSE.PHOTO: return 'photo';
      case POSE.LOOKUP: return moving ? loco() : 'lookup';
      case POSE.BOW: return 'bow';
      case POSE.NOD: return 'nod';
      case POSE.SERVE: return 'interact';
      case POSE.BROWSE: return moving ? loco() : 'browse';
      case POSE.TALK: return moving ? loco() : 'idle2';
      default: return moving ? loco() : ((flags & (1 << BIT.SUITCASE)) ? 'idlecase' : ((a.serial % 5) === 0 ? 'idle2' : 'idle'));
    }
  }
  // v4: accessory / variant flags actually drawn. The phone prop follows the CLIP, not the behaviour flags (which several code paths
  // forgot to set: escalator riders, hesitating tourists, seat-phone users...): whenever a phone-looking clip plays (or is still
  // blending out) the phone is in the hand; near and far LOD both use this, so they always agree.
  _flags(a) {
    let f = (a.flags | a.dyn) & 0xffffff;
    const c = a._ac;
    if (PHONE_CLIPS.has(c) || (a._ap && a._aw < 0.6 && PHONE_CLIPS.has(a._ap))) f |= 1 << BIT.PHONE;
    return f;
  }
  _rate(a, id) {
    const info = a._rig.info[id];
    if (LOCO[id]) {
      const nat = (id === 'run' ? info.speed : a._rig.info.walk.speed) * a._sc;
      return Math.max(0.4, Math.min(1.9, a._spd / Math.max(0.3, nat)));
    }
    return 0.92 + ((a.serial * 37) % 17) / 100;
  }
  _anim(a, dt) {
    const id = this._clipFor(a);
    const rig = a._rig;
    if (a._ac === undefined || a._arig !== rig) { a._arig = rig; a._ac = id; a._at = ((a.serial * 0.618) % 1) * rig.info[id].dur; a._ap = null; a._aw = 1; }
    if (id !== a._ac) {
      a._ap = a._ac; a._apt = a._at; a._aprate = a._arate || 1;
      a._ac = id; a._aw = 0;
      // locomotion keeps its phase when switching between walk-like clips (feet stay in step)
      if (LOCO[id] && LOCO[a._ap]) a._at = (a._apt / rig.info[a._ap].dur) * rig.info[id].dur;
      else a._at = (id === 'bow' || id === 'nod' || id === 'wave' || id === 'interact') ? 0 : ((a.serial * 0.37) % 1) * rig.info[id].dur;
    }
    a._arate = this._rate(a, id);
    const d = rig.info[a._ac].dur;
    a._at = (a._at + dt * a._arate) % d;
    if (a._ap) {
      a._aw = Math.min(1, a._aw + dt / BLEND);
      if (a._aw >= 1) a._ap = null;
      else { const pd = rig.info[a._ap].dur; a._apt = (a._apt + dt * a._aprate) % pd; }
    }
    // head look (near version only draws it): target relative to the BODY, wrapped to [-pi, pi], clamped to
    // +-70 deg yaw / +-25 deg pitch, then smoothed and rate-limited (<= 180 deg/s). Never accumulates.
    const dh = dt > 0.1 ? 0.1 : dt;
    let ty = a.lookYaw, tp = a.lookPitch;
    if (a.lookT > 0 && a.lookAbs !== undefined && a.lookRel === a.lookYaw) ty = a.lookAbs - a.yaw;   // keep looking at the spot while the body turns
    ty = isFinite(ty) ? wrapA(ty) : 0; tp = isFinite(tp) ? tp : 0;
    ty = ty > HEAD_YAW_MAX ? HEAD_YAW_MAX : ty < -HEAD_YAW_MAX ? -HEAD_YAW_MAX : ty;
    tp = tp > HEAD_PITCH_MAX ? HEAD_PITCH_MAX : tp < -HEAD_PITCH_MAX ? -HEAD_PITCH_MAX : tp;
    a.pHY = this._ease(isFinite(a.pHY) ? a.pHY : 0, ty, dh);
    a.pHP = this._ease(isFinite(a.pHP) ? a.pHP : 0, tp, dh);
    // a seat seated before its shop's furniture existed (initial fill): measure it the first time somebody can see it
    if (a.seatH && a.spot && a.spot.real && a.spot.scan !== 2 && a._d2 < 900 && a.biz) {
      const r = this.sim.places._scanSeat(a.biz, a.spot);
      if (r !== null) {
        a.spot.scan = 2;
        if (r === false) { a.spot.bad = true; a.seatH = 0; a.pose = POSE.STAND; }   // no furniture there: stand rather than hover
        else { a.seatH = a.spot.h; a.seatStool = !!a.spot.stool; if (a.spot.sx !== undefined) { a.x = a.spot.sx; a.z = a.spot.sz; } }
      }
    }
    // seated: the clip's pelvis sits at its design seat height (SEAT_BODY); lift / lower the person so it lands on the REAL seat top
    const kind = SEAT_CLIPS[a._ac];
    const tgt = kind && a.seatH ? a.seatH + 0.005 - a._sc * SEAT_BODY[kind] : 0;
    a._dy = a._dy === undefined ? tgt : a._dy + (tgt - a._dy) * Math.min(1, dh * 8);
  }
  _ease(cur, tgt, dh) {
    let step = (tgt - cur) * (1 - Math.exp(-dh * 5));
    const m = HEAD_RATE * dh;
    step = step > m ? m : step < -m ? -m : step;
    return cur + step;
  }
  _frameOf(rig, id, t) {
    const I = rig.info[id];
    return I.start + Math.min(I.frames - 1, Math.floor(t / I.dur * I.frames));
  }

  _write(set, n, a) {
    const o = n * 4, at = set.attrs, lk = a.look, rig = a._rig;
    let p = at.iPos.array; p[o] = a._rx; p[o + 1] = a.y + (a._dy || 0); p[o + 2] = a._rz; p[o + 3] = a.yaw;
    p = at.iAnim.array;
    p[o] = this._frameOf(rig, a._ac, a._at);
    if (a._ap) { p[o + 1] = this._frameOf(rig, a._ap, a._apt); p[o + 2] = 1 - a._aw; } else { p[o + 1] = p[o]; p[o + 2] = 0; }
    p[o + 3] = a._sc;
    const cA = a._colA, cB = a._colB;
    p = at.iColA.array; p[o] = cA[0]; p[o + 1] = cA[1]; p[o + 2] = cA[2]; p[o + 3] = cA[3];
    p = at.iColB.array; p[o] = cB[0]; p[o + 1] = cB[1]; p[o + 2] = cB[2]; p[o + 3] = cB[3];
    p = at.iMisc.array; p[o] = a.fade; p[o + 1] = this._flags(a); p[o + 2] = a._wsc; p[o + 3] = 0;
  }

  // drive one near (skinned) person
  _near(s, a, dt) {
    const root = s.root, lk = a.look;
    root.position.set(a._rx, a.y + (a._dy || 0), a._rz);
    root.rotation.set(0, a.yaw + Math.PI, 0);
    root.scale.set(a._sc * a._wsc, a._sc, a._sc * a._wsc);
    const U = s.U;
    U.crColA.value.set(a._colA[0], a._colA[1], a._colA[2], a._colA[3]);
    U.crColB.value.set(a._colB[0], a._colB[1], a._colB[2], a._colB[3]);
    const alpha = Math.min(a.fade, s.alpha);
    U.crMisc.value.set(alpha, this._flags(a), 1, 0);
    s.mesh.material = alpha < 0.999 ? s.matF : s.matO;
    s.mesh.renderOrder = alpha < 0.999 ? 3 : 0;
    // actions: current (+ previous while blending)
    const cur = a._ac, prev = a._ap;
    for (const id of s.on) if (id !== cur && id !== prev) { s.actions[id].enabled = false; s.on.delete(id); }
    const ac = s.actions[cur];
    if (!s.on.has(cur)) { ac.enabled = true; ac.play(); s.on.add(cur); }
    ac.time = a._at; ac.setEffectiveWeight(prev ? a._aw : 1);
    if (prev) {
      const ap = s.actions[prev];
      if (!s.on.has(prev)) { ap.enabled = true; ap.play(); s.on.add(prev); }
      ap.time = a._apt; ap.setEffectiveWeight(1 - a._aw);
    }
    // Head look. THE BUG THIS REPLACES: the old code rotated the Neck / Head bones in place after the mixer had run.
    // AnimationMixer only writes a bone when its animated value CHANGED since last frame, so for any clip whose
    // Neck / Head track is constant (idle, phone, sit, ...) the previous frame's turn was still on the bone and the
    // next turn was added on top: the yaw integrated every frame (up to ~60 x lookYaw per second) = the head spun.
    // Now: put the bones back to the clean animated pose BEFORE the mixer runs (so it compares/writes against the
    // clean state), run the mixer, remember the clean pose, then apply the (clamped, smoothed) look on top of it.
    const neck = s.by.Neck, head = s.by.Head;
    if (s.hClean) { if (neck) neck.quaternion.copy(s.nClean); if (head) head.quaternion.copy(s.hClean); }
    s.mixer.update(0);
    if (head) { if (!s.hClean) { s.hClean = new THREE.Quaternion(); s.nClean = new THREE.Quaternion(); } s.hClean.copy(head.quaternion); if (neck) s.nClean.copy(neck.quaternion); }
    const yawH = a.pHY || 0, pitchH = a.pHP || 0;
    if (Math.abs(yawH) > 0.005 || Math.abs(pitchH) > 0.005) {
      this._look3(neck, s.root, yawH * 0.4, pitchH * 0.4);
      this._look3(head, s.root, yawH * 0.6, pitchH * 0.6);
    }
    // kids: bigger heads
    const kid = (lk.flags >> BIT.KID) & 1;
    if (head) head.scale.setScalar(kid ? 1.16 : 1);
  }
  // Rotate bone `b` about the person's up axis (yaw, + = towards their left) and right axis (pitch, + = up), given in the
  // root's frame (the root only turns about Y, so root-up == world-up). Uses local quaternions only (no matrix decomposition,
  // so the root's non-uniform build scale cannot shear it).
  _look3(b, root, yaw, pitch) {
    if (!b || !b.parent) return;
    const P = this._P, R = this._R, ax = this._ax;
    P.identity();
    for (let o = b.parent; o && o !== root; o = o.parent) P.premultiply(o.quaternion);   // parent's orientation in the root frame
    P.invert();
    R.identity();
    if (yaw) { ax.set(0, 1, 0).applyQuaternion(P); R.multiply(this._q.setFromAxisAngle(ax, yaw)); }
    if (pitch) { ax.set(-1, 0, 0).applyQuaternion(P); R.multiply(this._q.setFromAxisAngle(ax, pitch)); }   // model faces +Z: about -X tips the face up
    b.quaternion.premultiply(R);
  }

  dispose() {
    if (!this.group) return;
    this.group.parent && this.group.parent.remove(this.group);
    for (const v of this.variants) for (const set of [v.far[1], v.far[2], v.fade[1], v.fade[2]]) { set.g.dispose(); set.mesh.material.dispose(); }
  }
}

function colDist(a, b) {
  const dr = ((a >> 16) & 255) - ((b >> 16) & 255), dg = ((a >> 8) & 255) - ((b >> 8) & 255), db = (a & 255) - (b & 255);
  return Math.sqrt(dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11) * 1.7;
}
function shade(c, k) {
  const r = Math.round(((c >> 16) & 255) * k), g = Math.round(((c >> 8) & 255) * k), b = Math.round((c & 255) * k);
  return (r << 16) | (g << 8) | b;
}
