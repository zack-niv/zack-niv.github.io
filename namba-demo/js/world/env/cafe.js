// =============================================================================
// Café interiors (v2): a real service counter (pastry case, register, espresso machine, back bar, menu boards),
// mixed seating (window bar stools, 2-tops, a banquette run, a sofa corner, sometimes a communal table), plants,
// warm pendants and a little clutter. Deep slots get a back wall with a kitchen door instead of a cavern.
//
// Layout is seeded (S.r) and cell based: tables sit on the 1 m walk grid so that every seat spot lies on a walkable
// cell, but positions, shapes, orientation and chair wobble vary, and whole modules (bar / banquette / sofa corner /
// communal table) come and go per shop. Collision for wall furniture is a thin slab at the wall so that the seat cell
// itself stays walkable (the crowd sits there).
//
// Contract: calls S.service('barista', order, staff)  ->  ctx.counters (see notes/v2-shops.md).
// =============================================================================
import { mix, WHITE } from './kit.js?v=5f764cf';
import { MENU } from './catalog.js?v=5f764cf';
import { hash } from '../../core/rng.js?v=5f764cf';
import { foodItem, aFrame, queuePoints } from './shopbuild.js?v=5f764cf';
import { WOOD, WOODS, FABRIC, GREENS, POTS, frameOf, obox, chair, barStool, sofa, armchair, cushion, roundTable, squareTable, cup, glass, laptop, book, plantPot, hangingPlant, pendant, globeLamp } from './furnish.js?v=5f764cf';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Seal the unused depth of a deep slot: solid fill + a finished back wall (wainscot, rail, cove) + a staff door.
// Returns the usable depth. Never goes shallower than the directory's centre cell + 2 (it must stay reachable).
export function backWall(S, P, Dm, o = {}) {
  const W = S.W, h = S.ceil - 0.02, sealed = S.D - Dm >= 1;
  let base = Dm - 0.02;
  if (sealed) {
    S.solid(0, W, Dm, S.D, { force: true });
    const wc = S.wall, br = hexLike(S.st.bg);
    P.box('env_matte', 0, W, 0, h, Dm, Dm + 0.1, wc, 'nsewt');
    P.qd('env_matte', 0, W, 0.08, 0.9, Dm - 0.004, -1, mix(wc, br, 0.3));
    P.box('env_matte', 0, W, 0.9, 0.94, Dm - 0.04, Dm, mix(br, [0, 0, 0], 0.35), 'nsewt');
    P.qd('env_matte', 0, W, h - 0.28, h - 0.16, Dm - 0.004, -1, br);
    P.qd('env_matte', 0, W, 0, 0.08, Dm - 0.004, -1, [0.15, 0.15, 0.15]);
    base = Dm;
  }
  const da = o.doorA != null ? o.doorA : clamp(W * (0.62 + 0.2 * (S.r() - 0.5)), 1.2, W - 1.2);
  if (o.door !== false) {
    // swing door with a window + kick plate + sign
    P.box('env_wood', da - 0.5, da + 0.5, 0, 2.12, base - 0.06, base, [0.3, 0.2, 0.13], 'nsewt');
    P.box('env_wood', da - 0.43, da + 0.43, 0.06, 2.06, base - 0.075, base - 0.06, WOOD.walnut, 'nsewt');
    P.qd('env_glow', da - 0.12, da + 0.12, 1.45, 1.75, base - 0.078, -1, [1.2, 1.1, 0.9]);
    P.box('env_metal', da + 0.3, da + 0.36, 0.95, 1.05, base - 0.1, base - 0.075, [0.8, 0.8, 0.82], 'nsewt');
    P.box('env_metal', da - 0.43, da + 0.43, 0.06, 0.3, base - 0.08, base - 0.075, [0.7, 0.72, 0.74], 'nsewt');
    const lr = S.R.label('STAFF ONLY  関係者以外立入禁止', '#ffffff', '#333333', 384, 40);
    P.tq(lr, da - 0.35, da + 0.35, 2.2, 2.29, base - 0.082, -1);
  }
  return da;
}
function hexLike(h) { return typeof h === 'string' ? [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255] : h; }

