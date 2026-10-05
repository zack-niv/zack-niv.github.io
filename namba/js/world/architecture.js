// =============================================================================
// Architecture: floors, ceilings, walls, balustrades, platform edges, track
// beds and the static structure of ramps (escalators / stairs), all generated
// from the world grid + edges so visuals match collision exactly.
//
// Geometry is batched per (level, 48 m chunk, material) for culling.
// =============================================================================
import * as THREE from 'three';
import { GeoBatch } from '../render/geobatch.js';
import { CELL, EDGE } from './world.js';
import { LEVELS, LEVEL_ORDER, rampProfile, rampLength, rampEnds } from './layout.js';

const CHUNK = 48;

export const STYLE = {
  default:            { floor: 'floor_tile_grey', wall: 'wall_panel_white', ceil: 'ceiling_panel', light: 'light_panel' },
  metro_platform:     { floor: 'floor_platform', wall: 'wall_tile_metro', ceil: 'ceiling_metal', light: 'light_cool' },
  metro_concourse:    { floor: 'floor_tile_grey', wall: 'wall_tile_metro', ceil: 'ceiling_panel', light: 'light_cool' },
  arcade:             { floor: 'floor_polished', wall: 'wall_panel_white', ceil: 'ceiling_panel', light: 'light_panel' },
  arcade_court:       { floor: 'floor_terrazzo', wall: 'wall_stone_warm', ceil: 'ceiling_panel', light: 'light_warm' },
  depachika:          { floor: 'floor_tile_warm', wall: 'wall_panel_white', ceil: 'ceiling_panel', light: 'light_warm' },
  passage:            { floor: 'floor_tile_grey', wall: 'wall_tile_white', ceil: 'ceiling_panel', light: 'light_cool' },
  city_plaza:         { floor: 'floor_polished', wall: 'wall_stone_warm', ceil: 'ceiling_panel', light: 'light_warm' },
  city_mall:          { floor: 'floor_polished', wall: 'wall_panel_white', ceil: 'ceiling_panel', light: 'light_panel' },
  city_court:         { floor: 'floor_terrazzo', wall: 'wall_stone_warm', ceil: 'ceiling_panel', light: 'light_warm' },
  dining_street:      { floor: 'floor_stone_dark', wall: 'wall_dark', ceil: 'ceiling_dark', light: 'light_warm' },
  shop:               { floor: 'floor_tile_warm', wall: 'wall_panel_white', ceil: 'ceiling_panel', light: 'light_panel' },
  restaurant:         { floor: 'floor_wood', wall: 'wall_stone_warm', ceil: 'ceiling_dark', light: 'light_warm' },
  sidewalk:           { floor: 'floor_paving', wall: 'wall_concrete', ceil: null, light: null },
  plaza:              { floor: 'floor_paving', wall: 'wall_concrete', ceil: null, light: null },
  department:         { floor: 'floor_polished', wall: 'wall_panel_white', ceil: 'ceiling_panel', light: 'light_warm' },
  terminal_hall:      { floor: 'floor_terrazzo', wall: 'wall_stone_warm', ceil: 'ceiling_panel', light: 'light_panel' },
  terminal_concourse: { floor: 'floor_terrazzo', wall: 'wall_panel_white', ceil: 'ceiling_metal', light: 'light_panel' },
  terminal_platform:  { floor: 'floor_platform', wall: 'wall_concrete', ceil: 'ceiling_metal', light: 'light_panel' },
  parks_indoor:       { floor: 'floor_tile_warm', wall: 'wall_strata', ceil: 'ceiling_panel', light: 'light_warm' },
  parks_dining:       { floor: 'floor_wood', wall: 'wall_strata', ceil: 'ceiling_dark', light: 'light_warm' },
  parks_skywalk:      { floor: 'floor_wood', wall: 'glass', ceil: 'ceiling_panel', light: 'light_warm' },
  canyon:             { floor: 'floor_paving', wall: 'wall_strata', ceil: null, light: null },
  canyon_stage:       { floor: 'floor_wood', wall: 'wall_strata', ceil: null, light: null },
  canyon_bridge:      { floor: 'floor_wood', wall: 'wall_strata', ceil: null, light: null },
  garden:             { floor: 'floor_paving', wall: 'wall_strata', ceil: null, light: null },
  garden_deck:        { floor: 'floor_wood', wall: 'wall_strata', ceil: null, light: null },
};
export function styleOf(space) { return STYLE[space && space.style] || STYLE.default; }

