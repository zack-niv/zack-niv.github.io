// =============================================================================
// v23: floor guide boards (フロアガイド / 館内案内図), the tall panel by the escalators or at an entrance:
//   LEFT   every floor of the building, top floor first: floor tile, category (JA + EN), notable tenants (JA + EN, from
//          world/directory.js; the shops Aya sends you to are starred), a legend. The current floor is lit by a
//          translucent yellow band + a red "現在地" tab laid over the shared list texture.
//   RIGHT  a plan of the floor you stand on, turned so that "up" is the way you face the board, with escalator / toilet /
//          locker / gate pictograms, a star on the named shops and a red 現在地 / YOU ARE HERE pin at your position.
//   The Nankai Central Gate board ("area" boards) swaps the list for a station-area guide: which way to Namba CITY, Namba
//   Parks, the Metro lines, Takashimaya, NAMBAWALK, each arrow the true first bearing of the nav route from the board.
//
// MEMORY (phones): textures are shared. One list texture per building (+ one per area board), one plan texture per
// (building, floor, orientation); the position pin, the row highlight and the row tab are quads of ONE tiny shared
// transparent texture, so no board owns pixels of its own. All of it lives in a private 1024 px atlas (the 'sign'
// canvas scale applies on phones) that memdiet frees after upload like every other static sign canvas.
// Driven by Signage (world/signage.js): place() in _place, drawBoard() in _draw, mesh() in _buildMeshes.
// =============================================================================
import * as THREE from 'three';
import { LAYOUT, LEVELS, LEVEL_ORDER, rampEnds } from './layout.js?v=5442362';
import { BUSINESSES, CATEGORIES, businessBySlot } from './directory.js?v=5442362';
import { drawFloor, THEMES } from '../ui/phone/maprender.js?v=5442362';
import { FACILITY_INFO, DESTINATIONS, EXIT_INFO } from '../ui/phone/places.js?v=5442362';

// board geometry (metres)
// v23 signs2: 3.0 x 2.2 m (was 2.72 x 1.9) so the list type can be read from 3 m
export const BW = 3.0, BH = 2.2, LW = 1.85, PW = 1.05;
// texture density (logical px per metre): lists carry small tenant text, plans are shapes
// v23 signs2: 270 / 190 so that two lists (499 px) fit a 1024 page side by side and five plans fill the shelf under them (3 pages)
const LD = 270, PD = 190;
const LPX = [Math.round(LW * LD), Math.round(BH * LD)], PPX = [Math.round(PW * PD), Math.round(BH * PD)];

