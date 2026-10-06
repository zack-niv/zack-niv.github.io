// =============================================================================
// HUD — minimal and diegetic-feeling. Nothing on screen unless it matters:
//   · interaction prompt (key-cap + text) and a faint dot when targeting
//   · toasts (discoveries, goals), subtitles (PA announcements, people)
//   · ICOCA balance chip after a gate tap, cup-in-hand glyph, fades
//   · fallback phone-notification banner if the phone doesn't render texts
// API: hud.prompt(t|null) · hud.toast({kind,title,en,ja}) · hud.caption({en,ja,speaker,duration,kind})
//      hud.ic({balance,fare,ok,reason}) · hud.cup(on) · hud.fade(alpha, ms) → Promise
//      hud.chapter({ja,en,sub}) · hud.hint('keys'|'phone'|html, seconds) · hud.setVisible(bool)
// =============================================================================
import { params } from '../core/params.js';

export function ensureGameCss() {
  if (document.querySelector('link[data-game-css]') || document.querySelector('link[href$="css/game.css"]')) return;
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'css/game.css'; l.dataset.gameCss = '1';
  document.head.appendChild(l);
}
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const yen = (n) => '¥' + Math.round(n).toLocaleString('en-US');

export class Hud {
  constructor(ctx) { this.ctx = ctx; this._captions = []; this._t = 0; }
  init() {
    ensureGameCss();
    const root = this.ctx.ui.hud || document.getElementById('hud');
    this.root = root;
    root.classList.add('g-hud');
    root.innerHTML = `
      <div class="h-dot"></div>
      <div class="h-prompt"><div class="h-prompt-sub"></div><div class="h-prompt-main"><kbd class="g-key">E</kbd><span class="h-prompt-text"></span><span class="h-prompt-ja"></span></div></div>
      <div class="h-toasts"></div>
      <div class="h-captions"></div>
      <div class="h-ic"><div class="h-ic-card"><span class="h-ic-logo">ICOCA</span><span class="h-ic-chip"></span></div><div class="h-ic-info"><div class="h-ic-row h-ic-state"></div><div class="h-ic-row"><span>残額 Balance</span><b class="h-ic-bal"></b></div></div></div>
      <div class="h-cup" title="Coffee in hand"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M8 11h14l-1.6 15.2a2 2 0 0 1-2 1.8h-6.8a2 2 0 0 1-2-1.8z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M7 8.5h16v2.5H7z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M10 6.5h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M9.6 16.5h10.8" stroke="currentColor" stroke-width="1.2" opacity=".6"/><path class="h-steam" d="M13 4c-1-1.2 1-2 0-3.2M17 4c-1-1.2 1-2 0-3.2" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg></div>
      <div class="h-hint"></div>
      <div class="h-notify"></div>
      <div class="h-chapter"><div class="h-chapter-ja"></div><div class="h-chapter-en"></div><div class="h-chapter-sub"></div></div>
      <div class="h-fade"></div>`;
    const q = (s) => root.querySelector(s);
    this.el = {
      dot: q('.h-dot'), prompt: q('.h-prompt'), promptSub: q('.h-prompt-sub'), promptText: q('.h-prompt-text'), promptJa: q('.h-prompt-ja'), promptKey: q('.h-prompt .g-key'),
      toasts: q('.h-toasts'), captions: q('.h-captions'), ic: q('.h-ic'), icState: q('.h-ic-state'), icBal: q('.h-ic-bal'),
      cup: q('.h-cup'), hint: q('.h-hint'), notify: q('.h-notify'), chapter: q('.h-chapter'), fade: q('.h-fade'),
    };
    // Other leads screenshot with ?test: keep the HUD out of their pictures.
    this.quiet = params.test && !params.has('play');
    if (this.quiet) root.style.display = 'none';
    const ev = this.ctx.events;
    // PA announcements: the sound system speaks them and emits timed 'caption'
    // events; only caption raw 'announce' events when there is no audio.
    const audioCaptions = () => !!(this.ctx.audio && this.ctx.audio.enabled && this.ctx.audio.announcer);
    const subsOn = () => !(this.ctx.settings && this.ctx.settings.subtitles === false);
    ev.on('announce', (a) => {
      if (!a || audioCaptions() || !subsOn()) return;
      this.caption({ ja: a.ja, en: a.text || a.en, kind: 'announce', duration: a.duration || Math.max(4.5, ((a.text || '').length + (a.ja || '').length) * 0.06) });
    });
    ev.on('caption', (c) => {
      if (!c) return;
      const pa = c.speaker === 'PA' || c.kind === 'announce' || c.kind === 'platform' || c.kind === 'train' || c.distant;
      if (pa && !subsOn()) return;
      this.caption(Object.assign({}, c, { en: c.en != null ? c.en : (c.ja ? '' : c.text), speaker: c.speaker === 'PA' ? '' : c.speaker, kind: pa ? 'announce' : (c.kind || 'say'), distant: !!c.distant }));
    });
    ev.on('toast', (t) => t && this.toast(t));
    // shop staff call out as you pass: a quiet, distant subtitle (cooldown so a shopping street isn't a wall of text)
    ev.on('crowd:callout', (c) => {
      if (this.quiet || !c || !c.ja || !subsOn()) return;
      const p = this.ctx.player && this.ctx.player.body;
      if (!p || c.level !== p.level || Math.hypot(c.x - p.x, c.z - p.z) > 9) return;
      const now = performance.now();
      if (this._calloutT && now - this._calloutT < 14000) return;
      this._calloutT = now;
      this.caption({ ja: c.ja, en: c.en || '', kind: 'say', distant: true, duration: 2.2 });
    });
    ev.on('phone:message', (m) => {
      if (this.ctx.phone && this.ctx.phone.handlesMessages) return;
      this.notify(m);
    });
  }
  setVisible(v) { if (!this.quiet) this.root.style.visibility = v ? '' : 'hidden'; }

