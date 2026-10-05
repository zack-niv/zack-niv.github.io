// Renderer, scene graph roots, camera, quality tiers.
//
// Scene organisation (builders MUST follow this so visibility culling works):
//   engine.levelRoot(level)  -> THREE.Group for everything that lives on a
//                               level (architecture, props, shops, signage)
//   engine.globalRoot        -> things visible from everywhere (sky, distant
//                               city, Parks terraces exteriors)
// Visibility of level roots is managed by render/visibility (render system).
//
// Quality: ?quality=low|medium|high|ultra forces a tier; otherwise the tier is
// auto-picked (coarse pointer → low, else high) and render/visibility steps it
// down after a short benchmark if the machine can't hold the frame rate.
// Dynamic resolution (engine.drs, 0.5..1) scales the internal render size.
import * as THREE from 'three';
import { LEVEL_ORDER } from '../world/layout.js';
import { params } from './params.js';

// post: HDR pipeline on/off; bloom/ssao/ssr/fxaa/msaa: post passes;
// specLights: real specular fixtures in the light-field shader; envSize: PMREM size
export const QUALITY = {
  low:    { pixelRatio: 0.75, shadows: false, post: false, bloom: false, ssao: false, ssr: false, fxaa: false, msaa: 0, crowdMax: 500,  drawDist: 90,  anisotropy: 1,  specLights: 2, envSize: 64,  shadowMap: 0,    drsMin: 0.6, vignette: 0.3, grain: 0, ca: 0, maxPR: 1.5 },
  medium: { pixelRatio: 1.0,  shadows: true,  post: true,  bloom: true,  ssao: false, ssr: false, fxaa: true,  msaa: 0, crowdMax: 1100, drawDist: 140, anisotropy: 4,  specLights: 4, envSize: 128, shadowMap: 1024, drsMin: 0.6, vignette: 0.32, grain: 0.015, ca: 0, maxPR: 1.5 },
  high:   { pixelRatio: 1.0,  shadows: true,  post: true,  bloom: true,  ssao: true,  ssr: true,  fxaa: true,  msaa: 0, crowdMax: 1800, drawDist: 200, anisotropy: 8,  specLights: 8, envSize: 128, shadowMap: 2048, drsMin: 0.6, vignette: 0.35, grain: 0.02, ca: 0.006, maxPR: 1.25 },
  ultra:  { pixelRatio: 1.5,  shadows: true,  post: true,  bloom: true,  ssao: true,  ssr: true,  fxaa: false, msaa: 4, crowdMax: 2600, drawDist: 260, anisotropy: 16, specLights: 8, envSize: 256, shadowMap: 4096, drsMin: 0.7, vignette: 0.35, grain: 0.02, ca: 0.006, maxPR: 2 },
};
export const QUALITY_ORDER = ['low', 'medium', 'high', 'ultra'];

export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    let qName = params.quality;
    this.qualityForced = !!(qName && QUALITY[qName]);
    if (!this.qualityForced) qName = matchMedia('(pointer: coarse)').matches ? 'low' : 'high';
    this.qualityName = QUALITY[qName] ? qName : 'high';
    this.quality = { ...QUALITY[this.qualityName] };
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: params.test });
    const r = this.renderer;
    this.basePR = Math.min(devicePixelRatio * this.quality.pixelRatio, this.quality.maxPR || 2);
    this.drs = 1; // dynamic resolution scale (post pipeline internal size, or pixel ratio without post)
    r.setPixelRatio(this.basePR);
    r.setSize(innerWidth, innerHeight, false);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.AgXToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = this.quality.shadows;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.info.autoReset = true;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0b0d);
    this.camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 900);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera); // so camera-attached objects (phone, hands) render
    this.globalRoot = new THREE.Group(); this.globalRoot.name = 'global';
    this.scene.add(this.globalRoot);
    this.levels = {};
    for (const lv of LEVEL_ORDER) {
      const g = new THREE.Group(); g.name = 'level:' + lv; g.userData.level = lv;
      this.levels[lv] = g; this.scene.add(g);
    }
    // Optional render override (post-processing pipeline installs itself here)
    this.renderFn = null;
    this.onResize = [];
    this.onQuality = [];
    addEventListener('resize', () => this.resize());
    this.stats = { frame: 0, fps: 60, ms: 16, calls: 0, tris: 0, gpuMs: 0 };
    this._sceneInfo = null;
  }
  levelRoot(level) { return this.levels[level]; }
  resize() {
    const w = innerWidth, h = innerHeight;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    for (const f of this.onResize) f(w, h);
  }
  setPixelRatio(pr) { this.renderer.setPixelRatio(pr); this.resize(); }
  // dynamic resolution: post pipeline scales its internal targets, otherwise the canvas
  setDRS(s) {
    s = Math.max(this.quality.drsMin || 0.5, Math.min(1, s));
    if (Math.abs(s - this.drs) < 0.01) return;
    this.drs = s;
    const post = this.ctx && this.ctx.post;
    if (post && post.enabled) post.setScale(s);
    else this.setPixelRatio(this.basePR * s);
  }
  // Switch tier at runtime (settings menu / auto-detect). Shadows & post passes
  // are re-created; crowd density etc. read engine.quality when they can.
  setQuality(name) {
    if (!QUALITY[name] || name === this.qualityName) return;
    this.qualityName = name;
    Object.assign(this.quality, QUALITY[name]);
    this.basePR = Math.min(devicePixelRatio * this.quality.pixelRatio, this.quality.maxPR || 2);
    this.drs = 1;
    this.renderer.setPixelRatio(this.basePR);
    this.resize();
    for (const f of this.onQuality) try { f(name); } catch (e) { console.error(e); }
    if (this.ctx && this.ctx.events) this.ctx.events.emit('render:quality', { name });
  }
  // the post pipeline reports the main scene pass (quad passes would hide it)
  sceneStats(info) { this._sceneInfo = { calls: info.calls, tris: info.triangles }; }
  render(dt) {
    this._sceneInfo = null;
    if (this.renderFn) this.renderFn(dt);
    else this.renderer.render(this.scene, this.camera);
    const info = this._sceneInfo || { calls: this.renderer.info.render.calls, tris: this.renderer.info.render.triangles };
    this.stats.calls = info.calls; this.stats.tris = info.tris;
  }
  // one-line summary for the test harness / debug overlay
  renderStats() {
    const c = this.ctx || {};
    const p = c.post, l = c.lighting, i = this.renderer.info;
    return `q=${this.qualityName} drs=${this.drs.toFixed(2)} ` +
      (p ? `ev=${p.ev.toFixed(2)} ` : '') + (l ? `mood=${l.mood} lights=${l.stats.lights} bake=${l.stats.bakeMs}ms ` : '') +
      `progs=${i.programs ? i.programs.length : '?'} tex=${i.memory.textures} geo=${i.memory.geometries}`;
  }
}
