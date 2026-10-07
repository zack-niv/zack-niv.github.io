// =============================================================================
// The story (v3 items 1 + 5): progress comes from the player — what they answer
// Aya, what they do with the phone, and where they are — never from a clock alone.
//
//   opening   = the tutorial: raise the phone (Q) → answer Aya → answer again →
//               open Maps → walk → follow the signs through the Nankai gate.
//               Each step waits for the player, shows one small hint, nudges
//               after ~12 s of inaction, and validates on real events.
//   wandering = Aya reacts to places and states (out of the gates, Namba CITY,
//               underground for a while, stalled, a coffee stop). Her
//               questions carry reply chips.
//   upgrade   = earned: the player says they're lost (any "lost" chip), or
//               answers a check-in while the director says they're clearly
//               lost. Fallback at DEMO.offerAt so nobody is stuck forever.
//   after     = Aya cheers progress, notices a wrong way once (nav:track),
//               banters as the queue shortens, waves at arrival (demo.js).
// Owned by the Demo director (demo.story); words in script.js (AYA, TUTORIAL).
// =============================================================================
import { AYA, TUTORIAL, QUEUE_LINES, CANYON_TEXT } from './script.js';
import { Aya } from './aya.js';
import { Tutorial } from './tutorial.js';

const WRONG_FLOOR_S = 40;       // "underground for a while"
const CHECKIN_STALL_S = 30;     // no real progress toward Daikichi for this long → "how's it going?"
const AFTER_STALL_S = 40;       // same, once Lodestone is guiding
const GATE_Z = -67;             // Nankai 3F: the central gate line is at z = -66; the free concourse is beyond

export class Story {
  constructor(ctx, game, demo) {
    this.ctx = ctx; this.game = game; this.demo = demo;
    this.aya = new Aya(ctx, game);
    this.tut = new Tutorial(ctx, game);
    this.t = 0; this._tick = 0;
    this.f = { raised: false, maps: false, mapsT: 0, gate: false, interacted: false, walk0: 0, jog: 0 };
    this.once = new Set();
    this.engaged = null; this._offering = false;
    this.helloT = null; this.meetT = null;
    this._okT = null;           // when the player last said "getting there"
    this._driftT = 0;
  }
  get walked() { return Math.max(0, this.game.journal.distance - this.f.walk0); }
  _once(k) { if (this.once.has(k)) return false; this.once.add(k); return true; }
  _free() { const g = this.game; return !g.busy && !g.intro && !g.paused && !this.demo.arrived && !g.ended; }

  // ---------------------------------------------------------------------------
  begin(tHold) {
    const { ctx, game } = this, ev = ctx.events;
    this.f.walk0 = game.journal.distance;
    ev.on('phone:pose', (e) => { if (e && e.pose === 'up') this._raised(); });
    ev.on('phone:open', () => this._raised());
    ev.on('phone:app', (e) => { if (e && e.app === 'maps') this._mapsOpened(); });
    ev.on('ic:tap', (e) => { if (e && e.ok && e.exit && /^g_nk/.test(e.gate || '')) this.f.gate = true; });
    ev.on('interact', () => { this.f.interacted = true; });
    ev.on('aya:answered', (e) => this.tut.poke());
    ev.on('demo:order', (e) => { if (e && !e.hi && !this.demo.arrived && this._once('coffee')) game.after(2.6, () => { if (!this.demo.arrived) this.aya.say(AYA.coffee); }); });
    ev.on('nav:track', (e) => this._track(e));
    ev.on('phone:upgrade', (e) => this._upgrade(e && e.stage));

    // the conversation starts as the opening look ends: the phone buzzes
    game.after(tHold + 0.9, () => {
      this.helloT = this.t;
      this.aya.say(AYA.hello, { typing: 1.3, wait: 0, onReply: (r) => { const a = AYA.helloAck[r]; if (a) this.aya.say(a, { wait: 0.5 }); this._sendMeet(1.1); } });
    });
    this._steps();
  }

  _raised() {
    if (!this.f.raised) this.f.raised = true;
    this.tut.poke('raise');
  }
  _mapsOpened() { if (this.aya.wasSent('meet')) this.f.maps = true; }

  _sendMeet(wait = 0.9) {
    if (this.aya.wasSent('meet') || this._meetQueued) return;
    this._meetQueued = true;
    this.aya.say(AYA.meet, {
      wait,
      run: () => { this.meetT = this.t; this.game.setQuest('tempura', 'active', null, true); },
      onReply: (r) => { const a = AYA.meetAck[r]; if (a) this.aya.say(a, { wait: 0.5 }); },
    });
  }

