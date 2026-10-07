// =============================================================================
// All the words. Tone: warm, curious, a little funny, never stressful.
// Kept in one place so the voice stays consistent and is easy to edit.
// (Demo build: ONE quest — lunch at Tempura Daikichi, Namba Parks 6F.)
// =============================================================================

export const QUESTS = {
  tempura: { text: 'Meet Aya at Tempura Daikichi', textJa: '天ぷら大吉でアヤと合流', detail: 'Namba Parks, 6F. She\'s already in the queue.' },
};

// The demo's destination and pacing knobs.
export const DEMO = {
  slot: 'parks_6Fdw03',
  offerAt: 165,                     // real seconds of play: Aya sends Lodestone anyway (nobody stays stuck forever)
  offerMin: 45,                     // ...and never before this (the generic map has to be felt)
  introYaw: -1.35,                  // the opening glance (radians): across the platform at the rapi:t
  introHold: 4.6,                   // seconds the player is held for the opening look
  arriveRadius: 7.5,                // metres from the door point: the arrival moment begins
};

// =============================================================================
// v3: Aya's side of the conversation. She texts like a real friend: short,
// warm, a bit funny, emoji. Messages with `replies` are questions: the phone
// shows reply chips and emits 'phone:reply' {msgId, replyId}. `lost: true`
// on a reply means "the player asked for help" (that is what earns the
// Lodestone offer). Ids are strings and unique in the thread.
// =============================================================================
export const AYA = {
  hello: { id: 'hello', text: 'Landed?? Welcome to Osaka!! 🛬',
    replies: [{ id: 'yes', text: 'Just landed! 🙌' }, { id: 'huge', text: 'Yes!! This station is HUGE 😵' }] },
  helloAck: { yes: 'yayyy 🎉🎉', huge: 'hahaha wait till you see the rest of it 😂' },
  helloNudge: 'hellooo? 👀',
  meet: { id: 'meet', text: 'Meet me at Tempura Daikichi — Namba Parks, 6F! I\'m already in the queue 🍤',
    replies: [{ id: 'omw', text: 'On my way! 🏃' }, { id: 'how', text: 'How do I get there? 🤔' }] },
  meetAck: { omw: 'yesss 🙌 your Maps app will get you there… probably 😅', how: 'it\'s all connected inside! check Maps, it\'s like 10 min 📍' },
  meetLate: 'ok I see you walking 😂',                    // she sends `meet` anyway if `hello` is ignored

  // where you are (before Lodestone)
  gates: { id: 'gates', text: 'out of the gates? 🙌 Parks is south, through Namba CITY. easy 😌',
    replies: [{ id: 'ok', text: '👍' }, { id: 'south', text: 'Which way is south?? 😅', lost: true }] },
  gatesAck: { ok: '😌' },
  under: { id: 'under', text: 'wait are you underground?? 😅 Parks is UP. like, up up',
    replies: [{ id: 'lost', text: 'I\'m lost 😭', lost: true }, { id: 'explore', text: 'Just exploring 😎' }] },
  underAck: { explore: 'lol ok tourist 😎 the tempura won\'t wait forever tho' },
  city: { id: 'city', text: 'Namba CITY!! ok you\'re close-ish. Parks is at the very end 🌿',
    replies: [{ id: 'ok', text: 'On it 🫡' }, { id: 'lost', text: 'Close-ish?? I\'m lost 😵‍💫', lost: true }] },
  cityAck: { ok: '🫡🍤' },
  checkin: { id: 'checkin', text: 'how\'s it going? 👀',
    replies: [{ id: 'lost', text: 'Honestly? Lost 😵‍💫', lost: true }, { id: 'ok', text: 'Getting there!' }] },
  checkinAck: { ok: 'ok ok 😌 shout if you need me' },
  checkin2: { id: 'checkin2', text: 'still "getting there"? 😏',
    replies: [{ id: 'lost', text: 'Ok fine, I\'m lost 😭', lost: true }, { id: 'ok', text: 'Yes!! Almost!' }] },
  checkin2Ack: { ok: 'mhm 😏' },
  coffee: 'wait did you just stop for COFFEE 😂 I\'m starving',
  early: 'already?? 😂 give Maps a chance first, I\'ll rescue you if it\'s hopeless',

  // the upgrade: a short preface, then the phone's own link card (offerLodestone)
  offerPre: { lost: 'lol I KNEW it 😂 hang on', checkin: 'mhm. "getting there" 😏', time: 'ok I\'m just sending you this. no arguments 😤' },
  offerText: 'install Lodestone — it actually works indoors 🧲',
  offerNudge: 'tap the link!! 👆',
  installing: 'it learns the building\'s magnetic thing, it\'s so cool 🧲',

  // after Lodestone
  ready: { id: 'ready', text: 'see? 😌 6F, I\'m 3rd in line',
    replies: [{ id: 'magic', text: 'Ok this is magic ✨' }, { id: 'genius', text: 'You\'re a genius 🙏' }] },
  readyAck: { magic: 'right?? it even knows which floor you\'re on', genius: 'I know 😌' },
  wrongWay: 'wrong way? 😅 follow the arrow',
  stall: { id: 'stall', text: 'everything ok? 🙂',
    replies: [{ id: 'ok', text: 'On my way!' }, { id: 'distracted', text: 'Got distracted, sorry 🙈' }] },
  stallAck: { ok: '🏃🏃🏃', distracted: 'NAMBA DOES THAT 😂 the arrow knows the way' },
};

