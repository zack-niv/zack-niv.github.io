// =============================================================================
// Ambience: the beds that tell you where you are with your eyes closed.
//
//  * Bed layers (seamless loops) mixed per acoustic "mood" and crossfaded as
//    the player moves; on stairs/escalators the two ends' moods are blended by
//    progress along the ramp (you hear the street swell as you climb out).
//  * Crowd: walla (two decorrelated loop instances) scaled by local density,
//    a granular footstep cloud whose rate follows density (no per-NPC nodes),
//    a dense step texture above the granular limit, passing suitcases.
//  * Nature/street events: birds, crows, crossing signals, horns, buses,
//    distant trains under the floor, distant PA.
// =============================================================================
import { ZONES } from '../world/layout.js';
import { AMBIENT_PA } from './phrases.js';

// layer name → recipe, bus, base gain
const LAYERS = {
  hvac_tile:   { recipe: 'bed:hvac:tile', bus: 'ambience', g: 1 },
  hvac_arcade: { recipe: 'bed:hvac:arcade', bus: 'ambience', g: 1 },
  hvac_big:    { recipe: 'bed:hvac:big', bus: 'ambience', g: 1 },
  hvac_mall:   { recipe: 'bed:hvac:mall', bus: 'ambience', g: 1 },
  hvac_dept:   { recipe: 'bed:hvac:dept', bus: 'ambience', g: 1 },
  tunnel:      { recipe: 'bed:tunnel', bus: 'ambience', g: 1 },
  traffic:     { recipe: 'bed:traffic', bus: 'ambience', g: 1 },
  cityfar:     { recipe: 'bed:cityfar', bus: 'ambience', g: 1 },
  leaves:      { recipe: 'bed:leaves', bus: 'ambience', g: 1 },
  aux:         { recipe: 'tr:aux', bus: 'ambience', g: 1, lp: 1800 },
  bgm:         { recipe: 'mus:dept', bus: 'music', g: 1, lp: 7000, send: 0.5 },
};
// mood → layer gains (crowd layers are handled separately and scaled by density)
const MOODS = {
  metro:     { hvac_tile: 0.30, walla: 0.55, cloud: 1.0, steps: 'tile', pa: 'metro' },
  platform:  { hvac_tile: 0.16, tunnel: 0.42, walla: 0.45, cloud: 0.9, steps: 'stone', pa: 'metro', trainsUnder: false },
  arcade:    { hvac_arcade: 0.30, walla: 0.6, cloud: 1.0, steps: 'tile', pa: 'arcade' },
  department:{ hvac_dept: 0.22, bgm: 0.16, walla: 0.35, cloud: 0.7, steps: 'stone', pa: 'department' },
  street:    { traffic: 0.62, cityfar: 0.18, walla: 0.25, cloud: 0.6, steps: 'paving', outdoor: true },
  terminal:  { hvac_big: 0.32, walla: 0.65, cloud: 1.0, steps: 'stone', pa: 'terminal' },
  nkplatform:{ hvac_big: 0.12, aux: 0.10, cityfar: 0.16, walla: 0.45, cloud: 0.9, steps: 'paving', pa: 'terminal' },
  passage:   { hvac_tile: 0.28, walla: 0.45, cloud: 1.0, steps: 'tile', pa: 'metro' },
  mall:      { hvac_mall: 0.26, bgm: 0.11, walla: 0.5, cloud: 0.9, steps: 'tile', pa: 'mall' },
  parks:     { hvac_mall: 0.22, bgm: 0.09, walla: 0.38, cloud: 0.8, steps: 'stone', pa: 'mall' },
  canyon:    { cityfar: 0.34, leaves: 0.16, traffic: 0.04, walla: 0.3, cloud: 0.7, steps: 'paving', outdoor: true, birds: 0.5 },
  garden:    { cityfar: 0.2, leaves: 0.28, walla: 0.12, cloud: 0.3, steps: 'paving', outdoor: true, birds: 1 },
  shop:      { hvac_mall: 0.12, walla: 0.2, cloud: 0.35, steps: 'tile' },
};
// baseline people within ~12 m when the crowd system can't tell us
const BASE_PEOPLE = { metro: 26, platform: 18, arcade: 30, department: 14, street: 16, terminal: 36, nkplatform: 16, passage: 22, mall: 22, parks: 12, canyon: 14, garden: 5, shop: 4 };

