// =============================================================================
// Parks structures crossing the canyon airspace: bridge slabs, the glazed
// restaurant skywalks (exterior shell), the raised 5F timber boardwalk on
// steel columns, and the lintel over the canyon's north entrance.
// =============================================================================
import * as THREE from 'three';
import { LEVELS } from '../layout.js?v=f150c03';
import { MeshAcc, lin, mulc } from './meshacc.js?v=f150c03';
import { PALETTE, TERRACE_Z } from './canyon.js?v=f150c03';
import { strataFace } from './terraces.js?v=f150c03';

const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 10);
const M4 = () => new THREE.Matrix4();
function box(acc, cx, cy, cz, sx, sy, sz, col) { acc.geometry(BOX, M4().makeTranslation(cx, cy, cz).multiply(M4().makeScale(sx, sy, sz)), col); }

export function buildStructures(ctx, parks) {
  const { world, materials } = ctx;
  const L = world.layout;
  const C = parks.canyon;
  const westFaceAt = (z) => { // canyon west face x near z (fallback 22)
    if (!C) return 22;
    let best = null, bd = 1e9;
    for (const f of C.F) if (f.side === 'w') { const d = Math.abs(f.z - z); if (d < bd) { bd = d; best = f; } }
    return best ? best.x : 22;
  };
  const stone = new MeshAcc(), under = new MeshAcc(), steel = new MeshAcc(), wood = new MeshAcc(), strata = new MeshAcc(), roof = new MeshAcc();
  const cream = PALETTE.cream;
  for (const sp of L.spaces) {
    const y = LEVELS[sp.level].y;
    if (sp.style === 'canyon_bridge') {
      const [x0, z0, x1, z1] = sp.rect;
      const xa = Math.max(x0, westFaceAt((z0 + z1) / 2) - 1.5);
      // slab: soffit + fascias (slightly bellied, with steel ribs)
      under.quadAuto([xa, y - 0.75, z0 - 0.1], [x1, y - 0.75, z0 - 0.1], [x1, y - 0.75, z1 + 0.1], [xa, y - 0.75, z1 + 0.1]);
      box(stone, (xa + x1) / 2, y - 0.38, z0 - 0.06, x1 - xa, 0.76, 0.12, cream);
      box(stone, (xa + x1) / 2, y - 0.38, z1 + 0.06, x1 - xa, 0.76, 0.12, cream);
      for (let x = xa + 2; x < x1 - 1; x += 3) box(steel, x, y - 0.95, (z0 + z1) / 2, 0.18, 0.4, z1 - z0, null);
    } else if (sp.style === 'parks_skywalk') {
      const [x0, z0, x1, z1] = sp.rect;
      const xa = Math.max(x0, 21.5), H = sp.ceil || 3.6;
      under.quadAuto([xa, y - 0.6, z0 - 0.15], [x1, y - 0.6, z0 - 0.15], [x1, y - 0.6, z1 + 0.15], [xa, y - 0.6, z1 + 0.15]);
      box(stone, (xa + x1) / 2, y - 0.3, z0 - 0.1, x1 - xa, 0.6, 0.1, cream);
      box(stone, (xa + x1) / 2, y - 0.3, z1 + 0.1, x1 - xa, 0.6, 0.1, cream);
      // roof slab (visible from the terraces above) — planted sedum roof
      // v6 critic: bottom 2 cm above the skywalk's own ceiling (y + H) — coplanar, it z-fought the wood ceiling (276 m2 on 6F)
      box(stone, (xa + x1) / 2, y + H + 0.31, (z0 + z1) / 2, x1 - xa, 0.58, z1 - z0 + 0.4, cream);
      roof.quadAuto([xa + 0.3, y + H + 0.62, z1 - 0.2], [x1 - 0.3, y + H + 0.62, z1 - 0.2], [x1 - 0.3, y + H + 0.62, z0 + 0.2], [xa + 0.3, y + H + 0.62, z0 + 0.2]);
      // mullions outside the glass
      for (let x = xa + 0.8; x < x1; x += 1.6) for (const zz of [z0 - 0.05, z1 + 0.05]) box(steel, x, y + H / 2, zz, 0.08, H, 0.1, null);
      // horizontal transom
      for (const zz of [z0 - 0.06, z1 + 0.06]) box(steel, (xa + x1) / 2, y + 1.05, zz, x1 - xa, 0.06, 0.08, null);
    } else if (sp.style === 'garden_deck') {
      const [x0, z0, x1, z1] = sp.rect;
      under.quadAuto([x0, y - 0.55, z0], [x1, y - 0.55, z0], [x1, y - 0.55, z1], [x0, y - 0.55, z1]);
      // timber fascias
      for (const [ax, az, bx, bz] of [[x0, z0, x1, z0], [x0, z1, x1, z1], [x0, z0, x0, z1], [x1, z0, x1, z1]]) {
        box(wood, (ax + bx) / 2, y - 0.28, (az + bz) / 2, Math.max(0.12, bx - ax), 0.55, Math.max(0.12, bz - az), null);
      }
      // steel beams
      if (x1 - x0 > z1 - z0) for (let x = x0 + 1; x < x1; x += 2.5) box(steel, x, y - 0.75, (z0 + z1) / 2, 0.22, 0.4, z1 - z0 - 0.4, null);
      else for (let z = z0 + 1; z < z1; z += 2.5) box(steel, (x0 + x1) / 2, y - 0.75, z, x1 - x0 - 0.4, 0.4, 0.22, null);
    }
  }
  // ---- 5F boardwalk columns (down to the terrace below) -------------------------
  const cols = [[53, 233], [53, 243], [59.5, 233], [59.5, 243], [65.5, 233], [65.5, 243]];
  for (const z of [249, 257, 265, 273, 281, 288.5]) cols.push([66.7, z], [71.3, z]);
  for (const [cx, cz] of cols) {
    const t = TERRACE_Z.find(t => cz >= t[0] && cz < t[1]);
    const gy = t ? t[2] : 12, top = 24 - 0.55;
    const lv = gy === 12 ? '3F' : '4F';
    steel.geometry(CYL, M4().makeTranslation(cx, (gy + top) / 2, cz).multiply(M4().makeScale(0.2, top - gy, 0.2)));
    // flared capital
    steel.geometry(CYL, M4().makeTranslation(cx, top - 0.3, cz).multiply(M4().makeScale(0.32, 0.6, 0.32)));
    world.addBox(lv, cx, cz, 0.3, 0.3);
    (parks.columns || (parks.columns = [])).push({ level: lv, x: cx, z: cz, r: 0.3 });
  }
  // ---- north entrance lintel over the canyon ---------------------------------------
  strataFace(strata, 20, 214.4, 50, 214.4, 11, 16.6, 0, 1, 77, { u0: 0 });
  // v6: the soffit started at z 211, inside the Parks 2F hall (z 204..214) whose ceiling is also at y 11: z-fight
  under.quadAuto([20, 11, 214], [50, 11, 214], [50, 11, 214.4], [20, 11, 214.4]);
  box(stone, 35, 16.7, 209.4, 30, 0.2, 10.4, cream);
  parks.planters.push({ kind: 'ledge', a: [21, 16.8, 213.6], b: [49, 16.8, 213.6], a2: [21, 16.8, 205], b2: [49, 16.8, 205], n: [0, 1], y: 16.8 });

  const Mt = materials;
  const vc = (name, color, r, m) => { if (!Mt.factories.has(name)) Mt.define(name, () => new THREE.MeshStandardMaterial({ color, roughness: r, metalness: m, vertexColors: true })); return Mt.get(name); };
  parks.root.add(stone.mesh(vc('parks_vcol_stone', 0xffffff, 0.8, 0), { name: 'parks:struct_stone' }));
  parks.root.add(under.mesh(Mt.get('parks_slab_under'), { name: 'parks:soffits' }));
  parks.root.add(steel.mesh(Mt.get('parks_steel'), { name: 'parks:struct_steel' }));
  parks.root.add(wood.mesh(Mt.get('parks_deck_side'), { name: 'parks:deck_side' }));
  parks.root.add(strata.mesh(Mt.get('parks_strata'), { name: 'parks:lintel' }));
  parks.root.add(roof.mesh(Mt.get('parks_groundcover'), { name: 'parks:sedum' }));
}
