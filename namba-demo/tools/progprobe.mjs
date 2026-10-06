// Perf probe: times ready / first frame, counts programs, logs slow gl.linkProgram/compile calls.
//   node tools/progprobe.mjs [--extra "&..."] [--q high]
import { chromium } from 'playwright';
import { acquireSlot } from './slot.mjs';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => { if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]); return a; }, []));
const port = 8000 + Math.floor(Math.random() * 900);
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 600));
const releaseSlot = await acquireSlot('progprobe');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', m => { const t = m.text(); if (m.type() === 'error' || /\[load\]|\[render\]|\[perf\]/.test(t)) console.log('[page]', t.slice(0, 220)); });
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.addInitScript(() => {
  window.__links = [];
  const wrap = (proto) => {
    const orig = proto.linkProgram;
    proto.linkProgram = function (p) { const t = performance.now(); const r = orig.call(this, p); window.__links.push(performance.now() - t); return r; };
    const ov = proto.getProgramParameter;
    proto.getProgramParameter = function (p, k) { const t = performance.now(); const r = ov.call(this, p, k); const d = performance.now() - t; if (d > 5) window.__links.push(d); return r; };
  };
  wrap(WebGL2RenderingContext.prototype);
});
const t0 = Date.now();
await page.goto(`http://127.0.0.1:${port}/index.html?test&quality=${args.q || 'high'}${args.extra || ''}`);
await page.waitForFunction(() => window.__namba && window.__namba.ready, null, { timeout: 600000, polling: 500 });
const tReady = (Date.now() - t0) / 1000;
console.log('READY', tReady.toFixed(1) + 's');
await page.waitForFunction(() => window.__namba.engine.stats.frame >= 1, null, { timeout: 900000, polling: 500 });
const tFrame = (Date.now() - t0) / 1000;
const info = await page.evaluate(() => { const r = window.__namba.engine.renderer.info; const L = window.__links; return { programs: r.programs.length, links: L.length, linkMs: L.reduce((a, b) => a + b, 0), calls: window.__namba.engine.stats.calls, errs: window.__namba.errors }; });
console.log('FIRST FRAME', tFrame.toFixed(1) + 's', JSON.stringify(info));
await browser.close(); releaseSlot(); server.kill();
