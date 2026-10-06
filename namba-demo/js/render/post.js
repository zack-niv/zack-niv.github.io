// =============================================================================
// Post-processing: hand-rolled HDR pipeline (no EffectComposer — fewer
// passes, shared targets, everything gated by quality tier).
//
//   scene ─► HDR target (RGBA16F, depth texture, alpha = 1 - floor reflectivity)
//        ├─► mip pyramid ½…1/64 (13-tap, Karis on the first) ─► tent upsample = bloom
//        ├─► SSAO ½ res (depth-only SAO, 10 taps) ─► depth-aware blur      [high+]
//        ├─► SSR ½ res for glossy floors (28 steps + 5 refine), glossy blur
//        │     comes from the pyramid                                     [high+]
//        └─► composite: AO · SSR · bloom · exposure · grade · tonemap (AgX
//              punchy / PBR Neutral / ACES) · vignette · CA · grain ─► LDR
//   LDR ─► FXAA ─► canvas                                                  [medium+]
//
// Eye adaptation: exposure is metered from the baked light field along the
// view (ctx.lighting.meter(), no GPU readback, works on every tier) and
// adapts in EV space — fast when it gets brighter (≈0.7 s, the glare when you
// step out into Namba Parks), slow when it gets darker (≈2.5 s).
// Per-mood colour grading cross-fades as you move between districts.
// ?nopost or quality.post=false → renderer tone mapping only (exposure still adapts).
// =============================================================================
import * as THREE from 'three';
import { params } from '../core/params.js';
import { VERT, DOWN, UP, SSAO, AOBLUR, SSR, SSRBLUR, TEMPORAL, TAA, SHARPEN, COMPOSITE, FXAA } from './shaders/post.glsl.js';

// subtle per-district looks: gain = white balance, lift = shadow tint
const GRADES = {
  metro:      { gain: [0.965, 1.0, 1.015], lift: [-0.2, 0.25, 0.3], gamma: [1.0, 1.0, 1.0], sat: 0.93, contrast: 1.04, bloom: 0.05 },
  passage:    { gain: [0.975, 1.0, 1.01], lift: [-0.1, 0.15, 0.2], gamma: [1.0, 1.0, 1.0], sat: 0.95, contrast: 1.03, bloom: 0.045 },
  arcade:     { gain: [1.02, 1.0, 0.975], lift: [0.1, 0.0, -0.05], gamma: [1.0, 1.0, 1.0], sat: 1.05, contrast: 1.06, bloom: 0.065 },
  department: { gain: [1.03, 1.0, 0.96], lift: [0.15, 0.05, -0.1], gamma: [1.0, 1.0, 1.0], sat: 1.04, contrast: 1.04, bloom: 0.06 },
  mall:       { gain: [1.045, 1.0, 0.94], lift: [0.25, 0.08, -0.12], gamma: [1.0, 1.0, 1.0], sat: 1.06, contrast: 1.05, bloom: 0.07 },
  terminal:   { gain: [0.99, 1.0, 1.02], lift: [0.0, 0.05, 0.1], gamma: [1.0, 1.0, 1.0], sat: 0.98, contrast: 1.04, bloom: 0.05 },
  dining:     { gain: [1.06, 1.0, 0.9], lift: [0.3, 0.1, -0.1], gamma: [1.0, 1.0, 1.0], sat: 1.08, contrast: 1.08, bloom: 0.08 },
  street:     { gain: [1.01, 1.0, 0.99], lift: [0.0, 0.0, 0.05], gamma: [1.0, 1.0, 1.0], sat: 1.04, contrast: 1.03, bloom: 0.04 },
  parks:      { gain: [1.02, 1.0, 0.97], lift: [0.0, 0.05, 0.0], gamma: [1.0, 1.0, 1.0], sat: 1.08, contrast: 1.04, bloom: 0.045 },
  garden:     { gain: [1.02, 1.0, 0.97], lift: [0.0, 0.05, 0.0], gamma: [1.0, 1.0, 1.0], sat: 1.1, contrast: 1.04, bloom: 0.045 },
};
const TONEMAP = { agx: 0, neutral: 1, aces: 2 };

