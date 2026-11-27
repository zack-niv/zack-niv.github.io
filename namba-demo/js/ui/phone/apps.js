// =============================================================================
// Phone apps other than Maps: home screen, Notes (quest checklist), Messages
// (texts from Aya via 'phone:message'), Transit (lines + departures).
// =============================================================================
import { LINES } from './places.js?v=5442362';
import { businessBySlot } from '../../world/directory.js?v=5442362';
import { placeArt } from './art.js?v=5442362';
import { bizSub, levelLabel, zoneShort } from './destinations.js?v=5442362';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hm = (m) => { m = Math.round(m) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

export const DEFAULT_QUESTS = [
  { id: 'coffee', state: 'active', text: 'Find a great coffee (4.5★+)', textJa: '美味しいコーヒー' },
  { id: 'tempura', state: 'active', text: 'Tempura for lunch', textJa: 'お昼は天ぷら' },
  { id: 'subway', state: 'active', text: 'Midosuji Line → Shin-Osaka', textJa: '御堂筋線で新大阪へ' },
];

export class HomeApp {
  constructor(phone, root) {
    this.phone = phone; this.root = root;
    root.classList.add('hs');
    const apps = [
      ['maps', 'Maps', 'ic-maps'], ['transit', 'Transit', 'ic-transit'], ['notes', 'Notes', 'ic-notes'], ['messages', 'Messages', 'ic-msg'],
      ['camera', 'Camera', 'ic-cam'], ['weather', 'Weather', 'ic-weather'], ['translate', 'Translate', 'ic-tr'], ['wallet', 'Wallet', 'ic-wallet'],
    ];
    root.innerHTML = `<div class="hs-wall"></div>
      <div class="hs-widget"><div class="hs-w-city">Osaka</div><div class="hs-w-t">24°</div><div class="hs-w-s">Sunny · H 27° L 19°</div></div>
      <div class="hs-grid">${apps.map(([id, n, ic]) => `<button class="hs-app" data-app="${id}"><i class="hs-ic ${ic}"><b class="hs-badge" hidden></b></i><span>${n}</span></button>`).join('')}</div>
      <div class="hs-dock">${['maps', 'messages', 'transit', 'notes'].map(id => `<button class="hs-app" data-app="${id}"><i class="hs-ic ${apps.find(a => a[0] === id)[2]}"></i></button>`).join('')}</div>`;
    root.querySelectorAll('.hs-app').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.app;
      if (['maps', 'transit', 'notes', 'messages', 'lodestone'].includes(id)) phone.openApp(id);
      else phone.toastIn(id === 'camera' ? 'Storage almost full' : id === 'translate' ? 'Offline language pack not downloaded' : id === 'wallet' ? 'ICOCA · use it at the gates' : 'Osaka 24° · Sunny');
    }));
  }
  addLodestone() {
    if (this.root.querySelector('[data-app="lodestone"]')) return;
    const grid = this.root.querySelector('.hs-grid');
    const b = document.createElement('button'); b.className = 'hs-app'; b.dataset.app = 'lodestone';
    b.innerHTML = '<i class="hs-ic ic-lode"><svg viewBox="0 0 32 32"><path d="M16 4 21 16 16 28 11 16Z" fill="#10192b" stroke="#ffb02e" stroke-width="1.8" stroke-linejoin="round"/><path d="M16 4 21 16H16Z" fill="#ffb02e"/><circle cx="16" cy="16" r="2" fill="#fff"/></svg></i><span>Lodestone</span>';
    b.addEventListener('click', () => this.phone.openApp('lodestone'));
    grid.insertBefore(b, grid.firstChild);
  }
  badge(app, n) {
    this.root.querySelectorAll(`.hs-app[data-app="${app}"] .hs-badge`).forEach(b => { b.hidden = !n; b.textContent = n; });
  }
}

