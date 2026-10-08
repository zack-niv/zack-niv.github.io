// =============================================================================
// Terraces: dressing for every outdoor WALL edge above the canyon floor —
// strata risers where a higher terrace begins, glass balustrades on drops,
// bridges and decks — plus the exterior faces of the stepped terrace building.
// =============================================================================
import * as THREE from 'three';
import { LEVELS, LEVEL_ORDER } from '../layout.js?v=6c67dba';
import { rng } from '../../core/rng.js?v=6c67dba';
import { MeshAcc, lin, mulc } from './meshacc.js?v=6c67dba';
import { PALETTE, TERRACE_Z } from './canyon.js?v=6c67dba';

const SEQ = ['sand', 'ochre', 'cream', 'terracotta', 'sand', 'blush', 'umber', 'cream', 'rust', 'ochre'];

// straight banded strata face from (ax,az) to (bx,bz), y0..y1, facing normal (nx,nz)
export function strataFace(acc, ax, az, bx, bz, y0, y1, nx, nz, seed = 1, opts = {}) {
  const R = rng(seed);
  const len = Math.hypot(bx - ax, bz - az);
  if (len < 0.01 || y1 - y0 < 0.01) return;
  // make sure a->b runs so that the quad faces n: (b-a) x up must equal n
  let A = [ax, az], B = [bx, bz];
  const tx = (bx - ax) / len, tz = (bz - az) / len;
  // (t x up) = (−tz, 0, tx)... we need geometric normal = (b-a) x (d-a) = t x up = (-tz*1... ) compute: t=(tx,0,tz), up=(0,1,0): t x up = (0*0 - tz*1, tz*0 - tx*0, tx*1 - 0*0) = (-tz, 0, tx)
  if (-tz * nx + tx * nz < 0) { A = [bx, bz]; B = [ax, az]; }
  const ut0 = opts.u0 || 0;
  let y = y0, k = Math.floor(R.range(0, 10));
  while (y < y1 - 0.01) {
    const h = Math.min(y1 - y, R.range(0.35, 1.3));
    const col = mulc(PALETTE[SEQ[k++ % SEQ.length]], R.range(0.9, 1.05));
    const yb = y <= y0 + 0.01 && opts.groundAO ? 0.8 : 1;
    const o = opts.jitter ? R.range(-opts.jitter, opts.jitter) : 0;
    const p = (q, yy) => [q[0] + nx * o, yy, q[1] + nz * o];
    acc.quad(p(A, y), p(B, y), p(B, y + h), p(A, y + h), [nx, 0, nz], [[ut0, y / 4], [ut0 + len / 4, y / 4], [ut0 + len / 4, (y + h) / 4], [ut0, (y + h) / 4]], [mulc(col, yb), mulc(col, yb), col, col]);
    y += h;
  }
}

// glass balustrade along a segment at floor height y (posts every ~1.6 m)
export function glassRail(glass, steel, ax, az, bx, bz, y, h = 1.1) {
  const len = Math.hypot(bx - ax, bz - az);
  if (len < 0.05) return;
  glass.quadAuto([ax, y + 0.06, az], [bx, y + 0.06, bz], [bx, y + h - 0.06, bz], [ax, y + h - 0.06, az]);
  const tx = (bx - ax) / len, tz = (bz - az) / len;
  const rot = Math.atan2(-tz, tx);
  const m = new THREE.Matrix4();
  m.compose(new THREE.Vector3((ax + bx) / 2, y + h, (az + bz) / 2), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot), new THREE.Vector3(len, 0.05, 0.07));
  steel.geometry(BOX, m);
  m.compose(new THREE.Vector3((ax + bx) / 2, y + 0.04, (az + bz) / 2), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot), new THREE.Vector3(len, 0.08, 0.1));
  steel.geometry(BOX, m);
  const n = Math.max(1, Math.round(len / 1.6));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    m.makeTranslation(ax + (bx - ax) * t, y + h / 2, az + (bz - az) * t).multiply(S.makeScale(0.05, h, 0.05));
    steel.geometry(BOX, m);
  }
}
const BOX = new THREE.BoxGeometry(1, 1, 1);
const S = new THREE.Matrix4();

function terraceOf(x, z) {
  for (const t of TERRACE_Z) {
    const lv = LEVEL_ORDER.find(l => LEVELS[l].y === t[2]);
    if (z >= t[0] && z <= t[1] && x >= t[3] && x <= 120) return { y: t[2], level: lv, t };
  }
  return null;
}

