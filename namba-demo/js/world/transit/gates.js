// =============================================================================
// Ticket gates (自動改札機) on LAYOUT.gates, staffed booths (有人改札), gate
// fences, ticket vending / fare charge machines with the backlit fare chart
// above them, and fare adjustment machines on the paid side.
//
// v6: real-size gate channels. The layout's lanes are 3-5 m apart (the crowd
// sim and the nav graph are built on them); each one is drawn as 3 (or 5)
// channels on a ~1 m pitch, ~0.75 m clear, the way a real gate line looks.
// The crowd always uses the centre channel; the player can use any.
//
// Cabinet: slim, rounded plan, two-tone (light shell, dark glossy top), line
// colour band, IC reader pad (lit blue) tilted towards each entry end, ticket
// slot, small LCD, end-face LED (green arrow / red no-entry) under the lane
// number, and the flaps (orange) that live inside the cabinet.
//
// Japanese gates are normally OPEN: the flaps sit retracted and only snap out
// when someone walks in without a valid tap. The player has to tap (E, via
// Story -> tapGate); walking in untapped snaps the flaps shut with the buzzer,
// and a collision segment on the flap line stops the player until they step
// back or tap. NPCs auto-tap (gatePass) and are never stopped.
// =============================================================================
import * as THREE from 'three';
import { GeoBatch } from '../../render/geobatch.js?v=c81de75';
import { CELL, EDGE } from '../world.js?v=c81de75';
import { LEVELS } from '../layout.js?v=c81de75';
import { canvas, canvasTex, JP, EN, fitText } from './textures.js?v=c81de75';
import { roundRectPath } from './mesh.js?v=c81de75';

const MACH_LEN = 1.45, MACH_W = 0.26;
const CAB_W = 0.24;              // drawn cabinet width
const CAB_TOP = 0.955;           // top of the dark top plate
const FLAP_Y = 0.70, FLAP_H = 0.40, FLAP_L = 0.42;
const SUB_PITCH = 1.0;           // target channel pitch (m)
const ARM_S = 3.5;               // a tap keeps the channel open this long (and while the player is in it)
const NEAR_V = 2.4;              // gateLaneNear: how far in front of the line counts
const nSubFor = (pitch) => Math.max(1, 2 * Math.round((pitch / SUB_PITCH - 1) / 2) + 1); // odd: the crowd's centre line is a channel
const Y = new THREE.Vector3(0, 1, 0);

// ---- shared geometry (built once) -------------------------------------------------------------
let GEO = null;
function gateGeos() {
  if (GEO) return GEO;
  const plan = (w, l, r) => roundRectPath(new THREE.Shape(), -w / 2, -l / 2, w / 2, l / 2, r);
  const ext = (shape, depth, bevel = 0, y0 = 0) => {
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: 2, curveSegments: 3 });
    g.rotateX(-Math.PI / 2); // shape XY -> plan XZ, extrusion -> +Y
    g.translate(0, y0 + bevel, 0);
    return g;
  };
  GEO = {
    plinth: ext(plan(CAB_W - 0.04, MACH_LEN - 0.04, 0.06), 0.07, 0, 0),
    body: ext(plan(CAB_W, MACH_LEN, 0.08), 0.84, 0, 0.065),
    band: ext(plan(CAB_W + 0.008, MACH_LEN + 0.008, 0.084), 0.04, 0, 0.72),
    top: ext(plan(CAB_W + 0.014, MACH_LEN + 0.014, 0.087), 0.03, 0.0125, 0.9),
  };
  // flap: rounded leading edge (x = protrusion 0..FLAP_L), thin, centred on z
  const s = new THREE.Shape();
  const r = 0.11, h = FLAP_H / 2;
  s.moveTo(0, -h); s.lineTo(FLAP_L - r, -h); s.quadraticCurveTo(FLAP_L, -h, FLAP_L, -h + r);
  s.lineTo(FLAP_L, h - r); s.quadraticCurveTo(FLAP_L, h, FLAP_L - r, h); s.lineTo(0, h); s.lineTo(0, -h);
  const fg = new THREE.ExtrudeGeometry(s, { depth: 0.032, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelOffset: -0.006, bevelSegments: 1, curveSegments: 4 });
  fg.translate(0, 0, -0.016);
  GEO.flap = fg;
  return GEO;
}

