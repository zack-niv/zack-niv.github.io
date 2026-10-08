// =============================================================================
// Live before/after measurements of the phone's positioning, for the end card.
//
//   per-second  error  = distance between the position the phone BELIEVES and
//                        the player's TRUE position (same floor or not)
//   wrong floor        = seconds the believed floor differed from the true one
//   per phase          = real seconds, game minutes and metres walked
//
// v6 (item 9) — fair, per-unit metrics (contract: notes/v6-phone.md). Same
// rules in both phases, so phases of unequal length compare honestly:
//   error p50 / p90       percentiles of the per-second error
//   wrong-floor %         share of samples on the wrong floor
//   dot within 5 m %      v7.2: share of samples where the dot is on the right floor AND <= 5 m from the player
//                         (same error samples; dotWithin5Before / dotWithin5After, null under 20 samples)
//   detour factor         metres walked (with a destination) ÷ metres of real
//                         progress: the drop in the remaining length of the
//                         route being followed (true nav-graph path; with
//                         Lodestone, through the scenic canyon loop while it is
//                         pending). A destination switch re-bases, it is not
//                         progress.
//   wrong ways / km       episodes of walking ≥ 8 m that took you ≥ 6 m
//                         farther from the destination (ends when you win
//                         6 m back), per km walked with a destination
//   reroutes / km         Maps "Recalculating…" / Lodestone reroutes per km
//   heading error         mean |phone heading − true heading| while walking
//   heading settle        median seconds after a ≥ 60° turn until the phone
//                         heading is within 20° of the truth (cap 10 s)
// Nothing is reported from too little data (null), never a fake number.
//
// phase 'before' = the generic maps phone (GPS-ish), 'after' = Lodestone.
// Counting pauses with the game (menu, title, vignettes keep going on purpose:
// a player standing in a queue is time the phone cost them) and stops for good
// on 'demo:arrive'.
// =============================================================================
const DEG = 180 / Math.PI;
const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const pct = (arr, q) => { if (!arr.length) return null; const s = arr.slice().sort((a, b) => a - b); const i = Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1)))); return s[i]; };
const r1 = (v) => (v == null || !isFinite(v) ? null : Math.round(v * 10) / 10);

export class PhoneStats {
  constructor(phone) {
    this.phone = phone; this.ctx = phone.ctx;
    const phaseObj = () => ({ t: 0, gameMin: 0, dist: 0, sumErr: 0, n: 0, maxErr: 0, wrongFloor: 0, errWrongFloor: 0,
      errs: [], within5: 0, navDist: 0, progress: 0, wrongWays: 0, reroutes: 0, headSum: 0, headN: 0, settle: [] });
    this.before = phaseObj(); this.after = phaseObj();
    this.reroutes = 0; this.floorFlips = 0; this.compassPrompts = 0;
    this.frozen = false;
    this.series = [];         // [t, err, wrongFloor(0|1), phase(0|1), distToGoal|-1] once a second
    this._acc = 0; this._lx = null; this._lz = null; this._lastBelieved = null;
    this._t = 0;
    this._skip = 0;
    // progress bookkeeping (re-based on destination / phase change and teleports)
    this._g = { key: '', D: null, minD: Infinity, minAt: 0, inEp: false, peak: 0, walked: 0 };
    this._yawHist = []; this._turn = null; this._headAcc = 0;
    this._rr = 0;
    // a teleport (test harness, cutscene, vignette) is not a positioning error: drop ~2 s of samples around it
    this.ctx.events.on('player:teleport', () => { this._skip = 2.0; this._lx = null; this._g.key = ''; this._turn = null; this._yawHist.length = 0; });
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
    const hasDest = !!(this.phone.dest && this.phone.dest.current && !this.phone.dest.current.arrived);
    if (this._lx != null) {
      const d = Math.hypot(b.x - this._lx, b.z - this._lz);
      // (riding an escalator / stairs is neither walking nor progress for the detour factor: the ride's graph cost and
      //  its horizontal metres differ, which would bias the phase with more rides. Excluded from both sides.)
      if (d < 2.5) { ph.dist += d; if (hasDest && b.ramp < 0) { ph.navDist += d; this._g.walked += d; } } else this._skip = 2.0;   // a jump of > 2.5 m in one frame is a teleport
    }
    this._lx = b.x; this._lz = b.z;
    const pos = this.phone.pos;
    if (this._lastBelieved !== pos.level) { if (this._lastBelieved != null && this.phase === 'before') this.floorFlips++; this._lastBelieved = pos.level; }
    // reroutes per phase: Maps "Recalculating…" before, Lodestone's reroutes after (Maps keeps a stale route
    // ticking in the background after the upgrade; that is not the app the player is using)
    const rr = this.phase === 'before' ? this.reroutes : (this.lodestoneReroutes || 0);
    if (this._rrPhase !== this.phase) { this._rrPhase = this.phase; this._rr = rr; }
    if (rr > this._rr) { ph.reroutes += rr - this._rr; this._rr = rr; }
    if (this._skip > 0) this._skip -= dt;
    this._heading(dt, ph, p, pos);
    this._acc += dt;
    if (this._acc >= 1) {
      this._acc -= 1;
      if (this._skip > 0 || pos._lsSnap > 0 || ph.skipSample) { this._g.key = ''; return; }   // teleport / the one-off snap to the truth
      const err = Math.hypot(pos.x - b.x, pos.z - b.z);
      const wrong = b.ramp < 0 && pos.level !== b.level ? 1 : 0;
      ph.sumErr += err; ph.n++; ph.maxErr = Math.max(ph.maxErr, err);
      if (ph.errs.length < 4000) ph.errs.push(err);
      if (wrong) { ph.wrongFloor++; ph.errWrongFloor += err; }
      else if (err <= 5) ph.within5++;       // 'dot within 5 m of you': right floor AND horizontally within 5 m
      const D = this._progress(ph, b);
      if (this.series.length < 1500) this.series.push([+this._t.toFixed(1), +err.toFixed(1), wrong, this.phase === 'after' ? 1 : 0, D == null ? -1 : Math.round(D)]);
    }
  }

