// =============================================================================
// Maps — the phone's indoor map app.   v23: "the phone cannot tell you precisely where you are indoors, but it is a good MAP".
//
//   * THE PLAN IS TRUE. Walkable area, shop blocks with their names (big / landmark tenants and anything on the route first),
//     escalators and stairs with the floor they lead to, ticket gates, exits, toilets, the train lines. Pinch / drag / wheel.
//   * YOU ARE HERE IS HONEST. Outdoors or on a GPS fix: a blue dot, ±5 m. Indoors without a fix: a wide accuracy circle, a
//     hollow dot, and "Somewhere on 2F or 3F" (the floor pair always contains the truth). The compass IS reliable: the
//     heading arrow shows which way you face; "heading up" turns the plan to match the world, "north up" is the other mode.
//   * THE ROUTE IS A WHOLE OVERVIEW (not turn-by-turn): a few plain steps in the words the signs use, the line drawn on
//     every floor it crosses, tap a step to see it. The current step moves only on what the phone can know (the floor it
//     believes you are on, a gate you tapped, a GPS fix near the step), never on false precision.
//   * ONE BOX. The app lives in .ph-view[data-v="maps"] (300-400 wide, 250-700 tall): a top bar, the plan filling the box,
//     a floor strip along the bottom, panels (list, results, place, steps) that slide over the plan. Everything is fluid.
//   * PERFORMANCE: one visible canvas (box size x dpr, e.g. 600 x 510 px), floor-plan caches of 1-4 floors (ppm 2 on phones,
//     3 on desktop), redrawn only when something changed (a gesture, the floor, the dot, the heading in 2-degree steps).
// =============================================================================
import { LAYOUT, LEVELS, LEVEL_ORDER, ZONES, rampEnds } from '../../world/layout.js?v=5442362';
import { BUSINESSES, searchBusinesses, isOpen, CATEGORIES, FEATURED } from '../../world/directory.js?v=5442362';
import { businessBySlot } from '../../world/directory.js?v=5442362';
import { drawFloor, drawRoads, THEMES, catGroup, ROADS } from './maprender.js?v=5442362';
import { TRANSIT_PLACES, LINES, EXIT_INFO, FACILITIES, FACILITY_INFO, FLOOR_NAMES, areaOf } from './places.js?v=5442362';
import { routeLegs, simplify, fieldNoEntry } from './routes.js?v=5442362';
import { buildSteps, routeFloors } from './mapsteps.js?v=5442362';
import { hash } from '../../core/rng.js?v=5442362';
import { placeArt, reviewsFor, popularTimes } from './art.js?v=5442362';
import { DestList, destIdOf, defaultIds, bizSub, zoneShort, nextChip, nextChipHtml, levelLabel } from './destinations.js?v=5442362';

