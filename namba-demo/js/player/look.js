// Eye ray, look point and look-target queries (generic: other areas register
// interactables; the player only supplies the eye and the cone test).
//
//   player.lookRay()                 -> THREE.Ray from the eye along the view (world space)
//   player.lookPoint                 -> {level, x, y, z, dist, kind:'wall'|'floor'|'ceiling'|'none'}
//                                       first surface hit by the eye ray (updated each frame, ≤ 8 m)
//   player.lookTarget(maxDist=3, {cone, filter})
//                                    -> {item, dist, angle, x, y, z} | null : the registered
//                                       interactable best aligned with the view within a cone
//   player.interactables.add({id, level, x, y?, z, radius?, ...anything}) -> remove fn
//
// Sources searched by lookTarget: player.interactables, any function added via
// player.addLookSource(fn => iterable of items), and duck-typed
// ctx.game.interactions.items / ctx.game.items (Map or array) when present.
import * as THREE from 'three';
import { LEVELS } from '../world/layout.js?v=c81de75';

export class InteractableSet {
  constructor() { this.items = new Map(); }
  add(def) {
    if (!def || def.id == null) throw new Error('interactable needs an id');
    this.items.set(def.id, def);
    return () => this.remove(def.id);
  }
  remove(id) { this.items.delete(typeof id === 'object' ? id.id : id); }
  values() { return this.items.values(); }
}

function rayHitSeg(ox, oz, dx, dz, s) {
  // ray o + t d against segment s (2D). returns t or Infinity
  const ex = s[2] - s[0], ez = s[3] - s[1];
  const den = dx * ez - dz * ex;
  if (Math.abs(den) < 1e-9) return Infinity;
  const qx = s[0] - ox, qz = s[1] - oz;
  const t = (qx * ez - qz * ex) / den;
  const u = (qx * dz - qz * dx) / den;
  return t >= 0 && u >= -1e-6 && u <= 1 + 1e-6 ? t : Infinity;
}

export class Look {
  constructor(player) {
    this.player = player;
    this.ray = new THREE.Ray();
    this.point = { level: null, x: 0, y: 0, z: 0, dist: Infinity, kind: 'none' };
    this.sources = [];
  }
  eyeRay(out = new THREE.Ray()) {
    const cam = this.player.ctx.engine.camera;
    out.origin.copy(cam.position);
    out.direction.set(0, 0, -1).applyQuaternion(cam.quaternion).normalize();
    return out;
  }
  // first wall / floor / ceiling hit along the eye ray (2D walls + level planes)
  updatePoint(maxDist = 8) {
    const p = this.player, world = p.ctx.world, b = p.body;
    const r = this.eyeRay(this.ray);
    const o = r.origin, d = r.direction;
    const hl = Math.hypot(d.x, d.z);
    let best = maxDist, kind = 'none';
    // floor / ceiling planes of the current level (or ramp surface approx.)
    const floorY = b.y;
    if (d.y < -1e-4) { const t = (floorY - o.y) / d.y; if (t > 0 && t < best) { best = t; kind = 'floor'; } }
    const sp = p.space; const ceil = sp && !sp.outdoor ? (LEVELS[b.level].y + (sp.ceil || 3.4)) : null;
    if (ceil != null && d.y > 1e-4) { const t = (ceil - o.y) / d.y; if (t > 0 && t < best) { best = t; kind = 'ceiling'; } }
    if (hl > 1e-4 && world.hash[b.level]) {
      const dx = d.x / hl, dz = d.z / hl;
      const maxH = best * hl;
      const segs = b.ramp >= 0 ? world.rampSegs[b.ramp] : null;
      const test = (s) => { const t = rayHitSeg(o.x, o.z, dx, dz, s); if (t < maxH && t / hl < best) { best = t / hl; kind = 'wall'; } };
      if (segs) for (const s of segs) test(s);
      else {
        const H = world.hash[b.level], all = world.segs[b.level];
        const seen = new Set();
        const n = Math.ceil(maxH / (H.size * 0.5)) + 1;
        for (let i = 0; i <= n; i++) {
          const t = Math.min(maxH, i * H.size * 0.5);
          const cx = Math.floor((o.x + dx * t) / H.size), cz = Math.floor((o.z + dz * t) / H.size);
          for (let oz = -1; oz <= 1; oz++) for (let ox = -1; ox <= 1; ox++) {
            const bucket = H.map.get((cx + ox) * 73856093 ^ (cz + oz) * 19349663);
            if (bucket) for (const k of bucket) if (!seen.has(k)) { seen.add(k); test(all[k]); }
          }
        }
      }
    }
    const P = this.point;
    P.level = b.level; P.dist = best; P.kind = kind;
    P.x = o.x + d.x * best; P.y = o.y + d.y * best; P.z = o.z + d.z * best;
    return P;
  }
  *_items() {
    const p = this.player, g = p.ctx.game;
    yield* p.interactables.values();
    for (const fn of this.sources) { try { const it = fn(); if (it) yield* it; } catch (e) { /* source failed */ } }
    const gi = g && (g.interactions && g.interactions.items || g.items);
    if (gi) yield* (gi.values ? gi.values() : gi);
  }
  target(maxDist = 3, opts = {}) {
    const p = this.player, b = p.body, world = p.ctx.world;
    const cone = opts.cone != null ? opts.cone : 12 * Math.PI / 180;
    const r = this.eyeRay(this.ray);
    const o = r.origin, d = r.direction;
    let best = null, bestScore = Infinity;
    for (const it of this._items()) {
      if (!it || it.enabled === false) continue;
      if (it.level && it.level !== '*' && it.level !== b.level) continue;
      if (opts.filter && !opts.filter(it)) continue;
      const iy = it.y != null ? it.y : LEVELS[b.level].y + 1.2;
      const vx = it.x - o.x, vy = iy - o.y, vz = it.z - o.z;
      const dist = Math.hypot(vx, vy, vz);
      const rad = it.lookRadius != null ? it.lookRadius : Math.min(0.6, it.radius != null ? it.radius * 0.35 : 0.35);
      if (dist - rad > maxDist) continue;
      const cos = (vx * d.x + vy * d.y + vz * d.z) / Math.max(1e-6, dist);
      const ang = Math.acos(Math.max(-1, Math.min(1, cos)));
      const allow = cone + Math.atan2(rad, Math.max(0.3, dist));
      if (ang > allow) continue;
      // something solid between? (2D line of sight to a point just short of it)
      const hl = Math.hypot(vx, vz);
      if (hl > 0.8 && world.visible && !world.visible(b.level, o.x, o.z, o.x + vx * (1 - 0.5 / hl), o.z + vz * (1 - 0.5 / hl))) continue;
      const score = ang / allow + 0.35 * dist / maxDist;
      if (score < bestScore) { bestScore = score; best = { item: it, dist, angle: ang, x: it.x, y: iy, z: it.z }; }
    }
    return best;
  }
}
