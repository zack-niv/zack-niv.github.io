// =============================================================================
// Shops: storefronts + walkable interiors for every slot in world/directory.js,
// the Takashimaya depachika (B1) and cosmetics hall (1F).
//
// Build strategy (load budget): init() runs a cheap LOGIC pass for every shop
// (collision boxes, crowd spots, shutters, light declarations — no geometry,
// no canvas drawing). Geometry is produced lazily by a deterministic REPLAY of
// the same code with real painters, per 32 m chunk, when the camera comes
// within ~80 m (time-sliced in update(), or synchronously on teleport).
//
// Public API (for crowd / game / phone):
//   ctx.shops.spots(slotId)      -> [{x,z,level,yaw,kind}] kind: browse|counter|queue|seat|staff
//   ctx.shops.counter(slotId)    -> {x,z,level,yaw,kind:'counter'} service point (order here)
//   ctx.shops.queuePoints(slotId)-> [{x,z,level,yaw}] first = at the door, then back along the line
//   ctx.shops.seats(slotId)      -> [{x,z,level,yaw,sit:true}] real chairs/stools to sit on
//   ctx.shops.hallSpots(spaceId) -> spots of 'taka_b1' (depachika) / 'taka_1f' (staff spots carry outfit hints)
//   ctx.shops.isShuttered(slotId)-> true while the shutter is down (outside opening hours)
//   ctx.shops.record(slotId)     -> { b, cx, cz, level, W, D, front }
//   ctx.shops.buildNear(level, x, z, r) -> force-build geometry around a point now
// 'staff' spots may sit inside counter areas (spawn in place, don't path).
// Events: emits 'shop:shutter' { slot, closed } when a shutter opens/closes.
// =============================================================================
import * as THREE from 'three';
import { BUSINESSES, isOpen } from './directory.js?v=f150c03';
import { LAYOUT, LEVELS } from './layout.js?v=f150c03';
import { GeoBatch } from '../render/geobatch.js?v=f150c03';
import { Atlas } from './env/atlas.js?v=f150c03';
import { defineMaterials, ChunkBatches, loadFonts, STUB_REGION } from './env/kit.js?v=f150c03';
import { ShopCtx } from './env/shopctx.js?v=f150c03';
import { POSTER_TEXT } from './env/posters.js?v=f150c03';
import { buildShop, regions } from './env/shopbuild.js?v=f150c03';
import { FEATURED_BUILD, FEATURED_STYLE, buildDepachika, buildTaka1F, Hall } from './env/featured.js?v=f150c03';

// v2 counters contract: business category -> counter kind / staff role
const COUNTER_KIND = {
  cafe: 'cafe', kissaten: 'cafe', coffeestand: 'cafe', bakery: 'cafe', sweets: 'food', takoyaki: 'food',
  tempura: 'tempura', tendon: 'tempura',
  conbini: 'shop', books: 'shop', drugstore: 'shop', phone: 'shop', ticket: 'shop', exchange: 'shop', souvenir: 'shop', florist: 'shop',
};
const ROLE = { cafe: 'barista', kissaten: 'barista', coffeestand: 'barista', bakery: 'clerk', sweets: 'clerk', takoyaki: 'chef' };
const CHUNK = 32;
const FRONT_R = 190;      // shopfronts (cheap: fascia, glazing, samples) are built out to here
const INT_R = 62;         // interiors are built within this ...
const INT_FREE_R = 125;   // ... and released again beyond this (bounded memory)
const HALL_R = 110;       // halls (depachika, Takashimaya 1F)
const FORCE_FRONT_R = 120;   // synchronous radii on teleport
const FORCE_INT_R = 46;
const BUDGET_MS = 12;

