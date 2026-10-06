// =============================================================================
// Shader injection: every lit three.js material (Standard / Physical / Lambert /
// Phong) is patched at compile time so it is lit by the baked light field,
// sky + masked sun, local-brightness-normalised environment reflections and a
// small pool of real specular fixtures. Installed as a prototype accessor on
// THREE.Material.onBeforeCompile so builders' own hooks keep working (chained
// after ours) and nobody has to opt in.
// =============================================================================
import * as THREE from 'three';
import { LEVEL_ORDER, LEVELS } from '../../world/layout.js';

export const NB_LEVELS = LEVEL_ORDER.length;
export const NB_DYN = 4; // real specular fixtures per fragment (8 unrolled GGX evaluations made every lit program slow to compile)

const dummy = (() => { const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1); t.needsUpdate = true; return t; })();
const dummyC = (() => { const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); t.needsUpdate = true; return t; })();

// Shared uniform objects (referenced by every patched program)
export const U = {
  nbA: { value: dummy }, nbB: { value: dummy }, nbC: { value: dummyC },
  nbAtlasInv: { value: new THREE.Vector2(1, 1) },
  nbLevelRect: { value: Array.from({ length: NB_LEVELS }, () => new THREE.Vector4(0, 0, 0, 0)) }, // x0, z0, offU, offV (texels)
  nbLevelExt: { value: Array.from({ length: NB_LEVELS }, (_, i) => new THREE.Vector4(0, 0, LEVELS[LEVEL_ORDER[i]].y, 0)) }, // w, h, floorY, enabled
  nbSky: { value: new THREE.Vector3(1.6, 1.8, 2.1) },        // sky irradiance on an up-facing outdoor surface
  nbGround: { value: new THREE.Vector3(0.35, 0.33, 0.3) },   // outdoor ground bounce (up-irradiance fraction)
  nbAmbient: { value: new THREE.Vector3(0.05, 0.05, 0.055) },// floor so nothing is pure black
  nbOutside: { value: new THREE.Vector3(1.0, 1.0, 1.0) },    // multiplier for geometry outside every level map (exteriors)
  nbParams: { value: new THREE.Vector4(1, 1, 1, 0) },        // x: AO strength, y: bake gain, z: env strength, w: debug mode
  nbEnvRef: { value: 1.0 },                                  // luminance of the env map's diffuse irradiance
  nbEmissiveGain: { value: 3.0 },                            // HDR MeshBasic fixtures
  nbDynPos: { value: Array.from({ length: NB_DYN }, () => new THREE.Vector4(0, -1000, 0, 0)) }, // xyz, range
  nbDynCol: { value: Array.from({ length: NB_DYN }, () => new THREE.Vector4(0, 0, 0, 0.3)) },   // rgb, radius
  nbDynDir: { value: Array.from({ length: NB_DYN }, () => new THREE.Vector4(0, -1, 0, 1)) },    // dir, exponent
};

const PARS = /* glsl */`
#define NB_LF 1
uniform sampler2D nbA;
uniform sampler2D nbB;
uniform sampler2D nbC;
uniform vec2 nbAtlasInv;
uniform vec4 nbLevelRect[${NB_LEVELS}];
uniform vec4 nbLevelExt[${NB_LEVELS}];
uniform vec3 nbSky;
uniform vec3 nbGround;
uniform vec3 nbAmbient;
uniform vec3 nbOutside;
uniform vec4 nbParams;
uniform float nbEnvRef;
uniform vec4 nbDynPos[${NB_DYN}];
uniform vec4 nbDynCol[${NB_DYN}];
uniform vec4 nbDynDir[${NB_DYN}];
float nbLum( vec3 c ) { return dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ); }
// atlas uv of world xz on level l; returns false when outside that level's map
bool nbUV( int l, vec2 xz, out vec2 uv ) {
  vec4 r = nbLevelRect[ l ]; vec4 e = nbLevelExt[ l ];
  vec2 t = xz - r.xy;
  uv = ( r.zw + t ) * nbAtlasInv;
  return e.w > 0.5 && t.x >= 0.0 && t.y >= 0.0 && t.x <= e.x && t.y <= e.y;
}
`;

