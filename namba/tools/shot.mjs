// Headless screenshot + health check harness.
//
//   node tools/shot.mjs [--views start,walk,canyon] [--out DIR] [--w 1280] [--h 720]
//                       [--q high] [--time 12:30] [--frames 40] [--extra "&nocrowd"]
//                       [--pose "level,x,z,yawDeg,pitchDeg"] [--wait 0]
//
// Views are spawn names from js/world/layout.js (spawns) or explicit poses
// "pose:B1,60,-222,90,0". Prints load time, per-view frame timing, draw calls,
// and any console errors. Screenshots: OUT/<view>.png
// NOTE: SwiftShader (software GL) is ~10-50x slower than a real GPU; use the
// timings only relatively (draw calls & triangle counts are reliable).
import { chromium } from 'playwright';
import { acquireSlot } from './slot.mjs';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
const __dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dir, '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => { if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]); return a; }, []));
const out = path.resolve(args.out || path.join(root, '..', '..', 'namba-shots'));
fs.mkdirSync(out, { recursive: true });
const views = (args.views || 'start').split(',');
const W = +(args.w || 1280), H = +(args.h || 720);
const port = 8000 + Math.floor(Math.random() * 900);
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 600));
const releaseSlot = await acquireSlot(process.argv.slice(2).join(' '));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); if (args.verbose) console.log('[page]', m.text()); });
page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
const q = `?test&quality=${args.q || 'high'}${args.time ? '&time=' + args.time : ''}${args.extra || ''}`;
const t0 = Date.now();
try {
  await page.goto(`http://127.0.0.1:${port}/index.html${q}`);
  await page.waitForFunction(() => window.__namba && window.__namba.ready, null, { timeout: 240000 });
  console.log(`loaded in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const frames = +(args.frames || 30);
  for (const v of views) {
    let pose = v;
    if (v.startsWith('pose:')) { const [lv, x, z, yaw, pitch] = v.slice(5).split(/[,;]/); pose = { level: lv, x: +x, z: +z, yaw: (+yaw || 0) * Math.PI / 180, pitch: (+pitch || 0) * Math.PI / 180 }; }
    const ok = await page.evaluate(p => window.__namba.teleport(p), pose);
    if (!ok) { console.log('unknown view', v); continue; }
    const f0 = await page.evaluate(() => window.__namba.engine.stats.frame);
    const ts = Date.now();
    await page.waitForFunction(n => window.__namba.engine.stats.frame >= n, f0 + frames, { timeout: 600000 });
    const dt = (Date.now() - ts) / frames;
    if (args.wait) await page.waitForTimeout(+args.wait);
    const st = await page.evaluate(() => { const n = window.__namba; const s = n.engine.stats; const p = n.player.body; return { calls: s.calls, tris: s.tris, level: p.level, x: p.x, z: p.z, zone: n.player.zone, errors: n.errors.slice() }; });
    const name = v.replace(/[^a-z0-9_.-]/gi, '_');
    await page.screenshot({ path: path.join(out, name + '.png'), timeout: 180000 });
    console.log(`${v.padEnd(22)} ${dt.toFixed(0)}ms/frame(swiftshader)  calls ${st.calls}  tris ${(st.tris / 1000).toFixed(0)}k  @ ${st.level} ${st.x.toFixed(1)},${st.z.toFixed(1)} ${st.zone}`);
    if (st.errors.length) console.log('  system errors:', st.errors.join(' | '));
  }
} catch (e) { console.log('HARNESS ERROR', e.message); }
if (errors.length) { console.log('--- console errors/warnings (' + errors.length + ') ---'); console.log([...new Set(errors)].slice(0, 30).join('\n')); }
await browser.close();
releaseSlot();
server.kill();
console.log('screenshots in', out);
