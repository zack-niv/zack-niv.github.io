// =============================================================================
// Transit timetable + kinematics.
//
// The whole day's service is generated deterministically at init. Train
// positions are a pure function of the game clock (no accumulated state), so
// a time jump or a paused clock never desynchronises anything.
//
// TIME: the schedule is in game minutes (what the boards show). Physical
// motion (approach, braking, dwell, doors) happens in REAL seconds, because
// the player walks in real time: with the clock at 6x, one game minute is
// 10 real seconds. A train needs ~55-60 real seconds of platform occupancy
// (approach+dwell+clear), so per-track headways are 6-8 game min (rush..midday)
// on Midosuji (both directions together: a train every ~3-4 game min, i.e.
// "every 3 min" at peak, ~6 at night) and 7.5-10 on Sennichimae (every 4-5
// combined). The physical clearance between a departing and the following
// train is checked by tools-free script in notes (>= 25 m).
// =============================================================================
import { rng, hash } from '../../core/rng.js?v=c81de75';

export function rushAt(h) {
  const g = (c, w) => Math.exp(-((h - c) * (h - c)) / (2 * w * w));
  return Math.min(1, 0.25 + 0.75 * Math.max(g(8.4, 0.8), g(18.4, 0.9)) + 0.3 * g(12.3, 0.7));
}

// ---- service types ------------------------------------------------------------
export const TYPES = {
  m_local:  { ja: '普通', en: 'Local', color: '#d8dde3', metro: true },
  s_local:  { ja: '普通', en: 'Local', color: '#d8dde3', metro: true },
  local:    { ja: '普通', en: 'Local', color: '#e9ecef' },
  kakutei:  { ja: '各停', en: 'Local', color: '#e9ecef' },
  semi:     { ja: '準急', en: 'Semi-Exp.', color: '#3d8bff' },
  sect:     { ja: '区間急行', en: 'Sect. Exp.', color: '#23c55e' },
  exp:      { ja: '急行', en: 'Express', color: '#ff7a1a' },
  airexp:   { ja: '空港急行', en: 'Airport Exp.', color: '#ffb000' },
  southern: { ja: '特急サザン', en: 'Ltd.Exp. Southern', color: '#ff3030', short: '特急', name: 'サザン', nameEn: 'Southern' },
  koya:     { ja: '特急こうや', en: 'Ltd.Exp. Koya', color: '#ff3030', short: '特急', name: 'こうや', nameEn: 'Koya' },
  semboku:  { ja: '泉北ライナー', en: 'Semboku Liner', color: '#ffcf3a', short: '特急', name: '泉北ライナー', nameEn: 'Semboku Liner' },
  rapitb:   { ja: '特急ラピートβ', en: 'rapi:t β', color: '#3d7bff', short: '特急', name: 'ラピートβ', nameEn: 'rapi:t β' },
  rapita:   { ja: '特急ラピートα', en: 'rapi:t α', color: '#3d7bff', short: '特急', name: 'ラピートα', nameEn: 'rapi:t α' },
};

// ---- destinations ------------------------------------------------------------------
export const DESTS = {
  nakamozu:  { ja: 'なかもず', en: 'Nakamozu', kana: 'なかもず' },
  tennoji:   { ja: '天王寺', en: 'Tennoji', kana: 'てんのうじ' },
  abiko:     { ja: 'あびこ', en: 'Abiko', kana: 'あびこ' },
  senri:     { ja: '千里中央', en: 'Senri-Chuo', kana: 'せんりちゅうおう' },
  minoh:     { ja: '箕面萱野', en: 'Minoh-kayano', kana: 'みのおかやの' },
  shinosaka: { ja: '新大阪', en: 'Shin-Osaka', kana: 'しんおおさか' },
  nakatsu:   { ja: '中津', en: 'Nakatsu', kana: 'なかつ' },
  minamitatsumi: { ja: '南巽', en: 'Minami-Tatsumi', kana: 'みなみたつみ' },
  nodahanshin:   { ja: '野田阪神', en: 'Nodahanshin', kana: 'のだはんしん' },
  kix:       { ja: '関西空港', en: 'Kansai Airport', kana: 'かんさいくうこう' },
  wakayamashi: { ja: '和歌山市', en: 'Wakayamashi', kana: 'わかやまし' },
  misaki:    { ja: 'みさき公園', en: 'Misaki-koen', kana: 'みさきこうえん' },
  hagurazaki:{ ja: '羽倉崎', en: 'Hagurazaki', kana: 'はぐらざき' },
  gokurakubashi: { ja: '極楽橋', en: 'Gokurakubashi', kana: 'ごくらくばし' },
  hashimoto: { ja: '橋本', en: 'Hashimoto', kana: 'はしもと' },
  kawachinagano: { ja: '河内長野', en: 'Kawachinagano', kana: 'かわちながの' },
  izumichuo: { ja: '和泉中央', en: 'Izumi-chuo', kana: 'いずみちゅうおう' },
  sakaihigashi: { ja: '堺東', en: 'Sakaihigashi', kana: 'さかいひがし' },
  kongo:     { ja: '金剛', en: 'Kongo', kana: 'こんごう' },
};

