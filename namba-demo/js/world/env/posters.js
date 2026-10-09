// =============================================================================
// Posters / ads (v2): twelve designed posters, each in a PORTRAIT (2:3) and a LANDSCAPE (16:9) composition.
//
// Every painter works in a fixed design space (portrait 400x600, landscape 800x450) and is scaled to the canvas
// it is given, so the artwork is resolution independent; the atlas allocates them at 384x576 / 640x360 or more
// (see env/atlas.js `poster` pages). Callers must keep the quad's aspect equal to POSTER_ASPECT (never stretch).
//
//   drawPoster(g, w, h, kind)          paints one poster filling the whole w x h canvas
//   POSTER_KINDS                       the twelve kinds
//   POSTER_TEXT                        every glyph used (so the webfont subsets are loaded before painting)
// =============================================================================
import { FONT_JA, FONT_EN, FONT_SERIF } from './kit.js?v=f150c03';
import { rng, hash } from '../../core/rng.js?v=f150c03';

// (local copies of the draw.js helpers: draw.js delegates drawAd() to this module, so no import cycle)
function fitText(g, text, x, y, maxW, size, weight = 700, fam = FONT_JA, align = 'center') {
  let s = size;
  g.font = `${weight} ${Math.round(s)}px ${fam}`;
  let mw = g.measureText(text).width;
  if (mw > maxW) { s = Math.max(6, s * maxW / mw); g.font = `${weight} ${Math.round(s)}px ${fam}`; mw = g.measureText(text).width; }
  g.textAlign = align; g.textBaseline = 'middle';
  g.fillText(text, x, y);
  return { size: s, width: mw };
}
function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

export const POSTER_ASPECT = 2 / 3;         // width / height of the portrait art
export const POSTER_LAND_ASPECT = 16 / 9;
export const POSTER_PORT = [384, 576];       // atlas allocation (px)
export const POSTER_LAND = [640, 360];
export const POSTER_KINDS = ['cosme', 'drink', 'movie', 'expo', 'travel', 'halloween', 'autumn', 'phone', 'beer', 'concert', 'ramenfair', 'museum'];

const TAU = Math.PI * 2;

// ---- layout: where the hero art and the text go -------------------------------------------------------------------
function zones(L) {
  return L
    ? { art: [0, 0, 450, 450], tx: 620, tw: 300, ty: 225, left: false }
    : { art: [0, 0, 400, 392], tx: 200, tw: 350, ty: 392, left: false };
}
// text stack: kicker (small caps), title (big), sub, tag. Portrait stacks downward from y; landscape is vertically centred.
function stack(g, L, o, col) {
  const Z = zones(L);
  const items = [];
  if (o.kicker) items.push({ t: o.kicker, s: L ? 20 : 17, w: 700, f: FONT_EN, c: col.kicker || col.sub, gap: L ? 14 : 8 });
  items.push({ t: o.title, s: o.titleSize || (L ? 56 : 56), w: 900, f: o.serif ? FONT_SERIF : FONT_JA, c: col.title, gap: L ? 14 : 10 });
  if (o.title2) items.push({ t: o.title2, s: o.titleSize || (L ? 56 : 56), w: 900, f: o.serif ? FONT_SERIF : FONT_JA, c: col.title, gap: L ? 14 : 10 });
  if (o.sub) items.push({ t: o.sub, s: L ? 24 : 22, w: 700, f: FONT_JA, c: col.sub, gap: L ? 12 : 8 });
  if (o.tag) items.push({ t: o.tag, s: L ? 19 : 16, w: 800, f: FONT_EN, c: col.tag || col.sub, gap: 0, track: true });
  let total = items.reduce((a, it) => a + it.s * 1.12 + it.gap, 0);
  const y0 = L ? 0 : Z.ty + 12, avail = L ? 410 : 600 - y0 - 14;
  const k = Math.min(1, avail / total);
  total *= k;
  let y = L ? 225 - total / 2 : y0;
  for (const it of items) {
    g.fillStyle = it.c;
    const sz = it.s * k, yc = y + sz * 0.56;
    if (it.track) { g.save(); if ('letterSpacing' in g) g.letterSpacing = '2px'; fitText(g, it.t, Z.tx, yc, Z.tw, sz, it.w, it.f); g.restore(); }
    else fitText(g, it.t, Z.tx, yc, Z.tw, sz, it.w, it.f);
    y += sz * 1.12 + it.gap * k;
  }
}
function grain(g, W, H, seed, a = 0.05) {
  const r = rng(seed);
  for (let i = 0; i < 380; i++) { g.fillStyle = r() < 0.5 ? `rgba(0,0,0,${a * r()})` : `rgba(255,255,255,${a * r()})`; g.fillRect(r() * W, r() * H, 1 + r() * 2.5, 1 + r() * 2.5); }
}
const disc = (g, x, y, r, c) => { g.fillStyle = c; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); };
const lin = (g, x0, y0, x1, y1, stops) => { const gr = g.createLinearGradient(x0, y0, x1, y1); stops.forEach(([o, c]) => gr.addColorStop(o, c)); return gr; };
const rad = (g, x, y, r0, r1, stops) => { const gr = g.createRadialGradient(x, y, r0, x, y, r1); stops.forEach(([o, c]) => gr.addColorStop(o, c)); return gr; };
// art box helper: clip to it and translate so painters draw in (0,0,bw,bh)
function inBox(g, box, fn) { const [x, y, w, h] = box; g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); g.translate(x, y); fn(w, h); g.restore(); }

