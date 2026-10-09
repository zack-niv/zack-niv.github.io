// =============================================================================
// Wayfinding signage — back-lit hanging signs, exit signs, escalator-mouth
// signs, gate boards, platform name boards, floor guide maps, facility signs,
// street entrance boxes, Parks totems.
//
// TRUTHFUL BY CONSTRUCTION: placements come from the layout (openings between
// spaces, corridor runs, ramp mouths, gate lines, exits) and every arrow is
// the first bearing of the true shortest path, computed by descending the nav
// flow field ~18 m from where you stand reading the sign (see
// ui/phone/routes.js). Ambiguity comes from reality: rival operators listing
// different things in different styles, four stations called "なんば", signs
// that send you up a level, exits that loop back to the street.
//
// Pipeline
//   init()   (build phase, before nav): choose placements, declare lights and
//            obstacles, set up one viewer per readable face (~0.4 s).
//   start()  (non-blocking; kicked by the phone's init or our first update):
//            one shared flow field per DESTINATION (not per sign) on ctx.nav,
//            each sign face descends it; compose contents; draw every face
//            once into a few canvas atlases; batch geometry per (level, 48 m
//            chunk, material). Sliced with macrotask yields (~25 ms) so loading
//            and the first frames never stall. ready() resolves when done.
//
// API: ctx.signage.ready() → Promise; ctx.signage.signs (placements+content);
//      ctx.signage.facilities (toilets/lockers built here, for the phone).
// =============================================================================
import * as THREE from 'three';
import { GeoBatch } from '../render/geobatch.js?v=454ed73';
import { CELL } from './world.js?v=454ed73';
import { LAYOUT, LEVELS, LEVEL_ORDER, ZONES, rampEnds } from './layout.js?v=454ed73';
import { rng, hash } from '../core/rng.js?v=454ed73';
import { businessBySlot } from './directory.js?v=454ed73';
import { LINES, DESTINATIONS, EXIT_INFO, FACILITIES, FACILITY_INFO, PLATFORM_BOARDS, NANKAI_TRACKS, ZONE_OPERATOR, walkStreet } from '../ui/phone/places.js?v=454ed73';
import { computeDirections, STRIDE } from '../ui/phone/routes.js?v=454ed73';
import { drawFloor, THEMES } from '../ui/phone/maprender.js?v=454ed73';

const CHUNK = 48;
// font sizes are quantised (2 px steps above 14 px) so the glyph cache is reused
const qpx = (px) => px > 14 ? Math.round(px / 2) * 2 : Math.max(6, Math.round(px));
const JA = (px, w = 700) => `${w} ${qpx(px)}px "Noto Sans JP", "Hiragino Sans", "Yu Gothic", "Meiryo", sans-serif`;
const EN = (px, w = 600) => `${w} ${qpx(px)}px Inter, "Helvetica Neue", Arial, "Noto Sans JP", sans-serif`;
const _mcache = new Map();
function measW(g, text) {
  const k = g.font + '|' + text;
  let w = _mcache.get(k);
  if (w === undefined) { w = g.measureText(text).width; _mcache.set(k, w); }
  return w;
}

// Operator sign families (different companies, different styles).
const STYLES = {
  metro:  { bg: '#1c1e21', fg: '#ffffff', fg2: '#b9bec5', div: '#474b52', arrow: '#ffffff', exitBg: '#ffd400', exitFg: '#141414', frame: 'steel_dark' },
  nankai: { bg: '#1f232b', fg: '#ffffff', fg2: '#c6cbd3', div: '#4a505b', arrow: '#ffffff', exitBg: '#ffd400', exitFg: '#141414', accent: '#F08300', accentPos: 'top', frame: 'steel_dark' },
  walk:   { bg: '#f5f0e2', fg: '#2a2520', fg2: '#6d6458', div: '#d6cbb5', arrow: '#2a2520', exitBg: '#ffd400', exitFg: '#141414', accentPos: 'left', frame: 'aluminium' },
  city:   { bg: '#fbfbfb', fg: '#1d2833', fg2: '#5c6976', div: '#d8dde2', arrow: '#ffffff', arrowBg: '#1f6fb8', exitBg: '#1f6fb8', exitFg: '#ffffff', accent: '#1f6fb8', accentPos: 'bottom', frame: 'aluminium' },
  parks:  { bg: '#3d3026', fg: '#f3ead9', fg2: '#c9b89f', div: '#66543f', arrow: '#a5d47f', exitBg: '#a5d47f', exitFg: '#1b1914', frame: 'steel_dark', lower: true },
  taka:   { bg: '#163424', fg: '#f0e4bf', fg2: '#c0b287', div: '#3a5848', arrow: '#f0e4bf', exitBg: '#ffd400', exitFg: '#141414', frame: 'steel_dark' },
};

const PRIORITY = { gate: 10, esc: 8, exitHang: 7, end: 5, side: 4, hall: 3, interval: 2, column: 1 };

function isOpenCell(world, level, x, z) {
  const g = world.grids[level]; if (!g) return false;
  const i = g.cellOf(x, z); if (i < 0) return false;
  const t = g.type[i];
  if (t === CELL.RAMP || t === CELL.VOID) return true;
  if (t !== CELL.WALK) return false;
  const sp = LAYOUT.spaces[g.space[i]];
  return sp.kind !== 'room';
}
function walkCell(world, level, x, z) {
  const g = world.grids[level]; if (!g) return null;
  const i = g.cellOf(x, z); if (i < 0) return null;
  if (g.type[i] !== CELL.WALK) return null;
  return LAYOUT.spaces[g.space[i]];
}
function rectOf(s) {
  if (s.rect) return s.rect;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of s.poly) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
  return [x0, z0, x1, z1];
}
function corridorAxis(s) {
  const [x0, z0, x1, z1] = rectOf(s);
  const w = x1 - x0, d = z1 - z0;
  if (w >= d * 1.7) return 'x';
  if (d >= w * 1.7) return 'z';
  return null;
}
const withTimeout = (p, ms) => Promise.race([p, new Promise(r => setTimeout(() => r(null), ms))]);

// ---------------------------------------------------------------------------
// Atlas: shelf-packed canvas pages
// ---------------------------------------------------------------------------
class Atlas {
  constructor(size) { this.size = size; this.pages = []; }
  _page() {
    const c = document.createElement('canvas'); c.width = c.height = this.size;
    const g = c.getContext('2d');
    const p = { canvas: c, g, shelves: [], top: 0 };
    this.pages.push(p); return p;
  }
  alloc(w, h) {
    w = Math.ceil(w) + 4; h = Math.ceil(h) + 4;
    if (w > this.size) w = this.size;
    for (const p of this.pages) {
      for (const s of p.shelves) if (h <= s.h && s.h <= h * 1.35 && s.x + w <= this.size) { const r = { page: p, x: s.x + 2, y: s.y + 2, w: w - 4, h: h - 4 }; s.x += w; return r; }
      if (p.top + h <= this.size) { const s = { y: p.top, h, x: w }; p.shelves.push(s); p.top += h; return { page: p, x: 2, y: s.y + 2, w: w - 4, h: h - 4 }; }
    }
    const p = this._page();
    const s = { y: 0, h, x: w }; p.shelves.push(s); p.top = h;
    return { page: p, x: 2, y: 2, w: w - 4, h: h - 4 };
  }
}

