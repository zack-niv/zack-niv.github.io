// =============================================================================
// Exterior massing of the complex and its neighbours, visible from the
// gardens and the streets: Parks west building (mall + dining block) & roofs,
// Parks Tower, the Namba CITY / Nankai viaduct, the Swissotel tower over the
// terminal, Takashimaya's neo-renaissance front on Namba Plaza, and the
// elevated Nankai tracks (with the occasional train) running south.
// All faces sit just OUTSIDE the walkable spaces, facing out.
// =============================================================================
import * as THREE from 'three';
import { rng } from '../../core/rng.js?v=6c67dba';
import { MeshAcc, lin, mulc } from './meshacc.js?v=6c67dba';
import { facadeMat, facadeAcc, facadeQuad, facadeBox, FACADE_U } from './facade.js?v=6c67dba';
import { PALETTE } from './canyon.js?v=6c67dba';
import { strataFace } from './terraces.js?v=6c67dba';

const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 16);
const M4 = () => new THREE.Matrix4();
const box = (acc, cx, cy, cz, sx, sy, sz, col, ry = 0) => acc.geometry(BOX, M4().makeTranslation(cx, cy, cz).multiply(M4().makeRotationY(ry)).multiply(M4().makeScale(sx, sy, sz)), col);

// viaduct centreline: south from the terminal, swinging west past Parks
export function viaductAt(z) {
  if (z < 170) return -17;
  if (z < 260) { const t = (z - 170) / 90; const s = t * t * (3 - 2 * t); return -17 + (-58 + 17) * s; }
  return -58;
}