// ---- gate atlas: LED arrow / no-entry, IC pad, idle LCD, lane numbers -----------------------------
const AW = 1024, AH = 512;
const cellUV = (x, y, w, h) => [x / AW, 1 - (y + h) / AH, (x + w) / AW, 1 - y / AH];
const UV = {
  arrow: cellUV(0, 0, 128, 128), noentry: cellUV(128, 0, 128, 128), pad: cellUV(256, 0, 128, 128),
  lcd: cellUV(384, 0, 256, 128), num: (n) => cellUV((n % 16) * 64, 128 + Math.floor(n / 16) * 64, 64, 64),
};
function buildGateAtlas() {
  const c = canvas(AW, AH), g = c.getContext('2d');
  g.fillStyle = '#05070a'; g.fillRect(0, 0, AW, AH);
  // green arrow (LED matrix look)
  const led = (x0, y0, fn, col) => {
    g.save(); g.translate(x0, y0); g.fillStyle = '#0a0d0f'; g.fillRect(0, 0, 128, 128);
    const m = document.createElement('canvas'); m.width = m.height = 128; const mg = m.getContext('2d'); fn(mg);
    const d = mg.getImageData(0, 0, 128, 128).data;
    g.fillStyle = col;
    for (let y = 4; y < 128; y += 8) for (let x = 4; x < 128; x += 8) if (d[(y * 128 + x) * 4 + 3] > 100) { g.beginPath(); g.arc(x, y, 3.4, 0, Math.PI * 2); g.fill(); }
    g.restore();
  };
  led(0, 0, (m) => { m.fillStyle = '#fff'; m.beginPath(); m.moveTo(64, 10); m.lineTo(112, 62); m.lineTo(80, 62); m.lineTo(80, 118); m.lineTo(48, 118); m.lineTo(48, 62); m.lineTo(16, 62); m.closePath(); m.fill(); }, '#38ff78');
  led(128, 0, (m) => { m.fillStyle = '#fff'; m.beginPath(); m.arc(64, 64, 56, 0, Math.PI * 2); m.fill(); m.globalCompositeOperation = 'destination-out'; m.fillRect(18, 52, 92, 24); }, '#ff2a1e');
  // IC pad: neutral white (instance colour tints it), rounded square, contactless arcs, "IC"
  { const x = 256, y = 0;
    g.fillStyle = '#9aa4ae'; g.beginPath(); g.roundRect ? g.roundRect(x + 6, y + 6, 116, 116, 22) : g.rect(x + 6, y + 6, 116, 116); g.fill();
    g.fillStyle = '#ffffff'; g.beginPath(); g.roundRect ? g.roundRect(x + 14, y + 14, 100, 100, 16) : g.rect(x + 14, y + 14, 100, 100); g.fill();
    g.strokeStyle = '#7d8790'; g.lineWidth = 4;
    for (const r of [9, 18, 27]) { g.beginPath(); g.arc(x + 64, y + 60, r, -2.4, -0.74); g.stroke(); }
    g.fillStyle = '#3c4650'; g.font = `900 52px ${EN}`; g.textAlign = 'center'; g.fillText('IC', x + 64, y + 108); g.textAlign = 'left'; }
  // idle LCD: dark navy screen
  { const x = 384, y = 0;
    g.fillStyle = '#0b1830'; g.fillRect(x, y, 256, 128);
    g.fillStyle = '#123a74'; g.fillRect(x + 6, y + 6, 244, 30);
    g.fillStyle = '#cfe6ff'; g.font = `700 22px ${JP}`; fitText(g, 'ICカード  IC card', x + 128, y + 29, 236, 'center');
    g.fillStyle = '#8fc3ff'; g.font = `700 30px ${JP}`; fitText(g, 'タッチしてください', x + 128, y + 76, 236, 'center');
    g.font = `600 20px ${EN}`; g.fillStyle = '#6f9fd8'; fitText(g, 'Touch your card here', x + 128, y + 108, 236, 'center'); }
  // lane numbers 1..80 (white on dark navy plate)
  for (let n = 0; n < 80; n++) {
    const x = (n % 16) * 64, y = 128 + Math.floor(n / 16) * 64;
    g.fillStyle = '#1d2733'; g.fillRect(x + 2, y + 2, 60, 60);
    g.fillStyle = '#fff'; g.font = `800 ${n + 1 >= 10 ? 36 : 42}px ${EN}`; g.textAlign = 'center'; g.fillText(String(n + 1), x + 32, y + 47); g.textAlign = 'left';
  }
  return canvasTex(c, { aniso: 8 });
}
function quadGeo(uv) {
  const g = new THREE.PlaneGeometry(1, 1);
  const a = g.attributes.uv;
  for (let i = 0; i < a.count; i++) a.setXY(i, uv[0] + a.getX(i) * (uv[2] - uv[0]), uv[1] + a.getY(i) * (uv[3] - uv[1]));
  return g;
}

const _m = new THREE.Matrix4(), _s = new THREE.Matrix4(), _c = new THREE.Color();
const _X = new THREE.Vector3(), _Z = new THREE.Vector3(), _P = new THREE.Vector3(), _T = new THREE.Vector3(), _N = new THREE.Vector3();

export class Gates {
  constructor(ctx, emissiveTex) {
    this.ctx = ctx;
    this.emTex = emissiveTex;
    this.gates = [];
    this.machines = [];     // ticket / charge / adjust machines {level,x,z,gate,kind,facing}
    this.lanes = [];        // flat list of the layout lanes (crowd lanes)
    this.subs = [];         // flat list of drawn channels
    this.inst = {};         // level -> { flaps, pads, arrows, crosses, list }
    this.autoTap = !!(ctx.params && ctx.params.has && ctx.params.has('autotap'));
    this._t = 0;
    this.pl = { S: null, side: 0 };
    this.hint = null;
  }

  build() {
    const { ctx } = this;
    const M = ctx.materials;
    const std = (o) => () => new THREE.MeshStandardMaterial(o);
    M.define('transit_gate_shell', std({ color: 0xe3e5e7, roughness: 0.36, metalness: 0.22 }));
    M.define('transit_gate_plinth', std({ color: 0x3a3e44, roughness: 0.6, metalness: 0.3 }));
    M.define('transit_gate_top', std({ color: 0x15171a, roughness: 0.18, metalness: 0.2 }));
    M.define('transit_gate_reader', std({ color: 0x2a2f36, roughness: 0.25, metalness: 0.35 }));
    M.define('transit_gate_metro', std({ color: 0xe5171f, roughness: 0.4, metalness: 0.1 }));
    M.define('transit_gate_pink', std({ color: 0xe44d93, roughness: 0.4, metalness: 0.1 }));
    M.define('transit_gate_nankai', std({ color: 0xf08300, roughness: 0.4, metalness: 0.1 }));
    M.define('transit_machine_body', std({ color: 0xc9ccd0, roughness: 0.38, metalness: 0.5 }));
    M.define('transit_booth_frame', std({ color: 0xe7e8e9, roughness: 0.45, metalness: 0.2 }));
    M.define('transit_booth_counter', std({ color: 0x8c7155, roughness: 0.6, metalness: 0.0 }));
    this.atlas = buildGateAtlas();
    this.atlasMat = new THREE.MeshBasicMaterial({ map: this.atlas, color: new THREE.Color(1.25, 1.25, 1.25) });
    this.atlasMat.name = 'transit_gate_atlas';
    this.machineTex = buildMachineAtlas();
    this.machineMat = new THREE.MeshStandardMaterial({ map: this.machineTex.color, emissiveMap: this.machineTex.emit, emissive: 0xffffff, emissiveIntensity: 1.4, roughness: 0.3, metalness: 0.1 });
    this.machineMat.name = 'transit_machine_face';
    this.charts = {};
    for (const gt of ctx.layout.gates) this._gate(gt);
    this._buildInstances();
    this._buildLcd();
  }