// ---------------------------------------------------------------------------
// Drawing primitives
// ---------------------------------------------------------------------------
function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
}
// arrow pointing at `deg` (0 = up/ahead, 90 = right), centred in a box of size s
function drawArrow(g, cx, cy, s, deg, color) {
  g.save(); g.translate(cx, cy); g.rotate(deg * Math.PI / 180);
  const L = s * 0.92, hw = s * 0.42, sw = s * 0.14, hl = s * 0.44;
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(0, -L / 2); g.lineTo(hw, -L / 2 + hl); g.lineTo(sw, -L / 2 + hl); g.lineTo(sw, L / 2);
  g.lineTo(-sw, L / 2); g.lineTo(-sw, -L / 2 + hl); g.lineTo(-hw, -L / 2 + hl); g.closePath(); g.fill();
  g.restore();
}
function lineBadge(g, line, cx, cy, r) {
  const L = LINES[line]; if (!L) return;
  g.save();
  if (L.shape === 'circle') {
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = L.color; g.beginPath(); g.arc(cx, cy, r * 0.86, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffffff'; g.font = EN(r * 1.22, 800); g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(L.letter, cx, cy + r * 0.06);
  } else {
    g.fillStyle = L.color; rr(g, cx - r, cy - r, r * 2, r * 2, r * 0.3); g.fill();
    g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const t = L.letter;
    g.font = /[^\x00-\x7f]/.test(t) ? JA(r * (t.length > 1 ? 0.78 : 1.2), 900) : EN(r * (t.length > 1 ? 0.95 : 1.2), 800);
    g.fillText(t, cx, cy + r * 0.05);
  }
  g.restore();
}
function picto(g, kind, cx, cy, s, fg, bg) {
  g.save(); g.translate(cx, cy);
  if (bg) { g.fillStyle = bg; rr(g, -s / 2, -s / 2, s, s, s * 0.12); g.fill(); }
  g.fillStyle = fg; g.strokeStyle = fg;
  const k = s / 100;
  const person = (ox, skirt) => {
    g.beginPath(); g.arc(ox, -26 * k, 8 * k, 0, Math.PI * 2); g.fill();
    if (skirt) { g.beginPath(); g.moveTo(ox - 6 * k, -15 * k); g.lineTo(ox + 6 * k, -15 * k); g.lineTo(ox + 14 * k, 14 * k); g.lineTo(ox - 14 * k, 14 * k); g.closePath(); g.fill(); g.fillRect(ox - 6 * k, 14 * k, 4 * k, 22 * k); g.fillRect(ox + 2 * k, 14 * k, 4 * k, 22 * k); }
    else { rr(g, ox - 10 * k, -15 * k, 20 * k, 28 * k, 4 * k); g.fill(); g.fillRect(ox - 9 * k, 10 * k, 7 * k, 26 * k); g.fillRect(ox + 2 * k, 10 * k, 7 * k, 26 * k); }
  };
  if (kind === 'toilet') {
    person(-20 * k, false); person(20 * k, true);
    g.fillRect(-1.5 * k, -36 * k, 3 * k, 72 * k);
  } else if (kind === 'locker') {
    g.lineWidth = 5 * k; g.strokeRect(-30 * k, -34 * k, 60 * k, 68 * k);
    g.beginPath(); g.moveTo(0, -34 * k); g.lineTo(0, 34 * k); g.moveTo(-30 * k, 0); g.lineTo(30 * k, 0); g.stroke();
    g.beginPath(); g.arc(-10 * k, -17 * k, 4 * k, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(20 * k, -17 * k, 4 * k, 0, Math.PI * 2); g.fill();
  } else if (kind === 'taxi') {
    rr(g, -36 * k, -4 * k, 72 * k, 24 * k, 6 * k); g.fill();
    g.beginPath(); g.moveTo(-22 * k, -4 * k); g.lineTo(-14 * k, -22 * k); g.lineTo(14 * k, -22 * k); g.lineTo(22 * k, -4 * k); g.closePath(); g.fill();
    g.fillRect(-8 * k, -32 * k, 16 * k, 8 * k);
    g.fillStyle = bg || '#000'; g.beginPath(); g.arc(-20 * k, 22 * k, 8 * k, 0, Math.PI * 2); g.arc(20 * k, 22 * k, 8 * k, 0, Math.PI * 2); g.fill();
    g.fillStyle = fg; g.beginPath(); g.arc(-20 * k, 22 * k, 5 * k, 0, Math.PI * 2); g.arc(20 * k, 22 * k, 5 * k, 0, Math.PI * 2); g.fill();
  } else if (kind === 'info') {
    g.beginPath(); g.arc(0, -24 * k, 8 * k, 0, Math.PI * 2); g.fill();
    g.fillRect(-7 * k, -10 * k, 14 * k, 44 * k); g.fillRect(-14 * k, -10 * k, 8 * k, 6 * k); g.fillRect(-14 * k, 30 * k, 28 * k, 6 * k);
  } else if (kind === 'escalator') {
    g.lineWidth = 7 * k; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(-36 * k, 30 * k); g.lineTo(-16 * k, 30 * k); g.lineTo(18 * k, -10 * k); g.lineTo(36 * k, -10 * k); g.stroke();
    g.beginPath(); g.arc(-4 * k, -16 * k, 6 * k, 0, Math.PI * 2); g.fill();
  } else if (kind === 'stairs') {
    g.beginPath(); g.moveTo(-36 * k, 34 * k);
    for (let i = 0; i < 4; i++) { g.lineTo(-36 * k + i * 18 * k, (34 - (i + 1) * 17) * k); g.lineTo(-36 * k + (i + 1) * 18 * k, (34 - (i + 1) * 17) * k); }
    g.lineTo(36 * k, 34 * k); g.closePath(); g.fill();
  }
  g.restore();
}
function fitFont(g, text, mk, px, maxW, minPx = 8) {
  g.font = mk(px);
  const w = measW(g, text);
  if (w <= maxW) return px;
  const p = Math.max(minPx, Math.floor(px * maxW / w * 0.98));
  g.font = mk(p);
  return p;
}

// ---------------------------------------------------------------------------
export class Signage {
  constructor(ctx) {
    this.ctx = ctx;
    this.signs = [];
    this.facilities = FACILITIES.filter(f => !f.skip);
    this._built = false;
  }

  async init() {
    const { world, params } = this.ctx;
    this.lowQ = (this.ctx.engine && this.ctx.engine.qualityName === 'low');
    this.PPM = this.lowQ ? 96 : 136;      // pixels per metre on sign faces
    this.GPPM = this.lowQ ? 190 : 260;    // floor guide boards
    // fonts (cap the wait: a blocked CDN must not stall loading)
    this._fontsP = (async () => {
      if (!document.fonts || !document.fonts.load) return;
      await withTimeout(Promise.all([
        document.fonts.load('700 32px "Noto Sans JP"', 'なんば駅'), document.fonts.load('900 32px "Noto Sans JP"', '出口'),
        document.fonts.load('500 32px "Noto Sans JP"', '方面'),
        document.fonts.load('600 32px Inter', 'Exit'), document.fonts.load('800 32px Inter', 'M'),
      ]).catch(() => {}), 4000);
    })();
    const T = this.timings = {};
    let t = performance.now();
    const lap = (k) => { const n = performance.now(); T[k] = Math.round(n - t); t = n; };
    this._place(world); lap('place');
    this._declare(); lap('declare');
    this._faces = this._faceViewers();
    this._dests = DESTINATIONS.map(d => ({ id: d.id, kind: d.kind, goals: d.goals })); lap('faces');
  }

  // ===========================================================================
  // PLACEMENT
  // ===========================================================================
  _add(s) {
    s.id = s.id || `sg${this.signs.length}`;
    s.y0 = LEVELS[s.level].y;
    const sp = walkCell(this.ctx.world, s.level, s.x, s.z);
    s.space = sp; s.zone = sp ? sp.zone : (s.zone || null);
    s.op = s.op || ZONE_OPERATOR[s.zone] || 'metro';
    this.signs.push(s);
    return s;
  }
  // clear span along (tx,tz) from (x,z), stopping at walls/rooms/outdoors
  _span(level, x, z, tx, tz, max = 9) {
    const w = this.ctx.world;
    let a = 0, b = 0;
    for (let d = 0.25; d <= max; d += 0.25) { if (!isOpenCell(w, level, x - tx * d, z - tz * d)) break; a = d; }
    for (let d = 0.25; d <= max; d += 0.25) { if (!isOpenCell(w, level, x + tx * d, z + tz * d)) break; b = d; }
    return [a, b];
  }
  _ceilAt(level, x, z) {
    const sp = walkCell(this.ctx.world, level, x, z);
    if (!sp) return 3.4;
    if (sp.outdoor) return null;
    return sp.ceil;
  }
  // nearest sign on same level
  _near(level, x, z, r) {
    for (const s of this.signs) if (s.level === level && Math.hypot(s.x - x, s.z - z) < r) return s;
    return null;
  }

  _place(world) {
    const L = LAYOUT;
    const R = rng(hash('signage'));
    const cand = [];
    const hang = (o) => cand.push(Object.assign({ kind: 'hang', h: 0.42 }, o));

    // ---- A. openings between non-room spaces -------------------------------
    const open = new Map();
    for (const lv of Object.keys(world.grids)) {
      const g = world.grids[lv];
      for (let cz = 0; cz < g.h; cz++) for (let cx = 0; cx < g.w; cx++) {
        const i = cz * g.w + cx;
        if (g.type[i] !== CELL.WALK) continue;
        const A = g.space[i]; const SA = L.spaces[A];
        if (SA.kind === 'room' || SA.kind === 'platform') continue;
        for (const [dx, dz, o] of [[1, 0, 'v'], [0, 1, 'h']]) {
          if (cx + dx >= g.w || cz + dz >= g.h) continue;
          const j = i + dx + dz * g.w;
          if (g.type[j] !== CELL.WALK) continue;
          const B = g.space[j]; if (B === A) continue;
          const SB = L.spaces[B];
          if (SB.kind === 'room' || SB.kind === 'platform') continue;
          const X = g.x0 + cx, Z = g.z0 + cz;
          const line = o === 'v' ? X + 1 : Z + 1;
          const k = `${lv}|${A}|${B}|${o}|${line}`;
          let e = open.get(k); if (!e) open.set(k, e = { lv, A, B, o, line, cells: [] });
          e.cells.push(o === 'v' ? Z : X);
        }
      }
    }
    for (const e of open.values()) {
      e.cells.sort((a, b) => a - b);
      // contiguous runs
      let s0 = e.cells[0], prev = s0;
      const runs = [];
      for (let k = 1; k <= e.cells.length; k++) {
        const c = e.cells[k];
        if (c === prev + 1) { prev = c; continue; }
        runs.push([s0, prev + 1]); s0 = prev = c;
      }
      for (const [a, b] of runs) {
        const width = b - a; if (width < 2) continue;
        const mid = (a + b) / 2;
        const ox = e.o === 'v' ? e.line : mid, oz = e.o === 'v' ? mid : e.line;
        // n from A into B
        const nA = e.o === 'v' ? [1, 0] : [0, 1];
        for (const [S, n] of [[L.spaces[e.A], nA], [L.spaces[e.B], [-nA[0], -nA[1]]]]) {
          if (S.outdoor) continue;
          const [rx0, rz0, rx1, rz1] = rectOf(S);
          const len = Math.max(rx1 - rx0, rz1 - rz0), wid = Math.min(rx1 - rx0, rz1 - rz0);
          if (len < 8) continue;
          const ax = corridorAxis(S);
          const opAxis = n[0] ? 'x' : 'z';
          let x, z, nx, nz, kind;
          if (ax && ax === opAxis) { // opening at the end of a corridor
            x = ox - n[0] * 3; z = oz - n[1] * 3; nx = n[0]; nz = n[1]; kind = 'end';
            if (width > wid * 0.6 && wid < 14) { x = ax === 'x' ? x : (rx0 + rx1) / 2; z = ax === 'z' ? z : (rz0 + rz1) / 2; }
          } else if (ax) { // opening on the side of a corridor
            x = ax === 'x' ? ox : (rx0 + rx1) / 2; z = ax === 'z' ? oz : (rz0 + rz1) / 2;
            nx = ax === 'x' ? 1 : 0; nz = ax === 'z' ? 1 : 0; kind = 'side';
            if (width > 20) continue; // wide merges are not junctions
          } else { // hall
            x = ox - n[0] * 4; z = oz - n[1] * 4; nx = n[0]; nz = n[1]; kind = 'hall';
          }
          if (!isOpenCell(world, e.lv, x, z)) continue;
          hang({ level: e.lv, x, z, nx, nz, cat: kind, major: kind !== 'side' || width >= 6 });
        }
      }
    }
    // ---- B. corridor interval signs -----------------------------------------
    for (const S of L.spaces) {
      if (S.kind !== 'hall' || S.outdoor || !S.rect) continue;
      const ax = corridorAxis(S); if (!ax) continue;
      const [x0, z0, x1, z1] = S.rect;
      const len = ax === 'x' ? x1 - x0 : z1 - z0;
      if (len < 45) continue;
      const n = Math.floor(len / 34);
      for (let i = 1; i <= n; i++) {
        const t = i / (n + 1);
        const x = ax === 'x' ? x0 + (x1 - x0) * t : (x0 + x1) / 2;
        const z = ax === 'z' ? z0 + (z1 - z0) * t : (z0 + z1) / 2;
        hang({ level: S.level, x, z, nx: ax === 'x' ? 1 : 0, nz: ax === 'z' ? 1 : 0, cat: 'interval', major: false });
      }
    }
    // ---- C. ramp mouths (escalators / stairs, not street exits) -------------
    const banks = new Map();
    for (const r of L.ramps) { const k = r.bank || r.id; (banks.get(k) || banks.set(k, []).get(k)).push(r); }
    this.banks = banks;
    const exitBanks = new Set(Object.values(EXIT_INFO).map(e => e.ramp.replace(/_0$/, '')));
    for (const [bk, rs] of banks) {
      if (exitBanks.has(bk)) continue;
      const zone = rs[0].zone;
      if (zone === 'parksGarden') continue; // garden stairs: totems instead
      const e0 = rampEnds(rs[0]);
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const r of rs) { x0 = Math.min(x0, r.rect[0]); z0 = Math.min(z0, r.rect[1]); x1 = Math.max(x1, r.rect[2]); z1 = Math.max(z1, r.rect[3]); }
      const r = rs[0];
      for (const end of ['low', 'high']) {
        const E = e0[end];
        const lv = end === 'low' ? r.lower : r.upper;
        const cxm = r.axis === 'z' ? (x0 + x1) / 2 : E.x, czm = r.axis === 'x' ? (z0 + z1) / 2 : E.z;
        const x = cxm + E.dx * 1.4, z = czm + E.dz * 1.4;
        if (!isOpenCell(world, lv, x, z)) continue;
        const bw = r.axis === 'z' ? x1 - x0 : z1 - z0;
        cand.push({ kind: 'esc', h: 0.42, level: lv, x, z, nx: E.dx, nz: E.dz, cat: 'esc', major: true, bank: bk, rampIds: rs.map(q => L.ramps.indexOf(q)), end, maxW: Math.min(6.5, bw + 1.2), mouth: [cxm, czm] });
      }
    }
    // ---- D. gates -----------------------------------------------------------
    for (const gt of L.gates) {
      const x = gt.axis === 'x' ? (gt.from + gt.to) / 2 : gt.at, z = gt.axis === 'x' ? gt.at : (gt.from + gt.to) / 2;
      cand.push({ kind: 'gate', h: 0.78, level: gt.level, x, z, nx: gt.axis === 'x' ? 0 : 1, nz: gt.axis === 'x' ? 1 : 0, cat: 'gate', major: true, gate: gt, maxW: Math.min(9, (gt.to - gt.from) * 0.55) });
    }
    // ---- E. exits: yellow hanging sign before the stairs; street box on top --
    for (const ex of L.exits) {
      const info = EXIT_INFO[ex.id]; if (!info) continue;
      const r = L.ramps.find(q => q.id === info.ramp); if (!r) continue;
      const E = rampEnds(r);
      const x = E.low.x + E.low.dx * 2.2, z = E.low.z + E.low.dz * 2.2;
      cand.push({ kind: 'exitHang', h: 0.5, level: r.lower, x, z, nx: E.low.dx, nz: E.low.dz, cat: 'exitHang', major: true, exit: ex, info, maxW: 4.2 });
      // street entrance box on a pole beside the stair top
      const tx = E.high.x, tz = E.high.z;
      const side = r.axis === 'z' ? [1, 0] : [0, 1];
      const hw = (r.axis === 'z' ? r.rect[2] - r.rect[0] : r.rect[3] - r.rect[1]) / 2;
      let px = tx + side[0] * (hw + 0.6) + E.high.dx * 0.8, pz = tz + side[1] * (hw + 0.6) + E.high.dz * 0.8;
      if (!world.isWalkable('1F', px, pz)) { px = tx - side[0] * (hw + 0.6) + E.high.dx * 0.8; pz = tz - side[1] * (hw + 0.6) + E.high.dz * 0.8; }
      this.entrances = this.entrances || [];
      this.entrances.push({ level: r.upper, x: px, z: pz, nx: side[0] ? 0 : 1, nz: side[0] ? 1 : 0, exit: ex, info, dir: [E.high.dx, E.high.dz] });
    }

    // ---- resolve candidates: dedupe by priority, size against walls ---------
    cand.sort((a, b) => (PRIORITY[b.cat] || 0) - (PRIORITY[a.cat] || 0));
    for (const c of cand) {
      const minGap = c.cat === 'interval' ? 16 : c.cat === 'side' ? 9 : c.kind === 'esc' || c.kind === 'gate' ? 4 : 7;
      const other = this._near(c.level, c.x, c.z, minGap);
      if (other) {
        // the same spot: let a junction sign absorb a weaker one
        if (c.kind === 'hang' && other.kind === 'hang' && c.major) other.major = true;
        continue;
      }
      // also avoid the exact facing of an escalator sign
      const tx = c.nz, tz = -c.nx; // along the sign plane
      const [a, b] = this._span(c.level, c.x, c.z, tx, tz, 10);
      let span = a + b;
      if (span < 1.6) continue;
      // recentre in corridors
      if (span < 16 && c.kind === 'hang') { const m = (b - a) / 2; c.x += tx * m; c.z += tz * m; }
      c.maxW = Math.min(c.maxW || 7, span - 0.8, c.kind === 'hang' ? (c.major ? 6.5 : 4.6) : 9);
      if (c.maxW < 1.4) continue;
      const ceil = this._ceilAt(c.level, c.x, c.z);
      if (ceil == null) continue; // outdoors: no hanging signs
      c.ceil = Math.min(ceil, 4.6);
      // open above? (atrium / escalator well) → hang on a longer drop
      const g = world.grids[c.level];
      const above = LEVEL_ORDER[LEVEL_ORDER.indexOf(c.level) + 1];
      const ga = above && world.grids[above];
      if (ga) { const t = ga.typeAt(c.x, c.z); if (t === CELL.VOID || t === CELL.RAMP) c.ceil = Math.min(4.6, LEVELS[above].y - LEVELS[c.level].y - 0.3); }
      const hTot = c.h + 0.08;
      c.yc = Math.min(2.62 + c.h / 2 - 0.21, c.ceil - 0.12 - hTot / 2);
      if (c.yc - hTot / 2 < 2.08) { if (c.h > 0.5) { c.h = 0.42; c.yc = Math.min(2.62, c.ceil - 0.12 - 0.25); } }
      if (c.yc - (c.h + 0.08) / 2 < 2.0) continue;
      this._add(c);
    }

    // ---- F. platforms -------------------------------------------------------
    this._placePlatforms(world);
    // ---- G. floor guide boards ------------------------------------------------
    this._placeGuides(world, R);
    // ---- H. column wraps on existing columns ------------------------------------
    this._placeColumns(world);
    // ---- I. totems (outdoors / Parks) ------------------------------------------
    const totems = [
      ['2F', 33, 219, 0, 1], ['2F', 36, 300, 0, 1], ['2F', 40, 360, 0, 1], ['3F', 60, 214, 1, 0], ['4F', 70, 262, 1, 0],
      ['5F', 64, 300, 0, 1], ['6F', 70, 330, 1, 0], ['7F', 70, 352, 1, 0], ['2F', 0, 208, 1, 0],
      ['1F', -66, -190, 1, 0], ['1F', 60, -203, 1, 0], ['1F', -100, -150, 0, 1],
    ];
    for (const [lv, x, z, nx, nz] of totems) {
      if (!world.isWalkable(lv, x, z)) continue;
      const sp = walkCell(world, lv, x, z);
      const op = sp && (sp.zone === 'parks' || sp.zone === 'parksGarden') ? 'parks' : 'metro';
      this._add({ kind: 'totem', level: lv, x, z, nx, nz, w: 0.62, h: 1.5, yc: 1.25, op, major: true, cat: 'totem', faces: null });
      this.ctx.world.addBox(lv, x, z, nz ? 0.34 : 0.1, nz ? 0.1 : 0.34, 0);
    }
    // ---- J. facilities ---------------------------------------------------------
    for (const f of this.facilities) {
      if (f.pole) { this.ctx.world.addCylinder(f.level, f.x, f.z, 0.12); continue; }
      // blade sign perpendicular to the wall, 1.2 m out, over the doorway side
      if (f.kind === 'locker') this.ctx.world.addBox(f.level, f.x + f.nx * 0.35, f.z + f.nz * 0.35, f.nx ? 0.32 : 1.6, f.nx ? 1.6 : 0.32, 0);
    }
  }

  _placePlatforms(world) {
    const L = LAYOUT;
    const plat = (id) => L.spaces.find(s => s.id === id);
    // --- subway island platforms: hanging station-name & track boards ---------
    for (const [line, pid] of [['midosuji', 'm_platform'], ['sennichimae', 's_platform']]) {
      const P = plat(pid); if (!P) continue;
      const [x0, z0, x1, z1] = P.rect;
      const ax = PLATFORM_BOARDS[line].axis;
      const len = ax === 'z' ? z1 - z0 : x1 - x0;
      const n = Math.floor(len / 26);
      const tracks = L.tracks.filter(t => t.platform === pid);
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const x = ax === 'x' ? x0 + (x1 - x0) * t : (x0 + x1) / 2, z = ax === 'z' ? z0 + (z1 - z0) * t : (z0 + z1) / 2;
        // keep clear of escalator wells
        if (!isOpenCell(world, 'B2', x, z) || walkCell(world, 'B2', x, z) == null) continue;
        let near = false;
        for (const r of L.ramps) if (r.lower === 'B2' && x > r.rect[0] - 4 && x < r.rect[2] + 4 && z > r.rect[1] - 4 && z < r.rect[3] + 4) near = true;
        if (near) continue;
        const kind = i % 2 === 0 ? 'platName' : 'platTrack';
        this._add({ kind, level: 'B2', x, z, nx: ax === 'x' ? 1 : 0, nz: ax === 'z' ? 1 : 0, w: Math.min(5.2, (ax === 'z' ? x1 - x0 : z1 - z0) - 1.6), h: kind === 'platName' ? 0.62 : 0.5, yc: 2.55, line, tracks, op: 'metro', ceil: P.ceil, cat: 'plat' });
      }
      // track-wall name boards (seen across the track)
      for (const tr of tracks) {
        const [tx0, tz0, tx1, tz1] = tr.rect;
        const wallC = ax === 'z' ? (tr.side === 'w' ? tx0 : tx1) : (tr.side === 'n' ? tz0 : tz1);
        const nIn = tr.side === 'w' ? [1, 0] : tr.side === 'e' ? [-1, 0] : tr.side === 'n' ? [0, 1] : [0, -1];
        for (let i = 0; i < Math.floor(len / 22); i++) {
          const t = (i + 0.5) / Math.floor(len / 22);
          const x = ax === 'x' ? x0 + (x1 - x0) * t : wallC + nIn[0] * 0.06, z = ax === 'z' ? z0 + (z1 - z0) * t : wallC + nIn[1] * 0.06;
          this._add({ kind: 'wallName', level: 'B2', x, z, nx: nIn[0], nz: nIn[1], w: 3.4, h: 0.85, yc: 2.25, line, op: 'metro', single: true, cat: 'plat', zone: line });
        }
      }
    }
    // --- Nankai terminal: platform-head boards over each island ---------------
    for (let i = 1; i <= 4; i++) {
      const P = plat(`nk_plat_${i}`); if (!P) continue;
      const [x0, , x1] = P.rect;
      const tr = L.tracks.filter(t => t.platform === P.id).sort((a, b) => a.no - b.no);
      this._add({ kind: 'nkHead', level: '3F', x: (x0 + x1) / 2, z: -57.5, nx: 0, nz: -1, w: Math.min(6.2, x1 - x0 - 0.6), h: 0.7, yc: 3.1, tracks: tr, op: 'nankai', cat: 'plat', ceil: 8 });
      for (const zz of [-20, 30, 80]) this._add({ kind: 'platName', level: '3F', x: (x0 + x1) / 2, z: zz, nx: 0, nz: 1, w: Math.min(5.6, x1 - x0 - 1.2), h: 0.6, yc: 2.7, line: 'nankai', tracks: tr, op: 'nankai', cat: 'plat', ceil: 8 });
    }
  }

  _placeGuides(world, R) {
    const anchors = [
      ['B1', 116, -231.6, 'walk'], ['B1', -86, -218.4, 'walk'], ['B1', -126, -225.6, 'metro'], ['B1', -112, -48.4, 'metro'],
      ['B1', -62, -46.4, 'metro'], ['B1', -22, -61.6, 'city'], ['B1', -29.6, 60, 'city'], ['B1', 0, 185.6, 'city'],
      ['B1', 89.6, -212, 'metro'], ['B1', -40, -199.6, 'taka'],
      ['1F', -59.6, -104, 'nankai'], ['1F', -29.6, 70, 'city'],
      ['2F', 39.6, -92, 'nankai'], ['2F', -29.6, 23, 'city'], ['2F', -19.6, 209, 'parks'],
      ['3F', -34, -83.6, 'nankai'], ['3F', -1, 214.4, 'parks'], ['4F', -1, 214.4, 'parks'], ['5F', -1, 214.4, 'parks'],
      ['6F', -1, 284.4, 'parks'], ['7F', -1, 326.4, 'parks'], ['8F', -1, 354.4, 'parks'],
    ];
    this.guides = [];
    for (const [lv, ax, az, op] of anchors) {
      const m = this._wallMount(lv, ax, az, 1.9);
      if (!m) continue;
      const north = op === 'nankai' || op === 'metro' || (op === 'parks' && hash(lv) % 2 === 0);
      this._add({ kind: 'guide', level: lv, x: m.x, z: m.z, nx: m.nx, nz: m.nz, w: 1.8, h: 1.2, yc: 1.45, op, single: true, northUp: north, cat: 'guide' });
    }
  }
  // find a wall (or a solid partition) near (x,z) to mount a board of width w
  _wallMount(level, x, z, w) {
    const E = this.ctx.world.edges[level] || [];
    let best = null, bd = 6;
    for (const e of E) {
      if (e.kind !== 'wall' && e.kind !== 'partition') continue;
      const vert = e.ax === e.bx;
      const len = vert ? Math.abs(e.bz - e.az) : Math.abs(e.bx - e.ax);
      if (len < w + 0.4) continue;
      const lo = vert ? Math.min(e.az, e.bz) : Math.min(e.ax, e.bx), hi = lo + len;
      const along = vert ? z : x;
      const t = Math.max(lo + w / 2 + 0.2, Math.min(hi - w / 2 - 0.2, along));
      const px = vert ? e.ax : t, pz = vert ? t : e.az;
      const d = Math.hypot(px - x, pz - z);
      if (d >= bd) continue;
      // which side is walkable (towards the anchor)
      let nx = vert ? Math.sign(x - e.ax) : 0, nz = vert ? 0 : Math.sign(z - e.az);
      if (!nx && !nz) continue;
      if (!isOpenCell(this.ctx.world, level, px + nx * 0.5, pz + nz * 0.5)) continue;
      bd = d; best = { x: px + nx * 0.05, z: pz + nz * 0.05, nx, nz };
    }
    return best;
  }
  _placeColumns(world) {
    let n = 0;
    for (const lv of Object.keys(world.obstacles)) {
      for (const o of world.obstacles[lv]) {
        if (n > 60) return;
        if (o.rot && Math.abs(Math.sin(o.rot * 2)) > 0.01) continue;
        if (o.hx < 0.22 || o.hz < 0.22 || o.hx > 0.75 || o.hz > 0.75 || Math.abs(o.hx - o.hz) > 0.18) continue;
        const sp = walkCell(world, lv, o.cx + o.hx + 0.6, o.cz);
        if (!sp || sp.kind === 'room' || sp.outdoor) continue;
        if (this._near(lv, o.cx, o.cz, 14)) continue;
        if (sp.ceil < 2.9) continue;
        this._add({ kind: 'column', level: lv, x: o.cx, z: o.cz, hx: o.hx, hz: o.hz, nx: 0, nz: 1, w: o.hx * 2 + 0.04, h: 0.36, yc: 2.25, cat: 'column', major: false, four: true });
        n++;
      }
    }
  }

  // lights & sizes declared before the lighting bake
  _declare() {
    const lt = this.ctx.lighting;
    for (const s of this.signs) {
      if (s.kind === 'column' || s.kind === 'wallName') continue;
      const w = s.w || s.maxW || 3;
      if (lt && lt.addLight) lt.addLight({ level: s.level, x: s.x, y: s.y0 + (s.yc || 2.5) - 0.3, z: s.z, color: s.op === 'walk' || s.op === 'city' ? 0xfaf6ee : 0xdfe6ff, intensity: Math.min(1.2, 0.25 + w * 0.12), range: 4 + w * 0.6, kind: 'sign' });
    }
  }

  // ===========================================================================
  // DIRECTIONS (worker)
  // ===========================================================================
  _faceViewers() {
    // one viewer per readable face, 1.6 m in front of it, looking at it
    const faces = [];
    this._faceIndex = [];
    for (const s of this.signs) {
      s.faceIdx = [];
      const sides = s.kind === 'totem' || s.kind === 'hang' || s.kind === 'esc' || s.kind === 'gate' || s.kind === 'exitHang' ? [1, -1]
        : s.kind === 'column' ? [0, 1, 2, 3] : s.kind === 'guide' ? [] : [];
      for (const sd of sides) {
        let nx, nz;
        if (s.four) { const a = sd * Math.PI / 2; nx = Math.round(Math.sin(a)); nz = Math.round(Math.cos(a)); }
        else { nx = s.nx * sd; nz = s.nz * sd; }
        let d = 1.6;
        if (s.four) d = Math.max(s.hx, s.hz) + 1.2;
        let vx = s.x + nx * d, vz = s.z + nz * d;
        if (!isOpenCell(this.ctx.world, s.level, vx, vz)) { vx = s.x + nx * 0.6; vz = s.z + nz * 0.6; }
        // escalator mouth: the "approach" face is read from the floor in front;
        // the back face is read by people stepping off — from the mouth
        if (s.kind === 'esc' && sd === -1) { vx = s.mouth[0] + s.nx * 0.7; vz = s.mouth[1] + s.nz * 0.7; }
        s.faceIdx.push(faces.length);
        faces.push({ level: s.level, x: vx, z: vz, fx: -nx, fz: -nz, nx, nz, len: s.kind === 'esc' ? 8 : 18 });
      }
    }
    return faces;
  }
  // Non-blocking: started by the phone's init (or our first update once the
  // nav graph exists). Work is sliced with macrotask yields so loading and the
  // first frames keep flowing; ready() resolves when the signs are in place.
  start() {
    if (!this._readyP) this._readyP = this._finish().catch(e => { console.error('[signage] build failed', e); this.ctx.errors && this.ctx.errors.push('signage: ' + e.message); });
    return this._readyP;
  }
  ready() { return this.start(); }
  async _finish() {
    const T = this.timings;
    const yieldNow = () => new Promise(r => setTimeout(r, 0));
    while (!this.ctx.nav) await new Promise(r => setTimeout(r, 60));
    await this._fontsP;
    let t = performance.now();
    const nav = this.ctx.nav, NF = this._faces.length, ND = this._dests.length;
    const res = new Float32Array(NF * ND * STRIDE).fill(NaN);
    for (let d = 0; d < ND; d++) {
      const part = computeDirections(nav, this._faces, [this._dests[d]]);
      for (let i = 0; i < NF; i++) res.set(part.subarray(i * STRIDE, i * STRIDE + STRIDE), (i * ND + d) * STRIDE);
      await yieldNow();
    }
    T.directions = Math.round(performance.now() - t); t = performance.now();
    this._res = res;
    this._compose();
    T.compose = Math.round(performance.now() - t);
    await yieldNow();
    t = performance.now();
    await this._draw(yieldNow);
    T.draw = Math.round(performance.now() - t); t = performance.now();
    this._buildMeshes();
    T.meshes = Math.round(performance.now() - t);
    this._built = true;
    this.ctx.events && this.ctx.events.emit('signage:ready', { count: this.signs.length });
  }
  update() {
    if (!this._readyP && this.ctx.nav) this.start();
  }

  // ===========================================================================
  // CONTENT
  // ===========================================================================
  _r(fi, di) {
    const o = (fi * this._dests.length + di) * STRIDE, a = this._res;
    if (!(a[o] >= 0)) return null;
    return { dist: a[o], ex: a[o + 1], ez: a[o + 2], ramp: a[o + 3], rampAt: a[o + 4], dir: a[o + 5], toLevel: a[o + 6] };
  }
  // relative bearing in degrees (+ = right) quantised to signage arrows
  _bearing(face, r) {
    const dx = r.ex - face.x, dz = r.ez - face.z;
    if (Math.hypot(dx, dz) < 1.2) return 0;
    const f = [face.fx, face.fz], right = [-face.fz, face.fx];
    const a = Math.atan2(dx * right[0] + dz * right[1], dx * f[0] + dz * f[1]) * 180 / Math.PI;
    const s = Math.sign(a), m = Math.abs(a);
    if (m < 24) return 0;
    if (m < 62) return 45 * s;
    if (m < 122) return 90 * s;
    return null; // behind you: belongs on the other face
  }
  _compose() {
    const D = DESTINATIONS;
    for (const s of this.signs) {
      const R = rng(hash(s.id + s.level));
      s.faces = [];
      if (s.kind === 'guide' || s.kind === 'platName' || s.kind === 'platTrack' || s.kind === 'wallName' || s.kind === 'nkHead') {
        s.faces = s.single ? [{ side: 1 }] : [{ side: 1 }, { side: -1 }];
        continue;
      }
      for (let k = 0; k < s.faceIdx.length; k++) {
        const fi = s.faceIdx[k], face = this._faces[fi];
        const zoneSp = walkCell(this.ctx.world, s.level, face.x, face.z) || s.space;
        const zone = zoneSp ? zoneSp.zone : s.zone;
        const cands = [];
        for (let di = 0; di < D.length; di++) {
          const d = D[di];
          const r = this._r(fi, di); if (!r) continue;
          if (d.inside && d.inside.includes(zone) && !(s.kind === 'gate' || s.kind === 'esc')) continue;
          if (d.inside && d.inside.includes(zone) && d.kind === 'area') continue;
          const tierMax = d.tier === 1 ? (s.major ? 1400 : 650) : d.tier === 2 ? (s.major ? 650 : 380) : (s.major ? 230 : 150);
          if (r.dist > tierMax) continue;
          if (r.dist < 6 && d.kind !== 'exit') continue;
          const ang = this._bearing(face, r);
          if (ang === null && s.kind !== 'esc') continue;
          // operator politics
          if (s.op === 'nankai' && (d.id === 'walk' || d.kind === 'exit')) continue;
          if ((s.op === 'city' || s.op === 'parks') && d.kind === 'exit') continue;
          if (s.op === 'parks' && (d.id === 'midosuji' || d.id === 'sennichimae' || d.id === 'kintetsu' || d.id === 'yotsubashi')) continue;
          if (s.op === 'taka' && (d.id === 'walk' || d.id === 'city')) continue;
          if (d.kind === 'facility' && r.dist > 110) continue;
          let score = (d.tier === 1 ? 3 : d.tier === 2 ? 2 : 1.5) + (d.ops.includes(s.op) ? 1.3 : 0) - r.dist / 450 + R() * 0.7;
          if (d.kind === 'facility') score -= 0.8;
          if (d.offmap && !s.major) score -= 0.6;
          // level change soon on this route?
          let lvl = null;
          if (r.ramp >= 0 && r.rampAt < (s.kind === 'esc' ? 3 : 30)) lvl = { dir: r.dir, label: LEVEL_ORDER[r.toLevel] };
          cands.push({ d, r, ang, score, lvl });
        }
        cands.sort((a, b) => b.score - a.score);
        s.faces.push({ side: k === 0 ? 1 : -1, fi, zone, cands, sideIdx: k });
      }
    }
  }

  // Turn candidates into drawable blocks, fitting the sign width.
  _blocks(s, face, maxPx, g) {
    const H = (s.kind === 'gate' ? s.h * 0.48 - 0.01 : s.h) * this.PPM;
    const maxDir = s.kind === 'gate' ? 3 : s.major ? 4 : 2;
    const blocks = [];
    let nDir = 0, nFac = 0;
    const exitGroups = new Map();
    for (const c of face.cands) {
      if (c.ang === null) continue;
      if (c.d.kind === 'exit') {
        const k = c.ang + '|' + (c.lvl ? c.lvl.dir : 0);
        let e = exitGroups.get(k); if (!e) exitGroups.set(k, e = { type: 'exit', ang: c.ang, lvl: c.lvl, nos: [], score: c.score, dests: [] });
        e.nos.push(EXIT_INFO[c.d.exit].no); e.dests.push(c.d); e.score = Math.max(e.score, c.score);
      } else if (c.d.kind === 'facility') {
        if (nFac >= (s.major ? 2 : 1)) continue;
        blocks.push({ type: 'fac', ang: c.ang, lvl: c.lvl, d: c.d, score: c.score }); nFac++;
      } else {
        if (nDir >= maxDir) continue;
        blocks.push({ type: 'dir', ang: c.ang, lvl: c.lvl, d: c.d, score: c.score }); nDir++;
      }
    }
    for (const e of [...exitGroups.values()].sort((a, b) => b.score - a.score).slice(0, s.major ? 2 : 1)) {
      e.nos.sort((a, b) => +a - +b);
      const lo = +e.nos[0], hi = +e.nos[e.nos.length - 1];
      e.label = e.nos.length >= 3 && hi - lo <= 12 ? `${e.nos[0]}–${e.nos[e.nos.length - 1]}` : e.nos.slice(0, 3).join('・');
      blocks.push(e);
    }
    // measure
    const st = STYLES[s.op] || STYLES.metro;
    for (const b of blocks) b.w = this._measureBlock(g, b, H, st);
    blocks.sort((a, b) => b.score - a.score);
    const total = () => blocks.reduce((a, b) => a + b.w, 0) + (st.accentPos === 'left' ? H * 1.25 : 0);
    while (blocks.length > 1 && total() > maxPx) blocks.pop();
    // order: left-pointing, ahead, right-pointing
    const key = b => (b.ang < 0 ? 0 : b.ang === 0 ? 1 : 2) * 10 + (b.ang < 0 ? b.ang / 90 : -b.ang / 90) + (b.type === 'exit' ? (b.ang <= 0 ? -5 : 5) : 0);
    blocks.sort((a, b) => key(a) - key(b));
    return blocks;
  }

  _measureBlock(g, b, H, st) {
    const pad = H * 0.22, arrow = H * 0.78, lvl = b.lvl ? H * 0.72 : 0;
    if (b.type === 'exit') {
      g.font = EN(H * 0.62, 800); const nw = measW(g, b.label);
      g.font = JA(H * 0.32, 900); const jw = measW(g, '出口');
      return pad * 2 + arrow + lvl + H * 0.12 + jw + H * 0.14 + nw + pad * 0.5;
    }
    if (b.type === 'fac') {
      const fi = FACILITY_INFO[b.d.fac];
      g.font = JA(H * 0.3, 700); const jw = measW(g, fi.ja);
      g.font = EN(H * 0.2, 600); const ew = measW(g, fi.en);
      return pad * 2 + arrow + lvl + H * 0.8 + Math.max(jw, ew) + pad * 0.3;
    }
    const d = b.d;
    const ja = this._ja(d), en = this._en(d, st);
    g.font = JA(H * 0.36, 700); const jw = measW(g, ja);
    g.font = EN(H * 0.2, 600); const ew = measW(g, en);
    const badges = this._badges(d).length;
    return pad * 2 + arrow + lvl + badges * H * 0.62 + H * 0.08 + Math.max(jw, ew);
  }
  _badges(d) {
    if (d.kind === 'line') return d.lines || [d.line];
    return [];
  }
  _ja(d) {
    if (d.kind === 'exit') return '出口';
    if (d.kind === 'line' && d.line === 'nankai') return '南海線 なんば駅';
    return d.ja;
  }
  _en(d, st) {
    let t = d.en;
    if (d.kind === 'line' && d.line === 'nankai') t = 'Nankai Line';
    return st && st.lower ? t.toLowerCase() : t;
  }

  // ===========================================================================
  // DRAWING
  // ===========================================================================
  async _draw(yieldNow) {
    const atlas = this.atlas = new Atlas(2048);
    let tSlice = performance.now();
    const gAtlas = this.guideAtlas = new Atlas(2048);
    const meas = document.createElement('canvas').getContext('2d');
    const P = this.PPM;
    const cache = new Map();
    for (const s of this.signs) {
      if (yieldNow && performance.now() - tSlice > 25) { await yieldNow(); tSlice = performance.now(); }
      const st = STYLES[s.op] || STYLES.metro;
      if (s.kind === 'hang' || s.kind === 'gate' || s.kind === 'exitHang' || s.kind === 'esc' || s.kind === 'column' || s.kind === 'totem') {
        // decide physical width from both faces' content
        const maxPx = (s.maxW || s.w || 4) * P;
        const H = s.h * P;
        for (const f of s.faces) {
          if (s.kind === 'esc') f.blocks = this._escBlocks(s, f, meas, st, H);
          else if (s.kind === 'exitHang') f.blocks = this._exitHangBlocks(s, f, meas, st, H, maxPx);
          else if (s.kind === 'totem') f.blocks = this._blocks(s, f, 1e9, meas).slice(0, 6);
          else f.blocks = this._blocks(s, f, s.kind === 'gate' ? maxPx : maxPx, meas);
        }
        if (s.kind === 'hang' && s.faces.every(f => !f.blocks.length)) { s.dead = true; continue; }
        if (!s.w) {
          let need = 0;
          for (const f of s.faces) need = Math.max(need, f.blocks.reduce((a, b) => a + b.w, 0) + (st.accentPos === 'left' ? H * 1.25 : 0));
          if (s.kind === 'gate') { meas.font = JA(s.h * P * 0.36, 900); need = Math.max(need, measW(meas, s.gate.ja + ' ' + s.gate.name) + s.h * P * 1.6); }
          s.w = Math.max(s.kind === 'esc' ? 2.2 : 1.6, Math.min(s.maxW || 6, need / P + 0.1));
        }
      }
      // draw each face
      for (const f of s.faces) {
        const isGuide = s.kind === 'guide';
        const ppm = isGuide ? this.GPPM : P;
        const wpx = s.kind === 'totem' ? s.w * ppm : Math.round(s.w * ppm), hpx = Math.round(s.h * ppm);
        const sig = this._sig(s, f);
        let rect = sig && cache.get(sig);
        if (!rect) {
          rect = (isGuide ? gAtlas : atlas).alloc(wpx, hpx);
          rect.guide = isGuide;
          const g = rect.page.g;
          g.save(); g.beginPath(); g.rect(rect.x, rect.y, rect.w, rect.h); g.clip(); g.translate(rect.x, rect.y);
          const t0 = performance.now();
          try { this._drawFace(g, s, f, rect.w, rect.h, st); } catch (e) { console.warn('[signage] face', s.kind, e); }
          const pk = this.profile || (this.profile = {}); pk[s.kind] = (pk[s.kind] || 0) + performance.now() - t0;
          g.restore();
          if (sig) cache.set(sig, rect);
        }
        f.rect = rect;
      }
    }
    // textures
    const mk = (p) => {
      const t = new THREE.CanvasTexture(p.canvas);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = (this.ctx.engine && this.ctx.engine.quality.anisotropy) || 4;
      t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
      return t;
    };
    this.pageMats = new Map();
    for (const p of [...atlas.pages, ...gAtlas.pages]) {
      const tex = mk(p);
      const m = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.35, 1.35, 1.35) });
      m.name = 'sign_face';
      this.pageMats.set(p, m);
      p.tex = tex;
    }
    this.stats = { pages: atlas.pages.length + gAtlas.pages.length, faces: cache.size };
  }
  // which way "plus" (south / east) lies for the reader of face f (+1 right, -1 left)
  _orient(s, f) {
    const nx = s.nx * f.side, nz = s.nz * f.side, fx = -nx, fz = -nz, rx = -fz, rz = fx;
    const B = PLATFORM_BOARDS[s.line];
    return Math.sign(B && B.axis === 'z' ? rz : rx) || 1;
  }
  _sig(s, f) {
    if (s.kind === 'guide') return null;
    if (s.kind === 'platName' || s.kind === 'wallName') return `${s.kind}|${s.line}|${s.w.toFixed(2)}|${s.h}|${this._orient(s, f)}`;
    if (s.kind === 'platTrack') return `${s.kind}|${s.line}|${s.w.toFixed(2)}|${this._orient(s, f)}`;
    const b = (f.blocks || []).map(x => `${x.type}:${x.ang}:${x.lvl ? x.lvl.dir + x.lvl.label : ''}:${x.d ? x.d.id : x.label}`).join(',');
    return `${s.kind}|${s.op}|${s.w.toFixed(2)}|${s.h}|${b}|${s.kind === 'platName' || s.kind === 'platTrack' || s.kind === 'nkHead' || s.kind === 'wallName' ? s.id + f.side : ''}|${s.gate ? s.gate.id + f.side : ''}|${s.exit ? s.exit.id : ''}|${s.op === 'walk' ? walkStreet(s.x).no : ''}`;
  }

  _drawFace(g, s, f, W, H, st) {
    switch (s.kind) {
      case 'hang': case 'column': return this._drawDir(g, s, f, W, H, st);
      case 'esc': return this._drawDir(g, s, f, W, H, st);
      case 'exitHang': return this._drawDir(g, s, f, W, H, st);
      case 'gate': return this._drawGate(g, s, f, W, H, st);
      case 'totem': return this._drawTotem(g, s, f, W, H, st);
      case 'platName': return this._drawPlatName(g, s, f, W, H);
      case 'wallName': return this._drawPlatName(g, s, f, W, H, true);
      case 'platTrack': return this._drawPlatTrack(g, s, f, W, H);
      case 'nkHead': return this._drawNkHead(g, s, f, W, H);
      case 'guide': return this._drawGuide(g, s, f, W, H);
    }
  }

  _bg(g, W, H, st, s) {
    g.fillStyle = st.bg; g.fillRect(0, 0, W, H);
    // subtle back-lit gradient (diffuser panel)
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, 'rgba(255,255,255,0.05)'); gr.addColorStop(1, 'rgba(0,0,0,0.06)');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    if (st.accentPos === 'top') { g.fillStyle = st.accent; g.fillRect(0, 0, W, Math.max(3, H * 0.07)); }
    if (st.accentPos === 'bottom') { g.fillStyle = st.accent; g.fillRect(0, H - Math.max(3, H * 0.08), W, Math.max(3, H * 0.08)); }
  }

  _drawDir(g, s, f, W, H, st) {
    this._bg(g, W, H, st, s);
    let x0 = 0;
    if (st.accentPos === 'left') {
      // NAMBAWALK street tag
      const ws = walkStreet(s.x);
      g.fillStyle = ws.color; g.fillRect(0, 0, H * 1.2, H);
      g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = JA(H * 0.3, 900); g.fillText(ws.ja, H * 0.6, H * 0.4);
      g.font = EN(H * 0.15, 700); g.fillText('NAMBAWALK', H * 0.6, H * 0.74);
      x0 = H * 1.25;
    }
    const blocks = f.blocks || [];
    if (!blocks.length) {
      // nothing useful to say this way: area name
      const sp = s.space;
      const z = sp && ZONES[sp.zone];
      if (z) {
        g.fillStyle = st.fg; g.textAlign = 'center'; g.textBaseline = 'middle';
        fitFont(g, z.ja, p => JA(p, 700), H * 0.36, W - x0 - 10); g.fillText(z.ja, x0 + (W - x0) / 2, H * 0.4);
        g.fillStyle = st.fg2; fitFont(g, z.name, p => EN(p, 600), H * 0.2, W - x0 - 10); g.fillText(st.lower ? z.name.toLowerCase() : z.name, x0 + (W - x0) / 2, H * 0.75);
      }
      return;
    }
    // distribute: left group from left, right group from right, ahead group centred
    const L = blocks.filter(b => b.ang != null && b.ang < 0), Rr = blocks.filter(b => b.ang != null && b.ang > 0), C = blocks.filter(b => !(b.ang < 0) && !(b.ang > 0));
    const wL = L.reduce((a, b) => a + b.w, 0), wC = C.reduce((a, b) => a + b.w, 0), wR = Rr.reduce((a, b) => a + b.w, 0);
    const avail = W - x0;
    const scale = Math.min(1, avail / Math.max(1, wL + wC + wR));
    let pos = [];
    let x = x0;
    for (const b of L) { pos.push([b, x]); x += b.w * scale; }
    const endL = x;
    let xr = W;
    const posR = [];
    for (let i = Rr.length - 1; i >= 0; i--) { xr -= Rr[i].w * scale; posR.unshift([Rr[i], xr]); }
    let xc = Math.max(endL, Math.min(xr - wC * scale, endL + (xr - endL - wC * scale) / 2));
    for (const b of C) { pos.push([b, xc]); xc += b.w * scale; }
    pos = pos.concat(posR);
    g.save();
    if (scale < 1) { /* squeeze horizontally like a real overfull sign */ }
    let lastEnd = null;
    for (const [b, bx] of pos) {
      if (lastEnd != null && bx > 2 && Math.abs(bx - lastEnd) < 2) { g.fillStyle = st.div; g.fillRect(bx - 1, H * 0.12, 2, H * 0.76); }
      g.save(); g.translate(bx, 0); g.scale(scale, 1);
      this._drawBlock(g, s, b, b.w, H, st);
      g.restore();
      lastEnd = bx + b.w * scale;
    }
    g.restore();
  }

  _drawBlock(g, s, b, w, H, st) {
    const pad = H * 0.22, A = H * 0.78;
    const right = b.ang > 0;
    const hasArrow = b.ang != null;
    let x = pad;
    if (b.type === 'lvlBig') {
      picto(g, 'escalator', pad + H * 0.38, H / 2, H * 0.76, st.bg, st.fg);
      drawArrow(g, pad + H * 0.98, H * 0.5, H * 0.5, b.dir > 0 ? 0 : 180, st.arrow);
      g.fillStyle = st.fg; g.textAlign = 'left'; g.textBaseline = 'middle';
      g.font = EN(H * 0.48, 800); g.fillText(b.label, pad + H * 1.26, H * 0.4);
      g.font = JA(H * 0.16, 700); g.fillStyle = st.fg2; g.fillText(b.dir > 0 ? 'のぼり Up' : 'くだり Down', pad + H * 1.26, H * 0.82);
      return;
    }
    if (b.type === 'area') {
      g.fillStyle = st.fg; g.textAlign = 'left'; g.textBaseline = 'middle';
      g.font = JA(H * 0.36, 700); g.fillText(b.ja, pad, H * 0.38);
      g.fillStyle = st.fg2; g.font = EN(H * 0.2, 600); g.fillText(st.lower ? b.en.toLowerCase() : b.en, pad, H * 0.76);
      return;
    }
    if (b.type === 'exitBig') {
      const info = s.info;
      g.fillStyle = st.exitBg; g.fillRect(0, 0, w, H);
      g.fillStyle = st.exitFg; g.textBaseline = 'middle'; g.textAlign = 'left';
      drawArrow(g, pad + H * 0.32, H / 2, H * 0.62, 0, st.exitFg);
      let xx = pad + H * 0.75;
      g.font = JA(H * 0.36, 900); g.fillText('出口', xx, H * 0.34);
      g.font = EN(H * 0.22, 700); g.fillText('Exit', xx + 2, H * 0.74);
      g.font = JA(H * 0.36, 900); xx += measW(g, '出口') + H * 0.15;
      g.font = EN(H * 0.78, 900); g.fillText(info.no, xx, H * 0.55);
      xx += measW(g, info.no) + H * 0.25;
      g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(xx - H * 0.12, H * 0.14, 2, H * 0.72);
      const rows = info.to.slice(0, 2);
      rows.forEach(([ja, en], i) => {
        const yy = H * (rows.length === 1 ? 0.5 : 0.3 + i * 0.42);
        g.fillStyle = st.exitFg; fitFont(g, ja, p => JA(p, 700), H * 0.22, w - xx - pad); g.fillText(ja, xx, yy - H * 0.06);
        const jw = measW(g, ja);
        fitFont(g, en, p => EN(p, 600), H * 0.15, w - xx - jw - pad - 6); g.fillText(en, xx + jw + 6, yy - H * 0.05);
      });
      return;
    }
    if (b.type === 'exit') {
      g.fillStyle = st.exitBg; g.fillRect(0, 0, w, H);
      const ax = right ? w - pad - A / 2 : pad + A / 2;
      if (hasArrow) drawArrow(g, ax, H / 2, A * 0.86, b.ang, st.exitFg);
      x = right ? pad * 0.6 : hasArrow ? pad + A + H * 0.08 : pad;
      if (b.lvl) { this._lvlTag(g, right ? w - pad - A - H * 0.7 : x, H, b.lvl, st.exitFg, st.exitBg); if (!right) x += H * 0.72; }
      g.fillStyle = st.exitFg; g.textBaseline = 'middle'; g.textAlign = 'left';
      g.font = JA(H * 0.32, 900); g.fillText('出口', x, H * 0.36);
      g.font = EN(H * 0.2, 700); g.fillText('Exit', x + H * 0.02, H * 0.72);
      g.font = JA(H * 0.32, 900); const jw = measW(g, '出口');
      g.font = EN(H * 0.62, 800); g.fillText(b.label, x + jw + H * 0.14, H * 0.54);
      return;
    }
    // arrow
    const ax = right ? w - pad - A / 2 : pad + A / 2;
    if (hasArrow) {
      if (st.arrowBg) { g.fillStyle = st.arrowBg; g.beginPath(); g.arc(ax, H / 2, A * 0.5, 0, Math.PI * 2); g.fill(); }
      drawArrow(g, ax, H / 2, st.arrowBg ? A * 0.66 : A * 0.86, b.ang, st.arrowBg ? '#ffffff' : st.arrow);
    }
    x = right ? pad * 0.5 : hasArrow ? pad + A + H * 0.1 : pad;
    if (b.lvl) {
      const lx = right ? w - pad - A - H * 0.72 : x;
      this._lvlTag(g, lx, H, b.lvl, st.fg, st.bg);
      if (!right) x += H * 0.72;
    }
    if (b.type === 'fac') {
      const fi = FACILITY_INFO[b.d.fac];
      picto(g, fi.picto, x + H * 0.36, H / 2, H * 0.66, st.bg, st.fg);
      x += H * 0.8;
      g.fillStyle = st.fg; g.textAlign = 'left'; g.textBaseline = 'middle';
      g.font = JA(H * 0.3, 700); g.fillText(fi.ja, x, H * 0.38);
      g.fillStyle = st.fg2; g.font = EN(H * 0.2, 600); g.fillText(st.lower ? fi.en.toLowerCase() : fi.en, x, H * 0.72);
      return;
    }
    if (b.type === 'lvlOnly') return;
    const d = b.d;
    for (const ln of this._badges(d)) { lineBadge(g, ln, x + H * 0.27, H / 2, H * 0.26); x += H * 0.62; }
    if (this._badges(d).length) x += H * 0.04;
    g.fillStyle = st.fg; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.font = JA(H * 0.36, 700); g.fillText(this._ja(d), x, H * 0.38);
    g.fillStyle = st.fg2; g.font = EN(H * 0.2, 600); g.fillText(this._en(d, st), x, H * 0.76);
  }
  _lvlTag(g, x, H, lvl, fg, bg) {
    const w = H * 0.68, h = H * 0.5, y = (H - h) / 2;
    g.strokeStyle = fg; g.lineWidth = Math.max(1.5, H * 0.035);
    rr(g, x, y, w, h, h * 0.18); g.stroke();
    g.fillStyle = fg;
    // small up/down triangle + floor
    const tx = x + w * 0.2, ty = H / 2;
    g.beginPath();
    if (lvl.dir > 0) { g.moveTo(tx, ty - h * 0.2); g.lineTo(tx + h * 0.16, ty + h * 0.12); g.lineTo(tx - h * 0.16, ty + h * 0.12); }
    else { g.moveTo(tx, ty + h * 0.2); g.lineTo(tx + h * 0.16, ty - h * 0.12); g.lineTo(tx - h * 0.16, ty - h * 0.12); }
    g.closePath(); g.fill();
    g.font = EN(h * 0.52, 800); g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(lvl.label, x + w * 0.64, ty + 1);
  }

  // escalator mouth: [▲ 2F | via destinations]
  _escBlocks(s, f, g, st, H) {
    const bankR = new Set(s.rampIds);
    const via = [];
    let lvlLabel = null, dir = 0;
    const r0 = LAYOUT.ramps[s.rampIds[0]];
    if (f.side === 1) {
      // approaching the escalator: what is up/down there?
      dir = s.end === 'low' ? 1 : -1;
      lvlLabel = LEVELS[dir > 0 ? r0.upper : r0.lower].label;
      for (const c of f.cands) if (c.r.ramp >= 0 && bankR.has(c.r.ramp) && c.r.rampAt < 6 && c.d.kind !== 'facility') via.push(c);
    } else {
      // stepping off: normal directional content
      return this._blocks(s, f, (s.maxW || 4) * this.PPM, g);
    }
    const blocks = [{ type: 'lvlBig', dir, label: lvlLabel, ang: 0, score: 99 }];
    const seen = new Set();
    for (const c of via.sort((a, b) => b.score - a.score)) {
      if (seen.has(c.d.id) || blocks.length > 3) continue; seen.add(c.d.id);
      if (c.d.kind === 'exit') blocks.push({ type: 'exit', ang: null, nos: [EXIT_INFO[c.d.exit].no], label: EXIT_INFO[c.d.exit].no, score: c.score });
      else blocks.push({ type: 'dir', ang: null, d: c.d, score: c.score });
    }
    if (blocks.length === 1) {
      // nothing on the route list: name the floor's area
      const other = dir > 0 ? r0.upper : r0.lower;
      const z = ZONES[r0.zone];
      blocks.push({ type: 'area', ja: z ? z.ja : other, en: z ? z.name : '', ang: null, score: 1 });
    }
    for (const b of blocks) {
      if (b.type === 'lvlBig') { g.font = EN(H * 0.48, 800); const lw = measW(g, b.label); g.font = JA(H * 0.16, 700); b.w = H * 1.42 + Math.max(lw, measW(g, b.dir > 0 ? 'のぼり Up' : 'くだり Down')) + H * 0.25; }
      else if (b.type === 'area') { g.font = JA(H * 0.36, 700); b.w = H * 0.5 + Math.max(measW(g, b.ja), (g.font = EN(H * 0.2, 600), measW(g, b.en))); }
      else b.w = this._measureBlock(g, b, H, st) - H * 0.78;
    }
    const maxPx = (s.maxW || 4) * this.PPM;
    while (blocks.length > 2 && blocks.reduce((a, b) => a + b.w, 0) > maxPx) blocks.pop();
    f.esc = true;
    return blocks;
  }
  _exitHangBlocks(s, f, g, st, H, maxPx) {
    if (f.side === 1) {
      // facing the stairs: the exit itself
      const info = s.info;
      f.exitFace = true;
      return [{ type: 'exitBig', w: maxPx, ang: 0, score: 99 }];
    }
    return this._blocks(s, f, maxPx, g);
  }

  // override for esc/exit faces inside _drawDir
  _drawSpecialBlock(g, s, b, w, H, st) {}

  _drawGate(g, s, f, W, H, st) {
    const gt = s.gate;
    const line = LINES[gt.line];
    // top band: gate name
    const th = H * 0.52;
    g.fillStyle = st.bg; g.fillRect(0, 0, W, H);
    if (gt.line === 'nankai') { g.fillStyle = '#F08300'; g.fillRect(0, 0, W, th * 0.1); }
    g.fillStyle = '#2b2e33'; g.fillRect(0, th, W, 2);
    let x = th * 0.3;
    lineBadge(g, gt.line, x + th * 0.3, th / 2 + th * 0.04, th * 0.3); x += th * 0.75;
    g.fillStyle = st.fg; g.textAlign = 'left'; g.textBaseline = 'middle';
    const label = gt.line === 'nankai' ? '南海なんば駅' : gt.line === 'sennichimae' ? '千日前線' : '御堂筋線';
    g.font = JA(th * 0.26, 700); g.fillStyle = st.fg2; g.fillText(label, x, th * 0.3);
    g.fillStyle = st.fg; g.font = JA(th * 0.46, 900);
    const ja = gt.ja.replace(/^千日前線\s*/, '');
    g.fillText(ja, x, th * 0.66);
    const jw = measW(g, ja);
    g.font = EN(th * 0.3, 700); g.fillStyle = st.fg2; g.fillText(gt.name, x + jw + th * 0.25, th * 0.68);
    // paid/free side hint (right side of the title band)
    const paid = this._paidSide(s, f);
    g.textAlign = 'right';
    g.font = JA(th * 0.26, 700); g.fillStyle = st.fg;
    g.fillText(paid ? '出場 Way out' : 'のりば Platforms', W - th * 0.3, th * 0.52);
    // lower band: directions from this side
    const lh = H - th - 2;
    g.save(); g.translate(0, th + 2);
    const sub = { ...s, h: lh / this.PPM };
    this._drawDir(g, sub, f, W, lh, st);
    g.restore();
  }
  _paidSide(s, f) {
    const face = this._faces[f.fi];
    const sp = walkCell(this.ctx.world, s.level, face.x, face.z);
    if (s.gate.line === 'nankai') return face.z > s.gate.at;
    return !!(sp && sp.paid);
  }

  _drawTotem(g, s, f, W, H, st) {
    g.fillStyle = st.bg; g.fillRect(0, 0, W, H);
    const parks = s.op === 'parks';
    // header
    const hh = W * 0.42;
    g.fillStyle = parks ? '#2b211a' : '#2a2d33'; g.fillRect(0, 0, W, hh);
    g.fillStyle = parks ? '#a5d47f' : '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    if (parks) { g.font = EN(W * 0.13, 700); g.fillText('namba parks', W / 2, hh * 0.42); g.font = JA(W * 0.08, 500); g.fillStyle = st.fg2; g.fillText(LEVELS[s.level].label + ' ・ ' + (s.space && s.space.garden ? 'パークスガーデン' : 'キャニオン'), W / 2, hh * 0.75); }
    else { lineBadge(g, 'midosuji', W * 0.3, hh * 0.45, W * 0.1); lineBadge(g, 'sennichimae', W * 0.5, hh * 0.45, W * 0.1); lineBadge(g, 'yotsubashi', W * 0.7, hh * 0.45, W * 0.1); g.font = JA(W * 0.075, 700); g.fillText('なんば駅 Namba Sta.', W / 2, hh * 0.85); }
    // rows
    const rows = f.blocks || [];
    const rh = Math.min(W * 0.36, (H - hh - W * 0.1) / Math.max(1, rows.length));
    let y = hh + W * 0.06;
    for (const b of rows) {
      const A = rh * 0.62;
      if (b.ang !== null) drawArrow(g, W * 0.14, y + rh / 2, A, b.ang, st.arrow);
      g.textAlign = 'left'; g.fillStyle = st.fg;
      let x = W * 0.27;
      const ja = b.type === 'exit' ? `出口 ${b.label}` : b.type === 'fac' ? FACILITY_INFO[b.d.fac].ja : this._ja(b.d);
      const en = b.type === 'exit' ? `Exit ${b.label}` : b.type === 'fac' ? FACILITY_INFO[b.d.fac].en : this._en(b.d, st);
      if (b.type === 'dir' && this._badges(b.d).length) { lineBadge(g, this._badges(b.d)[0], x + rh * 0.16, y + rh * 0.36, rh * 0.15); x += rh * 0.38; }
      fitFont(g, ja, p => JA(p, 700), rh * 0.3, W - x - W * 0.05); g.fillText(ja, x, y + rh * 0.38);
      g.fillStyle = st.fg2; fitFont(g, en, p => EN(p, 600), rh * 0.19, W - x - W * 0.05); g.fillText(st.lower ? en.toLowerCase() : en, x, y + rh * 0.72);
      if (b.lvl) { g.font = EN(rh * 0.2, 800); g.fillStyle = st.arrow; g.textAlign = 'center'; g.fillText((b.lvl.dir > 0 ? '▲' : '▼') + b.lvl.label, W * 0.14, y + rh * 0.92); }
      g.fillStyle = st.div; g.fillRect(W * 0.06, y + rh - 1, W * 0.88, 2);
      y += rh;
    }
  }

  // station name board (platform hanging, or on the tunnel wall)
  _drawPlatName(g, s, f, W, H, wall) {
    const line = s.line, B = PLATFORM_BOARDS[line], Lc = LINES[line];
    const nankai = line === 'nankai';
    g.fillStyle = wall ? '#f6f6f3' : nankai ? '#20242b' : '#f4f4f1'; g.fillRect(0, 0, W, H);
    const fg = nankai && !wall ? '#ffffff' : '#1b1b1b', fg2 = nankai && !wall ? '#c5cad2' : '#555';
    // colour band
    g.fillStyle = Lc.color; g.fillRect(0, H * 0.6, W, H * 0.09);
    // station name centre
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = JA(H * 0.36, 900); g.fillText(B.here[0], W / 2, H * 0.27);
    g.font = EN(H * 0.13, 700); g.fillStyle = fg2; g.fillText(B.here[1], W / 2, H * 0.51);
    // station number badge
    const code = B.here[2];
    const bx = W / 2 - measW(g, B.here[1]) / 2 - H * 0.3;
    g.font = JA(H * 0.36, 900); const nameW = measW(g, B.here[0]);
    const cx = W / 2 - nameW / 2 - H * 0.32;
    if (Lc.shape === 'circle') { g.fillStyle = Lc.color; g.beginPath(); g.arc(cx, H * 0.29, H * 0.17, 0, Math.PI * 2); g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.arc(cx, H * 0.29, H * 0.12, 0, Math.PI * 2); g.fill(); g.fillStyle = '#1b1b1b'; g.font = EN(H * 0.1, 800); g.fillText(code, cx, H * 0.3); }
    else { g.fillStyle = Lc.color; rr(g, cx - H * 0.17, H * 0.12, H * 0.34, H * 0.34, H * 0.05); g.fill(); g.fillStyle = '#fff'; g.font = EN(H * 0.1, 800); g.fillText(code, cx, H * 0.29); }
    // prev / next relative to the viewer: viewer faces -normal
    const nx = s.nx * f.side, nz = s.nz * f.side; // face normal
    const fx = -nx, fz = -nz;
    const rx = -fz, rz = fx; // viewer's right
    const toPlus = B.axis === 'z' ? rz : rx; // +1 when "plus" direction is to the right
    const left = toPlus > 0 ? B.minus : B.plus, right = toPlus > 0 ? B.plus : B.minus;
    const by = H * 0.83;
    g.textBaseline = 'middle';
    const side = (st, x, align, arrowDeg) => {
      if (!st) return;
      g.fillStyle = fg; g.textAlign = align;
      g.font = JA(H * 0.15, 700); g.fillText(st[0], x, by - H * 0.03);
      const jw = measW(g, st[0]);
      g.font = EN(H * 0.08, 600); g.fillStyle = fg2; g.fillText(`${st[1]}  ${st[2]}`, x, by + H * 0.1);
      drawArrow(g, align === 'left' ? x - H * 0.1 : x + H * 0.1, by, H * 0.14, arrowDeg, Lc.color);
    };
    side(left, H * 0.32, 'left', -90);
    side(right, W - H * 0.32, 'right', 90);
  }

  // subway track direction board: "1 天王寺・なかもず方面 | 梅田・新大阪方面 2"
  _drawPlatTrack(g, s, f, W, H) {
    g.fillStyle = '#1c1e21'; g.fillRect(0, 0, W, H);
    const nx = s.nx * f.side, nz = s.nz * f.side; const fx = -nx, fz = -nz; const rx = -fz, rz = fx;
    const tr = s.tracks.map(t => {
      const cx = (t.rect[0] + t.rect[2]) / 2 - s.x, cz = (t.rect[1] + t.rect[3]) / 2 - s.z;
      return { t, side: Math.sign(cx * rx + cz * rz) };
    }).sort((a, b) => a.side - b.side);
    const half = W / 2;
    g.fillStyle = '#474b52'; g.fillRect(half - 1, H * 0.12, 2, H * 0.76);
    for (const { t, side } of tr) {
      const x0 = side < 0 ? 0 : half, Lc = LINES[t.line];
      const nx0 = side < 0 ? x0 + H * 0.2 : x0 + half - H * 0.2 - H * 0.6;
      // track number box
      g.fillStyle = '#ffffff'; rr(g, nx0, H * 0.18, H * 0.6, H * 0.64, H * 0.08); g.fill();
      g.fillStyle = '#111'; g.font = EN(H * 0.5, 800); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(t.no), nx0 + H * 0.3, H * 0.52);
      lineBadge(g, t.line, side < 0 ? nx0 + H * 0.95 : nx0 - H * 0.35, H / 2, H * 0.22);
      g.textAlign = side < 0 ? 'left' : 'right';
      const tx = side < 0 ? nx0 + H * 1.3 : nx0 - H * 0.7;
      g.fillStyle = '#fff'; fitFont(g, t.dirJa, p => JA(p, 700), H * 0.32, half - H * 2.2); g.fillText(t.dirJa, tx, H * 0.38);
      g.fillStyle = '#b9bec5'; fitFont(g, t.dirEn, p => EN(p, 600), H * 0.19, half - H * 2.2); g.fillText(t.dirEn, tx, H * 0.74);
    }
  }

  // Nankai platform head: "1 高野線 橋本・極楽橋方面 | 2 ..."
  _drawNkHead(g, s, f, W, H) {
    g.fillStyle = '#1f232b'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#F08300'; g.fillRect(0, 0, W, H * 0.07);
    const nx = s.nx * f.side, nz = s.nz * f.side; const fx = -nx, fz = -nz; const rx = -fz, rz = fx;
    const tr = s.tracks.map(t => ({ t, side: Math.sign(((t.rect[0] + t.rect[2]) / 2 - s.x) * rx + ((t.rect[1] + t.rect[3]) / 2 - s.z) * rz) })).sort((a, b) => a.side - b.side);
    const half = W / 2;
    g.fillStyle = '#4a505b'; g.fillRect(half - 1, H * 0.15, 2, H * 0.75);
    for (const { t, side } of tr) {
      const info = NANKAI_TRACKS[t.no] || ['南海線', 'Nankai Line', '', ''];
      const x0 = side < 0 ? 0 : half;
      const bx = side < 0 ? x0 + H * 0.12 : x0 + half - H * 0.12 - H * 0.55;
      g.fillStyle = '#F08300'; rr(g, bx, H * 0.2, H * 0.55, H * 0.6, H * 0.06); g.fill();
      g.fillStyle = '#fff'; g.font = EN(H * 0.42, 800); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(t.no), bx + H * 0.275, H * 0.52);
      g.textAlign = side < 0 ? 'left' : 'right';
      const tx = side < 0 ? bx + H * 0.7 : bx - H * 0.15, mw = half - H * 1.0;
      g.fillStyle = '#ffd08a'; fitFont(g, info[0] + ' ' + info[1], p => JA(p, 700), H * 0.17, mw); g.fillText(info[0] + '  ' + info[1], tx, H * 0.27);
      g.fillStyle = '#fff'; fitFont(g, info[2], p => JA(p, 700), H * 0.24, mw); g.fillText(info[2], tx, H * 0.53);
      g.fillStyle = '#c6cbd3'; fitFont(g, info[3], p => EN(p, 600), H * 0.14, mw); g.fillText(info[3], tx, H * 0.79);
    }
  }

  // Floor guide map: "現在地 You are here"
  _drawGuide(g, s, f, W, H) {
    const op = s.op;
    const head = { walk: ['なんばウォーク', 'NAMBAWALK', '#d9a400'], city: ['なんばCITY', 'Namba CITY', '#1f6fb8'], parks: ['なんばパークス', 'namba parks', '#5c9e3f'],
      nankai: ['南海なんば駅', 'Nankai Namba Station', '#F08300'], metro: ['なんば駅 構内図', 'Namba Station Map', '#E5171F'], taka: ['高島屋 大阪店', 'Takashimaya Osaka', '#1d4a33'] }[op] || ['なんば', 'Namba', '#444'];
    g.fillStyle = '#fbfaf6'; g.fillRect(0, 0, W, H);
    const hh = H * 0.12;
    g.fillStyle = '#25282d'; g.fillRect(0, 0, W, hh);
    g.fillStyle = head[2]; g.fillRect(0, hh - 3, W, 3);
    g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.textAlign = 'left';
    g.font = JA(hh * 0.42, 900); g.fillText(head[0], hh * 0.35, hh * 0.45);
    const jw = measW(g, head[0]);
    g.font = EN(hh * 0.26, 600); g.fillStyle = '#c7ccd3'; g.fillText(head[1] + '  ·  フロアガイド Floor Guide', hh * 0.35 + jw + hh * 0.3, hh * 0.5);
    g.textAlign = 'right'; g.font = EN(hh * 0.5, 800); g.fillStyle = '#fff'; g.fillText(LEVELS[s.level].label, W - hh * 0.3, hh * 0.52);
    // map area
    const mx = H * 0.03, my = hh + H * 0.03, mw = W * 0.64, mh = H - my - H * 0.03;
    g.save(); g.beginPath(); g.rect(mx, my, mw, mh); g.clip();
    g.fillStyle = '#d9d5cc'; g.fillRect(mx, my, mw, mh);
    const scale = mh / 78; // px per metre
    // heads-up: you stand with your back to the walkable area → dot high on the map
    const cxp = mx + mw / 2, cyp = my + mh * (s.northUp ? 0.5 : 0.3);
    // orientation: heads-up = viewer's forward (into the wall) is up
    const fx = -s.nx, fz = -s.nz;
    const rot = s.northUp ? 0 : Math.atan2(fx, -fz); // angle to rotate world so forward → up
    g.translate(cxp, cyp); g.rotate(-rot); g.scale(scale, scale); g.translate(-s.x, -s.z);
    const R = Math.hypot(mw, mh) / scale / 2 + 4;
    drawFloor(g, this.ctx.world, s.level, THEMES.guide, { bounds: [s.x - R, s.z - R, s.x + R, s.z + R], businessBySlot });
    g.restore();
    // project helper (world → board px)
    const cr = Math.cos(-rot), sr = Math.sin(-rot);
    const proj = (x, z) => { const dx = (x - s.x) * scale, dz = (z - s.z) * scale; return [cxp + dx * cr - dz * sr, cyp + dx * sr + dz * cr]; };
    // shop numbers + directory
    const list = [];
    const R2 = Math.hypot(mw, mh) / scale / 2;
    for (const sl of LAYOUT.shopSlots) {
      if (sl.level !== s.level) continue;
      const b = businessBySlot[sl.id]; if (!b || b.cat === 'closed') continue;
      const [px, py] = proj(b.x, b.z);
      if (px < mx + 8 || px > mx + mw - 8 || py < my + 8 || py > my + mh - 8) continue;
      list.push({ b, px, py, d: Math.hypot(b.x - s.x, b.z - s.z) });
    }
    list.sort((a, b) => a.d - b.d);
    const shown = list.slice(0, 18);
    shown.sort((a, b) => a.py - b.py || a.px - b.px);
    g.save(); g.beginPath(); g.rect(mx, my, mw, mh); g.clip();
    shown.forEach((it, i) => {
      it.n = i + 1;
      g.fillStyle = '#2d3138'; g.beginPath(); g.arc(it.px, it.py, H * 0.022, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#fff'; g.font = EN(H * 0.026, 800); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(it.n), it.px, it.py + 0.5);
    });
    // ramps: escalator icons
    for (const r of LAYOUT.ramps) {
      if (r.lower !== s.level && r.upper !== s.level) continue;
      const [px, py] = proj((r.rect[0] + r.rect[2]) / 2, (r.rect[1] + r.rect[3]) / 2);
      if (px < mx || px > mx + mw || py < my || py > my + mh) continue;
      picto(g, r.kind === 'escalator' ? 'escalator' : 'stairs', px + H * 0.045, py - H * 0.045, H * 0.05, '#ffffff', '#3b6fb6');
    }
    // facilities
    for (const fc of this.facilities) {
      if (fc.level !== s.level) continue;
      const [px, py] = proj(fc.x + fc.nx, fc.z + fc.nz);
      if (px < mx || px > mx + mw || py < my || py > my + mh) continue;
      picto(g, FACILITY_INFO[fc.kind].picto, px, py, H * 0.055, '#ffffff', fc.kind === 'toilet' ? '#2b6cb0' : '#4a5568');
    }
    // exits
    for (const ex of LAYOUT.exits) {
      const info = EXIT_INFO[ex.id]; if (!info) continue;
      const r = LAYOUT.ramps.find(q => q.id === info.ramp); if (!r || (r.lower !== s.level && r.upper !== s.level)) continue;
      const E = rampEnds(r);
      const [px, py] = proj(E.low.x, E.low.z);
      if (px < mx || px > mx + mw || py < my || py > my + mh) continue;
      g.fillStyle = '#ffd400'; rr(g, px - H * 0.03, py - H * 0.022, H * 0.06, H * 0.044, 3); g.fill();
      g.fillStyle = '#111'; g.font = EN(H * 0.03, 800); g.textAlign = 'center'; g.fillText(info.no, px, py + 1);
    }
    // you are here
    const [hx, hy] = proj(s.x + s.nx * 1.2, s.z + s.nz * 1.2);
    g.fillStyle = 'rgba(230,30,40,0.18)'; g.beginPath(); g.arc(hx, hy, H * 0.06, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#e61e28'; g.beginPath(); g.arc(hx, hy, H * 0.022, 0, Math.PI * 2); g.fill();
    // viewer heading triangle
    const fa = Math.atan2(fx, -fz) - rot;
    g.save(); g.translate(hx, hy); g.rotate(fa);
    g.beginPath(); g.moveTo(0, -H * 0.06); g.lineTo(H * 0.025, -H * 0.028); g.lineTo(-H * 0.025, -H * 0.028); g.closePath(); g.fill(); g.restore();
    g.fillStyle = '#e61e28'; rr(g, hx + H * 0.03, hy - H * 0.05, H * 0.2, H * 0.06, 4); g.fill();
    g.fillStyle = '#fff'; g.font = JA(H * 0.03, 900); g.textAlign = 'left'; g.fillText('現在地', hx + H * 0.04, hy - H * 0.028);
    g.font = EN(H * 0.019, 700); g.fillText('You are here', hx + H * 0.04, hy - H * 0.004 - H * 0.002);
    g.restore();
    // north arrow
    const nxp = mx + mw - H * 0.07, nyp = my + H * 0.07;
    g.save(); g.translate(nxp, nyp); g.rotate(-rot);
    g.fillStyle = 'rgba(255,255,255,0.85)'; g.beginPath(); g.arc(0, 0, H * 0.045, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#c62828'; g.beginPath(); g.moveTo(0, -H * 0.038); g.lineTo(H * 0.014, 0); g.lineTo(-H * 0.014, 0); g.closePath(); g.fill();
    g.fillStyle = '#333'; g.beginPath(); g.moveTo(0, H * 0.038); g.lineTo(H * 0.014, 0); g.lineTo(-H * 0.014, 0); g.closePath(); g.fill();
    g.fillStyle = '#c62828'; g.font = EN(H * 0.022, 800); g.textAlign = 'center'; g.fillText('N', 0, -H * 0.052);
    g.restore();
    if (!s.northUp) { g.fillStyle = '#555'; g.font = EN(H * 0.02, 600); g.textAlign = 'left'; g.fillText('この地図は進行方向が上です · Map faces the way you look', mx + 6, my + mh - 10); }
    // directory column
    const dx0 = mx + mw + H * 0.03, dw = W - dx0 - H * 0.03;
    g.fillStyle = '#2d3138'; g.font = JA(H * 0.032, 900); g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText('ショップガイド Shop Guide', dx0, my + H * 0.025);
    g.fillStyle = '#d0ccc2'; g.fillRect(dx0, my + H * 0.05, dw, 2);
    const lh = (mh - H * 0.08) / Math.max(10, shown.length);
    shown.forEach((it, i) => {
      const y = my + H * 0.08 + i * lh + lh / 2;
      g.fillStyle = '#2d3138'; g.beginPath(); g.arc(dx0 + lh * 0.35, y, lh * 0.32, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#fff'; g.font = EN(lh * 0.42, 800); g.textAlign = 'center'; g.fillText(String(it.n), dx0 + lh * 0.35, y + 0.5);
      g.textAlign = 'left'; g.fillStyle = '#1e2126';
      const t = `${it.b.ja}`;
      fitFont(g, t, p => JA(p, 700), lh * 0.46, dw * 0.55); g.fillText(t, dx0 + lh * 0.85, y);
      const tw = measW(g, t);
      g.fillStyle = '#6b6f76'; fitFont(g, it.b.en, p => EN(p, 500), lh * 0.36, dw - lh * 0.9 - tw - 8); g.fillText(it.b.en, dx0 + lh * 0.85 + tw + 6, y + 1);
    });
  }

  // ===========================================================================
  // GEOMETRY
  // ===========================================================================
  _buildMeshes() {
    const { engine, materials } = this.ctx;
    const batches = new Map();
    const B = (lv, x, z) => {
      const k = `${lv}|${Math.floor(x / CHUNK)}|${Math.floor(z / CHUNK)}`;
      let b = batches.get(k); if (!b) batches.set(k, b = new GeoBatch());
      return b;
    };
    // housing materials (own names, defined here)
    if (!materials.factories.has('sign_housing')) materials.define('sign_housing', () => new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.45, metalness: 0.7 }));
    if (!materials.factories.has('sign_housing_light')) materials.define('sign_housing_light', () => new THREE.MeshStandardMaterial({ color: 0xc9ccd0, roughness: 0.35, metalness: 0.8 }));
    if (!materials.factories.has('sign_wood')) materials.define('sign_wood', () => new THREE.MeshStandardMaterial({ color: 0x5a4330, roughness: 0.7, metalness: 0.0 }));
    if (!materials.factories.has('sign_doorway')) materials.define('sign_doorway', () => new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.8 }));
    const quadFace = (b, f, s, cx, cy, cz, nx, nz, w, h) => {
      const r = f.rect; if (!r) return;
      const S = r.page.canvas.width;
      const u0 = r.x / S, u1 = (r.x + r.w) / S, v1 = 1 - r.y / S, v0 = 1 - (r.y + r.h) / S;
      const rx = nz, rz = -nx; // viewer's right
      const a = [cx - rx * w / 2, cy - h / 2, cz - rz * w / 2], bb = [cx + rx * w / 2, cy - h / 2, cz + rz * w / 2];
      const c = [cx + rx * w / 2, cy + h / 2, cz + rz * w / 2], d = [cx - rx * w / 2, cy + h / 2, cz - rz * w / 2];
      b.quad(this.pageMats.get(r.page), a, bb, c, d, { uv: [[u0, v0], [u1, v0], [u1, v1], [u0, v1]] });
    };
    for (const s of this.signs) {
      if (s.dead || !s.faces || !s.faces.length || !s.w) continue;
      const b = B(s.level, s.x, s.z);
      const y = s.y0 + s.yc;
      const st = STYLES[s.op] || STYLES.metro;
      const housing = st.frame === 'aluminium' ? 'sign_housing_light' : 'sign_housing';
      const rotY = Math.atan2(s.nx, s.nz);
      if (s.kind === 'guide' || s.kind === 'wallName') {
        // wall-mounted light box
        const dep = 0.08;
        b.box(housing, s.x + s.nx * dep / 2, y, s.z + s.nz * dep / 2, s.w + 0.08, s.h + 0.08, dep, rotY);
        quadFace(b, s.faces[0], s, s.x + s.nx * (dep + 0.003), y, s.z + s.nz * (dep + 0.003), s.nx, s.nz, s.w, s.h);
        continue;
      }
      if (s.kind === 'column') {
        // four-sided band on a column
        const sides = [[0, 1, s.hx], [1, 0, s.hz], [0, -1, s.hx], [-1, 0, s.hz]];
        s.faces.forEach((f, i) => {
          const fi = this._faces[f.fi];
          const nx = fi.nx, nz = fi.nz;
          const half = Math.abs(nx) ? s.hx : s.hz, wid = (Math.abs(nx) ? s.hz : s.hx) * 2 + 0.04;
          quadFace(b, f, s, s.x + nx * (half + 0.025), y, s.z + nz * (half + 0.025), nx, nz, wid, s.h);
        });
        b.box(housing, s.x, y, s.z, s.hx * 2 + 0.04, s.h + 0.04, s.hz * 2 + 0.04, 0, { faces: 'tb' });
        continue;
      }
      if (s.kind === 'totem') {
        const dep = 0.16;
        b.box(st.frame === 'steel_dark' && s.op === 'parks' ? 'sign_wood' : housing, s.x, s.y0 + (s.yc + s.h / 2 + 0.06) / 2, s.z, s.w + 0.08, s.yc + s.h / 2 + 0.06, dep, rotY);
        s.faces.forEach(f => quadFace(b, f, s, s.x + s.nx * f.side * (dep / 2 + 0.003), y, s.z + s.nz * f.side * (dep / 2 + 0.003), s.nx * f.side, s.nz * f.side, s.w, s.h));
        continue;
      }
      // hanging light box (double-sided unless single)
      const dep = s.kind === 'gate' ? 0.22 : 0.16;
      b.box(housing, s.x, y, s.z, s.w + 0.07, s.h + 0.07, dep, rotY);
      for (const f of s.faces) quadFace(b, f, s, s.x + s.nx * f.side * (dep / 2 + 0.003), y, s.z + s.nz * f.side * (dep / 2 + 0.003), s.nx * f.side, s.nz * f.side, s.w, s.h);
      // suspension rods to the ceiling
      const top = s.y0 + (s.ceil || 3.2);
      const rodH = top - (y + s.h / 2 + 0.035);
      if (rodH > 0.02) {
        const rx = s.nz, rz = -s.nx;
        for (const o of [-0.36, 0.36]) {
          const ox = s.x + rx * s.w * o, oz = s.z + rz * s.w * o;
          b.box('steel', ox, y + s.h / 2 + 0.035 + rodH / 2, oz, 0.03, rodH, 0.03, 0);
          b.box(housing, ox, top - 0.02, oz, 0.12, 0.04, 0.12, 0);
        }
      }
    }
    // street entrance boxes (Osaka Metro style)
    this._buildEntrances(B);
    // facilities (doorways, plates, blades, lockers, taxi pole)
    this._buildFacilities(B);
    for (const [k, b] of batches) {
      const [lv, cx, cz] = k.split('|');
      const grp = new THREE.Group(); grp.name = `signage:${k}`;
      grp.userData.chunk = { level: lv, x: (+cx + 0.5) * CHUNK, z: (+cz + 0.5) * CHUNK, r: CHUNK * 0.75 };
      for (const m of b.build(materials, { name: 'signage', receiveShadow: false })) { m.castShadow = false; grp.add(m); }
      engine.levelRoot(lv).add(grp);
    }
  }

  // small extra canvases for entrance boxes / facility plates, drawn on demand
  _miniRect(key, wpx, hpx, draw) {
    this._mini = this._mini || new Map();
    let r = this._mini.get(key);
    if (r) return r;
    r = this.atlas.alloc(wpx, hpx);
    const g = r.page.g;
    g.save(); g.beginPath(); g.rect(r.x, r.y, r.w, r.h); g.clip(); g.translate(r.x, r.y);
    draw(g, r.w, r.h); g.restore();
    r.page.tex && (r.page.tex.needsUpdate = true);
    if (!this.pageMats.has(r.page)) {
      const tex = new THREE.CanvasTexture(r.page.canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
      r.page.tex = tex;
      const m = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.35, 1.35, 1.35) }); m.name = 'sign_face';
      this.pageMats.set(r.page, m);
    }
    this._mini.set(key, r);
    return r;
  }
  _quadRect(b, r, cx, cy, cz, nx, nz, w, h, mat) {
    const S = r.page.canvas.width;
    const u0 = r.x / S, u1 = (r.x + r.w) / S, v1 = 1 - r.y / S, v0 = 1 - (r.y + r.h) / S;
    const rx = nz, rz = -nx;
    b.quad(mat || this.pageMats.get(r.page), [cx - rx * w / 2, cy - h / 2, cz - rz * w / 2], [cx + rx * w / 2, cy - h / 2, cz + rz * w / 2], [cx + rx * w / 2, cy + h / 2, cz + rz * w / 2], [cx - rx * w / 2, cy + h / 2, cz - rz * w / 2], { uv: [[u0, v0], [u1, v0], [u1, v1], [u0, v1]] });
  }
  _buildEntrances(B) {
    const P = this.PPM;
    for (const e of this.entrances || []) {
      const lv = e.level, y0 = LEVELS[lv].y;
      const b = B(lv, e.x, e.z);
      const w = 0.95, h = 0.95;
      const r = this._miniRect('ent' + e.info.no, w * P, h * P, (g, W, H) => {
        g.fillStyle = '#f7f7f4'; g.fillRect(0, 0, W, H);
        g.fillStyle = '#0c2a5c'; g.fillRect(0, 0, W, H * 0.3);
        g.fillStyle = '#fff'; g.font = EN(H * 0.12, 800); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('Osaka Metro', W / 2, H * 0.15);
        lineBadge(g, 'midosuji', W * 0.25, H * 0.43, H * 0.08); lineBadge(g, 'sennichimae', W * 0.5, H * 0.43, H * 0.08); lineBadge(g, 'yotsubashi', W * 0.75, H * 0.43, H * 0.08);
        g.fillStyle = '#111'; g.font = JA(H * 0.12, 900); g.fillText('なんば駅', W / 2, H * 0.6);
        g.font = EN(H * 0.07, 600); g.fillStyle = '#555'; g.fillText('Namba Sta.', W / 2, H * 0.71);
        g.fillStyle = '#ffd400'; g.fillRect(0, H * 0.78, W, H * 0.22);
        g.fillStyle = '#111'; g.font = EN(H * 0.17, 900); g.fillText(e.info.no, W * 0.72, H * 0.89);
        g.font = JA(H * 0.08, 900); g.fillText('出口', W * 0.38, H * 0.86); g.font = EN(H * 0.05, 700); g.fillText('Exit', W * 0.38, H * 0.95);
      });
      const yc = y0 + 2.75;
      b.box('sign_housing', e.x, y0 + 1.15, e.z, 0.1, 2.3, 0.1, 0);
      b.box('sign_housing', e.x, yc, e.z, e.nz ? w + 0.06 : 0.22, h + 0.06, e.nz ? 0.22 : w + 0.06, 0);
      for (const sd of [1, -1]) this._quadRect(b, r, e.x + e.nx * sd * 0.113, yc, e.z + e.nz * sd * 0.113, e.nx * sd, e.nz * sd, w, h);
    }
  }
  _buildFacilities(B) {
    const P = this.PPM;
    for (const f of this.facilities) {
      const lv = f.level, y0 = LEVELS[lv].y, b = B(lv, f.x, f.z);
      const info = FACILITY_INFO[f.kind];
      const plate = this._miniRect('fac_' + f.kind, 1.6 * P, 0.42 * P, (g, W, H) => {
        g.fillStyle = f.kind === 'toilet' ? '#1d4f91' : '#2b2f36'; g.fillRect(0, 0, W, H);
        picto(g, info.picto, H * 0.55, H / 2, H * 0.78, f.kind === 'toilet' ? '#1d4f91' : '#2b2f36', '#ffffff');
        g.fillStyle = '#fff'; g.textAlign = 'left'; g.textBaseline = 'middle';
        g.font = JA(H * 0.34, 700); g.fillText(info.ja, H * 1.1, H * 0.38);
        g.font = EN(H * 0.2, 600); g.fillStyle = '#d5dae2'; g.fillText(info.en, H * 1.1, H * 0.74);
      });
      if (f.pole) {
        b.box('steel', f.x, y0 + 1.4, f.z, 0.08, 2.8, 0.08, 0);
        for (const sd of [1, -1]) this._quadRect(b, plate, f.x + f.nz * sd * 0.03, y0 + 2.5, f.z - f.nx * sd * 0.03, f.nz * sd, -f.nx * sd, 1.6, 0.42);
        b.box('sign_housing', f.x, y0 + 2.5, f.z, f.nz ? 0.05 : 1.66, 0.48, f.nz ? 1.66 : 0.05, 0);
        continue;
      }
      const tx = f.nz, tz = -f.nx; // along the wall
      if (f.kind === 'toilet') {
        // doorway: dark recess with a frame + plate over it
        b.box('sign_doorway', f.x + f.nx * 0.01, y0 + 1.15, f.z + f.nz * 0.01, f.nx ? 0.02 : 1.7, 2.3, f.nx ? 1.7 : 0.02, 0);
        b.box('sign_housing_light', f.x + f.nx * 0.03 + tx * 0.88, y0 + 1.2, f.z + f.nz * 0.03 + tz * 0.88, f.nx ? 0.06 : 0.08, 2.4, f.nx ? 0.08 : 0.06, 0);
        b.box('sign_housing_light', f.x + f.nx * 0.03 - tx * 0.88, y0 + 1.2, f.z + f.nz * 0.03 - tz * 0.88, f.nx ? 0.06 : 0.08, 2.4, f.nx ? 0.08 : 0.06, 0);
        this._quadRect(b, plate, f.x + f.nx * 0.04, y0 + 2.62, f.z + f.nz * 0.04, f.nx, f.nz, 1.6, 0.42);
      } else if (f.kind === 'locker') {
        const lr = this._miniRect('lockerface', 3.2 * 60, 1.9 * 60, (g, W, H) => {
          g.fillStyle = '#c9ced4'; g.fillRect(0, 0, W, H);
          const cols = 8, rows = 5;
          for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
            const x = i * W / cols, y = j * H / rows;
            g.fillStyle = (i * 7 + j * 3) % 11 === 0 ? '#e4b23a' : '#e9ecef'; g.fillRect(x + 2, y + 2, W / cols - 4, H / rows - 4);
            g.fillStyle = '#5b636d'; g.fillRect(x + W / cols - 10, y + H / rows / 2 - 4, 4, 8);
            g.fillStyle = (i + j) % 3 ? '#2fa84f' : '#d64545'; g.fillRect(x + 6, y + 6, 4, 4);
          }
        });
        const cx = f.x + f.nx * 0.35, cz = f.z + f.nz * 0.35;
        b.box('sign_housing_light', cx, y0 + 0.95, cz, f.nx ? 0.62 : 3.2, 1.9, f.nx ? 3.2 : 0.62, 0);
        this._quadRect(b, lr, f.x + f.nx * 0.665, y0 + 0.95, f.z + f.nz * 0.665, f.nx, f.nz, 3.1, 1.85, this.pageMats.get(lr.page));
        this._quadRect(b, plate, f.x + f.nx * 0.04, y0 + 2.55, f.z + f.nz * 0.04, f.nx, f.nz, 1.6, 0.42);
      }
      // projecting blade sign (double sided)
      const bx = f.x + f.nx * 0.7, bz = f.z + f.nz * 0.7, by = y0 + 2.5;
      for (const sd of [1, -1]) this._quadRect(b, plate, bx + tx * sd * 0.03, by, bz + tz * sd * 0.03, tx * sd, tz * sd, 1.2, 0.315);
      b.box('sign_housing', bx, by, bz, f.nx ? 1.24 : 0.05, 0.35, f.nx ? 0.05 : 1.24, 0);
    }
  }
}
