// =============================================================================
// Wayfinding data shared by the station signage (world/signage.js) and the
// phone (ui/phone.js): railway lines, the "destinations" signs point to (with
// nav goal points), numbered exits, facilities and the transit places the
// phone search knows about.
//
// Everything here is plain data derived from / consistent with layout.js —
// no THREE, no DOM — so it can also be imported inside a Web Worker.
// =============================================================================

// Railway lines & their symbols. `letter` drawn in a circle (Osaka Metro) or
// a rounded square (private railways).
export const LINES = {
  midosuji:    { ja: '御堂筋線', en: 'Midosuji Line', color: '#E5171F', letter: 'M', op: 'metro', shape: 'circle', code: 'M20' },
  sennichimae: { ja: '千日前線', en: 'Sennichimae Line', color: '#E44D93', letter: 'S', op: 'metro', shape: 'circle', code: 'S16' },
  yotsubashi:  { ja: '四つ橋線', en: 'Yotsubashi Line', color: '#0078BA', letter: 'Y', op: 'metro', shape: 'circle', code: 'Y15' },
  nankai:      { ja: '南海線', en: 'Nankai Line', color: '#F08300', letter: 'NK', op: 'nankai', shape: 'square', code: 'NK01' },
  kintetsu:    { ja: '近鉄線', en: 'Kintetsu Line', color: '#D7182A', letter: '近鉄', op: 'kintetsu', shape: 'square', code: 'A01' },
  hanshin:     { ja: '阪神線', en: 'Hanshin Line', color: '#00479D', letter: '阪神', op: 'hanshin', shape: 'square', code: 'HS41' },
  jr:          { ja: 'JR線', en: 'JR Line', color: '#0072BC', letter: 'JR', op: 'jr', shape: 'square', code: 'JR-Q20' },
};

// The four (five) stations all called "Namba".
export const STATIONS = [
  { id: 'st_metro', ja: 'なんば駅', en: 'Namba Sta.', op: 'Osaka Metro', lines: ['midosuji', 'sennichimae', 'yotsubashi'] },
  { id: 'st_nankai', ja: '南海なんば駅', en: 'Nankai Namba Sta.', op: 'Nankai', lines: ['nankai'] },
  { id: 'st_kintetsu', ja: '大阪難波駅', en: 'Osaka-Namba Sta.', op: 'Kintetsu / Hanshin', lines: ['kintetsu', 'hanshin'] },
  { id: 'st_jr', ja: 'JR難波駅', en: 'JR Namba Sta.', op: 'JR West', lines: ['jr'] },
];

// Numbered exits: sign text. (Positions come from LAYOUT.exits.)
export const EXIT_INFO = {
  exit_15: { no: '15', to: [['千日前通', 'Sennichimae-dori'], ['道頓堀', 'Dotonbori']], ramp: 'stair_exit_15_0' },
  exit_18: { no: '18', to: [['道頓堀', 'Dotonbori'], ['戎橋', 'Ebisubashi']], ramp: 'stair_exit_18_0' },
  exit_21: { no: '21', to: [['日本橋', 'Nipponbashi'], ['黒門市場', 'Kuromon Market']], ramp: 'stair_exit_21_0' },
  exit_24: { no: '24', to: [['なんばHips', 'Namba Hips'], ['千日前', 'Sennichimae']], ramp: 'stair_exit_24_0' },
  exit_m1: { no: '1', to: [['高島屋', 'Takashimaya'], ['なんば広場', 'Namba Plaza']], ramp: 'stair_exit_m1_0' },
};

// Facilities that signage itself builds (doorway + pictogram) and therefore
// may truthfully point to. kind: toilet | locker | taxi | info
// wall: the point on a wall (x,z) and the normal into the walkable side.
export const FACILITIES = [
  { id: 'wc_link', kind: 'toilet', level: 'B1', x: -90, z: -112, nx: 1, nz: 0 },
  { id: 'wc_walk', kind: 'toilet', level: 'B1', x: 127, z: -232, nx: 0, nz: 1 },
  { id: 'wc_cityb1', kind: 'toilet', level: 'B1', x: -30, z: 99, nx: 1, nz: 0 },
  { id: 'wc_nankai2', kind: 'toilet', level: '2F', x: -60, z: -88, nx: 1, nz: 0 },
  { id: 'wc_mfree', kind: 'toilet', level: 'B1', x: -140, z: -64, nx: 1, nz: 0 },
  { id: 'wc_parks6', kind: 'toilet', level: '6F', x: -1, z: 388, nx: 0, nz: -1 },
  { id: 'lk_nankai1', kind: 'locker', level: '1F', x: 40, z: -116, nx: -1, nz: 0 },
  { id: 'lk_walk', kind: 'locker', level: 'B1', x: -92, z: -222, nx: 1, nz: 0, skip: true },
  { id: 'lk_m', kind: 'locker', level: 'B1', x: -140, z: -205, nx: 1, nz: 0 },
  { id: 'lk_city', kind: 'locker', level: 'B1', x: 30, z: -50, nx: -1, nz: 0 },
  { id: 'taxi_mido', kind: 'taxi', level: '1F', x: -103, z: -116, nx: 1, nz: 0, pole: true },
];
export const FACILITY_INFO = {
  toilet: { ja: 'お手洗', en: 'Toilets', picto: 'toilet' },
  locker: { ja: 'コインロッカー', en: 'Coin Lockers', picto: 'locker' },
  taxi: { ja: 'タクシーのりば', en: 'Taxi', picto: 'taxi' },
  info: { ja: '案内所', en: 'Information', picto: 'info' },
};

