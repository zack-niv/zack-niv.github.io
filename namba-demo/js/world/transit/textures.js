// =============================================================================
// Transit canvas textures: car livery atlas (+ roughness/metal), interior atlas
// (swatches, adverts, route strips), emissive atlas (lamps + LED destination
// panels, JA column / EN column), floor-marking decal atlas.
// All generated once at init (lazily cached through ctx.materials.texture).
// =============================================================================
import * as THREE from 'three';
import { DESTS, TYPES, LINES } from './timetable.js';

export const JP = '"Noto Sans JP","Noto Sans CJK JP","Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic","Meiryo",sans-serif';
export const EN = '"Inter","Helvetica Neue",Arial,sans-serif';

export async function loadFonts() {
  if (!document.fonts || !document.fonts.load) return;
  const t = new Promise(r => setTimeout(r, 2500));
  try { await Promise.race([Promise.all([document.fonts.load(`700 32px "Noto Sans JP"`), document.fonts.load(`500 32px "Noto Sans JP"`), document.fonts.load(`600 32px "Inter"`)]), t]); } catch (e) { /* fall back */ }
}

export function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
export function canvasTex(c, { srgb = true, mips = true, aniso = 4, nearest = false } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (!mips) { t.generateMipmaps = false; t.minFilter = nearest ? THREE.NearestFilter : THREE.LinearFilter; }
  if (nearest) t.magFilter = THREE.NearestFilter;
  return t;
}
// fit text into maxW by squeezing horizontally (as real signage does)
export function fitText(g, text, x, y, maxW, align = 'left') {
  const w = g.measureText(text).width;
  const s = w > maxW ? maxW / w : 1;
  g.save();
  g.translate(x, y);
  g.scale(s, 1);
  g.textAlign = align;
  g.fillText(text, 0, 0);
  g.restore();
  return w * s;
}

// ---------------------------------------------------------------------------------
// CAR ATLAS: 32 columns x 256 px. Columns 0..7 liveries (vertical, indexed by
// the body-local height y in [LIV_Y0, LIV_Y1]); columns 8..31 solid swatches.
// ---------------------------------------------------------------------------------
export const LIV_Y0 = -0.75, LIV_Y1 = 3.0;
export const LIV = { m30k: 0, s25: 1, rapit: 2, comm: 3, south: 4, door_steel: 5, rapit_door: 6, south_door: 7 };
export const SW = {
  stainless: 8, under: 9, black: 10, roof: 11, rubber: 12, white: 13, mred: 14, spink: 15, nkorange: 16, nkblue: 17,
  rapitblue: 18, yellow: 19, bogie: 20, chrome: 21, gangway: 22, midgrey: 23, panto: 24, glossblack: 25, redlamp: 26,
  rapitlight: 27, southblue: 28, wheel: 29, cream: 30, darkroof: 31,
};
const SWC = {
  stainless: ['#c4c8cd', 0.30, 0.85], under: ['#2a2c30', 0.75, 0.35], black: ['#0d0e10', 0.25, 0.1], roof: ['#7c8086', 0.6, 0.5],
  rubber: ['#141414', 0.9, 0.0], white: ['#eeeeec', 0.35, 0.05], mred: ['#E5171F', 0.35, 0.15], spink: ['#E44D93', 0.35, 0.15],
  nkorange: ['#F08300', 0.35, 0.15], nkblue: ['#174a9c', 0.35, 0.15], rapitblue: ['#1b3480', 0.28, 0.45], yellow: ['#f2c300', 0.5, 0.0],
  bogie: ['#1e1f22', 0.7, 0.4], chrome: ['#dfe3e7', 0.15, 1.0], gangway: ['#19191b', 0.85, 0.0], midgrey: ['#686c72', 0.5, 0.5],
  panto: ['#3b3e44', 0.5, 0.6], glossblack: ['#050607', 0.08, 0.0], redlamp: ['#5a0c0c', 0.2, 0.0], rapitlight: ['#2d5bc8', 0.28, 0.45],
  southblue: ['#0f3a8c', 0.32, 0.2], wheel: ['#4a4846', 0.45, 0.9], cream: ['#e6e1d3', 0.4, 0.05], darkroof: ['#3d4045', 0.7, 0.4],
};
const LIVERIES = {
  // base, rough, metal, bands [[y0,y1,color,rough,metal]]
  m30k: ['#c6cacf', 0.3, 0.85, [[-0.75, -0.42, '#3a3d42', 0.6, 0.4], [0.78, 0.93, '#E5171F', 0.35, 0.2], [1.98, 2.06, '#E5171F', 0.35, 0.2], [2.38, 3.0, '#9a9ea4', 0.5, 0.6]]],
  s25: ['#c3c7cc', 0.32, 0.85, [[-0.75, -0.42, '#3a3d42', 0.6, 0.4], [0.80, 0.94, '#E44D93', 0.35, 0.2], [2.38, 3.0, '#9a9ea4', 0.5, 0.6]]],
  rapit: ['#1d3a8c', 0.26, 0.5, [[-0.75, -0.35, '#14295f', 0.4, 0.4], [0.62, 0.68, '#5b7fd6', 0.3, 0.5], [2.45, 3.0, '#1a3070', 0.35, 0.45]]],
  comm: ['#c2c6cb', 0.32, 0.85, [[-0.75, -0.42, '#3a3d42', 0.6, 0.4], [0.70, 0.79, '#F08300', 0.35, 0.2], [0.79, 0.93, '#174a9c', 0.35, 0.2], [2.38, 3.0, '#9a9ea4', 0.5, 0.6]]],
  south: ['#dfe1e3', 0.35, 0.35, [[-0.75, -0.42, '#3a3d42', 0.6, 0.4], [0.62, 0.72, '#F08300', 0.35, 0.2], [0.72, 0.92, '#0f3a8c', 0.35, 0.2], [2.02, 2.08, '#F08300', 0.35, 0.2], [2.38, 3.0, '#a7abb0', 0.45, 0.5]]],
  door_steel: ['#c9cdd2', 0.28, 0.9, []],
  rapit_door: ['#1d3a8c', 0.26, 0.5, [[0.62, 0.68, '#5b7fd6', 0.3, 0.5]]],
  south_door: ['#dfe1e3', 0.35, 0.35, [[0.62, 0.72, '#F08300', 0.35, 0.2], [0.72, 0.92, '#0f3a8c', 0.35, 0.2]]],
};
export const liv = (col, y) => [(col + 0.5) / 32, Math.min(0.998, Math.max(0.002, (y - LIV_Y0) / (LIV_Y1 - LIV_Y0)))];
export const swUV = (name) => [(SW[name] + 0.5) / 32, 0.5];

