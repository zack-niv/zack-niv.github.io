// =============================================================================
// Point sources in the world: shop music bleeding from storefronts, kitchens
// (tempura crackle, takoyaki sizzle), café machines, gacha, conbini door chime
// & greeting, escalator machinery and their safety announcements.
//
// Voice budget: candidates are scored by distance (+ level penalty); only the
// nearest N of each class get live nodes. Occlusion is re-evaluated round-
// robin: other level → heavy low-pass; same level but no line of sight to
// the doorway → muffled.
// =============================================================================
import { LAYOUT, LEVELS, rampEnds } from '../world/layout.js';
import { ESCALATOR, IRASSHAI } from './phrases.js';

// category → [music recipe | null, activity kind | null, music gain]
const CAT = {
  fashion: ['mus:jpop', null, 1], shoes: ['mus:citypop', null, 0.9], accessories: ['mus:citypop', null, 0.9], cosmetics: ['mus:jpop', null, 1],
  lifestyle: ['mus:bossa', null, 0.7], outdoor: ['mus:citypop', null, 0.8], eyewear: ['mus:citypop', null, 0.6], souvenir: ['mus:jpop', null, 1],
  cafe: ['mus:bossa', 'cafe', 0.8], kissaten: ['mus:bossa', 'cafe', 0.5], coffeestand: [null, 'cafe', 0], bakery: ['mus:bossa', null, 0.6], sweets: ['mus:jpop', null, 0.7],
  drugstore: ['mus:drug', null, 1.15], hyakuen: ['mus:game', null, 0.8], electronics: ['mus:game', null, 1], gacha: ['mus:game', 'gacha', 0.7], phone: ['mus:jpop', null, 0.7],
  ticket: [null, null, 0], exchange: [null, null, 0], books: [null, null, 0], stationery: [null, null, 0], florist: [null, null, 0], closed: [null, null, 0],
  conbini: ['mus:jpop', 'conbini', 0.5],
  takoyaki: [null, 'sizzle', 0], okonomiyaki: [null, 'sizzle', 0], yakiniku: [null, 'sizzle', 0],
  tempura: [null, 'tempura', 0], tendon: [null, 'tempura', 0], kushikatsu: [null, 'fryer', 0], tonkatsu: [null, 'fryer', 0],
  ramen: [null, 'kitchen', 0], udon: [null, 'kitchen', 0], sushi: [null, 'kitchen', 0], curry: [null, 'kitchen', 0], omurice: [null, 'kitchen', 0], izakaya: [null, 'kitchen', 0],
};
const ACT = {
  tempura: { recipe: 'loop:tempura', gain: 0.55, ref: 1.6, rate: 1 },
  fryer:   { recipe: 'loop:tempura', gain: 0.45, ref: 1.6, rate: 0.82 },
  sizzle:  { recipe: 'loop:sizzle', gain: 0.5, ref: 2, rate: 1 },
  kitchen: { recipe: 'loop:kitchen', gain: 0.4, ref: 2, rate: 1 },
  conbini: { recipe: 'loop:fridge', gain: 0.12, ref: 1.5, rate: 1 },
  cafe:    { recipe: null, gain: 0.5, ref: 2 },
  gacha:   { recipe: null, gain: 0.5, ref: 2 },
};
const MAX_MUSIC = 6, MAX_ACT = 4, MAX_ESC = 3;

export class Sources {
  constructor(sys) {
    this.sys = sys; this.mixer = sys.mixer; this.bank = sys.bank; this.ac = sys.mixer.ac; this.ctx = sys.ctx;
    this.shops = [];
    this.escs = [];
    this.live = new Map(); // key -> {src, em}
    this._scanT = 0; this._occI = 0;
    this.rng = 777;
    this.passed = new Map(); // conbini door passes
  }
  rand() { this.rng = (this.rng * 1664525 + 1013904223) >>> 0; return this.rng / 4294967296; }

