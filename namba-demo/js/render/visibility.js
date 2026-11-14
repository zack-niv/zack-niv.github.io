// =============================================================================
// Visibility & performance governor.
//
//  1. LEVELS.  Own level always; the other levels only where something opens
//     onto them: a void / ramp (stair, escalator, atrium) near the camera, or
//     everything in the Parks / outdoors where terraces see each other.
//  2. CHUNKS (userData.chunk = {level,x,z,r}) are hidden when
//       · beyond the draw distance (own level; shorter for small chunks),
//       · outside the camera frustum (cheap sphere test, saves traversal too),
//       · occluded: a 720-ray 2D visibility fan is cast over the level's walk
//         grid (solid cells + wall/partition edges block) from the camera;
//         a chunk is shown only if some ray reaches its near edge. Chunks that
//         were visible stay on for HOLD seconds (no flicker at corners).
//     Chunks flagged userData.nbOutdoor (sun shadow casters) skip frustum/LOS.
//  3. Dynamic resolution: GPU timer (engine.stats.gpuMs) or frame time →
//     engine.setDRS().
//  4. Auto quality: GPU/device heuristics at boot (engine.js) + a short
//     benchmark after start steps the tier down if even min DRS can't hold ~50 fps.
//  4b. SHELL (phones, ?shell / ?noshell): beyond the detail draw distance an arch chunk is not hidden
//     but drawn as a shell, only its structural meshes (floors, walls, ceilings, columns, light panels; see
//     SHELL_RE) up to shellDist. Every other culling reason (level, frustum, occlusion) still hides it.
//     The frame-rate governors scale with engine.fpsCap (target frame time 1000 / cap).
//  5. ?debug overlay: calls, tris, programs, textures, DRS, GPU ms, EV, culling.
//  ?novis disables chunk culling (for comparisons); ?visdbg logs culling stats.
// =============================================================================
import * as THREE from 'three';
import { LEVELS, LEVEL_ORDER } from '../world/layout.js?v=a30ee4b';
import { CELL } from '../world/world.js?v=a30ee4b';
import { params } from '../core/params.js?v=a30ee4b';
import { QUALITY_ORDER } from '../core/engine.js?v=a30ee4b';
import * as visFan from './visfan.js?v=a30ee4b';
import { clipIntrusions } from './intrusions.js?v=a30ee4b';

const FAN = visFan.FAN;
const HOLD = 0.45;       // seconds an occluded chunk stays on
const OPEN_CELL = 4;     // opening clustering (m)
const SHELL_DIST = 110;  // metres the shell (structure only) is drawn to
// chunk visibility states; rec.shown stays true only for FULL
const HIDDEN = 0, SHELL = 1, FULL = 2;
// structural arch materials: big opaque floor / wall / ceiling / column / light-panel surfaces. Matches floor_*,
// wall_*, ceiling_*, concrete_*, light_* plus arch_slab, arch_vault, arch_daylight, roof_deck. Left out on purpose:
// transparent or decal materials (ao_strip, arch_wear, glass_*), tactile_*, inlay_*, band_*, steel / stainless /
// aluminium trim, rubber, esc_* (escalator parts), arch_kit / arch_exit / arch_adbox (signs, small kit).
const SHELL_RE = /^(?:floor_|wall_|ceiling_|concrete_|light_|arch_slab$|arch_vault$|arch_daylight$|roof_deck$)/;

export class Visibility {
  constructor(ctx) {
    this.ctx = ctx;
    ctx.engine.ctx = ctx;
    this.frameMs = 16.7; this.gpuMs = 0;
    this._last = performance.now();
    this._slow = 0; this._fast = 0; this._drsCool = 0;
    this._bench = null;
    this.visibleLevels = new Set();
    this.stats = { total: 0, shown: 0, shell: 0, level: 0, dist: 0, frustum: 0, occluded: 0, opening: 0 };
    const P = ctx.params || params;
    this.shell = !!(P.has('noshell') ? false : (ctx.engine.mobile || P.has('shell')));
    this.shellDist = this.shell ? SHELL_DIST : 0;
    this.shownChunks = 0; this._nChunks = 0;
    this.fan = new Float32Array(FAN);
    this._fanKey = { x: 1e9, z: 1e9, level: '' };
    this._frustum = new THREE.Frustum();
    this._pv = new THREE.Matrix4();
    this._sph = new THREE.Sphere();
    this._now = 0;
    this.enabled = !params.has('novis');
    this.partitionBlocks = !params.has('visleak');
  }

