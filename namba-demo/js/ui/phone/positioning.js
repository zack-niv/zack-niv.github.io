// =============================================================================
// The phone's belief about where you are — deliberately, plausibly wrong.
//
// v6 (item 9): calibrated to what phone location really does inside a
// multi-level station complex (GNSS through concrete + Wi-Fi/cell fallback):
//
//  * position: true position + a slowly wandering error (Ornstein–Uhlenbeck,
//    tau ~22 s). Typical error (mean / p90): open air ~4 / 7 m, the Parks
//    canyon (an urban canyon: tall walls, multipath) ~6 / 10 m, under the
//    Parks glass ~10 / 18 m, the station concourses under the Nankai viaduct
//    ~15 / 26 m, 1F ~17 / 29 m, B1 ~19 / 33 m, B2 ~24 / 40 m. Map-matched onto
//    a walkable cell of the floor the phone *thinks* you are on (within 9 m).
//  * hops: every ~12–30 s indoors the fix jumps to a whole new wrong spot
//    (a parallel corridor, across the hall) — the dot visibly snaps there.
//    Underground the fix only refreshes every ~1.5–2.5 s.
//  * floor: lags 5–18 s behind real level changes, and indoors it now and then
//    (every ~1–2 min) guesses an adjacent floor for 7–16 s.
//  * heading: true yaw + slowly drifting bias (steel, trains, escalator
//    motors) + jitter, smoothed with a lag of ~0.6 s (open air) to ~2 s (B2):
//    after a turn the map arrow takes seconds to come round.
//  * signal: bars by level/zone; B2 platforms drop to 圏外 (no service).
//  Never broken: the dot stays on a plausible walkable spot, and the floor
//  always comes back.
//
// v8 (item 1): the ordinary Maps app must make you feel LOST, as in life. Indoors there is no GPS, so the dot does not
// track you with noise any more; it lives in three states (pos.state, Maps mode only):
//   'stale'   no signal: the dot is FROZEN at the last fix for 30-55 s while you keep walking; the accuracy circle grows
//             (pos.ageS = seconds since the last fix, "last seen 40 s ago"). The floor is frozen too.
//   'coarse'  a Wi-Fi / cell estimate: the dot JUMPS 20-60 m to a wrong place (every other time or so: the wrong floor)
//             and sits there with a ~±40 m circle, hardly moving, for 20-38 s.
//   'fix'     a good GPS fix near big openings (the sky, the Parks glass, a street exit): tracks you ~±5 m, then drops
//             back to stale a few seconds after you leave the opening. Rarely a 4-7 s blip indoors.
// Cycle indoors: stale -> coarse -> (stale | rarely a fix blip) -> coarse ... The first stale lasts ~40 s, so the very
// first look at the map is plausible and then goes wrong. A wrong-floor coarse lasts only 14-24 s and is always followed
// by a right-floor coarse. Events are drawn from their own seeded stream (this.S), so runs are comparable.
// Lodestone mode is untouched (true position, +-1 m).
// =============================================================================
import { LEVEL_ORDER, LAYOUT } from '../../world/layout.js';
import { rng } from '../../core/rng.js';