export class Architecture {
  constructor(ctx) { this.ctx = ctx; }

  init() {
    const { world, engine, materials } = this.ctx;
    const L = world.layout;
    this.batches = new Map(); // key level|cx|cz -> GeoBatch
    const B = (lv, x, z) => {
      const k = `${lv}|${Math.floor(x / CHUNK)}|${Math.floor(z / CHUNK)}`;
      let b = this.batches.get(k); if (!b) this.batches.set(k, b = new GeoBatch());
      return b;
    };
    for (const lv of LEVEL_ORDER) {
      const g = world.grids[lv]; if (!g) continue;
      const y = LEVELS[lv].y;
      const upIdx = LEVEL_ORDER.indexOf(lv) + 1;
      const above = upIdx < LEVEL_ORDER.length ? world.grids[LEVEL_ORDER[upIdx]] : null;
      // ---- floors & ceilings: greedy row runs of identical style ------------
      for (let cz = 0; cz < g.h; cz++) {
        let run = null;
        const flush = () => {
          if (!run) return;
          const z0 = g.z0 + cz, z1 = z0 + 1;
          const x0 = g.x0 + run.c0, x1 = g.x0 + run.c1;
          const st = styleOf(run.space);
          B(lv, (x0 + x1) / 2, z0).rectH(st.floor, x0, z0, x1, z1, y, true);
          if (st.ceil && !run.space.outdoor && !run.open) B(lv, (x0 + x1) / 2, z0).rectH(st.ceil, x0, z0, x1, z1, y + run.space.ceil, false);
          run = null;
        };
        for (let cx = 0; cx <= g.w; cx++) {
          const i = cz * g.w + cx;
          let key = null, sp = null, open = false;
          if (cx < g.w && g.type[i] === CELL.WALK) {
            sp = L.spaces[g.space[i]];
            if (above) { const ta = above.typeAt(g.x0 + cx + 0.5, g.z0 + cz + 0.5); open = ta === CELL.VOID || ta === CELL.RAMP; }
            key = sp.id + (open ? '|o' : '');
          }
          if (run && run.key === key) { run.c1 = cx + 1; continue; }
          flush();
          if (key) run = { key, space: sp, open, c0: cx, c1: cx + 1 };
        }
      }
      // ---- walls, partitions, rails, platform edges --------------------------
      for (const e of world.edges[lv]) {
        const mx = (e.ax + e.bx) / 2, mz = (e.az + e.bz) / 2;
        const b = B(lv, mx, mz);
        const spA = e.spaceA >= 0 ? L.spaces[e.spaceA] : null, spB = e.spaceB >= 0 ? L.spaces[e.spaceB] : null;
        // the walkable side's space
        const walkSp = e.nx < 0 || e.nz < 0 ? spA : e.nx > 0 || e.nz > 0 ? spB : spA;
        const st = styleOf(walkSp);
        // outdoor boundaries (streets, plaza, canyon, terraces, bridges) are
        // dressed by exterior.js / parks.js (facades, strata, parapets, kerbs);
        // collision is unchanged. [outdoors lead — see notes/outdoors.md]
        if (e.kind === EDGE.WALL && walkSp && walkSp.outdoor) continue;
        if (e.kind === EDGE.WALL || e.kind === EDGE.PARTITION) {
          let h = walkSp ? (walkSp.outdoor ? 4.5 : walkSp.ceil) : 3.5;
          if (e.kind === EDGE.PARTITION) h = Math.max(spA ? spA.ceil : 3, spB ? spB.ceil : 3);
          const wm = st.wall;
          // face towards walkable side; for vertical edges (ax==bx) the normal is ±x
          if (e.kind === EDGE.PARTITION) {
            b.wall(styleOf(spA).wall, e.ax, e.az, e.bx, e.bz, y, y + h, e.ax === e.bx);
            b.wall(styleOf(spB).wall, e.ax, e.az, e.bx, e.bz, y, y + h, e.ax !== e.bx);
          } else {
            const towardsLow = e.nx < 0 || e.nz < 0; // walkable side is the low-coordinate side
            // wall(): face left of a->b. For a vertical edge running +z, left is +x... handle via flip
            const flip = e.ax === e.bx ? towardsLow : !towardsLow;
            b.wall(wm, e.ax, e.az, e.bx, e.bz, y, y + h, flip);
            // skirting
            const ox = e.ax === e.bx ? (towardsLow ? -0.01 : 0.01) : 0, oz = e.az === e.bz ? (towardsLow ? -0.01 : 0.01) : 0;
            b.wall('steel_dark', e.ax + ox, e.az + oz, e.bx + ox, e.bz + oz, y, y + 0.1, flip);
          }
        } else if (e.kind === EDGE.RAIL || e.kind === EDGE.RAMP_SIDE) {
          // glass balustrade with steel cap
          b.wall('glass_rail', e.ax, e.az, e.bx, e.bz, y, y + 1.05, false);
          const vert = e.ax === e.bx;
          b.box('steel', mx, y + 1.08, mz, vert ? 0.06 : Math.abs(e.bx - e.ax), 0.06, vert ? Math.abs(e.bz - e.az) : 0.06);
          b.box('steel_dark', mx, y - 0.25, mz, vert ? 0.2 : Math.abs(e.bx - e.ax), 0.5, vert ? Math.abs(e.bz - e.az) : 0.2);
        } else if (e.kind === EDGE.TRACK) {
          const towardsLow = e.nx < 0 || e.nz < 0;
          const flip = e.ax === e.bx ? !towardsLow : towardsLow;
          b.wall('wall_concrete', e.ax, e.az, e.bx, e.bz, y - 1.1, y, flip);
          // tactile strip 0.8–1.1 m from edge
          const vert = e.ax === e.bx;
          const off = (towardsLow ? -1 : 1) * 0.95;
          if (vert) b.rectH('tactile_yellow', e.ax + off - 0.15, e.az, e.ax + off + 0.15, e.bz, y + 0.005, true);
          else b.rectH('tactile_yellow', e.ax, e.az + off - 0.15, e.bx, e.az + off + 0.15, y + 0.005, true);
          b.rectH('floor_stone_dark', vert ? e.ax + (towardsLow ? -0.25 : 0) : e.ax, vert ? e.az : e.az + (towardsLow ? -0.25 : 0), vert ? e.ax + (towardsLow ? 0 : 0.25) : e.bx, vert ? e.bz : e.az + (towardsLow ? 0 : 0.25), y + 0.004, true);
        }
      }
      // ---- track beds ---------------------------------------------------------
      for (const t of L.tracks.filter(t => t.level === lv)) {
        const [x0, z0, x1, z1] = t.rect;
        const b = B(lv, (x0 + x1) / 2, (z0 + z1) / 2);
        b.rectH('ballast', x0, z0, x1, z1, y - 1.1, true);
        const c = t.axis === 'z' ? (x0 + x1) / 2 : (z0 + z1) / 2;
        for (const o of [-0.5335, 0.5335]) {
          if (t.axis === 'z') b.box('rail_steel', c + o, y - 1.0, (z0 + z1) / 2, 0.07, 0.15, z1 - z0);
          else b.box('rail_steel', (x0 + x1) / 2, y - 1.0, c + o, x1 - x0, 0.15, 0.07);
        }
        if (!LEVELS[lv] || !t.terminal) {
          // tunnel back wall for subway tracks
          if (t.axis === 'z') b.wall('wall_tile_metro', t.side === 'w' ? x0 : x1, z0, t.side === 'w' ? x0 : x1, z1, y - 1.1, y + 4.2, t.side !== 'w');
          else b.wall('wall_tile_metro', x0, t.side === 'n' ? z0 : z1, x1, t.side === 'n' ? z0 : z1, y - 1.1, y + 4.2, t.side === 'n');
        }
      }
    }
    // ---- ramps --------------------------------------------------------------
    L.ramps.forEach(r => this._ramp(r, B(r.lower, (r.rect[0] + r.rect[2]) / 2, (r.rect[1] + r.rect[3]) / 2)));
    // emit meshes into chunk groups
    for (const [k, b] of this.batches) {
      const [lv, cx, cz] = k.split('|');
      const grp = new THREE.Group();
      grp.name = `arch:${k}`;
      grp.userData.chunk = { level: lv, x: (+cx + 0.5) * CHUNK, z: (+cz + 0.5) * CHUNK, r: CHUNK * 0.75 };
      for (const m of b.build(materials, { name: 'arch' })) grp.add(m);
      engine.levelRoot(lv).add(grp);
    }
    this.batches.clear();
  }

