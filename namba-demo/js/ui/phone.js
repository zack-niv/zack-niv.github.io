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
// v3: a dock (Messages · Maps · Lodestone once installed · Apps) at the bottom
// of the raised phone; Tab / Shift+Tab cycles apps while the phone is up; keys
// 1 / 2 / 3 answer Aya's reply chips (Messages, chips showing) or else jump to
// dock slot 1 / 2 / 3. Lodestone tracks your heading vs the route
// (ui/phone/track.js) and emits 'nav:track'. Full contract: notes/v3-phone.md.
//
// API (ctx.phone):
//   isOpen (= pose 'up'), app, open(app?), close(), toggle(), openApp(id) (emits 'phone:app' {app})
//   message({id, from, text, link?, replies?: [{id,text}], expectReply?})   a text (= emit 'phone:message')
//   showTyping(from, on) / 'phone:typing' {from, on}                      the "Aya is typing…" bubble
//   reply(i)          answer the pending text with chip i (0-based)  → 'phone:reply' {msgId, replyId, text}
//   pendingReply      the reply chips on screen ({msgId, from, replies}) or null
//   pose, setPose('up'|'glance'|'down'), pocket(bool)
//   pos            the phone's location belief {x,z,level,acc,heading,signal,noService}
//   handlesMessages = true (HUD skips its fallback banner)
//   search(q)      programmatic search (opens Maps)
//   --- demo upgrade (Lodestone) ---
//   offerLodestone()      Aya texts a link card (idempotent). v3: the phone never offers it by itself —
//                         the story decides when (no timer fallback any more)
//   installLodestone()    install (~1.8 s) -> calibration (~3 s) -> ready. Raises the phone.
//   positioningMode       'gps' | 'lodestone' (flips to 'lodestone' when stage 'ready' starts)
//   upgradeStage          'none' | 'offer' | 'installing' | 'calibrating' | 'ready'
//   stats()               live before/after numbers (see ui/phone/stats.js)
// Events: emits 'phone:pose' {pose, prev}, 'phone:open' / 'phone:close' {app},
//   'phone:search' {query,count}, 'phone:select' {id,kind,slot,key}, 'phone:route' {id,level},
//   'phone:arrive' {id}, 'phone:upgrade' {stage}, 'lodestone:arrive' {id}
//   'phone:app' {app, prev}, 'phone:reply' {msgId, replyId, text, from}, 'phone:stack' {open},
//   'nav:track' {state: 'on'|'drifting'|'off'|'rerouted', headingErr, lost}
//   v4 (notes/v4-phone.md): suggest(slotId|null), suggested, destination, setDestination(slotId), clearDestination();
//   'nav:destination' {slotId, name, app, suggested}, 'nav:arrived' {slotId, name, app}. Nothing routes until
//   the player picks from the "Where to?" list (both apps; 1–9 / ↑↓ Enter / click; / focuses the search box).
//   listens 'phone:message' {id?,from,text,time,link?,replies?}, 'phone:typing' {from,on}, 'quest:update', 'demo:arrive'
// =============================================================================
import { Positioning } from './phone/positioning.js?v=5f764cf';
import { MapApp } from './phone/mapapp.js?v=5f764cf';
import { HomeApp, NotesApp, MessagesApp, TransitApp } from './phone/apps.js?v=5f764cf';
import { LodestoneApp } from './phone/lodestone.js?v=5f764cf';
import { PhoneStats } from './phone/stats.js?v=5f764cf';
import { Glance } from './phone/glance.js?v=5f764cf';
import { buzzSound } from './phone/track.js?v=5f764cf';
import { Destinations, DEST_KEYS } from './phone/destinations.js?v=5f764cf';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const lerp = (a, b, t) => a + (b - a) * t;

