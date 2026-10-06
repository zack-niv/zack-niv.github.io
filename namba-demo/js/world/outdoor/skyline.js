// =============================================================================
// The city around Namba: ~2000 instanced buildings (one draw call) with
// procedural windows, rooftop clutter (one more), and the landmarks that tell
// you where you are — Tsutenkaku and Abeno Harukas to the south-east.
// Custom shader: sun/sky shading in the light-field's units, window grids,
// night lights, and aerial perspective that fades into the sky's horizon.
// =============================================================================
import * as THREE from 'three';
import { rng } from '../../core/rng.js';
import { viaductAt } from './massing.js';

export const CITY_U = {
  uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color() }, uSunE: { value: 18 },
  uSkyE: { value: new THREE.Color(1, 1, 1) }, uHor: { value: new THREE.Color() }, uNight: { value: 0 }, uHaze: { value: 0.0016 },
};

const VERT = /* glsl */`
attribute vec4 aParams; // x: window kind, y: seed, z: lit prob, w: haze distance multiplier
varying vec3 vWP; varying vec3 vN; varying vec3 vCol; varying vec4 vP; varying vec3 vLocal;
void main() {
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWP = wp.xyz;
  vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  #ifdef USE_INSTANCING_COLOR
    vCol = instanceColor;
  #else
    vCol = vec3(0.7);
  #endif
  vP = aParams;
  vLocal = position;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const FRAG = /* glsl */`
