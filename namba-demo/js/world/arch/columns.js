// =============================================================================
// Structural columns on a regular grid in every large indoor hall, plus two
// rows along subway island platforms. Each column is clad per zone, gets
// corner guards / skirting / line-colour band / a sign panel zone, and is
// registered with world.addBox so collision and crowds respect it.
// Clearance: never within reach of ramps (and their run-off), gate lines,
// shop doors, tactile routes, spawns, POIs, exits, voids or platform edges.
// =============================================================================
import { CELL } from '../world.js?v=454ed73';
import { styleOf, LINE_BAND } from './styles.js?v=454ed73';
import { face } from './surfaces.js?v=454ed73';

const TYPES = {
  metro:    { size: 0.9, pitch: 8, clad: 'wall_tile_metro', guard: 1.8, band: true, sign: true, skirt: 'rubber_dark' },
  terminal: { size: 1.2, pitch: 10, clad: 'wall_stone_warm', guard: 0, band: true, sign: true, skirt: 'floor_granite', upper: 'wall_panel_white', upperY: 3.2 },
  stone:    { size: 0.8, pitch: 9, clad: 'wall_marble', guard: 0, band: false, sign: false, skirt: 'stainless' },
  white:    { size: 0.8, pitch: 9, clad: 'wall_panel_white', guard: 1.5, band: false, sign: true, skirt: 'stainless' },
};
const PREFIX = { midosuji: 'M', sennichimae: 'S', nankai: 'N', nambawalk: 'W', takashimaya: 'T', city: 'C', link: 'L', parks: 'P' };

export function buildColumns(K) {
  const { world, L } = K;
  const cols = [];
  const counters = {};
  // ---- clearance tests --------------------------------------------------------------
  const distRect = (x, z, [x0, z0, x1, z1]) => Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(z0 - z, 0, z - z1));
  const blockedBy = (lv, x, z, r) => {
    for (const rp of L.ramps) {
      if (rp.lower !== lv && rp.upper !== lv) continue;
      if (distRect(x, z, rp.rect) < 1.6 + r) return true;
      // run-off zone in front of each entry
      const [x0, z0, x1, z1] = rp.rect;
      const runoff = 4;
      const R = rp.axis === 'z' ? [x0 - 0.5, z0 - runoff, x1 + 0.5, z1 + runoff] : [x0 - runoff, z0 - 0.5, x1 + runoff, z1 + 0.5];
      if (distRect(x, z, R) < r + 0.2) return true;
    }
    for (const gt of L.gates) {
      if (gt.level !== lv) continue;
      const along = gt.axis === 'x' ? x : z, cross = gt.axis === 'x' ? z : x;
      if (Math.abs(cross - gt.at) < 3.5 + r) return true;
      void along;
    }
    for (const sp of L.spaces) {
      if (sp.level !== lv || sp.kind !== 'room') continue;
      for (const d of sp.doors) if (distRect(x, z, [Math.min(d[0], d[2]), Math.min(d[1], d[3]), Math.max(d[0], d[2]), Math.max(d[1], d[3])]) < 2.0 + r) return true;
    }
    for (const t of L.tactile || []) {
      if (t.level !== lv) continue;
      for (let i = 0; i < t.pts.length; i++) {
        const a = t.pts[i], b = t.pts[Math.min(i + 1, t.pts.length - 1)];
        if (distRect(x, z, [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]) < 1.0 + r) return true;
      }
    }
    for (const s of Object.values(L.spawns)) if (s.level === lv && Math.hypot(s.x - x, s.z - z) < 3 + r) return true;
    for (const p of L.pois) if (p.level === lv && Math.hypot(p.x - x, p.z - z) < (p.kind === 'landmark' ? 5 : 2.5) + r) return true;
    for (const e of L.exits) if (e.level === lv && Math.hypot(e.x - x, e.z - z) < 3 + r) return true;
    for (const tr of L.tracks) if (tr.level === lv && distRect(x, z, tr.rect) < 2.2 + r) return true;
    if (!K.clear(lv, x, z, r + 0.4)) return true;
    // surrounding cells: walkable hall cells with a ceiling, no holes nearby
    const up = K.above(lv);
    for (let dz = -1.5; dz <= 1.5; dz += 0.5) for (let dx = -1.5; dx <= 1.5; dx += 0.5) {
      const c = K.cell(lv, x + dx, z + dz);
      if (c.t !== CELL.WALK || !c.sp || (c.sp.kind === 'room' && c.sp.style !== 'department') || c.sp.outdoor) return true;
      if (up && K.isHole(up, x + dx, z + dz)) return true;
    }
    return false;
  };
  const place = (lv, sp, x, z, type) => {
    const T = TYPES[type];
    x = Math.floor(x) + 0.5; z = Math.floor(z) + 0.5;
    if (blockedBy(lv, x, z, T.size / 2)) return;
    const pre = PREFIX[sp.zone] || 'X';
    counters[pre] = (counters[pre] || 0) + 1;
    const col = { level: lv, x, z, hx: T.size / 2, hz: T.size / 2, round: false, zone: sp.zone, space: sp.id, type, id: `${pre}-${String(counters[pre]).padStart(2, '0')}`, y0: K.y(lv), y1: K.y(lv) + sp.ceil, signY: T.sign ? [K.y(lv) + 1.45, K.y(lv) + 1.95] : null };
    cols.push(col);
    world.addBox(lv, x, z, T.size / 2, T.size / 2, 0);
    K.reserve(lv, x, z, T.size / 2 + 0.3);
    drawColumn(K, col, T);
  };
  // ---- halls: regular grid ----------------------------------------------------------
  for (const sp of L.spaces) {
    if (!sp.rect || sp.outdoor || (sp.kind === 'room' && sp.style !== 'department')) continue;
    const st = styleOf(sp);
    if (!st.col) continue;
    const [x0, z0, x1, z1] = sp.rect;
    const W = x1 - x0, D = z1 - z0;
    if (sp.kind === 'platform') {
      // two rows along an island platform, 2.6 m in from each edge
      const T = TYPES[st.col];
      const ax = W >= D ? 'x' : 'z';
      const half = (ax === 'x' ? D : W) / 2, mid = ax === 'x' ? (z0 + z1) / 2 : (x0 + x1) / 2;
      const a0 = ax === 'x' ? x0 : z0, a1 = ax === 'x' ? x1 : z1;
      for (const off of [-(half - 3.0), half - 3.0]) for (let a = a0 + 4; a < a1 - 2; a += T.pitch) {
        if (ax === 'x') place(sp.level, sp, a, mid + off, st.col); else place(sp.level, sp, mid + off, a, st.col);
      }
      continue;
    }
    if (Math.min(W, D) < 16) continue;
    const P = TYPES[st.col].pitch;
    const nx = Math.max(1, Math.floor((W - 6) / P) + 1), nz = Math.max(1, Math.floor((D - 6) / P) + 1);
    const ox = x0 + (W - (nx - 1) * P) / 2, oz = z0 + (D - (nz - 1) * P) / 2;
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) place(sp.level, sp, ox + i * P, oz + j * P, st.col);
  }
  return cols;
}

