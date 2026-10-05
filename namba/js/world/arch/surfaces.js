// =============================================================================
// Surfaces: floors (+ borders, inlays, expansion joints, material-change
// strips), walls (skirting / dado / accent band / upper cladding), glass
// balustrades, slab edges around every hole, shop bulkheads (sign band),
// ceiling steps and contact-shadow (AO) strips.
// =============================================================================
import { CELL, EDGE } from '../world.js';
import { styleOf, bandMat, doorHead } from './styles.js';

// vertical face on the line a->b, facing the normal (nx, nz), offset along it
export function face(b, mat, ax, az, bx, bz, y0, y1, nx, nz, off = 0, opt) {
  ax += nx * off; bx += nx * off; az += nz * off; bz += nz * off;
  const dx = bx - ax, dz = bz - az;
  if (-dz * nx + dx * nz < 0) b.wall(mat, bx, bz, ax, az, y0, y1, false, opt);
  else b.wall(mat, ax, az, bx, bz, y0, y1, false, opt);
}
// horizontal strip on the floor along a->b, extending w towards the normal
export function strip(b, mat, ax, az, bx, bz, nx, nz, w, y, off = 0, opt) {
  const x0 = Math.min(ax, bx, ax + nx * (off + w), ax + nx * off), x1 = Math.max(ax, bx, bx + nx * (off + w), bx + nx * off);
  const z0 = Math.min(az, bz, az + nz * (off + w), az + nz * off), z1 = Math.max(az, bz, bz + nz * (off + w), bz + nz * off);
  // trim to the band between off and off+w
  if (nx !== 0) { const a = ax + nx * off, c = ax + nx * (off + w); b.rectH(mat, Math.min(a, c), Math.min(az, bz), Math.max(a, c), Math.max(az, bz), y, true, opt); }
  else if (nz !== 0) { const a = az + nz * off, c = az + nz * (off + w); b.rectH(mat, Math.min(ax, bx), Math.min(a, c), Math.max(ax, bx), Math.max(a, c), y, true, opt); }
  else b.rectH(mat, x0, z0, x1, z1, y, true, opt);
}

// glass balustrade with stainless cap rail and base shoe, along a->b
export function balustrade(b, ax, az, bx, bz, y, nx, nz, h = 1.1) {
  const len = Math.hypot(bx - ax, bz - az);
  const vert = Math.abs(ax - bx) < 1e-6;
  const mx = (ax + bx) / 2, mz = (az + bz) / 2;
  const sx = vert ? 0.04 : len, sz = vert ? len : 0.04;
  // inset slightly from the edge onto the walkable side
  const ix = nx * 0.08, iz = nz * 0.08;
  b.wall('glass_rail', ax + ix, az + iz, bx + ix, bz + iz, y + 0.1, y + h - 0.04, false);
  b.box('stainless', mx + ix, y + h - 0.02, mz + iz, vert ? 0.07 : len, 0.05, vert ? len : 0.07);
  b.box('steel_dark', mx + ix, y + 0.05, mz + iz, vert ? 0.1 : len, 0.1, vert ? len : 0.1);
  // glass clamps / panel joints every ~1.2 m
  const n = Math.max(1, Math.round(len / 1.2));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const px = ax + (bx - ax) * t + ix, pz = az + (bz - az) * t + iz;
    b.box('stainless', px, y + h * 0.55, pz, 0.025, h - 0.15, 0.025);
  }
  void sx; void sz;
}

