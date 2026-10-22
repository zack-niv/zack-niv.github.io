// =============================================================================
// The tutorial (v3 item 5): not a card deck, the opening of the story itself.
//
// A list of steps, each validated by something the player really does
// (phone:pose up, phone:reply, phone:app, metres walked, the gate, E…).
//   step = { id, available(), done(), hint() -> {html, at} | null, nudge?(n), side?, late? }
//     available()  the step makes sense now (e.g. Aya's question has been sent)
//     done()       polled; also true when the player did it early / out of order
//     hint()       ONE small line, anchored where the action is:
//                  'phone' (above the lowered phone), 'phoneup' (beside the raised phone), 'center', 'top'
//     nudge(n)     called after ~12 s of inaction (n = 1, 2, 3); the hint pulses. After 3 nudges it goes quiet.
// The hint always belongs to the first undone, available step (side steps such as "E to interact" only show
// while nothing else does). Nothing here ever freezes the player or blocks movement.
//
// Teaching: every run shows the hints as soon as a step is current (v7: a replay used to hide them all behind a
// sessionStorage flag that every later load in the tab inherited — Zack's "most of the tutorial is missing").
// A player who knows the ropes clears each step in a second, so its hint barely flashes.
//   ?notutorial   no hints at all (the conversation still plays)
// Events: 'tutorial:step' {id, done, t}, 'tutorial:done' {t, skipped}.
// =============================================================================
import { params } from '../core/params.js?v=ca6849e';
import { TUTORIAL } from './script.js?v=ca6849e';

const KEY = 'namba.tutorial.v3';
const NUDGE_S = [12, 26, 42];          // seconds a step may sit idle before each nudge

let doneThisPage = false;
export const tutorialStore = {
  completed() { try { return sessionStorage.getItem(KEY) === 'done'; } catch (e) { return doneThisPage; } },
  mark() { doneThisPage = true; try { sessionStorage.setItem(KEY, 'done'); } catch (e) { /* private mode */ } },
};

// {k:Q} -> key cap; everything else is trusted html from script.js
export const keys = (s) => String(s).replace(/\{k:([^}]+)\}/g, (_, k) => `<kbd class="g-key${k.length > 1 ? ' wide' : ''}">${k}</kbd>`);

export class Tutorial {
  constructor(ctx, game) {
    this.ctx = ctx; this.game = game;
    this.steps = []; this.state = {};
    this.active = false; this.finished = false;
    this.cur = null; this.age = 0; this.t = 0;
    this.off = params.has('notutorial');
    this.teach = true;                 // v7: always (see the header); tutorialStore only records completion
    this.el = null; this._html = ''; this._at = '';
  }
  start(steps) {
    this.steps = steps.map(s => Object.assign({ done: () => false, available: () => true, hint: () => null }, s));
    for (const s of this.steps) this.state[s.id] = { done: false, nudges: 0, shown: false, idle: 0 };
    this.active = true;
    this._build();
    this.ctx.events.emit('tutorial:start', { teach: this.teach, off: this.off });
  }
  // steps added later (the Lodestone link card once Aya sends it)
  add(step) {
    const s = Object.assign({ done: () => false, available: () => true, hint: () => null }, step);
    this.steps.push(s); this.state[s.id] = { done: false, nudges: 0, shown: false, idle: 0 };
    if (!this.active) { this.active = true; this._build(); }
  }
  isDone(id) { return !!(this.state[id] && this.state[id].done); }

  _build() {
    if (this.el) return;
    const hud = this.game.hud;
    if (!hud || hud.quiet || !hud.root) return;
    const el = document.createElement('div');
    el.className = 'g-tip';
    el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
    el.innerHTML = '<span class="g-tip-dot"></span><span class="g-tip-t"></span>';
    hud.root.appendChild(el);
    this.el = el; this._t = el.querySelector('.g-tip-t');
  }

