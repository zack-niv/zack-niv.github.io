// Reports which system the loader is on over time (find slow/hung builds).
//   node tools/loadprobe.mjs [--extra "&nocrowd"] [--max 300]
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => { if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]); return a; }, []));
const port = 8000 + Math.floor(Math.random() * 900);
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 600));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', m => { if (m.type() === 'error') console.log('[err]', m.text().slice(0, 200)); });
page.on('pageerror', e => console.log('[pageerror]', e.message));
page.on('response', r => { if (r.status() >= 400) console.log('[http', r.status() + ']', r.url()); });
const t0 = Date.now();
await page.goto(`http://127.0.0.1:${port}/index.html?test&quality=high${args.extra || ''}`);
let last = '';
for (let i = 0; i < (+(args.max || 300)); i++) {
  const s = await page.evaluate(() => ({ msg: document.querySelector('#loading .ld-msg')?.textContent, ready: !!(window.__namba && window.__namba.ready), errs: window.__namba ? window.__namba.errors.slice() : [] })).catch(() => ({}));
  if (s.msg !== last) { console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s  ${s.msg}`); last = s.msg; }
  if (s.ready) { console.log('READY', ((Date.now() - t0) / 1000).toFixed(1) + 's', s.errs); break; }
  await new Promise(r => setTimeout(r, 1000));
}
await browser.close(); server.kill();
