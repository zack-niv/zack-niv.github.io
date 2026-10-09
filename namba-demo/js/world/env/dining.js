// =============================================================================
// Table restaurants (v2): okonomiyaki / kushikatsu / tonkatsu / izakaya / yakiniku / omurice.
//
// Booths along one wall (bench + slat partitions + a 4-top each), a kitchen pass with counter stools and chefs at the
// back, a scatter of 2/4-tops in the middle (grills / teppan for those that have them), lanterns, tanzaku menus, a
// sake shelf; the unused depth of long slots becomes the kitchen / back wall instead of a cavern.
// Contract: S.service('chef', order, staff) -> ctx.counters.
// =============================================================================
import { mix, WHITE, protoUV } from './kit.js?v=f150c03';
import { MENU, SAMPLES } from './catalog.js?v=f150c03';
import { foodItem } from './shopbuild.js?v=f150c03';
import { backWall } from './cafe.js?v=f150c03';
import { Cells, tableSet, scatter } from './seating.js?v=f150c03';
import { WOOD, FABRIC, GREENS, POTS, chair, barStool, plantPot, cup, glass, globeLamp, obox, frameOf } from './furnish.js?v=f150c03';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function diningInterior(S, c) {
  const P = S.inner, W = S.W, r = S.r, R = S.R, ceil = S.ceil, cat = S.b.cat;
  const izaka = cat === 'izakaya' || cat === 'kushikatsu' || cat === 'yakiniku';
  const wood = izaka ? (r() < 0.5 ? WOOD.walnut : WOOD.dark) : (r() < 0.5 ? WOOD.oak : WOOD.pale);
  const seat = izaka ? [0.22, 0.15, 0.1] : cat === 'omurice' ? [0.55, 0.15, 0.1] : [0.28, 0.22, 0.17];
  const side = r() < 0.5 ? 1 : -1;                         // booth wall
  const bc = (u) => (side > 0 ? W - u : u);
  const bAb = (u0, u1) => [Math.min(bc(u0), bc(u1)), Math.max(bc(u0), bc(u1))];
  const lanternTxt = { izakaya: '酒', kushikatsu: '串', yakiniku: '焼' }[cat];
  // ---- depth: no caverns, kitchen at the back --------------------------------------------------------------------
  let Dm = S.D;
  if (S.D > 16) Dm = clamp(Math.max(S.cj + 4, 14 + Math.floor(r() * 3)), 8, S.D);
  const kd = Dm - 3;                                       // integer: the row in front of the pass stays a free cell
  S.backD = Dm;
  const doorBack = backWall(S, P, Dm, { door: false });
  const cells = new Cells(W, Dm);
  const [dA0, dA1] = S.doorCells || [S.doorA0, S.doorA1];
  cells.mark(dA0 - 1, dA1, 0, 2);

  // ---- 1. kitchen pass + back of house ---------------------------------------------------------------------------
  const kOK = S.solid(0, W, kd, Dm, { force: true });
  void kOK;
  {
    const lac = izaka ? [0.2, 0.1, 0.07] : mix(wood, [0, 0, 0], 0.25);
    P.box('env_wood', 0.3, W - 0.3, 0, 1.0, kd, kd + 0.6, lac, 'nsewt');
    P.box('env_wood', 0.25, W - 0.25, 1.0, 1.05, kd - 0.08, kd + 0.62, mix(wood, [1, 1, 1], 0.12), 'nsewt');
    P.box('env_wood', 0.3, W - 0.3, 1.05, 1.3, kd + 0.5, kd + 0.6, mix(wood, [0, 0, 0], 0.2), 'nsewt');                         // pass rail
    P.qh('env_glow', 0.5, W - 0.5, kd + 0.1, kd + 0.18, 1.0, false, [1.7, 1.15, 0.65]);
    // heat lamps over the pass
    for (let a = 1.2; a < W - 0.8; a += 2.2) { P.box('env_metal', a - 0.01, a + 0.01, 1.75, ceil, kd + 0.3, kd + 0.32, [0.2, 0.2, 0.2], 'nsewt'); P.geo('env_gloss', 'bowl', a, 1.7, kd + 0.3, 0, [0.2, -0.1, 0.2], [0.16, 0.14, 0.12]); P.qh('env_glow', a - 0.08, a + 0.08, kd + 0.22, kd + 0.38, 1.66, false, [2.6, 1.5, 0.7]); }
    // kitchen behind: steel bench, hood, grill / fryer, fridge, sake + bottle shelf
    const steel = [0.78, 0.79, 0.82];
    P.box('env_metal', 0.4, W - 0.4, 0, 0.9, kd + 1.25, kd + 1.85, steel, 'nsewt');
    P.box('env_metal', 0.38, W - 0.38, 0.9, 0.93, kd + 1.22, kd + 1.88, [0.9, 0.9, 0.92], 'nsewt');
    for (let a = 1.3; a < W - 1; a += 2.4) { P.cyl('env_matte', a, 0.93, 1.05, kd + 1.55, 0.2, [0.08, 0.07, 0.07]); P.cyl('env_metal', a + 0.7, 0.93, 1.02, kd + 1.55, 0.15, [0.7, 0.4, 0.2]); }
    P.box('env_metal', 0.4, W - 0.4, 2.25, 2.62, kd + 1.1, kd + 2.0, [0.56, 0.57, 0.6], 'nsewt');                       // hood
    if (doorBack > 2.6) P.box('env_metal', 0.4, 1.3, 0, 1.8, Dm - 0.6, Dm - 0.05, steel, 'nsewt');                       // fridge
    const bt = R.prod('bottles', 1);
    for (let k = 0; k < 2; k++) {
      const y = 1.35 + k * 0.45;
      for (const [a0, a1] of [[1.5, doorBack - 0.7], [doorBack + 0.7, W - 0.5]]) if (a1 - a0 > 0.8) { P.box('env_wood', a0, a1, y, y + 0.03, Dm - 0.3, Dm - 0.01, wood, 'nsewt'); P.tq(bt, a0, a1, y + 0.03, y + 0.38, Dm - 0.02, -1); }
    }
    // staff post(s): the main one is the order spot's counterpart
    const sx = clamp(1.6, 1, W - 1);
    for (let a = 4; a < W - 1; a += 2.6) S.spot('staff', a, kd + 1.0, 0, -1);
    // counter stools (W >= 8) with water cups and bowls
    const first = 2.6;
    for (let a = first; a < W - 1.1; a += 0.78) {
      barStool(P, a + (r() - 0.5) * 0.06, kd - 0.5, izaka ? [0.2, 0.12, 0.08] : [0.35, 0.22, 0.14]);
      S.spot('seat', a, kd - 0.5, 0, 1, { h: 0.82 });
      if (r() < 0.4) foodItem(S, P, (SAMPLES[cat] || ['salad'])[0], a, 1.05, kd + 0.18, 0.1);
      else if (r() < 0.5) cup(P, a + 0.2, 1.05, kd + 0.1, [0.9, 0.9, 0.88], 0.035);
    }
    cells.mark(0, W - 1, Math.floor(kd) - 1, Math.ceil(Dm));
    S.service('chef', [1.5, kd - 0.5], [1.5, kd + 1.0]);
    void sx;
    // noren + staff door on the back wall
    const nr = R.noren('厨房', null, '#1d2b4a', '#f5f1e8');
    P.tq(nr, doorBack - 0.5, doorBack + 0.5, 1.2, 2.0, Dm - 0.03, -1);
    P.box('env_wood', doorBack - 0.52, doorBack + 0.52, 2.0, 2.05, Dm - 0.07, Dm - 0.03, wood, 'nsewt');
  }

  // ---- 2. booths along the side wall ---------------------------------------------------------------------------------
  const bk0 = 3, bk1 = Math.floor(kd - 1.2);
  const bface = side > 0 ? -1 : 1;                           // bench seat faces the room
  let nb = 0;
  for (let j = bk0; j + 1 <= bk1 && j < bk0 + 12; j += 2) {
    if (cells.used(side > 0 ? W - 1 : 0, j) || cells.used(side > 0 ? W - 1 : 0, j + 1)) continue;
    if (nb >= 5 && r() < 0.4) continue;
    const [s0, s1] = bAb(0, 0.2);
    if (!S.solid(s0, s1, j, j + 2, { pocket: 2 })) continue;
    const [t0, t1] = bAb(1.05, 1.75);
    if (!S.solid(t0, t1, j + 0.4, j + 1.6, { pocket: 2 })) continue;
    nb++;
    const col = seat;
    const [bb0, bb1] = bAb(0, 0.55);
    P.box('env_wood', bb0, bb1, 0.1, 0.42, j + 0.04, j + 1.96, mix(wood, [0, 0, 0], 0.3), 'nsewt');
    const [bk0a, bk1a] = bAb(0.4, 0.55);
    P.box('env_matte', bk0a, bk1a, 0.42, 1.0, j + 0.04, j + 1.96, col, 'nsewt');
    const [c0, c1] = bAb(0.04, 0.42);
    P.box('env_matte', c0, c1, 0.42, 0.52, j + 0.06, j + 1.94, mix(col, [1, 1, 1], 0.08), 'nsewt');
    // partition (wood slats) between booths
    if (nb % 1 === 0) { const [p0, p1] = bAb(0, 1.15); P.box('env_wood', p0, p1, 0, 1.5, j - 0.02, j + 0.04, mix(wood, [0, 0, 0], 0.15), 'nsewt'); }
    // table (4-top along the wall) + chairs room side
    const ta = bc(1.4), tc = [Math.min(bc(1.05), bc(1.75)), Math.max(bc(1.05), bc(1.75))];
    P.box('env_wood', tc[0], tc[1], 0.7, 0.74, j + 0.4, j + 1.6, wood, 'nsewt');
    P.cyl('env_metal', ta, 0, 0.7, j + 1.0, 0.03, [0.16, 0.16, 0.17], 'cyl6');
    P.box('env_metal', ta - 0.22, ta + 0.22, 0, 0.03, j + 0.8, j + 1.2, [0.16, 0.16, 0.17], 'nsewt');
    for (let k = 0; k < 2; k++) {
      const cd = j + 0.5 + k, ca = bc(2.15);
      chair(P, ca + (r() - 0.5) * 0.06, cd + (r() - 0.5) * 0.06, -bface, 0, { wood: true, frame: wood, seat, jit: (r() - 0.5) * 0.5 });
      S.spot('seat', ca, cd, -bface, 0, { h: 0.495 });
      S.spot('seat', bc(0.5), cd, bface, 0, { h: 0.46 });
      if (r() < 0.4) foodItem(S, P, (SAMPLES[cat] || ['salad'])[Math.floor(r() * 2) % (SAMPLES[cat] || [1]).length], ta, 0.74, cd + (k ? 0.1 : -0.1), 0.1);
    }
    if (cat === 'yakiniku') { P.cyl('env_metal', ta, 0.74, 0.8, j + 1.0, 0.2, [0.15, 0.15, 0.15]); P.cyl('env_glow', ta, 0.8, 0.805, j + 1.0, 0.15, [2.2, 0.7, 0.2]); P.cyl('env_metal', ta, 1.55, ceil, j + 1.0, 0.07, [0.6, 0.6, 0.62]); P.cyl('env_metal', ta, 1.45, 1.6, j + 1.0, 0.22, [0.7, 0.7, 0.72]); }
    else if (cat === 'okonomiyaki') P.box('env_metal', ta - 0.28, ta + 0.28, 0.74, 0.76, j + 0.55, j + 1.45, [0.1, 0.1, 0.1], 'nsewt');
    else if (lanternTxt) { const lr = R.lantern(lanternTxt, '#c8231d'); P.geo(lr.atlas.mat(lr), protoUV('lantern', lr), ta, ceil - 0.95, j + 1.0, 0, [0.28, 0.4, 0.28]); }
    else globeLamp(P, ta, j + 1.0, 2.1, ceil, 0.12);
    cells.mark(side > 0 ? W - 3 : 0, side > 0 ? W - 1 : 2, j, j + 1);
  }
  // tanzaku menu strips + a beer poster above the booths
  if (nb) {
    const wall = side > 0 ? W - 0.03 : 0.03, wface = side > 0 ? -1 : 1;
    const tz = R.tanzaku(cat);
    P.ta(tz, bk0 + 0.2, Math.min(bk0 + 4.2, bk1 + 1.8), 1.65, 2.5, wall, wface);
    if (bk1 - bk0 > 5) P.ta(R.poster(['beer', 'ramenfair', 'autumn'][Math.floor(r() * 3)], true), bk0 + 5, bk0 + 5.6, 1.4, 2.3, wall, wface);
  }

  // ---- 3. free-standing tables (4-tops and 2-tops, grills where the cuisine has them) ---------------------------------
  const decorFor = (ta, td) => {
    if (c.teppan) P.box('env_metal', ta - 0.3, ta + 0.3, 0.74, 0.76, td - 0.26, td + 0.26, [0.1, 0.1, 0.1]);
    if (c.grill) { P.cyl('env_metal', ta, 0.74, 0.8, td, 0.2, [0.15, 0.15, 0.15]); P.cyl('env_glow', ta, 0.8, 0.805, td, 0.15, [2.2, 0.7, 0.2]); P.cyl('env_metal', ta, 1.55, ceil, td, 0.07, [0.6, 0.6, 0.62]); P.cyl('env_metal', ta, 1.45, 1.6, td, 0.22, [0.7, 0.7, 0.72]); }
    else if (lanternTxt && r() < 0.6) { const lr = R.lantern(lanternTxt, '#c8231d'); P.geo(lr.atlas.mat(lr), protoUV('lantern', lr), ta, ceil - 0.95, td, 0, [0.28, 0.4, 0.28]); }
    if (c.teppan || r() < 0.45) foodItem(S, P, (SAMPLES[cat] || ['salad'])[Math.floor(r() * 2) % (SAMPLES[cat] || [1]).length], ta - 0.16, c.teppan ? 0.76 : 0.74, td, 0.11);
    if (r() < 0.5) cup(P, ta + 0.18, 0.74, td - 0.15, [0.9, 0.9, 0.88], 0.035);
  };
  const area = W * (kd - 3);
  const want = Math.round(clamp(area / 11, 2, 9));
  scatter(S, P, cells, want, 1, W - 2, 3, Math.floor(kd - 1.5), () => {
    const four = r() < 0.55;
    return { axis: r() < 0.5 ? 'd' : 'a', n: four ? 2 : 1, round: !c.grill && !c.teppan && r() < 0.35, wood, seatCol: seat, woodChair: izaka, decor: decorFor };
  });
  // a plant + shelf of sake near the entrance wall
  if (S.solid(Math.min(bc(0.2), bc(0.7)), Math.max(bc(0.2), bc(0.7)), 0.8, 1.35, { pocket: 2 }) && !izaka) plantPot(P, bc(0.45), 1.1, 0.42, 1.0, 3, POTS[1], GREENS[1]);
  // photo menu by the door
  const pm = R.photoMenu('おすすめ ' + S.b.info.ja, MENU[cat] || MENU.izakaya, SAMPLES[cat] || ['salad'], S.st.accent);
  P.ta(pm, 1.0, 1.9, 1.2, 2.45, side > 0 ? 0.03 : W - 0.03, side > 0 ? 1 : -1);
  if (cat === 'yakiniku' || cat === 'izakaya') S.light(W / 2, 2.2, Dm / 2, [1, 0.6, 0.35], 0.6, 6, 'lamp');
  void WHITE; void FABRIC; void obox; void frameOf; void glass;
}
