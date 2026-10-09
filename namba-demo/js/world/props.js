// =============================================================================
// Props: the everyday objects of Namba's corridors, halls and platforms.
//
//   vending machine banks (+ recycling bins), slat benches, planters, ATM
//   corners, gacha-capsule walls, wall posters / ad light boxes, animated
//   digital signage (wall screens + totems), pillar ad wraps, back-to-back
//   benches, planter benches, and the Crystal fountain in the NAMBAWALK court.
//   Metro platform ad frames from Architecture get their artwork here.
//
// Build strategy (same as shops.js): init() does a cheap LOGIC pass over the
// walk grid (placement, claim grid, world.addBox collision, light fixtures,
// seat points). Geometry is produced lazily per 32 m chunk when the camera
// comes near (and once fonts are ready), merged per material.
//
// Public API (ctx.props):
//   items                 -> [{k, level, x, z, rot, ...}] every placed prop
//   list(kind)            -> items of one kind: vend|bench|bench2|planter|atm|gacha|totem|planterbench|fountain
//   seats                 -> [{level, x, z, yaw, sit:true, kind}] benches (crowd may sit)
//   wallItems             -> [{kind, level, x, z, nx, nz, a, y0, y1}] things hung on walls (posters/screens)
//   fountain              -> {level, x, z, r}
//   buildNear(level,x,z,r)-> force-build geometry around a point
// Solid furniture is registered with ctx.world.addBox; wall art is flush (no box).
// =============================================================================
import * as THREE from 'three';
import { envFor } from './shops.js?v=f150c03';
import { Frame, Painter, ChunkBatches, rgb, mix, WHITE } from './env/kit.js?v=f150c03';
import * as D from './env/draw.js?v=f150c03';
import { CELL } from './world.js?v=f150c03';
import { LAYOUT, LEVELS } from './layout.js?v=f150c03';
import { GeoBatch } from '../render/geobatch.js?v=f150c03';
import { rng, hash } from '../core/rng.js?v=f150c03';

const CHUNK = 32;
const BUILD_R = 90;
const FORCE_R = 70;
const K = (hex, k = 1) => rgb(hex, k);
const G = 1.5;   // lit atlas multiplier (matches shops)

// ---- per-style placement profiles ---------------------------------------------------
// dens: probability of a module per 3.4 m of free wall; kinds: module weights;
// art: probability of a wall poster/screen per 3.2 m; free: free-standing spacing (m) or 0
const PROFILE = {
  metro_platform:   { dens: 0.55, kinds: { bench: 4, vend: 2, bin: 1 }, art: 0, free: 16 },
  metro_concourse:  { dens: 0.5, kinds: { vend: 4, bench: 1, atm: 1.2, plant: 0.6, gacha: 1, bin: 1 }, art: 0.6, free: 16 },
  arcade:           { dens: 0.4, kinds: { vend: 3, bench: 1, plant: 1, gacha: 1.2, bin: 1 }, art: 0.7, free: 30 },
  arcade_court:     { dens: 0.5, kinds: { bench: 2, plant: 2, vend: 1, gacha: 1, bin: 1 }, art: 0.5, free: 0 },
  passage:          { dens: 0.5, kinds: { vend: 3, bench: 1.5, plant: 1, gacha: 1.2, atm: 0.8, bin: 1 }, art: 0.7, free: 30 },
  city_plaza:       { dens: 0.4, kinds: { bench: 2, plant: 2, vend: 1.5, bin: 1 }, art: 0.5, free: 16 },
  city_mall:        { dens: 0.4, kinds: { vend: 2, bench: 1, plant: 1.5, bin: 1, atm: 0.6 }, art: 0.5, free: 28 },
  city_court:       { dens: 0.55, kinds: { bench: 2, plant: 2, vend: 1.5, gacha: 1, bin: 1 }, art: 0.6, free: 14 },
  dining_street:    { dens: 0.35, kinds: { vend: 2, bench: 1, plant: 1, bin: 1 }, art: 0.4, free: 0 },
  terminal_hall:    { dens: 0.55, kinds: { vend: 3, bench: 2, atm: 1.2, plant: 1, bin: 2, gacha: 0.6 }, art: 0.7, free: 12 },
  terminal_concourse: { dens: 0.5, kinds: { vend: 3, bench: 1.5, atm: 1, plant: 1, bin: 2 }, art: 0.7, free: 12 },
  terminal_platform: { dens: 0, kinds: {}, art: 0, free: 20 },
  parks_indoor:     { dens: 0.4, kinds: { plant: 3, bench: 2, vend: 1, bin: 1 }, art: 0.3, free: 0 },
  parks_dining:     { dens: 0.4, kinds: { plant: 3, bench: 2, vend: 1, bin: 1 }, art: 0.3, free: 0 },
};
// kinds -> footprint: len along the wall, depth into the hall, clear in front, tall (blocks wall art)
const MOD = {
  vend:  { depth: 0.78, clear: 1.5, tall: true },
  bench: { len: 1.9, depth: 0.58, clear: 1.2, tall: false },
  plant: { len: 1.3, depth: 0.62, clear: 1.2, tall: true },
  atm:   { len: 2.5, depth: 0.95, clear: 1.8, tall: true },
  gacha: { len: 3.2, depth: 0.5, clear: 1.4, tall: true },
  bin:   { len: 1.5, depth: 0.5, clear: 1.2, tall: false },
};
const AD_BY = {
  metro: ['drink', 'beer', 'movie', 'phone', 'travel', 'concert', 'museum', 'expo'],
  arcade: ['cosme', 'travel', 'halloween', 'autumn', 'phone', 'ramenfair', 'concert', 'drink'],
  city: ['cosme', 'movie', 'halloween', 'autumn', 'expo', 'concert', 'drink', 'museum'],
  nankai: ['travel', 'museum', 'expo', 'drink', 'beer', 'ramenfair'],
  parks: ['autumn', 'cosme', 'concert', 'expo', 'halloween'],
};
const adSet = (zone) => AD_BY[zone === 'midosuji' || zone === 'sennichimae' ? 'metro' : zone === 'nambawalk' || zone === 'link' || zone === 'takashimaya' ? 'arcade' : zone === 'nankai' ? 'nankai' : zone === 'parks' || zone === 'parksGarden' ? 'parks' : 'city'];
const VEND_BODY = [[0.9, 0.9, 0.9], [0.1, 0.3, 0.64], [0.17, 0.17, 0.17], [0.06, 0.54, 0.29], [0.95, 0.95, 0.95]];

// =============================================================================
export class Props {
  constructor(ctx) {
    this.ctx = ctx;
    this.items = []; this.seats = []; this.wallItems = [];
    this.fountain = null;
    this.units = new Map();
    this.screens = null;
    this._q = 0; this._sT = 0;
  }

  init() {
    const t0 = performance.now();
    const ctx = this.ctx;
    const env = this.env = envFor(ctx);
    this.world = ctx.world;
    this.claim = {};
    for (const lv in ctx.world.grids) { const g = ctx.world.grids[lv]; this.claim[lv] = new Uint8Array(g.w * g.h); }
    this._prepare();
    const guard = (name, fn) => { try { fn(); } catch (e) { console.error('[props]', name, e); ctx.errors.push(`props: ${name}: ${e.message}`); } };
    guard('fountain', () => this._fountain());
    guard('display', () => this._plazaDisplay());
    guard('flags', () => this._flags());
    guard('wall', () => this._wallFurniture());
    guard('free', () => this._freeStanding());
    guard('art', () => this._wallArt());
    guard('columns', () => this._columnAds());
    guard('platform ads', () => this._platformAds());
    // group items per chunk
    for (const it of this.items) {
      const k = `${it.level}|${Math.floor(it.x / CHUNK)}|${Math.floor(it.z / CHUNK)}`;
      let u = this.units.get(k);
      if (!u) this.units.set(k, u = { key: k, level: it.level, x: (Math.floor(it.x / CHUNK) + 0.5) * CHUNK, z: (Math.floor(it.z / CHUNK) + 0.5) * CHUNK, y: LEVELS[it.level].y + 1.5, items: [], built: false });
      u.items.push(it);
    }
    ctx.events.on('player:teleport', () => this._forceNear());
    this.stats = { initMs: Math.round(performance.now() - t0), items: this.items.length, units: this.units.size };
  }

