// =============================================================================
// The Canyon: curving walls of layered strata rising from the 2F canyon floor,
// built along a smoothed version of the canyon outline. The visible face is
// always IN FRONT of the 1 m walk-grid boundary and collision boxes are laid
// along it, so what you see is what you bump into.
//
// Each wall is a stack of horizontal bands (strata); every band undulates with
// its own phase, so ledges, overhangs and thin coping fins appear naturally.
// Openings: canyon-view doorways, the garden stairs, bridges and skywalks.
// =============================================================================
import * as THREE from 'three';
import { CELL } from '../world.js?v=454ed73';
import { LEVELS } from '../layout.js?v=454ed73';
import { rng } from '../../core/rng.js?v=454ed73';
import { MeshAcc, lin, mulc } from './meshacc.js?v=454ed73';

export const PALETTE = {
  ochre: lin(0xc89a62), rust: lin(0xa8603f), sand: lin(0xdcc29c), terracotta: lin(0xbc7552),
  cream: lin(0xeadfca), brown: lin(0x86624a), blush: lin(0xd5a487), umber: lin(0x9c7656),
};
const BAND_SEQ = ['sand', 'ochre', 'terracotta', 'cream', 'rust', 'sand', 'blush', 'ochre', 'umber', 'cream', 'terracotta', 'sand', 'brown', 'ochre', 'cream', 'rust', 'blush'];

// Terrace (garden) levels by z, east of the canyon
export const TERRACE_Z = [[204, 252, 12, 50], [252, 290, 18, 52], [290, 320, 24, 54], [320, 346, 30, 56], [346, 366, 36, 58], [366, 388, 42, 60]];
export function terraceAt(z) { for (const t of TERRACE_Z) if (z >= t[0] && z < t[1]) return t; return z < 204 ? TERRACE_Z[0] : TERRACE_Z[TERRACE_Z.length - 1]; }

const GROUND = 6, GROUND_TOP = 10.2;
const ZF = 0.02; // v6: offset that keeps strata caps / sills / soffits out of the plane of floors, ceilings and roofs

// ---------------------------------------------------------------------------
function resample(poly, tags, step) {
  const out = [];
  for (let k = 0; k < poly.length - 1; k++) {
    const [ax, az] = poly[k], [bx, bz] = poly[k + 1];
    const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / step));
    for (let i = 0; i < n; i++) out.push({ x: ax + (bx - ax) * i / n, z: az + (bz - az) * i / n, side: tags[k] });
  }
  const l = poly[poly.length - 1];
  out.push({ x: l[0], z: l[1], side: tags[tags.length - 1] });
  return out;
}
function smoothPts(P, rad, passes) {
  for (let p = 0; p < passes; p++) {
    const nx = P.map(q => q.x), nz = P.map(q => q.z);
    for (let i = 1; i < P.length - 1; i++) {
      let sx = 0, sz = 0, w = 0;
      for (let k = -rad; k <= rad; k++) { const j = Math.max(0, Math.min(P.length - 1, i + k)); const ww = 1 - Math.abs(k) / (rad + 1); sx += P[j].x * ww; sz += P[j].z * ww; w += ww; }
      nx[i] = sx / w; nz[i] = sz / w;
    }
    P.forEach((q, i) => { q.x = nx[i]; q.z = nz[i]; });
  }
}
function filt(a, rad, fn) { return a.map((_, i) => { let r = fn === 'max' ? -Infinity : 0, w = 0; for (let k = -rad; k <= rad; k++) { const j = Math.max(0, Math.min(a.length - 1, i + k)); if (fn === 'max') r = Math.max(r, a[j]); else { r += a[j]; w++; } } return fn === 'max' ? r : r / w; }); }

