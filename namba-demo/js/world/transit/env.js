// =============================================================================
// Track environment: rails/sleepers/third rail, ceilings over the track pits,
// subway tunnel extensions (with lamps), Nankai shed roof + viaduct +
// catenary + buffer stops, platform screen doors, floor markings.
// Static geometry is batched per (level, 48 m chunk, material).
// =============================================================================
import * as THREE from 'three';
import { GeoBatch } from '../../render/geobatch.js?v=6c67dba';
import { MB } from './mesh.js?v=6c67dba';


export class ChunkBatches {
  constructor(size = 160) { this.map = new Map(); this.size = size; }
  get(level, x, z) {
    const CHUNK = this.size;
    const k = `${level}|${Math.floor(x / CHUNK)}|${Math.floor(z / CHUNK)}`;
    let b = this.map.get(k); if (!b) this.map.set(k, b = new GeoBatch());
    return b;
  }
  build(ctx, name) {
    const CHUNK = this.size;
    for (const [k, b] of this.map) {
      const [lv, cx, cz] = k.split('|');
      const grp = new THREE.Group(); grp.name = `${name}:${k}`;
      grp.userData.chunk = { level: lv, x: (+cx + 0.5) * CHUNK, z: (+cz + 0.5) * CHUNK, r: CHUNK * 0.75 };
      for (const m of b.build(ctx.materials, { name })) grp.add(m);
      ctx.engine.levelRoot(lv).add(grp);
    }
    this.map.clear();
  }
}

// helpers that work in "track space": along coordinate s, cross coordinate c
// (for axis 'z': x = c, z = s; for axis 'x': x = s, z = c)
export function TS(cfg) {
  const ax = cfg.axis;
  return {
    P: (s, y, c) => ax === 'z' ? [c, y, s] : [s, y, c],
    box: (b, mat, s, y, c, ls, ly, lc, opt) => ax === 'z' ? b.box(mat, c, y, s, lc, ly, ls, 0, opt) : b.box(mat, s, y, c, ls, ly, lc, 0, opt),
    xz: (s, c) => ax === 'z' ? [c, s] : [s, c],
  };
}

