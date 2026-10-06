// =============================================================================
// The end card: the professional climax of the demo. The world stays alive and
// softly blurred behind it. Left: the line and the note. Right: the player's
// own journey, measured live, before vs after the upgrade.
//   showEndCard(ctx, summary, { onRoam, onReplay }) -> { close() }
// summary = { upgraded, before:{seconds,meters,err,wrongFloorS}, after:{...}|null, ... }
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

export function showEndCard(ctx, s, { onRoam, onReplay } = {}) {
  const b = s.before, a = s.after;
  const pg = s.progress || {};
  // Lead with the two measures that do not depend on how much route each phase happened to cover, then net progress
  // toward the door (the drop in nav distance to Daikichi per minute): the comparison is per-minute, so a longer
  // "after" phase cannot make Lodestone look slower. Raw time and distance are only a small neutral line below.
  const rows = [
    { k: 'Position error', cap: ['mean, by the phone', 'mean, by the phone'], b: b.err, a: a && a.err, fmt: (v) => `${err(v)}<small>m</small>` },
    { k: 'Wrong-floor seconds', cap: ['phone put you on the wrong floor', (v) => (v < 1 ? 'right floor, every time' : 'corrected in a heartbeat')], b: b.wrongFloorS, a: a && a.wrongFloorS, fmt: (v) => `${Math.round(v)}<small>s</small>` },
    { k: 'Net progress toward Daikichi', cap: [(v) => (v < 10 ? 'wandering: barely any closer' : 'closer to the door, per minute'), 'closer to the door, per minute'], b: pg.before, a: a && pg.after, fmt: mpm },
  ].filter((r) => {
    if (r.fmt !== mpm) return true;
    // Net progress only says something when the "before" phase was genuinely lost; for a player who happened to walk
    // the right way anyway, the per-minute pace is about equal and the row would be noise. Show it only when it tells
    // the real story (Lodestone clearly faster), never fabricate it.
    return isFinite(r.b) && isFinite(r.a) && r.a >= 1.3 * Math.max(r.b, 5);
  });
  const total = [
    s.totalSeconds != null && isFinite(s.totalSeconds) ? `${mmss(s.totalSeconds)} min` : null,
    s.totalMeters != null && isFinite(s.totalMeters) ? `${metres(s.totalMeters)} m on foot` : null,
  ].filter(Boolean).join(' · ');
  const cell = (r, side) => {
    const v = side === 'b' ? r.b : r.a;
    if (v == null || !isFinite(v)) return `<div class="e-v ${side}"><b class="e-none">—</b></div>`;
    const max = Math.max(r.b > 0 ? r.b : 0, r.a > 0 ? r.a : 0, 1e-6);
    return `<div class="e-v ${side}"><b>${r.fmt(v)}</b><i class="e-bar"><u style="--w:${bar(v, max)}"></u></i><span>${esc(typeof r.cap[side === 'b' ? 0 : 1] === 'function' ? r.cap[side === 'b' ? 0 : 1](v) : r.cap[side === 'b' ? 0 : 1])}</span></div>`;
  };
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
  const key = (e) => {
    if (e.repeat) return;
    if (e.code === 'KeyE' || e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); e.stopImmediatePropagation(); act(el.querySelector('.g-btn.sel').dataset.a); }
    if (['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD', 'Tab'].includes(e.code)) { e.preventDefault(); e.stopImmediatePropagation(); btns.forEach(x => x.classList.toggle('sel')); }
  };
  addEventListener('keydown', key, true);
  btns.forEach(x => x.addEventListener('click', (ev) => { ev.stopPropagation(); act(x.dataset.a); }));
  return {
    el,
    close() { removeEventListener('keydown', key, true); el.classList.remove('on'); setTimeout(() => el.remove(), 900); },
  };
}
