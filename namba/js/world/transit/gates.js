// =============================================================================
// Ticket gates (自動改札機) on LAYOUT.gates, staffed booths (有人改札), gate
// fences, ticket vending / fare charge machines with the backlit fare chart
// above them, and fare adjustment machines on the paid side.
//
// Japanese gates are normally OPEN: the flaps sit retracted in the machine
// and only snap shut when a card is refused. gatePass() animates the reader
// flash + the flaps (refusals close them for ~1.2 s).
// =============================================================================
import * as THREE from 'three';
import { GeoBatch } from '../../render/geobatch.js';
import { CELL, EDGE } from '../world.js';
import { LEVELS } from '../layout.js';
import { canvas, canvasTex, JP, EN, fitText, ICON, eswUV } from './textures.js';

const MACH_LEN = 1.45, MACH_W = 0.26, MACH_H = 1.0;

export class Gates {
  constructor(ctx, emissiveTex) {
    this.ctx = ctx;
    this.emTex = emissiveTex;
    this.gates = [];
    this.machines = [];     // ticket / charge / adjust machines {level,x,z,gate,kind,facing}
    this.flapMeshes = {};   // level -> InstancedMesh
    this.lanes = [];        // flat list: {gate, i, level, along, at, axis, flapIdx:[a,b], t, ext}
  }

