// =============================================================================
// tools/audio/lines.mjs (v20): every Japanese line the announcer can be asked to speak, as JSON on stdout, for the recording
// pipeline. Imports the game's own modules (phrases.js, timetable.js, transit/lines.js, layout.js), so the list can never
// drift from the game. Node 22, no dependencies:  node tools/audio/lines.mjs > lines.json   (counts per style go to stderr)
//
// entry: { key, text, read, style, voices }
//   text   exactly the string the announcer keys on at run time (train lines: after firstSentences(..., 'ja', 2), as in
//          js/audio/trains.js onAnnounce), key = voiceKey(text)
//   read   what to hand to a text-to-speech engine: voiceText(text) (clock times out, punctuation kept), destination names as
//          their DESTS kana, and a few place names whose reading a TTS engine gets wrong
//   style  pa-station | pa-mall | staff | passerby      voices  1 for PA lines, 2 for staff, 3 for passerby
// =============================================================================
const V = '?v=1d470ff';
const J = '../../js/';
const { voiceText, voiceKey, firstSentences, ESCALATOR_LINES, AREA_PA, IRASSHAI, DINING_CALLS, EXCUSE, CALLOUT } = await import(J + 'audio/phrases.js' + V);
const { NK_PATTERNS, METRO_DESTS, DESTS, TYPES, hhmm } = await import(J + 'world/transit/timetable.js' + V);
const { trainLine } = await import(J + 'world/transit/lines.js' + V);
const { LAYOUT } = await import(J + 'world/layout.js' + V);

// readings a TTS engine would get wrong or ambiguous (Osaka: 日本橋 is Nipponbashi)
const EXTRA_KANA = { '日本橋': 'にっぽんばし', '鶴橋': 'つるはし', '桜川': 'さくらがわ', '梅田': 'うめだ' };
const kana = Object.assign({}, EXTRA_KANA);
for (const k in DESTS) kana[DESTS[k].ja] = DESTS[k].kana;
const names = Object.keys(kana).sort((a, b) => b.length - a.length);
const readOf = (text) => {
  let r = voiceText(text);
  for (const n of names) r = r.split(n).join(kana[n]);
  return r.replace(/β/g, 'ベータ').replace(/α/g, 'アルファ');
};

const out = new Map();           // key -> entry (first source wins; sources are listed in `src` on stderr only)
const src = {};                  // style -> source -> count of distinct keys
const add = (text, style, source) => {
  const key = voiceKey(text);
  if (out.has(key)) return;
  out.set(key, { key, text, read: readOf(text), style, voices: style === 'staff' ? 2 : style === 'passerby' ? 3 : 1 });
  (src[style] = src[style] || {})[source] = ((src[style] || {})[source] || 0) + 1;
};

// ---- fixed PA lines ----------------------------------------------------------------------------------------------------
for (const l of ESCALATOR_LINES) add(l.ja, 'pa-station', 'escalator (sources.js)');
const STATION_MOODS = new Set(['metro', 'passage', 'terminal', 'platform', 'nkplatform']);
for (const [mood, a] of Object.entries(AREA_PA)) for (const l of a.lines) add(l.ja, STATION_MOODS.has(mood) ? 'pa-station' : 'pa-mall', 'area PA ' + (STATION_MOODS.has(mood) ? 'station moods' : 'mall moods'));

// ---- train lines (js/world/transit.js _emit -> trains.js onAnnounce: first two sentences) ----------------------------------
const tm = hhmm(10 * 60 + 41), [hh, mm] = tm.split(':');
const tl = (kind, a) => { const l = trainLine(kind, a); if (l) add(firstSentences(l.ja, 'ja', 2), 'pa-station', 'train ' + a.operator + ' ' + kind); };
for (const t of LAYOUT.tracks) {
  if (t.line === 'nankai') {
    for (const [, type, dest] of NK_PATTERNS[t.no] || []) {
      const ti = TYPES[type], di = DESTS[dest];
      const a = { operator: 'nankai', line: 'nankai', no: t.no, dirJa: t.dirJa, destJa: di.ja, destEn: di.en, tyJa: ti.short ? `${ti.short} ${ti.name}` : ti.ja, typeEn: ti.en, ltd: !!ti.short, hh, mm, tm };
      for (const k of ['approach', 'arrive', 'info', 'closewarn']) tl(k, a);
    }
  } else {
    // metro: approach (per destination, with the track's own direction label), arrive, closewarn. 'info' is never emitted for
    // metro (transit.js schedules it 99999 s after the doors open)
    const dl = METRO_DESTS[t.line][t.no === 1 ? 1 : 2];
    const dests = typeof dl === 'string' ? [dl] : dl.map((x) => x[1]);
    for (const dest of dests) {
      const di = DESTS[dest], ti = TYPES[t.line === 'midosuji' ? 'm_local' : 's_local'];
      const a = { operator: 'metro', line: t.line, no: t.no, dirJa: t.dirJa, destJa: di.ja, destEn: di.en, tyJa: ti.ja, typeEn: ti.en, ltd: false, hh, mm, tm };
      for (const k of ['approach', 'arrive', 'closewarn']) tl(k, a);
    }
  }
}

// ---- shop staff and passers-by (audio.js _bark, sources.js, ambience.js) -------------------------------------------------
for (const l of IRASSHAI) add(l.ja, 'staff', 'IRASSHAI (sources.js shop doors)');
for (const t of DINING_CALLS) add(t, 'staff', 'DINING_CALLS (ambience.js dining floors)');
for (const t of CALLOUT) add(t, 'staff', 'CALLOUT (audio.js _bark, crowd:callout)');
for (const t of EXCUSE) add(t, 'passerby', 'EXCUSE (audio.js _bark, crowd:excuse)');

const list = [...out.values()];
process.stdout.write(JSON.stringify(list, null, 1) + '\n');
const counts = {}; for (const e of list) counts[e.style] = (counts[e.style] || 0) + 1;
process.stderr.write(`lines: ${list.length} distinct keys  ${Object.entries(counts).map(([k, v]) => k + '=' + v).join('  ')}\n`);
if (process.env.LINES_SOURCES) process.stderr.write(JSON.stringify(src, null, 1) + '\n');
