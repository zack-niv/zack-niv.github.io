// =============================================================================
// v3 items 1 + 5: the opening is a short in-game tutorial, and Aya's v2 beats
// are gated on the player (replies + where they are) instead of timers.
//
//   tutorial (~60-90 s): look → walk → Q phone up → answer Aya → open Maps → E.
//     Each step is validated by the real action (any order), shows one small
//     hint, nudges after ~12 s of inaction, and never blocks movement.
//   Aya (v2 texts): "Landed??" arrives once you have looked + walked (or ~8 s)
//     and asks for a reply; "Meet me at Tempura Daikichi…" follows the answer
//     (or 30 s / 30 m of ignoring it). "Where are you??" is sent when the player
//     is clearly lost / stalled / on a wrong floor (not at 58 s) and asks
//     "I'm lost 😭" / "On my way!".
//   Lodestone offer = engagement: "I'm lost", or "On my way!" while the director
//     says you're lost (then "Ask your phone!" → offer). Fallback at DEMO.offerAt.
// v4 (items 4 + 6): right after "Meet me…" Aya asks for an iced latte from a café
//   off the straight line (DEMO.coffeeSlot, CITY 1F) and suggests it in the
//   phones' destination lists. The tutorial's Maps step is now "pick where to
//   go" (any pick counts; a different pick gets one light reaction). Ordering
//   there ('demo:order') → she suggests Daikichi and a short "next stop" hint
//   shows. Walking on past the café without it → one tease, never a block.
// Words in script.js (AYA, UPGRADE, TUTORIAL); measurements in demo.js.
// v9 (notes/v9-progression.md): every beat is gated on the conversation + whereabouts + time, never time alone.
//   HELLO? ─reply─► MEET? (On my way / Which way??) ─► LATTE? (Sure / Not today) — each waits for its answer, Aya
//   nudges ("hello?? 👀") and then follows up naturally (aya.js patience). The latte is asked only if the player is
//   not already past the café (else the errand is dropped). "Where are you??" needs no fresh question and real
//   lostness against the ACTIVE target (the café during the errand; demo.setTarget), never while on task or right
//   after buying her latte. The offer: I'm lost · On my way while lost · early "Which way??" + no progress ·
//   Where unanswered 45 s ('silent') · reaching Parks first ('ahead') · fallback 195 s (+15 s grace for a fresh
//   (v10, V10.md: no fixed-clock beats — check-ins only when behind Aya's expectation for the leg or really lost, with
//   words for the real state; offers at the places Maps fails: 'floors' (CITY, latte leg) and 'parks' (Parks entry);
//   the 240 s cap is only a never-stall guard and logs 'story:timer'. Every beat logs 'story:beat' {id, why}.)
//   question or the café counter); its words fit the why. The offer closes any open question (no stale chips).
// =============================================================================
import { AYA, TUTORIAL, DEMO, ERRAND_DRINK, UPGRADE, LATTE_REFUSABLE } from './script.js?v=9ec3217';
import { businessBySlot } from '../world/directory.js?v=9ec3217';
import { LEVEL_ORDER, LAYOUT, rampEnds } from '../world/layout.js?v=9ec3217';
import { Aya } from './aya.js?v=9ec3217';
import { Tutorial } from './tutorial.js?v=9ec3217';

export class Story {
  constructor(ctx, game, demo) {
    this.ctx = ctx; this.game = game; this.demo = demo;
    // v11: was the 📸 really taken? (registered before Aya's own listener, so her onReply already knows)
    ctx.events.on('phone:reply', (e) => { if (e && e.photo) this._photoOk = e.img !== false; });
    this.aya = new Aya(ctx, game);
    this.tut = new Tutorial(ctx, game);
    this.t = 0; this._tick = 0;
    this.f = { raised: false, maps: false, mapsT: 0, interacted: false, walk0: 0, look: 0, lastYaw: null };
    this.engaged = null; this._offering = false;
    this.helloT = null; this.whereT = null; this._checkins = {};
    this._meetDone = false;                  // v9: Meet answered or given up — the latte gate opens
    // v4: the coffee errand. state: 'none' → 'asked' → 'done' (got a coffee) | 'skipped' (walked on without one)
    // v9: | 'declined' ("Not today 🙈") | 'dropped' (already past the café when she would have asked: never asked)
    const cb = businessBySlot[DEMO.coffeeSlot] || null;
    this.errand = { slot: cb ? DEMO.coffeeSlot : null, biz: cb, name: cb ? cb.en : 'the café', state: 'none', got: null, at: null };
    this.f.picked = false; this.f.picks = 0; this.f.pick2 = false; this.f.atCafe = false;
    this.suggested = null; this._reacted = false; this._leg2 = false;
  }
  // the phone's destination list (v4 contract) — feature-detected, v3 behaviour without it
  get dests() { const p = this.ctx.phone; return !!(p && typeof p.suggest === 'function'); }
  _suggest(slot) {
    this.suggested = slot;
    const p = this.ctx.phone;
    if (p && typeof p.suggest === 'function') { try { p.suggest(slot); } catch (e) { console.error('[story] suggest', e); } }
  }
  _destSlot() { const p = this.ctx.phone, d = p && p.destination; return d && d.slotId || null; }
  get hasCoffee() { return !!this.errand.got; }
  // order.js: the drink the player orders at the errand café while Aya is waiting for it
  errandDrink(slot) { return this.errand.state === 'asked' && slot === this.errand.slot ? Object.assign({ errand: true }, ERRAND_DRINK) : null; }
  // Lodestone's first line once it is live: about the latte while that's where it is taking you
  readyText(second) { return this.errand.state === 'asked' && (!this._destSlot() || this._destSlot() === this.errand.slot) ? UPGRADE.readyCoffee : second ? UPGRADE.ready2 : UPGRADE.ready; }
  get walked() { return Math.max(0, this.game.journal.distance - this.f.walk0); }
  _free() { const g = this.game; return !g.busy && !g.intro && !g.paused && !this.demo.arrived && !g.ended; }

