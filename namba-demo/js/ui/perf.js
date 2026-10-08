// =============================================================================
// Hidden performance overlay (v7).
//
//   Ctrl+Shift+F  (or F3)  toggle a small corner readout:
//     FPS (1 s average) . frame ms avg / p95 (last 2 s) . draw calls . triangles
//     . quality tier (+ dynamic-resolution scale) . visible level count
//   ?perf in the URL starts it on. Off by default.
//
// Cost when off: nothing. There is no per-frame hook and no DOM node until the
// first toggle; the frame meter is its own requestAnimationFrame loop that only
// exists while the overlay is on or a sample() is running. It measures the real
// rAF interval (the game loop clamps dt to 50 ms, so engine.stats.ms can hide
// long frames). It keeps running while the game is paused.
//
//   window.__namba.perf.sample(seconds = 3)  -> Promise<{ fps, avgMs, p95Ms, maxMs, frames, calls, tris,
//                                                          quality, drs, levels, visibleLevels, gpuMs }>
//   window.__namba.perf.snapshot()           -> the same numbers for the last 2 s, synchronously
//   window.__namba.perf.show(true|false)     -> toggle from code
// Draw calls / triangles are the main scene pass (engine.stats), the number the call budget is tuned against.
// The meter restarts when the tab is hidden / shown, so a backgrounded tab never pollutes the numbers.
// =============================================================================
import { params } from '../core/params.js';

const WINDOW = 2.0;         // seconds of history for avg / p95
const FPS_WINDOW = 1.0;     // seconds for the FPS average
const REFRESH = 0.5;        // overlay text refresh (s)

export class Perf {
  constructor(ctx) {
    this.ctx = ctx;
    this.on = false;
    this.el = null;
    this._raf = 0;
    this._last = 0;
    this._ts = [];           // frame end times (s)
    this._dt = [];           // frame intervals (ms)
    this._samplers = [];
    this._txtT = 0;
    this._key = (e) => this._onKey(e);
    addEventListener('keydown', this._key, true);
    document.addEventListener('visibilitychange', () => { this._last = 0; });
    if (params.has('perf')) this.show(true);
  }

  _onKey(e) {
    if (e.repeat) return;
    const t = e.target;
    const typing = !!(t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)));
    const combo = e.code === 'KeyF' && e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey;
    const f3 = e.code === 'F3' && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && !typing;
    if (!combo && !f3) return;
    e.preventDefault();
    this.show(!this.on);
  }

  show(v) {
    v = !!v;
    if (v === this.on) return this.on;
    this.on = v;
    if (v) {
      if (!this.el) this._build();
      this.el.style.display = 'block';
      this._txtT = 0;
      this._start();
      this._render();
    } else {
      if (this.el) this.el.style.display = 'none';
      this._stopIfIdle();
    }
    return this.on;
  }

  _build() {
    const el = this.el = document.createElement('div');
    el.id = 'perf-overlay';
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText = 'position:fixed;left:10px;top:' + (params.debug ? '92px' : '10px') + ';z-index:2147483000;display:none;pointer-events:none;' +
      'font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#cfe9d4;background:rgba(6,10,8,.58);' +
      'padding:5px 8px 6px;border-radius:5px;white-space:pre;letter-spacing:.01em;text-shadow:0 1px 1px rgba(0,0,0,.6);' +
      'font-variant-numeric:tabular-nums;user-select:none';
    document.body.appendChild(el);
  }

  // ---- frame meter ------------------------------------------------------------------
  _start() {
    if (this._raf) return;
    this._last = 0; this._ts.length = 0; this._dt.length = 0;
    const loop = (now) => {
      this._raf = requestAnimationFrame(loop);
      this._frame(now / 1000);
    };
    this._raf = requestAnimationFrame(loop);
  }
  _stopIfIdle() {
    if (this.on || this._samplers.length) return;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0; this._ts.length = 0; this._dt.length = 0;
  }
  _frame(t) {
    if (this._last) {
      const d = (t - this._last) * 1000;
      if (d < 120000) {
        this._ts.push(t); this._dt.push(d);
        for (const s of this._samplers) s.dts.push(d);
      }
    }
    this._last = t;
    const lim = t - WINDOW;
    let n = 0; while (n < this._ts.length && this._ts[n] < lim) n++;
    if (n > 0) { this._ts.splice(0, n); this._dt.splice(0, n); }
    // samplers: resolve when their time is up
    if (this._samplers.length) {
      for (let i = this._samplers.length - 1; i >= 0; i--) {
        const s = this._samplers[i];
        if ((t - s.t0 >= s.secs && s.dts.length >= 2) || t - s.t0 >= Math.max(120, s.secs * 4)) { this._samplers.splice(i, 1); s.done(this._stats(s.dts, null)); }
      }
      this._stopIfIdle();
    }
    if (this.on && t - this._txtT >= REFRESH) { this._txtT = t; this._render(); }
  }

  // ---- numbers ----------------------------------------------------------------------
  _stats(dts, fps) {
    const ctx = this.ctx, e = ctx.engine, st = e.stats;
    let avg = 0, max = 0, p95 = 0;
    if (dts.length) {
      for (const d of dts) { avg += d; if (d > max) max = d; }
      avg /= dts.length;
      const s = dts.slice().sort((a, b) => a - b);
      p95 = s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
    }
    if (fps == null) fps = avg ? 1000 / avg : 0;
    const vis = ctx.visibility && ctx.visibility.visibleLevels;
    return {
      fps: +fps.toFixed(1), avgMs: +avg.toFixed(2), p95Ms: +p95.toFixed(2), maxMs: +max.toFixed(2), frames: dts.length,
      calls: st.calls, tris: st.tris, quality: e.qualityName, drs: +(e.drs || 1).toFixed(2),
      levels: vis ? vis.size : null, visibleLevels: vis ? [...vis] : null, gpuMs: e.gpuTimerOK ? +(st.gpuMs || 0).toFixed(2) : null,
    };
  }
  snapshot() {
    // fps = 1 / mean frame interval over the last second (a frame slower than 1 s reports its own rate)
    const dts = this._dt, ts = this._ts, lim = this._last - FPS_WINDOW;
    let sum = 0, n = 0;
    for (let i = ts.length - 1; i >= 0 && ts[i] >= lim; i--) { sum += dts[i]; n++; }
    const fps = n ? 1000 / (sum / n) : dts.length ? 1000 / dts[dts.length - 1] : 0;
    return this._stats(dts, fps);
  }
  // measure for `seconds` of real time; resolves with the numbers (works whether or not the overlay is on)
  sample(seconds = 3) {
    return new Promise((resolve) => {
      this._samplers.push({ secs: Math.max(0.1, +seconds || 3), t0: performance.now() / 1000, dts: [], done: resolve });
      this._start();
    });
  }

  _render() {
    if (!this.el) return;
    const s = this.snapshot();
    const k = (v) => v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(0) + 'k' : String(v);
    this.el.textContent =
      `${(s.fps < 10 ? s.fps.toFixed(1) : s.fps.toFixed(0)).padStart(3)} fps   ${s.avgMs.toFixed(1)} ms avg   ${s.p95Ms.toFixed(1)} ms p95\n` +
      `${s.calls} calls   ${k(s.tris)} tris\n` +
      `${s.quality}${s.drs < 0.995 ? ' @' + s.drs.toFixed(2) : ''}   levels ${s.levels == null ? '-' : s.levels}` +
      (s.gpuMs != null ? `   gpu ${s.gpuMs.toFixed(1)} ms` : '');
  }
}
