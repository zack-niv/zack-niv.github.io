// v4 hotfix: accessory close-ups. node acc.mjs [prefix]   (BEFORE=1 serves the git HEAD humans.js = the v4 code)
import { chromium } from 'playwright';
import { acquireSlot } from './slot.mjs';
import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __tooldir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__tooldir, '..');
const OUT = ROOT + '/notes/v4-shots/hotfix';
fs.mkdirSync(OUT, { recursive: true });
const PFX = process.argv[2] || '';
const BEFORE = !!process.env.BEFORE;
const port = 8000 + Math.floor(Math.random() * 900);
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 600));
const release = await acquireSlot('hotfix-acc');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
if (BEFORE) {
  const old = execSync('git -C ' + path.resolve(__tooldir, '../..') + ' show HEAD:namba-demo/js/npc/humans.js').toString();
  await page.route('**/js/npc/humans.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: old }));
}
const errors = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
const T0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(0)}s]`, ...a);
const settle = async (n = 3) => { const f0 = await page.evaluate(() => window.__namba.engine.stats.frame); await page.waitForFunction(k => window.__namba.engine.stats.frame >= k, f0 + n, { timeout: 300000 }); };
const shot = async (name) => { await settle(5); await page.screenshot({ path: `${OUT}/${PFX}${name}.png`, timeout: 300000 }); log('shot', name); };
const step = async (secs, dt = 0.05) => { while (secs > 1e-6) { const k = Math.min(1, secs); secs -= k; await page.evaluate(([secs, dt]) => {
  const c = window.__namba; const n = Math.round(secs / dt);
  for (let i = 0; i < n; i++) {
    c.input.update(); c.clock.update(dt);
    for (const { sys } of c.systems) if (sys.update) { try { sys.update(dt); } catch (e) { console.error('step', e.message); } }
    for (const { sys } of c.systems) if (sys.lateUpdate) { try { sys.lateUpdate(dt); } catch (e) {} }
    c.input.endFrame();
  }
}, [k, dt]); await page.waitForTimeout(30); } };
const tp = (p) => page.evaluate(p => window.__namba.teleport({ level: p[0], x: p[1], z: p[2], yaw: p[3] * Math.PI / 180, pitch: p[4] * Math.PI / 180 }), p);
try {
  await page.goto(`http://127.0.0.1:${port}/index.html?test&quality=high&noaudio&time=12:10`);
  await page.waitForFunction(() => window.__namba && window.__namba.ready, null, { timeout: 400000 });
  log('ready');
  const CAM = ['2F', 0, 150, 0];
  await tp([CAM[0], CAM[1], CAM[2], CAM[3], -8]); await step(4);
  // stage: N people in a row in front of the camera, pinned, facing it, each with a forced clip + accessory bits
  const staged = await page.evaluate(async (CAM) => {
    const c = window.__namba, S = c.crowd.sim, R = c.crowd.renderer;
    const { BIT } = await import('/js/npc/looks.js');
    window.__BIT = BIT;
    const b = c.player.body;
    const pool = S.agents.filter(a => a.alive && a.fade > 0.99 && a.ramp < 0 && !(a.seatH > 0) && a.level === b.level && a.look && !a.isAya && Math.hypot(a.x - b.x, a.z - b.z) < 40);
    R._look && pool.forEach(a => R._look(a));
    const nonPack = pool.filter(a => !/Backpacker/.test(a._v.name));
    window.__stage = [];
    const origClip = R._clipFor.bind(R);
    R._clipFor = (a) => { if (a.__clip) { a._spd = a.__spd || 0; return a.__clip; } return origClip(a); };
    const origUpd = R.update.bind(R);
    R.update = (dt) => {
      for (const s of window.__stage) { const a = s.a; a.x = s.x; a.z = s.z; a.vx = a.vz = 0; a.yaw = s.yaw; a.fade = 1; a.alive = true; a.stT = 1e9; a.wait = 60; a.lookYaw = 0; a.lookPitch = 0; a.lookT = 0; a.dyn = s.dyn; a.flags = s.flags; }
      origUpd(dt);
    };
    return { pool: pool.length, nonPack: nonPack.length };
  }, CAM);
  log('pool', JSON.stringify(staged));
  const stage = (spec, dist) => page.evaluate(([spec, dist, CAM]) => {
    const c = window.__namba, S = c.crowd.sim, R = c.crowd.renderer, BIT = window.__BIT, b = c.player.body;
    for (const s of window.__stage) { s.a.__clip = null; s.a.x += 25; s.a.z += 25; S.setPos(s.a, s.a.level, s.a.x, s.a.z); }
    window.__stage = [];
    const used = new Set();
    const pool = S.agents.filter(a => a.alive && a.fade > 0.99 && a.ramp < 0 && !(a.seatH > 0) && a.level === b.level && a.look && Math.hypot(a.x - b.x, a.z - b.z) < 60 && a._v && !/Backpacker/.test(a._v.name));
    // camera forward = (-sin yaw, -cos yaw); right = (cos yaw, -sin yaw)
    const yaw = CAM[3] * Math.PI / 180, fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const out = [];
    spec.forEach((sp, i) => {
      const a = pool.find(a => !used.has(a) && (!sp.g || (sp.g === 'f') === !!a.look.female)); if (!a) return; used.add(a);
      const off = (i - (spec.length - 1) / 2) * sp.gap;
      const x = CAM[1] + fx * dist + rx * off, z = CAM[2] + fz * dist + rz * off;
      const ty = Math.atan2(-(CAM[1] - x), -(CAM[2] - z)) + (sp.turn || 0);
      let bits = 0; for (const k of sp.bits || []) bits |= 1 << BIT[k];
      const keep = a.flags & ~((1 << 13) - 1);   // keep hair / clothing bits, clear accessory bits
      S.setPos(a, b.level, x, z); S.stand(a, ty); a.legs = null;
      a.__clip = sp.clip; a.__spd = sp.spd || 0; a.phoneWalk = true;
      window.__stage.push({ a, x, z, yaw: ty, flags: keep | bits, dyn: 0 });
      out.push({ clip: sp.clip, bits: sp.bits, v: a._v.name, x: +x.toFixed(1), z: +z.toFixed(1) });
    });
    return out;
  }, [spec, dist, CAM]);
  const setNear = (n) => page.evaluate(n => { const R = window.__namba.crowd.renderer; R.tier.near = n; }, n);
  const G = 0.95;
  const phones = [
    { clip: 'phone', bits: [], gap: G }, { clip: 'phonewalk', spd: 1.1, bits: [], gap: G },
    { clip: 'photo', bits: [], gap: G, turn: 0.5 }, { clip: 'browse', bits: [], gap: G, turn: -0.4 },
  ];
  const bags = [
    { clip: 'idle', bits: ['BRIEFCASE', 'SHOPBAG'], gap: G }, { clip: 'walk', spd: 1.2, bits: ['SHOULDERBAG', 'CUP'], gap: G, turn: 0.5 },
    { clip: 'idle', bits: ['TOTE', 'SHOPBAG2', 'MASK'], gap: G, turn: -0.5 }, { clip: 'idle', bits: ['BACKPACK', 'CAP'], gap: G, turn: 2.6 },
  ];
  for (const [name, spec, dist] of [['phones', phones, 2.6], ['bags', bags, 2.6]]) {
    const st = await stage(spec, dist);
    log(name, JSON.stringify(st));
    await tp([CAM[0], CAM[1], CAM[2], CAM[3], -12]);
    for (const [lod, n] of [['near', 32], ['far', 0]]) {
      await setNear(n); await step(0.6);
      const info = await page.evaluate(() => { const R = window.__namba.crowd.renderer; return { lod: R.stats.lod.slice(), staged: window.__stage.map(s => [s.a._ac, !!s.a._slot, '0x' + R._flags(s.a).toString(16)]) }; });
      log(name, lod, JSON.stringify(info));
      await shot(`${name}_${lod}`);
    }
    await setNear(32);
  }
  // single close-ups at ~2 m: idle phone and photo, near LOD
  for (const [name, sp] of [['closeup_phone', { clip: 'phone', bits: [], gap: 0, turn: 0.35 }], ['closeup_phonewalk', { clip: 'phonewalk', spd: 1.1, bits: [], gap: 0, turn: 0.35 }], ['closeup_photo', { clip: 'photo', bits: [], gap: 0, turn: 0.6 }], ['closeup_browse', { clip: 'browse', bits: ['SHOPBAG'], gap: 0, turn: -0.5 }], ['closeup_briefcase', { clip: 'walk', spd: 1.2, bits: ['BRIEFCASE', 'SHOPBAG'], gap: 0, turn: 0.9 }], ['closeup_backpack_side', { clip: 'idle', bits: ['BACKPACK'], gap: 0, turn: 1.57 }], ['closeup_backpack_back', { clip: 'walk', spd: 1.1, bits: ['BACKPACK', 'SHOPBAG2'], gap: 0, turn: 2.7 }], ['closeup_paperbags', { clip: 'idle', bits: ['SHOPBAG', 'SHOPBAG2'], gap: 0, turn: -0.6 }]]) {
    await stage([sp], 2.0);
    await tp([CAM[0], CAM[1], CAM[2], CAM[3], -18]); await step(0.6);
    await shot(name);
  }
  // programs: one shared near program, one far program
  const progs = await page.evaluate(() => window.__namba.engine.renderer.info.programs.filter(p => /people|crowd/.test(p.name)).map(p => p.name + ' x' + p.usedTimes));
  log('crowd programs', JSON.stringify(progs));
} catch (e) { log('ERR', e.stack); }
try { log('ctx.errors', JSON.stringify(await page.evaluate(() => window.__namba.errors))); } catch {}
const real = errors.filter(e => !/GL Driver Message|KHR_parallel|CERT_AUTH|ReadPixels|GPU stall|fonts\.g/.test(e));
log('console issues', real.length, [...new Set(real)].slice(0, 15).join('\n'));
await browser.close(); release(); server.kill();
