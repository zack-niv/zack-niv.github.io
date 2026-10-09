// =============================================================================
// Crowd simulation core (no THREE — runs in Node for benchmarks).
//
// Agents follow destination-keyed flow fields, smoothed by look-ahead and a
// per-agent lane offset, with social-force/anticipatory avoidance on a uniform
// spatial hash. Escalators: Osaka style (standers on the right, walkers pass on
// the left; ESC_STAND_SIDE), admission intervals per lane; people waiting for
// a lane line up single file behind its mouth instead of clumping. Ticket
// gates: lanes chosen by proximity + load, one passenger per lane at a time.
// The player is a moving obstacle everybody anticipates: people sidestep early
// (keeping left), slow down close by and never overlap the player.
//
// LOD: tier 0 (near the player): every frame, full steering. tier 1 (visible
// range): every 2nd frame. tier 2 (elsewhere): every 4th frame, node hopping
// along the field (trip progress stays correct; no avoidance).
// =============================================================================
import { FieldStore, GridCollider, localPath } from './fields.js?v=517b401';
import { Places } from './places.js?v=517b401';
import { rampProfile, LEVELS } from '../world/layout.js?v=517b401';
import { rng } from '../core/rng.js?v=517b401';

export const MODE = { NONE: 0, FIELD: 1, PATH: 2, STAND: 3, RIDE: 4, GATE: 5, FOLLOW: 6 };
export const POSE = { WALK: 0, STAND: 1, PHONE: 2, SIT: 3, RIDE: 4, WAVE: 5, PHOTO: 6, LOOKUP: 7, BOW: 8, CART: 9, BROWSE: 10, EAT: 11, TALK: 12, NOD: 13, SERVE: 14 };
const TWO_PI = Math.PI * 2;
// Osaka stands on the RIGHT of escalators and passes on the left (Tokyo is the reverse); -1 = Tokyo style.
export const ESC_STAND_SIDE = +1;
// v5: the head of the line waits this far outside the ramp's start line, on its lane axis; it steps on only once it is lined up
// (so boarding is a continuation of a walk, not a jump). BOARD_W = critically damped spring rate of the residual offset.
const EXIT_RUN = 0.4, RAMP_AIM = 0.3, BOARD_W = 7.5, BOARD_BLEND = 0.55;
const PLAYER_R = 0.62;     // nobody comes closer to the player's centre than this

export class Agent {
  constructor(i) {
    this.i = i; this.alive = false; this.serial = 0;
    this.x = 0; this.z = 0; this.y = 0; this.level = 'B1'; this.lv = 0; this.ramp = -1;
    this.rs = 0; this.ru = 0; this.rdir = 1; this.rspd = 0; this.walkLane = false;
    this.seatK = 1; this.seatTx = NaN; this.seatTz = 0; this.rsp = 0; this.bw = BOARD_W; this.bx = 0; this.bz = 0; this.bvx = 0; this.bvz = 0; this.bo = false; this.boardK = 1; this.boardSpd0 = 0;   // v5: boarding offset (spring) and clip/speed blend
    this.vx = 0; this.vz = 0; this.yaw = 0; this.spd = 0; this.pref = 1.3; this.prefBase = 1.3;
    this.node = -1; this.aimX = 0; this.aimZ = 0; this.aimT = 0; this.rampNext = -1; this.rampU = 0; this.rampFromLow = true;
    this.en = null; this.arriveDm = 10; this.mode = MODE.NONE;
    this.path = null; this.pi = 0; this.tx = 0; this.tz = 0; this.arriveR = 0.4;
    this.gate = null; this.lane = -1; this.gstage = 0; this.gside = 1; this.tapAt = -9; this.tapDone = false;   // v7: IC-card tap gesture (render.js reads tapAt, sim time of the gesture's start)
    this.faceYaw = 0; this.faceSet = false; this.pose = POSE.STAND; this.lookYaw = 0; this.lookPitch = 0; this.lookT = 0;
    this.tier = 2; this.lastUpd = 0; this.fade = 0; this.fadeDir = 1; this.dead = false;
    this.leader = null; this.followers = null; this.offX = 0; this.offZ = 0; this.handHold = false;
    this.laneOff = 0; this.jx = 0; this.jz = 0; this.acc = 0;
    this.kind = 'commuter'; this.conf = 1; this.patience = 1; this.space = 0.5; this.hurry = 0.5; this.phoneUser = 0;
    this.legs = null; this.leg = 0; this.st = 0; this.t = 0; this.t2 = 0; this.d = null; this.trip = '';
    this.look = null; this.flags = 0; this.dyn = 0;
    this.phase = 0; this.pAmt = 0; this.pSit = 0; this.pLean = 0; this.pHP = 0; this.pHY = 0; this.pInL = 0; this.pInR = 0;
    this.aL = [0, 0.05, 0.12, 0]; this.aR = [0, 0.05, 0.12, 0];
    this.blockT = 0; this.excuseT = 0; this.queueing = false; this.hesT = 0; this.waitField = false; this.ff = 0;
    this.spot = null; this.biz = null; this.mark = null; this.markK = -1; this.track = null;
    this.seatH = 0; this.seatPhone = false; this.seatDone = false; this.seatStool = false;
  }
}

export class CrowdSim {
  constructor({ world, nav, events, clock, params = {}, quality = {}, worker = true, ctx = null }) {
    this.world = world; this.nav = nav; this.events = events; this.clock = clock; this.params = params; this.quality = quality; this.ctx = ctx;
    this.fields = new FieldStore(nav, world, { worker, maxFields: quality.crowdMax && quality.crowdMax < 800 ? 100 : 170 });
    this.col = new GridCollider(nav, world);
    this.places = new Places({ world, nav, fields: this.fields, col: this.col, ctx });
    this.agents = []; this.free = []; this.count = 0;
    this.time = 0; this.frame = 0;
    this.viewer = { level: '3F', x: 0, z: 0, vx: 0, vz: 0, yaw: 0, ramp: -1, has: false };
    this.visibleLevel = () => true;
    this.drawDist = quality.drawDist || 200;
    this.behave = null; // set by crowd.js (behave.js)
    this.stats = { t0: 0, t1: 0, t2: 0, ms: 0, msAvg: 0, upd: 0 };
    this.levelNames = nav.levelNames;
    this.lvIndex = nav.levelIdx;
    this._initHash();
    this._excuseGlobal = 0;
    this.serial = 0;
    this.rnd = rng(((params && params.seed) || 20261005) ^ 0xc0ffee);
  }

