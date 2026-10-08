// =============================================================================
// The glance card — what you see of the phone while it is held low.
//
// The phone's Dynamic-Island pill expands into a black "live activity" card at
// the top of the screen (the only part visible in the glance pose). It shows,
// in priority order:
//   1. a new text (Aya) — slides in, the card pulses, "Q to read"
//   2. the Lodestone install / calibration progress
//   3. Lodestone ready: the ONE next step ("Escalator up to 2F", in 40 m)
//   4. the generic Maps app: the vague crow-flies hint (or its one-floor route),
//      with the GPS-weak excuse
//   v4: no destination yet → "Pick a place in Maps / Lodestone" · "Aya: <her pick>";
//       arrived → "Arrived · <name>" · "Next: <suggestion>" 
// Data comes from LodestoneApp.glanceInfo() / MapApp.glanceInfo(); this file
// only renders (DOM rewrites only when the text changes; the arrow rotates).
// =============================================================================
import { icon, logo } from './lodestone.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const NOTE_S = 7.5;

export class Glance {
  constructor(phone, root) {
    this.phone = phone; this.ctx = phone.ctx; this.root = root;
    this.note = null; this._noteT = 0;
    this._key = ''; this._t = 0;
    this._ang = 0;
    this.touch = !!(this.ctx.input && this.ctx.input.touch);
    root.innerHTML = `<div class="gl"></div>`;
    this.box = root.firstChild;
    // polish: the arrival cut-scene — the strip says so (not "on your right · In 5 m") from its first frame
    this.finale = null;
    this.ctx.events.on('demo:arrive', (e) => {
      const D = phone.dest, n = (e && e.slot && D && D.name && D.name(e.slot)) || 'Tempura Daikichi';
      this.finale = n; this.refresh(true);
    });
    this.ctx.events.on('nav:destination', () => { if (this.finale) { this.finale = null; this.refresh(true); } });   // free roam: a new pick
  }

  showNote(msg) {
    this.note = { title: msg.title || 'Aya', text: msg.text || '', reply: !!msg.reply };
    this._noteT = msg.reply ? NOTE_S + 3 : NOTE_S;
    this.refresh(true);
    // pulse (restart the animation)
    this.root.classList.remove('ping'); void this.root.offsetWidth; this.root.classList.add('ping');
  }
  clearNote(read) { if (!this.note) return; this.note = null; this._noteT = 0; this.root.classList.remove('ping'); this.refresh(true); }

  refresh(force) { if (force) this._key = ''; this._t = 0; }

  update(dt, visible) {
    if (this._noteT > 0) { this._noteT -= dt; if (this._noteT <= 0) this.clearNote(); }
    if (!visible) return;
    this._t -= dt;
    if (this._t > 0) { this._spin(dt); return; }
    this._t = 0.25;
    const info = this._info();
    const M = this.phone.messages;
    info.unread = M && (M.unread > 0 || !!M.pending) && info.kind !== 'note';
    info.rep = !!(M && M.pending);
    info.typing = M && M.typingFrom && info.kind !== 'note' ? M.typingFrom : null;
    const key = JSON.stringify([info.kind, info.cls, info.trk, info.icon, info.mic, info.live, info.title, info.sub, info.pct != null ? Math.round(info.pct * 20) : -1, info.warn, info.unread, info.rep, info.typing, (this.phone._raises || 0) >= 3]);
    if (key !== this._key) { this._key = key; this._render(info); }
    this._angFn = info.angFn || null;
    this._target = info.ang;
    this._spin(dt);
  }

  _info() {
    const ph = this.phone;
    if (this.note) return { kind: 'note', cls: 'gl-note', title: this.note.title, sub: this.note.text };
    if (this.finale) return { kind: 'arr', cls: ph.upgradeStage === 'ready' ? 'gl-ld' : 'gl-mp', icon: 'check', title: 'You’ve arrived', sub: this.finale };
    const st = ph.upgradeStage;
    if (st === 'installing' || st === 'calibrating') {
      const L = ph.lodestone, pct = st === 'installing' ? Math.min(1, L.t / L.T_INSTALL) : Math.min(1, L.t / L.T_CALIB);
      return { kind: 'inst', cls: 'gl-ld', title: st === 'installing' ? 'Installing Lodestone' : 'Learning the building…', sub: st === 'installing' ? 'Lodestone' : 'Magnetic fingerprint', pct };
    }
    if (st === 'ready' && ph.lodestone.state === 'ready') return { cls: 'gl-ld', ...ph.lodestone.glanceInfo() };
    return { cls: 'gl-mp', ...ph.maps.glanceInfo() };
  }

