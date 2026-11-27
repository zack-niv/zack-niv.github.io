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

// v23: a safe-area inset (CSS env(), px) read from a probe: the notch side of a landscape iPhone is 47..59 px. The shutter sits at
// right: 26 px + the right inset and the close button at left: 14 px + the left inset (phone.css), so the frame keeps clear of both.
const _ins = {};
function inset(side) {
  if (_ins[side] != null) return _ins[side];
  let v = 0;
  try {
    const d = document.createElement('div'); d.style.cssText = `position:fixed;${side}:0;top:0;${side === 'left' || side === 'right' ? 'width' : 'height'}:env(safe-area-inset-${side},0px);${side === 'left' || side === 'right' ? 'height:0' : 'width:0'};visibility:hidden;pointer-events:none`;
    document.body.appendChild(d); const r = d.getBoundingClientRect(); v = (side === 'left' || side === 'right' ? r.width : r.height) || 0; d.remove();
  } catch (e) { v = 0; }
  return (_ins[side] = v);
}
addEventListener('resize', () => { for (const k in _ins) delete _ins[k]; });

export class CameraMode {
  constructor(phone) {
    this.phone = phone; this.ctx = phone.ctx;
    this.active = false; this.reply = null; this._at = 0; this._opened = 0;
    const touch = !!(this.ctx.input && this.ctx.input.touch);
    const el = document.createElement('div');
    el.className = 'ph-cam'; el.hidden = true;
    el.innerHTML = `<i class="cam-dim t"></i><i class="cam-dim b"></i><i class="cam-dim l"></i><i class="cam-dim r"></i><div class="cam-frame"><i class="cam-c a"></i><i class="cam-c b"></i><i class="cam-c c"></i><i class="cam-c d"></i><div class="cam-grid"></div>
        <div class="cam-hint" hidden>Point at a sign or a shop</div></div>
      <button type="button" class="cam-x" aria-label="Close camera"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>${touch ? '' : '<kbd>Esc</kbd>'}</button>
      <button type="button" class="cam-shutter" aria-label="Take photo"><i></i>${touch ? '' : '<kbd>Space</kbd>'}</button>`;
    phone.root.appendChild(el);
    this.dim = { t: el.querySelector('.cam-dim.t'), b: el.querySelector('.cam-dim.b'), l: el.querySelector('.cam-dim.l'), r: el.querySelector('.cam-dim.r') };
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

  // the 3:2 frame in the free middle: room on the left for the close button (44 px at 14 px + the left inset) and on the right for the
  // shutter (72 px at 26 px + the right inset) and, on a touch screen, for the run / phone buttons stacked under it (v23 integration: at
  // 667 x 375 the frame's corner sat under them). Desktop keeps 112 px each side (the keycaps make the buttons wider).
  _layout() {
    const W = innerWidth, H = innerHeight, m = Math.round(Math.max(12, H * 0.065));
    let rl = 112, rr = 112;
    if (this.ctx.input && this.ctx.input.touch) {
      rl = 66 + inset('left'); rr = 106 + inset('right');
      for (const e of document.querySelectorAll('#touch-ui .tu-run, #touch-ui .tu-phone, #touch-ui .tu-use')) {
        const r = e.getBoundingClientRect(); if (r.width > 4 && r.left > W * 0.5 && r.right > 0) rr = Math.max(rr, Math.round(W - r.left + 10));
      }
    }
    const area = W - rl - rr;
    // the mission clock (top centre) is HUD, not part of the picture: the frame starts under it
    let top = m; const hm = document.querySelector('.h-mission');
    if (hm) { const r = hm.getBoundingClientRect(); if (r.height > 4 && r.bottom < H * 0.4) top = Math.max(m, Math.round(r.bottom + 6)); }
    const availH = H - top - m;
    let w = Math.min(Math.round(availH * FRAME_ASPECT), area), h = Math.round(w / FRAME_ASPECT);
    if (w < 160) { w = Math.min(W - 24, 220); h = Math.round(w / FRAME_ASPECT); rl = Math.round((W - w) / 2); rr = rl; }
    const x0 = Math.round(rl + (W - rl - rr - w) / 2), y0 = Math.round(top + (availH - h) / 2);
    const f = this.frame.style;
    f.width = w + 'px'; f.height = h + 'px'; f.left = x0 + 'px'; f.top = y0 + 'px';
    // four dim panels round the frame (a huge box-shadow would need a layer many times the screen: memory)
    const L = x0, T = y0, d = this.dim;
    Object.assign(d.t.style, { left: 0, top: 0, width: W + 'px', height: T + 'px' }); Object.assign(d.b.style, { left: 0, top: (T + h) + 'px', width: W + 'px', height: Math.max(0, H - T - h) + 'px' });
    Object.assign(d.l.style, { left: 0, top: T + 'px', width: L + 'px', height: h + 'px' }); Object.assign(d.r.style, { left: (L + w) + 'px', top: T + 'px', width: Math.max(0, W - L - w) + 'px', height: h + 'px' });
    this._f = { x: x0 / W, y: y0 / H, w: w / W, h: h / H };
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
    // the touch buttons move to the right edge once the phone is down: lay the frame out again when they have settled
    clearTimeout(this._lT); clearTimeout(this._lT2);
    this._lT = setTimeout(() => { if (this.active) this._layout(); }, 120); this._lT2 = setTimeout(() => { if (this.active) this._layout(); }, 520);
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
    this.active = false; this.reply = null; clearTimeout(this._hT); clearTimeout(this._lT); clearTimeout(this._lT2);
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
