// v11.1 (iOS crash): memory footprint in mobile emulation (iPhone landscape, isMobile + hasTouch, DPR 3).
// Hooks every canvas + WebGL context before the page runs and tallies, per context:
//   textures (texImage2D/texStorage2D/3D/compressed, mip chains, cube faces), buffers (bufferData),
//   renderbuffers, drawing buffers; plus every 2D canvas backing store, and the JS heap (CDP Runtime.getHeapUsage).
// Timeline: READY → Begin → ~30 s play (stick + look) → phone up, Maps → Lodestone install → 3D view → world tour.
//   node tools/memprobe.mjs [--w 852 --h 393 --dpr 3] [--extra "&safe"] [--out DIR] [--desktop] [--notour]
import { chromium, devices } from 'playwright';
import { acquireSlot } from './slot.mjs';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const DESKTOP = argv.includes('--desktop'), NOTOUR = argv.includes('--notour');
const W = +arg('w', DESKTOP ? 1280 : 852), H = +arg('h', DESKTOP ? 720 : 393), DPR = +arg('dpr', DESKTOP ? 1 : 3);
const EXTRA = arg('extra', ''), STOP = arg('stop', '');
const OUT = path.resolve(arg('out', path.join(ROOT, '..', '..', 'namba-shots', 'memprobe')));
fs.mkdirSync(OUT, { recursive: true });

