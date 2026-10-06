// =============================================================================
// Lodestone guidance — turn-by-turn that is actually right.
//
// Everything is derived from the nav graph (the same one the crowds walk):
//   * the field to the destination's door node (no entry into the fare-paid
//     area, like the Maps app),
//   * routeLegs(): the node path split into per-floor legs and the escalators /
//     stairs that join them,
//   * maneuvers: turns (> 55° on a simplified path), zone entries ("into Namba
//     Parks 2F"), escalators ("Escalator up · 1F → 2F", merged when they chain),
//     and the arrival with the side the door is on.
// Pure logic (no DOM / THREE): compute(body) → route { ok, total, eta, steps,
// pts (x, worldY, z) for the 3D view, marks, ... }.
// =============================================================================
import { LAYOUT, LEVELS, LEVEL_ORDER, ZONES, rampEnds, rampProfile, rampLength } from '../../world/layout.js';
import { routeLegs, fieldNoEntry } from './routes.js';
import { businessBySlot } from '../../world/directory.js';

export const ZONE_SHORT = {
  nankai: 'Nankai Station', city: 'Namba CITY', parks: 'Namba Parks', parksGarden: 'Parks Garden', nambawalk: 'NAMBAWALK',
  takashimaya: 'Takashimaya', link: 'the underground passage', midosuji: 'Midosuji Line', sennichimae: 'Sennichimae Line',
  plaza: 'Namba Plaza', street: 'Sennichimae-dori',
};
const lvl = (l) => LEVELS[l].label.replace('B1F', 'B1').replace('B2F', 'B2');

// Douglas–Peucker returning kept indices
function dpIdx(pts, eps) {
  const n = pts.length; if (n < 3) return pts.map((_, i) => i);
  const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
  const st = [[0, n - 1]];
  while (st.length) {
    const [a, b] = st.pop();
    const [ax, az] = pts[a], [bx, bz] = pts[b];
    const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1;
    let best = -1, bd = eps;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((pts[i][0] - ax) * dz - (pts[i][1] - az) * dx) / l; if (d > bd) { bd = d; best = i; } }
    if (best >= 0) { keep[best] = 1; st.push([a, best], [best, b]); }
  }
  const out = []; for (let i = 0; i < n; i++) if (keep[i]) out.push(i);
  return out;
}

export class Guidance {
  constructor(ctx, dest) {
    this.ctx = ctx;
    this.dest = dest;       // { id, en, ja, level, x, z (door outside), nx, nz (door normal), slot }
    this.field = null;
    this.goal = -1;
  }

  // Heavy part (a few hundred ms): the cost field to the destination.
  prepare() {
    if (this.field) return this.field;
    const nav = this.ctx.nav, d = this.dest;
    this.goal = nav.nodeAtPoint(d.level, d.x, d.z);
    this.field = fieldNoEntry(nav, 'lodestone:' + d.id, [this.goal]);
    return this.field;
  }

  // metres of path to go (graph cost; ≈ metres, escalators weigh a little less)
  remaining(body) {
    const f = this.prepare(), nav = this.ctx.nav;
    const v = nav.nodeAt(body);
    return v < 0 ? Infinity : f.dist[v];
  }

  _startNode(body) {
    const nav = this.ctx.nav, f = this.prepare();
    let v = nav.nodeAt(body);
    if (v >= 0 && isFinite(f.dist[v])) return v;
    for (let r = 2; r <= 14; r += 2) for (let a = 0; a < 8; a++) {
      const w = nav.nodeAtPoint(body.level, body.x + Math.cos(a * Math.PI / 4) * r, body.z + Math.sin(a * Math.PI / 4) * r);
      if (w >= 0 && isFinite(f.dist[w])) return w;
    }
    return -1;
  }

