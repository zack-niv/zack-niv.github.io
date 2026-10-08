// =============================================================================
// Hand-built dressing: the quest businesses (directory FEATURED), the
// Takashimaya depachika (B1 food hall) and the 1F cosmetics hall.
// =============================================================================
import { Frame, Painter, NullPainter, ChunkBatches, rgb, mix, WHITE, protoUV } from './kit.js?v=6c67dba';
import * as D from './draw.js?v=6c67dba';
import { MENU } from './catalog.js?v=6c67dba';
import { foodItem, aFrame, chair, standingLedges, queuePoints, showcase, mannequin } from './shopbuild.js?v=6c67dba';
import { rng, hash } from '../../core/rng.js?v=6c67dba';
import { CELL } from '../world.js?v=6c67dba';
import { LEVELS, spaceById } from '../layout.js?v=6c67dba';

const K = (h, k = 1) => rgb(h, k);
const fmt = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// ----------------------------------------------------------------------------
// featured shop extras (run after the generic template)
// ----------------------------------------------------------------------------
export const FEATURED_STYLE = {
  coffee_great: { bg: '#e9e2d0', fg: '#22301e', accent: '#5a7a3a', mode: 'lightbox', primary: 'ja', serif: true },
  coffee_chain: { bg: '#1f4d3a', fg: '#ffffff', accent: '#e8c27a', mode: 'lightbox', primary: 'en', serif: false },
  coffee_kissa: { bg: '#3a1408', fg: '#ffd27a', accent: '#c0392b', mode: 'letters', primary: 'ja', serif: true },
  tempura_great: { bg: '#f4efe2', fg: '#1a1a1a', accent: '#8a1c1c', mode: 'wood', primary: 'ja', serif: true, emblem: '天' },
  tempura_tendon: { bg: '#f39800', fg: '#ffffff', accent: '#c8102e', mode: 'lightbox', primary: 'ja', serif: false, emblem: '天' },
  tempura_closed: { bg: '#2a1a10', fg: '#ffcc66', accent: '#c8102e', mode: 'letters', primary: 'ja', serif: true, emblem: '狐' },
};

