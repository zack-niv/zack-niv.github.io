// =============================================================================
// Car models. Each model is ONE BufferGeometry (groups: body, glass, interior,
// emissive) instanced for every car of that model in the world.
//
// Local frame: x along the car (cab, if any, at +x), y up from the floor
// (= platform level), z across. Rail top is at y = -0.925.
// Door leaves are part of the geometry; the patched materials slide them by a
// per-instance amount (see trains.js). LED destination panels pick their atlas
// row per instance. Head/tail lamps switch per instance.
// =============================================================================
import * as THREE from 'three';
import { MB, roundRectPath, ellipsePath } from './mesh.js?v=f150c03';
import { LIV, liv, swUV, iswUV, adRect, stripRect, eswUV, LED_BASE, ICON } from './textures.js?v=f150c03';

export const M = { BODY: 0, GLASS: 1, INT: 2, EMIT: 3 };
const RAIL_TOP = -0.925;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ---- model specifications -------------------------------------------------------------
const BASE = {
  W: 2.86, H: 2.82, cant: 2.36, bottom: -0.58, gap: 0.5, dw: 1.3, dh: 1.86, leaves: 2, inner: 0.07,
  winY0: 0.9, winY1: 1.84, winR: 0.07, winStyle: 'metro', seats: 'long', bogieInset: 2.0, wheelR: 0.42,
  gauge: 1.435, roofP: 2.6, ac: 2, panto: 0, ceil: 2.2, lcd: 'metro', strap: 'tri',
};
export const SPECS = {};
const def = (key, o) => { SPECS[key] = Object.assign({ key }, BASE, o); };
def('m_mid', { L: 13.5, liv: 'm30k', doorLiv: 'door_steel', nDoors: 4, pitch: 3.5, dw: 1.25, seatSw: 'seat_m', floorSw: 'floor_m', wallSw: 'wall_grey', bogieInset: 1.8 });
def('m_cab', Object.assign({}, SPECS.m_mid, { key: 'm_cab', L: 14.5, face: 'm30k' }));
def('s_mid', { L: 15.6, liv: 's25', doorLiv: 'door_steel', nDoors: 3, pitch: 16.1 / 3, seatSw: 'seat_s', floorSw: 'floor_m', wallSw: 'wall' });
def('s_cab', Object.assign({}, SPECS.s_mid, { key: 's_cab', L: 16.1, face: 's25' }));
def('comm_mid', { L: 20, W: 2.74, H: 2.86, liv: 'comm', doorLiv: 'door_steel', nDoors: 4, pitch: 20.5 / 4, gauge: 1.067, seatSw: 'seat_nk', floorSw: 'floor_nk', wallSw: 'wall', panto: 1, lcd: 'nankai', bogieInset: 2.4 });
def('comm_cab', Object.assign({}, SPECS.comm_mid, { key: 'comm_cab', L: 21, face: 'comm', panto: 0 }));
def('south_mid', { L: 20, W: 2.74, H: 2.88, liv: 'south', doorLiv: 'south_door', doorsAt: 'ends', dw: 1.0, leaves: 1, seats: 'trans', seatPitch: 1.0, seatSw: 'seat_south', floorSw: 'floor_nk', wallSw: 'wall', winStyle: 'band', winY0: 0.95, winY1: 1.86, gauge: 1.067, panto: 1, lcd: 'nankai', bogieInset: 2.4, strap: null });
def('south_cab', Object.assign({}, SPECS.south_mid, { key: 'south_cab', L: 21, face: 'south', panto: 0 }));
def('rapit_mid', { L: 20.5, W: 2.8, H: 2.95, cant: 2.2, liv: 'rapit', doorLiv: 'rapit_door', doorsAt: 'rear', dw: 0.95, leaves: 1, seats: 'trans', seatPitch: 1.05, seatSw: 'seat_rapit', floorSw: 'floor_rapit', wallSw: 'wall_rapit', winStyle: 'oval', gauge: 1.067, roofP: 2.0, ac: 0, panto: 1, lcd: 'nankai', bogieInset: 2.4, strap: null });
def('rapit_cab', Object.assign({}, SPECS.rapit_mid, { key: 'rapit_cab', L: 23, face: 'rapit', panto: 0 }));

// door centres (local x) for a spec; uniform pitch from the coupled (rear, -x) end
export function doorXs(s) {
  if (s.doorsAt === 'ends') {
    const front = s.face ? s.L / 2 - FACES[s.face].len(s) - 1.25 : s.L / 2 - 1.75;
    return [-s.L / 2 + 1.75, front];
  }
  if (s.doorsAt === 'rear') {
    const xs = [-s.L / 2 + 1.75];
    if (s.face) xs.push(s.L / 2 - FACES[s.face].len(s) - 1.4);
    return xs;
  }
  const xs = [];
  for (let k = 0; k < s.nDoors; k++) xs.push(-s.L / 2 + (s.pitch / 2 - s.gap / 2) + k * s.pitch);
  return xs;
}
// leaf slide direction(s) for a door at x: 2 leaves part; 1 leaf slides toward the nearer car end
function leafDefs(s, xd) {
  const hw = s.dw / 2;
  if (s.leaves === 2) return [{ x0: xd - hw, x1: xd, slide: -hw * 0.98 }, { x0: xd, x1: xd + hw, slide: hw * 0.98 }];
  const dir = xd < 0 ? -1 : 1;
  return [{ x0: xd - hw, x1: xd + hw, slide: dir * s.dw * 0.98 }];
}

