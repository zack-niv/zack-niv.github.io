// =============================================================================
// Zone portals: every opening between two different operators' spaces (Metro /
// Nankai / NAMBAWALK / Namba CITY / Takashimaya / link) gets a legible threshold:
// jamb returns (0.3 m deep, clad in the zone's stone), a lintel bulkhead (0.55 m)
// with a thin zone-colour reveal on each side, and a soffit return. Department
// store entrances (rooms with style 'department') get stainless-clad jambs, a
// glass-door header and air-curtain slot. Floor transition strips already exist
// in surfaces.js.
// Openings wider than 16 m are left as open plazas (they are deliberate set-pieces).
// =============================================================================
import { CELL } from '../world.js?v=6c67dba';
import { styleOf, LINE_BAND } from './styles.js?v=6c67dba';
import { face } from './surfaces.js?v=6c67dba';

const stoneFor = (sp) => styleOf(sp).fascia || 'wall_panel_white';

export function buildPortals(K) {
  const { world, L } = K;
  let n = 0;
  for (const lv of Object.keys(world.grids)) {
    const g = world.grids[lv];
    const y = K.y(lv);
    // boundary segments keyed by line; each: { a, b (along), sA, sB, nx, nz (towards sB) }
    const lines = new Map();
    const push = (key, vert, c, a, sA, sB) => {
      let l = lines.get(key);
      if (!l) lines.set(key, l = { vert, c, sA, sB, iv: [] });
      l.iv.push(a);
    };
    for (let cz = 0; cz < g.h; cz++) for (let cx = 0; cx < g.w; cx++) {
      const i = cz * g.w + cx;
      if (g.type[i] !== CELL.WALK) continue;
      for (const [dx, dz] of [[1, 0], [0, 1]]) {
        if (cx + dx >= g.w || cz + dz >= g.h) continue;
        const j = i + dx + dz * g.w;
        if (g.type[j] !== CELL.WALK || g.space[j] === g.space[i]) continue;
        const A = L.spaces[g.space[i]], B = L.spaces[g.space[j]];
        if (A.kind === 'room' || B.kind === 'room' || A.outdoor || B.outdoor) continue;
        if (A.zone === B.zone) continue;
        const vert = dx === 1;
        const c = vert ? g.x0 + cx + 1 : g.z0 + cz + 1;
        const a = vert ? g.z0 + cz : g.x0 + cx;
        push(`${lv}|${vert ? 'v' : 'h'}|${c}|${g.space[i]}|${g.space[j]}`, vert, c, a, A, B);
      }
    }
    for (const l of lines.values()) {
      l.iv.sort((p, q) => p - q);
      let s = l.iv[0], prev = s;
      const emit = (a0, a1) => {
        const len = a1 - a0;
        if (len > 16 || len < 2) return;
        portal(K, lv, y, l, a0, a1);
        n++;
      };
      for (let k = 1; k < l.iv.length; k++) {
        if (l.iv[k] !== prev + 1) { emit(s, prev + 1); s = l.iv[k]; }
        prev = l.iv[k];
      }
      emit(s, prev + 1);
    }
    // department store entrances
    for (const sp of L.spaces) {
      if (sp.level !== lv || sp.kind !== 'room' || sp.style !== 'department') continue;
      for (const d of sp.doors) { departmentPortal(K, lv, y, sp, d); n++; }
    }
  }
  return n;
}