  init() {
    const t0 = performance.now();
    const { engine, world } = this.ctx;
    // structures of other systems that pass through indoor spaces (Nankai viaduct deck in Namba
    // CITY / Parks): removed once, before culling records are built
    try { this.intrusions = clipIntrusions(this.ctx); } catch (e) { console.warn('[render] intrusion clip failed', e); }
    this._maskLevels = {};
    this.openings = {};
    for (const lv of LEVEL_ORDER) {
      const g = world.grids[lv]; if (!g) continue;
      this._maskLevels[lv] = visFan.buildMasks(world, lv, this.partitionBlocks);
      // openings (voids, ramps) clustered on a coarse grid
      const seen = new Set(), pts = [];
      for (let cz = 0; cz < g.h; cz++) for (let cx = 0; cx < g.w; cx++) {
        const t = g.type[cz * g.w + cx];
        if (t !== CELL.VOID && t !== CELL.RAMP) continue;
        const kx = Math.floor((g.x0 + cx) / OPEN_CELL), kz = Math.floor((g.z0 + cz) / OPEN_CELL);
        const key = kx * 100003 + kz;
        if (seen.has(key)) continue; seen.add(key);
        pts.push((kx + 0.5) * OPEN_CELL, (kz + 0.5) * OPEN_CELL);
      }
      this.openings[lv] = pts;
    }
    this._collect();
    if (params.debug) this._debugEl();
    this.drsEnabled = !params.test || params.has('drs');
    this.autoQuality = !engine.qualityForced && !params.test;
    this.ctx.events.on && this.ctx.events.on('player:teleport', () => { this._fanKey.level = ''; this._tele = true; });
    console.log(`[render] visibility init ${(performance.now() - t0).toFixed(0)} ms, ${this._nChunks} chunks`);
  }

  // start a notch below full resolution on the heavy tiers: the governor ramps back up within a few
  // seconds on a strong GPU, and a weak one never sees a stuttering first minute
  onStart() {
    const { engine } = this.ctx;
    if (this.drsEnabled && (engine.qualityName === 'high' || engine.qualityName === 'ultra') && engine.quality.post) engine.setDRS(0.88);
  }

  _collect() {
    const { engine } = this.ctx;
    const old = this._recs || new Map();
    this._recs = new Map();
    this.chunks = {};
    let n = 0;
    for (const lv of LEVEL_ORDER) {
      const root = engine.levelRoot(lv); if (!root) continue;
      const list = [];
      root.traverse(o => {
        if (o === root || !o.userData || !o.userData.chunk) return;
        let rec = old.get(o);
        if (!rec) {
          const c = o.userData.chunk;
          const r = c.r || 40;
          rec = { g: o, level: lv, x: c.x, z: c.z, r, re: Math.min(r, r * 0.8 + 2), seen: -1e9, los: true, open: true, shown: true, state: FULL, hasShell: false, nk: -1 };
        }
        if (this.shell && rec.nk !== o.children.length && typeof o.name === 'string' && o.name.startsWith('arch')) {
          rec.nk = o.children.length;
          for (const m of o.children) {
            if (!m.isMesh || m.userData.nbShell !== undefined) continue;
            const mat = m.material;
            m.userData.nbShell = !!(mat && !Array.isArray(mat) && !mat.transparent && SHELL_RE.test(mat.name || ''));
            if (m.userData.nbShell) rec.hasShell = true;
          }
        }
        if (rec.state !== FULL) this._setChunk(rec, rec.state, true); // pick up late children
        this._recs.set(o, rec); list.push(rec);
      });
      this.chunks[lv] = list; n += list.length;
    }
    this._nChunks = n;
    this._collectT = 2;
    this._fanKey.level = ''; // re-evaluate occlusion
  }