// ---- the twelve designs --------------------------------------------------------------------------------------------
const DESIGNS = {
  // Nankai: Koyasan limited express
  travel(g, L, W, H) {
    const Z = zones(L);
    g.fillStyle = '#10243a'; g.fillRect(0, 0, W, H);
    inBox(g, Z.art, (w, h) => {
      g.fillStyle = lin(g, 0, 0, 0, h, [[0, '#2c5d86'], [0.45, '#f1b27a'], [0.75, '#f7d9a8'], [1, '#f6e6c4']]); g.fillRect(0, 0, w, h);
      disc(g, w * 0.7, h * 0.34, h * 0.075, '#fff4d8');
      g.fillStyle = rad(g, w * 0.7, h * 0.34, 4, h * 0.3, [[0, 'rgba(255,240,200,0.55)'], [1, 'rgba(255,240,200,0)']]); g.fillRect(0, 0, w, h);
      const ridge = (y0, amp, col, seed) => { const r = rng(seed); g.fillStyle = col; g.beginPath(); g.moveTo(0, h); let y = y0; for (let x = 0; x <= w + 20; x += 20) { y = y0 + Math.sin(x * 0.021 + seed) * amp + Math.sin(x * 0.053 + seed * 2) * amp * 0.45 + (r() - 0.5) * 4; g.lineTo(x, y); } g.lineTo(w, h); g.fill(); };
      ridge(h * 0.5, 22, '#7d8fa8', 3); ridge(h * 0.6, 20, '#4f6d7c', 5);
      g.fillStyle = 'rgba(255,255,255,0.35)'; for (let k = 0; k < 3; k++) { g.beginPath(); g.ellipse(w * (0.2 + k * 0.3), h * (0.58 + k * 0.03), w * 0.26, 7, 0, 0, TAU); g.fill(); }
      ridge(h * 0.72, 16, '#2f4a3a', 9);
      // pagoda (tahoto): vermilion, two roofs
      const px = w * 0.34, base = h * 0.78;
      g.fillStyle = '#c4361b'; g.fillRect(px - 26, base - 52, 52, 52);
      g.fillStyle = '#2b1f1a'; g.beginPath(); g.moveTo(px - 54, base - 52); g.lineTo(px + 54, base - 52); g.lineTo(px + 38, base - 66); g.lineTo(px - 38, base - 66); g.fill();
      g.fillStyle = '#c4361b'; g.fillRect(px - 18, base - 100, 36, 34);
      g.fillStyle = '#2b1f1a'; g.beginPath(); g.moveTo(px - 42, base - 100); g.lineTo(px + 42, base - 100); g.lineTo(px + 26, base - 116); g.lineTo(px - 26, base - 116); g.fill();
      g.fillRect(px - 2, base - 148, 4, 34); g.fillStyle = '#e8c25a'; g.fillRect(px - 8, base - 142, 16, 3);
      g.fillStyle = '#10261c'; // cedars
      for (let i = 0; i < 16; i++) { const tx = w * (i / 15), th = 70 + ((i * 37) % 50), ty = h * 0.78 + ((i * 13) % 12); g.beginPath(); g.moveTo(tx - 16, h); g.lineTo(tx, h - th - (h - ty - 40)); g.lineTo(tx + 16, h); g.fill(); }
      g.fillStyle = '#10261c'; g.fillRect(0, h * 0.93, w, h * 0.07);
    });
    // brand stripe
    g.fillStyle = '#f08300'; if (L) g.fillRect(450, 0, 8, H); else g.fillRect(0, 386, W, 8);
    g.fillStyle = '#10243a';
    stack(g, L, { kicker: '南海電鉄  特急「こうや」', title: '高野山へ、', title2: '特急で。', sub: '難波から約1時間20分', tag: 'NANKAI · KOYASAN WORLD HERITAGE' }, { title: '#ffffff', sub: '#f6c98a', kicker: '#8fb7d6', tag: '#f08300' });
  },
  drink(g, L, W, H) {
    const Z = zones(L);
    g.fillStyle = lin(g, 0, 0, W, H, [[0, '#0a5cbf'], [1, '#063a7d']]); g.fillRect(0, 0, W, H);
    inBox(g, Z.art, (w, h) => {
      const r = rng(11);
      for (let i = 0; i < 70; i++) { const x = r() * w, y = r() * h, rr2 = 2 + r() * 9; g.strokeStyle = `rgba(255,255,255,${0.25 + r() * 0.5})`; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, rr2, 0, TAU); g.stroke(); if (r() < 0.4) { g.fillStyle = 'rgba(255,255,255,0.15)'; g.fill(); } }
      // can
      const cx = w / 2, cw = Math.min(w, h) * 0.32, ch = h * 0.72, cy = h * 0.5;
      g.save(); g.translate(cx, cy); g.rotate(-0.12);
      g.fillStyle = rad(g, 0, 0, 10, ch, [[0, 'rgba(255,255,255,0.5)'], [1, 'rgba(255,255,255,0)']]); g.fillRect(-w, -h, w * 2, h * 2);
      g.fillStyle = lin(g, -cw / 2, 0, cw / 2, 0, [[0, '#b9c6d3'], [0.18, '#f4f8fb'], [0.55, '#d9e6f1'], [1, '#8fa4b8']]); rr(g, -cw / 2, -ch / 2, cw, ch, 14); g.fill();
      g.fillStyle = '#0a5cbf'; g.beginPath(); g.moveTo(-cw / 2, -ch * 0.06); g.bezierCurveTo(-cw * 0.2, -ch * 0.2, cw * 0.2, ch * 0.08, cw / 2, -ch * 0.08); g.lineTo(cw / 2, ch * 0.16); g.bezierCurveTo(cw * 0.2, ch * 0.28, -cw * 0.2, 0.02 * ch, -cw / 2, ch * 0.14); g.fill();
      g.fillStyle = '#fff'; g.save(); g.translate(0, ch * 0.05); g.rotate(-0.04); fitText(g, 'AQUA', 0, 0, cw * 0.8, cw * 0.28, 900, FONT_EN); g.restore();
      g.fillStyle = lin(g, -cw / 2, 0, cw / 2, 0, [[0, '#9aa9b8'], [0.5, '#e9f0f6'], [1, '#8394a6']]); rr(g, -cw / 2 + 4, -ch / 2 - 8, cw - 8, 14, 5); g.fill(); rr(g, -cw / 2 + 4, ch / 2 - 6, cw - 8, 14, 5); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.55)'; g.fillRect(-cw / 2 + 12, -ch / 2 + 10, 7, ch - 20);
      g.restore();
      // splash
      g.fillStyle = 'rgba(255,255,255,0.8)'; for (let i = 0; i < 18; i++) { const a = r() * TAU, d = cw * (0.8 + r() * 0.9); g.beginPath(); g.ellipse(cx + Math.cos(a) * d, cy + h * 0.28 + Math.sin(a) * d * 0.4, 3 + r() * 4, 5 + r() * 6, a, 0, TAU); g.fill(); }
    });
    stack(g, L, { kicker: 'SPARKLING AQUA', title: 'ごくっと、秋。', sub: '爽快スパークリングウォーター', tag: 'NEW 500ml' }, { title: '#ffffff', sub: '#bfe2ff', kicker: '#7ec3ff', tag: '#ffe14d' });
  },
  movie(g, L, W, H) {
    const Z = zones(L);
    g.fillStyle = '#07070d'; g.fillRect(0, 0, W, H);
    inBox(g, Z.art, (w, h) => {
      g.fillStyle = lin(g, 0, 0, 0, h, [[0, '#0b0b1a'], [0.55, '#5b2a52'], [0.78, '#ff7a2a'], [1, '#ffd27a']]); g.fillRect(0, 0, w, h);
      disc(g, w * 0.5, h * 0.74, h * 0.2, '#fff1c8');
      g.fillStyle = rad(g, w * 0.5, h * 0.74, h * 0.1, h * 0.55, [[0, 'rgba(255,170,70,0.65)'], [1, 'rgba(255,170,70,0)']]); g.fillRect(0, 0, w, h);
      const r = rng(5); for (let i = 0; i < 50; i++) disc(g, r() * w, r() * h * 0.5, 0.6 + r() * 1.4, `rgba(255,255,255,${0.3 + r() * 0.6})`);
      g.fillStyle = '#05050a'; g.beginPath(); g.moveTo(0, h); g.lineTo(0, h * 0.84); g.lineTo(w * 0.22, h * 0.8); g.lineTo(w * 0.38, h * 0.86); g.lineTo(w * 0.5, h * 0.82); g.lineTo(w * 0.7, h * 0.88); g.lineTo(w, h * 0.82); g.lineTo(w, h); g.fill();
      // lone figure on a ridge
      const fx = w * 0.5, fy = h * 0.83;
      g.fillStyle = '#05050a'; g.fillRect(fx - 4, fy - 40, 8, 30); disc(g, fx, fy - 46, 5.5, '#05050a'); g.beginPath(); g.moveTo(fx - 4, fy - 36); g.lineTo(fx - 22, fy - 12); g.lineTo(fx - 16, fy - 10); g.lineTo(fx - 3, fy - 28); g.fill();
      g.fillRect(fx - 4, fy - 12, 3.5, 14); g.fillRect(fx + 0.5, fy - 12, 3.5, 14);
    });
    stack(g, L, { kicker: '10.24 FRI  ROADSHOW', title: '夜明けの境界線', serif: true, titleSize: L ? 46 : 50, sub: '全国ロードショー', tag: 'THE EDGE OF DAWN' }, { title: '#fff6e0', sub: '#ffb347', kicker: '#ffb347', tag: '#9aa0b4' });
  },
  expo(g, L, W, H) {
    const Z = zones(L);
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
    inBox(g, Z.art, (w, h) => {
      g.fillStyle = lin(g, 0, 0, 0, h, [[0, '#e8f1fb'], [1, '#ffffff']]); g.fillRect(0, 0, w, h);
      const cx = w / 2, cy = h * 0.5, R = Math.min(w, h) * 0.3;
      const r = rng(21);
      for (let i = 0; i < 10; i++) { const a = i / 10 * TAU - 1.2; g.fillStyle = '#e60012'; g.beginPath(); g.ellipse(cx + Math.cos(a) * R, cy + Math.sin(a) * R, R * 0.3, R * 0.2, a, 0, TAU); g.fill(); g.fillStyle = '#ff6b78'; g.beginPath(); g.ellipse(cx + Math.cos(a) * (R * 1.0 - 9), cy + Math.sin(a) * (R * 1.0 - 9), R * 0.15, R * 0.09, a, 0, TAU); g.fill(); }
      for (let i = 0; i < 5; i++) { const a = i / 5 * TAU + 0.4; g.fillStyle = '#0068b7'; g.beginPath(); g.arc(cx + Math.cos(a) * R * 0.52, cy + Math.sin(a) * R * 0.52, R * 0.12, 0, TAU); g.fill(); }
      disc(g, cx, cy, R * 0.26, '#0068b7'); disc(g, cx, cy, R * 0.15, '#ffffff'); disc(g, cx, cy, R * 0.07, '#e60012');
      g.strokeStyle = 'rgba(0,104,183,0.35)'; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, R * 1.55, 0, TAU); g.stroke(); g.beginPath(); g.arc(cx, cy, R * 1.75, 0, TAU); g.stroke();
      for (let i = 0; i < 24; i++) disc(g, r() * w, r() * h, 1.5 + r() * 2.5, 'rgba(0,104,183,0.25)');
    });
    stack(g, L, { kicker: 'OSAKA · KANSAI  FUTURE FAIR', title: 'いのち輝く', title2: '未来へ', titleSize: L ? 54 : 52, sub: '大阪・関西 みらいフェア', tag: '10.1 – 10.31' }, { title: '#16335c', sub: '#e60012', kicker: '#0068b7', tag: '#0068b7' });
  },
  cosme(g, L, W, H) {
    const Z = zones(L);
    g.fillStyle = lin(g, 0, 0, W, H, [[0, '#fbe6ec'], [1, '#eaa9bd']]); g.fillRect(0, 0, W, H);
    inBox(g, Z.art, (w, h) => {
      const cx = w / 2, cy = h * 0.52;
      g.fillStyle = 'rgba(255,255,255,0.55)'; g.beginPath(); g.arc(cx, cy, Math.min(w, h) * 0.38, 0, TAU); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.arc(cx, cy, Math.min(w, h) * 0.46, 0, TAU); g.fill();
      // bottle
      const bw = w * 0.2, bh = h * 0.5, bx = cx - bw / 2, by = cy - bh * 0.45;
      g.fillStyle = lin(g, bx, 0, bx + bw, 0, [[0, '#c4607a'], [0.35, '#f7b9c9'], [0.7, '#d77a92'], [1, '#a84560']]); rr(g, bx, by, bw, bh, 16); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.65)'; rr(g, bx + 8, by + 12, 8, bh - 40, 4); g.fill();
      g.fillStyle = lin(g, bx, 0, bx + bw, 0, [[0, '#a8832a'], [0.4, '#f6dc86'], [1, '#8c6a1c']]); g.fillRect(bx + bw * 0.18, by - bh * 0.17, bw * 0.64, bh * 0.19); rr(g, bx + bw * 0.12, by - bh * 0.07, bw * 0.76, bh * 0.07, 3); g.fill();
      g.fillStyle = '#ffffff'; fitText(g, 'L', cx, by + bh * 0.5, bw * 0.7, bw * 0.55, 300, FONT_SERIF);
      g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 2; g.beginPath(); g.moveTo(bx + bw * 0.2, by + bh * 0.72); g.lineTo(bx + bw * 0.8, by + bh * 0.72); g.stroke();
      const r = rng(8); for (let i = 0; i < 9; i++) { const sx = r() * w, sy = r() * h, ss = 5 + r() * 9; g.fillStyle = 'rgba(255,255,255,0.85)'; g.beginPath(); g.moveTo(sx, sy - ss); g.quadraticCurveTo(sx, sy, sx + ss, sy); g.quadraticCurveTo(sx, sy, sx, sy + ss); g.quadraticCurveTo(sx, sy, sx - ss, sy); g.quadraticCurveTo(sx, sy, sx, sy - ss); g.fill(); }
    });
    stack(g, L, { kicker: 'LUMIÈRE  PARIS · TOKYO', title: 'うるおい、続く。', titleSize: L ? 46 : 46, sub: '新エッセンス  ¥4,400', tag: 'NEW  10.1' }, { title: '#6d2e46', sub: '#8e3f5a', kicker: '#9a5a70', tag: '#6d2e46' });
  },
  halloween(g, L, W, H) {
    const Z = zones(L);
    g.fillStyle = '#170c2a'; g.fillRect(0, 0, W, H);
    inBox(g, Z.art, (w, h) => {
      g.fillStyle = lin(g, 0, 0, 0, h, [[0, '#120a26'], [0.7, '#3b1a5c'], [1, '#6a2a5a']]); g.fillRect(0, 0, w, h);
      disc(g, w * 0.74, h * 0.2, h * 0.11, '#ffe9a8'); g.fillStyle = rad(g, w * 0.74, h * 0.2, 5, h * 0.3, [[0, 'rgba(255,233,168,0.4)'], [1, 'rgba(255,233,168,0)']]); g.fillRect(0, 0, w, h);
      const bat = (x, y, s) => { g.fillStyle = '#0a0414'; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x - s * 0.5, y - s * 0.55, x - s, y - s * 0.1); g.quadraticCurveTo(x - s * 0.7, y + s * 0.05, x - s * 0.5, y + s * 0.15); g.quadraticCurveTo(x - s * 0.3, y, x - s * 0.1, y + s * 0.2); g.lineTo(x, y + s * 0.1); g.lineTo(x + s * 0.1, y + s * 0.2); g.quadraticCurveTo(x + s * 0.3, y, x + s * 0.5, y + s * 0.15); g.quadraticCurveTo(x + s * 0.7, y + s * 0.05, x + s, y - s * 0.1); g.quadraticCurveTo(x + s * 0.5, y - s * 0.55, x, y); g.fill(); };
      bat(w * 0.2, h * 0.2, 22); bat(w * 0.5, h * 0.12, 16); bat(w * 0.34, h * 0.32, 12);
      const pump = (x, y, R, tilt) => { g.save(); g.translate(x, y); g.rotate(tilt);
        g.fillStyle = '#e8641a'; for (const k of [-0.6, 0.6]) { g.beginPath(); g.ellipse(k * R * 0.55, 0, R * 0.62, R * 0.9, 0, 0, TAU); g.fill(); } g.fillStyle = '#ff7f26'; g.beginPath(); g.ellipse(0, 0, R * 0.7, R * 0.95, 0, 0, TAU); g.fill();
        g.fillStyle = '#2e5e1e'; g.fillRect(-R * 0.08, -R * 1.2, R * 0.16, R * 0.3);
        g.fillStyle = '#1a0a2a'; g.beginPath(); g.moveTo(-R * 0.38, -R * 0.18); g.lineTo(-R * 0.14, -R * 0.44); g.lineTo(-R * 0.08, -R * 0.1); g.fill(); g.beginPath(); g.moveTo(R * 0.38, -R * 0.18); g.lineTo(R * 0.14, -R * 0.44); g.lineTo(R * 0.08, -R * 0.1); g.fill();
        g.beginPath(); g.moveTo(-R * 0.5, R * 0.2); for (let i = 0; i < 6; i++) g.lineTo(-R * 0.5 + (i + 0.5) * R / 6, R * (i % 2 ? 0.32 : 0.52)); g.lineTo(R * 0.5, R * 0.2); g.lineTo(R * 0.5, R * 0.32); g.lineTo(-R * 0.5, R * 0.32); g.fill();
        g.fillStyle = rad(g, 0, R * 0.2, 2, R * 0.9, [[0, 'rgba(255,220,100,0.55)'], [1, 'rgba(255,220,100,0)']]); g.fillRect(-R, -R, R * 2, R * 2);
        g.restore(); };
      pump(w * 0.3, h * 0.68, w * 0.14, -0.08); pump(w * 0.62, h * 0.74, w * 0.17, 0.06); pump(w * 0.84, h * 0.66, w * 0.1, 0.12);
      g.fillStyle = '#0a0414'; g.beginPath(); g.moveTo(0, h); g.lineTo(0, h * 0.9); for (let x = 0; x <= w; x += 22) g.lineTo(x, h * (0.9 + 0.02 * Math.sin(x * 0.3))); g.lineTo(w, h); g.fill();
    });
    stack(g, L, { kicker: 'NAMBA HALLOWEEN 2025', title: 'HAPPY', title2: 'HALLOWEEN', titleSize: L ? 44 : 46, sub: 'なんばハロウィン 10.1 – 10.31', tag: 'TRICK OR TREAT' }, { title: '#ff9a3c', sub: '#ffe9a8', kicker: '#b88aff', tag: '#b88aff' });
    void FONT_EN;
  },
  autumn(g, L, W, H) {
    const Z = zones(L);
    g.fillStyle = '#f6ecd8'; g.fillRect(0, 0, W, H);
    inBox(g, Z.art, (w, h) => {
      g.fillStyle = lin(g, 0, 0, 0, h, [[0, '#f9efd9'], [1, '#f0dcb4']]); g.fillRect(0, 0, w, h);
      const r = rng(31);
      const maple = (x, y, s, rot, col) => { g.save(); g.translate(x, y); g.rotate(rot); g.fillStyle = col; g.beginPath(); for (let k = 0; k < 10; k++) { const a = k / 10 * TAU - Math.PI / 2, rr2 = k % 2 ? s * 0.45 : s; g.lineTo(Math.cos(a) * rr2, Math.sin(a) * rr2); } g.closePath(); g.fill(); g.strokeStyle = 'rgba(80,20,0,0.35)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(0, 0); g.lineTo(0, s * 1.15); g.stroke(); g.restore(); };
      for (let i = 0; i < 22; i++) maple(r() * w, r() * h, 14 + r() * 24, r() * 6, ['#c0392b', '#e67e22', '#d4a017', '#a04000', '#b5301f'][i % 5]);
      // basket still life: persimmon, chestnut, ginkgo
      const cx = w / 2, cy = h * 0.66;
      g.fillStyle = '#8a5a2a'; g.beginPath(); g.ellipse(cx, cy + 36, w * 0.28, 26, 0, 0, Math.PI); g.lineTo(cx - w * 0.28, cy + 36); g.fill();
      g.strokeStyle = 'rgba(60,30,10,0.4)'; g.lineWidth = 1.5; for (let k = 0; k < 7; k++) { g.beginPath(); g.moveTo(cx - w * 0.26 + k * w * 0.087, cy + 38); g.lineTo(cx - w * 0.26 + k * w * 0.087 + 6, cy + 60); g.stroke(); }
      for (const [x, y, s, c] of [[-60, 8, 38, '#ee8a1c'], [-5, -6, 42, '#f29a28'], [56, 8, 36, '#e0701c']]) { g.fillStyle = c; g.beginPath(); g.ellipse(cx + x, cy + y, s, s * 0.86, 0, 0, TAU); g.fill(); g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.ellipse(cx + x - s * 0.3, cy + y - s * 0.3, s * 0.22, s * 0.14, -0.6, 0, TAU); g.fill(); g.fillStyle = '#3d6b1e'; for (let k = 0; k < 4; k++) { g.beginPath(); g.ellipse(cx + x + Math.cos(k * 1.6) * s * 0.35, cy + y - s * 0.78 + Math.sin(k * 1.6) * 4, s * 0.3, s * 0.12, k * 1.6, 0, TAU); g.fill(); } }
      for (let k = 0; k < 4; k++) { g.fillStyle = '#6a3a1a'; g.beginPath(); g.ellipse(cx - 90 + k * 14, cy + 30 + (k % 2) * 4, 9, 11, 0, 0, TAU); g.fill(); g.fillStyle = '#8a5a30'; g.beginPath(); g.ellipse(cx - 92 + k * 14, cy + 27 + (k % 2) * 4, 3, 4, 0, 0, TAU); g.fill(); }
    });
    stack(g, L, { kicker: 'AUTUMN FOOD FAIR', title: '秋の味覚フェア', serif: true, titleSize: L ? 46 : 52, sub: '柿 · 栗 · 銀杏 · 新米', tag: 'NAMBA CITY  10.1 – 11.30' }, { title: '#7b2d0a', sub: '#a4571f', kicker: '#a4571f', tag: '#7b2d0a' });
  },
  phone(g, L, W, H) {
    const Z = zones(L);
    g.fillStyle = '#f3f3f5'; g.fillRect(0, 0, W, H);
    inBox(g, Z.art, (w, h) => {
      g.fillStyle = lin(g, 0, 0, w, h, [[0, '#f8f8fb'], [1, '#dcdde6']]); g.fillRect(0, 0, w, h);
      for (let i = 0; i < 5; i++) { g.strokeStyle = `rgba(106,76,200,${0.1 + i * 0.03})`; g.lineWidth = 2; g.beginPath(); g.arc(w / 2, h * 0.5, h * (0.18 + i * 0.07), 0, TAU); g.stroke(); }
      const pw = Math.min(w, h) * 0.34, ph = pw * 2.05, px = w / 2 - pw / 2, py = h * 0.5 - ph / 2;
      g.save(); g.shadowColor = 'rgba(0,0,0,0.3)'; g.shadowBlur = 24; g.shadowOffsetY = 12; g.fillStyle = '#16161a'; rr(g, px, py, pw, ph, pw * 0.14); g.fill(); g.restore();
      g.fillStyle = lin(g, px, py, px + pw, py + ph, [[0, '#6f3bd4'], [0.5, '#ff5aa0'], [1, '#ffb347']]); rr(g, px + 6, py + 6, pw - 12, ph - 12, pw * 0.11); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.25)'; g.beginPath(); g.moveTo(px + 6, py + ph * 0.45); g.lineTo(px + pw - 6, py + ph * 0.2); g.lineTo(px + pw - 6, py + 6); g.lineTo(px + 6, py + 6); g.fill();
      g.fillStyle = '#16161a'; rr(g, px + pw * 0.36, py + 10, pw * 0.28, 9, 4.5); g.fill();
      g.fillStyle = '#ffffff'; fitText(g, '9:41', w / 2, py + ph * 0.32, pw * 0.7, pw * 0.3, 300, FONT_EN);
      g.fillStyle = '#16161a'; disc(g, px + pw - 14, py + ph * 0.18, 0, '#000');
    });
    stack(g, L, { kicker: 'MOBILE STATION', title: '新機種、登場。', titleSize: L ? 46 : 48, sub: 'のりかえ最大 22,000円 還元', tag: '10.18 SAT  予約受付中' }, { title: '#16161a', sub: '#e60012', kicker: '#6a4cc8', tag: '#6a4cc8' });
  },
  beer(g, L, W, H) {
    const Z = zones(L);
    g.fillStyle = '#b3101f'; g.fillRect(0, 0, W, H);
    inBox(g, Z.art, (w, h) => {
      g.fillStyle = rad(g, w / 2, h * 0.55, 10, h * 0.8, [[0, '#e0283a'], [1, '#8a0a16']]); g.fillRect(0, 0, w, h);
      const cx = w / 2, mw = Math.min(w, h) * 0.34, mh = h * 0.56, my = h * 0.28;
      g.fillStyle = lin(g, cx - mw / 2, 0, cx + mw / 2, 0, [[0, '#f2b632'], [0.4, '#ffd86a'], [1, '#d99a1c']]); rr(g, cx - mw / 2, my, mw, mh, 10); g.fill();
      g.strokeStyle = '#f4f6f8'; g.lineWidth = 12; g.beginPath(); g.moveTo(cx + mw / 2, my + mh * 0.2); g.bezierCurveTo(cx + mw * 0.95, my + mh * 0.2, cx + mw * 0.95, my + mh * 0.78, cx + mw / 2 - 2, my + mh * 0.78); g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(cx - mw / 2 + 10, my + 14, 9, mh - 28);
      g.fillStyle = 'rgba(255,255,255,0.55)'; for (let i = 0; i < 24; i++) disc(g, cx - mw / 2 + 14 + ((i * 53) % (mw - 28)), my + 20 + ((i * 97) % (mh - 40)), 1.5 + (i % 3), 'rgba(255,255,255,0.55)');
      g.fillStyle = '#fff'; for (const [x, y, s] of [[-0.35, -0.04, 0.2], [-0.05, -0.1, 0.26], [0.28, -0.04, 0.22], [0.52, 0.02, 0.15], [-0.55, 0.03, 0.14]]) { g.beginPath(); g.arc(cx + x * mw, my + y * mh, s * mw, 0, TAU); g.fill(); }
      g.fillRect(cx - mw / 2, my, mw, mh * 0.04);
      g.fillStyle = '#e6ecef'; for (let i = 0; i < 7; i++) g.fillRect(cx - mw / 2 + 4 + i * (mw - 8) / 7, my + mh * 0.0, 1, 0);
      const r = rng(2); for (let i = 0; i < 14; i++) { const a = -Math.PI * (0.1 + r() * 0.8); const d = mw * (0.7 + r() * 0.9); disc(g, cx + Math.cos(a) * d, my + Math.sin(a) * d * 0.6 - 10, 2 + r() * 4, 'rgba(255,255,255,0.7)'); }
    });
    stack(g, L, { kicker: 'KANPAI LAGER  生', title: '秋、乾杯。', sub: 'とびきりの一杯を。', tag: 'AUTUMN LIMITED' }, { title: '#fff3e0', sub: '#ffd86a', kicker: '#ffb0a8', tag: '#ffd86a' });
  },
  concert(g, L, W, H) {
    const Z = zones(L);
    g.fillStyle = '#0a0a10'; g.fillRect(0, 0, W, H);
    inBox(g, Z.art, (w, h) => {
      g.fillStyle = '#0a0a10'; g.fillRect(0, 0, w, h);
      const cx = w / 2, cy = h * 0.46;
      for (let i = 0; i < 6; i++) { g.strokeStyle = ['#ff006e', '#3a86ff', '#ffbe0b'][i % 3]; g.lineWidth = 5 - i * 0.4; g.globalAlpha = 1 - i * 0.1; g.beginPath(); g.arc(cx, cy, Math.min(w, h) * (0.08 + i * 0.065), 0, TAU); g.stroke(); }
      g.globalAlpha = 1;
      for (let k = 0; k < 7; k++) { const a = -Math.PI / 2 + (k - 3) * 0.28; g.fillStyle = `rgba(${k % 2 ? '58,134,255' : '255,0,110'},0.13)`; g.beginPath(); g.moveTo(cx + (k - 3) * 40, h); g.lineTo(cx + Math.cos(a) * h * 1.2, cy + Math.sin(a) * h * 1.2 - 40); g.lineTo(cx + Math.cos(a + 0.12) * h * 1.2, cy + Math.sin(a + 0.12) * h * 1.2 - 40); g.fill(); }
      g.fillStyle = '#0a0a10'; g.beginPath(); g.moveTo(0, h); for (let x = 0; x <= w; x += 12) g.lineTo(x, h * 0.9 - (Math.abs(Math.sin(x * 0.4)) * 10)); g.lineTo(w, h); g.fill();
      // guitarist silhouette
      g.fillStyle = '#0a0a10'; disc(g, cx, cy + 34, 12, '#0a0a10'); g.fillRect(cx - 12, cy + 46, 24, 50); g.fillRect(cx - 12, cy + 96, 10, 40); g.fillRect(cx + 2, cy + 96, 10, 40);
      g.save(); g.translate(cx, cy + 74); g.rotate(-0.5); g.fillRect(-30, -4, 70, 7); g.beginPath(); g.ellipse(-10, 8, 16, 11, 0, 0, TAU); g.fill(); g.restore();
    });
    stack(g, L, { kicker: 'LIVE AT NAMBA HATCH', title: 'NAMBA', title2: 'HATCH LIVE', titleSize: L ? 46 : 48, sub: '11.08 SAT  OPEN 17:00', tag: 'TICKETS ON SALE NOW' }, { title: '#ffffff', sub: '#ffbe0b', kicker: '#ff4d94', tag: '#7ab0ff' });
  },
  ramenfair(g, L, W, H) {
    const Z = zones(L);
    g.fillStyle = '#f4c430'; g.fillRect(0, 0, W, H);
    inBox(g, Z.art, (w, h) => {
      g.fillStyle = rad(g, w / 2, h * 0.52, 20, h * 0.8, [[0, '#ffe27a'], [1, '#f0b020']]); g.fillRect(0, 0, w, h);
      const cx = w / 2, cy = h * 0.55, R = Math.min(w, h) * 0.36;
      g.save(); g.shadowColor = 'rgba(80,20,0,0.4)'; g.shadowBlur = 20; g.shadowOffsetY = 10; g.fillStyle = '#b01010'; g.beginPath(); g.ellipse(cx, cy + R * 0.2, R * 1.1, R * 0.95, 0, 0, TAU); g.fill(); g.restore();
      g.fillStyle = '#7a0a0a'; g.beginPath(); g.ellipse(cx, cy, R * 1.04, R * 0.9, 0, 0, TAU); g.fill();
      g.fillStyle = '#c98a3d'; g.beginPath(); g.ellipse(cx, cy, R * 0.92, R * 0.78, 0, 0, TAU); g.fill();
      g.strokeStyle = '#f1d27a'; g.lineWidth = 3; const r = rng(4); for (let i = 0; i < 34; i++) { g.beginPath(); const a = r() * TAU; g.arc(cx + Math.cos(a) * R * 0.2, cy + Math.sin(a) * R * 0.15, R * (0.25 + r() * 0.6), a, a + 1.3); g.stroke(); }
      for (const [x, y] of [[-0.4, -0.2], [-0.08, -0.36], [0.28, -0.22]]) { g.fillStyle = '#f2c9a0'; g.beginPath(); g.ellipse(cx + x * R, cy + y * R, R * 0.3, R * 0.2, 0.2, 0, TAU); g.fill(); g.fillStyle = '#c47a52'; g.beginPath(); g.ellipse(cx + x * R, cy + y * R, R * 0.2, R * 0.12, 0.2, 0, TAU); g.fill(); }
      g.fillStyle = '#fff8e6'; g.beginPath(); g.ellipse(cx + R * 0.38, cy + R * 0.3, R * 0.22, R * 0.17, 0, 0, TAU); g.fill(); g.fillStyle = '#f2a21a'; disc(g, cx + R * 0.38, cy + R * 0.3, R * 0.08, '#f2a21a');
      g.fillStyle = '#1a2f1a'; g.save(); g.translate(cx + R * 0.7, cy - R * 0.1); g.rotate(0.2); g.fillRect(-R * 0.08, -R * 0.3, R * 0.16, R * 0.6); g.restore();
      for (let k = 0; k < 14; k++) disc(g, cx + (r() - 0.5) * R * 1.2, cy + (r() - 0.5) * R * 0.9, 2.5, '#3d8a2a');
      g.strokeStyle = 'rgba(255,255,255,0.65)'; g.lineWidth = 7; g.lineCap = 'round'; for (const x of [-0.35, 0, 0.35]) { g.beginPath(); g.moveTo(cx + x * R, cy - R * 0.6); g.bezierCurveTo(cx + x * R + 20, cy - R * 0.9, cx + x * R - 20, cy - R * 1.1, cx + x * R + 8, cy - R * 1.4); g.stroke(); }
    });
    stack(g, L, { kicker: 'NAMBA PARKS RAMEN EXPO', title: 'ラーメン博', titleSize: L ? 60 : 62, sub: 'なんばパークス 10/10〜10/19', tag: '全国の名店 12 軒' }, { title: '#b01010', sub: '#3a1a00', kicker: '#7a4a00', tag: '#7a0a0a' });
  },
  museum(g, L, W, H) {
    const Z = zones(L);
    g.fillStyle = '#ece6d6'; g.fillRect(0, 0, W, H);
    inBox(g, Z.art, (w, h) => {
      g.fillStyle = lin(g, 0, 0, 0, h, [[0, '#f1e6c8'], [0.7, '#e3d3a6'], [1, '#d6c28f']]); g.fillRect(0, 0, w, h);
      disc(g, w * 0.78, h * 0.17, h * 0.07, '#c9402a');
      // Fuji, small
      g.fillStyle = '#23405f'; g.beginPath(); g.moveTo(w * 0.1, h * 0.55); g.lineTo(w * 0.34, h * 0.36); g.lineTo(w * 0.58, h * 0.55); g.fill(); g.fillStyle = '#f4f1e8'; g.beginPath(); g.moveTo(w * 0.27, h * 0.4); g.lineTo(w * 0.34, h * 0.36); g.lineTo(w * 0.41, h * 0.4); g.lineTo(w * 0.375, h * 0.415); g.lineTo(w * 0.34, h * 0.395); g.lineTo(w * 0.3, h * 0.415); g.fill();
      // big wave
      const wave = (col, dy, sc) => { g.fillStyle = col; g.beginPath(); g.moveTo(0, h); g.lineTo(0, h * (0.72 + dy)); g.bezierCurveTo(w * 0.15, h * (0.68 + dy), w * 0.3, h * (0.5 + dy), w * 0.55 * sc + w * 0.1, h * (0.3 + dy)); g.bezierCurveTo(w * 0.78, h * (0.22 + dy), w * 0.95, h * (0.4 + dy), w * 0.9, h * (0.56 + dy)); g.bezierCurveTo(w * 0.86, h * (0.5 + dy), w * 0.78, h * (0.42 + dy), w * 0.7, h * (0.46 + dy)); g.bezierCurveTo(w * 0.8, h * (0.6 + dy), w * 0.9, h * (0.72 + dy), w, h * (0.74 + dy)); g.lineTo(w, h); g.fill(); };
      wave('#17375e', 0.04, 1); wave('#234d80', 0.1, 0.96);
      g.fillStyle = '#f4f1e8'; for (let i = 0; i < 9; i++) { const a = -0.2 + i * 0.28, rx = w * 0.62 + Math.cos(a) * w * 0.16, ry = h * 0.3 + Math.sin(a * 1.4) * h * 0.04 + i * h * 0.012; g.beginPath(); g.arc(rx, ry, 5 + (i % 3) * 2.5, 0, TAU); g.fill(); }
      g.strokeStyle = '#f4f1e8'; g.lineWidth = 2; g.beginPath(); g.moveTo(w * 0.7, h * 0.46); g.bezierCurveTo(w * 0.82, h * 0.44, w * 0.9, h * 0.52, w * 0.9, h * 0.58); g.stroke();
      g.fillStyle = '#f4f1e8'; for (let i = 0; i < 6; i++) g.fillRect(0 + i * 3, h * (0.82 + i * 0.02), w, 1.5);
      g.fillStyle = '#c9402a'; g.fillRect(w * 0.06, h * 0.07, 22, 52); g.fillStyle = '#ece6d6'; fitText(g, '北斎', w * 0.06 + 11, h * 0.07 + 26, 18, 18, 900, FONT_SERIF);
    });
    stack(g, L, { kicker: '特別展  SPECIAL EXHIBITION', title: '北斎と浪華の', title2: '浮世絵', serif: true, titleSize: L ? 46 : 50, sub: '大阪市立美術館', tag: 'OSAKA CITY MUSEUM OF ART' }, { title: '#17375e', sub: '#234d80', kicker: '#8a2a18', tag: '#8a2a18' });
  },
};

export const POSTER_TEXT = '南海電鉄特急こうや高野山へ、で。難波から約時間分世界遺産ごくっと秋爽快スパークリングウォーター夜明けの境界線全国ロードショーいのち輝く未来大阪関西みらいフェアうるおい続く新エッセンスハロウィンなんば味覚柿栗銀杏米新機種登場のりかえ最大還元予約受付中乾杯とびきり一杯をラーメン博なんばパークス全国名店軒北斎浪華浮世絵市立美術館特別展';

// Paint the poster `kind` over the whole canvas (aspect decides portrait/landscape).
export function drawPoster(g, w, h, kind) {
  const L = w > h;
  const DW = L ? 800 : 400, DH = L ? 450 : 600;
  const fn = DESIGNS[kind] || DESIGNS.autumn;
  g.save();
  g.scale(w / DW, h / DH);
  g.fillStyle = '#fff'; g.fillRect(0, 0, DW, DH);
  fn(g, L, DW, DH);
  grain(g, DW, DH, hash('pg' + kind), 0.035);
  // hairline paper edge
  g.strokeStyle = 'rgba(0,0,0,0.18)'; g.lineWidth = 2; g.strokeRect(1, 1, DW - 2, DH - 2);
  g.restore();
}
