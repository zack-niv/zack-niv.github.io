// =============================================================================
// Trains: reacts to the transit system's events.
//   'train:approach' {line, track, platform, eta}   eta = seconds until doors open
//   'train:arrive'   {line, track, platform, doorsAt, dwell?}
//   'train:depart'   {line, track, platform, moveIn?}  doors closing → moves after moveIn s
//   'announce'       {text, ja, kind, position, level}
// A train is a moving LINE source: its emitters sit at the point of the train
// body nearest to the listener, so a 150 m train sounds like a wall of sound
// sliding past, not a point. Arrival: tunnel wind push → roll + regenerative
// brake whine (VVVF, falling) → flange squeal → air release → doors & chime.
// Departure: door chime → doors → VVVF stepped rise → roll accelerating away.
// =============================================================================
import { LAYOUT, LEVELS } from '../world/layout.js';
import { approach, arrival, doorsClosing, departure } from './phrases.js';

const MEL = { midosuji: 'mel:midosuji', sennichimae: 'mel:sennichimae' };
const V0 = 16, TB = 14; // m/s entry speed, braking time (s)

export class Trains {
  constructor(sys) {
    this.sys = sys; this.mixer = sys.mixer; this.bank = sys.bank; this.ac = sys.mixer.ac; this.ctx = sys.ctx;
    this.trains = new Map(); // track id -> state
    this.lastEvent = -1e9;
    const ev = this.ctx.events;
    this.offs = [
      ev.on('train:approach', (e) => this.onApproach(e)),
      ev.on('train:arrive', (e) => this.onArrive(e)),
      ev.on('train:depart', (e) => this.onDepart(e)),
      ev.on('announce', (e) => this.onAnnounce(e)),
    ];
  }
  dispose() { for (const f of this.offs) f(); }
  prefetch() {
    this.bank.want(['tr:roll', 'tr:vvvf:decel:0', 'tr:vvvf:accel:0', 'tr:squeal:0', 'tr:air:0', 'tr:doors:open', 'tr:doors:close', 'chime:door', 'tr:joint:0', 'bed:tunnel'], 6);
  }
  track(e) {
    const t = e && e.track;
    if (t && typeof t === 'object' && t.rect) return t;
    let tr = LAYOUT.tracks.find(x => x.id === t);
    if (!tr && t != null) tr = LAYOUT.tracks.find(x => (x.line === e.line) && (x.no === +t || String(x.no) === String(t)));
    if (!tr && e && e.platform) tr = LAYOUT.tracks.find(x => x.platform === e.platform && (!e.line || x.line === e.line));
    return tr || null;
  }
  // geometry: centre line, axis, stop position of the head, arrival direction
  geo(tr) {
    const [x0, z0, x1, z1] = tr.rect;
    const ax = tr.axis || 'z';
    const plat = LAYOUT.spaces.find(s => s.id === tr.platform);
    const pr = plat && plat.rect ? plat.rect : tr.rect;
    const lo = ax === 'z' ? pr[1] : pr[0], hi = ax === 'z' ? pr[3] : pr[2];
    const terminal = !!tr.terminal || tr.line === 'nankai';
    // metro: arrive travelling along `heading`; Nankai terminal: arrive towards the buffer (-z), leave +z
    const dirIn = terminal ? -1 : (tr.heading || 1);
    const stop = dirIn > 0 ? hi - 3 : lo + 3;
    const len = Math.min(170, hi - lo - 4);
    return { ax, c: ax === 'z' ? (x0 + x1) / 2 : (z0 + z1) / 2, dirIn, dirOut: terminal ? 1 : dirIn, stop, len, y: LEVELS[tr.level].y + 1.1, level: tr.level, lo, hi, terminal };
  }
  state(tr) {
    let s = this.trains.get(tr.id);
    if (!s) { s = { tr, g: this.geo(tr), phase: 'idle', head: 0, v: 0, ems: null, t0: 0 }; this.trains.set(tr.id, s); }
    return s;
  }
  _ensureEms(s) {
    if (s.ems) return s.ems;
    const p = { x: 0, y: s.g.y, z: 0 };
    const roll = this.mixer.emitter({ bus: 'sfx', pos: p, ref: 6, rolloff: 0.9, send: 0.55, lp: 600, hrtf: false });
    const motor = this.mixer.emitter({ bus: 'sfx', pos: p, ref: 5, rolloff: 0.9, send: 0.5, lp: 6000 });
    const fx = this.mixer.emitter({ bus: 'sfx', pos: p, ref: 4, rolloff: 1, send: 0.5 });
    const wind = this.mixer.emitter({ bus: 'ambience', pos: p, ref: 8, rolloff: 0.8, send: 0.6, lp: 200 });
    roll.fade(0, 0.01); motor.fade(1, 0.01); fx.fade(1, 0.01); wind.fade(0, 0.01);
    s.ems = { roll, motor, fx, wind };
    return s.ems;
  }
  _listener() { return this.sys.L; }
  _hears(s) {
    const L = this._listener(); if (!L) return 0;
    if (L.level === s.g.level) return 1;
    const dy = Math.abs(LEVELS[L.level].y - LEVELS[s.g.level].y);
    return dy <= 7 ? 0.3 : 0;
  }
  _onPlatformZone(tr) {
    const L = this._listener(); if (!L) return false;
    const z = LAYOUT.spaces.find(s => s.id === tr.platform);
    return L.zone === (z && z.zone) && Math.abs(LEVELS[L.level].y - LEVELS[tr.level].y) <= 7;
  }

