// =============================================================================
// Street frontages: rows of mixed-use buildings (ground-floor shopfronts from a
// canvas atlas, window-grid facades above, blade signs / wall signs / rooftop
// boards from a second atlas, lit at night). Used for the Sennichimae-dori
// neon facades, the Midosuji avenue wall and the plaza-side blocks.
//   const F = new Frontages(ctx)
//   F.run({ ax, az, bx, bz, nx, nz, seed, ... })   // a → b along the street, (nx,nz) = towards the street
//   F.emit(parent)  -> adds 5 meshes (facades, roofs, shopfronts, signs, solids)
// =============================================================================
import * as THREE from 'three';
import { rng } from '../../core/rng.js?v=6c67dba';
import { MeshAcc, lin, mulc } from './meshacc.js?v=6c67dba';
import { FKIND, facadeMat } from './facade.js?v=6c67dba';

const FONT = '"Noto Sans JP","Hiragino Kaku Gothic ProN","Yu Gothic",Meiryo,sans-serif';

export const SHOP_TILE = { w: 320, h: 240, cols: 6, rows: 4 };
export const SIGN_ATLAS = { W: 2048, H: 1024, vw: 128, vh: 512, vcols: 8, vrows: 2, hw: 512, hh: 128, hcols: 2, hrows: 8, hx0: 1024 };

const SHOP_NAMES = [
  ['薬局', 'DRUG', '#1b8f4a'], ['カラオケ', 'KARAOKE', '#d9206a'], ['居酒屋', 'IZAKAYA', '#a8281f'], ['らーめん', 'RAMEN', '#222222'],
  ['たこ焼き', 'TAKOYAKI', '#e8a21a'], ['100円ショップ', '¥100', '#d8362b'], ['焼肉', 'YAKINIKU', '#7a1d14'], ['ゲームセンター', 'GAME', '#4a2fa0'],
  ['メガネ', 'EYEWEAR', '#1d5fa8'], ['免税店', 'TAX FREE', '#c7261f'], ['カフェ', 'CAFE', '#4b3425'], ['お好み焼き', 'OKONOMIYAKI', '#b5391f'],
  ['うどん', 'UDON', '#3b2a1c'], ['寿司', 'SUSHI', '#1a2a4a'], ['ブティック', 'BOUTIQUE', '#222a3a'], ['靴', 'SHOES', '#7a4b21'],
  ['スマホ修理', 'PHONE REPAIR', '#0f7f9a'], ['ドラッグ', 'DRUG STORE', '#e07a14'], ['コンビニ', 'OPEN 24H', '#1566b0'], ['マッサージ', 'MASSAGE', '#5a2d6b'],
  ['ホテル', 'HOTEL', '#2a2f36'], ['書店', 'BOOKS', '#2e5c3a'], ['時計', 'WATCH', '#1b1b1b'], ['串カツ', 'KUSHIKATSU', '#b3271b'],
];

function waitFont() {
  const t = new Promise(r => setTimeout(r, 1800));
  const l = (typeof document !== 'undefined' && document.fonts) ? Promise.all([document.fonts.load('700 32px "Noto Sans JP"'), document.fonts.load('400 32px "Noto Sans JP"')]).catch(() => 0) : Promise.resolve();
  return Promise.race([l, t]);
}

function fitText(g, text, maxW, size, weight = 700) {
  g.font = `${weight} ${size}px ${FONT}`;
  let w = g.measureText(text).width;
  if (w > maxW) { size = Math.floor(size * maxW / w); g.font = `${weight} ${size}px ${FONT}`; }
  return size;
}

