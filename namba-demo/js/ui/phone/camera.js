// =============================================================================
// v23: the phone's camera mode. Tapping the camera button in Messages (or a 📸 reply pill) drops the phone out of the way
// and shows the world through a viewfinder (3:2 frame, corner brackets, thin 3 x 3 grid, a round shutter on the right,
// a close button). The player can still look and walk. The shutter flashes, clicks, closes the mode, raises the phone on
// Messages and sends the framed picture (crop of the game canvas: the phone is DOM, so it is never in the shot).
// Keys (desktop): P opens / closes (C is the slow-walk key), left click / E / Space / Enter shoot, Esc closes.
// =============================================================================
const KEY_OPEN = 'KeyP';
const FRAME_ASPECT = 1.5;           // the photo is 3:2, like a phone's
const HINT_TIMES = 2;               // "Point at a sign or a shop" shows the first two times
const SHOOT_GUARD = 0.3;            // s after opening before a shutter counts (the click that opened it must not shoot)

export class CameraMode {
  constructor(phone) {
    this.phone = phone; this.ctx = phone.ctx;
    this.active = false; this.reply = null; this._at = 0; this._opened = 0;
    const touch = !!(this.ctx.input && this.ctx.input.touch);
    const el = document.createElement('div');
    el.className = 'ph-cam'; el.hidden = true;
    el.innerHTML = `<div class="cam-frame"><i class="cam-c a"></i><i class="cam-c b"></i><i class="cam-c c"></i><i class="cam-c d"></i><div class="cam-grid"></div>
        <div class="cam-hint" hidden>Point at a sign or a shop</div></div>
      <button type="button" class="cam-x" aria-label="Close camera"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>${touch ? '' : '<kbd>Esc</kbd>'}</button>
      <button type="button" class="cam-shutter" aria-label="Take photo"><i></i>${touch ? '' : '<kbd>Space</kbd>'}</button>`;
    phone.root.appendChild(el);
    this.el = el; this.frame = el.querySelector('.cam-frame'); this.hint = el.querySelector('.cam-hint');
    // the buttons act on click (never on pointerdown): the click ends here, so nothing underneath can receive it when
    // the phone comes back up under the same finger
    el.querySelector('.cam-shutter').addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); this.shoot(); });
    el.querySelector('.cam-x').addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); this.close(true); });
    for (const ev of ['pointerdown', 'touchstart', 'mousedown']) el.querySelectorAll('button').forEach(b => b.addEventListener(ev, e => e.stopPropagation(), { passive: true }));
    addEventListener('keydown', (e) => this._key(e), true);
    // a left click on the world shoots (desktop: the pointer is locked, any click is the shutter)
    addEventListener('mousedown', (e) => {
      if (!this.active || e.button !== 0 || (e.target && e.target.closest && e.target.closest('.ph-cam button'))) return;
      if (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents) return;
      e.preventDefault(); this.shoot();
    }, true);
    addEventListener('resize', () => { if (this.active) this._layout(); });
  }

  _key(e) {
    if (e.repeat || !this.ctx.started) return;
    const t = e.target; if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    const ph = this.phone;
    if (this.active) {
      const c = e.code;
      if (c === 'Space' || c === 'Enter' || c === 'NumpadEnter' || c === 'KeyE') { e.preventDefault(); e.stopImmediatePropagation(); this.shoot(); return; }
      if (c === KEY_OPEN || c === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); this.close(true); return; }
      return;
    }
    // P opens the camera from anywhere the phone could be used, when Aya is ready for a picture
    if (e.code === KEY_OPEN && !(e.ctrlKey || e.metaKey || e.altKey) && ph._canUse() && ph.messages && ph.messages.camState().s === 'ready') {
      e.preventDefault(); this.open();
    }
  }

  // the 3:2 frame, centred, leaving room on the right for the shutter
  _layout() {
    const W = innerWidth, H = innerHeight, m = Math.round(Math.max(12, H * 0.065)), room = 112;
    let w = Math.min(Math.round((H - 2 * m) * FRAME_ASPECT), W - 2 * room), h = Math.round(w / FRAME_ASPECT);
    if (w < 160) { w = Math.min(W - 24, 220); h = Math.round(w / FRAME_ASPECT); }
    const f = this.frame.style;
    f.width = w + 'px'; f.height = h + 'px'; f.left = Math.round((W - w) / 2) + 'px'; f.top = Math.round((H - h) / 2) + 'px';
    this._f = { x: (W - w) / 2 / W, y: (H - h) / 2 / H, w: w / W, h: h / H };
  }
  // the framed area as fractions of the viewport (messages._capture crops the canvas to it)
  get frameFrac() { return this._f; }

  open(opts) {
    const ph = this.phone;
    if (this.active || !ph._canUse()) return false;
    this.reply = opts && opts.reply != null ? opts.reply : null;
    this.active = true; this._at = ph._now; this._opened = performance.now();
    this._layout();
    this.el.hidden = false;
    ph.root.classList.add('ph-cam-on');
    const n = this._hints = (this._hints || 0) + 1;
    this.hint.hidden = n > HINT_TIMES;
    clearTimeout(this._hT); if (!this.hint.hidden) this._hT = setTimeout(() => { this.hint.hidden = true; }, 5200);
    if (ph.isOpen) ph.close(); else ph._setPose('down');
    const a = document.activeElement; if (a && a.blur && ph.root.contains(a)) a.blur();
    this.ctx.audio && this.ctx.audio.play && this.ctx.audio.play('ui_open');
    this.ctx.events.emit('phone:camera', { on: true, reply: this.reply != null });
    return true;
  }
  // toPhone: bring the phone back up on Messages (close button / key); false when the game paused under it
  close(toPhone) {
    if (!this.active) return;
    this._end();
    this.ctx.events.emit('phone:camera', { on: false });
    if (toPhone && this.phone._canUse()) this.phone.open('messages'); else this.phone._setPose(this.phone._wantDown() ? 'down' : 'glance');
  }
  _end() {
    this.active = false; this.reply = null; clearTimeout(this._hT);
    this.el.hidden = true; this.phone.root.classList.remove('ph-cam-on');
  }

  shoot() {
    if (!this.active || performance.now() - this._opened < SHOOT_GUARD * 1000) return;
    const ph = this.phone, M = ph.messages, S = this.ctx.game && this.ctx.game.story;
    const viaChip = this.reply != null && !!M.pending;
    if (!viaChip && !(S && typeof S.snapState === 'function' && S.snapState() === 'ready' && !M.pending)) {
      this._tell('Aya is busy, try again in a moment'); return;
    }
    const idx = this.reply;
    const img = M._capture(this._f);
    M._shutter();
    this._end();
    // send now: the story judges the camera pose at this very moment. The bubble's own animation waits for the phone to rise.
    let sent = false;
    M._late = true;
    if (viaChip) sent = M.reply(idx, { img });
    if (!sent) sent = !!(S && S.sendPhoto && S.sendPhoto(img));
    M._late = false;
    this.ctx.events.emit('phone:camera', { on: false, shot: true });
    ph.open('messages');
  }
  // a toast on the world (the phone is down)
  _tell(t) {
    let n = this._toast;
    if (!n) { n = this._toast = document.createElement('div'); n.className = 'cam-toast'; this.el.appendChild(n); }
    n.textContent = t; n.classList.remove('on'); void n.offsetWidth; n.classList.add('on');
  }
}
