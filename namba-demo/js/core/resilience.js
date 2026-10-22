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
// =============================================================================
const KEY = 'namba_run';
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
    hiddenRun = { lastStage: m.stage || 'play', t: m.t || 0, ago: Math.round((Date.now() - (m.at || Date.now())) / 1000), sinceStage: m.ss, mem: m.mem || null };
    if (!forced) return null;
  }
  if (!m && !forced) return null;
  const prevSafe = (m && m.safe) || 0;
  return {
    lastStage: m ? m.stage || 'play' : 'forced', t: m ? m.t || 0 : 0, reason: m ? m.reason || 'killed' : 'param',
    ago: m ? Math.round((Date.now() - (m.at || Date.now())) / 1000) : 0,
    safe: forced || Math.min(2, prevSafe + 1),     // a second crash in safe mode steps down once more
    sinceStage: m ? m.ss : null, mem: m ? m.mem || null : null,
  };
}
let hiddenRun = null;

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
  ctx.memEstimate = () => memEstimate(ctx);
  const safe = rec ? rec.safe : 0;
  // armed from boot: a tab that dies while loading (or on the title) counts too; hiding the tab flags it (v12.1)
  let stage = 'loading', running = true, stageAt = performance.now(), mem = null;
  let reloading = false;      // our own reload after a lost context must keep its marker
  const playT = () => Math.round((ctx.game && ctx.game.demo && ctx.game.demo.t) || 0);
  const write = (reason, hidden) => {
    if ((document.hidden || reloading) && !reason && !hidden) return;
    if (running || reason) store.set({ stage, t: playT(), at: Date.now(), ss: Math.round((performance.now() - stageAt) / 1000), mem: mem || undefined, safe, reason: reason || undefined, hidden: hidden || undefined });
  };
  // the memory picture at each stage (memEstimate walks the scene: at most every 20 s, except Lodestone's stages)
  let memAt = -1e9;
  const sampleMem = (force) => {
    const now = performance.now();
    if (!force && now - memAt < 20000) return;
    memAt = now;
    try {
      const e = memEstimate(ctx), pm = performance.memory;
      const st = ctx.phone && ctx.phone.lodestone && ctx.phone.lodestone.stack;
      mem = { tex: e.texMB, cv: e.canvasMB, gl: glContexts, heap: pm ? Math.round(pm.usedJSHeapSize / 1048576) : undefined, ld: st ? (st.shared ? 'shared' : 'ctx') : undefined };
    } catch (e) { /* ignore */ }
  };
  const mark = (s) => { stage = s; stageAt = performance.now(); if (running) { sampleMem(/^lodestone_(installing|calibrating|ready)$/.test(s)); write(); } };
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
  // a clean exit or the tab going to the background is not a crash
  addEventListener('pagehide', () => { if (!reloading) store.clear(); });
  // v12.1: hidden is flagged, not cleared (a tab iOS kills may well be "hidden" first); visible again un-flags it
  document.addEventListener('visibilitychange', () => { if (reloading) return; if (document.hidden) write(null, true); else if (running) write(); });
  write();
  // keep `t` fresh (cheap; only while playing and visible)
  setInterval(() => { if (running && !document.hidden) write(); }, 10000);

  // WebGL context loss (iOS: the GPU process ran out of memory): calm card → reload into the safe tier
  const canvas = ctx.engine && ctx.engine.renderer && ctx.engine.renderer.domElement;
  if (canvas) {
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      console.warn('[resilience] WebGL context lost');
      ctx.contextLost = true;
      reloading = true;
      sampleMem(true);
      store.set({ stage, t: playT(), at: Date.now(), ss: Math.round((performance.now() - stageAt) / 1000), mem: mem || undefined, safe, reason: 'ctxlost' });
      showCard(safe >= 2);
      setTimeout(() => { try { location.reload(); } catch (err) { /* ignore */ } }, 2600);
    }, false);
  }
  if (rec && rec.reason !== 'param') E.on('game:ready', () => toast());
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

function toast() {
  const d = document.createElement('div');
  d.className = 'recover-toast';
  d.style.cssText = 'position:fixed;left:50%;top:max(12px,env(safe-area-inset-top));transform:translateX(-50%);z-index:9000;max-width:min(92vw,520px);padding:9px 14px;border-radius:12px;background:rgba(10,12,16,.82);color:#eef1f5;font:500 13px/1.35 Inter,system-ui,sans-serif;text-align:center;pointer-events:none;transition:opacity .8s';
  d.textContent = 'Restarted in a lighter mode, so Namba fits your phone’s memory.';
  document.body.appendChild(d);
  setTimeout(() => { d.style.opacity = '0'; }, 7000);
  setTimeout(() => d.remove(), 8200);
}

// Rough texture + canvas memory: every texture reachable from the scene (and the phone's 3D stack), sized from its
// image (× 4/3 with mips). For the perf sample; walks the scene graph, so call it rarely (once per sample).
export function memEstimate(ctx) {
  const seen = new Set(), cvs = new Set();
  let tex = 0, cv = 0;
  const addTex = (t) => {
    if (!t || !t.isTexture || seen.has(t)) return; seen.add(t);
    const im = t.image; if (!im) return;
    const w = im.width || 0, h = im.height || 0, d = im.depth || 1;
    const bpp = t.type === 1015 ? 16 : t.type === 1016 ? 8 : 4;          // Float / HalfFloat / bytes
    tex += w * h * d * bpp * (t.generateMipmaps && t.minFilter !== 1006 && t.minFilter !== 1003 ? 4 / 3 : 1);
    if (typeof HTMLCanvasElement !== 'undefined' && im instanceof HTMLCanvasElement && !cvs.has(im)) { cvs.add(im); cv += w * h * 4; }
  };
  const visit = (o) => {
    const m = o.material; if (!m) return;
    for (const mm of Array.isArray(m) ? m : [m]) for (const k in mm) { const v = mm[k]; if (v && v.isTexture) addTex(v); }
    if (m.uniforms) for (const k in m.uniforms) addTex(m.uniforms[k] && m.uniforms[k].value);
  };
  try { ctx.scene.traverse(visit); } catch (e) { /* ignore */ }
  try { const st = ctx.phone && ctx.phone.lodestone && ctx.phone.lodestone.stack; if (st && st.scene) st.scene.traverse(visit); } catch (e) { /* ignore */ }
  const MB = (b) => Math.round(b / 1048576);
  return { texMB: MB(tex), canvasMB: MB(cv), tex: seen.size };
}
