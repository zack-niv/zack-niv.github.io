// =============================================================================
// The player's phone — a DOM overlay in #phone-root, held in the right hand.
//
// Poses (v2, "realistic raise / lower"):
//   'glance'  default while playing: the phone is held low at the bottom-right
//             edge; only its top shows, where the Dynamic-Island-style card
//             (ui/phone/glance.js) carries the next step (Lodestone) or the
//             vague Maps hint, and Aya's texts.
//   'up'      full view. Q / Tab / M / pad Y / touch button toggles it (the
//             cursor is freed to tap the screen); holding the RIGHT mouse
//             button raises it while held (mouse-look keeps working).
//             Raised, it lowers itself when you run, or after ~4.5 s of
//             walking. The motion is a spring: lift, tilt toward you, settle.
//   'down'    pocketed: before the game starts, paused, intro, end card, or
//             forced by pocket(true).
// Apps: Maps (generic indoor map — ui/phone/mapapp.js), Lodestone (the
// upgrade), Messages (Aya), Notes, Transit, home screen.
//
// API (ctx.phone):
//   isOpen (= pose 'up'), app, open(app?), close(), toggle(), openApp(id)
//   pose, setPose('up'|'glance'|'down'), pocket(bool)
//   pos            the phone's location belief {x,z,level,acc,heading,signal,noService}
//   handlesMessages = true (HUD skips its fallback banner)
//   search(q)      programmatic search (opens Maps)
//   --- demo upgrade (Lodestone) ---
//   offerLodestone()      Aya texts a link card (idempotent). Fallback: the phone does it itself
//                         after ~150 s of play if the game never has
//   installLodestone()    install (~1.8 s) -> calibration (~3 s) -> ready. Raises the phone.
//   positioningMode       'gps' | 'lodestone' (flips to 'lodestone' when stage 'ready' starts)
//   upgradeStage          'none' | 'offer' | 'installing' | 'calibrating' | 'ready'
//   stats()               live before/after numbers (see ui/phone/stats.js)
// Events: emits 'phone:pose' {pose, prev}, 'phone:open' / 'phone:close' {app},
//   'phone:search' {query,count}, 'phone:select' {id,kind,slot,key}, 'phone:route' {id,level},
//   'phone:arrive' {id}, 'phone:upgrade' {stage}, 'lodestone:arrive' {id}
//   listens 'phone:message' {from,text,time,link?}, 'quest:update', 'demo:arrive'
// =============================================================================
import { Positioning } from './phone/positioning.js';
import { MapApp } from './phone/mapapp.js';
import { HomeApp, NotesApp, MessagesApp, TransitApp } from './phone/apps.js';
import { LodestoneApp } from './phone/lodestone.js';
import { PhoneStats } from './phone/stats.js';
import { Glance } from './phone/glance.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const lerp = (a, b, t) => a + (b - a) * t;

// pose geometry (device units: the phone is 340 x 700)
const GLANCE_H = 114;          // how much of the phone's top shows in the glance pose (device px)
const GLANCE_S = 0.97;         // scale vs. the raised phone (held a touch further away)
const WALK_LOWER_S = 4.5;      // seconds of walking with the phone up before it lowers itself

// critically-ish damped spring step (semi-implicit Euler, sub-stepped)
function spring(s, target, dt, w, z) {
  let t = dt;
  while (t > 0) {
    const h = Math.min(t, 1 / 120); t -= h;
    s.v += (-(w * w) * (s.x - target) - 2 * z * w * s.v) * h;
    s.x += s.v * h;
  }
}

export class Phone {
  constructor(ctx) {
    this.ctx = ctx;
    this.isOpen = false;
    this.app = 'maps';
    this.handlesMessages = true;
    this.battery = 64;
    this.typing = false;
    this.upgradeStage = 'none';
    this.sway = null;          // override while Lodestone calibrates (figure-of-8 wave)
    this._scale = 1;
    this._play = 0;            // seconds of play (fallback offer timer)
    this.pose = 'down';
    this._pocket = false;      // forced down (pocket(true))
    this._held = false;        // raised by the right mouse button (pointer stays locked)
    this._walkUp = 0;          // seconds walked with the phone up
    this._upAt = 0;            // time the phone was raised (no auto-lower right away)
    this._lastPhoneInput = -1e9;
    // springs: raise (0 glance .. 1 up), tilt (lags: lift, then tilt, then settle), pocket (1 = down)
    this._sp = { u: { x: 0, v: 0 }, tilt: { x: 0, v: 0 }, d: { x: 1, v: 0 } };
    this._bob = { x: 0, y: 0 };
    this._now = 0;
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
    this.glance = new Glance(this, this.el.isl);
    this.apps = { home: this.home, maps: this.maps, notes: this.notes, messages: this.messages, transit: this.transit, lodestone: this.lodestone };
    this._showApp('maps');
    this._applyPose(0, true);
    // signage finishes its content in the background (never awaited here)
    if (ctx.signage && ctx.signage.start) ctx.signage.start();
    // a pointer lock grabbed by a click on the world lowers the phone (unless it is held up by the right button)
    document.addEventListener('pointerlockchange', () => { if (document.pointerLockElement && this.isOpen && !this._held && !this._locking) this.close(true); });
    this._bindHold();
  }