// ---- in-page instrumentation (runs before any page script) ------------------------------------------------------
const HOOK = () => {
  const M = window.__mem = { cv: [], gl: [], tex: new Map(), buf: new Map(), rb: new Map(), events: [] };
  const label = (c) => c.className || c.id || (c.isConnected ? 'dom' : 'offdom');
  // big typed arrays (≥ 128 KB), by creating site; buffers deduped (WeakRef, so only live ones count)
  M.ab = []; const seen = new WeakSet();
  const site = () => (new Error().stack || '').split('\n').slice(3, 6).map(s => s.trim().replace(/^at /, '').replace(/https?:\/\/[^/]+\//, '').replace(/\?v=\w+/, '').replace(/:\d+\)?$/, '')).join(' < ');
  for (const k of ['Float32Array', 'Float64Array', 'Uint8Array', 'Uint8ClampedArray', 'Int8Array', 'Uint16Array', 'Int16Array', 'Uint32Array', 'Int32Array']) {
    const T = window[k];
    window[k] = new Proxy(T, { construct(t, a, nt) { const r = Reflect.construct(t, a, nt === window[k] ? t : nt); try { const b = r.buffer; if (b.byteLength >= 131072 && !seen.has(b)) { seen.add(b); M.ab.push({ ref: new WeakRef(b), site: k + ' ' + site() }); } } catch (e) {} return r; } });
  }
  window.__abReport = () => { const g = {}; let tot = 0; for (const e of M.ab) { const b = e.ref.deref(); if (!b) continue; const n = b.byteLength; tot += n; const q = g[e.site] || (g[e.site] = { n: 0, MB: 0 }); q.n++; q.MB += n / 1048576; } return { totMB: +(tot / 1048576).toFixed(1), top: Object.entries(g).sort((a, b) => b[1].MB - a[1].MB).slice(0, 18).map(([k, v]) => `${v.MB.toFixed(1)} MB ×${v.n}  ${k}`) }; };
  const gc = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, opts) {
    const r = gc.call(this, type, opts);
    if (r && !this.__m) {
      this.__m = { type, opts: opts || {}, stack: (new Error().stack || '').split('\n').slice(2, 5).map(s => s.trim().replace(/^at /, '').replace(/https?:\/\/[^/]+\//, '').replace(/\?v=\w+/, '')).join(' < ') };
      M.cv.push(new WeakRef(this));
      if (/webgl/.test(type)) { r.__cv = this; r.__st = { unit: 0, tex: {}, buf: {}, rb: null }; r.__id = M.gl.length; M.gl.push(new WeakRef(r)); M.events.push({ t: performance.now(), ev: 'glctx', type, cls: label(this), stack: this.__m.stack }); }
    }
    return r;
  };
  if (window.OffscreenCanvas) {
    const og = OffscreenCanvas.prototype.getContext;
    OffscreenCanvas.prototype.getContext = function (type, opts) { const r = og.call(this, type, opts); if (r && !this.__m) { this.__m = { type, off: true, stack: (new Error().stack || '').split('\n').slice(2, 4).join('<') }; M.cv.push(new WeakRef(this)); } return r; };
  }
  const G = WebGL2RenderingContext;
  const BPP = { [G.RGBA8]: 4, [G.SRGB8_ALPHA8]: 4, [G.RGB8]: 4, [G.SRGB8]: 4, [G.R8]: 1, [G.RG8]: 2, [G.R16F]: 2, [G.RG16F]: 4, [G.RGBA16F]: 8, [G.RGB16F]: 8, [G.R32F]: 4, [G.RG32F]: 8, [G.RGBA32F]: 16, [G.RGB32F]: 16, [G.DEPTH_COMPONENT16]: 2, [G.DEPTH_COMPONENT24]: 4, [G.DEPTH24_STENCIL8]: 4, [G.DEPTH_COMPONENT32F]: 4, [G.R11F_G11F_B10F]: 4, [G.RGB10_A2]: 4, [G.R32UI]: 4, [G.RGBA32UI]: 16, [G.RGBA16UI]: 8, [G.R16UI]: 2, [G.RG32UI]: 8, [G.R8UI]: 1, [G.RGBA8UI]: 4, [G.LUMINANCE]: 1, [G.ALPHA]: 1, [G.LUMINANCE_ALPHA]: 2 };
  const CH = { [G.RGBA]: 4, [G.RGB]: 3, [G.RG]: 2, [G.RED]: 1, [G.LUMINANCE]: 1, [G.ALPHA]: 1, [G.LUMINANCE_ALPHA]: 2, [G.RGBA_INTEGER]: 4, [G.RED_INTEGER]: 1, [G.DEPTH_COMPONENT]: 1, [G.DEPTH_STENCIL]: 1 };
  const TS = { [G.UNSIGNED_BYTE]: 1, [G.FLOAT]: 4, [G.HALF_FLOAT]: 2, [G.UNSIGNED_SHORT]: 2, [G.UNSIGNED_INT]: 4, [G.UNSIGNED_INT_24_8]: 4, 0x8D61: 2 };
  const bindTarget = (t) => (t >= G.TEXTURE_CUBE_MAP_POSITIVE_X && t <= G.TEXTURE_CUBE_MAP_NEGATIVE_Z) ? G.TEXTURE_CUBE_MAP : t;
  const cur = (gl, target) => gl.__st && gl.__st.tex[gl.__st.unit + ':' + bindTarget(target)];
  const setTex = (gl, target, level, bytes, w, h, how) => {
    const t = cur(gl, target); if (!t) return;
    let e = M.tex.get(t); if (!e) { e = { gl: gl.__id, parts: {}, w, h, how, born: performance.now() }; M.tex.set(t, e); }
    e.parts[target + ':' + level] = bytes; if (level === 0) { e.w = w; e.h = h; e.how = how; }
  };
  const srcWH = (s) => s ? [s.naturalWidth || s.videoWidth || s.displayWidth || s.width || 0, s.naturalHeight || s.videoHeight || s.displayHeight || s.height || 0] : [0, 0];
  for (const P of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
    const o = {}; for (const k of ['activeTexture', 'bindTexture', 'texImage2D', 'texStorage2D', 'texImage3D', 'texStorage3D', 'compressedTexImage2D', 'generateMipmap', 'deleteTexture', 'bindBuffer', 'bufferData', 'deleteBuffer', 'bindRenderbuffer', 'renderbufferStorage', 'renderbufferStorageMultisample', 'deleteRenderbuffer']) o[k] = P[k];
    P.activeTexture = function (u) { if (this.__st) this.__st.unit = u; return o.activeTexture.call(this, u); };
    P.bindTexture = function (t, x) { if (this.__st) this.__st.tex[this.__st.unit + ':' + t] = x; return o.bindTexture.call(this, t, x); };
    P.texImage2D = function (...a) {
      try {
        const [target, level, ifmt] = a; let w, h, fmt, type;
        if (a.length >= 8) { w = a[3]; h = a[4]; fmt = a[6]; type = a[7]; } else { fmt = a[3]; type = a[4]; [w, h] = srcWH(a[5]); }
        const bpp = BPP[ifmt] || ((CH[fmt] || 4) * (TS[type] || 1));
        setTex(this, target, level, w * h * Math.max(bpp, 1), w, h, a.length >= 8 ? 'data' : (a[5] && a[5].constructor && a[5].constructor.name));
      } catch (e) {}
      return o.texImage2D.apply(this, a);
    };
    if (o.texStorage2D) P.texStorage2D = function (target, levels, ifmt, w, h) {
      try { const bpp = BPP[ifmt] || 4; let tot = 0, x = w, y = h; for (let l = 0; l < levels; l++) { tot += x * y * bpp; x = Math.max(1, x >> 1); y = Math.max(1, y >> 1); } const faces = target === G.TEXTURE_CUBE_MAP ? 6 : 1; const t = cur(this, target); if (t) M.tex.set(t, { gl: this.__id, parts: { s: tot * faces }, w, h, how: 'storage' + (faces > 1 ? '-cube' : '') + ' L' + levels, born: performance.now() }); } catch (e) {}
      return o.texStorage2D.call(this, target, levels, ifmt, w, h);
    };
    if (o.texStorage3D) P.texStorage3D = function (target, levels, ifmt, w, h, d) {
      try { const bpp = BPP[ifmt] || 4; let tot = 0, x = w, y = h; for (let l = 0; l < levels; l++) { tot += x * y * d * bpp; x = Math.max(1, x >> 1); y = Math.max(1, y >> 1); } const t = cur(this, target); if (t) M.tex.set(t, { gl: this.__id, parts: { s: tot }, w, h: h * d, how: 'storage3d', born: performance.now() }); } catch (e) {}
      return o.texStorage3D.call(this, target, levels, ifmt, w, h, d);
    };
    if (o.texImage3D) P.texImage3D = function (...a) {
      try { const [target, level, ifmt, w, h, d] = a; const bpp = BPP[ifmt] || ((CH[a[7]] || 4) * (TS[a[8]] || 1)); setTex(this, target, level, w * h * d * bpp, w, h * d, 'img3d'); } catch (e) {}
      return o.texImage3D.apply(this, a);
    };
    P.compressedTexImage2D = function (...a) { try { const d = a[a.length - 1]; setTex(this, a[0], a[1], d && d.byteLength || 0, a[3], a[4], 'compressed'); } catch (e) {} return o.compressedTexImage2D.apply(this, a); };
    P.generateMipmap = function (target) { try { const t = cur(this, target); const e = t && M.tex.get(t); if (e) { const base = Object.entries(e.parts).filter(([k]) => k.endsWith(':0')).reduce((s, [, v]) => s + v, 0); e.parts.mip = base / 3; } } catch (e) {} return o.generateMipmap.call(this, target); };
    P.deleteTexture = function (t) { M.tex.delete(t); return o.deleteTexture.call(this, t); };
    P.bindBuffer = function (t, b) { if (this.__st) this.__st.buf[t] = b; return o.bindBuffer.call(this, t, b); };
    P.bufferData = function (t, d, u, ...rest) { try { const b = this.__st && this.__st.buf[t]; if (b) M.buf.set(b, { gl: this.__id, bytes: typeof d === 'number' ? d : (d && d.byteLength) || 0 }); } catch (e) {} return o.bufferData.call(this, t, d, u, ...rest); };
    P.deleteBuffer = function (b) { M.buf.delete(b); return o.deleteBuffer.call(this, b); };
    P.bindRenderbuffer = function (t, r) { if (this.__st) this.__st.rb = r; return o.bindRenderbuffer.call(this, t, r); };
    P.renderbufferStorage = function (t, f, w, h) { try { const r = this.__st && this.__st.rb; if (r) M.rb.set(r, { gl: this.__id, bytes: w * h * (BPP[f] || 4) }); } catch (e) {} return o.renderbufferStorage.call(this, t, f, w, h); };
    if (o.renderbufferStorageMultisample) P.renderbufferStorageMultisample = function (t, s, f, w, h) { try { const r = this.__st && this.__st.rb; if (r) M.rb.set(r, { gl: this.__id, bytes: w * h * (BPP[f] || 4) * Math.max(1, s) }); } catch (e) {} return o.renderbufferStorageMultisample.call(this, t, s, f, w, h); };
    P.deleteRenderbuffer = function (r) { M.rb.delete(r); return o.deleteRenderbuffer.call(this, r); };
  }
  window.__memReport = () => {
    const MB = (b) => +(b / 1048576).toFixed(1);
    const cvs = M.cv.map(r => r.deref()).filter(Boolean);
    const c2d = cvs.filter(c => !/webgl/.test(c.__m.type));
    const gls = M.gl.map(r => r.deref()).filter(Boolean);
    const glInfo = gls.map(gl => {
      const c = gl.__cv, lost = gl.isContextLost(), o = gl.getContextAttributes() || {};
      const px = c.width * c.height, aa = o.antialias ? 4 : 1;
      const draw = lost ? 0 : px * (4 * aa + (o.depth ? 4 * aa : 0) + (o.antialias ? 4 : 0) + (o.preserveDrawingBuffer ? 4 : 0) + 4);   // + 1 display buffer
      let tex = 0, n = 0, buf = 0, rb = 0;
      for (const e of M.tex.values()) if (e.gl === gl.__id) { tex += Object.values(e.parts).reduce((s, v) => s + v, 0); n++; }
      for (const e of M.buf.values()) if (e.gl === gl.__id) buf += e.bytes;
      for (const e of M.rb.values()) if (e.gl === gl.__id) rb += e.bytes;
      return { id: gl.__id, cls: c.className || c.id || '?', size: `${c.width}x${c.height}`, lost, aa: !!o.antialias, drawMB: MB(draw), texMB: MB(tex), texN: n, bufMB: MB(buf), rbMB: MB(rb), stack: c.__m.stack.slice(0, 120) };
    });
    // the 2D canvases: group by creating site
    const groups = {};
    let c2dBytes = 0;
    for (const c of c2d) { const b = c.width * c.height * 4; c2dBytes += b; const k = c.__m.stack.split(' < ')[0].replace(/:\d+$/, ''); const gq = groups[k] || (groups[k] = { n: 0, bytes: 0, max: '' }); gq.n++; gq.bytes += b; if (!gq.maxB || b > gq.maxB) { gq.maxB = b; gq.max = `${c.width}x${c.height}`; } }
    const top2d = Object.entries(groups).sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 10).map(([k, v]) => ({ site: k, n: v.n, MB: MB(v.bytes), max: v.max }));
    // top textures
    const texList = [...M.tex.entries()].map(([t, e]) => ({ gl: e.gl, w: e.w, h: e.h, how: e.how, bytes: Object.values(e.parts).reduce((s, v) => s + v, 0) })).sort((a, b) => b.bytes - a.bytes);
    const texBySize = {};
    for (const t of texList) { const k = `gl${t.gl} ${t.w}x${t.h} ${t.how}`; const e = texBySize[k] || (texBySize[k] = { n: 0, MB: 0 }); e.n++; e.MB += t.bytes / 1048576; }
    const topTex = Object.entries(texBySize).sort((a, b) => b[1].MB - a[1].MB).slice(0, 14).map(([k, v]) => `${k} ×${v.n} = ${v.MB.toFixed(1)} MB`);
    const ctx = window.__namba, info = ctx && ctx.engine && ctx.engine.renderer.info;
    let app = null;
    try { const fs = ctx.crowd && ctx.crowd.sim && ctx.crowd.sim.fields; const nf = ctx.nav && ctx.nav.fields; let navB = 0; if (nf) for (const f of nf.values()) navB += (f && f.byteLength) || (f && f.dist && f.dist.byteLength) || 0; let crB = 0, live = 0; if (fs) for (const e of fs.entries.values()) { crB += (e.dist && e.dist.byteLength) || 0; if (e.refs > 0) live++; } app = { N: ctx.nav && ctx.nav.N, navFields: nf ? nf.size : null, navFieldsMB: MB(navB), crowdFields: fs ? fs.entries.size : null, crowdLive: live, crowdMax: fs ? fs.maxFields : null, crowdFieldsMB: MB(crB), progs: info && info.programs ? info.programs.length : null }; } catch (e) { app = { err: e.message }; }
    return { app, c2dN: c2d.length, c2dMB: MB(c2dBytes), glN: gls.filter(g => !g.isContextLost()).length, gl: glInfo, top2d, topTex, three: info ? { tex: info.memory.textures, geo: info.memory.geometries, progs: info.programs ? info.programs.length : 0 } : null, crowd: ctx && ctx.crowd ? ctx.crowd.count : null, q: ctx && ctx.engine ? ctx.engine.qualityName : null, pr: ctx && ctx.engine ? +ctx.engine.renderer.getPixelRatio().toFixed(2) : null };
  };
};

const port = 8000 + Math.floor(Math.random() * 900);
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 600));
const release = await acquireSlot('memprobe');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
const bctx = DESKTOP ? await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR })
  : await browser.newContext({ ...devices['iPhone 13'], viewport: { width: W, height: H }, screen: { width: W, height: H }, deviceScaleFactor: DPR, isMobile: true, hasTouch: true });