// Sign destinations. goals: [level, x, z] (any of them). `inside`: zones in
// which the destination is suppressed (you are already there). tier 1 =
// always considered, 2 = within ~350 m, 3 = within ~180 m or major signs.
// `ops`: operators whose signs favour it.
export const DESTINATIONS = [
  { id: 'midosuji', kind: 'line', line: 'midosuji', ja: '御堂筋線', en: 'Midosuji Line', tier: 1, ops: ['metro'],
    goals: [['B2', -116, -170], ['B2', -116, -130], ['B2', -116, -90]], inside: ['midosuji'], level: 'B2' },
  { id: 'sennichimae', kind: 'line', line: 'sennichimae', ja: '千日前線', en: 'Sennichimae Line', tier: 1, ops: ['metro'],
    goals: [['B2', 50, -194], ['B2', 90, -194], ['B2', 120, -194]], inside: ['sennichimae'], level: 'B2' },
  { id: 'yotsubashi', kind: 'line', line: 'yotsubashi', lines: ['yotsubashi', 'jr'], ja: '四つ橋線・JR難波', en: 'Yotsubashi Line / JR Namba', tier: 2, ops: ['metro'],
    goals: [['B1', -139, -214]], offmap: true, level: 'B1' },
  { id: 'nankai', kind: 'line', line: 'nankai', ja: '南海線', en: 'Nankai Line', tier: 1, ops: ['nankai'],
    goals: [['3F', -42, -58], ['3F', -25, -58], ['3F', -8, -58], ['3F', 8, -58]], inside: ['nankai'], level: '3F' },
  { id: 'kintetsu', kind: 'line', line: 'kintetsu', lines: ['kintetsu', 'hanshin'], ja: '近鉄・阪神線', en: 'Kintetsu / Hanshin Lines', tier: 2, ops: ['metro', 'walk'],
    goals: [['B1', 219, -222]], offmap: true, level: 'B1' },
  { id: 'city', kind: 'area', ja: 'なんばCITY', en: 'Namba CITY', tier: 2, ops: ['city', 'nankai'],
    goals: [['B1', 0, -46], ['1F', 0, -36], ['2F', 0, -54]], inside: ['city'] },
  { id: 'parks', kind: 'area', ja: 'なんばパークス', en: 'Namba Parks', tier: 2, ops: ['city', 'parks', 'nankai'],
    goals: [['2F', 0, 198]], inside: ['parks', 'parksGarden'], level: '2F' },
  { id: 'walk', kind: 'area', ja: 'なんばウォーク', en: 'NAMBAWALK', tier: 2, ops: ['walk', 'metro'],
    goals: [['B1', -70, -222], ['B1', 0, -222], ['B1', 90, -222]], inside: ['nambawalk'], level: 'B1' },
  { id: 'takashimaya', kind: 'area', ja: '高島屋', en: 'Takashimaya', tier: 2, ops: ['metro', 'nankai', 'walk'],
    goals: [['B1', -16, -204], ['1F', -60, -178]], inside: ['takashimaya'] },
  { id: 'street', kind: 'street', ja: '地上・なんば広場', en: 'Street level / Namba Plaza', tier: 3, ops: ['nankai', 'metro'],
    goals: [['1F', -70, -192], ['1F', -30, -203]], inside: ['street', 'plaza'], level: '1F' },
  { id: 'exit_15', kind: 'exit', exit: 'exit_15', tier: 3, ops: ['walk', 'metro'], goals: [['1F', -57, -255]] },
  { id: 'exit_18', kind: 'exit', exit: 'exit_18', tier: 3, ops: ['walk', 'metro'], goals: [['1F', 43, -255]] },
  { id: 'exit_21', kind: 'exit', exit: 'exit_21', tier: 3, ops: ['walk', 'metro'], goals: [['1F', 143, -255]] },
  { id: 'exit_24', kind: 'exit', exit: 'exit_24', tier: 3, ops: ['walk'], goals: [['1F', 199, -190]] },
  { id: 'exit_m1', kind: 'exit', exit: 'exit_m1', tier: 3, ops: ['metro'], goals: [['1F', -93, -196]] },
  { id: 'toilet', kind: 'facility', fac: 'toilet', tier: 3, ops: ['metro', 'nankai', 'walk', 'city', 'parks'], goals: 'facility' },
  { id: 'locker', kind: 'facility', fac: 'locker', tier: 3, ops: ['metro', 'nankai', 'city'], goals: 'facility' },
  { id: 'taxi', kind: 'facility', fac: 'taxi', tier: 3, ops: ['nankai'], goals: 'facility' },
];

