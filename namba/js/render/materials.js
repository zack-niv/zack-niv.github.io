// Shared material library. Every builder asks for materials by name so the
// look of the place stays consistent and GPU state is shared.
//
//   ctx.materials.get('floor_terrazzo')  -> THREE.Material (cached, lazy)
//   ctx.materials.texture(name, factory) -> THREE.Texture (cached)
//   ctx.materials.define(name, factory)  -> register a new material
//   ctx.materials.pbr(texKey, opts)      -> factory for a procedural PBR material
//        texKey: entry of js/render/textures/library.js TEX (porcelain, terrazzo,
//        marble, metro_tile, strata, concrete, brushed, deck, paving, ...)
//        opts: { color, rough, metal, normal, scale, env, side, transparent,
//                opacity, offset (polygonOffset for decals/inlays) }
//   ctx.materials.texSet(texKey)         -> { map, normalMap, ormMap, size }
//
// Procedural PBR: albedo + normal + roughness/metalness (packed G/B) canvases,
// seamless, mipmapped, anisotropy from engine.quality. All UVs in the game are
// world-planar metres (GeoBatch), so each texture's repeat = 1 / metres covered
// and texel density stays consistent (~200–430 px/m at high quality). Canvases
// are generated once per family and shared between materials (clones share the
// GPU texture; only repeat differs).
import * as THREE from 'three';
import { TEX, diffuserCanvas, radialCanvas, aoCanvas } from './textures/library.js';

const HDR = (r, g, b, k) => new THREE.Color(r, g, b).multiplyScalar(k);

export class Materials {
  constructor(ctx) {
    this.ctx = ctx;
    this.cache = new Map();
    this.textures = new Map();
    this.factories = new Map();
    this.sets = new Map();
    const eng = ctx && ctx.engine;
    const qn = (eng && eng.qualityName) || 'high';
    this.aniso = Math.min((eng && eng.quality && eng.quality.anisotropy) || 4,
      (eng && eng.renderer && eng.renderer.capabilities.getMaxAnisotropy()) || 16);
    this.res = qn === 'low' ? { hi: 512, mid: 256, lo: 128 } : qn === 'ultra' ? { hi: 1024, mid: 1024, lo: 256 } : { hi: 1024, mid: 512, lo: 256 };
    this.stats = { canvases: 0, bytes: 0, genMs: 0 };
    this._defineAll();
  }

