// =============================================================================
// Operational departure boards (発車案内), driven by the timetable.
//   - Nankai concourse boards (2F / 3F): LED, black, coloured train types,
//     one row per track (3F) or next departures (2F); JA / EN pages alternate.
//   - Midosuji gate board: Osaka Metro LCD, track 1 | track 2, 先発/次発.
//   - Hanging platform boards (double-sided) on every platform.
// Canvases redraw only when their content key changes, at most one board per
// frame, and only for boards near the player (others keep their last frame).
// =============================================================================
import * as THREE from 'three';
import { canvas, canvasTex, JP, EN, fitText } from './textures.js';
import { LINES, TYPES, DESTS, hhmm } from './timetable.js';
import { LEVELS } from '../layout.js';

const LCD_NAVY = '#0b1830';

export class Boards {
  constructor(ctx, transit) {
    this.ctx = ctx; this.transit = transit;
    this.boards = [];
    this._rr = 0;
  }

  add(o) {
    // o: { id, kind, level, x, y, z, facing, w, h, cw, ch, tracks, doubleSided, hang, ceilY }
    const c = canvas(o.cw, o.ch);
    const tex = canvasTex(c, { aniso: 8 });
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.5, 1.5, 1.5) });
    mat.name = 'transit_board:' + o.id;
    const grp = new THREE.Group(); grp.name = 'transit_board:' + o.id;
    grp.position.set(o.x, o.y, o.z);
    grp.rotation.y = o.facing; // local +z faces "facing"
    const housingMat = this.ctx.materials.get('steel_dark');
    const dep = 0.16;
    const hous = new THREE.Mesh(new THREE.BoxGeometry(o.w + 0.16, o.h + 0.16, dep), housingMat);
    grp.add(hous);
    const faces = o.doubleSided ? [1, -1] : [1];
    for (const f of faces) {
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(o.w, o.h), mat);
      scr.position.z = f * (dep / 2 + 0.004);
      if (f < 0) scr.rotation.y = Math.PI;
      grp.add(scr);
    }
    if (o.hang) {
      for (const sx of [-o.w * 0.35, o.w * 0.35]) {
        const len = Math.max(0.05, o.ceilY - (o.y + o.h / 2 + 0.08));
        const rod = new THREE.Mesh(new THREE.BoxGeometry(0.04, len, 0.04), this.ctx.materials.get('steel'));
        rod.position.set(sx, o.h / 2 + 0.08 + len / 2, 0);
        grp.add(rod);
      }
    } else if (o.pole) {
      const len = o.y - o.h / 2 - LEVELS[o.level].y;
      for (const sx of [-o.w * 0.4, o.w * 0.4]) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.12, len, 0.12), housingMat);
        p.position.set(sx, -o.h / 2 - len / 2, 0);
        grp.add(p);
      }
    }
    grp.traverse(m => { m.matrixAutoUpdate = true; });
    const holder = new THREE.Group();
    holder.userData.chunk = { level: o.level, x: o.x, z: o.z, r: 12 };
    holder.add(grp);
    this.ctx.engine.levelRoot(o.level).add(holder);
    // light from the screen
    const fx = Math.sin(o.facing), fz = Math.cos(o.facing);
    this.ctx.lighting.addLight({ level: o.level, x: o.x + fx * 0.3, y: o.y, z: o.z + fz * 0.3, color: 0xffd9a0, intensity: 0.35 * o.w * o.h, range: 5, kind: 'sign', dir: [fx, 0, fz] });
    const b = Object.assign({ canvas: c, g: c.getContext('2d'), tex, key: null }, o);
    this.boards.push(b);
    return b;
  }

  // ---------------------------------------------------------------------------------
  update(force = false) {
    const ctx = this.ctx;
    const p = ctx.player && ctx.player.body;
    const now = performance.now() / 1000;
    const page = Math.floor(now / 5) % 2; // 0 JA, 1 EN
    const blink = Math.floor(now * 1.5) % 2;
    const t = this.transit.now();
    // round robin: redraw at most one board per call
    const n = this.boards.length;
    for (let k = 0; k < n; k++) {
      const b = this.boards[(this._rr + k) % n];
      const near = !p || (p.level === b.level && Math.hypot(p.x - b.x, p.z - b.z) < 70) || Math.abs(LEVELS[p.level].y - LEVELS[b.level].y) <= 6 && Math.hypot(p.x - b.x, p.z - b.z) < 40;
      if (!near && b.key !== null && !force) continue;
      const data = this._data(b, t);
      const key = `${page}|${blink * (data.blinky ? 1 : 0)}|${data.key}`;
      if (key === b.key) continue;
      b.key = key;
      this._draw(b, data, page, blink, t);
      b.tex.needsUpdate = true;
      this._rr = (this._rr + k + 1) % n;
      if (!force) return;
    }
  }

  _data(b, t) {
    const tr = this.transit;
    const rows = [];
    let blinky = false;
    for (const id of b.tracks) {
      const list = tr.tt.upcoming(id, t, b.perTrack || 2);
      const st = tr.trackState(id);
      if (st && (st.state === 'approach' || st.state === 'arriving')) blinky = true;
      rows.push({ id, list, st, info: tr.trackInfo(id) });
    }
    const key = rows.map(r => `${r.id}:${r.st ? r.st.state : '-'}:${r.list.map(s => s.id).join(',')}`).join('|') + `|${Math.floor(t)}`;
    return { rows, key, blinky };
  }

  _draw(b, data, page, blink, t) {
    if (b.kind === 'nankai_big') drawNankaiBig(b, data, page, t);
    else if (b.kind === 'nankai_list') drawNankaiList(b, data, page, t, this.transit);
    else if (b.kind === 'metro_gate') drawMetroGate(b, data, page, blink, t);
    else if (b.kind === 'metro_platform') drawMetroPlatform(b, data, page, blink, t);
    else if (b.kind === 'nankai_platform') drawNankaiPlatform(b, data, page, blink, t);
  }
}

