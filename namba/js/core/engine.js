// Renderer, scene graph roots, camera, quality tiers.
//
// Scene organisation (builders MUST follow this so visibility culling works):
//   engine.levelRoot(level)  -> THREE.Group for everything that lives on a
//                               level (architecture, props, shops, signage)
//   engine.globalRoot        -> things visible from everywhere (sky, distant
//                               city, Parks terraces exteriors)
// Visibility of level roots is managed by render/visibility (render system).
import * as THREE from 'three';
import { LEVEL_ORDER } from '../world/layout.js';
import { params } from './params.js';

export const QUALITY = {
  low:    { pixelRatio: 0.75, shadows: false, post: false, bloom: false, ssao: false, crowdMax: 500,  drawDist: 90,  anisotropy: 1 },
  medium: { pixelRatio: 1.0,  shadows: true,  post: true,  bloom: true,  ssao: false, crowdMax: 1100, drawDist: 140, anisotropy: 4 },
  high:   { pixelRatio: 1.0,  shadows: true,  post: true,  bloom: true,  ssao: true,  crowdMax: 1800, drawDist: 200, anisotropy: 8 },
  ultra:  { pixelRatio: 1.5,  shadows: true,  post: true,  bloom: true,  ssao: true,  crowdMax: 2600, drawDist: 260, anisotropy: 16 },
};

export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    const qName = params.quality || (matchMedia('(pointer: coarse)').matches ? 'low' : 'high');
    this.qualityName = QUALITY[qName] ? qName : 'high';
    this.quality = { ...QUALITY[this.qualityName] };
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: params.test });
    const r = this.renderer;
    r.setPixelRatio(Math.min(devicePixelRatio, 2) * this.quality.pixelRatio);
    r.setSize(innerWidth, innerHeight, false);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.AgXToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = this.quality.shadows;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
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
    addEventListener('resize', () => this.resize());
    this.stats = { frame: 0, fps: 60, ms: 16, calls: 0, tris: 0 };
  }
  levelRoot(level) { return this.levels[level]; }
  resize() {
    const w = innerWidth, h = innerHeight;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    for (const f of this.onResize) f(w, h);
  }
  setPixelRatio(pr) { this.renderer.setPixelRatio(pr); this.resize(); }
  render(dt) {
    if (this.renderFn) this.renderFn(dt);
    else this.renderer.render(this.scene, this.camera);
    const info = this.renderer.info.render;
    this.stats.calls = info.calls; this.stats.tris = info.triangles;
  }
}
