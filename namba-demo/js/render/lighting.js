// =============================================================================
// Lighting — realises every fixture the builders declare.
//
// CONTRACT for builders (architecture, shops, props, parks, transit…) — see
// notes/rendering.md for the full version:
//   ctx.lighting.addLight({ level, x, y, z, color, intensity, range, kind, dir, len })
//     x,y,z ABSOLUTE world metres (y = LEVELS[level].y + height above floor)
//     kind: 'panel' | 'down' | 'strip' | 'sign' | 'spot' | 'lamp'
//     intensity: relative (1 = a standard fixture of that kind), color: hex/'#rgb'/Color/[r,g,b]
//     dir: emission direction (signs/spots); Call during init(). Returns an id.
//   ctx.lighting.addProbe({ level, x, y, z, radius, mood })   (optional mood hint)
//   Never add THREE punctual/hemi/ambient lights; build bright MeshBasic fixtures.
//
// How it is realised:
//   1. afterBuild(): per-level light-field bake (lighting/bake.js) → one atlas
//      of irradiance maps (up / side / down, sky & sun visibility, wall
//      distance AO, obstacle contact AO).
//   2. Every lit material is patched at compile time (lighting/inject.js) to
//      sample the field → baked-quality GI on architecture, shops, props AND
//      moving crowds, with zero per-builder work.
//   3. 8 nearest real fixtures give true specular highlights (shader pool).
//   4. Zone environment maps (lighting/envmaps.js) cross-fade by mood,
//      normalised to local brightness.
//   5. One shadowed sun (DirectionalLight), masked to open-sky cells, shadow
//      map only updated near outdoors; sky irradiance follows ctx.exterior.sun.
// =============================================================================
import * as THREE from 'three';
import { LEVELS, LEVEL_ORDER, ZONES } from '../world/layout.js';
import { CELL } from '../world/world.js';
import { bakeLevel, synthesiseFallback, normLight, packAtlas } from './lighting/bake.js';
import { installMaterialHook, U, NB_DYN } from './lighting/inject.js';
import { EnvMaps } from './lighting/envmaps.js';

// install as early as possible: before any lit material compiles
installMaterialHook();

const FOG = {
  metro: { c: [0.55, 0.6, 0.6], d: 0.0085 }, passage: { c: [0.55, 0.58, 0.58], d: 0.009 },
  arcade: { c: [0.62, 0.58, 0.52], d: 0.0075 }, department: { c: [0.65, 0.6, 0.55], d: 0.007 },
  mall: { c: [0.62, 0.55, 0.46], d: 0.0072 }, terminal: { c: [0.6, 0.62, 0.64], d: 0.006 },
  dining: { c: [0.4, 0.32, 0.26], d: 0.009 }, street: { c: [0.72, 0.8, 0.9], d: 0.0021 },
  parks: { c: [0.74, 0.83, 0.93], d: 0.0017 }, garden: { c: [0.74, 0.83, 0.93], d: 0.0016 },
};

export class Lighting {
  constructor(ctx) {
    this.ctx = ctx; this.lights = []; this.probes = [];
    ctx.engine.ctx = ctx;
    this.baked = false; this.levels = {};
    this.mood = 'metro'; this.zone = null;
    this.pool = Array.from({ length: NB_DYN }, () => ({ id: -1, w: 0, next: -1 }));
    this._poolT = 0;
    this.U = U;
    this.stats = { lights: 0, fallback: 0, bakeMs: 0, atlas: '' };
    this.exposureHint = 1;
  }

