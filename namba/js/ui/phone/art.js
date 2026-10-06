// =============================================================================
// Place-card "photos": small generated canvas illustrations per category, and
// deterministic review snippets. No external images.
// =============================================================================
import { rng, hash } from '../../core/rng.js';
import { catGroup } from './maprender.js';

const cache = new Map();

function grad(g, x0, y0, x1, y1, stops) { const gr = g.createLinearGradient(x0, y0, x1, y1); stops.forEach(([o, c]) => gr.addColorStop(o, c)); return gr; }

export function placeArt(b, W = 600, H = 260) {
  const key = b.slot + W;
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const R = rng(hash(b.slot || b.en));
  const cat = b.cat;
  const grp = catGroup(cat);
  // background: interior wall + bokeh lights
  const warm = grp === 'food' || grp === 'cafe';
  g.fillStyle = grad(g, 0, 0, 0, H, warm ? [[0, '#3a2a1f'], [0.6, '#6b4a33'], [1, '#2a1d15']] : [[0, '#d9dde3'], [1, '#9aa3ad']]);
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 26; i++) {
    const x = R() * W, y = R() * H * 0.6, r = 6 + R() * 26;
    const col = warm ? `rgba(255,${180 + R() * 60 | 0},${100 + R() * 60 | 0},${0.08 + R() * 0.18})` : `rgba(255,255,255,${0.1 + R() * 0.25})`;
    g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  // counter / table
  g.fillStyle = grad(g, 0, H * 0.62, 0, H, warm ? [[0, '#c89a63'], [1, '#7a5532']] : [[0, '#f2f2f0'], [1, '#c9c9c5']]);
  g.fillRect(0, H * 0.64, W, H * 0.36);
  g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, H * 0.64, W, 3);
  const cx = W * (0.42 + R() * 0.16), cy = H * 0.66;
  if (cat === 'cafe' || cat === 'kissaten' || cat === 'coffeestand') {
    // saucer + cup + latte art + steam
    g.fillStyle = '#f4f1ea'; g.beginPath(); g.ellipse(cx, cy + 18, 92, 22, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = cat === 'kissaten' ? '#7d2e2e' : '#fbfaf6';
    g.beginPath(); g.moveTo(cx - 58, cy - 40); g.lineTo(cx + 58, cy - 40); g.quadraticCurveTo(cx + 54, cy + 18, cx, cy + 18); g.quadraticCurveTo(cx - 54, cy + 18, cx - 58, cy - 40); g.fill();
    g.lineWidth = 9; g.strokeStyle = g.fillStyle; g.beginPath(); g.arc(cx + 66, cy - 18, 18, -1.2, 1.4); g.stroke();
    g.fillStyle = '#6b3f22'; g.beginPath(); g.ellipse(cx, cy - 40, 56, 13, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#e9d3b4'; g.beginPath(); g.ellipse(cx, cy - 40, 26, 7, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 5;
    for (let i = -1; i <= 1; i++) { g.beginPath(); g.moveTo(cx + i * 20, cy - 60); g.bezierCurveTo(cx + i * 20 - 14, cy - 85, cx + i * 20 + 14, cy - 100, cx + i * 20, cy - 125); g.stroke(); }
    if (cat === 'coffeestand') { g.fillStyle = '#c7c9cc'; g.fillRect(W * 0.08, H * 0.2, 46, 120); g.fillStyle = '#222'; g.fillRect(W * 0.08 + 8, H * 0.2 + 12, 30, 20); }
  } else if (cat === 'tempura' || cat === 'tendon') {
    if (cat === 'tendon') {
      g.fillStyle = '#2b1a14'; g.beginPath(); g.ellipse(cx, cy, 120, 40, 0, 0, Math.PI); g.fill();
      g.fillStyle = '#8c2f1e'; g.beginPath(); g.ellipse(cx, cy, 120, 22, 0, 0, Math.PI * 2); g.fill();
    } else {
      g.fillStyle = '#f7f3e6'; g.beginPath(); g.moveTo(cx - 120, cy - 4); g.lineTo(cx + 110, cy - 14); g.lineTo(cx + 120, cy + 24); g.lineTo(cx - 110, cy + 30); g.closePath(); g.fill();
    }
    for (let i = 0; i < 4; i++) {
      const px = cx - 70 + i * 46, py = cy - 8 - (i % 2) * 8, rot = -0.5 + R() * 0.3;
      g.save(); g.translate(px, py); g.rotate(rot);
      g.fillStyle = '#e8b85c'; g.beginPath(); g.ellipse(0, 0, 44, 15, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,240,190,0.7)'; for (let k = 0; k < 9; k++) { g.beginPath(); g.arc(-36 + k * 9, -6 + (k % 3) * 5, 3.5, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = '#e2583e'; g.beginPath(); g.moveTo(40, 0); g.lineTo(58, -10); g.lineTo(56, 9); g.closePath(); g.fill();
      g.restore();
    }
    g.fillStyle = '#3b6b3f'; g.beginPath(); g.ellipse(cx + 80, cy - 18, 20, 10, 0.4, 0, Math.PI * 2); g.fill();
  } else if (cat === 'ramen' || cat === 'udon') {
    g.fillStyle = '#1b1b1b'; g.beginPath(); g.ellipse(cx, cy - 10, 120, 38, 0, 0, Math.PI); g.lineTo(cx - 120, cy - 10); g.fill();
    g.fillStyle = cat === 'udon' ? '#d9b46a' : '#c98d4a'; g.beginPath(); g.ellipse(cx, cy - 10, 116, 26, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#f3e3b0'; g.lineWidth = cat === 'udon' ? 7 : 3;
    for (let i = 0; i < 9; i++) { g.beginPath(); g.moveTo(cx - 90 + i * 20, cy - 20); g.quadraticCurveTo(cx - 80 + i * 20, cy - 4, cx - 70 + i * 20, cy - 18); g.stroke(); }
    g.fillStyle = '#f5f0e6'; g.beginPath(); g.arc(cx + 40, cy - 16, 16, 0, Math.PI * 2); g.fill(); g.fillStyle = '#f2b21d'; g.beginPath(); g.arc(cx + 40, cy - 16, 8, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#4f8a3a'; for (let i = 0; i < 8; i++) { g.beginPath(); g.arc(cx - 40 + R() * 30, cy - 18 + R() * 8, 3, 0, Math.PI * 2); g.fill(); }
  } else if (cat === 'sushi') {
    for (let i = 0; i < 5; i++) {
      const px = cx - 100 + i * 50, py = cy - 6;
      g.fillStyle = '#f8f6f0'; g.beginPath(); g.ellipse(px, py, 20, 12, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = ['#f06a4d', '#f4a15d', '#e64545', '#f6d6c4', '#d4433f'][i]; g.beginPath(); g.ellipse(px, py - 8, 23, 9, 0, 0, Math.PI * 2); g.fill();
    }
  } else if (grp === 'food') {
    g.fillStyle = '#f2efe8'; g.beginPath(); g.ellipse(cx, cy, 110, 28, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = cat === 'okonomiyaki' ? '#b8743a' : cat === 'curry' ? '#9b5a1c' : cat === 'yakiniku' ? '#7b2c22' : cat === 'omurice' ? '#f3c443' : '#c47b3a';
    g.beginPath(); g.ellipse(cx, cy - 6, 76, 20, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 3; g.beginPath(); g.moveTo(cx - 50, cy - 8); g.bezierCurveTo(cx - 10, cy - 20, cx + 10, cy + 4, cx + 50, cy - 10); g.stroke();
  } else if (grp === 'cafe') {
    g.fillStyle = '#f9f2e6'; g.beginPath(); g.ellipse(cx, cy, 90, 22, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = cat === 'bakery' ? '#c98a3d' : '#f3d4d8'; g.beginPath(); g.ellipse(cx, cy - 22, 50, 26, 0, 0, Math.PI * 2); g.fill();
  } else {
    // shop interior: shelves / rack
    g.fillStyle = 'rgba(255,255,255,0.45)'; g.fillRect(W * 0.1, H * 0.22, W * 0.8, 4);
    for (let i = 0; i < 9; i++) {
      const x = W * 0.14 + i * W * 0.085;
      g.fillStyle = `hsl(${(R() * 360) | 0}, ${30 + R() * 30}%, ${45 + R() * 25}%)`;
      g.beginPath(); g.moveTo(x, H * 0.24); g.lineTo(x + 26, H * 0.3); g.lineTo(x + 22, H * 0.58); g.lineTo(x - 22, H * 0.58); g.lineTo(x - 26, H * 0.3); g.closePath(); g.fill();
    }
  }
  // vignette & noren hint
  g.fillStyle = grad(g, 0, 0, 0, H, [[0, 'rgba(0,0,0,0.35)'], [0.3, 'rgba(0,0,0,0)'], [0.8, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.3)']]);
  g.fillRect(0, 0, W, H);
  if (grp === 'food' && b.ja) {
    g.fillStyle = '#20324d'; g.fillRect(W * 0.7, 0, W * 0.24, H * 0.34);
    g.fillStyle = 'rgba(255,255,255,0.9)'; g.font = `700 ${H * 0.1 | 0}px "Noto Sans JP", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(b.ja.split(/\s/)[0].slice(0, 4), W * 0.82, H * 0.16);
  }
  const url = c.toDataURL('image/jpeg', 0.82);
  cache.set(key, url);
  return url;
}

const REVIEWS = {
  cafe: [['Quiet corner seats, good for charging your phone.', 4], ['Coffee was okay, the cake was the star.', 4], ['Hard to find — it is NOT where the map says, go around the back.', 3], ['Crowded at lunch. Staff very kind though.', 4]],
  coffeestand: [['Best pour-over I had in Osaka. Tiny, standing only.', 5], ['Hidden in the passage near the Midosuji gates. Walked past it twice!', 5], ['Queue of salarymen at 8am. Worth it.', 5]],
  kissaten: [['Time machine to 1975. Siphon coffee and thick toast.', 5], ['Smoky in the back room, but the coffee is serious.', 4]],
  tempura: [['Watching the chef fry each piece in front of you is magic.', 5], ['Lunch set is a steal. Line at 11:30 was 40 minutes.', 4], ['Took me ages to find — it is up in Parks, not in Namba CITY.', 5]],
  tendon: [['Fast, cheap, filling. Ticket machine at the door.', 4], ['Not the tempura of your dreams but hits the spot.', 3]],
  food: [['Solid local spot, English menu available.', 4], ['Portions are huge. Expect a short wait.', 4], ['Good but overpriced for what it is.', 3]],
  retail: [['Nice selection, tax-free over ¥5,000.', 4], ['Staff helpful, store a bit cramped.', 3]],
  service: [['Open late, useful.', 4], ['Always busy but quick.', 3]],
  closed: [['Closed for renovation (改装中). Map still shows it as open.', 1]],
};
const NAMES = ['Mika T.', 'Daniel R.', 'Yuto K.', 'Sophie L.', 'Haruka S.', 'Marco P.', 'Chen W.', 'Aiko N.', 'Liam O.', 'Rina M.'];

const KEYED_REVIEWS = {
  tempura_great: [['Counter seats only. Get there before 11:30 or queue an hour. Worth it.', 5, 'Mika T.'], ['Sesame oil, kisu and kabocha. The line wraps around the escalator by 12:15.', 5, 'Hiro'], ['Tourist trap? No. But arrive early.', 4, 'Dan R.']],
  coffee_great: [['カウンターだけ。朝はいつも並んでる。', 5, 'ゆうこ'], ['Hard to find. Look for the queue, not the sign.', 5, 'Sam W.']],
};
// "Popular times": 7:00–21:00 relative busyness (deterministic per business)
export function popularTimes(b) {
  const R = rng(hash('pop' + (b.slot || b.en)));
  const food = catGroup(b.cat) === 'food', cafe = catGroup(b.cat) === 'cafe';
  const out = [];
  for (let h = 7; h <= 21; h++) {
    let v = 0.15 + R() * 0.12;
    if (food) v += 0.9 * Math.exp(-Math.pow((h - 12.5) / 1.1, 2)) + 0.55 * Math.exp(-Math.pow((h - 18.6) / 1.5, 2));
    else if (cafe) v += 0.7 * Math.exp(-Math.pow((h - 8.3) / 1.2, 2)) + 0.5 * Math.exp(-Math.pow((h - 15) / 1.6, 2));
    else v += 0.6 * Math.exp(-Math.pow((h - 15.5) / 2.6, 2));
    out.push(Math.min(1, v));
  }
  return out;
}
export function reviewsFor(b) {
  if (b.key && KEYED_REVIEWS[b.key]) return KEYED_REVIEWS[b.key].map(([text, stars, who], i) => ({ who, text, stars, when: `${2 + i * 3} weeks ago` }));
  const R = rng(hash('rev' + (b.slot || b.en)));
  const list = REVIEWS[b.cat] || REVIEWS[catGroup(b.cat)] || REVIEWS.retail;
  const out = [];
  const n = Math.min(2, list.length);
  const start = Math.floor(R() * list.length);
  for (let i = 0; i < n; i++) {
    const [text, stars] = list[(start + i) % list.length];
    out.push({ who: NAMES[Math.floor(R() * NAMES.length)], text, stars, when: `${1 + Math.floor(R() * 11)} months ago` });
  }
  return out;
}
