// =============================================================================
// NAMBA — bootstrap & main loop.
//
// Systems are plain classes:  constructor(ctx) · async init() · update(dt)
// Optional: afterBuild() (after all build systems), lateUpdate(dt) (after all
// updates, before render), onStart().
// Each is loaded with fault isolation: if one fails to import/init, the game
// still runs (errors are logged and shown in ?debug).
//
// ctx (shared, also window.__namba):
//   THREE, engine, scene, camera, world, nav, events, clock, input, params,
//   materials, player, and every system by name (ctx.crowd, ctx.audio, ...)
// =============================================================================
import * as THREE from 'three';
import { Engine } from './core/engine.js?v=a30ee4b';
import { Events } from './core/events.js?v=a30ee4b';
import { Clock } from './core/clock.js?v=a30ee4b';
import { Input } from './core/input.js?v=a30ee4b';
import { params } from './core/params.js?v=a30ee4b';
import { World } from './world/world.js?v=a30ee4b';
import { Nav } from './world/nav.js?v=a30ee4b';
import { LAYOUT } from './world/layout.js?v=a30ee4b';
import { Loader } from './core/loader.js?v=a30ee4b';
import { precompileVisible, precompileRest } from './render/precompile.js?v=a30ee4b';
import { bootTouch, TouchUI } from './ui/touch.js?v=a30ee4b';
import { setCanvasRes } from './render/canvasres.js?v=a30ee4b';
import { readRecovery, armRecovery } from './core/resilience.js?v=a30ee4b';
import { setGeoCompact } from './render/geobatch.js?v=a30ee4b';

// [name, module path, export name, phase]
// phase 'build' systems run before the nav graph (they may register obstacles);
// phase 'live' systems run after.
const SYSTEMS = [
  ['materials',    './render/materials.js?v=a30ee4b',   'Materials',    'build'],
  ['lighting',     './render/lighting.js?v=a30ee4b',    'Lighting',     'build'],
  ['architecture', './world/architecture.js?v=a30ee4b', 'Architecture', 'build'],
  ['props',        './world/props.js?v=a30ee4b',        'Props',        'build'],
  ['shops',        './world/shops.js?v=a30ee4b',        'Shops',        'build'],
  ['exterior',     './world/exterior.js?v=a30ee4b',     'Exterior',     'build'],
  ['parks',        './world/parks.js?v=a30ee4b',        'Parks',        'build'],
  ['transit',      './world/transit.js?v=a30ee4b',      'Transit',      'build'],
  ['signage',      './world/signage.js?v=a30ee4b',      'Signage',      'build'],
  ['player',       './player/player.js?v=a30ee4b',      'Player',       'live'],
  ['crowd',        './npc/crowd.js?v=a30ee4b',          'Crowd',        'live'],
  ['audio',        './audio/audio.js?v=a30ee4b',        'Audio',        'live'],
  ['phone',        './ui/phone.js?v=a30ee4b',           'Phone',        'live'],
  ['hud',          './ui/hud.js?v=a30ee4b',             'Hud',          'live'],
  ['game',         './game/game.js?v=a30ee4b',          'Game',         'live'],
  ['visibility',   './render/visibility.js?v=a30ee4b',  'Visibility',   'live'],
  ['post',         './render/post.js?v=a30ee4b',        'Post',         'live'],
  ['memdiet',      './render/memdiet.js?v=a30ee4b',     'MemDiet',      'live'],   // v15: phones drop static geometry's CPU copy
];

// Fetch every system's module graph in parallel right away (no evaluation): the sequential
// `await import()` below would otherwise pay one network round trip per dependency level per system.
try {
  for (const [, path] of SYSTEMS) {
    const l = document.createElement('link');
    l.rel = 'modulepreload'; l.href = new URL(path, import.meta.url).href;
    document.head.appendChild(l);
  }
} catch (e) { /* optional */ }