  // ---- obstacle lists for placement tests ------------------------------------------
  _prepare() {
    const W = this.world, ctx = this.ctx;
    this.doors = {}; this.ramps = {}; this.gates = {}; this.pts = {};
    const add = (m, lv, v) => (m[lv] || (m[lv] = [])).push(v);
    for (const s of LAYOUT.spaces) if (s.kind === 'room') for (const d of s.doors) add(this.doors, s.level, [Math.min(d[0], d[2]), Math.min(d[1], d[3]), Math.max(d[0], d[2]), Math.max(d[1], d[3])]);
    for (const r of LAYOUT.ramps) for (const lv of [r.lower, r.upper]) {
      const [x0, z0, x1, z1] = r.rect, ro = 4;
      add(this.ramps, lv, r.axis === 'z' ? [x0 - 1.8, z0 - ro, x1 + 1.8, z1 + ro] : [x0 - ro, z0 - 1.8, x1 + ro, z1 + 1.8]);
    }
    for (const g of LAYOUT.gates) add(this.gates, g.level, g.axis === 'x' ? [g.from - 2, g.at - 4, g.to + 2, g.at + 4] : [g.at - 4, g.from - 2, g.at + 4, g.to + 2]);
    for (const p of LAYOUT.pois) add(this.pts, p.level, [p.x, p.z, 2.5]);
    for (const e of LAYOUT.exits) add(this.pts, e.level, [e.x, e.z, 4]);
    for (const k in LAYOUT.spawns) { const s = LAYOUT.spawns[k]; if (s.level) add(this.pts, s.level, [s.x, s.z, 3]); }
    this.cols = {};
    const A = ctx.architecture;
    for (const c of (A && A.columns) || []) add(this.cols, c.level, [c.x - c.hx - 0.7, c.z - c.hz - 0.7, c.x + c.hx + 0.7, c.z + c.hz + 0.7]);
    // shop frontage keep-out: 3 m out from every door
    for (const sl of LAYOUT.shopSlots) {
      const [x0, z0, x1, z1] = sl.door, o = 2.3;
      const f = sl.front === 'n' ? [0, -o] : sl.front === 's' ? [0, o] : sl.front === 'w' ? [-o, 0] : [o, 0];
      add(this.doors, sl.level, [Math.min(x0, x1, x0 + f[0], x1 + f[0]) - 0.3, Math.min(z0, z1, z0 + f[1], z1 + f[1]) - 0.3, Math.max(x0, x1, x0 + f[0], x1 + f[0]) + 0.3, Math.max(z0, z1, z0 + f[1], z1 + f[1]) + 0.3]);
    }
  }
  _inRects(list, x, z, m = 0) { if (!list) return false; for (const r of list) if (x > r[0] - m && x < r[2] + m && z > r[1] - m && z < r[3] + m) return true; return false; }
  _nearTactile(lv, x, z, m) {
    const T = this.env.tactile && this.env.tactile[lv]; if (!T) return false;
    for (const [ax, az, bx, bz] of T) {
      const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez;
      let t = l2 ? ((x - ax) * ex + (z - az) * ez) / l2 : 0; t = Math.max(0, Math.min(1, t));
      if (Math.hypot(x - ax - ex * t, z - az - ez * t) < m) return true;
    }
    return false;
  }
  _nearPt(lv, x, z) { const l = this.pts[lv]; if (!l) return false; for (const [px, pz, r] of l) if (Math.hypot(x - px, z - pz) < r) return true; return false; }

  // free walkable cell (not blocked, not claimed, not in a shop)
  _cell(lv, x, z, needFree = true) {
    const g = this.world.grids[lv]; const i = g.cellOf(x, z);
    if (i < 0 || g.type[i] !== CELL.WALK) return -1;
    if (g.blocked[i]) return -1;
    const sp = LAYOUT.spaces[g.space[i]];
    if (!sp || sp.kind === 'room') return -1;
    if (needFree && this.claim[lv][i] & 1) return -1;
    return i;
  }
  // is a rect (centre q, axes t/n, extents a: ±ha, d: d0..d1 along n from q) usable
  // `foot`: also apply keep-out tests (doors, ramps, gates, tactile, columns, POIs)
  _rectOk(lv, q, t, n, ha, d0, d1, foot) {
    for (let a = -ha; a <= ha + 0.01; a += 0.5) for (let d = d0; d <= d1 + 0.01; d += 0.5) {
      const x = q[0] + t[0] * a + n[0] * d, z = q[1] + t[1] * a + n[1] * d;
      if (this._cell(lv, x, z) < 0) return false;
      if (foot) {
        if (this._inRects(this.doors[lv], x, z) || this._inRects(this.ramps[lv], x, z) || this._inRects(this.gates[lv], x, z) || this._inRects(this.cols[lv], x, z)) return false;
        if (this._nearTactile(lv, x, z, 1.15) || this._nearPt(lv, x, z)) return false;
      }
    }
    return true;
  }
  _claim(lv, q, t, n, ha, d0, d1, tall) {
    const g = this.world.grids[lv];
    for (let a = -ha - 0.4; a <= ha + 0.41; a += 0.4) for (let d = d0 - 0.4; d <= d1 + 0.41; d += 0.4) {
      const i = g.cellOf(q[0] + t[0] * a + n[0] * d, q[1] + t[1] * a + n[1] * d);
      if (i >= 0) this.claim[lv][i] |= tall ? 3 : 1;
    }
  }
  // free run into the hall from a wall point (m), counting walkable steps
  _run(lv, q, n, max = 7) {
    let d = 0.25;
    for (; d < max; d += 0.5) if (this._cell(lv, q[0] + n[0] * d, q[1] + n[1] * d, false) < 0) break;
    return d;
  }

  _push(it) { this.items.push(it); return it; }
  _box(lv, cx, cz, hx, hz) { this.world.addBox(lv, cx, cz, Math.max(0.05, hx - 0.01), Math.max(0.05, hz - 0.01), 0); }
  _addLight(lv, x, y, z, color, intensity, range, kind = 'lamp', dir) {
    const l = { level: lv, x, y: LEVELS[lv].y + y, z, color, intensity, range, kind, src: 'env' };
    if (dir) l.dir = dir;
    this.env.lights.push(l);
  }

  // ===================================================================================
  // wall-hugging furniture
  // ===================================================================================
  _wallFurniture() {
    const W = this.world;
    for (const lv of Object.keys(W.edges)) {
      const g = W.grids[lv];
      const edges = W.edges[lv].filter(e => e.kind === 'wall' && !e.twoSided && (e.nx || e.nz));
      edges.forEach((e, ei) => {
        const L = Math.hypot(e.bx - e.ax, e.bz - e.az);
        if (L < 1.6) return;
        const n = [e.nx, e.nz], t = [(e.bx - e.ax) / L, (e.bz - e.az) / L];
        const mid = [(e.ax + e.bx) / 2 + n[0] * 0.5, (e.az + e.bz) / 2 + n[1] * 0.5];
        const si = g.spaceAt(mid[0], mid[1]);
        const sp = LAYOUT.spaces[si];
        if (!sp || sp.kind === 'room' || sp.outdoor) return;
        const prof = PROFILE[sp.style]; if (!prof || !prof.dens) return;
        const r = rng(hash(`wf|${lv}|${ei}|${e.ax}|${e.az}`));
        const kinds = Object.entries(prof.kinds);
        const tot = kinds.reduce((a, [, w]) => a + w, 0);
        let s = 0.5 + r() * 1.2;
        while (s < L - 1.2) {
          if (r() > prof.dens) { s += 3.4; continue; }
          let x = r() * tot, kind = kinds[0][0];
          for (const [k, w] of kinds) { x -= w; if (x <= 0) { kind = k; break; } }
          const placed = this._module(lv, e, sp, t, n, s, L, kind, r);
          s += placed ? placed + 1.2 + r() * 2.2 : 1.0;
        }
      });
    }
  }