  build() {
    const { ctx } = this;
    const M = ctx.materials;
    const std = (o) => () => new THREE.MeshStandardMaterial(o);
    M.define('transit_gate_body', std({ color: 0xd9dcdf, roughness: 0.32, metalness: 0.55 }));
    M.define('transit_gate_side', std({ color: 0x9aa0a6, roughness: 0.4, metalness: 0.6 }));
    M.define('transit_gate_top', std({ color: 0x15171a, roughness: 0.18, metalness: 0.2 }));
    M.define('transit_gate_metro', std({ color: 0xe5171f, roughness: 0.4, metalness: 0.1 }));
    M.define('transit_gate_pink', std({ color: 0xe44d93, roughness: 0.4, metalness: 0.1 }));
    M.define('transit_gate_nankai', std({ color: 0xf08300, roughness: 0.4, metalness: 0.1 }));
    M.define('transit_machine_body', std({ color: 0xc9ccd0, roughness: 0.38, metalness: 0.5 }));
    M.define('transit_booth_frame', std({ color: 0xe7e8e9, roughness: 0.45, metalness: 0.2 }));
    M.define('transit_booth_counter', std({ color: 0x8c7155, roughness: 0.6, metalness: 0.0 }));
    const ic = new THREE.MeshBasicMaterial({ map: this.emTex, color: new THREE.Color(1.6, 1.6, 1.6) });
    ic.name = 'transit_gate_icons';
    this.iconMat = ic;
    this.icPad = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.6, 1.0).multiplyScalar(2.2) });
    this.icPad.name = 'transit_ic_pad';
    this.machineTex = buildMachineAtlas();
    this.machineMat = new THREE.MeshStandardMaterial({ map: this.machineTex.color, emissiveMap: this.machineTex.emit, emissive: 0xffffff, emissiveIntensity: 1.4, roughness: 0.3, metalness: 0.1 });
    this.machineMat.name = 'transit_machine_face';
    this.charts = {};
    for (const gt of ctx.layout.gates) this._gate(gt);
    // flap instanced meshes (one per level)
    const flapGeo = new THREE.BoxGeometry(1, 1, 1);
    const flapMat = new THREE.MeshStandardMaterial({ color: 0xff5a1f, roughness: 0.35, metalness: 0.05, transparent: true, opacity: 0.88 });
    flapMat.name = 'transit_flap';
    const byLevel = {};
    for (const ln of this.lanes) (byLevel[ln.level] = byLevel[ln.level] || []).push(ln);
    for (const lv in byLevel) {
      const list = byLevel[lv];
      const im = new THREE.InstancedMesh(flapGeo, flapMat, list.length * 2);
      im.name = 'transit_flaps:' + lv;
      im.frustumCulled = false;
      list.forEach((ln, k) => { ln.flapBase = k * 2; ln.flapMesh = im; });
      ctx.engine.levelRoot(lv).add(im);
      this.flapMeshes[lv] = { im, list };
      for (const ln of list) this._setFlaps(ln, 0);
      im.instanceMatrix.needsUpdate = true;
    }
  }

  _paidSign(gt) {
    const w = this.ctx.world;
    const mid = (gt.from + gt.to) / 2;
    const probe = (d) => gt.axis === 'x' ? w.spaceAt(gt.level, mid, gt.at + d) : w.spaceAt(gt.level, gt.at + d, mid);
    const a = probe(2.5), b = probe(-2.5);
    if (a && a.paid) return 1; if (b && b.paid) return -1;
    if (gt.line === 'nankai') return 1;
    return 1;
  }

  _gate(gt) {
    const { ctx } = this;
    const lv = gt.level, y = LEVELS[lv].y;
    const ps = this._paidSign(gt);
    const gb = new GeoBatch();
    const ax = gt.axis; // 'x': line runs along x at z = at
    // world position from (along u, across v)
    const W = (u, v) => ax === 'x' ? [u, v + gt.at] : [gt.at + v, u];
    const boxUV = (mat, u, yy, v, su, sy, sv, opt) => { const [x, z] = W(u, v); if (ax === 'x') gb.box(mat, x, yy, z, su, sy, sv, 0, opt); else gb.box(mat, x, yy, z, sv, sy, su, 0, opt); };
    const quadW = (mat, pts, opt) => gb.quad(mat, ...pts.map(([u, yy, v]) => { const [x, z] = W(u, v); return [x, yy, z]; }), opt);
    const accent = gt.line === 'midosuji' ? 'transit_gate_metro' : gt.line === 'sennichimae' ? 'transit_gate_pink' : 'transit_gate_nankai';
    const machines = gt.machines || [];
    const g = { gt, ps, lanes: [], booth: null };
    this.gates.push(g);
    // lane policy
    const nL = machines.length - 1;
    const policy = (i) => (i === 0 || i === nL - 1) ? 'both' : (i % 4 === 1 ? 'in' : i % 4 === 3 ? 'out' : 'both');
    machines.forEach((u, mi) => {
      const h = MACH_H;
      // body: lower cabinet + slimmer upper with dark glossy top
      boxUV('transit_gate_body', u, y + h * 0.45, 0, MACH_W, h * 0.9, MACH_LEN);
      boxUV('transit_gate_side', u, y + 0.06, 0, MACH_W + 0.02, 0.12, MACH_LEN + 0.02, { faces: 'nsew' });
      boxUV('transit_gate_top', u, y + h * 0.93, 0, MACH_W + 0.04, 0.08, MACH_LEN + 0.06);
      boxUV(accent, u, y + h * 0.78, 0, MACH_W + 0.004, 0.05, MACH_LEN + 0.004, { faces: 'nsew' });
      // ends: sloped readers + LED indicators
      for (const e of [-1, 1]) {
        const v0 = e * MACH_LEN / 2;
        // IC reader pad (glowing blue) on the top near the end
        const vr = e * (MACH_LEN / 2 - 0.2);
        const yy = y + h * 0.975;
        quadW(this.icPad, [[u - 0.09, yy, vr - 0.1], [u + 0.09, yy, vr - 0.1], [u + 0.09, yy, vr + 0.1], [u - 0.09, yy, vr + 0.1]].map(p => p), {});
        // ticket slot (dark) in the middle of the top
        boxUV('rubber_black', u, y + h * 0.975, e * 0.25, 0.04, 0.01, 0.12, { faces: 't' });
        // LED direction indicator on the end face (serves the lanes either side)
        const enterDir = -e; // walking from this end into the machine length means moving towards -e
        const lanePol = [policy(mi - 1), policy(mi)].filter((p, k) => (k === 0 ? mi > 0 : mi < nL));
        const allowsFromThisEnd = lanePol.some(p => p === 'both' || (p === 'in' ? Math.sign(enterDir) === ps : Math.sign(enterDir) === -ps));
        const icn = allowsFromThisEnd ? ICON.arrow : ICON.noentry;
        const fv = v0 + e * 0.005;
        const yA = y + 0.62, yB = y + 0.8;
        // quad facing outward (direction e along v)
        const uvs = [[icn[0], icn[1]], [icn[2], icn[1]], [icn[2], icn[3]], [icn[0], icn[3]]];
        // orientation: seen from outside the end, right-hand is -u for e>0 (axis x) — keep arrow pointing "into" the gate
        if ((e > 0) === (ax === 'x')) quadW(this.iconMat, [[u + 0.1, yA, fv], [u - 0.1, yA, fv], [u - 0.1, yB, fv], [u + 0.1, yB, fv]], { uv: uvs });
        else quadW(this.iconMat, [[u - 0.1, yA, fv], [u + 0.1, yA, fv], [u + 0.1, yB, fv], [u - 0.1, yB, fv]], { uv: uvs });
      }
      // small LCD on the top centre
      const ls = ICON.lcd;
      void ls;
    });
    // lanes + flaps
    for (let i = 0; i < nL; i++) {
      const a = machines[i], b = machines[i + 1];
      const ln = { gate: gt.id, i, level: lv, axis: ax, at: gt.at, a, b, centre: (a + b) / 2, width: b - a, policy: policy(i), t: 0, ext: 0, target: 0, timer: 0, y };
      this.lanes.push(ln);
      g.lanes.push(ln);
    }
    // fences (stainless + glass) along gt.fence
    for (const [f0, f1] of gt.fence || []) {
      if (f1 - f0 < 0.05) continue;
      const n = Math.max(1, Math.round((f1 - f0) / 1.5));
      for (let k = 0; k <= n; k++) boxUV('stainless', f0 + (f1 - f0) * k / n, y + 0.55, 0, 0.06, 1.1, 0.06);
      boxUV('stainless', (f0 + f1) / 2, y + 1.1, 0, f1 - f0, 0.05, 0.08);
      boxUV('stainless', (f0 + f1) / 2, y + 0.08, 0, f1 - f0, 0.05, 0.06);
      const p = [[f0, y + 0.12, 0], [f1, y + 0.12, 0], [f1, y + 1.07, 0], [f0, y + 1.07, 0]];
      quadW('glass_rail', p); quadW('glass_rail', [p[0], p[3], p[2], p[1]]);
    }
    // staffed booth on the paid side at the end with the most room
    const fences = (gt.fence || []).map(([a, b]) => ({ a, b, len: b - a }));
    const fb = fences.sort((p, q) => q.len - p.len)[0];
    if (fb && fb.len >= 2.0) {
      const nearGate = Math.abs(fb.a - gt.to) < Math.abs(fb.b - gt.from) ? fb.a : fb.b; // end touching the gate line
      const dirOut = nearGate === fb.a ? 1 : -1;
      const len = Math.min(3.6, fb.len - 0.3);
      const u0 = nearGate + dirOut * 0.15, u1 = u0 + dirOut * len;
      const um = (u0 + u1) / 2;
      const depth = 2.4, v0 = ps * 0.25, v1 = ps * (0.25 + depth), vm = (v0 + v1) / 2;
      const hh = 2.4;
      // frame & walls
      boxUV('transit_booth_frame', um, y + 0.5, vm, len, 1.0, depth);
      boxUV('transit_booth_frame', um, y + hh, vm, len + 0.1, 0.12, depth + 0.1);
      for (const uu of [u0, u1]) for (const vv of [v0, v1]) boxUV('transit_booth_frame', uu, y + hh / 2, vv, 0.08, hh, 0.08);
      // glass upper walls
      const gl = (pts) => { quadW('glass', pts); quadW('glass', [pts[0], pts[3], pts[2], pts[1]]); };
      gl([[u0, y + 1.0, v0], [u1, y + 1.0, v0], [u1, y + hh - 0.06, v0], [u0, y + hh - 0.06, v0]]);
      gl([[u0, y + 1.0, v1], [u1, y + 1.0, v1], [u1, y + hh - 0.06, v1], [u0, y + hh - 0.06, v1]]);
      gl([[u1, y + 1.0, v0], [u1, y + 1.0, v1], [u1, y + hh - 0.06, v1], [u1, y + hh - 0.06, v0]]);
      boxUV('transit_booth_counter', um, y + 1.02, v0 + ps * 0.12, len, 0.05, 0.4);
      // interior light
      const [lx, lz] = W(um, vm);
      gb.box('light_panel', lx, y + hh - 0.08, lz, 0.6, 0.02, 0.6);
      ctx.lighting.addLight({ level: lv, x: lx, y: y + hh - 0.1, z: lz, color: 0xf6f8ff, intensity: 0.6, range: 5, kind: 'panel' });
      // sign on top
      g.booth = { u: um, v: vm, len, depth, u0, u1, v0, v1 };
      const [bx, bz] = W(um, vm);
      if (ax === 'x') ctx.world.addBox(lv, bx, bz, len / 2, depth / 2, 0); else ctx.world.addBox(lv, bx, bz, depth / 2, len / 2, 0);
      this._boothSign(gb, W, um, v0 - ps * 0.01, y + hh + 0.3, ps, gt, ax);
    }
    // machines on the free side (ticket + charge) with the fare chart above
    this._machineBank(gt, gb, ps, -1);
    // fare adjustment machines on the paid side
    this._machineBank(gt, gb, ps, +1);
    const meshes = gb.build(ctx.materials, { name: 'transit_gate' });
    const grp = new THREE.Group(); grp.name = 'transit_gate:' + gt.id;
    const [cx, cz] = W((gt.from + gt.to) / 2, 0);
    grp.userData.chunk = { level: lv, x: cx, z: cz, r: Math.max(30, (gt.to - gt.from) / 2 + 20) };
    meshes.forEach(m => grp.add(m));
    ctx.engine.levelRoot(lv).add(grp);
    // lights over the gate line (bright, as real gate lines are)
    for (let u = gt.from; u <= gt.to + 0.01; u += 6) {
      const [x, z] = W(u, 0);
      ctx.lighting.addLight({ level: lv, x, y: y + 2.9, z, color: 0xf4f7ff, intensity: 0.7, range: 7, kind: 'down' });
    }
  }

  _boothSign(gb, W, u, v, yy, ps, gt, ax) {
    const c = canvas(512, 128), g = c.getContext('2d');
    g.fillStyle = '#1b2430'; g.fillRect(0, 0, 512, 128);
    g.fillStyle = '#fff'; g.font = `700 54px ${JP}`; g.fillText('有人改札', 24, 64);
    g.font = `600 30px ${EN}`; g.fillStyle = '#cfe3ff'; g.fillText('Staffed gate / Information', 24, 108);
    const tex = canvasTex(c);
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.3, 1.3, 1.3) });
    const w = 1.4, h = 0.35;
    const P = (du, dy) => { const [x, z] = W(u + du, v - ps * 0.02); return [x, yy + dy, z]; };
    // face the free side (-ps). seen from -ps side.
    const flip = (ax === 'x') ? ps > 0 : ps < 0;
    if (flip) gb.quad(mat, P(-w / 2, -h / 2), P(w / 2, -h / 2), P(w / 2, h / 2), P(-w / 2, h / 2), { uv: [[0, 0], [1, 0], [1, 1], [0, 1]] });
    else gb.quad(mat, P(w / 2, -h / 2), P(-w / 2, -h / 2), P(-w / 2, h / 2), P(w / 2, h / 2), { uv: [[0, 0], [1, 0], [1, 1], [0, 1]] });
    void gt;
  }

  // Find a straight run of wall on one side of the gate and line machines up against it.
  _machineBank(gt, gb, ps, side) {
    const { ctx } = this;
    const w = ctx.world, lv = gt.level, y = LEVELS[lv].y;
    const grid = w.grids[lv];
    const nM = side < 0 ? (gt.line === 'nankai' ? 8 : 6) : 2;
    const need = nM * 0.82 + 0.4;
    const gx = gt.axis === 'x' ? (gt.from + gt.to) / 2 : gt.at, gz = gt.axis === 'x' ? gt.at : (gt.from + gt.to) / 2;
    let best = null;
    for (const e of w.edges[lv]) {
      if (e.kind !== EDGE.WALL) continue;
      const len = Math.hypot(e.bx - e.ax, e.bz - e.az);
      if (len < need) continue;
      const vert = e.ax === e.bx;
      // try runs along the edge
      for (let s = 0; s + need <= len + 1e-6; s += 0.5) {
        const m = s + need / 2;
        const px = vert ? e.ax : e.ax + m, pz = vert ? e.az + m : e.az;
        const nx = e.nx, nz = e.nz;
        if (!nx && !nz) continue;
        // which side of the gate line is it on?
        const across = (gt.axis === 'x' ? pz : px) - gt.at;
        if (Math.sign(across) !== Math.sign(ps * side) || Math.abs(across) < 2.5) continue;
        const d = Math.hypot(px - gx, pz - gz);
        if (d > 26) continue;
        // clearance: 2.5 m in front must be walkable, unblocked, not a room/shop, and of the right paid-ness
        let ok = true;
        for (let k = 0; k < need && ok; k += 0.5) {
          for (const dd of [0.5, 1.5, 2.5]) {
            const qx = (vert ? e.ax : e.ax + s + k) + nx * dd, qz = (vert ? e.az + s + k : e.az) + nz * dd;
            const i = grid.cellOf(qx, qz);
            if (i < 0 || grid.type[i] !== CELL.WALK || grid.blocked[i]) { ok = false; break; }
            const sp = ctx.layout.spaces[grid.space[i]];
            if (!sp || sp.kind === 'room' || !!sp.paid !== (side > 0 && gt.line !== 'nankai') && gt.line !== 'nankai') { ok = false; break; }
          }
        }
        if (!ok) continue;
        // nankai: free side is z < at (north), paid side is z > at
        if (gt.line === 'nankai') { const acr = (gt.axis === 'x' ? pz : px) - gt.at; if (Math.sign(acr) !== ps * side) continue; }
        const score = d + (side < 0 ? 0 : 0);
        if (!best || score < best.score) best = { score, e, s, vert, nx, nz };
      }
    }
    if (!best) return;
    const { e, s, vert, nx, nz } = best;
    const kinds = [];
    for (let k = 0; k < nM; k++) kinds.push(side > 0 ? 'adjust' : (k < Math.ceil(nM * 0.6) ? 'ticket' : 'charge'));
    const op = gt.line === 'nankai' ? 'nankai' : 'metro';
    const placed = [];
    for (let k = 0; k < nM; k++) {
      const a = s + 0.2 + k * 0.82 + 0.41;
      const bx = (vert ? e.ax : e.ax + a) + nx * 0.36, bz = (vert ? e.az + a : e.az) + nz * 0.36;
      this._machine(gb, bx, y, bz, nx, nz, kinds[k], op);
      this.machines.push({ level: lv, x: bx + nx * 0.7, z: bz + nz * 0.7, gate: gt.id, kind: kinds[k], facing: Math.atan2(-nx, -nz) });
      ctx.world.addBox(lv, bx, bz, vert ? 0.33 : 0.38, vert ? 0.38 : 0.33, 0);
      placed.push([bx, bz]);
    }
    // the fare chart above the bank (free side only)
    if (side < 0) {
      const a0 = s + 0.1, a1 = s + need - 0.1;
      const p0 = vert ? [e.ax + nx * 0.03, e.az + a0] : [e.ax + a0, e.az + nz * 0.03];
      const p1 = vert ? [e.ax + nx * 0.03, e.az + a1] : [e.ax + a1, e.az + nz * 0.03];
      const sp = ctx.world.spaceAt(lv, placed[0][0] + nx, placed[0][1] + nz);
      const ceil = sp ? sp.ceil : 3.2;
      const y0 = y + 1.95, y1 = Math.min(y + ceil - 0.15, y0 + (a1 - a0) * 0.28);
      const tex = this._chartTex(op);
      const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.25, 1.25, 1.25) });
      mat.name = 'transit_fare_chart';
      // face along the normal; orient u so text reads left-to-right
      const A = [p0[0], y0, p0[1]], B = [p1[0], y0, p1[1]], C = [p1[0], y1, p1[1]], D = [p0[0], y1, p0[1]];
      // right-hand direction seen from the front = (-nz, nx)?? compute: facing f=(-nx,-nz) towards the wall; right = f x up
      const rx = nz, rz = -nx; // right vector for a viewer looking at the wall (towards -n)
      const dirAB = vert ? [0, Math.sign(a1 - a0)] : [Math.sign(a1 - a0), 0];
      const same = dirAB[0] * -rx + dirAB[1] * -rz > 0;
      void same;
      const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
      const rightAlongAB = dirAB[0] * rx + dirAB[1] * rz;
      if (rightAlongAB < 0) gb.quad(mat, A, D, C, B, { uv: [uvs[1], uvs[2], uvs[3], uvs[0]] });
      else gb.quad(mat, B, C, D, A, { uv: [uvs[0], uvs[3], uvs[2], uvs[1]] });
      // frame
      const cx = (p0[0] + p1[0]) / 2 + nx * 0.02, cz = (p0[1] + p1[1]) / 2 + nz * 0.02;
      gb.box('steel_dark', cx, y1 + 0.04, cz, vert ? 0.08 : Math.abs(a1 - a0) + 0.1, 0.08, vert ? Math.abs(a1 - a0) + 0.1 : 0.08);
      gb.box('steel_dark', cx, y0 - 0.04, cz, vert ? 0.08 : Math.abs(a1 - a0) + 0.1, 0.08, vert ? Math.abs(a1 - a0) + 0.1 : 0.08);
      ctx.lighting.addLight({ level: lv, x: cx + nx * 0.2, y: (y0 + y1) / 2, z: cz + nz * 0.2, color: 0xf2f6ff, intensity: 1.0, range: 6, kind: 'sign', dir: [nx, 0, nz] });
    }
  }

  _machine(gb, x, y, z, nx, nz, kind, op) {
    const rot = Math.atan2(nx, nz); // local +z faces the walkable side
    const body = 'transit_machine_body';
    gb.box(body, x, y + 0.85, z, 0.76, 1.7, 0.66, rot);
    gb.box('steel_dark', x, y + 1.78, z, 0.78, 0.16, 0.68, rot);
    // face quad (atlas column)
    const col = { ticket: 0, charge: 1, adjust: 2 }[kind] + (op === 'nankai' ? 3 : 0);
    const u0 = col / 6, u1 = (col + 1) / 6;
    const c = Math.cos(rot), s = Math.sin(rot);
    const P = (lx, ly, lz) => [x + lx * c + lz * s, y + ly, z - lx * s + lz * c];
    const fz = 0.335;
    gb.quad(this.machineMat, P(-0.36, 0.05, fz), P(0.36, 0.05, fz), P(0.36, 1.84, fz), P(-0.36, 1.84, fz), { uv: [[u0, 0], [u1, 0], [u1, 1], [u0, 1]] });
    // counter ledge
    gb.box('transit_gate_top', x + nx * 0.36, y + 0.95, z + nz * 0.36, 0.7, 0.03, 0.12, rot);
  }

  _chartTex(op) {
    if (this.charts[op]) return this.charts[op];
    const c = canvas(2048, 640), g = c.getContext('2d');
    if (op === 'metro') drawMetroFareChart(g, 2048, 640); else drawNankaiFareChart(g, 2048, 640);
    const t = canvasTex(c, { aniso: 8 });
    this.charts[op] = t;
    return t;
  }

  // ---- runtime ---------------------------------------------------------------------------
  laneAt(gateId, along) {
    const g = this.gates.find(g => g.gt.id === gateId); if (!g) return -1;
    for (const ln of g.lanes) if (along >= ln.a && along <= ln.b) return ln.i;
    return -1;
  }
  pass(gateId, laneIndex, dir = 1, ok = true) {
    const g = this.gates.find(g => g.gt.id === gateId); if (!g) return false;
    const ln = g.lanes[laneIndex]; if (!ln) return false;
    ln.timer = ok ? 0.9 : 1.4;
    ln.ok = ok;
    ln.flash = 0.5;
    if (!ok) ln.target = 1;
    return true;
  }
  _setFlaps(ln, ext) {
    const im = ln.flapMesh; if (!im) return;
    const m = new THREE.Matrix4();
    const len = Math.min(0.55, ln.width / 2 - 0.1);
    const out = 0.02 + ext * (len - 0.02);
    for (let k = 0; k < 2; k++) {
      const u = k === 0 ? ln.a + MACH_W / 2 - 0.02 + out / 2 : ln.b - MACH_W / 2 + 0.02 - out / 2;
      const [x, z] = ln.axis === 'x' ? [u, ln.at] : [ln.at, u];
      const sx = ln.axis === 'x' ? out : 0.03, sz = ln.axis === 'x' ? 0.03 : out;
      m.compose(new THREE.Vector3(x, ln.y + 0.62, z), new THREE.Quaternion(), new THREE.Vector3(sx, 0.45, sz));
      im.setMatrixAt(ln.flapBase + k, m);
    }
  }
  update(dt) {
    for (const lv in this.flapMeshes) {
      const { im, list } = this.flapMeshes[lv];
      let dirty = false;
      for (const ln of list) {
        if (ln.timer > 0) { ln.timer -= dt; if (ln.timer <= 0) ln.target = 0; }
        if (ln.flash > 0) ln.flash -= dt;
        const prev = ln.ext;
        const sp = ln.target > ln.ext ? 9 : 3;
        ln.ext += Math.sign(ln.target - ln.ext) * Math.min(Math.abs(ln.target - ln.ext), sp * dt);
        if (ln.ext !== prev || ln._init !== true) { this._setFlaps(ln, ln.ext); dirty = true; ln._init = true; }
      }
      if (dirty) im.instanceMatrix.needsUpdate = true;
    }
  }
}