  onApproach(e) {
    this.lastEvent = this.ac.currentTime;
    const tr = this.track(e); if (!tr) return;
    const s = this.state(tr);
    const now = this.ac.currentTime;
    const eta = Math.max(6, Math.min(90, +e.eta || 30));
    s.phase = 'approach'; s.tStop = now + eta - 2.5; s.melodyDone = false; s.vvvfAt = s.tStop - 12.5; s.squealAt = s.tStop - 3.1; s.airAt = s.tStop + 0.4;
    s.head = s.g.stop - s.g.dirIn * (V0 * TB / 2 + V0 * 10);
    this.prefetch();
    this._ensureEms(s);
    if (this.sys.announcer) for (const t of [approach(tr), arrival(tr), doorsClosing(), departure(tr)]) this.sys.announcer.prefetch([{ lang: 'ja', text: t.ja }, { lang: 'en', text: t.en }], 3);
    // approach melody + announcement on the platform PA (metro lines)
    if (this._onPlatformZone(tr) && tr.line !== 'nankai') {
      const mel = MEL[tr.line];
      if (mel) this.mixer.play(mel, { bus: 'voice', gain: 0.5, send: 0.9, wait: true, prio: 1, pan: 0 });
      const a = approach(tr);
      setTimeoutAudio(this.ac, 5.5, () => this.sys.announcer && this.sys.announcer.say({ kind: 'train', parts: [{ lang: 'ja', text: a.ja }, { lang: 'en', text: a.en }], gain: 0.85, send: 0.9, seed: tr.line === 'midosuji' ? 3 : 4 }));
    } else if (this._onPlatformZone(tr)) {
      const a = { ja: `まもなく、${tr.no}番線に、電車が到着します。`, en: `A train is arriving at track ${tr.no}.` };
      this.sys.announcer && this.sys.announcer.say({ kind: 'train', chime: 'pa', parts: [{ lang: 'ja', text: a.ja }, { lang: 'en', text: a.en }], gain: 0.8, send: 0.8, seed: 6 });
    }
  }
  onArrive(e) {
    this.lastEvent = this.ac.currentTime;
    const tr = this.track(e); if (!tr) return;
    const s = this.state(tr);
    const now = this.ac.currentTime;
    if (s.phase !== 'approach' || Math.abs(now - (s.tStop + 2.5)) > 6) {
      // no (or stale) approach: the train is already there — just the stop sounds
      s.phase = 'stopped'; s.v = 0; s.head = s.g.stop; this._ensureEms(s);
      this._fx(s, 'tr:air:0', 0.6);
    }
    s.phase = 'stopped'; s.v = 0; s.head = s.g.stop;
    this._fx(s, 'tr:doors:open', 1.2, 0.1);
    if (tr.line !== 'nankai') this._fx(s, 'chime:door', 0.35, 0.0, 'voice');
    if (this._onPlatformZone(tr)) {
      const a = arrival(tr);
      setTimeoutAudio(this.ac, 1.5, () => this.sys.announcer && this.sys.announcer.say({ kind: 'station', parts: [{ lang: 'ja', text: a.ja }, { lang: 'en', text: a.en }], gain: 0.8, send: 0.9, seed: 3 }));
    }
    // if the dwell is known, start the departure melody before the doors close (Nankai hassha melody)
    const dwell = +e.dwell || (+e.doorsAt > now ? +e.doorsAt - now : 0);
    if (dwell > 14 && tr.line === 'nankai') setTimeoutAudio(this.ac, dwell - 12, () => this._melody(s));
  }
  _melody(s) {
    if (s.melodyDone || !this._onPlatformZone(s.tr)) return;
    s.melodyDone = true;
    const name = s.tr.line === 'nankai' ? (s.tr.no % 2 ? 'mel:nankaiA' : 'mel:nankaiB') : MEL[s.tr.line];
    this.mixer.play(name, { bus: 'voice', gain: 0.55, send: 0.7, wait: true, prio: 1 });
    const d = departure(s.tr);
    if (s.tr.line === 'nankai') this.sys.announcer && this.sys.announcer.say({ kind: 'train', parts: [{ lang: 'ja', text: d.ja }, { lang: 'en', text: d.en }], gain: 0.75, send: 0.9, seed: 4 });
  }
  onDepart(e) {
    this.lastEvent = this.ac.currentTime;
    const tr = this.track(e); if (!tr) return;
    const s = this.state(tr);
    const now = this.ac.currentTime;
    const moveIn = e.moveIn != null ? +e.moveIn : (tr.line === 'nankai' && !s.melodyDone ? 9 : 4);
    if (tr.line === 'nankai' && !s.melodyDone) this._melody(s);
    this._ensureEms(s);
    s.phase = 'closing'; s.head = s.g.stop; s.v = 0;
    s.tMove = now + moveIn;
    const closeAt = Math.max(0.5, moveIn - 3);
    this._fx(s, 'chime:door', 0.4, Math.max(0, closeAt - 1.6), 'voice');
    if (this._onPlatformZone(tr)) {
      const d = doorsClosing();
      setTimeoutAudio(this.ac, Math.max(0, closeAt - 2.5), () => this.sys.announcer && this.sys.announcer.say({ kind: 'station', parts: [{ lang: 'ja', text: d.ja }, { lang: 'en', text: d.en }], gain: 0.75, send: 0.9, seed: 3 }));
    }
    this._fx(s, 'tr:doors:close', 1.2, closeAt);
    this._fx(s, 'tr:air:0', 0.3, closeAt + 1.6);
  }
  onAnnounce(e) {
    if (!e || !this.sys.announcer) return;
    const parts = [];
    if (e.ja) parts.push({ lang: 'ja', text: e.ja });
    if (e.text) parts.push({ lang: 'en', text: e.text });
    if (!parts.length) return;
    // only audible where the player is: same level ±1 and within ~150 m of the position (if given)
    const L = this._listener();
    let gain = 0.8;
    if (L && e.position) {
      const p = e.position, d = Math.hypot((p.x ?? L.x) - L.x, (p.z ?? L.z) - L.z);
      if (d > 160) return;
      gain *= Math.max(0.25, 1 - d / 180);
    }
    if (L && e.level && e.level !== L.level) { const dy = Math.abs(LEVELS[e.level].y - LEVELS[L.level].y); if (dy > 7) return; gain *= 0.4; }
    // the HUD already subtitles 'announce' events → no caption from us
    this.sys.announcer.say({ kind: e.kind === 'ambient' ? 'ambient' : 'station', chime: e.kind === 'train' || e.chime === false ? null : 'pa', parts, gain, send: 0.9, caption: false, seed: 3 });
  }
  _fx(s, name, gain, delay = 0, bus = 'sfx') {
    const buf = this.bank.peek(name);
    if (!buf) { this.bank.get(name, 2); return; }
    const em = this._ensureEms(s).fx;
    if (bus === 'voice') this.mixer.play(buf, { bus: 'voice', pos: em.pos || { x: 0, y: s.g.y, z: 0 }, gain: gain * 1.2, send: 0.6, ref: 4, when: this.ac.currentTime + delay });
    else em.oneShot(buf, { gain: gain * this._hears(s), when: this.ac.currentTime + delay });
  }