export class NotesApp {
  constructor(phone, root) {
    this.phone = phone; this.root = root; this.ctx = phone.ctx;
    root.classList.add('nt');
    this.quests = new Map();
    for (const q of DEFAULT_QUESTS) this.quests.set(q.id, { ...q });
    const gq = this.ctx.game && this.ctx.game.quests;
    if (gq) for (const k in gq) this._merge(gq[k]);
    this.ctx.events.on('quest:update', (q) => { this._merge(q); this.render(); phone.notify('notes'); });
    this.render();
  }
  _merge(q) {
    if (!q || !q.id) return;
    const cur = this.quests.get(q.id) || {};
    this.quests.set(q.id, { ...cur, ...q });
  }
  render() {
    const list = [...this.quests.values()].filter(q => q.state !== 'hidden');
    const done = list.filter(q => q.state === 'done').length;
    this.root.innerHTML = `<div class="nt-h"><span class="nt-back">‹ Folders</span><span class="nt-dots">⋯</span></div>
      <div class="nt-doc"><div class="nt-date">Today · Namba, Osaka</div><h2>Namba to-do</h2>
      <ul>${list.map(q => `<li class="${q.state === 'done' ? 'done' : ''}"><i>${q.state === 'done' ? '✓' : ''}</i><div><b>${esc(q.text)}</b>${q.textJa ? `<small>${esc(q.textJa)}</small>` : ''}${q.detail ? `<em>${esc(q.detail)}</em>` : ''}${(q.notes || []).map(n => `<em>– ${esc(n)}</em>`).join('')}</div></li>`).join('')}</ul>
      <p class="nt-foot">${done}/${list.length} done. Train to Shin-Osaka for the shinkansen later!<br>Aya says: “Namba is FOUR stations. Check which one.”</p></div>`;
  }
}

