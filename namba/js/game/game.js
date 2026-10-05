// =============================================================================
// Game flow: title → arrival → three ordinary goals → the right train → end
// card → free roam. Owns quests, the ICOCA card, gates (tap in/out), boarding,
// pause menu, the discovery journal and soft time pressure.
// See notes/game.md for the API other systems can use (ctx.game.*).
// =============================================================================
import { params } from '../core/params.js';
import { LAYOUT, spaceById } from '../world/layout.js';
import { BUSINESSES } from '../world/directory.js';
import { Interactions } from './interact.js';
import { Panels, yen, esc } from './panel.js';
import { Journal } from './journal.js';
import { loadSettings, applySettings, buildSettingsPanel, buildControlsCard } from './settings.js';
import { Title } from '../ui/title.js';
import * as V from './vignettes.js';
import { QUESTS, INTRO, HINTS, TIMED, REACTIONS, ENDING } from './script.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const hhmm = (m) => { m = ((Math.round(m) % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
const COFFEE_CATS = new Set(['cafe', 'kissaten', 'coffeestand']);
const MIN_FARE = 190;
const FARE_SHIN_OSAKA = 290;

export class Game {
  constructor(ctx) {
    this.ctx = ctx;
    this.started = false; this.paused = false; this.ended = false; this.finished = false;
    this.busy = false; this.phoneOpen = false;
    this.ic = { balance: 2000 };
    this.quests = {};
    for (const id of ['coffee', 'tempura', 'subway']) this.quests[id] = { id, state: 'hidden', ...QUESTS[id], notes: [] };
    this.meals = [];
    this._timers = [];
    this._doors = {};        // trackId -> bool (from train events, fallback)
    this._sawTrainEvents = false;
    this.paidArea = null;
    this._prev = null;
    this._timed = 0;
    this._hintIdx = { coffee: 0, tempura: 0, subway: 0 };
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
    // public API
    this.addInteractable = (def) => this.interactions.add(def);
    this.removeInteractable = (id) => this.interactions.remove(id);
    this.discover = (id, en, ja) => this.journal.discover(id, en, ja);

    this._gates = LAYOUT.gates.map(gt => this._gateInfo(gt));
    try { this._registerShops(); } catch (e) { console.error('[game] shops', e); }
    try { this._registerMachines(); } catch (e) { console.error('[game] machines', e); }
    this._registerBoarding();
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
    ctx.clock.paused = false;
    this.hud?.setVisible(true);
    this._recomputePaid();
    this.journal.begin();
    this._lastProgress = ctx.clock.minutes;
    this._syncFrozen();
    if (this.quiet) {
      // test harness: goals active silently, no intro
      for (const id in this.quests) this.quests[id].state = 'active';
      return;
    }
    this._intro();
  }
  _intro() {
    const { ctx } = this;
    const b = ctx.player.body;
    const sp = b.level === '3F' && ctx.player.zone === 'nankai';
    this.after(1.0, () => this.hud?.chapter(sp
      ? { ja: '南海なんば駅', en: 'Nankai Namba Station', sub: `Platform 4 · ${ctx.clock.hhmm} · off the rapi:t from Kansai Airport` }
      : { ja: 'なんば', en: 'Namba, Osaka', sub: ctx.clock.hhmm }, 6.5));
    let t = 3.2;
    INTRO.forEach(([dt, text], i) => {
      t += i === 0 ? 0 : dt;
      this.after(t, () => this.message(text));
    });
    t += 2.5;
    ['coffee', 'tempura', 'subway'].forEach((id, i) => this.after(t + i * 1.6, () => this.setQuest(id, 'active')));
    this.after(t + 7, () => this.hud?.caption({ en: 'Okay. Coffee first. Everything else after coffee.', kind: 'thought', duration: 3.6 }));
  }
  after(sec, fn) { this._timers.push({ t: sec, fn }); }

