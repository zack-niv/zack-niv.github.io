// =============================================================================
// The phone's belief about where you are — deliberately, plausibly wrong.
//
//  * position: true position + a slowly wandering error (Ornstein–Uhlenbeck),
//    sigma by environment (≈2 m outdoors, 6–9 m under glass, 12–25 m
//    underground), occasional snaps to a new fix, map-matched onto a walkable
//    cell of the floor the phone *thinks* you are on; underground the fix
//    only refreshes every ~1–2 s, so the dot hops.
//  * floor: lags 5–20 s behind real level changes, and underground it now and
//    then guesses an adjacent floor for a while.
//  * heading: true yaw + slowly drifting bias (magnetic interference from
//    steel and trains underground) + jitter, smoothed with lag.
//  * signal: bars by level/zone; B2 platforms drop to 圏外 (no service).
// =============================================================================
import { LEVEL_ORDER } from '../../world/layout.js';
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
  }

  // environment classification of the TRUE location
  _env(body) {
    const { world } = this.ctx;
    const sp = world.spaceAt(body.level, body.x, body.z);
    const outdoor = sp && sp.outdoor;
    const lv = body.level;
    if (outdoor) return { env: 'outdoor', sigma: 2.2, bias: 4, fix: 0.3, sig: 4 };
    if (sp && (sp.zone === 'parks' || sp.style === 'parks_skywalk')) return { env: 'glass', sigma: 5.5, bias: 9, fix: 0.6, sig: 4 };
    if (lv === '3F' || lv === '2F') return { env: 'terminal', sigma: 7.5, bias: 14, fix: 0.8, sig: 3 };
    if (lv === '1F') return { env: 'ground', sigma: 9, bias: 16, fix: 0.9, sig: 3 };
    if (lv === 'B1') return { env: 'under', sigma: 16, bias: 26, fix: 1.4, sig: 2 };
    if (lv === 'B2') return { env: 'deep', sigma: 23, bias: 34, fix: 2.2, sig: 0 };
    return { env: 'indoor', sigma: 8, bias: 12, fix: 0.8, sig: 3 };
  }

  update(dt) {
    const p = this.ctx.player; if (!p) return;
    const b = p.body;
    const R = this.R;
    if (!this._init) {
      this._init = true; this.level = b.level; this.x = b.x; this.z = b.z; this.heading = p.yaw;
      this.fixX = b.x; this.fixZ = b.z;
    }
    const E = this._env(b);
    this.env = E.env;
    // --- error random walk (OU process, tau ~ 25 s) ---------------------------
    const tau = 25;
    const k = Math.sqrt(2 / tau) * E.sigma * Math.sqrt(dt);
    this.ex += -this.ex / tau * dt + k * gauss(R) * 0.7;
    this.ez += -this.ez / tau * dt + k * gauss(R) * 0.7;
    // occasional snap to a whole new (wrong) fix — underground mostly
    this._snapTimer -= dt;
    if (this._snapTimer <= 0) {
      this._snapTimer = 20 + R() * 40;
      if (E.sigma > 8 && R() < 0.65) { const a = R() * Math.PI * 2, m = E.sigma * (0.7 + R() * 0.9); this.ex = Math.cos(a) * m; this.ez = Math.sin(a) * m; }
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
    // displayed estimate eases to the fix (and outdoors it just follows)
    const ease = 1 - Math.exp(-dt / (E.env === 'outdoor' ? 0.35 : 0.9));
    this.x += (this.fixX - this.x) * ease; this.z += (this.fixZ - this.z) * ease;
    this.acc += ((this.accTarget || E.sigma) - this.acc) * (1 - Math.exp(-dt / 1.5));
    // --- heading: drifting bias + jitter + lag -------------------------------
    const tb = 18;
    this.hBias += -this.hBias / tb * dt + Math.sqrt(2 / tb) * (E.bias * Math.PI / 180) * Math.sqrt(dt) * gauss(R) * 0.8;
    const target = p.yaw + this.hBias + gauss(R) * (E.bias * Math.PI / 180) * 0.12;
    let d = target - this.heading; d = Math.atan2(Math.sin(d), Math.cos(d));
    this.heading += d * (1 - Math.exp(-dt / 0.45));
    // --- floor detection: lag + occasional wrong guess ------------------------
    if (b.ramp < 0) {
      if (b.level !== this.level && b.level !== this._pendingLevel && !this._wrongTimer) {
        this._pendingLevel = b.level; this._levelTimer = 5 + R() * 15;
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
    } else if (!this._pendingLevel && this.level === b.level && (E.env === 'under' || E.env === 'deep' || E.env === 'ground') && R() < dt / 140) {
      // barometer/Wi-Fi confusion: an adjacent floor for 8–20 s
      const i = LEVEL_ORDER.indexOf(b.level), j = i + (R() < 0.5 ? -1 : 1);
      const lv = LEVEL_ORDER[j];
      if (lv && this.ctx.world.grids[lv]) { this.level = lv; this._wrongTimer = 8 + R() * 12; }
    }
    // --- signal ---------------------------------------------------------------
    this._sigTimer -= dt;
    if (this._sigTimer <= 0) {
      this._sigTimer = 2 + R() * 4;
      let s = E.sig;
      if (E.env === 'under') s = R() < 0.25 ? 1 : R() < 0.7 ? 2 : 3;
      if (E.env === 'deep') s = R() < 0.45 ? 0 : 1;
      if (E.env === 'terminal' || E.env === 'ground') s = R() < 0.3 ? 2 : 3;
      if (E.env === 'outdoor' || E.env === 'glass') s = R() < 0.2 ? 3 : 4;
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
