// =============================================================================
// Detail passes that make surfaces read as lived-in Japanese public space:
//   serviceKit  ceiling services (sprinklers, smoke detectors, AC diffusers,
//               speakers, CCTV domes, hanging green 非常口 exit signs)
//   wallKit     wall programme: no blank wall run longer than ~8 m; hose
//               cabinets (消火栓), AEDs, staff doors, notice boards, coin lockers,
//               extinguisher recesses, vent grilles
//   wearKit     wear decals: traffic lanes, scuffs, gum, heel marks, grime at
//               combs and corners (dark alpha decals, merged per chunk)
// All of it is merged into the per-chunk GeoBatches (three extra materials in
// total: arch_kit, arch_exit, arch_wear).
// =============================================================================
import { CELL, EDGE } from '../world.js';
import { styleOf } from './styles.js';
import { rng, hash } from '../../core/rng.js';
import { cellUV, KIT, WEAR } from '../../render/textures/kitatlas.js';

const UV = (i) => { const [u0, v0, u1, v1] = cellUV(i); return [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]; };

// textured quad on a vertical face: centre p=(x,z), facing n=(nx,nz), width w, y0..y1
function vquad(b, mat, x, z, nx, nz, w, y0, y1, cell, off = 0.002, mirror = false) {
  const rx = nz, rz = -nx; // viewer's right
  const cx = x + nx * off, cz = z + nz * off, h = w / 2;
  const uv = UV(cell);
  b.quad(mat, [cx - rx * h, y0, cz - rz * h], [cx + rx * h, y0, cz + rz * h], [cx + rx * h, y1, cz + rz * h], [cx - rx * h, y1, cz - rz * h], { uv: mirror ? [uv[1], uv[0], uv[3], uv[2]] : uv });
}
// box attached to a wall: centre on the wall line at (x, z), projecting depth d along n
function wallBox(b, body, x, z, nx, nz, w, y0, y1, d) {
  const alongX = nz !== 0; // wall runs along x when the normal is ±z
  b.box(body, x + nx * d / 2, (y0 + y1) / 2, z + nz * d / 2, alongX ? w : d, y1 - y0, alongX ? d : w);
}

