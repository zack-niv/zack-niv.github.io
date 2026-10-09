// =============================================================================
// Texture library: one generator per surface family. Each entry:
//   size  [u, v] metres covered by one texture tile (world-planar UVs are in m)
//   res   'hi' | 'mid' | 'lo'  (resolved to pixels by quality)
//   make(N) -> { albedo, normal, orm } canvases (see procedural.js)
// Real-world references noted per entry. Texel density ≈ 200–430 px/m at high.
// =============================================================================
import { build, fbm, at, tileAt, hash3, scatterChips, clamp, mix, smooth, rgb } from './procedural.js?v=c81de75';

const TAU = Math.PI * 2;

// anisotropic value noise (Px cells across x, Py cells across y), tileable
const _aniso = new Map();
function aniso(N, Px, Py, seed) {
  const key = `${N}|${Px}|${Py}|${seed}`;
  let out = _aniso.get(key); if (out) return out;
  const lat = new Float32Array(Px * Py);
  for (let i = 0; i < lat.length; i++) lat[i] = hash3(i % Px, (i / Px) | 0, seed);
  out = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    const fy = y * Py / N, iy = Math.floor(fy), ty0 = fy - iy, ty = ty0 * ty0 * (3 - 2 * ty0);
    const r0 = (iy % Py) * Px, r1 = ((iy + 1) % Py) * Px;
    for (let x = 0; x < N; x++) {
      const fx = x * Px / N, ix = Math.floor(fx), tx0 = fx - ix, tx = tx0 * tx0 * (3 - 2 * tx0);
      const a = lat[r0 + ix % Px], b = lat[r0 + (ix + 1) % Px], c = lat[r1 + ix % Px], d = lat[r1 + (ix + 1) % Px];
      const top = a + (b - a) * tx, bot = c + (d - c) * tx;
      out[y * N + x] = top + (bot - top) * ty;
    }
  }
  _aniso.set(key, out);
  return out;
}

// generic glazed/porcelain tile field
function tiles(N, { cols, rows = cols, stagger = 0, base, grout, groutW = 1.0, tone = 0.04, mottle = 0.04, speckle = 0, speckDark = 0.3,
  rough = 0.3, roughVar = 0.08, groutRough = 0.75, bevel = 2.5, pillow = 0.15, seed = 1, veins = 0, tint = null }) {
  const tw = N / cols, th = N / rows;
  const F = fbm(N, 4, 6, seed), G = fbm(N, 32, 3, seed + 1), V = veins ? fbm(N, 2, 5, seed + 2) : null;
  const [br, bg, bb] = base, [gr, gg, gb] = grout;
  return build(N, (x, y, o) => {
    const t = tileAt(x, y, tw, th, stagger, N, N);
    const tx = t.tx, ty = t.ty, d = t.d;
    const h0 = hash3(tx, ty, seed * 3 + 7);
    const f = at(F, N, x, y), g = at(G, N, x, y);
    if (d < groutW) {
      const n = 0.92 + 0.16 * g;
      o.r = gr * n; o.g = gg * n; o.b = gb * n; o.h = 0; o.rough = groutRough;
      return;
    }
    let c = 1 + (h0 - 0.5) * 2 * tone + (f - 0.5) * 2 * mottle + (g - 0.5) * mottle * 0.6;
    if (veins) {
      const w = at(V, N, x + Math.floor(h0 * N), y);
      const s = Math.abs(Math.sin(TAU * (x / N * 2 + y / N) + w * 7 + h0 * 6));
      c -= Math.pow(1 - s, 26) * veins + Math.pow(1 - s, 6) * veins * 0.25;
    }
    let r = br * c, gg2 = bg * c, b = bb * c;
    if (tint && h0 > 0.72) { r = mix(r, tint[0], 0.35); gg2 = mix(gg2, tint[1], 0.35); b = mix(b, tint[2], 0.35); }
    if (speckle) {
      const s = hash3(x, y, seed + 99);
      if (s < speckle) { const k = s < speckle * speckDark ? 0.45 : 1.25; r *= k; gg2 *= k; b *= k; }
    }
    o.r = clamp(r); o.g = clamp(gg2); o.b = clamp(b);
    // bevelled edge + slight pillow (glaze) inside the tile
    const e = Math.min(1, (d - groutW) / bevel);
    const lx = t.lx / tw - 0.5, ly = t.ly / th - 0.5;
    o.h = 0.35 + 0.45 * Math.sqrt(e) + pillow * (0.25 - (lx * lx + ly * ly)) + (g - 0.5) * 0.02;
    o.rough = clamp(rough + (f - 0.5) * roughVar * 2 + (g - 0.5) * roughVar);
  });
}