const ZOOM_MIN = 0.5, ZOOM_MAX = 12;
const MAX_BASE = 4;                  // floor-plan caches kept at once
const hm = (m) => { m = Math.round(m) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
// Presentation-layer overrides for the hand-made quest places: a tiny standing bar with few reviews and a Japanese name.
const LISTING = {
  coffee_great: { rating: 4.9, reviews: 38, jaOnly: true },
};
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// v23: a distance from where the phone THINKS you are is never metre-precise: "about 150 m"
export const fmtDist = (m) => m < 1000 ? `about ${Math.max(50, Math.round(m / 50) * 50)} m` : `about ${(m / 1000).toFixed(1)} km`;
const lvl = levelLabel;
const FONT = 'Inter, "Noto Sans JP", sans-serif';
const AREA_PLACES = [
  { id: 'a_parks', kind: 'area', en: 'Namba Parks', ja: 'なんばパークス', sub: 'Shopping mall & roof gardens · 2F–8F', level: '2F', x: 0, z: 205, keys: ['parks', 'namba parks', 'garden', 'パークス'] },
  { id: 'a_city', kind: 'area', en: 'Namba CITY', ja: 'なんばCITY', sub: 'Shopping mall under the Nankai tracks · B1–2F', level: 'B1', x: 0, z: 20, keys: ['city', 'namba city', 'mall'] },
  { id: 'a_walk', kind: 'area', en: 'NAMBAWALK', ja: 'なんばウォーク', sub: 'Underground shopping street · B1', level: 'B1', x: 60, z: -222, keys: ['walk', 'nambawalk', 'underground'] },
  { id: 'a_taka', kind: 'area', en: 'Takashimaya Osaka', ja: '高島屋 大阪店', sub: 'Department store · food hall B1', level: 'B1', x: -30, z: -170, keys: ['takashimaya', 'department', 'depachika', '高島屋'] },
  { id: 'a_dotonbori', kind: 'area', en: 'Dotonbori', ja: '道頓堀', sub: 'Canal-side food street · approx. 500 m north via Exit 18', level: '1F', x: 43, z: -255, keys: ['dotonbori', 'glico', '道頓堀'], offmap: true },
];

// ---- small inline icons (24 x 24, currentColor) ----
const I = {
  search: '<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z" fill="currentColor" stroke="none"/><circle cx="12" cy="10" r="2.6" fill="#fff" stroke="none"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="M12 19V6M6 11l6-6 6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M12 5v13M6 13l6 6 6-6"/></svg>',
  gate: '<svg viewBox="0 0 24 24"><path d="M5 20V8m14 12V8M5 12h14M9 20v-5m6 5v-5"/></svg>',
  walk: '<svg viewBox="0 0 24 24"><circle cx="13" cy="4.6" r="1.9" fill="currentColor" stroke="none"/><path d="M12.6 8.5 10 12l2.4 2.2L11 20M10.8 9.6 8 10.6M12.6 8.5l2.6 2.2 2.4.2M12.4 14.2l2.6 2.4.6 3.4"/></svg>',
  locate: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6.2"/><circle cx="12" cy="12" r="2" fill="currentColor"/><path d="M12 2.5v3.3M12 18.2v3.3M2.5 12h3.3M18.2 12h3.3"/></svg>',
  list: '<svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.6" cy="6" r="1.1" fill="currentColor"/><circle cx="4.6" cy="12" r="1.1" fill="currentColor"/><circle cx="4.6" cy="18" r="1.1" fill="currentColor"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5 10 17.5 19 7"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
};

export class MapApp {
  constructor(phone, root) {
    this.phone = phone; this.ctx = phone.ctx; this.pos = phone.pos;
    this.root = root;
    this.view = { cx: 0, cz: 0, zoom: 2.6, rot: 0, level: '3F' };
    // v23: heading up is the default (the plan turns with you: "ahead" is up); the N button flips to north up
    this.follow = true; this.headingUp = true;
    this.base = new Map();
    this.selected = null; this.results = []; this.route = null;
    this.steps = []; this.focus = -1; this.known = null; this._clk = 0; this._lastPan = -99;
    this.sheet = 'map';        // the panel over the plan: 'map' (none) | 'home' (list) | 'results' | 'place' | 'steps'
    this._dirty = true; this._sig = ''; this._drawT = 0; this._routeV = 0;
    this._labelsFor = new Map(); this._shopsFor = new Map(); this._tw = new Map();
    this._ins = { t: 46, b: 44 };
    this._build();
    // text widths are cached; measure again once the web fonts are in (a narrower fallback font would clip labels)
    try { if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { this._tw.clear(); this._dirty = true; }); } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------- DOM ----
  _build() {
    const r = this.root, touch = !!(this.ctx.input && this.ctx.input.touch);
    this.touch = touch;
    r.classList.add('mp', 'mq');
    r.innerHTML = `
      <canvas class="mq-canvas"></canvas>
      <div class="mq-chips"><span class="mq-fl"></span><button class="mq-me" type="button"><span class="p"><i></i><b></b></span></button></div>
      <div class="mq-ctl">
        <button class="mq-btn mq-orient" type="button" aria-label="Map orientation"><span></span></button>
        <button class="mq-btn mq-locate" type="button" aria-label="Centre on me">${I.locate}</button>
      </div>
      <div class="mq-toast" hidden></div>
      <button class="mq-aya" type="button" hidden></button>
      <div class="mq-strip" role="tablist" aria-label="Floors"></div>
      <div class="mq-bar">
        <label class="mq-search"><span class="mq-s-ico">${I.search}</span><input type="text" placeholder="Where to?" spellcheck="false" autocomplete="off" aria-label="Search Namba"><button class="mq-clear" type="button" hidden aria-label="Clear">${I.close}</button></label>
        <button class="mq-rt" type="button" hidden><i class="mq-rt-ic">${I.pin}</i><span class="mq-rt-t"><b></b><small></small></span><span class="mq-rt-go">Directions</span></button><button class="mq-rt-x" type="button" hidden aria-label="Clear destination">${I.close}</button>
      </div>
      <div class="mq-sugg" hidden></div>
      <div class="mq-panel" hidden><div class="mq-ph"><b class="mq-pt"></b><button class="mq-x" type="button" aria-label="Close">${I.close}</button></div><div class="mq-pb"></div></div>`;
    const q = (s) => r.querySelector(s);
    this.canvas = q('canvas'); this.g = this.canvas.getContext('2d');
    this.input = q('.mq-search input'); this.clearBtn = q('.mq-clear');
    this.bar = q('.mq-bar'); this.searchEl = q('.mq-search'); this.rtEl = q('.mq-rt'); this.rtX = q('.mq-rt-x');
    this.strip = q('.mq-strip'); this.sugg = q('.mq-sugg');
    this.panel = q('.mq-panel'); this.panelT = q('.mq-pt'); this.panelB = q('.mq-pb');
    this.flEl = q('.mq-fl'); this.meEl = q('.mq-me'); this.orientBtn = q('.mq-orient'); this.locBtn = q('.mq-locate');
    this.toastEl = q('.mq-toast'); this.ayaEl = q('.mq-aya');
    // v23: on a touch screen the search box opens the list (no on-screen keyboard unless you ask for it); desktop types
    if (touch) this.input.readOnly = true;
    this.input.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') { this.doSearch(this.input.value); this.input.blur(); }
      if (e.key === 'Escape') { this.input.blur(); this._hideSugg(); }
    });
    this.input.addEventListener('keyup', e => e.stopPropagation());
    this.input.addEventListener('input', () => { this.clearBtn.hidden = !this.input.value; this._suggest(this.input.value); });
    this.input.addEventListener('focus', () => { this.phone.typing = true; if (!touch) this._suggest(this.input.value); });
    this.input.addEventListener('blur', () => { this.phone.typing = false; setTimeout(() => this._hideSugg(), 150); });
    this.searchEl.addEventListener('click', (e) => { if (e.target.closest('.mq-clear')) return; if (touch) { this.openList(); } });
    this.clearBtn.addEventListener('click', (e) => { e.preventDefault(); this.input.value = ''; this.clearBtn.hidden = true; this.clearSearch(); });
    q('.mq-x').addEventListener('click', () => this.closePanel());
    this.rtEl.addEventListener('click', () => this.openSteps());
    this.rtX.addEventListener('click', () => this.endRoute());
    this.meEl.addEventListener('click', () => this._toast('No GPS indoors\nFind a shop or a sign near you on the map, or send Aya a photo 📸', 5200));
    this.ayaEl.addEventListener('click', () => this._ayaGo());
    this.orientBtn.addEventListener('click', () => this._toggleOrient());
    this.locBtn.addEventListener('click', () => this._recenter());
    this.strip.addEventListener('click', (e) => { const b = e.target.closest('button[data-l]'); if (!b) return; e.stopPropagation(); this._showFloor(b.dataset.l); });
    // the phone is a game overlay: nothing in the app may leak a press to the world behind it
    r.addEventListener('pointerdown', (e) => e.stopPropagation());
    this._pointer();
    if (typeof ResizeObserver !== 'undefined') { this._ro = new ResizeObserver(() => { this._measured = false; this._dirty = true; }); this._ro.observe(r); }
    this._renderStrip(true);
    this.showHome();
    const ev = this.ctx.events;
    // v23 round 2: the phone has no position indoors; it learns where you are only when something tells it
    if (ev && ev.on) {
      ev.on('story:photo', (e) => { if (e && e.ok) this._knownHere('Aya spotted you here', 'Aya spotted you', e.lm); });
      ev.on('gate:tap', (e) => { if (e && e.player) this._knownAt(e.level, e.x, e.z, `Tapped in at ${this._gateName(e)}`, `Tapped in at ${this._gateName(e)}, ${lvl(e.level)}`); });
      ev.on('demo:order', (e) => { if (e && e.name) this._knownHere(`Paid at ${e.name}`, `Paid at ${e.name}`, null, true); });
    }
  }

  // ------------------------------------------------------------ pointer ----
  _pointer() {
    const c = this.canvas;
    const pts = new Map();
    let moved = 0, pinch = null, lastTap = 0, lastTapAt = null;
    const local = (e) => { const rect = c.getBoundingClientRect(), s = this._cssScale(); return [(e.clientX - rect.left) / s, (e.clientY - rect.top) / s]; };
    c.addEventListener('pointerdown', e => {
      try { c.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      const [sx, sy] = local(e);
      pts.set(e.pointerId, { x: sx, y: sy });
      moved = 0;
      if (pts.size === 2) {
        const [a, b] = [...pts.values()], mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        pinch = { d: Math.max(8, Math.hypot(a.x - b.x, a.y - b.y)), z: this.view.zoom, w: this.toWorld(mx, my) };
      }
      e.stopPropagation();
    });
    c.addEventListener('pointermove', e => {
      const p = pts.get(e.pointerId); if (!p) return;
      const [sx, sy] = local(e);
      if (pts.size === 2 && pinch) {
        p.x = sx; p.y = sy;
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        this.view.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, pinch.z * d / pinch.d));
        // keep the world point under the fingers' midpoint under the fingers
        const now = this.toWorld(mx, my);
        this.view.cx += pinch.w[0] - now[0]; this.view.cz += pinch.w[1] - now[1];
        this.follow = false; this._dirty = true; this._lastPan = this._clk; moved += 10; return;
      }
      const dx = sx - p.x, dy = sy - p.y;
      p.x = sx; p.y = sy;
      moved += Math.abs(dx) + Math.abs(dy);
      if (moved > 6) {
        this.follow = false; this.focus = -1; this._lastPan = this._clk;
        const k = this.view.zoom, cr = Math.cos(this.view.rot), sr = Math.sin(this.view.rot);
        // screen delta -> world delta (inverse rotation)
        this.view.cx -= (dx * cr + dy * sr) / k; this.view.cz -= (-dx * sr + dy * cr) / k;
        this._dirty = true;
      }
    });
    const up = e => {
      if (!pts.has(e.pointerId)) return;
      const was = pts.get(e.pointerId);
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (moved < 7 && pts.size === 0 && e.type === 'pointerup') {
        const t = performance.now();
        if (t - lastTap < 320 && lastTapAt && Math.hypot(lastTapAt[0] - was.x, lastTapAt[1] - was.y) < 30) { this._zoomAt(was.x, was.y, 1.7); lastTap = 0; }
        else { lastTap = t; lastTapAt = [was.x, was.y]; this._tap(was.x, was.y); }
      }
    };
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', e => {
      e.preventDefault(); e.stopPropagation();
      const [sx, sy] = local(e);
      this._zoomAt(sx, sy, Math.exp(-e.deltaY * 0.0016));
    }, { passive: false });
  }
  _zoomAt(sx, sy, f) {
    const before = this.toWorld(sx, sy);
    this.view.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.view.zoom * f));
    const after = this.toWorld(sx, sy);
    this.view.cx += before[0] - after[0]; this.view.cz += before[1] - after[1];
    if (Math.hypot(before[0] - after[0], before[1] - after[1]) > 0.3) { this.follow = false; this._lastPan = this._clk; }
    this._dirty = true;
  }
  // ratio between CSS px of the canvas element and its on-screen size (the desktop phone is scaled)
  _cssScale() { const r = this.canvas.getBoundingClientRect(); return r.width / (this.canvas.clientWidth || r.width) || 1; }

  _tap(sx, sy) {
    if (this.sheet !== 'map' && this.sheet !== 'place') return;
    let best = null, bd = 24;
    for (const L of this._hits || []) { const d = Math.hypot(L.x - sx, L.y - sy); if (d < bd) { bd = d; best = L; } }
    if (best) { this.select(best.place); return; }
    // a tap on a shop block picks the shop
    const [wx, wz] = this.toWorld(sx, sy);
    for (const s of this._levelShops(this.view.level)) {
      if (wx >= s.x0 && wx <= s.x1 && wz >= s.z0 && wz <= s.z1) { this.select(this._bizPlace(s.b)); return; }
    }
    if (this.sheet === 'place' && !this._linkGo) this.closePanel();
  }

  // ------------------------------------------------------------- view -----
  get W() { return this.canvas.clientWidth || 300; }
  get H() { return this.canvas.clientHeight || 300; }
  _measure() {
    const bh = this.bar.offsetHeight || 46, sh = this.strip.offsetHeight || 44;
    const ph = this.sheet === 'place' ? Math.min(this.panel.offsetHeight || 0, this.H * 0.6) : 0;
    this._ins = { t: bh, b: sh + ph + (this.ayaEl.hidden ? 0 : 60) };
    this.root.style.setProperty('--mq-bar', (bh + 8) + 'px');
    this._measured = true;
  }
  // the plan's centre is the middle of what the bar, the strip and a place card leave free
  _anchor() { if (!this._measured) this._measure(); return [this.W / 2, this._ins.t + (this.H - this._ins.t - this._ins.b) / 2]; }
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
  // a view that shows the points `pts` ([x, z]) inside the free area, as large as that allows (never above maxZoom)
  _fit(pts, maxZoom = 3.4, pad = 26) {
    if (!pts.length) return;
    const v = this.view;
    let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
    const c = Math.cos(v.rot), s = Math.sin(v.rot);
    // bounds in the rotated frame (the plan may be turned)
    for (const [x, z] of pts) { const u = c * x + s * z, w = -s * x + c * z; x0 = Math.min(x0, u); x1 = Math.max(x1, u); z0 = Math.min(z0, w); z1 = Math.max(z1, w); }
    if (!this._measured) this._measure();
    const fw = Math.max(60, this.W - 2 * pad), fh = Math.max(60, this.H - this._ins.t - this._ins.b - 2 * pad);
    const k = Math.min(maxZoom, fw / Math.max(8, x1 - x0), fh / Math.max(8, z1 - z0));
    v.zoom = Math.max(ZOOM_MIN, k);
    const mu = (x0 + x1) / 2, mw = (z0 + z1) / 2;
    v.cx = c * mu - s * mw; v.cz = s * mu + c * mw;
    this.follow = false; this._dirty = true;
  }

  // ---- floor plan caches (small, few) ----
  _baseFor(level) {
    let b = this.base.get(level);
    if (b) { this.base.delete(level); this.base.set(level, b); return b; }       // most recently used last
    const grid = this.ctx.world.grids[level]; if (!grid) return null;
    const ppm = this.phone.lowQ || (this.ctx.engine && this.ctx.engine.mobile) ? 2 : 3;
    const c = document.createElement('canvas');
    c.width = Math.ceil(grid.w * ppm); c.height = Math.ceil(grid.h * ppm);
    const g = c.getContext('2d');
    g.setTransform(ppm, 0, 0, ppm, -grid.x0 * ppm, -grid.z0 * ppm);
    drawFloor(g, this.ctx.world, level, THEMES.phone, { businessBySlot });
    b = { canvas: c, x0: grid.x0, z0: grid.z0, w: grid.w, h: grid.h, ppm };
    this.base.set(level, b);
    while (this.base.size > MAX_BASE) { const k = this.base.keys().next().value, o = this.base.get(k); o.canvas.width = o.canvas.height = 0; this.base.delete(k); }
    return b;
  }

  // ------------------------------------------------------------ position ----
  // v23 round 2: indoors the phone has a compass and a map and NO position. It draws a dot only in the open air on a real GPS fix
  // (or in the retired Lodestone mode). Everywhere else it knows where you were only at "known moments" (a photo Aya read, a
  // gate you tapped, a café you paid at, the arrival): a labelled last-known pin that ages and fades.
  _where() {
    const p = this.pos, outdoors = p.env === 'outdoor' || p.env === 'canyon';
    const gps = p.mode === 'lodestone' || (p.mode === 'gps' && p.state === 'fix' && outdoors);
    return { gps, fix: gps, outdoors, unsure: false, level: p.level, levels: [p.level] };
  }
  _ageTxt(s) { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
  _youText(w) {
    const p = this.pos, k = this.known;
    if (w.gps) return { a: `You are on ${lvl(p.level)}`, b: `GPS · ±${Math.round(p.acc)} m` };
    return { a: 'No GPS indoors', b: k ? `Last known: ${k.where}` : '' };
  }
  _accTxt() { const t = this._youText(this._where()); return t.b ? `${t.a} · ${t.b}` : t.a; }
  _trueHere() { const b = this.ctx.player && this.ctx.player.body; return b ? { level: this.pos.trueLevel ? this.pos.trueLevel(b) : b.level, x: b.x, z: b.z } : null; }
  // "Nankai platforms, 3F"
  _whereName(level, x, z) {
    const a = areaOf(this.ctx.world.spaceAt(level, x, z)), n = a ? a.name.replace(/^the /, '') : '';
    return `${n ? n.charAt(0).toUpperCase() + n.slice(1) + ', ' : ''}${lvl(level)}`;
  }
  _gateName(e) {
    const g = LAYOUT.gates.find(q => q.id === e.gate) || LAYOUT.gates.filter(q => q.level === e.level)[0];
    return g ? g.name : 'the ticket gate';
  }
  _knownHere(text, glancePre, lm, noLm) {
    const h = this._trueHere(); if (!h) return;
    const w = this._whereName(h.level, h.x, h.z);
    this._setKnown({ level: h.level, x: h.x, z: h.z, text, where: w, glance: glancePre === 'Aya spotted you' ? `Aya spotted you: ${lm ? `${lm}, ${lvl(h.level)}` : w}` : `${glancePre}, ${lvl(h.level)}` });
  }
  _knownAt(level, x, z, text, glance) {
    if (!level || x == null) { this._knownHere(text, text); return; }
    this._setKnown({ level, x, z, text, where: text.replace(/^Tapped in at /, '').replace(/^/, '') + `, ${lvl(level)}`, glance });
  }
  _setKnown(k) {
    k.t0 = this._clk; k.id = (this._kn = (this._kn || 0) + 1);
    this.known = k;
    // a new pin takes the plan to its floor, unless you are looking around (panned in the last 5 s)
    if (this._clk - this._lastPan > 5 || k.id === 1) { this.view.level = k.level; this.view.cx = k.x; this.view.cz = k.z; this.follow = false; }
    this.focus = -1; this._dirty = true;
    this._renderStrip(); this._syncUI(true);
    if (this.sheet === 'steps') this.openSteps(true);
  }

  // ------------------------------------------------------------- update ----
  update(dt, visible) {
    const p = this.pos, v = this.view;
    this._clk += dt;
    if (!this.known && this.ctx.player && this.ctx.player.body && this.ctx.world && this.ctx.world.spaceAt) {
      const h = this._trueHere(), w = this._whereName(h.level, h.x, h.z);
      this._setKnown({ level: h.level, x: h.x, z: h.z, text: `Arrived: ${w}`, where: w, glance: `Arrived: ${w}` });
    }
    const W = this._where();
    if (W.gps !== this._gpsPrev) { this._gpsPrev = W.gps; if (W.gps) this.follow = true; this._renderStrip(); this._syncUI(true); }
    if (this.follow && W.gps) {
      const k = 1 - Math.exp(-dt / 0.25);
      const ex = p.x - v.cx, ez = p.z - v.cz;
      if (Math.abs(ex) + Math.abs(ez) < 0.04) { v.cx = p.x; v.cz = p.z; } else { v.cx += ex * k; v.cz += ez * k; }
      if (v.level !== p.level) { v.level = p.level; this._renderStrip(); }
    }
    if (this.headingUp) {
      let d = p.heading - v.rot; d = Math.atan2(Math.sin(d), Math.cos(d));
      // 2-degree steps: no redraw for a hair of turn
      if (Math.abs(d) > 0.035) v.rot += d * (1 - Math.exp(-dt / 0.18)); else if (Math.abs(d) > 0.004) v.rot += d;
    } else if (Math.abs(v.rot) > 0.001) { v.rot *= Math.exp(-dt / 0.12); if (Math.abs(v.rot) < 0.004) v.rot = 0; }
    this._uiT = (this._uiT || 0) - dt;
    if (this._uiT <= 0 && visible) { this._uiT = 0.25; this._syncUI(); }
    if (!visible) return;
    this._drawT += dt;
    const k0 = this.known, age = k0 ? Math.min(100, Math.floor(this._clk - k0.t0)) : 0;
    const sig = [v.level, v.cx.toFixed(1), v.cz.toFixed(1), v.zoom.toFixed(2), Math.round(v.rot * 28.6), W.gps ? p.x.toFixed(1) + p.z.toFixed(1) : '', p.level, W.gps ? Math.round(p.acc) : '', this.selected && this.selected.id, this._routeV, this.sheet, this.focus, this._toastV, k0 && k0.id, age].join('|');
    if (sig === this._sig && !this._dirty) return;
    // gestures redraw at once; the heading and the dot at most 30 times a second
    if (!this._dirty && this._drawT < 0.033) return;
    this._sig = sig; this._dirty = false; this._drawT = 0;
    this._draw();
  }
  // ------------------------------------------------------------- draw -----
  _draw() {
    const c = this.canvas, g = this.g;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = this.W, H = this.H;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); this._measured = false; }
    if (!this._measured) this._measure();
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
    // the complex's footprint (all floors) faintly: the building outline
    if (!this._foot) this._foot = this._footprint();
    g.fillStyle = '#dcd8cf'; for (const r of this._foot) g.fillRect(r[0], r[1], r[2] - r[0], r[3] - r[1]);
    // the plan: the cached floor when zoomed out, drawn live (visible cells only) when zoomed in
    const base = this._baseFor(v.level);
    const vis = this._visibleBounds();
    if (base) {
      if (v.zoom * dpr > base.ppm * 1.1) drawFloor(g, this.ctx.world, v.level, T, { bounds: vis, businessBySlot, _spaceCol: this._spaceCol || (this._spaceCol = new Map()) });
      else { g.imageSmoothingEnabled = true; g.drawImage(base.canvas, base.x0, base.z0, base.w, base.h); }
    }
    this._drawDestBlock(g, v);
    // the route on this floor
    if (this.route && this.route.legs) this._drawRoute(g, v.zoom, dpr);
    // screen-space overlays
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._hits = [];
    this._drawLabels(g, vis);
    this._drawPins(g);
    if (this._where().gps) this._drawMe(g);
    this._drawKnown(g);
    this._drawEdgeArrow(g);
    this._drawRose(g);
    this._drawWedge(g);
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

  // shop blocks of a floor: rect, centre, size, a priority (landmark / big tenants first)
  _levelShops(level) {
    let L = this._shopsFor.get(level);
    if (L) return L;
    L = [];
    for (const s of LAYOUT.shopSlots) {
      if (s.level !== level) continue;
      const b = businessBySlot[s.id]; if (!b) continue;
      const [x0, z0, x1, z1] = s.rect, w = x1 - x0, h = z1 - z0;
      const v = this._view(b);
      const feat = !!FEATURED[s.id];
      L.push({ id: s.id, b: v, x0, z0, x1, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, w, h, area: w * h, feat, base: (feat ? 400 : 0) + w * h * 0.5 + Math.log10(v.reviews + 10) * 18 });
    }
    this._shopsFor.set(level, L);
    return L;
  }
  _levelLabels(level) {
    let L = this._labelsFor.get(level);
    if (L) return L;
    L = { zones: [], ramps: [], exits: [], fac: [], gates: [], plats: [] };
    const acc = {};
    for (const s of LAYOUT.spaces) {
      if (s.level !== level || s.kind === 'room' || !s.rect) continue;
      const [x0, z0, x1, z1] = s.rect, a = (x1 - x0) * (z1 - z0);
      const o = acc[s.zone] || (acc[s.zone] = { x: 0, z: 0, a: 0 });
      o.x += (x0 + x1) / 2 * a; o.z += (z0 + z1) / 2 * a; o.a += a;
    }
    for (const zk in acc) { const o = acc[zk]; const Z = ZONES[zk]; if (Z && o.a > 300 && zk !== 'street') L.zones.push({ x: o.x / o.a, z: o.z / o.a, en: Z.name, ja: Z.ja, zone: zk }); }
    // v23: only the connectors you can USE from here: an escalator running up from this floor, one running down from it, stairs (both ways)
    for (const r of LAYOUT.ramps) {
      if (r.lower !== level && r.upper !== level) continue;
      if (r.bank && r.id !== r.bank + '_0') continue;
      let dir = 0;
      if (r.lower === level && (r.kind !== 'escalator' || r.move >= 0)) dir = 1;
      else if (r.upper === level && (r.kind !== 'escalator' || r.move <= 0)) dir = -1;
      if (!dir) continue;
      L.ramps.push({ r, dir, to: dir > 0 ? r.upper : r.lower, x: (r.rect[0] + r.rect[2]) / 2, z: (r.rect[1] + r.rect[3]) / 2 });
    }
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
  _textW(g, font, t) {
    const key = font + t; let w = this._tw.get(key);
    if (w == null) { g.font = font; w = g.measureText(t).width; this._tw.set(key, w); }
    return w;
  }

  _drawLabels(g, vis) {
    const v = this.view, k = v.zoom;
    const L = this._levelLabels(v.level), shops = this._levelShops(v.level);
    const boxes = [];
    const free = (x, y, w, h) => { for (const b of boxes) if (x < b[0] + b[2] && x + w > b[0] && y < b[1] + b[3] && y + h > b[1]) return false; boxes.push([x, y, w, h]); return true; };
    const inView = (x, y, m = 30) => x > -m && x < this.W + m && y > -m && y < this.H + m;
    g.textBaseline = 'middle';
    const R = this.route, dest = this.selected || (R && R.target);
    const onRoute = this._routeShopSet(v.level);
    // ---- 1. the connectors (escalators / stairs) you can take from here; the route's own are big and ringed ----
    const routeRamps = new Set();
    if (R && R.legs) for (const lg of R.legs) if (lg.ramp >= 0 && lg.level === v.level) routeRamps.add(LAYOUT.ramps[lg.ramp].bank || LAYOUT.ramps[lg.ramp].id);
    const rampItems = L.ramps.map(o => ({ o, sc: this.toScreen(o.x, o.z), on: routeRamps.has(o.r.bank || o.r.id) })).filter(i => inView(i.sc[0], i.sc[1])).sort((a, b) => (b.on - a.on));
    for (const it of rampItems) {
      const [sx, sy] = it.sc, o = it.o, big = it.on;
      if (k < 0.75 && !big) continue;
      const s = big ? 28 : 22;
      if (!free(sx - s / 2, sy - s / 2, s, s) && !big) continue;
      const stairs = o.r.kind !== 'escalator';
      g.save();
      if (big) { g.shadowColor = 'rgba(26,115,232,.55)'; g.shadowBlur = 10; }
      g.fillStyle = stairs ? '#2e8b83' : '#2f65b8'; this._rr(g, sx - s / 2, sy - s / 2, s, s, 7); g.fill();
      g.restore();
      if (big) { g.strokeStyle = '#fff'; g.lineWidth = 2.4; this._rr(g, sx - s / 2, sy - s / 2, s, s, 7); g.stroke(); }
      this._arrow(g, sx, sy, o.dir, s * 0.5);
      // "2F" beside it: where it leads
      const lab = `${lvl(o.to)}`, font = `700 11px ${FONT}`, tw = this._textW(g, font, lab);
      const lx = sx + s / 2 + 2, ly = sy;
      if (big || (k > 1.1 && free(lx, ly - 8, tw + 10, 16))) {
        if (big) boxes.push([lx, ly - 8, tw + 10, 16]);
        g.fillStyle = o.dir > 0 ? '#1d4f9f' : '#b5560f'; this._rr(g, lx, ly - 8, tw + 10, 16, 8); g.fill();
        g.fillStyle = '#fff'; g.font = font; g.textAlign = 'center'; g.fillText(lab, lx + (tw + 10) / 2, ly + 0.5);
      }
      this._hits.push({ x: sx, y: sy, place: this._rampPlace(o) });
    }
    // ---- 2. the destination's block name, then the route's and the landmark names ----
    // platforms / lines
    for (const t of L.plats) {
      if (k < 0.8) break;
      const [x0, z0, x1, z1] = t.rect;
      const [sx, sy] = this.toScreen((x0 + x1) / 2, (z0 + z1) / 2);
      if (!inView(sx, sy) || t.line === 'nankai' && t.no % 2 === 0) continue;
      if (!free(sx - 10, sy - 10, 20, 20)) continue;
      const Lc = LINES[t.line];
      g.fillStyle = Lc.color; g.beginPath(); g.arc(sx, sy, 10, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#fff'; g.lineWidth = 1.6; g.stroke();
      g.fillStyle = '#fff'; g.font = `800 11px ${FONT}`; g.textAlign = 'center'; g.fillText(`${t.no}`, sx, sy + 0.5);
    }
    // ticket gates
    for (const gt of L.gates) {
      const x = gt.axis === 'x' ? (gt.from + gt.to) / 2 : gt.at, z = gt.axis === 'x' ? gt.at : (gt.from + gt.to) / 2;
      const [sx, sy] = this.toScreen(x, z);
      if (!inView(sx, sy, 60) || k < 0.7) continue;
      this._pill(g, sx, sy - 16, `改札 ${gt.name}`, '#3d4653', '#fff', 11, boxes);
    }
    // exits
    for (const e of L.exits) {
      const [sx, sy] = this.toScreen(e.x, e.z);
      if (!inView(sx, sy)) continue;
      const w = 12 + e.no.length * 7, h = 20;
      if (!free(sx - w / 2, sy - h / 2, w, h)) continue;
      g.fillStyle = '#ffd400'; g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = 1;
      this._rr(g, sx - w / 2, sy - h / 2, w, h, 4); g.fill(); g.stroke();
      g.fillStyle = '#111'; g.font = `800 12px ${FONT}`; g.textAlign = 'center'; g.fillText(e.no, sx, sy + 0.5);
      this._hits.push({ x: sx, y: sy, place: this._exitPlace(e.no) });
    }
    // toilets (WC), lockers (L), taxis (T): round, 22 px
    for (const f of L.fac) {
      const [sx, sy] = this.toScreen(f.x + f.nx * 1.2, f.z + f.nz * 1.2);
      if (!inView(sx, sy) || k < 1.2) continue;
      if (!free(sx - 11, sy - 11, 22, 22)) continue;
      g.fillStyle = f.kind === 'toilet' ? '#2b6cb0' : '#5a6372'; g.beginPath(); g.arc(sx, sy, 11, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#fff'; g.lineWidth = 1.4; g.stroke();
      g.fillStyle = '#fff'; g.font = `800 11px ${FONT}`; g.textAlign = 'center'; g.fillText(f.kind === 'toilet' ? 'WC' : f.kind === 'locker' ? 'L' : 'T', sx, sy + 0.5);
      this._hits.push({ x: sx, y: sy, place: this._facPlace(f) });
    }
    // area names (Namba CITY, Nankai Namba Station ...): big, low zoom
    if (k <= 3.4) for (const zl of L.zones) {
      const [sx, sy] = this.toScreen(zl.x, zl.z);
      if (!inView(sx, sy)) continue;
      const font = `700 12px ${FONT}`, w = this._textW(g, font, zl.en);
      if (!free(sx - w / 2, sy - 8, w, k > 1.6 ? 16 : 28)) continue;
      g.font = font; g.textAlign = 'center';
      g.lineWidth = 3.5; g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineJoin = 'round'; g.strokeText(zl.en, sx, sy);
      g.fillStyle = ZONES[zl.zone].color; g.fillText(zl.en, sx, sy);
      if (k <= 1.6) { g.font = `500 11px ${FONT}`; g.strokeText(zl.ja, sx, sy + 13); g.fillStyle = '#6f6a62'; g.fillText(zl.ja, sx, sy + 13); }
    }
    // ---- 3. shop names: the destination, the route's shops, landmarks and big tenants first; names that do not fit are left out ----
    const c = Math.cos(v.rot), s = Math.sin(v.rot);
    const cand = [];
    for (const sh of shops) {
      const [sx, sy] = this.toScreen(sh.cx, sh.cz);
      if (!inView(sx, sy, 20)) continue;
      const isDest = dest && dest.b && dest.b.slot === sh.id, isRt = onRoute.has(sh.id);
      const ew = k * (Math.abs(c) * sh.w + Math.abs(s) * sh.h), eh = k * (Math.abs(s) * sh.w + Math.abs(c) * sh.h);
      const pr = (isDest ? 1e6 : 0) + (isRt ? 5e4 : 0) + sh.base;
      cand.push({ sh, sx, sy, isDest, isRt, ew, eh, pr });
    }
    cand.sort((a, b) => b.pr - a.pr);
    const minK = 1.5;
    let n = 0;
    for (const q of cand) {
      if (n > 26) break;
      const must = q.isDest || q.isRt || q.sh.feat;
      if (k < minK && !must) continue;
      if (k < 0.9) continue;
      const name = q.sh.b.en, font = `${must ? 700 : 600} 11px ${FONT}`;
      let tw = this._textW(g, font, name), lines = [name];
      // a long name on a roomy block wraps to two lines
      if (tw > Math.max(q.ew, 70) && name.includes(' ')) {
        const parts = name.split(' '); let best = null;
        for (let i = 1; i < parts.length; i++) { const a = parts.slice(0, i).join(' '), b = parts.slice(i).join(' '), w = Math.max(this._textW(g, font, a), this._textW(g, font, b)); if (!best || w < best.w) best = { a, b, w }; }
        if (best && best.w < tw * 0.8) { lines = [best.a, best.b]; tw = best.w; }
      }
      const fits = tw + 4 <= q.ew && lines.length * 13 <= q.eh + 2;
      if (!must && !fits && k < 3.2) continue;
      const lh = 13, hh = lines.length * lh;
      if (!free(q.sx - tw / 2 - 2, q.sy - hh / 2 - 1, tw + 4, hh + 2)) continue;
      g.font = font; g.textAlign = 'center'; g.lineJoin = 'round';
      lines.forEach((t, i) => {
        const y = q.sy + (i - (lines.length - 1) / 2) * lh;
        g.lineWidth = 3.2; g.strokeStyle = 'rgba(255,255,255,0.96)'; g.strokeText(t, q.sx, y);
        g.fillStyle = q.isDest ? '#b3261e' : q.sh.b.cat === 'closed' ? '#8a8a8a' : '#2f2d29'; g.fillText(t, q.sx, y);
      });
      this._hits.push({ x: q.sx, y: q.sy, place: this._bizPlace(q.sh.b) });
      n++;
    }
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
      g.font = `600 11px ${FONT}`; g.textAlign = 'center';
      g.lineWidth = 3; g.strokeStyle = '#ffffff'; g.fillStyle = '#8c8577';
      const t = `${r.en}  ${r.ja}`; g.strokeText(t, 0, 0); g.fillText(t, 0, 0);
      g.restore();
    }
    // a tapped step: a pulsing ring where it happens
    if (this.focus >= 0 && this.steps[this.focus] && this.steps[this.focus].level === v.level) {
      const st = this.steps[this.focus], [sx, sy] = this.toScreen(st.at[0], st.at[1]);
      g.strokeStyle = '#e8710a'; g.lineWidth = 3; g.beginPath(); g.arc(sx, sy, 20, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = 'rgba(232,113,10,.35)'; g.lineWidth = 6; g.beginPath(); g.arc(sx, sy, 24, 0, Math.PI * 2); g.stroke();
    }
  }
  _arrow(g, x, y, dir, r) {
    g.strokeStyle = '#fff'; g.lineWidth = 2.4; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath();
    if (dir > 0) { g.moveTo(x, y + r * 0.8); g.lineTo(x, y - r * 0.8); g.moveTo(x - r * 0.6, y - r * 0.2); g.lineTo(x, y - r * 0.85); g.lineTo(x + r * 0.6, y - r * 0.2); }
    else { g.moveTo(x, y - r * 0.8); g.lineTo(x, y + r * 0.8); g.moveTo(x - r * 0.6, y + r * 0.2); g.lineTo(x, y + r * 0.85); g.lineTo(x + r * 0.6, y + r * 0.2); }
    g.stroke();
  }
  _rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  _pill(g, x, y, t, bg, fg, size, boxes) {
    g.font = `600 ${size}px ${FONT}`;
    const w = this._textW(g, g.font, t) + 12, h = size + 8;
    if (boxes) { for (const b of boxes) if (x - w / 2 < b[0] + b[2] && x + w / 2 > b[0] && y - h / 2 < b[1] + b[3] && y + h / 2 > b[1]) return; boxes.push([x - w / 2, y - h / 2, w, h]); }
    g.fillStyle = bg; this._rr(g, x - w / 2, y - h / 2, w, h, h / 2); g.fill();
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, x, y + 0.5);
  }
  // the shops on this floor that the route passes (within 5 m of its line), cached per route
  _routeShopSet(level) {
    const R = this.route; if (!R || !R.legs) return new Set();
    const key = `${this._routeV}:${level}`;
    if (this._rss && this._rss.key === key) return this._rss.set;
    const set = new Set();
    for (const lg of R.legs) {
      if (lg.level !== level) continue;
      const pts = lg.draw || lg.pts;
      for (const sh of this._levelShops(level)) {
        if (set.has(sh.id)) continue;
        for (let i = 0; i < pts.length; i++) { const p = pts[i]; if (p[0] > sh.x0 - 5 && p[0] < sh.x1 + 5 && p[1] > sh.z0 - 5 && p[1] < sh.z1 + 5) { set.add(sh.id); break; } }
      }
    }
    this._rss = { key, set };
    return set;
  }

  _drawPins(g) {
    const v = this.view;
    const pin = (p, main) => {
      if (p.level !== v.level) return;
      const [sx, sy] = this.toScreen(p.x, p.z);
      g.save();
      const s = main ? 1.15 : 0.62;
      g.translate(sx, sy);
      g.fillStyle = 'rgba(0,0,0,0.22)'; g.beginPath(); g.ellipse(0, 1, 6 * s, 2.5 * s, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = main ? '#d93025' : '#d4534e';
      g.beginPath(); g.moveTo(0, 0); g.bezierCurveTo(-4 * s, -10 * s, -13 * s, -16 * s, -13 * s, -25 * s); g.arc(0, -25 * s, 13 * s, Math.PI, 0); g.bezierCurveTo(13 * s, -16 * s, 4 * s, -10 * s, 0, 0); g.fill();
      g.lineWidth = main ? 2 : 1.2; g.strokeStyle = '#fff'; g.stroke();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(0, -25 * s, 5 * s, 0, Math.PI * 2); g.fill();
      g.restore();
      this._hits.push({ x: sx, y: sy - 25 * s, place: p });
    };
    if (this.sheet === 'results') for (const r of this.results.slice(0, 12)) if (r !== this.selected) pin(r, false);
    const R = this.route;
    if (this.selected) pin(this.selected, true);
    else if (R && R.target) pin(R.target, true);
  }

  _drawMe(g) {
    const p = this.pos, v = this.view, W = this._where();
    const [sx, sy] = this.toScreen(p.x, p.z);
    const same = p.level === v.level;
    const stale = p.mode === 'gps' && p.state === 'stale', unsure = W.unsure;
    // the other floor the phone may be on: the same circle, dashed, no dot (it does not know where on that floor)
    if (!same && unsure && W.levels.includes(v.level)) {
      const r = Math.max(14, Math.min(190, p.acc * v.zoom));
      g.save(); g.strokeStyle = 'rgba(26,115,232,.55)'; g.lineWidth = 2; g.setLineDash([6, 5]); g.fillStyle = 'rgba(26,115,232,.07)';
      g.beginPath(); g.arc(sx, sy, r, 0, Math.PI * 2); g.fill(); g.stroke(); g.setLineDash([]);
      g.fillStyle = 'rgba(26,115,232,.8)'; g.font = `800 15px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('?', sx, sy);
      g.restore();
      return;
    }
    if (!same) return;
    g.save();
    // the accuracy circle: as wide as the phone's own estimate says, never a confident dot
    const r = Math.max(12, Math.min(190, p.acc * v.zoom));
    g.fillStyle = stale ? 'rgba(120,130,145,0.14)' : 'rgba(26,115,232,0.14)'; g.strokeStyle = stale ? 'rgba(110,120,135,0.7)' : 'rgba(26,115,232,0.55)'; g.lineWidth = 1.6;
    if (stale || unsure) g.setLineDash([6, 4]);
    g.beginPath(); g.arc(sx, sy, r, 0, Math.PI * 2); g.fill(); g.stroke(); g.setLineDash([]);
    // heading (the compass is reliable): a cone and an arrow on the dot
    const ang = -(p.heading - v.rot) - Math.PI / 2;           // yaw 0 = up
    const gr = g.createRadialGradient(sx, sy, 2, sx, sy, 52);
    gr.addColorStop(0, `rgba(26,115,232,${unsure ? 0.5 : 0.65})`); gr.addColorStop(1, 'rgba(26,115,232,0)');
    g.fillStyle = gr; g.beginPath(); g.moveTo(sx, sy); g.arc(sx, sy, 52, ang - 0.5, ang + 0.5); g.closePath(); g.fill();
    // the dot: solid blue on a fix; hollow and pale when the phone is guessing
    g.shadowColor = 'rgba(0,0,0,0.35)'; g.shadowBlur = 5;
    g.fillStyle = '#fff'; g.beginPath(); g.arc(sx, sy, 11, 0, Math.PI * 2); g.fill();
    g.shadowBlur = 0;
    if (unsure || stale) { g.fillStyle = 'rgba(26,115,232,.18)'; g.beginPath(); g.arc(sx, sy, 8.5, 0, Math.PI * 2); g.fill(); g.strokeStyle = stale ? '#7d8794' : '#1a73e8'; g.lineWidth = 2.2; g.beginPath(); g.arc(sx, sy, 8.5, 0, Math.PI * 2); g.stroke(); }
    else { g.fillStyle = '#1a73e8'; g.beginPath(); g.arc(sx, sy, 8.5, 0, Math.PI * 2); g.fill(); }
    // the arrow: always drawn, always right
    g.translate(sx, sy); g.rotate(ang + Math.PI / 2);
    g.fillStyle = unsure || stale ? (stale ? '#5f6b7a' : '#1a73e8') : '#fff';
    g.beginPath(); g.moveTo(0, -6.6); g.lineTo(5, 5); g.lineTo(0, 2.4); g.lineTo(-5, 5); g.closePath(); g.fill();
    g.restore();
  }

  // an arrow at the edge of the plan when the destination pin is on this floor but off screen
  _drawEdgeArrow(g) {
    const R = this.route, t = this.selected || (R && R.target); if (!t || t.level !== this.view.level || this.sheet !== 'map') return;
    const [sx, sy] = this.toScreen(t.x, t.z), W = this.W, ins = this._ins;
    if (sx > 14 && sx < W - 14 && sy > ins.t + 6 && sy < this.H - ins.b - 6) return;
    const cx = W / 2, cy = ins.t + (this.H - ins.t - ins.b) / 2, a = Math.atan2(sy - cy, sx - cx);
    const mx = W / 2 - 22, my = (this.H - ins.t - ins.b) / 2 - 20;
    const k = Math.min(Math.abs(mx / Math.cos(a || 1e-6)), Math.abs(my / Math.sin(a || 1e-6)));
    const x = cx + Math.cos(a) * k, y = cy + Math.sin(a) * k;
    g.save(); g.translate(x, y); g.rotate(a);
    g.fillStyle = '#d93025'; g.strokeStyle = '#fff'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(13, 0); g.lineTo(-8, -10); g.lineTo(-3, 0); g.lineTo(-8, 10); g.closePath(); g.stroke(); g.fill();
    g.restore();
  }
  // north marker on the plan when it is turned (heading up): a small "N" on a rose pointing north
  // the north rose, when the plan is turned (heading up)
  _drawRose(g) {
    const v = this.view; if (Math.abs(v.rot) < 0.04) return;
    const x = this.W - 26, y = this.H - this._ins.b - 28;
    g.save(); g.translate(x, y); g.rotate(v.rot);
    g.fillStyle = 'rgba(255,255,255,.94)'; g.shadowColor = 'rgba(0,0,0,.25)'; g.shadowBlur = 4; g.beginPath(); g.arc(0, 0, 16, 0, Math.PI * 2); g.fill(); g.shadowBlur = 0;
    g.fillStyle = '#d93025'; g.beginPath(); g.moveTo(0, -14); g.lineTo(5, 0); g.lineTo(-5, 0); g.closePath(); g.fill();
    g.fillStyle = '#8a9099'; g.beginPath(); g.moveTo(0, 14); g.lineTo(5, 0); g.lineTo(-5, 0); g.closePath(); g.fill();
    g.restore();
    g.fillStyle = '#d93025'; g.font = `800 11px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  }
  // "you are facing this way": a fixed compass badge at the bottom centre (a direction, never a location)
  _drawWedge(g) {
    if (this._where().gps) return;     // on a GPS fix the dot has its own heading cone
    const v = this.view, p = this.pos, x = this.W / 2, y = this.H - this._ins.b - 36;
    const ang = -(p.heading - v.rot) - Math.PI / 2;
    g.save();
    g.shadowColor = 'rgba(0,0,0,.3)'; g.shadowBlur = 5; g.fillStyle = 'rgba(255,255,255,.95)'; g.beginPath(); g.arc(x, y, 25, 0, Math.PI * 2); g.fill(); g.shadowBlur = 0;
    const gr = g.createRadialGradient(x, y, 2, x, y, 23); gr.addColorStop(0, 'rgba(26,115,232,.95)'); gr.addColorStop(1, 'rgba(26,115,232,.55)');
    g.fillStyle = gr; g.beginPath(); g.moveTo(x, y); g.arc(x, y, 23, ang - 0.62, ang + 0.62); g.closePath(); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, 4.5, 0, Math.PI * 2); g.fill();
    g.font = `700 11px ${FONT}`; g.textAlign = 'left'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,.95)';
    ['You face', 'this way'].forEach((t, i) => { g.strokeText(t, x + 30, y - 7 + i * 14); g.fillStyle = '#1558b8'; g.fillText(t, x + 30, y - 7 + i * 14); });
    g.restore();
  }
  // the one place the map shows where you were: the last known moment, ageing to a faint ghost
  _drawKnown(g) {
    const k = this.known; if (!k || k.level !== this.view.level) return;
    const age = this._clk - k.t0, a = age < 90 ? 1 - 0.62 * age / 90 : 0.38;
    const [sx, sy] = this.toScreen(k.x, k.z);
    g.save(); g.globalAlpha = a; g.textBaseline = 'middle'; g.textAlign = 'center';
    g.shadowColor = 'rgba(0,0,0,.3)'; g.shadowBlur = 4; g.fillStyle = '#fff'; g.beginPath(); g.arc(sx, sy, 12, 0, Math.PI * 2); g.fill(); g.shadowBlur = 0;
    g.fillStyle = '#e8710a'; g.beginPath(); g.arc(sx, sy, 8.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(sx, sy - 2.6, 2.4, 0, Math.PI * 2); g.fill(); g.beginPath(); g.moveTo(sx - 4, sy + 5); g.quadraticCurveTo(sx, sy - 1, sx + 4, sy + 5); g.closePath(); g.fill();
    const f1 = `700 11px ${FONT}`, f2 = `600 11px ${FONT}`, l2 = `${this._ageTxt(age)} ago`;
    // the label wraps (nothing is cut): up to ~118 px wide, to the right of the marker (left when there is no room)
    const lines = []; let cur = '';
    for (const wd of k.text.split(' ')) { const t = cur ? `${cur} ${wd}` : wd; if (cur && this._textW(g, f1, t) > 118) { lines.push(cur); cur = wd; } else cur = t; }
    lines.push(cur);
    const w = Math.max(this._textW(g, f2, l2), ...lines.map(t => this._textW(g, f1, t))) + 20, h = lines.length * 13 + 13 + 10;
    let x = sx + 18 + w / 2; if (x + w / 2 > this.W - 4) x = sx - 18 - w / 2; x = Math.max(4 + w / 2, x);
    const y = sy;
    g.fillStyle = '#fff4e5'; g.strokeStyle = '#e8710a'; g.lineWidth = 1.5; this._rr(g, x - w / 2, y - h / 2, w, h, 9); g.fill(); g.stroke();
    g.fillStyle = '#5a2d00'; g.font = f1;
    lines.forEach((t, i) => g.fillText(t, x, y - h / 2 + 11 + i * 13));
    g.font = f2; g.fillStyle = '#8a5a2b'; g.fillText(l2, x, y - h / 2 + 11 + lines.length * 13 + 1);
    g.restore();
  }
  // the destination's shop block, outlined
  _drawDestBlock(g, v) {
    const t = this.selected || (this.route && this.route.target);
    if (!t || t.kind !== 'biz' || t.level !== v.level || !t.b) return;
    const sh = this._levelShops(v.level).find(q => q.id === t.b.slot); if (!sh) return;
    g.fillStyle = 'rgba(217,48,37,.2)'; g.fillRect(sh.x0, sh.z0, sh.w, sh.h);
    g.strokeStyle = '#d93025'; g.lineWidth = 2.4 / v.zoom; g.strokeRect(sh.x0, sh.z0, sh.w, sh.h);
  }
  // v23 round 2: a thin DASHED line: a suggestion between two known places, not a guide
  _drawRoute(g, zoom, dpr) {
    const R = this.route, v = this.view;
    g.lineJoin = 'round'; g.lineCap = 'butt';
    const k = zoom * dpr;
    for (const lg of R.legs) {
      if (lg.level !== v.level || !lg.draw || lg.draw.length < 2) continue;
      const pts = lg.draw;
      g.setLineDash([8 / zoom, 6 / zoom]);
      g.strokeStyle = 'rgba(255,255,255,.95)'; g.lineWidth = 5.5 / k * dpr;
      g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (const p of pts) g.lineTo(p[0], p[1]); g.stroke();
      g.strokeStyle = '#1a5fd0'; g.lineWidth = 3 / k * dpr;
      g.stroke();
    }
    g.setLineDash([]);
  }
  // ------------------------------------------------------------ search ----
  // What the maps app lists is what the directory knows (the v23 plan is true; only YOU are vague). Tiny places keep a
  // Japanese-only name.
  _view(b) {
    const c = this._views || (this._views = new Map());
    let v = c.get(b.slot); if (v) return v;
    v = { ...b, raw: b };
    const ov = LISTING[b.key];
    if (ov) Object.assign(v, ov);
    if (ov && ov.jaOnly) { v.en = b.ja; v.ja = ''; }
    v.px = b.door ? b.door.ox : b.x; v.pz = b.door ? b.door.oz : b.z;
    c.set(b.slot, v);
    return v;
  }
  _bizPlace(b) {
    b = b.raw ? b : this._view(b);
    return { id: 'b:' + b.slot, kind: 'biz', b, en: b.en, ja: b.ja, level: b.level, x: b.px, z: b.pz, sub: `${CATEGORIES[b.cat].en} · ${ZONES[b.zone] ? ZONES[b.zone].name : ''}` };
  }
  _facPlace(f) {
    const Fi = FACILITY_INFO[f.kind];
    return { id: 'f:' + f.id, kind: 'fac', fac: f, en: Fi.en, ja: Fi.ja, level: f.level, x: f.x + f.nx * 1.5, z: f.z + f.nz * 1.5, sub: `${Fi.en} · ${lvl(f.level)}`, icon: f.kind === 'toilet' ? '🚻' : f.kind === 'locker' ? '🔑' : '🚕' };
  }
  _exitPlace(no) {
    const ex = LAYOUT.exits.find(e => EXIT_INFO[e.id] && EXIT_INFO[e.id].no === no);
    const info = EXIT_INFO[ex.id];
    return { id: 'x:' + no, kind: 'exit', en: `Exit ${no}`, ja: `${no}番出口`, level: ex.level, x: ex.x, z: ex.z, sub: info.to.map(t => t[1]).join(' · '), exitNo: no };
  }
  _transitPlace(t) { return { id: 't:' + t.id, kind: 'transit', t, en: t.en, ja: t.ja, level: t.at[0], x: t.at[1], z: t.at[2], sub: t.sub, line: t.line }; }
  // a connector, as a thing you can tap to read ("Escalator up to 2F")
  _rampPlace(o) {
    const w = o.r.kind === 'escalator' ? 'Escalator' : 'Stairs';
    return { id: 'r:' + o.r.id, kind: 'ramp', en: `${w} ${o.dir > 0 ? 'up' : 'down'} to ${lvl(o.to)}`, ja: '', level: o.dir > 0 ? o.r.lower : o.r.upper, x: o.x, z: o.z, sub: `${w} · ${lvl(o.dir > 0 ? o.r.lower : o.r.upper)} → ${lvl(o.to)}` };
  }

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
  // "6F · about 300 m": the floor says more than the metres do
  _farTxt(p) { return lvl(p.level); }

  _suggest(q) {
    if (!q || !q.trim()) {
      this.sugg.innerHTML = `<div class="mq-sugg-h">Recent</div>` + ['coffee', 'tempura', 'Midosuji Line', 'Shin-Osaka'].map(s => `<button type="button" class="mq-sugg-i" data-q="${s}"><span class="mq-sugg-ic">🕘</span>${s}</button>`).join('');
    } else {
      const res = this.search(q).slice(0, 6);
      this.sugg.innerHTML = `<button type="button" class="mq-sugg-i" data-q="${esc(q)}"><span class="mq-sugg-ic">⌕</span>Search “${esc(q)}”</button>` +
        res.map((r, i) => `<button type="button" class="mq-sugg-i" data-i="${i}"><span class="mq-sugg-ic">${this._iconHtml(r)}</span><span><b>${esc(r.en)}</b><small>${esc(r.ja || '')} · ${lvl(r.level)}</small></span></button>`).join('');
      this._suggRes = res;
    }
    this.sugg.hidden = false;
    this.sugg.querySelectorAll('.mq-sugg-i').forEach(el => el.addEventListener('mousedown', (e) => {
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
    if (r.kind === 'ramp') return `<i class="mp-ic service">${r.en.startsWith('Esc') ? '🛗' : '🪜'}</i>`;
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
  clearSearch() { this.results = []; this.selected = null; this._dirty = true; if (this.sheet === 'results' || this.sheet === 'place') this.closePanel(); }

  // ------------------------------------------------------------- panels ----
  // one panel at a time over the plan. 'place' is a card from the bottom (the pin stays in sight); the others fill the box
  _openPanel(name, title, html, opts = {}) {
    this.sheet = name; this._dirty = true; this._measured = false;
    this.panelT.textContent = title || '';
    this.panelB.innerHTML = html;
    this.panelB.scrollTop = 0;
    this.panel.hidden = false;
    this.panel.className = `mq-panel mq-p-${name}`;
    this.root.classList.toggle('mq-has-panel', name !== 'map');
    this._syncUI(true);
  }
  closePanel() {
    if (this.sheet === 'map') return false;
    if (this.sheet === 'place' && this.route) this.selected = null;
    this.panel.hidden = true; this.sheet = 'map'; this._dirty = true; this._measured = false;
    this.root.classList.remove('mq-has-panel');
    this._hideSugg();
    this.list = null;
    this._syncUI(true);
    return true;
  }
  showHome() { this.results = []; if (!this.route) this.selected = null; this.closePanel(); this._syncUI(true); }
  openList() {
    const p = this.pos, D = this.phone.dest, arr = D && D.current && D.current.arrived ? D.current : null;
    this._hideSugg();
    this._openPanel('home', arr ? 'Where next?' : 'Where to?', `<div class="mq-here"><i class="mq-here-dot"></i><div><b class="mq-home-t"></b><small class="mq-home-s"></small></div></div><div class="mq-dl"></div>`);
    this.list = new DestList(this.panelB.querySelector('.mq-dl'), {
      theme: 'maps', chips: true, title: '',
      onPick: (it) => this._pickItem(it), onQuery: (q) => { if (q) { this.input.value = q.replace(/^\w/, c => c.toUpperCase()); this.doSearch(q); } },
    });
    this.list.touch = this.touch;
    this._renderHomeList();
    this._refreshHome();
  }
  _renderHomeList() {
    if (this.sheet !== 'home' || !this.list) return;
    const D = this.phone.dest, sug = D ? D.suggested : null, cur = D && D.current;
    const ids = defaultIds(sug && !(cur && cur.arrived && cur.id === sug) ? sug : null, cur && cur.arrived ? cur.id : null);
    // v23: the Nankai ticket gates are always one tap away (the way back to the train), whoever suggested what
    const gate = this.phone.dest && 't:tp_nk_gate';
    if (gate && !ids.includes(gate) && !(cur && !cur.arrived && cur.id === gate)) ids.splice(Math.min(2, ids.length), 0, gate);
    const items = ids.map(id => this._itemFor(id, id === sug ? (cur && cur.arrived ? 'Next · from Aya' : 'From Aya') : null)).filter(Boolean);
    this.list.render(items);
  }
  // a list row for a destination id (distances are from where the PHONE thinks you are, and say so by rounding)
  _itemFor(id, aya) {
    const p = this.placeById(id); if (!p) return null;
    const mins = this.ctx.clock.minutes;
    if (p.kind === 'biz') {
      const b = p.b, s = bizSub(b, mins);
      const name = aya && p.en !== b.raw.en ? b.raw.en : p.en, sub = aya && name !== p.en ? `${p.en} · ${s.sub}` : s.sub;
      return { id, place: p, name, iconHtml: this._iconHtml(p), aya, closed: s.closed, sub: s.status ? `${sub} · ${s.status}` : sub, right: this._farTxt(p) };
    }
    return { id, place: p, name: p.en, iconHtml: this._iconHtml(p), aya, sub: `${p.sub || ''}`.split(' · ').slice(0, 2).join(' · ') || lvl(p.level), right: this._farTxt(p) };
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
    if (!d) { this.route = null; this.steps = []; this._routeV++; this.selected = null; this.results = []; this.focus = -1; this.closePanel(); this._syncUI(true); return; }
    const p = this.placeById(d.id); if (!p) return;
    if (this.route && this.route.target && destIdOf(this.route.target) === d.id && !this.route.arrived) { if (fromMaps) this.openSteps(); return; }
    this.results = [p];
    this.selected = null;
    this.follow = false;
    this.closePanel();
    this.startRoute(p);
  }
  onArrived(d) {
    this.route = null; this.steps = []; this._routeV++; this.selected = null; this.results = []; this.focus = -1;
    this.follow = true; this._arrivedName = d && d.name;
    this._toast(`Arrived · ${d ? d.name : ''}`, 4000);
    this.closePanel();
    this._syncUI(true);
  }
  onListChanged() { if (this.sheet === 'home') this._renderHomeList(); else if (this.sheet === 'steps') this.openSteps(true); this._syncUI(true); }
  // the list the keyboard drives (1–9, ↑↓ Enter) while Maps is up
  activeList() {
    if (this.sheet === 'steps') return this._next || null;
    if (this.sheet === 'place') return this._placeList || null;
    if (this.sheet === 'home' || this.sheet === 'results') return this.list && this.list.items.length ? this.list : null;
    if (this.sheet === 'map' && !this.route) return this._ayaList || null;
    return null;
  }
  focusSearch() {
    if (this.touch) { this.openList(); return true; }
    this.input.focus(); return true;
  }
  _refreshHome() {
    if (this.sheet !== 'home' || !this.panelB) return;
    const set = (c, t) => { const e = this.panelB.querySelector(c); if (e && e.textContent !== t) e.textContent = t; };
    const w = this._where(), y = this._youText(w), k = this.known;
    set('.mq-home-t', y.a); set('.mq-home-s', y.b ? `${y.b}${k && !w.gps ? ` · ${this._ageTxt(this._clk - k.t0)} ago` : ''}` : '');
    const dot = this.panelB.querySelector('.mq-here-dot'); if (dot) dot.classList.toggle('ok', w.gps);
  }
  // ---- the lowered phone's glance card: honest, no metre-precise distance from a position the phone does not have ----
  glanceInfo() {
    const R = this.route, k = this.known, W = this._where();
    const pinTxt = k && this._clk - k.t0 < 90 ? k.glance : null;
    if (R && R.arrived) return { kind: 'arr', icon: 'check', ang: 0, title: 'You have arrived', sub: R.target.en, warn: '' };
    const areaOf = (t) => (t.kind === 'biz' ? zoneShort(t.b.zone) : (t.sub || '').split(' · ')[0]) || '';
    if (R && !R.failed && R.target) {
      const t = R.target, where = `${areaOf(t) ? areaOf(t) + ' · ' : ''}${lvl(t.level)}`;
      return { kind: 'crow', icon: 'pin', title: `To ${t.en}`, sub: pinTxt || where, warn: '' };
    }
    const D = this.phone.dest, C = D && D.current, nx = D && D.next(), sug = nx && D.name(nx);
    if (C && C.arrived) return { kind: 'arr', icon: 'check', title: `Arrived · ${C.name}`, sub: sug ? `Next: ${sug}` : (pinTxt || ''), warn: '' };
    if (this.phone._ended) return { kind: 'pick', icon: 'pin', title: 'No route', sub: pinTxt || (sug ? `Where to? · Aya: ${sug}` : 'Where to?'), warn: '' };
    return { kind: 'pick', icon: 'pin', title: 'Pick a place in Maps', sub: pinTxt || (sug ? `Aya: ${sug}` : 'Where to?'), warn: '' };
  }
  showResults() {
    const mins = this.ctx.clock.minutes;
    const D = this.phone.dest, sug = D && D.suggested;
    this._openPanel('results', this.results.length ? `“${this.query}”` : 'No results', `${this.pos.noService ? '<div class="mq-offline">Offline · saved map</div>' : ''}<div class="mq-dl"></div>${this.results.length ? '' : '<div class="mp-empty">Try “coffee”, “tempura”, “Midosuji”…</div>'}`);
    this.list = new DestList(this.panelB.querySelector('.mq-dl'), { theme: 'maps', chips: false, title: '', onPick: (it) => this._pickItem(it) });
    this.list.touch = this.touch;
    // like every maps app: rating, open / closed, floor and a rounded distance (Aya's pick is marked where it shows up)
    this.list.render(this.results.slice(0, 25).map(r => {
      const id = destIdOf(r);
      let subHtml = esc(r.sub || ''), closed = false;
      if (r.kind === 'biz') {
        const b = r.b, open = isOpen(b, mins); closed = !open;
        const st = b.cat === 'closed' ? `<span class="mp-closed">Closed for renovation</span>` : open ? `<span class="mp-open">Open</span>` : `<span class="mp-closed">Closed · opens ${hm(b.hours[0])}</span>`;
        subHtml = `<span class="mp-stars">${b.rating ? b.rating.toFixed(1) : '–'} ${this._stars(b.rating)}</span> · ${esc(CATEGORIES[b.cat].en.replace(/ \(.*\)$/, ''))} · ${st}`;
      }
      return { id, place: r, name: r.en, iconHtml: this._iconHtml(r), aya: id && id === sug ? 'From Aya' : null, subHtml, closed, right: this._farTxt(r) };
    }));
    if (this.results.length) { this.follow = false; this._fit(this.results.filter(r => r.level === this.view.level).slice(0, 12).map(r => [r.x, r.z]), 3); }
  }
  _stars(r) { const n = Math.round(r || 0); return '<i class="mp-st">' + '★'.repeat(n) + '<u>' + '★'.repeat(5 - n) + '</u></i>'; }

  select(p) {
    if (!p) return;
    if (p.kind === 'area' && p.id && p.id.startsWith('a_') && !p.level) return;
    this.selected = p;
    // show the pin's floor: a place card is about that place
    this.follow = false;
    if (p.level !== this.view.level) { this.view.level = p.level; this._renderStrip(); }
    this.showPlace(p);
    this._fit([[p.x, p.z]], 3.2, 30);
  }
  showPlace(p) {
    const mins = this.ctx.clock.minutes;
    const otherFloor = p.level !== this.pos.level;
    const floorNote = otherFloor ? `<div class="mp-note">📍 On <b>${lvl(p.level)}</b></div>` : '';
    const crow = this._farTxt(p);
    let body = '';
    if (p.kind === 'biz') {
      const b = p.b, open = isOpen(b, mins);
      const st = b.cat === 'closed' ? `<span class="mp-closed">Closed for renovation</span>` : open ? `<span class="mp-open">Open now</span> · until ${hm(b.hours[1])}` : `<span class="mp-closed">Closed</span> · opens ${hm(b.hours[0])}`;
      const revs = reviewsFor(b).map(r => `<div class="mp-rev"><div class="mp-rev-h"><i>${r.who[0]}</i><b>${esc(r.who)}</b><span class="mp-st">${'★'.repeat(r.stars)}<u>${'★'.repeat(5 - r.stars)}</u></span><small>${r.when}</small></div><p>${esc(r.text)}</p></div>`).join('');
      body = `<div class="mp-pc"><div class="mp-pc-t">${esc(b.en)}</div><div class="mp-pc-ja">${esc(b.ja)}</div>
        <div class="mp-pc-meta"><span class="mp-fl">${lvl(b.level)}</span> ${esc(ZONES[b.zone] ? ZONES[b.zone].name : '')} · <span class="mp-stars">${b.rating ? b.rating.toFixed(1) : '–'} ${this._stars(b.rating)}</span> <span class="mp-dim">(${b.reviews.toLocaleString('en')})</span></div>
        <div class="mp-pc-meta">${esc(CATEGORIES[b.cat].en)} · ${st}</div>${floorNote}
        <div class="mq-actions"><button class="mq-go" type="button">Directions</button></div>
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
        <div class="mp-pc-meta">${esc(t.sub)}</div><div class="mp-pc-meta"><span class="mp-fl">${lvl(p.level)}</span> · ${crow}${t.offmap ? ' · <span class="mp-dim">outside this map</span>' : ''}</div>${floorNote}
        <div class="mq-actions"><button class="mq-go" type="button">Directions</button></div>${trip}
        <p class="mp-blurb mp-dim">“Namba” is four different stations: Osaka Metro なんば, Nankai なんば, Kintetsu/Hanshin 大阪難波 and JR難波. Check the operator.</p></div>`;
    } else {
      body = `<div class="mp-pc"><div class="mp-tr-h">${this._iconHtml(p)}<div><div class="mp-pc-t">${esc(p.en)}</div><div class="mp-pc-ja">${esc(p.ja || '')}</div></div></div>
        <div class="mp-pc-meta">${esc(p.sub || '')}</div><div class="mp-pc-meta"><span class="mp-fl">${lvl(p.level)}</span> · ${crow}</div>${floorNote}
        ${p.kind === 'ramp' ? '' : '<div class="mq-actions"><button class="mq-go" type="button">Directions</button></div>'}</div>`;
    }
    this._openPanel('place', '', body);
    this.panelT.textContent = '';
    const go = this.panelB.querySelector('.mq-go');
    if (go) {
      if (!this.touch) go.insertAdjacentHTML('beforeend', ' <kbd class="mp-k">Enter</kbd>');
      go.addEventListener('click', () => this._goPlace(p));
    }
    // (keyboard: the place card is a one-row list: 1 / Enter = Directions)
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
    this.route = { target, legs: [], leg: null };
    this.focus = -1;
    this._computeRoute(true);
    this.ctx.events.emit('phone:route', { id: target.id, level: target.level });
  }
  // directions are a static overview between two known places: from the LAST KNOWN spot (the arrival, a photo, a gate, a café) to the pin
  _computeRoute(first) {
    const R = this.route; if (!R) return;
    const nav = this.ctx.nav; if (!nav) return;
    const t = R.target, from = this.known || (() => { const h = this._trueHere(); return h && { level: h.level, x: h.x, z: h.z, where: lvl(h.level), id: 0 }; })();
    if (!from) { R.failed = true; return; }
    const key = 'phone:' + t.id;
    // anything that is not a train/gate/platform must not route through the fare gates
    const f = t.kind === 'transit' ? nav.fieldToPoint(key, t.level, t.x, t.z) : fieldNoEntry(nav, key, [nav.nodeAtPoint(t.level, t.x, t.z)]);
    let v = nav.nodeAtPoint(from.level, from.x, from.z);
    if (v < 0 || !isFinite(f.dist[v])) {
      for (let r = 2; r <= 14 && (v < 0 || !isFinite(f.dist[v])); r += 2) for (let a = 0; a < 8; a++) {
        const w = nav.nodeAtPoint(from.level, from.x + Math.cos(a * 0.785) * r, from.z + Math.sin(a * 0.785) * r);
        if (w >= 0 && isFinite(f.dist[w])) { v = w; break; }
      }
    }
    if (v < 0 || !isFinite(f.dist[v])) { R.failed = true; this._routeV++; this._syncUI(true); return; }
    R.failed = false;
    R.legs = routeLegs(nav, f, v);
    for (const lg of R.legs) lg.draw = simplify(lg.pts, 0.9);
    R.leg = R.legs[0];
    R.total = f.dist[v];
    R.fromId = from.id; R.fromWhere = from.where; R.floors = routeFloors(R);
    this.steps = buildSteps(R, this.ctx.world);
    this._routeV++; this._rss = null;
    if (first) {
      // the plan shows the pin's place, or the stretch of the route on the floor you are on
      const lg = R.legs.find(l => l.level === from.level), dl = R.legs[R.legs.length - 1];
      this.view.level = from.level;
      if (lg) this._fit(lg.draw.concat([[from.x, from.z]]), 3.0, 40);
      this._renderStrip();
    }
    this._syncUI(true);
  }

  // End / × on the route = no destination any more
  endRoute() {
    this.route = null; this.steps = []; this._routeV++; this.selected = null; this.results = []; this.focus = -1;
    const C = this.phone.dest && this.phone.dest.current;
    this.closePanel();
    if (C && !C.arrived && this.phone.endRoute) this.phone.endRoute('maps');
    else if (C) this.phone.clearDestination(); else this.showHome();
  }
  // the next milestone as Maps believes it: the first connector at or after the current step, or the place itself
  milestone() {
    const R = this.route; if (!R || R.failed || R.arrived || !R.target) return null;
    const h = this._trueHere(); if (!h) return null;
    const st = this.steps.find(s => s.kind === 'ramp' && s.level === h.level);
    if (st) return { kind: st.ramp === 'escalator' ? 'escalator' : 'stairs', dir: st.dir > 0 ? 'up' : 'down', toLevel: st.to, dist: Math.round(Math.hypot(st.at[0] - h.x, st.at[1] - h.z)), level: st.level, x: st.at[0], z: st.at[1], side: null, app: 'maps' };
    const t = R.target;
    return { kind: 'arrive', dir: null, toLevel: t.level, dist: Math.round(Math.hypot(t.x - h.x, t.z - h.z)), name: t.en, level: t.level, x: t.x, z: t.z, side: null, app: 'maps' };
  }
  // a place link from a text: its place card, Directions = Go (click / Enter / 1)
  preview(id) {
    const p = this.placeById(id); if (!p) return false;
    this._linkGo = { id: destIdOf(p) || id, p };
    this.select(p);
    return true;
  }
  closePreview() {
    if (this.sheet !== 'place') return false;
    this.selected = null; this._linkGo = null;
    this.closePanel();
    return true;
  }

  // ------------------------------------------------------------ UI layer ----
  _toast(t, ms = 2200) {
    this.toastEl.textContent = t; this.toastEl.hidden = false; this._dirty = true; this._toastV = (this._toastV || 0) + 1;
    clearTimeout(this._toastT); this._toastT = setTimeout(() => { this.toastEl.hidden = true; }, ms);
  }
  _toggleOrient() {
    this.headingUp = !this.headingUp; this.follow = true; this._dirty = true;
    this._toast(this.headingUp ? 'Heading up · the map turns with you' : 'North up', 2200);
    this._syncUI(true);
  }
  _recenter() {
    const W = this._where(), k = this.known;
    this.focus = -1;
    if (W.gps) { this.follow = true; this.view.level = this.pos.level; }
    else if (k) { this.view.level = k.level; this.view.cx = k.x; this.view.cz = k.z; this.follow = false; }
    this.view.zoom = Math.max(this.view.zoom, 2.2); this._dirty = true;
    this._renderStrip(); this._syncUI(true);
  }
  _showFloor(l) {
    this.view.level = l; this.focus = -1;
    this.follow = this._where().gps && l === this.pos.level;
    this._dirty = true; this._renderStrip();
    // the floor's part of the route; else the pin; else the last known spot; else the whole floor
    const R = this.route, lg = R && R.legs && R.legs.find(q => q.level === l), k = this.known;
    if (lg && lg.draw && lg.draw.length > 1) this._fit(lg.draw, 3.2, 34);
    else if (this.selected && this.selected.level === l) this._fit([[this.selected.x, this.selected.z]], 3, 40);
    else if (k && k.level === l) { this.view.cx = k.x; this.view.cz = k.z; }
    else { const g = this.ctx.world.grids[l]; if (g) { this.view.cx = g.x0 + g.w / 2; this.view.cz = g.z0 + g.h / 2; if (this.view.zoom > 2) this.view.zoom = 1.6; } }
    this._syncUI(true);
  }
  _renderStrip(force) {
    const R = this.route, T = R ? R.target : this.selected, K = this.known, W = this._where();
    const key = [this.view.level, T ? T.level : '', K ? K.level : '', W.gps ? this.pos.level : ''].join('|');
    if (!force && key === this._stripKey) return;
    this._stripKey = key;
    const lv = LEVEL_ORDER.filter(l => this.ctx.world.grids[l]);
    this.strip.innerHTML = lv.map(l => {
      const pin = T && T.level === l, ghost = K && K.level === l, gps = W.gps && this.pos.level === l;
      const name = FLOOR_NAMES[l] || '';
      return `<button type="button" role="tab" data-l="${l}" class="${l === this.view.level ? 'on' : ''}${ghost ? ' ghost' : ''}${pin ? ' pin' : ''}${gps ? ' gps' : ''}" aria-label="${lvl(l)} ${esc(name)}${pin ? ', destination' : ''}${ghost ? ', last known place' : ''}"><b>${lvl(l)}</b>${ghost || gps ? '<i class="dot"></i>' : ''}${pin ? `<em>${I.pin}</em>` : ''}</button>`;
    }).join('');
    // scroll so the viewed floor, the destination's and the last known one are in view when they fit
    const on = this.strip.querySelector('.on'); if (!on) return;
    const idx = (l) => lv.indexOf(l), bw = on.offsetWidth || 44, vw = this.strip.clientWidth || 300;
    const set = [this.view.level].concat(T ? [T.level] : []).concat(K ? [K.level] : []).map(idx).filter(i => i >= 0);
    const lo = Math.min(...set), hi = Math.max(...set);
    let left;
    if ((hi - lo + 1) * bw <= vw) left = (lo + hi + 1) / 2 * bw - vw / 2; else left = (idx(this.view.level) + 0.5) * bw - vw / 2;
    this.strip.scrollLeft = Math.max(0, left);
  }
  // text, classes and chips that follow the state (written only when they change)
  _syncUI(force) {
    const R = this.route, W = this._where(), v = this.view;
    const setT = (el, t) => { if (el && el.textContent !== t) el.textContent = t; };
    // the floor you are looking at, named the way the signs name it
    setT(this.flEl, `${lvl(v.level)} · ${FLOOR_NAMES[v.level] || ''}`);
    this.flEl.classList.toggle('other', !!this.known && v.level !== this.known.level);
    // no GPS indoors: one quiet chip (tap for the tip); a real fix outdoors says so
    setT(this.meEl.querySelector('b'), W.gps ? `GPS ±${Math.round(this.pos.acc)} m` : 'No GPS indoors');
    this.meEl.classList.toggle('ok', W.gps);
    // the top bar: search, or the destination (name, where it is) and Directions
    const D = this.phone.dest, arr = D && D.current && D.current.arrived;
    const mode = R && !R.failed ? 'route' : 'search';
    this.bar.dataset.m = mode;
    this.searchEl.hidden = mode !== 'search'; this.rtEl.hidden = mode !== 'route'; this.rtX.hidden = mode !== 'route';
    if (mode === 'route') {
      const t = R.target, area = t.kind === 'biz' ? zoneShort(t.b.zone) : (t.sub || '').split(' · ')[0];
      setT(this.rtEl.querySelector('b'), t.en);
      setT(this.rtEl.querySelector('small'), `${area ? area + ' ' : ''}${lvl(t.level)}`);
    }
    // Aya's pick, one tap from the map (no route yet / the next one after an arrival)
    const nx = D && D.next && D.next(), place = nx && this.placeById(nx);
    const showAya = !!(place && !R && this.sheet === 'map' && !this.input.matches(':focus'));
    if (this.ayaEl.hidden === showAya) { this.ayaEl.hidden = !showAya; this._measured = false; this._dirty = true; }
    if (showAya) {
      const html = `<span class="a">${arr ? 'Next · from Aya' : 'From Aya'}</span><b>${esc(this._ayaName(nx, place))}</b><small>${esc(this._areaOf(place))} ${lvl(place.level)}</small><em>Go</em>`;
      if (this.ayaEl.dataset.h !== html) { this.ayaEl.dataset.h = html; this.ayaEl.innerHTML = html; }
      this._ayaList = { items: [{ id: nx }], sel: 0, armed: false, chip: true, move() {}, pick: () => this._ayaGo() };
      this._ayaId = nx;
    } else { this._ayaList = null; this._ayaId = null; }
    this.root.classList.toggle('mq-aya-on', showAya);
    this.root.classList.toggle('mq-route', mode === 'route');
    // the orientation / recentre buttons
    const o = this.orientBtn.firstChild, w = this.headingUp ? 'up' : 'n';
    if (o.dataset.m !== w) { o.dataset.m = w; o.innerHTML = this.headingUp ? '<svg viewBox="0 0 24 24"><path d="M12 3 19 20l-7-4-7 4z" fill="currentColor" stroke="none"/></svg>' : '<b>N</b>'; this.orientBtn.title = this.headingUp ? 'Heading up (tap for north up)' : 'North up (tap for heading up)'; }
    this.orientBtn.classList.toggle('on', this.headingUp);
    this._renderStrip();
  }
  _ayaName(id, place) {
    const b = place.kind === 'biz' ? place.b : null;
    return b && b.raw ? b.raw.en : place.en;
  }
  _areaOf(place) {
    if (place.kind === 'biz') return zoneShort(place.b.zone) || '';
    return (place.sub || '').split(' · ')[0];
  }
  _ayaGo() {
    const id = this._ayaId; if (!id) return;
    this.phone._lastPhoneInput = this.phone._now;
    if (!this.phone.setDestination(id, { app: 'maps' })) { const p = this.placeById(id); if (p) this.select(p); }
  }

  // ---- the step list ----
  openSteps(keep) {
    const R = this.route; if (!R || R.failed) return;
    // a new last-known pin since the route was made: directions restart from it, quietly
    if (this.known && R.fromId !== this.known.id) this._computeRoute(false);
    if (!this.route || this.route.failed) return;
    const t = R.target, minutes = Math.max(1, Math.round(R.total / 1.4 / 60));
    this._next = nextChip(this.phone);
    const rows = this.steps.map((s, i) => `<li><button type="button" class="mq-step" data-i="${i}"><span class="n">${i + 1}</span><i class="ic">${I[s.icon] || I.walk}</i><span class="tx"><b>${esc(s.text)}</b><small>${s.kind === 'ramp' ? `${lvl(s.level)} → ${lvl(s.to)}` : lvl(s.level)}</small></span><span class="go">Map</span></button></li>`).join('');
    this._openPanel('steps', `To ${t.en}`, `
      ${nextChipHtml(this._next, this.touch, 'dl-next-maps')}
      <div class="mq-rt-from"><b>From</b> ${esc(R.fromWhere || '')}${this.known ? ` <span>(last known, ${this._ageTxt(this._clk - this.known.t0)} ago)</span>` : ''}</div>
      <div class="mq-rt-meta"><b>about ${minutes} min</b> · ${lvl(t.level)}</div>
      <ol class="mq-steps">${rows}</ol>
      <div class="mq-rt-from">A suggestion between two known places. Check the signs as you go.</div>
      <div class="mq-actions mq-end-row"><button class="mq-show" type="button">Show map</button><button class="mq-end" type="button">End route</button></div>`);
    this.panelB.querySelectorAll('.mq-step').forEach(b => b.addEventListener('click', () => this._previewStep(+b.dataset.i)));
    this.panelB.querySelector('.mq-show').addEventListener('click', () => this.closePanel());
    this.panelB.querySelector('.mq-end').addEventListener('click', () => this.endRoute());
    const nb = this.panelB.querySelector('.dl-next'); if (nb) nb.addEventListener('click', (e) => { e.stopPropagation(); this._next && this._next.pick(); });
  }
  _recenterRoute() { const lg = this.route && this.route.legs.find(l => l.level === this.pos.level); if (lg) this._fit(lg.draw.concat([[this.pos.x, this.pos.z]]), 3.2, 34); }
  // tap a step: that part of the plan, on its floor
  _previewStep(i) {
    const s = this.steps[i]; if (!s) return;
    this.closePanel();
    this.focus = i; this.follow = false;
    this.view.level = s.level;
    const R = this.route, lg = R.legs.find(l => l.level === s.level && (s.kind === 'ramp' || s.kind === 'gate' || s.kind === 'walk' || s.kind === 'end'));
    const pts = [s.at];
    if (lg && lg.draw.length > 1 && s.kind !== 'ramp') for (const q of lg.draw) pts.push(q);
    this._fit(s.kind === 'ramp' || s.kind === 'gate' ? [s.at, [s.at[0] + 22, s.at[1] + 14], [s.at[0] - 22, s.at[1] - 14]] : pts, s.kind === 'end' ? 3.4 : 3.0, 34);
    this._renderStrip(); this._syncUI(true);
  }

  // called by the phone every few frames when the sheet shows live data
  tick() {
    this._refreshHome();
    if (this.sheet === 'results' && this.list) this.list.refreshRight(it => it.place ? this._farTxt(it.place) : null);
  }
}
