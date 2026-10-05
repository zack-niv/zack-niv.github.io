// =============================================================================
// Crowd materials: MeshStandardMaterial + injected GPU vertex animation.
// Per-instance attributes (all vec4):
//   iPos  (x, y, z, yaw)              yaw 0 faces north (-Z), like the player
//   iPose (phase, walkAmt, sit, lean)
//   iHead (headPitch(+down), headYaw, armInL, armInR)
//   iArmL / iArmR (pitch(+fwd), abduct(+out), elbow(+bend), hold(0..1 kills swing))
//   iLook (heightScale, build, flags, fade)
//   iColA (top, bottom, shoes, hair)   packed 0xRRGGBB
//   iColB (skin, inner, acc, acc2)
// =============================================================================
import * as THREE from 'three';

export const INSTANCE_ATTRS = ['iPos', 'iPose', 'iHead', 'iArmL', 'iArmR', 'iLook', 'iColA', 'iColB'];

const VERT_HEAD = /* glsl */`
attribute vec4 aPart;
attribute vec4 iPos; attribute vec4 iPose; attribute vec4 iHead; attribute vec4 iArmL; attribute vec4 iArmR;
attribute vec4 iLook; attribute vec4 iColA; attribute vec4 iColB;
varying vec3 vCrowdCol;
varying float vCrowdFade;
vec3 crowdUnpack(float v) {
  float r = floor(v / 65536.0);
  float g = floor((v - r * 65536.0) / 256.0);
  float b = v - r * 65536.0 - g * 256.0;
  return pow(vec3(r, g, b) / 255.0, vec3(2.2));
}
mat3 crX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 crY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 crZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
`;

const VERT_BODY = /* glsl */`
  vec3 crowdP = vec3(position);
  vec3 objectNormal = vec3(normal);
  {
    int bone = int(aPart.x + 0.5);
    int reg = int(aPart.y + 0.5);
    int grp = int(aPart.z + 0.5);
    int val = int(aPart.w + 0.5);
    int flags = int(iLook.z + 0.5);
    bool show = true;
    if (grp == 1) show = ((flags >> 13) & 7) == val;
    else if (grp == 2) show = ((flags >> val) & 1) == 1;
    else if (grp == 3) show = ((flags >> val) & 1) == 0;
    float ph = iPose.x, amt = iPose.y, sit = iPose.z, lean = iPose.w;
    float s1 = sin(ph), c1 = cos(ph);
    bool kid = ((flags >> 22) & 1) == 1;
    // ---- legs ----
    if (bone >= 7 && bone <= 10) {
      bool left = bone <= 8;
      float sg = left ? 1.0 : -1.0;
      float th = sg * amt * 0.42 * s1;
      float knee = amt * (0.1 + 0.8 * max(0.0, sg * c1));
      th = mix(th, 1.45, sit); knee = mix(knee, 1.48, sit);
      vec3 hip = vec3(left ? -0.09 : 0.09, 0.92, 0.0);
      vec3 kn = vec3(hip.x, 0.5, 0.0);
      if (bone == 8 || bone == 10) { mat3 K = crX(-knee); crowdP = kn + K * (crowdP - kn); objectNormal = K * objectNormal; }
      mat3 T = crX(th); crowdP = hip + T * (crowdP - hip); objectNormal = T * objectNormal;
    }
    // ---- arms ----
    if (bone >= 3 && bone <= 6) {
      bool left = bone <= 4;
      vec4 A = left ? iArmL : iArmR;
      float sg = left ? -1.0 : 1.0;
      float swing = sg * amt * 0.36 * s1;
      float pitch = A.x + swing * (1.0 - A.w);
      float elbow = A.z + amt * (0.16 + 0.22 * max(0.0, sg * s1)) * (1.0 - A.w);
      float abd = (A.y + 0.05) * sg;
      float yin = (left ? iHead.z : iHead.w) * sg;
      vec3 sh = vec3(sg * 0.198, 1.41, 0.0);
      vec3 el = vec3(sg * 0.215, 1.135, 0.0);
      if (bone == 4 || bone == 6) { mat3 E = crX(elbow); crowdP = el + E * (crowdP - el); objectNormal = E * objectNormal; }
      mat3 S = crY(yin) * crZ(abd) * crX(pitch); crowdP = sh + S * (crowdP - sh); objectNormal = S * objectNormal;
    }
    // ---- head ----
    if (bone == 2) {
      vec3 nk = vec3(0.0, 1.5, 0.0);
      if (kid) crowdP = nk + (crowdP - nk) * 1.28;
      mat3 H = crY(iHead.y) * crX(-iHead.x);
      crowdP = nk + H * (crowdP - nk); objectNormal = H * objectNormal;
    }
    // ---- torso (carries arms, head, back accessories) ----
    if (bone >= 1 && bone <= 6) {
      vec3 sp = vec3(0.0, 0.95, 0.0);
      float tw = amt * 0.085 * s1;
      mat3 Tz = crY(tw) * crX(-(lean + 0.045 * min(amt, 1.2)));
      crowdP = sp + Tz * (crowdP - sp); objectNormal = Tz * objectNormal;
    }
    // ---- pelvis: bob, sway, idle weight shift, sitting ----
    if (bone != 11) {
      float idle = 1.0 - clamp(amt * 2.0, 0.0, 1.0);
      crowdP.y += amt * 0.026 * cos(2.0 * ph) - sit * 0.445;
      crowdP.x += amt * 0.02 * s1 + idle * (1.0 - sit) * 0.014 * s1;
      crowdP.y += idle * 0.004 * sin(ph * 3.1);
    }
    float hs = iLook.x;
    crowdP.y *= hs;
    crowdP.xz *= iLook.y * (0.55 + 0.45 * hs);
    mat3 Yw = crY(iPos.w);
    crowdP = Yw * crowdP + iPos.xyz;
    objectNormal = Yw * objectNormal;
    if (!show) crowdP = vec3(0.0, -999.0, 0.0);
    // ---- colour ----
    vec3 col;
    if (reg == 0) col = crowdUnpack(iColB.x);
    else if (reg == 1) col = crowdUnpack(iColA.w);
    else if (reg == 2) col = crowdUnpack(iColA.x);
    else if (reg == 3) col = crowdUnpack(iColB.y);
    else if (reg == 4) col = crowdUnpack(iColA.y);
    else if (reg == 5) col = crowdUnpack(iColA.z);
    else if (reg == 6) col = crowdUnpack(iColB.z);
    else if (reg == 7) col = crowdUnpack(iColB.w);
    else if (reg == 8) col = vec3(0.012);
    else if (reg == 9) col = vec3(0.78);
    else if (reg == 10) col = vec3(0.32, 0.34, 0.37);
    else if (reg == 11) col = ((flags >> 18) & 1) == 1 ? vec3(0.018, 0.017, 0.017) : crowdUnpack(iColB.x) * 0.93;
    else col = vec3(0.004);
    vCrowdCol = col;
    vCrowdFade = iLook.w;
  }
`;

