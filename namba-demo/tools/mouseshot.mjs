// v7.3: the mouse-mode chip and the pause menu. Shots: free cursor (camera not steering), pause menu (Esc wording +
// contact cards), backdrop click resumes, phone up with a free cursor.
//   node tools/mouseshot.mjs [outDir]
import { chromium } from 'playwright';
import { acquireSlot } from './slot.mjs';
import { spawn } from 'child_process';
import { forwardPostHog } from './phroute.mjs';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] || path.join(root, '..', '..', 'namba-shots', 'mouse'));
fs.mkdirSync(out, { recursive: true });
const port = 8000 + Math.floor(Math.random() * 900);
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 600));
const release = await acquireSlot('mouseshot');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
const TRACK = !!process.env.TRACK;   // v7.4: also send the analytics events and click a pause-menu contact card
const PH = TRACK ? await forwardPostHog(page) : null;
if (TRACK) page.context().on('page', (p) => p.close().catch(() => {}));
const st = () => page.evaluate(() => { const g = window.__namba.game; return { started: g.started, paused: g.paused, chip: g._chipMode, locked: window.__namba.input.locked, phone: !!(window.__namba.phone && window.__namba.phone.isOpen) }; });
const frames = (n) => page.evaluate(n => new Promise(r => { const f0 = window.__namba.engine.stats.frame; const t = () => window.__namba.engine.stats.frame >= f0 + n ? r() : setTimeout(t, 100); t(); }), n);
try {
  await page.goto(`http://127.0.0.1:${port}/index.html?test&quality=low&noaudio${TRACK ? '&track&r=claude-verify' : ''}`);
  await page.waitForFunction(() => window.__namba && window.__namba.ready, null, { timeout: 300000 });
  await page.evaluate(() => window.__namba.teleport('start'));
  await frames(6);
  console.log('free', JSON.stringify(await st()));
  await page.screenshot({ path: path.join(out, '1-free.png'), timeout: 180000 });
  await page.evaluate(() => window.__namba.game.pause());
  await page.waitForTimeout(600); await frames(2);
  console.log('paused', JSON.stringify(await st()));
  await page.screenshot({ path: path.join(out, '2-pause.png'), timeout: 180000 });
  const links = await page.evaluate(() => [...document.querySelectorAll('.g-pause .e-link')].map(a => [a.textContent.trim().slice(0, 40), a.target, a.rel, a.href.slice(0, 40)]));
  console.log('pause links', JSON.stringify(links));
  if (TRACK) { await page.click('.g-pause a.e-link.agent'); await page.waitForTimeout(800); }
  // click the empty backdrop (bottom-right of the body column): resumes
  await page.mouse.click(1240, 690);
  await page.waitForTimeout(400); await frames(2);
  console.log('after backdrop click', JSON.stringify(await st()));
  await page.evaluate(() => window.__namba.phone.open('maps'));
  await page.waitForTimeout(800); await frames(4);
  console.log('phone', JSON.stringify(await st()));
  await page.screenshot({ path: path.join(out, '3-phone.png'), timeout: 180000 });
} catch (e) { console.log('HARNESS ERROR', e.message); }
if (PH) { await page.waitForTimeout(5000); console.log('PH EVENTS', PH.map(e => e[0]).join(' > ')); }
console.log('errors', JSON.stringify(errors.filter(e => !/fonts\.g|ERR_CERT/.test(e))));
await browser.close(); release(); server.kill();