// ---- lines --------------------------------------------------------------------------
// kinematics (REAL seconds / metres): vIn approach speed, decel braking, approachDist
// distance from the stop point at which the train becomes simulated/visible,
// accel / vMax departure, departDist after which it is gone.
export const LINES = {
  midosuji: {
    id: 'midosuji', ja: '御堂筋線', en: 'Midosuji Line', color: '#E5171F', code: 'M', station: 'M20', stationJa: 'なんば', stationEn: 'Namba',
    level: 'B2', operator: 'metro', psd: true, gauge: 1.435, thirdRail: true,
    kin: { vIn: 16.7, decel: 0.92, approachDist: 340, accel: 0.86, vMax: 20, departDist: 340 },
    door: { openDelay: 2.0, openDur: 2.0, closeLead: 7.0, closeDur: 2.6, psdLag: 0.4 },
  },
  sennichimae: {
    id: 'sennichimae', ja: '千日前線', en: 'Sennichimae Line', color: '#E44D93', code: 'S', station: 'S16', stationJa: 'なんば', stationEn: 'Namba',
    level: 'B2', operator: 'metro', psd: true, gauge: 1.435, thirdRail: true,
    kin: { vIn: 15, decel: 0.9, approachDist: 300, accel: 0.85, vMax: 18, departDist: 300 },
    door: { openDelay: 2.0, openDur: 2.0, closeLead: 6.5, closeDur: 2.6, psdLag: 0.4 },
  },
  nankai: {
    id: 'nankai', ja: '南海線', en: 'Nankai Line', color: '#F08300', code: 'NK', station: 'NK01', stationJa: 'なんば', stationEn: 'Namba',
    level: '3F', operator: 'nankai', psd: false, gauge: 1.067, catenary: true, terminal: true,
    kin: { vIn: 11.5, decel: 0.62, approachDist: 330, accel: 0.72, vMax: 19, departDist: 330 },
    door: { openDelay: 3.0, openDur: 2.2, closeLead: 9.0, closeDur: 3.0, psdLag: 0 },
  },
};

// ---- car formations ---------------------------------------------------------------------
// model keys are built in cars.js
export const FORMATIONS = {
  m10: { models: ['m_cab', 'm_mid', 'm_mid', 'm_mid', 'm_mid', 'm_mid', 'm_mid', 'm_mid', 'm_mid', 'm_cab'] },
  s4: { models: ['s_cab', 's_mid', 's_mid', 's_cab'] },
  rapit6: { models: ['rapit_cab', 'rapit_mid', 'rapit_mid', 'rapit_mid', 'rapit_mid', 'rapit_cab'] },
  southern8: { models: ['south_cab', 'south_mid', 'south_mid', 'south_cab', 'comm_cab', 'comm_mid', 'comm_mid', 'comm_cab'] },
  south4: { models: ['south_cab', 'south_mid', 'south_mid', 'south_cab'] },
  comm8: { models: ['comm_cab', 'comm_mid', 'comm_mid', 'comm_mid', 'comm_mid', 'comm_mid', 'comm_mid', 'comm_cab'] },
  comm6: { models: ['comm_cab', 'comm_mid', 'comm_mid', 'comm_mid', 'comm_mid', 'comm_cab'] },
  comm4: { models: ['comm_cab', 'comm_mid', 'comm_mid', 'comm_cab'] },
};

