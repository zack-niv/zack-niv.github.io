// =============================================================================
// v11.1 — crash recovery and WebGL context loss (the iOS crash).
//
// iOS Safari kills a tab that uses too much memory (jetsam) without any unload event: the page just reloads, or
// shows "A problem repeatedly occurred". So:
//   * on Begin we leave a "running" marker (sessionStorage, with a localStorage copy because a killed WebContent
//     process may take sessionStorage with it); it is cleared whenever the page is hidden or unloaded cleanly;
//   * if a boot finds the marker, the last run died while on screen: main.js starts a SAFE mobile tier (fewer
//     people, lower resolution, smaller sign textures) and tells the player in one calm line;
//   * a lost WebGL context (GPU process out of memory) shows a calm card and reloads into the safe tier.
//
// Contract (main.js / analytics):
//   const rec = readRecovery()          before the engine tiers are set; null, or { lastStage, t, safe, reason, ago }
//   armRecovery(ctx, rec)               after ctx exists: marker upkeep, the context-loss card, the toast
//   ctx.recovered                       = rec (null when this is a normal boot)
//   ctx.memEstimate()                   → { texMB, canvasMB, tex } rough GPU texture + 2D canvas estimate
//   ctx.lastRunHidden                   = { lastStage, t, ago, sinceStage, mem } when the last run's tab was hidden
//                                         and never came back (killed in the background, or a kill that iOS announced
//                                         as "hidden" first): reported, but never a reason for the safe tier
//   ?safe forces safe tier 1 (?safe=2 → 2) for testing
//
// v12.1 (the Lodestone crash): Zack's iPhone reloaded 17 s after namba_lodestone_ready and no namba_recovered came,
// so the marker now says more and is lost less: the stage (Lodestone's install / calibration / ready / 3D view are
// stages of their own), seconds since that stage (sinceStage), a memory estimate taken at each stage (mem: tex / canvas
// MB, heap MB where the browser has it, WebGL contexts, Lodestone's stack mode) and, instead of being cleared when the
// tab is hidden, a `hidden` flag.
//
// v14 (Zack: "it often crashes and I don't have any logs"): the marker is now a flight recorder. It also carries
//   cr   the last stages with their play time ("tutorial_raise@31"), so a crash shows the path, not one stage
//   q    the quality tier the dead run used (the recovered event's own super properties describe the NEW run)
//   err  the last JS errors (window error / unhandled rejection), which also go out live as namba_error
//   geo  geometry MB (vertex + index buffers in the scene) next to tex / canvas: the estimate missed all of it
//
// v15 (resume): the marker also carries `cp`, the story's checkpoint (game/story.js checkpoint(): where you stand, the
// beats reached, your destination, Lodestone). A boot that finds one (a crash, or a tab killed in the background, within
// FRESH_MS) sets ctx.resumeFrom and the game picks up there instead of the platform. ?fresh ignores it.
//
// v18 (the iPhone 16 dies a few minutes in, no report, memory cuts did not help): the recorder is denser. The marker is written every
// 3 s (was 10), the crumbs hold 30 entries and include the small things (phone down, app switches, photo, order, vignettes, PA speech,
// pause, hidden/visible, quality, memdiet, long frames), and it carries what the last seconds looked like:
//   fr   { g, k, s, n }: worst frame gap (ms) and worst tick (ms) in the last 5 s, the slowest system of that tick, frames so far
//   lg   the worst gaps over 400 ms since page start, "<ms>ms@<t>:<system>" (main.js ctx.frameLog)
//   ri   { g, t, p, c, tr }: renderer geometries, textures, programs, and the last frame's draw calls and triangles
//   dom  DOM node count (sampled every 15 s) · ph phone state ("up:messages", "glance", "down") · sa 1 when a home-screen app
//   up   seconds since page load · dd effective draw distance · ds the call governor's distance scale
// liveStats(ctx) returns the same readings for analytics (namba_beat).
//
// v19 (is it the audio?): `au` = the audio bank's figures { b: buffers cached, mb: their size, p: jobs pending, j: jobs done, last: last finished
// job, lms: its ms, cur: the job rendering now, st: AudioContext state }; present only while audio is on. Crumbs `mus+<name>` / `mus-<name>`
// when a mus:* recipe is posted to / returns from the synthesis worker (ctx.events 'audio:job' from audio/bank.js).
// =============================================================================
const KEY = 'namba_run';
const MAX_CRUMBS = 30;
const FRESH_MS = 20 * 60 * 1000;      // a localStorage marker older than this is stale (not "the last run")

