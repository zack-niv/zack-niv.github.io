// =============================================================================
// Controls & navigation walkthrough (v2 item 9).
// Four compact, in-world cards in the corner of the HUD right after the title (around Aya's first text):
//   1 look & move (+ Shift to hurry)   2 interact (E)   3 phone up / down (Q, right-click hold)
//   4 "follow the signs, the map lies"
// Never modal and never freezes the player. A card advances on a click, Space / Enter / the right arrow, the card's own
// key (Shift, E, Q) or after ~4 s; X (or the corner button) skips the lot. Clicking straight through takes ~3 s,
// letting it run ~16 s. Shown once per browser session (sessionStorage), so Replay does not bring it back.
// The phone's key bindings are the ones in notes/v2-phone.md (Q, hold right mouse).
//   ?tutorial  force it (even in ?test / after it was seen)   ?notutorial  never
// =============================================================================
import { params } from '../core/params.js';

const KEY = 'namba.walkthrough.v2';
const DWELL = 4.0;              // seconds a card stays when nobody touches anything
const GUARD = 0.45;             // a click this soon after a card appears is the same click that advanced the last one

const k = (x, cls = '') => `<kbd class="g-key lg${cls ? ' ' + cls : ''}">${x}</kbd>`;
const MOUSE = (side) => `<svg class="gw-mouse" viewBox="0 0 26 34" aria-hidden="true"><rect x="2" y="2" width="22" height="30" rx="11" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M13 2v13M2 15h22" fill="none" stroke="currentColor" stroke-width="1.4" opacity=".7"/>${side === 'right' ? '<path d="M13 2a11 11 0 0 1 11 11v2H13z" fill="#f2c14e" stroke="currentColor" stroke-width="1.4"/>' : ''}</svg>`;

export const CARDS = [
  {
    title: 'Look &amp; move', ja: '見る・歩く', keys: ['ShiftLeft', 'ShiftRight'],
    body: `<div class="gw-vis"><span class="gw-wasd"><i>${k('W')}</i><b>${k('A')}${k('S')}${k('D')}</b></span><span class="gw-plus">+</span>${MOUSE('move')}</div>
           <p>Mouse to look, <b>WASD</b> to walk. Hold ${k('Shift', 'wide sm')} to hurry.</p>`,
  },
  {
    title: 'Interact', ja: '調べる', keys: ['KeyE'],
    body: `<div class="gw-vis">${k('E')}</div>
           <p>Press <b>E</b> at doors, ticket machines and counters. Walk up to a café counter and order a coffee ☕</p>`,
  },
  {
    title: 'Your phone', ja: 'スマホ', keys: ['KeyQ', 'Tab', 'KeyM'], mouse2: true,
    body: `<div class="gw-vis">${k('Q')}<span class="gw-or">or hold</span>${MOUSE('right')}</div>
           <p><b>Q</b> lifts the phone, <b>Q</b> again lowers it. Or hold the right mouse button for a quick look. It drops back down as you walk on.</p>`,
  },
  {
    title: 'Follow the signs', ja: '案内に従って', keys: [],
    body: `<div class="gw-vis gw-sign"><span>↑ 6F</span><span>天ぷら 🍤</span></div>
           <p class="gw-big">The map lies 🙃</p>
           <p>Overhead signs and floor numbers beat any blue dot. Look up, and ask the walls.</p>`,
  },
];

let shownThisPage = false;
const store = {
  seen() { try { return sessionStorage.getItem(KEY) === '1'; } catch (e) { return shownThisPage; } },
  mark() { shownThisPage = true; try { sessionStorage.setItem(KEY, '1'); } catch (e) { /* private mode */ } },
};

export class Walkthrough {
  constructor(ctx, game) {
    this.ctx = ctx; this.game = game;
    this.active = false; this.i = -1; this.age = 0; this.el = null;
    this.touch = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
  }

  // Called by the demo director when the journey begins. Returns true when the cards will be shown (so the caller
  // can skip the plain "keys" hint), false if they have been seen / are switched off.
  plan(atSec) {
    if (params.has('notutorial')) return false;
    if (!params.has('tutorial') && (store.seen() || (params.test && !params.has('play')))) return false;
    this.game.after(atSec, () => this.start());
    return true;
  }

