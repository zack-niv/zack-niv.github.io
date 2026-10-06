// =============================================================================
// Director: who is in Namba right now, and why.
//
// Population target follows the clock (rush hours, lunch). People enter at
// portals (street exits, the ends of the arcades, department stores) and at
// train doors (surges on 'train:arrive'), each with a purpose-driven trip:
// transfer between lines, train <-> exit, lunch (queue + eat), coffee, shopping
// loops, the Parks gardens, the depachika, meeting a friend at a landmark.
// The initial population is placed mid-trip (and seated / queueing / waiting
// on platforms) so the place is alive from the first frame.
// =============================================================================
import { MODE, POSE } from './sim.js';
import { makeLook, BIT } from './looks.js';
import { rng } from '../core/rng.js';

const gauss = (x, c, w) => Math.exp(-((x - c) * (x - c)) / (2 * w * w));
const PERSON = {
  //            pref speed  sd    conf  hurry  space  phone
  commuter: { v: 1.42, sd: 0.12, conf: 0.95, hurry: 0.75, space: 0.35, phone: 0.3 },
  student:  { v: 1.3, sd: 0.1, conf: 0.85, hurry: 0.5, space: 0.25, phone: 0.45 },
  tourist:  { v: 1.06, sd: 0.12, conf: 0.35, hurry: 0.2, space: 0.55, phone: 0.35 },
  shopper:  { v: 1.12, sd: 0.1, conf: 0.8, hurry: 0.3, space: 0.45, phone: 0.25 },
  elderly:  { v: 0.84, sd: 0.08, conf: 0.75, hurry: 0.1, space: 0.6, phone: 0.05 },
  child:    { v: 1.1, sd: 0.1, conf: 0.9, hurry: 0.4, space: 0.2, phone: 0 },
  staff_station: { v: 1.1, sd: 0.05, conf: 1, hurry: 0.3, space: 0.4, phone: 0 },
  staff_shop: { v: 1.1, sd: 0.05, conf: 1, hurry: 0.3, space: 0.4, phone: 0 },
  cleaner: { v: 0.62, sd: 0.05, conf: 1, hurry: 0.1, space: 0.5, phone: 0 },
  security: { v: 0.9, sd: 0.05, conf: 1, hurry: 0.1, space: 0.5, phone: 0 },
};
const LINE_BASE = { nankai: 70, midosuji: 55, sennichimae: 28 };

export class Director {
  constructor(sim, behave, ctx) {
    this.sim = sim; this.B = behave; this.P = sim.places; this.ctx = ctx;
    this.r = rng(((ctx && ctx.params && ctx.params.seed) || 20261005) ^ 0xd17ec7);
    this.pending = [];          // delayed spawns {t, fn}
    this.spawnAcc = 0;
    this.filled = false;
    this.lastRealTrain = -1e9;
    this.fallback = {};          // track id -> next arrival time
    this.nocrowd = !!(ctx && ctx.params && ctx.params.nocrowd);
    this.scale = 1;
    this.counts = { staff: 0, seated: 0, queued: 0, waiting: 0, walking: 0, trains: 0, surge: 0 };
    // shop subsets so fields stay few: busy shops per zone + every restaurant/café
    this._shopPools();
    this._coreFields();
    this._dkT = 0; this._dkIdx = 0; this.burst = 0; this.nearShare = 0.32;
    this._publicNodes();
  }
  get minutes() { return this.sim.clock ? this.sim.clock.minutes : 12 * 60; }
  get hours() { return this.minutes / 60; }
  get rush() { return this.sim.clock && this.sim.clock.rush != null ? this.sim.clock.rush : 0.5; }

  target() {
    const h = this.hours;
    const max = (this.sim.quality && this.sim.quality.crowdMax) || 1500;
    let f = 0.42 + 0.58 * this.rush;
    if (h < 5.5 || h > 23.8) f *= 0.08; else if (h < 7) f *= 0.4 + 0.6 * (h - 5.5) / 1.5; else if (h > 22) f *= Math.max(0.15, 1 - (h - 22) / 2);
    return Math.round(max * Math.min(1, f) * this.scale);
  }

  _shopPools() {
    const P = this.P;
    const byZone = {};
    for (const B of P.biz) {
      if (B.closed) continue;
      (byZone[B.slot.zone] = byZone[B.slot.zone] || []).push(B);
    }
    this.restaurants = P.biz.filter(B => B.restaurant && !B.closed);
    this.cafes = P.biz.filter(B => B.cafe && !B.closed);
    this.shops = [];
    for (const list of Object.values(byZone)) {
      const s = list.filter(B => !B.food).sort((a, b) => b.pop - a.pop);
      this.shops.push(...s.slice(0, 9));
      // snack stands (takoyaki / sweets / bakery) get browse-and-buy visits
      this.shops.push(...list.filter(B => B.food && !B.restaurant && !B.cafe).slice(0, 3));
    }
  }
  _coreFields() {
    for (const p of this.P.portals) this.P.portalField(p, 1);
    for (const pl of this.P.platforms) this.P.platformField(pl, 1);
  }

