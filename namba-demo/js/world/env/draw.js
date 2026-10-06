// =============================================================================
// Canvas painters for the environment atlases. Pure 2D drawing: every
// function takes (g, w, h, ...) and paints into the region.
// =============================================================================
import { FONT_JA, FONT_EN, FONT_SERIF } from './kit.js';
import { rng, hash } from '../../core/rng.js';
import { drawPoster, POSTER_KINDS } from './posters.js';

// ---- text helpers -------------------------------------------------------------
export function font(size, weight = 700, fam = FONT_JA) { return `${weight} ${Math.round(size)}px ${fam}`; }
export function fitText(g, text, x, y, maxW, size, weight = 700, fam = FONT_JA, align = 'center') {
  let s = size;
  g.font = font(s, weight, fam);
  let mw = g.measureText(text).width;
  if (mw > maxW) { s = Math.max(6, s * maxW / mw); g.font = font(s, weight, fam); mw = g.measureText(text).width; }
  g.textAlign = align; g.textBaseline = 'middle';
  g.fillText(text, x, y);
  return { size: s, width: mw };
}
export function measure(g, text, size, weight = 700, fam = FONT_JA) { g.font = font(size, weight, fam); return g.measureText(text).width; }
// vertical (tategaki) text centred on x between y0..y1
export function vText(g, text, x, y0, y1, size, weight = 700, fam = FONT_JA) {
  const chars = [...text];
  const step = Math.min(size * 1.08, (y1 - y0) / Math.max(1, chars.length));
  const s = Math.min(size, step / 1.02);
  g.font = font(s, weight, fam); g.textAlign = 'center'; g.textBaseline = 'middle';
  const total = step * chars.length;
  let y = (y0 + y1) / 2 - total / 2 + step / 2;
  for (const c of chars) {
    if ('ーー〜～'.includes(c)) { g.save(); g.translate(x, y); g.rotate(Math.PI / 2); g.fillText(c, 0, 0); g.restore(); }
    else g.fillText(c, x, y);
    y += step;
  }
}
function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
export { rr };
function noise(g, w, h, a = 0.06, n = 400, seed = 1) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) { g.fillStyle = r() < 0.5 ? `rgba(0,0,0,${a * r()})` : `rgba(255,255,255,${a * r()})`; g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2); }
}
export const yen = (n) => '¥' + n.toLocaleString('en-US');

// ---- fascia name panel ------------------------------------------------------------
// style: { bg, fg, accent, mode: 'lightbox'|'letters'|'wood'|'noren', primary: 'ja'|'en', serif }
export function fasciaWidth(g, b, st, H) {
  const ja = b.ja, en = b.en;
  const big = H * 0.56, small = H * 0.24;
  const fam = st.serif ? FONT_SERIF : FONT_JA;
  if (st.primary === 'en') return Math.max(measure(g, en.toUpperCase(), big * 0.95, 800, FONT_EN), measure(g, ja, small, 500, fam)) + H * 0.9 + (st.emblem ? H : 0);
  return Math.max(measure(g, ja, big, 900, fam), measure(g, en, small, 600, FONT_EN)) + H * 0.9 + (st.emblem ? H : 0);
}
export function drawFascia(g, w, h, b, st) {
  g.fillStyle = st.bg; g.fillRect(0, 0, w, h);
  if (st.mode === 'wood') {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#5a3a20'); gr.addColorStop(1, '#3a2412');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,220,170,0.08)'; g.lineWidth = 2;
    for (let y = 6; y < h; y += 7) { g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y + 3, w * 0.6, y - 3, w, y + 1); g.stroke(); }
  }
  if (st.mode === 'lightbox') { // subtle acrylic gradient
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(255,255,255,0.10)'); gr.addColorStop(1, 'rgba(0,0,0,0.10)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }
  let x0 = h * 0.45;
  const fam = st.serif ? FONT_SERIF : FONT_JA;
  if (st.emblem) { // round emblem with a kanji
    const r = h * 0.38, cx = x0 + r, cy = h / 2;
    g.fillStyle = st.accent; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = st.bg; fitText(g, st.emblem, cx, cy + 1, r * 1.4, r * 1.25, 900, fam);
    x0 += h;
  }
  const cx = (x0 + w - h * 0.45) / 2, mw = w - x0 - h * 0.45;
  g.fillStyle = st.fg;
  if (st.primary === 'en') {
    fitText(g, b.en.toUpperCase(), cx, h * 0.42, mw, h * 0.53, 800, FONT_EN);
    g.globalAlpha = 0.85; fitText(g, b.ja, cx, h * 0.82, mw, h * 0.2, 500, fam); g.globalAlpha = 1;
  } else {
    fitText(g, b.ja, cx, h * 0.41, mw, h * 0.56, 900, fam);
    g.globalAlpha = 0.85; fitText(g, b.en, cx, h * 0.84, mw, h * 0.2, 600, FONT_EN); g.globalAlpha = 1;
  }
}