  // try to place one module starting at s along the edge; returns its length or 0
  _module(lv, e, sp, t, n, s, L, kind, r) {
    const M = MOD[kind] || MOD.bin;
    let len = M.len, count = 0;
    if (kind === 'vend') { count = 1 + Math.floor(r() * 4); if (r() < 0.25) count = 1; len = count * 0.82 + 0.1; }
    if (kind === 'gacha') len = r() < 0.5 ? 3.2 : 4.4;
    if (kind === 'bench' && sp.style === 'metro_platform') len = 2.4;
    if (s + len > L - 0.5) {
      if (kind === 'vend' && L - 0.5 - s >= 0.9) { count = Math.min(count, Math.floor((L - 0.5 - s - 0.1) / 0.82)); len = count * 0.82 + 0.1; }
      else return 0;
    }
    const sc = s + len / 2;
    const q = [e.ax + t[0] * sc, e.az + t[1] * sc];
    const ha = len / 2, dep = M.depth;
    // free corridor run: keep at least 3 m of aisle
    if (this._run(lv, q, n) < dep + 3.0) return 0;
    if (!this._rectOk(lv, q, t, n, ha + 0.1, 0.25, dep, true)) return 0;
    if (!this._rectOk(lv, q, t, n, ha, dep + 0.25, dep + M.clear, false)) return 0;
    const rot = Math.atan2(-n[0], -n[1]);
    const it = { k: kind === 'bin' ? 'bin' : kind, level: lv, x: q[0], z: q[1], rot, n, len, depth: dep, count, seed: Math.floor(r() * 1e9), style: sp.style, zone: sp.zone };
    // collision: footprint box (world axis-aligned)
    const cx = q[0] + n[0] * dep / 2, cz = q[1] + n[1] * dep / 2;
    const alongX = Math.abs(t[0]) > 0.5;
    this._box(lv, cx, cz, alongX ? ha : dep / 2, alongX ? dep / 2 : ha);
    this._claim(lv, q, t, n, ha, 0, dep, M.tall);
    this._push(it);
    if (kind === 'vend') {
      this._addLight(lv, q[0] + n[0] * 1.2, 1.5, q[1] + n[1] * 1.2, [0.82, 0.92, 1], 0.4, 3.6, 'lamp');
      // sometimes a bin set beside the bank
      if (r() < 0.55 && s + len + 1.6 < L - 0.4) {
        const q2 = [e.ax + t[0] * (s + len + 0.1 + 0.75), e.az + t[1] * (s + len + 0.1 + 0.75)];
        if (this._rectOk(lv, q2, t, n, 0.75, 0.25, 0.5, true)) {
          const cx2 = q2[0] + n[0] * 0.25, cz2 = q2[1] + n[1] * 0.25;
          this._box(lv, cx2, cz2, alongX ? 0.75 : 0.25, alongX ? 0.25 : 0.75);
          this._claim(lv, q2, t, n, 0.75, 0, 0.5, false);
          this._push({ k: 'bin', level: lv, x: q2[0], z: q2[1], rot, n, len: 1.5, depth: 0.5, seed: Math.floor(r() * 1e9) });
          len += 1.6;
        }
      }
    }
    if (kind === 'bench') {
      const yaw = Math.atan2(-n[0], -n[1]);   // seated people face into the hall (player yaw convention: 0 = -z)
      for (const off of [-0.5, 0.5]) this.seats.push({ level: lv, x: q[0] + t[0] * off + n[0] * 0.3, z: q[1] + t[1] * off + n[1] * 0.3, yaw, sit: true, kind: 'bench' });
    }
    if (kind === 'atm') this._addLight(lv, q[0] + n[0] * 0.9, 2.1, q[1] + n[1] * 0.9, [0.7, 0.85, 1], 0.5, 4, 'lamp');
    if (kind === 'gacha') this._addLight(lv, q[0] + n[0] * 0.9, 1.7, q[1] + n[1] * 0.9, [1, 0.9, 0.7], 0.45, 4, 'lamp');
    return len;
  }

  // ===================================================================================
  // free-standing items in wide halls and platforms
  // ===================================================================================
  _freeStanding() {
    const W = this.world;
    for (const sp of LAYOUT.spaces) {
      if (sp.kind === 'room' || sp.outdoor || !sp.rect) continue;
      const prof = PROFILE[sp.style]; if (!prof || !prof.free) continue;
      const [x0, z0, x1, z1] = sp.rect;
      const w = x1 - x0, h = z1 - z0;
      const alongX = w >= h, long = alongX ? w : h, short = alongX ? h : w;
      if (short < 5.5) continue;
      const lines = short >= 30 ? 3 : short >= 16 ? 2 : 1;
      const r = rng(hash('free|' + sp.id));
      const pitch = prof.free;
      for (let li = 0; li < lines; li++) {
        const lat = (li + 0.5) / lines * short;
        for (let u = pitch * (0.4 + r() * 0.4); u < long - 3; u += pitch * (0.75 + r() * 0.5)) {
          const x = alongX ? x0 + u : x0 + lat, z = alongX ? z0 + lat : z0 + u;
          const platform = sp.style === 'terminal_platform' || sp.style === 'metro_platform';
          const kinds = platform ? ['bench2'] : sp.style.startsWith('city') || sp.style.startsWith('arcade') ? ['planterbench', 'totem', 'bench2'] : ['totem', 'bench2', 'planterbench', 'totem'];
          const kind = kinds[Math.floor(r() * kinds.length)];
          const ex = kind === 'totem' ? [0.5, 0.2] : kind === 'planterbench' ? [1.3, 0.85] : [1.0, 0.5];
          const ro = alongX ? 0 : Math.PI / 2;
          const ax = alongX ? ex[0] : ex[1], az = alongX ? ex[1] : ex[0];
          this._placeFree(kind, sp, x, z, ax, az, ro, r);
        }
      }
    }
  }
  _placeFree(kind, sp, x, z, hx, hz, ro, r) {
    const lv = sp.level;
    const q = [x, z];
    // clear ring and no keep-outs
    for (let dx = -hx - 1.6; dx <= hx + 1.61; dx += 0.5) for (let dz = -hz - 1.6; dz <= hz + 1.61; dz += 0.5) {
      const px = x + dx, pz = z + dz;
      if (this._cell(lv, px, pz) < 0) return false;
      const inFoot = Math.abs(dx) <= hx + 0.5 && Math.abs(dz) <= hz + 0.5;
      if (inFoot && (this._inRects(this.doors[lv], px, pz) || this._inRects(this.ramps[lv], px, pz) || this._inRects(this.gates[lv], px, pz) || this._inRects(this.cols[lv], px, pz))) return false;
      if (this._nearTactile(lv, px, pz, inFoot ? 1.3 : 0.5) || this._nearPt(lv, px, pz)) return false;
    }
    this._box(lv, x, z, hx, hz);
    this._claim(lv, q, [1, 0], [0, 1], hx, -hz, hz, true);
    const it = this._push({ k: kind, level: lv, x, z, rot: ro, hx, hz, seed: Math.floor(r() * 1e9), zone: sp.zone, style: sp.style });
    if (kind === 'bench2') {
      const along = ro === 0 ? [1, 0] : [0, 1], nrm = ro === 0 ? [0, 1] : [1, 0];
      for (const sd of [-1, 1]) for (const off of [-0.45, 0.45]) this.seats.push({ level: lv, x: x + along[0] * off + nrm[0] * sd * 0.2, z: z + along[1] * off + nrm[1] * sd * 0.2, yaw: Math.atan2(-nrm[0] * sd, -nrm[1] * sd), sit: true, kind: 'bench' });
    }
    if (kind === 'planterbench') {
      const along = ro === 0 ? [1, 0] : [0, 1], nrm = ro === 0 ? [0, 1] : [1, 0];
      for (const sd of [-1, 1]) for (const off of [-0.5, 0.5]) this.seats.push({ level: lv, x: x + along[0] * off + nrm[0] * sd * 0.55, z: z + along[1] * off + nrm[1] * sd * 0.55, yaw: Math.atan2(-nrm[0] * sd, -nrm[1] * sd), sit: true, kind: 'bench' });
    }
    if (kind === 'totem') {
      it.src = Math.floor(r() * 4);
      this._addLight(lv, x, 1.6, z, [0.85, 0.9, 1], 0.5, 4.5, 'lamp');
    }
    return true;
  }

