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
//   input.jog / input.running   brisk walk (Shift, L3, touch stick past ring)
//   input.slow                  browse walk (C toggles, Alt holds, LB)
//   input.down(code) / input.pressed(code)   raw keys (KeyboardEvent.code)
//   input.action(name)          edge-triggered: 'interact' (E / A / touch),
//                               'phone' (Q / Tab / Y / touch), 'menu' (Esc / Start)
//   input.device                'kbm' | 'gamepad' | 'touch' (last used)
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
    this.jog = false; this.slow = false;
    this._slowLatch = false;
    this.locked = false;
    this.enabled = true;
    this.device = 'kbm';
    this.touch = (() => { try { return matchMedia('(pointer: coarse)').matches; } catch (e) { return false; } })();
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
      if (e.code === 'KeyC' && this.settings.slowToggle) this._slowLatch = !this._slowLatch;
      // keep the page from scrolling / focus-hopping / opening menus while playing
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'AltLeft', 'AltRight'].includes(e.code)) e.preventDefault();
      if ((e.ctrlKey || e.metaKey) && this.locked && ['KeyW', 'KeyS', 'KeyD', 'KeyA'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', e => { this.keys.delete(e.code); if (e.code === 'AltLeft' || e.code === 'AltRight') e.preventDefault(); });
    addEventListener('blur', () => { this.keys.clear(); });
    addEventListener('mousemove', e => {
      if (!this.locked || !this.enabled) return;
      const dx = e.movementX || 0, dy = e.movementY || 0;
      // Chrome occasionally reports a single bogus huge jump under pointer
      // lock; real flicks arrive as many small events, so drop absurd ones.
      if (Math.abs(dx) > 600 || Math.abs(dy) > 600) return;
      this.device = 'kbm';
      this.look.x += dx; this.look.y += dy;
    });
    addEventListener('mousedown', e => { this._pressed.add('Mouse' + e.button); });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; if (!this.locked) this.keys.clear(); });
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
    if (this.touch || !this.canvas.requestPointerLock) return;
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
      this.move.x = s.x; this.move.y = s.y; this.jog = !!s.jog; this.slow = !!s.slow;
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
      x = this._stick.vx; y = this._stick.vy; jog = this._stick.jog;
    }
    // gamepad
    const pad = this._pollPad(dt);
    if (pad && (Math.abs(pad.x) > 0 || Math.abs(pad.y) > 0)) { x = pad.x; y = pad.y; }
    if (pad) { jog = jog || pad.jog; slow = slow || pad.slow; }
    if (!this.enabled) { x = 0; y = 0; }
    this.move.x = x; this.move.y = y;
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
    if (rx || ry) {
      // response curve (quadratic-ish) — analog sticks need one, mice don't
      const m = Math.hypot(rx, ry), c = Math.pow(m, 1.8) / m;
      const rate = 2.8 * this.settings.padSensitivity; // rad/s at full tilt
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

  // ---- touch: left = virtual stick (visible ring), right = drag look --------
  _touchSetup() {
    this._stick = { active: false, id: null, ox: 0, oy: 0, vx: 0, vy: 0, jog: false };
    this._lookT = { id: null, x: 0, y: 0 };
    const c = this.canvas;
    let ui = null;
    const ensureUi = () => {
      if (ui) return ui;
      ui = this._buildTouchUi();
      return ui;
    };
    if (this.touch) ensureUi();
    const R = 56; // stick radius in px
    c.addEventListener('touchstart', e => {
      this.touch = true; this.device = 'touch';
      const u = ensureUi();
      for (const t of e.changedTouches) {
        if (t.clientX < innerWidth * 0.45 && this._stick.id === null) {
          Object.assign(this._stick, { active: true, id: t.identifier, ox: t.clientX, oy: t.clientY, vx: 0, vy: 0, jog: false });
          u.ring.style.transform = `translate(${t.clientX - R}px, ${t.clientY - R}px)`;
          u.knob.style.transform = `translate(${t.clientX - 22}px, ${t.clientY - 22}px)`;
          u.root.classList.add('stick-on');
        } else if (this._lookT.id === null) { Object.assign(this._lookT, { id: t.identifier, x: t.clientX, y: t.clientY }); }
      }
      e.preventDefault();
    }, { passive: false });
    c.addEventListener('touchmove', e => {
      for (const t of e.changedTouches) {
        if (t.identifier === this._stick.id) {
          const dx = t.clientX - this._stick.ox, dy = t.clientY - this._stick.oy;
          const m = Math.hypot(dx, dy);
          let k = Math.min(1, m / R);
          // inner dead zone, then linear; dragging well past the ring = jog
          const out = k < 0.12 ? 0 : (k - 0.12) / 0.88;
          this._stick.vx = m > 0 ? dx / m * out : 0; this._stick.vy = m > 0 ? -dy / m * out : 0;
          this._stick.jog = m > R * 1.45;
          const kx = m > R ? dx / m * R : dx, ky = m > R ? dy / m * R : dy;
          if (ui) { ui.knob.style.transform = `translate(${this._stick.ox + kx - 22}px, ${this._stick.oy + ky - 22}px)`; ui.root.classList.toggle('stick-jog', this._stick.jog); }
        } else if (t.identifier === this._lookT.id) {
          const s = 0.0052 * this.settings.touchSensitivity;
          this._touchLookPending.x += (t.clientX - this._lookT.x) * s;
          this._touchLookPending.y += (t.clientY - this._lookT.y) * s;
          this._lookT.x = t.clientX; this._lookT.y = t.clientY;
        }
      }
      e.preventDefault();
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
  }

  _buildTouchUi() {
    if (!document.querySelector('link[data-namba="input-css"]')) {
      const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'css/input.css'; l.dataset.namba = 'input-css';
      document.head.appendChild(l);
    }
    const root = document.createElement('div'); root.id = 'touch-controls';
    root.innerHTML = '<div class="tc-ring"></div><div class="tc-knob"></div>' +
      '<button class="tc-btn tc-interact" aria-label="Interact">E</button>' +
      '<button class="tc-btn tc-phone" aria-label="Phone">\u{1F4F1}</button>';
    document.body.appendChild(root);
    const btn = (sel, action, code) => {
      const b = root.querySelector(sel);
      const fire = e => { e.preventDefault(); e.stopPropagation(); this.device = 'touch'; this._actions.add(action); this._pressed.add(code); b.classList.add('on'); };
      b.addEventListener('touchstart', fire, { passive: false });
      b.addEventListener('touchend', e => { e.preventDefault(); b.classList.remove('on'); }, { passive: false });
      b.addEventListener('click', e => { e.preventDefault(); this._actions.add(action); this._pressed.add(code); });
    };
    btn('.tc-interact', 'interact', 'KeyE');
    btn('.tc-phone', 'phone', 'KeyQ');
    return { root, ring: root.querySelector('.tc-ring'), knob: root.querySelector('.tc-knob') };
  }
}