function drawColumn(K, c, T) {
  const b = K.B(c.level, c.x, c.z);
  const h = c.hx, y0 = c.y0, y1 = c.y1;
  const sides = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const lineMat = LINE_BAND[c.zone] || 'band_grey';
  for (const [nx, nz] of sides) {
    // face line on the column side, running along it
    const ax = c.x + nx * h + (nz ? -h : 0), az = c.z + nz * h + (nx ? -h : 0);
    const bx = c.x + nx * h + (nz ? h : 0), bz = c.z + nz * h + (nx ? h : 0);
    const split = T.upper ? y0 + T.upperY : y1;
    face(b, T.clad, ax, az, bx, bz, y0, split, nx, nz, 0);
    if (T.upper) { face(b, T.upper, ax, az, bx, bz, split, y1, nx, nz, 0); face(b, 'stainless', ax, az, bx, bz, split - 0.03, split + 0.03, nx, nz, 0.01); }
    face(b, T.skirt, ax, az, bx, bz, y0, y0 + 0.12, nx, nz, 0.012);
    if (T.band) face(b, lineMat, ax, az, bx, bz, y0 + 2.2, y0 + 2.36, nx, nz, 0.01);
    if (T.sign) face(b, 'wall_panel_white', ax, az, bx, bz, y0 + 1.45, y0 + 1.95, nx, nz, 0.008);
    if (T.clad === 'wall_marble' || T.clad === 'wall_stone_warm') face(b, 'stainless', ax, az, bx, bz, y1 - 0.06, y1, nx, nz, 0.01);
    // contact shadow
    const w = 0.35;
    if (nx) b.rectH('ao_strip', nx > 0 ? c.x + h : c.x - h - w, c.z - h - (nx > 0 ? 0 : 0), nx > 0 ? c.x + h + w : c.x - h, c.z + h, y0 + 0.004, true, { uv: nx > 0 ? [[0, 0], [0, 1], [1, 1], [1, 0]] : [[0, 1], [0, 0], [1, 0], [1, 1]] });
    else b.rectH('ao_strip', c.x - h, nz > 0 ? c.z + h : c.z - h - w, c.x + h, nz > 0 ? c.z + h + w : c.z - h, y0 + 0.004, true, { uv: nz > 0 ? [[0, 1], [1, 1], [1, 0], [0, 0]] : [[0, 0], [1, 0], [1, 1], [0, 1]] });
  }
  // stainless corner guards
  if (T.guard) for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    b.box('stainless', c.x + sx * (h + 0.005), y0 + T.guard / 2 + 0.12, c.z + sz * (h - 0.03), 0.012, T.guard, 0.07);
    b.box('stainless', c.x + sx * (h - 0.03), y0 + T.guard / 2 + 0.12, c.z + sz * (h + 0.005), 0.07, T.guard, 0.012);
  }
}
