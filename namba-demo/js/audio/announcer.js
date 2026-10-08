// =============================================================================
// Announcer: station PA, escalator / shop / restaurant voice lines.
//
// Voices are the browser's real voices (window.speechSynthesis), JAPANESE ONLY: the
// browser never narrates in English (v3 feedback: hearing the announcements in
// Japanese is enough). A ja-JP voice speaks the Japanese line after the synthesized
// station chime; the English translation lives in the caption text only.
//   * no ja-JP voice  -> chime + caption only (nothing is ever spoken in English)
// speechSynthesis cannot be routed into Web Audio or spatialised, so every
// item carries *where it is audible* and we set utterance.volume from that at
// the moment we speak (platform zone / point speaker distance / plain gain —
// see zones.js). An item that is inaudible when its turn comes is dropped;
// queued items go stale (maxAge) rather than being spoken late.
//
// One utterance at a time, ever: a single `cur` item walks chime -> ja -> en.
// Voices load asynchronously (voiceschanged, plus polling); speech needs a
// prior user gesture (the title click) — a rejected utterance is skipped.
// =============================================================================
import { spokenText } from './phrases.js';
import { platformGain, pointGain } from './zones.js';

const PRIO = { train: 0, station: 1, platform: 1, crowd: 2, escalator: 3, shop: 4, ambient: 5 };
const MAX_AGE = { train: 30, station: 20, platform: 20, crowd: 1.6, escalator: 10, shop: 4, ambient: 15 };
const MIN_VOL = 0.06;
// v7 (platform PA must be clearly heard): while a platform line plays, the beds sit this far down (scaled by how audible
// the platform is from where you stand, so the concourse above only dips a little). Attack ~0.3 s, release ~1 s.
const PA_DUCK = { ambience: 0.355, music: 0.355, sfx: 0.7 };   // -9 dB, -9 dB, -3 dB at full platform volume
const DUCK_ATTACK = 0.1, DUCK_RELEASE = 0.33, DUCK_HOLD = 0.7;  // setTargetAtTime constants (s): ~0.3 s / ~1 s to settle; hold between lines
const PLAT_CHIME = 0.85, CHIME = 0.55;                          // chime gain at full volume
const norm = (l) => String(l || '').replace('_', '-').toLowerCase();

export class Announcer {
  constructor(sys) {
    this.sys = sys; this.mixer = sys.mixer; this.bank = sys.bank; this.ac = sys.mixer.ac;
    this.queue = []; this.cur = null; this.seq = 0; this.t = 0;
    this.speech = (sys.allowSpeech && typeof speechSynthesis !== 'undefined') ? speechSynthesis : null;
    this.voices = { ja: null, en: null };   // en stays null on purpose: no English speechSynthesis, ever
    this.voiceCount = 0;
    this.useSpeech = true;
    this.duck = 1;               // ambience/music duck factor now (1 = none)
    this.duckSfx = 1;
    this._relAt = null;          // time to let the duck go (held a moment between consecutive lines)
    this.last = null;            // debug: the last item that actually started
    this.log = [];               // debug: recent events
    this._repeat = new Map();    // text key -> time last spoken
    this._pollT = 0;
    if (this.speech) {
      this.refreshVoices();
      try { this.speech.addEventListener('voiceschanged', () => this.refreshVoices()); } catch (e) { this.speech.onvoiceschanged = () => this.refreshVoices(); }
    }
  }
  _note(s) { this.log.push(`${this.t.toFixed(1)} ${s}`); if (this.log.length > 14) this.log.shift(); }