  _paidSign(gt) {
    const w = this.ctx.world;
    const mid = (gt.from + gt.to) / 2;
    const probe = (d) => gt.axis === 'x' ? w.spaceAt(gt.level, mid, gt.at + d) : w.spaceAt(gt.level, gt.at + d, mid);
    const a = probe(2.5), b = probe(-2.5);
    if (a && a.paid) return 1; if (b && b.paid) return -1;
    return 1;
  }

  // world unit vectors of the gate frame: U along the line, V across it (U x Y = V... right-handed: U = Y x V)
  _frame(ax) { return ax === 'x' ? { U: new THREE.Vector3(1, 0, 0), V: new THREE.Vector3(0, 0, 1) } : { U: new THREE.Vector3(0, 0, 1), V: new THREE.Vector3(1, 0, 0) }; }

  _gate(gt) {
    const { ctx } = this;
    const lv = gt.level, y = LEVELS[lv].y;
    const ps = this._paidSign(gt);
    const gb = new GeoBatch();
    const ax = gt.axis; // 'x': line runs along x at z = at
    const W = (u, v) => ax === 'x' ? [u, v + gt.at] : [gt.at + v, u];
    const boxUV = (mat, u, yy, v, su, sy, sv, opt) => { const [x, z] = W(u, v); if (ax === 'x') gb.box(mat, x, yy, z, su, sy, sv, 0, opt); else gb.box(mat, x, yy, z, sv, sy, su, 0, opt); };
    const quadW = (mat, pts, opt) => gb.quad(mat, ...pts.map(([u, yy, v]) => { const [x, z] = W(u, v); return [x, yy, z]; }), opt);
    const accent = gt.line === 'midosuji' ? 'transit_gate_metro' : gt.line === 'sennichimae' ? 'transit_gate_pink' : 'transit_gate_nankai';
    const machines = gt.machines || [];
    const { U, V } = this._frame(ax);
    const Ub = new THREE.Vector3().crossVectors(Y, V); // right-handed basis x-axis (== U or -U)
    const g = { gt, ps, lanes: [], subs: [], cabs: [], booth: null, U, V };
    this.gates.push(g);
    const nL = machines.length - 1;
    // lane policy (demo: the Nankai central gate is two-way everywhere — every player crosses it in the first minute)
    const policy = (i) => (gt.id === 'g_nk_central' || i === 0 || i === nL - 1) ? 'both' : (i % 4 === 1 ? 'in' : i % 4 === 3 ? 'out' : 'both');
    // cabinets (layout machines + the channel dividers between them) and channels
    for (let i = 0; i < nL; i++) {
      const a = machines[i], b = machines[i + 1];
      const ln = { gate: gt.id, i, level: lv, axis: ax, at: gt.at, a, b, centre: (a + b) / 2, width: b - a, policy: policy(i), y, subs: [] };
      this.lanes.push(ln); g.lanes.push(ln);
      const n = nSubFor(b - a), p = (b - a) / n;
      for (let j = 0; j < n; j++) {
        g.cabs.push({ u: a + j * p, layout: j === 0 });
        const S = { g, ln, j, n, idx: g.subs.length, level: lv, lo: a + j * p, hi: a + (j + 1) * p, c: a + (j + 0.5) * p, clear: p - CAB_W, centre: j === (n - 1) / 2,
          ext: 0, target: 0, npcClose: 0, flash: [0, 0], flashOk: [true, true], okT: [0, 0], blocked: false, blockSide: 0, releaseT: 0, arm: null, hint: false, active: true, seg: null, segReal: null };
        ln.subs.push(S); g.subs.push(S); this.subs.push(S);
      }
    }
    if (nL >= 0 && machines.length) g.cabs.push({ u: machines[nL], layout: true });
    // ---- static cabinets ----
    const G = gateGeos();
    const place = (u, v, yy) => { const [x, z] = W(u, v); return _m.makeBasis(Ub, Y, V).setPosition(x, y + yy, z); };
    const icons = this.atlasMat;
    const quadF = (mat, C, X, Yv, w, h, uv) => {
      const P = (sx, sy) => [C.x + X.x * sx * w / 2 + Yv.x * sy * h / 2, C.y + X.y * sx * w / 2 + Yv.y * sy * h / 2, C.z + X.z * sx * w / 2 + Yv.z * sy * h / 2];
      gb.quad(mat, P(-1, -1), P(1, -1), P(1, 1), P(-1, 1), { uv: [[uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]]] });
    };
    g.cabs.forEach((cab, k) => {
      const u = cab.u;
      gb.geometry('transit_gate_plinth', G.plinth, place(u, 0, 0));
      gb.geometry('transit_gate_shell', G.body, place(u, 0, 0));
      gb.geometry(accent, G.band, place(u, 0, 0));
      gb.geometry('transit_gate_top', G.top, place(u, 0, 0));
      // flap slots on both side faces (where the flaps come out)
      for (const sd of [-1, 1]) boxUV('rubber_black', u + sd * (CAB_W / 2 + 0.001), y + FLAP_Y, 0, 0.004, FLAP_H + 0.04, 0.05);
      // player collision for the channel dividers (thin, so the 0.75 m channels stay easy to walk;
      // NOT a nav obstacle — the crowd's lanes and flow fields are unchanged)
      if (!cab.layout) { const [bx, bz] = W(u, 0); this._addBox(lv, bx, bz, ax === 'x' ? 0.09 : 0.7, ax === 'x' ? 0.7 : 0.09); }
      // each end: reader housing + ticket slot + LCD + LED housing + lane number, for the channel this cabinet
      // is the right-hand side of when approached from that end
      for (const e of [-1, 1]) {
        const sIdx = ((ax === 'x') === (e > 0)) ? k - 1 : k;
        const S = g.subs[sIdx];
        const d = sIdx === k - 1 ? -1 : 1;             // along-direction from this cabinet towards that channel
        const F = V.clone().multiplyScalar(e);         // outward (towards the approacher)
        // reader housing: dark wedge tilted towards the approacher
        const vr = e * (MACH_LEN / 2 - 0.2);
        const [rx, rz] = W(u + d * 0.012, vr);
        const tilt = 0.26;
        _N.copy(Y).multiplyScalar(Math.cos(tilt)).addScaledVector(F, Math.sin(tilt)).normalize();
        _T.copy(F).multiplyScalar(-Math.cos(tilt)).addScaledVector(Y, Math.sin(tilt)).normalize();
        _X.crossVectors(_T, _N);
        const housing = new THREE.BoxGeometry(0.205, 0.04, 0.25);
        _m.makeBasis(_X, _N, _T.clone().negate()).setPosition(rx, y + CAB_TOP + 0.012, rz);
        gb.geometry('transit_gate_reader', housing, _m); housing.dispose();
        const padC = new THREE.Vector3(rx, y + CAB_TOP + 0.034, rz);
        // LCD (towards the middle of the cabinet), tilted like the reader
        // (flat, in a dark bezel; reads upright for the person standing at this end)
        const [lx, lz] = W(u + d * 0.012, e * (MACH_LEN / 2 - 0.43));
        const lcdC = new THREE.Vector3(lx, y + CAB_TOP + 0.0175, lz);
        const lT = F.clone().negate(), lX = new THREE.Vector3().crossVectors(lT, Y);
        boxUV('transit_gate_reader', u + d * 0.012, y + CAB_TOP + 0.006, e * (MACH_LEN / 2 - 0.43), 0.17, 0.02, 0.1);
        quadF(icons, lcdC, lX, lT, 0.15, 0.075, UV.lcd);
        // ticket slot (entry) between the LCD and the middle
        boxUV('rubber_black', u, y + CAB_TOP + 0.002, e * (MACH_LEN / 2 - 0.6), 0.03, 0.006, 0.11, { faces: 't' });
        // end face: LED housing with lane number on top
        const vE = e * (MACH_LEN / 2 + 0.016);
        boxUV('transit_gate_top', u, y + 0.75, e * (MACH_LEN / 2 - 0.004), 0.17, 0.27, 0.035);
        const [ex, ez] = W(u, vE);
        _X.crossVectors(Y, F);
        if (S) {
          quadF(icons, new THREE.Vector3(ex, y + 0.845, ez), _X, Y, 0.085, 0.07, UV.num(Math.min(79, S.idx)));
          const ei = e > 0 ? 1 : 0;
          S.pad = S.pad || []; S.led = S.led || [];
          S.pad[ei] = { C: padC, N: _N.clone(), T: _T.clone(), X: new THREE.Vector3().crossVectors(_T, _N) };
          S.led[ei] = { C: new THREE.Vector3(ex, y + 0.715, ez), F: F.clone(), X: _X.clone() };
          S.lcd = S.lcd || []; S.lcd[ei] = { C: lcdC.clone().add(new THREE.Vector3(0, 0.002, 0)), N: Y.clone(), T: lT.clone(), X: lX.clone() };
        }
      }
    });
    // flap anchors + flap-line collision segments (parked until a block)
    for (const S of g.subs) {
      S.flapA = [];
      for (const sd of [-1, 1]) { // -1: from the cabinet at lo (protrudes +U), +1: from the cabinet at hi (protrudes -U)
        const base = sd < 0 ? S.lo + CAB_W / 2 - 0.03 : S.hi - CAB_W / 2 + 0.03;
        const [x, z] = W(base, 0);
        const Pd = U.clone().multiplyScalar(-sd);
        S.flapA.push({ x, z, P: Pd, Zb: new THREE.Vector3().crossVectors(Pd, Y) });
      }
      S.reach = Math.max(0.1, S.clear / 2 + 0.03 - 0.012);
      const [x0, z0] = W(S.lo, 0), [x1, z1] = W(S.hi, 0);
      S.segReal = [x0, z0, x1, z1];
      S.seg = null; // registered on the first update (main.js rebuilds the collision hash after the build phase)
      const [cx, cz] = W(S.c, 0); S.x = cx; S.z = cz;
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
        if (gt.axis === 'z' ? false : vert) { const a0 = e.az + s - gt.at, a1 = e.az + s + need - gt.at; if (Math.min(Math.abs(a0), Math.abs(a1)) < 2.2 || Math.sign(a0) !== Math.sign(a1)) continue; }
        const d = Math.hypot(px - gx, pz - gz);
        if (d > 40) continue;
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
    if (!best) best = this._freeIsland(gt, ps, side, need);
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

  // no wall: a free-standing bank parallel to the gate line, facing it, ~6 m away
  _freeIsland(gt, ps, side, need) {
    const w = this.ctx.world, lv = gt.level, grid = w.grids[lv];
    const dist = side < 0 ? 6.5 : 4.5;
    const across = gt.at + (-ps) * (side < 0 ? 1 : -1) * dist; // free side for side<0
    const facing = side < 0 ? ps : -ps; // normal pointing back towards the gate line
    const starts = [];
    for (let a = gt.from - 1; a + need < gt.to + 1; a += 1) starts.push(a);
    starts.sort((p, q) => Math.abs(p + need / 2 - gt.from) - Math.abs(q + need / 2 - gt.from));
    for (const a of starts) {
      let ok = true;
      for (let k = -0.5; k <= need + 0.5 && ok; k += 0.5) for (const dd of [-1.2, 0, 1.0, 2.0]) {
        const al = a + k, cr = across + facing * dd;
        const [qx, qz] = gt.axis === 'x' ? [al, cr] : [cr, al];
        const i = grid.cellOf(qx, qz);
        if (i < 0 || grid.type[i] !== CELL.WALK || grid.blocked[i]) { ok = false; break; }
      }
      if (!ok) continue;
      const vert = gt.axis !== 'x';
      const e = gt.axis === 'x' ? { ax: a, az: across, bx: a + need, bz: across } : { ax: across, az: a, bx: across, bz: a + need };
      const [nx, nz] = gt.axis === 'x' ? [0, facing] : [facing, 0];
      return { e, s: 0, vert, nx, nz, island: true };
    }
    return null;
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

  // ---- collision helpers (player only: world.segs / world.hash; the nav grid is untouched) --------------
  // Player-only collision (channel dividers + parked flap-line segments). main.js rebuilds world.hash from
  // world.obstacles after every build system, so anything we insert during build() is dropped: register here,
  // on the first update, once the hash is final. Not added to world.obstacles, so nav / the crowd never see it.
  _registerCollision() {
    this._colDone = true;
    for (const [lv, cx, cz, hx, hz] of this._pendingBoxes || []) this._insertBox(lv, cx, cz, hx, hz);
    for (const S of this.subs) { S.seg = this._addSeg(S.level, [1e7, 1e7, 1e7, 1e7], S.segReal); S.segI = S.seg ? this.ctx.world.segs[S.level].length - 1 : -1; }
  }
  _addSeg(lv, s, real) {
    const w = this.ctx.world;
    if (!w.segs || !w.segs[lv] || !w.hash || !w.hash[lv] || typeof w._hashSeg !== 'function') return null;
    // hash at the real position, then park it far away until it is needed
    const r = real || s;
    const arr = [r[0], r[1], r[2], r[3]];
    w.segs[lv].push(arr); w._hashSeg(w.hash[lv], arr, w.segs[lv].length - 1);
    arr[0] = s[0]; arr[1] = s[1]; arr[2] = s[2]; arr[3] = s[3];
    return arr;
  }
  _addBox(lv, cx, cz, hx, hz) { (this._pendingBoxes = this._pendingBoxes || []).push([lv, cx, cz, hx, hz]); }
  _insertBox(lv, cx, cz, hx, hz) {
    const w = this.ctx.world;
    if (typeof w._insertBox !== 'function' || !w.hash || !w.hash[lv] || !w.segs[lv]) return;
    w._insertBox(lv, { cx, cz, hx, hz, rot: 0 });
  }
  _setSeg(S, on) {
    if (!this._colDone) this._registerCollision();
    const w = this.ctx.world;
    if (S.seg && w.segs[S.level] && w.segs[S.level][S.segI] !== S.seg) this._registerCollision(); // hash rebuilt under us
    const s = S.seg; if (!s) return;
    const r = on ? S.segReal : [1e7, 1e7, 1e7, 1e7];
    s[0] = r[0]; s[1] = r[1]; s[2] = r[2]; s[3] = r[3];
  }

  // ---- instanced dynamic parts: flaps, IC pads, LED arrows, LED no-entry ---------------------------------
  _buildInstances() {
    const G = gateGeos();
    const flapMat = new THREE.MeshStandardMaterial({ color: 0xff6418, roughness: 0.42, metalness: 0.0, emissive: 0x521400, emissiveIntensity: 1.0 });
    flapMat.name = 'transit_flap';
    const basic = (name) => { const m = new THREE.MeshBasicMaterial({ map: this.atlas, color: 0xffffff }); m.name = name; return m; };
    const padGeo = quadGeo(UV.pad), arrowGeo = quadGeo(UV.arrow), crossGeo = quadGeo(UV.noentry);
    const padMat = basic('transit_gate_pad'), ledMat = basic('transit_gate_led');
    const byLevel = {};
    for (const S of this.subs) (byLevel[S.level] = byLevel[S.level] || []).push(S);
    for (const lv in byLevel) {
      const list = byLevel[lv], n = list.length * 2;
      const mk = (geo, mat, name) => {
        const im = new THREE.InstancedMesh(geo, mat, n);
        im.name = name + ':' + lv; im.frustumCulled = false;
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        im.setColorAt(0, _c.setRGB(1, 1, 1));
        this.ctx.engine.levelRoot(lv).add(im);
        return im;
      };
      const I = { list, flaps: mk(G.flap, flapMat, 'transit_flaps'), pads: mk(padGeo, padMat, 'transit_gate_pads'), arrows: mk(arrowGeo, ledMat, 'transit_gate_arrows'), crosses: mk(crossGeo, ledMat, 'transit_gate_noentry') };
      I.flaps.castShadow = false;
      list.forEach((S, k) => { S.ii = k * 2; S.I = I; });
      this.inst[lv] = I;
      for (const S of list) { this._writeFlaps(S); this._writeLights(S); }
      for (const k of ['flaps', 'pads', 'arrows', 'crosses']) { I[k].instanceMatrix.needsUpdate = true; if (I[k].instanceColor) I[k].instanceColor.needsUpdate = true; }
    }
  }
  _writeFlaps(S) {
    const im = S.I.flaps, y = LEVELS[S.level].y;
    const sx = Math.max(0.004, S.ext * S.reach / FLAP_L);
    for (let k = 0; k < 2; k++) {
      const A = S.flapA[k];
      _m.makeBasis(A.P, Y, A.Zb).setPosition(A.x, y + FLAP_Y, A.z);
      _s.makeScale(sx, 1, 1);
      im.setMatrixAt(S.ii + k, _m.multiply(_s));
    }
  }
  // allowed to walk through from side `side` (+1/-1 across the line)?
  _allowed(S, side) {
    const pol = S.ln.policy;
    if (pol === 'both') return true;
    const entering = -side === S.g.ps;
    return pol === 'in' ? entering : !entering;
  }
  _writeLights(S) {
    const I = S.I, t = this._t;
    for (let ei = 0; ei < 2; ei++) {
      const side = ei ? 1 : -1;
      const ok = this._allowed(S, side);
      const pad = S.pad && S.pad[ei], led = S.led && S.led[ei];
      if (!pad || !led) { for (const im of [I.pads, I.arrows, I.crosses]) im.setMatrixAt(S.ii + ei, _m.makeScale(0, 0, 0)); continue; }
      // IC pad: blue, pulses for the tutorial hint, flashes on a tap
      _m.makeBasis(pad.X, pad.T, pad.N).setPosition(pad.C.x, pad.C.y, pad.C.z);
      I.pads.setMatrixAt(S.ii + ei, _m.multiply(_s.makeScale(0.17, 0.2, 1)));
      if (S.flash[ei] > 0) {
        const k = Math.min(1, S.flash[ei] / 0.25);
        if (S.flashOk[ei]) _c.setRGB(0.55 + 0.6 * k, 1.0 + 0.9 * k, 0.75 + 0.7 * k); else _c.setRGB(1.6 + 1.2 * k, 0.18, 0.12);
      } else if (S.hint && (this._hintSide == null || this._hintSide === side)) {
        const k = 0.5 + 0.5 * Math.sin(t * 7);
        _c.setRGB(0.35 + 0.5 * k, 0.8 + 0.9 * k, 1.4 + 1.0 * k);
      } else if (ok) _c.setRGB(0.32, 0.72, 1.45);
      else _c.setRGB(0.12, 0.2, 0.32);
      I.pads.setColorAt(S.ii + ei, _c);
      // LEDs
      const red = S.blocked || S.npcClose > 0 || S.flash[ei] > 0 && !S.flashOk[ei];
      const showArrow = ok && !red, showCross = !ok || red;
      _m.makeBasis(led.X, Y, led.F).setPosition(led.C.x, led.C.y, led.C.z);
      _s.makeScale(0.115, 0.115, 1);
      const mm = _m.clone().multiply(_s);
      I.arrows.setMatrixAt(S.ii + ei, showArrow ? mm : _m.makeScale(0, 0, 0));
      I.crosses.setMatrixAt(S.ii + ei, showCross ? mm : _m.makeScale(0, 0, 0));
      const boost = S.okT[ei] > 0 ? 1.9 : 1.15;
      I.arrows.setColorAt(S.ii + ei, _c.setRGB(boost, boost, boost));
      const blink = red ? (Math.sin(t * 16) > -0.2 ? 1.9 : 0.35) : 1.1;
      I.crosses.setColorAt(S.ii + ei, _c.setRGB(blink, blink, blink));
    }
  }

  // the player's little "IC card" readout on the gate LCD (balance / fare), for ~3.5 s after a tap
  _buildLcd() {
    const c = canvas(256, 128);
    this._lcdCanvas = c; this._lcdTex = canvasTex(c, { mips: false });
    const mat = new THREE.MeshBasicMaterial({ map: this._lcdTex, color: new THREE.Color(1.3, 1.3, 1.3) });
    mat.name = 'transit_gate_lcd_live';
    this.lcdMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.075), mat);
    this.lcdMesh.name = 'transit_gate_lcd_live';
    this.lcdMesh.visible = false; this.lcdMesh.frustumCulled = false;
    this._lcdT = 0;
  }
  _showLcd(S, ei, o) {
    const L = S.lcd && S.lcd[ei]; if (!L || !this.lcdMesh) return;
    const g = this._lcdCanvas.getContext('2d');
    const col = S.g.gt.line === 'midosuji' ? '#E5171F' : S.g.gt.line === 'sennichimae' ? '#E44D93' : '#F08300';
    g.fillStyle = '#071226'; g.fillRect(0, 0, 256, 128);
    g.fillStyle = col; g.fillRect(0, 0, 256, 26);
    g.fillStyle = '#fff'; g.font = `700 18px ${JP}`; fitText(g, o.ok ? 'IC  ありがとうございました' : 'IC  もう一度タッチしてください', 128, 20, 244, 'center');
    if (o.ok) {
      g.fillStyle = '#9fd0ff'; g.font = `600 18px ${JP}`; g.fillText('残額', 12, 62);
      g.fillStyle = '#ffffff'; g.font = `800 36px ${EN}`; g.textAlign = 'right';
      g.fillText(o.balance != null ? '¥' + Math.round(o.balance).toLocaleString('en-US') : '— — —', 244, 68);
      g.font = `700 22px ${EN}`; g.fillStyle = o.fare ? '#ffd27a' : '#7fe0a0';
      g.fillText(o.fare ? '−¥' + Math.round(o.fare) + '  運賃 fare' : (o.dir > 0 ? '入場  IN' : '出場  OUT'), 244, 112);
      g.textAlign = 'left';
    } else {
      g.fillStyle = '#ff6b5e'; g.font = `800 30px ${JP}`; fitText(g, o.reason === 'balance' ? '残額不足' : '入場できません', 128, 74, 236, 'center');
      g.fillStyle = '#ffb4ab'; g.font = `600 18px ${EN}`; fitText(g, o.reason === 'balance' ? 'Insufficient balance' : 'Please use another gate', 128, 108, 236, 'center');
    }
    this._lcdTex.needsUpdate = true;
    const m = this.lcdMesh;
    this.ctx.engine.levelRoot(S.level).add(m);
    _m.makeBasis(L.X, L.T, L.N).setPosition(L.C.x, L.C.y, L.C.z);
    m.matrixAutoUpdate = false; m.matrix.copy(_m); m.matrixWorldNeedsUpdate = true;
    m.visible = true; this._lcdT = 3.5;
  }

