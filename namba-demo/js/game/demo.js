// =============================================================================
// The demo director. One quest, three acts:
//   1. the ordinary map  (arrival at Nankai Namba, Aya's texts, a generic phone)
//   2. the upgrade       (Lodestone is offered when the player has engaged with
//                         Aya — said they're lost, or answered her check-in while
//                         clearly lost — with a fallback at DEMO.offerAt)
//   3. arrival           (a short visible moment at Daikichi, then the end card)
// v3: the conversation, the tutorial and every location-driven text live in
// story.js (this.story); this file keeps the measurements ("am I lost?", nav
// distance, positioning samples), the offer call, the arrival and the end card.
// Everything here is timed in REAL seconds of play (pause-aware), never in
// game minutes, so it does not matter how fast the world clock runs.
//
// Talks to the phone only through the contract in notes/demo-flow.md:
//   ctx.phone.offerLodestone()   (guarded; falls back to a plain Aya text)
//   'phone:upgrade' {stage}      ('ready' = Lodestone is live)
//   ctx.phone.stats()            (guarded; own fallbacks computed here)
// Emits 'demo:arrive' and 'demo:end'.
// =============================================================================
import { businessBySlot } from '../world/directory.js?v=454ed73';
import { params } from '../core/params.js?v=454ed73';
import { DEMO, UPGRADE, QUEUE_LINES, ARRIVAL, CANYON_TEXT } from './script.js?v=454ed73';
import { Story } from './story.js?v=454ed73';
import { makeLook, BIT } from '../npc/looks.js?v=454ed73';
import { showEndCard } from './endcard.js?v=454ed73';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const safe = (fn) => { try { return fn(); } catch (e) { return null; } };
const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
const WAVE = 5;                 // npc/sim.js POSE.WAVE
const STALL_S = 25, STALL_M = 8;   // lost = under 8 m of net progress toward Daikichi in 25 s
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
    this._sent = new Set(); this._canyonSent = false;
    this._lost = { wrongT: 0, best: Infinity, init: null, rem: null, lastCheck: 0, hist: [] };
    this.remReady = null; this.remArrive = null;     // nav distance to the door at the phase boundaries
    this._acc = { before: { n: 0, e: 0, wf: 0 }, after: { n: 0, e: 0, wf: 0 } };
    this._sampleT = 0; this._tpGuard = 0;
    this._seeded = false;
    this._aya = null; this._wave = 0;
    this._offerAt = params.has('offerat') ? +params.get('offerat') : DEMO.offerAt;
    this._offerMin = params.has('offerat') ? Math.min(DEMO.offerMin, this._offerAt) : DEMO.offerMin;
    this.story = new Story(ctx, game, this);
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
    ev.on('player:teleport', () => { this._tpGuard = 1.6; });
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
      // you are not the only one off the rapi:t: fellow passengers (suitcases, commuters) step out of the
      // doors around you over the first ~15 s and head for the gates, so the platform is alive from frame one
      game.after(0.3, () => { try { const D = ctx.crowd && ctx.crowd.behave && ctx.crowd.behave.director; if (D && D.onTrainArrive) D.onTrainArrive({ track: 'nk_track_4', line: 'nankai', platform: 'nk_plat_2', dwell: 40, force: true }, false); } catch (e) { /* the crowd is optional */ } });
      tt = DEMO.introHold;
    }
    // the terminal PA ("Namba, Namba. This is the last stop."): transit speaks it and the HUD captions it;
    // if nothing arrived by 1.8 s (no transit announcement, no audio), caption it ourselves
    let heard = false;
    const hear = (a) => { if (a && (a.start || a.kind === 'arrive' || a.kind === 'platform' || a.speaker === 'PA' || a.distant)) heard = true; };
    ev.on('announce', hear); ev.on('caption', hear);
    game.after(1.8, () => { if (!heard && !game.paused) hud?.caption({ ja: 'なんば、なんば、終点です。どなた様もお忘れ物のないよう、ご注意ください。', en: 'Namba, Namba. This is the last stop. Please take all your belongings with you.', kind: 'announce', duration: 6 }); });
    // v3: Aya's conversation + the tutorial woven into it (story.js): the phone buzzes as the opening look ends
    this.story.begin(tt);
  }

  // ---------------------------------------------------------------------------
  // Per-frame
  update(dt) {
    if (!this.began) return;
    const { ctx, game } = this;
    this.t += dt;
    const b = ctx.player.body;
    this.story.update(dt);
    // positioning samples: the phone's belief vs the truth (own fallback for phone.stats()). Never right after a
    // teleport (the phone needs a moment), and only in the phase the phone's own mode says we are in.
    this._sampleT -= dt; this._tpGuard -= dt;
    if (this._sampleT <= 0 && !this.ended && !this.arrived) {
      this._sampleT = 0.25;
      const pos = ctx.phone && ctx.phone.pos;
      if (pos && isFinite(pos.x) && isFinite(pos.z) && this._tpGuard <= 0 && !game.busy) {
        const A = pos.mode === 'lodestone' ? this._acc.after : this._acc.before;
        A.n++; A.e += Math.hypot(pos.x - b.x, pos.z - b.z);
        if (pos.level && pos.level !== b.level && b.ramp < 0) A.wf += 0.25;
      }
    }
    this._wave && this._stepWave(dt);
    this._stepMarker();
    if (this.arrived) return;
    // progress along the route
    if (!this._seeded && this.biz && b.level === this.biz.level && Math.hypot(b.x - this.biz.door.ox, b.z - this.biz.door.oz) < 70) this._seedQueue();
    this._lost.lastCheck -= dt;
    if (this._lost.lastCheck <= 0) {
      this._lost.lastCheck = 0.5;
      this._checkRoute(0.5);
    }
    // Lodestone's route runs through the Namba Parks canyon: Aya says so as the player reaches the bridge
    if (!this._canyonSent && !game.busy && !game.intro && !game.paused) {
      const sp = ctx.player.space && ctx.player.space.id;
      if (sp === 'parks_bridge' || (b.level === '2F' && b.x > -6 && b.x < 6 && b.z > 188 && b.z < 206)) { this._canyonSent = true; game.message(CANYON_TEXT); }
    }
    // (v3: the upgrade offer is the story's call — it follows the player engaging with Aya, see story.js)
    // arrival
    if (!game.busy && !game.intro && !game.paused && this.biz && b.level === this.biz.level) {
      const d = Math.hypot(b.x - this.biz.door.ox, b.z - this.biz.door.oz);
      // straight-line close AND close by foot (a shop across the corridor is not the door)
      const rem = this._lost.rem;
      if (d < DEMO.arriveRadius && (rem == null || rem < DEMO.arriveRadius + 5)) this.arrive();
    }
  }

  // Daikichi must have a modest queue when the player gets there. The crowd director only forms a queue when a
  // restaurant is full, so while the player is within ~70 m we seed 5 people on the stools (the same recipe as the
  // director's own initial fill) and hold admission until the arrival moment is over.
  _seedQueue() {
    this._seeded = true;
    const { ctx } = this, b = this.biz;
    safe(() => {
      const sim = ctx.crowd && ctx.crowd.sim, D = ctx.crowd && ctx.crowd.behave && ctx.crowd.behave.director;
      const B = sim && sim.places.bizBySlot[b.slot]; if (!D || !B) return;
      let n = 5 - B.queue.length; if (n <= 0) return;
      const seated = B.seated; B.seated = B.cap;              // so the first one does not walk straight in
      B.nextAdmit = sim.time + 900; this._held = B;
      for (let i = 0; i < n; i++) {
        const a = D._create('lunch', null);
        const sl = D.P.qSlot(B, B.queue.length);
        sim.setPos(a, B.level, sl.x, sl.z); a.yaw = sl.yaw;
        if (a.followers) { for (const f of a.followers) sim.kill(f); a.followers = null; }
        const dw = B.info.dwell || [900, 1800];
        const legs = [{ t: 'queue', B, max: 16 }, { t: 'dine', B, dur: (dw[0] + D.r() * (dw[1] - dw[0])) / ((sim.clock && sim.clock.scale) || 6) }];
        D._onward(legs, a, null, 7);
        D.B.begin(a, legs);
        a.fadeDir = 1;
      }
      B.seated = seated;
      const third = B.queue[Math.min(2, B.queue.length - 1)];
      if (third) this._dressAya(third);                      // dressed long before she is in view: no pop
    });
  }
  // nav-field distance (m) from the player to the Daikichi door right now, or the last good value
  _navRem() {
    const d = this._field ? safe(() => this.ctx.nav.distance(this._field, this.ctx.player.body)) : null;
    return num(d) != null ? d : this._lost.rem;
  }
  _releaseQueue() { if (this._held) { this._held.nextAdmit = 0; this._held = null; } }
  _checkRoute(dt) {
    const { ctx, game } = this;
    const b = ctx.player.body, L = this._lost;
    if (WRONG_LEVELS.has(b.level)) L.wrongT += dt; else L.wrongT = Math.max(0, L.wrongT - dt * 0.5);
    if (this._field) {
      const d = safe(() => ctx.nav.distance(this._field, b));
      if (num(d) != null) {
        L.rem = d;
        if (d < L.best) L.best = d;
        // a short history for the "stalled" rules (no real progress for 25-40 s); a minute is kept
        L.hist.push([this.t, d]);
        while (L.hist.length > 2 && L.hist[1][0] < this.t - 62) L.hist.shift();
        // queue banter as the route shortens ("the noren" line only once you are on the dining floor)
        if (this.offered) for (const [at, text] of QUEUE_LINES) {
          if (d < at && !this._sent.has(at) && !game.busy && (at > 100 || b.level === this.biz.level)) { this._sent.add(at); game.message(text); }
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
    // stalled: the nav distance to the door has not dropped by 8 m over the last 25 s (stuck at a gate, dithering in
    // a concourse, walking in circles). Peak frustration; the caller still enforces the 45 s minimum.
    const p = this.progressOver(STALL_S);
    if (p != null && p < STALL_M) return 'stalled';
    return null;
  }
  // metres of nav progress toward the door over the last `sec` seconds (null until that much history exists)
  progressOver(sec) {
    const H = this._lost.hist; if (H.length < 2) return null;
    const t0 = this.t - sec;
    if (H[0][0] > t0 + 1) return null;
    let i = 0;
    while (i < H.length - 2 && H[i + 1][0] <= t0) i++;
    return H[i][1] - H[H.length - 1][1];
  }

  // ---------------------------------------------------------------------------
  // Act 2: the upgrade
  offer(why = 'time') {
    if (this.offered) return;
    this.offered = true; this.offerT = this.t; this.offerWhy = why;
    const { ctx, game } = this;
    const ph = ctx.phone;
    const fallback = () => this.story.aya.say({ id: 'aya_lodestone', text: UPGRADE.offer, link: 'lodestone' }, { typing: 0, wait: 0 });
    if (ph && typeof ph.offerLodestone === 'function') {
      try { ph.offerLodestone({ text: UPGRADE.offer, why }); } catch (e) { console.error('[demo] offerLodestone', e); fallback(); }
    } else fallback();
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
      this.remReady = this._navRem();
      game.after(3.0, () => { if (!this.arrived) game.message(this.story.readyText ? this.story.readyText() : UPGRADE.ready); });
    }
  }

  // ---------------------------------------------------------------------------
  // Act 3: arrival
  async arrive() {
    if (this.arrived) return;
    this.arrived = true; this.arriveT = this.t; this.arriveDist = this.game.journal.distance;
    this.remArrive = this._navRem();
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
    const goal = { x: b.door.x + nx * 4.6, z: b.door.z + nz * 4.6 };
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
      this._clearSight(aya);
      this._lookAtAya(2.4);
      this._showMarker(true);
    } else {
      const c = safe(() => ctx.shops && ctx.shops.counter && ctx.shops.counter(b.slot));
      if (c) game.lookDir(c.x - body.x, c.z - body.z, -0.06, 1.8);
    }
    if (aya) hud?.caption({ ja: ARRIVAL.aya.ja, en: ARRIVAL.aya.en, speaker: 'Aya', duration: 3.4 });
    ctx.audio?.play?.('notify');
    // v4: her iced latte — handed over (the cup leaves your HUD), or a tease if you came empty-handed
    const st = this.story, coffee = st.hasCoffee, asked = st.errand.state !== 'none';
    // polish: the payoff runs on REAL time like the rest of this cut-scene (game.after / Aya's outbox run on game
    // time, which crawls when frames are slow, so on a slow machine the end card used to arrive first)
    const later = (ms, fn) => setTimeout(() => { if (!this.ended) { try { fn(); } catch (e) { console.error('[arrive]', e); } } }, ms);
    const text = (t) => { if (st.aya && st.aya.sayNow) st.aya.sayNow(t); else game.message(t, 'Aya'); };
    later(700, () => text(coffee ? ARRIVAL.textCoffee : ARRIVAL.text));
    if (coffee) {
      later(1500, () => { hud?.caption({ ja: ARRIVAL.thanks.ja, en: ARRIVAL.thanks.en, speaker: 'Aya', duration: 3.6 }); hud?.cup(false); ctx.audio?.play?.('cup'); });
    } else if (asked) later(2300, () => text(ARRIVAL.tease));
    await sleep(3100);

    // 3) back to the shopfront: the noren, the lanterns, the oil you can hear
    game.lookDir(b.door.x - body.x, b.door.z - body.z, 0.1, 1.3);
    ctx.audio?.play?.('tempura');
    hud?.caption({ ja: 'いらっしゃいませ！お二人ですね、カウンターどうぞ。', en: 'Welcome in! Two of you? The counter, please.', speaker: 'Chef', duration: 3.4 });
    await sleep(2500);
    this._showMarker(false); this._wave = 0; this._aya = null;
    this._releaseQueue();
    await this._end();
  }
  _pickAya() {
    const { ctx } = this, b = this.biz;
    const sim = ctx.crowd && ctx.crowd.sim;
    if (!sim) return null;
    const B = sim.places && sim.places.bizBySlot && sim.places.bizBySlot[b.slot];
    const q = B && B.queue ? B.queue.filter(a => a && a.alive && a.level === b.level) : [];
    let pick = q.length ? (q.find(a => a._aya) || q[Math.min(2, q.length - 1)]) : null;   // "3rd in line"
    if (!pick) {
      // nobody queueing: the nearest person standing about outside the door will do
      let bd = 1e9;
      safe(() => sim.near(b.level, b.door.ox, b.door.oz, 9, (a) => {
        if (!a || !a.alive || a.ramp >= 0 || a.mode !== 3 || a.fade < 0.5) return;
        const d = Math.hypot(a.x - b.door.ox, a.z - b.door.oz);
        if (d < bd) { bd = d; pick = a; }
      }));
    }
    if (pick) this._dressAya(pick);
    return pick;
  }
  // Aya must read at a glance: a young woman in a mustard coat with a red tote bag and long dark hair. The crowd
  // renders per-instance colours and accessory bit flags straight from agent.look / agent.flags every frame, so
  // swapping in a freshly made look is a safe, local edit (guarded: if the internals ever change, she stays as she was).
  _dressAya(a) {
    if (!a || a._aya) return;
    try {
      let k = 1; const r = () => ((k = (k * 16807) % 2147483647) / 2147483647);        // fixed seed: always the same Aya
      const L = makeLook('shopper', r, { female: true, bags: 0 });
      const keep = (1 << BIT.PHONE);
      let f = a.flags & keep;
      f |= (1 << BIT.COAT) | (1 << BIT.TOTE) | (1 << BIT.TIGHTS) | (1 << BIT.JACKET) | (2 << 13);   // coat, tote, tights, long hair
      L.flags = f; L.h = 0.935; L.build = 0.93; L.stride = 0.95;
      L.colA = [0xe3a41c, 0x1e2333, 0xf1efe9, 0x1d1714];      // mustard coat, navy legs, white sneakers, dark hair
      L.colB = [0xeed2bd, 0xf4f4f1, 0xc8283c, 0xc8283c];      // fair skin, white inner, RED tote
      a.look = L; a.flags = f; a._aya = true;
    } catch (e) { /* cosmetic only */ }
  }
  // Anyone standing right on the line between the player's eyes and Aya fades out (the queue shuffles into the
  // restaurant): she must be seen, not guessed at behind a stranger's back. At most two people, only those in front of her.
  _clearSight(aya) {
    safe(() => {
      const sim = this.ctx.crowd && this.ctx.crowd.sim, b = this.ctx.player.body; if (!sim) return;
      const dx = aya.x - b.x, dz = aya.z - b.z, L = Math.hypot(dx, dz); if (L < 0.8) return;
      const ux = dx / L, uz = dz / L, hits = [];
      sim.near(aya.level, b.x + dx * 0.5, b.z + dz * 0.5, L * 0.5 + 1, (a) => {
        if (!a || a === aya || !a.alive || a.ramp >= 0) return;
        const t = (a.x - b.x) * ux + (a.z - b.z) * uz;
        if (t < 0.3 || t > L - 0.25) return;                         // behind the player, or behind/beside her
        if (Math.abs((a.x - b.x) * uz - (a.z - b.z) * ux) < 0.5) hits.push(a);
      });
      for (const a of hits.slice(0, 2)) { a.fadeDir = -1; if (a.followers) for (const f of a.followers) f.fadeDir = -1; }
    });
  }
  _lookAtAya(rate) {
    const a = this._aya, body = this.ctx.player.body; if (!a) return;
    const dx = a.x - body.x, dz = a.z - body.z, d = Math.max(0.5, Math.hypot(dx, dz));
    const eye = (this.ctx.player.eye || 1.62), head = 1.5 * (a.look ? a.look.h : 0.93);
    this.game.lookDir(dx, dz, Math.max(-0.25, Math.min(0.25, Math.atan2(head - eye, d))), rate);
  }
  _stepWave(dt) {
    const a = this._aya; if (!a) return;
    this._wave -= dt;
    if (this._wave <= 0) { this._wave = 0; return; }
    const p = this.ctx.player.body;
    this._lookAtAya(3.2);                         // keep her dead centre while she waves
    a.pose = WAVE;
    a.yaw = Math.atan2(a.x - p.x, a.z - p.z);   // agents face (-sin yaw, -cos yaw), like the player
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
    const mean = (x) => (x.n >= 8 ? x.e / x.n : null);        // too few samples = no number, never a fake one
    const tEnd = this.arriveT != null ? this.arriveT : this.t;
    const dEnd = this.arriveT != null ? this.arriveDist : game.journal.distance;
    const upgraded = !!(this.upgraded || ps.upgraded);
    const pB = num(ps.samplesBefore) > 0, pA = num(ps.samplesAfter) > 0;   // the phone measured that phase itself
    const mineBeforeS = upgraded && this.readyT != null ? this.readyT : tEnd;
    const mineBeforeM = Math.max(0, (upgraded && this.readyT != null ? this.readyDist : dEnd) - this._walk0);
    const before = {
      seconds: pB && num(ps.secondsBefore) != null ? ps.secondsBefore : mineBeforeS,
      meters: pB && num(ps.metresBefore) != null ? ps.metresBefore : mineBeforeM,
      err: pB ? num(ps.meanErrorBefore) : mean(A.before),
      wrongFloorS: pB ? num(ps.wrongFloorSeconds) : (A.before.n >= 8 ? A.before.wf : null),
    };
    const after = upgraded ? {
      seconds: pA && num(ps.secondsAfter) != null ? ps.secondsAfter : (this.readyT != null ? Math.max(0, tEnd - this.readyT) : null),
      meters: pA && num(ps.metresAfter) != null ? ps.metresAfter : Math.max(0, dEnd - this.readyDist),
      err: pA ? num(ps.meanErrorAfter) : mean(A.after),
      wrongFloorS: pA ? num(ps.wrongFloorSecondsAfter) : (A.after.n >= 8 ? A.after.wf : null),
    } : null;
    // Net progress toward the door, in metres per minute: how much the nav distance to Daikichi dropped over the
    // phase, divided by the phase's minutes. Honest whatever route each phase happened to cover (can be ~0 or
    // negative while lost). A phase under ~10 s is too short to rate.
    const rate = (r0, r1, sec) => { const v = num(r0) != null && num(r1) != null && num(sec) != null && sec >= 10 ? (r0 - r1) / (sec / 60) : null; return v != null && v < 200 ? v : null; };   // > 200 m/min = a teleport, not a walk
    const r0 = this._lost.init, rEnd = this.remArrive != null ? this.remArrive : this._lost.rem;
    const progress = upgraded && this.readyT != null
      ? { before: rate(r0, this.remReady, this.readyT), after: rate(this.remReady, rEnd, tEnd - this.readyT) }
      : { before: rate(r0, rEnd, tEnd), after: null };
    // v6 (item 9): fair per-unit metrics for the end card, all measured, nothing fabricated.
    //  · p90 error and % of time on the wrong floor from the phone's own once-a-second samples (stats().series), or the
    //    Phone agent's ready-made fields when it publishes them (notes/v6-phone.md); our 4 Hz samples as the fallback
    //  · detour = metres walked per metre the nav distance to Daikichi actually dropped (null when < 20 m was gained)
    //  · wrong turns per km, when the phone measures them (Phone: wrongWaysPerKm*, errP90*, wrongFloorPct*, detour*)
    const ser = Array.isArray(ps.series) ? ps.series : null;
    const fromSeries = (ph) => {
      if (!ser) return null;
      const e = [], n = { w: 0, in5: 0 };
      for (const r of ser) if (r && r[3] === ph && isFinite(r[1])) { e.push(r[1]); if (r[2]) n.w++; else if (r[1] <= 5) n.in5++; }
      if (e.length < 15) return null;
      e.sort((x, y) => x - y);
      return { p90: e[Math.min(e.length - 1, Math.floor(e.length * 0.9))], wrongPct: (n.w / e.length) * 100, within5: (n.in5 / e.length) * 100, n: e.length };
    };
    const pick = (...v) => { for (const x of v) if (num(x) != null) return x; return null; };
    // the phone's own field wins whenever the phone publishes it — including its null ("not enough data to rate")
    const P = (k, own) => (ps && Object.prototype.hasOwnProperty.call(ps, k) ? num(ps[k]) : num(own));
    const SB = fromSeries(0), SA = fromSeries(1);
    const own4 = (X) => (X.n >= 40 ? (X.wf / (X.n * 0.25)) * 100 : null);
    before.p90 = P('errP90Before', SB && SB.p90);
    before.wrongPct = P('wrongFloorPctBefore', pick(SB && SB.wrongPct, own4(A.before)));
    before.dotWithin5 = P('dotWithin5Before', SB && SB.within5);       // v7.2: % of walking time the phone's dot was within 5 m of you
    before.turnsPerKm = P('wrongWaysPerKmBefore', null);
    before.reroutesPerKm = P('reroutesPerKmBefore', null); before.headingErr = P('headingErrBefore', null); before.headingSettle = P('headingSettleBefore', null);
    before.onTrackPct = P('onTrackPctBefore', null); before.offRouteSec = P('offRouteSecBefore', null);   // v7.3
    if (after) {
      after.p90 = P('errP90After', SA && SA.p90);
      after.wrongPct = P('wrongFloorPctAfter', pick(SA && SA.wrongPct, own4(A.after)));
      after.dotWithin5 = P('dotWithin5After', SA && SA.within5);
      after.turnsPerKm = P('wrongWaysPerKmAfter', null);
      after.reroutesPerKm = P('reroutesPerKmAfter', null); after.headingErr = P('headingErrAfter', null); after.headingSettle = P('headingSettleAfter', null);
      after.onTrackPct = P('onTrackPctAfter', null); after.offRouteSec = P('offRouteSecAfter', null);
    }
    const gain = (r0x, r1x) => (num(r0x) != null && num(r1x) != null ? r0x - r1x : null);
    const detour = (m, g) => (num(m) != null && g != null && g >= 20 ? m / g : null);
    if (upgraded && this.readyT != null) {
      before.gained = gain(this._lost.init, this.remReady); before.detour = P('detourBefore', detour(before.meters, before.gained));
      if (after) { after.gained = gain(this.remReady, this.remArrive != null ? this.remArrive : this._lost.rem); after.detour = P('detourAfter', detour(after.meters, after.gained)); }
    } else {
      before.gained = gain(this._lost.init, this.remArrive != null ? this.remArrive : this._lost.rem); before.detour = P('detourBefore', detour(before.meters, before.gained));
    }
    const E = this.story.errand;
    const errand = E.state === 'none' ? null : { delivered: !!E.got, item: E.got ? E.got.item : null, cafe: E.got ? E.got.name : E.name, mine: !!(E.got && E.got.slotId === E.slot) };
    return { upgraded, before, after, progress, totalSeconds: tEnd, totalMeters: Math.max(0, dEnd - this._walk0), phone: ps, offerWhy: this.offerWhy, clock: ctx.clock.hhmm, errand };
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
