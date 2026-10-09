// =============================================================================
// Game flow (DEMO build): title -> arrival at Nankai Namba -> ONE quest (lunch at
// Tempura Daikichi, Namba Parks 6F) -> the ordinary map -> the Lodestone upgrade
// -> arrival -> end card -> free roam. Owns the quest, the ICOCA card, gates,
// the (minimal) pause menu and the discovery journal. The story beats live in
// demo.js; the words in script.js; the closing card in endcard.js.
// See notes/game.md and notes/demo-flow.md for the API other systems can use.
// =============================================================================
import { params } from '../core/params.js';
import { LAYOUT, spaceById } from '../world/layout.js';
import { BUSINESSES } from '../world/directory.js';
import { Interactions } from './interact.js';
import { Panels, yen, esc } from './panel.js';
import { Journal } from './journal.js';
import { loadSettings, applySettings, buildSettingsPanel, buildControlsCard } from './settings.js';
import { Title } from '../ui/title.js';
import { Demo } from './demo.js';
import * as V from './vignettes.js';
import { QUESTS, DEMO, ENDCARD } from './script.js';
import { orderItem, hasCounter } from './order.js';
import { contactLinks } from './endcard.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const hhmm = (m) => { m = ((Math.round(m) % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
const COFFEE_CATS = new Set(['cafe', 'kissaten', 'coffeestand']);
const MIN_FARE = 190;
const GATE_PROMPT_M = 1.6;   // v8: the IC tap prompt only shows this close to a gate lane (gates.js NEAR_V is 2.4)
// v6: what a tap-out costs (IC fares, 2024): the airport ride you just took, and the metro's minimum
const FARES = {
  nankai: { amount: 970, note: '関西空港 → なんば · Kansai Airport → Namba' },
  metro: { amount: MIN_FARE, note: '' },
};
const TAP_REOPEN_S = 25;     // tapping the same lane again soon after (didn't walk through) never charges twice

export class Game {
  constructor(ctx) {
    this.ctx = ctx;
    this.started = false; this.paused = false; this.ended = false; this.finished = false;
    this.busy = false; this.phoneOpen = false; this.intro = false;
    this.ic = { balance: 3000 };
    this.quests = {};
    for (const id of Object.keys(QUESTS)) this.quests[id] = { id, state: 'hidden', ...QUESTS[id], notes: [] };
    this.meals = [];
    this._timers = [];
    this._doors = {};        // trackId -> bool (from train events, fallback)
    this._sawTrainEvents = false;
    this.paidArea = null;
    this._prev = null;
    this._msgId = 0;
    this._rt = 0; this._tap = null; this._gateTgt = null;
  }

  // ---------------------------------------------------------------------------
  async init() {
    const { ctx } = this;
    this.quiet = params.test && !params.has('play');
    this.settings = loadSettings();
    applySettings(ctx, this.settings);
    this.hud = ctx.hud || null;
    this.interactions = new Interactions(ctx);
    // v2 item 7: service counters from the Shops agent (ctx.counters) -> order / say hi at the order spot
    this.orders = [];
    this.interactions.counterItem = (c) => (c && c.slotId && c.slotId !== DEMO.slot ? orderItem(this, c) : null);
    this.interactions.counterCovers = (it) => !!(it.business && hasCounter(this, it.business.slot));
    this.panels = new Panels(ctx);
    this.journal = new Journal(ctx, this);
    this.meals = this.journal.meals;
    this.title = new Title(ctx, { onBegin: () => this._begin() });
    this.demo = new Demo(ctx, this);
    this.story = this.demo.story;            // v3: Aya's conversation + the tutorial (story.js)
    // public API
    this.addInteractable = (def) => this.interactions.add(def);
    this.removeInteractable = (id) => this.interactions.remove(id);
    this.discover = (id, en, ja) => this.journal.discover(id, en, ja);
    // v6: ONE way to pay with the ICOCA card (gates, café orders, vignettes, machines) — see icCharge below
    // discoveries are quiet in the demo: only the two real wonders get a soft place-name card
    this.onDiscover = (d) => { if (this.quiet || this.ended || this.intro || this.demo.arrived) return; if (d.id === 'canyon' || d.id === 'parks') this.hud?.chapter({ ja: d.ja, en: d.en, sub: '' }, 4.5); };

    this._gates = LAYOUT.gates.map(gt => this._gateInfo(gt));
    try { this._registerShops(); } catch (e) { console.error('[game] shops', e); }
    try { this._registerMachines(); } catch (e) { console.error('[game] machines', e); }
    this._buildPause();

    const ev = ctx.events;
    ev.on('game:ready', () => {
      // shops/transit may expose richer anchors only after their init
      try { this._refreshShopAnchors(); } catch (e) { /* optional */ }
      if (!params.skip) this._showTitle();
    });
    ev.on('phone:open', () => { this.phoneOpen = true; });
    ev.on('phone:close', () => { this.phoneOpen = false; });
    ev.on('train:arrive', (t) => { if (t && t.track) { this._doors[t.track] = true; this._sawTrainEvents = true; } });
    ev.on('train:depart', (t) => { if (t && t.track) { this._doors[t.track] = false; this._sawTrainEvents = true; } });
    ev.on('player:teleport', () => { this._prev = null; this._tap = null; this.journal.resetTracking(); this._recomputePaid(); });
    // v6: the Gates agent's reactive gates (notes/v6-gates.md): the player walks through a lane they tapped
    ev.on('gate:pass', (e) => { if (e && this._isPlayerGateEv(e) && this._tap && this._tap.gate === e.gate) this._tap.passed = true; });

    // pointer lock → pause
    const canvas = ctx.engine && ctx.engine.renderer ? ctx.engine.renderer.domElement : document.getElementById('view');
    this._canvas = canvas;
    document.addEventListener('pointerlockchange', () => {
      const locked = !!document.pointerLockElement;
      if (locked) { this._everLocked = true; if (this.paused) this.resume(true); return; }
      clearTimeout(this._unlockT);
      this._unlockT = setTimeout(() => {
        if (document.pointerLockElement) return;
        if (this.started && !this.paused && !this.phoneOpen && !this._allowUnlock && this._everLocked && !this._endCard) this.pause();
      }, 140);
    });
    canvas.addEventListener('click', () => {
      if (this.started && !this.paused && !this._endCard && !this.ctx.input.locked) this.ctx.input.requestLock();
    });
    addEventListener('blur', () => { if (this.started && !this.paused && !this._endCard && this._everLocked && !this.quiet) this.pause(); });
  }