// ---- buildings -------------------------------------------------------------
const BLD = {
  city: { ja: 'なんばCITY', en: 'Namba CITY', color: '#1f6fb8', zones: ['city'], levels: ['2F', '1F', 'B1'] },
  parks: { ja: 'なんばパークス', en: 'Namba Parks', color: '#5c9e3f', zones: ['parks'], levels: ['8F', '7F', '6F', '5F', '4F', '3F', '2F'] },
  nankai: { ja: '南海なんば駅', en: 'Nankai Namba Station', color: '#F08300', zones: ['nankai'], levels: ['3F', '2F', '1F'] },
};
// what the Nankai floors hold (no tenants there: the concourse and the platforms)
const NANKAI_ROWS = {
  '3F': { ja: '南海線のりば・中央改札口', en: 'Nankai Line platforms · Central Gate', jaL: '1〜8番線　ラピート・高野線・空港急行', enL: 'Tracks 1–8 · rapi:t · Koya Line · Airport Exp.' },
  '2F': { ja: '南海コンコース', en: 'Nankai concourse', jaL: 'きっぷうりば・ロッカー・トイレ・なんばCITY・パークス方面', enL: 'Tickets · lockers · toilets · to Namba CITY & Parks' },
  '1F': { ja: 'タクシー・地上へ', en: 'Taxi · street level', jaL: 'タクシーのりば・コインロッカー・南海通り', enL: 'Taxi rank · coin lockers · Nankai-dori' },
};
const GROUPS = {
  fashion: ['ファッション', 'Fashion'], dining: ['レストラン', 'Restaurants'], cafe: ['カフェ・スイーツ', 'Cafés & sweets'], lifestyle: ['雑貨', 'Lifestyle'],
  outdoor: ['アウトドア', 'Outdoor'], cosmetics: ['コスメ', 'Beauty'], drugstore: ['ドラッグ', 'Drugstore'], books: ['書店', 'Books'], electronics: ['家電', 'Electronics'], other: ['ショップ', 'Shops'],
};
const groupOf = (cat) => {
  if (['fashion', 'shoes', 'accessories', 'eyewear'].includes(cat)) return 'fashion';
  if (['cafe', 'kissaten', 'coffeestand', 'bakery', 'sweets'].includes(cat)) return 'cafe';
  if (['ramen', 'udon', 'okonomiyaki', 'kushikatsu', 'sushi', 'tonkatsu', 'curry', 'tempura', 'tendon', 'izakaya', 'yakiniku', 'omurice', 'takoyaki'].includes(cat)) return 'dining';
  if (['lifestyle', 'hyakuen', 'souvenir', 'gacha', 'florist', 'stationery'].includes(cat)) return 'lifestyle';
  if (cat === 'outdoor') return 'outdoor'; if (cat === 'cosmetics') return 'cosmetics'; if (cat === 'drugstore') return 'drugstore';
  if (cat === 'books') return 'books'; if (cat === 'electronics') return 'electronics';
  return 'other';
};
// the data of a building's list (cached): rows top floor first
const _data = {};
export function buildingData(key) {
  if (_data[key]) return _data[key];
  const B = BLD[key], rows = [];
  for (const lv of B.levels) {
    if (key === 'nankai') { const r = NANKAI_ROWS[lv]; rows.push({ level: lv, tag: LEVELS[lv].label, ja: r.ja, en: r.en, jaL: r.jaL, enL: r.enL }); continue; }
    const arr = BUSINESSES.filter(b => b.zone === B.zones[0] && b.level === lv && b.cat !== 'closed' && b.en);
    const cnt = {}; for (const b of arr) { const g = groupOf(b.cat); cnt[g] = (cnt[g] || 0) + 1; }
    const order = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a]);
    let ja, en;
    if (order.length && cnt[order[0]] / arr.length >= 0.6) { ja = GROUPS[order[0]][0]; en = GROUPS[order[0]][1]; }
    else { const t = order.slice(0, 2); ja = t.map(g => GROUPS[g][0]).join('・'); en = t.map(g => GROUPS[g][1]).join(' & '); }
    // tenants: the shops the story names first, then short names from different categories (best rated first)
    const used = {}, pick = [];
    const sorted = arr.slice().sort((a, b) => (b.key ? 1 : 0) - (a.key ? 1 : 0) || (a.ja.length > 10) - (b.ja.length > 10) || b.rating - a.rating);
    for (const b of sorted) {
      const g = b.cat; if (used[g] && !b.key) continue;
      if (b.key && !(b.key === 'tempura_great')) { if (!/Mitsubachi/.test(b.en)) continue; }
      used[g] = 1; pick.push(b); if (pick.length >= 3) break;
    }
    // the café Aya sends you to is on its floor even if not rated highest
    const cafe = arr.find(b => /Mitsubachi/.test(b.en)); if (cafe && !pick.includes(cafe)) { pick.pop(); pick.unshift(cafe); }
    const star = (b) => (b.key === 'tempura_great' || /Mitsubachi/.test(b.en)) ? '★' : '';
    // v23 signs2: names small enough to need a nose against the board were noise. Only the floor that holds a shop the story
    // names (Daikichi, Mitsubachi) keeps ONE tenant line, big; every other floor is its category alone.
    const st = pick.filter(b => star(b));
    rows.push({ level: lv, tag: LEVELS[lv].label, ja, en, star: st.length > 0, jaL: st.map(b => '★' + b.ja).join('・'), enL: st.map(b => '★' + b.en).join(' · ') });
  }
  return (_data[key] = { key, ...B, rows });
}
// vertical layout of the list rows inside the list texture (px): rows holding a starred shop are taller (they carry the one
// tenant line); the block of rows is centred when the building has few floors.
export function rowLayout(bd) {
  const top = Math.round(LPX[1] * 0.14) + 6, bot = LPX[1] - 54, n = bd.rows.length;
  const w = bd.rows.map(r => (r.star || bd.key === 'nankai') ? 1.9 : 1), tot = w.reduce((a, b) => a + b, 0);
  const unit = Math.min(88, (bot - top) / tot);
  let y = top + ((bot - top) - unit * tot) / 2;
  return bd.rows.map((r, i) => { const h = unit * w[i], o = { y, h }; y += h; return o; });
}

