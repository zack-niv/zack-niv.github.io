// =============================================================================
// Input — keyboard, mouse (pointer lock, raw), gamepad (standard mapping) and
// touch (virtual stick + drag look + buttons). Owned by the movement area.
//
// What systems read each frame (main.js calls update() before systems and
// endFrame() after rendering):
//   input.move      {x, y}   x strafe (+right), y forward (+), analog -1..1
//   input.look      {x, y}   raw mouse pixels since last frame (no accel, no
//                            smoothing). Player turns by look * sensitivity.
//   input.lookRad   {x, y}   extra look in radians (gamepad / touch), already
//                            scaled, sign: +x turns right, +y looks down
//   input.jog / input.running   brisk walk (Shift, L3, touch stick pushed past its ring, touch Run toggle)
//   input.slow                  browse walk (C toggles, Alt holds, LB)
//   input.shuffle               fine shuffle (hold C for > 0.35 s): queues, counters
//   input.down(code) / input.pressed(code)   raw keys (KeyboardEvent.code)
//   input.action(name)          edge-triggered: 'interact' (E / A / touch),
//                               'phone' (Q / Tab / Y / touch), 'menu' (Esc / Start)
//   input.device                'kbm' | 'gamepad' | 'touch' (last used)
//   input.touch                 touch device (coarse pointer, or a touch landed on the canvas); see _touchSetup
//   input.tap(action) / input.runLatch / input.onTouchMode(fn)   on-screen buttons (js/ui/touch.js), v11
//   input.settings              persisted user settings (see DEFAULTS)
//   input.set(key, value)       change + persist a setting, notifies listeners
//   input.onSettings(fn)        subscribe to settings changes
//   input.setScript({x,y,jog,slow}) / setScript(null)
//                               deterministic override for tests & cutscenes
// =============================================================================

export const DEFAULTS = {
  sensitivity: 1.0,     // multiplier on BASE_SENS rad/px (mouse)
  invertY: false,
  headBob: 1.0,         // 0..1.5 head-bob intensity
  reduceMotion: false,  // accessibility: kills roll, FOV kick, most bob/sway
  fov: 72,              // vertical FOV in degrees
  touchLookSmoothing: true,
  touchSensitivity: 1.0,
  padSensitivity: 1.0,
  slowToggle: true,     // C toggles browse walk (Alt is always hold)
};
const BASE_SENS = 0.0022;          // rad per mouse count at sensitivity 1
const STORE_KEY = 'namba.settings.v1';

function loadSettings() {
  const s = { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) { const o = JSON.parse(raw); for (const k in DEFAULTS) if (o[k] !== undefined && typeof o[k] === typeof DEFAULTS[k]) s[k] = o[k]; }
  } catch (e) { /* storage blocked: defaults */ }
  try { if (matchMedia('(prefers-reduced-motion: reduce)').matches && !localStorage.getItem(STORE_KEY)) s.reduceMotion = true; } catch (e) {}
  return s;
}