// ---------------------------------------------------------------------------
export function shopAtlas(ctx) {
  return ctx.materials.texture('out_shopatlas', () => {
    const T = SHOP_TILE, W = T.w * T.cols, H = T.h * T.rows;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    const R = rng(4242);
    for (let i = 0; i < T.cols * T.rows; i++) {
      const x0 = (i % T.cols) * T.w, y0 = Math.floor(i / T.cols) * T.h;
      const [ja, en, col] = SHOP_NAMES[i % SHOP_NAMES.length];
      g.save(); g.beginPath(); g.rect(x0, y0, T.w, T.h); g.clip();
      // wall
      g.fillStyle = R.pick(['#cfc6b4', '#bdb7ab', '#d9d2c2', '#aaa598', '#c9b79a']); g.fillRect(x0, y0, T.w, T.h);
      // sign band (top 22%)
      const sh = T.h * 0.23;
      g.fillStyle = col; g.fillRect(x0 + 6, y0 + 5, T.w - 12, sh);
      g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(x0 + 6, y0 + 5, T.w - 12, 3);
      const light = ['#e8a21a', '#e07a14', '#d8362b', '#d9206a', '#1b8f4a', '#0f7f9a'].includes(col);
      g.fillStyle = light ? '#fffdf5' : '#fff8e0';
      g.textBaseline = 'middle'; g.textAlign = 'center';
      let fs = fitText(g, ja, T.w * 0.62, Math.floor(sh * 0.62));
      g.fillText(ja, x0 + T.w * 0.5, y0 + 5 + sh * 0.5);
      // awning (some)
      const awn = R.chance(0.45);
      let top = y0 + sh + 10;
      if (awn) {
        const a = R.pick(['#c0392b', '#2c5aa0', '#2e7d4f', '#d4a017', '#333']);
        for (let k = 0; k < 10; k++) { g.fillStyle = k % 2 ? a : '#f1ece0'; g.fillRect(x0 + 6 + k * (T.w - 12) / 10, top, (T.w - 12) / 10, 16); }
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x0 + 6, top + 16, T.w - 12, 4);
        top += 20;
      }
      // glazing
      const gy0 = top + 2, gy1 = y0 + T.h - 14;
      const gx0 = x0 + 10, gx1 = x0 + T.w - 10;
      const warm = R.pick([[250, 232, 200], [240, 236, 228], [255, 214, 170], [225, 236, 244]]);
      const grd = g.createLinearGradient(0, gy0, 0, gy1);
      grd.addColorStop(0, `rgb(${warm.map(v => v | 0)})`); grd.addColorStop(1, `rgb(${warm.map(v => v * 0.55 | 0)})`);
      g.fillStyle = grd; g.fillRect(gx0, gy0, gx1 - gx0, gy1 - gy0);
      // interior: shelves, counters, product blocks, people-ish silhouettes
      const n = R.int(3, 6);
      for (let k = 0; k < n; k++) {
        const sx = gx0 + 8 + k * (gx1 - gx0 - 16) / n, sw = (gx1 - gx0 - 16) / n - 6;
        const sy = gy0 + R.range(10, 30);
        g.fillStyle = 'rgba(60,48,40,0.55)'; g.fillRect(sx, sy, sw, gy1 - sy - 4);
        for (let r = 0; r < 4; r++) {
          const yy = sy + 6 + r * (gy1 - sy - 14) / 4;
          g.fillStyle = 'rgba(40,32,28,0.6)'; g.fillRect(sx, yy + 12, sw, 2);
          for (let q = 0; q < 5; q++) { g.fillStyle = `hsl(${R.range(0, 360) | 0},${R.range(35, 80) | 0}%,${R.range(40, 72) | 0}%)`; g.fillRect(sx + 2 + q * sw / 5, yy + 1, sw / 5 - 2, 11); }
        }
      }
      if (R.chance(0.6)) { g.fillStyle = 'rgba(30,26,24,0.8)'; const px = gx0 + R.range(30, gx1 - gx0 - 30); g.beginPath(); g.arc(px, gy1 - 52, 8, 0, 6.3); g.fill(); g.fillRect(px - 9, gy1 - 44, 18, 40); }
      // reflection streak
      g.fillStyle = 'rgba(190,215,235,0.16)'; g.beginPath(); g.moveTo(gx0, gy0); g.lineTo(gx0 + 70, gy0); g.lineTo(gx0 + 20, gy1); g.lineTo(gx0, gy1); g.fill();
      // mullions + door
      g.fillStyle = '#2b2a28';
      const cols = R.int(2, 4);
      for (let k = 0; k <= cols; k++) g.fillRect(gx0 + k * (gx1 - gx0) / cols - 2, gy0, 4, gy1 - gy0);
      g.fillRect(gx0, gy0, gx1 - gx0, 3); g.fillRect(gx0, gy1 - 3, gx1 - gx0, 3);
      // door panel
      const dk = R.int(0, cols - 1);
      g.fillStyle = 'rgba(255,240,210,0.28)'; g.fillRect(gx0 + dk * (gx1 - gx0) / cols + 4, gy0 + 4, (gx1 - gx0) / cols - 8, gy1 - gy0 - 8);
      g.fillStyle = '#c8c8c8'; g.fillRect(gx0 + (dk + 1) * (gx1 - gx0) / cols - 14, gy0 + (gy1 - gy0) * 0.5, 3, 24);
      // plinth + english sub-line
      g.fillStyle = '#4a4742'; g.fillRect(x0, y0 + T.h - 12, T.w, 12);
      g.fillStyle = light ? 'rgba(255,255,255,0.8)' : 'rgba(255,240,200,0.85)';
      fitText(g, en, T.w * 0.5, 13, 600);
      g.fillText(en, x0 + T.w * 0.5, y0 + 5 + sh * 0.88);
      g.restore();
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  });
}

