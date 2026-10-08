// =============================================================================
// Counter service (v2 item 7): "Order a coffee ☕" / "Say hi" at the order spot in front of a counter.
//
// The Shops agent publishes ctx.counters = [{ slotId, name, kind, level, staff:{x,y,z,yaw}, order:{x,y,z}, role }]
// during the build phase (see notes/v2-shops.md). This module turns every entry into a lazily-built interactable
// that the Interactions registry considers each frame (see Interactions.counterItem). Entirely defensive: if
// ctx.counters is missing, empty or malformed, nothing happens.
//
// The exchange is a few lines of captions and a toast, never a modal: the player can keep walking.
//   cafés:  いらっしゃいませ! -> "One latte, please." -> "かしこまりました" -> toast "☕ latte — Pine Tree Coffee",
//           the cup icon stays in the HUD, the order is listed in the pause menu's "Today" panel.
//   others: a greeting and a one-line reply ("Say hi").
// Emits ctx.events 'demo:order' { slotId, name, item, kind }.
// =============================================================================
import { businessBySlot, isOpen } from '../world/directory.js?v=6c67dba';
import { DEMO, PEEK } from './script.js?v=6c67dba';

const REACH = 1.7;          // metres from the order spot (spec: ~1.6)
const FACE_DOT = 0.3;       // cos of the largest angle between the view and the staff (about 72 degrees)
const COOLDOWN_MS = 3400;   // one exchange at a time, never longer than ~3 s

