// =============================================================================
// Original procedural music: shop loops (seamless), station melodies, chimes.
// All melodies here are original compositions written for NAMBA, in the
// *style* of Japanese retail BGM and station melodies (no real tunes copied).
// Worker-safe: returns { channels:[L,R], sampleRate, loop }.
// =============================================================================
import { rng, Biquad, softclip, peak, scale } from './dsp.js?v=6c67dba';
import { Track, epiano, mallet, pluck, bass, pad, lead, flute, kick, snare, hat, shaker, rim, clap, nm, chord, voice } from './synth.js?v=6c67dba';

// TP: transposition (semitones) applied to every pitched note while a section renders, so one
// composition yields several keys/tempi and a longer A / A' (key-change) form instead of a 15 s loop
let TP = 0;
const N = (s) => (typeof s === 'number' ? s : nm(s)) + TP;
// per-shop variants of the same tune: [transpose, tempo multiplier]
const VAR = [[0, 1], [-2, 0.94], [3, 1.06]];

// speaker-ish EQ baked into shop loops (they are heard through shop ceiling
// speakers, then the doorway): cut lows, soften extreme highs, slight mid hump
function shopEQ(tr, lo = 140, hi = 9000) {
  for (const ch of tr.channels()) {
    const a = new Biquad('highpass', lo, 0.7, 0, tr.sr), b = new Biquad('lowpass', hi, 0.7, 0, tr.sr), c = new Biquad('peaking', 1800, 0.8, 2, tr.sr);
    // run twice around the loop so the IIR state wraps seamlessly
    for (let pass = 0; pass < 2; pass++) for (let i = 0; i < ch.length; i++) { const v = c.tick(b.tick(a.tick(ch[i]))); if (pass) ch[i] = v; }
  }
}
// Like shopEQ but keeping the IIR continuous for loops: the first pass only
// warms filter state. (Used everywhere for loops.)
function finish(tr, target = 0.7, drive = 1.2) {
  const p = Math.max(peak(tr.L), peak(tr.R));
  if (p > 0) { scale(tr.L, target / p); scale(tr.R, target / p); }
  softclip(tr.L, drive); softclip(tr.R, drive);
  const p2 = Math.max(peak(tr.L), peak(tr.R));
  if (p2 > 0) { scale(tr.L, target / p2); scale(tr.R, target / p2); }
  return { channels: [tr.L, tr.R], sampleRate: tr.sr, loop: tr.wrap };
}

// generic band render: chords per bar + comping/bass/drum pattern callbacks.
// Renders A, A' (a whole tone up) and A'' (down a tone), each with its own humanisation seed, so the loop is three times as long;
// `v` picks a per-shop variant (key + tempo).
function band({ sr, bpm, bars, beatsPerBar = 4, seed = 1, fn, eq = [170, 7500], v = 0, sections = [0, 2, -2] }) {
  const [vt, vtempo] = VAR[(v | 0) % VAR.length];
  const spb = 60 / (bpm * vtempo);
  const secBeats = bars * beatsPerBar;
  const tr = new Track(sr, sections.length * secBeats * spb, true);
  sections.forEach((tp, sec) => {
    TP = tp + vt;
    const r = rng(seed + sec * 977);
    const at = (beat) => (beat + sec * secBeats) * spb;
    try { fn({ tr, r, spb, at, sr, sec }); } finally { TP = 0; }
  });
  // shop loops are heard through ceiling speakers and a doorway
  if (eq) shopEQ(tr, eq[0], eq[1]);
  return tr;
}

