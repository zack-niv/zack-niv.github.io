// =============================================================================
// All the words. Tone: warm, curious, a little funny, never stressful.
// Kept in one place so the voice stays consistent and is easy to edit.
// (Demo build: ONE quest — lunch at Tempura Daikichi, Namba Parks 6F.)
// =============================================================================

export const QUESTS = {
  tempura: { text: 'Meet Aya at Tempura Daikichi', textJa: '天ぷら大吉でアヤと合流', detail: 'Namba Parks, 6F. She\'s already in the queue.' },
  coffee: { text: 'An iced latte for Aya', textJa: 'アヤにアイスラテ', detail: 'On the way. She can\'t leave the queue.' },
};

// The demo's destination and pacing knobs.
export const DEMO = {
  slot: 'parks_6Fdw03',
  coffeeSlot: 'city_1e12',          // v4: Aya's coffee errand (Namba CITY 1F, at the foot of the esc_city_b escalators)
  // v6 pacing (item 9): the ordinary map has to be FELT for ~2-3 min before Lodestone (real statistics need a real
  // "before"), and Aya's "Where are you??" must not arrive while the player is still taking in the station (item 1)
  offerAt: 195,                     // real seconds of play: Aya sends Lodestone anyway (nobody stays stuck forever) — 3:15
  offerMin: 100,                    // ...and never before this (asking for help / answering her check-in while lost)
  whereMin: 95,                     // "Where are you??" never before this, and only when clearly stalled or wandering...
  whereAt: 150,                     // ...or as a fallback from here (unless the player is making clear progress)...
  whereLatest: 175,                 // ...and by here at the latest
  introYaw: -1.35,                  // the opening glance (radians): across the platform at the rapi:t
  introHold: 4.6,                   // seconds the player is held for the opening look
  arriveRadius: 7.5,                // metres from the door point: the arrival moment begins
  // v9 (notes/v9-progression.md): patience — Aya waits for answers, nudges, then follows up naturally
  helloNudge: 20, helloNudgeM: 30,  // "hello?? 👀" after 20 s or 30 m walked without an answer...
  helloGiveUp: 12, helloGiveUpM: 25, // ...then she sends the plan anyway 12 s (or 25 m) after the nudge
  meetGiveUp: 18, meetGiveUpM: 25,  // Meet's chips: silence for 18 s or 25 m walked → the latte ask
  latteGiveUp: 25,                  // the latte question: silence = yes (chips withdrawn)
  whereNudge: 25, whereGiveUp: 45,  // "Where are you??": nudge, then she sends Lodestone anyway
  offerGrace: 15,                   // the 195 s fallback waits up to this long for a fresh question / the café counter
  aheadFrac: 0.45,                  // reaching Parks (or < 45% of the start distance left) before any offer → 'ahead'
  orderCool: 20,                    // no "Where are you??" within this long of buying her latte
};
// v9: Zack's call pending — can the player refuse the latte? (false = two yes-flavoured chips)
export const LATTE_REFUSABLE = true;

