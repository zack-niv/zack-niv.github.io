// =============================================================================
// Lodestone hero view — the building as an exploded stack of floors.
//
//   * extruded translucent plates built ONCE (lazily, on first show) from the
//     world grid (same data as the 2D map): greedy-meshed tops tinted by zone,
//     slab sides, wall / partition outlines from world.edges
//   * the current floor lights up (and a sweep radiates from you), floors on the
//     route are brighter than the rest
//   * the route is a screen-space ribbon that climbs through the stack at the
//     real escalators; flowing chevrons show direction
//   * blue dot + pulse + ±1 m halo + heading wedge, destination pin + beacon
//   * auto-framing (fits route + you), drag to orbit, wheel / pinch to zoom
//
// Its own small WebGLRenderer in a canvas inside the phone. Renders only while
// the phone is open on the Lodestone screen (the caller gates render()).
// =============================================================================
import * as THREE from 'three';
import { LAYOUT, LEVELS, LEVEL_ORDER } from '../../world/layout.js';
import { CELL } from '../../world/world.js';

const K0 = 8;                      // default vertical explode factor (world y × K)
const SLAB = 2.6;                  // slab thickness (scene metres)
const ZC = {                       // zone tints for plate tops
  nankai: [1.0, 0.62, 0.24], city: [0.30, 0.66, 1.0], parks: [0.28, 0.86, 0.60], parksGarden: [0.22, 0.80, 0.45], nambawalk: [0.95, 0.80, 0.34],
  takashimaya: [0.62, 0.84, 0.36], link: [0.56, 0.64, 0.78], midosuji: [1.0, 0.35, 0.40], sennichimae: [1.0, 0.43, 0.70], plaza: [0.52, 0.58, 0.68], street: [0.52, 0.58, 0.68],
};
const DEF = [0.5, 0.6, 0.8];

