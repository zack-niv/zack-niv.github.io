// =============================================================================
// Train announcement texts (v20): the PA lines Transit._emit sends as 'announce' events, as one pure function so that the
// game and tools/audio/lines.mjs (which lists every line to record) can never disagree about the wording.
//   kind: 'approach' | 'arrive' | 'info' | 'closewarn'
//   a: plain values only
//     operator  'metro' | 'nankai'            line   'midosuji' | 'sennichimae' | 'nankai'
//     no        track number                  dirJa  the track's direction label (metro), e.g. '天王寺・なかもず方面'
//     destJa / destEn                         tyJa   service type as spoken (short + name for limited expresses)
//     typeEn                                  ltd    the type has `short` (limited express: ticket required)
//     hh, mm, tm  departure time as strings ('10', '41', '10:41')
// returns { kind, ja, en, sound }; kind is the 'announce' event kind ('closewarn' is emitted as 'depart'), null for other kinds.
// =============================================================================
export function trainLine(kind, a) {
  const { operator, line, no, destJa, destEn, tyJa, typeEn, ltd, hh, mm, tm } = a;
  if (kind === 'approach') {
    if (operator === 'metro') {
      const dirJa = a.dirJa ? a.dirJa.replace(/方面$/, '') : '';
      return { kind: 'approach',
        ja: `まもなく、${no}番線に、${dirJa}方面、${destJa}行きが到着します。危ないですから、ホームドアから離れてお待ちください。`,
        en: `The train for ${destEn} will arrive at track ${no} shortly. Please stand back from the platform doors.`, sound: 'metro_approach' };
    }
    return { kind: 'approach',
      ja: `まもなく、${no}番線に、${destJa}行き、${tyJa}が、まいります。危ないですから、黄色い線の内側までお下がりください。この電車は、折り返し、${hh}時${mm}分発となります。`,
      en: `The ${typeEn} bound for ${destEn} is arriving at track ${no}. Please stand behind the yellow line. This train will depart at ${tm}.`, sound: 'nankai_approach' };
  }
  if (kind === 'arrive') {
    if (line === 'midosuji') return { kind: 'arrive', ja: 'なんば、なんばです。四つ橋線、千日前線、南海線、近鉄線、阪神線は、お乗り換えです。', en: 'Namba, Namba. Please change here for the Yotsubashi Line, the Sennichimae Line, the Nankai Line, the Kintetsu Line and the Hanshin Line.', sound: 'metro_arrive' };
    if (line === 'sennichimae') return { kind: 'arrive', ja: 'なんば、なんばです。御堂筋線、四つ橋線、南海線、近鉄線、阪神線は、お乗り換えです。', en: 'Namba, Namba. Please change here for the Midosuji Line, the Yotsubashi Line, the Nankai Line, the Kintetsu Line and the Hanshin Line.', sound: 'metro_arrive' };
    return { kind: 'arrive', ja: ARRIVE_NK.ja, en: ARRIVE_NK.en, sound: 'nankai_arrive' };
  }
  if (kind === 'info') {
    const extra = ltd ? '特急券をお持ちでないお客様は、ご乗車いただけません。' : '';
    return { kind: 'info', ja: `${no}番線の電車は、${hh}時${mm}分発、${tyJa}、${destJa}行きです。${extra}`,
      en: `The train at track ${no} is the ${typeEn} for ${destEn}, departing at ${tm}.${ltd ? ' A limited express ticket is required.' : ''}`, sound: 'nankai_info' };
  }
  if (kind === 'closewarn') {
    if (operator === 'metro') return { kind: 'depart', ja: `${no}番線、ドアが閉まります。ご注意ください。`, en: `The doors on track ${no} are closing. Please stand clear.`, sound: 'metro_door_chime' };
    return { kind: 'depart', ja: `${no}番線から、${tyJa}、${destJa}行きが発車します。ドアが閉まります、ご注意ください。`, en: `The ${typeEn} for ${destEn} is departing from track ${no}. The doors are closing.`, sound: 'nankai_melody' };
  }
  return null;
}
// the Nankai terminal's own arrival line (also what transit.js onStart() announces for the player's train)
export const ARRIVE_NK = {
  ja: 'なんば、なんば、終点です。どなた様もお忘れ物のないよう、ご注意ください。',
  en: 'Namba, Namba. This is the last stop. Please make sure you have all your belongings with you.',
};
