// =============================================================================
// Outdoors: sky, sun, outdoor light, the city around the complex (skyline,
// building massing, Nankai viaduct) and the street scenes at the exits.
//
// Public API (ctx.exterior):
//   sun            { direction: Vector3 (towards the sun), color: Color,
//                    intensity: number (current, already faded indoors),
//                    baseIntensity, elevation, azimuth (deg, from north) }
//   daylight       palette { zen, hor, glow, sun, amb, night 0..1, ... }
//   isOutdoor(level, x, z)        walk cell under open sky?
//   outdoorAt(level, x, z)        0..1 "how much daylight reaches here"
//   outdoorFactor                 0..1 for the player/camera right now
//   horizon                       Color: sky colour at the horizon (HDR,
//                                 same units as the sky dome) — fog/haze hint
// The shadowed sun DirectionalLight itself is owned by Lighting, which
// reads ctx.exterior.sun every frame (intensity 1 = clear midday).
// =============================================================================
import * as THREE from 'three';
import { sunPosition, daylight } from './outdoor/sun.js';
import { createSky } from './outdoor/sky.js';
import { OutdoorMask } from './outdoor/outmask.js';

export const SHADOW_LAYER = 3;
export const SKY_GAIN = 4.5; // sky radiance scale to match the light-field units (sun ≈ 18)

export class Exterior {
  constructor(ctx) {
    this.ctx = ctx;
    this.sun = { direction: new THREE.Vector3(0, 1, 0), color: new THREE.Color(1, 1, 1), intensity: 0, baseIntensity: 0, elevation: 0, azimuth: 0 };
    this.daylight = {};
    this.outdoorFactor = 0;
    this.horizon = new THREE.Color();
    this.SHADOW_LAYER = SHADOW_LAYER;
    this.parts = [];          // { group, update(dt, ex) }
    this._sunT = -1;
    this._time = 0;
    this._gate = 1;           // smoothed visibility gate for global content
  }

  async init() {
    const { engine, world } = this.ctx;
    this.mask = new OutdoorMask(world);
    // root for everything outdoors that must be visible from far away
    this.root = new THREE.Group(); this.root.name = 'outdoor';
    engine.globalRoot.add(this.root);
    // --- sky ---
    this.sky = createSky();
    this.sky.uniforms.uGain.value = SKY_GAIN;
    this.root.add(this.sky.mesh);
    this._updateSun(true);
    // --- the city & streets (optional modules, isolated) ---
    const mods = [
      ['./outdoor/massing.js', 'buildMassing'],
      ['./outdoor/skyline.js', 'buildSkyline'],
      ['./outdoor/street.js', 'buildStreets'],
    ];
    for (const [path, fn] of mods) {
      try {
        const m = await import(path);
        const t0 = performance.now();
        if (m[fn]) { const part = await m[fn](this.ctx, this); if (part) this.parts.push(part); }
        (this.timings || (this.timings = {}))[fn] = Math.round(performance.now() - t0);
      } catch (e) {
        if (!/Failed to fetch|Cannot find module|error loading dynamically imported/i.test(e.message)) { console.error('[exterior]', path, e); this.ctx.errors.push(`exterior ${path}: ${e.message}`); }
      }
    }
  }

  isOutdoor(level, x, z) { return this.mask ? this.mask.isOutdoor(level, x, z) : false; }
  outdoorAt(level, x, z) {
    if (!this.mask) return 0;
    const d = this.mask.distance(level, x, z);
    return Math.max(0, Math.min(1, 1 - d / 22));
  }

  _updateSun(force) {
    const clock = this.ctx.clock;
    const m = clock ? clock.minutes : 630;
    if (!force && Math.abs(m - this._sunT) < 0.25) return;
    this._sunT = m;
    const p = sunPosition(m, undefined, this.sun.direction);
    this.sun.elevation = p.elevation; this.sun.azimuth = p.azimuth;
    daylight(p.elevation, this.daylight);
    const D = this.daylight;
    this.sun.color.copy(D.sun);
    this.sun.baseIntensity = Math.min(1, D.sunI / 3.6);
    const u = this.sky.uniforms;
    u.uSunDir.value.copy(this.sun.direction);
    u.uZen.value.copy(D.zen); u.uHor.value.copy(D.hor); u.uGlow.value.copy(D.glow); u.uSun.value.copy(D.sun);
    u.uCloudLit.value.copy(D.cloudLit); u.uCloudDark.value.copy(D.cloudDark);
    u.uNight.value = D.night;
    // horizon colour as seen by the eye (for fog / haze matching)
    this.horizon.copy(D.hor).multiplyScalar(SKY_GAIN * 1.1);
  }

  update(dt) {
    this._time += dt;
    this._updateSun(false);
    const { ctx } = this;
    const cam = ctx.camera;
    // outdoor factor at the player
    const b = ctx.player && ctx.player.body;
    let f = 1, dist = 0;
    if (b && this.mask) { dist = this.mask.distance(b.level, b.x, b.z); f = Math.max(0, Math.min(1, 1 - dist / 22)); }
    const k = 1 - Math.exp(-dt * 3);
    this.outdoorFactor += (f - this.outdoorFactor) * k;
    const of = this.outdoorFactor;
    // global content gate: far from any daylight → hide sky/city entirely
    const want = !b || dist < 70 ? 1 : 0;
    this._gate = want;
    this.root.visible = want === 1;
    this.sun.intensity = this.sun.baseIntensity;
    this.sky.uniforms.uTime.value = this._time;
    for (const p of this.parts) if (p.update) p.update(dt, this);
  }

  lateUpdate() {
    const cam = this.ctx.camera;
    cam.updateMatrixWorld();
    const cp = cam.getWorldPosition(this._cp || (this._cp = new THREE.Vector3()));
    this.sky.mesh.position.copy(cp);
    for (const p of this.parts) if (p.lateUpdate) p.lateUpdate(this);
  }
}