  // ===================================================================================
  // wall art: posters, light boxes, digital screens (flush, no collision)
  // ===================================================================================
  _wallArt() {
    const W = this.world;
    for (const lv of Object.keys(W.edges)) {
      const g = W.grids[lv];
      const edges = W.edges[lv].filter(e => e.kind === 'wall' && !e.twoSided && (e.nx || e.nz));
      edges.forEach((e, ei) => {
        const L = Math.hypot(e.bx - e.ax, e.bz - e.az);
        if (L < 2.2) return;
        const n = [e.nx, e.nz], t = [(e.bx - e.ax) / L, (e.bz - e.az) / L];
        const mid = [(e.ax + e.bx) / 2 + n[0] * 0.5, (e.az + e.bz) / 2 + n[1] * 0.5];
        const sp = LAYOUT.spaces[g.spaceAt(mid[0], mid[1])];
        if (!sp || sp.kind === 'room' || sp.outdoor) return;
        const prof = PROFILE[sp.style]; if (!prof || !prof.art) return;
        const r = rng(hash(`wa|${lv}|${ei}|${e.ax}|${e.az}`));
        const ads = adSet(sp.zone);
        let s = 0.8 + r() * 0.8;
        while (s < L - 1.6) {
          if (r() > prof.art) { s += 3.2; continue; }
          const screen = r() < 0.2 && L - s > 2.6;
          const rk = r();
          // wall programme: a wall is never empty (hose cabinet, AED, staff door, poster frame, screen)
          const kind0 = screen ? 'screen' : rk < 0.1 ? 'hose' : rk < 0.16 ? 'aed' : rk < 0.26 ? 'staffdoor' : 'poster';
          // posters keep their exact 2:3 art ratio (never stretched): width follows the room height
          const w = kind0 === 'screen' ? 1.8 : kind0 === 'hose' ? 0.75 : kind0 === 'aed' ? 0.34 : kind0 === 'staffdoor' ? 1.0 : Math.min(r() < 0.4 ? 0.95 : 1.2, (sp.ceil - 0.5 - 0.85) / 1.5);
          const sc = s + w / 2;
          const q = [e.ax + t[0] * sc, e.az + t[1] * sc];
          // stay off shop frontage, doors, ramps, columns; wall cells in front must be free of tall claims
          let ok = true;
          for (let a = -w / 2; a <= w / 2 + 0.01 && ok; a += 0.5) {
            const x = q[0] + t[0] * a + n[0] * 0.5, z = q[1] + t[1] * a + n[1] * 0.5;
            const i = this.world.grids[lv].cellOf(x, z);
            if (i < 0 || this.claim[lv][i] & 2) ok = false;
            else if (this._inRects(this.doors[lv], x, z, -0.3) || this._inRects(this.ramps[lv], x, z)) ok = false;
          }
          if (!ok) { s += 1.2; continue; }
          const kind = kind0;
          const pr = r() < 0.5 ? 1.5 : 1.35;
          const y0 = { screen: 1.55, hose: 0.55, aed: 1.2, staffdoor: 0.0 }[kind] ?? 0.85;
          const y1 = { screen: y0 + w * 0.5625, hose: 1.65, aed: 1.55, staffdoor: 2.1 }[kind] ?? y0 + w * 1.5;
          void pr;
          const it = this._push({ k: kind, level: lv, x: q[0], z: q[1], rot: Math.atan2(-n[0], -n[1]), n, w, y0, y1: Math.min(y1, sp.ceil - 0.5), ad: ads[Math.floor(r() * ads.length)], seed: Math.floor(r() * 1e9), src: Math.floor(r() * 4), zone: sp.zone });
          this.wallItems.push({ kind, level: lv, x: q[0], z: q[1], nx: n[0], nz: n[1], a: w, y0: it.y0, y1: it.y1 });
          // claim a thin strip so the next one keeps a gap
          this._claim(lv, q, t, n, w / 2, 0, 0.1, false);
          s += w + 0.9 + r() * 2.4;
        }
      });
    }
  }

  // ===================================================================================
  // pillar ad wraps on structural columns
  // ===================================================================================
  _columnAds() {
    const A = this.ctx.architecture;
    if (!A || !A.columns) return;
    for (const c of A.columns) {
      const zone = c.zone;
      if (zone === 'parks' || zone === 'takashimaya' || c.round) continue;
      const r = rng(hash('col|' + (c.id || `${c.level}${c.x}${c.z}`)));
      if (r() > 0.55) continue;
      const ads = adSet(zone);
      this._push({ k: 'colad', level: c.level, x: c.x, z: c.z, hx: c.hx, hz: c.hz, round: !!c.round, ad: ads[Math.floor(r() * ads.length)], seed: Math.floor(r() * 1e9), faces: r() < 0.5 ? 2 : 4 });
    }
    void LEVELS;
  }

  // ===================================================================================
  // metro platform ad frames (Architecture draws the frames; artwork lives here)
  // ===================================================================================
  _platformAds() {
    const A = this.ctx.architecture;
    if (!A || !A.adFrames) return;
    A.adFrames.forEach((f, i) => {
      const r = rng(hash('padf|' + i));
      const ads = AD_BY.metro;
      this._push({ k: 'platad', level: f.level, x: f.x, z: f.z, rot: Math.atan2(-f.nx, -f.nz), w: f.w, h: f.h, yc: f.y - LEVELS[f.level].y, ad: ads[(i * 3 + Math.floor(r() * 3)) % ads.length], seed: Math.floor(r() * 1e9), n: [f.nx, f.nz] });
    });
  }

