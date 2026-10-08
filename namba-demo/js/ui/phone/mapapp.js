// =============================================================================
// Maps — the phone's indoor map app.
//
// Useful, but with the characteristic ambiguity of real indoor navigation:
//   * it shows the floor the phone THINKS you are on (lagging, sometimes wrong)
//   * the blue dot wanders 5–25 m underground; the heading cone jitters
//   * search distances are as the crow flies (misleadingly short)
//   * places on other floors are ghost pins with a floor badge
//   * directions only cover the current floor up to the next escalator /
//     stairs ("Take escalator to 2F"), then wait for you to get there
// Rendering: Canvas2D, cached per-floor base layers, redrawn only while open.
// =============================================================================
import { LAYOUT, LEVELS, LEVEL_ORDER, ZONES, rampEnds } from '../../world/layout.js?v=5f764cf';
import { BUSINESSES, searchBusinesses, isOpen, CATEGORIES } from '../../world/directory.js?v=5f764cf';
import { businessBySlot } from '../../world/directory.js?v=5f764cf';
import { drawFloor, drawRoads, THEMES, catGroup, ROADS } from './maprender.js?v=5f764cf';
import { TRANSIT_PLACES, LINES, EXIT_INFO, FACILITIES, FACILITY_INFO } from './places.js?v=5f764cf';
import { routeLegs, simplify, fieldNoEntry } from './routes.js?v=5f764cf';
import { hash } from '../../core/rng.js?v=5f764cf';
import { placeArt, reviewsFor, popularTimes } from './art.js?v=5f764cf';
import { DestList, destIdOf, defaultIds, bizSub, zoneShort, nextChip, nextChipHtml } from './destinations.js?v=5f764cf';