// ---- drawing helpers ------------------------------------------------------------------------
function typeLabel(s, lang) {
  const ty = TYPES[s.type];
  if (lang === 0) return ty.short ? ty.short : ty.ja;
  return ty.short ? 'Ltd.Exp.' : ty.en;
}
function typeName(s, lang) { const ty = TYPES[s.type]; return ty.name ? (lang === 0 ? ty.name : ty.nameEn) : ''; }
function destLabel(s, lang) { const d = DESTS[s.dest]; return lang === 0 ? d.ja : d.en; }
function clockTxt(t) { return hhmm(t); }

function ledGrid(g, W, H, pitch = 4) {
  g.save(); g.globalCompositeOperation = 'multiply'; g.fillStyle = 'rgba(40,40,40,1)';
  for (let y = 0; y < H; y += pitch) g.fillRect(0, y + pitch - 1, W, 1);
  for (let x = 0; x < W; x += pitch) g.fillRect(x + pitch - 1, 0, 1, H);
  g.restore();
}

function drawNankaiBig(b, data, page, t) {
  const g = b.g, W = b.cw, H = b.ch;
  g.fillStyle = '#050505'; g.fillRect(0, 0, W, H);
  const hh = H * 0.13;
  g.fillStyle = '#F08300'; g.fillRect(0, 0, W, hh);
  g.fillStyle = '#fff'; g.font = `900 ${hh * 0.6}px ${JP}`;
  g.fillText(page === 0 ? '南海線  発車案内' : 'Nankai Line  Departures', W * 0.02, hh * 0.72);
  g.font = `700 ${hh * 0.6}px ${EN}`; g.textAlign = 'right'; g.fillText(clockTxt(t), W * 0.98, hh * 0.72); g.textAlign = 'left';
  // column titles
  const cols = page === 0 ? ['のりば', '種別', '発車', '行先', '両数', ''] : ['Track', 'Type', 'Dep.', 'Destination', 'Cars', ''];
  const cx = [0.02, 0.1, 0.33, 0.45, 0.72, 0.8].map(f => f * W);
  const th = H * 0.07;
  g.fillStyle = '#9a9a9a'; g.font = `600 ${th * 0.7}px ${page === 0 ? JP : EN}`;
  cols.forEach((c, i) => g.fillText(c, cx[i], hh + th * 0.85));
  const rows = data.rows;
  const rh = (H - hh - th * 1.2) / rows.length;
  rows.forEach((r, k) => {
    const y = hh + th * 1.2 + k * rh;
    const s = r.list[0];
    // track number box
    g.fillStyle = '#F08300'; g.fillRect(cx[0], y + rh * 0.12, rh * 0.76, rh * 0.76);
    g.fillStyle = '#000'; g.font = `900 ${rh * 0.62}px ${EN}`; g.textAlign = 'center'; g.fillText(String(r.info.no), cx[0] + rh * 0.38, y + rh * 0.74); g.textAlign = 'left';
    if (!s) return;
    const ty = TYPES[s.type];
    g.fillStyle = ty.color; g.font = `900 ${rh * 0.56}px ${page === 0 ? JP : EN}`;
    const tl = typeLabel(s, page) + (typeName(s, page) ? (page === 0 ? '' : ' ') + typeName(s, page) : '');
    fitText(g, tl, cx[1], y + rh * 0.72, cx[2] - cx[1] - 10);
    g.fillStyle = '#ffffff'; g.font = `700 ${rh * 0.6}px ${EN}`; fitText(g, clockTxt(s.dep), cx[2], y + rh * 0.74, cx[3] - cx[2] - 8);
    g.fillStyle = '#ff9a2a'; g.font = `800 ${rh * 0.6}px ${page === 0 ? JP : EN}`; fitText(g, destLabel(s, page), cx[3], y + rh * 0.74, cx[4] - cx[3] - 10);
    g.fillStyle = '#ffffff'; g.font = `700 ${rh * 0.52}px ${page === 0 ? JP : EN}`; fitText(g, page === 0 ? `${s.cars}両` : `${s.cars}`, cx[4], y + rh * 0.72, cx[5] - cx[4] - 8);
    // remark
    const st = r.st;
    let rem = '';
    if (st && st.svc === s && st.state === 'doors') rem = page === 0 ? 'ご乗車できます' : 'Now boarding';
    else if (ty.short) rem = page === 0 ? '特急券が必要です' : 'Ltd.Exp. ticket required';
    else if (s.dest === 'kix') rem = page === 0 ? '関西空港へ' : 'To the airport';
    g.fillStyle = rem === 'ご乗車できます' || rem === 'Now boarding' ? '#4cff8a' : '#bdbdbd';
    g.font = `600 ${rh * 0.42}px ${page === 0 ? JP : EN}`; fitText(g, rem, cx[5], y + rh * 0.7, W - cx[5] - 10);
    g.fillStyle = '#1a1a1a'; g.fillRect(0, y + rh - 2, W, 2);
  });
  ledGrid(g, W, H, 4);
}

