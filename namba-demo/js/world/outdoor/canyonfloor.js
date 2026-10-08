// =============================================================================
// Canyon floor dressing: raised stone planters with trees (momiji / sakura /
// keyaki) and shrubs hugging the strata walls, timber benches backing onto
// them, bollard lamps. Everything is registered with world.addBox so collision
// and crowd nav match. Keeps >= 6 m clear walking width.
// =============================================================================
import * as THREE from 'three';
import { rng } from '../../core/rng.js?v=488c31e';
import { MeshAcc, lin, mulc } from './meshacc.js?v=488c31e';
import { PALETTE } from './canyon.js?v=488c31e';

const BOX = new THREE.BoxGeometry(1, 1, 1);
const M4 = () => new THREE.Matrix4();

export function canyonFloor(ctx, parks, veg) {
  const C = parks.canyon; if (!C) return;
  const { world, materials: M } = ctx;
  const R = rng(5252);
  const stone = new MeshAcc(), soil = new MeshAcc(), wood = new MeshAcc(), metal = new MeshAcc();
  const F = C.F, N = F.length;
  const yG = 6; // 2F
  const trees = ['momiji', 'sakura', 'keyaki', 'momiji', 'kusu', 'sakura'];
  let k = 0, last = -1e9, n = 0;
  for (let i = 12; i < N - 12; i++) {
    const f = F[i];
    if (f.s - last < 15 + R.range(0, 6)) continue;
    // need a clear run of wall (no door / ramp / shop recess) around the planter
    let ok = true;
    for (let j = i - 10; j <= i + 10; j++) if (C.gOpen[j] || F[j].side !== f.side) { ok = false; break; }
    if (!ok) continue;
    // clearance in front of the wall: planter depth 1.7 m, bench 0.7 m
    const a = F[i - 5], b = F[i + 5];
    const tx = b.x - a.x, tz = b.z - a.z, tl = Math.hypot(tx, tz); if (tl < 3) continue;
    const ux = tx / tl, uz = tz / tl, nx = f.nx, nz = f.nz;
    const depth = 1.7, len = tl;
    const cx = f.x + nx * (depth / 2 + 0.25), cz = f.z + nz * (depth / 2 + 0.25);
    const ang = Math.atan2(uz, ux);
    // planter body
    const h = 0.7;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -ang);
    stone.geometry(BOX, new THREE.Matrix4().compose(new THREE.Vector3(cx, yG + h / 2, cz), q, new THREE.Vector3(len, h, depth)), mulc(PALETTE.cream, 0.92));
    stone.geometry(BOX, new THREE.Matrix4().compose(new THREE.Vector3(cx, yG + h + 0.04, cz), q, new THREE.Vector3(len + 0.14, 0.08, depth + 0.14)), PALETTE.cream);
    const ys = yG + h + 0.04;
    soil.quad([cx - ux * len / 2 - nx * depth / 2 * 0.9, ys + 0.05, cz - uz * len / 2 - nz * depth / 2 * 0.9], [cx + ux * len / 2 - nx * depth / 2 * 0.9, ys + 0.05, cz + uz * len / 2 - nz * depth / 2 * 0.9], [cx + ux * len / 2 + nx * depth / 2 * 0.9, ys + 0.05, cz + uz * len / 2 + nz * depth / 2 * 0.9], [cx - ux * len / 2 + nx * depth / 2 * 0.9, ys + 0.05, cz - uz * len / 2 + nz * depth / 2 * 0.9], [0, 1, 0], [[0, 0], [len / 3, 0], [len / 3, 0.5], [0, 0.5]]);
    // the collision box (rotated rect)
    world.addBox('2F', cx, cz, len / 2, depth / 2, ang);
    // planting: one tree + understorey
    veg.add(trees[k % trees.length], cx + ux * R.range(-1, 1), ys, cz + uz * R.range(-1, 1), R.range(0.75, 0.95), R.range(0, 6.28), [R.range(0.92, 1.06), R.range(0.94, 1.04), 0.95]);
    const m = Math.round(len * 1.6);
    for (let p = 0; p < m; p++) {
      const t = R.range(-len / 2 + 0.3, len / 2 - 0.3), d = R.range(-depth / 2 + 0.3, depth / 2 - 0.3);
      veg.add(R.pick(['shrub', 'azalea', 'flower', 'grass', 'fern']), cx + ux * t + nx * d, ys, cz + uz * t + nz * d, R.range(0.7, 1.1), R.range(0, 6.28));
    }
    veg.add('hang', cx + nx * depth / 2, ys, cz + nz * depth / 2, R.range(0.7, 1.0), Math.atan2(nx, nz));
    // bench on the free side of the planter, two of them every other planter
    if (k % 2 === 0) {
      const bx = cx + nx * (depth / 2 + 0.55), bz = cz + nz * (depth / 2 + 0.55);
      const bq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -ang);
      const put = (acc, ox, oy, oz, sx, sy, sz, col) => acc.geometry(BOX, new THREE.Matrix4().compose(new THREE.Vector3(bx + ux * ox + nx * oz, yG + oy, bz + uz * ox + nz * oz), bq, new THREE.Vector3(sx, sy, sz)), col);
      for (const o of [-2.2, 2.2]) {
        put(wood, o, 0.43, 0, 1.8, 0.06, 0.45, lin(0xb08a5e)); put(wood, o, 0.7, -0.2, 1.8, 0.3, 0.05, lin(0xb08a5e));
        put(metal, o - 0.8, 0.2, 0, 0.07, 0.4, 0.4, lin(0x30343a)); put(metal, o + 0.8, 0.2, 0, 0.07, 0.4, 0.4, lin(0x30343a));
        world.addBox('2F', bx + ux * o, bz + uz * o, 0.95, 0.28, ang);
      }
    }
    last = f.s; k++; n++;
  }
  const vc = (name, color, r, m) => { if (!M.factories.has(name)) M.define(name, () => new THREE.MeshStandardMaterial({ color, roughness: r, metalness: m, vertexColors: true })); return M.get(name); };
  parks.root.add(stone.mesh(vc('parks_vcol_stone', 0xffffff, 0.8, 0), { name: 'parks:canyon_planters' }));
  parks.root.add(soil.mesh(M.get('parks_groundcover'), { name: 'parks:canyon_soil', cast: false }));
  if (!wood.empty) parks.root.add(wood.mesh(M.get('parks_bench_wood'), { name: 'parks:canyon_benches' }));
  if (!metal.empty) parks.root.add(metal.mesh(M.get('parks_steel_dark'), { name: 'parks:canyon_bench_legs' }));
  parks.canyonPlanters = n;
}