export function buildTerraces(ctx, parks) {
  const { world, materials } = ctx;
  const L = world.layout;
  const strata = new MeshAcc(), glass = new MeshAcc(), steel = new MeshAcc(), coping = new MeshAcc();
  let seed = 10;
  for (const lv of LEVEL_ORDER) {
    const y = LEVELS[lv].y;
    if (y < 12 || !world.edges[lv]) continue;
    for (const e of world.edges[lv]) {
      if (e.kind !== 'wall') continue;
      const spA = e.spaceA >= 0 ? L.spaces[e.spaceA] : null, spB = e.spaceB >= 0 ? L.spaces[e.spaceB] : null;
      const walkSp = e.nx < 0 || e.nz < 0 ? spA : e.nx > 0 || e.nz > 0 ? spB : spA;
      if (!walkSp || !walkSp.outdoor) continue;
      const mx = (e.ax + e.bx) / 2, mz = (e.az + e.bz) / 2;
      const qx = mx - e.nx * 0.5, qz = mz - e.nz * 0.5; // just outside
      const up = walkSp.garden ? terraceOf(qx, qz) : null;
      if (up && up.y > y + 0.5) {
        // riser: strata from this terrace up to the next one (+ its parapet planter lip)
        strataFace(strata, e.ax, e.az, e.bx, e.bz, y, up.y + 0.45, e.nx, e.nz, seed++, { groundAO: true, u0: e.ax + e.az });
        // coping on top of the riser
        const len = Math.hypot(e.bx - e.ax, e.bz - e.az);
        const m = new THREE.Matrix4().compose(new THREE.Vector3(mx - e.nx * 0.2, up.y + 0.5, mz - e.nz * 0.2), new THREE.Quaternion(), new THREE.Vector3(e.nx ? 0.6 : len, 0.1, e.nz ? 0.6 : len));
        coping.geometry(BOX, m, PALETTE.cream);
      } else {
        // a drop: glass balustrade (bridges, decks, terrace edges)
        const off = 0.06; // a hair outside the walk line
        glassRail(glass, steel, e.ax - e.nx * off, e.az - e.nz * off, e.bx - e.nx * off, e.bz - e.nz * off, y);
        // low strata curb outside the glass on terraces
        if (walkSp.garden) {
          const len = Math.hypot(e.bx - e.ax, e.bz - e.az);
          const m = new THREE.Matrix4().compose(new THREE.Vector3(mx - e.nx * 0.25, y + 0.15, mz - e.nz * 0.25), new THREE.Quaternion(), new THREE.Vector3(e.nx ? 0.36 : len, 0.3, e.nz ? 0.36 : len));
          coping.geometry(BOX, m, mulc(PALETTE.sand, 0.95));
        }
      }
    }
  }
  // ---- exterior faces of the terrace building --------------------------------
  TERRACE_Z.forEach(([z0, z1, ty, x0], k) => {
    // east face (towards the city), with a planted ledge at every terrace level
    strataFace(strata, 120.3, z0, 120.3, z1, 0, ty + 0.45, 1, 0, 200 + k, { groundAO: true, u0: z0 });
    for (let yy = 6; yy < ty; yy += 6) {
      const m = new THREE.Matrix4().compose(new THREE.Vector3(121.0, yy - 0.15, (z0 + z1) / 2), new THREE.Quaternion(), new THREE.Vector3(1.4, 0.3, z1 - z0));
      coping.geometry(BOX, m, PALETTE.cream);
      parks.planters.push({ kind: 'ledge', a: [120.6, yy, z0 + 0.5], b: [120.6, yy, z1 - 0.5], a2: [121.6, yy, z0 + 0.5], b2: [121.6, yy, z1 - 0.5], n: [1, 0], y: yy, outer: true });
    }
  });
  strataFace(strata, 50, 203.7, 120.3, 203.7, 0, 12.45, 0, -1, 300, { groundAO: true });
  strataFace(strata, 60, 388.3, 120.3, 388.3, 0, 42.45, 0, 1, 301, { groundAO: true });
  // south face continues west across the stage end and the dining block
  strataFace(strata, -22.5, 388.3, 60, 388.3, 0, 18, 0, 1, 302, { groundAO: true });

  const M = materials;
  parks.root.add(strata.mesh(M.get('parks_strata'), { name: 'parks:terrace_strata' }));
  parks.root.add(coping.mesh(vcol(ctx), { name: 'parks:coping' }));
  parks.root.add(glass.mesh(M.get('parks_glass'), { cast: false, receive: false, name: 'parks:rail_glass' }));
  parks.root.add(steel.mesh(M.get('parks_steel'), { cast: true, name: 'parks:rail_steel' }));
}

function vcol(ctx) {
  const M = ctx.materials;
  if (!M.factories.has('parks_vcol_stone')) M.define('parks_vcol_stone', () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, vertexColors: true }));
  return M.get('parks_vcol_stone');
}
