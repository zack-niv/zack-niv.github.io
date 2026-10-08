// =============================================================================
// Instrument synthesis into stereo sample tracks (worker-safe, no Web Audio).
// Used for shop music loops, station melodies, chimes and jingles.
//
// A Track is a stereo Float32 pair of fixed length. Notes are rendered and
// mixed in; with `wrap` the tails of notes wrap around to the start so the
// result loops seamlessly.
// =============================================================================
import { TAU, mtof, rng, Biquad, white, pink, applyEnv, panGains, addMode, clamp } from './dsp.js?v=488c31e';

export class Track {
  constructor(sr, seconds, wrap = false) {
    this.sr = sr; this.n = Math.ceil(seconds * sr); this.wrap = wrap;
    this.L = new Float32Array(this.n); this.R = new Float32Array(this.n);
  }
  // mix mono buffer at time t (seconds) with gain & pan; optional stereo width
  add(buf, t, gain = 1, pan = 0) {
    const [gl, gr] = panGains(pan);
    const o = Math.round(t * this.sr), n = this.n, L = this.L, R = this.R;
    for (let i = 0; i < buf.length; i++) {
      let j = o + i;
      if (j >= n) { if (!this.wrap) break; j %= n; }
      if (j < 0) continue;
      const v = buf[i] * gain;
      L[j] += v * gl; R[j] += v * gr;
    }
  }
  addStereo(bl, br, t, gain = 1) {
    const o = Math.round(t * this.sr), n = this.n;
    for (let i = 0; i < bl.length; i++) {
      let j = o + i;
      if (j >= n) { if (!this.wrap) break; j %= n; }
      if (j < 0) continue;
      this.L[j] += bl[i] * gain; this.R[j] += br[i] * gain;
    }
  }
  channels() { return [this.L, this.R]; }
}

// ---- instruments: each returns a mono Float32Array ----------------------------

// FM electric piano (Rhodes-ish): carrier+modulator 1:1 with decaying index,
// plus a short high "tine" partial for the bark.
export function epiano(sr, midi, dur, vel = 0.8) {
  const f = mtof(midi), n = Math.floor((dur + 1.2) * sr);
  const out = new Float32Array(n);
  const rel = dur * sr;
  const decay = 1.6 * Math.pow(0.5, (midi - 60) / 24);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const idx = (1.2 + vel * 1.6) * Math.exp(-t * 3.5) + 0.25;
    const m = Math.sin(TAU * f * t) * idx;
    let e = Math.exp(-t / decay);
    if (i > rel) e *= Math.exp(-(i - rel) / (0.12 * sr));
    const att = Math.min(1, i / (0.002 * sr));
    const tine = Math.sin(TAU * f * 7.02 * t) * Math.exp(-t * 28) * 0.18 * vel;
    out[i] = (Math.sin(TAU * f * t + m) * 0.8 + tine) * e * att * vel;
  }
  return out;
}