// ---------------------------------------------------------------------------------------------
function buildMachineAtlas() {
  const W = 1536, H = 512;
  const c = canvas(W, H), g = c.getContext('2d');
  const e = canvas(W, H), ge = e.getContext('2d');
  ge.fillStyle = '#000'; ge.fillRect(0, 0, W, H);
  const cols = [
    ['metro', 'ticket', 'きっぷ', 'Tickets', '#E5171F'], ['metro', 'charge', 'チャージ', 'IC Charge', '#1e88e5'], ['metro', 'adjust', 'のりこし精算機', 'Fare Adjustment', '#2e7d32'],
    ['nankai', 'ticket', 'きっぷ', 'Tickets', '#F08300'], ['nankai', 'charge', 'チャージ', 'IC Charge', '#1e88e5'], ['nankai', 'adjust', '精算機', 'Fare Adjustment', '#2e7d32'],
  ];
  cols.forEach(([op, kind, ja, en, col], k) => {
    const x = k * 256;
    g.fillStyle = '#d6d9dc'; g.fillRect(x, 0, 256, H);
    // header (lit)
    for (const [gg, lit] of [[g, false], [ge, true]]) {
      gg.fillStyle = col; gg.fillRect(x + 8, 8, 240, 64);
      gg.fillStyle = '#fff'; gg.font = `800 34px ${JP}`; fitText(gg, ja, x + 128, 46, 220, 'center');
      gg.font = `600 18px ${EN}`; fitText(gg, en, x + 128, 66, 220, 'center');
      // screen
      const sy = 120;
      gg.fillStyle = lit ? '#cfe6ff' : '#9fc8f0'; gg.fillRect(x + 24, sy, 208, 150);
      gg.fillStyle = '#0d47a1'; gg.fillRect(x + 24, sy, 208, 24);
      gg.fillStyle = '#fff'; gg.font = `700 14px ${JP}`; gg.fillText(op === 'metro' ? 'Osaka Metro  ご案内' : '南海電鉄  ご案内', x + 30, sy + 17);
      const btn = kind === 'charge' ? ['1,000円', '2,000円', '3,000円', '5,000円'] : kind === 'adjust' ? ['精算', 'Adjust', 'ICカード', '切符'] : ['190円', '240円', '290円', '340円'];
      btn.forEach((b, i) => { gg.fillStyle = '#ffffff'; gg.fillRect(x + 32 + (i % 2) * 100, sy + 36 + Math.floor(i / 2) * 54, 92, 46); gg.fillStyle = '#1a237e'; gg.font = `700 18px ${JP}`; fitText(gg, b, x + 78 + (i % 2) * 100, sy + 66 + Math.floor(i / 2) * 54, 86, 'center'); });
      if (!lit) break;
    }
    // slots
    g.fillStyle = '#222'; g.fillRect(x + 40, 300, 70, 12); g.fillRect(x + 150, 300, 60, 40);
    g.fillStyle = '#2a6fd6'; g.fillRect(x + 140, 352, 80, 50);
    g.fillStyle = '#fff'; g.font = `700 14px ${EN}`; g.fillText('IC', x + 170, 382);
    g.fillStyle = '#333'; g.fillRect(x + 30, 420, 196, 40);
    g.fillStyle = '#666'; g.font = `600 12px ${JP}`; g.fillText('きっぷ・おつり Tickets/Change', x + 36, 444);
  });
  return { color: canvasTex(c), emit: canvasTex(e) };
}