export function buildCarAtlas() {
  const W = 256, H = 256;
  const c = canvas(W, H), g = c.getContext('2d');
  const r = canvas(W, H), gr = r.getContext('2d');
  const yPx = (y) => H - ((y - LIV_Y0) / (LIV_Y1 - LIV_Y0)) * H; // canvas y for body height y
  const rm = (rough, metal) => `rgb(0,${Math.round(rough * 255)},${Math.round(metal * 255)})`;
  for (const [name, [base, ro, me, bands]] of Object.entries(LIVERIES)) {
    const x = LIV[name] * 8;
    g.fillStyle = base; g.fillRect(x, 0, 8, H);
    gr.fillStyle = rm(ro, me); gr.fillRect(x, 0, 8, H);
    for (const [y0, y1, col, bro, bme] of bands) {
      const p0 = yPx(y1), p1 = yPx(y0);
      g.fillStyle = col; g.fillRect(x, p0, 8, p1 - p0);
      gr.fillStyle = rm(bro, bme); gr.fillRect(x, p0, 8, p1 - p0);
    }
  }
  for (const [name, [col, ro, me]] of Object.entries(SWC)) {
    const x = SW[name] * 8;
    g.fillStyle = col; g.fillRect(x, 0, 8, H);
    gr.fillStyle = rm(ro, me); gr.fillRect(x, 0, 8, H);
  }
  const color = canvasTex(c, { mips: false });
  const rough = canvasTex(r, { srgb: false, mips: false });
  return { color, rough };
}

