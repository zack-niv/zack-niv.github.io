// =============================================================================
// Zone environment maps. One small procedural "room" per mood (fixture
// patterns, wall colours, shopfront glow bands, sky for outdoor moods) is
// rendered to a PMREM at load. scene.environment is a blend target that
// cross-fades between moods as the player moves, so glossy floors and steel
// never pop. Reflections are normalised to local brightness in the shader
// (inject.js nbEnvRef), so the env maps only need the right *pattern & tint*.
// =============================================================================
import * as THREE from 'three';

export const MOODS = {
  //            ceiling        fixtures  fixture colour  walls       floor       glow bands (shopfronts)        sky
  metro:      { ceil: 0x9a9c9c, fix: 'panel', fc: [0.95, 1.0, 1.06], fi: 7, wall: 0xc9cdc8, floor: 0x7d8180, bands: [[0xe5171f, 0.5], [0xffffff, 1.2]], h: 3.4 },
  passage:    { ceil: 0x9a9c9c, fix: 'panel', fc: [0.95, 1.0, 1.05], fi: 6, wall: 0xd2d3cf, floor: 0x80827f, bands: [[0xfff2dc, 0.8]], h: 3.0 },
  arcade:     { ceil: 0xbdbab4, fix: 'down', fc: [1.0, 0.95, 0.88], fi: 9, wall: 0xd9d4ca, floor: 0x9a958c, bands: [[0xffd27a, 2.0], [0xff6a5a, 1.5], [0x7ad0ff, 1.4], [0xffffff, 2.2]], h: 3.2 },
  department: { ceil: 0xd0ccc4, fix: 'down', fc: [1.0, 0.94, 0.86], fi: 10, wall: 0xe8e2d8, floor: 0xb5ab9c, bands: [[0xfff0dc, 2.4]], h: 3.6 },
  mall:       { ceil: 0xb8b0a4, fix: 'down', fc: [1.0, 0.9, 0.76], fi: 10, wall: 0xc9b89c, floor: 0x9a8e7e, bands: [[0xffd8a0, 2.2], [0xff9a6a, 1.6], [0xfff4e0, 2.4], [0x9ad4ff, 1.2]], h: 3.6 },
  terminal:   { ceil: 0xa8aaac, fix: 'panel', fc: [0.96, 1.0, 1.06], fi: 7, wall: 0xcfccc6, floor: 0x8e8a84, bands: [[0xf08300, 1.0], [0xffffff, 1.4]], h: 6.0 },
  dining:     { ceil: 0x2a2724, fix: 'down', fc: [1.0, 0.78, 0.52], fi: 8, wall: 0x3a3430, floor: 0x3e3934, bands: [[0xffb060, 2.0], [0xff7040, 1.4]], h: 3.2 },
  street:     { sky: [0.55, 0.72, 1.0], horizon: [0.95, 0.95, 0.92], sun: 30, ground: 0x5c5a56, buildings: 0x6e6d6a },
  parks:      { sky: [0.5, 0.7, 1.0], horizon: [0.92, 0.95, 0.9], sun: 34, ground: 0x4f6a3a, buildings: 0x8a7a66 },
  garden:     { sky: [0.5, 0.7, 1.0], horizon: [0.92, 0.95, 0.9], sun: 34, ground: 0x4a7034, buildings: 0x7a8a66 },
};

function lin(hex) { return new THREE.Color(hex); } // THREE.Color(hex) converts sRGB→linear

