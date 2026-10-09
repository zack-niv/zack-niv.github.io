// =============================================================================
// Street traffic: left-hand-drive cars, taxis, kei vans, box trucks and city
// buses on the Sennichimae-dori / Midosuji lanes, obeying a signal cycle at the
// Midosuji crossing (car-following, stop lines, queues). Instanced: one body
// mesh + one light mesh per vehicle type (sharing instance matrices).
//   const T = buildTraffic(ctx, root, ex, lanes, signal)
//   T.update(dt)         // sim + matrices
// Lane: { x0,z0,x1,z1 (centre line start→end), speed, stop: { s (metres along lane), group } | null, n (cars) }
// =============================================================================
import * as THREE from 'three';
import { rng } from '../../core/rng.js?v=f150c03';
import { MeshAcc, lin } from './meshacc.js?v=f150c03';

const M4 = () => new THREE.Matrix4();
function box(acc, cx, cy, cz, sx, sy, sz, col) {
  const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
  acc.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], null, col);
  acc.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], null, col);
  acc.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], null, col);
  acc.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], null, col);
  acc.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], null, col);
}
// tapered cabin: bottom (w0,l0) to top (w1,l1), shifted by dz (forward = +z)
function cabin(acc, cy, h, w0, l0, w1, l1, cz, col, glass) {
  const y0 = cy - h / 2, y1 = cy + h / 2;
  const v = (w, l, y, sx, sz) => [sx * w / 2, y, cz + sz * l / 2];
  const A = v(w0, l0, y0, -1, -1), B = v(w0, l0, y0, 1, -1), C = v(w0, l0, y0, 1, 1), D = v(w0, l0, y0, -1, 1);
  const a = v(w1, l1, y1, -1, -1), b = v(w1, l1, y1, 1, -1), c = v(w1, l1, y1, 1, 1), d = v(w1, l1, y1, -1, 1);
  const gc = glass || [0.02, 0.025, 0.03];
  acc.quadAuto(d, c, b, a, null, col);              // roof (up)
  acc.quadAuto(D, C, c, d, null, gc);               // front (windscreen, +z)
  acc.quadAuto(B, A, a, b, null, gc);               // rear
  acc.quadAuto(C, B, b, c, null, gc);               // right side (+x)
  acc.quadAuto(A, D, d, a, null, gc);               // left side
}
const WHITE = [1, 1, 1], BLACK = [0.015, 0.015, 0.018], GLASS = [0.03, 0.04, 0.05];
function wheel(acc, x, z, r, w) { box(acc, x, r, z, w, r * 2, r * 1.6, BLACK); }

