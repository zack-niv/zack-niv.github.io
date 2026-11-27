// Lost in Namba score service. One small blob per score; everything the board needs is in the blob's NAME, so a
// listing is the whole database: s/<score 5 digits>_<name>_<seats><coffee>_<seconds>_<ip hash>_<time ms>_<run id>.json
import { put, list, del } from '@vercel/blob';
import { createHash } from 'node:crypto';

const ORIGINS = new Set(['https://zack-niv.github.io', 'http://localhost:8765']);
// v22 scoring, the same rule as the game's js/game/mission.js (keep the two in step): 10,000 at the start, minus 1 point
// per tenth of a second over both legs, +1,000 for the counter seats (leg 1 within SEATS_T), +1,500 for the coffee, floor
// 500. Only runs that made the train (leg 2 within TRAIN_T) are posted. The SERVER computes the score from the two leg
// times and the coffee flag; a score sent by the browser is ignored.
const SEATS_T = 4800, TRAIN_T = 4200;   // tenths of a second (DEMO.seatsS 480, DEMO.trainS 420)
const MIN_T1 = 600, MIN_T2 = 400;       // nobody walks leg 1 in under a minute or leg 2 in under 40 s
const MAX_T1 = 36000;                   // an hour: past that it is not a run any more
export const scoreOf = (t1, t2, coffee) => Math.max(500, 10000 - t1 - t2 + (t1 <= SEATS_T ? 1000 : 0) + (coffee ? 1500 : 0));
const PER_IP_HOUR = 12;
const BLOCK = new Set(['ASS', 'FUK', 'FUC', 'FCK', 'FUX', 'SEX', 'CUM', 'FAG', 'NIG', 'NGR', 'KKK', 'TIT', 'DIK', 'DIC', 'DCK', 'COK', 'COC', 'PIS', 'SHT', 'CNT', 'KUM', 'JIZ', 'WTF', 'SUK', 'SUC', 'NAZ', 'SS1', 'HH8', '666', 'GAY', 'HOE', 'VAG', 'PUS', 'RAP', 'KYS']);

export function cors(req, res) {
  const o = req.headers.origin || '';
  if (ORIGINS.has(o)) res.setHeader('Access-Control-Allow-Origin', o);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  return false;
}
export const ipHash = (req) => createHash('sha256').update(String((req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'x') + '|namba').digest('hex').slice(0, 8);

const parse = (pathname) => {
  const m = /^s\/(\d{5})_([A-Z0-9]{3})_([01])([01])_(\d{1,5})_([0-9a-f]{8})_(\d{10,14})_([a-z0-9]{4,16})\.json$/.exec(pathname);
  return m ? { score: +m[1], name: m[2], seats: m[3] === '1', coffee: m[4] === '1', s: +m[5], ip: m[6], at: +m[7], id: m[8], pathname } : null;
};
export async function all() {
  const out = []; let cursor;
  for (let page = 0; page < 8; page++) {
    const r = await list({ prefix: 's/', limit: 1000, cursor });
    for (const b of r.blobs) { const e = parse(b.pathname); if (e) out.push(e); }
    if (!r.hasMore) break; cursor = r.cursor;
  }
  // highest score first; ties: the earlier run keeps the higher place
  out.sort((a, b) => b.score - a.score || a.at - b.at);
  return out;
}
export const pub = (e) => ({ name: e.name, score: e.score, seats: e.seats, coffee: e.coffee, at: e.at });

export function validate(b) {
  if (!b || typeof b !== 'object') return 'bad-body';
  const name = String(b.name || '').toUpperCase();
  if (!/^[A-Z0-9]{3}$/.test(name)) return 'bad-name';
  if (BLOCK.has(name)) return 'name-taken';
  const t1 = Math.round(+b.t1), t2 = Math.round(+b.t2);
  if (!(t1 >= MIN_T1 && t1 <= MAX_T1)) return 'bad-time';
  if (!(t2 >= MIN_T2 && t2 <= TRAIN_T)) return 'bad-time';
  const coffee = !!b.coffee, seats = t1 <= SEATS_T;
  const id = String(b.id || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16);
  if (id.length < 4) return 'bad-id';
  return { name, score: scoreOf(t1, t2, coffee), s: Math.round((t1 + t2) / 10), seats, coffee, id };
}
export async function save(v, ip) {
  const at = Date.now();
  const pathname = `s/${String(v.score).padStart(5, '0')}_${v.name}_${v.seats ? 1 : 0}${v.coffee ? 1 : 0}_${v.s}_${ip}_${at}_${v.id}.json`;
  await put(pathname, JSON.stringify({ ...v, at }), { access: 'public', addRandomSuffix: false, contentType: 'application/json' });
  return { ...v, ip, at, pathname };
}
export { PER_IP_HOUR, del };
