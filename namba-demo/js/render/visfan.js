// 2D visibility fan over a level's walk grid (pure JS, no THREE; node-testable).
// A ray is stopped by SOLID cells and by wall (and optionally partition) edges.
import { CELL } from '../world/world.js?v=f150c03';

export const FAN = 720;
const COS = new Float32Array(FAN), SIN = new Float32Array(FAN);
for (let k = 0; k < FAN; k++) { const a = (k + 0.5) / FAN * Math.PI * 2; COS[k] = Math.cos(a); SIN[k] = Math.sin(a); }
const TAU = Math.PI * 2;

// per-cell flags: a wall on the +x / +z side of the cell
export function buildMasks(world, lv, partitionBlocks = true) {
  const g = world.grids[lv];
  const N = g.w * g.h;
  const bx = new Uint8Array(N), bz = new Uint8Array(N);
  for (const e of world.edges[lv] || []) {
    if (e.kind !== 'wall' && !(partitionBlocks && e.kind === 'partition')) continue;
    if (e.ax === e.bx) { const cx = e.ax - g.x0 - 1; for (let z = e.az; z < e.bz; z++) { const cz = z - g.z0; if (cx >= 0 && cx < g.w && cz >= 0 && cz < g.h) bx[cz * g.w + cx] = 1; } }
    else { const cz = e.az - g.z0 - 1; for (let x = e.ax; x < e.bx; x++) { const cx = x - g.x0; if (cx >= 0 && cx < g.w && cz >= 0 && cz < g.h) bz[cz * g.w + cx] = 1; } }
  }
  return { bx, bz };
}

// fills out[k] with the free distance along ray k (angle (k+.5)/FAN*2π, x→z).
// returns false when the origin is outside the grid / inside solid.
export function castFan(g, m, ox, oz, maxD, out) {
  const W = g.w, H = g.h, T = g.type, bx = m.bx, bz = m.bz;
  const px = ox - g.x0, pz = oz - g.z0;
  const cx0 = Math.floor(px), cz0 = Math.floor(pz);
  if (cx0 < 0 || cz0 < 0 || cx0 >= W || cz0 >= H) return false;
  if (T[cz0 * W + cx0] === CELL.SOLID) return false;
  for (let k = 0; k < FAN; k++) {
    const dx = COS[k], dz = SIN[k];
    let cx = cx0, cz = cz0;
    const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const tdx = dx !== 0 ? Math.abs(1 / dx) : 1e9, tdz = dz !== 0 ? Math.abs(1 / dz) : 1e9;
    let tmx = dx !== 0 ? (dx > 0 ? cx + 1 - px : px - cx) * tdx : 1e9;
    let tmz = dz !== 0 ? (dz > 0 ? cz + 1 - pz : pz - cz) * tdz : 1e9;
    let t = maxD;
    for (;;) {
      const i = cz * W + cx;
      let tn;
      if (tmx < tmz) {
        tn = tmx; if (tn >= maxD) break;
        if (sx > 0 ? bx[i] : (cx === 0 || bx[i - 1])) { t = tn; break; }
        cx += sx; tmx += tdx;
      } else {
        tn = tmz; if (tn >= maxD) break;
        if (sz > 0 ? bz[i] : (cz === 0 || bz[i - W])) { t = tn; break; }
        cz += sz; tmz += tdz;
      }
      if (cx < 0 || cz < 0 || cx >= W || cz >= H || T[cz * W + cx] === CELL.SOLID) { t = tn; break; }
    }
    out[k] = t;
  }
  return true;
}

// can the fan see the near edge of the disc (cx, cz, radius re) from (ox, oz)?
export function fanSees(fan, cx, cz, re, ox, oz) {
  const dx = cx - ox, dz = cz - oz;
  const d = Math.hypot(dx, dz);
  if (d <= re + 3) return true;
  const dmin = d - re;
  const half = Math.asin(Math.min(1, re / d)) + 1.5 / d;
  let a = Math.atan2(dz, dx); if (a < 0) a += TAU;
  const k0 = Math.floor((a - half) / TAU * FAN), k1 = Math.ceil((a + half) / TAU * FAN);
  for (let k = k0; k <= k1; k++) { const kk = ((k % FAN) + FAN) % FAN; if (fan[kk] >= dmin) return true; }
  return false;
}
