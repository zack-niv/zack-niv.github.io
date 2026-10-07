// =============================================================================
// Lodestone — "am I on the right track?" (v3 item 10)
//
// Lodestone knows the true position and heading, so beyond the blue dot it
// keeps checking the player's ORIENTATION against the route and their
// PROGRESS along it:
//
//   headingErr  signed degrees from where you face to where the route goes
//               (a point ~6 m further along the path; + = it is to your right).
//               The instruction arrow (phone + glance strip) rotates by it, so it
//               literally points where to walk.
//   lost        metres of route progress lost: the route's remaining length now
//               minus the best (shortest) it has been. Walking the wrong way, into
//               a side hall, or up the wrong escalator all make it grow; walking
//               parallel to the drawn line in a wide hall does not (the route is
//               recomputed from where you are, so "distance to the line" would nag).
//
// States (with hysteresis, never spammy):
//   'on'        calm blue. Normal instructions.
//   'drifting'  moving with the heading > ~60° off for > 1.1 s (more slack right
//               before a turn / an escalator), or > 5 m of progress lost. Amber
//               tile + a sign: "Turn around" / "Turn left" / "Turn right".
//               Back to 'on' after ~0.7 s facing the right way (< 40°).
//   'off'       > 12 m of progress lost (incl. the wrong floor, which costs a ride
//               back): a short vibration (device rattle + glance flash + soft buzz,
//               at most once per 20 s), "Rerouting…" for ~1.1 s, then a fresh route
//   'rerouted'  "Rerouted · new route · N min" for ~2.6 s, then 'on'.
// Emits 'nav:track' {state, headingErr, lost} on every state change.
// Nothing runs while riding an escalator, near the destination, or pocketed.
// =============================================================================
import { LEVELS } from '../../world/layout.js';

const DEG = 180 / Math.PI;
const lvl = (l) => (LEVELS[l] ? LEVELS[l].label : l).replace('B1F', 'B1').replace('B2F', 'B2');
const LOOK = 6;              // m along the route for the heading target

export class Tracker {
  constructor(app) {
    this.app = app; this.ctx = app.ctx; this.phone = app.phone;
    this.reset();
    this.ctx.events.on('player:teleport', () => this.reset());
  }
  reset() {
    this.state = 'on'; this.err = 0; this.lost = 0; this.active = false;
    this._r = null; this._minRem = Infinity; this._target = null; this._levels = null; this._wrongFloor = null; this._why = '';
    this._driftT = 0; this._okT = 0; this._offT = 0; this._stateT = 0; this._cool = 0; this._tgtT = 0;
    this._lastBuzz = -1e9; this._t = 0;
  }

  _set(st) {
    if (st === this.state) return;
    this.state = st; this._stateT = 0; this._driftT = 0; this._okT = 0; this._offT = 0;
    this.ctx.events.emit('nav:track', { state: st, headingErr: Math.round(this.err), lost: Math.round(this.lost) });
    this.app._trackChanged && this.app._trackChanged(st);
  }

  // project the player onto the start of the route; the heading target is LOOK m further on
  _aim(R, body) {
    const P = R.pts; if (!P || P.length < 2) { this._target = null; return; }
    let best = Infinity, s0 = 0;
    for (let i = 1; i < P.length; i++) {
      const a = P[i - 1], b = P[i];
      if (a[3] > 40) break;
      const dx = b[0] - a[0], dz = b[2] - a[2], l2 = dx * dx + dz * dz;
      const t = l2 > 1e-6 ? Math.max(0, Math.min(1, ((body.x - a[0]) * dx + (body.z - a[2]) * dz) / l2)) : 0;
      const px = a[0] + dx * t, pz = a[2] + dz * t, d = Math.hypot(body.x - px, body.z - pz);
      if (d < best) { best = d; s0 = a[3] + (b[3] - a[3]) * t; }
    }
    const want = s0 + LOOK;
    for (let i = 1; i < P.length; i++) if (P[i][3] >= want) {
      const a = P[i - 1], b = P[i], t = (want - a[3]) / Math.max(1e-3, b[3] - a[3]);
      this._target = { x: a[0] + (b[0] - a[0]) * t, z: a[2] + (b[2] - a[2]) * t };
      return;
    }
    const l = P[P.length - 1]; this._target = { x: l[0], z: l[2] };
  }

