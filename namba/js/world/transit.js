// =============================================================================
// TRANSIT — the railway heart of Namba.
//
// Timetable-driven trains (Midosuji, Sennichimae, Nankai terminal), platform
// screen doors, track environment (tunnels, shed, viaduct), ticket gates and
// machines, departure boards, PA announcement + train events.
//
// Public API (ctx.transit) — see notes/transit.md for payloads:
//   trains                       live train states (array, read-only)
//   nextDepartures(trackId, n)   upcoming services on a track
//   doorsOpen(trackId)           [{x,z,level,nx,nz,car,door}] or null
//   isBoardable(trackId, body?)  doors open (and body near a door, if given)
//   trackInfo(trackId)           static info about a track
//   trackState(trackId)          { state, svc, open, front, speed } or null
//   gatePass(gateId, lane, dir, ok=true)   animate a gate lane (crowd / game)
//   gateLanes(gateId)            [{i, x, z, policy, width}]
//   laneAt(gateId, x, z)         lane index at a world point or -1
//   ticketMachines()             [{level, x, z, gate, kind, facing}]
//   now()                        service-day minutes
// Events: train:approach, train:arrive, train:closing, train:depart, announce,
//         gate:pass
// =============================================================================
import * as THREE from 'three';
import { LEVELS, spaceById } from './layout.js';
import { Timetable, LINES, FORMATIONS, serviceTime, hhmm } from './transit/timetable.js';
import { loadFonts, DestSlots, buildDecalAtlas } from './transit/textures.js';
import { SPECS, doorXs } from './transit/cars.js';
import { TrainRenderer } from './transit/trains.js';
import { defineEnvMaterials, buildTrackEnv, buildPSD, ChunkBatches, TS } from './transit/env.js';
import { Gates } from './transit/gates.js';
import { Boards } from './transit/boards.js';

const GAP = 0.5;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const isCab = (k) => /_cab$/.test(k);
const STD_FORMATION = { midosuji: 'm10', sennichimae: 's4' };
const TUNNEL = { midosuji: [220, 220], sennichimae: [85, 200] };
const OFFSET = { midosuji: 1.56, sennichimae: 1.56, nankai: 1.5 };

export class Transit {
  constructor(ctx) {
    this.ctx = ctx;
    this.trains = [];
    this._byTrack = {};
    this._state = {};
    this._lastT = null;
    this._time = 0;
  }

  async init() {
    const ctx = this.ctx;
    await loadFonts();
    const L = ctx.layout;
    this.tt = new Timetable(L, { scale: ctx.clock.scale || 6, seed: (ctx.params && ctx.params.seed) || 1 });
    this.RS = this.tt.RS;
    this.cfgs = L.tracks.map(t => this._cfg(t));
    this.cfg = Object.fromEntries(this.cfgs.map(c => [c.t.id, c]));
    // LED slots for every (line, type, dest) in the timetable
    this.slots = new DestSlots();
    for (const id in this.tt.byTrack) for (const s of this.tt.byTrack[id]) s.slot = this.slots.slot(s.line, s.type, s.dest);
    this._decals = buildDecalAtlas();
    defineEnvMaterials(ctx);
    buildTrackEnv(ctx, this.cfgs);
    // platform screen doors
    this.psd = {};
    for (const c of this.cfgs) if (c.line.psd) this.psd[c.t.id] = buildPSD(ctx, c, c.stopDoors.map(d => d.along), SPECS[FORMATIONS[STD_FORMATION[c.line.id]].models[0]].dw);
    this._floorMarkings();
    // trains
    const modelLevels = {};
    for (const c of this.cfgs) for (const fk of c.formations) for (const m of FORMATIONS[fk].models) modelLevels[m] = c.t.level;
    this.renderer = new TrainRenderer(ctx, this.slots);
    this.renderer.build(modelLevels, { m_mid: 40, m_cab: 10, s_mid: 12, s_cab: 12, comm_mid: 60, comm_cab: 30, south_mid: 12, south_cab: 12, rapit_mid: 16, rapit_cab: 8 });
    // gates
    this.gates = new Gates(ctx, this.renderer.emissiveTex);
    this.gates.build();
    // boards
    this.boards = new Boards(ctx, this);
    this._buildBoards();
    // the player's own taps (game emits ic:tap)
    ctx.events.on('ic:tap', (e) => this._onTap(e));
    this.boards.update(true);
  }