  // Static structure for an escalator / stairs. Moving steps & handrails are
  // animated elsewhere (props/escalators); this builds the truss, balustrades
  // and a sloped step surface.
  _ramp(r, b) {
    const len = rampLength(r);
    const ends = rampEnds(r);
    const N = Math.max(8, Math.round(len * 3));
    const hw = r.walkWidth / 2;
    const ax = r.axis === 'x';
    const [x0, z0, x1, z1] = r.rect;
    const cc = ax ? (z0 + z1) / 2 : (x0 + x1) / 2;
    const P = (s, u, y) => { // s in metres from low end, u lateral
      const t = s / len;
      const along = (ax ? ends.low.x : ends.low.z) + ((ax ? ends.high.x : ends.high.z) - (ax ? ends.low.x : ends.low.z)) * t;
      return ax ? [along, y, cc + u] : [cc + u, y, along];
    };
    const isEsc = r.kind === 'escalator';
    const stepMat = isEsc ? 'steel_dark' : 'floor_stone_dark';
    for (let i = 0; i < N; i++) {
      const s0 = (i / N) * len, s1 = ((i + 1) / N) * len;
      const y0 = rampProfile(r, i / N), y1 = rampProfile(r, (i + 1) / N);
      if (r.kind === 'stairs' && y1 - y0 > 0.01) {
        // tread + riser
        b.quad(stepMat, P(s0, -hw, y1), P(s0, hw, y1), P(s0, hw, y0), P(s0, -hw, y0)); // riser (approx)
        b.quad(stepMat, P(s0, hw, y1), P(s0, -hw, y1), P(s1, -hw, y1), P(s1, hw, y1));
      } else {
        b.quad(stepMat, P(s0, hw, y0), P(s0, -hw, y0), P(s1, -hw, y1), P(s1, hw, y1));
      }
      // balustrades: glass for escalators, solid for stairs
      const sideMat = isEsc ? 'glass_rail' : 'wall_concrete';
      const sh = isEsc ? 0.95 : 1.0;
      for (const u of [-hw - 0.05, hw + 0.05]) {
        b.quad(sideMat, P(s0, u, y0), P(s1, u, y1), P(s1, u, y1 + sh), P(s0, u, y0 + sh));
        b.quad(sideMat, P(s1, u, y1), P(s0, u, y0), P(s0, u, y0 + sh), P(s1, u, y1 + sh));
        // handrail
        const hm = isEsc ? 'rubber_black' : 'steel';
        b.quad(hm, P(s0, u - 0.05, y0 + sh + 0.04), P(s0, u + 0.05, y0 + sh + 0.04), P(s1, u + 0.05, y1 + sh + 0.04), P(s1, u - 0.05, y1 + sh + 0.04));
        // skirt/truss underside panel
        b.quad('steel_dark', P(s1, u, y1 - 0.9), P(s0, u, y0 - 0.9), P(s0, u, y0), P(s1, u, y1));
        b.quad('steel_dark', P(s0, u, y0 - 0.9), P(s1, u, y1 - 0.9), P(s1, u, y1), P(s0, u, y0));
      }
      // soffit
      b.quad('steel_dark', P(s0, -hw - 0.1, y0 - 0.9), P(s0, hw + 0.1, y0 - 0.9), P(s1, hw + 0.1, y1 - 0.9), P(s1, -hw - 0.1, y1 - 0.9));
    }
  }
}