export class Post {
  constructor(ctx) {
    this.ctx = ctx;
    this.exposure = 1; this.ev = 0; this.evTarget = 0; this.flashAmt = 0;
    this.grade = JSON.parse(JSON.stringify(GRADES.metro));
    this.frame = 0;
    this.scale = 1;
    this.taaOn = !params.has('notaa');
  }

  init() {
    const t0 = performance.now();
    const { engine } = this.ctx;
    const q = engine.quality;
    this.enabled = !params.nopost && q.post;
    const r = engine.renderer;
    if (!this.enabled) {
      r.toneMapping = THREE.AgXToneMapping;
      engine.renderFn = null;
      return;
    }
    r.toneMapping = THREE.NoToneMapping; // composite tonemaps
    this.q = q;
    this._build();
    engine.renderFn = (dt) => this.render(dt);
    engine.onResize.push(() => this._resize());
    if (this.ctx.events && this.ctx.events.on) this.ctx.events.on('player:teleport', () => { this.cutNext = true; });
    // shader warm-up is staged by js/main.js → render/precompile.js (parallel compile under the loading screen)
    console.log(`[render] post init ${(performance.now() - t0).toFixed(0)} ms`);
  }

  // Kick off compilation of every post program (parallel, non-blocking). Each material is
  // prepared against the kind of target it will really draw into (the program key depends on it).
  precompile() {
    if (!this.enabled || !this.quad) return [];
    const r = this.ctx.engine.renderer, prev = r.getRenderTarget(), quad = this.quad, q = this.q;
    const H = this.down[0], screen = null;
    const list = [[this.mDown, H], [this.mUp, this.up[0]], [this.mComp, (q.taa || q.fxaa) ? this.ldrRT : screen]];
    if (q.ssao) list.push([this.mAO, this.aoRT], [this.mAOBlur, this.aoRT2], [this.mTAO, this.aoH[0]]);
    if (q.ssr) list.push([this.mSSR, this.ssrRT], [this.mSSRBlur, this.ssrRT2], [this.mTSSR, this.ssrH[0]]);
    if (q.taa) list.push([this.mTAA, this.taaH[0]], [this.mSharp, screen]); else if (q.fxaa) list.push([this.mFXAA, screen]);
    const out = [], keep = quad.material;
    try {
      for (const [m, t] of list) {
        quad.material = m; r.setRenderTarget(t);
        out.push(r.compileAsync(this.qscene, this.qcam).catch(() => {}));
      }
    } catch (e) { console.warn('[render] post precompile failed', e); }
    quad.material = keep; r.setRenderTarget(prev);
    return out;
  }

