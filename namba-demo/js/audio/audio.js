// =============================================================================
// NAMBA sound system. Everything is synthesized (no asset files): see
// js/audio/*.js and notes/sound.md.
//
// Public API (ctx.audio) — all methods are safe no-ops with ?noaudio or before
// the AudioContext exists:
//   resume()                      start/resume audio (call from a user gesture)
//   setVolume(bus, v) / setVolume(v)   bus ∈ master|music|sfx|voice|ambience, v 0..1
//   getVolume(bus)
//   play(name, opts)              UI / foley one-shots, see SOUNDS below.
//                                 opts: { gain, rate, pos:{x,y?,z,level?}, pan }
//   say({ ja, en, kind, pos })    a PA-style line: chime, then the browser's ja-JP voice (Japanese ONLY, never English TTS;
//                                 no ja-JP voice: chime + caption only). Volume follows where you stand (zones.js).
//   debug()                       zone / bed gains / last PA text+voice (for tests)
//   paVolume(payload)             0..1: how audible an 'announce' payload is from here (HUD captions use it)
//   setMuted(bool), stats(), debugText()
//   useSpeech (bool)              allow SpeechSynthesis voices (default true; false = chime + caption only)
// Events consumed: player:step/land/bump, phone:open/close, phone:message,
//   ic:tap, discover, game:pause/resume, settings:change, train:*, announce.
// Events emitted: 'caption' { text, en, ja, kind, speaker, duration, distant, channel: 'ambient'|'speech' }
// =============================================================================
import { params } from '../core/params.js?v=454ed73';
import { LAYOUT, LEVELS, rampLocal, rampEnds } from '../world/layout.js?v=454ed73';
import { Bank } from './bank.js?v=454ed73';
import { Mixer } from './mixer.js?v=454ed73';
import { acousticFor } from './ir.js?v=454ed73';
import { Announcer } from './announcer.js?v=454ed73';
import { Ambience, moodOf } from './ambience.js?v=454ed73';
import { AREA, platformGain, platformOf, pointGain } from './zones.js?v=454ed73';
import { EXCUSE } from './phrases.js?v=454ed73';
import { Sources } from './sources.js?v=454ed73';
import { Trains, pumpAudioTimers } from './trains.js?v=454ed73';

// name → [recipe, default gain, bus, extra]
export const SOUNDS = {
  gate_ok: ['ui:gate_ok', 0.55, 'ui'], gate_fail: ['ui:gate_fail', 0.6, 'ui'], gate_ng: ['ui:gate_fail', 0.6, 'ui'], gate_low: ['ui:gate_low', 0.55, 'ui'],
  phone_open: ['ui:phone_open', 0.5, 'ui'], phone_close: ['ui:phone_close', 0.5, 'ui'], ui_open: ['ui:phone_open', 0.5, 'ui'], ui_close: ['ui:phone_close', 0.5, 'ui'],
  ui_select: ['ui:select', 0.4, 'ui'], notify: ['ui:notify', 0.55, 'ui'], phone_buzz: ['ui:notify', 0.55, 'ui'],
  order: ['ui:order', 0.6, 'sfx'], pay: ['ui:pay', 0.55, 'sfx'], charge: ['ui:pay', 0.55, 'sfx'], cup: ['ui:cup', 0.6, 'sfx'], coffee: ['ui:cup', 0.6, 'sfx'],
  door_chime: ['chime:conbini', 0.5, 'sfx'], bell: ['ui:bell', 0.5, 'sfx'], discover: ['chime:discover', 0.45, 'ui'],
  tempura: ['loop:tempura', 0.5, 'sfx', { duration: 3.5 }], train_doors: ['tr:doors:open', 0.6, 'sfx'], train_depart: ['chime:door', 0.5, 'voice'],
  gacha: ['fx:gacha', 0.6, 'sfx'], grinder: ['fx:grinder', 0.5, 'sfx'], steam: ['fx:steam', 0.5, 'sfx'], rustle: ['ui:rustle', 0.4, 'sfx'],
  pa_chime: ['chime:pa', 0.5, 'voice'],
};
const CALLOUT = ['いらっしゃいませ', 'いらっしゃいませ、どうぞ', 'いらっしゃいませ、こんにちは'];
const STEP_N = 8; // footstep variants per surface
const SURF = { tile: 'tile', stone: 'stone', wood: 'wood', metal: 'metal', paving: 'paving', grass: 'grass', carpet: 'soft', gravel: 'gravel', soft: 'soft' };