// one shared environment context (atlases, chunk batches) for shops + props
export function envFor(ctx) {
  if (ctx._envDressing) return ctx._envDressing;
  defineMaterials(ctx.materials);
  const env = {
    ctx, world: ctx.world, materials: ctx.materials,
    sign: new Atlas('env_sign', { lit: true, glow: 2.0 }),
    print: new Atlas('env_print', { lit: false, boost: 0.28 }),
    // posters: own pages (exact 2:3 / 16:9 canvases), wide gutters + edge bleed so mips never leak neighbours
    poster: new Atlas('env_poster', { lit: false, boost: 0.40, pad: 8, aniso: 16 }),
    chunks: new ChunkBatches(CHUNK, 'env'),
    lights: [],
  };
  // tactile paving segments per level (dressing must keep clear of them)
  env.tactile = {};
  for (const t of LAYOUT.tactile || []) {
    const L = env.tactile[t.level] || (env.tactile[t.level] = []);
    const pts = t.pts || [];
    for (let i = 0; i + 1 < pts.length; i++) L.push([pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]]);
    for (const p of [...(t.stops || []), ...(pts.length === 1 ? pts : [])]) L.push([p[0], p[1], p[0] + 0.01, p[1]]);
  }
  env.R = regions(env);
  // stub regions for logic passes (nothing drawn)
  env.stubR = new Proxy({}, { get: () => () => STUB_REGION });
  env.fonts = loadFonts([glyphText()]).then(() => { env.fontsReady = true; });
  setTimeout(() => { env.fontsReady = true; }, 4000);
  ctx._envDressing = env;
  return env;
}

// every non-ASCII glyph we draw (so the webfont unicode-range subsets load)
function glyphText() {
  let txt = BUSINESSES.map(b => b.ja + b.en).join('');
  txt += '営業中準備中改装中閉店喫煙室試着室会計関係者以外立入禁止最後尾本日のおすすめ焼きたて二度づけ禁止秋の味覚フェア食料品売場高島屋御菓子司桜月和菓子京華堂甘味処一福お弁当花かご惣菜なにわ厨鮨魚政柿の葉すし吉野天ぷら天佐焼鳥鳥久中華金龍京漬物よしだフルーツ果琳宇治茶茶匠おかき播磨屋豚まん蓬莱軒';
  txt += 'らーめんうどん寿司とんかつカレー天丼お好み焼串かつ居酒屋焼肉洋食喫茶珈琲パン菓たこ薬みやげ本文具花ガチャ金券厨房自動ドア激安特価人気新数量限定円税込おつり返却食券つめた〜いあったか〜いお〜いお茶';
  txt += '醤油味玉チャーシュー麺つけ餃子ライス生ビールきつね肉釜玉いなり上海老野菜小そばみそ汁定食海老天きす舞茸ハイボールビーフカツチキントッピング大盛りにぎり並ちらし鉄火巻赤だしランチ握りロースヒレミックスフライ丼キャベツおかわり自由豚モダンねぎ焼きそば串どて土手盛合せだし巻き玉子枝豆唐揚げ日本酒特上カルビタン塩ホルモンセットビビンバオムライスハンバーグエビナポリタンシチューブレンドラテ抹茶チーズケーキ季節タルトサンドイッチモーニングクリームソーダ厚切りトーストジュースプリンハンドドリップエスプレッソ豆クロワッサンメロンあん詰め合わせお土産箱個明石';
  txt += '秋冬コレクション入荷セール最大医薬品化粧品毎日安いうるおい続く新登場マロン乾杯夜明けの境界線全国ロードショーいのち輝く未来へ大阪関西みらい高野山特急で北斎と浪華浮世絵市立美術館機種のりかえ還元ラーメン博なんばパークスハロウィンごくっと新幹線回数券高速バス切手営業時間開店';
  txt += POSTER_TEXT + 'ご注文はこちらドリンクスイーツおすすめ本日の豆若草珈琲';
  txt += 'ウォーク新作入荷激安特価人気限定開催中ペットボトル缶びん燃えるゴミカプセルトイ時間運行情報平常どおり南海電車御堂筋線千日前線ご利用ありがとうございます開催中ハロウィンフェア';
  return txt;
}

export class Shops {
  constructor(ctx) {
    this.ctx = ctx;
    this.recs = new Map();
    this.halls = {};
    this.units = [];
    this._t = 0; this._q = 0;
    this._shutterReady = false;
  }

