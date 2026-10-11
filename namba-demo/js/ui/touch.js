// =============================================================================
// Touch play (v11, item 6): phones and tablets, landscape, mobile-FPS controls.
//
//   bootTouch()   called by main.js before anything loads: the html.is-touch class on coarse-pointer devices,
//                 and the rotate-to-landscape card (index.html #rotate, css/touch.css) with its "play in portrait
//                 anyway" escape (in-app browsers such as LinkedIn's can be portrait-locked).
//   TouchUI       live system `touch` (ctx.touch). Active once ctx.input.touch is true (coarse pointer, or the
//                 first touch on the canvas). It owns:
//     · the resting "ghost" stick on the left (where the thumb goes; the live stick is js/core/input.js)
//     · Use: a contextual button that mirrors the HUD's E prompt (shown only when an interaction is available,
//       labelled with the same text, e.g. "Tap your ICOCA"); tap = input.tap('interact') = E
//     · Phone: raise / lower (the lowered phone's glance card is tappable too)
//     · Run: a sprint toggle (also: push the stick past its ring)
//     · Pause: the menu (there is no Esc on a phone)
//     · fullscreen + landscape lock on Begin and on Resume where the browser allows it (Android Chrome, iPad);
//       iPhone Safari has no element fullscreen: the page is sized to the visible viewport instead
//     · auto-pause while the device is held in portrait (and resume on turning back, if we paused)
//     · touch wording for the tutorial (js/ui/touchcopy.js) and a few desktop-only lines hidden by css/touch.css
// Layout: the right-hand cluster sits above the lowered phone, and steps left of the raised phone, so a raised phone
// never covers a control and the controls never cover the phone.
// =============================================================================
import { applyTouchCopy, TOUCH_TEXT } from './touchcopy.js';

const PORTRAIT_OK = 'namba.portraitOK';
const coarse = () => { try { return matchMedia('(pointer: coarse)').matches; } catch (e) { return false; } };
const portrait = () => innerHeight > innerWidth * 1.05;

export function bootTouch() {
  const html = document.documentElement;
  if (coarse()) html.classList.add('is-touch');
  try { if (sessionStorage.getItem(PORTRAIT_OK) === '1') html.classList.add('portrait-ok'); } catch (e) { /* private mode */ }
  const card = document.getElementById('rotate');
  if (card) {
    const go = card.querySelector('.rt-anyway');
    if (go) go.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      html.classList.add('portrait-ok');
      try { sessionStorage.setItem(PORTRAIT_OK, '1'); } catch (err) { /* private mode */ }
      dispatchEvent(new Event('resize'));
    });
  }
  // iOS: keep the layout at the visible viewport height (the toolbar comes and goes)
  const vh = () => html.style.setProperty('--vh', `${innerHeight}px`);
  vh(); addEventListener('resize', vh); addEventListener('orientationchange', () => setTimeout(vh, 250));
}

// fullscreen + landscape lock (needs a user gesture; silently does nothing where unsupported)
export function goFullscreen() {
  const d = document, el = d.documentElement;
  if (d.fullscreenElement || d.webkitFullscreenElement) { lockLandscape(); return; }
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!req) return;                                            // iPhone Safari / in-app browsers
  try {
    const p = req.call(el, { navigationUI: 'hide' });
    if (p && p.then) p.then(lockLandscape, () => {});
  } catch (e) { /* refused */ }
}
function lockLandscape() {
  try { const o = screen.orientation; if (o && o.lock) o.lock('landscape').catch(() => {}); } catch (e) { /* unsupported */ }
}

