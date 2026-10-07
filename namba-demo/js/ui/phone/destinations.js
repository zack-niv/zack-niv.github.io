// =============================================================================
// Destinations (v4) — the ONE place both apps navigate to, chosen by the player.
//
//   Destinations   state + events, owned by the phone (ctx.phone.destination …)
//     suggest(id)        Aya's pick: highlighted at the top of both apps' lists
//     set(id, {app})     the player picked a place → 'nav:destination'
//     clear()            no destination (both apps show their list)
//     update(dt)         the true-position arrival check → 'nav:arrived'
//   DestList       the shared "Where to?" list (Maps and Lodestone styling):
//                  optional search box, category chips, "From Aya" row on top,
//                  numbered rows (1–9), a keyboard highlight (↑ ↓ Enter).
//
// A destination id is a shop slot from world/directory.js ('link_e03', …) or,
// for the non-shop places Maps can search (stations, exits, toilets, areas),
// the Maps place id ('t:midosuji', 'x:18', 'f:…', 'a_parks').
// Contract: notes/v4-phone.md.
// =============================================================================
import { businessBySlot, FEATURED, CATEGORIES, isOpen } from '../../world/directory.js';
import { LEVELS, ZONES } from '../../world/layout.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const lvl = (l) => (LEVELS[l] ? LEVELS[l].label : String(l || '')).replace('B1F', 'B1').replace('B2F', 'B2');
const hm = (m) => { m = Math.round(m) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
export const DEST_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'ArrowUp', 'ArrowDown', 'Enter'];
// category chips (a query each; same words the Maps search understands)
export const PICK_CATS = [['coffee', '☕', 'Coffee'], ['tempura', '🍤', 'Tempura'], ['ramen', '🍜', 'Ramen'], ['sushi', '🍣', 'Sushi'], ['toilet', '🚻', 'Toilets'], ['midosuji', '🚇', 'Trains']];
const ZONE_SHORT = { nankai: 'Nankai', city: 'Namba CITY', parks: 'Namba Parks', parksGarden: 'Parks Garden', nambawalk: 'NAMBAWALK', takashimaya: 'Takashimaya', link: 'Underground passage', plaza: 'Namba Plaza' };
export const zoneShort = (z) => ZONE_SHORT[z] || (ZONES[z] && ZONES[z].name) || '';

// destination id of a Maps place object
export const destIdOf = (p) => (p ? (p.kind === 'biz' && p.b ? p.b.slot : p.id) : null);

export class Destinations {
  constructor(phone) {
    this.phone = phone; this.ctx = phone.ctx;
    this.current = null;          // { slotId, id, name, en, level, x, z, nx, nz, app, suggested, arrived, … }
    this.suggested = null;        // slotId
    this.legs = [];               // [{ slotId, name, app, suggested, t0, t1, m0, m1, arrived }]
    this.last = null;             // the last destination reached (for "Arrived · …")
    this._at = 0;
  }

  // ---- resolve an id into a destination (TRUE door position; Maps shows its own fuzzy pin) ----
  resolve(id) {
    if (!id) return null;
    const b = businessBySlot[id];
    if (b) return { slotId: id, id, slot: id, kind: 'biz', name: b.en, en: b.en, ja: b.ja, level: b.level, x: b.door.ox, z: b.door.oz, nx: b.door.nx, nz: b.door.nz, doorX: b.door.x, doorZ: b.door.z, zone: b.zone, cat: b.cat, rating: b.rating, icon: b.info && b.info.icon };
    const M = this.phone.maps, p = M && M.placeById ? M.placeById(id) : null;
    if (!p || !p.level || !LEVELS[p.level]) return null;
    const sp = this.ctx.world && this.ctx.world.spaceAt ? this.ctx.world.spaceAt(p.level, p.x, p.z) : null;
    return { slotId: id, id, slot: null, kind: p.kind, name: p.en, en: p.en, ja: p.ja, level: p.level, x: p.x, z: p.z, nx: null, nz: null, zone: sp ? sp.zone : null, transit: p.kind === 'transit', icon: p.icon };
  }
  name(id) { const d = this.resolve(id); return d ? d.name : ''; }

