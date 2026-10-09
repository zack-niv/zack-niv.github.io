// =============================================================================
// Vignettes: small, elegant moments. Each is an async function (game, ...)
// that opens panels, plays lines, passes time and updates quests.
// The game marks itself busy (player frozen) while one runs.
// =============================================================================
import { isOpen } from '../world/directory.js?v=f150c03';
import { MENUS, BARISTA, AFTERTASTE, PEEK } from './script.js?v=f150c03';
import { yen, esc } from './panel.js?v=f150c03';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const hhmm = (m) => { m = Math.round(m) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

// Pay with the ICOCA card. Returns true if paid by card (else coins). v6: the one IC mechanism (game.icCharge).
function payIC(game, price, note) {
  if (typeof game.icCharge === 'function') return game.icCharge({ amount: price, kind: 'purchase', label: 'お支払い Paid', note: note || '', orCoins: true }).ok;
  const ic = game.ic;
  if (ic.balance >= price) {
    ic.balance -= price;
    game.ctx.audio?.play?.('pay');
    game.hud?.ic({ balance: ic.balance, fare: price, ok: true, label: 'お支払い Paid' });
    return true;
  }
  game.ctx.audio?.play?.('gate_fail');
  game.hud?.ic({ balance: ic.balance, ok: false, reason: 'Paid in coins instead' });
  return false;
}

async function say(game, line, speaker, extra = 0) {
  if (!line) return;
  const dur = Math.max(2.6, ((line.en || '').length + (line.ja || '').length * 1.4) * 0.05) + extra;
  game.hud?.caption({ ja: line.ja, en: line.en, speaker, duration: dur });
  await sleep(dur * 1000 * 0.82);
}
async function think(game, text, dur) {
  const d = dur || Math.max(2.8, text.length * 0.055);
  game.hud?.caption({ en: text, kind: 'thought', duration: d });
  await sleep(d * 1000 * 0.85);
}

// Fade out, advance the clock, fade back. Optional text shown in the dark.
export async function passTime(game, minutes, html, holdMs = 1600, opts = {}) {
  const hud = game.hud;
  const veil = !opts.black;
  hud.veil(veil);
  await hud.fade(1, veil ? 1100 : 900);
  if (html) hud.fadeText(`${html}<div class="h-fade-clock">${hhmm(game.ctx.clock.minutes)} → ${hhmm(game.ctx.clock.minutes + minutes)}</div>`);
  game.ctx.clock.minutes += minutes;
  game.ctx.clock.update(0);
  await sleep(holdMs);
  hud.fadeText('');
  await hud.fade(0, 1300);
  hud.veil(false);
}

// settle the view on the counter / the fryer while the world carries on behind the veil
function faceShop(game, b, pitch = -0.2) {
  const d = b && b.door;
  if (d && game.lookDir) game.lookDir(-d.nx, -d.nz, pitch);
}

function closedCard(game, b, extraHtml = '') {
  const opens = hhmm(b.hours[0]);
  return game.panels.card({
    style: 'sign', side: 'center',
    html: `<div class="g-sign-ja">準備中</div><div class="g-sign-en">Closed right now</div>
      <div class="g-sign-name">${esc(b.ja)}<span>${esc(b.en)}</span></div>
      <div class="g-sign-hours">営業時間 ${hhmm(b.hours[0])} – ${hhmm(b.hours[1])}<br><small>Opens at ${opens}</small></div>${extraHtml}`,
    buttons: [{ label: 'Okay', value: true }],
  });
}

// ---------------------------------------------------------------------------
// Coffee
// ---------------------------------------------------------------------------
export async function orderCoffee(game, b) {
  const { ctx } = game;
  const key = b.key && b.key.startsWith('coffee_') ? b.key : 'cafe';
  if (!isOpen(b, ctx.clock.minutes)) { await closedCard(game, b); return; }
  faceShop(game, b, -0.24);
  const lines = BARISTA[key] || BARISTA.cafe;
  game.hud.caption({ ja: lines[0].ja, en: lines[0].en, speaker: key === 'coffee_kissa' ? 'Mama-san' : 'Barista', duration: 4 });
  const menu = MENUS[key] || MENUS.cafe;
  const items = menu.map(([ja, en, price]) => ({ ja, en, price }));
  items.push({ en: 'Just looking, thanks', ja: 'やっぱりいいです', quiet: true, value: -1 });
  const kicker = b.info ? `${b.info.ja} · ${b.info.en}` : '';
  const choice = await game.panels.menu({
    style: key === 'coffee_kissa' ? 'kissa' : key === 'coffee_chain' ? 'chain' : 'paper',
    kicker, titleJa: b.ja, title: b.en,
    sub: key === 'coffee_great' ? 'Hand-ground · one cup at a time' : key === 'coffee_kissa' ? '昭和四十九年創業 · since 1974' : key === 'coffee_chain' ? 'Order at the counter · 番号でお呼びします' : '',
    items, cancelValue: -1,
    foot: `<span class="g-foot-ic">ICOCA</span> ${yen(game.ic.balance)}`,
  });
  if (choice == null || choice < 0) { game.hud.caption({ en: 'Maybe later.', kind: 'thought', duration: 2 }); return; }
  const [ja, en, price] = menu[choice];
  payIC(game, price, b.en);
  await sleep(700);
  await say(game, lines[1] || lines[0], key === 'coffee_kissa' ? 'Mama-san' : 'Barista');
  ctx.audio?.play?.('grinder'); setTimeout(() => ctx.audio?.play?.('cup'), 1800);
  // a coffee is world flavour in the demo: a short, soft moment (never a quest, never a lost half hour)
  const scene = key === 'coffee_great'
    ? `<div class="h-fade-big">${esc(ja)}</div><div class="h-fade-small">You stand at the narrow counter and watch the kettle pour in slow circles.</div>`
    : key === 'coffee_kissa'
      ? `<div class="h-fade-big">${esc(ja)}</div><div class="h-fade-small">The siphon gurgles. A man in the corner reads a newspaper from another decade.</div>`
      : `<div class="h-fade-big">${esc(ja)}</div><div class="h-fade-small">${esc(en)}.</div>`;
  await passTime(game, 2, scene, 1500);
  game.journal.coffees++;
  game.hud.cup(true);
  clearTimeout(game._cupT);
  game._cupT = setTimeout(() => game.hud.cup(false), 90000);
  await think(game, AFTERTASTE[key] || AFTERTASTE.cafe, 4);
}

// Peek into any other restaurant / shop
export async function peek(game, b) {
  const m = game.ctx.clock.minutes;
  const open = isOpen(b, m);
  const line = PEEK[b.cat] || 'You look in for a moment.';
  game.hud.caption({ ja: `${b.ja}`, en: open ? line : `${line} (Opens ${hhmm(b.hours[0])}.)`, kind: 'thought', duration: Math.max(3.5, line.length * 0.05) });
}

// ---------------------------------------------------------------------------
// Ticket / charge machine
// ---------------------------------------------------------------------------
export async function chargeMachine(game, gate) {
  const { ctx } = game;
  const lineName = gate.line === 'midosuji' ? '御堂筋線 Midosuji Line' : gate.line === 'sennichimae' ? '千日前線 Sennichimae Line' : '南海線 Nankai Line';
  for (;;) {
    const c = await game.panels.menu({
      style: 'machine', kicker: `券売機 · ${lineName}`, titleJa: 'きっぷ・チャージ', title: 'Tickets & IC charge',
      sub: `ICOCA balance <b>${yen(game.ic.balance)}</b>`, subHtml: true,
      items: [
        { ja: 'チャージ ¥1,000', en: 'Charge ¥1,000', value: 1000 },
        { ja: 'チャージ ¥2,000', en: 'Charge ¥2,000', value: 2000 },
        { ja: 'チャージ ¥3,000', en: 'Charge ¥3,000', value: 3000 },
        { ja: '取消', en: 'Cancel', quiet: true, value: -1 },
      ],
      cancelValue: -1,
    });
    if (c == null || c === -1) return;
    ctx.audio?.play?.('charge');
    game.hud.caption({ en: 'The machine counts your notes with tremendous seriousness.', kind: 'thought', duration: 3 });
    await sleep(1400);
    game.ic.balance += c;
    ctx.audio?.play?.('pay');
    game.hud.ic({ balance: game.ic.balance, ok: true, reason: `+${yen(c)} チャージ` });
    game.ctx.events.emit('ic:charge', { amount: c, balance: game.ic.balance });
    return;
  }
}
