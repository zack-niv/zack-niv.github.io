// =============================================================================
// The end card: the professional climax of the demo. The world stays alive and
// softly blurred behind it. Left: the line and the note. Right: the player's
// own journey, measured live, before vs after the upgrade.
//   showEndCard(ctx, summary, { onRoam, onReplay }) -> { close() }
// summary = { upgraded, before:{err,p90,wrongPct,dotWithin5,headingSettle,...}, after:{...}|null, ... }
// v7.2: a fixed set of four rows, each defined identically in both phases; primary buttons above two contact cards.
// v7.3: 'On track' (with time off route) replaces 'arrow catches up' as the headline row.
// The only colours are ours (warm amber = guesswork, cool blue = Lodestone's own).
// v22: the game is a race to Aya; with summary.mission the card shows the player's score, its breakdown and the public board (showMission below).
//   Without summary.mission (the old ?lodestone arc) the original card below is untouched.
// =============================================================================
import { ENDCARD } from './script.js?v=bdb557c';
import { fetchScores, postScore, hasScores } from './scores.js?v=bdb557c';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const mmss = (s) => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const metres = (m) => `${Math.round(m).toLocaleString('en-US')}`;
const err = (m) => (m == null ? '—' : m >= 9.5 ? `±${Math.round(m)}` : `±${(Math.max(0.5, Math.round(m * 2) / 2)).toString().replace(/\.0$/, '')}`);
const bar = (v, max) => `${Math.max(3, Math.min(100, (v / Math.max(1e-6, max)) * 100)).toFixed(1)}%`;

// m/min with a true minus sign: "before" can honestly be zero or negative
const mpm = (v) => { const r = Math.round(v); return `${r < 0 ? '\u2212' : ''}${Math.abs(r)}<small>m/min</small>`; };

const pct = (v) => `${v > 0 && v < 1 ? '<1' : Math.round(v)}<small>%</small>`;
const ICON = {
  chat: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 4.5h12a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5H9l-3.6 2.6V14.5H4A1.5 1.5 0 0 1 2.5 13V6A1.5 1.5 0 0 1 4 4.5z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M6.5 8.5h7M6.5 11h4.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  people: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8" cy="7" r="3" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M2.8 16.5c.5-3 2.6-4.6 5.2-4.6s4.7 1.6 5.2 4.6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M15.5 6v5M13 8.5h5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  cal: '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="4.5" width="14" height="12.5" rx="2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M3 8.5h14M7 2.8v3.4M13 2.8v3.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="10" cy="12.6" r="1.3" fill="currentColor"/></svg>',
};
// v7.2: two equal contact cards (icon in a tinted circle, title, one-line subtitle, ↗). Cool blue = the agent, warm amber = the other card
// (v21: LinkedIn; it was a calendar. The amber style keeps its old class name, `call`).
const SUB = { chat: 'Ask it anything about me and my work', cal: 'Pick a time that works for you', people: 'Say hello, or follow what I build next' };
const link = (L, icon, tone) => (L && L.url
  ? `<a class="e-link ${tone}" href="${esc(L.url)}" target="_blank" rel="noopener noreferrer"><span class="e-ic">${ICON[icon]}</span><span class="e-tx"><b>${esc(L.label)}</b><small>${esc(L.sub || SUB[icon])}</small></span><i aria-hidden="true">↗</i><em class="e-sr"> (opens in a new tab)</em></a>`
  : '');

// v7.3: the same two contact cards in the pause menu (players who leave mid-way never see the end card)
export const contactLinks = () => `${link(ENDCARD.linkedin, 'people', 'call')}${link(ENDCARD.agent, 'chat', 'agent')}`;
// true when at least one card has somewhere to go
export const hasContact = () => !!((ENDCARD.linkedin && ENDCARD.linkedin.url) || (ENDCARD.agent && ENDCARD.agent.url));

