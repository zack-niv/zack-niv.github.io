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
import { LAYOUT, LEVELS, LEVEL_ORDER, ZONES, rampEnds, rampProfile, rampLength } from '../../world/layout.js?v=f150c03';
import { routeLegs, fieldNoEntry } from './routes.js?v=f150c03';
import { businessBySlot } from '../../world/directory.js?v=f150c03';

export const ZONE_SHORT = {
  nankai: 'Nankai Station', city: 'Namba CITY', parks: 'Namba Parks', parksGarden: 'Parks Garden', nambawalk: 'NAMBAWALK',
  takashimaya: 'Takashimaya', link: 'the underground passage', midosuji: 'Midosuji Line', sennichimae: 'Sennichimae Line',
  plaza: 'Namba Plaza', street: 'Sennichimae-dori',
};
const lvl = (l) => LEVELS[l].label.replace('B1F', 'B1').replace('B2F', 'B2');

// v5: the scenic loop up into Namba Parks (see Guidance constructor)
export const VIAS = [
  { id: 'canyon', level: '2F', x: 33, z: 222, icon: 'canyon', mark: 'Canyon', name: 'Namba Parks canyon',
    title: 'Out into the canyon garden', sub: 'The scenic way up · 2F',
    long: 'Through the canyon garden — the scenic way up', short: 'Into the canyon garden' },
  { id: 'bridge3', level: '3F', x: 46, z: 239, icon: 'bridge', mark: 'Bridge', name: 'the glass bridge',
    title: 'Cross the glass bridge', sub: 'Over the canyon · 3F',
    long: 'Cross the glass bridge over the canyon', short: 'Over the glass bridge' },
];

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
  constructor(ctx, dest, via) {
    this.ctx = ctx;
    this.dest = dest;       // { id, en, ja, level, x, z (door outside), nx, nz (door normal), slot, transit? }
    this._viaState = via || { done: false, i: 0 };   // v4: shared by every destination's Guidance (the scenic way is offered once)
    if (this._viaState.i == null) this._viaState.i = 0;
    this.field = null;
    this.goal = -1;
    // v5: the scenic way up into Namba Parks is a LOOP, not an out-and-back (v4 sent you into the canyon and straight
    // back to the indoor escalators). Out into the canyon (2F) → the canyon's own garden stairs up to the 3F terrace →
    // back over the canyon on the 3F glass bridge → Parks 3F → the escalators. Nav probe: +98 m vs the indoor way,
    // with no step walked twice (notes/v5-nav.md).
    this.vias = VIAS.map(v => ({ ...v, node: -1, field: null }));
    this.via = this.vias[0];
    // the scenic way only makes sense on the way up into Namba Parks (4F and above: it lands you on 3F)
    this.viaUseful = !!(dest && dest.zone === 'parks' && LEVELS[dest.level] && LEVELS['3F'] && LEVELS[dest.level].y > LEVELS['3F'].y + 1);
  }
  get viaDone() { return this._viaState.done || !this.viaUseful; }
  set viaDone(v) { if (v) this._viaState.done = true; }

  // Where is the player along the scenic loop (or have they gone up indoors, which makes it pointless)? Cheap O(1):
  // called at 2.5 Hz from Lodestone even while the phone is down. Stages only move forward.
  noteBody(body) {
    const S = this._viaState;
    if (S.done || !body || body.ramp >= 0) return;
    const W = this.ctx.world, sp = W.spaceAt(body.level, body.x, body.z);
    const parks = sp && (sp.zone === 'parks' || sp.zone === 'parksGarden');
    const near = (v) => body.level === v.level && Math.hypot(body.x - v.x, body.z - v.z) < 5;
    const y = LEVELS[body.level] ? LEVELS[body.level].y : 0, y3 = LEVELS['3F'].y;
    if (near(VIAS[1]) || (sp && sp.id === 'parks_bridge_3f')) { S.i = 2; }
    else if (body.level === '2F') { if (near(VIAS[0]) || (sp && (sp.id === 'parks_canyon' || sp.id === 'parks_stage'))) S.i = Math.max(S.i, 1); }
    else if (body.level === '3F' && sp && sp.zone === 'parksGarden') S.i = Math.max(S.i, 1);     // came up the canyon stairs
    else if (parks && y >= y3 - 0.1) S.i = 2;                                                    // up indoors (or higher): no detour
    if (S.i >= VIAS.length) S.done = true;
  }
  _viaField(V = this.via) {
    const nav = this.ctx.nav;
    if (V.field) return V.field;
    V.node = nav.nodeAtPoint(V.level, V.x, V.z);
    if (V.node < 0) return null;
    return (V.field = fieldNoEntry(nav, 'lodestone:via:' + V.id, [V.node]));
  }
  // the field the route follows right now (the next via-point's, or the destination's) — for test bots
  leadField(body) {
    if (body) this.noteBody(body);
    if (!this.viaDone) { const V = this.vias[this._viaState.i]; const f = V && this._viaField(V); if (f) return f; }
    return this.prepare();
  }

  // Heavy part (a few hundred ms): the cost field to the destination.
  prepare() {
    if (this.field) return this.field;
    const nav = this.ctx.nav, d = this.dest;
    this.goal = nav.nodeAtPoint(d.level, d.x, d.z);
    // (a station / platform destination may route through the fare gates; anything else never does)
    this.field = d.transit ? nav.field('lodestone:t:' + d.id, [this.goal]) : fieldNoEntry(nav, 'lodestone:' + d.id, [this.goal]);
    return this.field;
  }

  // v6 (stats): metres of the route being FOLLOWED still to go — through the remaining scenic waypoints when
  // `scenic` and the loop is still pending (Aya's canyon way), else the plain shortest path. Infinity when unknown.
  remainingRoute(body, scenic) {
    const f = this.prepare(), nav = this.ctx.nav;
    const v = nav.nodeAt(body); if (v < 0) return Infinity;
    if (!scenic || this.viaDone) return f.dist[v];
    let from = v, sum = 0;
    for (const V of this.vias.slice(this._viaState.i)) {
      const fv = this._viaField(V); if (!fv || V.node < 0) return f.dist[v];
      sum += fv.dist[from]; from = V.node;
    }
    sum += f.dist[from];
    return isFinite(sum) ? sum : f.dist[v];
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
    this.noteBody(body);
    let legs = null, viaOn = false;
    if (!this.viaDone) {
      // chain: here → each remaining via-point → the destination (every hop the shortest path; a hop that is
      // unreachable drops the scenic way for this route)
      const chain = this.vias.slice(this._viaState.i);
      let from = v, out = [], ok = chain.length > 0;
      for (const V of chain) {
        const fv = this._viaField(V);
        if (!fv || !isFinite(fv.dist[from]) || !isFinite(f.dist[V.node])) { ok = false; break; }
        const l = routeLegs(nav, fv, from);
        if (!l.length || l[l.length - 1].ramp >= 0) { ok = false; break; }
        l[l.length - 1].via = V;
        if (out.length && l[0].pts.length > 2 && out[out.length - 1].level === l[0].level) l[0].pts.shift();
        out = out.concat(l); from = V.node;
      }
      if (ok) {
        const l2 = routeLegs(nav, f, from);
        if (l2.length) {
          if (l2[0].pts.length > 2 && out[out.length - 1].level === l2[0].level) l2[0].pts.shift();
          legs = out.concat(l2); viaOn = true;
        }
      }
    }
    if (!legs) legs = routeLegs(nav, f, v);
    legs = legs.filter(l => l.pts.length || l.ramp >= 0);
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
      const idx = lp.length ? dpIdx(lp, 2.6) : [];
      // cumulative metres along the leg's points
      const cl = new Float32Array(lp.length);
      for (let i = 1; i < lp.length; i++) cl[i] = cl[i - 1] + Math.hypot(lp[i][0] - lp[i - 1][0], lp[i][1] - lp[i - 1][1]);
      const base = cum;
      // 3D polyline (denser than the guidance waypoints, much sparser than the nodes)
      const di = dpIdx(lp, 0.9);
      for (const i of di) { if (li === 0 && i === 0) continue; if (!isFinite(lp[i][0] + lp[i][1])) continue; pts.push([lp[i][0], yOf(leg.level), lp[i][1], base + cl[i]]); }
      const legLen = lp.length ? cl[lp.length - 1] : 0;
      cum = base + legLen;
      time += legLen / 1.5;

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
      // v6 (nav QA): a corner's angle is measured on the raw path over ±7 m around the simplified vertex, not between
      // the simplified segments. The simplification depends on where the path starts (= where you stand), so a ~55°
      // bend flickered in and out as you walked ("Turn right · in 31 m" for one metre on Nankai 3F), and a 90° corner
      // cut into two 45° vertices was never announced. The windowed angle is a property of the corner itself.
      const legLen0 = lp.length ? cl[lp.length - 1] : 0;
      const ptAt = (m) => {
        m = Math.max(0, Math.min(legLen0, m));
        let lo = 0, hi = lp.length - 1;
        while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cl[mid] <= m) lo = mid; else hi = mid; }
        const t = cl[hi] > cl[lo] ? (m - cl[lo]) / (cl[hi] - cl[lo]) : 0;
        return [lp[lo][0] + (lp[hi][0] - lp[lo][0]) * t, lp[lo][1] + (lp[hi][1] - lp[lo][1]) * t];
      };
      const dirOf = (a, b) => { const l = Math.hypot(b[0] - a[0], b[1] - a[1]); return l < 0.5 ? null : [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };
      const angOf = (u, w) => Math.atan2(u[0] * w[1] - u[1] * w[0], u[0] * w[0] + u[1] * w[1]) * 180 / Math.PI;   // + right, − left
      for (let j = 0; j < idx.length - 1; j++) {
        const a = lp[idx[j]], b = lp[idx[j + 1]];
        const dir = dirOf(a, b); if (!dir) continue;
        if (dirIn) {
          let deg = angOf(dirIn, dir);
          const c = cl[idx[j]];
          if (j > 0 && c >= 3 && legLen0 - c >= 3) {
            const V = lp[idx[j]], u = dirOf(ptAt(c - 7), V), w = dirOf(V, ptAt(c + 7));
            if (u && w) deg = angOf(u, w);
          }
          if (Math.abs(deg) >= 55) turns.push({ i: idx[j], deg });
        }
        dirIn = dir;
      }
      // last travel direction of this leg
      if (idx.length >= 2) { const a = lp[idx[idx.length - 2]], b = lp[idx[idx.length - 1]]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; prevDir = [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; }

      const zoneName = (z) => ZONE_SHORT[z] || (ZONES[z] && ZONES[z].name) || 'the next area';
      const mk = (i, o) => man.push({ at: base + (cl[i] || 0), x: lp[i][0], z: lp[i][1], level: leg.level, ...o });
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
        const t0 = Math.min(0.98, Math.max(0, leg.rampStart || 0));      // already on the ramp (riding): only what is left
        const rl = rampLength(r) * (1 - t0);
        // geometry of the climb
        const last = pts[pts.length - 1];
        const n = 7;
        for (let k = 0; k <= n; k++) {
          const t = t0 + (1 - t0) * k / n, x = s0.x + (s1.x - s0.x) * t, z = s0.z + (s1.z - s0.z) * t;
          const sN = up ? t : 1 - t;
          const y = rampProfile(r, sN);
          if (k === 0 && Math.hypot(x - last[0], z - last[2]) < 0.3) { last[1] = y; continue; }
          pts.push([x, y, z, cum + rl * k / n]);
        }
        const rideDir = [(s1.x - s0.x) / (Math.hypot(s1.x - s0.x, s1.z - s0.z) || 1), (s1.z - s0.z) / (Math.hypot(s1.x - s0.x, s1.z - s0.z) || 1)];
        prevDir = rideDir;
        const prev = leg.onRamp ? null : man[man.length - 1];
        // v5 critic: brushing the mouth of a ramp's LAST metre (e.g. the bottom of the Parks 3F DOWN lane, right beside
        // the up lane's foot) made the body "ride" it for a frame or two and the card flashed "Escalator down · 4F → 3F".
        // Nothing to announce there: keep the geometry, skip the maneuver.
        const tail = leg.onRamp && rl < 2.5;
        // chain of escalators with a short connecting walk collapses into one step
        const word = r.kind === 'escalator' ? 'Escalator' : 'Stairs';
        // v6 (item 7): the point a ramp step is judged by. The mouth itself (s0) sits beside / behind you in the last
        // metres of the approach and is BEHIND you the moment you step on ("Escalator up — behind you" for a whole
        // ride). Aim a few metres into the ramp instead; while riding, the step is the ride itself and its point is
        // the landing you are riding to (ex, ez).
        const rlen = Math.hypot(s1.x - s0.x, s1.z - s0.z), aimK = Math.min(3, rlen * 0.4);
        const ax = s0.x + rideDir[0] * aimK, az = s0.z + rideDir[1] * aimK;
        if (tail) { /* nothing to announce */ }
        else if (prev && prev.kind === 'ramp' && prev.up === up && (base - prev.endCum) < 9) {
          prev.count++; prev.to = to; prev.endCum = cum + rl; prev.ex = s1.x; prev.ez = s1.z; prev.mark.text = `${up ? '▲' : '▼'} ${lvl(to)}`;
          prev.title = `${prev.word}${prev.count > 1 ? (prev.word === 'Stairs' ? '' : 's') : ''} ${up ? 'up' : 'down'}`;
          prev.sub = `${lvl(prev.from)} → ${lvl(to)} · ${prev.count} flights`;
        } else {
          const mark = { x: s0.x, z: s0.z, y: yOf(leg.level), text: `${up ? '▲' : '▼'} ${lvl(to)}`, up, level: leg.level }; marks.push(mark);
          man.push({ kind: 'ramp', mark, at: cum, x: s0.x, z: s0.z, ax, az, ex: s1.x, ez: s1.z, riding: !!leg.onRamp, level: leg.level, icon: up ? 'up' : 'down', up, from: leg.level, to, count: 1, word, endCum: cum + rl,
            title: `${word} ${up ? 'up' : 'down'}`, sub: `${lvl(leg.level)} → ${lvl(to)}` });
        }
        cum += rl; time += rl / 0.85; ramps++;
        // the walk that follows starts at the upper end: its turn is relative to the ride direction
      }
      if (leg.via) {
        // scenic waypoint (canyon floor, then the glass bridge): a landmark step; the walk that follows is not a "turn" relative to it
        const E = lp[lp.length - 1], V = leg.via;
        // the waypoint IS the instruction there: drop a turn / zone entry ("Turn right across the bridge") right at it
        for (let k = man.length - 1; k >= 0; k--) if (man[k].kind !== 'ramp' && man[k].kind !== 'via' && Math.abs(man[k].at - cum) < 14) man.splice(k, 1);
        man.push({ kind: 'via', via: V.id, at: cum, x: E[0], z: E[1], level: leg.level, icon: V.icon, title: V.title, sub: V.sub, long: V.long, short: V.short, name: V.name });
        marks.push({ x: E[0], z: E[1], y: yOf(leg.level), text: V.mark, up: true, level: leg.level, via: true });
        prevDir = null;
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
      if (p && m.at - p.at < 6 && m.kind !== 'ramp' && m.kind !== 'arrive' && m.kind !== 'via' && p.kind !== 'ramp') continue;
      steps.push(m);
    }
    // legs-from-here lookahead point (for the live heading arrow)
    const ahead = this._pointAt(pts, 14);
    const total = cum;
    if (!isFinite(total) || !isFinite(time) || steps.some(m => !isFinite(m.at))) return { ok: false, bad: true };
    return { ok: true, total, eta: time, steps, pts, marks, ramps, ahead, legs, from: lastWalkEnd, startLevel: body.level, via: viaOn };
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
  return { id: slot, slot, slotId: slot, name: b.en, en: b.en, ja: b.ja, level: b.level, x: b.door.ox, z: b.door.oz, nx: b.door.nx, nz: b.door.nz, doorX: b.door.x, doorZ: b.door.z, rating: b.rating, cat: b.cat, zone: b.zone };
}