export function buildSurfaces(K) {
  const { world, L } = K;
  const fascia = {};
  for (const lv of Object.keys(world.grids)) {
    const g = world.grids[lv];
    const y = K.y(lv);
    // ---- floors -------------------------------------------------------------
    for (let cz = 0; cz < g.h; cz++) {
      let run = null;
      const flush = () => {
        if (!run) return;
        const z0 = g.z0 + cz, x0 = g.x0 + run.c0, x1 = g.x0 + run.c1;
        const st = styleOf(run.sp);
        K.B(lv, (x0 + x1) / 2, z0).rectH(st.floor, x0, z0, x1, z0 + 1, y, true);
        run = null;
      };
      for (let cx = 0; cx <= g.w; cx++) {
        const i = cz * g.w + cx;
        let key = null, sp = null;
        if (cx < g.w && g.type[i] === CELL.WALK) { sp = L.spaces[g.space[i]]; key = styleOf(sp).floor; }
        if (run && run.key === key) { run.c1 = cx + 1; continue; }
        flush();
        if (key) run = { key, sp, c0: cx, c1: cx + 1 };
      }
    }
    // ---- material-change strips & zone thresholds -----------------------------
    for (let cz = 0; cz < g.h; cz++) for (let cx = 0; cx < g.w; cx++) {
      const i = cz * g.w + cx;
      if (g.type[i] !== CELL.WALK) continue;
      for (const [dx, dz] of [[1, 0], [0, 1]]) {
        if (cx + dx >= g.w || cz + dz >= g.h) continue;
        const j = i + dx + dz * g.w;
        if (g.type[j] !== CELL.WALK || g.space[j] === g.space[i]) continue;
        const A = L.spaces[g.space[i]], Bs = L.spaces[g.space[j]];
        if (A.kind === 'room' || Bs.kind === 'room' || A.outdoor || Bs.outdoor) continue;
        const X = g.x0 + cx + dx, Z = g.z0 + cz + dz;
        const b = K.B(lv, X, Z);
        if (A.zone !== Bs.zone) {
          // zone threshold: granite band with steel edges
          if (dx) { b.rectH('inlay_granite', X - 0.3, Z - 1, X + 0.3, Z, y + 0.003, true); b.rectH('inlay_steel', X - 0.33, Z - 1, X - 0.3, Z, y + 0.004, true); b.rectH('inlay_steel', X + 0.3, Z - 1, X + 0.33, Z, y + 0.004, true); }
          else { b.rectH('inlay_granite', X - 1, Z - 0.3, X, Z + 0.3, y + 0.003, true); b.rectH('inlay_steel', X - 1, Z - 0.33, X, Z - 0.3, y + 0.004, true); b.rectH('inlay_steel', X - 1, Z + 0.3, X, Z + 0.33, y + 0.004, true); }
        } else if (styleOf(A).floor !== styleOf(Bs).floor) {
          if (dx) b.rectH('inlay_steel', X - 0.025, Z - 1, X + 0.025, Z, y + 0.003, true);
          else b.rectH('inlay_steel', X - 1, Z - 0.025, X, Z + 0.025, y + 0.003, true);
        }
      }
    }
    // ---- expansion joints & inlay bands in long halls -------------------------
    L.spaces.forEach((sp, si) => {
      if (sp.level !== lv || !sp.rect || sp.kind === 'room' || sp.outdoor) return;
      const [x0, z0, x1, z1] = sp.rect;
      const W = x1 - x0, D = z1 - z0;
      const ax = W >= D ? 'x' : 'z';
      const long = Math.max(W, D), wide = Math.min(W, D);
      if (long < 30) return;
      const st = styleOf(sp);
      const inThis = (c) => c.si === si && c.t === CELL.WALK;
      // joints across every 18 m
      for (let p = Math.ceil((ax === 'x' ? x0 : z0) / 18) * 18; p < (ax === 'x' ? x1 : z1); p += 18) {
        const rs = K.runs(lv, ax === 'x' ? 'z' : 'x', p - 0.5, ax === 'x' ? z0 : x0, ax === 'x' ? z1 : x1, inThis);
        for (const [a, c] of rs) {
          if (ax === 'x') K.B(lv, p, (a + c) / 2).rectH('inlay_steel', p - 0.02, a, p + 0.02, c, y + 0.003, true);
          else K.B(lv, (a + c) / 2, p).rectH('inlay_steel', a, p - 0.02, c, p + 0.02, y + 0.003, true);
        }
      }
      // decorative lane bands along the axis for corridors
      if (wide <= 14 && st.border) {
        const mid = ax === 'x' ? (z0 + z1) / 2 : (x0 + x1) / 2;
        const offs = sp.style === 'city_mall' ? [[-0.6, 0.6, 'inlay_stone_light'], [-0.68, -0.6, 'inlay_granite'], [0.6, 0.68, 'inlay_granite']]
          : sp.style === 'arcade' ? [[-2.15, -2.0, 'inlay_granite'], [2.0, 2.15, 'inlay_granite']] : [];
        for (const [o0, o1, mat] of offs) {
          const rs = K.runs(lv, ax, mid + (o0 + o1) / 2, ax === 'x' ? x0 : z0, ax === 'x' ? x1 : z1, inThis);
          for (const [a, c] of rs) {
            if (ax === 'x') K.B(lv, (a + c) / 2, mid).rectH(mat, a, mid + o0, c, mid + o1, y + 0.002, true);
            else K.B(lv, mid, (a + c) / 2).rectH(mat, mid + o0, a, mid + o1, c, y + 0.002, true);
          }
        }
      }
    });
    // ---- walls, partitions, rails --------------------------------------------
    for (const e of world.edges[lv]) {
      const mx = (e.ax + e.bx) / 2, mz = (e.az + e.bz) / 2;
      const b = K.B(lv, mx, mz);
      const spA = e.spaceA >= 0 ? L.spaces[e.spaceA] : null, spB = e.spaceB >= 0 ? L.spaces[e.spaceB] : null;
      const walkSp = e.nx < 0 || e.nz < 0 ? spA : e.nx > 0 || e.nz > 0 ? spB : spA;
      if (e.kind === EDGE.WALL && walkSp && walkSp.outdoor) continue; // exterior/parks dress these
      if (e.kind === EDGE.WALL) {
        wallProgram(K, b, lv, e.ax, e.az, e.bx, e.bz, e.nx, e.nz, walkSp, y, walkSp ? walkSp.ceil : 3.5);
      } else if (e.kind === EDGE.PARTITION) {
        const vert = e.ax === e.bx;
        // side A is the low-coordinate side
        const nA = vert ? [-1, 0] : [0, -1], nB = vert ? [1, 0] : [0, 1];
        if (spA && !spA.outdoor) wallProgram(K, b, lv, e.ax, e.az, e.bx, e.bz, nA[0], nA[1], spA, y, Math.max(spA.ceil, spB ? spB.ceil : 0));
        if (spB && !spB.outdoor) wallProgram(K, b, lv, e.ax, e.az, e.bx, e.bz, nB[0], nB[1], spB, y, Math.max(spB.ceil, spA ? spA.ceil : 0));
      } else if (e.kind === EDGE.RAIL) {
        if (walkSp && walkSp.outdoor) continue;
        balustrade(b, e.ax, e.az, e.bx, e.bz, y, e.nx, e.nz);
      } else if (e.kind === EDGE.RAMP_SIDE) {
        if (!e.nx && !e.nz) continue;
        const c = K.cell(lv, mx - e.nx * 0.5, mz - e.nz * 0.5);
        if (c.t !== CELL.RAMP) continue;
        const r = L.ramps[c.ri];
        if (r.upper !== lv) continue; // lower level: the escalator/stair builds its own sides
        if (walkSp && walkSp.outdoor) {
          // street-level stair well: stone parapet
          face(b, 'wall_stone_warm', e.ax, e.az, e.bx, e.bz, y, y + 1.1, e.nx, e.nz, 0);
          face(b, 'wall_stone_warm', e.ax, e.az, e.bx, e.bz, y - 0.4, y + 1.1, -e.nx, -e.nz, 0.2);
          b.box('floor_granite', mx - e.nx * 0.1, y + 1.13, mz - e.nz * 0.1, e.ax === e.bx ? 0.3 : Math.abs(e.bx - e.ax) + 0.3, 0.06, e.ax === e.bx ? Math.abs(e.bz - e.az) + 0.3 : 0.3);
        } else balustrade(b, e.ax, e.az, e.bx, e.bz, y, e.nx, e.nz);
      }
    }
    // ---- shop bulkheads (sign band) ---------------------------------------------
    for (const sp of L.spaces) {
      if (sp.level !== lv || sp.kind !== 'room' || !sp.rect) continue;
      const [rx0, rz0, rx1, rz1] = sp.rect;
      for (const d of sp.doors) {
        const [dx0, dz0, dx1, dz1] = d;
        const horiz = Math.abs(dz0 - dz1) < 1e-6;
        let nx = 0, nz = 0;
        if (horiz) nz = Math.abs(dz0 - rz0) < 1e-6 ? -1 : 1; else nx = Math.abs(dx0 - rx0) < 1e-6 ? -1 : 1;
        const mx = (dx0 + dx1) / 2, mz = (dz0 + dz1) / 2;
        const out = K.cell(lv, mx + nx * 0.5, mz + nz * 0.5);
        if (out.t !== CELL.WALK || !out.sp || out.sp.outdoor) continue;
        const cor = out.sp, cst = styleOf(cor);
        const ch = cor.ceil, hh = doorHead(ch);
        const b = K.B(lv, mx, mz);
        const top = Math.max(ch, sp.ceil);
        // corridor face (sign band), room face, soffit
        face(b, cst.fascia, dx0, dz0, dx1, dz1, y + hh, y + ch, nx, nz, 0);
        face(b, styleOf(sp).wall, dx0, dz0, dx1, dz1, y + hh, y + top, -nx, -nz, 0.18);
        if (horiz) b.rectH('stainless', Math.min(dx0, dx1), Math.min(dz0, dz0 - nz * 0.18), Math.max(dx0, dx1), Math.max(dz0, dz0 - nz * 0.18), y + hh, false);
        else b.rectH('stainless', Math.min(dx0, dx0 - nx * 0.18), Math.min(dz0, dz1), Math.max(dx0, dx0 - nx * 0.18), Math.max(dz0, dz1), y + hh, false);
        // floor border continues across the opening on the corridor side
        if (cst.border) strip(b, cst.border[0], dx0, dz0, dx1, dz1, nx, nz, cst.border[1], y + 0.002);
        // threshold strip
        strip(b, 'inlay_steel', dx0, dz0, dx1, dz1, nx, nz, 0.05, y + 0.003, -0.025);
        // shop-side face end returns are covered by the partition pilasters
        const shopId = sp.id;
        fascia[shopId] = { level: lv, ax: dx0, az: dz0, bx: dx1, bz: dz1, nx, nz, y0: y + hh + 0.05, y1: y + ch - 0.05, corridor: cor.id };
      }
    }
    // ---- ceiling steps between adjacent indoor spaces ------------------------------
    for (let cz = 0; cz < g.h; cz++) for (let cx = 0; cx < g.w; cx++) {
      const i = cz * g.w + cx;
      if (g.type[i] !== CELL.WALK) continue;
      for (const [dx, dz] of [[1, 0], [0, 1]]) {
        if (cx + dx >= g.w || cz + dz >= g.h) continue;
        const j = i + dx + dz * g.w;
        if (g.type[j] !== CELL.WALK || g.space[j] === g.space[i]) continue;
        const A = L.spaces[g.space[i]], Bs = L.spaces[g.space[j]];
        if (A.outdoor || Bs.outdoor || A.kind === 'room' || Bs.kind === 'room') continue;
        if (Math.abs(A.ceil - Bs.ceil) < 0.01) continue;
        const X = g.x0 + cx + dx, Z = g.z0 + cz + dz;
        const xa = g.x0 + cx + 0.5, za = g.z0 + cz + 0.5, xb = xa + dx, zb = za + dz;
        if (K.isHole(K.above(lv), xa, za) || K.isHole(K.above(lv), xb, zb)) continue;
        const low = A.ceil < Bs.ceil ? A : Bs, high = low === A ? Bs : A;
        const nx = low === A ? -dx : dx, nz = low === A ? -dz : dz; // facing the lower side
        const b = K.B(lv, X, Z);
        const [ax, az, bx, bz] = dx ? [X, Z - 1, X, Z] : [X - 1, Z, X, Z];
        face(b, styleOf(low).fascia, ax, az, bx, bz, y + low.ceil, y + high.ceil, nx, nz, 0);
        // a reveal line at the step
        face(b, 'steel_dark', ax, az, bx, bz, y + low.ceil, y + low.ceil + 0.04, nx, nz, 0.005);
      }
    }
  }
  buildSlabEdges(K);
  return { fascia };
}

