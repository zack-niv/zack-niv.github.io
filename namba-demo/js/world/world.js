// =============================================================================
// World model: rasterises the layout into a 1 m walk grid per level, derives
// every wall / railing / platform edge as merged line segments, and provides
// collision + ramp (escalator/stairs) physics shared by the player and NPCs.
//
// Everything visual (walls, rails, floors, ceilings) should be generated from
// the same `edges` / `cells` data, so what you see is exactly what you collide
// with.
// =============================================================================
import { LAYOUT, LEVELS, LEVEL_ORDER, rampProfile, rampLocal, rampLength } from './layout.js?v=517b401';

export const CELL = { SOLID: 0, WALK: 1, VOID: 2, TRACK: 3, RAMP: 4 };
// edge kinds
export const EDGE = {
  WALL: 'wall',          // walkable | solid
  PARTITION: 'partition',// walkable | walkable, different rooms (two-sided wall)
  RAIL: 'rail',          // walkable | void (balustrade over an atrium)
  RAMP_SIDE: 'rampSide', // walkable | ramp footprint side (escalator balustrade)
  TRACK: 'track',        // walkable | track bed (platform edge)
};

function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function polyBounds(poly) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of poly) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
  return [Math.floor(x0), Math.floor(z0), Math.ceil(x1), Math.ceil(z1)];
}
export function spaceBounds(s) { return s.rect || polyBounds(s.poly); }
export function spaceContains(s, x, z) {
  if (s.rect) return x >= s.rect[0] && x < s.rect[2] && z >= s.rect[1] && z < s.rect[3];
  return pointInPoly(x, z, s.poly);
}

// segment-on-segment containment for axis-aligned door tests
function onDoor(door, ax, az, bx, bz) {
  const [x0, z0, x1, z1] = door;
  const dx0 = Math.min(x0, x1), dx1 = Math.max(x0, x1), dz0 = Math.min(z0, z1), dz1 = Math.max(z0, z1);
  return Math.min(ax, bx) >= dx0 - 1e-6 && Math.max(ax, bx) <= dx1 + 1e-6 && Math.min(az, bz) >= dz0 - 1e-6 && Math.max(az, bz) <= dz1 + 1e-6;
}

export class LevelGrid {
  constructor(level, x0, z0, x1, z1) {
    this.level = level;
    this.y = LEVELS[level].y;
    this.x0 = x0; this.z0 = z0;
    this.w = x1 - x0; this.h = z1 - z0;
    const n = this.w * this.h;
    this.type = new Uint8Array(n);
    this.space = new Int16Array(n).fill(-1);   // index into LAYOUT.spaces
    this.ramp = new Int16Array(n).fill(-1);    // index into LAYOUT.ramps
    this.blocked = new Uint8Array(n);          // obstacle-blocked for navigation
  }
  idx(cx, cz) { return cz * this.w + cx; }
  cellOf(x, z) {
    const cx = Math.floor(x - this.x0), cz = Math.floor(z - this.z0);
    if (cx < 0 || cz < 0 || cx >= this.w || cz >= this.h) return -1;
    return cz * this.w + cx;
  }
  typeAt(x, z) { const i = this.cellOf(x, z); return i < 0 ? CELL.SOLID : this.type[i]; }
  spaceAt(x, z) { const i = this.cellOf(x, z); return i < 0 ? -1 : this.space[i]; }
}

export class World {
  constructor() {
    this.layout = LAYOUT;
    this.grids = {};
    this.edges = {};      // level -> [{ax,az,bx,bz,kind,nx,nz, twoSided, spaceA, spaceB}]
    this.segs = {};       // level -> collision segments (Float32 packed)
    this.hash = {};       // level -> spatial hash
    this.rampSegs = [];   // per ramp collision segments
    this.obstacles = {};  // level -> [{cx,cz,hx,hz,rot}]
    this.spaceIndex = new Map(LAYOUT.spaces.map((s, i) => [s.id, i]));
    this._build();
  }

