// =============================================================================
// Aya — the friend on the other end of the phone (v3 item 1).
//
// A small, serial outbox: every text is preceded by "Aya is typing…" for a
// beat (a real person types), never two at once, all on game time (pause-aware).
// Questions carry reply chips; the player's answer comes back as
// 'phone:reply' {msgId, replyId, text} and is routed to that message's
// onReply(replyId, reply). Only one question is open at a time: a newer
// question supersedes an unanswered older one (its onExpire runs).
//
// Phone contract (V3.md): ctx.phone.message({id, from, text, replies?, link?, expectReply?})
// and the 'phone:typing' {from, on} event. Feature-detected: without
// ctx.phone.message the texts go out as plain 'phone:message' events (no chips)
// and a question counts as "answered" with its first reply once the player has
// read it (the phone up on Messages for ~1.5 s) — the story never stalls.
//
//   aya.say(text | {id, text, replies, link}, { typing, wait, onReply, onExpire, run })
//   aya.idle(sec)       nothing queued and nothing sent for `sec` seconds
//   aya.open            the open question {id, replies, ...} or null
//   aya.answer(msgId, replyId)   (test helper) answer like a player would
//
// v9 (notes/v9-progression.md): a turn-taking contract — Aya never talks past an unanswered question.
//   say(question, { patience: [nudgeAt, giveUpAt], nudge, onTimeout, valid })
//     nudgeAt   seconds after sending: she double-texts `nudge` ("hello?? 👀"); the question STAYS open (chips stay)
//     giveUpAt  the question closes (chips withdrawn) and onTimeout() runs: the natural follow-up
//     valid()   polled; false = its premise is gone → closes quietly (chips withdrawn, onExpire)
//   A statement (no replies) closes the open question (chips withdrawn), unless it is that question's nudge.
//   say(text, { defer: s })   location banter: waits while a question is fresh, dropped after `s` seconds of waiting
//   aya.fresh()  a question is open and younger than its nudge (or give-up) time — new topics wait for it
//   aya.closeOpen(reason, timeout?)  · aya.nudgeNow() · aya.replied (real answers so far)
// Closing withdraws the phone's chips through ctx.phone.messages.clearReplies() (feature-detected).
// =============================================================================
const TYPE_MIN = 0.7, TYPE_PER_CHAR = 0.022, TYPE_MAX = 2.1;

export class Aya {
  constructor(ctx, game) {
    this.ctx = ctx; this.game = game;
    this.q = [];                // outbox: { msg, wait, typing, run, onReply, onExpire, state, t }
    this.cur = null;
    this.open = null;           // the open question
    this.sent = [];             // ids sent, in order
    this.answers = {};          // msgId -> replyId
    this.lastSentT = -1e9; this.lastReplyT = -1e9; this.t = 0;
    this._seq = 0;
    this._readT = 0;
    this.replied = 0;           // v9: real answers (not the chip-less fallback's auto ones)
    ctx.events.on('phone:reply', (e) => this._onReply(e));
  }
  get rich() { const p = this.ctx.phone; return !!(p && typeof p.message === 'function'); }

  say(m, opts = {}) {
    const msg = typeof m === 'string' ? { text: m } : Object.assign({}, m);
    if (!msg.id) msg.id = `aya_${++this._seq}`;
    msg.from = msg.from || 'Aya';
    const typing = opts.typing != null ? opts.typing : Math.min(TYPE_MAX, TYPE_MIN + (msg.text || '').length * TYPE_PER_CHAR);
    this.q.push({ msg, wait: opts.wait != null ? opts.wait : (this.q.length || this.cur ? 0.9 : 0.25), typing, run: opts.run || null, onReply: opts.onReply || null, onExpire: opts.onExpire || null,
      onTimeout: opts.onTimeout || null, patience: opts.patience || null, nudge: opts.nudge || null, valid: opts.valid || null, keepOpen: !!opts.keepOpen, defer: opts.defer != null ? opts.defer : null, qt: this.t, state: 'wait', t: 0 });
    return msg.id;
  }
  // send right now, outside the queue (the arrival cut-scene runs on real time; the outbox runs on game time)
  sayNow(m) {
    const msg = typeof m === 'string' ? { text: m } : Object.assign({}, m);
    if (!msg.id) msg.id = `aya_${++this._seq}`;
    msg.from = msg.from || 'Aya';
    this._typing(false); this._send({ msg });
    return msg.id;
  }
  // a custom send (e.g. the phone's Lodestone offer) behind the same typing beat
  act(run, { typing = 1.3, wait } = {}) { this.q.push({ msg: null, wait: wait != null ? wait : 0.6, typing, run, state: 'wait', t: 0 }); }
  idle(sec) { return !this.cur && !this.q.length && this.t - this.lastSentT >= sec; }
  busy() { return !!(this.cur || this.q.length); }
  answered(id) { return this.answers[id] != null; }
  wasSent(id) { return this.sent.includes(id); }
  // v9: a question is open and still within its patience (younger than its nudge, else its give-up time)
  fresh() {
    const o = this.open; if (!o) return false;
    const P = o.patience, f = P ? (P[0] != null ? P[0] : P[1] != null ? P[1] : 20) : 20;
    return this.t - o.t < f;
  }
  // close the open question: chips withdrawn on the phone; `timeout` runs its onTimeout (else onExpire)
  closeOpen(reason = 'closed', timeout = false) {
    const o = this.open; if (!o) return false;
    this.open = null;
    const ph = this.ctx.phone;
    try { const P = ph && ph.pendingReply; if (P && P.msgId === o.msg.id && ph.messages && typeof ph.messages.clearReplies === 'function') ph.messages.clearReplies(); } catch (e) { /* cosmetic */ }
    this.ctx.events.emit('aya:closed', { msgId: o.msg.id, reason });
    const fn = timeout ? o.onTimeout : o.onExpire;
    if (fn) { try { fn(); } catch (e) { console.error('[aya] close', e); } }
    return true;
  }
  // double-text the open question's nudge now (the story's walking accelerators); the question stays open
  nudgeNow() {
    const o = this.open; if (!o || o.nudged || !o.nudge) return false;
    o.nudged = true; o.nudgeT = this.t;
    this.say({ text: o.nudge }, { keepOpen: true, wait: 0.3 });
    return true;
  }
  _patience() {
    const o = this.open; if (!o) return;
    let ok = true;
    if (o.valid) { try { ok = !!o.valid(); } catch (e) { ok = true; } }
    if (!ok) { this.closeOpen('invalid'); return; }
    const P = o.patience; if (!P) return;
    const age = this.t - o.t;
    if (P[0] != null && o.nudge && !o.nudged && age >= P[0] && !this.cur && !this.q.length) this.nudgeNow();
    if (P[1] != null && age >= P[1] && !this.cur) this.closeOpen('timeout', true);
  }