  // Culling is done with the layer mask of every object in the chunk (not
  // .visible): shops.js / props.js own the .visible flag of their groups for
  // their own distance logic, and we must not fight over it.
  // state: HIDDEN, SHELL (only nbShell meshes) or FULL; true / false mean FULL / HIDDEN
  _setChunk(rec, state, force) {
    const sv = state === true ? FULL : state === false ? HIDDEN : state;
    rec.state = sv; rec.shown = sv === FULL;
    rec.g.traverse(o => { if (sv === FULL || (sv === SHELL && o.userData && o.userData.nbShell)) o.layers.enable(0); else o.layers.disable(0); });
  }

  // ---- 2D visibility fan (js/render/visfan.js) -------------------------------
  _castFan(lv, ox, oz, maxD) {
    const g = this.ctx.world.grids[lv]; const m = this._maskLevels[lv];
    return !!(g && m) && visFan.castFan(g, m, ox, oz, maxD, this.fan);
  }
  _fanSees(rec, ox, oz) { return visFan.fanSees(this.fan, rec.x, rec.z, rec.re, ox, oz); }

  _linkedLevels(b, outdoorish) {
    const set = new Set();
    const i = LEVEL_ORDER.indexOf(b.level);
    set.add(b.level);
    if (i > 0) set.add(LEVEL_ORDER[i - 1]);
    if (i < LEVEL_ORDER.length - 1) set.add(LEVEL_ORDER[i + 1]);
    // own level +-1 only; +-2 only when a void / ramp to that level is near the camera (an atrium
    // looking two floors down), and every level above ground outdoors (see below)
    const O = this._near;
    if (O && !outdoorish) for (let k = 0; k < O.length; k += 3) if (O[k + 2] === 2) { for (const d of [-2, 2]) { const j = LEVEL_ORDER.indexOf(this._nearLv[k / 3]); if (j === i + d) set.add(LEVEL_ORDER[j]); } }
    if (outdoorish) for (const lv of LEVEL_ORDER) if (LEVELS[lv].y >= 0) set.add(lv);
    return set;
  }

