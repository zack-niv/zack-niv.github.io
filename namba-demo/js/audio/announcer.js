// =============================================================================
// Announcer: station PA, escalator / shop / restaurant voice lines.
//
// v20: every spoken line is a pre-recorded audio FILE played through Web Audio (clips.js ClipBank, assets/audio/voice, looked up
// by phrases.js voiceKey of the Japanese text). speechSynthesis is gone from the game on every device: on iPhone it silenced
// Web Audio and the page died a few minutes later. Lines are JAPANESE ONLY (v3 feedback: hearing the announcements in
// Japanese is enough); the English translation lives in the caption text only. A line whose recording is not in the manifest
// (or not loaded in time) is the chime + caption, as it always was without a voice.
//
// Every item carries *where it is audible* (platform zone / point speaker distance / plain gain, see zones.js) and the clip
// is played at that level, and keeps following it while it plays (walk away from a platform and its announcement fades). An
// item that is inaudible when its turn comes is dropped; queued items go stale (maxAge) rather than being spoken late.
//   * station speakers (item.platform / item.pa, kinds train / station / platform / escalator): band-limited like a PA horn
//     (280 Hz - 3.8 kHz) with a reverb send, so the line gets the tail of the space you stand in; only overheard (audible level
//     under PA_NEAR): muffled (1.5 kHz) and all reverb, like the speakers down the hall
//   * everything else (shop staff, a passer-by's "sumimasen"): the plain recording, placed left / right from item.pos
// One line at a time, ever: a single `cur` item walks chime -> ja -> en (en is caption only).
// =============================================================================
import { voiceKey } from './phrases.js?v=5442362';
import { platformGain, pointGain } from './zones.js?v=5442362';

const PRIO = { train: 0, station: 1, platform: 1, crowd: 2, escalator: 3, shop: 4, ambient: 5 };
const MAX_AGE = { train: 30, station: 20, platform: 20, crowd: 1.6, escalator: 10, shop: 4, ambient: 15 };
const MIN_VOL = 0.06;
// v7 (platform PA must be clearly heard): while a platform line plays, the beds sit this far down (scaled by how audible
// the platform is from where you stand, so the concourse above only dips a little). Attack ~0.3 s, release ~1 s.
// v11 (feedback 5): deeper (on top of the fixed -5/-6 dB bed trim in mixer.js), earlier (the duck starts DUCK_PRE s before the
// chime, and for delayed platform lines at the melody) and it lets go later (DUCK_HOLD after the speech ends, slow swell back).
// v20: the voice is a recording whose level is ours to set (it was speechSynthesis, capped at full volume, and iOS had its own
// gentler table), so one table serves every device and the beds can sit less deep under it: -9 dB, -9 dB, -5 dB.
const PA_DUCK = { ambience: 0.35, music: 0.35, sfx: 0.55 };
const PRE_DUCK_AMB = 0.35;                                    // ambience/music factor during a delayed line's melody / lead-in (sfx waits for the speech)
const DUCK_ATTACK = 0.09, DUCK_RELEASE = 0.45, DUCK_HOLD = 1.0;  // setTargetAtTime constants (s): ~0.3 s attack / ~1.4 s release; hold between lines
const DUCK_PRE = 0.45;                                        // s the duck leads the chime
const PLAT_CHIME = 0.85, CHIME = 0.55;                          // chime gain at full volume
// v20: voice level at audible level 1 (times min(1.2, vol)); the recordings are loudness-normalised, so these two numbers are the whole balance
const PA_VOICE = 1.0;          // station speakers. Measured through the same chain: active-speech RMS about 2 dB above the PA chime, peaks just under full scale (1.1 pushed peaks over it and into the master limiter)
const VOICE = 0.8;             // shop staff, a passer-by
const PA_NEAR = 0.35;          // audible level under which a station line is only overheard
const PA_HP = 280, PA_LP = 3800, FAR_LP = 1500;   // the PA horn band, and the muffled version for a line heard from afar
const LOAD_WAIT = 3.5;         // s a line waits for its recording to arrive (counted from the moment its step is reached) before it is skipped
const PA_KINDS = new Set(['train', 'station', 'platform', 'escalator']);

