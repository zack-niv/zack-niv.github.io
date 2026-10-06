// =============================================================================
// Lodestone — the (fictional) indoor-positioning app the player installs.
//
// States: 'idle' → 'installing' (~2 s) → 'calibrating' (~3.2 s, animated
// geomagnetic field lines) → 'ready'.  Ready = true position ±1 m, true
// heading, instant floor, the 3D exploded stack (ui/phone/stack3d.js) with the
// route climbing through it, and turn-by-turn from the nav graph
// (ui/phone/guidance.js).
//
// Brand: our own. Graphite + magnetite amber, electric-blue dot. No Oriient
// name, logo or colours anywhere.
// =============================================================================
import { LEVELS, LEVEL_ORDER, ZONES } from '../../world/layout.js';
import { Stack3D } from './stack3d.js';
import { Guidance, destinationFromSlot, ZONE_SHORT } from './guidance.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const lvl = (l) => LEVELS[l].label.replace('B1F', 'B1').replace('B2F', 'B2');
const fm = (m) => m < 1000 ? `${Math.max(1, Math.round(m / 5) * 5)} m` : `${(m / 1000).toFixed(1)} km`;

export const LOGO = `<svg viewBox="0 0 32 32" class="ld-logo" aria-hidden="true"><defs><linearGradient id="ldg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd37a"/><stop offset="1" stop-color="#ff8a1f"/></linearGradient></defs>
<circle cx="16" cy="16" r="13.2" fill="none" stroke="#5b6b86" stroke-width="1.6" stroke-dasharray="2.2 3.1"/>
<path d="M16 3.4 21.2 16 16 28.6 10.8 16Z" fill="#101827" stroke="url(#ldg)" stroke-width="1.7" stroke-linejoin="round"/>
<path d="M16 3.4 21.2 16 16 16Z" fill="url(#ldg)"/><circle cx="16" cy="16" r="2" fill="#fff"/></svg>`;

const ICONS = {
  straight: '<path d="M12 20V5M6 11l6-6 6 6"/>',
  left: '<path d="M18 20v-6a4 4 0 0 0-4-4H6M10 5 5 10l5 5"/>',
  right: '<path d="M6 20v-6a4 4 0 0 1 4-4h8M14 5l5 5-5 5"/>',
  uleft: '<path d="M17 20V9a4 4 0 0 0-8 0v8M5 13l4 4 4-4"/>',
  uright: '<path d="M7 20V9a4 4 0 0 1 8 0v8M11 13l4 4 4-4"/>',
  up: '<path d="M3 20h5v-5h5v-5h5M12 4h8v8M20 4 11 13"/>',
  down: '<path d="M3 4h5v5h5v5h5M12 20h8v-8M20 20l-9-9"/>',
  flag: '<path d="M6 21V4M6 5h11l-2.5 4L17 13H6"/>',
};
const icon = (k, cls = '') => `<svg viewBox="0 0 24 24" class="ld-ic ${cls}" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">${ICONS[k] || ICONS.straight}</svg>`;