const VTEXT = ['薬', 'カラオケ', '居酒屋', 'ラーメン', '焼肉', 'パチンコ', '寿司', 'ホテル', 'たこ焼', '串カツ', 'BAR', 'カフェ', '免税', '歯科', 'ネットカフェ', 'ゲーム', 'マッサージ', 'お好み焼', '麺', '酒', 'クラブ', '眼鏡', 'ドラッグ', '蟹'];
const HTEXT = [['なんば', 'NAMBA'], ['ホテル', 'HOTEL'], ['カラオケ館', 'KARAOKE'], ['免税店', 'TAX FREE'], ['大阪名物', 'OSAKA FOOD'], ['アウトレット', 'SALE'], ['家電', 'ELECTRONICS'], ['ゲームセンター', 'AMUSEMENT'],
  ['レストラン', 'RESTAURANT'], ['薬 化粧品', 'DRUG & BEAUTY'], ['ビジネスホテル', 'BUSINESS HOTEL'], ['駐車場', 'PARKING'], ['お土産', 'SOUVENIRS'], ['居酒屋 食べ放題', 'ALL YOU CAN EAT'], ['楽器', 'MUSIC'], ['ラーメン横丁', 'RAMEN']];

export function signAtlas(ctx) {
  return ctx.materials.texture('out_signatlas', () => {
    const A = SIGN_ATLAS;
    const c = document.createElement('canvas'); c.width = A.W; c.height = A.H;
    const g = c.getContext('2d');
    g.fillStyle = '#101012'; g.fillRect(0, 0, A.W, A.H);
    const R = rng(777);
    const NEON = [['#ff2a6d', '#fff'], ['#ffd400', '#2a1a00'], ['#12c2e9', '#fff'], ['#ff7a00', '#fff'], ['#37e07a', '#06260f'], ['#ffffff', '#c1121f'], ['#8a2be2', '#fff'], ['#e8112d', '#fff3d0']];
    // vertical blades
    for (let i = 0; i < A.vcols * A.vrows; i++) {
      const x0 = (i % A.vcols) * A.vw, y0 = Math.floor(i / A.vcols) * A.vh;
      const [bg, fg] = NEON[i % NEON.length];
      g.save(); g.beginPath(); g.rect(x0, y0, A.vw, A.vh); g.clip();
      g.fillStyle = bg; g.fillRect(x0, y0, A.vw, A.vh);
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x0, y0, A.vw, 6); g.fillRect(x0, y0 + A.vh - 6, A.vw, 6);
      g.strokeStyle = fg; g.globalAlpha = 0.9; g.lineWidth = 5; g.strokeRect(x0 + 8, y0 + 8, A.vw - 16, A.vh - 16); g.globalAlpha = 1;
      const txt = VTEXT[i % VTEXT.length];
      const chars = [...txt];
      const cell = Math.min(A.vw * 0.62, (A.vh - 70) / chars.length);
      g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = `800 ${Math.floor(cell * 0.92)}px ${FONT}`;
      chars.forEach((ch, k) => g.fillText(ch, x0 + A.vw / 2, y0 + 36 + cell * (k + 0.5) + (A.vh - 70 - cell * chars.length) / 2));
      g.restore();
    }
    // horizontal boards
    for (let i = 0; i < A.hcols * A.hrows; i++) {
      const x0 = A.hx0 + (i % A.hcols) * A.hw, y0 = Math.floor(i / A.hcols) * A.hh;
      const [bg, fg] = NEON[(i * 3 + 1) % NEON.length];
      const [ja, en] = HTEXT[i % HTEXT.length];
      g.save(); g.beginPath(); g.rect(x0, y0, A.hw, A.hh); g.clip();
      g.fillStyle = bg; g.fillRect(x0, y0, A.hw, A.hh);
      g.strokeStyle = fg; g.lineWidth = 4; g.globalAlpha = 0.85; g.strokeRect(x0 + 6, y0 + 6, A.hw - 12, A.hh - 12); g.globalAlpha = 1;
      g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
      fitText(g, ja, A.hw * 0.8, 62, 800); g.fillText(ja, x0 + A.hw / 2, y0 + A.hh * 0.42);
      fitText(g, en, A.hw * 0.8, 28, 700); g.fillText(en, x0 + A.hw / 2, y0 + A.hh * 0.8);
      g.restore();
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  });
}