  // right mouse button: raise while held (pointer lock stays: you can keep looking around)
  _bindHold() {
    const inp = this.ctx.input;
    addEventListener('mousedown', (e) => {
      if (e.button !== 2 || !inp || !inp.locked || !this._canUse()) return;
      if (this.isOpen) return;                       // already up via Q: nothing to hold
      this._held = true; this._lastPhoneInput = this._now;
      this.open(null, true);
    });
    addEventListener('mouseup', (e) => { if (e.button === 2 && this._held) this._releaseHold(); });
    addEventListener('blur', () => { if (this._held) this._releaseHold(); });
    document.addEventListener('contextmenu', (e) => { if (inp && (inp.locked || this._held) && this.ctx.started) e.preventDefault(); });
  }
  _releaseHold() {
    if (!this._held) return;
    this._held = false;
    // the install / calibration keeps the phone up until it's done
    if (this._busyUpgrade()) { this._keepUpAfterHold = true; return; }
    this.close(true);
  }
  _busyUpgrade() { return this.upgradeStage === 'installing' || this.upgradeStage === 'calibrating'; }
  _canUse() { const g = this.ctx.game; return !this.typing && !(g && (g.busy || g.paused || g.titleUp || g.intro || g._endCard)) && !this._pocket; }

  _buildDom() {
    const r = this.root;
    r.innerHTML = `
      <div class="ph-wrap" data-pose="down">
        <div class="ph-device">
          <i class="ph-btn ph-btn-a"></i><i class="ph-btn ph-btn-b"></i><i class="ph-btn ph-btn-c"></i><i class="ph-btn ph-btn-d"></i>
          <div class="ph-screen">
            <div class="ph-status"><span class="ph-time">10:42</span>
              <span class="ph-right"><span class="ph-sig"><i></i><i></i><i></i><i></i></span><span class="ph-net">5G</span><span class="ph-bat"><i></i><b>64</b></span></span></div>
            <div class="ph-views">
              <div class="ph-view" data-v="home"></div><div class="ph-view" data-v="maps"></div><div class="ph-view" data-v="notes"></div>
              <div class="ph-view" data-v="messages"></div><div class="ph-view" data-v="transit"></div><div class="ph-view" data-v="lodestone"></div>
            </div>
            <div class="ph-notif" hidden></div>
            <div class="ph-toast" hidden></div>
            <div class="ph-homebar"><i></i></div>
            <div class="ph-isl"></div>
          </div>
          <div class="ph-glare"></div>
        </div>
      </div>
      <div class="ph-peek" hidden></div>`;
    this.wrap = r.querySelector('.ph-wrap');
    this.device = r.querySelector('.ph-device');
    this.views = {};
    r.querySelectorAll('.ph-view').forEach(v => { this.views[v.dataset.v] = v; });
    this.el = {
      time: r.querySelector('.ph-time'), sig: r.querySelectorAll('.ph-sig i'), net: r.querySelector('.ph-net'), bat: r.querySelector('.ph-bat'),
      batB: r.querySelector('.ph-bat b'), batI: r.querySelector('.ph-bat i'), notif: r.querySelector('.ph-notif'), toast: r.querySelector('.ph-toast'),
      peek: r.querySelector('.ph-peek'), isl: r.querySelector('.ph-isl'), sigBox: r.querySelector('.ph-sig'),
    };
    r.querySelector('.ph-homebar').addEventListener('click', () => this._showApp(this.app === 'home' ? (this.upgradeStage === 'ready' ? 'lodestone' : 'maps') : 'home'));
    this.el.notif.addEventListener('click', () => { this.el.notif.hidden = true; this.openApp(this._notifApp || 'messages'); });
    // the glance card is a button when the cursor is free (paused-less touch / unlocked mouse)
    this.el.isl.addEventListener('click', () => { if (this.pose === 'glance' && this._canUse()) this.open(this.glance.note ? 'messages' : null); });
    // pointer inside the phone never reaches the game
    for (const ev of ['pointerdown', 'mousedown', 'click', 'wheel', 'touchstart']) this.wrap.addEventListener(ev, e => e.stopPropagation(), { passive: true });
    // recent pointer use on the screen keeps it up while you walk (you are reading / dragging the map)
    for (const ev of ['pointerdown', 'pointermove', 'wheel']) this.wrap.addEventListener(ev, () => { if (this.isOpen) this._lastPointerT = this._now; }, { passive: true });
    this._layout();
    addEventListener('resize', () => this._layout());
  }