// ---- shop loop: J-pop (royal-road progression, bright glock hook) ------------
export function shopJpop(sr, v = 0) {
  const prog = [['F3', 'maj7'], ['G3', '6'], ['E3', 'm7'], ['A3', 'm7'], ['D3', 'm7'], ['E3', 'm7'], ['F3', 'maj7'], ['G3', 'sus4']];
  const mel = [[0.5, 'E5', .5], [1, 'G5', .5], [1.5, 'A5', 1], [2.5, 'C6', .5], [3, 'A5', .5], [3.5, 'G5', .5],
    [4, 'A5', 1], [5, 'G5', .5], [5.5, 'E5', .5], [6, 'D5', 1.5],
    [8.5, 'E5', .5], [9, 'G5', .5], [9.5, 'B5', 1], [10.5, 'A5', .5], [11, 'G5', .5], [11.5, 'E5', .5],
    [12, 'G5', 1], [13, 'A5', 2.5],
    [16.5, 'F5', .5], [17, 'A5', .5], [17.5, 'C6', 1], [18.5, 'D6', .5], [19, 'C6', .5], [19.5, 'A5', .5],
    [20, 'B5', 1], [21, 'G5', .5], [21.5, 'E5', 1.5],
    [24.5, 'A5', .5], [25, 'C6', .5], [25.5, 'E6', 1], [26.5, 'D6', .5], [27, 'C6', .5], [27.5, 'A5', .5],
    [28, 'B5', 1], [29, 'C6', .5], [29.5, 'D6', 2]];
  return finish(band({ sr, v, bpm: 124, bars: 8, seed: 21, fn: ({ tr, r, spb, at }) => {
    prog.forEach(([root, q], b) => {
      const rt = N(root), notes = voice(chord(rt, q), 57, 76);
      const b0 = b * 4;
      // e-piano: anticipated stabs (1, 2&, 4) — typical J-pop comping
      for (const [o, d, v] of [[0, 1.2, 0.55], [1.5, 0.5, 0.42], [3, 0.9, 0.48]])
        notes.forEach((m, k) => tr.add(epiano(sr, m, d * spb, v), at(b0 + o) + k * 0.004, 0.33, -0.25 + k * 0.17));
      // bass: root 1, octave 2&, fifth 3, approach 4&
      const bline = [[0, rt - 12, 0.9], [1.5, rt, 0.4], [2, rt - 12 + 7, 0.9], [3, rt - 12, 0.4], [3.5, rt - 12 + (b % 2 ? 2 : -1), 0.4]];
      for (const [o, m, d] of bline) tr.add(bass(sr, m, d * spb, 0.8), at(b0 + o), 0.55, 0);
      // strings pad
      tr.add(pad(sr, notes[0] + 12, 4 * spb, 0.35, 0.3, 0.6), at(b0), 0.16, -0.5);
      tr.add(pad(sr, notes[notes.length - 1] + 12, 4 * spb, 0.35, 0.3, 0.6), at(b0), 0.16, 0.5);
      // drums
      for (let k = 0; k < 4; k++) {
        if (k === 0 || k === 2 || (k === 3 && b % 2)) tr.add(kick(sr, 0.9), at(b0 + k + (k === 3 ? 0.5 : 0)), 0.5, 0);
        if (k === 1 || k === 3) tr.add(snare(sr, 0.8, r), at(b0 + k), 0.32, 0.05);
      }
      for (let e = 0; e < 8; e++) tr.add(hat(sr, e % 2 ? 0.5 : 0.8, e === 7 && b % 4 === 3, r), at(b0 + e * 0.5), 0.22, 0.3);
    });
    mel.forEach(([o, n, d]) => { tr.add(mallet(sr, N(n), 0.8, 'glock', 0.9, r), at(o), 0.30, 0.15); tr.add(lead(sr, N(n) - 12, d * spb * 0.9, 0.5, 0.25, 0.35), at(o), 0.10, -0.1); });
  } }));
}