// ---------------------------------------------------------------------------
// ceiling services: called from the ceilings builder for each hall
// ---------------------------------------------------------------------------
export function serviceKit(K, c) {
  const { lv, sp, H, has, raise, bx0, bz0, bx1, bz1 } = c;
  if ((sp.kind === 'room' && sp.style !== 'department') || !has) return;
  const r = rng(hash('svc|' + sp.id));
  const y = (x, z) => H + raise(x, z) - 0.004;
  const ok = (x, z, m = 0.6) => has(x, z) && has(x - m, z) && has(x + m, z) && has(x, z - m) && has(x, z + m);
  const sq = (x, z, h, cell, flip) => {
    const b = K.B(lv, x, z);
    const uv = UV(cell);
    b.rectH('arch_kit', x - h, z - h, x + h, z + h, y(x, z), false, { uv: flip ? [uv[3], uv[2], uv[1], uv[0]] : uv });
  };
  // sprinkler heads every 3 m (offset grid), detectors every 9 m, diffusers every 7.2 m,
  // speakers every 12 m, CCTV domes every 18 m
  const stepScan = (pitch, off, fn) => {
    for (let x = Math.ceil((bx0 - off) / pitch) * pitch + off; x < bx1; x += pitch)
      for (let z = Math.ceil((bz0 - off) / pitch) * pitch + off; z < bz1; z += pitch) fn(x, z);
  };
  stepScan(3, 1.5, (x, z) => { if (ok(x, z, 0.3)) sq(x, z, 0.05, KIT.SPRINKLER); });
  stepScan(9, 4.5, (x, z) => { if (ok(x, z, 0.4)) sq(x + 0.4, z + 0.4, 0.075, KIT.DETECTOR); });
  stepScan(7.2, 3.6, (x, z) => { if (ok(x, z, 0.6) && r() < 0.8) sq(x - 0.5, z + 0.5, 0.3, KIT.DIFFUSER, false); });
  stepScan(12, 6, (x, z) => { if (ok(x, z, 0.4)) sq(x - 0.5, z - 0.5, 0.09, KIT.SPEAKER); });
  stepScan(18, 9, (x, z) => {
    if (!ok(x, z, 0.4)) return;
    const b = K.B(lv, x, z), yy = y(x, z);
    b.cylinder('steel_painted_white', x, z, 0.1, yy - 0.06, yy, 10, { caps: 1 });
    b.cylinder('rubber_black', x, z, 0.065, yy - 0.1, yy - 0.06, 10, { caps: 1 });
  });
  // hanging exit signs along corridors (double sided, on two rods)
  if (sp.kind === 'platform') return;
  const [rx0, rz0, rx1, rz1] = sp.rect || [bx0, bz0, bx1, bz1];
  const W = rx1 - rx0, D = rz1 - rz0, ax = W >= D ? 'x' : 'z';
  const long = Math.max(W, D);
  if (long < 16) return;
  const rel = H - K.y(lv);
  const mid = ax === 'x' ? (rz0 + rz1) / 2 : (rx0 + rx1) / 2;
  const a0 = ax === 'x' ? rx0 : rz0, a1 = ax === 'x' ? rx1 : rz1;
  const n = Math.max(1, Math.round(long / 28));
  for (let i = 0; i < n; i++) {
    const a = a0 + (i + 0.5) * long / n;
    const lat = mid + (r() - 0.5) * Math.min(4, (ax === 'x' ? D : W) * 0.3);
    const x = ax === 'x' ? a : lat, z = ax === 'x' ? lat : a;
    if (!ok(x, z, 0.5) || (raise(x, z) > 0)) continue;
    const drop = Math.min(0.55, Math.max(0.2, rel - 2.55));
    const yTop = H - drop, yBot = yTop - 0.24;
    const b = K.B(lv, x, z);
    const [nx, nz] = ax === 'x' ? [1, 0] : [0, 1];
    const w = 0.7;
    // body
    b.box('steel_painted_white', x, (yTop + yBot) / 2, z, ax === 'x' ? 0.06 : w, yTop - yBot, ax === 'x' ? w : 0.06);
    for (const s of [1, -1]) vquad(b, 'arch_exit', x, z, nx * s, nz * s, w - 0.04, yBot + 0.02, yTop - 0.02, KIT.EXIT, 0.032);
    // two suspension rods (8 mm) + ceiling plates
    for (const s of [-1, 1]) {
      const px = x + (ax === 'x' ? 0 : s * 0.28), pz = z + (ax === 'x' ? s * 0.28 : 0);
      b.box('steel_dark', px, (yTop + H) / 2, pz, 0.008, H - yTop, 0.008);
      b.box('steel_painted_white', px, H - 0.01, pz, 0.05, 0.02, 0.05);
    }
  }
}

// ---------------------------------------------------------------------------
// wall programme
// ---------------------------------------------------------------------------
const KITS = {
  // weights: hose, aed, door, notice, locker, exting, vent
  metro:   [3, 1, 3, 2, 0, 1, 1],
  nankai:  [2, 1, 3, 2, 3, 1, 1],
  nambawalk: [2, 1, 3, 1, 0, 1, 2],
  city:    [2, 1, 3, 1, 0, 1, 1],
  takashimaya: [2, 1, 3, 1, 0, 1, 1],
  link:    [2, 1, 3, 1, 0, 1, 2],
  default: [2, 1, 3, 1, 0, 1, 1],
};