export class LodestoneApp {
  constructor(phone, root) {
    this.phone = phone; this.ctx = phone.ctx; this.root = root;
    this.state = 'idle';
    this.t = 0;
    this.dest = destinationFromSlot('parks_6Fdw03');
    this.guid = this.dest ? new Guidance(this.ctx, this.dest) : null;
    this.route = null; this._rt = 0; this._lastPos = [1e9, 1e9, ''];
    this.arrived = false;
    this.expanded = false;
    this.mode = 'overview';
    root.classList.add('ld');
    root.innerHTML = `
      <section class="ld-install"><div class="ld-i-icon">${LOGO}</div><h1>Lodestone</h1><p class="ld-i-sub">Indoor positioning that works</p>
        <div class="ld-bar"><i></i></div><p class="ld-i-state">Installing…</p></section>
      <section class="ld-calib"><canvas class="ld-field"></canvas>
        <div class="ld-c-txt"><h2>Learning this building’s<br>magnetic fingerprint…</h2><p class="ld-c-sub">Sampling magnetometer</p></div>
        <div class="ld-c-read"><div><small>|B|</small><b class="ld-c-b">47.2</b><small>µT</small></div><div><small>ANCHORS</small><b class="ld-c-a">0</b></div><div><small>FLOORS</small><b class="ld-c-f">0/10</b></div></div>
        <div class="ld-c-floors"></div></section>
      <section class="ld-main">
        <canvas class="ld-3d"></canvas>
        <div class="ld-top"><div class="ld-brand">${LOGO}<b>Lodestone</b></div><div class="ld-acc"><i></i><span>±1 m</span></div></div>
        <div class="ld-where"><b class="ld-w-l">B1</b><span class="ld-w-z">Namba CITY</span></div>
        <div class="ld-ladder"></div>
        <div class="ld-ctl"><div class="ld-seg"><button data-m="overview" class="on">Route</button><button data-m="follow">Me</button></div><button class="ld-recenter" title="Re-centre" aria-label="Re-centre">${'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="3.2"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4"/></svg>'}</button></div>
        <div class="ld-card" hidden></div>
        <div class="ld-sheet"><div class="ld-sheet-in"></div></div>
      </section>`;
    this.el = {
      bar: root.querySelector('.ld-bar i'), iState: root.querySelector('.ld-i-state'), field: root.querySelector('.ld-field'), cSub: root.querySelector('.ld-c-sub'),
      cB: root.querySelector('.ld-c-b'), cA: root.querySelector('.ld-c-a'), cF: root.querySelector('.ld-c-f'), cFloors: root.querySelector('.ld-c-floors'),
      c3d: root.querySelector('.ld-3d'), wL: root.querySelector('.ld-w-l'), wZ: root.querySelector('.ld-w-z'), ladder: root.querySelector('.ld-ladder'),
      card: root.querySelector('.ld-card'), sheet: root.querySelector('.ld-sheet'), sheetIn: root.querySelector('.ld-sheet-in'), seg: root.querySelectorAll('.ld-seg button'),
      acc: root.querySelector('.ld-acc span'),
    };
    this.fg = this.el.field.getContext('2d');
    // floor ladder (top = highest)
    const lvs = LEVEL_ORDER.filter(l => this.ctx.world.grids[l]).slice().reverse();
    this.el.ladder.innerHTML = lvs.map(l => `<button data-l="${l}">${lvl(l)}</button>`).join('');
    this.el.cFloors.innerHTML = lvs.slice().reverse().map(l => `<i data-l="${l}"><u></u><span>${lvl(l)}</span></i>`).join('');
    this.el.ladder.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { this._peek = b.dataset.l; this._peekT = 5; this._syncLadder(); }));
    this.el.seg.forEach(b => b.addEventListener('click', () => this.setMode(b.dataset.m)));
    root.querySelector('.ld-recenter').addEventListener('click', () => this.stack && this.stack.recenter());
    this.el.sheet.addEventListener('click', (e) => {
      if (e.target.closest('.ld-more')) { this.expanded = !this.expanded; this._sheetKey = ''; this._renderSheet(true); }
    });
    root.dataset.state = 'idle';
    this._D = null;
  }

  // ------------------------------------------------------------- lifecycle ---
  start() {
    if (this.state !== 'idle') return;
    this._set('installing'); this.t = 0;
    this.phone.upgradeStage = 'installing';
    this.ctx.events.emit('phone:upgrade', { stage: 'installing' });
    // heavy one-off work happens behind the install bar, on separate frames
    setTimeout(() => this._warm(1), 300);
    setTimeout(() => this._warm(2), 800);
    setTimeout(() => this._warm(3), 1300);
  }
  _warm(step) {
    try {
      if (step === 1) this.stack = this._makeStack();
      if (step === 2 && this.guid) this.guid.prepare();
      if (step === 3 && this.stack && this.stack.ready) { this.stack.setDestination(this.dest); this.stack.warm(); }
    } catch (e) { console.error('[lodestone warm]', e); this.ctx.errors && this.ctx.errors.push('lodestone: ' + e.message); }
  }
  _makeStack() {
    const s = new Stack3D(this.ctx, this.el.c3d, { low: this.phone.lowQ });
    s.init();
    s.onUser = () => { this._userMoved = true; };
    s.bandTop = 126; s.bandBottom = 262;
    return s;
  }
  _set(st) { this.state = st; this.root.dataset.state = st; }

  setMode(m) {
    this.mode = m;
    this.el.seg.forEach(b => b.classList.toggle('on', b.dataset.m === m));
    if (this.stack) this.stack.setMode(m);
  }

  onShow() { /* nothing heavy: stack exists once installed */ }

  // --------------------------------------------------------------- update ---
  update(dt, visible) {
    // arrival is cheap and runs even with the phone down
    if (this.state === 'ready') this._arrivalCheck(dt);
    if (this.state === 'idle') return;
    if (this.state === 'installing') { this.t += dt; this._tickInstall(dt); }
    else if (this.state === 'calibrating') { this.t += dt; this._tickCalib(dt, visible); }
    else if (this.state === 'ready' && visible) { this.t += dt; this._tickMain(dt); }
  }

  // -------------------------------------------------------------- install ---
  _tickInstall() {
    const T = 2.0, p = Math.min(1, this.t / T), e = p < 0.6 ? p / 0.6 * 0.55 : 0.55 + (p - 0.6) / 0.4 * 0.45;   // fast then slower: feels like a store install
    this.el.bar.style.width = `${(e * 100).toFixed(1)}%`;
    this.el.iState.textContent = p < 0.45 ? `Downloading… ${Math.round(e * 100)}%` : p < 1 ? 'Installing…' : 'Opening…';
    if (this.t >= T + 0.15) { this.t = 0; this._set('calibrating'); this.phone.upgradeStage = 'calibrating'; this._initField(); this.ctx.events.emit('phone:upgrade', { stage: 'calibrating' }); }
  }

  // ---------------------------------------------------------- calibration ---
  _initField() {
    const c = this.el.field, dpr = Math.min(2, window.devicePixelRatio || 1) * (this.phone._scale || 1);
    const W = c.clientWidth || 316, H = c.clientHeight || 676;
    c.width = Math.round(W * Math.min(2, Math.max(1, dpr))); c.height = Math.round(H * Math.min(2, Math.max(1, dpr)));
    this._fw = W; this._fh = H; this._fs = c.width / W;
    // dipoles: a few "anchors" that wander slowly
    this._D = [
      { x: W * 0.50, y: H * 0.40, a: 0.6, k: 1.0, ox: 0, oy: 0, ph: 0.0 },
      { x: W * 0.22, y: H * 0.55, a: 2.4, k: 0.7, ox: 0, oy: 0, ph: 1.7 },
      { x: W * 0.80, y: H * 0.50, a: -0.9, k: 0.8, ox: 0, oy: 0, ph: 3.1 },
      { x: W * 0.52, y: H * 0.68, a: 1.9, k: 0.6, ox: 0, oy: 0, ph: 4.4 },
    ];
    this._seeds = [];
    for (let i = 0; i < 64; i++) {
      const D = this._D[i % this._D.length], a = (i / 64) * Math.PI * 2 * 3.1 + i * 0.37, r = 10 + (i * 7 % 23);
      this._seeds.push({ d: i % this._D.length, a, r, ph: (i * 0.618) % 1 });
    }
  }
  _fieldAt(x, y, tt, noise) {
    let bx = 0.22 * Math.cos(tt * 0.3 + 0.4), by = 0.22 * Math.sin(tt * 0.3 + 0.4);
    for (const d of this._D) {
      const dx = x - d.x - d.ox, dy = y - d.y - d.oy, r2 = dx * dx + dy * dy + 900, ir2 = 1 / r2;
      const mx = Math.cos(d.a + tt * 0.25), my = Math.sin(d.a + tt * 0.25), md = mx * dx + my * dy;
      bx += d.k * 900 * (2 * md * dx * ir2 - mx) * ir2 * 38; by += d.k * 900 * (2 * md * dy * ir2 - my) * ir2 * 38;
    }
    if (noise > 0) { bx += noise * Math.sin(y * 0.045 + tt * 2.1) * 0.9; by += noise * Math.cos(x * 0.05 - tt * 1.7) * 0.9; }
    return [bx, by];
  }
  _tickCalib(dt, visible) {
    const T = 3.3, p = Math.min(1, this.t / T), tt = this.t;
    if (!visible) { if (this.t >= T) this._finish(); return; }
    const g = this.fg, s = this._fs, W = this._fw, H = this._fh;
    // wobble the phone (figure-of-8 "calibration" gesture)
    this.phone.sway = { x: Math.sin(tt * 2.6) * 11, y: Math.sin(tt * 5.2) * 6, r: Math.sin(tt * 2.6 + 0.6) * 4.2 };
    g.setTransform(s, 0, 0, s, 0, 0);
    g.fillStyle = 'rgba(3,5,10,0.30)'; g.fillRect(0, 0, W, H);                 // trails
    for (const d of this._D) { d.ox = Math.sin(tt * 0.7 + d.ph) * 14; d.oy = Math.cos(tt * 0.6 + d.ph) * 12; }
    const noise = (1 - p) * 1.2;
    const n = Math.floor(10 + p * 54);
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (let i = 0; i < n; i++) {
      const sd = this._seeds[i], D = this._D[sd.d];
      let x = D.x + D.ox + Math.cos(sd.a + tt * 0.2) * sd.r * 1.6, y = D.y + D.oy + Math.sin(sd.a + tt * 0.2) * sd.r * 1.6;
      const steps = 46 + (i % 5) * 6, sign = i % 2 ? 1 : -1;
      g.beginPath(); g.moveTo(x, y);
      let len = 0;
      for (let k = 0; k < steps; k++) {
        const [bx, by] = this._fieldAt(x, y, tt, noise);
        const m = Math.hypot(bx, by) || 1;
        x += sign * bx / m * 5.2; y += sign * by / m * 5.2; len += 5.2;
        if (x < -20 || y < -20 || x > W + 20 || y > H + 20) break;
        g.lineTo(x, y);
      }
      const hue = 188 - p * 8 + (i % 7) * 3, light = 52 + p * 14;
      const amber = i % 9 === 0 && p > 0.45;
      g.strokeStyle = amber ? `rgba(255,176,46,${0.18 + p * 0.5})` : `hsla(${hue},95%,${light}%,${0.10 + p * 0.38})`;
      g.lineWidth = 3.2; g.stroke();
      g.strokeStyle = amber ? `rgba(255,220,150,${0.35 + p * 0.5})` : `hsla(${hue + 8},100%,${72 + p * 10}%,${0.30 + p * 0.55})`;
      g.lineWidth = 0.9; g.stroke();
    }
    // anchors
    for (let i = 0; i < this._D.length; i++) {
      const d = this._D[i], r = 3 + Math.sin(tt * 4 + i) * 1;
      g.fillStyle = `rgba(255,190,80,${0.35 + p * 0.55})`; g.beginPath(); g.arc(d.x + d.ox, d.y + d.oy, r, 0, 7); g.fill();
      g.strokeStyle = `rgba(255,190,80,${0.25 * (1 - ((tt * 0.8 + i * 0.25) % 1))})`; g.lineWidth = 1.2; g.beginPath(); g.arc(d.x + d.ox, d.y + d.oy, 6 + ((tt * 0.8 + i * 0.25) % 1) * 38, 0, 7); g.stroke();
    }
    // readouts
    const sub = p < 0.25 ? 'Sampling magnetometer' : p < 0.55 ? 'Matching field anchors' : p < 0.85 ? 'Resolving floors with barometer' : 'Locked';
    if (this.el.cSub.textContent !== sub) this.el.cSub.textContent = sub;
    this.el.cB.textContent = (47 + Math.sin(tt * 7.1) * 6 + Math.sin(tt * 2.3) * 11 * (1 - p * 0.6)).toFixed(1);
    this.el.cA.textContent = Math.round(p * p * 2418).toLocaleString('en');
    const nf = Math.min(this._nLevels(), Math.floor(p * 1.15 * this._nLevels()));
    this.el.cF.textContent = `${nf}/${this._nLevels()}`;
    this.el.cFloors.querySelectorAll('i').forEach((el, i) => { el.classList.toggle('on', i < nf); el.firstChild.style.transform = `scaleX(${Math.max(0, Math.min(1, p * 1.15 * this._nLevels() - i))})`; });
    if (this.t >= T) this._finish();
  }
  _nLevels() { return this.el.cFloors.children.length; }

  _finish() {
    this.phone.sway = null;
    const ph = this.phone;
    ph.pos.setMode('lodestone');
    ph.upgradeStage = 'ready';
    this._set('ready'); this.t = 0;
    ph.home && ph.home.addLodestone();
    ph.messages && ph.messages.markInstalled();
    if (!this.stack) { try { this.stack = this._makeStack(); this.stack.setDestination(this.dest); } catch (e) { console.error(e); } }
    this._revealed = false; this._cardT = 3.2; this._rt = 0; this._lastPos = [1e9, 1e9, ''];
    this._shownLevel = ph.pos.level;
    this.setMode('overview');
    if (this.stack) { this.stack.recenter(); this.stack.startIntro(); }
    this._showCard(`You’re on ${lvl(ph.pos.level)}`, `${this._zoneName()} · ±1 m`, true);
    ph.app !== 'lodestone' && ph.isOpen && ph._showApp('lodestone');
    this.ctx.events.emit('phone:upgrade', { stage: 'ready' });
  }

  // ------------------------------------------------------------------ main ---
  _zoneName() {
    const p = this.phone.pos, sp = this.ctx.world.spaceAt(p.level, p.x, p.z), z = sp && ZONES[sp.zone];
    return z ? (ZONE_SHORT[sp.zone] ? (ZONE_SHORT[sp.zone][0] === 't' ? 'Underground passage' : ZONE_SHORT[sp.zone]) : z.name) : 'Namba';
  }
  _showCard(title, sub, big) {
    const c = this.el.card; c.hidden = false; c.classList.toggle('big', !!big);
    c.innerHTML = `<div class="ld-c-ck"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5 10 17.5 19 7"/></svg></div><div><b>${esc(title)}</b><small>${esc(sub)}</small></div>`;
    c.classList.remove('in'); void c.offsetWidth; c.classList.add('in');
    this._cardT = big ? 3.0 : 1.8;
  }
  _syncLadder() {
    const cur = this._peek && this._peekT > 0 ? this._peek : this.phone.pos.level;
    const rl = this.stack && this.stack.routeLevels;
    this.el.ladder.querySelectorAll('button').forEach(b => {
      const l = b.dataset.l;
      b.classList.toggle('me', l === this.phone.pos.level);
      b.classList.toggle('on', l === cur);
      b.classList.toggle('route', !!(rl && rl.has(l)));
      b.classList.toggle('dest', l === this.dest.level);
    });
  }

  _tickMain(dt) {
    const ph = this.phone, p = ph.pos, S = this.stack;
    if (!S || !S.ready) return;
    const body = this.ctx.player.body;
    this._rt -= dt; if (this._peekT > 0) { this._peekT -= dt; if (this._peekT <= 0) { this._peek = null; this._syncLadder(); } }
    // route / guidance at ~2 Hz, or when something changed a lot
    if (this._rt <= 0) {
      this._rt = 0.5;
      const moved = Math.hypot(body.x - this._lastPos[0], body.z - this._lastPos[1]);
      if (moved > 0.9 || body.level !== this._lastPos[2] || !this.route) {
        this._lastPos = [body.x, body.z, body.level];
        const r = this.guid && this.guid.compute(body, p.heading);
        if (r && r.ok) { this.route = r; S.setRoute(r); } else if (r) { this.route = r; }
        this._renderSheet(false);
        this._syncLadder();
      }
    }
    // dot
    const y = body.ramp >= 0 ? body.y : LEVELS[p.level].y;
    S.setPlayer(p.x, p.z, p.level, p.heading, y);
    S.curLevel = this._peek && this._peekT > 0 ? this._peek : p.level;
    S.update(dt); S.render();
    // header chips
    if (this._shownLevel !== p.level) {
      this._shownLevel = p.level; this._syncLadder();
      if (this._revealed) this._showCard(`Now on ${lvl(p.level)}`, `${this._zoneName()}`, false);
    }
    if (!this._revealed && this.t > 0.2) this._revealed = true;
    this._whereT = (this._whereT || 0) - dt;
    if (this._whereT <= 0) {
      this._whereT = 0.4;
      const l = lvl(p.level), z = this._zoneName();
      if (this.el.wL.textContent !== l) this.el.wL.textContent = l;
      if (this.el.wZ.textContent !== z) this.el.wZ.textContent = z;
    }
    if (this._cardT > 0) { this._cardT -= dt; if (this._cardT <= 0) this.el.card.classList.add('out'); } else if (!this.el.card.hidden && this.el.card.classList.contains('out')) { this.el.card.hidden = true; this.el.card.classList.remove('out'); }
    if (this._cardT > 0 && this.el.card.classList.contains('out')) this.el.card.classList.remove('out');
    // live arrow on the current instruction
    this._liveArrow();
  }

  _liveArrow() {
    const R = this.route, a = this._arrowEl || (this._arrowEl = this.el.sheetIn.querySelector('.ld-arrow'));
    if (!R || !R.ok || !a || !R.ahead) return;
    const p = this.phone.pos;
    const dx = R.ahead.x - p.x, dz = R.ahead.z - p.z;
    if (Math.hypot(dx, dz) < 1.5) return;
    // bearing to the path (yaw convention: 0 = north / -Z, + turns left)
    const bearing = Math.atan2(-dx, -dz);
    let d = bearing - p.heading; d = Math.atan2(Math.sin(d), Math.cos(d));
    this._arrowAng = (this._arrowAng || 0) + (-d - (this._arrowAng || 0)) * 0.25;
    a.style.transform = `rotate(${(-d * 180 / Math.PI).toFixed(1)}deg)`;
  }

  _arrivalCheck(dt) {
    if (this.arrived || !this.guid || !this.guid.field) return;
    this._at = (this._at || 0) - dt; if (this._at > 0) return; this._at = 0.4;
    const b = this.ctx.player && this.ctx.player.body; if (!b) return;
    const lv = this.phone.pos.trueLevel(b);
    if (lv !== this.dest.level) return;
    const rem = this.guid.remaining(b);
    if (rem < 5 || Math.hypot(b.x - this.dest.x, b.z - this.dest.z) < 3.5) this._arrive();
  }
  _arrive() {
    if (this.arrived) return;
    this.arrived = true; this._arrStats = this.phone.stats();
    this._sheetKey = ''; this._renderSheet(true);
    this.ctx.events.emit('phone:arrive', { id: 'b:' + this.dest.slot, source: 'lodestone' });
    this.ctx.events.emit('lodestone:arrive', { id: this.dest.slot });
  }

  // ---------------------------------------------------------------- sheet ---
  _renderSheet(force) {
    const R = this.route, S = this.el.sheetIn;
    if (this.arrived) {
      const st = this._arrStats || this.phone.stats();
      const key = 'arrived:' + st.secondsAfter;
      if (!force && key === this._sheetKey) return; this._sheetKey = key;
      const mm = Math.floor(st.secondsAfter / 60), ss = String(st.secondsAfter % 60).padStart(2, '0');
      this.el.sheet.classList.add('arrived');
      S.innerHTML = `<div class="ld-arr"><div class="ld-arr-ck"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5 10 17.5 19 7"/></svg></div>
        <div><b>You’ve arrived</b><span>${esc(this.dest.en)} · ${lvl(this.dest.level)}</span></div></div>
        <div class="ld-arr-m"><div><b>${mm}:${ss}</b><small>with Lodestone</small></div><div><b>${st.metresAfter} m</b><small>walked</small></div><div><b>±1 m</b><small>accuracy</small></div></div>
        <p class="ld-arr-n">Aya’s in the queue. Door ${esc(this._doorSide())}.</p>`;
      return;
    }
    this.el.sheet.classList.remove('arrived');
    if (!R || !R.ok) { const k = 'noroute'; if (k === this._sheetKey && !force) return; this._sheetKey = k; S.innerHTML = `<div class="ld-nr"><b>Locating route…</b><span>Walk to an open area</span></div>`; return; }
    const st = R.steps, cur = st[0], nxt = st[1];
    const mins = R.eta < 45 ? '<1' : String(Math.max(1, Math.round(R.eta / 60)));
    const dist = Math.round(R.total);
    const toGo = cur ? Math.max(0, Math.round(cur.at)) : 0;
    const key = [cur && cur.title, cur && cur.sub, Math.round(toGo / 5), nxt && nxt.title, mins, Math.round(dist / 5), R.ramps, this.expanded, st.length].join('|');
    if (!force && key === this._sheetKey) return; this._sheetKey = key;
    const live = cur && (cur.kind !== 'ramp' && cur.icon !== 'flag') || (cur && toGo > 14);
    const first = `<div class="ld-now"><div class="ld-now-ic ${live && toGo > 12 ? 'live' : ''}">${live && toGo > 12 ? icon('straight', 'ld-arrow') : icon(cur ? cur.icon : 'straight')}</div>
      <div class="ld-now-t"><div class="ld-dist">${toGo < 3 ? 'Now' : fm(toGo)}</div><b>${esc(cur ? cur.title : 'Head to route')}</b><span>${esc(cur ? cur.sub : '')}</span></div></div>`;
    const then = nxt ? `<div class="ld-then"><em>Then</em>${icon(nxt.icon, 'sm')}<span>${esc(nxt.title)}${nxt.sub ? ` <u>${esc(nxt.sub)}</u>` : ''}</span></div>` : '';
    const stats = `<div class="ld-stats"><div><b>${mins}</b><small>min</small></div><div><b>${dist >= 1000 ? (dist / 1000).toFixed(1) : dist}</b><small>${dist >= 1000 ? 'km' : 'metres'}</small></div><div><b>${R.ramps}</b><small>floor ${R.ramps === 1 ? 'change' : 'changes'}</small></div><button class="ld-more" aria-label="All steps">${this.expanded ? '▾' : '▴'} Steps</button></div>`;
    let list = '';
    if (this.expanded) list = `<ol class="ld-steps">${st.map(s => `<li>${icon(s.icon, 'sm')}<div><b>${esc(s.title)}</b><small>${esc(s.sub || '')}</small></div><em>${fm(s.at)}</em></li>`).join('')}</ol>`;
    this.el.sheet.classList.toggle('open', this.expanded);
    S.innerHTML = first + then + stats + list;
    this._arrowEl = null;
  }
  _doorSide() { const s = this.route && this.route.steps && this.route.steps[this.route.steps.length - 1]; return s && /left|right|ahead/.test(s.sub) ? s.sub.split(' · ')[0].replace('on your ', 'on the ') : 'ahead'; }
}