// ---------------------------------------------------------------------------------
// INTERIOR ATLAS 1024x1024: swatches (32 px cells, rows 0..1), adverts
// (4 x 6 cells of 256x128 from y=64), route strips at y=832 and y=960.
// ---------------------------------------------------------------------------------
export const ISW = {
  floor_m: 0, floor_nk: 1, wall: 2, wall_grey: 3, ceiling: 4, seat_m: 5, seat_s: 6, seat_nk: 7, seat_prio: 8, seat_rapit: 9,
  seat_south: 10, headrest: 11, pole: 12, strap: 13, strap_prio: 14, black: 15, door_in: 16, wood: 17, lcd: 18, mred: 19,
  spink: 20, nkorange: 21, nkblue: 22, carpet_rapit: 23, wall_rapit: 24, luggage: 25, dark: 26, seat_frame: 27, floor_rapit: 28, white: 29,
};
const ISWC = {
  floor_m: '#5f6670', floor_nk: '#7a7064', wall: '#e8e4da', wall_grey: '#d5d8dc', ceiling: '#f3f2ee', seat_m: '#b3262f', seat_s: '#c2457e',
  seat_nk: '#2f57a8', seat_prio: '#6d5aa8', seat_rapit: '#29357a', seat_south: '#3b4775', headrest: '#efefe9', pole: '#d7dadd',
  strap: '#f2f2f0', strap_prio: '#f6cf00', black: '#111214', door_in: '#c5c8cc', wood: '#a88560', lcd: '#0b1420', mred: '#E5171F',
  spink: '#E44D93', nkorange: '#F08300', nkblue: '#174a9c', carpet_rapit: '#3b3f63', wall_rapit: '#ddd6c6', luggage: '#9ea3a8',
  dark: '#2a2b2e', seat_frame: '#8c9096', floor_rapit: '#4a4c66', white: '#fafafa',
};
export const iswUV = (name) => { const i = ISW[name]; return [((i % 32) * 32 + 16) / 1024, 1 - (Math.floor(i / 32) * 32 + 16) / 1024]; };
// UV rect of advert k (0..23): [u0, v0, u1, v1]
export const adRect = (k) => { k = k % 24; const cx = k % 4, cy = Math.floor(k / 4); const x0 = cx * 256 + 4, y0 = 64 + cy * 128 + 4; return [x0 / 1024, 1 - (y0 + 120) / 1024, (x0 + 248) / 1024, 1 - y0 / 1024]; };
export const stripRect = (which) => which === 'metro' ? [0, 1 - 960 / 1024, 1, 1 - 832 / 1024] : [0, 0, 1, 1 - 960 / 1024];

const ADS = [
  ['#ffd400', '#111', '夏の北海道フェア', '高島屋 8F 催会場', 'HOKKAIDO FAIR'],
  ['#0a6cff', '#fff', '英会話は、駅前で。', 'まずは無料体験レッスン', 'ENGLISH NOW'],
  ['#ff4f7a', '#fff', '脱毛するなら今！', '初回 ¥980', 'BEAUTY CLINIC'],
  ['#0d1b2a', '#ffcf3a', '転職、はじめよう。', 'あなたの次のキャリアへ', 'CAREER UP'],
  ['#2bb673', '#fff', '天然水 いろはす', 'すっきり、おいしい。', 'MINERAL WATER'],
  ['#ffffff', '#e60012', '大阪のうまいもん', 'たこ焼 お好み焼 串カツ', 'OSAKA GOURMET'],
  ['#5b2c83', '#fff', '劇場版 夜明けの街', '9.12 全国ロードショー', 'NOW SHOWING'],
  ['#f08300', '#fff', '南海で行く 高野山', '世界遺産へ、ひとっ走り。', 'KOYASAN'],
  ['#1e88e5', '#fff', 'ICOCAでピッ', 'チャージは券売機で', 'ICOCA'],
  ['#ffeb3b', '#d32f2f', '関西最大級セール', 'なんばCITY 全館', 'BIG SALE'],
  ['#263238', '#80deea', '新型スマホ 登場', '驚きのカメラ性能', 'SMARTPHONE'],
  ['#fce4ec', '#c2185b', 'ふるさと納税', 'ポイント還元中', 'FURUSATO'],
  ['#004d40', '#fff', '大人の休日 京都', '紅葉の季節に', 'KYOTO AUTUMN'],
  ['#ff7043', '#fff', '肉の日 毎月29日', 'ステーキ食べ放題', 'STEAK DAY'],
  ['#e3f2fd', '#0d47a1', '歯のクリニック', '平日夜8時まで診療', 'DENTAL'],
  ['#fff8e1', '#4e342e', '551 の豚まん?', 'いや、うちの肉まん', 'NIKUMAN'],
  ['#311b92', '#ffd740', '宝くじ ジャンボ', '1等・前後賞 7億円', 'LOTTERY'],
  ['#c62828', '#fff', '関西のおいしい牛乳', '毎朝、たっぷり。', 'MILK'],
  ['#00897b', '#fff', '大学 オープンキャンパス', '8/24(土)・25(日)', 'OPEN CAMPUS'],
  ['#212121', '#ff5252', 'ライブツアー 2026', '大阪城ホール', 'LIVE TOUR'],
  ['#f9a825', '#212121', 'マナーを守って', '優先席付近では…', 'MANNERS'],
  ['#1565c0', '#fff', 'Osaka Metro アプリ', '運行情報をリアルタイムで', 'APP'],
  ['#fafafa', '#e5171f', 'エンジョイエコカード', '1日乗り放題 820円', '1-DAY PASS'],
  ['#6a1b9a', '#fff', '温泉で、ととのう。', 'スパワールド', 'SPA'],
];