// ---- footprint of a building's floor (m) -------------------------------------
function footprint(bkey, level) {
  const B = BLD[bkey]; let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
  for (const s of LAYOUT.spaces) {
    if (s.level !== level || !B.zones.includes(s.zone) || s.outdoor) continue;
    if (s.rect) { x0 = Math.min(x0, s.rect[0]); z0 = Math.min(z0, s.rect[1]); x1 = Math.max(x1, s.rect[2]); z1 = Math.max(z1, s.rect[3]); }
    else for (const [x, z] of s.poly) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
  }
  if (x0 > x1) return null;
  return [x0 - 2, z0 - 2, x1 + 2, z1 + 2];
}

// ---- the shared little texture: pin, dot, highlight, row tab ------------------
const PIN = { callout: [0, 0, 200, 100], dot: [0, 108, 72, 72], hl: [212, 4, 16, 16], tab: [80, 112, 170, 56] };

export class FloorGuides {
  // sig = the Signage instance; K = its drawing kit { Atlas, JA, EN, measW, fitFont, picto, rr, drawArrow, lcanvas }
  constructor(sig, K) { this.sig = sig; this.K = K; this.boards = []; this.rects = new Map(); this.plans = new Map(); }

  // ---------------------------------------------------------------------------
  // PLACEMENT: specs are hand-picked at the places where a visitor looks for a map (escalator landings, entrances);
  // each is mounted on the nearest long wall, else on a free-standing stand beside the walkway.
  // ---------------------------------------------------------------------------
  place(specs) {
    const sig = this.sig, world = sig.ctx.world;
    for (const sp0 of specs) {
      const sp = Object.assign({}, sp0);
      // slide along the wall (x = wallX) to the spot in front of the least door / opening, nearest the target z
      if (sp.slide && sp.wallX != null) {
        const spans = [];
        for (const sl of LAYOUT.shopSlots) if (sl.level === sp.level && sl.door[0] === sl.door[2] && sl.door[0] === sp.wallX) spans.push([sl.door[1], sl.door[3]]);
        let best = null;
        for (let dz = -sp.slide; dz <= sp.slide; dz += 0.5) {
          const z = sp.z + dz; let bad = 0;
          for (let t = z - BW / 2; t <= z + BW / 2; t += 0.5) {
            if (spans.some(q => t >= q[0] && t <= q[1])) bad += 0.5;
            if (sig.ctx.world.isWalkable(sp.level, sp.wallX - sp.nx * 0.8, t)) bad += 0.5;
            if (!sig.ctx.world.isWalkable(sp.level, sp.x + sp.nx * 1.2, t)) bad += 3;
          }
          if (sig._near(sp.level, sp.x, z, 2.5)) bad += 2;
          const sc = bad + Math.abs(dz) * 0.08;
          if (!best || sc < best.sc) best = { sc, z };
        }
        if (best) sp.z = best.z;
      }
      let m = sp.wall === false ? null : sig._wallMount(sp.level, sp.x, sp.z, BW);
      let stand = false;
      if (m && sp.maxWall != null && Math.hypot(m.x - sp.x, m.z - sp.z) > sp.maxWall) m = null;
      if (!m) { m = { x: sp.x, z: sp.z, nx: sp.nx, nz: sp.nz }; stand = true; }
      const s = sig._add({ kind: 'fguide', level: sp.level, x: m.x, z: m.z, nx: m.nx, nz: m.nz, w: BW, h: BH, yc: 1.6, op: sp.bld === 'city' ? 'city' : sp.bld === 'parks' ? 'parks' : 'nankai',
        single: true, cat: 'guide', bld: sp.bld, area: !!sp.area, stand, major: true, label: sp.label || '' });
      if (stand) {
        // free-standing: two posts + the panel; blocks the cells it stands on (the nav graph is built after this)
        // v23 signs2: any facing (the Parks landing boards are turned 45 degrees towards the people stepping off): the box's local x
        // axis runs along the board (its right vector (nz, -nx))
        world.addBox(s.level, s.x, s.z, BW / 2, 0.1, Math.atan2(-s.nx, s.nz));
      }
      this.boards.push(s);
    }
  }

