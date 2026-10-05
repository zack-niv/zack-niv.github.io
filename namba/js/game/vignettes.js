// =============================================================================
// Vignettes: small, elegant moments. Each is an async function (game, ...)
// that opens panels, plays lines, passes time and updates quests.
// The game marks itself busy (player frozen) while one runs.
// =============================================================================
import { isOpen } from '../world/directory.js';
import { MENUS, BARISTA, AFTERTASTE, COURSE, PEEK, REACTIONS } from './script.js';
import { yen, esc } from './panel.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const hhmm = (m) => { m = Math.round(m) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

// Pay with the ICOCA card. Returns true if paid by card (else coins).
function payIC(game, price) {
  const ic = game.ic;
  if (ic.balance >= price) {
    ic.balance -= price;
    game.ctx.audio?.play?.('gate_ok');
    game.hud?.ic({ balance: ic.balance, fare: price, ok: true });
    return true;
  }
  game.ctx.audio?.play?.('gate_ng');
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
export async function passTime(game, minutes, html, holdMs = 1600) {
  const hud = game.hud;
  await hud.fade(1, 900);
  if (html) hud.fadeText(`${html}<div class="h-fade-clock">${hhmm(game.ctx.clock.minutes)} → ${hhmm(game.ctx.clock.minutes + minutes)}</div>`);
  game.ctx.clock.minutes += minutes;
  game.ctx.clock.update(0);
  await sleep(holdMs);
  hud.fadeText('');
  await hud.fade(0, 1100);
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
  payIC(game, price);
  await sleep(700);
  await say(game, lines[1] || lines[0], key === 'coffee_kissa' ? 'Mama-san' : 'Barista');
  ctx.audio?.play?.('coffee');
  const mins = key === 'coffee_great' ? 8 : key === 'coffee_kissa' ? 12 : 6;
  const scene = key === 'coffee_great'
    ? `<div class="h-fade-big">${esc(ja)}</div><div class="h-fade-small">You stand at the narrow counter and watch the kettle pour in slow circles.</div>`
    : key === 'coffee_kissa'
      ? `<div class="h-fade-big">${esc(ja)}</div><div class="h-fade-small">The siphon gurgles. A man in the corner reads a newspaper from another decade.</div>`
      : `<div class="h-fade-big">${esc(ja)}</div><div class="h-fade-small">${esc(en)}.</div>`;
  await passTime(game, mins, scene, 1900);
  game.journal.coffees++;
  game.hud.cup(true);
  clearTimeout(game._cupT);
  game._cupT = setTimeout(() => game.hud.cup(false), 150000);
  const q = game.quests.coffee;
  if (q.state === 'done') { await think(game, AFTERTASTE.again); return; }
  if (key === 'coffee_great' || key === 'coffee_kissa') {
    await think(game, AFTERTASTE[key], 4.6);
    game.setQuest('coffee', 'done', key === 'coffee_great' ? `Wakakusa Coffee Stand — ${en}.` : `Kissa Rondo — ${en}. A different kind of great.`);
    game.meals.push(b.en);
    game.message(key === 'coffee_great' ? REACTIONS.coffeeGreat : REACTIONS.coffeeKissa);
  } else if (key === 'coffee_chain') {
    await think(game, AFTERTASTE.coffee_chain, 3.6);
    game.noteQuest('coffee', 'Café Mocca Rest: it was… fine. You could do better.');
    game.message(REACTIONS.coffeeChain, 'Aya', 9);
  } else {
    await think(game, AFTERTASTE.cafe, 3.6);
    game.noteQuest('coffee', `${b.en}: decent. Not the one.`);
  }
}

// ---------------------------------------------------------------------------
// Tempura Daikichi (the dream)
// ---------------------------------------------------------------------------
function queueLength(game, b) {
  const q = game.ctx.crowd?.queueLength?.(b.slot);
  if (typeof q === 'number' && q >= 0) return q;
  const m = game.ctx.clock.minutes;
  // a believable lunch line if crowds can't tell us
  const g = Math.exp(-Math.pow((m - 12.4 * 60) / 70, 2));
  return Math.round(2 + 9 * g);
}

export async function daikichi(game, b) {
  const { ctx } = game;
  const m = ctx.clock.minutes;
  if (game.quests.tempura.state === 'done' && game._ateGreat) {
    await think(game, 'You couldn\'t. You physically could not eat another prawn.');
    return;
  }
  if (m >= b.hours[1] || m < b.hours[0] - 60) { await closedCard(game, b); return; }
  let wait;
  if (m < b.hours[0]) {
    const pick = await game.panels.card({
      style: 'noren', side: 'right',
      html: `<div class="g-noren"><span>天</span><span>ぷ</span><span>ら</span></div>
        <div class="g-kicker">天ぷら · Tempura counter</div><div class="g-title-ja">${esc(b.ja)}</div><div class="g-title">${esc(b.en)}</div>
        <p class="g-p">The noren isn't up yet — opens at ${hhmm(b.hours[0])}. A few people are already lined up along the wall, very patiently.</p>`,
      buttons: [{ label: 'Join the line and wait', value: true }, { label: 'Come back later', value: false }],
    });
    if (!pick) return;
    wait = Math.ceil(b.hours[0] - m) + 2;
  } else {
    const n = queueLength(game, b);
    const est = Math.max(0, Math.round(n * 3.5));
    if (n > 0) {
      const pick = await game.panels.card({
        style: 'noren', side: 'right',
        html: `<div class="g-noren"><span>天</span><span>ぷ</span><span>ら</span></div>
          <div class="g-kicker">天ぷら · Tempura counter</div><div class="g-title-ja">${esc(b.ja)}</div><div class="g-title">${esc(b.en)}</div>
          <p class="g-p">${n} people are waiting on the little stools outside. You can smell sesame oil from here.</p>
          <div class="g-meta"><span>待ち時間 · Wait</span><b>about ${est} min</b></div>`,
        buttons: [{ label: 'Join the line', value: true }, { label: 'Not now', value: false }],
      });
      if (!pick) return;
      wait = est;
    } else wait = 0;
  }
  if (wait > 0) {
    ctx.events.emit('player:queue', { slot: b.slot, minutes: wait });
    await passTime(game, wait,
      `<div class="h-fade-big">並ぶ</div><div class="h-fade-small">You wait on a tiny stool. The couple ahead are from Nagoya and very proud of it. Someone comes out and says "maji de umai" to nobody in particular.</div>`, 3200);
  }
  // seated at the counter
  ctx.audio?.play?.('tempura');
  game.hud.caption({ ja: 'いらっしゃいませ！カウンターへどうぞ。', en: 'Welcome! Please, at the counter.', speaker: 'Chef', duration: 3.6 });
  const html = `<div class="g-kicker">昼のおまかせ · Lunch omakase</div><div class="g-title-ja">${esc(b.ja)}</div>
    <div class="g-course-head"><span>天ぷら定食 · ごま油</span><b>${yen(2800)}</b></div>
    <ol class="g-course">${COURSE.map((c, i) => `<li data-i="${i}"><span class="g-course-ja">${esc(c.ja)}</span><span class="g-course-ro">${esc(c.ro)}</span><span class="g-course-en">${esc(c.en)}</span></li>`).join('')}</ol>
    <div class="g-hint g-course-hint">The chef places each piece on your paper as it comes out of the oil.</div>`;
  const cardP = game.panels.card({ style: 'paper', side: 'right', html, buttons: [] });
  const el = game.panels.current && game.panels.current.el;
  await sleep(1400);
  if (el) {
    const lis = [...el.querySelectorAll('.g-course li')];
    for (let i = 0; i < lis.length; i++) {
      ctx.audio?.play?.('tempura');
      lis[i].classList.add('served');
      if (i > 0) lis[i - 1].classList.add('eaten');
      ctx.clock.minutes += 5;
      await sleep(2300);
    }
    lis[lis.length - 1].classList.add('eaten');
  }
  await sleep(900);
  game.panels.close(true);
  await cardP;
  game.hud.caption({ ja: 'ありがとうございました！', en: 'Thank you so much!', speaker: 'Chef', duration: 2.6 });
  game.hud.caption({ en: 'Cash only. Of course it was cash only. Luckily you had a ¥5,000 note folded in your passport.', kind: 'thought', duration: 4.6 });
  await sleep(2600);
  await passTime(game, 6, `<div class="h-fade-big">ごちそうさまでした</div><div class="h-fade-small">Thank you for the meal.</div>`, 2200);
  game._ateGreat = true;
  game.journal.meals.push(b.en);
  await think(game, 'That. Was. It. You will think about that kisu for years.', 4);
  game.setQuest('tempura', 'done', `${b.en} — counter tempura, fried in sesame oil in front of you.`);
  game.message(REACTIONS.tempuraGreat);
}

// Tendon Tenmaru — fast, fine, not the dream
export async function tendon(game, b) {
  const { ctx } = game;
  if (!isOpen(b, ctx.clock.minutes)) { await closedCard(game, b); return; }
  const items = MENUS.tendon.map(([ja, en, price]) => ({ ja, en, price }));
  items.push({ ja: 'やめる', en: 'Step away from the machine', quiet: true, value: -1 });
  const c = await game.panels.menu({
    style: 'machine', kicker: '食券機 · Meal ticket machine', titleJa: b.ja, title: b.en,
    sub: 'Buy a ticket, hand it over, eat. ICOCA accepted.', items, cancelValue: -1,
    foot: `<span class="g-foot-ic">ICOCA</span> ${yen(game.ic.balance)}`,
  });
  if (c == null || c < 0) return;
  const [ja, en, price] = MENUS.tendon[c];
  payIC(game, price);
  ctx.audio?.play?.('ticket');
  await sleep(500);
  game.hud.caption({ ja: 'はい、天丼お待ち！', en: 'One tendon, here you go!', speaker: 'Staff', duration: 2.6 });
  await sleep(1400);
  await passTime(game, 14, `<div class="h-fade-big">${esc(ja)}</div><div class="h-fade-small">Sweet sauce, rice, a prawn the size of your hand. Gone in eleven minutes.</div>`, 2200);
  game.journal.meals.push(b.en);
  await think(game, 'Quick, cheap, satisfying-ish. But it\'s not the place you were dreaming of.', 4.4);
  if (game.quests.tempura.state !== 'done') {
    game.noteQuest('tempura', 'Tendon Tenmaru: good bowl. But it\'s not the place you were dreaming of.');
    game.message(REACTIONS.tendon, 'Aya', 10);
  }
}

// Tempura Sakaba Kitsune — closed until 17:00 (open in the evening)
export async function kitsune(game, b) {
  const { ctx } = game;
  if (!isOpen(b, ctx.clock.minutes)) {
    await game.panels.card({
      style: 'sign', side: 'center',
      html: `<div class="g-sign-board">
          <div class="g-sign-ja">本日 17:00 より営業</div>
          <div class="g-sign-en">Open today from 17:00</div>
          <div class="g-sign-name">${esc(b.ja)}<span>${esc(b.en)}</span></div>
          <div class="g-sign-chalk">ハイボール ¥390<br>天ぷら盛り合わせ ¥980<br><small>立ち飲み · standing only</small></div>
        </div>`,
      buttons: [{ label: 'Remember it for later', value: true }],
    });
    game.noteQuest('tempura', 'Tempura Sakaba Kitsune opens at 17:00. Too late for lunch.');
    return;
  }
  ctx.audio?.play?.('tempura');
  game.hud.caption({ ja: 'いらっしゃい！ハイボールでいい？', en: 'Hey, welcome! Highball okay?', speaker: 'Master', duration: 3.4 });
  await sleep(2200);
  payIC(game, 1370);
  await passTime(game, 35, `<div class="h-fade-big">立ち飲み</div><div class="h-fade-small">Elbow to elbow at the counter. A plate of tempura, a highball, an office worker explaining baseball to you with real passion.</div>`, 3000);
  game.journal.meals.push(b.en);
  game.setQuest('tempura', 'done', `${b.en} — standing tempura and a highball. Peak Osaka.`);
  game.message(REACTIONS.tempuraKitsune);
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
        { ja: '運賃表', en: 'Fare to Shin-Osaka?', value: 'fare' },
        { ja: '取消', en: 'Cancel', quiet: true, value: -1 },
      ],
      cancelValue: -1,
    });
    if (c == null || c === -1) return;
    if (c === 'fare') {
      await game.panels.card({
        style: 'machine', side: 'right',
        html: `<div class="g-kicker">運賃表 · Fares from なんば</div>
          <div class="g-fare"><span>新大阪 <small>Shin-Osaka</small></span><b>¥290</b></div>
          <div class="g-fare"><span>梅田 <small>Umeda</small></span><b>¥240</b></div>
          <div class="g-fare"><span>心斎橋 <small>Shinsaibashi</small></span><b>¥190</b></div>
          <p class="g-p">With ICOCA you don't need a ticket — just tap at the gate. 御堂筋線, red line, track 2 for 梅田・新大阪.</p>`,
        buttons: [{ label: 'Back', value: true }],
      });
      continue;
    }
    ctx.audio?.play?.('charge');
    game.hud.caption({ en: 'The machine counts your notes with tremendous seriousness.', kind: 'thought', duration: 3 });
    await sleep(1400);
    game.ic.balance += c;
    ctx.audio?.play?.('gate_ok');
    game.hud.ic({ balance: game.ic.balance, ok: true, reason: `+${yen(c)} チャージ` });
    game.ctx.events.emit('ic:charge', { amount: c, balance: game.ic.balance });
    return;
  }
}