export const TEX = {
  // --- floors --------------------------------------------------------------
  // Namba CITY / NAMBAWALK: large-format polished porcelain, cream with faint veining
  porcelain: { size: [3.2, 3.2], res: 'hi', make: N => tiles(N, { cols: 4, base: [0.9, 0.885, 0.85], grout: [0.63, 0.6, 0.56], groutW: 1.1, tone: 0.035, mottle: 0.03, rough: 0.11, roughVar: 0.05, bevel: 2, pillow: 0.04, seed: 11, veins: 0.07 }) },
  // grey ceramic 300 mm (Osaka Metro concourse) with granite speckle
  tile_grey: { size: [1.2, 1.2], res: 'mid', make: N => tiles(N, { cols: 4, base: [0.66, 0.665, 0.67], grout: [0.42, 0.42, 0.42], groutW: 1.0, tone: 0.06, mottle: 0.05, speckle: 0.12, speckDark: 0.6, rough: 0.42, roughVar: 0.08, seed: 21 }) },
  // warm beige 450 mm porcelain (depachika, shops)
  tile_warm: { size: [1.8, 1.8], res: 'mid', make: N => tiles(N, { cols: 4, base: [0.83, 0.77, 0.67], grout: [0.6, 0.55, 0.48], groutW: 1.0, tone: 0.045, mottle: 0.04, speckle: 0.05, speckDark: 0.5, rough: 0.22, roughVar: 0.06, seed: 31 }) },
  // grey non-slip platform tiles with a dimple texture
  platform: { size: [1.2, 1.2], res: 'mid', make: N => {
    const F = fbm(N, 8, 5, 41);
    return build(N, (x, y, o) => {
      const t = tileAt(x, y, N / 4, N / 4, 0, N, N);
      const h0 = hash3(t.tx, t.ty, 41);
      if (t.d < 1.2) { o.r = o.g = o.b = 0.32; o.h = 0; o.rough = 0.9; return; }
      const p = N / 32, dx = (x % p) - p / 2 + 0.5, dy = (y % p) - p / 2 + 0.5;
      const dim = Math.max(0, 1 - Math.hypot(dx, dy) / (p * 0.28));
      const c = 0.6 + (h0 - 0.5) * 0.05 + (at(F, N, x, y) - 0.5) * 0.07 - dim * 0.04;
      o.r = c; o.g = c * 1.0; o.b = c * 0.985;
      o.h = 0.6 + dim * 0.25 + Math.min(1, t.d / 3) * 0.15; o.rough = 0.62 + dim * 0.1;
    }, { normal: 3 });
  } },
  // terrazzo with marble/granite aggregate and zinc divider strips (Nankai halls, courts)
  terrazzo: { size: [2.4, 2.4], res: 'hi', make: N => {
    // Real terrazzo floor: fine 2-8 mm chips (sparser 8-12 mm second layer), mostly off-white /
    // light grey / warm beige, ~5 % charcoal, <2 % muted red. Base ~0.82, soft reflections.
    const chip = new Int16Array(N * N).fill(-1), edge = new Float32Array(N * N);
    const k = N / 1024;
    const pal = [
      [0.93, 0.92, 0.89], [0.90, 0.89, 0.86], [0.78, 0.78, 0.77], [0.68, 0.68, 0.68], [0.86, 0.80, 0.70], [0.80, 0.73, 0.62], // light bulk
      [0.30, 0.30, 0.31],                                                                                                       // charcoal
      [0.60, 0.40, 0.34],                                                                                                       // muted red
    ];
    // weighted pick: indices 0-5 ~ 91 %, charcoal 7 %, red 2 %
    const pick = (c) => { const u = hash3(c, 9, 77); return u < 0.91 ? ((u / 0.91 * 6) | 0) : u < 0.98 ? 6 : 7; };
    scatterChips(N, Math.round(26000 * k * k), 0.9 * k, 2.6 * k, 51, (i, c, d) => { chip[i] = pick(c); edge[i] = d; });
    scatterChips(N, Math.round(1500 * k * k), 3 * k, 5 * k, 52, (i, c, d) => { chip[i] = pick(c + 5000); edge[i] = d; });
    const F = fbm(N, 6, 5, 53);
    const strip = N / 2;
    return build(N, (x, y, o) => {
      const sx = x % strip, sy = y % strip;
      if (sx < 1.5 * k + 0.5 || sy < 1.5 * k + 0.5) { o.r = 0.62; o.g = 0.6; o.b = 0.55; o.metal = 0.8; o.rough = 0.3; o.h = 0.55; return; }
      const i = y * N + x, c = chip[i];
      const f = at(F, N, x, y);
      if (c >= 0) {
        const p = pal[c], s = 1 - edge[i] * 0.06;
        o.r = p[0] * s; o.g = p[1] * s; o.b = p[2] * s; o.rough = 0.26; o.h = 0.52;
      } else {
        const m = 0.82 + (f - 0.5) * 0.06;
        o.r = m; o.g = m * 0.985; o.b = m * 0.95; o.rough = 0.3 + f * 0.05; o.h = 0.5;
      }
    }, { normal: 0.6 });
  } },
  // polished white marble slabs 1.2x0.6 m, staggered, soft wide low-contrast veining
  marble: { size: [2.4, 2.4], res: 'hi', make: N => {
    const W = fbm(N, 3, 6, 61), G = fbm(N, 24, 3, 62), V = fbm(N, 5, 4, 63);
    const tw = N / 2, th = N / 4;
    return build(N, (x, y, o) => {
      const t = tileAt(x, y, tw, th, 0.5, N, N);
      const h0 = hash3(t.tx, t.ty, 61), h1 = hash3(t.tx, t.ty, 62);
      if (t.d < 0.9) { o.r = 0.7; o.g = 0.69; o.b = 0.67; o.h = 0; o.rough = 0.5; return; }
      const ox = Math.floor(h1 * N), oy = Math.floor(h0 * N);
      const w = at(W, N, x + ox, y + oy), w2 = at(V, N, x + oy, y + ox);
      const a = h0 > 0.5 ? 1 : -1;
      // vein field: sinuous bands warped by two noise fields (direction field), wide + soft
      const s = Math.abs(Math.sin(TAU * (x / N * 1 + a * y / N * 1.5) + w * 14 + w2 * 6 + h0 * 20));
      const v = Math.pow(1 - s, 9) * 0.09 + Math.pow(1 - s, 3) * 0.025;
      const cloud = (w - 0.5) * 0.07 + (w2 - 0.5) * 0.04 + (at(G, N, x, y) - 0.5) * 0.015;
      const c = 0.9 + cloud + (h1 - 0.5) * 0.06;
      o.r = clamp(c - v * 0.9); o.g = clamp(c * 0.99 - v * 0.9); o.b = clamp(c * 0.965 - v * 0.8);
      o.h = 0.5 + Math.min(1, t.d / 2) * 0.4; o.rough = 0.1 + v * 0.3 + at(G, N, x, y) * 0.04;
    }, { normal: 0.8 });
  } },
  // dark polished granite (borders, bands, dining street)
  granite_dark: { size: [1.2, 1.2], res: 'mid', make: N => tiles(N, { cols: 2, base: [0.22, 0.22, 0.235], grout: [0.12, 0.12, 0.12], groutW: 0.9, tone: 0.05, mottle: 0.12, speckle: 0.22, speckDark: 0.35, rough: 0.12, roughVar: 0.04, seed: 71 }) },
  // timber floor planks (restaurants, Parks dining)
  wood: { size: [1.6, 1.6], res: 'mid', make: N => {
    const W = fbm(N, 4, 5, 81), G = aniso(N, 8, 128, 82);
    const pw = N / 16;
    return build(N, (x, y, o) => {
      const row = Math.floor(y / pw);
      const off = Math.floor(hash3(row, 0, 81) * N);
      const xx = (x + off) % N;
      const seg = xx < N / 2 ? 0 : 1;
      const id = hash3(row, seg, 83);
      const ly = y - row * pw, lx = xx % (N / 2);
      const d = Math.min(ly + 0.5, pw - ly - 0.5, lx + 0.5, N / 2 - lx - 0.5);
      if (d < 0.8) { o.r = 0.18; o.g = 0.12; o.b = 0.08; o.h = 0; o.rough = 0.8; return; }
      const w = at(W, N, x, y);
      const grain = 0.5 + 0.5 * Math.sin(TAU * (y / N * 64 + w * 3 + id * 5));
      const fine = at(G, N, x, y);
      const c = 0.82 + (id - 0.5) * 0.22 - grain * 0.1 - fine * 0.08;
      o.r = 0.62 * c; o.g = 0.43 * c; o.b = 0.27 * c;
      o.h = 0.6 + Math.min(1, d / 2) * 0.3 - grain * 0.04; o.rough = 0.42 + grain * 0.1;
    }, { normal: 1.5 });
  } },
  // weathered outdoor decking boards with gaps (Parks gardens, bridges)
  deck: { size: [2.24, 2.24], res: 'mid', make: N => {
    const W = fbm(N, 4, 5, 91), G = aniso(N, 6, 160, 92);
    const pw = N / 16;
    return build(N, (x, y, o) => {
      const row = Math.floor(y / pw), ly = y - row * pw;
      const off = Math.floor(hash3(row, 0, 91) * N), xx = (x + off) % N;
      const id = hash3(row, xx < N * 0.6 ? 0 : 1, 93);
      const lx = xx < N * 0.6 ? xx : xx - N * 0.6, L = xx < N * 0.6 ? N * 0.6 : N * 0.4;
      const d = Math.min(ly + 0.5, pw - ly - 0.5);
      if (d < pw * 0.1 || lx < 0.8 || L - lx < 0.8) { o.r = 0.07; o.g = 0.06; o.b = 0.05; o.h = 0; o.rough = 0.9; return; }
      const w = at(W, N, x, y), fine = at(G, N, x, y);
      const grain = 0.5 + 0.5 * Math.sin(TAU * (y / N * 40 + w * 2.5 + id * 3));
      const c = 0.85 + (id - 0.5) * 0.25 - grain * 0.08 - fine * 0.12;
      o.r = 0.56 * c; o.g = 0.43 * c; o.b = 0.32 * c;
      o.h = 0.5 + Math.min(1, d / 3) * 0.4 - fine * 0.08; o.rough = 0.72 + fine * 0.15;
    }, { normal: 2 });
  } },
  // flamed granite pavers 300×600 running bond (outdoor plazas, canyon floor)
  paving: { size: [2.4, 2.4], res: 'mid', make: N => {
    const F = fbm(N, 8, 5, 101);
    return build(N, (x, y, o) => {
      const t = tileAt(x, y, N / 4, N / 8, 0.5, N, N);
      const h0 = hash3(t.tx, t.ty, 101), h1 = hash3(t.tx, t.ty, 102);
      if (t.d < 1.3) { o.r = 0.25; o.g = 0.24; o.b = 0.22; o.h = 0; o.rough = 0.95; return; }
      const s = hash3(x, y, 103);
      let c = 0.56 + (h0 - 0.5) * 0.12 + (at(F, N, x, y) - 0.5) * 0.08;
      if (s < 0.1) c *= 0.6; else if (s > 0.94) c *= 1.25;
      const warm = h1 > 0.7 ? 0.04 : 0;
      o.r = clamp(c + warm); o.g = clamp(c * 0.985 + warm * 0.5); o.b = clamp(c * 0.95);
      o.h = 0.55 + Math.min(1, t.d / 3) * 0.3 + (h0 - 0.5) * 0.05 + (s - 0.5) * 0.06; o.rough = 0.82 + s * 0.12;
    }, { normal: 2.5 });
  } },
  // JIS tactile blocks (300 mm): v runs along the walking direction
  tactile_line: { size: [0.3, 0.3], res: 'lo', make: N => build(N, (x, y, o) => {
    const u = (x + 0.5) / N, v = (y + 0.5) / N;
    const bar = [0.125, 0.375, 0.625, 0.875].reduce((m, c) => Math.min(m, Math.abs(u - c)), 1);
    const along = Math.abs(v - 0.5);
    const e = Math.min(1, Math.min(u, 1 - u, v, 1 - v) * 60);
    const inBar = smooth(0.05, 0.035, bar) * smooth(0.47, 0.44, along);
    const n = hash3(x, y, 5) * 0.04;
    o.r = 0.96 - n; o.g = 0.76 - n; o.b = 0.06; o.h = 0.3 + inBar * 0.6 * e; o.rough = 0.55 - inBar * 0.1;
    if (e < 0.4) { o.r *= 0.6; o.g *= 0.6; o.b *= 0.6; }
  }, { normal: 6 }) },
  tactile_dot: { size: [0.3, 0.3], res: 'lo', make: N => build(N, (x, y, o) => {
    const u = (x + 0.5) / N, v = (y + 0.5) / N;
    const du = (u * 5) % 1 - 0.5, dv = (v * 5) % 1 - 0.5;
    const r = Math.hypot(du, dv);
    const e = Math.min(1, Math.min(u, 1 - u, v, 1 - v) * 60);
    const dome = smooth(0.24, 0.12, r);
    const n = hash3(x, y, 6) * 0.04;
    o.r = 0.96 - n; o.g = 0.76 - n; o.b = 0.06; o.h = 0.3 + dome * 0.6 * e; o.rough = 0.55 - dome * 0.1;
    if (e < 0.4) { o.r *= 0.6; o.g *= 0.6; o.b *= 0.6; }
  }, { normal: 6 }) },

  // --- walls ---------------------------------------------------------------
  // Osaka Metro glazed cream tiles, 80 mm
  metro_tile: { size: [1.28, 1.28], res: 'mid', make: N => tiles(N, { cols: 16, base: [0.93, 0.91, 0.84], grout: [0.72, 0.71, 0.68], groutW: 0.9, tone: 0.03, mottle: 0.015, rough: 0.12, roughVar: 0.05, groutRough: 0.7, bevel: 2, pillow: 0.35, seed: 111 }) },
  // white glazed 200×100 brick-bond tiles (passages)
  white_tile: { size: [1.6, 1.6], res: 'mid', make: N => tiles(N, { cols: 8, rows: 16, stagger: 0.5, base: [0.95, 0.95, 0.94], grout: [0.74, 0.74, 0.73], groutW: 0.9, tone: 0.02, mottle: 0.012, rough: 0.1, roughVar: 0.04, groutRough: 0.7, bevel: 2, pillow: 0.3, seed: 121 }) },
  // enamelled / composite wall panels 1.2 × 1.0 m with dark reveals
  panel_white: { size: [2.4, 2.0], res: 'mid', make: N => {
    const F = fbm(N, 16, 4, 131), G = fbm(N, 64, 2, 132);
    return build(N, (x, y, o) => {
      const t = tileAt(x, y, N / 2, N / 2, 0, N, N);
      if (t.d < 1.6) { o.r = 0.2; o.g = 0.2; o.b = 0.21; o.h = 0; o.rough = 0.6; return; }
      const h0 = hash3(t.tx, t.ty, 133);
      const c = 0.92 + (h0 - 0.5) * 0.015 + (at(F, N, x, y) - 0.5) * 0.012;
      o.r = c; o.g = c; o.b = c * 0.985;
      o.h = 0.5 + Math.min(1, t.d / 2.5) * 0.4 + at(G, N, x, y) * 0.015; o.rough = 0.32 + at(F, N, x, y) * 0.08;
    }, { normal: 2 });
  } },
  // honed beige limestone, 1.2 × 0.5 m staggered courses
  stone_warm: { size: [2.4, 2.0], res: 'mid', make: N => {
    const F = fbm(N, 6, 6, 141), G = fbm(N, 48, 3, 142);
    return build(N, (x, y, o) => {
      const t = tileAt(x, y, N / 2, N / 4, 0.5, N, N);
      if (t.d < 1.1) { o.r = 0.55; o.g = 0.5; o.b = 0.43; o.h = 0; o.rough = 0.8; return; }
      const h0 = hash3(t.tx, t.ty, 143);
      const f = at(F, N, x + Math.floor(h0 * 300), y), g = at(G, N, x, y);
      const s = hash3(x, y, 144);
      let c = 0.86 + (h0 - 0.5) * 0.07 + (f - 0.5) * 0.1 + (g - 0.5) * 0.03;
      if (s < 0.015) c *= 0.82;
      o.r = clamp(0.86 * c); o.g = clamp(0.78 * c); o.b = clamp(0.66 * c);
      o.h = 0.5 + Math.min(1, t.d / 2) * 0.4 + (g - 0.5) * 0.04; o.rough = 0.38 + g * 0.12;
    }, { normal: 2 });
  } },
  // exposed fair-faced concrete, 1.8 × 1.0 m formwork with tie holes
  concrete: { size: [3.6, 2.0], res: 'mid', make: N => {
    const F = fbm(N, 6, 6, 151), G = fbm(N, 64, 3, 152);
    const pw = N / 2, ph = N / 2;
    return build(N, (x, y, o) => {
      const t = tileAt(x, y, pw, ph, 0, N, N);
      const h0 = hash3(t.tx, t.ty, 153);
      const f = at(F, N, x, y), g = at(G, N, x, y);
      let c = 0.64 + (h0 - 0.5) * 0.05 + (f - 0.5) * 0.12 + (g - 0.5) * 0.04;
      let h = 0.5 + (f - 0.5) * 0.04 + (g - 0.5) * 0.05;
      if (t.d < 0.8) { c *= 0.8; h -= 0.15; }
      // tie holes
      const hx = (t.lx / pw) * 3 % 1 - 0.5, hy = (t.ly / ph) * 2 % 1 - 0.5;
      const r = Math.hypot(hx * pw / 3, hy * ph / 2);
      if (r < N * 0.007) { c *= 0.55; h -= 0.3; } else if (r < N * 0.011) { c *= 0.92; h -= 0.05; }
      if (hash3(x, y, 154) < 0.012) { c *= 0.7; h -= 0.1; } // pores
      o.r = clamp(c * 0.98); o.g = clamp(c * 0.975); o.b = clamp(c * 0.96); o.h = h; o.rough = 0.78 + g * 0.12;
    }, { normal: 2.5 });
  } },
  // Namba Parks strata: layered, undulating horizontal bands, sandstone canyon
  strata: { size: [6, 6], res: 'hi', make: N => {
    const pal = [0xd9b98c, 0xc89150, 0xa9583a, 0xbc6e48, 0xe7d5b5, 0x8a5a3c, 0xd8c3a0, 0x96503a, 0xcfa070, 0xb5774f].map(rgb);
    // bands: thickness 0.12–0.7 m
    const bands = []; let p = 0, i = 0;
    while (p < N) { const t = Math.round(N * (0.02 + 0.1 * Math.pow(hash3(i, 0, 161), 1.6))); bands.push({ y0: p, t, c: pal[Math.floor(hash3(i, 1, 161) * pal.length)], d: hash3(i, 2, 161), a: hash3(i, 3, 161) }); p += t; i++; }
    const last = bands[bands.length - 1]; last.t -= p - N;
    const W = fbm(N, 2, 4, 162), F = fbm(N, 8, 5, 163), S = aniso(N, 6, 192, 164), G = fbm(N, 64, 2, 165);
    const bandAt = (yy) => { yy = ((yy % N) + N) % N; let lo = 0, hi = bands.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (bands[m].y0 <= yy) lo = m; else hi = m - 1; } return bands[lo]; };
    return build(N, (x, y, o) => {
      // undulation: smooth wave along x, periodic
      const wv = (at(W, N, x, 0) - 0.5) * N * 0.06 + Math.sin(TAU * x / N + 1.3) * N * 0.015 + Math.sin(TAU * 3 * x / N) * N * 0.004;
      const yy = y + wv;
      const b = bandAt(Math.floor(yy));
      const ly = (((yy % N) + N) % N - b.y0) / b.t;
      const s = at(S, N, x, y), f = at(F, N, x, y), g = at(G, N, x, y);
      const edge = Math.min(ly, 1 - ly) * b.t;
      const k = 0.88 + (s - 0.5) * 0.18 + (f - 0.5) * 0.12 + (g - 0.5) * 0.05 - (ly - 0.5) * 0.06;
      o.r = clamp(b.c[0] * k); o.g = clamp(b.c[1] * k); o.b = clamp(b.c[2] * k);
      o.h = b.d * 0.6 + Math.min(1, edge / (N * 0.006)) * 0.2 + (s - 0.5) * 0.15 + (g - 0.5) * 0.05;
      o.rough = 0.72 + s * 0.15;
    }, { normal: 3 });
  } },
  // dark painted panels (dining street, back walls)
  panel_dark: { size: [2.4, 2.0], res: 'lo', make: N => {
    const F = fbm(N, 8, 4, 171);
    return build(N, (x, y, o) => {
      const t = tileAt(x, y, N / 2, N / 2, 0, N, N);
      if (t.d < 1) { o.r = o.g = o.b = 0.05; o.h = 0; o.rough = 0.8; return; }
      const c = 0.16 + (at(F, N, x, y) - 0.5) * 0.02;
      o.r = c; o.g = c * 0.98; o.b = c * 0.95; o.h = 0.5 + Math.min(1, t.d / 2) * 0.3; o.rough = 0.45;
    }, { normal: 1.5 });
  } },

  // --- ceilings ------------------------------------------------------------
  // 600 mm mineral-fibre lay-in tiles with white T-bar grid
  ceil_grid: { size: [1.2, 1.2], res: 'mid', make: N => {
    const G = fbm(N, 64, 3, 181);
    const tw = N / 2, bar = N * 0.02;
    return build(N, (x, y, o) => {
      const lx = x % tw, ly = y % tw;
      const d = Math.min(lx + 0.5, tw - lx - 0.5, ly + 0.5, tw - ly - 0.5);
      if (d < bar) { const c = 0.9; o.r = c; o.g = c; o.b = c * 0.99; o.h = 0.7; o.rough = 0.4; o.metal = 0.2; return; }
      const s = hash3(x, y, 182), g = at(G, N, x, y);
      let c = 0.88 + (g - 0.5) * 0.04;
      if (s < 0.08) c -= 0.07;
      o.r = c; o.g = c; o.b = c * 0.985; o.h = 0.35 - (s < 0.08 ? 0.05 : 0) - smooth(bar + 3, bar, d) * 0.1; o.rough = 0.95;
    }, { normal: 2 });
  } },
  // perforated metal ceiling panels 600 mm (station concourses)
  ceil_perf: { size: [1.2, 1.2], res: 'mid', make: N => {
    const tw = N / 2, p = Math.max(4, Math.round(N / 96));
    return build(N, (x, y, o) => {
      const lx = x % tw, ly = y % tw;
      const d = Math.min(lx + 0.5, tw - lx - 0.5, ly + 0.5, tw - ly - 0.5);
      if (d < 1.2) { o.r = o.g = o.b = 0.25; o.h = 0; o.rough = 0.7; return; }
      const border = d < tw * 0.06;
      const hx = (x % p) - p / 2 + 0.5, hy = (y % p) - p / 2 + 0.5;
      const hole = !border && Math.hypot(hx, hy) < p * 0.28;
      const c = hole ? 0.38 : 0.86;
      o.r = c; o.g = c; o.b = c * 1.01; o.h = hole ? 0.3 : 0.6 + Math.min(1, d / 3) * 0.2; o.rough = hole ? 0.9 : 0.5; o.metal = hole ? 0 : 0.15;
    }, { normal: 1.5 });
  } },
  // linear aluminium strip (spandrel) ceiling, strips along u
  ceil_linear: { size: [0.6, 0.6], res: 'lo', make: N => {
    const p = N / 4;
    return build(N, (x, y, o) => {
      const ly = y % p;
      const gap = ly < p * 0.14;
      const e = Math.min(ly - p * 0.14, p - ly) / (p * 0.86);
      const c = gap ? 0.08 : 0.84 + Math.sin(e * Math.PI) * 0.04;
      o.r = c; o.g = c; o.b = gap ? c : c * 1.01; o.h = gap ? 0 : 0.5 + Math.sin(clamp(e) * Math.PI) * 0.4; o.rough = gap ? 0.9 : 0.34; o.metal = gap ? 0 : 0.22;
    }, { normal: 3 });
  } },
  // timber slat ceiling (Namba Parks interiors)
  ceil_wood_slat: { size: [1.2, 1.2], res: 'mid', make: N => {
    const W = fbm(N, 4, 4, 191), G = aniso(N, 6, 96, 192);
    const p = N / 12;
    return build(N, (x, y, o) => {
      const s = Math.floor(y / p), ly = y % p;
      const gap = ly < p * 0.3;
      if (gap) { o.r = 0.05; o.g = 0.045; o.b = 0.04; o.h = 0; o.rough = 0.9; return; }
      const id = hash3(s, 0, 193), w = at(W, N, x, y), g = at(G, N, x, y);
      const grain = 0.5 + 0.5 * Math.sin(TAU * (y / N * 48 + w * 3 + id * 4));
      const c = 0.9 + (id - 0.5) * 0.18 - grain * 0.08 - g * 0.08;
      o.r = 0.7 * c; o.g = 0.5 * c; o.b = 0.32 * c;
      const e = Math.min(ly - p * 0.3, p - ly) / (p * 0.35);
      o.h = 0.5 + Math.min(1, e) * 0.4; o.rough = 0.5 + grain * 0.1;
    }, { normal: 2 });
  } },
  // corrugated / profiled steel roof deck (Nankai train shed underside)
  roof_deck: { size: [1.2, 1.2], res: 'lo', make: N => {
    const F = fbm(N, 8, 4, 201);
    return build(N, (x, y, o) => {
      const v = (y / N) * 6 % 1;
      const prof = v < 0.35 ? 1 : v < 0.5 ? 1 - (v - 0.35) / 0.15 : v < 0.85 ? 0 : (v - 0.85) / 0.15;
      const c = 0.52 + prof * 0.06 + (at(F, N, x, y) - 0.5) * 0.04;
      o.r = c; o.g = c * 1.01; o.b = c * 1.03; o.h = prof; o.rough = 0.55; o.metal = 0.2;
    }, { normal: 4 });
  } },

  // --- metals --------------------------------------------------------------
  brushed: { size: [0.6, 0.6], res: 'lo', make: N => {
    const S = aniso(N, 4, 256 > N ? N : 256, 211), T = aniso(N, 16, 64, 212);
    return build(N, (x, y, o) => {
      const s = at(S, N, x, y), t = at(T, N, x, y);
      const c = 0.8 + (s - 0.5) * 0.08 + (t - 0.5) * 0.03;
      o.r = c; o.g = c * 1.005; o.b = c * 1.015; o.h = s * 0.5; o.rough = 0.26 + (s - 0.5) * 0.12 + t * 0.05; o.metal = 1;
    }, { normal: 0.6 });
  } },
  // trackbed ballast
  ballast: { size: [1.2, 1.2], res: 'mid', make: N => {
    const id = new Int32Array(N * N).fill(-1), ed = new Float32Array(N * N);
    const k = N / 512;
    scatterChips(N, Math.round(2600 * k * k), 4 * k, 10 * k, 221, (i, c, d) => { if (id[i] < 0 || d < ed[i]) { id[i] = c; ed[i] = d; } });
    return build(N, (x, y, o) => {
      const i = y * N + x, c = id[i];
      if (c < 0) { o.r = 0.12; o.g = 0.11; o.b = 0.1; o.h = 0; o.rough = 1; return; }
      const h = hash3(c, 0, 222), sh = 1 - ed[i] * ed[i];
      const v = 0.3 + h * 0.25 + sh * 0.1;
      o.r = v * 1.04; o.g = v; o.b = v * 0.93 - (h > 0.8 ? 0.05 : 0); o.h = sh; o.rough = 0.9;
    }, { normal: 3 });
  } },
  // escalator handrail: black rubber with periodic light marks (shows motion)
  handrail: { size: [1.0, 0.3], res: 'lo', make: N => build(N, (x, y, o) => {
    const u = x / N;
    const mark = (u % 0.5) > 0.03 && (u % 0.5) < 0.16 && Math.abs(y / N - 0.5) < 0.18;
    const c = mark ? 0.32 : 0.035 + hash3(x, y, 231) * 0.01;
    o.r = c; o.g = c; o.b = c * (mark ? 1.15 : 1); o.h = 0.5; o.rough = mark ? 0.5 : 0.38;
  }, { normal: 0 }) },
  // escalator step atlas: tread (v 0.5..1, nose at v=0.5) and riser (v 0..0.5)
  esc_step: { size: [1, 1], res: 'lo', make: N => build(N, (x, y, o) => {
    const u = x / N, v = 1 - y / N;
    const groove = ((x * 64 / N) % 1) < 0.45;
    if (v >= 0.5) {
      const vv = (v - 0.5) * 2; // 0 at nose .. 1 at back
      const yellow = vv < 0.1 || u < 0.045 || u > 0.955;
      if (yellow) { o.r = 0.95; o.g = 0.72; o.b = 0.05; o.metal = 0; o.rough = 0.5; o.h = groove ? 0.2 : 0.8; return; }
      const c = groove ? 0.16 : 0.5;
      o.r = c; o.g = c; o.b = c * 1.03; o.h = groove ? 0.1 : 0.9; o.rough = groove ? 0.7 : 0.35; o.metal = groove ? 0.2 : 0.8;
    } else {
      const c = groove ? 0.12 : 0.42;
      o.r = c; o.g = c; o.b = c * 1.03; o.h = groove ? 0.1 : 0.9; o.rough = 0.45; o.metal = 0.7;
    }
  }, { normal: 4 }) },
  // anti-slip landing plate with diagonal ribs
  landing: { size: [0.5, 0.5], res: 'lo', make: N => build(N, (x, y, o) => {
    const p = N / 10;
    const a = ((x + y) % p) / p, b = ((x - y + N) % p) / p;
    const rib = (Math.floor(x / p) + Math.floor(y / p)) % 2 === 0 ? Math.abs(a - 0.5) < 0.12 : Math.abs(b - 0.5) < 0.12;
    const c = rib ? 0.78 : 0.6;
    o.r = c; o.g = c; o.b = c * 1.02; o.h = rib ? 0.9 : 0.3; o.rough = rib ? 0.25 : 0.45; o.metal = 1;
  }, { normal: 3 }) },
};