  // ===================================================================================
  // NAMBAWALK court fountain
  // ===================================================================================
  _fountain() {
    const poi = LAYOUT.pois.find(p => p.id === 'walk_fountain');
    if (!poi) return;
    const lv = poi.level, cx = poi.x, cz = poi.z, R = 3.0;
    this.fountain = { level: lv, x: cx, z: cz, r: R };
    this._box(lv, cx, cz, R * 0.9, R * 0.9);
    this._push({ k: 'fountain', level: lv, x: cx, z: cz, r: R, rot: 0, seed: 7 });
    // clear ring claim
    const g = this.world.grids[lv];
    for (let z = Math.floor(cz - R - 2); z <= Math.ceil(cz + R + 2); z++) for (let x = Math.floor(cx - R - 2); x <= Math.ceil(cx + R + 2); x++) {
      if (Math.hypot(x + 0.5 - cx, z + 0.5 - cz) < R + 1.2) { const i = g.cellOf(x + 0.5, z + 0.5); if (i >= 0) this.claim[lv][i] |= 3; }
    }
    this._addLight(lv, cx, 2.6, cz, [0.75, 0.9, 1], 1.2, 12, 'lamp');
    this._makeJets(lv, cx, cz, R);
    // four benches (N/S/E/W) and four planters (diagonals), each tested for room
    const sp = LAYOUT.spaces.find(s => s.id === 'walk_court');
    const rr = rng(hash('fountain'));
    const spots = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    for (const [dx, dz] of spots) {
      const d = R + 1.15;
      const x = cx + dx * d, z = cz + dz * d;
      const hx = dz ? 0.95 : 0.3, hz = dz ? 0.3 : 0.95;
      if (!this._rectFreeSimple(lv, x, z, hx + 0.6, hz + 0.6)) continue;
      this._box(lv, x, z, hx, hz);
      this._push({ k: 'bench2', level: lv, x, z, rot: dz ? 0 : Math.PI / 2, hx: dz ? 1.0 : 0.5, hz: dz ? 0.5 : 1.0, seed: Math.floor(rr() * 1e9), zone: 'nambawalk', thin: true });
      for (const off of [-0.5, 0.5]) this.seats.push({ level: lv, x: x + (dz ? off : dx * 0.15), z: z + (dz ? dz * 0.15 : off), yaw: Math.atan2(-dx, -dz), sit: true, kind: 'bench' });
    }
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const d = R + 2.2;
      const x = cx + dx * d * 0.78, z = cz + dz * d * 0.78;
      if (!this._rectFreeSimple(lv, x, z, 1.2, 1.2)) continue;
      this._box(lv, x, z, 0.6, 0.6);
      this._push({ k: 'plantpot', level: lv, x, z, rot: 0, seed: Math.floor(rr() * 1e9) });
    }
    void sp;
  }
  // animated water jets (a handful of translucent cones, scaled in update())
  _makeJets(lv, cx, cz, R) {
    const geo = new THREE.CylinderGeometry(0.03, 0.13, 1, 6, 1, true); geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.8, 2.0), transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
    const grp = new THREE.Group(); grp.name = 'props:fountain-jets';
    grp.userData.chunk = { level: lv, x: cx, z: cz, r: R + 3 };
    this.jets = [];
    const y0 = LEVELS[lv].y + 1.82;
    const add = (x, z, y, h, ph) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(1, h, 1); m.userData.ph = ph; m.userData.h = h; m.frustumCulled = true; grp.add(m); this.jets.push(m); };
    add(cx, cz, y0, 1.0, 0);
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; add(cx + Math.cos(a) * (R - 0.45), cz + Math.sin(a) * (R - 0.45), LEVELS[lv].y + 0.45, 1.1 + (i % 2) * 0.4, i * 0.9); }
    this._makeCrystal(lv, cx, cz, grp);
    this.ctx.engine.levelRoot(lv).add(grp);
  }
  // vertical hanging banners (縦バナー) down the centre of the shopping streets, every ~12 m
  _flags() {
    const STY = new Set(['arcade', 'city_mall', 'passage', 'dining_street', 'city_plaza']);
    for (const sp of LAYOUT.spaces) {
      if (sp.kind === 'room' || sp.outdoor || !sp.rect || !STY.has(sp.style) || sp.ceil < 3.0) continue;
      const [x0, z0, x1, z1] = sp.rect, w = x1 - x0, h = z1 - z0, alongX = w >= h, long = alongX ? w : h, short = alongX ? h : w;
      if (short < 5.5 || long < 14) continue;
      const r = rng(hash('flag|' + sp.id));
      const g = this.world.grids[sp.level];
      for (let u = 6 + r() * 5; u < long - 4; u += 11 + r() * 3) {
        const lat = short / 2 + (r() - 0.5) * 1.2;
        const x = alongX ? x0 + u : x0 + lat, z = alongX ? z0 + lat : z0 + u;
        const i = g.cellOf(x, z);
        if (i < 0 || g.type[i] !== CELL.WALK || LAYOUT.spaces[g.space[i]].kind === 'room') continue;
        this._push({ k: 'vflag', level: sp.level, x, z, rot: alongX ? Math.PI / 2 : 0, ceil: sp.ceil, seed: Math.floor(r() * 1e9) });
      }
    }
  }
  // Namba CITY north plaza: a seasonal (Halloween) pumpkin display under the coffer
  _plazaDisplay() {
    const poi = LAYOUT.pois.find(p => p.id === 'city_rocket');
    if (!poi) return;
    const lv = poi.level;
    // nearest free spot to the landmark (the tactile route crosses the plaza itself)
    let x = null, z = 0, best = 1e9;
    for (let dx = -20; dx <= 20; dx += 1) for (let dz = -9; dz <= 9; dz += 1) {
      const d = Math.hypot(dx, dz * 1.5);
      if (d < best && this._rectFreeSimple(lv, poi.x + dx, poi.z + dz, 3.2, 3.2) && !this._nearPt(lv, poi.x + dx, poi.z + dz)) { best = d; x = poi.x + dx; z = poi.z + dz; }
    }
    if (x == null) return;
    this._box(lv, x, z, 2.1, 2.1);
    const g = this.world.grids[lv];
    for (let dz = -3.5; dz <= 3.5; dz += 1) for (let dx = -3.5; dx <= 3.5; dx += 1) { const i = g.cellOf(x + dx, z + dz); if (i >= 0) this.claim[lv][i] |= 3; }
    this._push({ k: 'display', level: lv, x, z, rot: 0, seed: 11 });
    this._addLight(lv, x, 3.0, z, [1, 0.7, 0.35], 1.2, 9, 'lamp');
  }
  _rectFreeSimple(lv, x, z, hx, hz) {
    for (let dx = -hx; dx <= hx + 0.01; dx += 0.5) for (let dz = -hz; dz <= hz + 0.01; dz += 0.5) {
      const i = this._cell(lv, x + dx, z + dz, false);
      if (i < 0) return false;
      if (this._nearTactile(lv, x + dx, z + dz, 0.6)) return false;
    }
    return true;
  }

  // ===================================================================================
  // lazy geometry
  // ===================================================================================
  _ensureScreens() {
    if (this.screens) return this.screens;
    const S = [];
    for (let i = 0; i < 4; i++) {
      const c = document.createElement('canvas'); c.width = 768; c.height = 432;
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
      const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1, 1, 1).multiplyScalar(1.8) });
      mat.name = 'props_screen' + i;
      S.push({ c, g: c.getContext('2d'), tex, mat, slide: -1, t: 0 });
    }
    this.screens = S;
    this._drawScreens(0, true);
    return S;
  }
  _drawScreens(time, force) {
    const S = this.screens; if (!S) return;
    const kinds = D.AD_KINDS;
    S.forEach((sc, i) => {
      const slide = Math.floor(time / 6 + i * 2.7);
      if (!force && sc.slide === slide && Math.abs(time - sc.t) < 1.9) return;
      sc.t = time; const g = sc.g, w = 768, h = 432;
      if (i === 3) {
        // info board: clock + weather + ticker (designed on 512x288, drawn at 1.5x)
        g.save(); g.scale(w / 512, h / 288);
        { const w = 512, h = 288;
        g.fillStyle = '#0b1c33'; g.fillRect(0, 0, w, h);
        const m = this.ctx.clock ? this.ctx.clock.minutes : 720;
        const hh = String(Math.floor(m / 60) % 24).padStart(2, '0'), mm = String(Math.floor(m) % 60).padStart(2, '0');
        g.fillStyle = '#ffffff'; D.fitText(g, `${hh}:${mm}`, w * 0.27, h * 0.36, w * 0.5, h * 0.4, 800, '"Inter", Arial, sans-serif');
        g.fillStyle = '#9fd0ff'; D.fitText(g, 'なんば  大阪 ☀ 22°C', w * 0.7, h * 0.3, w * 0.5, h * 0.1, 700);
        g.fillStyle = '#ffd36b'; D.fitText(g, '本日の運行情報  平常どおり', w * 0.7, h * 0.46, w * 0.5, h * 0.08, 700);
        g.fillStyle = '#16365e'; g.fillRect(0, h * 0.78, w, h * 0.22);
        g.fillStyle = '#fff'; const off = (time * 40) % 700;
        D.fitText(g, '南海電車 · 御堂筋線 · 千日前線  ご利用ありがとうございます    Namba CITY  ハロウィンフェア開催中', w * 0.5 - off + 350, h * 0.89, 1400, h * 0.09, 700, undefined, 'center');
        }
        g.restore();
      } else {
        const kind = kinds[(slide * 5 + i * 3 + 100) % kinds.length];
        D.drawAd(g, w, h, kind, 3 + slide);
        // slight scanline shimmer
        g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(0, (time * 60) % h, w, 6);
      }
      sc.slide = slide; sc.tex.needsUpdate = true;
    });
  }

  _chunkOf(u) {
    const key = u.key;
    return key;
  }

  _buildUnit(u) {
    if (u.built) return;
    u.built = true;
    const ctx = this.ctx, env = this.env, R = env.R;
    const gb = new GeoBatch();
    try {
      for (const it of u.items) {
        const y = LEVELS[it.level].y;
        const P = new Painter(gb, new Frame(it.x, y, it.z, it.rot || 0));
        const fn = BUILD[it.k];
        if (fn) fn(this, P, R, it);
      }
    } catch (e) { console.error('[props] build', u.key, e); ctx.errors.push(`props: build ${u.key}: ${e.message}`); }
    const grp = new THREE.Group();
    grp.name = 'props:' + u.key;
    grp.userData.chunk = { level: u.level, x: u.x, z: u.z, r: CHUNK * 0.8 };
    for (const m of gb.build(ctx.materials, { name: 'props' })) { m.receiveShadow = false; grp.add(m); }
    ctx.engine.levelRoot(u.level).add(grp);
    u.group = grp;
  }
  _dist2(u, p) {
    const dx = Math.max(0, Math.abs(u.x - p.x) - CHUNK / 2), dz = Math.max(0, Math.abs(u.z - p.z) - CHUNK / 2);
    const dy = (u.y - p.y) * 3;
    return dx * dx + dz * dz + dy * dy;
  }
  _forceNear() {
    const b = this.ctx.player && this.ctx.player.body;
    const p = b ? { x: b.x, y: (b.y || 0) + 1.6, z: b.z } : this.ctx.engine.camera.position;
    this.buildNear(null, p.x, p.z, FORCE_R, p.y);
  }
  buildNear(level, x, z, r = FORCE_R, y) {
    const yy = y != null ? y : (level ? LEVELS[level].y + 1.6 : this.ctx.engine.camera.position.y);
    const p = { x, y: yy, z };
    for (const u of this.units.values()) if (!u.built && this._dist2(u, p) < r * r) this._buildUnit(u);
  }
  buildAll() { for (const u of this.units.values()) this._buildUnit(u); }
  list(kind) { return this.items.filter(i => i.k === kind); }

  afterBuild() { /* lights are flushed by Shops.afterBuild through env.lights */ }

  update(dt) {
    const cam = this.ctx.engine.camera.position;
    if (!this._first && this.ctx.nav) { this._first = true; this._forceNear(); }
    this._q -= dt;
    if (this._q <= 0) {
      this._q = 0.2;
      if (this.env.fontsReady) {
        const t0 = performance.now();
        const cand = [];
        for (const u of this.units.values()) if (!u.built) { const d = this._dist2(u, cam); if (d < BUILD_R * BUILD_R) cand.push([d, u]); }
        cand.sort((a, b) => a[0] - b[0]);
        for (const [, u] of cand) { this._buildUnit(u); if (performance.now() - t0 > 6) break; }
      }
    }
    // animated things: only near the player
    this._sT += dt;
    if (this._sT > 0.5) {
      const time = performance.now() / 1000;
      this._sT = 0;
      if (this.screens) {
        let near = false;
        for (const u of this.units.values()) if (u.built && u.hasScreens && this._dist2(u, cam) < 50 * 50) { near = true; break; }
        if (near) this._drawScreens(time, false);
      }
      if (this.jets) this._animateJets(time, cam);
    }
  }
  // faceted glass sculpture, lit from inside, slowly cycling hue (one shared material)
  _makeCrystal(lv, cx, cz, grp) {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 1.6, 2.0), transparent: true, opacity: 0.8, depthWrite: false });
    this.crystalMat = mat;
    const y0 = LEVELS[lv].y + 1.85;
    const hs = [3.3, 2.5, 2.2, 2.0, 1.7, 1.9, 1.5];
    hs.forEach((h, i) => {
      const geo = new THREE.CylinderGeometry(0.03, 0.2 + (i % 3) * 0.04, h * 0.5, 6, 1); geo.translate(0, h * 0.25, 0);
      const m = new THREE.Mesh(geo, mat);
      const a = i === 0 ? 0 : (i - 1) / 6 * Math.PI * 2;
      const rr = i === 0 ? 0 : 0.5;
      m.position.set(cx + Math.cos(a) * rr, y0 + (i === 0 ? 0 : 0.0), cz + Math.sin(a) * rr);
      m.rotation.z = i === 0 ? 0 : 0.16 * Math.cos(a); m.rotation.x = i === 0 ? 0 : 0.16 * Math.sin(a);
      grp.add(m);
    });
    // splash rings at the water surface
    this.rings = [];
    const rg = new THREE.RingGeometry(0.2, 0.28, 16); rg.rotateX(-Math.PI / 2);
    for (let i = 0; i < 8; i++) {
      const rm = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.8, 2.0), transparent: true, opacity: 0.5, depthWrite: false });
      const a = i / 8 * Math.PI * 2, rr2 = this.fountain.r - 0.45;
      const m = new THREE.Mesh(rg, rm);
      m.position.set(cx + Math.cos(a) * rr2, LEVELS[lv].y + 0.47, cz + Math.sin(a) * rr2); m.userData.ph = i * 0.8;
      grp.add(m); this.rings.push(m);
    }
  }
  _animateJets(time, cam) {
    const f = this.fountain; if (!f) return;
    const near = Math.hypot(cam.x - f.x, cam.z - f.z) < 40 && Math.abs(cam.y - LEVELS[f.level].y) < 6;
    for (const jt of this.jets) {
      jt.visible = near;
      if (!near) continue;
      const k = 0.8 + 0.2 * Math.sin(time * 2.1 + jt.userData.ph);
      jt.scale.set(1, jt.userData.h * k, 1);
    }
    if (near && this.crystalMat) this.crystalMat.color.setHSL((time * 0.03) % 1, 0.7, 0.62).multiplyScalar(2.0);
    if (near && this.rings) for (const rg of this.rings) { const t = (time * 0.9 + rg.userData.ph) % 1; rg.scale.setScalar(1 + t * 2.2); rg.material.opacity = 0.5 * (1 - t); }
  }
}