export const FEATURED_BUILD = {
  // Wakakusa Coffee Stand — tiny standing bar, wood, pour-over, hand-written menu
  coffee_great(S) {
    const P = S.inner, F = S.front, W = S.W, R = S.R;
    const wood = [0.78, 0.6, 0.4], dark = [0.35, 0.22, 0.12];
    // wooden lattice (koshi) at the sides of the opening
    for (const [a0, a1] of [[0.05, 0.9], [W - 0.9, W - 0.05]]) {
      for (let a = a0; a < a1; a += 0.09) F.box('env_wood', a, a + 0.035, 0, S.doorTop, -0.04, 0.02, dark);
      F.box('env_wood', a0, a1, S.doorTop - 0.06, S.doorTop, -0.05, 0.03, dark);
    }
    // the bar counter: drippers, kettles, grinder, scale, cups
    const cd = Math.min(3.3, S.D - 3);
    const y = 1.1;
    for (let k = 0; k < 4; k++) {
      const a = 1.3 + k * (W - 2.6) / 3;
      P.box('env_wood', a - 0.12, a + 0.12, y, y + 0.22, cd + 0.2, cd + 0.4, dark);               // dripper stand
      P.geo('env_gloss', 'bowl', a, y + 0.22, cd + 0.3, 0, [0.07, -0.09, 0.07], [0.96, 0.95, 0.92]); // cone
      P.cyl('env_glass_case', a, y, y + 0.14, cd + 0.3, 0.05, WHITE);                              // server
      P.cyl('env_gloss', a, y, y + 0.06, cd + 0.3, 0.045, [0.25, 0.12, 0.05]);                      // coffee
      P.cyl('env_metal', a + 0.22, y, y + 0.18, cd + 0.2, 0.06, [0.85, 0.85, 0.87]);                // kettle
      P.box('env_metal', a + 0.2, a + 0.24, y + 0.12, y + 0.14, cd + 0.03, cd + 0.2, [0.85, 0.85, 0.87]); // spout
    }
    P.box('env_matte', W - 1.3, W - 1.05, y, y + 0.35, cd + 0.35, cd + 0.55, [0.12, 0.12, 0.12]);   // grinder
    P.geo('env_glass_case', 'sphere', W - 1.18, y + 0.42, cd + 0.45, 0, 0.09, WHITE);
    for (let a = 1.0; a < W - 1.0; a += 0.45) P.cyl('env_gloss', a, y, y + 0.09, cd - 0.02, 0.04, [0.95, 0.93, 0.88]);
    // back wall: shelves of coffee bags & jars, hand-written menu, small lit sign
    const back = Math.min(S.D, cd + 2.4) - 0.02;
    for (let k = 0; k < 3; k++) {
      P.box('env_wood', 0.6, W - 0.6, 1.25 + k * 0.4, 1.28 + k * 0.4, back - 0.3, back, wood);
      for (let a = 0.7; a < W - 0.7; a += 0.17) {
        if ((a * 10 | 0) % 3 === 0) P.cyl('env_glass_case', a + 0.07, 1.28 + k * 0.4, 1.5 + k * 0.4, back - 0.15, 0.06, WHITE), P.cyl('env_matte', a + 0.07, 1.28 + k * 0.4, 1.42 + k * 0.4, back - 0.15, 0.055, [0.32, 0.18, 0.08]);
        else P.box('env_matte', a, a + 0.13, 1.28 + k * 0.4, 1.28 + k * 0.4 + 0.22, back - 0.25, back - 0.1, [[0.85, 0.78, 0.65], [0.3, 0.45, 0.3], [0.7, 0.35, 0.25], [0.2, 0.2, 0.2]][(k + Math.floor(a * 7)) % 4]);
      }
    }
    const menu = R.chalk('若草珈琲 MENU', [['エチオピア 浅煎り', '¥600'], ['ケニア 中煎り', '¥600'], ['グアテマラ', '¥550'], ['本日のブレンド', '¥480'], ['カフェラテ', '¥560'], ['豆 200g 〜', '¥1,600']], 7);
    P.tq(menu, W / 2 - 0.5, W / 2 + 0.5, 0.25, 1.15, back - 0.01, -1);
    const neon = R.litLabel('COFFEE', '#1a1208', '#ffd27a', 192, 64);
    P.tq(neon, W / 2 - 0.45, W / 2 + 0.45, 2.45, 2.75, back - 0.01, -1);
    // pendant lamps over the bar
    for (let k = 0; k < 3; k++) {
      const a = 1.5 + k * (W - 3) / 2;
      P.box('env_metal', a - 0.004, a + 0.004, 2.0, S.ceil, cd + 0.3, cd + 0.308, [0.1, 0.1, 0.1]);
      P.geo('env_gloss', 'bowl', a, 1.98, cd + 0.3, 0, [0.16, -0.12, 0.16], [0.12, 0.25, 0.15]);
      P.qh('env_glow', a - 0.07, a + 0.07, cd + 0.23, cd + 0.37, 1.965, false, [2.5, 2.0, 1.4]);
    }
    S.light(W / 2, 2.0, cd, [1, 0.78, 0.55], 0.8, 4, 'lamp');
    // a small high table near the front
    if (S.solid(W / 2 + 1.2, W / 2 + 1.7, 1.2, 1.7)) {
      P.cyl('env_metal', W / 2 + 1.45, 0, 1.05, 1.45, 0.03, [0.15, 0.15, 0.15]);
      P.cyl('env_wood', W / 2 + 1.45, 1.05, 1.09, 1.45, 0.28, wood);
      S.spot('seat', W / 2 + 1.45, 0.95, 0, 1);
    }
    // chalk A-frame + plant outside
    const am = R.chalk('本日の豆', [['Ethiopia Guji', '¥600'], ['Kenya Nyeri', '¥600'], ['House blend', '¥480'], ['Iced drip', '¥550']], 11);
    if (S.outside(0.6, 1.25, -1.0, -0.6, 2.5)) aFrame(F, am, 0.92, -0.8);
    if (S.outside(W - 0.75, W - 0.25, -0.75, -0.25, 2.5)) { F.cyl('env_matte', W - 0.5, 0, 0.45, -0.5, 0.2, [0.85, 0.82, 0.76]); F.geo('env_matte', 'tallplant', W - 0.5, 0.35, -0.5, 0.7, 0.85, [0.2, 0.42, 0.18]); }
    // queue along the front (locals before work)
    S.queue.length = 0; S.spots = S.spots.filter(s => s.kind !== 'queue');
    queuePoints(S, 1.4, 2.6, 6);
  },

  // Café Mocca Rest — generic chain café
  coffee_chain(S) {
    const P = S.inner, R = S.R, W = S.W;
    const logo = R.litLabel('MOCCA REST  since 1999', '#1f4d3a', '#ffffff', 384, 64);
    P.tq(logo, W / 2 - 1.2, W / 2 + 1.2, 2.2, 2.6, (S.backD || (S.D > 16 ? 15 : S.D)) - 0.05, -1);
    const ban = R.banner(['AUTUMN', 'マロンラテ 新登場 ¥580'], '#7a4a1e', '#ffffff');
    if (S.outside(0.4, 1.0, -0.9, -0.5, 2.5)) { S.front.box('env_metal', 0.68, 0.72, 0, 1.6, -0.72, -0.68, [0.3, 0.3, 0.3]); S.front.tq(ban, 0.3, 1.1, 1.3, 1.6, -0.73, -1); }
  },

  // Kissa Rondo — Showa kissaten
  coffee_kissa(S) {
    const F = S.front, P = S.inner, R = S.R, W = S.W;
    // retro vertical lit "COFFEE" sign on the pilaster + stained glass transom
    const cs = R.litLabel('COFFEE', '#7a0f12', '#ffe6b0', 192, 56);
    F.box('env_matte', W - 0.55, W - 0.35, S.doorTop - 1.4, S.doorTop + 0.2, -0.3, -0.05, [0.3, 0.06, 0.06]);
    F.ta(cs, -0.29, -0.06, S.doorTop - 1.35, S.doorTop + 0.15, W - 0.551, -1);
    F.ta(cs, -0.29, -0.06, S.doorTop - 1.35, S.doorTop + 0.15, W - 0.349, 1);
    const cols = [[1.6, 0.4, 0.2], [0.3, 0.7, 1.5], [1.5, 1.2, 0.3], [0.4, 1.3, 0.5], [1.4, 0.4, 1.0]];
    if (S.doorCells) for (let a = S.doorA0 + 0.05, k = 0; a < S.doorA1 - 0.3; a += 0.3, k++) F.qd('env_glow', a, a + 0.27, S.doorTop - 0.42, S.doorTop - 0.1, 0.47, -1, cols[k % cols.length]);
    // smoking room at the back: glass partition + sign
    const sd = S.D > 16 ? 12 : S.D - 3;
    const sr = R.label('喫煙室 SMOKING ROOM', '#222', '#ffcc66', 320, 48);
    P.qd('env_glass', 0.5, W - 0.5, 0, 2.4, sd, -1, WHITE);
    P.box('env_wood', 0.5, W - 0.5, 2.4, 2.5, sd - 0.03, sd + 0.03, [0.28, 0.16, 0.09]);
    P.tq(sr, W / 2 - 0.6, W / 2 + 0.6, 2.05, 2.23, sd - 0.01, -1);
    // vinyl records and a pink phone on the counter end
    P.box('env_gloss', W - 1.4, W - 1.15, 1.05, 1.17, S.D - 2.6, S.D - 2.4, [1, 0.45, 0.6]);
  },

  // Tempura Daikichi — refined counter tempura, long lunchtime queue
  tempura_great(S) {
    const F = S.front, R = S.R, W = S.W;
    // wooden koshi lattice over the glass + white andon at the door
    const [dA0, dA1] = S.doorCells || [S.doorA0, S.doorA1];
    for (const [a0, a1] of [[S.doorA0, dA0], [dA1, S.doorA1]]) for (let a = a0 + 0.04; a < a1 - 0.04; a += 0.13) F.box('env_wood', a, a + 0.028, 0.1, S.doorTop - 0.06, 0.4, 0.44, [0.85, 0.74, 0.56]);
    const menu = R.photoMenu('昼の天ぷら定食', [['天ぷら定食 竹', '¥1,980'], ['天ぷら定食 松', '¥2,800'], ['海老天丼', '¥1,650'], ['おまかせコース', '¥4,800']], ['tempura', 'tempura', 'tendon', 'tempura'], '#2b2b2b');
    // waiting chairs along the corridor: a proper lunchtime queue
    S.queue.length = 0; S.spots = S.spots.filter(s => s.kind !== 'queue');
    const dir = dA0 > W / 2 ? -1 : 1;
    let a = dir > 0 ? dA1 + 0.45 : dA0 - 0.45;
    S.spot('queue', (dA0 + dA1) / 2, -0.7, 0, 1);
    let chairs = 0;
    for (let k = 0; k < 14; k++) {
      if (a < 0.4 || a > W - 0.4) break;
      if (chairs < 7 && S.outside(a - 0.25, a + 0.25, -0.55, -0.1, 2.2)) { chairFolding(F, a, -0.32, Math.PI); chairs++; S.spot('queue', a, -0.4, 0, -1); }
      else S.spot('queue', a, -0.75, -dir, 0);
      a += dir * 0.62;
    }
    // overflow continues along the corridor beyond the frontage
    for (let k = 0; k < 6; k++) S.spot('queue', dir > 0 ? W + 0.5 + k * 0.65 : -0.5 - k * 0.65, -0.75, -dir, 0);
    // menu stand + stanchions
    if (S.outside(dA0 - 0.3 * dir - 0.25, dA0 - 0.3 * dir + 0.25, -1.1, -0.8, 2.2)) aFrame(F, menu, dir > 0 ? dA0 - 0.35 : dA1 + 0.35, -0.95);
    const sign = R.label('最後尾 END OF LINE', '#ffffff', '#8a1c1c', 256, 48);
    const ea = Math.min(W - 0.3, Math.max(0.3, a));
    F.cyl('env_metal', ea, 0, 1.0, -0.95, 0.025, [0.75, 0.6, 0.3]);
    F.tq(sign, ea - 0.25, ea + 0.25, 1.0, 1.1, -0.98, -1);
  },

  // Tendon Tenmaru — fast chain with ticket machine
  tempura_tendon(S) {
    const P = S.inner, R = S.R, W = S.W;
    const ban = R.banner(['天丼 ¥690', 'サクッと!揚げたて天丼'], '#f39800', '#ffffff');
    P.tq(ban, 0.4, Math.min(W - 0.4, 3.2), S.doorTop - 0.62, S.doorTop - 0.05, 0.62, -1);
  },

  // Tempura Sakaba Kitsune — closed until 17:00
  tempura_closed(S) {
    const F = S.front, R = S.R, W = S.W;
    const hr = R.hours(S.b, fmt);
    const pa = S.doorA0 > 0 ? S.doorA0 / 2 : 0.4;
    F.box('env_wood', pa - 0.3, pa + 0.3, 1.05, 1.75, -0.08, -0.05, [0.3, 0.2, 0.12]);
    F.tq(hr, pa - 0.27, pa + 0.27, 1.08, 1.72, -0.082, -1);
    const am = R.chalk('本日も17時から!', [['串天 盛り合わせ', '¥980'], ['ハイボール', '¥290'], ['海老天', '¥250'], ['ちくわ天', '¥150'], ['OPEN 17:00', '']], 13);
    if (S.outside(W / 2 - 0.35, W / 2 + 0.35, -1.0, -0.6, 2.5)) aFrame(F, am, W / 2, -0.8);
    const kp = R.label('準備中', '#2a1a10', '#ffcc66', 160, 64);
    F.tq(kp, W / 2 - 0.3, W / 2 + 0.3, 1.5, 1.74, -0.07, -1);
  },
};