  _mat(frag, uniforms, defines) {
    return new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, defines: defines || {}, depthTest: false, depthWrite: false, toneMapped: false });
  }

  _build() {
    const q = this.q;
    const half = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, colorSpace: THREE.LinearSRGBColorSpace };
    this.depthTex = new THREE.DepthTexture(4, 4);
    this.depthTex.type = THREE.UnsignedIntType;
    this.sceneRT = new THREE.WebGLRenderTarget(4, 4, { ...half, depthBuffer: true, depthTexture: this.depthTex, samples: q.msaa || 0 });
    this.down = []; this.up = [];
    for (let i = 0; i < 6; i++) this.down.push(new THREE.WebGLRenderTarget(4, 4, half));
    for (let i = 0; i < 5; i++) this.up.push(new THREE.WebGLRenderTarget(4, 4, half));
    if (q.ssao) { this.aoRT = new THREE.WebGLRenderTarget(4, 4, half); this.aoRT2 = new THREE.WebGLRenderTarget(4, 4, half); this.aoH = [0, 1].map(() => new THREE.WebGLRenderTarget(4, 4, half)); }
    if (q.ssr) { this.ssrRT = new THREE.WebGLRenderTarget(4, 4, half); this.ssrRT2 = new THREE.WebGLRenderTarget(4, 4, half); this.ssrH = [0, 1].map(() => new THREE.WebGLRenderTarget(4, 4, half)); }
    if (q.taa) {
      this.taaH = [0, 1].map(() => new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, colorSpace: THREE.LinearSRGBColorSpace }));
      this.taaI = 0; this.jit = 0;
    }
    this.histOK = false; this.hi = 0;
    this.camWorld = new THREE.Matrix4(); this.prevVP = new THREE.Matrix4(); this.curVP = new THREE.Matrix4();
    if (q.fxaa || q.taa) this.ldrRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
    const proj = { value: new THREE.Vector4() };
    this.uProj = proj;
    this.mDown = this._mat(DOWN, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uKaris: { value: 0 } });
    this.mUp = this._mat(UP, { tSrc: { value: null }, tBase: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1 }, uMix: { value: 0.6 } });
    this.mAO = this._mat(SSAO, { tDepth: { value: this.depthTex }, uProj: proj, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 0.7 }, uIntensity: { value: 1.1 }, uFrame: { value: 0 } });
    this.mAOBlur = this._mat(AOBLUR, { tAO: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.mSSR = this._mat(SSR, { tDepth: { value: this.depthTex }, tScene: { value: this.sceneRT.texture }, tMip0: { value: null }, tMip1: { value: null }, tMip2: { value: null }, uProj: proj, uUpView: { value: new THREE.Vector3() }, uTexel: { value: new THREE.Vector2() }, uFrame: { value: 0 }, uMaxDist: { value: 45 }, uExposure: { value: 1 } });
    this.mSSRBlur = this._mat(SSRBLUR, { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } });
    const tu = () => ({ tCur: { value: null }, tHist: { value: null }, tDepth: { value: this.depthTex }, uProj: proj, uTexel: { value: new THREE.Vector2() }, uCamWorld: { value: this.camWorld }, uPrevVP: { value: this.prevVP }, uBlend: { value: 0.9 }, uKeepG: { value: 0 } });
    this.mTAO = this._mat(TEMPORAL, tu()); this.mTAO.uniforms.uKeepG.value = 1;
    this.mTSSR = this._mat(TEMPORAL, tu());
    if (q.taa) {
      const u = tu(); delete u.uKeepG; u.uBlend.value = 0.9;
      this.mTAA = this._mat(TAA, u);
      this.mSharp = this._mat(SHARPEN, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uSharp: { value: 0.5 } });
    }
    const defs = {};
    if (q.ssao) defs.USE_AO = 1;
    if (q.ssr) defs.USE_SSR = 1;
    if (q.bloom) defs.USE_BLOOM = 1;
    this.mComp = this._mat(COMPOSITE, {
      tScene: { value: this.sceneRT.texture }, tBloom: { value: null }, tAO: { value: null }, tSSR: { value: null },
      uExposure: { value: 1 }, uBloom: { value: 0.05 }, uAO: { value: 0.65 }, uSSR: { value: 1.0 },
      uLift: { value: new THREE.Vector3() }, uGamma: { value: new THREE.Vector3(1, 1, 1) }, uGain: { value: new THREE.Vector3(1, 1, 1) },
      uSat: { value: 1 }, uContrast: { value: 1 }, uVignette: { value: q.vignette != null ? q.vignette : 0.35 }, uGrain: { value: q.grain != null ? q.grain : 0.022 },
      uCA: { value: q.ca != null ? q.ca : 0.003 }, uTime: { value: 0 }, uFlash: { value: 0 }, uHalo: { value: 0.16 }, uHaloT: { value: 1.1 }, uVib: { value: 0.35 }, uClarity: { value: q.bloom ? 0.22 : 0 },
      uTonemap: { value: TONEMAP[params.get('tonemap')] != null ? TONEMAP[params.get('tonemap')] : 0 },
    }, defs);
    this.mFXAA = this._mat(FXAA, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mComp);
    this.quad.frustumCulled = false;
    this.qscene = new THREE.Scene(); this.qscene.add(this.quad);
    this.qcam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._resize();
  }

  _resize() {
    if (!this.sceneRT) return;
    const r = this.ctx.engine.renderer;
    const v = r.getDrawingBufferSize(new THREE.Vector2());
    this.fullW = v.x; this.fullH = v.y;
    const w = Math.max(16, Math.round(v.x * this.scale)), h = Math.max(16, Math.round(v.y * this.scale));
    this.w = w; this.h = h;
    this.sceneRT.setSize(w, h);
    let mw = w, mh = h;
    for (let i = 0; i < 6; i++) { mw = Math.max(1, mw >> 1); mh = Math.max(1, mh >> 1); this.down[i].setSize(mw, mh); if (i < 5) this.up[i].setSize(mw, mh); }
    const hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1);
    if (this.aoRT) { this.aoRT.setSize(hw, hh); this.aoRT2.setSize(hw, hh); this.aoH.forEach(t => t.setSize(hw, hh)); }
    if (this.ssrRT) { this.ssrRT.setSize(hw, hh); this.ssrRT2.setSize(hw, hh); this.ssrH.forEach(t => t.setSize(hw, hh)); }
    this.histOK = false;
    if (this.ldrRT) this.ldrRT.setSize(v.x, v.y);
    if (this.taaH) this.taaH.forEach(t => t.setSize(v.x, v.y));
  }

  setScale(s) {
    s = Math.max(0.5, Math.min(1, s));
    if (Math.abs(s - this.scale) < 0.01) return;
    this.scale = s; this._resize();
  }

  flash(a = 1) { this.flashAmt = Math.max(this.flashAmt, a); }

  // ---------------------------------------------------------------------------
  update(dt) {
    const { lighting, engine } = this.ctx;
    // ---- eye adaptation ----
    const lum = lighting && lighting.meter ? lighting.meter() : null;
    if (lum != null) {
      const L = Math.max(1e-3, lum);
      // brighter places stay a little brighter after adaptation (key compensation)
      const comp = Math.max(-0.6, Math.min(1.1, 0.42 * Math.log2(L / 0.5)));
      this.evTarget = Math.log2(0.16 / L) + comp + (engine.quality.evBias || 0);
      this.evTarget = Math.max(-6, Math.min(4, this.evTarget));
      if (!this._evInit) { this.ev = this.evTarget; this._evInit = true; }
      const brighter = this.evTarget < this.ev; // scene got brighter → exposure goes down
      const tau = brighter ? 0.75 : 2.4;
      this.ev += (this.evTarget - this.ev) * (1 - Math.exp(-dt / tau));
    }
    this.exposure = Math.pow(2, this.ev);
    if (!this.enabled) { engine.renderer.toneMappingExposure = this.exposure; return; }
    // ---- grading cross-fade ----
    const G = GRADES[lighting && lighting.mood] || GRADES.metro;
    const k = 1 - Math.exp(-dt / 0.8);
    const g = this.grade;
    for (const key of ['gain', 'lift', 'gamma']) for (let i = 0; i < 3; i++) g[key][i] += (G[key][i] - g[key][i]) * k;
    for (const key of ['sat', 'contrast', 'bloom']) g[key] += (G[key] - g[key]) * k;
    this.flashAmt *= Math.exp(-dt * 2.5);
  }

  render(dt) {
    const { engine } = this.ctx;
    const r = engine.renderer, scene = engine.scene, cam = engine.camera;
    const q = this.q;
    this.frame++;
    // ---- scene ----
    if (q.taa) {
      // sub-pixel jitter (Halton 2,3), 8 samples
      const k = this.jit = (this.jit + 1) % 8 + 1;
      const hal = (i, b) => { let f = 1, r2 = 0; while (i > 0) { f /= b; r2 += f * (i % b); i = Math.floor(i / b); } return r2; };
      cam.setViewOffset(this.w, this.h, (hal(k, 2) - 0.5) * (this.taaOn ? 1 : 0), (hal(k, 3) - 0.5) * (this.taaOn ? 1 : 0), this.w, this.h);
    }
    r.setRenderTarget(this.sceneRT);
    r.render(scene, cam);
    if (q.taa) cam.clearViewOffset();
    engine.sceneStats(r.info.render);
    const quad = this.quad;
    const pass = (mat, target) => { quad.material = mat; r.setRenderTarget(target); r.render(this.qscene, this.qcam); };
    // ---- pyramid / bloom ----
    let src = this.sceneRT.texture, sw = this.w, sh = this.h;
    const levels = q.bloom ? 6 : (q.ssr ? 3 : 0);
    for (let i = 0; i < levels; i++) {
      this.mDown.uniforms.tSrc.value = src;
      this.mDown.uniforms.uTexel.value.set(1 / sw, 1 / sh);
      this.mDown.uniforms.uKaris.value = i === 0 ? 1 : 0;
      pass(this.mDown, this.down[i]);
      src = this.down[i].texture; sw = this.down[i].width; sh = this.down[i].height;
    }
    if (q.bloom) {
      let coarse = this.down[5];
      for (let i = 4; i >= 0; i--) {
        this.mUp.uniforms.tSrc.value = coarse.texture;
        this.mUp.uniforms.tBase.value = this.down[i].texture;
        this.mUp.uniforms.uTexel.value.set(1 / coarse.width, 1 / coarse.height);
        this.mUp.uniforms.uMix.value = i === 0 ? 0.7 : 0.62;
        pass(this.mUp, this.up[i]);
        coarse = this.up[i];
      }
    }
    // ---- camera-derived uniforms ----
    const P = cam.projectionMatrix.elements;
    this.uProj.value.set(P[0], P[5], cam.near, cam.far);
    cam.updateMatrixWorld();
    this.camWorld.copy(cam.matrixWorld);
    this.curVP.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    // ---- SSAO ----
    if (q.ssao) {
      this.mAO.uniforms.uTexel.value.set(1 / this.w, 1 / this.h);
      this.mAO.uniforms.uFrame.value = this.frame % 64;
      pass(this.mAO, this.aoRT);
      this._temporal(this.mTAO, this.aoRT, this.aoH, 0.88);
      this.mAOBlur.uniforms.tAO.value = this.aoH[this.hi].texture;
      this.mAOBlur.uniforms.uTexel.value.set(1 / this.aoRT.width, 1 / this.aoRT.height);
      pass(this.mAOBlur, this.aoRT2);
    }
    // ---- SSR ----
    if (q.ssr) {
      const up = this.mSSR.uniforms.uUpView.value.set(0, 1, 0).transformDirection(cam.matrixWorldInverse);
      this.mSSR.uniforms.uTexel.value.set(1 / this.w, 1 / this.h);
      this.mSSR.uniforms.uFrame.value = this.frame % 64;
      this.mSSR.uniforms.tMip0.value = this.down[0].texture; this.mSSR.uniforms.tMip1.value = this.down[1].texture; this.mSSR.uniforms.tMip2.value = this.down[2].texture;
      this.mSSR.uniforms.uExposure.value = this.exposure;
      pass(this.mSSR, this.ssrRT);
      this._temporal(this.mTSSR, this.ssrRT, this.ssrH, 0.9);
      const bu = this.mSSRBlur.uniforms;
      bu.tSrc.value = this.ssrH[this.hi].texture; bu.uDir.value.set(1 / this.ssrRT.width, 0); pass(this.mSSRBlur, this.ssrRT2);
      bu.tSrc.value = this.ssrRT2.texture; bu.uDir.value.set(0, 1 / this.ssrRT.height); pass(this.mSSRBlur, this.ssrRT);
    }
    // ---- composite ----
    const u = this.mComp.uniforms, g = this.grade;
    u.tBloom.value = q.bloom ? this.up[0].texture : null;
    u.tAO.value = q.ssao ? this.aoRT2.texture : null;
    u.tSSR.value = q.ssr ? this.ssrRT.texture : null;
    u.uExposure.value = this.exposure;
    u.uBloom.value = g.bloom * (q.bloomScale || 1);
    u.uGain.value.set(g.gain[0], g.gain[1], g.gain[2]);
    u.uLift.value.set(g.lift[0], g.lift[1], g.lift[2]);
    u.uGamma.value.set(g.gamma[0], g.gamma[1], g.gamma[2]);
    u.uSat.value = g.sat; u.uContrast.value = g.contrast;
    u.uTime.value = (u.uTime.value + dt) % 1000;
    u.uFlash.value = this.flashAmt * 0.6;
    if (q.taa) {
      pass(this.mComp, this.ldrRT);
      const tu = this.mTAA.uniforms, prev = this.taaI, next = 1 - prev;
      tu.tCur.value = this.ldrRT.texture; tu.tHist.value = this.taaH[prev].texture;
      tu.uTexel.value.set(1 / this.fullW, 1 / this.fullH);
      tu.uBlend.value = this.histOK && !this.cutNext && this.taaOn ? 0.9 : 0;
      pass(this.mTAA, this.taaH[next]);
      this.taaI = next;
      this.mSharp.uniforms.tSrc.value = this.taaH[next].texture;
      this.mSharp.uniforms.uTexel.value.set(1 / this.fullW, 1 / this.fullH);
      this.mSharp.uniforms.uSharp.value = this.scale < 0.99 ? 0.9 : 0.45;
      pass(this.mSharp, null);
    } else if (q.fxaa) {
      pass(this.mComp, this.ldrRT);
      this.mFXAA.uniforms.tSrc.value = this.ldrRT.texture;
      this.mFXAA.uniforms.uTexel.value.set(1 / this.ldrRT.width, 1 / this.ldrRT.height);
      pass(this.mFXAA, null);
    } else pass(this.mComp, null);
    this.prevVP.copy(this.curVP);
    this.histOK = true; this.cutNext = false;
  }

  // reproject + accumulate `cur` into the ping-pong history `H`; the result is H[this.hi]
  _temporal(mat, cur, H, blend) {
    const r = this.ctx.engine.renderer;
    const u = mat.uniforms;
    const w = H[0].width, h = H[0].height;
    u.tCur.value = cur.texture;
    // each buffer owns its own ping-pong state
    const key = mat === this.mTAO ? 'iAO' : 'iSSR';
    const prev = this[key] || 0, next = 1 - prev;
    u.tHist.value = H[prev].texture;
    u.uTexel.value.set(1 / w, 1 / h);
    u.uBlend.value = this.histOK && !this.cutNext ? blend : 0;
    this.quad.material = mat; r.setRenderTarget(H[next]); r.render(this.qscene, this.qcam);
    this[key] = next;
    this.hi = next; // caller reads H[this.hi] right away
  }

  // GPU cost model at a given output resolution (for the perf notes / debug)
  costModel() {
    const q = this.q || {}; const W = this.w || 1920, H = this.h || 1080;
    const px = W * H, half = px / 4;
    // texture taps per pixel × pixels (MTaps)
    let taps = 0;
    taps += (px / 4) * 13 * 1.33;                 // pyramid (13 taps, geometric series)
    if (q.bloom) taps += (px / 4) * 9 * 1.33;      // upsample chain
    if (q.ssao) taps += half * (10 + 5) + half * 16; // ao + normals, blur
    if (q.ssr) taps += half * (1 + 30 + 5 + 4) * 0.5 + half * 10;  // ~half the pixels are floor; + blur
    taps += px * (q.ssr ? 9 : 4);                  // composite
    if (q.fxaa) taps += px * 9;
    return (taps / 1e6).toFixed(1) + ' Mtaps';
  }
}