  // ---------------------------------------------------------------------------
  _build() {
    const L = this.layout;
    // bounds per level
    const bounds = {};
    const grow = (lv, [x0, z0, x1, z1]) => {
      const b = bounds[lv] || (bounds[lv] = [Infinity, Infinity, -Infinity, -Infinity]);
      b[0] = Math.min(b[0], x0); b[1] = Math.min(b[1], z0); b[2] = Math.max(b[2], x1); b[3] = Math.max(b[3], z1);
    };
    L.spaces.forEach(s => grow(s.level, spaceBounds(s)));
    L.tracks.forEach(t => grow(t.level, t.rect));
    L.ramps.forEach(r => { grow(r.lower, r.rect); grow(r.upper, r.rect); });
    for (const lv of LEVEL_ORDER) {
      if (!bounds[lv]) continue;
      const [x0, z0, x1, z1] = bounds[lv];
      this.grids[lv] = new LevelGrid(lv, x0 - 2, z0 - 2, x1 + 2, z1 + 2);
      this.obstacles[lv] = [];
    }
    // spaces
    L.spaces.forEach((s, si) => {
      const g = this.grids[s.level];
      const [bx0, bz0, bx1, bz1] = spaceBounds(s);
      for (let z = bz0; z < bz1; z++) for (let x = bx0; x < bx1; x++) {
        if (!spaceContains(s, x + 0.5, z + 0.5)) continue;
        const i = g.cellOf(x + 0.5, z + 0.5);
        g.type[i] = CELL.WALK; g.space[i] = si;
      }
    });
    // tracks
    L.tracks.forEach(t => {
      const g = this.grids[t.level];
      for (let z = t.rect[1]; z < t.rect[3]; z++) for (let x = t.rect[0]; x < t.rect[2]; x++) {
        const i = g.cellOf(x + 0.5, z + 0.5);
        if (g.type[i] === CELL.SOLID) g.type[i] = CELL.TRACK;
      }
    });
    // voids
    L.voids.forEach(v => {
      const g = this.grids[v.level];
      for (let z = v.rect[1]; z < v.rect[3]; z++) for (let x = v.rect[0]; x < v.rect[2]; x++) {
        const i = g.cellOf(x + 0.5, z + 0.5);
        if (g.type[i] === CELL.WALK) { g.type[i] = CELL.VOID; }
      }
    });
    // structural cores (station rooms, shafts): solid blocks carved out of halls
    (L.cores || []).forEach(c => {
      const g = this.grids[c.level]; if (!g) return;
      for (let z = c.rect[1]; z < c.rect[3]; z++) for (let x = c.rect[0]; x < c.rect[2]; x++) {
        const i = g.cellOf(x + 0.5, z + 0.5);
        if (i >= 0 && g.type[i] === CELL.WALK) { g.type[i] = CELL.SOLID; g.space[i] = -1; }
      }
    });
    // ramps (override everything on both levels)
    L.ramps.forEach((r, ri) => {
      for (const lv of [r.lower, r.upper]) {
        const g = this.grids[lv];
        for (let z = r.rect[1]; z < r.rect[3]; z++) for (let x = r.rect[0]; x < r.rect[2]; x++) {
          const i = g.cellOf(x + 0.5, z + 0.5);
          g.type[i] = CELL.RAMP; g.ramp[i] = ri;
        }
      }
    });
    for (const lv in this.grids) this._buildEdges(lv);
    L.ramps.forEach((r, ri) => this._buildRampSegs(r, ri));
    L.gates.forEach(gt => this._buildGate(gt));
    for (const lv in this.grids) this._buildHash(lv);
  }

