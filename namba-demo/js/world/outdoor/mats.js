// Material definitions for the outdoors (registered in the shared library,
// names prefixed parks_ / out_).
import * as THREE from 'three';
import * as TX from './textures.js';

let done = false;
export function defineOutdoorMaterials(ctx) {
  if (done && ctx.materials.factories.has('parks_strata')) return;
  done = true;
  const M = ctx.materials;
  const std = (o) => () => new THREE.MeshStandardMaterial(o);
  M.define('parks_strata', () => {
    const t = TX.strata(ctx);
    return new THREE.MeshStandardMaterial({ map: t.map, bumpMap: t.bump, bumpScale: 2.5, vertexColors: true, roughness: 0.88, metalness: 0 });
  });
  M.define('parks_coping', std({ color: 0xe6dccb, roughness: 0.7 }));
  M.define('parks_stone_edge', () => {
    const t = TX.paving(ctx, 'edge', [196, 188, 172], 12);
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.8, color: 0xffffff });
  });
  M.define('parks_paving', () => {
    const t = TX.paving(ctx, 'parkpave', [182, 168, 146], 7);
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.82, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  });
  M.define('parks_groundcover', () => new THREE.MeshStandardMaterial({ map: TX.groundcover(ctx), roughness: 0.95, color: 0xffffff }));
  M.define('parks_soil', () => new THREE.MeshStandardMaterial({ map: TX.soil(ctx), roughness: 1 }));
  M.define('parks_deck', () => new THREE.MeshStandardMaterial({ map: TX.deck(ctx), roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  M.define('parks_deck_side', () => new THREE.MeshStandardMaterial({ map: TX.deck(ctx), roughness: 0.75, color: 0xb59a80 }));
  M.define('parks_glass', () => new THREE.MeshStandardMaterial({ color: 0xb8d4dc, roughness: 0.04, metalness: 0.2, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.5 }));
  M.define('parks_steel', std({ color: 0xc4c8cc, roughness: 0.3, metalness: 0.85 }));
  M.define('parks_steel_dark', std({ color: 0x3a3d40, roughness: 0.45, metalness: 0.7 }));
  M.define('parks_concrete', std({ color: 0xb9b2a6, roughness: 0.9 }));
  M.define('parks_slab_under', std({ color: 0xd8d0c2, roughness: 0.85 }));
  M.define('parks_bench_wood', () => new THREE.MeshStandardMaterial({ map: TX.deck(ctx), roughness: 0.6, color: 0xd8b48c }));
  M.define('parks_lamp_glow', () => new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.85, 0.62).multiplyScalar(3) }));
  M.define('parks_water', () => new THREE.MeshStandardMaterial({ color: 0x1d3a3c, roughness: 0.06, metalness: 0.0, envMapIntensity: 1.6 }));
}