  _render(i) {
    // the key hint teaches itself away: shown until the phone has been raised a few times
    const rep = this.phone.messages && this.phone.messages.pending;
    const k = (i.typing ? `<i class="gl-typing" title="${esc(i.typing)} is typing"><b></b><b></b><b></b></i>` : rep && i.kind !== 'note' ? `<i class="gl-rep" title="${esc(rep.from)} is waiting for your reply">${esc((rep.from || 'A')[0])}<b>↩</b></i>` : i.unread ? '<i class="gl-unread" title="Unread message"></i>' : '') + (this.touch || ((this.phone._raises || 0) >= 3 && i.kind !== 'pick' && !(i.kind === 'arr' && /^Next/.test(i.sub || ''))) ? '' : `<kbd class="gl-k">Q</kbd>`);
    let ic = '';
    if (i.kind === 'note') ic = `<i class="gl-av">${esc((i.title || 'A')[0])}</i>`;
    else if (i.kind === 'inst') ic = `<i class="gl-ic gl-logo">${logo()}</i>`;
    else if (i.cls === 'gl-ld') ic = `<i class="gl-ic ${i.trk || ''}">${i.live ? icon('straight', 'gl-arrow') : icon(i.icon || 'straight')}</i>`;
    else if (i.icon === 'pin' || i.icon === 'check') ic = `<i class="gl-ic gl-pin">${icon(i.icon)}</i>`;
    else ic = `<i class="gl-ic">${i.warn ? `<b class="gl-wb" title="${esc(i.warn)}">!</b>` : ''}${i.icon === 'lost' ? '<svg viewBox="0 0 24 24" class="ld-ic" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"><path d="M9.2 9a3 3 0 1 1 4.3 2.7c-.9.5-1.5 1.1-1.5 2.1M12 17.6v.1"/></svg>' : '<svg viewBox="0 0 24 24" class="gl-arrow" fill="currentColor"><path d="M12 2.5 19 20l-7-3.6L5 20Z"/></svg>'}</i>`;
    const bar = i.pct != null ? `<u class="gl-bar"><i style="width:${(i.pct * 100).toFixed(0)}%"></i></u>` : '';
    const sub = i.kind === 'note' ? `<p>${esc(i.sub)}</p>` : `<span>${esc(i.sub || '')}</span>`;
    // v5: the next milestone's small icon sits in front of its words (the big tile keeps the heading arrow)
    const head = i.kind === 'note' ? `<b>${esc(i.title)} <small>now</small></b>` : `<b>${i.mic ? `<i class="gl-mi">${icon(i.mic)}</i>` : ''}${esc(i.title)}</b>`;
    this.box.className = `gl ${i.cls} gl-${i.kind || 'nav'} ${i.trk || ''}`;
    // (the island itself carries the on-track state: amber ring while drifting / off)
    this.root.classList.toggle('trk-drift', i.trk === 'trk-drift');
    this.root.classList.toggle('trk-off', i.trk === 'trk-off');
    this.box.innerHTML = `${ic}<div class="gl-t">${head}${sub}${bar}</div>${i.kind === 'note' ? `<span class="gl-read">${this.touch ? 'tap' : '<kbd>Q</kbd>'} ${this.note && this.note.reply ? 'reply' : 'read'}</span>` : k}`;
    this._arrow = this.box.querySelector('.gl-arrow');
  }

  // the arrow turns smoothly toward the target angle (degrees, 0 = straight ahead)
  _spin(dt) {
    if (this._angFn) { const v = this._angFn(); if (v != null) this._target = v; }       // live: follows the heading every frame
    const a = this._arrow; if (!a || this._target == null || !isFinite(this._target)) return;
    let d = this._target - this._ang; d = ((d + 540) % 360) - 180;
    this._ang += d * (1 - Math.exp(-dt / 0.12));
    a.style.transform = `rotate(${this._ang.toFixed(1)}deg)`;
  }
}