const loader = new Loader(document.getElementById('loading'));
const progress = (key, frac, msg) => loader.stage(key, frac, msg);
// let the loading screen repaint, but never wait on a busy GPU process for it (rAF can be late by seconds
// while uploads / PMREM are queued): whichever comes first, a frame or 50 ms
const frame = () => new Promise(r => { let d = false; const f = () => { if (!d) { d = true; r(); } }; requestAnimationFrame(f); setTimeout(f, 50); });
// v11: phones and tablets are first-class (landscape, on-screen controls: js/ui/touch.js). The old "best on a
// computer" gate is gone; a rotate-to-landscape card (index.html #rotate) shows in portrait instead.
const touchOnly = matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
// v18: frame cap. Phones run at 30 fps (every second frame of a 60 Hz display is skipped: half the work and heat). 0 = uncapped; ?fps=60 or ?fps=0 lifts it.
const fpsCap = params.has('fps') ? Math.max(0, +params.get('fps') || 0) : (touchOnly ? 30 : 0);
bootTouch();
const touchAck = Promise.resolve();
// v11.1 (iOS crash): did the last run die on screen (jetsam / lost GPU)? Then this boot starts a safe tier.
const recovery = readRecovery();
// v14 (the crash loop, PostHog 31 Oct): the pause menu let an iPhone reload into ?quality=ultra (662 MB of textures,
// killed while loading), and the recovery boot kept that forced tier, so every "safe" reload died the same way.
//   * after a crash, a forced tier is dropped (auto-detect: low on a phone) and ?quality leaves the URL, so the next
//     reload (or the home-screen app's relaunch) can't walk back into it;
//   * on a phone, high/ultra are never booted at all (medium is the ceiling); ?quality=…&force skips this for tests.
{
  const QO = ['low', 'medium', 'high', 'ultra'], qi = QO.indexOf(params.quality);
  const dropQ = () => { try { const u = new URL(location.href); u.searchParams.delete('quality'); history.replaceState(history.state, '', u.toString()); } catch (e) { /* ignore */ } };
  if (recovery && recovery.reason !== 'param' && qi > 0) { console.warn(`[resilience] dropping forced quality ${params.quality} after a crash`); params.quality = null; dropQ(); }
  else if (touchOnly && qi > 1 && !params.has('force')) { console.warn(`[quality] ${params.quality} is too heavy for a phone: medium`); params.quality = 'medium'; }
}