  init() {
    const { engine } = this.ctx;
    const r = engine.renderer;
    const q = engine.quality;
    // environment maps per mood
    this.env = new EnvMaps(r, q.envSize || 128);
    try { engine.scene.environment = this.env.build(); }
    catch (e) { console.error('[render] env build failed', e); }
    engine.scene.environmentIntensity = 1.0;
    // the sun — always present (stable shader permutation), masked & faded indoors
    const sun = this.sun = new THREE.DirectionalLight(0xfff2e0, 0);
    sun.position.set(40, 80, 30);
    sun.castShadow = !!q.shadows;
    if (sun.castShadow) {
      const s = sun.shadow;
      s.mapSize.set(q.shadowMap || 2048, q.shadowMap || 2048);
      const R = q.shadowRange || 48;
      Object.assign(s.camera, { left: -R, right: R, top: R, bottom: -R, near: 1, far: 260 });
      s.camera.updateProjectionMatrix();
      s.bias = -0.0004; s.normalBias = 0.04; s.radius = 2;
      s.autoUpdate = false;
    }
    engine.scene.add(sun); engine.scene.add(sun.target);
    // fog (haze hides the draw distance; tinted per mood)
    engine.scene.fog = new THREE.FogExp2(0x8a9090, 0.008);
    this.fogColor = new THREE.Color(0.55, 0.6, 0.6); this.fogDensity = 0.008;
  }

  addLight(l) {
    if (!l || l.level == null || !isFinite(l.x) || !isFinite(l.z)) return -1;
    const id = this.lights.length;
    const n = normLight(l);
    if (LEVELS[l.level] && (n.y < LEVELS[l.level].y - 3 || n.y > LEVELS[l.level].y + 16) && !this._warnedY) {
      this._warnedY = true;
      console.warn('[render] addLight: y looks relative to the floor; y must be ABSOLUTE world height', l);
    }
    n.id = id;
    this.lights.push(n);
    if (this.baked) this._late = true; // only used for specular
    return id;
  }
  addProbe(p) { this.probes.push(p); return this.probes.length - 1; }

  // ---------------------------------------------------------------------------
  async afterBuild() {
    const t0 = performance.now();
    const { world } = this.ctx;
    // fallback fixtures for spaces nobody lit
    const fb = synthesiseFallback(world, this.lights);
    this.stats.fallback = fb.length;
    for (const f of fb) { const n = normLight(f); n.id = this.lights.length; n.fallback = true; n.along = f.along; this.lights.push(n); }
    this._buildFallbackFixtures(fb);
    this.stats.lights = this.lights.length;
    // bucket by level
    const by = {};
    for (const l of this.lights) (by[l.level] = by[l.level] || []).push(l);
    this.byLevel = by;
    const jobs = [];
    LEVEL_ORDER.forEach((lv, i) => {
      if (!world.grids[lv]) return;
      const up = LEVEL_ORDER[i + 1];
      const upper = up && world.grids[up] ? { level: up, lights: by[up] || [] } : null;
      const g = world.grids[lv];
      jobs.push({ level: lv, lights: by[lv] || [], upper, cost: g.w * g.h * 0.3 + (by[lv] || []).length * 60 });
    });
    let res = null;
    try { res = await this._bakeWorkers(jobs); } catch (e) { console.warn('[render] worker bake failed, baking on main thread', e); }
    if (!res) {
      res = jobs.map(j => bakeLevel(world, j.level, j.lights, j.upper ? { level: j.upper.level, grid: world.grids[j.upper.level], lights: j.upper.lights } : null, {}));
      this.stats.bakeMode = 'main';
    }
    this._upload(res);
    this._markShadowCasters();
    this.baked = true;
    this.stats.bakeMs = Math.round(performance.now() - t0);
    console.log(`[render] light field: ${this.stats.lights} fixtures (${fb.length} fallback), atlas ${this.stats.atlas}, bake ${this.stats.bakeMs} ms (${this.stats.bakeMode})`);
  }

