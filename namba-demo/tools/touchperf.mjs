// v11 (mobile): draw calls / triangles / crowd at fixed poses — the mobile default (touch emulation, auto quality)
// vs desktop `low` (1280x720, ?quality=low). Same poses, same clock (?test&time=11:20).
//   node tools/touchperf.mjs            (mobile, 844x390)
//   node tools/touchperf.mjs --desktop  (desktop low)
import { chromium, devices } from 'playwright';
import { acquireSlot } from './slot.mjs';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DESK = process.argv.includes('--desktop');
const POSES = [['start', null], ['gate', { level: '3F', x: -20, z: -60, yaw: 0, pitch: 0 }], ['city2F', { level: '2F', x: 10, z: 120, yaw: Math.PI, pitch: 0 }], ['canyon', 'canyon']];
const port = 8000 + Math.floor(Math.random() * 900);
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 600));
const release = await acquireSlot('touchperf');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = DESK ? await browser.newContext({ viewport: { width: 1280, height: 720 } })
  : await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
try {
  await page.goto(`http://127.0.0.1:${port}/index.html?test&noaudio&nogputimer&time=11:20${DESK ? '&quality=low' : ''}`);
  await page.waitForFunction(() => window.__namba && window.__namba.ready && window.__namba.firstFrame, null, { timeout: 900000 });
  const q = await page.evaluate(() => { const e = window.__namba.engine; return { tier: e.qualityName, mobile: !!e.mobile, pr: +e.renderer.getPixelRatio().toFixed(2), crowdMax: e.quality.crowdMax, drawDist: e.quality.drawDist, callBudget: e.quality.callBudget, size: `${innerWidth}x${innerHeight}` }; });
  console.log(DESK ? 'DESKTOP' : 'MOBILE', JSON.stringify(q));
  for (const [name, p] of POSES) {
    await page.evaluate((p) => { const c = window.__namba; c.teleport(p || 'start'); }, p);
    // let the crowd / visibility settle, then average 6 frames
    await page.evaluate(() => new Promise(r => { const f0 = window.__namba.engine.stats.frame; const t = () => window.__namba.engine.stats.frame >= f0 + 8 ? r() : setTimeout(t, 100); t(); }));
    const s = await page.evaluate(() => new Promise(r => { const c = window.__namba, out = []; const f0 = c.engine.stats.frame; let last = f0; const t = () => { const f = c.engine.stats.frame; if (f !== last) { last = f; out.push([c.engine.stats.calls, c.engine.stats.tris]); } if (out.length >= 6) r({ calls: Math.round(out.reduce((a, v) => a + v[0], 0) / out.length), tris: Math.round(out.reduce((a, v) => a + v[1], 0) / out.length), crowd: c.crowd ? c.crowd.count : 0 }); else setTimeout(t, 50); }; t(); }));
    console.log(`  ${name.padEnd(8)} calls ${s.calls}  tris ${(s.tris / 1000).toFixed(0)}k  crowd ${s.crowd}`);
  }
} catch (e) { console.log('HARNESS ERROR', e.message); }
console.log('errors', JSON.stringify(errors.filter(e => !/fonts\.g|ERR_CERT|GL Driver|KHR_parallel/.test(e))));
await browser.close(); release(); server.kill();