function chairFolding(P, a, d, rot) { chair(P, a, d, rot, [0.25, 0.25, 0.27], [0.55, 0.12, 0.1]); }

// ----------------------------------------------------------------------------
// hall helpers (depachika, Takashimaya 1F): world-frame painter + grid checks
// ----------------------------------------------------------------------------
export class Hall {
  constructor(env, spaceId) {
    this.env = env; this.id = spaceId; this.sp = spaceById[spaceId]; this.level = this.sp && this.sp.level;
    this.y = this.sp ? LEVELS[this.level].y : 0;
    this.f = new Frame(0, this.y, 0, 0);
    this.spots = [];
    this.log = []; this.replay = false; this.ri = 0;
    this.nullP = new NullPainter(this.f);
  }
  // logic pass draws nothing; begin() replays with real painters into chunk batches
  begin() { this.replay = true; this.ri = 0; this.batches = new ChunkBatches(32, 'hall:' + this.id); }
  end() { this.replay = false; const g = this.batches.build(this.env.ctx); this.batches = null; return g; }
  painter(x, z) { return this.replay ? new Painter(this.batches.get(this.level, x, z), this.f) : this.nullP; }
  // all cells walkable, in this space, unblocked (with margin)
  // allowCols: structural columns may sit inside the footprint (counters wrap around them)
  clear(x0, z0, x1, z1, m = 0, allowCols = false) {
    if (this.replay) return this.log[this.ri++];
    const v = this._clear(x0, z0, x1, z1, m, allowCols); this.log.push(v); return v;
  }
  _inCol(x, z) {
    const A = this.env.ctx.architecture;
    if (!this._cols) this._cols = ((A && A.columns) || []).filter(c => c.level === this.level);
    for (const c of this._cols) if (Math.abs(x - c.x) < c.hx + 0.75 && Math.abs(z - c.z) < c.hz + 0.75) return true;
    return false;
  }
  _clear(x0, z0, x1, z1, m, allowCols) {
    const g = this.env.world.grids[this.level];
    for (let z = Math.floor(z0 - m); z < Math.ceil(z1 + m); z++) for (let x = Math.floor(x0 - m); x < Math.ceil(x1 + m); x++) {
      const i = g.cellOf(x + 0.5, z + 0.5);
      if (i < 0 || g.type[i] !== CELL.WALK || (g.blocked[i] && !(allowCols && this._inCol(x + 0.5, z + 0.5)))) return false;
      const s = this.env.world.layout.spaces[g.space[i]];
      if (s !== this.sp) return false;
    }
    return true;
  }
  box(x0, z0, x1, z1) { if (!this.replay) this.env.world.addBox(this.level, (x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) / 2 - 0.01, (z1 - z0) / 2 - 0.01, 0); }
  spot(kind, x, z, fx, fz, extra) { if (this.replay) return null; const s = { x, z, level: this.level, yaw: Math.atan2(-fx, -fz), kind, ...extra }; this.spots.push(s); return s; }
  light(x, y, z, color, intensity, range, kind) { if (!this.replay) this.env.lights.push({ level: this.level, x, y: this.y + y, z, color, intensity, range, kind }); }
}