  suggest(id) {
    if (id != null && !this.resolve(id)) return false;
    if ((id || null) === this.suggested) return true;
    this.suggested = id || null;
    this._changed();
    return true;
  }

  set(id, opts = {}) {
    const d = this.resolve(id); if (!d) return false;
    const ph = this.phone;
    const app = opts.app === 'lodestone' || opts.app === 'maps' ? opts.app : (ph.app === 'lodestone' || (ph.upgradeStage === 'ready' && ph.app !== 'maps') ? 'lodestone' : 'maps');
    // the same place again while still going there: just show it (no new leg, no event spam)
    const C = this.current;
    if (C && C.id === d.id && !C.arrived) { this._route(C, app, opts); return true; }
    d.app = app; d.suggested = d.id === this.suggested; d.arrived = false;
    this.current = d;
    const metres = this._metres();
    this.legs.push({ slotId: d.slotId, name: d.name, app, suggested: d.suggested, t0: ph._play || 0, t1: null, m0: metres, m1: null, arrived: false, mode: ph.positioningMode });
    this._route(d, app, opts);
    this.ctx.events.emit('nav:destination', { slotId: d.slotId, name: d.name, app, suggested: d.suggested });
    this._changed();
    return true;
  }
  _route(d, app, opts) {
    const ph = this.phone;
    try { ph.maps && ph.maps.onDestination(d, app === 'maps' && !opts.quiet); } catch (e) { console.error('[phone] maps destination', e); }
    try { ph.lodestone && ph.lodestone.onDestination(d); } catch (e) { console.error('[phone] lodestone destination', e); }
  }

  clear() {
    if (!this.current) return;
    this.current = null;
    try { this.phone.maps && this.phone.maps.onDestination(null); } catch (e) { console.error(e); }
    try { this.phone.lodestone && this.phone.lodestone.onDestination(null); } catch (e) { console.error(e); }
    this._changed();
  }

  // the suggestion worth offering as the next pick (not where you are / are already going)
  next() {
    const s = this.suggested, C = this.current;
    if (!s) return null;
    if (C && C.id === s) return null;
    return s;
  }

  _metres() { const st = this.phone._stats; return st ? Math.round((st.before.dist || 0) + (st.after.dist || 0)) : 0; }
  _changed() {
    const ph = this.phone;
    ph.maps && ph.maps.onListChanged && ph.maps.onListChanged();
    ph.lodestone && ph.lodestone.onListChanged && ph.lodestone.onListChanged();
    ph.glance && ph.glance.refresh(true);
  }

  // ---- arrival: the TRUE position, ~2.5 Hz, runs with the phone down too ----
  update(dt) {
    const C = this.current; if (!C || C.arrived) return;
    this._at -= dt; if (this._at > 0) return; this._at = 0.4;
    const ctx = this.ctx, b = ctx.player && ctx.player.body; if (!b || b.ramp >= 0) return;
    const lv = this.phone.pos && this.phone.pos.trueLevel ? this.phone.pos.trueLevel(b) : b.level;
    if (lv !== C.level) return;
    const d = Math.hypot(b.x - C.x, b.z - C.z);
    const dDoor = C.doorX != null ? Math.hypot(b.x - C.doorX, b.z - C.doorZ) : Infinity;
    let near = d < (C.kind === 'biz' ? 4 : 6) || dDoor < 3;
    if (!near) { const L = this.phone.lodestone; const rem = L && L.remainingTo ? L.remainingTo(C, b) : Infinity; near = rem < 5; }
    if (near) this.arrive();
  }
  arrive() {
    const C = this.current; if (!C || C.arrived) return;
    C.arrived = true; this.last = C;
    const leg = this.legs[this.legs.length - 1];
    if (leg && !leg.arrived) { leg.arrived = true; leg.t1 = this.phone._play || 0; leg.m1 = this._metres(); }
    const app = this.phone.upgradeStage === 'ready' ? 'lodestone' : 'maps';
    try { this.phone.lodestone && this.phone.lodestone.onArrived(C); } catch (e) { console.error(e); }
    try { this.phone.maps && this.phone.maps.onArrived(C); } catch (e) { console.error(e); }
    this.ctx.events.emit('nav:arrived', { slotId: C.slotId, name: C.name, app });
    this._changed();
  }
  // per-leg numbers for stats()
  legStats() {
    return this.legs.map(l => ({ slotId: l.slotId, name: l.name, app: l.app, suggested: l.suggested, arrived: l.arrived,
      seconds: Math.round(((l.t1 != null ? l.t1 : (this.phone._play || 0)) - l.t0)), metres: Math.max(0, (l.m1 != null ? l.m1 : this._metres()) - l.m0) }));
  }
}

