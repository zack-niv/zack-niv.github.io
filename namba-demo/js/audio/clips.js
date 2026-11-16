// =============================================================================
// ClipBank (v20): recorded audio files, fetched and decoded on demand.
//
// v20 removed speechSynthesis for good (on iPhone it silenced Web Audio and the page died a few minutes later). Every spoken
// line is now a recorded file played through Web Audio, and the crowd murmur is three field-recorded loops. Both live under
// assets/audio/ and are described by assets/audio/manifest.json:
//   { v, voice: { <voiceKey>: { f: ['voice/<key>.mp3', ...variants], d: seconds } },
//     loops: { crowd_food | crowd_arcade | crowd_station: { st, mono, d, pad } } }
//   * voice keys come from phrases.js voiceKey(japanese text); `f` lists variants of the same line in different voices.
//   * a loop file is pad + d + pad seconds long and periodic with period d over the whole file: play it with loop = true,
//     loopStart = pad, loopEnd = pad + d from offset pad + x. The seam is then exact whatever delay the MP3 decoder adds.
// Decoded voice clips sit in an LRU (6 on the phone profile, 12 elsewhere). Loops are held until dropLoop().
// ?noclips (opts.off): the manifest stays empty and nothing is ever fetched (a diagnostic switch).
// =============================================================================
const BASE = new URL('../../assets/audio/', import.meta.url);
// the deploy stamp (?v=<hash>) of this very module busts the browser cache of every asset too
let STAMP = '';
try { STAMP = new URL(import.meta.url).searchParams.get('v') || ''; } catch (e) { STAMP = ''; }
const MAX_FLIGHT = 2;          // fetch + decode jobs in flight at once (decoded audio is big; the phone is small)
const RETRY_S = 20;            // a failed clip may be asked for again after this long