export function moodOf(zone, space, ramp) {
  if (space && space.kind === 'room') return 'shop';
  const zm = ZONES[zone] ? ZONES[zone].mood : 'passage';
  if (space) {
    if (space.kind === 'platform') return zone === 'nankai' ? 'nkplatform' : 'platform';
    if (space.style === 'terminal_platform') return 'nkplatform';
    if (zone === 'parks' && space.outdoor) return 'canyon';
    if (space.outdoor && zm !== 'garden' && zm !== 'parks') return 'street';
  }
  return MOODS[zm] ? zm : 'passage';
}

export class Ambience {
  constructor(sys) {
    this.sys = sys; this.mixer = sys.mixer; this.bank = sys.bank; this.ac = sys.mixer.ac; this.ctx = sys.ctx;
    this.layers = {};
    for (const [name, L] of Object.entries(LAYERS)) this.layers[name] = { ...L, name, em: null, target: 0, cur: 0, idle: 0 };
    // walla: two decorrelated instances of the same loop, spread L/R
    this.walla = [-0.6, 0.6].map((pan) => ({ em: null, pan }));
    this.stepsTex = { em: null, surface: null };
    // footstep cloud lanes (StereoPanner + LP) — grains are routed into these
    this.lanes = [];
    const pans = [-0.85, -0.5, -0.18, 0.18, 0.5, 0.85];
    for (let i = 0; i < pans.length; i++) {
      const em = this.mixer.emitter({ bus: 'ambience', pan: pans[i], send: 0.45, lp: 3200 + (i % 3) * 1500 });
      em.fade(1, 0.01);
      this.lanes.push(em);
    }
    this.cloud = { next: 0, rate: 0, surface: 'tile' };
    this.mood = null; this.weights = {};
    this.people = 10; this._peopleT = 0;
    this.timers = { bird: 2, crow: 12, horn: 50, bus: 30, under: 40, pa: 25, suitcase: 15 };
    this.suitcases = [];
    this.signals = [];   // crossing signal emitters
    this.rngState = 12345;
  }
  rand() { this.rngState = (this.rngState * 1664525 + 1013904223) >>> 0; return this.rngState / 4294967296; }

  // ---------------------------------------------------------------------------
  update(dt, L) {
    const { level, x, z, zone, space, ramp } = L;
    // mood weights (blend across ramps by progress)
    const w = {};
    if (L.rampBlend) { for (const [m, k] of L.rampBlend) w[m] = (w[m] || 0) + k; }
    else w[moodOf(zone, space, ramp)] = 1;
    this.weights = w;
    const main = Object.entries(w).sort((a, b) => b[1] - a[1])[0][0];
    if (main !== this.mood) { this.mood = main; this._prefetchMood(main); }
    // crowd density (people within ~12 m)
    this._peopleT -= dt;
    if (this._peopleT <= 0) { this._peopleT = 0.5; this.people = this._density(L, w); }
    const dens = Math.min(1.4, this.people / 30);
    // bed layer targets
    const tgt = {};
    for (const [m, k] of Object.entries(w)) {
      const M = MOODS[m] || MOODS.passage;
      for (const ln in LAYERS) if (M[ln]) tgt[ln] = (tgt[ln] || 0) + M[ln] * k;
    }
    for (const ln in this.layers) this._layer(this.layers[ln], (tgt[ln] || 0), dt);
    // crowd layers
    let wallaG = 0, cloudG = 0, outdoor = 0, birds = 0;
    for (const [m, k] of Object.entries(w)) { const M = MOODS[m] || MOODS.passage; wallaG += (M.walla || 0) * k; cloudG += (M.cloud || 0) * k; outdoor += (M.outdoor ? 1 : 0) * k; birds += (M.birds || 0) * k; }
    // Japanese crowds are quiet: murmur grows sub-linearly with density
    const wl = wallaG * Math.min(1.15, 0.12 + 0.75 * Math.sqrt(dens));
    this._walla(wl, outdoor);
    const surface = (MOODS[main] && MOODS[main].steps) || 'tile';
    this._cloud(dt, cloudG, dens, L.stepSurface || surface);
    this._suitcases(dt, L, dens);
    this._events(dt, L, main, birds, outdoor);
    this._signals(dt, L);
  }