// projecting blade sign (袖看板), both faces use this
export function drawBlade(g, w, h, b, st, glyph) {
  g.fillStyle = st.bg; g.fillRect(0, 0, w, h);
  g.strokeStyle = st.accent; g.lineWidth = w * 0.04; g.strokeRect(w * 0.05, w * 0.05, w * 0.9, h - w * 0.1);
  g.fillStyle = st.fg;
  const fam = st.serif ? FONT_SERIF : FONT_JA;
  if (glyph && [...glyph].length <= 2) fitText(g, glyph, w / 2, h * 0.36, w * 0.8, w * 0.62, 900, fam);
  else vText(g, glyph || b.ja.slice(0, 4), w / 2, h * 0.08, h * 0.66, w * 0.42, 900, fam);
  fitText(g, st.primary === 'en' ? b.en.toUpperCase() : b.ja, w / 2, h * 0.78, w * 0.84, w * 0.16, 800, st.primary === 'en' ? FONT_EN : fam);
  g.globalAlpha = 0.8; fitText(g, st.primary === 'en' ? b.ja : b.en, w / 2, h * 0.9, w * 0.84, w * 0.1, 600, FONT_EN); g.globalAlpha = 1;
}

// noren curtain (whole width; geometry slits it into panels)
export function drawNoren(g, w, h, text, sub, bg = '#1d2b4a', fg = '#f5f1e8') {
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  noise(g, w, h, 0.05, 600, hash(text));
  g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(0, 0, w, h * 0.08);
  g.fillStyle = fg;
  const chars = [...text];
  const n = chars.length;
  const cw = w / Math.max(3, n);
  chars.forEach((c, i) => fitText(g, c, cw * (i + 0.5) + (w - cw * Math.max(3, n)) / 2 + (n < 3 ? cw * (3 - n) / 2 : 0), h * 0.46, cw * 0.86, Math.min(h * 0.55, cw * 0.86), 900, FONT_SERIF));
  if (sub) { g.globalAlpha = 0.85; fitText(g, sub, w / 2, h * 0.86, w * 0.8, h * 0.1, 700, FONT_JA); g.globalAlpha = 1; }
}

// red chochin lantern skin (u around, v up). Text appears twice around.
export function drawLantern(g, w, h, text, bg = '#c8231d', fg = '#151515') {
  const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#1a1a1a'); gr.addColorStop(0.08, bg); gr.addColorStop(0.92, bg); gr.addColorStop(1, '#1a1a1a');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(0,0,0,0.18)'; g.lineWidth = 1.5;
  for (let y = h * 0.1; y < h * 0.92; y += h / 14) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  g.fillStyle = fg;
  for (const cx of [w * 0.25, w * 0.75]) vText(g, text, cx, h * 0.14, h * 0.86, w * 0.2, 900, FONT_SERIF);
}

// chalk A-frame menu board
const CHALK = ['#f4f1e6', '#ffd36b', '#ff9a8a', '#a8e0ff', '#c8f0a0'];
export function drawChalkMenu(g, w, h, title, items, seed = 1) {
  const r = rng(seed);
  g.fillStyle = r() < 0.5 ? '#1f2a24' : '#262321'; g.fillRect(0, 0, w, h);
  noise(g, w, h, 0.07, 900, seed);
  g.strokeStyle = '#8a6a48'; g.lineWidth = w * 0.035; g.strokeRect(0, 0, w, h);
  g.fillStyle = CHALK[1]; fitText(g, title, w / 2, h * 0.1, w * 0.85, h * 0.08, 700, FONT_JA);
  let y = h * 0.21;
  for (const [name, price] of items) {
    g.fillStyle = CHALK[Math.floor(r() * CHALK.length)];
    fitText(g, name, w * 0.08, y, w * 0.6, h * 0.05, 500, FONT_JA, 'left');
    g.fillStyle = CHALK[0]; fitText(g, price, w * 0.92, y, w * 0.3, h * 0.05, 700, FONT_EN, 'right');
    y += h * 0.085; if (y > h * 0.8) break;
  }
  // doodle: cup / star
  g.strokeStyle = CHALK[2]; g.lineWidth = 2;
  g.beginPath(); g.arc(w * 0.78, h * 0.88, w * 0.07, 0, Math.PI * 2); g.stroke();
  g.fillStyle = CHALK[3]; fitText(g, 'OPEN', w * 0.3, h * 0.9, w * 0.4, h * 0.06, 700, FONT_EN);
}

// printed photo menu (chain restaurants) — colourful dish photos with prices
export function drawPhotoMenu(g, w, h, title, items, food, accent = '#c8102e') {
  g.fillStyle = '#fbf7ee'; g.fillRect(0, 0, w, h);
  g.fillStyle = accent; g.fillRect(0, 0, w, h * 0.12);
  g.fillStyle = '#fff'; fitText(g, title, w / 2, h * 0.06, w * 0.9, h * 0.07, 900);
  const cols = 2, rows = Math.ceil(Math.min(items.length, 6) / cols);
  const cw = w / cols, ch = (h * 0.86) / Math.max(rows, 1);
  items.slice(0, 6).forEach(([name, price], i) => {
    const cx = (i % cols) * cw, cy = h * 0.13 + Math.floor(i / cols) * ch;
    if (food) food(g, cx + cw * 0.1, cy + ch * 0.04, cw * 0.8, ch * 0.62, i);
    g.fillStyle = '#222'; fitText(g, name, cx + cw / 2, cy + ch * 0.75, cw * 0.9, ch * 0.11, 700);
    g.fillStyle = accent; fitText(g, price, cx + cw / 2, cy + ch * 0.9, cw * 0.9, ch * 0.13, 900, FONT_EN);
  });
}