export class Announcer {
  constructor(sys) {
    this.sys = sys; this.mixer = sys.mixer; this.bank = sys.bank; this.ac = sys.mixer.ac; this.clips = sys.clips || null;
    this.queue = []; this.cur = null; this.seq = 0; this.t = 0;
    // ?nopa: no voice clips are requested or played at all, so every line takes the existing no-voice path (chime + caption)
    this.noPa = !!(sys.ctx && sys.ctx.params && sys.ctx.params.has && sys.ctx.params.has('nopa'));
    this.useSpeech = true;
    this.duck = 1;               // ambience/music duck factor now (1 = none)
    this.duckSfx = 1;
    this._relAt = null;          // time to let the duck go (held a moment between consecutive lines)
    this.last = null;            // debug: the last item that actually started
    this.log = [];               // debug: recent events
    this._repeat = new Map();    // text key -> time last spoken
    this._paused = false;
    this.st = { tried: 0, started: 0, ended: 0, missing: 0, late: 0, errors: [], lastErr: null };
  }
  _note(s) { this.log.push(`${this.t.toFixed(1)} ${s}`); if (this.log.length > 14) this.log.shift(); }
  _err(code) { code = String(code || 'unknown'); this.st.lastErr = code; if (!this.st.errors.includes(code) && this.st.errors.length < 8) this.st.errors.push(code); }
  _emit(s, code) { try { this.sys.ctx.events.emit('pa:speech', code ? { s, code } : { s }); } catch (e) { /* flight recorder only */ } }

  // recorded lines are on when speech is on, ?nopa is not set and the manifest lists voice (or is still on its way)
  _voiceOn() { return !!(this.useSpeech && !this.noPa && this.clips && this.clips.available); }
  get canSpeak() { return this._voiceOn(); }
  get hasJaVoice() { return this._voiceOn(); }
  get hasEnVoice() { return false; }
  // tab hidden / speech switched off: drop the line in flight (PA lines are of the moment, never resumed late)
  cancelSpeech() { if (this.cur && this.cur.clip) this._interrupt(); }
  // the pause menu drops the line in flight and holds the queue (it goes stale on its own)
  pauseSpeech(on) { this._paused = !!on; if (on && this.cur && this.cur.clip) this._interrupt(); }
  // v20: nothing to unlock any more (the recordings are plain Web Audio, resumed by audio.js on a gesture); kept for old callers
  get speechReady() { return true; }
  unlock() { return false; }

  // the recording key of a Japanese part, and which variant (voice) of it this utterance uses (picked once the manifest is in)
  _kOf(p) { if (p._k === undefined) p._k = voiceKey(p.say || p.text); return p._k; }
  _vari(p) {
    if (p._v === undefined) { const n = this.clips ? this.clips.variants(this._kOf(p)) : 0; if (n > 0) p._v = n > 1 ? Math.floor(Math.random() * n) : 0; }
    return p._v || 0;
  }

