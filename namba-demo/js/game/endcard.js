// =============================================================================
// The end card: the professional climax of the demo. The world stays alive and
// softly blurred behind it. Left: the line and the note. Right: the player's
// own journey, measured live, before vs after the upgrade.
//   showEndCard(ctx, summary, { onRoam, onReplay }) -> { close() }
// summary = { upgraded, before:{seconds,meters,err,p90,wrongFloorS,wrongPct,detour,gained,turnsPerKm}, after:{...}|null, ... }
// v6: fair per-unit rows (item 9) and two ways to reach Zack (item 8: his AI career agent, a booking link).
// Brand rule: never Oriient's logo or colours. The only colours are ours
// (warm amber = guesswork, cool blue = Lodestone's own).
// =============================================================================
import { ENDCARD } from './script.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const mmss = (s) => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const metres = (m) => `${Math.round(m).toLocaleString('en-US')}`;
const err = (m) => (m == null ? '—' : m >= 9.5 ? `±${Math.round(m)}` : `±${(Math.max(0.5, Math.round(m * 2) / 2)).toString().replace(/\.0$/, '')}`);
const bar = (v, max) => `${Math.max(3, Math.min(100, (v / Math.max(1e-6, max)) * 100)).toFixed(1)}%`;

// m/min with a true minus sign: "before" can honestly be zero or negative
const mpm = (v) => { const r = Math.round(v); return `${r < 0 ? '\u2212' : ''}${Math.abs(r)}<small>m/min</small>`; };

const pct = (v) => `${v > 0 && v < 1 ? '<1' : Math.round(v)}<small>%</small>`;
const times = (v) => `${v.toFixed(v < 10 ? 1 : 0)}<small>×</small>`;
const perKm = (v) => `${v < 0.05 ? '0' : v.toFixed(v < 10 ? 1 : 0)}<small>/km</small>`;
const ICON = {
  chat: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 4.5h12a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5H9l-3.6 2.6V14.5H4A1.5 1.5 0 0 1 2.5 13V6A1.5 1.5 0 0 1 4 4.5z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M6.5 8.5h7M6.5 11h4.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  cal: '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="4.5" width="14" height="12.5" rx="2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M3 8.5h14M7 2.8v3.4M13 2.8v3.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="10" cy="12.6" r="1.3" fill="currentColor"/></svg>',
};
const link = (L, icon) => (L && L.url ? `<a class="e-link" href="${esc(L.url)}" target="_blank" rel="noopener noreferrer">${ICON[icon]}<span>${esc(L.label)}</span><i aria-hidden="true">↗</i><em class="e-sr"> (opens in a new tab)</em></a>` : '');

