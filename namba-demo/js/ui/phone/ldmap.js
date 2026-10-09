// =============================================================================
// v8 — Lodestone's top-down map (Zack: "the map should be more helpful and rich").
//
// The raised app's main view: the real floor plan of the floor you are on
// (maprender.js, THEMES.lodestone), heading-up and following you, with
//   · the route on this floor (amber, flowing toward the goal),
//   · your dot + heading cone + the ±1 m halo,
//   · the next milestone as a pin ("▲ 3F", the bridge, the destination),
//   · 2–3 names of shops you are about to walk past, beside the route,
//   · a north chip and a small floor ladder (where the route climbs to).
// The zoom eases so the next milestone stays in view.
// Also draws the calibration visual (the floor plan appearing, guesses
// converging onto you). Pure canvas; the app (lodestone.js) owns the DOM.
// =============================================================================
import { LEVELS, LEVEL_ORDER, LAYOUT } from '../../world/layout.js';
import { CELL } from '../../world/world.js';
import { BUSINESSES } from '../../world/directory.js';
import { drawFloor, THEMES } from './maprender.js';

const TH = THEMES.lodestone;
const TAU = Math.PI * 2;
const lvl = (l) => (LEVELS[l] ? LEVELS[l].label : String(l || '')).replace('B1F', 'B1').replace('B2F', 'B2');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const levelOfY = (y) => { let best = null, bd = 1e9; for (const l of LEVEL_ORDER) { const d = Math.abs(LEVELS[l].y - y); if (d < bd) { bd = d; best = l; } } return best; };

// calibration stages (fraction of T_CALIB at which each one is done)
export const CAL_DONE = [0.27, 0.56, 0.83, 0.93];

function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

export class LdMap {
  // icons: { key: '<path d=…/>' } (lodestone.js ICONS) — drawn as Path2D in the pins
  constructor(app, canvas, icons) {
    this.app = app; this.ctx = app.ctx; this.c = canvas; this.g = canvas.getContext('2d');
    this.icons = icons || {}; this._p2d = {};
    this.base = new Map();
    this.v = { cx: 0, cz: 0, rot: 0, k: 2.6, level: null, init: false };
    this._lab = []; this._labT = 0; this._t = 0;
    this._lvCache = null;
  }

  // ------------------------------------------------------------------ data ---
  _path(k) {
    if (this._p2d[k]) return this._p2d[k];
    const src = this.icons[k] || this.icons.straight || '';
    const d = [...src.matchAll(/ d="([^"]+)"/g)].map(m => m[1]).join(' ');
    let p = null; try { p = new Path2D(d); } catch (e) { p = null; }
    return (this._p2d[k] = p);
  }
  baseFor(level) {
    let b = this.base.get(level);
    if (b) return b;
    const grid = this.ctx.world.grids[level]; if (!grid) return null;
    const ppm = this.app.phone.lowQ ? 3 : 4;
    const c = document.createElement('canvas');
    c.width = Math.ceil(grid.w * ppm); c.height = Math.ceil(grid.h * ppm);
    const g = c.getContext('2d');
    g.setTransform(ppm, 0, 0, ppm, -grid.x0 * ppm, -grid.z0 * ppm);
    drawFloor(g, this.ctx.world, level, TH, {});
    b = { canvas: c, x0: grid.x0, z0: grid.z0, w: grid.w, h: grid.h };
    this.base.set(level, b);
    return b;
  }
  // shops (doors) + landmarks on a level, for the "you'll pass" labels
  _cands(level) {
    const C = this._cc || (this._cc = {});
    if (C[level]) return C[level];
    const out = [];
    for (const b of BUSINESSES) if (b.level === level && b.door && b.en && b.cat !== 'closed') out.push({ id: b.slot, name: b.en, x: b.door.x, z: b.door.z });
    for (const p of LAYOUT.pois) if (p.kind === 'landmark' && p.level === level) out.push({ id: p.id, name: p.name, x: p.x, z: p.z, lm: true });
    return (C[level] = out);
  }
  // the route's points on `level` as polylines ([[x, z], …] per run), and the floors it visits (cached per route)
  _routeOn(R, level) {
    if (!R || !R.ok || !R.pts) return { runs: [], levels: [] };
    const key = level;
    if (this._rc && this._rc.R === R && this._rc.key === key) return this._rc.out;
    const y0 = LEVELS[level].y, runs = []; let run = null;
    const lvSet = new Set();
    for (const p of R.pts) {
      lvSet.add(levelOfY(p[1]));
      const on = Math.abs(p[1] - y0) < 0.6;
      if (on) { if (!run) { run = []; runs.push(run); } run.push([p[0], p[2]]); } else run = null;
    }
    const levels = LEVEL_ORDER.filter(l => lvSet.has(l));
    const out = { runs, levels };
    this._rc = { R, key, out };
    return out;
  }

