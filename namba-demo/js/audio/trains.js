// =============================================================================
// Trains.
//
// LIVE mode (ctx.transit present): every live train in `ctx.transit.trains`
// ({id, track, state, speed, front, cars}) is rendered as a moving LINE source
// — its emitters sit at the point of the train body nearest to the listener,
// so a 140 m train sounds like a wall of sound sliding past. Sound follows the
// transit kinematics exactly: tunnel push → roll → regenerative-brake VVVF
// whine falling to the stop → flange squeal → air release; doors on
// train:arrive / train:closing; VVVF stepped rise + roll on departure.
// Voice lines come from transit's 'announce' events; their `sound` hints pick
// the approach melody (metro), the PA chime or the departure melody (Nankai).
//
// FALLBACK mode (no transit system): an internal kinematic model driven by
// train:approach {etaSec|eta} / train:arrive / train:closing / train:depart,
// with our own bilingual announcements (phrases.js).
// =============================================================================
import { LAYOUT, LEVELS } from '../world/layout.js?v=c81de75';
import { approach, arrival, doorsClosing, departure, firstSentences } from './phrases.js?v=c81de75';
import { platformGain, platformOf } from './zones.js?v=c81de75';

const MEL = { midosuji: 'mel:midosuji', sennichimae: 'mel:sennichimae' };
const V0 = 16, TB = 14; // fallback: m/s entry speed, braking time (s)

