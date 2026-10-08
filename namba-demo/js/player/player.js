// =============================================================================
// First-person player: a tourist on foot. Owned by the movement area.
//
// Locomotion: a second-order (critically damped, acceleration-limited) velocity
// model — weight on starts and stops, no ice, no instant halts — with
// view-following momentum (turning carries ~85% of velocity with the body),
// collision-aware velocity (blocked components are removed so wall slides
// are clean), stairs (tread-quantised steps, slower going up), escalators
// (board → stand and ride on the right, walk on the left), soft collisions
// with crowd agents and a phone "glance" mode.
// Physics goes through world.move() so the player and NPCs obey the same rules.
//
// Stable API (ctx.player): body, yaw, pitch, level, zone, space, position,
// forward, frozen, radius, eye (eye height, m), vel (own walking velocity,
// THREE.Vector2 x/z), speed (actual horizontal m/s), headBob (0..1 scale).
// Extras: walkSpeed (own m/s), gait ('stand'|'slow'|'walk'|'jog'|'ride'|
// 'stairs_up'|'stairs_down'), riding, onStairs, phoneOpen, stepPhase,
// lookRay(), lookPoint, lookTarget(maxDist, opts), interactables, kick(...).
// Events: player:step, player:land, player:bump, player:ramp, player:level,
// player:zone (see js/core/events.js).
// =============================================================================
import * as THREE from 'three';
import { LAYOUT, LEVELS } from '../world/layout.js?v=5f764cf';
import { params } from '../core/params.js?v=5f764cf';
import { HeadCam } from './headcam.js?v=5f764cf';
import { Look, InteractableSet } from './look.js?v=5f764cf';
import { surfaceOf } from './surface.js?v=5f764cf';
import { rampAlong, stairSurfaceY, stairTread, rampSlope } from './stairs.js?v=5f764cf';

// ---- tuning -------------------------------------------------------------------
export const MOVE = {
  walk: 1.5, jog: 3.2, slow: 0.8, shuffle: 0.35,       // m/s on the flat (shuffle = hold C: queues, counters)
  phone: 1.15, phoneJog: 2.0,                          // eyes on the phone: ~25% slower, a hurry is still a hurry
  back: 0.68, strafe: 0.86,                            // direction scaling (ellipse)
  stairsUp: 0.47, stairsDown: 0.58,                    // horizontal factor on stair flights
  escWalk: 0.55,                                       // walking on a moving escalator (relative)
  // velocity spring: w = stiffness (1/s), a = max acceleration (m/s²)
  // j = max jerk (m/s³): how fast effort builds — the 'weight' at starts/stops
  accel: { w: 6.5, a: 2.6, j: 16 }, accelJog: { w: 5.2, a: 3.4, j: 16 }, brake: { w: 8.0, a: 4.2, j: 26 },
  shuffle: { w: 12, a: 3.2, j: 40 },                   // precise approach / stop (≈0.15 s brake)
  turnCarry: 0.85,                                     // share of velocity that turns with the view
  radius: 0.28, eye: 1.62,
};
const STAND_U = 0.16;    // lateral offset (m) on an escalator: stand right (+), walk left (-)

function stepLength(v) { return Math.max(0.5, Math.min(1.3, 0.42 + 0.25 * v)); }

