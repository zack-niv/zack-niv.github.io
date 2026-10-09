// =============================================================================
// Foley synthesis (worker-safe): footsteps per surface, UI sounds, cooking
// loops, machinery. Everything is physically-motivated: impacts excite modal
// resonances, textures are granular populations of tiny events.
// Each export returns Float32Array (mono) or [L,R] (stereo).
// =============================================================================
import { TAU, rng, Biquad, white, pink, brown, applyEnv, addMode, normalize, normalizeRms, smoothRandom, foldLoop, filt, onePoleLP, clamp, peak, softclip, scale } from './dsp.js?v=f150c03';

// ---- footsteps -------------------------------------------------------------------
// Surface acoustic recipes. Each step = heel impact + (rolled) toe slap,
// shaped by the surface's resonances & texture. Sneakers by default
// (soft rubber: dull heel, little click), 'heel' and 'leather' for NPCs.
export const SURFACES = ['tile', 'stone', 'wood', 'metal', 'paving', 'gravel', 'grass', 'soft'];

function impact(out, sr, start, r, { thump = 0.6, thumpF = 90, click = 0.3, clickF = 3000, clickQ = 0.8, clickDecay = 0.004, lp = 6000 }) {
  // low body thump (foot/leg mass on the floor)
  addMode(out, sr, start, thumpF * (0.9 + r() * 0.2), 0.012, thump * 0.3);
  addMode(out, sr, start, thumpF * 2.3, 0.007, thump * 0.18);
  // contact noise
  const n = Math.floor(0.05 * sr);
  const bp = new Biquad('bandpass', clickF * (0.85 + r() * 0.3), clickQ, 0, sr), lpf = new Biquad('lowpass', lp, 0.7, 0, sr);
  for (let i = 0; i < n && start + i < out.length; i++) {
    const e = Math.exp(-i / (clickDecay * sr));
    out[start + i] += lpf.tick(bp.tick(r() * 2 - 1)) * e * click * 7;
  }
}
function scuff(out, sr, start, r, { amp = 0.08, f = 2500, q = 0.6, dur = 0.07 }) {
  const n = Math.floor(dur * sr), bp = new Biquad('bandpass', f, q, 0, sr);
  for (let i = 0; i < n && start + i < out.length; i++) {
    const t = i / n, e = Math.sin(Math.PI * t) ** 1.5;
    out[start + i] += bp.tick(r() * 2 - 1) * e * amp;
  }
}
function grains(out, sr, start, r, { count = 40, dur = 0.12, fLo = 1500, fHi = 6000, amp = 0.15, decay = 0.0015, shape = 1 }) {
  for (let k = 0; k < count; k++) {
    const t = Math.pow(r(), shape) * dur;
    const o = start + Math.floor(t * sr);
    const f = fLo * Math.pow(fHi / fLo, r());
    const a = amp * Math.pow(r(), 2) * (1 - t / dur * 0.6);
    addMode(out, sr, o, f, decay * (0.6 + r() * 0.8), a, r() * TAU);
  }
}

