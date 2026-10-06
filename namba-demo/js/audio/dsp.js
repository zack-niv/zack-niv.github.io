// =============================================================================
// DSP toolkit for offline sample synthesis (runs in the synthesis worker or on
// the main thread). Pure functions on Float32Arrays — no Web Audio, no DOM.
// =============================================================================
import { rng, hash } from '../core/rng.js';
export { rng, hash };

export const TAU = Math.PI * 2;
export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const dbToGain = (db) => Math.pow(10, db / 20);
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;

// ---- noise -----------------------------------------------------------------
export function white(n, r, out = new Float32Array(n)) {
  for (let i = 0; i < n; i++) out[i] = r() * 2 - 1;
  return out;
}
// Paul Kellet's refined pink filter
export function pink(n, r, out = new Float32Array(n)) {
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = r() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.96900 * b2 + w * 0.1538520; b3 = 0.86650 * b3 + w * 0.3104856;
    b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
    out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  return out;
}
export function brown(n, r, out = new Float32Array(n)) {
  let last = 0;
  for (let i = 0; i < n; i++) {
    const w = r() * 2 - 1;
    last = (last + 0.02 * w) / 1.02;
    out[i] = last * 3.5;
  }
  return out;
}
// Smooth random control signal (values in -1..1), `rate` new targets per second,
// cosine-interpolated. Good for gusts, swells, crowd density wander.
export function smoothRandom(n, sr, rate, r) {
  const out = new Float32Array(n);
  const step = Math.max(1, Math.floor(sr / rate));
  let a = r() * 2 - 1, b = r() * 2 - 1;
  for (let i = 0; i < n; i++) {
    const k = i % step;
    if (k === 0 && i > 0) { a = b; b = r() * 2 - 1; }
    const t = k / step;
    out[i] = a + (b - a) * (0.5 - 0.5 * Math.cos(Math.PI * t));
  }
  return out;
}

// ---- biquad (RBJ cookbook) ----------------------------------------------------
export class Biquad {
  constructor(type, f, q = 0.707, gainDb = 0, sr = 48000) { this.sr = sr; this.x1 = this.x2 = this.y1 = this.y2 = 0; this.set(type, f, q, gainDb); }
  set(type, f, q = 0.707, gainDb = 0) {
    const sr = this.sr;
    f = clamp(f, 5, sr * 0.49);
    const w = TAU * f / sr, cw = Math.cos(w), sw = Math.sin(w);
    const alpha = sw / (2 * Math.max(1e-4, q));
    const A = Math.pow(10, gainDb / 40);
    let b0, b1, b2, a0, a1, a2;
    switch (type) {
      case 'lowpass': b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
      case 'highpass': b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
      case 'bandpass': b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break; // 0 dB peak
      case 'notch': b0 = 1; b1 = -2 * cw; b2 = 1; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
      case 'peaking': b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A; break;
      case 'lowshelf': { const s = 2 * Math.sqrt(A) * alpha;
        b0 = A * ((A + 1) - (A - 1) * cw + s); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - s);
        a0 = (A + 1) + (A - 1) * cw + s; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - s; break; }
      case 'highshelf': { const s = 2 * Math.sqrt(A) * alpha;
        b0 = A * ((A + 1) + (A - 1) * cw + s); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - s);
        a0 = (A + 1) - (A - 1) * cw + s; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - s; break; }
      default: throw new Error('biquad type ' + type);
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
    return this;
  }
  tick(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
  run(arr, from = 0, to = arr.length) { for (let i = from; i < to; i++) arr[i] = this.tick(arr[i]); return arr; }
}
// convenience: filter a buffer in place with a chain of [type, f, q, gain]
export function filt(arr, sr, ...specs) {
  for (const [type, f, q = 0.707, g = 0] of specs) new Biquad(type, f, q, g, sr).run(arr);
  return arr;
}
// time-varying filter: fn(i) -> cutoff, recomputed every `block` samples
export function filtSweep(arr, sr, type, fAt, q = 0.707, block = 64) {
  const bq = new Biquad(type, fAt(0), q, 0, sr);
  for (let i = 0; i < arr.length; i += block) {
    bq.set(type, fAt(i), q);
    const e = Math.min(arr.length, i + block);
    for (let k = i; k < e; k++) arr[k] = bq.tick(arr[k]);
  }
  return arr;
}
// one-pole lowpass (cheap smoothing)
export function onePoleLP(arr, sr, f) {
  const a = Math.exp(-TAU * f / sr); let y = 0;
  for (let i = 0; i < arr.length; i++) { y = arr[i] * (1 - a) + y * a; arr[i] = y; }
  return arr;
}
export function onePoleHP(arr, sr, f) {
  const a = Math.exp(-TAU * f / sr); let y = 0, xp = 0;
  for (let i = 0; i < arr.length; i++) { const x = arr[i]; y = a * (y + x - xp); xp = x; arr[i] = y; }
  return arr;
}

