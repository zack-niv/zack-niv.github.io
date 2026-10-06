// =============================================================================
// Ceiling systems. Each indoor space gets a ceiling program from its style:
//   grid       600 mm lay-in grid + 1200×300 troffers (passages)
//   metro      aluminium spandrel + continuous recessed linear lights (Osaka Metro)
//   arcade     NAMBAWALK: plaster, central raised coffer with cove light, line lights
//   mall       Namba CITY: plaster, central raised cove strip, downlight rows
//   court      courts: big raised coffer with cove, downlight ring, disc panels
//   downlights plaster with a downlight grid (depachika, department, plazas)
//   coffer     terminal halls: deep beam grid with square light panels
//   dining     dark ceiling, warm pendants
//   parks      timber slat ceiling, warm cove + downlights
//   room       plain (shops dress their own interiors)
// Every fixture is emissive geometry + a ctx.lighting.addLight() declaration.
// =============================================================================
import { CELL } from '../world.js';
import { styleOf } from './styles.js';
import { KELVIN } from './kit.js';
import { face } from './surfaces.js';
import { serviceKit } from './details.js';

// ceiling rect facing down; rot=true rotates the texture 90° (strips along z)
function ceilRect(b, mat, x0, z0, x1, z1, y, rot) {
  if (rot) b.rectH(mat, x0, z0, x1, z1, y, false, { uv: [[z0, x0], [z0, x1], [z1, x1], [z1, x0]] });
  else b.rectH(mat, x0, z0, x1, z1, y, false);
}
// emissive quad facing down
function lightQuad(b, mat, x0, z0, x1, z1, y, uv) { b.rectH(mat, x0, z0, x1, z1, y, false, uv ? { uv } : undefined); }
const UV01 = [[0, 0], [1, 0], [1, 1], [0, 1]];