// One wall face with its style program (skirting, dado, band, upper cladding,
// contact shadow).
export function wallProgram(K, b, lv, ax, az, bx, bz, nx, nz, sp, y, h) {
  const st = styleOf(sp);
  const len = Math.hypot(bx - ax, bz - az);
  let y0 = y;
  const top = y + h;
  // dado
  if (st.dado) { face(b, st.dado.mat, ax, az, bx, bz, y0, Math.min(top, y + st.dado.h), nx, nz, 0); y0 = y + st.dado.h; }
  // upper cladding split
  if (st.upper && top > y + st.upper.y) {
    face(b, st.wall, ax, az, bx, bz, y0, y + st.upper.y, nx, nz, 0);
    face(b, st.upper.mat, ax, az, bx, bz, y + st.upper.y, top, nx, nz, 0);
  } else if (top > y0) face(b, st.wall, ax, az, bx, bz, y0, top, nx, nz, 0);
  // accent band (slightly proud)
  const bm = bandMat(st, sp);
  if (bm && st.band.y + st.band.h < h) face(b, bm, ax, az, bx, bz, y + st.band.y, y + st.band.y + st.band.h, nx, nz, 0.012);
  // skirting: proud strip with a top face
  if (st.skirt) {
    const [sm, sh] = st.skirt;
    face(b, sm, ax, az, bx, bz, y, y + sh, nx, nz, 0.015);
    strip(b, sm, ax, az, bx, bz, nx, nz, 0.015, y + sh, 0);
  }
  // floor border band
  if (st.border) strip(b, st.border[0], ax, az, bx, bz, nx, nz, st.border[1], y + 0.002);
  // contact shadow on the floor along the wall
  aoFloor(b, ax, az, bx, bz, nx, nz, y + 0.004, 0.5);
}

