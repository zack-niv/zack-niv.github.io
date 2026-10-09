// =============================================================================
// Room acoustics: generated stereo impulse responses per acoustic space type.
// Three-band exponentially decaying diffuse tail (frequency-dependent RT60),
// geometric early reflections (floor/ceiling flutter for low ceilings,
// discrete slapback from building faces outdoors), pre-delay and build-up.
// Worker-safe.
// =============================================================================
import { rng, Biquad, clamp } from './dsp.js?v=517b401';

// rt: mid RT60 (s); lo/hi: RT multipliers for <300 Hz and >3 kHz bands;
// ceil: ceiling height (flutter echoes); pre: pre-delay; gain: wet level
// slaps: discrete echoes [delay s, gain]; width: stereo decorrelation 0..1
export const ACOUSTICS = {
  arcade:      { rt: 1.05, lo: 1.15, hi: 0.5, ceil: 3.2, pre: 0.006, gain: 0.85, width: 0.8 },
  arcade_court:{ rt: 1.5, lo: 1.1, hi: 0.55, ceil: 4.0, pre: 0.01, gain: 0.9, width: 0.9 },
  concourse:   { rt: 1.75, lo: 1.1, hi: 0.72, ceil: 3.4, pre: 0.008, gain: 1.0, width: 0.85 },   // tiled metro concourse: bright & long
  platform:    { rt: 2.9, lo: 1.35, hi: 0.6, ceil: 4.2, pre: 0.012, gain: 1.15, width: 1.0, slaps: [[0.11, 0.18], [0.23, 0.12], [0.41, 0.07]] }, // + tunnel mouths
  terminal:    { rt: 2.5, lo: 1.15, hi: 0.5, ceil: 9.0, pre: 0.028, gain: 1.0, width: 1.0 },
  terminal_platform: { rt: 1.6, lo: 1.0, hi: 0.45, ceil: 8.0, pre: 0.03, gain: 0.7, width: 1.0, slaps: [[0.09, 0.08]] },
  department:  { rt: 0.85, lo: 1.1, hi: 0.5, ceil: 4.0, pre: 0.008, gain: 0.7, width: 0.8 },
  mall:        { rt: 1.35, lo: 1.1, hi: 0.55, ceil: 4.0, pre: 0.01, gain: 0.85, width: 0.9 },
  court:       { rt: 2.0, lo: 1.1, hi: 0.55, ceil: 8.0, pre: 0.018, gain: 0.95, width: 1.0 },
  passage:     { rt: 1.3, lo: 1.1, hi: 0.68, ceil: 3.0, pre: 0.006, gain: 0.9, width: 0.75 },
  room:        { rt: 0.45, lo: 1.1, hi: 0.5, ceil: 3.2, pre: 0.003, gain: 0.55, width: 0.7 },
  parks_indoor:{ rt: 1.2, lo: 1.1, hi: 0.55, ceil: 4.5, pre: 0.01, gain: 0.8, width: 0.9 },
  canyon:      { rt: 0.7, lo: 0.9, hi: 0.6, ceil: 0, pre: 0.02, gain: 0.45, width: 1.0, slaps: [[0.042, 0.22], [0.075, 0.16], [0.118, 0.12], [0.16, 0.07]] },
  garden:      { rt: 0.35, lo: 0.8, hi: 0.5, ceil: 0, pre: 0.02, gain: 0.18, width: 1.0, slaps: [[0.19, 0.06]] },
  street:      { rt: 0.55, lo: 0.9, hi: 0.5, ceil: 0, pre: 0.015, gain: 0.3, width: 1.0, slaps: [[0.085, 0.12], [0.21, 0.08], [0.34, 0.05]] },
};