// v23: the camera button's icon (the same on every device)
const CAM_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8.2A2.2 2.2 0 0 1 6.2 6h1.5l1.1-1.6a1.5 1.5 0 0 1 1.2-.65h4a1.5 1.5 0 0 1 1.2.65L16.3 6h1.5A2.2 2.2 0 0 1 20 8.2v8.6a2.2 2.2 0 0 1-2.2 2.2H6.2A2.2 2.2 0 0 1 4 16.8Z" fill="currentColor"/><circle cx="12" cy="12.4" r="3.5" fill="#fff"/><circle cx="12" cy="12.4" r="1.9" fill="currentColor" opacity=".55"/></svg>';
const reduceMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };
export class MessagesApp {
  // v3: replies. A text may carry reply chips (replies: [{id, text}], max 3); the player answers with
  // the phone up (click a chip, or keys 1 / 2 / 3). 'phone:reply' {msgId, replyId, text} is emitted and
  // the player's bubble appended. 'phone:typing' {from, on} shows the typing bubble ("Aya is typing…").
  // v23: the chips are OUTLINED suggestion pills above the input bar (they fly into the thread as a blue bubble when
  // tapped); the 📸 button is a camera icon at the left of the input bar that opens camera mode (phone/camera.js).
  constructor(phone, root) {
    this.phone = phone; this.root = root; this.ctx = phone.ctx;
    root.classList.add('ms');
    // yesterday's thread (neutral: the story starts with the first text of today)
    this.msgs = [
      { day: 'Yesterday' },
      { from: 'Aya', text: 'Tomorrow!!! 🎉 I’ll find us somewhere good for lunch', time: '21:14', me: false },
      { from: 'me', text: 'Can’t wait. Landing at Kansai 10:40 ✈️', time: '21:20', me: true },
      { from: 'Aya', text: 'Text me when you’re in Namba 🙌', time: '21:22', me: false },
      { day: 'Today' },
    ];
    this.unread = 0;
    this.pending = null;          // { msgId, from, replies: [{id, text}] } — reply chips on screen
    this.typingFrom = null; this._typT = 0;
    this._seen = new Set();
    this._autoId = 0;
    this._capDone = false;        // v23: the "Tap to reply" caption shows until the first reply
    this._late = false;           // v23: the next photo bubble waits for the phone to rise (camera mode)
    this.ctx.events.on('phone:message', (m) => this.receive(m));
    this.ctx.events.on('phone:typing', (e) => this.setTyping(e && e.from, !!(e && e.on)));
    // tap (or Enter / Space on the focused button) on the Lodestone link card, or on a reply chip
    root.addEventListener('click', (e) => {
      if (e.target.closest('.ms-link')) { this.phone.lodestoneAction(); return; }
      const pl = e.target.closest('.ms-place'); if (pl) { this.phone.openPlace(pl.dataset.id); return; }
      const c = e.target.closest('.ms-chip'); if (c) { this.reply(+c.dataset.i); return; }
      if (e.target.closest('.ms-cam')) this.snap();      // v23: the camera button
    });
    this.render();
  }
  markInstalled() { this.render(); }
  receive(m) {
    if (!m) return;
    if (m.id != null) { const k = String(m.id); if (this._seen.has(k)) return; this._seen.add(k); }
    const from = m.from || 'Aya';
    const time = m.time || this.ctx.clock.hhmm;
    const id = m.id != null ? m.id : 'm' + (++this._autoId);
    if (this.typingFrom === from) { this.typingFrom = null; this._typT = 0; }
    this.msgs.push({ id, from, text: m.text, time, me: false, link: m.link || null, place: m.place || null });
    const reps = Array.isArray(m.replies) ? m.replies.filter(r => r && r.text).slice(0, 3) : [];
    if (reps.length) this.pending = { msgId: id, from, replies: reps.map((r, i) => ({ id: r.id != null ? r.id : 'r' + i, text: String(r.text), photo: !!r.photo })), at: this.phone._now || 0 };
    if (m.link === 'lodestone') this.phone._noteOffer();
    // v23: Aya's "send me a pic of whatever's near you 📸" is the cue to the camera button: it pulses once the thread is on screen
    if (/send me a pic of whatever/i.test(String(m.text || '')) && !this._pulsed) this._pulsePending = true;
    const reading = this.phone.isOpen && this.phone.app === 'messages';
    if (!reading) this.unread++;
    this.render();
    this.phone.notify('messages', { title: from, text: m.text, reply: !!reps.length });
  }
  // answer the pending text with chip i (0-based). Returns true when sent. v23: a 📸 chip opens camera mode and the picture
  // is sent when it is shot (reply(i, { img })); opts.img is that picture.
  reply(i, opts) {
    const P = this.pending; if (!P) return false;
    const r = P.replies[i]; if (!r) return false;
    if (r.photo && !(opts && 'img' in opts)) {
      const cam = this.phone.camera;
      if (cam && cam.open({ reply: i })) return true;
    }
    this.pending = null;
    const img = r.photo ? (opts && opts.img) || null : null;
    const chip = this.root.querySelector(`.ms-chip[data-i="${i}"]`);
    this._flyFrom = chip && !r.photo ? chip.getBoundingClientRect() : null;
    this._capDone = true;
    if (r.photo && !(opts && opts.img)) { if (!opts || !opts.late) this._shutter(); }
    this.msgs.push(img ? { from: 'me', text: '', img, time: this.ctx.clock.hhmm, me: true, sent: true, late: this._late } : { from: 'me', text: r.photo ? '📸' : r.text, time: this.ctx.clock.hhmm, me: true, sent: true });
    this.render(true);
    this.ctx.audio && this.ctx.audio.play && this.ctx.audio.play('ui_select');
    this.ctx.events.emit('phone:reply', { msgId: P.msgId, replyId: r.id, text: r.text, from: P.from, photo: !!r.photo, img: !!img });
    this.phone._badges();
    return true;
  }
  // v11: a text the player sends without chips (e.g. "got your latte! ☕" when they buy it)
  sendMine(text) {
    if (!text) return;
    this.msgs.push({ from: 'me', text: String(text), time: this.ctx.clock.hhmm, me: true, sent: true });
    this.render(true); this.phone._badges && this.phone._badges();
    this.ctx.events.emit('phone:sent', { text });
  }
  // v11: a downscaled snapshot of the current frame. Rendering a frame and copying it in the same task keeps the
  // drawing buffer valid without preserveDrawingBuffer (no camera-attached meshes: the view is the photo).
  // v23: fr = the viewfinder frame as fractions of the viewport ({x, y, w, h}): the picture is exactly what was framed
  _capture(fr) {
    try {
      const eng = this.ctx.engine, cv = eng && eng.renderer && eng.renderer.domElement;
      if (!cv || !cv.width) return null;
      if (typeof eng.render === 'function') eng.render(0);
      const f = fr || { x: 0, y: 0, w: 1, h: 1 };
      const sx = f.x * cv.width, sy = f.y * cv.height, sw = f.w * cv.width, sh = f.h * cv.height;
      const w = 420, h = Math.max(1, Math.round(w * sh / sw));
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(cv, sx, sy, sw, sh, 0, 0, w, h);
      return c.toDataURL('image/jpeg', 0.74);
    } catch (e) { console.warn('[messages] photo', e && e.message); return null; }
  }
  _shutter() {
    try {
      const f = document.createElement('div'); f.className = 'ms-shutter';
      document.body.appendChild(f); setTimeout(() => f.remove(), 450);
      // two quick clicks of the existing UI blip, pitched up: a shutter
      const a = this.ctx.audio;
      if (a && a.play) { a.play('ui_select', { rate: 2.1, gain: 1.5 }); setTimeout(() => { try { a.play('ui_select', { rate: 1.4, gain: 1.2 }); } catch (e) { /* cosmetic */ } }, 70); }
    } catch (e) { /* cosmetic */ }
  }
  // v23: the camera button. State comes from the story (cooldown, Aya typing); 'hide' before the mission, after arrival, in the old arc.
  //   s: 'hide' | 'ready' | 'cool' (the 15 s cooldown; p shows it as a ring) | 'typing' (Aya is answering / a question is open)
  camState() {
    const S = this.ctx.game && this.ctx.game.story;
    const st = !S || typeof S.snapState !== 'function' ? 'hide' : S.snapState();
    if (st === 'hide') return { s: 'hide', p: 1 };
    const p = typeof S.snapProgress === 'function' ? S.snapProgress() : 1;
    if (this.pending) return { s: 'typing', p: 1 };
    if (st === 'ready') return { s: 'ready', p: 1 };
    return p < 1 ? { s: 'cool', p } : { s: 'typing', p: 1 };
  }
  _camHtml() {
    const c = this.camState(); if (c.s === 'hide') return '';
    const kb = !(this.ctx.input && this.ctx.input.touch);
    const label = c.s === 'ready' ? 'Take a photo for Aya' : c.s === 'cool' ? 'Camera is recharging' : 'Camera is waiting for Aya';
    return `<button type="button" class="ms-cam" data-s="${c.s}" style="--p:${c.p.toFixed(2)}" aria-label="${label}" aria-disabled="${c.s !== 'ready'}"><span class="ms-cam-ic">${CAM_ICON}</span>${kb ? '<kbd>P</kbd>' : ''}</button>`;
  }
  snap() {
    if (this.camState().s !== 'ready') { this._nudgeCam(); return false; }
    const cam = this.phone.camera; return !!(cam && cam.open());
  }
  _nudgeCam() { const b = this.root.querySelector('.ms-cam'); if (!b) return; b.classList.remove('nope'); void b.offsetWidth; b.classList.add('nope'); }
  sendPhoto(img) {
    const pic = img || this._capture(); if (!img) this._shutter();
    this.msgs.push(pic ? { from: 'me', text: '', img: pic, time: this.ctx.clock.hhmm, me: true, sent: true, late: this._late } : { from: 'me', text: '📸', time: this.ctx.clock.hhmm, me: true, sent: true });
    this.render(true);
    this.ctx.audio && this.ctx.audio.play && this.ctx.audio.play('ui_select');
    this.ctx.events.emit('phone:photo', { img: !!pic });
    this.phone._badges();
    return { img: !!pic };
  }
  clearReplies() { if (!this.pending) return; this.pending = null; this.render(); this.phone._badges(); }
  setTyping(from, on) {
    from = from || 'Aya';
    if (on) { this.typingFrom = from; this._typT = 12; }       // (safety: a typing bubble never hangs forever)
    else if (this.typingFrom === from) { this.typingFrom = null; this._typT = 0; }
    else return;
    this._renderTyping();
    this.phone.glance && this.phone.glance.refresh(true);
  }
  update(dt) {
    // v23: the camera button follows the story's state (cooldown ring, disabled while Aya types); a re-render only when it shows or hides
    const c = this.camState(), was = this._camSt;
    if (!was || c.s !== was.s || Math.abs(c.p - was.p) >= 0.02) {
      this._camSt = c;
      if (!was || (c.s === 'hide') !== (was.s === 'hide')) this.render();
      else { const b = this.root.querySelector('.ms-cam'); if (b) { b.dataset.s = c.s; b.style.setProperty('--p', c.p.toFixed(2)); b.setAttribute('aria-disabled', c.s !== 'ready'); } }
    }
    if (this._pulsePending && this.phone.isOpen && this.phone.app === 'messages') this._pulseCam();
    if (this._typT > 0) { this._typT -= dt; if (this._typT <= 0 && this.typingFrom) { this.typingFrom = null; this._renderTyping(); } }
  }
  // the camera button pulses once, the first time the thread is on screen after Aya's "send me a pic" line
  _pulseCam() {
    const b = this.root.querySelector('.ms-cam'); if (!b || b.dataset.s !== 'ready') return;
    this._pulsePending = false; this._pulsed = true;
    b.classList.remove('pulse'); void b.offsetWidth; b.classList.add('pulse');
    setTimeout(() => b.classList.remove('pulse'), 2600);
  }
  _linkCard() {
    const st = this.phone.upgradeStage;
    const label = st === 'ready' ? 'Open' : st === 'installing' || st === 'calibrating' ? 'Installing…' : 'Get';
    return `<button class="ms-link ${st === 'installing' || st === 'calibrating' ? 'busy' : ''} ${st === 'ready' ? 'done' : ''}" data-act="lodestone" aria-label="Lodestone: ${label}">
      <i class="ms-l-ic"><svg viewBox="0 0 32 32"><path d="M16 4 21 16 16 28 11 16Z" fill="#10192b" stroke="#ffb02e" stroke-width="1.8" stroke-linejoin="round"/><path d="M16 4 21 16H16Z" fill="#ffb02e"/><circle cx="16" cy="16" r="2" fill="#fff"/></svg></i>
      <span class="ms-l-t"><b>Lodestone</b><small>Indoor positioning that works inside buildings · lodestone.app</small></span><em>${label}</em></button>
      ${st === 'offer' ? `<span class="ms-l-hint">Tap the card${this.phone.ctx.input && this.phone.ctx.input.touch ? '' : ', or press <kbd>Enter</kbd>'}</span>` : ''}`;
  }
  // v5: the newest place link (Enter opens it while Messages is up)
  get lastPlace() { for (let i = this.msgs.length - 1; i >= 0; i--) if (this.msgs[i].place) return this.msgs[i].place; return null; }
  // a link-preview card for a place (like a maps share link): photo tile, name, floor · area · distance, "Open in …"
  _placeCard(id, newest) {
    const ph = this.phone, D = ph.dest, d = D && D.resolve(id); if (!d) return '';
    const b = businessBySlot[id], ld = ph.upgradeStage === 'ready';
    const sub = b ? bizSub(b, this.ctx.clock.minutes) : null;
    const tile = b ? `<img class="ms-p-ph" src="${placeArt(b, 240, 240)}" alt="">` : `<i class="ms-p-ph ms-p-gl">${esc(d.icon || '📍')}</i>`;
    const meta = [levelLabel(d.level), zoneShort(d.zone)].filter(Boolean).join(' · ');
    const st = sub ? (sub.closed ? '<u class="cl">Closed</u>' : '<u class="op">Open</u>') : '';
    const kb = newest && !(this.ctx.input && this.ctx.input.touch) && ph.upgradeStage !== 'offer' ? '<kbd>Enter</kbd>' : '';
    return `<button class="ms-place ${ld ? 'ld' : 'mp'}" data-id="${esc(id)}" aria-label="${esc(d.name)}: open in ${ld ? 'Lodestone' : 'Maps'}">
      ${tile}<span class="ms-p-t"><b>${esc(d.name)}</b><small>${esc(meta)} · <span class="ms-p-d">${esc(this._placeDist(id))}</span></small>
      <em>${ld ? 'Open in Lodestone' : 'Open in Maps'} ›${kb}</em></span></button>`;
  }
  // the distance as the active app sees it: Maps' crow-flies from where it THINKS you are, Lodestone's true path
  _placeDist(id) {
    const ph = this.phone;
    try {
      if (ph.upgradeStage === 'ready' && ph.lodestone) {
        const d = ph.dest.resolve(id), g = d && ph.lodestone._guidFor(d), m = g && g.remaining(this.ctx.player.body);
        if (isFinite(m)) return `${Math.max(5, Math.round(m / 5) * 5)} m`;
      }
      const M = ph.maps, p = M && M.placeById(id);
      if (p) { const m = M._crow(p); return m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(1)} km`; }
    } catch (e) { /* distance is decoration */ }
    return '';
  }
  _refreshPlaces() { this.root.querySelectorAll('.ms-place').forEach(el => { const t = el.querySelector('.ms-p-d'); const v = this._placeDist(el.dataset.id); if (t && t.textContent !== v) t.textContent = v; }); }
  onShow() { this._refreshPlaces(); this.unread = 0; this.phone._badges && this.phone._badges(); this._pin(); }
  _chips() {
    const P = this.pending; if (!P) return '';
    const touch = !!(this.ctx.input && this.ctx.input.touch), kb = !touch;
    const cap = this._capDone ? '' : `<div class="ms-cap">${touch ? 'Tap to reply' : 'Click a reply, or press 1 2 3'}</div>`;
    return `${cap}<div class="ms-replies" role="group" aria-label="Reply to ${esc(P.from)}">${P.replies.map((r, i) => `<button type="button" class="ms-chip${r.photo ? ' ms-chip-photo' : ''}" data-i="${i}">${kb ? `<kbd>${i + 1}</kbd>` : ''}<span>${esc(r.text)}</span></button>`).join('')}</div>`;
  }
  // v9.1: keep the newest message in view. Pinning once at render is not enough: the reply tray slides in (0.35 s) and
  // place-card thumbnails load late, and both change the list's height after the fact, which hid the newest text
  // behind the chips (Zack's screenshot). Re-pin after the next frame, after the tray animation, and on image loads.
  _pin() {
    const s = this.root.querySelector('.ms-list'); if (!s) return;
    const go = () => { s.scrollTop = s.scrollHeight; };
    go(); requestAnimationFrame(go); clearTimeout(this._pinT); this._pinT = setTimeout(go, 420);
    s.querySelectorAll('img').forEach(i => { if (!i.complete) i.addEventListener('load', go, { once: true }); });
  }
  _typingHtml() { return this.typingFrom ? `<div class="ms-b ms-typing" aria-label="${esc(this.typingFrom)} is typing"><p><i></i><i></i><i></i></p></div>` : ''; }
  _renderTyping() {
    const list = this.root.querySelector('.ms-list'); if (!list) return;
    const t = list.querySelector('.ms-typing'); if (t) t.remove();
    if (this.typingFrom) list.insertAdjacentHTML('beforeend', this._typingHtml());
    const sm = this.root.querySelector('.ms-h small'); if (sm) sm.textContent = this.typingFrom ? 'typing…' : 'Osaka · usually replies fast';
    this.root.classList.toggle('ms-is-typing', !!this.typingFrom);
    list.scrollTop = list.scrollHeight;
  }
  render(sentNow) {
    const last = this.msgs.length - 1;
    let lastPlI = -1; for (let i = last; i >= 0; i--) if (this.msgs[i].place) { lastPlI = i; break; }
    const lastPl = lastPlI >= 0 ? this.msgs[lastPlI].place : null;
    const bubble = (m, i) => {
      if (m.day) return `<div class="ms-day">${esc(m.day)}</div>`;
      const fresh = sentNow && i === last && m.me ? ' ms-sent' : '';
      if (m.img) return `<div class="ms-b me ms-photo${fresh}${fresh && m.late ? ' late' : ''}"><img src="${m.img}" alt="Photo you sent"><small>${esc(m.time)}${i === last && m.sent ? ' · Delivered' : ''}</small></div>`;   // v11
      return `<div class="ms-b ${m.me ? 'me' : ''}${fresh}${m.place ? ' ms-has-place' : ''}"><p>${esc(m.text)}</p>${m.link ? this._linkCard() : ''}${m.place ? this._placeCard(m.place, m.place === lastPl && i === lastPlI) : ''}<small>${esc(m.time)}${m.me && i === last && m.sent ? ' · Delivered' : ''}</small></div>`;
    };
    this.root.innerHTML = `<div class="ms-h"><span class="ms-back">‹</span><div class="ms-av">A</div><div><b>Aya</b><small>${this.typingFrom ? 'typing…' : 'Osaka · usually replies fast'}</small></div></div>
      <div class="ms-list">${this.msgs.map(bubble).join('')}${this._typingHtml()}</div>
      ${this._chips()}
      <div class="ms-in">${this._camHtml()}<div class="ms-field"><span>iMessage</span><i>↑</i></div></div>`;
    this.root.classList.toggle('ms-has-replies', !!this.pending);
    this.root.classList.toggle('ms-is-typing', !!this.typingFrom);
    this._pin();
    // v23: the tapped pill flies into the thread and turns into the blue bubble (FLIP: from the pill's rect to the bubble's)
    if (sentNow && this._flyFrom && !reduceMotion()) {
      const p = this.root.querySelector('.ms-b.me.ms-sent:not(.ms-photo) p'), list = this.root.querySelector('.ms-list');
      if (p && list && list.offsetWidth) {
        const k = list.getBoundingClientRect().width / list.offsetWidth || 1, a = this._flyFrom, r = p.getBoundingClientRect();
        if (r.width && a.width) {
          p.style.setProperty('--fx', ((a.right - r.right) / k).toFixed(1) + 'px'); p.style.setProperty('--fy', ((a.top + a.height / 2 - r.top - r.height / 2) / k).toFixed(1) + 'px');
          p.parentNode.classList.add('fly');
        }
      }
    }
    this._flyFrom = null;
    this._camSt = this.camState();
    this.phone._badges && this.phone._badges();
  }
}

export class TransitApp {
  constructor(phone, root) {
    this.phone = phone; this.root = root; this.ctx = phone.ctx;
    root.classList.add('tr');
    this._t = 0;
    this.render();
  }
  _deps(track) {
    const tr = this.ctx.transit;
    if (this.phone.pos.noService) return null;
    if (tr && typeof tr.nextDepartures === 'function') {
      try { const d = tr.nextDepartures(track, 3); if (d && d.length) return d; } catch (e) { /* ignore */ }
    }
    return [];
  }
  render() {
    const rows = [
      ['midosuji', 'm_track2', '2', '梅田・新大阪方面', 'for Umeda / Shin-Osaka'],
      ['midosuji', 'm_track1', '1', '天王寺・なかもず方面', 'for Tennoji / Nakamozu'],
      ['sennichimae', 's_track1', '1', '日本橋・鶴橋方面', 'for Nippombashi / Tsuruhashi'],
      ['nankai', 'nk_track_4', '4', 'ラピート 関西空港', 'rapi:t for Kansai Airport'],
    ];
    const off = this.phone.pos.noService;
    this.root.innerHTML = `<div class="tr-h"><b>Transit</b><small>${off ? '圏外 No service — showing saved timetable info' : 'Namba · 4 stations nearby'}</small></div>
      <div class="tr-card tr-plan"><div class="tr-from">● Namba <small>なんば (M20)</small></div><div class="tr-line" style="--c:${LINES.midosuji.color}"><i class="mp-lb circle" style="--c:${LINES.midosuji.color}">M</i> Midosuji Line · for Umeda / Shin-Osaka · <b>Track 2</b></div><div class="tr-to">● Shin-Osaka <small>新大阪 (M13)</small> <b>15 min · ¥290</b></div></div>
      ${rows.map(([line, track, no, ja, en]) => {
        const L = LINES[line]; const deps = this._deps(track);
        const list = deps == null ? '<span class="tr-dim">— no data —</span>' : deps.length ? deps.slice(0, 3).map(d => `<span>${esc(d.time || (d.minutes != null ? hm(d.minutes) : ''))} <small>${esc(d.dest || d.destination || '')}</small></span>`).join('') : '<span class="tr-dim">every 3–6 min</span>';
        return `<div class="tr-card"><div class="tr-row"><i class="mp-lb ${L.shape}" style="--c:${L.color}">${L.letter}</i><div class="tr-r-m"><b>${esc(L.en)} <span class="tr-no">${no}</span></b><small>${esc(ja)} · ${esc(en)}</small></div></div><div class="tr-deps">${list}</div></div>`;
      }).join('')}
      <p class="tr-note">Osaka Metro なんば ≠ Nankai なんば ≠ Kintetsu 大阪難波 ≠ JR難波</p>`;
  }
  update(dt) { this._t += dt; if (this._t > 5) { this._t = 0; this.render(); } }
}
