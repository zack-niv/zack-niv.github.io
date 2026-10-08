// =============================================================================
// Formant voice synthesizer (worker-safe) — NOT used for any spoken line any
// more (the PA, shop calls and "sumimasen" use real speechSynthesis voices; see
// announcer.js). Its only remaining job is `walla` at the bottom: many quiet
// voices summed and low-passed into the unintelligible murmur of a crowd, which
// is a texture, not speech.
// =============================================================================
import { TAU, rng, Biquad, clamp, softclip, normalize, peak } from './dsp.js?v=5f764cf';

// ---- kana → mora ----------------------------------------------------------------
const HIRA = 'あいうえおかきくけこがぎぐげごさしすせそざじずぜぞたちつてとだぢづでどなにぬねのはひふへほばびぶべぼぱぴぷぺぽまみむめもやゆよらりるれろわを';
const ROMA = ('a i u e o ka ki ku ke ko ga gi gu ge go sa shi su se so za ji zu ze zo ta chi tsu te to da ji zu de do ' +
  'na ni nu ne no ha hi fu he ho ba bi bu be bo pa pi pu pe po ma mi mu me mo ya yu yo ra ri ru re ro wa o').split(' ');
const KMAP = {}; for (let i = 0; i < HIRA.length; i++) KMAP[HIRA[i]] = ROMA[i];
const SMALL = { 'ゃ': 'ya', 'ゅ': 'yu', 'ょ': 'yo', 'ぁ': 'a', 'ぃ': 'i', 'ぅ': 'u', 'ぇ': 'e', 'ぉ': 'o' };
const toHira = (ch) => { const c = ch.charCodeAt(0); return c >= 0x30a1 && c <= 0x30f6 ? String.fromCharCode(c - 0x60) : ch; };
function splitRoma(ro) { const m = /^([^aiueo]*)([aiueo])$/.exec(ro); return m ? { c: m[1], v: m[2] } : { c: '', v: 'a' }; }
const PSEUDO_C = ['k', 's', 't', 'n', 'h', 'm', 'r', 'g', 'd', 'b', 'sh', 'ch', 'j', 'y', ''];
const PSEUDO_V = ['a', 'i', 'u', 'e', 'o', 'o', 'a', 'u'];

// returns [{c, v, dur, pause, devoice, long}] units
export function jaToMora(text) {
  const out = [];
  for (const raw of text) {
    const ch = toHira(raw);
    if ('、，,'.includes(ch)) { out.push({ pause: 0.2 }); continue; }
    if ('。．.！!？?'.includes(ch)) { out.push({ pause: 0.42 }); continue; }
    if (/\s/.test(ch)) { out.push({ pause: 0.06 }); continue; }
    if (ch === 'ー' || ch === '〜') { const p = out[out.length - 1]; if (p && p.v) p.long = (p.long || 1) + 1; continue; }
    if (ch === 'っ') { out.push({ c: '', v: '', gem: true }); continue; }
    if (ch === 'ん') { out.push({ c: 'N', v: '' }); continue; }
    if (SMALL[ch]) {
      const p = out[out.length - 1];
      if (p && p.v) {
        const s = SMALL[ch];
        if (s.length === 2) { p.c = p.c === 'shi' ? 'sh' : (p.c || '') + 'y'; p.v = s[1]; if (p.c === 'shy') p.c = 'sh'; if (p.c === 'chy') p.c = 'ch'; if (p.c === 'jy') p.c = 'j'; }
        else p.v = s;
      }
      continue;
    }
    if (KMAP[ch]) { out.push(splitRoma(KMAP[ch])); continue; }
    if (/[ァ-ヶぁ-ゖ]/.test(raw)) continue;
    // kanji / latin / digits: deterministic pseudo-mora (2 for kanji, 1 otherwise)
    const code = raw.codePointAt(0);
    const r = rng(code * 2654435761);
    const cnt = code > 0x3000 ? 2 : 1;
    for (let k = 0; k < cnt; k++) out.push({ c: PSEUDO_C[Math.floor(r() * PSEUDO_C.length)], v: PSEUDO_V[Math.floor(r() * PSEUDO_V.length)] });
  }
  // devoicing of i/u between voiceless consonants or before a pause/end (です/ます)
  const VL = new Set(['k', 's', 'sh', 't', 'ch', 'ts', 'h', 'f', 'p', 'ky', 'py', 'hy']);
  for (let i = 0; i < out.length; i++) {
    const u = out[i]; if (!u.v || (u.v !== 'i' && u.v !== 'u') || u.long) continue;
    if (!VL.has(u.c)) continue;
    const nx = out[i + 1];
    if (!nx || nx.pause || (nx.c && VL.has(nx.c))) u.devoice = true;
  }
  return out;
}