export function buildCeilings(K) {
  const { world, L } = K;
  L.spaces.forEach((sp, si) => {
    if (sp.outdoor) return;
    const st = styleOf(sp);
    if (!st.ceilSys || !st.ceil) return;
    if (st.ceilSys === 'platform') return;                         // transit structure
    if (sp.style === 'terminal_concourse' && sp.ceil >= 8) return;  // trussed roof (transit structure)
    const lv = sp.level, g = world.grids[lv];
    if (!g) return;
    const y = K.y(lv), H = y + sp.ceil;
    const up = K.above(lv);
    const has = (x, z) => { const c = K.cell(lv, x, z); return c.si === si && c.t === CELL.WALK && !(up && K.isHole(up, x, z)); };
    const [bx0, bz0, bx1, bz1] = sp.rect || polyBounds(sp.poly);
    const W = bx1 - bx0, D = bz1 - bz0;
    const axis = W >= D ? 'x' : 'z';
    const midL = axis === 'x' ? (bz0 + bz1) / 2 : (bx0 + bx1) / 2; // lateral centre
    const A0 = axis === 'x' ? bx0 : bz0, A1 = axis === 'x' ? bx1 : bz1;
    const wide = axis === 'x' ? D : W;
    const mood = st.mood, col = KELVIN[mood] || 0xffffff;
    // raised zones: f(x,z) -> extra height (0 = base)
    let raise = () => 0;
    const prog = st.ceilSys;
    let coffer = null;
    if ((prog === 'arcade' && wide >= 7) || (prog === 'mall' && wide >= 8)) {
      const cw = prog === 'arcade' ? 3.0 : 3.6, rise = prog === 'arcade' ? 0.35 : 0.45;
      coffer = { lo: midL - cw / 2, hi: midL + cw / 2, rise };
      raise = (x, z) => { const l = axis === 'x' ? z : x; return l > coffer.lo && l < coffer.hi ? rise : 0; };
    } else if (prog === 'court') {
      const ins = Math.min(3, Math.min(W, D) / 4);
      raise = (x, z) => (x > bx0 + ins && x < bx1 - ins && z > bz0 + ins && z < bz1 - ins) ? 0.8 : 0;
    }
    // never raise a coffer into the floor slab of the level above (it pokes through into the shops up there)
    {
      const upl = K.above(lv);
      const cap = upl ? Math.max(0, K.y(upl) - H - 0.2) : Infinity;
      if (cap < 5) {
        const r0 = raise;
        raise = (x, z) => Math.min(r0(x, z), cap);
        if (coffer) coffer.rise = Math.min(coffer.rise, cap);
      }
    }
    // ---- base surfaces (row runs by height) ---------------------------------------
    const rot = prog === 'metro' && axis === 'z';
    for (let z = Math.floor(bz0); z < bz1; z++) {
      let run = null;
      const flush = (xe) => { if (run) { ceilRect(K.B(lv, (run.x + xe) / 2, z), st.ceil, run.x, z, xe, z + 1, H + run.r, rot); run = null; } };
      for (let x = Math.floor(bx0); x <= bx1; x++) {
        const ok = x < bx1 && has(x + 0.5, z + 0.5);
        const r = ok ? raise(x + 0.5, z + 0.5) : -1;
        if (run && r === run.r) continue;
        flush(x);
        if (ok) run = { x, r };
      }
      flush(Math.ceil(bx1));
    }
    // vertical faces where the raised zone steps (with cove light)
    if (prog === 'arcade' || prog === 'mall' || prog === 'court') {
      for (let z = Math.floor(bz0); z < bz1; z++) for (let x = Math.floor(bx0); x < bx1; x++) {
        if (!has(x + 0.5, z + 0.5)) continue;
        const r0 = raise(x + 0.5, z + 0.5);
        for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
          const xn = x + 0.5 + dx, zn = z + 0.5 + dz;
          if (!has(xn, zn)) continue;
          const r1 = raise(xn, zn);
          if (r1 <= r0) continue;
          // face on the boundary, facing into the low cell (-dx,-dz)... we are low
          const ex = x + 0.5 + dx * 0.5, ez = z + 0.5 + dz * 0.5;
          const [ax, az, bx, bz] = dx ? [ex, z, ex, z + 1] : [x, ez, x + 1, ez];
          const b = K.B(lv, ex, ez);
          // the step face faces into the raised (high) cell
          face(b, 'ceiling_plaster', ax, az, bx, bz, H + r0, H + r1, dx, dz, 0);
          // cove: glowing band tucked behind a lip on the low side
          const cove = sp.id === 'walk_main' ? (ex < 30 ? 'light_cove_green' : ex < 120 ? 'light_cove_orange' : 'light_cove_blue') : mood === 'mall' || mood === 'arcade' ? 'light_cove_warm' : 'light_cove_cool';
          face(b, cove, ax, az, bx, bz, H + r1 - 0.14, H + r1 - 0.02, dx, dz, 0.02);
        }
      }
    }
    // ---- fixtures ------------------------------------------------------------------
    const fx = (fn) => fn();
    const along = (step, off = 0) => { const out = []; for (let p = Math.ceil((A0 - off) / step) * step + off; p < A1; p += step) out.push(p); return out; };
    const at = (a, l) => axis === 'x' ? [a, l] : [l, a];
    // continuous line light along the axis at lateral l; registers strip lights
    const line = (l, w, mat, yy, kind = 'strip', inten = 1) => {
      const rs = K.runs(lv, axis, l, A0, A1, (c, p) => { const [x, z] = at(p + 0.5, l); return has(x, z); });
      for (const [a, c] of rs) {
        const a0 = a + 0.3, c0 = c - 0.3;
        if (c0 - a0 < 0.5) continue;
        const [x0, z0] = at(a0, l - w / 2), [x1, z1] = at(c0, l + w / 2);
        const b = K.B(lv, (x0 + x1) / 2, (z0 + z1) / 2);
        lightQuad(b, mat, Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1), yy - 0.004);
        // aluminium trim
        const [tx0, tz0] = at(a0, l - w / 2 - 0.04), [tx1, tz1] = at(c0, l - w / 2);
        b.rectH('aluminium', Math.min(tx0, tx1), Math.min(tz0, tz1), Math.max(tx0, tx1), Math.max(tz0, tz1), yy - 0.003, false);
        const [ux0, uz0] = at(a0, l + w / 2), [ux1, uz1] = at(c0, l + w / 2 + 0.04);
        b.rectH('aluminium', Math.min(ux0, ux1), Math.min(uz0, uz1), Math.max(ux0, ux1), Math.max(uz0, uz1), yy - 0.003, false);
        for (let s = a0; s < c0; s += 10) {
          const e = Math.min(c0, s + 10), [lx, lz] = at((s + e) / 2, l);
          K.light({ level: lv, x: lx, y: yy - 0.05, z: lz, color: col, intensity: inten * (e - s) / 10, range: 9, kind, len: e - s, axis });
        }
      }
    };
    const downlight = (x, z, yy, mat, r = 0.11, reg = true, inten = 0.5) => {
      if (!has(x, z)) return;
      const b = K.B(lv, x, z);
      lightQuad(b, mat, x - r, z - r, x + r, z + r, yy - 0.004, UV01);
      if (reg) K.light({ level: lv, x, y: yy - 0.05, z, color: col, intensity: inten, range: 7, kind: 'down' });
    };
    const troffer = (x, z, lx, lz, yy, mat, reg) => {
      if (!has(x, z)) return;
      const b = K.B(lv, x, z);
      b.box('aluminium', x, yy - 0.015, z, lx + 0.06, 0.03, lz + 0.06, 0, { faces: 'nsewb' });
      lightQuad(b, mat, x - lx / 2, z - lz / 2, x + lx / 2, z + lz / 2, yy - 0.032, UV01);
      if (reg) K.light({ level: lv, x, y: yy - 0.1, z, color: col, intensity: 0.8, range: 8, kind: 'panel' });
    };
    const lines = (n, pitch) => { const out = []; for (let i = 0; i < n; i++) out.push(midL + (i - (n - 1) / 2) * pitch); return out; };
    const lightLine = mood === 'metro' ? 'light_line_cool' : mood === 'passage' || mood === 'terminal' ? 'light_line_neutral' : 'light_line_warm';
    const downMat = mood === 'mall' || mood === 'depachika' || mood === 'parks' || mood === 'dining' ? 'light_down_warm' : 'light_down_neutral';

    switch (prog) {
      case 'grid': fx(() => {
        const rows = wide <= 6 ? [midL] : wide <= 12 ? lines(2, wide / 2) : lines(Math.floor(wide / 3.6), 3.6);
        let k = 0;
        for (const l of rows) for (const a of along(2.4, 0.6)) {
          const [x, z] = at(a, l);
          const [lx, lz] = axis === 'x' ? [1.2, 0.3] : [0.3, 1.2];
          troffer(x, z, lx, lz, H, 'light_troffer', (k++ % 2) === 0);
        }
      }); break;
      case 'metro': fx(() => {
        const n = Math.max(1, Math.round(wide / 3.6));
        for (const l of lines(n, wide / n)) line(l, 0.2, 'light_line_cool', H, 'strip', 1.2);
      }); break;
      case 'arcade': fx(() => {
        if (coffer) {
          line(midL, 0.14, 'light_line_neutral', H + coffer.rise, 'strip', 0.9);
          for (const o of [-3.0, 3.0]) if (Math.abs(o) < wide / 2 - 0.6) line(midL + o, 0.1, 'light_line_neutral', H, 'strip', 0.6);
        } else line(midL, 0.12, 'light_line_neutral', H, 'strip', 1);
      }); break;
      case 'mall': fx(() => {
        if (wide <= 14) {
          for (const o of [-3.2, 3.2]) if (Math.abs(o) < wide / 2 - 0.5) for (const a of along(2.4, 1.2)) { const [x, z] = at(a, midL + o); downlight(x, z, H, downMat, 0.1, Math.round(a / 2.4) % 2 === 0); }
          if (coffer) line(midL, 0.12, 'light_line_warm', H + coffer.rise, 'strip', 0.6);
          // continuous edge coves 0.5 m off the shopfronts
          for (const o of [-(wide / 2 - 0.5), wide / 2 - 0.5]) if (wide >= 8) line(midL + o, 0.1, 'light_line_warm', H, 'strip', 0.45);
        } else for (let x = Math.ceil(bx0 / 2.4) * 2.4 + 1.2; x < bx1; x += 2.4) for (let z = Math.ceil(bz0 / 2.4) * 2.4 + 1.2; z < bz1; z += 2.4) downlight(x, z, H + raise(x, z), downMat, 0.1, (Math.round(x / 2.4) + Math.round(z / 2.4)) % 2 === 0);
      }); break;
      case 'court': fx(() => {
        for (let x = Math.ceil(bx0 / 2.4) * 2.4 + 1.2; x < bx1; x += 2.4) for (let z = Math.ceil(bz0 / 2.4) * 2.4 + 1.2; z < bz1; z += 2.4) {
          const r = raise(x, z);
          if (r > 0) downlight(x, z, H + r, 'light_troffer_warm', 0.45, true, 1.0);
          else downlight(x, z, H, downMat, 0.1, (Math.round(x / 2.4) + Math.round(z / 2.4)) % 2 === 0);
        }
      }); break;
      case 'downlights': fx(() => {
        if (mood === 'depachika' && wide > 14) { const n = Math.floor(wide / 7.2); for (const l of lines(n, wide / n)) line(l, 0.2, 'light_line_warm', H, 'strip', 0.55); }
        // stone-white beams between the columns (grid lines through every column) with a lit cove underside
        if (st.col && K.columns) {
          const cs = K.columns.filter(c => c.space === sp.id);
          const drop = sp.ceil < 3.2 ? 0.28 : 0.42;
          const seg = (x0, z0, x1, z1) => {
            const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
            if (!has(mx, mz)) return;
            const bb = K.B(lv, mx, mz);
            const len = Math.hypot(x1 - x0, z1 - z0);
            if (x0 === x1) { bb.box('wall_panel_white', mx, H - drop / 2, mz, 0.55, drop, len, 0, { faces: 'ewb' }); bb.rectH('light_line_warm', mx - 0.05, z0 + 0.5, mx + 0.05, z1 - 0.5, H - drop - 0.004, false); }
            else { bb.box('wall_panel_white', mx, H - drop / 2, mz, len, drop, 0.55, 0, { faces: 'nsb' }); bb.rectH('light_line_warm', x0 + 0.5, mz - 0.05, x1 - 0.5, mz + 0.05, H - drop - 0.004, false); }
          };
          for (const c of cs) {
            const nxt = cs.filter(o => o !== c && o.z === c.z && o.x > c.x && o.x - c.x < 11).sort((a, b) => a.x - b.x)[0];
            if (nxt) seg(c.x + c.hx, c.z, nxt.x - nxt.hx, c.z);
            const nzt = cs.filter(o => o !== c && o.x === c.x && o.z > c.z && o.z - c.z < 11).sort((a, b) => a.z - b.z)[0];
            if (nzt) seg(c.x, c.z + c.hz, c.x, nzt.z - nzt.hz);
          }
        }
        const p = mood === 'depachika' ? 1.8 : 2.4;
        for (let x = Math.ceil(bx0 / p) * p + p / 2; x < bx1; x += p) for (let z = Math.ceil(bz0 / p) * p + p / 2; z < bz1; z += p) downlight(x, z, H, downMat, mood === 'depachika' ? 0.09 : 0.11, (Math.round(x / p) % 2 === 0) && (Math.round(z / p) % 2 === 0), mood === 'depachika' ? 1.0 : 0.6);
      }); break;
      case 'coffer': fx(() => {
        // deep beam grid every 6 m both ways, square light panels in each coffer
        const P = 6, bw = 0.5, bd = Math.min(0.7, sp.ceil * 0.12);
        const gx0 = bx0 + ((W % P) / 2), gz0 = bz0 + ((D % P) / 2);
        for (let x = gx0; x <= bx1 + 1e-6; x += P) {
          const rs = K.runs(lv, 'z', x, bz0, bz1, (c, p) => has(x - 0.3, p + 0.5) && has(x + 0.3, p + 0.5));
          for (const [a, c] of rs) { const b = K.B(lv, x, (a + c) / 2); b.box('ceiling_plaster', x, H - bd / 2, (a + c) / 2, bw, bd, c - a, 0, { faces: 'ewb' }); }
        }
        for (let z = gz0; z <= bz1 + 1e-6; z += P) {
          const rs = K.runs(lv, 'x', z, bx0, bx1, (c, p) => has(p + 0.5, z - 0.3) && has(p + 0.5, z + 0.3));
          for (const [a, c] of rs) { const b = K.B(lv, (a + c) / 2, z); b.box('ceiling_plaster', (a + c) / 2, H - bd / 2, z, c - a, bd, bw, 0, { faces: 'nsb' }); }
        }
        for (let x = gx0 + P / 2; x < bx1; x += P) for (let z = gz0 + P / 2; z < bz1; z += P) {
          if (!has(x - 1, z - 1) || !has(x + 1, z + 1) || !has(x - 1, z + 1) || !has(x + 1, z - 1)) continue;
          troffer(x, z, 2.4, 2.4, H, 'light_troffer', true);
        }
      }); break;
      case 'dining': fx(() => {
        for (const a of along(3.0, 1.5)) {
          const [x, z] = at(a, midL);
          if (!has(x, z)) continue;
          const b = K.B(lv, x, z);
          const yb = H - 1.0;
          b.box('rubber_black', x, (yb + H) / 2, z, 0.012, H - yb, 0.012);
          b.cylinder('steel_painted_dark', x, z, 0.22, yb, yb + 0.28, 10, { caps: 1 });
          b.rectH('light_pendant', x - 0.16, z - 0.16, x + 0.16, z + 0.16, yb + 0.005, false, { uv: UV01 });
          K.light({ level: lv, x, y: yb - 0.1, z, color: KELVIN.dining, intensity: 0.7, range: 6, kind: 'lamp' });
        }
        for (const o of [-(wide / 2 - 1.2), wide / 2 - 1.2]) for (const a of along(2.0, 1.0)) { const [x, z] = at(a, midL + o); downlight(x, z, H, 'light_down_warm', 0.08, false); }
      }); break;
      case 'parks': fx(() => {
        for (const o of wide > 6 ? [-(wide / 2 - 1.5), wide / 2 - 1.5] : [0]) for (const a of along(2.4, 1.2)) { const [x, z] = at(a, midL + o); downlight(x, z, H, 'light_down_warm', 0.1, Math.round(a / 2.4) % 2 === 0, 0.6); }
        if (wide > 6) line(midL, 0.12, 'light_line_warm', H, 'strip', 0.6);
      }); break;
      default: break;
    }
    serviceKit(K, { lv, sp, H, has, raise, bx0, bz0, bx1, bz1 });
  });
  // ---- ceilings over ramp wells on their upper level (indoor) -------------------------
  for (const r of L.ramps) {
    const lv = r.upper, y = K.y(lv);
    const [x0, z0, x1, z1] = r.rect;
    // the upper level's ceiling around the footprint
    let best = null;
    for (let x = x0 - 1; x <= x1; x++) for (const z of [z0 - 1, z1]) { const c = K.cell(lv, x + 0.5, z + 0.5); if (c.t === CELL.WALK && c.sp && !c.sp.outdoor) best = best && best.ceil >= c.sp.ceil ? best : c.sp; }
    for (let z = z0 - 1; z <= z1; z++) for (const x of [x0 - 1, x1]) { const c = K.cell(lv, x + 0.5, z + 0.5); if (c.t === CELL.WALK && c.sp && !c.sp.outdoor) best = best && best.ceil >= c.sp.ceil ? best : c.sp; }
    if (!best) continue;
    const st = styleOf(best);
    if (!st.ceil || (best.style === 'terminal_concourse' && best.ceil >= 8)) continue;
    const upl = K.above(lv);
    for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
      if (upl && K.isHole(upl, x + 0.5, z + 0.5)) continue;
      K.B(lv, x + 0.5, z + 0.5).rectH(st.ceil, x, z, x + 1, z + 1, y + best.ceil, false);
    }
  }
}

function polyBounds(poly) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of poly) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
  return [Math.floor(x0), Math.floor(z0), Math.ceil(x1), Math.ceil(z1)];
}
