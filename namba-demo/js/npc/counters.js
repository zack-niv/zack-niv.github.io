// =============================================================================
// Counter staff (v2 item 7): a barista / chef / clerk behind every counter the
// Shops agent publishes in ctx.counters = [{slotId, name, kind, level,
// staff:{x,y,z,yaw}, order:{x,y,z}, role}].
//
// Staff are ordinary crowd agents (so they get the same people, LOD and
// lighting) on a 'post' leg with L.C = the counter: idle behind the counter,
// a nod now and then, they look at and nod to the player walking up, and serve
// whoever is ordering (café customers line up one step to the side of the
// player's order spot, see behave.js 'order'). On 'demo:order' {slotId} the
// staff of that counter plays a hand-over. They are spawned only within ~70 m
// of the player (despawned beyond ~95 m) and don't count against the crowd
// population. Emits nothing.
// =============================================================================
import { POSE } from './sim.js?v=f150c03';
import { BIT } from './looks.js?v=f150c03';

const NEAR = 70, FAR = 95;
const APRON = { barista: [0x3a2a1e, 0x1d1d1f, 0x2f4a36, 0x5a3b26, 0x22283a], chef: [0xf1efe9], clerk: [0x1e3f7a, 0x2a6a46, 0xb03030, 0x22283a, 0x1d1d1f] };
const TOP = { barista: [0xf0eee8, 0x1b1b1d, 0x2b2b2e, 0xe8e2d6], chef: [0xf4f3ef], clerk: [0xf0f0ec, 0x8fb0c6, 0xe9e7e1, 0x1b1b1d] };

export class CounterStaff {
  constructor(crowd) {
    this.crowd = crowd; this.ctx = crowd.ctx; this.sim = crowd.sim;
    this.list = [];            // our counter records
    this._src = null; this._srcN = -1; this._t = 0;
    // a teleport is a cut: staff around the new spot appear at once
    this.ctx.events && this.ctx.events.on('player:teleport', () => { this._t = 0; this._cut = true; });
    this.ctx.events && this.ctx.events.on('demo:order', (e) => { const C = e && this.bySlot && this.bySlot[e.slotId]; if (C) C.served = true; });
    this._scan();
  }
  get count() { let n = 0; for (const C of this.list) if (C.agent && C.agent.alive) n++; return n; }

  // (re)build from ctx.counters (it may be filled late, or entries nudged / dropped in the first frames)
  _scan() {
    const src = this.ctx.counters;
    if (!Array.isArray(src)) return;
    const sig = src.length + ':' + src.map(c => c && c.staff ? (c.staff.x * 10 | 0) + (c.staff.z * 10 | 0) : 0).reduce((a, b) => a + b, 0);
    if (src === this._src && sig === this._sig) return;
    this._src = src; this._sig = sig;
    const P = this.sim.places, col = this.sim.col;
    const old = this.bySlot || {};
    this.list = []; this.bySlot = {};
    for (const c of src) {
      if (!c || !c.staff || !c.level || !Number.isFinite(c.staff.x) || !Number.isFinite(c.staff.z)) continue;
      const prev = old[c.slotId];
      const C = prev && prev.entry === c ? prev : { entry: c, slotId: c.slotId, queue: [], agent: null, served: false, serveFor: null };
      C.entry = c; C.level = c.level;
      C.B = P.bizBySlot[c.slotId] || null;
      // NPC order spot: one step beside the player's order spot, the line goes back from the counter
      C.npc = null;
      if (c.order && Number.isFinite(c.order.x)) {
        let nx = c.order.x - c.staff.x, nz = c.order.z - c.staff.z; const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
        const tx = -nz, tz = nx;
        for (const sgn of [1, -1]) {
          const x = c.order.x + tx * 0.85 * sgn, z = c.order.z + tz * 0.85 * sgn;
          if (!col.walkable(c.level, x, z) || !col.walkable(c.level, x + nx * 0.72, z + nz * 0.72)) continue;
          C.npc = { x, z, yaw: Math.atan2(nx, nz), bx: nx, bz: nz };
          break;
        }
      }
      if (C.B) C.B.ctr = C;
      this.list.push(C); this.bySlot[c.slotId] = C;
      // generic staff posts on (almost) the same spot are skipped by the director: no doubles
      for (const p of P.posts) if (p.level === c.level && Math.hypot(p.x - c.staff.x, p.z - c.staff.z) < 1.3) p.dup = true;
    }
  }

