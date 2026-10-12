// PA speech unlock probe (v12). Emulates iOS WebKit's speechSynthesis gate in Chromium:
//   * speak() is silently DROPPED (no events) until one speak() runs while a trusted touchend/click is being dispatched
//     (WebKit SpeechSynthesis::speak: `if (processingUserGesture) removeRestriction; else if (restricted) return;`)
//   * getVoices() is [] for the first 1.5 s; voiceschanged never fires
//   * SpeechSynthesisUtterance accepts plain voice objects; volume is ignored
//   * REJECT=n: the first n in-gesture speaks are ALSO dropped (a gesture iOS did not honour) -> proves the retry
//   * STUCK=1: after cancel(), speech wedges (drops every speak) until a speak inside a gesture
//   * MODE=desktop: Chrome model (any speak works once navigator.userActivation.hasBeenActive), mouse click
// usage: node paprobe.mjs <root> <label> [scenario: basic|retry|stuck|desktop]
import { chromium, devices } from './node_modules/playwright/index.mjs';
import { acquireSlot } from './slot.mjs';
import { spawn } from 'child_process';
import fs from 'fs';
const [root, label, scen = 'basic'] = process.argv.slice(2);
const OUT = process.env.OUT || '/tmp/namba-paprobe';
fs.mkdirSync(OUT, { recursive: true });
const desktop = scen === 'desktop';
const port = 8000 + Math.floor(Math.random() * 900);
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 700));
const release = await acquireSlot('paprobe-' + label);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const W = 852, H = 393;
const bctx = desktop
  ? await browser.newContext({ viewport: { width: 960, height: 540 } })
  : await browser.newContext({ ...devices['iPhone 13'], viewport: { width: W, height: H }, screen: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const cfg = { desktop, reject: scen === 'retry' ? 1 : scen === 'retry2' ? 2 : 0, stuck: scen === 'stuck' };
await bctx.addInitScript((cfg) => {
  const T = window.__tts = { log: [], speaks: 0, dropped: 0, started: 0, ended: 0, engaged: false, stuck: false, rejectLeft: cfg.reject, gestures: [], t0: performance.now() };
  const now = () => +((performance.now() - T.t0) / 1000).toFixed(2);
  let inGesture = null;
  const mark = (e) => { if (!e.isTrusted) return; inGesture = e.type; T.gestures.push(`${now()} ${e.type}`); setTimeout(() => { inGesture = null; }, 0); };
  const unmark = () => { inGesture = null; };
  for (const t of ['touchend', 'click']) { addEventListener(t, mark, true); addEventListener(t, unmark, false); }
  addEventListener('pointerdown', (e) => T.gestures.push(`${now()} pointerdown(${e.pointerType})`), true);
  const VOICES = [{ name: 'Kyoko', lang: 'ja-JP', localService: true, default: false, voiceURI: 'com.apple.voice.compact.ja-JP.Kyoko' }, { name: 'Samantha', lang: 'en-US', localService: true, default: true, voiceURI: 'com.apple.voice.compact.en-US.Samantha' }];
  class U { constructor(text) { this.text = text; this.volume = 1; this.rate = 1; this.pitch = 1; this.lang = ''; this.voice = null; } }
  let cur = null; const q = [];
  const next = () => {
    if (cur || !q.length) return;
    cur = q.shift(); const u = cur;
    setTimeout(() => {
      if (cur !== u) return;
      T.started++; T.log.push(`${now()} start "${u.text.slice(0, 18)}" voice=${u.voice && u.voice.name}`); u.onstart && u.onstart({});
      setTimeout(() => { if (cur !== u) return; T.ended++; cur = null; u.onend && u.onend({}); next(); }, 60 + u.text.length * 40);
    }, 80);
  };
  const synth = {
    get speaking() { return !!cur; }, get pending() { return q.length > 0; }, paused: false,
    getVoices() { return performance.now() - T.t0 > 1500 ? VOICES.slice() : []; },
    speak(u) {
      T.speaks++;
      const g = cfg.desktop ? (navigator.userActivation && navigator.userActivation.hasBeenActive) : !!inGesture;
      const tag = `"${String(u.text).slice(0, 14)}" gesture=${inGesture || '-'}`;
      if (cfg.desktop) { if (!g) { T.dropped++; T.log.push(`${now()} not-allowed ${tag}`); setTimeout(() => u.onerror && u.onerror({ error: 'not-allowed' }), 0); return; } }
      else if (g && T.rejectLeft > 0) { T.rejectLeft--; T.dropped++; T.log.push(`${now()} DROP(rejected gesture) ${tag}`); return; }
      else if (g) { if (!T.engaged || T.stuck) T.log.push(`${now()} ENGAGE ${tag}`); T.engaged = true; T.stuck = false; }
      else if (!T.engaged || T.stuck) { T.dropped++; T.log.push(`${now()} DROP(${T.stuck ? 'stuck' : 'locked'}) ${tag}`); return; }
      q.push(u); next();
    },
    cancel() { q.length = 0; const u = cur; cur = null; if (u) setTimeout(() => u.onerror && u.onerror({ error: 'interrupted' }), 0); if (cfg.stuck && T.engaged) { T.stuck = true; T.log.push(`${now()} cancel -> STUCK`); } },
    pause() { this.paused = true; }, resume() { this.paused = false; },
    addEventListener() {}, removeEventListener() {},
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = U;
}, cfg);
const page = await bctx.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error' && !/ERR_CERT|fonts\.g/.test(m.text())) errors.push(m.text().slice(0, 200)); });
page.on('pageerror', e => errors.push('pageerror ' + e.message));
const T0 = Date.now(); const log = (...a) => console.log(`[${label} ${((Date.now() - T0) / 1000).toFixed(0)}s]`, ...a);
const tts = () => page.evaluate(() => { const T = window.__tts, a = window.__namba && window.__namba.audio; const an = a && a.announcer; return { speaks: T.speaks, dropped: T.dropped, started: T.started, ended: T.ended, engaged: T.engaged, stuck: T.stuck, stats: an && an.stats ? an.stats() : null, paStats: a && a.paStats ? a.paStats() : null, ac: a && a.ac ? a.ac.state : null, log: T.log.slice(-8), gestures: T.gestures.slice(-6), pa: an ? an.log.slice(-6) : null, last: an && an.last ? { voiceJa: an.last.voiceJa, spoken: an.last.spoken } : null }; });
const tap = async () => {
  if (desktop) { const r = await page.evaluate(() => { const e = document.querySelector('.t-begin'); const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }); await page.mouse.click(r.x, r.y); }
  else { const r = await page.evaluate(() => { const e = document.querySelector('.t-begin'); const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }); await page.touchscreen.tap(r.x, r.y); }
};
// a later tap somewhere neutral on the game view (top-centre, away from the HUD)
const tapWorld = async () => { if (desktop) await page.mouse.click(480, 60); else await page.touchscreen.tap(W / 2, 40); };
// queue a station PA line (point-less item: audible anywhere) and run the announcer until it finishes or 120 s pass
const paLine = async (n) => {
  await page.evaluate((n) => window.__namba.audio.say({ ja: `まもなく、${n}番線に、電車が参ります。`, en: `Train arriving at track ${n}.`, kind: 'station' }), n);
  const t1 = Date.now();
  for (;;) {
    await page.waitForTimeout(1500);
    const done = await page.evaluate(() => { const an = window.__namba.audio.announcer; return !an.cur && !an.queue.length; });
    if (done || Date.now() - t1 > 150000) break;
  }
};
const R = { label, scen };
try {
  await page.goto(`http://127.0.0.1:${port}/index.html?quality=low`);
  await page.waitForFunction(() => window.__namba && window.__namba.ready, null, { timeout: 900000 });
  await page.waitForSelector('.t-begin', { state: 'visible', timeout: 600000 });
  log('ready', JSON.stringify(await page.evaluate(() => ({ touch: window.__namba.input.touch, ua: navigator.userAgent.slice(0, 40) }))));
  await page.evaluate(() => { window.__namba.engine.render = () => {}; });   // speech probe: no rendering needed
  await page.waitForTimeout(2000);   // voices appear at 1.5 s
  await tap();
  await page.waitForTimeout(2500);
  R.afterBegin = await tts(); log('after Begin tap', JSON.stringify(R.afterBegin));
  await paLine(1);
  R.line1 = await tts(); log('line 1', JSON.stringify(R.line1));
  if (scen.startsWith('retry') || scen === 'stuck' || R.line1.started === 0) {
    if (scen === 'stuck') {
      // a line in flight is cancelled (tab hidden / pause / a higher-priority line): the model wedges speech after cancel()
      await page.evaluate(() => window.__namba.audio.say({ ja: 'ただいま、電車が遅れております。', en: 'The train is delayed.', kind: 'station' }));
      await page.waitForFunction(() => { const an = window.__namba.audio.announcer; return an.cur && an.cur.utter; }, null, { timeout: 150000, polling: 100 });
      await page.evaluate(() => window.__namba.audio.announcer.cancelSpeech());
      await paLine(2); R.line2stuck = await tts(); log('line 2 after cancel (stuck)', JSON.stringify(R.line2stuck)); }
    await tapWorld(); await page.waitForTimeout(2500);
    R.afterTap2 = await tts(); log('after 2nd tap', JSON.stringify(R.afterTap2));
    await paLine(3);
    R.line3 = await tts(); log('line 3', JSON.stringify(R.line3));
  }
  R.errors = errors; R.ctxErrors = await page.evaluate(() => window.__namba.errors || []);
  log('errors', JSON.stringify(R.errors), 'ctx.errors', JSON.stringify(R.ctxErrors));
} catch (e) { log('FAIL', e.message); R.fail = e.message; }
fs.writeFileSync(`${OUT}/${label}.json`, JSON.stringify(R, null, 1));
await browser.close(); server.kill(); release(); process.exit(0);