  // ---------------------------------------------------------------------------
  // Title & start
  _showTitle() {
    this.titleUp = true;
    this.ctx.clock.paused = true;
    this.hud?.setVisible(false);
    this.title.show();
    this._syncFrozen();
  }
  _begin() {
    this._fromTitle = true;
    this.titleUp = false;
    this.ctx.start();
  }
  onStart() {
    const { ctx } = this;
    this.started = true;
    this.titleUp = false;
    if (this._fromTitle) {
      ctx.teleport && ctx.teleport('start');
      if (ctx.player) ctx.player.pitch = 0;
    }
    ctx.clock.paused = false;
    this.hud?.setVisible(true);
    this._recomputePaid();
    this.journal.begin();
    this._syncFrozen();
    if (this.quiet) {
      // test harness: the goal is active silently, no intro, no story timers
      for (const id in this.quests) this.quests[id].state = 'active';
      return;
    }
    this.demo.begin({ cinematic: true });
  }
  // glide the view toward a direction (vignettes: the counter, the fryer) — the world stays live
  lookDir(dx, dz, pitch = -0.2, rate = 2.2) { this._look = { yaw: Math.atan2(-dx, -dz), pitch, rate }; }
  lookYaw(yaw, pitch = 0, rate = 1.6) { this._look = { yaw, pitch, rate }; }
  clearLook() { this._look = null; }
  _stepLook(dt) {
    const L = this._look, p = this.ctx.player; if (!L || !p) return;
    let d = L.yaw - p.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    const k = Math.min(1, dt * L.rate);
    p.yaw += d * k; p.pitch += (L.pitch - p.pitch) * k;
  }
  after(sec, fn) { this._timers.push({ t: sec, fn }); }

  // ---------------------------------------------------------------------------
  // Quests & messages
  setQuest(id, state, detail, silent) {
    const q = this.quests[id]; if (!q) return;
    const prev = q.state;
    q.state = state;
    if (detail) { q.detail = detail; q.notes.push(detail); }
    if (state === 'done') q.doneAt = this.ctx.clock.hhmm;
    this.ctx.events.emit('quest:update', { id, state, text: q.text, textJa: q.textJa, detail: q.detail });
  }
  noteQuest(id, note) {
    const q = this.quests[id]; if (!q) return;
    q.detail = note; q.notes.push(note);
    this.ctx.events.emit('quest:update', { id, state: q.state, text: q.text, textJa: q.textJa, detail: note });
  }
  message(text, from = 'Aya', delaySec = 0, extra = null) {
    if (!text) return;
    // v3: Aya's texts go through her outbox (typing indicator, never two at once — story.js / aya.js)
    if (from === 'Aya' && this.story && this.story.aya) { this.story.aya.say(Object.assign({ text }, extra || {}), { wait: delaySec }); return; }
    const send = () => {
      const m = Object.assign({ id: ++this._msgId, from, text, time: this.ctx.clock.hhmm }, extra || {});
      this.ctx.events.emit('phone:message', m);
    };
    if (delaySec > 0) this.after(delaySec, send); else send();
  }