// ---- cab faces ---------------------------------------------------------------------------------
// depth(z,y,s): how far the face surface sits behind x = L/2.
// region(z,y,s): {sw} solid swatch | {liv} livery column | {glass}
const FACES = {
  m30k: {
    len: () => 0.6,
    depth(z, y, s) { const nz = Math.abs(z) / (s.W / 2); let d = 0.36 * Math.pow(sstep(0.9, s.H, y), 1.3) + 0.22 * Math.pow(nz, 5); if (y < -0.2) d += 0.05 * sstep(-0.2, -0.5, y); return d; },
    ys: [-0.58, -0.4, -0.2, 0.1, 0.38, 0.42, 0.6, 0.66, 0.78, 0.93, 1.0, 1.3, 1.6, 1.9, 2.06, 2.26, 2.32, 2.4, 2.55, 2.7, 2.82],
    zs: [0, 0.18, 0.4, 0.55, 0.62, 0.78, 0.82, 0.93, 0.97, 1.0],
    region(z, y, s) { const nz = Math.abs(z) / (s.W / 2); if (y > 0.99 && y < 2.32 && nz < 0.93) return { sw: 'glossblack' }; if (y >= 0.78 && y <= 0.99) return { sw: 'mred' }; if (y > 0.3 && y < 0.7 && nz > 0.16 && nz < 0.9) return { sw: 'black' }; return { liv: s.liv }; },
    lamps: [{ kind: 2, y0: 0.42, y1: 0.6, z0: 0.62, z1: 0.82 }, { kind: 3, y0: 0.42, y1: 0.6, z0: 0.40, z1: 0.55 }],
    led: { y0: 2.07, y1: 2.27, z0: -0.62, z1: 0.62 },
  },
  s25: {
    len: () => 0.3,
    depth(z, y, s) { const nz = Math.abs(z) / (s.W / 2); return 0.12 * sstep(1.0, s.H, y) + 0.12 * Math.pow(nz, 6); },
    ys: [-0.58, -0.3, 0.4, 0.42, 0.58, 0.8, 0.94, 1.0, 1.4, 1.9, 2.05, 2.12, 2.2, 2.35, 2.5, 2.7, 2.82],
    zs: [0, 0.14, 0.18, 0.32, 0.36, 0.55, 0.6, 0.85, 0.9, 0.96, 1.0],
    region(z, y, s) {
      const nz = Math.abs(z) / (s.W / 2);
      if (y > 1.0 && y < 2.05 && ((nz > 0.36 && nz < 0.9) || nz < 0.14)) return { sw: 'glossblack' };
      if (y > 0.94 && y < 2.2 && nz < 0.18) return { sw: 'black' };
      if (y >= 0.8 && y <= 0.94) return { sw: 'spink' };
      return { liv: s.liv };
    },
    lamps: [{ kind: 2, y0: 0.42, y1: 0.58, z0: 0.6, z1: 0.85 }, { kind: 3, y0: 0.42, y1: 0.58, z0: 0.36, z1: 0.55 }],
    led: { y0: 2.12, y1: 2.32, z0: -0.5, z1: 0.5 },
  },
  comm: {
    len: () => 0.75,
    depth(z, y, s) { const nz = Math.abs(z) / (s.W / 2); return 0.5 * Math.pow(sstep(0.85, s.H, y), 1.2) + 0.3 * Math.pow(nz, 4) + (y < -0.2 ? 0.05 : 0); },
    ys: [-0.58, -0.4, -0.2, 0.2, 0.42, 0.6, 0.7, 0.79, 0.93, 0.98, 1.3, 1.6, 1.9, 2.1, 2.3, 2.4, 2.55, 2.7, 2.86],
    zs: [0, 0.2, 0.42, 0.58, 0.62, 0.82, 0.86, 0.94, 0.98, 1.0],
    region(z, y, s) {
      const nz = Math.abs(z) / (s.W / 2);
      if (y > 0.98 && y < 2.4 && nz < 0.94) return { sw: 'glossblack' };
      if (y >= 0.79 && y <= 0.98) return { sw: 'nkblue' };
      if (y >= 0.7 && y < 0.79) return { sw: 'nkorange' };
      return { liv: s.liv };
    },
    lamps: [{ kind: 2, y0: 0.42, y1: 0.6, z0: 0.62, z1: 0.86 }, { kind: 3, y0: 0.42, y1: 0.6, z0: 0.42, z1: 0.58 }],
    led: { y0: 2.1, y1: 2.3, z0: -0.6, z1: 0.6 },
  },
  south: {
    len: () => 1.05,
    depth(z, y, s) { const nz = Math.abs(z) / (s.W / 2); return 0.85 * Math.pow(sstep(0.6, s.H, y), 1.15) + 0.42 * Math.pow(nz, 3) + (y < -0.2 ? 0.06 : 0); },
    ys: [-0.58, -0.4, -0.2, 0.2, 0.4, 0.58, 0.62, 0.72, 0.92, 0.98, 1.3, 1.6, 1.9, 2.1, 2.3, 2.45, 2.6, 2.75, 2.88],
    zs: [0, 0.2, 0.4, 0.6, 0.64, 0.84, 0.88, 0.94, 0.98, 1.0],
    region(z, y, s) {
      const nz = Math.abs(z) / (s.W / 2);
      if (y > 0.98 && y < 2.45 && nz < 0.95) return { sw: 'glossblack' };
      if (y >= 0.72 && y <= 0.98) return { sw: 'southblue' };
      if (y >= 0.62 && y < 0.72) return { sw: 'nkorange' };
      return { liv: s.liv };
    },
    lamps: [{ kind: 2, y0: 0.4, y1: 0.58, z0: 0.64, z1: 0.88 }, { kind: 3, y0: 0.4, y1: 0.58, z0: 0.42, z1: 0.6 }],
    led: { y0: 2.12, y1: 2.32, z0: -0.55, z1: 0.55 },
  },
  rapit: {
    // the "Iron Man": a long, round, bulbous nose; slit windscreen in a dark visor
    len: () => 3.4,
    depth(z, y, s) {
      const nz = Math.min(1, Math.abs(z) / (s.W / 2));
      const top = s.H, yb = 0.55;
      let prof = y <= yb ? 1 - 0.18 * Math.pow(sstep(yb, s.bottom, y), 1.5) : Math.pow(Math.cos(Math.PI / 2 * clamp((y - yb) / (top - yb), 0, 1)), 0.62);
      const plan = Math.pow(Math.max(0, 1 - Math.pow(nz, 2.4)), 0.55);
      return 3.4 * (1 - plan * prof);
    },
    ys: [-0.58, -0.45, -0.3, -0.1, 0.15, 0.35, 0.55, 0.62, 0.68, 0.8, 1.0, 1.2, 1.4, 1.55, 1.7, 1.85, 2.0, 2.15, 2.3, 2.45, 2.6, 2.75, 2.88, 2.95],
    zs: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.58, 0.66, 0.74, 0.8, 0.86, 0.91, 0.95, 0.98, 1.0],
    region(z, y, s) {
      const nz = Math.abs(z) / (s.W / 2);
      // visor: an elliptical dark band across the upper nose
      const vy = (y - 1.86) / 0.36, vz = nz / 0.86;
      if (vy * vy + vz * vz * vz * vz < 1) return { sw: 'glossblack' };
      if (y > 0.62 && y < 0.68) return { sw: 'rapitlight' };
      if (y < -0.3) return { sw: 'under' };
      return { liv: s.liv };
    },
    discs: [{ kind: 2, y: 1.18, z: 0.8, r: 0.14 }, { kind: 3, y: 1.18, z: 1.06, r: 0.07 }],
    led: { y0: 2.3, y1: 2.44, z0: -0.38, z1: 0.38 },
  },
};

