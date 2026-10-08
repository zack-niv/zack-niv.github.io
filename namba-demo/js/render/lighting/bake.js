// =============================================================================
// Light-field bake.
//
// For every level we bake a 2D "irradiance map" over the level's walk grid
// (1 texel = 1 grid cell = 1 m) from every fixture registered with
// ctx.lighting.addLight(). Each texel stores:
//   A: rgb = irradiance on an UP-facing surface at floor height   a = sky visibility
//   B: rgb = irradiance on SIDE-facing surfaces at ~1.4 m          a = DOWN-facing (ceiling) luminance
//   C: r = distance to nearest wall /4   g = coverage   b = obstacle occupancy   a = sun visibility
// Light visibility is traced through the grid (walls + partitions block, rails
// and open edges don't), light from upper levels falls through atrium voids,
// a wall-aware diffusion pass approximates one bounce and daylight spill from
// outdoor cells into tunnel mouths / stair wells.
//
// Units: "shader irradiance" — a typical metro corridor floor is ≈ 2.5.
// Pure JS, no THREE dependency (runs in node for tests).
// =============================================================================
import { LEVELS, LEVEL_ORDER } from '../../world/layout.js?v=488c31e';
import { CELL } from '../../world/world.js?v=488c31e';

// per-kind photometry: I0 (on-axis intensity, shader units), profile exponent
// (0 = omni, 1 = Lambertian, >1 = beam), default range (m), default dir
export const KINDS = {
  panel: { I: 8, k: 1, range: 11, dir: [0, -1, 0], size: 0.45 },
  down:  { I: 12, k: 2.5, range: 9, dir: [0, -1, 0], size: 0.12 },
  strip: { I: 4, k: 1, range: 8, dir: [0, -1, 0], size: 0.35 },
  sign:  { I: 4, k: 1, range: 7, dir: [0, 0, 1], size: 0.5 },
  spot:  { I: 22, k: 10, range: 12, dir: [0, -1, 0], size: 0.06 },
  lamp:  { I: 3, k: 0, range: 9, dir: [0, -1, 0], size: 0.15 },
};

