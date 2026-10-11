// Compose og.jpg (1200x630) from a clean game frame + the real phone UI (v11 share card: the quest, no spoilers).
//   node tools/ogcard.mjs --bg raw.png --phone phone_dev.png --out og.jpg [--html card.html] [--thumb thumb550.png]
import { chromium } from 'playwright';
import { acquireSlot } from './slot.mjs';
import path from 'path'; import fs from 'fs';
const a = process.argv.slice(2);
const opt = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : d; };
const bg = path.resolve(opt('bg')), phone = path.resolve(opt('phone')), out = path.resolve(opt('out', 'og.jpg'));
const html = path.resolve(opt('html', path.join(path.dirname(out), 'card.html')));
const q = +opt('quality', 88);
const page_html = `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0}
html,body{width:1200px;height:630px;overflow:hidden;background:#0c0b0a}
body{position:relative;font-family:'Noto Sans CJK JP','Noto Sans JP','Helvetica Neue',Arial,sans-serif;color:#f4f1ea}
.bg{position:absolute;inset:0;background:url('file://${bg}') center/cover;filter:saturate(1.05)}
.shade{position:absolute;inset:0;background:linear-gradient(90deg,rgba(8,7,6,.93) 0%,rgba(8,7,6,.84) 38%,rgba(8,7,6,.32) 62%,rgba(8,7,6,.05) 100%),linear-gradient(0deg,rgba(8,7,6,.6),rgba(8,7,6,0) 30%)}
.l{position:absolute;left:64px;top:56px;width:680px}
.kana{font-weight:300;font-size:132px;line-height:1;letter-spacing:.02em}
.latin{margin-top:12px;font-weight:800;font-size:34px;letter-spacing:.34em;color:rgba(244,241,234,.78);padding-left:4px}
.rule{width:64px;height:3px;background:#e9b45c;margin:30px 0 28px}
.tag{font-weight:800;font-size:54px;line-height:1.14;letter-spacing:-.01em;text-shadow:0 2px 24px rgba(0,0,0,.5)}
.ask{margin-top:20px;font-weight:700;font-size:44px;color:#f1bd66;line-height:1.1}
.foot{position:absolute;left:64px;bottom:34px;font-size:21px;letter-spacing:.06em;color:rgba(244,241,234,.66)}
.ph{position:absolute;right:58px;top:50px;height:545px;transform:rotate(3.2deg);filter:drop-shadow(0 22px 40px rgba(0,0,0,.55))}
</style>
<div class="bg"></div><div class="shade"></div>
<div class="l"><div class="kana">なんば</div><div class="latin">LOST IN NAMBA</div><div class="rule"></div>
<div class="tag">Six floors, four stations,<br>one tempura lunch.</div><div class="ask">Can you find it?</div></div>
<img class="ph" src="file://${phone}">
<div class="foot">A first-person game · play in your browser</div>`;
fs.writeFileSync(html, page_html);
const release = await acquireSlot('ogcard');
const browser = await chromium.launch();
const pg = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await pg.goto('file://' + html); await pg.waitForTimeout(500);
await pg.screenshot({ path: out, type: 'jpeg', quality: q });
console.log(out, fs.statSync(out).size, 'bytes');
const th = opt('thumb', null);
if (th) { const p2 = await browser.newPage({ viewport: { width: 550, height: 289 } }); await p2.setContent(`<body style="margin:0"><img src="file://${out}" width="550">`); await p2.waitForTimeout(300); await p2.screenshot({ path: path.resolve(th) }); }
await browser.close(); release();
