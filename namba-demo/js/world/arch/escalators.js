// =============================================================================
// Escalators & stairs. Everything is built exactly on layout.rampProfile so
// feet (player + NPCs walk on the profile) meet the treads.
//
// Escalator lane cross-section (u = lateral offset from the lane centreline):
//   |u| < 0.5   moving steps (InstancedMesh per bank, animated, 0.4 m chain pitch)
//   0.505       stainless skirt panel with a lit LED line at its top
//   0.505–0.6   inner decking
//   0.6         frameless glass balustrade, rounded newel ends
//   0.6         moving black handrail (scrolling texture), wraps the newels
//   0.64–1.0    outer decking (intermediate decking with anti-slide knobs
//               between two escalators), outer cladding at 0.95
// plus landing plates, yellow comb plates, truss soffit / enclosure wedge.
// Stairs: stone treads + risers on the profile, yellow nosing strips, parapets
// with double-height stainless handrails (2段手すり), centre rail when wide,
// tunnel walls / soffit / street canopy for exits.
// =============================================================================
import * as THREE from 'three';
import { GeoBatch } from '../../render/geobatch.js?v=454ed73';
import { CELL } from '../world.js?v=454ed73';
import { LEVELS, rampProfile, rampLength, rampEnds, rampFlat, ESC_TRANSITION } from '../layout.js?v=454ed73';
import { styleOf } from './styles.js?v=454ed73';
import { KELVIN } from './kit.js?v=454ed73';

const STEP = 0.4;   // chain pitch along the step path (m)
const SPEED = 0.5;  // m/s (= world.conveyor)
const WEDGE = new Set(['midosuji', 'sennichimae', 'nankai', 'nambawalk', 'link', 'takashimaya']);

