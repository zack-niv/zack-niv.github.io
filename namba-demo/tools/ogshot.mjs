// Share-card capture: raw game frames for og.jpg (v11).  node tools/ogshot.mjs [outDir] [--poses a,b] [--phone] [--w 1600 --h 840]
// Use --root DIR to serve another copy of the demo, --out DIR for output.
import { chromium } from 'playwright';
import { acquireSlot } from './slot.mjs';
import { spawn } from 'child_process';
import path from 'path'; import fs from 'fs';
import { fileURLToPath } from 'url';
const a = process.argv.slice(2); const opt0 = (k) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : null; };
const root = path.resolve(opt0('root') || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const out = path.resolve(opt0('out') || '/tmp/claude-0/og');
const opt = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : d; };
const poses = opt('poses', 'city_b1,city_1f,walk,nankai_1f').split(',');
const W = +opt('w', 1600), H = +opt('h', 840);
const phone = a.includes('--phone');
fs.mkdirSync(out, { recursive: true });
const port = 9000 + Math.floor(Math.random() * 900);
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 600));
const release = await acquireSlot('ogshot');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
try {
  await page.goto(`http://127.0.0.1:${port}/index.html?test&quality=high&time=12:10`);
  await page.waitForFunction(() => window.__namba && window.__namba.ready, null, { timeout: 300000 });
  for (const p of poses) {
    let pose = p;
    if (p.includes(':')) { const [lv, x, z, yaw, pitch] = p.split(':'); pose = { level: lv, x: +x, z: +z, yaw: +yaw * Math.PI / 180, pitch: (+pitch || 0) * Math.PI / 180 }; }
    await page.evaluate(q => window.__namba.teleport(q), pose);
    if (phone) await page.evaluate(() => window.__namba.phone.open('messages'));
    const f0 = await page.evaluate(() => window.__namba.engine.stats.frame);
    await page.waitForFunction(n => window.__namba.engine.stats.frame >= n, f0 + 60, { timeout: 600000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(out, `raw_${p.replace(/[^a-z0-9]+/gi, '_')}${phone ? '_ph' : ''}.png`), timeout: 180000 });
    console.log('shot', p);
    if (phone) await page.evaluate(() => window.__namba.phone.close());
  }
  console.log('thread', await page.evaluate(() => JSON.stringify((window.__namba.phone.messages.msgs || []).map(m => m.text || '').slice(0, 5))));
} catch (e) { console.log('ERR', e.message); }
console.log('errors', JSON.stringify(errs));
await browser.close(); release(); server.kill();