  compute(body, heading = 0) {
    const { ctx } = this, nav = ctx.nav, W = ctx.world, d = this.dest;
    const f = this.prepare();
    const v = this._startNode(body);
    if (v < 0) return { ok: false };
    const legs = routeLegs(nav, f, v);
    if (!legs.length) return { ok: false };

    const pts = [];        // [x, worldY, z]
    const marks = [];      // ramp markers for the 3D view
    const man = [];        // maneuvers {at, x, z, level, ...}
    let cum = 0, time = 0, ramps = 0;
    const yOf = (l) => LEVELS[l].y;
    pts.push([body.x, body.ramp >= 0 ? body.y : yOf(body.level), body.z, 0]);
    let prevDir = null;                       // travel direction at the end of the previous leg
    let prevZone = null, prevSpace = null;
    let lastWalkEnd = 0;

    for (let li = 0; li < legs.length; li++) {
      const leg = legs[li], lp = leg.pts, g = W.grids[leg.level];
      const idx = dpIdx(lp, 2.6);
      // cumulative metres along the leg's points
      const cl = new Float32Array(lp.length);
      for (let i = 1; i < lp.length; i++) cl[i] = cl[i - 1] + Math.hypot(lp[i][0] - lp[i - 1][0], lp[i][1] - lp[i - 1][1]);
      const base = cum;
      // 3D polyline (denser than the guidance waypoints, much sparser than the nodes)
      const di = dpIdx(lp, 0.9);
      for (const i of di) { if (li === 0 && i === 0) continue; pts.push([lp[i][0], yOf(leg.level), lp[i][1], base + cl[i]]); }
      cum = base + cl[lp.length - 1];
      time += cl[lp.length - 1] / 1.5;

      // ---- zone / space entries along the leg -------------------------------
      const spaceAtIdx = (i) => { const si = g.spaceAt(lp[i][0], lp[i][1]); return si >= 0 ? LAYOUT.spaces[si] : null; };
      let curZone = prevZone, curSpace = prevSpace;
      const zoneEvents = [];
      for (let i = 0; i < lp.length; i += 2) {
        const sp = spaceAtIdx(i); if (!sp || sp.kind === 'room') continue;
        if (!curZone) { curZone = sp.zone; curSpace = sp; continue; }
        if (sp.zone !== curZone) { zoneEvents.push({ i, zone: sp.zone, space: sp, bridge: /bridge/.test(sp.id) }); curZone = sp.zone; }
        else if (/bridge/.test(sp.id) && !/bridge/.test(curSpace.id)) zoneEvents.push({ i, zone: sp.zone, space: sp, bridge: true });
        curSpace = sp;
      }
      prevZone = curZone; prevSpace = curSpace;

      // ---- turns ------------------------------------------------------------
      let dirIn = prevDir;
      const turns = [];
      for (let j = 0; j < idx.length - 1; j++) {
        const a = lp[idx[j]], b = lp[idx[j + 1]];
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l < 0.5) continue;
        const dir = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
        if (dirIn) {
          const cross = dirIn[0] * dir[1] - dirIn[1] * dir[0], dot = dirIn[0] * dir[0] + dirIn[1] * dir[1];
          const deg = Math.atan2(cross, dot) * 180 / Math.PI;     // + right, − left
          if (Math.abs(deg) >= 55) turns.push({ i: idx[j], deg });
        }
        dirIn = dir;
      }
      // last travel direction of this leg
      if (idx.length >= 2) { const a = lp[idx[idx.length - 2]], b = lp[idx[idx.length - 1]]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; prevDir = [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; }

      const zoneName = (z) => ZONE_SHORT[z] || (ZONES[z] && ZONES[z].name) || 'the next area';
      const mk = (i, o) => man.push({ at: base + cl[i], x: lp[i][0], z: lp[i][1], level: leg.level, ...o });
      // zone entries become the title of a turn if one is within 12 m, else their own step
      for (const ze of zoneEvents) {
        const near = turns.find(t => Math.abs(cl[t.i] - cl[ze.i]) < 12 && !t.used);
        const into = ze.bridge ? `across the bridge into ${zoneName(ze.zone)}` : `into ${zoneName(ze.zone)} ${lvl(leg.level)}`;
        if (near) { near.used = true; near.into = into; near.i = ze.i; }
        else mk(ze.i, { icon: 'straight', title: ze.bridge ? 'Cross the bridge' : `Continue into ${zoneName(ze.zone)}`, sub: ze.bridge ? `to ${zoneName(ze.zone)} ${lvl(leg.level)}` : lvl(leg.level) });
      }
      for (const t of turns) {
        const left = t.deg < 0, sharp = Math.abs(t.deg) > 120;
        const sp = spaceAtIdx(Math.min(lp.length - 1, t.i + 3));
        mk(t.i, {
          icon: sharp ? (left ? 'uleft' : 'uright') : left ? 'left' : 'right',
          title: sharp ? 'Turn around' : left ? 'Turn left' : 'Turn right',
          sub: t.into || (sp && sp.zone && sp.kind !== 'room' ? `${zoneName(sp.zone)} ${lvl(leg.level)}` : lvl(leg.level)),
        });
      }

      // ---- the ramp that ends this leg --------------------------------------
      if (leg.ramp >= 0) {
        const r = LAYOUT.ramps[leg.ramp], up = leg.dir > 0, to = up ? r.upper : r.lower;
        const E = rampEnds(r), s0 = up ? E.low : E.high, s1 = up ? E.high : E.low;
        const rl = rampLength(r);
        // geometry of the climb
        const last = pts[pts.length - 1];
        const n = 7;
        for (let k = 0; k <= n; k++) {
          const t = k / n, x = s0.x + (s1.x - s0.x) * t, z = s0.z + (s1.z - s0.z) * t;
          const sN = up ? t : 1 - t;
          const y = rampProfile(r, sN);
          if (k === 0 && Math.hypot(x - last[0], z - last[2]) < 0.3) { last[1] = y; continue; }
          pts.push([x, y, z, cum + rl * t]);
        }
        marks.push({ x: s0.x, z: s0.z, y: yOf(leg.level), text: `${up ? '▲' : '▼'} ${lvl(to)}`, up, level: leg.level });
        const rideDir = [(s1.x - s0.x) / (Math.hypot(s1.x - s0.x, s1.z - s0.z) || 1), (s1.z - s0.z) / (Math.hypot(s1.x - s0.x, s1.z - s0.z) || 1)];
        prevDir = rideDir;
        const prev = man[man.length - 1];
        // chain of escalators with a short connecting walk collapses into one step
        const word = r.kind === 'escalator' ? 'Escalator' : 'Stairs';
        if (prev && prev.kind === 'ramp' && prev.up === up && (base - prev.endCum) < 9) {
          prev.count++; prev.to = to; prev.endCum = cum + rl;
          prev.title = `${prev.word}${prev.count > 1 ? (prev.word === 'Stairs' ? '' : 's') : ''} ${up ? 'up' : 'down'}`;
          prev.sub = `${lvl(prev.from)} → ${lvl(to)} · ${prev.count} flights`;
        } else {
          man.push({ kind: 'ramp', at: cum, x: s0.x, z: s0.z, level: leg.level, icon: up ? 'up' : 'down', up, from: leg.level, to, count: 1, word, endCum: cum + rl,
            title: `${word} ${up ? 'up' : 'down'}`, sub: `${lvl(leg.level)} → ${lvl(to)}` });
        }
        cum += rl; time += rl / 0.85; ramps++;
        // the walk that follows starts at the upper end: its turn is relative to the ride direction
      }
      lastWalkEnd = cum;
    }

    // ---- arrival --------------------------------------------------------------
    const lastLeg = legs[legs.length - 1];
    let side = '';
    if (prevDir && d.nx != null) {
      const sx = -d.nx, sz = -d.nz;                               // direction into the shop
      const cross = prevDir[0] * sz - prevDir[1] * sx, dot = prevDir[0] * sx + prevDir[1] * sz;
      side = Math.abs(dot) > 0.8 ? 'straight ahead' : cross < 0 ? 'on your left' : 'on your right';
    }
    const lp = lastLeg.pts[lastLeg.pts.length - 1];
    man.push({ kind: 'arrive', at: cum, x: lp[0], z: lp[1], level: lastLeg.level, icon: 'flag', title: `Arrive at ${d.en}`, sub: side ? `${side} · ${lvl(d.level)}` : lvl(d.level) });

    // merge maneuvers closer than 6 m (keep the first), keep order by distance
    man.sort((a, b) => a.at - b.at);
    const steps = [];
    for (const m of man) {
      const p = steps[steps.length - 1];
      if (p && m.at - p.at < 6 && m.kind !== 'ramp' && m.kind !== 'arrive' && p.kind !== 'ramp') continue;
      steps.push(m);
    }
    // legs-from-here lookahead point (for the live heading arrow)
    const ahead = this._pointAt(pts, 14);
    const total = cum;
    return { ok: true, total, eta: time, steps, pts, marks, ramps, ahead, legs, from: lastWalkEnd, startLevel: body.level };
  }

  _pointAt(pts, m) {
    for (let i = 1; i < pts.length; i++) if (pts[i][3] >= m) {
      const a = pts[i - 1], b = pts[i], t = (m - a[3]) / Math.max(0.001, b[3] - a[3]);
      return { x: a[0] + (b[0] - a[0]) * t, z: a[2] + (b[2] - a[2]) * t };
    }
    const l = pts[pts.length - 1]; return { x: l[0], z: l[2] };
  }
}

// default destination: the quest — Tempura Daikichi
export function destinationFromSlot(slot = 'parks_6Fdw03') {
  const b = businessBySlot[slot];
  if (!b) return null;
  return { id: slot, slot, en: b.en, ja: b.ja, level: b.level, x: b.door.ox, z: b.door.oz, nx: b.door.nx, nz: b.door.nz, doorX: b.door.x, doorZ: b.door.z, rating: b.rating, cat: b.cat };
}