// ---------------------------------------------------------------------------
export function buildCanyon(ctx, parks) {
  const { world, materials } = ctx;
  const L = world.layout;
  const g = world.grids['2F'];
  const regionSet = new Set(['parks_canyon', 'parks_stage'].map(id => world.spaceIndex.get(id)));
  const R = rng(1234);

  // ---- outline (open polyline: west side N->S, south, east side S->N) -------
  const poly = [[22, 214], [24, 238], [20, 262], [24, 292], [26, 322], [30, 352], [30, 386], [60, 386], [60, 372], [52, 372], [48, 346], [52, 318], [46, 290], [42, 262], [48, 240], [44, 214]];
  const tags = ['w', 'w', 'w', 'w', 'w', 'w', 's', 'e', 'e', 'e', 'e', 'e', 'e', 'e', 'e'];
  const STEP = 0.5;
  const P = resample(poly, tags, STEP);
  smoothPts(P, 6, 4);
  const N = P.length;
  // tangents / normals (normal points into the canyon)
  for (let i = 0; i < N; i++) {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(N - 1, i + 1)];
    let tx = b.x - a.x, tz = b.z - a.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    P[i].tx = tx; P[i].tz = tz; P[i].nx = tz; P[i].nz = -tx;
  }
  const inRegion = (x, z) => { const i = g.cellOf(x, z); return i >= 0 && g.type[i] === CELL.WALK && regionSet.has(g.space[i]); };
  const otherWalk = (x, z) => { const i = g.cellOf(x, z); if (i < 0) return false; const t = g.type[i]; return t === CELL.RAMP || (t === CELL.WALK && !regionSet.has(g.space[i])); };
  // ---- required offsets so the face is in front of the grid boundary --------
  let off = P.map(p => {
    let o = -1.2;
    for (let it = 0; it < 60; it++) {
      let bad = false;
      for (const t of [0.05, 0.35, 0.7, 1.05, 1.4]) { if (inRegion(p.x + p.nx * (o - t), p.z + p.nz * (o - t))) { bad = true; break; } }
      if (!bad) break;
      o += 0.1;
    }
    return o + 0.05;
  });
  // ground openings (door / ramp) behind the face
  const openKind = P.map((p, i) => {
    for (const t of [0.6, 1.5, 2.4]) {
      const x = p.x + p.nx * (off[i] - t), z = p.z + p.nz * (off[i] - t);
      const ci = g.cellOf(x, z);
      if (ci >= 0 && g.type[ci] === CELL.RAMP) return 'ramp';
      if (otherWalk(x, z)) return 'door';
    }
    return null;
  });
  // interpolate offsets across openings, then smooth (max + blur keeps >= raw)
  for (let i = 0; i < N; i++) if (openKind[i]) {
    let a = i; while (a > 0 && openKind[a]) a--;
    let b = i; while (b < N - 1 && openKind[b]) b++;
    const oa = openKind[a] ? off[b] : off[a], ob = openKind[b] ? off[a] : off[b];
    off[i] = oa + (ob - oa) * (i - a) / Math.max(1, b - a);
  }
  off = filt(filt(off, 3, 'max'), 3, 'avg');
  const F = P.map((p, i) => ({ x: p.x + p.nx * off[i], z: p.z + p.nz * off[i], nx: p.nx, nz: p.nz, tx: p.tx, tz: p.tz, side: p.side }));
  let s = 0;
  F.forEach((f, i) => { if (i) s += Math.hypot(f.x - F[i - 1].x, f.z - F[i - 1].z); f.s = s; });
  // dilate ground openings by one sample so jambs sit on the grid opening
  const gOpen = openKind.slice();

  // ---- wall heights & cap depths per sample ---------------------------------
  F.forEach((f) => {
    if (f.side === 'w') { f.H = 30; f.cap = f.z >= 284 ? Math.max(2, f.x - 22.6) : 3.5; f.ledge = f.z >= 284; }
    else if (f.side === 's') { f.H = 18; f.cap = 4; }
    else { const t = terraceAt(f.z); f.H = t[2] + 0.6; f.cap = Math.max(1.5, t[3] - f.x + 0.05); f.rim = t; }
  });

  // ---- openings at upper levels (bridges, skywalks) ------------------------
  const ups = [];
  for (const sp of L.spaces) {
    if (sp.style !== 'canyon_bridge' && sp.style !== 'parks_skywalk') continue;
    const y = LEVELS[sp.level].y, top = y + (sp.style === 'parks_skywalk' ? 3.6 : 4.2);
    const [x0, z0, x1, z1] = sp.rect;
    ups.push({ sp, y0: y, y1: top, x0, z0, x1, z1 });
  }
  const upOpen = (f, y0, y1) => {
    for (const u of ups) {
      if (y1 <= u.y0 + 0.01 || y0 >= u.y1 - 0.01) continue;
      if (f.z > u.z0 - 0.05 && f.z < u.z1 + 0.05 && f.x > u.x0 - 1 && f.x < u.x1 + 1 && u.y0 < f.H - 0.7) return u;
    }
    return null;
  };

  // ---- bands ------------------------------------------------------------------
  const req = new Set([GROUND, GROUND_TOP]);
  for (const u of ups) { req.add(u.y0); req.add(u.y1); }
  for (const t of TERRACE_Z) req.add(t[2] + 0.6);
  req.add(18); req.add(30); req.add(30.6);
  const reqs = [...req].sort((a, b) => a - b).filter(y => y >= GROUND && y <= 48);
  const BY = [reqs[0]];
  for (let k = 1; k < reqs.length; k++) {
    const a = reqs[k - 1], b = reqs[k];
    let y = a;
    while (b - y > 1.9) { y += R.range(0.45, 1.5); if (b - y < 0.35) break; BY.push(y); }
    BY.push(b);
  }
  const bands = [];
  for (let k = 0; k < BY.length - 1; k++) {
    const y0 = BY[k], y1 = BY[k + 1], ym = (y0 + y1) / 2;
    const ground = y1 <= GROUND_TOP + 0.01;
    bands.push({
      y0, y1, ground,
      col: PALETTE[BAND_SEQ[k % BAND_SEQ.length]],
      amp: ground ? 0 : Math.min(1.4, 0.18 + (ym - GROUND_TOP) * 0.05) * R.range(0.5, 1.1),
      lam: R.range(9, 26), ph: R.range(0, 100), ph2: R.range(0, 100),
      fin: !ground && R.chance(0.28),
      recess: !ground && R.chance(0.2) ? -R.range(0.15, 0.4) : 0,
    });
  }
  const bandOff = (b, f) => b.ground ? 0 : b.recess + b.amp * (0.55 + 0.6 * Math.sin(f.s / b.lam + b.ph) * 0.6 + 0.4 * Math.sin(f.s / (b.lam * 0.41) + b.ph2) * 0.4);
  // per-sample weathering noise
  const wn = F.map(f => 0.9 + 0.1 * Math.sin(f.s * 0.37) * Math.sin(f.s * 0.11 + 2));

  // ---- shopfronts set into the ground band ---------------------------------
  const shopAt = new Int16Array(N).fill(-1);
  const shops = [];
  {
    let i = 8;
    while (i < N - 30) {
      const len = Math.round(R.range(12, 22)); // samples (6..11 m)
      let ok = true;
      for (let k = i - 4; k < i + len + 4; k++) if (k < 0 || k >= N || gOpen[k] || F[k].side !== F[i].side) { ok = false; break; }
      if (ok && R.chance(0.7)) { shops.push({ i0: i, i1: i + len }); for (let k = i; k <= i + len; k++) shopAt[k] = shops.length - 1; i += len + Math.round(R.range(14, 40)); }
      else i += 6;
    }
  }

  // ---- geometry ---------------------------------------------------------------
  const acc = new MeshAcc();
  const V = (f, o, y) => [f.x + f.nx * o, y, f.z + f.nz * o];
  const UVs = (fa, fb, y0, y1) => [[fa.s / 4, y0 / 4], [fb.s / 4, y0 / 4], [fb.s / 4, y1 / 4], [fa.s / 4, y1 / 4]];
  const openAt = (i, b) => {
    if (b.ground && (gOpen[i] || shopAt[i] >= 0)) return gOpen[i] ? { depth: 2.6 } : { depth: 0.6, shop: true };
    if (gOpen[i] === 'ramp' && b.y0 < F[i].H) return { depth: 9 };
    const u = upOpen(F[i], b.y0, b.y1);
    if (u) return { depth: Math.max(1, (F[i].nx > 0 ? F[i].x - u.x0 : u.x1 - F[i].x) + 0.3), up: u };
    return null;
  };
  const segOpen = (i, b) => openAt(i, b) || openAt(i + 1, b);
  for (let i = 0; i < N - 1; i++) {
    const fa = F[i], fb = F[i + 1];
    const H = Math.min(fa.H, fb.H);
    const na = [fa.nx, 0, fa.nz], nb = [fb.nx, 0, fb.nz];
    for (let bi = 0; bi < bands.length; bi++) {
      const b = bands[bi];
      if (b.y0 >= H - 0.01) break;
      const y1 = Math.min(b.y1, H);
      const oa = bandOff(b, fa), ob = bandOff(b, fb);
      const op = segOpen(i, b);
      const ca = mulc(b.col, wn[i]), cb = mulc(b.col, wn[i + 1]);
      // ambient darkening near the canyon floor and under overhangs
      const nxt = bands[bi + 1];
      const under = nxt && nxt.y0 < H && (bandOff(nxt, fa) > oa + 0.15) ? 0.72 : 1;
      const yb = b.y0 <= GROUND + 0.01 ? 0.78 : 1;
      if (!op) {
        acc.quad(V(fb, ob, b.y0), V(fa, oa, b.y0), V(fa, oa, y1), V(fb, ob, y1), [nb, na, na, nb], UVs(fb, fa, b.y0, y1),
          [mulc(cb, yb), mulc(ca, yb), mulc(ca, under), mulc(cb, under)]);
      }
      // horizontal transition to the next band
      if (nxt && nxt.y0 < H - 0.01) {
        const opN = segOpen(i, nxt);
        const oa2 = bandOff(nxt, fa), ob2 = bandOff(nxt, fb);
        const y = b.y1;
        if (!op && !opN) {
          const up = (oa + ob) > (oa2 + ob2);
          const c = mulc(PALETTE.cream, 0.95);
          acc.quadAuto(V(fa, oa2, y), V(fb, ob2, y), V(fb, ob, y), V(fa, oa, y), null, up ? c : mulc(c, 0.7));
          if (b.fin) {
            const fo = Math.max(oa, oa2) + 0.45, fo2 = Math.max(ob, ob2) + 0.45;
            const lo = Math.min(oa, oa2), lo2 = Math.min(ob, ob2);
            const cc = PALETTE.cream;
            acc.quadAuto(V(fa, lo, y + 0.06), V(fb, lo2, y + 0.06), V(fb, fo2, y + 0.06), V(fa, fo, y + 0.06), null, cc);
            acc.quadAuto(V(fa, fo, y - 0.06), V(fb, fo2, y - 0.06), V(fb, lo2, y - 0.06), V(fa, lo, y - 0.06), null, mulc(cc, 0.6));
            acc.quad(V(fb, fo2, y - 0.06), V(fa, fo, y - 0.06), V(fa, fo, y + 0.06), V(fb, fo2, y + 0.06), [fa.nx, 0, fa.nz], null, cc);
          }
        } else if (op && !opN) { // soffit (opening top)
          const d = op.depth;
          // v6: the opening's soffit / sill lay exactly in the plane of the indoor ceiling / bridge deck it runs into
          // (2F canyon-view ceilings at 10.2, the 3F/5F bridge decks): they z-fought (Zack's item 5, the bridge/floor
          // seam). Tuck them 2 cm behind those surfaces; the band faces still reach y, so the lip stays closed.
          acc.quadAuto(V(fa, oa2, y + ZF), V(fb, ob2, y + ZF), V(fb, ob2 - d, y + ZF), V(fa, oa2 - d, y + ZF), null, mulc(PALETTE.cream, 0.8));
        } else if (!op && opN) { // sill
          const d = opN.depth;
          acc.quadAuto(V(fa, oa - d, y - ZF), V(fb, ob - d, y - ZF), V(fb, ob, y - ZF), V(fa, oa, y - ZF), null, PALETTE.cream);
        }
      }
      // jambs at opening ends
      if (op) {
        const prevOpen = i > 0 && segOpen(i - 1, b);
        const nextOpen = i < N - 2 && segOpen(i + 1, b);
        if (!prevOpen) { const d = op.depth; acc.quadAuto(V(fa, oa - d, b.y0), V(fa, oa, b.y0), V(fa, oa, y1), V(fa, oa - d, y1), null, mulc(b.col, 0.85)); }
        if (!nextOpen) { const d = op.depth; acc.quadAuto(V(fb, ob, b.y0), V(fb, ob - d, b.y0), V(fb, ob - d, y1), V(fb, ob, y1), null, mulc(b.col, 0.85)); }
      }
    }
    // top cap
    const top = bands.filter(b => b.y0 < H - 0.01).pop();
    if (top && !(gOpen[i] === 'ramp' || gOpen[i + 1] === 'ramp')) {
      const oa = bandOff(top, fa), ob = bandOff(top, fb);
      const bridgeLanding = fa.rim && ups.some(u => u.y0 <= fa.rim[2] + 0.1 && u.y0 >= fa.rim[2] - 0.1 && fa.z > u.z0 - 0.3 && fa.z < u.z1 + 0.3);
      if (!bridgeLanding) {
        // v6: the west cap (H 30) ran under the Parks mall roof (massing.js, y 30) = coplanar; keep it just below
        const Hc = fa.side === 'w' ? H - ZF : H;
        acc.quadAuto(V(fa, -fa.cap, Hc), V(fb, -fb.cap, Hc), V(fb, ob, Hc), V(fa, oa, Hc), null, PALETTE.cream);
        if (fa.rim || fa.ledge) parks.planters.push({ kind: fa.rim ? 'rim' : 'ledge', a: V(fa, oa - 0.35, H), b: V(fb, ob - 0.35, H), a2: V(fa, -fa.cap + (fa.rim ? 0.3 : 0.2), H), b2: V(fb, -fb.cap + (fb.rim ? 0.3 : 0.2), H), n: [fa.nx, fa.nz], y: H });
      }
    }
    // step between runs of different height: end cap
    if (Math.abs(fa.H - fb.H) > 0.01) {
      const hi = fa.H > fb.H ? fa : fb, lo = fa.H > fb.H ? fb : fa;
      const f = fa.H > fb.H ? fb : fa; // build at the lower sample position using hi's offsets
      for (const b of bands) {
        if (b.y1 <= lo.H + 0.01 || b.y0 >= hi.H - 0.01) continue;
        const y0 = Math.max(b.y0, lo.H), y1 = Math.min(b.y1, hi.H);
        const o = bandOff(b, f);
        const dir = fa.H > fb.H ? 1 : -1; // face towards the lower run
        const A = V(f, o, y0), B = V(f, -hi.cap, y0), C = V(f, -hi.cap, y1), D = V(f, o, y1);
        if (dir > 0) acc.quadAuto(B, A, D, C, null, mulc(b.col, 0.9)); else acc.quadAuto(A, B, C, D, null, mulc(b.col, 0.9));
      }
    }
  }
  const mesh = acc.mesh(materials.get('parks_strata'), { name: 'parks:canyon' });
  parks.root.add(mesh);

  // ---- collision along the face --------------------------------------------
  let boxes = 0;
  for (let i = 0; i < N - 1; i += 3) {
    const j = Math.min(N - 1, i + 3);
    let open = false;
    for (let k = i; k <= j; k++) if (gOpen[k]) open = true;
    if (open) continue;
    const a = F[i], b = F[j];
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
    if (len < 0.05) continue;
    const nx = (a.nx + b.nx) / 2, nz = (a.nz + b.nz) / 2;
    const th = 1.0;
    world.addBox('2F', (a.x + b.x) / 2 - nx * th, (a.z + b.z) / 2 - nz * th, len / 2 + 0.03, th, Math.atan2(dz, dx));
    boxes++;
  }

  // ---- shopfronts --------------------------------------------------------------
  buildShopfronts(ctx, parks, F, shops);

  parks.canyon = { F, bands, shops, ups, boxes, gOpen, shopAt };
  return parks.canyon;
}