  begin(tHold) {
    const { ctx, game } = this, ev = ctx.events;
    this.f.walk0 = game.journal.distance;
    this.tHold = tHold;
    ev.on('phone:pose', (e) => { if (e && e.pose === 'up') { this.f.raised = true; this.tut.poke('raise'); } });
    ev.on('phone:open', () => { this.f.raised = true; });
    ev.on('phone:app', (e) => { if (e && e.app === 'maps' && this.aya.wasSent('meet')) this.f.maps = true; });
    ev.on('interact', () => { this.f.interacted = true; });
    // v6 (item 2): the gate teaches E. A player tap ('gate:tap', notes/v6-gates.md) is the lesson; walking into a lane
    // untapped ('gate:blocked' reason 'notap') brings a short "tap first" hint back
    const mine = (e) => !!(e && (e.player === true || (e.player == null && this.game._isPlayerGateEv && this.game._isPlayerGateEv(e))));
    ev.on('gate:tap', (e) => { if (mine(e)) { this.f.gateTapped = true; this.f.blockedT = null; } });   // v6 critic: a tap ends the "tap first" hint (it sat beside "Open — walk through")
    // only the player is ever blocked; 'lane' (wrong-way channel) and a refused card get their own words in game.js
    ev.on('gate:blocked', (e) => { if (e && (!e.reason || e.reason === 'notap')) { this.f.blockedT = this.t; this.f.blocks = (this.f.blocks || 0) + 1; this.tut.poke('gate'); } });
    // v4: the player chose a destination in Maps or Lodestone (any pick satisfies the step)
    ev.on('nav:destination', (e) => this._onPick(e || {}));
    ev.on('nav:arrived', (e) => { if (e && e.slotId && e.slotId === this.errand.slot) this.f.atCafe = true; });
    ev.on('demo:order', (e) => this._onOrder(e || {}));
    this._steps();
  }
  _onPick(e) {
    this.f.picked = true; this.f.picks++;
    if (this._leg2) this.f.pick2 = true;
    this.ctx.events.emit('story:pick', { slotId: e.slotId, suggested: this._isSuggested(e), leg: this._leg2 ? 2 : 1 });
    // v11: no reaction to your pick — Aya can't see your Maps app (V11.md item 3)
  }
  _isSuggested(e) { return e.suggested === true || (!!e.slotId && e.slotId === this.suggested); }
  _onOrder(e) {
    const E = this.errand;
    if (e.kind !== 'cafe' || !e.item || E.state === 'done' || E.state === 'none' || E.state === 'dropped') return;
    const mine = e.slotId === E.slot;
    const was = E.state;
    E.state = 'done'; E.got = { slotId: e.slotId, name: e.name, item: e.item }; E.at = this.t;
    this.demo.setTarget && this.demo.setTarget('dk');
    this.game.setQuest('coffee', 'done', mine ? `${e.item} from ${E.name}, to go` : `${e.item} from ${e.name || 'a café'} (close enough)`, true);
    // v11: she only knows because YOU text her (she can't see you buy it)
    this._mine(mine ? AYA.mineCoffee : AYA.mineOtherCoffee.replace('{name}', e.name || 'a café'));
    if (was === 'skipped' || was === 'declined') { this.aya.say('wait is that a coffee?? for ME?? 🥹', { wait: 2.6 }); return; }
    this.aya.say({ text: mine ? AYA.gotCoffee : AYA.gotOtherCoffee.replace('{cafe}', E.name), place: DEMO.slot }, { wait: 2.6, run: () => this._leg2Start() });
  }
  // the second leg: Daikichi becomes Aya's pick and a short "next stop" hint shows (not the full tutorial again)
  _leg2Start() {
    if (this._leg2) return;
    this._leg2 = true;
    this._suggest(DEMO.slot);
    const ph = () => this.ctx.phone || {};
    const up = () => !!ph().isOpen;
    this.tut.add({ id: 'pick2', late: true, delay: 3.5,
      available: () => !this.aya.busy() && this.dests,
      done: () => this.f.pick2 || this._destSlot() === DEMO.slot || !this.dests || this.demo.arrived,
      hint: () => {
        if (!up()) return { html: TUTORIAL.pick2Down, at: 'phone' };
        const d = ph().destination;      // still routing somewhere else (not arrived): the list is one step away
        const routing = d && !d.arrived && d.slotId !== DEMO.slot;
        return { html: routing ? (ph().app === 'lodestone' ? TUTORIAL.pick2RouteLs : TUTORIAL.pick2Route) : TUTORIAL.pick2, at: 'phoneup' };
      } });
  }
  _sendCoffee() {
    const E = this.errand;
    if (!E.slot || E.state !== 'none') return;
    this._coffeeQueued = true;
    this._beat('coffee', this._meetHow || 'reply');
    this.aya.say({ id: 'coffee', text: AYA.coffee.text.replace('{cafe}', E.name), place: E.slot, replies: LATTE_REFUSABLE ? AYA.coffeeReplies : AYA.coffeeRepliesYes }, { wait: 1.2,
      run: () => {
        E.state = 'asked';
        this._suggest(E.slot);
        this.game.setQuest('coffee', 'active', null, true);
        this.demo.setTarget && this.demo.setTarget('cafe');
        this._orderStep();
      },
      // v9: silence = yes (chips withdrawn after 25 s); the question dies with the errand (ordered / walked past)
      patience: [null, DEMO.latteGiveUp], valid: () => E.state === 'asked',
      onReply: (r) => { if (r === 'no') this._declineCoffee(); else this.aya.say(AYA.coffeeYes, { wait: 0.5 }); } });
  }
  _declineCoffee() {
    const E = this.errand; if (E.state !== 'asked') return;
    E.state = 'declined';
    this.game.setQuest('coffee', 'hidden', null, true);
    this.demo.setTarget && this.demo.setTarget('dk');
    this.aya.say({ text: AYA.coffeeNo, place: DEMO.slot }, { wait: 0.8, run: () => this._leg2Start() });
  }
  // v9: Daikichi-distance of the café door; "past the café" = clearly nearer Daikichi than the café is
  _cafeDkm() {
    const E = this.errand, d = this.demo;
    if (this._cafeDk == null && E.biz && d._field && this.ctx.nav) {
      const b = E.biz, v = this.ctx.nav.nodeAtPoint(b.level, b.door.ox, b.door.oz);
      const x = v >= 0 ? d._field.dist[v] : null;
      this._cafeDk = typeof x === 'number' && isFinite(x) ? x : -1;
    }
    return this._cafeDk;
  }
  _pastCafe(margin) { const c = this._cafeDkm(), rem = this.demo._lost.rem; return c != null && c > 0 && rem != null && rem < c - margin; }
  // v9: the latte is asked once Meet is answered (or given up), Aya is free, and the player is not already past the café
  _coffeeGate() {
    const E = this.errand;
    if (!E.slot || E.state !== 'none' || this._coffeeQueued || !this._meetDone || this.aya.busy() || this.aya.fresh()) return;
    if (this._pastCafe(10)) { E.state = 'dropped'; this.ctx.events.emit('story:errand', { state: 'dropped', t: +this.t.toFixed(1) }); return; }
    this._sendCoffee();
  }
  // at the café without the coffee yet: one line on how to order (the counter prompt does the rest)
  _orderStep() {
    const E = this.errand, b = E.biz;
    const near = () => {
      if (this.f.atCafe) return true;
      const p = this.ctx.player && this.ctx.player.body; if (!p || !b || !b.door || p.level !== b.level) return false;
      return Math.hypot(p.x - b.door.ox, p.z - b.door.oz) < 13;
    };
    this.tut.add({ id: 'order', late: true, delay: 2.5,
      // v7: E works with the phone up (it lowers the phone and orders), so the hint shows then too once you face the counter
      available: () => { if (E.state !== 'asked' || !near()) return false; if (!(this.ctx.phone && this.ctx.phone.isOpen)) return true; const t = this.game.interactions && this.game.interactions.target; return !!(t && !t.passive && /^order:/.test(t.id)); },
      done: () => E.state !== 'asked',
      hint: () => { const t = this.game.interactions && this.game.interactions.target; return { html: TUTORIAL.order, at: t && !t.passive ? 'prompt' : 'center' }; } });
  }
  // walked on well past the café without the latte (nearer Daikichi than the café is): one tease, then Daikichi
  _checkSkip() {
    const E = this.errand, d = this.demo;
    if (E.state !== 'asked' || !E.biz || !d._field || !this.ctx.nav) return;
    if (!this._pastCafe(40) || !this.aya.idle(4)) return;
    E.state = 'skipped';
    this.game.setQuest('coffee', 'hidden', null, true);
    this.demo.setTarget && this.demo.setTarget('dk');
    // v11: she can't know you walked past the café — no text; she finds out at the counter (ARRIVAL.tease)
    this._leg2Start();
  }
  _sendHello() {
    if (this.helloT != null) return;
    this.helloT = this.t; this._helloW = this.walked;
    // v9: she waits for the answer; "hello?? 👀" after 20 s (or 30 m walked), then the plan anyway
    this.aya.say(AYA.hello, { typing: 1.3, wait: 0,
      patience: [DEMO.helloNudge, DEMO.helloNudge + DEMO.helloGiveUp], nudge: AYA.helloNudge,
      onReply: (r) => { const ack = AYA.helloAck[r]; if (ack) this.aya.say(ack, { wait: 0.5 }); this._sendMeet(0.9, false); },
      onTimeout: () => this._sendMeet(0.4, true),
      onExpire: () => this._sendMeet(0.4, true) });
  }
  _sendMeet(wait, anyway) {
    if (this._meetQueued) return;
    this._meetQueued = true;
    const m = Object.assign({}, AYA.meet);
    if (anyway) m.text = AYA.meetAnyway + m.text;
    this._beat('meet', anyway ? 'patience' : 'reply');
    const done = (how) => { this._meetDone = true; if (!this._meetHow) this._meetHow = how; };
    this.aya.say(m, { wait,
      run: () => { this.game.setQuest('tempura', 'active', null, true); this._meetW = this.walked; },
      patience: [null, DEMO.meetGiveUp], onTimeout: () => done('patience'), onExpire: () => done('patience'),
      onReply: (r, reply) => {
        done('reply');
        // "Which way?? 😵": an early cry for help — she points at Maps for now; it earns the offer sooner (see _beforeOffer)
        if (reply && reply.lost) { this.engaged = this.engaged || 'early'; this.aya.say(AYA.meetLost, { wait: 0.6 }); }
      } });
  }
  // v9: walking on while Aya waits counts as an answer of sorts (the nudge comes sooner, she moves on sooner)
  _walkPatience() {
    const o = this.aya.open; if (!o) return;
    const id = o.msg.id;
    if (id === 'hello') {
      if (o.nudged && this._nudgeW == null) this._nudgeW = this.walked;
      if (!o.nudged && this.walked - this._helloW >= DEMO.helloNudgeM) { if (!this.aya.busy()) this.aya.nudgeNow(); }
      else if (o.nudged && this.walked - this._nudgeW >= DEMO.helloGiveUpM && !this.aya.busy()) this.aya.closeOpen('walked', true);
    } else if (id === 'meet' && this._meetW != null && this.walked - this._meetW >= DEMO.meetGiveUpM && !this.aya.busy()) this.aya.closeOpen('walked', true);
  }