// floor contact-shadow strip (ao_strip gradient: dark at the wall)
export function aoFloor(b, ax, az, bx, bz, nx, nz, y, w) {
  if (nx) {
    const z0 = Math.min(az, bz), z1 = Math.max(az, bz);
    if (nx > 0) b.rectH('ao_strip', ax, z0, ax + w, z1, y, true, { uv: [[0, 0], [0, 1], [1, 1], [1, 0]] });
    else b.rectH('ao_strip', ax - w, z0, ax, z1, y, true, { uv: [[0, 1], [0, 0], [1, 0], [1, 1]] });
  } else if (nz) {
    const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx);
    if (nz > 0) b.rectH('ao_strip', x0, az, x1, az + w, y, true, { uv: [[0, 1], [1, 1], [1, 0], [0, 0]] });
    else b.rectH('ao_strip', x0, az - w, x1, az, y, true, { uv: [[0, 0], [1, 0], [1, 1], [0, 1]] });
  }
}

// Slab edges: every boundary between a hole (void / ramp well) and solid slab
// gets a clad edge face from the floor down to the ceiling of the level below.
function buildSlabEdges(K) {
  const { world, L } = K;
  for (const lv of Object.keys(world.grids)) {
    const g = world.grids[lv], y = K.y(lv);
    const bl = K.below(lv);
    for (let cz = 0; cz < g.h; cz++) for (let cx = 0; cx < g.w; cx++) {
      const X = g.x0 + cx + 0.5, Z = g.z0 + cz + 0.5;
      if (!K.isHole(lv, X, Z)) continue;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx0 = X + dx, nz0 = Z + dz;
        if (K.isHole(lv, nx0, nz0)) continue;
        const nc = K.cell(lv, nx0, nz0);
        // neighbour ramp on its lower level (escalator foot) or nothing: skip if
        // there is no slab to show (track / solid ground with no walk above)
        // bottom: ceiling of the level below under the neighbour cell
        let yb = y - 0.9;
        if (bl) {
          const cb = bl ? K.ceilAt(bl, nx0, nz0) : null;
          if (cb != null) yb = Math.min(y - 0.25, cb);
        }
        if (nc.t !== CELL.WALK && nc.t !== CELL.RAMP) { if (yb < y - 0.9) yb = y - 0.9; }
        // edge line between the cells, face towards the hole (-dx,-dz)
        const ex = X + dx * 0.5, ez = Z + dz * 0.5;
        const [ax, az, bx, bz] = dx ? [ex, Z - 0.5, ex, Z + 0.5] : [X - 0.5, ez, X + 0.5, ez];
        const b = K.B(lv, ex, ez);
        const st = styleOf(nc.sp || (bl ? K.cell(bl, nx0, nz0).sp : null));
        face(b, st.fascia === 'wall_dark' ? 'wall_dark' : 'esc_cladding_white', ax, az, bx, bz, yb, y, -dx, -dz, 0);
        // bottom reveal + cove light strip on deep edges
        face(b, 'steel_dark', ax, az, bx, bz, yb, yb + 0.05, -dx, -dz, 0.01);
      }
    }
  }
}