// POP price card (drugstore/conbini). kind 0..n
const POP = [
  ['#ffe400', '#e60012', '激安'], ['#e60012', '#fff', 'SALE'], ['#ffe400', '#e60012', '特価'], ['#fff', '#e60012', '人気No.1'],
  ['#ff6eb4', '#fff', 'NEW'], ['#00a0e9', '#fff', 'おすすめ'], ['#ffe400', '#111', '数量限定'], ['#e60012', '#ffe400', '本日限り'],
];
export function drawPOP(g, w, h, kind, price) {
  const [bg, fg, word] = POP[kind % POP.length];
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.strokeStyle = fg; g.lineWidth = Math.max(2, w * 0.03); g.strokeRect(g.lineWidth, g.lineWidth, w - 2 * g.lineWidth, h - 2 * g.lineWidth);
  g.fillStyle = fg; fitText(g, word, w / 2, h * 0.3, w * 0.86, h * 0.3, 900);
  if (price) { fitText(g, price, w / 2, h * 0.68, w * 0.9, h * 0.36, 900, FONT_EN); g.font = font(h * 0.1, 700); g.textAlign = 'right'; g.fillText('税込', w * 0.92, h * 0.9); }
}

export function drawBanner(g, w, h, lines, bg = '#e60012', fg = '#fff') {
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = fg;
  const n = lines.length;
  lines.forEach((t, i) => fitText(g, t, w / 2, h * (i + 0.5) / n, w * 0.88, h / n * (i === 0 ? 0.8 : 0.55), 900, i === 0 ? FONT_EN : FONT_JA));
}

export function drawHoarding(g, w, h, b) {
  g.fillStyle = '#f2f0ea'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#d9d4c8'; for (let x = 0; x < w; x += w / 8) g.fillRect(x, 0, 2, h);
  g.fillStyle = '#1c3f6e'; g.fillRect(0, 0, w, h * 0.1); g.fillRect(0, h * 0.9, w, h * 0.1);
  const cx = w / 2;
  g.fillStyle = '#222'; fitText(g, '改装中', cx, h * 0.28, w * 0.5, h * 0.14, 900);
  fitText(g, 'Closed for renovation', cx, h * 0.4, w * 0.6, h * 0.05, 600, FONT_EN);
  g.fillStyle = '#c8102e'; fitText(g, 'リニューアルオープン 11月下旬予定', cx, h * 0.53, w * 0.7, h * 0.055, 700);
  g.fillStyle = '#444'; fitText(g, 'ご迷惑をおかけいたしますが、ご理解とご協力をお願い申し上げます。', cx, h * 0.64, w * 0.8, h * 0.035, 500);
  fitText(g, 'We apologise for any inconvenience.', cx, h * 0.71, w * 0.7, h * 0.035, 500, FONT_EN);
  g.fillStyle = '#1c3f6e'; fitText(g, 'NAMBA ' + (b && b.zone === 'nambawalk' ? 'WALK' : 'CITY'), cx, h * 0.8, w * 0.4, h * 0.045, 800, FONT_EN);
}

export function drawHours(g, w, h, b, fmt) {
  g.fillStyle = '#fbfaf5'; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#222'; g.lineWidth = 4; g.strokeRect(6, 6, w - 12, h - 12);
  g.fillStyle = '#c8102e'; fitText(g, '準備中', w / 2, h * 0.2, w * 0.7, h * 0.16, 900, FONT_SERIF);
  g.fillStyle = '#222'; fitText(g, 'CLOSED — opens ' + fmt(b.hours[0]), w / 2, h * 0.36, w * 0.85, h * 0.07, 700, FONT_EN);
  fitText(g, '営業時間', w / 2, h * 0.52, w * 0.5, h * 0.07, 700);
  fitText(g, `${fmt(b.hours[0])} 〜 ${fmt(b.hours[1] % 1440)}`, w / 2, h * 0.65, w * 0.8, h * 0.11, 900, FONT_EN);
  g.fillStyle = '#555'; fitText(g, b.ja, w / 2, h * 0.82, w * 0.8, h * 0.07, 700, FONT_SERIF);
}

// 食券機 ticket machine front
export function drawTicketMachine(g, w, h, items, accent = '#d81e05') {
  g.fillStyle = '#e9ecef'; g.fillRect(0, 0, w, h);
  g.fillStyle = accent; g.fillRect(0, 0, w, h * 0.08);
  g.fillStyle = '#fff'; fitText(g, '食券', w / 2, h * 0.04, w * 0.5, h * 0.06, 900);
  const cols = 4, rows = 7, bw = w * 0.88 / cols, bh = h * 0.56 / rows;
  for (let i = 0; i < cols * rows; i++) {
    const x = w * 0.06 + (i % cols) * bw, y = h * 0.1 + Math.floor(i / cols) * bh;
    const it = items[i % items.length];
    g.fillStyle = i < 4 ? '#ffeb3b' : i % 5 === 0 ? '#ffd0d0' : '#ffffff';
    rr(g, x + 2, y + 2, bw - 4, bh - 4, 3); g.fill();
    g.fillStyle = '#111'; fitText(g, it[0], x + bw / 2, y + bh * 0.38, bw * 0.86, bh * 0.36, 700);
    g.fillStyle = '#c00'; fitText(g, it[1], x + bw / 2, y + bh * 0.75, bw * 0.86, bh * 0.28, 700, FONT_EN);
  }
  g.fillStyle = '#20232a'; g.fillRect(w * 0.1, h * 0.7, w * 0.35, h * 0.08);
  g.fillStyle = '#7cf'; fitText(g, '0', w * 0.4, h * 0.74, w * 0.1, h * 0.05, 700, FONT_EN);
  g.fillStyle = '#555'; g.fillRect(w * 0.6, h * 0.7, w * 0.08, h * 0.1); g.fillRect(w * 0.75, h * 0.7, w * 0.12, h * 0.04);
  g.fillStyle = '#333'; g.fillRect(w * 0.2, h * 0.88, w * 0.6, h * 0.05);
  g.fillStyle = '#222'; fitText(g, 'おつり  返却', w * 0.3, h * 0.83, w * 0.4, h * 0.03, 500);
}