export class Trains {
  constructor(sys) {
    this.sys = sys; this.mixer = sys.mixer; this.bank = sys.bank; this.ac = sys.mixer.ac; this.ctx = sys.ctx;
    this.trains = new Map(); // key -> state
    const ev = this.ctx.events;
    this.offs = [
      ev.on('train:approach', (e) => this.onApproach(e)),
      ev.on('train:arrive', (e) => this.onArrive(e)),
      ev.on('train:closing', (e) => this.onClosing(e)),
      ev.on('train:depart', (e) => this.onDepart(e)),
      ev.on('announce', (e) => this.onAnnounce(e)),
    ];
  }
  get live() { const t = this.ctx.transit; return !!(t && Array.isArray(t.trains)); }
  dispose() { for (const f of this.offs) f(); }
  prefetch() {
    this.bank.want(['tr:roll', 'tr:vvvf:decel:0', 'tr:vvvf:accel:0', 'tr:squeal:0', 'tr:air:0', 'tr:doors:open', 'tr:doors:close', 'chime:door', 'tr:joint:0', 'bed:tunnel', 'chime:pa'], 6);
  }
  track(e) {
    const t = e && e.track;
    if (t && typeof t === 'object' && t.rect) return t;
    let tr = LAYOUT.tracks.find(x => x.id === t);
    if (!tr && (t != null || e.trackNo != null)) { const no = e.trackNo ?? t; tr = LAYOUT.tracks.find(x => x.line === e.line && String(x.no) === String(no)); }
    if (!tr && e && e.platform) tr = LAYOUT.tracks.find(x => x.platform === e.platform && (!e.line || x.line === e.line));
    return tr || null;
  }
  // geometry: centre line, axis, stop position of the head, arrival direction
  geo(tr) {
    const [x0, z0, x1, z1] = tr.rect;
    const ax = tr.axis || 'z';
    const plat = LAYOUT.spaces.find(s => s.id === tr.platform);
    const pr = plat && plat.rect ? plat.rect : tr.rect;
    let lo = ax === 'z' ? pr[1] : pr[0], hi = ax === 'z' ? pr[3] : pr[2];
    const terminal = !!tr.terminal || tr.line === 'nankai';
    let dirIn = terminal ? -1 : (tr.heading || 1);
    let c = ax === 'z' ? (x0 + x1) / 2 : (z0 + z1) / 2;
    // prefer transit's own geometry if available
    try {
      const ti = this.ctx.transit && this.ctx.transit.trackInfo && this.ctx.transit.trackInfo(tr.id);
      if (ti) {
        if (ti.centre != null) c = ti.centre;
        if (ti.platformRange) { lo = Math.min(...ti.platformRange); hi = Math.max(...ti.platformRange); }
        if (ti.stopFront != null) dirIn = Math.abs(ti.stopFront - hi) < Math.abs(ti.stopFront - lo) ? 1 : -1;
      }
    } catch (e) { /* transit API changed */ }
    const stop = dirIn > 0 ? hi - 3 : lo + 3;
    const carLen = tr.line === 'nankai' ? 20 : 14;
    return { ax, c, dirIn, dirOut: terminal ? -dirIn : dirIn, stop, len: Math.min(200, hi - lo - 4), carLen, y: LEVELS[tr.level].y + 1.1, level: tr.level, lo, hi, terminal };
  }
  state(key, tr) {
    let s = this.trains.get(key);
    if (!s) { s = { key, tr, g: this.geo(tr), phase: 'idle', head: 0, v: 0, ems: null, seen: 0 }; this.trains.set(key, s); }
    return s;
  }
  _ensureEms(s) {
    if (s.ems) return s.ems;
    const p = { x: 0, y: s.g.y, z: 0 };
    // distance law is applied explicitly (see _render: level = dist × occlusion × PSD) so the dry path and the
    // reverb send fall away together; the panner only supplies direction (rolloff 0)
    const roll = this.mixer.emitter({ bus: 'sfx', pos: p, ref: 6, rolloff: 0, send: 0.55, lp: 600 });
    const motor = this.mixer.emitter({ bus: 'sfx', pos: p, ref: 5, rolloff: 0, send: 0.5, lp: 6000 });
    const fx = this.mixer.emitter({ bus: 'sfx', pos: p, ref: 4, rolloff: 0, send: 0.5 });
    const wind = this.mixer.emitter({ bus: 'ambience', pos: p, ref: 8, rolloff: 0.8, send: 0.6, lp: 200 });
    roll.fade(0, 0.01); motor.fade(0, 0.01); fx.fade(0, 0.01); wind.fade(0, 0.01);
    s.ems = { roll, motor, fx, wind };
    this.prefetch();
    return s.ems;
  }
  // how audible this train's platform is from where the listener stands (zones.js): 1 on the platform, ~0.2 on the
  // concourse directly above it, 0 elsewhere. Everything a train makes (and its PA) is scaled by this.
  _hears(s) {
    const L = this.sys.L; if (!L) return 0;
    if (s.plat === undefined) s.plat = LAYOUT.spaces.find(sp => sp.id === s.tr.platform) || null;
    return platformGain(s.plat, L);
  }
  _pgTr(tr) {
    const L = this.sys.L; if (!L || !tr) return 0;
    const sp = LAYOUT.spaces.find(x => x.id === tr.platform);
    return platformGain(sp, L);
  }
  _nearPlatform(tr) { return this._pgTr(tr) > 0.06; }
  // platform screen doors: closed -> the train in the tunnel is muffled; they open with the train doors
  _psd(s, now) {
    if (s.psdAt === undefined || now - s.psdAt > 0.2) {
      s.psdAt = now; let v = 1;
      try {
        const t = this.ctx.transit, info = t && t.trackInfo && t.trackInfo(s.tr.id);
        if (info && info.psd) { const st = t.trackState(s.tr.id); v = st && st.psdOpen != null ? Math.max(0.5, Math.min(1, 0.5 + 0.5 * st.psdOpen)) : 1; }
      } catch (e) { v = 1; }
      s.psdV = v;
    }
    return s.psdV;
  }
  _say(item) { if (this.sys.announcer) this.sys.announcer.say(item); }
  _plat(tr) { return LAYOUT.spaces.find(x => x.id === tr.platform) || null; }
  _fx(s, name, gain, delay = 0, bus = 'sfx', at = null) {
    const buf = this.bank.peek(name);
    if (!buf) { this.bank.get(name, 2); return; }
    const em = this._ensureEms(s).fx;
    const when = this.ac.currentTime + delay;
    if (bus === 'voice' || at) this.mixer.play(buf, { bus, pos: at || em.pos || { x: 0, y: s.g.y, z: 0 }, gain: gain * (bus === 'voice' ? 1.2 : 1) * this._hears(s), send: 0.6, ref: 4, when, lp: this._hears(s) < 0.9 ? 500 : undefined });
    else em.oneShot(buf, { gain: gain * this._hears(s), when });
  }
  _key(e) { return e.trainId || (this.track(e) || {}).id; }

