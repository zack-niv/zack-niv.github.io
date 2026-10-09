// =============================================================================
// Furniture kit (v2) for believable interiors. Everything is merged geometry through a Painter (P), so a café with
// forty chairs is still a handful of draw calls. Orientation helpers take a FACING direction in shop-local
// coordinates (fa, fd) = (lateral, depth) and put the object's back on the opposite side.
//
//   frameOf(cx, cd, fa, fd)     -> object frame: p(u, w) -> [a, d]; u = lateral, w = depth with +w = BACK of the object
//   obox(P, mat, F, u0,u1, w0,w1, y0,y1, col, faces)   oriented box
//   chair / stool / sofa / armchair / roundTable / squareTable / pendant / cup / plant / book ...
//
// RNG rule (see notes/environment.md): only S.r() and the answers of S.solid()/S.outside() may steer the layout;
// never S.free()/S.areaFree() (they read the final occupancy, which differs between the logic pass and the replay).
// =============================================================================
import { mix, WHITE } from './kit.js?v=454ed73';

export const WOOD = { pale: [0.9, 0.78, 0.6], oak: [0.8, 0.62, 0.42], walnut: [0.5, 0.33, 0.2], dark: [0.33, 0.21, 0.13] };
export const WOODS = [WOOD.pale, WOOD.oak, WOOD.walnut, WOOD.dark];
export const FABRIC = [[0.36, 0.5, 0.4], [0.74, 0.38, 0.26], [0.84, 0.64, 0.24], [0.2, 0.28, 0.42], [0.26, 0.26, 0.28], [0.62, 0.3, 0.34], [0.86, 0.8, 0.7], [0.45, 0.55, 0.6]];
export const GREENS = [[0.2, 0.42, 0.18], [0.26, 0.5, 0.22], [0.16, 0.36, 0.2], [0.34, 0.52, 0.24]];
export const POTS = [[0.85, 0.82, 0.76], [0.55, 0.36, 0.26], [0.2, 0.2, 0.22], [0.78, 0.55, 0.4]];

// ---- object frames --------------------------------------------------------------------------------------------------
export function frameOf(cx, cd, fa, fd) {
  const th = Math.atan2(-fa, -fd), c = Math.cos(th), s = Math.sin(th);
  return { th, c, s, cx, cd, p: (u, w) => [cx + u * c + w * s, cd - u * s + w * c] };
}
export function obox(P, mat, F, u0, u1, w0, w1, y0, y1, col, faces = 'nsewt') {
  const [ca, cd] = F.p((u0 + u1) / 2, (w0 + w1) / 2);
  P.rbox(mat, ca, (y0 + y1) / 2, cd, Math.abs(u1 - u0), Math.abs(y1 - y0), Math.abs(w1 - w0), F.th, col, faces);
}

// ---- seating --------------------------------------------------------------------------------------------------------
// dining chair facing (fa, fd); jit = small yaw wobble so a room never looks gridded
export function chair(P, a, d, fa, fd, o = {}) {
  const th = Math.atan2(-fa, -fd) + (o.jit || 0);
  P.geo(o.wood ? 'env_wood' : 'env_metal', 'chair_frame', a, 0, d, th, 1, o.frame || [0.16, 0.16, 0.17]);
  P.geo('env_matte', 'chair_seat', a, 0, d, th, 1, o.seat || [0.4, 0.4, 0.4]);
}
export function stool(P, a, d, col = [0.5, 0.33, 0.2], mat = 'env_wood') { P.geo(mat, 'stool', a, 0, d, 0, 1, col); }
// tall bar stool (seat 0.78): stretch the stool proto
export function barStool(P, a, d, col = [0.3, 0.2, 0.14]) { P.geo('env_wood', 'stool', a, 0, d, 0, [1, 1.12, 1], col); }