  _steps() {
    const { ctx, aya } = this, ph = () => ctx.phone || {};
    const up = () => !!ph().isOpen;
    const readHint = { html: 'Read Aya\'s message', at: 'phoneup' };
    this.tut.start([
      { id: 'look', delay: 0.6, done: () => this.f.look > 1.0, hint: () => ({ html: TUTORIAL.look, at: 'center' }) },
      { id: 'move', delay: 0.4, done: () => this.walked >= 8, hint: () => ({ html: TUTORIAL.move, at: 'center' }) },
      { id: 'raise', core: true,
        available: () => aya.wasSent('hello'),
        done: () => this.f.raised,
        hint: () => ({ html: this._raiseHold ? TUTORIAL.raiseHold : TUTORIAL.raise, at: 'phone' }),
        nudge: (n) => { if (n >= 2) this._raiseHold = true; } },
      // v9: any open question teaches replying; done on a REAL answer (or once the latte was asked: taught 3× by then)
      { id: 'reply', core: true,
        available: () => !!aya.open,
        done: () => aya.replied > 0 || aya.wasSent('coffee') || (this._meetDone && !aya.open && (!this.errand.slot || this.errand.state === 'dropped')),
        hint: () => (up() ? (aya.rich ? { html: TUTORIAL.reply, at: 'phoneup' } : readHint) : { html: TUTORIAL.replyDown, at: 'phone' }) },
      // v4: "choose where to go" — open Maps and pick a place (Aya's pick is highlighted; any pick counts).
      // Without the phone's destination list (older phone) the v3 rule holds: opening Maps is enough.
      { id: 'pick', core: true, delay: 1.0,
        // v9: never beside fresh latte chips (one glance, one decision); a dropped errand picks from Meet's card
        available: () => (aya.wasSent('coffee') || (this._meetDone && (!this.errand.slot || this.errand.state === 'dropped'))) && !aya.busy()
          && !(aya.open && aya.fresh()),     // v9 critic: nor beside a fresh "Where are you??" (silent-110.png)
        done: () => this.f.picked || (!this.dests && this.f.maps),
        hint: () => {
          if (!up()) return { html: this.dests ? TUTORIAL.pickDown : TUTORIAL.mapsDown, at: 'phone' };
          const app = ph().app;
          if (this.dests && app === 'messages' && ph().messages && ph().messages.lastPlace) return { html: TUTORIAL.pickMsg, at: 'phoneup' };
          return this.dests && (app === 'maps' || app === 'lodestone') ? { html: TUTORIAL.pick, at: 'phoneup' } : { html: TUTORIAL.maps, at: 'phoneup' };
        } },
    ]);
    this._gateSteps();
  }
  // v6 (item 2): "Tap your IC card at the gate (E)". A late step (it takes over from whatever else is being taught the
  // moment you reach the gate line, and is always taught, even on a replay: you cannot get through without it).
  _gateSteps() {
    const g = this.game, ph = () => this.ctx.phone || {};
    // v7: E works with the phone raised (game.js), so the gate lesson shows with it up too — at the channel or after the
    // flaps stopped you (the tip steps aside to the left of the phone). Merely "near the gate" with the phone up stays
    // the phone's own hint (reply / pick), so walking towards the gate behind Maps isn't nagged.
    const aimed = () => { const t = g.interactions && g.interactions.target; return !!(t && t.id === 'gatetap' && g._gateTgt); };
    const blocked = () => this.f.blockedT != null && this.t - this.f.blockedT < 5;
    const hint = (base) => () => {
      if (blocked()) return { html: TUTORIAL.gateBlocked, at: aimed() ? 'prompt' : 'center' };
      return aimed() ? { html: TUTORIAL.gateHere, at: 'prompt' } : base && !ph().isOpen ? { html: base, at: 'center' } : null;
    };
    this.tut.add({ id: 'gate', late: true, delay: 0.3,
      available: () => (aimed() || blocked() || (!ph().isOpen && this._nearGate())) && g._newGates && g._newGates(),
      done: () => this.f.gateTapped,
      hint: hint(TUTORIAL.gate) });
    // after the lesson: walking into a lane untapped again brings back the one-liner for a few seconds
    this.tut.add({ id: 'gateAgain', late: true, delay: 0,
      available: () => this.f.gateTapped && blocked(),
      done: () => false,
      hint: hint(null) });
  }
  // while the gate lesson is pending and you are near the line, the IC reader pads pulse (Gates: setGateHint)
  _gatePulse() {
    const tr = this.ctx.transit; if (!tr || typeof tr.setGateHint !== 'function') return;
    const want = !this.f.gateTapped && !this.game.paused && this._nearGate() ? this._nearGateId : null;
    if (want === this._pulsing) return;
    this._pulsing = want;
    try { tr.setGateHint(want || null); } catch (e) { /* cosmetic */ }
  }
  // on the paid side of a gate line, within ~12 m of it (the Nankai central gate right after the platform)
  _nearGate() {
    const g = this.game, p = this.ctx.player && this.ctx.player.body; if (!p || !g._gates) return false;
    for (const { gt, paidSign } of g._gates) {
      if (gt.level !== p.level) continue;
      const along = gt.axis === 'x' ? p.x : p.z, across = (gt.axis === 'x' ? p.z : p.x) - gt.at;
      if (along > gt.from - 3 && along < gt.to + 3 && Math.abs(across) < 12 && across * paidSign > 0) { this._nearGateId = gt.id; return true; }
    }
    return false;
  }
  update(dt) {
    const { ctx, demo, aya } = this;
    this.t += dt;
    aya.update(dt);
    const ph = ctx.phone, p = ctx.player;
    if (ph && ph.isOpen && ph.app === 'maps' && aya.wasSent('meet')) { this.f.mapsT += dt; if (this.f.mapsT > 0.5) this.f.maps = true; } else this.f.mapsT = 0;
    // "look": radians of yaw turned by the player (not by the intro camera)
    if (p && !this.game.intro && !this.game._look) {
      if (this.f.lastYaw != null) { let d = p.yaw - this.f.lastYaw; d = Math.atan2(Math.sin(d), Math.cos(d)); if (Math.abs(d) < 0.5) this.f.look += Math.abs(d); }
      this.f.lastYaw = p.yaw;
    } else if (p) this.f.lastYaw = p.yaw;
    this.tut.update(dt);
    this._gatePulse();

    this._tick -= dt;
    if (this._tick > 0) return;
    this._tick = 0.5;
    if (!this._free()) return;
    // the phone buzzes once you have had a look and a few steps (or after a few seconds anyway)
    if (this.helloT == null && (this.tut.isDone('move') || this.t >= this.tHold + 8)) {
      if (!this.tut.isDone('move')) this._timer('hello-start', { moving: false });   // only a player who hasn't moved
      this._beat('hello', this.tut.isDone('move') ? 'moved' : 'standing');
      this._sendHello();
    }
    // v9: unanswered questions — walking on brings the nudge / the follow-up sooner; then the latte gate
    this._walkPatience();
    this._coffeeGate();
    this._cityWatch();
    this._engage();
    if (!demo.offered && !this._offering && aya.wasSent('meet')) this._beforeOffer();
    this._checkSkip();
  }