export function parseColor(c) {
  if (c == null) return [1, 1, 1];
  if (Array.isArray(c)) return [c[0], c[1], c[2]];
  if (typeof c === 'object' && 'r' in c) return [c.r, c.g, c.b];
  let n = typeof c === 'string' ? parseInt(c.replace('#', ''), 16) : c;
  // hex colours are sRGB: convert to linear
  const s = x => { x /= 255; return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
  return [s((n >> 16) & 255), s((n >> 8) & 255), s(n & 255)];
}

// normalise a builder light record into the internal form
export function normLight(l) {
  const K = KINDS[l.kind] || KINDS.panel;
  const col = parseColor(l.color);
  let I = K.I * (l.intensity == null ? 1 : l.intensity);
  if (l.kind === 'strip' && l.len) I *= Math.max(0.5, l.len / 1.2);
  let d = l.dir || K.dir;
  const dl = Math.hypot(d[0], d[1], d[2]) || 1;
  d = [d[0] / dl, d[1] / dl, d[2] / dl];
  let y = l.y;
  const ly = LEVELS[l.level] ? LEVELS[l.level].y : 0;
  if (y == null) y = ly + 3;
  return {
    level: l.level, x: l.x, y, z: l.z, kind: l.kind || 'panel',
    r: col[0] * I, g: col[1] * I, b: col[2] * I, I, col,
    range: l.range || K.range, k: K.k, dir: d, size: l.size || K.size,
    fallback: !!l.fallback,
  };
}

// per-space-style gain on the baked field (visual hierarchy: shops > courts > corridors)
const SPACE_GAIN = { shop: 1.5, restaurant: 1.35, department: 1.15, depachika: 1.1, arcade_court: 1.25, city_court: 1.2, arcade: 0.82, passage: 0.85, city_mall: 0.92, dining_street: 0.95 };
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function bakeLevel(world, lv, lights, upperLights, opts = {}) {
  const g = world.grids[lv];
  const W = g.w, H = g.h, N = W * H;
  const y0 = LEVELS[lv].y;
  const L = world.layout;
  const type = g.type;
  // ---- blocking edges -------------------------------------------------------
  const bx = new Uint8Array(N), bz = new Uint8Array(N); // wall on +x / +z side of cell
  for (const e of world.edges[lv]) {
    if (e.kind !== 'wall' && e.kind !== 'partition') continue;
    if (e.ax === e.bx) { // vertical edge at x = ax
      const cx = e.ax - g.x0 - 1;
      for (let z = e.az; z < e.bz; z++) { const cz = z - g.z0; if (cx >= 0 && cx < W && cz >= 0 && cz < H) bx[cz * W + cx] = 1; }
    } else {
      const cz = e.az - g.z0 - 1;
      for (let x = e.ax; x < e.bx; x++) { const cx = x - g.x0; if (cx >= 0 && cx < W && cz >= 0 && cz < H) bz[cz * W + cx] = 1; }
    }
  }
  const open = new Uint8Array(N);
  for (let i = 0; i < N; i++) open[i] = type[i] !== CELL.SOLID ? 1 : 0;
  // outdoor / sky
  const outdoor = new Uint8Array(N), outdoorish = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const si = g.space[i];
    if (si >= 0) { const s = L.spaces[si]; if (s.outdoor) outdoor[i] = 1; else if (s.outdoorish) outdoorish[i] = 1; }
  }

  // ---- visibility trace (Amanatides–Woo through the cell grid) -------------
  // from point (ax,az) [grid-local metres] to (bx_,bz_); returns false if a wall
  // edge or a solid cell is crossed.
  const trace = (ax, az, tx, tz) => {
    let cx = Math.floor(ax), cz = Math.floor(az);
    const ex = Math.floor(tx), ez = Math.floor(tz);
    const dx = tx - ax, dz = tz - az;
    const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const tdx = dx !== 0 ? Math.abs(1 / dx) : 1e9, tdz = dz !== 0 ? Math.abs(1 / dz) : 1e9;
    let tmx = dx !== 0 ? (dx > 0 ? (cx + 1 - ax) : (ax - cx)) * tdx : 1e9;
    let tmz = dz !== 0 ? (dz > 0 ? (cz + 1 - az) : (az - cz)) * tdz : 1e9;
    let guard = 0;
    while ((cx !== ex || cz !== ez) && guard++ < 512) {
      if (tmx < tmz) {
        const i = cz * W + cx;
        if (sx > 0) { if (bx[i]) return false; } else { if (cx - 1 < 0 || bx[i - 1]) return false; }
        cx += sx; tmx += tdx;
      } else {
        const i = cz * W + cx;
        if (sz > 0) { if (bz[i]) return false; } else { if (cz - 1 < 0 || bz[i - W]) return false; }
        cz += sz; tmz += tdz;
      }
      if (cx < 0 || cz < 0 || cx >= W || cz >= H) return false;
      if (!open[cz * W + cx]) return false;
    }
    return true;
  };

  const convex = L.spaces.map(s => !!s.rect);
  const Eu = new Float32Array(N * 3), Es = new Float32Array(N * 3);
  let pairs = 0;
  const addLight = (l, through) => {
    // light position in grid-local coords
    let lx = l.x - g.x0, lz = l.z - g.z0;
    // lights sitting on a wall face: nudge along emission dir / into open cell
    let lc = Math.floor(lz) * W + Math.floor(lx);
    if (!through && (lx < 0 || lz < 0 || lx >= W || lz >= H)) return;
    if (!through && !open[lc]) {
      const nx = lx + l.dir[0] * 0.35, nz = lz + l.dir[2] * 0.35;
      const c2 = Math.floor(nz) * W + Math.floor(nx);
      if (nx >= 0 && nz >= 0 && nx < W && nz < H && open[c2]) { lx = nx; lz = nz; lc = c2; }
      else {
        let best = -1, bd = 9;
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          const qx = Math.floor(lx) + dx, qz = Math.floor(lz) + dz;
          if (qx < 0 || qz < 0 || qx >= W || qz >= H || !open[qz * W + qx]) continue;
          const d = Math.hypot(qx + 0.5 - lx, qz + 0.5 - lz);
          if (d < bd) { bd = d; best = qz * W + qx; }
        }
        if (best < 0) return;
        lx = Math.min(Math.max(lx, (best % W) + 0.02), (best % W) + 0.98);
        lz = Math.min(Math.max(lz, Math.floor(best / W) + 0.02), Math.floor(best / W) + 0.98);
      }
    }
    // same convex (rect) space as the light: always visible, skip the trace
    const lsp = through ? -1 : g.space[Math.floor(lz) * W + Math.floor(lx)];
    const R = l.range, R2 = R * R;
    const rmin2 = Math.max(0.36, l.size * l.size * 4);
    const x0 = Math.max(0, Math.floor(lx - R)), x1 = Math.min(W - 1, Math.floor(lx + R));
    const z0 = Math.max(0, Math.floor(lz - R)), z1 = Math.min(H - 1, Math.floor(lz + R));
    const [ddx, ddy, ddz] = l.dir;
    const ly = l.y - y0;
    const invR2 = 1 / R2, lr = l.r, lg = l.g, lb = l.b, k = l.k;
    const profile = k === 0 ? (c) => 1
      : k === 1 ? (c) => (c > 0 ? c : 0)
      : k === 2.5 ? (c) => (c > 0 ? c * c * Math.sqrt(c) : 0)
      : k === 10 ? (c) => { if (c <= 0) return 0; const c2 = c * c, c4 = c2 * c2, c8 = c4 * c4; return c8 * c2; }
      : (c) => (c > 0 ? Math.pow(c, k) : 0);
    for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
      const i = cz * W + cx;
      if (!open[i]) continue;
      const px = cx + 0.5, pz = cz + 0.5;
      const hx = lx - px, hz = lz - pz;
      const h2 = hx * hx + hz * hz;
      if (h2 > R2) continue;
      if (through) { if (!through(px, pz)) continue; }
      else if (!(lsp >= 0 && g.space[i] === lsp && convex[lsp]) && !trace(lx, lz, px, pz)) continue;
      pairs++;
      // floor point
      {
        const vy = ly;
        const d2 = h2 + vy * vy;
        if (d2 < R2) {
          const q = d2 * invR2, w1 = 1 - q * q, win = w1 * w1;
          const d = Math.sqrt(d2);
          const cosE = -(ddx * hx + ddy * vy + ddz * hz) / d; // emission angle (light→point)
          const prof = profile(cosE);
          const cosI = vy / d;
          if (prof > 0 && cosI > 0) {
            const f = prof * cosI * win / (d2 > rmin2 ? d2 : rmin2);
            const o = i * 3;
            Eu[o] += lr * f; Eu[o + 1] += lg * f; Eu[o + 2] += lb * f;
          }
        }
      }
      // side point (fluence × horizontality at 1.4 m)
      {
        const vy = ly - 1.4;
        const d2 = h2 + vy * vy;
        if (d2 < R2) {
          const q = d2 * invR2, w1 = 1 - q * q, win = w1 * w1;
          const d = Math.sqrt(d2);
          const cosE = -(ddx * hx + ddy * vy + ddz * hz) / d;
          const prof = profile(cosE);
          if (prof > 0) {
            const horiz = Math.sqrt(h2) / d; // how horizontal the incoming light is
            const f = prof * (0.25 + 0.5 * horiz) * win / (d2 > rmin2 ? d2 : rmin2);
            const o = i * 3;
            Es[o] += lr * f; Es[o + 1] += lg * f; Es[o + 2] += lb * f;
          }
        }
      }
    }
  };
  for (const l of lights) addLight(l, null);
  // light from the level above falling through voids / escalator wells
  if (upperLights && upperLights.lights.length) {
    const ug = upperLights.grid, uy = LEVELS[upperLights.level].y;
    for (const l of upperLights.lights) {
      // only lights near an opening matter
      const ux = l.x - ug.x0, uz = l.z - ug.z0;
      let near = false;
      const rr = Math.ceil(l.range);
      for (let dz = -rr; dz <= rr && !near; dz += 2) for (let dx = -rr; dx <= rr; dx += 2) {
        const t = ug.typeAt(l.x + dx, l.z + dz);
        if (t === CELL.VOID || t === CELL.RAMP) { near = true; break; }
      }
      if (!near) continue;
      const lyAbs = l.y;
      const through = (px, pz) => {
        // world point of target (floor of this level), find crossing at upper floor height
        const wx = px + g.x0, wz = pz + g.z0;
        const t = (lyAbs - uy) / (lyAbs - y0);
        if (t <= 0 || t >= 1) return false;
        const cxw = l.x + (wx - l.x) * t, czw = l.z + (wz - l.z) * t;
        const tt = ug.typeAt(cxw, czw);
        return tt === CELL.VOID || tt === CELL.RAMP;
      };
      addLight({ ...l, through: true }, through);
    }
  }

  // ---- sky visibility ------------------------------------------------------
  const sky = new Float32Array(N), sun = new Float32Array(N);
  // distance to walls (chamfer), seeds next to blocking edges / solids
  const dist = new Float32Array(N).fill(99);
  for (let cz = 0; cz < H; cz++) for (let cx = 0; cx < W; cx++) {
    const i = cz * W + cx;
    if (!open[i]) { dist[i] = 0; continue; }
    const wall = bx[i] || (cx > 0 && (bx[i - 1] || !open[i - 1])) || (cx < W - 1 && !open[i + 1]) || cx === W - 1 || cx === 0 ||
      bz[i] || (cz > 0 && (bz[i - W] || !open[i - W])) || (cz < H - 1 && !open[i + W]) || cz === 0 || cz === H - 1;
    if (wall) dist[i] = 0.5;
  }
  const D1 = 1, D2 = Math.SQRT2;
  for (let cz = 0; cz < H; cz++) for (let cx = 0; cx < W; cx++) {
    const i = cz * W + cx; let d = dist[i];
    if (cx > 0) d = Math.min(d, dist[i - 1] + D1);
    if (cz > 0) { d = Math.min(d, dist[i - W] + D1); if (cx > 0) d = Math.min(d, dist[i - W - 1] + D2); if (cx < W - 1) d = Math.min(d, dist[i - W + 1] + D2); }
    dist[i] = d;
  }
  for (let cz = H - 1; cz >= 0; cz--) for (let cx = W - 1; cx >= 0; cx--) {
    const i = cz * W + cx; let d = dist[i];
    if (cx < W - 1) d = Math.min(d, dist[i + 1] + D1);
    if (cz < H - 1) { d = Math.min(d, dist[i + W] + D1); if (cx < W - 1) d = Math.min(d, dist[i + W + 1] + D2); if (cx > 0) d = Math.min(d, dist[i + W - 1] + D2); }
    dist[i] = d;
  }
  for (let i = 0; i < N; i++) {
    if (outdoor[i]) { sky[i] = 0.55 + 0.45 * smooth(0, 9, dist[i]); sun[i] = 1; }
    else if (outdoorish[i]) { sky[i] = 0.3; sun[i] = 0; }
  }
  // stair wells / ramps whose upper end is outdoors: daylight pours down
  for (const r of L.ramps) {
    if (r.lower !== lv) continue;
    const up = world.grids[r.upper];
    const [rx0, rz0, rx1, rz1] = r.rect;
    // sample the upper level just beyond the high end
    const hx = r.axis === 'x' ? (r.up > 0 ? rx1 + 0.5 : rx0 - 0.5) : (rx0 + rx1) / 2;
    const hz = r.axis === 'z' ? (r.up > 0 ? rz1 + 0.5 : rz0 - 0.5) : (rz0 + rz1) / 2;
    const si = up.spaceAt(hx, hz);
    if (si < 0 || !L.spaces[si].outdoor) continue;
    for (let z = rz0; z < rz1; z++) for (let x = rx0; x < rx1; x++) {
      const i = g.cellOf(x + 0.5, z + 0.5); if (i < 0) continue;
      const s = r.axis === 'x' ? (x + 0.5 - rx0) / (rx1 - rx0) : (z + 0.5 - rz0) / (rz1 - rz0);
      const t = r.up > 0 ? s : 1 - s; // 0 low end .. 1 high end
      sky[i] = Math.max(sky[i], 0.12 + 0.6 * t * t);
    }
  }

  // ---- diffusion: bounce + daylight spill ----------------------------------
  // wall-aware 4-neighbour relaxation; blocked neighbours reflect.
  // neighbour index tables (blocked → self)
  const nE = new Int32Array(N), nW = new Int32Array(N), nS = new Int32Array(N), nN = new Int32Array(N);
  for (let cz = 0; cz < H; cz++) for (let cx = 0; cx < W; cx++) {
    const i = cz * W + cx;
    nE[i] = cx < W - 1 && !bx[i] && open[i + 1] ? i + 1 : i;
    nW[i] = cx > 0 && !bx[i - 1] && open[i - 1] ? i - 1 : i;
    nS[i] = cz < H - 1 && !bz[i] && open[i + W] ? i + W : i;
    nN[i] = cz > 0 && !bz[i - W] && open[i - W] ? i - W : i;
  }
  const diffuse = (src, comps, iters) => {
    let a = Float32Array.from(src), b = new Float32Array(src.length);
    for (let it = 0; it < iters; it++) {
      if (comps === 3) {
        for (let i = 0; i < N; i++) {
          const o = i * 3;
          if (!open[i]) { b[o] = b[o + 1] = b[o + 2] = 0; continue; }
          const e = nE[i] * 3, w = nW[i] * 3, s2 = nS[i] * 3, n = nN[i] * 3;
          b[o] = 0.2 * (a[o] + a[e] + a[w] + a[s2] + a[n]);
          b[o + 1] = 0.2 * (a[o + 1] + a[e + 1] + a[w + 1] + a[s2 + 1] + a[n + 1]);
          b[o + 2] = 0.2 * (a[o + 2] + a[e + 2] + a[w + 2] + a[s2 + 2] + a[n + 2]);
        }
      } else {
        for (let i = 0; i < N; i++) b[i] = open[i] ? 0.2 * (a[i] + a[nE[i]] + a[nW[i]] + a[nS[i]] + a[nN[i]]) : 0;
      }
      const t = a; a = b; b = t;
    }
    return a;
  };
  const iters = opts.bounceIters || 18;
  const src = new Float32Array(N * 3);
  for (let i = 0; i < N * 3; i++) src[i] = Eu[i] * 0.32 + Es[i] * 0.3;
  const bounce = diffuse(src, 3, iters);
  // daylight spill (scalar), longer reach
  const skySrc = new Float32Array(N);
  for (let i = 0; i < N; i++) skySrc[i] = sky[i];
  const spill = diffuse(skySrc, 1, iters + 10);
  for (let i = 0; i < N; i++) if (!outdoor[i]) sky[i] = Math.max(sky[i], Math.min(0.6, spill[i] * 0.9));

  // ---- obstacle occupancy (contact AO under counters, benches, gates…) -----
  const occ = new Float32Array(N);
  const obs = world.obstacles[lv] || [];
  for (const o of obs) {
    const c = Math.cos(o.rot || 0), s = Math.sin(o.rot || 0);
    const ex = Math.abs(o.hx * c) + Math.abs(o.hz * s), ez = Math.abs(o.hx * s) + Math.abs(o.hz * c);
    const qx0 = Math.floor(o.cx - ex - g.x0), qx1 = Math.floor(o.cx + ex - g.x0);
    const qz0 = Math.floor(o.cz - ez - g.z0), qz1 = Math.floor(o.cz + ez - g.z0);
    for (let cz = qz0; cz <= qz1; cz++) for (let cx = qx0; cx <= qx1; cx++) {
      if (cx < 0 || cz < 0 || cx >= W || cz >= H) continue;
      let hit = 0;
      for (let sz = 0; sz < 4; sz++) for (let sx = 0; sx < 4; sx++) {
        const wx = g.x0 + cx + (sx + 0.5) / 4 - o.cx, wz = g.z0 + cz + (sz + 0.5) / 4 - o.cz;
        const u = wx * c - wz * s, v = wx * s + wz * c; // inverse rotate
        if (Math.abs(u) <= o.hx && Math.abs(v) <= o.hz) hit++;
      }
      occ[cz * W + cx] = Math.min(1, occ[cz * W + cx] + hit / 16);
    }
  }
  const occB = new Float32Array(N);
  for (let cz = 0; cz < H; cz++) for (let cx = 0; cx < W; cx++) {
    let s = 0, n = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const qx = cx + dx, qz = cz + dz; if (qx < 0 || qz < 0 || qx >= W || qz >= H) continue;
      const w = dx === 0 && dz === 0 ? 2 : 1; s += occ[qz * W + qx] * w; n += w;
    }
    occB[cz * W + cx] = Math.min(1, (s / n) * 1.6);
  }

  // ---- assemble ------------------------------------------------------------
  const A = new Float32Array(N * 4), B = new Float32Array(N * 4), C = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) {
    const r = bounce[i * 3], gg = bounce[i * 3 + 1], bb = bounce[i * 3 + 2];
    // luminance hierarchy: shop interiors glow, corridors sit back
    const si = g.space[i], sty = si >= 0 && L.spaces[si] ? L.spaces[si].style : null;
    const sg = (sty && SPACE_GAIN[sty]) || 1;
    A[i * 4] = (Eu[i * 3] + r * 0.34) * sg; A[i * 4 + 1] = (Eu[i * 3 + 1] + gg * 0.34) * sg; A[i * 4 + 2] = (Eu[i * 3 + 2] + bb * 0.34) * sg;
    A[i * 4 + 3] = sky[i];
    B[i * 4] = (Es[i * 3] + r * 0.55) * sg; B[i * 4 + 1] = (Es[i * 3 + 1] + gg * 0.55) * sg; B[i * 4 + 2] = (Es[i * 3 + 2] + bb * 0.55) * sg;
    // ceiling: light bounced up from the floor (a lit mall ceiling reads ~50% of the
    // floor's luminance, white not khaki) + a little direct uplight from signs/lamps
    B[i * 4 + 3] = sg * (1.9 * (0.2126 * r + 0.7152 * gg + 0.0722 * bb) + 0.3 * (0.2126 * Es[i * 3] + 0.7152 * Es[i * 3 + 1] + 0.0722 * Es[i * 3 + 2]));
    C[i * 4] = Math.round(Math.min(1, dist[i] / 4) * 255);
    C[i * 4 + 1] = open[i] ? 255 : 0;
    C[i * 4 + 2] = Math.round(occB[i] * 255);
    C[i * 4 + 3] = Math.round(sun[i] * 255);
  }
  // dilate open texels into solid ones (2 rings) so bilinear sampling at
  // walls doesn't pull in black
  const fillIdx = new Int32Array(N), fillAcc = new Float32Array(N * 9);
  for (let ring = 0; ring < 2; ring++) {
    let nf = 0;
    for (let cz = 0; cz < H; cz++) for (let cx = 0; cx < W; cx++) {
      const i = cz * W + cx; if (C[i * 4 + 1]) continue;
      let n = 0, a0 = 0, a1 = 0, a2 = 0, a3 = 0, b0 = 0, b1 = 0, b2 = 0, b3 = 0, sv = 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const qx = cx + dx, qz = cz + dz; if (qx < 0 || qz < 0 || qx >= W || qz >= H) continue;
        const j = qz * W + qx; if (!C[j * 4 + 1]) continue;
        const o = j * 4;
        a0 += A[o]; a1 += A[o + 1]; a2 += A[o + 2]; a3 += A[o + 3];
        b0 += B[o]; b1 += B[o + 1]; b2 += B[o + 2]; b3 += B[o + 3]; sv += C[o + 3]; n++;
      }
      if (!n) continue;
      const f = nf * 9, inv = 1 / n;
      fillIdx[nf++] = i;
      fillAcc[f] = a0 * inv; fillAcc[f + 1] = a1 * inv; fillAcc[f + 2] = a2 * inv; fillAcc[f + 3] = a3 * inv;
      fillAcc[f + 4] = b0 * inv; fillAcc[f + 5] = b1 * inv; fillAcc[f + 6] = b2 * inv; fillAcc[f + 7] = b3 * inv; fillAcc[f + 8] = sv * inv;
    }
    for (let k = 0; k < nf; k++) {
      const i = fillIdx[k], f = k * 9, o = i * 4;
      A[o] = fillAcc[f]; A[o + 1] = fillAcc[f + 1]; A[o + 2] = fillAcc[f + 2]; A[o + 3] = fillAcc[f + 3];
      B[o] = fillAcc[f + 4]; B[o + 1] = fillAcc[f + 5]; B[o + 2] = fillAcc[f + 6]; B[o + 3] = fillAcc[f + 7];
      C[o] = 0; C[o + 1] = ring === 0 ? 254 : 200; C[o + 2] = 0; C[o + 3] = Math.round(fillAcc[f + 8]);
    }
  }
  return { level: lv, W, H, x0: g.x0, z0: g.z0, y: y0, A, B, C, pairs, nLights: lights.length };
}

