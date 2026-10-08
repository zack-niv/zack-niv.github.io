// =============================================================================
// Station structure (platform side). Transit owns everything inside the track
// pits (rails, sleepers, pit ceilings, tunnels, the shed roof over the tracks,
// catenary, PSDs, gates). Architecture builds:
//   * platform edges: coping, JIS dot line with inner bar, lip, refuge recess
//   * subway back walls of the station box (outer side of each track) with
//     backlit advertising frames
//   * Midosuji (B2): segmental vault over the island platform, linear lights,
//     ring chandeliers; holes + wells for the escalators
//   * Sennichimae (B2): spandrel ceiling with line lights over the platform
//   * Nankai (3F): platform roofs at the shed height (matching transit's pit
//     roofs), centreline columns under transit's roof trusses, service beams
//     with light lines (sign mounting), glazed side walls, trussed concourse
//     roof with a clerestory monitor
// =============================================================================
import { CELL, EDGE } from '../world.js?v=488c31e';
import { styleOf, LINE_BAND } from './styles.js?v=488c31e';
import { face, strip } from './surfaces.js?v=488c31e';
import { KELVIN } from './kit.js?v=488c31e';

const UP = [0, 1, 0], DOWN = [0, -1, 0];
function Q(b, mat, a, bb, c, d, n, uv) {
  const ux = bb[0] - a[0], uy = bb[1] - a[1], uz = bb[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
  const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
  if (cx * n[0] + cy * n[1] + cz * n[2] >= 0) b.quad(mat, a, bb, c, d, uv ? { uv } : undefined);
  else b.quad(mat, bb, a, d, c, uv ? { uv: [uv[1], uv[0], uv[3], uv[2]] } : undefined);
}
const bar = (b, mat, a, c, w, h) => b.sweep(mat, [a, c], [[-h / 2, -w / 2], [h / 2, -w / 2], [h / 2, w / 2], [-h / 2, w / 2]]);

export function buildStations(K) {
  const out = { adFrames: [], serviceBeams: [], platformColumns: [] };
  platformEdges(K);
  subwayWalls(K, out);
  midosujiVault(K);
  sennichimaeCeiling(K);
  nankaiShed(K, out);
  nankaiConcourseRoof(K);
  return out;
}

// ---------------------------------------------------------------------------
function platformEdges(K) {
  for (const lv of Object.keys(K.world.grids)) {
    const y = K.y(lv);
    for (const e of K.world.edges[lv]) {
      if (e.kind !== EDGE.TRACK) continue;
      const { nx, nz } = e;
      if (!nx && !nz) continue;
      const b = K.B(lv, (e.ax + e.bx) / 2, (e.az + e.bz) / 2);
      // coping band, white safety line
      strip(b, 'inlay_stone_light', e.ax, e.az, e.bx, e.bz, nx, nz, 0.55, y + 0.003);
      strip(b, 'steel_painted_white', e.ax, e.az, e.bx, e.bz, nx, nz, 0.05, y + 0.004, 0.55);
      // JIS dot blocks with the inner-side bar (内方線付き点状ブロック)
      strip(b, 'tactile_dot', e.ax, e.az, e.bx, e.bz, nx, nz, 0.3, y + 0.006, 0.8);
      strip(b, 'esc_comb', e.ax, e.az, e.bx, e.bz, nx, nz, 0.035, y + 0.008, 1.13);
      // lip (faces the track), underside, refuge recess under the platform
      face(b, 'concrete_exposed', e.ax, e.az, e.bx, e.bz, y - 0.3, y, -nx, -nz, 0);
      const ox = nx * 0.55, oz = nz * 0.55;
      if (nx) b.rectH('concrete_exposed', Math.min(e.ax, e.ax + ox), Math.min(e.az, e.bz), Math.max(e.ax, e.ax + ox), Math.max(e.az, e.bz), y - 0.3, false);
      else b.rectH('concrete_exposed', Math.min(e.ax, e.bx), Math.min(e.az, e.az + oz), Math.max(e.ax, e.bx), Math.max(e.az, e.az + oz), y - 0.3, false);
      face(b, 'wall_dark', e.ax + ox, e.az + oz, e.bx + ox, e.bz + oz, y - 1.15, y - 0.3, -nx, -nz, 0);
    }
  }
}

// ---------------------------------------------------------------------------
function subwayWalls(K, out) {
  for (const t of K.L.tracks) {
    if (t.terminal) continue;
    const plat = K.L.spaces.find(s => s.id === t.platform);
    const y = K.y(t.level), h = plat ? plat.ceil : 4.2;
    const [x0, z0, x1, z1] = t.rect;
    // the outer wall is on the far side from the platform
    let ax, az, bx, bz, nx = 0, nz = 0;
    if (t.axis === 'z') { const xw = t.side === 'w' ? x0 : x1; ax = bx = xw; az = z0; bz = z1; nx = t.side === 'w' ? 1 : -1; }
    else { const zw = t.side === 'n' ? z0 : z1; az = bz = zw; ax = x0; bx = x1; nz = t.side === 'n' ? 1 : -1; }
    const L = Math.hypot(bx - ax, bz - az);
    const band = LINE_BAND[t.line] || 'band_grey';
    for (let s = 0; s < L; s += 12) {
      const s1 = Math.min(L, s + 12);
      const pa = [ax + (bx - ax) * s / L, az + (bz - az) * s / L], pb = [ax + (bx - ax) * s1 / L, az + (bz - az) * s1 / L];
      const b = K.B(t.level, (pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2);
      face(b, 'concrete_exposed', pa[0], pa[1], pb[0], pb[1], y - 1.15, y + 0.4, nx, nz, 0);
      face(b, 'wall_tile_metro', pa[0], pa[1], pb[0], pb[1], y + 0.4, y + h, nx, nz, 0);
      face(b, band, pa[0], pa[1], pb[0], pb[1], y + 3.0, y + 3.18, nx, nz, 0.01);
    }
    // backlit advertising frames (3 m × 1.6 m) every 6 m; env lead may overlay art
    for (let s = 3; s + 3 < L; s += 6) {
      const c = [ax + (bx - ax) * s / L, az + (bz - az) * s / L];
      const d = [(bx - ax) / L, (bz - az) / L];
      const p0 = [c[0] - d[0] * 1.5, c[1] - d[1] * 1.5], p1 = [c[0] + d[0] * 1.5, c[1] + d[1] * 1.5];
      const b = K.B(t.level, c[0], c[1]);
      face(b, 'steel_dark', p0[0] - d[0] * 0.06, p0[1] - d[1] * 0.06, p1[0] + d[0] * 0.06, p1[1] + d[1] * 0.06, y + 0.96, y + 2.64, nx, nz, 0.03);
      face(b, 'arch_adbox', p0[0], p0[1], p1[0], p1[1], y + 1.0, y + 2.6, nx, nz, 0.05);
      out.adFrames.push({ level: t.level, x: c[0] + nx * 0.06, y: y + 1.8, z: c[1] + nz * 0.06, w: 3.0, h: 1.6, nx, nz, track: t.id });
      if (Math.round(s / 6) % 2 === 0) K.light({ level: t.level, x: c[0] + nx * 0.1, y: y + 1.8, z: c[1] + nz * 0.1, color: 0xf4f6ff, intensity: 0.5, range: 6, kind: 'sign', dir: [nx, 0, nz] });
    }
  }
}

// ---------------------------------------------------------------------------
// Midosuji: segmental vault spanning the island platform.
function midosujiVault(K) {
  const sp = K.L.spaces.find(s => s.id === 'm_platform');
  if (!sp) return;
  const lv = sp.level, y = K.y(lv);
  const [x0, z0, x1, z1] = sp.rect;
  const spring = y + sp.ceil, crown = y + 6.55;
  const xc = (x0 + x1) / 2, half = (x1 - x0) / 2, rise = crown - spring;
  const R = (half * half + rise * rise) / (2 * rise), yc = crown - R;
  const vy = (x) => yc + Math.sqrt(Math.max(0, R * R - (x - xc) * (x - xc)));
  const arc = (x) => R * Math.asin((x - xc) / R);
  K.ceilFns[sp.id] = (x) => vy(x);
  const hole = (x, z) => K.isHole(K.above(lv), x, z);
  const NX = (x1 - x0) * 2; // 0.5 m panels across
  for (let z = z0; z < z1; z++) {
    for (let i = 0; i < NX; i++) {
      const xa = x0 + i * 0.5, xb = xa + 0.5;
      if (hole((xa + xb) / 2, z + 0.5)) continue;
      const b = K.B(lv, xa, z);
      Q(b, 'arch_vault', [xa, vy(xa), z], [xb, vy(xb), z], [xb, vy(xb), z + 1], [xa, vy(xa), z + 1], DOWN, [[z, arc(xa)], [z, arc(xb)], [z + 1, arc(xb)], [z + 1, arc(xa)]]);
    }
  }
  // lunettes at the platform ends
  for (const [zz, nz] of [[z0, 1], [z1, -1]]) {
    for (let i = 0; i < NX; i++) {
      const xa = x0 + i * 0.5, xb = xa + 0.5;
      Q(K.B(lv, xa, zz), 'wall_tile_metro', [xa, spring, zz], [xb, spring, zz], [xb, vy(xb), zz], [xa, vy(xa), zz], [0, 0, nz]);
    }
  }
  // spring-line cornice (stainless) along both edges
  for (const xe of [x0, x1]) for (let z = z0; z < z1; z += 12) {
    const zz = Math.min(z1, z + 12);
    K.B(lv, xe, z).box('stainless', xe + (xe === x0 ? 0.08 : -0.08), spring - 0.06, (z + zz) / 2, 0.16, 0.12, zz - z);
  }
  // linear lights following the vault: crown and two flanks
  for (const xl of [xc, xc - 3.6, xc + 3.6]) {
    let run = null;
    const flush = (ze) => {
      if (!run) return;
      const b = K.B(lv, xl, (run + ze) / 2);
      const w = 0.09;
      Q(b, 'light_line_cool', [xl - w, vy(xl - w) - 0.02, run + 0.3], [xl + w, vy(xl + w) - 0.02, run + 0.3], [xl + w, vy(xl + w) - 0.02, ze - 0.3], [xl - w, vy(xl - w) - 0.02, ze - 0.3], DOWN);
      for (let s = run; s < ze; s += 10) K.light({ level: lv, x: xl, y: vy(xl) - 0.05, z: Math.min(ze, s + 5), color: KELVIN.metro, intensity: 1.0, range: 9, kind: 'strip', len: Math.min(10, ze - s), axis: 'z' });
      run = null;
    };
    for (let z = z0; z <= z1; z++) {
      const ok = z < z1 && !hole(xl - 0.6, z + 0.5) && !hole(xl + 0.6, z + 0.5);
      if (ok && run === null) run = z;
      if (!ok) flush(z);
    }
  }
  // ring chandeliers along the centreline
  for (let z = z0 + 8; z < z1 - 4; z += 14) {
    if (hole(xc, z) || hole(xc, z - 3) || hole(xc, z + 3)) continue;
    const b = K.B(lv, xc, z);
    const yr = crown - 1.6, Rr = 1.1;
    const pathR = [];
    for (let k = 0; k <= 32; k++) { const a = k / 32 * Math.PI * 2; pathR.push([xc + Math.cos(a) * Rr, yr, z + Math.sin(a) * Rr]); }
    b.sweep('light_pendant', pathR, ring(0.055, 8));
    const pathO = pathR.map(p => [xc + (p[0] - xc) * 1.08, yr + 0.09, z + (p[2] - z) * 1.08]);
    b.sweep('stainless', pathO, ring(0.025, 6));
    for (let k = 0; k < 3; k++) {
      const a = k / 3 * Math.PI * 2;
      bar(b, 'stainless', [xc + Math.cos(a) * Rr, yr, z + Math.sin(a) * Rr], [xc, crown - 0.02, z], 0.015, 0.015);
    }
    b.cylinder('stainless', xc, z, 0.18, crown - 0.12, crown, 10, { caps: 2 });
    K.light({ level: lv, x: xc, y: yr, z, color: 0xfff0dc, intensity: 1.4, range: 10, kind: 'lamp' });
  }
}

// ---------------------------------------------------------------------------
function sennichimaeCeiling(K) {
  const sp = K.L.spaces.find(s => s.id === 's_platform');
  if (!sp) return;
  const lv = sp.level, y = K.y(lv), H = y + sp.ceil;
  const [x0, z0, x1, z1] = sp.rect;
  const hole = (x, z) => K.isHole(K.above(lv), x, z);
  for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
    if (hole(x + 0.5, z + 0.5)) continue;
    K.B(lv, x, z).rectH('ceiling_metal', x, z, x + 1, z + 1, H, false);
  }
  K.ceilFns[sp.id] = () => H;
  const zc = (z0 + z1) / 2;
  for (const zl of [zc - 3, zc + 3]) {
    let run = null;
    for (let x = x0; x <= x1; x++) {
      const ok = x < x1 && !hole(x + 0.5, zl - 0.5) && !hole(x + 0.5, zl + 0.5);
      if (ok && run === null) run = x;
      if (!ok && run !== null) {
        const b = K.B(lv, (run + x) / 2, zl);
        b.rectH('light_line_cool', run + 0.3, zl - 0.1, x - 0.3, zl + 0.1, H - 0.01, false);
        b.box('aluminium', (run + x) / 2, H - 0.03, zl - 0.14, x - run - 0.6, 0.06, 0.04);
        b.box('aluminium', (run + x) / 2, H - 0.03, zl + 0.14, x - run - 0.6, 0.06, 0.04);
        for (let s = run; s < x; s += 10) K.light({ level: lv, x: Math.min(x, s + 5), y: H - 0.05, z: zl, color: KELVIN.metro, intensity: 1.0, range: 9, kind: 'strip', len: Math.min(10, x - s), axis: 'x' });
        run = null;
      }
    }
  }
  // pink accent soffit band along the platform edges
  for (const ze of [z0, z1]) K.B(lv, (x0 + x1) / 2, ze).box('band_sennichimae', (x0 + x1) / 2, H - 0.15, ze + (ze === z0 ? 0.1 : -0.1), x1 - x0, 0.3, 0.2, 0, { faces: 'nsb' });
}

// ---------------------------------------------------------------------------
function nankaiShed(K, out) {
  const plats = K.L.spaces.filter(s => s.style === 'terminal_platform');
  if (!plats.length) return;
  const lv = plats[0].level, y = K.y(lv);
  const roofY = y + plats[0].ceil;
  let xlo = Infinity, xhi = -Infinity, zlo = Infinity, zhi = -Infinity;
  for (const t of K.L.tracks.filter(t => t.terminal)) { xlo = Math.min(xlo, t.rect[0]); xhi = Math.max(xhi, t.rect[2]); }
  for (const p of plats) { zlo = Math.min(zlo, p.rect[1]); zhi = Math.max(zhi, p.rect[3]); }
  for (const p of plats) {
    const [x0, z0, x1, z1] = p.rect;
    const xc = (x0 + x1) / 2;
    // roof underside over the platform (matches transit's pit roof)
    for (let z = z0; z < z1; z += 6) {
      const zz = Math.min(z1, z + 6);
      const b = K.B(lv, xc, z);
      b.rectH('ceiling_metal', x0, z, x1, zz, roofY, false);
      b.rectH('roof_deck', x0, z, x1, zz, roofY + 0.01, true);
    }
    K.ceilFns[p.id] = () => roofY;
    // centreline columns under the roof trusses (transit: trusses at z = -58 + 12k)
    for (let z = -46; z < z1 - 6; z += 12) {
      if (z < z0 + 6) continue;
      const cz = z;
      if (!K.clear(lv, xc, cz, 0.6)) continue;
      const b = K.B(lv, xc, cz);
      b.cylinder('steel_painted_white', xc, cz, 0.22, y, roofY - 0.6, 14);
      b.cylinder('stainless', xc, cz, 0.27, y, y + 0.9, 14, { caps: 1 });
      b.cylinder('steel_painted_white', xc, cz, 0.3, roofY - 0.9, roofY - 0.6, 14, { caps: 2 });
      // column number plate zone (wayfinding): band at 2.0–2.3 m
      b.cylinder('band_nankai', xc, cz, 0.225, y + 2.6, y + 2.7, 14);
      K.world.addBox(lv, xc, cz, 0.27, 0.27, 0);
      K.reserve(lv, xc, cz, 0.6);
      out.platformColumns.push({ level: lv, x: xc, z: cz, r: 0.27, platform: p.id });
    }
    // service beam with light lines, hung from the roof every 6 m
    const yb = y + 4.6;
    const b0 = (z, zz) => K.B(lv, xc, (z + zz) / 2);
    for (let z = z0 + 1; z < z1 - 1; z += 12) {
      const zz = Math.min(z1 - 1, z + 12);
      const b = b0(z, zz);
      b.box('steel_painted_grey', xc, yb + 0.15, (z + zz) / 2, 0.36, 0.3, zz - z);
      for (const sd of [-1, 1]) b.rectH('light_line_neutral', xc + sd * 0.12 - 0.05, z + 0.2, xc + sd * 0.12 + 0.05, zz - 0.2, yb - 0.005, false);
      for (let q = z + 3; q < zz; q += 6) for (const sd of [-1, 1]) b.box('steel_painted_grey', xc + sd * 0.12, (yb + 0.3 + roofY) / 2, q, 0.03, roofY - yb - 0.3, 0.03);
      K.light({ level: lv, x: xc, y: yb - 0.05, z: (z + zz) / 2, color: KELVIN.terminal, intensity: 1.4, range: 10, kind: 'strip', len: zz - z, axis: 'z' });
    }
    out.serviceBeams.push({ level: lv, x: xc, z0: z0 + 1, z1: z1 - 1, yBottom: yb, yTop: yb + 0.3, platform: p.id });
  }
  // glazed side walls of the shed (outside the outer tracks)
  for (const [xw, nx] of [[xlo - 0.6, 1], [xhi + 0.6, -1]]) {
    for (let z = zlo; z < zhi - 12; z += 3) {
      const zz = z + 3;
      const b = K.B(lv, xw, z);
      face(b, 'concrete_exposed', xw, z, xw, zz, y - 1.2, y + 1.6, nx, 0, 0);
      face(b, 'arch_daylight', xw, z, xw, zz, y + 1.6, roofY - 0.8, nx, 0, -0.05);
      face(b, 'glass_rail', xw, z, xw, zz, y + 1.6, roofY - 0.8, nx, 0, 0.02);
      face(b, 'steel_painted_white', xw, z, xw, zz, roofY - 0.8, roofY, nx, 0, 0);
      b.box('steel_painted_white', xw + nx * 0.08, (y + 1.6 + roofY - 0.8) / 2, z, 0.16, roofY - 2.4 - y, 0.12);
      b.box('steel_painted_white', xw + nx * 0.08, y + 1.6, (z + zz) / 2, 0.18, 0.12, 3);
    }
  }
  // roof fascia at the open south end
  K.B(lv, (xlo + xhi) / 2, zhi).box('steel_painted_white', (xlo + xhi) / 2, roofY + 0.2, zhi + 0.2, xhi - xlo + 1.2, 0.8, 0.4);
}

// ---------------------------------------------------------------------------
// Nankai 3F concourse: long-span Warren trusses with a clerestory monitor.
function nankaiConcourseRoof(K) {
  const sp = K.L.spaces.find(s => s.id === 'nankai_3f_concourse');
  if (!sp) return;
  const lv = sp.level, y = K.y(lv), H = y + sp.ceil;
  const [x0, z0, x1, z1] = sp.rect;
  const mz0 = z0 + 9, mz1 = z0 + 17; // clerestory monitor band
  const mH = H + 2.6;
  K.ceilFns[sp.id] = (x, z) => (z > mz0 && z < mz1 ? mH : H);
  // roof deck
  for (let z = z0; z < z1; z += 2) {
    const zz = Math.min(z1, z + 2);
    for (let x = x0; x < x1; x += 8) {
      const xx = Math.min(x1, x + 8);
      const b = K.B(lv, x, z);
      if (z >= mz0 && zz <= mz1) b.rectH('ceiling_perforated', x, z, xx, zz, mH, false);
      else b.rectH('ceiling_perforated', x, z, xx, zz, H, false);
    }
  }
  // clerestory glazing (daylight) + mullions
  for (const [zz, nz] of [[mz0, 1], [mz1, -1]]) {
    for (let x = x0; x < x1; x += 1.5) {
      const xx = Math.min(x1, x + 1.5);
      const b = K.B(lv, x, zz);
      face(b, 'arch_daylight', x, zz, xx, zz, H, mH, 0, nz, 0);
      b.box('steel_painted_white', x, (H + mH) / 2, zz + nz * 0.05, 0.08, mH - H, 0.1);
    }
  }
  // Warren trusses spanning N–S every 8 m
  const tb = H - 1.8;
  for (let x = x0 + 4; x < x1; x += 8) {
    const b = K.B(lv, x, (z0 + z1) / 2);
    bar(b, 'steel_painted_white', [x, H - 0.15, z0], [x, H - 0.15, z1], 0.28, 0.3);
    bar(b, 'steel_painted_white', [x, tb, z0 + 0.5], [x, tb, z1 - 0.5], 0.22, 0.24);
    const P = 3;
    for (let z = z0 + 0.5; z < z1 - 0.5 - 1e-6; z += P) {
      const zz = Math.min(z1 - 0.5, z + P);
      bar(b, 'steel_painted_white', [x, tb, z], [x, H - 0.3, (z + zz) / 2], 0.12, 0.12);
      bar(b, 'steel_painted_white', [x, H - 0.3, (z + zz) / 2], [x, tb, zz], 0.12, 0.12);
    }
    // pendant spots on the bottom chord
    for (const z of [z0 + 4, (z0 + z1) / 2 + 4, z1 - 4]) {
      b.cylinder('steel_painted_dark', x, z, 0.2, tb - 0.45, tb - 0.12, 12, { caps: 1 });
      b.rectH('light_down_neutral', x - 0.17, z - 0.17, x + 0.17, z + 0.17, tb - 0.455, false, { uv: [[0, 0], [1, 0], [1, 1], [0, 1]] });
      bar(b, 'steel_painted_dark', [x, tb - 0.12, z], [x, tb, z], 0.03, 0.03);
      K.light({ level: lv, x, y: tb - 0.5, z, color: KELVIN.terminal, intensity: 2.2, range: 14, kind: 'down' });
    }
  }
  // continuous LED slots in the perforated vault between the trusses (a lit, light-grey ceiling,
  // not a black void), each with a trim and its light declaration
  for (const [za, zb] of [[z0 + 1, mz0 - 0.4], [mz1 + 0.4, z1 - 1]]) {
    for (let x = x0 + 8; x < x1 - 2; x += 8) {
      const xs = x + 4 - 4;           // truss lines are at x0 + 4 + 8k: slots sit midway between them
      const b = K.B(lv, xs, (za + zb) / 2);
      b.rectH('light_line_neutral', xs - 0.3, za, xs + 0.3, zb, H - 0.01, false);
      b.box('aluminium', xs - 0.34, H - 0.03, (za + zb) / 2, 0.04, 0.05, zb - za);
      b.box('aluminium', xs + 0.34, H - 0.03, (za + zb) / 2, 0.04, 0.05, zb - za);
      for (let z = za; z < zb; z += 8) K.light({ level: lv, x: xs, y: H - 0.1, z: Math.min(zb, z + 4), color: KELVIN.terminal, intensity: 1.3, range: 12, kind: 'strip', len: Math.min(8, zb - z), axis: 'z' });
    }
  }
  // transfer beam + fascia where the concourse roof meets the lower shed roof
  const plat = K.L.spaces.find(s => s.style === 'terminal_platform');
  if (plat) {
    const shedY = K.y(plat.level) + plat.ceil;
    for (let x = x0; x < x1; x += 12) {
      const xx = Math.min(x1, x + 12);
      const b = K.B(lv, x, z1);
      face(b, 'steel_painted_white', x, z1, xx, z1, shedY - 0.9, H, 0, 1, 0);
      b.box('steel_painted_white', (x + xx) / 2, shedY - 0.45, z1, xx - x, 0.9, 0.6, 0, { faces: 'bns' });
    }
  }
  // hanging point for the big departure board (transit): above the gate line
  K.hangPoints = K.hangPoints || [];
  K.hangPoints.push({ level: lv, x: (x0 + x1) / 2, z: z1 - 6, y: tb, note: 'Nankai 3F concourse truss bottom chord' });
}

function ring(r, n) { const out = []; for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; out.push([Math.cos(a) * r, Math.sin(a) * r]); } return out; }
