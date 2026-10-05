// Shared material library. Every builder asks for materials by name so the
// look of the place stays consistent and GPU state is shared.
//
//   ctx.materials.get('floor_terrazzo')  -> THREE.Material (cached)
//   ctx.materials.texture(name)          -> THREE.Texture (canvas-generated)
//   ctx.materials.define(name, factory)  -> register a new material
//
// Baseline version: flat-ish PBR materials. The rendering/architecture work
// replaces factories with procedural textures (normal/roughness maps etc.)
// without changing names.
import * as THREE from 'three';

export class Materials {
  constructor(ctx) {
    this.ctx = ctx;
    this.cache = new Map();
    this.textures = new Map();
    this.factories = new Map();
    const std = (color, roughness = 0.6, metalness = 0, extra = {}) => () => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
    const D = (n, f) => this.define(n, f);
    // floors
    D('floor_terrazzo', std(0xd9d4cb, 0.35));
    D('floor_tile_grey', std(0xb9bbbd, 0.45));
    D('floor_tile_warm', std(0xcfc2ad, 0.4));
    D('floor_polished', std(0xe8e4dc, 0.18));
    D('floor_stone_dark', std(0x5d5a56, 0.5));
    D('floor_wood', std(0x9b7652, 0.55));
    D('floor_paving', std(0x8c8a86, 0.85));
    D('floor_platform', std(0x9fa2a3, 0.6));
    D('tactile_yellow', std(0xf2c300, 0.6));
    D('grass', std(0x4f7d32, 0.95));
    D('soil', std(0x4a3a2a, 1.0));
    // walls
    D('wall_panel_white', std(0xeeeeea, 0.55));
    D('wall_tile_white', std(0xf0f0ec, 0.3));
    D('wall_tile_metro', std(0xdcdcd6, 0.35));
    D('wall_concrete', std(0xa9a6a0, 0.85));
    D('wall_stone_warm', std(0xbfa98a, 0.7));
    D('wall_strata', std(0x9c8670, 0.8));
    D('wall_dark', std(0x2e2f33, 0.6));
    D('wall_shopfront', std(0x1d1e22, 0.5));
    // ceilings
    D('ceiling_panel', std(0xe8e8e6, 0.85));
    D('ceiling_dark', std(0x2a2b2e, 0.9));
    D('ceiling_metal', std(0x9fa3a8, 0.5, 0.6));
    // metal, glass
    D('steel', std(0xb8bcc2, 0.32, 0.9));
    D('steel_dark', std(0x3c3f44, 0.45, 0.8));
    D('aluminium', std(0xcfd3d8, 0.38, 0.85));
    D('glass', () => new THREE.MeshPhysicalMaterial({ color: 0xbfd8e0, roughness: 0.05, metalness: 0, transmission: 0, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
    D('glass_rail', () => new THREE.MeshStandardMaterial({ color: 0xcfe6ea, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
    D('rubber_black', std(0x141414, 0.7));
    // light emitters
    D('light_panel', () => new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.98, 0.94).multiplyScalar(2.2) }));
    D('light_warm', () => new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.82, 0.6).multiplyScalar(2.0) }));
    D('light_cool', () => new THREE.MeshBasicMaterial({ color: new THREE.Color(0.85, 0.93, 1.0).multiplyScalar(2.4) }));
    // trackbed
    D('ballast', std(0x3d3934, 1.0));
    D('rail_steel', std(0x7d7a75, 0.4, 0.8));
  }
  define(name, factory) { this.factories.set(name, factory); this.cache.delete(name); }
  get(name) {
    let m = this.cache.get(name);
    if (m) return m;
    const f = this.factories.get(name);
    if (!f) { console.warn('[materials] unknown', name); m = new THREE.MeshStandardMaterial({ color: 0xff00ff }); }
    else m = f();
    m.name = name;
    this.cache.set(name, m);
    return m;
  }
  texture(name, factory) {
    let t = this.textures.get(name);
    if (!t && factory) { t = factory(); this.textures.set(name, t); }
    return t;
  }
}