  // item: { kind, prio?, parts:[{lang:'ja'|'en', text, say?}], chime?: 'pa'|'esc'|null, gain?, caption?,
  //         platform?: platform space (zone-gated), pos?: {x,y,z} + ref? (point speaker), maxAge?, group?, cooldown? }
  // returns the id, or null when dropped (duplicate / inaudible right now)
  say(item) {
    item.prio = item.prio ?? PRIO[item.kind] ?? 3;
    item.id = ++this.seq;
    item.born = this.t + (item.delay || 0);
    item.maxAge = item.maxAge ?? MAX_AGE[item.kind] ?? 10;
    const key = item.parts.map(p => p.text).join('|');
    item._key = key;
    if ((this.cur && this.cur._key === key) || this.queue.some(q => q._key === key)) return null;
    if (item.group) { // a newer line of the same group replaces the old one that is still waiting
      this.queue = this.queue.filter(q => q.group !== item.group);
    }
    if (item.cooldown && this.t - (this._repeat.get(key) ?? -999) < item.cooldown) return null;
    if (this._vol(item) < MIN_VOL) { this._note(`drop(inaudible) ${item.kind} "${key.slice(0, 30)}"`); return null; }
    if (item.chime) this.bank.get('chime:' + item.chime, 2);
    // start fetching the recordings now: the chime, a `delay` and the queue give them time to arrive
    if (this._voiceOn()) for (const p of item.parts) if (p.lang === 'ja') this.clips.want(this._kOf(p), this._vari(p));
    if (item.delay > 0.5 && (item.platform || item.pa)) this._preDuck(item);   // the melody / lead-in already plays: get the beds out of its way
    if (this.cur && item.prio < this.cur.prio && item.prio <= 1) this._interrupt();
    this.queue.push(item);
    this.queue.sort((a, b) => a.prio - b.prio || a.id - b.id);
    while (this.queue.length > 5) this.queue.pop();
    return item.id;
  }
  busyWith(kind) { return (this.cur && this.cur.kind === kind) || this.queue.some(q => q.kind === kind); }
  cancelKind(kind) { this.queue = this.queue.filter(q => q.kind !== kind); if (this.cur && this.cur.kind === kind) this._interrupt(); }

  // how loud this item is from where the player stands now (0..1+)
  _vol(item) {
    const L = this.sys.L; if (!L) return 0;
    let g = item.gain ?? 1;
    if (item.platform) g *= platformGain(item.platform, L);
    else if (item.pos) g *= pointGain(item.pos, L, item.ref ?? 2.5, item.sameLevel);
    return Number.isFinite(g) ? g : 0;
  }
  // a station speaker (band-limited horn, reverb) rather than a person in the room
  _isPA(item) { return !!(item.platform || item.pa || PA_KINDS.has(item.kind)); }

  _interrupt() {
    const c = this.cur; if (!c) return;
    if (c.clip) this._endClip(c, true);
    if (c.node) try { c.node.stop(0.08); } catch (e) { /* */ }
    this._note(`interrupt ${c.kind}`);
    this.cur = null;
    this._relAt = this.t + DUCK_HOLD;
  }
  // v = ambience/music factor, sv = sfx factor (1 = no duck). Smooth: fast attack, slow release.
  _setDuck(v, sv = 1) {
    if (Math.abs(v - this.duck) < 0.005 && Math.abs(sv - this.duckSfx) < 0.005) return;
    const down = v < this.duck - 0.004 || sv < this.duckSfx - 0.004;
    this.duck = v; this.duckSfx = sv;
    const t = this.ac.currentTime, tc = down ? DUCK_ATTACK : DUCK_RELEASE, B = this.mixer.bus;
    for (const [n, g] of [['ambience', v], ['music', v], ['sfx', sv]]) {
      B[n].dry.gain.setTargetAtTime(g, t, tc);
      if (B[n].wetDuck) B[n].wetDuck.gain.setTargetAtTime(g, t, tc);   // the reverb send ducks with the dry signal
    }
  }
  // beds down while a delayed PA line's lead-in (melody) plays; the speech's own start deepens it (and extends sfx)
  _preDuck(item) {
    const av = Math.min(1, this._vol(item));
    const v = 1 - (1 - PRE_DUCK_AMB) * av;
    if (v < this.duck) this._setDuck(v, this.duckSfx);
    this._relAt = Math.max(this._relAt ?? 0, item.born + 6);   // safety: let go if the line never starts
  }