// drink vending machine front: bottles on shelves with price buttons
const VEND = [
  { body: '#e8e8e8', top: '#e60012', brand: 'DRINK', ja: 'つめた〜い' },
  { body: '#1d4fa3', top: '#0b2f6b', brand: 'AQUA', ja: 'あったか〜い' },
  { body: '#2b2b2b', top: '#111', brand: 'COFFEE', ja: 'BOSS COFFEE' },
  { body: '#0f8a4a', top: '#06572d', brand: 'OCHA', ja: 'お〜いお茶' },
  { body: '#f2f2f2', top: '#0072bc', brand: 'SPORTS', ja: 'ポカリ' },
];
export function drawVending(g, w, h, kind, seed) {
  const V = VEND[kind % VEND.length];
  const r = rng(seed);
  g.fillStyle = V.body; g.fillRect(0, 0, w, h);
  g.fillStyle = V.top; g.fillRect(0, 0, w, h * 0.07);
  g.fillStyle = '#fff'; fitText(g, V.brand, w * 0.3, h * 0.035, w * 0.5, h * 0.045, 900, FONT_EN);
  fitText(g, V.ja, w * 0.75, h * 0.035, w * 0.4, h * 0.03, 700);
  // display window
  const wx = w * 0.06, wy = h * 0.09, ww = w * 0.88, wh = h * 0.52;
  const gr = g.createLinearGradient(0, wy, 0, wy + wh); gr.addColorStop(0, '#fffef8'); gr.addColorStop(1, '#e4ecf0');
  g.fillStyle = gr; g.fillRect(wx, wy, ww, wh);
  const rows = 3, cols = 8;
  const BOT = ['#e60012', '#0068b7', '#ffd400', '#00a040', '#f39800', '#ffffff', '#6a3906', '#e4007f', '#00a0e9', '#222'];
  for (let ry = 0; ry < rows; ry++) {
    const sy = wy + wh * (ry + 1) / rows;
    for (let c = 0; c < cols; c++) {
      const bx = wx + ww * (c + 0.5) / cols, bw2 = ww / cols * 0.62, bh2 = wh / rows * 0.62;
      const col = BOT[Math.floor(r() * BOT.length)];
      const can = r() < 0.4;
      g.fillStyle = col;
      if (can) { rr(g, bx - bw2 * 0.42, sy - bh2 * 0.75 - wh * 0.04, bw2 * 0.84, bh2 * 0.75, 3); g.fill(); }
      else { rr(g, bx - bw2 / 2, sy - bh2 - wh * 0.04, bw2, bh2, 4); g.fill(); g.fillRect(bx - bw2 * 0.18, sy - bh2 * 1.2 - wh * 0.04, bw2 * 0.36, bh2 * 0.25); }
      g.fillStyle = 'rgba(255,255,255,0.75)'; g.fillRect(bx - bw2 * 0.4, sy - bh2 * 0.6 - wh * 0.04, bw2 * 0.8, bh2 * 0.2);
      // price + button
      g.fillStyle = '#111'; g.fillRect(bx - bw2 * 0.5, sy - wh * 0.035, bw2, wh * 0.025);
      g.fillStyle = '#ff3'; fitText(g, String([110, 130, 150, 160, 180][Math.floor(r() * 5)]), bx, sy - wh * 0.022, bw2, wh * 0.022, 700, FONT_EN);
      g.fillStyle = r() < 0.2 ? '#f33' : '#3c6'; g.fillRect(bx - bw2 * 0.3, sy - wh * 0.008, bw2 * 0.6, wh * 0.008);
    }
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(wx, sy - wh * 0.01, ww, 2);
  }
  // lower panel: coin slot, bill, IC reader, take-out
  g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(w * 0.06, h * 0.64, w * 0.88, h * 0.2);
  g.fillStyle = '#222'; g.fillRect(w * 0.68, h * 0.66, w * 0.2, h * 0.08);
  g.fillStyle = '#0af'; g.fillRect(w * 0.7, h * 0.68, w * 0.16, h * 0.04);
  g.fillStyle = '#333'; g.fillRect(w * 0.15, h * 0.86, w * 0.7, h * 0.09);
  g.fillStyle = V.top; fitText(g, 'IC', w * 0.78, h * 0.7, w * 0.1, h * 0.03, 900, FONT_EN);
}

