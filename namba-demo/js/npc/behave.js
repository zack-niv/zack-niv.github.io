// =============================================================================
// Agent behaviour: a trip is an ordered list of legs; each leg is a small state
// machine on top of the movement modes in sim.js.
//
//   go      {en, arrive}           follow a flow field (exit, platform, shop door…)
//   to      {x, z, rect?}          local path to a point
//   wait    {dur, pose, yaw?}
//   queue   {B}                    line up outside a restaurant / café
//   dine    {B, dur}               go in, sit (or stand at the counter), leave
//   browse  {B, n}                 wander a few spots inside a shop
//   board   {T}                    platform: door marking, wait, board the train
//   exit    {}                     leave the complex (fade out)
//   stroll  {A, dur}               Parks gardens: walk, look, photograph
//   hall    {H, dur}               browse a food hall / concourse
//   meet    {M, dur}               wait at a landmark for a friend
//   join    {target}               the friend: walk up, wave, leave together
//   post    {x, z, yaw, kind}      staff standing post (counter staff: C = ctx.counters entry)
//   patrol  {H}                    cleaners / security walking a hall
//   window  {B, dur}               stand at a shop window, looking in (v2)
//   order   {B}                    café: line up at the counter (beside the player's order spot), order, then dine (v2)
// =============================================================================
import { MODE, POSE } from './sim.js?v=c81de75';
import { BIT } from './looks.js?v=c81de75';
import { Director } from './trips.js?v=c81de75';
import { rng } from '../core/rng.js?v=c81de75';

export class Behave {
  constructor(sim, ctx) {
    this.sim = sim; this.P = sim.places; this.ctx = ctx;
    this.r = rng(((ctx && ctx.params && ctx.params.seed) || 20261005) ^ 0x5eed);
    this.director = new Director(sim, this, ctx);
    this._calloutT = 0;
  }
  get time() { return this.sim.time; }
  get scale() { return (this.sim.clock && this.sim.clock.scale) || 6; }