function drawNankaiList(b, data, page, t, transit) {
  const g = b.g, W = b.cw, H = b.ch;
  // merge all tracks' departures, sort, take N
  const all = [];
  for (const r of data.rows) for (const s of r.list) all.push({ s, no: r.info.no });
  all.sort((a, c) => a.s.dep - c.s.dep);
  const list = all.slice(0, 8);
  g.fillStyle = '#050505'; g.fillRect(0, 0, W, H);
  const hh = H * 0.15;
  g.fillStyle = '#F08300'; g.fillRect(0, 0, W, hh);
  g.fillStyle = '#fff'; g.font = `900 ${hh * 0.58}px ${JP}`; g.fillText(page === 0 ? '南海電車  のりば案内' : 'Nankai Trains  Departures', W * 0.02, hh * 0.7);
  g.font = `700 ${hh * 0.58}px ${EN}`; g.textAlign = 'right'; g.fillText(clockTxt(t), W * 0.98, hh * 0.7); g.textAlign = 'left';
  const rh = (H - hh) / list.length;
  const cx = [0.02, 0.24, 0.38, 0.72, 0.84].map(f => f * W);
  list.forEach(({ s, no }, k) => {
    const y = hh + k * rh;
    const ty = TYPES[s.type];
    g.fillStyle = ty.color; g.font = `900 ${rh * 0.55}px ${page === 0 ? JP : EN}`;
    fitText(g, typeLabel(s, page) + (typeName(s, page) ? (page ? ' ' : '') + typeName(s, page) : ''), cx[0], y + rh * 0.7, cx[1] - cx[0] - 10);
    g.fillStyle = '#fff'; g.font = `700 ${rh * 0.58}px ${EN}`; g.fillText(clockTxt(s.dep), cx[1], y + rh * 0.72);
    g.fillStyle = '#ff9a2a'; g.font = `800 ${rh * 0.58}px ${page === 0 ? JP : EN}`; fitText(g, destLabel(s, page), cx[2], y + rh * 0.72, cx[3] - cx[2] - 10);
    g.fillStyle = '#fff'; g.font = `700 ${rh * 0.5}px ${page === 0 ? JP : EN}`; fitText(g, page === 0 ? `${s.cars}両` : `${s.cars} cars`, cx[3], y + rh * 0.7, cx[4] - cx[3] - 10);
    g.fillStyle = '#F08300'; g.fillRect(cx[4], y + rh * 0.14, rh * 0.72, rh * 0.72);
    g.fillStyle = '#000'; g.font = `900 ${rh * 0.56}px ${EN}`; g.textAlign = 'center'; g.fillText(String(no), cx[4] + rh * 0.36, y + rh * 0.7); g.textAlign = 'left';
    g.fillStyle = '#888'; g.font = `600 ${rh * 0.36}px ${page === 0 ? JP : EN}`; g.fillText(page === 0 ? '番のりば' : 'Track', cx[4] + rh * 0.85, y + rh * 0.66);
  });
  ledGrid(g, W, H, 4);
  void transit;
}