export class Player {
  constructor(ctx) {
    this.ctx = ctx;
    this.body = { x: 0, z: 0, y: 0, level: '3F', ramp: -1 };
    this.yaw = 0; this.pitch = 0;
    this.vel = new THREE.Vector2();      // own walking velocity (x, z) — excludes conveyor
    this.acc = new THREE.Vector2();      // velocity-spring acceleration state
    this.eye = MOVE.eye;
    this.walkSpeedMax = MOVE.walk; this.runSpeed = MOVE.jog; // legacy names
    this.radius = MOVE.radius;
    this.headBob = 1;
    this.zone = null; this.space = null;
    this.frozen = false;
    this.speed = 0; this.walkSpeed = 0;
    this.gait = 'stand';
    this.stepPhase = 0; this.bobPhase = 0;
    this.riding = false; this.onStairs = false; this.phoneOpen = false;
    this._standLatch = false; this._latchNeedsRelease = false;
    this._stair = null;                 // { ramp, lastIdx, treads, dir }
    this._support = null;               // quantised stair support height
    this._closing = false;
    this._camY = 0;                     // main.js teleport sets null → reset head
    this._bumpCd = 0;
    this._t = 0;                        // own clock (s)
    this._holdT = 0;                    // seconds forward is held while latched on an escalator
    this._lastLand = null;              // { ramp, t } last ramp exit (re-capture hysteresis)
    this._enterT = -9; this._strikeT = -9; this._pushBlockT = 0; this._passT = 0;
    this._lastYaw = 0;
    this.interactables = new InteractableSet();
    this.head = new HeadCam(this);
    this._look = new Look(this);
    this.lookPoint = this._look.point;
    // game.js reads `player.lookTarget` as an optional {level,x,y,z}; the
    // method below also carries those fields (the current look point).
    const lt = (maxDist, opts) => this._look.target(maxDist, opts);
    this.lookTarget = lt;
  }
  init() {
    const sp = LAYOUT.spawns[params.spawn] || LAYOUT.spawns.start;
    this.body.x = sp.x; this.body.z = sp.z; this.body.level = sp.level; this.yaw = sp.yaw || 0;
    if (params.pos) {
      const [x, z, lv] = params.pos; this.body.x = parseFloat(x); this.body.z = parseFloat(z); if (lv) this.body.level = lv;
    }
    if (params.yaw != null) this.yaw = params.yaw;
    if (params.pitch != null) this.pitch = params.pitch;
    this.body.ramp = -1;
    this.ctx.world.move(this.body, 0, 0, this.radius);
    this._lastYaw = this.yaw;
    const ev = this.ctx.events;
    ev.on('phone:open', () => { this.phoneOpen = true; });
    ev.on('phone:close', () => { this.phoneOpen = false; });
    ev.on('player:teleport', () => this._resetMotion());
    this._locate(true);
    this.head.update(0, this._headState(0));
  }
  get position() { return this.body; }
  get level() { return this.body.level; }
  get forward() { return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) }; }
  get right() { return { x: Math.cos(this.yaw), z: -Math.sin(this.yaw) }; }
  get bobScale() { return this.headBob; }
  set bobScale(v) { this.headBob = v; }
  get eyePosition() { return this.ctx.engine.camera.position; }
  lookRay(out) { return this._look.eyeRay(out); }
  addLookSource(fn) { this._look.sources.push(fn); return () => { const i = this._look.sources.indexOf(fn); if (i >= 0) this._look.sources.splice(i, 1); }; }
  registerInteractable(def) { return this.interactables.add(def); }
  // external impulse on the head (dy m/s, lateral m/s, roll rad/s, pitch rad/s)
  kick(dy, lateral, roll, pitch) { this.head.kick(dy, lateral, roll, pitch); }

  _resetMotion() {
    this.vel.set(0, 0); this.acc.set(0, 0);
    this._stair = null; this._support = null; this._standLatch = false; this._closing = false;
    this.riding = false; this.onStairs = false;
    this._lastYaw = this.yaw;
    this.head.reset();
  }

  // ---------------------------------------------------------------------------
  update(dt) {
    const { input, world, events } = this.ctx;
    if (this._camY == null) { this._resetMotion(); this._camY = 0; }
    // someone else zeroed our velocity (e.g. a ticket gate refusing us): drop momentum too
    if (this.vel.x === 0 && this.vel.y === 0 && (this._pvx || this._pvz)) this.acc.set(0, 0);
    dt = Math.min(dt, 0.1);
    this._bumpCd -= dt; this._t += dt;
    const S = input.settings || {};
    const b = this.body;

    // ---- look (raw, unaccelerated) --------------------------------------------
    if (!this.frozen) {
      const inv = S.invertY ? -1 : 1;
      this.yaw -= input.look.x * input.sensitivity + (input.lookRad ? input.lookRad.x : 0);
      this.pitch -= (input.look.y * input.sensitivity + (input.lookRad ? input.lookRad.y : 0)) * inv;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
    }
    let dYaw = this.yaw - this._lastYaw; this._lastYaw = this.yaw;
    if (dYaw > Math.PI) dYaw -= Math.PI * 2; else if (dYaw < -Math.PI) dYaw += Math.PI * 2;

    // ---- context ----------------------------------------------------------------
    const ramp = b.ramp >= 0 ? LAYOUT.ramps[b.ramp] : null;
    const conv = world.conveyor(b);
    const onEsc = !!(ramp && ramp.kind === 'escalator');
    const isStairs = !!(ramp && ramp.kind !== 'escalator');

    // ---- intent -----------------------------------------------------------------
    const mv = this.frozen ? { x: 0, y: 0 } : input.move;
    let mx = mv.x, my = mv.y;
    const mag = Math.min(1, Math.hypot(mx, my));
    const jog = !this.frozen && !!(input.jog || input.running);
    const shuffle = !this.frozen && !!input.shuffle && !jog;
    const slow = !this.frozen && !!input.slow;
    // escalator boarding latch: you step on and stand; release+press to walk
    if (onEsc) {
      if (this._standLatch) {
        if (mag < 0.05) { this._latchNeedsRelease = false; this._holdT = 0; }
        else {
          // a fresh press, Shift, or simply holding forward for a moment steps you into the left lane
          this._holdT += dt;
          if (!this._latchNeedsRelease || jog || this._holdT > 1.2) this._standLatch = false;
        }
      }
      // wedged on the belt (someone ahead, a wall of people at the foot): drop the latch so W walks you off
      this._stuckT = onEsc && this.speed < 0.08 && Math.abs(conv ? conv.x + conv.z : 1) > 0 ? (this._stuckT || 0) + dt : 0;
      if (this._standLatch && this._stuckT > 1.0) this._standLatch = false;
      if (this._standLatch) { mx = 0; my = 0; }
    }
    const f = this.forward, r = this.right;
    let wx = f.x * my + r.x * mx, wz = f.z * my + r.z * mx;
    const wl = Math.hypot(wx, wz);
    let top = jog ? MOVE.jog : shuffle ? MOVE.shuffle : slow ? MOVE.slow : MOVE.walk;
    if (this.phoneOpen) top = Math.min(top, jog ? MOVE.phoneJog : MOVE.phone);
    // ellipse: slower backwards and sideways
    if (wl > 1e-4) {
      const lx = mx / Math.max(1e-4, Math.hypot(mx, my)), ly = my / Math.max(1e-4, Math.hypot(mx, my));
      const fy = ly >= 0 ? 1 : MOVE.back;
      top *= 1 / Math.hypot(lx / MOVE.strafe, ly / fy) || 1;
    }
    // terrain: stairs flights are slower (more going up), walking on escalators
    let terrain = 1;
    if (isStairs) {
      const along = rampAlong(ramp, b.x, b.z);
      const ax = ramp.axis === 'x' ? 1 : 0;
      const axDir = ramp.up;   // +1/-1 along world axis = up direction
      const vAx = (ax ? wx : wz) * axDir;            // + = intends to go up
      // look ahead so we slow at the first riser, not after it
      const la = along + Math.sign(vAx || 1) * 0.45;
      const slope = rampSlope(ramp, Math.max(0, la));
      if (Math.abs(slope) > 0.08) {
        const goingUp = vAx > 0;
        const fac = goingUp ? MOVE.stairsUp : MOVE.stairsDown;
        const axisShare = Math.abs(vAx) / Math.max(1e-4, wl);
        terrain = 1 + (fac - 1) * axisShare;
        if (jog) terrain *= goingUp ? 1.05 : 0.92;
      }
    } else if (onEsc) terrain = MOVE.escWalk;
    const target = wl > 1e-4 ? top * terrain * mag / wl : 0;
    let tvx = wx * target, tvz = wz * target;
    const walls = this._wallsNear(this.radius + 0.6);
    const defl = this._deflect(walls, tvx, tvz);
    if (defl) { tvx = defl.x; tvz = defl.z; }

    // ---- momentum follows the view while you keep walking ------------------------
    if (wl > 1e-4 && dYaw !== 0) {
      const a = -dYaw * MOVE.turnCarry, c = Math.cos(a), s = Math.sin(a);
      // rotate in x/z: yaw +ve turns left (towards -x when facing -z)
      const rot = (v) => { const x = v.x * c - v.y * s, z = v.x * s + v.y * c; v.x = x; v.y = z; };
      rot(this.vel); rot(this.acc);
    }

    // ---- velocity spring ---------------------------------------------------------
    const tl = Math.hypot(tvx, tvz), vl = this.vel.length();
    const P = shuffle ? MOVE.shuffle : tl < 1e-4 || tl < vl - 0.05 ? MOVE.brake : jog ? MOVE.accelJog : MOVE.accel;
    const n = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / n;
    for (let i = 0; i < n; i++) {
      let jx = (P.w * P.w * (tvx - this.vel.x) - 2 * P.w * this.acc.x) * h;
      let jz = (P.w * P.w * (tvz - this.vel.y) - 2 * P.w * this.acc.y) * h;
      const jl = Math.hypot(jx, jz), jm = P.j * h;
      if (jl > jm) { jx *= jm / jl; jz *= jm / jl; }
      this.acc.x += jx; this.acc.y += jz;
      const al = this.acc.length(); if (al > P.a) this.acc.multiplyScalar(P.a / al);
      this.vel.x += this.acc.x * h; this.vel.y += this.acc.y * h;
    }
    if (tl < 1e-4 && this.vel.lengthSq() < 1e-6 && this.acc.lengthSq() < 1e-4) { this.vel.set(0, 0); this.acc.set(0, 0); }

    // ---- walls: ease into them instead of stopping dead -------------------------
    if (walls.length) this._wallEase(walls);

    // ---- displacement -----------------------------------------------------------
    let dx = this.vel.x * dt, dz = this.vel.y * dt;
    let cx = 0, cz = 0;
    if (conv) { cx = conv.x * dt; cz = conv.z * dt; }
    // escalator lane keeping: stand right, walk left (Osaka)
    let drx = 0, drz = 0;
    if (onEsc && conv) {
      const cl = Math.hypot(conv.x, conv.z) || 1;
      const tx = conv.x / cl, tz = conv.z / cl;          // travel dir
      const rgx = -tz, rgz = tx;                          // right of travel
      const ctrX = (ramp.rect[0] + ramp.rect[2]) / 2, ctrZ = (ramp.rect[1] + ramp.rect[3]) / 2;
      const u = (b.x - ctrX) * rgx + (b.z - ctrZ) * rgz;
      const walking = this.vel.length() > 0.25;
      const lim = ramp.walkWidth / 2 - this.radius - 0.02;
      const want = Math.max(-lim, Math.min(lim, walking ? -STAND_U : STAND_U));
      const latIn = Math.abs(mx) > 0.2;                  // player steering sideways: don't fight
      if (!latIn) {
        const vd = Math.max(-0.12, Math.min(0.12, (want - u) * 0.9));
        drx = rgx * vd * dt; drz = rgz * vd * dt;
      }
    }
    // crowd soft collisions
    let px = 0, pz = 0;
    const pushed = this._crowd(dt, tvx, tvz);
    if (pushed) { px = pushed.x; pz = pushed.z; }

    const prevLevel = b.level, prevRamp = b.ramp;
    const ox = b.x, oz = b.z;
    const ix = dx + cx + drx + px, iz = dz + cz + drz + pz;
    world.move(b, ix, iz, this.radius);
    const ax_ = b.x - ox, az_ = b.z - oz;
    this.speed = Math.hypot(ax_, az_) / Math.max(dt, 1e-4);

    // ---- collision-aware velocity: drop the blocked component ---------------------
    const bx = ix - ax_, bz = iz - az_;
    const bl = Math.hypot(bx, bz);
    if (bl > 1e-5 && b.ramp === prevRamp) {
      const nx = bx / bl, nz = bz / bl;
      const vn = this.vel.x * nx + this.vel.y * nz;
      if (vn > 0) {
        this.vel.x -= nx * vn; this.vel.y -= nz * vn;
        // walked into something solid: a small, quick jolt (no camera shake)
        if (vn > 0.7 && this._bumpCd <= 0) {
          const s_ = Math.min(1, (vn - 0.5) / 2.5) * this._bobScale();
          this.head.kick(-0.05 * s_, 0, 0, 0.06 * s_);
          this._bumpCd = 0.5;
          events.emit('player:bump', { kind: 'wall', speed: vn, x: b.x, z: b.z, level: b.level });
        }
      }
      const an = this.acc.x * nx + this.acc.y * nz;
      if (an > 0) { this.acc.x -= nx * an; this.acc.y -= nz * an; }
    }
    this.walkSpeed = this.vel.length();

    // ---- ramp transitions ---------------------------------------------------------
    if (b.ramp !== prevRamp) {
      const newRamp = b.ramp >= 0 ? LAYOUT.ramps[b.ramp] : null;
      const oldRamp = prevRamp >= 0 ? LAYOUT.ramps[prevRamp] : null;
      // keep total velocity continuous across the comb plate
      const nc = world.conveyor(b);
      if (conv) { this.vel.x += conv.x; this.vel.y += conv.z; }
      if (nc) { this.vel.x -= nc.x; this.vel.y -= nc.z; }
      // re-capture at a ramp mouth (crowd, a wall of people, dithering on the comb plate):
      // no latch, kick or land event for entries/exits within a second of each other
      const recap = !!(newRamp && this._lastLand && this._lastLand.ramp === newRamp && this._t - this._lastLand.t < 1.0);
      const quick = !!(oldRamp && this._t - this._enterT < 1.0 && this._lastLand && this._lastLand.ramp === oldRamp);
      if (newRamp) { if (!recap) this._enterT = this._t; else this._enterT = this._t - 0.5; }
      if (newRamp && newRamp.kind === 'escalator' && !recap) {
        this._standLatch = true; this._latchNeedsRelease = mag > 0.05; this._holdT = 0;
        this.head.kick(-0.05 * this._bobScale(), 0, 0, 0);
      }
      if (oldRamp) {
        const dir = b.level === oldRamp.upper ? 'up' : 'down';
        const kind = oldRamp.kind === 'escalator' ? 'escalator' : 'stairs';
        // the last tread's lift already gave a bump: don't double it
        const struck = this._t - this._strikeT < 0.25;
        this._lastLand = { ramp: oldRamp, t: this._t };
        if (!quick) {
          if (!struck) this.head.kick((kind === 'escalator' ? -0.09 : dir === 'up' ? -0.07 : -0.1) * Math.max(0.35, this._bobScale()), 0, 0, 0);
          events.emit('player:land', { kind, dir, ramp: oldRamp, level: b.level, surface: surfaceOf(this.ctx.world.spaceAt(b.level, b.x, b.z), null) });
        }
      }
      events.emit('player:ramp', { ramp: newRamp, entering: !!newRamp, from: oldRamp });
    }
    if (b.level !== prevLevel) events.emit('player:level', { from: prevLevel, to: b.level });

    // ---- context after the move ---------------------------------------------------
    const rampNow = b.ramp >= 0 ? LAYOUT.ramps[b.ramp] : null;
    this.riding = !!(rampNow && rampNow.kind === 'escalator' && rampNow.move);
    this.onStairs = !!(rampNow && rampNow.kind !== 'escalator');

    // ---- steps & support height ---------------------------------------------------
    this._steps(dt, rampNow, mag, jog, slow);

    this._locate(false);
    this._lookUpdate();
    const st = this._headState(dt);
    this.head.update(dt, st);
    this._camY = this.head.y;
    this._pvx = this.vel.x; this._pvz = this.vel.y;
  }
  _bobScale() {
    const S = this.ctx.input.settings || {};
    return (this.headBob != null ? this.headBob : 1) * (S.headBob != null ? S.headBob : 1) * (S.reduceMotion ? 0.2 : 1);
  }

  _gaitAmp() {
    const v = this.walkSpeed;
    // 0 standing, 1 at a normal walk, ~1.9 jogging
    return v < 0.05 ? 0 : v <= MOVE.walk ? Math.pow(v / MOVE.walk, 1.2) : 1 + (v - MOVE.walk) / (MOVE.jog - MOVE.walk) * 0.9;
  }
  _headState(dt) {
    const b = this.body;
    const r = this.right;
    return {
      targetY: this._support != null ? this._support : b.y,
      stairs: this._support != null,
      gaitAmp: this._gaitAmp(),
      stepPhase: this.stepPhase,
      jog: Math.max(0, Math.min(1, (this.walkSpeed - MOVE.walk) / (MOVE.jog - MOVE.walk))),
      phone: this.phoneOpen,
      strafeSpeed: this.vel.x * r.x + this.vel.y * r.z,
      riding: this.riding && this.walkSpeed < 0.3,
    };
  }

  // Footsteps. Flat ground: phase advances with own speed / stride. Stair
  // flights: a heel strike whenever the leading foot reaches a new tread (two
  // at a time when jogging up), and the head's support height jumps to that
  // tread — the head spring turns that into a lift per step.
  _steps(dt, ramp, mag, jog, slow) {
    const b = this.body;
    const v = this.walkSpeed;
    const prevPhase = this.stepPhase;
    let strike = false, final = false;
    const stairs = ramp && ramp.kind !== 'escalator' ? ramp : null;
    let flight = false;
    if (stairs) {
      const a = rampAlong(stairs, b.x, b.z);
      const vAx = (stairs.axis === 'x' ? this.vel.x : this.vel.y) * stairs.up;
      let st = this._stair;
      if (!st || st.ramp !== stairs) st = this._stair = { ramp: stairs, lastIdx: null, treads: 0, dir: vAx >= 0 ? 1 : -1 };
      if (Math.abs(vAx) > 0.12) st.dir = vAx > 0 ? 1 : -1;
      const lead = a + st.dir * 0.12;
      const { index, depth } = stairTread(stairs, lead);
      // on the flight proper (risers ahead or underfoot), not the landings
      flight = Math.abs(rampSlope(stairs, lead)) > 0.08;
      if (this._support == null) this._support = stairSurfaceY(stairs, a);
      if (st.lastIdx == null) st.lastIdx = index;
      if (flight) {
        const per = jog && st.dir > 0 ? 2 : 1;            // two at a time when hurrying up
        if (st.need == null) st.need = per;
        const vA = Math.abs(vAx);
        const nominal = vA / (depth * per);
        if (index !== st.lastIdx) {
          st.treads += Math.abs(index - st.lastIdx); st.lastIdx = index;
          if (st.treads >= st.need || v < 0.3) { st.treads = 0; st.need = per; strike = true; st.struck = true; }
        }
        if (strike) this._support = stairSurfaceY(stairs, (index + 0.5) * depth);
        // steer the bob phase so it reaches the next integer exactly when the
        // leading foot reaches the tread it will land on; if that tread comes
        // too soon for the stride in progress, the stride takes one more tread
        const toEdge = st.dir > 0 ? (index + 1) * depth - lead : lead - index * depth;
        if (!strike && vA > 0.05) {
          const want = Math.ceil(this.stepPhase + 1e-6) - this.stepPhase;
          let remain = Math.max(0.005, toEdge + Math.max(0, st.need - 1 - st.treads) * depth);
          if (!st.struck && want / (remain / vA) > 1.3 * nominal && st.need < per + 1) { st.need++; remain += depth; }
          const rate = Math.max(0.35 * nominal, Math.min(1.5 * nominal, want / (remain / vA)));
          this.stepPhase = Math.min(this.stepPhase + rate * dt, Math.ceil(this.stepPhase + 1e-6) - 1e-4);
        }
        if (strike) this.stepPhase = Math.max(Math.round(this.stepPhase), Math.floor(prevPhase) + 1);
        this.gait = st.dir > 0 ? 'stairs_up' : 'stairs_down';
      } else {
        st.lastIdx = index; st.treads = 0; st.need = null; st.struck = false;
        // landing: the support follows the (flat) surface continuously
        this._support = stairSurfaceY(stairs, a);
      }
    } else { this._stair = null; this._support = null; }
    if (!flight) {
      const riding = this.riding;
      if (v > 0.12) {
        this._closing = false;
        // first step from rest lands after ~0.2 s, not a full stride later
        if ((prevPhase === 0 || this._fromRest) && this.head.amp < 0.03) this.stepPhase = Math.max(this.stepPhase, Math.floor(this.stepPhase) + 0.6);
        this._fromRest = false;
        this.stepPhase += dt * v / stepLength(v);
      } else if (mag < 0.05 && this.stepPhase % 1 > 1e-3) {
        // closing step: finish the stride you were in
        this._closing = true;
        this.stepPhase = Math.min(Math.floor(this.stepPhase) + 1, this.stepPhase + dt * Math.max(1.6, v / stepLength(0.5)));
        if (this.stepPhase === Math.floor(this.stepPhase)) final = true;
      } else if (v < 0.02) this._fromRest = true;
      if (Math.floor(this.stepPhase) !== Math.floor(prevPhase)) strike = true;
      this.gait = riding && v < 0.3 ? 'ride' : v < 0.1 ? 'stand' : v > MOVE.walk + 0.4 ? 'jog' : v < 1.05 ? 'slow' : 'walk';
    }
    this.bobPhase = this.stepPhase * Math.PI;
    if (strike) {
      this._strikeT = this._t;
      const loc = this.ctx.world.locate(b);
      const surface = surfaceOf(loc.space, loc.ramp);
      const intensity = Math.min(1.5, final ? 0.35 : 0.3 + v / MOVE.walk * 0.55 + (this.gait === 'stairs_down' ? 0.15 : 0));
      // heel strike weight (scaled down by the head-bob setting in HeadCam)
      const bob = this._bobScale();
      this.head.kick(-(0.02 + 0.03 * Math.min(2, v / MOVE.walk)) * bob, 0, 0, 0);
      this.ctx.events.emit('player:step', {
        foot: Math.floor(this.stepPhase) & 1, surface, speed: v, gait: this.gait, intensity, final,
        level: b.level, space: loc.space, ramp: loc.ramp, x: b.x, y: b.y, z: b.z,
      });
    }
  }

  // Soft collisions with crowd agents (guarded: crowd may not expose this).
  // Your intent always wins at walking pace: people can slow you, bump you and
  // you slip past them, but they never carry you sideways or across a ramp
  // mouth. Push is capped (0.6 m/s along your intent, 0.15 m/s across it, 0.3 m/s
  // when standing); nudges from people walking into you are small and
  // only along the contact normal.
  _crowd(dt, tvx, tvz) {
    const crowd = this.ctx.crowd;
    if (!crowd || typeof crowd.agentsNear !== 'function') return null;
    const b = this.body;
    let list;
    try { list = crowd.agentsNear(b.level, b.x, b.z, 1.4); } catch (e) { return null; }
    if (!list || !list.length) { this._pushBlockT = 0; return null; }
    const onRamp = b.ramp >= 0;
    const tl = Math.hypot(tvx, tvz);
    const ix = tl > 0.05 ? tvx / tl : 0, iz = tl > 0.05 ? tvz / tl : 0;   // intent direction
    let px = 0, pz = 0, hit = null, hitSp = 0, blocked = false, bdx = 0, bdz = 0;
    for (const a of list) {
      if (!a || a === this) continue;
      // on a ramp only people on it count; off it, people riding an escalator beside us don't
      if (onRamp ? a.onRamp === false : (a.onRamp && a.y != null && Math.abs(a.y - b.y) > 0.5)) continue;
      if (a.y != null && Math.abs(a.y - b.y) > 1.0) continue;
      const ar = a.radius != null ? a.radius : a.r != null ? a.r : 0.25;
      const dx = b.x - a.x, dz = b.z - a.z;
      const d = Math.hypot(dx, dz), R = this.radius + ar;
      if (d < 1e-5 || d > R + 0.5) continue;
      const nx = dx / d, nz = dz / d;
      const avx = a.vx || 0, avz = a.vz || 0;
      const own = -(this.vel.x * nx + this.vel.y * nz);               // our speed into them
      const ahead = ix * -nx + iz * -nz;                               // 1 = they are straight ahead of our intent
      if (own > 0.2 && ahead > 0.5 && d < R + 0.35) { blocked = true; bdx = -nx; bdz = -nz; }
      if (d >= R) {
        // personal space: ease off before contact (people don't walk into each other at full speed)
        if (own > 0) {
          const k = Math.min(1, dt * 7 * (1 - (d - R) / 0.5));
          this.vel.x += nx * own * k; this.vel.y += nz * own * k;
          if (tl > 0.05) this._sidestep(nx, nz, own * k * 0.6);
        }
        continue;
      }
      const ov = R - d;
      // positional correction: soft, eased, and capped (applied below)
      const k = Math.min(1, dt * 14);
      px += nx * ov * k; pz += nz * ov * k;
      // you can't walk through people: remove most of your closing velocity, damp the rest
      if (own > 0) { this.vel.x += nx * own * 0.6; this.vel.y += nz * own * 0.6; this.acc.multiplyScalar(0.5); if (tl > 0.05) this._sidestep(nx, nz, own * 0.35); }
      // someone walking into you gives a small nudge along the contact normal
      const theirs = (avx * -nx + avz * -nz);                          // their speed into us (≥0)
      if (theirs > 0.3) { const nud = Math.min(0.35, theirs * 0.25); const cur = this.vel.x * nx + this.vel.y * nz; if (cur < nud) { this.vel.x += nx * (nud - cur) * Math.min(1, dt * 6); this.vel.y += nz * (nud - cur) * Math.min(1, dt * 6); } }
      this.vel.multiplyScalar(1 - Math.min(0.5, dt * 3));
      const rel = own + theirs;
      if (rel > hitSp) { hitSp = rel; hit = { a, nx, nz }; }
    }
    if (hit && hitSp > 0.25 && this._bumpCd <= 0) {
      this._bumpCd = 0.6;
      const r = this.right;
      const side = hit.nx * r.x + hit.nz * r.z;
      const s = Math.min(1, hitSp / 1.5) * this._bobScale();
      this.head.kick(-0.06 * s, side * 0.25 * s, -side * 0.15 * s, -0.05 * s);
      this.ctx.events.emit('player:bump', { kind: 'person', agent: hit.a, speed: hitSp, x: this.body.x, z: this.body.z, level: this.body.level });
      if (typeof crowd.onPlayerBump === 'function') { try { crowd.onPlayerBump(hit.a, hitSp); } catch (e) { /* ignore */ } }
    }
    // held forward into a cluster: ask people to make way (crowd.requestPass, optional)
    if (blocked && this.speed < 0.3) this._pushBlockT += dt; else this._pushBlockT = Math.max(0, this._pushBlockT - dt * 2);
    if (this._pushBlockT > 0.8 && this._t - this._passT > 0.5 && typeof crowd.requestPass === 'function') {
      this._passT = this._t;
      try { crowd.requestPass(b, { x: bdx, z: bdz }); } catch (e) { /* ignore */ }
    }
    // cap the push: ≤ 0.6 m/s along the intent axis, ≤ 0.15 m/s across it; ≤ 0.3 m/s if standing
    let pl = Math.hypot(px, pz);
    if (pl < 1e-9) return null;
    if (tl > 0.05) {
      const al = px * ix + pz * iz;
      let lx = px - ix * al, lz = pz - iz * al;
      const ll = Math.hypot(lx, lz), lm = 0.15 * dt;
      if (ll > lm) { lx *= lm / ll; lz *= lm / ll; }
      const am = 0.6 * dt, ac = Math.max(-am, Math.min(am, al));
      px = ix * ac + lx; pz = iz * ac + lz;
    } else {
      const m = 0.3 * dt; if (pl > m) { px *= m / pl; pz *= m / pl; }
    }
    // never shove the body into a stair/escalator mouth it isn't walking into
    if (!onRamp && this._inRampRect(b.level, b.x + px, b.z + pz) && !this._inRampRect(b.level, b.x, b.z)) return null;
    return { x: px, z: pz };
  }
  _inRampRect(level, x, z) {
    let list = (this._rampRects || (this._rampRects = {}))[level];
    if (!list) {
      list = this._rampRects[level] = [];
      for (const r of LAYOUT.ramps) if (r.lower === level || r.upper === level) list.push(r.rect);
    }
    for (const r of list) if (x >= r[0] - 0.05 && x < r[2] + 0.05 && z >= r[1] - 0.05 && z < r[3] + 0.05) return true;
    return false;
  }

  // collision segments (walls, rails, obstacles, ramp sides) within maxD of the body
  _wallsNear(maxD) {
    const world = this.ctx.world, b = this.body;
    const out = this._walls || (this._walls = []); out.length = 0;
    const test = (s) => {
      const ex = s[2] - s[0], ez = s[3] - s[1];
      const l2 = ex * ex + ez * ez;
      let t = l2 > 0 ? ((b.x - s[0]) * ex + (b.z - s[1]) * ez) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = b.x - (s[0] + ex * t), qz = b.z - (s[1] + ez * t);
      const d = Math.hypot(qx, qz);
      if (d < maxD && d > 1e-6) out.push({ d, nx: qx / d, nz: qz / d, s, t, len: Math.sqrt(l2) });
    };
    if (b.ramp >= 0) { const segs = world.rampSegs[b.ramp]; if (segs) for (const s of segs) test(s); return out; }
    const H = world.hash && world.hash[b.level], all = world.segs && world.segs[b.level];
    if (!H || !all) return out;
    const x0 = Math.floor((b.x - maxD) / H.size), x1 = Math.floor((b.x + maxD) / H.size);
    const z0 = Math.floor((b.z - maxD) / H.size), z1 = Math.floor((b.z + maxD) / H.size);
    const seen = this._seenSegs || (this._seenSegs = new Set()); seen.clear();
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const bucket = H.map.get(x * 73856093 ^ z * 19349663);
      if (bucket) for (const i of bucket) if (!seen.has(i)) { seen.add(i); test(all[i]); }
    }
    return out;
  }

  // Short faces you walk straight into — a pillar, the 1 m step of a
  // rasterised diagonal wall — are stepped around the way people do: the
  // intent is turned along the face towards its open (convex) end.
  // Returns a replacement target velocity or null.
  _deflect(walls, tvx, tvz) {
    const tl = Math.hypot(tvx, tvz);
    this._deflSeg = null;
    if (tl < 0.2) return null;
    const b = this.body, world = this.ctx.world;
    let best = null;
    for (const w of walls) {
      if (w.d - this.radius > 0.45 || w.len > 1.6) continue;
      if (w.t <= 0 || w.t >= 1) continue;                     // corner contact already deflects
      const head = -(tvx * w.nx + tvz * w.nz) / tl;
      if (head < 0.82) continue;
      const s = w.s, ex = (s[2] - s[0]) / w.len, ez = (s[3] - s[1]) / w.len;
      for (const end of [0, 1]) {
        const px = end ? s[2] : s[0], pz = end ? s[3] : s[1];
        const dir = end ? 1 : -1;
        const along = Math.abs((end ? 1 - w.t : w.t) * w.len);
        if (along > 1.1) continue;
        // open end? the space just past it, behind the face plane, must be walkable
        const qx = px + ex * dir * 0.45 - w.nx * 0.45, qz = pz + ez * dir * 0.45 - w.nz * 0.45;
        if (!world.isWalkable(b.level, qx, qz)) continue;
        if (!best || along < best.along) best = { along, tx: ex * dir, tz: ez * dir, w, wt: Math.min(1, Math.max(0, 1 - (w.d - this.radius - 0.08) / 0.37)) };
      }
    }
    this._deflSeg = best ? best.w.s : null;
    if (best) { this._deflTx = best.tx; this._deflTz = best.tz; }
    if (!best) return null;
    // keep most of the speed, sliding along the face toward the open end;
    // blend in as the face gets close (people start veering ~0.4 m out)
    const k = tl * 0.85, wt = best.wt;
    const dx = best.tx * k - best.w.nx * 0.05, dz = best.tz * k - best.w.nz * 0.05;
    return { x: tvx + (dx - tvx) * wt, z: tvz + (dz - tvz) * wt };
  }

  // People don't walk face-first into walls: for every wall within ~0.6 m that
  // we are heading into (within 50° of head-on) the closing speed is capped by
  // the remaining gap, so even a jog ends in a short, firm, non-instant stop.
  // Grazing approaches and wall slides are untouched.
  _wallEase(walls) {
    const v2 = this.vel.lengthSq();
    if (v2 < 0.04) return;
    for (const w of walls) {
      const gap = Math.max(0, w.d - this.radius);
      if (gap > 0.6) continue;
      const around = w.s === this._deflSeg;              // being stepped around
      const closing = -(this.vel.x * w.nx + this.vel.y * w.nz);
      if (closing <= 0) continue;
      const head = closing / Math.sqrt(this.vel.lengthSq() || 1);
      if (head < 0.64) continue;
      const cap = 0.12 + gap * 5;
      if (closing > cap) {
        const cut = closing - cap;
        this.vel.x += w.nx * cut; this.vel.y += w.nz * cut;
        // stepping around a short face: the speed we take off goes sideways instead
        if (around) { this.vel.x += this._deflTx * cut * 0.8; this.vel.y += this._deflTz * cut * 0.8; }
        const an = -(this.acc.x * w.nx + this.acc.y * w.nz);
        if (an > 0) { this.acc.x += w.nx * an; this.acc.y += w.nz * an; }
      }
    }
  }

  // slip past someone: turn part of the blocked closing speed into a sidestep
  // towards whichever side of them we're already on
  _sidestep(nx, nz, amount) {
    const tx = -nz, tz = nx;                      // tangent
    const vt = this.vel.x * tx + this.vel.y * tz;
    const side = Math.abs(vt) > 0.02 ? Math.sign(vt) : (this._lastSide || 1);
    this._lastSide = side;
    if (Math.abs(vt) < 0.7) { this.vel.x += tx * side * amount; this.vel.y += tz * side * amount; }
  }

  _lookUpdate() {
    this._lookFrame = (this._lookFrame || 0) + 1;
    if (this._lookFrame % 3) return; // ~20 Hz is plenty
    try {
      const P = this._look.updatePoint(8);
      const lt = this.lookTarget; lt.level = P.level; lt.x = P.x; lt.y = P.y; lt.z = P.z;
    } catch (e) { /* world not ready */ }
  }

  _locate(initial) {
    const loc = this.ctx.world.locate(this.body);
    if (loc.zone && loc.zone !== this.zone) {
      const from = this.zone; this.zone = loc.zone;
      if (!initial) this.ctx.events.emit('player:zone', { from, to: loc.zone, space: loc.space });
    }
    this.space = loc.space;
  }
}