export function footstep(sr, surface, seed, shoe = 'sneaker') {
  const r = rng(seed * 7919 + surface.length * 131 + (shoe === 'heel' ? 17 : shoe === 'leather' ? 29 : 0));
  const out = new Float32Array(Math.floor(0.42 * sr));
  const roll = Math.floor((0.045 + r() * 0.035) * sr); // heel → toe
  const hard = shoe === 'heel' ? 1 : shoe === 'leather' ? 0.6 : 0;
  // shoe adds its own transient character
  const heelClick = (amp, f) => { addMode(out, sr, 0, f, 0.006 + r() * 0.004, amp); addMode(out, sr, 0, f * 1.62, 0.004, amp * 0.5); };
  switch (surface) {
    case 'tile': // glazed ceramic on mortar: bright short tick
      impact(out, sr, 0, r, { thump: 0.55, thumpF: 95, click: 0.22 + hard * 0.5, clickF: 3600, clickQ: 0.9, clickDecay: 0.003 + hard * 0.003 });
      addMode(out, sr, 0, 1850 + r() * 200, 0.006, 0.05 + hard * 0.12); addMode(out, sr, 0, 3300 + r() * 300, 0.005, 0.04 + hard * 0.1);
      impact(out, sr, roll, r, { thump: 0.25, thumpF: 120, click: 0.12, clickF: 2800, clickDecay: 0.004 });
      scuff(out, sr, roll, r, { amp: 0.04, f: 3500, dur: 0.06 });
      if (shoe === 'sneaker' && r() < 0.12) { // rubber squeak on polished floor
        const n = Math.floor(0.05 * sr), f0 = 1400 + r() * 900; let ph = 0;
        for (let i = 0; i < n; i++) { ph += (f0 + 600 * i / n) / sr; out[roll + i] += Math.sin(TAU * ph) * Math.sin(Math.PI * i / n) * 0.05; }
      }
      break;
    case 'stone': // polished granite / terrazzo: dense mid, less ring
      impact(out, sr, 0, r, { thump: 0.6, thumpF: 85, click: 0.18 + hard * 0.5, clickF: 2400, clickQ: 0.7, clickDecay: 0.004 + hard * 0.002 });
      addMode(out, sr, 0, 2600 + r() * 300, 0.004, 0.03 + hard * 0.12);
      impact(out, sr, roll, r, { thump: 0.25, thumpF: 110, click: 0.1, clickF: 2000, clickDecay: 0.005 });
      scuff(out, sr, roll, r, { amp: 0.05, f: 2800, dur: 0.08 });
      grains(out, sr, roll, r, { count: 6, dur: 0.05, fLo: 3000, fHi: 7000, amp: 0.03 });
      break;
    case 'wood': // timber deck on joists: hollow knock
      impact(out, sr, 0, r, { thump: 0.5, thumpF: 110, click: 0.2 + hard * 0.35, clickF: 1100, clickQ: 0.7, clickDecay: 0.006 });
      addMode(out, sr, 0, 160 + r() * 30, 0.03, 0.22); addMode(out, sr, 0, 290 + r() * 40, 0.022, 0.16); addMode(out, sr, 0, 470 + r() * 50, 0.016, 0.12); addMode(out, sr, 0, 950 + r() * 80, 0.01, 0.1);
      impact(out, sr, roll, r, { thump: 0.25, thumpF: 140, click: 0.08, clickF: 1200, clickDecay: 0.006 });
      addMode(out, sr, roll, 175, 0.025, 0.1);
      if (r() < 0.25) addMode(out, sr, roll + Math.floor(0.03 * sr), 620 + r() * 200, 0.02, 0.05); // board creak-tick
      break;
    case 'metal': // escalator step / chequer plate: inharmonic clang + rattle
      impact(out, sr, 0, r, { thump: 0.45, thumpF: 100, click: 0.15 + hard * 0.3, clickF: 3000, clickDecay: 0.003 });
      for (const [f, d, a] of [[612, 0.022, 0.10], [1134, 0.018, 0.09], [1876, 0.014, 0.08], [2690, 0.01, 0.07], [3920, 0.007, 0.05]]) addMode(out, sr, 0, f * (0.97 + r() * 0.06), d, a);
      impact(out, sr, roll, r, { thump: 0.2, thumpF: 120, click: 0.1, clickF: 2500, clickDecay: 0.003 });
      for (let k = 0; k < 3; k++) addMode(out, sr, Math.floor((0.012 + k * 0.011 + r() * 0.005) * sr), 2200 + r() * 1800, 0.004, 0.035);
      break;
    case 'paving': // outdoor concrete pavers with grit
      impact(out, sr, 0, r, { thump: 0.65, thumpF: 80, click: 0.1 + hard * 0.4, clickF: 2000, clickQ: 0.6, clickDecay: 0.003 });
      scuff(out, sr, roll, r, { amp: 0.09, f: 3200, q: 0.5, dur: 0.09 });
      grains(out, sr, 0, r, { count: 22, dur: 0.11, fLo: 2500, fHi: 9000, amp: 0.06, decay: 0.0008 });
      impact(out, sr, roll, r, { thump: 0.25, thumpF: 100, click: 0.06, clickF: 1800, clickDecay: 0.004 });
      break;
    case 'gravel': // garden path gravel: crunch
      impact(out, sr, 0, r, { thump: 0.5, thumpF: 75, click: 0.04, clickF: 1500, clickDecay: 0.004 });
      grains(out, sr, 0, r, { count: 70, dur: 0.16, fLo: 1200, fHi: 7000, amp: 0.13, decay: 0.0012, shape: 1.6 });
      grains(out, sr, roll, r, { count: 40, dur: 0.1, fLo: 1500, fHi: 6000, amp: 0.09, decay: 0.001, shape: 1.4 });
      break;
    case 'grass': { // lawn: soft swish & muffled thud
      impact(out, sr, 0, r, { thump: 0.35, thumpF: 70, click: 0.0, clickF: 800, clickDecay: 0.004, lp: 1200 });
      const n = Math.floor(0.16 * sr), bp = new Biquad('bandpass', 1200, 0.6, 0, sr), lp = new Biquad('lowpass', 2200, 0.7, 0, sr);
      for (let i = 0; i < n; i++) { const t = i / n; out[i] += lp.tick(bp.tick(r() * 2 - 1)) * Math.sin(Math.PI * t) ** 2 * 0.12; }
      grains(out, sr, 0, r, { count: 8, dur: 0.12, fLo: 2000, fHi: 4500, amp: 0.015, decay: 0.002 });
      break; }
    default: // soft: vinyl / carpet / shop floors
      impact(out, sr, 0, r, { thump: 0.55, thumpF: 85, click: 0.06 + hard * 0.3, clickF: 1800, clickQ: 0.6, clickDecay: 0.003, lp: 3000 });
      impact(out, sr, roll, r, { thump: 0.2, thumpF: 100, click: 0.03, clickF: 1500, clickDecay: 0.004, lp: 3000 });
      scuff(out, sr, roll, r, { amp: 0.025, f: 1800, dur: 0.06 });
  }
  if (shoe === 'heel') heelClick(0.35, 2900 + r() * 700);
  if (shoe === 'leather') heelClick(0.12, 2100 + r() * 500);
  // tame very low end that mostly comes off the thump modes
  const hp = new Biquad('highpass', 70, 0.7, 0, sr);
  hp.run(out);
  // sneakers: ease the click's crest (~3 dB) so a step is a footfall, not a spike over a quiet bed
  if (shoe === 'sneaker') {
    normalize(out, 0.9); softclip(out, 2.2);
    // v3 "a bit loud, more subtle": a softer attack (2.5 ms raised-cosine onset instead of a hard first sample, so the
    // heel strike lands as a footfall rather than a tick) and the very top shaved off. The 1.5-4 kHz body of the click
    // stays, so a step on tile / stone / metal is still clearly audible. Level is set where it is played (audio.js _step).
    const on = Math.floor(0.0025 * sr);
    for (let i = 0; i < on && i < out.length; i++) out[i] *= 0.5 - 0.5 * Math.cos(Math.PI * i / on);
    new Biquad('lowpass', 6200, 0.6, 0, sr).run(out);
  }
  return normalize(out, 0.9);
}