function buildInterior(m) {
  const scene = new THREE.Scene();
  const S = 40, H = m.h;
  const mat = (c, k = 1) => new THREE.MeshBasicMaterial({ color: lin(c).multiplyScalar(k), side: THREE.BackSide });
  // room box
  const box = new THREE.Mesh(new THREE.BoxGeometry(S, H, S), [mat(m.wall, 0.55), mat(m.wall, 0.55), mat(m.ceil, 0.35), mat(m.floor, 0.5), mat(m.wall, 0.55), mat(m.wall, 0.55)]);
  box.position.y = H / 2 - 1.6;
  scene.add(box);
  // fixtures on the ceiling
  const fc = new THREE.Color(m.fc[0], m.fc[1], m.fc[2]).multiplyScalar(m.fi);
  const fmat = new THREE.MeshBasicMaterial({ color: fc, side: THREE.DoubleSide });
  const geo = m.fix === 'panel' ? new THREE.PlaneGeometry(1.2, 0.6) : new THREE.CircleGeometry(0.16, 12);
  const step = m.fix === 'panel' ? 3.6 : 2.6;
  for (let x = -S / 2 + step / 2; x < S / 2; x += step) for (let z = -S / 2 + step / 2; z < S / 2; z += step) {
    const f = new THREE.Mesh(geo, fmat);
    f.rotation.x = Math.PI / 2; f.position.set(x, H - 1.6 - 0.02, z);
    scene.add(f);
  }
  // glow bands on the walls (shopfronts / signage), at 0.2..2.8 m
  let k = 0;
  for (let side = 0; side < 4; side++) {
    for (let s = -S / 2 + 2; s < S / 2 - 2; s += 5) {
      const [c, inten] = m.bands[(k++) % m.bands.length];
      const w = 2.5 + ((k * 37) % 3);
      const b = new THREE.Mesh(new THREE.PlaneGeometry(w, k % 3 === 0 ? 0.6 : 2.2), new THREE.MeshBasicMaterial({ color: lin(c).multiplyScalar(inten), side: THREE.DoubleSide }));
      const y = k % 3 === 0 ? H - 2.0 : 0.0;
      const d = S / 2 - 0.05;
      if (side === 0) b.position.set(s, y, -d);
      if (side === 1) { b.position.set(s, y, d); b.rotation.y = Math.PI; }
      if (side === 2) { b.position.set(-d, y, s); b.rotation.y = Math.PI / 2; }
      if (side === 3) { b.position.set(d, y, s); b.rotation.y = -Math.PI / 2; }
      scene.add(b);
    }
  }
  return scene;
}

function buildOutdoor(m) {
  const scene = new THREE.Scene();
  // sky gradient dome
  const g = new THREE.SphereGeometry(100, 32, 16);
  const pos = g.attributes.position, cols = [];
  const sky = new THREE.Color(...m.sky).multiplyScalar(2.2), hor = new THREE.Color(...m.horizon).multiplyScalar(2.8), gr = lin(m.ground).multiplyScalar(0.5);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 100;
    if (y > 0) c.copy(hor).lerp(sky, Math.pow(y, 0.6)); else c.copy(gr);
    cols.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  scene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  // sun disc
  const sun = new THREE.Mesh(new THREE.SphereGeometry(5, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.96, 0.88).multiplyScalar(m.sun) }));
  sun.position.set(40, 70, 50);
  scene.add(sun);
  // low building silhouettes on the horizon
  const bm = new THREE.MeshBasicMaterial({ color: lin(m.buildings).multiplyScalar(0.7) });
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2, r = 70;
    const h = 8 + ((i * 53) % 23);
    const b = new THREE.Mesh(new THREE.BoxGeometry(14, h, 10), bm);
    b.position.set(Math.cos(a) * r, h / 2 - 3, Math.sin(a) * r); b.lookAt(0, h / 2 - 3, 0);
    scene.add(b);
  }
  return scene;
}

