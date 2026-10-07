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

// Aya's texts (v2 words, unchanged). v3: they are gated on the player — a question carries reply chips and the
// next beat waits for the answer (or for a location / state), see story.js. `lost: true` on a reply = the player
// asked for help, which is what earns the Lodestone offer.
export const AYA = {
  hello: { id: 'hello', text: 'Landed?? Welcome to Osaka! 🛬',
    replies: [{ id: 'yes', text: 'Just landed! 🙌' }, { id: 'huge', text: 'Yes! This station is HUGE 😵' }] },
  meet: { id: 'meet', text: 'Meet me at Tempura Daikichi. Namba Parks, 6F! I\'m already in the queue 🍤' },
  // v2's nudges: the first now asks (sent when the player stalls, is on a wrong floor or wanders, not on a timer);
  // the second is her answer to "On my way!"
  where: { id: 'where', text: 'Where are you?? The line is moving. It\'s 6F, Parks, the one with the big green terraces',
    replies: [{ id: 'lost', text: 'I\'m lost 😭', lost: true }, { id: 'omw', text: 'On my way!' }] },
  whereAck: { omw: 'Ask your phone! That\'s what it\'s for 😅' },
};

export const UPGRADE = {
  offer: 'you\'re lost aren\'t you 😂 install Lodestone, it actually works indoors',
  ready: 'see? 😌 6F, I\'m 3rd in line',
};

// v3: the in-game tutorial hints (one small line at a time, never a modal). {k:X} renders a key cap.
export const TUTORIAL = {
  look: 'Move the mouse to look around',
  move: '{k:W}{k:A}{k:S}{k:D} to walk · hold {k:Shift} to hurry',
  raise: 'Your phone buzzed — {k:Q} to raise it',
  raiseHold: 'Your phone buzzed — {k:Q} or hold right-click',
  reply: 'Answer Aya — press {k:1} {k:2} or click a reply',
  replyDown: 'Aya asked you something — {k:Q} to answer',
  maps: 'Open <b>Maps</b> — {k:Tab} switches apps (or click the dock)',
  mapsDown: '{k:Q} then open <b>Maps</b>',
  interact: '{k:E} interacts — machines, doors, café counters',
  interactHere: '{k:E} — try it',
  install: 'Aya sent a link — {k:Q}, then {k:Enter} or click <b>Lodestone</b>',
  installUp: '{k:Enter} or click <b>Lodestone</b> in Aya\'s message',
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
