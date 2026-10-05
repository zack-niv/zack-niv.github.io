// Input: keyboard, mouse look with pointer lock, gamepad-less touch controls.
// Systems read `input.move` (x strafe, y forward in -1..1), `input.look`
// (accumulated dx, dy in pixels since last frame), and edge-triggered
// `input.pressed(code)`.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this._pressed = new Set();
    this.look = { x: 0, y: 0 };
    this.move = { x: 0, y: 0 };
    this.locked = false;
    this.enabled = true;
    this.touch = matchMedia('(pointer: coarse)').matches;
    this.sensitivity = 0.0022;
    addEventListener('keydown', e => {
      if (e.repeat) return;
      this.keys.add(e.code); this._pressed.add(e.code);
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('mousemove', e => {
      if (!this.locked || !this.enabled) return;
      this.look.x += e.movementX; this.look.y += e.movementY;
    });
    addEventListener('mousedown', e => { this._pressed.add('Mouse' + e.button); });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; });
    this._touchSetup();
  }
  requestLock() { if (!this.touch && this.canvas.requestPointerLock) { try { const p = this.canvas.requestPointerLock({ unadjustedMovement: true }); if (p && p.catch) p.catch(() => this.canvas.requestPointerLock()); } catch (e) { this.canvas.requestPointerLock(); } } }
  exitLock() { if (document.exitPointerLock) document.exitPointerLock(); }
  down(code) { return this.enabled && this.keys.has(code); }
  pressed(code) { return this.enabled && this._pressed.has(code); }
  endFrame() { this._pressed.clear(); this.look.x = 0; this.look.y = 0; }
  update() {
    if (!this.touch || !this._stick.active) {
      let x = 0, y = 0;
      if (this.down('KeyW') || this.down('ArrowUp')) y += 1;
      if (this.down('KeyS') || this.down('ArrowDown')) y -= 1;
      if (this.down('KeyA') || this.down('ArrowLeft')) x -= 1;
      if (this.down('KeyD') || this.down('ArrowRight')) x += 1;
      const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
      this.move.x = x; this.move.y = y;
    }
  }
  get running() { return this.down('ShiftLeft') || this.down('ShiftRight'); }
  // --- touch: left half = virtual stick, right half = look drag -------------
  _touchSetup() {
    this._stick = { active: false, id: null, ox: 0, oy: 0 };
    this._lookT = { id: null, x: 0, y: 0 };
    const c = this.canvas;
    c.addEventListener('touchstart', e => {
      for (const t of e.changedTouches) {
        if (t.clientX < innerWidth * 0.45 && this._stick.id === null) { Object.assign(this._stick, { active: true, id: t.identifier, ox: t.clientX, oy: t.clientY }); }
        else if (this._lookT.id === null) { Object.assign(this._lookT, { id: t.identifier, x: t.clientX, y: t.clientY }); }
      }
      e.preventDefault();
    }, { passive: false });
    c.addEventListener('touchmove', e => {
      for (const t of e.changedTouches) {
        if (t.identifier === this._stick.id) {
          let x = (t.clientX - this._stick.ox) / 60, y = -(t.clientY - this._stick.oy) / 60;
          const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
          this.move.x = x; this.move.y = y;
        } else if (t.identifier === this._lookT.id) {
          this.look.x += (t.clientX - this._lookT.x) * 1.6; this.look.y += (t.clientY - this._lookT.y) * 1.6;
          this._lookT.x = t.clientX; this._lookT.y = t.clientY;
        }
      }
      e.preventDefault();
    }, { passive: false });
    const end = e => {
      for (const t of e.changedTouches) {
        if (t.identifier === this._stick.id) { this._stick.id = null; this._stick.active = false; this.move.x = 0; this.move.y = 0; }
        if (t.identifier === this._lookT.id) this._lookT.id = null;
      }
    };
    c.addEventListener('touchend', end); c.addEventListener('touchcancel', end);
  }
}