  build(businesses) {
    this.shops = [];
    for (const b of businesses || []) {
      const c = CAT[b.cat]; if (!c || !b.door) continue;
      const [mus, act, mg] = c;
      const y0 = LEVELS[b.level] ? LEVELS[b.level].y : 0;
      const d = b.door, nx = d.nx || 0, nz = d.nz || 0;
      // speaker ~1.2 m inside the doorway, near the ceiling; kitchens deeper
      if (mus) this.shops.push({ key: 'm:' + b.slot, cls: 'music', b, recipe: mus, gain: mg, level: b.level, x: d.x - nx * 1.2, y: y0 + 2.6, z: d.z - nz * 1.2, ox: d.ox ?? d.x + nx, oz: d.oz ?? d.z + nz });
      if (act) this.shops.push({ key: 'a:' + b.slot, cls: 'act', act, b, level: b.level, x: d.x - nx * (act === 'conbini' ? 2 : 3), y: y0 + 1.0, z: d.z - nz * (act === 'conbini' ? 2 : 3), ox: d.ox ?? d.x + nx, oz: d.oz ?? d.z + nz });
    }
    // escalator banks: machinery at both landings
    const banks = new Map();
    for (const r of LAYOUT.ramps) if (r.kind === 'escalator') { const k = r.bank || r.id; if (!banks.has(k)) banks.set(k, []); banks.get(k).push(r); }
    this.escs = [];
    for (const [k, rs] of banks) {
      const ends = rs.map(r => rampEnds(r));
      const avg = (f) => ends.reduce((a, e) => a + f(e), 0) / ends.length;
      const r0 = rs[0];
      const low = { x: avg(e => e.low.x), z: avg(e => e.low.z) }, high = { x: avg(e => e.high.x), z: avg(e => e.high.z) };
      this.escs.push({ key: 'e:' + k + ':lo', bank: k, level: r0.lower, x: low.x, y: LEVELS[r0.lower].y + 0.4, z: low.z, ramps: rs });
      this.escs.push({ key: 'e:' + k + ':hi', bank: k, level: r0.upper, x: high.x, y: LEVELS[r0.upper].y + 0.4, z: high.z, ramps: rs });
    }
    this.escState = new Map(); // bank -> { next, lang, captioned }
  }

  // distance score: same level 1×, adjacent levels heavily penalised
  _score(s, L) {
    const d = Math.hypot(s.x - L.x, s.z - L.z);
    if (s.level === L.level) return d;
    const dy = Math.abs(LEVELS[s.level].y - LEVELS[L.level].y);
    return dy <= 7 ? d * 2.2 + 25 : Infinity;
  }

  update(dt, L) {
    this._scanT -= dt;
    if (this._scanT <= 0) { this._scanT = 0.5; this._select(L); }
    // occlusion: a few sources per frame
    const lv = [...this.live.values()];
    for (let k = 0; k < 3 && lv.length; k++) { this._occlude(lv[this._occI++ % lv.length], L); }
    this._activity(dt, L);
    this._escAnnounce(dt, L);
    this._conbini(dt, L);
  }