  // ---------------------------------------------------------------------------
  update(dt) {
    if (this.nocrowd) return;
    const S = this.sim;
    if (!this.filled) { this.filled = true; this._initialFill(); }
    // delayed spawns (train doors)
    if (this.pending.length) {
      const t = S.time;
      for (let i = this.pending.length - 1; i >= 0; i--) if (this.pending[i].t <= t) { const p = this.pending[i]; this.pending.splice(i, 1); p.fn(); }
    }
    // continuous arrivals at portals
    const tgt = this.target();
    const deficit = tgt - S.count;
    const rate = Math.max(0, deficit) * 0.045 + tgt * 0.0035;
    this.spawnAcc += rate * dt;
    let guard = 6;
    while (this.spawnAcc >= 1 && guard-- > 0) { this.spawnAcc -= 1; if (S.count < tgt * 1.08) this.spawnFromPortal(); }
    if (this.spawnAcc > 5) this.spawnAcc = 5;
    // trains when the transit system isn't driving them
    this._fallbackTrains();
    this._keepDensity(dt);
  }

  // ---------------------------------------------------------------------------
  // agents
  makeAgent(kind, o = {}) {
    if (kind === 'family') kind = 'shopper'; // families are built by makeGroup
    const S = this.sim, r = this.r;
    const a = S.spawn();
    const P = PERSON[kind] || PERSON.shopper;
    a.kind = kind; a.trip = o.trip || '';
    const rushBoost = 1 + 0.08 * this.rush * (kind === 'commuter' ? 1 : 0.3);
    a.prefBase = Math.max(0.5, (P.v + gaussR(r) * P.sd) * rushBoost);
    a.pref = a.prefBase;
    a.conf = Math.min(1, Math.max(0.05, P.conf + (r() - 0.5) * 0.3));
    a.hurry = Math.min(1, Math.max(0, P.hurry + (r() - 0.5) * 0.4 + (kind === 'commuter' ? 0.15 * this.rush : 0)));
    a.space = Math.min(1, Math.max(0, P.space + (r() - 0.5) * 0.3));
    a.patience = 0.5 + r();
    a.phoneUser = r() < P.phone ? 0.4 + r() * 0.6 : r() * 0.3;
    a.phoneWalk = a.phoneUser > 0.82 && kind !== 'elderly' && kind !== 'child';
    // lane preference: spread across the corridor, slight keep-right bias
    a.laneOff = clamp(gaussR(r) * 1.1 + 0.35, -2.2, 2.4);
    a.jx = (r() - 0.5) * 0.6; a.jz = (r() - 0.5) * 0.6;
    a.look = makeLook(kind, r, o.look || {});
    a.flags = a.look.flags;
    a.fade = 0; a.fadeDir = 0; // hidden until placed
    a.ffFrac = 0; a.cafeCup = false;
    a.phase = r() * 6.28;
    a.t2 = r() * 4;
    return a;
  }
  placeFollower(L, f) {
    const c = Math.cos(L.yaw), s = Math.sin(L.yaw);
    let x = L.x + c * f.offX + s * f.offZ, z = L.z - s * f.offX + c * f.offZ;
    if (!this.sim.col.walkable(L.level, x, z)) { x = L.x; z = L.z; }
    this.sim.setPos(f, L.level, x, z);
    f.yaw = L.yaw; f.vx = L.vx; f.vz = L.vz;
    if (f.fadeDir === 0 && L.fadeDir !== 0) f.fadeDir = 1;
  }
  // group: leader + followers (same look family)
  makeGroup(kind, n, o = {}) {
    const r = this.r;
    const lead = this.makeAgent(kind, o);
    if (n <= 1) return lead;
    lead.followers = [];
    const fam = kind === 'family';
    const forms = [[0.62, 0.05], [-0.62, 0.1], [0, 0.85], [0.6, 0.9]];
    const uni = kind === 'student' ? { colA: lead.look.colA.slice(), colB: lead.look.colB.slice() } : null;
    for (let i = 1; i < n; i++) {
      let fk = kind, fo = { ...o };
      if (fam) fk = 'child';
      const f = this.makeAgent(fk, fo);
      if (uni) { // same school uniform, own hair/skin
        f.look.colA[0] = uni.colA[0]; f.look.colA[1] = f.look.female === lead.look.female ? uni.colA[1] : f.look.colA[1];
      }
      f.leader = lead; f.mode = MODE.FOLLOW;
      const fm = forms[(i - 1) % forms.length];
      f.offX = fm[0]; f.offZ = fm[1];
      if (fk === 'child') { f.offX = 0.42 * (i % 2 ? 1 : -1); f.offZ = 0.02; f.handHold = r() < 0.6; }
      f.pref = lead.pref; f.prefBase = lead.prefBase;
      f.laneOff = lead.laneOff;
      lead.followers.push(f);
    }
    return lead;
  }
  _kindFor(trip, origin) {
    const r = this.r, h = this.hours;
    const commute = Math.max(gauss(h, 8.4, 1.0), gauss(h, 18.4, 1.2));
    const school = gauss(h, 16.3, 1.3);
    const airport = origin && origin.line === 'nankai';
    let w;
    switch (trip) {
      case 'transfer': case 'transit': case 'through':
        w = { commuter: 0.32 + 0.55 * commute, tourist: 0.14 + (airport ? 0.2 : 0), student: 0.05 + 0.3 * school, shopper: 0.18, elderly: 0.12, family: 0.05 }; break;
      case 'lunch': w = { commuter: 0.45, shopper: 0.25, tourist: 0.15, elderly: 0.12, student: 0.03, family: 0.06 }; break;
      case 'coffee': w = { commuter: 0.35, shopper: 0.35, tourist: 0.2, elderly: 0.05 }; break;
      case 'shop': w = { shopper: 0.62, tourist: 0.2, student: 0.04 + 0.2 * school, elderly: 0.07, family: 0.07 }; break;
      case 'parks': w = { tourist: 0.3, shopper: 0.3, elderly: 0.2, family: 0.18 }; break;
      case 'hall': w = { shopper: 0.5, elderly: 0.3, tourist: 0.15, commuter: 0.05 }; break;
      default: w = { commuter: 0.3, shopper: 0.4, tourist: 0.2, elderly: 0.1 };
    }
    return pickW(w, r);
  }
  _groupSize(kind, trip) {
    const r = this.r();
    switch (kind) {
      case 'commuter': return trip === 'lunch' ? (r < 0.35 ? 2 : r < 0.5 ? 3 : 1) : (r < 0.06 ? 2 : 1);
      case 'student': return r < 0.35 ? 1 : r < 0.7 ? 2 : r < 0.9 ? 3 : 4;
      case 'tourist': return r < 0.35 ? 1 : r < 0.85 ? 2 : r < 0.95 ? 3 : 4;
      case 'shopper': return r < 0.62 ? 1 : r < 0.95 ? 2 : 3;
      case 'elderly': return r < 0.65 ? 1 : 2;
      case 'family': return r < 0.6 ? 2 : 3;
      default: return 1;
    }
  }
  _create(trip, origin) {
    let kind = this._kindFor(trip, origin);
    const n = this._groupSize(kind, trip);
    const suitcase = kind === 'tourist' && (origin && origin.line === 'nankai' ? this.r() < 0.55 : this.r() < 0.12);
    const bags = Math.min(0.75, 0.15 + Math.max(0, this.hours - 11) * 0.06);
    const o = { trip, look: { suitcase, bags, phone: false } };
    if (kind === 'family') { const lead = this.makeGroup('family', n, { trip, look: { bags } }); lead.kind = 'shopper'; lead.look = makeLook('shopper', this.r, { bags }); lead.flags = lead.look.flags; return lead; }
    return this.makeGroup(kind, n, o);
  }