// ---- shop loop: city-pop (maj7/9 chords, synth bass, claps, shaker) ----------
export function shopCitypop(sr, v = 0) {
  const prog = [['D3', 'maj9'], ['C#3', 'm7'], ['B2', 'm7'], ['E3', '9'], ['D3', 'maj9'], ['C#3', 'm7'], ['F#3', 'm7'], ['E3', 'sus4']];
  const mel = [[0, 'F#5', 1], [1, 'A5', .5], [1.5, 'C#6', 1.5], [3.5, 'B5', .5], [4, 'A5', 1], [5, 'G#5', 1], [6, 'E5', 2],
    [8.5, 'D5', .5], [9, 'F#5', .5], [9.5, 'A5', 1], [10.5, 'B5', 1.5], [12, 'G#5', 1], [13, 'B5', 1], [14, 'E6', 2],
    [16, 'F#6', 1], [17, 'E6', .5], [17.5, 'C#6', 1.5], [19.5, 'A5', .5], [20, 'B5', 1.5], [21.5, 'G#5', 2.5],
    [24, 'A5', 1], [25, 'C#6', 1], [26, 'F#5', 1], [27, 'A5', .5], [27.5, 'B5', 4.5]];
  return finish(band({ sr, v, bpm: 104, bars: 8, seed: 31, fn: ({ tr, r, spb, at }) => {
    prog.forEach(([root, q], b) => {
      const rt = N(root), notes = voice(chord(rt, q), 58, 77), b0 = b * 4;
      for (const [o, d] of [[0, 0.4], [0.75, 0.3], [2.5, 0.4], [3.25, 0.6]])
        notes.forEach((m, k) => tr.add(epiano(sr, m, d * spb, 0.5), at(b0 + o), 0.26, -0.3 + k * 0.15));
      const bl = [[0, 0], [0.75, 0], [1.5, 12], [2, 7], [2.75, 0], [3.5, 10]];
      for (const [o, iv] of bl) tr.add(bass(sr, rt - 12 + iv, 0.3 * spb, 0.85, 'synth'), at(b0 + o), 0.5, 0);
      tr.add(pad(sr, notes[1] + 12, 4 * spb, 0.3, 0.5, 0.4), at(b0), 0.14, 0.4);
      for (let k = 0; k < 4; k++) { if (k % 2 === 0) tr.add(kick(sr, 0.8), at(b0 + k), 0.45, 0); else tr.add(clap(sr, 0.7, r), at(b0 + k), 0.3, -0.1); }
      for (let s = 0; s < 16; s++) tr.add(shaker(sr, s % 4 === 2 ? 0.9 : 0.5, r), at(b0 + s * 0.25), 0.16, 0.45);
    });
    mel.forEach(([o, n, d]) => tr.add(mallet(sr, N(n), 0.7, 'vibe', 0.8, r), at(o), 0.30, 0.2));
  } }));
}

// ---- shop loop: café bossa (nylon guitar, brush shaker, rim clave, flute) ------
export function shopBossa(sr, v = 0) {
  const prog = [['D3', 'maj7'], ['D3', 'maj7'], ['E3', 'm7'], ['A2', '9'], ['A3', 'm7'], ['D3', '9'], ['G2', 'maj7'], ['C3', '9']];
  const mel = [[0.5, 'F#5', 1.5], [2, 'E5', .5], [2.5, 'F#5', 1], [3.5, 'A5', 2.5], [8, 'G5', 1.5], [9.5, 'F#5', .5], [10, 'E5', 1], [11, 'C#5', 3],
    [16.5, 'E5', 1], [17.5, 'G5', 1], [18.5, 'B5', 1.5], [20, 'A5', 2], [24, 'B5', 1.5], [25.5, 'A5', .5], [26, 'F#5', 1], [27, 'D5', 1], [28, 'E5', 3.5]];
  return finish(band({ sr, v, bpm: 132, bars: 8, seed: 41, fn: ({ tr, r, spb, at }) => {
    prog.forEach(([root, q], b) => {
      const rt = N(root), notes = voice(chord(rt, q), 55, 72), b0 = b * 4;
      // thumb: root on 1, fifth on 3 (with the classic dotted feel)
      tr.add(pluck(sr, rt - 12 + 12 * (rt < 48 ? 1 : 0), 1.4 * spb, 0.8, 0.3, r), at(b0), 0.5, -0.1);
      tr.add(pluck(sr, rt - 12 + 7 + 12 * (rt < 48 ? 1 : 0), 1.4 * spb, 0.7, 0.3, r), at(b0 + 2), 0.45, -0.1);
      // fingers: syncopated chord plucks (bossa partido alto-ish)
      const pat = b % 2 === 0 ? [0, 1.5, 3] : [0.5, 2, 3.5];
      for (const o of pat) notes.forEach((m, k) => tr.add(pluck(sr, m, 0.7 * spb, 0.55, 0.45, r), at(b0 + o) + k * 0.007, 0.28, 0.05 + k * 0.08));
      for (let e = 0; e < 8; e++) tr.add(shaker(sr, e % 2 ? 0.35 : 0.6, r), at(b0 + e * 0.5), 0.12, 0.5);
    });
    // rim clave (2-bar bossa clave)
    for (let p = 0; p < 4; p++) for (const o of [0, 1.5, 3, 5, 6.5]) tr.add(rim(sr, 0.6), at(p * 8 + o), 0.12, -0.45);
    mel.forEach(([o, n, d]) => tr.add(flute(sr, N(n), d * spb * 0.95, 0.55, r), at(o), 0.26, 0.25));
  } }));
}

