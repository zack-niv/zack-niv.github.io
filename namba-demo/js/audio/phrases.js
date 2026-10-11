// =============================================================================
// Announcement texts (JA / EN) in the register of Osaka Metro & Nankai PA.
// Spoken by the browser's real voices (speechSynthesis ja-JP then en-*), so
// every line here has to be correct, natural Japanese / English and short.
// `say` is an optional pronunciation override for the TTS engine (the caption
// shows `text`).
// =============================================================================

// text for the TTS engine: spell out things the engine would mangle
export function spokenText(text, lang) {
  let s = String(text);
  if (lang === 'en') s = s.replace(/rapi:t/gi, 'Rapito').replace(/\bJR\b/g, 'J R').replace(/\bICOCA\b/g, 'Icoca');
  return s;
}
// the first n sentences (JA: 。 EN: . ! ?) — long transit lines are spoken in their opening sentences
export function firstSentences(text, lang, n = 2) {
  if (!text) return '';
  const parts = lang === 'ja' ? String(text).match(/[^。]+。?/g) : String(text).match(/[^.!?]+[.!?]?/g);
  if (!parts || parts.length <= n) return String(text);
  return parts.slice(0, n).join('').trim();
}

const LINE_JA = { midosuji: '御堂筋線', sennichimae: '千日前線', nankai: '南海線' };

export const ESCALATOR = {
  ja: 'エスカレーターをご利用の際は、手すりにおつかまりください。',
  en: 'When using the escalator, please hold the handrail.',
};

// the speaker at an escalator landing rotates through these (JA then EN)
export const ESCALATOR_LINES = [
  ESCALATOR,
  { ja: 'エスカレーターでは、歩いたり走ったりしないでください。', en: 'Please do not walk or run on the escalator.' },
  { ja: 'ベビーカーや大きな荷物をお持ちの方は、エレベーターをご利用ください。', en: 'Passengers with strollers or large luggage, please use the elevator.' },
  { ja: 'お子様連れのお客様は、足元にご注意ください。', en: 'Please watch your step, and keep small children close.' },
];

// ---- fallback train lines (only used when no transit system emits 'announce') ----------------------
export function approach(track) {
  const no = track && track.no || 1;
  if (track && track.line === 'nankai') {
    const airport = no % 2 === 1;
    return airport
      ? { ja: `まもなく、${no}番線に、関西空港行き、特急ラピートが、まいります。`, en: `The limited express Rapi:t bound for Kansai Airport is now arriving at track ${no}.` }
      : { ja: `まもなく、${no}番線に、和歌山市行き、急行が、まいります。`, en: `The express bound for Wakayamashi is now arriving at track ${no}.` };
  }
  const dJa = track && track.dirJa ? String(track.dirJa).replace(/方面$/, '') : '';
  const dEn = track && track.dirEn ? String(track.dirEn).replace(/^for /, '') : '';
  return {
    ja: `まもなく、${no}番線に、${dJa ? dJa + '方面行きの' : ''}電車が、まいります。危ないですから、ホームドアから離れてお待ちください。`,
    en: `The train ${dEn ? 'for ' + dEn + ' ' : ''}will arrive at track ${no} shortly. Please stand back from the platform doors.`,
  };
}
export function arrival(track) {
  const metro = track && track.line !== 'nankai';
  return metro
    ? { ja: 'なんば、なんばです。', en: 'Namba. This is Namba.' }
    : { ja: 'なんば、なんば、終点です。お忘れ物のないよう、ご注意ください。', en: 'Namba. This is the last stop. Please take all your belongings with you.' };
}
export function doorsClosing() {
  return { ja: 'ドアが閉まります。ご注意ください。', en: 'The doors are closing. Please stand clear.' };
}
export function departure(track) {
  const no = track && track.no || 1;
  return no % 2 === 1
    ? { ja: `${no}番線から、関西空港行き、特急ラピートが、発車します。`, en: `The limited express Rapi:t for Kansai Airport is departing from track ${no}.` }
    : { ja: `${no}番線から、和歌山市行き、急行が、発車します。`, en: `The express for Wakayamashi is departing from track ${no}.` };
}