const gauss = (R) => { let u = 0, v = 0; while (u === 0) u = R(); v = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

export class Positioning {
  constructor(ctx) {
    this.ctx = ctx;
    this.R = rng((ctx.params && ctx.params.seed) || 7);
    this.ex = 0; this.ez = 0;         // error vector
    this.x = 0; this.z = 0;           // displayed estimate
    this.fixX = 0; this.fixZ = 0;     // last raw fix
    this.acc = 10;                    // displayed accuracy radius (m)
    this.heading = 0;                 // radians, same convention as player.yaw
    this.hBias = 0;
    this.level = null;                // believed floor
    this._pendingLevel = null; this._levelTimer = 0;
    this._wrongTimer = 0; this._wrongBack = null;
    this._fixTimer = 0;
    this._snapTimer = 30;
    this.signal = 4; this.net = '5G'; this.noService = false;
    this._sigTimer = 0;
    this.env = 'indoor';
    this._init = false;
    // 'gps' = the generic phone fix (above); 'lodestone' = true position ±1 m,
    // true heading, instant floor (set by Phone.installLodestone via setMode)
    this.mode = 'gps';
    this.lx = 0; this.lz = 0; this._lsSnap = 0;
    // v8 Maps states (see the header)
    this.S = rng(((ctx.params && ctx.params.seed) || 7) * 7919 + 17);   // event stream: durations, jump directions
    this.state = 'stale'; this.stT = 0; this.dur = 0;
    this.ageS = 0;                    // seconds since the dot was last refreshed ("last seen 40 s ago")
    this.hops = 0; this.wrongFloorEpisodes = 0;
    this._accFreeze = 10; this._wasOpen = null; this._lockT = 0; this._lockNeed = Infinity; this._cool = 0;
    this._fixMax = 0; this._tail = 0; this._coarseWrong = false; this._coarseN = 0; this._wrongPrev = false;
    this._ax = 0; this._az = 0; this.cjx = 0; this.cjz = 0; this._coarseAcc = 40; this.lastJump = 0;
  }

  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    if (mode === 'lodestone') {
      this.state = 'fix'; this.ageS = 0;
      this._lsSnap = 1.4;                 // the dot visibly snaps to the truth
      this._pendingLevel = null; this._wrongTimer = 0; this._levelTimer = 0;
      this.lx = this.lz = 0;
      const b = this.ctx.player && this.ctx.player.body; if (b) this.level = this.trueLevel(b);   // floor is right from the first frame
    }
  }

  // floor of a body, mid-ramp bodies belong to whichever end they are nearer
  trueLevel(b) {
    if (b.ramp >= 0) {
      const r = this.ctx.world.layout.ramps[b.ramp];
      if (r) { const y0 = this.ctx.world.layout.LEVELS[r.lower].y, y1 = this.ctx.world.layout.LEVELS[r.upper].y; return (b.y - y0) > (y1 - y0) / 2 ? r.upper : r.lower; }
    }
    return b.level;
  }

  _updateLodestone(dt, b, p, E) {
    const R = this.R;
    // sub-metre residual error: a fast OU wobble, sigma ~0.35 m
    const tau = 1.1, k = Math.sqrt(2 / tau) * 0.34 * Math.sqrt(dt);
    this.lx += -this.lx / tau * dt + k * gauss(R); this.lz += -this.lz / tau * dt + k * gauss(R);
    const lim = 0.9, m = Math.hypot(this.lx, this.lz); if (m > lim) { this.lx *= lim / m; this.lz *= lim / m; }
    this._lsSnap = Math.max(0, this._lsSnap - dt);
    const ease = 1 - Math.exp(-dt / (this._lsSnap > 0 ? 0.28 : 0.07));
    this.x += (b.x + this.lx - this.x) * ease; this.z += (b.z + this.lz - this.z) * ease;
    this.fixX = this.x; this.fixZ = this.z;
    this.accTarget = 1.0;
    this.acc += (1.0 - this.acc) * (1 - Math.exp(-dt / 0.25));
    this.level = this.trueLevel(b); this._pendingLevel = null; this._wrongTimer = 0;
    let d = (p.yaw || 0) - this.heading; d = Math.atan2(Math.sin(d), Math.cos(d));
    this.heading += d * (1 - Math.exp(-dt / (this._lsSnap > 0 ? 0.25 : 0.05)));
    this.hBias = 0;
  }

  // environment classification of the TRUE location, plus E.open: what the sky / big openings offer a GPS receiver
  _env(body) {
    const E = this._env0(body);
    E.open = E.env === 'outdoor' || E.env === 'canyon' ? 'sky' : E.env === 'glass' ? 'glass' : null;
    if (!E.open) for (const ex of LAYOUT.exits) if (ex.level === body.level && Math.hypot(ex.x - body.x, ex.z - body.z) < 8) { E.open = 'door'; break; }
    return E;
  }
  _env0(body) {
    const { world } = this.ctx;
    const sp = world.spaceAt(body.level, body.x, body.z);
    const outdoor = sp && sp.outdoor, zone = sp && sp.zone;
    const lv = body.level;
    // (fix = seconds between fixes; hop = chance that a periodic re-fix lands somewhere new; lag = heading smoothing s;
    //  wf = rate of wrong-floor guesses, per second)
    if (outdoor && (zone === 'parks' || zone === 'parksGarden')) return { env: 'canyon', sigma: 7, bias: 8, fix: 0.6, sig: 4, hop: 0.35, lag: 0.7, wf: 0 };
    if (outdoor) return { env: 'outdoor', sigma: 4, bias: 5, fix: 0.4, sig: 4, hop: 0.2, lag: 0.6, wf: 0 };
    if (zone === 'parks' || zone === 'parksGarden' || (sp && sp.style === 'parks_skywalk')) return { env: 'glass', sigma: 12, bias: 12, fix: 0.9, sig: 4, hop: 0.55, lag: 0.95, wf: 1 / 110 };
    // the concourses under the Nankai viaduct and the Namba CITY mall below it: the worst of indoors above ground
    const via = zone === 'nankai' || zone === 'city' ? 1.12 : 1;
    if (lv === '3F' || lv === '2F') return { env: 'terminal', sigma: 15.5 * via, bias: 22, fix: 1.2, sig: 3, hop: 0.7, lag: 1.3, wf: 1 / 70 };
    if (lv === '1F') return { env: 'ground', sigma: 17 * via, bias: 22, fix: 1.3, sig: 3, hop: 0.7, lag: 1.3, wf: 1 / 70 };
    if (lv === 'B1') return { env: 'under', sigma: 22, bias: 28, fix: 1.7, sig: 2, hop: 0.75, lag: 1.6, wf: 1 / 60 };
    if (lv === 'B2') return { env: 'deep', sigma: 27, bias: 36, fix: 2.4, sig: 0, hop: 0.8, lag: 2.0, wf: 1 / 60 };
    return { env: 'indoor', sigma: 14, bias: 16, fix: 1.0, sig: 3, hop: 0.6, lag: 1.1, wf: 1 / 60 };
  }

  update(dt) {
    const p = this.ctx.player; if (!p) return;
    dt = Math.max(0, Math.min(0.25, dt || 0));
    const b = p.body;
    const R = this.R;
    if (!this._init) {
      this._init = true; this.level = b.level; this.x = b.x; this.z = b.z; this.heading = p.yaw;
      this.fixX = b.x; this.fixZ = b.z;
    }
    const E = this._env(b);
    this.env = E.env;
    if (!this._seeded) {
      this._seeded = true; this.ex = gauss(R) * E.sigma * 0.7; this.ez = gauss(R) * E.sigma * 0.7;   // the error does not start at zero
      // v8: the first thing Maps knows is the entrance fix from a minute ago: a plausible dot a few metres off, no signal since
      const m = this._matchToFloor(b.level, b.x + gauss(this.S) * 5, b.z + gauss(this.S) * 5);
      if (m) { this.x = this.fixX = m[0]; this.z = this.fixZ = m[1]; }
      this._enterStale(E, 38 + this.S() * 10, 6 + this.S() * 6);
    }
    if (this.mode === 'lodestone') { this._updateLodestone(dt, b, p, E); this._signal(E, dt); return; }
    this._gps(dt, b, p, E);
    this._signal(E, dt);
  }

  // ---------------------------------------------------------------- v8: the Maps state machine ------------------
  _enterStale(E, dur, age = 0) {
    this.state = 'stale'; this.stT = 0; this.ageS = age; this._accFreeze = Math.max(8, Math.min(this.acc || 10, 30));
    this.acc = this._accFreeze;
    this.dur = dur != null ? dur : (E.env === 'deep' ? 1.2 : E.env === 'under' ? 1.1 : 1) * (30 + this.S() * 26);
    this.fixX = this.x; this.fixZ = this.z;
  }
  _enterFix(b, E, max) {
    this.state = 'fix'; this.stT = 0; this.ageS = 0; this._fixMax = max; this._tail = 5 + this.S() * 4;
    this.hops = (this.hops || 0) + 1;
    this.ex = gauss(this.R) * 3; this.ez = gauss(this.R) * 3;
    this._fixTimer = 0; this._hop = 0.6; this._cool = 0;
    this.level = this.trueLevel(b); this._pendingLevel = null; this._wrongTimer = 0;
  }
  // a Wi-Fi / cell estimate: 20-60 m from the truth on a walkable spot; sometimes an adjacent floor
  _enterCoarse(b, E, rightFloor) {
    const S = this.S, tl = this.trueLevel(b);
    let wrong = false;
    if (!rightFloor) {
      const want = this._coarseN === 1 ? S() < 0.5 : this.wrongFloorEpisodes === 0 ? true : S() < 0.3;
      wrong = want && !this._coarseWrong;
    }
    let lv = tl;
    if (wrong) {
      const i = LEVEL_ORDER.indexOf(tl);
      const opts = [LEVEL_ORDER[i - 1], LEVEL_ORDER[i + 1]].filter(l => l && this.ctx.world.grids[l]);
      if (opts.length) lv = opts[Math.floor(S() * opts.length)]; else wrong = false;
    }
    let best = null;
    for (let k = 0; k < 18 && !best; k++) {
      const d = wrong ? 8 + S() * 34 : 22 + S() * 38, a = S() * Math.PI * 2;
      const m = this._matchToFloor(lv, b.x + Math.cos(a) * d, b.z + Math.sin(a) * d);
      if (m && Math.hypot(m[0] - b.x, m[1] - b.z) >= (wrong ? 6 : 20)) best = m;
    }
    if (!best) { this.dur = this.stT + 6; return; }                                  // nowhere plausible: try again shortly
    this.state = 'coarse'; this.stT = 0; this.ageS = 0; this._coarseN++;
    this._coarseWrong = wrong && lv !== tl;
    this.dur = this._coarseWrong ? 14 + S() * 10 : 20 + S() * 18;
    this._ax = best[0]; this._az = best[1]; this.cjx = this.cjz = 0;
    this.lastJump = Math.hypot(best[0] - this.x, best[1] - this.z);
    this._coarseAcc = Math.max(28, Math.min(62, Math.hypot(best[0] - b.x, best[1] - b.z) * 0.8 + 14 + S() * 8));
    if (lv !== this.level) this.level = lv;
    this.fixX = this._ax; this.fixZ = this._az;
    this._hop = 0.6; this.hops = (this.hops || 0) + 1;
  }

  _gps(dt, b, p, E) {
    const R = this.R, S = this.S, tl = this.trueLevel(b);
    this.stT += dt;
    const open = E.open;
    // --- a GPS receiver needs a moment under open sky; the Parks glass and a street exit are only sometimes good enough
    if (open && !this._wasOpen) { this._lockT = 0; this._lockNeed = open === 'sky' ? 2.5 + S() * 2.5 : (S() < 0.6 ? 1.2 + S() * 2 : Infinity); }
    if (!open) this._lockT = 0;
    this._wasOpen = open;
    if (this._cool > 0) this._cool -= dt;
    if (open && this.state !== 'fix' && this._lockNeed < Infinity && (open === 'sky' || this._cool <= 0)) {
      this._lockT += dt;
      if (this._lockT >= this._lockNeed) this._enterFix(b, E, open === 'sky' ? 1e9 : 7 + S() * 6);
    }
    if (this.state === 'stale') {
      // frozen: same x, z, floor. Only the circle grows ("±8 m ... ±55 m") and the clock runs.
      this.ageS += dt;
      this.acc += (Math.min(55, this._accFreeze + this.ageS * 0.9) - this.acc) * (1 - Math.exp(-dt / 0.6));
      if (this.stT >= this.dur && !open) this._enterCoarse(b, E, false);
    } else if (this.state === 'coarse') {
      this.ageS += dt;
      // the estimate hardly moves: a slow ±1.5 m wobble round the anchor; now and then the cell re-estimates a few metres over
      const tau = 7, k = Math.sqrt(2 / tau) * 1.4 * Math.sqrt(dt);
      this.cjx += -this.cjx / tau * dt + k * gauss(R); this.cjz += -this.cjz / tau * dt + k * gauss(R);
      if (R() < dt / 14) { const a = R() * 6.28, m = 3 + R() * 5, q = this._matchToFloor(this.level, this._ax + Math.cos(a) * m, this._az + Math.sin(a) * m); if (q) { this._ax = q[0]; this._az = q[1]; this._hop = 0.4; } }
      this.fixX = this._ax + this.cjx; this.fixZ = this._az + this.cjz;
      this.acc += (this._coarseAcc - this.acc) * (1 - Math.exp(-dt / 0.8));
      if (this.stT >= this.dur) {
        if (this._coarseWrong) this._enterCoarse(b, E, true);                  // the floor comes back (to another wrong place)
        else if (S() < 0.16) this._enterFix(b, E, 4 + S() * 3);                // a brief lucky fix indoors
        else this._enterStale(E, null, 0);
      }
    } else {   // fix
      const sigma = E.env === 'canyon' ? 6 : open === 'sky' ? 4 : 6;
      const tau = 14, k = Math.sqrt(2 / tau) * sigma * Math.sqrt(dt);
      this.ex += -this.ex / tau * dt + k * gauss(R) * 0.7; this.ez += -this.ez / tau * dt + k * gauss(R) * 0.7;
      this._fixTimer -= dt;
      if (this._fixTimer <= 0) {
        this._fixTimer = 0.45 * (0.7 + R() * 0.6);
        let fx = b.x + this.ex, fz = b.z + this.ez;
        const m = this._matchToFloor(tl, fx, fz); if (m) { fx = m[0]; fz = m[1]; }
        this.fixX = fx; this.fixZ = fz;
        this.accTarget = Math.max(4, sigma * (0.9 + R() * 0.5));
      }
      this.acc += ((this.accTarget || sigma) - this.acc) * (1 - Math.exp(-dt / 1.2));
      if (b.ramp < 0 && this.level !== tl) this.level = tl;
      this._fixMax -= dt;
      if (open) this._tail = 5 + S() * 4; else this._tail -= dt;
      if (this._tail <= 0 || (open !== 'sky' && this._fixMax <= 0)) { this._cool = 12; this._enterStale(E, null, 0); }
    }
    // displayed estimate: stale never moves; coarse/fix ease to the fix (a hop snaps, no glide)
    if (this._hop > 0) this._hop -= dt;
    if (this.state !== 'stale') {
      const ease = 1 - Math.exp(-dt / (this._hop > 0 ? 0.12 : this.state === 'fix' ? 0.35 : 1.2));
      this.x += (this.fixX - this.x) * ease; this.z += (this.fixZ - this.z) * ease;
    }
    // --- heading: the compass alone (steel, rails, escalator motors): a drifting bias + jitter + lag; worse without GPS
    const bias = E.bias * (this.state === 'fix' ? 0.8 : 1.3);
    const tb = 18;
    this.hBias += -this.hBias / tb * dt + Math.sqrt(2 / tb) * (bias * Math.PI / 180) * Math.sqrt(dt) * gauss(R) * 0.8;
    if (!isFinite(this.ex) || !isFinite(this.ez)) { this.ex = this.ez = 0; }
    if (!isFinite(this.x) || !isFinite(this.z)) { this.x = b.x; this.z = b.z; this.fixX = b.x; this.fixZ = b.z; }
    if (!isFinite(this.hBias)) this.hBias = 0;
    if (!isFinite(this.heading)) this.heading = p.yaw || 0;
    const target = (p.yaw || 0) + this.hBias + gauss(R) * (bias * Math.PI / 180) * 0.12;
    let d = target - this.heading; d = Math.atan2(Math.sin(d), Math.cos(d));
    this.heading += d * (1 - Math.exp(-dt / ((E.lag || 0.45) * (this.state === 'fix' ? 1 : 1.25))));
    // --- wrong-floor episodes: every time the believed floor starts to differ from the true one (off the ramps)
    if (b.ramp < 0) {
      const wrong = this.level !== tl;
      if (wrong && !this._wrongPrev) this.wrongFloorEpisodes = (this.wrongFloorEpisodes || 0) + 1;
      this._wrongPrev = wrong;
    }
  }

  _signal(E, dt) {
    const R = this.R;
    this._sigTimer -= dt;
    if (this._sigTimer <= 0) {
      this._sigTimer = 2 + R() * 4;
      let s = E.sig;
      if (E.env === 'under') s = R() < 0.25 ? 1 : R() < 0.7 ? 2 : 3;
      if (E.env === 'deep') s = R() < 0.45 ? 0 : 1;
      if (E.env === 'terminal' || E.env === 'ground') s = R() < 0.3 ? 2 : 3;
      if (E.env === 'outdoor' || E.env === 'canyon' || E.env === 'glass') s = R() < 0.2 ? 3 : 4;
      this.signal = s;
      this.noService = s === 0;
      this.net = s === 0 ? '圏外' : s === 1 ? 'LTE' : s === 2 ? '4G' : '5G';
    }
  }

  // nearest walkable cell on `level` within 9 m (map matching)
  _matchToFloor(level, x, z) {
    const w = this.ctx.world;
    if (w.isWalkable(level, x, z)) return [x, z];
    let best = null, bd = 1e9;
    for (let r = 1; r <= 9; r += 1) {
      for (let a = 0; a < 16; a++) {
        const ang = a / 16 * Math.PI * 2;
        const px = x + Math.cos(ang) * r, pz = z + Math.sin(ang) * r;
        if (w.isWalkable(level, px, pz)) { const d = r; if (d < bd) { bd = d; best = [px, pz]; } }
      }
      if (best) return best;
    }
    return null;
  }
}