uniform vec3 uSunDir, uSunCol, uSkyE, uHor; uniform float uSunE, uNight, uHaze;
varying vec3 vWP; varying vec3 vN; varying vec3 vCol; varying vec4 vP; varying vec3 vLocal;
float hh(vec2 p) { p = fract(p * vec2(234.34, 435.345)); p += dot(p, p + 34.23); return fract(p.x * p.y); }
void main() {
  vec3 n = normalize(vN);
  vec3 base = vCol;
  float kind = vP.x;
  vec3 emis = vec3(0.0);
  float side = 1.0 - step(0.5, abs(n.y));
  if (kind > 0.5 && side > 0.5) {
    vec2 uv = vec2(abs(n.x) > 0.5 ? vWP.z : vWP.x, vWP.y);
    vec2 cell = kind < 1.5 ? vec2(3.0, 3.6) : kind < 2.5 ? vec2(1.7, 3.9) : vec2(3.4, 3.0);
    vec2 c = uv / cell; vec2 id = floor(c); vec2 f = fract(c);
    float win = kind < 1.5 ? step(0.18, f.x) * step(f.x, 0.82) * step(0.3, f.y) * step(f.y, 0.85)
              : kind < 2.5 ? step(0.05, f.x) * step(0.08, f.y)
              : step(0.12, f.x) * step(f.x, 0.88) * step(0.32, f.y) * step(f.y, 0.88);
    win *= step(3.0, vWP.y);
    float r = hh(id + vP.y);
    vec3 glass = mix(vec3(0.04, 0.05, 0.065), uHor * 0.06, 0.4 + 0.5 * r);
    base = mix(base, glass, win * 0.9);
    float lit = step(1.0 - vP.z, hh(id * 1.31 + vP.y * 3.7)) * win;
    vec3 lc = mix(vec3(1.0, 0.75, 0.45), vec3(0.8, 0.9, 1.0), step(0.55, hh(id + 7.0)));
    emis = lc * lit * uNight * (2.0 + 2.5 * hh(id + 1.0));
    // balcony slabs on apartments
    if (kind > 2.5) base *= 1.0 + 0.25 * step(f.y, 0.1);
  }
  // shading (Lambert, same units as the light field: sun ~18, sky ~4)
  float ndl = max(dot(n, uSunDir), 0.0);
  float skyAmt = 0.55 + 0.45 * n.y;
  vec3 irr = uSunCol * uSunE * ndl * 0.85 + uSkyE * skyAmt + vec3(0.04);
  // fake ground-floor darkening
  irr *= mix(0.6, 1.0, smoothstep(0.0, 12.0, vWP.y));
  vec3 col = base * irr / 3.14159 + emis;
  // aerial perspective into the sky's horizon colour
  float d = length(vWP - cameraPosition) * vP.w;
  float fog = 1.0 - exp(-d * uHaze);
  vec3 hz = uHor * (1.0 - 0.25 * uNight);
  col = mix(col, hz, clamp(fog, 0.0, 0.97));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function cityMaterial() {
  const m = new THREE.ShaderMaterial({ uniforms: CITY_U, vertexShader: VERT, fragmentShader: FRAG, fog: false });
  m.name = 'out_city';
  return m;
}

// regions where generic city blocks must not go (complex, avenues, near streets)
const COMPLEX = [-104, -202, 126, 392];
// volumes of the complex that are not walkable cells but are solid (Parks tower, terraces, hotels, stores)
const KEEPOUT = [[54, 146, 108, 204], [18, 200, 124, 392], [-98, -187, 24, -38], [-62, -134, 42, -38], [-31, -42, 32, 192], [-52, -130, -12, -94], [-26, 200, 26, 392], [-82, -202, -80, 392]];
const EXCL = [
  [-156, -2000, -102, 2000],   // Midosuji avenue + sidewalks
  [-2000, -256, 2000, -200],   // Sennichimae-dori
  [-170, -300, 280, -256],     // north-side street facades (street.js)
  [16, -202, 260, -150],       // south-side street facades (street.js)
  [-30, 392, 140, 410],        // road south of Parks
  [122, 140, 140, 400],        // road east of Parks
];
let WORLD = null;
function occupied(x0, z0, x1, z1) {
  const m = 3;
  for (const lv of ['1F', '2F', '3F', '4F', '5F', '6F', '7F', '8F']) {
    const g = WORLD.grids[lv]; if (!g) continue;
    for (let z = z0 - m; z <= z1 + m; z += 2) for (let x = x0 - m; x <= x1 + m; x += 2) { const i = g.cellOf(x, z); if (i >= 0 && g.type[i] !== 0) return true; }
  }
  return false;
}
function excluded(x0, z0, x1, z1) {
  if (WORLD && x1 > COMPLEX[0] && x0 < COMPLEX[2] && z1 > COMPLEX[1] && z0 < COMPLEX[3]) {
    for (const [a, b, c, d] of KEEPOUT) if (x1 > a - 2 && x0 < c + 2 && z1 > b - 2 && z0 < d + 2) return true;
    if (occupied(x0, z0, x1, z1)) return true;
  }
  for (const [a, b, c, d] of EXCL) if (x1 > a && x0 < c && z1 > b && z0 < d) return true;
  // viaduct corridor
  for (let z = Math.max(112, z0 - 2); z <= z1 + 2; z += 8) { const cx = viaductAt(z); if (x1 > cx - 15 && x0 < cx + 15 && z1 > 112) return true; }
  return false;
}

export function buildSkyline(ctx, ex) {
  WORLD = ctx.world;
  const root = new THREE.Group(); root.name = 'skyline';
  ex.root.add(root);
  const R = rng(9001);
  const B = [];
  const pal = [0xc9c4ba, 0xb8b2a8, 0xd6d2ca, 0x9ea3a8, 0xbfb6a6, 0x8f9499, 0xd9d0bf, 0xa79e90, 0xe2ddd4, 0x7f858c, 0xc4b8a2].map(h => new THREE.Color(h));
  const CX = 0, CZ = 60, RMAX = 860;
  // block grid with streets
  for (let bz = -900; bz < 1000; bz += 52) for (let bx = -900; bx < 900; bx += 46) {
    const sx = 46 - R.range(8, 14), sz = 52 - R.range(9, 16);
    const bx0 = bx + R.range(0, 4), bz0 = bz + R.range(0, 4);
    // subdivide into lots
    const nx = R.int(1, 3), nz = R.int(1, 2);
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const lx0 = bx0 + i * sx / nx + 0.5, lx1 = bx0 + (i + 1) * sx / nx - 0.5;
      const lz0 = bz0 + j * sz / nz + 0.5, lz1 = bz0 + (j + 1) * sz / nz - 0.5;
      const cx = (lx0 + lx1) / 2, cz = (lz0 + lz1) / 2;
      const dist = Math.hypot(cx - CX, cz - CZ);
      if (dist > RMAX) continue;
      if (excluded(lx0, lz0, lx1, lz1)) continue;
      if (R.chance(0.08)) continue; // car parks / gaps
      let h = R.range(14, 42);
      if (R.chance(0.12)) h = R.range(45, 80);
      if (R.chance(0.035)) h = R.range(90, 165);
      // a little lower east (Nipponbashi) & taller north (Shinsaibashi / Midosuji)
      if (cx > 200) h *= 0.8;
      if (cz < -400) h *= 1.15;
      if (cx > COMPLEX[0] && cx < COMPLEX[2] && cz > COMPLEX[1] && cz < COMPLEX[3]) h = Math.min(h, 34);
      const shrink = h > 80 ? 0.75 : 1;
      const w = (lx1 - lx0) * shrink, d = (lz1 - lz0) * shrink;
      const kind = h > 80 ? (R.chance(0.6) ? 2 : 1) : R.chance(0.35) ? 3 : 1;
      B.push({ x: cx, z: cz, w, d, h, col: R.pick(pal), kind, lit: R.range(0.25, 0.7) });
    }
  }
  // ---- instanced buildings -----------------------------------------------------------
  const geo = new THREE.BoxGeometry(1, 1, 1); geo.translate(0, 0.5, 0);
  const mat = cityMaterial();
  const im = new THREE.InstancedMesh(geo, mat, B.length);
  const params = new Float32Array(B.length * 4);
  const m = new THREE.Matrix4();
  B.forEach((b, i) => {
    m.makeScale(b.w, b.h, b.d).setPosition(b.x, 0, b.z);
    im.setMatrixAt(i, m);
    im.setColorAt(i, b.col);
    params.set([b.kind, R.range(0, 100), b.lit, 1], i * 4);
  });
  geo.setAttribute('aParams', new THREE.InstancedBufferAttribute(params, 4));
  im.instanceColor.needsUpdate = true;
  im.computeBoundingSphere();
  im.name = 'city:buildings';
  im.castShadow = false; im.receiveShadow = false;
  root.add(im);
  // ---- rooftop clutter: AC units, water tanks, billboards, plant rooms -----------------
  const RF = [];
  for (const b of B) {
    const n = b.h > 60 ? 2 : R.int(1, 4);
    for (let k = 0; k < n; k++) {
      const s = R.range(1.5, 4.5);
      RF.push({ x: b.x + R.range(-0.35, 0.35) * b.w, z: b.z + R.range(-0.35, 0.35) * b.d, y: b.h, w: s, d: s * R.range(0.6, 1.4), h: R.range(1, 3.5), col: new THREE.Color(R.pick([0xbdbdbd, 0x9a9a98, 0xd8d8d4, 0x6f7377])) });
    }
    if (b.h < 50 && R.chance(0.12)) RF.push({ x: b.x, z: b.z, y: b.h + 2, w: Math.min(b.w * 0.8, 12), d: 0.4, h: 5, col: new THREE.Color().setHSL(R(), 0.6, 0.45), bill: true });
  }
  const g2 = new THREE.BoxGeometry(1, 1, 1); g2.translate(0, 0.5, 0);
  const im2 = new THREE.InstancedMesh(g2, mat, RF.length);
  const p2 = new Float32Array(RF.length * 4);
  RF.forEach((r, i) => { m.makeScale(r.w, r.h, r.d).setPosition(r.x, r.y, r.z); im2.setMatrixAt(i, m); im2.setColorAt(i, r.col); p2.set([0, 0, 0, 1], i * 4); });
  g2.setAttribute('aParams', new THREE.InstancedBufferAttribute(p2, 4));
  im2.computeBoundingSphere(); im2.name = 'city:roofs';
  root.add(im2);
  // ---- landmarks --------------------------------------------------------------------------
  root.add(buildLandmarks(mat));
  ex.city = { count: B.length, buildings: B };
  return {
    update(dt) {
      const D = ex.daylight, s = ex.sun;
      CITY_U.uSunDir.value.copy(s.direction);
      CITY_U.uSunCol.value.copy(s.color);
      const elev = Math.max(0, s.direction.y);
      const day = Math.min(1, elev * 3) * Math.min(1.5, s.intensity);
      CITY_U.uSunE.value = 18 * s.intensity * Math.min(1, elev * 4);
      const skyE = 0.06 + 4.2 * day;
      CITY_U.uSkyE.value.setRGB(skyE * 0.82, skyE * 0.93, skyE * 1.12);
      CITY_U.uHor.value.copy(ex.horizon);
      CITY_U.uNight.value = D.night;
    },
  };
}