// Modal mallet: glockenspiel / vibraphone / marimba / music box / tubular bell
const MALLETS = {
  glock:    { partials: [[1, 1, 1.4], [2.76, 0.32, 0.5], [5.40, 0.16, 0.22], [8.93, 0.06, 0.12]], noise: 0.06 },
  vibe:     { partials: [[1, 1, 2.4], [4.0, 0.28, 0.6], [10.0, 0.06, 0.15]], noise: 0.03, trem: 5.2 },
  marimba:  { partials: [[1, 1, 0.55], [3.93, 0.22, 0.12], [9.2, 0.05, 0.04]], noise: 0.05 },
  musicbox: { partials: [[1, 1, 1.1], [2.0, 0.12, 0.6], [5.95, 0.16, 0.18], [11.4, 0.04, 0.06]], noise: 0.04 },
  bell:     { partials: [[0.5, 0.5, 3.0], [1, 1, 2.2], [1.19, 0.5, 1.8], [1.5, 0.3, 1.2], [2.0, 0.35, 1.0], [2.51, 0.2, 0.6], [3.0, 0.12, 0.4]], noise: 0.02 },
  chime:    { partials: [[1, 1, 1.8], [2.0, 0.18, 0.9], [3.01, 0.12, 0.5], [4.2, 0.05, 0.3]], noise: 0.01 },
};
export function mallet(sr, midi, vel = 0.8, kind = 'glock', decayMul = 1, r = null) {
  const spec = MALLETS[kind];
  const f = mtof(midi);
  const len = Math.max(...spec.partials.map(p => p[2])) * decayMul * 5 + 0.05;
  const out = new Float32Array(Math.floor(len * sr));
  const hiDamp = Math.pow(0.6, (midi - 72) / 12);
  for (const [ratio, amp, dec] of spec.partials) {
    const d = dec * decayMul * (ratio > 1.5 ? hiDamp : 1);
    addMode(out, sr, 0, f * ratio * (1 + (r ? (r() - 0.5) * 0.002 : 0)), d, amp * vel, 0);
  }
  // strike transient
  if (spec.noise) {
    const rr = r || rng(midi * 7 + 1);
    const m = Math.floor(0.006 * sr);
    const bq = new Biquad('bandpass', Math.min(sr * 0.4, f * 4), 1.2, 0, sr);
    for (let i = 0; i < m && i < out.length; i++) out[i] += bq.tick((rr() * 2 - 1) * spec.noise * vel * (1 - i / m)) * 3;
  }
  if (spec.trem) for (let i = 0; i < out.length; i++) out[i] *= 1 - 0.35 * (0.5 + 0.5 * Math.sin(TAU * spec.trem * i / sr));
  // 1ms attack ramp to avoid clicks
  const a = Math.floor(0.0008 * sr); for (let i = 0; i < a; i++) out[i] *= i / a;
  return out;
}

// Karplus–Strong plucked string (nylon guitar / koto-ish)
export function pluck(sr, midi, dur, vel = 0.8, bright = 0.5, r = rng(midi)) {
  const f = mtof(midi), N = Math.max(2, Math.round(sr / f));
  const n = Math.floor((dur + 0.6) * sr);
  const out = new Float32Array(n);
  const buf = new Float32Array(N);
  // excitation: lowpassed noise, with pluck-position comb
  let lp = 0; const a = 0.25 + bright * 0.6;
  for (let i = 0; i < N; i++) { lp = lp + a * ((r() * 2 - 1) - lp); buf[i] = lp; }
  const pos = Math.floor(N * 0.18);
  for (let i = N - 1; i >= pos; i--) buf[i] -= buf[i - pos] * 0.9;
  const decayFb = 0.996 + 0.0035 * clamp((60 - midi) / 30 + 0.5, 0, 1);
  let p = 0, prev = 0;
  const rel = dur * sr;
  for (let i = 0; i < n; i++) {
    const cur = buf[p];
    const nxt = 0.5 * (cur + prev) * (i > rel ? 0.985 : decayFb);
    prev = cur; buf[p] = nxt; p = (p + 1) % N;
    out[i] = cur * vel;
  }
  // body resonance
  const body = new Biquad('peaking', 220, 1.2, 5, sr), body2 = new Biquad('peaking', 110, 1.5, 3, sr);
  for (let i = 0; i < n; i++) out[i] = body2.tick(body.tick(out[i]));
  const ar = Math.floor(0.001 * sr); for (let i = 0; i < ar; i++) out[i] *= i / ar;
  return out;
}