  update(dt) {
    if (!this.active) return;
    this.t += dt;
    const g = this.game;
    // 1) validation: any step whose condition holds is done, in any order
    let coreLeft = 0, liveLeft = 0;
    for (const s of this.steps) {
      const st = this.state[s.id];
      if (st.done) continue;
      let ok = false;
      try { ok = !!s.done(); } catch (e) { ok = false; }
      if (ok) { st.done = true; this.ctx.events.emit('tutorial:step', { id: s.id, done: true, t: +this.t.toFixed(1), nudges: st.nudges }); continue; }
      if (!s.side && !s.late) { if (s.core) coreLeft++; if (st.nudges <= NUDGE_S.length) liveLeft++; }
    }
    // complete = the core steps (phone up, answer, Maps) done and nothing else still being taught
    if (!coreLeft && !liveLeft && !this.finished) {
      this.finished = true; tutorialStore.mark();
      this.ctx.events.emit('tutorial:done', { t: +this.t.toFixed(1), skipped: false });
    }
    // 2) which step owns the hint: the first undone, available, not retired main/late step; else a side step
    const quiet = g.paused || g.busy || g.intro || g.ended || g._endCard || (g.demo && g.demo.arrived) || !g.started;
    // Late steps (the Lodestone link) first; then the main steps strictly in order — if the first pending one is not
    // available yet (Aya still typing) nothing shows rather than a hint from further down; side steps fill the gaps.
    let cur = null;
    if (!quiet) {
      const live = (s) => { const st = this.state[s.id]; return !st.done && st.nudges <= NUDGE_S.length; };
      for (const s of this.steps) if (s.late && live(s) && safeTrue(s.available)) { cur = s; break; }
      let waiting = false;
      if (!cur) for (const s of this.steps) {
        if (s.side || s.late || !live(s)) continue;
        if (safeTrue(s.available)) cur = s; else waiting = true;
        break;
      }
      if (!cur && !waiting) for (const s of this.steps) if (s.side && live(s) && safeTrue(s.available)) { cur = s; break; }
    }
    if (cur !== this.cur) { this.cur = cur; this.age = 0; this._pulse(false); }
    if (cur) {
      const st = this.state[cur.id];
      this.age += dt; st.idle += dt;
      const next = NUDGE_S[st.nudges];
      if (!cur.side && next != null && st.idle >= next) {
        st.nudges++;
        try { cur.nudge && cur.nudge(st.nudges); } catch (e) { console.error('[tutorial] nudge', e); }
        this._pulse(true);
      }
      if (!cur.side && st.nudges >= NUDGE_S.length && st.idle >= NUDGE_S[NUDGE_S.length - 1] + 8) { st.nudges = NUDGE_S.length + 1; this.cur = null; }   // retired: never nags forever
    }
    // 3) the hint itself
    let h = null;
    if (this.cur && !this.off) {
      const st = this.state[this.cur.id];
      const teachNow = this.teach || st.nudges > 0 || this.cur.late;
      if (teachNow && this.age > (this.cur.delay || 0.35)) { try { h = this.cur.hint(); } catch (e) { h = null; } }
      if (h) st.shown = true;
    }
    const T = this.ctx.touch;
    if (T && T.active && T.coach) h = this._touchCoach(T, h);
    this._render(h);
  }
  // v13 (touch): the opening look + walk steps become the two-thumb coach (the zones carry the words, so the one-line
  // hint stays hidden), and every later hint gets a ghost thumb tapping the real control it is about.
  _touchCoach(T, h) {
    const id = this.cur && this.cur.id, st = id && this.state[id];
    const ph = this.ctx.phone, up = !!(ph && ph.isOpen);
    const nudge = st ? st.nudges : 0;
    const L = !!(this.state.look && this.state.look.done), M = !!(this.state.move && this.state.move.done);
    // both thumbs done: the zones stay ~1.3 s more, so the last one to be done still says "Nice" before they fade
    if (L && M && this._coached && this._coachEnd == null) this._coachEnd = this.t + 1.3;
    const hold = this._coachEnd != null && this.t < this._coachEnd;
    if (!this.off && this.state.look && this.state.move && (hold || (!this._coachEnd && (id === 'look' || id === 'move')))) {
      const S = this.game.story || {}, f = S.f || {};
      this._coached = true;
      T.coach({ zones: { look: L ? 1 : (f.look || 0) / 1.0, walk: M ? 1 : (S.walked || 0) / 8, lookDone: L, walkDone: M }, nudge });
      return up ? h : null;
    }
    T.coach(h ? { target: touchTarget(id, h, ph, up), nudge } : null);
    return h;
  }
  // the player just did something on-topic (raised the phone, walked): the idle clock restarts
  poke(id) { const st = id ? this.state[id] : (this.cur && this.state[this.cur.id]); if (st) st.idle = 0; }

  _render(h) {
    const el = this.el; if (!el) return;
    if (!h) { if (el.classList.contains('on')) el.classList.remove('on'); return; }
    if (h.html !== this._html) { this._html = h.html; this._t.innerHTML = keys(h.html); }
    const at = h.at || 'center';
    if (at !== this._at) { this._at = at; el.dataset.at = at; }
    // polish: a hint never covers the raised phone — anything not meant for it steps aside, left of the phone
    const ph = this.ctx.phone, up = !!(ph && (ph.isOpen || ph.pose === 'up')) && at !== 'phoneup';
    if (up !== el.classList.contains('ph-up')) el.classList.toggle('ph-up', up);
    if (!el.classList.contains('on')) el.classList.add('on');
  }
  _pulse(on) {
    const el = this.el; if (!el) return;
    el.classList.remove('nudge');
    if (on) { void el.offsetWidth; el.classList.add('nudge'); }
  }
}
// the on-screen control a touch hint is about ({ sel, last }: the last match = the newest message card), or null
function touchTarget(id, h, ph, up) {
  const at = h.at;
  if (at === 'phone' && !up) return { sel: '#touch-ui .tu-phone' };
  if (at === 'prompt') return { sel: '#touch-ui.has-use .tu-use' };
  if (!up || !ph) return null;
  const v = `#phone-root .ph-view[data-v="${ph.app}"]`;
  if (id === 'reply') return { sel: `${v} .ms-replies .ms-chip` };
  if (id === 'install') return ph.app === 'messages' ? { sel: `${v} .ms-link`, last: true } : { sel: '#phone-root .ph-dock [data-app="messages"]' };
  if (id === 'pick' || id === 'pick2') {
    if (h.html === TUTORIAL.maps) return { sel: '#phone-root .ph-dock [data-app="maps"]' };
    if (h.html === TUTORIAL.pickMsg) return { sel: `${v} .ms-place`, last: true };
    return { sel: `${v} .dl-next, ${v} .dl-r.aya` };
  }
  if (id === 'order' || id === 'gate' || id === 'gateAgain') return { sel: '#touch-ui.has-use .tu-use' };
  return null;
}
function safeTrue(fn) { try { return !!fn(); } catch (e) { return false; } }
