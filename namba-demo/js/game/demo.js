// =============================================================================
// The demo director. One quest, three acts:
//   1. the ordinary map  (arrival at Nankai Namba, Aya's text, a generic phone)
//   2. the upgrade       (Lodestone is offered when the player is clearly lost
//                         or after ~2 minutes, whichever comes first)
//   3. arrival           (a short visible moment at Daikichi, then the end card)
// Everything here is timed in REAL seconds of play (pause-aware), never in
// game minutes, so it does not matter how fast the world clock runs.
//
// Talks to the phone only through the contract in notes/demo-flow.md:
//   ctx.phone.offerLodestone()   (guarded; falls back to a plain Aya text)
//   'phone:upgrade' {stage}      ('ready' = Lodestone is live)
//   ctx.phone.stats()            (guarded; own fallbacks computed here)
// Emits 'demo:arrive' and 'demo:end'.
// =============================================================================
import { businessBySlot } from '../world/directory.js';
import { params } from '../core/params.js';
import { DEMO, INTRO, NUDGES, UPGRADE, QUEUE_LINES, ARRIVAL } from './script.js';
import { showEndCard } from './endcard.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const safe = (fn) => { try { return fn(); } catch (e) { return null; } };
const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
const WAVE = 5;                 // npc/sim.js POSE.WAVE
const WRONG_LEVELS = new Set(['B2', 'B1', '1F']);

export class Demo {
  constructor(ctx, game) {
    this.ctx = ctx; this.game = game;
    this.biz = businessBySlot[DEMO.slot];
    this.t = 0;                      // real seconds of play
    this.began = false;
    this.offered = false; this.offerT = null; this.offerWhy = null;
    this.upgraded = false; this.readyT = null; this.readyDist = 0; this.installT = null;
    this.arrived = false; this.arriveT = null; this.arriveDist = 0;
    this.ended = false;
    this._sent = new Set();
    this._lost = { wrongT: 0, best: Infinity, init: null, rem: null, lastCheck: 0 };
    this._acc = { before: { n: 0, e: 0, wf: 0 }, after: { n: 0, e: 0, wf: 0 } };
    this._sampleT = 0;
    this._aya = null; this._wave = 0;
    this._offerAt = params.has('offerat') ? +params.get('offerat') : DEMO.offerAt;
    this._offerMin = params.has('offerat') ? Math.min(DEMO.offerMin, this._offerAt) : DEMO.offerMin;
  }

  // ---------------------------------------------------------------------------
  // Act 1: arrival
  begin({ cinematic = true } = {}) {
    if (this.began) return;
    this.began = true;
    const { ctx, game } = this;
    const hud = game.hud;
    const ev = ctx.events;
    ev.on('phone:upgrade', (e) => this._onUpgrade(e));
    this._buildMarker();
    // the navigation field the "am I lost?" test and the queue banter read
    const b = this.biz;
    if (b && ctx.nav) {
      this._field = safe(() => ctx.nav.fieldToPoint('demo:daikichi', b.level, b.door.ox, b.door.oz));
      const body = ctx.player.body;
      const d0 = this._field ? safe(() => ctx.nav.distance(this._field, body)) : null;
      this._lost.init = num(d0) && d0 > 0 ? d0 : 500;
    }
    this._walk0 = game.journal.distance;

    let tt = 0;
    if (cinematic) {
      // a held breath: the train, the platform, then the way out
      game.intro = true; game._syncFrozen();
      const p = ctx.player;
      p.yaw = DEMO.introYaw; p.pitch = 0.0;
      game.lookYaw(DEMO.introYaw, 0.02, 3);
      game.after(0.2, () => hud?.chapter({ ja: '南海なんば駅', en: 'Nankai Namba Station', sub: `Platform 4 · ${ctx.clock.hhmm} · off the rapi:t from Kansai Airport` }, 6.5));
      game.after(2.6, () => game.lookYaw(0, 0.0, 0.55));
      game.after(DEMO.introHold, () => { game.intro = false; game.clearLook(); game._syncFrozen(); });
      tt = DEMO.introHold;
    }
    // the terminal PA ("Namba, Namba. This is the last stop."): transit speaks it and the HUD captions it;
    // if nothing arrived by 1.8 s (no transit announcement, no audio), caption it ourselves
    let heard = false;
    const hear = (a) => { if (a && (a.start || a.kind === 'arrive' || a.kind === 'platform' || a.speaker === 'PA' || a.distant)) heard = true; };
    ev.on('announce', hear); ev.on('caption', hear);
    game.after(1.8, () => { if (!heard && !game.paused) hud?.caption({ ja: 'なんば、なんば、終点です。どなた様もお忘れ物のないよう、ご注意ください。', en: 'Namba, Namba. This is the last stop. Please take all your belongings with you.', kind: 'announce', duration: 6 }); });
    // Aya's texts
    INTRO.forEach(([at, text]) => game.after(at, () => game.message(text)));
    const lastAt = INTRO[INTRO.length - 1][0];
    game.after(lastAt + 1.6, () => game.setQuest('tempura', 'active', null, true));
    game.after(Math.max(tt + 3, 7.5), () => hud?.hint('keys', 9));
    game.after(lastAt + 6.5, () => hud?.hint('phone', 8));
    this.nudges = NUDGES.map(([at, text]) => ({ at, text, sent: false }));
  }