// Bass: fingered (sine + harmonics, pluck env) or synth (saw → resonant LP)
export function bass(sr, midi, dur, vel = 0.8, kind = 'finger') {
  const f = mtof(midi), n = Math.floor((dur + 0.15) * sr);
  const out = new Float32Array(n);
  const rel = dur * sr;
  if (kind === 'finger') {
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      let e = Math.exp(-t * 1.8) * Math.min(1, i / (0.004 * sr));
      if (i > rel) e *= Math.exp(-(i - rel) / (0.03 * sr));
      const ph = TAU * f * t;
      out[i] = (Math.sin(ph) + 0.35 * Math.sin(2 * ph) * Math.exp(-t * 6) + 0.12 * Math.sin(3 * ph) * Math.exp(-t * 10)) * e * vel;
    }
  } else {
    const bq = new Biquad('lowpass', 800, 4, 0, sr);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      ph += f / sr; if (ph > 1) ph -= 1;
      if ((i & 31) === 0) bq.set('lowpass', 180 + 1400 * Math.exp(-t * 9) * vel, 3);
      let e = Math.min(1, i / (0.003 * sr)) * (0.7 + 0.3 * Math.exp(-t * 4));
      if (i > rel) e *= Math.exp(-(i - rel) / (0.02 * sr));
      out[i] = bq.tick(2 * ph - 1) * e * vel * 0.8;
    }
  }
  return out;
}

// Pad / strings: detuned saws through a soft lowpass, slow attack
export function pad(sr, midi, dur, vel = 0.5, bright = 0.4, attack = 0.25) {
  const f = mtof(midi), n = Math.floor((dur + 0.8) * sr);
  const out = new Float32Array(n);
  const det = [-0.11, 0.0, 0.09, 0.17].map(c => f * Math.pow(2, c / 12));
  const ph = det.map((_, i) => i * 0.37);
  const bq = new Biquad('lowpass', f * (2 + bright * 6), 0.6, 0, sr), bq2 = new Biquad('lowpass', f * (2 + bright * 6), 0.6, 0, sr);
  const rel = dur * sr;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < 4; k++) { ph[k] += det[k] / sr; if (ph[k] > 1) ph[k] -= 1; s += 2 * ph[k] - 1; }
    let e = Math.min(1, i / (attack * sr));
    if (i > rel) e *= Math.exp(-(i - rel) / (0.35 * sr));
    out[i] = bq2.tick(bq.tick(s * 0.25)) * e * vel;
  }
  return out;
}

// Soft square / pulse lead (jingles, retro PA melodies) — band-limited-ish via LP
export function lead(sr, midi, dur, vel = 0.6, duty = 0.5, bright = 0.5, vib = 0) {
  const f = mtof(midi), n = Math.floor((dur + 0.08) * sr);
  const out = new Float32Array(n);
  const bq = new Biquad('lowpass', Math.min(sr * 0.45, f * (3 + bright * 8)), 0.7, 0, sr);
  let ph = 0; const rel = dur * sr;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const vf = vib ? 1 + vib * Math.sin(TAU * 5.5 * t) * Math.min(1, t * 3) : 1;
    ph += f * vf / sr; if (ph > 1) ph -= 1;
    let e = Math.min(1, i / (0.004 * sr)) * (0.75 + 0.25 * Math.exp(-t * 8));
    if (i > rel) e *= Math.exp(-(i - rel) / (0.015 * sr));
    out[i] = bq.tick(ph < duty ? 1 : -1) * e * vel * 0.5;
  }
  return out;
}

// Sine "flute/whistle" lead with breath
export function flute(sr, midi, dur, vel = 0.6, r = rng(midi + 3)) {
  const f = mtof(midi), n = Math.floor((dur + 0.1) * sr);
  const out = new Float32Array(n);
  const bq = new Biquad('bandpass', f * 2, 2, 0, sr);
  let ph = 0; const rel = dur * sr;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    ph += f * (1 + 0.004 * Math.sin(TAU * 5 * t) * Math.min(1, t * 2)) / sr;
    let e = Math.min(1, i / (0.04 * sr));
    if (i > rel) e *= Math.exp(-(i - rel) / (0.04 * sr));
    out[i] = (Math.sin(TAU * ph) + 0.18 * Math.sin(2 * TAU * ph) + bq.tick(r() * 2 - 1) * 0.12) * e * vel * 0.6;
  }
  return out;
}