// very rough English: per-syllable units with stress
export function enToSyl(text) {
  const out = [];
  const words = text.replace(/[^A-Za-z0-9,.!?' ]/g, ' ').split(/(\s+|[,.!?])/).filter(w => w && w.trim() !== '' || /[,.!?]/.test(w));
  for (const w of words) {
    if (w === ',') { out.push({ pause: 0.18 }); continue; }
    if (/[.!?]/.test(w)) { out.push({ pause: 0.4 }); continue; }
    const lw = w.toLowerCase().replace(/'/g, '');
    const parts = lw.match(/[^aeiouy]*[aeiouy]+(?:[^aeiouy]+(?![aeiouy]))?/g) || [lw];
    parts.forEach((p, i) => {
      const m = /^([^aeiouy]*)([aeiouy]+)([^aeiouy]*)$/.exec(p) || [p, p, 'a', ''];
      const cons = m[1], vow = m[2], coda = m[3];
      const cmap = (s) => {
        if (!s) return '';
        if (s.startsWith('sh') || s.startsWith('ch')) return s.startsWith('sh') ? 'sh' : 'ch';
        if (s.startsWith('th')) return 'f';
        const c = s[0];
        return { p: 'p', b: 'b', t: 't', d: 'd', k: 'k', g: 'g', c: 'k', q: 'k', s: 's', z: 'z', x: 's', f: 'f', v: 'b', h: 'h', m: 'm', n: 'n', l: 'r', r: 'r', w: 'w', y: 'y', j: 'j' }[c] || 't';
      };
      const v = { a: 'a', e: 'e', i: 'i', o: 'o', u: 'u', y: 'i' }[vow[0]];
      out.push({ c: cmap(cons), v: vow === 'e' && i === parts.length - 1 && parts.length > 1 ? 'x' : v, coda: cmap(coda), stress: i === 0 ? 1 : 0, en: true });
    });
    out.push({ pause: 0.03 });
  }
  return out;
}

// ---- formant data (female announcer voice) -------------------------------------
const VOW = {
  a: [850, 1350, 2800, 3900], i: [330, 2750, 3300, 4100], u: [380, 1450, 2550, 3800],
  e: [540, 2250, 2950, 4000], o: [510, 930, 2750, 3800], x: [520, 1550, 2700, 3800], // x = schwa
  N: [280, 1150, 2600, 3700],
};
const BW = [90, 110, 170, 250];

// segment plan → per-sample control tracks, then synthesize
export function formantVoice(sr, text, { lang = 'ja', seed = 1, f0 = 228, rate = 1, gender = 'f', pa = true, breath = 0.05 } = {}) {
  const r = rng(seed);
  const units = lang === 'ja' ? jaToMora(text) : enToSyl(text);
  const male = gender === 'm';
  const fScale = male ? 0.84 : 1;
  const base = male ? f0 * 0.55 : f0;
  const mora = (lang === 'ja' ? 0.118 : 0.15) / rate;
  // build segments: {dur, voiced, amp, form:[4], noise:{type}, f0mul}
  const segs = [];
  const push = (s) => segs.push(s);
  // Pitch (semitones around the base): Japanese accent phrases start low, climb over the first
  // two morae, drift down (declination), step down after a lexical accent, and fall at the phrase end;
  // each following phrase starts a little lower; a sentence end resets. English: stress peaks + final fall.
  let phraseStart = true, phrasePos = 0, phraseIdx = 0, accentAt = -1, newPhrase = true;
  const ST = (x) => Math.pow(2, x / 12);
  units.forEach((u, idx) => {
    if (u.pause) { push({ dur: u.pause / rate, voiced: 0, amp: 0, form: null }); phraseStart = true; phrasePos = 0; newPhrase = true; phraseIdx = u.pause >= 0.4 ? 0 : phraseIdx + 1; return; }
    if (u.gem) { push({ dur: mora * 0.9, voiced: 0, amp: 0, form: null }); return; }
    const vf = VOW[u.v] || VOW.N;
    if (newPhrase) { newPhrase = false; accentAt = r() < 0.25 ? -1 : 3 + Math.floor(r() * 4); }
    const nextPause = !units[idx + 1] || units[idx + 1].pause;
    let st = 0;
    if (lang === 'ja') {
      st = phrasePos < 3 ? -2.2 + phrasePos * 2.4 : 2.6 - 0.32 * (phrasePos - 3);
      if (accentAt >= 0 && phrasePos > accentAt) st -= 3.6;
      st -= Math.min(3.5, phraseIdx * 0.9);
      if (nextPause) st -= 3.2;
    } else {
      st = (u.stress ? 2.4 : -0.4) - Math.min(4, phrasePos * 0.28) - Math.min(3, phraseIdx * 0.7);
      if (nextPause) st -= 3.5;
    }
    const pm = ST(st);
    phraseStart = false; phrasePos++;
    if (nextPause && lang === 'ja' && !u.long && u.v) u.long = 1.5; // phrase-final lengthening
    const c = u.c || '';
    let cdur = 0;
    // consonant
    if (c === 'N') { push({ dur: mora * 1.0, voiced: 0.55, amp: 0.55, form: VOW.N, f0mul: pm, nasal: 1 }); return; }
    const plos = /^(k|g|t|d|p|b|ky|gy|py|by|ts|ch)/.test(c);
    const fric = /^(s|sh|z|j|ts|ch|h|f|hy)/.test(c);
    const voicedC = /^(g|d|b|z|j|m|n|r|w|y|gy|by|ny|my|ry)/.test(c);
    if (plos) {
      const cl = mora * 0.38;
      push({ dur: cl, voiced: voicedC ? 0.25 : 0, amp: voicedC ? 0.18 : 0, form: [250, 1000, 2500, 3600], f0mul: pm });
      const place = c[0] === 'k' || c[0] === 'g' ? 'k' : c[0] === 'p' || c[0] === 'b' ? 'p' : 't';
      push({ dur: 0.012, voiced: 0, amp: 0.7, form: vf, noise: 'burst_' + place });
      cdur += cl + 0.012;
      if (!voicedC && c !== 'ts' && c !== 'ch') { push({ dur: 0.028, voiced: 0, amp: 0.3, form: vf, noise: 'asp' }); cdur += 0.028; }
    }
    if (fric) {
      const d = mora * (c === 'h' || c === 'f' || c === 'hy' ? 0.45 : 0.6);
      const kind = c.startsWith('s') && c !== 'sh' ? 's' : c === 'z' ? 's' : c === 'h' || c === 'hy' || c === 'f' ? 'asp' : 'sh';
      push({ dur: d, voiced: voicedC ? 0.4 : 0, amp: kind === 'asp' ? 0.35 : 0.55, form: kind === 'asp' ? vf : [300, 1600, 2600, 3800], noise: kind, f0mul: pm });
      cdur += d;
    }
    if (/^(m|n|ny|my)/.test(c)) { const d = mora * 0.42; push({ dur: d, voiced: 0.8, amp: 0.45, form: c[0] === 'm' ? [260, 1000, 2400, 3500] : [270, 1500, 2600, 3600], f0mul: pm, nasal: 1 }); cdur += d; }
    if (/^(r|ry)/.test(c)) { const d = 0.022; push({ dur: d, voiced: 0.8, amp: 0.35, form: [350, 1500, 1900, 3500], f0mul: pm }); cdur += d; }
    if (/^w/.test(c)) { push({ dur: mora * 0.3, voiced: 1, amp: 0.6, form: VOW.u.map((f, i) => i === 1 ? 800 : f), f0mul: pm }); cdur += mora * 0.3; }
    if (/^y|y$/.test(c)) { push({ dur: mora * 0.28, voiced: 1, amp: 0.6, form: VOW.i, f0mul: pm }); cdur += mora * 0.28; }
    // vowel
    let vd = Math.max(0.045, mora * (u.long || 1) * (u.en ? (u.stress ? 1.5 : 0.9) : 1) - cdur * 0.55);
    if (u.devoice) push({ dur: vd * 0.6, voiced: 0, amp: 0.22, form: vf, noise: 'asp' });
    else push({ dur: vd, voiced: 1, amp: u.stress ? 1 : 0.88, form: vf, f0mul: pm });
    if (u.coda) {
      const cc = u.coda;
      if (/[ptkbdgc]/.test(cc[0])) { push({ dur: 0.05, voiced: 0, amp: 0, form: null }); push({ dur: 0.01, voiced: 0, amp: 0.4, form: vf, noise: 'burst_t' }); }
      else if (/[sz]/.test(cc[0])) push({ dur: 0.07, voiced: 0, amp: 0.45, form: [300, 1600, 2600, 3800], noise: 's' });
      else if (/[mn]/.test(cc[0])) push({ dur: 0.06, voiced: 0.8, amp: 0.45, form: VOW.N, f0mul: pm, nasal: 1 });
      else if (cc[0] === 'r') push({ dur: 0.05, voiced: 0.9, amp: 0.5, form: [450, 1300, 1700, 3400], f0mul: pm });
    }
  });
  const total = segs.reduce((a, s) => a + s.dur, 0) + 0.35;
  const n = Math.ceil(total * sr);
  const out = new Float32Array(n);
  // control-rate tracks (per 32 samples) with smoothing for coarticulation
  const B = 32;
  let si = 0, segEnd = segs.length ? segs[0].dur * sr : 0, segStart = 0;
  let F = VOW.a.slice(), amp = 0, voiced = 0, nAmp = 0, f0m = 1, nasal = 0;
  const res = [0, 1, 2, 3].map(() => ({ y1: 0, y2: 0, a1: 0, a2: 0, g: 0 }));
  const setRes = (rs, f, bw) => {
    const R = Math.exp(-Math.PI * bw / sr), th = TAU * f / sr;
    rs.a1 = 2 * R * Math.cos(th); rs.a2 = -R * R; rs.g = (1 - R) * Math.sqrt(1 - 2 * R * Math.cos(2 * th) + R * R) * 1.0;
  };
  // noise shaping filters
  const nS = new Biquad('highpass', 4200, 0.9, 0, sr), nS2 = new Biquad('peaking', 6500, 1, 8, sr);
  const nSh = new Biquad('bandpass', 3000, 1.2, 0, sr);
  const nK = new Biquad('bandpass', 2200, 2, 0, sr), nT = new Biquad('bandpass', 4500, 1.2, 0, sr), nP = new Biquad('lowpass', 1200, 0.7, 0, sr);
  let ph = 0, jitter = 0, vib = 0;
  let curNoise = null;
  for (let b = 0; b < n; b += B) {
    while (si < segs.length && b >= segEnd) { si++; segStart = segEnd; if (si < segs.length) segEnd += segs[si].dur * sr; }
    const s = segs[si] || { amp: 0, voiced: 0, form: null };
    const k = 0.22; // coarticulation smoothing per block (~ 6 ms time constant at 24k)
    if (s.form) for (let i = 0; i < 4; i++) F[i] += (s.form[i] * fScale - F[i]) * k;
    const tAmp = s.voiced ? s.amp : 0, tN = s.noise ? s.amp : (s.voiced ? 0 : 0);
    amp += (tAmp - amp) * 0.35; nAmp += (tN - nAmp) * 0.5;
    voiced += ((s.voiced || 0) - voiced) * 0.4;
    f0m += ((s.f0mul || f0m) - f0m) * 0.045; // ~30 ms portamento between morae
    nasal += ((s.nasal || 0) - nasal) * 0.3;
    curNoise = s.noise || curNoise;
    for (let i = 0; i < 4; i++) setRes(res[i], F[i] * (i === 0 && nasal > 0.5 ? 0.9 : 1), BW[i] * (1 + nasal * (i ? 0.8 : 0.3)));
    jitter += ((r() - 0.5) * 0.02 - jitter) * 0.3;
    const e = Math.min(n, b + B);
    for (let i = b; i < e; i++) {
      vib += 1 / sr;
      const f0 = base * f0m * (1 + jitter + 0.008 * Math.sin(TAU * 5.1 * vib) + 0.035 * Math.sin(TAU * 1.35 * vib + 1) * Math.sin(TAU * 0.37 * vib));
      ph += f0 / sr;
      if (ph >= 1) ph -= 1;
      // Rosenberg-like glottal flow derivative
      const op = 0.55, cl = 0.18;
      let g;
      if (ph < op) g = Math.sin(Math.PI * ph / op) * 0.5;
      else if (ph < op + cl) g = -Math.sin(Math.PI / 2 * (ph - op) / cl) * 1.6;
      else g = 0;
      const src = g * amp * voiced + (r() * 2 - 1) * (breath * amp * (ph < op ? 1 : 0.3));
      // noise excitation
      let nz = 0;
      if (nAmp > 0.002) {
        const w = r() * 2 - 1;
        switch (curNoise) {
          case 's': nz = nS2.tick(nS.tick(w)) * 0.6; break;
          case 'sh': nz = nSh.tick(w) * 1.2; break;
          case 'burst_k': nz = nK.tick(w) * 2.2; break;
          case 'burst_t': nz = nT.tick(w) * 2.2; break;
          case 'burst_p': nz = nP.tick(w) * 2; break;
          default: nz = w * 0.5; // aspiration: goes through the formants
        }
        nz *= nAmp;
      }
      const asp = curNoise === 'asp' ? nz : 0;
      const direct = curNoise === 'asp' ? 0 : nz;
      // parallel formant bank (cascade-like weighting)
      const x = src + asp;
      let y = 0;
      for (let q = 0; q < 4; q++) {
        const rs = res[q];
        const v = rs.g * x + rs.a1 * rs.y1 + rs.a2 * rs.y2;
        rs.y2 = rs.y1; rs.y1 = v;
        y += v * (q === 0 ? 1 : q === 1 ? 0.75 : q === 2 ? 0.45 : 0.22) * (nasal > 0.5 && q > 0 ? 0.4 : 1);
      }
      out[i] = y * 6 + direct * 0.5;
    }
  }
  if (pa) paChain(out, sr, r);
  normalize(out, 0.8);
  return out;
}

// Public-address horn speaker: band-limit 350–3800 Hz, presence peak, light
// distortion, a touch of line hum.
export function paChain(out, sr, r = rng(5)) {
  const hp = new Biquad('highpass', 480, 0.8, 0, sr), hp2 = new Biquad('highpass', 420, 0.7, 0, sr);
  const lp = new Biquad('lowpass', 4000, 0.9, 0, sr), lp2 = new Biquad('lowpass', 4400, 0.7, 0, sr);
  const pk = new Biquad('peaking', 2200, 1.0, 9, sr), pk2 = new Biquad('peaking', 1100, 1.2, 3, sr);
  const p = peak(out) || 1;
  for (let i = 0; i < out.length; i++) {
    let v = out[i] / p;
    v = pk2.tick(pk.tick(hp2.tick(hp.tick(v))));
    v = Math.tanh(v * 2.2) / Math.tanh(2.2);
    v = lp2.tick(lp.tick(v));
    out[i] = v; // pauses are true silence (no line hum / noise floor)
  }
  return out;
}

// Crowd walla: many quiet voices (mixed genders, conversational prosody),
// low-passed: the murmur of a station concourse. Returns a mono loop.
export function walla(sr, seconds, voices = 18, seed = 7) {
  const r = rng(seed);
  const n = Math.floor(seconds * sr);
  const out = new Float32Array(n);
  const syl = 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわがぎぐげござじずぜぞだでどばびぶべぼ';
  for (let v = 0; v < voices; v++) {
    let t = r() * 1.5;
    const male = r() < 0.5;
    const level = 0.25 + r() * 0.75;
    const pan = 0; // mono loop, spread later
    while (t < seconds) {
      // an utterance of 4–18 mora then a gap
      let txt = '';
      const len = 4 + Math.floor(r() * 14);
      for (let k = 0; k < len; k++) { txt += syl[Math.floor(r() * syl.length)]; if (r() < 0.12) txt += '、'; }
      const buf = formantVoice(sr, txt, { lang: 'ja', seed: Math.floor(r() * 1e9), f0: male ? 230 + r() * 40 : 200 + r() * 60, gender: male ? 'm' : 'f', rate: 1.25 + r() * 0.35, pa: false, breath: 0.08 });
      const o = Math.floor(t * sr);
      const g = level * (0.6 + r() * 0.4);
      for (let i = 0; i < buf.length; i++) { const j = (o + i) % n; out[j] += buf[i] * g; }
      t += buf.length / sr + 0.25 + r() * 1.3;
    }
  }
  // distant/diffuse: soften highs, remove rumble
  // (hard-floored concourses are bright: keep the consonant region 1-5 kHz alive, lift it, drop the rumble)
  const lp = new Biquad('lowpass', 6200, 0.6, 0, sr), hp = new Biquad('highpass', 330, 0.8, 0, sr), hp3 = new Biquad('highpass', 250, 0.7, 0, sr);
  const pk = new Biquad('peaking', 2600, 0.8, 10, sr), pk2 = new Biquad('peaking', 4300, 0.9, 8, sr);
  for (let pass = 0; pass < 2; pass++) for (let i = 0; i < n; i++) { const y = pk2.tick(pk.tick(lp.tick(hp3.tick(hp.tick(out[i]))))); if (pass) out[i] = y; }
  normalize(out, 0.7);
  return out;
}