  update(dt) {
    this.t += Math.min(dt || 0, 0.25);
    if (this._relAt != null && !(this.cur && this.cur._ducks) && this.t >= this._relAt) { this._relAt = null; this._setDuck(1, 1); }
    if (this._paused) return;   // pause menu: the queue waits (and goes stale), nothing new starts
    // stale lines are not spoken late
    if (this.queue.length) this.queue = this.queue.filter(q => this.t - q.born <= q.maxAge);
    if (!this.cur) {
      for (let i = 0; i < this.queue.length;) {
        const it = this.queue[i];
        if (it.born > this.t) { i++; continue; }          // `delay`: not yet its turn
        this.queue.splice(i, 1);
        if (this._vol(it) < MIN_VOL) { this._note(`drop(inaudible@start) ${it.kind}`); continue; }
        this._start(it); break;
      }
    }
    const c = this.cur; if (!c) return;
    if (c.wait > this.t) return;
    if (c.clip) { // a recording is playing: end it by the audio clock (not onended alone), meanwhile follow the listener
      if (this._clipDone(c)) { this._endClip(c); c.step++; c.wait = this.t + 0.4; }
      else { this._follow(c); return; }
    }
    while (c.step < c.parts.length) {
      const p = c.parts[c.step];
      if (p.lang === 'ja' && this._voiceOn()) {
        const vol = this._vol(c);
        if (vol >= MIN_VOL) {
          const r = this._tryPlay(c, p, vol);
          if (r !== 'skip') return;   // 'played' or 'wait' (the recording is still on its way)
        }
      }
      c.step++; // English is caption text only; or no recording / you walked away: skip it
    }
    if (!c.ending) { // chime + caption only: hold the slot for roughly as long as the line would take
      c.ending = true; c.wait = this.t + (c.spoke ? 0.6 : Math.min(4, 1 + c.parts.reduce((a, p) => a + p.text.length * (p.lang === 'ja' ? 0.1 : 0.05), 0))); return;
    }
    this.cur = null; this.lastEnd = this.t; this._relAt = this.t + DUCK_HOLD;   // beds come back after a beat (the next line may follow at once)
  }

  // the recording of this part: play it when ready, wait for it up to LOAD_WAIT s from the moment its step is reached,
  // skip it when it is not in the manifest or failed. returns 'played' | 'wait' | 'skip'
  _tryPlay(c, p, vol) {
    const k = this._kOf(p), v = this._vari(p), cl = this.clips;
    let st = cl.state(k, v);
    if (st === 'idle') st = cl.want(k, v);
    if (st === 'ready') {
      const buf = cl.peek(k, v);
      if (buf && this._playClip(c, p, buf, vol, v)) return 'played';
      return 'skip';
    }
    if (st === 'loading') {
      if (c.waitStep !== c.step) { c.waitStep = c.step; c.waitSince = this.t; }
      if (this.t - c.waitSince < LOAD_WAIT) return 'wait';
      this.st.late++; this._err('late'); this._emit('error', 'late'); this._note(`late ${k}`);
      return 'skip';
    }
    if (st === 'missing') { this.st.missing++; this._note(`missing ${k}`); return 'skip'; }
    const code = 'clip-' + (cl.errorOf(k, v) || 'error');
    this._err(code); this._emit('error', code); this._note(`${code} ${k}`);
    return 'skip';
  }