  // ---- interaction prompt -----------------------------------------------------
  prompt(t) {
    const e = this.el;
    if (!t) { e.prompt.classList.remove('on'); e.dot.classList.remove('on'); this._promptId = null; return; }
    const key = t.passive ? '' : (t.key || 'E');
    const sig = `${t.id}|${t.prompt}|${t.promptJa}|${t.sub}|${key}|${t.disabled}`;
    if (sig !== this._promptId) {
      this._promptId = sig;
      e.promptText.textContent = t.prompt || '';
      e.promptJa.textContent = t.promptJa || '';
      e.promptSub.textContent = t.sub || '';
      e.promptSub.style.display = t.sub ? '' : 'none';
      e.promptKey.textContent = key;
      e.promptKey.style.display = key ? '' : 'none';
      e.prompt.classList.toggle('disabled', !!t.disabled);
      e.prompt.classList.toggle('passive', !!t.passive);
    }
    e.prompt.classList.add('on');
    e.dot.classList.toggle('on', !t.passive);
  }

  // ---- toasts -------------------------------------------------------------------
  toast({ kind = 'info', title = '', en = '', ja = '', duration = 4.8 } = {}) {
    if (this.quiet) return;
    const d = document.createElement('div');
    d.className = `h-toast k-${kind}`;
    d.innerHTML = `${title ? `<div class="h-toast-title">${esc(title)}</div>` : ''}<div class="h-toast-en">${esc(en)}</div>${ja ? `<div class="h-toast-ja">${esc(ja)}</div>` : ''}`;
    this.el.toasts.appendChild(d);
    while (this.el.toasts.children.length > 3) this.el.toasts.firstChild.remove();
    requestAnimationFrame(() => d.classList.add('on'));
    setTimeout(() => { d.classList.remove('on'); d.classList.add('off'); setTimeout(() => d.remove(), 900); }, duration * 1000);
  }

  // ---- subtitles ----------------------------------------------------------------
  caption({ en = '', ja = '', speaker = '', duration, kind = 'say', distant = false } = {}) {
    if (this.quiet || (!en && !ja)) return;
    const dur = duration || Math.max(3.2, (en.length + ja.length * 1.6) * 0.055);
    const d = document.createElement('div');
    d.className = `h-cap k-${kind}${distant ? ' distant' : ''}`;
    const who = speaker ? `<span class="h-cap-who">${esc(speaker)}</span>` : (kind === 'announce' ? '<span class="h-cap-who pa">案内</span>' : '');
    d.innerHTML = `${ja ? `<div class="h-cap-ja">${who}${esc(ja)}</div>` : ''}${en ? `<div class="h-cap-en">${ja ? '' : who}${esc(en)}</div>` : ''}`;
    this.el.captions.appendChild(d);
    while (this.el.captions.children.length > 2) this.el.captions.firstChild.remove();
    requestAnimationFrame(() => d.classList.add('on'));
    clearTimeout(d._t);
    d._t = setTimeout(() => { d.classList.remove('on'); setTimeout(() => d.remove(), 600); }, dur * 1000);
    return d;
  }
  clearCaptions() { this.el.captions.innerHTML = ''; }

