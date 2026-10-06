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

// ---- ambient PA (faint, rare, only where the PA would plausibly be heard) -------------------------
export const AMBIENT_PA = {
  metro: [
    { ja: '本日も御堂筋線をご利用いただきまして、ありがとうございます。', en: 'Thank you for using the Midosuji Line.' },
    { ja: '駅構内は禁煙です。ご協力をお願いいたします。', en: 'Smoking is prohibited in the station.' },
  ],
  terminal: [
    { ja: '南海線をご利用いただきまして、ありがとうございます。', en: 'Thank you for using the Nankai Line.' },
    { ja: 'お忘れ物のないよう、ご注意ください。', en: 'Please make sure you have all your belongings.' },
  ],
  arcade: [
    { ja: 'なんばウォークをご利用いただきまして、ありがとうございます。', en: 'Thank you for visiting Namba Walk.' },
  ],
  mall: [
    { ja: '本日もなんばシティにご来館いただきまして、ありがとうございます。', en: 'Thank you for visiting Namba City today.' },
  ],
  department: [
    { ja: '本日もご来店いただきまして、ありがとうございます。', en: 'Thank you for shopping with us today.' },
  ],
};

// short, clear shop / restaurant calls (spoken at low volume by distance, never babbled)
export const IRASSHAI = [{ ja: 'いらっしゃいませ', en: 'Welcome' }, { ja: 'いらっしゃいませ、こんにちは', en: 'Welcome, hello' }, { ja: 'ありがとうございました', en: 'Thank you very much' }];
export const DINING_CALLS = ['いらっしゃいませ', 'いらっしゃいませ', 'いらっしゃいませ、こんにちは', 'ありがとうございました', 'お待たせいたしました'];
export const EXCUSE = ['すみません', 'すみません', '失礼します'];
export { LINE_JA };
