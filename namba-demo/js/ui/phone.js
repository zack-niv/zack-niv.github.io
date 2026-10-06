// =============================================================================
// The player's phone — a DOM overlay in #phone-root, held in the lower part of
// the view. Q / Tab (input action 'phone', touch button) raises/lowers it.
// While open the mouse is released for the screen (WASD still walks — people
// really do walk while staring at maps).
//
// Apps: Maps (indoor map, search, directions — ui/phone/mapapp.js), Notes
// (quest checklist), Messages (Aya's texts), Transit, plus a home screen.
// Status bar: game clock, battery that drains, signal that drops underground
// (圏外 on the B2 platforms).
//
// API (ctx.phone):
//   isOpen, app, open(app?), close(), toggle(), openApp(id)
//   pos            the phone's location belief {x,z,level,acc,heading,signal,noService}
//   handlesMessages = true (HUD skips its fallback banner)
//   search(q)      programmatic search (opens Maps)
//   --- demo upgrade (Lodestone) ---
//   offerLodestone()      Aya texts a link card (idempotent). Fallback: the phone does it itself
//                         after ~150 s of play if the game never has
//   installLodestone()    install (~2 s) -> calibration (~3.3 s) -> ready. Opens the phone.
//   positioningMode       'gps' | 'lodestone' (flips to 'lodestone' when stage 'ready' starts)
//   upgradeStage          'none' | 'offer' | 'installing' | 'calibrating' | 'ready'
//   stats()               live before/after numbers (see ui/phone/stats.js)
// Events: emits 'phone:open' / 'phone:close' {app}, 'phone:search' {query,count},
//   'phone:select' {id,kind,slot,key}, 'phone:route' {id,level}, 'phone:arrive' {id},
//   'phone:upgrade' {stage: 'offer'|'installing'|'calibrating'|'ready'}, 'lodestone:arrive' {id}
//   listens 'phone:message' {from,text,time,link?}, 'quest:update', 'demo:arrive'
// =============================================================================
import { Positioning } from './phone/positioning.js';
import { MapApp } from './phone/mapapp.js';
import { HomeApp, NotesApp, MessagesApp, TransitApp } from './phone/apps.js';
import { LodestoneApp } from './phone/lodestone.js';
import { PhoneStats } from './phone/stats.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class Phone {
  constructor(ctx) {
    this.ctx = ctx;
    this.isOpen = false;
    this.app = 'maps';
    this.handlesMessages = true;
    this.battery = 64;
    this.typing = false;
    this._sway = { x: 0, y: 0, r: 0 };
    this.upgradeStage = 'none';
    this.sway = null;          // override while Lodestone calibrates (figure-of-8 wave)
    this._scale = 1;
    this._play = 0;            // seconds of play (fallback offer timer)
  }

  // ---- demo upgrade API -------------------------------------------------------
  get positioningMode() { return this.pos ? this.pos.mode : 'gps'; }
  stats() { return this._stats ? this._stats.summary() : {}; }
  offerLodestone() {
    if (this.upgradeStage !== 'none') return false;
    this.ctx.events.emit('phone:message', { id: 'aya_lodestone', from: 'Aya', text: 'you’re lost aren’t you 😂 install Lodestone — it actually works indoors', link: 'lodestone' });
    return true;
  }
  _noteOffer() {                // called by Messages when a link:'lodestone' text lands
    if (this.upgradeStage !== 'none') return;
    this.upgradeStage = 'offer'; this._offerAt = this._play;
    this.ctx.events.emit('phone:upgrade', { stage: 'offer' });
  }
  lodestoneAction() { if (this.upgradeStage === 'ready') this.openApp('lodestone'); else this.installLodestone(); }
  installLodestone() {
    if (['installing', 'calibrating', 'ready'].includes(this.upgradeStage)) return false;
    if (this.upgradeStage === 'none') this._noteOffer();
    this.open('lodestone');
    this.lodestone.start();
    this.messages && this.messages.render();
    return true;
  }

  async init() {
    const { ctx } = this;
    // stylesheet
    if (!document.querySelector('link[data-namba="phone-css"]')) {
      const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'css/phone.css'; l.dataset.namba = 'phone-css';
      document.head.appendChild(l);
    }
    this.lowQ = ctx.engine && ctx.engine.qualityName === 'low';
    this.pos = new Positioning(ctx);
    this._stats = new PhoneStats(this);
    this.pos.update(0);
    if (!this.pos.level) this.pos.level = (ctx.player && ctx.player.body.level) || '3F';
    this.root = (ctx.ui && ctx.ui.phone) || document.getElementById('phone-root');
    this._buildDom();
    this.home = new HomeApp(this, this.views.home);
    this.maps = new MapApp(this, this.views.maps);
    this.notes = new NotesApp(this, this.views.notes);
    this.messages = new MessagesApp(this, this.views.messages);
    this.transit = new TransitApp(this, this.views.transit);
    this.lodestone = new LodestoneApp(this, this.views.lodestone);
    this.apps = { home: this.home, maps: this.maps, notes: this.notes, messages: this.messages, transit: this.transit, lodestone: this.lodestone };
    this._showApp('maps');
    // signage finishes its content in the background (never awaited here)
    if (ctx.signage && ctx.signage.start) ctx.signage.start();
    // a pointer lock grabbed by a click on the world closes the phone
    document.addEventListener('pointerlockchange', () => { if (document.pointerLockElement && this.isOpen && !this._locking) this.close(true); });
  }

  _buildDom() {
    const r = this.root;
    r.innerHTML = `
      <div class="ph-wrap">
        <div class="ph-device">
          <i class="ph-btn ph-btn-a"></i><i class="ph-btn ph-btn-b"></i><i class="ph-btn ph-btn-c"></i><i class="ph-btn ph-btn-d"></i>
          <div class="ph-screen">
            <div class="ph-status"><span class="ph-time">10:42</span><span class="ph-island"></span>
              <span class="ph-right"><span class="ph-sig"><i></i><i></i><i></i><i></i></span><span class="ph-net">5G</span><span class="ph-bat"><i></i><b>64</b></span></span></div>
            <div class="ph-views">
              <div class="ph-view" data-v="home"></div><div class="ph-view" data-v="maps"></div><div class="ph-view" data-v="notes"></div>
              <div class="ph-view" data-v="messages"></div><div class="ph-view" data-v="transit"></div><div class="ph-view" data-v="lodestone"></div>
            </div>
            <div class="ph-notif" hidden></div>
            <div class="ph-toast" hidden></div>
            <div class="ph-homebar"><i></i></div>
          </div>
          <div class="ph-glare"></div>
        </div>
      </div>
      <div class="ph-peek" hidden></div>
      <div class="ph-hint">${this.ctx.input && this.ctx.input.touch ? '' : '<kbd>Q</kbd> Phone'}</div>`;
    this.wrap = r.querySelector('.ph-wrap');
    this.device = r.querySelector('.ph-device');
    this.views = {};
    r.querySelectorAll('.ph-view').forEach(v => { this.views[v.dataset.v] = v; });
    this.el = {
      time: r.querySelector('.ph-time'), sig: r.querySelectorAll('.ph-sig i'), net: r.querySelector('.ph-net'), bat: r.querySelector('.ph-bat'),
      batB: r.querySelector('.ph-bat b'), batI: r.querySelector('.ph-bat i'), notif: r.querySelector('.ph-notif'), toast: r.querySelector('.ph-toast'),
      peek: r.querySelector('.ph-peek'), hint: r.querySelector('.ph-hint'),
    };
    r.querySelector('.ph-homebar').addEventListener('click', () => this._showApp(this.app === 'home' ? 'maps' : 'home'));
    this.el.notif.addEventListener('click', () => { this.el.notif.hidden = true; this.openApp(this._notifApp || 'messages'); });
    // pointer inside the phone never reaches the game
    for (const ev of ['pointerdown', 'mousedown', 'click', 'wheel', 'touchstart']) this.wrap.addEventListener(ev, e => e.stopPropagation(), { passive: ev !== 'wheel' && ev !== 'touchstart' ? true : true });
    this._layout();
    addEventListener('resize', () => this._layout());
  }

  _layout() {
    // scale the 340×700 device to the viewport (held low: the top ~85 % shows)
    const s = Math.max(0.55, Math.min(1.15, (innerHeight * 0.9) / 700, (innerWidth * 0.92) / 340));
    this._scale = s;
    this.wrap.style.setProperty('--s', s.toFixed(3));
  }

  // ------------------------------------------------------------------ API ---
  open(app) {
    if (app) this._showApp(app);
    if (this.isOpen) return;
    this.isOpen = true;
    this.wrap.classList.add('open');
    this.root.classList.add('ph-is-open');
    this.el.peek.hidden = true;
    this.el.hint.classList.add('used');
    try { this.ctx.input.exitLock(); } catch (e) { /* ignore */ }
    this.maps._dirty = true;
    if (this.app === 'messages') this.messages.onShow();
    this.ctx.audio && this.ctx.audio.play && this.ctx.audio.play('ui_open');
    this.ctx.events.emit('phone:open', { app: this.app });
  }
  close(fromLock) {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.wrap.classList.remove('open');
    this.root.classList.remove('ph-is-open');
    const a = document.activeElement; if (a && this.root.contains(a)) a.blur();
    this.typing = false;
    if (!fromLock && !(this.ctx.game && this.ctx.game.paused)) { this._locking = true; try { this.ctx.input.requestLock(); } catch (e) { /* ignore */ } setTimeout(() => { this._locking = false; }, 300); }
    this.ctx.audio && this.ctx.audio.play && this.ctx.audio.play('ui_close');
    this.ctx.events.emit('phone:close', { app: this.app });
  }
  toggle() { this.isOpen ? this.close() : this.open(); }
  openApp(id) { this.open(id); }
  search(q) { this.open('maps'); this.maps.input.value = q; this.maps.doSearch(q); }

  _showApp(id) {
    if (!this.views[id]) return;
    this.app = id;
    for (const k in this.views) this.views[k].classList.toggle('on', k === id);
    this.root.querySelector('.ph-screen').dataset.app = id;
    const a = this.apps && this.apps[id];
    if (a && a.onShow) a.onShow();
  }

  // in-phone notification banner (or a peek card when the phone is down)
  notify(app, msg) {
    if (app === 'messages' && msg) {
      this.ctx.audio && this.ctx.audio.play && this.ctx.audio.play('phone_buzz');
      this._notifApp = app;
      const html = `<i class="ph-n-ic ic-msg"></i><div><b>${esc(msg.title)}</b><span>now</span><p>${esc(msg.text)}</p></div>`;
      if (this.isOpen && this.app !== 'messages') {
        this.el.notif.innerHTML = html; this.el.notif.hidden = false;
        clearTimeout(this._nT); this._nT = setTimeout(() => { this.el.notif.hidden = true; }, 5000);
      } else if (!this.isOpen) {
        this.el.peek.innerHTML = html + `<em>${this.ctx.input && this.ctx.input.touch ? 'tap 📱' : 'Q'} to read</em>`;
        this.el.peek.hidden = false; this.el.peek.classList.remove('in'); void this.el.peek.offsetWidth; this.el.peek.classList.add('in');
        this._notifApp = 'messages';
        clearTimeout(this._pT); this._pT = setTimeout(() => { this.el.peek.hidden = true; }, 7000);
        this._openTo = 'messages';
      }
      this.home.badge('messages', this.messages.unread);
    }
    if (app === 'notes') this.home && this.home.badge('notes', '!');
  }
  toastIn(t) {
    this.el.toast.textContent = t; this.el.toast.hidden = false;
    clearTimeout(this._tT); this._tT = setTimeout(() => { this.el.toast.hidden = true; }, 1800);
  }

  // ---------------------------------------------------------------- update ---
  update(dt) {
    const { ctx } = this;
    const inp = ctx.input;
    const pressed = inp && (typeof inp.action === 'function' ? inp.action('phone') : (inp.pressed('KeyQ') || inp.pressed('Tab')));
    if (pressed && !this.typing && !(ctx.game && ctx.game.busy)) {
      if (!this.isOpen && this._openTo && !this.el.peek.hidden) { this.open(this._openTo); this._openTo = null; }
      else this.toggle();
    }
    this.pos.update(dt);
    this._stats.update(dt);
    // the upgrade: keyboard (Enter / E while the offer is on screen) and the 150 s fallback
    if (ctx.started && !ctx.paused && !(ctx.game && ctx.game.paused)) this._play += dt;
    if (this.upgradeStage === 'none' && this._play > 150) this.offerLodestone();
    if (this.isOpen && this.upgradeStage === 'offer' && !this.typing && inp && (inp.pressed('Enter') || inp.pressed('KeyE') || inp.pressed('KeyI'))) this.installLodestone();
    // battery: drains faster while the screen is on
    this.battery = Math.max(3, this.battery - dt * (this.isOpen ? 1 / 75 : 1 / 420));
    // status bar (cheap DOM writes only when values change)
    this._statT = (this._statT || 0) - dt;
    if (this._statT <= 0) {
      this._statT = 0.5;
      const t = ctx.clock.hhmm;
      if (this.el.time.textContent !== t) this.el.time.textContent = t;
      const bars = this.pos.signal;
      this.el.sig.forEach((b, i) => b.classList.toggle('on', i < bars));
      this.el.net.textContent = this.pos.net;
      this.el.net.classList.toggle('none', this.pos.noService);
      this.root.querySelector('.ph-sig').classList.toggle('none', this.pos.noService);
      const bt = Math.round(this.battery);
      if (this.el.batB.textContent !== String(bt)) { this.el.batB.textContent = bt; this.el.batI.style.width = `${bt}%`; }
      this.el.bat.classList.toggle('low', bt <= 20);
      if (this.isOpen) this.maps.tick();
    }
    // hand sway (walking bob + turning inertia)
    const p = ctx.player;
    if (this.sway) {
      this.wrap.style.setProperty('--sx', `${this.sway.x.toFixed(2)}px`); this.wrap.style.setProperty('--sy', `${this.sway.y.toFixed(2)}px`); this.wrap.style.setProperty('--sr', `${this.sway.r.toFixed(2)}deg`);
      this._swayOn = true;
    } else if (p) {
      if (this._swayOn) { this._swayOn = false; this.wrap.style.setProperty('--sr', '0deg'); }
      const sp = Math.min(1, (p.speed || 0) / 1.6);
      const ph = p.bobPhase || 0;
      const tx = Math.cos(ph) * 4 * sp, ty = Math.abs(Math.sin(ph)) * 5 * sp;
      const k = 1 - Math.exp(-dt * 8);
      this._sway.x += (tx - this._sway.x) * k; this._sway.y += (ty - this._sway.y) * k;
      this.wrap.style.setProperty('--sx', `${this._sway.x.toFixed(2)}px`);
      this.wrap.style.setProperty('--sy', `${this._sway.y.toFixed(2)}px`);
    }
    this.maps.update(dt, this.isOpen && this.app === 'maps');
    this.lodestone.update(dt, this.isOpen && this.app === 'lodestone');
    if (this.isOpen && this.app === 'transit') this.transit.update(dt);
  }
}