  // relative bearing (deg, + = to the right) from the phone's heading to the target
  _bearing(body) {
    const T = this._target; if (!T) return null;
    const dx = T.x - body.x, dz = T.z - body.z;
    if (Math.hypot(dx, dz) < 1.2) return null;
    let d = Math.atan2(-dx, -dz) - this.phone.pos.heading;   // yaw convention: 0 = north (-Z), + turns left
    d = Math.atan2(Math.sin(d), Math.cos(d));
    return -d * DEG;
  }

  update(dt, R) {
    const ctx = this.ctx, pl = ctx.player, body = pl && pl.body;
    this._t += dt;
    if (this._cool > 0) this._cool -= dt;
    this.active = !!(R && R.ok && body && !this.app.arrived);
    if (!this.active) return;
    // a fresh route: progress bookkeeping
    if (R !== this._r) {
      this._r = R; this._tgtT = 0;
      if (isFinite(R.total)) { this._minRem = Math.min(this._minRem, R.total); this.lost = Math.max(0, R.total - this._minRem); }
      // the floors of the route we were following: stepping off onto another one is "wrong floor", even when the
      // new floor happens to have an equally short way (judged before the new route's floors are adopted)
      if (body.ramp < 0) {
        if (this._levels && !this._levels.has(body.level) && this.state !== 'off') this._wrongFloor = body.level;
        else if (!this._wrongFloor && R.legs) this._levels = new Set(R.legs.map(l => l.level));
      }
    }
    this._tgtT -= dt;
    if (this._tgtT <= 0) { this._tgtT = 0.1; this._aim(R, body); }
    const b = this._bearing(body);
    if (b != null) this.err = b;
    this._stateT += dt;

    const riding = body.ramp >= 0;
    const nearEnd = !(R.total > 10);
    if (riding || nearEnd) {
      // on the escalator / at the door: no judgement (and no stale anger after it)
      this._driftT = 0; this._offT = 0;
      if (nearEnd && this.state !== 'on') this._set('on');
      if (riding) this._minRem = Math.min(this._minRem, isFinite(R.total) ? R.total : this._minRem);
      return;
    }
    const moving = (pl.speed || 0) > 0.6;
    const cur = R.steps && R.steps[0];
    const turnSoon = cur && ((/^Turn/.test(cur.title || '') && cur.at < 9) || (cur.kind === 'ramp' && cur.at < 5) || (cur.kind === 'via' && cur.at < 6));
    const thr = turnSoon ? 105 : 60;
    const a = Math.abs(this.err);
    const headBad = moving && a > thr, headGood = a < 40;
    const lostBad = moving && this.lost > 5;
    const offNow = this.lost > 12 || !!this._wrongFloor;
    this._offT = offNow ? this._offT + dt : 0;
    const goOff = this._offT > 0.5 && this._cool <= 0;

    switch (this.state) {
      case 'rerouted':
        if (this._stateT > 2.6) { this._set('on'); break; }
        // fall through: drifting can start during the confirmation
      case 'on':
        if (goOff) { this._goOff(); break; }
        this._driftT = headBad || lostBad ? this._driftT + dt : Math.max(0, this._driftT - dt * 2);
        if (this._driftT > 1.1) this._set('drifting');
        break;
      case 'drifting':
        if (goOff) { this._goOff(); break; }
        this._okT = headGood && !(moving && this.lost > 5 && this._lostRising) ? this._okT + dt : 0;
        if (this._okT > 0.7) { this._minRem = isFinite(R.total) ? R.total : Infinity; this.lost = 0; this._set('on'); }
        break;
      case 'off':
        if (this._stateT > 1.1) this._reroute();
        break;
    }
    this._lostRising = this.lost > (this._prevLost || 0) + 0.05; this._prevLost = this.lost;
  }