// v3: the tutorial hints (one small line at a time, in-world, never a modal). {k:X} renders a key cap.
export const TUTORIAL = {
  raise: 'Your phone buzzed — {k:Q} to raise it',
  raiseHold: 'Your phone buzzed — {k:Q} or hold right-click',
  reply: 'Answer Aya — tap a reply or press {k:1} {k:2}',
  replyDown: 'Aya asked you something — {k:Q} to answer',
  maps: 'Open <b>Maps</b> — {k:Tab} or tap it in the dock',
  mapsDown: '{k:Q} then open <b>Maps</b>',
  walk: '{k:W}{k:A}{k:S}{k:D} to walk · mouse to look',
  walkPhone: '{k:Q} lowers the phone · {k:W}{k:A}{k:S}{k:D} to walk',
  hurry: 'Hold {k:Shift} to hurry',
  gate: 'Follow the signs to the <b>中央改札</b> Central Gate',
  gateNudge: 'Look up — the overhead signs point the way',
  interact: '{k:E} to interact',
  install: 'Aya sent a link — {k:Q} and tap <b>Lodestone</b>',
  installUp: 'Tap <b>Lodestone</b> in Aya\'s message',
};

// Queue banter as the route shortens (remaining metres → text), once each.
export const QUEUE_LINES = [
  [170, 'I\'m 2nd in line!! 🍤'],
  [45, 'You can see the noren from there, right?? 👋'],
];
// Lodestone routes through the Namba Parks canyon; Aya texts once, as you reach the bridge.
export const CANYON_TEXT = 'take the canyon side — trust me 🌿';

export const ARRIVAL = {
  aya: { ja: 'こっちこっち！', en: 'Over here! You made it 😆' },
  text: 'THERE you are 🥹 I saved us the two seats at the counter',
  sub: { en: 'Tempura Daikichi · 天ぷら 大吉', ja: 'なんばパークス 6F' },
};

export const ENDCARD = {
  kicker: 'Tempura Daikichi · Namba Parks 6F · 天ぷら 大吉',
  line: 'Indoor spaces shouldn\'t run on guesswork.',
  note: 'Built for the Oriient team by Zack Niv — a love letter to Namba and to indoor positioning.',
  contact: '',                       // none yet: the end card hides the line when this is empty
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