  _layout() {
    // scale the 340×700 device to the viewport (held low: the top ~85 % shows when up)
    const s = Math.max(0.55, Math.min(1.15, (innerHeight * 0.9) / 700, (innerWidth * 0.92) / 340));
    this._scale = s;
    this.wrap.style.setProperty('--s', s.toFixed(3));
    this._poseDirty = true;
  }

  // ------------------------------------------------------------------ API ---
  // open = raise to full view. hold: raised by the right mouse button (the pointer stays locked)
  open(app, hold) {
    if (app) this._showApp(app);
    if (this.isOpen) { if (!hold && this._held) { this._held = false; this._unlockForUse(); } return; }
    this.isOpen = true;
    this._upAt = this._now; this._walkUp = 0; this._raises = (this._raises || 0) + 1;
    this.wrap.classList.add('open');
    this.root.classList.add('ph-is-open');
    if (!hold) this._unlockForUse();
    this.maps._dirty = true;
    if (this.app === 'messages') this.messages.onShow();
    this.glance.clearNote(true);
    this.ctx.audio && this.ctx.audio.play && this.ctx.audio.play('ui_open');
    this.ctx.events.emit('phone:open', { app: this.app });
    this._setPose('up');
  }
  _unlockForUse() { try { this.ctx.input.exitLock(); } catch (e) { /* ignore */ } }
  close(fromLock) {
    if (!this.isOpen) return;
    const wasHeld = this._held;
    this.isOpen = false; this._held = false; this._keepUpAfterHold = false;
    this.wrap.classList.remove('open');
    this.root.classList.remove('ph-is-open');
    const a = document.activeElement; if (a && this.root.contains(a)) a.blur();
    this.typing = false;
    const g = this.ctx.game;
    // re-grab the mouse for looking (only with a live user gesture: an auto-lower without one would be refused)
    const act = !navigator.userActivation || navigator.userActivation.isActive;
    if (!fromLock && !wasHeld && act && !(g && (g.paused || g._endCard)) && !(this.ctx.input && this.ctx.input.locked)) {
      this._locking = true; try { this.ctx.input.requestLock(); } catch (e) { /* ignore */ } setTimeout(() => { this._locking = false; }, 300);
    }
    this.ctx.audio && this.ctx.audio.play && this.ctx.audio.play('ui_close');
    this.ctx.events.emit('phone:close', { app: this.app });
    this._setPose(this._wantDown() ? 'down' : 'glance');
  }
  toggle() { this.isOpen ? this.close() : this.open(); }
  openApp(id) { this.open(id); }
  search(q) { this.open('maps'); this.maps.input.value = q; this.maps.doSearch(q); }
  setPose(p) {
    if (p === 'up') this.open();
    else if (p === 'glance') { this._pocket = false; if (this.isOpen) this.close(); else this._setPose(this._wantDown() ? 'down' : 'glance'); }
    else if (p === 'down') this.pocket(true);
  }
  pocket(on) {
    this._pocket = !!on;
    if (on && this.isOpen) this.close(true);
    this._setPose(this.isOpen ? 'up' : this._wantDown() ? 'down' : 'glance');
  }
  _wantDown() {
    const { ctx } = this, g = ctx.game;
    return this._pocket || !ctx.started || !!(g && (g.titleUp || g.paused || g.intro || g._endCard));
  }
  _setPose(p) {
    if (p === this.pose) return;
    const prev = this.pose;
    this.pose = p;
    this.wrap.dataset.pose = p;
    this.root.classList.toggle('ph-glance', p === 'glance');
    this.el.peek.hidden = p !== 'glance';          // (game.css lifts the captions above the phone while this marker shows)
    if (p === 'glance') this.glance.refresh(true);
    this._poseDirty = true;
    this.ctx.events.emit('phone:pose', { pose: p, prev });
  }