// ----------------------------------------------------------------------------
// Takashimaya B1 depachika
// ----------------------------------------------------------------------------
const VENDORS = [
  { k: 'wagashi', ja: '御菓子司 桜月', en: 'Sakuratsuki', col: '#6b2737', foods: ['wagashi'] },
  { k: 'wagashi', ja: '和菓子 京華堂', en: 'Kyōka-dō', col: '#2d4a3a', foods: ['wagashi'] },
  { k: 'wagashi', ja: '甘味処 一福', en: 'Ippuku', col: '#8a5a2a', foods: ['wagashi'] },
  { k: 'bento', ja: 'お弁当 花かご', en: 'Hanakago Bento', col: '#b03030', foods: ['bento'] },
  { k: 'bento', ja: '惣菜 なにわ厨', en: 'Naniwa Kuriya', col: '#3a3a3a', foods: ['bento', 'salad'] },
  { k: 'deli', ja: 'DELI KITCHEN AOBA', en: 'Western deli', col: '#2a6a3a', foods: ['salad', 'salad', 'katsu'] },
  { k: 'sushi', ja: '鮨 魚政', en: 'Uomasa Sushi', col: '#1d2b4a', foods: ['sushi'] },
  { k: 'sushi', ja: '柿の葉すし 吉野', en: 'Kakinoha Sushi', col: '#3a5a2a', foods: ['sushi', 'bento'] },
  { k: 'bakery', ja: 'Boulangerie LUNE', en: 'Bakery', col: '#7a4a1e', foods: ['bread'] },
  { k: 'cake', ja: 'Pâtisserie Étoile', en: 'Patisserie', col: '#c48a9a', foods: ['cake', 'cake'] },
  { k: 'cake', ja: 'BAUM HAUS', en: 'Baumkuchen', col: '#b88a3a', foods: ['bread', 'cake'] },
  { k: 'cake', ja: 'Chocolatier NOIR', en: 'Chocolate', col: '#2a1a12', foods: ['cake', 'wagashi'] },
  { k: 'fried', ja: '天ぷら惣菜 天佐', en: 'Tensa tempura', col: '#c87a1a', foods: ['tempura', 'tempura'] },
  { k: 'fried', ja: '焼鳥 鳥久', en: 'Torikyū yakitori', col: '#5a2a1a', foods: ['kushi', 'yakiniku'] },
  { k: 'chinese', ja: '中華惣菜 金龍', en: 'Kinryū', col: '#c8102e', foods: ['donburi', 'yakiniku'] },
  { k: 'tsuke', ja: '京漬物 よしだ', en: 'Kyoto pickles', col: '#4a6a2a', foods: ['salad', 'wagashi'] },
  { k: 'fruit', ja: 'フルーツ 果琳', en: 'Karin fruit', col: '#e07a2a', foods: ['parfait', 'salad'] },
  { k: 'tea', ja: '宇治茶 茶匠', en: 'Uji tea', col: '#2d5a3d', foods: ['wagashi'] },
  { k: 'senbei', ja: 'おかき 播磨屋', en: 'Rice crackers', col: '#8a6a3a', foods: ['bread', 'wagashi'] },
  { k: 'takoyaki', ja: '551 豚まん風 蓬莱軒', en: 'Pork buns', col: '#c8102e', foods: ['bread'] },
];