  // ---------------------------------------------------------------------------------------
  _cfg(t) {
    const line = LINES[t.line];
    const plat = spaceById[t.platform];
    const pr = plat.rect;
    const axis = t.axis;
    let edge, inward;
    if (axis === 'z') { if (t.side === 'w') { edge = t.rect[2]; inward = 1; } else { edge = t.rect[0]; inward = -1; } }
    else { if (t.side === 'n') { edge = t.rect[3]; inward = 1; } else { edge = t.rect[1]; inward = -1; } }
    const centre = edge - inward * OFFSET[line.id];
    const crossRange = axis === 'z' ? [t.rect[0], t.rect[2]] : [t.rect[1], t.rect[3]];
    const trackRange = axis === 'z' ? [t.rect[1], t.rect[3]] : [t.rect[0], t.rect[2]];
    const platformRange = axis === 'z' ? [pr[1], pr[3]] : [pr[0], pr[2]];
    const y = LEVELS[t.level].y;
    const nankai = line.id === 'nankai';
    const hArr = nankai ? -1 : t.heading;
    const hDep = nankai ? 1 : t.heading;
    let visRange;
    if (nankai) visRange = [trackRange[0], 245];
    else { const [a, b] = TUNNEL[line.id]; visRange = [platformRange[0] - a, platformRange[1] + b]; }
    const formations = [...new Set(this.tt.byTrack[t.id].map(s => s.formation))];
    const cfg = { t, line, axis, edge, inward, centre, crossRange, trackRange, platformRange, platformCeil: plat.ceil, y, hArr, hDep, visRange, formations, level: t.level };
    // stop position of the front (arrival direction) of the train
    if (nankai) cfg.sStop = trackRange[0] + 3.4;
    else {
      const len = this._formLen(STD_FORMATION[line.id]);
      cfg.sStop = (platformRange[0] + platformRange[1]) / 2 + hArr * len / 2;
    }
    cfg.layouts = {};
    for (const fk of formations) cfg.layouts[fk] = this._layout(cfg, fk);
    const std = nankai ? (formations.includes('comm8') ? 'comm8' : formations[0]) : STD_FORMATION[line.id];
    cfg.stopDoors = this._doorsAt(cfg, cfg.layouts[std], cfg.sStop);
    cfg.platformMid = (platformRange[0] + platformRange[1]) / 2;
    const [px, pz] = axis === 'z' ? [edge + inward * 3, cfg.platformMid] : [cfg.platformMid, edge + inward * 3];
    cfg.announcePos = { x: px, y: y + 3, z: pz };
    return cfg;
  }
  _formLen(fk) { const ms = FORMATIONS[fk].models; return ms.reduce((a, m) => a + SPECS[m].L, 0) + GAP * (ms.length - 1); }
  // per-car offsets (from the arrival front, along -hArr) and facing (+1 = cab/local +x towards hArr)
  _layout(cfg, fk) {
    const ms = FORMATIONS[fk].models;
    const cars = [];
    let cum = 0;
    ms.forEach((m, i) => {
      const L = SPECS[m].L;
      let face = 1;
      if (isCab(m)) {
        if (i === 0) face = 1;
        else if (i === ms.length - 1) face = -1;
        else if (isCab(ms[i + 1])) face = -1;
        else face = 1;
      }
      const lamp = isCab(m) ? (i === 0 ? 'front' : i === ms.length - 1 ? 'rear' : 'mid') : 'none';
      cars.push({ model: m, off: cum + L / 2, face, lamp, doors: doorXs(SPECS[m]), L });
      cum += L + GAP;
    });
    return { cars, len: cum - GAP };
  }
  _doorsAt(cfg, layout, front) {
    const out = [];
    layout.cars.forEach((c, ci) => {
      const centre = front - cfg.hArr * c.off;
      const dir = cfg.hArr * c.face; // along-direction of local +x
      c.doors.forEach((dx, di) => {
        const along = centre + dir * dx;
        const [x, z] = cfg.axis === 'z' ? [cfg.edge, along] : [along, cfg.edge];
        const [nx, nz] = cfg.axis === 'z' ? [cfg.inward, 0] : [0, cfg.inward];
        out.push({ along, x, z, level: cfg.level, nx, nz, car: ci + 1, door: di + 1 });
      });
    });
    return out;
  }

