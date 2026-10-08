// =============================================================================
// Buffer bank: AudioBuffers synthesized on demand by a module worker (falls
// back to main-thread synthesis, yielding between jobs). Cached by recipe name.
// Priority queue so what the player hears first is rendered first.
// =============================================================================
export class Bank {
  constructor(ac, { useWorker = true } = {}) {
    this.ac = ac;
    this.cache = new Map();     // name -> AudioBuffer
    this.pending = new Map();   // name -> { promise, resolve, reject, prio }
    this.queue = [];            // names waiting (main-thread mode) or not yet posted
    this.inflight = 0;
    this.maxInflight = 2;
    this.stats = { jobs: 0, ms: 0, bytes: 0, errors: [] };
    this.worker = null;
    if (useWorker && typeof Worker !== 'undefined') {
      try {
        this.worker = new Worker(new URL('./worker.js?v=488c31e', import.meta.url), { type: 'module' });
        this.worker.onmessage = (e) => this._onResult(e.data);
        this.worker.onerror = (e) => { console.warn('[audio] synthesis worker failed, using main thread', e.message || e); this.worker = null; this.inflight = 0; this._pump(); };
      } catch (e) { this.worker = null; }
    }
    this._id = 0;
    this._names = new Map(); // id -> name
  }
  has(name) { return this.cache.has(name); }
  peek(name) { return this.cache.get(name) || null; }
  // request (if needed) and return a promise of the AudioBuffer
  get(name, prio = 5) {
    const c = this.cache.get(name);
    if (c) return Promise.resolve(c);
    let p = this.pending.get(name);
    if (p) { if (prio < p.prio) { p.prio = prio; this._sortQueue(); } return p.promise; }
    p = { prio };
    p.promise = new Promise((res, rej) => { p.resolve = res; p.reject = rej; });
    p.promise.catch(() => {});
    this.pending.set(name, p);
    this.queue.push(name);
    this._sortQueue();
    this._pump();
    return p.promise;
  }
  // fire-and-forget prefetch
  want(names, prio = 8) { for (const n of names) this.get(n, prio); }
  _sortQueue() { this.queue.sort((a, b) => (this.pending.get(a)?.prio ?? 9) - (this.pending.get(b)?.prio ?? 9)); }
  _pump() {
    while (this.inflight < (this.worker ? this.maxInflight : 1) && this.queue.length) {
      const name = this.queue.shift();
      if (!this.pending.has(name)) continue;
      this.inflight++;
      if (this.worker) {
        const id = ++this._id; this._names.set(id, name);
        this.worker.postMessage({ id, name, base: this.ac.sampleRate });
      } else {
        // main thread: run in a macrotask so we never block a frame for long
        setTimeout(() => this._runLocal(name), 0);
      }
    }
  }
  async _runLocal(name) {
    try {
      if (!this._recipes) this._recipes = await import('./recipes.js?v=488c31e');
      const t0 = performance.now();
      const res = this._recipes.synthesize(name, this.ac.sampleRate);
      this._finish(name, res.channels, res.sampleRate, performance.now() - t0);
    } catch (e) { this._fail(name, e); }
    this.inflight--; this._pump();
  }
  _onResult(d) {
    const name = this._names.get(d.id); this._names.delete(d.id);
    this.inflight--;
    if (d.ok) this._finish(name, d.channels, d.sampleRate, d.ms); else this._fail(name, new Error(d.error));
    this._pump();
  }
  _finish(name, channels, sampleRate, ms) {
    const p = this.pending.get(name);
    this.pending.delete(name);
    try {
      const buf = this.ac.createBuffer(channels.length, channels[0].length, sampleRate);
      channels.forEach((c, i) => buf.copyToChannel(c, i));
      this.cache.set(name, buf);
      this.stats.jobs++; this.stats.ms += ms || 0; this.stats.bytes += channels.length * channels[0].length * 4;
      if (p) p.resolve(buf);
    } catch (e) { this._fail(name, e, p); }
  }
  _fail(name, e, p = this.pending.get(name)) {
    this.pending.delete(name);
    this.stats.errors.push(`${name}: ${e.message}`);
    console.warn('[audio] synthesis failed', name, e.message);
    if (p) p.reject(e);
  }
  drop(name) { this.cache.delete(name); }
  dispose() { if (this.worker) this.worker.terminate(); }
}
