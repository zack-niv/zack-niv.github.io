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

// v10: a 1-D model of the real route (metres walked → where you are). Latte route: Nankai 3F/2F (0–170 m) → CITY 2F
// (170–360) → escalator → CITY 1F, the café at 390 m. Daikichi route: Nankai → CITY 2F (170–430) → Namba Parks (430+) → 650.
const CAFE_M = 390, DK_M = 650;
function where(dist, target, sc) {
  const lvl = sc.level && sc.level(dist);
  if (target === 'cafe') {
    const sp = dist < 170 ? 'nankai_3f_concourse' : dist < 360 ? 'city_2f_main' : 'city_1f_main';
    return { space: lvl && lvl[1] || sp, level: lvl && lvl[0] || (dist < 170 ? '3F' : dist < 360 ? '2F' : '1F'), rem: Math.max(0, CAFE_M - dist) };
  }
  const sp = dist < 170 ? 'nankai_3f_concourse' : dist < 430 ? 'city_2f_main' : 'parks_2f_hall';
  return { space: lvl && lvl[1] || sp, level: lvl && lvl[0] || (dist < 170 ? '3F' : '2F'), rem: Math.max(0, DK_M - dist) };
}
// scenario: { name, reply(msgId, replies, age) -> replyId | null, lost(t) -> reason|null, speed (m/s) | dist(t), progress (m per 30 s) }
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
    _lost: { rem: DK_M, init: DK_M }, _field: null, target: 'dk', _leg: null,
    _isLost: () => sc.lost(T.t, demo.target),
    progressOver: () => (T.t < 30 ? null : sc.progress(T.t, demo.target)),
    onTask: () => (sc.onTask ? sc.onTask(T.t, demo.target) : sc.progress(T.t, demo.target) >= 15),
    // v10: the same expectation model as demo.js (route m / 1.25 + 60 + 20 per floor; pace projection after 60 s)
    targetRem: () => demo._w.rem,
    _startLeg(key) { demo._leg = { key, t0: T.t, routeM: demo._w.rem, expected: Math.round(demo._w.rem / 1.25 + 60 + 20 * (key === 'cafe' ? 2 : 4)) }; },
    legState() {
      const L = demo._leg; if (!L) return null;
      const el = T.t - L.t0, cov = L.routeM - demo._w.rem, proj = cov > 5 ? el * L.routeM / cov : Infinity;
      return { key: L.key, elapsed: el, expected: L.expected, projected: proj, behind: el > L.expected * 1.1 || (el >= 60 && proj > L.expected * 1.3) };
    },
    setTarget(k) { demo.target = k; demo._w = where(dist, k, sc); demo._startLeg(k); lines.push(`${T.t.toFixed(1).padStart(6)}  · target → ${k} (expect ${demo._leg.expected} s)`); },
    offer(why, text) { if (demo.offered) return; demo.offered = true; demo.offerT = T.t; demo.why = why; phone.offerLodestone({ text, why }); events.emit('demo:offer', { why, t: T.t }); },
  };
  game.demo = demo;
  let dist = 0;
  demo._w = where(0, 'dk', sc); demo._startLeg('dk');
  const story = new Story(ctx, game, demo);
  game.story = story;
  if (sc.cafeDk != null) story._cafeDk = sc.cafeDk;       // Daikichi-distance of the café door (no nav graph in Node)
  const evs = [];
  for (const k of ['story:where', 'demo:offer', 'aya:answered', 'aya:closed', 'tutorial:step', 'story:errand']) events.on(k, (e) => evs.push([+T.t.toFixed(1), k, JSON.stringify(e)]));
  const beats = [], timers = [];
  events.on('story:beat', (e) => beats.push(`${e.id}:${e.why}@${e.t}`));
  events.on('story:timer', (e) => { timers.push(`${e.beat}@${e.t}${e.moving ? ' MOVING' : ''}`); lines.push(`${T.t.toFixed(1).padStart(6)}  · TIMER ${e.beat}${e.moving ? ' (moving player!)' : ''}`); });
  events.on('aya:closed', (e) => lines.push(`${T.t.toFixed(1).padStart(6)}  · closed ${e.msgId} (${e.reason})`));
  events.on('phone:reply', (e) => lines.push(`${T.t.toFixed(1).padStart(6)}  > me: ${e.text}`));
  story.begin(DEMO.introHold);
  const bad = []; let freshTopic = 0;
  const dt = 0.05;
  for (let i = 0; i < 260 / dt; i++) {
    T.t += dt; demo.t = T.t;
    const nd = sc.dist ? sc.dist(T.t) : (sc.speed || 0) * Math.max(0, T.t - 5);
    game.journal.distance += Math.max(0, nd - dist); dist = nd;
    demo._w = where(dist, demo.target, sc);
    body.level = demo._w.level; ctx.player.space = { id: demo._w.space };
    demo._lost.rem = demo.target === 'cafe' ? Math.max(0, DK_M - dist + 60) : demo._w.rem;
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
  // v9 critic: she never asks back what the player just told her ("I'm lost 😭" → "you're lost aren't you 😂")
  phone.thread.forEach((m, i) => { const prev = phone.thread.slice(0, i).filter(x => x.me).pop(); if (!m.me && m.id === 'aya_lodestone' && prev && /lost|Which way/.test(prev.text) && /lost aren't you/.test(m.text)) bad.push(`offer asks "${m.text.slice(0, 30)}" right after "${prev.text}"`); });
  // v10 critic: nothing from Aya directs the player once Lodestone is offered (the app does that now)
  { const k = phone.thread.findIndex(m => m.id === 'aya_lodestone'); if (k >= 0) phone.thread.slice(k + 1).forEach(m => { if (!m.me && /ooh you're in CITY/.test(m.text || '')) bad.push(`stale CITY tip after the offer: "${m.text.slice(0, 40)}"`); }); }
  const ok = !bad.length && demo.offered && demo.offerT <= DEMO.offerAt + 0.5 && (!sc.expect || sc.expect(story, demo, lines, timers));
  console.log(`\n=== ${sc.name}: ${ok ? 'PASS' : 'FAIL'}  offer ${demo.offered ? demo.offerT.toFixed(1) + ' s (' + demo.why + ')' : 'NONE'} · errand ${story.errand.state} · replied ${story.aya.replied} · timers [${timers.join(', ')}]`);
  console.log('  beats: ' + beats.join(' · '));
  console.log(lines.join('\n'));
  if (bad.length) console.log('  ANOMALIES:\n  ' + bad.slice(0, 12).join('\n  '));
  if (V) console.log(evs.map(e => e.join(' ')).join('\n'));
  return ok;
}

const first = (id, rs) => rs[0].id;
const stalled = () => 'stalled', fine = () => null;
const noTimer = (tm) => !tm.some(x => /offer-cap/.test(x));
const results = [
  // --- v9 scenarios, predictions updated for v10 (places, not clocks) ---
  run({ name: 'silent stander (never replies, never moves)', speed: 0, lost: (t) => (t > 30 ? 'stalled' : null), progress: () => 0,
    expect: (s, d, l) => d.why === 'silent' && s.aya.replied === 0 && l.some(x => /still at the station/.test(x)) }),
  run({ name: 'never replies, walking steadily (1.5 m/s, not lost)', speed: 1.5, lost: fine, progress: () => 30,
    expect: (s, d, l, tm) => d.why === 'floors' && d.offerT > 150 && d.offerT < 185 && noTimer(tm) }),
  run({ name: 'instant replier, stuck in CITY at 90 s', dist: (t) => 1.3 * Math.max(0, Math.min(t, 140) - 5), lost: (t) => (t > 140 ? 'stalled' : null), progress: (t) => (t > 140 ? 0 : 30),
    reply: (id, rs, age) => (age < 0.3 ? null : /^where/.test(id) ? 'lost' : rs[0].id),
    expect: (s, d, l, tm) => d.why === 'lost' && noTimer(tm) }),
  run({ name: 'bot-like steady walker (1.4 m/s, 2.5 s replies)', speed: 1.4, lost: () => null, progress: () => 25,
    reply: (id, rs, age) => (age < 2.5 ? null : /^where/.test(id) ? 'lost' : rs[0].id),
    expect: (s, d, l, tm) => d.why === 'floors' && noTimer(tm) }),
  run({ name: 'early "Which way??" then stuck', speed: 0.3, lost: () => null, progress: () => 3,
    reply: (id, rs, age) => (age < 1.5 ? null : id === 'meet' ? 'lost' : rs[0].id),
    expect: (s, d, l) => d.why === 'early' && d.offerT < 110 && !l.some(x => /  where/.test(x)) }),
  run({ name: 'declines the latte, then walks away (away)', dist: (t) => 1.2 * Math.max(0, Math.min(t, 100) - 5), lost: (t) => (t > 100 ? 'away' : null), progress: (t) => (t > 100 ? 0 : 20),
    reply: (id, rs, age) => (age < 2 ? null : id === 'coffee' ? 'no' : /^where/.test(id) ? rs.find(r => r.id !== 'lost').id : rs[0].id),
    expect: (s, d, l) => s.errand.state === 'declined' && d.why === 'checkin' && l.some(x => /where are you going/.test(x)) }),
  run({ name: 'fast runner, never replies (past the café before she asks)', speed: 3.2, lost: fine, progress: () => 90, cafeDk: 600,
    expect: (s, d, l, tm) => s.errand.state === 'dropped' && d.why === 'parks' && s.tut.isDone('reply') && noTimer(tm) }),
  run({ name: 'jogger on the latte leg (offer at the CITY floor change)', speed: 3.2, lost: fine, progress: () => 90, cafeDk: 200,
    reply: (id, rs, age) => (age < 2.5 ? null : /^where/.test(id) ? 'lost' : rs[0].id),
    expect: (s, d, l, tm) => d.why === 'floors' && d.offerT < 110 && noTimer(tm) }),
  // --- v10 (V10.md quality bar) ---
  run({ name: 'v10 strong player: fast, never lost, declines the latte (Parks entry)', speed: 3.0, lost: fine, progress: () => 90,
    reply: (id, rs, age) => (age < 1.5 ? null : id === 'coffee' ? 'no' : rs[0].id),
    expect: (s, d, l, tm) => d.why === 'parks' && noTimer(tm) && !l.some(x => /where_|  where /.test(x)) }),
  run({ name: 'v10 slow walker (0.6 m/s, not lost, never replies)', speed: 0.6, lost: fine, progress: () => 18,
    expect: (s, d, l, tm) => d.why === 'behind' && noTimer(tm) && l.some(x => /how's my latte coming/.test(x)) }),
  run({ name: 'v10 slow walker who says "On my way!"', speed: 0.6, lost: fine, progress: () => 18,
    reply: (id, rs, age) => (age < 2 ? null : /^where/.test(id) ? rs.find(r => r.id !== 'lost').id : rs[0].id),
    expect: (s, d, l, tm) => d.why === 'behind' && s.aya.replied === 4 && d.offerT < 105 && noTimer(tm) }),
  run({ name: 'v10 wrong-floor wanderer (down to B1 on the latte leg)', speed: 1.2, level: (m) => (m > 120 ? ['B1', 'city_b1_main'] : null),
    dist: (t) => 1.2 * Math.max(0, Math.min(t, 110) - 5), lost: (t) => (t > 110 ? 'floor' : null), progress: (t) => (t > 110 ? 0 : 25),
    reply: (id, rs, age) => (age < 2 ? null : /^where/.test(id) ? 'lost' : rs[0].id),
    // v10 critic: she infers the floor (Maps-grade shared dot has none), and the tip from B1 points UP
    expect: (s, d, l) => d.why === 'lost' && l.some(x => /your dot isn't getting any closer 😂 wrong floor\? the café's on 1F/.test(x)) && l.some(x => /café's on 1F 👆/.test(x)) }),
  // v10 critic: a typical first-timer — looks around, reads the phone: ~1.0 m/s average, replies, never really lost
  run({ name: 'v10 critic: typical first-timer (1.0 m/s, replies, not lost)', speed: 1.0, lost: fine, progress: () => 16,
    reply: (id, rs, age) => (age < 3 ? null : /^where/.test(id) ? rs.find(r => r.id !== 'lost').id : rs[0].id),
    expect: (s, d, l, tm) => noTimer(tm) }),
  run({ name: 'v10 critic: first-timer who declines (1.0 m/s)', speed: 1.0, lost: fine, progress: () => 16,
    reply: (id, rs, age) => (age < 3 ? null : id === 'coffee' ? 'no' : /^where/.test(id) ? rs.find(r => r.id !== 'lost').id : rs[0].id),
    expect: (s, d, l, tm) => noTimer(tm) }),
  // v10 critic (the browser wander run): lost early, offered at ~100 s, reaches CITY only afterwards — no directions tip
  // from Aya once Lodestone is on the table (it used to arrive 66 s after "see? 😌 it even knows which floor…")
  run({ name: 'v10 critic: lost early, enters CITY after the offer (no stale tip)', stopAfterOffer: false,
    dist: (t) => (t < 100 ? 0.5 * Math.max(0, t - 5) : 47.5 + 1.5 * (t - 100)), lost: fine, progress: (t) => (t < 100 ? 12 : 45),
    reply: (id, rs, age) => (age < 2 ? null : /^where/.test(id) ? 'lost' : rs[0].id),
    expect: (s, d, l, tm) => d.why === 'lost' && noTimer(tm) && !l.some(x => /ooh you're in CITY/.test(x)) && l.some(x => /lol I knew it/.test(x)) }),
];
console.log(`\n${results.filter(Boolean).length}/${results.length} scenarios pass`);
process.exit(results.every(Boolean) ? 0 : 1);