export function defineEnvMaterials(ctx) {
  const M = ctx.materials;
  const std = (o) => () => new THREE.MeshStandardMaterial(o);
  M.define('transit_tunnel', std({ color: 0x5a5b5c, roughness: 0.92, metalness: 0.0 }));
  M.define('transit_tunnel_dark', std({ color: 0x232425, roughness: 0.95 }));
  M.define('transit_black', () => { const m = new THREE.MeshBasicMaterial({ color: 0x010101 }); m.userData.nbUnlit = true; return m; });
  M.define('transit_lamp', () => new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.93, 0.8).multiplyScalar(5) }));
  M.define('transit_lamp_cool', () => new THREE.MeshBasicMaterial({ color: new THREE.Color(0.85, 0.95, 1.0).multiplyScalar(6) }));
  M.define('transit_red_lamp', () => new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.08, 0.05).multiplyScalar(4) }));
  M.define('transit_buffer_red', std({ color: 0xc2201a, roughness: 0.5, metalness: 0.3 }));
  M.define('transit_cable', std({ color: 0x1a1a1a, roughness: 0.7, metalness: 0.2 }));
  M.define('transit_wire', std({ color: 0x8a5a2a, roughness: 0.4, metalness: 0.9 }));
  M.define('transit_3rail_cover', std({ color: 0x9a8f72, roughness: 0.8 }));
  M.define('transit_psd_body', std({ color: 0xe9ebec, roughness: 0.35, metalness: 0.25 }));
  M.define('transit_psd_cap', std({ color: 0x55595f, roughness: 0.4, metalness: 0.6 }));
  M.define('transit_psd_red', std({ color: 0xe5171f, roughness: 0.4, metalness: 0.1 }));
  M.define('transit_psd_pink', std({ color: 0xe44d93, roughness: 0.4, metalness: 0.1 }));
  M.define('transit_decal', () => {
    const m = new THREE.MeshStandardMaterial({ map: ctx.transit._decals.tex, transparent: true, roughness: 0.55, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    return m;
  });
  M.define('transit_catenary_steel', std({ color: 0x6f757c, roughness: 0.5, metalness: 0.6 }));
  M.define('transit_concrete', std({ color: 0x9d9a94, roughness: 0.85 }));
}

// -----------------------------------------------------------------------------
// ?oldpit reproduces the v1 pits (3 m ballast strip, no bed) for before/after screenshots only
const OLD_PIT = typeof location !== 'undefined' && /[?&]oldpit\b/.test(location.search);
export function buildTrackEnv(ctx, cfgs) {
  const CB = new ChunkBatches(320);
  const step0 = 12;
  const lights = ctx.lighting;
  for (const cfg of cfgs) {
    const { t, line, y, centre, inward } = cfg;
    const T = TS(cfg);
    const [v0, v1] = cfg.visRange;      // along extent incl. tunnels / viaduct
    const [r0, r1] = cfg.trackRange;    // track rect along extent
    const [c0, c1] = cfg.crossRange;    // track rect cross extent
    const g2 = line.gauge / 2 + 0.035;
    const yRail = y - 0.925;
    const bAt = (s) => { const [x, z] = T.xz(s, centre); return CB.get(t.level, x, z); };
    // solid pit bed extents (cross axis): the full track rect, +0.65 m under the platform edge, +0.1 m into the far wall
    const pitLo = Math.min(c0, c1), pitHi = Math.max(c0, c1);
    const bedLo = inward > 0 ? pitLo - 0.1 : pitLo - 0.65, bedHi = inward > 0 ? pitHi + 0.65 : pitHi + 0.1;
    const bedC = OLD_PIT ? centre : (bedLo + bedHi) / 2, bedW = OLD_PIT ? 3.0 : bedHi - bedLo;
    // ---- solid pit floor + dark underside + end wall (v2 item 1) ------------------------------------
    if (!OLD_PIT) {
      const yb = y - 1.12;                 // underside of the bed (just below the ballast / slab top)
      const a0 = Math.max(r0, v0), a1 = Math.min(r1, v1);
      const metro = line.operator === 'metro';
      for (let s = a0; s < a1; s += step0) {
        const s1 = Math.min(a1, s + step0), b = bAt((s + s1) / 2);
        const A = T.P(s, yb, bedLo), B = T.P(s1, yb, bedLo), C = T.P(s1, yb, bedHi), D = T.P(s, yb, bedHi);
        // dark underside, seen from the level below (two-sided so winding never matters)
        b.quad('transit_tunnel_dark', A, B, C, D); b.quad('transit_tunnel_dark', A, D, C, B);
        if (metro) {
          // station-section pit floor of the subway (the tubes beyond already have their own floor)
          const yf = y - 1.08;
          const a = T.P(s, yf, bedLo), bb = T.P(s1, yf, bedLo), c = T.P(s1, yf, bedHi), d = T.P(s, yf, bedHi);
          b.quad('transit_tunnel_dark', a, bb, c, d); b.quad('transit_tunnel_dark', a, d, c, bb);
        }
      }
      // end wall at the buffer / back end of the pit, from the bed up to the platform level and a little above
      if (!metro) {
        // the platform-edge recess that architecture draws at the back of the pit (0.55 m under the concourse floor)
        {
          const b = bAt(r0), yf = y - 1.1;
          const A = T.P(r0 - 0.7, yf, bedLo), B = T.P(r0, yf, bedLo), C = T.P(r0, yf, bedHi), D = T.P(r0 - 0.7, yf, bedHi);
          b.quad('transit_tunnel_dark', A, B, C, D); b.quad('transit_tunnel_dark', A, D, C, B);
        }
        const e = r0 + 0.04, b = bAt(e), yt = y + 0.0;
        const A = T.P(e, yb, bedLo), B = T.P(e, yb, bedHi), C = T.P(e, yt, bedHi), D = T.P(e, yt, bedLo);
        b.quad('transit_concrete', A, B, C, D); b.quad('transit_concrete', A, D, C, B);
      }
    }
    // ---- rails, slab / sleepers ----------------------------------------------------
    const step = 12;
    for (let s = v0; s < v1; s += step) {
      const s1 = Math.min(v1, s + step), sm = (s + s1) / 2, len = s1 - s;
      const b = bAt(sm);
      for (const sd of [-1, 1]) {
        T.box(b, 'rail_steel', sm, yRail - 0.07, centre + sd * g2, len, 0.14, 0.065);
        T.box(b, 'rail_steel', sm, yRail - 0.14, centre + sd * g2, len, 0.02, 0.14, { faces: 't' });
      }
      if (line.operator === 'metro') {
        // concrete slab track with embedded sleeper blocks + drainage channel
        T.box(b, 'track_slab', sm, y - 1.07, centre, len, 0.06, 2.9, { faces: 'tnsew' });
        for (let q = s + 0.3; q < s1; q += 0.62) for (const sd of [-1, 1]) T.box(b, 'sleeper', q, yRail - 0.2, centre + sd * g2, 0.26, 0.08, 0.62, { faces: 'tnsew' });
        // third rail on the far side from the platform
        const c3 = centre - inward * 1.5;
        T.box(b, 'steel_dark', sm, yRail + 0.04, c3, len, 0.09, 0.08);
        T.box(b, 'transit_3rail_cover', sm, yRail + 0.15, c3 - inward * 0.02, len, 0.025, 0.26, { faces: 'tbnsew' });
        for (let q = s + 2.5; q < s1; q += 5) T.box(b, 'steel_dark', q, yRail - 0.05, c3, 0.12, 0.25, 0.12);
      } else {
        // ballasted track, concrete sleepers. The ballast bed spans the WHOLE pit (v2 item 1: the old 3 m strip left
        // 2 m of open pit through which the level below showed), and runs 0.65 m under the platform lip so the
        // refuge recess is sealed too.
        T.box(b, 'ballast', sm, y - 1.06, bedC, len, 0.12, bedW, { faces: 'tnsew' });
        for (let q = s + 0.3; q < s1; q += 0.6) T.box(b, 'sleeper', q, yRail - 0.24, centre, 0.22, 0.16, 2.3, { faces: 'tnsew' });
      }
    }
    // ---- subway: ceiling over the pit + tunnel tubes beyond the platform -------------------
    if (line.operator === 'metro') {
      const ceil = y + cfg.platformCeil;
      const lo = Math.min(c0, c1), hi = Math.max(c0, c1);
      // station section ceiling (over the track rect)
      for (let s = r0; s < r1; s += step) {
        const s1 = Math.min(r1, s + step);
        const b = bAt((s + s1) / 2);
        const a = T.P(s, ceil, lo), bb = T.P(s1, ceil, lo), c = T.P(s1, ceil, hi), d = T.P(s, ceil, hi);
        b.quad('ceiling_metal', a, d, c, bb); b.quad('transit_tunnel_dark', a, bb, c, d);
        // cable trays on the tunnel wall
        const cw = centre - inward * 2.75;
        T.box(b, 'transit_cable', (s + s1) / 2, y + 2.6, cw, s1 - s, 0.06, 0.25);
        T.box(b, 'transit_cable', (s + s1) / 2, y + 2.2, cw, s1 - s, 0.05, 0.2);
      }
      // tubes: from the platform end outward on both sides
      const [p0, p1] = cfg.platformRange;
      const tubeH = cfg.platformCeil - 0.2;
      const tubes = [[v0, p0], [p1, v1]];
      tubes.forEach(([a, b2], ti) => {
        for (let s = a; s < b2; s += step) {
          const s1 = Math.min(b2, s + step), sm = (s + s1) / 2;
          const b = bAt(sm);
          // floor between rails and walls (dark ballast/concrete)
          const fl = T.P(s, y - 1.1, lo), fr = T.P(s1, y - 1.1, lo), fh = T.P(s1, y - 1.1, hi), fk = T.P(s, y - 1.1, hi);
          b.quad('transit_tunnel_dark', fl, fk, fh, fr); b.quad('transit_tunnel_dark', fl, fr, fh, fk);
          // walls (both faces so orientation never matters), ceiling
          for (const cc of [lo, hi]) {
            const outerSide = (cc === lo) === (inward > 0); // outer wall (away from platform) is on the -inward side
            if (outerSide && s1 <= r1 && s >= r0) continue; // architecture draws the back wall inside the station box
            const A = T.P(s, y - 1.1, cc), Bq = T.P(s1, y - 1.1, cc), C = T.P(s1, y + tubeH, cc), D = T.P(s, y + tubeH, cc);
            b.quad('transit_tunnel', A, Bq, C, D); b.quad('transit_tunnel', A, D, C, Bq);
          }
          const A = T.P(s, y + tubeH, lo), Bq = T.P(s1, y + tubeH, lo), C = T.P(s1, y + tubeH, hi), D = T.P(s, y + tubeH, hi);
          b.quad('transit_tunnel_dark', A, D, C, Bq); b.quad('transit_tunnel_dark', A, Bq, C, D);
          // cables, refuge niches, lamps
          const cw = centre - inward * 2.75;
          T.box(b, 'transit_cable', sm, y + 2.4, cw, s1 - s, 0.06, 0.25);
          T.box(b, 'transit_cable', sm, y + 2.0, cw, s1 - s, 0.05, 0.2);
          T.box(b, 'transit_cable', sm, y + 1.6, cw, s1 - s, 0.05, 0.2);
        }
        // lamps every 10 m on the outer wall (bulkhead fittings) + ceiling line
        const dir = ti === 0 ? -1 : 1, start = ti === 0 ? p0 : p1, end = ti === 0 ? v0 : v1;
        for (let s = start + dir * 6, k = 0; dir * (end - s) > 3; s += dir * 10, k++) {
          const b = bAt(s);
          const cw = centre - inward * 2.85;
          T.box(b, 'transit_lamp', s, y + 2.9, cw, 0.5, 0.1, 0.08);
          T.box(b, 'steel_dark', s, y + 2.9, cw - inward * 0.04, 0.6, 0.16, 0.05);
          if (k % 3 === 0) { const [lx, lz] = T.xz(s, cw); lights.addLight({ level: t.level, x: lx, y: y + 2.9, z: lz, color: 0xffe2b0, intensity: 0.25, range: 6, kind: 'lamp' }); }
          // green/red signal before the platform on the approach side
        }
        // end cap
        const e = ti === 0 ? v0 : v1;
        const b = bAt(e);
        const A = T.P(e, y - 1.1, lo), Bq = T.P(e, y - 1.1, hi), C = T.P(e, y + tubeH, hi), D = T.P(e, y + tubeH, lo);
        b.quad('transit_black', A, Bq, C, D); b.quad('transit_black', A, D, C, Bq);
      });
      // signal heads at the departure end of the platform (red/green lamps)
      {
        const sEnd = cfg.hDep > 0 ? p1 + 4 : p0 - 4;
        const b = bAt(sEnd);
        const cw = centre - inward * 2.6;
        T.box(b, 'steel_dark', sEnd, y + 2.6, cw, 0.3, 0.8, 0.3);
        T.box(b, 'transit_red_lamp', sEnd - cfg.hDep * 0.16, y + 2.8, cw, 0.02, 0.14, 0.14);
      }
    } else {
      // ---- Nankai: roof over the pits, viaduct beyond, catenary, buffer stops -----------------
      const lo = Math.min(c0, c1), hi = Math.max(c0, c1);
      const roofY = y + cfg.platformCeil;
      const shedEnd = cfg.platformRange[1];
      for (let s = r0; s < shedEnd; s += step) {
        const s1 = Math.min(shedEnd, s + step);
        const b = bAt((s + s1) / 2);
        const a = T.P(s, roofY, lo), bb = T.P(s1, roofY, lo), c = T.P(s1, roofY, hi), d = T.P(s, roofY, hi);
        b.quad('arch_vault', a, d, c, bb);
        b.quad('roof_deck', a, bb, c, d);
        // continuous cool-white LED / skylight band over the train (Nankai Namba's bright shed)
        for (let q = s + 1; q < s1 - 1.5; q += 4) T.box(b, 'transit_lamp_cool', q + 1.5, roofY - 0.04, centre, 3.0, 0.05, 0.5);
      }
      // contact + messenger wires over the track centre
      for (let s = r0 + 1; s < v1; s += step) {
        const s1 = Math.min(v1, s + step), sm = (s + s1) / 2;
        const b = bAt(sm);
        T.box(b, 'transit_wire', sm, yRail + 5.0, centre, s1 - s, 0.014, 0.014);
        T.box(b, 'transit_cable', sm, yRail + 6.0, centre, s1 - s, 0.012, 0.012);
        for (let q = s + 2; q < s1; q += 4) T.box(b, 'transit_cable', q, yRail + 5.5, centre, 0.006, 1.0, 0.006);
      }
      // buffer stop at the north end
      {
        const sb = r0 + 0.6;
        const b = bAt(sb);
        T.box(b, 'transit_buffer_red', sb, y - 0.55, centre, 0.5, 0.9, 2.4);
        for (const sd of [-1, 1]) {
          T.box(b, 'rubber_black', sb + 0.32, y - 0.45, centre + sd * 0.8, 0.14, 0.35, 0.45);
          T.box(b, 'transit_buffer_red', sb - 0.8, y - 0.85, centre + sd * 0.75, 1.6, 0.25, 0.2);
        }
        T.box(b, 'transit_red_lamp', sb + 0.26, y + 0.05, centre, 0.02, 0.18, 0.18);
        T.box(b, 'steel_dark', sb + 0.1, y + 0.05, centre, 0.3, 0.3, 0.3);
      }
    }
  }
  // ---- Nankai shared structures: viaduct deck + parapets, roof trusses, catenary portals ----
  const nk = cfgs.filter(c => c.line.id === 'nankai');
  if (nk.length) {
    const y = nk[0].y;
    let xlo = Infinity, xhi = -Infinity, sEnd = -Infinity, vEnd = -Infinity, s0 = Infinity;
    for (const c of nk) { xlo = Math.min(xlo, c.crossRange[0], c.crossRange[1]); xhi = Math.max(xhi, c.crossRange[0], c.crossRange[1]); sEnd = Math.max(sEnd, c.platformRange[1]); vEnd = Math.max(vEnd, c.visRange[1]); s0 = Math.min(s0, c.trackRange[0]); }
    const roofY = y + nk[0].platformCeil;
    const tEnd = Math.max(...nk.map(c => c.trackRange[1]));
    const step = 12;
    for (let z = sEnd; z < vEnd; z += step) {
      const z1 = Math.min(vEnd, z + step), zm = (z + z1) / 2;
      const b = CB.get('3F', (xlo + xhi) / 2, zm);
      // deck between and around the track beds (ballast is per track)
      if (z >= tEnd - 0.01) b.rectH('ballast', xlo, z, xhi, z1, y - 1.11, true);
      else {
        // between track rect end and viaduct: only the non-track strips are missing; cover all slightly lower
        b.rectH('ballast', xlo, z, xhi, z1, y - 1.112, true);
      }
      // deck slab edge + underside. v3: the underside sits at y - 1.35 (10.65 m), above the Namba CITY 2F
      // ceiling + plenum (10.0 + 0.6) it spans; it was at 9.65 and showed as a flat concrete ceiling in CITY 2F.
      b.box('transit_concrete', (xlo + xhi) / 2, y - 1.24, zm, xhi - xlo + 1.2, 0.22, z1 - z, 0, { faces: 'b' });
      for (const [xx, sd] of [[xlo - 0.3, -1], [xhi + 0.3, 1]]) {
        b.box('transit_concrete', xx, y - 0.7, zm, 0.6, 1.3, z1 - z, 0, { faces: sd < 0 ? 'wte' : 'ewt' });
        b.box('transit_concrete', xx, y + 0.0, zm, 0.3, 0.3, z1 - z, 0, { faces: 'tew' });
      }
    }
    // v3: the deck ends at vEnd (massing.js carries a narrower viaduct on): cap the cut with an end face
    {
      const b = CB.get('3F', (xlo + xhi) / 2, vEnd - 1);
      b.box('transit_concrete', (xlo + xhi) / 2, y - 0.7, vEnd - 0.15, xhi - xlo + 1.2, 1.3, 0.3, 0, { faces: 'nstb' });
    }
    // catenary portals along the viaduct + in the shed hung from the roof (+ one at the deck end, where the wires stop)
    const portalZ = [];
    for (let z = s0 + 8; z < vEnd; z += 30) portalZ.push(z);
    if (vEnd - portalZ[portalZ.length - 1] > 4) portalZ.push(vEnd - 1);
    for (const z of portalZ) {
      const b = CB.get('3F', (xlo + xhi) / 2, z);
      const yTop = y + 6.6;
      if (z > sEnd + 2) {
        for (const xx of [xlo - 0.3, xhi + 0.3]) b.box('transit_catenary_steel', xx, (y - 0.1 + yTop) / 2, z, 0.35, yTop - y + 0.2, 0.35);
        b.box('transit_catenary_steel', (xlo + xhi) / 2, yTop, z, xhi - xlo + 1.0, 0.45, 0.3);
      } else {
        // drop bars from the roof
        b.box('transit_catenary_steel', (xlo + xhi) / 2, roofY - 0.9, z, xhi - xlo, 0.2, 0.2);
      }
    }
    // roof trusses across the shed
    for (let z = s0 + 4; z < sEnd; z += 12) {
      const b = CB.get('3F', (xlo + xhi) / 2, z);
      b.box('steel_painted_white', (xlo + xhi) / 2, roofY - 0.3, z, xhi - xlo, 0.6, 0.35, 0, { faces: 'bnsew' });
    }
  }
  CB.build(ctx, 'transit_env');
}

// -----------------------------------------------------------------------------
// Platform screen doors for one track. Returns { mesh(es), setOpen(v) }.
// doorsAlong: along-coordinates of the stopped train's doors; dw: train door width.
export function buildPSD(ctx, cfg, doorsAlong, dw) {
  const { t, line, y, edge, inward } = cfg;
  const T = TS(cfg);
  const [p0, p1] = cfg.platformRange;
  const cLine = edge + inward * 0.22;   // PSD centre line on the platform
  const H = 1.32, TH = 0.2;
  const open = dw + 0.4, leafW = open / 2;
  const red = line.id === 'midosuji' ? 'transit_psd_red' : 'transit_psd_pink';
  const CB = new ChunkBatches(320);
  const bAt = (s) => { const [x, z] = T.xz(s, cLine); return CB.get(t.level, x, z); };
  const sorted = doorsAlong.slice().sort((a, b) => a - b);
  const openings = sorted.map(d => [d - open / 2, d + open / 2]);
  // leaves: one MB (2 materials) per track, patched to slide by a uniform
  const mb = new MB(3);
  const axisVec = cfg.axis === 'z' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
  const boxes = [];
  const housing = (a, b) => {
    if (b - a < 0.05) return;
    const m = (a + b) / 2, bb = bAt(m);
    T.box(bb, 'transit_psd_body', m, y + H / 2, cLine, b - a, H, TH);
    T.box(bb, 'transit_psd_cap', m, y + H + 0.03, cLine, b - a + 0.01, 0.06, TH + 0.04);
    T.box(bb, red, m, y + H - 0.16, cLine, b - a + 0.004, 0.06, TH + 0.006, { faces: 'nsew' });
    T.box(bb, 'steel_dark', m, y + 0.04, cLine, b - a, 0.08, TH + 0.01, { faces: 'nsew' });
    boxes.push([m, (b - a) / 2]);
  };
  const glassPanel = (a, b) => {
    if (b - a < 0.05) return;
    const m = (a + b) / 2, bb = bAt(m);
    // posts + top rail + glass
    for (const q of [a + 0.04, b - 0.04]) T.box(bb, 'stainless', q, y + H / 2, cLine, 0.08, H, 0.1);
    T.box(bb, 'stainless', m, y + H - 0.03, cLine, b - a, 0.06, 0.12);
    T.box(bb, 'stainless', m, y + 0.06, cLine, b - a, 0.12, 0.08);
    const A = T.P(a + 0.08, y + 0.12, cLine), B = T.P(b - 0.08, y + 0.12, cLine), C = T.P(b - 0.08, y + H - 0.06, cLine), D = T.P(a + 0.08, y + H - 0.06, cLine);
    bb.quad('glass_rail', A, B, C, D);
    boxes.push([m, (b - a) / 2]);
  };
  const pocket = leafW + 0.12;
  let p = p0 + 0.3;
  for (const [a, b] of openings) {
    if (a < p0 || b > p1) continue;
    // housing pocket before the opening, glass between pockets
    const hA = a - pocket;
    if (hA - p > 0.2) glassPanel(p, hA); else if (hA > p) housing(p, hA);
    housing(Math.max(p, hA), a);
    p = b + pocket;
    housing(b, Math.min(p, p1 - 0.3));
  }
  if (p1 - 0.3 - p > 0.2) glassPanel(p, p1 - 0.3);
  // leaves
  const P = (s, yy, c) => T.P(s, yy, c);
  openings.forEach(([a, b], k) => {
    if (a < p0 || b > p1) return;
    for (const [la, lb, slide] of [[a, a + leafW, -leafW], [b - leafW, b, leafW]]) {
      const door = [slide, 0];
      const c = cLine;
      // leaf: lower panel (white), glass upper, black rubber edge, red band
      const lt = 0.04;
      for (const sd of [-1, 1]) {
        const cc = c + sd * lt / 2;
        const quad = (m, s0, s1, y0, y1, o) => {
          const A = P(s0, y0, cc), B2 = P(s1, y0, cc), C = P(s1, y1, cc), D = P(s0, y1, cc);
          mb.quad(m, A, B2, C, D, o); mb.quad(m, A, D, C, B2, o);
        };
        quad(0, la, lb, y + 0.02, y + 0.55, { door, uv: [0.5, 0.5], col: [0.92, 0.93, 0.94] });
        quad(0, la, lb, y + 1.12, y + H - 0.02, { door, col: [0.92, 0.93, 0.94] });
        quad(0, la, la + 0.06, y + 0.55, y + 1.12, { door, col: [0.92, 0.93, 0.94] });
        quad(0, lb - 0.06, lb, y + 0.55, y + 1.12, { door, col: [0.92, 0.93, 0.94] });
        quad(2, la, lb, y + H - 0.2, y + H - 0.13, { door, col: line.id === 'midosuji' ? [0.9, 0.09, 0.12] : [0.89, 0.3, 0.58] });
        quad(1, la + 0.06, lb - 0.06, y + 0.55, y + 1.12, { door });
      }
      const me = slide < 0 ? lb - 0.02 : la + 0.02;
      const [mx, mz] = T.xz(me, c);
      mb.box(2, mx, y + H / 2, mz, cfg.axis === 'z' ? lt + 0.01 : 0.04, H - 0.04, cfg.axis === 'z' ? 0.04 : lt + 0.01, { door, col: [0.05, 0.05, 0.05] });
    }
    // door-state indicator lamp on top of each pocket (red when closing)
    void k;
  });
  // collision: housings & glass panels are fixed obstacles
  for (const [m, half] of boxes) {
    const [x, z] = T.xz(m, cLine);
    if (cfg.axis === 'z') ctx.world.addBox(t.level, x, z, TH / 2, half, 0); else ctx.world.addBox(t.level, x, z, half, TH / 2, 0);
  }
  CB.build(ctx, 'transit_psd');
  // leaf mesh with a per-track uniform
  const geo = mb.build();
  const u = { uOpen: { value: 0 }, uAxis: { value: axisVec } };
  const patch = (m) => {
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uOpen = u.uOpen; sh.uniforms.uAxis = u.uAxis;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aDoor; uniform float uOpen; uniform vec3 uAxis;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += uAxis * aDoor.x * uOpen;');
    };
    m.customProgramCacheKey = () => 'nb-psd';
    return m;
  };
  const mats = [
    patch(new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.35, metalness: 0.2 })),
    patch(new THREE.MeshStandardMaterial({ color: 0xcfe3e6, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide })),
    patch(new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.5, metalness: 0.1 })),
  ];
  const mesh = new THREE.Mesh(geo, mats);
  mesh.name = `transit_psd_leaves:${t.id}`;
  mesh.frustumCulled = false;
  ctx.engine.levelRoot(t.level).add(mesh);
  return { mesh, uniforms: u, openings, cLine };
}