  // ---------------------------------------------------------------------------
  // The tutorial steps (see tutorial.js for the machine)
  _steps() {
    const { ctx, aya } = this, ph = () => ctx.phone || {};
    const up = () => !!ph().isOpen;
    const rich = () => aya.rich;
    const readHint = { html: 'Read Aya\'s message', at: 'phoneup' };
    this.tut.start([
      { id: 'raise',
        available: () => aya.wasSent('hello'),
        done: () => this.f.raised || up(),
        hint: () => ({ html: this._raiseHold ? TUTORIAL.raiseHold : TUTORIAL.raise, at: 'phone' }),
        nudge: (n) => {
          if (n === 1 && !aya.answered('hello') && !aya.wasSent('meet')) aya.say(AYA.helloNudge, { wait: 0 });
          if (n >= 2) this._raiseHold = true;
        } },
      { id: 'reply',
        available: () => aya.open && aya.open.msg.id === 'hello',
        done: () => aya.answered('hello') || aya.wasSent('meet'),
        hint: () => (up() ? (rich() ? { html: TUTORIAL.reply, at: 'phoneup' } : readHint) : { html: TUTORIAL.replyDown, at: 'phone' }) },
      { id: 'reply2',
        available: () => aya.open && aya.open.msg.id === 'meet',
        done: () => aya.answered('meet') || (aya.wasSent('meet') && !(aya.open && aya.open.msg.id === 'meet') && !aya.busy()),
        hint: () => (up() ? (rich() ? { html: TUTORIAL.reply, at: 'phoneup' } : readHint) : { html: TUTORIAL.replyDown, at: 'phone' }) },
      { id: 'maps', delay: 1.2,
        available: () => aya.wasSent('meet') && !aya.busy() && !(aya.open && aya.open.msg.id === 'meet'),
        done: () => this.f.maps,
        hint: () => (up() ? { html: TUTORIAL.maps, at: 'phoneup' } : { html: TUTORIAL.mapsDown, at: 'phone' }) },
      { id: 'walk', delay: 0.8,
        available: () => aya.wasSent('hello'),
        done: () => this.walked >= 12,
        hint: () => (this.walked >= 5 && this.f.jog < 0.4 ? { html: TUTORIAL.hurry, at: 'center' } : { html: up() ? TUTORIAL.walkPhone : TUTORIAL.walk, at: 'center' }) },
      { id: 'gate', delay: 2.5,
        available: () => aya.wasSent('hello'),
        done: () => this._pastGate(),
        hint: () => ({ html: this._gateNudged ? TUTORIAL.gateNudge : TUTORIAL.gate, at: 'top' }),
        nudge: () => { this._gateNudged = true; } },
      { id: 'interact', side: true,
        available: () => { const t = this.game.interactions && this.game.interactions.target; return !!(t && !t.passive) && !up(); },
        done: () => this.f.interacted,
        hint: () => ({ html: TUTORIAL.interact, at: 'prompt' }) },
    ]);
  }
  _pastGate() {
    const b = this.ctx.player.body;
    if (this.f.gate) return true;
    if (b.level !== '3F') return true;                 // off the platform level (down the escalators)
    return this.ctx.player.zone === 'nankai' && b.z < GATE_Z;
  }

  // ---------------------------------------------------------------------------
  update(dt) {
    const { ctx, game, demo, aya } = this;
    this.t += dt;
    aya.update(dt);
    // a few signals the tutorial reads every frame
    const ph = ctx.phone;
    if (ph && ph.isOpen && ph.app === 'maps' && aya.wasSent('meet')) { this.f.mapsT += dt; if (this.f.mapsT > 0.5) this.f.maps = true; } else this.f.mapsT = 0;
    const inp = ctx.input, p = ctx.player;
    if (inp && inp.jog && p && (p.speed || 0) > 1.3) this.f.jog += dt;
    if (p && (p.speed || 0) > 0.4 && this.tut.cur && this.tut.cur.id === 'walk') this.tut.poke('walk');
    this.tut.update(dt);

    this._tick -= dt;
    if (this._tick > 0) return;
    this._tick = 0.5;
    if (!this._free()) return;
    const b = p.body;

    // nobody answers "Landed??" and they are already walking: she sends the plan anyway
    if (this.helloT != null && !aya.answered('hello') && !aya.wasSent('meet') && !this._meetQueued && !aya.busy()
      && (this.t - this.helloT > 30 || this.walked > 30)) { aya.say(AYA.meetLate, { wait: 0 }); this._sendMeet(0.8); }

    if (!demo.offered && !this._offering) this._before(b);
    else if (demo.upgraded) this._after(b);
  }