  _density(L, w) {
    const c = this.ctx.crowd;
    try {
      if (c && typeof c.densityNear === 'function') {
        const v = c.densityNear(L.level, L.x, L.z, 12);
        if (typeof v === 'number' && isFinite(v)) return v > 1.5 ? v : v * 60; // count, or 0..1 normalised
      }
      if (c && typeof c.agentsNear === 'function') {
        const a = c.agentsNear(L.level, L.x, L.z, 12);
        if (a && typeof a.length === 'number') return a.length;
      }
    } catch (e) { /* crowd API changed: fall back */ }
    const rush = this.ctx.clock ? this.ctx.clock.rush : 0.5;
    let p = 0;
    for (const [m, k] of Object.entries(w)) p += (BASE_PEOPLE[m] ?? 15) * k;
    return p * (0.5 + 0.8 * rush);
  }

  _prefetchMood(m) {
    const M = MOODS[m] || {};
    const want = [];
    for (const ln in LAYERS) if (M[ln]) want.push(LAYERS[ln].recipe);
    if (M.walla) want.push('bed:walla');
    if (M.steps) for (let i = 0; i < 6; i++) want.push(`fs:${M.steps}:${i < 3 ? 'sneaker' : i < 5 ? 'leather' : 'heel'}:${i}`);
    if (M.birds) want.push('bird:bulbul:0', 'bird:sparrow:0', 'bird:whiteeye:0', 'bird:tit:0', 'bird:crow:0', 'bird:sparrow:1', 'bird:bulbul:1');
    if (M.outdoor) want.push('bird:crow:1', 'fx:horn');
    this.bank.want(want, 3);
  }

  _layer(Ly, target, dt) {
    if (target > 0.001) {
      Ly.idle = 0;
      if (!Ly.em) {
        const buf = this.bank.peek(Ly.recipe);
        if (!buf) { this.bank.get(Ly.recipe, 2); return; }
        Ly.em = this.mixer.emitter({ bus: Ly.bus, send: Ly.send ?? 0.2, lp: Ly.lp ?? 20000 });
        Ly.em.setLoop(buf);
        Ly.cur = 0;
      }
    } else if (Ly.em) {
      Ly.idle += dt;
      if (Ly.idle > 12) { Ly.em.dispose(0.3); Ly.em = null; return; } // free CPU when long silent
    }
    if (Ly.em && Math.abs(target - Ly.cur) > 0.002) { Ly.cur = target; Ly.em.fade(target * Ly.g, 1.1); }
  }

  _walla(g, outdoor) {
    const buf = this.bank.peek('bed:walla');
    if (!buf) { if (g > 0) this.bank.get('bed:walla', 2); return; }
    this.walla.forEach((wv, i) => {
      if (!wv.em) {
        wv.em = this.mixer.emitter({ bus: 'ambience', pan: wv.pan, send: 0.5, lp: 2600 });
        wv.em.setLoop(buf, { offset: i * buf.duration * 0.47, rate: i ? 1.035 : 0.975 });
      }
      wv.em.fade(g * 0.8, 1.5);
      // outdoors the murmur is drier & brighter, indoors wetter
      wv.em.setSend(outdoor > 0.5 ? 0.15 : 0.55, 1);
    });
  }

  // granular footstep cloud: Poisson grains at a rate following density
  _cloud(dt, g, dens, surface) {
    const now = this.ac.currentTime;
    const rate = Math.min(22, this.people * 1.6 * Math.min(1, g)) * (g > 0 ? 1 : 0); // steps per second
    this.cloud.rate = rate;
    if (this.cloud.next < now) this.cloud.next = now + 0.05;
    const bankName = (i, shoe) => `fs:${surface}:${shoe}:${i}`;
    let guard = 0;
    while (rate > 0.2 && this.cloud.next < now + 0.2 && guard++ < 16) {
      const t = this.cloud.next;
      this.cloud.next += -Math.log(1 - this.rand() * 0.999) / rate;
      const r = this.rand();
      const shoe = r < 0.55 ? 'sneaker' : r < 0.85 ? 'leather' : 'heel';
      const i = shoe === 'sneaker' ? Math.floor(this.rand() * 3) : shoe === 'leather' ? 3 + Math.floor(this.rand() * 2) : 5;
      const buf = this.bank.peek(bankName(i, shoe));
      if (!buf) { this.bank.get(bankName(i, shoe), 4); continue; }
      const lane = this.lanes[Math.floor(this.rand() * this.lanes.length)];
      // distance: most steps are 3-12 m away
      const d = 2.5 + Math.pow(this.rand(), 0.7) * 10;
      lane.oneShot(buf, { gain: g * 0.55 / d * (0.7 + this.rand() * 0.6), rate: 0.9 + this.rand() * 0.2, when: t });
    }
    // dense texture beyond granular range
    const texG = g * Math.max(0, Math.min(1, (this.people - 14) / 30)) * 0.22;
    const tex = this.stepsTex;
    const tname = `bed:steps:${surface === 'grass' || surface === 'wood' || surface === 'metal' || surface === 'carpet' ? 'stone' : surface}`;
    if (texG > 0.005) {
      const buf = this.bank.peek(tname);
      if (!buf) this.bank.get(tname, 5);
      else {
        if (!tex.em) tex.em = this.mixer.emitter({ bus: 'ambience', send: 0.5, lp: 6000 });
        if (tex.name !== tname) { tex.em.setLoop(buf); tex.name = tname; }
      }
    }
    if (tex.em) tex.em.fade(texG, 1.2);
  }

