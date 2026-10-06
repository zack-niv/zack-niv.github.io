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
import { QUESTS, DEMO } from './script.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const hhmm = (m) => { m = ((Math.round(m) % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
const COFFEE_CATS = new Set(['cafe', 'kissaten', 'coffeestand']);
const MIN_FARE = 190;

export class Game {
  constructor(ctx) {
    this.ctx = ctx;
    this.started = false; this.paused = false; this.ended = false; this.finished = false;
    this.busy = false; this.phoneOpen = false; this.intro = false;
    this.ic = { balance: 2000 };
    this.quests = {};
    for (const id of Object.keys(QUESTS)) this.quests[id] = { id, state: 'hidden', ...QUESTS[id], notes: [] };
    this.meals = [];
    this._timers = [];
    this._doors = {};        // trackId -> bool (from train events, fallback)
    this._sawTrainEvents = false;
    this.paidArea = null;
    this._prev = null;
    this._msgId = 0;
  }

  // ---------------------------------------------------------------------------
  async init() {
    const { ctx } = this;
    this.quiet = params.test && !params.has('play');
    this.settings = loadSettings();
    applySettings(ctx, this.settings);
    this.hud = ctx.hud || null;
    this.interactions = new Interactions(ctx);
    this.panels = new Panels(ctx);
    this.journal = new Journal(ctx, this);
    this.meals = this.journal.meals;
    this.title = new Title(ctx, { onBegin: () => this._begin() });
    this.demo = new Demo(ctx, this);
    // public API
    this.addInteractable = (def) => this.interactions.add(def);
    this.removeInteractable = (id) => this.interactions.remove(id);
    this.discover = (id, en, ja) => this.journal.discover(id, en, ja);
    // discoveries are quiet in the demo: only the two real wonders get a soft place-name card
    this.onDiscover = (d) => { if (this.quiet || this.ended || this.intro) return; if (d.id === 'canyon' || d.id === 'parks') this.hud?.chapter({ ja: d.ja, en: d.en, sub: '' }, 4.5); };

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
    ev.on('player:teleport', () => { this._prev = null; this.journal.resetTracking(); this._recomputePaid(); });

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
    // the demo opens at 11:20 (unless a ?time= was asked for): re-tick so shutters/crowds follow
    if (!params.time && ctx.clock.minutes < DEMO.startMinutes) { ctx.clock.minutes = DEMO.startMinutes; ctx.clock.update(0); }
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
    this.demo.begin({ cinematic: !!this._fromTitle || !params.skip });
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
        </nav>
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
      else body.appendChild(this._aboutView());
    };
    this._pauseShow = show;
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
    const q = this.quests.tempura;
    d.innerHTML = `<h3>Today <small>今日の予定</small></h3>
      <ul><li class="${q.state}"><span class="p-check"></span><div><b>${esc(q.text)}</b><small>${esc(q.textJa)}</small><p>${esc(q.detail || '')}</p></div></li></ul>
      <p class="p-hint">Q opens your phone. Mouse looks, WASD walks. Esc brings this menu back.</p>`;
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
    const u = new URL(location.href);
    ['skip', 'test', 'spawn', 'pos', 'yaw', 'pitch', 'play'].forEach(k => u.searchParams.delete(k));
    location.href = u.toString();
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
        def = { prompt: 'Order a coffee', promptJa: '注文する', onUse: () => this.vignette('coffee', () => V.orderCoffee(this, b)) };
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
    // a passive hint when you walk up to a gate line from the free side
    for (const g of this._gates) {
      const { gt, paidSign } = g;
      this.interactions.add({
        id: `gate:${gt.id}`, level: gt.level, passive: true,
        test: (b, fwd) => {
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
    this.hud?.ic({ balance: this.ic.balance, ok: true, reason: gt.ja });
    this.ctx.events.emit('ic:tap', { ok: true, gate: gt.id, balance: this.ic.balance, fare: 0, x: b.x, z: b.z, level: b.level });
  }
  _tapOut(tap) {
    const { gt } = tap.g;
    const b = this.ctx.player.body;
    this.paidArea = null;
    this._flaps(tap, true);
    if (gt.line === 'nankai' && !this._rapitDone) {
      this._rapitDone = true;
      this.ctx.audio?.play?.('gate_ok');
      this.hud?.caption({ en: 'The gate swallows your rapi:t ticket with a satisfied little whirr.', kind: 'thought', duration: 3.4 });
      return;
    }
    // leaving a metro gate you tapped into: the minimum fare comes off (the card
    // never goes negative: the machine is gentle about it)
    let fare = 0;
    if ((gt.line === 'midosuji' || gt.line === 'sennichimae') && this._tapInLine === gt.line) {
      fare = Math.min(MIN_FARE, this.ic.balance);
      this.ic.balance -= fare;
      this._tapInLine = null;
      this.journal.fares = (this.journal.fares || 0) + fare;
      if (fare) this.hud?.caption({ en: 'Tapped in, tapped straight out. The minimum fare, for the privilege of looking at a platform.', kind: 'thought', duration: 3.8 });
    }
    this.ctx.audio?.play?.('gate_ok');
    this.hud?.ic({ balance: this.ic.balance, ok: true, fare, reason: gt.ja });
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
    if (!this.paused) this._stepLook(dt);
    if (!this.paused) {
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
    const canUse = !this.paused && !this.busy && !this.intro && !this.ended && !this.phoneOpen && !this.panels.open;
    if (canUse && !this.quiet) this.interactions.update(dt, true);
    else if (this.hud) this.hud.prompt(null);
  }
  // Esc / gamepad Start toggles the pause menu when the pointer isn't locked
  // (a locked pointer is released by the browser on Esc -> pointerlockchange).
  _menuInput() {
    const inp = this.ctx.input;
    const menu = typeof inp.action === 'function' ? inp.action('menu') : inp.pressed('Escape');
    if (menu && !this._endCard && !this.phoneOpen && !this.panels.open) {
      const now = performance.now();
      if (!this._pauseAt || now - this._pauseAt > 350) {
        if (this.paused) this.resume(); else this.pause();
      }
    }
    // gamepad A / touch E confirms the highlighted choice in a vignette panel
    if (this.panels.current && !this.paused && typeof inp.action === 'function' && inp.action('interact')) this.panels.current.key('KeyE');
  }
}

function safe(fn) { try { return fn(); } catch (e) { return null; } }
