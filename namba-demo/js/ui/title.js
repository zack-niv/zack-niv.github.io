// =============================================================================
// Title screen. The world renders behind it: a slow drifting look along the
// Nankai platform while the type sits quietly in the corner.
//   new Title(ctx, { onBegin }) · show() · hide() · update(dt)
// =============================================================================
import { buildSettingsPanel, buildControlsCard } from '../game/settings.js?v=454ed73';
import { LAYOUT } from '../world/layout.js?v=454ed73';

export class Title {
  constructor(ctx, { onBegin } = {}) {
    this.ctx = ctx;
    this.onBegin = onBegin;
    this.el = ctx.ui.title || document.getElementById('title');
    this.visible = false;
    this.t = 0;
  }
  build() {
    const el = this.el;
    el.className = 'g-title-screen';
    const k = (x, w) => `<kbd class="g-key${w ? ' wide' : ''}">${x}</kbd>`;
    const touch = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
    el.innerHTML = `
      <div class="t-shade"></div>
      <div class="t-top">
        <div class="t-place"><span class="t-dot"></span>南海なんば駅 · Nankai Namba · 11:20</div>
        <div class="t-menu">
          <button type="button" class="t-link" data-tab="settings">Settings</button>
        </div>
      </div>
      <div class="t-main">
        <div class="t-kana">なんば</div>
        <div class="t-latin">Lost in Namba</div>
        <div class="t-rule"></div>
        <div class="t-tag">Somewhere in this labyrinth, a tempura lunch is waiting.</div>
        <div class="t-tag-ja">この迷宮のどこかで、天ぷらが待っている。</div>
        <button type="button" class="t-begin"><span class="t-begin-line"></span><span>Click to begin</span><small>クリックしてはじめる</small></button>
      </div>
      <div class="t-drawer" hidden>
        <div class="t-drawer-head"><span class="t-drawer-title"></span><button type="button" class="t-close" aria-label="Close">✕</button></div>
        <div class="t-drawer-body"></div>
      </div>
      <div class="t-foot">
        <div class="t-hint">${touch ? 'Best on a computer with a keyboard and mouse' : 'Best with keyboard &amp; mouse'}<span class="t-sep">·</span>headphones on <span class="t-hp" aria-hidden="true">🎧</span></div>
        <div class="t-keys"><span>${k('W')}${k('A')}${k('S')}${k('D')} <i>walk</i></span><span>${k('Shift', 1)} <i>hurry</i></span><span>${k('Q')} <i>phone</i></span><span>${k('E')} <i>interact</i></span></div>
      </div>`;
    const drawer = el.querySelector('.t-drawer');
    const body = el.querySelector('.t-drawer-body');
    const titleEl = el.querySelector('.t-drawer-title');
    const openTab = (tab) => {
      if (!drawer.hidden && drawer.dataset.tab === tab) { drawer.hidden = true; drawer.dataset.tab = ''; return; }
      drawer.hidden = false; drawer.dataset.tab = tab;
      body.innerHTML = '';
      if (tab === 'settings') { titleEl.innerHTML = 'Settings <small>設定</small>'; body.appendChild(buildSettingsPanel(this.ctx)); }
      else { titleEl.innerHTML = 'Controls <small>操作</small>'; body.appendChild(buildControlsCard()); }
      this.ctx.audio?.play?.('ui_open');
    };
    el.querySelectorAll('.t-link').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); openTab(b.dataset.tab); }));
    el.querySelector('.t-close').addEventListener('click', (e) => { e.stopPropagation(); drawer.hidden = true; drawer.dataset.tab = ''; });
    drawer.addEventListener('click', e => e.stopPropagation());
    drawer.addEventListener('pointerdown', e => e.stopPropagation());
    el.addEventListener('click', (e) => {
      if (!this.visible) return;
      if (!drawer.hidden && !e.target.closest('.t-begin')) { drawer.hidden = true; drawer.dataset.tab = ''; return; }
      this.begin();
    });
    this._keys = (e) => {
      if (!this.visible || e.repeat) return;
      if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); this.begin(); }
    };
    addEventListener('keydown', this._keys);
    this.built = true;
  }
  show() {
    if (!this.built) this.build();
    this.el.hidden = false;
    this.visible = true;
    if (this.ctx.ui && this.ctx.ui.phone) this.ctx.ui.phone.style.visibility = 'hidden';   // no "Q Phone" chip under the title
    this.el.classList.remove('leaving');
    requestAnimationFrame(() => this.el.classList.add('on'));
    this.t = 0;
    const p = this.ctx.player;
    if (p) {
      p.frozen = true;
      const sp = LAYOUT.spawns.start;
      this._base = { x: sp.x, z: sp.z + 14, level: sp.level };
    }
  }
  begin() {
    if (!this.visible) return;
    this.visible = false;
    if (this.ctx.ui && this.ctx.ui.phone) this.ctx.ui.phone.style.visibility = '';
    try { this.ctx.audio?.resume?.(); } catch (e) { /* ignore */ }
    try { this.ctx.input.requestLock(); } catch (e) { /* ignore */ }
    this.el.classList.add('leaving');
    this.el.classList.remove('on');
    setTimeout(() => { if (!this.visible) this.el.hidden = true; }, 1400);
    this.onBegin && this.onBegin();
  }
  // Slow cinematic drift along the platform while the title is up.
  update(dt) {
    if (!this.visible) return;
    this.t += dt;
    const p = this.ctx.player;
    if (!p || !this._base) return;
    const t = this.t;
    const b = p.body;
    // dolly north along platform 4 at walking-in-a-dream speed, then ease back
    const span = 26, period = 140;
    const ph = (t % period) / period;
    const s = 0.5 - 0.5 * Math.cos(ph * Math.PI * 2);
    b.level = this._base.level; b.x = this._base.x + Math.sin(t * 0.05) * 0.6; b.z = this._base.z - s * span; b.ramp = -1;
    p.yaw = 0.32 * Math.sin(t * 0.045) + 0.12;
    p.pitch = 0.07 + 0.035 * Math.sin(t * 0.07 + 1);
  }
}