// lamp centres (local) for glow sprites: { head: [[x,y,z]...], tail: [...] }
export function lampPoints(key) {
  const s = SPECS[key]; if (!s.face) return null;
  const f = FACES[s.face], hw = s.W / 2, out = { head: [], tail: [] };
  for (const lp of f.lamps || []) for (const sd of [1, -1]) { const z = sd * (lp.z0 + lp.z1) / 2 * hw, y = (lp.y0 + lp.y1) / 2; out[lp.kind === 2 ? 'head' : 'tail'].push([s.L / 2 - f.depth(z, y, s) + 0.06, y, z]); }
  for (const dc of f.discs || []) for (const sd of [1, -1]) { const z = sd * dc.z; out[dc.kind === 2 ? 'head' : 'tail'].push([s.L / 2 - f.depth(z, dc.y, s) + 0.06, dc.y, z]); }
  return out;
}

// ---- builder ----------------------------------------------------------------------------------
export function buildCar(key) {
  const s = SPECS[key];
  const mb = new MB(4);
  const hw = s.W / 2, L2 = s.L / 2, inr = s.inner;
  const face = s.face ? FACES[s.face] : null;
  const roofY = (z) => s.cant + (s.H - s.cant) * Math.pow(Math.max(0, 1 - Math.pow(Math.min(1, Math.abs(z) / hw), s.roofP)), 1 / s.roofP);
  const frontX = (z, y) => face ? L2 - face.depth(z, y, s) : L2 - 0.02;
  const ivu = (name) => ({ uv: iswUV(name) });
  const shade = (p) => { const k = 0.68 + 0.32 * sstep(0.0, s.ceil, p[1]); return [k, k, k * 0.99]; };
  const I = (name, extra = {}) => Object.assign({ uv: iswUV(name), colf: shade }, extra);
  const B = (name, extra = {}) => Object.assign({ uv: swUV(name) }, extra);
  const LV = (col, extra = {}) => Object.assign({ uvf: (p) => liv(LIV[col], p[1]) }, extra);

  const doors = doorXs(s);
  const leaves = doors.map(xd => leafDefs(s, xd));
  // exclusion zones along x (door openings + leaf pockets) for windows/seats
  const blocks = [];
  doors.forEach((xd, i) => {
    let a = xd - s.dw / 2, b = xd + s.dw / 2;
    for (const lf of leaves[i]) { if (lf.slide < 0) a = Math.min(a, lf.x0 + lf.slide); else b = Math.max(b, lf.x1 + lf.slide); }
    blocks.push([a - 0.06, b + 0.06, xd]);
  });
  const xRear = -L2 + 0.02;
  const cabLen = face ? face.len(s) : 0;
  const lastDoorEdge = Math.max(...doors.map(x => x + s.dw / 2));
  const xCab = face ? Math.max(L2 - cabLen - (s.face === 'rapit' ? 0.6 : 1.1), lastDoorEdge + 0.15) : L2 - 0.02; // passenger area front limit
  const lastBlockEnd = Math.max(...blocks.map(b => b[1]));
  // free segments for windows
  const segs = [];
  { let p = xRear + 0.3; const list = blocks.slice().sort((a, b) => a[0] - b[0]);
    for (const [a, b] of list) { if (a - p > 0.35) segs.push([p, a]); p = Math.max(p, b); }
    const end = face ? xCab : L2 - 0.32; if (end - p > 0.35) segs.push([p, end]); }

  // ---- windows ---------------------------------------------------------------------------
  const wins = [];
  for (const [a, b] of segs) {
    const len = b - a;
    if (s.winStyle === 'oval') {
      const pitch = s.seatPitch || 1.05, n = Math.floor((len + 0.1) / pitch);
      const off = a + (len - n * pitch) / 2 + pitch / 2;
      for (let k = 0; k < n; k++) wins.push({ oval: true, cx: off + k * pitch, cy: 1.36, rx: 0.4, ry: 0.33 });
    } else if (s.winStyle === 'band') {
      const n = Math.max(1, Math.round(len / 1.6)), w = len / n;
      for (let k = 0; k < n; k++) wins.push({ x0: a + k * w + 0.07, x1: a + (k + 1) * w - 0.07, y0: s.winY0, y1: s.winY1, r: s.winR });
    } else {
      if (len > 2.0) { const m = (a + b) / 2; wins.push({ x0: a, x1: m - 0.07, y0: s.winY0, y1: s.winY1, r: s.winR }, { x0: m + 0.07, x1: b, y0: s.winY0, y1: s.winY1, r: s.winR }); }
      else wins.push({ x0: a, x1: b, y0: s.winY0, y1: s.winY1, r: s.winR });
    }
  }
  // cab side window (driver)
  if (face) {
    const c0 = L2 - cabLen - 0.95, c1 = L2 - (s.face === 'rapit' ? cabLen - 0.2 : cabLen * 0.35) - 0.1;
    const cx0 = Math.max(c0 + 0.2, lastBlockEnd + 0.05), cx1 = Math.min(c1, frontX(hw, 1.5) - 0.15);
    if (s.face !== 'rapit' && cx1 - cx0 > 0.3) wins.push({ x0: cx0, x1: cx1, y0: s.winY0 + 0.05, y1: s.winY1 + 0.05, r: 0.08, cab: true });
  }

  // ---- side panel shape -----------------------------------------------------------------------
  const outline = new THREE.Shape();
  outline.moveTo(xRear, s.bottom);
  const ny = 14;
  for (let j = 0; j <= ny; j++) { const y = s.bottom + (s.cant - s.bottom) * j / ny; outline.lineTo(Math.min(L2 - 0.02, frontX(hw * 0.999, y)), y); }
  outline.lineTo(xRear, s.cant);
  outline.lineTo(xRear, s.bottom);
  const holes = [];
  for (const xd of doors) { const p = new THREE.Path(); p.moveTo(xd - s.dw / 2, 0.0); p.lineTo(xd + s.dw / 2, 0.0); p.lineTo(xd + s.dw / 2, s.dh); p.lineTo(xd - s.dw / 2, s.dh); p.lineTo(xd - s.dw / 2, 0.0); holes.push({ path: p, door: true }); }
  for (const w of wins) {
    const p = new THREE.Path();
    if (w.oval) ellipsePath(p, w.cx, w.cy, w.rx, w.ry); else roundRectPath(p, w.x0, w.y0, w.x1, w.y1, w.r);
    holes.push({ path: p, win: w });
  }
  outline.holes = holes.map(h => h.path);

  for (const side of [1, -1]) {
    const zo = side * hw, zi = side * (hw - inr);
    // exterior skin
    mb.shape(M.BODY, outline, (x, y) => [x, y, zo], [0, 0, side], LV(s.liv), side < 0);
    // interior skin
    mb.shape(M.INT, outline, (x, y) => [x, y, zi], [0, 0, -side], I(s.wallSw), side > 0);
    // reveals
    for (const h of holes) {
      const pts = h.path.getPoints(h.win && h.win.oval ? 10 : 3);
      let cx = 0, cy = 0; pts.forEach(p => { cx += p.x; cy += p.y; }); cx /= pts.length; cy /= pts.length;
      for (let k = 0; k < pts.length - 1; k++) {
        const p = pts[k], q = pts[k + 1];
        if (Math.hypot(q.x - p.x, q.y - p.y) < 1e-4) continue;
        let A = [p.x, p.y, zo], Bq = [q.x, q.y, zo], C = [q.x, q.y, zi], D = [p.x, p.y, zi];
        const ex = q.x - p.x, ey = q.y - p.y; // edge dir in plane
        // in-plane normal candidates
        let nx = -ey, ny2 = ex; const mx = (p.x + q.x) / 2 - cx, my = (p.y + q.y) / 2 - cy;
        const inward = nx * -mx + ny2 * -my > 0;
        const quadN = (() => { const u = [Bq[0] - A[0], Bq[1] - A[1], Bq[2] - A[2]], v = [D[0] - A[0], D[1] - A[1], D[2] - A[2]]; return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2]]; })();
        const facesIn = quadN[0] * -mx + quadN[1] * -my > 0;
        if (!facesIn) { [A, Bq, C, D] = [Bq, A, D, C]; }
        void inward;
        mb.quad(M.BODY, A, Bq, C, D, h.door ? B('stainless') : B('rubber'));
      }
    }
    // window glass
    for (const w of wins) {
      const p = new THREE.Shape();
      if (w.oval) ellipsePath(p, w.cx, w.cy, w.rx, w.ry); else roundRectPath(p, w.x0, w.y0, w.x1, w.y1, w.r);
      mb.shape(M.GLASS, p, (x, y) => [x, y, side * (hw - 0.025)], [0, 0, side], { uv: [0.5, 0.5] }, side < 0);
      // above-window advert inside (passenger windows)
      if (!w.cab && !w.oval) {
        const a = adRect(Math.abs(Math.round(w.x0 * 7 + side * 3 + s.L * 13)) % 24);
        const x0 = w.x0 + 0.05, x1 = Math.min(w.x1 - 0.05, x0 + 0.95);
        const zz = side * (hw - inr - 0.012);
        const uv = [[a[0], a[1]], [a[2], a[1]], [a[2], a[3]], [a[0], a[3]]];
        if (side > 0) mb.quad(M.INT, [x1, 1.92, zz], [x0, 1.92, zz], [x0, 2.16, zz], [x1, 2.16, zz], { uvs: uv, colf: shade });
        else mb.quad(M.INT, [x0, 1.92, zz], [x1, 1.92, zz], [x1, 2.16, zz], [x0, 2.16, zz], { uvs: uv, colf: shade });
      }
    }
    // door leaves (sliding: aDoor = [slide, side])
    doors.forEach((xd, di) => {
      for (const lf of leaves[di]) {
        const zl = side * (hw - 0.03);
        const shp = new THREE.Shape(); shp.moveTo(lf.x0, 0.0); shp.lineTo(lf.x1, 0.0); shp.lineTo(lf.x1, s.dh); shp.lineTo(lf.x0, s.dh); shp.lineTo(lf.x0, 0.0);
        const wx0 = lf.x0 + 0.11, wx1 = lf.x1 - 0.11;
        const hole = new THREE.Path(); roundRectPath(hole, wx0, 0.98, wx1, s.dh - 0.2, 0.05);
        shp.holes = [hole];
        const dd = { door: [lf.slide, side] };
        mb.shape(M.BODY, shp, (x, y) => [x, y, zl], [0, 0, side], LV(s.doorLiv, dd), side < 0);
        mb.shape(M.BODY, shp, (x, y) => [x, y, zl - side * 0.02], [0, 0, -side], B('stainless', dd), side > 0);
        const gl = new THREE.Shape(); roundRectPath(gl, wx0, 0.98, wx1, s.dh - 0.2, 0.05);
        mb.shape(M.GLASS, gl, (x, y) => [x, y, zl - side * 0.01], [0, 0, side], Object.assign({ uv: [0.5, 0.5] }, dd), side < 0);
        // rubber meeting edge
        const me = lf.slide < 0 ? lf.x1 - 0.02 : lf.x0 + 0.02;
        mb.box(M.BODY, me, s.dh / 2, zl - side * 0.01, 0.022, s.dh, 0.03, B('gangway', dd));
      }
      // exterior door frame trim + door-open indicator lamp (lit while open)
      const zt = side * (hw + 0.008);
      for (const xx of [xd - s.dw / 2 - 0.03, xd + s.dw / 2 + 0.03]) mb.box(M.BODY, xx, s.dh / 2, zt, 0.05, s.dh + 0.06, 0.018, B('chrome'));
      mb.box(M.BODY, xd, s.dh + 0.04, zt, s.dw + 0.11, 0.05, 0.018, B('chrome'));
      {
        const ly = s.dh + 0.13, lx0 = xd - 0.06, lx1 = xd + 0.06, zl2 = side * (hw + 0.012);
        if (side > 0) mb.quad(M.EMIT, [lx0, ly, zl2], [lx1, ly, zl2], [lx1, ly + 0.05, zl2], [lx0, ly + 0.05, zl2], { uv: eswUV('redtail'), col: [3, 0.3, 0.2], kind: 4, door: [0, side] });
        else mb.quad(M.EMIT, [lx1, ly, zl2], [lx0, ly, zl2], [lx0, ly + 0.05, zl2], [lx1, ly + 0.05, zl2], { uv: eswUV('redtail'), col: [3, 0.3, 0.2], kind: 4, door: [0, side] });
      }
      // door threshold plate + interior door frame
      mb.box(M.BODY, xd, 0.005, side * (hw - inr / 2), s.dw, 0.012, inr + 0.02, B('chrome', { faces: 't' }));
      // above-door LCD / route map (interior)
      const zz = side * (hw - inr - 0.012);
      if (s.lcd === 'metro') {
        const ic = ICON.lcd; const x0 = xd - 0.3, x1 = xd + 0.3;
        const uv = [[ic[0], ic[1]], [ic[2], ic[1]], [ic[2], ic[3]], [ic[0], ic[3]]];
        if (side > 0) mb.quad(M.EMIT, [x1, 1.93, zz], [x0, 1.93, zz], [x0, 2.15, zz], [x1, 2.15, zz], { uvs: uv, col: [1.3, 1.3, 1.3] });
        else mb.quad(M.EMIT, [x0, 1.93, zz], [x1, 1.93, zz], [x1, 2.15, zz], [x0, 2.15, zz], { uvs: uv, col: [1.3, 1.3, 1.3] });
      } else {
        const r = stripRect('nankai'); const x0 = xd - 0.55, x1 = xd + 0.55;
        const uv = [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]];
        if (side > 0) mb.quad(M.INT, [x1, 1.95, zz], [x0, 1.95, zz], [x0, 2.14, zz], [x1, 2.14, zz], { uvs: uv, colf: shade });
        else mb.quad(M.INT, [x0, 1.95, zz], [x1, 1.95, zz], [x1, 2.14, zz], [x0, 2.14, zz], { uvs: uv, colf: shade });
      }
    });
    // side destination LED (one per side, between the first two doors / near the middle)
    {
      const xl = doors.length > 1 ? (doors[0] + doors[1]) / 2 : 0;
      const w = 0.95, y0 = s.winStyle === 'oval' ? 1.86 : 1.96, y1 = y0 + 0.24;
      const zz = side * (hw + 0.013);
      const [u0, v0, u1, v1] = LED_BASE;
      // housing
      mb.box(M.BODY, xl, (y0 + y1) / 2, side * (hw + 0.002), w + 0.08, y1 - y0 + 0.08, 0.012, B('black', { faces: side > 0 ? 's' : 'n' }));
      if (side > 0) mb.quad(M.EMIT, [xl - w / 2, y0, zz], [xl + w / 2, y0, zz], [xl + w / 2, y1, zz], [xl - w / 2, y1, zz], { uvs: [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], kind: 1, col: [1.6, 1.6, 1.6] });
      else mb.quad(M.EMIT, [xl + w / 2, y0, zz], [xl - w / 2, y0, zz], [xl - w / 2, y1, zz], [xl + w / 2, y1, zz], { uvs: [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], kind: 1, col: [1.6, 1.6, 1.6] });
    }
  }

  // ---- roof -----------------------------------------------------------------------------------
  {
    const zsN = 16;
    const zs = []; for (let i = 0; i <= zsN; i++) { const t = -1 + 2 * i / zsN; zs.push(Math.sign(t) * Math.pow(Math.abs(t), 0.7) * hw); }
    const nrm = (z) => { const e = 0.01; const d = (roofY(Math.min(hw, z + e)) - roofY(Math.max(-hw, z - e))) / (Math.min(hw, z + e) - Math.max(-hw, z - e)); const n = new THREE.Vector3(0, 1, -d).normalize(); if (Math.abs(z) > hw * 0.999) n.set(0, 0.2, Math.sign(z)).normalize(); return [n.x, n.y, n.z]; };
    for (let i = 0; i < zsN; i++) {
      const za = zs[i], zb = zs[i + 1], ya = roofY(za), yb = roofY(zb);
      const xa = face ? Math.min(L2 - 0.02, frontX(za, ya)) : L2 - 0.02, xb = face ? Math.min(L2 - 0.02, frontX(zb, yb)) : L2 - 0.02;
      const na = nrm(za), nb = nrm(zb);
      mb.quad(M.BODY, [xRear, ya, za], [xRear, yb, zb], [xb, yb, zb], [xa, ya, za], LV(s.liv, { ns: [na, nb, nb, na] }));
    }
    // roof equipment
    for (let k = 0; k < s.ac; k++) {
      const x = (k === 0 ? -1 : 1) * s.L * 0.25;
      if (face && x > L2 - cabLen - 1.2) continue;
      mb.box(M.BODY, x, s.H + 0.12, 0, 2.1, 0.3, 1.7, B('roof'));
      mb.box(M.BODY, x, s.H + 0.28, 0, 1.2, 0.03, 0.9, B('midgrey', { faces: 't' }));
    }
    if (s.panto) pantograph(mb, s, s.L * 0.22, B);
    // roof edge gutter lines
    mb.box(M.BODY, 0, s.cant + 0.02, hw - 0.01, s.L - 0.1 - (face ? cabLen : 0), 0.04, 0.03, B('midgrey'));
    mb.box(M.BODY, 0, s.cant + 0.02, -hw + 0.01, s.L - 0.1 - (face ? cabLen : 0), 0.04, 0.03, B('midgrey'));
  }

  // ---- ends ------------------------------------------------------------------------------------
  const section = new THREE.Shape();
  section.moveTo(-hw, s.bottom); section.lineTo(hw, s.bottom);
  for (let i = 0; i <= 12; i++) { const z = hw - 2 * hw * i / 12; section.lineTo(z, i === 0 || i === 12 ? s.cant : roofY(z)); }
  section.lineTo(-hw, s.bottom);
  const ends = face ? [-1] : [-1, 1];
  for (const e of ends) {
    const x = e * (L2 - 0.02);
    mb.shape(M.BODY, section, (z, y) => [x, y, z], [e, 0, 0], LV(s.liv), e > 0);
    // gangway bellows
    mb.box(M.BODY, e * (L2 + s.gap / 4 - 0.01), 1.05, 0, s.gap / 2 + 0.02, 2.15, 1.25, B('gangway', { faces: 'tbns' }));
    // coupler
    mb.box(M.BODY, e * (L2 + 0.1), -0.62, 0, 0.3, 0.16, 0.2, B('under'));
  }

  // ---- cab face ----------------------------------------------------------------------------
  if (face) buildFace(mb, s, face, roofY, B, LV);

  // ---- interior -------------------------------------------------------------------------------
  {
    const zi = hw - inr;
    const x0 = xRear + inr, x1 = face ? xCab : L2 - inr;
    mb.quad(M.INT, [x0, 0, zi], [x1, 0, zi], [x1, 0, -zi], [x0, 0, -zi], I(s.floorSw));
    // ceiling + light strips
    mb.quad(M.INT, [x0, s.ceil, -zi], [x1, s.ceil, -zi], [x1, s.ceil, zi], [x0, s.ceil, zi], I('ceiling'));
    for (const zz of [-0.62, 0.62]) {
      mb.quad(M.EMIT, [x0 + 0.2, s.ceil - 0.012, zz - 0.09], [x1 - 0.2, s.ceil - 0.012, zz - 0.09], [x1 - 0.2, s.ceil - 0.012, zz + 0.09], [x0 + 0.2, s.ceil - 0.012, zz + 0.09], { uv: eswUV('cool'), col: [2.6, 2.6, 2.5] });
    }
    // cove panels between wall and ceiling
    for (const sd of [1, -1]) {
      mb.quad(M.INT, [x0, s.ceil, sd * (zi - 0.25)], [x1, s.ceil, sd * (zi - 0.25)], [x1, s.ceil - 0.18, sd * zi], [x0, s.ceil - 0.18, sd * zi], I('ceiling', { faces: '' }));
    }
    // end walls with gangway door
    const endWall = (x, dir, partition) => {
      const zz = zi;
      if (dir > 0) mb.quad(M.INT, [x, 0, zz], [x, 0, -zz], [x, s.ceil, -zz], [x, s.ceil, zz], I(s.wallSw));
      else mb.quad(M.INT, [x, 0, -zz], [x, 0, zz], [x, s.ceil, zz], [x, s.ceil, -zz], I(s.wallSw));
      const xo = x + dir * 0.01;
      const dz = partition ? 0.3 : 0.42;
      if (dir > 0) {
        mb.quad(M.INT, [xo, 0, dz], [xo, 0, -dz], [xo, 1.92, -dz], [xo, 1.92, dz], I('door_in'));
        mb.quad(M.INT, [xo + 0.005, 1.0, dz - 0.08], [xo + 0.005, 1.0, -dz + 0.08], [xo + 0.005, 1.78, -dz + 0.08], [xo + 0.005, 1.78, dz - 0.08], I('black'));
      } else {
        mb.quad(M.INT, [xo, 0, -dz], [xo, 0, dz], [xo, 1.92, dz], [xo, 1.92, -dz], I('door_in'));
        mb.quad(M.INT, [xo - 0.005, 1.0, -dz + 0.08], [xo - 0.005, 1.0, dz - 0.08], [xo - 0.005, 1.78, dz - 0.08], [xo - 0.005, 1.78, -dz + 0.08], I('black'));
      }
    };
    endWall(x0, 1, false);
    endWall(x1, -1, !!face);
    if (face) {
      // cab: dark console behind the windscreen
      const cl = Math.min(1.0, Math.max(0.2, L2 - face.depth(0, 1.0, s) - x1 - 0.2));
      mb.box(M.INT, x1 + cl / 2 + 0.02, 0.55, 0, cl, 1.1, s.W - 0.4, I('dark'));
    }
    if (s.seats === 'long') longSeats(mb, s, doors, x0, x1, zi, I, blocks);
    else transSeats(mb, s, doors, x0, x1, zi, I, blocks);
  }

  // ---- underframe -----------------------------------------------------------------------------
  {
    mb.quad(M.BODY, [-L2, s.bottom, -hw], [L2 - (face ? 0.3 : 0), s.bottom, -hw], [L2 - (face ? 0.3 : 0), s.bottom, hw], [-L2, s.bottom, hw], B('under'));
    for (const bx of [-1, 1]) {
      const cx = bx * (L2 - s.bogieInset);
      const g2 = s.gauge / 2 + 0.06;
      mb.box(M.BODY, cx, -0.6, 0, 2.6, 0.12, 2.0, B('bogie'));
      for (const sd of [1, -1]) {
        mb.box(M.BODY, cx, -0.52, sd * (g2 + 0.18), 2.5, 0.3, 0.14, B('bogie'));
        for (const ax of [-1.05, 1.05]) {
          mb.cyl(M.BODY, [cx + ax, RAIL_TOP + s.wheelR, sd * (g2 - 0.07)], [cx + ax, RAIL_TOP + s.wheelR, sd * (g2 + 0.07)], s.wheelR, 10, B('wheel'));
          mb.box(M.BODY, cx + ax, RAIL_TOP + s.wheelR, sd * (g2 + 0.28), 0.32, 0.26, 0.14, B('under'));
        }
        // spring / damper
        mb.box(M.BODY, cx, -0.4, sd * (g2 + 0.3), 0.3, 0.32, 0.18, B('midgrey'));
      }
      // third-rail shoe beam (metro)
      if (s.gauge > 1.3) mb.box(M.BODY, cx + 1.2, RAIL_TOP + 0.12, 1.5, 0.3, 0.06, 0.35, B('under'));
    }
    // underfloor equipment boxes
    const eq = [[0.0, 2.6, 0.9], [-0.25, 1.6, 0.6], [0.3, 1.2, 1.1], [-0.1, 2.0, 0.7]];
    const span = s.L - 2 * s.bogieInset - 3.2;
    let x = -span / 2;
    eq.forEach(([zo, len, wd], k) => {
      if (x + len > span / 2) return;
      mb.box(M.BODY, x + len / 2, -0.72, zo * hw, len, 0.3, wd * 1.4, B(k % 2 ? 'under' : 'midgrey'));
      x += len + 0.4;
    });
  }
  const geo = mb.build();
  geo.userData = { key, doors, spec: s };
  return geo;
}