function frameOf(r) {
  const len = rampLength(r), ends = rampEnds(r);
  const ax = r.axis === 'x';
  const [x0, z0, x1, z1] = r.rect;
  const cc = ax ? (z0 + z1) / 2 : (x0 + x1) / 2;
  const lowA = ax ? ends.low.x : ends.low.z;
  const dir = r.up;
  const P = (s, u, y) => { const a = lowA + dir * s; return ax ? [a, y, cc + u] : [cc + u, y, a]; };
  const T = ax ? [dir, 0, 0] : [0, 0, dir];
  const U = ax ? [0, 0, 1] : [1, 0, 0];
  const prof = (s) => rampProfile(r, Math.min(1, Math.max(0, s / len)));
  return { len, ax, cc, P, T, U, prof, yl: LEVELS[r.lower].y, yu: LEVELS[r.upper].y, flat: rampFlat(r), lowA, dir };
}
// quad oriented to face n
function Q(b, mat, a, bb, c, d, n, uv) {
  const ux = bb[0] - a[0], uy = bb[1] - a[1], uz = bb[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
  const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
  if (cx * n[0] + cy * n[1] + cz * n[2] >= 0) b.quad(mat, a, bb, c, d, uv ? { uv } : undefined);
  else b.quad(mat, bb, a, d, c, uv ? { uv: [uv[1], uv[0], uv[3], uv[2]] } : undefined);
}
const neg = (v) => [-v[0], -v[1], -v[2]];
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

// sample positions along s: fine around the curved transitions, coarse on the incline
function samples(F, sA, sB) {
  const out = new Set([sA, sB]);
  const t0 = F.flat, t1 = F.flat + ESC_TRANSITION, t2 = F.len - F.flat - ESC_TRANSITION, t3 = F.len - F.flat;
  for (let s = Math.ceil(sA * 8) / 8; s < sB; s += 0.125) {
    if ((s > t0 - 0.2 && s < t1 + 0.2) || (s > t2 - 0.2 && s < t3 + 0.2)) out.add(s);
  }
  for (const s of [t0, t1, t2, t3]) if (s > sA && s < sB) out.add(s);
  for (let s = sA; s < sB; s += 2) out.add(s);
  return [...out].sort((a, b) => a - b);
}

// ribbon between two edge functions over s samples, facing n(s)
function ribbon(b, mat, ss, fa, fb, n) {
  for (let i = 0; i < ss.length - 1; i++) {
    const s0 = ss[i], s1 = ss[i + 1];
    Q(b, mat, fa(s0), fb(s0), fb(s1), fa(s1), typeof n === 'function' ? n((s0 + s1) / 2) : n);
  }
}

export class Ramps {
  constructor(K) {
    this.K = K;
    this.banks = [];
    this.t = 0;
    this.handrailMats = null;
  }

  build() {
    const K = this.K, L = K.L;
    const mats = K.ctx.materials;
    // scrolling handrail materials (own texture clones so offsets are independent)
    const base = mats.get('esc_handrail');
    const mk = (name) => {
      const m = base.clone();
      if (base.map) { m.map = mats.cloneTexture ? mats.cloneTexture(base.map) : base.map.clone(); m.map.repeat.copy(base.map.repeat); }
      m.side = THREE.DoubleSide;
      m.name = name;
      return m;
    };
    this.handrailMats = { up: mk('esc_handrail_up'), down: mk('esc_handrail_down') };
    mats.define('esc_handrail_up', () => this.handrailMats.up);
    mats.define('esc_handrail_down', () => this.handrailMats.down);
    // group lanes into banks
    const byBank = new Map();
    L.ramps.forEach((r, ri) => { const k = r.bank || r.id; if (!byBank.has(k)) byBank.set(k, []); byBank.get(k).push(ri); });
    this.stepGeo = this._stepGeometry();
    for (const [id, list] of byBank) {
      const lanes = list.map(ri => L.ramps[ri]);
      for (const r of lanes) {
        const nb = this._neighbours(r, lanes);
        if (r.kind === 'escalator') this._escalator(r, nb);
        else this._stairs(r, nb);
      }
      this._bankEnclosure(id, lanes);
      this._landingLights(lanes);
      const escs = lanes.filter(r => r.kind === 'escalator');
      if (escs.length) this._bankSteps(id, escs);
    }
    return this.banks;
  }

  // lateral neighbours: { lo: ramp|null, hi: ramp|null } (lo = -u side)
  _neighbours(r, lanes) {
    const out = { lo: null, hi: null };
    for (const o of lanes) {
      if (o === r) continue;
      if (r.axis === 'z') { if (o.rect[2] === r.rect[0]) out.lo = o; if (o.rect[0] === r.rect[2]) out.hi = o; }
      else { if (o.rect[3] === r.rect[1]) out.lo = o; if (o.rect[1] === r.rect[3]) out.hi = o; }
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  _escalator(r, nb) {
    const K = this.K;
    const F = frameOf(r);
    const { len, P, U, prof } = F;
    const mid = P(len / 2, 0, F.yl);
    const b = K.B(r.lower, mid[0], mid[2]);
    const UP = [0, 1, 0];
    const sN0 = 0.5, sN1 = len - 0.5;  // newel centres
    const ss = samples(F, 0.15, len - 0.15);
    const ssB = samples(F, sN0, sN1);
    const wedge = WEDGE.has(r.zone);
    for (const side of [-1, 1]) {
      const n = side < 0 ? U : neg(U);      // facing the steps
      const out = side < 0 ? neg(U) : U;    // facing away
      const other = side < 0 ? nb.lo : nb.hi;
      // skirt + LED line
      ribbon(b, 'esc_deck', ss, s => P(s, side * 0.505, prof(s) - 0.12), s => P(s, side * 0.505, prof(s) + 0.12), n);
      ribbon(b, 'esc_skirt_light', ss, s => P(s, side * 0.503, prof(s) + 0.095), s => P(s, side * 0.503, prof(s) + 0.115), n);
      // inner decking
      ribbon(b, 'esc_deck', ss, s => P(s, side * 0.505, prof(s) + 0.12), s => P(s, side * 0.6, prof(s) + 0.2), UP);
      // glass
      ribbon(b, 'glass_rail', ssB, s => P(s, side * 0.6, prof(s) + 0.2), s => P(s, side * 0.6, prof(s) + 0.94), n);
      // newel glass caps (half discs) at both ends
      for (const [sn, dirS] of [[sN0, -1], [sN1, 1]]) {
        const R = 0.4, yc = prof(sn) + 0.98 - R;
        for (let k = 0; k < 8; k++) {
          const p0 = k / 8 * Math.PI, p1 = (k + 1) / 8 * Math.PI;
          const A = P(sn, side * 0.6, yc), Bp = P(sn + dirS * Math.sin(p0) * (R - 0.04), side * 0.6, yc + Math.cos(p0) * (R - 0.04)), Cp = P(sn + dirS * Math.sin(p1) * (R - 0.04), side * 0.6, yc + Math.cos(p1) * (R - 0.04));
          b.tri('glass_rail', A, Bp, Cp);
        }
        b.quad('glass_rail', P(sn, side * 0.6, prof(sn) + 0.2), P(sn, side * 0.6, yc), P(sn + dirS * (R - 0.04), side * 0.6, yc), P(sn + dirS * (R - 0.04), side * 0.6, prof(sn) + 0.2));
      }
      // handrail: low newel -> top run -> high newel
      const path = [];
      const R = 0.4;
      const yc0 = prof(sN0) + 0.98 - R, yc1 = prof(sN1) + 0.98 - R;
      path.push(P(sN0 + 0.2, side * 0.6, yc0 - R));
      for (let k = 0; k <= 10; k++) { const ph = Math.PI - k / 10 * Math.PI; path.push(P(sN0 - Math.sin(ph) * R, side * 0.6, yc0 + Math.cos(ph) * R)); }
      for (const s of ssB) if (s > sN0 + 1e-6 && s < sN1 - 1e-6) path.push(P(s, side * 0.6, prof(s) + 0.98));
      for (let k = 0; k <= 10; k++) { const ph = k / 10 * Math.PI; path.push(P(sN1 + Math.sin(ph) * R, side * 0.6, yc1 + Math.cos(ph) * R)); }
      path.push(P(sN1 - 0.2, side * 0.6, yc1 - R));
      const prof2 = [[-0.025, -0.045], [0.018, -0.045], [0.028, -0.03], [0.028, 0.03], [0.018, 0.045], [-0.025, 0.045]];
      b.sweep(r.move > 0 ? 'esc_handrail_up' : 'esc_handrail_down', path, prof2, { up: U });
      // handrail guide profile under the rail (stainless)
      ribbon(b, 'stainless', ssB, s => P(s, side * 0.6, prof(s) + 0.92), s => P(s, side * 0.6, prof(s) + 0.95), n);
      // outer decking
      const esc2 = other && other.kind === 'escalator';
      const edge = esc2 ? 1.0 : 0.95;
      ribbon(b, 'esc_deck', ss, s => P(s, side * 0.62, prof(s) + 0.2), s => P(s, side * edge, prof(s) + (esc2 ? 0.2 : 0.15)), UP);
      if (esc2 && side > 0) {
        // anti-slide knobs on the intermediate decking (Japanese escalators)
        for (let s = F.flat + 1.5; s < len - F.flat - 1.0; s += 1.6) {
          const p = P(s, 1.0, prof(s) + 0.26);
          b.box('stainless', p[0], p[1], p[2], 0.12, 0.12, 0.12, F.ax ? 0 : 0);
        }
      }
      if (!esc2) {
        // outer cladding: down to the floor (wedge) or the truss soffit
        const bot = (s) => wedge ? F.yl : Math.max(F.yl, prof(s) - 1.05);
        ribbon(b, wedge ? 'esc_cladding' : 'esc_cladding_white', ss, s => P(s, side * 0.95, bot(s)), s => P(s, side * 0.95, prof(s) + 0.15), out);
        b.sweep('stainless', ss.map(s => P(s, side * 0.95, prof(s) + 0.15)), [[0, 0], [0.03, 0], [0.03, 0.03], [0, 0.03]], { up: UP });
      }
    }
    // soffit (free-standing) — underside of the truss
    if (!wedge) ribbon(b, 'esc_cladding_white', ss.filter(s => prof(s) - 1.05 > F.yl + 0.05), s => P(s, -0.95, prof(s) - 1.05), s => P(s, 0.95, prof(s) - 1.05), [0, -1, 0]);
    // landing plates, comb plates, floor infill across the lane at both ends
    for (const [s0, s1, sc0, sc1, yy, lv] of [[0, 0.85, 0.85, 0.95, F.yl, r.lower], [len - 0.85, len, len - 0.95, len - 0.85, F.yu, r.upper]]) {
      const bb = K.B(lv, mid[0], mid[2]);
      Q(bb, 'esc_landing', P(s0, -0.55, yy + 0.012), P(s0, 0.55, yy + 0.012), P(s1, 0.55, yy + 0.012), P(s1, -0.55, yy + 0.012), UP);
      Q(bb, 'esc_comb', P(sc0, -0.5, yy + 0.016), P(sc0, 0.5, yy + 0.016), P(sc1, 0.5, yy + 0.016), P(sc1, -0.5, yy + 0.016), UP);
      // floor infill beside the landing plate
      const fl = this._floorMat(lv, r);
      for (const sd of [-1, 1]) Q(bb, fl, P(s0, sd * 0.55, yy + 0.002), P(s0, sd * 1.0, yy + 0.002), P(s1, sd * 1.0, yy + 0.002), P(s1, sd * 0.55, yy + 0.002), UP);
      // a stainless frame around the landing plate
      Q(bb, 'stainless', P(s0, -0.58, yy + 0.008), P(s0, -0.55, yy + 0.008), P(s1, -0.55, yy + 0.008), P(s1, -0.58, yy + 0.008), UP);
      Q(bb, 'stainless', P(s0, 0.55, yy + 0.008), P(s0, 0.58, yy + 0.008), P(s1, 0.58, yy + 0.008), P(s1, 0.55, yy + 0.008), UP);
      // under the step band between comb and the end of the visible steps: dark pit
      Q(bb, 'steel_dark', P(sc0, -0.5, yy - 0.3), P(sc0, 0.5, yy - 0.3), P(sc1, 0.5, yy - 0.3), P(sc1, -0.5, yy - 0.3), UP);
    }
    // a soft light for the step band (one per lane)
    const pm = P(len / 2, 0, prof(len / 2) + 1.2);
    K.light({ level: r.lower, x: pm[0], y: pm[1], z: pm[2], color: 0xe8f0ff, intensity: 0.25, range: 5, kind: 'strip', len: len * 0.8, axis: r.axis });
  }

  _floorMat(lv, r) {
    const [x0, z0, x1, z1] = r.rect;
    for (const [x, z] of [[x0 - 0.5, (z0 + z1) / 2], [x1 + 0.5, (z0 + z1) / 2], [(x0 + x1) / 2, z0 - 0.5], [(x0 + x1) / 2, z1 + 0.5]]) {
      const c = this.K.cell(lv, x, z);
      if (c.t === CELL.WALK && c.sp) return styleOf(c.sp).floor;
    }
    return 'floor_tile_grey';
  }

  // ---------------------------------------------------------------------------
  _stairs(r, nb) {
    const K = this.K;
    const F = frameOf(r);
    const { len, P, U, prof } = F;
    const mid = P(len / 2, 0, F.yl);
    const b = K.B(r.lower, mid[0], mid[2]);
    const W = (r.axis === 'x' ? r.rect[3] - r.rect[1] : r.rect[2] - r.rect[0]);
    const hw = W / 2;
    const H = F.yu - F.yl;
    const flat = F.flat;
    const Linc = len - 2 * flat;
    const n = Math.max(2, Math.round(H / 0.165));
    const rh = H / n, g = Linc / n;
    const outdoorTop = (() => { const c = K.cell(r.upper, ...(() => { const p = P(len + 0.5, 0, 0); return [p[0], p[2]]; })()); return c.sp && c.sp.outdoor; })();
    const zoneMetro = WEDGE.has(r.zone);
    const tread = r.zone === 'parksGarden' ? 'floor_paving_warm' : outdoorTop ? 'floor_granite' : zoneMetro ? 'floor_terrazzo' : r.zone === 'city' ? 'floor_granite' : 'floor_terrazzo';
    const nosing = zoneMetro || outdoorTop ? 'esc_comb' : 'stainless';
    const UP = [0, 1, 0], T = F.T;
    const inner = hw - 0.12; // parapet inner face
    // landings
    for (const [s0, s1, yy, lv] of [[0, flat + 0.5 * g, F.yl, r.lower], [len - flat - 0.5 * g, len, F.yu, r.upper]]) {
      const bb = K.B(lv, mid[0], mid[2]);
      Q(bb, tread, P(s0, -hw, yy + 0.003), P(s0, hw, yy + 0.003), P(s1, hw, yy + 0.003), P(s1, -hw, yy + 0.003), UP);
    }
    // treads & risers
    for (let i = 1; i <= n; i++) {
      const sr = flat + (i - 0.5) * g;           // riser position
      const yb = F.yl + (i - 1) * rh, yt = F.yl + i * rh;
      const se = i < n ? sr + g : len - flat - 0.5 * g; // tread back
      Q(b, tread, P(sr, -inner, yb), P(sr, inner, yb), P(sr, inner, yt), P(sr, -inner, yt), neg(T));
      if (i < n) Q(b, tread, P(sr, -inner, yt), P(sr, inner, yt), P(se, inner, yt), P(se, -inner, yt), UP);
      // nosing strip
      Q(b, nosing, P(sr, -inner, yt + 0.002), P(sr, inner, yt + 0.002), P(sr + 0.05, inner, yt + 0.002), P(sr + 0.05, -inner, yt + 0.002), UP);
    }
    // soffit (visible from below in open halls)
    Q(b, 'concrete_exposed', P(flat, -hw, F.yl - 0.02), P(flat, hw, F.yl - 0.02), P(len - flat, hw, F.yu - 0.35), P(len - flat, -hw, F.yu - 0.35), [0, -1, 0]);
    // parapets + handrails on both sides
    const ss = [0, flat, len - flat, len];
    const lineY = (s) => s <= flat ? F.yl : s >= len - flat ? F.yu : F.yl + H * (s - flat) / Linc;
    for (const side of [-1, 1]) {
      const n_ = side < 0 ? U : neg(U), out = side < 0 ? neg(U) : U;
      const other = side < 0 ? nb.lo : nb.hi;
      const lowerN = (() => { const p = P(len * 0.3, side * (hw + 0.5), 0); return K.cell(r.lower, p[0], p[2]); })();
      const tunnel = !other && lowerN.t !== CELL.WALK;
      const wallMat = tunnel ? (styleOf(this._nearSpace(r)).wall || 'wall_tile_white') : (zoneMetro ? 'wall_tile_metro' : 'wall_stone_warm');
      if (tunnel) {
        // stairwell wall up to the soffit / street level
        // (1 cm proud of the footprint edge: the upper level's slab-edge cladding, surfaces.js, lies exactly on it)
        ribbon(b, wallMat, ss, s => P(s, side * (hw - 0.01), lineY(s) - 0.3), s => P(s, side * (hw - 0.01), Math.max(F.yl + 3.0, Math.min(F.yu + (outdoorTop ? 1.1 : 0), lineY(s) + 2.8))), n_);
      } else {
        // solid parapet 1.0 m above the nosing line, 0.12 thick
        ribbon(b, wallMat, ss, s => P(s, side * inner, lineY(s) - 0.05), s => P(s, side * inner, lineY(s) + 1.0), n_);
        ribbon(b, wallMat, ss, s => P(s, side * hw, (other ? lineY(s) - 0.4 : F.yl)), s => P(s, side * hw, lineY(s) + 1.0), out);
        ribbon(b, 'stainless', ss, s => P(s, side * inner, lineY(s) + 1.0), s => P(s, side * hw, lineY(s) + 1.0), UP);
      }
      // double handrails on brackets
      for (const hy of [0.85, 0.65]) {
        const path = [P(-0.3, side * (inner - 0.07), F.yl + hy)];
        for (const s of ss) path.push(P(s, side * (inner - 0.07), lineY(s) + hy));
        path.push(P(len + 0.3, side * (inner - 0.07), F.yu + hy));
        b.sweep('stainless', path, ring(0.02, 8), { up: U });
      }
      for (let s = 0.5; s < len; s += 1.5) {
        const p = P(s, side * (inner - 0.035), lineY(s) + 0.75);
        b.box('stainless', p[0], p[1], p[2], 0.03, 0.22, 0.03);
      }
    }
    // centre handrail for wide flights
    if (W >= 3.5) {
      for (const hy of [0.85, 0.65]) {
        const path = [];
        for (const s of [flat - 0.3, flat, len - flat, len - flat + 0.3]) path.push(P(s, 0, lineY(s) + hy));
        b.sweep('stainless', path, ring(0.02, 8), { up: U });
      }
      for (let s = flat; s <= len - flat + 0.01; s += 1.6) {
        const p = P(s, 0, lineY(s) + 0.43);
        b.box('stainless', p[0], p[1], p[2], 0.05, 0.86, 0.05);
      }
    }
    // stairwell soffit + street cover + canopy for exits that rise to the street
    // v6: only for a flight that climbs OUT of an indoor / underground space. The canyon -> garden stairs and the
    // terrace-to-terrace stairs (outdoor at both ends) got the street-exit kit too: a white grid-ceiling soffit with a
    // line light hanging in the open air over the flight, a paving "street cover" on the garden and a canopy.
    const bottomSp = this._nearSpace(r);
    if (outdoorTop && !(bottomSp && bottomSp.outdoor)) this._exitWell(r, F, hw, lineY);
  }

  _nearSpace(r) {
    const F = frameOf(r);
    const p = F.P(-0.5, 0, 0);
    const c = this.K.cell(r.lower, p[0], p[2]);
    return c.sp;
  }

  // exits to the street: sloped soffit over the flight under the street slab,
  // a paved cover at street level over that part, and a glass canopy over the
  // open part of the well (subway exit structure). Signs: wayfinding.
  _exitWell(r, F, hw, lineY) {
    const K = this.K;
    const { len, P } = F;
    const sp = this._nearSpace(r);
    const ceilL = F.yl + (sp ? sp.ceil : 3.0);
    const head = 2.7;
    // s where the soffit reaches the slab underside
    let sEnd = len;
    for (let s = 0; s <= len; s += 0.25) if (lineY(s) + head >= F.yu - 0.3) { sEnd = s; break; }
    let sStart = 0;
    for (let s = 0; s <= len; s += 0.25) if (lineY(s) + head >= ceilL) { sStart = s; break; }
    const mid = P(len / 2, 0, F.yl);
    const b = K.B(r.lower, mid[0], mid[2]);
    const yS = (s) => Math.max(ceilL, Math.min(F.yu - 0.3, lineY(s) + head));
    const st = styleOf(sp);
    const ceilMat = st.ceil || 'ceiling_grid';
    const ss = [0, sStart, sEnd];
    for (let i = 0; i < ss.length - 1; i++) {
      if (ss[i + 1] - ss[i] < 0.01) continue;
      Q(b, ceilMat, P(ss[i], -hw, yS(ss[i])), P(ss[i], hw, yS(ss[i])), P(ss[i + 1], hw, yS(ss[i + 1])), P(ss[i + 1], -hw, yS(ss[i + 1])), [0, -1, 0]);
    }
    // line lights down the soffit
    Q(b, 'light_line_cool', P(0.5, -0.08, yS(0.5) - 0.01), P(0.5, 0.08, yS(0.5) - 0.01), P(sEnd - 0.3, 0.08, yS(sEnd - 0.3) - 0.01), P(sEnd - 0.3, -0.08, yS(sEnd - 0.3) - 0.01), [0, -1, 0]);
    const lm = P(sEnd * 0.5, 0, yS(sEnd * 0.5));
    K.light({ level: r.lower, x: lm[0], y: lm[1] - 0.05, z: lm[2], color: 0xeef2fa, intensity: 1, range: 9, kind: 'strip', len: sEnd, axis: r.axis });
    // street-level cover slab over the covered part
    const bu = K.B(r.upper, mid[0], mid[2]);
    Q(bu, 'floor_paving', P(0, -hw, F.yu + 0.002), P(0, hw, F.yu + 0.002), P(sEnd, hw, F.yu + 0.002), P(sEnd, -hw, F.yu + 0.002), [0, 1, 0]);
    // end wall of the well under the cover
    Q(bu, 'wall_tile_white', P(sEnd, -hw, yS(sEnd)), P(sEnd, hw, yS(sEnd)), P(sEnd, hw, F.yu), P(sEnd, -hw, F.yu), F.T);
    // canopy over the open part: posts + glass roof at street + 2.7
    const yc = F.yu + 2.7;
    for (const [s, u] of [[sEnd, -hw], [sEnd, hw], [len, -hw], [len, hw]]) {
      const p = P(s, u * 0.97, 0);
      bu.box('steel_painted_grey', p[0], F.yu + 1.35, p[2], 0.12, 2.7, 0.12);
    }
    Q(bu, 'glass_frosted', P(sEnd - 0.2, -hw - 0.15, yc), P(sEnd - 0.2, hw + 0.15, yc), P(len + 0.3, hw + 0.15, yc), P(len + 0.3, -hw - 0.15, yc), [0, -1, 0]);
    const pc = P((sEnd + len) / 2, 0, yc);
    bu.box('steel_painted_grey', pc[0], yc + 0.08, pc[2], F.ax ? len - sEnd + 0.5 : 2 * hw + 0.4, 0.16, F.ax ? 2 * hw + 0.4 : len - sEnd + 0.5, 0, { faces: 'nsewt' });
    // canopy downlight
    Q(bu, 'light_line_cool', P(sEnd + 0.4, -0.1, yc - 0.01), P(sEnd + 0.4, 0.1, yc - 0.01), P(len - 0.2, 0.1, yc - 0.01), P(len - 0.2, -0.1, yc - 0.01), [0, -1, 0]);
    K.light({ level: r.upper, x: pc[0], y: yc - 0.05, z: pc[2], color: 0xeef2fa, intensity: 0.6, range: 7, kind: 'strip', len: len - sEnd, axis: r.axis });
    this.exitCanopies = this.exitCanopies || [];
    this.exitCanopies.push({ ramp: r.id, level: r.upper, x: pc[0], z: pc[2], y: yc, axis: r.axis, signFace: P(len + 0.3, 0, yc - 0.3), dir: F.T });
  }

  // v3: a pool of light on the floor at the foot of every indoor bank. From the top of a down
  // escalator the only part of the lower level you can see through the well is the floor just
  // beyond the foot; lit, it reads as a landing (not as "the ground"). Bake only (no geometry).
  _landingLights(lanes) {
    const K = this.K;
    const F = frameOf(lanes[0]);
    let u0 = Infinity, u1 = -Infinity;
    for (const r of lanes) {
      const c = r.axis === 'x' ? (r.rect[1] + r.rect[3]) / 2 : (r.rect[0] + r.rect[2]) / 2;
      const w = r.axis === 'x' ? r.rect[3] - r.rect[1] : r.rect[2] - r.rect[0];
      u0 = Math.min(u0, c - w / 2 - F.cc); u1 = Math.max(u1, c + w / 2 - F.cc);
    }
    const um = (u0 + u1) / 2;
    const p = F.P(-2.0, um, 0);
    const c = K.cell(lanes[0].lower, p[0], p[2]);
    if (c.t !== CELL.WALK || !c.sp || c.sp.outdoor) return;
    const st = styleOf(c.sp);
    const col = KELVIN[st.mood] || KELVIN.terminal;
    K.light({ level: lanes[0].lower, x: p[0], y: F.yl + Math.min(c.sp.ceil, F.yu - F.yl - 0.6) - 0.1, z: p[2], color: col, intensity: 0.9, range: 8, kind: 'down' });
  }

  // enclosure faces at the high end under the upper slab (wedge zones)
  _bankEnclosure(id, lanes) {
    const K = this.K;
    const r0 = lanes[0];
    if (!WEDGE.has(r0.zone)) return;
    const F = frameOf(r0);
    // the bank extent across
    let u0 = Infinity, u1 = -Infinity;
    for (const r of lanes) {
      const c = r.axis === 'x' ? (r.rect[1] + r.rect[3]) / 2 : (r.rect[0] + r.rect[2]) / 2;
      const w = r.axis === 'x' ? r.rect[3] - r.rect[1] : r.rect[2] - r.rect[0];
      u0 = Math.min(u0, c - w / 2 - F.cc); u1 = Math.max(u1, c + w / 2 - F.cc);
    }
    // face at the high end, on the lower level, from floor to lower ceiling
    const pe = F.P(F.len, 0, 0);
    const c = K.cell(r0.lower, pe[0] + F.T[0] * 0.5, pe[2] + F.T[2] * 0.5);
    if (c.t !== CELL.WALK || !c.sp) return;
    const top = Math.min(F.yu - 0.3, F.yl + c.sp.ceil);
    const b = K.B(r0.lower, pe[0], pe[2]);
    Q(b, styleOf(c.sp).wall, F.P(F.len, u0, F.yl), F.P(F.len, u1, F.yl), F.P(F.len, u1, top), F.P(F.len, u0, top), F.T);
    void id;
  }

  // ---------------------------------------------------------------------------
  _stepGeometry() {
    const gb = new GeoBatch();
    const Wd = 0.495;
    // tread (top), nose at z = -0.2 (towards the low end)
    gb.quad('s', [-Wd, 0, 0.2], [Wd, 0, 0.2], [Wd, 0, -0.2], [-Wd, 0, -0.2], { uv: [[0, 1], [1, 1], [1, 0.5], [0, 0.5]] });
    // riser facing -z
    gb.quad('s', [Wd, -0.215, -0.2], [-Wd, -0.215, -0.2], [-Wd, 0, -0.2], [Wd, 0, -0.2], { uv: [[1, 0], [0, 0], [0, 0.5], [1, 0.5]] });
    // sides
    gb.quad('s', [Wd, -0.215, -0.2], [Wd, 0, -0.2], [Wd, 0, 0.2], [Wd, -0.05, 0.2], { uv: [[0, 0], [0, 0.5], [0.4, 0.5], [0.4, 0.4]] });
    gb.quad('s', [-Wd, -0.215, -0.2], [-Wd, -0.05, 0.2], [-Wd, 0, 0.2], [-Wd, 0, -0.2], { uv: [[0, 0], [0.4, 0.4], [0.4, 0.5], [0, 0.5]] });
    // back edge
    gb.quad('s', [-Wd, -0.05, 0.2], [Wd, -0.05, 0.2], [Wd, 0, 0.2], [-Wd, 0, 0.2], { uv: [[0, 0.45], [1, 0.45], [1, 0.5], [0, 0.5]] });
    const fake = { get: () => new THREE.MeshBasicMaterial() };
    const m = gb.build(fake)[0];
    const g = m.geometry;
    g.deleteAttribute('color');
    return g;
  }

  _bankSteps(id, escs) {
    const K = this.K;
    const lanes = [];
    let count = 0;
    let cx = 0, cz = 0, cy = 0, rad = 0;
    for (const r of escs) {
      const F = frameOf(r);
      // arc length table of the tread-centre path
      const N = Math.ceil(F.len / 0.02);
      const S = new Float32Array(N + 1), A = new Float32Array(N + 1), Y = new Float32Array(N + 1);
      let a = 0;
      for (let i = 0; i <= N; i++) {
        const s = i / N * F.len, y = F.prof(s);
        if (i > 0) a += Math.hypot(s - S[i - 1], y - Y[i - 1]);
        S[i] = s; Y[i] = y; A[i] = a;
      }
      const aAt = (s) => A[Math.round(s / F.len * N)];
      const aMin = aAt(0.95) - 0.05, aMax = aAt(F.len - 0.95) + 0.05;
      const n = Math.ceil((aMax - aMin) / STEP) + 1;
      lanes.push({ r, F, S, A, Y, N, aMin, aMax, n, start: count, rot: F.ax ? (F.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (F.dir > 0 ? 0 : Math.PI) });
      count += n;
      const m = F.P(F.len / 2, 0, (F.yl + F.yu) / 2);
      cx += m[0]; cy += m[1]; cz += m[2];
      rad = Math.max(rad, F.len / 2 + 3);
    }
    cx /= escs.length; cy /= escs.length; cz /= escs.length;
    const mat = K.ctx.materials.get('esc_step');
    const mesh = new THREE.InstancedMesh(this.stepGeo, mat, count);
    mesh.name = `esc_steps:${id}`;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, cy, cz), rad + escs.length * 2);
    mesh.receiveShadow = true;
    const lv = escs[0].lower;
    const grp = new THREE.Group();
    grp.name = `esc:${id}`;
    grp.userData.chunk = { level: lv, x: cx, z: cz, r: rad + 4 };
    grp.add(mesh);
    K.ctx.engine.levelRoot(lv).add(grp);
    const bank = { id, mesh, lanes, level: lv, x: cx, y: cy, z: cz, group: grp };
    this.banks.push(bank);
    this._updateBank(bank, 0);
  }

  _updateBank(bank, t) {
    const arr = bank.mesh.instanceMatrix.array;
    for (const ln of bank.lanes) {
      const { F, S, A, Y, N, aMin, aMax, n, start, rot, r } = ln;
      const v = SPEED * (r.move || 0);
      const ring = n * STEP;
      const c = Math.cos(rot), s = Math.sin(rot);
      let j = 0; // monotonic search cursor
      const phase = ((t * v) % ring + ring) % ring;
      // positions in increasing arc order for a single forward search
      const first = Math.floor(((aMin - aMin - phase) / STEP)); void first;
      for (let k = 0; k < n; k++) {
        let a = aMin + ((k * STEP + phase) % ring);
        const o = (start + k) * 16;
        if (a > aMax) { for (let q = 0; q < 16; q++) arr[o + q] = 0; continue; }
        // binary search on A
        let lo = 0, hi = N;
        while (lo < hi) { const m = (lo + hi) >> 1; if (A[m] < a) lo = m + 1; else hi = m; }
        j = lo;
        const i0 = Math.max(0, j - 1), f = A[j] > A[i0] ? (a - A[i0]) / (A[j] - A[i0]) : 0;
        const sc = S[i0] + (S[j] - S[i0]) * f, yc = Y[i0] + (Y[j] - Y[i0]) * f;
        const p = F.P(sc, 0, yc);
        // rotation about Y: local +z -> ascent direction
        arr[o] = c; arr[o + 1] = 0; arr[o + 2] = -s; arr[o + 3] = 0;
        arr[o + 4] = 0; arr[o + 5] = 1; arr[o + 6] = 0; arr[o + 7] = 0;
        arr[o + 8] = s; arr[o + 9] = 0; arr[o + 10] = c; arr[o + 11] = 0;
        arr[o + 12] = p[0]; arr[o + 13] = p[1] - 0.004; arr[o + 14] = p[2]; arr[o + 15] = 1;
      }
    }
    bank.mesh.instanceMatrix.needsUpdate = true;
  }

  update(dt) {
    this.t += dt;
    const K = this.K;
    // handrails scroll (texture u = arc length in m / 1.0)
    if (this.handrailMats) {
      const d = SPEED * dt;
      const mu = this.handrailMats.up.map, md = this.handrailMats.down.map;
      if (mu) mu.offset.x = (mu.offset.x - d * mu.repeat.x) % 1;
      if (md) md.offset.x = (md.offset.x + d * md.repeat.x) % 1;
    }
    const cam = K.ctx.camera;
    if (!cam) return;
    const cp = cam.getWorldPosition ? cam.getWorldPosition(this._v || (this._v = new THREE.Vector3())) : cam.position;
    for (const bank of this.banks) {
      const root = K.ctx.engine.levelRoot(bank.level);
      if (!root.visible || !bank.group.visible) continue;
      const d = Math.hypot(cp.x - bank.x, cp.y - bank.y, cp.z - bank.z);
      if (d > 90) continue;
      this._updateBank(bank, this.t);
    }
  }
}

function ring(r, n) { const out = []; for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; out.push([Math.cos(a) * r, Math.sin(a) * r]); } return out; }