  _beforeOffer() {
    const { demo, aya } = this, t = this.t;
    const prog = demo.progressOver(30), moving = prog != null && prog >= 15;
    // v10: the never-stall safety cap — NOT a pacing beat. Logged ('story:timer') so a moving player hitting it shows up
    if (t >= demo._offerAt) {
      this._timer('offer-cap', { moving, leg: demo._leg && demo._leg.key });
      this._offer(aya.open && /^where/.test(aya.open.msg.id) ? 'silent' : 'time'); return;
    }
    if (this.engaged && t >= demo._offerMin && (demo._isLost() || (this.engaged === 'early' && !moving)) && !aya.fresh()) { this._offer(this.engaged); return; }
    // v10 (V10.md 3-4): the places where Maps really fails — reality creates the need, not a timer
    if (t >= demo._offerMin && !aya.fresh()) {
      if (this._cityFloors()) { this._offer('floors'); return; }
      if (this._parksEntry()) { this._offer('parks'); return; }
    }
    this._checkIn(t);
  }
  // v10: Aya checks in only when the player is behind her expectation for this leg (demo.legState) or really lost
  // (wrong floor 20 s, stalled, walking away — against the CURRENT target). Specific words for the real state; at most
  // 2 per leg, 40 s apart, never over an open question, never at the café counter or right after the latte.
  _checkIn(t) {
    const d = this.demo, aya = this.aya, cap = (v) => Math.min(v, Math.max(5, d._offerAt - 15));   // ?offerat=N (tests)
    if (t < cap(DEMO.whereMin) || aya.open || aya.fresh() || !aya.idle(10)) return;
    const leg = d.legState ? d.legState() : null, key = leg && leg.key === 'cafe' ? 'cafe' : 'dk';
    const n = this._checkins[key] || 0;
    if (n >= DEMO.checkinsPerLeg || (this._lastCheckT != null && t - this._lastCheckT < DEMO.checkinGap)) return;
    const E = this.errand;
    if (E.at != null && t - E.at < DEMO.orderCool) return;
    if (this.engaged === 'early') return;              // she already knows ("Which way?? 😵"): the early offer handles it
    const prog = d.progressOver(30), known = prog != null, moving = known && prog >= 15;
    const onTask = d.onTask ? d.onTask() : moving;
    // lost kinds need no progress and not on task; "behind" is a slow-but-steady player (on task, just slow) — only
    // the last metres to the door silence it. No 30 s of history yet (just switched leg) = no evidence of being lost.
    const why = known && !moving && !onTask ? d._isLost() : null;
    const rem = d.targetRem ? d.targetRem() : null;
    const kind = why ? (why === 'far' ? 'away' : why) : leg && leg.behind && !(rem != null && rem < 25) ? 'behind' : null;
    if (!kind) return;
    const C = AYA.checkin, p = this.ctx.player.body;
    const text = kind === 'floor' ? C.floor[key].replace('{lvl}', p.level)
      : kind === 'stalled' ? (this._atStation() ? C.stalledStation : C.stalled[key])
      : kind === 'away' ? C.away[key] : C.behind[key];
    this._checkins[key] = n + 1; this._lastCheckT = t;
    const id = this._wseq ? `where_${this._wseq + 1}` : 'where';
    this._wseq = (this._wseq || 0) + 1;
    this.whereWhy = kind;
    this.ctx.events.emit('story:where', { t: +t.toFixed(1), why: kind, leg: key, n: n + 1 });
    this._beat(id, kind);
    const rs = key === 'cafe' ? AYA.whereCoffee.replies : AYA.where.replies;
    aya.say({ id, text, replies: [rs[0], AYA.photoChip, rs[1]] }, {      // v11: I'm lost · 📸 Send a pic · On my way
      patience: [DEMO.whereNudge, DEMO.whereGiveUp], nudge: AYA.whereNudge,
      onTimeout: () => this._offer(kind === 'behind' ? 'behind' : 'silent'),
      onReply: (r, reply) => {
        if (reply && reply.lost) { this._offer('lost'); return; }
        if (reply && reply.photo) { this._photoReply(true); return; }          // v11: she reads your photo, then helps
        if (kind === 'behind') { this._behindReplied = true; this._offer('behind'); return; }   // "On my way!" — at that pace? (v10 critic: she answers it)
        aya.say(AYA.whereAck[r] || AYA.whereAck.omw, { wait: 0.5 });
        if (d._isLost()) this._offer('checkin'); else this.engaged = 'checkin';   // answered while clearly lost
      } });
  }
  _atStation() { const sp = this.ctx.player.space && this.ctx.player.space.id; return !!sp && /^nankai/.test(sp); }
  _space() { const sp = this.ctx.player && this.ctx.player.space; return sp && sp.id || ''; }
  // v10: latte leg, in Namba CITY, a floor away from the café and closing in — the floor change Maps can't do
  _cityFloors() {
    const E = this.errand, p = this.ctx.player && this.ctx.player.body;
    if (E.state !== 'asked' || !E.biz || !p || p.level === E.biz.level || !/^city/.test(this._space())) return false;
    const rem = this.demo.targetRem ? this.demo.targetRem() : null;
    // v10 critic: ...or still a floor off after a while in CITY — a ~1 m/s first-timer (looks around, reads the phone)
    // reached the 150 m mark only after the 240 s cap, so the cap fired for a MOVING player (storysim 'first-timer')
    return (rem != null && rem < DEMO.floorsM) || this._cityDwell();
  }
  // v10: the Daikichi leg enters Namba Parks (6+ floors, the canyon, split escalators): the moment of maximum need
  //      ...or its approach: the last stretch of CITY before the Parks bridge (Daikichi < 300 m by foot, measured walks)
  _parksEntry() {
    if (this.errand.state === 'asked') return false;
    const sp = this._space(), rem = this.demo._lost && this.demo._lost.rem;
    this._parksFar = false;
    if (/^parks/.test(sp) || (/^city/.test(sp) && rem != null && rem < DEMO.parksNearM)) return true;
    // v10 critic: a slower walker crossing CITY on the Daikichi leg — warned before Parks, not at the 240 s cap
    if (/^city/.test(sp) && this._cityDwell()) { this._parksFar = true; return true; }
    return false;
  }
  // v10 critic: a while in Namba CITY since her tip (her dot-watching: you're in the mall, the hard part is ahead)
  _cityDwell() { return this._cityT != null && this.t - this._cityT >= DEMO.cityDwell; }
  // v11: when the player first walks into Namba CITY (internal; Aya is never told) — it times the photo ask and the dwell
  _cityWatch() { if (this._cityT == null && /^city/.test(this._space())) this._cityT = this.t; }
  _mine(text) { const m = this.ctx.phone && this.ctx.phone.messages; if (m && typeof m.sendMine === 'function') { try { m.sendMine(text); } catch (e) { console.error('[story] mine', e); } } }
  _moving() {
    const W = this._wh || (this._wh = []), t = this.t;
    W.push([t, this.walked]); while (W.length > 2 && W[1][0] < t - 20) W.shift();
    return W.length > 1 && W[0][0] <= t - 15 && this.walked - W[0][1] >= 12;
  }
  // v11 (V11.md item 2): engagement — a friend waiting in a queue texts now and then. After DEMO.engageQuiet s with no
  // contact while you walk; never over a question, never stacking, never more often than DEMO.engageGap.
  //   before Lodestone: "you ok? 😊" (a question), the 📸 photo ask (in CITY, or after 2 min), then light lines;
  //   after it: "is it working? 😌", queue / tempura lines. Each line once.
  _engage() {
    const aya = this.aya, d = this.demo, t = this.t;
    const moving = this._moving();
    if (d.arrived || this._offering || aya.open || aya.busy() || (d.offered && !d.upgraded) || !this._meetDone) return;
    if (this.errand.slot && this.errand.state === 'none') return;            // the opening conversation is still going
    const quiet = aya.t - Math.max(aya.lastSentT, aya.lastReplyT);
    // the photo ask, timed by where you are (internal): just inside Namba CITY, the first mall floor puzzle (not held by
    // the engagement gap: it is the beat that matters here; it still never stacks — 8 s of quiet, no open question)
    if (!this._photoAsked && !d.offered && this._cityT != null && quiet >= 8) { this._lastEngageT = t; this._askPhoto('city'); return; }
    if (this._lastEngageT != null && t - this._lastEngageT < (d.offered ? DEMO.engageGapAfter : DEMO.engageGap)) return;
    if (quiet < DEMO.engageQuiet || !moving) return;
    this._lastEngageT = t;
    if (!d.offered) {
      if (!this._okAsked) { this._askOk(); return; }
      if (!this._photoAsked && t >= 120) { this._askPhoto('quiet'); return; }
      return this._engageLine(AYA.engageBefore, 'before');
    }
    this._engageLine(AYA.engageAfter, 'after');
  }
  _engageLine(pool, tag) {
    // v11 critic: the queue must only move forward. "almost our turn" / "we're next" wait until "I'm 2nd in line!!"
    // (demo QUEUE_LINES, 170 m) has gone out, else she'd be "next" and then "2nd" again
    const k = '_engUsed_' + tag, used = this[k] || (this[k] = new Set());
    const q2 = !!(this.demo && this.demo._sent && this.demo._sent.has(170));
    const isQ = (s) => /our turn|we're next/.test(s);
    let i = q2 ? pool.findIndex((s, j) => !used.has(j) && isQ(s)) : -1;     // once she's 2nd, the queue lines come first
    if (i < 0) i = pool.findIndex((s, j) => !used.has(j) && !isQ(s));
    if (i < 0) return;
    used.add(i); const text = pool[i];
    this._beat('engage', tag); this.ctx.events.emit('story:engage', { t: +this.t.toFixed(1), text });
    this.aya.say(text, { wait: 0.4 });
  }
  _askOk() {
    this._okAsked = true; this._beat('ok', 'quiet');
    this.ctx.events.emit('story:engage', { t: +this.t.toFixed(1), text: AYA.okAsk.text });
    this.aya.say(AYA.okAsk, { patience: [null, 25], onReply: (r, reply) => {
      if (!(reply && reply.lost)) { this.aya.say(AYA.okAck, { wait: 0.5 }); return; }
      if (this.t >= this.demo._offerMin) { this._offer('lost'); return; }
      this.engaged = this.engaged || 'early'; this.aya.say(AYA.okLostEarly, { wait: 0.6 });
    } });
  }
  _askPhoto(why) {
    this._photoAsked = true; this._beat('photo', why);
    this.ctx.events.emit('story:engage', { t: +this.t.toFixed(1), text: AYA.photoAsk.text });
    this.aya.say(AYA.photoAsk, { patience: [null, 30], onReply: (r, reply) => {
      if (reply && reply.photo) this._photoReply(false); else this.aya.say(AYA.photoFine, { wait: 0.6 });
    } });
  }
  // she looks at your photo. v11 (lead): she reads what is IN it — the camera pose at capture decides whether a landmark
  // is plausibly in frame; if not, "that could be anywhere 😅" and one more try (2 blurs at most, then she lets it go)
  _photoReply(fromCheckin) {
    const aya = this.aya, sc = this._photoOk === false ? { ok: false, why: 'nocapture' } : this._photoScene();
    const p = this.ctx.player.body, sp = this._space();
    const follow = () => { if (fromCheckin) { if (this.t >= this.demo._offerMin) this._offer('photo'); else this.engaged = this.engaged || 'checkin'; } };
    if (!sc.ok) {
      this._blurs = (this._blurs || 0) + 1;
      this._beat('spot', 'blur-' + sc.why);
      this.ctx.events.emit('story:photo', { t: +this.t.toFixed(1), ok: false, why: sc.why, space: sp, level: p.level, pitch: +(this.ctx.player.pitch || 0).toFixed(2) });
      if (this._blurs >= 2) { aya.say(AYA.photoGiveUp, { wait: 1.4, typing: 1.6 }); follow(); return; }
      aya.say(Object.assign({}, AYA.photoBlur, { id: `photo_again_${this._blurs}` }), { wait: 1.4, typing: 1.6, patience: [null, 30],
        onReply: (r, reply) => { if (reply && reply.photo) this._photoReply(fromCheckin); else { aya.say(AYA.photoFine, { wait: 0.6 }); follow(); } } });
      return;
    }
    const text = this._spot(sc);
    this._beat('spot', sc.lm || sc.zone);
    this.ctx.events.emit('story:photo', { t: +this.t.toFixed(1), ok: true, lm: sc.lm, zone: sc.zone, space: sp, level: p.level, text });
    aya.say(text, { wait: 1.6, typing: 1.8 });
    follow();
  }
  // the camera at capture: pitch (floor / ceiling = nothing), then the most specific landmark within ~22 m inside the
  // ±35° view cone — a directory shop, a gate, an escalator — or a distinctive zone (platforms, canyon, Parks bridges)
  _photoScene() {
    const pl = this.ctx.player, p = pl.body, sp = pl.space || {}, id = sp.id || '', zone = sp.zone || '';
    const f = { x: -Math.sin(pl.yaw), z: -Math.cos(pl.yaw) }, rt = { x: Math.cos(pl.yaw), z: -Math.sin(pl.yaw) };
    const inView = (x, z, max) => { const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz); if (d > max) return null; return d < 1.5 || (dx * f.x + dz * f.z) / d > 0.82 ? d : null; };
    const rel = (x, z) => { const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz) || 1, a = (dx * f.x + dz * f.z) / d, sd = (dx * rt.x + dz * rt.z) / d;
      return a > 0.7 ? 'right ahead' : a < -0.6 ? 'behind you' : sd > 0 ? 'to your right' : 'to your left'; };
    if (Math.abs(pl.pitch || 0) > 0.6) return { ok: false, why: (pl.pitch || 0) < 0 ? 'floor' : 'ceiling' };
    const platform = p.level === '3F' && p.z > -66 && p.z < 60 && p.x > -56 && p.x < 22;
    const distinct = platform ? 'platform' : /^parks_(canyon|stage)/.test(id) ? 'canyon' : /^parks_bridge_/.test(id) ? 'bridge' : null;
    let lm = null, bd = 22;
    for (const k in businessBySlot) {
      const b = businessBySlot[k]; if (!b || !b.door || b.level !== p.level || !b.en) continue;
      const d = inView(b.door.ox, b.door.oz, bd); if (d != null) { bd = d; lm = b.en; }
    }
    const g = this.game, gates = (g && g._gates) || [];
    let gateNear = null, gd = Infinity;
    for (const { gt } of gates) {
      if (gt.level !== p.level) continue;
      const x = gt.axis === 'x' ? Math.max(gt.from, Math.min(gt.to, p.x)) : gt.at, z = gt.axis === 'x' ? gt.at : Math.max(gt.from, Math.min(gt.to, p.z));
      const d = Math.hypot(x - p.x, z - p.z); if (d < gd) { gd = d; gateNear = { x, z, name: gt.name || 'the gates' }; }
      if (!lm && inView(x, z, 22) != null) lm = `the ${gt.name || 'gates'}`;
    }
    const ramps = (LAYOUT && LAYOUT.ramps) || [];
    const ends = (want) => { let best = null, d0 = Infinity;
      for (const r of ramps) { if (r.kind !== 'escalator' && r.kind !== 'stairs') continue;
        const e = rampEnds(r), pt = r.upper === p.level && (!want || r.lower === want) ? e.high : r.lower === p.level && (!want || r.upper === want) ? e.low : null;
        if (!pt) continue; const d = Math.hypot(pt.x - p.x, pt.z - p.z); if (d < d0) { d0 = d; best = pt; } }
      return best; };
    if (!lm) { const e = ends(null); if (e && inView(e.x, e.z, 20) != null) lm = 'the escalators'; }
    if (!lm && !distinct) return { ok: false, why: 'plain' };
    // where the escalator she means is: toward the café's floor on the latte leg, else up toward 2F
    const E = this.errand, want = E.state === 'asked' && E.biz ? (LEVEL_ORDER.indexOf(p.level) > LEVEL_ORDER.indexOf(E.biz.level) ? LEVEL_ORDER[LEVEL_ORDER.indexOf(p.level) - 1] : LEVEL_ORDER[LEVEL_ORDER.indexOf(p.level) + 1]) : '2F';
    const esc = ends(want);
    return { ok: true, lm, distinct, zone, id, esc: esc ? rel(esc.x, esc.z) : 'nearby', gate: gateNear ? rel(gateNear.x, gateNear.z) : 'ahead' };
  }
  _spot(sc) {
    const S = AYA.spot, p = this.ctx.player.body, { id, zone } = sc;
    const leg = this.errand.state === 'asked' ? 'cafe' : 'dk', lvl = p.level;
    const fill = (t) => t.replace('{lm}', sc.lm || 'the shops').replace('{esc}', sc.esc).replace('{gate}', sc.gate);
    if (sc.distinct === 'platform') return fill(S.platform);
    if (sc.distinct === 'canyon') return S.canyon;
    if (sc.distinct === 'bridge') return fill(S.parks.replace('{lm}', 'the glass bridge'));
    if (zone === 'nankai' || /^nankai/.test(id)) return fill(lvl === '3F' ? S.nankai : lvl === '2F' ? S.nankai2 : S.nankaiLow);
    if (zone === 'city' || /^city/.test(id)) return fill(lvl === '2F' ? S.city2[leg] : lvl === '1F' ? S.city1[leg] : S.cityB1[leg]);
    if (zone === 'nambawalk' || zone === 'link') return fill(S.walk);
    if (zone === 'street') return S.street;
    if (/^parks/.test(zone) || /^parks/.test(id)) return fill(LEVEL_ORDER.indexOf(lvl) >= LEVEL_ORDER.indexOf('5F') ? S.parksHigh : S.parks);
    if (!id) return S.ramp;
    return fill(S.other);
  }
  _beat(id, why) { this.ctx.events.emit('story:beat', { id, why, t: +this.t.toFixed(1) }); }
  _timer(beat, extra) { this.ctx.events.emit('story:timer', Object.assign({ beat, t: +this.t.toFixed(1) }, extra || {})); }
  _offer(why) {
    const { demo, aya } = this;
    if (demo.offered || this._offering) return;
    this._offering = true;
    this.ctx.events.emit('story:engaged', { why, t: this.t });
    this._beat('offer', why);
    // v9: the words fit the why — "you're lost aren't you" only to someone who is (or said so)
    const text = () => {
      const o = aya.open, nudged = o && o.nudgeT != null && aya.t - o.nudgeT < 10;   // she just said "hello?? 👀"
      if (why === 'silent') return nudged ? UPGRADE.offerSilentShort : UPGRADE.offerSilent;
      if (why === 'floors') return UPGRADE.offerFloors;
      if (why === 'photo') return UPGRADE.offerPhoto;
      if (why === 'parks') return this._parksFar ? UPGRADE.offerFine : UPGRADE.offerParks;   // far side of CITY: "before you hit Parks"
      if (why === 'behind') return this._behindReplied && UPGRADE.offerBehindReply ? UPGRADE.offerBehindReply : UPGRADE.offerBehind;
      if (why === 'ahead') return UPGRADE.offerAhead;
      // v9 critic: she answers what you just told her ("I'm lost 😭" → "lol I knew it"), never asks it back
      if (why === 'lost' && UPGRADE.offerLost) return UPGRADE.offerLost;
      if (why === 'early' && UPGRADE.offerEarly) return UPGRADE.offerEarly;
      return why === 'time' && !demo._isLost() ? (this._parksEntry() ? UPGRADE.offerParks : this._cityFloors() ? UPGRADE.offerFloors : UPGRADE.offerFine) : UPGRADE.offer;
    };
    aya.act(() => { this._offering = false; const words = text(); aya.closeOpen('offer'); demo.offer(why, words); this._installStep(); }, { typing: 1.5, wait: 0.7 });
  }
  // v9: at Aya's café counter with her latte still wanted (the offer fallback waits a few seconds for the order)
  _atCafe() {
    const E = this.errand, b = E.biz, p = this.ctx.player && this.ctx.player.body;
    if (E.state !== 'asked' || !b || !b.door || !p || p.level !== b.level) return false;
    return Math.hypot(p.x - b.door.ox, p.z - b.door.oz) < 15;
  }
  _installStep() {
    const ph = () => this.ctx.phone || {};
    const stage = () => ph().upgradeStage;
    this.tut.add({ id: 'install', late: true, delay: 6,
      available: () => stage() === 'offer',
      done: () => ['installing', 'calibrating', 'ready'].includes(stage()),
      hint: () => (ph().isOpen ? { html: ph().app === 'messages' ? TUTORIAL.installUp : TUTORIAL.install.replace('{k:Q} and tap', 'open Messages, tap'), at: 'phoneup' } : { html: TUTORIAL.install, at: 'phone' }) });
  }

  // test helper: answer Aya's open question (prefers a "lost" chip when asked to)
  answer(prefer) {
    const o = this.aya.open; if (!o) return null;
    const rs = o.msg.replies || [];
    const pick = (prefer === 'lost' && rs.find(r => r.lost)) || rs.find(r => r.id === prefer) || rs[0];
    if (!pick) return null;
    this.aya.answer(o.msg.id, pick.id);
    return `${o.msg.id}:${pick.id}`;
  }
}
