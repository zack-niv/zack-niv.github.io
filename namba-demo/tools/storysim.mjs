// v9: Node-only simulation of the story's beat flow (story.js + aya.js + tutorial.js) with a fake phone / demo / game.
// Runs in milliseconds. Checks the conversation contract on every tick:
//   - reply chips on the phone always belong to Aya's open question (never under another text)
//   - the Lodestone offer lands by 210 s, and Aya never sends a new topic over a fresh question
//   node tools/storysim.mjs            all scenarios, prints each timeline + PASS/FAIL
//   node tools/storysim.mjs --v        + every tick's anomalies
globalThis.location = { search: '', hash: '', href: 'http://sim/' };
globalThis.sessionStorage = { getItem() { return null; }, setItem() {} };
const { Story } = await import('../js/game/story.js');
const { DEMO } = await import('../js/game/script.js');
const V = process.argv.includes('--v');

function emitter() {
  const h = {};
  return { on(n, f) { (h[n] = h[n] || []).push(f); }, emit(n, e) { for (const f of h[n] || []) f(e); } };
}
// the phone's Messages semantics (js/ui/phone/apps.js): chips replace on a new question, persist otherwise,
// clearReplies() withdraws them, reply(i) emits 'phone:reply'
function fakePhone(events, log) {
  const ph = {
    isOpen: false, app: null, upgradeStage: 'none', destination: null, suggested: null, thread: [],
    messages: { pending: null, clearReplies() { this.pending = null; } },
    get pendingReply() { return this.messages.pending; },
    message(m) { events.emit('phone:message', m); },
    suggest(s) { this.suggested = s; },
    reply(i) { const P = this.messages.pending; if (!P) return false; const r = P.replies[i]; this.messages.pending = null; this.thread.push({ me: true, text: r.text }); events.emit('phone:reply', { msgId: P.msgId, replyId: r.id, text: r.text }); return true; },
    offerLodestone(o) { if (this.upgradeStage !== 'none') return false; this.upgradeStage = 'offer'; events.emit('phone:message', { id: 'aya_lodestone', from: 'Aya', text: o.text, link: 'lodestone' }); return true; },
  };
  events.on('phone:message', (m) => {
    ph.thread.push({ id: m.id, text: m.text, chips: !!(m.replies && m.replies.length) });
    if (m.replies && m.replies.length) ph.messages.pending = { msgId: m.id, from: 'Aya', replies: m.replies };
    log(m.id, m.text, m.replies ? m.replies.map(r => r.text).join(' / ') : '');
  });
  return ph;
}

