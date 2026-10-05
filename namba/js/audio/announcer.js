// =============================================================================
// Announcer: station PA, escalator loops, shop greetings.
//
// Voices: SpeechSynthesis ja-JP / en-US when such voices exist (global, not
// routable into Web Audio — so we frame it with a PA chime and duck the
// ambience, and set its volume by proximity). Otherwise a formant "PA voice"
// rendered by the worker from kana readings, routed through the PA chain:
// band-limited horn + room reverb, diffuse (station-wide speakers) or
// positional (escalator speaker). There is never a silent gap: if speech
// fails or never starts, the formant voice plays instead.
//
// Sequencing runs off AudioContext time in update(), so it also works in an
// OfflineAudioContext test render.
// =============================================================================
import { toReading } from './phrases.js';

const PRIO = { train: 0, station: 1, escalator: 3, shop: 4, ambient: 5 };

export class Announcer {
  constructor(sys) {
    this.sys = sys; this.mixer = sys.mixer; this.bank = sys.bank; this.ac = sys.mixer.ac;
    this.queue = []; this.cur = null; this.seq = 0;
    this.speech = (sys.allowSpeech && typeof speechSynthesis !== 'undefined') ? speechSynthesis : null;
    this.voices = { ja: null, en: null };
    this.useSpeech = true;
    if (this.speech) {
      const pick = () => {
        const vs = this.speech.getVoices() || [];
        const by = (lang, prefs) => {
          const c = vs.filter(v => (v.lang || '').replace('_', '-').toLowerCase().startsWith(lang));
          for (const p of prefs) { const v = c.find(v => p.test(v.name)); if (v) return v; }
          return c[0] || null;
        };
        this.voices.ja = by('ja', [/Kyoko|O-ren|Nanami|Haruka|Ayumi|Google 日本語|Mizuki|Sayaka/i]);
        this.voices.en = by('en-us', [/Samantha|Aria|Jenny|Zira|Google US English|Allison|Ava|Susan/i]) || by('en', [/Female|Serena|Karen|Moira|Tessa|Google UK English Female/i]);
      };
      pick();
      try { this.speech.addEventListener('voiceschanged', pick); } catch (e) { this.speech.onvoiceschanged = pick; }
    }
    this.duck = 1;
  }
  get hasJaVoice() { return !!(this.speech && this.voices.ja); }

  // item: { kind, prio?, parts:[{lang, text}], chime?: 'pa'|'esc'|null, pos?:{x,y,z}, level?, gain?, caption?:bool,
  //         diffuse?:bool, lp?:number, speech?:bool, seed? }
  say(item) {
    item.prio = item.prio ?? PRIO[item.kind] ?? 3;
    item.id = ++this.seq;
    // drop duplicates of the same kind+text already waiting
    const key = item.parts.map(p => p.text).join('|');
    if (this.queue.some(q => q._key === key) || (this.cur && this.cur._key === key)) return null;
    item._key = key;
    // pre-render the fallback voice
    for (const p of item.parts) if (!this._canSpeak(item, p)) this.bank.get(this._voiceName(item, p), item.prio <= 1 ? 1 : 4);
    if (item.chime) this.bank.get('chime:' + item.chime, 2);
    if (this.cur && item.prio < this.cur.prio && item.prio <= 1) this._interrupt();
    this.queue.push(item);
    this.queue.sort((a, b) => a.prio - b.prio || a.id - b.id);
    // ambient/escalator lines should not pile up
    while (this.queue.length > 6) this.queue.pop();
    return item.id;
  }
  // render fallback voices ahead of time (no-op when TTS will be used)
  prefetch(parts, seed = 3) {
    for (const p of parts) if (!this._canSpeak({}, p)) this.bank.get(this._voiceName({ seed }, p), 5);
  }
  busyWith(kind) { return (this.cur && this.cur.kind === kind) || this.queue.some(q => q.kind === kind); }
  cancelKind(kind) { this.queue = this.queue.filter(q => q.kind !== kind); if (this.cur && this.cur.kind === kind) this._interrupt(); }

  _voiceName(item, p) {
    const text = p.lang === 'ja' ? toReading(p.text) : p.text;
    return `voice:${p.lang}:${item.gender || 'f'}:${item.seed || 3}:${text}`;
  }
  _canSpeak(item, p) { return !!(this.useSpeech && item.speech !== false && this.speech && this.voices[p.lang]); }

  _interrupt() {
    const c = this.cur; if (!c) return;
    if (c.utter && this.speech) try { this.speech.cancel(); } catch (e) { /* */ }
    if (c.node) c.node.stop(0.08);
    this.cur = null;
    this._setDuck(1);
  }
  _setDuck(v) {
    if (v === this.duck) return;
    this.duck = v;
    const t = this.ac.currentTime;
    for (const b of ['ambience', 'music']) this.mixer.bus[b].dry.gain.setTargetAtTime(v, t, v < 1 ? 0.25 : 0.8);
  }