const METRO_STOPS = ['千里中央', '桃山台', '緑地公園', '江坂', '東三国', '新大阪', '西中島南方', '中津', '梅田', '淀屋橋', '本町', '心斎橋', 'なんば', '大国町', '動物園前', '天王寺', '昭和町', '西田辺', '長居', 'あびこ', '北花田', '新金岡', 'なかもず'];
const NANKAI_STOPS = ['なんば', '新今宮', '天下茶屋', '堺', '岸和田', '泉佐野', 'りんくうタウン', '関西空港'];

export function buildInteriorAtlas() {
  const c = canvas(1024, 1024), g = c.getContext('2d');
  g.fillStyle = '#888'; g.fillRect(0, 0, 1024, 1024);
  for (const [name, col] of Object.entries(ISWC)) {
    const i = ISW[name]; g.fillStyle = col; g.fillRect((i % 32) * 32, Math.floor(i / 32) * 32, 32, 32);
  }
  // seat fabric texture noise on seat swatches (subtle)
  ADS.forEach((a, k) => {
    const cx = k % 4, cy = Math.floor(k / 4);
    const x = cx * 256, y = 64 + cy * 128;
    g.fillStyle = '#ddd'; g.fillRect(x, y, 256, 128);
    g.fillStyle = a[0]; g.fillRect(x + 4, y + 4, 248, 120);
    g.fillStyle = a[1];
    g.font = `900 30px ${JP}`; fitText(g, a[2], x + 16, y + 48, 224);
    g.font = `500 17px ${JP}`; fitText(g, a[3], x + 16, y + 78, 224);
    g.globalAlpha = 0.85; g.font = `700 13px ${EN}`; fitText(g, a[4], x + 16, y + 108, 150); g.globalAlpha = 1;
    // a picture block
    g.fillStyle = a[1]; g.globalAlpha = 0.18; g.fillRect(x + 176, y + 88, 66, 30); g.globalAlpha = 1;
  });
  // metro route strip (above doors)
  const strip = (y0, h, stops, color, here) => {
    g.fillStyle = '#f7f7f5'; g.fillRect(0, y0, 1024, h);
    const ly = y0 + h * 0.55;
    g.fillStyle = color; g.fillRect(24, ly - 5, 976, 10);
    const n = stops.length;
    stops.forEach((s, i) => {
      const x = 32 + (i / (n - 1)) * 960;
      g.beginPath(); g.arc(x, ly, s === here ? 9 : 6, 0, Math.PI * 2);
      g.fillStyle = s === here ? '#111' : '#fff'; g.fill(); g.lineWidth = 3; g.strokeStyle = color; g.stroke();
      g.save(); g.translate(x + 4, ly - 13); g.rotate(-Math.PI / 2.6);
      g.fillStyle = '#222'; g.font = `700 ${h > 100 ? 15 : 11}px ${JP}`; g.fillText(s, 0, 0); g.restore();
    });
  };
  strip(832, 128, METRO_STOPS, '#E5171F', 'なんば');
  strip(960, 64, NANKAI_STOPS, '#F08300', 'なんば');
  return canvasTex(c, { aniso: 8 });
}