const store = {
  get() {
    let m = null;
    try { m = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (e) { /* private mode */ }
    if (!m) try { const l = JSON.parse(localStorage.getItem(KEY) || 'null'); if (l && Date.now() - (l.at || 0) < FRESH_MS) m = l; } catch (e) { /* ignore */ }
    return m;
  },
  set(m) {
    const s = JSON.stringify(m);
    try { sessionStorage.setItem(KEY, s); } catch (e) { /* ignore */ }
    try { localStorage.setItem(KEY, s); } catch (e) { /* ignore */ }
  },
  clear() {
    try { sessionStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  },
};

// At boot: did the previous run die on screen? (consumes the marker)
export function readRecovery() {
  const q = new URLSearchParams(location.search);
  const forced = q.has('safe') ? Math.max(1, Math.min(2, +q.get('safe') || 1)) : 0;
  const m = store.get();
  store.clear();
  // a run whose tab was hidden and never came back is not (provably) a crash: no safe tier, but report it
  if (m && m.hidden && !m.reason) {
    hiddenRun = { lastStage: m.stage || 'play', t: m.t || 0, ago: Math.round((Date.now() - (m.at || Date.now())) / 1000), sinceStage: m.ss, mem: m.mem || null, crumbs: m.cr || null, quality: m.q || null, errs: m.err || null, cp: m.cp || null, ...flight(m) };
    if (!forced) return null;
  }
  if (!m && !forced) return null;
  const prevSafe = (m && m.safe) || 0;
  return {
    lastStage: m ? m.stage || 'play' : 'forced', t: m ? m.t || 0 : 0, reason: m ? m.reason || 'killed' : 'param',
    ago: m ? Math.round((Date.now() - (m.at || Date.now())) / 1000) : 0,
    safe: forced || Math.min(2, prevSafe + 1),     // a second crash in safe mode steps down once more
    sinceStage: m ? m.ss : null, mem: m ? m.mem || null : null,
    crumbs: m ? m.cr || null : null, quality: m ? m.q || null : null, errs: m ? m.err || null : null, cp: m ? m.cp || null : null,
    ...(m ? flight(m) : {}),
  };
}
let hiddenRun = null;
// v18: the flight-recorder fields of a marker, as readRecovery() returns them
const flight = (m) => ({ fr: m.fr || null, lg: m.lg || null, ri: m.ri || null, dom: m.dom != null ? m.dom : null, ph: m.ph || null, sa: m.sa || null, up: m.up != null ? m.up : null, dd: m.dd != null ? m.dd : null, ds: m.ds != null ? m.ds : null, au: m.au || null });

const standalone = () => { try { return navigator.standalone === true || matchMedia('(display-mode: standalone)').matches; } catch (e) { return false; } };

// v18: live readings for the marker and for analytics (namba_beat); every field is optional, nothing here throws
let domAt = -1e9, domN;
export function liveStats(ctx) {
  const o = {};
  try { const F = ctx.frameLog; if (F) o.fr = { g: Math.round(F.gapMax5), k: Math.round(F.tickMax5), s: F.tickSys5 || undefined, n: F.n }; } catch (e) { /* optional */ }
  try {
    const e = ctx.engine, i = e && e.renderer && e.renderer.info;
    if (i) o.ri = { g: i.memory.geometries, t: i.memory.textures, p: i.programs ? i.programs.length : undefined, c: e.stats.calls, tr: e.stats.tris };
  } catch (e) { /* optional */ }
  try { const n = performance.now(); if (n - domAt > 15000) { domAt = n; domN = document.getElementsByTagName('*').length; } o.dom = domN; } catch (e) { /* optional */ }
  try { const P = ctx.phone; if (P) o.ph = P.isOpen ? 'up:' + P.app : (P.pose || 'down'); } catch (e) { /* optional */ }
  try { o.up = Math.round(performance.now() / 1000); } catch (e) { /* optional */ }
  try { const V = ctx.visibility; if (V) { if (typeof V.dd === 'number') o.dd = Math.round(V.dd); if (typeof V.distScale === 'number') o.ds = Math.round(V.distScale * 100) / 100; } } catch (e) { /* optional */ }
  try {
    const A = ctx.audio, B = A && A.enabled && A.bank;
    if (B) {
      let bytes = 0;
      for (const buf of B.cache.values()) bytes += buf.length * buf.numberOfChannels * 4;
      o.au = { b: B.cache.size, mb: Math.round(bytes / 1048576), p: B.pending.size, j: B.stats.jobs, last: B.last || undefined, lms: B.last ? B.lastMs : undefined, cur: B.cur, st: A.ac ? A.ac.state : undefined };
    }
  } catch (e) { /* optional */ }
  return o;
}

// WebGL contexts made on this page (Stack3D used to add a second one): counted by wrapping getContext once
let glContexts = 0;
try {
  const P = HTMLCanvasElement.prototype, get = P.getContext;
  P.getContext = function (type, opts) {
    const had = this.__nbGl;
    const c = get.call(this, type, opts);
    if (c && !had && /webgl/.test(String(type))) { this.__nbGl = 1; glContexts++; }
    return c;
  };
} catch (e) { /* ignore */ }

export function armRecovery(ctx, rec) {
  ctx.recovered = rec || null;
  ctx.lastRunHidden = hiddenRun;
  // v15: resume the last run (crashed, or killed in the background) unless ?fresh, a forced ?safe, or it is stale
  {
    const src = (rec && rec.reason !== 'param' && rec) || hiddenRun, cp = src && src.cp;
    ctx.resumeFrom = cp && !new URLSearchParams(location.search).has('fresh') && (src.ago == null || src.ago < FRESH_MS / 1000) ? cp : null;
  }
  ctx.memEstimate = () => memEstimate(ctx);
  const safe = rec ? rec.safe : 0;
  // armed from boot: a tab that dies while loading (or on the title) counts too; hiding the tab flags it (v12.1)
  let stage = 'loading', running = true, stageAt = performance.now(), mem = null;
  let reloading = false;      // our own reload after a lost context must keep its marker
  const playT = () => Math.round((ctx.game && ctx.game.demo && ctx.game.demo.t) || 0);
  const crumbs = [], errs = [];         // v14: the flight recorder (see the header); v18: crumbs are { n: name, c: repeats, t: play time }
  const crumb = (n) => {
    const t = playT(), l = crumbs[crumbs.length - 1];
    if (l && l.n === n) { l.c++; l.t = t; return; }
    crumbs.push({ n, c: 1, t }); if (crumbs.length > MAX_CRUMBS) crumbs.shift();
  };
  const crumbStr = () => crumbs.map(c => (c.c > 1 ? `${c.n}×${c.c}` : c.n) + '@' + c.t).join(' ');
  const sa = standalone() ? 1 : undefined;
  if (ctx.frameLog) ctx.frameLog.stage = () => stage;
  const q = () => { const e = ctx.engine; return e ? e.qualityName + (e.qualityForced ? '!' : '') : undefined; };
  const snapshot = (reason, hidden) => ({ stage, t: playT(), at: Date.now(), ss: Math.round((performance.now() - stageAt) / 1000), mem: mem || undefined, safe, reason: reason || undefined, hidden: hidden || undefined,
    q: q(), cr: crumbs.length ? crumbStr() : undefined, err: errs.length ? errs.slice() : undefined, cp: checkpoint(),
    ...live(), sa });
  // v18: the readings that go into every write (liveStats); `lg` = the worst frame gaps, compacted
  const live = () => {
    const o = liveStats(ctx);
    try { const L = ctx.frameLog && ctx.frameLog.long; if (L && L.length) o.lg = L.map(x => `${x.ms}ms@${x.t}:${x.sys || '?'}`); } catch (e) { /* optional */ }
    return o;
  };
  // v15: the story's checkpoint (null before the first text / after arrival); the last good one survives a bad read
  let lastCp;
  const checkpoint = () => { try { const S = ctx.game && ctx.game.story; const c = S && S.checkpoint ? S.checkpoint() : null; if (c) lastCp = c; else if (ctx.game && ctx.game.demo && ctx.game.demo.arrived) lastCp = undefined; } catch (e) { /* keep the last */ } return lastCp; };
  const write = (reason, hidden) => {
    if ((document.hidden || reloading) && !reason && !hidden) return;
    if (running || reason) store.set(snapshot(reason, hidden));
  };
  // JS errors: kept for the marker, and handed to analytics live ('app:error'; analytics.js sends namba_error)
  ctx.errorLog = [];
  const onErr = (kind, msg, where) => {
    try {
      const m = String(msg || 'unknown').slice(0, 160), w = where ? String(where).replace(/^.*\/namba-demo\//, '').replace(/\?v=[a-z0-9]+/, '').slice(0, 80) : '';
      if (errs.length && errs[errs.length - 1].startsWith(m.slice(0, 60))) return;      // the same error every frame: once
      errs.push(w ? `${m} @${w}` : m); if (errs.length > 4) errs.shift();
      const e = { kind, msg: m, where: w || null, stage, t: playT() };
      if (ctx.errorLog.length < 30) ctx.errorLog.push(e);
      ctx.events && ctx.events.emit('app:error', e);
      write();
    } catch (e) { /* never throw from the error handler */ }
  };
  addEventListener('error', (e) => { if (e && e.message) onErr('error', e.message, e.filename ? `${e.filename}:${e.lineno}` : ''); });
  addEventListener('unhandledrejection', (e) => { const r = e && e.reason; onErr('rejection', r && (r.message || r), r && r.stack ? String(r.stack).split('\n')[1] : ''); });
  // the memory picture at each stage (memEstimate walks the scene: at most every 20 s, except Lodestone's stages)
  let memAt = -1e9;
  const sampleMem = (force) => {
    const now = performance.now();
    if (!force && now - memAt < 20000) return;
    memAt = now;
    try {
      const e = memEstimate(ctx), pm = performance.memory;
      const st = ctx.phone && ctx.phone.lodestone && ctx.phone.lodestone.stack;
      mem = { tex: e.texMB, cv: e.canvasMB, geo: e.geoMB, gl: glContexts, heap: pm ? Math.round(pm.usedJSHeapSize / 1048576) : undefined, ld: st ? (st.shared ? 'shared' : 'ctx') : undefined };
    } catch (e) { /* ignore */ }
  };
  const mark = (s) => {
    if (s !== stage) crumb(s);
    stage = s; stageAt = performance.now(); if (running) { sampleMem(/^lodestone_(installing|calibrating|ready)$/.test(s)); write(); }
  };
  const E = ctx.events;
  E.on('game:ready', () => mark('title'));
  E.on('game:start', () => mark('play'));
  E.on('tutorial:step', (e) => { if (e && e.done) mark('tutorial_' + e.id); });
  E.on('nav:destination', () => mark('destination'));
  E.on('gate:tap', (e) => { if (e && e.player) mark('gate'); });
  E.on('phone:open', () => mark('phone_' + ((ctx.phone && ctx.phone.app) || 'up')));
  E.on('phone:upgrade', (e) => { if (e && e.stage) mark('lodestone_' + e.stage); });
  E.on('phone:stack', (e) => { if (ctx.phone && ctx.phone.upgradeStage === 'ready') mark(e && e.open ? 'lodestone_3d' : 'lodestone_map'); });
  E.on('demo:arrive', () => mark('arrived'));
  E.on('demo:end', () => mark('endcard'));
  // v18: the small things between stages
  E.on('phone:close', () => crumb('phone_down'));
  E.on('phone:app', (e) => { if (e && e.app) crumb('app_' + e.app); });
  E.on('phone:reply', (e) => { if (e && e.photo) crumb('photo'); });
  E.on('demo:order', () => crumb('order'));
  E.on('vignette:open', (e) => crumb('vig_' + ((e && e.kind) || '')));
  E.on('vignette:close', () => crumb('vig_end'));
  E.on('pa:speech', (e) => { if (e) crumb(e.s === 'end' ? 'pa_end' : e.s === 'error' ? 'pa_err' : 'pa'); });
  E.on('audio:job', (e) => { try { if (e && typeof e.name === 'string' && e.name.startsWith('mus:')) crumb((e.s === 'end' ? 'mus-' : 'mus+') + e.name.slice(4)); } catch (err) { /* optional */ } });
  E.on('game:pause', () => crumb('pause'));
  E.on('game:resume', () => crumb('unpause'));
  E.on('render:quality', (e) => crumb('q_' + ((e && e.name) || '')));
  E.on('app:longtask', (e) => { if (e) crumb('long' + e.ms); });
  // a clean exit or the tab going to the background is not a crash
  addEventListener('pagehide', () => { if (!reloading) store.clear(); });
  // v12.1: hidden is flagged, not cleared (a tab iOS kills may well be "hidden" first); visible again un-flags it
  document.addEventListener('visibilitychange', () => { if (reloading) return; crumb(document.hidden ? 'hidden' : 'visible'); if (document.hidden) write(null, true); else if (running) write(); });
  write();
  // keep `t` and the live readings fresh (v18: every 3 s, was 10; only while playing and visible). memdiet has no event: its pass count is read here.
  let dietN = 0;
  setInterval(() => {
    try { const n = ctx.memdiet && ctx.memdiet.stats && ctx.memdiet.stats.passes; if (n > dietN) { dietN = n; crumb('diet'); } } catch (e) { /* optional */ }
    if (running && !document.hidden) write();
  }, 3000);

  // WebGL context loss (iOS: the GPU process ran out of memory): calm card → reload into the safe tier
  const canvas = ctx.engine && ctx.engine.renderer && ctx.engine.renderer.domElement;
  if (canvas) {
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      console.warn('[resilience] WebGL context lost');
      ctx.contextLost = true;
      reloading = true;
      sampleMem(true);
      store.set(snapshot('ctxlost'));
      showCard(safe >= 2);
      setTimeout(() => { try { location.reload(); } catch (err) { /* ignore */ } }, 2600);
    }, false);
  }
  if (rec && rec.reason !== 'param') E.on('game:ready', () => toast(!!ctx.resumeFrom));
}

function showCard(already) {
  if (document.getElementById('ctxlost')) return;
  const d = document.createElement('div');
  d.id = 'ctxlost';
  d.setAttribute('role', 'alert');
  d.style.cssText = 'position:fixed;inset:0;z-index:9999;display:grid;place-items:center;background:rgba(8,10,14,.92);color:#eef1f5;font:500 16px/1.45 Inter,system-ui,sans-serif;text-align:center;padding:24px';
  d.innerHTML = `<div style="max-width:420px"><div style="font-size:13px;letter-spacing:.14em;opacity:.6;margin-bottom:10px">なんば · NAMBA</div>
    <div style="font-size:20px;font-weight:600;margin-bottom:8px">Your phone needs a breather</div>
    <div style="opacity:.8">${already ? 'Reloading with the lightest settings…' : 'Reloading in a lighter mode — you’ll be back in a moment.'}</div></div>`;
  document.body.appendChild(d);
}

function toast(resume) {
  const d = document.createElement('div');
  d.className = 'recover-toast';
  d.style.cssText = 'position:fixed;left:50%;top:max(12px,env(safe-area-inset-top));transform:translateX(-50%);z-index:9000;max-width:min(92vw,520px);padding:9px 14px;border-radius:12px;background:rgba(10,12,16,.82);color:#eef1f5;font:500 13px/1.35 Inter,system-ui,sans-serif;text-align:center;pointer-events:none;transition:opacity .8s';
  d.textContent = resume ? 'Restarted in a lighter mode. You’ll pick up where you left off.' : 'Restarted in a lighter mode, so Namba fits your phone’s memory.';
  document.body.appendChild(d);
  setTimeout(() => { d.style.opacity = '0'; }, 7000);
  setTimeout(() => d.remove(), 8200);
}

// Rough texture + canvas memory: every texture reachable from the scene (and the phone's 3D stack), sized from its
// image (× 4/3 with mips). For the perf sample; walks the scene graph, so call it rarely (once per sample).
export function memEstimate(ctx) {
  const seen = new Set(), cvs = new Set(), geos = new Set();
  let tex = 0, cv = 0, geo = 0;
  const addGeo = (g) => {
    if (!g || !g.isBufferGeometry || geos.has(g)) return; geos.add(g);
    const add = (a) => { const arr = a && (a.array || (a.data && a.data.array)); if (arr && arr.byteLength) geo += arr.byteLength; };
    if (g.index) add(g.index);
    for (const k in g.attributes) add(g.attributes[k]);
  };
  const addTex = (t) => {
    if (!t || !t.isTexture || seen.has(t)) return; seen.add(t);
    const im = t.image; if (!im) return;
    const w = im.width || im.__w || 0, h = im.height || im.__h || 0, d = im.depth || 1;     // v17: a released canvas (width 0) still sits on the GPU
    const bpp = t.type === 1015 ? 16 : t.type === 1016 ? 8 : 4;          // Float / HalfFloat / bytes
    tex += w * h * d * bpp * (t.generateMipmaps && t.minFilter !== 1006 && t.minFilter !== 1003 ? 4 / 3 : 1);
    if (typeof HTMLCanvasElement !== 'undefined' && im instanceof HTMLCanvasElement && !cvs.has(im)) { cvs.add(im); if (im.width > 0) cv += w * h * 4; }
  };
  const visit = (o) => {
    addGeo(o.geometry);
    const m = o.material; if (!m) return;
    for (const mm of Array.isArray(m) ? m : [m]) for (const k in mm) { const v = mm[k]; if (v && v.isTexture) addTex(v); }
    if (m.uniforms) for (const k in m.uniforms) addTex(m.uniforms[k] && m.uniforms[k].value);
  };
  try { ctx.scene.traverse(visit); } catch (e) { /* ignore */ }
  try { const st = ctx.phone && ctx.phone.lodestone && ctx.phone.lodestone.stack; if (st && st.scene) st.scene.traverse(visit); } catch (e) { /* ignore */ }
  const MB = (b) => Math.round(b / 1048576);
  return { texMB: MB(tex), canvasMB: MB(cv), geoMB: MB(geo), tex: seen.size };
}