// ---- drugstore jingle earworm (bouncy, catchy, repeats forever) --------------
export function shopDrug(sr, v = 0) {
  // F major, 144 bpm, 8 bars: hook (2 bars) ×2, answer, tag
  const mel = [[0, 'F5', .5], [.5, 'F5', .5], [1, 'A5', .5], [1.5, 'C6', 1], [2.5, 'A5', .5], [3, 'G5', 1],
    [4, 'Bb5', .5], [4.5, 'Bb5', .5], [5, 'A5', .5], [5.5, 'G5', .5], [6, 'F5', 1.5],
    [8, 'F5', .5], [8.5, 'F5', .5], [9, 'A5', .5], [9.5, 'C6', 1], [10.5, 'D6', .5], [11, 'C6', 1],
    [12, 'Bb5', .5], [12.5, 'A5', .5], [13, 'G5', .5], [13.5, 'A5', .5], [14, 'F5', 1.5],
    [16, 'D6', .5], [16.5, 'D6', .5], [17, 'C6', .5], [17.5, 'A5', 1], [18.5, 'C6', .5], [19, 'Bb5', 1],
    [20, 'A5', .5], [20.5, 'A5', .5], [21, 'G5', .5], [21.5, 'F5', 1], [22.5, 'G5', 1.5],
    [24, 'F5', .5], [24.5, 'A5', .5], [25, 'C6', .5], [25.5, 'F6', 1], [26.5, 'E6', .5], [27, 'F6', 1], [28.5, 'C6', .5], [29, 'F5', 1]];
  const prog = [['F3', 'maj'], ['C3', '7'], ['F3', 'maj'], ['C3', '7'], ['Bb2', 'maj'], ['F3', 'maj'], ['G3', 'm7'], ['C3', '7']];
  return finish(band({ sr, v, bpm: 144, bars: 8, seed: 51, fn: ({ tr, r, spb, at }) => {
    prog.forEach(([root, q], b) => {
      const rt = N(root), notes = voice(chord(rt, q), 60, 74), b0 = b * 4;
      // oom-pah: bass on beats, chord on offbeats (marimba)
      for (let k = 0; k < 4; k++) {
        tr.add(bass(sr, rt - 12 + (k % 2 ? 7 : 0), 0.45 * spb, 0.85), at(b0 + k), 0.45, 0);
        notes.forEach((m, j) => tr.add(mallet(sr, m, 0.55, 'marimba', 1, r), at(b0 + k + 0.5), 0.17, -0.3 + j * 0.2));
        tr.add(k % 2 ? snare(sr, 0.7, r) : kick(sr, 0.8), at(b0 + k), k % 2 ? 0.25 : 0.4, 0);
        tr.add(hat(sr, 0.6, false, r), at(b0 + k + 0.5), 0.18, 0.35);
      }
      if (b % 2 === 1) tr.add(clap(sr, 0.7, r), at(b0 + 3.5), 0.2, 0);
    });
    mel.forEach(([o, n, d]) => {
      tr.add(lead(sr, N(n), d * spb * 0.85, 0.65, 0.3, 0.55, 0.003), at(o), 0.30, 0.0);
      tr.add(mallet(sr, N(n) + 12, 0.6, 'glock', 0.6, r), at(o), 0.13, 0.2);
    });
  } }), 0.7, 1.4);
}

