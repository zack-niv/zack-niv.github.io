// Load timeline + per-view draw calls / triangles / screenshots in ONE browser session.
//   node tools/perfshot.mjs [--root DIR] [--views start,nankai_2f,...] [--frames 6] [--out DIR] [--q high] [--extra "&x"] [--w 1280 --h 720]
// --root lets you run the same probe against a saved copy of the game (before/after comparisons).
import { chromium } from 'playwright';
import { acquireSlot } from './slot.mjs';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => { if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]); return a; }, []));
const root = path.resolve(args.root || here);
const out = path.resolve(args.out || '/tmp/perfshot');
fs.mkdirSync(out, { recursive: true });
const views = (args.views || 'start,nankai_2f,city_2f,canyon,parks_6f').split(',');
const frames = +(args.frames || 6);
const port = 8000 + Math.floor(Math.random() * 900);
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 600));
const releaseSlot = await acquireSlot('perfshot ' + path.basename(root));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: +(args.w || 1280), height: +(args.h || 720) } });
const errors = [];
page.on('console', m => { const t = m.text(); if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${t}`); if (/\[load\]|\[render\] (precompile|background|post|vis)/.test(t)) console.log('  [page]', t.slice(0, 200)); });
page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
const t0 = Date.now();
const T = () => ((Date.now() - t0) / 1000).toFixed(1) + 's';
try {
  await page.goto(`http://127.0.0.1:${port}/index.html?test&quality=${args.q || 'high'}${args.extra || ''}`);
  await page.waitForFunction(() => window.__namba && window.__namba.ready, null, { timeout: 900000, polling: 500 });
  console.log('READY (ctx.ready)', T());
  await page.waitForFunction(() => window.__namba.engine.stats.frame >= 1, null, { timeout: 900000, polling: 500 });
  console.log('FIRST FRAME done', T());
  const info = await page.evaluate(() => { const n = window.__namba; const p = n.engine.renderer.info.programs; return { programs: p.length, lt: n.loadTimes }; });
  console.log('programs after first frame:', info.programs, ' system times(ms):', JSON.stringify(info.lt));
  if (args.dump) {
    const progs = await page.evaluate(() => window.__namba.engine.renderer.info.programs.map(p => ({ n: p.name, ck: (p.cacheKey || '').replace(/\s+/g, ' ').slice(0, 260) })));
    const by = {}; for (const p of progs) by[p.n] = (by[p.n] || 0) + 1;
    console.log('PROGRAMS by name', JSON.stringify(by));
    for (const p of progs) console.log('   ', p.n, '|', p.ck);
  }
  console.log(`${'view'.padEnd(14)} ${'ms/frame*'.padStart(10)} ${'calls'.padStart(6)} ${'tris'.padStart(8)}  level  programs`);
  for (const v of views) {
    let pose = v;
    if (v.startsWith('pose:')) { const [lv, x, z, yaw, pitch] = v.slice(5).split(/[,;]/); pose = { level: lv, x: +x, z: +z, yaw: (+yaw || 0) * Math.PI / 180, pitch: (+pitch || 0) * Math.PI / 180 }; }
    const ok = await page.evaluate(p => window.__namba.teleport(p), pose);
    if (!ok) { console.log('unknown view', v); continue; }
    const f0 = await page.evaluate(() => window.__namba.engine.stats.frame);
    const ts = Date.now();
    await page.waitForFunction(n => window.__namba.engine.stats.frame >= n, f0 + frames, { timeout: 900000, polling: 250 });
    const dt = (Date.now() - ts) / frames;
    const st = await page.evaluate(() => { const n = window.__namba; const s = n.engine.stats; const p = n.player.body; const vis = n.visibility; return { calls: s.calls, tris: s.tris, level: p.level, progs: n.engine.renderer.info.programs.length, errors: n.errors.slice(), chunks: vis ? `${vis.stats.shown}/${vis.stats.total}` : '' }; });
    await page.screenshot({ path: path.join(out, v.replace(/[^a-z0-9_.-]/gi, '_') + '.png'), timeout: 180000 });
    console.log(`${v.padEnd(14)} ${dt.toFixed(0).padStart(10)} ${String(st.calls).padStart(6)} ${(st.tris / 1000).toFixed(0).padStart(7)}k  ${st.level.padEnd(5)}  ${st.progs}  chunks ${st.chunks}`);
    if (st.errors.length) console.log('  system errors:', st.errors.join(' | '));
  }
  console.log('TOTAL', T());
} catch (e) { console.log('HARNESS ERROR', e.message); }
const uniq = [...new Set(errors)].filter(e => !/ERR_CERT|GL Driver|GPU stall/.test(e));
console.log(uniq.length ? '--- console errors/warnings ---\n' + uniq.slice(0, 20).join('\n') : 'console: clean');
await browser.close(); releaseSlot(); server.kill();
console.log('screenshots in', out);
