// =============================================================================
// Crowd rendering: 3 instanced LOD meshes (one draw call each) + 1 instanced
// blob-shadow draw. Instances are compacted every frame from agents that are
// alive, on a visible level, inside the draw distance and the view frustum.
// Pose parameters are smoothed here (only for visible agents).
// =============================================================================
import * as THREE from 'three';
import { buildHuman, buildBlob } from './humanGeo.js';
import { makeHumanMaterial, makeBlobMaterial, INSTANCE_ATTRS } from './humanMat.js';
import { POSE, MODE } from './sim.js';
import { BIT } from './looks.js';

const LOD_CAP = [240, 650, 1200];

export class CrowdRenderer {
  constructor(ctx, sim) {
    this.ctx = ctx; this.sim = sim;
    this.stats = { lod: [0, 0, 0], blobs: 0, ms: 0 };
    this.nearD = 18; this.midD = 60;
  }
  init() {
    const scene = this.ctx.engine.scene;
    this.group = new THREE.Group(); this.group.name = 'crowd';
    scene.add(this.group);
    this.mat = makeHumanMaterial();
    this.lods = [];
    for (let l = 0; l < 3; l++) {
      const base = buildHuman(l);
      const g = new THREE.InstancedBufferGeometry();
      for (const k of ['position', 'normal', 'aPart']) g.setAttribute(k, base.getAttribute(k));
      const cap = LOD_CAP[l];
      const attrs = {};
      for (const name of INSTANCE_ATTRS) {
        const arr = new Float32Array(cap * 4);
        const at = new THREE.InstancedBufferAttribute(arr, 4);
        at.setUsage(THREE.DynamicDrawUsage);
        g.setAttribute(name, at); attrs[name] = at;
      }
      g.instanceCount = 0;
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
      const mesh = new THREE.Mesh(g, this.mat);
      mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = true;
      mesh.name = 'crowd_lod' + l;
      this.group.add(mesh);
      this.lods.push({ g, mesh, attrs, cap, n: 0, tris: base.getAttribute('position').count / 3 });
    }
    // blob shadows
    const bg = new THREE.InstancedBufferGeometry();
    const bb = buildBlob();
    bg.setIndex(bb.getIndex()); bg.setAttribute('position', bb.getAttribute('position')); bg.setAttribute('uv', bb.getAttribute('uv'));
    const bcap = 900;
    this.blobA = new THREE.InstancedBufferAttribute(new Float32Array(bcap * 4), 4); this.blobA.setUsage(THREE.DynamicDrawUsage);
    this.blobB = new THREE.InstancedBufferAttribute(new Float32Array(bcap * 4), 4); this.blobB.setUsage(THREE.DynamicDrawUsage);
    bg.setAttribute('iBlob', this.blobA); bg.setAttribute('iBlobB', this.blobB);
    bg.instanceCount = 0; bg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.blobMesh = new THREE.Mesh(bg, makeBlobMaterial());
    this.blobMesh.frustumCulled = false; this.blobMesh.renderOrder = 1; this.blobMesh.name = 'crowd_blobs';
    this.blobCap = bcap;
    this.group.add(this.blobMesh);
    this._frustum = new THREE.Frustum(); this._m = new THREE.Matrix4(); this._sph = new THREE.Sphere(new THREE.Vector3(), 1.1);
    this._list = [];
  }
  setVisible(v) { if (this.group) this.group.visible = v; }