// ---- game-centre / 100-yen / electronics: chirpy arps (120 Hz-free, bright) ---
export function shopGame(sr, v = 0) {
  const prog = [['A3', 'min'], ['F3', 'maj'], ['G3', 'maj'], ['E3', 'min'], ['A3', 'min'], ['F3', 'maj'], ['G3', 'sus4'], ['G3', 'maj']];
  const hook = ['A5', 'C6', 'E6', 'C6', 'D6', 'B5', 'G5', 'B5'];
  return finish(band({ sr, v, bpm: 150, bars: 8, seed: 61, fn: ({ tr, r, spb, at }) => {
    prog.forEach(([root, q], b) => {
      const rt = N(root), notes = voice(chord(rt, q), 64, 79), b0 = b * 4;
      for (let s = 0; s < 16; s++) tr.add(lead(sr, notes[s % notes.length] + (s % 8 >= 4 ? 12 : 0), 0.2 * spb, 0.45, 0.125, 0.6), at(b0 + s * 0.25), 0.12, s % 2 ? 0.4 : -0.4);
      for (let k = 0; k < 8; k++) tr.add(bass(sr, rt - 12 + (k % 2 ? 12 : 0), 0.4 * spb, 0.8, 'synth'), at(b0 + k * 0.5), 0.36, 0);
      for (let k = 0; k < 4; k++) { tr.add(kick(sr, 0.8), at(b0 + k), 0.4, 0); if (k % 2) tr.add(snare(sr, 0.7, r), at(b0 + k), 0.24, 0); }
      const h = hook[b]; tr.add(lead(sr, N(h), 1.6 * spb, 0.6, 0.5, 0.5, 0.004), at(b0), 0.22, 0); tr.add(lead(sr, N(h) - 5, 1.2 * spb, 0.5, 0.5, 0.5), at(b0 + 2), 0.16, 0);
    });
  } }));
}

// ---- department-store BGM: soft e-piano + strings, slow ------------------------
export function bgmDept(sr, v = 0) {
  const prog = [['C3', 'maj9'], ['A2', 'm7'], ['D3', 'm7'], ['G2', '9'], ['E3', 'm7'], ['A2', '7'], ['F3', 'maj7'], ['G3', 'sus4']];
  const mel = [[1, 'E5', 1], [2, 'G5', 1], [3, 'D5', 3], [9, 'F5', 1], [10, 'A5', 1], [11, 'C6', 2], [13, 'B5', 3], [17, 'G5', 1], [18, 'B5', 1], [19, 'E5', 3], [25, 'A5', 1], [26, 'C6', 1], [27, 'D6', 2], [29, 'G5', 3]];
  return finish(band({ sr, v, bpm: 76, bars: 8, seed: 71, eq: [90, 9000], fn: ({ tr, r, spb, at }) => {
    prog.forEach(([root, q], b) => {
      const rt = N(root), notes = voice(chord(rt, q), 55, 74), b0 = b * 4;
      tr.add(bass(sr, rt - 12 + (rt < 45 ? 12 : 0), 3.8 * spb, 0.5), at(b0), 0.35, 0);
      notes.forEach((m, k) => tr.add(epiano(sr, m, 0.6 * spb, 0.4), at(b0 + k * 0.5), 0.28, -0.4 + k * 0.2));
      notes.forEach((m, k) => tr.add(epiano(sr, m, 0.6 * spb, 0.3), at(b0 + 2 + k * 0.5), 0.2, 0.4 - k * 0.2));
      tr.add(pad(sr, notes[0] + 12, 4 * spb, 0.4, 0.25, 1.2), at(b0), 0.2, -0.3);
      tr.add(pad(sr, notes[2] + 12, 4 * spb, 0.4, 0.25, 1.2), at(b0), 0.2, 0.3);
    });
    mel.forEach(([o, n, d]) => tr.add(epiano(sr, N(n), d * spb, 0.6), at(o), 0.32, 0.1));
  } }), 0.6, 1.1);
}