const BASE_PPM = 4;          // cached base layer resolution (px per metre)
const ZOOM_MIN = 0.45, ZOOM_MAX = 14;
const hm = (m) => { m = Math.round(m) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
// Presentation-layer overrides for the hand-made quest places: how a maps
// listing would really show a tiny standing bar (few reviews, Japanese name,
// geocoded to the wrong side of the passage).
const LISTING = {
  coffee_great: { rating: 4.9, reviews: 38, jaOnly: true, fuzz: 22 },
};
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const fmtDist = (m) => m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(1)} km`;

const CHIPS = [
  ['coffee', '☕', 'Coffee'], ['tempura', '🍤', 'Tempura'], ['midosuji', 'M', 'Midosuji'], ['shin-osaka', '🚄', 'Shin-Osaka'], ['toilet', '🚻', 'Toilets'], ['ramen', '🍜', 'Ramen'],
];
const AREA_PLACES = [
  { id: 'a_parks', kind: 'area', en: 'Namba Parks', ja: 'なんばパークス', sub: 'Shopping mall & roof gardens · 2F–8F', level: '2F', x: 0, z: 205, keys: ['parks', 'namba parks', 'garden', 'パークス'] },
  { id: 'a_city', kind: 'area', en: 'Namba CITY', ja: 'なんばCITY', sub: 'Shopping mall under the Nankai tracks · B1–2F', level: 'B1', x: 0, z: 20, keys: ['city', 'namba city', 'mall'] },
  { id: 'a_walk', kind: 'area', en: 'NAMBAWALK', ja: 'なんばウォーク', sub: 'Underground shopping street · B1', level: 'B1', x: 60, z: -222, keys: ['walk', 'nambawalk', 'underground'] },
  { id: 'a_taka', kind: 'area', en: 'Takashimaya Osaka', ja: '高島屋 大阪店', sub: 'Department store · food hall B1', level: 'B1', x: -30, z: -170, keys: ['takashimaya', 'department', 'depachika', '高島屋'] },
  { id: 'a_dotonbori', kind: 'area', en: 'Dotonbori', ja: '道頓堀', sub: 'Canal-side food street · approx. 500 m north via Exit 18', level: '1F', x: 43, z: -255, keys: ['dotonbori', 'glico', '道頓堀'], offmap: true },
];

export class MapApp {
  constructor(phone, root) {
    this.phone = phone; this.ctx = phone.ctx; this.pos = phone.pos;
    this.root = root;
    this.view = { cx: 0, cz: 0, zoom: 2.6, rot: 0, level: '3F' };
    this.follow = true; this.headingUp = false;
    this.base = new Map();
    this.selected = null; this.results = []; this.route = null;
    this.sheet = 'home';
    this._dirty = true;
    this._build();
    this._labelsFor = new Map();
  }

  // ---------------------------------------------------------------- DOM ----
  _build() {
    const r = this.root;
    r.classList.add('mp');
    r.innerHTML = `
      <canvas class="mp-canvas"></canvas>
      <div class="mp-top">
        <div class="mp-search"><svg viewBox="0 0 24 24" class="mp-s-ico"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg>
          <input type="text" placeholder="Search Namba" spellcheck="false" autocomplete="off"><button class="mp-clear" hidden>×</button><span class="mp-avatar">T</span></div>
        <div class="mp-chips">${CHIPS.map(([q, ic, t]) => `<button data-q="${q}"><span class="${ic === 'M' ? 'mp-chip-m' : ''}">${ic}</span>${t}</button>`).join('')}</div>
        <div class="mp-sugg" hidden></div>
      </div>
      <div class="mp-banner" hidden></div>
      <div class="mp-gpswarn" hidden></div>
      <div class="mp-compass-cal" hidden><div class="mp-cc-8"><i></i></div><div><b>Compass needs calibration</b><small>Move your phone in a figure 8</small></div></div>
      <div class="mp-floorchip"></div>
      <div class="mp-ctrls">
        <div class="mp-floors"></div>
        <button class="mp-btn mp-compass" title="Compass"><svg viewBox="0 0 24 24"><path d="M12 3 15 12H9z" fill="#e5322d"/><path d="M12 21 9 12h6z" fill="#9aa0a8"/></svg></button>
        <button class="mp-btn mp-locate" title="My location"><svg viewBox="0 0 24 24"><path d="M3 11 21 3l-8 18-2-8z"/></svg></button>
      </div>
      <div class="mp-scale"><i></i><span></span></div>
      <div class="mp-sheet"><div class="mp-grab"></div><div class="mp-sheet-in"></div></div>`;
    this.canvas = r.querySelector('canvas');
    this.g = this.canvas.getContext('2d');
    this.input = r.querySelector('input');
    this.sugg = r.querySelector('.mp-sugg');
    this.sheetEl = r.querySelector('.mp-sheet'); this.sheetIn = r.querySelector('.mp-sheet-in');
    this.banner = r.querySelector('.mp-banner');
    this.floorsEl = r.querySelector('.mp-floors');
    this.floorChip = r.querySelector('.mp-floorchip');
    this.warnEl = r.querySelector('.mp-gpswarn'); this.calEl = r.querySelector('.mp-compass-cal');
    this.compassBtn = r.querySelector('.mp-compass');
    this.scaleEl = r.querySelector('.mp-scale');
    const clr = r.querySelector('.mp-clear');
    // search
    this.input.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') { this.doSearch(this.input.value); this.input.blur(); }
      if (e.key === 'Escape') { this.input.blur(); this._hideSugg(); }
    });
    this.input.addEventListener('keyup', e => e.stopPropagation());
    this.input.addEventListener('input', () => { clr.hidden = !this.input.value; this._suggest(this.input.value); });
    this.input.addEventListener('focus', () => { this.phone.typing = true; this._suggest(this.input.value); });
    this.input.addEventListener('blur', () => { this.phone.typing = false; setTimeout(() => this._hideSugg(), 150); });
    clr.addEventListener('click', () => { this.input.value = ''; clr.hidden = true; this.clearSearch(); });
    r.querySelectorAll('.mp-chips button').forEach(b => b.addEventListener('click', () => { this.input.value = b.querySelector('span').nextSibling.textContent; clr.hidden = false; this.doSearch(b.dataset.q); }));
    // controls
    this.compassBtn.addEventListener('click', () => { this.headingUp = !this.headingUp; if (!this.headingUp) this.view.rot = 0; this.follow = true; this._dirty = true; });
    r.querySelector('.mp-locate').addEventListener('click', () => { this.follow = true; this.view.level = this.pos.level; this.view.zoom = Math.max(this.view.zoom, 2.4); this._dirty = true; this._renderFloors(); });
    r.querySelector('.mp-grab').addEventListener('click', () => { this.sheetEl.classList.toggle('mp-full'); });
    this._pointer();
    this._renderFloors();
    this.showHome();
  }

  _renderFloors() {
    const lv = LEVEL_ORDER.filter(l => this.ctx.world.grids[l]).slice().reverse();
    this.floorsEl.innerHTML = lv.map(l => `<button data-l="${l}" class="${l === this.view.level ? 'on' : ''} ${l === this.pos.level ? 'me' : ''}">${LEVELS[l].label.replace('B1F', 'B1').replace('B2F', 'B2')}</button>`).join('');
    this.floorsEl.querySelectorAll('button').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); this.view.level = b.dataset.l; this.follow = false; this._dirty = true; this._renderFloors(); }));
    // scroll the selected floor into view (the picker is short)
    const on = this.floorsEl.querySelector('.on');
    if (on) this.floorsEl.scrollTop = on.offsetTop - 40;
  }

  // ------------------------------------------------------------ pointer ----
  _pointer() {
    const c = this.canvas;
    const pts = new Map();
    let last = null, moved = 0, pinch = null;
    c.addEventListener('pointerdown', e => {
      c.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved = 0; last = { x: e.clientX, y: e.clientY };
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: this.view.zoom }; }
      e.stopPropagation();
    });
    c.addEventListener('pointermove', e => {
      if (!pts.has(e.pointerId)) return;
      const p = pts.get(e.pointerId);
      const s = this._cssScale();
      if (pts.size === 2 && pinch) {
        p.x = e.clientX; p.y = e.clientY;
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        this.view.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, pinch.z * d / Math.max(1, pinch.d)));
        this._dirty = true; moved += 10; return;
      }
      const dx = (e.clientX - p.x) / s, dy = (e.clientY - p.y) / s;
      p.x = e.clientX; p.y = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      if (moved > 4) {
        this.follow = false;
        const k = this.view.zoom, cr = Math.cos(this.view.rot), sr = Math.sin(this.view.rot);
        // screen delta -> world delta (inverse rotation)
        this.view.cx -= (dx * cr + dy * sr) / k; this.view.cz -= (-dx * sr + dy * cr) / k;
        this._dirty = true;
      }
    });
    const up = e => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (moved < 5 && pts.size === 0) this._tap(e);
    };
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', e => {
      e.preventDefault(); e.stopPropagation();
      const rect = c.getBoundingClientRect(), s = this._cssScale();
      const sx = (e.clientX - rect.left) / s, sy = (e.clientY - rect.top) / s;
      const before = this.toWorld(sx, sy);
      const f = Math.exp(-e.deltaY * 0.0016);
      this.view.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.view.zoom * f));
      const after = this.toWorld(sx, sy);
      this.view.cx += before[0] - after[0]; this.view.cz += before[1] - after[1];
      if (this.follow && Math.hypot(before[0] - after[0], before[1] - after[1]) > 0.5) this.follow = false;
      this._dirty = true;
    }, { passive: false });
  }
  // ratio between CSS px of the canvas element and its on-screen size (phone is scaled)
  _cssScale() { const r = this.canvas.getBoundingClientRect(); return r.width / (this.canvas.clientWidth || r.width) || 1; }

  _tap(e) {
    const rect = this.canvas.getBoundingClientRect(), s = this._cssScale();
    const sx = (e.clientX - rect.left) / s, sy = (e.clientY - rect.top) / s;
    let best = null, bd = 22;
    for (const L of this._hits || []) { const d = Math.hypot(L.x - sx, L.y - sy); if (d < bd) { bd = d; best = L; } }
    if (best) this.select(best.place);
  }

  // ------------------------------------------------------------- view -----
  get W() { return this.canvas.clientWidth || 300; }
  get H() { return this.canvas.clientHeight || 600; }
  _anchor() { return [this.W / 2, this.H * (this.sheet === 'home' ? 0.46 : 0.36)]; }
  toScreen(x, z) {
    const v = this.view, k = v.zoom, c = Math.cos(v.rot), s = Math.sin(v.rot);
    const dx = x - v.cx, dz = z - v.cz;
    const [ax, ay] = this._anchor();
    return [ax + k * (c * dx - s * dz), ay + k * (s * dx + c * dz)];
  }
  toWorld(sx, sy) {
    const v = this.view, k = v.zoom, c = Math.cos(v.rot), s = Math.sin(v.rot);
    const [ax, ay] = this._anchor();
    const px = (sx - ax) / k, py = (sy - ay) / k;
    return [v.cx + c * px + s * py, v.cz - s * px + c * py];
  }

  _baseFor(level) {
    let b = this.base.get(level);
    if (b) return b;
    const grid = this.ctx.world.grids[level]; if (!grid) return null;
    const ppm = this.phone.lowQ ? 3 : BASE_PPM;
    const c = document.createElement('canvas');
    c.width = Math.ceil(grid.w * ppm); c.height = Math.ceil(grid.h * ppm);
    const g = c.getContext('2d');
    g.setTransform(ppm, 0, 0, ppm, -grid.x0 * ppm, -grid.z0 * ppm);
    drawFloor(g, this.ctx.world, level, THEMES.phone, { businessBySlot });
    b = { canvas: c, x0: grid.x0, z0: grid.z0, w: grid.w, h: grid.h, ppm };
    this.base.set(level, b);
    return b;
  }

  // ------------------------------------------------------------- update ----
  update(dt, visible) {
    const p = this.pos;
    if (this.follow) {
      const k = 1 - Math.exp(-dt / 0.25);
      this.view.cx += (p.x - this.view.cx) * k; this.view.cz += (p.z - this.view.cz) * k;
      if (this.view.level !== p.level) { this.view.level = p.level; this._renderFloors(); }
    }
    if (this.headingUp) {
      let d = p.heading - this.view.rot; d = Math.atan2(Math.sin(d), Math.cos(d));
      this.view.rot += d * (1 - Math.exp(-dt / 0.35));
    }
    if (this._lastMe !== p.level) { this._lastMe = p.level; this._renderFloors(); this._onBelievedFloor(); }
    // route upkeep
    if (this.route) this._routeTick(dt);
    this._nag(dt);
    if (!visible) return;
    this._t = (this._t || 0) + dt;
    this._draw();
  }

  // ------------------------------------------------------------- draw -----
  _draw() {
    const c = this.canvas, g = this.g;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = this.W, H = this.H;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const v = this.view, T = THEMES.phone;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = T.bg; g.fillRect(0, 0, c.width, c.height);
    // world transform
    const k = v.zoom * dpr, cs = Math.cos(v.rot), sn = Math.sin(v.rot);
    const [axp, ayp] = this._anchor();
    const a = k * cs, b = k * sn, cc = -k * sn, d = k * cs;
    g.setTransform(a, b, cc, d, axp * dpr - (a * v.cx + cc * v.cz), ayp * dpr - (b * v.cx + d * v.cz));
    // city blocks outside + roads
    g.fillStyle = '#e4e1d9'; g.fillRect(-400, -500, 900, 1100);
    drawRoads(g, T, 1);
    // complex footprint (all floors) faintly — the building outline
    if (!this._foot) this._foot = this._footprint();
    g.fillStyle = '#dcd8cf'; for (const r of this._foot) g.fillRect(r[0], r[1], r[2] - r[0], r[3] - r[1]);
    // base layer
    const base = this._baseFor(v.level);
    const vis = this._visibleBounds();
    if (base) {
      if (k > base.ppm * 1.35) drawFloor(g, this.ctx.world, v.level, T, { bounds: vis, businessBySlot, _spaceCol: this._spaceCol || (this._spaceCol = new Map()) });
      else { g.imageSmoothingEnabled = true; g.drawImage(base.canvas, base.x0, base.z0, base.w, base.h); }
    }
    // route
    if (this.route && this.route.leg && this.route.leg.level === v.level) this._drawRoute(g, k);
    // screen-space overlays
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._hits = [];
    this._drawLabels(g, vis);
    this._drawPins(g);
    this._drawMe(g);
    // compass & scale
    this.compassBtn.style.transform = `rotate(${v.rot}rad)`;
    this.compassBtn.classList.toggle('on', this.headingUp);
    const m = [5, 10, 20, 50, 100, 200, 500].find(m => m * v.zoom > 40) || 500;
    this.scaleEl.querySelector('i').style.width = `${m * v.zoom}px`;
    this.scaleEl.querySelector('span').textContent = `${m} m`;
    // floor chip
    const me = this.pos.level;
    const sp = this.ctx.world.spaceAt(me, this.pos.x, this.pos.z);
    const z = sp && ZONES[sp.zone];
    this.floorChip.innerHTML = v.level === me
      ? `<b>${LEVELS[me].label}</b> ${esc(z ? z.name : 'Namba')}`
      : `Viewing <b>${LEVELS[v.level].label}</b> · you: ${LEVELS[me].label}`;
    this.floorChip.classList.toggle('other', v.level !== me);
  }

  _footprint() {
    const out = [];
    for (const s of LAYOUT.spaces) { if (s.rect && !s.outdoor) out.push(s.rect); }
    return out;
  }
  _visibleBounds() {
    const pts = [[0, 0], [this.W, 0], [0, this.H], [this.W, this.H]].map(([x, y]) => this.toWorld(x, y));
    const xs = pts.map(p => p[0]), zs = pts.map(p => p[1]);
    return [Math.min(...xs) - 2, Math.min(...zs) - 2, Math.max(...xs) + 2, Math.max(...zs) + 2];
  }

  _levelLabels(level) {
    let L = this._labelsFor.get(level);
    if (L) return L;
    L = { zones: [], biz: [], ramps: [], exits: [], fac: [], gates: [], plats: [], roads: [] };
    // zone centroids
    const acc = {};
    for (const s of LAYOUT.spaces) {
      if (s.level !== level || s.kind === 'room' || !s.rect) continue;
      const [x0, z0, x1, z1] = s.rect, a = (x1 - x0) * (z1 - z0);
      const o = acc[s.zone] || (acc[s.zone] = { x: 0, z: 0, a: 0 });
      o.x += (x0 + x1) / 2 * a; o.z += (z0 + z1) / 2 * a; o.a += a;
    }
    for (const zk in acc) { const o = acc[zk]; const Z = ZONES[zk]; if (Z && o.a > 300 && zk !== 'street') L.zones.push({ x: o.x / o.a, z: o.z / o.a, en: Z.name, ja: Z.ja, zone: zk }); }
    for (const b of BUSINESSES) if (b.level === level) L.biz.push(this._view(b));
    for (const r of LAYOUT.ramps) if (r.lower === level || r.upper === level) L.ramps.push(r);
    for (const ex of LAYOUT.exits) {
      const info = EXIT_INFO[ex.id]; if (!info) continue;
      const r = LAYOUT.ramps.find(q => q.id === info.ramp);
      if (r && r.lower === level) { const E = rampEnds(r); L.exits.push({ x: E.low.x, z: E.low.z, no: info.no }); }
      if (ex.level === level) L.exits.push({ x: ex.x, z: ex.z, no: info.no, top: true });
    }
    for (const f of FACILITIES) if (f.level === level && !f.skip) L.fac.push(f);
    for (const gt of LAYOUT.gates) if (gt.level === level) L.gates.push(gt);
    for (const t of LAYOUT.tracks) if (t.level === level) L.plats.push(t);
    this._labelsFor.set(level, L);
    return L;
  }

  _drawLabels(g, vis) {
    const v = this.view, k = v.zoom;
    const L = this._levelLabels(v.level);
    const boxes = [];
    const free = (x, y, w, h) => { for (const b of boxes) if (x < b[0] + b[2] && x + w > b[0] && y < b[1] + b[3] && y + h > b[1]) return false; boxes.push([x, y, w, h]); return true; };
    const inView = (x, y) => x > -30 && x < this.W + 30 && y > -30 && y < this.H + 30;
    g.textBaseline = 'middle';
    // road names
    for (const r of ROADS) {
      const [x0, z0, x1, z1] = r.rect;
      const along = r.axis === 'x';
      const mid = along ? [Math.max(vis[0] + 20, Math.min(vis[2] - 20, (x0 + x1) / 2)), (z0 + z1) / 2] : [(x0 + x1) / 2, Math.max(vis[1] + 20, Math.min(vis[3] - 20, (z0 + z1) / 2))];
      const [sx, sy] = this.toScreen(mid[0], mid[1]);
      if (!inView(sx, sy)) continue;
      g.save(); g.translate(sx, sy);
      let ang = (along ? 0 : Math.PI / 2) + v.rot; if (Math.cos(ang) < 0) ang += Math.PI;
      g.rotate(ang);
      g.font = '600 11px Inter, "Noto Sans JP", sans-serif'; g.textAlign = 'center';
      g.lineWidth = 3; g.strokeStyle = '#ffffff'; g.fillStyle = '#8c8577';
      const t = `${r.en}  ${r.ja}`; g.strokeText(t, 0, 0); g.fillText(t, 0, 0);
      g.restore();
    }
    // platforms / lines
    for (const t of L.plats) {
      if (k < 0.8) break;
      const [x0, z0, x1, z1] = t.rect;
      const [sx, sy] = this.toScreen((x0 + x1) / 2, (z0 + z1) / 2);
      if (!inView(sx, sy) || t.line === 'nankai' && t.no % 2 === 0) continue;
      const Lc = LINES[t.line];
      const txt = t.line === 'nankai' ? `${t.no}` : `${t.no}`;
      g.fillStyle = Lc.color; g.beginPath(); g.arc(sx, sy, 7, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#fff'; g.font = '700 9px Inter'; g.textAlign = 'center'; g.fillText(txt, sx, sy + 0.5);
    }
    // gates
    for (const gt of L.gates) {
      const x = gt.axis === 'x' ? (gt.from + gt.to) / 2 : gt.at, z = gt.axis === 'x' ? gt.at : (gt.from + gt.to) / 2;
      const [sx, sy] = this.toScreen(x, z);
      if (!inView(sx, sy) || k < 0.9) continue;
      this._pill(g, sx, sy - 14, `改札 ${gt.name}`, '#4a5361', '#fff', 10, boxes);
    }
    // exits
    for (const e of L.exits) {
      const [sx, sy] = this.toScreen(e.x, e.z);
      if (!inView(sx, sy)) continue;
      const w = 10 + e.no.length * 7;
      g.fillStyle = '#ffd400'; g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1;
      this._rr(g, sx - w / 2, sy - 8, w, 16, 3); g.fill(); g.stroke();
      g.fillStyle = '#111'; g.font = '800 11px Inter'; g.textAlign = 'center'; g.fillText(e.no, sx, sy + 0.5);
      boxes.push([sx - w / 2, sy - 8, w, 16]);
      this._hits.push({ x: sx, y: sy, place: this._exitPlace(e.no) });
    }
    // escalators
    if (k > 1.1) for (const r of L.ramps) {
      const [sx, sy] = this.toScreen((r.rect[0] + r.rect[2]) / 2, (r.rect[1] + r.rect[3]) / 2);
      if (!inView(sx, sy)) continue;
      if (r.bank && r.id !== r.bank + '_0') continue;
      g.fillStyle = '#3d6fb6'; this._rr(g, sx - 8, sy - 8, 16, 16, 4); g.fill();
      g.strokeStyle = '#fff'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(sx - 5, sy + 4); g.lineTo(sx - 2, sy + 4); g.lineTo(sx + 3, sy - 3); g.lineTo(sx + 5, sy - 3); g.stroke();
      const other = r.lower === v.level ? r.upper : r.lower;
      if (k > 2.2) this._pill(g, sx + 18, sy, `${r.lower === v.level ? '▲' : '▼'} ${LEVELS[other].label}`, 'rgba(255,255,255,0.92)', '#3d6fb6', 9, null);
    }
    // facilities
    for (const f of L.fac) {
      const [sx, sy] = this.toScreen(f.x + f.nx * 1.2, f.z + f.nz * 1.2);
      if (!inView(sx, sy) || k < 1.0) continue;
      g.fillStyle = f.kind === 'toilet' ? '#2b6cb0' : '#5a6372'; g.beginPath(); g.arc(sx, sy, 8, 0, Math.PI * 2); g.fill();
      g.font = '10px "Noto Color Emoji", sans-serif'; g.textAlign = 'center'; g.fillText(f.kind === 'toilet' ? '🚻' : f.kind === 'locker' ? '🔑' : '🚕', sx, sy + 1);
      boxes.push([sx - 8, sy - 8, 16, 16]);
      this._hits.push({ x: sx, y: sy, place: this._facPlace(f) });
    }
    // businesses
    const showNames = k >= 2.3, showIcons = k >= 1.15;
    const sorted = L.biz.slice().sort((a, b) => Math.log10(b.reviews + 10) - Math.log10(a.reviews + 10));
    for (const b of sorted) {
      if (!showIcons) continue;
      const [sx, sy] = this.toScreen(b.px, b.pz);
      if (!inView(sx, sy)) continue;
      const grp = catGroup(b.cat);
      const col = { food: '#f08a3c', cafe: '#b8713a', retail: '#8b6fd1', service: '#3a8bd1', closed: '#9b9b9b' }[grp];
      const sel = this.selected && this.selected.b && this.selected.b.slot === b.slot;
      if (!free(sx - 9, sy - 9, 18, 18) && !sel) continue;
      g.fillStyle = col; g.beginPath(); g.arc(sx, sy, sel ? 11 : 8.5, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.stroke();
      g.font = `${sel ? 12 : 10}px "Noto Color Emoji", "Apple Color Emoji", sans-serif`; g.textAlign = 'center'; g.fillText(b.info.icon, sx, sy + 1);
      this._hits.push({ x: sx, y: sy, place: this._bizPlace(b) });
      if (showNames) {
        const name = k > 4.5 ? `${b.en}` : b.en;
        g.font = `500 11px Inter, "Noto Sans JP", sans-serif`;
        const w = g.measureText(name).width;
        if (free(sx + 11, sy - 7, w + 4, 14)) {
          g.textAlign = 'left'; g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,0.95)'; g.strokeText(name, sx + 12, sy);
          g.fillStyle = grp === 'closed' ? '#999' : '#3c3a36'; g.fillText(name, sx + 12, sy);
          if (k > 5 && b.ja && free(sx + 11, sy + 6, w, 12)) { g.font = '500 9px "Noto Sans JP", sans-serif'; g.strokeText(b.ja, sx + 12, sy + 12); g.fillStyle = '#7b766d'; g.fillText(b.ja, sx + 12, sy + 12); }
        }
      }
    }
    // zone names (big, low zoom)
    for (const zl of L.zones) {
      if (k > 3.2) break;
      const [sx, sy] = this.toScreen(zl.x, zl.z);
      if (!inView(sx, sy)) continue;
      g.font = '700 12px Inter, "Noto Sans JP", sans-serif'; g.textAlign = 'center';
      const w = g.measureText(zl.en).width;
      if (!free(sx - w / 2, sy - 8, w, 26)) continue;
      g.lineWidth = 3.5; g.strokeStyle = 'rgba(255,255,255,0.95)'; g.strokeText(zl.en, sx, sy);
      g.fillStyle = ZONES[zl.zone].color; g.fillText(zl.en, sx, sy);
      g.font = '500 10px "Noto Sans JP", sans-serif'; g.strokeText(zl.ja, sx, sy + 13); g.fillStyle = '#6f6a62'; g.fillText(zl.ja, sx, sy + 13);
    }
  }
  _rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  _pill(g, x, y, t, bg, fg, size, boxes) {
    g.font = `600 ${size}px Inter, "Noto Sans JP", sans-serif`;
    const w = g.measureText(t).width + 10, h = size + 7;
    if (boxes) { for (const b of boxes) if (x - w / 2 < b[0] + b[2] && x + w / 2 > b[0] && y - h / 2 < b[1] + b[3] && y + h / 2 > b[1]) return; boxes.push([x - w / 2, y - h / 2, w, h]); }
    g.fillStyle = bg; this._rr(g, x - w / 2, y - h / 2, w, h, h / 2); g.fill();
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, x, y + 0.5);
  }

  _drawPins(g) {
    const v = this.view;
    const pin = (p, main) => {
      const [sx, sy] = this.toScreen(p.x, p.z);
      const other = p.level !== v.level;
      g.save();
      g.globalAlpha = other ? 0.5 : 1;
      const s = main ? 1 : 0.62;
      g.translate(sx, sy);
      g.fillStyle = 'rgba(0,0,0,0.2)'; g.beginPath(); g.ellipse(0, 1, 6 * s, 2.5 * s, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = main ? '#e5322d' : '#d4534e';
      g.beginPath(); g.moveTo(0, 0); g.bezierCurveTo(-4 * s, -10 * s, -13 * s, -16 * s, -13 * s, -25 * s); g.arc(0, -25 * s, 13 * s, Math.PI, 0); g.bezierCurveTo(13 * s, -16 * s, 4 * s, -10 * s, 0, 0); g.fill();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(0, -25 * s, 5 * s, 0, Math.PI * 2); g.fill();
      if (other) {
        g.globalAlpha = 1;
        const t = LEVELS[p.level].label;
        g.font = '800 10px Inter'; const w = g.measureText(t).width + 9;
        g.fillStyle = '#1c2a3a'; this._rr(g, 9 * s, -40 * s - 7, w, 15, 4); g.fill();
        g.fillStyle = '#fff'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(t, 9 * s + 4.5, -40 * s + 0.5);
      }
      g.restore();
      this._hits.push({ x: sx, y: sy - 25 * s, place: p });
    };
    if (this.sheet === 'results') for (const r of this.results.slice(0, 12)) if (r !== this.selected) pin(r, false);
    if (this.selected) pin(this.selected, true);
  }

  _drawMe(g) {
    const p = this.pos, v = this.view;
    const [sx, sy] = this.toScreen(p.x, p.z);
    const same = p.level === v.level;
    g.save();
    if (same) {
      const r = Math.max(10, p.acc * v.zoom);
      g.fillStyle = 'rgba(26,115,232,0.13)'; g.strokeStyle = 'rgba(26,115,232,0.35)'; g.lineWidth = 1;
      g.beginPath(); g.arc(sx, sy, r, 0, Math.PI * 2); g.fill(); g.stroke();
      // heading cone (map rotation aware): heading yaw -> screen angle
      const ang = -(p.heading - v.rot) - Math.PI / 2; // yaw 0 = up
      const spread = 0.55 + (p.env === 'outdoor' ? 0 : 0.25);
      const gr = g.createRadialGradient(sx, sy, 2, sx, sy, 44);
      gr.addColorStop(0, 'rgba(26,115,232,0.55)'); gr.addColorStop(1, 'rgba(26,115,232,0)');
      g.fillStyle = gr; g.beginPath(); g.moveTo(sx, sy); g.arc(sx, sy, 44, ang - spread, ang + spread); g.closePath(); g.fill();
    }
    g.shadowColor = 'rgba(0,0,0,0.3)'; g.shadowBlur = 4;
    g.fillStyle = '#fff'; g.beginPath(); g.arc(sx, sy, 8.5, 0, Math.PI * 2); g.fill();
    g.shadowBlur = 0;
    g.fillStyle = same ? '#1a73e8' : '#9aa3ad';
    const pulse = 6 + Math.sin((this._t || 0) * 3) * 0.6;
    g.beginPath(); g.arc(sx, sy, pulse, 0, Math.PI * 2); g.fill();
    g.restore();
  }

  _drawRoute(g, k) {
    const leg = this.route.leg;
    const pts = leg.draw;
    if (!pts || pts.length < 2) return;
    g.lineJoin = 'round'; g.lineCap = 'round';
    g.strokeStyle = '#ffffff'; g.lineWidth = 9 / k * Math.min(2, window.devicePixelRatio || 1);
    g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (const p of pts) g.lineTo(p[0], p[1]); g.stroke();
    g.strokeStyle = '#1a73e8'; g.lineWidth = 6 / k * Math.min(2, window.devicePixelRatio || 1);
    g.stroke();
    // dotted "as the crow flies" hint from leg end to the destination
    const t = this.route.target;
    if (this.route.legs.length > 1 && t) {
      const e = pts[pts.length - 1];
      g.setLineDash([2 / k * 3, 6 / k * 2]); g.strokeStyle = 'rgba(90,100,115,0.6)'; g.lineWidth = 3 / k * 2;
      g.beginPath(); g.moveTo(e[0], e[1]); g.lineTo(t.x, t.z); g.stroke(); g.setLineDash([]);
    }
  }

  // ------------------------------------------------------------ search ----
  // What the maps app *lists* is not what the directory knows: tiny places have
  // few reviews and a Japanese-only name; many small underground shops are
  // pinned some metres off (the listing was geocoded from a street address).
  _view(b) {
    const c = this._views || (this._views = new Map());
    let v = c.get(b.slot); if (v) return v;
    v = { ...b, raw: b };
    const ov = LISTING[b.key];
    if (ov) Object.assign(v, ov);
    if (ov && ov.jaOnly) { v.en = b.ja; v.ja = ''; }
    // pin position: the shop door, or a geocoding error for small underground places
    let px = b.door ? b.door.ox : b.x, pz = b.door ? b.door.oz : b.z;
    const h = hash('pin:' + b.slot) % 100;
    const fuzz = ov ? ov.fuzz : (b.level === 'B1' || b.level === 'B2') && h < 30 ? 9 + (h % 7) : 0;
    if (fuzz && this.ctx.nav) {
      const a0 = (hash('ang:' + b.slot) % 628) / 100;
      for (let r = fuzz; r >= 5 && (px === (b.door ? b.door.ox : b.x)); r -= 2) for (let k = 0; k < 8; k++) {
        const a = a0 + k * Math.PI / 4, tx = px + Math.cos(a) * r, tz = pz + Math.sin(a) * r;
        const n = this.ctx.nav.nodeAtPoint(b.level, tx, tz);
        if (n >= 0 && this.ctx.nav.nodeLevel(n) === b.level && Math.hypot(this.ctx.nav.x[n] - px, this.ctx.nav.z[n] - pz) > r * 0.6) { px = this.ctx.nav.x[n]; pz = this.ctx.nav.z[n]; break; }
      }
    }
    v.px = px; v.pz = pz;
    c.set(b.slot, v);
    return v;
  }
  _bizPlace(b) {
    b = b.raw ? b : this._view(b);
    return { id: 'b:' + b.slot, kind: 'biz', b, en: b.en, ja: b.ja, level: b.level, x: b.px, z: b.pz, sub: `${CATEGORIES[b.cat].en} · ${ZONES[b.zone] ? ZONES[b.zone].name : ''}` };
  }
  _facPlace(f) {
    const I = FACILITY_INFO[f.kind];
    return { id: 'f:' + f.id, kind: 'fac', fac: f, en: I.en, ja: I.ja, level: f.level, x: f.x + f.nx * 1.5, z: f.z + f.nz * 1.5, sub: `${I.en} · ${LEVELS[f.level].label}`, icon: f.kind === 'toilet' ? '🚻' : f.kind === 'locker' ? '🔑' : '🚕' };
  }
  _exitPlace(no) {
    const ex = LAYOUT.exits.find(e => EXIT_INFO[e.id] && EXIT_INFO[e.id].no === no);
    const info = EXIT_INFO[ex.id];
    return { id: 'x:' + no, kind: 'exit', en: `Exit ${no}`, ja: `${no}番出口`, level: ex.level, x: ex.x, z: ex.z, sub: info.to.map(t => t[1]).join(' · '), exitNo: no };
  }
  _transitPlace(t) { return { id: 't:' + t.id, kind: 'transit', t, en: t.en, ja: t.ja, level: t.at[0], x: t.at[1], z: t.at[2], sub: t.sub, line: t.line }; }

  search(q) {
    q = (q || '').trim().toLowerCase();
    if (!q) return [];
    const out = [];
    for (const t of TRANSIT_PLACES) if (t.keys.some(k => k.includes(q) || (q.length > 3 && q.includes(k))) || t.en.toLowerCase().includes(q) || t.ja.includes(q)) out.push(this._transitPlace(t));
    for (const a of AREA_PLACES) if (a.keys.some(k => k.includes(q) || q.includes(k)) || a.en.toLowerCase().includes(q)) out.push({ ...a, id: a.id });
    if (/toilet|restroom|wc|bathroom|トイレ|お手洗/.test(q)) for (const f of FACILITIES) if (f.kind === 'toilet' && !f.skip) out.push(this._facPlace(f));
    if (/locker|ロッカー|luggage/.test(q)) for (const f of FACILITIES) if (f.kind === 'locker' && !f.skip) out.push(this._facPlace(f));
    if (/taxi|タクシー/.test(q)) for (const f of FACILITIES) if (f.kind === 'taxi') out.push(this._facPlace(f));
    const m = q.match(/(?:exit|出口)\s*(\d+)/) || (/^\d{1,2}$/.test(q) ? [q, q] : null);
    if (m || /^exit|出口/.test(q)) for (const ex of LAYOUT.exits) { const info = EXIT_INFO[ex.id]; if (info && (!m || info.no === m[1])) out.push(this._exitPlace(info.no)); }
    const biz = searchBusinesses(q).filter(b => b.cat !== 'closed' || q.length > 4).map(b => this._view(b));
    const mins = this.ctx.clock.minutes;
    // like every maps app: open now, then popularity (reviews, rating), then (crow-flies) nearness
    const sc = (b) => (isOpen(b, mins) ? 2 : 0) + Math.log10(b.reviews + 10) * 1.3 + b.rating * 0.45 - Math.hypot(b.px - this.pos.x, b.pz - this.pos.z) / 600;
    biz.sort((a, b) => sc(b) - sc(a));
    for (const b of biz.slice(0, 30)) out.push(this._bizPlace(b));
    return out;
  }
  _crow(p) { return Math.hypot(p.x - this.pos.x, p.z - this.pos.z); }

  _suggest(q) {
    if (!q || !q.trim()) {
      this.sugg.innerHTML = `<div class="mp-sugg-h">Recent</div>` + ['coffee', 'tempura', 'Midosuji Line', 'Shin-Osaka'].map(s => `<div class="mp-sugg-i" data-q="${s}"><span class="mp-sugg-ic">🕘</span>${s}</div>`).join('');
    } else {
      const res = this.search(q).slice(0, 6);
      this.sugg.innerHTML = `<div class="mp-sugg-i" data-q="${esc(q)}"><span class="mp-sugg-ic">⌕</span>Search “${esc(q)}”</div>` +
        res.map((r, i) => `<div class="mp-sugg-i" data-i="${i}"><span class="mp-sugg-ic">${this._iconHtml(r)}</span><span><b>${esc(r.en)}</b><small>${esc(r.ja || '')} · ${LEVELS[r.level].label} · ${fmtDist(this._crow(r))}</small></span></div>`).join('');
      this._suggRes = res;
    }
    this.sugg.hidden = false;
    this.sugg.querySelectorAll('.mp-sugg-i').forEach(el => el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (el.dataset.i != null) { const r = this._suggRes[+el.dataset.i]; this.input.value = r.en; this.input.blur(); this.results = [r]; this.select(r); }
      else { this.input.value = el.dataset.q; this.input.blur(); this.doSearch(el.dataset.q); }
    }));
  }
  _hideSugg() { this.sugg.hidden = true; }

  _iconHtml(r) {
    if (r.kind === 'transit') { const L = LINES[r.line]; return `<i class="mp-lb ${L.shape}" style="--c:${L.color}">${L.letter}</i>`; }
    if (r.kind === 'biz') return `<i class="mp-ic ${catGroup(r.b.cat)}">${r.b.info.icon}</i>`;
    if (r.kind === 'exit') return `<i class="mp-ex">${r.exitNo}</i>`;
    if (r.kind === 'fac') return `<i class="mp-ic service">${r.icon}</i>`;
    return `<i class="mp-ic area">📍</i>`;
  }

  doSearch(q) {
    this._hideSugg();
    this.results = this.search(q);
    this.query = q;
    this.selected = null;
    this.showResults();
    this.ctx.events.emit('phone:search', { query: q, count: this.results.length });
  }
  clearSearch() { this.results = []; this.selected = null; if (this.route) this._routeSheet(); else this.showHome(); }

  // ------------------------------------------------------------- sheets ----
  _setSheet(name, html, full) {
    this.sheet = name;
    this.sheetIn.innerHTML = html;
    this.sheetEl.className = `mp-sheet mp-${name}${full ? ' mp-full' : ''}`;
    this.sheetIn.scrollTop = 0;
  }
  _accTxt() { const p = this.pos; return p.acc < 6 ? 'High accuracy' : p.acc < 12 ? 'Approximate location' : 'Low accuracy — indoor'; }
  // v4: the home sheet is the "Where to?" list (Aya's pick on top, the places Maps offers up front, category chips).
  // Nothing routes until the player picks (row click, 1–9, ↑↓ Enter).
  showHome() {
    const p = this.pos, D = this.phone.dest, arr = D && D.current && D.current.arrived ? D.current : null;
    const sp = this.ctx.world.spaceAt(p.level, p.x, p.z);
    const z = sp && ZONES[sp.zone];
    this._setSheet('home', `
      <div class="mp-home">${arr ? `<div class="mp-arr"><i>✓</i><div><b>Arrived · ${esc(arr.name)}</b><small>${LEVELS[arr.level].label} · ${esc(zoneShort(arr.zone) || '')}</small></div></div>` : `<div class="mp-here"><i class="mp-here-dot"></i><div><b class="mp-home-t">${esc(z ? z.name : 'Namba')}</b>
      <small class="mp-home-s">${LEVELS[p.level].label} · ${this._accTxt()} (±${Math.round(p.acc)} m)</small></div></div>`}
      <div class="mp-dl"></div></div>`, true);
    this._homeEl = this.sheetIn.querySelector('.mp-home');
    this.list = new DestList(this._homeEl.querySelector('.mp-dl'), {
      theme: 'maps', chips: true, title: arr ? 'Where next?' : 'Where to?',
      onPick: (it) => this._pickItem(it), onQuery: (q) => { if (q) { this.input.value = q.replace(/^\w/, c => c.toUpperCase()); this.doSearch(q); } },
    });
    this.list.touch = this.phone.ctx.input && this.phone.ctx.input.touch;
    this._renderHomeList();
    this._refreshHome();
  }
  _renderHomeList() {
    if (this.sheet !== 'home' || !this.list) return;
    const D = this.phone.dest, sug = D ? D.suggested : null, cur = D && D.current;
    const ids = defaultIds(sug && !(cur && cur.arrived && cur.id === sug) ? sug : null, cur && cur.arrived ? cur.id : null);
    const items = ids.map(id => this._itemFor(id, id === sug ? (cur && cur.arrived ? 'Next · from Aya' : 'From Aya') : null)).filter(Boolean);
    this.list.render(items);
    this.list.setTitle(null, sug ? '' : '');
  }
  // a list row for a destination id (Maps: crow-flies distance from where the PHONE thinks you are)
  _itemFor(id, aya) {
    const p = this.placeById(id); if (!p) return null;
    const mins = this.ctx.clock.minutes;
    if (p.kind === 'biz') {
      const b = p.b, s = bizSub(b, mins);
      // (Aya's row uses the name she wrote; the listing itself may only carry the Japanese name)
      const name = aya && p.en !== b.raw.en ? b.raw.en : p.en, sub = aya && name !== p.en ? `${p.en} · ${s.sub}` : s.sub;
      return { id, place: p, name, iconHtml: this._iconHtml(p), aya, closed: s.closed, sub: s.status ? `${sub} · ${s.status}` : sub, right: fmtDist(this._crow(p)) };
    }
    return { id, place: p, name: p.en, iconHtml: this._iconHtml(p), aya, sub: `${p.sub || ''}`.split(' · ').slice(0, 2).join(' · ') || LEVELS[p.level].label, right: fmtDist(this._crow(p)) };
  }
  _pickItem(it) {
    const ph = this.phone;
    ph._lastPhoneInput = ph._now;
    this.input.blur(); this._hideSugg();
    if (!ph.setDestination(it.id, { app: 'maps' })) this.select(it.place);
  }
  // a Maps place object for any destination id (biz slot or a Maps place id)
  placeById(id) {
    if (!id) return null;
    const b = businessBySlot[id]; if (b) return this._bizPlace(b);
    if (id.startsWith('b:')) { const b2 = businessBySlot[id.slice(2)]; return b2 ? this._bizPlace(b2) : null; }
    if (id.startsWith('x:')) { const no = id.slice(2); return LAYOUT.exits.some(e => EXIT_INFO[e.id] && EXIT_INFO[e.id].no === no) ? this._exitPlace(no) : null; }
    if (id.startsWith('t:')) { const t = TRANSIT_PLACES.find(q => q.id === id.slice(2)); return t ? this._transitPlace(t) : null; }
    if (id.startsWith('f:')) { const f = FACILITIES.find(q => q.id === id.slice(2)); return f ? this._facPlace(f) : null; }
    const a = AREA_PLACES.find(q => q.id === id); return a ? { ...a } : null;
  }
  // ---- the shared destination (phone.dest) drives the route ----
  onDestination(d, fromMaps) {
    if (!d) { this.route = null; this.banner.hidden = true; this.selected = null; this.results = []; this.showHome(); return; }
    const p = this.placeById(d.id); if (!p) return;
    if (this.route && this.route.target && destIdOf(this.route.target) === d.id && !this.route.arrived) { if (fromMaps) this._routeSheet(); return; }
    this.results = [p];
    this.selected = p;
    this.follow = false;
    this.startRoute(p);
  }
  onArrived(d) {
    this.route = null; this.selected = null; this.results = [];
    this.banner.hidden = false;
    this.banner.innerHTML = `<div class="mp-bn-ic">✓</div><div><b>Arrived</b><small>${esc(d.name)}</small></div>`;
    clearTimeout(this._bnT); this._bnT = setTimeout(() => { if (!this.route) this.banner.hidden = true; }, 4000);
    this.follow = true;
    this.showHome();
  }
  onListChanged() { if (this.sheet === 'home') this.showHome(); else if (this.sheet === 'route') this._routeSheet(); }
  // the list the keyboard drives (1–9, ↑↓ Enter) while Maps is up; on a route: the "Next (from Aya)" chip
  activeList() {
    if (this.sheet === 'route') return this._next || null;
    if (this.sheet === 'place') return this._placeList || null;
    return (this.sheet === 'home' || this.sheet === 'results') && this.list && this.list.items.length ? this.list : null;
  }
  focusSearch() { this.input.focus(); return true; }
  _refreshHome() {
    if (this.sheet !== 'home' || !this._homeEl) return;
    const p = this.pos;
    const sp = this.ctx.world.spaceAt(p.level, p.x, p.z);
    const z = sp && ZONES[sp.zone];
    const set = (c, t) => { const e = this._homeEl.querySelector(c); if (e && e.textContent !== t) e.textContent = t; };
    set('.mp-home-t', z ? z.name : 'Namba');
    set('.mp-home-s', `${LEVELS[p.level].label} · ${this._accTxt()} (±${Math.round(p.acc)} m)`);
    const dot = this._homeEl.querySelector('.mp-here-dot'); if (dot) dot.classList.toggle('ok', p.acc < 12);
    if (this.list) this.list.refreshRight(it => it.place ? fmtDist(this._crow(it.place)) : null);
  }

  // what the lowered phone's glance card shows: the vague hint (crow-flies arrow & distance, the
  // believed floor), or the one-floor route this app manages — the frustration, legibly
  glanceInfo() {
    const p = this.pos, R = this.route;
    const warn = p.noService ? 'No service' : p.acc > 16 ? 'GPS signal lost' : p.acc > 9 ? 'GPS signal weak' : '';
    const here = `you’re on ${LEVELS[p.level].label}`;
    const angTo = (x, z) => { const dx = x - p.x, dz = z - p.z; let d = Math.atan2(-dx, -dz) - p.heading; d = Math.atan2(Math.sin(d), Math.cos(d)); return -d * 180 / Math.PI; };
    if (R && R.arrived) return { kind: 'arr', icon: 'arrow', ang: 0, title: 'You have arrived', sub: `${R.target.en} · probably`, warn: '' };
    if (R && !R.failed && R.leg && R.legs.length > 1 && R.leg.ramp >= 0 && R.leg.pts.length) {
      const r = LAYOUT.ramps[R.leg.ramp], to = R.leg.dir > 0 ? r.upper : r.lower, e = R.leg.pts[R.leg.pts.length - 1];
      return { kind: 'route', icon: p.acc > 16 ? 'lost' : 'arrow', ang: angTo(e[0], e[1]), title: `Take the ${this._rampWord(r)} ${R.leg.dir > 0 ? 'up' : 'down'} to ${LEVELS[to].label}`, sub: `${fmtDist(Math.hypot(e[0] - p.x, e[1] - p.z))} · ${here}`, warn };
    }
    const t = R && R.target;
    if (!t) {
      // v4: nothing routes until the player picks a place
      const D = this.phone.dest, C = D && D.current, nx = D && D.next(), sug = nx && D.name(nx);
      if (C && C.arrived) return { kind: 'arr', icon: 'check', title: `Arrived · ${C.name}`, sub: sug ? `Next: ${sug}` : here, warn: '' };
      if (this.phone._ended) return { kind: 'pick', icon: 'pin', title: 'No route', sub: sug ? `Where to? · Aya: ${sug}` : `Where to? · ${here}`, warn: '' };
      return { kind: 'pick', icon: 'pin', title: 'Pick a place in Maps', sub: sug ? `Aya: ${sug}` : `Where to? · ${here}`, warn: '' };
    }
    return { kind: 'crow', icon: p.acc > 16 ? 'lost' : 'arrow', ang: angTo(t.x, t.z), title: t.en, sub: `${fmtDist(this._crow(t))} as the crow flies`, warn };
  }
  showResults() {
    const mins = this.ctx.clock.minutes;
    const D = this.phone.dest, sug = D && D.suggested;
    this._setSheet('results', `<div class="mp-sh-h"><b>${this.results.length ? `Results for “${esc(this.query)}”` : `No results for “${esc(this.query)}”`}</b>${this.pos.noService ? '<span class="mp-offline">Offline · saved map</span>' : ''}</div><div class="mp-dl"></div>${this.results.length ? '' : '<div class="mp-empty">Try “coffee”, “tempura”, “Midosuji”…</div>'}`, this.results.length > 3);
    this.list = new DestList(this.sheetIn.querySelector('.mp-dl'), { theme: 'maps', chips: false, title: '', onPick: (it) => this._pickItem(it) });
    this.list.touch = this.phone.ctx.input && this.phone.ctx.input.touch;
    // like every maps app: rating, open / closed, crow-flies distance (Aya's pick is marked where it shows up)
    this.list.render(this.results.slice(0, 25).map(r => {
      const id = destIdOf(r);
      let subHtml = esc(r.sub || ''), closed = false;
      if (r.kind === 'biz') {
        const b = r.b, open = isOpen(b, mins); closed = !open;
        const st = b.cat === 'closed' ? `<span class="mp-closed">Closed for renovation</span>` : open ? `<span class="mp-open">Open</span>` : `<span class="mp-closed">Closed · opens ${hm(b.hours[0])}</span>`;
        subHtml = `<span class="mp-stars">${b.rating ? b.rating.toFixed(1) : '–'} ${this._stars(b.rating)}</span> · ${esc(CATEGORIES[b.cat].en.replace(/ \(.*\)$/, ''))} · ${st}`;
      }
      return { id, place: r, name: r.en, iconHtml: this._iconHtml(r), aya: id && id === sug ? 'From Aya' : null, subHtml, closed, right: `${fmtDist(this._crow(r))} · ${LEVELS[r.level].label}` };
    }));
    // frame results on the map
    if (this.results.length) { this.follow = false; }
  }
  _stars(r) { const n = Math.round(r || 0); return '<i class="mp-st">' + '★'.repeat(n) + '<u>' + '★'.repeat(5 - n) + '</u></i>'; }

  select(p) {
    if (!p) return;
    if (p.kind === 'area' && p.id && p.id.startsWith('a_') && !p.level) return;
    this.selected = p;
    // pan so the pin is visible, but stay on the current floor (as real apps do)
    this.follow = false;
    if (p.level === this.view.level) { this.view.cx = p.x; this.view.cz = p.z; }
    else { this.view.cx = (p.x + this.pos.x) / 2; this.view.cz = (p.z + this.pos.z) / 2; const d = Math.hypot(p.x - this.pos.x, p.z - this.pos.z); this.view.zoom = Math.max(ZOOM_MIN, Math.min(this.view.zoom, 170 / Math.max(30, d))); }
    this.showPlace(p);
  }
  showPlace(p) {
    const mins = this.ctx.clock.minutes;
    const crow = this._crow(p);
    let body = '';
    const otherFloor = p.level !== this.pos.level;
    const floorNote = otherFloor ? `<div class="mp-note">📍 On <b>${LEVELS[p.level].label}</b> — you are on ${LEVELS[this.pos.level].label}</div>` : '';
    if (p.kind === 'biz') {
      const b = p.b, open = isOpen(b, mins);
      const st = b.cat === 'closed' ? `<span class="mp-closed">Closed for renovation</span>` : open ? `<span class="mp-open">Open now</span> · until ${hm(b.hours[1])}` : `<span class="mp-closed">Closed</span> · opens ${hm(b.hours[0])}`;
      const revs = reviewsFor(b).map(r => `<div class="mp-rev"><div class="mp-rev-h"><i>${r.who[0]}</i><b>${esc(r.who)}</b><span class="mp-st">${'★'.repeat(r.stars)}<u>${'★'.repeat(5 - r.stars)}</u></span><small>${r.when}</small></div><p>${esc(r.text)}</p></div>`).join('');
      // v5 critic: Google-Maps order — name, rating, status, the action row, THEN the photo, so Directions (the primary
      // action, Enter) is visible on the half-height sheet without scrolling (it used to sit under a 118 px photo).
      body = `<div class="mp-pc"><div class="mp-pc-t">${esc(b.en)}</div><div class="mp-pc-ja">${esc(b.ja)}</div>
        <div class="mp-pc-meta"><span class="mp-stars">${b.rating ? b.rating.toFixed(1) : '–'} ${this._stars(b.rating)}</span> <span class="mp-dim">(${b.reviews.toLocaleString('en')})</span> · ${esc(CATEGORIES[b.cat].en)} · ¥${'¥'.repeat(1 + (b.rating > 4.3 ? 1 : 0))}</div>
        <div class="mp-pc-meta">${esc(ZONES[b.zone] ? ZONES[b.zone].name : '')} · <span class="mp-fl">${LEVELS[b.level].label}</span> · ${fmtDist(crow)} · 🚶 ${Math.max(1, Math.round(crow / 1.4 / 60))} min</div>
        <div class="mp-pc-meta">${st}</div>${floorNote}
        <div class="mp-actions"><button class="mp-go">➤ Directions</button><button>☆ Save</button><button>⇪ Share</button></div>
        <img class="mp-photo mp-photo-in" src="${placeArt(b)}" alt="">
        ${b.blurb ? `<p class="mp-blurb">${esc(b.blurb)}</p>` : ''}
        ${this._popularHtml(b)}
        <div class="mp-hours">🕘 Hours <b>${hm(b.hours[0])} – ${hm(b.hours[1])}</b></div>
        <div class="mp-revs"><div class="mp-sh-h"><b>Reviews</b></div>${revs}</div></div>`;
    } else if (p.kind === 'transit') {
      const t = p.t, L = LINES[t.line];
      let trip = '';
      if (t.trip) trip = `<div class="mp-trip"><div class="mp-trip-l"><i class="mp-lb ${L.shape}" style="--c:${L.color}">${L.letter}</i><div><b>${esc(L.en)} ${esc(L.ja)}</b><small>${esc(t.trip.from)} → ${esc(t.trip.to)} · ${t.trip.stops} stops</small></div><div class="mp-trip-t">${t.trip.min} min<small>¥${t.trip.fare}</small></div></div><div class="mp-trip-dep">${this._departuresHtml(t.trip.track)}</div></div>`;
      body = `<div class="mp-pc mp-pc-tr"><div class="mp-tr-h" style="--c:${L.color}"><i class="mp-lb ${L.shape}" style="--c:${L.color}">${L.letter}</i><div><div class="mp-pc-t">${esc(t.en)}</div><div class="mp-pc-ja">${esc(t.ja)}</div></div></div>
        <div class="mp-pc-meta">${esc(t.sub)}</div><div class="mp-pc-meta"><span class="mp-fl">${LEVELS[p.level].label}</span> · ${fmtDist(crow)}${t.offmap ? ' · <span class="mp-dim">outside this map</span>' : ''}</div>${floorNote}${trip}
        <div class="mp-actions"><button class="mp-go">➤ Directions</button><button>☆ Save</button></div>
        <p class="mp-blurb mp-dim">“Namba” is four different stations: Osaka Metro なんば, Nankai なんば, Kintetsu/Hanshin 大阪難波 and JR難波. Check the operator.</p></div>`;
    } else {
      body = `<div class="mp-pc"><div class="mp-tr-h">${this._iconHtml(p)}<div><div class="mp-pc-t">${esc(p.en)}</div><div class="mp-pc-ja">${esc(p.ja || '')}</div></div></div>
        <div class="mp-pc-meta">${esc(p.sub || '')}</div><div class="mp-pc-meta"><span class="mp-fl">${LEVELS[p.level].label}</span> · ${fmtDist(crow)}</div>${floorNote}
        <div class="mp-actions"><button class="mp-go">➤ Directions</button><button>☆ Save</button></div></div>`;
    }
    this._setSheet('place', `<button class="mp-x">×</button>${body}`, false);
    this.sheetIn.querySelector('.mp-x').addEventListener('click', () => { this.selected = null; this.route ? this._routeSheet() : this.results.length > 1 ? this.showResults() : this.showHome(); });
    const go = this.sheetIn.querySelector('.mp-go');
    if (go) {
      if (!(this.ctx.input && this.ctx.input.touch)) go.insertAdjacentHTML('beforeend', ' <kbd class="mp-k">Enter</kbd>');
      go.addEventListener('click', () => this._goPlace(p));
    }
    // (keyboard: the place card is a one-row list — 1 / Enter = Directions)
    this._placeList = { items: [{ id: destIdOf(p) }], sel: 0, armed: true, move() {}, pick: () => { this._goPlace(p); return true; } };
    this.ctx.events.emit('phone:select', { id: p.id, kind: p.kind, slot: p.b && p.b.slot, key: p.b && p.b.key });
  }
  _goPlace(p) {
    const via = this._linkGo && this._linkGo.p === p ? 'link' : undefined;
    this._linkGo = null; this.phone._lastPhoneInput = this.phone._now;
    if (!this.phone.setDestination(destIdOf(p), { app: 'maps', via })) this.startRoute(p);
  }
  _popularHtml(b) {
    if (b.cat === 'closed') return '';
    const v = popularTimes(b), h = Math.floor(this.ctx.clock.minutes / 60);
    const now = Math.max(0, Math.min(v.length - 1, h - 7));
    const busy = v[now] > 0.75 ? 'Busier than usual' : v[now] > 0.5 ? 'Usually busy' : 'Usually not too busy';
    return `<div class="mp-pop"><div class="mp-sh-h"><b>Popular times</b><small>${busy}</small></div><div class="mp-pop-b">${v.map((x, i) => `<i class="${i === now ? 'now' : ''}" style="height:${Math.round(6 + x * 34)}px"></i>`).join('')}</div><div class="mp-pop-l"><span>7a</span><span>10a</span><span>1p</span><span>4p</span><span>7p</span></div></div>`;
  }
  _departuresHtml(trackId) {
    const tr = this.ctx.transit;
    if (this.pos.noService) return `<div class="mp-dim">Live departures unavailable — no service (圏外)</div>`;
    if (tr && typeof tr.nextDepartures === 'function') {
      try {
        const deps = tr.nextDepartures(trackId, 3) || [];
        if (deps.length) return deps.slice(0, 3).map(d => `<div class="mp-dep"><b>${esc(d.time || (d.minutes != null ? hm(d.minutes) : ''))}</b> ${esc(d.dest || d.destination || d.dirEn || '')} <span class="mp-dim">${esc(d.type || d.kind || '')}</span></div>`).join('');
      } catch (e) { /* transit API shape differs: fall through */ }
    }
    return `<div class="mp-dim">Trains every 3–5 min · timetable from the transit app</div>`;
  }

  // ----------------------------------------------------------- routing ----
  startRoute(target) {
    this.route = { target, legs: [], leg: null, t: 0, recalc: 0 };
    this._computeRoute(true);
    this.ctx.events.emit('phone:route', { id: target.id, level: target.level });
  }
  _computeRoute(first) {
    const R = this.route; if (!R) return;
    const nav = this.ctx.nav; if (!nav) return;
    const t = R.target, p = this.pos;
    const key = 'phone:' + t.id;
    // anything that is not a train/gate/platform must not route through the fare gates
    const f = t.kind === 'transit' ? nav.fieldToPoint(key, t.level, t.x, t.z) : fieldNoEntry(nav, key, [nav.nodeAtPoint(t.level, t.x, t.z)]);
    // the route starts where the PHONE thinks you are, on the floor it thinks
    let v = nav.nodeAtPoint(p.level, p.x, p.z);
    if (v < 0 || !isFinite(f.dist[v])) {
      // fall back to the nearest node in a small radius on that floor
      for (let r = 2; r <= 12 && (v < 0 || !isFinite(f.dist[v])); r += 2) for (let a = 0; a < 8; a++) {
        const w = nav.nodeAtPoint(p.level, p.x + Math.cos(a) * r, p.z + Math.sin(a) * r);
        if (w >= 0 && isFinite(f.dist[w])) { v = w; break; }
      }
    }
    if (v < 0 || !isFinite(f.dist[v])) { R.failed = true; this._routeSheet(); return; }
    R.failed = false;
    R.legs = routeLegs(nav, f, v);
    R.leg = R.legs[0];
    if (R.leg) R.leg.draw = simplify(R.leg.pts, 0.9);
    R.total = f.dist[v];
    R.level = p.level;
    R.recalc = 0;
    R.offCount = 0;
    if (!first) { this._flashBanner('Recalculating…'); if (this.phone._stats && this.pos.mode === 'gps') this.phone._stats.reroutes++; }
    if (R.leg && R.leg.level !== this.view.level) { this.view.level = R.leg.level; this._renderFloors(); }
    this.follow = true;
    this._routeSheet();
  }
  _rampWord(r) { return r.kind === 'escalator' ? 'escalator' : 'stairs'; }
  _routeSheet() {
    const R = this.route; if (!R) return;
    const t = R.target;
    if (R.failed) {
      this._setSheet('route', `<button class="mp-x">×</button><div class="mp-pc"><div class="mp-pc-t">No route found</div><p class="mp-dim">Can't determine your position on ${LEVELS[this.pos.level].label}. Try moving to an open area.</p></div>`);
      this.banner.hidden = true;
      this.sheetIn.querySelector('.mp-x').addEventListener('click', () => this.endRoute());
      return;
    }
    const leg = R.leg, legs = R.legs;
    const minutes = Math.max(1, Math.round(R.total / 1.4 / 60));   // real walking minutes, as any maps app would say
    let step, sub = '';
    if (legs.length > 1 && leg.ramp >= 0) {
      const r = LAYOUT.ramps[leg.ramp];
      const to = leg.dir > 0 ? r.upper : r.lower;
      step = `${leg.dir > 0 ? '↗' : '↘'} Take the ${this._rampWord(r)} ${leg.dir > 0 ? 'up' : 'down'} to ${LEVELS[to].label}`;
      sub = `${fmtDist(leg.len)} · then continue on ${LEVELS[to].label}`;
    } else {
      step = `➤ Head to ${t.en}`; sub = `${fmtDist(leg ? leg.len : R.total)} on this floor`;
    }
    this.banner.hidden = false;
    this.banner.innerHTML = `<div class="mp-bn-ic">${legs.length > 1 ? (leg.dir > 0 ? '⬈' : '⬊') : '⬆'}</div><div><b>${esc(step.replace(/^\S+\s/, ''))}</b><small>${esc(sub)}</small></div>`;
    const steps = [];
    steps.push(`<li><b>Start</b> <span class="mp-dim">${LEVELS[R.level].label} · ±${Math.round(this.pos.acc)} m</span></li>`);
    legs.forEach((lg, i) => {
      if (i === 0) {
        if (lg.ramp >= 0) { const r = LAYOUT.ramps[lg.ramp]; steps.push(`<li>Walk ${fmtDist(lg.len)} to the ${this._rampWord(r)}</li><li>Take ${this._rampWord(r)} ${lg.dir > 0 ? 'up' : 'down'} to <b>${LEVELS[lg.dir > 0 ? r.upper : r.lower].label}</b></li>`); }
        else steps.push(`<li>Walk ${fmtDist(lg.len)} to <b>${esc(t.en)}</b></li>`);
      }
    });
    if (legs.length > 1) steps.push(`<li class="mp-dim">Directions for the remaining floors will appear once we detect you on ${LEVELS[(() => { const r = LAYOUT.ramps[leg.ramp]; return leg.dir > 0 ? r.upper : r.lower; })()].label}. <i>(We’re not sure when that is.)</i></li>`);
    this._next = nextChip(this.phone);
    this._setSheet('route', `<button class="mp-x">×</button><div class="mp-pc">
      ${nextChipHtml(this._next, this.ctx.input && this.ctx.input.touch, 'dl-next-maps')}
      <div class="mp-rt-h"><b>${minutes} min</b> <span class="mp-dim">(${fmtDist(R.total)})</span></div>
      <div class="mp-pc-meta">to <b>${esc(t.en)}</b> · <span class="mp-fl">${LEVELS[t.level].label}</span></div>
      ${t.level !== R.level ? `<div class="mp-note">Showing this floor only · destination is on ${LEVELS[t.level].label} · straight-line distance ${fmtDist(this._crow(t))}</div>` : ''}
      <ol class="mp-steps">${steps.join('')}</ol>
      <div class="mp-dim mp-fine">Walking time does not include crowds, gates or queues. Indoor positioning may be inaccurate.</div>
      <div class="mp-actions"><button class="mp-end">End</button></div></div>`);
    this.sheetIn.querySelector('.mp-x').addEventListener('click', () => this.endRoute());
    this.sheetIn.querySelector('.mp-end').addEventListener('click', () => this.endRoute());
    const nb = this.sheetIn.querySelector('.dl-next'); if (nb) nb.addEventListener('click', (e) => { e.stopPropagation(); this._next && this._next.pick(); });
  }
  // End / × on the route = no destination any more (both apps back to their list)
  endRoute() {
    this.route = null; this.banner.hidden = true; this.selected = null; this.results = [];
    const C = this.phone.dest && this.phone.dest.current;
    if (C && !C.arrived && this.phone.endRoute) this.phone.endRoute('maps');      // v5: 'nav:end', calm "No route" (same as Lodestone)
    else if (C) this.phone.clearDestination(); else this.showHome();
  }
  // v5: the next milestone as Maps believes it (its one-floor leg: the first escalator, or the place itself)
  milestone() {
    const R = this.route, p = this.pos;
    if (!R || R.failed || R.arrived || !R.target) return null;
    if (R.leg && R.legs.length > 1 && R.leg.ramp >= 0 && R.leg.pts.length) {
      const r = LAYOUT.ramps[R.leg.ramp], e = R.leg.pts[R.leg.pts.length - 1];
      return { kind: r.kind === 'escalator' ? 'escalator' : 'stairs', dir: R.leg.dir > 0 ? 'up' : 'down', toLevel: R.leg.dir > 0 ? r.upper : r.lower,
        dist: Math.round(Math.hypot(e[0] - p.x, e[1] - p.z)), level: R.leg.level, x: e[0], z: e[1], side: null, app: 'maps' };
    }
    const t = R.target;
    return { kind: 'arrive', dir: null, toLevel: t.level, dist: Math.round(this._crow(t)), name: t.en, level: t.level, x: t.x, z: t.z, side: null, app: 'maps' };
  }
  // v5: a place link from a text — its place card, Directions = Go (click / Enter / 1)
  preview(id) {
    const p = this.placeById(id); if (!p) return false;
    this._linkGo = { id: destIdOf(p) || id, p };
    this.select(p);
    return true;
  }
  closePreview() {
    if (this.sheet !== 'place') return false;
    this.selected = null; this._linkGo = null;
    this.route ? this._routeSheet() : this.results.length > 1 ? this.showResults() : this.showHome();
    return true;
  }
  _flashBanner(t) {
    this.banner.hidden = false;
    this.banner.innerHTML = `<div class="mp-bn-ic mp-spin">⟳</div><div><b>${t}</b></div>`;
    clearTimeout(this._bnT); this._bnT = setTimeout(() => this.route && this._routeSheet(), 1300);
  }
  _onBelievedFloor() {
    if (!this.route) return;
    // the app picks up the next leg once it believes you reached that floor
    this._computeRoute(false);
  }
  _routeTick(dt) {
    const R = this.route; if (!R || R.failed) return;
    R.recalc += dt;
    const p = this.pos, t = R.target;
    // arrived?
    // "arrived" is the phone's belief, not the truth: it can fire 10 m early or late
    if (p.level === t.level && Math.hypot(p.x - t.x, p.z - t.z) < 7) {
      if (!R.arrived) { R.arrived = true; this.banner.hidden = false; this.banner.innerHTML = `<div class="mp-bn-ic">✓</div><div><b>You have arrived</b><small>${esc(t.en)}</small></div>`; this.ctx.events.emit('phone:arrive', { id: t.id }); }
      return;
    }
    // off route? (distance of the estimate from the drawn leg)
    // v6 critic: 24 m for 4 s, at most every 12 s — with the ±10–30 m indoor dot the old 18 m / 6 s flashed
    // "Recalculating…" every ~15 s, which read as noise rather than frustration
    if (R.leg && R.leg.draw && p.level === R.leg.level && R.recalc > 12) {
      let best = 1e9;
      const pts = R.leg.draw;
      for (let i = 0; i + 1 < pts.length; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
        const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez || 1;
        let u = ((p.x - ax) * ex + (p.z - az) * ez) / l2; u = Math.max(0, Math.min(1, u));
        best = Math.min(best, Math.hypot(p.x - ax - ex * u, p.z - az - ez * u));
      }
      if (best > 24) { R.offCount += dt; if (R.offCount > 4) this._computeRoute(false); }
      else R.offCount = 0;
    }
  }

  // the little indignities of every maps app indoors
  _nag(dt) {
    const p = this.pos, bad = p.mode === 'gps' && p.acc > 9;
    this._warnT = (this._warnT || 0) - dt;
    if (this._warnT <= 0) {
      this._warnT = 0.5;
      const txt = p.noService ? 'No service · showing the saved map' : p.acc > 16 ? 'GPS signal lost · move to an open area' : 'GPS signal weak';
      if (this.warnEl.textContent !== txt) this.warnEl.textContent = txt;
      this.warnEl.hidden = !bad || !this.phone.isOpen || !this.banner.hidden;
    }
    // figure-8 compass prompt: underground, every ~70 s, for 5 s
    this._calT = (this._calT == null ? 40 + Math.random() * 15 : this._calT) - dt;
    if (this._calT <= 0) {
      if (bad && p.env !== 'outdoor' && p.env !== 'canyon' && this.phone.isOpen && this.phone.app === 'maps') {
        this.calEl.hidden = false; this._calShow = 5; this._calT = 70 + Math.random() * 25;
        if (this.phone._stats) this.phone._stats.compassPrompts++;
      } else this._calT = 5;
    }
    if (this._calShow > 0) { this._calShow -= dt; if (this._calShow <= 0 || p.mode !== 'gps') this.calEl.hidden = true; }
  }

  // called by the phone every few frames when the sheet shows live data
  tick() { this._refreshHome(); }
}