// Synthesised fixtures for spaces nobody lit (keeps the place lit while the
// builders' fixtures land). One record per fixture: {level,x,y,z,kind,color,intensity,w,d}
export const FALLBACK_STYLE = {
  metro_platform:     { kind: 'strip', sx: 2.4, sz: 4.0, color: 0xeef4ff, i: 1.2, along: true },
  metro_concourse:    { kind: 'panel', sx: 3.6, sz: 3.6, color: 0xf0f5ff, i: 1.0 },
  passage:            { kind: 'panel', sx: 3.6, sz: 4.0, color: 0xf2f6ff, i: 0.9 },
  arcade:             { kind: 'down', sx: 2.6, sz: 2.6, color: 0xfff1e0, i: 1.0 },
  arcade_court:       { kind: 'down', sx: 3.0, sz: 3.0, color: 0xffe4c4, i: 1.3 },
  depachika:          { kind: 'panel', sx: 3.0, sz: 3.0, color: 0xfff6ea, i: 1.25 },
  city_plaza:         { kind: 'down', sx: 2.6, sz: 2.6, color: 0xffe2bf, i: 1.0 },
  city_mall:          { kind: 'down', sx: 2.5, sz: 3.0, color: 0xffe4c4, i: 1.0 },
  city_court:         { kind: 'down', sx: 3.0, sz: 3.0, color: 0xffdcb4, i: 1.3 },
  dining_street:      { kind: 'down', sx: 3.0, sz: 3.0, color: 0xffc890, i: 0.75 },
  shop:               { kind: 'panel', sx: 3.0, sz: 3.0, color: 0xfff8f0, i: 1.15 },
  restaurant:         { kind: 'down', sx: 2.5, sz: 2.5, color: 0xffcf9a, i: 0.7 },
  department:         { kind: 'down', sx: 2.4, sz: 2.4, color: 0xfff0dc, i: 1.25 },
  terminal_hall:      { kind: 'panel', sx: 4.0, sz: 4.0, color: 0xf6f8ff, i: 1.1 },
  terminal_concourse: { kind: 'panel', sx: 4.0, sz: 4.0, color: 0xf6f8ff, i: 1.1 },
  terminal_platform:  { kind: 'strip', sx: 3.0, sz: 5.0, color: 0xf4f7ff, i: 1.2, along: true },
  parks_indoor:       { kind: 'down', sx: 3.0, sz: 3.0, color: 0xffe6c8, i: 1.0 },
  parks_dining:       { kind: 'down', sx: 3.0, sz: 3.0, color: 0xffd6a8, i: 0.8 },
  parks_skywalk:      { kind: 'down', sx: 3.0, sz: 3.0, color: 0xffd6a8, i: 0.8 },
  default:            { kind: 'panel', sx: 3.6, sz: 3.6, color: 0xf4f6fa, i: 1.0 },
};

