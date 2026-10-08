// =============================================================================
// Shader pre-compilation, staged so the first frame never stalls on the driver.
//
//   precompileVisible(ctx, onProgress, capMs)  — programs for what the spawn
//        camera can see (chunks left visible by Visibility, global roots, crowd,
//        UI props). All batches are kicked off at once (KHR_parallel_shader_compile
//        compiles them on driver threads) and the loader waits on them, with a
//        hard time cap so a slow driver can never hold the loading screen.
//   precompileRest(ctx)                        — every remaining chunk, trickled
//        in the background (a few chunks per ~150 ms) once the game is running,
//        so walking into a new district doesn't hitch. Skipped in ?test runs.
//
// compile() takes any Object3D and only traverses its `.children`, so we hand it
// throw-away proxy groups whose `children` array points at the real chunks
// (no re-parenting, nothing in the scene graph changes).
// =============================================================================
import * as THREE from 'three';
import { LEVEL_ORDER } from '../world/layout.js?v=488c31e';

function proxy(list) { const g = new THREE.Group(); g.children = list; return g; }

// scene-level objects that are not a level root (sky, crowd, lights, phone…)
function sceneExtras(engine) {
  const roots = new Set(LEVEL_ORDER.map(l => engine.levelRoot(l)));
  // lights are excluded: the target scene's lights are already used, and a second copy would create
  // program variants (2 directional lights) that nothing ever renders with
  return engine.scene.children.filter(o => !roots.has(o) && !o.isLight && !(engine.ctx && engine.ctx.lighting && engine.ctx.lighting.sun && engine.ctx.lighting.sun.target === o));
}

function chunkGroups(engine, onlyVisible) {
  const out = [];
  for (const lv of LEVEL_ORDER) {
    const root = engine.levelRoot(lv); if (!root) continue;
    if (onlyVisible && !root.visible) continue;
    for (const c of root.children) {
      if (onlyVisible && !c.layers.isEnabled(0)) continue;
      c.userData.nbLvl = lv; out.push(c);
    }
  }
  return out;
}

function withTarget(ctx, fn) {
  const r = ctx.engine.renderer, post = ctx.post;
  const prev = r.getRenderTarget();
  if (post && post.enabled && post.sceneRT) r.setRenderTarget(post.sceneRT);
  try { return fn(); } finally { r.setRenderTarget(prev); }
}

export async function precompileVisible(ctx, onProgress, capMs = 15000) {
  const { engine } = ctx;
  const r = engine.renderer, cam = engine.camera, scene = engine.scene;
  const t0 = performance.now();
  // Without KHR_parallel_shader_compile (software GL, some drivers) compileAsync can't overlap anything:
  // compiling programs for objects that may never be drawn would only add work, so let the first
  // frames compile exactly what is on screen.
  if (!r.extensions.has('KHR_parallel_shader_compile')) { console.log('[render] precompile skipped (no KHR_parallel_shader_compile)'); return true; }
  const list = chunkGroups(engine, true);
  ctx._compiled = new Set(list);
  const extras = sceneExtras(engine);
  // split into batches so progress is meaningful; extras go first (they are always on screen)
  const per = Math.max(4, Math.ceil(list.length / 14));
  const batches = [proxy(extras)];
  for (let i = 0; i < list.length; i += per) batches.push(proxy(list.slice(i, i + per)));
  let done = 0;
  const promises = [];
  withTarget(ctx, () => {
    for (const b of batches) {
      try {
        const p = r.compileAsync(b, cam, scene);
        promises.push(p.then(() => { done++; onProgress && onProgress(done / batches.length); }, () => { done++; }));
      } catch (e) { done++; console.warn('[render] precompile batch failed', e); }
    }
  });
  if (ctx.post && ctx.post.precompile) promises.push(...ctx.post.precompile());
  const syncMs = performance.now() - t0;
  const timeout = new Promise(res => setTimeout(() => res('timeout'), Math.max(0, capMs - syncMs)));
  const res = await Promise.race([Promise.all(promises), timeout]);
  const progs = r.info.programs ? r.info.programs.length : 0;
  console.log(`[render] precompile: ${batches.length} batches, ${progs} programs, ${(performance.now() - t0).toFixed(0)} ms${res === 'timeout' ? ' (hit cap)' : ''}`);
  return res !== 'timeout';
}

// background: all remaining chunks, a few at a time. Returns a cancel function.
export function precompileRest(ctx) {
  const { engine } = ctx;
  const r = engine.renderer, cam = engine.camera, scene = engine.scene;
  const seen = ctx._compiled || new Set();
  const todo = chunkGroups(engine, false).filter(c => !seen.has(c));
  // nearest levels to the player first
  const own = ctx.player ? LEVEL_ORDER.indexOf(ctx.player.body.level) : 0;
  const dist = (c) => Math.abs(LEVEL_ORDER.indexOf(c.userData.nbLvl) - own);
  todo.sort((a, b) => dist(a) - dist(b));
  let i = 0, stop = false;
  const step = () => {
    if (stop || i >= todo.length) { if (!stop) console.log(`[render] background precompile finished (${r.info.programs.length} programs)`); return; }
    // wait until the game is actually running and the frame is healthy
    const slow = ctx.engine.stats.ms > 24;
    if (!ctx.started || slow) { setTimeout(step, 400); return; }
    const batch = todo.slice(i, i += 3);
    withTarget(ctx, () => { try { r.compileAsync(proxy(batch), cam, scene).catch(() => {}); } catch (e) { /* skip */ } });
    setTimeout(step, 160);
  };
  setTimeout(step, 1500);
  return () => { stop = true; };
}
