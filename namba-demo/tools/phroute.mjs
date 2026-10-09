// Test helper (v7.4): let a headless page's PostHog traffic through the sandbox proxy. Chromium can't use the proxy's
// TLS here, so every *.posthog.com request is replayed with curl (which can) and the reply handed back to the page.
// Logs each captured event name. Use with ?track (analytics is off on localhost / in tests otherwise).
//   import { forwardPostHog } from './phroute.mjs'; const seen = await forwardPostHog(page, log);
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';

export async function forwardPostHog(page, log = console.log) {
  const seen = [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'phr-'));
  await page.route(/posthog\.com\//, async (route) => {
    const req = route.request(), url = req.url();
    try {
      const body = req.postDataBuffer();
      const args = ['-sS', '-X', req.method(), '-o', path.join(tmp, 'out'), '-w', '%{http_code}', '-D', path.join(tmp, 'hdr')];
      if (body) {
        fs.writeFileSync(path.join(tmp, 'in'), body);
        args.push('--data-binary', '@' + path.join(tmp, 'in'), '-H', 'Content-Type: ' + (req.headers()['content-type'] || 'application/json'));
        let txt = null;
        try { txt = body[0] === 0x1f && body[1] === 0x8b ? zlib.gunzipSync(body).toString() : body.toString(); } catch (e) { txt = null; }
        if (txt) {
          try {
            const j = JSON.parse(txt.startsWith('data=') ? decodeURIComponent(txt.slice(5)) : txt);
            for (const e of (Array.isArray(j) ? j : j.batch || [j])) if (e && e.event) { seen.push([e.event, e.properties || {}]); log('PH', e.event, JSON.stringify(Object.fromEntries(Object.entries(e.properties || {}).filter(([k]) => !k.startsWith('$')))).slice(0, 220)); }
          } catch (e) { /* not an event batch */ }
        }
      }
      args.push(url);
      const code = +execFileSync('curl', args, { encoding: 'utf8', timeout: 30000 });
      const hdr = fs.readFileSync(path.join(tmp, 'hdr'), 'utf8');
      const ct = (/content-type:\s*([^\r\n]+)/i.exec(hdr) || [])[1] || 'application/json';
      await route.fulfill({ status: code || 502, contentType: ct, body: fs.readFileSync(path.join(tmp, 'out')), headers: { 'access-control-allow-origin': '*' } });
    } catch (e) { log('PH route fail', url.slice(0, 80), e.message.split('\n')[0]); await route.abort(); }
  });
  return seen;
}