  // Is the unit edge between cell a (walk) and neighbour b passable?
  // Returns null if open, otherwise an EDGE kind.
  _edgeKind(lv, g, ia, ib, ax, az, bx, bz) {
    const ta = g.type[ia], tb = g.type[ib];
    const L = this.layout;
    if (ta === CELL.WALK && tb === CELL.WALK) {
      const sa = g.space[ia], sb = g.space[ib];
      if (sa === sb) return null;
      const A = L.spaces[sa], B = L.spaces[sb];
      if (A.kind !== 'room' && B.kind !== 'room') return null;
      for (const S of [A, B]) if (S.kind === 'room') for (const d of S.doors) if (onDoor(d, ax, az, bx, bz)) return null;
      return EDGE.PARTITION;
    }
    // ramp entries
    const ramped = ta === CELL.RAMP ? ia : tb === CELL.RAMP ? ib : -1;
    if (ramped >= 0) {
      const other = ramped === ia ? tb : ta;
      if (ta === CELL.RAMP && tb === CELL.RAMP) return g.ramp[ia] === g.ramp[ib] ? null : EDGE.RAMP_SIDE;
      if (other !== CELL.WALK) return null; // ramp vs solid: ramp handles its own sides
      const r = L.ramps[g.ramp[ramped]];
      // which end is the entry for this level?
      const entryHigh = lv === r.upper;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      // the edge is on an end line if it is perpendicular to the ramp axis
      const [x0, z0, x1, z1] = r.rect;
      let endLine;
      if (r.axis === 'x') {
        if (ax !== bx) return EDGE.RAMP_SIDE; // edge runs along x => side
        const lowX = r.up > 0 ? x0 : x1, highX = r.up > 0 ? x1 : x0;
        endLine = entryHigh ? highX : lowX;
        return Math.abs(ax - endLine) < 1e-6 ? null : EDGE.RAMP_SIDE;
      } else {
        if (az !== bz) return EDGE.RAMP_SIDE;
        const lowZ = r.up > 0 ? z0 : z1, highZ = r.up > 0 ? z1 : z0;
        endLine = entryHigh ? highZ : lowZ;
        return Math.abs(az - endLine) < 1e-6 ? null : EDGE.RAMP_SIDE;
      }
    }
    if (ta === CELL.WALK || tb === CELL.WALK) {
      const t = ta === CELL.WALK ? tb : ta;
      if (t === CELL.VOID) return EDGE.RAIL;
      if (t === CELL.TRACK) return EDGE.TRACK;
      return EDGE.WALL;
    }
    return null; // between two non-walkable cells: nothing
  }

  _buildEdges(lv) {
    const g = this.grids[lv];
    const raw = [];
    // vertical edges (between x and x+1) and horizontal edges (z, z+1)
    for (let cz = 0; cz < g.h; cz++) for (let cx = 0; cx < g.w; cx++) {
      const ia = g.idx(cx, cz);
      const X = g.x0 + cx, Z = g.z0 + cz;
      // east neighbour
      if (cx + 1 < g.w) {
        const ib = ia + 1;
        if (g.type[ia] === CELL.WALK || g.type[ib] === CELL.WALK || (g.type[ia] === CELL.RAMP && g.type[ib] === CELL.RAMP)) {
          const k = this._edgeKind(lv, g, ia, ib, X + 1, Z, X + 1, Z + 1);
          if (k) raw.push({ o: 'v', c: X + 1, a: Z, kind: k, sa: g.type[ia] === CELL.WALK, sb: g.type[ib] === CELL.WALK, spA: g.space[ia], spB: g.space[ib] });
        }
      }
      if (cz + 1 < g.h) {
        const ib = ia + g.w;
        if (g.type[ia] === CELL.WALK || g.type[ib] === CELL.WALK || (g.type[ia] === CELL.RAMP && g.type[ib] === CELL.RAMP)) {
          const k = this._edgeKind(lv, g, ia, ib, X, Z + 1, X + 1, Z + 1);
          if (k) raw.push({ o: 'h', c: Z + 1, a: X, kind: k, sa: g.type[ia] === CELL.WALK, sb: g.type[ib] === CELL.WALK, spA: g.space[ia], spB: g.space[ib] });
        }
      }
    }
    // merge colinear contiguous unit edges with identical attributes
    const key = e => `${e.o}|${e.c}|${e.kind}|${e.sa}|${e.sb}|${e.spA}|${e.spB}`;
    const groups = new Map();
    for (const e of raw) { const k = key(e); (groups.get(k) || groups.set(k, []).get(k)).push(e); }
    const out = [];
    for (const list of groups.values()) {
      list.sort((p, q) => p.a - q.a);
      let s = list[0], len = 1;
      const flush = () => {
        const e = s;
        // normal points towards the walkable side; a = low side, b = high side
        let ax, az, bx, bz, nx = 0, nz = 0;
        if (e.o === 'v') { ax = bx = e.c; az = e.a; bz = e.a + len; nx = e.sa && !e.sb ? -1 : e.sb && !e.sa ? 1 : 0; }
        else { az = bz = e.c; ax = e.a; bx = e.a + len; nz = e.sa && !e.sb ? -1 : e.sb && !e.sa ? 1 : 0; }
        out.push({ ax, az, bx, bz, kind: e.kind, nx, nz, twoSided: e.sa && e.sb, spaceA: e.spA, spaceB: e.spB, level: lv });
      };
      for (let i = 1; i < list.length; i++) {
        if (list[i].a === s.a + len) len++;
        else { flush(); s = list[i]; len = 1; }
      }
      flush();
    }
    this.edges[lv] = out;
  }