  _select(L) {
    const minutes = this.ctx.clock ? this.ctx.clock.minutes : 720;
    const want = new Map();
    const pick = (list, n, maxD) => {
      const sc = [];
      for (const s of list) { const d = this._score(s, L); if (d < maxD) sc.push([d, s]); }
      sc.sort((a, b) => a[0] - b[0]);
      for (let i = 0; i < Math.min(n, sc.length); i++) want.set(sc[i][1].key, sc[i][1]);
    };
    const open = (s) => !s.b || !s.b.hours || (s.b.cat !== 'closed' && minutes >= s.b.hours[0] - 15 && minutes < s.b.hours[1]);
    pick(this.shops.filter(s => s.cls === 'music' && open(s)), MAX_MUSIC, 45);
    pick(this.shops.filter(s => s.cls === 'act' && open(s)), MAX_ACT, 30);
    pick(this.escs, MAX_ESC, 30);
    // retire
    for (const [k, v] of this.live) if (!want.has(k)) { v.em.dispose(0.6); this.live.delete(k); }
    // spawn
    for (const [k, s] of want) {
      if (this.live.has(k)) continue;
      const recipe = s.recipe || (s.act && ACT[s.act].recipe) || (k.startsWith('e:') ? 'loop:escalator' : null);
      if (recipe) {
        const buf = this.bank.peek(recipe);
        if (!buf) { this.bank.get(recipe, 4); continue; }
        const isMusic = s.cls === 'music';
        const a = s.act ? ACT[s.act] : null;
        const em = this.mixer.emitter({ bus: isMusic ? 'music' : 'sfx', pos: { x: s.x, y: s.y, z: s.z }, hrtf: !isMusic, ref: isMusic ? 3 : a ? a.ref : 2.5, rolloff: isMusic ? 1.3 : 1.2, send: isMusic ? 0.35 : 0.3, lp: 4000 });
        em.setLoop(buf, { rate: a && a.rate || 1 });
        const base = isMusic ? 0.36 * s.gain : a ? a.gain : 0.42;
        this.live.set(k, { s, em, base, occ: 1 });
        this._occlude(this.live.get(k), L, true);
      } else {
        // activity-only sources (café machines, gacha) use one-shots through a quiet emitter
        const a = ACT[s.act];
        const em = this.mixer.emitter({ bus: 'sfx', pos: { x: s.x, y: s.y, z: s.z }, hrtf: true, ref: a.ref, send: 0.35, lp: 6000 });
        this.live.set(k, { s, em, base: a.gain, occ: 1, next: 1 + this.rand() * 4 });
        this._occlude(this.live.get(k), L, true);
      }
    }
  }

  _occlude(v, L, instant = false) {
    if (!v) return;
    const s = v.s, world = this.ctx.world;
    let g = 1, lp = 16000;
    const inside = L.space && v.s.b && L.space.id === v.s.b.slot;
    if (s.level !== L.level) {
      // through a void, an escalator well or a stair: heavily muffled
      g = 0.22; lp = 420;
    } else if (!inside) {
      const tx = s.ox ?? s.x, tz = s.oz ?? s.z;
      let vis = true;
      try { vis = world ? world.visible(L.level, L.x, L.z, tx, tz) : true; } catch (e) { vis = true; }
      if (!vis) { g = 0.4; lp = 900; }
      else if (s.cls === 'music') { lp = 5500; } // heard through the shopfront: a little dull
    }
    if (inside && s.cls === 'music') g = 0.75; // speakers overhead: don't blast
    const tc = instant ? 0.01 : 0.35;
    v.em.fade(v.base * g, instant ? 0.01 : 0.6);
    v.em.setLP(lp, tc);
  }

  // café machines, gacha cranks: stochastic one-shots near the player
  _activity(dt, L) {
    for (const v of this.live.values()) {
      if (v.next == null) continue;
      v.next -= dt;
      if (v.next > 0) continue;
      const d = Math.hypot(v.s.x - L.x, v.s.z - L.z);
      if (v.s.act === 'cafe') {
        const r = this.rand();
        const name = r < 0.25 ? 'fx:grinder' : r < 0.5 ? 'fx:steam' : 'ui:cup';
        v.next = name === 'ui:cup' ? 2 + this.rand() * 6 : 10 + this.rand() * 18;
        if (d < 25) v.em.oneShot(this.bank.peek(name) || (this.bank.get(name, 5), null), { gain: name === 'ui:cup' ? 0.6 : 0.5, rate: 0.95 + this.rand() * 0.1 });
      } else if (v.s.act === 'gacha') {
        v.next = 6 + this.rand() * 14;
        if (d < 20) v.em.oneShot(this.bank.peek('fx:gacha') || (this.bank.get('fx:gacha', 5), null), { gain: 0.7, rate: 0.92 + this.rand() * 0.16 });
      } else v.next = 999;
    }
  }