  update(dt) {
    const { engine, player, world, lighting } = this.ctx;
    if (!player) return;
    this._now += dt;
    if ((this._collectT -= dt) <= 0) this._collect();
    const b = player.body;
    const cam = engine.camera;
    cam.updateMatrixWorld();
    const cp = cam.position;
    const own = b.level, ownI = LEVEL_ORDER.indexOf(own);
    const sp = world.spaceAt(own, b.x, b.z);
    const zone = sp ? sp.zone : (player.zone);
    const s = lighting && lighting.baked ? lighting.sample(own, b.x, b.z) : null;
    const outdoor = !!((sp && sp.outdoor) || (s && s.sky > 0.45));
    const parks = zone === 'parks' || zone === 'parksGarden' || (outdoor && LEVELS[own].y >= 6);
    const vis = this._linkedLevels(b, parks);
    // riding an escalator / stair: the level you are travelling to is drawn to the full own-level
    // distance from the moment you step on, so nothing pops in when the level swaps at the top
    const ramp = b.ramp >= 0 && world.layout ? world.layout.ramps[b.ramp] : null;
    const dest = ramp ? (ramp.upper === own ? ramp.lower : ramp.upper) : null;
    if (dest) vis.add(dest);
    this.visibleLevels = vis;
    // indoors the exp2 fog already swallows everything beyond ~130 m: draw less of it
    // draw-call governor: when the last frames needed more than the budget, pull the draw distance in
    // (farthest chunks first); creep back out when there is headroom. Budget is per quality tier.
    const nowMs = performance.now();
    if (nowMs - (this._callT || 0) > 400) {
      this._callT = nowMs;
      const budget = engine.quality.callBudget || 900, calls = engine.stats.calls || 0;
      const k = this.distScale || 1;
      this.distScale = calls > budget ? Math.max(engine.quality.distFloor || 0.55, k * (calls > budget * 1.3 ? 0.9 : 0.96)) : calls < budget * 0.75 ? Math.min(1, k + 0.02) : k;
    }
    const dd = engine.quality.drawDist * (outdoor || parks ? 1 : 0.8) * (this.distScale || 1);
    this.dd = dd; // v17: effective draw distance this frame (read by lighting haze mode)
    const st = this.stats; st.total = 0; st.shown = 0; st.shell = 0; st.level = 0; st.dist = 0; st.frustum = 0; st.occluded = 0; st.opening = 0;
    const cull = this.enabled;
    // camera frustum
    this._pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._pv);
    // recompute the visibility fan / openings when the camera moved
    const fk = this._fanKey;
    const moved = Math.hypot(cp.x - fk.x, cp.z - fk.z) > 0.45 || fk.level !== own || fk.parks !== parks;
    if (cull && moved) {
      fk.x = cp.x; fk.z = cp.z; fk.level = own; fk.parks = parks;
      const useLOS = !outdoor && !parks && this._castFan(own, cp.x, cp.z, Math.max(dd, this.shellDist) + 20);
      this._los = useLOS;
      // nearby openings (own + neighbouring levels)
      const O = this._near || (this._near = []);
      O.length = 0;
      const NL = this._nearLv || (this._nearLv = []); NL.length = 0;
      for (let j = Math.max(0, ownI - 2); j <= Math.min(LEVEL_ORDER.length - 1, ownI + 2); j++) {
        const pts = this.openings[LEVEL_ORDER[j]]; if (!pts) continue;
        for (let k = 0; k < pts.length; k += 2) {
          const dx = pts[k] - cp.x, dz = pts[k + 1] - cp.z;
          if (dx * dx + dz * dz < 75 * 75) { O.push(pts[k], pts[k + 1], Math.abs(j - ownI)); NL.push(LEVEL_ORDER[j]); }
        }
      }
      // per-chunk occlusion
      for (const lv of vis) {
        const list = this.chunks[lv]; if (!list) continue;
        for (const rec of list) {
          if (lv === own) { rec.los = useLOS ? this._fanSees(rec, cp.x, cp.z) : true; rec.open = true; }
          else {
            rec.los = true;
            let ok = false;
            if (!parks) for (let k = 0; k < O.length; k += 3) {
              const dx = O[k] - rec.x, dz = O[k + 1] - rec.z;
              const lim = rec.re + (O[k + 2] > 1 ? 22 : 40);
              if (dx * dx + dz * dz < lim * lim) { ok = true; break; }
            } else ok = true;
            rec.open = ok;
          }
          if (rec.los && rec.open) rec.seen = this._now;
        }
      }
    }
    // per-frame pass
    const frustum = this._frustum, sph = this._sph;
    for (const lv of LEVEL_ORDER) {
      const root = engine.levelRoot(lv); if (!root) continue;
      const list = this.chunks[lv] || [];
      st.total += list.length;
      const on = vis.has(lv);
      root.visible = on || !cull;
      if (!on && cull) { st.level += list.length; continue; }
      const ly = LEVELS[lv].y;
      const isOwn = lv === own;
      const lim = isOwn || lv === dest ? dd : dd * 0.6;
      for (const rec of list) {
        const g = rec.g;
        let state = FULL;
        if (cull) {
          const outdoorChunk = g.userData.nbOutdoor;
          const dx = rec.x - cp.x, dz = rec.z - cp.z, dy = (ly + 3) - cp.y;
          const d = Math.sqrt(dx * dx + dz * dz + dy * dy) - rec.r;
          // small chunks (shops, props, signs) stop reading earlier
          const l2 = rec.r < 14 ? lim * 0.6 : lim;
          // beyond the detail distance a chunk with structural meshes drops to the shell state while inside shellDist
          const far = d > l2;
          const sl = isOwn || lv === dest ? this.shellDist : this.shellDist * 0.6;
          if (far && !(this.shell && rec.hasShell && d <= sl)) { state = HIDDEN; st.dist++; }
          else {
            if (far) state = SHELL;
            if (!outdoorChunk) {
              sph.center.set(rec.x, ly + 3, rec.z); sph.radius = rec.r + 4;
              if (!frustum.intersectsSphere(sph)) { state = HIDDEN; st.frustum++; }
              else if (!(rec.los && rec.open) && this._now - rec.seen > HOLD) { state = HIDDEN; if (isOwn) st.occluded++; else st.opening++; }
            }
          }
        }
        if (rec.state !== state) this._setChunk(rec, state);
        if (state === FULL) st.shown++;
        else if (state === SHELL) st.shell++;
      }
    }
    this.shownChunks = st.shown;
    this._perf(dt);
  }

  // ---- performance governor ------------------------------------------------
  _perf() {
    const now = performance.now();
    const ms = Math.min(100, now - this._last); this._last = now;
    this.frameMs += (ms - this.frameMs) * 0.05;
    const { engine } = this.ctx;
    this.gpuMs = engine.stats.gpuMs || 0;
    // thresholds below were tuned for 60 fps (16.7 ms); with engine.fpsCap the frame INTERVAL is the cap's
    // (frameMs and the benchmark are interval averages), so everything scales by T / 16.7
    const T = engine.fpsCap > 0 ? 1000 / engine.fpsCap : 1000 / 60, tk = T / (1000 / 60);
    if (this.drsEnabled && this.ctx.started) {
      this._drsCool -= ms / 1000;
      const gpu = engine.gpuTimerOK && this.gpuMs > 0 ? this.gpuMs : null;
      const over = gpu != null ? gpu > 13.5 * tk : this.frameMs > 18.2 * tk;
      const under = gpu != null ? gpu < 9.5 * tk : this.frameMs < 16.9 * tk;
      if (over) { this._slow += ms; this._fast = 0; } else if (under) { this._fast += ms; this._slow = 0; } else { this._slow = 0; this._fast = 0; }
      if (this._drsCool <= 0) {
        if (this._slow > 700) { engine.setDRS(engine.drs - 0.06); this._drsCool = 1.0; this._slow = 0; }
        else if (this._fast > (gpu != null ? 1500 : 4000) && engine.drs < 1) { engine.setDRS(engine.drs + 0.05); this._drsCool = gpu != null ? 1.0 : 3.0; this._fast = 0; }
      }
    }
    // auto quality: benchmark seconds 1.5..5.5 after start, up to 3 rounds
    if (this.autoQuality && this.ctx.started) {
      if (!this._bench) this._bench = { t: 0, sum: 0, n: 0, rounds: 0 };
      const B = this._bench;
      B.t += ms / 1000;
      if (B.t > 1.5) { B.sum += ms; B.n++; }
      if (B.t > 5.5 && B.n > 30) {
        const avg = B.sum / B.n;
        const atMin = engine.drs <= (engine.quality.drsMin || 0.6) + 0.01;
        const i = QUALITY_ORDER.indexOf(engine.qualityName);
        if (avg > 24 * tk && i > 0 && (atMin || avg > 34 * tk)) {
          console.log(`[render] auto quality: ${avg.toFixed(1)} ms/frame → ${QUALITY_ORDER[i - 1]}`);
          engine.setQuality(QUALITY_ORDER[i - 1]);
        }
        B.rounds++; B.t = 0; B.sum = 0; B.n = 0;
        if (B.rounds >= 3) this.autoQuality = false;
      }
    }
  }

  _debugEl() {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;right:8px;top:8px;font:11px/1.35 ui-monospace,monospace;color:#9cf;background:rgba(0,0,0,.6);padding:6px 8px;z-index:99;white-space:pre;pointer-events:none';
    document.body.appendChild(el);
    setInterval(() => {
      const { engine, lighting, post } = this.ctx;
      const i = engine.renderer.info, st = this.stats;
      el.textContent =
        `RENDER ${engine.qualityName}  drs ${engine.drs.toFixed(2)}  frame ${this.frameMs.toFixed(1)}ms  gpu ${engine.gpuTimerOK ? this.gpuMs.toFixed(1) + 'ms' : 'n/a'}\n` +
        `scene calls ${engine.stats.calls}  tris ${(engine.stats.tris / 1000).toFixed(0)}k  progs ${i.programs ? i.programs.length : '?'}  tex ${i.memory.textures}  geo ${i.memory.geometries}\n` +
        `levels ${[...this.visibleLevels].join(',')}  chunks ${st.shown}+${st.shell}shell/${st.total}  cull: lvl ${st.level} dist ${st.dist} frustum ${st.frustum} occl ${st.occluded} open ${st.opening}\n` +
        (lighting ? `mood ${lighting.mood}  fixtures ${lighting.stats.lights} (${lighting.stats.fallback} fallback)  atlas ${lighting.stats.atlas}  bake ${lighting.stats.bakeMs}ms\n` : '') +
        (post ? `EV ${post.ev.toFixed(2)} → ${post.evTarget.toFixed(2)}  post ${post.enabled ? post.costModel() : 'off'}` : '');
    }, 300);
  }
}