// Aya's texts (v2 words, unchanged). v3: they are gated on the player — a question carries reply chips and the
// next beat waits for the answer (or for a location / state), see story.js. `lost: true` on a reply = the player
// asked for help, which is what earns the Lodestone offer.
export const AYA = {
  hello: { id: 'hello', text: 'Landed?? Welcome to Osaka! 🛬',
    replies: [{ id: 'yes', text: 'Just landed! 🙌' }, { id: 'huge', text: 'Yes! This station is HUGE 😵' }] },
  meet: { id: 'meet', text: 'Meet me at Tempura Daikichi. Namba Parks, 6F! I\'m already in the queue 🍤', place: 'parks_6Fdw03',   // v5: + a place link card
    replies: [{ id: 'omw', text: 'On my way! 🏃' }, { id: 'lost', text: 'Which way?? 😵', lost: true }] },        // v9: she waits for an answer
  // v9: patience and answers
  helloNudge: 'hello?? 👀 did you land?',
  helloAck: { yes: 'yay!! 🎉', huge: 'it\'s a whole city down there 😂' },
  meetAnyway: 'ok I\'ll assume you landed 😂 ',
  meetLost: 'lol it\'s Namba, everyone\'s lost 😂 tap my link, Maps will get you close',
  coffeeReplies: [{ id: 'yes', text: 'Sure! ☕' }, { id: 'no', text: 'Not today 🙈' }],
  coffeeRepliesYes: [{ id: 'yes', text: 'Sure! ☕' }, { id: 'yes2', text: 'Only for you 😂' }],
  coffeeYes: '🥹🙏',
  coffeeNo: '🥲 ok ok. just come then',
  whereCoffee: { id: 'where', text: 'how\'s my latte coming? 👀 the line is moving',
    replies: [{ id: 'lost', text: 'I\'m lost 😭', lost: true }, { id: 'almost', text: 'Almost there!' }] },
  whereNudge: 'hello?? 👀',
  // v2's nudges: the first now asks (sent when the player stalls, is on a wrong floor or wanders, not on a timer);
  // the second is her answer to "On my way!"
  where: { id: 'where', text: 'Where are you?? The line is moving. It\'s 6F, Parks, the one with the big green terraces',
    replies: [{ id: 'lost', text: 'I\'m lost 😭', lost: true }, { id: 'omw', text: 'On my way!' }] },
  whereAck: { omw: 'Ask your phone! That\'s what it\'s for 😅', almost: 'yesss 🙏 ask your phone if it gets confusing' },
  // v4: the coffee errand ({cafe} = the café's name, read at runtime). Sent right after "meet"; the café is
  // suggested ("Aya's pick") in both apps' destination lists.
  coffee: { id: 'coffee', text: 'oh!! can you bring me an iced latte from {cafe}? Namba CITY 1F, it\'s on your way 🙏 the queue here is forever' },
  otherPick: 'ooh, {name} first? 😂 I\'ll wait…',
  skipCoffeePick: 'straight to the tempura? respect 😂 …my latte though 🥲',
  gotCoffee: 'omg you\'re an angel 😭☕ ok NOW come: Daikichi, Parks 6F',
  gotOtherCoffee: 'that\'s not {cafe}… but I\'ll allow it 😌 now come: Parks 6F',
  noCoffee: 'no latte? 🥲 fine. FINE. the tempura is worth it',
};
// v4: what the player asks for at the errand café (overrides the café's own drink)
export const ERRAND_DRINK = { say: 'iced latte', label: 'iced latte', ja: 'アイスラテ', price: 520, icon: '🥤', who: 'Barista', line: 'One iced latte, please. To go!' };

export const UPGRADE = {
  offer: 'you\'re lost aren\'t you 😂 install Lodestone, it actually works indoors',
  offerSilent: 'hellooo?? 👀 ok just install this, it actually works indoors',          // v9: Where went unanswered
  offerSilentShort: 'ok just install this 😅 it actually works indoors',                  // ...right after her nudge
  offerAhead: 'ok Parks is a maze from here 😅 get Lodestone, it actually works indoors', // v9: doing fine, not lost
  ready: 'see? 😌 6F, I\'m 3rd in line',
  readyCoffee: 'see? 😌 it even knows which floor my latte is on',
};

// v3: the in-game tutorial hints (one small line at a time, never a modal). {k:X} renders a key cap.
export const TUTORIAL = {
  look: 'Move the mouse to look around · {k:Esc} frees it',
  move: '{k:W}{k:A}{k:S}{k:D} to walk · hold {k:Shift} to hurry',
  raise: 'Your phone buzzed — {k:Q} to raise it',
  raiseHold: 'Your phone buzzed — {k:Q} or hold right-click',
  reply: 'Answer Aya — press {k:1} {k:2} or click a reply',
  replyDown: 'Aya asked you something — {k:Q} to answer',
  maps: 'Open <b>Maps</b> — {k:Tab} switches apps (or click the dock)',
  mapsDown: '{k:Q} then open <b>Maps</b>',
  // v4: choose where to go (validated by 'nav:destination'; any pick counts)
  pick: 'Pick where to go — {k:1} for <b>Aya\'s pick</b>, or click any place',
  pickDown: '{k:Q}, open <b>Maps</b> and pick where to go',
  pick2: 'Next stop: pick <b>Tempura Daikichi</b> — Aya\'s pick, top of the list',
  pick2Down: '{k:Q} — pick your next stop',
  pick2Route: 'Next stop: <b>Tempura Daikichi</b> — {k:1} takes Aya\'s pick (or {k:X} ends this route)',
  pick2RouteLs: 'Next stop: <b>Tempura Daikichi</b> — {k:1} takes Aya\'s pick (or {k:X} ends this route)',
  // v5: on Messages, Aya's place link opens the map on that place
  pickMsg: 'Open Aya\'s link — {k:Enter} or click the card (or {k:Tab} to Maps)',
  order: 'Walk up to the counter — {k:E} to order',
  interact: '{k:E} interacts — machines, doors, café counters',
  interactHere: '{k:E} — try it',
  // v6 (item 2): the Nankai gate teaches E — tap your IC card; walk in without tapping and the flaps stop you
  gate: 'Tap your IC card at the gate — walk up to a lane, then {k:E}',
  gateHere: '{k:E} interacts — here, it taps your IC card',
  gateBlocked: 'Tap your IC card first — {k:E}',
  install: 'Aya sent a link — {k:Q}, then {k:Enter} or click <b>Lodestone</b>',
  installUp: '{k:Enter} or click <b>Lodestone</b> in Aya\'s message',
};

