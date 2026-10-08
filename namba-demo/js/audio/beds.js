// =============================================================================
// Ambience synthesis (worker-safe): seamless stereo beds (air handling,
// tunnels, traffic, distant city, leaves, water, crowd footstep texture) and
// one-shot nature/street calls (birds, crows, crossing signals, horns).
// =============================================================================
import { TAU, rng, Biquad, white, pink, brown, smoothRandom, foldLoop, filt, normalize, addMode, clamp, onePoleLP } from './dsp.js?v=488c31e';
import { footstep } from './foley.js?v=488c31e';

const XF = 0.5; // loop crossfade seconds
function loopStereo(sr, seconds, gen) {
  const n = Math.floor(seconds * sr), m = Math.floor(XF * sr);
  const L = new Float32Array(n + m), R = new Float32Array(n + m);
  gen(L, R, n + m);
  return [foldLoop(L, sr, n, XF), foldLoop(R, sr, n, XF)];
}
function norm2([L, R], target) {
  let p = 0; for (const c of [L, R]) for (let i = 0; i < c.length; i++) p = Math.max(p, Math.abs(c[i]));
  if (p > 0) for (const c of [L, R]) for (let i = 0; i < c.length; i++) c[i] *= target / p;
  return [L, R];
}

// Air handling / room tone. variant: tile | arcade | big | mall | dept
export function hvac(sr, variant = 'tile', seconds = 12) {
  const r = rng(500 + variant.length * 13);
  const v = {
    tile:   { rumble: 0.22, air: 0.3, hiss: 0.05, hum: 0.018, fan: 0, airF: 900 },
    arcade: { rumble: 0.2, air: 0.3, hiss: 0.035, hum: 0.014, fan: 0.02, airF: 750 },
    big:    { rumble: 0.22, air: 0.35, hiss: 0.03, hum: 0.008, fan: 0, airF: 600 },
    mall:   { rumble: 0.2, air: 0.3, hiss: 0.04, hum: 0.008, fan: 0.012, airF: 800 },
    dept:   { rumble: 0.16, air: 0.25, hiss: 0.03, hum: 0.006, fan: 0, airF: 750 },
  }[variant] || {};
  return norm2(loopStereo(sr, seconds, (L, R, n) => {
    for (const [ch, k] of [[L, 0], [R, 1]]) {
      const rb = filt(brown(n, r), sr, ['lowpass', 140, 0.7]);
      const air = filt(pink(n, r), sr, ['bandpass', v.airF, 0.5]);
      const hs = filt(white(n, r), sr, ['highpass', 3500, 0.7], ['lowpass', 9000, 0.7]);
      const sw = smoothRandom(n, sr, 0.15, r);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const hum = (Math.sin(TAU * 120 * t + k) * 1 + Math.sin(TAU * 180.25 * t) * 0.6 + Math.sin(TAU * 240 * t + 2 * k) * 0.35) * v.hum;
        const fan = v.fan ? Math.sin(TAU * 97 * t + Math.sin(TAU * 0.5 * t)) * v.fan * (0.7 + 0.3 * sw[i]) : 0;
        ch[i] = rb[i] * v.rumble * (0.85 + 0.15 * sw[i]) + air[i] * v.air + hs[i] * v.hiss + hum + fan;
      }
    }
  }), 0.6);
}

// Tunnel: deep rumble, slow wind breathing, organ-pipe moan of the bore
export function tunnel(sr, seconds = 16) {
  const r = rng(510);
  return norm2(loopStereo(sr, seconds, (L, R, n) => {
    for (const ch of [L, R]) {
      const rb = filt(brown(n, r), sr, ['lowpass', 90, 0.7]);
      const wind = filt(pink(n, r), sr, ['bandpass', 420, 0.7]);
      const moan = filt(white(n, r), sr, ['bandpass', 68, 12], ['bandpass', 68, 6]);
      const moan2 = filt(white(n, r), sr, ['bandpass', 137, 14]);
      const g = smoothRandom(n, sr, 0.12, r), g2 = smoothRandom(n, sr, 0.3, r);
      for (let i = 0; i < n; i++) {
        const w = Math.max(0, 0.55 + 0.45 * g[i]);
        ch[i] = rb[i] * 0.8 + wind[i] * 0.22 * w * w + moan[i] * 2.5 * (0.6 + 0.4 * g2[i]) + moan2[i] * 1.2 * w;
      }
    }
  }), 0.6);
}