  update(dt) {
    this.t += dt;
    this._patience();
    if (!this.cur && this.q.length) {
      const nx = this.q[0];
      // v9: location banter waits while a question is fresh (and is dropped once its moment has passed)
      if (nx.defer != null && this.fresh()) { if (this.t - nx.qt > nx.defer) this.q.shift(); }
      else { this.cur = this.q.shift(); this.cur.t = 0; }
    }
    const c = this.cur;
    if (c) {
      c.t += dt;
      if (c.state === 'wait' && c.t >= c.wait) { c.state = 'typing'; c.t = 0; if (c.typing > 0) this._typing(true); }
      if (c.state === 'typing' && c.t >= c.typing) { this._typing(false); this._send(c); this.cur = null; }
    }
    // fallback (no reply chips on this phone): reading the question counts as answering it with its first reply
    const o = this.open, ph = this.ctx.phone;
    if (o && !this.rich) {
      const reading = ph && ph.isOpen && ph.app === 'messages';
      this._readT = reading ? this._readT + dt : 0;
      if (this._readT > 1.5) { this._readT = 0; const r = o.msg.replies && o.msg.replies[0]; this._onReply({ msgId: o.msg.id, replyId: r ? r.id : null, text: r ? r.text : '', auto: true }); }
    }
  }

  _typing(on) {
    if (this._typingOn === on) return;
    this._typingOn = on;
    this.ctx.events.emit('phone:typing', { from: 'Aya', on });
  }
  _send(c) {
    this.lastSentT = this.t;
    if (c.run) { try { c.run(); } catch (e) { console.error('[aya] run', e); } }
    const m = c.msg; if (!m) return;
    const replies = m.replies && m.replies.length ? m.replies.map(r => ({ id: r.id, text: r.text })) : null;
    if (replies) {
      // one open question at a time
      if (this.open && this.open.msg.id !== m.id) { const o = this.open; this.open = null; this.ctx.events.emit('aya:closed', { msgId: o.msg.id, reason: 'superseded' }); if (o.onExpire) { try { o.onExpire(); } catch (e) { console.error('[aya] expire', e); } } }
      this.open = { msg: m, onReply: c.onReply, onExpire: c.onExpire, onTimeout: c.onTimeout, patience: c.patience, nudge: c.nudge, valid: c.valid, t: this.t };
    } else if (this.open && !c.keepOpen) this.closeOpen('topic');     // v9: a new topic closes the old question
    this.sent.push(m.id);
    const ph = this.ctx.phone;
    const payload = { id: m.id, from: m.from, text: m.text, time: this.ctx.clock.hhmm };
    if (m.link) payload.link = m.link;
    if (m.place) payload.place = m.place;          // v5: a place link card (Maps-style preview) in the bubble
    if (this.rich) {
      if (replies) { payload.replies = replies; payload.expectReply = true; }
      try { ph.message(payload); return; } catch (e) { console.error('[aya] phone.message', e); }
    }
    this.ctx.events.emit('phone:message', payload);
  }
  _onReply(e) {
    if (!e || !e.msgId) return;
    const o = this.open;
    if (!o || o.msg.id !== e.msgId) { if (e.msgId && this.answers[e.msgId] == null) this.answers[e.msgId] = e.replyId; return; }
    this.open = null;
    this.answers[e.msgId] = e.replyId;
    this.lastReplyT = this.t;
    if (!e.auto) this.replied++;
    const reply = (o.msg.replies || []).find(r => r.id === e.replyId) || null;
    this.ctx.events.emit('aya:answered', { msgId: e.msgId, replyId: e.replyId, lost: !!(reply && reply.lost), auto: !!e.auto });
    if (o.onReply) { try { o.onReply(e.replyId, reply); } catch (err) { console.error('[aya] onReply', err); } }
  }

  // test helper / keyboard-less fallback: answer the open question like a player would
  answer(msgId, replyId) {
    const o = this.open; if (!o) return false;
    if (msgId && o.msg.id !== msgId) return false;
    const rs = o.msg.replies || [];
    const i = Math.max(0, rs.findIndex(x => x.id === replyId));
    const r = rs[i]; if (!r) return false;
    const ph = this.ctx.phone;
    // the phone's own path (chip index, 0-based) appends the player's bubble exactly like a click
    const pend = ph && ph.pendingReply;
    if (ph && typeof ph.reply === 'function' && pend && pend.msgId === o.msg.id) { try { if (ph.reply(i) !== false) return true; } catch (e) { /* fall through */ } }
    this.ctx.events.emit('phone:reply', { msgId: o.msg.id, replyId: r.id, text: r.text });
    return true;
  }
}
