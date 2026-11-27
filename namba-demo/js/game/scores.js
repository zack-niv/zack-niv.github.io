// =============================================================================
// v22: the public scoreboard client ("Top scores"). Talks to a tiny separate score service; the base URL is SCORES.url (script.js).
//   fetchScores()  -> Promise<{ ok:true, top, total } | { ok:false, error }>
//   postScore(run) -> Promise<{ ok:true, rank, total, top } | { ok:false, error }>   run = { name, score, t1, t2, coffee, hints, m, id }
// Both promises NEVER reject: any failure (no url, network, CORS, 5 s timeout, bad status, bad JSON, wrong shape) resolves to
// { ok:false, error }. No retries, no credentials, no cookies. The card shows a friendly line on any failure, so the game never depends on this.
// =============================================================================
import { SCORES } from './script.js?v=5442362';

// the deploy stamp, read from this module's own URL (?v=...)
const STAMP = (() => { try { return new URL(import.meta.url).searchParams.get('v') || ''; } catch (e) { return ''; } })();
const TIMEOUT_MS = 5000;

export const hasScores = () => !!(SCORES && typeof SCORES.url === 'string' && SCORES.url.trim());
const base = () => SCORES.url.trim().replace(/\/+$/, '');

// (the server derives seats and score from t1, t2 and coffee: its number is the one stored, and `you` is that row)
// keep only well-formed rows, with a safe short name (the card escapes it again when it draws it)
const clean = (list) => (Array.isArray(list) ? list : []).filter(r => r && isFinite(r.score) && r.score >= 0).slice(0, 10)
  .map(r => ({ name: String(r.name == null ? '' : r.name).replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase() || '???', score: Math.round(+r.score), seats: !!r.seats, coffee: !!r.coffee, at: r.at }));

async function call(path, init) {
  if (!hasScores()) return { ok: false, error: 'no_url' };
  const ac = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => { try { ac && ac.abort(); } catch (e) { /* ignore */ } }, TIMEOUT_MS);
  // belt and braces: if abort is unsupported or the fetch ignores it, still resolve after the timeout
  const guard = new Promise(res => setTimeout(() => res({ ok: false, error: 'timeout' }), TIMEOUT_MS + 300));
  const run = (async () => {
    try {
      const r = await fetch(base() + path, { ...init, mode: 'cors', credentials: 'omit', cache: 'no-store', signal: ac ? ac.signal : undefined });
      if (!r.ok) return { ok: false, error: 'http_' + r.status };
      const j = await r.json();
      return j && typeof j === 'object' ? j : { ok: false, error: 'bad_response' };
    } catch (e) { return { ok: false, error: e && e.name === 'AbortError' ? 'timeout' : 'network' }; }
  })();
  try { return await Promise.race([run, guard]); } catch (e) { return { ok: false, error: 'network' }; } finally { clearTimeout(timer); }
}

export async function fetchScores() {
  try {
    const j = await call('/api/scores', { method: 'GET' });
    if (j.ok === false) return { ok: false, error: j.error || 'failed' };
    if (!Array.isArray(j.top)) return { ok: false, error: 'bad_response' };
    return { ok: true, top: clean(j.top), total: isFinite(j.total) ? +j.total : j.top.length };
  } catch (e) { return { ok: false, error: 'failed' }; }
}

export async function postScore(run) {
  try {
    const body = { name: run.name, score: run.score | 0, t1: run.t1 | 0, t2: run.t2 | 0, coffee: !!run.coffee, hints: run.hints | 0, m: run.m | 0, v: STAMP, id: run.id };
    const j = await call('/api/score', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (j.ok !== true) return { ok: false, error: String(j.error || 'failed').slice(0, 60) };
    if (!isFinite(j.rank) || !isFinite(j.total) || !Array.isArray(j.top)) return { ok: false, error: 'bad_response' };
    return { ok: true, rank: +j.rank, total: +j.total, top: clean(j.top), you: clean([j.you])[0] || null };
  } catch (e) { return { ok: false, error: 'failed' }; }
}