function pantograph(mb, s, x, B) {
  const y = s.H + 0.02;
  mb.box(M.BODY, x, y + 0.1, 0, 1.6, 0.12, 1.2, B('panto'));
  for (const z of [-0.5, 0.5]) mb.box(M.BODY, x - 0.6, y + 0.02, z, 0.14, 0.2, 0.14, B('white'));
  const knee = [x + 0.9, y + 0.75, 0], base = [x - 0.3, y + 0.2, 0], head = [x - 0.15, y + 1.25, 0];
  for (const z of [-0.18, 0.18]) mb.beam(M.BODY, [base[0], base[1], z], [knee[0], knee[1], z * 0.4], 0.06, 0.06, B('panto'));
  mb.beam(M.BODY, knee, head, 0.05, 0.05, B('panto'));
  mb.box(M.BODY, head[0], head[1] + 0.02, 0, 0.12, 0.05, 1.7, B('stainless'));
  mb.box(M.BODY, head[0] + 0.25, head[1] - 0.02, 0, 0.06, 0.04, 1.4, B('panto'));
}

function buildFace(mb, s, face, roofY, B, LV) {
  const hw = s.W / 2, L2 = s.L / 2;
  const zsF = []; for (const f of face.zs) { zsF.push(-f * hw); if (f > 0) zsF.push(f * hw); }
  zsF.sort((a, b) => a - b);
  const zs = [...new Set(zsF.map(v => +v.toFixed(5)))];
  const ys = face.ys;
  const X = (z, y) => L2 - face.depth(z, y, s);
  const N = (z, y) => {
    const e = 0.01;
    const dz = (face.depth(Math.min(hw, z + e), y, s) - face.depth(Math.max(-hw, z - e), y, s)) / (Math.min(hw, z + e) - Math.max(-hw, z - e));
    const dy = (face.depth(z, y + e, s) - face.depth(z, y - e, s)) / (2 * e);
    const n = new THREE.Vector3(1, dy, dz).normalize();
    return [n.x, n.y, n.z];
  };
  const P = (z, y) => { const yy = Math.min(y, roofY(z)); return [X(z, yy), yy, z]; };
  for (let i = 0; i < zs.length - 1; i++) {
    for (let j = 0; j < ys.length - 1; j++) {
      const za = zs[i], zb = zs[i + 1];
      const ya0 = Math.min(ys[j], roofY(za)), ya1 = Math.min(ys[j + 1], roofY(za));
      const yb0 = Math.min(ys[j], roofY(zb)), yb1 = Math.min(ys[j + 1], roofY(zb));
      if (ya1 - ya0 < 1e-4 && yb1 - yb0 < 1e-4) continue;
      const a = P(za, ya0), b = P(zb, yb0), c = P(zb, yb1), d = P(za, ya1);
      const reg = face.region((za + zb) / 2, (ys[j] + Math.min(ys[j + 1], roofY((za + zb) / 2))) / 2, s);
      const opt = reg.sw ? B(reg.sw) : LV(s.liv);
      // order so that the face looks along +x
      opt.ns = [N(za, ya0), N(zb, yb0), N(zb, yb1), N(za, ya1)];
      // a->b is +z; seen from +x, +z points left => a,d,c,b is CCW
      mb.quad(M.BODY, a, d, c, b, Object.assign({}, opt, { ns: [opt.ns[0], opt.ns[3], opt.ns[2], opt.ns[1]] }));
    }
  }
  // lamps (rectangles following the surface)
  const surf = (z, y, off = 0.012) => { const n = N(z, y); const x = X(z, y); return [x + n[0] * off, y + n[1] * off, z + n[2] * off]; };
  for (const lp of face.lamps || []) {
    for (const sd of [1, -1]) {
      const z0 = sd * lp.z0 * hw, z1 = sd * lp.z1 * hw;
      const za = Math.min(z0, z1), zb = Math.max(z0, z1);
      const col = lp.kind === 2 ? [3.2, 3.1, 2.8] : [3.0, 0.25, 0.2];
      const uv = eswUV(lp.kind === 2 ? 'head' : 'redtail');
      mb.quad(M.EMIT, surf(za, lp.y0), surf(za, lp.y1), surf(zb, lp.y1), surf(zb, lp.y0), { uv, col, kind: lp.kind });
    }
  }
  for (const dc of face.discs || []) {
    for (const sd of [1, -1]) {
      const cz = sd * dc.z, cy = dc.y, n = 12;
      const col = dc.kind === 2 ? [3.2, 3.1, 2.8] : [3.0, 0.25, 0.2];
      const uv = eswUV(dc.kind === 2 ? 'head' : 'redtail');
      const c = surf(cz, cy, 0.015);
      for (let k = 0; k < n; k++) {
        const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
        const p0 = surf(cz + Math.cos(a0) * dc.r, cy + Math.sin(a0) * dc.r, 0.015), p1 = surf(cz + Math.cos(a1) * dc.r, cy + Math.sin(a1) * dc.r, 0.015);
        mb.tri(M.EMIT, c, p1, p0, { uv, col, kind: dc.kind });
        // chrome bezel
        const q0 = surf(cz + Math.cos(a0) * dc.r * 1.35, cy + Math.sin(a0) * dc.r * 1.35, 0.008), q1 = surf(cz + Math.cos(a1) * dc.r * 1.35, cy + Math.sin(a1) * dc.r * 1.35, 0.008);
        mb.quad(M.BODY, p0, p1, q1, q0, B('chrome'));
      }
    }
  }
  // LED destination (front): u runs towards -z when seen from the front
  if (face.led) {
    const { y0, y1, z0, z1 } = face.led;
    const [u0, v0, u1, v1] = LED_BASE;
    mb.quad(M.EMIT, surf(z1, y0, 0.02), surf(z0, y0, 0.02), surf(z0, y1, 0.02), surf(z1, y1, 0.02), { uvs: [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], kind: 1, col: [1.7, 1.7, 1.7] });
  }
  // skirt / snowplough and coupler
  mb.box(M.BODY, L2 - face.depth(0, -0.5, s) - 0.1, -0.7, 0, 0.25, 0.3, s.W * 0.8, B('under'));
  mb.box(M.BODY, L2 - face.depth(0, -0.5, s) + 0.05, -0.62, 0, 0.35, 0.16, 0.22, B('chrome'));
  // wipers / grab handles for flat fronts
  if (s.face !== 'rapit') {
    for (const z of [-0.5, 0.45]) { const p = surf(z, 1.12, 0.02); mb.beam(M.BODY, p, [p[0] - 0.05, p[1] + 0.5, p[2] + 0.18], 0.025, 0.02, B('black')); }
  }
}