// =============================================================================
// builders: P is a Painter in the item's frame (wall at d = 0, room at d < 0)
// =============================================================================
const stone = [0.72, 0.7, 0.66];
const steel = [0.62, 0.64, 0.67];
const dark = [0.14, 0.14, 0.16];

function vendMachine(P, R, ac, kind, seed) {
  const w = 0.78, a0 = ac - w / 2, a1 = ac + w / 2, d0 = -0.74;
  const body = VEND_BODY[kind % VEND_BODY.length];
  P.box('env_metal', a0, a1, 0, 1.84, d0, 0, body);
  P.box('env_matte', a0 + 0.02, a1 - 0.02, 0, 0.1, d0 - 0.015, d0, dark);
  P.tq(R.vending(kind, seed % 3), a0 + 0.035, a1 - 0.035, 0.1, 1.8, d0 - 0.004, -1);
}

// v6: planter boxes drew a full top face at the rim height AND the soil quad in the same plane (same material,
// different vertex colour): the soil z-fought with the stone lid (Zack's item 4, every planter / planter bench).
// Now the box has no lid: a stone rim ring at the top, short inner walls and the soil SOIL_DROP below the rim.
const SOIL_DROP = 0.04;
function planterTop(P, a0, a1, d0, d1, y, rim) {
  const ia0 = a0 + rim, ia1 = a1 - rim, id0 = d0 + rim, id1 = d1 - rim, ys = y - SOIL_DROP;
  const inner = [0.5, 0.48, 0.45];
  P.qh('env_matte', a0, a1, d0, id0, y, true, stone);
  P.qh('env_matte', a0, a1, id1, d1, y, true, stone);
  P.qh('env_matte', a0, ia0, id0, id1, y, true, stone);
  P.qh('env_matte', ia1, a1, id0, id1, y, true, stone);
  P.qd('env_matte', ia0, ia1, ys, y, id0, 1, inner);
  P.qd('env_matte', ia0, ia1, ys, y, id1, -1, inner);
  P.qa('env_matte', id0, id1, ys, y, ia0, 1, inner);
  P.qa('env_matte', id0, id1, ys, y, ia1, -1, inner);
  P.qh('env_matte', ia0, ia1, id0, id1, ys, true, [0.2, 0.14, 0.1]);
}

