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
    ctx.events.on('phone:reply', (e) => this._onReply(e));
  }
  get rich() { const p = this.ctx.phone; return !!(p && typeof p.message === 'function'); }

  say(m, opts = {}) {
    const msg = typeof m === 'string' ? { text: m } : Object.assign({}, m);
    if (!msg.id) msg.id = `aya_${++this._seq}`;
    msg.from = msg.from || 'Aya';
    const typing = opts.typing != null ? opts.typing : Math.min(TYPE_MAX, TYPE_MIN + (msg.text || '').length * TYPE_PER_CHAR);
    this.q.push({ msg, wait: opts.wait != null ? opts.wait : (this.q.length || this.cur ? 0.9 : 0.25), typing, run: opts.run || null, onReply: opts.onReply || null, onExpire: opts.onExpire || null, state: 'wait', t: 0 });
    return msg.id;
  }
  // a custom send (e.g. the phone's Lodestone offer) behind the same typing beat
  act(run, { typing = 1.3, wait } = {}) { this.q.push({ msg: null, wait: wait != null ? wait : 0.6, typing, run, state: 'wait', t: 0 }); }
  idle(sec) { return !this.cur && !this.q.length && this.t - this.lastSentT >= sec; }
  busy() { return !!(this.cur || this.q.length); }
  answered(id) { return this.answers[id] != null; }
  wasSent(id) { return this.sent.includes(id); }

  update(dt) {
    this.t += dt;
    if (!this.cur && this.q.length) { this.cur = this.q.shift(); this.cur.t = 0; }
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
      if (this.open && this.open.msg.id !== m.id) { const o = this.open; this.open = null; if (o.onExpire) { try { o.onExpire(); } catch (e) { console.error('[aya] expire', e); } } }
      this.open = { msg: m, onReply: c.onReply, onExpire: c.onExpire, t: this.t };
    }
    this.sent.push(m.id);
    const ph = this.ctx.phone;
    const payload = { id: m.id, from: m.from, text: m.text, time: this.ctx.clock.hhmm };
    if (m.link) payload.link = m.link;
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