// ---- area PA (v11): the building talking to everyone, per soundscape mood ---------------------------------------
// Short, real-sounding notices in the register of Osaka Metro / Nankai / mall PAs. Each mood has a handful so that a
// five-minute visit does not repeat. `every` = [min, max] seconds between notices while you stay in that mood; `gain` =
// how loud (1 = full, the platform level); `first` = seconds until the first notice after you arrive. Moods with no entry
// (shops, restaurant floors, the garden) stay silent on purpose.
export const AREA_PA = {
  // Midosuji / Sennichimae gate halls and the underground passages
  metro: { every: [38, 64], first: 14, gain: 0.95, lines: [
    { ja: 'ただいま、御堂筋線は、平常どおり運転しております。', en: 'The Midosuji Line is running on schedule.' },
    { ja: '駅構内での、歩きながらのスマートフォンの操作は、大変危険です。おやめください。', en: 'Using your phone while walking is dangerous. Please stop.' },
    { ja: '改札口の付近では、他のお客様のご迷惑となりますので、立ち止まらないでください。', en: 'Please do not stop near the ticket gates.' },
    { ja: '駅構内は禁煙です。ご協力をお願いいたします。', en: 'Smoking is prohibited in the station.' },
    { ja: 'お忘れ物のないよう、ご注意ください。', en: 'Please make sure you have all your belongings.' },
  ] },
  // Nankai terminal concourse (open shed, airport line)
  terminal: { every: [36, 60], first: 12, gain: 0.95, lines: [
    { ja: 'ただいま、南海線は、平常どおり運転しております。', en: 'The Nankai Line is running on schedule.' },
    { ja: '特急ラピートは、全車両指定席です。特急券をお求めのうえ、ご乗車ください。', en: 'The Rapi:t limited express is all reserved seating. Please buy a limited express ticket.' },
    { ja: '大きなお荷物をお持ちのお客様は、周りのお客様のご迷惑にならないよう、ご注意ください。', en: 'Passengers with large luggage, please be considerate of those around you.' },
    { ja: '南海線をご利用いただきまして、ありがとうございます。', en: 'Thank you for using the Nankai Line.' },
    { ja: '駅構内での、歩きながらのスマートフォンの操作は、おやめください。', en: 'Please do not use your phone while walking.' },
  ] },
  // NAMBAWALK (underground arcade)
  arcade: { every: [48, 80], first: 18, gain: 0.85, lines: [
    { ja: 'なんばウォークをご利用いただきまして、ありがとうございます。', en: 'Thank you for visiting Namba Walk.' },
    { ja: '通路が大変混み合っております。お足元にご注意ください。', en: 'The walkway is very crowded. Please watch your step.' },
    { ja: 'お客様にお知らせいたします。自転車の乗り入れは、ご遠慮ください。', en: 'Bicycles are not permitted in the arcade.' },
  ] },
  // Takashimaya and the food hall
  department: { every: [55, 90], first: 20, gain: 0.8, lines: [
    { ja: '本日もご来店いただきまして、ありがとうございます。', en: 'Thank you for shopping with us today.' },
    { ja: 'お客様にお知らせいたします。地下の食料品売り場は、大変混雑しております。お足元にご注意ください。', en: 'The food hall is very crowded. Please watch your step.' },
    { ja: 'お買い物の際は、お荷物から手を離さないよう、ご注意ください。', en: 'Please keep an eye on your belongings while shopping.' },
  ] },
  // Namba CITY
  mall: { every: [46, 76], first: 16, gain: 0.9, lines: [
    { ja: '本日もなんばシティにご来館いただきまして、ありがとうございます。', en: 'Thank you for visiting Namba City today.' },
    { ja: '迷子のお知らせをいたします。赤いシャツを着た、四歳くらいの男の子が、サービスカウンターでお待ちです。お心当たりのお客様は、サービスカウンターまでお越しください。', en: 'A lost child notice: a boy of about four in a red shirt is waiting at the service counter. If you know him, please come to the service counter.' },
    { ja: '館内での、歩きながらのスマートフォンのご利用は、おやめください。', en: 'Please do not use your phone while walking in the building.' },
    { ja: 'エレベーターは、ベビーカーや車いすをご利用のお客様を、優先とさせていただきます。', en: 'Elevators are for priority use by passengers with strollers or wheelchairs.' },
    { ja: 'お買い物の際は、お荷物から手を離さないよう、ご注意ください。', en: 'Please keep an eye on your belongings while shopping.' },
  ] },
  // Namba Parks interior
  parks: { every: [52, 84], first: 18, gain: 0.85, lines: [
    { ja: 'なんばパークスに、ご来館いただきまして、ありがとうございます。', en: 'Thank you for visiting Namba Parks.' },
    { ja: '屋上のパークスガーデンは、緑あふれる空中庭園です。どうぞ、お散歩をお楽しみください。', en: 'The Parks Garden on the roof is a green sky garden. Please enjoy a stroll.' },
    { ja: '迷子のお知らせをいたします。青い帽子をかぶった、三歳くらいの女の子が、インフォメーションカウンターでお待ちです。保護者の方は、インフォメーションカウンターまでお越しください。', en: 'A lost child notice: a girl of about three in a blue hat is waiting at the information counter. Would her parents please come to the information counter.' },
    { ja: 'エスカレーターでは、お子様から、目を離さないでください。', en: 'Please keep an eye on your children on the escalators.' },
  ] },
  // open-air Parks (canyon): rare, softer, as if from a speaker on the terrace
  canyon: { every: [70, 110], first: 30, gain: 0.55, lines: [
    { ja: 'ご来園のお客様にお知らせいたします。植え込みへの立ち入りや、お花を摘むことは、おやめください。', en: 'Please do not walk into the planting beds or pick the flowers.' },
    { ja: 'なんばパークスへ、ようこそ。ごゆっくり、お楽しみください。', en: 'Welcome to Namba Parks. Please enjoy your visit.' },
  ] },
  // platforms between trains (audible on the platform itself; the train lines come from transit)
  platform: { every: [40, 70], first: 20, gain: 1, platform: true, lines: [
    { ja: 'ホームでは、走ったり、駆け込み乗車をしたりしないでください。大変危険です。', en: 'Do not run on the platform or rush to board. It is dangerous.' },
    { ja: '電車の乗り降りの際は、お足元に、ご注意ください。', en: 'Please watch your step when boarding and leaving the train.' },
    { ja: 'ホームドアに、寄りかからないでください。', en: 'Please do not lean on the platform doors.' },
  ] },
  nkplatform: { every: [40, 70], first: 20, gain: 1, platform: true, lines: [
    { ja: '電車とホームの間が、広く空いております。お足元にご注意ください。', en: 'There is a wide gap between the train and the platform. Please watch your step.' },
    { ja: '黄色い線の内側で、お待ちください。', en: 'Please wait behind the yellow line.' },
    { ja: 'ホームでの、歩きながらのスマートフォンの操作は、危険です。おやめください。', en: 'Using your phone while walking on the platform is dangerous. Please stop.' },
  ] },
};
AREA_PA.passage = AREA_PA.metro;

// short, clear shop / restaurant calls (spoken at low volume by distance, never babbled)
export const IRASSHAI = [{ ja: 'いらっしゃいませ', en: 'Welcome' }, { ja: 'いらっしゃいませ、こんにちは', en: 'Welcome, hello' }, { ja: 'ありがとうございました', en: 'Thank you very much' }];
export const DINING_CALLS = ['いらっしゃいませ', 'いらっしゃいませ', 'いらっしゃいませ、こんにちは', 'ありがとうございました', 'お待たせいたしました'];
export const EXCUSE = ['すみません', 'すみません', '失礼します'];
export { LINE_JA };