  // ---------------------------------------------------------------------------
  spawn() {
    let a = this.free.pop();
    if (!a) { a = new Agent(this.agents.length); this.agents.push(a); }
    a.alive = true; a.dead = false; a.serial = ++this.serial;
    a.mode = MODE.NONE; a.ramp = -1; a.en = null; a.path = null; a.gate = null; a.lane = -1; a.leader = null; a.followers = null;
    a.legs = null; a.leg = 0; a.st = 0; a.t = 0; a.t2 = 0; a.d = null; a.fade = 0; a.fadeDir = 1; a.vx = a.vz = 0; a.spd = 0;
    a.seatK = 1; a.seatTx = NaN; a.faceSet = false; a.pose = POSE.STAND; a.lookT = 0; a.lookYaw = 0; a.lookPitch = 0; a.lookAbs = undefined; a.lookRel = undefined; a.pHY = 0; a.pHP = 0; a.blockT = 0; a.queueing = false; a.waitField = false; a.ff = 0;
    a.spot = null; a.biz = null; a.mark = null; a.markK = -1; a.track = null; a.rampNext = -1; a.aimT = 0; a.node = -1; a.dyn = 0; a.hesT = 0; a.seatH = 0; a.seatPhone = false; a.seatDone = false; a.seatStool = false; a._dy = undefined;
    a.lastUpd = this.time; a.tier = 2; a.handHold = false; a.rampQ = null; a._slot = null;
    this.count++;
    return a;
  }
  kill(a) {
    if (!a.alive) return;
    if (this.behave) this.behave.cleanup(a);
    if (a.gate && a.lane >= 0) { a.gate.load[a.lane] = Math.max(0, a.gate.load[a.lane] - 1); if (a.gstage === 1) a.gate.occDir[a.lane] = 0; }
    if (a.ramp >= 0) this._leaveRide(a);
    if (a.rampQ) this._rampDequeue(a);
    if (a.en) { this.fields.unref(a.en); a.en = null; }
    if (a.followers) { for (const f of a.followers) if (f.alive && f.leader === a) { f.leader = null; this.kill(f); } a.followers = null; }
    if (a.leader && a.leader.followers) { const fl = a.leader.followers; const k = fl.indexOf(a); if (k >= 0) fl.splice(k, 1); }
    a.alive = false; a.leader = null;
    this.free.push(a);
    this.count--;
  }
  setPos(a, level, x, z) {
    a.level = level; a.lv = this.lvIndex[level] ?? 0; a.x = x; a.z = z; a.ramp = -1; a.y = LEVELS[level] ? LEVELS[level].y : 0;
    a.node = this.nav.nodeAtPoint(level, x, z);
  }
  setField(a, en, arriveM = 1.0) {
    if (a.en !== en) { if (a.en) this.fields.unref(a.en); a.en = en; if (en) this.fields.ref(en); }
    a.arriveDm = arriveM * 10; a.mode = MODE.FIELD; a.aimT = 0; a.rampNext = -1; if (a.rampQ) this._rampDequeue(a);
  }
  setPath(a, pts, arriveR = 0.35) { a.path = pts; a.pi = 0; a.mode = MODE.PATH; a.arriveR = arriveR; }
  goTo(a, x, z, rect, arriveR = 0.35) {
    let pts = null;
    if (rect) pts = localPath(this.col, a.level, rect, a.x, a.z, x, z);
    this.setPath(a, pts || [[x, z]], arriveR);
  }
  stand(a, yaw = null) { a.mode = MODE.STAND; a.path = null; if (yaw != null) { a.faceYaw = yaw; a.faceSet = true; } }
  lookAt(a, x, z, dur = 1.5) {
    const want = Math.atan2(-(x - a.x), -(z - a.z));
    let rel = wrap(want - a.yaw);
    rel = Math.max(-1.2, Math.min(1.2, rel));
    a.lookYaw = rel; a.lookT = dur;
    a.lookAbs = want; a.lookRel = rel;   // renderer keeps looking at this world bearing while the body turns (clamped there)
  }