// scenario: { name, reply(msgId, replies, age) -> replyId | null, lost(t) -> reason|null, speed (m/s), progress (m per 30 s) }
function run(sc) {
  const events = emitter();
  const T = { t: 0 };
  const lines = [];
  const log = (id, text, chips) => lines.push(`${T.t.toFixed(1).padStart(6)}  ${String(id).padEnd(14)} ${String(text).slice(0, 70)}${chips ? `   [${chips}]` : ''}`);
  const phone = fakePhone(events, log);
  const body = { level: '3F', x: 0, z: 0 };
  const ctx = { events, phone, clock: { hhmm: '11:20' }, player: { body, yaw: 0, space: null }, nav: null };
  const game = { journal: { distance: 0 }, busy: false, intro: false, paused: false, ended: false, started: true, hud: null, interactions: null, setQuest() {}, message: (text) => story.aya.say({ text }) };
  const demo = {
    t: 0, offered: false, arrived: false, _offerAt: DEMO.offerAt, _offerMin: DEMO.offerMin,
    _lost: { rem: 600, init: 600 }, _field: null, target: 'dk',
    _isLost: () => sc.lost(T.t, demo.target),
    progressOver: () => (T.t < 30 ? null : sc.progress(T.t, demo.target)),
    onTask: () => (sc.onTask ? sc.onTask(T.t, demo.target) : sc.progress(T.t, demo.target) >= 15),
    setTarget(k) { demo.target = k; lines.push(`${T.t.toFixed(1).padStart(6)}  · target → ${k}`); },
    offer(why, text) { if (demo.offered) return; demo.offered = true; demo.offerT = T.t; demo.why = why; phone.offerLodestone({ text, why }); events.emit('demo:offer', { why, t: T.t }); },
  };
  game.demo = demo;
  const story = new Story(ctx, game, demo);
  game.story = story;
  if (sc.cafeDk != null) story._cafeDk = sc.cafeDk;       // Daikichi-distance of the café door (no nav graph in Node)
  const evs = [];
  for (const k of ['story:where', 'demo:offer', 'aya:answered', 'aya:closed', 'tutorial:step', 'story:errand']) events.on(k, (e) => evs.push([+T.t.toFixed(1), k, JSON.stringify(e)]));
  events.on('aya:closed', (e) => lines.push(`${T.t.toFixed(1).padStart(6)}  · closed ${e.msgId} (${e.reason})`));
  events.on('phone:reply', (e) => lines.push(`${T.t.toFixed(1).padStart(6)}  > me: ${e.text}`));
  story.begin(DEMO.introHold);
  const bad = []; let freshTopic = 0;
  const dt = 0.05;
  for (let i = 0; i < 260 / dt; i++) {
    T.t += dt; demo.t = T.t;
    if (!demo.offered || sc.walkAfter) game.journal.distance += (sc.speed || 0) * dt;
    if (sc.rem) demo._lost.rem = sc.rem(T.t);
    story.update(dt);
    // the player answers (like pressing 1/2 on the phone)
    const P = phone.messages.pending, o = story.aya.open;
    if (P && o && o.msg.id === P.msgId && sc.reply) {
      const age = story.aya.t - o.t;
      const want = sc.reply(P.msgId, P.replies, age);
      if (want != null) { const i = P.replies.findIndex(r => r.id === want); if (i >= 0) phone.reply(i); }
    }
    // invariant: the chips on screen are the open question's
    const pid = phone.messages.pending ? phone.messages.pending.msgId : null, oid = story.aya.open ? story.aya.open.msg.id : null;
    if (pid !== oid) bad.push(`${T.t.toFixed(1)} chips=${pid} open=${oid}`);
    // invariant: the newest text in the thread is the open question or its nudge (no topic talks past fresh chips)
    if (pid) {
      const last = phone.thread[phone.thread.length - 1];
      if (last && !last.me && last.id !== pid && !/hello\?\? 👀/.test(last.text)) { freshTopic++; if (freshTopic < 4) bad.push(`${T.t.toFixed(1)} chips(${pid}) under "${String(last.text).slice(0, 40)}"`); }
    }
    if (demo.offered && T.t > demo.offerT + 5 && sc.stopAfterOffer !== false) break;
  }
  const ok = !bad.length && demo.offered && demo.offerT <= 210 && (!sc.expect || sc.expect(story, demo, lines));
  console.log(`\n=== ${sc.name}: ${ok ? 'PASS' : 'FAIL'}  offer ${demo.offered ? demo.offerT.toFixed(1) + ' s (' + demo.why + ')' : 'NONE'} · errand ${story.errand.state} · replied ${story.aya.replied}`);
  console.log(lines.join('\n'));
  if (bad.length) console.log('  ANOMALIES:\n  ' + bad.slice(0, 12).join('\n  '));
  if (V) console.log(evs.map(e => e.join(' ')).join('\n'));
  return ok;
}

const first = (id, rs) => rs[0].id;
const stalled = () => 'stalled', fine = () => null;
const results = [
  run({ name: 'never replies, standing still (stalled)', speed: 0, lost: (t) => (t > 30 ? 'stalled' : null), progress: () => 0,
    expect: (s, d) => d.why === 'silent' && s.aya.replied === 0 }),
  run({ name: 'never replies, walking steadily (not lost)', speed: 1.5, lost: fine, progress: () => 30,
    expect: (s, d) => d.offerT >= DEMO.offerAt && d.offerT <= DEMO.offerAt + DEMO.offerGrace }),
  run({ name: 'instant replier (happy path, lost at Where)', speed: 1.3, lost: (t) => (t > 90 ? 'stalled' : null), progress: (t) => (t > 90 ? 0 : 30),
    reply: (id, rs, age) => (age < 0.3 ? null : id === 'where' ? 'lost' : rs[0].id),
    expect: (s, d) => d.why === 'lost' && s.errand.state === 'asked' }),
  run({ name: 'bot-like (2.5 s, omw, lost at Where)', speed: 1.4, lost: () => null, progress: () => 25,
    reply: (id, rs, age) => (age < 2.5 ? null : id === 'where' ? 'lost' : rs[0].id),
    expect: (s, d) => d.why === 'lost' }),
  run({ name: 'early "Which way??" then stuck', speed: 0.3, lost: () => null, progress: () => 3,
    reply: (id, rs, age) => (age < 1.5 ? null : id === 'meet' ? 'lost' : rs[0].id),
    expect: (s, d) => d.why === 'early' && d.offerT < 110 }),
  run({ name: 'declines the latte', speed: 1.2, lost: (t) => (t > 100 ? 'away' : null), progress: (t) => (t > 100 ? 0 : 20),
    reply: (id, rs, age) => (age < 2 ? null : id === 'coffee' ? 'no' : id === 'where' ? 'omw' : rs[0].id),
    expect: (s, d) => s.errand.state === 'declined' }),
  run({ name: 'fast runner, never replies (past the café before she asks)', speed: 3.2, lost: fine, progress: () => 90,
    rem: (t) => Math.max(20, 600 - 3.2 * Math.max(0, t - 5)), cafeDk: 540,
    expect: (s, d) => s.errand.state === 'dropped' && d.why === 'ahead' && s.tut.isDone('reply') }),
];
console.log(`\n${results.filter(Boolean).length}/${results.length} scenarios pass`);
process.exit(results.every(Boolean) ? 0 : 1);