const FRAG_HEAD = /* glsl */`
varying vec3 vCrowdCol;
varying float vCrowdFade;
`;
const FRAG_COLOR = /* glsl */`
  diffuseColor.rgb *= vCrowdCol;
  if (vCrowdFade < 0.999) {
    float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    if (ign > vCrowdFade) discard;
  }
`;

export function makeHumanMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0.0, envMapIntensity: 0.6 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = VERT_HEAD + sh.vertexShader
      .replace('#include <beginnormal_vertex>', VERT_BODY)
      .replace('#include <begin_vertex>', 'vec3 transformed = crowdP;');
    sh.fragmentShader = FRAG_HEAD + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG_COLOR);
  };
  m.customProgramCacheKey = () => 'namba_crowd_human_v1';
  m.name = 'crowd_human';
  return m;
}

export function makeBlobMaterial() {
  return new THREE.ShaderMaterial({
    name: 'crowd_blob',
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    uniforms: {},
    vertexShader: /* glsl */`
      attribute vec4 iBlob; // x, y, z, size
      attribute vec4 iBlobB; // alpha, stretch, yaw, -
      varying vec2 vUv; varying float vA;
      void main() {
        vUv = uv; vA = iBlobB.x;
        float c = cos(iBlobB.z), s = sin(iBlobB.z);
        vec3 p = position * vec3(iBlob.w, 1.0, iBlob.w * iBlobB.y);
        p = vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
        p += iBlob.xyz + vec3(0.0, 0.012, 0.0);
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */`
      varying vec2 vUv; varying float vA;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float a = 0.42 * exp(-d * d * 5.5) + 0.22 * (1.0 - smoothstep(0.35, 1.0, d));
        gl_FragColor = vec4(0.0, 0.0, 0.0, a * vA);
      }`,
  });
}