// resolve facility goals (1.2 m in front of each doorway)
for (const d of DESTINATIONS) {
  if (d.goals === 'facility') {
    d.goals = FACILITIES.filter(f => f.kind === d.fac && !f.skip).map(f => [f.level, f.x + f.nx * 1.5, f.z + f.nz * 1.5]);
  }
}
export const destById = Object.fromEntries(DESTINATIONS.map(d => [d.id, d]));

// Transit "places" for the phone search (lines, platforms, gates, stations,
// destinations reachable by train). `at`: [level, x, z] pin position.
export const TRANSIT_PLACES = [
  { id: 'tp_m_plat2', kind: 'platform', line: 'midosuji', en: 'Midosuji Line — Track 2', ja: '御堂筋線 2番線', sub: 'for Umeda / Shin-Osaka · 梅田・新大阪方面', at: ['B2', -111, -130],
    keys: ['midosuji', 'shin-osaka', 'shinosaka', 'umeda', 'subway', 'metro', 'red line', '御堂筋', '新大阪', '梅田'] },
  { id: 'tp_m_plat1', kind: 'platform', line: 'midosuji', en: 'Midosuji Line — Track 1', ja: '御堂筋線 1番線', sub: 'for Tennoji / Nakamozu · 天王寺・なかもず方面', at: ['B2', -121, -130],
    keys: ['midosuji', 'tennoji', 'subway', 'metro', '御堂筋', '天王寺'] },
  { id: 'tp_m_ngate', kind: 'gate', line: 'midosuji', en: 'Midosuji Line North Gate', ja: '御堂筋線 北改札', sub: 'Osaka Metro Namba Sta. · B1', at: ['B1', -116, -182],
    keys: ['midosuji', 'gate', 'north gate', 'metro', '改札'] },
  { id: 'tp_m_sgate', kind: 'gate', line: 'midosuji', en: 'Midosuji Line South Gate', ja: '御堂筋線 南改札', sub: 'Osaka Metro Namba Sta. · B1', at: ['B1', -116, -78],
    keys: ['midosuji', 'gate', 'south gate', 'metro', '改札'] },
  { id: 'tp_s_plat', kind: 'platform', line: 'sennichimae', en: 'Sennichimae Line platforms', ja: '千日前線 のりば', sub: 'Tracks 1–2 · Tsuruhashi / Nodahanshin', at: ['B2', 80, -194],
    keys: ['sennichimae', 'subway', 'metro', 'pink', 'tsuruhashi', '千日前'] },
  { id: 'tp_s_gate', kind: 'gate', line: 'sennichimae', en: 'Sennichimae Line Gate', ja: '千日前線 改札', sub: 'Osaka Metro Namba Sta. · B1', at: ['B1', 60, -206],
    keys: ['sennichimae', 'gate', '改札'] },
  { id: 'tp_nk_gate', kind: 'gate', line: 'nankai', en: 'Nankai Namba — Central Gate', ja: '南海なんば駅 中央改札口', sub: 'Nankai Line · 3F', at: ['3F', -16, -70],
    keys: ['nankai', 'airport', 'kansai', 'kix', 'rapi:t', 'rapit', 'koya', 'wakayama', '南海', '関西空港'] },
  { id: 'tp_jr', kind: 'station', line: 'jr', en: 'JR Namba Station', ja: 'JR難波駅', sub: 'via Yotsubashi Line passage · approx. 600 m west', at: ['B1', -139, -214], offmap: true,
    keys: ['jr', 'namba station', 'nara', 'jr namba'] },
  { id: 'tp_kin', kind: 'station', line: 'kintetsu', en: 'Osaka-Namba Station (Kintetsu / Hanshin)', ja: '大阪難波駅（近鉄・阪神）', sub: 'via NAMBAWALK, east end', at: ['B1', 219, -222], offmap: true,
    keys: ['kintetsu', 'hanshin', 'nara', 'kobe', 'namba station', 'osaka-namba', '近鉄', '阪神'] },
  { id: 'tp_metro', kind: 'station', line: 'midosuji', en: 'Namba Station (Osaka Metro)', ja: 'なんば駅（Osaka Metro）', sub: 'Midosuji · Sennichimae · Yotsubashi', at: ['B1', -116, -200],
    keys: ['namba station', 'metro', 'subway', 'namba', 'なんば駅'] },
  { id: 'tp_nankai', kind: 'station', line: 'nankai', en: 'Nankai Namba Station', ja: '南海なんば駅', sub: 'Nankai Line · Airport · 2F/3F', at: ['3F', -16, -74],
    keys: ['namba station', 'nankai', 'namba', 'なんば駅', '南海'] },
  // train destinations (searching a far-away place gives you the line)
  { id: 'tp_shinosaka', kind: 'trip', line: 'midosuji', en: 'Shin-Osaka Station', ja: '新大阪駅', sub: 'Midosuji Line (for Umeda / Shin-Osaka) · Track 2 · 15 min · ¥290', at: ['B2', -111, -130],
    keys: ['shin-osaka', 'shinosaka', 'shin osaka', 'shinkansen', '新大阪'], trip: { from: 'Namba (M20)', to: 'Shin-Osaka (M13)', stops: 7, min: 15, fare: 290, track: 'm_track2' } },
  { id: 'tp_umeda', kind: 'trip', line: 'midosuji', en: 'Umeda', ja: '梅田', sub: 'Midosuji Line (for Umeda / Shin-Osaka) · Track 2 · 8 min · ¥240', at: ['B2', -111, -130],
    keys: ['umeda', 'osaka station', '梅田'], trip: { from: 'Namba (M20)', to: 'Umeda (M16)', stops: 4, min: 8, fare: 240, track: 'm_track2' } },
  { id: 'tp_kix', kind: 'trip', line: 'nankai', en: 'Kansai Airport', ja: '関西空港', sub: 'Nankai Airport Line · rapi:t from Track 3–4 · 38 min', at: ['3F', -16, -70],
    keys: ['airport', 'kix', 'kansai', '関西空港'], trip: { from: 'Namba (NK01)', to: 'Kansai Airport (NK45)', stops: 6, min: 38, fare: 970, track: 'nk_track_4' } },
];

