// =============================================================================
// The end card: the professional climax of the demo. The world stays alive and
// softly blurred behind it. Left: the line and the note. Right: the player's
// own journey, measured live, before vs after the upgrade.
//   showEndCard(ctx, summary, { onRoam, onReplay }) -> { close() }
// summary = { upgraded, before:{err,p90,wrongPct,dotWithin5,headingSettle,...}, after:{...}|null, ... }
// v7.2: a fixed set of four rows, each defined identically in both phases; primary buttons above two contact cards.
// v7.3: 'On track' (with time off route) replaces 'arrow catches up' as the headline row.
// Brand rule: never Oriient's logo or colours. The only colours are ours
// (warm amber = guesswork, cool blue = Lodestone's own).
// =============================================================================
import { ENDCARD } from './script.js?v=454ed73';

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
  cal: '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="4.5" width="14" height="12.5" rx="2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M3 8.5h14M7 2.8v3.4M13 2.8v3.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="10" cy="12.6" r="1.3" fill="currentColor"/></svg>',
};
// v7.2: two equal contact cards (icon in a tinted circle, title, one-line subtitle, ↗). Cool blue = the agent, warm amber = the call.
const SUB = { chat: 'Ask anything about my experience', cal: 'Pick a time that works for you' };
const link = (L, icon, tone) => (L && L.url
  ? `<a class="e-link ${tone}" href="${esc(L.url)}" target="_blank" rel="noopener noreferrer"><span class="e-ic">${ICON[icon]}</span><span class="e-tx"><b>${esc(L.label)}</b><small>${esc(L.sub || SUB[icon])}</small></span><i aria-hidden="true">↗</i><em class="e-sr"> (opens in a new tab)</em></a>`
  : '');

// v7.3: the same two contact cards in the pause menu (players who leave mid-way never see the end card)
export const contactLinks = () => `${link(ENDCARD.agent, 'chat', 'agent')}${link(ENDCARD.call, 'cal', 'call')}`;

export function showEndCard(ctx, s, { onRoam, onReplay } = {}) {
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
  const talk = ENDCARD.agent || ENDCARD.call;
  const el = document.createElement('div');
  el.className = 'g-end';
  el.innerHTML = `
    <div class="e-wrap">
      <section class="e-left">
        <div class="e-eyebrow"><span class="e-dot"></span>着いた。<em>You made it.</em></div>
        <h1 class="e-line">Indoor spaces shouldn't run on <span>guesswork.</span></h1>
        <p class="e-where">${esc(ENDCARD.kicker)}</p>
        <p class="e-note">Built for the Oriient team by <b>Zack Niv</b> — a love letter to Namba and to indoor positioning.</p>
        ${ENDCARD.contact ? `<p class="e-contact">${esc(ENDCARD.contact)}</p>` : ''}
        <div class="e-btns">
          <button type="button" class="g-btn sel" data-a="roam">Keep exploring <small>まだ歩く</small></button>
          <button type="button" class="g-btn" data-a="replay">Replay <small>もう一度</small></button>
        </div>
        ${talk ? `<div class="e-talk">${ENDCARD.invite ? `<p class="e-invite">${esc(ENDCARD.invite)}</p>` : ''}<div class="e-links">${link(ENDCARD.agent, 'chat', 'agent')}${link(ENDCARD.call, 'cal', 'call')}</div></div>` : ''}
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