async function boot() {
  const canvas = document.getElementById('view');
  const engine = new Engine(canvas);
  engine.fpsCap = fpsCap;
  // v11 mobile default: phones and tablets start on `low` (engine.detectTier: coarse pointer), trimmed further for a
  // mid-range phone GPU/CPU to hold ~30 fps: a smaller pixel-ratio cap on phone-sized screens, fewer simulated people,
  // a shorter draw distance and draw-call budget. ?quality=… still forces a tier untouched.
  engine.mobile = touchOnly;   // v13 critic: also with ?quality forced (the Lodestone shared renderer, the phone audio profile)
  if (touchOnly && !engine.qualityForced) {
    const phone = Math.min(innerWidth, innerHeight) < 600;
    Object.assign(engine.quality, { crowdMax: phone ? 480 : 600, drawDist: phone ? 70 : 80, callBudget: phone ? 460 : 520, maxPR: phone ? 1.25 : 1.35, distFloor: phone ? 0.45 : 0.5 });   // v11 critic: 1.25 = desktop-low pixels on a phone; the call governor may pull in further; v17: crowd 320/420 → 480/600 (people are instances: no extra memory or draw calls), with a larger share kept near the player (npc/trips.js nearShare); v18: call budget 320/380 → 460/520 with the 30 fps cap (half the frames, so more calls per frame still means less work and heat)
    engine.basePR = Math.min(devicePixelRatio * engine.quality.pixelRatio, engine.quality.maxPR);
    engine.renderer.setPixelRatio(engine.basePR);
  }
  // v11.1 (iOS crash): world sign/menu/board canvases at fewer real pixels on touch devices. At 2048² they were 272 MB
  // of 2D canvas + ~250 MB of GPU copies at load (notes/v11.1-ioscrash.md); iOS Safari kills a tab around there.
  if (touchOnly && !params.has('fullres')) setCanvasRes({ atlas: 0.5, sign: 0.6, board: 0.5 });   // ?fullres: A/B check
  // v17: compact world geometry (Int8 normals, Uint8 colours) on phones; ?compact forces it on desktop, ?nocompact turns it off.
  setGeoCompact(!params.has('nocompact') && (touchOnly || params.has('compact')));
  // after a crash (or ?safe): fewer people, fewer pixels, smaller textures. Applies on any device, quality forced or not.
  if (recovery) {
    const S = recovery.safe >= 2;
    Object.assign(engine.quality, { crowdMax: S ? 140 : 220, drawDist: S ? 55 : 62, callBudget: S ? 240 : 280, maxPR: S ? 0.85 : 1.0, distFloor: 0.45, shadows: false, shadowMap: 0 });
    engine.renderer.shadowMap.enabled = false;
    engine.basePR = Math.min(devicePixelRatio * engine.quality.pixelRatio, engine.quality.maxPR);
    engine.renderer.setPixelRatio(engine.basePR);
    setCanvasRes(S ? { atlas: 0.35, sign: 0.42, board: 0.35 } : { atlas: 0.42, sign: 0.5, board: 0.42 });
    engine.safe = recovery.safe;
    console.warn(`[resilience] recovered from ${recovery.reason} at ${recovery.lastStage} (t ${recovery.t}s): safe tier ${recovery.safe}`);
  }
  const events = new Events();
  // v18: flight-recorder timings (read by core/resilience.js and analytics.js); one object, reused every frame
  const frameLog = { gapMax5: 0, tickMax5: 0, tickSys5: '', long: [], n: 0, stage: null };
  const ctx = {
    frameLog, fpsCap,
    THREE, engine, scene: engine.scene, camera: engine.camera, events, params, layout: LAYOUT,
    clock: new Clock(events), input: new Input(canvas),
    errors: [], systems: [], started: false, ready: false,
    ui: { root: document.getElementById('ui'), hud: document.getElementById('hud'), phone: document.getElementById('phone-root'), overlay: document.getElementById('overlay'), title: document.getElementById('title') },
  };
  window.__namba = ctx;
  armRecovery(ctx, recovery);
  progress('survey', 0.1);
  await frame();
  ctx.world = new World();
  progress('survey', 1);
  ctx.loadTimes = {};

  const load = async ([name, path, exp]) => {
    progress(name, 0);
    const tf = performance.now();
    await frame();
    const tl = performance.now(), waited = tl - tf;
    try {
      const mod = await import(path);
      const tImp = performance.now() - tl;
      const Cls = mod[exp] || mod.default;
      if (!Cls) throw new Error(`${path} has no export ${exp}`);
      const sys = new Cls(ctx);
      ctx[name] = sys;
      const t0 = performance.now();
      if (sys.init) await sys.init();
      ctx.systems.push({ name, sys });
      console.log(`[load] ${name} init ${(performance.now() - t0).toFixed(0)}ms, import ${tImp.toFixed(0)}ms, frame-wait ${waited.toFixed(0)}ms (at ${(performance.now() / 1000).toFixed(1)}s)`);
    } catch (e) {
      console.error(`[system ${name}] failed`, e);
      ctx.errors.push(`${name}: ${e.message}`);
    }
    ctx.loadTimes[name] = Math.round(performance.now() - tl);
    loader.finish(name);
  };
  for (const s of SYSTEMS.filter(s => s[3] === 'build')) await load(s);
  // post-build passes (lighting bakes, batching, etc.)
  progress('bake', 0);
  await frame();
  for (const { name, sys } of ctx.systems) if (sys.afterBuild) {
    try { await sys.afterBuild(); } catch (e) { console.error(`[system ${name}] afterBuild failed`, e); ctx.errors.push(`${name}.afterBuild: ${e.message}`); }
  }
  loader.finish('bake');
  progress('nav', 0);
  await frame();
  // finalise collision with obstacles registered by builders, then nav
  for (const lv in ctx.world.grids) ctx.world._buildHash(lv);
  ctx.nav = new Nav(ctx.world);
  loader.finish('nav');
  for (const s of SYSTEMS.filter(s => s[3] === 'live')) await load(s);
  // v11: phones & tablets (on-screen controls, rotate card, fullscreen). Not a loader stage: it builds no world.
  try { const t = new TouchUI(ctx); ctx.touch = t; t.init(); ctx.systems.push({ name: 'touch', sys: t }); }
  catch (e) { console.error('[system touch] failed', e); ctx.errors.push(`touch: ${e.message}`); }
  if (params.debug) setupDebug(ctx);
  import('./ui/perf.js?v=a30ee4b').then((m) => { ctx.perf = new m.Perf(ctx); }).catch((e) => console.warn('[perf]', e.message));   // hidden Ctrl+Shift+F / F3 FPS overlay (not a loader stage)
  import('./analytics.js?v=a30ee4b').then((m) => m.setupAnalytics(ctx)).catch((e) => console.warn('[analytics]', e.message));   // v7.4 journey funnel (PostHog; off locally / in tests)

  ctx.start = () => {
    if (ctx.started) return;
    ctx.started = true;
    for (const { sys } of ctx.systems) if (sys.onStart) try { sys.onStart(); } catch (e) { console.error(e); }
    events.emit('game:start', {});
  };
  // teleport (test harness / debug): name of a spawn or {level,x,z,yaw,pitch}
  ctx.teleport = (t) => {
    const sp = typeof t === 'string' ? LAYOUT.spawns[t] : t;
    if (!sp || !ctx.player) return false;
    const b = ctx.player.body;
    b.level = sp.level; b.x = sp.x; b.z = sp.z; b.ramp = -1;
    ctx.world.move(b, 0, 0, ctx.player.radius);
    if (sp.yaw != null) ctx.player.yaw = sp.yaw;
    ctx.player.pitch = sp.pitch || 0;
    ctx.player._camY = null;
    events.emit('player:teleport', { level: b.level });
    return true;
  };
  // ---- main loop -------------------------------------------------------------
  let last = performance.now();
  let acc = 0, frames = 0;
  // v18: tick timing. Two 2.5 s buckets (current and previous) give a rolling 5 s maximum without per-frame allocation.
  let lastTickMs = 0, lastTickSys = '';
  let bAt = performance.now(), gA = 0, gB = 0, kA = 0, kB = 0, sA = '', sB = '';
  const playSec = () => Math.round((ctx.game && ctx.game.demo && ctx.game.demo.t) || 0);
  const recordFrame = (now, gap) => {
    frameLog.n++;
    if (now - bAt > 5000) { gA = gB = kA = kB = 0; sA = sB = ''; bAt = now; }
    else if (now - bAt > 2500) { gB = gA; kB = kA; sB = sA; gA = 0; kA = 0; sA = ''; bAt = now; }
    if (gap > gA) gA = gap;
    if (lastTickMs > kA) { kA = lastTickMs; sA = lastTickSys; }
    frameLog.gapMax5 = gA > gB ? gA : gB;
    if (kA >= kB) { frameLog.tickMax5 = kA; frameLog.tickSys5 = sA; } else { frameLog.tickMax5 = kB; frameLog.tickSys5 = sB; }
    if (gap < 400 || !ctx.started) return;        // (loading and the title screen stall by design: only play counts)
    const L = frameLog.long;
    if (L.length >= 5 && gap <= L[L.length - 1].ms) return;
    let st = null;
    try { st = typeof frameLog.stage === 'function' ? frameLog.stage() : null; } catch (e) { /* hook only */ }
    L.push({ ms: Math.round(gap), t: playSec(), sys: lastTickSys, stage: st });
    L.sort((a, b) => b.ms - a.ms);
    if (L.length > 5) L.length = 5;
    if (gap >= 1000) { try { events.emit('app:longtask', { ms: Math.round(gap), sys: lastTickSys, t: playSec() }); } catch (e) { /* recorder only */ } }
  };
  // a backgrounded tab is not a stall: restart the gap clock whenever visibility changes
  document.addEventListener('visibilitychange', () => { last = performance.now(); });
  ctx.tick = (dt) => {
    const T0 = performance.now();
    ctx.input.update();
    if (!params.freeze) ctx.clock.update(dt);
    let tp = performance.now(), slow = 0, slowName = '';
    for (const { name, sys } of ctx.systems) {
      if (!sys.update) continue;
      try { sys.update(dt); } catch (e) { if (!sys.__err) { console.error(`[${name}.update]`, e); ctx.errors.push(`${name}.update: ${e.message}`); } sys.__err = true; }
      const t1 = performance.now();
      if (t1 - tp > slow) { slow = t1 - tp; slowName = name; }
      tp = t1;
    }
    for (const { sys } of ctx.systems) if (sys.lateUpdate) try { sys.lateUpdate(dt); } catch (e) { /* logged once above */ }
    { const t1 = performance.now(); if (t1 - tp > slow) { slow = t1 - tp; slowName = 'late'; } tp = t1; }
    engine.render(dt);
    { const t1 = performance.now(); if (t1 - tp > slow) { slow = t1 - tp; slowName = 'render'; } lastTickMs = t1 - T0; }
    lastTickSys = slowName;
    engine.stats.frame++;
    ctx.input.endFrame();
  };
  const loop = (now) => {
    // v18: phone frame cap; a skipped frame does not touch `last` or tick
    if (fpsCap > 0 && now - last < 1000 / fpsCap - 3) { requestAnimationFrame(loop); return; }
    const gapMs = now - last;
    const dt = Math.min(0.05, gapMs / 1000);
    last = now;
    acc += dt; frames++;
    if (acc >= 0.5) { engine.stats.fps = frames / acc; engine.stats.ms = (acc / frames) * 1000; acc = 0; frames = 0; }
    ctx.tick(dt);
    if (!document.hidden) { try { recordFrame(now, gapMs); } catch (e) { /* recorder only */ } }
    requestAnimationFrame(loop);
  };

  // ---- go ---------------------------------------------------------------------
  // `ctx.ready` = every system is built and the game is interactive. The main loop starts now and
  // renders behind the loading screen; the loader only lifts once the shaders for the spawn view
  // are compiled (in parallel where the driver allows it) and a few real frames have been drawn,
  // so the first thing a player sees is a smooth, fully lit frame (not a half-second stall).
  ctx.ready = true;
  console.log(`[load] systems ready in ${(performance.now() / 1000).toFixed(1)}s`);
  if (params.test) events.emit('game:ready', {});
  if (params.test && (params.skip || !ctx.game)) ctx.start();
  if (!ctx.game) canvas.addEventListener('click', () => ctx.input.requestLock());
  requestAnimationFrame(loop);

  progress('compile', 0);
  try {
    if (ctx.visibility) ctx.visibility.update(1 / 60);
    await precompileVisible(ctx, (f) => progress('compile', f * 0.9), params.test ? 20000 : 12000);
  } catch (e) { console.warn('[render] precompile failed', e); }
  progress('compile', 0.92, 'Drawing the first frame…');
  const t1 = performance.now();
  while (engine.stats.frame < 3 && performance.now() - t1 < (params.test ? 600000 : 20000)) await new Promise(r => setTimeout(r, 40));
  await touchAck;
  if (!params.test) events.emit('game:ready', {});
  loader.done();
  console.log(`[load] first frames drawn, loader lifted at ${(performance.now() / 1000).toFixed(1)}s`);
  ctx.firstFrame = true;
  if (!params.test && (params.skip || !ctx.game)) ctx.start();
  if (!params.test) precompileRest(ctx);
}

