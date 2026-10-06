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
const frame = () => new Promise(r => requestAnimationFrame(() => r()));
// touch-only device (phone/tablet): polite "best on a computer" card, load continues behind it
const touchOnly = !params.test && matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
let touchAck = Promise.resolve();
try { if (touchOnly && sessionStorage.getItem('namba.touchOK') !== '1') touchAck = loader.touchGate(); } catch (e) { if (touchOnly) touchAck = loader.touchGate(); }

async function boot() {
  const canvas = document.getElementById('view');
  const engine = new Engine(canvas);
  const events = new Events();
  const ctx = {
    THREE, engine, scene: engine.scene, camera: engine.camera, events, params, layout: LAYOUT,
    clock: new Clock(events), input: new Input(canvas),
    errors: [], systems: [], started: false, ready: false,
    ui: { root: document.getElementById('ui'), hud: document.getElementById('hud'), phone: document.getElementById('phone-root'), overlay: document.getElementById('overlay'), title: document.getElementById('title') },
  };
  window.__namba = ctx;
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
  if (params.debug) setupDebug(ctx);

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
  // ---- shaders + first frame (under the loading screen) -----------------------
  // Compile the programs the spawn view needs in parallel (no main-thread stall), then draw one
  // frame behind the loader so texture uploads / shadow map happen before anyone is watching.
  progress('compile', 0);
  await frame();
  try {
    if (ctx.visibility) ctx.visibility.update(1 / 60);
    await precompileVisible(ctx, (f) => progress('compile', f), params.test ? 20000 : 12000);
    progress('compile', 0.97, 'Drawing the first frame…');
    await frame();
    engine.render(1 / 60);
  } catch (e) { console.warn('[render] precompile/first frame failed', e); }
  await touchAck;
  ctx.ready = true;
  events.emit('game:ready', {});
  loader.done();
  console.log(`[load] ready in ${(performance.now() / 1000).toFixed(1)}s`);
  if (params.skip || !ctx.game) ctx.start();
  if (!params.test) precompileRest(ctx);
  if (!ctx.game) canvas.addEventListener('click', () => ctx.input.requestLock());

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
  requestAnimationFrame(loop);
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
