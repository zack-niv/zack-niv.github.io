// v11 (mobile): quick look at the game on a touch device. Real touch events only for the inputs it tests.
//   node tools/touchprobe.mjs [outDir] [--w 844 --h 390] [--q "&quality=low"] [--portrait]
// Shots: loading/gate, title, in game (after Begin), phone raised, plus the rotate prompt when --portrait.
import { chromium, devices } from 'playwright';
import { acquireSlot } from './slot.mjs';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const out = path.resolve(argv[0] && !argv[0].startsWith('--') ? argv[0] : path.join(root, '..', '..', 'namba-shots', 'touch'));
fs.mkdirSync(out, { recursive: true });
const W = +arg('w', 844), H = +arg('h', 390);
const port = 8000 + Math.floor(Math.random() * 900);
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 600));
const release = await acquireSlot('touchprobe');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const ctxB = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctxB.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
const T0 = Date.now(); const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(0)}s]`, ...a);
const shot = async (n) => { try { await page.screenshot({ path: path.join(out, n + '.png'), timeout: 240000 }); log('shot', n); } catch (e) { log('SHOT FAIL', n, e.message.split('\n')[0]); } };
const frames = (n) => page.evaluate(n => new Promise(r => { const f0 = window.__namba.engine.stats.frame; const t = () => window.__namba.engine.stats.frame >= f0 + n ? r() : setTimeout(t, 100); t(); }), n).catch(() => {});
try {
  await page.goto(`http://127.0.0.1:${port}/index.html?noaudio${arg('q', '')}`);
  log('media', JSON.stringify(await page.evaluate(() => ({ coarse: matchMedia('(pointer: coarse)').matches, anyFine: matchMedia('(any-pointer: fine)').matches, hoverNone: matchMedia('(hover: none)').matches, dpr: devicePixelRatio, w: innerWidth, h: innerHeight }))));
  await page.waitForTimeout(3000);
  await shot('0-loading');
  await page.waitForFunction(() => window.__namba && window.__namba.ready, null, { timeout: 400000 });
  log('ready', JSON.stringify(await page.evaluate(() => ({ q: window.__namba.engine.qualityName, touch: window.__namba.input.touch, pr: window.__namba.engine.renderer.getPixelRatio() }))));
  const gate = await page.$('.nbl-touch:not([hidden]) .nbl-go');
  if (gate) { await shot('1-gate'); await gate.tap(); log('tapped gate'); }
  await page.waitForSelector('.t-begin', { state: 'visible', timeout: 600000 });
  await page.waitForTimeout(1500); await frames(2);
  await shot('2-title');
  await page.tap('.t-begin');
  log('begin', JSON.stringify(await page.evaluate(() => ({ started: window.__namba.started }))));
  await page.waitForTimeout(6000); await frames(3);
  await shot('3-ingame');
  await page.evaluate(() => window.__namba.phone.open('messages'));
  await page.waitForTimeout(1500); await frames(3);
  await shot('4-phone-messages');
  await page.evaluate(() => window.__namba.phone.open('maps'));
  await page.waitForTimeout(1500); await frames(3);
  await shot('5-phone-maps');
  log('stats', JSON.stringify(await page.evaluate(() => { const s = window.__namba.engine.stats; return { calls: s.calls, tris: s.tris, q: window.__namba.engine.qualityName }; })));
} catch (e) { log('HARNESS ERROR', e.message); }
log('errors', JSON.stringify(errors.filter(e => !/fonts\.g|ERR_CERT/.test(e))));
await browser.close(); release(); server.kill();