// ---- seats ----------------------------------------------------------------------------------------
function longSeats(mb, s, doors, x0, x1, zi, I, blocks) {
  // segments along the wall not occupied by door openings
  const ds = doors.map(xd => [xd - s.dw / 2 - 0.1, xd + s.dw / 2 + 0.1]).sort((a, b) => a[0] - b[0]);
  const segs = []; let p = x0 + 0.05;
  for (const [a, b] of ds) { if (a - p > 0.6) segs.push([p, a, segs.length === 0]); p = b; }
  if (x1 - 0.05 - p > 0.6) segs.push([p, x1 - 0.05, true]);
  const ringY = 1.68;
  for (const [a, b, endSeg] of segs) {
    for (const sd of [1, -1]) {
      const prio = endSeg && sd > 0 && (a < x0 + 0.5 || b > x1 - 0.5);
      const sw = prio ? 'seat_prio' : s.seatSw;
      const zw = sd * zi;
      // cushion
      mb.box(M.INT, (a + b) / 2, 0.38, zw - sd * 0.27, b - a, 0.12, 0.5, I(sw));
      // seat base / heater skirt
      mb.box(M.INT, (a + b) / 2, 0.16, zw - sd * 0.18, b - a, 0.32, 0.34, I('seat_frame'));
      // backrest (slanted)
      const yb0 = 0.46, yb1 = 0.98, zb0 = zw - sd * 0.1, zb1 = zw - sd * 0.06;
      const zf0 = zb0 - sd * 0.08, zf1 = zb1 - sd * 0.08;
      if (sd > 0) mb.quad(M.INT, [b, yb0, zf0], [a, yb0, zf0], [a, yb1, zf1], [b, yb1, zf1], I(sw));
      else mb.quad(M.INT, [a, yb0, zf0], [b, yb0, zf0], [b, yb1, zf1], [a, yb1, zf1], I(sw));
      mb.box(M.INT, (a + b) / 2, yb1, (zf1 + zb1) / 2, b - a, 0.03, 0.1, I(sw));
      // seat-end partition panels (袖仕切り)
      for (const xe of [a, b]) {
        mb.box(M.INT, xe, 0.62, zw - sd * 0.32, 0.03, 1.2, 0.56, I('wall_grey'));
        mb.cyl(M.INT, [xe, 0.0, zw - sd * 0.62], [xe, s.ceil, zw - sd * 0.62], 0.018, 6, I('pole'));
      }
      // luggage rack
      mb.box(M.INT, (a + b) / 2, 1.78, zw - sd * 0.2, b - a, 0.025, 0.36, I('pole'));
      // strap rail + straps
      const zr = zw - sd * 0.62;
      mb.cyl(M.INT, [a, 1.98, zr], [b, 1.98, zr], 0.014, 5, I('pole'));
      const n = Math.max(1, Math.floor((b - a) / 0.42));
      for (let k = 0; k < n; k++) {
        const xs = a + (b - a) * (k + 0.5) / n;
        const sw2 = prio ? 'strap_prio' : 'strap';
        mb.box(M.INT, xs, 1.86, zr, 0.03, 0.22, 0.012, I(sw2));
        // triangular ring
        const t = [[xs, ringY + 0.1], [xs - 0.07, ringY - 0.04], [xs + 0.07, ringY - 0.04]];
        for (let q = 0; q < 3; q++) { const u = t[q], v = t[(q + 1) % 3]; mb.beam(M.INT, [u[0], u[1], zr], [v[0], v[1], zr], 0.022, 0.022, I(sw2)); }
      }
    }
  }
  // hanging adverts (中吊り) along the centre, double-sided
  const bays = []; const all = [x0, ...doors, x1];
  for (let i = 0; i < all.length - 1; i++) bays.push((all[i] + all[i + 1]) / 2);
  bays.forEach((xb, k) => {
    const a = adRect(k * 5 + Math.round(s.L));
    const z0 = -0.38, z1 = 0.38, y0 = 1.72, y1 = 2.12;
    mb.quad(M.INT, [xb, y0, z1], [xb, y0, z0], [xb, y1, z0], [xb, y1, z1], { uvs: [[a[0], a[1]], [a[2], a[1]], [a[2], a[3]], [a[0], a[3]]], col: [0.95, 0.95, 0.95] });
    const b2 = adRect(k * 5 + 2 + Math.round(s.L));
    mb.quad(M.INT, [xb + 0.002, y0, z0], [xb + 0.002, y0, z1], [xb + 0.002, y1, z1], [xb + 0.002, y1, z0], { uvs: [[b2[0], b2[1]], [b2[2], b2[1]], [b2[2], b2[3]], [b2[0], b2[3]]], col: [0.95, 0.95, 0.95] });
  });
  void blocks;
}