// ---- UI sounds -------------------------------------------------------------------
function tone(sr, f, dur, { amp = 0.5, attack = 0.002, release = 0.01, shape = 'sine', bright = 4 } = {}) {
  const n = Math.floor((dur + release) * sr), out = new Float32Array(n);
  const lp = new Biquad('lowpass', Math.min(sr * 0.45, f * bright), 0.7, 0, sr);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    ph += f / sr; if (ph > 1) ph -= 1;
    let e = Math.min(1, i / (attack * sr));
    if (i > dur * sr) e *= Math.exp(-(i - dur * sr) / (release * sr));
    const s = shape === 'square' ? (ph < 0.5 ? 1 : -1) : Math.sin(TAU * ph);
    out[i] = (shape === 'square' ? lp.tick(s) : s) * e * amp;
  }
  return out;
}
function cat(sr, parts, total) {
  const out = new Float32Array(Math.floor(total * sr));
  for (const [t, buf, g = 1] of parts) { const o = Math.floor(t * sr); for (let i = 0; i < buf.length && o + i < out.length; i++) out[o + i] += buf[i] * g; }
  return out;
}
// IC card gate "pi!" — piezo-ish square beep + soft flap mechanism
export function gateOk(sr) {
  const r = rng(301);
  const beep = tone(sr, 2050, 0.13, { shape: 'square', amp: 0.35, release: 0.015, bright: 3 });
  const mech = new Float32Array(Math.floor(0.08 * sr)); addMode(mech, sr, 0, 420, 0.02, 0.15); addMode(mech, sr, 0, 1300, 0.01, 0.08);
  return normalize(cat(sr, [[0, beep], [0.02, mech, 0.6]], 0.4), 0.7);
}
// low-balance: the double beep
export function gateLow(sr) {
  const b = tone(sr, 2050, 0.07, { shape: 'square', amp: 0.35, release: 0.01, bright: 3 });
  return normalize(cat(sr, [[0, b], [0.12, b]], 0.4), 0.7);
}
// rejected: flaps slam shut + error chime (two-tone, repeated)
export function gateFail(sr) {
  const r = rng(302);
  const slam = new Float32Array(Math.floor(0.25 * sr));
  for (const o of [0, 0.018]) { addMode(slam, sr, Math.floor(o * sr), 180, 0.04, 0.5); addMode(slam, sr, Math.floor(o * sr), 760, 0.02, 0.25); addMode(slam, sr, Math.floor(o * sr), 2300, 0.008, 0.15); }
  const hi = tone(sr, 1175, 0.18, { amp: 0.3, release: 0.12 }), lo = tone(sr, 932, 0.25, { amp: 0.3, release: 0.15 });
  const b = tone(sr, 2050, 0.06, { shape: 'square', amp: 0.3, bright: 3 });
  return normalize(cat(sr, [[0, b], [0.09, b], [0.18, b], [0.05, slam], [0.35, hi], [0.6, lo], [1.0, hi], [1.25, lo]], 1.8), 0.75);
}
export function phoneOpen(sr) {
  const r = rng(303);
  const n = Math.floor(0.22 * sr), sw = new Float32Array(n), bp = new Biquad('bandpass', 1000, 1.2, 0, sr);
  for (let i = 0; i < n; i++) { const t = i / n; bp.set('bandpass', 700 + 2600 * t, 1.4); sw[i] = bp.tick(r() * 2 - 1) * Math.sin(Math.PI * t) * 0.12; }
  const tick = new Float32Array(Math.floor(0.06 * sr)); addMode(tick, sr, 0, 1650, 0.012, 0.25); addMode(tick, sr, 0, 3300, 0.006, 0.1);
  return normalize(cat(sr, [[0, sw], [0.14, tick]], 0.35), 0.5);
}
export function phoneClose(sr) {
  const r = rng(304);
  const n = Math.floor(0.18 * sr), sw = new Float32Array(n), bp = new Biquad('bandpass', 1000, 1.2, 0, sr);
  for (let i = 0; i < n; i++) { const t = i / n; bp.set('bandpass', 3000 - 2400 * t, 1.4); sw[i] = bp.tick(r() * 2 - 1) * Math.sin(Math.PI * t) * 0.1; }
  const tick = new Float32Array(Math.floor(0.06 * sr)); addMode(tick, sr, 0, 1100, 0.012, 0.25);
  return normalize(cat(sr, [[0, sw], [0.12, tick]], 0.3), 0.45);
}
// vibration: phone motor (~170 Hz, rich harmonics, rattling against fabric)
export function notify(sr) {
  const r = rng(305);
  const n = Math.floor(1.0 * sr), out = new Float32Array(n);
  let ph = 0;
  const lp = new Biquad('lowpass', 900, 0.8, 0, sr);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const on = (t < 0.32 || (t > 0.48 && t < 0.8)) ? 1 : 0;
    ph += (168 + 6 * Math.sin(TAU * 7 * t)) / sr;
    const s = Math.sign(Math.sin(TAU * ph)) * 0.6 + Math.sin(TAU * ph * 2) * 0.3 + (r() - 0.5) * 0.25;
    out[i] = lp.tick(s) * on;
  }
  onePoleLP(out, sr, 2500);
  // ramp edges per pulse
  const env = new Float32Array(n); for (let i = 0; i < n; i++) { const t = i / sr; env[i] = t < 0.32 ? Math.min(1, t / 0.02, (0.32 - t) / 0.02) : t > 0.48 && t < 0.8 ? Math.min(1, (t - 0.48) / 0.02, (0.8 - t) / 0.02) : 0; out[i] *= env[i]; }
  return normalize(out, 0.5);
}
// meal-ticket machine: button beep + printer whirr + ticket drop
export function order(sr) {
  const r = rng(306);
  const beep = tone(sr, 1568, 0.09, { shape: 'square', amp: 0.3, bright: 2.5 });
  const n = Math.floor(0.7 * sr), whirr = new Float32Array(n);
  let ph = 0; const bp = new Biquad('bandpass', 2400, 1.5, 0, sr);
  for (let i = 0; i < n; i++) { const t = i / sr; ph += 95 / sr; whirr[i] = (bp.tick(r() * 2 - 1) * 0.5 + Math.sin(TAU * ph * 3) * 0.2) * (0.5 + 0.5 * Math.sin(TAU * 38 * t)) * Math.min(1, t / 0.05, (0.7 - t) / 0.05) * 0.4; }
  const drop = new Float32Array(Math.floor(0.1 * sr)); addMode(drop, sr, 0, 900, 0.01, 0.1); addMode(drop, sr, 0, 2500, 0.005, 0.06);
  const coin = new Float32Array(Math.floor(0.4 * sr)); for (const [f, d, a] of [[2150, 0.25, 0.1], [5400, 0.12, 0.06], [3900, 0.15, 0.05]]) addMode(coin, sr, 0, f, d, a);
  return normalize(cat(sr, [[0, beep], [0.15, whirr], [0.9, drop], [1.0, coin, 0.6]], 1.5), 0.6);
}
// IC/QR payment at a register: two-tone reader chirp + drawer
export function pay(sr) {
  const a = tone(sr, 1760, 0.08, { amp: 0.35, release: 0.03, shape: 'square', bright: 2.5 }), b = tone(sr, 2637, 0.16, { amp: 0.3, release: 0.08, shape: 'square', bright: 2.5 });
  const r = rng(307);
  const drawer = new Float32Array(Math.floor(0.4 * sr));
  { const bp = new Biquad('bandpass', 800, 0.8, 0, sr); for (let i = 0; i < 0.15 * sr; i++) drawer[i] = bp.tick(r() * 2 - 1) * 0.15 * (1 - i / (0.15 * sr)); addMode(drawer, sr, Math.floor(0.15 * sr), 260, 0.05, 0.4); addMode(drawer, sr, Math.floor(0.15 * sr), 3100, 0.08, 0.06); }
  return normalize(cat(sr, [[0, a], [0.09, b], [0.45, drawer]], 1.0), 0.6);
}
// ceramic cup set on a saucer
export function cup(sr) {
  const r = rng(308);
  const out = new Float32Array(Math.floor(0.6 * sr));
  for (const o of [0, 0.022]) {
    const s = Math.floor(o * sr), a = o ? 0.4 : 1;
    for (const [f, d, g] of [[2240, 0.09, 0.3], [3610, 0.06, 0.2], [5870, 0.04, 0.12], [7900, 0.02, 0.06], [420, 0.02, 0.15]]) addMode(out, sr, s, f * (0.98 + r() * 0.04), d, g * a);
  }
  return normalize(out, 0.55);
}
// small "irasshaimase"-free clerk tap / counter bell
export function counterBell(sr) {
  const out = new Float32Array(Math.floor(2 * sr));
  for (const [f, d, a] of [[2637, 0.8, 0.3], [6210, 0.3, 0.12], [4410, 0.4, 0.1], [9800, 0.1, 0.04]]) addMode(out, sr, 0, f, d, a);
  return normalize(out, 0.5);
}