// Queue banter as the route shortens (remaining metres → text), once each.
export const QUEUE_LINES = [
  [170, 'I\'m 2nd in line!! 🍤'],
  [45, 'You can see the noren from there, right?? 👋'],
];
// Lodestone routes up through the Namba Parks canyon; Aya texts once, as you reach the bridge.
// v5: the canyon is the natural way UP now (canyon floor → garden stairs → the glass bridge into Parks 3F), not a detour
export const CANYON_TEXT = 'take the canyon way up 🌿 out into the garden, up the stairs, then across the glass bridge. trust me';

export const ARRIVAL = {
  aya: { ja: 'こっちこっち！', en: 'Over here! You made it 😆' },
  text: 'THERE you are 🥹 I saved us the two seats at the counter',
  // v4: with / without her iced latte
  textCoffee: 'THERE you are 🥹 and you brought my latte?? best friend ever. I saved us the two seats at the counter',
  thanks: { ja: 'ありがとう〜！', en: 'Thank youuu! 🥤' },
  tease: '…wait. where\'s my latte 😑 kidding. (not kidding)',
  sub: { en: 'Tempura Daikichi · 天ぷら 大吉', ja: 'なんばパークス 6F' },
};

export const ENDCARD = {
  kicker: 'Tempura Daikichi · Namba Parks 6F · 天ぷら 大吉',
  line: 'Indoor spaces shouldn\'t run on guesswork.',
  note: 'Built for the Oriient team by Zack Niv — a love letter to Namba and to indoor positioning.',
  contact: '',                       // none yet: the end card hides the line when this is empty
  // v6 (item 8): ways to reach Zack — open in a new tab (rel=noopener noreferrer)
  invite: 'I\'d love to hear what you think.',
  agent: { label: 'Chat with my AI career agent', url: 'https://careermate-dusky.vercel.app/r/c-3VWYnNHXQ27jj-0Z61EqhOxM7QRDf9ennPGBVKcbk' },
  call: { label: 'Book a call', url: 'https://calendar.google.com/calendar/u/0/appointments/schedules/AcZssZ0OHvcPKOXnoNh3PO76_L9qeSE-EIXOOruEnD2lv_mdY6IUHan5zVE0-S-xWd4QvuzNs6Vy1Kv0' },
};

// Shop lines ---------------------------------------------------------------
export const BARISTA = {
  coffee_great: [
    { ja: 'いらっしゃいませ。今日はエチオピアがおすすめです。', en: 'Welcome. The Ethiopian is lovely today.' },
    { ja: 'お待たせしました。熱いので気をつけて。', en: 'Here you go. Careful, it\'s hot.' },
  ],
  coffee_kissa: [
    { ja: 'いらっしゃい。お好きな席どうぞ。', en: 'Come in. Sit anywhere you like.' },
    { ja: 'サイフォンなんで、ちょっと待っててね。', en: 'It\'s siphon, so give it a minute, dear.' },
  ],
  coffee_chain: [
    { ja: 'いらっしゃいませー！店内でお召し上がりですか？', en: 'Welcome! For here today?' },
    { ja: '番号でお呼びしまーす！', en: 'We\'ll call your number!' },
  ],
  cafe: [
    { ja: 'いらっしゃいませ。', en: 'Welcome.' },
    { ja: 'ごゆっくりどうぞ。', en: 'Take your time.' },
  ],
};

