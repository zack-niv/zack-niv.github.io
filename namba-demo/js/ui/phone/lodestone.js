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
const HERO_S = 5.2;                   // v8 critic: the reveal's 3D fly-in (2.4 s) + a hold, then the map
import { Guidance, destinationFromSlot, ZONE_SHORT } from './guidance.js';
import { Tracker } from './track.js';
import { DestList, destIdOf, defaultIds, bizSub, zoneShort, nextChip, nextChipHtml } from './destinations.js';
import { businessBySlot } from '../../world/directory.js';
import { milestoneOf, milestoneText, PassCue, NEAR_M } from './milestone.js';
import { placeArt } from './art.js';
import { LdMap, CAL_DONE } from './ldmap.js';
import { NavHeader } from './glance.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const lvl = (l) => LEVELS[l].label.replace('B1F', 'B1').replace('B2F', 'B2');
export const fm = (m) => !isFinite(m) ? '—' : m < 1000 ? `${Math.max(1, Math.round(m / 5) * 5)} m` : `${(m / 1000).toFixed(1)} km`;

// (each copy gets its own gradient id: a gradient inside a display:none section would not paint elsewhere)
let _logoN = 0;
export const logo = () => { const id = 'ldg' + (++_logoN); return `<svg viewBox="0 0 32 32" class="ld-logo" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd37a"/><stop offset="1" stop-color="#ff8a1f"/></linearGradient></defs>
<circle cx="16" cy="16" r="13.2" fill="none" stroke="#5b6b86" stroke-width="1.6" stroke-dasharray="2.2 3.1"/>
<path d="M16 3.4 21.2 16 16 28.6 10.8 16Z" fill="#101827" stroke="url(#${id})" stroke-width="1.7" stroke-linejoin="round"/>
<path d="M16 3.4 21.2 16 16 16Z" fill="url(#${id})"/><circle cx="16" cy="16" r="2" fill="#fff"/></svg>`; };
export const LOGO = logo();

export const ICONS = {
  straight: '<path d="M12 20V5M6 11l6-6 6 6"/>',
  left: '<path d="M18 20v-6a4 4 0 0 0-4-4H6M10 5 5 10l5 5"/>',
  right: '<path d="M6 20v-6a4 4 0 0 1 4-4h8M14 5l5 5-5 5"/>',
  uleft: '<path d="M17 20V9a4 4 0 0 0-8 0v8M5 13l4 4 4-4"/>',
  uright: '<path d="M7 20V9a4 4 0 0 1 8 0v8M11 13l4 4 4-4"/>',
  up: '<path d="M3 20h5v-5h5v-5h5M12 4h8v8M20 4 11 13"/>',
  down: '<path d="M3 4h5v5h5v5h5M12 20h8v-8M20 20l-9-9"/>',
  canyon: '<path d="M3 20 8 10l3 5 3-8 7 13M3 20h18M17 4.2a2 2 0 1 0 .01 0"/>',
  bridge: '<path d="M2 15h20M4 15v5M20 15v5M2 15c4-6 16-6 20 0M8 11v4M12 10v5M16 11v4"/>',
  flag: '<path d="M6 21V4M6 5h11l-2.5 4L17 13H6"/>',
  check: '<path d="M5 12.5 10 17.5 19 7"/>',
  pin: '<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.3"/>',
};
export const icon = (k, cls = '') => `<svg viewBox="0 0 24 24" class="ld-ic ${cls}" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">${ICONS[k] || ICONS.straight}</svg>`;

const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5 10 17.5 19 7"/></svg>';
const EXPAND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 3.5 7.5 12 12l8.5-4.5Z"/><path d="m3.5 12 8.5 4.5 8.5-4.5M3.5 16.5 12 21l8.5-4.5"/></svg>';
// v8 (item 4): the calibration, in four plain steps (each one ticks off; the floor and the dot are the real ones)
const CAL_STEPS = ['Reading the magnetic field', 'Matching it to Namba’s indoor map', 'Finding your floor…', 'You’re here · ±1 m'];
const noFloor = (t) => String(t || '').replace(/\s+(B\d|\d+F)$/, '');

// Plain-language wording of a guidance step: `long` for the phone, `short` for the glance card.
export function phrase(s, dest) {
  if (!s) return { long: 'Head to the highlighted route', short: 'Head to the route' };
  if (s.kind === 'ramp') {
    const st = s.word === 'Stairs', dir = s.up ? 'up' : 'down';
    const what = st ? 'the stairs' : s.count > 1 ? 'the escalators' : 'the escalator';
    if (s.riding) return { long: st ? `${s.up ? 'Up' : 'Down'} the stairs to ${lvl(s.to)}` : `Riding ${dir} to ${lvl(s.to)}`, short: st ? `Stairs ${dir} to ${lvl(s.to)}` : `Riding ${dir} to ${lvl(s.to)}` };
    return { long: `Take ${what} ${dir} to ${lvl(s.to)}`, short: `${st ? 'Stairs' : 'Escalator'} ${dir} to ${lvl(s.to)}` };
  }
  if (s.kind === 'arrive') {
    const side = (String(s.sub || '').split(' · ')[0] || '').replace(/^\d+F$|^B\d$/, '') || 'ahead';
    const name = dest ? dest.en : 'Your destination';
    return { long: `${name} is ${side}`, short: `${name.replace(/^Tempura /, '')} ${side}` };
  }
  if (s.kind === 'via') return { long: s.long || 'Walk out into the open-air canyon', short: s.short || 'Out into the canyon' };
  if (/^Turn/.test(s.title)) {
    const into = /^(into|across)/.test(s.sub || '') ? ' ' + noFloor(s.sub) : '';
    return { long: s.title + into, short: s.title };
  }
  if (/^Cross the bridge/.test(s.title)) return { long: `Cross the bridge ${noFloor(s.sub)}`.trim(), short: 'Cross the bridge' };
  return { long: noFloor(s.title), short: noFloor(s.title).replace(/^Continue into /, 'Into ') };
}
// a walking step far enough away shows the live arrow (pointing along the path); others their own glyph
const isLive = (s, toGo) => !!s && s.kind !== 'ramp' && s.kind !== 'arrive' && s.kind !== 'via' && s.icon !== 'flag' && toGo > 12;