// ---- station melodies (non-looping) --------------------------------------------
// Each is short and bright; rendered dry (the PA chain + room add the rest).
function melodyRender(sr, { bpm, notes, beats, timbre = 'glock', chords = [], bassline = [], seed = 1, extra }) {
  const spb = 60 / bpm;
  const tr = new Track(sr, beats * spb + 2.5, false);
  const r = rng(seed);
  notes.forEach(([o, n, d, v = 0.8]) => {
    tr.add(mallet(sr, N(n), v, timbre, 1, r), o * spb, 0.42, 0.1);
    if (timbre !== 'musicbox') tr.add(pad(sr, N(n), d * spb * 0.95, 0.5, 0.6, 0.02), o * spb, 0.10, -0.1);
  });
  chords.forEach(([o, root, q, d]) => voice(chord(N(root), q), 60, 74).forEach((m, k) => tr.add(pad(sr, m, d * spb, 0.4, 0.3, 0.08), o * spb, 0.09, -0.4 + k * 0.3)));
  bassline.forEach(([o, n, d]) => tr.add(bass(sr, N(n), d * spb, 0.7), o * spb, 0.35, 0));
  if (extra) extra(tr, spb, r);
  return finish(tr, 0.75, 1.1);
}
// Midosuji line approach melody (original): ~4.5 s, glock over warm pad
export function melMidosuji(sr) {
  return melodyRender(sr, { bpm: 148, beats: 11, timbre: 'glock', seed: 101,
    notes: [[0, 'Bb5', .5], [.5, 'Eb6', .5], [1, 'G6', 1], [2, 'F6', .5], [2.5, 'Eb6', .5], [3, 'C6', 1], [4, 'D6', .5], [4.5, 'Eb6', .5], [5, 'F6', .5], [5.5, 'Bb5', .5], [6, 'C6', 1], [7, 'D6', 1], [8, 'Eb6', 3]],
    chords: [[0, 'Eb4', 'maj', 2], [2, 'Ab3', 'maj7', 2], [4, 'Bb3', '7', 4], [8, 'Eb4', 'add9', 3]],
    bassline: [[0, 'Eb3', 2], [2, 'Ab2', 2], [4, 'Bb2', 4], [8, 'Eb3', 3]] });
}
// Sennichimae line approach melody (original): playful marimba + music box
export function melSennichimae(sr) {
  return melodyRender(sr, { bpm: 140, beats: 10, timbre: 'marimba', seed: 102,
    notes: [[0, 'D6', .5], [.5, 'B5', .5], [1, 'G5', .5], [1.5, 'B5', .5], [2, 'C6', .5], [2.5, 'E6', .5], [3, 'D6', 1], [4, 'B5', .5], [4.5, 'G5', .5], [5, 'A5', .5], [5.5, 'F#5', .5], [6, 'G5', .5], [6.5, 'A5', .5], [7, 'B5', .5], [7.5, 'D6', .5], [8, 'G6', 2]],
    chords: [[0, 'G4', 'maj', 2], [2, 'C4', 'maj', 2], [4, 'E4', 'm7', 2], [6, 'D4', '7', 2], [8, 'G4', 'maj', 2]],
    bassline: [[0, 'G2', 2], [2, 'C3', 2], [4, 'E2', 2], [6, 'D3', 2], [8, 'G2', 2]],
    extra: (tr, spb, r) => [[0, 'D7'], [2, 'E7'], [4, 'B6'], [8, 'G7']].forEach(([o, n]) => tr.add(mallet(tr.sr, nm(n), 0.4, 'musicbox', 1, r), o * spb, 0.12, 0.5)) });
}
// Nankai departure melodies (hassha) — two originals, A for odd tracks, B even
export function melNankaiA(sr) {
  return melodyRender(sr, { bpm: 132, beats: 17, timbre: 'musicbox', seed: 103,
    notes: [[0, 'A5', .5], [.5, 'F#5', .5], [1, 'A5', .5], [1.5, 'D6', 1.5], [3, 'C#6', .5], [3.5, 'B5', .5], [4, 'A5', .5], [4.5, 'F#5', .5], [5, 'G5', .5], [5.5, 'B5', .5], [6, 'E6', 1], [7, 'D6', .5], [7.5, 'C#6', 1.5],
      [9, 'B5', .5], [9.5, 'G5', .5], [10, 'B5', .5], [10.5, 'D6', .5], [11, 'E6', .5], [11.5, 'F#6', .5], [12, 'E6', .5], [12.5, 'D6', .5], [13, 'C#6', .5], [13.5, 'A5', .5], [14, 'B5', .5], [14.5, 'C#6', .5], [15, 'D6', 2]],
    chords: [[0, 'D4', 'maj', 3], [3, 'B3', 'm7', 2], [5, 'G3', 'maj7', 2], [7, 'A3', '7', 2], [9, 'G3', 'maj', 2], [11, 'F#3', 'm7', 2], [13, 'A3', 'sus4', 1], [14, 'A3', '7', 1], [15, 'D4', 'add9', 2]],
    bassline: [[0, 'D3', 3], [3, 'B2', 2], [5, 'G2', 2], [7, 'A2', 2], [9, 'G2', 2], [11, 'F#2', 2], [13, 'A2', 2], [15, 'D3', 2]] });
}
export function melNankaiB(sr) {
  return melodyRender(sr, { bpm: 120, beats: 15, timbre: 'vibe', seed: 104,
    notes: [[0, 'F5', .5], [.5, 'Bb5', .5], [1, 'D6', .5], [1.5, 'F6', 1], [2.5, 'Eb6', .5], [3, 'D6', .5], [3.5, 'C6', .5], [4, 'D6', .5], [4.5, 'Bb5', 1.5],
      [6, 'G5', .5], [6.5, 'C6', .5], [7, 'Eb6', .5], [7.5, 'G6', 1], [8.5, 'F6', .5], [9, 'Eb6', .5], [9.5, 'D6', .5], [10, 'C6', .5], [10.5, 'A5', .5], [11, 'C6', .5], [11.5, 'Eb6', .5], [12, 'D6', .5], [12.5, 'F6', .5], [13, 'Bb6', 2]],
    chords: [[0, 'Bb3', 'maj', 3], [3, 'Eb4', 'maj7', 3], [6, 'C4', 'm7', 3], [9, 'F3', '7', 4], [13, 'Bb3', 'add9', 2]],
    bassline: [[0, 'Bb2', 3], [3, 'Eb3', 3], [6, 'C3', 3], [9, 'F2', 4], [13, 'Bb2', 2]] });
}