  // --------------------------------------------------------------------------
  _defineAll() {
    const D = (n, f) => this.define(n, f);
    const P = (k, o) => this.pbr(k, o);
    const std = (color, roughness = 0.6, metalness = 0, extra = {}) => () => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
    const inlay = { offset: true };
    // ---- floors -------------------------------------------------------------
    D('floor_terrazzo', P('terrazzo', {}));
    D('floor_tile_grey', P('tile_grey', {}));
    D('floor_tile_warm', P('tile_warm', {}));
    D('floor_polished', P('porcelain', {}));
    D('floor_porcelain', P('porcelain', {}));
    D('floor_porcelain_warm', P('porcelain', { color: 0xf3e6d2 }));
    D('floor_marble', P('marble', {}));
    D('floor_stone_dark', P('granite_dark', {}));
    D('floor_granite', P('granite_dark', {}));
    D('floor_wood', P('wood', {}));
    D('floor_deck', P('deck', {}));
    D('floor_paving', P('paving', {}));
    D('floor_paving_warm', P('paving', { color: 0xf0dcc0 }));
    D('floor_platform', P('platform', {}));
    D('floor_metro', P('tile_grey', { color: 0xf4eee2 }));
    D('floor_concrete', P('concrete', { scale: 1.5, color: 0xd8d6d0 }));
    D('tactile_yellow', P('tactile_line', inlay));
    D('tactile_line', P('tactile_line', inlay));
    D('tactile_dot', P('tactile_dot', inlay));
    D('inlay_granite', P('granite_dark', inlay));
    D('inlay_stone_light', P('marble', { ...inlay, color: 0xe8e2d6 }));
    D('inlay_terrazzo_dark', P('terrazzo', { ...inlay, color: 0x5d5a58 }));
    D('inlay_brass', P('brushed', { ...inlay, color: 0xd6b26a, rough: 0.8 }));
    D('inlay_steel', P('brushed', { ...inlay }));
    D('grass', std(0x4f7d32, 0.95));
    D('soil', std(0x4a3a2a, 1.0));
    // ---- walls --------------------------------------------------------------
    D('wall_panel_white', P('panel_white', {}));
    D('wall_tile_white', P('white_tile', {}));
    D('wall_tile_metro', P('metro_tile', {}));
    D('wall_tile_dado', P('metro_tile', { color: 0x9a9894 }));
    D('wall_concrete', P('concrete', {}));
    D('concrete_exposed', P('concrete', {}));
    D('wall_stone_warm', P('stone_warm', {}));
    D('wall_marble', P('marble', { scale: 1 }));
    D('wall_strata', P('strata', {}));
    D('wall_dark', P('panel_dark', {}));
    D('wall_shopfront', std(0x1d1e22, 0.5));
    D('wall_wood', P('ceil_wood_slat', { scale: 1.5 }));
    // line-colour bands (Osaka Metro / Nankai), slightly glossy enamel
    const band = (c) => () => new THREE.MeshStandardMaterial({ color: c, roughness: 0.3, metalness: 0.0 });
    D('band_midosuji', band(0xe5171f));
    D('band_sennichimae', band(0xe44d93));
    D('band_yotsubashi', band(0x0078ba));
    D('band_nankai', band(0xf08300));
    D('band_walk', band(0xd9a400));
    D('band_city', band(0x2a7fc1));
    D('band_parks', band(0x4f9a4a));
    D('band_grey', band(0x5b5f66));
    // ---- ceilings -----------------------------------------------------------
    D('ceiling_panel', P('ceil_grid', { scale: 1, color: 0xfafafa, normal: 0.6 }));
    D('ceiling_plaster', () => new THREE.MeshStandardMaterial({ color: 0xeeeeec, roughness: 0.92 }));
    D('ceiling_grid', P('ceil_grid', {}));
    D('ceiling_perforated', P('ceil_perf', {}));
    D('ceiling_linear', P('ceil_linear', {}));
    D('ceiling_metal', P('ceil_linear', { color: 0xc8ccd2 }));
    D('ceiling_dark', P('panel_dark', { color: 0x8a8a8a }));
    D('ceiling_wood', P('ceil_wood_slat', {}));
    D('roof_deck', P('roof_deck', {}));
    // ---- metal, glass ---------------------------------------------------------
    D('steel', P('brushed', {}));
    D('steel_brushed', P('brushed', {}));
    D('stainless', P('brushed', { rough: 0.55 }));
    D('steel_dark', P('brushed', { color: 0x4a4e55, rough: 1.4 }));
    D('aluminium', P('brushed', { color: 0xe4e8ec, rough: 1.3 }));
    D('steel_painted_white', std(0xe9eaea, 0.45, 0.1));
    D('steel_painted_grey', std(0x7d838a, 0.5, 0.3));
    D('steel_painted_dark', std(0x34383e, 0.55, 0.3));
    D('glass', () => new THREE.MeshPhysicalMaterial({ color: 0xbfd8e0, roughness: 0.05, metalness: 0, transmission: 0, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.5 }));
    D('glass_rail', () => new THREE.MeshStandardMaterial({ color: 0xcfe6ea, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.6 }));
    D('glass_edge', () => new THREE.MeshStandardMaterial({ color: 0x8fc4b8, roughness: 0.1, metalness: 0, transparent: true, opacity: 0.55 }));
    D('glass_frosted', () => new THREE.MeshStandardMaterial({ color: 0xdfe8ec, roughness: 0.35, metalness: 0, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }));
    D('rubber_black', std(0x141414, 0.7));
    D('rubber_dark', std(0x1d1e20, 0.8));
    D('esc_handrail', () => { const m = this._pbrMat('handrail', {}); return m; });
    D('esc_step', P('esc_step', { scale: 1 }));
    D('esc_landing', P('landing', {}));
    D('esc_comb', () => new THREE.MeshStandardMaterial({ color: 0xf2b705, roughness: 0.45, metalness: 0.2 }));
    D('esc_deck', P('brushed', { rough: 0.9 }));
    D('esc_cladding', P('brushed', { color: 0xdfe3e8, scale: 3, rough: 0.8 }));
    D('esc_cladding_white', std(0xf0f0ee, 0.35, 0.05));
    // ---- light emitters (HDR, picked up by bloom) ------------------------------
    D('light_panel', () => new THREE.MeshBasicMaterial({ color: HDR(1.0, 0.98, 0.94, 2.2) }));
    D('light_warm', () => new THREE.MeshBasicMaterial({ color: HDR(1.0, 0.82, 0.6, 2.0) }));
    D('light_cool', () => new THREE.MeshBasicMaterial({ color: HDR(0.85, 0.93, 1.0, 2.4) }));
    D('light_line_cool', () => new THREE.MeshBasicMaterial({ color: HDR(0.9, 0.95, 1.0, 3.0) }));
    D('light_line_neutral', () => new THREE.MeshBasicMaterial({ color: HDR(1.0, 0.96, 0.9, 3.0) }));
    D('light_line_warm', () => new THREE.MeshBasicMaterial({ color: HDR(1.0, 0.83, 0.62, 2.8) }));
    D('light_troffer', () => new THREE.MeshBasicMaterial({ color: HDR(0.92, 0.96, 1.0, 2.2), map: this.texture('diffuser', () => this._canvasTex(diffuserCanvas(64), false)) }));
    D('light_troffer_warm', () => new THREE.MeshBasicMaterial({ color: HDR(1.0, 0.9, 0.76, 2.0), map: this.texture('diffuser', () => this._canvasTex(diffuserCanvas(64), false)) }));
    D('light_down_warm', () => new THREE.MeshBasicMaterial({ color: HDR(1.0, 0.84, 0.64, 3.0), map: this.texture('radial', () => this._canvasTex(radialCanvas(64), false)) }));
    D('light_down_neutral', () => new THREE.MeshBasicMaterial({ color: HDR(1.0, 0.95, 0.88, 3.0), map: this.texture('radial', () => this._canvasTex(radialCanvas(64), false)) }));
    D('light_cove_warm', () => new THREE.MeshBasicMaterial({ color: HDR(1.0, 0.8, 0.58, 1.4) }));
    D('light_cove_cool', () => new THREE.MeshBasicMaterial({ color: HDR(0.9, 0.95, 1.0, 1.4) }));
    D('light_skylight', () => new THREE.MeshBasicMaterial({ color: HDR(0.86, 0.92, 1.0, 1.6) }));
    D('light_pendant', () => new THREE.MeshBasicMaterial({ color: HDR(1.0, 0.9, 0.75, 3.2) }));
    D('esc_skirt_light', () => new THREE.MeshBasicMaterial({ color: HDR(0.85, 0.93, 1.0, 1.8) }));
    // contact shadow / AO strip (transparent gradient, opaque at v=0)
    D('ao_strip', () => new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false, map: this.texture('ao', () => this._canvasTex(aoCanvas(64), false, true)), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 }));
    // ---- trackbed -------------------------------------------------------------
    D('ballast', P('ballast', {}));
    D('rail_steel', std(0x8a8782, 0.35, 0.85));
    D('track_slab', P('concrete', { color: 0x9c9a95, scale: 1.2 }));
    D('sleeper', P('concrete', { color: 0xb5b2aa, scale: 0.5 }));
  }

  // --------------------------------------------------------------------------
  define(name, factory) { this.factories.set(name, factory); this.cache.delete(name); }
  get(name) {
    let m = this.cache.get(name);
    if (m) return m;
    const f = this.factories.get(name);
    if (!f) { console.warn('[materials] unknown', name); m = new THREE.MeshStandardMaterial({ color: 0xff00ff }); }
    else {
      try { m = f(); } catch (e) { console.error('[materials] factory failed', name, e); m = new THREE.MeshStandardMaterial({ color: 0x888888 }); }
    }
    m.name = name;
    this.cache.set(name, m);
    return m;
  }
  has(name) { return this.factories.has(name); }
  texture(name, factory) {
    let t = this.textures.get(name);
    if (!t && factory) { t = factory(); this.textures.set(name, t); }
    return t;
  }

  _canvasTex(canvas, srgb, clampEdge = false) {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = clampEdge ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    t.anisotropy = this.aniso;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    this.stats.canvases++;
    this.stats.bytes += canvas.width * canvas.height * 4 * 1.33;
    return t;
  }

  // Lazily generate (once) the canvases of a texture family.
  texSet(key) {
    let s = this.sets.get(key);
    if (s) return s;
    const def = TEX[key];
    if (!def) throw new Error('unknown texture ' + key);
    const t0 = performance.now();
    const N = this.res[def.res] || 512;
    const c = def.make(N);
    s = {
      size: def.size,
      map: this._canvasTex(c.albedo, true),
      normalMap: c.normal ? this._canvasTex(c.normal, false) : null,
      ormMap: this._canvasTex(c.orm, false),
    };
    this.stats.genMs += performance.now() - t0;
    this.sets.set(key, s);
    return s;
  }
  _rep(tex, su, sv) {
    if (!tex) return null;
    const t = tex.clone();
    t.repeat.set(1 / su, 1 / sv);
    t.needsUpdate = false;
    return t;
  }
  _pbrMat(key, o = {}) {
    const s = this.texSet(key);
    const sc = o.scale || 1;
    const su = s.size[0] * sc, sv = s.size[1] * sc;
    const m = new THREE.MeshStandardMaterial({
      color: o.color != null ? o.color : 0xffffff,
      roughness: o.rough != null ? o.rough : 1,
      metalness: o.metal != null ? o.metal : 1,
      map: this._rep(s.map, su, sv),
      roughnessMap: this._rep(s.ormMap, su, sv),
      side: o.side || THREE.FrontSide,
    });
    m.metalnessMap = m.roughnessMap;
    if (s.normalMap && o.normal !== 0) {
      m.normalMap = this._rep(s.normalMap, su, sv);
      const k = o.normal != null ? o.normal : 1;
      m.normalScale = new THREE.Vector2(k, k);
    }
    if (o.env != null) m.envMapIntensity = o.env;
    if (o.transparent) { m.transparent = true; m.opacity = o.opacity != null ? o.opacity : 1; m.depthWrite = false; }
    if (o.offset) { m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -4; }
    m.userData.texKey = key; m.userData.uvSize = [su, sv];
    return m;
  }
  pbr(key, o = {}) { return () => this._pbrMat(key, o); }
}