  // station speakers: horn band + reverb tail of the space; heard from afar: muffled, all reverb. A person: the plain recording
  _gainFor(c, vol, pa) {
    const lv = Math.min(1.2, vol);
    if (!pa) return VOICE * lv;
    return PA_VOICE * lv * (vol < PA_NEAR ? 0.6 + 0.4 * (vol / PA_NEAR) : 1);   // overheard: scaled down with how far you are
  }
  _playClip(c, p, buf, vol, variant) {
    if (!this.ac || this.ac.state === 'closed') return false;
    const pa = this._isPA(c);
    const gain = this._gainFor(c, vol, pa);
    const o = { bus: 'voice', gain, force: true };
    if (pa) {
      const near = vol >= PA_NEAR;
      o.hp = PA_HP; o.lp = near ? PA_LP : FAR_LP; o.send = near ? (c.send ?? 0.6) : 1;
      o.pan = (c.id % 3 - 1) * 0.12;   // diffuse: the same slight spread as the chime
    } else {
      o.send = c.send ?? 0.2;
      // a person in the room: left / right from where they stand, the way audio.js places a one-shot with `pos` (HRTF panner).
      // rolloff 0: the panner only gives the direction, the distance law is _vol() (pointGain) and follows the listener below
      if (c.pos) { const L = this.sys.L || {}; o.pos = { x: c.pos.x, y: c.pos.y != null ? c.pos.y : (L.y || 0) + 1.5, z: c.pos.z }; o.ref = c.ref ?? 2.5; o.rolloff = 0; o.hrtf = true; }
    }
    let h = null;
    try { h = this.mixer.play(buf, o); } catch (e) { this._err('play-throw'); this._note('play threw: ' + e.message); }
    if (!h) { this._err('play-null'); return false; }
    const now = this.ac.currentTime;
    c.clip = { h, pa, dur: buf.duration, end: now + buf.duration, hard: this.t + buf.duration + 3, vol, near: vol >= PA_NEAR };
    c.spoke = true;
    this.st.tried++; this.st.started++;
    if (this.last) this.last.spoken.push({ lang: p.lang, key: p._k, variant, vol: +vol.toFixed(2), gain: +gain.toFixed(2), pa, text: p.say || p.text });
    this._emit('start');
    return true;
  }
  _clipDone(c) {
    const k = c.clip;
    return this.ac.currentTime >= k.end + 0.04 || this.t > k.hard || this.ac.state === 'closed';
  }
  // while it plays: follow the listener (smoothly), so walking away from a platform fades its announcement
  _follow(c) {
    const k = c.clip, vol = this._vol(c);
    if (Math.abs(vol - k.vol) < 0.01) return;
    k.vol = vol;
    const t = this.ac.currentTime, h = k.h;
    try {
      h.gain.gain.setTargetAtTime(this._gainFor(c, vol, k.pa), t, 0.15);
      if (k.pa) {
        const near = vol >= PA_NEAR;
        if (h.lpf) h.lpf.frequency.setTargetAtTime(near ? PA_LP : FAR_LP, t, 0.3);
        if (h.send) h.send.gain.setTargetAtTime(near ? (c.send ?? 0.6) : 1, t, 0.3);
      }
    } catch (e) { /* node already gone */ }
  }
  _endClip(c, interrupted = false) {
    const k = c.clip; if (!k) return;
    c.clip = null;
    if (interrupted || this.t > k.hard) { try { k.h.stop(0.03); } catch (e) { /* ended */ } }
    this.st.ended++; this._emit('end');
  }