  // ---------------------------------------------------------------------------
  // trip plans -> legs
  _tripWeights(fromTrain) {
    const h = this.hours;
    const lunch = gauss(h, 12.4, 0.8);
    const commute = Math.max(gauss(h, 8.4, 1.0), gauss(h, 18.4, 1.2));
    const day = h > 10 && h < 21 ? 1 : 0.15;
    if (fromTrain) return { exit: 0.5 + 0.3 * commute, transfer: 0.32 + 0.3 * commute, lunch: 0.6 * lunch, coffee: 0.08, shop: 0.18 * day, parks: 0.08 * day, hall: 0.05 * day };
    return { transit: 0.32 + 0.7 * commute, through: 0.32, lunch: 1.5 * lunch, coffee: 0.1 + 0.2 * gauss(h, 8.5, 1) + 0.12 * gauss(h, 15, 1.3), shop: 0.5 * day, parks: 0.2 * day, hall: 0.13 * day, meet: 0.03 * day };
  }
  pickPortal(a, exclude) {
    const ps = this.P.portals.filter(p => p !== exclude && !(p.inside && a && a.kind === 'commuter' && this.r() < 0.5));
    let tot = 0; for (const p of ps) tot += p.w;
    let x = this.r() * tot;
    for (const p of ps) { x -= p.w; if (x <= 0) return p; }
    return ps[0];
  }
  _pickPlatform(fromLine) {
    const lines = { midosuji: 0.46, nankai: 0.38, sennichimae: 0.16 };
    if (fromLine) { lines[fromLine] = 0; if (fromLine === 'nankai') lines.midosuji = 0.75; if (fromLine === 'midosuji') lines.nankai = 0.7; }
    const line = pickW(lines, this.r);
    const pls = this.P.platforms.filter(p => p.line === line);
    if (!pls.length) return null;
    const pl = pls[Math.floor(this.r() * pls.length)];
    const T = pl.tracks[Math.floor(this.r() * pl.tracks.length)];
    return { pl, T };
  }
  _pickBiz(list, open = true, nearLevel = null) {
    const m = this.minutes;
    const cand = list.filter(B => !open || this.P.bizOpen(B, m));
    if (!cand.length) return null;
    let tot = 0; const w = cand.map(B => { const v = B.pop * B.pop * (nearLevel && B.level === nearLevel ? 1.5 : 1); tot += v; return v; });
    let x = this.r() * tot;
    for (let i = 0; i < cand.length; i++) { x -= w[i]; if (x <= 0) return cand[i]; }
    return cand[0];
  }
  // onward: leave through a portal or catch a train
  _onward(legs, a, fromLine, pri = 6) {
    if (this.r() < 0.35) {
      const pt = this._pickPlatform(fromLine);
      if (pt) { legs.push({ t: 'go', en: this.P.platformField(pt.pl, pri), arrive: 1.0 }, { t: 'board', T: pt.T }); return legs; }
    }
    const p = this.pickPortal(a);
    legs.push({ t: 'go', en: this.P.portalField(p, pri), arrive: 1.5 }, { t: 'exit' });
    return legs;
  }
  plan(trip, a, origin) {
    const P = this.P, legs = [], r = this.r;
    const fromLine = origin && origin.line;
    const scale = (this.sim.clock && this.sim.clock.scale) || 6;
    switch (trip) {
      case 'transit': case 'transfer': {
        const pt = this._pickPlatform(fromLine);
        if (!pt) return this.plan('through', a, origin);
        legs.push({ t: 'go', en: P.platformField(pt.pl, 2), arrive: 1.0 }, { t: 'board', T: pt.T });
        return legs;
      }
      case 'exit': case 'through': {
        const p = this.pickPortal(a, origin && origin.portal);
        legs.push({ t: 'go', en: P.portalField(p, 2), arrive: 1.5 }, { t: 'exit' });
        return legs;
      }
      case 'lunch': {
        const B = this._pickBiz(this.restaurants);
        if (!B) return this.plan('through', a, origin);
        const dw = B.info.dwell || [900, 1800];
        legs.push({ t: 'go', en: P.bizField(B, 3), arrive: 1.5 }, { t: 'queue', B, max: 10 + Math.floor(a.patience * 6) }, { t: 'dine', B, dur: (dw[0] + r() * (dw[1] - dw[0])) / scale });
        return this._onward(legs, a, null);
      }
      case 'coffee': {
        const B = this._pickBiz(this.cafes);
        if (!B) return this.plan('shop', a, origin);
        const dw = B.info.dwell || [300, 900];
        legs.push({ t: 'go', en: P.bizField(B, 3), arrive: 1.5 }, { t: 'queue', B, max: 6 }, { t: 'dine', B, dur: (dw[0] + r() * (dw[1] - dw[0])) / scale });
        return this._onward(legs, a, null);
      }
      case 'shop': {
        const n = 1 + Math.floor(r() * 3);
        let lv = null;
        for (let i = 0; i < n; i++) {
          const B = this._pickBiz(this.shops, true, lv);
          if (!B) break;
          lv = B.level;
          legs.push({ t: 'go', en: P.bizField(B, i === 0 ? 3 : 6), arrive: 1.5 }, { t: 'browse', B, n: 1 + Math.floor(r() * 3) });
        }
        if (!legs.length) return this.plan('through', a, origin);
        return this._onward(legs, a, null);
      }
      case 'parks': {
        const G = P.gardens.length ? P.gardens[Math.floor(r() * P.gardens.length)] : null;
        if (!G) return this.plan('shop', a, origin);
        legs.push({ t: 'go', en: P.areaField(G, 3), arrive: 0.5 }, { t: 'stroll', A: G, dur: 60 + r() * 140 });
        if (r() < 0.4) { const G2 = P.gardens[Math.floor(r() * P.gardens.length)]; legs.push({ t: 'go', en: P.areaField(G2, 6), arrive: 0.5 }, { t: 'stroll', A: G2, dur: 40 + r() * 100 }); }
        return this._onward(legs, a, null);
      }
      case 'hall': {
        const H = P.halls.length ? (P.hallById.taka_b1 && r() < 0.6 ? P.hallById.taka_b1 : P.halls[Math.floor(r() * P.halls.length)]) : null;
        if (!H) return this.plan('shop', a, origin);
        legs.push({ t: 'go', en: P.areaField(H, 3), arrive: 0.5 }, { t: 'hall', H, dur: 40 + r() * 120 });
        return this._onward(legs, a, null);
      }
      default: return this.plan('through', a, origin);
    }
  }