  update(dt) {
    const t0 = performance.now();
    const { engine } = this.ctx;
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
      if (!a.alive || a.fade <= 0.01) continue;
      const root = levels[a.level];
      let vis = !root || root.visible !== false;
      if (!vis && a.ramp >= 0) { const up = levels[ramps[a.ramp].r.upper]; vis = !up || up.visible !== false; }
      if (!vis) continue;
      // extrapolate agents that were not stepped this frame
      let x = a.x, z = a.z;
      if (a.tier > 0 && a.mode !== MODE.STAND) { const age = Math.min(0.25, simT - a.lastUpd); x += a.vx * age; z += a.vz * age; }
      const y = a.y;
      const dx = x - cx, dy = y + 0.9 - cy, dz = z - cz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > dd2) continue;
      // sphere-frustum
      let inside = true;
      for (let p = 0; p < 6; p++) { const pl = planes[p]; if (pl.normal.x * x + pl.normal.y * (y + 0.9) + pl.normal.z * z + pl.constant < -1.2) { inside = false; break; } }
      if (!inside) continue;
      a._rx = x; a._rz = z; a._d2 = d2;
      list.push(a);
    }
    // LOD assignment with caps: nearest first
    if (list.length > LOD_CAP[0]) list.sort((p, q) => p._d2 - q._d2);
    const n0 = this.nearD * this.nearD, n1 = this.midD * this.midD;
    const L = this.lods;
    L[0].n = L[1].n = L[2].n = 0;
    let nb = 0;
    const BA = this.blobA.array, BB = this.blobB.array;
    for (let k = 0; k < list.length; k++) {
      const a = list[k];
      let l = a._d2 < n0 ? 0 : a._d2 < n1 ? 1 : 2;
      while (l < 3 && L[l].n >= L[l].cap) l++;
      if (l > 2) break;
      this._pose(a, dt);
      this._write(L[l], L[l].n++, a);
      if (nb < this.blobCap && a._d2 < 70 * 70) {
        const o = nb * 4;
        const h = a.look ? a.look.h : 1;
        BA[o] = a._rx; BA[o + 1] = a.ramp >= 0 ? a.y : a.y; BA[o + 2] = a._rz; BA[o + 3] = (0.62 + 0.22 * a.pSit) * h;
        BB[o] = a.fade * (a.ramp >= 0 ? 0.6 : 1); BB[o + 1] = 1.25 + a.pAmt * 0.25; BB[o + 2] = a.yaw; BB[o + 3] = 0;
        nb++;
      }
    }
    for (const lod of L) {
      lod.g.instanceCount = lod.n;
      if (lod.n) for (const name of INSTANCE_ATTRS) { const at = lod.attrs[name]; if (at.clearUpdateRanges) { at.clearUpdateRanges(); at.addUpdateRange(0, lod.n * 4); } at.needsUpdate = true; }
    }
    this.blobMesh.geometry.instanceCount = nb;
    if (nb) for (const at of [this.blobA, this.blobB]) { if (at.clearUpdateRanges) { at.clearUpdateRanges(); at.addUpdateRange(0, nb * 4); } at.needsUpdate = true; }
    this.stats.lod[0] = L[0].n; this.stats.lod[1] = L[1].n; this.stats.lod[2] = L[2].n; this.stats.blobs = nb;
    this.stats.tris = L[0].n * L[0].tris + L[1].n * L[1].tris + L[2].n * L[2].tris;
    this.stats.ms = performance.now() - t0;
  }

  // smooth pose parameters toward the targets of the agent's current pose
  _pose(a, dt) {
    const T = TGT; reset(T);
    const flags = a.flags | a.dyn;
    const riding = a.ramp >= 0;
    const R = riding ? this.sim.places.ramps[a.ramp] : null;
    let spd = a.spd;
    if (riding && R.esc) spd = Math.max(0, (a.curRideSpd != null ? a.curRideSpd : a.rspd) - 0.5) * 1.1;
    let pose = a.pose;
    if (riding && R.esc && !a.walkLane) pose = a.phoneUser > 0.55 ? POSE.PHONE : POSE.RIDE;
    if (riding && (R.stairs || a.walkLane)) pose = POSE.WALK;
    const moving = spd > 0.15;
    if (!moving && pose === POSE.WALK) pose = POSE.STAND;
    let amt = moving ? Math.min(1.15, 0.25 + spd * 0.62) : 0;
    if (riding && R.stairs) amt = Math.min(1, 0.45 + spd * 0.5);
    T.headY = a.lookYaw;
    switch (pose) {
      case POSE.PHONE:
        T.aR[0] = 0.32; T.aR[1] = 0.0; T.aR[2] = 1.12; T.aR[3] = 1; T.inR = 0.5; T.headP = 0.46;
        if (!moving) { T.aL[0] = 0.24; T.aL[2] = 0.95; T.aL[3] = 1; T.inL = 0.45; }
        flagsSet(T, BIT.PHONE);
        break;
      case POSE.SIT: T.sit = 1; T.aL[0] = T.aR[0] = 0.5; T.aL[2] = T.aR[2] = 0.75; T.aL[3] = T.aR[3] = 1; T.inL = T.inR = 0.15; T.headP = 0.12; T.lean = -0.04; break;
      case POSE.EAT: T.sit = 1; T.aR[0] = 0.85; T.aR[2] = 0.95; T.aR[3] = 1; T.aL[0] = 0.75; T.aL[2] = 1.05; T.aL[3] = 1; T.inL = T.inR = 0.4; T.headP = 0.38; T.lean = 0.16;
        T.aR[2] += Math.sin(this.sim.time * 2.2 + a.i) * 0.18; break;
      case POSE.RIDE: T.aR[0] = 0.16; T.aR[1] = 0.3; T.aR[2] = 0.55; T.aR[3] = 1; T.aL[3] = 1; T.headP = 0.08; break;
      case POSE.WAVE: T.aR[0] = 0.25; T.aR[1] = 2.35 + Math.sin(this.sim.time * 9 + a.i) * 0.28; T.aR[2] = 0.55; T.aR[3] = 1; T.headP = -0.05; break;
      case POSE.PHOTO: T.aR[0] = 1.3; T.aR[2] = 0.3; T.aR[3] = 1; T.aL[0] = 1.22; T.aL[2] = 0.36; T.aL[3] = 1; T.inL = T.inR = 0.62; T.headP = -0.04; flagsSet(T, BIT.PHONE); break;
      case POSE.LOOKUP: T.headP = -0.42; break;
      case POSE.BOW: T.lean = 0.42; T.headP = 0.25; T.aL[0] = T.aR[0] = 0.22; T.aL[2] = T.aR[2] = 0.3; T.aL[3] = T.aR[3] = 1; T.inL = T.inR = 0.4; break;
      case POSE.CART: break;
      case POSE.BROWSE: T.headP = 0.34; T.lean = 0.07; T.aR[0] = 0.4; T.aR[2] = 0.7; T.aR[3] = 0.8; break;
      case POSE.TALK: T.headP = 0.0; T.aR[0] = 0.12; T.aR[2] = 0.45 + 0.3 * Math.max(0, Math.sin(this.sim.time * 1.7 + a.i * 3.1)); T.aR[3] = 1; break;
      default: break;
    }
    // carried things shape the arms
    if (flags & (1 << BIT.CART)) { T.aL[0] = T.aR[0] = 0.78; T.aL[1] = T.aR[1] = -0.02; T.aL[2] = T.aR[2] = 0.32; T.aL[3] = T.aR[3] = 1; T.inL = T.inR = 0.22; }
    if ((flags & (1 << BIT.SUITCASE)) && pose !== POSE.SIT && pose !== POSE.EAT && pose !== POSE.PHOTO) { T.aL[0] = -0.36; T.aL[1] = 0.1; T.aL[2] = 0.05; T.aL[3] = 1; T.inL = 0; }
    else if ((flags & ((1 << BIT.SHOPBAG) | (1 << BIT.TOTE))) && T.aL[3] < 1) { T.aL[3] = 0.5; T.aL[2] = 0.08; }
    if (flags & (1 << BIT.BRIEFCASE)) { T.aR[3] = Math.max(T.aR[3], 0.5); }
    if (a.handHold && a.leader) { const s = a.offX > 0 ? 1 : -1; const arm = s > 0 ? T.aL : T.aR; arm[0] = 0.15; arm[1] = 0.45; arm[2] = 0.12; arm[3] = 1; }
    if (a.kind === 'elderly') { T.lean += 0.12; T.headP -= 0.05; }
    if (a.kind === 'child' && moving) amt = Math.min(1.2, amt * 1.1);
    // smooth
    const k = 1 - Math.exp(-dt * 7), ka = 1 - Math.exp(-dt * 10);
    a.pAmt += (amt - a.pAmt) * ka;
    a.pSit += (T.sit - a.pSit) * k; a.pLean += (T.lean - a.pLean) * k;
    a.pHP += (T.headP - a.pHP) * k; a.pHY += (T.headY - a.pHY) * (1 - Math.exp(-dt * 4));
    a.pInL += (T.inL - a.pInL) * k; a.pInR += (T.inR - a.pInR) * k;
    for (let j = 0; j < 4; j++) { a.aL[j] += (T.aL[j] - a.aL[j]) * k; a.aR[j] += (T.aR[j] - a.aR[j]) * k; }
    a._dynR = T.dyn;
    // walk phase: distance-driven so feet don't skate
    const h = a.look ? a.look.h : 1;
    if (moving) a.phase += Math.PI * spd * dt / (0.8 * h * Math.max(0.45, a.pAmt));
    else a.phase += dt * 0.7;
    if (a.phase > 1e4) a.phase -= 6283.185307;
  }

  _write(L, n, a) {
    const o = n * 4, at = L.attrs, lk = a.look;
    let p = at.iPos.array; p[o] = a._rx; p[o + 1] = a.y; p[o + 2] = a._rz; p[o + 3] = a.yaw;
    p = at.iPose.array; p[o] = a.phase; p[o + 1] = a.pAmt; p[o + 2] = a.pSit; p[o + 3] = a.pLean;
    p = at.iHead.array; p[o] = a.pHP; p[o + 1] = a.pHY; p[o + 2] = a.pInL; p[o + 3] = a.pInR;
    p = at.iArmL.array; p[o] = a.aL[0]; p[o + 1] = a.aL[1]; p[o + 2] = a.aL[2]; p[o + 3] = a.aL[3];
    p = at.iArmR.array; p[o] = a.aR[0]; p[o + 1] = a.aR[1]; p[o + 2] = a.aR[2]; p[o + 3] = a.aR[3];
    p = at.iLook.array; p[o] = lk.h; p[o + 1] = lk.build; p[o + 2] = (a.flags | a.dyn | a._dynR) & 0xffffff; p[o + 3] = a.fade;
    p = at.iColA.array; p[o] = lk.colA[0]; p[o + 1] = lk.colA[1]; p[o + 2] = lk.colA[2]; p[o + 3] = lk.colA[3];
    p = at.iColB.array; p[o] = lk.colB[0]; p[o + 1] = lk.colB[1]; p[o + 2] = lk.colB[2]; p[o + 3] = lk.colB[3];
  }
  dispose() { if (this.group) { this.group.parent && this.group.parent.remove(this.group); for (const l of this.lods) l.g.dispose(); this.mat.dispose(); } }
}

const TGT = { aL: [0, 0, 0, 0], aR: [0, 0, 0, 0], inL: 0, inR: 0, headP: 0, headY: 0, sit: 0, lean: 0, dyn: 0 };
function reset(T) {
  T.aL[0] = 0.02; T.aL[1] = 0.05; T.aL[2] = 0.14; T.aL[3] = 0;
  T.aR[0] = 0.02; T.aR[1] = 0.05; T.aR[2] = 0.14; T.aR[3] = 0;
  T.inL = T.inR = 0; T.headP = 0.04; T.headY = 0; T.sit = 0; T.lean = 0; T.dyn = 0;
}
function flagsSet(T, b) { T.dyn |= (1 << b); }