// ---- food (top-view textures, 1:1) ------------------------------------------------
export const FOODS = ['ramen', 'udon', 'curry', 'tendon', 'sushi', 'katsu', 'omurice', 'okonomi', 'kushi', 'parfait', 'toast', 'cake', 'creamsoda', 'bento', 'wagashi', 'bread', 'yakiniku', 'tempura', 'salad', 'takoyaki', 'coffee', 'donburi'];
export function drawFood(g, w, h, kind, seed = 1) {
  const r = rng(seed + hash(kind));
  const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.48;
  const dot = (x, y, rad, c) => { g.fillStyle = c; g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill(); };
  const ell = (x, y, rx, ry, rot, c) => { g.fillStyle = c; g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); g.fill(); };
  g.fillStyle = '#eee'; g.fillRect(0, 0, w, h);
  switch (kind) {
    case 'ramen': case 'udon': {
      dot(cx, cy, R, kind === 'ramen' ? '#c98a3d' : '#e9d9a8');
      g.strokeStyle = kind === 'ramen' ? '#f1d27a' : '#fbf6e6'; g.lineWidth = kind === 'ramen' ? 2 : 5;
      for (let i = 0; i < 26; i++) { g.beginPath(); const a = r() * 6.28; g.arc(cx + Math.cos(a) * R * 0.2, cy + Math.sin(a) * R * 0.2, R * (0.3 + r() * 0.5), a, a + 1.4); g.stroke(); }
      if (kind === 'ramen') { ell(cx - R * 0.35, cy - R * 0.2, R * 0.28, R * 0.22, 0.3, '#e8b48a'); ell(cx - R * 0.35, cy - R * 0.2, R * 0.18, R * 0.12, 0.3, '#c47a52'); dot(cx + R * 0.3, cy + R * 0.25, R * 0.17, '#fff8e6'); dot(cx + R * 0.3, cy + R * 0.25, R * 0.1, '#f5a623'); g.fillStyle = '#1b3b1a'; g.fillRect(cx + R * 0.2, cy - R * 0.7, R * 0.12, R * 0.5); }
      else { ell(cx + R * 0.15, cy - R * 0.1, R * 0.42, R * 0.3, 0.2, '#c8853a'); for (let i = 0; i < 10; i++) dot(cx - R * 0.4 + r() * R * 0.3, cy + R * 0.3 + r() * R * 0.2, R * 0.04, '#5aa83c'); }
      for (let i = 0; i < 12; i++) dot(cx + (r() - 0.5) * R * 1.2, cy + (r() - 0.5) * R * 1.2, R * 0.03, '#3d8a2a');
      break;
    }
    case 'curry': ell(cx - R * 0.25, cy, R * 0.6, R * 0.8, 0, '#fbf7ef'); ell(cx + R * 0.25, cy, R * 0.62, R * 0.85, 0, '#8a4b15'); for (let i = 0; i < 9; i++) dot(cx + R * (0.1 + r() * 0.4), cy + (r() - 0.5) * R, R * 0.09, r() < 0.5 ? '#d27b2b' : '#e8c27a'); break;
    case 'tendon': case 'donburi': case 'tempura': {
      if (kind !== 'tempura') dot(cx, cy, R, '#fbf7ef');
      for (let i = 0; i < (kind === 'tempura' ? 6 : 7); i++) { const a = i / 7 * 6.28 + r(); ell(cx + Math.cos(a) * R * 0.38, cy + Math.sin(a) * R * 0.38, R * 0.36, R * 0.16, a, kind === 'donburi' ? '#c7783a' : '#e8b850'); g.strokeStyle = 'rgba(150,90,20,0.6)'; g.lineWidth = 2; g.stroke(); }
      if (kind !== 'donburi') { ell(cx, cy, R * 0.32, R * 0.13, 0.5, '#f08a5d'); dot(cx - R * 0.1, cy + R * 0.2, R * 0.12, '#3a7a2a'); }
      break;
    }
    case 'sushi': { g.fillStyle = '#2b1e14'; g.fillRect(cx - R, cy - R * 0.7, R * 2, R * 1.4); const C = ['#ff7a5c', '#e83a3a', '#fbe9a0', '#f7a0a0', '#fff', '#ffb547']; for (let i = 0; i < 8; i++) { const x = cx - R * 0.8 + (i % 4) * R * 0.53, y = cy - R * 0.32 + Math.floor(i / 4) * R * 0.62; ell(x, y, R * 0.23, R * 0.15, 0, '#fafafa'); ell(x, y - 2, R * 0.24, R * 0.14, 0, C[Math.floor(r() * C.length)]); } break; }
    case 'katsu': dot(cx, cy, R, '#fafafa'); for (let i = 0; i < 6; i++) { g.fillStyle = '#c78a3e'; g.fillRect(cx - R * 0.55 + i * R * 0.17, cy - R * 0.45, R * 0.15, R * 0.8); } ell(cx + R * 0.45, cy + R * 0.4, R * 0.35, R * 0.25, 0, '#c9e8a6'); break;
    case 'omurice': dot(cx, cy, R, '#fafafa'); ell(cx, cy, R * 0.75, R * 0.45, 0, '#ffd23a'); g.strokeStyle = '#c0281a'; g.lineWidth = R * 0.08; g.beginPath(); g.moveTo(cx - R * 0.5, cy); for (let x = -0.5; x <= 0.5; x += 0.1) g.lineTo(cx + x * R, cy + Math.sin(x * 12) * R * 0.12); g.stroke(); break;
    case 'okonomi': dot(cx, cy, R * 0.9, '#a86a2c'); g.strokeStyle = '#f8f0d8'; g.lineWidth = 2; for (let i = -4; i <= 4; i++) { g.beginPath(); g.moveTo(cx - R * 0.8, cy + i * R * 0.18); g.lineTo(cx + R * 0.8, cy + i * R * 0.18 + R * 0.1); g.stroke(); } for (let i = 0; i < 40; i++) dot(cx + (r() - 0.5) * R * 1.4, cy + (r() - 0.5) * R * 1.4, 1.5, '#5a8a2a'); for (let i = 0; i < 20; i++) dot(cx + (r() - 0.5) * R * 1.2, cy + (r() - 0.5) * R * 1.2, 2, '#e9b2a0'); break;
    case 'kushi': for (let i = 0; i < 6; i++) { const y = cy - R * 0.7 + i * R * 0.28; g.fillStyle = '#d8c39a'; g.fillRect(cx - R * 0.9, y, R * 1.8, 2); ell(cx - R * 0.1, y, R * 0.5, R * 0.11, 0, '#c47f2c'); } break;
    case 'parfait': dot(cx, cy, R, '#f8eee0'); dot(cx, cy, R * 0.7, '#fff'); for (let i = 0; i < 6; i++) dot(cx + Math.cos(i) * R * 0.4, cy + Math.sin(i) * R * 0.4, R * 0.15, ['#e8304a', '#ffcc33', '#7a3a1a'][i % 3]); dot(cx, cy, R * 0.18, '#e8304a'); break;
    case 'toast': g.fillStyle = '#f6e6c0'; rr(g, cx - R * 0.8, cy - R * 0.7, R * 1.6, R * 1.5, R * 0.3); g.fill(); g.fillStyle = '#d09040'; g.fillRect(cx - R * 0.7, cy - R * 0.55, R * 1.4, R * 1.2); g.fillStyle = '#ffe680'; g.fillRect(cx - R * 0.2, cy - R * 0.15, R * 0.4, R * 0.3); break;
    case 'cake': dot(cx, cy, R, '#fff'); g.fillStyle = '#f6e3c3'; g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R * 0.8, -0.6, 0.6); g.fill(); dot(cx + R * 0.5, cy, R * 0.13, '#d6203a'); break;
    case 'creamsoda': dot(cx, cy, R * 0.8, '#3ac06a'); dot(cx, cy, R * 0.45, '#fffbe8'); dot(cx + R * 0.2, cy - R * 0.2, R * 0.12, '#d6203a'); break;
    case 'bento': g.fillStyle = '#1a1a1a'; g.fillRect(0, 0, w, h); { const C = ['#fbf7ef', '#e8b850', '#d6203a', '#3a7a2a', '#f08a5d', '#8a4b15', '#ffd23a', '#c9e8a6']; for (let i = 0; i < 6; i++) { const x = (i % 3) * w / 3, y = Math.floor(i / 3) * h / 2; g.fillStyle = C[Math.floor(r() * C.length)]; g.fillRect(x + 4, y + 4, w / 3 - 8, h / 2 - 8); for (let k = 0; k < 6; k++) dot(x + 8 + r() * (w / 3 - 16), y + 8 + r() * (h / 2 - 16), 3 + r() * 5, C[Math.floor(r() * C.length)]); } } break;
    case 'wagashi': g.fillStyle = '#f4efe4'; g.fillRect(0, 0, w, h); { const C = ['#f7c6d0', '#9fc98a', '#f2e6c8', '#7a4a3a', '#ffffff', '#e8a0b8', '#c8b4e0']; for (let i = 0; i < 9; i++) { const x = w * (0.18 + (i % 3) * 0.32), y = h * (0.18 + Math.floor(i / 3) * 0.32); dot(x, y, w * 0.12, C[Math.floor(r() * C.length)]); dot(x - w * 0.03, y - h * 0.03, w * 0.03, 'rgba(255,255,255,0.5)'); } } break;
    case 'bread': g.fillStyle = '#d8b880'; g.fillRect(0, 0, w, h); for (let i = 0; i < 7; i++) { ell(w * (0.15 + r() * 0.7), h * (0.15 + r() * 0.7), w * 0.16, h * 0.11, r() * 3, ['#b5651d', '#d99a4e', '#8b4513', '#e8c070'][i % 4]); } break;
    case 'yakiniku': dot(cx, cy, R, '#222'); for (let i = 0; i < 7; i++) ell(cx + (r() - 0.5) * R, cy + (r() - 0.5) * R, R * 0.28, R * 0.15, r() * 3, r() < 0.5 ? '#c0384a' : '#e07080'); break;
    case 'salad': dot(cx, cy, R, '#fff'); for (let i = 0; i < 30; i++) dot(cx + (r() - 0.5) * R * 1.4, cy + (r() - 0.5) * R * 1.4, R * 0.12, ['#5aa83c', '#8ccf5a', '#d6203a', '#ffcc33', '#f08a5d'][i % 5]); break;
    case 'takoyaki': g.fillStyle = '#e8d8b8'; g.fillRect(0, 0, w, h); for (let i = 0; i < 8; i++) { const x = w * (0.2 + (i % 4) * 0.2), y = h * (0.35 + Math.floor(i / 4) * 0.3); dot(x, y, w * 0.1, '#b46a28'); } g.strokeStyle = '#3a1a08'; g.lineWidth = 3; for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(w * 0.1, h * (0.3 + i * 0.1)); g.lineTo(w * 0.9, h * (0.25 + i * 0.12)); g.stroke(); } for (let i = 0; i < 30; i++) dot(r() * w, r() * h, 2, '#3d8a2a'); break;
    case 'coffee': dot(cx, cy, R, '#fff'); dot(cx, cy, R * 0.7, '#4a2a14'); g.strokeStyle = '#d8b88a'; g.lineWidth = 3; g.beginPath(); g.arc(cx, cy, R * 0.35, 0, 5); g.stroke(); break;
    default: dot(cx, cy, R, '#ddd');
  }
}

