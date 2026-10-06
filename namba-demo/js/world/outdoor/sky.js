// Sky dome: analytic day/dusk/night gradient, Mie sun glow, sun disc,
// procedural drifting clouds (two fbm layers), stars and the orange glow of a
// city of nine million on the horizon at night. One draw call.
import * as THREE from 'three';

const VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
  gl_Position.z = gl_Position.w * 0.99999; // pin to the far plane
}`;

const FRAG = /* glsl */`
uniform vec3 uSunDir;
uniform vec3 uZen, uHor, uGlow, uSun, uCloudLit, uCloudDark;
uniform float uTime, uNight, uCover, uGain;
varying vec3 vDir;

float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = r * p * 2.03 + 11.7; a *= 0.5; }
  return s;
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float mu = dot(d, uSunDir);
  // --- base gradient (Rayleigh-ish) ---
  float hp = max(h, 0.0);
  vec3 col = mix(uHor, uZen, pow(hp, 0.42));
  // brighter, whiter band right at the horizon (haze)
  col = mix(col, uHor * 1.15 + 0.03, exp(-hp * 18.0) * 0.6);
  // below the horizon: hazy city murk
  if (h < 0.0) col = mix(uHor * 0.75, uHor * 0.35 + uZen * 0.1, clamp(-h * 4.0, 0.0, 1.0));
  // --- sun glow (Mie) & horizon warmth towards the sun ---
  float m = max(mu, 0.0);
  col += uGlow * (0.18 * pow(m, 6.0) + 0.5 * pow(m, 48.0)) * (0.6 + 0.4 * exp(-hp * 4.0));
  float az = max(0.0, dot(normalize(d.xz + 1e-4), normalize(uSunDir.xz + 1e-4)));
  col += uGlow * 0.35 * pow(az, 3.0) * exp(-abs(h) * 9.0) * clamp(1.0 - uSunDir.y * 4.0, 0.0, 1.0);
  // --- night: city light pollution & stars ---
  col += vec3(0.20, 0.10, 0.045) * uNight * exp(-hp * 7.0) * 0.55;
  if (uNight > 0.0 && h > 0.05) {
    vec2 sp = d.xz / (h + 0.4) * 220.0;
    float st = step(0.9965, h21(floor(sp))) * smoothstep(0.5, 0.0, length(fract(sp) - 0.5));
    col += vec3(0.6, 0.65, 0.8) * st * uNight * 0.35 * smoothstep(0.05, 0.4, h);
  }
  // --- sun disc ---
  float disc = smoothstep(0.99985, 0.99993, mu);
  col += uSun * disc * 60.0 * smoothstep(-0.02, 0.01, uSunDir.y);
  // --- clouds ---
  if (h > 0.0) {
    vec2 uv = d.xz / (h + 0.06);
    vec2 wind = vec2(uTime * 0.0035, uTime * 0.0012);
    float n = fbm(uv * 1.2 + wind);
    float detail = fbm(uv * 4.5 - wind * 2.0);
    float dens = smoothstep(uCover, uCover + 0.32, n * 0.82 + detail * 0.3);
    // high wispy layer
    float cirr = smoothstep(0.55, 0.95, fbm(vec2(uv.x * 0.6, uv.y * 2.4) * 0.8 + wind * 0.5)) * 0.35;
    dens = max(dens, cirr);
    dens *= smoothstep(0.0, 0.18, h);
    // lighting: thicker = darker underside, sun-facing rim brighter
    float thick = smoothstep(uCover, uCover + 0.6, n);
    vec3 cl = mix(uCloudLit, uCloudDark, thick * 0.75);
    cl += uGlow * 1.2 * pow(m, 10.0) * (1.0 - thick);
    cl = mix(cl, col, exp(-h * 9.0) * 0.55); // aerial fade
    col = mix(col, cl, dens * 0.92);
  }
  gl_FragColor = vec4(col * uGain, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createSky() {
  const uniforms = {
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uZen: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() },
    uSun: { value: new THREE.Color() }, uCloudLit: { value: new THREE.Color() }, uCloudDark: { value: new THREE.Color() },
    uTime: { value: 0 }, uNight: { value: 0 }, uCover: { value: 0.52 }, uGain: { value: 4.5 },
  };
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false, toneMapped: true });
  mat.name = 'outdoor_sky';
  const geo = new THREE.SphereGeometry(500, 48, 24);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'sky';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.matrixAutoUpdate = true;
  return { mesh, uniforms };
}