// ---------------------------------------------------------------------------------
// EMISSIVE ATLAS 1024x4096: line 0 = swatches (32px cells) + small icons;
// lines 1..31 = destination LED panels, JA at x 0..511, EN at x 512..1023.
// ---------------------------------------------------------------------------------
export const ESW = { white: 0, warm: 1, red: 2, amber: 3, blue: 4, green: 5, cool: 6, lcd: 7, head: 8, redtail: 9, icblue: 10, dim: 11, orange: 12, pink: 13, mred: 14 };
const ESWC = { white: '#ffffff', warm: '#ffe7c4', red: '#ff2020', amber: '#ffb24a', blue: '#3aa0ff', green: '#2bff7a', cool: '#e8f4ff', lcd: '#9ad4ff', head: '#fffbe8', redtail: '#ff1a10', icblue: '#38a8ff', dim: '#303438', orange: '#ff9020', pink: '#ff5aa8', mred: '#ff2a30' };
export const eswUV = (name) => { const i = ESW[name]; return [(i * 32 + 16) / 1024, 1 - 16 / 4096]; };
export const ROW_H = 128 / 4096;
// UV rect of the LED cell for destination slot 0 (JA column). The shader shifts by slot/lang.
export const LED_BASE = [0, 1 - 256 / 4096, 0.5, 1 - 128 / 4096];
// small icons at line 0: arrow (green) at x=512, no-entry at 576, IC at 640, LCD next-station at 704..1024 (320x128)
export const ICON = {
  arrow: [512 / 1024, 1 - 64 / 4096, 576 / 1024, 1],
  noentry: [576 / 1024, 1 - 64 / 4096, 640 / 1024, 1],
  ic: [640 / 1024, 1 - 64 / 4096, 704 / 1024, 1],
  lcd: [704 / 1024, 1 - 128 / 4096, 1, 1],
  lcd_nk: [512 / 1024, 1 - 128 / 4096, 704 / 1024, 1 - 64 / 4096],
};

// Destination slot registry: line/type/dest -> slot (1-based line in the atlas).
export class DestSlots {
  constructor() { this.map = new Map(); this.list = []; }
  slot(line, type, dest) {
    const k = `${line}|${type}|${dest}`;
    let s = this.map.get(k);
    if (s == null) { s = this.list.length; this.list.push({ line, type, dest }); this.map.set(k, s); }
    return s;
  }
}

function ledDots(g, x, y, w, h, pitch) {
  // darken between LED dots to give the dot-matrix look
  g.save();
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = 'rgba(30,30,30,1)';
  for (let yy = y; yy < y + h; yy += pitch) g.fillRect(x, yy + pitch - 1, w, 1);
  for (let xx = x; xx < x + w; xx += pitch) g.fillRect(xx + pitch - 1, y, 1, h);
  g.restore();
}