function buildCar(kind) {
  const body = new MeshAcc(), lights = new MeshAcc();
  const bright = (r, g, b) => [r, g, b];
  if (kind === 'sedan' || kind === 'taxi') {
    box(body, 0, 0.62, 0, 1.78, 0.62, 4.6, WHITE);
    box(body, 0, 0.36, 0, 1.7, 0.2, 4.45, [0.25, 0.25, 0.27]);
    cabin(body, 1.2, 0.58, 1.62, 2.5, 1.46, 1.75, -0.12, WHITE, GLASS);
    for (const sx of [-0.78, 0.78]) for (const z of [-1.4, 1.45]) wheel(body, sx, z, 0.32, 0.22);
    for (const sx of [-0.62, 0.62]) { box(lights, sx, 0.72, 2.31, 0.38, 0.14, 0.05, bright(3, 3, 2.6)); box(lights, sx, 0.74, -2.31, 0.4, 0.12, 0.05, bright(2.6, 0.12, 0.08)); }
    if (kind === 'taxi') box(lights, 0, 1.58, -0.1, 0.5, 0.17, 0.2, bright(2.4, 2.0, 1.2));
  } else if (kind === 'kei') {
    box(body, 0, 0.78, 0, 1.46, 0.85, 3.35, WHITE);
    box(body, 0, 0.45, 0, 1.4, 0.2, 3.3, [0.25, 0.25, 0.27]);
    cabin(body, 1.55, 0.7, 1.4, 2.7, 1.34, 2.4, -0.2, WHITE, GLASS);
    for (const sx of [-0.65, 0.65]) for (const z of [-1.0, 1.1]) wheel(body, sx, z, 0.27, 0.18);
    for (const sx of [-0.5, 0.5]) { box(lights, sx, 0.86, 1.69, 0.3, 0.14, 0.05, bright(3, 3, 2.6)); box(lights, sx, 0.9, -1.69, 0.28, 0.12, 0.05, bright(2.6, 0.12, 0.08)); }
  } else if (kind === 'truck') {
    box(body, 0, 0.7, 0.4, 2.15, 0.7, 6.0, [0.35, 0.35, 0.37]);
    cabin(body, 1.45, 1.3, 2.1, 1.7, 2.0, 1.55, 2.2, WHITE, GLASS);
    box(body, 0, 2.15, -0.75, 2.2, 2.2, 4.1, [0.93, 0.93, 0.92]); // box body
    for (const sx of [-0.98, 0.98]) for (const z of [-1.9, 1.9, 2.25 - 0.2]) wheel(body, sx, z, 0.42, 0.28);
    for (const sx of [-0.8, 0.8]) { box(lights, sx, 0.95, 3.3, 0.35, 0.16, 0.05, bright(3, 3, 2.6)); box(lights, sx, 0.95, -2.62, 0.3, 0.2, 0.05, bright(2.6, 0.12, 0.08)); }
  } else { // bus
    box(body, 0, 1.55, 0, 2.5, 2.4, 10.4, WHITE);
    box(body, 0, 0.5, 0, 2.46, 0.5, 10.2, [0.12, 0.12, 0.13]);
    box(body, 0, 1.95, 0, 2.52, 0.95, 9.8, GLASS);               // window band
    box(body, 0, 2.95, 0, 2.2, 0.15, 5.4, [0.7, 0.7, 0.7]);       // roof unit
    for (const sx of [-1.12, 1.12]) for (const z of [-3.4, 3.5]) wheel(body, sx, z, 0.5, 0.3);
    for (const sx of [-0.85, 0.85]) { box(lights, sx, 0.8, 5.22, 0.35, 0.16, 0.05, bright(3, 3, 2.6)); box(lights, sx, 1.0, -5.22, 0.3, 0.3, 0.05, bright(2.6, 0.12, 0.08)); }
    box(lights, 0, 2.6, 5.22, 1.4, 0.3, 0.05, bright(2.4, 1.2, 0.2)); // destination sign
  }
  return { body: body.build(true), lights: lights.build(true) };
}

const CAR_COLORS = [0xf2f2f0, 0xf2f2f0, 0xe8e8e6, 0x1d1f23, 0x1d1f23, 0xb9bcc1, 0xb9bcc1, 0x7a1f1f, 0x1f3a66, 0x3d4a3a, 0xd7d2c4, 0x8a8d92].map(h => new THREE.Color(h));
const TAXI_COLORS = [0x1a1a1c, 0xf0f0ee, 0xe4b100, 0x1a1a1c].map(h => new THREE.Color(h));

export function trafficSignal(t, cycle) {
  // returns { A: 'g'|'y'|'r', B: ... } group A = Sennichimae-dori, B = Midosuji
  const p = t % cycle;
  const f = (a0, g, y) => { const q = p - a0; return q >= 0 && q < g ? 'g' : q >= g && q < g + y ? 'y' : 'r'; };
  return { A: f(0, 38, 3), B: f(46, 24, 3) };
}