  // conbini: door chime + "irasshaimase" when someone (often you) passes the door
  _conbini(dt, L) {
    for (const v of this.live.values()) {
      if (v.s.act !== 'conbini') continue;
      const b = v.s.b, d = Math.hypot(b.door.x - L.x, b.door.z - L.z);
      const st = this.passed.get(b.slot) || { near: false, t: 8 + this.rand() * 10 };
      // the player crossing the threshold
      const nearNow = L.level === b.level && d < 2.2;
      let ring = nearNow && !st.near;
      st.near = nearNow;
      // other shoppers: stochastic, rate by crowd
      st.t -= dt * (0.4 + Math.min(1.5, this.sys.ambience.people / 25));
      if (st.t <= 0) { st.t = 9 + this.rand() * 16; if (L.level === b.level && d < 28) ring = true; }
      this.passed.set(b.slot, st);
      if (ring) {
        const pos = { x: b.door.x, y: LEVELS[b.level].y + 2.3, z: b.door.z };
        this.mixer.play('chime:conbini', { bus: 'sfx', pos, gain: 0.5, send: 0.3, ref: 2.5, lp: L.level === b.level ? 16000 : 500 });
        if (this.rand() < 0.7) {
          const g = IRASSHAI[this.rand() < 0.85 ? 0 : 1];
          const inner = { x: b.x, y: LEVELS[b.level].y + 1.5, z: b.z };
          if (this.sys.announcer) this.sys.announcer.say({ kind: 'shop', parts: [{ lang: 'ja', text: g.ja }], pos: inner, gain: 0.5, ref: 2, send: 0.25, caption: false, positional: true, gender: this.rand() < 0.5 ? 'm' : 'f', seed: 11 + Math.floor(this.rand() * 3), speech: false });
        }
      }
    }
  }

  // escalator safety announcements: loop (ja/en alternating) from the landing
  // speaker while you're near the bank
  _escAnnounce(dt, L) {
    const ann = this.sys.announcer; if (!ann) return;
    let best = null, bd = 1e9;
    for (const v of this.live.values()) {
      if (!v.s.key.startsWith('e:') || v.s.level !== L.level) continue;
      const d = Math.hypot(v.s.x - L.x, v.s.z - L.z);
      if (d < bd) { bd = d; best = v; }
    }
    const onEsc = L.ramp && L.ramp.kind === 'escalator';
    if (onEsc) { for (const v of this.live.values()) if (v.s.bank === (L.ramp.bank || L.ramp.id)) { best = v; bd = 2; break; } }
    if (!best || bd > 14) return;
    const k = best.s.bank;
    const st = this.escState.get(k) || { next: 0.8, lang: 'ja', captioned: false };
    st.next -= dt;
    if (st.next <= 0 && !ann.busyWith('escalator') && (!ann.cur || ann.cur.prio > 3)) {
      const p = st.lang === 'ja' ? { lang: 'ja', text: ESCALATOR.ja } : { lang: 'en', text: ESCALATOR.en };
      ann.say({ kind: 'escalator', parts: [p], pos: { x: best.s.x, y: best.s.y + 0.7, z: best.s.z }, gain: 0.5, ref: 2.2, send: 0.35, lp: 5000, positional: true, caption: !st.captioned, chime: st.lang === 'ja' ? 'esc' : null, seed: 7 });
      st.captioned = true;
      st.lang = st.lang === 'ja' ? 'en' : 'ja';
      st.next = st.lang === 'en' ? 1.5 : 9 + this.rand() * 4;
      // queue the next part right after this one finishes: next counts from now
      st.next += (p.lang === 'ja' ? 7.5 : 6.5);
    }
    this.escState.set(k, st);
  }
}