// =============================================================================
// The shared list. theme 'maps' | 'lodestone'. The host app gives it:
//   items()          → [{ id, place?, name, ja, icon, sub, aya, note }]
//   onPick(item)     the player picked (click, 1–9, Enter)
// =============================================================================
export class DestList {
  constructor(root, { theme, search = false, chips = true, onPick, onQuery, title = 'Where to?' }) {
    this.root = root; this.theme = theme; this.onPick = onPick; this.onQuery = onQuery;
    this.items = []; this.sel = 0; this.armed = false; this.query = '';
    root.classList.add('dl', 'dl-' + theme);
    root.innerHTML = `
      ${title ? `<div class="dl-h"><b class="dl-t">${esc(title)}</b><span class="dl-hint"></span></div>` : ''}
      ${search ? `<div class="dl-s"><svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg><input type="text" placeholder="Search Namba" spellcheck="false" autocomplete="off"><kbd>/</kbd><button class="dl-x" hidden>×</button></div>` : ''}
      ${chips ? `<div class="dl-chips">${PICK_CATS.map(([q, ic, t]) => `<button data-q="${q}"><span>${ic}</span>${t}</button>`).join('')}</div>` : ''}
      <div class="dl-rows" role="listbox"></div>`;
    this.rowsEl = root.querySelector('.dl-rows');
    this.hintEl = root.querySelector('.dl-hint');
    this.titleEl = root.querySelector('.dl-t');
    this.input = root.querySelector('.dl-s input');
    const clr = root.querySelector('.dl-x');
    if (this.input) {
      this.input.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Enter') { this.input.blur(); if (this.items.length) this.pick(this.sel); }
        else if (e.key === 'Escape') this.input.blur();
        else if (e.key === 'ArrowDown') { e.preventDefault(); this.move(1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); this.move(-1); }
      });
      this.input.addEventListener('keyup', e => e.stopPropagation());
      this.input.addEventListener('input', () => { clr.hidden = !this.input.value; this.setQuery(this.input.value); });
      clr.addEventListener('click', () => { this.input.value = ''; clr.hidden = true; this.setQuery(''); });
    }
    root.querySelectorAll('.dl-chips button').forEach(b => b.addEventListener('click', () => {
      const on = b.classList.contains('on');
      root.querySelectorAll('.dl-chips button').forEach(x => x.classList.remove('on'));
      if (!on) b.classList.add('on');
      if (this.input) { this.input.value = on ? '' : b.textContent.replace(/^\S+/, '').trim(); clr.hidden = !this.input.value; }
      this.setQuery(on ? '' : b.dataset.q);
    }));
  }
  setQuery(q) { this.query = q || ''; this.sel = 0; this.armed = false; this.root.classList.remove('kb'); this.onQuery && this.onQuery(this.query); }
  focusSearch() { if (this.input) { this.input.focus(); return true; } return false; }
  setTitle(t, hint) { if (this.titleEl && t != null && this.titleEl.textContent !== t) this.titleEl.textContent = t; if (this.hintEl && hint != null && this.hintEl.innerHTML !== hint) this.hintEl.innerHTML = hint; }

  render(items) {
    this.items = items || [];
    if (this.sel >= this.items.length) this.sel = 0;
    const touch = this.touch;
    this.rowsEl.innerHTML = this.items.length ? this.items.map((it, i) => `
      <button class="dl-r${it.aya ? ' aya' : ''}${i === this.sel ? ' sel' : ''}${it.closed ? ' closed' : ''}" data-i="${i}" role="option">
        <i class="dl-ic">${it.iconHtml || esc(it.icon || '📍')}</i>
        <span class="dl-m">${it.aya ? `<em class="dl-aya">${esc(it.aya)}</em>` : ''}<b>${esc(it.name)}</b><small>${it.subHtml || esc(it.sub || '')}</small></span>
        ${it.right ? `<span class="dl-d">${esc(it.right)}</span>` : ''}
        ${i < 9 && !touch ? `<kbd>${i + 1}</kbd>` : ''}
      </button>`).join('') : `<div class="dl-empty">No places for “${esc(this.query)}”</div>`;
    this.rowsEl.querySelectorAll('.dl-r').forEach(el => {
      el.addEventListener('click', (e) => { e.stopPropagation(); this.pick(+el.dataset.i); });
      el.addEventListener('mouseenter', () => { this.sel = +el.dataset.i; this.armed = true; this._sync(); });
    });
  }
  // cheap in-place text updates (distances) without rebuilding the rows
  refreshRight(fn) {
    this.rowsEl.querySelectorAll('.dl-r').forEach(el => {
      const it = this.items[+el.dataset.i], d = el.querySelector('.dl-d'); if (!it || !d) return;
      const t = fn(it); if (t != null && d.textContent !== t) d.textContent = t;
    });
  }
  move(d) {
    if (!this.items.length) return;
    this.sel = (this.sel + d + this.items.length) % this.items.length; this.armed = true; this.root.classList.add('kb'); this._sync();
    const el = this.rowsEl.querySelector('.dl-r.sel'); if (el && el.scrollIntoView) try { el.scrollIntoView({ block: 'nearest' }); } catch (e) { /* ignore */ }
  }
  _sync() { this.rowsEl.querySelectorAll('.dl-r').forEach(el => el.classList.toggle('sel', +el.dataset.i === this.sel)); }
  pick(i) {
    const it = this.items[i]; if (!it) return false;
    this.sel = i; this._sync();
    const el = this.rowsEl.querySelector(`.dl-r[data-i="${i}"]`);
    if (el) { el.classList.remove('picked'); void el.offsetWidth; el.classList.add('picked'); }
    this.onPick && this.onPick(it);
    return true;
  }
  get visible() { return !!(this.root.isConnected && this.root.offsetParent !== null && this.items.length); }
}

// ---- the default list (no query): Aya's pick first, then the places Maps offers up front ----
// `view(id)` turns an id into the host app's place info; returns rows for DestList.
export function defaultIds(suggested, exclude) {
  const ids = Object.keys(FEATURED).filter(id => businessBySlot[id] && id !== suggested && id !== exclude);
  return (suggested ? [suggested] : []).concat(ids);
}

// shared row text for a business (category · floor · area, open / closed)
export function bizSub(b, minutes) {
  const open = isOpen(b, minutes);
  const st = b.cat === 'closed' ? 'Closed for renovation' : open ? '' : `Closed · opens ${hm(b.hours[0])}`;
  return { sub: [CATEGORIES[b.cat].en.replace(/ \(.*\)$/, ''), lvl(b.level), zoneShort(b.zone)].filter(Boolean).join(' · '), closed: !open, status: st };
}
export { lvl as levelLabel, esc as escHtml };