  // ---- events ---------------------------------------------------------------------
  onApproach(e) {
    const tr = this.track(e); if (!tr) return;
    this.prefetch();
    if (this.live) return; // kinematics come from ctx.transit.trains; voice from 'announce'
    const s = this.state(this._key(e), tr);
    const now = this.ac.currentTime;
    const eta = Math.max(6, Math.min(90, e.etaSec != null ? +e.etaSec : (+e.eta > 0 && +e.eta < 6 ? +e.eta * 10 : +e.eta || 30)));
    s.phase = 'approach'; s.tStop = now + eta - 2.5; s.vvvfAt = s.tStop - 12.5; s.squealAt = s.tStop - 3.1; s.airAt = s.tStop + 0.4;
    s.vvvfOn = s.squealOn = s.airOn = false; s.melodyDone = false;
    s.head = s.g.stop - s.g.dirIn * (V0 * TB / 2 + V0 * 10);
    this._ensureEms(s);
    if (!this._nearPlatform(tr)) return;
    if (tr.line !== 'nankai') {
      const mel = MEL[tr.line];
      const pg = this._pgTr(tr);
      if (mel) this.mixer.play(mel, { bus: 'voice', gain: 0.75 * pg, send: 0.9, wait: true, prio: 1 });
      const a = approach(tr);
      setTimeoutAudio(this.ac, 5.5, () => this._say({ kind: 'train', platform: this._plat(tr), parts: [{ lang: 'ja', text: a.ja }, { lang: 'en', text: a.en }] }));
    } else {
      const a = approach(tr);
      this._say({ kind: 'train', chime: 'pa', platform: this._plat(tr), parts: [{ lang: 'ja', text: a.ja }, { lang: 'en', text: a.en }] });
    }
  }
  onArrive(e) {
    const tr = this.track(e); if (!tr) return;
    const s = this.state(this._key(e), tr);
    const now = this.ac.currentTime;
    this._ensureEms(s);
    if (!this.live) {
      if (s.phase !== 'approach' || Math.abs(now - (s.tStop + 2.5)) > 6) this._fx(s, 'tr:air:0', 0.6);
      s.phase = 'stopped'; s.v = 0; s.head = s.g.stop;
    }
    if (e.initial) return; // train already standing when the game started
    // doors along the train (transit tells us where they are)
    const d = Array.isArray(e.doors) && e.doors.length ? this._nearestDoor(e.doors) : null;
    this._fx(s, 'tr:doors:open', 1.2, 0.1, 'sfx', d);
    if (tr.line !== 'nankai') this._fx(s, 'chime:door', 0.3, 0, 'voice', d);
    if (!this.live && this._nearPlatform(tr)) {
      const a = arrival(tr);
      setTimeoutAudio(this.ac, 1.5, () => this._say({ kind: 'station', platform: this._plat(tr), parts: [{ lang: 'ja', text: a.ja }, { lang: 'en', text: a.en }] }));
      const dwell = +e.dwell || 0;
      if (dwell > 14 && tr.line === 'nankai') setTimeoutAudio(this.ac, dwell - 12, () => this._melody(s));
    }
  }
  _nearestDoor(doors) {
    const L = this.sys.L; let best = doors[0], bd = 1e9;
    if (L) for (const d of doors) { const dd = Math.hypot(d.x - L.x, d.z - L.z); if (dd < bd) { bd = dd; best = d; } }
    return { x: best.x, y: (LEVELS[best.level] ? LEVELS[best.level].y : 0) + 1.2, z: best.z };
  }
  _melody(s) {
    if (s.melodyDone || !this._nearPlatform(s.tr)) return;
    s.melodyDone = true;
    this.mixer.play(s.tr.no % 2 ? 'mel:nankaiA' : 'mel:nankaiB', { bus: 'voice', gain: 0.8 * this._hears(s), send: 0.7, wait: true, prio: 1 });
    if (!this.live) { const d = departure(s.tr); this._say({ kind: 'train', platform: this._plat(s.tr), delay: 5, parts: [{ lang: 'ja', text: d.ja }, { lang: 'en', text: d.en }] }); }
  }
  onClosing(e) {
    const tr = this.track(e); if (!tr) return;
    const s = this.state(this._key(e), tr);
    this._ensureEms(s);
    s.closed = this.ac.currentTime;
    this._fx(s, 'tr:doors:close', 1.2, 0.2);
    this._fx(s, 'tr:air:0', 0.3, 2.0);
    if (!this.live && this._nearPlatform(tr)) {
      this._fx(s, 'chime:door', 0.4, 0, 'voice');
      const d = doorsClosing();
      this._say({ kind: 'station', platform: this._plat(tr), parts: [{ lang: 'ja', text: d.ja }, { lang: 'en', text: d.en }] });
    }
  }
  onDepart(e) {
    const tr = this.track(e); if (!tr) return;
    const s = this.state(this._key(e), tr);
    this._ensureEms(s);
    if (!s.closed || this.ac.currentTime - s.closed > 30) this._fx(s, 'tr:doors:close', 1.0, 0); // no closing event seen
    s.closed = 0;
    if (this.live) return; // live kinematics pick up 'departing'
    if (tr.line === 'nankai' && !s.melodyDone) this._melody(s);
    s.phase = 'closing'; s.head = s.g.stop; s.v = 0;
    s.tMove = this.ac.currentTime + (e.moveIn != null ? +e.moveIn : 0.3);
  }
  onAnnounce(e) {
    if (!e || !this.sys.announcer) return;
    const ja = firstSentences(e.textJa || e.ja, 'ja', 2), en = firstSentences(e.textEn || e.text, 'en', 2);
    const parts = [];
    if (ja) parts.push({ lang: 'ja', text: ja });
    if (en) parts.push({ lang: 'en', text: en });
    if (!parts.length) return;
    const L = this.sys.L; if (!L) return;
    // where is this PA audible? train lines belong to their platform: loud on it, faint on the concourse above, silent elsewhere
    const plat = platformOf(e);
    let pg = 1, gate = {};
    if (plat) { pg = platformGain(plat, L); gate = { platform: plat }; }
    else {
      const p = e.position || (e.x != null ? { x: e.x, y: e.y, z: e.z } : null);
      if (p) { gate = { pos: p, ref: 12, sameLevel: true }; pg = Math.min(1, 12 / Math.max(1, Math.hypot((p.x ?? L.x) - L.x, (p.z ?? L.z) - L.z))); }
    }
    if (pg < 0.06) return;
    const tr = this.track(e);
    // sound hints → melodies / chimes (scaled by how audible the platform is)
    let chime = 'pa';
    const snd = e.sound || '';
    if (snd === 'metro_approach') { chime = null; const mel = MEL[e.line]; if (mel) this.mixer.play(mel, { bus: 'voice', gain: 0.8 * pg, send: 0.9, wait: true, prio: 1 }); }
    else if (snd === 'metro_arrive') chime = null;
    else if (snd === 'metro_door_chime') { chime = null; if (tr) { const s = this.state(e.trainId || tr.id, tr); this._fx(s, 'chime:door', 0.45, 0, 'voice'); } }
    else if (snd === 'nankai_melody') { chime = null; if (tr) { const s = this.state(e.trainId || tr.id, tr); s.melodyDone = false; this._melodyOnly(s); } }
    const kind = e.kind === 'approach' || e.kind === 'depart' ? 'train' : e.kind === 'ambient' ? 'ambient' : 'station';
    // the HUD already subtitles 'announce' events → no caption from us
    this._say(Object.assign({ kind, chime, parts, gain: 1, caption: false, group: `${e.trainId || e.track}:${e.kind}`, delay: snd === 'metro_approach' ? 4.5 : snd === 'nankai_melody' ? 6 : 0 }, gate));
  }
  // the Nankai departure melody without the (fallback) spoken line: transit's own 'announce' speaks it
  _melodyOnly(s) {
    if (s.melodyDone || !this._nearPlatform(s.tr)) return;
    s.melodyDone = true;
    this.mixer.play(s.tr.no % 2 ? 'mel:nankaiA' : 'mel:nankaiB', { bus: 'voice', gain: 0.8 * this._hears(s), send: 0.7, wait: true, prio: 1 });
  }