export const AFTERTASTE = {
  coffee_great: 'Bright, floral, a little like blueberries. Oh. Oh, that\'s the one.',
  coffee_kissa: 'Dark, round, served in a cup with a gold rim. Time has stopped in here. Perfect.',
  coffee_chain: 'It\'s… fine. You could do better.',
  cafe: 'Pretty decent. But you didn\'t fly all this way for decent.',
  again: 'Another one. Your hands are starting to vibrate slightly.',
};

export const MENUS = {
  coffee_great: [
    ['本日のハンドドリップ', 'Pour-over of the day · Ethiopia Guji', 650],
    ['ケニア ニエリ', 'Kenya Nyeri, washed', 700],
    ['エスプレッソトニック', 'Espresso tonic', 680],
    ['カフェオレ', 'Café au lait', 600],
  ],
  coffee_kissa: [
    ['サイフォンブレンド', 'Siphon blend', 550],
    ['ウインナーコーヒー', 'Vienna coffee (whipped cream)', 650],
    ['クリームソーダ', 'Melon cream soda', 700],
    ['厚切りトーストセット', 'Thick toast set, with coffee', 850],
  ],
  coffee_chain: [
    ['ブレンドコーヒー S', 'Blend coffee, small', 380],
    ['カフェラテ', 'Caffè latte', 450],
    ['抹茶ラテ', 'Matcha latte', 480],
  ],
  cafe: [
    ['ドリップコーヒー', 'Drip coffee', 500],
    ['カフェラテ', 'Café latte', 580],
    ['アイスコーヒー', 'Iced coffee', 520],
  ],
  tendon: [
    ['天丼 並', 'Tendon, regular', 780],
    ['海老天丼', 'Prawn tendon', 980],
    ['上天丼 味噌汁付', 'Deluxe tendon with miso soup', 1180],
  ],
};

export const COURSE = [
  { ja: '海老', ro: 'Ebi', en: 'Tiger prawn, two of them. The batter shatters like thin glass.' },
  { ja: '鱚', ro: 'Kisu', en: 'Japanese whiting. Light as a sigh. A pinch of salt, nothing else.' },
  { ja: '南瓜', ro: 'Kabocha', en: 'Pumpkin, sweet and dense.' },
  { ja: '椎茸', ro: 'Shiitake', en: 'Stuffed with minced shrimp. The chef nods at you. You nod back.' },
  { ja: '穴子', ro: 'Anago', en: 'A whole sea eel, curling off the plate. Crisp outside, cloud inside.' },
  { ja: 'かき揚げ', ro: 'Kakiage', en: 'A nest of shrimp and onion, with rice, red miso soup and pickles.' },
];

// One-liners when peeking at other restaurants (by category)
export const PEEK = {
  ramen: 'Rich pork-bone smell. A wall of ticket buttons. Tempting… but you promised yourself tempura.',
  udon: 'Fat, glossy noodles in golden dashi. Maybe tomorrow.',
  okonomiyaki: 'The griddle hisses. Very Osaka. Not tempura, though.',
  kushikatsu: '"No double dipping" says the sign, sternly. Noted. Not today.',
  sushi: 'The chef looks up, then back at his knife. Beautiful. Expensive. Not tempura.',
  tonkatsu: 'Deep-fried, yes. Tempura, no. Close, but no.',
  curry: 'Osaka curry: sweet, dark, smells like childhood. Somebody\'s childhood.',
  izakaya: 'Lanterns, beer, a lot of loud laughing. Opens properly tonight.',
  yakiniku: 'Smoke, sizzle, a table of salarymen in paper bibs. Not lunch material for one.',
  omurice: 'Plastic food samples of perfect omelettes. They\'re hypnotic.',
  takoyaki: 'Octopus balls flipped with a pick in one flick. You watch for a while.',
  bakery: 'Melon pan, curry pan, a pastry shaped like a bear. Strong temptation.',
  sweets: 'A line of teenagers photographing a parfait. You understand.',
  conbini: 'Bright, cold, infinite onigiri. The comforting hum of a konbini.',
  closed: 'Papered windows. 改装中 — closed for renovation.',
};

export const SHOP_CLOSED = (b, opens) => `${b.ja} — 準備中. Opens at ${opens}.`;

export const ENDING = {
  title: 'You found it.',
  titleJa: '見つけた。',
  stayLine: 'Namba will still be here. It always is.',
};