// space style → acoustic key
const STYLE = {
  metro_platform: 'platform', metro_concourse: 'concourse', arcade: 'arcade', arcade_court: 'arcade_court',
  depachika: 'department', department: 'department', passage: 'passage', city_plaza: 'mall', city_mall: 'mall',
  city_court: 'court', dining_street: 'mall', restaurant: 'room', shop: 'room', sidewalk: 'street', plaza: 'street',
  terminal_hall: 'terminal', terminal_concourse: 'terminal', terminal_platform: 'terminal_platform',
  parks_indoor: 'parks_indoor', parks_dining: 'parks_indoor', parks_skywalk: 'parks_indoor',
  canyon: 'canyon', canyon_stage: 'canyon', canyon_bridge: 'canyon', garden: 'garden', garden_deck: 'garden',
};
const ZONE_DEFAULT = { midosuji: 'concourse', sennichimae: 'concourse', nambawalk: 'arcade', takashimaya: 'department', plaza: 'street', street: 'street', nankai: 'terminal', link: 'passage', city: 'mall', parks: 'parks_indoor', parksGarden: 'garden' };
export function acousticFor(space, zone, ramp) {
  if (space) {
    if (space.kind === 'room') return 'room';
    if (STYLE[space.style]) return STYLE[space.style];
    if (space.outdoor) return 'street';
  }
  if (ramp && ramp.kind === 'stairs' && (zone === 'nambawalk' || zone === 'midosuji')) return 'passage';
  return ZONE_DEFAULT[zone] || 'mall';
}

export function impulse(sr, key) {
  const P = ACOUSTICS[key] || ACOUSTICS.mall;
  const r = rng(900 + key.length * 31 + key.charCodeAt(0));
  const len = Math.min(5, P.rt * 1.25 + P.pre + 0.05);
  const n = Math.floor(len * sr);
  const chans = [new Float32Array(n), new Float32Array(n)];
  const pre = Math.floor(P.pre * sr);
  const bands = [
    { type: 'lowpass', f: 300, rt: P.rt * P.lo },
    { type: 'bandpass', f: 1100, rt: P.rt, q: 0.4 },
    { type: 'highpass', f: 3200, rt: P.rt * P.hi },
  ];
  const shared = new Float32Array(n);
  for (let i = 0; i < n; i++) shared[i] = r() * 2 - 1;
  chans.forEach((ch, c) => {
    // decorrelated noise per channel (width blends from shared)
    const noise = new Float32Array(n);
    for (let i = 0; i < n; i++) noise[i] = shared[i] * (1 - P.width) + (r() * 2 - 1) * P.width;
    for (const b of bands) {
      const bq = new Biquad(b.type, b.f, b.q || 0.7, 0, sr);
      const k = -6.91 / (b.rt * sr);
      for (let i = pre; i < n; i++) {
        const t = i - pre;
        const build = Math.min(1, t / (0.012 * sr + P.rt * 0.006 * sr)); // diffuse field builds up
        ch[i] += bq.tick(noise[i]) * Math.exp(k * t) * build;
      }
    }
    // early reflections: floor/ceiling flutter + scattered first-order taps
    const er = (delay, g) => {
      const d = Math.floor(delay * sr) + (c ? Math.floor(r() * 0.0015 * sr) : 0);
      if (d >= n - 8) return;
      for (let j = 0; j < 6; j++) ch[d + j] += g * (j === 0 ? 1 : 0.5 * (r() - 0.5)) * (c ? 0.95 : 1);
    };
    if (P.ceil) {
      const flutter = 2 * P.ceil / 343;
      for (let k = 1; k <= 8; k++) er(P.pre + flutter * k, 0.5 * Math.pow(0.62, k) * (k % 2 ? 1 : -1));
      for (let k = 0; k < 10; k++) er(P.pre + 0.004 + r() * Math.min(0.08, P.rt * 0.05), (r() - 0.5) * 0.5);
    }
    if (P.slaps) for (const [d, g] of P.slaps) {
      // slapbacks smeared slightly (rough building faces)
      const s = Math.floor(d * sr) + (c ? Math.floor(0.004 * sr) : 0);
      const lp = new Biquad('lowpass', 3500, 0.7, 0, sr);
      for (let j = 0; j < Math.floor(0.012 * sr) && s + j < n; j++) ch[s + j] += lp.tick(r() * 2 - 1) * g * 2.2 * Math.exp(-j / (0.003 * sr));
    }
  });
  // unit-energy normalise, then apply preset wet gain
  let e = 0; for (const ch of chans) for (let i = 0; i < n; i++) e += ch[i] * ch[i];
  const g = P.gain / Math.sqrt(e / 2 || 1);
  for (const ch of chans) { for (let i = 0; i < n; i++) ch[i] *= g; const f = Math.floor(0.02 * sr); for (let i = 0; i < f; i++) ch[n - 1 - i] *= i / f; }
  return chans;
}