  // ---- queries ----------------------------------------------------------------------------------------------
  _gateById(id) { return this.gates.find(g => g.gt.id === id); }
  _uv(g, x, z) { const gt = g.gt; return gt.axis === 'x' ? [x, z - gt.at] : [z, x - gt.at]; }
  _subAt(g, u) {
    const subs = g.subs; if (!subs.length || u < subs[0].lo || u >= subs[subs.length - 1].hi) return null;
    let lo = 0, hi = subs.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (subs[m].lo <= u) lo = m; else hi = m - 1; }
    return subs[lo];
  }
  laneAt(gateId, along) {
    const g = this._gateById(gateId); if (!g) return -1;
    for (const ln of g.lanes) if (along >= ln.a && along <= ln.b) return ln.i;
    return -1;
  }
  laneNear(x, z, level) {
    for (const g of this.gates) {
      if (g.gt.level !== level) continue;
      const [u, v] = this._uv(g, x, z);
      if (Math.abs(v) > NEAR_V) continue;
      const S = this._subAt(g, u); if (!S) continue;
      const side = v >= 0 ? 1 : -1;
      const dir = -side === g.ps ? 1 : -1;
      const ei = side > 0 ? 1 : 0;
      const pad = S.pad && S.pad[ei];
      const gt = g.gt;
      return { gate: gt.id, lane: S.ln.i, sub: S.j, dir, ok: this._allowed(S, side), open: !!(S.arm && S.arm.side === side && this._t < S.arm.until), policy: S.ln.policy, line: gt.line, name: gt.name, ja: gt.ja, dist: Math.abs(v), reader: pad ? { x: pad.C.x, y: pad.C.y, z: pad.C.z } : { x: S.x, y: LEVELS[level].y + 1, z: S.z }, x: S.x, z: S.z, level };
    }
    return null;
  }
  _playerSide(g) {
    const p = this.ctx.player && this.ctx.player.body;
    if (!p || p.level !== g.gt.level) return null;
    const [, v] = this._uv(g, p.x, p.z);
    if (Math.abs(v) > 12) return null;
    return v >= 0 ? 1 : -1;
  }
  _sound(name, S) {
    const a = this.ctx.audio; if (!a || typeof a.play !== 'function') return;
    try { a.play(name, { pos: { x: S.x, z: S.z, level: S.level, y: LEVELS[S.level].y + 1.0 } }); } catch (e) { /* audio optional */ }
  }

  // ---- the player's tap (Story calls this on E) ---------------------------------------------------------------
  tap(gateId, lane, opts = {}) {
    if (typeof opts === 'number') opts = { sub: opts };
    const g = this._gateById(gateId); if (!g) return { ok: false, reason: 'none' };
    const ln = g.lanes[lane]; if (!ln) return { ok: false, reason: 'none' };
    const p = this.ctx.player && this.ctx.player.body;
    let S = opts.sub != null ? ln.subs[opts.sub] : null;
    if (!S) {
      const u = p ? this._uv(g, p.x, p.z)[0] : ln.centre;
      S = ln.subs.reduce((b, s) => Math.abs(s.c - u) < Math.abs(b.c - u) ? s : b, ln.subs[0]);
    }
    let side = this._playerSide(g);
    if (S.blocked) side = S.blockSide;
    if (side == null) side = -g.ps;
    const ei = side > 0 ? 1 : 0;
    const dir = -side === g.ps ? 1 : -1;
    const deny = opts.deny || (!this._allowed(S, side) ? 'lane' : null);
    if (deny) {
      S.flash[ei] = 0.6; S.flashOk[ei] = false; S.npcClose = Math.max(S.npcClose, 1.1); S.active = true;
      if (!opts.quiet) this._sound('gate_fail', S);
      this._showLcd(S, ei, { ok: false, reason: deny });
      this.ctx.events.emit('gate:blocked', { gate: gateId, lane: ln.i, sub: S.j, dir, level: S.level, x: S.x, z: S.z, reason: deny });
      return { ok: false, reason: deny };
    }
    S.arm = { side, until: this._t + ARM_S, passed: false };
    if (S.blocked) { S.blocked = false; S.releaseT = 0; this._setSeg(S, false); }
    S.npcClose = 0;
    S.flash[ei] = 0.55; S.flashOk[ei] = true; S.okT[ei] = 1.2; S.active = true;
    if (!opts.quiet) this._sound(opts.balance != null && opts.balance < 300 ? 'gate_low' : 'gate_ok', S);
    this._showLcd(S, ei, { ok: true, balance: opts.balance, fare: opts.fare, dir });
    this.ctx.events.emit('gate:tap', { gate: gateId, lane: ln.i, sub: S.j, dir, line: g.gt.line, level: S.level, x: S.x, z: S.z, player: true, auto: !!opts.auto });
    return { ok: true, reason: null, dir };
  }
  setHint(gateId, lane, sub) {
    this.hint = gateId ? { gate: gateId, lane: lane == null ? null : lane, sub: sub == null ? null : sub } : null;
    for (const S of this.subs) {
      const on = !!this.hint && S.g.gt.id === gateId && (this.hint.lane == null || S.ln.i === this.hint.lane) && (this.hint.sub == null || S.j === this.hint.sub);
      if (on !== S.hint) { S.hint = on; S.active = true; }
    }
  }

  // ---- NPC (and legacy) passes: reader flash + LED on the crowd's centre channel ----------------------------------
  pass(gateId, laneIndex, dir = 1, ok = true) {
    const g = this._gateById(gateId); if (!g) return false;
    const ln = g.lanes[laneIndex]; if (!ln) return false;
    let S = ln.subs[(ln.subs.length - 1) >> 1];
    // the player's own channel if they are in this lane (legacy game.js calls for the player)
    const ps = this.pl.S;
    if (ps && ps.ln === ln) S = ps;
    let side = dir ? -Math.sign(dir) : (this._playerSide(g) || -g.ps);
    const ei = side > 0 ? 1 : 0;
    if (S === ps && ok) return true; // the player's channel animates itself
    S.flash[ei] = 0.32; S.flashOk[ei] = ok; S.okT[ei] = ok ? 0.5 : 0; S.active = true;
    if (!ok) S.npcClose = 1.3;
    return true;
  }

  // ---- per frame -------------------------------------------------------------------------------------------------
  _player(dt) {
    const p = this.ctx.player && this.ctx.player.body;
    const pl = this.pl;
    let inS = null, side = 0;
    if (p && !(p.ramp >= 0)) {
      for (const g of this.gates) {
        if (g.gt.level !== p.level) continue;
        const [u, v] = this._uv(g, p.x, p.z);
        if (Math.abs(v) > MACH_LEN / 2 + 0.02) continue;
        const S = this._subAt(g, u); if (!S) continue;
        if (u < S.lo + CAB_W / 2 - 0.08 || u > S.hi - CAB_W / 2 + 0.08) continue;
        inS = S; side = v >= 0 ? 1 : -1; break;
      }
    }
    // hint pulses the player's side
    if (this.hint) { const g = this._gateById(this.hint.gate); this._hintSide = g ? this._playerSide(g) : null; }
    // left a channel
    if (pl.S && pl.S !== inS) {
      const S = pl.S;
      if (S.arm && S.arm.passed) S.arm = null;
      if (S.blocked) S.releaseT = 0.45;
      pl.S = null;
    }
    if (!inS) return;
    const S = inS;
    if (pl.S !== S) {
      // just walked into this channel (from the end on `side`)
      pl.S = S; pl.side = side; pl.lastSide = side;
      const armed = S.arm && S.arm.side === side && this._t < S.arm.until;
      if (!armed && !S.blocked) {
        if (this.autoTap && this._allowed(S, side)) this.tap(S.g.gt.id, S.ln.i, { sub: S.j, auto: true });
        else this._block(S, side, this._allowed(S, side) ? 'notap' : 'lane');
      }
      if (S.blocked) S.releaseT = 0;
    }
    if (S.arm) {
      S.arm.until = Math.max(S.arm.until, this._t + 0.6);
      if (side !== pl.lastSide && !S.arm.passed) {
        S.arm.passed = true;
        const g = S.g;
        this.ctx.events.emit('gate:pass', { gate: g.gt.id, lane: S.ln.i, sub: S.j, dir: -pl.lastSide === g.ps ? 1 : -1, ok: true, level: S.level, x: S.x, z: S.z, player: true });
      }
    }
    if (S.blocked) S.releaseT = 0;
    pl.lastSide = side;
  }
  _block(S, side, reason) {
    const ei = side > 0 ? 1 : 0, g = S.g;
    S.blocked = true; S.blockSide = side; S.releaseT = 0; S.active = true;
    S.flash[ei] = 0.6; S.flashOk[ei] = false;
    this._setSeg(S, true);
    const now = this._t;
    if (!this._lastBlock || now - this._lastBlock > 0.8) this._sound('gate_fail', S);
    this._lastBlock = now;
    this.ctx.events.emit('gate:blocked', { gate: g.gt.id, lane: S.ln.i, sub: S.j, dir: -side === g.ps ? 1 : -1, level: S.level, x: S.x, z: S.z, reason });
  }
  update(dt) {
    if (!this._colDone) this._registerCollision();
    this._t += dt;
    this._player(dt);
    if (this._lcdT > 0) { this._lcdT -= dt; if (this._lcdT <= 0 && this.lcdMesh) this.lcdMesh.visible = false; }
    for (const lv in this.inst) {
      const I = this.inst[lv];
      let flapsDirty = false, lightsDirty = false;
      for (const S of I.list) {
        if (!S.active) continue;
        let busy = S.hint;
        if (S.flash[0] > 0) { S.flash[0] -= dt; busy = true; } if (S.flash[1] > 0) { S.flash[1] -= dt; busy = true; }
        if (S.okT[0] > 0) { S.okT[0] -= dt; busy = true; } if (S.okT[1] > 0) { S.okT[1] -= dt; busy = true; }
        if (S.npcClose > 0) { S.npcClose -= dt; busy = true; }
        if (S.blocked) {
          busy = true;
          if (S.releaseT > 0) { S.releaseT -= dt; if (S.releaseT <= 0) { S.blocked = false; this._setSeg(S, false); } }
        }
        if (S.arm) { busy = true; if (this._t > S.arm.until && this.pl.S !== S) S.arm = null; }
        S.target = (S.blocked || S.npcClose > 0) ? 1 : 0;
        if (S.ext !== S.target) {
          const sp = S.target > S.ext ? 11 : 3.2;
          S.ext += Math.sign(S.target - S.ext) * Math.min(Math.abs(S.target - S.ext), sp * dt);
          this._writeFlaps(S); flapsDirty = true; busy = true;
        }
        this._writeLights(S); lightsDirty = true;
        S.active = busy; // one last write after it goes idle
      }
      if (flapsDirty) I.flaps.instanceMatrix.needsUpdate = true;
      if (lightsDirty) for (const k of ['pads', 'arrows', 'crosses']) { I[k].instanceMatrix.needsUpdate = true; if (I[k].instanceColor) I[k].instanceColor.needsUpdate = true; }
    }
  }
  // test helper: snap the flaps of the channel the player is looking into
  _debugBlock() {
    const p = this.ctx.player.body;
    const n = this.laneNear(p.x, p.z, p.level); if (!n) return null;
    const g = this._gateById(n.gate), S = g.lanes[n.lane].subs[n.sub];
    this._block(S, n.dir === 1 ? -g.ps : g.ps, 'debug');
    return n;
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