// ---- chimes ---------------------------------------------------------------------
// convenience-store door chime (original): bright two-bell figure
export function chimeConbini(sr) {
  const tr = new Track(sr, 3.2, false), r = rng(201);
  const seq = [[0, 'E6'], [0.16, 'C6'], [0.32, 'G5'], [0.48, 'C6'], [0.72, 'D6'], [0.88, 'G6']];
  seq.forEach(([t, n], i) => { tr.add(mallet(sr, nm(n), 0.75, 'chime', 0.7, r), t, 0.5, i % 2 ? 0.2 : -0.2); });
  return finish(tr, 0.6, 1.05);
}
// PA attention chime: ascending (start) / descending (end) four-tone
export function chimePA(sr, down = false) {
  // soft department-store "ding-dong": low-register tubular bell, longer ring, clearly not the metro glock nor the Nankai music-box
  const tr = new Track(sr, 3.4, false), r = rng(202);
  const notes = down ? ['G5', 'E5', 'C5', 'G4'] : ['E5', 'C5', 'D5', 'G4'];
  notes.forEach((n, i) => tr.add(mallet(sr, nm(n), 0.7, 'bell', 0.75, r), i * 0.42, 0.5, 0));
  return finish(tr, 0.6, 1.05);
}
// metro door-closing chime (original two-tone repeated)
export function chimeDoor(sr) {
  const tr = new Track(sr, 2.6, false), r = rng(203);
  [[0, 'B5'], [0.28, 'G#5'], [0.7, 'B5'], [0.98, 'G#5']].forEach(([t, n]) => { tr.add(mallet(sr, nm(n), 0.8, 'chime', 0.5, r), t, 0.6, 0); tr.add(lead(sr, nm(n), 0.22, 0.5, 0.5, 0.2), t, 0.15, 0); });
  return finish(tr, 0.6, 1.05);
}
// escalator / attention "pinpon" (used before escalator voice when no speech)
export function chimeEsc(sr) {
  const tr = new Track(sr, 1.6, false), r = rng(204);
  tr.add(mallet(sr, nm('A5'), 0.7, 'chime', 0.5, r), 0, 0.5, 0);
  tr.add(mallet(sr, nm('F5'), 0.7, 'chime', 0.6, r), 0.3, 0.5, 0);
  return finish(tr, 0.5, 1.0);
}
// gentle discovery sting (new place found)
export function chimeDiscover(sr) {
  const tr = new Track(sr, 3.0, false), r = rng(205);
  [[0, 'G5'], [0.12, 'D6'], [0.24, 'B6']].forEach(([t, n], i) => tr.add(mallet(sr, nm(n), 0.6, 'glock', 0.9, r), t, 0.4, -0.2 + i * 0.2));
  tr.add(pad(sr, nm('G4'), 1.2, 0.4, 0.3, 0.3), 0, 0.12, 0); tr.add(pad(sr, nm('D5'), 1.2, 0.4, 0.3, 0.3), 0, 0.1, 0);
  return finish(tr, 0.5, 1.0);
}