// pose geometry (device units: the phone is 340 x 700)
const GLANCE_H = 126;          // how much of the phone's top shows in the glance pose (device px)
const GLANCE_S = 0.97;         // scale vs. the raised phone (held a touch further away)
const WALK_LOWER_S = 3.5;      // seconds of walking with the phone up before it lowers itself

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
    // the final key bindings (for Story's hints): see notes/v3-phone.md
    this.keys = { raise: 'Q', lower: 'Q', apps: 'Tab', reply: ['1', '2', '3'], appSlots: ['1', '2', '3'], stack: 'V', install: 'Enter', pick: DEST_KEYS, search: '/', endRoute: 'X', openLink: 'Enter' };
    this.battery = 64;
    this.typing = false;
    this.upgradeStage = 'none';
    this.sway = null;          // override while Lodestone calibrates (figure-of-8 wave)
    this._scale = 1;
    this._play = 0;            // seconds of play
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
  stats() {
    const s = this._stats ? this._stats.summary() : {};
    if (this.dest) { s.legs = this.dest.legStats(); s.destination = this.destination; }
    return s;
  }
  // ---- v4 destinations API (Story) — notes/v4-phone.md ------------------------
  suggest(slotId) { return this.dest ? this.dest.suggest(slotId || null) : false; }
  get suggested() { return this.dest ? this.dest.suggested : null; }
  get destination() {
    const C = this.dest && this.dest.current;
    return C ? { slotId: C.slotId, name: C.name, level: C.level, app: C.app, suggested: !!C.suggested, arrived: !!C.arrived } : null;
  }
  setDestination(slotId, opts) { return this.dest ? this.dest.set(slotId, opts || {}) : false; }
  clearDestination() { this.dest && this.dest.clear(); }
  // ---- v5 (notes/v5-nav.md) -----------------------------------------------------
  // the next thing to expect on the active route: { kind, dir, toLevel, dist, name, side, level, x, z, app, pass? } | null
  get nextMilestone() {
    if (this.upgradeStage === 'ready' && this.lodestone && this.lodestone.state === 'ready') return this.lodestone.milestone();
    return this.maps && this.maps.milestone ? this.maps.milestone() : null;
  }
  // End route (× / End / key X), same in both apps: no destination, calm "No route · Where to?", 'nav:end'
  endRoute(app) {
    const C = this.dest && this.dest.current; if (!C || C.arrived) return false;
    app = app || (this.app === 'lodestone' || this.app === 'maps' ? this.app : this.upgradeStage === 'ready' ? 'lodestone' : 'maps');
    this._ended = true;
    this.dest.clear();
    this.ctx.events.emit('nav:end', { app, slotId: C.slotId, name: C.name });
    this.ctx.audio && this.ctx.audio.play && this.ctx.audio.play('ui_close');
    return true;
  }
  // New destination at any time (key /, the search pill): the app's "Where to?" with the search box focused
  newDestination() {
    const a = this.app === 'maps' ? this.maps : this.app === 'lodestone' ? this.lodestone : null;
    if (!a) return false;
    if (a === this.lodestone && this.lodestone.state === 'ready' && !this.lodestone.picking) this.lodestone.choose(true);
    return !!(a.focusSearch && a.focusSearch());
  }
  // a place link in a text (item 5): open the active nav app on that place's card (Go = pick it)
  openPlace(id) {
    if (!id || !this.dest || !this.dest.resolve(id)) return false;
    this._lastPhoneInput = this._now;
    const ld = this.upgradeStage === 'ready' && this.lodestone.state === 'ready';
    this.open(ld ? 'lodestone' : 'maps');
    if (ld) this.lodestone.preview(id); else this.maps.preview(id);
    this.ctx.events.emit('phone:link', { id, app: ld ? 'lodestone' : 'maps' });
    return true;
  }
  // opts (optional): { text, from, id, replies } — Aya's own line for the link card
  offerLodestone(opts) {
    if (this.upgradeStage !== 'none') return false;
    const o = opts && typeof opts === 'object' ? opts : {};
    this.ctx.events.emit('phone:message', { id: o.id || 'aya_lodestone', from: o.from || 'Aya', text: o.text || 'you’re lost aren’t you 😂 install Lodestone — it actually works indoors', link: 'lodestone', replies: o.replies });
    return true;
  }
  // ---- v3 messages API (Story) ------------------------------------------------
  message(m) { if (m && m.text) this.ctx.events.emit('phone:message', m); }
  showTyping(from, on = true) { this.ctx.events.emit('phone:typing', { from: from || 'Aya', on: !!on }); }
  reply(i) { return this.messages ? this.messages.reply(i) : false; }
  get pendingReply() { return this.messages ? this.messages.pending : null; }
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
      const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'css/phone.css?v=5f764cf'; l.dataset.namba = 'phone-css';
      document.head.appendChild(l);
    }
    this.lowQ = ctx.engine && ctx.engine.qualityName === 'low';
    this.pos = new Positioning(ctx);
    this._stats = new PhoneStats(this);
    this.dest = new Destinations(this);
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
    // v4: the destination lists' keys (1–9, ↑ ↓, Enter, /) — captured before the game sees them (no walking on ↑ ↓)
    addEventListener('keydown', (e) => this._listKey(e), true);
    ctx.events.on('nav:destination', () => { this._ended = false; });
  }

  // the "Where to?" list on screen right now (Maps / Lodestone, phone up), or null
  _activeList() {
    if (!this.isOpen || this._held) return null;
    const a = this.app === 'maps' ? this.maps : this.app === 'lodestone' ? this.lodestone : null;
    return a && a.activeList ? a.activeList() : null;
  }
  _listKey(e) {
    if (!this.ctx.started || !this._canUse()) return;
    const t = e.target; if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const eat = () => { e.preventDefault(); e.stopPropagation(); this._lastPhoneInput = this._now; };
    // v5: the same route keys in both apps (phone up, not held): X ends the route, / = new destination (search)
    if (this.isOpen && !this._held && (this.app === 'maps' || this.app === 'lodestone') && !e.repeat) {
      if (e.code === 'KeyX') { const a = this.app === 'maps' ? this.maps : this.lodestone; if (a.closePreview && a.closePreview()) return eat(); if (this.endRoute(this.app)) return eat(); }
      if (e.code === 'Slash') { if (this.newDestination()) eat(); return; }
    }
    // v5: Enter on Messages opens the newest place link (when no Lodestone offer is waiting for Enter)
    if (this.isOpen && !this._held && this.app === 'messages' && (e.code === 'Enter' || e.code === 'NumpadEnter') && !e.repeat && this.upgradeStage !== 'offer') {
      const id = this.messages && this.messages.lastPlace; if (id && this.openPlace(id)) return eat();
    }
    const L = this._activeList(); if (!L) return;
    const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
    if (m) {
      if (e.repeat) return eat();
      const i = +m[1] - 1; if (i >= L.items.length) return;          // beyond the list: the v3 dock slot
      eat();
      if (this._now - (this._appAt || -1e9) < 0.35) return;           // just switched app: no accidental pick
      L.pick(i); return;
    }
    if (L.chip) return;                                                // the "Next" chip: only its number (arrows still walk)
    if (e.code === 'ArrowDown' || e.code === 'ArrowUp') { eat(); L.move(e.code === 'ArrowDown' ? 1 : -1); return; }
    if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !e.repeat) {
      if (this.upgradeStage === 'offer' && !L.armed) return;          // Enter still installs Lodestone while it is offered
      eat(); L.pick(L.sel); return;
    }
    if (e.code === 'Slash' && !e.repeat) { const a = this.app === 'maps' ? this.maps : this.lodestone; if (a.focusSearch && a.focusSearch()) eat(); }
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
            <nav class="ph-dock" aria-label="Apps">
              <button data-app="messages"><i class="ph-d-ic ic-msg"><b class="ph-d-badge" hidden></b></i><span>Messages</span></button>
              <button data-app="maps"><i class="ph-d-ic ic-maps"></i><span>Maps</span></button>
              <button data-app="lodestone" hidden><i class="ph-d-ic ic-lode"><svg viewBox="0 0 32 32"><path d="M16 4 21 16 16 28 11 16Z" fill="#10192b" stroke="#ffb02e" stroke-width="1.8" stroke-linejoin="round"/><path d="M16 4 21 16H16Z" fill="#ffb02e"/><circle cx="16" cy="16" r="2" fill="#fff"/></svg></i><span>Lodestone</span></button>
              <button data-app="home"><i class="ph-d-ic ic-apps"><u></u><u></u><u></u><u></u></i><span>Apps</span></button>
              <kbd class="ph-d-k">Tab</kbd>
            </nav>
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
      dock: r.querySelector('.ph-dock'), screen: r.querySelector('.ph-screen'),
    };
    this.el.dock.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { this._lastPhoneInput = this._now; this._showApp(b.dataset.app); }));
    if (this.ctx.input && this.ctx.input.touch) this.el.dock.querySelector('.ph-d-k').remove();
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
    this._badges();
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
    this._badges();
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
    const prev = this.app;
    this.app = id;
    for (const k in this.views) this.views[k].classList.toggle('on', k === id);
    this.el.screen.dataset.app = id;
    this.el.dock.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.app === id));
    const a = this.apps && this.apps[id];
    if (a && a.onShow) a.onShow();
    this._badges();
    if (prev !== id && this.apps) {
      this._appAt = this._now;
      if (id === 'messages' && this.el.notif) this.el.notif.hidden = true;
      this.ctx.events.emit('phone:app', { app: id, prev });
    }
  }
  // the dock's apps in order (Lodestone only once it is installed)
  _dockApps() { return ['messages', 'maps'].concat(this.upgradeStage === 'ready' ? ['lodestone'] : []); }
  _cycleApp(dir) {
    const L = this._dockApps(); let i = L.indexOf(this.app);
    i = i < 0 ? (dir > 0 ? 0 : L.length - 1) : (i + dir + L.length) % L.length;
    this._showApp(L[i]);
  }
  // Lodestone joins the dock once it is installed (with a small arrival glow)
  _dockAddLodestone() {
    const b = this.el.dock.querySelector('[data-app="lodestone"]');
    if (!b || !b.hidden) return;
    b.hidden = false; b.classList.add('new');
    setTimeout(() => b.classList.remove('new'), 4200);
  }
  // unread badges: home screen + dock (a reply waiting counts as 1 while you are not looking at the thread)
  _badges() {
    const M = this.messages; if (!M) return;
    const n = M.unread || (M.pending && !(this.isOpen && this.app === 'messages') ? 1 : 0);
    this.home && this.home.badge('messages', n);
    const b = this.el.dock.querySelector('.ph-d-badge');
    if (b) { b.hidden = !n; b.textContent = n; }
  }

  // in-phone notification banner (or, with the phone lowered, in the glance card)
  notify(app, msg) {
    if (app === 'messages' && msg) {
      this.ctx.audio && this.ctx.audio.play && this.ctx.audio.play('phone_buzz');
      this._notifApp = app;
      const html = `<i class="ph-n-ic ic-msg"></i><div><b>${esc(msg.title)}</b><span>${msg.reply ? 'tap to reply' : 'now'}</span><p>${esc(msg.text)}</p></div>`;
      if (this.isOpen && this.app !== 'messages') {
        this.el.notif.innerHTML = html; this.el.notif.hidden = false;
        clearTimeout(this._nT); this._nT = setTimeout(() => { this.el.notif.hidden = true; }, 5000);
      } else if (!this.isOpen) {
        this.glance.showNote(msg);
      }
      this._badges();
    }
    if (app === 'notes') this.home && this.home.badge('notes', '!');
  }
  // a short vibration (Lodestone off-route): the device rattles, the glance card flashes, a soft buzz
  vibrate() {
    this._buzzT = 0.62;
    const isl = this.el.isl; isl.classList.remove('buzz'); void isl.offsetWidth; isl.classList.add('buzz');
    clearTimeout(this._bzT); this._bzT = setTimeout(() => isl.classList.remove('buzz'), 900);
    buzzSound(this.ctx);
    try { const inp = this.ctx.input; if (inp && inp.touch && navigator.vibrate && navigator.userActivation && navigator.userActivation.hasBeenActive) navigator.vibrate([70, 60, 70]); } catch (e) { /* ignore */ }
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
    // while the phone is up: Tab / Shift+Tab cycles the apps (instead of lowering it), 1/2/3 reply or switch apps
    let tabbed = false;
    if (this.isOpen && !this.typing && inp && this._canUse()) {
      if (inp.pressed('Tab')) {
        tabbed = true; this._lastPhoneInput = this._now;          // (never lowers the phone; ignored during the install)
        if (!this._busyUpgrade()) this._cycleApp(inp.down && (inp.down('ShiftLeft') || inp.down('ShiftRight')) ? -1 : 1);
      }
      for (let k = 0; k < 3; k++) {
        if (!(inp.pressed('Digit' + (k + 1)) || inp.pressed('Numpad' + (k + 1)))) continue;
        this._lastPhoneInput = this._now;
        // chips on screen answer; otherwise the number is a dock slot (a short guard after a switch: no accidental reply)
        if (this.app === 'messages' && this.messages.pending && this._now - (this._appAt || -1e9) > 0.35) this.messages.reply(k);
        else if (!this._busyUpgrade()) { const L = this._dockApps(); if (L[k]) this._showApp(L[k]); }
        break;
      }
    }
    const pressed = inp && (typeof inp.action === 'function' ? inp.action('phone') : (inp.pressed('KeyQ') || inp.pressed('Tab')));
    if (pressed && !tabbed && this._canUse()) {
      this._lastPhoneInput = this._now;
      const M = this.messages;
      if (this.isOpen && this._held) { this._held = false; this._unlockForUse(); }          // Q while holding: keep it up, free the cursor
      else if (!this.isOpen && (this.glance.note || (M.pending && M.unread > 0))) { this.open('messages'); this._openTo = null; }
      else this.toggle();
    }
    // V: expand / collapse Lodestone's 3D stack while the phone is up
    if (this.isOpen && !this.typing && inp && inp.pressed('KeyV') && this.app === 'lodestone') this.lodestone.toggleStack();
    this.pos.update(dt);
    this._stats.update(dt);
    this.dest.update(dt);
    // the upgrade: keyboard (Enter / E while the offer is on screen). v3: no timer fallback — Story calls offerLodestone()
    if (ctx.started && !ctx.paused && !(ctx.game && ctx.game.paused)) this._play += dt;
    this.messages.update(dt);
    if (this.el.screen.dataset.stage !== this.upgradeStage) this.el.screen.dataset.stage = this.upgradeStage;   // (the dock hides during install / calibration)
    if (this._buzzT > 0) { this._buzzT -= dt; this._poseDirty = true; }
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
    this.lodestone.update(dt, this.isOpen && this.app === 'lodestone', this.pose === 'glance', this.pose !== 'down');
    if (this.isOpen && this.app === 'transit') this.transit.update(dt);
    this.glance.update(dt, this.pose === 'glance');
    // v5: Maps' milestone changes ('nav:milestone'; Lodestone emits its own from its route tick)
    this._msT = (this._msT || 0) - dt;
    if (this._msT <= 0 && this.upgradeStage !== 'ready' && this.maps.milestone) {
      this._msT = 0.5;
      const m = this.maps.milestone(), key = m ? [m.kind, m.dir, m.toLevel, m.name || ''].join('|') : '';
      if (key !== this._msKey) { this._msKey = key; if (m) ctx.events.emit('nav:milestone', m); }
    }
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
    if (this._buzzT > 0) {                                            // vibration: a fast small rattle of the whole device
      const k = Math.min(1, this._buzzT / 0.12), on = Math.sin(this._buzzT * 30) > -0.3 ? 1 : 0.25;  // two short pulses
      bx += Math.sin(this._now * 170) * 2.6 * k * on; br += Math.sin(this._now * 150 + 1) * 0.9 * k * on;
    }
    const moving = Math.abs(bx) + Math.abs(by) > 0.05 || this.sway || this._buzzT > 0;
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