export function wallKit(K) {
  const { world, L } = K;
  const stats = { items: 0, lockers: 0 };
  const near = (lv, x, z, rad, list, fn) => { for (const o of list) if (o.level === lv && Math.hypot(fn(o)[0] - x, fn(o)[1] - z) < rad) return true; return false; };
  const rampsNear = (lv, x, z, r) => L.ramps.some(rp => (rp.lower === lv || rp.upper === lv) && x > rp.rect[0] - r && x < rp.rect[2] + r && z > rp.rect[1] - r && z < rp.rect[3] + r);
  const gateNear = (lv, x, z) => L.gates.some(g => g.level === lv && Math.abs((g.axis === 'x' ? z : x) - g.at) < 3.5);
  const blocked = (lv, x, z, nx, nz) => {
    if (rampsNear(lv, x, z, 2.2) || gateNear(lv, x, z)) return true;
    if (near(lv, x, z, 2.5, L.pois, p => [p.x, p.z]) || near(lv, x, z, 2.2, Object.values(L.spawns), p => [p.x, p.z]) || near(lv, x, z, 3, L.exits, p => [p.x, p.z])) return true;
    for (const t of L.tactile || []) { if (t.level !== lv) continue; for (const q of t.pts) if (Math.hypot(q[0] - x, q[1] - z) < 2.2) return true; }
    for (const t of L.tracks) if (t.level === lv && x > t.rect[0] - 2 && x < t.rect[2] + 2 && z > t.rect[1] - 2 && z < t.rect[3] + 2) return true;
    // the tile in front must be plain walkable floor of a hall
    const c = K.cell(lv, x + nx * 0.6, z + nz * 0.6);
    if (c.t !== CELL.WALK || !c.sp || c.sp.outdoor || c.sp.kind === 'room') return true;
    const up = K.above(lv);
    if (up && K.isHole(up, x + nx * 0.6, z + nz * 0.6)) return true;
    return !K.clear(lv, x + nx * 0.8, z + nz * 0.8, 0.5);
  };
  // gather wall runs
  const runs = new Map();
  const add = (lv, e, nx, nz, si) => {
    const sp = L.spaces[si];
    if (!sp || sp.outdoor || sp.kind === 'room' || sp.kind === 'platform') return;
    const vert = e.ax === e.bx;
    const coord = vert ? e.ax : e.az;
    const a = vert ? Math.min(e.az, e.bz) : Math.min(e.ax, e.bx), b = vert ? Math.max(e.az, e.bz) : Math.max(e.ax, e.bx);
    const key = `${lv}|${nx},${nz}|${coord}|${si}`;
    let r = runs.get(key);
    if (!r) runs.set(key, r = { lv, nx, nz, coord, si, vert, iv: [] });
    r.iv.push([a, b]);
  };
  for (const lv of Object.keys(world.edges)) {
    for (const e of world.edges[lv]) {
      const spA = e.spaceA, spB = e.spaceB;
      if (e.kind === EDGE.WALL) {
        const si = e.nx < 0 || e.nz < 0 ? spA : e.nx > 0 || e.nz > 0 ? spB : spA;
        if (si >= 0) add(lv, e, e.nx, e.nz, si);
      } else if (e.kind === EDGE.PARTITION) {
        const vert = e.ax === e.bx;
        const sA = L.spaces[spA], sB = L.spaces[spB];
        if (sA && sB && (sA.kind === 'room' || sB.kind === 'room')) continue; // shop frontage: env dresses it
        if (spA >= 0) add(lv, e, vert ? -1 : 0, vert ? 0 : -1, spA);
        if (spB >= 0) add(lv, e, vert ? 1 : 0, vert ? 0 : 1, spB);
      }
    }
  }
  const types = ['hose', 'aed', 'door', 'notice', 'locker', 'exting', 'vent'];
  for (const run of runs.values()) {
    run.iv.sort((p, q) => p[0] - q[0]);
    // merge touching intervals
    const merged = [];
    for (const iv of run.iv) { const l = merged[merged.length - 1]; if (l && iv[0] <= l[1] + 0.01) l[1] = Math.max(l[1], iv[1]); else merged.push([iv[0], iv[1]]); }
    const sp = L.spaces[run.si];
    const weights = KITS[sp.zone] || KITS.default;
    const lv = run.lv, y0 = K.y(lv), H = sp.ceil;
    for (const [a, b] of merged) {
      const len = b - a;
      if (len < 6) continue;
      const cnt = Math.max(1, Math.floor(len / 7));
      const r = rng(hash(`wk|${lv}|${run.coord}|${a}|${run.nx}${run.nz}`));
      for (let i = 0; i < cnt; i++) {
        const t = a + (i + 0.5) * len / cnt + (r() - 0.5) * Math.min(2, len / cnt * 0.25);
        const x = run.vert ? run.coord : t, z = run.vert ? t : run.coord;
        if (t < a + 1.2 || t > b - 1.2) continue;
        if (blocked(lv, x, z, run.nx, run.nz)) continue;
        // weighted pick
        let tot = 0; for (const w of weights) tot += w;
        let u = r() * tot, k = 0; for (; k < weights.length - 1; k++) { u -= weights[k]; if (u < 0) break; }
        const type = types[k];
        const bt = K.B(lv, x, z);
        const { nx, nz } = run;
        if (type === 'hose') {
          wallBox(bt, 'steel_painted_grey', x, z, nx, nz, 0.78, y0 + 0.85, y0 + 1.85, 0.2);
          vquad(bt, 'arch_kit', x + nx * 0.2, z + nz * 0.2, nx, nz, 0.74, y0 + 0.88, y0 + 1.82, KIT.HOSE);
          // red beacon lamp above
          bt.box('rubber_black', x + nx * 0.06, y0 + 1.95, z + nz * 0.06, nz ? 0.1 : 0.1, 0.1, nz ? 0.1 : 0.1);
        } else if (type === 'aed') {
          wallBox(bt, 'steel_painted_white', x, z, nx, nz, 0.4, y0 + 1.15, y0 + 1.6, 0.18);
          vquad(bt, 'arch_kit', x + nx * 0.18, z + nz * 0.18, nx, nz, 0.36, y0 + 1.17, y0 + 1.58, KIT.AED);
        } else if (type === 'door') {
          if (H < 2.5) continue;
          wallBox(bt, 'steel_dark', x, z, nx, nz, 1.06, y0, y0 + 2.14, 0.05);
          vquad(bt, 'arch_kit', x + nx * 0.05, z + nz * 0.05, nx, nz, 0.96, y0 + 0.02, y0 + 2.1, KIT.DOOR);
        } else if (type === 'notice') {
          wallBox(bt, 'steel_dark', x, z, nx, nz, 1.06, y0 + 1.0, y0 + 2.0, 0.05);
          vquad(bt, 'arch_kit', x + nx * 0.05, z + nz * 0.05, nx, nz, 0.96, y0 + 1.03, y0 + 1.97, KIT.NOTICE);
        } else if (type === 'locker') {
          const w = 2.6, d = 0.55;
          if (len < w + 3) continue;
          const cx = x + nx * d / 2, cz = z + nz * d / 2;
          const hx = nz !== 0 ? w / 2 : d / 2, hz = nz !== 0 ? d / 2 : w / 2;
          bt.box('steel_painted_dark', cx, y0 + 0.9, cz, hx * 2, 1.8, hz * 2, 0, { faces: 'nsewt' });
          // 3 repeats of the 4x5 atlas tile across the bank
          for (let q = -1; q <= 1; q++) {
            const ox = (nz !== 0 ? q * 0.86 : 0), oz = (nz !== 0 ? 0 : q * 0.86);
            vquad(bt, 'arch_kit', x + nx * d + ox, z + nz * d + oz, nx, nz, 0.84, y0 + 0.05, y0 + 1.75, KIT.LOCKER);
          }
          world.addBox(lv, cx, cz, hx, hz, 0);
          K.reserve(lv, cx, cz, Math.max(hx, hz) + 0.2);
          stats.lockers++;
        } else if (type === 'exting') {
          wallBox(bt, 'steel_painted_white', x, z, nx, nz, 0.34, y0 + 0.9, y0 + 1.5, 0.12);
          vquad(bt, 'arch_kit', x + nx * 0.12, z + nz * 0.12, nx, nz, 0.3, y0 + 0.93, y0 + 1.47, KIT.EXTING);
        } else if (type === 'vent') {
          wallBox(bt, 'steel_painted_grey', x, z, nx, nz, 0.9, y0 + 0.3, y0 + 0.9, 0.06);
          vquad(bt, 'arch_kit', x + nx * 0.06, z + nz * 0.06, nx, nz, 0.84, y0 + 0.33, y0 + 0.87, KIT.VENT);
        }
        stats.items++;
      }
    }
  }
  return stats;
}