// ---- drums --------------------------------------------------------------------
export function kick(sr, vel = 1) {
  const n = Math.floor(0.35 * sr), out = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = 48 + 110 * Math.exp(-t * 32);
    ph += f / sr;
    out[i] = Math.sin(TAU * ph) * Math.exp(-t * 9) * vel + (i < 0.002 * sr ? (Math.random() - 0.5) * 0.3 * vel : 0);
  }
  return out;
}
export function snare(sr, vel = 1, r = rng(11)) {
  const n = Math.floor(0.25 * sr), out = new Float32Array(n);
  const hp = new Biquad('highpass', 1200, 0.7, 0, sr), bp = new Biquad('bandpass', 3500, 0.8, 0, sr);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const nz = bp.tick(hp.tick(r() * 2 - 1)) * Math.exp(-t * 18);
    const tone = Math.sin(TAU * 190 * t) * Math.exp(-t * 30) * 0.5;
    out[i] = (nz * 1.3 + tone) * vel;
  }
  return out;
}
export function hat(sr, vel = 1, open = false, r = rng(12)) {
  const n = Math.floor((open ? 0.3 : 0.06) * sr), out = new Float32Array(n);
  const hp = new Biquad('highpass', 7000, 0.7, 0, sr), pk = new Biquad('peaking', 10000, 1, 6, sr);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    out[i] = pk.tick(hp.tick(r() * 2 - 1)) * Math.exp(-t * (open ? 10 : 70)) * vel * 0.5;
  }
  return out;
}
export function shaker(sr, vel = 1, r = rng(13)) {
  const n = Math.floor(0.09 * sr), out = new Float32Array(n);
  const bp = new Biquad('bandpass', 6500, 1.2, 0, sr);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const e = Math.sin(Math.PI * Math.min(1, t / 0.09)) ** 2;
    out[i] = bp.tick(r() * 2 - 1) * e * vel * 0.6;
  }
  return out;
}
export function rim(sr, vel = 1) {
  const n = Math.floor(0.08 * sr), out = new Float32Array(n);
  addMode(out, sr, 0, 1650, 0.012, vel * 0.8);
  addMode(out, sr, 0, 520, 0.02, vel * 0.5);
  return out;
}
export function clap(sr, vel = 1, r = rng(14)) {
  const n = Math.floor(0.25 * sr), out = new Float32Array(n);
  const bp = new Biquad('bandpass', 1400, 1.1, 0, sr);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const burst = [0, 0.011, 0.022].reduce((a, o) => a + (t >= o ? Math.exp(-(t - o) * 140) : 0), 0) + Math.exp(-t * 14) * 0.4;
    out[i] = bp.tick(r() * 2 - 1) * burst * vel;
  }
  return out;
}

// ---- tiny score helpers -----------------------------------------------------
// note names like 'C4', 'F#5', 'Bb3' -> midi
export function nm(s) {
  const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(s);
  if (!m) throw new Error('note ' + s);
  const base = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[m[1].toLowerCase()];
  return 12 * (parseInt(m[3], 10) + 1) + base + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}
// chord symbol at a root midi -> list of midi notes (close voicing)
const QUAL = { maj: [0, 4, 7], min: [0, 3, 7], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], '7': [0, 4, 7, 10], m9: [0, 3, 7, 10, 14], maj9: [0, 4, 7, 11, 14], add9: [0, 4, 7, 14], sus4: [0, 5, 7], m7b5: [0, 3, 6, 10], dim7: [0, 3, 6, 9], '9': [0, 4, 7, 10, 14], '6': [0, 4, 7, 9], '69': [0, 4, 7, 9, 14] };
export function chord(root, qual) { return (QUAL[qual] || QUAL.maj).map(i => root + i); }
// keep a voicing within a range by octave-shifting notes
export function voice(notes, lo = 55, hi = 76) { return notes.map(n => { while (n < lo) n += 12; while (n > hi) n -= 12; return n; }).sort((a, b) => a - b); }