  // ---------------------------------------------------------------- view ----
  _size() {
    const c = this.c, W = c.clientWidth || 316, H = c.clientHeight || 676;
    const s = this.app.phone._scale || 1;
    const dpr = clamp((window.devicePixelRatio || 1) * Math.max(1, s), 1, 2);
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    return { W, H, dpr };
  }
  toScreen(x, z) {
    const v = this.v, dx = x - v.cx, dz = z - v.cz, cs = Math.cos(v.rot), sn = Math.sin(v.rot);
    return [v.ax + v.k * (cs * dx - sn * dz), v.ay + v.k * (sn * dx + cs * dz)];
  }
  snap() { this.v.init = false; }

  // st: { band: {top, bottom}, pos, route, dest, ms (milestone), level }
  draw(dt, st) {
    const { W, H, dpr } = this._size();
    const g = this.g, v = this.v, p = st.pos, level = st.level;
    this._t += dt;
    const top = st.band.top, bot = Math.max(top + 120, st.band.bottom);
    v.ax = W / 2; v.ay = top + (bot - top) * 0.7;
    // follow + heading-up (eased; snaps on the first frame and on a floor change)
    const snap = !v.init || v.level !== level;
    if (snap) { v.cx = p.x; v.cz = p.z; v.level = level; if (!v.init) v.rot = p.heading; v.init = true; }
    const kf = 1 - Math.exp(-dt / 0.18);
    v.cx += (p.x - v.cx) * kf; v.cz += (p.z - v.cz) * kf;
    let dr = p.heading - v.rot; dr = Math.atan2(Math.sin(dr), Math.cos(dr));
    v.rot += dr * (1 - Math.exp(-dt / 0.3));
    // zoom: keep the next milestone (this floor, < 150 m) inside the band, between 1.5 and 4.2 px/m
    let kT = 2.7;
    const ms = st.ms;
    if (ms && ms.level === level && isFinite(ms.x) && Math.hypot(ms.x - p.x, ms.z - p.z) < 150) {
      const cs = Math.cos(v.rot), sn = Math.sin(v.rot), dx = ms.x - p.x, dz = ms.z - p.z;
      const sx = cs * dx - sn * dz, sy = sn * dx + cs * dz;
      const lim = [Math.abs(sx) > 0.5 ? (W / 2 - 40) / Math.abs(sx) : 99, sy < -0.5 ? (v.ay - top - 46) / -sy : sy > 0.5 ? (bot - v.ay - 26) / sy : 99];
      kT = clamp(Math.min(lim[0], lim[1]), 1.5, 4.2);
    }
    v.k = snap ? kT : Math.exp(Math.log(v.k) + (Math.log(kT) - Math.log(v.k)) * (1 - Math.exp(-dt / 0.7)));
    // --- world layer
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = TH.bg; g.fillRect(0, 0, W * dpr, H * dpr);
    const k = v.k * dpr, cs = Math.cos(v.rot), sn = Math.sin(v.rot);
    const a = k * cs, b = k * sn, c = -k * sn, d = k * cs;
    g.setTransform(a, b, c, d, v.ax * dpr - (a * v.cx + c * v.cz), v.ay * dpr - (b * v.cx + d * v.cz));
    const base = this.baseFor(level);
    if (base) { g.imageSmoothingEnabled = true; g.drawImage(base.canvas, base.x0, base.z0, base.w, base.h); }
    const RO = this._routeOn(st.route, level);
    if (RO.runs.length) this._route(g, RO.runs, v.k * dpr);
    // --- screen layer
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const boxes = [];
    const meS = this.toScreen(p.x, p.z);
    boxes.push([meS[0] - 16, meS[1] - 16, 32, 32]);
    let pinBox = null;
    if (st.dest && st.dest.level === level) pinBox = this._destPin(g, st.dest, top, bot, W, boxes);
    if (ms && ms.level === level && ms.kind !== 'arrive') this._msPin(g, ms, top, bot, W, boxes);
    this._labels(dt, g, st, RO, top, bot, W, boxes);
    this._me(g, p, meS);
    this._north(g, W, top);
    this._ladder(g, W, top, bot, RO.levels, level, st.dest);
    return pinBox;
  }