// ---- product facings: a strip ~1.2 m of shelf (w:h ≈ 6:1) --------------------------
export const PRODUCT_KINDS = ['drug', 'cosme', 'snack', 'drink', 'book', 'magazine', 'stationery', 'souvenir', 'folded', 'shoes', 'gadget', 'zakka', 'gacha', 'bread', 'onigiri', 'bottles', 'coffeebag', 'toys'];
export function drawProducts(g, w, h, kind, seed) {
  const r = rng(seed * 977 + hash(kind));
  const pal = {
    drug: ['#ffffff', '#e6f2ff', '#ffe9ef', '#e60012', '#0068b7', '#00a040', '#f39800', '#ffd400', '#7d3c98'],
    cosme: ['#f8d7da', '#ffffff', '#111111', '#c9a96e', '#e8b4b8', '#b76e79', '#f5e6e8', '#6d2e46'],
    snack: ['#e60012', '#ffd400', '#f39800', '#00a040', '#0068b7', '#e4007f', '#6a3906', '#ffffff'],
    drink: ['#e60012', '#0068b7', '#00a040', '#ffd400', '#ffffff', '#6a3906', '#f39800', '#00a0e9'],
    book: ['#1d3557', '#e63946', '#f1faee', '#a8dadc', '#457b9d', '#2a9d8f', '#e9c46a', '#264653', '#f4a261', '#ffffff'],
    magazine: ['#ff006e', '#fb5607', '#ffbe0b', '#3a86ff', '#8338ec', '#ffffff', '#111111'],
    stationery: ['#ff595e', '#ffca3a', '#8ac926', '#1982c4', '#6a4c93', '#ffffff', '#222'],
    souvenir: ['#c8102e', '#f2c14e', '#ffffff', '#1d3557', '#e76f51', '#2a9d8f', '#d4a373'],
    folded: ['#f1faee', '#a8dadc', '#457b9d', '#1d3557', '#e9c46a', '#264653', '#bc6c25', '#dda15e', '#283618', '#9b2226'],
    shoes: ['#ffffff', '#111111', '#e63946', '#457b9d', '#bc6c25', '#d4a373', '#adb5bd'],
    gadget: ['#111111', '#ffffff', '#adb5bd', '#3a86ff', '#e63946'],
    zakka: ['#d4a373', '#ccd5ae', '#e9edc9', '#faedcd', '#fefae0', '#a98467', '#6c584c', '#ffffff'],
    gacha: ['#ff006e', '#ffbe0b', '#3a86ff', '#8338ec', '#06d6a0', '#ffffff'],
    bread: ['#b5651d', '#d99a4e', '#8b4513', '#e8c070', '#f3d7a4'],
    onigiri: ['#ffffff', '#111111', '#e60012', '#00a040', '#ffd400'],
    bottles: ['#e60012', '#0068b7', '#00a040', '#ffd400', '#ffffff', '#00a0e9', '#f39800'],
    coffeebag: ['#6a3906', '#d4a373', '#222', '#f1e3c8', '#8c2f39'],
    toys: ['#ff006e', '#ffbe0b', '#3a86ff', '#8338ec', '#06d6a0', '#ef476f'],
  }[kind] || ['#ccc', '#888', '#fff'];
  const P = () => pal[Math.floor(r() * pal.length)];
  g.fillStyle = kind === 'gacha' ? '#fff' : '#2a2a2a'; g.fillRect(0, 0, w, h);
  let x = 1;
  while (x < w - 2) {
    let pw, ph, c = P();
    switch (kind) {
      case 'book': pw = h * (0.08 + r() * 0.1); ph = h * (0.7 + r() * 0.28); break;
      case 'magazine': pw = h * 0.72; ph = h * 0.98; break;
      case 'drink': case 'bottles': pw = h * 0.28; ph = h * (0.75 + r() * 0.2); break;
      case 'folded': pw = h * (0.8 + r() * 0.4); ph = h * (0.25 + r() * 0.1); break;
      case 'shoes': pw = h * 0.9; ph = h * 0.4; break;
      case 'cosme': pw = h * (0.16 + r() * 0.16); ph = h * (0.4 + r() * 0.5); break;
      case 'onigiri': pw = h * 0.6; ph = h * 0.55; break;
      case 'gacha': pw = h * 0.5; ph = h * 0.5; break;
      default: pw = h * (0.3 + r() * 0.45); ph = h * (0.5 + r() * 0.45);
    }
    const facings = kind === 'book' || kind === 'magazine' ? 1 : 1 + Math.floor(r() * 3);
    for (let f = 0; f < facings && x < w - 2; f++) {
      const y = h - ph;
      g.fillStyle = c;
      if (kind === 'drink' || kind === 'bottles') {
        rr(g, x + 1, y + ph * 0.18, pw - 2, ph * 0.82, pw * 0.25); g.fill();
        g.fillRect(x + pw * 0.32, y, pw * 0.36, ph * 0.22);
        g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillRect(x + 2, y + ph * 0.45, pw - 4, ph * 0.22);
      } else if (kind === 'gacha') {
        g.beginPath(); g.arc(x + pw / 2, h * 0.5, pw * 0.45, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.7)'; g.fillRect(x + pw * 0.05, h * 0.5, pw * 0.9, pw * 0.45);
      } else if (kind === 'onigiri') {
        g.beginPath(); g.moveTo(x + pw / 2, y); g.lineTo(x + pw - 2, h - 1); g.lineTo(x + 2, h - 1); g.closePath(); g.fill();
        g.fillStyle = '#111'; g.fillRect(x + pw * 0.3, h - ph * 0.45, pw * 0.4, ph * 0.45);
        g.fillStyle = r() < 0.5 ? '#e60012' : '#00a040'; g.fillRect(x + pw * 0.1, y + ph * 0.25, pw * 0.8, ph * 0.08);
      } else if (kind === 'shoes') {
        g.beginPath(); g.ellipse(x + pw * 0.5, h - ph * 0.45, pw * 0.48, ph * 0.42, 0, Math.PI, 0); g.fill(); g.fillRect(x + 2, h - ph * 0.45, pw - 4, ph * 0.4);
        g.fillStyle = '#eee'; g.fillRect(x + 2, h - ph * 0.12, pw - 4, ph * 0.1);
      } else if (kind === 'folded') {
        g.fillRect(x + 1, y, pw - 2, ph); g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x + 1, y + ph * 0.45, pw - 2, 2); g.fillRect(x + 1, y + ph - 3, pw - 2, 3);
        // stack several
        g.fillStyle = c; g.fillRect(x + 1, y - ph * 1.05, pw - 2, ph); g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x + 1, y - 3, pw - 2, 3);
      } else {
        g.fillRect(x + 1, y, pw - 2, ph);
        // label band / logo
        const lc = P(); g.fillStyle = lc === c ? '#fff' : lc;
        if (kind === 'book') { g.fillRect(x + 1, y + ph * 0.1, pw - 2, ph * 0.08); g.fillStyle = 'rgba(255,255,255,0.7)'; for (let k = 0; k < 4; k++) g.fillRect(x + pw * 0.3, y + ph * (0.3 + k * 0.1), pw * 0.4, ph * 0.04); }
        else if (kind === 'magazine') { g.fillRect(x + 2, y + 2, pw - 4, ph * 0.18); g.fillStyle = P(); g.beginPath(); g.arc(x + pw * 0.5, y + ph * 0.58, pw * 0.3, 0, 6.3); g.fill(); g.fillStyle = '#fff'; g.fillRect(x + 4, y + ph * 0.85, pw * 0.6, ph * 0.05); }
        else { g.fillRect(x + 1, y + ph * (0.3 + r() * 0.3), pw - 2, ph * 0.18); g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(x + 2, y + 2, pw * 0.25, ph - 4); }
      }
      x += pw + (kind === 'book' ? 0.5 : 1.5);
    }
  }
  // shelf lip shadow
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 0, w, h * 0.06);
}