  // ---------------------------------------------------------------------------
  spawnFromPortal() {
    const tw = this._tripWeights(false);
    let trip = pickW(tw, this.r);
    let p = this.pickPortal(null);
    // nobody steps in through a doorway the player is looking at from close by
    for (let k = 0; k < 4 && p && this._seenNear(p.level, p.x, p.z, 30); k++) p = this.pickPortal(null);
    if (!p || this._seenNear(p.level, p.x, p.z, 30)) return;
    if (trip === 'meet') { this._spawnMeet(p); return; }
    const a = this._create(trip, { portal: p });
    this.sim.setPos(a, p.level, p.x + (this.r() - 0.5) * 1.5, p.z + (this.r() - 0.5) * 1.5);
    if (a.followers) for (const f of a.followers) this.placeFollower(a, f);
    this.B.begin(a, this.plan(trip, a, { portal: p }));
    this.counts.walking++;
  }
  _seenNear(level, x, z, r) {
    const V = this.sim.viewer; if (!V.has || V.level !== level) return false;
    const dx = x - V.x, dz = z - V.z, d = Math.hypot(dx, dz);
    if (d > r) return false;
    if (d < 1.5) return true;
    if ((dx * -Math.sin(V.yaw || 0) + dz * -Math.cos(V.yaw || 0)) / d < -0.1) return false;
    return this.sim.world.visible(level, V.x, V.z, x, z);
  }
  _spawnMeet(p) {
    const P = this.P;
    const lms = P.landmarks.filter(m => !m.board);
    if (!lms.length) return;
    const M = lms[Math.floor(this.r() * lms.length)];
    // the one already waiting
    const kind = pickW({ shopper: 0.5, student: 0.2, commuter: 0.15, tourist: 0.15 }, this.r);
    const A = this.makeAgent(kind, { trip: 'meet' });
    const ang = this.r() * 6.28, rad = 1.5 + this.r() * 3;
    let x = M.x + Math.cos(ang) * rad, z = M.z + Math.sin(ang) * rad;
    if (!this.sim.col.walkable(M.level, x, z)) { x = M.x; z = M.z; }
    this.sim.setPos(A, M.level, x, z);
    const after = this.plan(pickW({ lunch: 0.4 * gauss(this.hours, 12.4, 1) + 0.05, shop: 0.4, coffee: 0.15, parks: 0.1 }, this.r), A, null);
    this.B.begin(A, [{ t: 'meet', M, dur: 120 + this.r() * 200, inside: true }, ...after]);
    // the friend, arriving from the portal a bit later
    const B = this.makeAgent(pickW({ shopper: 0.5, student: 0.2, commuter: 0.15, tourist: 0.15 }, this.r), { trip: 'meet' });
    this.sim.setPos(B, p.level, p.x, p.z);
    this.B.begin(B, [{ t: 'go', en: P.landmarkField(M, 3), arrive: 4 }, { t: 'join', target: A }]);
  }