  // ---------------------------------------------------------------------------
  // Per-frame
  update(dt) {
    if (!this.began) return;
    const { ctx, game } = this;
    this.t += dt;
    const b = ctx.player.body;
    // positioning samples: the phone's belief vs the truth (own fallback for phone.stats())
    this._sampleT -= dt;
    if (this._sampleT <= 0 && !this.ended) {
      this._sampleT = 0.25;
      const pos = ctx.phone && ctx.phone.pos;
      if (pos && isFinite(pos.x) && isFinite(pos.z)) {
        const A = this.upgraded ? this._acc.after : this._acc.before;
        A.n++; A.e += Math.hypot(pos.x - b.x, pos.z - b.z);
        if (pos.level && pos.level !== b.level) A.wf += 0.25;
      }
    }
    this._wave && this._stepWave(dt);
    this._stepMarker();
    if (this.arrived) return;
    // progress along the route
    this._lost.lastCheck -= dt;
    if (this._lost.lastCheck <= 0) {
      this._lost.lastCheck = 0.5;
      this._checkRoute(0.5);
    }
    // Aya's gentle, vague nudges while only the ordinary map is in hand
    if (!this.offered && this.nudges && !game.busy && !game.intro) {
      for (const n of this.nudges) if (!n.sent && this.t >= n.at && this.t < this._offerAt - 14) { n.sent = true; game.message(n.text); break; }
    }
    // the upgrade trigger
    if (!this.offered && !game.busy && !game.intro && !game.paused && this.t >= this._offerMin) {
      const lost = this._isLost();
      if (lost || this.t >= this._offerAt) this.offer(lost || 'time');
    }
    // arrival
    if (!game.busy && !game.intro && !game.paused && this.biz && b.level === this.biz.level) {
      const d = Math.hypot(b.x - this.biz.door.ox, b.z - this.biz.door.oz);
      if (d < DEMO.arriveRadius) this.arrive();
    }
  }

  _checkRoute(dt) {
    const { ctx, game } = this;
    const b = ctx.player.body, L = this._lost;
    if (WRONG_LEVELS.has(b.level)) L.wrongT += dt; else L.wrongT = Math.max(0, L.wrongT - dt * 0.5);
    if (this._field) {
      const d = safe(() => ctx.nav.distance(this._field, b));
      if (num(d) != null) {
        L.rem = d;
        if (d < L.best) L.best = d;
        // queue banter as the route shortens
        if (this.offered) for (const [at, text] of QUEUE_LINES) {
          if (d < at && !this._sent.has(at) && !game.busy) { this._sent.add(at); game.message(text); }
        }
      }
    }
  }
  // "clearly lost": a wrong floor for a while, walked well away from the goal, or
  // a long walk that has not got any closer. Returns a reason or null.
  _isLost() {
    const L = this._lost, { game } = this;
    const walked = game.journal.distance - this._walk0;
    if (L.wrongT > 7) return 'floor';
    if (L.rem != null && L.best < Infinity && L.rem - L.best > 75) return 'away';
    if (L.rem != null && L.init && walked > 250 && L.rem > L.init * 0.8) return 'far';
    return null;
  }