// soft-edged light diffuser (emissive map): bright core, darker frame
export function diffuserCanvas(N = 64) {
  const c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d');
  const img = g.createImageData(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = (x + 0.5) / N, v = (y + 0.5) / N;
    const e = Math.min(u, 1 - u, v, 1 - v);
    const k = e < 0.06 ? 0.25 : 0.85 + 0.15 * smooth(0.06, 0.3, e);
    const j = (y * N + x) * 4;
    img.data[j] = img.data[j + 1] = img.data[j + 2] = k * 255; img.data[j + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}
// radial gradient used for downlight discs / AO blobs
export function radialCanvas(N = 64, inner = 0.55) {
  const c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
  grd.addColorStop(0, '#fff'); grd.addColorStop(inner, '#fff'); grd.addColorStop(inner + 0.08, '#444'); grd.addColorStop(1, '#222');
  g.fillStyle = grd; g.fillRect(0, 0, N, N);
  return c;
}
// vertical alpha gradient for contact-shadow / AO strips: opaque at v=0
export function aoCanvas(N = 64) {
  const c = document.createElement('canvas'); c.width = 4; c.height = N;
  const g = c.getContext('2d');
  const img = g.createImageData(4, N);
  for (let y = 0; y < N; y++) {
    const t = y / (N - 1); // canvas top = v 1
    const a = Math.pow(t, 2.2); // v=0 (bottom row) strongest
    for (let x = 0; x < 4; x++) { const j = (y * 4 + x) * 4; img.data[j] = img.data[j + 1] = img.data[j + 2] = 0; img.data[j + 3] = a * 255; }
  }
  g.putImageData(img, 0, 0);
  return c;
}
