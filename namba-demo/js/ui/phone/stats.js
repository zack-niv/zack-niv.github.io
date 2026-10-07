// =============================================================================
// Live before/after measurements of the phone's positioning, for the end card.
//
//   per-second  error  = distance between the position the phone BELIEVES and
//                        the player's TRUE position (same floor or not)
//   wrong floor        = seconds the believed floor differed from the true one
//   per phase          = real seconds, game minutes and metres walked
//
// phase 'before' = the generic maps phone (GPS-ish), 'after' = Lodestone.
// Counting pauses with the game (menu, title, vignettes keep going on purpose:
// a player standing in a queue is time the phone cost them) and stops for good
// on 'demo:arrive'.
// =============================================================================
export class PhoneStats {
  constructor(phone) {
    this.phone = phone; this.ctx = phone.ctx;
    const phaseObj = () => ({ t: 0, gameMin: 0, dist: 0, sumErr: 0, n: 0, maxErr: 0, wrongFloor: 0, errWrongFloor: 0 });
    this.before = phaseObj(); this.after = phaseObj();
    this.reroutes = 0; this.floorFlips = 0; this.compassPrompts = 0;
    this.frozen = false;
    this.series = [];         // [t, err, wrongFloor(0|1), phase(0|1)] once a second
    this._acc = 0; this._lx = null; this._lz = null; this._lastBelieved = null;
    this._t = 0;
    this._skip = 0;
    // a teleport (test harness, cutscene, vignette) is not a positioning error: drop ~2 s of samples around it
    this.ctx.events.on('player:teleport', () => { this._skip = 2.0; this._lx = null; });
    this.ctx.events.on('demo:arrive', () => { this.frozen = true; this.arrivedAt = this._t; });
  }

  get phase() { return this.phone.pos.mode === 'lodestone' ? 'after' : 'before'; }

  update(dt) {
    const ctx = this.ctx, p = ctx.player;
    if (!p || !ctx.started || this.frozen) return;
    if (ctx.paused || (ctx.game && ctx.game.paused)) { this._lx = null; return; }
    dt = Math.min(dt, 0.1);
    const ph = this[this.phase];
    ph.t += dt; this._t += dt; ph.gameMin += dt * (ctx.clock.scale || 1) / 60;
    const b = p.body;
    if (this._lx != null) {
      const d = Math.hypot(b.x - this._lx, b.z - this._lz);
      if (d < 2.5) ph.dist += d; else this._skip = 2.0;           // a jump of > 2.5 m in one frame is a teleport
    }
    this._lx = b.x; this._lz = b.z;
    const pos = this.phone.pos;
    if (this._lastBelieved !== pos.level) { if (this._lastBelieved != null && this.phase === 'before') this.floorFlips++; this._lastBelieved = pos.level; }
    if (this._skip > 0) this._skip -= dt;
    this._acc += dt;
    if (this._acc >= 1) {
      this._acc -= 1;
      if (this._skip > 0 || pos._lsSnap > 0 || ph.skipSample) return;   // teleport / the one-off snap to the truth
      const err = Math.hypot(pos.x - b.x, pos.z - b.z);
      const wrong = b.ramp < 0 && pos.level !== b.level ? 1 : 0;
      ph.sumErr += err; ph.n++; ph.maxErr = Math.max(ph.maxErr, err);
      if (wrong) { ph.wrongFloor++; ph.errWrongFloor += err; }
      if (this.series.length < 1500) this.series.push([+this._t.toFixed(1), +err.toFixed(1), wrong, this.phase === 'after' ? 1 : 0]);
    }
  }

  summary() {
    const B = this.before, A = this.after;
    const mean = (P) => P.n ? P.sumErr / P.n : 0;
    return {
      mode: this.phone.pos.mode,
      timeBefore: Math.round(B.t), timeAfter: Math.round(A.t), wrongFloorSecondsBefore: B.wrongFloor,
      meanErrorBefore: +mean(B).toFixed(2), meanErrorAfter: A.n ? +mean(A).toFixed(2) : null,
      maxErrorBefore: +B.maxErr.toFixed(1), maxErrorAfter: +A.maxErr.toFixed(1),
      wrongFloorSeconds: B.wrongFloor, wrongFloorSecondsAfter: A.wrongFloor,
      secondsBefore: Math.round(B.t), secondsAfter: Math.round(A.t),
      minutesBefore: +(B.t / 60).toFixed(2), minutesAfter: +(A.t / 60).toFixed(2),
      gameMinutesBefore: +B.gameMin.toFixed(1), gameMinutesAfter: +A.gameMin.toFixed(1),
      metresBefore: Math.round(B.dist), metresAfter: Math.round(A.dist),
      samplesBefore: B.n, samplesAfter: A.n,
      reroutes: this.reroutes, floorFlips: this.floorFlips, compassPrompts: this.compassPrompts,
      lodestoneReroutes: this.lodestoneReroutes || 0,
      upgraded: this.phone.upgradeStage === 'ready', stage: this.phone.upgradeStage,
      finished: this.frozen, series: this.series,
    };
  }
}