  // ---- per frame --------------------------------------------------------------------
  update(dt) {
    const L = this.sys.L; if (!L) return;
    const now = this.ac.currentTime;
    if (this.live) this._syncLive(now); else this._fallbackKinematics(now);
    for (const [key, s] of this.trains) {
      if (!s.ems) { if (s.phase === 'gone' || (this.live && now - s.seen > 5)) this.trains.delete(key); continue; }
      this._render(s, L, dt, now);
    }
  }
  _syncLive(now) {
    const list = this.ctx.transit.trains;
    for (const t of list) {
      const key = t.id || t.track;
      const tr = this.track({ track: t.track, line: t.line, trackNo: t.trackNo, platform: t.platform });
      if (!tr) continue;
      const s = this.state(key, tr);
      s.seen = now;
      const prev = s.phase;
      s.phase = t.state || 'stopped';
      s.v = Math.abs(+t.speed || 0);
      if (t.front != null) s.head = t.front;
      if (t.cars) s.g.len = Math.min(s.g.len + 60, t.cars * s.g.carLen);
      // only make noise for trains within earshot of the listener's track area
      const dAlong = this._distToTrain(s, this.sys.L);
      if (!s.ems && dAlong > 260) continue;
      this._ensureEms(s);
      if (s.phase === 'arriving' && prev !== 'arriving' && !s.vvvfOn) {
        // regenerative braking: align the falling whine so it reaches zero at the stop
        s.vvvfOn = true;
        const b = this.bank.peek('tr:vvvf:decel:0');
        const vmax = Math.max(s.v, 1);
        if (b) s.ems.motor.oneShot(b, { gain: 0.9, offset: Math.max(0, 12.5 * (1 - Math.min(1, vmax / 16.7))) });
      }
      if (s.phase === 'arriving' && s.v < 4.5 && !s.squealOn) { s.squealOn = true; this._fx(s, 'tr:squeal:0', 0.5); }
      if ((s.phase === 'stopped' || s.phase === 'doors') && prev === 'arriving' && !s.airOn) { s.airOn = true; this._fx(s, 'tr:air:0', 0.8); }
      if (s.phase === 'departing' && prev !== 'departing') {
        s.vvvfOn = s.squealOn = s.airOn = false;
        const b = this.bank.peek('tr:vvvf:accel:0');
        if (b) s.ems.motor.oneShot(b, { gain: 0.95 });
      }
      if (s.phase === 'approach' && prev !== 'approach') { s.vvvfOn = s.squealOn = s.airOn = false; }
    }
    // trains that vanished from the list (gone out of the tunnel)
    for (const s of this.trains.values()) if (s.ems && now - s.seen > 1.5) s.phase = 'gone';
  }
  _distToTrain(s, L) {
    const g = s.g;
    const tail = s.head - g.dirIn * g.len;
    const a0 = Math.min(s.head, tail), a1 = Math.max(s.head, tail);
    const la = g.ax === 'z' ? L.z : L.x, lc = g.ax === 'z' ? L.x : L.z;
    const da = la < a0 ? a0 - la : la > a1 ? la - a1 : 0;
    return Math.hypot(da, lc - g.c);
  }
  _fallbackKinematics(now) {
    for (const s of this.trains.values()) {
      const g = s.g;
      if (s.phase === 'approach') {
        const tb0 = s.tStop - TB;
        if (now < tb0) { s.v = V0; s.head = g.stop - g.dirIn * (V0 * TB / 2 + V0 * (tb0 - now)); }
        else if (now < s.tStop) { const tt = s.tStop - now; s.v = V0 * tt / TB; s.head = g.stop - g.dirIn * (V0 / (2 * TB)) * tt * tt; }
        else { s.v = 0; s.head = g.stop; }
        if (!s.vvvfOn && now >= s.vvvfAt) { s.vvvfOn = true; const b = this.bank.peek('tr:vvvf:decel:0'); if (b) this._ensureEms(s).motor.oneShot(b, { gain: 0.9, when: s.vvvfAt }); }
        if (!s.squealOn && now >= s.squealAt) { s.squealOn = true; this._fx(s, 'tr:squeal:0', 0.5); }
        if (!s.airOn && now >= s.airAt) { s.airOn = true; this._fx(s, 'tr:air:0', 0.8); }
      } else if (s.phase === 'closing' && now >= s.tMove) {
        s.phase = 'departing'; s.tLeave = now; s.vvvfOn = false;
        const b = this.bank.peek('tr:vvvf:accel:0');
        if (b) this._ensureEms(s).motor.oneShot(b, { gain: 0.95 });
      } else if (s.phase === 'departing') {
        const t = now - s.tLeave, vmax = V0 * 1.2, ta = vmax / 0.95;
        s.v = Math.min(vmax, 0.95 * t);
        s.head = g.stop + g.dirOut * (0.5 * 0.95 * Math.min(t, ta) ** 2 + (t > ta ? vmax * (t - ta) : 0));
        if (t > 40) s.phase = 'gone';
      }
    }
  }
  _render(s, L, dt, now) {
    const g = s.g;
    // nearest point on the train body to the listener (cars trail the head against the arrival direction)
    const tail = s.head - (this.live || s.phase !== 'departing' ? g.dirIn : g.dirOut) * g.len;
    const a0 = Math.min(s.head, tail), a1 = Math.max(s.head, tail);
    const la = g.ax === 'z' ? L.z : L.x;
    const along = Math.max(a0, Math.min(a1, la));
    const pos = g.ax === 'z' ? { x: g.c, y: g.y, z: along } : { x: along, y: g.y, z: g.c };
    const hear = this._hears(s);
    for (const k of ['roll', 'motor', 'fx']) s.ems[k].setPos(pos.x, pos.y, pos.z);
    const sp = Math.min(1.3, s.v / V0);
    // in the tunnel (beyond the platform ends) the train is a dark rumble; it brightens as it bursts in
    const dist = Math.hypot(pos.x - L.x, pos.z - L.z);
    const inTunnel = (a1 < g.lo - 3 || a0 > g.hi + 3) && !g.terminal ? 1 : 0;
    const open = Math.max(0, Math.min(1, 1 - (dist - 12) / 90)) * (inTunnel ? 0.45 : 1);
    // explicit level: distance law x where you stand (platform / elsewhere on the level) x platform screen
    // doors (closed doors mute a train that is still in the tunnel) x the tunnel itself
    const d3 = Math.max(1, Math.hypot(dist, pos.y - (L.y + 1.6)));
    const dl = 1 / (1 + Math.pow(d3 / 16, 1.4));
    const psd0 = this._psd(s, now), tun = inTunnel ? 0.6 : 1;
    const psd = 1 - (1 - psd0) * (inTunnel ? 1 : 0.4); // the glass only really hides a train that is still in the tunnel
    const lvl = dl * psd * tun * hear;   // hear = platform zone gate (zones.js): loud on the platform, faint above it, 0 elsewhere
    const muffled = hear < 0.9, lpK = (0.3 + 0.7 * hear) * (0.45 + 0.55 * psd);
    if (sp > 0.01 && !s.ems.roll.src) { const b = this.bank.peek('tr:roll'); if (b) s.ems.roll.setLoop(b); }
    s.ems.roll.fade(2.6 * Math.pow(sp, 1.1) * lvl, 0.25);
    s.ems.roll.setRate(0.65 + 0.45 * sp, 0.25);
    s.ems.roll.setLP(Math.max(120, (muffled ? 250 : 220 + 3200 * sp * open) * (0.35 + 0.65 * lpK)), 0.2);
    s.ems.motor.setLP(Math.max(250, (muffled ? 400 : 700 + 5300 * open) * (0.3 + 0.7 * lpK)), 0.3);
    s.ems.motor.fade(lvl, 0.3);
    s.ems.fx.setLP(muffled ? 500 + 3000 * lpK : 18000, 0.3);
    s.ems.fx.fade(lvl, 0.3);
    // tunnel wind push ahead of an arriving subway train
    if (!g.terminal) {
      const mouth = g.dirIn > 0 ? g.lo : g.hi;
      const wp = g.ax === 'z' ? { x: g.c, y: g.y + 1, z: mouth } : { x: mouth, y: g.y + 1, z: g.c };
      s.ems.wind.setPos(wp.x, wp.y, wp.z);
      let wg = 0;
      const arriving = s.phase === 'approach' || s.phase === 'arriving';
      if (arriving) { const out = g.dirIn > 0 ? mouth - s.head : s.head - mouth; wg = out > 0 ? Math.max(0, 1 - out / 220) : Math.max(0, 1 + out / 60); }
      if (s.phase === 'departing') { const out = g.dirOut > 0 ? tail - g.hi : g.lo - tail; wg = out > -40 && out < 120 ? 0.5 : 0; }
      if (wg > 0 && !s.ems.wind.src) { const b = this.bank.peek('bed:tunnel'); if (b) s.ems.wind.setLoop(b); }
      s.ems.wind.fade(wg * 0.75 * hear * (0.5 + 0.5 * psd), 1.2);
      s.ems.wind.setLP(160 + wg * 700, 1);
    }
    // rail joints (ta-tan) as bogies pass the listener's projection
    if (sp > 0.15 && la > a0 - 20 && la < a1 + 20) {
      s.jointT = (s.jointT || 0) - dt * s.v / (g.carLen / 2);
      if (s.jointT <= 0) { s.jointT = 1; const b = this.bank.peek('tr:joint:0'); if (b) s.ems.roll.oneShot(b, { gain: (g.terminal ? 0.5 : 0.25) * sp, rate: 0.9 + sp * 0.2 }); }
    }
    if (s.phase === 'gone') { for (const k in s.ems) s.ems[k].dispose(0.5); s.ems = null; s.vvvfOn = s.squealOn = s.airOn = false; }
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