  // where you are, before Lodestone
  _before(b) {
    const { ctx, demo, aya } = this;
    if (!aya.wasSent('meet')) return;
    const t = this.t, L = demo._lost;
    // earned: the player asked for help earlier than the map could be felt → now
    if (this.engaged && t >= demo._offerMin && (demo._isLost() || t - this.engaged.t > 25)) { this._offer(this.engaged.why); return; }
    // fallback: nobody is stuck forever
    if (t >= demo._offerAt) { this._offer('time'); return; }
    if (aya.busy()) return;
    const ask = (key, msg, gap = 8) => {
      if (!aya.idle(gap) || !this._once(key)) return false;
      aya.say(msg, { onReply: (r, reply) => this._answer(key, r, reply) });
      return true;
    };
    // out of the Nankai gates
    if (this._pastGate() && this.tut.isDone('gate') && ask('gates', AYA.gates, 6)) return;
    // Namba CITY 2F: close-ish
    if (ctx.player.zone === 'city' && b.level === '2F' && t > 30 && ask('city', AYA.city, 10)) return;
    // underground for a while
    if (L.wrongT > WRONG_FLOOR_S && ask('under', AYA.under, 8)) return;
    // stalled: no real progress toward Daikichi for a while (after the opening)
    const stalled = (sec) => { const p = demo.progressOver(sec); return p != null && p < 8; };
    if (t > 50 && (this.tut.isDone('gate') || t > 80) && stalled(CHECKIN_STALL_S) && ask('checkin', AYA.checkin, 18)) return;
    if (this._okT != null && t - this._okT > 35 && (stalled(25) || demo._isLost()) && ask('checkin2', AYA.checkin2, 18)) return;
  }
  _answer(key, r, reply) {
    const { aya, demo } = this;
    if (reply && reply.lost) { this._engage('lost'); return; }
    // answered her check-in while clearly lost: that's a yes
    if ((key === 'checkin' || key === 'checkin2') && demo._isLost()) { this._engage('checkin'); return; }
    if (key === 'checkin' || key === 'checkin2') this._okT = this.t;
    const ack = AYA[key + 'Ack'] && AYA[key + 'Ack'][r];
    if (ack) aya.say(ack, { wait: 0.5 });
  }
  _engage(why) {
    const { demo, aya } = this;
    if (demo.offered || this._offering) {
      if (this.ctx.phone && this.ctx.phone.upgradeStage === 'offer') aya.say(AYA.offerNudge, { wait: 0.4 });
      return;
    }
    if (this.engaged) return;
    this.engaged = { why, t: this.t };
    this.ctx.events.emit('story:engaged', { why, t: this.t });
    if (this.t < demo._offerMin) { aya.say(AYA.early, { wait: 0.5 }); return; }
    this._offer(why);
  }
  _offer(why) {
    const { demo, aya } = this;
    if (demo.offered || this._offering) return;
    this._offering = true;
    const pre = AYA.offerPre[why] || AYA.offerPre.lost;
    aya.say(pre, { wait: 0.5 });
    aya.act(() => { this._offering = false; demo.offer(why); this._installStep(); }, { typing: 1.5, wait: 0.6 });
  }
  _installStep() {
    const ph = () => this.ctx.phone || {};
    const stage = () => ph().upgradeStage;
    this.tut.add({ id: 'install', late: true, delay: 5,
      available: () => stage() === 'offer',
      done: () => ['installing', 'calibrating', 'ready'].includes(stage()),
      hint: () => (ph().isOpen ? (ph().app === 'messages' ? { html: TUTORIAL.installUp, at: 'phoneup' } : { html: TUTORIAL.install.replace('{k:Q} and tap', 'open Messages and tap'), at: 'phoneup' }) : { html: TUTORIAL.install, at: 'phone' }),
      nudge: (n) => { if (n === 2 && this.aya.idle(10)) this.aya.say(AYA.offerNudge, { wait: 0 }); } });
  }

  // after Lodestone: cheer progress, never nag
  _after(b) {
    const { ctx, demo, aya } = this;
    const sp = ctx.player.space && ctx.player.space.id;
    if (!this.once.has('canyon') && (sp === 'parks_bridge' || (b.level === '2F' && b.x > -6 && b.x < 6 && b.z > 188 && b.z < 206)) && aya.idle(4)) { this.once.add('canyon'); aya.say(CANYON_TEXT); return; }
    const rem = demo._lost.rem;
    if (rem != null) for (const [at, text] of QUEUE_LINES) {
      const k = 'q' + at;
      if (rem < at && !this.once.has(k) && (at > 100 || b.level === demo.biz.level) && !aya.busy()) { this.once.add(k); aya.say(text); return; }
    }
    const p = demo.progressOver(AFTER_STALL_S);
    if (p != null && p < 8 && this.t - (demo.readyT || 0) > AFTER_STALL_S + 5 && aya.idle(20) && this._once('stall')) {
      aya.say(AYA.stall, { onReply: (r) => { const a = AYA.stallAck[r]; if (a) aya.say(a, { wait: 0.5 }); } });
    }
  }
  _upgrade(stage) {
    if (stage !== 'ready' || this.once.has('ready')) return;
    this.once.add('ready');
    this.game.after(3.0, () => {
      if (this.demo.arrived) return;
      this.aya.say(AYA.ready, { onReply: (r) => { const a = AYA.readyAck[r]; if (a) this.aya.say(a, { wait: 0.5 }); } });
    });
  }
  // Lodestone says we are heading the wrong way: Aya notices, once
  _track(e) {
    if (!e || !this.demo.upgraded || this.demo.arrived || this.once.has('wrong')) return;
    const now = this.t;
    if (e.state === 'drifting') { if (!this._driftT) this._driftT = now; }
    else if (e.state === 'on') this._driftT = 0;
    const off = e.state === 'off' || (e.state === 'drifting' && this._driftT && now - this._driftT > 5);
    if (off && this.aya.idle(8) && this._free()) { this.once.add('wrong'); this.aya.say(AYA.wrongWay, { wait: 0.6 }); }
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