export function buildEmissiveAtlas(slots) {
  const c = canvas(1024, 4096), g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 1024, 4096);
  for (const [name, col] of Object.entries(ESWC)) { g.fillStyle = col; g.fillRect(ESW[name] * 32, 0, 32, 32); }
  // icons
  const ix = 512;
  g.fillStyle = '#04140a'; g.fillRect(ix, 0, 64, 64);
  g.fillStyle = '#2bff7a'; g.beginPath(); g.moveTo(ix + 14, 26); g.lineTo(ix + 36, 26); g.lineTo(ix + 36, 14); g.lineTo(ix + 56, 32); g.lineTo(ix + 36, 50); g.lineTo(ix + 36, 38); g.lineTo(ix + 14, 38); g.closePath(); g.fill();
  g.fillStyle = '#160404'; g.fillRect(ix + 64, 0, 64, 64);
  g.strokeStyle = '#ff2a2a'; g.lineWidth = 9; g.beginPath(); g.moveTo(ix + 80, 16); g.lineTo(ix + 112, 48); g.moveTo(ix + 112, 16); g.lineTo(ix + 80, 48); g.stroke();
  g.fillStyle = '#04223a'; g.fillRect(ix + 128, 0, 64, 64);
  g.strokeStyle = '#58c4ff'; g.lineWidth = 3; for (let k = 0; k < 3; k++) { g.beginPath(); g.arc(ix + 160, 34, 8 + k * 7, -Math.PI * 0.8, -Math.PI * 0.2); g.stroke(); }
  g.fillStyle = '#9fe0ff'; g.font = `700 13px ${EN}`; g.textAlign = 'center'; g.fillText('IC', ix + 160, 58); g.textAlign = 'left';
  // LCD next-station screens (metro, 320x128 at x=704; nankai 192x64 at 512,64)
  const lcd = (x, y, w, h, col, a, b, cEn) => {
    g.fillStyle = '#0a1622'; g.fillRect(x, y, w, h);
    g.fillStyle = col; g.fillRect(x, y, w, h * 0.22);
    g.fillStyle = '#fff'; g.font = `700 ${Math.round(h * 0.15)}px ${JP}`; g.fillText(a, x + 8, y + h * 0.17);
    g.font = `900 ${Math.round(h * 0.36)}px ${JP}`; g.fillText(b, x + 10, y + h * 0.68);
    g.font = `600 ${Math.round(h * 0.15)}px ${EN}`; g.fillStyle = '#bfe3ff'; g.fillText(cEn, x + 12, y + h * 0.9);
  };
  lcd(704, 0, 320, 128, '#E5171F', 'つぎは  Next', 'なんば', 'Namba  M20');
  lcd(512, 64, 192, 64, '#F08300', 'つぎは', '新今宮', 'Shin-Imamiya');
  // LED destination cells
  slots.list.forEach((d, s) => {
    const y = (s + 1) * 128;
    const line = LINES[d.line], ty = TYPES[d.type], de = DESTS[d.dest];
    for (const lang of [0, 1]) {
      const x = lang * 512;
      g.fillStyle = '#020202'; g.fillRect(x, y, 512, 128);
      if (line.operator === 'metro') {
        // line badge
        g.fillStyle = line.color; g.beginPath(); g.arc(x + 62, y + 64, 44, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#fff'; g.font = `800 60px ${EN}`; g.textAlign = 'center'; g.fillText(line.code, x + 62, y + 86); g.textAlign = 'left';
        g.fillStyle = '#ffffff';
        if (lang === 0) { g.font = `700 76px ${JP}`; fitText(g, de.ja, x + 128, y + 92, 370); }
        else { g.font = `700 62px ${EN}`; fitText(g, de.en, x + 128, y + 86, 370); }
      } else {
        // type box (coloured) + destination in orange/white
        g.fillStyle = ty.color; g.fillRect(x + 6, y + 10, 168, 108);
        g.fillStyle = (d.type === 'local' || d.type === 'kakutei') ? '#111' : '#fff';
        if (lang === 0) { g.font = `900 ${ty.short ? 58 : (ty.ja.length > 2 ? 40 : 62)}px ${JP}`; fitText(g, ty.short ? (ty.name || ty.short) : ty.ja, x + 90, y + 84, 156, 'center'); }
        else { g.font = `800 34px ${EN}`; fitText(g, ty.nameEn || ty.en, x + 90, y + 76, 158, 'center'); }
        g.fillStyle = '#ff9a2a';
        if (lang === 0) { g.font = `700 74px ${JP}`; fitText(g, de.ja, x + 190, y + 92, 310); }
        else { g.font = `700 54px ${EN}`; fitText(g, de.en, x + 190, y + 84, 310); }
      }
      ledDots(g, x, y, 512, 128, 6);
    }
  });
  const t = canvasTex(c, { aniso: 8 });
  return t;
}