export function showEndCard(ctx, s, { onRoam, onReplay } = {}) {
  const b = s.before, a = s.after;
  const pg = s.progress || {};
  const ok = (v) => v != null && isFinite(v);
  // Rows: fair per-unit comparisons only (a mean, a share of the time, a ratio, a rate), never raw totals that depend on
  // how much of the route each phase happened to cover. A row shows only when it has real numbers for its phases.
  //   1. Position error: the mean, with the p90 (what you get on a bad 10% of the walk) in the caption
  //   2. Wrong floor: share of the phase's time the phone had you on another floor
  //   3. Detour: metres walked per metre the walking distance to Daikichi actually dropped; or, when one phase gained
  //      too little to rate (< 20 m), net progress per minute (shown only when it tells the real story, see below)
  //   4. Wrong turns per km, when the phone measures them
  const p90 = (v) => (ok(v) ? `mean · 90% within ${err(v)} m` : null);
  const rows = [
    { k: 'Position error', cap: [(v, x) => p90(x.p90) || 'mean, by the phone', (v, x) => p90(x.p90) || 'mean, by the phone'], b: b.err, a: a && a.err, fmt: (v) => `${err(v)}<small>m</small>` },
    ok(b.wrongPct)
      ? { k: 'On the wrong floor', cap: ['of the time, by the phone', (v) => (v < 0.5 ? 'right floor, every time' : 'of the time')], b: b.wrongPct, a: a && a.wrongPct, fmt: pct }
      : { k: 'Wrong-floor seconds', cap: ['phone put you on the wrong floor', (v) => (v < 1 ? 'right floor, every time' : 'corrected in a heartbeat')], b: b.wrongFloorS, a: a && a.wrongFloorS, fmt: (v) => `${Math.round(v)}<small>s</small>` },
  ];
  if (ok(b.detour) && (!a || ok(a.detour))) {
    rows.push({ k: 'Walked per metre of progress', cap: ['on foot, per metre closer', (v) => (v < 1.25 ? 'close to the shortest way' : 'on foot, per metre closer')], b: b.detour, a: a && a.detour, fmt: times, lowGood: true });
  } else {
    // Net progress only says something when the "before" phase was genuinely lost; for a player who happened to walk
    // the right way anyway, the per-minute pace is about equal and the row would be noise. Show it only when it tells
    // the real story (Lodestone clearly faster), never fabricate it.
    const r = { k: 'Net progress toward Daikichi', cap: [(v) => (v < 10 ? 'wandering: barely any closer' : 'closer to the door, per minute'), 'closer to the door, per minute'], b: pg.before, a: a && pg.after, fmt: mpm };
    if (ok(r.b) && ok(r.a) && r.a >= 1.3 * Math.max(r.b, 5)) rows.push(r);
  }
  if (ok(b.turnsPerKm) && a && ok(a.turnsPerKm)) rows.push({ k: 'Wrong turns', cap: ['per km walked', (v) => (v < 0.05 ? 'none' : 'per km walked')], b: b.turnsPerKm, a: a.turnsPerKm, fmt: perKm });
  const total = [
    s.totalSeconds != null && isFinite(s.totalSeconds) ? `${mmss(s.totalSeconds)} min` : null,
    s.totalMeters != null && isFinite(s.totalMeters) ? `${metres(s.totalMeters)} m on foot` : null,
    s.errand && s.errand.delivered ? `1 ${s.errand.item || 'coffee'} delivered` : null,      // v4: the coffee stop
  ].filter(Boolean).join(' · ');
  const capOf = (r, side, v) => { const c = r.cap[side === 'b' ? 0 : 1]; return typeof c === 'function' ? c(v, side === 'b' ? b : a) : c; };
  const cell = (r, side) => {
    const v = side === 'b' ? r.b : r.a;
    if (v == null || !isFinite(v)) return `<div class="e-v ${side}"><b class="e-none">—</b></div>`;
    const max = Math.max(r.b > 0 ? r.b : 0, r.a > 0 ? r.a : 0, 1e-6);
    return `<div class="e-v ${side}"><b>${r.fmt(v)}</b><i class="e-bar"><u style="--w:${bar(v, max)}"></u></i><span>${esc(capOf(r, side, v))}</span></div>`;
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
        ${talk ? `<div class="e-talk">${ENDCARD.invite ? `<p class="e-invite">${esc(ENDCARD.invite)}</p>` : ''}<div class="e-links">${link(ENDCARD.agent, 'chat')}${link(ENDCARD.call, 'cal')}</div></div>` : ''}
        <div class="e-btns">
          <button type="button" class="g-btn sel" data-a="roam">Keep exploring <small>まだ歩く</small></button>
          <button type="button" class="g-btn" data-a="replay">Replay <small>もう一度</small></button>
        </div>
      </section>
      <section class="e-right" aria-label="Your journey, before and after">
        <div class="e-head"><span>Your journey, measured live</span></div>
        <div class="e-cols">
          <div class="e-col-h b"><i></i><b>Before</b><small>an ordinary maps app</small></div>
          <div class="e-col-h a"><i></i><b>After</b><small>Lodestone</small></div>
        </div>
        ${rows.map(r => `<div class="e-row"><div class="e-k">${esc(r.k)}</div>${cell(r, 'b')}${a ? cell(r, 'a') : `<div class="e-v a"><b class="e-none">—</b></div>`}</div>`).join('')}
        ${total ? `<p class="e-total">Whole trip: ${esc(total)}</p>` : ''}
        ${a ? '' : '<p class="e-foot">Lodestone was waiting in your messages the whole time.</p>'}
      </section>
    </div>`;
  (ctx.ui.overlay || document.body).appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('on')));
  const btns = [...el.querySelectorAll('.g-btn')];
  const act = (v) => {
    removeEventListener('keydown', key, true);
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