  // collision segments for the inside of a ramp, plus the "funnel" pieces that
  // narrow each entry from the footprint width to the walk width.
  _buildRampSegs(r, ri) {
    const [x0, z0, x1, z1] = r.rect;
    const hw = r.walkWidth / 2;
    const segs = [];
    const extra = { [r.lower]: [], [r.upper]: [] };
    if (r.axis === 'z') {
      const cx = (x0 + x1) / 2;
      segs.push([cx - hw, z0 - 0.2, cx - hw, z1 + 0.2], [cx + hw, z0 - 0.2, cx + hw, z1 + 0.2]);
      const lowZ = r.up > 0 ? z0 : z1, highZ = r.up > 0 ? z1 : z0;
      for (const [lv, zz] of [[r.lower, lowZ], [r.upper, highZ]]) {
        if (cx - hw > x0) extra[lv].push([x0, zz, cx - hw, zz]);
        if (cx + hw < x1) extra[lv].push([cx + hw, zz, x1, zz]);
      }
    } else {
      const cz = (z0 + z1) / 2;
      segs.push([x0 - 0.2, cz - hw, x1 + 0.2, cz - hw], [x0 - 0.2, cz + hw, x1 + 0.2, cz + hw]);
      const lowX = r.up > 0 ? x0 : x1, highX = r.up > 0 ? x1 : x0;
      for (const [lv, xx] of [[r.lower, lowX], [r.upper, highX]]) {
        if (cz - hw > z0) extra[lv].push([xx, z0, xx, cz - hw]);
        if (cz + hw < z1) extra[lv].push([xx, cz + hw, xx, z1]);
      }
    }
    this.rampSegs[ri] = segs;
    this._rampExtra = this._rampExtra || {};
    for (const lv in extra) (this._rampExtra[lv] = this._rampExtra[lv] || []).push(...extra[lv]);
  }

  // Ticket gates: machine bodies between lanes + fences to the space walls.
  _buildGate(gt) {
    const lv = gt.level;
    const g = this.grids[lv];
    // find extent of the space(s) around the gate line along its axis
    const probeX = gt.axis === 'x' ? (gt.from + gt.to) / 2 : gt.at - 0.5;
    const probeZ = gt.axis === 'x' ? gt.at - 0.5 : (gt.from + gt.to) / 2;
    let lo = gt.from, hi = gt.to;
    const step = (dir) => {
      let p = dir < 0 ? gt.from : gt.to;
      for (let k = 0; k < 80; k++) {
        const q = p + dir * 0.5;
        const x = gt.axis === 'x' ? q : gt.at - 0.5, z = gt.axis === 'x' ? gt.at - 0.5 : q;
        if (g.typeAt(x, z) !== CELL.WALK) break;
        p = q;
      }
      return p;
    };
    lo = Math.floor(step(-1)); hi = Math.ceil(step(1));
    const lane = (gt.to - gt.from) / gt.lanes;
    gt.laneWidth = lane;
    gt.machines = [];
    for (let i = 0; i <= gt.lanes; i++) {
      const a = gt.from + i * lane;
      gt.machines.push(a);
      if (gt.axis === 'x') this.addBox(lv, a, gt.at, 0.14, 0.7, 0, true);
      else this.addBox(lv, gt.at, a, 0.7, 0.14, 0, true);
    }
    gt.fence = [[lo, gt.from], [gt.to, hi]];
    const ex = this._rampExtra || (this._rampExtra = {});
    const list = ex[lv] || (ex[lv] = []);
    for (const [a, b] of gt.fence) {
      if (b - a < 0.01) continue;
      if (gt.axis === 'x') list.push([a, gt.at, b, gt.at]); else list.push([gt.at, a, gt.at, b]);
    }
  }