export function buildDepachika(env, R, H = new Hall(env, 'taka_b1')) {
  if (!H.sp) return H;
  const [X0, Z0, X1, Z1] = H.sp.rect;
  const r = rng(hash('depachika'));
  // main aisles: N-S at the north entry (x ≈ -16), E-W at z ≈ -165
  const mainX = [-20, -12], mainZ = [-169, -161];
  const iw = 8, ih = 4.8, gx = 2.6, gz = 2.7;
  let vi = 0;
  const P0 = H.painter(-30, -166);
  // floor: warm stone aisles + a lighter inlay under islands is done per island
  for (let z = Z0 + 3.2; z + ih <= Z1 - 3; z += ih + gz) {
    for (let x = X0 + 3.2; x + iw <= X1 - 3; x += iw + gx) {
      // keep the main aisles open
      if (x < mainX[1] && x + iw > mainX[0]) { x = mainX[1] + 1.2 - (iw + gx); continue; }   // resume right after the aisle
      if (z < mainZ[1] && z + ih > mainZ[0]) { z = mainZ[1] + 0.8 - (ih + gz); break; }
      if (!H.clear(x, z, x + iw, z + ih, 1, true)) continue;
      island(H, R, x, z, x + iw, z + ih, VENDORS[vi++ % VENDORS.length], r);
    }
  }
  // perimeter counters along the north, east and south walls
  wallCounters(H, R, r);
  // hanging banners over the main aisle (autumn fair)
  const P = H.painter(-16, -166);
  const ban = R.banner(['秋の味覚フェア', 'AUTUMN FOOD FAIR · B1 食料品'], '#7b2d0a', '#ffe9c0');
  for (let z = Z0 + 6; z < Z1 - 4; z += 6) {
    P.tq(ban, -18.5, -13.5, 2.0, 2.6, z, -1);
    P.qd(ban.atlas.mat(ban), -18.5, -13.5, 2.0, 2.6, z + 0.005, 1, WHITE, ban.atlas.uv(ban));
    P.box('env_metal', -18.4, -18.38, 2.6, 3.0, z - 0.01, z + 0.01, [0.6, 0.6, 0.6]);
    P.box('env_metal', -13.62, -13.6, 2.6, 3.0, z - 0.01, z + 0.01, [0.6, 0.6, 0.6]);
  }
  // entrance arch from NAMBAWALK
  const ent = R.litLabel('高島屋 食料品売場  FOOD HALL  B1', '#3a2a1a', '#f2d9a0', 512, 56);
  const PE = H.painter(-16, -200);
  PE.tq(ent, -19.6, -12.4, 2.35, 2.35 + 7.2 * 56 / 512, -200.05, -1);
  void P0;
  H.light(-16, 2.6, -166, [1, 0.85, 0.65], 1.0, 30, 'panel');
  return H;
}

