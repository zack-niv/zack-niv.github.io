// GLSL for the post pipeline (js/render/post.js). WebGL2 / GLSL ES 3.0 via
// THREE.ShaderMaterial (texture2D → texture, gl_FragColor mapped by three).

export const VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }
`;

// helpers shared by depth-reading passes
const DEPTH = /* glsl */`
uniform sampler2D tDepth;
uniform vec4 uProj;      // P[0][0], P[1][1], near, far
float viewZAt( vec2 uv ) {
  float d = texture2D( tDepth, uv ).x;
  float n = uProj.z, f = uProj.w;
  return ( n * f ) / ( ( f - n ) * d - f ); // negative
}
vec3 viewPosAt( vec2 uv, float vz ) {
  vec2 ndc = uv * 2.0 - 1.0;
  return vec3( ndc.x * -vz / uProj.x, ndc.y * -vz / uProj.y, vz );
}
float ign( vec2 p ) { return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) ); }
`;

// 13-tap downsample (CoD AW). First level uses Karis average to kill fireflies.
export const DOWN = /* glsl */`
uniform sampler2D tSrc;
uniform vec2 uTexel;    // 1 / source size
uniform float uKaris;
varying vec2 vUv;
vec3 s( vec2 o ) { return texture2D( tSrc, vUv + o * uTexel ).rgb; }
float kw( vec3 c ) { return 1.0 / ( 1.0 + dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ) ); }
void main() {
  vec3 a = s( vec2( -2, -2 ) ), b = s( vec2( 0, -2 ) ), c = s( vec2( 2, -2 ) );
  vec3 d = s( vec2( -1, -1 ) ), e = s( vec2( 1, -1 ) );
  vec3 f = s( vec2( -2, 0 ) ), g = s( vec2( 0, 0 ) ), h = s( vec2( 2, 0 ) );
  vec3 i = s( vec2( -1, 1 ) ), j = s( vec2( 1, 1 ) );
  vec3 k = s( vec2( -2, 2 ) ), l = s( vec2( 0, 2 ) ), m = s( vec2( 2, 2 ) );
  vec3 o;
  if ( uKaris > 0.5 ) {
    vec3 g0 = ( d + e + i + j ) * 0.25, g1 = ( a + b + f + g ) * 0.25, g2 = ( b + c + g + h ) * 0.25, g3 = ( f + g + k + l ) * 0.25, g4 = ( g + h + l + m ) * 0.25;
    float w0 = kw( g0 ) * 0.5, w1 = kw( g1 ) * 0.125, w2 = kw( g2 ) * 0.125, w3 = kw( g3 ) * 0.125, w4 = kw( g4 ) * 0.125;
    o = ( g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4 ) / ( w0 + w1 + w2 + w3 + w4 );
  } else {
    o = ( d + e + i + j ) * 0.125 + ( a + c + k + m ) * 0.03125 + ( b + f + h + l ) * 0.0625 + g * 0.125;
  }
  gl_FragColor = vec4( max( o, 0.0 ), 1.0 );
}
`;

// 9-tap tent upsample, added onto the next-finer level
export const UP = /* glsl */`
uniform sampler2D tSrc;   // coarser (upsampled) level
uniform sampler2D tBase;  // same-size level of the down chain
uniform vec2 uTexel;      // 1 / coarse size
uniform float uRadius;
uniform float uMix;
varying vec2 vUv;
void main() {
  vec2 t = uTexel * uRadius;
  vec3 c = texture2D( tSrc, vUv ).rgb * 4.0;
  c += ( texture2D( tSrc, vUv + vec2( -t.x, 0 ) ).rgb + texture2D( tSrc, vUv + vec2( t.x, 0 ) ).rgb + texture2D( tSrc, vUv + vec2( 0, -t.y ) ).rgb + texture2D( tSrc, vUv + vec2( 0, t.y ) ).rgb ) * 2.0;
  c += texture2D( tSrc, vUv + vec2( -t.x, -t.y ) ).rgb + texture2D( tSrc, vUv + vec2( t.x, -t.y ) ).rgb + texture2D( tSrc, vUv + vec2( -t.x, t.y ) ).rgb + texture2D( tSrc, vUv + vec2( t.x, t.y ) ).rgb;
  c /= 16.0;
  gl_FragColor = vec4( mix( texture2D( tBase, vUv ).rgb, c, uMix ), 1.0 );
}
`;

// Scalable ambient obscurance from depth only (half resolution)
export const SSAO = /* glsl */`
${DEPTH}
uniform vec2 uTexel;     // 1 / full-res depth size
uniform float uRadius;   // world metres
uniform float uIntensity;
uniform float uFrame;
varying vec2 vUv;
vec3 nrm( vec2 uv, vec3 p ) {
  vec3 pr = viewPosAt( uv + vec2( uTexel.x * 2.0, 0 ), viewZAt( uv + vec2( uTexel.x * 2.0, 0 ) ) );
  vec3 pl = viewPosAt( uv - vec2( uTexel.x * 2.0, 0 ), viewZAt( uv - vec2( uTexel.x * 2.0, 0 ) ) );
  vec3 pu = viewPosAt( uv + vec2( 0, uTexel.y * 2.0 ), viewZAt( uv + vec2( 0, uTexel.y * 2.0 ) ) );
  vec3 pd = viewPosAt( uv - vec2( 0, uTexel.y * 2.0 ), viewZAt( uv - vec2( 0, uTexel.y * 2.0 ) ) );
  vec3 dx = abs( pr.z - p.z ) < abs( p.z - pl.z ) ? pr - p : p - pl;
  vec3 dy = abs( pu.z - p.z ) < abs( p.z - pd.z ) ? pu - p : p - pd;
  return normalize( cross( dx, dy ) );
}
void main() {
  float vz = viewZAt( vUv );
  if ( -vz > uProj.w * 0.95 ) { gl_FragColor = vec4( 1.0 ); return; }
  vec3 p = viewPosAt( vUv, vz );
  vec3 n = nrm( vUv, p );
  float rs = uRadius * uProj.x * 0.5 / -vz; // radius in uv units
  rs = min( rs, 0.12 );
  float ang = ign( gl_FragCoord.xy + uFrame * 7.0 ) * 6.2831853;
  float occ = 0.0;
  const int NS = 10;
  for ( int i = 0; i < NS; i ++ ) {
    float fi = ( float( i ) + 0.5 ) / float( NS );
    float a = ang + fi * 6.2831853 * 2.618;
    vec2 off = vec2( cos( a ), sin( a ) ) * rs * fi;
    vec2 suv = vUv + off * vec2( 1.0, uProj.x / uProj.y );
    vec3 q = viewPosAt( suv, viewZAt( suv ) );
    vec3 v = q - p;
    float vv = dot( v, v );
    float vn = dot( v, n );
    float fall = max( 0.0, 1.0 - vv / ( uRadius * uRadius ) );
    occ += max( 0.0, vn - 0.02 * -vz ) / ( vv + 0.01 ) * fall;
  }
  occ = 1.0 - min( 1.0, occ * uIntensity * 2.0 / float( NS ) );
  gl_FragColor = vec4( occ, -vz, 0.0, 1.0 );
}
`;

// depth-aware 4x4 blur of the AO buffer
export const AOBLUR = /* glsl */`
uniform sampler2D tAO;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec2 c = texture2D( tAO, vUv ).rg;
  float sum = 0.0, w = 0.0;
  for ( int y = -2; y < 2; y ++ ) for ( int x = -2; x < 2; x ++ ) {
    vec2 s = texture2D( tAO, vUv + ( vec2( x, y ) + 0.5 ) * uTexel ).rg;
    float wt = max( 0.0, 1.0 - abs( s.y - c.y ) / ( 0.05 * c.y + 0.05 ) );
    sum += s.x * wt; w += wt;
  }
  gl_FragColor = vec4( w > 0.0 ? sum / w : c.x, c.y, 0.0, 1.0 );
}
`;

// Screen-space reflections for glossy floors (half resolution).
// Scene alpha = 1 - refl, refl = floorness * (1 - roughness / 0.6) (material patch).
// Output: premultiplied reflection colour (rgb) and weight (a); glossy blur
// comes from sampling the bloom pyramid by roughness and ray length.
export const SSR = /* glsl */`
${DEPTH}
uniform sampler2D tScene;
uniform sampler2D tMip0;
uniform sampler2D tMip1;
uniform sampler2D tMip2;
uniform vec3 uUpView;     // world up in view space (floor normal)
uniform vec2 uTexel;
uniform float uFrame;
uniform float uMaxDist;
varying vec2 vUv;
vec2 proj( vec3 p ) { return vec2( p.x * uProj.x / -p.z, p.y * uProj.y / -p.z ) * 0.5 + 0.5; }
void main() {
  float refl = 1.0 - texture2D( tScene, vUv ).a;
  if ( refl < 0.03 ) { gl_FragColor = vec4( 0.0 ); return; }
  float vz = viewZAt( vUv );
  vec3 p = viewPosAt( vUv, vz );
  vec3 V = normalize( p );
  vec3 N = uUpView;
  vec3 R = reflect( V, N );
  float NoV = max( dot( N, -V ), 0.0 );
  float F = 0.04 + 0.96 * pow( 1.0 - NoV, 5.0 );
  float facing = smoothstep( 0.15, -0.2, R.z );
  if ( facing <= 0.0 ) { gl_FragColor = vec4( 0.0 ); return; }
  float jit = ign( gl_FragCoord.xy + uFrame * 3.0 );
  float stepLen = 0.15 + 0.015 * -vz;
  vec3 pos = p + N * 0.02;
  float t = stepLen * ( 0.5 + jit );
  vec2 hit = vec2( -1.0 ); float hitT = 0.0;
  for ( int i = 0; i < 30; i ++ ) {
    vec3 q = pos + R * t;
    if ( q.z > -0.06 ) break;
    vec2 uv = proj( q );
    if ( uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 ) break;
    float dz = viewZAt( uv ) - q.z; // > 0: ray went behind the surface
    float thick = 0.3 + 0.08 * t;
    if ( dz > 0.0 && dz < thick ) {
      float a = max( 0.0, t - stepLen ), b = t;
      for ( int k = 0; k < 5; k ++ ) {
        float m = 0.5 * ( a + b );
        vec3 qm = pos + R * m; vec2 um = proj( qm );
        if ( viewZAt( um ) - qm.z > 0.0 ) b = m; else a = m;
      }
      hitT = b; hit = proj( pos + R * b );
      break;
    }
    t += stepLen;
    stepLen *= 1.14;
    if ( t > uMaxDist ) break;
  }
  if ( hit.x < 0.0 ) { gl_FragColor = vec4( 0.0 ); return; }
  vec2 e = smoothstep( 0.0, 0.07, hit ) * smoothstep( 1.0, 0.93, hit );
  float conf = e.x * e.y * facing * smoothstep( uMaxDist, uMaxDist * 0.4, hitT );
  if ( -viewZAt( hit ) > uProj.w * 0.9 ) conf = 0.0;
  float rough = 0.6 * ( 1.0 - refl );
  // cone footprint: blur grows with roughness and distance travelled
  float k = clamp( rough * 6.0 + rough * hitT * 0.35, 0.0, 3.0 );
  vec3 c0 = texture2D( tScene, hit ).rgb, c1 = texture2D( tMip0, hit ).rgb, c2 = texture2D( tMip1, hit ).rgb, c3 = texture2D( tMip2, hit ).rgb;
  vec3 rc = k < 1.0 ? mix( c0, c1, k ) : k < 2.0 ? mix( c1, c2, k - 1.0 ) : mix( c2, c3, k - 2.0 );
  float w = conf * F * refl * refl;
  gl_FragColor = vec4( min( rc, vec3( 32.0 ) ) * w, w );
}
`;

// separable 9-tap blur of the (premultiplied) SSR buffer
export const SSRBLUR = /* glsl */`
uniform sampler2D tSrc;
uniform vec2 uDir; // texel step
varying vec2 vUv;
void main() {
  vec4 c = texture2D( tSrc, vUv ) * 0.227027;
  c += ( texture2D( tSrc, vUv + uDir * 1.3846 ) + texture2D( tSrc, vUv - uDir * 1.3846 ) ) * 0.316216;
  c += ( texture2D( tSrc, vUv + uDir * 3.2308 ) + texture2D( tSrc, vUv - uDir * 3.2308 ) ) * 0.070270;
  gl_FragColor = c;
}
`;

// Final composite: AO, SSR, bloom, exposure, grade, tonemap, vignette, CA, grain → LDR (sRGB)
export const COMPOSITE = /* glsl */`
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform sampler2D tAO;
uniform sampler2D tSSR;
uniform float uExposure;
uniform float uBloom;
uniform float uAO;
uniform float uSSR;
uniform vec3 uLift, uGamma, uGain;
uniform float uSat, uContrast;
uniform float uVignette, uGrain, uCA, uTime;
uniform float uFlash;
uniform int uTonemap;
varying vec2 vUv;
float lum( vec3 c ) { return dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ); }
// --- AgX (Blender / three.js) ---
const mat3 LIN_REC2020_TO_LIN_SRGB = mat3( vec3( 1.6605, -0.1246, -0.0182 ), vec3( -0.5876, 1.1329, -0.1006 ), vec3( -0.0728, -0.0083, 1.1187 ) );
const mat3 LIN_SRGB_TO_LIN_REC2020 = mat3( vec3( 0.6274, 0.0691, 0.0164 ), vec3( 0.3293, 0.9195, 0.0880 ), vec3( 0.0433, 0.0113, 0.8956 ) );
vec3 agxContrast( vec3 x ) { vec3 x2 = x * x; vec3 x4 = x2 * x2; return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232; }
vec3 agx( vec3 color ) {
  const mat3 AgXInsetMatrix = mat3( vec3( 0.856627153315983, 0.137318972929847, 0.11189821299995 ), vec3( 0.0951212405381588, 0.761241990602591, 0.0767994186031903 ), vec3( 0.0482516061458583, 0.101439036467562, 0.811302368396859 ) );
  const mat3 AgXOutsetMatrix = mat3( vec3( 1.1271005818144368, -0.1413297634984383, -0.14132976349843826 ), vec3( -0.11060664309660323, 1.157823702216272, -0.11060664309660294 ), vec3( -0.016493938717834573, -0.016493938717834257, 1.2519364065950405 ) );
  const float AgxMinEv = -12.47393; const float AgxMaxEv = 4.026069;
  color = LIN_SRGB_TO_LIN_REC2020 * color;
  color = AgXInsetMatrix * color;
  color = max( color, 1e-10 ); color = log2( color );
  color = ( color - AgxMinEv ) / ( AgxMaxEv - AgxMinEv );
  color = clamp( color, 0.0, 1.0 );
  color = agxContrast( color );
  // "punchy" look
  float l = lum( color );
  color = l + 1.12 * ( color - l );
  color = AgXOutsetMatrix * color;
  color = pow( max( vec3( 0.0 ), color ), vec3( 2.2 ) );
  color = LIN_REC2020_TO_LIN_SRGB * color;
  return clamp( color, 0.0, 1.0 );
}
// --- Khronos PBR Neutral ---
vec3 neutral( vec3 color ) {
  const float StartCompression = 0.8 - 0.04; const float Desaturation = 0.15;
  float x = min( color.r, min( color.g, color.b ) );
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max( color.r, max( color.g, color.b ) );
  if ( peak < StartCompression ) return color;
  float d = 1. - StartCompression;
  float newPeak = 1. - d * d / ( peak + d - StartCompression );
  color *= newPeak / peak;
  float g = 1. - 1. / ( Desaturation * ( peak - newPeak ) + 1. );
  return mix( color, vec3( newPeak ), g );
}
// --- ACES fitted (Hill) ---
vec3 aces( vec3 color ) {
  const mat3 I = mat3( vec3( 0.59719, 0.07600, 0.02840 ), vec3( 0.35458, 0.90834, 0.13383 ), vec3( 0.04823, 0.01566, 0.83777 ) );
  const mat3 O = mat3( vec3( 1.60475, -0.10208, -0.00327 ), vec3( -0.53108, 1.10813, -0.07276 ), vec3( -0.07367, -0.00605, 1.07602 ) );
  color = I * ( color / 0.6 );
  vec3 a = color * ( color + 0.0245786 ) - 0.000090537;
  vec3 b = color * ( 0.983729 * color + 0.4329510 ) + 0.238081;
  return clamp( O * ( a / b ), 0.0, 1.0 );
}
vec3 srgb( vec3 c ) { return mix( c * 12.92, 1.055 * pow( c, vec3( 1.0 / 2.4 ) ) - 0.055, step( 0.0031308, c ) ); }
float hash( vec2 p ) { return fract( sin( dot( p, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ); }
void main() {
  vec2 uv = vUv;
  vec2 dc = uv - 0.5;
  float r2 = dot( dc, dc );
  // mild lateral chromatic aberration towards the edges
  vec3 col;
  if ( uCA > 0.0 ) {
    vec2 o = dc * r2 * uCA;
    col = vec3( texture2D( tScene, uv - o ).r, texture2D( tScene, uv ).g, texture2D( tScene, uv + o ).b );
  } else col = texture2D( tScene, uv ).rgb;
#ifdef USE_AO
  float ao = texture2D( tAO, uv ).r;
  col *= mix( 1.0, ao, uAO );
#endif
#ifdef USE_SSR
  col += texture2D( tSSR, uv ).rgb * uSSR;
#endif
#ifdef USE_BLOOM
  vec3 bl = texture2D( tBloom, uv ).rgb;
  col = mix( col, bl, uBloom );
#endif
  col *= uExposure;
  col += uFlash;
  // grading (scene-referred, before the tonemapper): white balance gain, lift, gamma
  col *= uGain;
  col = max( col + uLift * 0.02, 0.0 );
  float l = lum( col );
  col = max( l + uSat * ( col - l ), 0.0 );
  // contrast around mid grey in log space
  col = 0.18 * pow( col / 0.18 + 1e-6, vec3( uContrast ) );
  vec3 m;
  if ( uTonemap == 1 ) m = neutral( col );
  else if ( uTonemap == 2 ) m = aces( col );
  else m = agx( col );
  m = pow( m, uGamma );
  // vignette (natural cos^4-ish falloff)
  m *= mix( 1.0, smoothstep( 0.9, 0.25, r2 * 1.6 ), uVignette );
  vec3 o = srgb( m );
  // film grain (luminance-weighted, in display space)
  float gn = hash( uv * 1000.0 + fract( uTime ) * 61.0 ) - 0.5;
  o += gn * uGrain * ( 1.0 - o * 0.6 );
  gl_FragColor = vec4( o, lum( m ) );
}
`;

// FXAA 3.11 (quality-lite), input is display-referred with luma in alpha
export const FXAA = /* glsl */`
uniform sampler2D tSrc;
uniform vec2 uTexel;
varying vec2 vUv;
float L( vec2 uv ) { return texture2D( tSrc, uv ).a; }
void main() {
  vec4 c = texture2D( tSrc, vUv );
  float lM = c.a;
  float lN = L( vUv + vec2( 0, uTexel.y ) ), lS = L( vUv - vec2( 0, uTexel.y ) );
  float lE = L( vUv + vec2( uTexel.x, 0 ) ), lW = L( vUv - vec2( uTexel.x, 0 ) );
  float mx = max( max( lN, lS ), max( max( lE, lW ), lM ) ), mn = min( min( lN, lS ), min( min( lE, lW ), lM ) );
  float range = mx - mn;
  if ( range < max( 0.0312, mx * 0.125 ) ) { gl_FragColor = vec4( c.rgb, 1.0 ); return; }
  float lNE = L( vUv + uTexel ), lNW = L( vUv + vec2( -uTexel.x, uTexel.y ) ), lSE = L( vUv + vec2( uTexel.x, -uTexel.y ) ), lSW = L( vUv - uTexel );
  float filt = 2.0 * ( lN + lS + lE + lW ) + lNE + lNW + lSE + lSW;
  filt = abs( filt / 12.0 - lM );
  filt = clamp( filt / range, 0.0, 1.0 );
  float blend = smoothstep( 0.0, 1.0, filt ); blend = blend * blend * 0.75;
  float hz = abs( lN + lS - 2.0 * lM ) * 2.0 + abs( lNE + lSE - 2.0 * lE ) + abs( lNW + lSW - 2.0 * lW );
  float vt = abs( lE + lW - 2.0 * lM ) * 2.0 + abs( lNE + lNW - 2.0 * lN ) + abs( lSE + lSW - 2.0 * lS );
  bool horz = hz >= vt;
  float pL = horz ? lN : lE, nL = horz ? lS : lW;
  float pG = abs( pL - lM ), nG = abs( nL - lM );
  float stepL = horz ? uTexel.y : uTexel.x;
  float gradient, oppL;
  if ( pG < nG ) { stepL = -stepL; oppL = nL; gradient = nG; } else { oppL = pL; gradient = pG; }
  vec2 uvE = vUv; if ( horz ) uvE.y += stepL * 0.5; else uvE.x += stepL * 0.5;
  vec2 es = horz ? vec2( uTexel.x, 0 ) : vec2( 0, uTexel.y );
  float edgeL = ( lM + oppL ) * 0.5, gT = gradient * 0.25;
  vec2 puv = uvE + es, nuv = uvE - es;
  float pd = L( puv ) - edgeL, nd = L( nuv ) - edgeL;
  bool pe = abs( pd ) >= gT, ne = abs( nd ) >= gT;
  for ( int i = 0; i < 8 && !( pe && ne ); i ++ ) {
    float s = i < 2 ? 1.0 : i < 5 ? 1.5 : 2.0;
    if ( !pe ) { puv += es * s; pd = L( puv ) - edgeL; pe = abs( pd ) >= gT; }
    if ( !ne ) { nuv -= es * s; nd = L( nuv ) - edgeL; ne = abs( nd ) >= gT; }
  }
  float pDist = horz ? puv.x - vUv.x : puv.y - vUv.y, nDist = horz ? vUv.x - nuv.x : vUv.y - nuv.y;
  float sd = min( pDist, nDist );
  bool dsgn = ( pDist <= nDist ? pd : nd ) >= 0.0;
  float eb = ( ( lM - edgeL >= 0.0 ) == dsgn ) ? 0.0 : 0.5 - sd / ( pDist + nDist );
  float fb = max( eb, blend );
  vec2 fuv = vUv; if ( horz ) fuv.y += stepL * fb; else fuv.x += stepL * fb;
  gl_FragColor = vec4( texture2D( tSrc, fuv ).rgb, 1.0 );
}
`;