  // Register a static rectangular obstacle (pillar, kiosk, bench, gate
  // machine...). Must be called before nav is built (game init order handles
  // this: world -> builders -> nav).
  addBox(level, cx, cz, hx, hz, rot = 0, deferHash = false) {
    const o = { cx, cz, hx, hz, rot };
    this.obstacles[level].push(o);
    if (!deferHash && this.hash[level]) this._insertBox(level, o);
    // mark nav-blocked cells (cells whose centre lies inside the box inflated by 0.2)
    const g = this.grids[level];
    const c = Math.cos(rot), s = Math.sin(rot);
    const r = Math.hypot(hx, hz) + 0.5;
    for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const px = x + 0.5 - cx, pz = z + 0.5 - cz;
      const lx = px * c + pz * s, lz = -px * s + pz * c;
      if (Math.abs(lx) < hx + 0.2 && Math.abs(lz) < hz + 0.2) {
        const i = g.cellOf(x + 0.5, z + 0.5);
        if (i >= 0) g.blocked[i] = 1;
      }
    }
    return o;
  }
  addCylinder(level, cx, cz, radius) { return this.addBox(level, cx, cz, radius * 0.9, radius * 0.9, 0); }

  _boxSegs(o) {
    const c = Math.cos(o.rot), s = Math.sin(o.rot);
    const pts = [[-o.hx, -o.hz], [o.hx, -o.hz], [o.hx, o.hz], [-o.hx, o.hz]].map(([x, z]) => [o.cx + x * c - z * s, o.cz + x * s + z * c]);
    return [0, 1, 2, 3].map(i => [pts[i][0], pts[i][1], pts[(i + 1) % 4][0], pts[(i + 1) % 4][1]]);
  }

  _buildHash(lv) {
    const segs = [];
    for (const e of this.edges[lv]) segs.push([e.ax, e.az, e.bx, e.bz]);
    for (const s of (this._rampExtra && this._rampExtra[lv]) || []) segs.push(s);
    for (const o of this.obstacles[lv]) segs.push(...this._boxSegs(o));
    this.segs[lv] = segs;
    const H = { size: 4, map: new Map() };
    this.hash[lv] = H;
    segs.forEach((s, i) => this._hashSeg(H, s, i));
  }
  _hashSeg(H, s, i) {
    const x0 = Math.floor(Math.min(s[0], s[2]) / H.size), x1 = Math.floor(Math.max(s[0], s[2]) / H.size);
    const z0 = Math.floor(Math.min(s[1], s[3]) / H.size), z1 = Math.floor(Math.max(s[1], s[3]) / H.size);
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const k = x * 73856093 ^ z * 19349663;
      let b = H.map.get(k); if (!b) H.map.set(k, b = []);
      b.push(i);
    }
  }
  _insertBox(lv, o) {
    for (const s of this._boxSegs(o)) { this.segs[lv].push(s); this._hashSeg(this.hash[lv], s, this.segs[lv].length - 1); }
  }

  // ---------------------------------------------------------------------------
  // Physics
  // ---------------------------------------------------------------------------
  // body: { x, z, level, ramp (index or -1), y } — mutated in place.
  // Moves by (dx, dz), resolving collisions for a circle of radius r.
  // Returns true if the body changed level/ramp state.
  move(body, dx, dz, r = 0.3) {
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / (r * 0.8)));
    let changed = false;
    const px0 = body.x, pz0 = body.z;
    for (let k = 0; k < steps; k++) {
      body.x += dx / steps; body.z += dz / steps;
      this._resolve(body, r);
      changed = this._updateState(body) || changed;
    }
    // safety net: a degenerate resolve must never fling a body out of the world
    if (!Number.isFinite(body.x) || !Number.isFinite(body.z) || Math.abs(body.x - px0) > 50 || Math.abs(body.z - pz0) > 50) { body.x = px0; body.z = pz0; }
    this._updateY(body);
    return changed;
  }

  _resolve(body, r) {
    const segs = body.ramp >= 0 ? this.rampSegs[body.ramp] : null;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      const test = (s) => {
        const ax = s[0], az = s[1], bx = s[2], bz = s[3];
        const ex = bx - ax, ez = bz - az;
        const l2 = ex * ex + ez * ez;
        let t = l2 > 0 ? ((body.x - ax) * ex + (body.z - az) * ez) / l2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const px = ax + ex * t, pz = az + ez * t;
        let qx = body.x - px, qz = body.z - pz;
        const d2 = qx * qx + qz * qz;
        if (d2 < r * r) {
          let d = Math.sqrt(d2);
          if (d2 < 1e-10) {
            // exactly on the segment: push out along its normal (never divide by ~0)
            const el = Math.sqrt(l2) || 1;
            qx = -ez / el; qz = ex / el; d = 1;
            body.x += qx * r; body.z += qz * r;
          } else {
            const push = (r - d) / d;
            body.x += qx * push; body.z += qz * push;
          }
          moved = true;
        }
      };
      if (segs) { for (const s of segs) test(s); }
      else {
        const H = this.hash[body.level]; const all = this.segs[body.level];
        const x0 = Math.floor((body.x - r) / H.size), x1 = Math.floor((body.x + r) / H.size);
        const z0 = Math.floor((body.z - r) / H.size), z1 = Math.floor((body.z + r) / H.size);
        const seen = this._seen || (this._seen = new Set()); seen.clear();
        for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
          const b = H.map.get(x * 73856093 ^ z * 19349663);
          if (b) for (const i of b) { if (!seen.has(i)) { seen.add(i); test(all[i]); } }
        }
      }
      if (!moved) break;
    }
  }

  _updateState(body) {
    const L = this.layout;
    if (body.ramp >= 0) {
      const r = L.ramps[body.ramp];
      const { s } = rampLocal(r, body.x, body.z);
      if (s < 0) { body.level = r.lower; body.ramp = -1; return true; }
      if (s > 1) { body.level = r.upper; body.ramp = -1; return true; }
      return false;
    }
    const g = this.grids[body.level];
    const i = g.cellOf(body.x, body.z);
    if (i >= 0 && g.type[i] === CELL.RAMP) {
      body.ramp = g.ramp[i];
      return true;
    }
    return false;
  }

  _updateY(body) {
    if (body.ramp >= 0) {
      const r = this.layout.ramps[body.ramp];
      const { s } = rampLocal(r, body.x, body.z);
      body.y = rampProfile(r, Math.min(1, Math.max(0, s)));
    } else body.y = LEVELS[body.level].y;
  }

  // Escalator conveyor velocity for a body (m/s along ground plane).
  conveyor(body) {
    if (body.ramp < 0) return null;
    const r = this.layout.ramps[body.ramp];
    if (!r.move) return null;
    const speed = 0.5 * r.move; // positive = towards high end
    return r.axis === 'x' ? { x: speed * r.up, z: 0 } : { x: 0, z: speed * r.up };
  }

  isWalkable(level, x, z) {
    const g = this.grids[level]; if (!g) return false;
    const t = g.typeAt(x, z);
    return t === CELL.WALK || t === CELL.RAMP;
  }
  spaceAt(level, x, z) {
    const g = this.grids[level]; if (!g) return null;
    const i = g.spaceAt(x, z);
    return i >= 0 ? this.layout.spaces[i] : null;
  }
  // The space/zone a body is in (ramps report their zone)
  locate(body) {
    if (body.ramp >= 0) {
      const r = this.layout.ramps[body.ramp];
      return { zone: r.zone, space: null, ramp: r, level: body.level };
    }
    const s = this.spaceAt(body.level, body.x, body.z);
    return { zone: s ? s.zone : null, space: s, ramp: null, level: body.level };
  }
  // Line-of-sight test on one level (walls/partitions only) — used for NPC
  // look-at, signage visibility, audio occlusion.
  visible(level, ax, az, bx, bz) {
    const g = this.grids[level];
    const d = Math.hypot(bx - ax, bz - az);
    const n = Math.ceil(d / 0.5);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const tt = g.typeAt(ax + (bx - ax) * t, az + (bz - az) * t);
      if (tt === CELL.SOLID) return false;
    }
    return true;
  }
}