// Street traffic on a wide avenue: tyre roar, passes with pan + filter sweep,
// buses (diesel firing), scooters. Japanese traffic: steady, few horns.
export function traffic(sr, seconds = 24) {
  const r = rng(520);
  const nl = Math.floor(seconds * sr);
  return norm2(loopStereo(sr, seconds, (L, R, n) => {
    const bed = filt(pink(n, r), sr, ['lowpass', 900, 0.6], ['highpass', 45, 0.7]);
    const bedR = filt(pink(n, r), sr, ['lowpass', 900, 0.6], ['highpass', 45, 0.7]);
    const sw = smoothRandom(n, sr, 0.1, r);
    for (let i = 0; i < n; i++) { L[i] = bed[i] * 0.13 * (0.8 + 0.2 * sw[i]); R[i] = bedR[i] * 0.13 * (0.8 + 0.2 * sw[i]); }
    const passes = 26;
    for (let k = 0; k < passes; k++) {
      const kind = k % 9 === 4 ? 'bus' : k % 13 === 7 ? 'scooter' : 'car';
      const tc = (k + r() * 0.8) / passes * seconds;        // closest-approach time
      const dur = kind === 'bus' ? 3.2 : 2.2;
      const dir = r() < 0.5 ? -1 : 1;
      const dist = 0.4 + r() * 0.6;                         // 0.4 near lane .. 1 far lane
      const gain = (kind === 'bus' ? 1.3 : kind === 'scooter' ? 0.6 : 1) * (1.2 - dist * 0.6);
      const f0 = kind === 'bus' ? 28 : kind === 'scooter' ? 115 : 38 + r() * 25;
      const s0 = Math.floor((tc - dur * 1.6) * sr), s1 = Math.floor((tc + dur * 1.6) * sr);
      const bp = new Biquad('lowpass', 800, 0.7, 0, sr), tyre = new Biquad('bandpass', 1400, 0.7, 0, sr);
      let ph = 0;
      for (let s = s0; s < s1; s++) {
        const t = s / sr - tc;
        const x = t / dur;
        const env = Math.exp(-x * x * 2.2) / (1 + dist);
        if ((s & 63) === 0) bp.set('lowpass', 250 + 1700 * Math.exp(-x * x * 3) * (1.1 - dist * 0.5), 0.7);
        const dop = 1 - 0.045 * Math.tanh(x * 3) * (1.2 - dist);  // approaching high, receding low
        ph += f0 * dop / sr;
        const eng = kind === 'scooter' ? ((ph % 1) * 2 - 1) * 0.5 : (Math.sin(TAU * ph) + 0.6 * Math.sin(TAU * ph * 2) + 0.4 * Math.sin(TAU * ph * 3) + 0.25 * Math.sin(TAU * ph * 4.5));
        const w = r() * 2 - 1;
        const v = (bp.tick(w) * 1.4 + tyre.tick(w) * 0.22 + eng * (kind === 'car' ? 0.08 : 0.2)) * env * gain;
        const pan = clamp(Math.tanh(x * 1.5) * dir * (1 - dist * 0.4), -1, 1);
        const a = (pan + 1) * Math.PI / 4;
        // write modulo the loop length, mirroring the head into the overhang
        // so the fold crossfade sees the same pass on both sides
        const j = ((s % nl) + nl) % nl;
        L[j] += v * Math.cos(a); R[j] += v * Math.sin(a);
        if (j < n - nl) { L[j + nl] += v * Math.cos(a); R[j + nl] += v * Math.sin(a); }
      }
    }
  }), 0.6);
}

// Distant city from a rooftop garden: low wash, far traffic swells, a far
// train on elevated tracks now and then.
export function cityFar(sr, seconds = 20) {
  const r = rng(530);
  return norm2(loopStereo(sr, seconds, (L, R, n) => {
    for (const ch of [L, R]) {
      const a = filt(brown(n, r), sr, ['lowpass', 260, 0.6]);
      const b = filt(pink(n, r), sr, ['lowpass', 700, 0.6], ['highpass', 90, 0.7]);
      const g = smoothRandom(n, sr, 0.18, r);
      for (let i = 0; i < n; i++) ch[i] = a[i] * 0.7 + b[i] * 0.25 * (0.6 + 0.4 * g[i]);
    }
    // a distant elevated train (Nankai) passing: rumbling swell with soft joints
    const tc = seconds * 0.55, s0 = Math.floor((tc - 6) * sr), s1 = Math.floor((tc + 6) * sr);
    const lp = new Biquad('lowpass', 300, 0.7, 0, sr);
    for (let s = s0; s < s1; s++) {
      const x = (s / sr - tc) / 3.5, env = Math.exp(-x * x);
      const j = ((s % n) + n) % n, v = lp.tick(r() * 2 - 1) * env * 0.5;
      L[j] += v * (0.8 - 0.3 * Math.tanh(x)); R[j] += v * (0.8 + 0.3 * Math.tanh(x));
    }
  }), 0.5);
}

