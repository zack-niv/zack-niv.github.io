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
  const key = `${N}|${P}|${oct}|${seed}|${gain}`;
  let f = _fieldCache.get(key);
  if (f) return f;
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
export const at = (F, N, x, y) => F[(((y % N) + N) % N) * N + (((x % N) + N) % N)];

// ---------------------------------------------------------------------------
// canvas assembly
// ---------------------------------------------------------------------------
function canvasOf(N, data, M = N) {
  const c = document.createElement('canvas');
  c.width = N; c.height = M;
  const g = c.getContext('2d');
  const img = g.createImageData(N, M);
  img.data.set(data);
  g.putImageData(img, 0, 0);
  return c;
}

// Run a per-pixel shader and build albedo/normal/orm canvases.
//   opt.normal: height-to-normal strength (0 disables the normal canvas)
//   opt.M: canvas height (default N) for non-square textures
export function build(N, shade, opt = {}) {
  const M = opt.M || N;
  const A = new Uint8ClampedArray(N * M * 4);
  const R = new Uint8ClampedArray(N * M * 4);
  const H = new Float32Array(N * M);
  const o = { r: 0.5, g: 0.5, b: 0.5, h: 0.5, rough: 0.5, metal: 0, ao: 1 };
  for (let y = 0; y < M; y++) for (let x = 0; x < N; x++) {
    o.h = 0.5; o.rough = 0.5; o.metal = 0; o.ao = 1;
    shade(x, y, o);
    const i = y * N + x, j = i * 4;
    A[j] = o.r * 255; A[j + 1] = o.g * 255; A[j + 2] = o.b * 255; A[j + 3] = 255;
    R[j] = o.ao * 255; R[j + 1] = o.rough * 255; R[j + 2] = o.metal * 255; R[j + 3] = 255;
    H[i] = o.h;
  }
  const out = { albedo: canvasOf(N, A, M), orm: canvasOf(N, R, M), normal: null, N, M };
  const s = opt.normal == null ? 2 : opt.normal;
  if (s > 0) {
    const Nn = new Uint8ClampedArray(N * M * 4);
    for (let y = 0; y < M; y++) {
      const yu = ((y - 1 + M) % M) * N, yd = ((y + 1) % M) * N, yr = y * N;
      for (let x = 0; x < N; x++) {
        const xl = (x - 1 + N) % N, xr = (x + 1) % N;
        // canvas row increases downward = -v, so dh/dv = (up - down)
        const dx = (H[yr + xr] - H[yr + xl]) * s;
        const dy = (H[yu + x] - H[yd + x]) * s;
        let nx = -dx, ny = -dy, nz = 1;
        const l = 1 / Math.hypot(nx, ny, nz);
        nx *= l; ny *= l; nz *= l;
        const j = (yr + x) * 4;
        Nn[j] = (nx * 0.5 + 0.5) * 255; Nn[j + 1] = (ny * 0.5 + 0.5) * 255; Nn[j + 2] = (nz * 0.5 + 0.5) * 255; Nn[j + 3] = 255;
      }
    }
    out.normal = canvasOf(N, Nn, M);
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
  _T.tx = N ? ((tx % Math.round(N / tw)) + Math.round(N / tw)) % Math.round(N / tw) : tx;
  _T.ty = M ? ty % Math.round(M / th) : ty;
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
    const k = 5 + Math.floor(hash3(c, 6, seed) * 4); // polygon-ish lobes
    const ph = hash3(c, 7, seed) * TAU, amp = 0.12 + 0.18 * hash3(c, 8, seed);
    const R = Math.ceil(r + 1);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const lx = dx * cr + dy * sr, ly = (-dx * sr + dy * cr) / ar;
      const ang = Math.atan2(ly, lx);
      const rr = r * (1 + amp * Math.cos(k * ang + ph));
      const d = Math.hypot(lx, ly) / rr;
      if (d > 1) continue;
      const px = ((Math.floor(cx) + dx) % N + N) % N, py = ((Math.floor(cy) + dy) % N + N) % N;
      cb(py * N + px, c, d);
    }
  }
}

// hex/hsl helpers (sRGB 0..1)
export function rgb(hex) { return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255]; }