  start() {
    if (this.active) return;
    const hud = this.game.hud;
    if (!hud || hud.quiet || !hud.root) return;
    store.mark();
    this._build(hud.root);
    this.active = true; this.i = -1;
    this._onKey = (e) => this._key(e);
    this._onMouse = (e) => this._mouse(e);
    addEventListener('keydown', this._onKey, true);
    if (!this.touch) addEventListener('mousedown', this._onMouse, true);
    this._show(0);
    this.ctx.events.emit('tutorial:start', {});
  }

  _build(root) {
    const el = document.createElement('div');
    el.className = 'g-walk';
    el.innerHTML = `
      <div class="gw-card" role="status" aria-live="polite">
        <div class="gw-head"><span class="gw-step"></span><span class="gw-title"></span><button type="button" class="gw-skip" aria-label="Skip the tips" title="Skip (X)">✕</button></div>
        <div class="gw-body"></div>
        <div class="gw-foot"><span class="gw-dots"></span><span class="gw-next"></span></div>
        <i class="gw-bar"></i>
      </div>`;
    root.appendChild(el);
    this.el = el;
    this.card = el.querySelector('.gw-card');
    const skip = el.querySelector('.gw-skip');
    skip.addEventListener('click', (e) => { e.stopPropagation(); this.finish(true); });
    skip.addEventListener('mousedown', (e) => e.stopPropagation());
    if (this.touch) this.card.addEventListener('click', () => this.next());
  }

  _show(i) {
    if (i >= CARDS.length) return this.finish(false);
    const c = CARDS[i], q = (s) => this.el.querySelector(s);
    this.i = i; this.age = 0;
    this.card.classList.remove('in'); void this.card.offsetWidth;
    q('.gw-step').textContent = `${i + 1} / ${CARDS.length}`;
    q('.gw-title').innerHTML = `${c.title} <small>${c.ja}</small>`;
    q('.gw-body').innerHTML = c.body;
    q('.gw-dots').innerHTML = CARDS.map((_, j) => `<i class="${j === i ? 'on' : j < i ? 'done' : ''}"></i>`).join('');
    q('.gw-next').innerHTML = this.touch
      ? `tap <b>next ▸</b>`
      : `<kbd class="g-key sm">click</kbd> ${i === CARDS.length - 1 ? 'got it' : 'next'} <span class="gw-sep">·</span> <kbd class="g-key sm">X</kbd> skip`;
    this.card.style.setProperty('--gw-dwell', DWELL + 's');
    this.card.classList.add('in');
    this.el.classList.add('on');
  }

  next() {
    if (!this.active || this.age < GUARD) return;
    this._show(this.i + 1);
  }

  finish(skipped) {
    if (!this.active) return;
    this.active = false;
    removeEventListener('keydown', this._onKey, true);
    removeEventListener('mousedown', this._onMouse, true);
    const el = this.el;
    el.classList.remove('on');
    setTimeout(() => el.remove(), 700);
    this.ctx.events.emit('tutorial:done', { skipped: !!skipped, card: this.i });
  }

  _key(e) {
    if (!this.active || this.game.paused || e.repeat) return;
    const c = CARDS[this.i];
    if (e.code === 'KeyX') { this.finish(true); return; }
    if (e.code === 'Enter' || e.code === 'Space' || e.code === 'ArrowRight') { this.next(); return; }
    if (c && c.keys && (c.keys.includes(e.code))) {
      // the card's own key counts as "done that": move on a beat later so the player sees the key land
      if (this.age >= 0.8) this.next();
    }
  }
  _mouse(e) {
    if (!this.active || this.game.paused) return;
    if (e.target && e.target.closest && e.target.closest('.gw-skip')) return;
    const c = CARDS[this.i];
    if (e.button === 0 || (e.button === 2 && c && c.mouse2)) this.next();
  }

  // real seconds of play (the game stops calling this while paused)
  update(dt) {
    if (!this.active) return;
    this.age += dt;
    if (this.age >= DWELL) this.next();
  }
}