function island(H, R, x0, z0, x1, z1, V, r) {
  const P = H.painter((x0 + x1) / 2, (z0 + z1) / 2);
  const col = K(V.col);
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  H.box(x0, z0, x1, z1);
  // floor inlay inside the ring
  P.qh('env_wood', x0 + 0.9, x1 - 0.9, z0 + 0.9, z1 - 0.9, 0.006, true, [0.75, 0.6, 0.45]);
  // showcase counters around the perimeter (0.85 deep), facing out
  const dep = 0.85;
  const sides = [
    { ax: [x0, x1], z: z0, n: [0, -1] }, { ax: [x0, x1], z: z1, n: [0, 1] },
    { az: [z0 + dep, z1 - dep], x: x0, n: [-1, 0] }, { az: [z0 + dep, z1 - dep], x: x1, n: [1, 0] },
  ];
  for (const s of sides) {
    if (s.ax) {
      const zf = s.z, zb = s.z - s.n[1] * dep;
      const zA = Math.min(zf, zb), zB = Math.max(zf, zb);
      P.box('env_gloss', s.ax[0], s.ax[1], 0, 0.82, zA, zB, mix(col, [1, 1, 1], 0.15));
      P.box('env_metal', s.ax[0], s.ax[1], 0.82, 0.86, zA, zB, [0.75, 0.72, 0.65]);
      // sloped glass + lit
      P.qd('env_glass_case', s.ax[0], s.ax[1], 0.86, 1.28, zf, s.n[1] < 0 ? -1 : 1, WHITE);
      P.qh('env_glass_case', s.ax[0], s.ax[1], zA, zB, 1.28, true, WHITE);
      P.qh('env_glow', s.ax[0] + 0.05, s.ax[1] - 0.05, zf - s.n[1] * 0.1 - 0.03, zf - s.n[1] * 0.1 + 0.03, 1.27, false, [2.2, 2.1, 1.9]);
      // food trays + price rail
      for (let x = s.ax[0] + 0.1; x < s.ax[1] - 0.5; x += 0.62) {
        const reg = R.food(V.foods[Math.floor(r() * V.foods.length)]);
        P.qh(reg.atlas.mat(reg), x, x + 0.55, zf - s.n[1] * 0.12 - 0.27, zf - s.n[1] * 0.12 + 0.27, 0.87, true, WHITE, reg.atlas.uv(reg));
        if (((x * 7) | 0) % 2 === 0) foodItem({ R }, P, V.foods[Math.floor(r() * V.foods.length)], x + 0.27, 0.875, zf - s.n[1] * 0.12, 0.17);   // a real plated item every other tray
      }
      const rr = R.rail(Math.floor(r() * 6));
      P.tq(rr, s.ax[0] + 0.05, s.ax[1] - 0.05, 0.86, 0.91, zf - (s.n[1] < 0 ? 0.002 : -0.002), s.n[1] < 0 ? -1 : 1);
      for (let x = s.ax[0] + 0.8; x < s.ax[1] - 0.4; x += 1.6) {
        H.spot('browse', x, zf + s.n[1] * 0.55, -s.n[0], -s.n[1]);
        H.spot('staff', x, zf - s.n[1] * 1.3, s.n[0], s.n[1], { outfit: { apron: V.col, cap: true } });
      }
      H.spot('counter', (s.ax[0] + s.ax[1]) / 2, zf + s.n[1] * 0.6, -s.n[0], -s.n[1], { vendor: V.ja });
    } else {
      const xf = s.x, xb = s.x - s.n[0] * dep;
      const xA = Math.min(xf, xb), xB = Math.max(xf, xb);
      P.box('env_gloss', xA, xB, 0, 0.82, s.az[0], s.az[1], mix(col, [1, 1, 1], 0.15));
      P.box('env_metal', xA, xB, 0.82, 0.86, s.az[0], s.az[1], [0.75, 0.72, 0.65]);
      P.qa('env_glass_case', s.az[0], s.az[1], 0.86, 1.28, xf, s.n[0], WHITE);
      P.qh('env_glass_case', xA, xB, s.az[0], s.az[1], 1.28, true, WHITE);
      for (let z = s.az[0] + 0.1; z < s.az[1] - 0.4; z += 0.62) {
        const reg = R.food(V.foods[Math.floor(r() * V.foods.length)]);
        P.qh(reg.atlas.mat(reg), xf - s.n[0] * 0.12 - 0.27, xf - s.n[0] * 0.12 + 0.27, z, z + 0.55, 0.87, true, WHITE, reg.atlas.uv(reg));
        if (((z * 7) | 0) % 2 === 0) foodItem({ R }, P, V.foods[Math.floor(r() * V.foods.length)], xf - s.n[0] * 0.12, 0.875, z + 0.27, 0.17);
      }
      H.spot('browse', xf + s.n[0] * 0.55, (s.az[0] + s.az[1]) / 2, -s.n[0], 0);
      H.spot('staff', xf - s.n[0] * 1.3, (s.az[0] + s.az[1]) / 2, s.n[0], 0, { outfit: { apron: V.col, cap: true } });
    }
  }
  // back counter (wrapping station) in the middle
  P.box('env_matte', cx - (x1 - x0) / 2 + 2.0, cx + (x1 - x0) / 2 - 2.0, 0, 0.9, cz - 0.3, cz + 0.3, [0.92, 0.9, 0.86]);
  P.box('env_matte', cx - 0.6, cx + 0.6, 0.9, 1.0, cz - 0.25, cz + 0.25, [0.95, 0.95, 0.95]);
  // stacked gift boxes / shopping bags
  for (let k = 0; k < 6; k++) P.box('env_matte', cx - 1.4 + k * 0.5, cx - 1.05 + k * 0.5, 0.9, 0.98 + (k % 3) * 0.06, cz - 0.2, cz + 0.2, k % 2 ? [0.95, 0.93, 0.9] : mix(col, [1, 1, 1], 0.3));
  // hanging vendor sign (two-sided, lit) on a frame
  const sg = R.litLabel(V.ja, V.col, '#ffffff', 384, 72);
  const sw = Math.min(3.6, x1 - x0 - 1), sh = sw * 72 / 384;
  const sy = 2.25;
  P.box('env_matte', cx - sw / 2 - 0.05, cx + sw / 2 + 0.05, sy - 0.04, sy + sh + 0.04, cz - 0.06, cz + 0.06, col);
  P.tq(sg, cx - sw / 2, cx + sw / 2, sy, sy + sh, cz - 0.062, -1);
  P.qd(sg.atlas.mat(sg), cx - sw / 2, cx + sw / 2, sy, sy + sh, cz + 0.062, 1, WHITE, sg.atlas.uv(sg));
  for (const e of [-1, 1]) P.box('env_metal', cx + e * sw / 2 - 0.01, cx + e * sw / 2 + 0.01, sy + sh, H.sp.ceil, cz - 0.01, cz + 0.01, [0.5, 0.5, 0.5]);
  // canopy light frame over the island
  P.box('env_matte', x0 + 0.2, x1 - 0.2, 2.62, 2.7, z0 + 0.2, z0 + 0.35, col);
  P.box('env_matte', x0 + 0.2, x1 - 0.2, 2.62, 2.7, z1 - 0.35, z1 - 0.2, col);
  P.qh('env_glow', x0 + 0.3, x1 - 0.3, z0 + 0.22, z0 + 0.33, 2.615, false, [2.4, 2.1, 1.7]);
  P.qh('env_glow', x0 + 0.3, x1 - 0.3, z1 - 0.33, z1 - 0.22, 2.615, false, [2.4, 2.1, 1.7]);
  // price POP cards on sticks
  for (let k = 0; k < 3; k++) {
    const pr = R.pop(k + Math.floor(r() * 5), D.yen([540, 648, 864, 1080, 1296, 2160][Math.floor(r() * 6)]));
    const px = x0 + 1 + k * (x1 - x0 - 2) / 2;
    P.box('env_metal', px - 0.004, px + 0.004, 1.28, 1.5, z0 + 0.3, z0 + 0.31, [0.6, 0.6, 0.6]);
    P.tq(pr, px - 0.12, px + 0.12, 1.45, 1.63, z0 + 0.295, -1);
  }
  H.light(cx, 2.5, cz, [1, 0.88, 0.7], 0.9, 7, 'down');
}