export class EnvMaps {
  constructor(renderer, size = 128) {
    this.renderer = renderer;
    this.pm = new THREE.PMREMGenerator(renderer);
    this.maps = {};
    this.ref = {};
    this.size = size;
    this.blendRT = null;
    this.from = null; this.to = null; this.t = 1;
    this.blendMat = new THREE.ShaderMaterial({
      uniforms: { a: { value: null }, b: { value: null }, t: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'uniform sampler2D a; uniform sampler2D b; uniform float t; varying vec2 vUv; void main(){ gl_FragColor = mix(texture2D(a, vUv), texture2D(b, vUv), t); }',
      depthTest: false, depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blendMat);
    this.quad.frustumCulled = false;
    this.qscene = new THREE.Scene(); this.qscene.add(this.quad);
    this.qcam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }
  _make(name) {
    const m = MOODS[name];
    const scene = m.sky ? buildOutdoor(m) : buildInterior(m);
    const rt = this.pm.fromScene(scene, 0.0, 0.1, 200, { size: this.size });
    this.maps[name] = rt;
    this.ref[name] = this._measure(scene);
    scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) [].concat(o.material).forEach(x => x.dispose()); });
  }
  // Only the start mood is built at load; the others are built one per frame
  // afterwards (update()) so loading stays cheap.
  build(first = 'metro') {
    this._make(first);
    this.queue = Object.keys(MOODS).filter(n => n !== first);
    const any = this.maps[first];
    this.blendRT = new THREE.WebGLRenderTarget(any.width, any.height, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, colorSpace: THREE.LinearSRGBColorSpace, depthBuffer: false, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, generateMipmaps: false });
    this.blendRT.texture.mapping = THREE.CubeUVReflectionMapping;
    this.blendRT.texture.name = 'nb-env-blend';
    this.cur = first; this.from = first; this.to = first; this.t = 1;
    this._render();
    return this.blendRT.texture;
  }
  // build the next queued mood (prioritising the one being asked for)
  _pump(want) {
    if (!this.queue || !this.queue.length) return;
    const i = want ? this.queue.indexOf(want) : -1;
    const name = i >= 0 ? this.queue.splice(i, 1)[0] : this.queue.shift();
    this._make(name);
  }
  // mean irradiance luminance of the mood env (cheap cube readback at load)
  _measure(scene) {
    const rt = new THREE.WebGLCubeRenderTarget(8, { type: THREE.FloatType });
    const cam = new THREE.CubeCamera(0.1, 200, rt);
    cam.update(this.renderer, scene);
    const buf = new Float32Array(8 * 8 * 4);
    let sum = 0, n = 0;
    for (let f = 0; f < 6; f++) {
      try { this.renderer.readRenderTargetPixels(rt, 0, 0, 8, 8, buf, f); } catch (e) { continue; }
      // weight: faces are not cosine-weighted; treat the up face (2) as the main
      const w = f === 2 ? 2.0 : f === 3 ? 0.5 : 1.0;
      for (let i = 0; i < 64; i++) {
        const r = buf[i * 4], g = buf[i * 4 + 1], b = buf[i * 4 + 2];
        sum += (0.2126 * r + 0.7152 * g + 0.0722 * b) * w; n += w;
      }
    }
    rt.dispose();
    const avgRad = n && sum > 0 ? sum / n : 0.5;
    return Math.max(0.05, avgRad * Math.PI);
  }
  setMood(name) {
    if (name === this.to) return;
    if (!this.maps[name]) { this._pump(name); if (!this.maps[name]) return; }
    // start a cross-fade from the currently displayed blend
    this.from = this.t >= 0.5 ? this.to : this.from;
    this.to = name; this.t = 0;
  }
  get refLum() {
    const a = this.ref[this.from] || 1, b = this.ref[this.to] || 1;
    return a + (b - a) * this.t;
  }
  update(dt) {
    if (this.queue && this.queue.length && this.t >= 1 && (this._pt = (this._pt || 0) + dt) > 0.5) { this._pt = 0; this._pump(); }
    if (this.t >= 1) return false;
    this.t = Math.min(1, this.t + dt / 1.6);
    this._render();
    return true;
  }
  _render() {
    const r = this.renderer;
    this.blendMat.uniforms.a.value = this.maps[this.from].texture;
    this.blendMat.uniforms.b.value = this.maps[this.to].texture;
    this.blendMat.uniforms.t.value = this.t * this.t * (3 - 2 * this.t);
    const prev = r.getRenderTarget(), pa = r.autoClear;
    r.setRenderTarget(this.blendRT);
    r.render(this.qscene, this.qcam);
    r.setRenderTarget(prev); r.autoClear = pa;
  }
}
