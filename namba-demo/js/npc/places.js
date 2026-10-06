// =============================================================================
// Places: everything the crowd goes to, derived from LAYOUT + directory so it
// survives layout edits. Portals (where people enter/leave the complex),
// platforms with door markings, gates, ramps (escalator lanes + admission),
// businesses (door points, queue slots, seats), gardens, landmarks, staff posts.
// =============================================================================
import { LEVELS, rampEnds, rampLength } from '../world/layout.js';
import { BUSINESSES, isOpen } from '../world/directory.js';
import { rng, hash } from '../core/rng.js';

// Extra portals at the edges of the modelled world ("the city continues").
// Validated at runtime; missing ones are skipped.
const EDGE_PORTALS = [
  { id: 'walk_east', level: 'B1', x: 217.5, z: -222, w: 1.6, zone: 'nambawalk' },
  { id: 'street_s_w', level: '1F', x: -102, z: -203, w: 0.7, zone: 'street' },
  { id: 'street_s_e', level: '1F', x: 208, z: -203, w: 0.6, zone: 'street' },
  { id: 'street_n_w', level: '1F', x: -102, z: -255, w: 0.5, zone: 'street' },
  { id: 'street_n_e', level: '1F', x: 208, z: -255, w: 0.5, zone: 'street' },
  { id: 'midosuji_s', level: '1F', x: -100, z: -42, w: 0.9, zone: 'street' },
  { id: 'city_south', level: '1F', x: 0, z: 178, w: 0.9, zone: 'city' },
  { id: 'parks_south', level: '2F', x: 45, z: 384, w: 0.6, zone: 'parks' },
  { id: 'taka_b1_in', level: 'B1', x: -30, z: -160, w: 0.8, zone: 'takashimaya', inside: true },
  { id: 'taka_1f_in', level: '1F', x: -30, z: -150, w: 0.6, zone: 'takashimaya', inside: true },
];
const EXIT_WEIGHT = { exit_15: 1.0, exit_18: 1.6, exit_21: 0.9, exit_24: 0.9, exit_m1: 1.2 };

export class Places {
  constructor({ world, nav, fields, col, ctx }) {
    this.world = world; this.nav = nav; this.fields = fields; this.col = col; this.ctx = ctx;
    this.L = world.layout;
    this._portals(); this._platforms(); this._ramps(); this._biz(); this._gardens(); this._landmarks(); this._staffPosts();
    this.gates = fields.gates;
    // lane directions from the transit system (in / out / both)
    for (const G of this.gates) {
      G.policy = G.lanes.map(() => 'both');
      try {
        const tl = ctx && ctx.transit && ctx.transit.gateLanes ? ctx.transit.gateLanes(G.id) : null;
        if (tl && tl.length === G.lanes.length) {
          tl.forEach((ln, i) => { G.policy[i] = ln.policy || 'both'; G.lanes[i] = G.axis === 'x' ? ln.x : ln.z; });
          if (tl[0].paidSign) G.paidSide = Math.sign(tl[0].paidSign);
        }
      } catch (e) { /* transit optional */ }
    }
    this.gatesByLevel = {};
    for (const g of this.gates) (this.gatesByLevel[g.level] = this.gatesByLevel[g.level] || []).push(g);
  }
  node(level, x, z) { return this.nav.cellNode[level] ? this.nav.nodeAtPoint(level, x, z) : -1; }
  spaceById(id) { return this.L.spaces.find(s => s.id === id); }

  // ---------------------------------------------------------------------------
  _portals() {
    this.portals = [];
    for (const e of this.L.exits) {
      const v = this.node(e.level, e.x, e.z);
      if (v < 0) continue;
      this.portals.push({ id: e.id, level: e.level, x: e.x, z: e.z, node: v, w: EXIT_WEIGHT[e.id] || 0.8, zone: 'street', exit: e });
    }
    for (const p of EDGE_PORTALS) {
      const v = this.node(p.level, p.x, p.z);
      if (v < 0) continue;
      this.portals.push({ ...p, node: v });
    }
    for (const p of this.portals) p.key = 'P:' + p.id;
  }
  portalField(p, pri = 3) { return this.fields.request(p.key, [p.node], { paidOk: false, priority: pri }); }

