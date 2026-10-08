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
// =============================================================================
import { AYA, TUTORIAL, DEMO, ERRAND_DRINK, UPGRADE } from './script.js';
import { businessBySlot } from '../world/directory.js';
import { Aya } from './aya.js';
import { Tutorial } from './tutorial.js';

export class Story {
  constructor(ctx, game, demo) {
    this.ctx = ctx; this.game = game; this.demo = demo;
    this.aya = new Aya(ctx, game);
    this.tut = new Tutorial(ctx, game);
    this.t = 0; this._tick = 0;
    this.f = { raised: false, maps: false, mapsT: 0, interacted: false, walk0: 0, look: 0, lastYaw: null };
    this.engaged = null; this._offering = false;
    this.helloT = null; this.whereT = null;
    // v4: the coffee errand. state: 'none' → 'asked' → 'done' (got a coffee) | 'skipped' (walked on without one)
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
  readyText() { return this.errand.state === 'asked' && (!this._destSlot() || this._destSlot() === this.errand.slot) ? UPGRADE.readyCoffee : UPGRADE.ready; }
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
    ev.on('gate:tap', (e) => { if (mine(e)) this.f.gateTapped = true; });
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
    // a different place than Aya's pick: she reacts lightly, once (the suggestion stays highlighted)
    if (this._reacted || !this.suggested || this._isSuggested(e) || this.demo.arrived) return;
    this._reacted = true;
    const name = e.name || (businessBySlot[e.slotId] && businessBySlot[e.slotId].en) || 'that';
    const skip = !this._leg2 && e.slotId === DEMO.slot && this.errand.state === 'asked';
    if (skip) this._skipPicked = true;
    const text = skip ? AYA.skipCoffeePick : AYA.otherPick.replace('{name}', name);
    this.aya.say(text, { wait: 1.2 });
  }
  _isSuggested(e) { return e.suggested === true || (!!e.slotId && e.slotId === this.suggested); }
  _onOrder(e) {
    const E = this.errand;
    if (e.kind !== 'cafe' || !e.item || E.state === 'done' || E.state === 'none') return;
    const mine = e.slotId === E.slot;
    const was = E.state;
    E.state = 'done'; E.got = { slotId: e.slotId, name: e.name, item: e.item }; E.at = this.t;
    this.game.setQuest('coffee', 'done', mine ? `${e.item} from ${E.name}, to go` : `${e.item} from ${e.name || 'a café'} (close enough)`, true);
    if (was === 'skipped') { this.aya.say('wait is that a coffee?? for ME?? 🥹', { wait: 2.6 }); return; }
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
    this.aya.say({ id: 'coffee', text: AYA.coffee.text.replace('{cafe}', E.name), place: E.slot }, { wait: 1.4, run: () => {
      E.state = 'asked';
      this._suggest(E.slot);
      this.game.setQuest('coffee', 'active', null, true);
      this._orderStep();
    } });
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
      available: () => E.state === 'asked' && near() && !(this.ctx.phone && this.ctx.phone.isOpen),
      done: () => E.state !== 'asked',
      hint: () => { const t = this.game.interactions && this.game.interactions.target; return { html: TUTORIAL.order, at: t && !t.passive ? 'prompt' : 'center' }; } });
  }
  // walked on well past the café without the latte (nearer Daikichi than the café is): one tease, then Daikichi
  _checkSkip() {
    const E = this.errand, d = this.demo;
    if (E.state !== 'asked' || !E.biz || !d._field || !this.ctx.nav) return;
    if (this._cafeDk == null) {
      const b = E.biz, v = this.ctx.nav.nodeAtPoint(b.level, b.door.ox, b.door.oz);
      const x = v >= 0 ? d._field.dist[v] : null;
      this._cafeDk = typeof x === 'number' && isFinite(x) ? x : -1;
    }
    const rem = d._lost.rem;
    if (this._cafeDk <= 0 || rem == null || rem > this._cafeDk - 40 || !this.aya.idle(4)) return;
    E.state = 'skipped';
    this.game.setQuest('coffee', 'hidden', null, true);
    if (this._skipPicked) { this._leg2Start(); return; }      // she already teased you when you picked Daikichi
    this.aya.say({ text: AYA.noCoffee, place: DEMO.slot }, { run: () => this._leg2Start() });
  }
  _sendHello() {
    if (this.helloT != null) return;
    this.helloT = this.t;
    this.aya.say(AYA.hello, { typing: 1.3, wait: 0, onReply: () => this._sendMeet(0.9) });
  }
  _sendMeet(wait) {
    if (this._meetQueued) return;
    this._meetQueued = true;
    this.aya.say(AYA.meet, { wait, run: () => this.game.setQuest('tempura', 'active', null, true) });
    this._sendCoffee();
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
      { id: 'reply', core: true,
        available: () => aya.open && aya.open.msg.id === 'hello',
        done: () => aya.answered('hello') || aya.wasSent('meet'),
        hint: () => (up() ? (aya.rich ? { html: TUTORIAL.reply, at: 'phoneup' } : readHint) : { html: TUTORIAL.replyDown, at: 'phone' }) },
      // v4: "choose where to go" — open Maps and pick a place (Aya's pick is highlighted; any pick counts).
      // Without the phone's destination list (older phone) the v3 rule holds: opening Maps is enough.
      { id: 'pick', core: true, delay: 1.0,
        available: () => (aya.wasSent('coffee') || (aya.wasSent('meet') && !this.errand.slot)) && !aya.busy(),
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
    const aimed = () => { const t = g.interactions && g.interactions.target; return !!(t && t.id === 'gatetap' && g._gateTgt && !ph().isOpen); };
    const blocked = () => this.f.blockedT != null && this.t - this.f.blockedT < 5;
    const hint = (base) => () => {
      if (ph().isOpen) return null;
      if (blocked()) return { html: TUTORIAL.gateBlocked, at: aimed() ? 'prompt' : 'center' };
      return aimed() ? { html: TUTORIAL.gateHere, at: 'prompt' } : base ? { html: base, at: 'center' } : null;
    };
    this.tut.add({ id: 'gate', late: true, delay: 0.3,
      available: () => !ph().isOpen && (this._nearGate() || aimed() || blocked()) && g._newGates && g._newGates(),   // phone up: its own hint wins
      done: () => this.f.gateTapped,
      hint: hint(TUTORIAL.gate) });
    // after the lesson: walking into a lane untapped again brings back the one-liner for a few seconds
    this.tut.add({ id: 'gateAgain', late: true, delay: 0,
      available: () => this.f.gateTapped && blocked() && !ph().isOpen,
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
    if (this.helloT == null && (this.tut.isDone('move') || this.t >= this.tHold + 8)) this._sendHello();
    // "Landed??" ignored while they walk on: she sends the plan anyway
    if (this.helloT != null && !aya.answered('hello') && !this._meetQueued && !aya.busy() && (this.t - this.helloT > 30 || this.walked > 40)) this._sendMeet(0);
    if (!demo.offered && !this._offering && aya.wasSent('meet')) this._beforeOffer();
    this._checkSkip();
  }

  _beforeOffer() {
    const { demo, aya } = this, t = this.t;
    if (t >= demo._offerAt) { this._offer('time'); return; }                       // fallback: nobody stuck forever
    if (this.engaged && t >= demo._offerMin && demo._isLost()) { this._offer(this.engaged); return; }
    // v2's "Where are you??" — v6 (item 1): not before ~95 s (the player is still taking in the station), and then only
    // when they are clearly stalled or wandering: a "lost" reason AND under 15 m of real progress over the last 30 s.
    // Fallback from 150 s unless they are visibly making progress; by 175 s at the latest. Never in the first minute.
    if (this.whereT == null && aya.idle(10) && this._whereDue(t)) {
      this.whereT = t;
      this.ctx.events.emit('story:where', { t: +t.toFixed(1), why: this.whereWhy });
      aya.say(AYA.where, { onReply: (r, reply) => {
        if (reply && reply.lost) { this._offer('lost'); return; }
        aya.say(AYA.whereAck[r] || AYA.whereAck.omw, { wait: 0.5 });
        if (demo._isLost()) this._offer('checkin'); else this.engaged = 'checkin';   // answered while clearly lost
      } });
    }
  }
  _whereDue(t) {
    const d = this.demo, cap = (v) => Math.min(v, Math.max(5, d._offerAt - 15));   // ?offerat=N (tests) pulls it all in
    if (t < cap(DEMO.whereMin)) return false;
    const prog = d.progressOver(30), moving = prog != null && prog >= 15;
    let why = d._isLost();
    // heading down to Aya's café (CITY 1F) is the errand, not a wrong floor
    const E = this.errand, p = this.ctx.player && this.ctx.player.body;
    if (why === 'floor' && E.state === 'asked' && E.biz && p && p.level === E.biz.level) why = null;
    if (!moving && why) { this.whereWhy = why; return true; }
    if (t >= cap(DEMO.whereAt) && !moving) { this.whereWhy = 'time'; return true; }
    if (t >= cap(DEMO.whereLatest)) { this.whereWhy = 'latest'; return true; }
    return false;
  }
  _offer(why) {
    const { demo, aya } = this;
    if (demo.offered || this._offering) return;
    this._offering = true;
    this.ctx.events.emit('story:engaged', { why, t: this.t });
    aya.act(() => { this._offering = false; demo.offer(why); this._installStep(); }, { typing: 1.5, wait: 0.7 });
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