// Code that runs before lights_fragment_begin: computes nbE (irradiance for
// this fragment's normal), nbSunVis, nbAO, nbSpecOcc.
const PRE = /* glsl */`
vec3 nbWP = ( ( vec4( - vViewPosition, 1.0 ) - viewMatrix[ 3 ] ) * viewMatrix ).xyz;
vec3 nbWN = normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );
vec3 nbE = vec3( 0.0 );
float nbSunVis = 1.0;
float nbAO = 1.0;
{
  float ys = nbWP.y + ( nbWN.y < -0.5 ? -0.3 : 0.3 );
  int lv = 0;
  for ( int i = 1; i < ${NB_LEVELS}; i ++ ) { if ( ys >= nbLevelExt[ i ].z ) lv = i; }
  vec2 sxz = nbWP.xz + nbWN.xz * 0.45; // normal offset: walls sample their room side
  vec2 uv; vec4 C = vec4( 0.0 );
  bool ok = nbUV( lv, sxz, uv );
  if ( ok ) { C = texture2D( nbC, uv ); ok = C.g > 0.5; }
  if ( ! ok ) {
    // high ceilings poking into the next level's band, track beds just below a floor
    int alt = ( lv + 1 < ${NB_LEVELS} && nbLevelExt[ min( lv + 1, ${NB_LEVELS - 1} ) ].z - nbWP.y < 1.6 ) ? lv + 1 : lv - 1;
    if ( alt >= 0 ) { lv = alt; ok = nbUV( lv, sxz, uv ); if ( ok ) { C = texture2D( nbC, uv ); ok = C.g > 0.5; } }
  }
  float up = max( nbWN.y, 0.0 ), dn = max( - nbWN.y, 0.0 ), sd = 1.0 - abs( nbWN.y );
  if ( ok ) {
    vec4 A = texture2D( nbA, uv );
    vec4 B = texture2D( nbB, uv );
    vec3 sideCol = B.rgb;
    vec3 downCol = B.a * mix( vec3( 1.0 ), ( sideCol + 1e-4 ) / ( nbLum( sideCol ) + 1e-4 ), 0.45 );
    nbE = ( up * A.rgb + sd * sideCol + dn * downCol ) * nbParams.y;
    float sky = A.a;
    nbE += sky * ( nbSky * ( up + 0.5 * sd + 0.06 * dn ) + nbSky * nbGround * ( dn * 0.9 + sd * 0.5 ) );
    nbSunVis = C.a;
    // geometric AO: floor near walls, wall base, ceiling corners, obstacle contact
    float h = nbWP.y - nbLevelExt[ lv ].z;
    float wd = C.r * 4.0;
    float aoFloor = mix( 0.42, 1.0, smoothstep( 0.0, 0.9, wd ) );
    float aoWall = mix( 0.5, 1.0, smoothstep( 0.0, 0.75, h ) );
    float aoCeil = mix( 0.6, 1.0, smoothstep( 0.0, 1.0, wd ) );
    float ao = up > 0.6 ? ( h < 0.4 ? aoFloor : 1.0 ) : ( dn > 0.6 ? aoCeil : aoWall );
    ao *= 1.0 - 0.6 * C.b * ( 1.0 - smoothstep( 0.0, 1.1, h ) );
    nbAO = mix( 1.0, ao, nbParams.x );
  } else {
    // exteriors (city blocks, sky-facing facades): plain daylight
    nbE = ( nbSky * ( up + 0.5 * sd + 0.06 * dn ) + nbSky * nbGround * ( dn * 0.9 + sd * 0.5 ) ) * nbOutside;
  }
  nbE = ( nbE + nbAmbient ) * nbAO;
}
`;

// After lights_fragment_maps: replace three's indirect diffuse with ours,
// normalise env reflections to local brightness, add specular fixtures.
const POST = /* glsl */`
#if defined( RE_IndirectDiffuse )
  irradiance = vec3( 0.0 );
  iblIrradiance = nbE;
#endif
#if defined( RE_IndirectSpecular )
  {
    float envScale = clamp( nbLum( nbE ) / max( nbEnvRef, 1e-3 ), 0.03, 6.0 ) * nbParams.z;
    radiance *= envScale * mix( 1.0, nbAO, 0.7 );
  }
#endif
#ifdef STANDARD
  for ( int i = 0; i < ${NB_DYN}; i ++ ) {
    vec4 lp = nbDynPos[ i ];
    if ( lp.w <= 0.0 ) continue;
    vec3 Lw = lp.xyz - nbWP;
    float d2 = dot( Lw, Lw );
    if ( d2 > lp.w * lp.w ) continue;
    float d = sqrt( d2 );
    vec3 Ld = Lw / d;
    vec4 ld = nbDynDir[ i ];
    float cosE = dot( ld.xyz, - Ld );
    float prof = ld.w <= 0.0 ? 1.0 : pow( max( cosE, 0.0 ), ld.w );
    float win = pow2( saturate( 1.0 - pow2( pow2( d / lp.w ) ) ) );
    vec3 L = normalize( ( viewMatrix * vec4( Ld, 0.0 ) ).xyz );
    float NoL = saturate( dot( geometryNormal, L ) );
    if ( NoL <= 0.0 || prof <= 0.0 ) continue;
    vec3 Hh = normalize( L + geometryViewDir );
    float NoV = saturate( dot( geometryNormal, geometryViewDir ) );
    float NoH = saturate( dot( geometryNormal, Hh ) );
    float VoH = saturate( dot( geometryViewDir, Hh ) );
    // sphere-light roughness widening (Karis)
    float a = pow2( material.roughness );
    float a2 = saturate( a + nbDynCol[ i ].w / ( 2.0 * d ) );
    vec3 F = F_Schlick( material.specularColorBlended, material.specularF90, VoH );
    float spec = D_GGX( a2, NoH ) * V_GGX_SmithCorrelated( a2, NoL, NoV );
    reflectedLight.directSpecular += F * spec * NoL * nbDynCol[ i ].rgb * ( prof * win / max( d2, 0.2 ) ) * nbAO;
  }
#endif
`;