export async function prepareStorefrontTextures() { await waitFont(); }

// emissive-by-night standard materials (updated by street.js each frame)
export const SF_U = { night: 0 };
export function storefrontMaterials(ctx) {
  const M = ctx.materials;
  if (!M.factories.has('out_shopfront')) {
    M.define('out_shopfront', () => { const m = new THREE.MeshStandardMaterial({ map: shopAtlas(ctx), roughness: 0.55, metalness: 0.0, emissive: 0xffffff, emissiveMap: shopAtlas(ctx), emissiveIntensity: 0.12 }); m.userData.nbReflect = 0; return m; });
    M.define('out_signs', () => { const m = new THREE.MeshStandardMaterial({ map: signAtlas(ctx), roughness: 0.5, metalness: 0.0, emissive: 0xffffff, emissiveMap: signAtlas(ctx), emissiveIntensity: 0.3, side: THREE.DoubleSide }); m.userData.nbReflect = 0; return m; });
    M.define('out_frontage_solid', () => { const m = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.85 }); m.userData.nbReflect = 0; return m; });
  }
  return { shop: M.get('out_shopfront'), sign: M.get('out_signs'), solid: M.get('out_frontage_solid') };
}
export function updateStorefronts(ctx, night) {
  const m = storefrontMaterials(ctx);
  m.shop.emissiveIntensity = 0.1 + 1.25 * night;
  m.sign.emissiveIntensity = 0.28 + 2.4 * night;
}

// ---------------------------------------------------------------------------
const PALETTE = ['#d9cdb5', '#e6e2d8', '#b9b8b4', '#c7b08c', '#8c6b55', '#6f737a', '#b8c4b0', '#d2b4a8', '#cfd4d8', '#a79b8a'].map(lin);

function tileUV(i) {
  const T = SHOP_TILE, c = i % T.cols, r = Math.floor(i / T.cols), e = 0.004;
  return [(c + e) / T.cols, 1 - (r + 1 - e) / T.rows, (c + 1 - e) / T.cols, 1 - (r + e) / T.rows];
}
function vSignUV(i) { const A = SIGN_ATLAS, c = i % A.vcols, r = Math.floor(i / A.vcols); return [c * A.vw / A.W, 1 - (r + 1) * A.vh / A.H, (c + 1) * A.vw / A.W, 1 - r * A.vh / A.H]; }
function hSignUV(i) { const A = SIGN_ATLAS, c = i % A.hcols, r = Math.floor(i / A.hcols); return [(A.hx0 + c * A.hw) / A.W, 1 - (r + 1) * A.hh / A.H, (A.hx0 + (c + 1) * A.hw) / A.W, 1 - r * A.hh / A.H]; }

export class Frontages {
  constructor(ctx) {
    this.ctx = ctx;
    this.facade = new MeshAcc(); this.facade.k = [];
    this.roof = new MeshAcc();
    this.shop = new MeshAcc();
    this.sign = new MeshAcc();
    this.solid = new MeshAcc();
    this.lots = [];
  }
  kind(k) { this.facade.kv = FKIND[k]; }