// Station name boards (platform signs): prev ← this → next, as seen from the
// platform looking at a given heading.
export const PLATFORM_BOARDS = {
  midosuji: { here: ['なんば', 'Namba', 'M20'], minus: ['心斎橋', 'Shinsaibashi', 'M19'], plus: ['大国町', 'Daikokucho', 'M21'], axis: 'z' }, // minus = -z (north)
  sennichimae: { here: ['なんば', 'Namba', 'S16'], minus: ['桜川', 'Sakuragawa', 'S15'], plus: ['日本橋', 'Nippombashi', 'S17'], axis: 'x' }, // minus = -x (west)
  nankai: { here: ['なんば', 'Namba', 'NK01'], minus: null, plus: ['新今宮', 'Shin-Imamiya', 'NK02'], axis: 'z' },
};
// Nankai tracks: line groups (real Namba: 1–4 Koya Line, 5–8 Nankai Main Line/Airport)
export const NANKAI_TRACKS = {   // matches transit/timetable.js NK_PATTERNS
  1: ['高野線', 'Koya Line', '橋本・極楽橋方面', 'for Hashimoto / Gokurakubashi'],
  2: ['高野線', 'Koya Line', '橋本・極楽橋方面', 'for Hashimoto / Gokurakubashi'],
  3: ['空港線', 'Airport Line', '関西空港方面（空港急行）', 'for Kansai Airport'],
  4: ['空港線', 'Airport Line', 'ラピート 関西空港方面', 'rapi:t for Kansai Airport'],
  5: ['南海線', 'Nankai Line', '和歌山市方面（サザン）', 'for Wakayamashi / Southern'],
  6: ['南海線', 'Nankai Line', '和歌山市・みさき公園方面', 'for Wakayamashi / Misaki-koen'],
  7: ['高野線', 'Koya Line', '泉北・河内長野方面', 'for Izumi-chuo / Kawachinagano'],
  8: ['南海線', 'Nankai Line', '普通 羽倉崎・みさき公園方面', 'Local for Hagurazaki / Misaki-koen'],
};

// Which operator's signage family governs a zone.
export const ZONE_OPERATOR = {
  midosuji: 'metro', sennichimae: 'metro', link: 'metro', nambawalk: 'walk', takashimaya: 'taka',
  plaza: 'metro', street: 'metro', nankai: 'nankai', city: 'city', parks: 'parks', parksGarden: 'parks',
};

// NAMBAWALK is divided into "streets" (番街) west → east.
export function walkStreet(x) {
  if (x < 20) return { no: 1, ja: '1番街', en: '1st Ave.', color: '#e07b28' };
  if (x < 125) return { no: 2, ja: '2番街', en: '2nd Ave.', color: '#2f9a5c' };
  return { no: 3, ja: '3番街', en: '3rd Ave.', color: '#2f6fb8' };
}