const BUILD = {
  vend(S, P, R, it) {
    const n = it.count || 1; let a = -(n * 0.82 + 0.1) / 2 + 0.41 + 0.05;
    const r = rng(it.seed);
    for (let i = 0; i < n; i++) { vendMachine(P, R, a, Math.floor(r() * 5), Math.floor(r() * 3)); a += 0.82; }
  },
  bin(S, P, R, it) {
    const cols = [[0.15, 0.4, 0.75], [0.8, 0.5, 0.1], [0.2, 0.55, 0.28]];
    const lab = [['ペットボトル', '#1d5fb8'], ['缶・びん', '#c67a10'], ['燃えるゴミ', '#2f8f4a']];
    for (let i = 0; i < 3; i++) {
      const a = -0.5 + i * 0.5, d0 = -0.42;
      P.box('env_metal', a - 0.2, a + 0.2, 0, 0.95, d0, 0, steel);
      P.box('env_matte', a - 0.21, a + 0.21, 0.82, 0.96, d0 - 0.01, 0.01, cols[i]);
      P.box('env_matte', a - 0.14, a + 0.14, 0.62, 0.7, d0 - 0.012, d0 - 0.002, dark);
      P.tq(R.label(lab[i][0], lab[i][1], '#ffffff', 192, 40), a - 0.18, a + 0.18, 0.7, 0.82, d0 - 0.012, -1);
    }
  },
  bench(S, P, R, it) {
    const L = it.len || 1.9, h = L / 2;
    const wood = [0.62, 0.43, 0.26];
    P.box('env_wood', -h, h, 0.43, 0.47, -0.5, -0.04, wood);
    P.box('env_wood', -h, h, 0.5, 0.82, -0.1, -0.06, wood);
    for (const a of [-h + 0.15, h - 0.15]) { P.box('env_metal', a - 0.03, a + 0.03, 0, 0.43, -0.5, -0.46, steel); P.box('env_metal', a - 0.03, a + 0.03, 0, 0.43, -0.12, -0.08, steel); P.box('env_metal', a - 0.03, a + 0.03, 0.43, 0.82, -0.12, -0.08, steel); }
    P.box('env_metal', -h, h, 0.03, 0.06, -0.5, -0.08, steel);
  },
  plant(S, P, R, it) {
    const h = (it.len || 1.3) / 2;
    P.box('env_matte', -h, h, 0, 0.5, -0.6, -0.02, stone, 'nsew');
    planterTop(P, -h, h, -0.6, -0.02, 0.5, 0.05);
    const r = rng(it.seed);
    const nn = r() < 0.5 ? 2 : 3;
    for (let i = 0; i < nn; i++) {
      const a = -h + 0.4 + (2 * h - 0.8) * (nn === 1 ? 0.5 : i / (nn - 1));
      const tall = r() < 0.5;
      P.geo('env_matte', tall ? 'tallplant' : 'plant', a, 0.5 - SOIL_DROP, -0.31, r() * 6, 0.9 + r() * 0.5, [0.2 + r() * 0.1, 0.45 + r() * 0.25, 0.2 + r() * 0.1]);
    }
  },
  plantpot(S, P, R, it) {
    P.geo('env_matte', 'cyl', 0, 0, 0, 0, [0.5, 0.55, 0.5], stone);
    P.geo('env_matte', 'tallplant', 0, 0.55, 0, 1, 1.15, [0.22, 0.5, 0.22]);
  },
  atm(S, P, R, it) {
    const lab = R.litLabel('ATM  24時間 · 365日', '#0b2f6b', '#ffffff', 256, 48);
    P.box('env_matte', -1.25, 1.25, 0, 2.5, -0.06, 0, [0.9, 0.9, 0.9]);
    P.box('env_matte', -1.25, 1.25, 2.2, 2.5, -0.95, -0.06, [0.85, 0.86, 0.88]);   // canopy
    P.tq(lab, -1.0, 1.0, 2.24, 2.24 + 2.0 * 48 / 256, -0.955, -1);
    P.box('env_matte', -1.25, -1.2, 0, 2.2, -0.95, -0.06, [0.85, 0.86, 0.88]);
    P.box('env_matte', 1.2, 1.25, 0, 2.2, -0.95, -0.06, [0.85, 0.86, 0.88]);
    for (const a of [-0.65, 0.65]) {
      P.box('env_metal', a - 0.36, a + 0.36, 0, 1.55, -0.62, -0.1, [0.82, 0.84, 0.88]);
      P.qd('env_glow', a - 0.22, a + 0.22, 1.1, 1.42, -0.623, -1, [0.5, 1.0, 1.4]);
      P.box('env_matte', a - 0.22, a + 0.22, 0.92, 1.0, -0.66, -0.62, [0.2, 0.2, 0.25]);
      P.box('env_matte', a - 0.2, a + 0.2, 0.6, 0.66, -0.64, -0.62, dark);
      P.qd('env_glow', a - 0.16, a + 0.16, 0.7, 0.74, -0.641, -1, [0.3, 1.2, 0.4]);
    }
    P.qh('env_glow', -1.0, 1.0, -0.9, -0.1, 2.195, false, [2.2, 2.3, 2.5]);
  },
  gacha(S, P, R, it) {
    const L = it.len || 3.2, n = Math.max(3, Math.floor(L / 0.36)), w = L / n;
    const r = rng(it.seed);
    const capsCols = [[0.95, 0.2, 0.25], [0.2, 0.55, 0.95], [1, 0.8, 0.15], [0.3, 0.8, 0.4], [0.95, 0.45, 0.75], [0.6, 0.35, 0.9]];
    P.box('env_matte', -L / 2, L / 2, 0, 0.5, -0.46, 0, [0.25, 0.25, 0.28]);   // stand
    for (let row = 0; row < 2; row++) {
      const y0 = 0.5 + row * 0.5;
      for (let i = 0; i < n; i++) {
        const a = -L / 2 + w * (i + 0.5);
        const c = capsCols[Math.floor(r() * capsCols.length)];
        P.box('env_gloss', a - w / 2 + 0.02, a + w / 2 - 0.02, y0, y0 + 0.25, -0.42, 0, mix(c, [1, 1, 1], 0.1));
        P.geo('env_gloss', 'blob', a, y0 + 0.37, -0.22, r() * 6, 0.14, mix(c, [1, 1, 1], 0.4));
        P.box('env_matte', a - 0.05, a + 0.05, y0 + 0.05, y0 + 0.12, -0.425, -0.42, dark);
        P.tq(R.litLabel(['¥200', '¥300', '¥400', '¥500'][Math.floor(r() * 4)], ['#e60012', '#ffd400', '#0068b7', '#00a040'][Math.floor(r() * 4)], '#ffffff', 96, 40), a - w / 2 + 0.04, a + w / 2 - 0.04, y0 + 0.13, y0 + 0.23, -0.424, -1);
      }
    }
    P.box('env_matte', -L / 2, L / 2, 1.5, 1.9, -0.2, 0, [0.95, 0.95, 0.95]);
    P.tq(R.litLabel('ガチャ  GACHA  カプセルトイ', '#ff006e', '#ffffff', 256, 48), -L / 2 + 0.1, L / 2 - 0.1, 1.52, 1.88, -0.201, -1);
  },
  bench2(S, P, R, it) {
    const hx = it.hx || 1, hz = it.hz || 0.5;
    const wood = [0.62, 0.43, 0.26];
    // frame local: a = long axis (±hx), d = depth (±hz); centred
    P.box('env_wood', -hx, hx, 0.42, 0.47, -hz, -hz + 0.4, wood);
    P.box('env_wood', -hx, hx, 0.42, 0.47, hz - 0.4, hz, wood);
    P.box('env_metal', -hx, hx, 0.47, 0.87, -0.03, 0.03, steel);
    for (const a of [-hx + 0.2, hx - 0.2]) P.box('env_metal', a - 0.03, a + 0.03, 0, 0.42, -hz, hz, steel);
  },
  planterbench(S, P, R, it) {
    const hx = it.hx || 1.3, hz = it.hz || 0.85, wood = [0.62, 0.43, 0.26];
    P.box('env_matte', -hx, hx, 0, 0.5, -0.45, 0.45, stone, 'nsew');
    planterTop(P, -hx, hx, -0.45, 0.45, 0.5, 0.05);
    const r = rng(it.seed);
    P.geo('env_matte', 'tallplant', -hx * 0.4, 0.5 - SOIL_DROP, 0, r() * 6, 1.5, [0.2, 0.5, 0.2]);
    P.geo('env_matte', 'tallplant', hx * 0.4, 0.5 - SOIL_DROP, 0, r() * 6, 1.3, [0.25, 0.5, 0.2]);
    P.box('env_wood', -hx, hx, 0.4, 0.45, -hz, -0.45, wood); P.box('env_wood', -hx, hx, 0.4, 0.45, 0.45, hz, wood);
    P.box('env_metal', -hx, hx, 0, 0.4, -hz + 0.05, -hz + 0.1, steel); P.box('env_metal', -hx, hx, 0, 0.4, hz - 0.1, hz - 0.05, steel);
  },
  totem(S, P, R, it) {
    const sc = S._ensureScreens();
    const m = sc[it.src % 4].mat;
    const hx = 0.5, hz = 0.12;
    P.box('env_metal', -hx - 0.04, hx + 0.04, 0.2, 2.1, -hz, hz, [0.08, 0.08, 0.1]);
    P.box('env_metal', -0.3, 0.3, 0, 0.2, -0.16, 0.16, [0.2, 0.2, 0.22]);
    const w = 0.92, h = w * 0.5625 * 1.0;
    for (const sgn of [-1, 1]) {
      // portrait-ish: crop the landscape canvas centre
      P.qd(m, -hx, hx, 0.3, 2.06, sgn * (hz + 0.003), sgn, WHITE, uvCrop());
    }
    void w; void h;
    const u = S._unitOf(it); if (u) u.hasScreens = true;
  },
  screen(S, P, R, it) {
    const sc = S._ensureScreens();
    const m = sc[it.src % 4].mat, w = it.w, h = it.y1 - it.y0;
    P.box('env_matte', -w / 2 - 0.04, w / 2 + 0.04, it.y0 - 0.04, it.y1 + 0.04, -0.09, 0, dark);
    P.qd(m, -w / 2, w / 2, it.y0, it.y1, -0.093, -1);
    const u = S._unitOf(it); if (u) u.hasScreens = true;
    void h;
  },
  hose(S, P, R, it) {
    const w = it.w;
    P.box('env_metal', -w / 2, w / 2, it.y0, it.y1, -0.13, 0, [0.82, 0.1, 0.1]);
    P.tq(R.label('消火栓  FIRE HYDRANT', '#d01c1c', '#ffffff', 192, 48), -w / 2 + 0.06, w / 2 - 0.06, it.y0 + 0.5, it.y0 + 0.5 + (w - 0.12) * 48 / 192, -0.131, -1);
    P.box('env_matte', -0.04, 0.04, it.y1 - 0.2, it.y1 - 0.12, -0.14, -0.13, [0.95, 0.9, 0.9]);
    P.box('env_glow', -0.04, 0.04, it.y1 + 0.02, it.y1 + 0.08, -0.12, -0.04, [2.4, 0.2, 0.15]);   // red beacon
  },
  aed(S, P, R, it) {
    P.box('env_matte', -0.17, 0.17, it.y0, it.y1, -0.14, 0, [0.95, 0.96, 0.95]);
    P.tq(R.litLabel('AED', '#0a8f4a', '#ffffff', 96, 64), -0.15, 0.15, it.y0 + 0.2, it.y0 + 0.2 + 0.3 * 64 / 96, -0.141, -1);
  },
  staffdoor(S, P, R, it) {
    P.box('env_metal', -0.55, 0.55, 0, 2.15, -0.05, 0, [0.5, 0.52, 0.55]);
    P.box('env_matte', -0.5, 0.5, 0.0, 2.1, -0.075, -0.05, [0.7, 0.72, 0.74]);
    P.box('env_metal', 0.34, 0.4, 0.95, 1.0, -0.12, -0.075, [0.85, 0.85, 0.86]);   // lever
    P.box('env_metal', 0.3, 0.44, 1.2, 1.5, -0.08, -0.075, [0.8, 0.8, 0.82]);       // push plate
    P.tq(R.label('関係者以外立入禁止', '#b01818', '#ffffff', 256, 40), -0.38, 0.38, 1.72, 1.72 + 0.76 * 40 / 256, -0.077, -1);
  },
  poster(S, P, R, it) {
    const w = it.w, port = (it.y1 - it.y0) > w;
    const reg = R.ad(it.ad, 1 + (it.seed % 2), true);
    const a0 = -w / 2, a1 = w / 2;
    const y0 = it.y0, y1 = it.y1;
    P.box('env_metal', a0 - 0.05, a1 + 0.05, y0 - 0.05, y1 + 0.05, -0.13, 0, steel);
    P.tq(reg, a0, a1, y0, y1, -0.133, -1);
    P.qh('env_glow', a0, a1, -0.12, -0.02, y1 + 0.049, false, [1.2, 1.3, 1.4]);
    void port;
  },
  colad(S, P, R, it) {
    const reg = R.ad(it.ad, 1 + (it.seed % 2), true);
    const faces = [[0, -1, it.hx * 2, it.hz], [0, 1, it.hx * 2, it.hz], [-1, 0, it.hz * 2, it.hx], [1, 0, it.hz * 2, it.hx]];
    const f = P.f;
    const n = it.faces || 4;
    for (let k = 0; k < n; k++) {
      const [nx, nz, wf, off] = faces[k];
      // exact 2:3 poster, as big as the column face allows (max 0.8 x 1.2 m), hung with its centre at 1.55 m
      const w = Math.min(wf - 0.12, 0.8), hP = w * 1.5, y0 = 1.55 - hP / 2, y1 = y0 + hP;
      if (w < 0.3) continue;
      // build with a local frame rotated to face (nx,nz) at distance `off` from the column centre
      const cx = it.x + nx * (off + 0.012), cz = it.z + nz * (off + 0.012);
      // Frame rot: d axis = (sin rot, cos rot) = -n  => local -d faces outward
      const PF = new Painter(P.gb, new Frame(cx, f.oy, cz, Math.atan2(-nx, -nz)));
      // (the poster used to sit exactly on the frame box's front face: z-fighting = the 'broken' column ads)
      PF.box('env_metal', -w / 2 - 0.03, w / 2 + 0.03, y0 - 0.03, y1 + 0.03, 0.0, 0.035, steel);
      PF.tq(reg, -w / 2, w / 2, y0, y1, -0.006, -1);
    }
  },
  platad(S, P, R, it) {
    const reg = R.ad(it.ad, 1 + (it.seed % 2), false);
    // 16:9 artwork fitted inside the frame (never stretched); the paper margin either side is plain backing
    const h = it.h - 0.04, w = Math.min(it.w - 0.04, h * 16 / 9), hh = w * 9 / 16;
    P.qd('env_matte', -it.w / 2 + 0.02, it.w / 2 - 0.02, it.yc - it.h / 2 + 0.02, it.yc + it.h / 2 - 0.02, -0.004, -1, [0.9, 0.9, 0.88]);
    P.tq(reg, -w / 2, w / 2, it.yc - hh / 2, it.yc + hh / 2, -0.012, -1);
  },
  fountain(S, P, R, it) { buildFountain(S, P, R, it); },
  vflag(S, P, R, it) {
    const r = rng(it.seed);
    const TXT = ['秋の味覚フェア', 'セール開催中', '激安特価', 'ハロウィン', '数量限定', 'なんばウォーク', '人気'];
    const COL = [['#c8102e', '#ffffff'], ['#1d2b4a', '#ffe08a'], ['#f39800', '#ffffff'], ['#2a0a3a', '#ff9a1f'], ['#00703c', '#ffffff'], ['#ffd400', '#c8102e']];
    const c = COL[Math.floor(r() * COL.length)];
    const reg = R.vbanner(TXT[Math.floor(r() * TXT.length)], c[0], c[1]);
    const y1 = it.ceil - 0.16, y0 = y1 - 1.0, hw = 0.24;
    P.box('env_metal', -hw - 0.03, hw + 0.03, y1, y1 + 0.03, -0.02, 0.02, [0.4, 0.4, 0.42]);
    P.box('env_metal', -0.005, 0.005, y1, it.ceil, -0.005, 0.005, [0.4, 0.4, 0.42]);
    P.tq(reg, -hw, hw, y0, y1, -0.006, -1);
    P.qd(reg.atlas.mat(reg), -hw, hw, y0, y1, 0.006, 1, [0.85, 0.85, 0.85], reg.atlas.uv(reg));
  },
  display(S, P, R, it) {
    const r = rng(it.seed);
    P.box('env_wood', -2.1, 2.1, 0, 0.3, -2.1, 2.1, [0.25, 0.17, 0.11]);
    P.box('env_matte', -2.0, 2.0, 0.3, 0.34, -2.0, 2.0, [0.1, 0.07, 0.1]);
    for (let i = 0; i < 16; i++) {
      const a = (r() - 0.5) * 3.4, d = (r() - 0.5) * 3.4, sz = 0.22 + r() * 0.38;
      const col = r() < 0.75 ? [1.0, 0.45 + r() * 0.15, 0.05] : [0.95, 0.9, 0.7];
      P.geo('env_gloss', 'blob', a, 0.34 + sz * 0.7, d, r() * 6, [sz, sz * 0.8, sz], col);
      P.geo('env_matte', 'cyl6', a, 0.34 + sz * 1.45, d, 0, [0.03, 0.12, 0.03], [0.2, 0.35, 0.12]);
      if (r() < 0.6) P.qd('env_glow', a - sz * 0.35, a + sz * 0.35, 0.34 + sz * 0.5, 0.34 + sz * 0.95, d - sz * 0.9, -1, [2.6, 1.6, 0.3]);   // lit jack-o'-lantern face
    }
    // backdrop panel with the fair title, on two posts
    for (const a of [-1.9, 1.9]) P.box('env_metal', a - 0.04, a + 0.04, 0.34, 3.0, 1.8, 1.9, [0.12, 0.12, 0.14]);
    P.box('env_matte', -2.1, 2.1, 2.1, 3.0, 1.85, 1.93, [0.12, 0.05, 0.2]);
    P.tq(R.litLabel('なんばCITY ハロウィンフェア  HALLOWEEN FAIR', '#2a0a3a', '#ff9a1f', 512, 72), -2.0, 2.0, 2.2, 2.2 + 4.0 * 72 / 512 * 1.0, 1.84, -1);
    for (let k = 0; k < 10; k++) P.geo('env_matte', 'blob', -2.0 + k * 0.44, 3.35 + (k % 2) * 0.1, -2.0 + (k % 3) * 1.4, k, [0.1, 0.03, 0.18], [0.05, 0.02, 0.07]);
  },
};