  // split the levels over a few module workers (falls back to null on failure)
  _bakeWorkers(jobs) {
    if (typeof Worker === 'undefined' || this.ctx.params.has('syncbake')) return Promise.resolve(null);
    const { world } = this.ctx;
    const L = world.layout;
    const snap = {
      grids: {}, edges: world.edges, obstacles: world.obstacles,
      spaces: L.spaces.map(s => ({ outdoor: !!s.outdoor, outdoorish: !!s.outdoorish, rect: s.rect || null, style: s.style || null })),
      ramps: L.ramps.map(r => ({ lower: r.lower, upper: r.upper, rect: r.rect, axis: r.axis, up: r.up })),
    };
    for (const lv in world.grids) { const g = world.grids[lv]; snap.grids[lv] = { x0: g.x0, z0: g.z0, w: g.w, h: g.h, type: g.type, space: g.space }; }
    const nW = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1, jobs.length));
    const buckets = Array.from({ length: nW }, () => ({ cost: 0, jobs: [] }));
    for (const j of jobs.slice().sort((a, b) => b.cost - a.cost)) {
      const b = buckets.reduce((m, x) => (x.cost < m.cost ? x : m));
      b.cost += j.cost; b.jobs.push({ level: j.level, lights: j.lights, upper: j.upper });
    }
    const out = [];
    return Promise.all(buckets.filter(b => b.jobs.length).map(b => new Promise((resolve, reject) => {
      const w = new Worker(new URL('./lighting/bakeworker.js', import.meta.url), { type: 'module' });
      const timer = setTimeout(() => { w.terminate(); reject(new Error('bake worker timeout')); }, 60000);
      w.onmessage = (ev) => {
        const d = ev.data;
        if (d.ok) out.push(d.r);
        else if (d.done) { clearTimeout(timer); w.terminate(); resolve(); }
        else { clearTimeout(timer); w.terminate(); reject(new Error(d.error)); }
      };
      w.onerror = (e) => { clearTimeout(timer); w.terminate(); reject(e.message || e); };
      w.postMessage({ snap, jobs: b.jobs });
    }))).then(() => { this.stats.bakeMode = `${nW} workers`; return out; });
  }

  _upload(res) {
    const { W, H } = packAtlas(res);
    this.stats.atlas = `${W}x${H}`;
    const n = W * H;
    const A = new Uint16Array(n * 4), B = new Uint16Array(n * 4), C = new Uint8Array(n * 4);
    const h = THREE.DataUtils.toHalfFloat;
    for (const r of res) {
      this.levels[r.level] = r;
      for (let z = 0; z < r.H; z++) for (let x = 0; x < r.W; x++) {
        const s = z * r.W + x, d = (r.oy + z) * W + (r.ox + x);
        for (let c = 0; c < 4; c++) {
          A[d * 4 + c] = h(r.A[s * 4 + c]); B[d * 4 + c] = h(r.B[s * 4 + c]); C[d * 4 + c] = r.C[s * 4 + c];
        }
      }
      // pad ring: clamp-extend the edge texels so filtering at map borders is sane
      const pad = 3;
      for (let z = -pad; z < r.H + pad; z++) for (let x = -pad; x < r.W + pad; x++) {
        if (x >= 0 && z >= 0 && x < r.W && z < r.H) continue;
        const sx = Math.min(r.W - 1, Math.max(0, x)), sz = Math.min(r.H - 1, Math.max(0, z));
        const s = sz * r.W + sx, d = (r.oy + z) * W + (r.ox + x);
        if (d < 0 || d >= n) continue;
        for (let c = 0; c < 4; c++) { A[d * 4 + c] = h(r.A[s * 4 + c]); B[d * 4 + c] = h(r.B[s * 4 + c]); C[d * 4 + c] = c === 1 ? 0 : r.C[s * 4 + c]; }
      }
    }
    const mk = (data, type) => {
      const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, type);
      t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
      t.generateMipmaps = false; t.colorSpace = THREE.NoColorSpace; t.flipY = false;
      t.needsUpdate = true;
      return t;
    };
    U.nbA.value = mk(A, THREE.HalfFloatType);
    U.nbB.value = mk(B, THREE.HalfFloatType);
    U.nbC.value = mk(C, THREE.UnsignedByteType);
    U.nbAtlasInv.value.set(1 / W, 1 / H);
    LEVEL_ORDER.forEach((lv, i) => {
      const r = this.levels[lv];
      if (!r) { U.nbLevelExt.value[i].w = 0; return; }
      U.nbLevelRect.value[i].set(r.x0, r.z0, r.ox, r.oy);
      U.nbLevelExt.value[i].set(r.W, r.H, LEVELS[lv].y, 1);
    });
  }

  // emissive geometry for synthesised fixtures (instanced, chunked for culling)
  _buildFallbackFixtures(fb) {
    if (!fb.length) return;
    const { engine } = this.ctx;
    const geos = {
      panel: new THREE.BoxGeometry(1.2, 0.03, 0.6),
      down: new THREE.CylinderGeometry(0.09, 0.09, 0.02, 12),
      strip: new THREE.BoxGeometry(1.5, 0.03, 0.12),
    };
    const mats = new Map();
    const matFor = (hex, kind) => {
      const k = hex + kind;
      let m = mats.get(k);
      if (!m) {
        const c = new THREE.Color(hex).multiplyScalar(kind === 'down' ? 9 : kind === 'strip' ? 7 : 5.5);
        m = new THREE.MeshBasicMaterial({ color: c }); m.name = 'nb_fixture'; mats.set(k, m);
      }
      return m;
    };
    const CH = 96;
    const groups = new Map();
    for (const f of fb) {
      const key = `${f.level}|${Math.floor(f.x / CH)}|${Math.floor(f.z / CH)}|${f.kind}|${f.color}`;
      let g = groups.get(key); if (!g) groups.set(key, g = []);
      g.push(f);
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    const yAxis = new THREE.Vector3(0, 1, 0);
    const chunkGroups = new Map();
    for (const [key, list] of groups) {
      const [lv, cx, cz, kind] = key.split('|');
      const geo = geos[kind] || geos.panel;
      const im = new THREE.InstancedMesh(geo, matFor(list[0].color, kind), list.length);
      list.forEach((f, i) => {
        q.setFromAxisAngle(yAxis, f.along === 'z' ? Math.PI / 2 : 0);
        p.set(f.x, f.y - 0.015, f.z);
        m4.compose(p, q, s); im.setMatrixAt(i, m4);
      });
      im.computeBoundingSphere();
      im.name = 'nb_fallback_fixtures';
      const ck = `${lv}|${cx}|${cz}`;
      let grp = chunkGroups.get(ck);
      if (!grp) {
        grp = new THREE.Group(); grp.name = 'nbfix:' + ck;
        grp.userData.chunk = { level: lv, x: (+cx + 0.5) * CH, z: (+cz + 0.5) * CH, r: CH * 0.75 };
        chunkGroups.set(ck, grp); engine.levelRoot(lv).add(grp);
      }
      grp.add(im);
    }
  }

  // outdoor chunks cast sun shadows (only those near the shadow window — see _updateCasters)
  _markShadowCasters() {
    this.casters = [];
    if (!this.sun.castShadow) return;
    const { engine, world } = this.ctx;
    for (const lv of LEVEL_ORDER) {
      const root = engine.levelRoot(lv); if (!root) continue;
      for (const grp of root.children) {
        const ch = grp.userData && grp.userData.chunk;
        if (!ch) continue;
        // does the chunk touch any outdoor cell? sample a coarse grid
        const g = world.grids[lv]; if (!g) continue;
        let out = false;
        for (let dz = -ch.r; dz <= ch.r && !out; dz += 4) for (let dx = -ch.r; dx <= ch.r; dx += 4) {
          const si = g.spaceAt(ch.x + dx, ch.z + dz);
          if (si >= 0 && world.layout.spaces[si].outdoor) { out = true; break; }
        }
        if (out) {
          grp.userData.nbOutdoor = true;
          const meshes = [];
          grp.traverse(o => { if (o.isMesh && !o.material.transparent) meshes.push(o); });
          this.casters.push({ grp, meshes, x: ch.x, z: ch.z, r: ch.r, on: false });
        }
      }
    }
    this._casterT = 0;
  }
  // restrict the shadow caster set to chunks that can reach the shadow window
  _updateCasters(px, pz) {
    if (!this.casters) return;
    const R = this.sun.shadow.camera.right + 70;
    for (const c of this.casters) {
      const want = Math.hypot(c.x - px, c.z - pz) - c.r < R;
      if (want === c.on) continue;
      c.on = want;
      for (const m of c.meshes) m.castShadow = want;
    }
  }

  // ---------------------------------------------------------------------------
  // CPU sample of the field at floor level: {r,g,b (up irradiance), side, sky, sun}
  sample(level, x, z) {
    const r = this.levels[level];
    const out = { r: 0, g: 0, b: 0, side: 0, sky: 0, sun: 0, ok: false };
    if (!r) return out;
    const cx = Math.floor(x - r.x0), cz = Math.floor(z - r.z0);
    if (cx < 0 || cz < 0 || cx >= r.W || cz >= r.H) return out;
    const i = cz * r.W + cx;
    out.r = r.A[i * 4]; out.g = r.A[i * 4 + 1]; out.b = r.A[i * 4 + 2]; out.sky = r.A[i * 4 + 3];
    out.side = 0.2126 * r.B[i * 4] + 0.7152 * r.B[i * 4 + 1] + 0.0722 * r.B[i * 4 + 2];
    out.sun = r.C[i * 4 + 3] / 255; out.ok = r.C[i * 4 + 1] > 128;
    return out;
  }
  // luminance (shader units) of irradiance at a point incl. current sky
  lumAt(level, x, z) {
    const s = this.sample(level, x, z);
    if (!s.ok) return -1;
    const sky = U.nbSky.value;
    const skyL = 0.2126 * sky.x + 0.7152 * sky.y + 0.0722 * sky.z;
    const sunL = this._sunE || 0;
    return 0.5 * (0.2126 * s.r + 0.7152 * s.g + 0.0722 * s.b) + 0.5 * s.side + s.sky * skyL * 0.75 + s.sun * sunL * 0.6;
  }
  // Exposure metering: average log luminance of what the camera is looking at,
  // estimated from the light field along a fan of view rays.
  meter() {
    const { player, engine } = this.ctx;
    if (!player || !this.baked) return null;
    const b = player.body, cam = engine.camera;
    const yaw = player.yaw, pitch = player.pitch || 0;
    let sum = 0, wsum = 0;
    const dists = [0.5, 3, 7, 14, 24];
    for (const da of [-0.45, -0.15, 0.15, 0.45]) {
      const fx = -Math.sin(yaw + da), fz = -Math.cos(yaw + da);
      for (let k = 0; k < dists.length; k++) {
        const d = dists[k];
        const L = this.lumAt(b.level, b.x + fx * d, b.z + fz * d);
        if (L < 0) break; // hit a wall: stop this ray
        const w = (k === 0 ? 1.5 : 1) * (1 - Math.abs(da));
        sum += Math.log2(Math.max(0.25, L) * 0.3 / Math.PI) * w; wsum += w;
      }
    }
    // looking up at open sky outdoors
    const here = this.sample(b.level, b.x, b.z);
    if (here.sky > 0.5 && pitch > -0.2) {
      const skyRad = 0.2126 * U.nbSky.value.x + 0.7152 * U.nbSky.value.y + 0.0722 * U.nbSky.value.z;
      const w = 2.5 * here.sky * Math.min(1, (pitch + 0.2) * 2 + 0.3);
      sum += Math.log2(skyRad * 0.6) * w; wsum += w;
    }
    if (!wsum) return null;
    return Math.pow(2, sum / wsum); // mean scene radiance (shader units)
  }

  // ---------------------------------------------------------------------------
  update(dt) {
    const { player, engine, events } = this.ctx;
    if (!player) return;
    const b = player.body;
    // ---- mood (env map, fog, grading) ----
    const loc = this.ctx.world.locate(b);
    const sp = loc.space;
    let mood = loc.zone && ZONES[loc.zone] ? ZONES[loc.zone].mood : this.mood;
    if (mood === 'plaza') mood = 'street';
    if (sp && (sp.style === 'dining_street' || sp.style === 'restaurant' || sp.style === 'parks_dining')) mood = 'dining';
    if (mood === 'parks' && sp && !sp.outdoor) mood = 'mall';
    if (sp && sp.outdoor && mood !== 'garden') mood = mood === 'street' ? 'street' : 'parks';
    if (sp && sp.style && sp.style.startsWith('city_')) mood = 'mall';
    if (mood !== this.mood) { this.mood = mood; events.emit('render:mood', { mood, zone: loc.zone }); }
    if (this.env) { this.env.setMood(mood); this.env.update(dt); U.nbEnvRef.value = this.env.refLum; }
    // ---- sun & sky ----
    this._updateSun(dt);
    // ---- fog ----
    const F = FOG[mood] || FOG.metro;
    const L = this.baked ? Math.max(0.2, this.lumAt(b.level, b.x, b.z)) : 2;
    const k = 1 - Math.exp(-dt * 1.5);
    this.fogDensity += (F.d * (engine.quality.fogScale || 1) - this.fogDensity) * k;
    const fc = this._fc || (this._fc = new THREE.Color());
    fc.setRGB(F.c[0], F.c[1], F.c[2]).multiplyScalar(Math.min(L, 12) * 0.16);
    this.fogColor.lerp(fc, k);
    if (engine.scene.fog) { engine.scene.fog.color.copy(this.fogColor); engine.scene.fog.density = this.fogDensity; }
    // ---- specular pool ----
    this._poolT -= dt;
    if (this._poolT <= 0 && this.baked) { this._poolT = 0.12; this._selectPool(); }
    this._fadePool(dt);
  }

  _updateSun(dt) {
    const { engine, player } = this.ctx;
    const ext = this.ctx.exterior;
    const sunInfo = ext && ext.sun;
    const dir = this._sunDir || (this._sunDir = new THREE.Vector3(0.45, 0.8, 0.4).normalize());
    let inten = 1, col = this._sunCol || (this._sunCol = new THREE.Color(1, 0.95, 0.86));
    let amb = null;
    if (sunInfo && sunInfo.direction) {
      dir.copy(sunInfo.direction).normalize();
      if (sunInfo.color) col.copy(sunInfo.color);
      inten = sunInfo.baseIntensity != null ? sunInfo.baseIntensity : sunInfo.intensity != null ? sunInfo.intensity : 1;
      const D = ext.daylight;
      if (D && D.amb != null) amb = D;
    } else {
      // no exterior system yet: derive from the clock
      const hh = this.ctx.clock && this.ctx.clock.minutes != null ? this.ctx.clock.minutes / 60 : 12.5;
      const a = ((hh - 6) / 12) * Math.PI; // 6:00 sunrise .. 18:00 sunset
      const el = Math.sin(a);
      dir.set(Math.cos(a) * 0.8, Math.max(0.05, el), 0.35).normalize();
      inten = Math.max(0, Math.min(1, el * 1.6));
      col.setRGB(1, 0.86 + 0.1 * Math.max(0, el), 0.7 + 0.18 * Math.max(0, el));
    }
    const elev = Math.max(0, dir.y);
    const day = Math.min(1, elev * 3) * Math.min(1.5, inten);
    // irradiance budget (shader units): interiors ≈ 2.5, sun ≈ 18, sky ≈ 4
    this._sunE = 18 * inten * Math.min(1, elev * 4);
    if (amb) {
      // sky irradiance from the exterior's palette: level from `amb`, tint from zenith/horizon
      const skyE = 0.05 + 4.2 * amb.amb;
      const t = this._skyTint || (this._skyTint = new THREE.Color());
      t.copy(amb.zen).lerp(amb.hor, 0.6);
      const m = Math.max(1e-4, 0.2126 * t.r + 0.7152 * t.g + 0.0722 * t.b);
      // keep it mostly neutral: real sky fill is bluish but not saturated
      U.nbSky.value.set(skyE * (0.55 + 0.45 * t.r / m), skyE * (0.55 + 0.45 * t.g / m), skyE * (0.55 + 0.45 * t.b / m));
    } else {
      const skyE = 0.06 + 4.2 * day;
      U.nbSky.value.set(skyE * 0.82, skyE * 0.93, skyE * 1.12);
    }
    const sun = this.sun;
    sun.color.copy(col);
    sun.intensity = this._sunE;
    const b = player.body;
    const near = this.baked ? this.sample(b.level, b.x, b.z) : { sky: 1 };
    // follow the player; refresh the shadow map only when daylight is around
    const tgt = sun.target.position;
    if (sun.castShadow) {
      const outdoorish = near.sky > 0.04 || near.sun > 0;
      const moved = !this._shPos || Math.hypot(b.x - this._shPos.x, b.z - this._shPos.z) > 2 || Math.abs(b.y - this._shPos.y) > 1;
      if (outdoorish && (moved || !this._shTimer || (this._shTimer -= dt) <= 0)) {
        // snap to texel grid to avoid shimmering
        const R = sun.shadow.camera.right, ts = (2 * R) / sun.shadow.mapSize.x;
        const sx = Math.round(b.x / ts) * ts, sz = Math.round(b.z / ts) * ts;
        tgt.set(sx, b.y, sz);
        sun.position.set(sx + dir.x * 120, b.y + dir.y * 120, sz + dir.z * 120);
        this._updateCasters(b.x, b.z);
        sun.shadow.needsUpdate = true;
        this._shPos = { x: b.x, z: b.z, y: b.y };
        this._shTimer = 4;
      }
    } else {
      tgt.set(b.x, b.y, b.z); sun.position.set(b.x + dir.x * 120, b.y + dir.y * 120, b.z + dir.z * 120);
    }
    sun.updateMatrixWorld(); sun.target.updateMatrixWorld();
  }

  // pick the N fixtures that matter most for specular highlights right now
  _selectPool() {
    const { player, world } = this.ctx;
    const b = player.body;
    const list = this.byLevel && this.byLevel[b.level];
    if (!list) return;
    const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
    const g = world.grids[b.level];
    const cand = [];
    const maxN = Math.min(NB_DYN, this.ctx.engine.quality.specLights != null ? this.ctx.engine.quality.specLights : NB_DYN);
    for (const l of list) {
      const dx = l.x - b.x, dz = l.z - b.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 30 * 30) continue;
      const d = Math.sqrt(d2) + 1e-3;
      const fwd = (dx * fx + dz * fz) / d;
      const lum = 0.2126 * l.r + 0.7152 * l.g + 0.0722 * l.b;
      // highlights on the floor ahead are what reads; behind the camera is useless
      const score = lum * (0.25 + 0.75 * Math.max(0, fwd + 0.2)) / (d2 + 6);
      cand.push([score, l]);
    }
    cand.sort((a, b2) => b2[0] - a[0]);
    const chosen = [];
    for (const [, l] of cand) {
      if (chosen.length >= maxN) break;
      if (!world.visible(b.level, b.x, b.z, l.x, l.z)) continue;
      chosen.push(l.id);
    }
    // keep lights already in slots; schedule the rest into free/fading slots
    const want = new Set(chosen);
    for (const s of this.pool) if (s.id >= 0 && !want.has(s.id)) s.next = -2; // fade out
    for (const id of chosen) {
      if (this.pool.some(s => s.id === id)) { const s = this.pool.find(s2 => s2.id === id); s.next = -1; continue; }
      const free = this.pool.find(s => s.id < 0) || this.pool.find(s => s.next === -2 && s.w < 0.05);
      if (free) { free.id = id; free.w = 0; free.next = -1; }
    }
    for (let i = maxN; i < NB_DYN; i++) this.pool[i].next = -2;
  }
  _fadePool(dt) {
    const k = Math.min(1, dt / 0.3);
    this.pool.forEach((s, i) => {
      const P = U.nbDynPos.value[i], C = U.nbDynCol.value[i], D = U.nbDynDir.value[i];
      if (s.id < 0) { P.w = 0; return; }
      s.w += ((s.next === -2 ? 0 : 1) - s.w) * k * 3;
      if (s.next === -2 && s.w < 0.02) { s.id = -1; P.w = 0; return; }
      const l = this.lights[s.id];
      P.set(l.x, l.y, l.z, l.range * 1.4);
      C.set(l.r * s.w, l.g * s.w, l.b * s.w, Math.max(0.12, l.size));
      D.set(l.dir[0], l.dir[1], l.dir[2], l.k);
    });
  }
}