// Two-pole resonator (for modal synthesis): returns a decaying sinusoid
// impulse response added into `out` at `start`.
export function addMode(out, sr, start, f, decay, amp, phase = 0) {
  if (f >= sr * 0.48) return;
  const n = Math.min(out.length - start, Math.ceil(decay * 7 * sr));
  const w = TAU * f / sr, k = Math.exp(-1 / (decay * sr));
  // recursive oscillator: y[n] = 2 k cos(w) y[n-1] - k^2 y[n-2]
  const c = 2 * k * Math.cos(w), kk = k * k;
  let y1 = Math.sin(phase) * amp, y2 = Math.sin(phase - w) * amp / k;
  for (let i = 0; i < n; i++) {
    const y = c * y1 - kk * y2;
    out[start + i] += y1;
    y2 = y1; y1 = y;
  }
}

// ---- envelopes / shaping ------------------------------------------------------
export function applyEnv(arr, sr, attack, decay, from = 0) {
  const na = Math.max(1, Math.floor(attack * sr));
  for (let i = from; i < arr.length; i++) {
    const t = i - from;
    const e = t < na ? t / na : Math.exp(-(t - na) / (decay * sr));
    arr[i] *= e;
  }
  return arr;
}
export function fadeEdges(arr, sr, fin = 0.005, fout = 0.01) {
  const a = Math.floor(fin * sr), b = Math.floor(fout * sr), n = arr.length;
  for (let i = 0; i < a && i < n; i++) arr[i] *= i / a;
  for (let i = 0; i < b && i < n; i++) arr[n - 1 - i] *= i / b;
  return arr;
}
export function softclip(arr, drive = 1) {
  const k = Math.tanh(drive);
  for (let i = 0; i < arr.length; i++) arr[i] = Math.tanh(arr[i] * drive) / k;
  return arr;
}
export function peak(arr) { let p = 0; for (let i = 0; i < arr.length; i++) { const a = Math.abs(arr[i]); if (a > p) p = a; } return p; }
export function rms(arr) { let s = 0; for (let i = 0; i < arr.length; i++) s += arr[i] * arr[i]; return Math.sqrt(s / Math.max(1, arr.length)); }
export function normalize(arr, target = 0.9) { const p = peak(arr); if (p > 0) { const g = target / p; for (let i = 0; i < arr.length; i++) arr[i] *= g; } return arr; }
export function normalizeRms(arr, target = 0.1) { const r = rms(arr); if (r > 0) { const g = target / r; for (let i = 0; i < arr.length; i++) arr[i] *= g; } return arr; }
export function scale(arr, g) { for (let i = 0; i < arr.length; i++) arr[i] *= g; return arr; }
export function removeDC(arr) { let m = 0; for (let i = 0; i < arr.length; i++) m += arr[i]; m /= arr.length || 1; for (let i = 0; i < arr.length; i++) arr[i] -= m; return arr; }

// add src into dst at offset (samples) with gain; wrap=true wraps around (loops)
export function mixInto(dst, src, offset, gain = 1, wrap = false) {
  const n = dst.length;
  for (let i = 0; i < src.length; i++) {
    let j = offset + i;
    if (j >= n) { if (!wrap) break; j %= n; }
    if (j < 0) continue;
    dst[j] += src[i] * gain;
  }
  return dst;
}
// Make a buffer loop seamlessly: render it `xf` seconds longer than the loop,
// then fold the overhang back over the head with an equal-power crossfade.
export function foldLoop(arr, sr, loopLen, xf) {
  const n = Math.floor(loopLen), m = Math.min(arr.length - n, Math.floor(xf * sr));
  const out = arr.slice(0, n);
  for (let i = 0; i < m; i++) {
    const t = i / m;
    const gIn = Math.sin(t * Math.PI / 2), gOut = Math.cos(t * Math.PI / 2);
    out[i] = out[i] * gIn + arr[n + i] * gOut;
  }
  return out;
}

// Exponential-decay noise burst (common building block of foley)
export function burst(sr, dur, r, { attack = 0.001, decay = dur / 4, color = 'white' } = {}) {
  const n = Math.floor(dur * sr);
  const a = color === 'pink' ? pink(n, r) : color === 'brown' ? brown(n, r) : white(n, r);
  return applyEnv(a, sr, attack, decay);
}

// Comb filter (feedback) — metallic resonances, tunnels
export function comb(arr, sr, delaySec, fb, mix = 1) {
  const d = Math.max(1, Math.floor(delaySec * sr));
  const buf = new Float32Array(d); let p = 0;
  for (let i = 0; i < arr.length; i++) {
    const y = arr[i] + buf[p] * fb;
    buf[p] = y; p = (p + 1) % d;
    arr[i] = arr[i] * (1 - mix) + y * mix;
  }
  return arr;
}

// Stereo helper container
export function stereo(n) { return [new Float32Array(n), new Float32Array(n)]; }
export function panGains(p) { const a = (clamp(p, -1, 1) + 1) * Math.PI / 4; return [Math.cos(a), Math.sin(a)]; }

// Write a mono src into stereo dst with pan
export function mixStereo(dst, src, offset, gain, pan, wrap = false) {
  const [gl, gr] = panGains(pan);
  mixInto(dst[0], src, offset, gain * gl, wrap);
  mixInto(dst[1], src, offset, gain * gr, wrap);
}

// ---- tiny FFT (radix-2, in place) for analysis ------------------------------
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -TAU / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k], ai = im[i + k];
        const br = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const bi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ar + br; im[i + k] = ai + bi;
        re[i + k + len / 2] = ar - br; im[i + k + len / 2] = ai - bi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}
