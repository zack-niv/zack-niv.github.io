// =============================================================================
// All the words. Tone: warm, curious, a little funny, never stressful.
// Kept in one place so the voice stays consistent and is easy to edit.
// =============================================================================

export const QUESTS = {
  coffee:  { text: 'Find a great coffee', textJa: '美味しいコーヒーを探す', detail: 'Not chain stuff, Aya says.' },
  tempura: { text: 'Find tempura for lunch', textJa: 'お昼は天ぷら', detail: 'Somewhere people queue for.' },
  subway:  { text: 'Midosuji Line to Shin-Osaka', textJa: '御堂筋線で新大阪へ', detail: 'Shinkansen leaves Shin-Osaka at 16:10.' },
};

// Opening texts (sent in order, with delays in real seconds)
export const INTRO = [
  [2.2, 'Landed?? Welcome to Osaka!!'],
  [4.2, 'Ok, today\'s mission, very serious:\n1. a GOOD coffee (not chain stuff)\n2. tempura for lunch\n3. Midosuji Line to Shin-Osaka for the 16:10 Shinkansen'],
  [4.0, 'Namba station is basically a city. You will get lost. That\'s the fun part'],
];

// Vague hints, one at a time, only after a long while without progress.
export const HINTS = {
  coffee: [
    'Coffee intel from my coworker: there\'s a tiny standing coffee bar somewhere in the underground passage between the subway and Nankai. No chairs. Always a queue. Worth it.',
    'Or go full Showa: there\'s a kissaten in NAMBAWALK with velvet chairs. Like, 1975 velvet.',
  ],
  tempura: [
    'Tempura: everyone says Daikichi. It\'s in Namba Parks somewhere? One of the restaurant floors. High up.',
    'If you find the canyon thing in Parks you\'re close-ish. Then just keep going UP.',
  ],
  subway: [
    'Midosuji = the red line. Red "M" signs. It runs under Midosuji avenue, so… west?',
    'Shin-Osaka is north. You want the platform for Umeda / Shin-Osaka. NOT Tennoji lol',
  ],
};

// The walk is long and the clock is quick (1 game minute = 10 real seconds), so
// the Shinkansen is the 16:10 and the nudges are gentle and well spaced.
export const SHINKANSEN = { first: 16 * 60 + 10, next: 16 * 60 + 40, leaveBy: 15 * 60 + 40 };
export const TIMED = [
  // [minutes since midnight, condition key, text]
  [12 * 60 + 20, 'tempura', 'It\'s lunch o\'clock. Did you find the tempura?? The good places get a line around now'],
  [14 * 60 + 30, 'subway', 'Reminder!! Shinkansen 16:10 from Shin-Osaka. Leave Namba by 15:40 and you\'re totally fine'],
  [15 * 60 + 30, 'subway', 'Ok now-ish would be a good time to find that red line 😅'],
  [16 * 60 + 10, 'subway', 'Missed it? Lol. There\'s another one at 16:40, I already checked. You\'ll be fine. Japan has a lot of trains'],
  [17 * 60 + 30, 'subway', 'Honestly just move to Namba at this point'],
];

export const REACTIONS = {
  coffeeGreat: 'Wakakusa?? You found it! Told you. Ok now: TEMPURA',
  coffeeKissa: 'A real kissaten!! Did you get the thick toast',
  coffeeChain: 'Mocca Rest? 🙄 That\'s airport coffee with extra steps. Keep looking',
  tempuraGreat: 'DAIKICHI. I\'m so jealous. Ok go find your train, champion',
  tempuraKitsune: 'Kitsune!! Highball + tempura at a standing bar is peak Osaka',
  tendon: 'Tendon is good! But it\'s not Daikichi good. Just saying',
  wrongWay: 'Why does your location say Daikokuchō lol',
  wrongLine: 'That\'s the pink line btw. You want red',
  boarded: 'On the train?? Yay. Send me photos of the bento you buy at Shin-Osaka',
  charged: null,
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
