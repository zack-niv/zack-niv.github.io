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
// Voices load asynchronously (voiceschanged, plus polling).
//
// v12 (iPhone: "can't hear the station Japanese announcements"): iOS WebKit silently DROPS every speak() (no start, no
// error, nothing) until one speak() runs inside a user-gesture handler; pointerdown from a finger is not one (touchend
// and click are). v8-v11 spent the only unlock on the first pointerdown and then removed the gesture listeners, so on an
// iPhone no line was ever spoken while the captions still showed. Now (audio.js `_gesture` + `unlock` below): every
// touchend / click / key / mouse-down until speech is PROVEN (an onstart/onend of our own utterance) speaks a silent
// '。' inside that gesture; after a cancel or a line that never started, the next gesture primes it again.
// `stats()` reports what the device actually did (analytics: namba_pa).
// =============================================================================
import { spokenText } from './phrases.js?v=ca6849e';
import { platformGain, pointGain } from './zones.js?v=ca6849e';

const PRIO = { train: 0, station: 1, platform: 1, crowd: 2, escalator: 3, shop: 4, ambient: 5 };
const MAX_AGE = { train: 30, station: 20, platform: 20, crowd: 1.6, escalator: 10, shop: 4, ambient: 15 };
const MIN_VOL = 0.06;
// v7 (platform PA must be clearly heard): while a platform line plays, the beds sit this far down (scaled by how audible
// the platform is from where you stand, so the concourse above only dips a little). Attack ~0.3 s, release ~1 s.
// v8 (feedback 2, "could barely hear the Japanese"): speech goes out through speechSynthesis, which tops out at volume 1.0 and
// cannot be boosted, so the only lever is what sits under it. v7's -3 dB on sfx left the train (rumble, brakes, doors, rolling
// stock: all sfx emitters) nearly untouched exactly when a platform line is read, and the PA is about that train. Now the beds
// go to -12 dB and sfx to -9 dB (measured: notes/v8-fixes.md).
// v11 (feedback 5): deeper (on top of the fixed -5/-6 dB bed trim in mixer.js), earlier (the duck starts DUCK_PRE s before the
// chime, and for delayed platform lines at the melody) and it lets go later (DUCK_HOLD after the speech ends, slow swell back).
const PA_DUCK = { ambience: 0.18, music: 0.18, sfx: 0.3 };   // -15 dB, -15 dB, -10.5 dB at full volume
const PRE_DUCK_AMB = 0.35;                                    // ambience/music factor during a delayed line's melody / lead-in (sfx waits for the speech)
const DUCK_ATTACK = 0.09, DUCK_RELEASE = 0.45, DUCK_HOLD = 1.0;  // setTargetAtTime constants (s): ~0.3 s attack / ~1.4 s release; hold between lines
const DUCK_PRE = 0.45;                                        // s the duck leads the chime
const PLAT_CHIME = 0.85, CHIME = 0.55;                          // chime gain at full volume
const norm = (l) => String(l || '').replace('_', '-').toLowerCase();
const UNLOCK_TEXT = '。';          // Japanese full stop: a real utterance (not blank) that makes no sound; never English
const UNLOCK_WAIT_MS = 1500;       // an unlock utterance that neither starts nor ends in this long has failed: retry on the next gesture
const CANCEL_GAP = 0.3;            // s of quiet after speechSynthesis.cancel() before the next speak() (iOS drops a speak() right after a cancel)
// iOS WebKit ignores utterance.volume: every line plays at full device volume. So far-off (quiet) shop calls, barks and
// background voices would blare once speech works there; on iOS those are only voiced when they are loud anyway (the PA,
// station and train lines always are, as before).
const IOS = typeof navigator !== 'undefined' && (/iPhone|iPad|iPod/.test(navigator.userAgent || '') || (/Macintosh/.test(navigator.userAgent || '') && navigator.maxTouchPoints > 1));
const IOS_MIN_VOL = 0.45;
// v13 (Zack on an iPhone: "announcements don't sound like a natural part of the surroundings"). The speech voice is dry,
// centred and, on iOS, always at full device volume; under it the beds dropped a further 15 dB, so every line landed in a
// silent, roomless station. Now:
//   * iOS ducks the beds gently (its voice is loud whatever we do; the station keeps living under it);
//   * the hall answers the PA: a PA-horn formant voice with the line's own mora timing ('vx:' recipe) plays ONLY into the
//     station reverb while the real voice reads the line (start on the utterance's onstart, fade on its onend), so the
//     line gets the space's tail and the platform's speaker-to-speaker echoes (ir.js slaps) that speech cannot be routed to;
//   * on iOS a PA line you only overhear (a platform below / far along the shed: volume under IOS_PA_NEAR) is not read at
//     full volume in your ear: you hear it as it really sounds from there, the muffled speakers in the hall (+ caption).
const PA_DUCK_IOS = { ambience: 0.5, sfx: 0.68 };             // -6 dB, -3.4 dB
const IOS_PA_NEAR = 0.35;
const HALL_GAIN = 0.45, HALL_GAIN_PHONE = 0.32;               // proxy level into the reverb (phone: its mix sits +10 dB hotter)
const HALL_KEEP = 6;                                          // proxies kept synthesized (≈ 0.4 MB each); older ones are dropped
const hashText = (t) => { let h = 2166136261; for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 16777619); return (h >>> 0) % 97 + 1; };
const wall = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

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
    // v12: speech unlock + what the device actually did (stats() -> analytics namba_pa)
    this._unlocked = false; this.unlockVia = null; this._unlocking = null; this._needsPrime = false;
    this._cancelAt = -9; this._paused = false; this._noStartRun = 0;
    this.st = { attempts: 0, tried: 0, started: 0, ended: 0, noStart: 0, errors: [], lastErr: null, hall: 0, murmur: 0 };
    const q = sys.ctx && sys.ctx.params && sys.ctx.params.has ? (k) => sys.ctx.params.has(k) : () => false;
    this.ios = IOS && !q('noiospa');      // ?noiospa: the v12 iOS PA (deep duck, every line read aloud) for A/B
    this.noHall = q('nohall');            // ?nohall: no hall proxy under the PA (A/B)
    this._vxKeep = [];
    if (this.speech) {
      this.refreshVoices();
      try { this.speech.addEventListener('voiceschanged', () => this.refreshVoices()); } catch (e) { this.speech.onvoiceschanged = () => this.refreshVoices(); }
    }
  }
  _note(s) { this.log.push(`${this.t.toFixed(1)} ${s}`); if (this.log.length > 14) this.log.shift(); }
  _err(code) { code = String(code || 'unknown'); this.st.lastErr = code; if (!this.st.errors.includes(code) && this.st.errors.length < 8) this.st.errors.push(code); }

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
  _cancel() {
    if (!this.speech) return;
    try { this.speech.cancel(); } catch (e) { /* */ }
    this._cancelAt = this.t;
    this._needsPrime = true;     // iOS can come out of a cancel unable to start the next utterance: prime it again on the next gesture
  }
  // tab hidden / speech switched off: drop the line in flight (PA lines are of the moment, never resumed late)
  cancelSpeech() { if (this.cur && this.cur.utter) this._interrupt(); else if (this.speech && this.speech.speaking) this._cancel(); }
  // v12: the pause menu used to speechSynthesis.pause()/resume(); iOS can wedge in the paused state and Chrome holds every later
  // utterance while paused. Now a pause drops the line in flight and holds the queue (it goes stale on its own).
  pauseSpeech(on) {
    this._paused = !!on;
    if (on) { if (this.cur && this.cur.utter) this._interrupt(); }
    else if (this.speech) try { if (this.speech.paused) this.speech.resume(); } catch (e) { /* */ }
  }
  // speech is proven to work and needs nothing from the next gesture
  get speechReady() { return !this.speech || (this._unlocked && !this._needsPrime); }
  // Call from INSIDE a user-gesture handler (touchend / click / keydown / mouse pointerdown): iOS WebKit lifts its speech
  // restriction only for a speak() made while it is processing a gesture, and drops (silently) every speak() before that.
  // A silent '。' is spoken; only its onstart/onend marks speech unlocked, so a gesture iOS did not honour is retried on the
  // next one. Returns true when an attempt was made.
  unlock(via = 'gesture') {
    if (!this.speech || this.speechReady) return false;
    if (this.voiceCount > 0 && !this.voices.ja) return false;   // voices are in and none is Japanese: nothing will ever be spoken
    if (this.st.attempts >= 24) return false;                  // a device that never confirms: stop spending gestures (stats say so)
    const now = wall();
    // one attempt in flight per gesture kind: a tap's click still gets its own try if the touchend's is unconfirmed
    if (this._unlocking && now - this._unlocking.at < UNLOCK_WAIT_MS && this._unlocking.via === via) return false;
    // the previous try was accepted (queued / speaking) and simply has not started yet: let it confirm
    if (this._unlocking && now - this._unlocking.at < UNLOCK_WAIT_MS) { try { if (this.speech.speaking || this.speech.pending) return false; } catch (e) { /* */ } }
    if (this._unlocking) {   // the previous try never confirmed (timed out), or this gesture's other event tries too (superseded)
      if (now - this._unlocking.at >= UNLOCK_WAIT_MS) { this._err('unlock-timeout'); this._note('unlock timeout'); }
      this._unlocking = null;
    }
    // a line that is audibly playing already proves speech works
    if (this.cur && this.cur.utter && this.cur.uStarted) { this._proven('speaking'); return false; }
    this.refreshVoices();
    let u;
    try { u = new SpeechSynthesisUtterance(UNLOCK_TEXT); } catch (e) { this._err('unlock-throw'); return false; }
    try { if (this.voices.ja) u.voice = this.voices.ja; } catch (e) { /* the lang below is enough */ }
    u.lang = 'ja-JP'; u.volume = 0.01; u.rate = 1.5;   // iOS ignores volume; '。' is silent anyway
    const att = { u, at: now, via };
    const ok = () => { if (this._unlocking === att) this._unlocking = null; this._proven(via); };
    u.onstart = ok; u.onend = ok;
    u.onerror = (e) => { if (this._unlocking === att) this._unlocking = null; const c = (e && e.error) || 'error'; this._err('unlock:' + c); this._note('unlock error ' + c); };
    this._unlocking = att; this.st.attempts++;
    try { if (this.speech.paused) this.speech.resume(); } catch (e) { /* */ }
    try { this.speech.speak(u); } catch (e) { this._unlocking = null; this._err('unlock-throw'); return false; }
    this._note(`unlock try #${this.st.attempts} via ${via}`);
    return true;
  }
  _proven(via) {
    if (!this._unlocked) { this.unlockVia = via; this._note('speech unlocked via ' + via); }
    this._unlocked = true; this._needsPrime = false; this._noStartRun = 0;
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
    const hn = this._hallName(item); if (hn) { this.bank.get(hn, 4); this._vxTouch(hn); }
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

  _interrupt() {
    const c = this.cur; if (!c) return;
    if (c.utter && this.speech) this._cancel();
    if (c.node) try { c.node.stop(0.08); } catch (e) { /* */ }
    this._hallStop(c, 0.15);
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
    const v = 1 - (1 - (this.ios ? 0.62 : PRE_DUCK_AMB)) * av;
    if (v < this.duck) this._setDuck(v, this.duckSfx);
    this._relAt = Math.max(this._relAt ?? 0, item.born + 6);   // safety: let go if the line never starts
  }
  _speakable(p) {
    if (!this.useSpeech || !this.speech) return null;
    if (p.lang !== 'ja') return null;   // English parts are caption text only
    return this.voices.ja || null;
  }

  update(dt) {
    this.t += Math.min(dt || 0, 0.25);
    if (this._relAt != null && !(this.cur && this.cur._ducks) && this.t >= this._relAt) { this._relAt = null; this._setDuck(1, 1); }
    // iOS: getVoices() can be empty for a while and voiceschanged is unreliable, so keep polling (2 s, then every 6 s)
    if (this.speech && !this.voices.ja && this.t - this._pollT > (this.t < 60 ? 2 : 6)) { this._pollT = this.t; this.refreshVoices(); }
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
    if (c.utter) { // utterance in flight
      if (c.uDone) { c.utter = null; c.step++; c.wait = this.t + 0.4; }
      else if (!c.uStarted && this.t > c.uDeadline) {
        // never started: on iOS this is a speak() dropped before speech was unlocked (or after a cancel wedged it). The next
        // gesture primes speech again (audio.js keeps listening for gestures until speechReady).
        this._note('no-start: ' + (c.uErr || 'timeout')); this.st.noStart++; this._noStartRun++; if (!c.uErr) this._err('no-start');
        this._cancel(); c.utter = null; c.step++;
      }
      else if (this.t > c.uHard) { this._note('hard-timeout'); this._err('hard-timeout'); this._cancel(); c.utter = null; c.step++; }
      else return;
    }
    while (c.step < c.parts.length) {
      const p = c.parts[c.step];
      const voice = this._speakable(p);
      const vol = this._vol(c);
      const minVol = IOS && !(c.platform || c.pa) && c.prio >= 2 ? IOS_MIN_VOL : MIN_VOL;
      if (voice && this.ios && (c.platform || c.pa) && vol < IOS_PA_NEAR && p.lang === 'ja' && this._murmur(c, vol)) return;
      if (voice && vol >= minVol) {
        if (this.t - this._cancelAt < CANCEL_GAP) { c.wait = this._cancelAt + CANCEL_GAP; return; }   // a breath after a cancel
        this._speak(c, p, voice, vol); return;
      }
      c.step++; // no voice for this language (or you walked away): skip it
    }
    if (!c.ending) { // chime + caption only: hold the slot for roughly as long as the line would take
      c.ending = true; c.wait = this.t + (c.spoke ? 0.6 : Math.min(4, 1 + c.parts.reduce((a, p) => a + p.text.length * (p.lang === 'ja' ? 0.1 : 0.05), 0))); return;
    }
    this.cur = null; this.lastEnd = this.t; this._relAt = this.t + DUCK_HOLD;   // beds come back after a beat (the next line may follow at once)
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
    const k = (c.platform || c.pa) ? Math.min(1, Math.sqrt(mv.master) * 1.1) : mv.master;
    u.volume = Math.max(0.02, Math.min(1, vol * mv.voice * k));
    u.onstart = () => { this.st.started++; this._proven('line'); if (c.utter === u) { c.uStarted = true; this._hall(c, p, vol); } };
    u.onend = () => { this.st.ended++; if (c.utter === u) c.uDone = true; this._hallStop(c); };
    u.onerror = (e) => {
      this._hallStop(c);
      const code = (e && e.error) || 'error';
      if (code !== 'interrupted' && code !== 'canceled') this._err(code);    // our own cancels are not failures
      if (c.utter === u) { c.uErr = code; c.uDone = true; this._note('error ' + code); }
    };
    this.st.tried++;
    c.utter = u; c.uStarted = false; c.uDone = false; c.uErr = null; c.spoke = true;
    c.uDeadline = this.t + 6;   // v8: online / natural ja voices can take >3 s to start (the old 3 s dropped the line)
    c.uHard = this.t + 4 + text.length * (p.lang === 'ja' ? 0.35 : 0.2);
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
    const D = this.ios ? PA_DUCK_IOS : PA_DUCK;
    if (item.platform || item.pa) this._setDuck(1 - (1 - D.ambience) * av, 1 - (1 - D.sfx) * av);
    else if (item.prio <= 1) this._setDuck(1 - (this.ios ? 0.25 : 0.45) * av); else if (item.prio <= 3) this._setDuck(1 - 0.2 * av);
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

  // ---- v13: the hall's answer to the PA (see the note at the top) ------------------------------------------------------
  // which lines get one: station-wide speakers (platform / area PA, train, station, escalator); not shop calls or barks
  _hallName(item) {
    if (!(item.platform || item.pa || item.kind === 'train' || item.kind === 'station' || item.kind === 'platform' || item.kind === 'escalator')) return null;
    const ja = item.parts.find(p => p.lang === 'ja'); if (!ja) return null;
    const text = spokenText(ja.say || ja.text, 'ja');
    return `vx:${hashText(text)}:${text}`;
  }
  _hallPlay(c, name, opts) {
    const buf = this.bank.peek(name); if (!buf) return null;
    this._vxTouch(name);
    return this.mixer.play(buf, { bus: 'voice', force: true, ...opts });
  }
  // keep the proxies of the last HALL_KEEP lines (requested or played); drop the rest so memory stays flat
  _vxTouch(name) {
    const k = this._vxKeep, i = k.indexOf(name); if (i >= 0) k.splice(i, 1); k.push(name);
    while (k.length > HALL_KEEP) this.bank.drop(k.shift());
  }
  // the real voice just started: the same line, into the reverb only
  _hall(c, p, vol) {
    if (c.hall || this.noHall) return;
    const name = this._hallName(c); if (!name) return;
    const g = (this.sys.profile === 'phone' ? HALL_GAIN_PHONE : HALL_GAIN) * Math.min(1, vol);
    c.hall = this._hallPlay(c, name, { gain: g, send: 1, wetOnly: true, lp: 3800 });
    if (c.hall) this.st.hall++;
  }
  _hallStop(c, tc = 0.35) { if (c && c.hall) { try { c.hall.stop(tc); } catch (e) { /* ended */ } c.hall = null; } }
  // iOS, a PA line you only overhear: the speakers in the hall, muffled by distance (no full-volume voice in your ear)
  _murmur(c, vol) {
    const name = this._hallName(c); if (!name) return false;
    const node = this._hallPlay(c, name, { gain: 0.55 * Math.min(1, vol / IOS_PA_NEAR), send: 1, lp: 1500 });
    if (!node) return false;
    this.st.murmur++; this._note(`murmur ${c.kind} vol=${vol.toFixed(2)}`);
    c.hall = node; c.step = c.parts.length; c.ending = true; c.wait = this.t + node.src.buffer.duration + 0.4;
    return true;
  }

  // v12 contract (lead -> analytics namba_pa). See notes/v12-pa.md.
  //   voices: getVoices().length · ja: the ja-JP voice picked (name) or null · unlocked: speech proven by an onstart/onend ·
  //   unlockVia: the gesture (touchend|click|keydown|pointerdown) or 'line'/'speaking' that proved it · attempts: unlock
  //   utterances spoken · tried / started / ended: PA utterances handed to speechSynthesis / that started / that ended ·
  //   noStart: utterances that never started (iOS drops them silently) · errors: distinct codes (max 8) · lastErr
  stats() {
    const s = this.st;
    return { voices: this.voiceCount, ja: this.voices.ja ? this.voices.ja.name : null, unlocked: !!this._unlocked, unlockVia: this.unlockVia,
      attempts: s.attempts, started: s.started, ended: s.ended, errors: s.errors.slice(), lastErr: s.lastErr, hall: s.hall, murmur: s.murmur,
      tried: s.tried, noStart: s.noStart, needsPrime: !!this._needsPrime, speech: !!this.speech };
  }
  debug() {
    return {
      voiceCount: this.voiceCount, ja: this.voices.ja ? `${this.voices.ja.name} (${this.voices.ja.lang})` : null, en: this.voices.en ? `${this.voices.en.name} (${this.voices.en.lang})` : null,
      useSpeech: this.useSpeech, stats: this.stats(), queue: this.queue.map(q => `${q.kind}:${q.parts[0].text.slice(0, 20)}`), cur: this.cur ? `${this.cur.kind}:${this.cur.parts[0].text.slice(0, 20)}` : null,
      last: this.last, log: this.log.slice(-8),
      duck: { amb: +this.duck.toFixed(3), sfx: +this.duckSfx.toFixed(3), ambDb: +(20 * Math.log10(this.duck)).toFixed(1),
        gains: this.mixer ? { ambience: +this.mixer.bus.ambience.dry.gain.value.toFixed(3), music: +this.mixer.bus.music.dry.gain.value.toFixed(3), sfx: +this.mixer.bus.sfx.dry.gain.value.toFixed(3) } : null },
    };
  }
}
export { PRIO, MIN_VOL, PA_DUCK };