  // ---------------------------------------------------------------------------
  // Act 2: the upgrade
  offer(why = 'time') {
    if (this.offered) return;
    this.offered = true; this.offerT = this.t; this.offerWhy = why;
    const { ctx, game } = this;
    const ph = ctx.phone;
    if (ph && typeof ph.offerLodestone === 'function') {
      try { ph.offerLodestone(); } catch (e) { console.error('[demo] offerLodestone', e); game.message(UPGRADE.offer, 'Aya', 0, { link: 'lodestone' }); }
    } else {
      game.message(UPGRADE.offer, 'Aya', 0, { link: 'lodestone' });
    }
    ctx.events.emit('demo:offer', { why, t: this.t });
  }
  _onUpgrade(e) {
    const stage = e && e.stage;
    const { game } = this;
    if (stage === 'offer') { this.offered = true; if (this.offerT == null) { this.offerT = this.t; this.offerWhy = 'phone'; } }
    if (stage === 'installing' && this.installT == null) { this.offered = true; this.installT = this.t; }
    if (stage === 'ready' && !this.upgraded) {
      this.offered = true; this.upgraded = true;
      this.readyT = this.t; this.readyDist = game.journal.distance;
      game.after(3.0, () => { if (!this.arrived) game.message(UPGRADE.ready); });
    }
  }

  // ---------------------------------------------------------------------------
  // Act 3: arrival
  async arrive() {
    if (this.arrived) return;
    this.arrived = true; this.arriveT = this.t; this.arriveDist = this.game.journal.distance;
    const { ctx, game } = this;
    const hud = game.hud, b = this.biz, body = ctx.player.body;
    game.busy = true; game._syncFrozen();
    hud?.prompt(null);
    try { if (ctx.phone && ctx.phone.isOpen) ctx.phone.close(true); } catch (e) { /* optional */ }
    ctx.events.emit('demo:arrive', { slot: b.slot, t: this.t, upgraded: this.upgraded, summary: this.summary() });
    game.setQuest('tempura', 'done', 'Tempura Daikichi, Namba Parks 6F. Aya saved a seat.', true);
    ctx.audio?.play?.('tempura');

    // 1) walk the last few metres, eyes on the shopfront: the noren, the lanterns
    const nx = b.door.nx, nz = b.door.nz;
    const goal = { x: b.door.x + nx * 3.9, z: b.door.z + nz * 3.9 };
    const toDoor = { x: b.door.x - body.x, z: b.door.z - body.z };
    game.lookDir(toDoor.x, toDoor.z, 0.07, 2.6);
    const t0 = performance.now();
    const walk = async (ms) => {
      let last = performance.now();
      while (performance.now() - t0 < ms) {
        await sleep(16);
        const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
        if (game.paused) continue;
        const dx = goal.x - body.x, dz = goal.z - body.z, d = Math.hypot(dx, dz);
        if (d > 0.35) { const s = Math.min(d, 1.5 * dt); ctx.world.move(body, dx / d * s, dz / d * s, ctx.player.radius); }
        const tx = b.door.x - body.x, tz = b.door.z - body.z;
        game.lookDir(tx, tz, 0.07 + Math.min(0.1, (performance.now() - t0) / 20000), 2.6);
      }
    };
    await walk(2100);

    // 2) Aya, waving from the queue
    const aya = this._pickAya();
    if (aya) {
      this._aya = aya; this._wave = 3.6;
      game.lookDir(aya.x - body.x, aya.z - body.z, 0.0, 2.4);
      this._showMarker(true);
    } else {
      const c = safe(() => ctx.shops && ctx.shops.counter && ctx.shops.counter(b.slot));
      if (c) game.lookDir(c.x - body.x, c.z - body.z, -0.06, 1.8);
    }
    hud?.caption({ ja: ARRIVAL.aya.ja, en: ARRIVAL.aya.en, speaker: 'Aya', duration: 3.4 });
    ctx.audio?.play?.('notify');
    game.message(ARRIVAL.text, 'Aya', 1.2);
    await sleep(3100);

    // 3) the counter: the oil, the chef's nod
    const c = safe(() => ctx.shops && ctx.shops.counter && ctx.shops.counter(b.slot));
    if (c) game.lookDir(c.x - body.x, c.z - body.z, -0.09, 1.4); else game.lookDir(-nx, -nz, -0.04, 1.4);
    ctx.audio?.play?.('tempura');
    hud?.caption({ ja: 'いらっしゃいませ！お二人ですね、カウンターどうぞ。', en: 'Welcome in! Two of you? The counter, please.', speaker: 'Chef', duration: 3.4 });
    await sleep(2500);
    this._showMarker(false); this._wave = 0; this._aya = null;
    await this._end();
  }
  _pickAya() {
    const { ctx } = this, b = this.biz;
    const sim = ctx.crowd && ctx.crowd.sim;
    const B = sim && sim.places && sim.places.bizBySlot && sim.places.bizBySlot[b.slot];
    const q = B && B.queue ? B.queue.filter(a => a && a.alive && a.level === b.level) : [];
    if (!q.length) return null;
    return q[Math.min(2, q.length - 1)];       // "3rd in line"
  }
  _stepWave(dt) {
    const a = this._aya; if (!a) return;
    this._wave -= dt;
    if (this._wave <= 0) { this._wave = 0; return; }
    const p = this.ctx.player.body;
    a.pose = WAVE;
    a.yaw = Math.atan2(p.x - a.x, p.z - a.z);
  }
  sizzle() { this.ctx.audio?.play?.('tempura'); this.game.hud?.caption({ en: 'Sesame oil, hot and golden. Somewhere in there, a prawn is about to happen.', kind: 'thought', duration: 3.6 }); }

