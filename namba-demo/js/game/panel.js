// =============================================================================
// Small DOM panels for vignettes: menus (café menu, ticket machine, charge
// machine), cards (signs, end card), confirm dialogs. Keyboard first (the
// pointer usually stays locked): W/S or ↑/↓ choose · 1-9 pick · E/Enter/Space
// select. Mouse/touch also work when the pointer is free.
// =============================================================================
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const yen = (n) => '¥' + Math.round(n).toLocaleString('en-US');
export { esc };

export class Panels {
  constructor(ctx) {
    this.ctx = ctx;
    this.root = ctx.ui.overlay || document.getElementById('overlay');
    this.current = null;
    this._key = (e) => this._onKey(e);
    addEventListener('keydown', this._key, true);
  }
  get open() { return !!this.current; }

  _mount(el) {
    this.root.appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('on')));
  }
  _unmount(el) {
    if (!el) return;
    el.classList.remove('on'); el.classList.add('off');
    setTimeout(() => el.remove(), 450);
  }
  close(value = null) {
    const c = this.current;
    if (!c) return;
    this.current = null;
    this._unmount(c.el);
    this.ctx.audio?.play?.('ui_close');
    c.resolve(value);
  }

  // menu({ style, kicker, title, titleJa, sub, items: [{ ja, en, price, note, disabled, value }], foot, side })
  menu(opts) {
    if (this.current) this.close(null);
    return new Promise((resolve) => {
      const el = document.createElement('div');
      el.className = `g-panel g-menu s-${opts.style || 'paper'} p-${opts.side || 'right'}`;
      const items = opts.items || [];
      el.innerHTML = `
        <div class="g-panel-inner">
          ${opts.kicker ? `<div class="g-kicker">${esc(opts.kicker)}</div>` : ''}
          ${opts.titleJa ? `<div class="g-title-ja">${esc(opts.titleJa)}</div>` : ''}
          ${opts.title ? `<div class="g-title">${esc(opts.title)}</div>` : ''}
          ${opts.sub ? `<div class="g-sub">${opts.subHtml ? opts.sub : esc(opts.sub)}</div>` : ''}
          <ol class="g-items">${items.map((it, i) => `
            <li class="g-item${it.disabled ? ' dis' : ''}${it.quiet ? ' quiet' : ''}" data-i="${i}">
              <span class="g-item-n">${i + 1}</span>
              <span class="g-item-names">${it.ja ? `<span class="g-item-ja">${esc(it.ja)}</span>` : ''}<span class="g-item-en">${esc(it.en || '')}</span>${it.note ? `<span class="g-item-note">${esc(it.note)}</span>` : ''}</span>
              ${it.price != null ? `<span class="g-item-price">${typeof it.price === 'number' ? yen(it.price) : esc(it.price)}</span>` : ''}
            </li>`).join('')}</ol>
          ${opts.foot ? `<div class="g-foot">${opts.foot}</div>` : ''}
          <div class="g-hint"><kbd class="g-key sm">W</kbd><kbd class="g-key sm">S</kbd> choose <span class="g-dotsep">·</span> <kbd class="g-key sm">E</kbd> select</div>
        </div>`;
      const lis = [...el.querySelectorAll('.g-item')];
      let sel = Math.max(0, items.findIndex(it => !it.disabled));
      const paint = () => lis.forEach((li, i) => li.classList.toggle('sel', i === sel));
      paint();
      const choose = (i) => {
        const it = items[i];
        if (!it || it.disabled) { li_shake(lis[i]); return; }
        this.ctx.audio?.play?.('ui_select');
        lis[i].classList.add('chosen');
        setTimeout(() => this.close(it.value !== undefined ? it.value : i), 160);
      };
      lis.forEach((li, i) => {
        li.addEventListener('mouseenter', () => { sel = i; paint(); });
        li.addEventListener('click', (e) => { e.stopPropagation(); choose(i); });
      });
      this.current = {
        el, resolve,
        key: (code) => {
          if (code === 'KeyW' || code === 'ArrowUp') { sel = step(items, sel, -1); paint(); this.ctx.audio?.play?.('ui_select', { gain: 0.35 }); return true; }
          if (code === 'KeyS' || code === 'ArrowDown') { sel = step(items, sel, 1); paint(); this.ctx.audio?.play?.('ui_select', { gain: 0.35 }); return true; }
          if (code === 'KeyE' || code === 'Enter' || code === 'Space') { choose(sel); return true; }
          const m = /^Digit([1-9])$/.exec(code) || /^Numpad([1-9])$/.exec(code);
          if (m) { const i = +m[1] - 1; if (i < items.length) { sel = i; paint(); choose(i); } return true; }
          if (code === 'Escape' || code === 'Backspace') { if (opts.cancelValue !== undefined) this.close(opts.cancelValue); return true; }
          return false;
        },
      };
      this.ctx.audio?.play?.('ui_open');
      this._mount(el);
    });
  }

  // card({ style, html, buttons: [{label, value}], side, timeout }) → Promise(value)
  card(opts) {
    if (this.current) this.close(null);
    return new Promise((resolve) => {
      const el = document.createElement('div');
      el.className = `g-panel g-card s-${opts.style || 'paper'} p-${opts.side || 'right'}`;
      const btns = opts.buttons || [{ label: 'Continue', value: true }];
      el.innerHTML = `<div class="g-panel-inner">${opts.html || ''}
        ${btns.length ? `<div class="g-btns">${btns.map((b, i) => `<button type="button" class="g-btn${i === 0 ? ' sel' : ''}" data-i="${i}">${i === 0 ? '<kbd class="g-key sm">E</kbd>' : ''}${esc(b.label)}</button>`).join('')}</div>` : ''}
      </div>`;
      const bs = [...el.querySelectorAll('.g-btn')];
      let sel = 0;
      const paint = () => bs.forEach((b, i) => { b.classList.toggle('sel', i === sel); const k = b.querySelector('.g-key'); if (k) k.remove(); if (i === sel) b.insertAdjacentHTML('afterbegin', '<kbd class="g-key sm">E</kbd>'); });
      const choose = (i) => { this.ctx.audio?.play?.('ui_select'); this.close(btns[i] ? btns[i].value : true); };
      bs.forEach((b, i) => b.addEventListener('click', (e) => { e.stopPropagation(); choose(i); }));
      this.current = {
        el, resolve,
        key: (code) => {
          if (!btns.length) return false;
          if (['KeyA', 'ArrowLeft', 'KeyW', 'ArrowUp'].includes(code)) { sel = (sel + bs.length - 1) % bs.length; paint(); return true; }
          if (['KeyD', 'ArrowRight', 'KeyS', 'ArrowDown', 'Tab'].includes(code)) { sel = (sel + 1) % bs.length; paint(); return true; }
          if (code === 'KeyE' || code === 'Enter' || code === 'Space') { choose(sel); return true; }
          return false;
        },
      };
      if (opts.timeout) setTimeout(() => { if (this.current && this.current.el === el) this.close(opts.timeoutValue); }, opts.timeout);
      this.ctx.audio?.play?.('ui_open');
      this._mount(el);
    });
  }

  _onKey(e) {
    if (!this.current || e.repeat) return;
    if (this.ctx.game && this.ctx.game.paused) return;
    if (this.current.key(e.code)) { e.preventDefault(); e.stopImmediatePropagation(); }
  }
}

function step(items, sel, d) {
  const n = items.length;
  for (let k = 1; k <= n; k++) { const i = (sel + d * k + n * 4) % n; if (!items[i].disabled) return i; }
  return sel;
}
function li_shake(li) { if (!li) return; li.classList.remove('shake'); void li.offsetWidth; li.classList.add('shake'); }