// Nankai service patterns per track (weights). Tracks 1-2 Koya line, 3-4 airport,
// 5-6 main line, 7-8 locals / Semboku.
const NK_PATTERNS = {
  1: [[3, 'exp', 'gokurakubashi', 'comm4'], [4, 'sect', 'kawachinagano', 'comm8'], [3, 'semi', 'izumichuo', 'comm8'], [2, 'exp', 'hashimoto', 'comm8']],
  2: [[3, 'koya', 'gokurakubashi', 'south4'], [3, 'exp', 'hashimoto', 'comm8'], [2, 'semboku', 'izumichuo', 'south4'], [2, 'kakutei', 'kongo', 'comm6']],
  3: [[5, 'airexp', 'kix', 'comm8'], [2, 'rapitb', 'kix', 'rapit6'], [1, 'local', 'hagurazaki', 'comm6']],
  4: [[4, 'rapitb', 'kix', 'rapit6'], [2, 'rapita', 'kix', 'rapit6'], [2, 'airexp', 'kix', 'comm8']],
  5: [[4, 'southern', 'wakayamashi', 'southern8'], [2, 'exp', 'wakayamashi', 'comm8'], [1, 'exp', 'misaki', 'comm6']],
  6: [[4, 'exp', 'wakayamashi', 'comm8'], [2, 'sect', 'misaki', 'comm8'], [1, 'southern', 'wakayamashi', 'southern8']],
  7: [[4, 'sect', 'izumichuo', 'comm8'], [3, 'semi', 'kawachinagano', 'comm8'], [2, 'kakutei', 'sakaihigashi', 'comm6']],
  8: [[5, 'local', 'hagurazaki', 'comm6'], [3, 'local', 'misaki', 'comm6'], [1, 'kakutei', 'sakaihigashi', 'comm4']],
};

// ---- kinematics ------------------------------------------------------------------------
export function kinematics(k) {
  const tb = k.vIn / k.decel, db = k.vIn * k.vIn / (2 * k.decel);
  const Ta = tb + Math.max(0, k.approachDist - db) / k.vIn;
  const ta = k.vMax / k.accel, da = k.vMax * k.vMax / (2 * k.accel);
  const Td = ta + Math.max(0, k.departDist - da) / k.vMax;
  return {
    Ta, Td,
    // remaining distance to the stop point, tau real seconds before the stop
    approach(tau) { if (tau <= 0) return 0; if (tau <= tb) return 0.5 * k.decel * tau * tau; return db + k.vIn * (tau - tb); },
    approachSpeed(tau) { if (tau <= 0) return 0; return tau <= tb ? k.decel * tau : k.vIn; },
    // distance travelled tau real seconds after starting
    depart(tau) {
      if (tau <= 0) return 0;
      // 1.2 s jerk-limited start
      const j = 1.2;
      if (tau < j) return k.accel * tau * tau * tau / (6 * j);
      const t2 = tau - j / 2;
      if (t2 <= ta) return 0.5 * k.accel * t2 * t2 + k.accel * j * j / 24;
      return da + k.vMax * (t2 - ta) + k.accel * j * j / 24;
    },
    departSpeed(tau) { if (tau <= 0) return 0; const t2 = tau - 0.6; return Math.min(k.vMax, Math.max(0, k.accel * t2)); },
  };
}

// ---- generation ---------------------------------------------------------------------------
const pickW = (r, list) => { let s = 0; for (const it of list) s += it[0]; let x = r() * s; for (const it of list) { x -= it[0]; if (x <= 0) return it; } return list[list.length - 1]; };

export class Timetable {
  constructor(layout, opts = {}) {
    this.scale = opts.scale || 6;
    this.RS = 60 / this.scale;            // real seconds per game minute
    this.seed = opts.seed || 1;
    this.tracks = layout.tracks;
    this.kin = {};
    for (const id in LINES) this.kin[id] = kinematics(LINES[id].kin);
    this.byTrack = {};
    for (const t of this.tracks) this.byTrack[t.id] = this._gen(t);
  }
  g(sec) { return sec / this.RS; } // real seconds -> game minutes

  _svc(t, o) {
    const line = LINES[t.line];
    const kin = this.kin[t.line];
    const s = Object.assign({ line: t.line, track: t.id, trackNo: t.no, platform: t.platform, level: t.level }, o);
    s.approachStart = s.arr - this.g(kin.Ta);
    s.doorsOpenAt = s.arr + this.g(line.door.openDelay);
    s.doorsCloseAt = s.dep - this.g(line.door.closeLead);
    s.goneAt = s.dep + this.g(kin.Td);
    s.typeInfo = TYPES[s.type];
    s.destInfo = DESTS[s.dest];
    s.models = FORMATIONS[s.formation].models;
    s.cars = s.models.length;
    s.time = s.dep; s.hhmm = hhmm(s.dep);
    s.typeJa = s.typeInfo.ja; s.typeEn = s.typeInfo.en; s.typeColor = s.typeInfo.color;
    s.destJa = s.destInfo.ja; s.destEn = s.destInfo.en;
    s.lineJa = line.ja; s.lineEn = line.en;
    s.id = `${t.id}@${Math.round(s.arr * 60)}`;
    return s;
  }