  // ---------------------------------------------------------------------------------------
  _floorMarkings() {
    const ctx = this.ctx;
    const CB = new ChunkBatches();
    const cells = this._decals.cells;
    const decal = (cfg, s, c, w, h, cell, vertical = false, yy = 0.006) => {
      const uv = cells[cell]; if (!uv) return;
      const T = TS(cfg);
      const Rs = cfg.axis === 'z' ? -cfg.inward : cfg.inward; // right vector along s
      const Fc = -cfg.inward;                                  // forward (towards track) along c
      const P = (u, v) => vertical ? T.P(s + Rs * (u - 0.5) * w, cfg.y + yy + v * h, c) : T.P(s + Rs * (u - 0.5) * w, cfg.y + yy, c + Fc * (v - 0.5) * h);
      const [x, z] = T.xz(s, c);
      const b = CB.get(cfg.level, x, z);
      const pts = [P(0, 0), P(1, 0), P(1, 1), P(0, 1)];
      const uvs = [[uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]]];
      // make sure it faces up (or towards the viewer for vertical signs)
      const a = pts[0], bb = pts[1], d = pts[3];
      const ux = bb[0] - a[0], uy = bb[1] - a[1], uz = bb[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
      const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
      const want = vertical ? (cfg.axis === 'z' ? [0, 0, 0] : [0, 0, 0]) : [0, 1, 0];
      let flip = vertical ? false : n[1] < 0;
      if (vertical) flip = false;
      void want;
      if (flip) b.quad('transit_decal', pts[0], pts[3], pts[2], pts[1], { uv: [uvs[0], uvs[3], uvs[2], uvs[1]] });
      else b.quad('transit_decal', pts[0], pts[1], pts[2], pts[3], { uv: uvs });
    };
    for (const cfg of this.cfgs) {
      const inw = cfg.inward;
      if (cfg.line.psd) {
        const m = cfg.line.id === 'midosuji';
        const nCars = FORMATIONS[STD_FORMATION[cfg.line.id]].models.length;
        for (const d of cfg.stopDoors) {
          // car numbers: car 1 at the south (Midosuji) / west (Sennichimae) end
          const carNo = (cfg.hArr > 0) ? d.car : (nCars + 1 - d.car);
          const cBase = cfg.edge + inw * 0.95;
          decal(cfg, d.along, cBase, 0.62, 0.62, (m ? 'm' : 's') + carNo);
          if (m && carNo === 1) decal(cfg, d.along, cBase + inw * 0.75, 0.62, 0.62, 'women');
          // queue lines either side of the door, leaving the centre free for alighting
          for (const sd of [-1, 1]) {
            for (let k = 0; k < 3; k++) decal(cfg, d.along + sd * 0.62, cfg.edge + inw * (1.6 + k * 0.9), 0.36, 0.9, m ? 'queue_red' : 'queue_pink');
            decal(cfg, d.along + sd * 0.62, cfg.edge + inw * 4.15, 0.45, 0.45, 'queue');
          }
          decal(cfg, d.along, cfg.edge + inw * 2.6, 0.75, 0.75, 'seiretsu');
        }
      } else {
        // Nankai: boarding position marks by train length, inside the tactile line
        const lay = cfg.layouts;
        const mark = (fk, cell, cOff) => {
          if (!lay[fk]) return;
          const doors = this._doorsAt(cfg, lay[fk], cfg.sStop);
          for (const d of doors) {
            if (d.along < cfg.platformRange[0] + 0.5 || d.along > cfg.platformRange[1] - 0.5) continue;
            decal(cfg, d.along, cfg.edge + inw * cOff, 0.7, 0.7, cell);
          }
        };
        mark('comm8', 'nk_8', 1.75);
        mark('comm6', 'nk_6', 2.5);
        mark('rapit6', 'nk_rapit', 2.5);
        mark('southern8', 'nk_ltd', 2.5);
        mark('south4', 'nk_ltd', 2.5);
        // car-stop target sign near the buffer
        const sgn = cfg.sStop + 0.6;
        const T = TS(cfg);
        const [x, z] = T.xz(sgn, cfg.edge + inw * 0.45);
        const b = CB.get(cfg.level, x, z);
        T.box(b, 'steel_dark', sgn, cfg.y + 0.8, cfg.edge + inw * 0.45, 0.06, 1.6, 0.06);
        // plate facing the arriving train (towards +s)
        const c = cfg.edge + inw * 0.45;
        const uv = cells.stop8;
        const p = (u, v) => T.P(sgn + 0.04, cfg.y + 1.45 + v * 0.42, c + (u - 0.5) * 0.36 * (cfg.axis === 'z' ? -1 : 1));
        b.quad('transit_decal', p(0, 0), p(1, 0), p(1, 1), p(0, 1), { uv: [[uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]]] });
        b.quad('transit_decal', p(1, 0), p(0, 0), p(0, 1), p(1, 1), { uv: [[uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]]] });
      }
      // "mind the gap" stencils near the edge every ~20 m
      for (let s = cfg.platformRange[0] + 10; s < cfg.platformRange[1] - 5; s += 20) {
        if (cfg.line.psd) continue;
        decal(cfg, s, cfg.edge + inw * 0.55, 0.8, 0.5, 'gap');
      }
    }
    CB.build(ctx, 'transit_markings');
  }

  _buildBoards() {
    const ctx = this.ctx, L = ctx.layout;
    const nk = this.cfgs.filter(c => c.line.id === 'nankai').map(c => c.t.id);
    const mido = this.cfgs.filter(c => c.line.id === 'midosuji').map(c => c.t.id);
    const senn = this.cfgs.filter(c => c.line.id === 'sennichimae').map(c => c.t.id);
    const ceilAt = (lv, x, z, def) => { const s = ctx.world.spaceAt(lv, x, z); return LEVELS[lv].y + (s ? s.ceil : def); };
    for (const p of L.pois.filter(p => p.kind === 'departureBoard')) {
      const y0 = LEVELS[p.level].y;
      const ceil = ceilAt(p.level, p.x, p.z, 4);
      const facing = (p.facing || 0) + Math.PI;
      if (p.id === 'nk_board3') this.boards.add({ id: p.id, kind: 'nankai_big', level: p.level, x: p.x, y: Math.min(ceil - 1.8, y0 + 5.2), z: p.z, facing, w: 7.2, h: 2.7, cw: 2048, ch: 768, tracks: nk, perTrack: 2, doubleSided: true, hang: true, ceilY: ceil });
      else if (p.id === 'nk_board') this.boards.add({ id: p.id, kind: 'nankai_list', level: p.level, x: p.x, y: Math.min(ceil - 1.2, y0 + 3.6), z: p.z, facing, w: 4.8, h: 2.0, cw: 1536, ch: 640, tracks: nk, perTrack: 2, doubleSided: true, hang: true, ceilY: ceil });
      else this.boards.add({ id: p.id, kind: 'metro_gate', level: p.level, x: p.x, y: Math.min(ceil - 0.6, y0 + 2.55), z: p.z, facing, w: 3.4, h: 1.1, cw: 1536, ch: 512, tracks: mido, perTrack: 2, doubleSided: true, hang: true, ceilY: ceil });
    }
    // platform boards
    const hangOK = (lv, x, z) => { const g = ctx.world.grids[lv]; const above = ctx.world.grids[lv === 'B2' ? 'B1' : lv === '3F' ? '4F' : '3F']; void above; return ctx.world.isWalkable(lv, x, z) && !ctx.layout.ramps.some(r => (r.lower === lv || r.upper === lv) && x > r.rect[0] - 1.5 && x < r.rect[2] + 1.5 && z > r.rect[1] - 1.5 && z < r.rect[3] + 1.5) && g; };
    const m = this.cfgs.find(c => c.line.id === 'midosuji');
    if (m) {
      const plat = spaceById[m.t.platform], [x0, z0, x1, z1] = plat.rect, cx = (x0 + x1) / 2;
      const y0 = LEVELS[m.level].y, ceil = y0 + plat.ceil;
      for (const z of [z0 + 12, -140, -118, z1 - 12]) if (hangOK(m.level, cx, z)) this.boards.add({ id: 'm_plat_' + z, kind: 'metro_platform', level: m.level, x: cx, y: Math.min(ceil - 0.6, y0 + 2.8), z, facing: 0, w: 2.6, h: 0.62, cw: 1024, ch: 256, tracks: [...mido].sort(), perTrack: 2, doubleSided: true, hang: true, ceilY: ceil });
    }
    const s = this.cfgs.find(c => c.line.id === 'sennichimae');
    if (s) {
      const plat = spaceById[s.t.platform], [x0, z0, x1, z1] = plat.rect, cz = (z0 + z1) / 2;
      const y0 = LEVELS[s.level].y, ceil = y0 + plat.ceil;
      for (const x of [x0 + 16, (x0 + x1) / 2 - 18, x1 - 16]) if (hangOK(s.level, x, cz)) this.boards.add({ id: 's_plat_' + x, kind: 'metro_platform', level: s.level, x, y: Math.min(ceil - 0.6, y0 + 2.7), z: cz, facing: Math.PI / 2, w: 2.6, h: 0.62, cw: 1024, ch: 256, tracks: [...senn].sort(), perTrack: 2, doubleSided: true, hang: true, ceilY: ceil });
    }
    // Nankai: per island platform, at the head and mid-platform
    const plats = [...new Set(this.cfgs.filter(c => c.line.id === 'nankai').map(c => c.t.platform))];
    for (const pid of plats) {
      const plat = spaceById[pid], [x0, z0, x1] = plat.rect, cx = (x0 + x1) / 2;
      const y0 = LEVELS[plat.level].y, ceil = y0 + plat.ceil;
      const tracks = this.cfgs.filter(c => c.t.platform === pid).sort((a, b) => a.t.no - b.t.no).map(c => c.t.id);
      for (const z of [z0 + 5, z0 + 70]) this.boards.add({ id: `${pid}_b${z}`, kind: 'nankai_platform', level: plat.level, x: cx, y: y0 + 3.3, z, facing: 0, w: 3.6, h: 0.9, cw: 1024, ch: 256, tracks, perTrack: 2, doubleSided: true, hang: true, ceilY: ceil });
    }
  }

  // ---------------------------------------------------------------------------------------
  now() { return serviceTime(this.ctx.clock.minutes); }

  // State of one service at service-time t (null when not present)
  _svcState(cfg, s, t) {
    const line = cfg.line, kin = this.tt.kin[line.id], RS = this.RS, dd = line.door;
    if (t < s.approachStart || t >= s.goneAt) return null;
    let state, front, speed = 0, open = 0, psdOpen = 0;
    if (t < s.arr) {
      const tau = (s.arr - t) * RS;
      const d = kin.approach(tau);
      front = cfg.sStop - cfg.hArr * d; speed = kin.approachSpeed(tau);
      state = tau < 14 ? 'arriving' : 'approach';
    } else if (t < s.dep) {
      front = cfg.sStop;
      if (t < s.doorsOpenAt) state = 'stopped';
      else if (t < s.doorsCloseAt) state = 'doors';
      else state = 'closing';
      const tOpen = (t - s.doorsOpenAt) * RS, tClose = (t - s.doorsCloseAt) * RS;
      if (t >= s.doorsOpenAt) open = t < s.doorsCloseAt ? ease(tOpen / dd.openDur) : 1 - ease(tClose / dd.closeDur);
      const lag = dd.psdLag || 0;
      if (t >= s.doorsOpenAt) psdOpen = t < s.doorsCloseAt ? ease((tOpen - lag) / dd.openDur) : 1 - ease((tClose - lag * 0.5) / dd.closeDur);
    } else {
      const tau = (t - s.dep) * RS;
      const d = kin.depart(tau);
      front = cfg.sStop + cfg.hDep * d; speed = kin.departSpeed(tau);
      state = 'departing';
    }
    return { state, front, speed, open, psdOpen };
  }

  update(dt) {
    const ctx = this.ctx;
    const t = this.now();
    this._time += dt;
    const first = this._lastT === null;
    const last = first ? t : this._lastT;
    const jumped = !first && (t < last - 0.05 || t - last > 1.5);
    if (jumped && t < last) for (const id in this.tt.byTrack) for (const s of this.tt.byTrack[id]) s._fired = 0;
    // language toggle for LED panels (every 4 real seconds)
    this.renderer.uniforms.uLang.value = Math.floor(this._time / 4) % 2;
    const p = ctx.player && ctx.player.body;
    const py = p ? (p.y != null ? p.y : LEVELS[p.level].y) : 0;
    this.renderer.begin();
    const live = [];
    for (const cfg of this.cfgs) {
      const id = cfg.t.id;
      const act = this.tt.activeAt(id, t);
      let st = null, psdOpen = 0;
      for (const s of act) {
        const ss = this._svcState(cfg, s, t);
        if (!ss) continue;
        ss.svc = s;
        // events
        this._events(cfg, s, last, t, first || jumped);
        const tr = this._train(cfg, s, ss);
        live.push(tr);
        if (ss.state !== 'approach' && ss.state !== 'departing') st = ss; else if (!st) st = ss;
        psdOpen = Math.max(psdOpen, ss.psdOpen);
        // render if near the player
        if (this._near(cfg, p, py)) this._place(cfg, s, ss);
      }
      this._state[id] = st;
      if (this.psd[id]) this.psd[id].uniforms.uOpen.value = psdOpen;
    }
    this.renderer.end();
    this.trains = live;
    this._lastT = t;
    if (first) this._initialArrivals(live);
    this.gates.update(dt);
    this._boardT = (this._boardT || 0) + dt;
    if (this._boardT > 0.25) { this._boardT = 0; this.boards.update(); }
  }

  _near(cfg, p, py) {
    if (!p) return true;
    if (Math.abs(py - cfg.y) > 9) return cfg.line.id === 'nankai' && py > cfg.y - 2 && py < cfg.y + 40 && this._dist2Track(cfg, p) < 320 * 320;
    return this._dist2Track(cfg, p) < 280 * 280;
  }
  _dist2Track(cfg, p) {
    const [a, b] = cfg.visRange;
    const al = cfg.axis === 'z' ? p.z : p.x, cr = cfg.axis === 'z' ? p.x : p.z;
    const da = al < a ? a - al : al > b ? al - b : 0;
    const dc = cr - cfg.centre;
    return da * da + dc * dc;
  }

  _place(cfg, s, ss) {
    const lay = cfg.layouts[s.formation];
    const [v0, v1] = cfg.visRange;
    const nankai = cfg.line.id === 'nankai';
    const afterOpen = ss.state === 'doors' || ss.state === 'closing' || ss.state === 'departing';
    for (const c of lay.cars) {
      const along = ss.front - cfg.hArr * c.off;
      if (along + c.L / 2 < v0 - 1 || along - c.L / 2 > v1 + 1) continue;
      const dir = cfg.hArr * c.face;
      const yaw = cfg.axis === 'z' ? -dir * Math.PI / 2 : (dir > 0 ? 0 : Math.PI);
      // local +z in world: (sin yaw, cos yaw)
      const lzx = Math.sin(yaw), lzz = Math.cos(yaw);
      const pd = cfg.axis === 'z' ? lzx * cfg.inward : lzz * cfg.inward;
      const openP = pd > 0 ? ss.open : 0, openN = pd > 0 ? 0 : ss.open;
      let lamp = -1;
      if (c.lamp === 'front') lamp = nankai && afterOpen ? 0 : 1;
      else if (c.lamp === 'rear') lamp = nankai && afterOpen ? 1 : 0;
      const [x, z] = cfg.axis === 'z' ? [cfg.centre, along] : [along, cfg.centre];
      this.renderer.add(c.model, x, cfg.y, z, yaw, openP, openN, s.slot, lamp);
    }
  }

  _train(cfg, s, ss) {
    let tr = this._byTrack[s.id];
    if (!tr) {
      tr = this._byTrack[s.id] = { id: s.id, line: s.line, track: cfg.t.id, trackNo: cfg.t.no, platform: cfg.t.platform, level: cfg.level, type: s.type, typeJa: s.typeJa, typeEn: s.typeEn, typeColor: s.typeColor, destinationJa: s.destJa, destinationEn: s.destEn, cars: s.cars, arr: s.arr, dep: s.dep, svc: s };
      // prune old entries
      const keys = Object.keys(this._byTrack); if (keys.length > 80) for (const k of keys.slice(0, 20)) if (k !== s.id) delete this._byTrack[k];
    }
    tr.state = ss.state; tr.speed = ss.speed; tr.doors = ss.open; tr.boardable = ss.state === 'doors' && ss.open > 0.6;
    const [x, z] = cfg.axis === 'z' ? [cfg.centre, ss.front] : [ss.front, cfg.centre];
    tr.x = x; tr.z = z; tr.front = ss.front;
    return tr;
  }

  // ---- events -------------------------------------------------------------------------------
  _events(cfg, s, t0, t1, silent) {
    const RS = this.RS, line = cfg.line;
    const nankai = line.id === 'nankai';
    const evs = [
      [1, s.arr - (nankai ? 32 : 26) / RS, 'approach'],
      [2, s.doorsOpenAt, 'arrive'],
      [8, s.doorsOpenAt + (nankai ? 12 : 99999) / RS, 'info'],
      [16, s.doorsCloseAt - (nankai ? 14 : 6) / RS, 'closewarn'],
      [32, s.doorsCloseAt, 'closing'],
      [4, s.dep, 'depart'],
    ];
    for (const [bit, at, kind] of evs) {
      if ((s._fired || 0) & bit) continue;
      if (at <= t1) {
        s._fired = (s._fired || 0) | bit;
        if (!silent && at > t0 - 1e-9) this._emit(cfg, s, kind);
      }
    }
  }

  _doorList(cfg, s) { return this._doorsAt(cfg, cfg.layouts[s.formation], cfg.sStop).filter(d => d.along >= cfg.platformRange[0] - 0.3 && d.along <= cfg.platformRange[1] + 0.3); }

  _emit(cfg, s, kind) {
    const ev = this.ctx.events;
    const line = cfg.line, no = cfg.t.no;
    const base = { line: line.id, track: cfg.t.id, trackNo: no, platform: cfg.t.platform, level: cfg.level, trainId: s.id, type: s.type, typeJa: s.typeJa, typeEn: s.typeEn, destinationJa: s.destJa, destinationEn: s.destEn, carCount: s.cars };
    const ap = cfg.announcePos;
    const ann = (k, ja, en, sound) => ev.emit('announce', { kind: k, line: line.id, track: cfg.t.id, trackNo: no, textJa: ja, textEn: en, ja, text: en, level: cfg.level, x: ap.x, y: ap.y, z: ap.z, position: { x: ap.x, y: ap.y, z: ap.z }, sound, operator: line.operator, trainId: s.id });
    const tm = hhmm(s.dep);
    const [hh, mm] = tm.split(':');
    const tyJa = s.typeInfo.short ? `${s.typeInfo.short} ${s.typeInfo.name}` : s.typeJa;
    if (kind === 'approach') {
      ev.emit('train:approach', Object.assign({ eta: (s.arr - this.now()), etaSec: (s.arr - this.now()) * this.RS }, base));
      if (line.operator === 'metro') {
        const dirJa = cfg.t.dirJa ? cfg.t.dirJa.replace(/方面$/, '') : '';
        ann('approach',
          `まもなく、${no}番線に、${dirJa}方面、${s.destJa}行きが到着します。危ないですから、ホームドアから離れてお待ちください。`,
          `The train for ${s.destEn} will arrive at track ${no} shortly. Please stand back from the platform doors.`, 'metro_approach');
      } else {
        ann('approach',
          `まもなく、${no}番線に、電車がまいります。危ないですから、黄色い線の内側までお下がりください。この電車は、折り返し、${hh}時${mm}分発、${tyJa}、${s.destJa}行きとなります。`,
          `A train is now arriving at track ${no}. Please stand behind the yellow line. This train will depart at ${tm} as the ${s.typeEn} for ${s.destEn}.`, 'nankai_approach');
      }
    } else if (kind === 'arrive') {
      ev.emit('train:arrive', Object.assign({ doors: this._doorList(cfg, s), terminal: line.id === 'nankai' }, base));
      if (line.id === 'midosuji') ann('arrive', 'なんば、なんばです。四つ橋線、千日前線、南海線、近鉄線、阪神線は、お乗り換えです。', 'Namba, Namba. Please change here for the Yotsubashi Line, the Sennichimae Line, the Nankai Line, the Kintetsu Line and the Hanshin Line.', 'metro_arrive');
      else if (line.id === 'sennichimae') ann('arrive', 'なんば、なんばです。御堂筋線、四つ橋線、南海線、近鉄線、阪神線は、お乗り換えです。', 'Namba, Namba. Please change here for the Midosuji Line, the Yotsubashi Line, the Nankai Line, the Kintetsu Line and the Hanshin Line.', 'metro_arrive');
      else ann('arrive', 'なんば、なんば、終点です。どなた様もお忘れ物のないよう、ご注意ください。', 'Namba, Namba. This is the last stop. Please make sure you have all your belongings with you.', 'nankai_arrive');
    } else if (kind === 'info') {
      const extra = s.typeInfo.short ? '特急券をお持ちでないお客様は、ご乗車いただけません。' : '';
      ann('info', `${no}番線の電車は、${hh}時${mm}分発、${tyJa}、${s.destJa}行きです。${extra}`, `The train at track ${no} is the ${s.typeEn} for ${s.destEn}, departing at ${tm}.${s.typeInfo.short ? ' A limited express ticket is required.' : ''}`, 'nankai_info');
    } else if (kind === 'closewarn') {
      if (line.operator === 'metro') ann('depart', `${no}番線、ドアが閉まります。ご注意ください。`, `The doors on track ${no} are closing. Please stand clear.`, 'metro_door_chime');
      else ann('depart', `${no}番線から、${tyJa}、${s.destJa}行きが発車します。ドアが閉まります、ご注意ください。`, `The ${s.typeEn} for ${s.destEn} is departing from track ${no}. The doors are closing.`, 'nankai_melody');
    } else if (kind === 'closing') {
      ev.emit('train:closing', base);
    } else if (kind === 'depart') {
      ev.emit('train:depart', base);
    }
  }

  _initialArrivals(live) {
    for (const tr of live) {
      if (tr.state !== 'doors') continue;
      const cfg = this.cfg[tr.track], s = tr.svc;
      this.ctx.events.emit('train:arrive', { line: cfg.line.id, track: cfg.t.id, trackNo: cfg.t.no, platform: cfg.t.platform, level: cfg.level, trainId: s.id, type: s.type, typeJa: s.typeJa, typeEn: s.typeEn, destinationJa: s.destJa, destinationEn: s.destEn, carCount: s.cars, doors: this._doorList(cfg, s), terminal: cfg.line.id === 'nankai', initial: true });
    }
  }

  _onTap(e) {
    const p = this.ctx.player && this.ctx.player.body; if (!p || !e || !e.gate) return;
    const gt = this.ctx.layout.gates.find(g => g.id === e.gate); if (!gt) return;
    const lane = this.laneAt(e.gate, p.x, p.z);
    if (lane >= 0) this.gatePass(e.gate, lane, 0, e.ok !== false);
  }

  // ---- public API ---------------------------------------------------------------------------
  nextDepartures(trackId, n = 3, t) {
    if (t == null) t = this.now();
    return this.tt.upcoming(trackId, t, n).map(s => ({
      id: s.id, track: s.track, trackNo: s.trackNo, line: s.line, platform: s.platform,
      time: s.hhmm, minutes: s.dep % 1440, dep: s.dep, arr: s.arr,
      type: s.typeEn, typeKey: s.type, typeJa: s.typeJa, typeEn: s.typeEn, typeColor: s.typeColor,
      dest: s.destEn, destination: s.destEn, destJa: s.destJa, destEn: s.destEn, cars: s.cars,
    }));
  }
  trackState(trackId) { return this._state[trackId] || null; }
  doorsOpen(trackId) {
    const st = this._state[trackId];
    if (!st || st.state !== 'doors' || st.open < 0.6) return null;
    return this._doorList(this.cfg[trackId], st.svc);
  }
  isBoardable(trackId, body) {
    const doors = this.doorsOpen(trackId);
    if (!doors) return false;
    if (!body) return true;
    const cfg = this.cfg[trackId];
    if (body.level !== cfg.level) return false;
    const along = cfg.axis === 'z' ? body.z : body.x, cr = cfg.axis === 'z' ? body.x : body.z;
    if (Math.abs(cr - cfg.edge) > 2.0) return false;
    const dw = SPECS[FORMATIONS[cfg.line.id === 'nankai' ? 'comm8' : STD_FORMATION[cfg.line.id]].models[0]].dw;
    return doors.some(d => Math.abs(d.along - along) < dw / 2 + 0.45);
  }
  trackInfo(trackId) {
    const c = this.cfg[trackId]; if (!c) return null;
    const t = c.t;
    return { id: t.id, line: c.line.id, lineJa: c.line.ja, lineEn: c.line.en, color: c.line.color, no: t.no, platform: t.platform, level: c.level, dirJa: t.dirJa || (c.line.id === 'nankai' ? '南海線' : ''), dirEn: t.dirEn || (c.line.id === 'nankai' ? 'Nankai Line' : ''), axis: c.axis, centre: c.centre, edge: c.edge, inward: c.inward, stopFront: c.sStop, platformRange: c.platformRange.slice(), psd: !!c.line.psd, stopDoors: c.stopDoors.map(d => ({ x: d.x, z: d.z, level: d.level, nx: d.nx, nz: d.nz, car: d.car, door: d.door })) };
  }
  gatePass(gateId, laneIndex, dir = 1, ok = true) {
    const r = this.gates.pass(gateId, laneIndex, dir, ok);
    if (r) {
      const g = this.gates.gates.find(g => g.gt.id === gateId);
      const ln = g && g.lanes[laneIndex];
      if (ln) { const [x, z] = ln.axis === 'x' ? [ln.centre, ln.at] : [ln.at, ln.centre]; this.ctx.events.emit('gate:pass', { gate: gateId, lane: laneIndex, dir, ok, level: ln.level, x, z }); }
    }
    return r;
  }
  gateLanes(gateId) {
    const g = this.gates.gates.find(g => g.gt.id === gateId); if (!g) return [];
    return g.lanes.map(ln => { const [x, z] = ln.axis === 'x' ? [ln.centre, ln.at] : [ln.at, ln.centre]; return { i: ln.i, x, z, policy: ln.policy, width: ln.width - 0.26, paidSign: g.ps }; });
  }
  laneAt(gateId, x, z) {
    const gt = this.ctx.layout.gates.find(g => g.id === gateId); if (!gt) return -1;
    return this.gates.laneAt(gateId, gt.axis === 'x' ? x : z);
  }
  ticketMachines() { return this.gates.machines.slice(); }
}