  update(dt) {
    const L = this._listener(); if (!L) return;
    const now = this.ac.currentTime;
    for (const s of this.trains.values()) {
      const g = s.g;
      // kinematics
      if (s.phase === 'approach') {
        const tb0 = s.tStop - TB;
        if (now < tb0) { s.v = V0; s.head = g.stop - g.dirIn * (V0 * TB / 2 + V0 * (tb0 - now)); }
        else if (now < s.tStop) { const tt = s.tStop - now; s.v = V0 * tt / TB; s.head = g.stop - g.dirIn * (V0 / (2 * TB)) * tt * tt; }
        else { s.v = 0; s.head = g.stop; }
        if (!s.vvvfOn && now >= s.vvvfAt) { s.vvvfOn = true; const b = this.bank.peek('tr:vvvf:decel:0'); if (b) this._ensureEms(s).motor.oneShot(b, { gain: 0.9, when: s.vvvfAt }); }
        if (!s.squealOn && now >= s.squealAt) { s.squealOn = true; this._fx(s, 'tr:squeal:0', 0.5); }
        if (!s.airOn && now >= s.airAt) { s.airOn = true; this._fx(s, 'tr:air:0', 0.8); }
      } else if (s.phase === 'closing' && now >= s.tMove) {
        s.phase = 'leaving'; s.tLeave = now; s.vvvfOn = false;
        const b = this.bank.peek('tr:vvvf:accel:0');
        if (b) this._ensureEms(s).motor.oneShot(b, { gain: 0.95 });
      } else if (s.phase === 'leaving') {
        const t = now - s.tLeave;
        s.v = Math.min(V0 * 1.2, 0.95 * t);
        s.head = g.stop + g.dirOut * 0.5 * 0.95 * Math.min(t, V0 * 1.2 / 0.95) ** 2 + (t > V0 * 1.2 / 0.95 ? g.dirOut * V0 * 1.2 * (t - V0 * 1.2 / 0.95) : 0);
        if (t > 40) { s.phase = 'gone'; }
      }
      if (!s.ems) continue;
      // nearest point on the train body to the listener
      const tail = s.head - (s.phase === 'leaving' ? g.dirOut : g.dirIn) * g.len;
      const a0 = Math.min(s.head, tail), a1 = Math.max(s.head, tail);
      const la = g.ax === 'z' ? L.z : L.x;
      const along = Math.max(a0, Math.min(a1, la));
      const pos = g.ax === 'z' ? { x: g.c, y: g.y, z: along } : { x: along, y: g.y, z: g.c };
      const hear = this._hears(s);
      for (const k of ['roll', 'motor', 'fx']) s.ems[k].setPos(pos.x, pos.y, pos.z);
      // roll: gain/brightness/rate with speed
      const sp = Math.min(1.3, s.v / V0);
      // in the tunnel (beyond the platform ends) the train is a dark rumble; it brightens as it bursts in
      const dist = Math.hypot(pos.x - L.x, pos.z - L.z);
      const inTunnel = (s.head < g.lo - 5 || s.head > g.hi + 5) && !g.terminal ? 1 : 0;
      const open = Math.max(0, Math.min(1, 1 - (dist - 12) / 90)) * (inTunnel ? 0.45 : 1);
      if (sp > 0.01 && !s.ems.roll.src) { const b = this.bank.peek('tr:roll'); if (b) s.ems.roll.setLoop(b); }
      s.ems.roll.fade(2.8 * Math.pow(sp, 1.1) * hear, 0.25);
      s.ems.roll.setRate(0.65 + 0.45 * sp, 0.25);
      s.ems.roll.setLP((hear < 1 ? 250 : 220 + 3200 * sp * open), 0.2);
      s.ems.motor.setLP(hear < 1 ? 400 : 700 + 5300 * open, 0.3);
      s.ems.motor.fade(hear, 0.3);
      s.ems.fx.setLP(hear < 1 ? 500 : 18000, 0.3);
      // tunnel wind push ahead of an arriving subway train
      if (!g.terminal) {
        const mouth = g.dirIn > 0 ? g.lo : g.hi;
        const wp = g.ax === 'z' ? { x: g.c, y: g.y + 1, z: mouth } : { x: mouth, y: g.y + 1, z: g.c };
        s.ems.wind.setPos(wp.x, wp.y, wp.z);
        let wg = 0;
        if (s.phase === 'approach') { const tt = s.tStop - now; wg = tt > 22 ? Math.max(0, 1 - (tt - 22) / 10) : tt > 6 ? 1 : Math.max(0, tt / 6); }
        if (s.phase === 'leaving') { const t = now - s.tLeave; wg = t > 8 && t < 22 ? 0.6 : 0; }
        if (wg > 0 && !s.ems.wind.src) { const b = this.bank.peek('bed:tunnel'); if (b) s.ems.wind.setLoop(b); }
        s.ems.wind.fade(wg * 0.75 * hear, 1.2);
        s.ems.wind.setLP(160 + wg * 700, 1);
      }
      // rail joints (audible ta-tan as bogies pass the listener's projection)
      if (sp > 0.15 && la > a0 - 20 && la < a1 + 20) {
        s.jointT = (s.jointT || 0) - dt * s.v / 9.5; // two bogies per ~19 m car
        if (s.jointT <= 0) { s.jointT = 1; const b = this.bank.peek('tr:joint:0'); if (b) s.ems.roll.oneShot(b, { gain: (g.terminal ? 0.5 : 0.25) * sp, rate: 0.9 + sp * 0.2 }); }
      }
      if (s.phase === 'gone') { for (const k in s.ems) s.ems[k].dispose(0.5); s.ems = null; s.phase = 'idle'; s.vvvfOn = s.squealOn = s.airOn = false; }
    }
  }
}

// schedule a callback at AudioContext time (works offline too: polled from update)
const _timers = [];
export function setTimeoutAudio(ac, delay, fn) { _timers.push({ ac, at: ac.currentTime + delay, fn }); }
export function pumpAudioTimers() {
  for (let i = _timers.length - 1; i >= 0; i--) {
    const t = _timers[i];
    if (t.ac.currentTime >= t.at) { _timers.splice(i, 1); try { t.fn(); } catch (e) { console.error('[audio] timer', e); } }
  }
}