function minsUntil(s, t) { return Math.max(0, Math.ceil(s.dep - t)); }

function drawMetroSection(g, x, y, w, h, r, page, blink, t, compact) {
  const line = LINES.midosuji.id === r.info.line ? LINES.midosuji : LINES[r.info.line];
  // header: track number + direction
  const hh = h * (compact ? 0.3 : 0.26);
  g.fillStyle = line.color; g.fillRect(x, y, w, hh);
  g.fillStyle = '#fff'; g.beginPath(); g.arc(x + hh * 0.55, y + hh * 0.5, hh * 0.38, 0, Math.PI * 2); g.fill();
  g.fillStyle = line.color; g.font = `900 ${hh * 0.55}px ${EN}`; g.textAlign = 'center'; g.fillText(String(r.info.no), x + hh * 0.55, y + hh * 0.7); g.textAlign = 'left';
  g.fillStyle = '#fff'; g.font = `800 ${hh * 0.5}px ${page === 0 ? JP : EN}`;
  fitText(g, page === 0 ? r.info.dirJa : r.info.dirEn, x + hh * 1.1, y + hh * 0.68, w - hh * 1.3);
  const st = r.st;
  const approaching = st && (st.state === 'approach' || st.state === 'arriving');
  const rows = r.list.slice(0, 2);
  const rh = (h - hh) / 2;
  rows.forEach((s, k) => {
    const yy = y + hh + k * rh;
    g.fillStyle = k === 0 ? '#14284a' : '#0f1f3a'; g.fillRect(x, yy, w, rh - 2);
    g.fillStyle = '#9fb3d1'; g.font = `700 ${rh * 0.3}px ${page === 0 ? JP : EN}`;
    fitText(g, page === 0 ? (k === 0 ? '先発' : '次発') : (k === 0 ? 'Next' : 'Later'), x + w * 0.02, yy + rh * 0.62, w * 0.1);
    g.fillStyle = '#fff'; g.font = `700 ${rh * 0.42}px ${EN}`; fitText(g, clockTxt(s.dep), x + w * 0.14, yy + rh * 0.66, w * 0.2);
    g.fillStyle = '#ffd34d'; g.font = `800 ${rh * 0.44}px ${page === 0 ? JP : EN}`;
    fitText(g, destLabel(s, page) + (page === 0 ? ' 行' : ''), x + w * 0.37, yy + rh * 0.68, w * 0.36);
    let rem;
    if (k === 0 && approaching && st.svc === s) rem = page === 0 ? '電車がきます' : 'Arriving';
    else if (k === 0 && st && st.svc === s && st.state === 'doors') rem = page === 0 ? '発車します' : 'Boarding';
    else { const m = minsUntil(s, t); rem = page === 0 ? `あと${m}分` : `${m} min`; }
    const hot = k === 0 && st && st.svc === s && (approaching || st.state === 'doors');
    if (!hot || blink) {
      g.fillStyle = hot ? '#ff5252' : '#cfd8e3'; g.font = `800 ${rh * 0.32}px ${page === 0 ? JP : EN}`;
      const tw = Math.min(g.measureText(rem).width, w * 0.22);
      fitText(g, rem, x + w * 0.98 - tw, yy + rh * 0.64, w * 0.22);
    }
  });
}