// shelf edge price rail with small yellow/white tags
export function drawPriceRail(g, w, h, seed, pop = true) {
  const r = rng(seed);
  g.fillStyle = '#f5f5f2'; g.fillRect(0, 0, w, h);
  let x = 2;
  while (x < w - 10) {
    const tw = h * (1.6 + r() * 1.2);
    const yellow = pop && r() < 0.35;
    g.fillStyle = yellow ? '#ffe400' : '#ffffff'; g.fillRect(x, 1, tw, h - 2);
    g.fillStyle = yellow ? '#e60012' : '#111'; fitText(g, '¥' + (98 + Math.floor(r() * 30) * 10), x + tw * 0.6, h * 0.55, tw * 0.75, h * 0.7, 900, FONT_EN);
    x += tw + 3 + r() * h * 2;
  }
}

// ---- wall menu: vertical wooden tanzaku tags ------------------------------------------
export function drawTanzaku(g, w, h, items) {
  g.fillStyle = '#3a2614'; g.fillRect(0, 0, w, h);
  const n = items.length, tw = w / n;
  items.forEach(([name, price], i) => {
    const x = i * tw;
    g.fillStyle = i % 5 === 0 ? '#f2e3c0' : '#e8d4a8'; g.fillRect(x + tw * 0.08, h * 0.03, tw * 0.84, h * 0.94);
    g.fillStyle = '#1a1208'; vText(g, name, x + tw / 2, h * 0.07, h * 0.72, tw * 0.62, 700, FONT_SERIF);
    g.fillStyle = '#b01010'; fitText(g, price, x + tw / 2, h * 0.86, tw * 0.8, tw * 0.35, 700, FONT_EN);
  });
}

// ---- ads / posters / light boxes -----------------------------------------------------
export const AD_KINDS = POSTER_KINDS;
// v2: the twelve posters live in posters.js (resolution independent, portrait 2:3 + landscape 16:9 compositions)
export function drawAd(g, w, h, kind) { drawPoster(g, w, h, kind); }
function drawFoodInset(g, x, y, w, h, kind) { g.save(); g.translate(x, y); drawFood(g, w, h, kind); g.restore(); }
