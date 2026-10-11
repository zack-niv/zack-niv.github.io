// Share-card capture (v11): clean first-person frames (HUD hidden, crowd warmed up) + the real phone UI, for og.jpg.
//   node tools/ogshot.mjs --out DIR [--root DIR] [--poses city_b1,nankai_2f | 2F:x:z:yawDeg:pitchDeg] [--w 1200 --h 630] [--frames 10] [--warm 160] [--phone POSE]
// --root serves another copy of the demo (e.g. a git-archive of a release). Compose with tools/ogcard.mjs.
import { chromium } from 'playwright';
import { acquireSlot } from './slot.mjs';
import { spawn } from 'child_process';
import path from 'path'; import fs from 'fs';
import { fileURLToPath } from 'url';
const a = process.argv.slice(2);
const opt = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : d; };
const root = path.resolve(opt('root', path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')));
const out = path.resolve(opt('out', '/tmp/claude-0/og'));
const poses = opt('poses', 'city_b1').split(',').filter(Boolean);
const W = +opt('w', 1200), H = +opt('h', 630), FR = +opt('frames', 10), WARM = +opt('warm', 160);
const phonePose = opt('phone', null);
fs.mkdirSync(out, { recursive: true });
const port = 9000 + Math.floor(Math.random() * 900);
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 600));
const release = await acquireSlot('ogshot');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
const toPose = p => { if (!p.includes(':')) return p; const [lv, x, z, yaw, pitch] = p.split(':'); return { level: lv, x: +x, z: +z, yaw: +yaw * Math.PI / 180, pitch: (+pitch || 0) * Math.PI / 180 }; };
const frames = async n => { const f0 = await page.evaluate(() => window.__namba.engine.stats.frame); await page.waitForFunction(k => window.__namba.engine.stats.frame >= k, f0 + n, { timeout: 1500000 }); };
const warm = () => page.evaluate((n) => { const c = window.__namba.crowd; if (!c || !c.sim) return -1; for (let i = 0; i < n; i++) { c._dt = 0.1; c._viewer(); c.sim.update(0.1); } return c.sim.count; }, WARM);
try {
  await page.goto(`http://127.0.0.1:${port}/index.html?test&quality=high&time=12:10`);
  await page.waitForFunction(() => window.__namba && window.__namba.ready, null, { timeout: 900000 });
  await page.addStyleTag({ content: '#hud,#phone-root,#overlay{display:none!important}' });
  for (const p of poses) {
    await page.evaluate(q => window.__namba.teleport(q), toPose(p));
    const n = await warm();
    await frames(FR); await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(out, `raw_${p.replace(/[^a-z0-9]+/gi, '_')}.png`), timeout: 180000 });
    console.log('shot', p, 'crowd', n);
  }
  if (phonePose) {
    await page.addStyleTag({ content: '#phone-root{display:block!important}' });
    await page.evaluate(q => window.__namba.teleport(q), toPose(phonePose));
    await page.evaluate(() => { const ph = window.__namba.phone; ph.message({ id: 'meet_og', from: 'Aya', text: 'Meet me at Tempura Daikichi. Namba Parks, 6F! I’m already in the queue \u{1F364}', time: '11:20', place: 'parks_6Fdw03' }); ph.open('messages'); });
    await frames(8); await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(out, 'phone_full.png'), timeout: 180000 });
    const el = await page.$('.ph-device'); if (el) await el.screenshot({ path: path.join(out, 'phone_dev.png'), timeout: 180000 });
    console.log('thread', await page.evaluate(() => (window.__namba.phone.messages.msgs || []).map(m => m.text || '').join(' | ')));
  }
} catch (e) { console.log('ERR', e.message); }
console.log('errors', JSON.stringify(errs));
await browser.close(); release(); server.kill();