export function showEndCard(ctx, s, { onRoam, onReplay } = {}) {
  if (s && s.mission) return showMission(ctx, s, { onRoam, onReplay });
  const b = s.before, a = s.after;
  const ok = (v) => v != null && isFinite(v);
  // v7.2: a FIXED set of four rows, each defined identically in both phases (same samples, same formula), so the
  // columns are comparable and the card never changes shape with how the player happened to walk. (The old
  // detour / wrong-turn rows were measured against different routes after the upgrade: dropped from the card.)
  //   1. on track: % of walking seconds that got you closer to where you were going, by the   higher is better
  //      direct way or Aya's canyon way (same yardstick both phases); caption = time off route
  //   2. position error: mean metres between the phone's dot and you (+ p90 in the caption)   lower is better
  //   3. on the wrong floor: % of the time the dot was on another floor                       lower is better
  //   4. blue dot within 5 m of you: % of walking time (right floor and <= 5 m)               higher is better
  // A phase with no data shows "—" and says why (never a made-up number).
  const p90 = (x) => (x && ok(x.p90) ? `mean · 90% within ${err(x.p90)} m` : 'mean, by the phone');
  const off = (x) => (x && ok(x.offRouteSec) ? `${mmss(x.offRouteSec)} min off route` : 'of your walking time');
  const rows = [
    { k: 'On track', dir: 'higher', get: (x) => x.onTrackPct, fmt: pct, abs: 100, cap: (v, x) => off(x) },
    { k: 'Position error', dir: 'lower', get: (x) => x.err, fmt: (v) => `${err(v)}<small>m</small>`, cap: (v, x) => p90(x) },
    { k: 'On the wrong floor', dir: 'lower', get: (x) => x.wrongPct, fmt: pct, cap: (v) => (v < 0.5 ? 'right floor, every time' : 'of the time, by the phone') },
    { k: 'Blue dot within 5 m of you', dir: 'higher', get: (x) => x.dotWithin5, fmt: pct, abs: 100, cap: () => 'of your walking time' },
  ];
  const total = [
    s.totalSeconds != null && isFinite(s.totalSeconds) ? `${mmss(s.totalSeconds)} min` : null,
    s.totalMeters != null && isFinite(s.totalMeters) ? `${metres(s.totalMeters)} m on foot` : null,
    s.errand && s.errand.delivered ? `1 ${s.errand.item || 'coffee'} delivered` : null,      // v4: the coffee stop
  ].filter(Boolean).join(' · ');
  const val = (r, side) => { const x = side === 'b' ? b : a; const v = x ? r.get(x) : null; return ok(v) ? v : null; };
  // the better side (by a clear margin) gets a quiet highlight so "better" reads at a glance whichever way is better
  const winner = (r) => {
    const vb = val(r, 'b'), va = val(r, 'a');
    if (vb == null || va == null || Math.abs(vb - va) < Math.max(0.04 * Math.max(Math.abs(vb), Math.abs(va)), 0.05)) return null;
    return (r.dir === 'lower') === (va < vb) ? 'a' : 'b';
  };
  const cell = (r, side, win) => {
    const v = val(r, side), x = side === 'b' ? b : a;
    if (v == null) {
      const why = side === 'a' && !a ? 'Lodestone not installed' : 'not enough data';
      return `<div class="e-v ${side} none"><b class="e-none">—</b><i class="e-bar"></i><span>${why}</span></div>`;
    }
    const max = r.abs || Math.max(val(r, 'b') || 0, val(r, 'a') || 0, 1e-6);
    return `<div class="e-v ${side}${win === side ? ' win' : win ? ' lose' : ''}"><b>${r.fmt(v)}</b><i class="e-bar"><u style="--w:${bar(v, max)}"></u></i><span>${esc(r.cap(v, x))}</span></div>`;
  };
  const talk = hasContact();
  const el = document.createElement('div');
  el.className = 'g-end';
  el.innerHTML = `
    <div class="e-wrap">
      <section class="e-left">
        <div class="e-eyebrow"><span class="e-dot"></span>着いた。<em>You made it.</em></div>
        <h1 class="e-line">Indoor spaces shouldn't run on <span>guesswork.</span></h1>
        <p class="e-where">${esc(ENDCARD.kicker)}</p>
        <p class="e-note">Built by <b>Zack Niv</b> — a love letter to Namba and to getting lost in Japan.</p>
        ${ENDCARD.contact ? `<p class="e-contact">${esc(ENDCARD.contact)}</p>` : ''}
        <div class="e-btns">
          <button type="button" class="g-btn sel" data-a="roam">Keep exploring <small>まだ歩く</small></button>
          <button type="button" class="g-btn" data-a="replay">Replay <small>もう一度</small></button>
        </div>
        ${talk ? `<div class="e-talk">${ENDCARD.invite ? `<p class="e-invite">${esc(ENDCARD.invite)}</p>` : ''}<div class="e-links">${contactLinks()}</div></div>` : ''}
      </section>
      <section class="e-right" aria-label="Your journey, before and after">
        <div class="e-head"><span>Your journey, measured live</span></div>
        <div class="e-cols">
          <div class="e-col-h b"><i></i><b>Before</b><small>an ordinary maps app</small></div>
          <div class="e-col-h a"><i></i><b>After</b><small>Lodestone</small></div>
        </div>
        ${rows.map(r => { const w = winner(r); return `<div class="e-row"><div class="e-k">${esc(r.k)}<small>${r.dir === 'lower' ? '↓ lower is better' : '↑ higher is better'}</small></div>${cell(r, 'b', w)}${cell(r, 'a', w)}</div>`; }).join('')}
        ${total ? `<p class="e-total">Whole trip: ${esc(total)}</p>` : ''}
        ${a ? '' : '<p class="e-foot">Lodestone was waiting in your messages the whole time.</p>'}
        <p class="e-honest">${a ? 'Maps simulates typical indoor GPS/Wi\u2011Fi; Lodestone simulates ~1\u00a0m positioning. Both measured live on your walk.' : 'Maps simulates typical indoor GPS/Wi\u2011Fi, measured live on your walk.'}</p>
      </section>
    </div>`;
  (ctx.ui.overlay || document.body).appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('on')));
  const btns = [...el.querySelectorAll('.g-btn')];
  const act = (v) => {
    removeEventListener('keydown', key, true);
    try { ctx.events.emit('demo:choice', { choice: v === 'replay' ? 'replay' : 'roam' }); } catch (e) { /* analytics only */ }
    if (v === 'replay') return onReplay && onReplay();
    onRoam && onRoam();
  };
  const select = (x, focus) => { btns.forEach(y => y.classList.toggle('sel', y === x)); if (focus) try { x.focus({ preventScroll: true }); } catch (e) { /* old browsers */ } };
  // Keys: E / Enter / Space confirm the highlighted button, ← → (A D) switch it. Tab is the browser's own (it walks
  // buttons and the two links); on a focused link the keys are left alone, so Enter opens it in a new tab.
  const key = (e) => {
    if (e.repeat) return;
    const fx = document.activeElement;
    if (fx && fx.tagName === 'A' && el.contains(fx)) return;
    if (e.code === 'KeyE' || e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); e.stopImmediatePropagation(); act(el.querySelector('.g-btn.sel').dataset.a); }
    if (['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD'].includes(e.code)) { e.preventDefault(); e.stopImmediatePropagation(); select(btns.find(x => !x.classList.contains('sel')) || btns[0], true); }
    if (e.code === 'Tab') e.stopImmediatePropagation();       // native focus moves; the game must not see it
  };
  addEventListener('keydown', key, true);
  btns.forEach(x => {
    x.addEventListener('click', (ev) => { ev.stopPropagation(); act(x.dataset.a); });
    x.addEventListener('focus', () => select(x, false));
  });
  el.querySelectorAll('.e-link').forEach(x => x.addEventListener('click', (ev) => ev.stopPropagation()));
  return {
    el,
    close() { removeEventListener('keydown', key, true); el.classList.remove('on'); setTimeout(() => el.remove(), 900); },
  };
}