const MIDO = ['江坂', '東三国', '新大阪', '西中島南方', '中津', '梅田', '淀屋橋', '本町', '心斎橋', 'なんば', '大国町', '動物園前', '天王寺', '昭和町', '西田辺', '長居', 'あびこ', '北花田', '新金岡', 'なかもず'];
const SENNI = ['野田阪神', '玉川', '阿波座', '西長堀', '桜川', 'なんば', '日本橋', '谷町九丁目', '鶴橋', '今里', '新深江', '小路', '北巽', '南巽'];
const YOTSU = ['西梅田', '肥後橋', '本町', '四ツ橋', 'なんば', '大国町', '花園町', '岸里', '玉出', '北加賀屋', '住之江公園'];
const SAKAI = ['天神橋筋六丁目', '扇町', '南森町', '北浜', '堺筋本町', '長堀橋', '日本橋', '恵美須町', '動物園前', '天下茶屋'];
const fareFor = (d) => d <= 2 ? 190 : d <= 5 ? 240 : d <= 9 ? 290 : d <= 13 ? 340 : 390;

function drawMetroFareChart(g, W, H) {
  g.fillStyle = '#fbfbf8'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#1a1a1a'; g.fillRect(0, 0, W, 58);
  g.fillStyle = '#fff'; g.font = `800 34px ${JP}`; g.fillText('きっぷうりば  運賃表', 24, 41);
  g.font = `600 22px ${EN}`; g.fillStyle = '#ccc'; g.fillText('Fare Chart (Adult)  —  from M20 Namba', 400, 39);
  g.fillStyle = '#E5171F'; g.beginPath(); g.arc(W - 60, 29, 22, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#fff'; g.font = `800 26px ${EN}`; g.textAlign = 'center'; g.fillText('M', W - 60, 38); g.textAlign = 'left';
  const station = (x, y, name, fare, col, here) => {
    g.beginPath(); g.arc(x, y, here ? 13 : 9, 0, Math.PI * 2); g.fillStyle = here ? '#111' : '#fff'; g.fill(); g.lineWidth = 4; g.strokeStyle = col; g.stroke();
    g.fillStyle = '#111'; g.font = `700 17px ${JP}`;
    g.fillText(name, x + 14, y - 4);
    if (!here) { g.fillStyle = '#c62828'; g.font = `800 19px ${EN}`; g.fillText(String(fare), x + 14, y + 18); }
  };
  // Midosuji: vertical-ish centre line drawn horizontally across the board (wide board)
  const yM = 200, x0 = 60, x1 = W - 80;
  const lineH = (y, list, col, hereIdx, xa = x0, xb = x1) => {
    g.strokeStyle = col; g.lineWidth = 12; g.beginPath(); g.moveTo(xa, y); g.lineTo(xb, y); g.stroke();
    list.forEach((s, i) => { const x = xa + (i / (list.length - 1)) * (xb - xa); station(x, y, s, fareFor(Math.abs(i - hereIdx)), col, i === hereIdx); });
  };
  lineH(yM, MIDO, '#E5171F', MIDO.indexOf('なんば'));
  lineH(330, SENNI, '#E44D93', SENNI.indexOf('なんば'), 200, W - 200);
  lineH(460, YOTSU, '#0078BA', YOTSU.indexOf('なんば'), 300, W - 400);
  lineH(580, SAKAI, '#814721', -3, 260, W - 600);
  g.font = `700 20px ${JP}`;
  [['御堂筋線 Midosuji Line', '#E5171F', yM], ['千日前線 Sennichimae Line', '#E44D93', 330], ['四つ橋線 Yotsubashi Line', '#0078BA', 460], ['堺筋線 Sakaisuji Line', '#814721', 580]].forEach(([t, c, y]) => { g.fillStyle = c; g.fillRect(24, y - 62, 10, 28); g.fillStyle = '#333'; g.fillText(t, 42, y - 40); });
  g.fillStyle = '#555'; g.font = `500 16px ${JP}`;
  g.fillText('こども運賃は大人運賃の半額です  Children: half fare   |   ICOCA・PiTaPa ご利用いただけます', W - 980, H - 14);
}

const NK_MAIN = ['なんば', '新今宮', '天下茶屋', '岸里玉出', '住吉大社', '堺', '羽衣', '泉大津', '岸和田', '貝塚', '泉佐野', '尾崎', 'みさき公園', '和歌山市'];
const NK_AIR = ['泉佐野', 'りんくうタウン', '関西空港'];
const NK_KOYA = ['天下茶屋', '中百舌鳥', '北野田', '金剛', '河内長野', '橋本', '極楽橋'];
function drawNankaiFareChart(g, W, H) {
  g.fillStyle = '#fffdf8'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#F08300'; g.fillRect(0, 0, W, 60);
  g.fillStyle = '#fff'; g.font = `900 34px ${JP}`; g.fillText('南海電鉄  運賃表', 24, 42);
  g.font = `600 22px ${EN}`; g.fillText('Nankai Electric Railway — Fares from Namba (Adult)', 380, 40);
  const fares = [0, 160, 190, 210, 240, 310, 380, 450, 590, 640, 700, 760, 820, 930];
  const st = (x, y, n, f, col, here) => {
    g.beginPath(); g.arc(x, y, here ? 13 : 9, 0, Math.PI * 2); g.fillStyle = here ? '#111' : '#fff'; g.fill(); g.lineWidth = 4; g.strokeStyle = col; g.stroke();
    g.fillStyle = '#111'; g.font = `700 18px ${JP}`; g.fillText(n, x + 14, y - 6);
    if (!here) { g.fillStyle = '#0d47a1'; g.font = `800 20px ${EN}`; g.fillText(String(f), x + 14, y + 18); }
  };
  const y1 = 220, xa = 60, xb = W - 120;
  g.strokeStyle = '#F08300'; g.lineWidth = 12; g.beginPath(); g.moveTo(xa, y1); g.lineTo(xb, y1); g.stroke();
  NK_MAIN.forEach((s, i) => st(xa + i / (NK_MAIN.length - 1) * (xb - xa), y1, s, fares[i], '#F08300', i === 0));
  // airport branch down from 泉佐野
  const xs = xa + 10 / (NK_MAIN.length - 1) * (xb - xa);
  g.strokeStyle = '#0068b7'; g.beginPath(); g.moveTo(xs, y1); g.lineTo(xs, 360); g.lineTo(xs + 420, 360); g.stroke();
  st(xs + 210, 360, 'りんくうタウン', 920, '#0068b7'); st(xs + 420, 360, '関西空港 ✈', 970, '#0068b7');
  // Koya line
  const y2 = 500, ka = 380, kb = W - 520;
  g.strokeStyle = '#2bb673'; g.beginPath(); g.moveTo(xa + 2 / 13 * (xb - xa), y1); g.lineTo(xa + 2 / 13 * (xb - xa), y2); g.lineTo(kb, y2); g.stroke();
  const kf = [190, 330, 420, 480, 520, 700, 890];
  NK_KOYA.forEach((s, i) => { if (i === 0) return; st(ka + (i / (NK_KOYA.length - 1)) * (kb - ka), y2, s, kf[i], '#2bb673'); });
  g.fillStyle = '#333'; g.font = `700 22px ${JP}`;
  g.fillText('南海線 Nankai Main Line', 60, 150); g.fillText('空港線 Airport Line', xs + 20, 410); g.fillText('高野線 Koya Line', ka, 560);
  g.fillStyle = '#c62828'; g.font = `800 22px ${JP}`; g.fillText('特急ラピート・サザン・こうや は 特急券が必要です  Limited Express tickets required', 60, H - 22);
}