  // train arrival: doors open, a surge steps out
  onTrainArrive(ev, real = true) {
    const P = this.P, S = this.sim;
    if (real) this.lastRealTrain = S.time;
    let T = ev && ev.track && P.trackById[ev.track];
    if (!T && ev && ev.platform) { const pl = P.platformById[ev.platform]; if (pl) T = pl.tracks[0]; }
    if (!T) return;
    T.doorsT0 = S.time; T.doorsUntil = S.time + (ev.dwell || 22);
    this.counts.trains++;
    // door positions
    let doors = [];
    const raw = ev.doorsAt || ev.doors;
    if (Array.isArray(raw) && raw.length) {
      for (const d of raw) {
        const x = Array.isArray(d) ? d[0] : d.x, z = Array.isArray(d) ? d[1] : d.z;
        if (Number.isFinite(x) && Number.isFinite(z)) doors.push({ x, z });
      }
    }
    if (!doors.length) doors = T.marks.map(m => ({ x: m.x - m.nx * 0.9, z: m.z - m.nz * 0.9 }));
    if (!doors.length || this.nocrowd) return;
    T.doors = doors;
    const tgt = this.target();
    const base = LINE_BASE[T.line] || 40;
    const fill = clamp(1 + (tgt - S.count) / Math.max(1, tgt) * 2.5, 0.35, 1.8);
    const n = Math.round(base * (0.45 + 0.75 * this.rush) * fill * (ev.load != null ? ev.load : 1));
    this.counts.surge += n;
    for (let i = 0; i < n; i++) {
      const d = doors[Math.floor(this.r() * doors.length)];
      const delay = 0.3 + this.r() * 7 + (i / n) * 3;
      this.pending.push({ t: S.time + delay, fn: () => this._alight(T, d) });
    }
  }
  _alight(T, d) {
    const S = this.sim, P = this.P;
    if (S.count > this.target() * 1.25) return;
    const tw = this._tripWeights(true);
    const trip = pickW(tw, this.r);
    const a = this._create(trip, { line: T.line });
    const nx = T.nx, nz = T.nz;
    const x = d.x + nx * (0.35 + this.r() * 0.4) + (-nz) * (this.r() - 0.5) * 0.9, z = d.z + nz * (0.35 + this.r() * 0.4) + nx * (this.r() - 0.5) * 0.9;
    if (!S.col.walkable(T.platform.level, x, z)) { S.kill(a); if (a.followers) for (const f of a.followers) S.kill(f); return; }
    S.setPos(a, T.platform.level, x, z);
    a.yaw = Math.atan2(-nx, -nz);
    if (a.followers) for (const f of a.followers) this.placeFollower(a, f);
    const legs = [{ t: 'to', x: x + nx * 1.6, z: z + nz * 1.6, r: 0.6 }, ...this.plan(trip === 'exit' ? 'exit' : trip, a, { line: T.line })];
    this.B.begin(a, legs);
    a.fadeDir = 1; a.fade = 1; // steps out of the carriage: no fade
    if (a.followers) for (const f of a.followers) { f.fadeDir = 1; f.fade = 1; }
  }
  onTrainDepart(ev) {
    const T = ev && ev.track && this.P.trackById[ev.track];
    if (T) { T.doorsUntil = Math.min(T.doorsUntil, this.sim.time); T.doors = null; }
  }
  _fallbackTrains() {
    const S = this.sim;
    const hasTransit = !!(this.ctx && this.ctx.transit && this.ctx.transit.trackState);
    if (hasTransit ? (S.time < 300 || S.time - this.lastRealTrain < 300) : (S.time < 2 || S.time - this.lastRealTrain < 150)) return;
    for (const pl of this.P.platforms) for (const T of pl.tracks) {
      let nt = this.fallback[T.id];
      const period = T.line === 'nankai' ? 150 : T.line === 'midosuji' ? 55 : 90;
      if (nt == null) { nt = this.fallback[T.id] = S.time + 8 + this.r() * period; continue; }
      if (S.time >= nt) {
        this.fallback[T.id] = S.time + period * (0.8 + this.r() * 0.4);
        this.onTrainArrive({ track: T.id, line: T.line, platform: pl.id, dwell: T.line === 'nankai' ? 40 : 20 }, false);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Density follows the player: far-away walkers nobody can see are moved
  // (mid-trip, same destination) onto public nodes around the player, out of
  // view, and faded in. Keeps ~nearShare of the population within ~100 m.
  _publicNodes() {
    const S = this.sim, nav = S.nav, W = S.world, L = W.layout;
    this.pub = {};
    for (const lv of nav.levelNames) {
      const g = W.grids[lv], map = nav.cellNode[lv], out = [];
      for (let i = 0; i < map.length; i++) {
        const v = map[i]; if (v < 0) continue;
        const sp = L.spaces[g.space[i]];
        if (!sp || sp.kind === 'room') continue;
        if (S.fields.clear[v] < 2) continue;
        out.push(v);
      }
      this.pub[lv] = Int32Array.from(out);
    }
  }
  sampleNear(V, rMin, rMax, hidden = true) {
    const S = this.sim, nav = S.nav;
    const list = this.pub[V.level]; if (!list || !list.length) return -1;
    const fx = -Math.sin(V.yaw || 0), fz = -Math.cos(V.yaw || 0);
    for (let k = 0; k < 60; k++) {
      const v = list[Math.floor(this.r() * list.length)];
      const dx = nav.x[v] - V.x, dz = nav.z[v] - V.z, d = Math.hypot(dx, dz);
      if (d < rMin || d > rMax) continue;
      // never spawn / relocate where the player can see it: inside 30 m always, inside 70 m unless the caller allows
      const lim = hidden ? 70 : 30;
      if ((dx * fx + dz * fz) / d > -0.1 && d < lim && S.world.visible(V.level, V.x, V.z, nav.x[v], nav.z[v])) continue;
      return v;
    }
    return -1;
  }
  placeNear(a, hidden = true, rMin = 12, rMax = 95) {
    const S = this.sim, nav = S.nav, V = S.viewer;
    if (!V.has || !a.en || !a.en.ready) return false;
    for (let k = 0; k < 4; k++) {
      const v = this.sampleNear(V, rMin, rMax, hidden);
      if (v < 0) return false;
      const d = a.en.dist[v];
      if (d === 65535 || d < 250) continue;
      S.setPos(a, V.level, nav.x[v] + a.jx, nav.z[v] + a.jz);
      const w = S.fields.next(a.en, v);
      if (w >= 0) a.yaw = Math.atan2(-(nav.x[w] - nav.x[v]), -(nav.z[w] - nav.z[v]));
      a.vx = -Math.sin(a.yaw) * a.pref; a.vz = -Math.cos(a.yaw) * a.pref;
      a.aimT = 0; a.rampNext = -1; a.acc = 0;
      if (a.followers) for (const f of a.followers) { this.placeFollower(a, f); f.fade = 0; f.fadeDir = 1; f.rampNext = -1; f.mode = MODE.FOLLOW; }
      return true;
    }
    return false;
  }
  _keepDensity(dt) {
    const S = this.sim, V = S.viewer;
    this._dkT -= dt;
    if (this._dkT > 0 || !V.has) return;
    if (this.burst > 0) { this.burst = 0; this._burstLeft = 30; } // teleport: refill spread over ~30 frames
    const burst = this._burstLeft > 0;
    if (burst) this._burstLeft--;
    this._dkT = burst ? 0 : 0.5;
    const tgt = this.target();
    const want = tgt * this.nearShare;
    let near = 0;
    const A = S.agents;
    for (let i = 0; i < A.length; i++) { const a = A[i]; if (a.alive && a.level === V.level) { const dx = a.x - V.x, dz = a.z - V.z; if (dx * dx + dz * dz < 100 * 100) near++; } }
    this.counts.near = near;
    if (near >= want) { this._burstLeft = 0; return; }
    let moves = Math.min(burst ? 12 : 14, Math.ceil((want - near) / 1.6));
    let guard = A.length;
    while (moves > 0 && guard-- > 0) {
      this._dkIdx = (this._dkIdx + 1) % A.length;
      const a = A[this._dkIdx];
      if (!a.alive || a.leader || a.tier !== 2 || a.mode !== MODE.FIELD || a.fadeDir < 0 || a.ramp >= 0) continue;
      const L = a.legs && a.legs[a.leg]; if (!L || L.t !== 'go') continue;
      if (a.level === V.level && Math.hypot(a.x - V.x, a.z - V.z) < 220) continue;
      const fa = a.fade;
      if (this.placeNear(a, !burst, burst ? 4 : 12)) { a.fade = 0; a.fadeDir = 1; moves -= 1 + (a.followers ? a.followers.length : 0); this.counts.moved = (this.counts.moved || 0) + 1; }
      else { a.fade = fa; moves--; }
    }
  }

  // ---------------------------------------------------------------------------
  // The first frame: a place already in full swing.
  _initialFill() {
    const S = this.sim, P = this.P, r = this.r;
    const tgt = this.target();
    const h = this.hours, m = this.minutes;
    const lunch = gauss(h, 12.4, 0.85);
    // staff
    let staff = 0;
    const maxStaff = Math.round(tgt * 0.1);
    const rank = (p) => p.kind === 'staff_station' ? 0 : p.real && p.hall ? 1 : p.real ? 2 : 3;
    const posts = P.posts.slice().sort((a, b) => rank(a) - rank(b));
    for (const post of posts) {
      if (staff >= maxStaff) break;
      if (post.biz && !P.bizOpen(post.biz, m)) continue;
      const a = this.makeAgent(post.kind, { look: { female: r() < 0.5, cap: post.cap || (post.biz && post.biz.restaurant && r() < 0.4), apron: post.apron } });
      S.setPos(a, post.level, post.x, post.z);
      this.B.begin(a, [{ t: 'post', level: post.level, x: post.x, z: post.z, yaw: post.yaw, kind: post.kind }]);
      staff++;
    }
    // cleaners and patrolling security
    const nClean = Math.max(2, Math.round(tgt / 160));
    for (let i = 0; i < nClean && P.halls.length; i++) {
      const H = P.halls[Math.floor(r() * P.halls.length)];
      const a = this.makeAgent(i % 4 === 3 ? 'security' : 'cleaner', {});
      const p = P.randomNodePos(H, r);
      S.setPos(a, H.level, p.x, p.z);
      this.B.begin(a, [{ t: 'patrol', H, dur: 1e9 }]);
      a.fadeDir = 1; staff++;
    }
    this.counts.staff = staff;
    // restaurants: seated + queues
    let seated = 0, queued = 0;
    for (const B of this.restaurants.concat(this.cafes)) {
      if (!P.bizOpen(B, m)) continue;
      P.spots(B);
      const busy = B.cafe ? 0.35 + 0.3 * gauss(h, 15, 2) : clamp(0.1 + lunch * 1.15 * (0.5 + B.pop), 0, 1);
      const nSeat = Math.round(B.cap * busy * (0.75 + r() * 0.3));
      for (let i = 0; i < nSeat && seated < tgt * 0.11; i++) {
        const trip = B.cafe ? 'coffee' : 'lunch';
        const a = this.makeAgent(this._kindFor(trip), { trip });
        const dw = B.info.dwell || [600, 1200];
        const dur = (dw[0] + r() * (dw[1] - dw[0])) * r() / ((S.clock && S.clock.scale) || 6);
        const legs = [{ t: 'dine', B, dur, inside: true }];
        this._onward(legs, a, null, 7);
        this.B.begin(a, legs);
        seated++;
      }
      const qh = B.info.queue || 0;
      if (!B.cafe && qh >= 0.2) {
        const q = Math.round(Math.max(0, lunch * B.pop * 1.4 * (0.6 + qh) - 0.35) * 9 * (0.7 + r() * 0.6));
        for (let i = 0; i < Math.min(q, 14) && queued < tgt * 0.08; i++) {
          const a = this._create('lunch', null);
          const sl = P.qSlot(B, B.queue.length);
          S.setPos(a, B.level, sl.x, sl.z); a.yaw = sl.yaw;
          if (a.followers) { for (const f of a.followers) S.kill(f); a.followers = null; }
          const dw = B.info.dwell || [900, 1800];
          const legs = [{ t: 'queue', B, max: 16 }, { t: 'dine', B, dur: (dw[0] + r() * (dw[1] - dw[0])) / ((S.clock && S.clock.scale) || 6) }];
          this._onward(legs, a, null, 7);
          this.B.begin(a, legs);
          a.fadeDir = 1;
          queued++;
        }
      }
    }
    this.counts.seated = seated; this.counts.queued = queued;
    // shops: a few browsing inside
    let browsing = 0;
    for (const B of this.shops) {
      if (!P.bizOpen(B, m)) continue;
      const n = Math.floor(r() * 3.2 * (0.3 + B.pop));
      for (let i = 0; i < n && browsing < tgt * 0.05; i++) {
        const a = this.makeAgent(this._kindFor('shop'), { trip: 'shop', look: { bags: 0.4 } });
        const legs = [{ t: 'browse', B, n: 1 + Math.floor(r() * 2), inside: true }];
        this._onward(legs, a, null, 7);
        this.B.begin(a, legs);
        browsing++;
      }
    }
    // platform waiters
    let waiting = 0;
    for (const pl of P.platforms) for (const T of pl.tracks) {
      const base = T.line === 'nankai' ? 7 : T.line === 'midosuji' ? 16 : 8;
      const n = Math.round(base * (0.5 + this.rush) * (0.6 + r() * 0.8));
      for (let i = 0; i < n; i++) {
        const a = this.makeGroup(this._kindFor('transit', { line: T.line }), r() < 0.15 ? 2 : 1, { trip: 'transit', look: { suitcase: T.line === 'nankai' && r() < 0.25 } });
        if (a.followers) { for (const f of a.followers) S.kill(f); a.followers = null; }
        S.setPos(a, pl.level, (pl.rect[0] + pl.rect[2]) / 2, (pl.rect[1] + pl.rect[3]) / 2);
        this.B.begin(a, [{ t: 'board', T, inside: true }]);
        waiting++;
      }
    }
    this.counts.waiting = waiting;
    // people mid-trip everywhere else
    let rest = tgt - S.count;
    let guard = 4000;
    while (rest > 0 && guard-- > 0) {
      const fromTrain = r() < 0.4;
      const tw = this._tripWeights(fromTrain);
      delete tw.meet;
      const trip = pickW(tw, r);
      let origin, a;
      if (fromTrain && P.platforms.length) {
        const pl = P.platforms[Math.floor(r() * P.platforms.length)];
        const T = pl.tracks[Math.floor(r() * pl.tracks.length)];
        const mk = T.marks.length ? T.marks[Math.floor(r() * T.marks.length)] : null;
        if (!mk) continue;
        a = this._create(trip, { line: T.line });
        S.setPos(a, pl.level, mk.x + mk.nx * 1.5, mk.z + mk.nz * 1.5);
        origin = { line: T.line };
      } else {
        const p = this.pickPortal(null);
        a = this._create(trip, { portal: p });
        S.setPos(a, p.level, p.x, p.z);
        origin = { portal: p };
      }
      const legs = this.plan(trip, a, origin);
      // start somewhere along the first walking leg (a share right around the player)
      a.ffFrac = 0.05 + r() * 0.9;
      if (r() < this.nearShare + 0.08) a.nearStart = true;
      this.B.begin(a, legs);
      rest -= 1 + (a.followers ? a.followers.length : 0);
    }
    this.counts.walking = S.count - staff - seated - queued - browsing - waiting;
  }
}

function gaussR(r) { return (r() + r() + r() - 1.5) * 1.15; }
function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
export function pickW(w, r) {
  let tot = 0; for (const k in w) tot += Math.max(0, w[k]);
  let x = r() * tot;
  for (const k in w) { x -= Math.max(0, w[k]); if (x <= 0) return k; }
  return Object.keys(w)[0];
}
export { POSE, BIT };