  // ---------------------------------------------------------------------------
  // DRAW: allocate + paint the shared textures (once each) and set the board's refs
  // ---------------------------------------------------------------------------
  _atlas() { return this.atlas || (this.atlas = new this.K.Atlas(1024)); }
  _paint(rect, fn) {
    const g = rect.page.g;
    g.save(); g.beginPath(); g.rect(rect.x, rect.y, rect.w, rect.h); g.clip(); g.translate(rect.x, rect.y);
    try { fn(g, rect.w, rect.h); } catch (e) { console.warn('[floorguide]', e); }
    g.restore();
  }
  // lists first (they are the tall ones), plans after: called by Signage once, before it draws anything else
  drawAll() {
    const at = this._atlas();
    for (const s of this.boards) if (!s.area && !this.rects.has('list|' + s.bld)) {
      const r = at.alloc(LPX[0], LPX[1]); this.rects.set('list|' + s.bld, r);
      this._paint(r, (g, W, H) => this._drawList(g, W, H, buildingData(s.bld)));
    }
    for (const s of this.boards) {
      if (s.area) { s.listRect = at.alloc(LPX[0], LPX[1]); this._paint(s.listRect, (g, W, H) => this._drawArea(g, W, H, s)); }
      else s.listRect = this.rects.get('list|' + s.bld);
    }
    for (const s of this.boards) {
      const f = [-s.nx, -s.nz];
      const rot = ((Math.round(Math.atan2(f[0], -f[1]) / (Math.PI / 4)) % 8) + 8) % 8;       // v23: 45 degree steps
      const key = `plan|${s.bld}|${s.level}|${rot}`;
      let rec = this.plans.get(key);
      if (!rec) {
        const fp = footprint(s.bld, s.level);
        if (!fp) continue;
        const rect = at.alloc(PPX[0], PPX[1]);
        rec = { rect, rot, fp }; this.plans.set(key, rec);
        this._paint(rect, (g, W, H) => this._drawPlan(g, W, H, s, rec));
      }
      s.plan = rec;
    }
    this._pin();
  }
  // texture pages -> THREE textures is done by Signage (it owns pageMats); the pin has its own tiny material
  _pin() {
    const c = this.K.lcanvas(256, 256, 'sign'), g = c.getContext('2d'), { JA, EN } = this.K;
    g.clearRect(0, 0, 256, 256);
    const [cx, cy, cw, ch] = PIN.callout;
    g.fillStyle = '#d7191f'; this.K.rr(g, cx + 1, cy + 1, cw - 2, ch - 2, 14); g.fill();
    g.strokeStyle = '#ffffff'; g.lineWidth = 3; this.K.rr(g, cx + 4, cy + 4, cw - 8, ch - 8, 11); g.stroke();
    g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = JA(46, 900); g.fillText('現在地', cx + cw / 2, cy + 38);
    g.font = EN(21, 800); g.fillText('YOU ARE HERE', cx + cw / 2, cy + 77);
    const [dx, dy, dw, dh] = PIN.dot, mx = dx + dw / 2, my = dy + dh / 2;
    g.fillStyle = 'rgba(215,25,31,0.28)'; g.beginPath(); g.arc(mx, my, 35, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(mx, my, 23, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#d7191f'; g.beginPath(); g.arc(mx, my, 17, 0, Math.PI * 2); g.fill();
    const [hx, hy, hw, hh] = PIN.hl; g.fillStyle = 'rgba(255,208,0,0.36)'; g.fillRect(hx, hy, hw, hh);
    const [tx, ty, tw, th] = PIN.tab;
    g.fillStyle = '#d7191f'; this.K.rr(g, tx, ty, tw, th, 10); g.fill();
    g.fillStyle = '#ffffff'; g.font = JA(27, 900); g.fillText('現在地', tx + tw * 0.4, ty + th * 0.5); g.font = EN(17, 800); g.fillText('HERE', tx + tw * 0.84, ty + th * 0.52);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    m.name = 'guide_pin';
    this.pin = { canvas: c, tex, mat: m, page: { canvas: c } };
  }

  // ---- list texture ----------------------------------------------------------
  _drawList(g, W, H, bld) {
    const { JA, EN, fitFont, measW } = this.K;
    g.fillStyle = '#f8f6ef'; g.fillRect(0, 0, W, H);
    const hh = Math.round(H * 0.14);
    g.fillStyle = '#24272c'; g.fillRect(0, 0, W, hh); g.fillStyle = bld.color; g.fillRect(0, hh - 6, W, 6);
    g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillStyle = '#ffffff';
    fitFont(g, bld.ja, p => JA(p, 900), 42, W * 0.6); g.fillText(bld.ja, 14, hh * 0.35);
    g.fillStyle = '#d3d7dd'; fitFont(g, bld.en, p => EN(p, 700), 23, W * 0.6); g.fillText(bld.en, 14, hh * 0.76);
    g.textAlign = 'right'; g.fillStyle = '#ffffff'; g.font = JA(26, 900); g.fillText('フロアガイド', W - 12, hh * 0.38);
    g.fillStyle = '#d3d7dd'; g.font = EN(18, 800); g.fillText('FLOOR GUIDE', W - 12, hh * 0.72);
    const lay = rowLayout(bld);
    bld.rows.forEach((r, i) => {
      const { y, h: rh } = lay[i];
      g.fillStyle = i % 2 ? '#f8f6ef' : '#ece9df'; g.fillRect(0, y, W, rh);
      g.fillStyle = '#cfcabd'; g.fillRect(0, y + rh - 1.5, W, 1.5);
      // floor tile (big: reads from 6 m)
      const tw = 78;
      g.fillStyle = bld.color; this.K.rr(g, 5, y + 3, tw, rh - 6, 8); g.fill();
      g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.font = EN(Math.min(rh * 0.5, 44), 900); g.fillText(r.tag, 5 + tw / 2, y + rh * 0.52);
      const x0 = tw + 16, mw = W - x0 - 8;
      g.textAlign = 'left';
      if (r.jaL) {
        // a floor with a named shop: category on top (smaller), the shop below (big, red star)
        g.fillStyle = '#16191d'; fitFont(g, r.ja, p => JA(p, 900), rh * 0.22, mw); g.fillText(r.ja, x0, y + rh * 0.17);
        g.fillStyle = '#5c616a'; fitFont(g, r.en, p => EN(p, 700), rh * 0.14, mw); g.fillText(r.en, x0, y + rh * 0.34);
        g.fillStyle = r.star ? '#b3121a' : '#1f2328'; fitFont(g, r.jaL, p => JA(p, 900), rh * 0.25, mw); g.fillText(r.jaL, x0, y + rh * 0.58);
        g.fillStyle = r.star ? '#8e1017' : '#4b5058'; fitFont(g, r.enL, p => EN(p, 800), rh * 0.16, mw); g.fillText(r.enL, x0, y + rh * 0.84);
      } else {
        // category alone: JA big, EN under it
        g.fillStyle = '#16191d'; fitFont(g, r.ja, p => JA(p, 900), rh * 0.46, mw); g.fillText(r.ja, x0, y + rh * 0.36);
        g.fillStyle = '#4b5058'; fitFont(g, r.en, p => EN(p, 700), rh * 0.27, mw); g.fillText(r.en, x0, y + rh * 0.75);
      }
    });
    this._legend(g, W, H);
  }
  _legend(g, W, H) {
    const { JA, EN, picto } = this.K, y = H - 54;
    g.fillStyle = '#e4e0d4'; g.fillRect(0, y, W, 54);
    const items = [['escalator', '#3b6fb6', 'エスカレーター', 'Escalator'], ['toilet', '#2b6cb0', 'トイレ', 'Toilets'], ['locker', '#4a5568', 'ロッカー', 'Lockers'], ['star', '#d7191f', '現在地', 'You are here']];
    const cw = W / items.length;
    items.forEach(([kind, col, ja, en], i) => {
      const cx = i * cw + 22, cy = y + 27;
      if (kind === 'star') { g.fillStyle = '#d7191f'; g.beginPath(); g.arc(cx, cy, 12, 0, Math.PI * 2); g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.arc(cx, cy, 5.5, 0, Math.PI * 2); g.fill(); }
      else picto(g, kind, cx, cy, 34, '#ffffff', col);
      g.fillStyle = '#1f2328'; g.textAlign = 'left'; g.textBaseline = 'middle';
      g.font = JA(14, 900); g.fillText(ja, cx + 24, cy - 8);
      g.fillStyle = '#5c616a'; g.font = EN(11.5, 700); g.fillText(en, cx + 24, cy + 10);
    });
  }

  // ---- the station-area list (Nankai Central Gate): arrows from the nav ----------
  _drawArea(g, W, H, s) {
    const { JA, EN, fitFont, measW, drawArrow } = this.K, sig = this.sig;
    g.fillStyle = '#f8f6ef'; g.fillRect(0, 0, W, H);
    const hh = Math.round(H * 0.16);
    g.fillStyle = '#24272c'; g.fillRect(0, 0, W, hh); g.fillStyle = '#F08300'; g.fillRect(0, hh - 6, W, 6);
    g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillStyle = '#fff';
    fitFont(g, 'なんば駅周辺案内図', p => JA(p, 900), 42, W * 0.7); g.fillText('なんば駅周辺案内図', 14, hh * 0.40);
    g.fillStyle = '#d3d7dd'; fitFont(g, 'Station area guide · where to from here', p => EN(p, 700), 22, W - 28); g.fillText('Station area guide · where to from here', 14, hh * 0.76);
    const rows = s.areaRows || [];
    const top = hh + 8, rh = Math.min(84, (H - top - 8) / Math.max(1, rows.length));
    rows.forEach((r, i) => {
      const y = top + i * rh;
      g.fillStyle = i % 2 ? '#f8f6ef' : '#ece9df'; g.fillRect(0, y, W, rh);
      // arrow disc: up = straight on, as you face this board
      g.fillStyle = r.color; g.beginPath(); g.arc(rh * 0.5 + 6, y + rh / 2, rh * 0.42, 0, Math.PI * 2); g.fill();
      drawArrow(g, rh * 0.5 + 6, y + rh / 2, rh * 0.5, r.ang, '#ffffff');
      const x0 = rh + 16, mw = W - x0 - 78;
      g.textAlign = 'left'; g.fillStyle = '#16191d'; fitFont(g, r.ja, p => JA(p, 900), rh * 0.4, mw); g.fillText(r.ja, x0, y + rh * 0.34);
      g.fillStyle = '#5c616a'; fitFont(g, r.en, p => EN(p, 700), rh * 0.27, mw); g.fillText(r.en, x0, y + rh * 0.74);
      if (r.lvl) {
        g.fillStyle = '#24272c'; this.K.rr(g, W - 72, y + rh * 0.2, 64, rh * 0.6, 8); g.fill();
        g.fillStyle = '#fff'; g.textAlign = 'center'; g.font = EN(rh * 0.32, 900); g.fillText((r.dir > 0 ? '↑' : '↓') + r.lvl, W - 40, y + rh * 0.5);
      }
    });
  }

  // ---- plan texture -------------------------------------------------------------
  _drawPlan(g, W, H, s, rec) {
    const { JA, EN, picto, rr } = this.K, sig = this.sig, world = sig.ctx.world, bld = BLD[s.bld];
    const [x0, z0, x1, z1] = rec.fp, th = -rec.rot * Math.PI / 4;
    g.fillStyle = '#f8f6ef'; g.fillRect(0, 0, W, H);
    const hh = Math.round(H * 0.105);
    g.fillStyle = '#24272c'; g.fillRect(0, 0, W, hh); g.fillStyle = bld.color; g.fillRect(0, hh - 5, W, 5);
    g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillStyle = '#fff'; g.font = EN(34, 900); g.fillText(LEVELS[s.level].label, 10, hh * 0.5);
    g.font = JA(15, 900); g.fillText('フロアマップ', 74, hh * 0.34); g.fillStyle = '#d3d7dd'; g.font = EN(11.5, 700); g.fillText('FLOOR MAP', 74, hh * 0.72);
    const mx = 5, my = hh + 5, mw = W - 10, mh = H - my - 5;
    // rotated bounding box of the footprint
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, c = Math.cos(th), sn = Math.sin(th);
    let bw = 0, bh = 0;
    for (const [px, pz] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]) { const dx = px - cx, dz = pz - cz; bw = Math.max(bw, Math.abs(dx * c - dz * sn)); bh = Math.max(bh, Math.abs(dx * sn + dz * c)); }
    const sc = Math.min(mw / (bw * 2), mh / (bh * 2));
    const ox = mx + mw / 2, oy = my + mh / 2;
    rec.proj = (x, z) => { const dx = (x - cx) * sc, dz = (z - cz) * sc; return [ox + dx * c - dz * sn, oy + dx * sn + dz * c]; };
    rec.W = W; rec.H = H;
    g.save(); g.beginPath(); g.rect(mx, my, mw, mh); g.clip();
    g.fillStyle = '#d9d5cc'; g.fillRect(mx, my, mw, mh);
    g.save(); g.translate(ox, oy); g.rotate(th); g.scale(sc, sc); g.translate(-cx, -cz);
    drawFloor(g, world, s.level, THEMES.guide, { bounds: [x0, z0, x1, z1], businessBySlot });
    g.restore();
    const proj = rec.proj, inMap = (px, py, m = 0) => px > mx + m && px < mx + mw - m && py > my + m && py < my + mh - m;
    // escalators / stairs: one tile per bank, an arrow for the way it carries you from this floor
    const banks = new Map();
    for (const r of LAYOUT.ramps) {
      if (r.lower !== s.level && r.upper !== s.level) continue;
      if (EXIT_INFO && Object.values(EXIT_INFO).some(e => e.ramp === r.id)) continue;
      const k = r.bank || r.id; if (!banks.has(k)) banks.set(k, []); banks.get(k).push(r);
    }
    for (const [, rs] of banks) {
      const r = rs[0]; let ax = 0, az = 0;
      for (const q of rs) { ax += (q.rect[0] + q.rect[2]) / 2; az += (q.rect[1] + q.rect[3]) / 2; }
      const [px, py] = proj(ax / rs.length, az / rs.length);
      if (!inMap(px, py, 6)) continue;
      picto(g, r.kind === 'escalator' ? 'escalator' : 'stairs', px, py, 24, '#ffffff', '#3b6fb6');
      const up = r.lower === s.level;
      g.fillStyle = up ? '#c2410c' : '#0f766e'; g.beginPath();
      g.moveTo(px + 14, py + (up ? -7 : 7)); g.lineTo(px + 22, py + (up ? 7 : -7)); g.lineTo(px + 6, py + (up ? 7 : -7)); g.closePath(); g.fill();
    }
    for (const f of sig.facilities) {
      if (f.level !== s.level || f.pole) continue;
      const [px, py] = proj(f.x + f.nx, f.z + f.nz);
      if (!inMap(px, py, 6)) continue;
      picto(g, FACILITY_INFO[f.kind].picto, px, py, 24, '#ffffff', f.kind === 'toilet' ? '#2b6cb0' : '#4a5568');
    }
    // fare gates
    for (const gt of LAYOUT.gates) {
      if (gt.level !== s.level || gt.line !== 'nankai') continue;
      const [px, py] = proj(gt.axis === 'x' ? (gt.from + gt.to) / 2 : gt.at, gt.axis === 'x' ? gt.at : (gt.from + gt.to) / 2);
      if (!inMap(px, py, 4)) continue;
      g.fillStyle = '#24272c'; rr(g, px - 40, py - 12, 80, 24, 5); g.fill();
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.font = JA(12, 900); g.fillText(gt.ja, px, py - 3); g.font = EN(7.5, 800); g.fillText('CENTRAL GATE', px, py + 7.5);
    }
    // the shops the story sends you to
    for (const sl of LAYOUT.shopSlots) {
      if (sl.level !== s.level) continue;
      const b = businessBySlot[sl.id]; if (!b || !(b.key === 'tempura_great' || /Mitsubachi/.test(b.en))) continue;
      const [px, py] = proj(b.x, b.z);
      if (!inMap(px, py, 4)) continue;
      g.fillStyle = '#d7191f'; g.strokeStyle = '#fff'; g.lineWidth = 2;
      g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr_ = i % 2 ? 6 : 14; g.lineTo(px + Math.cos(a) * rr_, py + Math.sin(a) * rr_); } g.closePath(); g.fill(); g.stroke();
      const lab = b.ja, ew = b.en.replace('Café ', '');
      g.font = JA(12, 900); const wl = g.measureText(lab).width + 12;
      let bx = px - wl / 2; bx = Math.max(mx + 2, Math.min(mx + mw - wl - 2, bx));
      g.fillStyle = '#fff'; g.strokeStyle = '#d7191f'; g.lineWidth = 1.5; rr(g, bx, py + 16, wl, 24, 5); g.fill(); g.stroke();
      g.fillStyle = '#16191d'; g.textAlign = 'center'; g.fillText(lab, bx + wl / 2, py + 24); g.font = EN(8.5, 800); g.fillText(ew, bx + wl / 2, py + 34);
    }
    g.restore();
    // north mark
    g.save(); g.translate(W - 20, hh * 0.52); g.rotate(th);
    g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(0, -13); g.lineTo(6, 4); g.lineTo(-6, 4); g.closePath(); g.fill();
    g.rotate(-th); g.fillStyle = '#ffffff'; g.font = EN(10, 900); g.textAlign = 'center'; g.fillText('N', Math.sin(-th) * 0 + 0, 14); g.restore();
  }