export function sofa(P, cx, cd, fa, fd, len, col, o = {}) {
  const F = frameOf(cx, cd, fa, fd), h = len / 2, light = mix(col, [1, 1, 1], 0.1), dark = mix(col, [0, 0, 0], 0.18);
  const depth = o.depth || 0.46;
  obox(P, 'env_matte', F, -h, h, -depth, depth, 0.12, 0.44, dark);                         // base
  obox(P, 'env_matte', F, -h, h, depth - 0.2, depth, 0.44, 0.92, col);                      // back
  obox(P, 'env_matte', F, -h, -h + 0.15, -depth, depth, 0.44, 0.68, col);                   // arms
  obox(P, 'env_matte', F, h - 0.15, h, -depth, depth, 0.44, 0.68, col);
  const n = Math.max(1, Math.round((len - 0.3) / 0.72)), step = (len - 0.3) / n;
  for (let k = 0; k < n; k++) {
    const u0 = -h + 0.15 + k * step + 0.012, u1 = -h + 0.15 + (k + 1) * step - 0.012;
    obox(P, 'env_matte', F, u0, u1, -depth + 0.02, depth - 0.2, 0.44, 0.56, light);         // seat cushion
    obox(P, 'env_matte', F, u0 + 0.02, u1 - 0.02, depth - 0.34, depth - 0.2, 0.52, 0.86, light); // back cushion
  }
  for (const [u, w] of [[-h + 0.08, -depth + 0.08], [h - 0.08, -depth + 0.08], [-h + 0.08, depth - 0.08], [h - 0.08, depth - 0.08]]) obox(P, 'env_wood', F, u - 0.025, u + 0.025, w - 0.025, w + 0.025, 0, 0.12, WOOD.dark, 'nsewt');
  return F;
}
export function armchair(P, cx, cd, fa, fd, col) {
  const F = frameOf(cx, cd, fa, fd), dark = mix(col, [0, 0, 0], 0.18), light = mix(col, [1, 1, 1], 0.1);
  obox(P, 'env_matte', F, -0.36, 0.36, -0.36, 0.36, 0.14, 0.42, dark);
  obox(P, 'env_matte', F, -0.36, 0.36, 0.2, 0.36, 0.42, 0.9, col);
  obox(P, 'env_matte', F, -0.36, -0.24, -0.36, 0.36, 0.42, 0.62, col);
  obox(P, 'env_matte', F, 0.24, 0.36, -0.36, 0.36, 0.42, 0.62, col);
  obox(P, 'env_matte', F, -0.24, 0.24, -0.34, 0.2, 0.42, 0.54, light);
  for (const [u, w] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) obox(P, 'env_wood', F, u - 0.025, u + 0.025, w - 0.025, w + 0.025, 0, 0.14, WOOD.dark);
  return F;
}
export function cushion(P, cx, cd, y, th, col, s = 0.38) { P.rbox('env_matte', cx, y + s * 0.5, cd, s, s, s * 0.28, th, col, 'nsewt'); }

// ---- tables ---------------------------------------------------------------------------------------------------------
export function roundTable(P, a, d, r, wood, h = 0.74) {
  P.cyl('env_wood', a, h - 0.035, h, d, r, wood);
  P.cyl('env_metal', a, 0, h - 0.035, d, 0.03, [0.16, 0.16, 0.17], 'cyl6');
  P.cyl('env_metal', a, 0, 0.025, d, Math.max(0.16, r * 0.55), [0.16, 0.16, 0.17], 'cyl6');
}
export function squareTable(P, a, d, w, dp, wood, h = 0.74) {
  P.box('env_wood', a - w / 2, a + w / 2, h - 0.04, h, d - dp / 2, d + dp / 2, wood);
  P.cyl('env_metal', a, 0, h - 0.04, d, 0.03, [0.16, 0.16, 0.17], 'cyl6');
  P.box('env_metal', a - 0.2, a + 0.2, 0, 0.03, d - 0.2, d + 0.2, [0.16, 0.16, 0.17]);
}

