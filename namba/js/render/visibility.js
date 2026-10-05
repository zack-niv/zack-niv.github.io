// =============================================================================
// Visibility & performance governor.
//
// * Level roots: own level ±1 by default; every Parks level (1F–8F) when in the
//   Parks / outdoors (terraces, canyon and bridges see each other); street
//   levels when standing in a stair well. Levels are derived from the layout:
//   a level is "linked" to the player's when a void, ramp or outdoor cell
//   connects them within sight distance.
// * Chunk groups (userData.chunk = {level,x,z,r}): hidden beyond the draw
//   distance (own level) or a shorter distance (other levels). three.js does
//   per-mesh frustum culling below that.
// * Dynamic resolution: GPU timer queries (EXT_disjoint_timer_query_webgl2)
//   when available, else frame time → engine.setDRS().
// * Auto quality: when no ?quality= was given, a short benchmark after start
//   steps the tier down if even the minimum resolution can't hold ~50 fps.
// * ?debug: renderer.info overlay (calls, tris, programs, textures, DRS, GPU ms, EV).
// =============================================================================
import { LEVELS, LEVEL_ORDER } from '../world/layout.js';
import { CELL } from '../world/world.js';
import { params } from '../core/params.js';
import { QUALITY_ORDER } from '../core/engine.js';

export class Visibility {
  constructor(ctx) {
    this.ctx = ctx;
    ctx.engine.ctx = ctx;
    this.frameMs = 16.7; this.gpuMs = 0;
    this._last = performance.now();
    this._slow = 0; this._fast = 0; this._drsCool = 0;
    this._bench = null;
    this.visibleLevels = new Set();
  }

  init() {
    const { engine, world } = this.ctx;
    // chunk lists per level
    this.chunks = {};
    this._collect();
    // open cells per level (voids/ramps) for the multi-level rule
    this.openCells = {};
    for (const lv of LEVEL_ORDER) {
      const g = world.grids[lv]; if (!g) continue;
      const pts = [];
      for (let cz = 0; cz < g.h; cz += 2) for (let cx = 0; cx < g.w; cx += 2) {
        const t = g.type[cz * g.w + cx];
        if (t === CELL.VOID || t === CELL.RAMP) pts.push(g.x0 + cx + 0.5, g.z0 + cz + 0.5);
      }
      this.openCells[lv] = pts;
    }
    // GPU timer
    const gl = engine.renderer.getContext();
    this.gl = gl;
    this.timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this._q = null;
    if (params.debug) this._debugEl();
    this.drsEnabled = !params.test || params.has('drs');
    this.autoQuality = !engine.qualityForced && !params.test;
  }

  _collect() {
    const { engine } = this.ctx;
    this.chunks = {};
    let n = 0;
    for (const lv of LEVEL_ORDER) {
      const root = engine.levelRoot(lv); if (!root) continue;
      const list = [];
      root.traverse(o => { if (o !== root && o.userData && o.userData.chunk) list.push(o); });
      this.chunks[lv] = list; n += list.length;
    }
    this._nChunks = n;
    this._collectT = 2;
  }

  _linkedLevels(b) {
    const { world, lighting } = this.ctx;
    const set = new Set();
    const i = LEVEL_ORDER.indexOf(b.level);
    set.add(b.level);
    if (i > 0) set.add(LEVEL_ORDER[i - 1]);
    if (i < LEVEL_ORDER.length - 1) set.add(LEVEL_ORDER[i + 1]);
    const sp = world.spaceAt(b.level, b.x, b.z);
    const zone = sp ? sp.zone : (this.ctx.player && this.ctx.player.zone);
    const s = lighting && lighting.baked ? lighting.sample(b.level, b.x, b.z) : null;
    const outdoor = (sp && sp.outdoor) || (s && s.sky > 0.45);
    if (zone === 'parks' || zone === 'parksGarden' || (outdoor && LEVELS[b.level].y >= 6)) {
      for (const lv of LEVEL_ORDER) if (LEVELS[lv].y >= 0) set.add(lv);
    }
    // near an atrium void / escalator well: two levels away is visible too
    const pts = this.openCells[b.level];
    if (pts) {
      for (let k = 0; k < pts.length; k += 2) {
        const dx = pts[k] - b.x, dz = pts[k + 1] - b.z;
        if (dx * dx + dz * dz < 30 * 30) {
          if (i > 1) set.add(LEVEL_ORDER[i - 2]);
          if (i < LEVEL_ORDER.length - 2) set.add(LEVEL_ORDER[i + 2]);
          break;
        }
      }
    }
    return set;
  }

  update(dt) {
    const { engine, player } = this.ctx;
    if (!player) return;
    // pick up chunk groups added late (live systems)
    if ((this._collectT -= dt) <= 0) { this._collectT = 3; this._collect(); }
    const b = player.body;
    const cam = engine.camera.position;
    const vis = this._linkedLevels(b);
    this.visibleLevels = vis;
    const dd = engine.quality.drawDist;
    const ownD = dd, otherD = dd * 0.55;
    let shown = 0;
    for (const lv of LEVEL_ORDER) {
      const root = engine.levelRoot(lv); if (!root) continue;
      const on = vis.has(lv);
      root.visible = on;
      if (!on) continue;
      const lim = lv === b.level ? ownD : otherD;
      const ly = LEVELS[lv].y;
      for (const g of this.chunks[lv] || []) {
        const c = g.userData.chunk;
        const dx = c.x - cam.x, dz = c.z - cam.z, dy = (ly + 2) - cam.y;
        const d = Math.sqrt(dx * dx + dz * dz + dy * dy) - (c.r || 40);
        g.visible = d < lim;
        if (g.visible) shown++;
      }
    }
    this.shownChunks = shown;
    this._perf(dt);
  }

