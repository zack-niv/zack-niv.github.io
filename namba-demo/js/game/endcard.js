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

export function showEndCard(ctx, s, { onRoam, onReplay } = {}) {
  const b = s.before, a = s.after;
  const rows = [
    { k: 'Time', cap: ['lost, searching', 'to get there'], b: b.seconds, a: a && a.seconds, fmt: (v) => `${mmss(v)}<small>min</small>` },
    { k: 'Walked', cap: ['before it clicked', 'straight to the door'], b: b.meters, a: a && a.meters, fmt: (v) => `${metres(v)}<small>m</small>` },
    { k: 'Position error', cap: ['mean, by the phone', 'mean, by the phone'], b: b.err, a: a && a.err, fmt: (v) => `${err(v)}<small>m</small>` },
    { k: 'Wrong floor', cap: ['phone thought you were elsewhere', 'never'], b: b.wrongFloorS, a: a && a.wrongFloorS, fmt: (v) => `${Math.round(v)}<small>s</small>` },
  ];
  const cell = (r, side) => {
    const v = side === 'b' ? r.b : r.a;
    if (v == null || !isFinite(v)) return `<div class="e-v ${side}"><b class="e-none">—</b></div>`;
    const max = Math.max(r.b || 0, r.a || 0, 1e-6);
    return `<div class="e-v ${side}"><b>${r.fmt(v)}</b><i class="e-bar"><u style="--w:${bar(v, max)}"></u></i><span>${esc(side === 'b' ? r.cap[0] : r.cap[1])}</span></div>`;
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
        <p class="e-contact">${esc(ENDCARD.contact)}</p>
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
        ${a ? '' : '<p class="e-foot">You never needed it. Lucky you. Next time, install it before you get lost.</p>'}
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