  async init() {
    const ctx = this.ctx;
    const t0 = performance.now();
    const env = envFor(ctx);
    this.env = env;
    if (!ctx.counters) ctx.counters = [];
    const bySlot = new Map(BUSINESSES.map(b => [b.slot, b]));
    const unitMap = new Map();
    // ---- logic pass: obstacles, spots, lights (no geometry) --------------------
    for (const slot of LAYOUT.shopSlots) {
      const b = bySlot.get(slot.id);
      if (!b) continue;
      try {
        const S = new ShopCtx(env, slot, b);
        if (b.key && FEATURED_STYLE[b.key]) S.styleOverride = FEATURED_STYLE[b.key];
        this._run(S, env.stubR);
        if (!S.counterPt) S.spot('counter', S.W / 2, Math.min(2, S.D - 1), 0, 1);
        if (!S.queue.length) S.spot('queue', S.W / 2, -0.7, 0, 1);
        const rec = { b, S, group: null, cx: S.cx, cz: S.cz, y: S.y + 1.5, level: slot.level, spots: S.spots, counter: S.counterPt, queue: S.queue, closedNow: null };
        this.recs.set(slot.id, rec);
        for (const l of S.lights) env.lights.push(l);
        const k = `${slot.level}|${Math.floor(S.cx / CHUNK)}|${Math.floor(S.cz / CHUNK)}`;
        let u = unitMap.get(k);
        if (!u) unitMap.set(k, u = { kind: 'chunk', key: k, level: slot.level, x: (Math.floor(S.cx / CHUNK) + 0.5) * CHUNK, z: (Math.floor(S.cz / CHUNK) + 0.5) * CHUNK, y: S.y + 1.5, recs: [], built: false, frontBuilt: false });
        u.recs.push(rec);
      } catch (e) {
        console.error('[shops] slot', slot.id, e);
        ctx.errors.push(`shops: ${slot.id}: ${e.message}`);
      }
    }
    this.units = [...unitMap.values()];
    this._collectCounters();
    for (const [id, fn] of [['taka_b1', buildDepachika], ['taka_1f', buildTaka1F]]) {
      try {
        const H = new Hall(env, id);
        if (!H.sp) continue;
        fn(env, env.stubR, H);
        this.halls[id] = H;
        const [x0, z0, x1, z1] = H.sp.rect;
        this.units.push({ kind: 'hall', key: id, hall: H, fn, level: H.level, x: (x0 + x1) / 2, z: (z0 + z1) / 2, y: H.y + 1.5, rect: H.sp.rect, built: false });
      } catch (e) { console.error('[shops] hall', id, e); ctx.errors.push(`shops: ${id} ${e.message}`); }
    }
    this._buildShutters();
    // props' merged chunks + every declared light (before lighting bakes)
    this.afterBuild();
    ctx.events.on('player:teleport', () => this._forceNear());
    this.stats = { initMs: Math.round(performance.now() - t0), shops: this.recs.size, units: this.units.length };
  }