  update() {
    const now = this.ac.currentTime;
    if (!this.cur && this.queue.length) this._start(this.queue.shift(), now);
    const c = this.cur;
    if (!c) return;
    if (c.waitUntil > now) return;
    // utterance in flight: wait for onend (with a generous timeout → fallback)
    if (c.utter) {
      if (c.utterDone) { c.utter = null; c.step++; c.waitUntil = now + 0.25; }
      else if (!c.utterStarted && now > c.utterDeadline) { // never started: speak with the formant voice instead
        try { this.speech.cancel(); } catch (e) { /* */ }
        c.utter = null; c.forceFormant = true;
      } else if (now > c.utterHard) { try { this.speech.cancel(); } catch (e) { /* */ } c.utter = null; c.step++; }
      else return;
    }
    if (c.step >= c.parts.length) {
      if (!c.ending) { c.ending = true; c.waitUntil = now + 0.6; return; }
      this.cur = null; this._setDuck(1);
      return;
    }
    const p = c.parts[c.step];
    if (!c.forceFormant && this._canSpeak(c, p)) {
      const u = new SpeechSynthesisUtterance(p.text);
      u.voice = this.voices[p.lang]; u.lang = p.lang === 'ja' ? 'ja-JP' : (this.voices.en && this.voices.en.lang) || 'en-US';
      u.rate = p.lang === 'ja' ? 1.0 : 0.95; u.pitch = p.lang === 'ja' ? 1.15 : 1.08;
      // TTS can't be spatialised: scale its volume by distance to the speaker
      let att = 1;
      if (c.pos) { const lp = this.mixer._lp; const d = Math.hypot(c.pos.x - lp.x, c.pos.y - lp.y, c.pos.z - lp.z); att = Math.min(1, (c.ref ?? 2.5) / Math.max(0.5, d)) * 1.6; }
      u.volume = Math.max(0.03, Math.min(1, (c.gain ?? 1) * att * this.mixer.volumes.voice * this.mixer.volumes.master));
      u.onstart = () => { c.utterStarted = true; };
      u.onend = u.onerror = () => { c.utterDone = true; };
      c.utter = u; c.utterStarted = false; c.utterDone = false;
      c.utterDeadline = now + 1.5; c.utterHard = now + 4 + p.text.length * 0.25;
      try { this.speech.speak(u); } catch (e) { c.forceFormant = true; c.utter = null; }
      return;
    }
    c.forceFormant = false;
    const name = this._voiceName(c, p);
    const buf = this.bank.peek(name);
    if (!buf) {
      this.bank.get(name, 1);
      if (!c.waitStart) c.waitStart = now;
      if (now - c.waitStart > 8) { c.step++; c.waitStart = 0; } // give up on this part
      return;
    }
    c.waitStart = 0;
    c.node = this._route(c, buf, now);
    c.step++;
    c.waitUntil = now + buf.duration + 0.35;
  }

  _start(item, now) {
    this.cur = item;
    item.step = 0; item.waitUntil = now;
    if (item.kind !== 'ambient' && item.kind !== 'shop') this._setDuck(item.prio <= 1 ? 0.55 : 0.8);
    if (item.chime) {
      const cb = this.bank.peek('chime:' + item.chime);
      if (cb) { this._route(item, cb, now, true); item.waitUntil = now + (item.chime === 'esc' ? 0.9 : 1.55); }
    }
    if (item.caption !== false) {
      const en = item.parts.find(p => p.lang === 'en'), ja = item.parts.find(p => p.lang === 'ja');
      const dur = item.parts.reduce((a, p) => a + (p.lang === 'ja' ? p.text.length * 0.16 : p.text.length * 0.065), 1.5);
      this.sys.ctx.events.emit('caption', { text: en ? en.text : (ja ? ja.text : ''), en: en ? en.text : '', ja: ja ? ja.text : '', kind: item.kind, speaker: item.speaker || 'PA', duration: dur, distant: !!item.distant });
    }
  }
  // play a buffer through the PA path for this item
  _route(item, buf, when, isChime = false) {
    const g = (item.gain ?? 1) * (isChime ? 0.55 : 1);
    if (item.pos) {
      return this.mixer.play(buf, { bus: 'voice', pos: item.pos, gain: g * 1.4, send: item.send ?? 0.5, ref: item.ref ?? 2.5, lp: item.lp, when, hrtf: false, force: true });
    }
    // diffuse: station-wide ceiling speakers — mostly reverberant, slight stereo spread
    return this.mixer.play(buf, { bus: 'voice', gain: g, send: item.send ?? 0.9, lp: item.lp, when, pan: (item.id % 3 - 1) * 0.15, force: true });
  }
}
export { PRIO };