export function buildMassing(ctx, ex) {
  const { materials } = ctx;
  const root = new THREE.Group(); root.name = 'massing';
  ex.root.add(root);
  const office = facadeAcc('office'), curtain = facadeAcc('curtain'), stoneF = facadeAcc('stone'), grid = facadeAcc('grid');
  const roof = new MeshAcc(), strata = new MeshAcc(), solid = new MeshAcc(), steel = new MeshAcc(), stoneCol = new MeshAcc();
  const R = rng(31337);

  // ---- Parks west building -----------------------------------------------------
  const sand = lin(0xd9c7a8), warmW = lin(0xcbb79a);
  // west face (towards the tracks): strata bands, glazed restaurant floors up top
  strataFace(strata, -22.5, 204, -22.5, 284, 0, 30, -1, 0, 401, { groundAO: true });
  strataFace(strata, -22.5, 284, -22.5, 388.3, 0, 30, -1, 0, 402, { groundAO: true });
  facadeQuad(office, -22.5, 284, -22.5, 388.3, 30, 47, -1, 0, warmW, 0);
  // north face (over the bridge from Namba CITY: leave the bridge opening x -5..5, y 6..10.2)
  strataFace(strata, -22.5, 203.7, -5, 203.7, 0, 30, 0, -1, 403, { groundAO: true });
  strataFace(strata, 5, 203.7, 50, 203.7, 0, 16.6, 0, -1, 404, { groundAO: true });
  strataFace(strata, 5, 203.7, 20.5, 203.7, 16.6, 30, 0, -1, 405);
  strataFace(strata, -5, 203.7, 5, 203.7, 0, 6, 0, -1, 406);
  strataFace(strata, -5, 203.7, 5, 203.7, 10.2, 30, 0, -1, 407);
  // v4: east face of the block between the north face and the canyon walls (above the canyon-entrance
  // lintel): from the 3F garden you looked through the open corner into the mall roof from below
  strataFace(strata, 20.5, 203.7, 20.5, 214.4, 16.6, 30, 1, 0, 409);
  // dining block (6F-8F) east facade over the canyon, north face, south face
  facadeQuad(office, 22.6, 284, 22.6, 324, 30, 47, 1, 0, warmW, 284);
  facadeQuad(office, 22.6, 332, 22.6, 350, 30, 47, 1, 0, warmW, 332);
  facadeQuad(office, 22.6, 358, 22.6, 370, 30, 47, 1, 0, warmW, 358);
  facadeQuad(office, 22.6, 378, 22.6, 388.3, 30, 47, 1, 0, warmW, 378);
  // around the skywalk mouths: spandrels
  for (const [z0, z1, y] of [[324, 332, 30], [350, 358, 36], [370, 378, 42]]) {
    facadeQuad(solid, 22.6, z0, 22.6, z1, y + 3.6, 47, 1, 0, sand);
    if (y > 30) facadeQuad(solid, 22.6, z0, 22.6, z1, 30, y, 1, 0, sand);
  }
  facadeQuad(office, -22.5, 284, 22.6, 284, 30, 47, 0, -1, warmW, 0);
  strataFace(strata, -22.5, 388.3, 22.6, 388.3, 0, 47, 0, 1, 408, { groundAO: true });
  // roofs: mall roof (y 30) and dining roof (y 47) with parapets and plant
  roof.quad([-22.5, 30, 284], [20.5, 30, 284], [20.5, 30, 203.7], [-22.5, 30, 203.7], [0, 1, 0], [[0, 0], [43, 0], [43, 80], [0, 80]], lin(0x8f8a82));
  roof.quad([-22.5, 47, 388.3], [22.6, 47, 388.3], [22.6, 47, 284], [-22.5, 47, 284], [0, 1, 0], [[0, 0], [45, 0], [45, 104], [0, 104]], lin(0x8f8a82));
  for (const [x0, z0, x1, z1, y] of [[-22.5, 203.7, 20.5, 284, 30], [-22.5, 284, 22.6, 388.3, 47]]) {
    box(stoneCol, (x0 + x1) / 2, y + 0.5, z0 + 0.15, x1 - x0, 1, 0.3, PALETTE.cream);
    box(stoneCol, (x0 + x1) / 2, y + 0.5, z1 - 0.15, x1 - x0, 1, 0.3, PALETTE.cream);
    box(stoneCol, x0 + 0.15, y + 0.5, (z0 + z1) / 2, 0.3, 1, z1 - z0, PALETTE.cream);
    for (let k = 0; k < 14; k++) box(solid, R.range(x0 + 3, x1 - 3), y + 0.8, R.range(z0 + 3, z1 - 3), R.range(1.5, 4), R.range(1, 2), R.range(1.5, 3), lin(0xb4b2ae));
  }

  // ---- Parks Tower (office, ~150 m) -------------------------------------------------
  {
    const x0 = 60, z0 = 152, x1 = 102, z1 = 196, top = 148;
    const c = lin(0xc8ccd0);
    facadeBox(curtain, roof, x0, z0, x1, z1, 14, top, c, '', lin(0x7b7d80));
    // podium in strata, joining the 3F garden
    strataFace(strata, x0 - 6, 150, x1 + 6, 150, 0, 14, 0, -1, 410, { groundAO: true });
    strataFace(strata, x0 - 6, 150, x0 - 6, 203.7, 0, 14, -1, 0, 411, { groundAO: true });
    strataFace(strata, x1 + 6, 150, x1 + 6, 203.7, 0, 14, 1, 0, 412, { groundAO: true });
    roof.quad([x0 - 6, 14, 203.7], [x1 + 6, 14, 203.7], [x1 + 6, 14, 150], [x0 - 6, 14, 150], [0, 1, 0], null, lin(0x9a948a));
    // vertical fins & crown
    for (let x = x0; x <= x1; x += 4.2) { box(steel, x, (14 + top) / 2, z0 - 0.3, 0.3, top - 14, 0.6); box(steel, x, (14 + top) / 2, z1 + 0.3, 0.3, top - 14, 0.6); }
    for (let z = z0; z <= z1; z += 4.4) { box(steel, x0 - 0.3, (14 + top) / 2, z, 0.6, top - 14, 0.3); box(steel, x1 + 0.3, (14 + top) / 2, z, 0.6, top - 14, 0.3); }
    box(solid, (x0 + x1) / 2, top + 4, (z0 + z1) / 2, x1 - x0 - 6, 8, z1 - z0 - 6, lin(0xd0d2d4));
    box(steel, (x0 + x1) / 2, top + 9, (z0 + z1) / 2, 6, 2, 6);
    if (ctx.lighting) {} // aviation lights are emissive only
    ex.aviation = [[(x0 + x1) / 2, top + 10.5, (z0 + z1) / 2]];
  }

  // ---- Namba CITY under the viaduct (east & west faces) ------------------------------
  facadeQuad(grid, 30.6, -40, 30.6, 190, 0, 11.4, 1, 0, lin(0xd6d0c4), 0);
  facadeQuad(grid, -30.6, -40, -30.6, 190, 0, 11.4, -1, 0, lin(0xd6d0c4), 0);
  facadeQuad(solid, -30.6, 190.3, 30.6, 190.3, 0, 6, 0, 1, lin(0xc9c2b4));
  facadeQuad(solid, -30.6, 190.3, -5, 190.3, 6, 11.4, 0, 1, lin(0xc9c2b4));
  facadeQuad(solid, 5, 190.3, 30.6, 190.3, 6, 11.4, 0, 1, lin(0xc9c2b4));
  facadeQuad(solid, -5, 190.3, 5, 190.3, 10.2, 11.4, 0, 1, lin(0xc9c2b4));

  // ---- Nankai terminal: train shed roof + Swissotel tower ----------------------------
  {
    // shed over the platforms (3F) — the roof as seen from outside/above
    roof.quad([-54, 21.5, 112], [22, 21.5, 112], [22, 21.5, -86], [-54, 21.5, -86], [0, 1, 0], null, lin(0x8e9196));
    facadeQuad(solid, -54, 112, 22, 112, 19.5, 21.5, 0, 1, lin(0x6f7378));
    facadeQuad(grid, 40.3, -132, 40.3, -60, 0, 22, 1, 0, lin(0xcfc6b5), 0);
    facadeQuad(grid, -60.3, -100, -60.3, -60, 0, 22, -1, 0, lin(0xcfc6b5), 0);
    // Swissotel Nankai: a 147 m tower rising from the terminal building
    const x0 = -50, z0 = -128, x1 = -14, z1 = -96;
    facadeBox(office, roof, x0, z0, x1, z1, 22, 147, lin(0xd9d4cc), '', lin(0x77736e));
    box(solid, (x0 + x1) / 2, 150, (z0 + z1) / 2, x1 - x0 - 4, 6, z1 - z0 - 4, lin(0xe0dbd2));
    roof.quad([-60, 22, -60], [40, 22, -60], [40, 22, -132], [-60, 22, -132], [0, 1, 0], null, lin(0x8c8780));
    (ex.aviation || (ex.aviation = [])).push([(x0 + x1) / 2, 154, (z0 + z1) / 2]);
  }

  // ---- Takashimaya (Nankai Building) — neo-renaissance front on the plaza -------------
  buildTakashimaya(ctx, stoneF, stoneCol, roof, solid);

  // ---- Nankai viaduct south of the terminal ------------------------------------------
  const via = new MeshAcc(), rails = new MeshAcc();
  {
    const tracks = 4, sp = 4.3, W = tracks * sp + 3;
    const deckY = 10.8;
    let prev = null;
    for (let z = 112; z <= 880; z += 4) {
      const cx = viaductAt(z), cur = [cx, z];
      if (prev) {
        const [px, pz] = prev;
        // deck top (ballast), sides
        via.quadAuto([px - W / 2, deckY, pz], [cx - W / 2, deckY, z], [cx + W / 2, deckY, z], [px + W / 2, deckY, pz], [[0, 0], [0, 1], [1, 1], [1, 0]], lin(0x55504a));
        via.quadAuto([px - W / 2, deckY - 1.6, pz], [cx - W / 2, deckY - 1.6, z], [cx - W / 2, deckY + 0.9, z], [px - W / 2, deckY + 0.9, pz], null, lin(0xa8a49c));
        via.quadAuto([cx + W / 2, deckY - 1.6, z], [px + W / 2, deckY - 1.6, pz], [px + W / 2, deckY + 0.9, pz], [cx + W / 2, deckY + 0.9, z], null, lin(0xa8a49c));
        via.quadAuto([px + W / 2, deckY - 1.6, pz], [cx + W / 2, deckY - 1.6, z], [cx - W / 2, deckY - 1.6, z], [px - W / 2, deckY - 1.6, pz], null, lin(0x8d8a84));
        for (let t = 0; t < tracks; t++) for (const o of [-0.53, 0.53]) {
          const ox = -((tracks - 1) / 2) * sp + t * sp + o;
          box(rails, (px + cx) / 2 + ox, deckY + 0.2, (pz + z) / 2, 0.08, 0.16, 4.05, null, Math.atan2(cx - px, z - pz));
        }
      }
      // piers every 16 m, catenary masts every 48 m
      if (z > 196 && z % 16 === 0) {
        box(via, cx - W / 2 + 2, (deckY - 1.6) / 2, z, 1.6, deckY - 1.6, 1.6, lin(0x9d9890));
        box(via, cx + W / 2 - 2, (deckY - 1.6) / 2, z, 1.6, deckY - 1.6, 1.6, lin(0x9d9890));
      }
      if (z % 48 === 0) {
        box(rails, cx - W / 2 + 0.3, deckY + 3.5, z, 0.25, 7, 0.25);
        box(rails, cx, deckY + 6.8, z, W - 0.6, 0.2, 0.2);
      }
      prev = cur;
    }
    ex.viaduct = { deckY, tracks, sp };
  }

  // ---- emit -----------------------------------------------------------------------
  const add = (acc, mat, name, cast = true) => { if (!acc.empty) root.add(acc.mesh(mat, { name, cast })); };
  const M = materials;
  const vc = (name, color, r, m) => { if (!M.factories.has(name)) M.define(name, () => new THREE.MeshStandardMaterial({ color, roughness: r, metalness: m, vertexColors: true })); return M.get(name); };
  add(office, facadeMat(ctx, 'office'), 'mass:office');
  add(curtain, facadeMat(ctx, 'curtain'), 'mass:curtain');
  add(grid, facadeMat(ctx, 'grid'), 'mass:grid');
  add(stoneF, facadeMat(ctx, 'stone'), 'mass:stonefacade');
  add(strata, M.get('parks_strata'), 'mass:strata');
  add(roof, vc('out_roof', 0xffffff, 0.92, 0), 'mass:roofs', false);
  add(solid, vc('out_solid', 0xffffff, 0.85, 0), 'mass:solid');
  add(stoneCol, vc('out_stone', 0xffffff, 0.7, 0), 'mass:stone');
  add(steel, vc('out_steel', 0x9aa0a6, 0.4, 0.6), 'mass:steel');
  add(via, vc('out_concrete', 0xffffff, 0.9, 0), 'mass:viaduct');
  add(rails, M.get('parks_steel_dark'), 'mass:rails', false);
  // aviation lights (blink)
  const av = new THREE.InstancedMesh(new THREE.SphereGeometry(0.6, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 0.4, 0.2) }), ex.aviation.length);
  ex.aviation.forEach((p, i) => av.setMatrixAt(i, M4().makeTranslation(p[0], p[1], p[2])));
  av.name = 'mass:aviation'; root.add(av);

  // ---- trains on the viaduct ---------------------------------------------------------
  const trains = buildTrains(ctx, root, ex);
  return {
    update(dt) {
      FACADE_U.uNight.value = ex.daylight.night;
      FACADE_U.uSkyCol.value.copy(ex.daylight.hor).multiplyScalar(1.4);
      const t = performance.now() / 1000;
      av.visible = (t % 1.6) < 0.5;
      av.material.color.setRGB(8, 0.4, 0.2).multiplyScalar(0.3 + ex.daylight.night);
      trains.update(dt);
    },
  };
}