// Landmarks at their true bearings from Namba Parks, pulled in to ~800 m and
// scaled to keep their true angular size; extra haze for their real distance.
function buildLandmarks(mat) {
  const parts = [];
  const C = [50, 300];
  const place = (azDeg, dist, realDist) => {
    const a = azDeg * Math.PI / 180;
    return { x: C[0] + Math.sin(a) * dist, z: C[1] - Math.cos(a) * dist, k: dist / realDist, haze: realDist / dist };
  };
  // Abeno Harukas: 300 m, three stacked volumes stepping back
  {
    const P = place(149, 820, 2080), k = P.k;
    const add = (ox, oz, w, d, y0, h, col = 0xb9c3cc, kind = 2) => parts.push({ x: P.x + ox * k, z: P.z + oz * k, y: y0 * k, w: w * k, d: d * k, h: h * k, col, kind, haze: P.haze });
    add(0, 0, 76, 64, 0, 118);
    add(-6, 4, 64, 56, 118, 112);
    add(-12, 8, 50, 46, 230, 62);
    add(-12, 8, 30, 30, 292, 8, 0x8d949b, 0);
  }
  // Tsutenkaku: 103 m tower with splayed base and observation deck
  {
    const P = place(158, 760, 1120), k = P.k;
    const add = (ox, oz, w, d, y0, h, col = 0xd8d4cc, kind = 0) => parts.push({ x: P.x + ox * k, z: P.z + oz * k, y: y0 * k, w: w * k, d: d * k, h: h * k, col, kind, haze: P.haze });
    for (const [ox, oz] of [[-9, -9], [9, -9], [-9, 9], [9, 9]]) add(ox, oz, 4, 4, 0, 24, 0xc9c4b8);
    add(0, 0, 22, 22, 22, 6, 0xd6d0c4);
    add(0, 0, 12, 12, 28, 50, 0xd2ccc0);
    add(0, 0, 18, 18, 78, 14, 0xe4ded2);
    add(0, 0, 9, 9, 92, 6, 0xd6d0c4);
    add(0, 0, 1.5, 1.5, 98, 9, 0x9a9a9a);
  }
  const geo = new THREE.BoxGeometry(1, 1, 1); geo.translate(0, 0.5, 0);
  const im = new THREE.InstancedMesh(geo, mat, parts.length);
  const params = new Float32Array(parts.length * 4);
  const m = new THREE.Matrix4();
  parts.forEach((p, i) => { m.makeScale(p.w, p.h, p.d).setPosition(p.x, p.y, p.z); im.setMatrixAt(i, m); im.setColorAt(i, new THREE.Color(p.col)); params.set([p.kind, i * 3.7, 0.5, p.haze], i * 4); });
  geo.setAttribute('aParams', new THREE.InstancedBufferAttribute(params, 4));
  im.computeBoundingSphere(); im.name = 'city:landmarks';
  return im;
}