const bytesOf = (b) => (b ? b.length * b.numberOfChannels * 4 : 0);
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class ClipBank {
  constructor(ac, { profile = 'desktop', off = false } = {}) {
    this.ac = ac; this.profile = profile; this.off = !!off;
    this.keep = profile === 'phone' ? 6 : 12;
    this.m = this.off ? { voice: {}, loops: {} } : null;   // null while the manifest is loading
    this.mState = this.off ? 'off' : 'idle';               // idle | loading | ready | failed | off
    this.ent = new Map();      // `${key}#${variant}` -> { key, v, state, buf, use, err, errAt }
    this.loops = new Map();    // name -> { name, state, buf, pad, d, mono, err, errAt, dropped }
    this.queue = [];           // jobs waiting for a slot: { kind: 'voice' | 'loop', id }
    this.inflight = 0; this.useN = 0; this.disposed = false;
    this.early = [];           // [key, variant] asked for before the manifest arrived
    this.earlyLoops = [];
    this.s = { loads: 0, miss: 0, err: 0, lastMs: 0 };
    this.aborts = new Set();
    this.ready = Promise.resolve(false);
  }

  // ---- manifest -----------------------------------------------------------------------------------------------------
  loadManifest() {
    if (this.disposed || this.off || this.mState !== 'idle') return this.ready;
    this.mState = 'loading';
    this.ready = this._fetch('manifest.json', 'json').then((j) => {
      if (this.disposed) return false;
      const ok = j && typeof j === 'object';
      this.m = { voice: (ok && j.voice && typeof j.voice === 'object') ? j.voice : {}, loops: (ok && j.loops && typeof j.loops === 'object') ? j.loops : {} };
      this.mState = ok ? 'ready' : 'failed';
      if (!ok) this.s.err++;
      const e = this.early.splice(0), el = this.earlyLoops.splice(0);
      for (const [k, v] of e) this.want(k, v);
      for (const n of el) this.wantLoop(n);
      return ok;
    }).catch(() => {
      if (this.disposed) return false;
      this.m = { voice: {}, loops: {} }; this.mState = 'failed'; this.s.err++;
      this.early.length = 0; this.earlyLoops.length = 0;
      return false;
    });
    return this.ready;
  }
  // true when recorded voice can be expected: the manifest is still coming, or it lists voice clips
  get available() { return !this.disposed && !this.off && (this.mState === 'idle' || this.mState === 'loading' || (!!this.m && Object.keys(this.m.voice).length > 0)); }
  get manifestState() { return this.mState; }

  _url(rel) { return new URL(rel, BASE).href + (STAMP ? '?v=' + STAMP : ''); }
  async _fetch(rel, type) {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    if (ctl) this.aborts.add(ctl);
    try {
      const r = await fetch(this._url(rel), ctl ? { signal: ctl.signal } : undefined);
      if (!r.ok) throw new Error('http-' + r.status);
      return type === 'json' ? await r.json() : await r.arrayBuffer();
    } finally { if (ctl) this.aborts.delete(ctl); }
  }
  // callback form wrapped in a promise (older Safari has no promise form); the returned promise of newer engines also rejects on
  // failure, which would be an unhandled rejection next to our own handler, so it is swallowed
  _decode(ab) {
    return new Promise((resolve, reject) => {
      try {
        const p = this.ac.decodeAudioData(ab, resolve, (e) => reject(e || new Error('decode')));
        if (p && typeof p.then === 'function') p.then(() => {}, () => {});
      } catch (e) { reject(e); }
    });
  }

  // ---- voice --------------------------------------------------------------------------------------------------------
  has(key) { return !!(this.m && this.m.voice[key]); }
  // number of recorded variants of a line (0 when it is not in the manifest)
  variants(key) { const e = this.m && this.m.voice[key]; return e && Array.isArray(e.f) ? e.f.length : 0; }
  // seconds the recording runs (manifest `d`), or 0
  duration(key) { const e = this.m && this.m.voice[key]; return e && +e.d > 0 ? +e.d : 0; }
  _id(key, v) { return key + '#' + (v | 0); }
  // 'missing' | 'idle' | 'loading' | 'ready' | 'error'. While the manifest is still coming a key is 'loading' (it may yet exist).
  state(key, v = 0) {
    if (this.disposed) return 'missing';
    if (!this.m) return 'loading';
    const f = this.m.voice[key];
    if (!f || !Array.isArray(f.f) || !f.f[(v | 0) % f.f.length]) return 'missing';
    const e = this.ent.get(this._id(key, (v | 0) % f.f.length));
    return e ? e.state : 'idle';
  }
  errorOf(key, v = 0) { const f = this.m && this.m.voice[key]; const e = f && this.ent.get(this._id(key, (v | 0) % (f.f.length || 1))); return e ? e.err || 'error' : null; }
  peek(key, v = 0) {
    const f = this.m && this.m.voice[key]; if (!f || !f.f || !f.f.length) return null;
    const e = this.ent.get(this._id(key, (v | 0) % f.f.length));
    if (!e || e.state !== 'ready') return null;
    e.use = ++this.useN;
    return e.buf;
  }
  // start fetching + decoding (deduped); returns the state
  want(key, v = 0) {
    if (this.disposed) return 'missing';
    if (!this.m) { if (!this.early.some((x) => x[0] === key && x[1] === v)) this.early.push([key, v]); return 'loading'; }
    const f = this.m.voice[key];
    if (!f || !Array.isArray(f.f) || !f.f.length) { this.s.miss++; return 'missing'; }
    const vv = (v | 0) % f.f.length, id = this._id(key, vv);
    let e = this.ent.get(id);
    if (e) {
      if (e.state === 'ready') { e.use = ++this.useN; return 'ready'; }
      if (e.state === 'loading') return 'loading';
      if (e.state === 'error' && nowMs() - e.errAt < RETRY_S * 1000) return 'error';
    }
    e = { key, v: vv, id, state: 'loading', buf: null, use: ++this.useN, err: null, errAt: 0, file: f.f[vv] };
    this.ent.set(id, e);
    this.queue.push({ kind: 'voice', id });
    this._pump();
    return 'loading';
  }
  _evict() {
    let ready = 0; for (const e of this.ent.values()) if (e.state === 'ready') ready++;
    while (ready > this.keep) {
      let old = null; for (const e of this.ent.values()) if (e.state === 'ready' && (!old || e.use < old.use)) old = e;
      if (!old) break;
      this.ent.delete(old.id); ready--;
    }
  }

  // ---- loops --------------------------------------------------------------------------------------------------------
  wantLoop(name) {
    if (this.disposed) return 'missing';
    if (!this.m) { if (!this.earlyLoops.includes(name)) this.earlyLoops.push(name); return 'loading'; }
    const d = this.m.loops[name];
    if (!d) { this.s.miss++; return 'missing'; }
    let L = this.loops.get(name);
    if (L) {
      if (L.state === 'ready' || L.state === 'loading') return L.state;
      if (L.state === 'error' && nowMs() - L.errAt < RETRY_S * 1000) return 'error';
    }
    // the mono file on the phone profile, the stereo one elsewhere (either one stands in when the other is not listed)
    const mono = this.profile === 'phone' ? !!d.mono || !d.st : !d.st && !!d.mono;
    const file = mono ? d.mono : d.st;
    if (!file) { this.s.miss++; return 'missing'; }
    L = { name, state: 'loading', buf: null, pad: +d.pad || 0, d: +d.d || 0, mono, err: null, errAt: 0, file, dropped: false };
    this.loops.set(name, L);
    this.queue.push({ kind: 'loop', id: name, ref: L });
    this._pump();
    return 'loading';
  }
  // { buf, pad, d, mono } once decoded, else null. Loop with loopStart = pad, loopEnd = pad + d, start offset pad + x.
  peekLoop(name) { const L = this.loops.get(name); return L && L.state === 'ready' ? { buf: L.buf, pad: L.pad, d: L.d, mono: L.mono } : null; }
  loopState(name) { if (!this.m) return 'loading'; if (!this.m.loops[name]) return 'missing'; const L = this.loops.get(name); return L ? L.state : 'idle'; }
  dropLoop(name) { const L = this.loops.get(name); if (!L) return; L.dropped = true; L.buf = null; this.loops.delete(name); }

  // ---- loading ------------------------------------------------------------------------------------------------------
  _pump() {
    while (this.inflight < MAX_FLIGHT && this.queue.length && !this.disposed) {
      const j = this.queue.shift();
      const rec = j.kind === 'voice' ? this.ent.get(j.id) : j.ref;
      if (!rec || rec.state !== 'loading' || (j.kind === 'loop' && rec.dropped)) continue;
      this.inflight++;
      this._load(j.kind, rec).finally(() => { this.inflight--; this._pump(); });
    }
  }
  async _load(kind, rec) {
    const t0 = nowMs();
    try {
      const ab = await this._fetch(rec.file, 'buf');
      if (this.disposed) return;
      const buf = await this._decode(ab);
      if (this.disposed) return;
      if (kind === 'loop' && rec.dropped) return;
      if (kind === 'voice' && this.ent.get(rec.id) !== rec) return;
      rec.buf = buf; rec.state = 'ready';
      this.s.loads++; this.s.lastMs = Math.round(nowMs() - t0);
      if (kind === 'voice') this._evict();
    } catch (e) {
      if (this.disposed) return;
      rec.state = 'error'; rec.errAt = nowMs();
      const m = String((e && e.message) || e || 'error');
      rec.err = /^http-/.test(m) ? m : (e && e.name === 'AbortError' ? 'abort' : /decode|EncodingError/i.test(String(e && e.name) + m) ? 'decode' : 'fetch');
      this.s.err++;
    }
  }

  // { n: decoded clips (voice + loops), mb: decoded megabytes (length x channels x 4 bytes), loads, miss, err, lastMs }
  stats() {
    let n = 0, b = 0;
    for (const e of this.ent.values()) if (e.state === 'ready') { n++; b += bytesOf(e.buf); }
    for (const L of this.loops.values()) if (L.state === 'ready') { n++; b += bytesOf(L.buf); }
    return { n, mb: +(b / 1048576).toFixed(1), loads: this.s.loads, miss: this.s.miss, err: this.s.err, lastMs: this.s.lastMs };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const c of this.aborts) { try { c.abort(); } catch (e) { /* done */ } }
    this.aborts.clear();
    this.ent.clear(); this.loops.clear(); this.queue.length = 0; this.early.length = 0; this.earlyLoops.length = 0;
    this.m = { voice: {}, loops: {} };
  }
}