  // ---------------------------------------------------------------------------
  // Pause
  _buildPause() {
    const el = document.createElement('div');
    el.className = 'g-pause';
    el.hidden = true;
    el.innerHTML = `
      <div class="p-side">
        <div class="p-head"><div class="p-kana">一時停止</div><div class="p-en">Paused</div></div>
        <div class="p-where"></div>
        <nav class="p-nav">
          <button type="button" data-a="resume" class="sel">Resume <small>再開</small></button>
          <button type="button" data-a="settings">Settings <small>設定</small></button>
          <button type="button" data-a="controls">Controls <small>操作</small></button>
          <button type="button" data-a="restart" class="p-restart">Restart <small>最初から</small></button>
        </nav>
        <p class="p-esc"><b>Esc</b> frees your mouse and opens this menu. <b>Click Resume</b>, or anywhere outside the menu, and the mouse steers your view again.</p>
      </div>
      <div class="p-body"></div>`;
    (this.ctx.ui.overlay || document.body).appendChild(el);
    this.pauseEl = el;
    const body = el.querySelector('.p-body');
    const show = (a) => {
      el.querySelectorAll('.p-nav button').forEach(b => b.classList.toggle('sel', b.dataset.a === a));
      body.innerHTML = '';
      if (a === 'settings') { body.insertAdjacentHTML('beforeend', '<h3>Settings <small>設定</small></h3>'); body.appendChild(buildSettingsPanel(this.ctx)); }
      else if (a === 'controls') { body.insertAdjacentHTML('beforeend', '<h3>Controls <small>操作</small></h3>'); body.appendChild(buildControlsCard()); }
      else if (a === 'restart') body.appendChild(this._restartView());
      else body.appendChild(this._aboutView());
      this._pauseView = a;
    };
    this._pauseShow = show;
    // v7.3: a click on the empty backdrop resumes (a click is the user gesture pointer lock needs; Esc is not one)
    el.addEventListener('click', (e) => { if (e.target === el || e.target === body) this.resume(); });
    el.querySelectorAll('.p-nav button').forEach(b => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const a = b.dataset.a;
      if (a === 'resume') this.resume();
      else show(a);
    }));
  }
  _aboutView() {
    const d = document.createElement('div');
    d.className = 'p-goals';
    // the quest, plus Aya's coffee errand once she has asked (v4)
    const qs = [this.quests.tempura, this.quests.coffee].filter(q => q && (q.id === 'tempura' || q.state !== 'hidden'));
    d.innerHTML = `<h3>Today <small>今日の予定</small></h3>
      <ul>${qs.map(q => `<li class="${q.state}"><span class="p-check"></span><div><b>${esc(q.text)}</b><small>${esc(q.textJa)}</small><p>${esc(q.detail || '')}</p></div></li>`).join('')}</ul>
      ${this.orders.length ? `<h3 class="p-sub">Ordered <small>注文</small></h3><div class="p-orders">${this.orders.map(o => `<div class="p-order"><span>${esc(o.icon || '☕')}</span><b>${esc(o.item)}</b><i>${esc(o.name)}</i><small>${esc(o.at)}</small></div>`).join('')}</div>` : ''}
      <p class="p-hint">Q lifts and lowers your phone (or hold right-click for a quick look); Tab switches apps, 1 2 3 reply. Mouse looks, WASD walks, E interacts. Esc brings this menu back.</p>
      ${ENDCARD.agent || ENDCARD.call ? `<div class="p-talk"><h3 class="p-sub">Built by Zack Niv <small>${esc(ENDCARD.invite || '')}</small></h3><div class="e-links">${contactLinks()}</div></div>` : ''}`;
    d.querySelectorAll('.e-link').forEach(x => x.addEventListener('click', (ev) => ev.stopPropagation()));
    return d;
  }
  // v3 item 6: "Restart" asks first. Confirm = a clean reload to the title (the title click is the user gesture
  // audio and pointer lock need). v7: the hints show again on the new run (tutorial.js).
  _restartView() {
    const d = document.createElement('div');
    d.className = 'p-confirm';
    d.innerHTML = `<h3>Restart <small>最初から</small></h3>
      <p class="p-confirm-q">Are you sure?</p>
      <p class="p-confirm-sub">Your progress will be lost. You'll start again on the platform, fresh off the rapi:t.</p>
      <div class="p-confirm-btns">
        <button type="button" class="g-btn" data-c="cancel">Cancel <small>やめる</small></button>
        <button type="button" class="g-btn danger" data-c="restart">Restart <small>最初から</small></button>
      </div>`;
    d.querySelector('[data-c="cancel"]').addEventListener('click', (e) => { e.stopPropagation(); this._pauseShow('about'); });
    d.querySelector('[data-c="restart"]').addEventListener('click', (e) => { e.stopPropagation(); this.restart(); });
    return d;
  }
  pause() {
    if (this.paused || !this.started) return;
    this.paused = true; this.ctx.paused = true;
    this._pauseAt = performance.now();
    this.ctx.clock.paused = true;
    const p = this.ctx.player;
    const lv = p ? p.body.level : '';
    const zone = p && p.zone && LAYOUT.ZONES[p.zone];
    this.pauseEl.querySelector('.p-where').innerHTML = `<b>${this.ctx.clock.hhmm}</b> · ${esc(zone ? zone.name : 'Namba')} · ${esc(lv)}<br><span>${esc(zone ? zone.ja : '')}</span>`;
    this._pauseShow('about');
    this.pauseEl.hidden = false;
    requestAnimationFrame(() => this.pauseEl.classList.add('on'));
    this.hud?.prompt(null);
    this._syncFrozen();
    this.ctx.events.emit('game:pause', {});
  }
  resume(fromLock) {
    if (!this.paused) return;
    this.paused = false; this.ctx.paused = false;
    if (!this.titleUp) this.ctx.clock.paused = false;
    this.pauseEl.classList.remove('on');
    setTimeout(() => { if (!this.paused) this.pauseEl.hidden = true; }, 300);
    if (!fromLock) this.ctx.input.requestLock();
    this._syncFrozen();
    this.ctx.events.emit('game:resume', {});
  }
  restart() {
    if (this._restarting) return;
    this._restarting = true;
    this.ctx.events.emit('game:restart', {});
    const u = new URL(location.href);
    ['skip', 'test', 'spawn', 'pos', 'yaw', 'pitch', 'play', 'offerat', 'tutorial'].forEach(k => u.searchParams.delete(k));
    try { this.pauseEl.classList.add('leaving'); } catch (e) { /* cosmetic */ }
    setTimeout(() => { location.href = u.toString(); }, 180);
  }
  _syncFrozen() {
    const p = this.ctx.player; if (!p) return;
    p.frozen = !this.started || this.titleUp || this.paused || this.busy || this.intro || this.ended;
  }

  // run a vignette: freezes the player, blocks other interactions
  async vignette(kind, fn) {
    if (this.busy) return;
    this.busy = true; this._syncFrozen();
    this.hud?.prompt(null);
    this.ctx.events.emit('vignette:open', { kind });
    try { await fn(); } catch (e) { console.error('[vignette]', kind, e); this.hud?.fade(0, 300); }
    this.busy = false; this.clearLook(); this._syncFrozen();
    this.ctx.events.emit('vignette:close', { kind });
  }

  // ---------------------------------------------------------------------------
  // Interactables: shops & restaurants
  // where to stand to use a business: the service counter inside (coffee),
  // or the doorway (restaurants: the line, the ticket machine, the sign)
  _shopAnchor(b, atDoor) {
    const sh = this.ctx.shops;
    if (!atDoor && sh && sh.counter) {
      const c = safe(() => sh.counter(b.slot));
      if (c && isFinite(c.x) && isFinite(c.z)) return { x: c.x, z: c.z, radius: 3.6, counter: true };
    }
    if (atDoor && sh && sh.queuePoints) {
      const q = safe(() => sh.queuePoints(b.slot));
      if (q && q[0] && isFinite(q[0].x)) return { x: (q[0].x + b.door.x) / 2, z: (q[0].z + b.door.z) / 2, radius: 3.4 };
    }
    return { x: b.door.x - b.door.nx * 0.6, z: b.door.z - b.door.nz * 0.6, radius: 3.6 };
  }
  _registerShops() {
    for (const b of BUSINESSES) {
      const cat = b.cat;
      const info = b.info || {};
      let def = null;
      const sub = `${b.en} · ${b.ja}`;
      if (b.key === 'tempura_great') {
        // the destination: nothing to "use" here, the arrival moment is automatic. Afterwards, free roam.
        def = { prompt: this.demo.arrived ? 'Smell the sesame oil' : 'Tempura Daikichi', promptJa: '天ぷら 大吉', onUse: () => this.demo.sizzle(),
          view: () => ({ prompt: 'Breathe in', promptJa: '天ぷら 大吉', sub }) };
      } else if (b.key === 'tempura_tendon' || b.key === 'tempura_closed') {
        def = { prompt: 'Look inside', promptJa: 'のぞく', onUse: () => V.peek(this, b) };
      } else if (COFFEE_CATS.has(cat)) {
        // superseded: when the shop publishes an order spot (ctx.counters) the quick non-modal order at the counter
        // replaces this modal menu (see order.js); without one the old vignette is still the fallback
        def = { prompt: 'Order a coffee', promptJa: '注文する', superseded: true, onUse: () => this.vignette('coffee', () => V.orderCoffee(this, b)) };
      } else if (info.food || cat === 'closed') {
        def = { prompt: cat === 'closed' ? 'Peer in' : 'Look inside', promptJa: 'のぞく', onUse: () => V.peek(this, b) };
      }
      if (!def) continue;
      const atDoor = !COFFEE_CATS.has(cat) || cat === 'closed';
      const a = this._shopAnchor(b, atDoor);
      this.interactions.add(Object.assign({
        id: 'shop:' + b.slot, level: b.level, x: a.x, z: a.z, radius: a.radius, space: b.slot,
        facing: a.counter ? null : { nx: b.door.nx, nz: b.door.nz }, sub, business: b,
      }, def));
    }
  }
  _refreshShopAnchors() {
    for (const b of BUSINESSES) {
      const it = this.interactions.get('shop:' + b.slot); if (!it || !COFFEE_CATS.has(b.cat)) continue;
      const a = this._shopAnchor(b, false);
      if (a.counter) { it.x = a.x; it.z = a.z; it.radius = a.radius; it.facing = null; }
    }
  }

  // ---------------------------------------------------------------------------
  // Gates: geometry, free side, IC taps
  _gateInfo(gt) {
    const w = this.ctx.world;
    const mid = (gt.from + gt.to) / 2;
    const probe = (d) => gt.axis === 'x' ? w.spaceAt(gt.level, mid, gt.at + d) : w.spaceAt(gt.level, gt.at + d, mid);
    let paidSign = 1;
    const a = probe(2.5), b = probe(-2.5);
    if (a && a.paid) paidSign = 1; else if (b && b.paid) paidSign = -1;
    else if (gt.line === 'nankai') paidSign = 1;
    return { gt, paidSign };
  }
  _registerMachines() {
    const machines = this.ctx.transit && this.ctx.transit.ticketMachines ? safe(() => this.ctx.transit.ticketMachines()) : null;
    if (Array.isArray(machines) && machines.length) {
      const KIND = {
        ticket: ['Buy a ticket / charge ICOCA', 'きっぷ・チャージ', '券売機'],
        charge: ['Charge ICOCA', 'チャージ', 'チャージ機'],
        adjust: ['Fare adjustment', '精算機', 'のりこし精算機'],
      };
      machines.forEach((m, i) => {
        const g = this._gates.find(g => g.gt.id === m.gate) || this._gates.find(g => g.gt.level === m.level) || this._gates[0];
        const [en, ja, label] = KIND[m.kind] || KIND.ticket;
        this.interactions.add({ id: `machine:${i}`, gate: g.gt.id, level: m.level, x: m.x, z: m.z, radius: 1.9, prompt: en, promptJa: ja, sub: `${label} · ${g.gt.ja} ${g.gt.name}`,
          onUse: () => this.vignette('charge', () => V.chargeMachine(this, g.gt)) });
      });
    } else {
      // fallback: a bank of machines on the free side of every gate line, near one end
      const w = this.ctx.world;
      for (const g of this._gates) {
        const { gt, paidSign } = g;
        const off = -paidSign * 3.0;
        const cands = [gt.from - 3, gt.to + 3, gt.from + 1, gt.to - 1];
        for (const c of cands) {
          const x = gt.axis === 'x' ? c : gt.at + off, z = gt.axis === 'x' ? gt.at + off : c;
          if (!w.isWalkable(gt.level, x, z)) continue;
          this.interactions.add({ id: `machine:${gt.id}`, level: gt.level, x, z, radius: 2.4, prompt: 'Charge ICOCA / tickets', promptJa: 'きっぷ・チャージ', sub: `券売機 · ${gt.ja} ${gt.name}`,
            onUse: () => this.vignette('charge', () => V.chargeMachine(this, gt)) });
          break;
        }
      }
    }
    // v6: the gates are real (notes/v6-gates.md): E taps your ICOCA on the lane in front of you and its flaps open for a
    // few seconds; walk in without tapping and they snap shut. One interactable serves every gate line.
    this.interactions.add({
      id: 'gatetap', level: null, keepPhone: true,     // v7: tap with Maps still up, the way people do
      test: (b, fwd) => { const T = this._gateTarget(b, fwd); this._gateTgt = T; return T ? T.score : null; },
      view: () => this._gateView(),
      onUse: () => this._tapGate(),
    });
    // older transit (no tapGate): the v5 passive hint, you tap by walking through
    for (const g of this._gates) {
      const { gt, paidSign } = g;
      this.interactions.add({
        id: `gate:${gt.id}`, level: gt.level, passive: true,
        test: (b, fwd) => {
          if (this._newGates()) return null;
          const along = gt.axis === 'x' ? b.x : b.z;
          const across = (gt.axis === 'x' ? b.z : b.x) - gt.at;
          if (along < gt.from || along > gt.to) return null;
          const fromFree = -across * paidSign; // >0 on free side
          if (fromFree < 0.4 || fromFree > 3.2) return null;
          const look = (gt.axis === 'x' ? fwd.z : fwd.x) * paidSign;
          if (look < 0.55) return null;
          if (this.paidArea === gt.line) return null;
          return 2.5;
        },
        view: () => {
          const low = this.ic.balance < MIN_FARE;
          return { prompt: low ? 'Balance too low' : 'Walk through to tap', promptJa: low ? '残高不足' : 'タッチして入場', sub: `ICOCA ${yen(this.ic.balance)} · ${gt.ja} ${gt.name}${low ? ' — charge at a machine' : ''}`, passive: true };
        },
      });
    }
  }
  // ---------------------------------------------------------------------------
  // v6: ONE way to pay with the ICOCA card — gate fares, café orders, vignettes, machines.
  //   icCharge({ amount, label, ja, note, kind: 'fare'|'purchase'|'tap', orCoins?, sound? }) -> { ok, balance, amount }
  // Drives the HUD chip; amount 0 is a plain tap ("ピッ" + balance). Not enough on the card: nothing is charged and the
  // chip says so ("Paid in coins instead" with orCoins). Emits 'ic:pay'. Gate taps also emit 'ic:tap' (audio beeps on it).
  icCharge({ amount = 0, label = '', ja = '', note = '', kind = 'purchase', orCoins = false, sound = true } = {}) {
    const ic = this.ic, ev = this.ctx.events;
    amount = Math.max(0, Math.round(+amount || 0));
    if (amount > ic.balance) {
      if (sound) this.ctx.audio?.play?.('gate_fail');
      this.hud?.ic({ balance: ic.balance, ok: false, reason: orCoins ? 'Paid in coins instead' : kind === 'fare' ? 'Charge at a machine · チャージしてください' : 'Not enough on the card', note });
      ev.emit('ic:pay', { ok: false, amount, label, ja, kind, balance: ic.balance });
      return { ok: false, balance: ic.balance, amount: 0, coins: !!orCoins };
    }
    ic.balance -= amount;
    if (kind === 'fare' && amount) this.journal.fares = (this.journal.fares || 0) + amount;
    if (sound) this.ctx.audio?.play?.(kind === 'purchase' ? 'pay' : 'gate_ok');
    this.hud?.ic({ balance: ic.balance, fare: amount, ok: true, label: label || (kind === 'purchase' ? 'お支払い Paid' : '運賃 Fare'), reason: ja, note });
    ev.emit('ic:pay', { ok: true, amount, label, ja, kind, balance: ic.balance });
    return { ok: true, balance: ic.balance, amount };
  }

  // ---------------------------------------------------------------------------
  // v6 gates: the Gates agent's reactive gates (ctx.transit.gateLaneNear / tapGate, events gate:tap / gate:blocked /
  // gate:pass). Without them (older transit) the v5 crossing logic below still taps you through automatically.
  _newGates() { const tr = this.ctx.transit; return !!(tr && typeof tr.tapGate === 'function' && typeof tr.gateLaneNear === 'function'); }
  // is this gate event the player's? (the Gates agent flags it; otherwise: it happened right where the player is)
  _isPlayerGateEv(e) {
    if (!e) return false;
    if (e.player === true) return true;
    if (e.player === false || e.npc) return false;
    const b = this.ctx.player && this.ctx.player.body; if (!b || !isFinite(e.x) || !isFinite(e.z)) return false;
    return (!e.level || e.level === b.level) && Math.hypot(e.x - b.x, e.z - b.z) < 2.6;
  }
  // the gate channel the player is standing at and facing, or null (gateLaneNear: notes/v6-gates.md)
  // v8 (item 5): the IC prompt belongs to a gate lane you are standing at, not to a ramp that ends next to the line. A body
  // riding a ramp keeps the level it was entered from until the foot, and the Nankai 3F->2F escalators end 1 m past the 3F
  // gate line, so gateLaneNear() answered while you were still on the escalator ("Tap your ICOCA" at the escalator foot).
  // No prompt on a ramp, and only within GATE_PROMPT_M of the line while facing it.
  _gateTarget(b, fwd) {
    if (!this._newGates()) return null;
    if (b.ramp != null && b.ramp >= 0) return null;
    const n = safe(() => this.ctx.transit.gateLaneNear(b.x, b.z, b.level));
    if (!n || typeof n.lane !== 'number') return null;
    const g = this._gates.find(x => x.gt.id === n.gate); if (!g) return null;
    const gt = g.gt;
    const across = (gt.axis === 'x' ? b.z : b.x) - gt.at;
    const look = (gt.axis === 'x' ? fwd.z : fwd.x) * (across < 0 ? 1 : -1);      // looking at the gate line
    if (look < 0.35) return null;
    const entering = n.dir != null ? n.dir > 0 : -across * g.paidSign > 0;
    const d = isFinite(n.dist) ? n.dist : Math.abs(across);
    if (d > GATE_PROMPT_M) return null;
    return { g, n, gate: gt.id, lane: n.lane, sub: n.sub, entering, ok: n.ok !== false, open: !!n.open, score: -0.6 + d * 0.12 + (1 - look) * 0.5 };
  }
  _gateView() {
    const T = this._gateTgt; if (!T) return null;
    const gt = T.g.gt, low = T.entering && this.ic.balance < MIN_FARE;
    const sub = `${T.n.ja || gt.ja} ${T.n.name || gt.name} · ICOCA ${yen(this.ic.balance)}`;
    if (T.open) return { prompt: 'Open — walk through', promptJa: 'どうぞ', sub, passive: true };
    if (!T.ok) return { prompt: T.entering ? 'Exit only — try the next gate' : 'Entry only — try the next gate', promptJa: '✕', sub, passive: true };
    if (low) return { prompt: 'Tap your ICOCA (balance low)', promptJa: '残高不足', sub };
    return { prompt: 'Tap your ICOCA', promptJa: 'タッチ', sub };
  }
  // E at a gate: the fare comes off at the tap (one IC mechanism, icCharge), then the Gates agent opens the channel and
  // voices the beep — or refuses the card (flaps shut, buzzer) when the balance is too low. game.js plays no gate sound.
  _tapGate() {
    const T = this._gateTgt; if (!T || !this._newGates() || T.open || !T.ok) return;
    const { g, lane, sub, entering } = T, gt = g.gt;
    const tr = this.ctx.transit;
    // tapping the same side again before walking through (stepped back out) never charges twice
    const k = this._tap;
    const again = !!(k && k.gate === gt.id && k.entering === entering && !k.passed && this._rt - k.at < TAP_REOPEN_S);
    let fare = 0, note = '', metro = false;
    if (!again && !entering) {
      if (gt.line === 'nankai' && !this._rapitDone) { fare = FARES.nankai.amount; note = FARES.nankai.note; }
      else if ((gt.line === 'midosuji' || gt.line === 'sennichimae') && this._tapInLine === gt.line) { fare = Math.min(FARES.metro.amount, this.ic.balance); metro = true; }
    }
    if (entering && !again && this.ic.balance < MIN_FARE) {
      // not enough on the card to get in: the reader refuses it
      this.hud?.ic({ balance: this.ic.balance, ok: false, reason: 'Charge at a machine · チャージしてください' });
      this.hud?.caption({ ja: 'ピンポーン。残高が不足しています。', en: 'Ding-dong. Insufficient balance — please charge your card.', kind: 'machine', duration: 3.6 });
      safe(() => tr.tapGate(gt.id, lane, { sub, deny: 'balance' }));
      return;
    }
    const res = this.icCharge({ amount: fare, kind: fare ? 'fare' : 'tap', ja: fare ? '' : (T.n.ja || gt.ja), note: fare ? note : '', sound: false });
    if (!res.ok) { safe(() => tr.tapGate(gt.id, lane, { sub, deny: 'balance' })); return; }
    const r = safe(() => tr.tapGate(gt.id, lane, { sub, balance: res.balance, fare: res.amount }));
    if (r && r.ok === false) {
      if (res.amount) { this.ic.balance += res.amount; if (this.journal.fares) this.journal.fares -= res.amount; }   // refused: nothing was paid
      if (r.reason === 'lane') this.hud?.caption({ ja: entering ? 'この改札機は出場専用です。' : 'この改札機は入場専用です。', en: entering ? 'Red ✕ — this lane is exit-only. Try one with the green arrow.' : 'Red ✕ — this lane is entry-only. Try the next one.', kind: 'machine', duration: 3.4 });
      return;
    }
    if (!entering && !again && gt.line === 'nankai') this._rapitDone = true;
    if (metro) {
      this._tapInLine = null;
      if (fare && this.ctx.clock.minutes - (this._tapInAt || 0) < 20) this.hud?.caption({ en: 'Tapped in, tapped straight out. The minimum fare, for the privilege of looking at a platform.', kind: 'thought', duration: 3.8 });
    }
    if (entering && !again) { this._tapInLine = gt.line; this._tapInAt = this.ctx.clock.minutes; }
    this._tap = { gate: gt.id, lane, sub, entering, at: this._rt, passed: false };
  }

  _recomputePaid() {
    const p = this.ctx.player; if (!p) return;
    const b = p.body;
    const loc = this.ctx.world.locate(b);
    const s = loc.space;
    if (s && s.paid) this.paidArea = s.paid;
    else if (s && s.kind === 'platform') this.paidArea = s.zone === 'nankai' ? 'nankai' : s.zone;
    else if (b.level === 'B2') this.paidArea = loc.zone;
    else if (loc.ramp && /^esc_(m|s)_/.test(loc.ramp.id)) this.paidArea = loc.ramp.zone;
    else if (b.level === '3F' && loc.zone === 'nankai' && b.z > -66) this.paidArea = 'nankai';
    else this.paidArea = null;
  }
  _checkGates() {
    const b = this.ctx.player.body;
    const prev = this._prev;
    if (!prev || prev.level !== b.level) return;
    for (const g of this._gates) {
      const { gt, paidSign } = g;
      if (gt.level !== b.level) continue;
      const pa = (gt.axis === 'x' ? prev.z : prev.x) - gt.at, ca = (gt.axis === 'x' ? b.z : b.x) - gt.at;
      if ((pa < 0) === (ca < 0) || pa === 0) continue;
      const along = gt.axis === 'x' ? b.x : b.z;
      if (along < gt.from - 0.5 || along > gt.to + 0.5) continue;
      const entering = Math.sign(ca) === paidSign;
      // v6: the reactive gates already charged the tap and let you through (or stopped you): just note the side
      if (this._newGates()) { this.paidArea = entering ? gt.line : null; if (this._tap && this._tap.gate === gt.id) this._tap.passed = true; continue; }
      // which lane, and is it the right way round? (transit animates the flaps)
      const tr = this.ctx.transit;
      let lane = -1, policy = 'both';
      if (tr && tr.laneAt) {
        lane = safe(() => tr.laneAt(gt.id, b.x, b.z));
        const lanes = tr.gateLanes ? safe(() => tr.gateLanes(gt.id)) : null;
        if (lanes && lane >= 0 && lanes[lane]) policy = lanes[lane].policy || 'both';
      }
      const tap = { g, prev, lane, dir: entering ? 1 : -1 };
      if ((entering && policy === 'out') || (!entering && policy === 'in')) { this._refuse(tap, 'lane'); continue; }
      if (entering) this._tapIn(tap); else this._tapOut(tap);
    }
  }
  _flaps(tap, ok) {
    const tr = this.ctx.transit;
    if (tr && tr.gatePass && tap.lane != null && tap.lane >= 0) safe(() => tr.gatePass(tap.g.gt.id, tap.lane, tap.dir, ok));
  }
  // the flaps close: push back to where we were, and say why (once in a while)
  _refuse(tap, reason) {
    const { gt } = tap.g;
    const b = this.ctx.player.body;
    b.x = tap.prev.x; b.z = tap.prev.z;
    const v = this.ctx.player.vel; if (v && v.set) v.set(0, 0);
    const now = performance.now();
    if (this._ngT && now - this._ngT < 1800) return;
    this._ngT = now;
    this._flaps(tap, false);
    if (reason === 'lane') {
      this.hud?.caption({ ja: tap.dir > 0 ? 'この改札機は出場専用です。' : 'この改札機は入場専用です。', en: tap.dir > 0 ? 'Red ✕ — this lane is exit-only. Try the one with the green arrow.' : 'Red ✕ — this lane is entry-only. Try the next one.', kind: 'machine', duration: 3.4 });
      this.ctx.events.emit('ic:tap', { ok: false, gate: gt.id, balance: this.ic.balance, fare: 0, reason: 'lane', x: b.x, z: b.z, level: b.level });
      return;
    }
    this.hud?.ic({ balance: this.ic.balance, ok: false, reason: 'Charge at a machine · チャージしてください' });
    this.hud?.caption({ ja: 'ピンポーン。残高が不足しています。', en: 'Ding-dong. Insufficient balance — please charge your card.', kind: 'machine', duration: 3.6 });
    this.ctx.events.emit('ic:tap', { ok: false, gate: gt.id, balance: this.ic.balance, fare: 0, reason: 'balance', x: b.x, z: b.z, level: b.level });
  }
  _tapIn(tap) {
    const { gt } = tap.g;
    const b = this.ctx.player.body;
    if (this.ic.balance < MIN_FARE) return this._refuse(tap, 'balance');
    this.paidArea = gt.line;
    this._tapInLine = gt.line; this._tapInAt = this.ctx.clock.minutes;
    this._flaps(tap, true);
    this.icCharge({ amount: 0, kind: 'tap', ja: gt.ja, sound: false });
    this.ctx.events.emit('ic:tap', { ok: true, gate: gt.id, balance: this.ic.balance, fare: 0, x: b.x, z: b.z, level: b.level });
  }
  _tapOut(tap) {
    const { gt } = tap.g;
    const b = this.ctx.player.body;
    this.paidArea = null;
    this._flaps(tap, true);
    if (gt.line === 'nankai' && !this._rapitDone) {
      // v6: the airport ride comes off the card, like the café (one IC mechanism)
      this._rapitDone = true;
      const r = this.icCharge({ amount: FARES.nankai.amount, kind: 'fare', note: FARES.nankai.note, sound: false });
      this.ctx.events.emit('ic:tap', { ok: true, gate: gt.id, balance: r.balance, fare: r.amount, exit: true, x: b.x, z: b.z, level: b.level });
      return;
    }
    // leaving a metro gate you tapped into: the minimum fare comes off (the card
    // never goes negative: the machine is gentle about it)
    let fare = 0;
    if ((gt.line === 'midosuji' || gt.line === 'sennichimae') && this._tapInLine === gt.line) {
      fare = Math.min(MIN_FARE, this.ic.balance);
      this._tapInLine = null;
      if (fare) this.hud?.caption({ en: 'Tapped in, tapped straight out. The minimum fare, for the privilege of looking at a platform.', kind: 'thought', duration: 3.8 });
    }
    fare = this.icCharge({ amount: fare, kind: fare ? 'fare' : 'tap', ja: gt.ja, sound: false }).amount;
    this.ctx.events.emit('ic:tap', { ok: true, gate: gt.id, balance: this.ic.balance, fare, exit: true, x: b.x, z: b.z, level: b.level });
  }

  // a PA line: spoken by the sound system (which emits its own caption) or,
  // without audio, just captioned
  _pa(ja, en, dur = 3) {
    const a = this.ctx.audio;
    this.ctx.audio?.play?.('train_depart');
    let spoken = null;
    if (a && a.enabled && typeof a.say === 'function') { try { spoken = a.say({ ja, en, kind: 'platform', chime: null }); } catch (e) { spoken = null; } }
    if (!spoken) this.hud?.caption({ ja, en, kind: 'announce', duration: dur });
  }

  // ---------------------------------------------------------------------------
  update(dt) {
    const { ctx } = this;
    if (this.titleUp) { this.title.update(dt); return; }
    if (!this.started || !ctx.player) return;
    this._menuInput();
    this._mouseChip();
    if (!this.paused) this._stepLook(dt);
    if (!this.paused) {
      this._rt = (this._rt || 0) + dt;      // real seconds of play (pause-aware): gate tap windows
      // timers (real seconds, pause-aware)
      for (let i = this._timers.length - 1; i >= 0; i--) {
        const t = this._timers[i];
        t.t -= dt;
        if (t.t <= 0) { this._timers.splice(i, 1); try { t.fn(); } catch (e) { console.error('[game timer]', e); } }
      }
      this.journal.update(dt);
      if (!this.quiet) this.demo.update(dt);
    }
    const b = ctx.player.body;
    if (!this.paused && !this.ended) this._checkGates();
    this._prev = { x: b.x, z: b.z, level: b.level };
    // interactions
    // v7 (items 2+3): the world stays usable while the phone is raised. v6 switched every interaction off whenever the
    // phone was up — and the tutorial ends with Maps raised, so a player walking to the gate behind their map got no
    // prompt and E did nothing ("I cannot continue"). With the phone up only E itself acts on the world (Enter, 1–9,
    // Tab, Q… stay the phone's); not while typing in it, and not while Aya's Lodestone offer is on screen (E installs).
    const ph = ctx.phone;
    const phoneUp = !!(this.phoneOpen || (ph && ph.isOpen));
    const phoneBusy = phoneUp && !!(ph && (ph.typing || ph.upgradeStage === 'offer'));
    const canUse = !this.paused && !this.busy && !this.intro && !this.ended && !this.panels.open && !phoneBusy;
    if (canUse && !this.quiet) this.interactions.update(dt, true, phoneUp ? { keyOnly: true, lowerPhone: true } : null);
    else if (this.hud) this.hud.prompt(null);
  }
  // v7.3: say which job the mouse has right now. Locked = it steers the view (no chip). Free with nothing open = the
  // view is NOT steering (after Esc→Esc, a refused lock, a lost focus): a clear centre chip, click to look again.
  // Free with the phone up = the cursor is for the phone: a quiet chip that says how to get the view back.
  _mouseChip() {
    const inp = this.ctx.input;
    let mode = '';
    if (this.started && !this.titleUp && !this.paused && !this._endCard && !this.ended && !this.intro && !this.busy && inp && !inp.touch && !inp.locked && !this.panels.open) {
      const ph = this.ctx.phone;
      mode = this.phoneOpen || (ph && ph.isOpen) ? 'phone' : 'free';
    }
    if (mode === this._chipMode) return;
    this._chipMode = mode;
    if (!this._chip) {
      this._chip = document.createElement('div');
      this._chip.className = 'g-mouse';
      (this.ctx.ui.overlay || document.body).appendChild(this._chip);
    }
    const c = this._chip;
    c.className = 'g-mouse' + (mode ? ' on ' + mode : '');
    if (mode === 'free') c.innerHTML = '<span class="g-mouse-ic"></span><b>Click to look around</b><small>The mouse steers your view again · <kbd class="g-key wide">Esc</kbd> menu</small>';
    else if (mode === 'phone') c.innerHTML = '<span class="g-mouse-ic"></span><span>Cursor is on your phone · <b>click the scene</b> or <kbd class="g-key">Q</kbd> to look around</span>';
  }
  // Esc / gamepad Start toggles the pause menu when the pointer isn't locked
  // (a locked pointer is released by the browser on Esc -> pointerlockchange).
  _menuInput() {
    const inp = this.ctx.input;
    const menu = typeof inp.action === 'function' ? inp.action('menu') : inp.pressed('Escape');
    if (menu && !this._endCard && !this.phoneOpen && !this.panels.open) {
      const now = performance.now();
      if (!this._pauseAt || now - this._pauseAt > 350) {
        if (this.paused && this._pauseView === 'restart') this._pauseShow('about');   // Esc backs out of the confirm first
        else if (this.paused) this.resume(); else this.pause();
      }
    }
    // gamepad A / touch E confirms the highlighted choice in a vignette panel
    if (this.panels.current && !this.paused && typeof inp.action === 'function' && inp.action('interact')) this.panels.current.key('KeyE');
  }
}

function safe(fn) { try { return fn(); } catch (e) { return null; } }