  // ---------------------------------------------------------------------------
  begin(a, legs) { a.legs = legs; a.leg = 0; this.startLeg(a); }
  nextLeg(a) { this.endLeg(a); a.leg++; this.startLeg(a); }
  endLeg(a) {
    const L = a.legs && a.legs[a.leg]; if (!L) return;
    if (L.t === 'queue' && L.B) { const k = L.B.queue.indexOf(a); if (k >= 0) L.B.queue.splice(k, 1); }
    if (L.t === 'order' && a.d && a.d.C) { const k = a.d.C.queue.indexOf(a); if (k >= 0) a.d.C.queue.splice(k, 1); }
    if (L.t === 'window' && a.d && a.d.w) { a.d.w.used = 0; }
    if (L.t === 'board') { if (a.mark) { a.mark.n[a.markK & 1] = Math.max(0, a.mark.n[a.markK & 1] - 1); a.mark = null; } if (L.T && L.T.boarders) L.T.boarders.delete(a); }
    if ((L.t === 'dine' || L.t === 'browse') && a.spot) { a.spot.used = 0; a.spot = null; if (L.t === 'dine' && L.B && a.d && a.d.counted) { L.B.seated = Math.max(0, L.B.seated - 1); a.d.counted = false; } }
    a.dyn = 0; a.d = null; a.queueing = false; a.faceSet = false; a.pose = POSE.WALK; a.seatH = 0; a.seatPhone = false; a.seatDone = false;
  }
  cleanup(a) {
    if (a.legs) this.endLeg(a);
    if (a.fstate && a.spot) { a.spot.used = 0; a.spot = null; }
    a.fstate = null;
    a.legs = null;
  }
  startLeg(a) {
    const S = this.sim, P = this.P;
    const L = a.legs && a.legs[a.leg];
    a.st = 0; a.t = 0; a.d = {}; a.pose = POSE.WALK; a.faceSet = false;
    if (!L) { this._finish(a); return; }
    switch (L.t) {
      case 'go': {
        if (!L.en) { this.nextLeg(a); return; }
        if (!L.en.ready) { a.mode = MODE.STAND; a.waitField = true; if (a.fadeDir === 0 && a.fade <= 0) { /* stays hidden */ } return; }
        a.waitField = false;
        S.setField(a, L.en, L.arrive || 1.2);
        if (a.nearStart) { a.nearStart = false; a.ffFrac = 0; if (!this.director.placeNear(a, false, 3, 60)) a.ffFrac = 0.5; }
        if (a.ffFrac > 0) this._fastForward(a);
        if (a.fadeDir === 0) this._reveal(a);
        a.hesT = 8 + this.r() * 30;
        return;
      }
      case 'to': S.goTo(a, L.x, L.z, L.rect, L.r || 0.4); return;
      case 'wait': S.stand(a, L.yaw); a.pose = L.pose != null ? L.pose : POSE.STAND; a.t = L.dur; return;
      case 'queue': {
        const B = L.B;
        if (B.queue.length >= (L.max || 14) || !P.bizOpen(B, this.director.minutes)) { this.nextLeg(a); return; }
        if (B.queue.length === 0 && B.seated < B.cap) { this.nextLeg(a); return; }
        B.queue.push(a);
        a.d.k = -1; a.biz = B;
        this._queueMove(a, L);
        return;
      }
      case 'dine': {
        const B = L.B;
        const s = P.takeSpot(B);
        if (!s) { this.nextLeg(a); return; }
        a.spot = s; a.biz = B; B.seated++; a.d.counted = true;
        a.d.dur = L.dur; a.d.B = B;
        if (L.inside) { S.setPos(a, B.level, s.sx ?? s.x, s.sz ?? s.z); a.st = 1; this._sitDown(a, B); this._reveal(a); }
        else S.goTo(a, s.sx ?? s.x, s.sz ?? s.z, B.rect, s.real ? 0.12 : 0.3);
        // the group comes along
        if (a.followers) for (const f of a.followers) {
          const fs = P.takeSpot(B); if (!fs) continue;
          f.fstate = 'dine'; f.spot = fs; f.biz = B; f.mode = MODE.PATH;
          if (L.inside) { S.setPos(f, B.level, fs.sx ?? fs.x, fs.sz ?? fs.z); f.mode = MODE.STAND; f.faceYaw = fs.real ? fs.yaw : Math.atan2(B.door.nx, B.door.nz) + Math.PI + (this.r() - 0.5); f.faceSet = true; f.yaw = f.faceYaw; this._seatOn(f, fs, B, true); this._reveal(f); }
          else S.goTo(f, fs.sx ?? fs.x, fs.sz ?? fs.z, B.rect, fs.real ? 0.12 : 0.3);
        }
        return;
      }
      case 'browse': {
        const B = L.B;
        a.biz = B; a.d.left = L.n || 2; a.d.B = B;
        if (L.inside) { const s = P.takeSpot(B); if (s) { a.spot = s; S.setPos(a, B.level, s.x, s.z); this._reveal(a); a.st = 1; S.stand(a, this.r() * 6.28); a.pose = POSE.BROWSE; a.t = 3 + this.r() * 10; return; } }
        this._browseNext(a, L);
        return;
      }
      case 'board': {
        const T = L.T; a.track = T;
        this.director.syncMarks(T);   // v8: queue at the doors of the train that will really stop here (before we join the boarders)
        (T.boarders || (T.boarders = new Set())).add(a);
        const m = this._pickMark(a, T);
        if (!m) { this.nextLeg(a); return; }
        a.mark = m; const col = m.n[0] <= m.n[1] ? 0 : 1; a.markK = col + 2 * m.n[col]; m.n[col]++;
        const sl = P.markSlot(m, a.markK);
        a.d.sl = sl;
        if (L.inside) { S.setPos(a, T.platform.level, sl.x, sl.z); a.st = 1; S.stand(a, sl.yaw); a.yaw = sl.yaw; a.pose = a.phoneUser > 0.4 ? POSE.PHONE : POSE.STAND; this._reveal(a); }
        else S.goTo(a, sl.x, sl.z, T.platform.rect, 0.25);
        a.d.maxWait = this.time + 200 + this.r() * 120;
        return;
      }
      case 'exit': {
        a.fadeDir = -1;
        if (a.followers) for (const f of a.followers) f.fadeDir = -1;
        // keep walking a few steps while fading
        const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw);
        S.goTo(a, a.x + fx * 2.5, a.z + fz * 2.5, null, 0.3);
        return;
      }
      case 'stroll': case 'hall': case 'patrol': {
        a.d.until = this.time + (L.dur || 60);
        this._wanderNext(a, L);
        return;
      }
      case 'meet': {
        a.d.until = this.time + (L.dur || 240);
        S.stand(a, this.r() * 6.28); a.pose = POSE.PHONE; a.dyn |= (1 << BIT.PHONE);
        if (L.inside) this._reveal(a);
        return;
      }
      case 'join': {
        const T = L.target;
        if (!T || !T.alive) { this.nextLeg(a); return; }
        S.goTo(a, T.x, T.z, null, 1.3);
        return;
      }
      case 'post': {
        S.setPos(a, L.level, L.x, L.z); a.yaw = L.yaw; S.stand(a, L.yaw); a.pose = POSE.STAND; this._reveal(a);
        a.d.next = this.time + 4 + this.r() * 12;
        return;
      }
      case 'window': {
        const w = this._windowSpot(L.B);
        if (!w) { this.nextLeg(a); return; }
        a.d.w = w; a.d.until = 0;
        if (L.inside) { S.setPos(a, L.B.level, w.x, w.z); a.yaw = w.yaw; this._arriveWindow(a, L); this._reveal(a); }
        else { S.goTo(a, w.x, w.z, null, 0.3); a.d.slow = 0.8; }
        return;
      }
      case 'order': {
        const C = L.B && L.B.ctr;
        if (!C || !C.npc || (C.queue.length >= 4)) { this.nextLeg(a); return; }
        C.queue.push(a); a.d.k = -1; a.d.C = C; a.d.orderT = 0;
        if (L.inside) { const sl = this._orderSlot(C, C.queue.length - 1); S.setPos(a, L.B.level, sl.x, sl.z); a.yaw = sl.yaw; this._reveal(a); }
        this._orderMove(a, L);
        return;
      }
      default: this.nextLeg(a);
    }
  }
  _finish(a) {
    // no more legs: plan something new (staff/stragglers) or leave quietly
    if (a.leader) return;
    a.fadeDir = -1;
    if (a.followers) for (const f of a.followers) f.fadeDir = -1;
  }
  _reveal(a) {
    const inst = this.sim.time < 2.5; // the opening fill is already there, nobody condenses out of the air
    if (a.fadeDir === 0) { a.fadeDir = 1; if (inst) a.fade = 1; }
    if (a.followers) for (const f of a.followers) if (f.fadeDir === 0) { f.fadeDir = 1; if (inst) f.fade = 1; }
  }

  // advance an agent along its current field (initial fill: mid-trip placement)
  _fastForward(a) {
    const S = this.sim, F = S.fields, nav = S.nav;
    S._updNode(a);
    const v0 = a.node; if (v0 < 0) { a.ffFrac = 0; return; }
    const total = a.en.dist[v0] * 0.1;
    let left = total * a.ffFrac;
    a.ffFrac = 0;
    let v = v0, guard = 3000;
    let lastFloor = v;
    while (guard-- > 0) {
      const w = F.next(a.en, v);
      if (w < 0) break;
      if (a.en.dist[w] <= a.arriveDm + 20) break;
      left -= nav.rmp[w] >= 0 ? 1.6 : Math.hypot(nav.x[w] - nav.x[v], nav.z[w] - nav.z[v]);
      v = w;
      if (nav.rmp[v] < 0) { lastFloor = v; if (left <= 0) break; }
    }
    v = lastFloor;
    // spread: never drop two people on the same spot (walk on a few nodes until there is room)
    const D = this.director;
    for (let k = 0; k < 10; k++) {
      const lvk = S.levelNames[nav.lvl[v]];
      if (D.free(lvk, nav.x[v] + a.jx, nav.z[v] + a.jz, 1.2)) break;
      const w = F.next(a.en, v);
      if (w < 0 || nav.rmp[w] >= 0 || a.en.dist[w] <= a.arriveDm + 20) break;
      v = w;
    }
    if (v !== v0) {
      const lv = S.levelNames[nav.lvl[v]];
      D.claim(lv, nav.x[v] + a.jx, nav.z[v] + a.jz);
      S.setPos(a, lv, nav.x[v] + a.jx, nav.z[v] + a.jz);
      const w = F.next(a.en, v);
      if (w >= 0) a.yaw = Math.atan2(-(nav.x[w] - nav.x[v]), -(nav.z[w] - nav.z[v]));
      a.vx = -Math.sin(a.yaw) * a.pref; a.vz = -Math.cos(a.yaw) * a.pref;
    }
    if (a.followers) for (const f of a.followers) this.director.placeFollower(a, f);
  }

  // ---------------------------------------------------------------------------
  tick(a, dt) {
    if (a.leader) { this._followerTick(a, dt); return; }
    const L = a.legs && a.legs[a.leg];
    if (!L) { if (a.mode !== MODE.FOLLOW && a.fadeDir >= 0 && a.legs) this._finish(a); return; }
    const S = this.sim;
    switch (L.t) {
      case 'go': {
        if (a.waitField) { if (L.en.ready) { this.startLeg(a); } return; }
        // hesitation (tourists, low confidence): stop, look up at signs, check the phone, sometimes turn back
        if (a.mode === MODE.FIELD && a.conf < 0.6) {
          a.hesT -= dt;
          if (a.hesT <= 0 && a.tier < 2) {
            const r = this.r();
            if (r < 0.18 && a.rampNext < 0) {
              // wrong way: walk back a few metres, then think again
              const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw);
              const tx = a.x + fx * 6, tz = a.z + fz * 6;
              if (S.col.walkable(a.level, tx, tz)) { a.d.back = true; S.goTo(a, tx, tz, null, 0.8); a.pose = POSE.WALK; }
            } else if (a.rampNext < 0 && !a.followers && !this._nearRampOrGate(a)) {
              // stop to look at the signs / the phone, but first step out of the flow to the side (keep left)
              const side = this._asidePoint(a);
              if (side) { a.d.aside = true; a.d.hesPose = r < 0.6 ? POSE.LOOKUP : POSE.PHONE; S.goTo(a, side.x, side.z, null, 0.35); a.d.slow = 0.7; }
            }
            a.hesT = 15 + this.r() * 40 * (0.5 + a.conf);
          }
        }
        if (a.d.hes && this.time > a.d.hes) { a.d.hes = 0; S.setField(a, L.en, L.arrive || 1.2); a.dyn &= ~(1 << BIT.PHONE); }
        a.pose = a.mode === MODE.STAND && a.d.hes ? a.d.hesPose : (a.phoneWalk ? POSE.PHONE : POSE.WALK);
        if (a.phoneWalk) a.dyn |= (1 << BIT.PHONE);
        return;
      }
      case 'wait': {
        a.t -= dt; if (a.t <= 0) this.nextLeg(a);
        return;
      }
      case 'queue': {
        const B = L.B;
        const k = B.queue.indexOf(a);
        if (k < 0) { this.nextLeg(a); return; }
        if (k === 0 && B.seated < B.cap && this.time > (B.nextAdmit || 0)) {
          B.nextAdmit = this.time + 1.2 + this.r() * 2.5;
          this.nextLeg(a); return;
        }
        if (k !== a.d.k) this._queueMove(a, L);
        a.queueing = true;
        // patience
        a.t += dt;
        if (a.t > 600 * a.patience && k > 4) { this.endLeg(a); a.leg = a.legs.length - 1; this.startLeg(a); }
        if (a.mode === MODE.STAND) a.pose = a.phoneUser > 0.3 || (a.serial & 3) === 0 ? POSE.PHONE : POSE.STAND;
        if (a.pose === POSE.PHONE) a.dyn |= (1 << BIT.PHONE); else a.dyn &= ~(1 << BIT.PHONE);
        if (a.followers && a.mode === MODE.STAND) a.pose = POSE.TALK;
        return;
      }
      case 'dine': {
        const B = L.B;
        if (a.st === 1) {
          a.d.dur -= dt;
          if (a.d.dur <= 0) {
            a.st = 2;
            if (a.spot) { a.spot.used = 0; a.spot = null; }
            if (a.d.counted) { B.seated = Math.max(0, B.seated - 1); a.d.counted = false; }
            if (a.followers) for (const f of a.followers) { if (f.spot) { f.spot.used = 0; f.spot = null; } f.fstate = null; f.mode = MODE.FOLLOW; f.pose = POSE.WALK; f.seatH = 0; f.seatPhone = false; f.seatDone = false; }
            a.pose = POSE.WALK; a.dyn = 0; a.seatH = 0; a.seatPhone = false; a.seatDone = false;
            S.goTo(a, B.door.ox, B.door.oz, B.rect, 0.6);
          } else if (a.cafeCup) a.dyn |= (1 << BIT.CUP);
        }
        return;
      }
      case 'browse': {
        if (a.st === 1) { a.t -= dt; if (a.t <= 0) this._browseNext(a, L); }
        return;
      }
      case 'board': {
        const T = L.T;
        if (a.st === 1) {
          // waiting at the door marking; v8: the leaves must be open (the old "waited long enough" fallback walked people into car walls)
          if (this.director.doorsOpen(T)) {
            a.st = 2;
            if (a.mark) { a.mark.n[a.markK & 1] = Math.max(0, a.mark.n[a.markK & 1] - 1); }
            this._enterDoor(a, T);
            a.pose = POSE.WALK; a.dyn = 0;
            a.d.boardBy = this.time + 10;
          } else if (this.time > a.d.maxWait) { this.nextLeg(a); }
          else {
            a.t2 -= dt;
            if (a.t2 <= 0) { a.t2 = 3 + this.r() * 8; if (a.pose !== POSE.PHONE) { a.lookYaw = (this.r() - 0.5) * 1.4; a.lookT = 2; } }
            if (a.pose === POSE.PHONE) a.dyn |= (1 << BIT.PHONE);
          }
        } else if (a.st === 2 && a.fadeDir >= 0) {
          // v8: the doors closed (or it took too long) before this person reached the doorway: go back to the queue, never fade in the platform
          const into = this._intoTrain(a, T);
          // in the doorway (the platform-edge collision can hold people ~0.25 m short of the door line): step in and fade
          if (into > -0.3) { a.fadeDir = -1; if (a.followers) for (const f of a.followers) f.fadeDir = -1; }
          else if (!this.director.doorsOpen(T) || this.time > a.d.boardBy) {
            a.st = 0; a.mark = null; a.d.maxWait = Math.max(a.d.maxWait, this.time + 120);
            const m = this._pickMark(a, T);
            if (m) { a.mark = m; const col = m.n[0] <= m.n[1] ? 0 : 1; a.markK = col + 2 * m.n[col]; m.n[col]++; const sl = this.P.markSlot(m, a.markK); a.d.sl = sl; S.goTo(a, sl.x, sl.z, T.platform.rect, 0.25); }
            else this.nextLeg(a);
          }
        }
        return;
      }
      case 'stroll': case 'hall': case 'patrol': {
        if (a.st === 1) {
          a.t -= dt;
          if (a.t <= 0) { a.dyn = 0; if (this.time > a.d.until) this.nextLeg(a); else this._wanderNext(a, L); }
        }
        if (L.t === 'patrol') { a.pose = a.flags & (1 << BIT.CART) ? POSE.CART : (a.st === 1 ? POSE.STAND : POSE.WALK); }
        return;
      }
      case 'meet': {
        a.t2 -= dt;
        if (a.t2 <= 0) { a.t2 = 2 + this.r() * 5; a.lookYaw = (this.r() - 0.5) * 2.0; a.lookT = 1.8; a.pose = this.r() < 0.6 ? POSE.PHONE : POSE.STAND; if (a.pose === POSE.PHONE) a.dyn |= (1 << BIT.PHONE); else a.dyn &= ~(1 << BIT.PHONE); }
        if (a.d.waveUntil) { a.pose = POSE.WAVE; a.dyn &= ~(1 << BIT.PHONE); if (this.time > a.d.waveUntil) { a.d.waveUntil = 0; this.nextLeg(a); } return; }
        if (this.time > a.d.until) this.nextLeg(a);
        return;
      }
      case 'join': {
        const T = L.target;
        if (!T || !T.alive) { this.nextLeg(a); return; }
        if (a.d.waveUntil) {
          a.pose = POSE.WAVE; S.lookAt(a, T.x, T.z, 0.5);
          if (this.time > a.d.waveUntil) this._joinGroup(a, T);
          return;
        }
        const d = Math.hypot(T.x - a.x, T.z - a.z);
        if (d < 6 && !a.d.waved) { a.d.waved = true; a.pose = POSE.WAVE; a.d.waveSoon = this.time + 1.2; }
        if (a.d.waveSoon && this.time < a.d.waveSoon) a.pose = POSE.WAVE; else if (!a.d.waveUntil) a.pose = POSE.WALK;
        if (d < 1.6 || (a.mode === MODE.STAND && d < 3)) {
          a.d.waveUntil = this.time + 1.6; S.stand(a); S.lookAt(a, T.x, T.z, 2);
          if (T.legs && T.legs[T.leg] && T.legs[T.leg].t === 'meet' && T.d) { T.d.waveUntil = this.time + 1.6; S.lookAt(T, a.x, a.z, 2); T.faceYaw = Math.atan2(-(a.x - T.x), -(a.z - T.z)); T.faceSet = true; }
        } else if (a.mode === MODE.STAND || (a.mode === MODE.PATH && this.r() < dt)) S.goTo(a, T.x, T.z, null, 1.3);
        return;
      }
      case 'window': {
        if (a.st === 1) {
          a.t -= dt;
          a.t2 -= dt;
          if (a.t2 <= 0) { a.t2 = 2 + this.r() * 4; a.lookYaw = (this.r() - 0.5) * 1.1; a.lookT = 2.2; }
          if (a.t <= 0) this.nextLeg(a);
        }
        return;
      }
      case 'order': {
        const C = a.d.C, k = C.queue.indexOf(a);
        if (k < 0) { this.nextLeg(a); return; }
        if (k !== a.d.k) this._orderMove(a, L);
        a.queueing = true;
        if (k === 0 && a.mode === MODE.STAND) {
          a.d.orderT += dt;
          a.pose = POSE.TALK;
          if (!a.d.lookedAt && C.agent && C.agent.alive) { this.sim.lookAt(a, C.agent.x, C.agent.z, 3); a.d.lookedAt = true; C.serveFor = a; }
          if (a.d.orderT > 5 + (a.serial % 4)) { a.cafeCup = true; a.dyn |= (1 << BIT.CUP); C.serveFor = null; C.lastServe = this.time; this.nextLeg(a); }
        } else if (a.mode === MODE.STAND) a.pose = (a.serial & 1) ? POSE.PHONE : POSE.STAND;
        if (a.pose === POSE.PHONE) a.dyn |= (1 << BIT.PHONE); else a.dyn &= ~(1 << BIT.PHONE);
        return;
      }
      case 'post': {
        if (L.C) { this._counterTick(a, L, dt); return; }
        if (this.time > a.d.next) {
          a.d.next = this.time + 5 + this.r() * 14;
          const r = this.r();
          if (L.kind === 'staff_shop' && r < 0.35) { a.pose = POSE.BOW; a.d.bowUntil = this.time + 1.1; this._callout(a); }
          else { a.pose = POSE.STAND; a.lookYaw = (this.r() - 0.5) * 1.6; a.lookT = 2.5; }
        }
        if (a.d.bowUntil && this.time > a.d.bowUntil) { a.d.bowUntil = 0; a.pose = POSE.STAND; }
        return;
      }
    }
  }
  _callout(a) {
    const V = this.sim.viewer;
    if (!V.has || V.level !== a.level || this.time < this._calloutT) return;
    const d = Math.hypot(V.x - a.x, V.z - a.z);
    if (d > 9) return;
    this._calloutT = this.time + 6;
    const lines = [['いらっしゃいませ', 'Irasshaimase!'], ['いらっしゃいませー、どうぞー', 'Welcome, come in!'], ['ただいまお席ご案内できます', 'Seats available now']];
    const [ja, en] = lines[Math.floor(this.r() * lines.length)];
    if (this.sim.events) this.sim.events.emit('crowd:callout', { level: a.level, x: a.x, y: a.y + 1.6, z: a.z, ja, en, kind: 'shop', channel: d < 3 ? 'speech' : 'ambient' });   // staff greeting you at the door: speech; background calls: ambient
  }

  _followerTick(a, dt) {
    const L = a.leader;
    if (a.fstate === 'dine') {
      if (a.mode === MODE.STAND) { { const Bz = a.biz || (a.leader && a.leader.biz); if (a.spot && Bz && !a.seatH && !a.seatDone) this._seatOn(a, a.spot, Bz); } if (!a.faceSet) { a.faceYaw = a.yaw; a.faceSet = true; } }
      return;
    }
    if (a.mode !== MODE.FOLLOW && a.mode !== MODE.RIDE && !a.fstate) a.mode = MODE.FOLLOW;
    // mirror the leader's mood a little
    if (L.mode === MODE.STAND && a.spd < 0.2) {
      a.pose = L.pose === POSE.WAVE ? POSE.STAND : (a.phoneUser > 0.6 ? POSE.PHONE : POSE.TALK);
      if (a.pose === POSE.PHONE) a.dyn |= (1 << BIT.PHONE); else a.dyn &= ~(1 << BIT.PHONE);
      if (a.pose === POSE.TALK && a.lookT <= 0 && this.r() < dt * 0.5) this.sim.lookAt(a, L.x, L.z, 2);
    } else { a.pose = a.kind === 'child' && !a.handHold && this.r() < 0.002 ? POSE.WAVE : POSE.WALK; a.dyn &= ~(1 << BIT.PHONE); }
    // kids: occasionally run ahead, then come back
    if (a.kind === 'child' && !a.handHold) {
      a.t2 -= dt;
      if (a.t2 <= 0) { a.t2 = 3 + this.r() * 6; a.offZ = this.r() < 0.4 ? -1.6 - this.r() * 1.5 : 0.1; a.offX = (this.r() - 0.5) * 1.2; }
    }
  }
  orphan(a) {
    // leader gone: wander off to an exit
    a.leader = null; a.fstate = null;
    const p = this.director.pickPortal(a);
    if (!p) { a.fadeDir = -1; return; }
    this.begin(a, [{ t: 'go', en: this.P.portalField(p), arrive: 1.5 }, { t: 'exit' }]);
  }

  // ---------------------------------------------------------------------------
  arrive(a) {
    if (a.leader) { if (a.fstate === 'dine') { a.mode = MODE.STAND; } return; }
    const L = a.legs && a.legs[a.leg];
    if (!L) { this._finish(a); return; }
    const S = this.sim;
    switch (L.t) {
      case 'go':
        if (a.d && a.d.back) { a.d.back = false; S.setField(a, L.en, L.arrive || 1.2); return; }   // turned round: resume
        if (a.d && a.d.aside) {                                                                      // stepped aside: stop and think
          a.d.aside = false; a.d.slow = 0;
          a.d.hes = this.time + 1.8 + this.r() * 3.2;
          S.stand(a, a.yaw); a.pose = a.d.hesPose; if (a.d.hesPose === POSE.PHONE) a.dyn |= (1 << BIT.PHONE);
          a.lookYaw = (this.r() - 0.5) * 1.6; a.lookT = 2.5;
          return;
        }
        this.nextLeg(a); return;
      case 'to': this.nextLeg(a); return;
      case 'exit': S.stand(a); return;
      case 'queue': {
        const sl = this.P.qSlot(L.B, Math.max(0, a.d.k));
        S.stand(a, sl.yaw);
        return;
      }
      case 'dine': {
        if (a.st === 0) { a.st = 1; this._sitDown(a, L.B); }
        else if (a.st === 2) this.nextLeg(a);
        return;
      }
      case 'browse': {
        if (a.st === 2) { this.nextLeg(a); return; }
        a.st = 1; S.stand(a, a.yaw + (this.r() - 0.5) * 1.5); a.pose = POSE.BROWSE; a.t = 4 + this.r() * 14 * (a.kind === 'shopper' ? 1.4 : 0.8);
        return;
      }
      case 'board': {
        if (a.st === 0) { a.st = 1; S.stand(a, a.d.sl.yaw); a.pose = a.phoneUser > 0.35 ? POSE.PHONE : POSE.STAND; a.t2 = 2 + this.r() * 4; }
        else if (a.st === 2) { a.fadeDir = -1; if (a.followers) for (const f of a.followers) f.fadeDir = -1; }
        return;
      }
      case 'stroll': case 'hall': case 'patrol': {
        a.st = 1;
        const r = this.r();
        if (L.t === 'stroll' && a.d.view) { S.stand(a, a.d.view.yaw); a.pose = r < 0.6 ? POSE.PHOTO : POSE.STAND; a.t = 4 + this.r() * 7; if (a.pose === POSE.PHOTO) a.dyn |= (1 << BIT.PHONE); }
        else if (L.t === 'hall') { S.stand(a, a.yaw + (r - 0.5) * 2); a.pose = POSE.BROWSE; a.t = 3 + this.r() * 12; }
        else if (L.t === 'patrol') { S.stand(a, a.yaw); a.t = 1 + this.r() * 5; }
        else { S.stand(a, a.yaw + (r - 0.5) * 2); a.pose = r < 0.3 ? POSE.PHONE : POSE.STAND; a.t = 2 + this.r() * 6; if (a.pose === POSE.PHONE) a.dyn |= (1 << BIT.PHONE); a.lookYaw = (this.r() - 0.5) * 1.5; a.lookT = 2; }
        return;
      }
      case 'meet': S.stand(a); return;
      case 'join': S.stand(a); return;
      case 'window': if (a.st === 0) this._arriveWindow(a, L); else S.stand(a); return;
      case 'order': { const sl = this._orderSlot(a.d.C, Math.max(0, a.d.k)); S.stand(a, sl.yaw); return; }
      default: S.stand(a);
    }
  }
  fail(a) {
    // destination unreachable from here: give up and leave
    if (a.leader) return;
    if (a.legs) { this.endLeg(a); a.legs = null; }
    a.fadeDir = -1; a.mode = MODE.STAND;
  }
  onRideEnd(a) { if (a.legs && a.legs[a.leg] && a.legs[a.leg].t === 'go') a.pose = a.phoneWalk ? POSE.PHONE : POSE.WALK; }

  // ---------------------------------------------------------------------------
  // v2 helpers
  _nearRampOrGate(a) {
    const P = this.P;
    for (const R of P.ramps) {
      if (R.r.lower !== a.level && R.r.upper !== a.level) continue;
      for (const e of [R.ends.low, R.ends.high]) if (Math.abs(e.x - a.x) < 7 && Math.abs(e.z - a.z) < 7) return true;
    }
    const gl = P.gatesByLevel && P.gatesByLevel[a.level];
    if (gl) for (const G of gl) { const pa = (G.axis === 'x' ? a.z : a.x) - G.at, lat = G.axis === 'x' ? a.x : a.z; if (Math.abs(pa) < 6 && lat > G.lo - 2 && lat < G.hi + 2) return true; }
    return false;
  }
  // a spot 1.4-3 m to the side of our path (left first), with room, out of the main flow
  _asidePoint(a) {
    const S = this.sim, fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw);
    for (const side of [-1, 1]) {
      const sx = fz * side, sz = -fx * side; // side -1 = left of travel
      for (const dist of [2.6, 2.0, 1.4]) {
        const x = a.x + -sx * dist, z = a.z + -sz * dist;
        if (!S.col.walkable(a.level, x, z) || !S.col.walkable(a.level, a.x - sx * dist * 0.5, a.z - sz * dist * 0.5)) continue;
        // the spot must be beside a wall / edge (not the middle of a hall) and not occupied
        const probe = { level: a.level, x, z }; S.col.move(probe, -sx * 0.9, -sz * 0.9, 0.2);
        if (Math.hypot(probe.x - x, probe.z - z) > 0.45) continue;
        let busy = false; S.near(a.level, x, z, 0.9, (b) => { if (b !== a) busy = true; });
        if (!busy) return { x, z };
      }
    }
    return null;
  }
  // stand at a shop window: along the frontage (not in the doorway), facing the glass
  _windowSpot(B) {
    const S = this.sim, d = B.door, [x0, z0, x1, z1] = B.rect;
    if (!B.wins) {
      B.wins = [];
      const nx = d.nx, nz = d.nz;               // outward normal of the frontage
      const tx = -nz, tz = nx;
      // the frontage line passes through the door point
      const ext = Math.abs(tx) > 0.5 ? (x1 - x0) : (z1 - z0);
      for (let u = -ext; u <= ext; u += 1.1) {
        if (Math.abs(u) < 1.4) continue;          // keep the doorway clear
        const x = d.x + tx * u + nx * 0.62, z = d.z + tz * u + nz * 0.62;
        const inX = x >= x0 - 1.2 && x <= x1 + 1.2 && z >= z0 - 1.2 && z <= z1 + 1.2;
        if (!inX || !S.col.walkable(B.level, x, z)) continue;
        const probe = { level: B.level, x, z }; S.col.move(probe, -nx * 0.9, -nz * 0.9, 0.2);
        if (Math.hypot(probe.x - x, probe.z - z) > 0.45) continue;            // must be glass / wall in front, not an opening
        B.wins.push({ x, z, yaw: Math.atan2(nx, nz), used: 0 });
      }
    }
    const free = B.wins.filter(w => !w.used);
    if (!free.length) return null;
    const w = free[Math.floor(this.r() * free.length)];
    w.used = 1;
    return w;
  }
  _arriveWindow(a, L) {
    const w = a.d.w; a.st = 1;
    this.sim.stand(a, w.yaw); a.faceYaw = w.yaw;
    a.pose = a.kind === 'tourist' && this.r() < 0.3 ? POSE.PHOTO : POSE.STAND;
    if (a.pose === POSE.PHOTO) a.dyn |= (1 << BIT.PHONE);
    a.t = L.dur || (6 + this.r() * 14); a.t2 = 1 + this.r() * 2;
  }
  // café counter line: NPCs order one step to the side of the player's order spot, the line goes back from there
  _orderSlot(C, k) {
    const n = C.npc;
    return { x: n.x + n.bx * 0.72 * k, z: n.z + n.bz * 0.72 * k, yaw: n.yaw };
  }
  _orderMove(a, L) {
    const C = a.d.C, k = C.queue.indexOf(a);
    a.d.k = k;
    const sl = this._orderSlot(C, k);
    const d = Math.hypot(sl.x - a.x, sl.z - a.z);
    if (d > 0.3) { this.sim.goTo(a, sl.x, sl.z, L.B.rect, 0.22); a.d.slow = 0.7; }
    else this.sim.stand(a, sl.yaw);
  }
  // counter staff: idle behind the counter, nod now and then, serve the person ordering, greet the player
  _counterTick(a, L, dt) {
    const C = L.C, S = this.sim, V = S.viewer;
    if (a.d.until && this.time < a.d.until) return;
    if (a.d.until) { a.d.until = 0; a.pose = POSE.STAND; }
    // the player walks up to the counter: look at them, a small nod (Flow plays the order exchange)
    if (V.has && V.level === a.level) {
      const dp = Math.hypot(V.x - a.x, V.z - a.z);
      if (dp < 3.2) {
        if (a.lookT <= 0) S.lookAt(a, V.x, V.z, 1.5);
        if (this.time > (a.d.greetT || 0)) { a.d.greetT = this.time + 25; a.pose = POSE.NOD; a.d.until = this.time + 1.5; return; }
      }
    }
    if (C.served) { C.served = false; a.pose = POSE.SERVE; a.d.until = this.time + 1.6; a.d.next = this.time + 3; return; }
    if (C.serveFor && C.serveFor.alive) {
      if (a.lookT <= 0) S.lookAt(a, C.serveFor.x, C.serveFor.z, 2);
      if (!a.d.servedFor || a.d.servedFor !== C.serveFor) { a.d.servedFor = C.serveFor; a.pose = POSE.NOD; a.d.until = this.time + 1.4; return; }
      if (this.time > (a.d.next || 0)) { a.d.next = this.time + 4; a.pose = POSE.SERVE; a.d.until = this.time + 1.6; return; }
      return;
    }
    if (this.time > a.d.next) {
      a.d.next = this.time + 6 + this.r() * 12;
      const r = this.r();
      if (r < 0.3) { a.pose = POSE.NOD; a.d.until = this.time + 1.5; }
      else if (r < 0.45) { a.pose = POSE.SERVE; a.d.until = this.time + 1.5; }   // wiping / handling something
      else { a.pose = POSE.STAND; a.lookYaw = (this.r() - 0.5) * 1.4; a.lookT = 2.5; }
    }
  }

  _queueMove(a, L) {
    const B = L.B, k = B.queue.indexOf(a);
    a.d.k = k;
    const sl = this.P.qSlot(B, k);
    const d = Math.hypot(sl.x - a.x, sl.z - a.z);
    if (d > 0.3) { this.sim.goTo(a, sl.x, sl.z, null, 0.22); a.d.slow = 0.7; }
    else this.sim.stand(a, sl.yaw);
  }
  // v4: sit only ON a real seat (a.seatH = seat-top height, drives the sit clip variant and the hip height in render.js); on a
  // sampled floor cell nobody sits: they stand and eat / look at their phone instead
  _seatOn(a, sp, B, instant) {
    const real = !!(sp && sp.real && !sp.bad);
    a.seatDone = true;
    if (real) {
      a.seatH = sp.h; a.seatStool = !!sp.stool;
      // v5: a person sitting down walks the last step onto the seat and turns into it (sim.js _move, STAND + seatH); only an agent
      // placed already seated (initial fill, `instant`) is put there directly
      a.faceYaw = sp.yaw; a.faceSet = true;
      if (instant) { if (sp.sx !== undefined) { a.x = sp.sx; a.z = sp.sz; } a.yaw = sp.yaw; a.seatK = 1; a.seatTx = NaN; }
      else { a.seatK = 0; if (sp.sx !== undefined) { a.seatTx = sp.sx; a.seatTz = sp.sz; } else a.seatTx = NaN; }
      const r = this.r();
      a.seatPhone = !!(B.cafe && r < 0.3);
      a.pose = a.seatPhone ? POSE.SIT : (B.counter || (B.restaurant && r < 0.55) ? POSE.EAT : POSE.SIT);
      if (a.seatPhone) a.dyn |= (1 << BIT.PHONE);
    } else {
      a.seatH = 0; a.seatPhone = false;
      a.pose = B.cafe && this.r() < 0.3 ? POSE.PHONE : POSE.STAND;
      if (a.pose === POSE.PHONE) a.dyn |= (1 << BIT.PHONE);
    }
    if (B.cafe && this.r() < 0.6) { a.cafeCup = true; a.dyn |= (1 << BIT.CUP); }
  }
  _sitDown(a, B) {
    const S = this.sim;
    const counter = B.counter;
    // face into the room (towards the back / counter) with some variety
    const real = a.spot && a.spot.real && !a.spot.bad;
    const yaw = real ? a.spot.yaw : Math.atan2(B.door.nx, B.door.nz) + Math.PI + (this.r() - 0.5) * (counter ? 0.6 : 2.4);
    S.stand(a, yaw);
    a.seatDone = false;
    this._seatOn(a, a.spot, B);
  }
  _browseNext(a, L) {
    const B = L.B;
    if (a.spot) { a.spot.used = 0; a.spot = null; }
    if (a.d.left-- <= 0) { a.st = 2; a.pose = POSE.WALK; this.sim.goTo(a, B.door.ox, B.door.oz, B.rect, 0.6); return; }
    const s = this.P.takeSpot(B);
    if (!s) { a.st = 2; this.sim.goTo(a, B.door.ox, B.door.oz, B.rect, 0.6); return; }
    a.spot = s; a.st = 0; a.pose = POSE.WALK; a.d.slow = 0.75;
    this.sim.goTo(a, s.x, s.z, B.rect, 0.35);
  }
  _wanderNext(a, L) {
    const P = this.P, S = this.sim;
    a.st = 0; a.pose = POSE.WALK; a.d.view = null; a.d.slow = L.t === 'patrol' ? 0.75 : 0.85;
    const A = L.A || L.H;
    if (!A) { this.nextLeg(a); return; }
    let x, z;
    if (L.t === 'stroll' && A.views && A.views.length && this.r() < 0.45) { const v = A.views[Math.floor(this.r() * A.views.length)]; x = v.x; z = v.z; a.d.view = v; }
    else {
      // a point not too far away, so they stroll rather than cross the whole area
      for (let k = 0; k < 8; k++) { const p = P.randomNodePos(A, this.r); if (Math.hypot(p.x - a.x, p.z - a.z) < 28 || k === 7) { x = p.x; z = p.z; break; } }
    }
    if (!S.col.walkable(A.level, x, z) || a.level !== A.level) { a.st = 1; a.t = 2; return; }
    S.goTo(a, x, z, A.bounds, 0.6);
    if (!a.path) { a.st = 1; a.t = 2; }
  }
  // signed distance past the platform edge toward the train (> 0: in the doorway / inside)
  _intoTrain(a, T) {
    const d = a.d && a.d.door; if (!d) return -1;
    return -((a.x - d.x) * T.nx + (a.z - d.z) * T.nz);
  }
  // v8: walk to the door nearest to where we stand: first the apron in front of it, then straight through the opening
  _enterDoor(a, T) {
    const nx = T.nx, nz = T.nz;
    let best = null, bd = Infinity;
    const doors = T.doors && T.doors.length ? T.doors : T.marks.map(m => ({ x: m.x - m.nx * 0.9, z: m.z - m.nz * 0.9 }));
    for (const d of doors) { const l = T.along === 'z' ? Math.abs(d.z - a.z) : Math.abs(d.x - a.x); if (l < bd) { bd = l; best = d; } }
    if (!best) return;
    a.d.door = best;
    this.sim.setPath(a, [[best.x + nx * 0.9, best.z + nz * 0.9], [best.x - nx * 0.2, best.z - nz * 0.2]], 0.35);
  }
  _pickMark(a, T) {
    const M = T.marks; if (!M.length) return null;
    // nearest few markings to where we come in, preferring short lines
    let best = null, bc = Infinity;
    for (let i = 0; i < M.length; i++) {
      const m = M[i];
      const d = Math.hypot(m.x - a.x, m.z - a.z);
      const c = d * 0.08 + (m.n[0] + m.n[1]) * 1.4 + this.r() * 3.5;
      if (c < bc) { bc = c; best = m; }
    }
    return best;
  }
  _joinGroup(a, T) {
    // the waiting friend leads; we follow side by side
    a.d.waveUntil = 0;
    this.endLeg(a);
    a.legs = null;
    a.leader = T; a.mode = MODE.FOLLOW; a.offX = 0.62; a.offZ = 0.05;
    (T.followers = T.followers || []).push(a);
    if (T.legs && T.legs[T.leg] && T.legs[T.leg].t === 'meet') { T.d.waveUntil = 0; this.nextLeg(T); }
  }
}