  // ---------------------------------------------------------------------------
  // Quests & messages
  setQuest(id, state, detail) {
    const q = this.quests[id]; if (!q) return;
    const prev = q.state;
    q.state = state;
    if (detail) { q.detail = detail; q.notes.push(detail); }
    if (state === 'done') q.doneAt = this.ctx.clock.hhmm;
    this._lastProgress = this.ctx.clock.minutes;
    this.ctx.events.emit('quest:update', { id, state, text: q.text, textJa: q.textJa, detail: q.detail });
    if (prev !== state && !this.quiet) {
      if (state === 'active') this.hud?.toast({ kind: 'quest', title: 'New goal', en: q.text, ja: q.textJa, duration: 5.5 });
      if (state === 'done') { this.hud?.toast({ kind: 'done', title: 'Done', en: q.text, ja: q.textJa, duration: 6 }); this.ctx.audio?.play?.('bell'); }
    }
  }
  noteQuest(id, note) {
    const q = this.quests[id]; if (!q) return;
    q.detail = note; q.notes.push(note);
    this._lastProgress = this.ctx.clock.minutes;
    this.ctx.events.emit('quest:update', { id, state: q.state, text: q.text, textJa: q.textJa, detail: note });
  }
  message(text, from = 'Aya', delaySec = 0) {
    if (!text) return;
    const send = () => {
      const m = { id: ++this._msgId, from, text, time: this.ctx.clock.hhmm };
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
          <button type="button" data-a="goals">Today <small>今日の予定</small></button>
          <button type="button" data-a="settings">Settings <small>設定</small></button>
          <button type="button" data-a="controls">Controls <small>操作</small></button>
          <button type="button" data-a="quit">Quit to title <small>タイトルへ</small></button>
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
      else body.appendChild(this._goalsView());
    };
    this._pauseShow = show;
    el.querySelectorAll('.p-nav button').forEach(b => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const a = b.dataset.a;
      if (a === 'resume') this.resume();
      else if (a === 'quit') this._quitToTitle();
      else show(a);
    }));
  }
  _goalsView() {
    const d = document.createElement('div');
    d.className = 'p-goals';
    const qs = Object.values(this.quests).filter(q => q.state !== 'hidden');
    d.innerHTML = `<h3>Today <small>今日の予定</small></h3>
      <ul>${(qs.length ? qs : Object.values(this.quests)).map(q => `<li class="${q.state}"><span class="p-check"></span><div><b>${esc(q.text)}</b><small>${esc(q.textJa)}</small><p>${esc(q.detail || '')}</p></div></li>`).join('')}</ul>
      <div class="p-stats"><span>${this.ctx.clock.hhmm}</span><span>${(this.journal.distance / 1000).toFixed(2)} km walked</span><span>ICOCA ${yen(this.ic.balance)}</span><span>${this.journal.found.size} places</span></div>`;
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
    this._pauseShow('goals');
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
  _quitToTitle() {
    const u = new URL(location.href);
    ['skip', 'test', 'spawn', 'pos', 'yaw', 'pitch', 'play'].forEach(k => u.searchParams.delete(k));
    location.href = u.toString();
  }
  _syncFrozen() {
    const p = this.ctx.player; if (!p) return;
    p.frozen = !this.started || this.titleUp || this.paused || this.busy || this.ended;
  }

  // run a vignette: freezes the player, blocks other interactions
  async vignette(kind, fn) {
    if (this.busy) return;
    this.busy = true; this._syncFrozen();
    this.hud?.prompt(null);
    this.ctx.events.emit('vignette:open', { kind });
    try { await fn(); } catch (e) { console.error('[vignette]', kind, e); this.hud?.fade(0, 300); }
    this.busy = false; this._syncFrozen();
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
        def = { prompt: 'Join the line', promptJa: '並ぶ', onUse: () => this.vignette('tempura', () => V.daikichi(this, b)),
          view: () => {
            const m = this.ctx.clock.minutes;
            if (m < b.hours[0]) return { prompt: 'Wait for opening', promptJa: '開店を待つ', sub };
            if (m >= b.hours[1]) return { prompt: 'Read the sign', promptJa: '看板を見る', sub };
            return null;
          } };
      } else if (b.key === 'tempura_tendon') {
        def = { prompt: 'Use the ticket machine', promptJa: '食券を買う', onUse: () => this.vignette('tendon', () => V.tendon(this, b)) };
      } else if (b.key === 'tempura_closed') {
        def = { prompt: 'Read the sign', promptJa: '看板を見る', onUse: () => this.vignette('kitsune', () => V.kitsune(this, b)),
          view: () => (this.ctx.clock.minutes >= b.hours[0] ? { prompt: 'Stand at the bar', promptJa: '立ち飲み', sub } : null) };
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
    this._flaps(tap, true);
    this.hud?.ic({ balance: this.ic.balance, ok: true, reason: gt.ja });
    this.ctx.events.emit('ic:tap', { ok: true, gate: gt.id, balance: this.ic.balance, fare: 0, x: b.x, z: b.z, level: b.level });
    if (gt.line === 'midosuji') {
      if (this.quests.subway.state === 'active' && !this._noteMido) { this._noteMido = true; this.noteQuest('subway', 'Through the red Midosuji gates. Now: which platform goes north?'); }
    } else if (gt.line === 'sennichimae' && !this._wrongLine) {
      this._wrongLine = true; this.journal.wrongTurns++;
      this.message(REACTIONS.wrongLine, 'Aya', 12);
    }
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
    this.hud?.ic({ balance: this.ic.balance, ok: true, reason: gt.ja });
    this.ctx.events.emit('ic:tap', { ok: true, gate: gt.id, balance: this.ic.balance, fare: 0, exit: true, x: b.x, z: b.z, level: b.level });
  }

  // ---------------------------------------------------------------------------
  // Trains: boarding the Midosuji Line
  doorsOpen(trackId) {
    const tr = this.ctx.transit;
    const b = this.ctx.player.body;
    if (tr) {
      if (typeof tr.isBoardable === 'function') { const r = safe(() => tr.isBoardable(trackId, b)); if (r != null) return !!r; }
      if (typeof tr.doorsOpen === 'function') { const r = safe(() => tr.doorsOpen(trackId)); if (r != null) return !!r; }
    }
    if (this._sawTrainEvents) return !!this._doors[trackId];
    // last resort (no transit system): a believable 2.5-minute headway
    const t = performance.now() / 1000 + (trackId === 'm_track1' ? 70 : 0);
    return (t % 150) < 32;
  }
  _edgeInfo(b) {
    if (b.level !== 'B2') return null;
    const s = this.ctx.player.space;
    if (!s || s.id !== 'm_platform') return null;
    const [x0, z0, x1, z1] = s.rect;
    if (b.z < z0 + 2 || b.z > z1 - 2) return null;
    if (x1 - b.x < 1.1) return { track: 'm_track2', dir: 1, dist: x1 - b.x };
    if (b.x - x0 < 1.1) return { track: 'm_track1', dir: -1, dist: b.x - x0 };
    return null;
  }
  _registerBoarding() {
    this.interactions.add({
      id: 'board', level: 'B2',
      test: (b, fwd) => {
        const e = this._edgeInfo(b); if (!e) return null;
        if (fwd.x * e.dir < 0.35) return null;
        if (!this.doorsOpen(e.track)) return null;
        this._edge = e;
        return 0.1;
      },
      view: () => {
        const tr = LAYOUT.tracks.find(t => t.id === (this._edge && this._edge.track));
        return tr ? { prompt: 'Board the train', promptJa: '乗車する', sub: `${tr.no}番線 · ${tr.dirJa} · ${tr.dirEn}` } : null;
      },
      onUse: () => this._board(this._edge && this._edge.track),
    });
  }
  _checkWalkIn(dt) {
    const p = this.ctx.player, b = p.body;
    const e = this._edgeInfo(b);
    const fwd = { x: -Math.sin(p.yaw), z: -Math.cos(p.yaw) };
    if (e && e.dist < 0.55 && this.ctx.input.move.y > 0.5 && fwd.x * e.dir > 0.6 && this.doorsOpen(e.track)) {
      this._pushT = (this._pushT || 0) + dt;
      if (this._pushT > 0.45) { this._pushT = 0; this._board(e.track); }
    } else this._pushT = 0;
  }
  _board(track) {
    if (!track || this.busy || this.ended) return;
    if (track === 'm_track1') return this.vignette('wrongway', () => this._wrongWay());
    if (track === 'm_track2') return this.vignette('board', () => this._boardRight());
  }
  async _wrongWay() {
    const { ctx, hud } = this;
    this._pa('ドアが閉まります。ご注意ください。', 'The doors are closing. Please stand clear.', 3);
    await sleep(1800);
    await hud.fade(1, 1800);
    hud.fadeText(`<div class="h-fade-kicker">御堂筋線 · 天王寺・なかもず方面</div><div class="h-fade-big">次は、大国町</div><div class="h-fade-small">The next station is Daikokuchō.</div>`);
    await sleep(3400);
    hud.fadeText(`<div class="h-fade-small">…Daikokuchō is <i>south</i>.<br>Shin-Osaka is very much <i>north</i>.</div>`);
    await sleep(3200);
    hud.fadeText(`<div class="h-fade-small">You get off, cross the platform with enormous dignity,<br>and ride one stop back.</div><div class="h-fade-clock">${ctx.clock.hhmm} → ${hhmm(ctx.clock.minutes + 6)} · six minutes you'll never get back</div>`);
    ctx.clock.minutes += 6; ctx.clock.update(0);
    this.journal.wrongTurns++;
    this.journal.discover('daikokucho', 'Daikokuchō (by accident)', '大国町');
    await sleep(3600);
    ctx.teleport && ctx.teleport({ level: 'B2', x: -113.5, z: -128, yaw: -Math.PI / 2, pitch: 0 });
    this.paidArea = 'midosuji';
    hud.fadeText('');
    await hud.fade(0, 1400);
    hud.caption({ en: 'Okay. The other side, then.', kind: 'thought', duration: 3 });
    this.message(REACTIONS.wrongWay, 'Aya', 5);
  }
  async _boardRight() {
    const { ctx, hud } = this;
    const missing = [];
    if (this.quests.coffee.state !== 'done') missing.push('a great coffee');
    if (this.quests.tempura.state !== 'done') missing.push('tempura');
    if (missing.length && !this.finished) {
      const go = await this.panels.card({
        style: 'paper', side: 'center',
        html: `<div class="g-kicker">2番線 · 梅田・新大阪方面</div><div class="g-title">Leave Namba now?</div>
          <p class="g-p">The doors are open. But you never found ${missing.join(' or ')}. Shin-Osaka station bento is… an option.</p>`,
        buttons: [{ label: 'Board anyway', value: true }, { label: 'Not yet', value: false }],
      });
      if (!go) return;
    }
    await this._ending();
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
  // Ending
  async _ending() {
    const { ctx, hud } = this;
    this.ended = true; this._syncFrozen();
    hud.prompt(null);
    const boardAt = ctx.clock.minutes;
    this._pa('ドアが閉まります。ご注意ください。', 'The doors are closing. Please stand clear.', 3.2);
    await sleep(2200);
    await hud.fade(1, 2600);
    hud.fadeText(`<div class="h-fade-kicker">御堂筋線 · 梅田・新大阪方面</div><div class="h-fade-big">次は、心斎橋</div><div class="h-fade-small">The next station is Shinsaibashi.</div>`);
    await sleep(3600);
    hud.fadeText('');
    if (this.quests.subway.state !== 'done') this.setQuest('subway', 'done', `Midosuji Line, track 2, ${hhmm(boardAt)}. Next stop Shinsaibashi, then Umeda, then Shin-Osaka.`);
    if (!this.finished) this.message(REACTIONS.boarded, 'Aya', 2);
    this.finished = true;
    this._showEndCard(boardAt);
  }
  _summary(boardAt) {
    const j = this.journal;
    const mins = Math.max(0, Math.round(boardAt - (j.startMinutes ?? boardAt)));
    const arrive = boardAt + 15 + 8;
    let shinkansen;
    if (arrive <= 15 * 60 + 10) shinkansen = { en: 'You\'ll make the 15:10 with time for a bento.', ja: '15:10の新幹線に余裕で間に合う' };
    else if (arrive <= 15 * 60 + 40) shinkansen = { en: 'The 15:40 it is. You\'ll be fine.', ja: '15:40の新幹線で大丈夫' };
    else shinkansen = { en: 'There is always another Shinkansen.', ja: '新幹線はまた来る' };
    const fare = FARE_SHIN_OSAKA;
    const short = this.ic.balance < fare;
    return {
      started: hhmm(j.startMinutes ?? boardAt), boarded: hhmm(boardAt), minutes: mins,
      distanceKm: j.distance / 1000, floors: j.floors.size, floorsLabel: j.floorsLabel(),
      places: j.places, wrongTurns: j.wrongTurns, coffees: j.coffees, meals: j.meals.slice(),
      quests: Object.fromEntries(Object.values(this.quests).map(q => [q.id, { state: q.state, detail: q.detail }])),
      shinkansen, balance: this.ic.balance, fareNote: short ? 'You\'ll need the fare adjustment machine (精算機) at Shin-Osaka.' : `¥${fare} will come off your ICOCA at Shin-Osaka.`,
    };
  }
  _showEndCard(boardAt) {
    const s = this._summary(boardAt);
    this.ctx.events.emit('game:end', { summary: s });
    this._endCard = true;
    this._allowUnlock = true;
    this.ctx.input.exitLock();
    const h = Math.floor(s.minutes / 60), m = s.minutes % 60;
    const dur = h ? `${h}<small>h</small> ${m}<small>min</small>` : `${m}<small>min</small>`;
    const lunch = this.quests.tempura.state === 'done' ? (s.meals.find(x => /Daikichi|Kitsune/.test(x)) || 'Tempura') : (s.meals.length ? `${s.meals[s.meals.length - 1]} (not the dream)` : 'Skipped. Station bento later.');
    const coffee = this.quests.coffee.state === 'done' ? (s.meals.find(x => /Wakakusa|Rondo/.test(x)) || 'Found it') : (s.coffees ? 'Fine. Just fine.' : 'None. Bold.');
    const el = document.createElement('div');
    el.className = 'g-end';
    el.innerHTML = `
      <div class="e-inner">
        <div class="e-kicker">御堂筋線 · 梅田・新大阪方面 · ${s.boarded}</div>
        <div class="e-title-ja">${ENDING.titleJa}</div>
        <div class="e-title">${ENDING.title}</div>
        <div class="e-line">${esc(s.shinkansen.en)} <span>${esc(s.shinkansen.ja)}</span></div>
        <div class="e-stats">
          <div><b>${dur}</b><span>in Namba · ${s.started} → ${s.boarded}</span></div>
          <div><b>${s.distanceKm.toFixed(2)}<small>km</small></b><span>walked</span></div>
          <div><b>${s.floors}</b><span>floors · ${esc(s.floorsLabel)}</span></div>
          <div><b>${s.places.length}</b><span>places discovered</span></div>
          <div><b>${s.wrongTurns}</b><span>wrong turn${s.wrongTurns === 1 ? '' : 's'}</span></div>
          <div><b>${s.coffees}</b><span>coffee${s.coffees === 1 ? '' : 's'}</span></div>
        </div>
        <div class="e-rows">
          <div><span>Coffee</span><b>${esc(coffee)}</b></div>
          <div><span>Lunch</span><b>${esc(lunch)}</b></div>
          <div><span>ICOCA</span><b>${yen(s.balance)} <small>${esc(s.fareNote)}</small></b></div>
        </div>
        ${s.places.length ? `<div class="e-places">${s.places.map(p => `<span title="${esc(p.at)}">${esc(p.en)}<i>${esc(p.ja)}</i></span>`).join('')}</div>` : ''}
        <div class="e-btns">
          <button type="button" class="g-btn sel" data-a="roam"><kbd class="g-key sm">E</kbd>Keep wandering <small>まだ歩く</small></button>
          <button type="button" class="g-btn" data-a="title">Back to title <small>タイトルへ</small></button>
        </div>
        <div class="e-credit">${esc(ENDING.stayLine)} · A love letter to Namba, Osaka</div>
      </div>`;
    (this.ctx.ui.overlay || document.body).appendChild(el);
    this.endEl = el;
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('on')));
    const act = (a) => {
      removeEventListener('keydown', key, true);
      if (a === 'title') return this._quitToTitle();
      this._keepWandering();
    };
    const key = (e) => {
      if (e.repeat) return;
      if (e.code === 'KeyE' || e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); e.stopImmediatePropagation(); act(el.querySelector('.g-btn.sel').dataset.a); }
      if (['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD', 'Tab'].includes(e.code)) { e.preventDefault(); e.stopImmediatePropagation(); el.querySelectorAll('.g-btn').forEach(b => b.classList.toggle('sel')); const k = el.querySelector('.g-key'); el.querySelector('.g-btn.sel').prepend(k); }
    };
    addEventListener('keydown', key, true);
    el.querySelectorAll('.g-btn').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); act(b.dataset.a); }));
  }
  async _keepWandering() {
    const el = this.endEl;
    if (el) { el.classList.remove('on'); setTimeout(() => el.remove(), 900); }
    this._endCard = false;
    this.ctx.teleport && this.ctx.teleport({ level: 'B2', x: -116, z: -118, yaw: Math.PI / 2, pitch: 0 });
    this.paidArea = 'midosuji';
    this.ctx.input.requestLock();
    this._allowUnlock = false;
    await this.hud.fade(0, 1600);
    this.ended = false; this._syncFrozen();
    this.hud.caption({ en: 'Maybe one more look around. The Shinkansen can wait. (It can\'t. But there\'s always another one.)', kind: 'thought', duration: 5 });
  }

  // ---------------------------------------------------------------------------
  update(dt) {
    const { ctx } = this;
    if (this.titleUp) { this.title.update(dt); return; }
    if (!this.started || !ctx.player) return;
    this._menuInput();
    if (!this.paused) {
      // timers (real seconds, pause-aware)
      for (let i = this._timers.length - 1; i >= 0; i--) {
        const t = this._timers[i];
        t.t -= dt;
        if (t.t <= 0) { this._timers.splice(i, 1); try { t.fn(); } catch (e) { console.error('[game timer]', e); } }
      }
      if (!this.quiet) { this.journal.update(dt); this._timeBased(); }
      else this.journal.update(dt);
    }
    const b = ctx.player.body;
    if (!this.paused && !this.ended) {
      this._checkGates();
      if (!this.busy) this._checkWalkIn(dt);
    }
    this._prev = { x: b.x, z: b.z, level: b.level };
    // interactions
    const canUse = !this.paused && !this.busy && !this.ended && !this.phoneOpen && !this.panels.open;
    if (canUse && !this.quiet) this.interactions.update(dt, true);
    else if (this.hud) this.hud.prompt(null);
  }
  // Esc / gamepad Start toggles the pause menu when the pointer isn't locked
  // (a locked pointer is released by the browser on Esc → pointerlockchange).
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
  // soft time pressure & hints, by game clock
  _timeBased() {
    const m = this.ctx.clock.minutes;
    while (this._timed < TIMED.length && TIMED[this._timed][0] <= m) {
      const [t, cond, text] = TIMED[this._timed++];
      if (this.journal.startMinutes != null && t < this.journal.startMinutes) continue;
      if (this.quests[cond] && this.quests[cond].state === 'done') continue;
      if (this.busy) { this.message(text, 'Aya', 8); continue; }
      this.message(text);
    }
    if (this._lastProgress != null && m - this._lastProgress > 40 && !this.busy) {
      this._lastProgress = m;
      for (const id of ['coffee', 'tempura', 'subway']) {
        const q = this.quests[id];
        if (q.state !== 'active') continue;
        const list = HINTS[id];
        if (this._hintIdx[id] < list.length) { this.message(list[this._hintIdx[id]++]); break; }
      }
    }
  }
}

function safe(fn) { try { return fn(); } catch (e) { return null; } }
