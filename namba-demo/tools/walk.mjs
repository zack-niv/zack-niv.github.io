// Full-route player walk: drives input (setScript forward + yaw like mouse look) along the nav flow field.
import { chromium } from 'playwright';
import { acquireSlot } from './slot.mjs';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __tooldir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__tooldir, '..');
const OUT = path.resolve(__tooldir, '../../../namba-shots/walk');
const Q = process.env.Q || '?quality=low&noaudio';
const JOG = !!process.env.JOG;
const port = 8000 + Math.floor(Math.random() * 900);
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 600));
const release = await acquireSlot('critic-walk');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1024, height: 576 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
page.on('console', m => { if (m.text().startsWith('dbg')) console.log('[page]', m.text()); });
const T0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(0)}s]`, ...a);
const P = process.env.P || 'w';
const shot = async (name, sel) => { try { const f = `${OUT}/${P}-${name}.png`; if (sel) { const bb = await page.evaluate(q => { const r = document.querySelector(q)?.getBoundingClientRect(); return r && { x: Math.max(0, r.x), y: Math.max(0, r.y), width: Math.min(r.width, 1024 - Math.max(0, r.x)), height: Math.min(r.height, 576 - Math.max(0, r.y)) }; }, sel); await page.screenshot({ path: f, clip: bb || undefined, timeout: 240000, animations: 'disabled' }); } else await page.screenshot({ path: f, timeout: 240000 }); log('shot', name); } catch (e) { log('SHOT FAIL', name, e.message.split('\n')[0]); } };
try {
  await page.goto(`http://127.0.0.1:${port}/index.html${Q}`);
  await page.waitForFunction(() => window.__namba && window.__namba.ready, null, { timeout: 300000 });
  log('ready');
  await page.waitForSelector('.t-begin', { state: 'visible', timeout: 600000 });
  await page.waitForTimeout(1500);
  if (!process.env.NOTITLE) await shot('00-title');
  await page.evaluate(() => { window.__namba.input.requestLock = () => {}; window.__namba.input.exitLock = () => {}; }); log('click'); await page.click('.t-begin', { timeout: 60000 }).catch(e => log('click fail', e.message.split('\n')[0])); log('clicked', JSON.stringify(await page.evaluate(() => ({ s: window.__namba.started, b: window.__namba.game.demo.began }))));
  await page.evaluate(async (JOG) => {
    const c = window.__namba;
    console.warn('dbg importing'); const R = await import('/js/ui/phone/routes.js'); console.warn('dbg imported');
    const biz = c.game.demo.biz;
    const goal = c.nav.nodeAtPoint(biz.level, biz.door.ox, biz.door.oz);
    const FD = R.fieldNoEntry(c.nav, 'critic', [goal]);
    let F = FD;
    // v4: Aya's coffee errand — walk to the café's order spot first (the counter, inside the shop), then Daikichi
    const st0 = c.game.story, cslot = st0 && st0.errand && st0.errand.slot;
    const ctr = cslot && (c.counters || []).find(k => k && k.slotId === cslot);
    const FC = ctr ? R.fieldNoEntry(c.nav, 'critic:coffee', [c.nav.nodeAtPoint(ctr.level, ctr.order.x, ctr.order.z)]) : null;
    window.__coffee = { slot: cslot, ctr: ctr ? { level: ctr.level, order: ctr.order, staff: ctr.staff } : null, skip: !!(typeof location !== 'undefined' && /nocoffee/.test(location.search)) };
    const L = { ev: [], crumbs: [], tbt: [], maps: [], stuck: [] };
    window.__L = L;
    const T = () => +(c.game.demo.t || 0).toFixed(1);
    const on = (n, f) => c.events.on(n, (e) => L.ev.push([T(), n, f ? f(e) : '']));
    on('phone:message', e => (e.from || '') + ': ' + (e.text || '').slice(0, 80) + (e.link ? ' [link]' : ''));
    on('demo:offer', e => e.why); on('tutorial:step', e => e.id + ' n=' + e.nudges); on('tutorial:done', e => e.t); on('phone:reply', e => e.msgId + '->' + e.replyId); on('phone:upgrade', e => e.stage); on('demo:arrive'); on('demo:end'); on('lodestone:arrive'); on('phone:arrive');
    on('quest:update', e => e.id + ' ' + e.state); on('discover', e => e.id); on('ic:tap', e => `${e.gate} ok=${e.ok} ${e.reason || ''}`);
    on('nav:destination', e => `${e.slotId} ${e.name} app=${e.app} suggested=${e.suggested} via=${e.via}`); on('nav:end', e => `${e.app} ${e.slotId}`); on('nav:milestone', e => `${e.app} ${e.kind} ${e.dir || ''} ${e.toLevel || ''} ${e.name || ''} ${Math.round(e.dist)}m`); on('nav:arrived', e => e.slotId); on('demo:order', e => `${e.slotId} ${e.item} errand=${e.errand}`); on('story:pick', e => JSON.stringify(e));
    on('nav:track', e => `${e.state} herr=${Math.round(e.headingErr||0)} lost=${(e.lost||0).toFixed?.(1)} @${c.player.body.level},${c.player.body.x.toFixed(0)},${c.player.body.z.toFixed(0)} ramp=${c.player.body.ramp}`); on('phone:pose', e => e.pose); on('phone:app', e => e.app); on('phone:typing', e => e.on); on('tutorial:start'); on('demo:lost', e => JSON.stringify(e).slice(0,80));
    on('caption', e => (e.en || '').slice(0, 70)); on('announce', e => e.kind || '');
    c.events.on('ic:tap', (e) => { if (e && !e.ok) { W.refused = (W.refused || 0) + 1; W.unstick = 1.4; if (W.refused % 3 === 0) W.laneSide = -(W.laneSide || 1); W.side = W.laneSide || 1; L.ev.push([T(), 'gate-refused', `try#${W.refused} side=${W.side}`]); } });
    // v6: reactive gates — the bot taps with E (game's 'gatetap' interactable); a wrong-way channel makes it side-step
    on('gate:tap', e => `${e.gate} lane=${e.lane}.${e.sub} dir=${e.dir}`); on('gate:blocked', e => `${e.gate} lane=${e.lane}.${e.sub} ${e.reason}`); on('ic:pay', e => `${e.kind} ${e.amount} ok=${e.ok} bal=${e.balance}`); on('story:where', e => `${e.t} ${e.why}`);
    c.events.on('gate:pass', (e) => { if (e && e.player) L.ev.push([T(), 'gate:pass', `${e.gate} lane=${e.lane} dir=${e.dir} (player)`]); });
    c.events.on('gate:blocked', (e) => { if (e && e.reason && e.reason !== 'notap') { W.refused = (W.refused || 0) + 1; W.unstick = 1.4; if (W.refused % 3 === 0) W.laneSide = -(W.laneSide || 1); W.side = W.laneSide || 1; } });
    const W = { F, last: null, lastT: 0, stuckT: 0, unstick: 0, lastLvl: null, lastTitle: null, odo: 0, prev: null, maxStuck: 0, blocked: 0 };
    window.__W = W;
    window.__steer = (dt) => {
      const b = c.player.body;
      if (W.prev) W.odo += Math.hypot(b.x - W.prev[0], b.z - W.prev[1]);
      W.prev = [b.x, b.z];
      if (b.level !== W.lastLvl) { L.ev.push([T(), 'level', `${W.lastLvl}->${b.level} ramp=${b.ramp} @${b.x.toFixed(0)},${b.z.toFixed(0)}`]); W.lastLvl = b.level; }
      if (c.game.demo.arrived || c.player.frozen) { c.input.setScript({ x: 0, y: 0 }); return; }
      // which leg: the café while Aya's latte is still wanted (and the bot is not skipping it), else Daikichi
      const E = c.game.story && c.game.story.errand;
      const wantCoffee = FC && E && E.state === 'asked' && !window.__coffee.skip;
      F = wantCoffee ? FC : FD;
      // v5: once Lodestone guides to Daikichi, follow ITS route (the scenic loop: canyon → garden stairs → glass bridge)
      const lg = c.phone.lodestone && c.phone.lodestone.guid;
      if (!wantCoffee && lg && lg.dest && lg.dest.slot === biz.slot && !lg.viaDone && lg.leadField && !/nocanyon/.test(location.search)) F = lg.leadField(b) || FD;
      W.F = F;
      if (wantCoffee && b.level === ctr.level && Math.hypot(b.x - ctr.order.x, b.z - ctr.order.z) < 1.1) {
        // at the order spot: face the staff and press E (exactly what interact.js does on the key)
        const sx = ctr.staff.x - b.x, sz = ctr.staff.z - b.z;
        let d = Math.atan2(-sx, -sz) - c.player.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
        c.player.yaw += d * Math.min(1, dt * 8); c.player.pitch = 0;
        c.input.setScript({ x: 0, y: 0 });
        const t = c.game.interactions && c.game.interactions.target;
        if (t && t.id === 'order:' + cslot && Math.abs(d) < 0.3 && !W.ordered) { W.ordered = true; L.ev.push([T(), 'bot:E', t.id]); c.events.emit('interact', { target: t.id }); try { t.onUse(t); } catch (e) { console.error('bot use', e.message); } }
        return;
      }
      const v = c.nav.nodeAt(b);
      if (v < 0) { c.input.setScript({ x: 0, y: 1, jog: JOG }); return; }
      const path = c.nav.path(F, v, 10);
      // v6: at a gate the route goes THROUGH, press E like a player (the game's own 'gatetap' interactable: exactly
      // what the key does). Walking past a gate line (the 3F->2F escalator is right beside it) is not a reason to tap.
      const it = c.game.interactions, tg = it && it.target, gtT = c.game._gateTgt;
      if (tg && tg.id === 'gatetap' && gtT && gtT.ok && !gtT.open && (W.tapT == null || T() - W.tapT > 1.5) && path.length > 1) {
        const gt = gtT.g.gt, ahead = path[path.length - 1];
        const s0 = (gt.axis === 'x' ? b.z : b.x) - gt.at, s1 = (gt.axis === 'x' ? c.nav.z[ahead] : c.nav.x[ahead]) - gt.at;
        if (s0 * s1 < 0) {
          W.tapT = T(); L.ev.push([T(), 'bot:E', `gatetap ${gtT.gate} lane=${gtT.lane}.${gtT.sub} in=${gtT.entering}`]);
          c.events.emit('interact', { target: tg.id }); try { tg.onUse(tg); } catch (e) { console.error('bot gate', e.message); }
        }
      }
      if (W.near > 0) W.near -= dt;
      let k = Math.min(path.length - 1, W.near > 0 ? 1 : 4);
      const t = path[k];
      let dx = c.nav.x[t] - b.x, dz = c.nav.z[t] - b.z;
      if (Math.hypot(dx, dz) < 0.2 && path.length > 1) { dx = c.nav.x[path[path.length - 1]] - b.x; dz = c.nav.z[path[path.length - 1]] - b.z; }
      const want = Math.atan2(-dx, -dz);
      let d = want - c.player.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      c.player.yaw += d * Math.min(1, dt * 8);      // a quick mouse turn, not a snap
      c.player.pitch = 0;
      // stuck detection
      W.stuckT += dt;
      if (W.stuckT >= 2) {
        const p0 = W.last; W.last = [b.x, b.z, b.level];
        if (p0 && p0[2] === b.level && Math.hypot(b.x - p0[0], b.z - p0[1]) < 0.6) { L.stuck.push([T(), b.level, +b.x.toFixed(1), +b.z.toFixed(1), b.ramp, +F.dist[v].toFixed(0)]); W.nStuck = (W.nStuck || 0) + 1; W.unstick = 0.8; W.side = Math.random() < 0.5 ? -1 : 1; W.back = W.nStuck % 2 === 0 ? 1.0 : 0; W.near = 5; } else W.nStuck = 0;
        W.stuckT = 0;
      }
      if (W.unstick > 0) { W.unstick -= dt; if (W.back > 0) { W.back -= dt; c.input.setScript({ x: 0, y: -1, jog: JOG }); return; } c.input.setScript({ x: W.side, y: W.refused ? -0.15 : 0.3, jog: JOG }); return; }
      c.input.setScript({ x: 0, y: 1, jog: JOG });
    };
    window.__probe = () => {
      const b = c.player.body, ph = c.phone, d = c.game.demo;
      const pos = ph.pos;
      const v = c.nav.nodeAt(b);
      return { t: T(), lvl: b.level, x: +b.x.toFixed(1), z: +b.z.toFixed(1), ramp: b.ramp, rem: v >= 0 ? +FD.dist[v].toFixed(0) : null, leg: (W.F === FC ? 'cafe' : 'dk'), errand: c.game.story && c.game.story.errand.state, dest: c.phone.destination && c.phone.destination.slotId,
        phone: pos ? { x: +pos.x.toFixed(1), z: +pos.z.toFixed(1), lvl: pos.level, err: +Math.hypot(pos.x - b.x, pos.z - b.z).toFixed(1) } : null,
        stage: ph.upgradeStage, offered: d.offered, arrived: d.arrived, ended: d.ended, odo: +W.odo.toFixed(0), crowd: c.crowd && c.crowd.count, frozen: c.player.frozen, busy: c.game.busy };
    };
    window.__tbt = () => {
      const lo = c.phone.lodestone, g = lo && lo.guid; if (!g || !g.field) return null;
      const b = c.player.body; const r = g.compute(b, c.phone.pos.heading);
      if (!r || !r.ok) return { ok: false };
      const s0 = r.steps[0], s1 = r.steps[1];
      return { t: T(), lvl: b.level, x: +b.x.toFixed(0), z: +b.z.toFixed(0), now: s0 && `${s0.title} | ${s0.sub || ''}`, at: s0 && Math.round(s0.at), then: s1 && `${s1.title} | ${s1.sub || ''}`, total: Math.round(r.total), eta: Math.round(r.eta), ramps: r.ramps, all: r.steps.map(s => `${Math.round(s.at)}m ${s.title} | ${s.sub || ''}`) };
    };
  }, JOG);
  log('installed');
  const step = (secs, dt = 0.05) => page.evaluate(([secs, dt]) => {
    const c = window.__namba; const n = Math.round(secs / dt);
    for (let i = 0; i < n; i++) {
      window.__steer(dt);
      c.input.update(); c.clock.update(dt);
      for (const { sys } of c.systems) if (sys.update) { try { sys.update(dt); } catch (e) { console.error('step', e.message); } }
      for (const { sys } of c.systems) if (sys.lateUpdate) { try { sys.lateUpdate(dt); } catch (e) {} }
      c.input.endFrame();
    }
  }, [secs, dt]);
  const probe = () => page.evaluate(() => window.__probe());
  const settle = async (n = 2) => { try { const f0 = await page.evaluate(() => window.__namba.engine.stats.frame); await page.waitForFunction(k => window.__namba.engine.stats.frame >= k, f0 + n, { timeout: 240000 }); } catch (e) { log('settle timeout'); } };
  // first 10 seconds in near real-time pacing
  const shotsAt = new Set();
  const once = async (k, fn) => { if (shotsAt.has(k)) return; shotsAt.add(k); await fn(); };
  let lastTitle = null, lastP = 0, readySeen = false, mapsShot = false, canyonShot = false;
  for (let iter = 0; iter < 2000; iter++) {
    await step(1.0);
    const s = await probe();
    // v3: Aya's questions wait for an answer — raise the phone on Messages, answer (asking for help when offered), lower it
    const q = await page.evaluate(() => { const st = window.__namba.game.story; const o = st && st.aya.open; if (!o || st.aya.t - o.t < 2.5) return null; window.__namba.phone.open('messages'); return o.msg.id; });
    if (q) { await step(0.8); const a = await page.evaluate(() => { const r = window.__namba.game.story.answer('lost'); return r; }); await step(0.6); await page.evaluate(() => { window.__namba.phone.open('maps'); }); await step(0.8); await page.evaluate(() => window.__namba.phone.close()); log('ANSWER', a); }
    // v4: choose where to go like a player — phone up on Maps (Lodestone once live), press 1 = Aya's pick
    const pk = await page.evaluate(() => {
      const c = window.__namba, st = c.game.story, ph = c.phone;
      if (!st || typeof ph.suggest !== 'function' || c.game.demo.arrived) return null;
      const dk = ph.destination && ph.destination.slotId === 'parks_6Fdw03';
      const need1 = st.aya.wasSent('coffee') && !st.f.picked && !st.aya.busy();
      const need2 = st._leg2 && !st.f.pick2 && !dk && !st.aya.busy();
      if (!need1 && !need2) return null;
      if (window.__pickT != null && c.game.demo.t - window.__pickT < 6) return null;
      window.__pickT = c.game.demo.t;
      ph.open(ph.upgradeStage === 'ready' ? 'lodestone' : 'maps');
      return need1 ? 1 : 2;
    });
    if (pk) {
      await step(1.0); await settle(2); await page.waitForTimeout(500);
      await shot(`p${pk}a-list-dev`, '.ph-device'); await shot(`p${pk}a-list-full`);   // v5: full frame — the tutorial hint must sit clear of the raised phone
      await page.keyboard.press(pk === 1 && process.env.PICK1 ? process.env.PICK1 : 'Digit1'); await step(0.6);
      let d = await page.evaluate(() => window.__namba.phone.destination);
      const sug = await page.evaluate(() => window.__namba.phone.suggested);
      if (!d || (sug && d.slotId !== sug && !(pk === 1 && process.env.PICK1))) { const fb = await page.evaluate(() => { const ph = window.__namba.phone; return ph.setDestination(ph.suggested); }); d = await page.evaluate(() => window.__namba.phone.destination); log('PICK fallback setDestination', fb); }
      log('PICK', pk, JSON.stringify(d));
      await step(1.0); await settle(2); await page.waitForTimeout(500); await shot(`p${pk}b-picked-dev`, '.ph-device'); await shot(`p${pk}c-picked-full`);
      await page.evaluate(() => window.__namba.phone.close());
    }
    if (s.errand === 'done' && !shotsAt.has('cafe')) await once('cafe', async () => { await settle(2); await page.waitForTimeout(600); await shot('09c-coffee-ordered'); });
    if (s.t - lastP >= 10) { lastP = s.t; log('P', JSON.stringify(s)); }
    if (s.t >= 2.5) await once('01', async () => { await settle(1); await shot('01-intro-2s'); });
    if (s.t >= 11.5) await once('02', async () => { await settle(1); await shot('02-aya-text-11s'); });
    if (s.t >= 25) await once('03', async () => { await settle(1); await shot('03-walking-25s'); });
    // the ordinary map (open the phone like a player would: Q -> maps)
    if (!s.offered && ((s.t >= 40 && s.lvl !== '3F') || s.t >= 70) && !mapsShot) {
      mapsShot = true;
      await page.evaluate(() => window.__namba.phone.open('maps'));
      await step(1.5, 0.05); await settle(2); await page.waitForTimeout(800);
      await shot('04-maps-wrong-dev', '.ph-device'); await shot('04-maps-wrong-full');
      const mtxt = await page.evaluate(() => document.querySelector('.ph-device')?.innerText.replace(/\s+/g, ' ').slice(0, 600));
      log('MAPS TEXT', mtxt);
      await page.evaluate(() => window.__namba.phone.close());
    }
    if (s.offered && !shotsAt.has('05')) {
      await once('05', async () => {
        log('OFFER at', JSON.stringify(s));
        await step(1.0); await settle(2); await page.waitForTimeout(800); await shot('05-offer-peek');
        await page.evaluate(() => window.__namba.phone.open('messages'));
        await step(0.8); await settle(2); await page.waitForTimeout(800);
        await shot('05-offer-dev', '.ph-device'); await shot('05-offer-full');
        // tap the card like a player (fallback to API)
        const clicked = await page.evaluate(() => { const el = document.querySelector(".ph-device .ms-link"); if (el) { el.click(); return el.className; } window.__namba.phone.installLodestone(); return 'api'; });
        log('install via', clicked);
        for (let i = 0; i < 40; i++) {
          await step(0.25, 0.05);
          const st = await page.evaluate(() => window.__namba.phone.upgradeStage);
          if (st === 'installing') await once('06', async () => { await settle(1); await shot('06-installing-dev', '.ph-device'); });
          if (st === 'calibrating') await once('07', async () => { await step(1.0); await settle(1); await page.waitForTimeout(500); await shot('07-calibrating-dev', '.ph-device'); await shot('07-calibrating-full'); });
          if (st === 'ready') break;
        }
        await step(1.5); await settle(2); await page.waitForTimeout(1000);
        await shot('08-ready-reveal-dev', '.ph-device');
        await step(3); await settle(2); await page.waitForTimeout(800);
        await shot('08b-ready-3s-dev', '.ph-device'); await shot('08c-ready-full');
        log('LODESTONE TEXT', await page.evaluate(() => document.querySelector('.ph-device')?.innerText.replace(/\s+/g, ' ').slice(0, 700)));
        await page.evaluate(() => window.__namba.phone.close());
      });
    }
    if (s.stage === 'ready') {
      const tb = await page.evaluate(() => window.__tbt());
      if (tb && tb.now !== lastTitle) { lastTitle = tb.now; log('TBT', JSON.stringify({ t: tb.t, lvl: tb.lvl, x: tb.x, z: tb.z, now: tb.now, at: tb.at, then: tb.then, total: tb.total, ramps: tb.ramps })); if (!readySeen) { readySeen = true; log('ALL STEPS', JSON.stringify(tb.all, null, 1)); } }
    }
    if (!canyonShot && s.lvl === '2F' && s.z > 215) {
      const ev = await page.evaluate(() => window.__L.ev.filter(e => e[1] === 'discover' || /canyon/i.test(String(e[2]))).slice(-3));
      if (s.z > 222) { canyonShot = true; await settle(2); await shot('09-canyon'); log('canyon ev', JSON.stringify(ev), JSON.stringify(s)); }
    }
    if (s.stage === 'ready' && s.lvl === '3F' && s.x > 20 && s.x < 50 && s.z > 235 && s.z < 243) await once('09b', async () => { await settle(2); await shot('09b-glass-bridge'); });
    if (s.stage === 'ready' && ((s.lvl === '2F' && s.z > 150 && s.z < 160) || (s.lvl === '2F' && s.z > 209 && s.z < 216))) await once('g' + s.lvl + Math.round(s.z / 60), async () => { await settle(1); await shot(`09g-glance-${Math.round(s.z)}`, '.ph-isl'); log('GLANCE', await page.evaluate(() => document.querySelector('.ph-isl .gl')?.innerText.replace(/\s+/g, ' '))); });
    // v6 critic: the raised Lodestone card while riding ("On the escalator · N m to go", "Riding up to 3F · Then …")
    if (s.stage === 'ready' && s.ramp != null && s.ramp >= 0 && shotsAt.size && !shotsAt.has('ride')) await once('ride', async () => { await page.evaluate(() => window.__namba.phone.open('lodestone')); await step(0.6); await settle(2); await page.waitForTimeout(500); await shot('09r-riding-dev', '.ph-device'); await shot('09r-riding-full'); log('RIDE CARD', await page.evaluate(() => (document.querySelector('.ph-device')?.innerText || '').replace(/\s+/g, ' ').slice(0, 300))); await page.evaluate(() => window.__namba.phone.close()); });
    if (s.lvl === '6F' && !shotsAt.has('10')) { await once('10', async () => { await settle(2); await shot('10-6F-arrive-floor'); }); }
    if (s.stage === 'ready' && shotsAt.has('10') && !shotsAt.has('10b') && s.rem != null && s.rem < 30) { await once('10b', async () => { await page.evaluate(() => window.__namba.phone.open('lodestone')); await step(1); await settle(2); await page.waitForTimeout(600); await shot('10b-lodestone-near-dev', '.ph-device'); await page.evaluate(() => window.__namba.phone.close()); }); }
    if (s.arrived) { log('ARRIVED', JSON.stringify(s)); break; }
    if (s.t > 1100) { log('TIMEOUT walking'); break; }
  }
  // arrival moment: real-time pacing for systems
  const ta = Date.now(); let k = 0;
  while (Date.now() - ta < 240000) {
    await step(0.2, 0.05); await page.waitForTimeout(150);
    const el = Date.now() - ta;
    if (el > 2500 && k === 0) { k = 1; await shot('11-arrive-noren'); }
    if (el > 4500 && k === 1) { k = 2; await shot('12-arrive-aya'); }
    if (el > 8000 && k === 2) { k = 3; await shot('13-arrive-chef'); }
    if (await page.evaluate(() => !!document.querySelector('.g-end.on'))) break;
  }
  await page.waitForTimeout(3000); await settle(2); await page.waitForTimeout(1500);
  await shot('14-endcard');
  log('ENDCARD TEXT', await page.evaluate(() => document.querySelector('.g-end')?.innerText.replace(/\s+/g, ' ')));
  log('SUMMARY', JSON.stringify(await page.evaluate(() => { const s = window.__namba.game.demo.summary(); delete s.phone.series; return s; })));
} catch (e) { log('HARNESS ERROR', e.stack); }
try {
  const L = await page.evaluate(() => window.__L);
  log('EVENTS\n' + L.ev.map(e => e.join(' | ')).join('\n'));
  log('STUCK', JSON.stringify(L.stuck));
  log('ctx.errors', JSON.stringify(await page.evaluate(() => window.__namba.errors)));
} catch (e) { log('no log', e.message); }
const real = errors.filter(e => !/GL Driver Message|KHR_parallel|CERT_AUTH/.test(e));
log('--- console issues:', real.length); console.log([...new Set(real)].slice(0, 25).join('\n'));
await browser.close(); release(); server.kill();