// ---- loops: cooking, coffee, machinery --------------------------------------------
// Tempura frying: dense, delicate crackle of tiny bursting bubbles over a soft
// oil hiss. Bubble pops follow a power-law size distribution; density breathes.
export function tempuraLoop(sr, seconds = 9) {
  const r = rng(401);
  const n = Math.floor(seconds * sr), m = Math.floor(0.3 * sr);
  const out = new Float32Array(n + m);
  const dens = smoothRandom(n + m, sr, 0.7, r);
  // hiss bed
  const hiss = white(n + m, r); filt(hiss, sr, ['highpass', 2500, 0.6], ['lowpass', 11000, 0.5], ['peaking', 6000, 0.8, 3]);
  for (let i = 0; i < n + m; i++) out[i] = hiss[i] * 0.035 * (0.8 + 0.2 * dens[i]);
  // crackle: ~650 pops/s average
  let t = 0;
  while (t < n + m - 200) {
    const d = 0.5 + 0.5 * (dens[Math.floor(t)] + 1) * 0.6;
    t += Math.floor(-Math.log(1 - r()) * sr / (650 * d));
    const size = Math.pow(r(), 3.5);             // mostly tiny
    const f = 2800 + (1 - size) * 6500 + r() * 1500;
    const a = 0.04 + size * 0.5;
    // pop = very short damped resonance with sharp onset
    addMode(out, sr, t, f, 0.0004 + size * 0.0016, a, Math.PI / 2);
    if (size > 0.5) addMode(out, sr, t + 3, f * 0.55, 0.002, a * 0.4);
  }
  // occasional sputters (water droplets in batter): bursts of 6-15 rapid pops
  for (let k = 0; k < seconds * 0.8; k++) {
    const s = Math.floor(r() * n);
    const cnt = 6 + Math.floor(r() * 10);
    for (let j = 0; j < cnt; j++) addMode(out, sr, s + Math.floor(j * (0.006 + r() * 0.01) * sr), 2500 + r() * 5000, 0.0008 + r() * 0.0015, 0.15 + r() * 0.25, Math.PI / 2);
  }
  const hp = new Biquad('highpass', 900, 0.7, 0, sr); hp.run(out);
  return normalize(foldLoop(out, sr, n, 0.3), 0.6);
}
// Takoyaki / teppan sizzle: louder, lower, steamier than tempura + pick clinks
export function sizzleLoop(sr, seconds = 8) {
  const r = rng(402);
  const n = Math.floor(seconds * sr), m = Math.floor(0.3 * sr);
  const out = new Float32Array(n + m);
  const sw = smoothRandom(n + m, sr, 0.5, r);
  const hiss = pink(n + m, r); filt(hiss, sr, ['highpass', 1400, 0.6], ['peaking', 4200, 0.7, 4], ['lowpass', 9000, 0.6]);
  for (let i = 0; i < n + m; i++) out[i] = hiss[i] * 0.22 * (0.75 + 0.25 * sw[i]);
  let t = 0;
  while (t < n + m - 200) {
    t += Math.floor(-Math.log(1 - r()) * sr / 260);
    const size = Math.pow(r(), 2.5);
    addMode(out, sr, t, 1800 + (1 - size) * 4500, 0.0007 + size * 0.003, 0.05 + size * 0.35, Math.PI / 2);
  }
  // metal picks turning balls on cast iron (takoyaki rhythm: clusters)
  for (let k = 0; k < seconds * 1.6; k++) {
    const s = Math.floor(r() * n);
    for (const [f, d, a] of [[3150, 0.05, 0.12], [4720, 0.03, 0.08], [6800, 0.015, 0.05], [1240, 0.02, 0.06]]) addMode(out, sr, s, f * (0.97 + r() * 0.06), d, a);
  }
  return normalize(foldLoop(out, sr, n, 0.3), 0.6);
}
// Wok/kitchen clatter bed for ramen/izakaya: ladles, bowls, extractor fan
export function kitchenLoop(sr, seconds = 10) {
  const r = rng(403);
  const n = Math.floor(seconds * sr), m = Math.floor(0.4 * sr);
  const out = new Float32Array(n + m);
  const fan = brown(n + m, r); filt(fan, sr, ['lowpass', 500, 0.6], ['peaking', 180, 2, 6]);
  for (let i = 0; i < n + m; i++) out[i] = fan[i] * 0.25 + Math.sin(TAU * 118 * i / sr) * 0.01;
  for (let k = 0; k < seconds * 1.4; k++) {
    const s = Math.floor(r() * n), kind = r();
    if (kind < 0.5) for (const [f, d, a] of [[1900, 0.12, 0.08], [3150, 0.08, 0.05], [5200, 0.05, 0.03]]) addMode(out, sr, s, f * (0.85 + r() * 0.3), d, a); // bowl
    else if (kind < 0.8) for (const [f, d, a] of [[880, 0.2, 0.06], [2350, 0.12, 0.05], [4100, 0.06, 0.03]]) addMode(out, sr, s, f * (0.9 + r() * 0.2), d, a); // ladle on pot
    else { const bp = new Biquad('bandpass', 1200, 0.8, 0, sr); for (let i = 0; i < 0.25 * sr && s + i < out.length; i++) out[s + i] += bp.tick(r() * 2 - 1) * 0.05 * Math.sin(Math.PI * i / (0.25 * sr)); } // water pour / rinse
  }
  return normalize(foldLoop(out, sr, n, 0.4), 0.5);
}
// espresso steam wand (milk stretching): one-shot ~3.5 s
export function steam(sr) {
  const r = rng(404);
  const n = Math.floor(3.6 * sr), out = new Float32Array(n);
  const bp = new Biquad('bandpass', 4500, 0.9, 0, sr), bp2 = new Biquad('bandpass', 1400, 1.5, 0, sr);
  const g = smoothRandom(n, sr, 9, r);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const env = Math.min(1, t / 0.08) * Math.min(1, (3.6 - t) / 0.3);
    const stretch = t < 1.4 ? 1 : 0.3; // first: paper-tearing stretch, then rolling
    const w = r() * 2 - 1;
    out[i] = (bp.tick(w) * 0.5 + bp2.tick(w) * 0.35 * stretch * (0.5 + 0.5 * g[i])) * env;
  }
  return normalize(out, 0.5);
}
// coffee grinder: motor + bean crunch, ~2.5 s
export function grinder(sr) {
  const r = rng(405);
  const n = Math.floor(2.6 * sr), out = new Float32Array(n);
  let ph = 0;
  const bp = new Biquad('bandpass', 2600, 0.7, 0, sr);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const env = Math.min(1, t / 0.15) * Math.min(1, (2.6 - t) / 0.25);
    const f = 140 + 30 * Math.min(1, t / 0.3);
    ph += f / sr;
    const motor = Math.sin(TAU * ph) * 0.3 + Math.sin(TAU * ph * 2) * 0.25 + Math.sin(TAU * ph * 4) * 0.12 + Math.sin(TAU * ph * 7) * 0.06;
    out[i] = (motor + bp.tick(r() * 2 - 1) * 0.5) * env;
  }
  grains(out, sr, 0, r, { count: 900, dur: 2.4, fLo: 1500, fHi: 7000, amp: 0.25, decay: 0.0008 });
  return normalize(out, 0.5);
}
// gacha: crank ratchet + capsule drop + roll
export function gacha(sr) {
  const r = rng(406);
  const out = new Float32Array(Math.floor(2.6 * sr));
  for (let k = 0; k < 7; k++) { const s = Math.floor((k * 0.11 + r() * 0.01) * sr); addMode(out, sr, s, 1800 + r() * 300, 0.008, 0.25); addMode(out, sr, s, 3400 + r() * 400, 0.005, 0.15); addMode(out, sr, s, 520, 0.01, 0.1); }
  // capsule drop & bounce in the tray (decreasing intervals)
  let t = 0.95, gap = 0.12, a = 0.5;
  for (let k = 0; k < 9; k++) { const s = Math.floor(t * sr); addMode(out, sr, s, 950 + r() * 200, 0.02, a); addMode(out, sr, s, 2300 + r() * 500, 0.012, a * 0.6); addMode(out, sr, s, 4400 + r() * 600, 0.006, a * 0.3); t += gap; gap *= 0.7; a *= 0.7; }
  // rattling contents
  grains(out, sr, Math.floor(1.0 * sr), r, { count: 30, dur: 0.5, fLo: 2000, fHi: 6000, amp: 0.08, decay: 0.002 });
  return normalize(out, 0.6);
}
// Spinner suitcase: wheel roll over 60 cm tiles at 1.3 m/s, front/rear pair
export function suitcaseLoop(sr) {
  const r = rng(407);
  const period = 0.6 / 1.3, reps = 8, seconds = period * reps;
  const n = Math.floor(seconds * sr), out = new Float32Array(n);
  const rough = foldLoop(smoothRandom(n + Math.floor(0.05 * sr), sr, 60, r), sr, n, 0.05);
  const bp = new Biquad('bandpass', 520, 0.8, 0, sr), bp2 = new Biquad('bandpass', 1800, 1.2, 0, sr);
  for (let pass = 0; pass < 2; pass++) for (let i = 0; i < n; i++) { const w = r() * 2 - 1; const v = (bp.tick(w) * 0.35 + bp2.tick(w) * 0.12) * (0.7 + 0.3 * rough[i]); if (pass) out[i] = v; }
  for (let k = 0; k < reps; k++) for (const o of [0, 0.29]) {
    const s = Math.floor((k * period + o * period + (r() - 0.5) * 0.004) * sr) % n;
    for (const [f, d, a] of [[720, 0.015, 0.4], [1350, 0.01, 0.3], [2450, 0.006, 0.2], [4300, 0.004, 0.1]]) addMode(out, sr, s, f * (0.95 + r() * 0.1), d, a);
    if (r() < 0.5) addMode(out, sr, s + Math.floor(0.01 * sr), 3800 + r() * 900, 0.012, 0.05); // handle rattle
  }
  // wrap tails
  return normalize(out, 0.55);
}
// Escalator machinery: motor hum (60 Hz mains, Osaka), gear whine, step
// combplate ticks at 1.25 Hz, chain roll
export function escalatorLoop(sr) {
  const r = rng(408);
  // 6.4 s loop: drive hum, step-comb clicks (one tread every 0.8 s), chain rattle, handrail rubber hiss
  const period = 0.8, reps = 8, n = Math.floor(period * reps * sr), out = new Float32Array(n);
  const extra = Math.floor(0.2 * sr);
  const roll = foldLoop(filt(brown(n + extra, r), sr, ['lowpass', 420, 0.7]), sr, n, 0.2);
  const chain = foldLoop(filt(white(n + extra, r), sr, ['bandpass', 1100, 0.9], ['highpass', 500, 0.7]), sr, n, 0.2);
  const hiss = foldLoop(filt(white(n + extra, r), sr, ['bandpass', 3100, 0.7], ['highpass', 2000, 0.7]), sr, n, 0.2);
  const wob = smoothRandom(n, sr, 0.5, r);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    // phase-continuous: frequencies chosen as multiples of 1/(period*reps)
    const hum = Math.sin(TAU * 120 * t) * 0.07 + Math.sin(TAU * 180 * t) * 0.045 + Math.sin(TAU * 240 * t) * 0.03 + Math.sin(TAU * 360 * t) * 0.015;
    const whine = Math.sin(TAU * 472.5 * t + 0.6 * Math.sin(TAU * 1.25 * t)) * 0.02;
    const links = 0.5 + 0.5 * Math.sin(TAU * 25 * t); // chain links ~25 Hz flutter
    out[i] = roll[i] * 0.3 + hum + whine + chain[i] * (0.05 + 0.04 * links) + hiss[i] * (0.03 + 0.02 * wob[i]);
  }
  for (let k = 0; k < reps; k++) {
    const s = Math.floor(k * period * sr), a = 0.8 + 0.4 * r();
    addMode(out, sr, s, 1450 + r() * 100, 0.012, 0.2 * a); addMode(out, sr, s, 380, 0.025, 0.2 * a); addMode(out, sr, s + Math.floor(0.012 * sr), 2300 + r() * 300, 0.006, 0.12 * a);
    addMode(out, sr, s + Math.floor(0.05 * sr), 2600, 0.005, 0.07 * a);
  }
  return normalize(out, 0.5);
}
// refrigerated display case / conbini fridge hum
export function fridgeLoop(sr) {
  const r = rng(409);
  const n = Math.floor(6 * sr), out = new Float32Array(n);
  const nz = foldLoop(filt(pink(n + Math.floor(0.2 * sr), r), sr, ['bandpass', 900, 0.6]), sr, n, 0.2);
  for (let i = 0; i < n; i++) { const t = i / sr; out[i] = Math.sin(TAU * 60 * t) * 0.15 + Math.sin(TAU * 120 * t) * 0.12 + Math.sin(TAU * 300 * t) * 0.02 + nz[i] * 0.08; }
  return normalize(out, 0.4);
}

