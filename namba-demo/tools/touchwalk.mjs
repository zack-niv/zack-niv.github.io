// v11 (mobile): a touch-only playthrough in mobile emulation (isMobile + hasTouch, landscape).
// Every DECISION is a real touch (CDP Input.dispatchTouchEvent / page.touchscreen.tap at an element's centre):
//   Begin · drag-look · the floating stick (walk) · the phone button · reply chips · the Maps dock · a place pick ·
//   the Use button at the gate · the Lodestone link card · 3D view · the end card.
// Long walking legs follow the route like tools/walk.mjs does (setScript) — SwiftShader is far too slow to steer a
// whole route frame by frame with a thumb — but nothing is ever "used" through the API: no onUse(), no reply(), no
// keyboard.
//   node tools/touchwalk.mjs [--w 844 --h 390] [--out DIR] [--full]   (--full walks on to Daikichi + the end card)
import { chromium, devices } from 'playwright';
import { acquireSlot } from './slot.mjs';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const FULL = argv.includes('--full');
const W = +arg('w', 844), H = +arg('h', 390);
const OUT = path.resolve(arg('out', path.join(ROOT, '..', '..', 'namba-shots', 'touchwalk')));
fs.mkdirSync(OUT, { recursive: true });
const port = 8000 + Math.floor(Math.random() * 900);
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 600));
const release = await acquireSlot('touchwalk');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const bctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: W, height: H }, screen: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await bctx.newPage();
const cdp = await bctx.newCDPSession(page);
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
const T0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(0)}s]`, ...a);
const shot = async (n) => { try { await page.screenshot({ path: `${OUT}/${n}.png`, timeout: 240000 }); log('shot', n); } catch (e) { log('SHOT FAIL', n, e.message.split('\n')[0]); } };
const settle = async (n = 2) => { try { const f0 = await page.evaluate(() => window.__namba.engine.stats.frame); await page.waitForFunction(k => window.__namba.engine.stats.frame >= k, f0 + n, { timeout: 240000 }); } catch (e) { log('settle timeout'); } };
// ---- real touch ---------------------------------------------------------------------------------------------
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id, radiusX: 8, radiusY: 8, force: 1 })) });
const rect = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && cs.visibility !== 'hidden' && +cs.opacity > 0.05 ? { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height } : null; }, sel);
const tapSel = async (sel, label) => {
  const r = await rect(sel);
  if (!r) { log('TAP MISS (not visible)', label || sel); return false; }
  await page.touchscreen.tap(r.x, r.y);
  log('tap', label || sel, `${Math.round(r.w)}x${Math.round(r.h)} @${Math.round(r.x)},${Math.round(r.y)}`);
  return true;
};
// a drag: n moves from a to b (ids keep two thumbs apart)
const drag = async (id, a, b, n = 8, holdMs = 0) => {
  await touch('touchStart', [[a[0], a[1], id]]);
  for (let i = 1; i <= n; i++) { await touch('touchMove', [[a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n, id]]); await page.waitForTimeout(16); }
  if (holdMs) await page.waitForTimeout(holdMs);
  await touch('touchEnd', []);
};
// simulation steps (same as walk.mjs: systems advanced in-page, deterministic)
const step = (secs, steer = true, dt = 0.05) => page.evaluate(([secs, dt, steer]) => {
  const c = window.__namba; const n = Math.round(secs / dt);
  for (let i = 0; i < n; i++) {
    if (steer && window.__steer) window.__steer(dt);
    c.input.update(); c.clock.update(dt);
    for (const { sys } of c.systems) if (sys.update) { try { sys.update(dt); } catch (e) { console.error('step', e.message); } }
    for (const { sys } of c.systems) if (sys.lateUpdate) { try { sys.lateUpdate(dt); } catch (e) {} }
    c.input.endFrame();
  }
}, [secs, dt, steer]);
const S = () => page.evaluate(() => { const c = window.__namba, b = c.player.body, g = c.game, st = g.story; return { t: +(g.demo.t || 0).toFixed(1), lvl: b.level, x: +b.x.toFixed(1), z: +b.z.toFixed(1), up: c.phone.isOpen, app: c.phone.app, pose: c.phone.pose, pending: !!c.phone.pendingReply, open: st && st.aya.open ? st.aya.open.msg.id : null, dest: c.phone.destination && c.phone.destination.slotId, stage: c.phone.upgradeStage, tut: g.demo.story && g.demo.story.tut ? Object.keys(g.demo.story.tut.state).filter(k => g.demo.story.tut.state[k].done) : null, use: document.querySelector('#touch-ui.has-use') ? document.querySelector('.tu-use-t b').textContent : '', arrived: g.demo.arrived, end: !!document.querySelector('.g-end.on') }; });
const sizes = (sel) => page.evaluate((s) => [...document.querySelectorAll(s)].filter(e => e.getBoundingClientRect().width > 0).map(e => { const r = e.getBoundingClientRect(); return `${(e.textContent || e.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 24)}:${Math.round(r.width)}x${Math.round(r.height)}`; }), sel);
const R = {};   // results
try {
  await page.goto(`http://127.0.0.1:${port}/index.html?noaudio`);
  await page.waitForFunction(() => window.__namba && window.__namba.ready, null, { timeout: 600000 });
  log('ready', JSON.stringify(await page.evaluate(() => { const e = window.__namba.engine; return { q: e.qualityName, mobile: !!e.mobile, pr: e.renderer.getPixelRatio(), crowdMax: e.quality.crowdMax, drawDist: e.quality.drawDist, touch: window.__namba.input.touch }; })));
  await page.waitForSelector('.t-begin', { state: 'visible', timeout: 600000 });
  await page.waitForTimeout(1500); await settle(2);
  await shot('00-title');
  R.titleText = await page.evaluate(() => document.querySelector('#title .t-begin').innerText.replace(/\s+/g, ' '));
  await tapSel('.t-begin', 'Begin');
  await page.waitForTimeout(500);
  R.started = await page.evaluate(() => window.__namba.started);
  log('started', R.started, R.titleText);
  // install the route steering (from walk.mjs): to Daikichi, Lodestone's lead field once it guides
  await page.evaluate(async () => {
    const c = window.__namba;
    const Rt = await import('/js/ui/phone/routes.js');
    const biz = c.game.demo.biz;
    const FD = Rt.fieldNoEntry(c.nav, 'touchwalk', [c.nav.nodeAtPoint(biz.level, biz.door.ox, biz.door.oz)]);
    const W = { last: null, stuckT: 0, unstick: 0, side: 1, auto: false };
    window.__W = W;
    window.__steer = (dt) => {
      if (!W.auto) return;
      const b = c.player.body;
      if (c.game.demo.arrived || c.player.frozen) { c.input.setScript({ x: 0, y: 0 }); return; }
      let F = FD;
      const lg = c.phone.lodestone && c.phone.lodestone.guid;
      if (lg && lg.dest && lg.dest.slot === biz.slot && !lg.viaDone && lg.leadField) F = lg.leadField(b) || FD;
      const v = c.nav.nodeAt(b);
      if (v < 0) { c.input.setScript({ x: 0, y: 1 }); return; }
      const path = c.nav.path(F, v, 10);
      // at a gate the route crosses: STOP and let the harness tap the Use button (a real touch)
      const tg = c.game.interactions && c.game.interactions.target, gtT = c.game._gateTgt;
      if (tg && tg.id === 'gatetap' && gtT && gtT.ok && !gtT.open && path.length > 1) {
        const gt = gtT.g.gt, ahead = path[path.length - 1];
        const s0 = (gt.axis === 'x' ? b.z : b.x) - gt.at, s1 = (gt.axis === 'x' ? c.nav.z[ahead] : c.nav.x[ahead]) - gt.at;
        if (s0 * s1 < 0) { W.wantUse = true; c.input.setScript({ x: 0, y: 0 }); return; }
      }
      W.wantUse = false;
      const t = path[Math.min(path.length - 1, 4)];
      let dx = c.nav.x[t] - b.x, dz = c.nav.z[t] - b.z;
      const want = Math.atan2(-dx, -dz);
      let d = want - c.player.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      c.player.yaw += d * Math.min(1, dt * 8); c.player.pitch = 0;
      W.stuckT += dt;
      if (W.stuckT >= 2) { const p0 = W.last; W.last = [b.x, b.z, b.level]; if (p0 && p0[2] === b.level && Math.hypot(b.x - p0[0], b.z - p0[1]) < 0.6) { W.unstick = 0.8; W.side = -W.side; } W.stuckT = 0; }
      if (W.unstick > 0) { W.unstick -= dt; c.input.setScript({ x: W.side, y: 0.3 }); return; }
      c.input.setScript({ x: 0, y: 1 });
    };
  });
  await step(3, false); await settle(2);
  await shot('01-ingame');
  R.perfStart = await page.evaluate(() => { const c = window.__namba, s = c.engine.stats, b = c.player.body; return { calls: s.calls, tris: s.tris, crowd: c.crowd && c.crowd.count, pr: c.engine.renderer.getPixelRatio(), q: c.engine.qualityName, at: `${b.level},${b.x.toFixed(0)},${b.z.toFixed(0)}` }; });
  log('perf at start', JSON.stringify(R.perfStart));
  R.controls = await sizes('#touch-ui .tu-btn, #touch-ui .tu-use');
  log('controls', JSON.stringify(R.controls));
  // ---- look: a right-thumb drag ----
  const yaw0 = await page.evaluate(() => window.__namba.player.yaw);
  for (let k = 0; k < 3; k++) { await drag(2, [W * 0.75, H * 0.45], [W * 0.75 - 140, H * 0.45 + 10], 10); await step(0.4, false); }
  const yaw1 = await page.evaluate(() => window.__namba.player.yaw);
  R.lookDeg = +((yaw1 - yaw0) * 180 / Math.PI).toFixed(1);
  log('look drag: yaw change', R.lookDeg, 'deg (3 swipes of 140 px)');
  // ---- walk: the floating stick (left thumb lands, pushes forward, holds while the sim runs) ----
  const p0 = await S();
  await touch('touchStart', [[150, H - 120, 1]]);
  for (let i = 1; i <= 6; i++) { await touch('touchMove', [[150, H - 120 - i * 10, 1]]); await page.waitForTimeout(16); }
  await step(0.3, false); await settle(2);
  await shot('02-stick');
  R.stick = await page.evaluate(() => ({ move: { ...window.__namba.input.move }, on: !!document.querySelector('#touch-controls.stick-on') }));
  await step(3.5, false);
  await touch('touchEnd', []);
  const p1 = await S();
  R.stickWalk = +Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(1);
  log('stick', JSON.stringify(R.stick), 'walked', R.stickWalk, 'm in ~3.8 s');
  // ---- sprint: push past the ring ----
  await touch('touchStart', [[150, H - 110, 1]]);
  for (let i = 1; i <= 10; i++) { await touch('touchMove', [[150, H - 110 - i * 9, 1]]); await page.waitForTimeout(16); }
  await step(0.2, false);
  R.jog = await page.evaluate(() => window.__namba.input.jog);
  await touch('touchEnd', []);
  log('push past ring -> jog', R.jog);
  // ---- Aya's first text: raise the phone with the phone button, answer with a chip ----
  for (let i = 0; i < 40; i++) { await step(1, false); const s = await S(); if (s.open || s.pending) break; }
  await settle(2); await shot('03-aya-buzz');
  log('state', JSON.stringify(await S()));
  await tapSel('#touch-ui .tu-phone', 'phone button');
  await step(1.2, false); await settle(2); await page.waitForTimeout(400);
  await shot('04-phone-up');
  R.phoneUp = (await S()).up;
  R.chips = await sizes('.ms-chip');
  R.dock = await sizes('.ph-dock button:not([hidden])');
  log('phone up', R.phoneUp, 'chips', JSON.stringify(R.chips), 'dock', JSON.stringify(R.dock));
  // answer every open question with a chip tap (first chip), raise again when needed
  const answer = async (tag) => {
    for (let i = 0; i < 30; i++) {
      const s = await S();
      if (s.open && s.pending) {
        if (!s.up) { await tapSel('#touch-ui .tu-phone', 'phone button'); await step(0.8, false); }
        if ((await S()).app !== 'messages') { await tapSel('.ph-dock [data-app="messages"]', 'dock Messages'); await step(0.6, false); }
        await settle(1);
        const ok = await tapSel('.ms-chip', `chip (${tag} ${s.open})`);
        await step(0.6, false);
        if (ok) return s.open;
      }
      await step(1, false);
    }
    return null;
  };
  R.answered = [await answer('first')];
  await step(2, false);
  R.answered.push(await answer('second'));
  await settle(2); await shot('05-answered');
  // ---- Maps from the dock, pick Aya's place ----
  if (!(await S()).up) await tapSel('#touch-ui .tu-phone', 'phone button');
  await step(0.8, false);
  await tapSel('.ph-dock [data-app="maps"]', 'dock Maps');
  await step(1.0, false); await settle(2); await page.waitForTimeout(400);
  await shot('06-maps');
  R.mapsItems = await sizes('.ph-view[data-v="maps"] .dl-next, .ph-view[data-v="maps"] .dl-r, .ph-view[data-v="maps"] .dl-chips button');
  log('maps list', JSON.stringify(R.mapsItems.slice(0, 6)));
  for (let i = 0; i < 12 && !(await S()).dest; i++) {
    if (!(await tapSel('.ph-view[data-v="maps"] .dl-next', 'Aya\'s pick (Next chip)'))) await tapSel('.ph-view[data-v="maps"] .dl-r', 'first place');
    await step(0.8, false);
    if (!(await S()).dest) { const go = await rect('.mp-go, .ph-view[data-v="maps"] [class*="go"]'); if (go) { await tapSel('.mp-go, .ph-view[data-v="maps"] [class*="go"]', 'Go'); await step(0.6, false); } }
  }
  R.dest = (await S()).dest;
  await settle(2); await shot('07-picked');
  log('destination', R.dest);
  await tapSel('#touch-ui .tu-phone', 'phone button (lower)');
  await step(0.8, false);
  R.lowered = !(await S()).up;
  // ---- walk the route; the gate: tap Use (a real touch) ----
  await page.evaluate(() => { window.__W.auto = true; });
  let used = 0, useShot = false, offerDone = false, lastLog = 0;
  for (let it = 0; it < (FULL ? 1400 : 420); it++) {
    await step(1);
    const s = await S();
    if (s.t - lastLog > 15) { lastLog = s.t; log('P', JSON.stringify(s)); }
    // answer Aya by chip, like a player (phone button -> chip -> phone button)
    if (s.open && s.pending) { await page.evaluate(() => { window.__W.auto = false; window.__namba.input.setScript({ x: 0, y: 0 }); }); const a = await answer('route'); R.answered.push(a); await step(0.4, false); if ((await S()).up && !(await S()).stage.match(/installing|calibrating/)) { await tapSel('#touch-ui .tu-phone', 'phone button (lower)'); await step(0.4, false); } await page.evaluate(() => { window.__W.auto = true; }); }
    // the gate: the bot stops at the line; we tap the Use button
    const want = await page.evaluate(() => window.__W.wantUse);
    if (want) {
      const u = await rect('#touch-ui.has-use .tu-use');
      if (u) {
        if (!useShot) { useShot = true; await settle(2); await shot('08-gate-use'); R.useLabel = s.use; }
        await tapSel('#touch-ui .tu-use', `Use (${s.use})`); used++;
        await step(0.6);
      }
    }
    // Aya's Lodestone link: phone button -> Messages -> tap the card
    if (s.stage === 'offer' && !offerDone) {
      offerDone = true;
      await page.evaluate(() => { window.__W.auto = false; window.__namba.input.setScript({ x: 0, y: 0 }); });
      await step(1.0);
      if (!(await S()).up) await tapSel('#touch-ui .tu-phone', 'phone button');
      await step(0.8, false);
      if ((await S()).app !== 'messages') await tapSel('.ph-dock [data-app="messages"]', 'dock Messages');
      await step(0.6, false); await settle(2); await shot('09-offer');
      await tapSel('.ms-link', 'Lodestone Get');
      for (let i = 0; i < 40; i++) { await step(0.25, false); const st = (await S()).stage; if (st === 'calibrating' && !R.calShot) { R.calShot = true; await step(1, false); await settle(2); await shot('10-calibrating'); } if (st === 'ready') break; }
      await step(5, false); await settle(2); await page.waitForTimeout(500); await shot('11-lodestone');
      R.ldButtons = await sizes('.ld-x3d, .ld-new, .ld-end, .ph-view[data-v="lodestone"] .dl-next, .ph-view[data-v="lodestone"] .dl-r');
      log('lodestone buttons', JSON.stringify(R.ldButtons));
      // pick Daikichi in Lodestone if the list is up (Aya's pick), then the 3D view and back
      // pick Tempura Daikichi in Lodestone's list (scrolled into view first, then a real tap on the row)
      const dk = await page.evaluate(() => { const r = [...document.querySelectorAll('.ph-view[data-v="lodestone"] .dl-r')].find(e => /Daikichi/.test(e.textContent)); if (!r) return false; r.scrollIntoView({ block: 'center' }); r.classList.add('__tw'); return true; });
      if (dk) { await step(0.3, false); await tapSel('.ph-view[data-v="lodestone"] .dl-r.__tw', 'Lodestone: Tempura Daikichi'); await step(1, false); }
      if (await rect('.ld-pv-go')) { await tapSel('.ld-pv-go', 'Go'); await step(1, false); }
      if (await tapSel('.ld-x3d', '3D view')) { await step(1.5, false); await settle(2); await shot('12-3d'); await tapSel('.ld-x3d', '3D view (back)'); await step(0.8, false); }
      R.ldDest = (await S()).dest;
      await settle(2); await shot('13-lodestone-route');
      await tapSel('#touch-ui .tu-phone', 'phone button (lower)'); await step(0.6, false);
      await page.evaluate(() => { window.__W.auto = true; });
      if (!FULL) break;
    }
    if (s.arrived || s.end) break;
  }
  R.gateUses = used;
  // the end card: walked to (--full), or opened directly (demo._end(): the arrival itself is not what this tests)
  if (!FULL) { await page.evaluate(() => { window.__W.auto = false; window.__namba.input.setScript(null); window.__namba.game.demo._end(); }); }
  {
    for (let i = 0; i < 400 && !(await S()).end; i++) { await step(0.25); await page.waitForTimeout(100); }
    await page.waitForTimeout(2500); await settle(2);
    await shot('14-endcard');
    R.endButtons = await sizes('.g-end .g-btn, .g-end .e-link');
    R.endScroll = await page.evaluate(() => { const e = document.querySelector('.g-end'); return e ? { sh: e.scrollHeight, ch: e.clientHeight, ov: getComputedStyle(e).overflowY } : null; });
    log('end card', JSON.stringify(R.endButtons), JSON.stringify(R.endScroll));
    // scroll it with a thumb (a real touch drag), then tap Keep exploring
    await drag(3, [W * 0.5, H * 0.8], [W * 0.5, H * 0.2], 10);
    await page.waitForTimeout(800);
    R.endScrolled = await page.evaluate(() => document.querySelector('.g-end').scrollTop);
    await settle(1); await shot('14b-endcard-scrolled');
    R.endLinksTarget = await page.evaluate(() => [...document.querySelectorAll('.g-end a.e-link')].map(a => a.target + ' ' + a.href.slice(0, 40)));
    await tapSel('.g-end [data-a="roam"]', 'Keep exploring');
    await page.waitForTimeout(1200);
    R.roam = await page.evaluate(() => !window.__namba.game._endCard);
    await step(0.5, false); await settle(2); await shot('14c-roam');
  }
  // ---- pause by touch, then resume by touch ----
  if (!(await S()).end) {
    await tapSel('#touch-ui .tu-pause', 'Pause');
    await page.waitForTimeout(700); await settle(2); await shot('15-pause');
    R.paused = await page.evaluate(() => window.__namba.game.paused);
    await tapSel('.g-pause .p-nav [data-a="resume"]', 'Resume');
    await page.waitForTimeout(500);
    R.resumed = !(await page.evaluate(() => window.__namba.game.paused));
  }
  R.mouseChip = await page.evaluate(() => { const c = document.querySelector('.g-mouse'); return c ? getComputedStyle(c).display : 'none'; });
  R.final = await S();
  R.stats = await page.evaluate(() => { const s = window.__namba.engine.stats; return { calls: s.calls, tris: s.tris }; });
} catch (e) { log('HARNESS ERROR', e.stack); }
R.ctxErrors = await page.evaluate(() => window.__namba && window.__namba.errors).catch(() => null);
log('RESULT', JSON.stringify(R, null, 1));
log('errors', JSON.stringify(errors.filter(e => !/fonts\.g|ERR_CERT|GL Driver|KHR_parallel/.test(e))));
await browser.close(); release(); server.kill();
