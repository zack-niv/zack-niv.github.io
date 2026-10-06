// =============================================================================
// The street: Sennichimae-dori (E–W) and Midosuji (N–S) around the complex.
// Roads, kerbs, guard rails, crossings & signals, traffic, neon frontages on
// both sides, the Midosuji ginkgo avenue, Namba Plaza furniture, street lamps,
// bicycles and vending machines, the city's ground plane.
// All content sits OUTSIDE the walkable cells (the walls the player bumps into
// are dressed here); the few things inside walkable space are registered with
// world.addBox.
// =============================================================================
import * as THREE from 'three';
import { rng } from '../../core/rng.js';
import { EDGE } from '../world.js';
import { MeshAcc, lin, mulc } from './meshacc.js';
import { Frontages, prepareStorefrontTextures, updateStorefronts } from './storefront.js';
import { buildTraffic } from './traffic.js';
import { Vegetation } from './vegetation.js';
import { FACADE_U, facadeMat, FKIND } from './facade.js';

// ---- layout constants ---------------------------------------------------------
export const SEN = { z0: -252, z1: -206 };           // Sennichimae-dori carriageway incl. bays
export const MIDO = { x0: -156, x1: -104 };          // Midosuji avenue incl. sidewalks
const Y_ROAD = -0.12;                                // carriageway surface (sidewalks are y = 0)
const FAR = 760;                                     // how far the roads run
// pit rects (stair wells that open into the street): keep roads/paving away
const PITS = [[-60.3, -252, -53.7, -239.7], [39.7, -252, 46.3, -239.7], [139.7, -252, 146.3, -239.7], [-108.3, -198.3, -103.7, -193.7]];
export const ZEBRAS = [-101, -47, 51, 151];          // x centres of the crossings over Sennichimae-dori
// vehicle lanes (left-hand traffic)
const LANES = [];
{
  for (const z of [-238.3, -234.9, -231.5]) LANES.push({ x0: -FAR, z0: z, x1: FAR, z1: z, speed: 9.5, y: Y_ROAD, stop: { s: -158 + FAR, group: 'A' }, spacing: 60, bus: z === -238.3 });
  for (const z of [-226.5, -223.1, -219.7]) LANES.push({ x0: FAR, z0: z, x1: -FAR, z1: z, speed: 9.5, y: Y_ROAD, stop: { s: FAR + 102, group: 'A' }, spacing: 60, bus: z === -219.7 });
  for (const x of [-140.25, -136.75, -133.25, -129.75, -126.25, -122.75]) LANES.push({ x0: x, z0: -FAR, x1: x, z1: FAR, speed: 11, y: Y_ROAD, stop: { s: FAR - 254, group: 'B' }, spacing: 52 });
  for (const x of [-148, -114.5]) LANES.push({ x0: x, z0: FAR, x1: x, z1: -FAR, speed: 8, y: Y_ROAD, stop: { s: FAR + 204, group: 'B' }, spacing: 80 });
}

function asphaltTexture(ctx) {
  return ctx.materials.texture('out_asphalt', () => {
    const S = 512, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
    const R = rng(2024);
    g.fillStyle = '#4b4d50'; g.fillRect(0, 0, S, S);
    for (let k = 0; k < 26000; k++) { const v = R.range(55, 125) | 0; g.fillStyle = `rgba(${v},${v},${v + 2},${R.range(0.1, 0.5)})`; g.fillRect(R.range(0, S), R.range(0, S), R.range(1, 3), R.range(1, 3)); }
    for (let k = 0; k < 14; k++) { g.strokeStyle = `rgba(20,20,22,${R.range(0.08, 0.2)})`; g.lineWidth = R.range(0.6, 1.6); g.beginPath(); let x = R.range(0, S), y = R.range(0, S); g.moveTo(x, y); for (let j = 0; j < 8; j++) { x += R.range(-30, 30); y += R.range(-30, 30); g.lineTo(x, y); } g.stroke(); }
    // faint tyre polish bands
    for (let k = 0; k < 4; k++) { g.fillStyle = 'rgba(30,30,32,0.12)'; g.fillRect(R.range(0, S), 0, R.range(18, 40), S); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
    return t;
  });
}

// ---- small geometry helpers -------------------------------------------------------
function boxAcc(acc, cx, cy, cz, sx, sy, sz, col, uvScale = 0) {
  const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
  const uvT = uvScale ? [[x0 * uvScale, z1 * uvScale], [x1 * uvScale, z1 * uvScale], [x1 * uvScale, z0 * uvScale], [x0 * uvScale, z0 * uvScale]] : null;
  acc.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], uvT, col);
  acc.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], null, col);
  acc.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], null, col);
  acc.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], null, col);
  acc.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], null, col);
}
// flat horizontal rect facing up, uv in metres / scale
function flat(acc, x0, z0, x1, z1, y, col, scale = 1 / 6) {
  if (x1 - x0 < 0.001 || z1 - z0 < 0.001) return;
  acc.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0], [[x0 * scale, z1 * scale], [x1 * scale, z1 * scale], [x1 * scale, z0 * scale], [x0 * scale, z0 * scale]], col);
}
// rectangle with rectangular holes, as quads
function flatHoles(acc, x0, z0, x1, z1, y, holes, col, scale = 1 / 6) {
  const hs = holes.filter(h => h[2] > x0 && h[0] < x1 && h[3] > z0 && h[1] < z1);
  if (!hs.length) return flat(acc, x0, z0, x1, z1, y, col, scale);
  const xs = [x0, x1]; for (const h of hs) { xs.push(Math.max(x0, Math.min(x1, h[0])), Math.max(x0, Math.min(x1, h[2]))); }
  xs.sort((a, b) => a - b);
  for (let i = 0; i < xs.length - 1; i++) {
    const a = xs[i], b = xs[i + 1]; if (b - a < 0.001) continue;
    const cut = hs.filter(h => h[0] < b - 1e-4 && h[2] > a + 1e-4).map(h => [Math.max(z0, h[1]), Math.min(z1, h[3])]).sort((p, q) => p[0] - q[0]);
    let z = z0;
    for (const [c0, c1] of cut) { if (c0 > z) flat(acc, a, z, b, c0, y, col, scale); z = Math.max(z, c1); }
    if (z < z1) flat(acc, a, z, b, z1, y, col, scale);
  }
}
const inPit = (x, z, m = 0.6) => PITS.some(p => x > p[0] - m && x < p[2] + m && z > p[1] - m && z < p[3] + m);

