// Stair geometry as the feet see it. Matches the step quantisation used by
// js/world/architecture.js `_ramp()` (N = max(8, round(len*3)) segments; a
// segment whose profile rises > 1 cm is a tread at the segment's END height,
// with the riser at the segment start). If a builder sets `ramp.steps`, that
// count is used instead so visuals and feet stay in agreement.
import { rampProfile, rampLength, rampLocal } from '../world/layout.js?v=517b401';

export function stairSegments(r) {
  return r.steps || Math.max(8, Math.round(rampLength(r) * 3));
}
// metres from the low end -> along-axis coordinate a
export function rampAlong(r, x, z) { return rampLocal(r, x, z).s * rampLength(r); }
// height of the walking surface under along-axis coordinate a (metres)
export function stairSurfaceY(r, a) {
  const len = rampLength(r), N = stairSegments(r);
  const s = Math.min(1, Math.max(0, a / len));
  const i = Math.min(N - 1, Math.floor(s * N));
  const y0 = rampProfile(r, i / N), y1 = rampProfile(r, (i + 1) / N);
  if (y1 - y0 > 0.01) return y1;               // a tread
  return rampProfile(r, s);                    // landing / gentle portion
}
// tread index (segment) under a, and tread depth
export function stairTread(r, a) {
  const len = rampLength(r), N = stairSegments(r);
  return { index: Math.floor(Math.min(1, Math.max(0, a / len)) * N - 1e-9), depth: len / N };
}
// local incline (rise per metre along the axis) around a, smoothed over ±0.5 m
export function rampSlope(r, a) {
  const len = rampLength(r);
  const s0 = Math.max(0, (a - 0.5) / len), s1 = Math.min(1, (a + 0.5) / len);
  if (s1 <= s0) return 0;
  return (rampProfile(r, s1) - rampProfile(r, s0)) / ((s1 - s0) * len);
}