function transSeats(mb, s, doors, x0, x1, zi, I, blocks) {
  const pitch = s.seatPitch || 1.0;
  // seating area: between vestibules (door blocks)
  let a = x0 + 0.2, b = x1 - 0.2;
  for (const [ba, bb] of blocks) { if (bb < 0) a = Math.max(a, bb + 0.25); else b = Math.min(b, ba - 0.25); }
  const n = Math.floor((b - a) / pitch);
  const off = a + (b - a - n * pitch) / 2;
  for (let k = 0; k < n; k++) {
    const xs = off + k * pitch + 0.25;
    for (const sd of [1, -1]) {
      const zA0 = 0.34, zB0 = zi - 0.06;
      const zc = sd * (zA0 + zB0) / 2; // centre of the 2-seat block
      const wz = zB0 - zA0;
      mb.box(M.INT, xs, 0.42, zc, 0.5, 0.12, wz, I(s.seatSw));
      mb.box(M.INT, xs, 0.2, zc, 0.36, 0.36, wz * 0.8, I('seat_frame'));
      // backrest leaning back towards -x
      const bx0 = xs - 0.27, bx1 = xs - 0.36;
      const zA = zc - wz / 2, zB = zc + wz / 2;
      mb.quad(M.INT, [bx0, 0.48, zA], [bx0, 0.48, zB], [bx1, 1.22, zB], [bx1, 1.22, zA], I(s.seatSw));
      mb.quad(M.INT, [bx1 - 0.08, 1.22, zA], [bx1 - 0.08, 1.22, zB], [bx0 - 0.08, 0.48, zB], [bx0 - 0.08, 0.48, zA], I('seat_frame'));
      mb.quad(M.INT, [bx1, 1.22, zA], [bx1, 1.22, zB], [bx1 - 0.08, 1.22, zB], [bx1 - 0.08, 1.22, zA], I(s.seatSw));
      // headrest covers
      for (const zz of [zc - wz / 4, zc + wz / 4]) mb.quad(M.INT, [bx1 + 0.012, 1.02, zz - wz / 5], [bx1 + 0.012, 1.02, zz + wz / 5], [bx1 + 0.002, 1.2, zz + wz / 5], [bx1 + 0.002, 1.2, zz - wz / 5], I('headrest'));
    }
  }
  // luggage racks above the windows
  for (const sd of [1, -1]) mb.box(M.INT, (a + b) / 2, 1.9, sd * (zi - 0.2), b - a, 0.03, 0.38, I('luggage'));
}