  update(dt) {
    this._t -= dt;
    if (this._t > 0) return;
    this._t = 0.5;
    this._scan();
    const S = this.sim, V = S.viewer, D = this.crowd.behave && this.crowd.behave.director;
    if (!V.has || !D) return;
    const sh = this.ctx.shops;
    const minutes = D.minutes;
    let n = 0;
    for (const C of this.list) {
      const c = C.entry;
      const a = C.agent && C.agent.alive && C.agent.legs && C.agent.legs[0] && C.agent.legs[0].C === C ? C.agent : null;
      if (!a) C.agent = null;
      const d = V.level === c.level ? Math.hypot(V.x - c.staff.x, V.z - c.staff.z) : Infinity;
      let open = true;
      try { if (sh && sh.isShuttered && sh.isShuttered(c.slotId)) open = false; } catch (e) { /* shops owns it */ }
      if (open && C.B && C.B.b && D.P.bizOpen && !D.P.bizOpen(C.B, minutes)) open = false;
      if (a) {
        if (d > FAR || !open) { a.fadeDir = -1; C.agent = null; }
        else n++;
        continue;
      }
      if (!open || d > NEAR) continue;
      C.agent = this._spawn(C, D);
      if (C.agent) { n++; if (this._cut || d > 25) { C.agent.fade = 1; C.agent.fadeDir = 1; } }
    }
    this._cut = false;
    D.extra = n;
  }

  _spawn(C, D) {
    const c = C.entry, role = c.role || (c.kind === 'cafe' ? 'barista' : c.kind === 'shop' ? 'clerk' : 'chef');
    let h = 0; for (const ch of String(c.slotId)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const pick = (arr) => arr[h % arr.length];
    const female = ((h >> 3) & 1) === 1;
    const a = D.makeAgent('staff_shop', { look: { female, apron: pick(APRON[role] || APRON.barista), cap: role === 'chef' || ((h >> 5) & 3) === 0 } });
    const lk = a.look;
    // counters are deep (pastry case + back bar): a short figure reads as 'sunk' behind them. Staff are never below ~1.63 m.
    if (lk.h != null && lk.h < 0.96) lk.h = 0.96 + ((h >> 7) & 3) * 0.01;
    lk.colA[0] = pick(TOP[role] || TOP.barista); lk.colA[1] = role === 'chef' ? 0x2b2b2e : 0x1b1b1d; lk.colB[1] = lk.colA[0];
    if (role === 'chef') { lk.colB[3] = 0xf4f3ef; lk.flags |= (1 << BIT.CAP); }
    else {
      // the apron must read against the shirt: dark shirt -> light / coloured apron, light shirt -> dark apron
      const lum = (c) => ((c >> 16) & 255) * 0.3 + ((c >> 8) & 255) * 0.59 + (c & 255) * 0.11;
      if (Math.abs(lum(lk.colB[3]) - lum(lk.colA[0])) < 60) lk.colB[3] = lum(lk.colA[0]) < 128 ? [0x8a6a48, 0x3f6b4c, 0xc9b79b][h % 3] : 0x2b2b2e;
    }
    lk.flags |= (1 << BIT.APRON);
    lk.flags &= ~((1 << BIT.BRIEFCASE) | (1 << BIT.SHOULDERBAG) | (1 << BIT.BACKPACK) | (1 << BIT.TOTE) | (1 << BIT.SHOPBAG) | (1 << BIT.SHOPBAG2) | (1 << BIT.MASK) | (1 << BIT.JACKET) | (1 << BIT.COAT) | (1 << BIT.SKIRT));
    a.flags = lk.flags;
    a.counterStaff = C;
    this.sim.setPos(a, c.level, c.staff.x, c.staff.z);
    a.yaw = c.staff.yaw || 0;
    this.crowd.behave.begin(a, [{ t: 'post', level: c.level, x: c.staff.x, z: c.staff.z, yaw: c.staff.yaw || 0, kind: 'staff_shop', C }]);
    a.pose = POSE.STAND;
    return a;
  }
}