function setupDebug(ctx) {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;left:8px;top:8px;font:11px/1.35 ui-monospace,monospace;color:#9f9;background:rgba(0,0,0,.6);padding:6px 8px;z-index:99;white-space:pre;pointer-events:none';
  document.body.appendChild(el);
  setInterval(() => {
    const p = ctx.player && ctx.player.body;
    const s = ctx.engine.stats;
    el.textContent = `${s.fps.toFixed(0)} fps  ${s.ms.toFixed(1)} ms  calls ${s.calls}  tris ${(s.tris / 1000).toFixed(0)}k\n` +
      (p ? `${p.level}  x ${p.x.toFixed(1)}  z ${p.z.toFixed(1)}  y ${p.y.toFixed(2)}  ramp ${p.ramp}  zone ${ctx.player.zone}  space ${ctx.player.space ? ctx.player.space.id : '-'}\n` : '') +
      `time ${ctx.clock.hhmm}  ${ctx.crowd && ctx.crowd.debugText ? ctx.crowd.debugText() : ''}\n` +
      (ctx.errors.length ? 'ERRORS:\n' + ctx.errors.join('\n') : '');
  }, 250);
}

boot().catch(e => { console.error(e); const m = document.querySelector('#loading .ld-msg'); if (m) m.textContent = 'Failed to start: ' + e.message; });
