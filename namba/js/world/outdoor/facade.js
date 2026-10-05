// Procedural facade materials: window grids computed in the fragment shader
// from metre UVs (u along the facade, v = height), so a whole city block is
// one quad per face. Vertex colour = wall colour; windows reflect a sky-ish
// gradient by day and light up (randomly, warm/cool) at night.
//   facadeMat(ctx, kind)  kind: 'office' | 'grid' | 'curtain' | 'apartment' | 'stone'
import * as THREE from 'three';

export const FACADE_U = { uNight: { value: 0 }, uSkyCol: { value: new THREE.Color(0.6, 0.7, 0.85) } };

const KINDS = {
  //            cell w, h     win x0, y0, y1      glassiness  lit prob
  office:    { cell: [3.2, 3.8], win: [0.06, 0.22, 0.9], glass: 0.85, lit: 0.55, ribbon: 1 },
  grid:      { cell: [2.6, 3.3], win: [0.18, 0.28, 0.82], glass: 0.6, lit: 0.45, ribbon: 0 },
  curtain:   { cell: [1.6, 4.0], win: [0.03, 0.06, 0.97], glass: 1.0, lit: 0.5, ribbon: 0 },
  apartment: { cell: [3.6, 2.95], win: [0.12, 0.3, 0.86], glass: 0.55, lit: 0.6, ribbon: 0, balcony: 1 },
  stone:     { cell: [3.0, 4.4], win: [0.28, 0.25, 0.8], glass: 0.5, lit: 0.4, ribbon: 0 },
};

export function facadeMat(ctx, kind = 'office') {
  const M = ctx.materials, name = 'out_facade_' + kind;
  if (!M.factories.has(name)) M.define(name, () => {
    const K = KINDS[kind];
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, metalness: 0.0, vertexColors: true });
    m.userData.nbReflect = 0;
    m.onBeforeCompile = (s) => {
      s.uniforms.uNight = FACADE_U.uNight; s.uniforms.uSkyCol = FACADE_U.uSkyCol;
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vFUv;\nvarying vec3 vFN;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvFUv = uv;\nvFN = normalize(mat3(modelMatrix) * objectNormal);');
      s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>
        uniform float uNight; uniform vec3 uSkyCol; varying vec2 vFUv; varying vec3 vFN;
        float fh(vec2 p) { p = fract(p * vec2(234.34, 435.345)); p += dot(p, p + 34.23); return fract(p.x * p.y); }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          vec2 fcell = vec2(${K.cell[0].toFixed(2)}, ${K.cell[1].toFixed(2)});
          vec2 fc = vFUv / fcell; vec2 fid = floor(fc); vec2 ff = fract(fc);
          float wx = ${K.ribbon ? '1.0' : `step(${K.win[0].toFixed(2)}, ff.x) * step(ff.x, ${(1 - K.win[0]).toFixed(2)})`};
          float wmask = wx * step(${K.win[1].toFixed(2)}, ff.y) * step(ff.y, ${K.win[2].toFixed(2)});
          wmask *= step(0.6, vFUv.y) * (1.0 - step(0.5, abs(vFN.y)));
          float fr = fh(fid + floor(vFUv.x / 37.0) * 7.0);
          ${K.balcony ? 'float balc = step(0.0, ff.y) * step(ff.y, 0.12); diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.25 + 0.05, balc);' : ''}
          // day: glazing reflects the sky (darker below, brighter up high)
          vec3 glass = mix(vec3(0.05, 0.065, 0.08), uSkyCol * 0.35, 0.35 + 0.4 * fr) * ${K.glass.toFixed(2)} + vec3(0.03) * (1.0 - ${K.glass.toFixed(2)});
          // occasional open blinds / interiors
          glass = mix(glass, vec3(0.28, 0.25, 0.22), step(0.86, fr) * 0.6);
          diffuseColor.rgb = mix(diffuseColor.rgb, glass, wmask);
          float fLit = step(1.0 - ${K.lit.toFixed(2)}, fh(fid * 1.37 + 3.1)) * wmask;`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor = mix(roughnessFactor, 0.12, wmask);`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          { vec3 lc = mix(vec3(1.0, 0.78, 0.5), vec3(0.85, 0.92, 1.0), step(0.6, fh(fid + 9.0)));
            totalEmissiveRadiance += lc * fLit * uNight * (1.2 + 1.5 * fh(fid + 2.0)); }`);
    };
    return m;
  });
  return M.get(name);
}

// Add a facade quad (metre UVs) to a MeshAcc: from (ax,az) to (bx,bz), y0..y1, facing n
export function facadeQuad(acc, ax, az, bx, bz, y0, y1, nx, nz, col, u0 = 0) {
  const len = Math.hypot(bx - ax, bz - az);
  const tx = (bx - ax) / len, tz = (bz - az) / len;
  let A = [ax, az], B = [bx, bz];
  if (-tz * nx + tx * nz < 0) { A = [bx, bz]; B = [ax, az]; }
  acc.quad([A[0], y0, A[1]], [B[0], y0, B[1]], [B[0], y1, B[1]], [A[0], y1, A[1]], [nx, 0, nz], [[u0, y0], [u0 + len, y0], [u0 + len, y1], [u0, y1]], col);
}
// axis-aligned box building with facades on 4 sides (+ roof), skipping faces in `skip` ('n','s','e','w')
export function facadeBox(acc, roofAcc, x0, z0, x1, z1, y0, y1, col, skip = '', roofCol) {
  if (!skip.includes('n')) facadeQuad(acc, x0, z0, x1, z0, y0, y1, 0, -1, col, x0);
  if (!skip.includes('s')) facadeQuad(acc, x0, z1, x1, z1, y0, y1, 0, 1, col, x0);
  if (!skip.includes('w')) facadeQuad(acc, x0, z0, x0, z1, y0, y1, -1, 0, col, z0);
  if (!skip.includes('e')) facadeQuad(acc, x1, z0, x1, z1, y0, y1, 1, 0, col, z0);
  if (roofAcc) roofAcc.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], [[x0, z1], [x1, z1], [x1, z0], [x0, z0]], roofCol || [0.55, 0.55, 0.53]);
}