  _goOff() {
    this._why = this._wrongFloor ? 'floor' : 'lost';
    this._set('off');
    if (this._t - this._lastBuzz > 20) { this._lastBuzz = this._t; this.phone.vibrate && this.phone.vibrate(); }
  }
  _reroute() {
    this.app.forceRoute && this.app.forceRoute();
    const R = this.app.route;
    this._minRem = R && R.ok && isFinite(R.total) ? R.total : Infinity;
    this.lost = 0; this._cool = 8;
    this._wrongFloor = null; this._levels = R && R.ok && R.legs ? new Set(R.legs.map(l => l.level)) : null;
    const st = this.phone._stats; if (st) st.lodestoneReroutes = (st.lodestoneReroutes || 0) + 1;
    this._set('rerouted');
  }

  // what the instruction tile shows instead of the next step (null = the normal step)
  sign() {
    if (!this.active || this.state === 'on') return null;
    const a = Math.abs(this.err), side = this.err > 0 ? 'right' : 'left';
    if (this.state === 'off') {
      const fl = this._why === 'floor' && this.ctx.player ? lvl(this.ctx.player.body.level) : '';
      return { cls: 'trk-off', live: true, title: 'Rerouting…', short: 'Rerouting…', sub: fl ? `You’re on ${fl} · finding a new way` : 'Off the route · finding a new way', gsub: fl ? `You’re on ${fl}` : 'Off the route' };
    }
    if (this.state === 'rerouted') {
      const R = this.app.route, eta = R && isFinite(R.eta) ? (R.eta < 45 ? '<1 min' : `${Math.max(1, Math.round(R.eta / 60))} min`) : '';
      return { cls: 'trk-re', live: false, check: true, title: 'Rerouted', short: 'Rerouted', sub: eta ? `New route · ${eta}` : 'New route' };
    }
    // (hysteresis on the wording too: no flicker between "Turn around" and "Turn right" at ~135°)
    const k = this._signK;
    this._signK = a > (k === 'around' ? 122 : 140) ? 'around' : a >= (k === 'side' || k === 'around' ? 38 : 50) ? 'side' : 'back';
    if (this._signK === 'around') return { cls: 'trk-drift', live: true, title: 'Turn around', short: 'Turn around', sub: 'You’re heading the wrong way', gsub: 'Wrong way' };
    if (this._signK === 'side') return { cls: 'trk-drift', live: true, title: `Turn ${side}`, short: `Turn ${side}`, sub: `The route is to your ${side}` };
    return { cls: 'trk-drift', live: true, title: 'Back to the route', short: 'Back to the route', sub: 'Follow the arrow' };
  }
}

// A soft phone-vibration buzz (two short low pulses) on the UI bus. No-op without audio.
export function buzzSound(ctx) {
  try {
    const A = ctx.audio; if (!A || A.muted || !A.ac || !A.mixer) return;
    const ac = A.ac; if (ac.state !== 'running') return;
    const bus = A.mixer.bus && A.mixer.bus.ui;
    const dest = (bus && bus.dry) || A.mixer.master || ac.destination;
    const t0 = ac.currentTime + 0.01;
    const o1 = ac.createOscillator(), o2 = ac.createOscillator();
    o1.type = 'sawtooth'; o1.frequency.value = 168; o2.type = 'square'; o2.frequency.value = 84;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 480; lp.Q.value = 0.8;
    const g = ac.createGain(); g.gain.setValueAtTime(0, t0);
    for (const [s, d] of [[0, 0.17], [0.25, 0.17]]) {
      g.gain.setValueAtTime(0, t0 + s); g.gain.linearRampToValueAtTime(0.085, t0 + s + 0.02);
      g.gain.setValueAtTime(0.085, t0 + s + d - 0.035); g.gain.linearRampToValueAtTime(0, t0 + s + d);
    }
    o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(dest);
    o1.start(t0); o2.start(t0); o1.stop(t0 + 0.47); o2.stop(t0 + 0.47);
    o1.onended = () => { try { g.disconnect(); lp.disconnect(); } catch (e) { /* ignore */ } };
  } catch (e) { /* audio is optional */ }
}
