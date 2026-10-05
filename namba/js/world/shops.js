// =============================================================================
// Shops: storefronts + walkable interiors for every slot in world/directory.js,
// the Takashimaya depachika (B1) and cosmetics hall (1F).
//
// Public API (for crowd / game / phone):
//   ctx.shops.spots(slotId)      -> [{x,z,level,yaw,kind}] kind: browse|counter|queue|seat|staff
//   ctx.shops.counter(slotId)    -> {x,z,level,yaw,kind:'counter'} service point (order here)
//   ctx.shops.queuePoints(slotId)-> [{x,z,level,yaw}] first = at the door, then back along the line
//   ctx.shops.hallSpots(spaceId) -> spots of 'taka_b1' (depachika) / 'taka_1f'
//   ctx.shops.isShuttered(slotId)-> true while the shutter is down (outside opening hours)
//   ctx.shops.record(slotId)     -> { b, cx, cz, level, W, D, front, group }
// 'staff' spots may sit inside counter areas (spawn in place, don't path).
// Events: emits 'shop:shutter' { slot, closed } when a shutter opens/closes.
// =============================================================================
import * as THREE from 'three';
import { BUSINESSES, isOpen } from './directory.js';
import { LAYOUT } from './layout.js';
import { Atlas } from './env/atlas.js';
import { defineMaterials, ChunkBatches, loadFonts } from './env/kit.js';
import { ShopCtx } from './env/shopctx.js';
import { buildShop, regions } from './env/shopbuild.js';
import { FEATURED_BUILD, FEATURED_STYLE, buildDepachika, buildTaka1F } from './env/featured.js';

// one shared environment context (atlases, chunk batches) for shops + props
export function envFor(ctx) {
  if (ctx._envDressing) return ctx._envDressing;
  defineMaterials(ctx.materials);
  const env = {
    ctx, world: ctx.world, materials: ctx.materials,
    sign: new Atlas('env_sign', { lit: true, glow: 1.5 }),
    print: new Atlas('env_print', { lit: false, boost: 0.28 }),
    chunks: new ChunkBatches(32, 'env'),
    lights: [],
  };
  try {
    const maxA = ctx.engine.renderer.capabilities.getMaxAnisotropy();
    for (const a of [env.sign, env.print]) a._aniso = Math.min(8, maxA);
  } catch (e) { /* headless */ }
  env.R = regions(env);
  ctx._envDressing = env;
  return env;
}

// gather every non-ASCII glyph we will draw so the webfont subsets load
async function glyphText() {
  const files = ['js/world/env/draw.js', 'js/world/env/catalog.js', 'js/world/env/featured.js', 'js/world/env/shopbuild.js', 'js/world/props.js', 'js/world/env/screens.js'];
  let txt = BUSINESSES.map(b => b.ja + b.en).join('');
  await Promise.all(files.map(async f => { try { const r = await fetch(f); if (r.ok) txt += (await r.text()).replace(/[\x00-\x7f]/g, ''); } catch (e) { /* ignore */ } }));
  return txt + '¥0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
}

export class Shops {
  constructor(ctx) {
    this.ctx = ctx;
    this.recs = new Map();
    this.halls = {};
    this._t = 0;
    this._shutterReady = false;
  }

  async init() {
    const ctx = this.ctx;
    const t0 = performance.now();
    const env = envFor(ctx);
    if (!env._fontsLoaded) { await loadFonts([await glyphText()]); env._fontsLoaded = true; }
    const R = env.R;
    const bySlot = new Map(BUSINESSES.map(b => [b.slot, b]));
    let tris = 0;
    for (const slot of LAYOUT.shopSlots) {
      const b = bySlot.get(slot.id);
      if (!b) continue;
      try {
        const S = new ShopCtx(env, slot, b);
        if (b.key && FEATURED_STYLE[b.key]) S.styleOverride = FEATURED_STYLE[b.key];
        buildShop(S, R);
        if (b.key && FEATURED_BUILD[b.key]) FEATURED_BUILD[b.key](S);
        if (!S.counterPt) S.spot('counter', S.W / 2, Math.min(2, S.D - 1), 0, 1);
        if (!S.queue.length) S.spot('queue', S.W / 2, -0.7, 0, 1);
        // interior batch -> per-shop group (distance-culled)
        const group = new THREE.Group();
        group.name = 'shop:' + slot.id;
        group.userData.chunk = { level: slot.level, x: S.cx, z: S.cz, r: Math.hypot(S.W, S.D) / 2 + 1 };
        for (const m of S.inner.gb.build(ctx.materials, { name: 'shop' })) { m.receiveShadow = false; group.add(m); }
        ctx.engine.levelRoot(slot.level).add(group);
        tris += S.inner.tris + S.front.tris;
        this.recs.set(slot.id, { b, S, group, cx: S.cx, cz: S.cz, y: S.y + 1.5, level: slot.level, spots: S.spots, counter: S.counterPt, queue: S.queue, closedNow: null });
        for (const l of S.lights) env.lights.push(l);
      } catch (e) {
        console.error('[shops] slot', slot.id, e);
        ctx.errors.push(`shops: ${slot.id}: ${e.message}`);
      }
    }
    try { this.halls.taka_b1 = buildDepachika(env, R); } catch (e) { console.error('[shops] depachika', e); ctx.errors.push('shops: depachika ' + e.message); }
    try { this.halls.taka_1f = buildTaka1F(env, R); } catch (e) { console.error('[shops] taka_1f', e); ctx.errors.push('shops: taka_1f ' + e.message); }
    this._buildShutters();
    // emit merged chunk meshes now (props added theirs before us) so lighting
    // bake passes in afterBuild() see them; declare our lights
    this.afterBuild();
    this.stats = { buildMs: Math.round(performance.now() - t0), shops: this.recs.size, tris, sign: env.sign.stats(), print: env.print.stats() };
  }