// Wind in leaves: gusty hiss with granular leaf rustle following the gusts
export function leaves(sr, seconds = 16) {
  const r = rng(540);
  return norm2(loopStereo(sr, seconds, (L, R, n) => {
    const gust = smoothRandom(n, sr, 0.22, r);
    for (const [ch, off] of [[L, 0], [R, 0.35]]) {
      const hs = filt(pink(n, r), sr, ['highpass', 650, 0.6], ['lowpass', 7500, 0.6], ['peaking', 2800, 0.7, 3]);
      const delay = Math.floor(off * sr);
      for (let i = 0; i < n; i++) {
        const g = 0.5 + 0.5 * gust[(i + delay) % n];
        ch[i] = hs[i] * (0.15 + 0.85 * g * g) * 0.5;
      }
      // rustle grains: density follows gust
      let t = 0;
      while (t < n - 100) {
        const g = 0.5 + 0.5 * gust[(t + delay) % n];
        t += Math.floor(-Math.log(1 - r()) * sr / (40 + 500 * g * g));
        addMode(ch, sr, t, 1800 + r() * 5200, 0.0015 + r() * 0.002, (0.02 + r() * 0.05) * (0.3 + g), r() * TAU);
      }
    }
  }), 0.5);
}

// Water rill: Minnaert bubbles (rising chirps) over a soft babble
export function water(sr, seconds = 10) {
  const r = rng(550);
  return norm2(loopStereo(sr, seconds, (L, R, n) => {
    for (const ch of [L, R]) {
      const bab = filt(pink(n, r), sr, ['bandpass', 900, 0.5]);
      for (let i = 0; i < n; i++) ch[i] = bab[i] * 0.09;
      let t = 0;
      while (t < n - 2000) {
        t += Math.floor(-Math.log(1 - r()) * sr / 90);
        const rad = 0.0012 + Math.pow(r(), 2) * 0.006;       // m
        const f0 = 3.26 / rad;                               // Minnaert (Hz)
        const d = 0.004 + rad * 4;                            // larger bubbles ring longer
        const a = (0.05 + r() * 0.15) * Math.sqrt(rad / 0.004);
        const len = Math.min(Math.floor(d * 6 * sr), n - t);
        let ph = 0;
        for (let i = 0; i < len; i++) {
          const tt = i / sr;
          ph += f0 * (1 + 0.08 * f0 * tt * 0.05) / sr;
          ch[t + i] += Math.sin(TAU * ph) * Math.exp(-tt / d) * a;
        }
      }
    }
  }), 0.5);
}

// Crowd footstep texture (distant, dense): granular population of steps on a
// hard floor, mixed sneakers / leather / heels. Used above the granular
// limit of the live footstep cloud.
export function stepTexture(sr, surface = 'stone', seconds = 8, rate = 28) {
  const r = rng(560 + surface.length);
  const bank = [];
  for (let i = 0; i < 10; i++) bank.push(footstep(sr, surface, 100 + i, i < 5 ? 'sneaker' : i < 8 ? 'leather' : 'heel'));
  return norm2(loopStereo(sr, seconds, (L, R, n) => {
    let t = 0;
    while (t < n) {
      t += Math.floor(-Math.log(1 - r()) * sr / rate);
      const b = bank[Math.floor(r() * bank.length)];
      const dist = 0.3 + r() * 0.7, g = 0.4 / (0.3 + dist), pan = (r() * 2 - 1) * 0.9;
      const lp = new Biquad('lowpass', 7000 - dist * 5000, 0.7, 0, sr);
      const a = (pan + 1) * Math.PI / 4, gl = Math.cos(a) * g, gr = Math.sin(a) * g;
      for (let i = 0; i < b.length; i++) { const j = (t + i) % n; const v = lp.tick(b[i]); L[j] += v * gl; R[j] += v * gr; }
    }
    // soften: distant crowd steps lose their extreme highs
    for (const ch of [L, R]) filt(ch, sr, ['highshelf', 6000, 0.7, -6]);
  }), 0.6);
}

