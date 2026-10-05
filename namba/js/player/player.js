// First-person player controller (baseline). Movement feel is owned by the
// movement work: acceleration curves, head bob, escalator riding, look
// smoothing, footstep cadence. Physics goes through world.move() so the
// player and NPCs obey identical rules.
import * as THREE from 'three';
import { LAYOUT, LEVELS } from '../world/layout.js';
import { params } from '../core/params.js';

export class Player {
  constructor(ctx) {
    this.ctx = ctx;
    this.body = { x: 0, z: 0, y: 0, level: '3F', ramp: -1 };
    this.yaw = 0; this.pitch = 0;
    this.vel = new THREE.Vector2();
    this.eye = 1.62;
    this.walkSpeed = 1.55; this.runSpeed = 3.4;
    this.radius = 0.28;
    this.bobPhase = 0; this.stepPhase = 0;
    this.zone = null; this.space = null;
    this.frozen = false; // cutscenes / phone-only modes can set this
    this.speed = 0;
  }
  init() {
    let sp = LAYOUT.spawns[params.spawn] || LAYOUT.spawns.start;
    this.body.x = sp.x; this.body.z = sp.z; this.body.level = sp.level; this.yaw = sp.yaw || 0;
    if (params.pos) {
      const [x, z, lv] = params.pos; this.body.x = parseFloat(x); this.body.z = parseFloat(z); if (lv) this.body.level = lv;
    }
    if (params.yaw != null) this.yaw = params.yaw;
    if (params.pitch != null) this.pitch = params.pitch;
    this.body.ramp = -1;
    this.ctx.world.move(this.body, 0, 0, this.radius);
    this._locate(true);
    this._applyCamera(0);
  }
  get position() { return this.body; }
  get level() { return this.body.level; }
  // forward vector on the ground plane
  get forward() { return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) }; }

  update(dt) {
    const { input, world, events } = this.ctx;
    if (!this.frozen) {
      this.yaw -= input.look.x * input.sensitivity;
      this.pitch -= input.look.y * input.sensitivity;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
    }
    const mv = this.frozen ? { x: 0, y: 0 } : input.move;
    const speed = input.running ? this.runSpeed : this.walkSpeed;
    const f = this.forward, r = { x: -f.z, z: f.x };
    const tx = (f.x * mv.y + r.x * mv.x) * speed, tz = (f.z * mv.y + r.z * mv.x) * speed;
    const k = 1 - Math.exp(-dt * (Math.hypot(tx, tz) > 0.01 ? 7 : 9));
    this.vel.x += (tx - this.vel.x) * k; this.vel.y += (tz - this.vel.y) * k;
    let dx = this.vel.x * dt, dz = this.vel.y * dt;
    const conv = world.conveyor(this.body);
    if (conv) { dx += conv.x * dt; dz += conv.z * dt; }
    const prevLevel = this.body.level, prevRamp = this.body.ramp;
    const ox = this.body.x, oz = this.body.z;
    world.move(this.body, dx, dz, this.radius);
    this.speed = Math.hypot(this.body.x - ox, this.body.z - oz) / Math.max(dt, 1e-4);
    if (this.body.ramp !== prevRamp) events.emit('player:ramp', { ramp: this.body.ramp >= 0 ? LAYOUT.ramps[this.body.ramp] : null, entering: this.body.ramp >= 0 });
    if (this.body.level !== prevLevel) events.emit('player:level', { from: prevLevel, to: this.body.level });
    // footsteps from own walking speed (not conveyor)
    const walkSp = Math.hypot(this.vel.x, this.vel.y);
    if (walkSp > 0.3) {
      const prev = this.stepPhase;
      this.stepPhase += dt * walkSp * 1.25;
      if (Math.floor(prev) !== Math.floor(this.stepPhase)) {
        const loc = world.locate(this.body);
        events.emit('player:step', { foot: Math.floor(this.stepPhase) % 2, speed: walkSp, level: this.body.level, space: loc.space, ramp: loc.ramp, x: this.body.x, z: this.body.z });
      }
    }
    this.bobPhase = this.stepPhase * Math.PI;
    this._locate(false);
    this._applyCamera(dt, walkSp);
  }
  _locate(initial) {
    const loc = this.ctx.world.locate(this.body);
    if (loc.zone && loc.zone !== this.zone) {
      const from = this.zone; this.zone = loc.zone;
      if (!initial) this.ctx.events.emit('player:zone', { from, to: loc.zone, space: loc.space });
    }
    this.space = loc.space;
  }
  _applyCamera(dt, walkSp = 0) {
    const cam = this.ctx.engine.camera;
    const amp = Math.min(1, walkSp / 1.6);
    const bobY = Math.abs(Math.sin(this.bobPhase)) * 0.035 * amp;
    const bobX = Math.cos(this.bobPhase) * 0.02 * amp;
    // smooth y (stairs) a little
    const ty = this.body.y + this.eye + bobY;
    this._camY = this._camY == null || dt === 0 ? ty : this._camY + (ty - this._camY) * (1 - Math.exp(-dt * 14));
    cam.position.set(this.body.x + Math.cos(this.yaw) * bobX, this._camY, this.body.z - Math.sin(this.yaw) * bobX);
    cam.rotation.set(this.pitch, this.yaw, 0);
  }
}
