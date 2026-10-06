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
  medium: { pixelRatio: 1.0,  shadows: true,  post: true,  bloom: true,  ssao: false, ssr: false, fxaa: true,  msaa: 0, crowdMax: 1000, drawDist: 130, anisotropy: 4,  specLights: 4, envSize: 128, shadowMap: 1024, drsMin: 0.6, vignette: 0.32, grain: 0.006, ca: 0, maxPR: 1.5 },
  // high = medium + half-res SSAO/SSR + TAA/CAS. Tuned to hold 60 fps on a mid laptop GPU with dynamic resolution (0.7..1.0).
  high:   { pixelRatio: 1.0,  shadows: true,  post: true,  bloom: true,  ssao: true,  ssr: true,  taa: true, fxaa: false,  msaa: 0, crowdMax: 1500, drawDist: 160, anisotropy: 8,  specLights: 6, envSize: 128, shadowMap: 1536, drsMin: 0.7, vignette: 0.33, grain: 0.006, ca: 0, maxPR: 1.25 },
  ultra:  { pixelRatio: 1.5,  shadows: true,  post: true,  bloom: true,  ssao: true,  ssr: true,  taa: true, fxaa: false, msaa: 4, crowdMax: 2600, drawDist: 260, anisotropy: 16, specLights: 8, envSize: 256, shadowMap: 4096, drsMin: 0.8, vignette: 0.35, grain: 0.006, ca: 0, maxPR: 2 },
};
export const QUALITY_ORDER = ['low', 'medium', 'high', 'ultra'];

// Pick a starting tier from cheap device hints; the benchmark in
// render/visibility steps further down if needed. Conservative on purpose: an
// unknown or integrated GPU gets `medium` (shadows + bloom + FXAA, no SSR/SSAO),
// and only a clearly strong GPU gets `high`.
export function detectTier() {
  if (matchMedia('(pointer: coarse)').matches) return 'low';
  let gpu = '';
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    gpu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    gl && gl.getExtension('WEBGL_lose_context') && gl.getExtension('WEBGL_lose_context').loseContext();
  } catch (e) { /* fall through */ }
  const cores = navigator.hardwareConcurrency || 4, mem = navigator.deviceMemory || 8;
  if (/swiftshader|llvmpipe|softpipe|software|basic render|mali|adreno|powervr|videocore|mesa.*(llvm|soft)/i.test(gpu)) return 'low';
  if (cores <= 2 || mem <= 2) return 'low';
  const strong =
    /nvidia.*\b(rtx|gtx ?(20|30|40|50)\d\d|quadro (rtx|t\d)|titan)/i.test(gpu) ||
    /(radeon|amd).*\b(rx ?(5[5-9]|6|7|9)\d{2,3}|pro w[5-9]|vega 6[4-9]|rdna)/i.test(gpu) ||
    /apple.*\bm\d\b/i.test(gpu) && cores >= 8 ||
    /intel.*\barc\b/i.test(gpu);
  if (strong && cores >= 6) return 'high';
  return 'medium';
}

export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    let qName = params.quality;
    this.qualityForced = !!(qName && QUALITY[qName]);
    if (!this.qualityForced) qName = detectTier();
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
    this._initGpuTimer();
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
  // GPU frame time via EXT_disjoint_timer_query_webgl2 (two queries in flight)
  _initGpuTimer() {
    this.gpuTimerOK = false; this._tq = [];
    if (params.has('nogputimer')) return;
    try {
      const gl = this.renderer.getContext();
      this._tExt = gl.getExtension('EXT_disjoint_timer_query_webgl2');
      this._gl = gl; this.gpuTimerOK = !!this._tExt;
    } catch (e) { /* no timer */ }
  }
  _gpuBegin() {
    if (!this.gpuTimerOK || this._tq.length >= 3) return false;
    const gl = this._gl; const q = gl.createQuery();
    gl.beginQuery(this._tExt.TIME_ELAPSED_EXT, q); this._tq.push(q);
    return true;
  }
  _gpuEnd() { this._gl.endQuery(this._tExt.TIME_ELAPSED_EXT); }
  _gpuPoll() {
    const gl = this._gl, q = this._tq[0];
    if (!q) return;
    if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) return;
    const bad = gl.getParameter(this._tExt.GPU_DISJOINT_EXT);
    if (!bad) { const ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6; this.stats.gpuMs += (ms - this.stats.gpuMs) * (this.stats.gpuMs ? 0.15 : 1); }
    gl.deleteQuery(q); this._tq.shift();
  }
  render(dt) {
    this._sceneInfo = null;
    const timing = this.gpuTimerOK && this._gpuBegin();
    if (this.renderFn) this.renderFn(dt);
    else this.renderer.render(this.scene, this.camera);
    if (timing) this._gpuEnd();
    if (this.gpuTimerOK) this._gpuPoll();
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