  // the remaining length of the route being followed (true path), per second; progress + wrong-way episodes
  _progress(ph, b) {
    const G = this._g, C = this.phone.dest && this.phone.dest.current;
    if (!C || C.arrived || !this.ctx.nav) { G.key = ''; return null; }
    let D = null;
    try {
      const L = this.phone.lodestone, g = L && L._guidFor ? L._guidFor(C) : null;
      if (g) D = g.remainingRoute(b, this.phase === 'after');
    } catch (e) { D = null; }
    if (D == null || !isFinite(D)) { G.key = ''; return null; }
    const key = C.id + '|' + this.phase + '|' + (b.ramp >= 0 ? 'ride' : 'walk');     // re-based on boarding / landing
    if (b.ramp >= 0) { G.key = key; G.D = D; return D; }
    if (G.key !== key) { G.key = key; G.D = D; G.minD = D; G.walked = 0; G.inEp = false; G.peak = D; return D; }
    const dD = G.D - D;
    if (Math.abs(dD) < 60) ph.progress += dD;               // (a bigger jump is a re-plan, not walking)
    G.D = D;
    if (!G.inEp) {
      if (D < G.minD) { G.minD = D; G.walked = 0; }
      else if (D - G.minD >= 6 && G.walked >= 8) { G.inEp = true; G.peak = D; ph.wrongWays++; }
    } else {
      G.peak = Math.max(G.peak, D);
      if (D <= G.peak - 6) { G.inEp = false; G.minD = D; G.walked = 0; }   // turned back toward it
    }
    return D;
  }

  // heading: mean error while walking; time for the phone's heading to catch up after a real turn
  _heading(dt, ph, p, pos) {
    const yaw = p.yaw || 0, moving = (p.speed || 0) > 0.6 && p.body.ramp < 0;
    const e = Math.abs(wrapA((pos.heading || 0) - yaw)) * DEG;
    this._headAcc += dt;
    if (this._headAcc >= 0.25) { this._headAcc = 0; if (moving && this._skip <= 0) { ph.headSum += e; ph.headN++; } }
    const H = this._yawHist; H.push([this._t, yaw]); while (H.length && this._t - H[0][0] > 1.2) H.shift();
    if (this._turn) {
      this._turn.t += dt;
      if (e < 20) { ph.settle.push(this._turn.t); this._turn = null; }
      else if (this._turn.t >= 10) { ph.settle.push(10); this._turn = null; }
    } else if (H.length > 2 && Math.abs(wrapA(yaw - H[0][1])) * DEG > 60) {
      this._turn = { t: 0 }; H.length = 0;
    }
  }

  _fair(P) {
    const enough = P.n >= 20;
    const km = P.navDist / 1000;
    return {
      errMean: enough ? r1(P.sumErr / P.n) : null,
      errP50: enough ? r1(pct(P.errs, 0.5)) : null,
      errP90: enough ? r1(pct(P.errs, 0.9)) : null,
      wrongFloorPct: enough ? Math.round(P.wrongFloor / P.n * 100) : null,
      dotWithin5: enough ? Math.round(P.within5 / P.n * 100) : null,
      walked: Math.round(P.dist), walkedNav: Math.round(P.navDist),
      progress: Math.round(P.progress),
      detour: P.progress >= 15 && P.navDist > 0 ? Math.max(1, r1(P.navDist / P.progress)) : null,
      wrongWays: P.wrongWays,
      wrongWaysPerKm: P.navDist >= 50 ? r1(P.wrongWays / km) : null,
      reroutesPerKm: P.navDist >= 50 ? r1(P.reroutes / km) : null,
      headingErr: P.headN >= 20 ? Math.round(P.headSum / P.headN) : null,
      headingSettle: P.settle.length >= 2 ? r1(pct(P.settle, 0.5)) : null,
      turns: P.settle.length,
    };
  }

  summary() {
    const B = this.before, A = this.after;
    const mean = (P) => P.n ? P.sumErr / P.n : 0;
    const fb = this._fair(B), fa = this._fair(A);
    const out = {
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
      wrongFloorEpisodesBefore: this.phone.pos.wrongFloorEpisodes || 0, hopsBefore: this.phone.pos.hops || 0,
      upgraded: this.phone.upgradeStage === 'ready', stage: this.phone.upgradeStage,
      finished: this.frozen, series: this.series,
    };
    // v6 flat fair metrics: <name>Before / <name>After (notes/v6-phone.md)
    const names = { errMean: 'errMean', errP50: 'errP50', errP90: 'errP90', wrongFloorPct: 'wrongFloorPct', dotWithin5: 'dotWithin5', walked: 'walked', walkedNav: 'walkedNav',
      progress: 'progress', detour: 'detour', wrongWays: 'wrongWays', wrongWaysPerKm: 'wrongWaysPerKm', reroutesPerKm: 'reroutesPerKm',
      headingErr: 'headingErr', headingSettle: 'headingSettle', turns: 'turns' };
    for (const k in names) { out[names[k] + 'Before'] = fb[k]; out[names[k] + 'After'] = A.t > 0 ? fa[k] : null; }
    out.fair = { before: fb, after: A.t > 0 ? fa : null };
    return out;
  }
}