// soft UI select tick
export function select(sr) {
  const out = new Float32Array(Math.floor(0.08 * sr));
  addMode(out, sr, 0, 2400, 0.008, 0.3); addMode(out, sr, 0, 4800, 0.004, 0.1);
  return normalize(out, 0.35);
}
// cloth / bag rustle (brushing past someone)
export function rustle(sr) {
  const r = rng(310);
  const n = Math.floor(0.35 * sr), out = new Float32Array(n);
  const bp = new Biquad('bandpass', 2200, 0.6, 0, sr);
  for (let i = 0; i < n; i++) { const t = i / n; out[i] = bp.tick(r() * 2 - 1) * Math.sin(Math.PI * t) ** 1.5 * (0.6 + 0.4 * Math.sin(TAU * 13 * t)); }
  addMode(out, sr, Math.floor(0.05 * sr), 140, 0.03, 0.4);
  return normalize(out, 0.4);
}


// ---- rubber squeak on polished floor (stick-slip, 1.4-3 kHz) -------------------------
export function squeak(sr, seed = 0) {
  const r = rng(seed * 4099 + 31);
  const dur = 0.08 + r() * 0.1, n = Math.floor(dur * sr), out = new Float32Array(n);
  const f0 = 1500 + r() * 1300, sweep = (r() - 0.4) * 900, stick = 55 + r() * 60;
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n, f = f0 + sweep * t;
    ph += f / sr;
    const slip = 0.55 + 0.45 * Math.sign(Math.sin(TAU * stick * i / sr)) * 0.6 + 0.4 * Math.sin(TAU * stick * i / sr);
    const e = Math.sin(Math.PI * t) ** 0.7;
    out[i] = (Math.sin(TAU * ph) + 0.35 * Math.sin(TAU * ph * 2.01) + 0.08 * (r() * 2 - 1)) * e * slip;
  }
  new Biquad('highpass', 900, 0.7, 0, sr).run(out);
  return normalize(out, 0.5);
}

// ---- a gust of open air: stepping out of the station into the street / garden ----------
export function gust(sr, seed = 0) {
  const r = rng(seed * 977 + 5);
  const n = Math.floor(3.6 * sr), out = new Float32Array(n);
  const lp = new Biquad('lowpass', 500, 0.9, 0, sr), bp = new Biquad('bandpass', 900, 0.6, 0, sr);
  const mod = smoothRandom(n, sr, 3, r);
  for (let i = 0; i < n; i++) {
    const t = i / n, env = Math.sin(Math.PI * Math.min(1, t * 1.05)) ** 1.6;
    const w = r() * 2 - 1;
    out[i] = (lp.tick(w) * 1.4 + bp.tick(w) * (0.5 + 0.8 * Math.max(0, mod[i]))) * env;
  }
  return normalize(out, 0.7);
}
