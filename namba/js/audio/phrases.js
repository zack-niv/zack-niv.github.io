// =============================================================================
// Announcement texts (JA / EN) in the register of Osaka Metro & Nankai PA,
// plus kana readings so the formant fallback voice gets the rhythm right.
// =============================================================================

// reading dictionary for kanji words we use (longest first when replacing)
const READ = {
  '天王寺': 'てんのうじ', '梅田': 'うめだ', '新大阪': 'しんおおさか', '日本橋': 'にっぽんばし', '鶴橋': 'つるはし', '桜川': 'さくらがわ',
  '野田阪神': 'のだはんしん', '方面': 'ほうめん', '関西空港': 'かんさいくうこう', '和歌山市': 'わかやまし', '難波': 'なんば', '番線': 'ばんせん',
  '発車': 'はっしゃ', '到着': 'とうちゃく', '電車': 'でんしゃ', '危険': 'きけん', '黄色': 'きいろ', '点字': 'てんじ', '線': 'せん',
  '内側': 'うちがわ', '下': 'さ', '注意': 'ちゅうい', '閉': 'し', '乗車': 'じょうしゃ', '乗': 'の', '利用': 'りよう', '際': 'さい',
  '手': 'て', '行': 'ゆ', '空港急行': 'くうこうきゅうこう', '特急': 'とっきゅう', '急行': 'きゅうこう', '普通': 'ふつう', '準急': 'じゅんきゅう',
  '各駅停車': 'かくえきていしゃ', '区間急行': 'くかんきゅうこう', '御堂筋線': 'みどうすじせん', '千日前線': 'せんにちまえせん', '四つ橋線': 'よつばしせん',
  '近鉄線': 'きんてつせん', '阪神線': 'はんしんせん', '南海線': 'なんかいせん', '乗換': 'のりかえ', '乗り換え': 'のりかえ', '本日': 'ほんじつ',
  '駅': 'えき', '構内': 'こうない', '禁煙': 'きんえん', '迷子': 'まいご', '案内': 'あんない', '所': 'じょ', '一': 'いち', '二': 'に', '三': 'さん',
  '四': 'よん', '五': 'ご', '六': 'ろく', '七': 'なな', '八': 'はち', '号車': 'ごうしゃ', '両': 'りょう', '編成': 'へんせい', '扉': 'とびら', '前': 'まえ',
  '中百舌鳥': 'なかもず', '大国町': 'だいこくちょう', '心斎橋': 'しんさいばし', '後': 'うし', '安全': 'あんぜん', '確認': 'かくにん', '少々': 'しょうしょう',
  '待': 'ま', '皆様': 'みなさま', '本': 'ほん', '店': 'てん', '館内': 'かんない', '営業': 'えいぎょう', '時間': 'じかん', '終了': 'しゅうりょう',
};
const KEYS = Object.keys(READ).sort((a, b) => b.length - a.length);
const DIGITS = ['ぜろ', 'いち', 'に', 'さん', 'よん', 'ご', 'ろく', 'なな', 'はち', 'きゅう'];
export function toReading(ja) {
  let s = ja;
  for (const k of KEYS) s = s.split(k).join(READ[k]);
  s = s.replace(/[0-9０-９]/g, d => DIGITS[(d.charCodeAt(0) - (d >= '０' ? 0xff10 : 48)) % 10]);
  s = s.replace(/[・･]/g, '、');
  return s;
}

const LINE_JA = { midosuji: '御堂筋線', sennichimae: '千日前線', nankai: '南海線' };

export const ESCALATOR = {
  ja: 'エスカレーターをご利用の際は、手すりにおつかまりいただき、黄色い線の内側にお乗りください。',
  en: 'When using the escalator, please hold the handrail and stand inside the yellow lines.',
};

export function approach(track) {
  const no = track && track.no || 1;
  const dJa = track && track.dirJa ? track.dirJa : '';
  const dEn = track && track.dirEn ? track.dirEn.replace(/^for /, '') : '';
  return {
    ja: `まもなく、${no}番線に、${dJa ? dJa + '行きの' : ''}電車が到着します。危険ですから、黄色い点字ブロックまでお下がりください。`,
    en: `The train ${dEn ? 'for ' + dEn + ' ' : ''}will soon arrive at track ${no}. For your safety, please stand behind the yellow line.`,
  };
}
export function arrival(track) {
  const metro = track && track.line !== 'nankai';
  return metro ? {
    ja: 'なんば、なんばです。ご乗車ありがとうございます。',
    en: 'Namba. Namba. Thank you for riding the Osaka Metro.',
  } : {
    ja: 'なんば、なんば、終点です。ご乗車ありがとうございました。',
    en: 'Namba. Namba is the last stop. Thank you for riding with us.',
  };
}
export function doorsClosing() {
  return { ja: 'ドアが閉まります。ご注意ください。', en: 'The doors are closing. Please stand clear.' };
}
export function departure(track) {
  const no = track && track.no || 1;
  const kind = no % 2 ? '空港急行、関西空港' : '急行、和歌山市';
  const kindEn = no % 2 ? 'Airport Express for Kansai Airport' : 'Express for Wakayamashi';
  return { ja: `${no}番線から、${kind}行きが、発車します。`, en: `The ${kindEn} is departing from track ${no}.` };
}
// ambient PA lines (heard from afar, partly — low priority)
export const AMBIENT_PA = {
  metro: [
    { ja: '本日も御堂筋線をご利用いただきまして、ありがとうございます。', en: 'Thank you for using the Midosuji Line.' },
    { ja: '駅構内は禁煙です。ご協力をお願いいたします。', en: 'Smoking is prohibited in the station.' },
    { ja: '御堂筋線は、ただいま平常どおり運転しております。', en: 'The Midosuji Line is running on schedule.' },
  ],
  terminal: [
    { ja: '南海線をご利用いただきまして、ありがとうございます。', en: 'Thank you for using the Nankai Line.' },
    { ja: '関西空港へお越しのお客様は、空港急行または特急ラピートをご利用ください。', en: 'Passengers for Kansai Airport, please use the Airport Express or the limited express rapi:t.' },
    { ja: 'お忘れ物のないよう、ご注意ください。', en: 'Please make sure you have all your belongings.' },
  ],
  arcade: [
    { ja: 'ご来店のお客様に、迷子のお知らせをいたします。', en: 'Attention shoppers: we are looking for a lost child.' },
    { ja: 'なんばウォークをご利用いただきまして、ありがとうございます。', en: 'Thank you for visiting NAMBAWALK.' },
  ],
  mall: [
    { ja: '本日もなんばシティにご来館いただきまして、誠にありがとうございます。', en: 'Thank you for visiting Namba CITY today.' },
  ],
  department: [
    { ja: '本日もご来店いただきまして、誠にありがとうございます。', en: 'Thank you for shopping with us today.' },
  ],
};
export const IRASSHAI = [{ ja: 'いらっしゃいませー', en: '' }, { ja: 'いらっしゃいませ、こんにちはー', en: '' }, { ja: 'ありがとうございましたー', en: '' }];
export { LINE_JA };