export function synthesiseFallback(world, registered) {
  const L = world.layout;
  // ambient output (sum of on-axis intensity of ceiling-type fixtures) per space;
  // signs, screens and accent spots don't light a room on their own
  const lit = new Map();
  for (const l of registered) {
    if (l.kind === 'sign') continue;
    const g = world.grids[l.level]; if (!g) continue;
    const si = g.spaceAt(l.x, l.z);
    const w = l.kind === 'spot' ? 0.3 : l.kind === 'lamp' ? 0.6 : 1;
    if (si >= 0) lit.set(si, (lit.get(si) || 0) + (l.I || 1) * w);
  }
  const out = [];
  L.spaces.forEach((s, si) => {
    if (s.outdoor) return;
    const st = FALLBACK_STYLE[s.style] || FALLBACK_STYLE.default;
    const K = KINDS[st.kind];
    let [x0, z0, x1, z1] = s.rect || polyB(s.poly);
    const area = Math.max(1, (x1 - x0) * (z1 - z0));
    const want = st.i * K.I / (st.sx * st.sz);           // fallback output density
    const have = (lit.get(si) || 0) / area;
    if (have >= want * 0.6) return;                        // builders lit it
    const fill = 1 - have / want;                          // complement partial lighting
    const g = world.grids[s.level];
    const y = LEVELS[s.level].y + s.ceil - 0.03;
    const hScale = Math.pow(Math.max(1, s.ceil / 3.3), 1.6);
    const longX = (x1 - x0) >= (z1 - z0);
    let sx = st.sx, sz = st.sz;
    if (st.along && !longX) { const t = sx; sx = sz; sz = t; }
    const nx = Math.max(1, Math.round((x1 - x0) / sx)), nz = Math.max(1, Math.round((z1 - z0) / sz));
    const dx = (x1 - x0) / nx, dz = (z1 - z0) / nz;
    for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
      const x = x0 + (ix + 0.5) * dx, z = z0 + (iz + 0.5) * dz;
      if (g.spaceAt(x, z) !== si) continue; // other space overrides / polygon
      if (g.typeAt(x, z) !== CELL.WALK) continue; // voids, ramps
      out.push({ level: s.level, x, y, z, kind: st.kind, color: st.color, intensity: st.i * hScale * fill, fallback: true,
        along: st.along ? (longX ? 'x' : 'z') : null, ceil: s.ceil });
    }
  });
  return out;
}
function polyB(poly) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of poly) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
  return [x0, z0, x1, z1];
}

// Pack the per-level maps into one atlas (shelf packing).
export function packAtlas(levels, pad = 6, maxW = 1024) {
  const items = levels.slice().sort((a, b) => b.H - a.H);
  let x = 0, y = 0, rowH = 0, W = 0;
  for (const it of items) {
    const w = it.W + pad * 2, h = it.H + pad * 2;
    if (x + w > maxW) { x = 0; y += rowH; rowH = 0; }
    it.ox = x + pad; it.oy = y + pad;
    x += w; rowH = Math.max(rowH, h); W = Math.max(W, x);
  }
  const H = y + rowH;
  return { W: Math.ceil(W / 4) * 4, H: Math.ceil(H / 4) * 4 };
}

export { LEVEL_ORDER };
