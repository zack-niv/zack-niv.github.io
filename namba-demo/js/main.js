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
import { Engine } from './core/engine.js';
import { Events } from './core/events.js';
import { Clock } from './core/clock.js';
import { Input } from './core/input.js';
import { params } from './core/params.js';
import { World } from './world/world.js';
import { Nav } from './world/nav.js';
import { LAYOUT } from './world/layout.js';
import { Loader } from './core/loader.js';
import { precompileVisible, precompileRest } from './render/precompile.js';
import { bootTouch, TouchUI } from './ui/touch.js';
import { setCanvasRes } from './render/canvasres.js';
import { readRecovery, armRecovery } from './core/resilience.js';

// [name, module path, export name, phase]
// phase 'build' systems run before the nav graph (they may register obstacles);
// phase 'live' systems run after.
const SYSTEMS = [
  ['materials',    './render/materials.js',   'Materials',    'build'],
  ['lighting',     './render/lighting.js',    'Lighting',     'build'],
  ['architecture', './world/architecture.js', 'Architecture', 'build'],
  ['props',        './world/props.js',        'Props',        'build'],
  ['shops',        './world/shops.js',        'Shops',        'build'],
  ['exterior',     './world/exterior.js',     'Exterior',     'build'],
  ['parks',        './world/parks.js',        'Parks',        'build'],
  ['transit',      './world/transit.js',      'Transit',      'build'],
  ['signage',      './world/signage.js',      'Signage',      'build'],
  ['player',       './player/player.js',      'Player',       'live'],
  ['crowd',        './npc/crowd.js',          'Crowd',        'live'],
  ['audio',        './audio/audio.js',        'Audio',        'live'],
  ['phone',        './ui/phone.js',           'Phone',        'live'],
  ['hud',          './ui/hud.js',             'Hud',          'live'],
  ['game',         './game/game.js',          'Game',         'live'],
  ['visibility',   './render/visibility.js',  'Visibility',   'live'],
  ['post',         './render/post.js',        'Post',         'live'],
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
bootTouch();
const touchAck = Promise.resolve();
// v11.1 (iOS crash): did the last run die on screen (jetsam / lost GPU)? Then this boot starts a safe tier.
const recovery = readRecovery();

async function boot() {
  const canvas = document.getElementById('view');
  const engine = new Engine(canvas);
  // v11 mobile default: phones and tablets start on `low` (engine.detectTier: coarse pointer), trimmed further for a
  // mid-range phone GPU/CPU to hold ~30 fps: a smaller pixel-ratio cap on phone-sized screens, fewer simulated people,
  // a shorter draw distance and draw-call budget. ?quality=… still forces a tier untouched.
  if (touchOnly && !engine.qualityForced) {
    const phone = Math.min(innerWidth, innerHeight) < 600;
    Object.assign(engine.quality, { crowdMax: phone ? 320 : 420, drawDist: phone ? 70 : 80, callBudget: phone ? 320 : 380, maxPR: phone ? 1.25 : 1.35, distFloor: phone ? 0.45 : 0.5 });   // v11 critic: 1.25 = desktop-low pixels on a phone; the call governor may pull in further
    engine.basePR = Math.min(devicePixelRatio * engine.quality.pixelRatio, engine.quality.maxPR);
    engine.renderer.setPixelRatio(engine.basePR);
    engine.mobile = true;
  }
  // v11.1 (iOS crash): world sign/menu/board canvases at fewer real pixels on touch devices. At 2048² they were 272 MB
  // of 2D canvas + ~250 MB of GPU copies at load (notes/v11.1-ioscrash.md); iOS Safari kills a tab around there.
  if (touchOnly && !params.has('fullres')) setCanvasRes({ atlas: 0.5, sign: 0.6, board: 0.5 });   // ?fullres: A/B check
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
  const ctx = {
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
  import('./ui/perf.js').then((m) => { ctx.perf = new m.Perf(ctx); }).catch((e) => console.warn('[perf]', e.message));   // hidden Ctrl+Shift+F / F3 FPS overlay (not a loader stage)
  import('./analytics.js').then((m) => m.setupAnalytics(ctx)).catch((e) => console.warn('[analytics]', e.message));   // v7.4 journey funnel (PostHog; off locally / in tests)

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
  ctx.tick = (dt) => {
    ctx.input.update();
    if (!params.freeze) ctx.clock.update(dt);
    for (const { name, sys } of ctx.systems) {
      if (!sys.update) continue;
      try { sys.update(dt); } catch (e) { if (!sys.__err) { console.error(`[${name}.update]`, e); ctx.errors.push(`${name}.update: ${e.message}`); } sys.__err = true; }
    }
    for (const { sys } of ctx.systems) if (sys.lateUpdate) try { sys.lateUpdate(dt); } catch (e) { /* logged once above */ }
    engine.render(dt);
    engine.stats.frame++;
    ctx.input.endFrame();
  };
  const loop = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    acc += dt; frames++;
    if (acc >= 0.5) { engine.stats.fps = frames / acc; engine.stats.ms = (acc / frames) * 1000; acc = 0; frames = 0; }
    ctx.tick(dt);
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
