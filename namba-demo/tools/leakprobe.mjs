// Shell probe: one browser session, teleport to poses, screenshot + ray-grid analysis.
//   node probe.mjs --root DIR --out DIR --poses "L,x,z,yaw,pitch;..." [--rays 24x14] [--frames 8] [--noshot]
// For each pose a grid of camera rays is cast against every rendered mesh (layer 0, visible chain),
// with materials forced double-sided. A ray whose FIRST hit is the back face of a one-sided surface
// is a "leak": the renderer shows whatever lies behind (= see-through shell). Reports leak % and the
// top leak surfaces (mesh name / owning group / hit point).
import { chromium } from 'playwright';
import { acquireSlot } from './slot.mjs';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
const __tooldir = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => { if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]); return a; }, []));
const root = path.resolve(args.root || path.resolve(__tooldir, '..'));
const out = path.resolve(args.out || '/tmp/probe'); fs.mkdirSync(out, { recursive: true });
const poses = String(args.poses).split(';').filter(Boolean);
const [RX, RY] = String(args.rays || '32x18').split('x').map(Number);
const port = 8000 + Math.floor(Math.random() * 900);
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 600));
const release = await acquireSlot('shells-probe');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: +(args.w || 1280), height: +(args.h || 720) } });
const errors = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
const t0 = Date.now();
try {
  await page.goto(`http://127.0.0.1:${port}/index.html?test&quality=${args.q || 'high'}${args.extra || '&nocrowd'}`);
  await page.waitForFunction(() => window.__namba && window.__namba.ready, null, { timeout: 900000, polling: 500 });
  console.log('READY', ((Date.now() - t0) / 1000).toFixed(1) + 's');
  for (const v of poses) {
    const [lv, x, z, yaw, pitch, dy] = v.split(',');
    await page.evaluate(dy => { const e = window.__namba.engine; if (!e.__r0) { e.__r0 = e.render; e.render = function (dt) { if (e.__dy) { e.camera.position.y += e.__dy; e.camera.updateMatrixWorld(); } return e.__r0.call(e, dt); }; } e.__dy = dy; }, +(dy || 0));
    const pose = { level: lv, x: +x, z: +z, yaw: (+yaw || 0) * Math.PI / 180, pitch: (+pitch || 0) * Math.PI / 180 };
    await page.evaluate(p => window.__namba.teleport(p), pose);
    const f0 = await page.evaluate(() => window.__namba.engine.stats.frame);
    await page.waitForFunction(n => window.__namba.engine.stats.frame >= n, f0 + +(args.frames || 8), { timeout: 900000, polling: 250 });
    const r = await page.evaluate(([RX, RY]) => {
      const n = window.__namba, THREE = n.THREE, cam = n.engine.camera;
      const s = n.engine.stats;
      const meshes = [];
      n.scene.updateMatrixWorld();
      n.scene.traverseVisible(o => { if ((o.isMesh || o.isInstancedMesh) && o.layers.test(cam.layers) && o.material) meshes.push(o); });
      const saved = new Map();
      for (const m of meshes) for (const mt of [].concat(m.material)) if (!saved.has(mt)) { saved.set(mt, mt.side); mt.side = THREE.DoubleSide; }
      const rc = new THREE.Raycaster(); rc.layers.mask = cam.layers.mask;
      const grp = (o) => { let p = o; while (p && p.parent && !(p.userData && p.userData.chunk)) p = p.parent; return p && p.userData && p.userData.chunk ? p.name : (o.parent ? o.parent.name : ''); };
      const leaks = {}, firsts = {}; let nLeak = 0, nHit = 0;
      const samples = [];
      for (let j = 0; j < RY; j++) for (let i = 0; i < RX; i++) {
        const ndc = new THREE.Vector2((i + 0.5) / RX * 2 - 1, -((j + 0.5) / RY * 2 - 1));
        rc.setFromCamera(ndc, cam);
        rc.far = 400;
        const hits = rc.intersectObjects(meshes, false).filter(k => { const m = Array.isArray(k.object.material) ? k.object.material[0] : k.object.material; return !(m.transparent && (m.opacity < 0.95 || /glass/i.test(m.name || k.object.name))) && !m.alphaTest; });
        if (!hits.length) continue;
        nHit++;
        let h = hits[0];
        // coplanar opposite faces (ceiling of one space == floor of the next): the renderer shows the front one
        for (const k of hits) { if (k.distance - hits[0].distance > 0.015) break; const nk = k.face.normal.clone().transformDirection(k.object.matrixWorld); if (nk.dot(rc.ray.direction) < 0) { h = k; break; } }
        const mt = Array.isArray(h.object.material) ? h.object.material[h.face.materialIndex] : h.object.material;
        const orig = saved.get(mt);
        const nrm = h.face.normal.clone().transformDirection(h.object.matrixWorld);
        const back = nrm.dot(rc.ray.direction) > 0;
        const key = h.object.name + ' @' + grp(h.object);
        firsts[key] = (firsts[key] || 0) + 1;
        if (back && orig === THREE.FrontSide) {
          nLeak++;
          const k2 = key + (Math.abs(nrm.y) > 0.7 ? (nrm.y > 0 ? ' [floor-up seen from below]' : ' [ceil-down seen from above]') : ' [wall seen from behind]');
          leaks[k2] = leaks[k2] || { n: 0, p: [] };
          leaks[k2].n++; if (leaks[k2].p.length < 3) leaks[k2].p.push([h.point.x.toFixed(1), h.point.y.toFixed(2), h.point.z.toFixed(1)].join(','));
        }
      }
      for (const [mt, sd] of saved) mt.side = sd;
      const b = n.player.body;
      return { calls: s.calls, tris: s.tris, level: b.level, cam: [cam.position.x, cam.position.y, cam.position.z].map(v => v.toFixed(1)).join(','), nHit, nLeak, leaks: Object.entries(leaks).sort((a, b) => b[1].n - a[1].n).slice(0, 12), errors: n.errors.slice(), vis: n.visibility ? [...n.visibility.visibleLevels].join('') : '' };
    }, [RX, RY]);
    const name = 'pose_' + v.replace(/[^a-z0-9_.-]/gi, '_');
    if (!args.noshot) await page.screenshot({ path: path.join(out, name + '.png'), timeout: 180000 });
    console.log(`\n${v}  calls ${r.calls} tris ${(r.tris / 1000).toFixed(0)}k  cam ${r.cam} lv ${r.level} vis ${r.vis}  leak ${r.nLeak}/${r.nHit} (${(100 * r.nLeak / Math.max(1, r.nHit)).toFixed(1)}%)`);
    for (const [k, o] of r.leaks) console.log(`   ${String(o.n).padStart(4)}  ${k}   e.g. ${o.p.join(' | ')}`);
    if (r.errors.length) console.log('  system errors:', r.errors.join(' | '));
  }
} catch (e) { console.log('HARNESS ERROR', e.message); }
const uniq = [...new Set(errors)].filter(e => !/ERR_CERT|GL Driver|GPU stall|fonts\.g/.test(e));
console.log(uniq.length ? '--- console errors/warnings ---\n' + uniq.slice(0, 20).join('\n') : 'console: clean');
await browser.close(); release(); server.kill();