// ---------------------------------------------------------------------------------------------------------------------
export function cafeInterior(S, c) {
  const P = S.inner, W = S.W, r = S.r, R = S.R, ceil = S.ceil;
  const kind = S.b.cat;                              // 'cafe' (kissaten / stand have their own templates)
  // ---- seeded character -------------------------------------------------------------------------------------------
  const wood = WOODS[Math.floor(r() * 4)], wood2 = WOODS[Math.floor(r() * 4)];
  const side = r() < 0.5 ? 1 : -1;                   // counter wall: +1 right (a = W), -1 left (a = 0)
  const fab = [FABRIC[Math.floor(r() * FABRIC.length)], FABRIC[Math.floor(r() * FABRIC.length)], FABRIC[Math.floor(r() * FABRIC.length)]];
  const topCol = r() < 0.5 ? [0.92, 0.91, 0.88] : [0.22, 0.22, 0.24];
  const wantComm = r() < 0.55, wantSlats = r() < 0.6;
  const plantSeed = Math.floor(r() * 1000);
  const wide = W >= 7, narrow = W < 6;
  // ---- depth: no caverns ------------------------------------------------------------------------------------------
  let Dm = S.D;
  if (S.D > 14) Dm = clamp(Math.max(S.cj + 2, narrow ? 14 : 12 + Math.floor(r() * 3)), 8, S.D);
  // critic v2: big deep cafés (Sunny Side: 11 x 25 m) still read as a hall at 12-14 m. Seal them at 10-11 m with a
  // kitchen behind the back wall; the directory's centre cell (only a reachability anchor for the shop template)
  // moves in front of the new back wall so every later solid() keeps its connectivity test.
  if (S.D > 14 && W >= 9) {
    const want = 10 + Math.floor(r() * 2);
    if (want < Dm) {
      Dm = want;
      if (S.cj > Dm - 2 && !S.replay) {
        const old = S.cj * W + S.ci, R0 = S.occ[old];
        S.occ[old] = 0;
        S.cj = Math.floor(Dm) - 2;
        S.occ[S.cj * W + S.ci] = R0;
      } else if (S.cj > Dm - 2) S.cj = Math.floor(Dm) - 2;
    }
  }
  S.backD = Dm;                                   // featured extras (coffee_chain logo...) hang on the real back wall
  const doorBack = backWall(S, P, Dm, { sealedOnly: false });
  // a kitchen pass-through in the back wall (counter side): warm-lit hatch, steel sill, plates waiting, heat lamps
  if (S.D - Dm >= 1 && W >= 9) {
    const ka0 = side > 0 ? W - 3.6 : 1.2, ka1 = ka0 + 2.4;
    if (Math.abs((ka0 + ka1) / 2 - doorBack) > 1.9) {
      const kd = Dm - 0.006;
      P.qd('env_glow', ka0, ka1, 1.08, 1.86, kd, -1, [0.62, 0.5, 0.36]);                           // the lit kitchen behind
      P.qd('env_matte', ka0 + 0.1, ka1 - 0.1, 1.5, 1.86, kd - 0.002, -1, [0.32, 0.3, 0.28]);          // tiled back of the kitchen
      for (const t of [0.35, 0.9, 1.5, 2.05]) P.box('env_metal', ka0 + t - 0.03, ka0 + t + 0.03, 1.1, 1.62, kd - 0.06, kd - 0.004, [0.7, 0.71, 0.73], 'nsewt');  // shelf posts
      P.box('env_metal', ka0 + 0.1, ka1 - 0.1, 1.42, 1.45, kd - 0.3, kd - 0.004, [0.72, 0.73, 0.75], 'nsewt');               // upper shelf
      P.box('env_wood', ka0 - 0.08, ka1 + 0.08, 1.86, 1.94, kd - 0.08, kd, wood2, 'nsewt');                                // frame
      for (const e of [ka0 - 0.08, ka1]) P.box('env_wood', e, e + 0.08, 1.0, 1.94, kd - 0.08, kd, wood2, 'nsewt');
      P.box('env_metal', ka0 - 0.1, ka1 + 0.1, 1.0, 1.06, kd - 0.38, kd, [0.78, 0.79, 0.81], 'nsewt');                     // steel sill (the pass)
      for (let k = 0; k < 3; k++) { const a = ka0 + 0.45 + k * 0.75; P.cyl('env_gloss', a, 1.06, 1.08, kd - 0.2, 0.13, [0.96, 0.95, 0.92]); foodItem(S, P, ['toast', 'cake', 'parfait'][k], a, 1.08, kd - 0.2, 0.08); }
      for (let k = 0; k < 2; k++) P.box('env_glow', ka0 + 0.5 + k * 1.2, ka0 + 0.9 + k * 1.2, 1.78, 1.82, kd - 0.3, kd - 0.1, [2.2, 1.4, 0.7], 'nsewt');   // heat lamps
      const kl = R.label('KITCHEN  キッチン', '#f4efe2', '#2f2a26', 256, 40);
      P.tq(kl, ka0 + 0.6, ka1 - 0.6, 1.98, 2.1, kd - 0.002, -1);
    }
  }
  // ---- cell bookkeeping (own array: never read S.free in a template) ---------------------------------------------
  const used = new Uint8Array(W * Math.ceil(Dm));
  const mark = (i0, i1, j0, j1) => { for (let j = Math.max(0, j0); j <= Math.min(Math.ceil(Dm) - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(W - 1, i1); i++) used[j * W + i] = 1; };
  const isUsed = (i, j) => i < 0 || j < 0 || i >= W || j >= Dm || used[j * W + i] === 1;
  const [dA0, dA1] = S.doorCells || [S.doorA0, S.doorA1];
  mark(dA0 - 1, dA1, 0, 2);                           // door lane stays clear
  // lateral helpers (counter space): u = distance from the counter wall
  const cu = (u) => (side > 0 ? W - u : u);
  const ab = (u0, u1) => [Math.min(cu(u0), cu(u1)), Math.max(cu(u0), cu(u1))];
  const bx = (mat, u0, u1, y0, y1, d0, d1, col, faces) => { const [a0, a1] = ab(u0, u1); P.box(mat, a0, a1, y0, y1, d0, d1, col, faces); };

  // ===== 1. service counter ==========================================================================================
  const d0 = 2.0 + (wide ? 0.5 : 0);
  const cLen = clamp(Dm * 0.4, 3.4, 6.4);
  const d1 = Math.min(Dm - 3.5, d0 + cLen);
  const dOrd = Math.floor(d0 + 1.8) + 0.5;           // order row (cell centre) = register row
  let counterOK = false;
  const [sa0, sa1] = ab(0, 2);
  if (d1 - d0 >= 3 && S.solid(sa0, sa1, d0, d1, { pocket: 10 })) {
    counterOK = true;
    const dark = mix(wood, [0, 0, 0], 0.45);
    // back bar (staff side): cabinet, stone top, espresso machine, grinder, sink, shelves with cups and beans
    bx('env_wood', 0, 0.5, 0, 0.9, d0, d1, dark);
    bx('env_gloss', 0, 0.52, 0.9, 0.94, d0, d1, topCol);
    const dm = dOrd + 0.9 + (d1 - dOrd - 1.5) * 0.35;
    bx('env_metal', 0.06, 0.46, 0.94, 1.0, dm - 0.5, dm + 0.5, [0.55, 0.56, 0.58]);                 // drip tray
    bx('env_metal', 0.08, 0.46, 1.0, 1.4, dm - 0.48, dm + 0.48, [0.78, 0.79, 0.82]);                // boiler body
    bx('env_metal', 0.08, 0.46, 1.4, 1.46, dm - 0.5, dm + 0.5, [0.35, 0.36, 0.38]);                 // cup warmer rail
    for (const k of [-0.3, 0.3]) { bx('env_matte', 0.5, 0.58, 1.12, 1.2, dm + k - 0.04, dm + k + 0.04, [0.08, 0.08, 0.09]); bx('env_matte', 0.56, 0.7, 1.14, 1.18, dm + k - 0.02, dm + k + 0.02, [0.08, 0.08, 0.09]); }   // group heads + portafilters
    bx('env_metal', 0.08, 0.14, 1.0, 1.25, dm + 0.46, dm + 0.52, [0.8, 0.8, 0.82]);                   // steam wand
    bx('env_matte', 0.1, 0.34, 0.94, 1.32, dm + 0.7, dm + 1.0, [0.1, 0.1, 0.11]);                   // grinder
    P.geo('env_glass_case', 'sphere', cu(0.22), 1.42, dm + 0.85, 0, 0.1, WHITE);
    bx('env_matte', 0.12, 0.3, 0.94, 1.0, dm - 1.0, dm - 0.62, [0.75, 0.76, 0.78]);                 // sink
    // wall shelves: cups, jars of beans, bags
    const shelfYs = ceil >= 3.4 ? [1.38, 1.7] : [1.4];
    for (const y of shelfYs) {
      bx('env_wood', 0, 0.26, y, y + 0.03, d0 + 0.1, d1 - 0.1, wood2);
      for (let d = d0 + 0.25; d < d1 - 0.25; d += 0.22 + r() * 0.1) {
        const t = r();
        if (t < 0.4) P.cyl('env_gloss', cu(0.13), y + 0.03, y + 0.11, d, 0.04, [0.96, 0.95, 0.9], 'cyl6');
        else if (t < 0.7) { P.cyl('env_glass_case', cu(0.13), y + 0.03, y + 0.2, d, 0.065, WHITE, 'cylOpen'); P.cyl('env_matte', cu(0.13), y + 0.03, y + 0.15, d, 0.058, [0.3, 0.17, 0.08], 'cyl6'); }
        else bx('env_matte', 0.06, 0.2, y + 0.03, y + 0.23, d - 0.07, d + 0.07, [[0.8, 0.7, 0.55], [0.3, 0.45, 0.32], [0.62, 0.3, 0.22], [0.18, 0.18, 0.2]][Math.floor(r() * 4)]);
      }
    }
    // menu boards on the wall above the back bar (three, framed in wood)
    const my1 = Math.min(2.85, ceil - 0.3), my0 = my1 - 0.95, wa = cu(0.03), face = side > 0 ? -1 : 1;
    const dm0 = d0 + 0.15;
    const boards = [R.chalk('CAFE MENU', MENU.cafe, hash(S.b.slot) + 1), R.chalk('おすすめ', MENU.cafe.slice().reverse(), hash(S.b.slot) + 5), R.photoMenu('ドリンク & スイーツ', MENU.cafe, ['cake', 'coffee', 'toast', 'parfait'], S.st.accent)];
    const bws = [0.68, 0.68, 0.7];
    let bd = dm0;
    boards.forEach((reg, k) => {
      if (bd + bws[k] > d1 - 0.1) return;
      P.box('env_wood', side > 0 ? W - 0.05 : 0, side > 0 ? W : 0.05, my0 - 0.03, my1 + 0.03, bd - 0.03, bd + bws[k] + 0.03, wood2, 'nsewt');
      P.ta(reg, bd, bd + bws[k], my0, my1, side > 0 ? W - 0.058 : 0.058, face);
      bd += bws[k] + 0.12;
    });
    // counter body (customer side), stone top, toe kick
    bx('env_wood', 1.3, 1.9, 0, 1.0, d0, d1, wood);
    bx('env_matte', 1.28, 1.9, 0, 0.1, d0 - 0.02, d1 + 0.02, [0.12, 0.1, 0.09]);
    bx('env_gloss', 1.24, 1.96, 1.0, 1.04, d0 - 0.02, d1 + 0.02, topCol);
    // pastry case at the entrance end
    const pc1 = dOrd - 0.5;
    bx('env_glass_case', 1.34, 1.86, 1.04, 1.5, d0 + 0.04, pc1, WHITE);
    bx('env_metal', 1.3, 1.9, 1.5, 1.54, d0, pc1 + 0.04, [0.3, 0.3, 0.32]);
    { const [a0, a1] = ab(1.36, 1.84); P.qh('env_glow', a0, a1, d0 + 0.06, pc1 - 0.02, 1.495, false, [2.1, 1.9, 1.6]); }
    const n = Math.max(2, Math.floor((pc1 - d0) / 0.34));
    for (let k = 0; k < n; k++) {
      const dd = d0 + 0.2 + k * (pc1 - d0 - 0.28) / Math.max(1, n - 1);
      foodItem(S, P, ['cake', 'toast', 'cake', 'bread', 'parfait'][k % 5], cu(1.6), 1.06, dd, 0.085);
      foodItem(S, P, ['bread', 'cake', 'parfait'][k % 3], cu(1.6), 1.27, dd, 0.075);
      bx('env_metal', 1.34, 1.86, 1.25, 1.265, dd - 0.15, dd + 0.15, [0.8, 0.8, 0.82]);
    }
    // register + tablet, tip jar, cups, napkins
    bx('env_matte', 1.4, 1.8, 1.04, 1.1, dOrd - 0.34, dOrd + 0.34, [0.12, 0.12, 0.13]);
    bx('env_glow', 1.52, 1.78, 1.12, 1.4, dOrd - 0.2, dOrd - 0.19, [0.55, 0.85, 1.25]);
    bx('env_matte', 1.5, 1.8, 1.1, 1.42, dOrd - 0.22, dOrd - 0.2, [0.1, 0.1, 0.11]);
    P.cyl('env_glass_case', cu(1.7), 1.04, 1.16, dOrd + 0.52, 0.045, WHITE, 'cylOpen');
    for (let k = 0; k < 4; k++) P.cyl('env_gloss', cu(1.5), 1.04 + k * 0.045, 1.04 + k * 0.045 + 0.1, d1 - 0.45, 0.04, [0.96, 0.96, 0.94], 'cyl6');
    const toy = d1 - 1.1 - (r() < 0.5 ? 0.3 : 0);
    if (toy > dOrd + 0.9) { P.cyl('env_matte', cu(1.6), 1.04, 1.1, toy, 0.2, [0.9, 0.9, 0.88]); foodItem(S, P, 'cake', cu(1.6), 1.1, toy, 0.1); P.cyl('env_glass_case', cu(1.6), 1.1, 1.3, toy, 0.19, WHITE, 'cylOpen'); }
    // hanging ORDER placard over the register (faces the customers)
    {
      const [pa] = ab(1.6, 1.6), pf = side > 0 ? -1 : 1;
      P.box('env_metal', pa - 0.006, pa + 0.006, 1.98, ceil, dOrd - 0.4, dOrd - 0.388, [0.2, 0.2, 0.2], 'nsewt');
      P.box('env_metal', pa - 0.006, pa + 0.006, 1.98, ceil, dOrd + 0.388, dOrd + 0.4, [0.2, 0.2, 0.2], 'nsewt');
      P.box('env_wood', pa - 0.02, pa + 0.02, 1.8, 1.99, dOrd - 0.46, dOrd + 0.46, wood2, 'nsewt');
      P.ta(R.litLabel('ご注文はこちら  ORDER HERE', '#2f4f3a', '#f4efe2', 320, 60), dOrd - 0.42, dOrd + 0.42, 1.83, 1.96, pa + (side > 0 ? -0.021 : 0.021), pf);
    }
    // pendants over the counter
    for (let d = d0 + 0.7; d < d1; d += 1.5) pendant(P, cu(1.6), d, 2.0 + r() * 0.12, ceil, [0.14, 0.14, 0.15], 0.17);
    // contract + crowd
    S.service('barista', [cu(2.5), dOrd], [cu(0.95), dOrd]);
    S.spot('browse', cu(2.5), dOrd - 1, 0, 1); S.spot('browse', cu(2.5), dOrd - 2, 0, 1);
    mark(Math.min(sa0, sa1) | 0, Math.ceil(Math.max(sa0, sa1)) - 1, Math.floor(d0) - 1, Math.ceil(d1) + 1);
    // the order column (u 2..3) and its queue
    const oc = Math.floor(cu(2.5));
    mark(oc, oc, Math.floor(d0) - 2, Math.ceil(d1) + 1);
  } else {
    S.service('barista', [W / 2, Math.min(4.5, Dm - 1.5)], [W / 2, Math.min(5.5, Dm - 0.7)]);
  }

  // ===== 2. window bar (glass front) =================================================================================
  if (c.front === 'glass' && wide) {
    const panes = [[S.doorA0, dA0], [dA1, S.doorA1]].filter(([a, b]) => b - a >= 2);
    for (const [p0, p1] of panes) {
      const a0 = p0 + 0.15, a1 = p1 - 0.15;
      if (!S.solid(a0, a1, 0.58, 1.0, { pocket: 2 })) continue;
      P.box('env_wood', a0, a1, 1.02, 1.07, 0.55, 1.02, wood, 'nsewt');
      for (let a = a0 + 0.3; a < a1 - 0.1; a += 1.2) P.box('env_metal', a - 0.015, a + 0.015, 0.2, 1.02, 0.6, 0.64, [0.18, 0.18, 0.2], 'nsewt');
      for (let a = p0 + 0.6; a < p1 - 0.3; a += 0.75) {
        barStool(P, a + (r() - 0.5) * 0.08, 1.42, mix(wood2, [0, 0, 0], 0.2));
        S.spot('seat', a, 1.42, 0, -1, { h: 0.82 });
        if (r() < 0.35) cup(P, a, 1.07, 0.8);
      }
      if (r() < 0.6) laptop(P, (a0 + a1) / 2, 1.07, 0.78, 0);
      mark(Math.floor(p0), Math.ceil(p1) - 1, 0, 1);
    }
  }

  // ===== 3. banquette run (opposite wall) ===========================================================================
  const bside = -side;                                  // wall opposite the counter: lateral sign
  const bc = (u) => (bside > 0 ? W - u : u);             // distance u from that wall
  const bAb = (u0, u1) => [Math.min(bc(u0), bc(u1)), Math.max(bc(u0), bc(u1))];
  if (!narrow) {
    const b0 = 3, b1 = Math.floor(Math.min(Dm - 4, 3 + 2 * Math.floor((Dm - 7) / 2)));
    const bface = bside > 0 ? -1 : 1;                    // seat faces away from the wall
    let any = false;
    for (let j = b0; j + 1 <= b1; j += 2) {
      if (isUsed(bside > 0 ? W - 1 : 0, j) || isUsed(bside > 0 ? W - 1 : 0, j + 1)) continue;
      // thin collision slab at the wall (backrest) + table; seat cells stay walkable
      const [s0, s1] = bAb(0, 0.2);
      if (!S.solid(s0, s1, j, j + 2, { pocket: 2 })) continue;
      const [t0, t1] = bAb(1.05, 1.65);
      if (!S.solid(t0, t1, j + 0.4, j + 1.6, { pocket: 2 })) continue;
      any = true;
      const col = fab[(j >> 1) % 3];
      const F = frameOf(bc(0.28), j + 1, bface, 0);     // bench: facing the room
      // bench body + backrest + cushions
      const [bb0, bb1] = bAb(0, 0.55);
      P.box('env_wood', bb0, bb1, 0.1, 0.42, j + 0.04, j + 1.96, mix(wood2, [0, 0, 0], 0.25), 'nsewt');
      const [bk0, bk1] = bAb(0.4, 0.55);
      P.box('env_matte', bk0, bk1, 0.42, 1.0, j + 0.04, j + 1.96, col, 'nsewt');
      for (let k = 0; k < 2; k++) {
        const [c0, c1] = bAb(0.04, 0.42);
        P.box('env_matte', c0, c1, 0.42, 0.52, j + 0.06 + k * 0.95, j + 0.96 + k * 0.95, mix(col, [1, 1, 1], 0.1), 'nsewt');
      }
      void F;
      // table (4-top along the bench) + chairs on the room side
      const ta = bc(1.35);
      P.box('env_wood', Math.min(bc(1.0), bc(1.7)), Math.max(bc(1.0), bc(1.7)), 0.7, 0.74, j + 0.4, j + 1.6, wood, 'nsewt');
      P.cyl('env_metal', ta, 0, 0.7, j + 1.0, 0.03, [0.16, 0.16, 0.17], 'cyl6');
      P.box('env_metal', ta - 0.2, ta + 0.2, 0, 0.03, j + 0.8, j + 1.2, [0.16, 0.16, 0.17], 'nsewt');
      for (let k = 0; k < 2; k++) {
        const cd = j + 0.5 + k, ca = bc(2.1);
        chair(P, ca + (r() - 0.5) * 0.06, cd + (r() - 0.5) * 0.06, -bface, 0, { wood: true, frame: wood2, seat: mix(col, [0, 0, 0], 0.1), jit: (r() - 0.5) * 0.5 });
        S.spot('seat', ca, cd, -bface, 0, { h: 0.495 });
        S.spot('seat', bc(0.5), cd, bface, 0, { h: 0.46 });
        if (r() < 0.55) cup(P, ta + (r() - 0.5) * 0.1, 0.74, cd + (r() - 0.5) * 0.1);
      }
      if (r() < 0.5) globeLamp(P, ta, j + 1.0, 2.1, ceil, 0.12);
      mark(bside > 0 ? W - 3 : 0, bside > 0 ? W - 1 : 2, j - 0, j + 1);
    }
    // slat panel + a pair of posters above the banquette
    if (any) {
      const [w0] = bAb(0.02, 0.02);
      const wface = bside > 0 ? -1 : 1;
      const pk = ['autumn', 'travel', 'cosme', 'museum', 'concert'];
      const k1 = pk[Math.floor(r() * pk.length)], k2 = pk[Math.floor(r() * pk.length)];
      const wa = bside > 0 ? W - 0.03 : 0.03;
      if (wantSlats) for (let d = b0 + 0.1; d < b1 + 0.9; d += 0.14) P.box('env_wood', Math.min(bc(0.01), bc(0.06)), Math.max(bc(0.01), bc(0.06)), 1.05, 2.5, d, d + 0.07, wood2, 'nsewt');
      else {
        for (const [dk, kk] of [[b0 + 0.3, k1], [b0 + 1.5 + (b1 - b0) * 0.4, k2]]) {
          if (dk + 0.6 > b1 + 1) continue;
          const h = 0.9, w = 0.6;
          P.box('env_wood', Math.min(bc(0.01), bc(0.04)), Math.max(bc(0.01), bc(0.04)), 1.25 - 0.03, 1.25 + h + 0.03, dk - 0.03, dk + w + 0.03, [0.15, 0.12, 0.1], 'nsewt');
          P.ta(R.poster(kk, true), dk, dk + w, 1.25, 1.25 + h, bside > 0 ? W - 0.045 : 0.045, wface);
        }
      }
      void wa; void w0;
    }
  }

  // ===== 4. sofa corner (back, away from the counter) ================================================================
  const dB = Math.floor(Dm);
  if (W >= 5) {
    const lc0 = bside > 0 ? W - 3 : 0;                      // 3 cells wide at the back corner on the banquette side
    if (!isUsed(lc0, dB - 1) && !isUsed(lc0 + 2, dB - 1) && !isUsed(lc0 + 1, dB - 3)) {
      const slab = S.solid(lc0 - 0.0, lc0 + 3, dB - 0.2, dB, { pocket: 2 });
      if (slab) {
        const sx = lc0 + 1.5, big = fab[0];
        sofa(P, sx, dB - 0.5, 0, -1, 2.7, big);
        if (S.solid(sx - 0.45, sx + 0.45, dB - 1.8, dB - 1.2, { pocket: 2 })) {
          P.box('env_wood', sx - 0.45, sx + 0.45, 0.34, 0.38, dB - 1.76, dB - 1.24, wood, 'nsewt');
          for (const e of [-0.38, 0.38]) for (const f of [-0.2, 0.2]) P.box('env_wood', sx + e - 0.02, sx + e + 0.02, 0, 0.34, dB - 1.5 + f - 0.02, dB - 1.5 + f + 0.02, WOOD.dark, 'nsewt');
          cup(P, sx - 0.15, 0.38, dB - 1.55); book(P, sx + 0.15, 0.38, dB - 1.5, 0.4, [0.7, 0.3, 0.25]); book(P, sx + 0.15, 0.41, dB - 1.5, -0.2, [0.2, 0.3, 0.45], 0.17, 0.23);
        }
        armchair(P, sx + (bside > 0 ? -1.4 : 1.4) * 0 + 0.0, dB - 2.55, 0, 1, fab[1]);
        cushion(P, sx - 0.8, dB - 0.62, 0.52, 0.2, fab[2]); cushion(P, sx + 0.85, dB - 0.62, 0.52, -0.25, fab[1]);
        for (const dx of [-0.9, 0, 0.9]) S.spot('seat', sx + dx * 0.9 + (dx === 0 ? 0 : 0), dB - 0.5, 0, -1, { h: 0.46 });
        S.spot('seat', sx, dB - 2.5, 0, 1, { h: 0.46 });
        pendant(P, sx, dB - 1.5, 2.0, ceil, [0.76, 0.5, 0.2], 0.22);
        { const pa = bside > 0 ? lc0 - 0.4 : lc0 + 3.4; if (S.solid(pa - 0.28, pa + 0.28, dB - 0.9, dB - 0.35, { pocket: 2 })) plantPot(P, pa, dB - 0.6, 0.42, 1.1, plantSeed, POTS[plantSeed % 4], GREENS[plantSeed % 4]); }
        mark(lc0 - 1, lc0 + 3, dB - 4, dB);
      }
    }
  } else {
    // narrow room: a loveseat in the back corner
    const lc0 = bside > 0 ? W - 2 : 0;
    if (S.solid(lc0, lc0 + 2, dB - 0.2, dB, { pocket: 2 })) {
      sofa(P, lc0 + 1, dB - 0.5, 0, -1, 1.7, fab[0]);
      S.spot('seat', lc0 + 0.5, dB - 0.5, 0, -1, { h: 0.46 }); S.spot('seat', lc0 + 1.5, dB - 0.5, 0, -1, { h: 0.46 });
      cushion(P, lc0 + 0.55, dB - 0.62, 0.52, 0.2, fab[2]);
      pendant(P, lc0 + 1, dB - 1.2, 2.0, ceil, [0.76, 0.5, 0.2], 0.2);
      mark(lc0, lc0 + 1, dB - 2, dB);
    }
  }

  // ===== 5. narrow room: stool ledge along the free wall ============================================================
  if (narrow) {
    const [l0, l1] = bAb(0, 0.42);
    const j0 = 3, j1 = Math.floor(Dm - 3.5);
    if (j1 - j0 >= 3 && S.solid(l0, l1, j0 + 0.2, j1, { pocket: 2 })) {
      P.box('env_wood', l0, l1, 1.02, 1.07, j0 + 0.2, j1, wood, 'nsewt');
      for (let d = j0 + 0.5; d < j1; d += 1.2) P.box('env_metal', Math.min(bc(0.04), bc(0.07)), Math.max(bc(0.04), bc(0.07)), 0.2, 1.02, d, d + 0.03, [0.18, 0.18, 0.2], 'nsewt');
      for (let d = j0 + 0.5; d < j1; d += 1.0) {
        if (counterOK && Math.abs(d - dOrd) < 1.6) continue;      // keep the order spot clear
        const sa = bc(1.1);
        barStool(P, sa, d, mix(wood2, [0, 0, 0], 0.2));
        S.spot('seat', sa, d, bside > 0 ? 1 : -1, 0, { h: 0.82 });
        if (r() < 0.4) cup(P, bc(0.2), 1.07, d);
      }
      // slats above
      for (let d = j0 + 0.3; d < j1; d += 0.14) P.box('env_wood', Math.min(bc(0.01), bc(0.06)), Math.max(bc(0.01), bc(0.06)), 1.2, 2.5, d, d + 0.07, wood2, 'nsewt');
    }
  }

  // ===== 6. free-standing tables: 2-tops, a few 4-tops, a communal table ============================================
  const placeTop = (i, j, axis, round, four) => {
    // table cell(s): (i..i+four, j); chairs on both sides along `axis` ('d': chairs at rows j-1/j+1, 'a': cols i-1/i+n)
    const nA = four ? 2 : 1;
    const ax = axis === 'd';
    const ci0 = i, ci1 = i + (ax ? nA - 1 : 0), cj0 = j, cj1 = j + (ax ? 0 : nA - 1);
    // all footprint cells (table + chairs) must be free
    const fi0 = ci0 - (ax ? 0 : 1), fi1 = ci1 + (ax ? 0 : 1), fj0 = cj0 - (ax ? 1 : 0), fj1 = cj1 + (ax ? 1 : 0);
    if (fi0 < 0 || fj0 < 1 || fi1 >= W || fj1 >= Dm - 0.5) return false;
    for (let jj = fj0; jj <= fj1; jj++) for (let ii = fi0; ii <= fi1; ii++) if (isUsed(ii, jj)) return false;
    const jx = (r() - 0.5) * 0.22, jz = (r() - 0.5) * 0.22;
    const ta = (ci0 + ci1 + 1) / 2 + jx, td = (cj0 + cj1 + 1) / 2 + jz;
    const tw = ax ? 0.62 + (nA - 1) * 0.55 : 0.62, tdp = ax ? 0.62 : 0.62 + (nA - 1) * 0.55;
    // the logged solid() is the only gate
    if (!S.solid(ta - tw / 2, ta + tw / 2, td - tdp / 2, td + tdp / 2, { pocket: 1 })) return false;
    const tcol = r() < 0.5 ? wood : wood2;
    if (round && !four) roundTable(P, ta, td, 0.36, tcol); else squareTable(P, ta, td, tw, tdp, tcol);
    const chc = FABRIC[Math.floor(r() * FABRIC.length)], wooden = r() < 0.6;
    const place = [];
    if (ax) for (let k = 0; k < nA; k++) { const x = ci0 + k + 0.5; place.push([x, cj0 - 0.5, 0, 1], [x, cj1 + 1.5, 0, -1]); }
    else for (let k = 0; k < nA; k++) { const z = cj0 + k + 0.5; place.push([ci0 - 0.5, z, 1, 0], [ci1 + 1.5, z, -1, 0]); }
    const full = four || r() < 0.3;
    place.forEach(([ca, cd, fa, fd], q) => {
      if (!full && q >= 2) return;
      chair(P, ca + (r() - 0.5) * 0.1, cd + (r() - 0.5) * 0.1, fa, fd, { wood: wooden, frame: wooden ? tcol : [0.16, 0.16, 0.17], seat: chc, jit: (r() - 0.5) * 0.55 });
      S.spot('seat', ca, cd, fa, fd, { h: 0.495 });
    });
    // clutter
    if (r() < 0.7) cup(P, ta - 0.08, 0.74, td - 0.06);
    if (r() < 0.35) cup(P, ta + 0.1, 0.74, td + 0.08, [0.9, 0.55, 0.3]);
    if (r() < 0.25) glass(P, ta + 0.12, 0.74, td - 0.1);
    if (r() < 0.2) laptop(P, ta, 0.74, td, r() * 0.8 - 0.4);
    if (r() < 0.2) book(P, ta, 0.74, td, r() * 3, [0.25, 0.35, 0.5]);
    if (r() < 0.55) globeLamp(P, ta, td, 2.05 + r() * 0.15, ceil, 0.12 + r() * 0.03);
    mark(fi0 - 1, fi1 + 1, fj0, fj1);
    return true;
  };
  // communal table first (needs space)
  if (wide && wantComm && W >= 9) {
    const ci = clamp(Math.floor((W - 3) / 2) + (r() < 0.5 ? -1 : 1) * (side > 0 ? 0 : 1), 1, W - 4), cj = Math.floor(d1 + 1.0 + r() * 1.5);
    let ok = cj + 2 < Dm - 3;
    for (let jj = cj - 1; jj <= cj + 1 && ok; jj++) for (let ii = ci; ii < ci + 3 && ok; ii++) if (isUsed(ii, jj)) ok = false;
    if (ok && S.solid(ci + 0.2, ci + 2.8, cj + 0.25, cj + 0.75, { pocket: 2 })) {
      const wcol = WOOD.walnut;
      P.box('env_wood', ci + 0.2, ci + 2.8, 0.72, 0.78, cj + 0.1, cj + 0.9, wcol, 'nsewt');
      for (const a of [ci + 0.45, ci + 2.55]) { P.box('env_wood', a - 0.04, a + 0.04, 0, 0.72, cj + 0.15, cj + 0.85, mix(wcol, [0, 0, 0], 0.3), 'nsewt'); }
      P.box('env_wood', ci + 0.45, ci + 2.55, 0.2, 0.24, cj + 0.47, cj + 0.53, mix(wcol, [0, 0, 0], 0.3), 'nsewt');
      for (let k = 0; k < 3; k++) {
        const a = ci + 0.5 + k;
        const j0 = (r() - 0.5) * 0.08; stoolSeat(a + j0, cj - 0.2, 0, 1); S.spot('seat', a + j0, cj - 0.2, 0, 1, { h: 0.73 });
        const j1 = (r() - 0.5) * 0.08; stoolSeat(a + j1, cj + 1.2, 0, -1); S.spot('seat', a + j1, cj + 1.2, 0, -1, { h: 0.73 });
      }
      for (let k = 0; k < 4; k++) if (r() < 0.6) cup(P, ci + 0.4 + k * 0.7, 0.78, cj + 0.3 + (k % 2) * 0.4);
      P.cyl('env_matte', ci + 1.5, 0.78, 0.84, cj + 0.5, 0.12, [0.8, 0.76, 0.7]); P.geo('env_matte', 'plant', ci + 1.5, 0.84, cj + 0.5, 0.4, [0.3, 0.3, 0.3], GREENS[1]);
      for (let k = 0; k < 3; k++) globeLamp(P, ci + 0.5 + k * 1.0, cj + 0.5, 2.05, ceil, 0.13);
      mark(ci - 1, ci + 3, cj - 2, cj + 2);
    }
  }
  function stoolSeat(a, d, fa, fd) { P.geo('env_wood', 'stool', a, 0, d, 0, 1, mix(wood2, [0, 0, 0], 0.15)); void fa; void fd; }
  // scatter the rest
  const wantTables = narrow ? 0 : Math.round(clamp((W * (Dm - 3)) / 11, 3, 10));   // critic: denser (was /15)
  let placed = 0, tries = 0;
  const lo = narrow ? 1 : 1, hi = W - 2;
  while (placed < wantTables && tries++ < 140) {
    const i = lo + Math.floor(r() * Math.max(1, hi - lo + 1)), j = 3 + Math.floor(r() * Math.max(1, Math.floor(Dm - 6)));
    const axis = r() < 0.55 ? 'd' : 'a', four = !narrow && r() < 0.25, round = r() < 0.5;
    if (placeTop(i, j, axis, round, four)) placed++;
  }

  // ===== 7. plants, clutter, walls ==================================================================================
  const spotsForPlants = [[0.4, 0.95], [W - 0.4, 0.95], [bc(0.4), Math.max(d1 + 0.8, 5.2)], [bc(0.4), Dm - 3.2]];
  spotsForPlants.forEach(([a, d], k) => {
    if (k === 2 || k === 3) { if (S.solid(Math.min(a - 0.28, a + 0.28), Math.max(a - 0.28, a + 0.28), d - 0.28, d + 0.28, { pocket: 2 })) plantPot(P, a, d, 0.42, 1.0, k + plantSeed, POTS[(k + plantSeed) % 4], GREENS[(k + plantSeed) % 4]); return; }
    if ((a < 1 ? dA0 > 1 : dA1 < W - 1) && S.solid(a - 0.28, a + 0.28, d - 0.28, d + 0.28, { pocket: 2 })) plantPot(P, a, d, 0.42, 1.05, k + plantSeed, POTS[(k + plantSeed) % 4], GREENS[(k * 2 + plantSeed) % 4]);
  });
  // a shelf of plants + books on the banquette wall (wide rooms) and hanging plants
  if (!narrow) for (let k = 0; k < 2; k++) hangingPlant(P, bc(0.4), Math.max(d1 + 1.6, 6) + k * 2.6, 1.8 - r() * 0.15, ceil, GREENS[(k + plantSeed) % 4]);
  // back wall: a shelf with plants and books beside the door; framed print
  {
    const da = doorBack;
    const shA0 = da > W / 2 ? 0.4 : W - 2.6, shA1 = shA0 + 2.0;
    if (W >= 5 && Dm - 0.4 > 0) {
      P.box('env_wood', shA0, shA1, 1.5, 1.54, Dm - 0.3, Dm - 0.01, wood2, 'nsewt');
      P.box('env_wood', shA0, shA1, 1.1, 1.14, Dm - 0.3, Dm - 0.01, wood2, 'nsewt');
      for (let a = shA0 + 0.1; a < shA1 - 0.15; a += 0.18 + r() * 0.1) { const hh = 0.14 + r() * 0.12; P.box('env_matte', a, a + 0.1, 1.54, 1.54 + hh, Dm - 0.24, Dm - 0.08, FABRIC[Math.floor(r() * FABRIC.length)], 'nsewt'); }
      P.cyl('env_matte', shA0 + 1.7, 1.14, 1.3, Dm - 0.15, 0.09, POTS[1]); P.geo('env_matte', 'plant', shA0 + 1.7, 1.28, Dm - 0.15, 0, [0.3, 0.3, 0.3], GREENS[2]);
      void da;
    }
  }
  // outside: A-frame menu + queue points on the corridor (existing behaviour)
  const am = R.chalk('本日のおすすめ', MENU.cafe, hash(S.b.slot));
  const aa = side > 0 ? S.doorA0 + 0.7 : S.W - 0.7;
  if (S.outside(aa - 0.33, aa + 0.33, -0.95, -0.55, 2.5)) aFrame(S.front, am, aa, -0.75);
  queuePoints(S, S.doorA0, S.doorA1, 2);
  if (!counterOK) S.spot('counter', W / 2, 3, 0, 1);
  void kind; void WHITE;
}