const ACTION_KEYS = {
  interact: ['KeyE', 'Enter'],
  phone: ['KeyQ', 'Tab', 'KeyM'],
  menu: ['Escape'],
};

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this._pressed = new Set();
    this._actions = new Set();
    this.look = { x: 0, y: 0 };
    this.lookRad = { x: 0, y: 0 };
    this.move = { x: 0, y: 0 };
    this.jog = false; this.slow = false; this.shuffle = false;
    this._cDown = 0;
    this._slowLatch = false;
    this.locked = false;
    this.enabled = true;
    this.device = 'kbm';
    this.touch = (() => { try { return matchMedia('(pointer: coarse)').matches; } catch (e) { return false; } })();
    this.touchOnly = this.touch && (() => { try { return !matchMedia('(any-pointer: fine)').matches; } catch (e) { return true; } })();
    this.settings = loadSettings();
    this._listeners = new Set();
    this._script = null;
    this._lastT = performance.now();
    this._pad = { index: -1, prevButtons: [], jogLatch: false };
    this._touchLookPending = { x: 0, y: 0 };

    const typing = e => { const t = e.target; return !!(t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))); };
    addEventListener('keydown', e => {
      if (e.repeat || typing(e)) return;
      this.device = 'kbm';
      this.keys.add(e.code); this._pressed.add(e.code);
      for (const a in ACTION_KEYS) if (ACTION_KEYS[a].includes(e.code)) this._actions.add(a);
      if (e.code === 'KeyC') { this._cDown = performance.now(); if (this.settings.slowToggle) this._slowLatch = !this._slowLatch; }
      // keep the page from scrolling / focus-hopping / opening menus while playing
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'AltLeft', 'AltRight'].includes(e.code)) e.preventDefault();
      if ((e.ctrlKey || e.metaKey) && this.locked && ['KeyW', 'KeyS', 'KeyD', 'KeyA'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', e => {
      // C held past a tap was a shuffle, not a browse toggle: undo the toggle
      if (e.code === 'KeyC' && this._cDown && performance.now() - this._cDown > 350 && this.settings.slowToggle) this._slowLatch = !this._slowLatch;
      if (e.code === 'KeyC') this._cDown = 0;
      this.keys.delete(e.code); if (e.code === 'AltLeft' || e.code === 'AltRight') e.preventDefault(); });
    addEventListener('blur', () => { this.keys.clear(); this._cDown = 0; });
    addEventListener('mousemove', e => {
      if (!this.locked || !this.enabled) return;
      const dx = e.movementX || 0, dy = e.movementY || 0;
      // Chrome occasionally reports a single bogus huge jump under pointer
      // lock; real flicks arrive as many small events, so drop absurd ones.
      if (Math.abs(dx) > 600 || Math.abs(dy) > 600) return;
      this.device = 'kbm';
      this.look.x += dx; this.look.y += dy;
    });
    addEventListener('mousedown', e => { this._pressed.add('Mouse' + e.button); if (!this.touchOnly && !(e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents)) this.device = 'kbm'; });
    // (keys are NOT cleared on lock loss: opening the phone drops pointer lock and
    // you should keep walking while you glance at it; blur still clears them)
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; });
    addEventListener('gamepadconnected', e => { if (this._pad.index < 0) this._pad.index = e.gamepad.index; });
    addEventListener('gamepaddisconnected', e => { if (this._pad.index === e.gamepad.index) this._pad.index = -1; });
    this._touchSetup();
  }

  // ---- settings -------------------------------------------------------------
  get sensitivity() { return BASE_SENS * this.settings.sensitivity; }
  // game settings panel assigns rad/px directly (ctx.input.sensitivity = 0.0022 * s)
  set sensitivity(v) { if (v > 0 && isFinite(v)) this.settings.sensitivity = v / BASE_SENS; }
  set(key, value) {
    if (!(key in DEFAULTS)) return;
    this.settings[key] = value;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.settings)); } catch (e) {}
    for (const f of this._listeners) { try { f(key, value, this.settings); } catch (e) { console.error(e); } }
  }
  onSettings(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
  resetSettings() { for (const k in DEFAULTS) this.set(k, DEFAULTS[k]); }

  // ---- pointer lock ---------------------------------------------------------
  requestLock() {
    // a phone / tablet never locks; a touch laptop locks again as soon as the mouse is the thing in use
    if ((this.touch && (this.touchOnly || this.device === 'touch')) || !this.canvas.requestPointerLock) return;
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => { try { this.canvas.requestPointerLock(); } catch (e) {} });
    } catch (e) { try { this.canvas.requestPointerLock(); } catch (e2) {} }
  }
  exitLock() { if (document.exitPointerLock) document.exitPointerLock(); }

  down(code) { return this.enabled && this.keys.has(code); }
  pressed(code) { return this.enabled && this._pressed.has(code); }
  action(name) { return this.enabled && this._actions.has(name); }
  get running() { return this.jog; } // legacy name
  setScript(s) { this._script = s ? { x: 0, y: 0, jog: false, slow: false, ...s } : null; }

  endFrame() {
    this._pressed.clear(); this._actions.clear();
    this.look.x = 0; this.look.y = 0; this.lookRad.x = 0; this.lookRad.y = 0;
  }

  update() {
    const now = performance.now();
    const dt = Math.min(0.1, Math.max(0, (now - this._lastT) / 1000)); this._lastT = now;
    if (this._script) {
      const s = this._script;
      this.move.x = s.x; this.move.y = s.y; this.jog = !!s.jog; this.slow = !!s.slow; this.shuffle = !!s.shuffle;
      return;
    }
    let x = 0, y = 0;
    if (this.down('KeyW') || this.down('ArrowUp')) y += 1;
    if (this.down('KeyS') || this.down('ArrowDown')) y -= 1;
    if (this.down('KeyA') || this.down('ArrowLeft')) x -= 1;
    if (this.down('KeyD') || this.down('ArrowRight')) x += 1;
    const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
    let jog = this.down('ShiftLeft') || this.down('ShiftRight');
    // browse walk: C toggles, Alt holds. (Ctrl is deliberately NOT bound:
    // Ctrl+W closes the browser tab and cannot be intercepted.)
    let slow = this.down('AltLeft') || this.down('AltRight') || this._slowLatch;
    // touch stick overrides keyboard while active
    if (this._stick.active) {
      x = this._stick.vx; y = this._stick.vy;
      jog = this._stick.jog || (this.runLatch && Math.hypot(x, y) > 0.2);
    }
    // the Run toggle switches itself off once you stop (like mobile FPS sprint locks)
    if (this.runLatch) { this._runIdle = this._stick.active && Math.hypot(x, y) > 0.2 ? 0 : this._runIdle + dt; if (this._runIdle > 1.5) this.runLatch = false; }
    // gamepad
    const pad = this._pollPad(dt);
    if (pad && (Math.abs(pad.x) > 0 || Math.abs(pad.y) > 0)) { x = pad.x; y = pad.y; }
    if (pad) { jog = jog || pad.jog; slow = slow || pad.slow; }
    if (!this.enabled) { x = 0; y = 0; }
    this.move.x = x; this.move.y = y;
    this.shuffle = !this._script && this.down('KeyC') && this._cDown > 0 && performance.now() - this._cDown > 350 && !jog;
    this.jog = jog;
    this.slow = slow && !jog;
    if (this.jog && this._slowLatch && (x || y)) this._slowLatch = false; // jogging cancels browse
    // touch look release (optional smoothing: ~35 ms exponential)
    const p = this._touchLookPending;
    if (p.x || p.y) {
      const k = this.settings.touchLookSmoothing ? 1 - Math.exp(-dt / 0.035) : 1;
      const ex = p.x * k, ey = p.y * k;
      this.lookRad.x += ex; this.lookRad.y += ey; p.x -= ex; p.y -= ey;
      if (Math.abs(p.x) < 1e-5) p.x = 0; if (Math.abs(p.y) < 1e-5) p.y = 0;
    }
  }

  // ---- gamepad (standard mapping) -------------------------------------------
  _pollPad(dt) {
    if (!navigator.getGamepads) return null;
    let gp = null;
    try {
      const pads = navigator.getGamepads();
      gp = this._pad.index >= 0 ? pads[this._pad.index] : null;
      if (!gp) for (const g of pads) if (g && g.connected) { gp = g; this._pad.index = g.index; break; }
    } catch (e) { return null; }
    if (!gp) return null;
    const dz = (ax, ay, d) => {
      const m = Math.hypot(ax, ay);
      if (m < d) return [0, 0];
      const k = Math.min(1, (m - d) / (1 - d)) / m;
      return [ax * k, ay * k];
    };
    const B = gp.buttons.map(b => b && (b.pressed || b.value > 0.5));
    const prev = this._pad.prevButtons;
    const edge = i => B[i] && !prev[i];
    const [mx, my] = dz(gp.axes[0] || 0, gp.axes[1] || 0, 0.16);
    const [rx, ry] = dz(gp.axes[2] || 0, gp.axes[3] || 0, 0.12);
    const any = mx || my || rx || ry || B.some(Boolean);
    if (any) this.device = 'gamepad';
    if (!rx && !ry) this._pad.fullT = 0;
    if (rx || ry) {
      // response curve (quadratic-ish) — analog sticks need one, mice don't
      const m = Math.hypot(rx, ry), c = Math.pow(m, 1.8) / m;
      // holding the stick fully over for a moment speeds the turn up (180° in a corridor shouldn't take 1.1 s)
      this._pad.fullT = m > 0.92 ? (this._pad.fullT || 0) + dt : 0;
      const ramp = 1 + Math.min(1, Math.max(0, (this._pad.fullT - 0.4) / 0.4));
      const rate = 2.8 * this.settings.padSensitivity * ramp; // rad/s at full tilt
      this.lookRad.x += rx * c * rate * dt;
      this.lookRad.y += ry * c * rate * 0.75 * dt;
    }
    if (edge(10)) this._pad.jogLatch = !this._pad.jogLatch;      // L3 toggles jog
    if (!mx && !my) this._pad.jogLatch = false;
    if (edge(0)) { this._actions.add('interact'); this._pressed.add('KeyE'); }
    if (edge(3)) { this._actions.add('phone'); this._pressed.add('KeyQ'); }
    if (edge(9)) { this._actions.add('menu'); this._pressed.add('Escape'); }
    this._pad.prevButtons = B;
    return { x: mx, y: -my, jog: this._pad.jogLatch || !!B[7] && (gp.buttons[7].value > 0.5), slow: !!B[4] };
  }

  // ---- touch (v11): left = floating stick, right = drag look ------------------
  // Mobile-FPS conventions (CoD Mobile / PUBG / Genshin): the stick appears where the left thumb lands (anywhere in
  // the left ~42 % of the screen) and its base follows a thumb that drifts far past the ring; pushing well past the
  // ring (or the Run toggle) hurries. Any touch that starts elsewhere on the canvas steers the view: a fixed rate per
  // CSS pixel (vertical a little slower), light smoothing, and a gentle boost for fast flicks so a corridor 180° is
  // one swipe. On-screen buttons (js/ui/touch.js) are DOM elements above the canvas and call tap().
  //   tap(action)      'interact' (also pressed('KeyE')) | 'phone' (KeyQ) | 'menu' (Escape)
  //   runLatch         the Run toggle; cleared after ~1.5 s without stick input
  //   stickZone        fraction of the width that spawns the stick (0.42)
  //   onTouchMode(fn)  called once when the device turns out to be touch (first touch on a fine-pointer device)
  tap(action) {
    const code = { interact: 'KeyE', phone: 'KeyQ', menu: 'Escape' }[action];
    this.device = 'touch';
    this._actions.add(action); if (code) this._pressed.add(code);
  }
  onTouchMode(fn) { if (this.touch) { try { fn(); } catch (e) { console.error(e); } } else this._touchModeFns.push(fn); }
  _setTouchMode() {
    if (this._touchModeOn) return;
    this._touchModeOn = true; this.touch = true;
    for (const f of this._touchModeFns.splice(0)) { try { f(); } catch (e) { console.error(e); } }
  }
  _touchSetup() {
    this._stick = { active: false, id: null, ox: 0, oy: 0, vx: 0, vy: 0, jog: false, x: 0, y: 0 };
    this._lookT = { id: null, x: 0, y: 0, t: 0 };
    this._touchModeFns = [];
    this.runLatch = false; this._runIdle = 0;
    this.stickZone = 0.42;
    this.stickR = 56;                 // ring radius in CSS px (the knob travels this far)
    const c = this.canvas;
    let ui = null;
    const ensureUi = () => { if (!ui) ui = this._buildTouchUi(); return ui; };
    this._ensureTouchUi = ensureUi;
    if (this.touch) { this._touchModeOn = true; ensureUi(); }
    const R = () => this.stickR;
    const place = () => {
      if (!ui) return;
      const s = this._stick, r = R();
      ui.ring.style.transform = `translate(${(s.ox - r).toFixed(1)}px, ${(s.oy - r).toFixed(1)}px)`;
      ui.knob.style.transform = `translate(${(s.x - 22).toFixed(1)}px, ${(s.y - 22).toFixed(1)}px)`;
    };
    c.addEventListener('touchstart', e => {
      this.device = 'touch'; this._setTouchMode();
      const u = ensureUi();
      for (const t of e.changedTouches) {
        if (t.clientX < innerWidth * this.stickZone && this._stick.id === null) {
          // keep the whole ring on screen (a thumb landing on the very edge still gets a full stick)
          const r = R(), m = 8;
          const ox = Math.max(r + m, Math.min(innerWidth * this.stickZone, t.clientX));
          const oy = Math.max(r + m, Math.min(innerHeight - r - m, t.clientY));
          Object.assign(this._stick, { active: true, id: t.identifier, ox, oy, vx: 0, vy: 0, jog: false, x: t.clientX, y: t.clientY });
          this._stickMove(t.clientX, t.clientY);
          u.root.classList.add('stick-on');
          place();
        } else if (this._lookT.id === null) { Object.assign(this._lookT, { id: t.identifier, x: t.clientX, y: t.clientY, t: performance.now() }); }
      }
      if (e.cancelable) e.preventDefault();   // (a busy main thread can make touches uncancelable: no console noise)
    }, { passive: false });
    c.addEventListener('touchmove', e => {
      for (const t of e.changedTouches) {
        if (t.identifier === this._stick.id) {
          this._stickMove(t.clientX, t.clientY);
          if (ui) { place(); ui.root.classList.toggle('stick-jog', this._stick.jog || (this.runLatch && (this._stick.vx || this._stick.vy))); }
        } else if (t.identifier === this._lookT.id) {
          const L = this._lookT, now = performance.now();
          const dx = t.clientX - L.x, dy = t.clientY - L.y;
          const dts = Math.max(0.008, (now - L.t) / 1000);
          // gentle flick boost: 1x up to ~700 px/s, up to 1.8x at ~2000 px/s
          const v = Math.hypot(dx, dy) / dts, boost = 1 + 0.8 * Math.min(1, Math.max(0, (v - 700) / 1300));
          const s = 0.0052 * this.settings.touchSensitivity * boost;
          this._touchLookPending.x += dx * s;
          this._touchLookPending.y += dy * s * 0.8 * (this.settings.invertY ? -1 : 1);
          L.x = t.clientX; L.y = t.clientY; L.t = now;
        }
      }
      if (e.cancelable) e.preventDefault();
    }, { passive: false });
    const end = e => {
      for (const t of e.changedTouches) {
        if (t.identifier === this._stick.id) {
          Object.assign(this._stick, { id: null, active: false, vx: 0, vy: 0, jog: false });
          if (ui) ui.root.classList.remove('stick-on', 'stick-jog');
        }
        if (t.identifier === this._lookT.id) this._lookT.id = null;
      }
    };
    c.addEventListener('touchend', end); c.addEventListener('touchcancel', end);
    // a lost touch stream (app switch, notification shade) must not leave the player walking
    addEventListener('blur', () => { Object.assign(this._stick, { id: null, active: false, vx: 0, vy: 0, jog: false }); this._lookT.id = null; if (ui) ui.root.classList.remove('stick-on', 'stick-jog'); });
  }
  _stickMove(px, py) {
    const S = this._stick, R = this.stickR;
    let dx = px - S.ox, dy = py - S.oy, m = Math.hypot(dx, dy);
    // the base follows a thumb that drifts far out (so reversing direction never needs a long trip back)
    const FOLLOW = R * 1.9;
    if (m > FOLLOW) { const k = (m - FOLLOW) / m; S.ox += dx * k; S.oy += dy * k; dx = px - S.ox; dy = py - S.oy; m = FOLLOW; }
    const k = Math.min(1, m / R);
    // inner dead zone, then linear
    const outM = k < 0.14 ? 0 : (k - 0.14) / 0.86;
    S.vx = m > 0 ? dx / m * outM : 0; S.vy = m > 0 ? -dy / m * outM : 0;
    // pushed well past the ring, roughly forward = hurry (sprint) — the classic mobile-FPS gesture
    S.jog = m > R * 1.4 && S.vy > 0.55;
    const kx = m > R ? dx / m * R : dx, ky = m > R ? dy / m * R : dy;
    S.x = S.ox + kx; S.y = S.oy + ky;
  }

  _buildTouchUi() {
    if (!document.querySelector('link[data-namba="input-css"]')) {
      const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'css/input.css?v=c35aedb'; l.dataset.namba = 'input-css';
      document.head.appendChild(l);
    }
    // the stick only (the buttons live in js/ui/touch.js)
    const root = document.createElement('div'); root.id = 'touch-controls';
    root.innerHTML = '<div class="tc-ring"></div><div class="tc-knob"></div>';
    const host = document.getElementById('ui') || document.body;
    host.insertBefore(root, document.getElementById('phone-root') || null);
    return { root, ring: root.querySelector('.tc-ring'), knob: root.querySelector('.tc-knob') };
  }
}