  // a → b along the street; (nx,nz) = unit normal towards the street (outward from the buildings).
  // skip: array of [u0,u1] ranges (metres along a→b) left empty. opts: hMin,hMax floors range, depth.
  run(o) {
    const { ax, az, bx, bz, nx, nz } = o;
    const R = rng(o.seed || 1);
    const L = Math.hypot(bx - ax, bz - az);
    const tx = (bx - ax) / L, tz = (bz - az) / L;
    const P = (u, d = 0, y = 0) => [ax + tx * u - nx * d, y, az + tz * u - nz * d]; // d = depth behind the facade line
    const depth = o.depth || 16;
    const skip = o.skip || [];
    const inSkip = (u0, u1) => skip.some(([a, b]) => u1 > a && u0 < b);
    let u = 0; const lots = [];
    while (u < L - 4) {
      let w = R.range(o.wMin || 6, o.wMax || 17);
      if (L - u - w < 5) w = L - u;
      const nf = o.tall && R.chance(0.15) ? R.int(10, 13) : R.int(o.fMin || 4, o.fMax || 9);
      const H = 4.6 + (nf - 1) * 3.35 + R.range(0, 0.6);
      lots.push({ u0: u, u1: u + w, H, nf, gap: inSkip(u, u + w) });
      u += w;
    }
    const hasNeon = o.neon !== false;
    for (let li = 0; li < lots.length; li++) {
      const lot = lots[li];
      if (lot.gap) continue;
      const w = lot.u1 - lot.u0, H = lot.H;
      const col = R.pick(PALETTE);
      const style = R.pick(['office', 'office', 'grid', 'grid', 'apartment', 'curtain']);
      this.kind(style);
      const [a0x, , a0z] = P(lot.u0), [b0x, , b0z] = P(lot.u1);
      // upper facade (above the shopfront band)
      this._fquad(a0x, a0z, b0x, b0z, 4.6, H, nx, nz, mulc(col, R.range(0.9, 1.05)), lot.u0 + (o.uBase || 0));
      // roof
      const r0 = P(lot.u0, depth), r1 = P(lot.u1, depth);
      this.roof.quad([a0x, H, a0z], [b0x, H, b0z], [r1[0], H, r1[2]], [r0[0], H, r0[2]], [0, 1, 0], [[a0x, a0z], [b0x, b0z], [r1[0], r1[2]], [r0[0], r0[2]]], lin(0x8c8a85));
      // rooftop clutter / water tank
      if (R.chance(0.55)) { const q = P(lot.u0 + w * R.range(0.2, 0.8), R.range(3, depth - 4)); this._box(this.solid, q[0], H + 1.1, q[2], R.range(1.5, 3.5), R.range(1.5, 2.5), R.range(1.5, 3), lin(R.pick([0xbdbdbd, 0x9a9a98, 0x6f7377]))); }
      // overhang canopy over the shopfronts (pilotis-like shadow line)
      const cano = this.solid;
      cano.quad([a0x + nx * 0.7, 4.65, a0z + nz * 0.7], [b0x + nx * 0.7, 4.65, b0z + nz * 0.7], [b0x, 4.65, b0z], [a0x, 4.65, a0z], [0, -1, 0], null, lin(0x77746d));
      cano.quad([a0x, 4.4, a0z], [b0x, 4.4, b0z], [b0x + nx * 0.7, 4.4, b0z + nz * 0.7], [a0x + nx * 0.7, 4.4, a0z + nz * 0.7], [0, 1, 0], null, lin(0x77746d));
      // shopfronts (tiles of ~5.5 m)
      const ns = Math.max(1, Math.round(w / 5.6));
      for (let s = 0; s < ns; s++) {
        const u0 = lot.u0 + w * s / ns, u1 = lot.u0 + w * (s + 1) / ns;
        const A = P(u0), B = P(u1);
        const [uu0, vv0, uu1, vv1] = tileUV(R.int(0, SHOP_TILE.cols * SHOP_TILE.rows - 1));
        // quad facing the street: ensure winding
        const front = (-tz * nx + tx * nz) >= 0;
        const p0 = front ? A : B, p1 = front ? B : A;
        const ua = front ? uu0 : uu1, ub = front ? uu1 : uu0;
        this.shop.quad([p0[0] + nx * 0.02, 0, p0[2] + nz * 0.02], [p1[0] + nx * 0.02, 0, p1[2] + nz * 0.02], [p1[0] + nx * 0.02, 4.4, p1[2] + nz * 0.02], [p0[0] + nx * 0.02, 4.4, p0[2] + nz * 0.02], [nx, 0, nz], [[ua, vv0], [ub, vv0], [ub, vv1], [ua, vv1]]);
      }
      // dark band between shopfront and first floor
      this.solid.quad(...this._orient([a0x + nx * 0.01, 4.4, a0z + nz * 0.01], [b0x + nx * 0.01, 4.4, b0z + nz * 0.01], 4.4, 4.62, nx, nz), [nx, 0, nz], null, lin(0x4a4843));
      if (!hasNeon) continue;
      // blade signs (perpendicular to the facade), wall signs, rooftop boards
      const nBlade = R.int(0, Math.max(1, Math.round(w / 6)));
      for (let k = 0; k < nBlade; k++) {
        const uu = lot.u0 + w * R.range(0.08, 0.92);
        const y0 = R.range(5.2, Math.max(5.4, Math.min(H - 5, 15)));
        const hh = R.range(3.2, 6.5), ww = R.range(0.8, 1.2);
        const [x0, , z0] = P(uu);
        const [u0, v0, u1, v1] = vSignUV(R.int(0, SIGN_ATLAS.vcols * SIGN_ATLAS.vrows - 1));
        // slab spans from the wall out along n; its two faces look along ±t
        for (const sgn of [1, -1]) {
          const ex = tx * sgn, ez = tz * sgn;
          const px = x0 + ex * 0.04 + nx * 0.05, pz = z0 + ez * 0.04 + nz * 0.05;
          let A = [px, pz], B = [px + nx * ww, pz + nz * ww];
          if ((-(B[1] - A[1])) * ex + (B[0] - A[0]) * ez < 0) { const t = A; A = B; B = t; }
          this.sign.quad([A[0], y0, A[1]], [B[0], y0, B[1]], [B[0], y0 + hh, B[1]], [A[0], y0 + hh, A[1]], [ex, 0, ez], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
        }
        this._box(this.solid, x0 + nx * 0.2, y0 + hh * 0.5, z0 + nz * 0.2, 0.12, hh, 0.12, lin(0x333333));
      }
      // flat vertical wall sign
      if (R.chance(0.5) && H > 12) {
        const uu = lot.u0 + w * R.range(0.12, 0.88), y0 = R.range(5.5, H - 6), hh = R.range(4, 7.5), ww = R.range(0.8, 1.2);
        const [u0, v0, u1, v1] = vSignUV(R.int(0, SIGN_ATLAS.vcols * SIGN_ATLAS.vrows - 1));
        const A = P(uu - ww / 2), B = P(uu + ww / 2);
        this._signQuad(A, B, y0, y0 + hh, nx, nz, [u0, v0, u1, v1], 0.08);
      }
      // wide horizontal sign / rooftop board
      if (R.chance(0.45)) {
        const ww = Math.min(w * 0.8, R.range(4, 8)), uu = lot.u0 + w * 0.5, hh = ww / 4;
        const y0 = R.chance(0.5) ? H - hh - 0.3 : R.range(6, Math.max(6.5, H - 4));
        const A = P(uu - ww / 2), B = P(uu + ww / 2);
        this._signQuad(A, B, y0, y0 + hh, nx, nz, hSignUV(R.int(0, SIGN_ATLAS.hcols * SIGN_ATLAS.hrows - 1)), 0.1);
      }
      // rooftop billboard (tall thin board standing on the parapet)
      if (R.chance(0.2)) {
        const ww = Math.min(w * 0.7, 9), uu = lot.u0 + w * 0.5, hh = ww / 3;
        const A = P(uu - ww / 2, 0.8), B = P(uu + ww / 2, 0.8);
        this._signQuad(A, B, H + 0.6, H + 0.6 + hh, nx, nz, hSignUV(R.int(0, SIGN_ATLAS.hcols * SIGN_ATLAS.hrows - 1)), 0);
        for (const uq of [uu - ww / 2 + 0.4, uu + ww / 2 - 0.4]) { const q = P(uq, 0.7); this._box(this.solid, q[0], H + 0.6 + hh / 2, q[2], 0.15, hh, 0.15, lin(0x444444)); }
      }
    }
    // party-wall steps where neighbours differ in height
    this.kind('office');
    for (let li = 0; li < lots.length - 1; li++) {
      const a = lots[li], b = lots[li + 1];
      if (a.gap || b.gap || Math.abs(a.H - b.H) < 0.3) continue;
      const hi = a.H > b.H ? a : b, lo = a.H > b.H ? b : a;
      const u = a.u1, dirT = a.H > b.H ? 1 : -1; // face normal along ±t towards the lower lot
      const P0 = P(u, 0), P1 = P(u, depth);
      this._fquad(P0[0], P0[2], P1[0], P1[2], lo.H, hi.H, tx * dirT, tz * dirT, lin(0xb4b0a6), 0);
    }
    this.lots.push(...lots);
    return lots;
  }

  _orient(p0, p1, y0, y1, nx, nz) {
    // quad args (a,b,c,d) facing (nx,nz)
    const tx = p1[0] - p0[0], tz = p1[2] - p0[2];
    const good = (-tz * nx + tx * nz) >= 0;
    const A = good ? p0 : p1, B = good ? p1 : p0;
    return [[A[0], y0, A[2]], [B[0], y0, B[2]], [B[0], y1, B[2]], [A[0], y1, A[2]]];
  }
  _fquad(ax, az, bx, bz, y0, y1, nx, nz, col, u0) {
    if (y1 - y0 < 0.01) return;
    const len = Math.hypot(bx - ax, bz - az);
    const tx = bx - ax, tz = bz - az;
    let A = [ax, az], B = [bx, bz];
    if (-tz * nx + tx * nz < 0) { A = [bx, bz]; B = [ax, az]; }
    this.facade.quad([A[0], y0, A[1]], [B[0], y0, B[1]], [B[0], y1, B[1]], [A[0], y1, A[1]], [nx, 0, nz], [[u0, y0], [u0 + len, y0], [u0 + len, y1], [u0, y1]], col);
  }
  _signQuad(A, B, y0, y1, nx, nz, uv, off) {
    const [u0, v0, u1, v1] = uv;
    const tx = B[0] - A[0], tz = B[2] - A[2];
    const front = (-tz * nx + tx * nz) >= 0;
    const p0 = front ? A : B, p1 = front ? B : A;
    const ua = front ? u0 : u1, ub = front ? u1 : u0;
    this.sign.quad([p0[0] + nx * off, y0, p0[2] + nz * off], [p1[0] + nx * off, y0, p1[2] + nz * off], [p1[0] + nx * off, y1, p1[2] + nz * off], [p0[0] + nx * off, y1, p0[2] + nz * off], [nx, 0, nz], [[ua, v0], [ub, v0], [ub, v1], [ua, v1]]);
  }
  _box(acc, cx, cy, cz, sx, sy, sz, col) {
    const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
    acc.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], null, col);
    acc.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], null, col);
    acc.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], null, col);
    acc.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], null, col);
    acc.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], null, col);
  }

  emit(parent) {
    const m = storefrontMaterials(this.ctx);
    const out = [];
    const add = (acc, mat, name, cast, recv = true) => { if (acc.empty) return; const mesh = acc.mesh(mat, { cast, receive: recv, name }); parent.add(mesh); out.push(mesh); };
    add(this.facade, facadeMat(this.ctx), 'street:facades', true);
    add(this.roof, this.roofMat(), 'street:roofs', false);
    add(this.shop, m.shop, 'street:shopfronts', false);
    add(this.sign, m.sign, 'street:signs', false);
    add(this.solid, m.solid, 'street:solids', true);
    return out;
  }
  roofMat() {
    const M = this.ctx.materials;
    if (!M.factories.has('out_roof')) M.define('out_roof', () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0, vertexColors: true }));
    return M.get('out_roof');
  }
}