  // rolling suitcases passing by (Nankai = airport line: lots)
  _suitcases(dt, L, dens) {
    this.timers.suitcase -= dt * (0.3 + dens) * (this.mood === 'terminal' || this.mood === 'nkplatform' ? 2.2 : this.mood === 'shop' || this.mood === 'garden' || this.mood === 'department' ? 0.15 : 1);
    if (this.timers.suitcase <= 0) {
      this.timers.suitcase = 18 + this.rand() * 30;
      const buf = this.bank.peek('loop:suitcase');
      if (!buf) { this.bank.get('loop:suitcase', 5); }
      else if (this.suitcases.length < 2 && !L.outdoorish) {
        // path parallel to the player's facing-ish axis, offset sideways
        const a = this.rand() * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a);
        const off = (this.rand() < 0.5 ? -1 : 1) * (1.4 + this.rand() * 3);
        const sx = L.x - dx * 9 - dz * off, sz = L.z - dz * 9 + dx * off;
        const ex = L.x + dx * 9 - dz * off, ez = L.z + dz * 9 + dx * off;
        const world = this.ctx.world;
        if (!world || (world.isWalkable(L.level, sx, sz) && world.isWalkable(L.level, ex, ez) && world.visible(L.level, sx, sz, ex, ez))) {
          const speed = 1.15 + this.rand() * 0.35;
          const em = this.mixer.emitter({ bus: 'ambience', pos: { x: sx, y: L.y + 0.2, z: sz }, hrtf: true, ref: 1.5, send: 0.4 });
          em.setLoop(buf, { rate: speed / 1.3 });
          em.fade(0.42, 0.6);
          this.suitcases.push({ em, x: sx, z: sz, dx, dz, speed, t: 0, dur: 18 / speed, y: L.y + 0.2 });
        }
      }
    }
    for (let i = this.suitcases.length - 1; i >= 0; i--) {
      const s = this.suitcases[i];
      s.t += dt; s.x += s.dx * s.speed * dt; s.z += s.dz * s.speed * dt;
      s.em.setPos(s.x, s.y, s.z);
      if (s.t > s.dur - 1.2 && !s.fading) { s.fading = true; s.em.fade(0, 0.4); }
      if (s.t > s.dur) { s.em.dispose(0.2); this.suitcases.splice(i, 1); }
    }
  }

  _events(dt, L, mood, birds, outdoor) {
    const T = this.timers;
    const up = L.y + 1.6;
    const at = (dmin, dmax, h) => { const a = this.rand() * Math.PI * 2, d = dmin + this.rand() * (dmax - dmin); return { x: L.x + Math.cos(a) * d, y: up + h, z: L.z + Math.sin(a) * d }; };
    // birds (parks outdoor). Mostly bulbuls & sparrows; white-eyes & tits in the trees
    if (birds > 0.05) {
      T.bird -= dt * birds;
      if (T.bird <= 0) {
        T.bird = 0.7 + this.rand() * 3.2;
        const r = this.rand();
        const sp = r < 0.28 ? 'bulbul' : r < 0.58 ? 'sparrow' : r < 0.8 ? 'whiteeye' : r < 0.95 ? 'tit' : 'crow';
        const name = `bird:${sp}:${Math.floor(this.rand() * 2)}`;
        const p = sp === 'crow' ? at(25, 60, 12) : at(6, 30, 2 + this.rand() * 5);
        this.mixer.play(name, { bus: 'ambience', pos: p, gain: sp === 'bulbul' ? 1.0 : sp === 'crow' ? 0.9 : 0.8, send: 0.25, ref: 5, hrtf: true, rate: 0.96 + this.rand() * 0.08, prio: 5 });
      }
    }
    // crows over the streets & parks (very Osaka)
    if (outdoor > 0.3) {
      T.crow -= dt;
      if (T.crow <= 0) { T.crow = 14 + this.rand() * 30; this.mixer.play(`bird:crow:${Math.floor(this.rand() * 2)}`, { bus: 'ambience', pos: at(30, 70, 15), gain: 0.7, send: 0.3, ref: 6, prio: 6 }); }
    }
    // street: rare polite horns, buses kneeling at the stop
    if ((this.weights.street || 0) > 0.3) {
      T.horn -= dt; T.bus -= dt;
      if (T.horn <= 0) { T.horn = 70 + this.rand() * 110; this.mixer.play('fx:horn', { bus: 'ambience', pos: at(25, 60, 0), gain: 0.35, send: 0.3, ref: 6, prio: 6 }); }
      if (T.bus <= 0) { T.bus = 45 + this.rand() * 60; const p = at(12, 30, -0.8); this.mixer.play('fx:bus', { bus: 'ambience', pos: p, gain: 0.5, send: 0.3, ref: 5, prio: 6 }); }
    }
    // distant trains rumbling beneath underground passages
    if (L.level === 'B1' || (L.level === '1F' && mood === 'street')) {
      T.under -= dt;
      if (T.under <= 0) {
        T.under = 50 + this.rand() * 70;
        if (mood !== 'shop') this.mixer.play(`fx:traindist:${Math.floor(this.rand() * 2)}`, { bus: 'ambience', pos: { x: L.x + (this.rand() - 0.5) * 30, y: up - 9, z: L.z + (this.rand() - 0.5) * 30 }, gain: 0.55, send: 0.25, ref: 8, lp: 260, prio: 6 });
      }
    }
    // distant PA in big stations, malls, the arcade
    const pa = MOODS[mood] && MOODS[mood].pa;
    if (pa && this.sys.announcer) {
      T.pa -= dt;
      if (T.pa <= 0) {
        T.pa = 35 + this.rand() * 55;
        const lines = AMBIENT_PA[pa];
        if (lines && !this.sys.announcer.busyWith('ambient') && !this.sys.announcer.cur) {
          const l = lines[Math.floor(this.rand() * lines.length)];
          this.sys.announcer.say({ kind: 'ambient', distant: true, speech: false, parts: [{ lang: 'ja', text: l.ja }, { lang: 'en', text: l.en }], chime: 'pa', gain: 0.32, lp: 2200, send: 1.4, seed: 5 + Math.floor(this.rand() * 4), caption: true });
        }
      }
    }
  }

  // pedestrian crossing signals at the Sennichimae-dori / Midosuji crossings
  _signals(dt, L) {
    const sites = this.sys.crossings || [];
    const now = this.ac.currentTime;
    for (const s of sites) {
      const d = Math.hypot(L.x - s.x, L.z - s.z);
      const near = d < 70 && (L.level === '1F' || L.level === 'B1' && d < 25);
      if (near && !s.em) {
        const buf = this.bank.peek('sig:' + s.kind);
        if (!buf) { this.bank.get('sig:' + s.kind, 5); continue; }
        s.em = this.mixer.emitter({ bus: 'ambience', pos: { x: s.x, y: 3, z: s.z }, ref: 3, send: 0.3 });
        s.em.setLoop(buf, { offset: 0 });
      } else if (!near && s.em) { s.em.dispose(0.5); s.em = null; }
      if (s.em) {
        // 70 s cycle; pedestrians get ~20 s of green, signal sounds during green
        const ph = (now + s.phase) % 70;
        const on = ph < 20 ? 1 : 0;
        const occl = L.level === '1F' ? 1 : 0.15;
        s.em.fade(on * 0.5 * occl, 0.15);
        if (L.level !== '1F') s.em.setLP(700); else s.em.setLP(16000);
      }
    }
  }
}
export { MOODS };