export class LodestoneApp {
  constructor(phone, root) {
    this.phone = phone; this.ctx = phone.ctx; this.root = root;
    this.state = 'idle';
    this.t = 0;
    this.T_INSTALL = 1.8; this.T_CALIB = 3.0;
    // v4: no destination until the player picks one (here or in Maps: phone.dest is shared)
    this.dest = null; this.guid = null;
    this._guids = new Map();               // one Guidance (cost field) per destination, kept for multi-leg trips
    this._via = { done: false, i: 0 };           // the Namba Parks canyon detour is offered once per game, whatever the leg
    this._choosing = false;                // "Change" pressed: the list is up although a destination is set
    this.route = null; this._rt = 0; this._lastPos = [1e9, 1e9, ''];
    this.arrived = false;
    this.track = new Tracker(this);  // v3: heading / progress vs the route ('nav:track')
    this.pass = new PassCue();       // v5: "straight past <shop>" on long legs
    this._pass = null; this._mSide = null; this._msKey = '';
    this.view = 'guide';           // 'guide' (one instruction, stack as a preview) | 'stack' (the 3D exploded stack, all steps)
    this.mode = 'overview';
    this._revealT = 0;
    root.classList.add('ld');
    const destName = '';
    root.innerHTML = `
      <section class="ld-install"><div class="ld-i-icon">${logo()}</div><h1>Lodestone</h1><p class="ld-i-sub">Indoor positioning that works</p>
        <div class="ld-bar"><i></i></div><p class="ld-i-state">Installing…</p></section>
      <section class="ld-calib"><canvas class="ld-field"></canvas>
        <div class="ld-c-txt"><h2>Finding you indoors</h2><p class="ld-c-sub">No GPS needed · just your phone’s compass</p></div>
        <ol class="ld-c-steps">${CAL_STEPS.map((t, i) => `<li data-i="${i}"><i>${CHECK}</i><span>${t}</span></li>`).join('')}</ol>
        <div class="ld-c-floors"></div></section>
      <section class="ld-main" data-view="guide">
        <canvas class="ld-3d"></canvas>
        <canvas class="ld-map"></canvas>
        <button class="ld-tap" aria-label="Open the 3D floor view"></button>
        <div class="ld-head"><div class="ld-hdr"><div class="gl gl-ld"></div></div></div>
        <button class="ld-x3d"><i>${EXPAND}</i><span>3D view</span>${phone.ctx.input && phone.ctx.input.touch ? '' : '<kbd>V</kbd>'}</button>
        <div class="ld-trip">
          <div class="ld-trip-r ld-here"><i class="ld-dot"></i><div><small>You are here <u>±1 m</u></small><b><span class="ld-w-l">3F</span><span class="ld-w-z">Namba</span></b></div></div>
          <div class="ld-trip-r ld-to"><i class="ld-pin"></i><div><small>Destination</small><b><span class="ld-to-l"></span><span class="ld-to-n">${destName}</span></b></div><em class="ld-to-m"></em></div>
          <div class="ld-trip-a"><button class="ld-new" type="button"><svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg><span>New place</span>${phone.ctx.input && phone.ctx.input.touch ? '' : '<kbd>/</kbd>'}</button><button class="ld-end" type="button"><span>End route</span>${phone.ctx.input && phone.ctx.input.touch ? '<i>×</i>' : '<kbd>X</kbd>'}</button></div>
        </div>
        <div class="ld-top"><div class="ld-brand">${logo()}<b>Lodestone</b></div><div class="ld-acc"><i></i><span>±1 m</span></div></div>
        <div class="ld-ladder"></div>
        <div class="ld-ctl"><div class="ld-seg"><button data-m="overview" class="on">Route</button><button data-m="follow">Me</button></div><button class="ld-recenter" title="Re-centre" aria-label="Re-centre">${'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="3.2"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4"/></svg>'}</button><button class="ld-done">Done</button></div>
        <div class="ld-sheet"><ol class="ld-steps"></ol></div>
        <div class="ld-card" hidden></div>
        <div class="ld-next"></div>
        <div class="ld-pick"><button class="ld-pick-x" type="button" aria-label="Back to the route">×</button><div class="ld-pick-l"></div></div>
        <div class="ld-prev" hidden></div>
      </section>`;
    const q = (c) => root.querySelector(c);
    this.el = {
      bar: q('.ld-bar i'), iState: q('.ld-i-state'), field: q('.ld-field'), cSub: q('.ld-c-sub'), cFloors: q('.ld-c-floors'),
      main: q('.ld-main'), c3d: q('.ld-3d'), wL: q('.ld-w-l'), wZ: q('.ld-w-z'), ladder: q('.ld-ladder'),
      card: q('.ld-card'), seg: root.querySelectorAll('.ld-seg button'),
      head: q('.ld-head'), map: q('.ld-map'), cSteps: root.querySelectorAll('.ld-c-steps li'),
      toM: q('.ld-to-m'), trip: q('.ld-trip'), steps: q('.ld-steps'), toL: q('.ld-to-l'), toN: q('.ld-to-n'), pick: q('.ld-pick'),
    };
    // v4: the shared "Where to?" list, Lodestone styling (search box, chips, Aya's pick on top)
    this.list = new DestList(q('.ld-pick-l'), { theme: 'lodestone', search: true, chips: true, onPick: (it) => this._pickItem(it), onQuery: () => this._renderList() });
    this.list.touch = !!(phone.ctx.input && phone.ctx.input.touch);
    // v5: the same route controls as Maps — New place (/) and End route (X)
    q('.ld-new').addEventListener('click', (e) => { e.stopPropagation(); this.choose(true); this.list.focusSearch(); });
    q('.ld-end').addEventListener('click', (e) => { e.stopPropagation(); this.phone.endRoute('lodestone'); });
    this._prevEl = q('.ld-prev'); this._prev = null;
    for (const ev of ['pointerdown', 'click', 'wheel']) this._prevEl.addEventListener(ev, e => e.stopPropagation(), { passive: true });
    q('.ld-pick-x').addEventListener('click', (e) => { e.stopPropagation(); this.choose(false); });
    for (const ev of ['pointerdown', 'click', 'wheel']) this.el.pick.addEventListener(ev, e => e.stopPropagation(), { passive: true });
    // v8: one header (the same card as the glance strip) and a real top-down map of your floor
    this.hdr = new NavHeader(q('.ld-hdr .gl'));
    this.map = new LdMap(this, this.el.map, ICONS);
    // floor ladder (top = highest)
    const lvs = LEVEL_ORDER.filter(l => this.ctx.world.grids[l]).slice().reverse();
    this.el.ladder.innerHTML = lvs.map(l => `<button data-l="${l}">${lvl(l)}</button>`).join('');
    this.el.cFloors.innerHTML = lvs.slice().reverse().map(l => `<i data-l="${l}"><u></u><span>${lvl(l)}</span></i>`).join('');
    this.el.ladder.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { this._peek = b.dataset.l; this._peekT = 5; this._syncLadder(); }));
    this.el.seg.forEach(b => b.addEventListener('click', () => this.setMode(b.dataset.m)));
    q('.ld-recenter').addEventListener('click', () => this.stack && this.stack.recenter());
    q('.ld-tap').addEventListener('click', () => this.setView('stack'));
    q('.ld-x3d').addEventListener('click', () => this.toggleStack());
    q('.ld-done').addEventListener('click', () => this.setView('guide'));
    root.dataset.state = 'idle';
    this._D = null;
  }

  // ------------------------------------------------------------- lifecycle ---
  get revealing() { return this._revealT > 0; }
  start() {
    if (this.state !== 'idle') return;
    this._set('installing'); this.t = 0;
    this.phone.upgradeStage = 'installing';
    this.ctx.events.emit('phone:upgrade', { stage: 'installing' });
    // heavy one-off work happens behind the install bar, on separate frames
    setTimeout(() => this._warm(1), 300);
    setTimeout(() => this._warm(2), 750);
    setTimeout(() => this._warm(3), 1200);
  }
  _warm(step) {
    try {
      if (step === 1) { this.stack = this._makeStack(); const b = this.ctx.player && this.ctx.player.body; if (b) this.map.baseFor(b.level); }
      if (step === 2 && this.guid) this.guid.prepare();
      if (step === 3 && this.stack && this.stack.ready) { this.stack.setDestination(this.dest || null); this.stack.warm(); }
    } catch (e) { console.error('[lodestone warm]', e); this.ctx.errors && this.ctx.errors.push('lodestone: ' + e.message); }
  }
  _makeStack() {
    const s = new Stack3D(this.ctx, this.el.c3d, { low: this.phone.lowQ });
    s.init();
    s.onUser = () => { this._userMoved = true; };
    this._bands(s);
    return s;
  }
  // the free band of the screen the 3D stack is framed into (px of the 316 x 676 screen)
  _bands(s = this.stack) {
    if (!s) return;
    if (this.view === 'stack') { s.bandTop = 150; s.bandBottom = 296; s.bandRight = 46; }      // (v3: + the dock)
    else { s.bandTop = this._navBottom || 200; s.bandBottom = this.picking ? 444 : 306; s.bandRight = 0; }   // (v5: 306 = + the trip card's route-controls row)
    s.compact = this.view !== 'stack';
    // guide view: the preview lives in its band only (soft edges), nothing draws under the instruction or trip cards
    try { this.el.c3d.style.setProperty('--ld-band-t', `${Math.round(s.bandTop) - 8}px`); this.el.c3d.style.setProperty('--ld-band-b', `${Math.round(s.bandBottom) - (this.view === 'stack' ? 6 : 40)}px`); } catch (e) { /* ignore */ }
  }
  _set(st) { this.state = st; this.root.dataset.state = st; }

  setMode(m) {
    this.mode = m;
    this.el.seg.forEach(b => b.classList.toggle('on', b.dataset.m === m));
    if (this.stack) this.stack.setMode(m);
  }
  // hero: the reveal's brief 3D fly-in (v8 critic); any other view change (V, Done, a tap) cancels the auto-settle
  setView(v, hero = false) {
    if (this.state !== 'ready' || v === this.view) return;
    this._heroT = hero ? HERO_S : 0;
    this.view = v;
    this.el.main.dataset.view = v;
    if (v === 'guide') { this.setMode('overview'); this.stack && this.stack.recenter(); this.map.snap(); }
    if (v === 'stack' && this._introPending && this.stack) { this._introPending = false; this.stack.recenter(); this.stack.startIntro(); }
    this.ctx.events.emit('phone:stack', { open: v === 'stack' });
    this._bands();
    this._guideKey = ''; this._renderGuide(true);
    this._syncLadder();
  }
  toggleStack() { if (this.picking && this.view === 'guide') return; this.setView(this.view === 'stack' ? 'guide' : 'stack'); }

  onShow() { this._guideKey = ''; this.hdr && this.hdr.reset(); this._hdrT = 0; }

  // --------------------------------------------------------------- update ---
  // visible: the phone is up on Lodestone; glancing: the phone is lowered (the glance card needs the next step);
  // active: the phone is not pocketed (route + on-track checks keep running, e.g. with Messages up)
  update(dt, visible, glancing, active = glancing) {
    // the canyon note is cheap and runs even with the phone down (v4: arrival is phone.dest's, on the true position)
    if (this.state === 'ready') this._viaCheck(dt);
    if (this._revealT > 0) { this._revealT -= dt; if (this._revealT <= 0) this.el.main.classList.remove('reveal'); }
    if (this._heroT > 0) { this._heroT -= dt; if (this._heroT <= 0 && this.view === 'stack') this.setView('guide'); }
    if (this.state === 'idle') return;
    if (this.state === 'installing') { this.t += dt; this._tickInstall(dt); }
    else if (this.state === 'calibrating') { this.t += dt; this._tickCalib(dt, visible); }
    else if (this.state === 'ready' && visible) { this.t += dt; this._tickMain(dt); }
    else if (this.state === 'ready' && (glancing || active)) this._routeTick(dt);
    if (this.state === 'ready' && (visible || glancing || active) && this.dest && !this.arrived) this.track.update(dt, this.route);
  }
  // a fresh route right now (the tracker's reroute)
  forceRoute() {
    this._lastPos = [1e9, 1e9, '']; this._rt = 0;
    this._routeTick(0);
    this._guideKey = '';
  }
  _trackChanged() { this._guideKey = ''; this._hdrT = 0; if (this.state === 'ready') this._renderGuide(true); this.phone.glance && this.phone.glance.refresh(true); }
  // the angle the live arrow should show (deg, + = clockwise): the tracker's heading error
  liveAngle() { return this.track.active ? this.track.err : this._relBearing(); }

  // -------------------------------------------------------------- install ---
  _tickInstall() {
    const T = this.T_INSTALL, p = Math.min(1, this.t / T), e = p < 0.6 ? p / 0.6 * 0.55 : 0.55 + (p - 0.6) / 0.4 * 0.45;   // fast then slower: feels like a store install
    this.el.bar.style.width = `${(e * 100).toFixed(1)}%`;
    this.el.iState.textContent = p < 0.45 ? `Downloading… ${Math.round(e * 100)}%` : p < 1 ? 'Installing…' : 'Opening…';
    if (this.t >= T + 0.15) { this.t = 0; this._set('calibrating'); this.phone.upgradeStage = 'calibrating'; this._initField(); this.ctx.events.emit('phone:upgrade', { stage: 'calibrating' }); }
  }

  // ---------------------------------------------------------- calibration ---
  // v8 (item 4): four plain steps tick off over the same 3 s, beside one picture (ldmap.js calib): the compass reads
  // the field → the floor plan around you appears and the guesses converge → your floor is found (the floor bar locks
  // onto it) → the blue dot lands, ±1 m. The floor and position are the TRUE ones (what Lodestone is about to show).
  _initField() {
    this._calStage = -1; this._calFloor = null;
    this.el.cSteps.forEach(li => { li.className = ''; });
    const b = this.ctx.player.body;
    this._calLevel = b.level;
    this.el.cSteps[2].querySelector('span').textContent = CAL_STEPS[2];
  }
  _calStageAt(q) { let i = 0; while (i < 4 && q >= CAL_DONE[i]) i++; return i; }      // 0..3 = working on it, 4 = all done
  calibLabel() {
    const i = this._calStageAt(Math.min(1, this.t / this.T_CALIB));
    return i === 3 || i >= 4 ? `You’re here · ${lvl(this._calLevel || this.ctx.player.body.level)} · ±1 m` : i === 2 ? CAL_STEPS[2] : CAL_STEPS[i];
  }
  _tickCalib(dt, visible) {
    const T = this.T_CALIB, p = Math.min(1, this.t / T), tt = this.t * 1.1;
    if (!visible) { this.phone.sway = null; if (this.t >= T) this._finish(); return; }
    // wobble the phone (figure-of-8 "calibration" gesture) while it reads the field, then hold it still
    const wob = Math.max(0, 1 - Math.max(0, p - CAL_DONE[1]) / 0.2);
    this.phone.sway = { x: Math.sin(tt * 2.6) * 11 * wob, y: Math.sin(tt * 5.2) * 6 * wob, r: Math.sin(tt * 2.6 + 0.6) * 4.2 * wob };
    const body = this.ctx.player.body;
    try { this.map.calib(this.el.field, p, this.t, body); } catch (e) { if (!this._calErr) { this._calErr = 1; console.error('[lodestone calib]', e); } }
    // the checklist
    const st = this._calStageAt(p);
    if (st !== this._calStage) {
      this._calStage = st;
      this.el.cSteps.forEach((li, i) => { li.className = i < st ? 'ok' : i === st ? 'on' : ''; });
      if (st >= 3) this.el.cSteps[2].querySelector('span').innerHTML = `Finding your floor… <b>${esc(lvl(body.level))}</b>`;
    }
    // the floor bar: dim, scans while finding the floor, then locks onto yours
    const F = this.el.cFloors.children, n = F.length;
    let fi = -1; for (let i = 0; i < n; i++) if (F[i].dataset.l === body.level) fi = i;
    let scan = -1, found = false;
    if (p >= CAL_DONE[2]) found = true;
    else if (p >= CAL_DONE[1]) { const s3 = (p - CAL_DONE[1]) / (CAL_DONE[2] - CAL_DONE[1]); scan = Math.round(Math.max(0, Math.min(n - 1, fi + Math.sin(s3 * 11) * (1 - s3) * (n * 0.55)))); }
    const key = scan + ':' + found;
    if (key !== this._fKey) { this._fKey = key; for (let i = 0; i < n; i++) { F[i].classList.toggle('scan', i === scan); F[i].classList.toggle('found', found && i === fi); } }
    if (this.t >= T) this._finish();
  }
  _nLevels() { return this.el.cFloors.children.length; }

  _finish() {
    this.phone.sway = null;
    const ph = this.phone;
    ph.pos.setMode('lodestone');
    ph.upgradeStage = 'ready'; ph._readyAt = ph._play || 0;
    this._set('ready'); this.t = 0;
    ph.home && ph.home.addLodestone();
    ph._dockAddLodestone && ph._dockAddLodestone();
    ph.messages && ph.messages.markInstalled();
    if (!this.stack) { try { this.stack = this._makeStack(); this.stack.setDestination(this.dest || null); } catch (e) { console.error(e); } }
    this._rt = 0; this._lastPos = [1e9, 1e9, ''];
    this._shownLevel = ph.pos.level;
    this.view = 'guide'; this.el.main.dataset.view = 'guide'; this._bands();
    this.setMode('overview');
    if (this.stack) this.stack.recenter();
    this._introPending = true;           // v8: the 3D stack's fly-in plays the first time V opens it
    this.map.snap(); this.hdr.reset();
    // the snap: one big plain line first, then the guidance slides in
    this._revealT = 2.3; this.el.main.classList.add('reveal');
    this._showCard(`You’re on ${lvl(ph.pos.level)}`, `${this._zoneName()} · ±1 m`, true);
    this._guideKey = '';
    this._syncDest(); this._syncPick();
    // v8 critic: the hero beat for the indoor-positioning audience. The floor stack flies in (you, the route climbing
    // the real escalators to the destination's floor), holds a moment, then settles to the top-down map
    if (this.stack && this.stack.ready && this.dest) this.setView('stack', true);
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
    c.innerHTML = `<div class="ld-c-ck">${CHECK}</div><div><b>${esc(title)}</b><small>${esc(sub)}</small></div>`;
    c.classList.remove('in', 'out'); void c.offsetWidth; c.classList.add('in');
    this._cardT = big ? 2.4 : 1.8;
  }
  _syncLadder() {
    const cur = this._peek && this._peekT > 0 ? this._peek : this.phone.pos.level;
    const rl = this.stack && this.stack.routeLevels;
    this.el.ladder.querySelectorAll('button').forEach(b => {
      const l = b.dataset.l;
      b.classList.toggle('me', l === this.phone.pos.level);
      b.classList.toggle('on', l === cur);
      b.classList.toggle('route', !!(rl && rl.has(l)));
      b.classList.toggle('dest', !!this.dest && l === this.dest.level);
    });
  }

  // route / guidance at ~2 Hz when the player moved (runs with the phone up OR lowered to a glance)
  _routeTick(dt) {
    const body = this.ctx.player.body;
    // v6: stepping on / off an escalator or stairs re-plans at once ("Riding up to 3F" from the first step, not 0.5 s on)
    const onRamp = body.ramp >= 0;
    if (onRamp !== this._onRamp) { this._onRamp = onRamp; this._rt = 0; this._lastPos = [1e9, 1e9, '']; }
    this._rt -= dt;
    if (this._rt > 0) return false;
    this._rt = 0.5;
    const moved = Math.hypot(body.x - this._lastPos[0], body.z - this._lastPos[1]);
    if (!(moved > 0.9 || body.level !== this._lastPos[2] || !this.route)) return false;
    this._lastPos = [body.x, body.z, body.level];
    if (!this.guid) return false;
    const r = this.guid.compute(body, this.phone.pos.heading);
    // a route with NaN/Infinity in it is never shown: keep the last good one
    if (r && r.ok) { this.route = r; this._stackRoute = false; } else if (r && !r.bad) { this.route = r; }
    // v5: the next milestone (+ the shop you'll pass on a long leg); 'nav:milestone' when it changes
    const R = this.route;
    this._pass = R && R.ok && R.steps[0] ? this.pass.pick(R, R.steps[0].at, body) : null;
    this._emitMilestone();
    return true;
  }

  // v5: the next thing to expect on the route (ctx.phone.nextMilestone), fresh side vs the current heading
  milestone() {
    const R = this.route;
    if (this.state !== 'ready' || !this.dest || this.arrived || !R || !R.ok || !R.steps.length) return null;
    const m = milestoneOf(R.steps[0], this.dest, this.phone.pos, this._mSide, R.steps[1]);
    if (!m) return null;
    this._mSide = m.side;
    m.app = 'lodestone';
    if (this._pass && m.dist > 60) m.pass = { name: this._pass.name, dist: Math.round(this._pass.dist) };
    return m;
  }
  _emitMilestone() {
    // v5 critic: position in 8 m buckets (a zone-entry point drifts a metre or two per recompute: the event fired every ~2 s)
    const m = this.milestone();
    const key = m ? [m.kind, m.dir, m.toLevel, m.name || '', m.turn || '', m.level, Math.round(m.x / 8), Math.round(m.z / 8)].join('|') : '';
    if (key === this._msKey) return; this._msKey = key;
    if (m) this.ctx.events.emit('nav:milestone', m);
  }

  _tickMain(dt) {
    const ph = this.phone, p = ph.pos, S = this.stack;
    const body = this.ctx.player.body;
    if (this._peekT > 0) { this._peekT -= dt; if (this._peekT <= 0) { this._peek = null; this._syncLadder(); } }
    if (this._routeTick(dt)) { this._renderGuide(false); this._syncLadder(); }
    if (S && S.ready && !this._stackRoute && this.route && this.route.ok) { S.setRoute(this.route); this._stackRoute = true; this._syncLadder(); }
    // v8: the header — the same card as the glance strip, from the same glanceInfo()
    this._hdrT = (this._hdrT || 0) - dt;
    if (this._hdrT <= 0) { this._hdrT = 0.2; this.hdr.set({ cls: 'gl-ld', ...this.glanceInfo(true) }); }
    this.hdr.spin(dt);
    if (this.view === 'stack') {
      if (S && S.ready) {
        const y = body.ramp >= 0 ? body.y : LEVELS[p.level].y;
        S.setPlayer(p.x, p.z, p.level, p.heading, y);
        S.curLevel = this._peek && this._peekT > 0 ? this._peek : p.level;
        S.update(dt); S.render();
      }
    } else {
      // the free band of the map: under the header, above whatever card sits at the bottom (measured, cheap)
      this._bandT = (this._bandT || 0) - dt;
      if (this._bandT <= 0 || !this._band) {
        this._bandT = 0.3;
        const head = this.el.head, top = head.offsetTop + head.offsetHeight + 6;
        let bot = this.el.main.clientHeight || 676;
        for (const el of [this.el.trip, this.el.pick, this._prevEl, this.root.querySelector('.ld-next .dl-next')]) {
          if (!el || el.offsetParent === null || !el.offsetHeight) continue;
          const r = el.getBoundingClientRect(), mr = this.el.main.getBoundingClientRect(), sc = mr.height / (this.el.main.clientHeight || mr.height) || 1;
          bot = Math.min(bot, (r.top - mr.top) / sc - 6);
        }
        this._band = { top, bottom: bot };
      }
      try { this.map.draw(dt, { band: this._band, pos: p, level: p.level, route: this.route, dest: this.dest, ms: this.milestone() }); }
      catch (e) { if (!this._mapErr) { this._mapErr = 1; console.error('[lodestone map]', e); this.ctx.errors && this.ctx.errors.push('lodestone map: ' + e.message); } }
    }
    if (this._shownLevel !== p.level) {
      this._shownLevel = p.level; this._syncLadder();
      if (!this.revealing) this._showCard(`Now on ${lvl(p.level)}`, `${this._zoneName()}`, false);
    }
    this._whereT = (this._whereT || 0) - dt;
    if (this._whereT <= 0) {
      this._whereT = 0.4;
      const l = lvl(p.level), z = this._zoneName();
      if (this.el.wL.textContent !== l) this.el.wL.textContent = l;
      if (this.el.wZ.textContent !== z) this.el.wZ.textContent = z;
      if (!this._guideKey) this._renderGuide(true);
    }
    if (this._cardT > 0) { this._cardT -= dt; if (this._cardT <= 0) this.el.card.classList.add('out'); }
    else if (!this.el.card.hidden && this.el.card.classList.contains('out')) { this._cardOutT = (this._cardOutT || 0) + dt; if (this._cardOutT > 0.5) { this.el.card.hidden = true; this.el.card.classList.remove('out'); this._cardOutT = 0; } }
    this._signT = (this._signT || 0) - dt;
    if (this._signT <= 0) { this._signT = 0.5; this._renderGuide(false); }
  }

  // relative bearing (degrees, + = clockwise on screen) from the heading to the path ~14 m ahead
  _relBearing() {
    const R = this.route; if (!R || !R.ok || !R.ahead) return null;
    const p = this.phone.pos;
    const dx = R.ahead.x - p.x, dz = R.ahead.z - p.z;
    if (Math.hypot(dx, dz) < 1.5) return null;
    const bearing = Math.atan2(-dx, -dz);            // yaw convention: 0 = north / -Z, + turns left
    let d = bearing - p.heading; d = Math.atan2(Math.sin(d), Math.cos(d));
    return -d * 180 / Math.PI;
  }
  // v5.1: the words never contradict the arrow. A turn word ("Turn left") and a door side ("— on your left") are
  // relative to the PATH, the arrow to YOU: facing away from the path, "Turn left · in 5 m" sat next to an arrow
  // pointing right. While |arrow| is large (in > 50°, out < 30°; around > 140°, back < 120°) the title follows the
  // arrow and the milestone moves to a "then" line. A cue that agrees with the turn word is not used (at every corner
  // the arrow already swings toward the turn). Returns null, or { title, icon, then } for the milestone m / text tx.
  _faceCue(m, tx) {
    const a = this.liveAngle();
    const k = this._face, A = a == null ? 0 : Math.abs(a);
    this._face = a == null || !(A > (k ? 30 : 50)) ? null : A > (k === 'around' ? 120 : 140) ? 'around' : 'side';
    if (!this._face || !m || !tx) return null;
    if (!(m.kind === 'turn' || (m.kind === 'arrive' && m.dist < NEAR_M))) return null;
    const side = a > 0 ? 'right' : 'left';
    if (this._face === 'side' && m.kind === 'turn' && m.turn === side) return null;
    const d = Math.round(m.dist), when = d < 3 ? 'now' : 'in ' + fm(d);
    const word = tx.title.charAt(0).toLowerCase() + tx.title.slice(1);
    return this._face === 'around'
      ? { title: 'Turn around', icon: side === 'right' ? 'uright' : 'uleft', then: `${word} · ${when}`, ticon: tx.icon }
      : { title: `Turn ${side}`, icon: side, then: `${word} · ${when}`, ticon: tx.icon };
  }
  _viaCheck(dt) {
    if (!this.guid || this._via.done) return;
    this._at = (this._at || 0) - dt; if (this._at > 0) return; this._at = 0.4;
    const b = this.ctx.player && this.ctx.player.body; if (b) this.guid.noteBody(b);   // has the player been out in the canyon yet?
  }
  _arrive() {
    if (this.arrived) return;
    this.arrived = true; this._arrStats = this.phone.stats(); this._arrAt = this.phone._play || 0;
    this._choosing = false;
    this._guideKey = ''; if (this.state === 'ready') this._renderGuide(true);
    this._syncPick();
    if (this.state !== 'ready' || !this.dest) return;
    this.ctx.events.emit('phone:arrive', { id: 'b:' + (this.dest.slot || this.dest.id), source: 'lodestone' });
    this.ctx.events.emit('lodestone:arrive', { id: this.dest.slot || this.dest.id });
  }

  // ---------------------------------------------------------- destinations ---
  _guidFor(d) {
    let g = this._guids.get(d.id);
    if (!g) { g = new Guidance(this.ctx, d, this._via); this._guids.set(d.id, g); }
    return g;
  }
  // metres of path left to `d` (for the shared arrival check), Infinity when unknown
  remainingTo(d, body) {
    if (this.state !== 'ready' || !this.dest || this.dest.id !== d.id || !this.guid || !this.guid.field) return Infinity;
    return this.guid.remaining(body);
  }
  // phone.dest changed (picked here, in Maps, or by the story)
  onDestination(d) {
    this.dest = d || null; this.guid = d ? this._guidFor(d) : null;
    this.route = null; this._stackRoute = false; this.arrived = false; this._arrStats = null; this._choosing = false;
    this.track.reset(); this._lastPos = [1e9, 1e9, '']; this._rt = 0; this._guideKey = '';
    if (this.stack && this.stack.ready) { this.stack.setDestination(this.dest); this.stack.setRoute(null); }
    this._syncDest(); this._syncPick(); this._syncLadder();
    if (this.state === 'ready') { this._renderGuide(true); this.phone.glance && this.phone.glance.refresh(true); }
  }
  onArrived(d) { if (this.dest && d && d.id === this.dest.id) this._arrive(); }
  onListChanged() { this._syncPick(); this._guideKey = ''; }
  // "Next: <Aya's pick>" chip above the trip card while guiding somewhere else (1 / click takes it)
  _syncNext() {
    const c = this.state === 'ready' && !this.picking ? nextChip(this.phone) : null;
    this._next = c;
    const key = c ? c.id : '';
    if (key === this._nextKey) return; this._nextKey = key;
    this.el.main.classList.toggle('has-next', !!c);
    const box = this.root.querySelector('.ld-next');
    box.innerHTML = nextChipHtml(c, this.list.touch, 'dl-next-lode');
    const b = box.querySelector('.dl-next'); if (b) b.addEventListener('click', (e) => { e.stopPropagation(); this._next && this._next.pick(); });
  }
  // "Change" (true) / back to the route (false)
  choose(on) {
    if (this.state !== 'ready') return;
    this._choosing = !!on && !!this.dest && !this.arrived;
    if (on && this.view !== 'guide') this.setView('guide');
    this._syncPick();
    this._guideKey = ''; this._renderGuide(true);
  }
  get picking() { return this.state === 'ready' && (!this.dest || this.arrived || this._choosing); }
  activeList() {
    if (this.state === 'ready' && this._prev) return this._prevList;
    if (this.view !== 'guide' || this.state !== 'ready') return null;
    if (!this.picking) return this._next || null;
    return this.list.items.length ? this.list : null;
  }
  focusSearch() { if (this.state !== 'ready') return false; this.closePreview(); if (!this.picking) this.choose(true); return this.list.focusSearch(); }
  // ---- v5: a place link from Aya's text → its card (photo, floor, TRUE distance) → Go -----------------------
  preview(id) {
    if (this.state !== 'ready') return false;
    const D = this.phone.dest, d = D && D.resolve(id); if (!d) return false;
    if (this.view !== 'guide') this.setView('guide');
    this._prev = id;
    const b = businessBySlot[id], touch = this.list.touch;
    let far = '';
    try { const g = this._guidFor(d); const m = g.remaining(this.ctx.player.body); if (isFinite(m)) far = `${fm(m)} · ${Math.max(1, Math.round(m / 1.4 / 60))} min walk`; } catch (e) { /* distance is optional */ }
    const sub = b ? bizSub(b, this.ctx.clock.minutes) : null;
    const art = b ? `<img class="ld-pv-ph" src="${placeArt(b)}" alt="">` : `<i class="ld-pv-gl">${esc(d.icon || '📍')}</i>`;
    const status = sub ? (sub.status ? `<u class="cl">${esc(sub.status)}</u>` : '<u class="op">Open now</u>') : '';
    this._prevEl.innerHTML = `${art}<button class="ld-pv-x" type="button" aria-label="Close">×</button>
      <div class="ld-pv-b"><em>From Aya’s message</em><b>${esc(d.name)}</b>
        <small>${esc(sub ? sub.sub : `${lvl(d.level)}${d.zone ? ' · ' + zoneShort(d.zone) : ''}`)}</small>
        <p><span class="ld-pv-l">${lvl(d.level)}</span>${far ? `<span>${esc(far)}</span>` : ''}${status}</p>
        <button class="ld-pv-go" type="button">Go${touch ? '' : ' <kbd>Enter</kbd>'}</button></div>`;
    this._prevEl.hidden = false;
    this.el.main.classList.add('previewing');
    this._prevEl.querySelector('.ld-pv-go').addEventListener('click', (e) => { e.stopPropagation(); this._goPreview(); });
    this._prevEl.querySelector('.ld-pv-x').addEventListener('click', (e) => { e.stopPropagation(); this.closePreview(); });
    this._prevList = { items: [{ id }], sel: 0, armed: true, move() {}, pick: () => { this._goPreview(); return true; } };
    return true;
  }
  _goPreview() {
    const id = this._prev; if (!id) return;
    this.closePreview();
    this.phone._lastPhoneInput = this.phone._now;
    this.list.reset();
    this.phone.setDestination(id, { app: 'lodestone', via: 'link' });
  }
  closePreview() {
    if (!this._prev) return false;
    this._prev = null; this._prevList = null;
    this._prevEl.hidden = true; this.el.main.classList.remove('previewing');
    return true;
  }
  _pickItem(it) {
    this.phone._lastPhoneInput = this.phone._now;
    if (this.list.input) this.list.input.blur();
    this.list.reset();
    this.phone.setDestination(it.id, { app: 'lodestone' });
  }
  _syncDest() {
    const d = this.dest;
    if (this.el.toL.textContent !== (d ? lvl(d.level) : '')) this.el.toL.textContent = d ? lvl(d.level) : '';
    if (this.el.toN.textContent !== (d ? d.name || d.en : '')) this.el.toN.textContent = d ? d.name || d.en : '';
  }
  _syncPick() {
    const on = this.picking;
    this.el.main.classList.toggle('picking', on);
    this.el.main.classList.toggle('choosing', on && this._choosing);
    if (on !== this._wasPicking) { this._wasPicking = on; this._bands(); }
    this._syncNext();
    if (on) this._renderList();
  }
  _renderList() {
    if (!this.picking) return;
    const D = this.phone.dest, sug = D ? D.suggested : null, q = this.list.query, M = this.phone.maps;
    const here = this.arrived && this.dest ? this.dest.id : null;
    const sugOk = sug && sug !== here ? sug : null;
    let items;
    if (q && M) {
      items = M.search(q).slice(0, 20).map(p => this._itemFor(destIdOf(p), destIdOf(p) === sugOk ? 'From Aya' : null, p)).filter(Boolean);
    } else items = defaultIds(sugOk, here).map(id => this._itemFor(id, id === sugOk ? (this.arrived ? 'Next · from Aya' : 'From Aya') : null)).filter(Boolean);
    this.list.render(items);
    this.list.setTitle(this.arrived ? 'Where next?' : this._choosing ? 'Change destination' : 'Where to?', '');
  }
  // Lodestone's row: the true floor + area (no misleading crow-flies number)
  _itemFor(id, aya, place) {
    if (!id) return null;
    const b = businessBySlot[id];
    if (b) { const s = bizSub(b, this.ctx.clock.minutes); return { id, name: b.en, icon: b.info.icon, aya, closed: s.closed, sub: s.status ? `${s.sub} · ${s.status}` : s.sub, right: lvl(b.level) }; }
    const p = place || (this.phone.maps && this.phone.maps.placeById(id)); if (!p || !LEVELS[p.level]) return null;
    return { id, name: p.en, icon: p.icon || (p.kind === 'transit' ? '🚇' : p.kind === 'exit' ? '🚪' : '📍'), aya, sub: String(p.sub || '').split(' · ').slice(0, 2).join(' · '), right: lvl(p.level) };
  }

  // ------------------------------------------------------------- glance ---
  // full: the raised app's own header (same card; its words fit a phone you are looking at)
  glanceInfo(full) {
    const p = this.phone.pos, here = `you’re on ${lvl(p.level)}`;
    const D = this.phone.dest, nx = D && D.next(), sug = nx && D.name(nx);
    if (full && !this.dest) return { kind: 'pick', icon: 'pin', title: 'Where to?', sub: `You’re on ${lvl(p.level)} · ${this._zoneName()} · ±1 m` };
    if (full && this.arrived) return { kind: 'arr', icon: 'flag', title: 'You’ve arrived', sub: `${this.dest.name || this.dest.en} · door ${this._doorSide()}` };
    if (!this.dest) return this.phone._ended
      ? { kind: 'pick', icon: 'pin', title: 'No route', sub: sug ? `Where to? · Aya: ${sug}` : `Where to? · ${here}` }      // v5: after End route — calm, no guidance
      : { kind: 'pick', icon: 'pin', title: 'Pick a place in Lodestone', sub: sug ? `Aya: ${sug}` : `Where to? · ${here}` };
    if (this.arrived) return { kind: 'arr', icon: 'flag', title: `Arrived · ${this.dest.name || this.dest.en}`, sub: sug ? `Next: ${sug}` : `${lvl(this.dest.level)} · ±1 m` };
    const R = this.route;
    if (!R || !R.ok) return { kind: 'wait', icon: 'straight', title: 'Finding your route…', sub: here };
    const cur = R.steps[0], toGo = Math.max(0, Math.round(isFinite(cur && cur.at) ? cur.at : 0));
    const sg = this.track.sign();
    if (sg) return { kind: 'nav', trk: sg.cls, icon: sg.check ? 'check' : 'straight', live: sg.live, ang: sg.live ? this.liveAngle() : null, angFn: sg.live ? () => this.liveAngle() : null, title: sg.short, sub: sg.gsub || sg.sub };
    // v5: ALWAYS the heading arrow (where to walk now) + the next milestone as a small icon and words.
    // Far: "Escalator down to 1F" · "In 165 m · past Sneaker Lab"; under 30 m it takes over: "Escalator down — on your left".
    const m = this.milestone(), tx = milestoneText(m);
    if (!m || !tx) { const ph = phrase(cur, this.dest); return { kind: 'nav', trk: 'trk-on', icon: 'straight', live: true, ang: this.liveAngle(), angFn: () => this.liveAngle(), title: ph.short, sub: `${toGo < 3 ? 'Now' : 'In ' + fm(toGo)} · ${here}` }; }
    const fc = this._faceCue(m, tx);
    if (fc) return { kind: 'nav', trk: 'trk-on', icon: 'straight', mic: fc.icon, live: true, ang: this.liveAngle(), angFn: () => this.liveAngle(), title: fc.title, sub: `Then ${fc.then}` };
    // v6 (item 7): on the escalator / stairs: "Riding up to 3F" · "Then turn right" (the arrow points along the ride)
    if (m.riding) return { kind: 'nav', trk: 'trk-on', icon: 'straight', mic: tx.icon, live: true, ang: this.liveAngle(), angFn: () => this.liveAngle(), title: tx.title, sub: tx.sub };
    const d = Math.round(m.dist), dt = d < 3 ? 'Now' : 'In ' + fm(d);
    const sub =m.dist < NEAR_M ? [dt, tx.sub].filter(Boolean).join(' · ') : m.pass ? `${dt} · past ${m.pass.name}` : `${dt} · ${tx.sub || here}`;
    return { kind: 'nav', trk: 'trk-on', icon: 'straight', mic: tx.icon, live: true, ang: this.liveAngle(), angFn: () => this.liveAngle(), title: tx.title, sub };
  }

  // ---------------------------------------------------------------- guide ---
  // v8: the header is the shared NavHeader (_tickMain); this keeps the rest in step: the ETA on the trip card, the
  // arrived state, and the full step list (the 3D view's sheet)
  _renderGuide(force) {
    const R = this.route, E = this.el, dest = this.dest;
    if (!dest) {
      if (!force && this._guideKey === 'pick') return; this._guideKey = 'pick';
      this.el.main.classList.remove('arrived'); E.toM.textContent = ''; E.steps.innerHTML = '';
      return;
    }
    if (this.arrived) {
      // the time of this leg with Lodestone (from the pick, or from the install when it was picked in Maps)
      const ld = this._legT0();
      const sec = Math.max(0, Math.round((this._arrAt || 0) - ld)), mm = Math.floor(sec / 60), ss = String(sec % 60).padStart(2, '0');
      const key = 'arrived:' + dest.id + sec;
      if (!force && key === this._guideKey) return; this._guideKey = key;
      this.el.main.classList.add('arrived'); E.toM.textContent = `${mm}:${ss}`;
      return;
    }
    this.el.main.classList.remove('arrived');
    if (!R || !R.ok) {
      if (!force && this._guideKey === 'noroute') return; this._guideKey = 'noroute';
      E.toM.textContent = ''; E.steps.innerHTML = '';
      return;
    }
    const st = R.steps, cur = st[0];
    const toGo = cur ? Math.max(0, Math.round(isFinite(cur.at) ? cur.at : 0)) : 0;
    const mins = !isFinite(R.eta) ? '' : R.eta < 45 ? '<1 min' : `${Math.max(1, Math.round(R.eta / 60))} min`;
    const key = [mins, st.length, st.map(s => s.title).join(','), Math.round(toGo / 5), this.view].join('|');
    if (!force && key === this._guideKey) return; this._guideKey = key;
    E.toM.textContent = mins;
    E.steps.innerHTML = st.map((s, i) => `<li class="${i === 0 ? 'cur' : ''}">${icon(s.icon, 'sm')}<span>${esc(phrase(s, dest).long)}</span><em>${i === 0 && toGo < 3 ? 'now' : fm(s.at)}</em></li>`).join('');
  }
  _legT0() {
    const D = this.phone.dest, leg = D && D.legs[D.legs.length - 1];
    const ready = this.phone._readyAt != null ? this.phone._readyAt : 0;
    return Math.max(leg ? leg.t0 : 0, ready);
  }
  _doorSide() { const s = this.route && this.route.steps && this.route.steps[this.route.steps.length - 1]; return s && /left|right|ahead/.test(s.sub) ? s.sub.split(' · ')[0].replace('on your ', 'on the ') : 'ahead'; }
}