  _showApp(id) {
    if (!this.views[id]) return;
    this.app = id;
    for (const k in this.views) this.views[k].classList.toggle('on', k === id);
    this.root.querySelector('.ph-screen').dataset.app = id;
    const a = this.apps && this.apps[id];
    if (a && a.onShow) a.onShow();
  }

  // in-phone notification banner (or, with the phone lowered, in the glance card)
  notify(app, msg) {
    if (app === 'messages' && msg) {
      this.ctx.audio && this.ctx.audio.play && this.ctx.audio.play('phone_buzz');
      this._notifApp = app;
      const html = `<i class="ph-n-ic ic-msg"></i><div><b>${esc(msg.title)}</b><span>now</span><p>${esc(msg.text)}</p></div>`;
      if (this.isOpen && this.app !== 'messages') {
        this.el.notif.innerHTML = html; this.el.notif.hidden = false;
        clearTimeout(this._nT); this._nT = setTimeout(() => { this.el.notif.hidden = true; }, 5000);
      } else if (!this.isOpen) {
        this.glance.showNote(msg);
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
    this._now += dt;
    const pressed = inp && (typeof inp.action === 'function' ? inp.action('phone') : (inp.pressed('KeyQ') || inp.pressed('Tab')));
    if (pressed && this._canUse()) {
      this._lastPhoneInput = this._now;
      if (this.isOpen && this._held) { this._held = false; this._unlockForUse(); }          // Q while holding: keep it up, free the cursor
      else if (!this.isOpen && this.glance.note) { this.open('messages'); this._openTo = null; }
      else this.toggle();
    }
    // V: expand / collapse Lodestone's 3D stack while the phone is up
    if (this.isOpen && !this.typing && inp && inp.pressed('KeyV') && this.app === 'lodestone') this.lodestone.toggleStack();
    this.pos.update(dt);
    this._stats.update(dt);
    // the upgrade: keyboard (Enter / E while the offer is on screen) and the 150 s fallback
    if (ctx.started && !ctx.paused && !(ctx.game && ctx.game.paused)) this._play += dt;
    if (this.upgradeStage === 'none' && this._play > 150) this.offerLodestone();
    if (this.isOpen && this.upgradeStage === 'offer' && !this.typing && inp && (inp.pressed('Enter') || inp.pressed('KeyE') || inp.pressed('KeyI'))) this.installLodestone();
    if (this._keepUpAfterHold && !this._busyUpgrade() && this._now - this._upAt > 1) { this._keepUpAfterHold = false; if (!this._held) this.close(true); }
    this._autoPose(dt);
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
      this.el.sigBox.classList.toggle('none', this.pos.noService);
      const bt = Math.round(this.battery);
      if (this.el.batB.textContent !== String(bt)) { this.el.batB.textContent = bt; this.el.batI.style.width = `${bt}%`; }
      this.el.bat.classList.toggle('low', bt <= 20);
      if (this.isOpen) this.maps.tick();
    }
    this._applyPose(dt);
    this.maps.update(dt, this.isOpen && this.app === 'maps');
    this.lodestone.update(dt, this.isOpen && this.app === 'lodestone', this.pose === 'glance');
    if (this.isOpen && this.app === 'transit') this.transit.update(dt);
    this.glance.update(dt, this.pose === 'glance');
  }

  // pocket / glance / auto-lower
  _autoPose(dt) {
    const { ctx } = this, p = ctx.player, inp = ctx.input;
    const down = this._wantDown();
    if (down && this.pose !== 'down') { if (this.isOpen) this.close(true); this._setPose('down'); return; }
    if (!down && this.pose === 'down' && !this.isOpen) this._setPose('glance');
    if (!this.isOpen) { this._walkUp = 0; return; }
    // raised: walking on lowers it to the glance pose (not during the install / calibration / reveal,
    // not while the cursor is busy in the phone)
    const sp = p ? (p.speed || 0) : 0;
    const moving = !!(inp && (Math.abs(inp.move.x) > 0.1 || Math.abs(inp.move.y) > 0.1)) && sp > 0.45;
    const running = moving && !!(inp && inp.jog) && sp > 1.3;
    const protectedUp = this._busyUpgrade() || (this.lodestone && this.lodestone.revealing) || this.typing || this._now - this._upAt < 1.2
      || this._now - (this._lastPointerT || -1e9) < 2.5;
    if (protectedUp) { this._walkUp = 0; return; }
    if (running) { this.close(); return; }
    if (this._held) { this._walkUp = 0; return; }                    // holding it up on purpose
    this._walkUp = moving ? this._walkUp + dt : Math.max(0, this._walkUp - dt * 2);
    if (this._walkUp > WALK_LOWER_S) this.close();
  }

  // the hand: spring-driven transform (lift, tilt, settle) + walking bob
  _applyPose(dt, snap) {
    const S = this._sp, pose = this.pose;
    const uT = pose === 'up' ? 1 : 0, dT = pose === 'down' ? 1 : 0;
    if (snap) { S.u.x = uT; S.tilt.x = uT; S.d.x = dT; S.u.v = S.tilt.v = S.d.v = 0; }
    else {
      spring(S.u, uT, dt, 13, 0.82);
      spring(S.tilt, uT, dt, uT ? 9.5 : 15, uT ? 0.5 : 0.9);      // tilts toward you a beat after the lift, with a small settle
      spring(S.d, dT, dt, 11, 1);
    }
    const settled = Math.abs(S.u.x - uT) < 1e-3 && Math.abs(S.u.v) < 1e-3 && Math.abs(S.tilt.x - uT) < 1e-3 && Math.abs(S.tilt.v) < 1e-3 && Math.abs(S.d.x - dT) < 1e-3 && Math.abs(S.d.v) < 1e-3;
    // walking bob / turning sway
    const p = this.ctx.player;
    let bx = 0, by = 0, br = 0;
    if (this.sway) { bx = this.sway.x; by = this.sway.y; br = this.sway.r; }
    else if (p) {
      const sp = Math.min(1, (p.speed || 0) / 1.6), ph = p.bobPhase || 0;
      const amp = S.u.x > 0.5 ? 1 : 1.6;                              // a lowered phone swings more
      const tx = Math.cos(ph) * 4 * sp * amp, ty = Math.abs(Math.sin(ph)) * 5 * sp * amp;
      const k = 1 - Math.exp(-(dt || 0) * 8);
      this._bob.x += (tx - this._bob.x) * k; this._bob.y += (ty - this._bob.y) * k;
      bx = this._bob.x; by = this._bob.y;
    }
    const moving = Math.abs(bx) + Math.abs(by) > 0.05 || this.sway;
    if (settled && !moving && !this._poseDirty && !snap) return;
    this._poseDirty = false;
    const vw = innerWidth, s = this._scale, sg = s * GLANCE_S;
    const u = S.u.x, tl = S.tilt.x, d = S.d.x;
    // up: just right of the crosshair (you can still see where you walk), bottom 35 px below the edge
    const uw = 340 * s, upCx = Math.max(uw / 2 + 8, Math.min(vw - uw / 2 - 16, vw / 2 + uw / 2 + 28)), upY = 35;
    // glance: bottom-right corner, only the top GLANCE_H shows
    const gw = 340 * sg, gCx = Math.min(vw - gw / 2 - 8, Math.max(vw * 0.62, vw - 36 - gw / 2)), gY = 700 * sg - GLANCE_H * sg;
    const sc = lerp(sg, s, u);
    const cx = lerp(gCx, upCx, u);
    let y = lerp(gY, upY, u);
    y += d * (GLANCE_H * sg + 60);                                    // pocketed: slides out of view
    const rz = lerp(3.2, -1.2, u) + br;
    const rx = lerp(9, 2.5, tl);                                      // tilted away a little when lowered
    const lift = Math.sin(Math.PI * Math.min(1, Math.max(0, u))) * -14; // a little arc on the way up
    this.wrap.style.transform = `translate3d(${(cx - 170 + bx).toFixed(1)}px, ${(y + by + lift).toFixed(1)}px, 0) scale(${sc.toFixed(4)}) rotate(${rz.toFixed(2)}deg)`;
    this.device.style.transform = `rotateX(${rx.toFixed(2)}deg)`;
    this.wrap.style.filter = u < 0.6 ? `brightness(${(0.88 + u * 0.2).toFixed(3)})` : '';
    // the glance strip's on-screen height (for HUD layout), 0 when not glancing
    const gh = pose === 'glance' ? Math.round(GLANCE_H * sg) : 0;
    if (gh !== this._gh) { this._gh = gh; document.documentElement.style.setProperty('--phone-glance-h', gh + 'px'); }
  }
}