export function buildTraffic(ctx, root, ex, lanes, opts = {}) {
  const R = rng(5150);
  const cycle = opts.cycle || 92;
  const LEN = {};
  const kinds = ['sedan', 'taxi', 'kei', 'truck', 'bus'];
  const geos = {};
  for (const k of kinds) geos[k] = buildCar(k);
  const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.35 });
  bodyMat.userData.nbReflect = 0.15;
  const lightMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  // vehicles
  const vehicles = [];
  const HALF = { sedan: 2.4, taxi: 2.4, kei: 1.8, truck: 3.3, bus: 5.3 };
  lanes.forEach((ln, li) => {
    ln.len = Math.hypot(ln.x1 - ln.x0, ln.z1 - ln.z0);
    ln.dx = (ln.x1 - ln.x0) / ln.len; ln.dz = (ln.z1 - ln.z0) / ln.len;
    ln.cars = [];
    const n = ln.n || Math.round(ln.len / (ln.spacing || 70));
    for (let i = 0; i < n; i++) {
      const roll = R();
      const kind = ln.bus && roll < 0.2 ? 'bus' : roll < 0.12 ? 'taxi' : roll < 0.28 ? 'kei' : roll < 0.4 ? 'truck' : roll < 0.46 ? 'bus' : roll < 0.62 ? 'taxi' : 'sedan';
      const v = { kind, lane: li, s: (i + R.range(0.1, 0.9)) / n * ln.len, v: ln.speed * R.range(0.8, 1.0), vmax: ln.speed * R.range(0.85, 1.1), half: HALF[kind], color: kind === 'taxi' ? TAXI_COLORS[R.int(0, TAXI_COLORS.length - 1)] : kind === 'bus' ? new THREE.Color(0x2f7d4f) : kind === 'truck' ? new THREE.Color(0xeeeeee) : R.pick(CAR_COLORS), off: R.range(-0.25, 0.25) };
      ln.cars.push(v); vehicles.push(v);
    }
    ln.cars.sort((a, b) => a.s - b.s);
  });
  const per = {};
  for (const k of kinds) per[k] = vehicles.filter(v => v.kind === k).length;
  const meshes = {};
  for (const k of kinds) {
    const cap = Math.max(1, per[k]);
    const m = new THREE.InstancedMesh(geos[k].body, bodyMat, cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; m.name = 'traffic:' + k;
    const l = new THREE.InstancedMesh(geos[k].lights, lightMat, cap);
    l.instanceMatrix = m.instanceMatrix; l.frustumCulled = false; l.name = 'traffic:' + k + ':lights';
    root.add(m, l);
    meshes[k] = { m, l, n: 0 };
  }
  const mat = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  let T = R.range(0, cycle);
  const cam = new THREE.Vector3();
  const sig = { A: 'g', B: 'r' };
  const api = {
    lanes, signal: sig, kinds: per,
    update(dt) {
      dt = Math.min(dt, 0.1);
      T += dt;
      const S = trafficSignal(T, cycle); sig.A = S.A; sig.B = S.B;
      // lights brightness: dim by day
      const night = ex.daylight ? ex.daylight.night : 0;
      lightMat.color.setScalar(0.25 + 1.0 * night);
      for (const ln of lanes) {
        const cars = ln.cars, n = cars.length;
        if (!n) continue;
        const stopS = ln.stop ? ln.stop.s : null;
        const red = ln.stop ? (sig[ln.stop.group] !== 'g') : false;
        for (let i = 0; i < n; i++) {
          const c = cars[i];
          const lead = cars[(i + 1) % n];
          let gap = lead.s - c.s - (lead.half + c.half) - 0.9; if (gap < 0) gap += ln.len; if (n === 1) gap = 1e3;
          let vt = c.vmax;
          // car following: desired gap 2 m + 1.2 s headway
          const want = 2.0 + c.v * 1.1;
          if (gap < want * 2.2) vt = Math.min(vt, Math.max(0, lead.v + (gap - want) * 0.6));
          // stop line
          if (red && stopS != null) {
            const d = stopS - c.s - c.half; // distance front → line
            if (d > -0.5 && d < 60) { const vs = Math.sqrt(Math.max(0, 2 * 3.2 * (d - 0.4))); vt = Math.min(vt, d < 0.8 ? 0 : vs); }
          }
          const dv = vt - c.v;
          c.v += Math.max(-4.5 * dt, Math.min(1.8 * dt, dv * 1.4 * dt));
          if (c.v < 0) c.v = 0;
        }
        for (let i = 0; i < n; i++) cars[i].s += cars[i].v * dt;
        // wrap (cars are ordered; the one that left the lane re-enters at the start)
        for (let i = 0; i < n; i++) if (cars[i].s > ln.len) { cars[i].s -= ln.len; }
        cars.sort((a, b) => a.s - b.s);
      }
      // write matrices (cars farther than 520 m from the camera are skipped)
      ctx.camera.getWorldPosition(cam);
      for (const k of kinds) meshes[k].n = 0;
      for (const ln of lanes) {
        for (const c of ln.cars) {
          const x = ln.x0 + ln.dx * c.s - ln.dz * c.off, z = ln.z0 + ln.dz * c.s + ln.dx * c.off;
          const ddx = x - cam.x, ddz = z - cam.z;
          if (ddx * ddx + ddz * ddz > 520 * 520) continue;
          const M = meshes[c.kind];
          q.setFromAxisAngle(up, Math.atan2(ln.dx, ln.dz));
          p.set(x, ln.y || 0, z);
          mat.compose(p, q, sc);
          M.m.setMatrixAt(M.n, mat);
          M.m.instanceColor.setXYZ(M.n, c.color.r, c.color.g, c.color.b);
          M.n++;
        }
      }
      for (const k of kinds) {
        const M = meshes[k];
        M.m.count = M.n; M.l.count = M.n;
        M.m.instanceMatrix.needsUpdate = true; M.m.instanceColor.needsUpdate = true;
      }
    },
  };
  api.update(0.016);
  return api;
}