// ---------------------------------------------------------------------------
// Glazed shopfronts recessed into the strata at canyon level.
function shopInteriorTexture(ctx) {
  return ctx.materials.texture('parks_shopint', () => {
    const W = 1024, H = 256, c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    const R = rng(808);
    for (let k = 0; k < 4; k++) {
      const x0 = k * 256;
      const warm = [[244, 226, 200], [236, 232, 224], [250, 220, 180], [228, 236, 240]][k];
      const grd = g.createLinearGradient(0, 0, 0, H);
      grd.addColorStop(0, `rgb(${warm.map(v => v * 0.95 | 0)})`); grd.addColorStop(0.75, `rgb(${warm.map(v => v * 0.7 | 0)})`); grd.addColorStop(1, `rgb(${warm.map(v => v * 0.45 | 0)})`);
      g.fillStyle = grd; g.fillRect(x0, 0, 256, H);
      // ceiling lights
      for (let j = 0; j < 5; j++) { g.fillStyle = 'rgba(255,250,235,0.95)'; g.fillRect(x0 + 18 + j * 48, 8, 26, 5); }
      // shelves / racks / tables with products
      for (let j = 0; j < 7; j++) {
        const x = x0 + 10 + j * 35 + R.range(-4, 4), y = R.range(70, 120), w = R.range(18, 30), h = H - y - 30;
        if (k === 2 && j % 2) { g.fillStyle = 'rgba(80,60,40,0.85)'; g.fillRect(x, H - 70, w + 10, 6); g.fillRect(x + 4, H - 64, 3, 40); continue; } // cafe tables
        g.fillStyle = 'rgba(70,58,48,0.75)'; g.fillRect(x, y, 2, h);
        for (let r = 0; r < 4; r++) {
          const yy = y + r * h / 4;
          g.fillStyle = 'rgba(90,80,70,0.8)'; g.fillRect(x, yy, w, 2);
          for (let q = 0; q < 5; q++) { g.fillStyle = `hsl(${R.range(0, 360)},${R.range(20, 60)}%,${R.range(35, 75)}%)`; g.fillRect(x + 2 + q * w / 5, yy - R.range(8, 18), w / 5 - 2, R.range(8, 16)); }
        }
      }
      // floor
      g.fillStyle = 'rgba(60,45,35,0.5)'; g.fillRect(x0, H - 24, 256, 24);
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    return t;
  });
}

function buildShopfronts(ctx, parks, F, shops) {
  const M = ctx.materials;
  if (!M.factories.has('parks_shop_interior')) M.define('parks_shop_interior', () => new THREE.MeshBasicMaterial({ map: shopInteriorTexture(ctx), color: new THREE.Color(1.15, 1.1, 1.05) }));
  const glass = new MeshAcc(), frame = new MeshAcc(), inter = new MeshAcc();
  const V = (f, o, y) => [f.x + f.nx * o, y, f.z + f.nz * o];
  const R = rng(55);
  shops.forEach((sh, k) => {
    const variant = k % 4;
    const fa = F[sh.i0], fb = F[sh.i1];
    // interior backdrop (curved with the wall), floor & ceiling glow
    for (let i = sh.i0; i < sh.i1; i++) {
      const a = F[i], b = F[i + 1];
      const u0 = (variant + (i - sh.i0) / (sh.i1 - sh.i0)) / 4, u1 = (variant + (i + 1 - sh.i0) / (sh.i1 - sh.i0)) / 4;
      inter.quadAuto(V(b, -0.6, 6.0), V(a, -0.6, 6.0), V(a, -0.6, 9.7), V(b, -0.6, 9.7), [[u1, 0], [u0, 0], [u0, 1], [u1, 1]]);
      glass.quadAuto(V(a, -0.18, 6.0), V(b, -0.18, 6.0), V(b, -0.18, 9.2), V(a, -0.18, 9.2));
      frame.quadAuto(V(a, -0.6, 6.01), V(b, -0.6, 6.01), V(b, 0, 6.01), V(a, 0, 6.01), null, lin(0x8a7258));
      frame.quadAuto(V(a, 0, 9.7), V(b, 0, 9.7), V(b, -0.6, 9.7), V(a, -0.6, 9.7), null, lin(0x2a2724));
      // transom / sign band
      frame.quadAuto(V(b, -0.12, 9.2), V(a, -0.12, 9.2), V(a, -0.12, 9.7), V(b, -0.12, 9.7), null, lin(0x34302b));
      if ((i - sh.i0) % 3 === 0) {
        // mullion
        const m = V(a, -0.14, 0);
        frame.geometry(BOX, new THREE.Matrix4().makeTranslation(m[0], 7.6, m[2]).multiply(new THREE.Matrix4().makeScale(0.07, 3.2, 0.07)), lin(0x3c3a36));
      }
    }
    // jamb mullion at the end
    const e = V(fb, -0.14, 0);
    frame.geometry(BOX, new THREE.Matrix4().makeTranslation(e[0], 7.6, e[2]).multiply(new THREE.Matrix4().makeScale(0.08, 3.2, 0.08)), lin(0x3c3a36));
    // lights for the lighting system (warm spill from the shop)
    const mid = F[(sh.i0 + sh.i1) >> 1];
    if (ctx.lighting) ctx.lighting.addLight({ level: '2F', x: mid.x - mid.nx * 0.3, y: 9, z: mid.z - mid.nz * 0.3, color: 0xffd9a8, intensity: 1.2, range: 8, kind: 'spot' });
  });
  parks.root.add(glass.mesh(M.get('parks_glass'), { cast: false, receive: false, name: 'parks:shopglass' }));
  parks.root.add(frame.mesh(vcolMat(ctx, 'parks_shopframe', 0xffffff, 0.6), { cast: false, name: 'parks:shopframe' }));
  parks.root.add(inter.mesh(M.get('parks_shop_interior'), { cast: false, receive: false, name: 'parks:shopint' }));
}
const BOX = new THREE.BoxGeometry(1, 1, 1);

export function vcolMat(ctx, name, color = 0xffffff, rough = 0.7, metal = 0) {
  const M = ctx.materials;
  if (!M.factories.has(name)) M.define(name, () => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, vertexColors: true }));
  return M.get(name);
}