// Sun (directional lights) masked to open-sky cells
const SUNMASK_FIND = 'getDirectionalLightInfo( directionalLight, directLight );';
const SUNMASK_REPL = 'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= nbSunVis;';

// opaque output alpha = 1 - floor reflectivity (read by the SSR pass)
const ALPHA = /* glsl */`
#if defined( OPAQUE ) && defined( STANDARD ) && defined( NB_REFLECT )
  {
    // stable (texture-averaged) roughness: per-texel roughness noise would make the SSR blur flicker
    float nbR = roughness;
    #ifdef USE_ROUGHNESSMAP
      nbR *= textureLod( roughnessMap, vRoughnessMapUv, 4.0 ).g;
    #endif
    gl_FragColor.a = 1.0 - nbReflect * smoothstep( 0.82, 0.97, nbWN.y ) * clamp( 1.0 - nbR / 0.6, 0.0, 1.0 );
  }
#endif
`;

// HDR emissive fixtures (MeshBasic with colour > 1): one global gain so the
// fixtures sit at the right ratio to the light field they emit (bloom, glare)
function isHDRBasic(m) { return m.isMeshBasicMaterial && m.color && Math.max(m.color.r, m.color.g, m.color.b) > 1.01; }
function patchBasic(material, shader) {
  shader.uniforms.nbEmissiveGain = U.nbEmissiveGain;
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform float nbEmissiveGain;')
    .replace('#include <opaque_fragment>', '#include <opaque_fragment>\ngl_FragColor.rgb *= nbEmissiveGain;');
}

function patch(material, shader) {
  if (material.userData && material.userData.nbUnlit) return;
  if (isHDRBasic(material)) { patchBasic(material, shader); return; }
  if (!(material.isMeshStandardMaterial || material.isMeshLambertMaterial || material.isMeshPhongMaterial)) return;
  let fs = shader.fragmentShader;
  if (!fs.includes('#include <lights_fragment_begin>') || !fs.includes('#include <lights_fragment_maps>')) return;
  Object.assign(shader.uniforms, U);
  const refl = material.userData && material.userData.nbReflect != null ? material.userData.nbReflect : 1;
  // nbReflect is a per-material uniform (not a baked constant) so every reflectivity value shares one program
  let defs = '';
  if (material.isMeshStandardMaterial) { shader.uniforms.nbReflect = { value: refl }; defs = '#define NB_REFLECT 1\nuniform float nbReflect;\n'; }
  fs = fs.replace('#include <common>', '#include <common>\n' + PARS + defs);
  // expand lights_fragment_begin so the directional loop can be masked
  const begin = THREE.ShaderChunk.lights_fragment_begin.replace(SUNMASK_FIND, SUNMASK_REPL);
  fs = fs.replace('#include <lights_fragment_begin>', PRE + begin);
  fs = fs.replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\n' + POST);
  fs = fs.replace('#include <opaque_fragment>', '#include <opaque_fragment>\n' + ALPHA);
  shader.fragmentShader = fs;
}

// Guard for builder hooks that read `objectNormal` / `transformed` before three's
// chunk declares it (a shader compile error would delete the material's geometry).
function fixVertex(shader) {
  let vs = shader.vertexShader;
  const decl = vs.indexOf('#include <beginnormal_vertex>');
  if (decl < 0) return;
  const first = vs.indexOf('objectNormal');
  if (first < 0 || first > decl) return;
  const head = vs.slice(0, decl).replace(/\bobjectNormal\b/g, 'normal');
  shader.vertexShader = head + vs.slice(decl);
}

let installed = false;
export function installMaterialHook() {
  if (installed) return; installed = true;
  const userHooks = new WeakMap();
  const P = THREE.Material.prototype;
  function nbHook(shader, renderer) {
    // re-entrancy guard: a builder hook that chains to the "previous"
    // onBeforeCompile (which is us) must not recurse
    if (this.__nbInHook) return;
    this.__nbInHook = true;
    try {
      try { patch(this, shader); } catch (e) { console.error('[render] material patch failed', e); }
      const u = userHooks.get(this);
      if (u) {
        u.call(this, shader, renderer);
        try { fixVertex(shader); } catch (e) { /* leave as is */ }
      }
    } finally { this.__nbInHook = false; }
  }
  Object.defineProperty(P, 'onBeforeCompile', {
    configurable: true,
    get() { return nbHook; },
    set(fn) { if (fn === nbHook) return; userHooks.set(this, fn); },
  });
  P.customProgramCacheKey = function () {
    const u = userHooks.get(this);
    return 'nb4|' + (u ? (this.name || '') : '') + '|' + (this.userData && this.userData.nbUnlit ? 'u' : '') + (isHDRBasic(this) ? 'h' : '') + '|' + (u ? u.toString() : '');
  };
}
