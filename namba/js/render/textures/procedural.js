// =============================================================================
// Procedural, seamless PBR texture generation on canvases.
//
// Every generator returns { albedo, normal, orm } canvases of N×N pixels that
// tile perfectly (all noise is periodic, all patterns divide N). Conventions:
//   albedo  sRGB colour
//   normal  tangent-space (OpenGL, +Y = +v), derived from a height field
//   orm     R = ambient occlusion (unused, 255), G = roughness, B = metalness
//           (three.js reads roughness from G and metalness from B)
// A shader callback fills `o` for each pixel:
//   o.r,o.g,o.b (0..1 sRGB)  o.h (height, ~0..1)  o.rough  o.metal
// Shared noise fields are cached per (N, period, octaves, seed) so dozens of
// materials cost only a few fbm evaluations.
// =============================================================================

const TAU = Math.PI * 2;
export const clamp = (v, a = 0, b = 1) => v < a ? a : v > b ? b : v;
export const mix = (a, b, t) => a + (b - a) * t;
export const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };

// integer hash -> [0,1)
export function hash3(x, y, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul((s | 0) + 0x9e3779b9, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// noise fields
// ---------------------------------------------------------------------------
const _fieldCache = new Map();
// Tileable value noise with `P` lattice cells across the texture.
function valueNoise(N, P, seed) {
  const lat = new Float32Array(P * P);
  for (let i = 0; i < P * P; i++) lat[i] = hash3(i % P, (i / P) | 0, seed);
  const out = new Float32Array(N * N);
  const k = P / N;
  const xi0 = new Int32Array(N), xi1 = new Int32Array(N), xt = new Float32Array(N);
  for (let x = 0; x < N; x++) {
    const f = x * k, i = Math.floor(f), t = f - i;
    xi0[x] = i % P; xi1[x] = (i + 1) % P; xt[x] = t * t * (3 - 2 * t);
  }
  for (let y = 0; y < N; y++) {
    const f = y * k, i = Math.floor(f), t0 = f - i, ty = t0 * t0 * (3 - 2 * t0);
    const r0 = (i % P) * P, r1 = ((i + 1) % P) * P;
    const row = y * N;
    for (let x = 0; x < N; x++) {
      const a = lat[r0 + xi0[x]], b = lat[r0 + xi1[x]], c = lat[r1 + xi0[x]], d = lat[r1 + xi1[x]];
      const t = xt[x];
      const top = a + (b - a) * t, bot = c + (d - c) * t;
      out[row + x] = top + (bot - top) * ty;
    }
  }
  return out;
}
// fbm in [0,1], normalised by its own range for good contrast.
export function fbm(N, P, oct = 5, seed = 1, gain = 0.5) {
  seed = seed % 3; // a small shared pool: materials sample them at different offsets
  const key = `${N}|${P}|${oct}|${seed}|${gain}`;
  let f = _fieldCache.get(key);
  if (f) return f;
  if (N > 512) {
    // compute at 512 and upsample bilinearly (all octaves are smooth at 512)
    const h = fbm(512, P, oct, seed, gain), k = 512 / N;
    f = new Float32Array(N * N);
    for (let y = 0; y < N; y++) {
      const fy = y * k, iy = fy | 0, ty = fy - iy, r0 = iy * 512, r1 = ((iy + 1) & 511) * 512;
      for (let x = 0; x < N; x++) {
        const fx = x * k, ix = fx | 0, tx = fx - ix, ix1 = (ix + 1) & 511;
        const a = h[r0 + ix] + (h[r0 + ix1] - h[r0 + ix]) * tx, b = h[r1 + ix] + (h[r1 + ix1] - h[r1 + ix]) * tx;
        f[y * N + x] = a + (b - a) * ty;
      }
    }
    _fieldCache.set(key, f);
    return f;
  }
  f = new Float32Array(N * N);
  let amp = 1, p = P;
  for (let o = 0; o < oct && p <= N; o++) {
    const n = valueNoise(N, p, seed * 131 + o * 7);
    for (let i = 0; i < f.length; i++) f[i] += n[i] * amp;
    amp *= gain; p *= 2;
  }
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < f.length; i++) { const v = f[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
  const s = 1 / (hi - lo || 1);
  for (let i = 0; i < f.length; i++) f[i] = (f[i] - lo) * s;
  _fieldCache.set(key, f);
  return f;
}
// sample a field (size N) at integer pixel coords with wrap
// N must be a power of two; integer coords (negative ok)
export const at = (F, N, x, y) => F[((y | 0) & (N - 1)) * N + ((x | 0) & (N - 1))];

// ---------------------------------------------------------------------------
// raw texture assembly (works in workers: no DOM). Rows are written bottom-up
// so the arrays upload as DataTextures with flipY = false and v = 0 at row 0.
// ---------------------------------------------------------------------------
// Run a per-pixel shader and build albedo/normal/orm RGBA arrays.
//   opt.normal: height-to-normal strength (0 disables the normal map)
//   opt.M: texture height (default N) for non-square textures
export function build(N, shade, opt = {}) {
  const M = opt.M || N;
  const A = new Uint8Array(N * M * 4);
  const R = new Uint8Array(N * M * 4);
  const H = new Float32Array(N * M);
  const o = { r: 0.5, g: 0.5, b: 0.5, h: 0.5, rough: 0.5, metal: 0, ao: 1 };
  const c8 = (v) => v <= 0 ? 0 : v >= 1 ? 255 : (v * 255 + 0.5) | 0;
  for (let y = 0; y < M; y++) {
    const row = (M - 1 - y) * N;
    for (let x = 0; x < N; x++) {
      o.h = 0.5; o.rough = 0.5; o.metal = 0; o.ao = 1;
      shade(x, y, o);
      const j = (row + x) * 4;
      A[j] = c8(o.r); A[j + 1] = c8(o.g); A[j + 2] = c8(o.b); A[j + 3] = 255;
      R[j] = c8(o.ao); R[j + 1] = c8(o.rough); R[j + 2] = c8(o.metal); R[j + 3] = 255;
      H[y * N + x] = o.h;
    }
  }
  const out = { albedo: A, orm: R, normal: null, N, M };
  const s = opt.normal == null ? 2 : opt.normal;
  if (s > 0) {
    const Nn = new Uint8Array(N * M * 4);
    for (let y = 0; y < M; y++) {
      const yu = ((y - 1 + M) % M) * N, yd = ((y + 1) % M) * N, yr = y * N;
      const orow = (M - 1 - y) * N;
      for (let x = 0; x < N; x++) {
        const xl = (x - 1 + N) % N, xr = (x + 1) % N;
        // shader row y increases downward = -v, so dh/dv = (up - down)
        const dx = (H[yr + xr] - H[yr + xl]) * s;
        const dy = (H[yu + x] - H[yd + x]) * s;
        const l = 1 / Math.sqrt(dx * dx + dy * dy + 1);
        const j = (orow + x) * 4;
        Nn[j] = (-dx * l * 0.5 + 0.5) * 255; Nn[j + 1] = (-dy * l * 0.5 + 0.5) * 255; Nn[j + 2] = (l * 0.5 + 0.5) * 255; Nn[j + 3] = 255;
      }
    }
    out.normal = Nn;
  }
  return out;
}

// ---------------------------------------------------------------------------
// pattern helpers
// ---------------------------------------------------------------------------
// Rectangular tiling. tw/th in px (N must be a multiple of both; with
// stagger, the row count must make the offset wrap). Returns per-pixel tile
// id, local coords and distance to the nearest joint.
const _T = { tx: 0, ty: 0, lx: 0, ly: 0, d: 0, cols: 1 };
export function tileAt(x, y, tw, th, stagger = 0, N = 0, M = 0) {
  const ty = Math.floor(y / th);
  const xx = x + ty * stagger * tw;
  const tx = Math.floor(xx / tw);
  if (N) { const c = (N / tw + 0.5) | 0; _T.tx = ((tx % c) + c) % c; } else _T.tx = tx;
  _T.ty = M ? ty % ((M / th + 0.5) | 0) : ty;
  _T.lx = xx - tx * tw; _T.ly = y - ty * th;
  _T.d = Math.min(_T.lx + 0.5, tw - _T.lx - 0.5, _T.ly + 0.5, th - _T.ly - 0.5);
  return _T;
}
// speckle: sparse high-frequency dots from a hash
export const speck = (x, y, seed, p) => hash3(x, y, seed) < p;

// Paint "chips" (rotated ellipses / irregular polygons) into a buffer with wrap.
// cb(i, chipIndex, edge) is called for each covered pixel (edge 0..1 = centre..rim).
export function scatterChips(N, count, rMin, rMax, seed, cb) {
  for (let c = 0; c < count; c++) {
    const cx = hash3(c, 1, seed) * N, cy = hash3(c, 2, seed) * N;
    const r = rMin + (rMax - rMin) * Math.pow(hash3(c, 3, seed), 2.2);
    const ar = 0.55 + 0.45 * hash3(c, 4, seed), rot = hash3(c, 5, seed) * Math.PI;
    const cr = Math.cos(rot), sr = Math.sin(rot);
    const w1 = (hash3(c, 7, seed) - 0.5) * 0.5, w2 = (hash3(c, 8, seed) - 0.5) * 0.5;
    const R = Math.ceil(r + 1), ir2 = 1 / (r * r);
    const bx = Math.floor(cx), by = Math.floor(cy);
    for (let dy = -R; dy <= R; dy++) {
      const py = ((by + dy) % N + N) % N;
      for (let dx = -R; dx <= R; dx++) {
        const lx = dx * cr + dy * sr, ly = (-dx * sr + dy * cr) / ar;
        // polygon-ish rim: squash by a couple of linear terms
        const q = (lx * lx + ly * ly) * ir2 * (1 + w1 * lx / r + w2 * ly / r);
        if (q > 1) continue;
        cb(py * N + ((bx + dx) % N + N) % N, c, Math.sqrt(q));
      }
    }
  }
}

// hex/hsl helpers (sRGB 0..1)
export function rgb(hex) { return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255]; }