// ---- small things ---------------------------------------------------------------------------------------------------
export function cup(P, a, y, d, col = [0.97, 0.97, 0.95], r = 0.04) {
  P.cyl('env_gloss', a, y, y + 0.085, d, r, col, 'cyl6');
  P.cyl('env_gloss', a, y, y + 0.012, d, r * 1.55, mix(col, [1, 1, 1], 0.4), 'cyl6');     // saucer
  P.cyl('env_matte', a, y + 0.08, y + 0.086, d, r * 0.8, [0.22, 0.12, 0.06], 'cyl6');      // coffee surface
}
export function glass(P, a, y, d, r = 0.032) { P.cyl('env_glass_case', a, y, y + 0.12, d, r, WHITE, 'cylOpen'); P.cyl('env_gloss', a, y, y + 0.06, d, r * 0.85, [0.9, 0.62, 0.2], 'cyl6'); }
export function laptop(P, a, y, d, th = 0) {
  P.rbox('env_metal', a, y + 0.01, d, 0.32, 0.02, 0.22, th, [0.75, 0.76, 0.78], 'nsewt');
  const c = Math.cos(th), s = Math.sin(th);
  P.rbox('env_metal', a + s * 0.11, y + 0.12, d + c * 0.11, 0.32, 0.2, 0.012, th + 0.15, [0.7, 0.71, 0.74], 'nsewt');
}
export function book(P, a, y, d, th, col, w = 0.2, l = 0.27) { P.rbox('env_matte', a, y + 0.015, d, w, 0.03, l, th, col, 'nsewt'); }
export function plantPot(P, a, d, h, sc, rot, pot = POTS[0], green = GREENS[0], kind = 'tallplant') {
  P.cyl('env_matte', a, 0, h, d, 0.2 * sc + 0.02, pot);
  P.geo('env_matte', kind, a, h - 0.1, d, rot, 0.85 * sc, green);
}
export function hangingPlant(P, a, d, y, ceil, green = GREENS[1]) {
  P.box('env_metal', a - 0.004, a + 0.004, y + 0.2, ceil, d - 0.004, d + 0.004, [0.2, 0.2, 0.2]);
  P.cyl('env_matte', a, y, y + 0.14, d, 0.1, [0.8, 0.76, 0.68]);
  P.geo('env_matte', 'plant', a, y + 0.1, d, 0, [0.55, 0.45, 0.55], green);
}
// pendant: cord from the ceiling, shade (bowl) and a warm glow disc under it
export function pendant(P, a, d, y, ceil, col = [0.14, 0.14, 0.15], r = 0.2, glow = [2.4, 1.9, 1.35]) {
  P.box('env_metal', a - 0.004, a + 0.004, y + 0.14, ceil, d - 0.004, d + 0.004, [0.12, 0.12, 0.12]);
  P.geo('env_gloss', 'bowl', a, y + 0.14, d, 0, [r, -r * 0.7, r], col);
  P.qh('env_glow', a - r * 0.5, a + r * 0.5, d - r * 0.5, d + r * 0.5, y + 0.03, false, glow);
}
// globe pendant (warm opal sphere)
export function globeLamp(P, a, d, y, ceil, r = 0.13, glow = [2.2, 1.7, 1.1]) {
  P.box('env_metal', a - 0.004, a + 0.004, y + r, ceil, d - 0.004, d + 0.004, [0.12, 0.12, 0.12]);
  P.geo('env_glow', 'sphere', a, y, d, 0, r, glow);
}
export function wallShelf(P, a0, a1, d0, d1, y, wood, depth = 0.25, onRight = false, W = 0) {
  if (onRight) P.box('env_wood', W - depth, W, y, y + 0.03, d0, d1, wood); else P.box('env_wood', 0, depth, y, y + 0.03, d0, d1, wood);
  void a0; void a1;
}