  // ---------------------------------------------------------------------------
  // Aya's name tag (a small label that follows her while she waves)
  _buildMarker() {
    const el = document.createElement('div');
    el.className = 'd-aya'; el.hidden = true;
    el.innerHTML = '<span class="d-aya-ring"></span><span class="d-aya-name">Aya <small>アヤ</small></span>';
    (this.ctx.ui.hud || document.body).appendChild(el);
    this._marker = el; this._markerOn = false;
  }
  _showMarker(on) { this._markerOn = on; if (!on && this._marker) { this._marker.classList.remove('on'); setTimeout(() => { if (!this._markerOn) this._marker.hidden = true; }, 600); } }
  _stepMarker() {
    const m = this._marker, a = this._aya; if (!m) return;
    if (!this._markerOn || !a) return;
    const { THREE, camera } = this.ctx;
    const v = new THREE.Vector3(a.x, (a.y || 0) + 1.95, a.z).project(camera);
    if (v.z > 1 || v.z < -1) { m.classList.remove('on'); return; }
    m.hidden = false;
    m.style.left = ((v.x * 0.5 + 0.5) * 100).toFixed(2) + '%';
    m.style.top = ((-v.y * 0.5 + 0.5) * 100).toFixed(2) + '%';
    m.classList.add('on');
  }

  // ---------------------------------------------------------------------------
  // Act 4: the end card
  summary() {
    const { ctx, game } = this;
    const ps = safe(() => ctx.phone && ctx.phone.stats && ctx.phone.stats()) || {};
    const A = this._acc;
    const mean = (x) => (x.n ? x.e / x.n : null);
    const tEnd = this.arriveT != null ? this.arriveT : this.t;
    const dEnd = this.arriveT != null ? this.arriveDist : game.journal.distance;
    const upgraded = this.upgraded && this.readyT != null;
    const before = {
      seconds: upgraded ? this.readyT : tEnd,
      meters: Math.max(0, (upgraded ? this.readyDist : dEnd) - this._walk0),
      err: num(ps.meanErrorBefore) ?? mean(A.before),
      wrongFloorS: num(ps.wrongFloorSeconds) ?? A.before.wf,
    };
    const after = upgraded ? {
      seconds: Math.max(0, tEnd - this.readyT),
      meters: Math.max(0, dEnd - this.readyDist),
      err: num(ps.meanErrorAfter) ?? mean(A.after) ?? 1.0,
      wrongFloorS: num(ps.wrongFloorSecondsAfter) ?? A.after.wf,
    } : null;
    return { upgraded, before, after, totalSeconds: tEnd, totalMeters: Math.max(0, dEnd - this._walk0), phone: ps, offerWhy: this.offerWhy, clock: ctx.clock.hhmm };
  }
  async _end() {
    if (this.ended) return;
    this.ended = true;
    const { ctx, game } = this;
    const s = this.summary();
    ctx.events.emit('demo:end', { summary: s });
    game._endCard = true; game._allowUnlock = true;
    try { ctx.input.exitLock(); } catch (e) { /* optional */ }
    this.card = showEndCard(ctx, s, {
      onRoam: () => this._roam(),
      onReplay: () => location.reload(),
    });
  }
  _roam() {
    const { ctx, game } = this;
    this.card && this.card.close();
    game._endCard = false; game._allowUnlock = false;
    game.busy = false; game.clearLook(); game._syncFrozen();
    try { ctx.input.requestLock(); } catch (e) { /* optional */ }
    game.hud?.caption({ en: 'Free roam. Namba is yours. Q for your phone.', kind: 'thought', duration: 4 });
  }
}