  // ---------------------------------------------------------------------------
  _initHash() {
    this.H = 2.0;
    this.hl = {};
    let off = 0;
    for (const lv of this.levelNames) {
      const g = this.world.grids[lv];
      const w = Math.ceil(g.w / this.H) + 1, h = Math.ceil(g.h / this.H) + 1;
      this.hl[lv] = { off, w, h, x0: g.x0, z0: g.z0 };
      off += w * h;
    }
    this.hCells = off;
    // sorted (cellKey, agent) pairs + open-addressing table cellKey -> [start, end)
    this.hSorted = new Float64Array(4096);
    this.hItems = new Int32Array(4096);
    this.hTabK = new Int32Array(8192).fill(-1);
    this.hTabS = new Int32Array(8192);
    this.hTabE = new Int32Array(8192);
    this.hMask = 8191;
  }
  _hkey(level, x, z) {
    const L = this.hl[level]; if (!L) return -1;
    const cx = Math.floor((x - L.x0) / this.H), cz = Math.floor((z - L.z0) / this.H);
    if (cx < 0 || cz < 0 || cx >= L.w || cz >= L.h) return -1;
    return L.off + cz * L.w + cx;
  }
  _buildHash() {
    const A = this.agents, n = A.length;
    if (this.hSorted.length < n) { this.hSorted = new Float64Array(n * 2); this.hItems = new Int32Array(n * 2); }
    const tsz = Math.max(8192, 1 << Math.ceil(Math.log2(n * 4 + 1)));
    if (this.hTabK.length !== tsz) { this.hTabK = new Int32Array(tsz); this.hTabS = new Int32Array(tsz); this.hTabE = new Int32Array(tsz); this.hMask = tsz - 1; }
    let m = 0;
    const so = this.hSorted;
    for (let i = 0; i < n; i++) {
      const a = A[i];
      if (!a.alive || a.ramp >= 0) continue;
      const k = this._hkey(a.level, a.x, a.z);
      if (k >= 0) so[m++] = k * 8192 + i;
    }
    const view = so.subarray(0, m); view.sort();
    const TK = this.hTabK, TS = this.hTabS, TE = this.hTabE, mask = this.hMask;
    TK.fill(-1);
    const it = this.hItems;
    let prev = -1, slot = -1;
    for (let j = 0; j < m; j++) {
      const v = view[j]; const k = Math.floor(v / 8192); it[j] = v - k * 8192;
      if (k !== prev) {
        if (slot >= 0) TE[slot] = j;
        slot = (k * 2654435761 >>> 0) & mask;
        while (TK[slot] !== -1) slot = (slot + 1) & mask;
        TK[slot] = k; TS[slot] = j; prev = k;
      }
    }
    if (slot >= 0) TE[slot] = m;
  }
  // iterate agents near (level,x,z) within r; fn(agent, dx, dz, d2)
  near(level, x, z, r, fn) {
    const L = this.hl[level]; if (!L) return;
    const H = this.H;
    const cx0 = Math.max(0, Math.floor((x - r - L.x0) / H)), cx1 = Math.min(L.w - 1, Math.floor((x + r - L.x0) / H));
    const cz0 = Math.max(0, Math.floor((z - r - L.z0) / H)), cz1 = Math.min(L.h - 1, Math.floor((z + r - L.z0) / H));
    const r2 = r * r, A = this.agents, it = this.hItems, TK = this.hTabK, mask = this.hMask;
    for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) {
      const k = L.off + cz * L.w + cx;
      let slot = (k * 2654435761 >>> 0) & mask;
      while (TK[slot] !== -1 && TK[slot] !== k) slot = (slot + 1) & mask;
      if (TK[slot] === -1) continue;
      for (let j = this.hTabS[slot], j1 = this.hTabE[slot]; j < j1; j++) {
        const b = A[it[j]];
        const dx = b.x - x, dz = b.z - z, d2 = dx * dx + dz * dz;
        if (d2 <= r2) fn(b, dx, dz, d2);
      }
    }
  }

  // ---------------------------------------------------------------------------
  update(dt) {
    const t0 = now();
    this.time += dt; this.frame++;
    this.fields.update();
    const V = this.viewer;
    if (this.behave) this.behave.director.update(dt);
    this._buildHash();
    const A = this.agents, n = A.length, f = this.frame;
    let c0 = 0, c1 = 0, c2 = 0, upd = 0;
    const dd2 = this.drawDist * this.drawDist;
    for (let i = 0; i < n; i++) {
      const a = A[i];
      if (!a.alive) continue;
      // tier assignment (cheap, every frame)
      const dx = a.x - V.x, dz = a.z - V.z, d2 = dx * dx + dz * dz;
      const sameLv = a.level === V.level || (a.ramp >= 0 && (this.places.ramps[a.ramp].r.upper === V.level));
      let tier;
      if (sameLv && d2 < 45 * 45) tier = 0;
      else if (d2 < dd2 && this.visibleLevel(a.level, a)) tier = d2 < 30 * 30 ? 0 : 1;
      else tier = 2;
      a.tier = tier;
      if (tier === 0) c0++; else if (tier === 1) c1++; else c2++;
      const period = tier === 0 ? 1 : tier === 1 ? 2 : 4;
      if ((f + i) % period !== 0) continue;
      let adt = this.time - a.lastUpd; a.lastUpd = this.time;
      if (adt > 0.3) adt = 0.3;
      if (adt <= 0) continue;
      upd++;
      if (this.behave) this.behave.tick(a, adt);
      if (!a.alive) continue;
      this._move(a, adt);
      // fade
      if (a.fadeDir > 0 && a.fade < 1) a.fade = Math.min(1, a.fade + adt * 1.6);
      else if (a.fadeDir < 0) { a.fade -= adt * 1.8; if (a.fade <= 0) { this.kill(a); continue; } }
      if (a.lookT > 0) { a.lookT -= adt; if (a.lookT <= 0) a.lookYaw = 0; }
    }
    this.stats.t0 = c0; this.stats.t1 = c1; this.stats.t2 = c2; this.stats.upd = upd;
    const ms = now() - t0;
    this.stats.ms = ms; this.stats.msAvg = this.stats.msAvg * 0.95 + ms * 0.05;
  }

  // ---------------------------------------------------------------------------
  _move(a, dt) {
    switch (a.mode) {
      case MODE.RIDE: this._ride(a, dt); return;
      case MODE.FIELD:
        if (!a.en || !a.en.ready) { this._steer(a, 0, 0, dt); return; }
        if (a.tier === 2 && a.rampNext < 0) { this._hop(a, dt); return; }
        this._fieldStep(a, dt); return;
      case MODE.PATH: this._pathStep(a, dt); return;
      case MODE.GATE: this._gateStep(a, dt); return;
      case MODE.FOLLOW: this._followStep(a, dt); return;
      case MODE.STAND:
        if (a.tier === 2) { a.vx = a.vz = 0; a.spd = 0; return; }
        if (a.seatH) {
          a.vx = a.vz = 0; a.spd = 0;
          // v5: sitting down is eased: the last step onto the seat position (<= 0.9 m/s) and the turn into the seat direction (<= 5.5 rad/s =
          // 315 deg/s); the sit clip only takes over once seatK >= 0.35 (render.js), then cross-fades in
          if (a.seatTx === a.seatTx) {
            const dx = a.seatTx - a.x, dz = a.seatTz - a.z, d = Math.hypot(dx, dz), st = 0.9 * dt;
            if (d <= st) { a.x = a.seatTx; a.z = a.seatTz; a.seatTx = NaN; } else { a.x += dx / d * st; a.z += dz / d * st; }
          }
          if (a.seatK < 1) a.seatK = Math.min(1, a.seatK + dt / 0.5);
          if (a.faceSet) this._turn(a, a.faceYaw, dt, 5.5);
          return;
        }   // seated: rigid (no personal-space push off the seat)
        this._steer(a, 0, 0, dt); return;
      default: a.vx = a.vz = 0; a.spd = 0;
    }
  }

  _updNode(a) {
    const nav = this.nav, g = this.world.grids[a.level];
    const ci = g.cellOf(a.x, a.z);
    if (ci >= 0) { const v = nav.cellNode[a.level][ci]; if (v >= 0) { if (v !== a.node) { a.node = v; return true; } return false; } }
    if (a.node < 0 || this.levelNames[nav.lvl[a.node]] !== a.level) { a.node = nav.nodeAtPoint(a.level, a.x, a.z); return true; }
    return false;
  }

  _fieldStep(a, dt) {
    const F = this.fields, nav = this.nav;
    if (a.rampNext >= 0) { this._rampApproach(a, dt); return; }
    const changed = this._updNode(a);
    a.aimT -= dt;
    if (changed || a.aimT <= 0) {
      const v = a.node;
      if (v < 0) { this._steer(a, 0, 0, dt); return; }
      const d = a.en.dist[v];
      if (d === 65535) { if (this.behave) this.behave.fail(a); return; }
      if (d <= a.arriveDm) { if (this.behave) this.behave.arrive(a); return; }
      const w1 = F.next(a.en, v);
      if (w1 < 0) { if (this.behave) this.behave.arrive(a); return; }
      if (nav.rmp[w1] >= 0) { this._beginRamp(a, nav.rmp[w1]); this._rampApproach(a, dt); return; }
      // an escalator / stairs a few metres ahead: join its line now (ordered), instead of pushing up to the mouth
      if (a.tier === 0) {
        let u = w1, acc = Math.hypot(nav.x[w1] - nav.x[v], nav.z[w1] - nav.z[v]);
        for (let k = 0; k < 8 && acc < 6; k++) {
          const w = F.next(a.en, u); if (w < 0) break;
          if (nav.rmp[w] >= 0) { this._beginRamp(a, nav.rmp[w]); this._rampApproach(a, dt); return; }
          acc += Math.hypot(nav.x[w] - nav.x[u], nav.z[w] - nav.z[u]); u = w;
        }
      }
      const w2 = F.next(a.en, w1);
      let t = w1;
      if (w2 >= 0 && nav.rmp[w2] < 0) {
        t = w2;
        const w3 = F.next(a.en, w2);
        if (w3 >= 0 && nav.rmp[w3] < 0 && a.hurry > 0.3) t = w3;
      }
      let dx = nav.x[t] - nav.x[v], dz = nav.z[t] - nav.z[v];
      const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const cl = F.clear[t];
      const off = a.laneOff * Math.max(0, Math.min(1, (cl - 1.5) / 2.5));
      a.aimX = nav.x[t] - dz * off; a.aimZ = nav.z[t] + dx * off;
      a.aimT = 0.5;
      // ticket gates
      const gl = this.places.gatesByLevel[a.level];
      if (gl) for (const G of gl) if (this._gateCheck(a, G)) return;
    }
    let dx = a.aimX - a.x, dz = a.aimZ - a.z;
    const l = Math.hypot(dx, dz);
    if (l < 0.05) { a.aimT = 0; this._steer(a, 0, 0, dt); return; }
    let sp = a.pref;
    // close to the goal: slow down
    if (a.node >= 0) { const dg = a.en.dist[a.node] * 0.1 - a.arriveDm * 0.1; if (dg < 2) sp *= Math.max(0.45, dg / 2); }
    this._steer(a, dx / l * sp, dz / l * sp, dt);
  }

  // node hopping for tier-2 agents
  _hop(a, dt) {
    const F = this.fields, nav = this.nav;
    if (a.node < 0) this._updNode(a);
    a.acc += a.pref * dt;
    let guard = 8;
    while (a.acc > 0 && guard-- > 0) {
      const v = a.node; if (v < 0) return;
      const d = a.en.dist[v];
      if (d === 65535) { if (this.behave) this.behave.fail(a); return; }
      if (d <= a.arriveDm) { a.acc = 0; if (this.behave) this.behave.arrive(a); return; }
      const w = F.next(a.en, v);
      if (w < 0) { a.acc = 0; if (this.behave) this.behave.arrive(a); return; }
      if (nav.rmp[w] >= 0) { a.acc = 0; this._beginRamp(a, nav.rmp[w]); this._startRide(a); return; }
      const dx = nav.x[w] - nav.x[v], dz = nav.z[w] - nav.z[v];
      const c = Math.hypot(dx, dz);
      a.acc -= c;
      a.node = w;
      const lv = this.levelNames[nav.lvl[w]];
      if (lv !== a.level) { a.level = lv; a.lv = nav.lvl[w]; a.y = LEVELS[lv].y; }
      a.x = nav.x[w] + a.jx; a.z = nav.z[w] + a.jz;
      a.vx = dx / c * a.pref; a.vz = dz / c * a.pref; a.spd = a.pref;
      a.yaw = Math.atan2(-a.vx, -a.vz);
    }
  }

  _pathStep(a, dt) {
    const P = a.path;
    if (!P || a.pi >= P.length) { a.path = null; a.mode = MODE.STAND; if (this.behave) this.behave.arrive(a); return; }
    const [tx, tz] = P[a.pi];
    const dx = tx - a.x, dz = tz - a.z, l = Math.hypot(dx, dz);
    const last = a.pi === P.length - 1;
    if (l < (last ? a.arriveR : 0.6)) {
      a.pi++;
      if (a.pi >= P.length) { a.path = null; a.mode = MODE.STAND; a.vx *= 0.3; a.vz *= 0.3; if (this.behave) this.behave.arrive(a); return; }
      return;
    }
    if (a.tier === 2) {
      const s = Math.min(l, a.pref * 0.8 * dt);
      a.x += dx / l * s; a.z += dz / l * s; a.vx = dx / l * a.pref * 0.8; a.vz = dz / l * a.pref * 0.8; a.spd = a.pref * 0.8;
      a.yaw = Math.atan2(-dx, -dz);
      return;
    }
    let sp = a.pref * (a.d && a.d.slow ? a.d.slow : 1);
    if (last && l < 1.5) sp *= Math.max(0.35, l / 1.5);
    this._steer(a, dx / l * sp, dz / l * sp, dt);
  }

  _followStep(a, dt) {
    const L = a.leader;
    if (!L || !L.alive) { a.leader = null; if (this.behave) this.behave.orphan(a); return; }
    if (L.fadeDir < 0 && a.fadeDir > 0) { a.fadeDir = -1; }
    const dx0 = L.x - a.x, dz0 = L.z - a.z, dist = Math.hypot(dx0, dz0);
    const sameLv = L.level === a.level && L.ramp < 0;
    if (a.ramp >= 0) { this._ride(a, dt); return; }
    // v4: the leader is in a lane's line: the group queues together, behind the leader (a formation standing between the leader and
    // the mouth, in the lane, starves the escalator)
    if (a.rampNext < 0 && L.rampNext >= 0 && sameLv && dist < 9 && L.en && L.en.ready) {
      if (a.en !== L.en) { if (a.en) this.fields.unref(a.en); a.en = L.en; this.fields.ref(a.en); a.arriveDm = 0; a.aimT = 0; }
      this._beginRamp(a, L.rampNext, true, L);
      this._rampApproach(a, dt); return;
    }
    // far / different floor / leader riding: use the leader's field
    if ((!sameLv || dist > 5 || L.mode === MODE.RIDE || a.rampNext >= 0) && L.en && L.en.ready && L.en.dist) {
      if (a.en !== L.en) { if (a.en) this.fields.unref(a.en); a.en = L.en; this.fields.ref(a.en); a.arriveDm = 0; a.aimT = 0; }
      if (a.tier === 2 && a.rampNext < 0) {
        if (!sameLv || dist > 5) { this._hop(a, dt); if (a.mode === MODE.RIDE) a.mode = MODE.RIDE; }
        return;
      }
      this._fieldStepFollow(a, dt);
      return;
    }
    if (a.tier === 2) {
      if (sameLv) { const c = Math.cos(L.yaw), s = Math.sin(L.yaw); a.x = L.x + c * a.offX + s * a.offZ; a.z = L.z - s * a.offX + c * a.offZ; a.level = L.level; a.yaw = L.yaw; a.vx = L.vx; a.vz = L.vz; a.spd = L.spd; }
      return;
    }
    // formation target relative to the leader's heading
    const c = Math.cos(L.yaw), s = Math.sin(L.yaw);
    const ox = c * a.offX + s * a.offZ, oz = -s * a.offX + c * a.offZ;
    const tx = L.x + ox, tz = L.z + oz;
    let dx = tx - a.x, dz = tz - a.z;
    const l = Math.hypot(dx, dz);
    let vx = L.vx + dx * 1.4, vz = L.vz + dz * 1.4;
    const vm = Math.hypot(vx, vz), cap = Math.max(a.pref * 1.35, L.spd * 1.3);
    if (vm > cap) { vx *= cap / vm; vz *= cap / vm; }
    if (l < 0.25 && L.spd < 0.15) { vx = 0; vz = 0; a.faceYaw = L.mode === MODE.STAND && L.faceSet ? L.faceYaw : L.yaw; a.faceSet = true; }
    this._steer(a, vx, vz, dt, 0.5);
  }
  _fieldStepFollow(a, dt) {
    // like _fieldStep but no arrival callbacks (the leader decides)
    if (a.rampNext >= 0) { this._rampApproach(a, dt); return; }
    const F = this.fields, nav = this.nav;
    this._updNode(a);
    const v = a.node;
    if (v < 0) { this._steer(a, 0, 0, dt); return; }
    const w1 = F.next(a.en, v);
    if (w1 < 0) { this._steer(a, (a.leader.x - a.x), (a.leader.z - a.z), dt); return; }
    if (nav.rmp[w1] >= 0) { this._beginRamp(a, nav.rmp[w1]); return; }
    const w2 = F.next(a.en, w1);
    const t = w2 >= 0 && nav.rmp[w2] < 0 ? w2 : w1;
    const dx = nav.x[t] - a.x, dz = nav.z[t] - a.z, l = Math.hypot(dx, dz) || 1;
    const sp = a.pref * 1.12;
    this._steer(a, dx / l * sp, dz / l * sp, dt);
  }

  // ---------------------------------------------------------------------------
  // Ramps (escalators / stairs)
  _beginRamp(a, ri, fixed, like) {
    if (!fixed) ri = this._rampChoice(a, ri);
    const R = this.places.ramps[ri], r = R.r;
    a.rampNext = ri;
    const fromLow = a.level === r.lower;
    a.rampFromLow = fromLow;
    const end = fromLow ? R.ends.low : R.ends.high;
    const tx = -end.dx, tz = -end.dz; // into the ramp
    const rx = -tz, rz = tx;            // right of travel
    let u;
    if (R.esc) {
      const able = !(a.flags & (1 << 3)) && a.kind !== 'elderly' && a.kind !== 'child' && a.kind !== 'tourist';
      a.walkLane = like ? like.walkLane : a.hurry > 0.62 && able;
      // v4 critic: the stand lane backed up and the walk lane (nearly) empty => able people walk down/up the left lane instead
      // of joining a 20-person line (lunch at the CITY 2F down escalator grew a 30-person blob with the walk lane idle)
      if (!like && !a.walkLane && able) {
        const pre = fromLow ? 'qL' : 'qH', live = (q) => q ? q.reduce((n, b) => n + (b.alive && b.rampQ === q ? 1 : 0), 0) : 0;
        const ns = live(R[pre + 's']), nw = live(R[pre + 'w']);
        if (ns >= 4 && nw * 2 + 2 < ns) a.walkLane = true;
      }
      u = (a.walkLane ? -0.24 : 0.24) * ESC_STAND_SIDE; // +u = right of travel
    } else {
      a.walkLane = true;
      const hw = Math.max(0.3, R.hw - 0.3);
      u = (0.15 + this.rnd() * 0.85) * hw * (this.rnd() < 0.85 ? ESC_STAND_SIDE : -ESC_STAND_SIDE); // stairs: same side as escalator standers
    }
    a.rampU = u;
    a.aimX = end.x + end.dx * RAMP_AIM + rx * u; a.aimZ = end.z + end.dz * RAMP_AIM + rz * u;
    a.rampAimX = a.aimX; a.rampAimZ = a.aimZ;
    // single-file queue per lane and end
    const qk = (fromLow ? 'qL' : 'qH') + (R.esc ? (a.walkLane ? 'w' : 's') : '');
    this._rampDequeue(a);
    // join the line in order of distance to the mouth
    const q = (R[qk] = R[qk] || []); a.rampQ = q;
    const da = Math.hypot(a.x - a.aimX, a.z - a.aimZ);
    let at = q.length;
    for (let i = 0; i < q.length; i++) { const b = q[i]; if (!b.alive || b.rampQ !== q) continue; if (Math.hypot(b.x - a.aimX, b.z - a.aimZ) > da + 0.4) { at = i; break; } }
    q.splice(at, 0, a);
  }
  // people waiting at an escalator mouth (both lanes, this end)
  _rampLoad(R, fromLow) {
    let n = 0;
    for (const k of fromLow ? ['qLs', 'qLw', 'qL'] : ['qHs', 'qHw', 'qH']) { const q = R[k]; if (q) for (const b of q) if (b.alive && b.rampNext >= 0 && this.places.ramps[b.rampNext] === R) n++; }
    return n;
  }
  // a long line at this escalator: take the stairs / the next escalator going the same way if the total time (walk + wait) is
  // clearly shorter. Cost in seconds: ~0.85 s per person in the line (one step each), ~1.25 m/s to walk there, stairs +3 s.
  _rampChoice(a, ri) {
    const P = this.places, R = P.ramps[ri], fromLow = a.level === R.r.lower;
    const load = this._rampLoad(R, fromLow);
    if (load < 4) return ri;
    const end = fromLow ? R.ends.low : R.ends.high;
    const slow = a.kind === 'elderly' || (a.flags & (1 << 3));      // elderly / suitcase: no stairs
    let best = ri, bc = load * 0.85 + Math.hypot(end.x - a.x, end.z - a.z) / 1.25;
    for (let j = 0; j < P.ramps.length; j++) {
      if (j === ri) continue;
      const Q = P.ramps[j];
      if (Q.r.lower !== R.r.lower || Q.r.upper !== R.r.upper) continue;
      if (Q.esc && Q.r.move !== (fromLow ? 1 : -1)) continue;
      if (!Q.esc && slow) continue;
      const e = fromLow ? Q.ends.low : Q.ends.high;
      const d = Math.hypot(e.x - a.x, e.z - a.z);
      if (d > 18) continue;
      const c = this._rampLoad(Q, fromLow) * (Q.esc ? 0.85 : 0.3) + d / 1.25 + (Q.esc ? 0 : 3);
      if (c + 3 < bc) { bc = c; best = j; }
    }
    return best;
  }
  _rampDequeue(a) {
    const q = a.rampQ;
    if (q) { const k = q.indexOf(a); if (k >= 0) q.splice(k, 1); }
    a.rampQ = null;
  }
  _rampApproach(a, dt) {
    const R = this.places.ramps[a.rampNext];
    const end = a.rampFromLow ? R.ends.low : R.ends.high;
    // waiting: stand in line behind the people ahead of us. Rank = how many people of this lane are physically closer to the
    // mouth (so the nearest person always steps on next and an order mix-up can never starve the escalator).
    const q = a.rampQ;
    let rank = 0;
    if (q) {
      const dA = Math.hypot(a.x - a.rampAimX, a.z - a.rampAimZ);
      for (let i = 0; i < q.length; i++) {
        const b = q[i]; if (b === a || !b.alive || b.rampNext !== a.rampNext) continue;
        const dB = Math.hypot(b.x - a.rampAimX, b.z - a.rampAimZ);
        if (dB < 9 && (dB < dA - 0.05 || (dB < dA + 0.05 && b.serial < a.serial))) rank++;
      }
    }
    // a long line: the tail re-checks the other lanes / the stairs from time to time
    if (rank >= 4 && this.time > (a.rcT || 0)) {
      a.rcT = this.time + 1.5 + this.rnd();
      const alt = this._rampChoice(a, a.rampNext);
      if (alt !== a.rampNext) { this._beginRamp(a, alt, true); return; }
    }
    // single file behind the mouth (rank 0..ROW-1), further people wait in a second / third file beside it, not in a blob
    const ROW = 8, col = Math.floor(rank / ROW), row = rank - col * ROW;
    const back = 0.66 * row + 0.25 * col;
    const side = a.rampU < 0 ? -1 : 1;
    const tx = -end.dx, tz = -end.dz, px = -tz, pz = tx;                  // travel direction into the ramp, and its right-hand side
    const u0 = Math.abs(a.rampU);
    let uw = u0 * (1 + 0.85 * Math.min(1, Math.max(0, back - 0.3) / 1.0)) + 0.8 * col;
    if (!R.esc) uw = Math.min(uw, Math.max(0.3, R.hw - 0.25));
    const u = side * uw;
    a.aimX = end.x + end.dx * (RAMP_AIM + back) + px * u; a.aimZ = end.z + end.dz * (RAMP_AIM + back) + pz * u;
    const dx = a.aimX - a.x, dz = a.aimZ - a.z, l = Math.hypot(dx, dz);
    // distance to the end line along the ramp axis
    const along = (a.x - end.x) * end.dx + (a.z - end.z) * end.dz;
    const lat = Math.abs((a.x - a.aimX) * -end.dz + (a.z - a.aimZ) * end.dx);
    a.queueing = l < 4.5;
    // the head of the line: stuck close to the mouth (a neighbour's personal space) for a moment => steps on anyway
    if (rank === 0 && l < 1.8 && a.spd < 0.08) a.headT = (a.headT || 0) + dt; else a.headT = 0;
    // v5: lateral tolerance 0.8 -> 0.6 m (the rest of the sideways error is eased out by the boarding spring in _startRide / _placeOnRamp)
    if ((rank === 0 && (l < 0.5 || (along < 1.0 && lat < 0.6) || a.headT > 0.8)) || a.tier === 2) {
      if (R.esc && a.tier !== 2) {
        const tNext = a.walkLane ? R.nextWalk : R.nextStand;
        if (this.time < tNext) { this._steer(a, 0, 0, dt); a.faceYaw = Math.atan2(end.dx, end.dz); a.faceSet = true; return; }
        // a line forming: people close up and step on faster (still one per step or two)
        const busy = q && q.length > 4 ? 0.8 : 1;
        if (a.walkLane) R.nextWalk = this.time + (0.52 + this.rnd() * 0.15) * busy; else R.nextStand = this.time + (0.7 + this.rnd() * 0.25) * busy;
      }
      a.headT = 0;
      this._startRide(a);
      return;
    }
    if (l > 20 + rank * 0.7) { this._rampDequeue(a); a.rampNext = -1; a.aimT = 0; return; } // pushed away; re-plan
    let sp = a.pref;
    if (l < 2.5) sp *= Math.max(rank > 0 ? 0.0 : 0.5, l / 2.5);
    if (rank > 0 && l < 0.3) { this._steer(a, 0, 0, dt); a.faceYaw = Math.atan2(end.dx, end.dz); a.faceSet = true; return; }
    this._steer(a, dx / l * sp, dz / l * sp, dt);
  }
  _startRide(a) {
    const R = this.places.ramps[a.rampNext];
    this._rampDequeue(a);
    // v5: boarding is a continuation of the walk. The rider starts where the person IS: its distance outside the start line becomes a
    // negative ramp parameter (rs < 0, or > 1 at the top end), its speed along the ramp relaxes to the belt speed over ~0.3 s, and the
    // little sideways error to the lane is a critically damped spring; the facing eases from the walking heading to the lane direction.
    // (v4: position snapped onto the lane start, yaw snapped to the ramp, speed jumped to the belt speed: "teleports onto it".)
    const ox = a.x, oz = a.z, ovx = a.vx, ovz = a.vz, yaw0 = a.yaw;
    const fromLow = a.rampFromLow, end = fromLow ? R.ends.low : R.ends.high;
    a.ramp = a.rampNext; a.rampNext = -1; a.queueing = false;
    a.rs = fromLow ? 0 : 1; a.rdir = fromLow ? 1 : -1;
    a.ru = a.rampU;
    a.rspd = R.esc ? (0.5 + (a.walkLane ? 0.55 + a.hurry * 0.3 : 0)) : a.pref * 0.62;
    a.rsp = a.rspd;
    a.prevMode = a.mode === MODE.FOLLOW ? MODE.FOLLOW : MODE.FIELD;
    a.mode = MODE.RIDE;
    R.riders.push(a);
    a.bo = false; a.bx = a.bz = a.bvx = a.bvz = 0; a.boardK = 1;
    if (a.tier !== 2) {
      const along = (ox - end.x) * end.dx + (oz - end.z) * end.dz;           // metres outside the start line (+)
      if (along > -1.0 && along < 2.0) {
        const tx = -end.dx, tz = -end.dz;                                   // into the ramp
        a.rs = fromLow ? -along / R.len : 1 + along / R.len;
        a.rsp = Math.max(0, ovx * tx + ovz * tz);                           // current speed along the ramp
        this._placeOnRamp(a, 0, a.rsp);
        const bx = ox - a.x, bz = oz - a.z;                                 // what is left is the sideways error (lane axis is the ramp axis)
        const bm = Math.hypot(bx, bz);
        if (bm < 2.2) {
          a.bw = Math.max(3, Math.min(BOARD_W, 4.2 / Math.max(bm, 1e-3)));   // a big error (a blocked head stepping on from the side) is eased out more gently
          a.bx = bx; a.bz = bz; a.bvx = ovx - tx * a.rsp; a.bvz = ovz - tz * a.rsp; a.bo = true; a.boardK = 0;
          a.x = ox; a.z = oz; a.vx = ovx; a.vz = ovz; a.yaw = yaw0; a.y = rampProfile(R.r, Math.min(1, Math.max(0, a.rs)));
          return;
        }
        a.rs = fromLow ? 0 : 1; a.rsp = a.rspd;                             // not lined up at all: snap (rare re-plan glitch)
      }
    }
    this._placeOnRamp(a, 0, a.rspd);
  }
  // Put a rider on its lane at ramp parameter a.rs. dt > 0: advance the boarding offset (spring) and ease the facing; sp = speed along the ramp.
  _placeOnRamp(a, dt, sp) {
    const R = this.places.ramps[a.ramp], E = R.ends;
    const cx = E.low.x + (E.high.x - E.low.x) * a.rs, cz = E.low.z + (E.high.z - E.low.z) * a.rs;
    // travel direction
    let tx = (E.high.x - E.low.x) * a.rdir, tz = (E.high.z - E.low.z) * a.rdir;
    const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    const rx = -tz, rz = tx;
    if (sp === undefined) sp = a.rspd;
    let vx = tx * sp, vz = tz * sp;
    if (a.bo) {
      // critically damped spring on the sideways error (position AND velocity continuous): off'' = -2w off' - w^2 off
      const w = a.bw || BOARD_W, e = Math.exp(-w * dt);
      const cx1 = a.bvx + w * a.bx, cz1 = a.bvz + w * a.bz;
      const nbx = (a.bx + cx1 * dt) * e, nbz = (a.bz + cz1 * dt) * e;
      a.bvx = (a.bvx - w * cx1 * dt) * e; a.bvz = (a.bvz - w * cz1 * dt) * e; a.bx = nbx; a.bz = nbz;
      a.boardK = Math.min(1, a.boardK + dt / BOARD_BLEND);
      if (a.boardK >= 1 && Math.abs(a.bx) + Math.abs(a.bz) + Math.abs(a.bvx) + Math.abs(a.bvz) < 0.01) { a.bo = false; a.bx = a.bz = a.bvx = a.bvz = 0; }
      vx += a.bvx; vz += a.bvz;
    }
    a.x = cx + rx * a.ru + a.bx; a.z = cz + rz * a.ru + a.bz;
    a.y = rampProfile(R.r, Math.min(1, Math.max(0, a.rs)));
    a.vx = vx; a.vz = vz;
    // facing: along the actual motion while the sideways error is settling, the lane direction once it has
    const laneYaw = Math.atan2(-tx, -tz);
    if (!(dt > 0)) { a.yaw = laneYaw; return; }
    let ty = laneYaw;
    if (a.bo) { const vm = Math.hypot(vx, vz); if (vm > 0.25) { const my = Math.atan2(-vx, -vz); const k = Math.min(1, Math.hypot(a.bx, a.bz) / 0.12); ty = laneYaw + wrap(my - laneYaw) * k; } }
    const d = wrap(ty - a.yaw), lim = 5.5 * dt;
    let st = d * (1 - Math.exp(-9 * dt));
    st = st > lim ? lim : st < -lim ? -lim : st;
    a.yaw = wrap(a.yaw + st);
  }
  _ride(a, dt) {
    const R = this.places.ramps[a.ramp];
    let sp = a.rspd;
    // spacing: don't run into the rider ahead on the same side
    for (const b of R.riders) {
      if (b === a || b.rdir !== a.rdir || Math.abs(b.ru - a.ru) > 0.35) continue;
      const ahead = (b.rs - a.rs) * a.rdir * R.len;
      if (ahead > 0 && ahead < 0.7) sp = Math.min(sp, b.rspd * Math.max(0, (ahead - 0.42) / 0.28));
    }
    // boarding: the speed along the ramp relaxes from the walking speed to the belt speed (a stander arriving at 1.2 m/s slows, a
    // person stepping on from rest picks up) instead of jumping
    if (a.boardK < 1 || a.rsp !== sp) a.rsp += (sp - a.rsp) * (a.boardK < 1 ? 1 - Math.exp(-dt / 0.3) : 1);
    sp = a.rsp;
    a.curRideSpd = sp;
    a.rs += a.rdir * sp * dt / R.len;
    // v5: the rider keeps gliding EXIT_RUN metres past the end line (on the landing floor, still a rider: no collision yet) and only
    // then becomes a walker, with its own velocity. (Was: at the line, teleport 0.35 m forward, velocity reset to walking pace.)
    const over = a.rdir > 0 ? a.rs - 1 : -a.rs;
    if (over >= EXIT_RUN / R.len) {
      const r = R.r;
      const up = a.rdir > 0;
      this._placeOnRamp(a, dt, sp);
      this._leaveRide(a);
      a.level = up ? r.upper : r.lower; a.lv = this.lvIndex[a.level];
      a.y = LEVELS[a.level].y;
      a.ramp = -1; a.mode = a.prevMode || MODE.FIELD; a.aimT = 0; a.node = -1; this._updNode(a);
      a.spd = Math.hypot(a.vx, a.vz); a.bo = false; a.boardK = 1;
      if (this.behave && this.behave.onRideEnd) this.behave.onRideEnd(a, R);
      return;
    }
    this._placeOnRamp(a, dt, sp);
    a.spd = a.bo ? Math.hypot(a.vx, a.vz) : sp;
  }
  _leaveRide(a) {
    if (a.ramp < 0) return;
    const R = this.places.ramps[a.ramp];
    const k = R.riders.indexOf(a); if (k >= 0) R.riders.splice(k, 1);
  }

  // ---------------------------------------------------------------------------
  // Ticket gates
  _gateCheck(a, G) {
    const ax = G.axis === 'x';
    const pa = (ax ? a.z : a.x) - G.at, pb = (ax ? a.aimZ : a.aimX) - G.at;
    if (Math.abs(pa) > 3.6 || pa * pb > 0 || Math.abs(pa) < 0.05) return false;
    const lat = ax ? a.x : a.z;
    if (lat < G.lo - 1 || lat > G.hi + 1) return false;
    const side = pa > 0 ? 1 : -1;
    const want = (lat + (ax ? a.aimX : a.aimZ)) * 0.5;
    let best = -1, bc = Infinity;
    const entering = G.paidSide !== 0 && -side === G.paidSide;
    for (let i = 0; i < G.lanes.length; i++) {
      const pol = G.policy ? G.policy[i] : 'both';
      if (G.paidSide && ((pol === 'in' && !entering) || (pol === 'out' && entering))) continue;
      const c = Math.abs(G.lanes[i] - want) + G.load[i] * 1.7 + (G.occDir[i] === side ? 1.5 : 0);
      if (c < bc) { bc = c; best = i; }
    }
    if (best < 0) return false;
    a.gate = G; a.lane = best; a.gside = side; a.gstage = 0; a.tapDone = false; G.load[best]++;
    a.mode = MODE.GATE;
    return true;
  }
  _gateStep(a, dt) {
    const G = a.gate, ax = G.axis === 'x', lane = G.lanes[a.lane];
    const side = a.gside;
    if (a.tier === 2) { this._gateDone(a, true); return; }
    if (a.gstage === 0) {
      const tx = ax ? lane : G.at + side * 1.15, tz = ax ? G.at + side * 1.15 : lane;
      const dx = tx - a.x, dz = tz - a.z, l = Math.hypot(dx, dz);
      a.queueing = l < 3;
      const passed = ((ax ? a.z : a.x) - G.at) * side < 1.25;
      if (l < 0.4 || (passed && l < 1.0)) {
        if (this.time >= G.busy[a.lane] && (G.occDir[a.lane] === 0)) {
          a.gstage = 1; G.occDir[a.lane] = side; G.busy[a.lane] = this.time + 0.55 + this.rnd() * 0.5;
        } else { this._steer(a, dx * 0.5, dz * 0.5, dt); return; }
      } else {
        const sp = a.pref * (l < 2 ? Math.max(0.45, l / 2) : 1);
        this._steer(a, dx / l * sp, dz / l * sp, dt, 0.7);
        return;
      }
    }
    // stage 1: through the lane
    const tx = ax ? lane : G.at - side * 1.4, tz = ax ? G.at - side * 1.4 : lane;
    const dx = tx - a.x, dz = tz - a.z, l = Math.hypot(dx, dz);
    const before = ((ax ? a.z : a.x) - G.at) * side;
    if (!a.d) a.d = {};
    // v7: IC-card tap. The hand-to-reader contact lands ~0.4 s into the gesture (render.js TAP_*), and the gate's reader flash fires
    // when the person crosses the flap line below, so start the gesture 0.4 s before that crossing (time-to-line from the current
    // speed). Purely visual: it never touches the walk (no stop, no speed change).
    if (!a.gPassed && !a.tapDone && a.tier < 2) {
      const eta = before / Math.max(0.35, a.spd);
      if (eta <= 0.4) { a.tapAt = this.time - Math.max(0, 0.4 - eta); a.tapDone = true; }
    }
    if (before < 0 && !a.gPassed) {
      a.gPassed = true;
      if (G.occDir[a.lane] === side) G.occDir[a.lane] = 0;
      if (this.ctx && this.ctx.transit && typeof this.ctx.transit.gatePass === 'function' && a.tier === 0) {
        try { this.ctx.transit.gatePass(G.id, a.lane, -side); } catch (e) { /* transit owns it */ }
      }
      if (this.events) this.events.emit('crowd:gate', { gate: G.id, lane: a.lane, dir: -side, level: G.level, x: a.x, z: a.z, near: a.tier === 0 });
    }
    if (l < 0.45) { this._gateDone(a, false); return; }
    // walk straight down the lane centre (no lateral pushes) at tap-and-go pace
    const sp = Math.min(a.pref, 1.0);
    const vx = dx / l * sp, vz = dz / l * sp;
    a.vx += (vx - a.vx) * Math.min(1, dt * 6); a.vz += (vz - a.vz) * Math.min(1, dt * 6);
    a.x += a.vx * dt; a.z += a.vz * dt;
    if (ax) a.x += (lane - a.x) * Math.min(1, dt * 5); else a.z += (lane - a.z) * Math.min(1, dt * 5);
    a.spd = Math.hypot(a.vx, a.vz);
    this._turn(a, Math.atan2(-a.vx, -a.vz), dt);
  }
  _gateDone(a, skip) {
    const G = a.gate;
    if (G) {
      G.load[a.lane] = Math.max(0, G.load[a.lane] - 1);
      if (G.occDir[a.lane] === a.gside && !a.gPassed) G.occDir[a.lane] = 0;
      if (skip) { const ax = G.axis === 'x'; const lane = G.lanes[a.lane]; if (ax) { a.x = lane; a.z = G.at - a.gside * 1.4; } else { a.z = lane; a.x = G.at - a.gside * 1.4; } }
    }
    a.gate = null; a.lane = -1; a.gPassed = false; a.queueing = false;
    a.mode = a.leader ? MODE.FOLLOW : MODE.FIELD; a.aimT = 0; a.node = -1; this._updNode(a);
  }

  // ---------------------------------------------------------------------------
  // Local steering: desired velocity (dvx,dvz) + avoidance, then grid collision.
  _steer(a, dvx, dvz, dt, sepScale = 1) {
    if (a.tier === 2) {
      a.x += dvx * dt; a.z += dvz * dt; a.vx = dvx; a.vz = dvz; a.spd = Math.hypot(dvx, dvz);
      if (a.spd > 0.1) a.yaw = Math.atan2(-dvx, -dvz); else if (a.faceSet) a.yaw = a.faceYaw;
      return;
    }
    const dmag = Math.hypot(dvx, dvz);
    let hx, hz;
    if (dmag > 0.05) { hx = dvx / dmag; hz = dvz / dmag; } else { hx = -Math.sin(a.yaw); hz = -Math.cos(a.yaw); }
    let fx = 0, fz = 0, cap = 9;
    const R0 = 0.5 + a.space * 0.35;
    const queue = a.queueing;
    const self = a;
    const avx = a.vx, avz = a.vz;
    const standing = dmag < 0.05;
    this.near(a.level, a.x, a.z, 2.4, (b, dx, dz, d2) => {
      if (b === self || b.ramp >= 0) return;
      const d = Math.sqrt(d2) || 1e-3;
      // personal space
      const rr = standing ? 0.52 : R0;
      if (d < rr) {
        const k = (rr - d) / rr * (standing ? 1.1 : 1.9) * sepScale * (b.leader === self || self.leader === b || (self.leader && self.leader === b.leader) ? 0.35 : 1);
        fx -= dx / d * k; fz -= dz / d * k;
      }
      if (standing) return;
      // anticipatory avoidance
      const wx = b.vx - avx, wz = b.vz - avz, w2 = wx * wx + wz * wz;
      if (w2 > 0.04) {
        const t = -(dx * wx + dz * wz) / w2;
        if (t > 0 && t < 2.2) {
          let cx = dx + wx * t, cz = dz + wz * t, c = Math.hypot(cx, cz);
          if (c < 0.78) {
            if (c < 0.08) { cx = -hz * 0.08; cz = hx * 0.08; c = 0.08; } // dead ahead: both keep left
            const s = (1 - t / 2.2) * (0.78 - c) / 0.78 * 1.5;
            fx -= cx / c * s; fz -= cz / c * s;
          }
        }
      }
      // brake behind someone slower directly ahead
      const ahead = dx * hx + dz * hz;
      if (ahead > 0 && ahead < 1.5) {
        const lat = Math.abs(dx * hz - dz * hx);
        if (lat < (queue ? 0.55 : 0.36)) {
          const bf = b.vx * hx + b.vz * hz;
          const cb = Math.max(0, bf + (ahead - (queue ? 0.62 : 0.72)) * 1.7);
          if (cb < cap) cap = cb;
        }
      }
    });
    // the player: a moving obstacle everyone anticipates. Sidestep early (keep left), slow down close by,
    // never push through. (Hard separation after the move below.)
    const V = this.viewer;
    let nearPlayer = false;
    if (V.has && V.level === a.level && V.ramp < 0) {
      const dx = V.x - a.x, dz = V.z - a.z, d2 = dx * dx + dz * dz;
      if (d2 < 49) {
        nearPlayer = true;
        const d = Math.sqrt(d2) || 1e-3;
        // personal space (stronger than between strangers)
        if (d < 1.05) { const k = (1.05 - d) / 1.05 * (standing ? 2.2 : 3.4); fx -= dx / d * k; fz -= dz / d * k; }
        const pspd = Math.hypot(V.vx, V.vz);
        if (!standing) {
          // anticipatory: time to closest approach with the player's real velocity, bigger radius, longer horizon
          const wx = V.vx - avx, wz = V.vz - avz, w2 = wx * wx + wz * wz;
          if (w2 > 0.02) {
            const t = -(dx * wx + dz * wz) / w2;
            if (t > 0 && t < 3.5) {
              let cx = dx + wx * t, cz = dz + wz * t, c = Math.hypot(cx, cz);
              if (c < 1.15) {
                // head-on: pick the side so that we pass keeping left (or whichever side the player is not on)
                if (c < 0.12) { const lat0 = dx * hz - dz * hx; const sd = lat0 > 0.05 ? 1 : lat0 < -0.05 ? -1 : -1; /* +1 = steer right */ cx = hz * sd * 0.12; cz = -hx * sd * 0.12; c = 0.12; }
                const sgain = (1 - t / 3.5) * (1.15 - c) / 1.15 * 2.6;
                fx -= cx / c * sgain; fz -= cz / c * sgain;
              }
            }
          }
          const ahead = dx * hx + dz * hz, lat = dx * hz - dz * hx;
          if (ahead > 0 && ahead < 5 && Math.abs(lat) < 1.1) {
            // the player is in our lane: drift to the free side early (default: our left)
            // (lat > 0: the player is on our left; +side steers right)
            const side = lat > 0.15 ? 1 : lat < -0.15 ? -1 : -1;
            const sgain = (1 - ahead / 5) * 1.6;
            fx += -hz * side * sgain; fz += hx * side * sgain;
            // and slow down when close in front
            if (ahead < 2.4) cap = Math.min(cap, Math.max(0.15, (ahead - 0.7) * 0.75 + (pspd > 0.4 ? 0.25 : 0)));
            if (ahead < 1.3 && Math.abs(lat) < 0.55 && pspd < 0.4) {
              a.blockT += dt;
              if (a.blockT > 0.25 && a.lookT <= 0) this.lookAt(a, V.x, V.z, 1.6);
              if (a.blockT > 0.9 && this.time > a.excuseT && this.time > this._excuseGlobal) {
                a.excuseT = this.time + 12; this._excuseGlobal = this.time + 2.2;
                if (this.events) this.events.emit('crowd:excuse', { level: a.level, x: a.x, y: a.y + 1.55 * (a.look ? a.look.h : 1), z: a.z, ja: 'すみません', en: 'Excuse me', kind: a.kind, female: a.look ? a.look.female : false });
              }
            } else a.blockT = Math.max(0, a.blockT - dt);
          }
        }
        // glance at the player when passing close
        if (d < 2.2 && a.lookT <= 0 && ((a.serial * 7 + Math.floor(this.time)) % 9) === 0) this.lookAt(a, V.x, V.z, 1.0);
      }
    }
    // stuck (a pillar the nav grid doesn't know, two flows head-on): slide round it, keeping left first
    if (!standing && a.stuckT > 0.7) {
      const side = ((Math.floor(a.stuckT / 1.6) + (a.i & 1)) & 1) ? -1 : 1;
      fx += -hz * side * 1.6; fz += hx * side * 1.6;
    }
    // integrate (relaxation towards desired + forces)
    const tau = standing ? 0.3 : 0.38;
    const k = Math.min(1, dt / tau);
    let tvx = dvx + fx, tvz = dvz + fz;
    a.vx += (tvx - a.vx) * k; a.vz += (tvz - a.vz) * k;
    let s = Math.hypot(a.vx, a.vz);
    const maxS = Math.max(0.3, a.pref * 1.35);
    if (s > maxS) { a.vx *= maxS / s; a.vz *= maxS / s; s = maxS; }
    if (cap < 9) {
      const fwd = a.vx * hx + a.vz * hz;
      if (fwd > cap) { const red = fwd - cap; a.vx -= hx * red; a.vz -= hz * red; }
    }
    if (standing && s < 0.08) { a.vx = 0; a.vz = 0; }
    const ox = a.x, oz = a.z;
    let mx = a.vx * dt, mz = a.vz * dt;
    if (nearPlayer) {
      // never step into the player (or let them overlap us): keep PLAYER_R from their centre
      const px = a.x + mx - V.x, pz = a.z + mz - V.z, pd = Math.hypot(px, pz);
      if (pd < PLAYER_R) {
        const k = (PLAYER_R - pd) / Math.max(1e-3, pd);
        mx += px * k; mz += pz * k;
        if (pd < 1e-3) { mx += -hz * 0.05; mz += hx * 0.05; }
      }
    }
    this.col.move(a, mx, mz, 0.24);
    const mvx = (a.x - ox) / dt, mvz = (a.z - oz) / dt;
    a.spd = Math.hypot(mvx, mvz);
    if (!standing && !queue && dmag > 0.3 && a.spd < 0.12) a.stuckT = (a.stuckT || 0) + dt; else if (a.stuckT) a.stuckT = Math.max(0, a.stuckT - dt * 0.5);
    if (a.stuckT > 4) a.stuckT = 0.71;
    // keep velocity consistent with what actually happened (walls)
    a.vx = mvx; a.vz = mvz;
    // facing
    if (a.spd > 0.18 && !standing) this._turn(a, Math.atan2(-a.vx, -a.vz), dt);
    else if (a.faceSet) this._turn(a, a.faceYaw, dt, 3);
  }
  _turn(a, target, dt, rate = 6) {
    const d = wrap(target - a.yaw);
    const m = rate * dt;
    a.yaw = wrap(a.yaw + Math.max(-m, Math.min(m, d)));
  }

  // ---------------------------------------------------------------------------
  // queries
  densityNear(level, x, z, r) {
    let n = 0; this.near(level, x, z, r, () => { n++; });
    return n / (Math.PI * r * r);
  }
  countNear(level, x, z, r) { let n = 0; this.near(level, x, z, r, () => { n++; }); return n; }
  agentsNear(level, x, z, r) { const out = []; this.near(level, x, z, r, (b) => { if (b.alive) out.push(b); }); return out; }
}

export function wrap(a) { if (!isFinite(a)) return 0; while (a > Math.PI) a -= TWO_PI; while (a < -Math.PI) a += TWO_PI; return a; }
function now() { return (typeof performance !== 'undefined' ? performance : Date).now(); }