function drawMetroGate(b, data, page, blink, t) {
  const g = b.g, W = b.cw, H = b.ch;
  g.fillStyle = LCD_NAVY; g.fillRect(0, 0, W, H);
  const hh = H * 0.14;
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, hh);
  const line = LINES[data.rows[0].info.line];
  g.fillStyle = line.color; g.beginPath(); g.arc(hh * 0.6, hh * 0.5, hh * 0.4, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#fff'; g.font = `900 ${hh * 0.55}px ${EN}`; g.textAlign = 'center'; g.fillText(line.code, hh * 0.6, hh * 0.7); g.textAlign = 'left';
  g.fillStyle = '#111'; g.font = `800 ${hh * 0.55}px ${page === 0 ? JP : EN}`;
  g.fillText(page === 0 ? `${line.ja}  のりば案内` : `${line.en}  Departures`, hh * 1.2, hh * 0.72);
  g.font = `700 ${hh * 0.55}px ${EN}`; g.textAlign = 'right'; g.fillText(clockTxt(t), W * 0.98, hh * 0.72); g.textAlign = 'left';
  const n = data.rows.length, gap = W * 0.015;
  const w = (W - gap * (n + 1)) / n;
  data.rows.forEach((r, k) => drawMetroSection(g, gap + k * (w + gap), hh + gap, w, H - hh - gap * 2, r, page, blink, t, false));
}

function drawMetroPlatform(b, data, page, blink, t) {
  const g = b.g, W = b.cw, H = b.ch;
  g.fillStyle = LCD_NAVY; g.fillRect(0, 0, W, H);
  const n = data.rows.length, gap = W * 0.012;
  const w = (W - gap * (n + 1)) / n;
  data.rows.forEach((r, k) => drawMetroSection(g, gap + k * (w + gap), gap, w, H - gap * 2, r, page, blink, t, true));
}

function drawNankaiPlatform(b, data, page, blink, t) {
  const g = b.g, W = b.cw, H = b.ch;
  g.fillStyle = '#050505'; g.fillRect(0, 0, W, H);
  const n = data.rows.length;
  const w = W / n;
  data.rows.forEach((r, k) => {
    const x = k * w;
    const s = r.list[0], s2 = r.list[1];
    g.fillStyle = '#F08300'; g.fillRect(x + 6, 6, H * 0.42, H * 0.42);
    g.fillStyle = '#000'; g.font = `900 ${H * 0.34}px ${EN}`; g.textAlign = 'center'; g.fillText(String(r.info.no), x + 6 + H * 0.21, 6 + H * 0.35); g.textAlign = 'left';
    if (s) {
      const ty = TYPES[s.type];
      g.fillStyle = ty.color; g.font = `900 ${H * 0.26}px ${page === 0 ? JP : EN}`;
      fitText(g, typeLabel(s, page) + (typeName(s, page) ? (page ? ' ' : '') + typeName(s, page) : ''), x + w * 0.235, H * 0.33, w * 0.27);
      g.fillStyle = '#fff'; g.font = `700 ${H * 0.26}px ${EN}`; fitText(g, clockTxt(s.dep), x + w * 0.52, H * 0.34, w * 0.19);
      g.fillStyle = '#ff9a2a'; g.font = `800 ${H * 0.27}px ${page === 0 ? JP : EN}`; fitText(g, destLabel(s, page), x + w * 0.73, H * 0.34, w * 0.26);
      const st = r.st;
      let line2 = '';
      if (st && st.svc === s && st.state === 'doors') line2 = page === 0 ? `ご乗車できます  ${s.cars}両` : `Now boarding  ${s.cars} cars`;
      else if (s2) line2 = (page === 0 ? '次発 ' : 'Next ') + clockTxt(s2.dep) + '  ' + typeLabel(s2, page) + ' ' + destLabel(s2, page);
      g.fillStyle = line2.startsWith('ご乗車') || line2.startsWith('Now') ? '#4cff8a' : '#bbbbbb';
      g.font = `600 ${H * 0.22}px ${page === 0 ? JP : EN}`; fitText(g, line2, x + 10, H * 0.82, w - 20);
    }
    if (k > 0) { g.fillStyle = '#222'; g.fillRect(x, 0, 3, H); }
  });
  ledGrid(g, W, H, 4);
  void blink;
}
