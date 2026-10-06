// Head / camera motion: step-locked bob (vertical double bounce, lateral sway,
// slight roll), heel-strike weight, idle breathing, stair lifts (a fast
// spring on discrete support heights), landing dips, bump jolts, escalator
// hum, phone glance, jog FOV. Everything is additive on top of the body pose
// and bounded so the eye never leaves the collision circle by > 3 cm.

// damped spring state {x, v}; target 0. zeta 1 = critical.
function spring(s, w, zeta, dt) {
  const n = Math.max(1, Math.ceil(dt / (1 / 240)));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    s.v += (-w * w * s.x - 2 * zeta * w * s.v) * h;
    s.x += s.v * h;
  }
}
// cheap smooth 1-D value noise
function vnoise(t, seed) {
  const i = Math.floor(t), f = t - i;
  const h = k => { const x = Math.sin((k + seed * 57.13) * 127.1) * 43758.5453; return x - Math.floor(x); };
  const u = f * f * (3 - 2 * f);
  return (h(i) * (1 - u) + h(i + 1) * u) * 2 - 1;
}
const MAX_SWAY = 0.03; // m — body radius 0.28 → eye stays ≥ 0.25 m from any wall

export class HeadCam {
  constructor(player) {
    this.p = player;
    this.reset();
  }
  reset() {
    this.supOff = { x: 0, v: 0 };      // stair support offset (head base - target)
    this.dip = { x: 0, v: 0 };         // vertical impulses (heel strike, landing, bump)
    this.lat = { x: 0, v: 0 };         // lateral impulses (bump)
    this.rollK = { x: 0, v: 0 };       // roll impulses
    this.pitchK = { x: 0, v: 0 };      // pitch impulses
    this.amp = 0;                       // smoothed gait amplitude 0..1+
    this.jogK = 0;                      // smoothed jog factor (FOV)
    this.glance = 0;                    // smoothed phone glance 0..1
    this.strafe = 0;                    // smoothed lateral speed (roll)
    this.ride = 0;                      // smoothed escalator riding factor
    this.t = 0;
    this._lastTarget = null;
    this.y = null;
  }
  kick(dy = 0, lateral = 0, roll = 0, pitch = 0) {
    this.dip.v += dy; this.lat.v += lateral; this.rollK.v += roll; this.pitchK.v += pitch;
  }
  // st: { targetY, stairs, gaitAmp, stepPhase, jog, phone, strafeSpeed, riding }
  update(dt, st) {
    const p = this.p, cam = p.ctx.engine.camera, S = p.ctx.input.settings || {};
    const reduce = !!S.reduceMotion;
    const bobScale = p._bobScale ? p._bobScale() : 1;
    this.t += dt;
    const k = (w) => 1 - Math.exp(-dt * w);

    // --- support height: continuous targets pass straight through, jumps
    // (stair treads, teleports) are absorbed by a spring offset.
    if (this._lastTarget == null || dt === 0) { this._lastTarget = st.targetY; this.supOff.x = 0; this.supOff.v = 0; }
    const jump = st.targetY - this._lastTarget;
    this._lastTarget = st.targetY;
    if (Math.abs(jump) > 2) { this.supOff.x = 0; this.supOff.v = 0; }       // teleport / level snap
    else if (st.stairs || Math.abs(jump) > 0.04) this.supOff.x -= jump;      // discrete lift
    const up = this.supOff.x < 0;
    spring(this.supOff, up ? 13 : 15, 1, dt);
    this.supOff.x = Math.max(-0.6, Math.min(0.6, this.supOff.x));

    spring(this.dip, 11, 0.55, dt);
    spring(this.lat, 9, 0.6, dt);
    spring(this.rollK, 9, 0.5, dt);
    spring(this.pitchK, 10, 0.6, dt);
    this.dip.x = Math.max(-0.08, Math.min(0.04, this.dip.x));

    // --- gait bob
    this.amp += (st.gaitAmp - this.amp) * k(st.gaitAmp > this.amp ? 5 : 7);
    const ph = st.stepPhase;
    const sn = Math.sin(Math.PI * ph);
    const hArc = 0.6 * Math.abs(sn) + 0.4 * sn * sn;        // 0 at heel strike, 1 mid-stance
    const A = this.amp * bobScale;
    const bobY = (hArc - 0.55) * 0.024 * A * (st.stairs ? 0.35 : 1);
    const swayX = sn * 0.011 * Math.min(1.4, A) * (st.stairs ? 0.6 : 1);
    const stepRoll = reduce ? 0 : sn * 0.0042 * Math.min(1.4, A);

    // --- idle breathing + micro head drift (fades with motion)
    const idle = Math.max(0, 1 - this.amp * 1.6) * (st.riding ? 0.7 : 1) * (reduce ? 0 : 1);
    const br = Math.sin(this.t * Math.PI * 2 * 0.22);
    const breathY = br * 0.0035 * idle;
    const breathPitch = (br * 0.0012 + vnoise(this.t * 0.35, 1) * 0.0016) * idle;
    const driftYaw = vnoise(this.t * 0.27, 2) * 0.0018 * idle;

    // --- escalator hum (belt + step joints), only when riding
    this.ride += ((st.riding ? 1 : 0) - this.ride) * k(4);
    const hum = reduce ? 0 : this.ride;
    const vibY = hum * (vnoise(this.t * 24, 3) * 0.0006 + Math.sin(this.t * Math.PI * 2 * 1.25) * 0.0007);
    const vibRoll = hum * vnoise(this.t * 9, 4) * 0.0005;

    // --- strafe lean, jog FOV, phone glance
    this.strafe += (st.strafeSpeed - this.strafe) * k(5);
    const lean = reduce ? 0 : -this.strafe * 0.0045;
    this.jogK += ((st.jog || 0) - this.jogK) * k(st.jog > this.jogK ? 2.5 : 3.5);
    this.glance += ((st.phone ? 1 : 0) - this.glance) * k(st.phone ? 3.5 : 5);

    // --- compose
    const yaw = p.yaw, rx = Math.cos(yaw), rz = -Math.sin(yaw); // camera right vector
    let side = swayX + this.lat.x;
    side = Math.max(-MAX_SWAY, Math.min(MAX_SWAY, side));
    const b = p.body;
    const y = st.targetY + this.supOff.x + p.eye + bobY + this.dip.x + breathY + vibY - this.glance * 0.025;
    this.y = y;
    cam.position.set(b.x + rx * side, y, b.z + rz * side);
    const pitch = p.pitch - this.glance * 0.14 + breathPitch + this.pitchK.x;
    cam.rotation.set(Math.max(-1.52, Math.min(1.52, pitch)), yaw + driftYaw, (reduce ? 0 : stepRoll + this.rollK.x) + lean + vibRoll);
    const fov = (S.fov || 72) + (reduce ? 0 : this.jogK * 3.5);
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    if (cam.near !== 0.05) { cam.near = 0.05; cam.updateProjectionMatrix(); }
  }
}