// =============================================================================
// v22: the race card. Left: how it ended, the score and its breakdown, the buttons, the contact cards. Right: "Top scores" (scores.js).
// =============================================================================
const headline = (tier, coffee) => (tier === 'full' ? `Counter seats. ${coffee ? 'Coffee' : 'Hot tempura'}. <span>Train made.</span>` : tier === 'train' ? 'No seats, but you <span>made the train.</span>' : 'The Koya left <span>without you.</span>');
const BRAG = 'https://zack-niv.github.io/namba-demo/?ref=brag';
const lsGet = (k) => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } };
const initialsOf = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
const runId = () => { try { return crypto.randomUUID(); } catch (e) { return Date.now().toString(36) + Math.random().toString(36).slice(2, 10); } };
const NAP = 'Scoreboard is taking a nap. Your score still counts for bragging.';

function showMission(ctx, s, { onRoam, onReplay } = {}) {
  const M = s.mission, tier = ['full', 'train'].includes(M.tier) ? M.tier : 'missed';
  const eligible = tier !== 'missed', seats = tier === 'full', coffee = !!M.coffee;
  const score = isFinite(M.score) ? Math.max(0, Math.round(M.score)) : 0, secs = isFinite(M.seconds) ? Math.max(0, M.seconds) : 0;
  const hints = Math.max(0, M.hints | 0), metersOn = s.totalMeters != null && isFinite(s.totalMeters) ? Math.round(s.totalMeters) : null;
  const num = (n) => Math.round(n).toLocaleString('en-US');
  const facts = [`${mmss(secs)} total`, hints > 0 ? `\u{1F4F8} ${hints} photo${hints === 1 ? '' : 's'} sent` : null, metersOn != null ? `${metres(metersOn)} m on foot` : null].filter(Boolean);
  const brag = eligible ? `I scored ${num(score)} in Lost in Namba \u{1F364}\u{1F683} Can you beat it? ${BRAG}` : `I missed the train in Lost in Namba \u{1F683} Can you make it? ${BRAG}`;
  // the ledger is computed by the story side and drawn exactly as given, in order: Start, Time (negative), seats, coffee, train, optional floor.
  // pts > 0 -> "+1,000"; pts < 0 -> true minus; pts 0 -> its note in place of the points, dimmed (the Train line, when made, shows a check instead).
  const lines = (Array.isArray(M.lines) ? M.lines : []).filter(l => l && typeof l === 'object');
  const isTrain = (l) => l.icon === '\u{1F686}' || /^train/i.test(String(l.label || ''));
  const chips = [];
  const lineHtml = lines.map((l, i) => {
    const pts = isFinite(l.pts) ? Math.round(l.pts) : 0, start = i === 0 && /^start/i.test(String(l.label || '')), train = isTrain(l) && eligible;
    let right, sub = l.note || '', cls = '';
    if (pts > 0) right = start ? num(pts) : `+${num(pts)}`;
    else if (pts < 0) right = `\u2212${num(-pts)}`;
    else if (train) right = '\u2713';
    else { right = l.note ? esc(l.note) : '0'; sub = ''; cls = 'dim'; }
    if (pts === 0 && isTrain(l) && !eligible) cls = 'dim';
    // v23: the same ledger as one compact chip per line (short screens show these instead of the list); Start and a zero line with only a note are skipped or dimmed
    if (!start) chips.push(`<span class="e-chip${pts < 0 ? ' neg' : ''}${train ? ' ok' : ''}${cls === 'dim' ? ' dim' : ''}"><i aria-hidden="true">${esc(l.icon)}</i>${esc(pts > 0 ? '+' + num(pts) : pts < 0 ? '\u2212' + num(-pts) : train ? '\u2713' : '\u2013')}</span>`);
    return `<li class="${cls}${pts < 0 ? ' neg' : ''}${train ? ' ok' : ''}"><span class="e-li" aria-hidden="true">${esc(l.icon)}</span><span class="e-ll"><b>${esc(l.label)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span><span class="e-lp">${right}</span></li>`;
  }).join('');
  const talk = hasContact();
  const el = document.createElement('div');
  el.className = 'g-end e-race' + (eligible ? '' : ' miss');
  el.innerHTML = `
    <div class="e-wrap">
      <section class="e-left">
        <div class="e-eyebrow"><span class="e-dot"></span>${eligible ? '着いた。<em>You made it.</em>' : '行っちゃった。<em>It left.</em>'}</div>
        <h1 class="e-line">${headline(tier, coffee)}</h1>
        <div class="e-time"><b aria-label="${num(score)}">${num(score)}</b><small>Your score</small></div>
        ${lines.length ? `<button type="button" class="e-chips" aria-expanded="false" aria-label="Show how the score adds up">${chips.join('')}<u aria-hidden="true">\u25BE</u></button>` : ''}
        ${lines.length ? `<ul class="e-lines${eligible ? '' : ' void'}">${lineHtml}<li class="e-sum"><span class="e-li"></span><span class="e-ll"><b>Total</b></span><span class="e-lp">${num(score)}</span></li></ul>${eligible ? '' : '<p class="e-lcap">not counted: the train left</p>'}` : ''}
        <p class="e-facts">${facts.map(f => `<span>${esc(f)}</span>`).join('')}</p>
        <p class="e-where">${esc(ENDCARD.kicker)}</p>
        <p class="e-note">${esc(ENDCARD.note)}</p>
        <div class="e-btns">
          <button type="button" class="g-btn sel" data-a="replay">Run it again <small>もう一度</small></button>
          <button type="button" class="g-btn" data-a="roam">Keep exploring <small>まだ歩く</small></button>
        </div>
        ${talk ? `<div class="e-talk">${ENDCARD.invite ? `<p class="e-invite">${esc(ENDCARD.invite)}</p>` : ''}<div class="e-links">${contactLinks()}</div></div>` : ''}
      </section>
      <section class="e-right e-board" aria-label="Top scores">
        <div class="e-head"><span>Top scores</span></div>
        <div class="e-post" hidden>
          <label class="e-fld"><span>Your initials</span><input class="e-ini" type="text" maxlength="3" size="3" placeholder="ABC" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="send" inputmode="text" aria-label="Your initials, 3 letters or numbers"></label>
          <button type="button" class="e-mini e-go">Post my score</button>
        </div>
        <p class="e-msg" role="status" aria-live="polite"></p>
        <div class="e-list" aria-live="polite"></div>
        <p class="e-legend">\u{1F364} got the seats &nbsp; \u2615 brought coffee</p>
        <button type="button" class="e-mini e-copy">Copy my score</button>
      </section>
    </div>`;
  (ctx.ui.overlay || document.body).appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('on')));
  const $ = (q) => el.querySelector(q);
  // count the score up from 0 over ~0.9 s (not with reduced motion); always ends on the exact score, even if frames are throttled
  const big = $('.e-time b');
  let reduced = false; try { reduced = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* old browsers */ }
  if (!reduced && score > 0) {
    big.textContent = '0';
    const t0 = performance.now(), D = 900;
    const tick = (now) => { if (closed) return; const k = Math.min(1, (now - t0) / D); big.textContent = num(score * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    setTimeout(() => { big.textContent = num(score); }, D + 400);
  }
  const list = $('.e-list'), msg = $('.e-msg'), post = $('.e-post'), ini = $('.e-ini'), go = $('.e-go'), legend = $('.e-legend');
  let closed = false, board = null, mine = null, posted = false, posting = false, refused = false, nap = !hasScores();
  const id = runId();
  ini.value = initialsOf(lsGet('namba.initials'));

  // v23: before posting, the player's own entry leads the list so it is plain that their score is not on the board yet
  const youRow = `<li class="e-r me you"><b class="e-rk">\u2192</b><span class="e-nm">YOU</span><span class="e-t">${num(score)}</span><span class="e-x e-join">post to join</span></li>`;
  const row = (r, rank, me) => `<li class="e-r${me ? ' me' : ''}"><b class="e-rk">${rank}</b><span class="e-nm">${esc(r.name)}</span><span class="e-t">${num(r.score)}</span><span class="e-x"><em title="got the seats">${r.seats ? '\u{1F364}' : ''}</em><em title="brought coffee">${r.coffee ? '\u2615' : ''}</em></span></li>`;
  const draw = () => {
    if (closed) return;
    legend.hidden = !board || !board.top.length;
    post.hidden = !(eligible && board && !posted) || refused;
    if (nap) { list.innerHTML = `<p class="e-nap">${NAP}</p>`; return; }
    if (!board) { list.innerHTML = '<ol class="e-ol skel" aria-hidden="true">' + '<li class="e-r"><b class="e-rk"></b><span class="e-nm"></span><span class="e-t"></span><span class="e-x"></span></li>'.repeat(10) + '</ol>'; return; }
    if (!board.top.length && !mine) { list.innerHTML = '<p class="e-nap e-empty">No scores yet. Be the first.</p>'; return; }
    const hi = mine && mine.rank <= board.top.length ? mine.rank : 0;
    list.innerHTML = `<ol class="e-ol">${eligible && !posted ? youRow : ''}${board.top.map((r, i) => row(r, i + 1, hi === i + 1)).join('')}${mine && !hi ? `<li class="e-gap" aria-hidden="true"></li>${row(mine, mine.rank, true)}` : ''}</ol>`;
    // v23: scroll only the list (never the card) to the player's row
    if (mine) { const m = list.querySelector('.e-r.me'); try { if (m) list.scrollTop = Math.max(0, m.offsetTop - list.clientHeight / 2); } catch (e) { /* old browsers */ } }
  };
  msg.textContent = eligible ? '' : 'Catch the train to get on the board.';
  draw();
  // the board loads in the background; the buttons never wait for it
  if (!nap) fetchScores().then((r) => {
    if (closed) return;
    if (r && r.ok) board = r; else nap = true;
    draw();
  }).catch(() => { nap = true; draw(); });

  const submit = async () => {
    if (!eligible || posted || posting || closed || refused) return;
    const name = initialsOf(ini.value);
    if (name.length !== 3) { msg.textContent = 'Enter 3 letters or numbers.'; msg.classList.add('err'); try { ini.focus(); } catch (e) { /* ignore */ } return; }
    posting = true; ini.value = name; ini.disabled = true; go.disabled = true; go.classList.add('wait'); go.textContent = 'Posting\u2026'; msg.textContent = '';
    lsSet('namba.initials', name);
    const r = await postScore({ name, score, t1: M.t1, t2: M.t2, coffee, hints, m: metersOn || 0, id });
    posting = false;
    try { ctx.events.emit('score:post', { ok: !!r.ok, score, tier, rank: r.ok ? r.rank : null, total: r.ok ? r.total : null, error: r.ok ? null : r.error }); } catch (e) { /* analytics only */ }
    if (closed) return;
    if (r.ok) {
      posted = true; board = { ok: true, top: r.top, total: r.total }; nap = false;
      mine = { ...(r.you || { name, score, seats, coffee }), rank: Math.max(1, r.rank | 0) };
      msg.textContent = `You're #${mine.rank} of ${r.total}`;
      msg.classList.remove('err'); msg.classList.add('got');
      draw();
    } else {
      // v23: a post the server refuses on its merits (bad-time, bad-score, ...) is final: say so kindly, no retry. Only a network-ish failure offers one more tap.
      const soft = /^(network|timeout|failed|bad_response|http_(5|429)\d*|no_url)/.test(String(r.error || ''));
      msg.classList.add('err');
      if (soft) {
        ini.disabled = false; go.disabled = false; go.classList.remove('wait'); go.textContent = 'Post my score';
        msg.textContent = 'Could not reach the board. Tap Post to try again.';
      } else {
        post.hidden = true; refused = true;
        msg.textContent = 'The board could not check that run, so it is not listed. Your score still counts for bragging.';
      }
    }
  };
  go.addEventListener('click', (ev) => { ev.stopPropagation(); submit(); });

  const copy = $('.e-copy');
  let copyT = 0;
  const flash = () => { copy.textContent = 'Copied \u2713'; clearTimeout(copyT); copyT = setTimeout(() => { copy.textContent = 'Copy my score'; }, 2000); };
  const fallbackCopy = () => {
    try {
      const t = document.createElement('textarea'); t.value = brag; t.setAttribute('readonly', ''); t.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      document.body.appendChild(t); t.select(); const ok = document.execCommand && document.execCommand('copy'); t.remove(); if (ok) flash();
    } catch (e) { /* nothing more to try */ }
  };
  copy.addEventListener('click', (ev) => {
    ev.stopPropagation();
    try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(brag).then(flash, fallbackCopy); else fallbackCopy(); } catch (e) { fallbackCopy(); }
  });

  ini.addEventListener('input', () => { const v = initialsOf(ini.value); if (v !== ini.value) ini.value = v; if (msg.textContent.startsWith('Enter 3')) { msg.textContent = ''; msg.classList.remove('err'); } });
  // a soft keyboard shrinks the viewport: bring the field into view inside the card rather than letting the page jump
  // v23: with the keyboard up the card shrinks to the board's post row (field, Post, message) so the field can never sit under the keyboard.
  // The visual viewport tells us (iOS keeps the layout viewport full height, Android may shrink it: base = the tallest we have seen).
  const vv = window.visualViewport;
  let base = Math.max(innerHeight, vv ? vv.height : 0);
  const kbSync = () => {
    if (closed) return;
    const h = vv ? vv.height : innerHeight;
    base = Math.max(base, innerHeight, h);
    const kb = document.activeElement === ini && h < base - 90;
    el.classList.toggle('e-kb', kb);
    el.style.setProperty('--e-vh', h + 'px');
    if (kb) { try { $('.e-post').scrollIntoView({ block: 'center' }); } catch (e) { /* old browsers */ } }
  };
  if (vv) { vv.addEventListener('resize', kbSync); vv.addEventListener('scroll', kbSync); }
  ini.addEventListener('focus', () => { setTimeout(kbSync, 120); setTimeout(kbSync, 450); });
  ini.addEventListener('blur', () => setTimeout(kbSync, 120));
  // the ledger chips open and close the full breakdown (short screens only; on a roomy screen the list is always there)
  const chipBtn = $('.e-chips');
  if (chipBtn) chipBtn.addEventListener('click', (ev) => { ev.stopPropagation(); const o = el.classList.toggle('e-open'); chipBtn.setAttribute('aria-expanded', o ? 'true' : 'false'); });

  const btns = [...el.querySelectorAll('.g-btn')];
  const act = (v) => {
    removeEventListener('keydown', key, true); removeEventListener('keyup', keyUp, true);
    try { ctx.events.emit('demo:choice', { choice: v === 'replay' ? 'replay' : 'roam' }); } catch (e) { /* analytics only */ }
    if (v === 'replay') return onReplay && onReplay();
    onRoam && onRoam();
  };
  const select = (x, focus) => { btns.forEach(y => y.classList.toggle('sel', y === x)); if (focus) try { x.focus({ preventScroll: true }); } catch (e) { /* old browsers */ } };
  // Keys as the classic card (E / Enter / Space confirm, arrows / A D switch), except while the player is typing in the initials
  // field (every key goes to the field, Enter posts) or is on one of the board's own buttons or a link (native behaviour).
  const key = (e) => {
    const fx = document.activeElement;
    if (fx === ini) {
      e.stopImmediatePropagation();
      if (e.code === 'Enter' && !e.repeat && !e.isComposing) { e.preventDefault(); submit(); }
      return;
    }
    if (e.repeat) return;
    if (fx && el.contains(fx) && (fx.tagName === 'A' || fx.classList.contains('e-mini'))) { e.stopImmediatePropagation(); return; }
    if (e.code === 'KeyE' || e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); e.stopImmediatePropagation(); act(el.querySelector('.g-btn.sel').dataset.a); }
    if (['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD'].includes(e.code)) { e.preventDefault(); e.stopImmediatePropagation(); select(btns.find(x => !x.classList.contains('sel')) || btns[0], true); }
    if (e.code === 'Tab') e.stopImmediatePropagation();
  };
  // keyup too: the game must not see the field's keys release
  const keyUp = (e) => { if (document.activeElement === ini) e.stopImmediatePropagation(); };
  addEventListener('keydown', key, true);
  addEventListener('keyup', keyUp, true);
  btns.forEach(x => {
    x.addEventListener('click', (ev) => { ev.stopPropagation(); act(x.dataset.a); });
    x.addEventListener('focus', () => select(x, false));
  });
  el.querySelectorAll('.e-link').forEach(x => x.addEventListener('click', (ev) => ev.stopPropagation()));
  return {
    el,
    close() { closed = true; clearTimeout(copyT); if (vv) { vv.removeEventListener('resize', kbSync); vv.removeEventListener('scroll', kbSync); } removeEventListener('keydown', key, true); removeEventListener('keyup', keyUp, true); el.classList.remove('on'); setTimeout(() => el.remove(), 900); },
  };
}