const ICON = {
  phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="2.5" width="10" height="19" rx="2.6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10.5 5.2h3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9.5 12 15.5 18 9.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  run: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="14.5" cy="4.6" r="2.1" fill="currentColor"/><path d="M9 21l2.6-5.4 3 2.4.4 3M7.2 11.6l2.6-3.1 4 .4 2 3.3 2.7 1M11.6 15.6l1.7-6.6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 6v12M15.5 6v12" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
  hand: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 12.5V5.8a1.5 1.5 0 0 1 3 0v5.4M11.5 11V4.6a1.5 1.5 0 0 1 3 0V11M14.5 11V6a1.5 1.5 0 0 1 3 0v7.4c0 4-2.6 7.1-6.3 7.1-2.4 0-3.8-1-5.1-2.9l-2.3-3.4a1.5 1.5 0 0 1 2.4-1.8l1.3 1.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

export class TouchUI {
  constructor(ctx) {
    this.ctx = ctx;
    this.active = false;
    this.state = {};
  }
  init() {
    const inp = this.ctx.input;
    if (!inp || typeof inp.onTouchMode !== 'function') return;
    inp.onTouchMode(() => this._activate());
  }

  _activate() {
    if (this.active) return;
    this.active = true;
    const { ctx } = this;
    document.documentElement.classList.add('is-touch');
    applyTouchCopy();
    this._build();
    // Begin (title) and Resume are the user gestures fullscreen needs; a capturing listener runs before the game's
    // own click handler, inside the same gesture
    document.addEventListener('click', (e) => {
      const t = e.target;
      if (!t || !t.closest) return;
      if (t.closest('#title') || t.closest('.p-nav [data-a="resume"]') || (t.closest('.g-pause') && (t === t.closest('.g-pause') || t.classList.contains('p-body')))) goFullscreen();
    }, true);
    // the title: "Tap to begin" (Share owns title.js copy; this is a no-op once it says so itself)
    this._patchTitle();
    const mo = new MutationObserver(() => this._patchTitle());
    const tEl = ctx.ui && ctx.ui.title; if (tEl) mo.observe(tEl, { childList: true });
    // the touch-only gate card ("best on a computer") is gone in v11; if an old one is up, let it through
    const gate = document.querySelector('.nbl-touch:not([hidden]) .nbl-go'); if (gate) gate.click();
    // switching apps / locking the screen pauses (desktop pauses on a lost pointer lock instead)
    document.addEventListener('visibilitychange', () => {
      const g = ctx.game;
      if (document.hidden && g && g.started && !g.paused && !g._endCard && !g.ended) g.pause();
    });
    // the pause menu's Esc / mouse explainer, in touch words
    const esc = document.querySelector('.g-pause .p-esc'); if (esc) esc.innerHTML = TOUCH_TEXT.pause;
    // the phone re-lays itself out for touch (js/ui/phone.js reads input.touch)
    try { ctx.phone && ctx.phone._layout && ctx.phone._layout(); } catch (e) { /* cosmetic */ }
  }

  _patchTitle() {
    const b = document.querySelector('#title .t-begin');
    if (!b) return;
    const sp = b.querySelector('span:not(.t-begin-line)'), sm = b.querySelector('small');
    if (sp && /click/i.test(sp.textContent)) sp.textContent = TOUCH_TEXT.begin;
    if (sm && /クリック/.test(sm.textContent)) sm.textContent = TOUCH_TEXT.beginJa;
    const h = document.querySelector('#title .t-hint');
    if (h && /keyboard/i.test(h.textContent)) h.innerHTML = TOUCH_TEXT.titleHint;
  }

  _build() {
    const root = document.createElement('div');
    root.id = 'touch-ui';
    root.innerHTML = `
      <div class="tu-ghost" aria-hidden="true"><i></i><span>${TOUCH_TEXT.ghost}</span></div>
      <button type="button" class="tu-btn tu-pause" aria-label="Pause">${ICON.pause}</button>
      <div class="tu-cluster">
        <button type="button" class="tu-use" aria-label="Use"><span class="tu-use-ic">${ICON.hand}</span><span class="tu-use-t"><b></b><small></small></span></button>
        <div class="tu-row">
          <button type="button" class="tu-btn tu-run" aria-label="Run" aria-pressed="false">${ICON.run}</button>
          <button type="button" class="tu-btn tu-phone" aria-label="Raise phone">${ICON.phone}<em>${ICON.down}</em></button>
        </div>
      </div>`;
    const host = this.ctx.ui && this.ctx.ui.root || document.getElementById('ui') || document.body;
    host.insertBefore(root, (this.ctx.ui && this.ctx.ui.overlay) || null);
    const q = (s) => root.querySelector(s);
    this.el = { root, ghost: q('.tu-ghost'), pause: q('.tu-pause'), cluster: q('.tu-cluster'), use: q('.tu-use'), useB: q('.tu-use-t b'), useS: q('.tu-use-t small'), run: q('.tu-run'), phone: q('.tu-phone') };
    const inp = this.ctx.input;
    // buttons act on touchstart (no 300 ms wait, works while the other thumb is walking); click is the fallback
    const bind = (b, fn) => {
      let tt = 0;
      b.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); tt = performance.now(); b.classList.add('on'); fn(); }, { passive: false });
      b.addEventListener('touchend', (e) => { e.preventDefault(); b.classList.remove('on'); }, { passive: false });
      b.addEventListener('touchcancel', () => b.classList.remove('on'));
      b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (performance.now() - tt > 600) fn(); });
    };
    bind(this.el.use, () => { if (!this.el.use.classList.contains('disabled')) inp.tap('interact'); });
    bind(this.el.phone, () => inp.tap('phone'));
    bind(this.el.run, () => { inp.runLatch = !inp.runLatch; inp._runIdle = 0; this._paint(true); });
    bind(this.el.pause, () => { const g = this.ctx.game; if (g && g.started && !g.paused && !g._endCard) g.pause(); });
  }

  update(dt) {
    if (!this.active || !this.el) return;
    const { ctx } = this, g = ctx.game, ph = ctx.phone, inp = ctx.input;
    // portrait: pause under the rotate card (only while it is actually shown), resume when turned back
    const rotUp = portrait() && !document.documentElement.classList.contains('portrait-ok');
    if (g && g.started && !g._endCard) {
      if (rotUp && !g.paused) { g.pause(); this._autoPaused = true; }
      else if (!rotUp && this._autoPaused) { this._autoPaused = false; if (g.paused) g.resume(); }
    }
    const playing = !!(g && g.started && !g.titleUp && !g.paused && !g._endCard && !g.ended);
    const free = playing && !g.intro && !g.busy;
    const up = !!(ph && ph.isOpen);
    // Use mirrors the HUD prompt (it already knows the phone / panel / vignette gating)
    const hp = this._hp || (this._hp = document.querySelector('#hud .h-prompt'));
    let use = null;
    if (free && hp && hp.classList.contains('on') && !hp.classList.contains('passive')) {
      const t = hp.querySelector('.h-prompt-text'), s = hp.querySelector('.h-prompt-sub');
      use = { t: t ? t.textContent : '', s: s && s.style.display !== 'none' ? s.textContent : '', dis: hp.classList.contains('disabled') };
    }
    const st = { playing, free, up, use: use ? `${use.t}|${use.s}|${use.dis}` : '', run: !!inp.runLatch, phoneOK: !!(ph && ph._canUse && ph._canUse()) };
    const S = this.state;
    if (st.use !== S.use) { if (use) { this.el.useB.textContent = use.t; this.el.useS.textContent = use.s; this.el.useS.hidden = !use.s; this.el.use.classList.toggle('disabled', use.dis); } }
    const changed = ['playing', 'free', 'up', 'use', 'run', 'phoneOK'].some(k => st[k] !== S[k]);
    this.state = st;
    if (changed) this._paint();
    this._place();
  }
  _paint() {
    const { el } = this, s = this.state, r = el.root;
    r.classList.toggle('on', s.playing);
    r.classList.toggle('free', s.free);
    r.classList.toggle('ph-up', s.up);
    r.classList.toggle('has-use', !!s.use);
    document.documentElement.classList.toggle('tu-use-on', !!s.use && s.free);
    el.run.classList.toggle('sel', !!this.ctx.input.runLatch);
    el.run.setAttribute('aria-pressed', this.ctx.input.runLatch ? 'true' : 'false');
    el.phone.setAttribute('aria-label', s.up ? 'Lower phone' : 'Raise phone');
    el.phone.classList.toggle('dim', !s.phoneOK);
  }
  // the right-hand cluster: above the lowered phone; left of the raised one
  _place() {
    const ph = this.ctx.phone, r = this.el.root;
    let right = 0, bottom = 0;
    if (ph && ph.wrap && ph.pose !== 'down') {
      const b = ph.device ? ph.device.getBoundingClientRect() : null;
      if (b && b.width > 0) {
        if (ph.isOpen) right = Math.max(0, innerWidth - b.left + 10);
        else bottom = Math.max(0, innerHeight - b.top + 4);
      }
    }
    right = Math.round(right); bottom = Math.round(bottom);
    if (right !== this._r || bottom !== this._b) {
      this._r = right; this._b = bottom;
      r.style.setProperty('--tu-right', right + 'px');
      r.style.setProperty('--tu-bottom', bottom + 'px');
    }
  }
}