  refreshVoices() {
    if (!this.speech) return;
    let vs = [];
    try { vs = this.speech.getVoices() || []; } catch (e) { vs = []; }
    this.voiceCount = vs.length;
    const by = (lang, prefs, bad) => {
      let c = vs.filter(v => norm(v.lang).startsWith(lang) && !(bad && bad.test(v.name)));
      if (!c.length) return null;
      for (const p of prefs) { const v = c.find(v => p.test(v.name)); if (v) return v; }
      return c.find(v => v.localService) || c[0];
    };
    this.voices.ja = by('ja', [/Nanami|Kyoko|O-ren|Haruka|Ayumi|Google 日本語|Mizuki|Sayaka|Otoya|Hattori|Ichiro/i]);
  }
  get hasJaVoice() { return !!(this.speech && this.voices.ja); }
  get hasEnVoice() { return false; }
  get canSpeak() { return !!(this.useSpeech && this.speech && this.voices.ja); }
  cancelSpeech() { if (this.speech) try { this.speech.cancel(); } catch (e) { /* */ } if (this.cur) this.cur.utter = null; }
  pauseSpeech(on) { if (this.speech) try { on ? this.speech.pause() : this.speech.resume(); } catch (e) { /* */ } }
  // iOS / Safari want one (silent) utterance inside a user gesture
  unlock() {
    if (!this.speech || this._unlocked) return; this._unlocked = true;
    try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; this.speech.speak(u); } catch (e) { /* */ }
    this.refreshVoices();
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