function wallCounters(H, R, r) {
  const [X0, Z0, X1, Z1] = H.sp.rect;
  const g = H.env.world.grids[H.level];
  const solidAt = (x, z) => { const i = g.cellOf(x, z); return i < 0 || g.type[i] !== CELL.WALK; };
  const kinds = ['bottles', 'snack', 'souvenir', 'coffeebag', 'bottles', 'drink'];
  // north wall z = Z0 (facing +z), south wall z = Z1 (facing -z), east wall x = X1 (facing -x)
  const runs = [];
  for (const [zWall, n] of [[Z0, 1], [Z1, -1]]) {
    let start = null;
    for (let x = X0 + 2; x <= X1 - 2; x++) {
      const ok = x < X1 - 2 && solidAt(x + 0.5, zWall - n * 0.5) && H.clear(x, n > 0 ? zWall : zWall - 1.2, x + 1, n > 0 ? zWall + 1.2 : zWall);
      if (ok && start === null) start = x;
      if (!ok && start !== null) { if (x - start >= 3) runs.push({ x0: start, x1: x, z: zWall, n }); start = null; }
    }
  }
  let vi = 7;
  for (const run of runs) {
    const P = H.painter((run.x0 + run.x1) / 2, run.z);
    const zf = run.z + run.n * 0.7, zA = Math.min(run.z, zf), zB = Math.max(run.z, zf);
    H.box(run.x0, zA, run.x1, zB);
    for (let x = run.x0; x < run.x1 - 0.5; x += 3) {
      const e = Math.min(run.x1, x + 3);
      const V = VENDORS[vi++ % VENDORS.length];
      // shelving wall with bottles / packaged gifts
      const kind = kinds[vi % kinds.length];
      P.box('env_wood', x, e, 0, 0.9, zA, zB, mix(K(V.col), [1, 1, 1], 0.2));
      for (let lv = 0; lv < 4; lv++) {
        const reg = R.prod(kind, (lv + vi) % 4);
        P.qd(reg.atlas.mat(reg), x + 0.05, e - 0.05, 1.0 + lv * 0.38, 1.3 + lv * 0.38, run.z + run.n * 0.02, run.n > 0 ? 1 : -1, WHITE, reg.atlas.uv(reg));
        P.box('env_wood', x, e, 0.97 + lv * 0.38, 1.0 + lv * 0.38, Math.min(run.z, run.z + run.n * 0.3), Math.max(run.z, run.z + run.n * 0.3), [0.5, 0.36, 0.22]);
      }
      const sg = R.litLabel(V.ja, V.col, '#ffffff', 384, 72);
      P.qd(sg.atlas.mat(sg), x + 0.3, e - 0.3, 2.55, 2.55 + (e - x - 0.6) * 72 / 384, run.z + run.n * 0.03, run.n > 0 ? 1 : -1, WHITE, sg.atlas.uv(sg));
      H.spot('browse', (x + e) / 2, run.z + run.n * 1.3, 0, -run.n);
    }
  }
}

// ----------------------------------------------------------------------------
// Takashimaya 1F cosmetics hall
// ----------------------------------------------------------------------------
const BRANDS = [['MAISON LUNE', '#111111', '#e8d8b8'], ['SHIRO-HADA', '#ffffff', '#222222'], ['AURÈLE', '#1a1a2e', '#d4af37'], ['KISETSU', '#f2e6e6', '#8a2a3a'],
  ['NOIR ET BLANC', '#000000', '#ffffff'], ['HANAKO TOKYO', '#c8102e', '#ffffff'], ['CLAIRE DE SOIE', '#f6efe6', '#7a5a3a'], ['YUKI BEAUTÉ', '#e8f0f8', '#1d3557'],
  ['SORA COSMETICS', '#87c5ea', '#ffffff'], ['MIZU-IRO', '#2a9d8f', '#ffffff'], ['ATELIER ROSE', '#f8d7da', '#6d2e46'], ['KUROBARA', '#2a0a12', '#e8a0b8']];