  _route(g, runs, kpx) {
    const w = (px) => px / kpx;
    g.lineJoin = 'round'; g.lineCap = 'round';
    const path = () => { g.beginPath(); for (const r of runs) { g.moveTo(r[0][0], r[0][1]); for (let i = 1; i < r.length; i++) g.lineTo(r[i][0], r[i][1]); } };
    path();
    g.strokeStyle = 'rgba(255,150,40,0.22)'; g.lineWidth = w(16); g.stroke();
    g.strokeStyle = '#ffb02e'; g.lineWidth = w(6.5); g.stroke();
    // flowing dashes: which way to walk, without reading anything
    g.setLineDash([w(3), w(13)]); g.lineDashOffset = -this._t * w(26);
    g.strokeStyle = 'rgba(255,248,230,0.95)'; g.lineWidth = w(2.6); g.stroke();
    g.setLineDash([]); g.lineDashOffset = 0;
  }

  _inBand(x, y, top, bot, W, m = 14) { return x > m && x < W - m && y > top + m && y < bot - m; }
  // a badge on the next milestone: escalator (▲ 3F), a turn, the bridge, the canyon…
  _msPin(g, ms, top, bot, W, boxes) {
    let [x, y] = this.toScreen(ms.x, ms.z);
    const inside = this._inBand(x, y, top, bot, W, 20);
    if (!inside) { const cx = W / 2, cy = (top + bot) / 2, dx = x - cx, dy = y - cy, s = Math.min((W / 2 - 24) / Math.max(1e-3, Math.abs(dx)), ((bot - top) / 2 - 24) / Math.max(1e-3, Math.abs(dy))); x = cx + dx * s; y = cy + dy * s; }
    const ramp = ms.kind === 'escalator' || ms.kind === 'stairs' || ms.kind === 'lift';
    const ic = ramp ? (ms.dir === 'up' ? 'up' : 'down') : ms.kind === 'turn' ? (ms.turn === 'around' ? 'uleft' : ms.turn) : ms.icon || 'straight';
    const pulse = (this._t * 0.9) % 1;
    g.save();
    g.strokeStyle = `rgba(90,162,255,${0.55 * (1 - pulse)})`; g.lineWidth = 2;
    g.beginPath(); g.arc(x, y, 15 + pulse * 12, 0, TAU); g.stroke();
    g.shadowColor = 'rgba(0,0,0,0.5)'; g.shadowBlur = 8;
    g.fillStyle = '#2f6bff'; g.beginPath(); g.arc(x, y, 15, 0, TAU); g.fill();
    g.shadowBlur = 0;
    g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke();
    const P = this._path(ic);
    if (P) { g.save(); g.translate(x - 9, y - 9); g.scale(0.75, 0.75); g.strokeStyle = '#fff'; g.lineWidth = 2.6; g.lineCap = 'round'; g.lineJoin = 'round'; g.stroke(P); g.restore(); }
    boxes.push([x - 17, y - 17, 34, 34]);
    // its words (ramps: the floor it goes to; else the short name)
    const t = ramp ? `${ms.kind === 'stairs' ? 'Stairs' : ms.kind === 'lift' ? 'Lift' : 'Escalator'} ${ms.dir === 'up' ? '▲' : '▼'} ${lvl(ms.toLevel)}`
      : ms.kind === 'turn' ? '' : ms.kind === 'gate' ? 'Gates' : (ms.short || (/bridge/i.test(ms.title || '') ? 'Bridge' : ms.name) || '');
    if (t) this._pill(g, x, y + 27, t, { bg: 'rgba(16,30,62,0.94)', fg: '#dbe9ff', bd: 'rgba(110,170,255,0.6)', size: 12.5, bold: 750 }, boxes, true);
    g.restore();
  }
  _destPin(g, d, top, bot, W, boxes) {
    let [x, y] = this.toScreen(d.x, d.z);
    const inside = this._inBand(x, y, top, bot, W, 18);
    if (!inside) { const cx = W / 2, cy = (top + bot) / 2, dx = x - cx, dy = y - cy, s = Math.min((W / 2 - 22) / Math.max(1e-3, Math.abs(dx)), ((bot - top) / 2 - 30) / Math.max(1e-3, Math.abs(dy))); x = cx + dx * s; y = cy + dy * s; }
    g.save();
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.ellipse(x, y + 1, 7, 3, 0, 0, TAU); g.fill();
    g.shadowColor = 'rgba(255,150,40,0.7)'; g.shadowBlur = 14;
    g.fillStyle = '#ffb02e';
    g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x - 4, y - 9, x - 12, y - 14, x - 12, y - 23); g.arc(x, y - 23, 12, Math.PI, 0); g.bezierCurveTo(x + 12, y - 14, x + 4, y - 9, x, y); g.fill();
    g.shadowBlur = 0;
    g.fillStyle = '#1a1206'; g.beginPath(); g.arc(x, y - 23, 4.6, 0, TAU); g.fill();
    boxes.push([x - 13, y - 37, 26, 38]);
    this._pill(g, x, y - 47, d.en || d.name || 'Destination', { bg: 'rgba(40,28,8,0.95)', fg: '#ffd793', bd: 'rgba(255,176,46,0.75)', size: 12.5, bold: 750 }, boxes, true);
    g.restore();
    return [x, y];
  }
  _pill(g, x, y, t, s, boxes, force) {
    g.font = `${s.bold || 650} ${s.size || 12}px Inter, "Noto Sans JP", sans-serif`;
    if (t.length > 22) t = t.slice(0, 21) + '…';
    const w = g.measureText(t).width + 14, h = (s.size || 12) + 9;
    let bx = x - w / 2; const by = y - h / 2;
    bx = clamp(bx, 6, (this.c.clientWidth || 316) - w - 6);
    const hit = boxes.some(b => bx < b[0] + b[2] && bx + w > b[0] && by < b[1] + b[3] && by + h > b[1]);
    if (hit && !force) return false;
    boxes.push([bx, by, w, h]);
    g.fillStyle = s.bg; rr(g, bx, by, w, h, h / 2); g.fill();
    if (s.bd) { g.strokeStyle = s.bd; g.lineWidth = 1; g.stroke(); }
    g.fillStyle = s.fg; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, bx + w / 2, by + h / 2 + 0.5);
    return true;
  }
  // 2–3 shops right beside the route ahead (what you will see), steady (re-picked once a second)
  _labels(dt, g, st, RO, top, bot, W, boxes) {
    this._labT -= dt;
    const p = st.pos;
    if (this._labT <= 0 || this._labLevel !== st.level) {
      this._labT = 1; this._labLevel = st.level;
      const C = this._cands(st.level), runs = RO.runs, keep = new Set(this._lab.map(l => l.id));
      const destId = st.dest && (st.dest.slot || st.dest.id);
      const hx = -Math.sin(p.heading), hz = -Math.cos(p.heading);
      const sc = [];
      for (const c of C) {
        if (c.id === destId) continue;
        const dx = c.x - p.x, dz = c.z - p.z, dist = Math.hypot(dx, dz);
        if (dist < 7 || dist > 95) continue;
        const [sx, sy] = this.toScreen(c.x, c.z);
        if (!this._inBand(sx, sy, top, bot, W, 34)) continue;
        let dR = 99;
        for (const r of runs) for (let i = 1; i < r.length; i++) {
          const ax = r[i - 1][0], az = r[i - 1][1], ex = r[i][0] - ax, ez = r[i][1] - az, l2 = ex * ex + ez * ez;
          const t = l2 > 1e-6 ? clamp(((c.x - ax) * ex + (c.z - az) * ez) / l2, 0, 1) : 0;
          dR = Math.min(dR, Math.hypot(c.x - ax - ex * t, c.z - az - ez * t));
        }
        if (runs.length && dR > 13) continue;
        const fwd = (dx * hx + dz * hz) / dist;
        sc.push({ c, s: (runs.length ? dR * 1.5 : 0) + dist * 0.12 + (fwd < -0.2 ? 14 : 0) - (keep.has(c.id) ? 6 : 0) - (c.lm ? 8 : 0) });
      }
      sc.sort((a, b) => a.s - b.s);
      this._lab = sc.slice(0, 5).map(e => e.c);
    }
    let n = 0;
    for (const c of this._lab) {
      if (n >= 3) break;
      const [x, y] = this.toScreen(c.x, c.z);
      if (!this._inBand(x, y, top, bot, W, 20)) continue;
      g.font = '650 12px Inter, "Noto Sans JP", sans-serif';
      const ok = this._pill(g, x, y - 13, c.name, { bg: 'rgba(8,12,22,0.86)', fg: '#d9e3f5', bd: 'rgba(150,185,235,0.28)', size: 12, bold: 650 }, boxes, false);
      if (!ok) continue;
      g.fillStyle = '#9fb4d8'; g.beginPath(); g.arc(x, y, 2.6, 0, TAU); g.fill();
      n++;
    }
  }
  _me(g, p, [x, y]) {
    const v = this.v;
    g.save();
    const ang = -(p.heading - v.rot) - Math.PI / 2;
    const gr = g.createRadialGradient(x, y, 3, x, y, 52);
    gr.addColorStop(0, 'rgba(70,140,255,0.6)'); gr.addColorStop(1, 'rgba(70,140,255,0)');
    g.fillStyle = gr; g.beginPath(); g.moveTo(x, y); g.arc(x, y, 52, ang - 0.5, ang + 0.5); g.closePath(); g.fill();
    const r = Math.max(13, (p.acc || 1) * v.k);
    g.fillStyle = 'rgba(47,123,255,0.16)'; g.strokeStyle = 'rgba(120,175,255,0.45)'; g.lineWidth = 1;
    g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); g.stroke();
    g.shadowColor = 'rgba(47,123,255,0.9)'; g.shadowBlur = 12;
    g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, 9, 0, TAU); g.fill();
    g.shadowBlur = 0;
    g.fillStyle = '#2f7bff'; g.beginPath(); g.arc(x, y, 6.4 + Math.sin(this._t * 3) * 0.5, 0, TAU); g.fill();
    g.restore();
  }
  _north(g, W, top) {
    const v = this.v, x = W - 26, y = top + 26, sn = Math.sin(v.rot), cs = Math.cos(v.rot);
    const ux = sn, uy = -cs;           // screen direction of north (-Z)
    g.save();
    g.fillStyle = 'rgba(8,12,22,0.86)'; g.strokeStyle = 'rgba(150,185,235,0.28)'; g.lineWidth = 1;
    g.beginPath(); g.arc(x, y, 15, 0, TAU); g.fill(); g.stroke();
    g.translate(x, y); g.rotate(Math.atan2(uy, ux) + Math.PI / 2);
    g.fillStyle = '#ff6a4a'; g.beginPath(); g.moveTo(0, -11); g.lineTo(4, -2); g.lineTo(-4, -2); g.closePath(); g.fill();
    g.fillStyle = 'rgba(200,215,240,0.55)'; g.beginPath(); g.moveTo(0, 11); g.lineTo(4, 2); g.lineTo(-4, 2); g.closePath(); g.fill();
    g.rotate(-(Math.atan2(uy, ux) + Math.PI / 2));
    g.restore();
    g.save();
    g.font = '800 9px Inter, sans-serif'; g.fillStyle = '#ffb4a2'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('N', x + ux * 22, y + uy * 22);
    g.restore();
  }
  // where the route goes, floor-wise: a slim ladder (you = blue, destination = amber, floors on the way = dots)
  _ladder(g, W, top, bot, levels, me, dest) {
    const set = new Set(levels); set.add(me); if (dest) set.add(dest.level);
    if (set.size < 2) return;
    const L = LEVEL_ORDER.filter(l => set.has(l)), lo = LEVEL_ORDER.indexOf(L[0]), hi = LEVEL_ORDER.indexOf(L[L.length - 1]);
    const rows = LEVEL_ORDER.slice(lo, hi + 1).reverse();
    const rh = 21, x = W - 26, y0 = top + 64;
    if (y0 + rows.length * rh > bot - 70) return;
    g.save();
    g.fillStyle = 'rgba(8,12,22,0.8)'; g.strokeStyle = 'rgba(150,185,235,0.22)'; g.lineWidth = 1;
    rr(g, x - 17, y0 - 5, 34, rows.length * rh + 10, 12); g.fill(); g.stroke();
    // the climb
    const iy = (l) => y0 + rows.indexOf(l) * rh + rh / 2;
    if (dest && rows.includes(dest.level)) { g.strokeStyle = 'rgba(255,176,46,0.55)'; g.lineWidth = 2; g.setLineDash([2, 3]); g.beginPath(); g.moveTo(x - 11, iy(me)); g.lineTo(x - 11, iy(dest.level)); g.stroke(); g.setLineDash([]); }
    g.font = '800 10.5px Inter, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const l of rows) {
      const y = iy(l), isMe = l === me, isDest = dest && l === dest.level;
      if (isMe) { g.fillStyle = '#2f7bff'; rr(g, x - 13, y - 8.5, 26, 17, 6); g.fill(); }
      else if (isDest) { g.fillStyle = 'rgba(255,176,46,0.2)'; g.strokeStyle = '#ffb02e'; rr(g, x - 13, y - 8.5, 26, 17, 6); g.fill(); g.stroke(); }
      g.fillStyle = isMe ? '#fff' : isDest ? '#ffd793' : set.has(l) ? '#c9d6ee' : '#5f6d88';
      g.fillText(lvl(l), x + 1, y + 0.5);
    }
    g.restore();
  }

  // ----------------------------------------------------------- calibration ---
  // The one picture of the calibration: the compass reads the field (stage 1), the floor plan around you appears and
  // the guesses converge (2), the floor is found (3), and the blue dot lands with its ±1 m halo (4).
  // q: 0..1 of T_CALIB; body: the TRUE position (what Lodestone is about to find).
  calib(cv, q, t, body) {
    const g = cv.getContext('2d'), W = cv.clientWidth || 316, H = cv.clientHeight || 676;
    const s = this.app.phone._scale || 1, dpr = clamp((window.devicePixelRatio || 1) * Math.max(1, s), 1, 2);
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const cx = W / 2, cy = 240, R = 104;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const [d1, d2, d3, d4] = CAL_DONE;
    const s1 = ease(q / d1), s2 = ease((q - d1) / (d2 - d1)), s3 = ease((q - d2) / (d3 - d2)), s4 = ease((q - d3) / (d4 - d3));
    // the window
    g.save();
    g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.clip();
    const bgg = g.createRadialGradient(cx, cy, 10, cx, cy, R); bgg.addColorStop(0, '#0d1526'); bgg.addColorStop(1, '#060a12');
    g.fillStyle = bgg; g.fillRect(cx - R, cy - R, 2 * R, 2 * R);
    // the floor plan fades in (stage 2), centred on you, north up
    const kp = 2.3, base = this.baseFor(body.level);
    if (base && s2 > 0) {
      g.save(); g.globalAlpha = 0.25 + 0.75 * s2;
      g.translate(cx - body.x * kp, cy - body.z * kp); g.scale(kp, kp);
      g.drawImage(base.canvas, base.x0, base.z0, base.w, base.h);
      g.restore();
    }
    // stage 1: compass rings + a needle that hunts, then settles
    if (s2 < 1) {
      const a1 = 1 - s2;
      g.save(); g.globalAlpha = a1;
      for (let i = 0; i < 3; i++) { const ph = ((t * 0.9 + i / 3) % 1); g.strokeStyle = `rgba(79,216,255,${0.35 * (1 - ph)})`; g.lineWidth = 1.5; g.beginPath(); g.arc(cx, cy, 16 + ph * (R - 16), 0, TAU); g.stroke(); }
      g.strokeStyle = 'rgba(160,190,235,0.35)'; g.lineWidth = 1.2;
      for (let i = 0; i < 24; i++) { const a = i / 24 * TAU, r0 = i % 6 ? 48 : 42; g.beginPath(); g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); g.lineTo(cx + Math.cos(a) * 54, cy + Math.sin(a) * 54); g.stroke(); }
      const hunt = (1 - s1) * (Math.sin(t * 9.3) * 0.9 + Math.sin(t * 23.1) * 0.35) + s1 * Math.sin(t * 3) * 0.06;
      g.translate(cx, cy); g.rotate(hunt);
      g.fillStyle = '#ff6a4a'; g.beginPath(); g.moveTo(0, -38); g.lineTo(6, 0); g.lineTo(-6, 0); g.closePath(); g.fill();
      g.fillStyle = '#c9d6ee'; g.beginPath(); g.moveTo(0, 38); g.lineTo(6, 0); g.lineTo(-6, 0); g.closePath(); g.fill();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(0, 0, 3.5, 0, TAU); g.fill();
      g.restore();
    }
    // stage 2–3: guesses scattered over the walkable plan converge onto you; the uncertainty circle shrinks
    if (q > d1 * 0.85 && s4 < 1) {
      const G = this._guesses(body);
      const conv = ease((q - d1) / (d3 - d1));
      g.save(); g.globalAlpha = Math.min(1, s2 * 2) * (1 - s4);
      const ur = (1 - conv) * 46 + 3;
      g.strokeStyle = 'rgba(255,176,46,0.65)'; g.fillStyle = 'rgba(255,176,46,0.08)'; g.lineWidth = 1.5; g.setLineDash([4, 4]);
      g.beginPath(); g.arc(cx, cy, ur * kp * 0.9, 0, TAU); g.fill(); g.stroke(); g.setLineDash([]);
      for (const p of G) {
        const k = Math.min(1, conv * (0.8 + p.sp));
        const x = cx + p.dx * kp * (1 - k), y = cy + p.dz * kp * (1 - k);
        g.fillStyle = 'rgba(255,190,80,0.9)'; g.beginPath(); g.arc(x, y, 3.2, 0, TAU); g.fill();
        g.fillStyle = 'rgba(255,190,80,0.25)'; g.beginPath(); g.arc(x, y, 7, 0, TAU); g.fill();
      }
      g.restore();
    }
    // stage 4: the blue dot lands, ±1 m
    if (s4 > 0) {
      const r = 6.5 * (0.6 + 0.4 * s4);
      g.save();
      g.strokeStyle = `rgba(120,175,255,${0.7 * s4})`; g.lineWidth = 1.5;
      g.beginPath(); g.arc(cx, cy, 10 + (1 - s4) * 40, 0, TAU); g.stroke();
      g.shadowColor = 'rgba(47,123,255,0.9)'; g.shadowBlur = 14;
      g.fillStyle = '#fff'; g.beginPath(); g.arc(cx, cy, r + 2.6, 0, TAU); g.fill();
      g.shadowBlur = 0; g.fillStyle = '#2f7bff'; g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
      g.restore();
    }
    g.restore();
    // the ring: overall progress (amber), and the floor chip once found
    g.strokeStyle = 'rgba(150,185,235,0.22)'; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, R + 5, 0, TAU); g.stroke();
    g.strokeStyle = q >= d4 ? '#4f95ff' : '#ffb02e'; g.lineWidth = 3; g.lineCap = 'round';
    g.beginPath(); g.arc(cx, cy, R + 5, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, q / d4)); g.stroke();
    if (s3 >= 1) {
      const pop = ease((q - d3) / 0.06);
      g.save(); g.translate(cx + R * 0.68, cy - R * 0.74); g.scale(0.6 + 0.4 * pop, 0.6 + 0.4 * pop);
      g.fillStyle = '#2f7bff'; rr(g, -19, -13, 38, 26, 9); g.fill();
      g.fillStyle = '#fff'; g.font = '800 15px Inter, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(lvl(body.level), 0, 1);
      g.restore();
    }
    if (s4 > 0) this._pill(g, cx, cy - 30, 'You’re here', { bg: `rgba(16,30,62,${0.94 * s4})`, fg: `rgba(219,233,255,${s4})`, bd: `rgba(110,170,255,${0.6 * s4})`, size: 12.5, bold: 750 }, [], true);
  }
  _guesses(body) {
    if (this._gs && this._gs.lv === body.level && Math.hypot(this._gs.x - body.x, this._gs.z - body.z) < 3) return this._gs.list;
    const grid = this.ctx.world.grids[body.level], list = [];
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 80 && list.length < 10; i++) {
      const a = rnd() * TAU, r = 12 + rnd() * 34, x = body.x + Math.cos(a) * r, z = body.z + Math.sin(a) * r;
      const c = grid ? grid.cellOf(x, z) : -1;
      if (grid && (c < 0 || grid.type[c] !== CELL.WALK)) continue;
      list.push({ dx: x - body.x, dz: z - body.z, sp: rnd() * 0.4 });
    }
    this._gs = { lv: body.level, x: body.x, z: body.z, list };
    return list;
  }
}