export class Audio {
  constructor(ctx) {
    this.ctx = ctx;
    this.enabled = !params.noaudio && typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext);
    this.ac = null; this.mixer = null; this.bank = null;
    // the PA and every spoken line use the browser's real voices (speechSynthesis, ja-JP then en-*); setting 'speech'
    // = false leaves chime + caption only
    this.useSpeech = true; this.allowSpeech = true;
    this._lastTap = { t: -9, x: 0, z: 0 }; this._gateRecent = []; this._barkT = {}; this._lastPlay = {};
    this.L = null;
    this.muted = false;
    this._vols = this._loadVolumes();
    this.crossings = [
      // Sennichimae-dori (walk N-S across it): "kakkō"; Midosuji (walk E-W): "piyo"
      { x: -57, z: -202, kind: 'kakko', phase: 0 }, { x: 43, z: -202, kind: 'kakko', phase: 23 }, { x: 143, z: -202, kind: 'kakko', phase: 41 },
      { x: -70, z: -201, kind: 'kakko', phase: 11 }, { x: -103, z: -192, kind: 'piyo', phase: 35 },
    ];
    this._stepI = 0;
  }

  init() {
    if (!this.enabled) return;
    const kick = () => { this.resume(); if (this.announcer) this.announcer.unlock(); };
    this._gestures = ['pointerdown', 'keydown', 'touchend', 'click'];
    this._kick = kick;
    for (const g of this._gestures) addEventListener(g, kick, { capture: true, passive: true });
    const ev = this.ctx.events;
    ev.on('player:step', (e) => this._step(e));
    ev.on('player:land', (e) => this._land(e));
    ev.on('player:bump', (e) => this._bump(e));
    ev.on('crowd:excuse', (e) => this._bark(e, 'excuse'));
    ev.on('crowd:callout', (e) => this._bark(e, 'callout'));
    ev.on('gate:pass', (e) => this._gatePass(e));
    ev.on('crowd:gate', (e) => { if (!(this.ctx.transit && typeof this.ctx.transit.gatePass === 'function')) this._gatePass(e); });
    ev.on('player:zone', (e) => this._zoneChange(e));
    ev.on('phone:open', () => this.play('phone_open'));
    ev.on('phone:close', () => this.play('phone_close'));
    ev.on('phone:message', () => this.play('notify'));
    ev.on('ic:tap', (e) => { this._lastTap = { t: this.ac ? this.ac.currentTime : 0, x: e && e.x, z: e && e.z }; this.play(!e || e.ok === false ? 'gate_fail' : (e.balance != null && e.balance < 300 ? 'gate_low' : 'gate_ok'), e && e.x != null ? { pos: { x: e.x, z: e.z, level: e.level } } : {}); });
    ev.on('discover', () => this.play('discover'));
    ev.on('game:pause', () => this._pause(true));
    ev.on('game:resume', () => this._pause(false));
    ev.on('settings:change', (e) => {
      if (!e) return;
      if (e.key === 'volume') this.setVolume('master', e.value);
      else if (['music', 'sfx', 'voice', 'ambience', 'master'].includes(e.key)) this.setVolume(e.key, e.value);
      else if (e.key === 'speech') { this.useSpeech = !!e.value; if (!e.value && this.announcer) this.announcer.cancelSpeech(); }
    });
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => {
      if (!this.ac || this.ac.state === 'closed') return;
      if (document.hidden) { this.announcer && this.announcer.cancelSpeech(); this.ac.suspend().catch(() => {}); } else if (this._wantRunning) this.ac.resume().catch(() => {});
    });
    // the settings volume, if the game exposes one
    const s = this.ctx.settings;
    if (s && typeof s.volume === 'number') this._vols.master = s.volume;
  }
  onStart() {
    // headless test harness runs with autoplay allowed: build immediately so errors surface
    if (this.enabled && (params.test || (navigator.userActivation && navigator.userActivation.hasBeenActive))) this.resume();
  }

  // ---- lifecycle ------------------------------------------------------------------
  resume() {
    if (!this.enabled) return Promise.resolve(false);
    try {
      if (!this.ac) this._build(new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' }));
      this._wantRunning = true;
      if (this.announcer && navigator.userActivation && navigator.userActivation.isActive) this.announcer.unlock();
      if (this._gestures) { for (const g of this._gestures) removeEventListener(g, this._kick, { capture: true }); this._gestures = null; }
      if (this.ac.state !== 'running') return this.ac.resume().then(() => true).catch(() => false);
    } catch (e) { console.warn('[audio] cannot start', e.message); this.enabled = false; return Promise.resolve(false); }
    return Promise.resolve(true);
  }
  // build the graph on an (Offline)AudioContext — also used by tests
  _build(ac, { worker = true } = {}) {
    this.ac = ac;
    this.bank = new Bank(ac, { useWorker: worker });
    this.mixer = new Mixer(ac, this.bank);
    this.mixer.hrtf = !(this.ctx.engine && this.ctx.engine.qualityName === 'low');
    for (const [k, v] of Object.entries(this._vols)) this.mixer.setVolume(k, v);
    this.announcer = new Announcer(this);
    this.announcer.useSpeech = this.useSpeech;
    this.ambience = new Ambience(this);
    this.sources = new Sources(this);
    this.trains = new Trains(this);
    let biz = (this.ctx.shops && (this.ctx.shops.businesses || this.ctx.shops.BUSINESSES)) || null;
    if (biz) this.sources.build(biz);
    else import('../world/directory.js?v=454ed73').then((m) => this.sources.build(m.BUSINESSES)).catch((e) => { console.warn('[audio] no directory', e.message); this.sources.build([]); });
    // what you hear in the first seconds: render first
    this.bank.want(['ui:gate_ok', 'ui:phone_open', 'ui:phone_close', 'ui:notify', 'chime:pa'], 6);
    this._prefetchSteps('tile'); this._prefetchSteps('stone');
    this._lastAcoustic = null;
    this.update(0);
  }
  _prefetchSteps(surface) {
    const s = SURF[surface] || 'tile';
    const names = []; for (let i = 0; i < STEP_N; i++) names.push(`fs:${s}:sneaker:${i}`);
    this.bank.want(names, 0);
  }

  // ---- per-frame --------------------------------------------------------------------
  update(dt) {
    if (!this.mixer || !this.ctx.player) return;
    const L = this._listenerState();
    this.L = L;
    // listener = camera
    const cam = this.ctx.camera || (this.ctx.engine && this.ctx.engine.camera);
    if (cam) {
      cam.updateMatrixWorld();
      const e = cam.matrixWorld.elements;
      this.mixer.setListener(e[12], e[13], e[14], -e[8], -e[9], -e[10], e[4], e[5], e[6]);
    } else this.mixer.setListener(L.x, L.y + 1.6, L.z, 0, 0, -1);
    // acoustics: the space you're in
    const key = L.acoustic;
    if (key !== this._lastAcoustic) { this._lastAcoustic = key; this.mixer.setAcoustic(key); }
    // steps: preload the surface you're about to walk on
    if (L.stepSurface !== this._lastSurf) { this._lastSurf = L.stepSurface; this._prefetchSteps(L.stepSurface); }
    this.announcer.useSpeech = this.useSpeech;
    // HRTF convolution is the costliest panner: only above 'low' quality (quality can change at runtime)
    const q = this.ctx.engine && this.ctx.engine.qualityName;
    if (q !== this._q) { this._q = q; this.mixer.hrtf = q !== 'low'; }
    try { this.ambience.update(dt, L); } catch (e) { this._err('ambience', e); }
    try { this.sources.update(dt, L); } catch (e) { this._err('sources', e); }
    try { this.trains.update(dt); } catch (e) { this._err('trains', e); }
    try { this.announcer.update(dt); } catch (e) { this._err('announcer', e); }
    pumpAudioTimers();
  }
  _err(where, e) { if (!this['_e_' + where]) { this['_e_' + where] = true; console.error(`[audio.${where}]`, e); (this.ctx.errors || []).push(`audio.${where}: ${e.message}`); } }

  _listenerState() {
    const p = this.ctx.player, b = p.body, world = this.ctx.world;
    // locate the body ourselves (cheap grid lookup): player.space lags a frame behind teleports
    let loc = null; try { loc = world && world.locate ? world.locate(b) : null; } catch (e) { loc = null; }
    const space = loc ? loc.space : p.space, zone = loc && loc.zone ? loc.zone : p.zone;
    const L = { level: b.level, x: b.x, y: b.y != null ? b.y : LEVELS[b.level].y, z: b.z, zone, space, ramp: null, rampBlend: null };
    if (b.ramp >= 0) {
      const r = LAYOUT.ramps[b.ramp];
      L.ramp = r;
      const { s } = rampLocal(r, b.x, b.z);
      const ends = rampEnds(r);
      const at = (lv, e) => world ? world.spaceAt(lv, e.x + e.dx * 1.5, e.z + e.dz * 1.5) : null;
      const sl = at(r.lower, ends.low), sh = at(r.upper, ends.high);
      const ml = moodOf(sl ? sl.zone : r.zone, sl, null), mh = moodOf(sh ? sh.zone : r.zone, sh, null);
      const k = Math.max(0, Math.min(1, s));
      L.rampBlend = ml === mh ? [[ml, 1]] : [[ml, 1 - k], [mh, k]];
      const sp = k < 0.5 ? sl : sh;
      L.acoustic = acousticFor(sp, sp ? sp.zone : r.zone, null);
      if (r.kind === 'stairs' && sp && !sp.outdoor && (k > 0.2 && k < 0.8)) L.acoustic = 'passage';
      L.stepSurface = r.kind === 'escalator' ? 'metal' : (sp && sp.outdoor ? 'paving' : 'stone');
    } else {
      L.acoustic = acousticFor(space, zone, null);
      L.stepSurface = surfaceGuess(space);
    }
    L.outdoorish = !!(space && space.outdoor);
    return L;
  }

  // ---- footsteps -------------------------------------------------------------------
  _step(e) {
    if (!this.mixer || !e) return;
    const surf = SURF[e.surface] || SURF[this.L && this.L.stepSurface] || 'tile';
    // pick a variant, never the same twice in a row
    let i = Math.floor(Math.random() * STEP_N);
    if (i === this._stepI) i = (i + 1) % STEP_N;
    this._stepI = i;
    const name = `fs:${surf}:sneaker:${i}`;
    const inten = e.intensity != null ? e.intensity : Math.min(1.5, (e.speed || 1.4) / 1.5);
    // v3: -6 dB (0.8 -> 0.4). Hard floors keep +1 dB of that so they stay clearly audible; soft ones sit lower.
    const hard = surf === 'tile' || surf === 'stone' || surf === 'metal' || surf === 'wood';
    const g = (hard ? 0.45 : 0.38) * (0.45 + 0.5 * inten) * (e.final ? 0.6 : 1) * (0.88 + Math.random() * 0.24);
    const L = this.L;
    const outdoor = L && L.outdoorish;
    // polished floors: the occasional rubber squeak, likelier on turns
    if ((surf === 'tile' || surf === 'stone') && this.L) {
      const cam = this.ctx.camera || (this.ctx.engine && this.ctx.engine.camera);
      let yaw = this._yaw0 || 0;
      if (cam && cam.matrixWorld) { const m = cam.matrixWorld.elements; yaw = Math.atan2(-m[8], -m[10]); }
      let dy = Math.abs(yaw - (this._yaw0 ?? yaw)); if (dy > Math.PI) dy = 2 * Math.PI - dy;
      this._yaw0 = yaw;
      if (this._rnd() < (dy > 0.25 ? 0.45 : 0.04)) this.mixer.play(`fs:squeak:${Math.floor(this._rnd() * 6)}`, { bus: 'sfx', gain: 0.12 + 0.07 * this._rnd(), rate: 0.9 + this._rnd() * 0.3, pan: (e.foot ? 0.1 : -0.1), send: 0.3, when: this.ac.currentTime + 0.03 + this._rnd() * 0.04, prio: 3 });
    }
    this.mixer.play(name, { bus: 'sfx', gain: g, rate: 0.95 + Math.random() * 0.1 - (inten > 1.1 ? 0.03 : 0), pan: (e.foot ? 0.07 : -0.07), send: outdoor ? 0.12 : 0.32, prio: 0, lp: surf === 'soft' ? 3500 : undefined });
  }
  _land(e) {
    if (!this.mixer || !e) return;
    // stepping off an escalator comb plate / last stair
    const metal = e.ramp && e.ramp.kind === 'escalator';
    const surf = metal ? 'metal' : SURF[e.surface] || 'stone';
    this.mixer.play(`fs:${surf}:sneaker:${Math.floor(Math.random() * STEP_N)}`, { bus: 'sfx', gain: 0.24, rate: 0.92, send: 0.3 });   // v3: -6 dB with the footsteps
  }
  _bump(e) {
    if (!this.mixer || !e) return;
    const sp = Math.min(1.5, e.speed || 0.5);
    if (e.kind === 'person') this.mixer.play('ui:rustle', { bus: 'sfx', gain: 0.25 + 0.2 * sp, pan: (Math.random() - 0.5) * 0.6, send: 0.2 });
    else this.mixer.play(`fs:soft:sneaker:${Math.floor(Math.random() * STEP_N)}`, { bus: 'sfx', gain: 0.25 * sp, rate: 0.7, send: 0.25 });
  }
  // ---- crowd voices: "sumimasen" when someone needs you to move, shop staff "irasshaimase" ----------------
  // short, real phrases in a real voice (queued behind the PA, volume by distance); the caption carries them too
  _bark(e, kind) {
    if (!this.mixer || !e || this.muted || !this.announcer) return;
    const L = this.L, now = this.ac.currentTime;
    if (!L || e.level !== L.level) return;
    const d = Math.hypot(e.x - L.x, e.z - L.z);
    const maxD = kind === 'excuse' ? 6 : 10;
    if (d > maxD) return;
    if (now - (this._barkT[kind] || -9) < (kind === 'excuse' ? 2.5 : 6)) return;
    this._barkT[kind] = now;
    const txt = kind === 'excuse' ? EXCUSE[Math.floor(this._rnd() * EXCUSE.length)] : CALLOUT[Math.floor(this._rnd() * CALLOUT.length)];
    const y = e.y != null ? e.y : (LEVELS[e.level] ? LEVELS[e.level].y + 1.55 : L.y + 1.5);
    let gain = kind === 'excuse' ? 0.8 : 0.5;
    if (this.ctx.world) { try { if (!this.ctx.world.visible(L.level, L.x, L.z, e.x, e.z)) gain *= 0.5; } catch (er) { /* */ } }
    this.announcer.say({ kind: 'crowd', parts: [{ lang: 'ja', text: txt }], pos: { x: e.x, y, z: e.z }, ref: kind === 'excuse' ? 1.8 : 3, gain, sameLevel: true, caption: false, maxAge: 1.2 });
    if (kind === 'excuse' && d < 3) this.ctx.events.emit('caption', { text: e.en || 'Excuse me', en: e.en || 'Excuse me', ja: e.ja || 'すみません', kind: 'say', speaker: 'Stranger', duration: 1.8, channel: 'speech' });
  }
  _rnd() { this._rs = ((this._rs || 987654321) * 1664525 + 1013904223) >>> 0; return this._rs / 4294967296; }

  // ---- NPC ticket-gate beeps: the constant pi… pi-pi… pi of a Japanese gate line --------------------------
  _gatePass(e) {
    if (!this.mixer || !e || this.muted || e.x == null) return;
    const L = this.L, now = this.ac.currentTime;
    if (!L || e.level !== L.level) return;
    const d = Math.hypot(e.x - L.x, e.z - L.z);
    if (d > 40) return;
    // the player's own tap is already voiced by ic:tap
    if (now - this._lastTap.t < 0.5 && Math.hypot(e.x - (this._lastTap.x ?? 1e9), e.z - (this._lastTap.z ?? 1e9)) < 3.5) return;
    const rec = this._gateRecent; while (rec.length && now - rec[0] > 0.6) rec.shift();
    if (rec.length >= 6) return; rec.push(now);
    this._gateN = (this._gateN || 0) + 1;
    const r = this._rnd();
    const name = e.ok === false || r < 0.01 ? 'gate_fail' : this._gateN % 25 === 0 ? 'gate_low' : 'gate_ok';
    this.play(name, { pos: { x: e.x, z: e.z, level: e.level, y: L.y + 1.0 }, gain: 0.55 * (0.8 + this._rnd() * 0.25), rate: 0.97 + this._rnd() * 0.06, ref: 2.5, send: 0.3 });
  }

  // ---- indoor <-> outdoor: the air opens up (wind gust + brighter, drier) ----------------------------------
  _zoneChange(e) {
    if (!this.mixer || !e) return;
    const L = this.L; if (!L) return;
    const out = !!L.outdoorish;
    if (out === !!this._wasOutdoor) return;
    this._wasOutdoor = out;
    const m = this.mixer, t = this.ac.currentTime;
    if (out) {
      // stepping out into the open: a gust of air, the room's reverb drops away and slowly returns
      this.mixer.play('bed:gust', { bus: 'ambience', gain: 0.55, send: 0.05, prio: 2, wait: true });
      const v = m.verbOut.gain; v.cancelScheduledValues(t); v.setValueAtTime(v.value, t); v.linearRampToValueAtTime(0.35, t + 0.8); v.linearRampToValueAtTime(1, t + 3.5);
    }
  }
  _pause(on) {
    if (!this.mixer) return;
    const t = this.ac.currentTime;
    this.mixer.master.gain.setTargetAtTime(on ? 0.35 * this._vols.master ** 2 : 0.9 * this._vols.master ** 2, t, 0.15);
    if (this.announcer) this.announcer.pauseSpeech(on);
  }

  // ---- public API --------------------------------------------------------------------
  play(name, opts = {}) {
    if (!this.mixer || this.muted) return null;
    const def = SOUNDS[name];
    const recipe = def ? def[0] : name; // allow raw recipe names too
    // two systems may ask for the same blip in the same frame (phone:message + phone_buzz): play it once
    const nowT = this.ac.currentTime, lp = this._lastPlay[recipe];
    if (lp != null && nowT - lp < 0.12 && !opts.pos) return null;
    this._lastPlay[recipe] = nowT;
    const o = { bus: def ? def[2] : 'sfx', gain: (def ? def[1] : 0.5) * (opts.gain ?? 1), rate: opts.rate, pan: opts.pan, send: opts.send ?? 0.25, prio: 0, ...(def && def[3] || {}) };
    if (opts.pos) {
      const y = opts.pos.y != null ? opts.pos.y : (opts.pos.level && LEVELS[opts.pos.level] ? LEVELS[opts.pos.level].y + 1.2 : (this.L ? this.L.y + 1.2 : 0));
      o.pos = { x: opts.pos.x, y, z: opts.pos.z }; o.ref = opts.ref ?? 2; o.hrtf = true;
    }
    if (!this.bank.peek(recipe)) { o.wait = true; } // first use: play as soon as it's ready
    return this.mixer.play(recipe, o);
  }
  say({ ja, en, kind = 'station', pos = null, gain = 0.8, chime = 'pa' } = {}) {
    if (!this.announcer) return null;
    const parts = []; if (ja) parts.push({ lang: 'ja', text: ja }); if (en) parts.push({ lang: 'en', text: en });
    return this.announcer.say({ kind, parts, pos, gain, chime, send: pos ? 0.4 : 0.9 });
  }
  // test hook: speak a platform line from the platform that is loudest where you stand (null when none is audible).
  // The same path as a real train announcement: chime + Japanese line, ambience ducked while it plays.
  testPA(ja = 'まもなく、一番線に、電車が参ります。危ないですから、黄色い線まで、お下がりください。', en = 'The train is now approaching. Please stand behind the yellow line.') {
    const L = this.L; if (!this.announcer || !L) return null;
    let best = null, bg = 0;
    for (const sp of LAYOUT.spaces) { if (sp.kind !== 'platform' || !sp.rect) continue; const g = platformGain(sp, L); if (g > bg) { bg = g; best = sp; } }
    if (!best) return null;
    this.announcer.say({ kind: 'train', platform: best, chime: 'pa', gain: 1, parts: [{ lang: 'ja', text: ja }, { lang: 'en', text: en }], group: 'testPA' });
    return { platform: best.id, gain: +bg.toFixed(2) };
  }
  // how audible an 'announce' payload is from where the player stands (0..1): train lines belong to their platform,
  // others are point speakers. The HUD can use this to caption only what is heard.
  paVolume(e) {
    const L = this.L; if (!L || !e) return 0;
    const plat = platformOf(e);
    if (plat) return platformGain(plat, L);
    const p = e.position || (e.x != null ? { x: e.x, y: e.y, z: e.z } : null);
    return p ? pointGain(p, L, 12, true) : 1;
  }
  // test / debug readout: the soundscape area you are in, bed gains, last PA line and the voice it used
  debug() {
    if (!this.mixer) return { state: this.enabled ? 'waiting-for-gesture' : 'disabled' };
    const L = this.L || {}, a = this.ambience, sp = L.space;
    const mood = a.mood;
    return {
      state: this.ac.state,
      zone: { level: L.level, zone: L.zone, space: sp ? sp.id : null, kind: sp ? sp.kind : null, mood, area: AREA[mood] || mood, y: L.y != null ? +L.y.toFixed(1) : null },
      ...a.debug(),
      acoustic: this.mixer.acoustic,
      pa: this.announcer.debug(),
      trains: [...this.trains.trains.values()].filter(t => t.ems).map(t => ({ id: t.tr.id, phase: t.phase, hear: +this.trains._hears(t).toFixed(2) })),
      sources: [...this.sources.live.keys()].length,
    };
  }
  setVolume(bus, v) {
    if (typeof bus === 'number') { v = bus; bus = 'master'; }
    this._vols[bus] = Math.max(0, Math.min(1, +v));
    try { localStorage.setItem('namba.audio.v1', JSON.stringify(this._vols)); } catch (e) { /* private mode */ }
    if (this.mixer) this.mixer.setVolume(bus, this._vols[bus]);
  }
  getVolume(bus = 'master') { return this._vols[bus] ?? 1; }
  setMuted(m) { this.muted = !!m; if (this.mixer) this.mixer.master.gain.setTargetAtTime(m ? 0 : 0.9 * this._vols.master ** 2, this.ac.currentTime, 0.05); }
  _loadVolumes() {
    const d = { master: 0.85, music: 0.8, sfx: 1, voice: 1, ambience: 0.9 };
    try { const s = JSON.parse(localStorage.getItem('namba.audio.v1') || 'null'); if (s) Object.assign(d, s); } catch (e) { /* */ }
    return d;
  }
  stats() {
    if (!this.mixer) return { state: this.enabled ? 'waiting-for-gesture' : 'disabled' };
    const a = this.ambience;
    return {
      state: this.ac.state, acoustic: this.mixer.acoustic, mood: a.mood, people: Math.round(a.people), cloudRate: +a.cloud.rate.toFixed(1),
      layers: Object.values(a.layers).filter(l => l.em).map(l => l.name), sources: [...this.sources.live.keys()], oneShots: this.mixer.liveOneShots,
      trains: [...this.trains.trains.values()].filter(t => t.ems).map(t => `${t.tr.id}:${t.phase}`),
      speech: this.announcer.hasJaVoice ? 'ja-JP voice' : 'chime + caption (no ja-JP voice; English is never spoken)', bank: { buffers: this.bank.cache.size, pending: this.bank.pending.size, ms: Math.round(this.bank.stats.ms), mb: +(this.bank.stats.bytes / 1048576).toFixed(1), errors: this.bank.stats.errors.length },
    };
  }
  debugText() { const s = this.stats(); return s.mood ? `audio ${s.state} ${s.acoustic}/${s.mood} ppl ${s.people} steps/s ${s.cloudRate} src ${s.sources.length} 1shot ${s.oneShots}` : `audio ${s.state}`; }
}

function surfaceGuess(space) {
  if (!space) return 'tile';
  if (space.surface) return space.surface;
  if (space.garden) return 'grass';
  const st = String(space.style || '');
  if (/deck|dining|restaurant/.test(st)) return 'wood';
  if (/bridge/.test(st)) return 'metal';
  if (space.outdoor) return 'paving';
  if (/terminal|depachika|department|court|plaza|parks/.test(st)) return 'stone';
  return 'tile';
}
