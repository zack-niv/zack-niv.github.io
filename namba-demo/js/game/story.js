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
// Words in script.js (AYA, UPGRADE, TUTORIAL); measurements in demo.js.
// =============================================================================
import { AYA, TUTORIAL } from './script.js';
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
  }
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
    this._steps();
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
      { id: 'maps', core: true, delay: 1.0,
        available: () => aya.wasSent('meet') && !aya.busy(),
        done: () => this.f.maps,
        hint: () => (up() ? { html: TUTORIAL.maps, at: 'phoneup' } : { html: TUTORIAL.mapsDown, at: 'phone' }) },
      { id: 'interact', delay: 1.5,
        done: () => this.f.interacted,
        hint: () => { const t = this.game.interactions && this.game.interactions.target; return up() ? null : t && !t.passive ? { html: TUTORIAL.interactHere, at: 'prompt' } : { html: TUTORIAL.interact, at: 'center' }; } },
    ]);
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

    this._tick -= dt;
    if (this._tick > 0) return;
    this._tick = 0.5;
    if (!this._free()) return;
    // the phone buzzes once you have had a look and a few steps (or after a few seconds anyway)
    if (this.helloT == null && (this.tut.isDone('move') || this.t >= this.tHold + 8)) this._sendHello();
    // "Landed??" ignored while they walk on: she sends the plan anyway
    if (this.helloT != null && !aya.answered('hello') && !this._meetQueued && !aya.busy() && (this.t - this.helloT > 30 || this.walked > 40)) this._sendMeet(0);
    if (!demo.offered && !this._offering && aya.wasSent('meet')) this._beforeOffer();
  }

  _beforeOffer() {
    const { demo, aya } = this, t = this.t;
    if (t >= demo._offerAt) { this._offer('time'); return; }                       // fallback: nobody stuck forever
    if (this.engaged && t >= demo._offerMin && demo._isLost()) { this._offer(this.engaged); return; }
    // v2's "Where are you??" — now sent when the player is lost / stalled / on a wrong floor (from ~45 s), or at 100 s
    if (this.whereT == null && t >= demo._offerMin && aya.idle(10) && (demo._isLost() || t >= 100)) {
      this.whereT = t;
      aya.say(AYA.where, { onReply: (r, reply) => {
        if (reply && reply.lost) { this._offer('lost'); return; }
        aya.say(AYA.whereAck[r] || AYA.whereAck.omw, { wait: 0.5 });
        if (demo._isLost()) this._offer('checkin'); else this.engaged = 'checkin';   // answered while clearly lost
      } });
    }
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
