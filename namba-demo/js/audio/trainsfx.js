// =============================================================================
// Train sound synthesis (worker-safe).
//   vvvf(): traction inverter whine. Asynchronous PWM at a fixed carrier that
//     steps up in pitch (the iconic "musical" start), sidebands at fc ± 2·fm
//     spreading as the motor speeds up, then synchronous pulse modes whose
//     pitch rises with speed and drops at each mode change (15P → 9P → 5P →
//     3P → 1P), then motor magnetic tone. Decel = regenerative braking: the
//     same physics run with a falling speed profile.
//   roll(): wheel/rail roar loop; brakeSqueal(); airRelease(); doors().
// =============================================================================
import { TAU, rng, Biquad, white, pink, brown, smoothRandom, foldLoop, filt, normalize, addMode, clamp } from './dsp.js?v=488c31e';

// speed profile → per-sample motor electrical frequency fm (Hz)
function inverterTone(sr, dur, fmAt, torqueAt, variant = 0) {
  const n = Math.floor(dur * sr), out = new Float32Array(n);
  const steps = variant === 1 ? [[0, 620], [4, 700], [8, 785], [12, 880], [16, 990]] : [[0, 740], [5, 830], [10, 932], [15, 1046], [20, 1175]];
  const syncModes = [[26, 15], [40, 9], [56, 5], [70, 3], [85, 1]];
  const ph = new Float64Array(8);
  for (let i = 0; i < n; i++) {
    const t = i / sr, fm = fmAt(t), tq = torqueAt(t);
    if (tq <= 0.001) { out[i] = 0; continue; }
    let fc, async = true;
    if (fm < syncModes[0][0]) { fc = steps[0][1]; for (const [th, f] of steps) if (fm >= th) fc = f; }
    else { async = false; let P = 15; for (const [th, p] of syncModes) if (fm >= th) P = p; fc = P * fm * (P === 1 ? 6 : 1); }
    const comps = async
      ? [[fc, 0.5], [fc + 2 * fm, 0.42], [fc - 2 * fm, 0.42], [fc + 4 * fm, 0.15], [fc - 4 * fm, 0.15], [2 * fc + fm, 0.18], [2 * fc - fm, 0.18], [6 * fm + 1, 0.12]]
      : [[fc, 0.55], [fc + 2 * fm, 0.25], [fc - 2 * fm, 0.25], [2 * fc, 0.12], [6 * fm + 1, 0.25], [12 * fm + 1, 0.08], [fc * 3, 0.05], [fm * 2 + 1, 0.05]];
    let s = 0;
    for (let k = 0; k < comps.length; k++) {
      const [f, a] = comps[k];
      if (f <= 0 || f > sr * 0.45) continue;
      ph[k] += f / sr; if (ph[k] > 1) ph[k] -= Math.floor(ph[k]);
      s += Math.sin(TAU * ph[k]) * a;
    }
    out[i] = s * tq;
  }
  return out;
}
export function vvvf(sr, mode = 'accel', variant = 0) {
  const dur = mode === 'accel' ? 16 : 14;
  // fm (Hz) vs time: accel ~ 3 km/h/s; decel brakes to a stop at the end
  const fmAt = mode === 'accel' ? (t) => Math.min(95, 6.2 * t * (1 - t / 60)) : (t) => Math.max(0, 70 * (1 - t / 12.5));
  const torqueAt = mode === 'accel' ? (t) => clamp(t / 0.4, 0, 1) * (t > 14 ? Math.max(0, 1 - (t - 14) / 1.5) : 1)
    : (t) => clamp(t / 0.5, 0, 1) * (t < 12.2 ? 0.8 : Math.max(0, 1 - (t - 12.2) / 0.3));
  const out = inverterTone(sr, dur, fmAt, torqueAt, variant);
  // the whine radiates from under-floor equipment: soften top, cut bottom
  filt(out, sr, ['highpass', 120, 0.7], ['lowpass', 5000, 0.7]);
  return normalize(out, 0.7);
}
// wheel/rail roar (loop) — runtime modulates rate/filter/gain with speed
export function roll(sr, seconds = 8) {
  const r = rng(700);
  const n = Math.floor(seconds * sr), m = Math.floor(0.4 * sr);
  const L = new Float32Array(n + m), R = new Float32Array(n + m);
  for (const ch of [L, R]) {
    const a = filt(pink(n + m, r), sr, ['lowpass', 1400, 0.6], ['peaking', 380, 1, 5]);
    const b = filt(brown(n + m, r), sr, ['lowpass', 180, 0.7]);
    const hiss = filt(white(n + m, r), sr, ['bandpass', 3200, 1.5]);
    const g = smoothRandom(n + m, sr, 3, r);
    for (let i = 0; i < n + m; i++) ch[i] = a[i] * 0.6 + b[i] * 0.9 + hiss[i] * 0.05 * (0.6 + 0.4 * g[i]);
  }
  const out = [foldLoop(L, sr, n, 0.4), foldLoop(R, sr, n, 0.4)];
  let p = 0; for (const c of out) for (let i = 0; i < c.length; i++) p = Math.max(p, Math.abs(c[i]));
  for (const c of out) for (let i = 0; i < c.length; i++) c[i] *= 0.7 / p;
  return out;
}
// one bogie crossing a rail joint: "ta-tan" (two axles 2.1 m apart @ ~12 m/s)
export function joint(sr, seed = 0) {
  const r = rng(710 + seed);
  const out = new Float32Array(Math.floor(0.6 * sr));
  for (const o of [0, 0.17]) {
    const s = Math.floor(o * sr);
    addMode(out, sr, s, 62 + r() * 8, 0.06, 0.8); addMode(out, sr, s, 180 + r() * 20, 0.03, 0.4);
    addMode(out, sr, s, 1100 + r() * 200, 0.006, 0.15); addMode(out, sr, s, 2700, 0.004, 0.08);
  }
  return normalize(out, 0.7);
}
// brake squeal at the last metres before the stop
export function brakeSqueal(sr, seed = 0) {
  const r = rng(720 + seed);
  const dur = 3.0, n = Math.floor(dur * sr), out = new Float32Array(n);
  const f0 = 2900 + r() * 900;
  const wob = smoothRandom(n, sr, 6, r);
  const fr = filt(pink(n, r), sr, ['bandpass', 1600, 0.6]);
  let ph = 0, ph2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const env = Math.min(1, t / 0.6) * (t < 2.4 ? 1 : Math.max(0, 1 - (t - 2.4) / 0.25)) * (0.6 + 0.4 * wob[i]);
    ph += f0 * (1 + 0.006 * wob[i] - 0.03 * t / dur) / sr; ph2 += f0 * 1.51 / sr;
    out[i] = (Math.sin(TAU * ph) * 0.5 + Math.sin(TAU * ph * 2) * 0.12 + Math.sin(TAU * ph2) * 0.08 * env) * env * env + fr[i] * 0.1 * Math.min(1, t / 0.3) * (t < 2.5 ? 1 : 0.2);
  }
  return normalize(out, 0.6);
}
// pneumatic release after the stop: "pshhhh"
export function airRelease(sr, seed = 0) {
  const r = rng(730 + seed);
  const dur = 1.8, n = Math.floor(dur * sr), out = new Float32Array(n);
  const hp = new Biquad('highpass', 1500, 0.7, 0, sr), pk = new Biquad('peaking', 4500, 0.8, 4, sr);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const env = Math.min(1, t / 0.008) * Math.exp(-t / 0.42) + (t < 0.05 ? 0.4 * (1 - t / 0.05) : 0);
    out[i] = pk.tick(hp.tick(r() * 2 - 1)) * env;
  }
  addMode(out, sr, 0, 95, 0.08, 0.5); // valve thump
  return normalize(out, 0.6);
}
// doors sliding open/closed (many doors along the train blur into one)
export function doors(sr, open = true) {
  const r = rng(open ? 740 : 741);
  const dur = 2.2, n = Math.floor(dur * sr), out = new Float32Array(n);
  const lp = new Biquad('lowpass', 900, 0.7, 0, sr), bp = new Biquad('bandpass', 3000, 0.8, 0, sr);
  const travel = 0.9;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const mv = t > 0.15 && t < 0.15 + travel ? Math.sin(Math.PI * (t - 0.15) / travel) : 0;
    const w = r() * 2 - 1;
    out[i] = lp.tick(w) * mv * 0.6 + bp.tick(w) * mv * 0.06;
  }
  // pneumatic hiss at start, thunk at end (several doors, slightly spread)
  for (let k = 0; k < 5; k++) {
    const s = Math.floor((0.15 + travel + k * 0.025 + r() * 0.02) * sr);
    addMode(out, sr, s, open ? 140 : 110, 0.05, 0.5 / (1 + k * 0.4)); addMode(out, sr, s, 700, 0.015, 0.2 / (1 + k * 0.4));
    if (!open) addMode(out, sr, s + Math.floor(0.03 * sr), 260, 0.03, 0.25);
  }
  const hp = new Biquad('highpass', 2000, 0.7, 0, sr);
  for (let i = 0; i < 0.35 * sr; i++) out[i] += hp.tick(r() * 2 - 1) * 0.25 * Math.exp(-i / (0.12 * sr));
  return normalize(out, 0.6);
}
// train auxiliary power hum (parked trains at the terminal: SIV + compressor)
export function auxHum(sr, seconds = 8) {
  const r = rng(750);
  const n = Math.floor(seconds * sr), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    out[i] = Math.sin(TAU * 360 * t) * 0.15 + Math.sin(TAU * 720 * t) * 0.06 + Math.sin(TAU * 1080 * t) * 0.03 + Math.sin(TAU * 60 * t) * 0.1;
  }
  const nz = foldLoop(filt(pink(n + Math.floor(0.3 * sr), r), sr, ['lowpass', 600, 0.6]), sr, n, 0.3);
  for (let i = 0; i < n; i++) out[i] += nz[i] * 0.3;
  return normalize(out, 0.5);
}