// ---------------------------------------------------------------------------
// wear decals
// ---------------------------------------------------------------------------
export function wearKit(K) {
  const { world, L } = K;
  let n = 0;
  const grid = (lv) => world.grids[lv];
  const floorOk = (lv, si, x, z) => { const c = K.cell(lv, x, z); return c.t === CELL.WALK && c.si === si; };
  const decal = (lv, x, z, size, cell, rot, op) => {
    const b = K.B(lv, x, z);
    const y = K.y(lv) + 0.0045;
    const h = size / 2, c = Math.cos(rot), s = Math.sin(rot);
    const P = (dx, dz) => [x + dx * c - dz * s, y, z + dx * s + dz * c];
    const [u0, v0, u1, v1] = cellUV(cell);
    b.quad('arch_wear', P(-h, h), P(h, h), P(h, -h), P(-h, -h), { uv: [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], ...(op ? {} : {}) });
    n++;
  };
  L.spaces.forEach((sp, si) => {
    if (!sp.rect || sp.outdoor || sp.kind === 'room' || sp.kind === 'platform') return;
    const lv = sp.level;
    const [x0, z0, x1, z1] = sp.rect;
    const W = x1 - x0, D = z1 - z0, area = W * D;
    if (area < 30) return;
    const r = rng(hash('wear|' + sp.id));
    const ax = W >= D ? 'x' : 'z';
    const long = Math.max(W, D), wide = Math.min(W, D);
    // traffic lane: broad grime strip along the corridor centre, tiled in 5 m blocks
    if (wide <= 16 && long >= 12) {
      const mid = ax === 'x' ? (z0 + z1) / 2 : (x0 + x1) / 2;
      const lw = Math.min(5, wide * 0.55);
      for (let a = ax === 'x' ? x0 : z0; a < (ax === 'x' ? x1 : z1) - 1; a += 5) {
        const a1 = Math.min(a + 5, ax === 'x' ? x1 : z1);
        const ca = (a + a1) / 2;
        const px = ax === 'x' ? ca : mid, pz = ax === 'x' ? mid : ca;
        if (![[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]].every(([ox, oz]) => floorOk(lv, si, px + ox * (ax === 'x' ? (a1 - a) / 2 - 0.1 : lw / 2 - 0.1), pz + oz * (ax === 'x' ? lw / 2 - 0.1 : (a1 - a) / 2 - 0.1)))) continue;
        const b = K.B(lv, px, pz);
        const y = K.y(lv) + 0.0042;
        const [u0, v0, u1, v1] = cellUV(WEAR.GRIME);
        const ha = (a1 - a) / 2, hl = lw / 2;
        const flip = r() < 0.5;
        const uvs = flip ? [[u1, v0], [u0, v0], [u0, v1], [u1, v1]] : [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
        if (ax === 'x') b.quad('arch_wear', [px - ha, y, pz + hl], [px + ha, y, pz + hl], [px + ha, y, pz - hl], [px - ha, y, pz - hl], { uv: uvs });
        else b.quad('arch_wear', [px - hl, y, pz + ha], [px + hl, y, pz + ha], [px + hl, y, pz - ha], [px - hl, y, pz - ha], { uv: uvs });
        n++;
      }
    }
    // scattered scuffs, gum, heel marks, splats
    const count = Math.min(220, Math.round(area / 28));
    for (let i = 0; i < count; i++) {
      const x = x0 + r() * W, z = z0 + r() * D;
      if (!floorOk(lv, si, x, z) || !floorOk(lv, si, x + 0.8, z) || !floorOk(lv, si, x - 0.8, z) || !floorOk(lv, si, x, z + 0.8) || !floorOk(lv, si, x, z - 0.8)) continue;
      const u = r();
      const cell = u < 0.3 ? WEAR.SCUFF : u < 0.55 ? WEAR.GUM : u < 0.75 ? WEAR.HEEL : u < 0.9 ? WEAR.SPLAT : WEAR.WIPE;
      decal(lv, x, z, 0.9 + r() * 1.3, cell, r() * Math.PI * 2);
    }
  });
  // escalator / stair run-offs: heel marks and grime where the crowd lands
  for (const rp of L.ramps) {
    const [x0, z0, x1, z1] = rp.rect;
    const ends = rp.axis === 'z' ? [[(x0 + x1) / 2, rp.up > 0 ? z0 - 0.9 : z1 + 0.9, rp.lower], [(x0 + x1) / 2, rp.up > 0 ? z1 + 0.9 : z0 - 0.9, rp.upper]]
      : [[rp.up > 0 ? x0 - 0.9 : x1 + 0.9, (z0 + z1) / 2, rp.lower], [rp.up > 0 ? x1 + 0.9 : x0 - 0.9, (z0 + z1) / 2, rp.upper]];
    for (const [x, z, lv] of ends) {
      const c = K.cell(lv, x, z);
      if (c.t !== CELL.WALK || !c.sp || c.sp.outdoor) continue;
      const hv = hash(`rw|${rp.id}|${lv}`);
      decal(lv, x, z, 2.2, WEAR.GRIME, (hv % 7) * 0.9);
      decal(lv, x + 0.3, z - 0.2, 1.4, WEAR.HEEL, (hv % 5) * 1.3);
    }
  }
  return n;
}