// -----------------------------------------------------------------------------------
function buildTakashimaya(ctx, facade, stone, roof, solid) {
  const cream = lin(0xe3d6bd), cream2 = lin(0xd6c7aa), dark = lin(0x3b3833);
  const zf = -184.35, x0 = -96.3, x1 = 20, top = 38;
  // north front: rusticated base, giant order 2F-5F, attic, cornice
  // base (leave the entrance x -70..-50 open to 4.6 m)
  facadeQuad(facade, x0, zf, -70, zf, 4.6, 8, 0, -1, cream2);
  facadeQuad(facade, -70, zf, -50, zf, 4.6, 8, 0, -1, cream2);
  facadeQuad(facade, -50, zf, x1, zf, 0, 8, 0, -1, cream2);
  facadeQuad(facade, x0, zf, -70, zf, 0, 4.6, 0, -1, cream2);
  facadeQuad(facade, x0, zf, x1, zf, 8, top, 0, -1, cream);
  // entrance canopy + glass doors (visual) over the door
  stone.geometry(BOX, M4().makeTranslation(-60, 4.9, zf - 1.6).multiply(M4().makeScale(22, 0.5, 3.4)), cream);
  // rustication grooves on the base
  for (let y = 0.9; y < 8; y += 0.9) stone.geometry(BOX, M4().makeTranslation((x0 + x1) / 2, y, zf - 0.08).multiply(M4().makeScale(x1 - x0, 0.06, 0.16)), cream2);
  // giant order columns (engaged), with bases and capitals
  for (let x = x0 + 3; x < x1 - 1; x += 6.2) {
    if (x > -71 && x < -49) continue; // entrance bay gets free-standing pair below
    stone.geometry(CYL, M4().makeTranslation(x, 19, zf - 0.75).multiply(M4().makeScale(0.75, 21, 0.75)), cream);
    stone.geometry(BOX, M4().makeTranslation(x, 8.4, zf - 0.75).multiply(M4().makeScale(1.9, 0.8, 1.9)), cream2);
    stone.geometry(BOX, M4().makeTranslation(x, 29.8, zf - 0.8).multiply(M4().makeScale(2.0, 0.9, 2.0)), cream2);
    stone.geometry(BOX, M4().makeTranslation(x, 30.5, zf - 0.85).multiply(M4().makeScale(2.3, 0.5, 2.1)), cream);
  }
  // arched windows between columns (dark recesses)
  for (let x = x0 + 6.1; x < x1 - 3; x += 6.2) {
    if (x > -73 && x < -47) continue;
    for (const [yb, h] of [[10, 7], [19.5, 7.5]]) {
      solid.geometry(BOX, M4().makeTranslation(x, yb + h / 2, zf - 0.03).multiply(M4().makeScale(3.0, h, 0.1)), dark);
      solid.geometry(new THREE.CylinderGeometry(1.5, 1.5, 0.1, 12, 1, false, 0, Math.PI), M4().makeTranslation(x, yb + h, zf - 0.03).multiply(M4().makeRotationX(Math.PI / 2)).multiply(M4().makeRotationY(Math.PI / 2)), dark);
    }
  }
  // entablature, cornice, attic
  stone.geometry(BOX, M4().makeTranslation((x0 + x1) / 2, 31.6, zf - 0.6).multiply(M4().makeScale(x1 - x0, 1.6, 1.4)), cream);
  stone.geometry(BOX, M4().makeTranslation((x0 + x1) / 2, 32.7, zf - 1.1).multiply(M4().makeScale(x1 - x0 + 1, 0.6, 2.4)), cream2);
  stone.geometry(BOX, M4().makeTranslation((x0 + x1) / 2, top + 0.3, zf - 0.6).multiply(M4().makeScale(x1 - x0 + 0.6, 0.6, 1.4)), cream);
  // west front along Midosuji (x = -96.3), entrance gap for nankai_1f_west (z -124..-108)
  const xf = -96.35;
  facadeQuad(facade, xf, -184.3, xf, -124, 0, top, -1, 0, cream2);
  facadeQuad(facade, xf, -124, xf, -108, 4.2, top, -1, 0, cream2);
  facadeQuad(facade, xf, -108, xf, -40, 0, 26, -1, 0, cream2);
  for (let z = -181; z < -42; z += 6.2) {
    if (z > -126 && z < -106) continue;
    stone.geometry(BOX, M4().makeTranslation(xf - 0.4, (z < -132 ? top : 26) / 2, z).multiply(M4().makeScale(0.8, z < -132 ? top : 26, 1.2)), cream);
  }
  roof.quad([x0, top, -132], [x1, top, -132], [x1, top, zf], [x0, top, zf], [0, 1, 0], null, lin(0x8a8680));
  // east side of the store above the street (to the Sennichimae concourse block)
  facadeQuad(facade, x1 + 0.3, zf, x1 + 0.3, -132, 0, top, 1, 0, cream2);
}