// ---------------------------------------------------------------------------------
// FLOOR DECALS 1024x1024, 8x8 cells of 128 px (RGBA). Returns {tex, cell(name)}
// ---------------------------------------------------------------------------------
export function buildDecalAtlas() {
  const c = canvas(1024, 1024), g = c.getContext('2d');
  g.clearRect(0, 0, 1024, 1024);
  const cells = {};
  let n = 0;
  const cell = (name, draw) => { const cx = n % 8, cy = Math.floor(n / 8); n++; g.save(); g.translate(cx * 128, cy * 128); draw(g); g.restore(); cells[name] = [cx * 128 / 1024, 1 - (cy + 1) * 128 / 1024, (cx + 1) * 128 / 1024, 1 - cy * 128 / 1024]; };
  // Midosuji car/door markers 1..10 (red circle + 号車)
  const carMark = (col, k, sub) => (g) => {
    g.fillStyle = '#f4f4f2'; g.beginPath(); g.roundRect(6, 6, 116, 116, 14); g.fill();
    g.fillStyle = col; g.beginPath(); g.roundRect(10, 10, 108, 46, 10); g.fill();
    g.fillStyle = '#fff'; g.font = `800 40px ${EN}`; g.textAlign = 'center'; g.fillText(String(k), 40, 49);
    g.font = `700 22px ${JP}`; g.fillText('号車', 86, 44);
    g.fillStyle = '#222'; g.font = `700 20px ${JP}`; g.fillText(sub || '乗車位置', 64, 84);
    g.font = `600 15px ${EN}`; g.fillText(`Car ${k}`, 64, 106);
  };
  for (let k = 1; k <= 10; k++) cell('m' + k, carMark('#E5171F', k));
  for (let k = 1; k <= 4; k++) cell('s' + k, carMark('#E44D93', k));
  cell('women', (g) => {
    g.fillStyle = '#ff7eb6'; g.beginPath(); g.roundRect(6, 6, 116, 116, 14); g.fill();
    g.fillStyle = '#fff'; g.font = `800 22px ${JP}`; g.textAlign = 'center'; g.fillText('女性専用車', 64, 46);
    g.font = `600 14px ${EN}`; g.fillText('Women Only', 64, 70); g.fillText('平日 始発〜9:00', 64, 92);
  });
  // queue line arrow (white chevrons on a line)
  cell('queue', (g) => {
    g.fillStyle = 'rgba(255,255,255,0.95)'; g.fillRect(56, 0, 16, 128);
    g.beginPath(); g.moveTo(34, 50); g.lineTo(64, 18); g.lineTo(94, 50); g.lineTo(84, 58); g.lineTo(64, 36); g.lineTo(44, 58); g.closePath(); g.fill();
  });
  cell('queue_red', (g) => { g.fillStyle = '#e5171f'; g.fillRect(52, 0, 24, 128); });
  cell('queue_pink', (g) => { g.fillStyle = '#e44d93'; g.fillRect(52, 0, 24, 128); });
  cell('seiretsu', (g) => {
    g.fillStyle = '#fff'; g.font = `800 26px ${JP}`; g.textAlign = 'center';
    g.fillText('整列乗車', 64, 52); g.font = `600 16px ${EN}`; g.fillText('Please line up', 64, 80);
    g.beginPath(); g.moveTo(44, 96); g.lineTo(64, 120); g.lineTo(84, 96); g.fill();
  });
  // Nankai door position markers by type
  const nk = (name, col, a, b, fg = '#fff') => cell(name, (g) => {
    g.fillStyle = col; g.beginPath(); g.roundRect(4, 20, 120, 88, 10); g.fill();
    g.fillStyle = fg; g.textAlign = 'center'; g.font = `900 30px ${JP}`; fitText(g, a, 64, 62, 110, 'center');
    g.font = `700 18px ${EN}`; fitText(g, b, 64, 92, 110, 'center');
  });
  nk('nk_rapit', '#2f5ec8', 'ラピート', 'rapi:t');
  nk('nk_ltd', '#e60012', '特急', 'Ltd. Exp.');
  nk('nk_8', '#f08300', '8両', '8 cars');
  nk('nk_6', '#0068b7', '6両', '6 cars');
  nk('nk_4', '#2bb673', '4両', '4 cars');
  nk('nk_door', '#ffffff', '乗車口', 'Boarding', '#f08300');
  // car-stop target signs (停止位置目標) — numbers on a white/black plate
  for (const k of [2, 4, 6, 8]) cell('stop' + k, (g) => {
    g.fillStyle = '#111'; g.fillRect(14, 6, 100, 116); g.fillStyle = '#fff'; g.fillRect(20, 12, 88, 104);
    g.fillStyle = '#111'; g.font = `900 78px ${EN}`; g.textAlign = 'center'; g.fillText(String(k), 64, 92);
  });
  // "Mind the gap" edge marking
  cell('gap', (g) => {
    g.fillStyle = '#ffd400'; g.font = `800 24px ${JP}`; g.textAlign = 'center'; g.fillText('足元注意', 64, 50);
    g.font = `700 15px ${EN}`; g.fillText('Mind the gap', 64, 78);
  });
  const tex = canvasTex(c, { aniso: 8 });
  return { tex, cells };
}