const hhmm = (m) => { m = ((Math.round(m) % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

// what a café hands over: [short name used in the player's line, journal label, ja, price, emoji]
const DRINKS = {
  coffee_great: { say: 'pour-over', label: 'pour-over', ja: 'ハンドドリップ', price: 650, icon: '☕', who: 'Barista' },
  coffee_kissa: { say: 'siphon coffee', label: 'siphon coffee', ja: 'サイフォンコーヒー', price: 550, icon: '☕', who: 'Mama-san' },
  coffee_chain: { say: 'latte', label: 'latte', ja: 'カフェラテ', price: 450, icon: '☕', who: 'Barista' },
  cafe: { say: 'latte', label: 'latte', ja: 'カフェラテ', price: 580, icon: '☕', who: 'Barista' },
  coffeestand: { say: 'iced coffee', label: 'iced coffee', ja: 'アイスコーヒー', price: 420, icon: '☕', who: 'Barista' },
  bakery: { say: 'melon pan', label: 'melon pan', ja: 'メロンパン', price: 260, icon: '🥐', who: 'Baker' },
  sweets: { say: 'something sweet', label: 'a sweet treat', ja: 'スイーツ', price: 480, icon: '🍰', who: 'Staff' },
};
const drinkFor = (b) => {
  if (!b) return DRINKS.cafe;
  if (b.key && DRINKS[b.key]) return DRINKS[b.key];
  return DRINKS[b.cat] || DRINKS.cafe;
};

const WELCOME = { ja: 'いらっしゃいませ！', en: 'Welcome!' };

// ---------------------------------------------------------------------------------------------
// Build (and cache) the interactable for one ctx.counters entry.
export function orderItem(game, c) {
  const cache = game._orderItems || (game._orderItems = new Map());
  let it = cache.get(c.slotId);
  if (it && it.counter === c) return it;
  const b = businessBySlot[c.slotId] || null;
  const isCafe = c.kind === 'cafe' || (b && ['cafe', 'kissaten', 'coffeestand', 'bakery'].includes(b.cat));
  const drink = isCafe ? drinkFor(b) : null;
  const name = c.name || (b && b.en) || 'the counter';
  const o = c.order, s = c.staff || null;
  it = {
    id: 'order:' + c.slotId, counter: c, level: c.level, passive: false,
    test(body, fwd) {
      if (!o || !isFinite(o.x) || !isFinite(o.z)) return null;
      const dx = o.x - body.x, dz = o.z - body.z, d = Math.hypot(dx, dz);
      if (d > REACH) return null;
      let dot = 1;
      if (s && isFinite(s.x) && isFinite(s.z)) {
        const sx = s.x - body.x, sz = s.z - body.z, sl = Math.hypot(sx, sz);
        if (sl > 0.35) dot = (sx * fwd.x + sz * fwd.z) / sl;
      }
      if (dot < FACE_DOT) return null;
      if (game.demo && game.demo.arrived) return null;
      return (1 - dot) * 1.6 + d * 0.15 - 0.4;   // a little bonus: this is the thing you walked up to do
    },
    canUse() {
      if (b && !isOpen(b, game.ctx.clock.minutes)) return `Closed right now · opens ${hhmm(b.hours[0])}`;
      return true;
    },
    view() {
      const n = (game.orders || []).filter(x => x.slotId === c.slotId).length;
      // v4: Aya's coffee errand (story.js) — this café is where her iced latte comes from
      const er = isCafe && errandDrink(game, c.slotId);
      if (er) return { prompt: `Order Aya's ${er.label} ${er.icon}`, promptJa: '注文する', sub: b ? `${b.en} · ${b.ja}` : name };
      if (isCafe) return { prompt: n ? 'Order another ☕' : (drink.icon === '☕' ? 'Order a coffee ☕' : `Order ${drink.icon}`), promptJa: '注文する', sub: b ? `${b.en} · ${b.ja}` : name };
      return { prompt: 'Say hi', promptJa: 'こんにちは', sub: b ? `${b.en} · ${b.ja}` : name };
    },
    onUse() { exchange(game, c, b, isCafe, (isCafe && errandDrink(game, c.slotId)) || drink, name); },
  };
  cache.set(c.slotId, it);
  return it;
}

// ---------------------------------------------------------------------------------------------
// The exchange itself: timers on game.after (pause-aware), no panel, no freeze.
function exchange(game, c, b, isCafe, drink, name) {
  const now = performance.now();
  if (game._orderT && now - game._orderT < COOLDOWN_MS) return;
  game._orderT = now;
  const { ctx, hud } = game;
  const orders = game.orders || (game.orders = []);
  const again = orders.filter(x => x.slotId === c.slotId).length > 0;
  const who = isCafe ? drink.who : (c.role === 'chef' ? 'Chef' : c.role === 'barista' ? 'Barista' : 'Staff');
  try { ctx.crowd && ctx.crowd.wave && c.staff && ctx.crowd.wave(c.staff.x, c.staff.z); } catch (e) { /* optional */ }
  hud?.prompt(null);

  if (isCafe) {
    const line = drink.line || (again ? `Another ${drink.say}, please.` : `One ${drink.say}, please.`);
    hud?.caption({ ja: WELCOME.ja, en: WELCOME.en, speaker: who, duration: 1.7 });
    game.after(0.9, () => hud?.caption({ en: line, speaker: 'You', duration: 1.6, channel: 'action' }));
    game.after(1.8, () => hud?.caption({ ja: again ? 'ふふ、かしこまりました。' : 'かしこまりました。', en: again ? 'Ha, of course.' : 'Certainly. One moment.', speaker: who, duration: 1.4 }));
    game.after(2.0, () => ctx.audio?.play?.('cup'));
    game.after(2.3, () => {
      const rec = { slotId: c.slotId, name, item: drink.label, icon: drink.icon, at: ctx.clock.hhmm, price: drink.price };
      orders.push(rec);
      if (game.journal) game.journal.coffees = (game.journal.coffees || 0) + (drink.icon === '☕' || drink.errand ? 1 : 0);
      pay(game, drink.price, name);
      hud?.toast({ kind: 'done', title: 'Ordered', en: `${drink.icon} ${drink.label} — ${name}`, ja: drink.ja, duration: 3.4 });
      hud?.cup(true, `${drink.icon} ${drink.label} — ${name}`, orders.length);
      ctx.events.emit('demo:order', { slotId: c.slotId, name, item: drink.label, kind: 'cafe', errand: !!drink.errand, t: ctx.clock.minutes });
    });
    return;
  }
  // "Say hi": a greeting, a reply, a tiny line of the player's own
  const tail = c.kind === 'food' || c.kind === 'tempura'
    ? { en: (b && PEEK[b.cat]) || 'It smells wonderful. Not today, though.', thought: true }
    : { en: 'Just looking, thank you.' };
  hud?.caption({ ja: WELCOME.ja, en: c.kind === 'shop' ? 'Welcome in! Take your time.' : 'Welcome! Table for one?', speaker: who, duration: 1.8 });
  game.after(1.0, () => hud?.caption(tail.thought ? { en: tail.en, kind: 'thought', duration: 2.4 } : { en: tail.en, speaker: 'You', duration: 1.6, channel: 'action' }));
  game.after(2.0, () => ctx.events.emit('demo:order', { slotId: c.slotId, name, item: null, kind: c.kind, hi: true, t: ctx.clock.minutes }));
}

// v4: the drink Aya asked for, while her errand is open at this café (else null)
function errandDrink(game, slotId) {
  try { const st = game.story; return st && st.errandDrink ? st.errandDrink(slotId) : null; } catch (e) { return null; }
}

// pay with the ICOCA card if there is enough on it, else coins (v6: through the one IC mechanism, game.icCharge)
function pay(game, price, name, ja) {
  if (typeof game.icCharge === 'function') { game.icCharge({ amount: price, kind: 'purchase', label: 'お支払い Paid', note: name || '', ja: ja || '', orCoins: true }); return; }
  const ic = game.ic;
  if (ic && ic.balance >= price) {
    ic.balance -= price;
    game.ctx.audio?.play?.('pay');
    game.hud?.ic({ balance: ic.balance, fare: price, ok: true, label: 'お支払い Paid' });
  }
}

// Is there something to order for this slot? (used by game.js to retire the old modal coffee vignette)
export function hasCounter(game, slotId) {
  const cs = game.ctx.counters;
  if (!Array.isArray(cs)) return false;
  for (const c of cs) if (c && c.slotId === slotId && c.order && c.slotId !== DEMO.slot) return true;
  return false;
}
export { REACH };