function portal(K, lv, y, l, a0, a1) {
  const { sA, sB, vert, c } = l;
  const ceil = Math.min(sA.ceil, sB.ceil);
  if (ceil < 2.6) return;
  const lin = 0.55;
  const b = K.B(lv, vert ? c : (a0 + a1) / 2, vert ? (a0 + a1) / 2 : c);
  const yt = y + ceil, yb = yt - lin;
  // normal pointing from A towards B (vert: +x; horizontal: +z)
  const nA = vert ? [-1, 0] : [0, -1], nB = vert ? [1, 0] : [0, 1];
  const P = (a) => (vert ? [c, a] : [a, c]);
  const [ax, az] = P(a0), [bx, bz] = P(a1);
  // lintel faces: each side shows its own style, with a zone-colour reveal at the bottom edge
  face(b, stoneFor(sA), ax, az, bx, bz, yb, yt, nA[0], nA[1], 0);
  face(b, stoneFor(sB), ax, az, bx, bz, yb, yt, nB[0], nB[1], 0);
  face(b, LINE_BAND[sA.zone] || 'band_grey', ax, az, bx, bz, yb, yb + 0.05, nA[0], nA[1], 0.012);
  face(b, LINE_BAND[sB.zone] || 'band_grey', ax, az, bx, bz, yb, yb + 0.05, nB[0], nB[1], 0.012);
  // soffit
  const t = 0.3;
  if (vert) b.rectH('ceiling_plaster', c - t, a0, c + t, a1, yb, false);
  else b.rectH('ceiling_plaster', a0, c - t, a1, c + t, yb, false);
  // jamb returns at both ends (0.3 m deep on each side, full height up to the lintel)
  for (const [pa, sgn] of [[a0, 1], [a1, -1]]) {
    for (const [nn, sp] of [[nA, sA], [nB, sB]]) {
      // return face looking along the opening, 0.3 m out from the line on that side
      const [px, pz] = P(pa);
      const ox = vert ? nn[0] * t : 0, oz = vert ? 0 : nn[1] * t;
      const q0 = [px, pz], q1 = [px + ox, pz + oz];
      const fx = vert ? 0 : sgn, fz = vert ? sgn : 0;
      face(b, stoneFor(sp), q0[0], q0[1], q1[0], q1[1], y, yb, fx, fz, 0);
    }
    // stainless corner trim
    const [px, pz] = P(pa);
    b.box('stainless', px, y + (yb - y) / 2, pz, 0.03, yb - y, 0.03);
  }
}

function departmentPortal(K, lv, y, sp, d) {
  const [dx0, dz0, dx1, dz1] = d;
  const horiz = Math.abs(dz0 - dz1) < 1e-6;
  const [rx0, rz0, rx1, rz1] = sp.rect;
  let nx = 0, nz = 0;
  if (horiz) nz = Math.abs(dz0 - rz0) < 1e-6 ? -1 : 1; else nx = Math.abs(dx0 - rx0) < 1e-6 ? -1 : 1;
  const out = K.cell(lv, (dx0 + dx1) / 2 + nx * 0.5, (dz0 + dz1) / 2 + nz * 0.5);
  if (out.t !== CELL.WALK || !out.sp) return;
  const b = K.B(lv, (dx0 + dx1) / 2, (dz0 + dz1) / 2);
  const len = Math.hypot(dx1 - dx0, dz1 - dz0);
  const ux = (dx1 - dx0) / len, uz = (dz1 - dz0) / len;
  const hh = Math.min(3.0, Math.max(2.45, out.sp.ceil - 0.55));
  // stainless-clad jambs inside the opening
  for (const s of [0, 1]) {
    const px = s ? dx1 : dx0, pz = s ? dz1 : dz0;
    const sx = (s ? -1 : 1) * ux * 0.2, sz = (s ? -1 : 1) * uz * 0.2;
    b.box('stainless', px + sx / 2 - nx * 0.1, y + hh / 2, pz + sz / 2 - nz * 0.1, horiz ? 0.4 : 0.25, hh, horiz ? 0.25 : 0.4);
  }
  // glass-door header: dark steel transom with a lit air-curtain slot and a brand band
  const m = [(dx0 + dx1) / 2, (dz0 + dz1) / 2];
  const h0 = hh - 0.35;
  const w = Math.max(0, len - 0.4);
  const cx = m[0] - nx * 0.12, cz = m[1] - nz * 0.12;
  b.box('steel_painted_dark', cx, y + h0 + 0.175, cz, horiz ? w : 0.14, 0.35, horiz ? 0.14 : w);
  b.box('light_line_neutral', cx + nx * 0.0, y + h0 - 0.01, cz + nz * 0.0, horiz ? w - 0.2 : 0.06, 0.02, horiz ? 0.06 : w - 0.2);
  // floor: rubber door-mat strip across the threshold (central 6 m), outside and inside
  const mw = Math.min(6, w) / 2;
  const mx = m[0], mz = m[1];
  if (horiz) b.rectH('rubber_dark', mx - mw, mz - 1.0, mx + mw, mz + 1.0, y + 0.004, true);
  else b.rectH('rubber_dark', mx - 1.0, mz - mw, mx + 1.0, mz + mw, y + 0.004, true);
}