  // ---- ICOCA chip -----------------------------------------------------------------
  ic({ balance = 0, fare = 0, ok = true, reason = '' } = {}) {
    if (this.quiet) return;
    const e = this.el;
    e.ic.classList.toggle('ng', !ok);
    e.icState.innerHTML = ok
      ? (fare ? `<span>運賃 Fare</span><b>−${yen(fare)}</b>` : `<span class="ok">ピッ</span><b>${esc(reason || '')}</b>`)
      : `<span class="ng">残高不足</span><b>${esc(reason || 'Please charge')}</b>`;
    e.icBal.textContent = yen(balance);
    e.ic.classList.remove('on'); void e.ic.offsetWidth; e.ic.classList.add('on');
    clearTimeout(this._icT);
    this._icT = setTimeout(() => e.ic.classList.remove('on'), ok ? 2600 : 4200);
  }
  cup(on) { this.el.cup.classList.toggle('on', !!on); }

  // ---- controls hint (bottom centre, fades on its own) ---------------------------------
  // kinds: 'keys' (the four controls) | 'phone' (Q) | or a ready-made html string
  hint(kind, duration = 8) {
    if (this.quiet) return;
    const k = (x, w) => `<kbd class="g-key${w ? ' wide' : ''}">${x}</kbd>`;
    const html = kind === 'keys'
      ? `<span>${k('W')}${k('A')}${k('S')}${k('D')} <i>walk</i></span><span>${k('Shift', 1)} <i>hurry</i></span><span>${k('Q')} <i>phone</i></span><span>${k('E')} <i>interact</i></span>`
      : kind === 'phone' ? `<span>${k('Q')} <i>take out your phone</i></span>` : String(kind);
    const e = this.el.hint;
    e.innerHTML = html;
    e.classList.remove('on'); void e.offsetWidth; e.classList.add('on');
    clearTimeout(this._hintT);
    this._hintT = setTimeout(() => e.classList.remove('on'), duration * 1000);
  }

  // ---- phone notification banner (fallback) ---------------------------------------
  notify({ from = 'Aya', text = '', time = '' } = {}) {
    if (this.quiet) return;
    const d = document.createElement('div');
    d.className = 'h-note';
    d.innerHTML = `<div class="h-note-head"><span class="h-note-app">💬</span><b>${esc(from)}</b><span class="h-note-time">${esc(time || 'now')}</span></div><div class="h-note-text">${esc(text).replace(/\n/g, '<br>')}</div>`;
    this.el.notify.appendChild(d);
    while (this.el.notify.children.length > 2) this.el.notify.firstChild.remove();
    requestAnimationFrame(() => d.classList.add('on'));
    const dur = Math.min(11, 4.5 + text.length * 0.045);
    setTimeout(() => { d.classList.remove('on'); setTimeout(() => d.remove(), 700); }, dur * 1000);
  }

  // ---- chapter / location card -------------------------------------------------------
  chapter({ ja = '', en = '', sub = '', duration = 5.5 } = {}) {
    if (this.quiet) return;
    const e = this.el;
    e.chapter.querySelector('.h-chapter-ja').textContent = ja;
    e.chapter.querySelector('.h-chapter-en').textContent = en;
    e.chapter.querySelector('.h-chapter-sub').textContent = sub;
    e.chapter.classList.remove('on'); void e.chapter.offsetWidth; e.chapter.classList.add('on');
    clearTimeout(this._chT);
    this._chT = setTimeout(() => e.chapter.classList.remove('on'), duration * 1000);
  }

  // ---- full-screen fade (0 = clear, 1 = black) ----------------------------------------
  fade(alpha, ms = 900) {
    const f = this.el.fade;
    f.style.transitionDuration = ms + 'ms';
    clearTimeout(this._fadeT);
    if (alpha > 0.01) { f.classList.add('block'); void f.offsetWidth; }
    else this._fadeT = setTimeout(() => f.classList.remove('block'), ms);
    f.style.opacity = String(alpha);
    return new Promise(r => setTimeout(r, ms + 30));
  }
  // veil: dim + soften the live world instead of cutting to black (a coffee brews, the line shuffles forward)
  veil(on) { this.el.fade.classList.toggle('veil', !!on); }
  // ride: black with tunnel lights streaking past the window band
  ride(on) { this.el.fade.classList.toggle('ride', !!on); }
  fadeText(html) { this.el.fade.innerHTML = html ? `<div class="h-fade-text">${html}</div>` : ''; }

  update() {}
}
