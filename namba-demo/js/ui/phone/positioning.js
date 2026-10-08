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
// =============================================================================
import { LEVEL_ORDER } from '../../world/layout.js?v=6c67dba';
import { rng } from '../../core/rng.js?v=6c67dba';

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
  }

  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    if (mode === 'lodestone') {
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

  // environment classification of the TRUE location
  _env(body) {
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
    if (!this._seeded) { this._seeded = true; this.ex = gauss(R) * E.sigma * 0.7; this.ez = gauss(R) * E.sigma * 0.7; }   // the error does not start at zero
    if (this.mode === 'lodestone') { this._updateLodestone(dt, b, p, E); this._signal(E, dt); return; }
    // --- error random walk (OU process, tau ~ 25 s) ---------------------------
    const tau = 22;
    const k = Math.sqrt(2 / tau) * E.sigma * Math.sqrt(dt);
    this.ex += -this.ex / tau * dt + k * gauss(R) * 0.7;
    this.ez += -this.ez / tau * dt + k * gauss(R) * 0.7;
    // a hop: the fix jumps to a whole new (wrong) spot — a parallel corridor, the far side of the hall
    this._snapTimer -= dt;
    if (this._snapTimer <= 0) {
      this._snapTimer = 12 + R() * 18;
      if (R() < E.hop) { const a = R() * Math.PI * 2, m = E.sigma * (0.8 + R() * 0.9); this.ex = Math.cos(a) * m; this.ez = Math.sin(a) * m; this._fixTimer = 0; this._hop = 0.6; this.hops = (this.hops || 0) + 1; }
    }
    // --- fixes: refresh rate by environment ----------------------------------
    this._fixTimer -= dt;
    if (this._fixTimer <= 0) {
      this._fixTimer = E.fix * (0.6 + R() * 0.8);
      let fx = b.x + this.ex, fz = b.z + this.ez;
      const m = this._matchToFloor(this.level || b.level, fx, fz);
      if (m) { fx = m[0]; fz = m[1]; }
      this.fixX = fx; this.fixZ = fz;
      // accuracy circle "breathes" around sigma
      this.accTarget = Math.max(3, E.sigma * (0.75 + R() * 0.6));
    }
    // displayed estimate eases to the fix (and outdoors it just follows); a hop snaps (no glide)
    if (this._hop > 0) this._hop -= dt;
    const ease = 1 - Math.exp(-dt / (this._hop > 0 ? 0.12 : E.env === 'outdoor' || E.env === 'canyon' ? 0.35 : 0.9));
    this.x += (this.fixX - this.x) * ease; this.z += (this.fixZ - this.z) * ease;
    this.acc += ((this.accTarget || E.sigma) - this.acc) * (1 - Math.exp(-dt / 1.5));
    // --- heading: drifting bias + jitter + lag -------------------------------
    const tb = 18;
    this.hBias += -this.hBias / tb * dt + Math.sqrt(2 / tb) * (E.bias * Math.PI / 180) * Math.sqrt(dt) * gauss(R) * 0.8;
    if (!isFinite(this.ex) || !isFinite(this.ez)) { this.ex = this.ez = 0; }
    if (!isFinite(this.hBias)) this.hBias = 0;
    if (!isFinite(this.heading)) this.heading = p.yaw || 0;
    const target = (p.yaw || 0) + this.hBias + gauss(R) * (E.bias * Math.PI / 180) * 0.12;
    let d = target - this.heading; d = Math.atan2(Math.sin(d), Math.cos(d));
    this.heading += d * (1 - Math.exp(-dt / (E.lag || 0.45)));
    // --- floor detection: lag + occasional wrong guess ------------------------
    if (b.ramp < 0) {
      if (b.level !== this.level && b.level !== this._pendingLevel && !this._wrongTimer) {
        this._pendingLevel = b.level; this._levelTimer = 5 + R() * 13;
      }
      if (this._pendingLevel) {
        this._levelTimer -= dt;
        if (this._levelTimer <= 0) { this.level = this._pendingLevel; this._pendingLevel = null; }
        if (this._pendingLevel === this.level) this._pendingLevel = null;
      }
    }
    if (this._wrongTimer > 0) {
      this._wrongTimer -= dt;
      if (this._wrongTimer <= 0) { this._wrongTimer = 0; this.level = this._pendingLevel || b.level; this._pendingLevel = null; }
    } else if (!this._pendingLevel && this.level === b.level && b.ramp < 0 && E.wf > 0 && R() < dt * E.wf) {
      // barometer/Wi-Fi confusion: an adjacent floor for 8–20 s (only one that exists here)
      const i = LEVEL_ORDER.indexOf(b.level);
      const opts = [LEVEL_ORDER[i - 1], LEVEL_ORDER[i + 1]].filter(lv => lv && this.ctx.world.grids[lv] && this._matchToFloor(lv, b.x, b.z));
      const lv = opts.length ? opts[Math.floor(R() * opts.length)] : null;
      if (lv) { this.level = lv; this._wrongTimer = 7 + R() * 9; this.wrongFloorEpisodes = (this.wrongFloorEpisodes || 0) + 1; }
    }
    this._signal(E, dt);
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