// -----------------------------------------------------------------------------------
// Nankai trains on the viaduct: 6-car sets of orange/silver (or blue rapi:t)
function buildTrains(ctx, root, ex) {
  const via = ex.viaduct;
  const car = new MeshAcc();
  // one car body 20 m: silver with orange stripe, windows band
  const body = (cx, cy, cz, sx, sy, sz, col) => car.geometry(BOX, M4().makeTranslation(cx, cy, cz).multiply(M4().makeScale(sx, sy, sz)), col);
  body(0, 1.95, 0, 2.85, 2.9, 19.6, lin(0xc9cdd2));
  body(0, 2.2, 0, 2.9, 0.75, 19.0, lin(0x2c3036));
  body(0, 1.25, 0, 2.9, 0.22, 19.2, lin(0xf08300));
  body(0, 1.55, 0, 2.9, 0.08, 19.2, lin(0xd0272f));
  body(0, 3.45, 0, 2.4, 0.2, 18.5, lin(0x9ca1a6));
  const geo = car.build(true);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.5 });
  const CARS = 6, SETS = 3;
  const im = new THREE.InstancedMesh(geo, mat, CARS * SETS);
  im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  im.castShadow = true; im.frustumCulled = false; im.name = 'mass:trains';
  root.add(im);
  const sets = [];
  for (let s = 0; s < SETS; s++) sets.push({ track: s % via.tracks, dir: s % 2 ? -1 : 1, t: s * 70, period: 150 + s * 37 });
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  return {
    update(dt) {
      let k = 0;
      for (const S of sets) {
        S.t = (S.t + dt) % S.period;
        // run 0..90 s along the viaduct (accelerating from / braking into the terminal)
        const tt = Math.min(S.t, 90) / 90;
        const s = S.dir > 0 ? tt * tt * 760 : (1 - tt) * (1 - tt) * 760;
        const zHead = 120 + s;
        for (let c = 0; c < CARS; c++) {
          const z = zHead - c * 20.2 * (S.dir > 0 ? 1 : -1) + (S.dir > 0 ? 0 : 0);
          const zz = Math.max(118, z);
          const x = viaductAt(zz) - ((via.tracks - 1) / 2) * via.sp + S.track * via.sp;
          const ang = Math.atan2(viaductAt(zz + 2) - viaductAt(zz - 2), 4);
          p.set(x, via.deckY + 0.3, zz); q.setFromAxisAngle(up, ang);
          sc.setScalar(z < 118 || S.t > 90 ? 0 : 1);
          m.compose(p, q, sc); im.setMatrixAt(k++, m);
        }
      }
      im.instanceMatrix.needsUpdate = true;
    },
  };
}