await bctx.addInitScript(HOOK);
const page = await bctx.newPage();
const cdp = await bctx.newCDPSession(page);
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
const T0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(0)}s]`, ...a);
const shot = async (n) => { try { await page.screenshot({ path: `${OUT}/${n}.png`, timeout: 240000 }); log('shot', n); } catch (e) { log('SHOT FAIL', n, e.message.split('\n')[0]); } };
const settle = async (n = 2) => { try { const f0 = await page.evaluate(() => window.__namba.engine.stats.frame); await page.waitForFunction(k => window.__namba.engine.stats.frame >= k, f0 + n, { timeout: 240000 }); } catch (e) { log('settle timeout'); } };
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id, radiusX: 8, radiusY: 8, force: 1 })) });
const rect = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && cs.visibility !== 'hidden' && +cs.opacity > 0.05 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; }, sel);
const tapSel = async (sel, label) => { const r = await rect(sel); if (!r) { log('TAP MISS', label || sel); return false; } if (DESKTOP) await page.mouse.click(r.x, r.y); else await page.touchscreen.tap(r.x, r.y); log('tap', label || sel); return true; };
const step = (secs, dt = 0.05) => page.evaluate(([secs, dt]) => {
  const c = window.__namba; const n = Math.round(secs / dt);
  for (let i = 0; i < n; i++) { c.input.update(); c.clock.update(dt); for (const { sys } of c.systems) if (sys.update) { try { sys.update(dt); } catch (e) { console.error('step', e.message); } } for (const { sys } of c.systems) if (sys.lateUpdate) { try { sys.lateUpdate(dt); } catch (e) {} } c.input.endFrame(); }
}, [secs, dt]);
const rows = [];
const measure = async (stage) => {
  try { await page.evaluate(() => window.gc && window.gc()); } catch (e) {}
  const r = await page.evaluate(() => window.__memReport());
  const hu = await cdp.send('Runtime.getHeapUsage').catch(() => ({}));
  const pm = await page.evaluate(() => performance.memory ? { used: performance.memory.usedJSHeapSize } : {});
  const glTex = r.gl.reduce((s, g) => s + g.texMB, 0), glBuf = r.gl.reduce((s, g) => s + g.bufMB, 0), glDraw = r.gl.reduce((s, g) => s + g.drawMB + g.rbMB, 0);
  const row = { stage, fieldsMB: r.app ? +((r.app.navFieldsMB || 0) + (r.app.crowdFieldsMB || 0)).toFixed(1) : null, c2dN: r.c2dN, c2dMB: r.c2dMB, glN: r.glN, texMB: +glTex.toFixed(1), bufMB: +glBuf.toFixed(1), drawMB: +glDraw.toFixed(1), heapMB: +((hu.usedSize || pm.used || 0) / 1048576).toFixed(1), extMB: hu.backingStorageSize != null ? +(hu.backingStorageSize / 1048576).toFixed(1) : null, total: 0, crowd: r.crowd, q: r.q, pr: r.pr };
  row.total = +(row.c2dMB + row.texMB + row.bufMB + row.drawMB).toFixed(1);
  rows.push(row);
  log('MEM', stage, JSON.stringify(row));
  log('  gl', JSON.stringify(r.gl));
  log('  2d', JSON.stringify(r.top2d));
  log('  tex', JSON.stringify(r.topTex));
  log('  app', JSON.stringify(r.app));
  if (argv.includes('--ab')) log('  arraybuffers', JSON.stringify(await page.evaluate(() => window.__abReport()), null, 1));
  if (STOP && stage.startsWith(STOP)) throw new Error('stop after ' + stage);
  return r;
};
try {
  await page.goto(`http://127.0.0.1:${port}/index.html?noaudio${EXTRA}`);
  await page.waitForFunction(() => window.__namba && window.__namba.ready, null, { timeout: 600000 });
  await page.waitForSelector('.t-begin', { state: 'visible', timeout: 600000 });
  await page.waitForTimeout(1000); await settle(2);
  await measure('1 title');
  await shot('1-title');
  await tapSel('.t-begin', 'Begin');
  await page.waitForTimeout(500); await step(2); await settle(3);
  await measure('2 begin');
  await shot('2-begin');
  // ~30 s of play: stick forward + look swipes; real frames between
  for (let k = 0; k < 6; k++) {
    if (!DESKTOP) {
      await touch('touchStart', [[150, H - 120, 1]]);
      for (let i = 1; i <= 6; i++) { await touch('touchMove', [[150, H - 120 - i * 10, 1]]); await page.waitForTimeout(16); }
      await step(4); await touch('touchEnd', []);
      await touch('touchStart', [[W * 0.75, H * 0.45, 2]]); for (let i = 1; i <= 8; i++) { await touch('touchMove', [[W * 0.75 - i * 12, H * 0.45, 2]]); await page.waitForTimeout(16); } await touch('touchEnd', []);
    } else { await page.evaluate(() => window.__namba.input.setScript({ x: 0, y: 1 })); await step(4); await page.evaluate(() => { window.__namba.input.setScript(null); window.__namba.player.yaw += 0.6; }); }
    await step(1); await settle(2);
  }
  await measure('3 play 30s');
  await shot('3-play');
  // phone up → Maps
  const phoneBtn = DESKTOP ? null : '#touch-ui .tu-phone';
  if (phoneBtn) await tapSel(phoneBtn, 'phone'); else await page.keyboard.press('KeyQ');
  await step(1.2); await settle(2);
  await measure('4 phone up');
  await tapSel('.ph-dock [data-app="maps"]', 'Maps');
  await step(1.5); await settle(3); await page.waitForTimeout(500);
  // pick a place so the route draws (bakes the destination floor too)
  if (!(await tapSel('.ph-view[data-v="maps"] .dl-next', 'Next'))) await tapSel('.ph-view[data-v="maps"] .dl-r', 'first place');
  await step(1.5); await settle(3);
  await measure('5 maps');
  await shot('5-maps');
  // Lodestone: install directly (as the Get card does), wait for ready, then the 3D view
  await page.evaluate(() => window.__namba.phone.installLodestone());
  for (let i = 0; i < 60; i++) { await step(0.5); if (await page.evaluate(() => window.__namba.phone.upgradeStage === 'ready')) break; }
  await step(4); await settle(3); await page.waitForTimeout(400);
  await measure('6 lodestone');
  await shot('6-lodestone');
  if (await tapSel('.ld-x3d', '3D view')) { await step(1.5); await settle(3); await page.waitForTimeout(400); }
  await measure('7 lodestone 3D');
  await shot('7-lodestone-3d');
  if (!NOTOUR) {
    if (phoneBtn) await tapSel(phoneBtn, 'phone (lower)'); else await page.keyboard.press('KeyQ');
    await step(1);
    for (const [n, p] of [['gate', { level: '3F', x: -20, z: -60, yaw: 0, pitch: 0 }], ['city2F', { level: '2F', x: 10, z: 120, yaw: Math.PI, pitch: 0 }], ['canyon', 'canyon'], ['parks4F', { level: '4F', x: 12, z: 260, yaw: 0, pitch: 0 }]]) {
      await page.evaluate((p) => window.__namba.teleport(p), p); await step(2); await settle(3);
      await shot('8-' + n);
    }
    await measure('8 world tour');
  }
} catch (e) { log('HARNESS ERROR', e.stack); }
console.log('\nstage | 2D canvases (n / MB) | GL ctx | textures MB | buffers MB | draw+rb MB | canvas+GPU total MB | JS heap MB | ArrayBuffers MB | of which flow fields MB | crowd');
for (const r of rows) console.log(`${r.stage} | ${r.c2dN} / ${r.c2dMB} | ${r.glN} | ${r.texMB} | ${r.bufMB} | ${r.drawMB} | **${r.total}** | ${r.heapMB} | ${r.extMB} | ${r.fieldsMB} | ${r.crowd}`);
const ce = await page.evaluate(() => window.__namba && window.__namba.errors).catch(() => null);
log('ctx.errors', JSON.stringify(ce));
log('errors', JSON.stringify(errors.filter(e => !/fonts\.g|ERR_CERT|GL Driver|KHR_parallel/.test(e))));
fs.writeFileSync(`${OUT}/mem.json`, JSON.stringify(rows, null, 1));
await browser.close(); release(); server.kill();
