import { cors, all, pub } from './_lib.js';
export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'GET') { res.status(405).json({ ok: false, error: 'method' }); return; }
  try {
    const rows = await all();
    res.setHeader('Cache-Control', 'public, s-maxage=3, stale-while-revalidate=15');
    res.status(200).json({ top: rows.slice(0, 10).map(pub), total: rows.length });
  } catch (e) { res.status(500).json({ ok: false, error: 'store' }); }
}