  _gen(t) {
    const r = rng(hash(t.id) ^ this.seed);
    const out = [];
    const line = LINES[t.line];
    const kin = this.kin[t.line];
    if (t.line === 'midosuji' || t.line === 'sennichimae') {
      const m = t.line === 'midosuji';
      // real-second headways (see header)
      const hMid = m ? 84 : 100, hRush = m ? 62 : 74;
      let time = 5 * 60 + (t.no === 1 ? 3 : 7) + r() * 3;
      const end = 24 * 60 + 15;
      while (time < end) {
        const h = time / 60;
        const rush = Math.min(1, Math.max(0, (rushAt(h) - 0.25) / 0.75));
        const dwell = (m ? 24 : 20) + rush * 10 + r.range(-2, 3);
        let dest;
        if (m) dest = t.no === 1 ? pickW(r, [[16, 'nakamozu'], [3, 'tennoji'], [3, 'abiko']])[1] : pickW(r, [[9, 'senri'], [4, 'minoh'], [6, 'shinosaka'], [1, 'nakatsu']])[1];
        else dest = t.no === 1 ? 'minamitatsumi' : 'nodahanshin';
        out.push(this._svc(t, { type: m ? 'm_local' : 's_local', dest, formation: m ? 'm10' : 's4', arr: time, dep: time + this.g(dwell) }));
        let hw = (hMid + (hRush - hMid) * rush + r.range(-7, 7));
        if (h < 6.2 || h > 23) hw *= 1.5;
        hw = Math.max(hw, dwell + 34);
        time += this.g(hw);
      }
    } else if (t.line === 'nankai') {
      const pats = NK_PATTERNS[t.no] || NK_PATTERNS[8];
      let time = 5 * 60 + 2 + t.no * 2.7 + r() * 6;
      const end = 24 * 60 + 10;
      const anchorTrack = t.no === 4;
      // The player's train: rapi:t β, arrived on track 4 at 10:41, departs 11:00.
      const anchor = { arr: 10 * 60 + 41, dep: 11 * 60 };
      const push = (pat, arr, dwellG) => {
        const [, type, dest, formation] = pat;
        const s = this._svc(t, { type, dest, formation, arr, dep: arr + dwellG });
        out.push(s);
        return s;
      };
      while (time < end) {
        const h = time / 60;
        const rush = Math.min(1, Math.max(0, (rushAt(h) - 0.25) / 0.75));
        const pat = pickW(r, pats);
        const ltd = TYPES[pat[1]].short;
        const dwell = (ltd ? r.range(200, 300) : r.range(140, 240)) * (1 - 0.25 * rush); // real s
        if (anchorTrack && time + this.g(dwell + kin.Td + kin.Ta + 115) > anchor.arr && time < anchor.dep) {
          // place the anchor service, then continue after it
          const s = push([1, 'rapitb', 'kix', 'rapit6'], anchor.arr, anchor.dep - anchor.arr);
          s.anchor = true;
          time = anchor.dep + this.g(kin.Td + kin.Ta + r.range(25, 90));
          continue;
        }
        push(pat, time, this.g(dwell));
        // the same track is used both ways: next arrival only once this one is gone
        const gap = r.range(20, 110) * (1 - 0.4 * rush);
        time += this.g(dwell + kin.Td + kin.Ta + gap);
      }
    }
    // services are sorted by construction
    // headline + return-working info for announcements
    for (let i = 0; i < out.length; i++) out[i].next = out[i + 1] || null;
    return out;
  }

  // Services on a track whose activity window [approachStart, goneAt] contains t
  // (t in "service day" minutes, may exceed 1440 after midnight).
  activeAt(trackId, t) {
    const list = this.byTrack[trackId]; const res = [];
    if (!list) return res;
    // binary search: first service with goneAt >= t
    let lo = 0, hi = list.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid].goneAt < t) lo = mid + 1; else hi = mid; }
    for (let i = lo; i < list.length && list[i].approachStart <= t; i++) res.push(list[i]);
    return res;
  }
  // next n services whose departure is after t
  upcoming(trackId, t, n = 3) {
    const list = this.byTrack[trackId]; if (!list) return [];
    let lo = 0, hi = list.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid].dep < t) lo = mid + 1; else hi = mid; }
    return list.slice(lo, lo + n);
  }
}

// game minutes -> "HH:MM"
export function hhmm(m) {
  m = Math.floor(m + 1e-6);
  m = ((m % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60))}:${String(m % 60).padStart(2, '0')}`;
}
// clock minutes (0..1440) -> service-day minutes (continuous over midnight until 4:00)
export function serviceTime(m) { return m < 240 ? m + 1440 : m; }