  // Called by props (or here if props never ran) once all builders are done.
  afterBuild() {
    const env = envFor(this.ctx);
    if (!env._chunksBuilt) {
      env._chunksBuilt = true;
      env.chunks.build(this.ctx);
      env.sign.touch(); env.print.touch();
    }
    if (!env._lightsAdded && this.ctx.lighting) {
      env._lightsAdded = true;
      for (const l of env.lights) this.ctx.lighting.addLight(l);
    }
  }

  // ---- shutters ---------------------------------------------------------------
  _buildShutters() {
    const ctx = this.ctx;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = ctx.materials.get('env_shutter');
    if (mat.map) { mat.map.repeat.set(1, 3); }
    const perLevel = new Map();
    for (const rec of this.recs.values()) {
      if (rec.b.cat === 'closed') continue;
      (perLevel.get(rec.level) || perLevel.set(rec.level, []).get(rec.level)).push(rec);
    }
    this.shutterMeshes = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    for (const [level, list] of perLevel) {
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      mesh.name = 'shop:shutters:' + level;
      mesh.frustumCulled = false;
      list.forEach((rec, i) => {
        const S = rec.S;
        const a0 = S.doorA0, a1 = S.doorA1;
        const w = S.world((a0 + a1) / 2, 0.06);
        rec.shutter = { mesh, i, pos: new THREE.Vector3(w.x, S.y + S.doorTop / 2, w.z), rot: S.f.rot, w: a1 - a0, h: S.doorTop, box: null };
        rec.shutter.boxDef = (() => { const p0 = S.world(a0, 0.0), p1 = S.world(a1, 0.12); return { cx: (p0.x + p1.x) / 2, cz: (p0.z + p1.z) / 2, hx: Math.max(0.03, Math.abs(p1.x - p0.x) / 2), hz: Math.max(0.03, Math.abs(p1.z - p0.z) / 2), rot: 0 }; })();
        m.compose(p.set(0, -1000, 0), q.identity(), s.set(0, 0, 0));
        mesh.setMatrixAt(i, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
      ctx.engine.levelRoot(level).add(mesh);
      this.shutterMeshes.push(mesh);
    }
    this._m = m; this._q = q; this._p = p; this._s = s;
    // initial state (visual only; collision added once the hash exists)
    this._applyShutters(this.ctx.clock ? this.ctx.clock.minutes : 642, false);
    ctx.events.on('time:tick', ({ minutes }) => this._applyShutters(minutes, true));
  }

  _applyShutters(minutes, collide) {
    const { _m: m, _q: q, _p: p, _s: s } = this;
    const dirty = new Set();
    const rehash = new Set();
    for (const [id, rec] of this.recs) {
      if (!rec.shutter) continue;
      const closed = !isOpen(rec.b, minutes);
      if (closed === rec.closedNow && (!collide || this._shutterReady)) continue;
      const sh = rec.shutter;
      if (closed) { q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), sh.rot); m.compose(sh.pos, q, s.set(sh.w, sh.h, 0.05)); }
      else m.compose(p.set(0, -1000, 0), q.identity(), s.set(0, 0, 0));
      sh.mesh.setMatrixAt(sh.i, m);
      dirty.add(sh.mesh);
      if (collide) {
        const W = this.ctx.world, lv = rec.level;
        if (closed && !sh.box && W.hash[lv]) { sh.box = { ...sh.boxDef }; W.obstacles[lv].push(sh.box); W._insertBox(lv, sh.box); }
        if (!closed && sh.box) { W.obstacles[lv] = W.obstacles[lv].filter(o => o !== sh.box); sh.box = null; rehash.add(lv); }
      }
      if (rec.closedNow !== null && rec.closedNow !== closed) this.ctx.events.emit('shop:shutter', { slot: id, closed });
      rec.closedNow = closed;
    }
    for (const mesh of dirty) mesh.instanceMatrix.needsUpdate = true;
    for (const lv of rehash) this.ctx.world._buildHash(lv);
    if (collide) this._shutterReady = true;
  }

  update(dt) {
    if (!this._shutterReady && this.ctx.nav) this._applyShutters(this.ctx.clock.minutes, true);
    // distance culling of interiors (every ~0.2 s)
    this._t -= dt;
    if (this._t > 0) return;
    this._t = 0.2;
    const cam = this.ctx.engine.camera.position;
    const far = this.ctx.engine.qualityName === 'low' ? 30 : 46;
    const f2 = far * far;
    for (const rec of this.recs.values()) {
      const dx = rec.cx - cam.x, dy = (rec.y - cam.y) * 3, dz = rec.cz - cam.z;
      const v = dx * dx + dy * dy + dz * dz < f2;
      if (rec.group.visible !== v) rec.group.visible = v;
    }
  }

  // ---- API ----------------------------------------------------------------------
  record(id) { const r = this.recs.get(id); return r ? { b: r.b, cx: r.cx, cz: r.cz, level: r.level, W: r.S.W, D: r.S.D, front: r.S.slot.front, group: r.group } : null; }
  spots(id) { const r = this.recs.get(id); return r ? r.spots.slice() : []; }
  counter(id) { const r = this.recs.get(id); return r ? r.counter : null; }
  queuePoints(id) { const r = this.recs.get(id); return r ? r.queue.slice() : []; }
  hallSpots(spaceId) { const h = this.halls[spaceId]; return h ? h.spots.slice() : []; }
  isShuttered(id) { const r = this.recs.get(id); return !!(r && r.closedNow); }
}
