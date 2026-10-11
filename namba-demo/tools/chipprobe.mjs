// v9.1: is the newest message fully visible above the reply chips? (headless doesn't draw the tray reliably, so measure)
//   node tools/chipprobe.mjs
import { chromium } from 'playwright';
import { acquireSlot } from './slot.mjs';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 8000 + Math.floor(Math.random() * 900);
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 600));
const release = await acquireSlot('chipprobe');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
try {
  await page.goto(`http://127.0.0.1:${port}/index.html?test&quality=low&noaudio`);
  await page.waitForFunction(() => window.__namba && window.__namba.ready, null, { timeout: 400000 });
  const measure = () => page.evaluate(() => {
    const r = document.querySelector('.ms-list'), tray = document.querySelector('.ms-replies'), b = [...document.querySelectorAll('.ms-list .ms-b')].pop();
    if (!r || !b) return { none: true };
    const bb = b.getBoundingClientRect(), lr = r.getBoundingClientRect(), tr = tray && tray.getBoundingClientRect();
    return { lastBottom: Math.round(bb.bottom), listBottom: Math.round(lr.bottom), trayTop: tr ? Math.round(tr.top) : null, atBottom: r.scrollHeight - r.scrollTop - r.clientHeight <= 2, hidden: tr ? bb.bottom > tr.top + 1 : false };
  });
  await page.evaluate(() => {
    const p = window.__namba.phone;
    const L = 'Meet me at Tempura Daikichi. Namba Parks, 6F! I\'m already in the queue and it is long today, hurry 🍤';
    for (let i = 0; i < 4; i++) p.message({ id: 'probe' + i, from: 'Aya', text: L, place: i === 3 ? window.__namba.game.demo.biz.slot : undefined });   // a place card (late-loading thumbnail) above the question, as in Zack's screenshot
    p.message({ id: 'probeQ', from: 'Aya', text: 'oh!! can you bring me an iced latte from Café Mitsubachi? Namba CITY 1F, it\'s on your way 🙏 the queue here is forever', replies: [{ id: 'a', text: 'Sure! ☕' }, { id: 'b', text: 'Not today 🙈' }] });
  });
  await page.evaluate(() => window.__namba.phone.open('messages'));   // opened after the texts arrived (onShow path)
  for (const ms of [50, 600, 1500]) { await page.waitForTimeout(ms); console.log(`+${ms}ms`, JSON.stringify(await measure())); }
} catch (e) { console.log('HARNESS ERROR', e.message); }
console.log('errors', JSON.stringify(errors));
await browser.close(); release(); server.kill();