// crop a landscape screen to its centre portrait strip so totems look right
function uvCrop() {
  const u0 = 0.36, u1 = 0.64;
  return [[u0, 0], [u1, 0], [u1, 1], [u0, 1]];
}

function buildFountain(S, P, R, it) {
  const r0 = it.r;
  const stoneC = [0.78, 0.76, 0.72], dk = [0.5, 0.5, 0.52];
  P.geo('env_matte', 'cyl', 0, 0, 0, 0, [r0 + 0.35, 0.42, r0 + 0.35], stoneC);          // basin wall
  P.geo('env_gloss', 'cyl', 0, 0.38, 0, 0, [r0 + 0.02, 0.02, r0 + 0.02], [0.8, 0.9, 0.95]);
  // water surface (a disc a bit below the rim)
  P.geo('env_water', 'disk', 0, 0.36, 0, 0, r0 - 0.05, WHITE);
  // rim ring (flat top)
  P.geo('env_matte', 'cyl', 0, 0.4, 0, 0, [r0 + 0.38, 0.06, r0 + 0.38], [0.88, 0.86, 0.82]);
  P.geo('env_water', 'disk', 0, 0.452, 0, 0, r0 - 0.02, WHITE);
  // central stepped column
  P.geo('env_matte', 'cyl', 0, 0.3, 0, 0, [0.9, 0.5, 0.9], dk);
  P.geo('env_matte', 'cyl', 0, 0.8, 0, 0, [0.4, 1.0, 0.4], stoneC);
  P.geo('env_matte', 'cyl', 0, 1.7, 0, 0, [0.9, 0.1, 0.9], dk);
  P.geo('env_water', 'disk', 0, 1.82, 0, 0, 0.82, WHITE);
  P.geo('env_matte', 'cyl', 0, 1.8, 0, 0, [0.15, 0.6, 0.15], stoneC);
  // crystal spires around (the "Crysta" plaza glass pylons)
  const gl = 'env_glass_case';
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2 + 0.3;
    P.geo(gl, 'cyl6', Math.cos(a) * (r0 - 0.5), 0.45, Math.sin(a) * (r0 - 0.5), 0, [0.05, 0.9 + (i % 3) * 0.25, 0.05], WHITE);
  }
  // under-water lights glow
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; P.geo('env_glow', 'blob', Math.cos(a) * (r0 - 0.25), 0.42, Math.sin(a) * (r0 - 0.25), 0, 0.07, [1.4, 1.9, 2.4]); }
}

// =============================================================================
// unit helpers
// =============================================================================
Props.prototype._unitOf = function (it) {
  return this.units.get(`${it.level}|${Math.floor(it.x / CHUNK)}|${Math.floor(it.z / CHUNK)}`);
};