const _cam = new THREE.Vector3();
export async function buildStreets(ctx, ex) {
  const { world, materials: M, engine } = ctx;
  const L = world.layout;
  const root = new THREE.Group(); root.name = 'street';
  ex.root.add(root);
  await prepareStorefrontTextures();
  const R = rng(8080);
  const timings = {};
  const tick = (k, t0) => { timings[k] = Math.round(performance.now() - t0); };
  let t0 = performance.now();

  // ---- materials ----------------------------------------------------------------
  const defineStd = (name, f) => { if (!M.factories.has(name)) M.define(name, f); return M.get(name); };
  const asphaltM = defineStd('out_asphalt', () => { const m = new THREE.MeshStandardMaterial({ map: asphaltTexture(ctx), color: 0xffffff, roughness: 0.92, vertexColors: true }); m.userData.nbReflect = 0.25; return m; });
  const paveM = defineStd('out_walkpave', () => { const m = new THREE.MeshStandardMaterial({ map: asphaltTexture(ctx), color: 0xb7b2a6, roughness: 0.85, vertexColors: true }); m.userData.nbReflect = 0; return m; });
  const markM = defineStd('out_markings', () => new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  const stoneM = defineStd('out_street_stone', () => new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.8 }));
  const steelM = defineStd('out_street_steel', () => new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.4, metalness: 0.7 }));
  const soilM = M.get('parks_soil');
  const lampGlow = defineStd('out_lamp_glow', () => new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.88, 0.65).multiplyScalar(2) }));

  // ---- roads ---------------------------------------------------------------------
  const BOXG = new THREE.BoxGeometry(1, 1, 1);
  const road = new MeshAcc(), walk = new MeshAcc(), marks = new MeshAcc(), kerb = new MeshAcc(), soil = new MeshAcc(), steel = new MeshAcc(), pole = new MeshAcc();
  const D = lin(0x9a9a9a), D2 = lin(0xb0b0b0);
  const WHITE = [0.85, 0.85, 0.82], YEL = [0.9, 0.62, 0.05];
  const MX0 = MIDO.x0 + 6, MX1 = MIDO.x1 - 9;           // Midosuji carriageway x -150 .. -113
  // Sennichimae carriageway (west/east of the Midosuji crossing is the same slab)
  flatHoles(road, -FAR, SEN.z0, FAR, SEN.z1, Y_ROAD, PITS, [1, 1, 1], 1 / 8);
  // Midosuji carriageway, both directions beyond the crossing
  flat(road, MX0, -FAR, MX1, SEN.z0, Y_ROAD, [1, 1, 1], 1 / 8);
  flat(road, MX0, SEN.z1, MX1, FAR, Y_ROAD, [1, 1, 1], 1 / 8);
  // Midosuji between sidewalks beyond the intersection: full width raised strips are 'walk' items below
  // sidewalk-level strips: west sidewalk, ginkgo strips, east sidewalk (outside the walkable cells)
  const stripsMido = [[MIDO.x0, MIDO.x0 + 6], [-146, -142], [-121, -117], [MIDO.x1 - 9, MIDO.x1]];
  for (const [a, b] of stripsMido) for (const [z0, z1] of [[-FAR, SEN.z0 - 6], [SEN.z1 + 6, FAR]]) {
    // (the east sidewalk of Midosuji x -113..-104 stays clear of the walkable midosuji_e_walk x -104..-96)
    const holes = PITS;
    const isTree = (a === -146 || a === -121);
    flatHoles(isTree ? soil : walk, a, z0, b, z1, 0.0, holes, isTree ? [0.9, 0.9, 0.9] : [1, 1, 1], isTree ? 1 / 3 : 1 / 6);
    // kerb faces along both long edges
    for (const x of [a, b]) kerb.quad([x, Y_ROAD, z0], [x, Y_ROAD, z1], [x, 0.0, z1], [x, 0.0, z0], [x === a ? -1 : 1, 0, 0], null, D2);
    // (kerb face winding: normals given; positions order is cosmetic for double-use)
  }
  // north/south sidewalks beyond the walkable cells (x > 210 and x < MIDO.x0), and the corners
  const sideStrips = [[-FAR, MIDO.x0, -258, -252], [210, FAR, -258, -252], [-FAR, MIDO.x0, -206, -200], [210, FAR, -206, -200], [190, 210, -206, -200]];
  for (const [x0, x1, z0, z1] of sideStrips) {
    if (x0 >= 190 && x1 === 210) continue; // already walkable (street_e_plaza joins the strip)
    flatHoles(walk, x0, z0, x1, z1, 0.0, PITS, [1, 1, 1], 1 / 6);
  }
  // Midosuji east sidewalk corners (x -113..-104) connect to the Sennichimae sidewalks: fill the corner squares
  flat(walk, MIDO.x1 - 9, SEN.z0 - 6, MIDO.x1, SEN.z0, 0.0, [1, 1, 1], 1 / 6);
  flatHoles(walk, MIDO.x1 - 9, SEN.z1, MIDO.x1, SEN.z1 + 6, 0.0, PITS, [1, 1, 1], 1 / 6);
  flat(walk, MIDO.x0, SEN.z0 - 6, MIDO.x0 + 6, SEN.z0, 0.0, [1, 1, 1], 1 / 6);
  flat(walk, MIDO.x0, SEN.z1, MIDO.x0 + 6, SEN.z1 + 6, 0.0, [1, 1, 1], 1 / 6);
  // east sidewalk of Midosuji along the walkable strip: x -113..-104 from z -206 .. -40
  flatHoles(walk, MIDO.x1 - 9, SEN.z1, MIDO.x1, SEN.z1 + 6, 0.0, PITS, [1, 1, 1], 1 / 6);
  flatHoles(walk, MIDO.x1 - 9, SEN.z1 + 6, MIDO.x1, FAR, 0.0, PITS, [1, 1, 1], 1 / 6);

  // kerbs along Sennichimae sidewalk edges beyond the walkable region (visual)
  for (const [x0, x1, z, nz] of [[-FAR, MIDO.x0, -252, 1], [210, FAR, -252, 1], [-FAR, MIDO.x0, -206, -1], [210, FAR, -206, -1]]) {
    // wall at z facing the road: vertical kerb face from road to sidewalk
    kerb.quad([x0, Y_ROAD, z], [x1, Y_ROAD, z], [x1, 0.0, z], [x0, 0.0, z], [0, 0, nz], null, D2);
  }
  // road markings ------------------------------------------------------------------
  const dash = (x0, z0, x1, z1, w, col, a = 4, g = 6, y = Y_ROAD + 0.006) => {
    const len = Math.hypot(x1 - x0, z1 - z0), dx = (x1 - x0) / len, dz = (z1 - z0) / len;
    for (let s = 0; s < len; s += a + g) {
      const e = Math.min(len, s + a);
      const ax = x0 + dx * s, az = z0 + dz * s, bx = x0 + dx * e, bz = z0 + dz * e;
      const nx = -dz * w / 2, nz = dx * w / 2;
      marks.quad([ax - nx, y, az - nz], [bx - nx, y, bz - nz], [bx + nx, y, bz + nz], [ax + nx, y, az + nz], [0, 1, 0], null, col);
    }
  };
  const rectMark = (x0, z0, x1, z1, col, y = Y_ROAD + 0.006) => { marks.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0], null, col); };
  // Sennichimae: lane dashes (skip across the Midosuji intersection and the crossings)
  const clearX = (x) => (x > MIDO.x0 - 2 && x < MIDO.x1 + 8) || ZEBRAS.some(zx => Math.abs(x - zx) < 6);
  const segs = [];
  { let x = -FAR; while (x < FAR) { const nx = x + 10; if (!clearX(x + 5)) segs.push([x, nx]); x = nx; } }
  for (const [a, b] of segs) {
    for (const z of [-235.1 + 0.0, -231.7 + 0.0]) { dash(a, z, a + 3, z, 0.15, WHITE, 3, 7); }          // EB lane lines
    for (const z of [-224.9, -221.4]) { dash(a, z, a + 3, z, 0.15, WHITE, 3, 7); }                     // WB lane lines
    rectMark(a, -229.15, b, -229.0, YEL); rectMark(a, -228.85, b, -228.7, YEL);                          // double centre line
  }
  // edge lines + bay lines
  for (const [a, b] of segs) {
    for (const z of [-239.9, -218.0]) rectMark(a, z - 0.07, b, z + 0.07, WHITE);
  }
  // Midosuji: dashed lane lines (southbound six lanes)
  { let z = -FAR; while (z < FAR) { const nz = z + 10; const inX = z + 5 > SEN.z0 - 4 && z + 5 < SEN.z1 + 4; if (!inX) { for (const x of [-138.5, -135.0, -131.5, -128.0, -124.5]) dash(x, z, x, z + 3, 0.15, WHITE, 3, 7); rectMark(-142.07, z, -141.93, nz, WHITE); rectMark(-121.07, z, -120.93, nz, WHITE); } z = nz; } }
  // crossings (zebra) over Sennichimae-dori & over Midosuji both sides of the intersection
  const zebra = (cx, z0, z1, alongZ) => {
    const n = Math.floor((z1 - z0) / 0.9);
    for (let i = 0; i < n; i++) { const z = z0 + i * 0.9 + 0.1; rectMark(cx - 2.2, z, cx + 2.2, z + 0.45, [0.9, 0.9, 0.88]); }
  };
  for (const zx of ZEBRAS) { zebra(zx, SEN.z0 + (inPit(zx, -245, 1) ? 12 : 0) + 0.5, SEN.z1 - 0.5, true); }
  // stop lines
  rectMark(-159.6, -240, -158.4, -229.8, WHITE); rectMark(-103.6, -228.2, -102.4, -218, WHITE);
  rectMark(-143, -254.6, -121, -253.6, WHITE); rectMark(-150, -204.6, -146, -203.6, WHITE); rectMark(-117, -204.6, -113, -203.6, WHITE);
  // zebra over Midosuji (north side of the intersection) and (south)
  for (const zz of [-247, -206 + 0]) for (let i = 0; i < 40; i++) { const x = MX0 + i * 0.95 + 0.2; if (x > MX1 - 0.5) break; marks.quad([x, Y_ROAD + 0.006, zz - 0.9 + 4.4], [x + 0.5, Y_ROAD + 0.006, zz - 0.9 + 4.4], [x + 0.5, Y_ROAD + 0.006, zz - 0.9 - 0.0 + 0.0], [x, Y_ROAD + 0.006, zz - 0.9], [0, 1, 0], null, [0.9, 0.9, 0.88]); }
  // bay hatching: loading bays (south bay) painted
  for (let x = -FAR; x < FAR; x += 14) if (!clearX(x + 3)) { rectMark(x, -218.0 - 0.0, x + 0.1, -206.4, [0.85, 0.85, 0.8]); }
  // ---- sidewalk kerb + guard rail along WALKABLE wall edges, planters on Midosuji --------
  const edges = world.edges['1F'] || [];
  const rail = (ax, az, bx, bz) => {
    const len = Math.hypot(bx - ax, bz - az); if (len < 0.05) return;
    const tx = (bx - ax) / len, tz = (bz - az) / len, ang = Math.atan2(-tz, tx);
    const m = new THREE.Matrix4().compose(new THREE.Vector3((ax + bx) / 2, 0.92, (az + bz) / 2), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang), new THREE.Vector3(len, 0.05, 0.05));
    steel.geometry(BOXG, m, [0.72, 0.74, 0.76]);
    m.compose(new THREE.Vector3((ax + bx) / 2, 0.45, (az + bz) / 2), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang), new THREE.Vector3(len, 0.04, 0.04));
    steel.geometry(BOXG, m, [0.72, 0.74, 0.76]);
    const n = Math.max(1, Math.round(len / 2));
    for (let i = 0; i <= n; i++) steel.geometry(BOXG, new THREE.Matrix4().makeTranslation(ax + (bx - ax) * i / n, 0.5, az + (bz - az) * i / n).multiply(new THREE.Matrix4().makeScale(0.06, 1.0, 0.06)), [0.62, 0.64, 0.66]);
  };
  const region = (x, z) => {
    if (z > SEN.z0 && z < SEN.z1) return 'road';
    if (x > MX0 && x < MX1) return 'road';
    if (x > MIDO.x1 - 9 && x < MIDO.x1) return 'walk';
    if (x >= MIDO.x0 && x <= MIDO.x0 + 6) return 'walk';
    if ((z >= -258 && z <= SEN.z0) || (z >= SEN.z1 && z <= -200)) return 'walk';
    return 'building';
  };
  const hedgeRuns = [];
  let nRail = 0;
  for (const e of edges) {
    if (e.kind !== EDGE.WALL) continue;
    const spA = e.spaceA >= 0 ? L.spaces[e.spaceA] : null, spB = e.spaceB >= 0 ? L.spaces[e.spaceB] : null;
    const walkSp = e.nx < 0 || e.nz < 0 ? spA : e.nx > 0 || e.nz > 0 ? spB : spA;
    if (!walkSp || !walkSp.outdoor) continue;
    const mx = (e.ax + e.bx) / 2, mz = (e.az + e.bz) / 2;
    const reg = region(mx - e.nx * 1.0, mz - e.nz * 1.0);
    // split the segment into 1 m pieces so crossings / pits can open gaps
    const len = Math.hypot(e.bx - e.ax, e.bz - e.az), n = Math.max(1, Math.round(len));
    let run = null;
    for (let i = 0; i < n; i++) {
      const a = [e.ax + (e.bx - e.ax) * i / n, e.az + (e.bz - e.az) * i / n], b = [e.ax + (e.bx - e.ax) * (i + 1) / n, e.az + (e.bz - e.az) * (i + 1) / n];
      const cx = (a[0] + b[0]) / 2, cz = (a[1] + b[1]) / 2;
      let gap = false;
      if (reg === 'road') { for (const zx of ZEBRAS) if (Math.abs(cx - zx) < 2.8 && (e.nz !== 0)) gap = true; if (inPit(cx - e.nx, cz - e.nz, 0.3) || inPit(cx, cz, 0.3)) gap = true; }
      if (reg === 'walk' && inPit(cx - e.nx, cz - e.nz, 1.2)) gap = true;
      if (reg === 'building' || gap) { if (run) { flushRun(run); run = null; } continue; }
      if (!run || run.reg !== reg) { if (run) flushRun(run); run = { reg, a, b, e }; } else run.b = b;
    }
    if (run) flushRun(run);
  }
  function flushRun(r) {
    const { a, b, e, reg } = r;
    const off = 0.08;
    const ax = a[0] - e.nx * off, az = a[1] - e.nz * off, bx = b[0] - e.nx * off, bz = b[1] - e.nz * off;
    if (reg === 'road') {
      // kerb: vertical face down to the road, stone cap
      const len = Math.hypot(bx - ax, bz - az);
      const nx = -e.nx, nz = -e.nz; // outward (towards the road)
      const t = (a0, b0, c0, d0, n_, col) => kerb.quadAuto(a0, b0, c0, d0, null, col);
      // face (outward)
      const P = (x, z, y) => [x, y, z];
      const wind = (-(bz - az) * nx + (bx - ax) * nz) >= 0;
      const [pa, pb] = wind ? [[ax, az], [bx, bz]] : [[bx, bz], [ax, az]];
      kerb.quad(P(pa[0], pa[1], Y_ROAD), P(pb[0], pb[1], Y_ROAD), P(pb[0], pb[1], 0.0), P(pa[0], pa[1], 0.0), [nx, 0, nz], null, D2);
      // top strip 0.18 m outside the walk edge
      const q = [[ax + nx * 0.0, az + nz * 0.0], [bx, bz]];
      kerb.quad(P(ax, az, 0.001), P(bx, bz, 0.001), P(bx + nx * 0.18, bz + nz * 0.18, 0.001), P(ax + nx * 0.18, az + nz * 0.18, 0.001), [0, 1, 0], null, mulc(D2, 1.1));
      // guard rail on the kerb line
      rail(ax + nx * 0.09, az + nz * 0.09, bx + nx * 0.09, bz + nz * 0.09); nRail++;
    } else {
      // 'walk' (Midosuji / extension strips): low stone planter edge with clipped hedge
      const nx = -e.nx, nz = -e.nz;
      const len = Math.hypot(bx - ax, bz - az), tx = (bx - ax) / len, tz = (bz - az) / len;
      const cx = (ax + bx) / 2 + nx * 0.25, cz = (az + bz) / 2 + nz * 0.25;
      kerb.geometry(BOXG, new THREE.Matrix4().compose(new THREE.Vector3(cx, 0.22, cz), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-tz, tx)), new THREE.Vector3(len + 0.02, 0.44, 0.5)), D2);
      hedgeRuns.push({ x: cx, z: cz, len, tx, tz });
    }
  }
  timings.roadsEdges = Math.round(performance.now() - t0); t0 = performance.now();

  // ---- ground plane (the city floor between blocks) ------------------------------------
  {
    const geo = new THREE.CircleGeometry(1500, 48); geo.rotateX(-Math.PI / 2);
    const uv = geo.attributes.uv; const pos = geo.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 10, pos.getZ(i) / 10);
    const gm = defineStd('out_cityground', () => { const m = new THREE.MeshStandardMaterial({ map: asphaltTexture(ctx), color: 0x8c8d90, roughness: 0.95 }); m.userData.nbReflect = 0; return m; });
    const g = new THREE.Mesh(geo, gm); g.position.y = -0.4; g.receiveShadow = true; g.name = 'street:ground'; g.matrixAutoUpdate = false; g.updateMatrix();
    root.add(g);
  }

  // ---- emit road meshes -------------------------------------------------------------------
  const add = (acc, mat, name, o = {}) => { if (acc.empty) return null; const m = acc.mesh(mat, { cast: !!o.cast, receive: true, name }); root.add(m); return m; };
  add(road, asphaltM, 'street:road'); add(walk, paveM, 'street:walk'); add(marks, markM, 'street:markings'); add(kerb, stoneM, 'street:kerbs', { cast: true });
  add(soil, soilM, 'street:planters'); add(steel, steelM, 'street:rails', { cast: true });
  tick('roads', t0); t0 = performance.now();

  // ---- frontages (neon facades) -----------------------------------------------------------------
  const F = new Frontages(ctx);
  // north side of Sennichimae-dori (east of Midosuji and west of it)
  F.run({ ax: MIDO.x1 + 0.3, az: -258.3, bx: FAR, bz: -258.3, nx: 0, nz: 1, seed: 11, fMin: 5, fMax: 9, tall: true });
  F.run({ ax: MIDO.x0 - 0.3, az: -258.3, bx: -FAR, bz: -258.3, nx: 0, nz: 1, seed: 12, fMin: 5, fMax: 9, tall: true });
  // south side: annex block beside Takashimaya, then the long run east
  F.run({ ax: -40, az: -200.3, bx: 190, bz: -200.3, nx: 0, nz: -1, seed: 21, fMin: 4, fMax: 8, depth: 14 });
  F.run({ ax: 212, az: -200.3, bx: FAR, bz: -200.3, nx: 0, nz: -1, seed: 22, fMin: 4, fMax: 8 });
  F.run({ ax: MIDO.x0 - 0.3, az: -199.7, bx: -FAR, bz: -199.7, nx: 0, nz: -1, seed: 23, fMin: 4, fMax: 8 });
  // plaza east block (west face of the annex into Namba Plaza) and the alcove at exit 24
  F.run({ ax: -40.3, az: -200, bx: -40.3, bz: -184.5, nx: -1, nz: 0, seed: 31, fMin: 4, fMax: 6, wMin: 5, wMax: 8, depth: 12 });
  F.run({ ax: 189.7, az: -200, bx: 189.7, bz: -186, nx: 1, nz: 0, seed: 32, fMin: 5, fMax: 6, wMin: 7, wMax: 14, depth: 10 });
  F.run({ ax: 210.3, az: -186, bx: 210.3, bz: -200, nx: -1, nz: 0, seed: 33, fMin: 5, fMax: 6, wMin: 7, wMax: 14, depth: 10 });
  F.run({ ax: 190, az: -185.7, bx: 210, bz: -185.7, nx: 0, nz: 1, seed: 34, fMin: 5, fMax: 7, wMin: 8, wMax: 20, depth: 10 });
  // Midosuji west wall (the uniform ~31 m cornice line) and its east side south of the complex gap
  F.run({ ax: -158.3, az: -FAR, bx: -158.3, bz: -258.3 - 0.0, nx: 1, nz: 0, seed: 41, fMin: 8, fMax: 9, wMin: 14, wMax: 28, tall: true });
  F.run({ ax: -158.3, az: -199.7, bx: -158.3, bz: FAR, nx: 1, nz: 0, seed: 42, fMin: 8, fMax: 9, wMin: 14, wMax: 28, tall: true });
  F.run({ ax: -104.3, az: -40, bx: -104.3, bz: 392, nx: -1, nz: 0, seed: 43, fMin: 6, fMax: 9, wMin: 12, wMax: 24, depth: 22 });
  F.run({ ax: -104.3, az: 392, bx: -104.3, bz: FAR, nx: -1, nz: 0, seed: 44, fMin: 7, fMax: 9, wMin: 14, wMax: 28, depth: 22 });
  const fmeshes = F.emit(root);
  timings.frontages = Math.round(performance.now() - t0); t0 = performance.now();

  // ---- the Midosuji ginkgo avenue + planting ---------------------------------------------------
  const veg = new Vegetation(ctx, root);
  const planters = [];
  for (const x of [-152.8, -144, -119, -109.4]) {
    for (let z = -520; z < 560; z += 9.5) {
      if (z > SEN.z0 - 8 && z < SEN.z1 + 8 && x > -150) continue; // the crossing
      if (x === -109.4 && z > -203 && z < -190) continue;       // stair pit
      if (z > -203 && z < -190 && x > -112) continue;
      veg.add('ginkgo', x, 0.0, z + R.range(-1.2, 1.2), R.range(0.9, 1.15), R.range(0, 6.28), [R.range(0.92, 1.08), R.range(0.95, 1.1), R.range(0.8, 1.0)]);
    }
  }
  // street trees on the Sennichimae sidewalk (building side) - a few keyaki and shrub planters at the plaza
  for (let x = -20; x < 200; x += 24) if (!ZEBRAS.some(zx => Math.abs(x - zx) < 5)) veg.add('shrub', x, 0, -205.2, 1.0, R.range(0, 6), [0.9, 1, 0.9]);
  // hedges along the 'walk' planter runs
  for (const h of hedgeRuns) for (let s = 0; s < h.len; s += 0.9) {
    veg.add(R.chance(0.7) ? 'shrub' : 'azalea', h.x + h.tx * (s - h.len / 2) + R.range(-0.1, 0.1), 0.44, h.z + h.tz * (s - h.len / 2) + R.range(-0.1, 0.1), R.range(0.55, 0.8), R.range(0, 6), [0.85, 1, 0.8]);
  }
  // ginkgo/shrub ground planting in the Midosuji tree strips
  for (const xc of [-144, -119]) for (let z = -520; z < 560; z += 1.8) {
    if (z > SEN.z0 - 8 && z < SEN.z1 + 8) continue;
    veg.add('shrub', xc + R.range(-1.4, 1.4), 0.0, z, R.range(0.45, 0.7), R.range(0, 6), [0.8, 0.95, 0.75]);
  }
  timings.planting = Math.round(performance.now() - t0); t0 = performance.now();

  // ---- Namba Plaza furniture (inside walkable space: registered obstacles) ------------------
  const plazaAcc = new MeshAcc(), plazaSoil = new MeshAcc();
  const planter = (cx, cz, hx, hz) => {
    boxAcc(plazaAcc, cx, 0.3, cz, hx * 2, 0.6, hz * 2, D);
    flat(plazaSoil, cx - hx + 0.1, cz - hz + 0.1, cx + hx - 0.1, cz + hz - 0.1, 0.58, [1, 1, 1], 1 / 3);
    world.addBox('1F', cx, cz, hx, hz, 0);
  };
  const plazaBeds = [];
  for (const [cx, cz, hx, hz] of [[-86, -195.5, 3, 1.1], [-72, -195.5, 3, 1.1], [-58, -195.5, 3, 1.1], [-46, -190.5, 1.2, 3.4], [-90, -188.5, 1.2, 1.8]]) { planter(cx, cz, hx, hz); plazaBeds.push([cx, cz, hx, hz]); }
  // benches
  const benchAcc = new MeshAcc();
  for (const [cx, cz, rot] of [[-80, -190, 0], [-66, -190, 0], [-52, -190, 0], [-92, -193, 1.57]]) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const put = (lx, ly, lz, sx, sy, sz, col) => boxAcc(benchAcc, cx + lx * c + lz * s, ly, cz - lx * s + lz * c, Math.abs(sx * c) + Math.abs(sz * s), sy, Math.abs(sx * s) + Math.abs(sz * c), col);
    put(0, 0.43, 0, 1.8, 0.07, 0.45, lin(0xb08a5e)); put(0, 0.75, 0.22, 1.8, 0.35, 0.05, lin(0xb08a5e));
    put(-0.8, 0.2, 0, 0.08, 0.4, 0.4, lin(0x3b3e42)); put(0.8, 0.2, 0, 0.08, 0.4, 0.4, lin(0x3b3e42));
    world.addBox('1F', cx, cz, 0.95 * (rot ? 0.3 : 1) + 0.0 + (rot ? 0.0 : 0), 0.3 * (rot ? 3.2 : 1), 0);
  }
  add(plazaAcc, stoneM, 'street:plaza_stone', { cast: true }); add(plazaSoil, soilM, 'street:plaza_soil'); add(benchAcc, stoneM, 'street:plaza_benches', { cast: true });
  for (const [cx, cz, hx, hz] of plazaBeds) {
    for (let i = 0; i < Math.round(hx * hz * 2.6); i++) veg.add(R.pick(['shrub', 'azalea', 'flower', 'grass']), cx + R.range(-hx + 0.3, hx - 0.3), 0.58, cz + R.range(-hz + 0.3, hz - 0.3), R.range(0.7, 1.1), R.range(0, 6));
  }
  veg.add('keyaki', -86, 0.58, -195.5, 0.8, 1.2); veg.add('sakura', -58, 0.58, -195.5, 0.7, 3.1); veg.add('kusu', -46, 0.58, -192, 0.55, 2.0);
  veg.build();

  // ---- signals, lamps, poles ---------------------------------------------------------------------------
  const headPos = [];      // { x,y,z, group, ry }
  const poleAt = (x, z, h = 5.2) => { boxAcc(pole, x, h / 2, z, 0.22, h, 0.22, [0.22, 0.24, 0.26]); };
  // vehicle signals at the four stop lines (mast with 2 heads over the lanes, plus a primary head at the pole)
  const mast = (px, pz, hx, hz, group, face) => { poleAt(px, pz, 5.4); boxAcc(pole, (px + hx) / 2, 5.3, (pz + hz) / 2, Math.abs(hx - px) + 0.15, 0.15, Math.abs(hz - pz) + 0.15, [0.22, 0.24, 0.26]); headPos.push({ x: hx, y: 5.0, z: hz, group, ry: face }); headPos.push({ x: (px + hx) / 2, y: 5.0, z: (pz + hz) / 2, group, ry: face }); };
  mast(-160.2, -252.6, -160.2, -236, 'A', Math.PI / 2 * 0 + Math.PI / 2 * 1);     // EB heads face west
  mast(-101.6, -205.4, -101.6, -222, 'A', -Math.PI / 2);                          // WB heads face east
  mast(-122.5, -255.2, -138, -255.2, 'B', Math.PI);                              // SB heads face north
  mast(-148, -203.6, -148, -203.6, 'B', 0); mast(-114.5, -203.6, -114.5, -203.6, 'B', 0);
  // pedestrian signals at the zebras (both kerbs)
  for (const zx of ZEBRAS) for (const [px, pz, face] of [[zx - 2.9, -252.5, 0], [zx + 2.9, -252.5, 0], [zx - 2.9, -205.5, Math.PI], [zx + 2.9, -205.5, Math.PI]]) {
    poleAt(px, pz, 2.6); headPos.push({ x: px, y: 2.3, z: pz + (face ? -0.12 : 0.12), group: 'A', ry: face + (face ? 0 : 0), ped: true });
  }
  add(pole, steelM, 'street:poles', { cast: true });
  // signal lamp instances: 3 lamps / vehicle head, 1 / ped head
  {
    const lampGeo = new THREE.BoxGeometry(0.28, 0.28, 0.1);
    const n = headPos.reduce((s, h) => s + (h.ped ? 1 : 3), 0);
    const im = new THREE.InstancedMesh(lampGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), n);
    im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    im.frustumCulled = false; im.name = 'street:signal_lamps';
    const housing = new MeshAcc();
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    let k = 0; const lamps = [];
    for (const h of headPos) {
      q.setFromAxisAngle(up, h.ry);
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q), right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      if (h.ped) { m4.compose(new THREE.Vector3(h.x + fwd.x * 0.07, h.y, h.z + fwd.z * 0.07), q, new THREE.Vector3(1.1, 1.1, 1)); im.setMatrixAt(k, m4); lamps.push({ i: k, group: h.group, ped: true }); k++; boxAcc(housing, h.x, h.y, h.z, 0.4 * Math.abs(right.x) + 0.12, 0.42, 0.4 * Math.abs(right.z) + 0.12, [0.1, 0.1, 0.11]); }
      else for (let l = 0; l < 3; l++) { m4.compose(new THREE.Vector3(h.x + fwd.x * 0.07 + right.x * (l - 1) * 0.34, h.y, h.z + fwd.z * 0.07 + right.z * (l - 1) * 0.34), q, new THREE.Vector3(1, 1, 1)); im.setMatrixAt(k, m4); lamps.push({ i: k, group: h.group, lamp: l }); k++; if (l === 1) boxAcc(housing, h.x, h.y, h.z, 1.1 * Math.abs(right.x) + 0.2, 0.4, 1.1 * Math.abs(right.z) + 0.2, [0.1, 0.1, 0.11]); }
    }
    root.add(im);
    add(housing, steelM, 'street:signal_housings');
    ex._signalLamps = { im, lamps, last: '' };
  }
  // street lamps along the sidewalks (Sennichimae kerbs, the plaza, Midosuji)
  {
    const lampPole = new MeshAcc(), glow = new MeshAcc();
    const lampAt = (x, z, arm = 0, ay = 0) => {
      boxAcc(lampPole, x, 3.6, z, 0.16, 7.2, 0.16, [0.2, 0.22, 0.24]);
      const ex_ = Math.cos(ay) * arm, ez_ = Math.sin(ay) * arm;
      if (arm) { boxAcc(lampPole, x + ex_ / 2, 7.15, z + ez_ / 2, Math.abs(ex_) + 0.12, 0.12, Math.abs(ez_) + 0.12, [0.2, 0.22, 0.24]); }
      boxAcc(glow, x + ex_, 7.0, z + ez_, 0.55, 0.12, 0.3, [2, 1.75, 1.3]);
    };
    for (let x = -100; x < 700; x += 32) { if (inPit(x, -252.4, 3) || ZEBRAS.some(zx => Math.abs(x - zx) < 4)) continue; lampAt(x, -252.45, 1.6, Math.PI / 2); }
    for (let x = -700; x < MIDO.x0 - 6; x += 32) lampAt(x, -252.45, 1.6, Math.PI / 2);
    for (let x = -100; x < 700; x += 32) { if (ZEBRAS.some(zx => Math.abs(x - zx) < 4)) continue; lampAt(x + 16, -205.55, 1.6, -Math.PI / 2); }
    for (let z = -170; z < 560; z += 28) lampAt(-111.5, z, 1.5, Math.PI); // Midosuji east sidewalk
    for (let z = -520; z < 560; z += 28) if (!(z > -260 && z < -190)) { lampAt(-155, z + 6, 1.5, 0); }
    // median lamps (double arm) on Sennichimae
    for (let x = -700; x < 700; x += 36) { if (x > MIDO.x0 - 6 && x < MIDO.x1 + 6) continue; boxAcc(lampPole, x, 4.5, -229, 0.2, 9, 0.2, [0.2, 0.22, 0.24]); for (const s of [-1, 1]) { boxAcc(lampPole, x, 8.9, -229 + s * 1.7, 0.12, 0.12, 3.4, [0.2, 0.22, 0.24]); boxAcc(glow, x, 8.75, -229 + s * 3.2, 0.3, 0.1, 0.55, [2, 1.75, 1.3]); } }
    add(lampPole, steelM, 'street:lamp_poles', { cast: true }); add(glow, lampGlow, 'street:lamp_glow');
    // lighting registrations near walkable areas (a modest number)
    if (ctx.lighting) {
      for (let x = -90; x < 200; x += 32) { ctx.lighting.addLight({ level: '1F', x, y: 6.8, z: -253.5, color: 0xffe2b8, intensity: 0.9, range: 12, kind: 'lamp' }); ctx.lighting.addLight({ level: '1F', x: x + 16, y: 6.8, z: -204.5, color: 0xffe2b8, intensity: 0.9, range: 12, kind: 'lamp' }); }
      for (let z = -180; z < -50; z += 28) ctx.lighting.addLight({ level: '1F', x: -102.5, y: 6.8, z, color: 0xffe2b8, intensity: 0.9, range: 12, kind: 'lamp' });
    }
  }
  timings.furniture = Math.round(performance.now() - t0); t0 = performance.now();

  // ---- vending machines & bicycles at the building lines (inside the walkable sidewalks) ------------
  {
    const vend = new MeshAcc(), vglow = new MeshAcc();
    const cols = [[0.85, 0.1, 0.1], [0.1, 0.35, 0.8], [0.9, 0.9, 0.9], [0.1, 0.55, 0.25], [0.95, 0.55, 0.05]];
    const spots = [];
    for (let x = -30; x < 188; x += R.range(18, 34)) spots.push([x, -199.7, 0, -1]);   // south walk, against the building line
    for (let x = -90; x < 205; x += R.range(16, 30)) spots.push([x, -257.7, 0, 1]);     // north walk
    for (const [x, z, , sn] of spots) {
      if (inPit(x, z, 2) || ZEBRAS.some(zx => Math.abs(x - zx) < 4)) continue;
      const nn = R.int(1, 2);
      for (let k = 0; k < nn; k++) {
        const cx = x + k * 0.8, cz = z + sn * 0.0 + (sn > 0 ? 0.3 : -0.3);
        const c = R.pick(cols);
        boxAcc(vend, cx, 0.9, cz, 0.72, 1.8, 0.62, c);
        boxAcc(vglow, cx, 1.05, cz + (sn > 0 ? 0.32 : -0.32), 0.52, 1.1, 0.02, [1.8, 1.8, 1.7]);
        world.addBox('1F', cx, cz, 0.36, 0.31, 0);
      }
    }
    add(vend, stoneM, 'street:vending', { cast: true });
    if (!vglow.empty) { const m = defineStd('out_vend_glow', () => new THREE.MeshBasicMaterial({ vertexColors: true })); root.add(vglow.mesh(m, { cast: false, receive: false, name: 'street:vending_glow' })); }
    // bicycles: parked rows against the building line
    const bike = new MeshAcc();
    const bikeAt = (x, z, ry) => {
      const c = Math.cos(ry), s = Math.sin(ry);
      const put = (lx, ly, lz, sx, sy, sz, col) => boxAcc(bike, x + lx * c + lz * s, ly, z - lx * s + lz * c, Math.abs(sx * c) + Math.abs(sz * s), sy, Math.abs(sx * s) + Math.abs(sz * c), col);
      put(0.0, 0.33, 0.55, 0.04, 0.66, 0.66, [0.08, 0.08, 0.08]); put(0.0, 0.33, -0.55, 0.04, 0.66, 0.66, [0.08, 0.08, 0.08]);
      put(0, 0.62, 0, 0.05, 0.34, 1.0, lin(R.pick([0x2255aa, 0x666666, 0xaa2222, 0xcccccc, 0x2e6e3e])));
      put(0, 0.97, -0.5, 0.5, 0.04, 0.04, [0.15, 0.15, 0.15]); put(0, 0.8, -0.55, 0.3, 0.2, 0.18, [0.25, 0.25, 0.25]);
    };
    for (const [x, z, sn] of [[-20, -199.2, -1], [60, -199.2, -1], [120, -199.2, -1], [30, -258.5, 1], [96, -258.5, 1], [-84, -258.5, 1], [170, -199.2, -1]]) {
      if (inPit(x, z, 2)) continue;
      const n = R.int(5, 9);
      for (let i = 0; i < n; i++) bikeAt(x + i * 0.62, z + sn * -0.45 + (sn < 0 ? 0 : 0), Math.PI / 2 + R.range(-0.1, 0.1));
      world.addBox('1F', x + n * 0.31, z + sn * -0.45, n * 0.31 + 0.1, 0.5, 0);
    }
    add(bike, stoneM, 'street:bicycles', { cast: false });
  }
  timings.props = Math.round(performance.now() - t0); t0 = performance.now();

  // ---- traffic ---------------------------------------------------------------------------------------------
  const traffic = buildTraffic(ctx, root, ex, LANES, { cycle: 92 });
  ex.traffic = traffic;
  timings.traffic = Math.round(performance.now() - t0);
  ex.timings = Object.assign(ex.timings || {}, { street: timings });

  // ---- per-frame --------------------------------------------------------------------------------------------
  let lampT = 0;
  const lampCol = { g: new THREE.Color(0.1, 2.4, 0.9), y: new THREE.Color(2.6, 1.6, 0.1), r: new THREE.Color(2.8, 0.15, 0.1), off: new THREE.Color(0.06, 0.06, 0.06), walk: new THREE.Color(0.1, 2.0, 1.0), stop: new THREE.Color(2.6, 0.2, 0.1) };
  return {
    update(dt) {
      traffic.update(dt);
      veg.update(dt, ctx.camera.getWorldPosition(_cam), false);
      updateStorefronts(ctx, ex.daylight.night);
      const S = ex._signalLamps;
      const st = traffic.signal.A + traffic.signal.B;
      if (S && S.last !== st) {
        S.last = st;
        for (const l of S.lamps) {
          const s = traffic.signal[l.group];
          let c;
          if (l.ped) c = s === 'g' ? lampCol.walk : lampCol.stop;
          else c = (l.lamp === 0 && s === 'g') ? lampCol.g : (l.lamp === 1 && s === 'y') ? lampCol.y : (l.lamp === 2 && s === 'r') ? lampCol.r : lampCol.off;
          // order along the housing: lamp 0 = green (left), 1 = amber, 2 = red
          S.im.setColorAt(l.i, c);
        }
        S.im.instanceColor.needsUpdate = true;
      }
      if (ex.daylight) { lampGlow.color.setRGB(1, 0.88, 0.65).multiplyScalar(0.7 + 3.0 * ex.daylight.night); }
    },
    veg,
  };
}
