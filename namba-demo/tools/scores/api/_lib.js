// Lost in Namba score service. One small blob per score; everything the board needs is in the blob's NAME, so a
// listing is the whole database: s/<score 5 digits>_<name>_<seats><coffee>_<seconds>_<ip hash>_<time ms>_<run id>.json
import { put, list, del } from '@vercel/blob';
import { createHash } from 'node:crypto';

const ORIGINS = new Set(['https://zack-niv.github.io', 'http://localhost:8765']);
export const MAX_SCORE = 9600;      // 1000 + 10*420 (train) + 500 + 5*480 (seats) + 1500 (coffee)
const MIN_SCORE = 1000;             // a posted run made the train
const MIN_SECONDS = 100;            // nobody walks both legs faster than this
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
  const score = Math.round(+b.score), s = Math.round(+b.s);
  if (!(score >= MIN_SCORE && score <= MAX_SCORE)) return 'bad-score';
  if (!(s >= MIN_SECONDS && s <= 99999)) return 'bad-time';
  const seats = !!b.seats, coffee = !!b.coffee;
  // the parts must be able to add up: train 1000..5200, seats 0 or 500..2900, coffee 0 or 1500
  const max = 5200 + (seats ? 2900 : 0) + (coffee ? 1500 : 0), min = 1000 + (seats ? 500 : 0) + (coffee ? 1500 : 0);
  if (score > max || score < min) return 'bad-sum';
  const id = String(b.id || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16);
  if (id.length < 4) return 'bad-id';
  return { name, score, s, seats, coffee, id };
}
export async function save(v, ip) {
  const at = Date.now();
  const pathname = `s/${String(v.score).padStart(5, '0')}_${v.name}_${v.seats ? 1 : 0}${v.coffee ? 1 : 0}_${v.s}_${ip}_${at}_${v.id}.json`;
  await put(pathname, JSON.stringify({ ...v, at }), { access: 'public', addRandomSuffix: false, contentType: 'application/json' });
  return { ...v, ip, at, pathname };
}
export { PER_IP_HOUR, del };