  // ---------------------------------------------------------------------------
  _platforms() {
    this.platforms = [];
    this.trackById = {};
    const sp = Object.fromEntries(this.L.spaces.map(s => [s.id, s]));
    const byPlat = {};
    for (const t of this.L.tracks) (byPlat[t.platform] = byPlat[t.platform] || []).push(t);
    for (const [pid, tracks] of Object.entries(byPlat)) {
      const s = sp[pid]; if (!s || !s.rect) continue;
      const lv = s.level; const [x0, z0, x1, z1] = s.rect;
      const goals = [];
      const g = this.world.grids[lv], map = this.nav.cellNode[lv];
      for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) { const i = g.cellOf(x + 0.5, z + 0.5); if (i >= 0 && map[i] >= 0) goals.push(map[i]); }
      if (!goals.length) continue;
      const P = { id: pid, space: s, level: lv, rect: s.rect, line: tracks[0].line, zone: s.zone, goals, key: 'L:' + pid, tracks: [] };
      for (const t of tracks) {
        // platform edge along the track, inward normal
        let ex, ez, nx = 0, nz = 0, along;
        if (t.side === 'w') { ex = x0; nx = 1; along = 'z'; } else if (t.side === 'e') { ex = x1; nx = -1; along = 'z'; }
        else if (t.side === 'n') { ez = z0; nz = 1; along = 'x'; } else { ez = z1; nz = -1; along = 'x'; }
        const a0 = along === 'z' ? z0 : x0, a1 = along === 'z' ? z1 : x1;
        // stopping zone: terminal (Nankai) trains stop at the north (concourse) end
        let s0 = a0 + 4, s1 = a1 - 4;
        if (t.terminal) s1 = Math.min(s1, a0 + 150);
        const spacing = t.line === 'nankai' ? 6.7 : 4.6;
        const marks = [];
        // prefer the transit system's painted door markings
        let tinfo = null;
        try { tinfo = this.ctx && this.ctx.transit && this.ctx.transit.trackInfo ? this.ctx.transit.trackInfo(t.id) : null; } catch (e) { tinfo = null; }
        if (tinfo && tinfo.stopDoors && tinfo.stopDoors.length) {
          for (const d of tinfo.stopDoors) {
            let mx = d.x + nx * 0.9, mz = d.z + nz * 0.9;
            if (!this.col.walkable(lv, mx, mz) || !this.col.walkable(lv, mx + nx * 2.5, mz + nz * 2.5)) continue;
            marks.push({ x: mx, z: mz, nx, nz, n: [0, 0], a: along === 'z' ? d.z : d.x, transit: true });
          }
        }
        if (!marks.length) for (let a = s0 + spacing * 0.5; a < s1; a += spacing) {
          const mx = along === 'z' ? ex + nx * 0.9 : a, mz = along === 'z' ? a : ez + nz * 0.9;
          if (!this.col.walkable(lv, mx, mz) || !this.col.walkable(lv, mx + nx * 2.5, mz + nz * 2.5)) continue;
          marks.push({ x: mx, z: mz, nx, nz, n: [0, 0], a });
        }
        const T = { id: t.id, track: t, platform: P, line: t.line, nx, nz, along, marks, doors: null, doorsUntil: 0, lastArrive: -1e9, heading: t.heading };
        P.tracks.push(T);
        this.trackById[t.id] = T;
      }
      this.platforms.push(P);
    }
    this.platformById = Object.fromEntries(this.platforms.map(p => [p.id, p]));
  }
  platformField(P, pri = 2) { return this.fields.request(P.key, P.goals, { paidOk: true, priority: pri }); }
  // queue slot k (0,1,...) at a door marking: two columns perpendicular to the edge
  markSlot(m, k) {
    const col = k & 1, row = k >> 1;
    const tx = -m.nz, tz = m.nx; // along the edge
    const lat = (col ? 0.36 : -0.36);
    return { x: m.x + m.nx * (0.25 + row * 0.62) + tx * lat, z: m.z + m.nz * (0.25 + row * 0.62) + tz * lat, yaw: Math.atan2(m.nx, m.nz) };
  }

  // ---------------------------------------------------------------------------
  _ramps() {
    this.ramps = this.L.ramps.map((r, ri) => {
      const ends = rampEnds(r);
      return { r, ri, ends, len: rampLength(r), esc: r.kind === 'escalator', stairs: r.kind !== 'escalator',
        hw: r.walkWidth / 2, nextStand: 0, nextWalk: 0, riders: [] };
    });
  }

  // ---------------------------------------------------------------------------
  _biz() {
    this.biz = [];
    this.bizBySlot = {};
    const slots = Object.fromEntries(this.L.shopSlots.map(s => [s.id, s]));
    for (const b of BUSINESSES) {
      const slot = slots[b.slot]; if (!slot) continue;
      if (!this.nav.cellNode[b.level]) continue;
      const v = this.node(b.level, b.door.ox, b.door.oz);
      if (v < 0) continue;
      const info = b.info || {};
      const rect = slot.rect;
      const area = (rect[2] - rect[0]) * (rect[3] - rect[1]);
      const r = rng(hash('crowd:' + b.slot));
      const pop = Math.max(0.15, ((b.rating || 3.5) - 2.8) / 1.9) * (b.key === 'tempura_great' ? 2.2 : b.key === 'coffee_great' ? 1.8 : 1);
      const food = !!info.food;
      const counter = ['coffeestand', 'takoyaki', 'ramen', 'udon', 'tendon', 'conbini', 'bakery', 'sweets', 'tempura'].includes(b.cat);
      const B = {
        b, slot, id: b.slot, level: b.level, cat: b.cat, info, food, counter, rect, area, node: v, key: 'B:' + b.slot,
        door: b.door, pop, r, cap: Math.max(3, Math.min(32, Math.round(area / (counter ? 3.2 : 4.5)))),
        seated: 0, queue: [], qSlots: null, spots: null, spotUsed: null,
        restaurant: food && !['coffeestand', 'conbini', 'bakery', 'sweets', 'takoyaki'].includes(b.cat),
        cafe: ['cafe', 'kissaten', 'coffeestand'].includes(b.cat),
        closed: b.cat === 'closed',
      };
      this.biz.push(B); this.bizBySlot[b.slot] = B;
    }
  }
  bizOpen(B, minutes) { return !B.closed && isOpen(B.b, minutes); }
  bizField(B, pri = 4) { return this.fields.request(B.key, [B.node], { paidOk: false, priority: pri }); }
  // interior spots (seats / standing / browsing points)
  spots(B) {
    if (B.spots) return B.spots;
    const [x0, z0, x1, z1] = B.rect;
    const out = [];
    const d = B.door;
    for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
      const px = x + 0.5, pz = z + 0.5;
      if (!this.col.walkable(B.level, px, pz)) continue;
      // keep the entrance strip clear
      const depth = (px - d.x) * -d.nx + (pz - d.z) * -d.nz;
      if (depth < 1.4) continue;
      out.push({ x: px + (B.r() - 0.5) * 0.3, z: pz + (B.r() - 0.5) * 0.3, depth, used: 0 });
    }
    // shuffle deterministically
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(B.r() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
    // restaurants and cafés: diners sit on the REAL chairs / stools the environment built (facing the right way)
    let spots = out;
    const sh = this.ctx && this.ctx.shops;
    if ((B.restaurant || B.cafe) && sh && sh.seats) {
      try {
        const real = (sh.seats(B.id) || []).filter(q => this.col.walkable(B.level, q.x, q.z)).map(q => ({ x: q.x, z: q.z, depth: 9, used: 0, yaw: q.yaw, real: true }));
        if (real.length >= 3) spots = real;
      } catch (e) { /* fall back to sampled cells */ }
    }
    B.spots = spots;
    B.cap = Math.max(2, Math.min(B.cap, spots.length));
    return spots;
  }
  takeSpot(B) {
    const S = this.spots(B);
    for (const s of S) if (!s.used) { s.used = 1; return s; }
    return null;
  }
  // queue slots along the frontage, starting beside the door
  qSlot(B, k) {
    if (!B.qSlots) {
      const d = B.door, slot = B.slot;
      const [ax, az, bx, bz] = slot.door;
      const tx = -d.nz, tz = d.nx;
      // pick the door end with more walkable frontage beyond it
      const ends = [[ax, az], [bx, bz]];
      let best = null, bestN = -1;
      for (const [ex, ez] of ends) {
        const sgn = ((ex - d.x) * tx + (ez - d.z) * tz) >= 0 ? 1 : -1;
        let n = 0;
        for (let i = 0; i < 14; i++) { const px = ex + tx * sgn * (0.3 + i * 0.62) + d.nx * 0.7, pz = ez + tz * sgn * (0.3 + i * 0.62) + d.nz * 0.7; if (this.col.walkable(B.level, px, pz)) n++; else break; }
        if (n > bestN) { bestN = n; best = { ex, ez, sgn }; }
      }
      const out = [];
      const { ex, ez, sgn } = best;
      let row = 0, i = 0;
      for (let k2 = 0; k2 < 24; k2++) {
        let px = ex + tx * sgn * (-0.2 + i * 0.62) + d.nx * (0.65 + row * 0.7), pz = ez + tz * sgn * (-0.2 + i * 0.62) + d.nz * (0.65 + row * 0.7);
        if (!this.col.walkable(B.level, px, pz) || i > 13) { row++; i = 0; px = ex + tx * sgn * (-0.2) + d.nx * (0.65 + row * 0.7); pz = ez + tz * sgn * (-0.2) + d.nz * (0.65 + row * 0.7); if (row > 2) break; }
        out.push({ x: px, z: pz, yaw: Math.atan2(tx * sgn, tz * sgn) });
        i++;
      }
      if (!out.length) out.push({ x: d.ox, z: d.oz, yaw: Math.atan2(d.nx, d.nz) });
      B.qSlots = out;
    }
    return B.qSlots[Math.min(k, B.qSlots.length - 1)];
  }

  // ---------------------------------------------------------------------------
  _gardens() {
    this.gardens = [];
    for (const s of this.L.spaces) {
      const parky = s.garden || s.style === 'canyon' || s.style === 'canyon_stage' || s.style === 'canyon_bridge' || s.style === 'garden_deck';
      if (!parky || !this.nav.cellNode[s.level]) continue;
      const g = this.world.grids[s.level], map = this.nav.cellNode[s.level];
      const nodes = [];
      for (let i = 0; i < map.length; i++) if (map[i] >= 0 && this.L.spaces[g.space[i]] === s) nodes.push(map[i]);
      if (nodes.length < 10) continue;
      const bounds = s.rect || polyBounds(s.poly);
      // view points: walkable cells near a rail (canyon views) -> photo spots
      const views = [];
      for (const e of this.world.edges[s.level]) {
        if (e.kind !== 'rail' && e.kind !== 'wall') continue;
        const mx = (e.ax + e.bx) / 2 + e.nx * 0.7, mz = (e.az + e.bz) / 2 + e.nz * 0.7;
        if (mx < bounds[0] || mx > bounds[2] || mz < bounds[1] || mz > bounds[3]) continue;
        if (e.kind === 'rail' && this.col.walkable(s.level, mx, mz)) views.push({ x: mx, z: mz, yaw: Math.atan2(e.nx, e.nz) });
      }
      this.gardens.push({ id: s.id, space: s, level: s.level, nodes, bounds, views, key: 'A:' + s.id, w: s.garden ? 1 : 0.7 });
    }
  }
  areaField(A, pri = 4) { return this.fields.request(A.key, A.nodes, { paidOk: false, priority: pri }); }
  randomNodePos(A, r) { const v = A.nodes[Math.floor(r() * A.nodes.length)]; return { x: this.nav.x[v] + (r() - 0.5) * 0.8, z: this.nav.z[v] + (r() - 0.5) * 0.8 }; }

  // ---------------------------------------------------------------------------
  _landmarks() {
    this.landmarks = [];
    for (const p of this.L.pois) {
      if (p.kind !== 'landmark' && p.kind !== 'departureBoard') continue;
      const v = this.node(p.level, p.x, p.z);
      if (v < 0) continue;
      this.landmarks.push({ id: p.id, poi: p, level: p.level, x: this.nav.x[v], z: this.nav.z[v], node: v, key: 'M:' + p.id, board: p.kind === 'departureBoard' });
    }
    // the depachika / busy halls as browse areas
    this.halls = [];
    for (const id of ['taka_b1', 'taka_1f', 'walk_court', 'city_b1_court', 'city_1f_court', 'nankai_1f', 'city_b1_north']) {
      const s = this.spaceById(id); if (!s || !this.nav.cellNode[s.level]) continue;
      const g = this.world.grids[s.level], map = this.nav.cellNode[s.level];
      const nodes = [];
      for (let i = 0; i < map.length; i++) if (map[i] >= 0 && this.L.spaces[g.space[i]] === s) nodes.push(map[i]);
      if (nodes.length > 20) this.halls.push({ id, space: s, level: s.level, nodes, bounds: s.rect || polyBounds(s.poly), key: 'A:' + id });
    }
    this.hallById = Object.fromEntries(this.halls.map(h => [h.id, h]));
  }
  landmarkField(M, pri = 4) { return this.fields.request(M.key, [M.node], { paidOk: false, priority: pri }); }

  // ---------------------------------------------------------------------------
  _staffPosts() {
    this.posts = [];
    // station staff beside each gate line, on the free side near the fence ends
    for (const G of this.fields.gates) {
      const free = G.paidSide ? -G.paidSide : -1;
      for (const [a, k] of [[G.from - 1.2, 0], [G.to + 1.2, 1]]) {
        const x = G.axis === 'x' ? a : G.at + free * 1.5, z = G.axis === 'x' ? G.at + free * 1.5 : a;
        if (!this.col.walkable(G.level, x, z)) continue;
        const yaw = G.axis === 'x' ? (free > 0 ? Math.PI : 0) : (free > 0 ? -Math.PI / 2 : Math.PI / 2);
        this.posts.push({ kind: 'staff_station', level: G.level, x, z, yaw: yaw + Math.PI, gate: G.id, k });
      }
    }
    // shop staff at the entrances of a deterministic subset of shops
    for (const B of this.biz) {
      if (B.closed) continue;
      const r = rng(hash('staff:' + B.id));
      const p = B.restaurant ? 0.55 : B.cafe ? 0.4 : ['fashion', 'shoes', 'cosmetics', 'drugstore', 'souvenir', 'sweets', 'takoyaki', 'bakery'].includes(B.cat) ? 0.5 : 0.2;
      if (r() > p) continue;
      const d = B.door;
      const [ax, az, bx, bz] = B.slot.door;
      const t = 0.25 + r() * 0.5;
      const x = ax + (bx - ax) * t - d.nx * 0.7, z = az + (bz - az) * t - d.nz * 0.7;
      if (!this.col.walkable(B.level, x, z)) continue;
      this.posts.push({ kind: 'staff_shop', level: B.level, x, z, yaw: Math.atan2(-d.nx, -d.nz), biz: B, callout: B.restaurant || B.cat === 'takoyaki' || B.cat === 'drugstore' });
    }
    // real staff spots from the environment (depachika counters, shop counters / tills): people stand exactly there
    const sh = this.ctx && this.ctx.shops;
    const hex = (c) => { if (typeof c === 'number') return c; if (typeof c === 'string' && c[0] === '#') return parseInt(c.slice(1), 16); return null; };
    if (sh) {
      try {
        if (sh.hallSpots) for (const id of ['taka_b1', 'taka_1f']) for (const sp of (sh.hallSpots(id) || [])) {
          if (sp.kind !== 'staff' || sp.svc) continue;
          this.posts.push({ kind: 'staff_shop', level: sp.level, x: sp.x, z: sp.z, yaw: sp.yaw, hall: id, apron: hex(sp.outfit && sp.outfit.apron), cap: !!(sp.outfit && sp.outfit.cap), callout: true, real: true });
        }
        if (sh.spots) for (const B of this.biz) {
          if (B.closed) continue;
          const sps = (sh.spots(B.id) || []).filter(q => q.kind === 'staff' && !q.svc); // svc posts: counters.js (ctx.counters) places that person
          for (const sp of sps.slice(0, B.restaurant ? 2 : 1)) this.posts.push({ kind: 'staff_shop', level: sp.level, x: sp.x, z: sp.z, yaw: sp.yaw, biz: B, apron: hex(sp.outfit && sp.outfit.apron), cap: !!(sp.outfit && sp.outfit.cap), callout: B.restaurant || B.cat === 'takoyaki', real: true });
        }
      } catch (e) { console.warn('[crowd] shop staff spots', e); }
    }
    // security at big concourses
    for (const [id, fx, fz] of [['nankai_2f', 0.3, 0.6], ['nankai_3f_concourse', 0.6, 0.3], ['walk_court', 0.2, 0.7], ['city_b1_north', 0.8, 0.5], ['m_north_free', 0.3, 0.7], ['nankai_1f', 0.7, 0.4], ['parks_2f_hall', 0.4, 0.5]]) {
      const s = this.spaceById(id); if (!s || !s.rect) continue;
      const x = s.rect[0] + (s.rect[2] - s.rect[0]) * fx, z = s.rect[1] + (s.rect[3] - s.rect[1]) * fz;
      if (this.col.walkable(s.level, x, z)) this.posts.push({ kind: 'security', level: s.level, x, z, yaw: (hash(id) % 628) / 100 });
    }
  }
}

function polyBounds(poly) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of poly) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
  return [x0, z0, x1, z1];
}
export { LEVELS };