  // ---------------------------------------------------------------------------
  // MESH: housing, list quad, plan quad, pin, dot, row highlight and tab
  // ---------------------------------------------------------------------------
  mesh(b, s, housing) {
    const sig = this.sig, y = s.y0 + s.yc, dep = s.stand ? 0.14 : 0.08;
    const nx = s.nx, nz = s.nz, rx = nz, rz = -nx, rotY = Math.atan2(nx, nz);
    const fx = s.x + nx * (dep + 0.004), fz = s.z + nz * (dep + 0.004);
    b.box(housing, s.x + nx * dep / 2, y, s.z + nz * dep / 2, BW + 0.1, BH + 0.1, dep, rotY);
    if (s.stand) {
      for (const o of [-0.5, 0.5]) {
        const px = s.x + rx * o * BW * 0.78, pz = s.z + rz * o * BW * 0.78;
        b.box(housing, px, s.y0 + (s.yc - BH / 2) / 2, pz, 0.1, s.yc - BH / 2 + 0.02, 0.1, 0);
      }
    }
    const at = (u, v, d = 0) => [fx + rx * u + nx * d, y + v, fz + rz * u + nz * d];
    // list (left) and plan (right)
    const lu = -BW / 2 + 0.03 + LW / 2, pu = BW / 2 - 0.03 - PW / 2;
    if (s.listRect) { const p = at(lu, 0); sig._quadRect(b, s.listRect, p[0], p[1], p[2], nx, nz, LW, BH); }
    if (s.plan) { const p = at(pu, 0); sig._quadRect(b, s.plan.rect, p[0], p[1], p[2], nx, nz, PW, BH); }
    if (!this.pin) return;
    const pm = this.pin.mat, pg = this.pin.page, F = 0.004;
    const reg = (a) => ({ page: pg, x: a[0], y: a[1], w: a[2], h: a[3] });
    // pin: the dot at our position on the plan, the callout above it
    if (s.plan && s.plan.proj) {
      const [px, py] = s.plan.proj(s.x + nx * 1.2, s.z + nz * 1.2);
      const u = pu - PW / 2 + (px / s.plan.W) * PW, v = BH / 2 - (py / s.plan.H) * BH;
      const dotS = 0.14, cW = 0.5, cH = cW * 100 / 200;
      let p = at(u, v, F); sig._quadRect(b, reg(PIN.dot), p[0], p[1], p[2], nx, nz, dotS, dotS, pm);
      let cu = Math.max(pu - PW / 2 + cW / 2 + 0.02, Math.min(pu + PW / 2 - cW / 2 - 0.02, u));
      let cv = v + dotS * 0.5 + cH / 2 + 0.01; if (cv + cH / 2 > BH / 2 - 0.27) cv = v - dotS * 0.5 - cH / 2 - 0.01;       // v23: never over the plan's header
      p = at(cu, cv, F * 1.5); sig._quadRect(b, reg(PIN.callout), p[0], p[1], p[2], nx, nz, cW, cH, pm);
    }
    // row highlight + tab on the list
    if (!s.area && s.listRect) {
      const bd = buildingData(s.bld), i = bd.rows.findIndex(r => r.level === s.level);
      if (i >= 0) {
        const lay = rowLayout(bd)[i], pxm = 1 / LD;
        const v = BH / 2 - (lay.y + lay.h / 2) * pxm, h = lay.h * pxm;
        let p = at(lu, v, F); sig._quadRect(b, reg(PIN.hl), p[0], p[1], p[2], nx, nz, LW, h, pm);
        const tw = Math.min(0.36, h * 3), th = tw * 56 / 170;
        p = at(lu + LW / 2 - tw / 2 - 0.02, v + h / 2 - th / 2 - 0.004, F * 1.5); sig._quadRect(b, reg(PIN.tab), p[0], p[1], p[2], nx, nz, tw, th, pm);
      }
    }
  }
}