  _interrupt() {
    const c = this.cur; if (!c) return;
    if (c.utter && this.speech) try { this.speech.cancel(); } catch (e) { /* */ }
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
  _speakable(p) {
    if (!this.useSpeech || !this.speech) return null;
    if (p.lang !== 'ja') return null;   // English parts are caption text only
    return this.voices.ja || null;
  }

  update(dt) {
    this.t += Math.min(dt || 0, 0.25);
    if (this._relAt != null && !(this.cur && this.cur._ducks) && this.t >= this._relAt) { this._relAt = null; this._setDuck(1, 1); }
    if (this.speech && !this.voices.ja && this.t - this._pollT > 2 && this.t < 60) { this._pollT = this.t; this.refreshVoices(); }
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
    if (c.utter) { // utterance in flight
      if (c.uDone) { c.utter = null; c.step++; c.wait = this.t + 0.4; }
      else if (!c.uStarted && this.t > c.uDeadline) { this._note('no-start: ' + (c.uErr || 'timeout')); try { this.speech.cancel(); } catch (e) { /* */ } c.utter = null; c.step++; }
      else if (this.t > c.uHard) { this._note('hard-timeout'); try { this.speech.cancel(); } catch (e) { /* */ } c.utter = null; c.step++; }
      else return;
    }
    while (c.step < c.parts.length) {
      const p = c.parts[c.step];
      const voice = this._speakable(p);
      const vol = this._vol(c);
      if (voice && vol >= MIN_VOL) { this._speak(c, p, voice, vol); return; }
      c.step++; // no voice for this language (or you walked away): skip it
    }
    if (!c.ending) { // chime + caption only: hold the slot for roughly as long as the line would take
      c.ending = true; c.wait = this.t + (c.spoke ? 0.6 : Math.min(4, 1 + c.parts.reduce((a, p) => a + p.text.length * (p.lang === 'ja' ? 0.1 : 0.05), 0))); return;
    }
    this.cur = null; this._relAt = this.t + DUCK_HOLD;   // beds come back after a beat (the next line may follow at once)
  }

  _speak(c, p, voice, vol) {
    const text = spokenText(p.say || p.text, p.lang);
    let u;
    try {
      u = new SpeechSynthesisUtterance(text);
      u.voice = voice;
    } catch (e) { c.step++; this._note('utterance threw: ' + e.message); return; }   // a bad voice object must not wedge the PA slot (and its duck)
    u.lang = 'ja-JP'; u.rate = 0.95; u.pitch = 1.05;
    const mv = this.mixer.volumes;
    // station PA is part of the soundscape: on the platform it goes out at (nearly) the browser's maximum. The master slider
    // still scales it, but on a square-root curve, so the default 0.8-0.85 no longer costs a fifth of the level
    const k = c.platform ? Math.min(1, Math.sqrt(mv.master) * 1.1) : mv.master;
    u.volume = Math.max(0.02, Math.min(1, vol * mv.voice * k));
    u.onstart = () => { if (c.utter === u) c.uStarted = true; };
    u.onend = () => { if (c.utter === u) c.uDone = true; };
    u.onerror = (e) => { if (c.utter === u) { c.uErr = e && e.error; c.uDone = true; this._note('error ' + (e && e.error)); } };
    c.utter = u; c.uStarted = false; c.uDone = false; c.uErr = null; c.spoke = true;
    c.uDeadline = this.t + 3; c.uHard = this.t + 4 + text.length * (p.lang === 'ja' ? 0.35 : 0.2);
    this.last.spoken.push({ lang: p.lang, voice: voice.name, vol: +u.volume.toFixed(2), text });
    try { this.speech.speak(u); } catch (e) { c.utter = null; c.step++; this._note('speak threw'); }
  }

  _start(item) {
    this.cur = item;
    item.step = 0; item.wait = this.t; item.spoke = false;
    const vol = this._vol(item);
    this.last = { kind: item.kind, ja: (item.parts.find(p => p.lang === 'ja') || {}).text || '', en: (item.parts.find(p => p.lang === 'en') || {}).text || '', vol: +vol.toFixed(2), t: +this.t.toFixed(1), voiceJa: this.voices.ja ? this.voices.ja.name : null, voiceEn: null, spoken: [] };
    this._note(`start ${item.kind} vol=${vol.toFixed(2)} "${(this.last.ja || this.last.en).slice(0, 24)}"`);
    if (item.cooldown) this._repeat.set(item._key, this.t);
    const av = Math.min(1, vol);
    item._ducks = true;
    if (item.platform) this._setDuck(1 - (1 - PA_DUCK.ambience) * av, 1 - (1 - PA_DUCK.sfx) * av);
    else if (item.prio <= 1) this._setDuck(1 - 0.45 * av); else if (item.prio <= 3) this._setDuck(1 - 0.2 * av);
    else item._ducks = false;
    if (item._ducks) this._relAt = null;
    if (item.chime) {
      const cb = this.bank.peek('chime:' + item.chime);
      if (cb) { item.node = this._route(item, cb, vol); item.wait = this.t + (item.chime === 'esc' ? 0.9 : 1.6); }
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
  _route(item, buf, vol) {
    const g = Math.min(1.2, vol) * (item.platform ? PLAT_CHIME : CHIME);
    return this.mixer.play(buf, { bus: 'voice', gain: g, send: item.send ?? 0.6, lp: item.lp, pan: (item.id % 3 - 1) * 0.12, force: true });
  }

  stats() { return { voices: this.voiceCount, ja: this.voices.ja ? this.voices.ja.name : null, en: this.voices.en ? this.voices.en.name : null }; }
  debug() {
    return {
      voiceCount: this.voiceCount, ja: this.voices.ja ? `${this.voices.ja.name} (${this.voices.ja.lang})` : null, en: this.voices.en ? `${this.voices.en.name} (${this.voices.en.lang})` : null,
      useSpeech: this.useSpeech, queue: this.queue.map(q => `${q.kind}:${q.parts[0].text.slice(0, 20)}`), cur: this.cur ? `${this.cur.kind}:${this.cur.parts[0].text.slice(0, 20)}` : null,
      last: this.last, log: this.log.slice(-8),
      duck: { amb: +this.duck.toFixed(3), sfx: +this.duckSfx.toFixed(3), ambDb: +(20 * Math.log10(this.duck)).toFixed(1),
        gains: this.mixer ? { ambience: +this.mixer.bus.ambience.dry.gain.value.toFixed(3), music: +this.mixer.bus.music.dry.gain.value.toFixed(3), sfx: +this.mixer.bus.sfx.dry.gain.value.toFixed(3) } : null },
    };
  }
}
export { PRIO, MIN_VOL };