// ---- nature & street one-shots (mono) ------------------------------------------
function sweepNote(out, sr, start, dur, fA, fB, amp, { fm = 0, fmRate = 0, harm = 0.15, noise = 0, curve = 1, r }) {
  const n = Math.floor(dur * sr);
  let ph = 0;
  for (let i = 0; i < n && start + i < out.length; i++) {
    const t = i / n;
    const f = fA + (fB - fA) * Math.pow(t, curve) + fm * Math.sin(TAU * fmRate * i / sr);
    ph += f / sr;
    const env = Math.sin(Math.PI * Math.min(1, t * 1.15)) ** 0.7 * (1 - t * 0.3);
    out[start + i] += (Math.sin(TAU * ph) + harm * Math.sin(2 * TAU * ph) + (noise ? (r() * 2 - 1) * noise : 0)) * env * amp;
  }
}
// brown-eared bulbul (hiyodori): loud, shrill "hii-yo!"
export function bulbul(sr, seed) {
  const r = rng(600 + seed);
  const out = new Float32Array(Math.floor(1.6 * sr));
  const reps = 1 + Math.floor(r() * 2);
  for (let k = 0; k < reps; k++) {
    const o = Math.floor((k * 0.62) * sr);
    sweepNote(out, sr, o, 0.26, 2300 + r() * 300, 4300 + r() * 500, 0.6, { fm: 160, fmRate: 210, harm: 0.25, noise: 0.05, curve: 0.6, r });
    sweepNote(out, sr, o + Math.floor(0.3 * sr), 0.16, 3900, 2600, 0.5, { fm: 120, fmRate: 180, harm: 0.2, r });
  }
  return normalize(out, 0.7);
}
// tree sparrow: rapid "chun chun"
export function sparrow(sr, seed) {
  const r = rng(610 + seed);
  const out = new Float32Array(Math.floor(1.4 * sr));
  const cnt = 2 + Math.floor(r() * 5);
  let t = 0;
  for (let k = 0; k < cnt; k++) {
    sweepNote(out, sr, Math.floor(t * sr), 0.05 + r() * 0.04, 5600 + r() * 600, 3800 + r() * 400, 0.5, { fm: 300, fmRate: 320, harm: 0.3, noise: 0.15, curve: 0.5, r });
    t += 0.1 + r() * 0.18;
  }
  return normalize(out, 0.6);
}
// Japanese white-eye (mejiro): fast high warble
export function whiteEye(sr, seed) {
  const r = rng(620 + seed);
  const out = new Float32Array(Math.floor(2.2 * sr));
  let t = 0, f = 4500 + r() * 1000;
  const cnt = 14 + Math.floor(r() * 14);
  for (let k = 0; k < cnt && t < 1.9; k++) {
    const d = 0.035 + r() * 0.04;
    const f2 = clamp(f + (r() - 0.5) * 2600, 3400, 7200);
    sweepNote(out, sr, Math.floor(t * sr), d, f, f2, 0.4 + r() * 0.2, { fm: 250, fmRate: 28, harm: 0.08, r });
    f = f2; t += d + 0.008 + r() * 0.02;
  }
  return normalize(out, 0.55);
}
// great tit (shijūkara): "tsu-pii tsu-pii"
export function tit(sr, seed) {
  const r = rng(630 + seed);
  const out = new Float32Array(Math.floor(2.0 * sr));
  const reps = 3 + Math.floor(r() * 2), hi = 6400 + r() * 500, lo = 4700 + r() * 300;
  for (let k = 0; k < reps; k++) {
    const o = k * 0.38;
    sweepNote(out, sr, Math.floor(o * sr), 0.07, hi, hi - 900, 0.5, { harm: 0.05, r });
    sweepNote(out, sr, Math.floor((o + 0.1) * sr), 0.13, lo, lo - 150, 0.45, { harm: 0.05, r });
  }
  return normalize(out, 0.55);
}
// jungle crow (hashibuto-garasu): nasal, harmonic "kaa… kaa"
export function crow(sr, seed) {
  const r = rng(640 + seed);
  const cnt = 2 + Math.floor(r() * 3);
  const out = new Float32Array(Math.floor((cnt * 0.75 + 0.5) * sr));
  const f1 = new Biquad('bandpass', 1250, 2.5, 0, sr), f2 = new Biquad('bandpass', 2300, 3, 0, sr), f0b = new Biquad('bandpass', 700, 1.5, 0, sr);
  for (let k = 0; k < cnt; k++) {
    const s = Math.floor(k * (0.62 + r() * 0.12) * sr), dur = 0.32 + r() * 0.14, n = Math.floor(dur * sr);
    const base = 470 + r() * 90;
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const f = base * (1.08 - 0.18 * t) * (1 + 0.03 * Math.sin(TAU * 31 * i / sr));
      ph += f / sr;
      const saw = 2 * (ph % 1) - 1;
      const rough = 1 + 0.5 * Math.sin(TAU * f * 0.5 * i / sr); // subharmonic roughness
      const x = saw * rough + (r() * 2 - 1) * 0.3;
      const env = Math.min(1, t / 0.08) * Math.pow(1 - t, 0.6);
      out[s + i] += (f1.tick(x) * 1.2 + f2.tick(x) * 0.6 + f0b.tick(x) * 0.8) * env;
    }
  }
  return normalize(out, 0.7);
}
// pedestrian crossing signals: 'piyo' (pi-yo, pi-yo) or 'kakko' (kak-kō)
export function crossing(sr, kind) {
  const r = rng(650);
  const period = kind === 'piyo' ? 1.0 : 1.4;
  const out = new Float32Array(Math.floor(period * 2 * sr));
  for (let k = 0; k < 2; k++) {
    const o = Math.floor(k * period * sr);
    if (kind === 'piyo') {
      sweepNote(out, sr, o, 0.08, 3100, 2300, 0.5, { harm: 0.05, curve: 0.7, r });
      sweepNote(out, sr, o + Math.floor(0.14 * sr), 0.12, 2700, 1950, 0.5, { harm: 0.05, curve: 0.7, r });
    } else {
      const g = k ? 0.75 : 1; // the answering speaker across the road is quieter
      sweepNote(out, sr, o, 0.11, 1180, 1150, 0.5 * g, { harm: 0.3, r });
      sweepNote(out, sr, o + Math.floor(0.2 * sr), 0.28, 945, 925, 0.5 * g, { harm: 0.3, r });
    }
  }
  // small horn speaker colouration
  filt(out, sr, ['highpass', 600, 0.7], ['peaking', 2400, 1, 4]);
  return normalize(out, 0.6);
}
// a short, polite car horn (rare)
export function horn(sr) {
  const n = Math.floor(0.42 * sr), out = new Float32Array(n);
  let a = 0, b = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr; a += 415 / sr; b += 498 / sr;
    const env = Math.min(1, t / 0.01) * (t < 0.3 ? 1 : Math.exp(-(t - 0.3) / 0.03));
    out[i] = (Math.tanh(Math.sin(TAU * a) * 3) + Math.tanh(Math.sin(TAU * b) * 3)) * env;
  }
  filt(out, sr, ['bandpass', 900, 0.6], ['peaking', 2200, 1, 4]);
  return normalize(out, 0.6);
}
// bus kneeling / brake air release + diesel idle swell
export function busAir(sr) {
  const r = rng(660);
  const n = Math.floor(3.5 * sr), out = new Float32Array(n);
  const bp = new Biquad('highpass', 1800, 0.7, 0, sr), lp = new Biquad('lowpass', 9000, 0.7, 0, sr);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const air = t > 0.3 ? Math.exp(-(t - 0.3) / 0.45) * Math.min(1, (t - 0.3) / 0.01) : 0;
    ph += 30 / sr;
    const idle = (Math.sin(TAU * ph) + 0.6 * Math.sin(2 * TAU * ph) + 0.3 * Math.sin(3.5 * TAU * ph)) * 0.25 * Math.min(1, t / 0.5) * Math.min(1, (3.5 - t) / 0.8);
    out[i] = lp.tick(bp.tick(r() * 2 - 1)) * air * 0.9 + idle;
  }
  return normalize(out, 0.6);
}
// distant train passing under / behind a wall: low rumble swell + joint thuds
export function trainDistant(sr, seed = 0) {
  const r = rng(670 + seed);
  const dur = 12, n = Math.floor(dur * sr), out = new Float32Array(n);
  const rb = filt(brown(n, r), sr, ['lowpass', 150, 0.7]);
  const mid = filt(pink(n, r), sr, ['lowpass', 500, 0.7]);
  for (let i = 0; i < n; i++) { const x = (i / sr - dur / 2) / 2.6, e = Math.exp(-x * x); out[i] = (rb[i] * 1.2 + mid[i] * 0.3 * e) * e; }
  // bogie joints: pairs every car (~18 m) at 16 m/s
  for (let c = 0; c < 10; c++) {
    const tc = dur / 2 - 2.8 + c * 1.12 * 0.5 + r() * 0.02;
    for (const o of [0, 0.14]) { const s = Math.floor((tc + o) * sr); const x = (tc - dur / 2) / 2.6; addMode(out, sr, s, 70 + r() * 15, 0.05, 0.6 * Math.exp(-x * x)); addMode(out, sr, s, 210, 0.02, 0.2 * Math.exp(-x * x)); }
  }
  return normalize(out, 0.7);
}
