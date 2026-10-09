// =============================================================================
// Cell-based seating placement shared by restaurants (and anything else with tables).
//
// Tables are laid out on the 1 m walk grid so each chair stands on its own free cell (the crowd needs that), but every
// table gets a small visual offset, chairs a yaw wobble, and the generators choose shape / size / orientation at random,
// so the result never reads as a grid. RNG rule (see furnish.js): only S.r() and S.solid() answers steer the layout.
// =============================================================================
import { mix } from './kit.js?v=454ed73';
import { WOODS, FABRIC, chair, roundTable, squareTable, cup, glass, globeLamp } from './furnish.js?v=454ed73';

export class Cells {
  constructor(W, D) { this.W = W; this.D = Math.ceil(D); this.u = new Uint8Array(this.W * this.D); this.Dm = D; }
  mark(i0, i1, j0, j1) { for (let j = Math.max(0, j0); j <= Math.min(this.D - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(this.W - 1, i1); i++) this.u[j * this.W + i] = 1; }
  used(i, j) { return i < 0 || j < 0 || i >= this.W || j >= this.Dm || this.u[j * this.W + i] === 1; }
}

// A table `n` cells long with chairs on its two long sides. axis 'd': long side along depth (chairs left/right of it,
// i.e. at columns i-1 / i+1... see below), axis 'a': long side along the lateral axis.
//   o: { axis, n, round, wood, seatCol (or null = random), woodChair, sides (1|2), decor(ta, td, axis), lamp, spotsFacing }
// Returns true if placed.
export function tableSet(S, P, cells, i, j, o = {}) {
  const r = S.r, axis = o.axis || 'd', n = o.n || 1;
  const alongD = axis === 'd';
  // table cells: (i, j) .. (i + (alongD ? 0 : n-1), j + (alongD ? n-1 : 0)); chairs on the cells beside the long sides
  const ci0 = i, ci1 = i + (alongD ? 0 : n - 1), cj0 = j, cj1 = j + (alongD ? n - 1 : 0);
  const fi0 = ci0 - (alongD ? 1 : 0), fi1 = ci1 + (alongD ? 1 : 0), fj0 = cj0 - (alongD ? 0 : 1), fj1 = cj1 + (alongD ? 0 : 1);
  if (fi0 < 0 || fj0 < 1 || fi1 >= cells.W || fj1 >= cells.Dm - 0.5) return false;
  for (let jj = fj0; jj <= fj1; jj++) for (let ii = fi0; ii <= fi1; ii++) if (cells.used(ii, jj)) return false;
  const jx = (r() - 0.5) * 0.2, jz = (r() - 0.5) * 0.2;
  const ta = (ci0 + ci1 + 1) / 2 + jx, td = (cj0 + cj1 + 1) / 2 + jz;
  const len = 0.62 + (n - 1) * 0.58, wid = o.wide || 0.7;
  const tw = alongD ? wid : len, tdp = alongD ? len : wid;
  if (!S.solid(ta - tw / 2, ta + tw / 2, td - tdp / 2, td + tdp / 2, { pocket: 1 })) return false;
  const wood = o.wood || WOODS[Math.floor(r() * 4)];
  if (o.round && n === 1) roundTable(P, ta, td, 0.38, wood); else squareTable(P, ta, td, tw, tdp, wood);
  const seat = o.seatCol || FABRIC[Math.floor(r() * FABRIC.length)];
  const wooden = o.woodChair != null ? o.woodChair : r() < 0.6;
  const place = [];
  if (alongD) for (let k = 0; k < n; k++) { const z = cj0 + k + 0.5; place.push([ci0 - 0.5, z, 1, 0], [ci0 + 1.5, z, -1, 0]); }
  else for (let k = 0; k < n; k++) { const x = ci0 + k + 0.5; place.push([x, cj0 - 0.5, 0, 1], [x, cj0 + 1.5, 0, -1]); }
  const sides = o.sides || 2;
  place.forEach(([ca, cd, fa, fd], q) => {
    if (sides === 1 && q % 2) return;
    chair(P, ca + (r() - 0.5) * 0.1, cd + (r() - 0.5) * 0.1, fa, fd, { wood: wooden, frame: wooden ? wood : [0.16, 0.16, 0.17], seat, jit: (r() - 0.5) * 0.55 });
    S.spot('seat', ca, cd, fa, fd, { h: 0.495 });
  });
  if (o.decor) o.decor(ta, td, axis, tw, tdp);
  else {
    if (r() < 0.6) cup(P, ta - 0.08, 0.74, td - 0.06, [0.95, 0.95, 0.93]);
    if (r() < 0.3) glass(P, ta + 0.12, 0.74, td + 0.08);
  }
  if (o.lamp && r() < o.lamp) globeLamp(P, ta, td, 2.05 + r() * 0.15, S.ceil, 0.12);
  cells.mark(fi0 - (alongD ? 0 : 1), fi1 + (alongD ? 0 : 1), fj0 - (alongD ? 1 : 0), fj1 + (alongD ? 1 : 0));
  return true;
}

// Scatter up to `count` table sets over the rectangle [i0..i1] x [j0..j1] (cells). make(i, j) -> options or null.
export function scatter(S, P, cells, count, i0, i1, j0, j1, make, tries = 70) {
  const r = S.r; let placed = 0;
  for (let t = 0; t < tries && placed < count; t++) {
    const i = i0 + Math.floor(r() * Math.max(1, i1 - i0 + 1)), j = j0 + Math.floor(r() * Math.max(1, j1 - j0 + 1));
    const o = make(i, j);
    if (o && tableSet(S, P, cells, i, j, o)) placed++;
  }
  return placed;
}
export { mix };