  // ---- performance governor ------------------------------------------------
  _perf() {
    const now = performance.now();
    const ms = Math.min(100, now - this._last); this._last = now;
    this.frameMs += (ms - this.frameMs) * 0.05;
    this._pollTimer();
    const { engine } = this.ctx;
    if (this.drsEnabled && this.ctx.started) {
      this._drsCool -= ms / 1000;
      const gpu = this.timer && this.gpuMs > 0 ? this.gpuMs : null;
      const over = gpu != null ? gpu > 13.5 : this.frameMs > 18.2;
      const under = gpu != null ? gpu < 9.5 : this.frameMs < 16.9;
      if (over) { this._slow += ms; this._fast = 0; } else if (under) { this._fast += ms; this._slow = 0; } else { this._slow = 0; this._fast = 0; }
      if (this._drsCool <= 0) {
        if (this._slow > 700) { engine.setDRS(engine.drs - 0.06); this._drsCool = 1.0; this._slow = 0; }
        else if (this._fast > (gpu != null ? 1500 : 4000) && engine.drs < 1) { engine.setDRS(engine.drs + 0.05); this._drsCool = gpu != null ? 1.0 : 3.0; this._fast = 0; }
      }
    }
    // auto quality: benchmark seconds 1.5..5.5 after start, then again once
    if (this.autoQuality && this.ctx.started) {
      if (!this._bench) this._bench = { t: 0, sum: 0, n: 0, rounds: 0 };
      const B = this._bench;
      B.t += ms / 1000;
      if (B.t > 1.5) { B.sum += ms; B.n++; }
      if (B.t > 5.5 && B.n > 30) {
        const avg = B.sum / B.n;
        const atMin = engine.drs <= (engine.quality.drsMin || 0.6) + 0.01;
        const i = QUALITY_ORDER.indexOf(engine.qualityName);
        if (avg > 24 && i > 0 && (atMin || avg > 34)) {
          console.log(`[render] auto quality: ${avg.toFixed(1)} ms/frame → ${QUALITY_ORDER[i - 1]}`);
          engine.setQuality(QUALITY_ORDER[i - 1]);
        }
        B.rounds++; B.t = 0; B.sum = 0; B.n = 0;
        if (B.rounds >= 3) this.autoQuality = false;
      }
    }
  }

  // GPU time of the previous frames (wraps engine.render via lateUpdate/afterRender)
  lateUpdate() {
    if (!this.timer || this._q) return;
    const gl = this.gl;
    this._q = gl.createQuery();
    gl.beginQuery(this.timer.TIME_ELAPSED_EXT, this._q);
    this._qOpen = true;
    // end the query right after the frame is rendered
    requestAnimationFrame(() => { if (this._qOpen) { gl.endQuery(this.timer.TIME_ELAPSED_EXT); this._qOpen = false; } });
  }
  _pollTimer() {
    if (!this._q || this._qOpen) return;
    const gl = this.gl;
    const avail = gl.getQueryParameter(this._q, gl.QUERY_RESULT_AVAILABLE);
    const disjoint = gl.getParameter(this.timer.GPU_DISJOINT_EXT);
    if (avail || disjoint) {
      if (avail && !disjoint) {
        const ns = gl.getQueryParameter(this._q, gl.QUERY_RESULT);
        this.gpuMs += (ns / 1e6 - this.gpuMs) * 0.2;
        this.ctx.engine.stats.gpuMs = this.gpuMs;
      }
      gl.deleteQuery(this._q); this._q = null;
    }
  }

  _debugEl() {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;right:8px;top:8px;font:11px/1.35 ui-monospace,monospace;color:#9cf;background:rgba(0,0,0,.6);padding:6px 8px;z-index:99;white-space:pre;pointer-events:none';
    document.body.appendChild(el);
    setInterval(() => {
      const { engine, lighting, post } = this.ctx;
      const i = engine.renderer.info;
      el.textContent =
        `RENDER ${engine.qualityName}  drs ${engine.drs.toFixed(2)}  frame ${this.frameMs.toFixed(1)}ms  gpu ${this.timer ? this.gpuMs.toFixed(1) + 'ms' : 'n/a'}\n` +
        `scene calls ${engine.stats.calls}  tris ${(engine.stats.tris / 1000).toFixed(0)}k  progs ${i.programs ? i.programs.length : '?'}  tex ${i.memory.textures}  geo ${i.memory.geometries}\n` +
        `levels ${[...this.visibleLevels].join(',')}  chunks ${this.shownChunks}/${this._nChunks}\n` +
        (lighting ? `mood ${lighting.mood}  fixtures ${lighting.stats.lights} (${lighting.stats.fallback} fallback)  atlas ${lighting.stats.atlas}  bake ${lighting.stats.bakeMs}ms\n` : '') +
        (post ? `EV ${post.ev.toFixed(2)} → ${post.evTarget.toFixed(2)}  post ${post.enabled ? post.costModel() : 'off'}` : '');
    }, 300);
  }
}
