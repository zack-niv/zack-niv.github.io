// Usage: node tools/check-layout.mjs [outDir]
// Builds the world + nav graph headlessly, reports connectivity problems and
// writes a PNG plan image per level (white=walk, grey=void, brown=track,
// blue=ramp, red=walls, unreachable cells magenta).
import { World, CELL } from '../js/world/world.js';
import { Nav } from '../js/world/nav.js';
import { LAYOUT } from '../js/world/layout.js';
import fs from 'fs';
import zlib from 'zlib';
function png(w, h, rgb) {
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = b => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const out = process.argv[2];
let t = performance.now();
const W = new World();
console.log('world built', (performance.now() - t).toFixed(0), 'ms');
for (const lv in W.grids) { const g = W.grids[lv]; console.log(lv, g.w + 'x' + g.h, 'edges', W.edges[lv].length, 'segs', W.segs[lv].length); }
t = performance.now();
const N = new Nav(W);
console.log('nav built', (performance.now() - t).toFixed(0), 'ms', N.N, 'nodes', N.edgeCount, 'edges');
const sp = LAYOUT.spawns.start;
t = performance.now();
// reachability FROM start: compute field to start using reverse edges = who can reach start.
// We want both: can start reach X (forward) and can X reach start.
const toStart = N.field('toStart', [N.nodeAtPoint(sp.level, sp.x, sp.z)]);
console.log('field', (performance.now() - t).toFixed(0), 'ms');
let bad = 0;
for (const [name, s] of Object.entries(LAYOUT.spawns)) {
  const v = N.nodeAtPoint(s.level, s.x, s.z);
  const f = N.field('sp_' + name, [v]);
  const a = toStart.dist[v], b = f.dist[N.nodeAtPoint(sp.level, sp.x, sp.z)];
  if (!(isFinite(a) && isFinite(b))) { bad++; console.log('SPAWN UNREACHABLE', name, 'to start', a, 'from start', b); }
  else console.log('  spawn', name.padEnd(14), 'walk to start', a.toFixed(0) + 'm', ' from start', b.toFixed(0) + 'm');
}
const fromStart = N.field('sp_start', [N.nodeAtPoint(sp.level, sp.x, sp.z)]); // dist to start
// shops: any cell of the shop reachable?
const unreachableShops = [];
for (const sh of LAYOUT.shopSlots) {
  const [x0, z0, x1, z1] = sh.rect;
  const v = N.nodeAtPoint(sh.level, (x0 + x1) / 2, (z0 + z1) / 2);
  if (v < 0 || !isFinite(toStart.dist[v])) unreachableShops.push(sh.id);
}
console.log('unreachable shops:', unreachableShops.length, unreachableShops.join(' '));
// unreachable walk cells per space
const spaceBad = {};
for (const lv in W.grids) {
  const g = W.grids[lv], map = N.cellNode[lv];
  for (let i = 0; i < map.length; i++) if (map[i] >= 0 && !isFinite(toStart.dist[map[i]])) {
    const s = LAYOUT.spaces[g.space[i]]; spaceBad[s.id] = (spaceBad[s.id] || 0) + 1;
  }
}
const sb = Object.entries(spaceBad).filter(([k]) => !k.match(/^(walk_|city_|link_e|parks_.*(w|e|dw|de)\d\d)/));
console.log('non-shop spaces with unreachable cells:', sb.map(([k, v]) => `${k}(${v})`).join(' ') || 'none');
if (out) {
  fs.mkdirSync(out, { recursive: true });
  for (const lv in W.grids) {
    const g = W.grids[lv], S = 3, w = g.w * S, h = g.h * S;
    const px = Buffer.alloc(w * h * 3, 20);
    const map = N.cellNode[lv];
    const put = (x, y, c) => { if (x < 0 || y < 0 || x >= w || y >= h) return; const o = (y * w + x) * 3; px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; };
    for (let cz = 0; cz < g.h; cz++) for (let cx = 0; cx < g.w; cx++) {
      const i = cz * g.w + cx; const t = g.type[i];
      let c = [20, 20, 20];
      if (t === CELL.WALK) { const s = LAYOUT.spaces[g.space[i]]; c = s.kind === 'room' ? [190, 190, 170] : s.outdoor ? [170, 220, 170] : [235, 235, 235]; if (map[i] >= 0 && !isFinite(toStart.dist[map[i]])) c = [255, 0, 255]; if (g.blocked[i]) c = [120, 120, 120]; }
      if (t === CELL.VOID) c = [80, 80, 110];
      if (t === CELL.TRACK) c = [110, 80, 50];
      if (t === CELL.RAMP) c = [90, 140, 230];
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) put(cx * S + x, cz * S + y, c);
    }
    const col = { wall: [220, 30, 30], partition: [160, 60, 60], rail: [30, 200, 220], rampSide: [30, 60, 200], track: [240, 160, 0] };
    for (const e of W.edges[lv]) {
      const c = col[e.kind];
      const ax = (e.ax - g.x0) * S, az = (e.az - g.z0) * S, bx = (e.bx - g.x0) * S, bz = (e.bz - g.z0) * S;
      for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) for (let z = Math.min(az, bz); z <= Math.max(az, bz); z++) put(x, z, c);
    }
    fs.writeFileSync(`${out}/${lv}.png`, png(w, h, px));
  }
}
process.exit(bad ? 1 : 0);