const PLATE_VS = `
attribute vec4 aCol; varying vec4 vCol; varying vec3 vW;
void main(){ vCol = aCol; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const PLATE_FS = `
precision highp float;
varying vec4 vCol; varying vec3 vW;
uniform float uGain, uAlpha, uTime, uSweep, uNPts, uFadeMin; uniform vec3 uPlayer; uniform vec2 uPts[16];
void main(){
  vec3 c = vCol.rgb * uGain; float a = vCol.a * uAlpha;
  float d = distance(vW.xz, uPlayer.xz);
  float r = mod(uTime * 20.0, 90.0);
  float wave = exp(-pow((d - r) / 4.5, 2.0)) * (1.0 - r / 90.0) * uSweep;
  float glow = exp(-d * d / 900.0) * uSweep;
  c += vec3(0.25, 0.75, 1.0) * (wave * 0.9 + glow * 0.35);
  a += wave * 0.30 + glow * 0.16;
  float dm = 1e9;
  for (int i = 0; i < 16; i++) { if (float(i) < uNPts) dm = min(dm, distance(vW.xz, uPts[i])); }
  float fade = max(1.0 - smoothstep(90.0, 250.0, dm), uFadeMin);
  gl_FragColor = vec4(c, clamp(a * fade, 0.0, 1.0));
}`;

const LINE_VS = `
attribute vec3 aC; varying vec3 vC; varying vec3 vW;
void main(){ vC = aC; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const LINE_FS = `
precision highp float;
varying vec3 vC; varying vec3 vW; uniform float uOpacity, uNPts, uFadeMin; uniform vec2 uPts[16];
void main(){
  float dm = 1e9;
  for (int i = 0; i < 16; i++) { if (float(i) < uNPts) dm = min(dm, distance(vW.xz, uPts[i])); }
  float fade = max(1.0 - smoothstep(90.0, 250.0, dm), uFadeMin);
  gl_FragColor = vec4(vC, uOpacity * fade);
}`;

const RIB_VS = `
attribute vec3 prevPos; attribute vec3 nextPos; attribute float side; attribute float aU;
uniform vec2 uRes; uniform float uWidth;
varying float vSide; varying float vU; varying float vOk;
void main(){
  mat4 m = projectionMatrix * modelViewMatrix;
  vec4 c = m * vec4(position, 1.0), p = m * vec4(prevPos, 1.0), n = m * vec4(nextPos, 1.0);
  vOk = (c.w > 0.5 && p.w > 0.5 && n.w > 0.5) ? 1.0 : 0.0;
  float cw = max(c.w, 0.5), pw = max(p.w, 0.5), nw = max(n.w, 0.5);
  vec2 sc = c.xy / cw * uRes * 0.5, sp = p.xy / pw * uRes * 0.5, sn = n.xy / nw * uRes * 0.5;
  vec2 d1 = sc - sp, d2 = sn - sc;
  float l1 = length(d1), l2 = length(d2);
  d1 = l1 > 0.001 ? d1 / l1 : (l2 > 0.001 ? d2 / l2 : vec2(1.0, 0.0));
  d2 = l2 > 0.001 ? d2 / l2 : d1;
  vec2 dir = d1 + d2; float dl = length(dir); dir = dl > 0.001 ? dir / dl : d2;
  vec2 nrm = vec2(-dir.y, dir.x);
  float miter = 1.0 / max(dot(nrm, vec2(-d2.y, d2.x)), 0.5);
  vec2 off = nrm * side * uWidth * 0.5 * miter;
  vSide = side; vU = aU;
  gl_Position = vec4((sc + off) / (uRes * 0.5) * cw, c.z, cw);
}`;
const RIB_FS = `
precision highp float;
varying float vSide; varying float vU; varying float vOk;
uniform float uTime, uGlow, uTotal; uniform vec3 uA, uB;
void main(){
  if (vOk < 0.5) discard;
  float e = 1.0 - abs(vSide);
  float flow = fract((vU - uTime * 26.0) / 18.0);
  float pulse = smoothstep(0.0, 0.10, flow) * (1.0 - smoothstep(0.10, 0.55, flow));
  vec3 col = mix(uA, uB, pulse);
  float a;
  if (uGlow > 0.5) { a = pow(e, 2.2) * (0.20 + 0.18 * pulse); col = mix(col, uA, 0.4); }
  else { a = smoothstep(0.0, 0.28, e); col = mix(col, vec3(1.0, 0.97, 0.88), smoothstep(0.55, 1.0, e) * 0.55); }
  gl_FragColor = vec4(col, a);
}`;

function texCanvas(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 2; return t; }

export class Stack3D {
  constructor(ctx, canvas, { low = false } = {}) {
    this.ctx = ctx; this.canvas = canvas; this.low = low;
    this.ready = false;
    this.mode = 'overview';
    this.az = 215 * Math.PI / 180; this.el = 27 * Math.PI / 180; this.zoomMul = 1; this.userDrag = false;
    this.cur = { tx: 0, ty: 0, tz: 0, dist: 900 };
    this.goal = { tx: 0, ty: 0, tz: 0, dist: 900 };
    this.fadeN = { value: 0 }; this.fadePts = { value: Array.from({ length: 16 }, () => new THREE.Vector2()) };
    this.K = K0; this.time = 0; this.intro = 0;
    this.bandTop = 92; this.bandBottom = 210; this.bandRight = 46;          // px reserved for UI chrome (top / bottom)
    this.route = null;
    this.player = { x: 0, y: 0, z: 0, heading: 0, level: '3F' };
    this.dest = null;
    this.levels = {};
    this.focusLevel = null;
    this._levelState = {};
  }

  // ---------------------------------------------------------------- build ---
  init() {
    if (this.ready) return;
    const t0 = performance.now();
    const R = this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: !this.low, alpha: false, powerPreference: 'low-power', preserveDrawingBuffer: !!(this.ctx.params && this.ctx.params.test) });
    R.setClearColor(0x050810, 1);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(36, 1, 4, 5000);
    this.timing = { renderer: performance.now() - t0 };
    this._bg();
    this._plates(); this.timing.plates = performance.now() - t0;
    this._markers(); this.timing.markers = performance.now() - t0;
    this.ready = true;
    this.buildMs = performance.now() - t0;
    this.resize(true);
    this._bindPointer();
  }

  _bg() {
    // soft radial backdrop (screen-space quad) + faint "field" dust
    const geo = new THREE.PlaneGeometry(2, 2);
    const mat = new THREE.ShaderMaterial({
      depthTest: false, depthWrite: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }',
      fragmentShader: `varying vec2 vUv; uniform float uTime;
        void main(){ vec2 p = vUv - vec2(0.5, 0.52);
          float r = length(p * vec2(0.85, 1.0));
          vec3 c = mix(vec3(0.050, 0.085, 0.150), vec3(0.012, 0.018, 0.035), smoothstep(0.0, 0.85, r));
          c += vec3(0.02, 0.05, 0.08) * (1.0 - smoothstep(0.0, 0.5, abs(vUv.y - 0.62))) * 0.6;
          gl_FragColor = vec4(c, 1.0); }`,
      uniforms: { uTime: { value: 0 } },
    });
    const m = new THREE.Mesh(geo, mat); m.renderOrder = -100; m.frustumCulled = false;
    this.scene.add(m);
    this.bgMat = mat;
  }

  _plates() {
    const W = this.ctx.world;
    const spaces = LAYOUT.spaces;
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9, minY = 1e9, maxY = -1e9;
    for (const lv of LEVEL_ORDER) {
      const g = W.grids[lv]; if (!g) continue;
      const w = g.w, h = g.h;
      // per-cell class: 0 = nothing, else 1 + zoneIdx*4 + room*2 + outdoor
      const zoneKeys = Object.keys(ZC);
      const cls = new Uint16Array(w * h);
      const solid = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) {
        const t = g.type[i];
        if (t !== CELL.WALK && t !== CELL.RAMP) continue;
        solid[i] = 1;
        if (t === CELL.RAMP) { cls[i] = 1; continue; }
        const sp = spaces[g.space[i]];
        let zi = sp ? zoneKeys.indexOf(sp.zone) : -1; if (zi < 0) zi = zoneKeys.length;
        cls[i] = 2 + zi * 4 + (sp && sp.kind === 'room' ? 2 : 0) + (sp && sp.outdoor ? 1 : 0);
      }
      const pos = [], col = [], idx = [];
      const y0 = 0;                                              // group sits at the floor height
      const quad = (x0, z0, x1, z1, y, c, nrmUp) => {
        const b = pos.length / 3;
        pos.push(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1);
        for (let k = 0; k < 4; k++) col.push(c[0], c[1], c[2], c[3]);
        idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
      };
      const vquad = (ax, az, bx, bz, c) => {
        const b = pos.length / 3;
        pos.push(ax, y0, az, bx, y0, bz, bx, y0 - SLAB, bz, ax, y0 - SLAB, az);
        for (let k = 0; k < 4; k++) col.push(c[0], c[1], c[2], c[3] * (k < 2 ? 1 : 0.35));
        idx.push(b, b + 1, b + 2, b, b + 2, b + 3, b, b + 2, b + 1, b, b + 3, b + 2);
      };
      // greedy top faces
      const used = new Uint8Array(w * h);
      for (let cz = 0; cz < h; cz++) for (let cx = 0; cx < w; cx++) {
        const i = cz * w + cx; if (!cls[i] || used[i]) continue;
        const c = cls[i]; let ex = 1;
        while (cx + ex < w && cls[i + ex] === c && !used[i + ex]) ex++;
        let ez = 1, ok = true;
        while (cz + ez < h && ok) { for (let k = 0; k < ex; k++) { const j = (cz + ez) * w + cx + k; if (cls[j] !== c || used[j]) { ok = false; break; } } if (ok) ez++; }
        for (let a = 0; a < ez; a++) for (let b = 0; b < ex; b++) used[(cz + a) * w + cx + b] = 1;
        let rgb, alpha;
        if (c === 1) { rgb = [0.55, 0.62, 0.78]; alpha = 0.14; }
        else {
          const v = c - 2, zi = (v / 4) | 0, room = (v >> 1) & 1, out = v & 1;
          rgb = (zi < zoneKeys.length ? ZC[zoneKeys[zi]] : DEF).slice();
          if (out) rgb = [0.25, 0.82, 0.50];
          if (room) { rgb = [rgb[0] * 0.55 + 0.12, rgb[1] * 0.50 + 0.10, rgb[2] * 0.62 + 0.10]; alpha = 0.30; } else alpha = 0.17;
        }
        quad(g.x0 + cx, g.z0 + cz, g.x0 + cx + ex, g.z0 + cz + ez, y0, [rgb[0], rgb[1], rgb[2], alpha]);
      }
      // slab sides on the plate boundary (run-merged)
      const sc = [0.60, 0.80, 1.0, 0.26];
      const S = (x, z) => x >= 0 && z >= 0 && x < w && z < h && solid[z * w + x] === 1;
      for (let cz = 0; cz < h; cz++) {        // north (-z) and south (+z) faces
        for (const dz of [-1, 1]) {
          let run = -1;
          for (let cx = 0; cx <= w; cx++) {
            const edge = cx < w && S(cx, cz) && !S(cx, cz + dz);
            if (edge && run < 0) run = cx;
            if (!edge && run >= 0) { const zz = g.z0 + cz + (dz > 0 ? 1 : 0); vquad(g.x0 + run, zz, g.x0 + cx, zz, sc); run = -1; }
          }
        }
      }
      for (let cx = 0; cx < w; cx++) {
        for (const dx of [-1, 1]) {
          let run = -1;
          for (let cz = 0; cz <= h; cz++) {
            const edge = cz < h && S(cx, cz) && !S(cx + dx, cz);
            if (edge && run < 0) run = cz;
            if (!edge && run >= 0) { const xx = g.x0 + cx + (dx > 0 ? 1 : 0); vquad(xx, g.z0 + run, xx, g.z0 + cz, sc); run = -1; }
          }
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('aCol', new THREE.Float32BufferAttribute(col, 4));
      geo.setIndex(idx);
      const mat = new THREE.ShaderMaterial({
        vertexShader: PLATE_VS, fragmentShader: PLATE_FS, transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
        uniforms: { uGain: { value: 1 }, uAlpha: { value: 1 }, uTime: { value: 0 }, uSweep: { value: 0 }, uPlayer: { value: new THREE.Vector3() }, uNPts: this.fadeN, uFadeMin: { value: 1 }, uPts: this.fadePts },
      });
      const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false;
      const li = LEVEL_ORDER.indexOf(lv);
      mesh.renderOrder = 10 + li * 3;
      // outlines
      const lp = [], lc = [];
      for (const e of W.edges[lv]) {
        let c, up = 0.06;
        if (e.kind === 'wall') c = [0.55, 0.85, 1.0, 1.0]; else if (e.kind === 'partition') c = [0.35, 0.55, 0.75, 0.7]; else if (e.kind === 'rail') c = [0.5, 0.7, 0.9, 0.8]; else continue;
        lp.push(e.ax, up, e.az, e.bx, up, e.bz);
        lc.push(c[0] * c[3], c[1] * c[3], c[2] * c[3], c[0] * c[3], c[1] * c[3], c[2] * c[3]);
      }
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
      lg.setAttribute('aC', new THREE.Float32BufferAttribute(lc, 3));
      const lmat = new THREE.ShaderMaterial({
        vertexShader: LINE_VS, fragmentShader: LINE_FS, transparent: true, depthWrite: false, depthTest: false,
        uniforms: { uOpacity: { value: 0.5 }, uNPts: this.fadeN, uFadeMin: { value: 1 }, uPts: this.fadePts },
      });
      const lines = new THREE.LineSegments(lg, lmat); lines.frustumCulled = false; lines.renderOrder = 11 + li * 3;
      const grp = new THREE.Group(); grp.position.y = LEVELS[lv].y * this.K;
      grp.add(mesh, lines);
      this.scene.add(grp);
      const bx0 = g.x0, bx1 = g.x0 + w, bz0 = g.z0, bz1 = g.z0 + h;
      // tight bounds of the solid cells
      let tx0 = 1e9, tx1 = -1e9, tz0 = 1e9, tz1 = -1e9;
      for (let cz = 0; cz < h; cz++) for (let cx = 0; cx < w; cx++) if (solid[cz * w + cx]) { if (cx < tx0) tx0 = cx; if (cx > tx1) tx1 = cx; if (cz < tz0) tz0 = cz; if (cz > tz1) tz1 = cz; }
      const bounds = [g.x0 + tx0, g.z0 + tz0, g.x0 + tx1 + 1, g.z0 + tz1 + 1];
      this.levels[lv] = { group: grp, mat, lmat, y: LEVELS[lv].y * this.K, bounds, gain: 1, alpha: 1, tgain: 1, talpha: 1, tline: 0.5, line: 0.5, sweep: 0 };
      minX = Math.min(minX, bounds[0]); maxX = Math.max(maxX, bounds[2]); minZ = Math.min(minZ, bounds[1]); maxZ = Math.max(maxZ, bounds[3]);
      minY = Math.min(minY, LEVELS[lv].y * this.K); maxY = Math.max(maxY, LEVELS[lv].y * this.K);
      // floor label (sprite, constant screen size)
      const label = lv === 'B1' ? 'B1' : lv === 'B2' ? 'B2' : lv;
      const tex = texCanvas(128, 64, (g2, W2, H2) => {
        g2.fillStyle = 'rgba(8,14,28,0.78)'; g2.strokeStyle = 'rgba(120,200,255,0.6)'; g2.lineWidth = 3;
        const r = 18; g2.beginPath(); g2.moveTo(r, 4); g2.arcTo(W2 - 4, 4, W2 - 4, H2 - 4, r); g2.arcTo(W2 - 4, H2 - 4, 4, H2 - 4, r); g2.arcTo(4, H2 - 4, 4, 4, r); g2.arcTo(4, 4, W2 - 4, 4, r); g2.closePath(); g2.fill(); g2.stroke();
        g2.fillStyle = '#d9ecff'; g2.font = '700 34px Inter, system-ui, sans-serif'; g2.textAlign = 'center'; g2.textBaseline = 'middle'; g2.fillText(label, W2 / 2, H2 / 2 + 2);
      });
      const sm = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false });
      const spr = new THREE.Sprite(sm); spr.renderOrder = 60; spr.userData.px = [52, 26];
      spr.position.set(bounds[0] - 6, 3, (bounds[1] + bounds[3]) / 2);
      grp.add(spr);
      this.levels[lv].label = spr; this.levels[lv].labelMat = sm;
    }
    this.extent = { minX, maxX, minZ, maxZ, minY, maxY };
  }

  _markers() {
    const S = this.scene;
    // player dot ------------------------------------------------------------
    const dotTex = texCanvas(128, 128, (g, w, h) => {
      g.translate(64, 64);
      let gr = g.createRadialGradient(0, 0, 10, 0, 0, 62); gr.addColorStop(0, 'rgba(60,140,255,0.55)'); gr.addColorStop(1, 'rgba(60,140,255,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 62, 0, 7); g.fill();
      g.shadowColor = 'rgba(0,0,0,0.55)'; g.shadowBlur = 8; g.fillStyle = '#fff'; g.beginPath(); g.arc(0, 0, 26, 0, 7); g.fill(); g.shadowBlur = 0;
      g.fillStyle = '#2f7bff'; g.beginPath(); g.arc(0, 0, 19, 0, 7); g.fill();
    });
    const ringTex = texCanvas(128, 128, (g) => { g.translate(64, 64); g.strokeStyle = 'rgba(90,170,255,0.95)'; g.lineWidth = 5; g.beginPath(); g.arc(0, 0, 58, 0, 7); g.stroke(); });
    this.dotMat = new THREE.SpriteMaterial({ map: dotTex, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false });
    this.ringMat = new THREE.SpriteMaterial({ map: ringTex, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false });
    this.dot = new THREE.Sprite(this.dotMat); this.dot.renderOrder = 80;
    this.ring = new THREE.Sprite(this.ringMat); this.ring.renderOrder = 79;
    // flat halo (true ±1 m) and heading wedge on the plate
    const haloTex = texCanvas(128, 128, (g) => { g.translate(64, 64); g.fillStyle = 'rgba(70,150,255,0.30)'; g.beginPath(); g.arc(0, 0, 60, 0, 7); g.fill(); g.strokeStyle = 'rgba(150,205,255,0.95)'; g.lineWidth = 5; g.stroke(); });
    this.halo = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: haloTex, transparent: true, depthTest: false, depthWrite: false }));
    this.halo.rotation.x = -Math.PI / 2; this.halo.renderOrder = 70;
    const wedgeTex = texCanvas(128, 128, (g) => {
      g.translate(64, 64); const gr = g.createRadialGradient(0, 0, 4, 0, 0, 62); gr.addColorStop(0, 'rgba(90,170,255,0.85)'); gr.addColorStop(1, 'rgba(90,170,255,0)');
      g.fillStyle = gr; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, 62, -Math.PI / 2 - 0.62, -Math.PI / 2 + 0.62); g.closePath(); g.fill();
    });
    this.wedge = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: wedgeTex, transparent: true, depthTest: false, depthWrite: false }));
    this.wedge.rotation.order = 'YXZ'; this.wedge.rotation.x = -Math.PI / 2; this.wedge.renderOrder = 71;
    S.add(this.dot, this.ring, this.halo, this.wedge);
    // vertical beam so you can find yourself in the stack
    const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 90, 0], 3)); bg.setAttribute('color', new THREE.Float32BufferAttribute([0.3, 0.6, 1, 0.3, 0.6, 1], 3));
    this.beam = new THREE.Line(bg, new THREE.LineBasicMaterial({ color: 0x4d9bff, transparent: true, opacity: 0.55, depthTest: false, depthWrite: false })); this.beam.renderOrder = 69;
    S.add(this.beam);
    // destination pin -------------------------------------------------------
    const pinTex = texCanvas(128, 160, (g, w, h) => {
      g.translate(64, 0);
      g.shadowColor = 'rgba(255,170,40,0.9)'; g.shadowBlur = 18;
      g.fillStyle = '#ffb02e'; g.beginPath(); g.moveTo(0, 150); g.bezierCurveTo(-8, 112, -50, 92, -50, 54); g.arc(0, 54, 50, Math.PI, 0); g.bezierCurveTo(50, 92, 8, 112, 0, 150); g.fill();
      g.shadowBlur = 0; g.fillStyle = '#1a1206'; g.beginPath(); g.arc(0, 54, 24, 0, 7); g.fill();
      g.fillStyle = '#ffb02e'; g.font = '800 34px Inter, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('🍤', 0, 56);
    });
    this.pinMat = new THREE.SpriteMaterial({ map: pinTex, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false });
    this.pin = new THREE.Sprite(this.pinMat); this.pin.renderOrder = 85; this.pin.center.set(0.5, 0.02);
    this.pin.visible = false;
    const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 70, 0], 3));
    this.destBeam = new THREE.Line(dg, new THREE.LineBasicMaterial({ color: 0xffb02e, transparent: true, opacity: 0.8, depthTest: false, depthWrite: false })); this.destBeam.renderOrder = 84;
    this.destRing = new THREE.Sprite(new THREE.SpriteMaterial({ map: texCanvas(128, 128, (g) => { g.translate(64, 64); g.strokeStyle = 'rgba(255,176,46,0.95)'; g.lineWidth = 5; g.beginPath(); g.arc(0, 0, 58, 0, 7); g.stroke(); }), transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false }));
    this.destRing.renderOrder = 83;
    S.add(this.pin, this.destBeam, this.destRing);
    this.destBeam.visible = this.destRing.visible = false;
    // route ribbon (core + glow share a geometry) ---------------------------
    const mk = (glow, width) => new THREE.ShaderMaterial({
      vertexShader: RIB_VS, fragmentShader: RIB_FS, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
      blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uRes: { value: new THREE.Vector2(300, 600) }, uWidth: { value: width }, uTime: { value: 0 }, uGlow: { value: glow ? 1 : 0 }, uTotal: { value: 1 }, uA: { value: new THREE.Color(1.0, 0.62, 0.12) }, uB: { value: new THREE.Color(1.0, 0.92, 0.55) } },
    });
    this.ribCore = mk(false, 5); this.ribGlow = mk(true, 22);
    this.ribMeshes = [];
    this.markGroup = new THREE.Group(); S.add(this.markGroup);
  }

  // ---------------------------------------------------------------- state ---
  setRoute(r) {
    this.route = r;
    for (const m of this.ribMeshes) { this.scene.remove(m); m.geometry.dispose(); }
    this.ribMeshes = [];
    for (const m of this.markGroup.children.slice()) { this.markGroup.remove(m); m.material.map && m.material.map.dispose(); m.material.dispose(); }
    if (!r || !r.ok) { this.routeLevels = new Set(); this.fadeN.value = 0; this.fitPts = []; return; }
    const P = r.pts; const n = P.length;
    // build a screen-space ribbon: 2 verts per point
    const pos = new Float32Array(n * 2 * 3), pv = new Float32Array(n * 2 * 3), nx = new Float32Array(n * 2 * 3), side = new Float32Array(n * 2), u = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const a = P[Math.max(0, i - 1)], b = P[i], c = P[Math.min(n - 1, i + 1)];
      for (let s = 0; s < 2; s++) {
        const o = (i * 2 + s) * 3;
        pos[o] = b[0]; pos[o + 1] = b[1] * this.K + 1.2; pos[o + 2] = b[2];
        pv[o] = a[0]; pv[o + 1] = a[1] * this.K + 1.2; pv[o + 2] = a[2];
        nx[o] = c[0]; nx[o + 1] = c[1] * this.K + 1.2; nx[o + 2] = c[2];
        side[i * 2 + s] = s ? 1 : -1; u[i * 2 + s] = b[3];
      }
    }
    const idx = [];
    for (let i = 0; i < n - 1; i++) { const a = i * 2, b = a + 1, c = a + 2, d = a + 3; idx.push(a, b, c, b, d, c); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('prevPos', new THREE.BufferAttribute(pv, 3)); geo.setAttribute('nextPos', new THREE.BufferAttribute(nx, 3));
    geo.setAttribute('side', new THREE.BufferAttribute(side, 1)); geo.setAttribute('aU', new THREE.BufferAttribute(u, 1)); geo.setIndex(idx);
    const glow = new THREE.Mesh(geo, this.ribGlow), core = new THREE.Mesh(geo.clone(), this.ribCore);
    glow.frustumCulled = core.frustumCulled = false; glow.renderOrder = 74; core.renderOrder = 75;
    this.scene.add(glow, core); this.ribMeshes.push(glow, core);
    // escalator markers
    for (const m of r.marks) {
      const tex = texCanvas(160, 64, (g, w, h) => {
        g.fillStyle = 'rgba(20,12,2,0.88)'; g.strokeStyle = '#ffb02e'; g.lineWidth = 3.5;
        const rr = 22; g.beginPath(); g.moveTo(rr, 4); g.arcTo(w - 4, 4, w - 4, h - 4, rr); g.arcTo(w - 4, h - 4, 4, h - 4, rr); g.arcTo(4, h - 4, 4, 4, rr); g.arcTo(4, 4, w - 4, 4, rr); g.closePath(); g.fill(); g.stroke();
        g.fillStyle = '#ffd27a'; g.font = '700 30px Inter, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(m.text, w / 2, h / 2 + 2);
      });
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false }));
      s.position.set(m.x, m.y * this.K + 5, m.z); s.renderOrder = 78; s.userData.px = [84, 34]; s.center.set(m.via ? 0.05 : 0.5, m.via ? -0.7 : 0);   // the canyon chip sits to the right of its point, clear of the escalator chip
      this.markGroup.add(s);
    }
    // route samples for the plate fade (16 points evenly along the path)
    for (let i = 0; i < 16; i++) { const q = P[Math.min(n - 1, Math.round(i / 15 * (n - 1)))]; this.fadePts.value[i].set(q[0], q[2]); }
    this.fadeN.value = 16;
    this.routeLevels = new Set(r.legs.map(l => l.level));
    for (const l of r.legs) if (l.ramp >= 0) { const rr = LAYOUT.ramps[l.ramp]; this.routeLevels.add(rr.lower); this.routeLevels.add(rr.upper); }
    this.ribCore.uniforms.uTotal.value = this.ribGlow.uniforms.uTotal.value = r.total;
    // fit points (subsampled)
    this.fitPts = []; const step = Math.max(1, Math.floor(n / 40));
    for (let i = 0; i < n; i += step) this.fitPts.push([P[i][0], P[i][1] * this.K, P[i][2]]);
    const L = P[n - 1]; this.fitPts.push([L[0], L[1] * this.K, L[2]]);
  }

  setDestination(d) {
    this.dest = d;
    if (!d) { this.pin.visible = this.destBeam.visible = this.destRing.visible = false; if (this.destLabel) this.destLabel.visible = false; return; }
    const y = LEVELS[d.level].y * this.K + 1.2;
    this.pin.position.set(d.x, y, d.z); this.destBeam.position.set(d.x, y, d.z); this.destRing.position.set(d.x, y + 0.3, d.z);
    this.pin.visible = this.destBeam.visible = this.destRing.visible = true;
    // name chip
    const tex = texCanvas(300, 76, (g, w, h) => {
      g.fillStyle = 'rgba(20,12,2,0.9)'; g.strokeStyle = '#ffb02e'; g.lineWidth = 3;
      const rr = 24; g.beginPath(); g.moveTo(rr, 4); g.arcTo(w - 4, 4, w - 4, h - 4, rr); g.arcTo(w - 4, h - 4, 4, h - 4, rr); g.arcTo(4, h - 4, 4, 4, rr); g.arcTo(4, 4, w - 4, 4, rr); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#ffe2a8'; g.font = '700 30px Inter, "Noto Sans JP", system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(d.en, w / 2, h / 2 + 2);
    });
    if (this.destLabel) { this.scene.remove(this.destLabel); this.destLabel.material.map.dispose(); this.destLabel.material.dispose(); }
    this.destLabel = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false }));
    this.destLabel.renderOrder = 86; this.destLabel.userData.px = [150, 38]; this.destLabel.center.set(0.5, -0.1);
    this.destLabel.position.set(d.x, y + 1, d.z);
    this.scene.add(this.destLabel);
  }

  setPlayer(x, z, level, heading, y) {
    const p = this.player; p.x = x; p.z = z; p.level = level; p.heading = heading;
    p.y = (y != null ? y : LEVELS[level].y) * this.K;
  }

  setExplode(k) {
    this.K = k;
    for (const lv in this.levels) { const L = this.levels[lv]; L.y = LEVELS[lv].y * k; L.group.position.y = L.y; }
    const r = this.route, d = this.dest; if (r) this.setRoute(r); if (d) this.setDestination(d);
    this._snapCam = true;
  }
  setLevels(current) {
    this.curLevel = current;
  }

  // -------------------------------------------------------------- pointer ---
  _bindPointer() {
    const c = this.canvas, pts = new Map(); let pinch = null, moved = 0;
    c.addEventListener('pointerdown', e => { c.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = 0; if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: this.zoomMul }; } e.stopPropagation(); });
    c.addEventListener('pointermove', e => {
      const p = pts.get(e.pointerId); if (!p) return;
      if (pts.size === 2 && pinch) { p.x = e.clientX; p.y = e.clientY; const [a, b] = [...pts.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); this.zoomMul = Math.max(0.2, Math.min(3, pinch.z * pinch.d / Math.max(10, d))); this.userDrag = true; return; }
      const s = this._cssScale(); const dx = (e.clientX - p.x) / s, dy = (e.clientY - p.y) / s; p.x = e.clientX; p.y = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
      this.az -= dx * 0.0085; this.el = Math.max(0.12, Math.min(1.45, this.el + dy * 0.0075)); this.userDrag = true; this.onUser && this.onUser();
    });
    const up = e => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; };
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', e => { e.preventDefault(); e.stopPropagation(); this.zoomMul = Math.max(0.2, Math.min(3, this.zoomMul * Math.exp(e.deltaY * 0.0012))); this.userDrag = true; this.onUser && this.onUser(); }, { passive: false });
    c.addEventListener('dblclick', () => this.recenter());
  }
  _cssScale() { const r = this.canvas.getBoundingClientRect(); return r.width / (this.canvas.clientWidth || r.width) || 1; }
  startIntro() { this.intro = 1; this._snapCam = true; }
  recenter() { this.az = 215 * Math.PI / 180; this.el = (this.mode === 'follow' ? 46 : 27) * Math.PI / 180; this.zoomMul = 1; this.userDrag = false; this._snapCam = true; }
  setMode(m) { this.mode = m; this.zoomMul = 1; this.userDrag = false; this.el = (m === 'follow' ? 46 : 32) * Math.PI / 180; }

  resize(force) {
    const c = this.canvas, W = c.clientWidth, H = c.clientHeight; if (!W || !H) return;
    const pr = Math.max(1, Math.min(this.low ? 1.25 : 2, (window.devicePixelRatio || 1) * this._cssScale()));
    if (!force && W === this._w && H === this._h && pr === this._pr) return;
    this._w = W; this._h = H; this._pr = pr;
    this.renderer.setPixelRatio(pr); this.renderer.setSize(W, H, false);
    this.camera.aspect = W / H;
    for (const m of [this.ribCore, this.ribGlow]) m.uniforms.uRes.value.set(W, H);
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------- per frame ---
  _basis() {
    const ie = this.intro > 0 ? this.intro * this.intro * (3 - 2 * this.intro) : 0;
    const az = this.az + ie * 1.1, el = this.el + ie * 0.35;
    const ce = Math.cos(el), se = Math.sin(el);
    const dirx = Math.sin(az) * ce, dirz = Math.cos(az) * ce, diry = se;     // target -> camera
    const f = new THREE.Vector3(-dirx, -diry, -dirz);
    const r = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)).normalize();
    const u = new THREE.Vector3().crossVectors(r, f).normalize();
    return { f, r, u, dir: new THREE.Vector3(dirx, diry, dirz) };
  }

  _frame() {
    const W = this._w, H = this._h, B = this._basis();
    const bandH = Math.max(120, H - this.bandTop - this.bandBottom);
    const tanV = Math.tan(this.camera.fov * Math.PI / 360) * bandH / H;
    const tanH = Math.tan(this.camera.fov * Math.PI / 360) * ((W - this.bandRight) / H);
    const pl = this.player;
    let pts;
    if (this.mode === 'follow') {
      // you, with a little of the destination direction when it is near
      const R = 70 * this.zoomMul;
      pts = [[pl.x - R, pl.y - 18, pl.z - R], [pl.x + R, pl.y + 18, pl.z + R], [pl.x - R, pl.y + 18, pl.z + R], [pl.x + R, pl.y - 18, pl.z - R]];
    } else {
      pts = (this.fitPts && this.fitPts.length ? this.fitPts : []).concat([[pl.x, pl.y, pl.z]]);
      if (this.dest) {
        const dy = LEVELS[this.dest.level].y * this.K, pm = bandH / (2 * Math.max(60, this.cur.dist) * tanV);
        const up = 95 / pm; pts.push([this.dest.x, dy, this.dest.z], [this.dest.x + B.u.x * up, dy + B.u.y * up, this.dest.z + B.u.z * up]);
      }
      if (pts.length < 2) { const e = this.extent; pts = [[e.minX, e.minY, e.minZ], [e.maxX, e.maxY, e.maxZ]]; }
    }
    let a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9, d0 = 1e9, d1 = -1e9;
    const v = new THREE.Vector3();
    for (const p of pts) { v.set(p[0] - pl.x, p[1] - pl.y, p[2] - pl.z); const a = v.dot(B.r), b = v.dot(B.u), d = v.dot(B.f); a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); d0 = Math.min(d0, d); d1 = Math.max(d1, d); }
    const pad = this.mode === 'follow' ? 1.0 : 1.0;
    const ca = (a0 + a1) / 2, cb = (b0 + b1) / 2, cd = (d0 + d1) / 2;
    const hw = Math.max(20, (a1 - a0) / 2) * pad, hh = Math.max(20, (b1 - b0) / 2) * pad, hd = (d1 - d0) / 2;
    const dist = Math.max(hh / tanV, hw / tanH) + hd * 0.3;
    this.goal.tx = pl.x + B.r.x * ca + B.u.x * cb + B.f.x * cd;
    this.goal.ty = pl.y + B.r.y * ca + B.u.y * cb + B.f.y * cd;
    this.goal.tz = pl.z + B.r.z * ca + B.u.z * cb + B.f.z * cd;
    this.goal.dist = this.mode === 'follow' ? Math.max(60, dist) : Math.max(60, dist * this.zoomMul);
    if (this.mode === 'follow') this.goal.dist = Math.max(40, dist);
  }

  update(dt) {
    if (!this.ready) return;
    this.time += dt;
    this.resize();
    if (!this._w || !this._h) return;       // canvas not laid out (view hidden): never feed NaN to the camera
    if (this.intro > 0) this.intro = Math.max(0, this.intro - dt / 2.4);
    this._frame();
    const k = this._snapCam ? 1 : 1 - Math.exp(-dt / 0.22); this._snapCam = false;
    const c = this.cur, g = this.goal;
    if (!isFinite(g.tx + g.ty + g.tz + g.dist)) return;
    if (!isFinite(c.tx + c.ty + c.tz + c.dist)) { c.tx = g.tx; c.ty = g.ty; c.tz = g.tz; c.dist = g.dist; }
    c.tx += (g.tx - c.tx) * k; c.ty += (g.ty - c.ty) * k; c.tz += (g.tz - c.tz) * k; c.dist += (g.dist - c.dist) * k;
    const B = this._basis();
    const iz = 1 + (this.intro > 0 ? this.intro * this.intro * 0.9 : 0), cd = c.dist * iz;
    this.camera.position.set(c.tx + B.dir.x * cd, c.ty + B.dir.y * cd, c.tz + B.dir.z * cd);
    this.camera.lookAt(c.tx, c.ty, c.tz);
    // shift the picture centre into the free band between header and sheet
    const H = this._h, W = this._w, shift = (this.bandTop - this.bandBottom) / 2;
    this.camera.setViewOffset(W, H, this.bandRight / 2, -shift, W, H);
    this.camera.updateMatrixWorld();
    // level emphasis
    const cur = this.curLevel;
    for (const lv in this.levels) {
      const L = this.levels[lv];
      const isCur = lv === cur, onRoute = this.routeLevels && this.routeLevels.has(lv);
      L.tgain = isCur ? 1.9 : onRoute ? 1.3 : 0.7; L.talpha = isCur ? 3.0 : onRoute ? 2.0 : 1.0; L.tline = isCur ? 1.0 : onRoute ? 0.55 : 0.2; L.tsweep = isCur ? 1 : 0;
      const e = 1 - Math.exp(-dt / 0.25);
      L.gain += (L.tgain - L.gain) * e; L.alpha += (L.talpha - L.alpha) * e; L.line += (L.tline - L.line) * e; L.sweep += (L.tsweep - L.sweep) * e;
      const u = L.mat.uniforms; u.uGain.value = L.gain; u.uAlpha.value = L.alpha; u.uTime.value = this.time; u.uSweep.value = L.sweep; u.uPlayer.value.set(this.player.x, 0, this.player.z);
      L.lmat.uniforms.uOpacity.value = L.line; L.mat.uniforms.uFadeMin.value = L.lmat.uniforms.uFadeMin.value = (this.fadeN.value ? (isCur ? 0.65 : onRoute ? 0.32 : 0.10) : 1);
      L.labelMat.opacity = isCur ? 1 : onRoute ? 0.85 : 0.5;
      // compact preview (guide view): only your floor and the destination floor are labelled
      L.label.visible = !this.compact || isCur || (this.dest && lv === this.dest.level);
    }
    // constant-screen-size sprites & world-scale helpers
    const Hpx = this._h, pxPerM = Hpx / (2 * c.dist * Math.tan(this.camera.fov * Math.PI / 360));
    const ps = 2 * Math.tan(this.camera.fov * Math.PI / 360) / Hpx;
    const spx = (s, w, h) => s.scale.set(w * ps, h * ps, 1);
    const pl = this.player;
    this.dot.position.set(pl.x, pl.y + 1.4, pl.z); spx(this.dot, 40, 40);
    const ph = (this.time * 0.9) % 1;
    this.ring.position.copy(this.dot.position); spx(this.ring, 30 + ph * 56, 30 + ph * 56); this.ringMat.opacity = (1 - ph) * 0.9;
    const haloR = Math.max(1, 9 / pxPerM);          // true ±1 m, never smaller than ~9 px
    this.halo.position.set(pl.x, pl.y + 0.5, pl.z); this.halo.scale.setScalar(Math.max(1.0, haloR));
    const wr = Math.max(7, 46 / pxPerM);
    this.wedge.position.set(pl.x, pl.y + 0.55, pl.z); this.wedge.rotation.y = pl.heading; this.wedge.scale.setScalar(wr);
    this.beam.position.set(pl.x, pl.y, pl.z); this.beam.scale.y = 1;
    if (this.dest) {
      const dy = LEVELS[this.dest.level].y * this.K + 1.2;
      spx(this.pin, 34, 42);
      const dph = (this.time * 0.7 + 0.5) % 1; spx(this.destRing, 24 + dph * 50, 24 + dph * 50); this.destRing.material.opacity = (1 - dph) * 0.9;
      this.destLabel.position.set(this.dest.x, dy + 1 + 42 / pxPerM, this.dest.z); spx(this.destLabel, this.destLabel.userData.px[0], this.destLabel.userData.px[1]);
      // keep the name chip inside the canvas: shift its anchor when the pin is near an edge
      this._lblV = this._lblV || new THREE.Vector3();
      this._lblV.copy(this.destLabel.position).project(this.camera);
      const lw = this.destLabel.userData.px[0], sx = (this._lblV.x * 0.5 + 0.5) * W, m = 6;
      let off = 0;                                   // px the chip must move right (+) / left (-)
      const rMax = W - this.bandRight - m;           // the floor ladder lives in the right band
      if (isFinite(sx)) { if (sx - lw / 2 < m) off = m - (sx - lw / 2); else if (sx + lw / 2 > rMax) off = rMax - (sx + lw / 2); }
      this.destLabel.center.x = 0.5 - off / lw;
    }
    for (const lv in this.levels) { const s = this.levels[lv].label; spx(s, s.userData.px[0], s.userData.px[1]); }
    this.markGroup.visible = !this.compact;          // escalator / canyon chips only in the full 3D view
    for (const s of this.markGroup.children) spx(s, s.userData.px[0], s.userData.px[1]);
    this.ribCore.uniforms.uTime.value = this.ribGlow.uniforms.uTime.value = this.time;
    this.bgMat.uniforms.uTime.value = this.time;
  }

  render() { if (this.ready) this.renderer.render(this.scene, this.camera); }
  // pre-compile shaders / upload buffers behind the install bar
  warm() { if (!this.ready) return; const t = performance.now(); try { this.renderer.compile(this.scene, this.camera); } catch (e) { /* ignore */ } this.timing.compile = performance.now() - t; }
}
