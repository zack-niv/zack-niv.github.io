// =============================================================================
// v15 — memory diet for phones: drop the CPU copy of static geometry once the GPU has it.
//
// Every BufferAttribute keeps its Float32Array in JS memory after it has been uploaded to the GPU. On an iPhone the
// GPU shares that same memory, so static world geometry counted twice (~118 MB of arrays measured at boot on the Low
// tier, notes in the v15 commit). three.js calls attribute.onUploadCallback() right after each upload; the documented
// pattern drops the array there. We only ever need the copy again to rebuild after a lost GPU context, and
// core/resilience.js reloads the page in that case.
//
// What is released (conservative on purpose: a wrong release is a crash or a missing wall):
//   * a plain THREE.BufferAttribute (not instanced, not interleaved) with static usage, already uploaded
//   * on a Mesh that is neither instanced nor skinned, and that is the ONLY user of its geometry in the scene
//     (shared geometries are prototypes that GeoBatch merges again later)
//   * not inside a shop interior ('shop:*' groups: built and released at runtime, and npc/places.js reads their
//     vertices to find seats)
//   * the geometry's bounding sphere / box are computed first (frustum culling needs them, and they need the array)
// Never released: index-less dynamic data, instance matrices/colours (trains, gates, crowd, traffic), textures and
// 2D canvases (sign / atlas pages redraw at runtime).
//
// A pass runs DELAY s after the game starts (after the load-time readers: clipIntrusions, the crowd's places scan) and
// every EVERY s after that (lazily built halls and storefronts). Phones only; ?memdiet forces it on, ?nomemdiet off.
//   ctx.memdiet.stats → { passes, attrs, mb }
// =============================================================================
import * as THREE from 'three';

const DELAY = 8, EVERY = 30;

// mark every attribute when it reaches the GPU (instances that set their own onUpload keep theirs)
let marked = false;
function markUploads() {
  if (marked) return; marked = true;
  const mark = function () { this.__up = true; };
  for (const C of [THREE.BufferAttribute]) C.prototype.onUploadCallback = mark;
}

export class MemDiet {
  constructor(ctx) {
    this.ctx = ctx;
    const p = ctx.params;
    this.on = !p.has('nomemdiet') && (p.has('memdiet') || !!(ctx.engine && ctx.engine.mobile));
    this.stats = { passes: 0, attrs: 0, mb: 0 };
    ctx.memdiet = this;
    if (!this.on) return;
    markUploads();
    this._t = -1;
    ctx.events.on('game:start', () => { this._t = 0; });
  }
  update(dt) {
    if (!this.on || this._t < 0) return;
    this._t += dt;
    if (this._t < DELAY) return;
    this._t = DELAY - EVERY;          // next pass EVERY s from now
    try { this.pass(); } catch (e) { console.warn('[memdiet]', e && e.message); this.on = false; }
  }
  pass() {
    const scene = this.ctx.scene; if (!scene) return;
    const users = new Map(), meshes = [];
    const walk = (o, inShop) => {
      if (o.name && o.name.startsWith('shop:')) inShop = true;
      if (o.isMesh && o.geometry) {
        users.set(o.geometry, (users.get(o.geometry) || 0) + 1);
        if (!inShop && !o.isInstancedMesh && !o.isSkinnedMesh && !o.isBatchedMesh) meshes.push(o);
      }
      const ch = o.children; for (let i = 0; i < ch.length; i++) walk(ch[i], inShop);
    };
    walk(scene, false);
    let n = 0, bytes = 0;
    for (const m of meshes) {
      const g = m.geometry;
      if (users.get(g) !== 1 || g.userData.keepArrays) continue;
      const list = [g.index];
      for (const k in g.attributes) list.push(g.attributes[k]);
      for (const k in g.morphAttributes) { if (g.morphAttributes[k].length) list.length = 0; }    // morphs: leave alone
      if (!list.length) continue;
      let ok = true;
      for (const a of list) if (a && (!a.isBufferAttribute || a.isInstancedBufferAttribute || a.isInterleavedBufferAttribute || a.usage !== THREE.StaticDrawUsage || !a.__up)) { ok = false; break; }
      if (!ok || !g.attributes.position || g.attributes.position.__freed) continue;
      if (!g.boundingSphere) g.computeBoundingSphere();
      if (!g.boundingBox) g.computeBoundingBox();
      for (const a of list) {
        if (!a || !a.array) continue;
        bytes += a.array.byteLength; n++;
        // count, itemSize and version stay: three only reads the array to (re)upload. An empty array of the same
        // type (not null): a stray read gets undefined instead of throwing inside a system's update
        a.array = new a.array.constructor(0);
        a.__freed = true;
        // a stray needsUpdate would re-upload the empty array (the mesh would vanish): ignore it instead
        Object.defineProperty(a, 'needsUpdate', { configurable: true, set() { /* released: the GPU copy is final */ } });
      }
    }
    this.stats.passes++; this.stats.attrs += n; this.stats.mb = Math.round((this.stats.mb * 1048576 + bytes) / 1048576);
    if (n) console.log(`[memdiet] pass ${this.stats.passes}: released ${n} arrays, ${(bytes / 1048576).toFixed(1)} MB (total ${this.stats.mb} MB)`);
  }
}