  // ---- v2 contract: ctx.counters (staff post + order spot per café / food place / key clerk shop) --------------------
  // Templates call S.service(role, [a,d] order, [a,d] staff). Anything without one falls back to its crowd 'counter'
  // spot + nearest 'staff' spot. Order spots are snapped to a free, reachable shop cell (and re-checked against the
  // nav grid in _validateSpots, mutating the same objects so consumers can hold the array).
  _collectCounters() {
    const ctx = this.ctx, out = ctx.counters;
    out.length = 0;
    for (const rec of this.recs.values()) {
      const S = rec.S, b = rec.b, cat = b.cat;
      if (cat === 'closed') continue;
      const kind = COUNTER_KIND[cat] || (b.info && b.info.food ? 'food' : null);
      if (!kind) continue;
      let svc = S.svc;
      if (!svc) {
        const c = rec.counter, st = S.spots.filter(s => s.kind === 'staff').sort((p, q) => Math.hypot(p.x - c.x, p.z - c.z) - Math.hypot(q.x - c.x, q.z - c.z))[0];
        if (!c || !st) continue;
        const lo = S.local(c.x, c.z), ls = S.local(st.x, st.z);
        svc = { role: null, order: { a: lo.a, d: lo.d }, staff: { a: ls.a, d: ls.d } };
      }
      // snap the order point to a free, reachable cell of the shop
      let { a, d } = svc.order;
      const ci = Math.floor(a), cj = Math.floor(d);
      if (d >= 0 && !S.free(ci, cj)) {   // d < 0: take-away counters are served from the corridor (nav check later)
        let best = null;
        for (let r = 1; r <= 3 && !best; r++) for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
          if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r || !S.free(i, j)) continue;
          const dd = Math.hypot(i + 0.5 - a, j + 0.5 - d);
          if (!best || dd < best.dd) best = { i, j, dd };
        }
        if (!best) continue;
        a = best.i + 0.5; d = best.j + 0.5;
      }
      const ow = S.world(a, d), sw = S.world(svc.staff.a, svc.staff.d);
      const yaw = Math.atan2(-(ow.x - sw.x), -(ow.z - sw.z));
      const role = svc.role || ROLE[cat] || (kind === 'cafe' ? 'barista' : kind === 'shop' ? 'clerk' : 'chef');
      const entry = { slotId: b.slot, name: b.en, kind, level: b.level, staff: { x: sw.x, y: S.y, z: sw.z, yaw }, order: { x: ow.x, y: S.y, z: ow.z }, role };
      out.push(entry);
      rec.service = entry;
    }
  }

  _run(S, R) {
    buildShop(S, R);
    if (S.b.key && FEATURED_BUILD[S.b.key]) FEATURED_BUILD[S.b.key](S);
  }

  afterBuild() {
    const env = this.env || envFor(this.ctx);
    if (!env._chunksBuilt) { env._chunksBuilt = true; env.chunks.build(this.ctx); }
    if (!env._lightsAdded && this.ctx.lighting) {
      env._lightsAdded = true;
      for (const l of env.lights) this.ctx.lighting.addLight(l);
    }
  }

  // ---- lazy geometry ------------------------------------------------------------
  // Three kinds of work units:
  //   chunk fronts   one merged batch per 32 m chunk (fascia, glazing, cases, noren ...)
  //   shop interior  one small group per shop (furniture, merchandise); built near, released far
  //   hall           depachika / Takashimaya 1F, built whole when close
  _buildFront(u) {
    if (u.frontBuilt) return;
    u.frontBuilt = true;
    const ctx = this.ctx, R = this.env.R;
    const gb = new GeoBatch();
    for (const rec of u.recs) {
      const S = rec.S;
      try { S.begin(gb, null); this._run(S, R); S.end(); }
      catch (e) { S.replay = false; console.error('[shops] front', S.slot.id, e); ctx.errors.push(`shops: front ${S.slot.id}: ${e.message}`); }
    }
    const grp = new THREE.Group();
    grp.name = 'shopfronts:' + u.key;
    grp.userData.chunk = { level: u.level, x: u.x, z: u.z, r: CHUNK * 0.8 };
    for (const m of gb.build(ctx.materials, { name: 'shopfront' })) { m.receiveShadow = false; grp.add(m); }
    ctx.engine.levelRoot(u.level).add(grp);
    u.group = grp;
  }
  _buildInterior(rec) {
    if (rec.group || rec.intBusy) return;
    const ctx = this.ctx, S = rec.S;
    try {
      const gb = new GeoBatch();
      S.begin(null, gb); this._run(S, this.env.R); S.end();
      const group = new THREE.Group();
      group.name = 'shop:' + S.slot.id;
      group.userData.chunk = { level: rec.level, x: S.cx, z: S.cz, r: Math.hypot(S.W, S.D) / 2 + 1 };
      for (const m of gb.build(ctx.materials, { name: 'shop' })) { m.receiveShadow = false; group.add(m); }
      // visible straight away when in range (the 0.2 s distance pass would otherwise leave it empty for a few frames)
      { const b = ctx.player && ctx.player.body, cam = b ? { x: b.x, y: (b.y || 0) + 1.6, z: b.z } : ctx.engine.camera.position, far = ctx.engine.qualityName === 'low' ? 30 : 46;
        const dx = rec.cx - cam.x, dy = (rec.y - cam.y) * 3, dz = rec.cz - cam.z; group.visible = dx * dx + dy * dy + dz * dz < far * far; }
      ctx.engine.levelRoot(rec.level).add(group);
      rec.group = group;
    } catch (e) { S.replay = false; console.error('[shops] interior', S.slot.id, e); ctx.errors.push(`shops: interior ${S.slot.id}: ${e.message}`); rec.intBusy = true; }
  }
  _releaseInterior(rec) {
    const g = rec.group; if (!g) return;
    g.parent && g.parent.remove(g);
    g.traverse(o => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
    rec.group = null;
  }
  _buildHall(u) {
    if (u.built) return;
    u.built = true;
    try { u.hall.begin(); u.fn(this.env, this.env.R, u.hall); u.groups = u.hall.end(); }
    catch (e) { console.error('[shops] hall', u.key, e); this.ctx.errors.push(`shops: hall ${u.key}: ${e.message}`); }
  }
  _buildUnit(u) { if (u.kind === 'hall') this._buildHall(u); else this._buildFront(u); }
  _dist2(u, p) {
    let dx, dz;
    if (u.rect) { dx = Math.max(u.rect[0] - p.x, 0, p.x - u.rect[2]); dz = Math.max(u.rect[1] - p.z, 0, p.z - u.rect[3]); }
    else { dx = Math.max(0, Math.abs(u.x - p.x) - CHUNK / 2); dz = Math.max(0, Math.abs(u.z - p.z) - CHUNK / 2); }
    const dy = (u.y - p.y) * 3;
    return dx * dx + dz * dz + dy * dy;
  }
  _recDist2(rec, p) { const dx = rec.cx - p.x, dz = rec.cz - p.z, dy = (rec.y - p.y) * 3; return dx * dx + dz * dz + dy * dy; }
  _forceNear() {
    if (!this.env.fontsReady) { this._pendingForce = true; return; }
    this._pendingForce = false;
    const p = this.ctx.engine.camera.position;
    const b = this.ctx.player && this.ctx.player.body;
    const pos = b ? { x: b.x, y: (b.y || 0) + 1.6, z: b.z } : p;
    this.buildNear(null, pos.x, pos.z, FORCE_FRONT_R, pos.y, FORCE_INT_R);
  }
  buildNear(level, x, z, r = FORCE_FRONT_R, y, ri = FORCE_INT_R) {
    const yy = y != null ? y : (level ? LEVELS[level].y + 1.6 : this.ctx.engine.camera.position.y);
    const p = { x, y: yy, z };
    for (const u of this.units) {
      if (u.kind === 'hall') { if (!u.built && this._dist2(u, p) < HALL_R * HALL_R) this._buildHall(u); continue; }
      if (!u.frontBuilt && this._dist2(u, p) < r * r) this._buildFront(u);
    }
    for (const rec of this.recs.values()) if (!rec.group && this._recDist2(rec, p) < ri * ri) this._buildInterior(rec);
  }
  buildAll() {
    for (const u of this.units) this._buildUnit(u);
    for (const rec of this.recs.values()) this._buildInterior(rec);
  }

  // ---- shutters ---------------------------------------------------------------
  _buildShutters() {
    const ctx = this.ctx;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = ctx.materials.get('env_shutter');
    if (mat.map) mat.map.repeat.set(1, 3);
    const perLevel = new Map();
    for (const rec of this.recs.values()) {
      if (rec.b.cat === 'closed') continue;
      (perLevel.get(rec.level) || perLevel.set(rec.level, []).get(rec.level)).push(rec);
    }
    this.shutterMeshes = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    for (const [level, list] of perLevel) {
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      mesh.name = 'shop:shutters:' + level;
      mesh.frustumCulled = false;
      list.forEach((rec, i) => {
        const S = rec.S;
        const a0 = S.doorA0, a1 = S.doorA1;
        const w = S.world((a0 + a1) / 2, 0.06);
        const p0 = S.world(a0, 0.0), p1 = S.world(a1, 0.12);
        rec.shutter = { mesh, i, pos: new THREE.Vector3(w.x, S.y + S.doorTop / 2, w.z), rot: S.f.rot, w: a1 - a0, h: S.doorTop, box: null,
          boxDef: { cx: (p0.x + p1.x) / 2, cz: (p0.z + p1.z) / 2, hx: Math.max(0.03, Math.abs(p1.x - p0.x) / 2), hz: Math.max(0.03, Math.abs(p1.z - p0.z) / 2), rot: 0 } };
        m.compose(p.set(0, -1000, 0), q.identity(), s.set(0, 0, 0));
        mesh.setMatrixAt(i, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
      ctx.engine.levelRoot(level).add(mesh);
      this.shutterMeshes.push(mesh);
    }
    this._m = m; this._qq = q; this._p = p; this._s = s;
    this._applyShutters(this.ctx.clock ? this.ctx.clock.minutes : 642, false);
    ctx.events.on('time:tick', ({ minutes }) => this._applyShutters(minutes, true));
  }

  _applyShutters(minutes, collide) {
    const { _m: m, _qq: q, _p: p, _s: s } = this;
    const dirty = new Set(), rehash = new Set();
    const up = new THREE.Vector3(0, 1, 0);
    for (const [id, rec] of this.recs) {
      if (!rec.shutter) continue;
      const closed = !isOpen(rec.b, minutes);
      if (closed === rec.closedNow && (!collide || this._shutterReady)) continue;
      const sh = rec.shutter;
      if (closed) { q.setFromAxisAngle(up, sh.rot); m.compose(sh.pos, q, s.set(sh.w, sh.h, 0.05)); }
      else m.compose(p.set(0, -1000, 0), q.identity(), s.set(0, 0, 0));
      sh.mesh.setMatrixAt(sh.i, m);
      dirty.add(sh.mesh);
      if (collide) {
        const W = this.ctx.world, lv = rec.level;
        if (closed && !sh.box && W.hash[lv]) { sh.box = { ...sh.boxDef }; W.obstacles[lv].push(sh.box); W._insertBox(lv, sh.box); }
        if (!closed && sh.box) { W.obstacles[lv] = W.obstacles[lv].filter(o => o !== sh.box); sh.box = null; rehash.add(lv); }
      }
      if (rec.closedNow !== null && rec.closedNow !== closed) this.ctx.events.emit('shop:shutter', { slot: id, closed });
      rec.closedNow = closed;
    }
    for (const mesh of dirty) mesh.instanceMatrix.needsUpdate = true;
    for (const lv of rehash) this.ctx.world._buildHash(lv);
    if (collide) this._shutterReady = true;
  }

  // drop spots that ended up on nav-blocked cells (staff excepted)
  _validateSpots() {
    const nav = this.ctx.nav; if (!nav) return;
    const ok = (s) => { if (!s || s.kind === 'staff') return !!s; const g = this.ctx.world.grids[s.level]; const i = g.cellOf(s.x, s.z); return i >= 0 && nav.cellNode[s.level][i] >= 0; };
    for (const rec of this.recs.values()) {
      rec.spots = rec.spots.filter(ok);
      rec.queue = rec.queue.filter(ok);
      if (rec.counter && !ok(rec.counter)) rec.counter = rec.spots.find(s => s.kind === 'counter') || rec.spots.find(s => s.kind !== 'staff') || rec.counter;
    }
    for (const h of Object.values(this.halls)) if (h) h.spots = h.spots.filter(ok);
    // counters: the order spot must be on a walkable cell; nudge to the nearest valid cell of the same shop, else drop it
    const cs = this.ctx.counters;
    for (let k = cs.length - 1; k >= 0; k--) {
      const c = cs[k], g = this.ctx.world.grids[c.level], good = (x, z) => { const i = g.cellOf(x, z); return i >= 0 && nav.cellNode[c.level][i] >= 0; };
      if (good(c.order.x, c.order.z)) continue;
      const rec = this.recs.get(c.slotId), S = rec && rec.S; let fix = null;
      if (S) for (let r = 1; r <= 3; r++) {
        for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
          if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
          const x = Math.floor(c.order.x) + i + 0.5, z = Math.floor(c.order.z) + j + 0.5;
          const l = S.local(x, z);
          if (l.a < 0 || l.d < 0 || l.a >= S.W || l.d >= S.D || !good(x, z)) continue;
          const dd = Math.hypot(x - c.order.x, z - c.order.z);
          if (!fix || dd < fix.dd) fix = { x, z, dd };
        }
        if (fix) break;
      }
      if (fix) { c.order.x = fix.x; c.order.z = fix.z; } else { cs.splice(k, 1); console.warn('[shops] counter dropped (no walkable order cell)', c.slotId); }
    }
    this._spotsValid = true;
  }

  update(dt) {
    if (!this._shutterReady && this.ctx.nav) this._applyShutters(this.ctx.clock.minutes, true);
    if (!this._spotsValid && this.ctx.nav) { this._validateSpots(); this._forceNear(); }
    const cam = this.ctx.engine.camera.position;
    if (this._pendingForce && this.env.fontsReady) this._forceNear();
    // lazy build queue: nearest work first, ~8 ms per frame
    this._q -= dt;
    if (this._q <= 0) {
      this._q = 0.12;
      if (this.env.fontsReady) {
        const t0 = performance.now();
        const cand = [];
        for (const u of this.units) {
          const d = this._dist2(u, cam);
          if (u.kind === 'hall') { if (!u.built && d < HALL_R * HALL_R) cand.push([d, u, 0]); }
          else if (!u.frontBuilt && d < FRONT_R * FRONT_R) cand.push([d * 0.6, u, 0]);   // fronts first
        }
        const fw = this._fw || (this._fw = new THREE.Vector3());
        this.ctx.engine.camera.getWorldDirection(fw);
        for (const rec of this.recs.values()) if (!rec.group && !rec.intBusy) {
          const d = this._recDist2(rec, cam);
          if (d >= INT_R * INT_R) continue;
          // build what the player is walking towards first; things behind wait
          const ahead = (rec.cx - cam.x) * fw.x + (rec.cz - cam.z) * fw.z;
          cand.push([ahead < 0 && d > 144 ? d * 2.5 : d, rec, 1]);
        }
        cand.sort((a, b) => a[0] - b[0]);
        for (const [, o, kind] of cand) { if (kind) this._buildInterior(o); else this._buildUnit(o); if (performance.now() - t0 > BUDGET_MS) break; }
      }
    }
    // distance culling of interiors (every ~0.2 s)
    this._t -= dt;
    if (this._t > 0) return;
    this._t = 0.2;
    const far = this.ctx.engine.qualityName === 'low' ? 30 : 46;
    const f2 = far * far;
    for (const rec of this.recs.values()) {
      if (!rec.group) continue;
      const dx = rec.cx - cam.x, dy = (rec.y - cam.y) * 3, dz = rec.cz - cam.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > INT_FREE_R * INT_FREE_R) { this._releaseInterior(rec); continue; }
      const v = d2 < f2;
      if (rec.group.visible !== v) rec.group.visible = v;
    }
  }

  // ---- API ----------------------------------------------------------------------
  record(id) { const r = this.recs.get(id); return r ? { b: r.b, cx: r.cx, cz: r.cz, level: r.level, W: r.S.W, D: r.S.D, front: r.S.slot.front } : null; }
  spots(id) { const r = this.recs.get(id); return r ? r.spots.slice() : []; }
  counter(id) { const r = this.recs.get(id); return r ? r.counter : null; }
  queuePoints(id) { const r = this.recs.get(id); return r ? r.queue.slice() : []; }
  seats(id) { const r = this.recs.get(id); return r ? r.spots.filter(s => s.kind === 'seat').map(s => ({ x: s.x, z: s.z, level: s.level, yaw: s.yaw, sit: true })) : []; }
  hallSpots(spaceId) { const h = this.halls[spaceId]; return h ? h.spots.slice() : []; }
  isShuttered(id) { const r = this.recs.get(id); return !!(r && r.closedNow); }
}
