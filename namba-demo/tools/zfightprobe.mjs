// Z-fight probe: finds coplanar, overlapping, opaque surfaces around poses along the route.
//   node tools/zfightprobe.mjs [--poses "L,x,z,yaw,pitch;..."] [--radius 30] [--frames 4] [--shot] [--out DIR]
//                              [--exact 0.0003] [--near 0.003] [--min 0.0004] [--top 12] [--root DIR] [--q high] [--hook FILE]
// Default poses: the demo route (Nankai -> CITY -> Parks bridge -> escalators / canyon loop -> 6F dining) + gardens.
//
// For each pose the page is teleported there and rendered from 4 yaws (lazy builders run, the visibility system
// shows what the player can see from that spot); every mesh that was visible in any of those frames (layer 0,
// visible chain, opaque, not crowd / escalator steps) within --radius of the camera is gathered. Its triangles go
// into buckets by plane (quantised normal + offset). Two triangles z-fight when they face the same way (or either
// material is double-sided), lie in the same plane within --exact metres (a "fight": shimmers at any distance) or
// --near metres ("far": shimmers beyond ~sqrt(gap*838860) m with near=0.05 / 24-bit depth), overlap by more than
// --min m^2 in the plane, and are not resolved by polygonOffset (different offset settings) or identical shading
// (same material, same vertex colour and UV at the overlap = an invisible duplicate). Pairs are merged into clusters
// (mesh/material pair + 1 m cell), and the probe prints, per pose, the clusters with their overlap area.
// Totals at the end: unique clusters (deduped across poses by location + materials) and total overlap area.
import { chromium } from 'playwright';
import { acquireSlot } from './slot.mjs';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
const __tooldir = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => { if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]); return a; }, []));
const root = path.resolve(args.root || path.resolve(__tooldir, '..'));
const out = path.resolve(args.out || '/tmp/zfight'); fs.mkdirSync(out, { recursive: true });
const ROUTE = [
  '3F,-25.5,20,0,0',        // Nankai platform (start)
  '3F,-16,-72,180,0',       // Nankai gates
  '2F,-10,-80,0,0',         // Nankai 2F
  '1F,0,50,180,0',          // CITY 1F
  '1F,-2,104,180,10',       // CITY 1F foot of 1F->2F
  '2F,0,150,180,0',         // CITY 2F mall
  '2F,0,197,180,10',        // bridge CITY -> Parks
  '2F,10,209,90,0',         // Parks 2F hall
  '2F,-2,216,180,10',       // Parks 2F escalator foot
  '2F,33,222,90,10',        // canyon, garden-stairs foot
  '2F,36,250,180,0',        // canyon mid
  '2F,40,300,180,0',        // canyon south
  '3F,60,224,90,0',         // 3F garden (top of the garden stairs)
  '3F,35,239,90,0',         // 3F canyon bridge
  '3F,14,239,-90,0',        // 3F canyon-view opening
  '3F,-1,245,180,0',        // Parks 3F corridor
  '4F,35,279,90,0',         // 4F canyon bridge
  '4F,-1,262,180,0',        // Parks 4F corridor
  '4F,70,270,90,0',         // 4F garden
  '5F,35,239,90,0',         // 5F bridge
  '5F,58,238,90,0',         // 5F deck
  '5F,-1,282,180,0',        // Parks 5F
  '6F,-1,300,180,0',        // 6F dining (Daikichi row)
  '6F,30,328,90,0',         // 6F skywalk
];
const poses = (args.poses ? String(args.poses).split(';') : ROUTE).filter(Boolean);
const port = 8000 + Math.floor(Math.random() * 900);
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 600));
const release = await acquireSlot('zfightprobe');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: +(args.w || 960), height: +(args.h || 540) } });
const errors = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
const OPT = { radius: +(args.radius || 30), exact: +(args.exact || 0.0003), near: +(args.near || 0.003), min: +(args.min || 0.0004), top: +(args.top || 12) };
const t0 = Date.now();
const all = new Map();
try {
  await page.goto(`http://127.0.0.1:${port}/index.html?test&quality=${args.q || 'high'}${args.extra != null ? args.extra : '&nocrowd'}`);
  await page.waitForFunction(() => window.__namba && window.__namba.ready, null, { timeout: 900000, polling: 500 });
  console.log('READY', ((Date.now() - t0) / 1000).toFixed(1) + 's');
  // --hook FILE: an ES module whose default export async (page, { out }) runs first in the same session (extra shots)
  if (args.hook) { const h = await import(path.resolve(String(args.hook))); await h.default(page, { out }); }
  for (const v of poses) {
    const [lv, x, z, yaw, pitch] = v.split(',');
    const base = { level: lv, x: +x, z: +z, yaw: (+yaw || 0) * Math.PI / 180, pitch: (+pitch || 0) * Math.PI / 180 };
    await page.evaluate(() => { window.__zfVis = new Set(); });
    // 4 yaws: union of everything the visibility system shows from this spot
    for (let k = 0; k < 4; k++) {
      await page.evaluate(p => window.__namba.teleport(p), { ...base, yaw: base.yaw + k * Math.PI / 2 });
      const f0 = await page.evaluate(() => window.__namba.engine.stats.frame);
      await page.waitForFunction(n => window.__namba.engine.stats.frame >= n, f0 + +(args.frames || (k ? 2 : 4)), { timeout: 900000, polling: 250 });
      await page.evaluate(() => {
        const n = window.__namba, cam = n.engine.camera;
        n.scene.traverseVisible(o => { if ((o.isMesh || o.isInstancedMesh) && !o.isSkinnedMesh && o.layers.test(cam.layers)) window.__zfVis.add(o); });
      });
    }
    await page.evaluate(p => window.__namba.teleport(p), base);
    const f1 = await page.evaluate(() => window.__namba.engine.stats.frame);
    await page.waitForFunction(n => window.__namba.engine.stats.frame >= n, f1 + 2, { timeout: 900000, polling: 250 });
    const r = await page.evaluate((OPT) => {
      const n = window.__namba, THREE = n.THREE, cam = n.engine.camera;
      const C = cam.getWorldPosition(new THREE.Vector3());
      const R2 = OPT.radius * OPT.radius;
      const SKIP = /crowd|people|esc_steps|human|npc|phone|sky|sun/i;
      const tris = []; // flat records
      const mats = [];
      const matId = new Map();
      const mid = (m) => { if (!matId.has(m)) { matId.set(m, mats.length); mats.push(m); } return matId.get(m); };
      const opaque = (m) => m && m.visible !== false && m.colorWrite !== false && m.depthTest !== false && !(m.transparent && (m.opacity < 0.95 || m.depthWrite === false)) && !m.alphaTest && !m.isShaderMaterial;
      const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3(), M = new THREE.Matrix4(), IM = new THREE.Matrix4();
      const ownerName = (o) => { let p = o; const parts = []; while (p && parts.length < 3) { if (p.name) parts.push(p.name); p = p.parent; } return parts.join('<'); };
      let nMesh = 0;
      for (const o of window.__zfVis) {
        if (SKIP.test(o.name) || SKIP.test(o.parent && o.parent.name || '')) continue;
        const g = o.geometry; if (!g || !g.attributes.position) continue;
        if (!g.boundingSphere) g.computeBoundingSphere();
        const mlist = [].concat(o.material);
        if (!mlist.some(opaque)) continue;
        const pos = g.attributes.position, idx = g.index, uv = g.attributes.uv, col = g.attributes.color;
        const count = o.isInstancedMesh ? Math.min(o.count, 4000) : 1;
        const groups = Array.isArray(o.material) && g.groups.length ? g.groups : [{ start: 0, count: idx ? idx.count : pos.count, materialIndex: 0 }];
        for (let inst = 0; inst < count; inst++) {
          M.copy(o.matrixWorld);
          if (o.isInstancedMesh) { o.getMatrixAt(inst, IM); M.multiply(IM); }
          const bs = g.boundingSphere.clone().applyMatrix4(M);
          if (bs.center.distanceTo(C) - bs.radius > OPT.radius) continue;
          nMesh++;
          for (const gr of groups) {
            const m = Array.isArray(o.material) ? o.material[gr.materialIndex] : o.material;
            if (!opaque(m)) continue;
            const mi = mid(m);
            const end = Math.min(gr.start + gr.count, idx ? idx.count : pos.count);
            for (let t = gr.start; t + 2 < end + 0; t += 3) {
              const i0 = idx ? idx.getX(t) : t, i1 = idx ? idx.getX(t + 1) : t + 1, i2 = idx ? idx.getX(t + 2) : t + 2;
              va.fromBufferAttribute(pos, i0).applyMatrix4(M); vb.fromBufferAttribute(pos, i1).applyMatrix4(M); vc.fromBufferAttribute(pos, i2).applyMatrix4(M);
              const cx = (va.x + vb.x + vc.x) / 3, cy = (va.y + vb.y + vc.y) / 3, cz = (va.z + vb.z + vc.z) / 3;
              const dd = (cx - C.x) ** 2 + (cy - C.y) ** 2 + (cz - C.z) ** 2;
              if (dd > R2 * 1.5) continue;
              const ux = vb.x - va.x, uy = vb.y - va.y, uz = vb.z - va.z, wx = vc.x - va.x, wy = vc.y - va.y, wz = vc.z - va.z;
              let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
              const ln = Math.hypot(nx, ny, nz); if (ln < 1e-7) continue; // degenerate (area < 5e-8)
              nx /= ln; ny /= ln; nz /= ln;
              const rec = { o, inst, mi, p: [va.x, va.y, va.z, vb.x, vb.y, vb.z, vc.x, vc.y, vc.z], n: [nx, ny, nz], d: nx * va.x + ny * va.y + nz * va.z, area: ln / 2, ds: m.side === THREE.DoubleSide };
              rec.uv = uv ? [uv.getX(i0), uv.getY(i0), uv.getX(i1), uv.getY(i1), uv.getX(i2), uv.getY(i2)] : null;
              rec.col = col ? [col.getX(i0), col.getY(i0), col.getZ(i0), col.getX(i1), col.getY(i1), col.getZ(i1), col.getX(i2), col.getY(i2), col.getZ(i2)] : null;
              if (o.isInstancedMesh && o.instanceColor) { const ic = new THREE.Color(); o.getColorAt(inst, ic); rec.ic = [ic.r, ic.g, ic.b]; }
              tris.push(rec);
            }
          }
        }
      }
      // ---- plane buckets: normal quantised to ~1.1 deg, offset in 2 cm bins (neighbouring bins checked) ----
      const NQ = 50, DB = 0.02;
      const nkey = (nx, ny, nz) => `${Math.round(nx * NQ)},${Math.round(ny * NQ)},${Math.round(nz * NQ)}`;
      const buckets = new Map();
      const put = (k, ti) => { let b = buckets.get(k); if (!b) buckets.set(k, b = []); b.push(ti); };
      tris.forEach((t, i) => {
        const db = Math.floor(t.d / DB);
        put(nkey(...t.n) + '|' + db, i);
        // double-sided: also fights with opposite-facing surfaces -> file it under the flipped plane too
        if (t.ds) put(nkey(-t.n[0], -t.n[1], -t.n[2]) + '|' + Math.floor(-t.d / DB), i);
      });
      // ---- 2D clip helpers ----
      const proj = (t, ax) => { const p = t.p; const a = ax === 0 ? [1, 2] : ax === 1 ? [0, 2] : [0, 1]; return [[p[a[0]], p[a[1]]], [p[3 + a[0]], p[3 + a[1]]], [p[6 + a[0]], p[6 + a[1]]]]; };
      const area2 = (P) => { let s = 0; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
      const clip = (subj, clipP) => {
        // Sutherland-Hodgman; clipP must be CCW
        let outP = subj;
        for (let i = 0; i < clipP.length && outP.length; i++) {
          const A = clipP[i], B = clipP[(i + 1) % clipP.length];
          const side = (p) => (B[0] - A[0]) * (p[1] - A[1]) - (B[1] - A[1]) * (p[0] - A[0]);
          const inp = outP; outP = [];
          for (let j = 0; j < inp.length; j++) {
            const P = inp[j], Q = inp[(j + 1) % inp.length];
            const sp = side(P), sq = side(Q), pi = sp >= -1e-9, qi = sq >= -1e-9;
            if (pi) outP.push(P);
            if (pi !== qi) { const t = sp / (sp - sq); outP.push([P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t]); }
          }
        }
        return outP;
      };
      const ccw = (P) => area2(P) < 0 ? [P[0], P[2], P[1]] : P;
      // barycentric attribute at 2D point
      const bary = (T, q) => { const [a, b, c] = T; const v0x = b[0] - a[0], v0y = b[1] - a[1], v1x = c[0] - a[0], v1y = c[1] - a[1], v2x = q[0] - a[0], v2y = q[1] - a[1]; const den = v0x * v1y - v1x * v0y; if (Math.abs(den) < 1e-12) return [1 / 3, 1 / 3, 1 / 3]; const v = (v2x * v1y - v1x * v2y) / den, w = (v0x * v2y - v2x * v0y) / den; return [1 - v - w, v, w]; };
      const attr = (arr, k, w) => { if (!arr) return null; const out = []; for (let c = 0; c < k; c++) out.push(arr[c] * w[0] + arr[k + c] * w[1] + arr[2 * k + c] * w[2]); return out; };
      const diff = (a, b) => { if (!a || !b) return a || b ? 1 : 0; let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
      const offKey = (m) => m.polygonOffset ? `${m.polygonOffsetFactor}/${m.polygonOffsetUnits}` : '0';
      const inTri = (T, x, y) => { const s = (a, b) => (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]); const d1 = s(T[0], T[1]), d2 = s(T[1], T[2]), d3 = s(T[2], T[0]); return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0)); };
      const buried = (A, ax, x, y) => {
        const nk2 = nkey(-A.n[0], -A.n[1], -A.n[2]), db2 = Math.floor(-A.d / DB);
        for (let k = -1; k <= 1; k++) {
          const lst = buckets.get(nk2 + '|' + (db2 + k)); if (!lst) continue;
          for (const ti of lst) {
            const T = tris[ti];
            if (T.n[0] * A.n[0] + T.n[1] * A.n[1] + T.n[2] * A.n[2] > -0.9997 || Math.abs(T.d + A.d) > 0.012) continue;
            if (inTri(proj(T, ax), x, y)) return true;
          }
        }
        return false;
      };
      const clusters = new Map();
      let pairs = 0;
      for (const [key, list] of buckets) {
        const [nk, dbs] = key.split('|'); const db = +dbs;
        // candidates: this bin and the next bin up (pairs across bins are seen once)
        const nb = buckets.get(nk + '|' + (db + 1)) || [];
        const L2 = list.concat(nb);
        if (L2.length < 2) continue;
        // 2D grid within the bucket
        const t0 = tris[list[0]];
        const ax = Math.abs(t0.n[0]) > Math.abs(t0.n[1]) ? (Math.abs(t0.n[0]) > Math.abs(t0.n[2]) ? 0 : 2) : (Math.abs(t0.n[1]) > Math.abs(t0.n[2]) ? 1 : 2);
        const cells = new Map(); const big = [];
        const P2 = L2.map(i => proj(tris[i], ax));
        L2.forEach((ti, j) => {
          const P = P2[j];
          const x0 = Math.floor(Math.min(P[0][0], P[1][0], P[2][0])), x1 = Math.floor(Math.max(P[0][0], P[1][0], P[2][0]));
          const y0 = Math.floor(Math.min(P[0][1], P[1][1], P[2][1])), y1 = Math.floor(Math.max(P[0][1], P[1][1], P[2][1]));
          if ((x1 - x0 + 1) * (y1 - y0 + 1) > 400) { big.push(j); return; }
          for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) { const k = x * 100003 + y; let c = cells.get(k); if (!c) cells.set(k, c = []); c.push(j); }
        });
        const seen = new Set();
        const tryPair = (ja, jb) => {
          if (ja === jb) return;
          const a0 = Math.min(ja, jb), b0 = Math.max(ja, jb);
          const inA = a0 < list.length, inB = b0 < list.length;
          if (!inA && !inB) return; // both in the neighbour bin: handled by that bin
          const pk = a0 * 1e6 + b0; if (seen.has(pk)) return; seen.add(pk);
          const A = tris[L2[a0]], B = tris[L2[b0]];
          if (A === B) return;
          if (A.o === B.o && A.inst === B.inst && A.mi === B.mi && A.p.every((v, i) => Math.abs(v - B.p[i]) < 1e-6)) return;
          // same plane? (opposite-facing only if one of them is double-sided)
          const dot = A.n[0] * B.n[0] + A.n[1] * B.n[1] + A.n[2] * B.n[2];
          let gap;
          if (dot > 0.9997) gap = Math.abs(A.d - B.d);
          else if (dot < -0.9997 && (A.ds || B.ds)) gap = Math.abs(A.d + B.d);
          else return;
          if (gap > OPT.near) return;
          const mA = mats[A.mi], mB = mats[B.mi];
          if (offKey(mA) !== offKey(mB)) return; // polygonOffset resolves it
          const PA = ccw(P2[a0]), PB = ccw(P2[b0]);
          const I = clip(PA, PB);
          if (I.length < 3) return;
          const ar = Math.min(Math.abs(area2(I)) / Math.max(1e-6, Math.abs(t0.n[ax])), A.area, B.area);
          if (ar < OPT.min) return;
          // buried: an opposite-facing opaque surface in contact covers the overlap (box bottoms on a floor,
          // a panel's back against a wall): neither face can be seen, so there is nothing to fight over
          {
            let cx = 0, cy = 0; for (const q of I) { cx += q[0]; cy += q[1]; } cx /= I.length; cy /= I.length;
            if (buried(A, ax, cx, cy)) return;
          }
          // identical shading at the overlap = invisible duplicate
          if (A.mi === B.mi) {
            let cx = 0, cy = 0; for (const q of I) { cx += q[0]; cy += q[1]; } cx /= I.length; cy /= I.length;
            const wa = bary(P2[a0], [cx, cy]), wb = bary(P2[b0], [cx, cy]);
            const ua = attr(A.uv, 2, wa), ub = attr(B.uv, 2, wb), ca = attr(A.col, 3, wa), cb = attr(B.col, 3, wb);
            const tex = !!(mats[A.mi].map);
            if ((!tex || diff(ua, ub) < 0.02) && diff(ca, cb) < 0.03 && diff(A.ic, B.ic) < 0.03) return;
          }
          pairs++;
          const cxw = (A.p[0] + A.p[3] + A.p[6]) / 3, cyw = (A.p[1] + A.p[4] + A.p[7]) / 3, czw = (A.p[2] + A.p[5] + A.p[8]) / 3;
          const nmA = `${ownerName(A.o)}:${mA.name || mA.type}`, nmB = `${ownerName(B.o)}:${mB.name || mB.type}`;
          const pair = nmA < nmB ? nmA + ' x ' + nmB : nmB + ' x ' + nmA;
          const kind = gap <= OPT.exact ? 'fight' : 'far';
          const ck = `${kind}|${pair}|${Math.floor(cxw)},${Math.floor(cyw)},${Math.floor(czw)}`;
          const c = clusters.get(ck) || { kind, pair, area: 0, n: 0, at: [cxw, cyw, czw].map(v => +v.toFixed(2)), gap: 0, nrm: A.n.map(v => +v.toFixed(2)), dist: +Math.hypot(cxw - C.x, cyw - C.y, czw - C.z).toFixed(1) };
          c.area += ar; c.n++; c.gap = Math.max(c.gap, gap);
          clusters.set(ck, c);
        };
        for (const c of cells.values()) for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++) tryPair(c[i], c[j]);
        for (const j of big) for (let i = 0; i < L2.length; i++) tryPair(j, i);
      }
      const b = n.player.body;
      return { cam: [C.x, C.y, C.z].map(v => v.toFixed(1)).join(','), level: b.level, nMesh, nTri: tris.length, pairs, clusters: [...clusters.values()], calls: n.engine.stats.calls, errors: n.errors.slice() };
    }, OPT);
    const fights = r.clusters.filter(c => c.kind === 'fight'), far = r.clusters.filter(c => c.kind === 'far');
    const A = (l) => l.reduce((s, c) => s + c.area, 0);
    console.log(`\n${v}  cam ${r.cam}  meshes ${r.nMesh} tris ${(r.nTri / 1000).toFixed(0)}k  calls ${r.calls}  fight clusters ${fights.length} (${A(fights).toFixed(2)} m2)  far-risk ${far.length} (${A(far).toFixed(2)} m2)`);
    // group clusters by material pair for the printout
    const byPair = new Map();
    for (const c of r.clusters) { const k = c.kind + ' ' + c.pair; const g = byPair.get(k) || { k, n: 0, area: 0, at: [], gap: 0 }; g.n++; g.area += c.area; g.gap = Math.max(g.gap, c.gap); if (g.at.length < 3) g.at.push(c.at.join(',') + ' n' + c.nrm.join('/') + ' d' + c.dist); byPair.set(k, g); }
    for (const g of [...byPair.values()].sort((a, b) => b.area - a.area).slice(0, OPT.top)) console.log(`   ${g.area.toFixed(3).padStart(8)} m2  ${String(g.n).padStart(4)} cl  gap<=${(g.gap * 1000).toFixed(1)}mm  ${g.k}   e.g. ${g.at.join(' | ')}`);
    for (const c of r.clusters) { const k = `${c.kind}|${c.pair}|${c.at.map(Math.floor).join(',')}`; if (!all.has(k)) all.set(k, c); }
    if (r.errors.length) console.log('  system errors:', r.errors.join(' | '));
    if (args.shot) await page.screenshot({ path: path.join(out, 'zf_' + v.replace(/[^a-z0-9_.-]/gi, '_') + '.png'), timeout: 180000 });
  }
} catch (e) { console.log('HARNESS ERROR', e.message); }
const U = [...all.values()];
const F = U.filter(c => c.kind === 'fight'), N = U.filter(c => c.kind === 'far');
console.log(`\nTOTAL unique clusters: fight ${F.length} (${F.reduce((s, c) => s + c.area, 0).toFixed(2)} m2), far-risk ${N.length} (${N.reduce((s, c) => s + c.area, 0).toFixed(2)} m2)`);
const byMat = new Map();
for (const c of U) { const k = c.kind + ' ' + c.pair.replace(/[^ ]*</g, ''); const g = byMat.get(k) || { n: 0, area: 0 }; g.n++; g.area += c.area; byMat.set(k, g); }
for (const [k, g] of [...byMat.entries()].sort((a, b) => b[1].area - a[1].area).slice(0, 30)) console.log(`  ${g.area.toFixed(2).padStart(8)} m2 ${String(g.n).padStart(4)}  ${k}`);
if (args.json) fs.writeFileSync(path.join(out, 'zfight.json'), JSON.stringify(U, null, 1));
const uniq = [...new Set(errors)].filter(e => !/ERR_CERT|GL Driver|GPU stall|fonts\.g/.test(e));
console.log(uniq.length ? '--- console errors/warnings ---\n' + uniq.slice(0, 20).join('\n') : 'console: clean');
await browser.close(); release(); server.kill();