export function buildTaka1F(env, R, H = new Hall(env, 'taka_1f')) {
  if (!H.sp) return H;
  const [X0, Z0, X1, Z1] = H.sp.rect;
  // promenade: north door x∈[-70,-50] → z -160 → east to x≈0 → south door
  const promenade = (x0, z0, x1, z1) => (x1 > -72 && x0 < -48 && z0 < -156) || (z1 > -164 && z0 < -154) || (x1 > -8 && x0 < 8 && z1 > -160);
  let bi = 0;
  const cw = 6, ch = 4;
  for (let z = Z0 + 3; z + ch <= Z1 - 3; z += ch + 2.8) {
    for (let x = X0 + 3; x + cw <= X1 - 3; x += cw + 2.8) {
      if (promenade(x, z, x + cw, z + ch)) continue;
      if (!H.clear(x, z, x + cw, z + ch, 0.5, true)) continue;
      brandCounter(H, R, x, z, x + cw, z + ch, BRANDS[bi++ % BRANDS.length]);
    }
  }
  // carpet runner along the promenade + chandelier-ish pendants
  const P = H.painter(-30, -158);
  P.qh('env_matte', -66, -54, -183, -160, 0.008, true, [0.55, 0.48, 0.42]);
  P.qh('env_matte', -66, 4, -162, -156, 0.008, true, [0.55, 0.48, 0.42]);
  P.qh('env_matte', -4, 4, -156, -133, 0.008, true, [0.55, 0.48, 0.42]);
  for (const [x, z] of [[-60, -175], [-60, -166], [-45, -159], [-30, -159], [-15, -159], [0, -150], [0, -140]]) {
    const PP = H.painter(x, z);
    PP.box('env_metal', x - 0.005, x + 0.005, 3.4, H.sp.ceil, z - 0.005, z + 0.005, [0.8, 0.7, 0.4]);
    for (let k = 0; k < 7; k++) { const a = k / 7 * Math.PI * 2; PP.geo('env_glow', 'sphere', x + Math.cos(a) * 0.45, 3.35 - (k % 2) * 0.15, z + Math.sin(a) * 0.45, 0, 0.07, [2.6, 2.3, 1.8]); }
    PP.geo('env_metal', 'cyl', x, 3.3, z, 0, [0.5, 0.05, 0.5], [0.85, 0.75, 0.45]);
    H.light(x, 3.3, z, [1, 0.9, 0.75], 0.8, 8, 'lamp');
  }
  // autumn display at the promenade corner: mannequin pair + leaves
  const PD = H.painter(-55, -159);
  if (H.clear(-47, -168, -43, -166.5)) {
    H.box(-47, -168, -43, -166.5);
    PD.box('env_gloss', -47, -43, 0, 0.25, -168, -166.5, [0.95, 0.94, 0.92]);
    const S0 = { r: rng(5) };
    mannequin(S0, PD, -46, 0.25, -167.3, 0, [0.55, 0.18, 0.1], [0.2, 0.2, 0.22]);
    mannequin(S0, PD, -44.6, 0.25, -167.3, 0.4, [0.8, 0.6, 0.3], [0.3, 0.25, 0.2]);
    for (let k = 0; k < 14; k++) PD.geo('env_matte', 'blob', -46.8 + (k % 7) * 0.55, 0.27, -167.9 + Math.floor(k / 7) * 0.9, k, [0.12, 0.03, 0.12], [[0.8, 0.2, 0.1], [0.9, 0.5, 0.1], [0.9, 0.75, 0.2]][k % 3]);
  }
  return H;
}

function brandCounter(H, R, x0, z0, x1, z1, [name, bg, fg]) {
  const P = H.painter((x0 + x1) / 2, (z0 + z1) / 2);
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  H.box(x0 + 0.3, z0 + 0.3, x1 - 0.3, z1 - 0.3);
  const B = K(bg), Fg = K(fg);
  // platform
  P.box('env_gloss', x0 + 0.2, x1 - 0.2, 0, 0.04, z0 + 0.2, z1 - 0.2, mix(B, [1, 1, 1], 0.6));
  // central backlit brand wall (two-sided)
  const sg = R.litLabel(name, bg, fg, 384, 64);
  P.box('env_gloss', cx - 1.6, cx + 1.6, 0, 2.7, cz - 0.15, cz + 0.15, B);
  P.tq(sg, cx - 1.4, cx + 1.4, 2.15, 2.15 + 2.8 * 64 / 384, cz - 0.152, -1);
  P.qd(sg.atlas.mat(sg), cx - 1.4, cx + 1.4, 2.15, 2.15 + 2.8 * 64 / 384, cz + 0.152, 1, WHITE, sg.atlas.uv(sg));
  // product shelves on the wall faces (lit)
  for (const side of [-1, 1]) {
    const zf = cz + side * 0.16;
    for (let lv = 0; lv < 3; lv++) {
      const reg = R.prod('cosme', lv);
      P.qd(reg.atlas.mat(reg), cx - 1.4, cx + 1.4, 1.0 + lv * 0.35, 1.28 + lv * 0.35, zf + side * 0.001, side, WHITE, reg.atlas.uv(reg, side > 0));
      P.box('env_glow', cx - 1.4, cx + 1.4, 0.98 + lv * 0.35, 1.0 + lv * 0.35, Math.min(zf, zf + side * 0.18), Math.max(zf, zf + side * 0.18), [1.8, 1.75, 1.7]);
    }
    // counters with testers + mirrors + stools
    const zc = side < 0 ? z0 + 0.5 : z1 - 0.9;
    P.box('env_gloss', cx - 1.8, cx + 1.8, 0, 0.92, zc, zc + 0.4, [0.98, 0.98, 0.97]);
    P.qh('env_glow', cx - 1.75, cx + 1.75, zc + 0.05, zc + 0.35, 0.921, true, [1.6, 1.55, 1.5]);
    for (let k = 0; k < 6; k++) P.cyl('env_gloss', cx - 1.5 + k * 0.6, 0.92, 1.02 + (k % 3) * 0.03, zc + 0.2, 0.025, mix(B, [1, 1, 1], 0.3));
    P.box('env_gloss', cx - 0.25, cx + 0.25, 0.92, 1.35, zc + 0.15, zc + 0.2, [0.8, 0.85, 0.9]);
    const sz = side < 0 ? z0 - 0.35 : z1 + 0.35;
    for (const sx of [cx - 1.0, cx + 1.0]) { P.geo('env_metal', 'stool', sx, 0, sz, 0, [1, 0.95, 1], mix(B, [1, 1, 1], 0.2)); H.spot('seat', sx, sz, 0, side < 0 ? 1 : -1, { h: 0.69 }); }
    H.spot('browse', cx, side < 0 ? z0 - 0.5 : z1 + 0.5, 0, side < 0 ? 1 : -1);
    H.spot('staff', cx + 0.6, side < 0 ? z0 + 1.2 : z1 - 1.2, 0, side < 0 ? -1 : 1, { outfit: { uniform: bg } });
  }
  H.light(cx, 2.4, cz, [1, 0.95, 0.9], 0.7, 6, 'sign');
}