  _start(item) {
    this.cur = item;
    item.step = 0; item.wait = this.t; item.spoke = false; item.clip = null;
    const vol = this._vol(item);
    this.last = { kind: item.kind, ja: (item.parts.find(p => p.lang === 'ja') || {}).text || '', en: (item.parts.find(p => p.lang === 'en') || {}).text || '', vol: +vol.toFixed(2), t: +this.t.toFixed(1), spoken: [] };
    this._note(`start ${item.kind} vol=${vol.toFixed(2)} "${(this.last.ja || this.last.en).slice(0, 24)}"`);
    if (item.cooldown) this._repeat.set(item._key, this.t);
    const av = Math.min(1, vol);
    item._ducks = true;
    const D = PA_DUCK;
    if (item.platform || item.pa) this._setDuck(1 - (1 - D.ambience) * av, 1 - (1 - D.sfx) * av);
    else if (item.prio <= 1) this._setDuck(1 - 0.45 * av); else if (item.prio <= 3) this._setDuck(1 - 0.2 * av);
    else item._ducks = false;
    if (item._ducks) this._relAt = null;
    if (item.chime) {
      const cb = this.bank.peek('chime:' + item.chime);
      if (cb) {
        const pre = (item.platform || item.pa) ? DUCK_PRE : 0;   // the beds are already going down when the chime arrives
        item.node = this._route(item, cb, vol, pre); item.wait = this.t + pre + (item.chime === 'esc' ? 0.9 : 1.6);
      }
    }
    const cap = item.caption ?? (item.kind === 'train' || item.kind === 'station' || item.kind === 'platform' || item.kind === 'escalator');
    if (cap) {
      const en = this.last.en, ja = this.last.ja;
      const dur = item.parts.reduce((a, p) => a + (p.lang === 'ja' ? p.text.length * 0.16 : p.text.length * 0.065), 1.5);
      // channel: the PA, escalator safety lines and background voices sit with the ambience; a person addressing you is 'speech'
      const channel = item.channel || (item.kind === 'crowd' ? 'speech' : 'ambient');
      this.sys.ctx.events.emit('caption', { text: en || ja, en, ja, kind: item.kind, speaker: 'PA', duration: dur, distant: !!item.distant, channel });
    }
  }
  // the chime plays diffusely (station-wide speakers), at the item's audible level
  _route(item, buf, vol, pre = 0) {
    const g = Math.min(1.2, vol) * ((item.platform || item.pa) ? PLAT_CHIME : CHIME);
    return this.mixer.play(buf, { bus: 'voice', gain: g, send: item.send ?? 0.6, lp: item.lp, pan: (item.id % 3 - 1) * 0.12, force: true, when: pre ? this.ac.currentTime + pre : undefined });
  }

  // lead -> analytics namba_pa (js/analytics.js) and the audio flight-recorder panel.
  //   mode: 'clips' (recorded lines through Web Audio; there is no other engine any more) · speech: lines are on (speech setting
  //   and no ?nopa) · tried / started / ended: recordings handed to playback / that started / that ended (an interrupted one
  //   counts as ended) · missing: lines whose key is not in the manifest (chime + caption instead) · late: recordings that did not
  //   arrive within 3.5 s · errors: distinct codes (max 8: late, clip-http-404, clip-decode, ...) · lastErr · clips / clipMb:
  //   decoded clips held now (voice + crowd loops) and their size
  stats() {
    const s = this.st, c = this.clips ? this.clips.stats() : { n: 0, mb: 0 };
    return { mode: 'clips', speech: !!(this.useSpeech && !this.noPa), tried: s.tried, started: s.started, ended: s.ended, missing: s.missing, late: s.late,
      errors: s.errors.slice(), lastErr: s.lastErr, clips: c.n, clipMb: c.mb };
  }
  debug() {
    return {
      mode: 'clips', canSpeak: this.canSpeak, useSpeech: this.useSpeech, noPa: this.noPa, manifest: this.clips ? this.clips.manifestState : null,
      stats: this.stats(), clips: this.clips ? this.clips.stats() : null, queue: this.queue.map(q => `${q.kind}:${q.parts[0].text.slice(0, 20)}`), cur: this.cur ? `${this.cur.kind}:${this.cur.parts[0].text.slice(0, 20)}` : null,
      last: this.last, log: this.log.slice(-8),
      duck: { amb: +this.duck.toFixed(3), sfx: +this.duckSfx.toFixed(3), ambDb: +(20 * Math.log10(this.duck)).toFixed(1),
        gains: this.mixer ? { ambience: +this.mixer.bus.ambience.dry.gain.value.toFixed(3), music: +this.mixer.bus.music.dry.gain.value.toFixed(3), sfx: +this.mixer.bus.sfx.dry.gain.value.toFixed(3) } : null },
    };
  }
}
export { PRIO, MIN_VOL, PA_DUCK, PA_VOICE, VOICE };
