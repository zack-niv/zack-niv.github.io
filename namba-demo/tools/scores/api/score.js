import { cors, all, pub, validate, save, ipHash, PER_IP_HOUR, del } from './_lib.js';
export default async function handler(req, res) {
  if (cors(req, res)) return;
  res.setHeader('Cache-Control', 'no-store');
  // owner only: remove an entry (DELETE /api/score?key=<ADMIN_KEY>&name=ABC&score=1234)
  if (req.method === 'DELETE') {
    if (!process.env.ADMIN_KEY || req.query.key !== process.env.ADMIN_KEY) { res.status(403).json({ ok: false, error: 'forbidden' }); return; }
    const rows = (await all()).filter(e => e.name === String(req.query.name || '').toUpperCase() && (!req.query.score || e.score === +req.query.score));
    for (const e of rows) await del(e.pathname);
    res.status(200).json({ ok: true, removed: rows.length }); return;
  }
  if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'method' }); return; }
  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
    const v = validate(body);
    if (typeof v === 'string') { res.status(400).json({ ok: false, error: v }); return; }
    const ip = ipHash(req);
    let rows = await all();
    // the same run posted twice (a retry): answer with its place, store nothing new
    let mine = rows.find(e => e.id === v.id);
    if (!mine) {
      const hour = Date.now() - 3600e3;
      if (rows.filter(e => e.ip === ip && e.at > hour).length >= PER_IP_HOUR) { res.status(429).json({ ok: false, error: 'slow-down' }); return; }
      mine = await save(v, ip);
      rows.push(mine); rows.sort((a, b) => b.score - a.score || a.at - b.at);
    }
    const rank = rows.findIndex(e => e.id === mine.id) + 1;
    res.status(200).json({ ok: true, rank, total: rows.length, top: rows.slice(0, 10).map(pub), you: pub(mine) });
  } catch (e) { res.status(500).json({ ok: false, error: 'store' }); }
}
