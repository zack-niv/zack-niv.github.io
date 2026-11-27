// =============================================================================
// v23 maps — the route as a short list of plain steps (an overview, not turn-by-turn).
//
//   buildSteps(route, world)  ->  [{ i, kind, icon, text, level, to, at:[x,z], ramp?, dir? }]
//
// "Out through Central Gate (3F)  ·  Escalator down to 2F  ·  Through Namba CITY, follow “Namba Parks” signs  ·
//  Parks escalators up to 6F  ·  Tempura Daikichi, east side"
//
// The words are the ones the signs in the world use (places.js SIGN_NAME / areaOf). The whole route is known up front
// (the plan is accurate; only the player's position is vague), so every floor it crosses has a step. Pure data, no DOM.
// =============================================================================
import { LAYOUT, LEVELS } from '../../world/layout.js?v=5442362';
import { areaOf, SIGN_NAME } from './places.js?v=5442362';

const lv = (l) => (LEVELS[l] ? LEVELS[l].label : String(l)).replace('B1F', 'B1').replace('B2F', 'B2');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
// (the signs name the escalators of Parks and Namba CITY; the Nankai ones are just "escalator")
const AREA_PREFIX = { parks: 'Parks', 'parks-bridge': 'Parks', city: 'Namba CITY', walk: 'NAMBAWALK', taka: 'Takashimaya' };

// one leg: the areas it passes through (in order), the gate lines it crosses, its length
function scan(lg, world) {
  const names = [], gates = [];
  let last = null;
  const pts = lg.pts;
  for (let j = 0; j < pts.length; j++) {
    if (!(j % 2) || j === pts.length - 1) {
      const a = areaOf(world.spaceAt(lg.level, pts[j][0], pts[j][1]));
      if (a && a.key !== last) { names.push({ ...a, j }); last = a.key; }
    }
    if (j > 0) {
      const p = pts[j - 1], q = pts[j];
      for (const gt of LAYOUT.gates) {
        if (gt.level !== lg.level) continue;
        const x = gt.axis === 'x' ? [p[1], q[1], p[0], q[0]] : [p[0], q[0], p[1], q[1]];       // [a0, a1, c0, c1]: across / along
        if ((x[0] - gt.at) * (x[1] - gt.at) >= 0) continue;
        const u = (gt.at - x[0]) / (x[1] - x[0]), along = x[2] + (x[3] - x[2]) * u;
        if (along < gt.from - 1 || along > gt.to + 1) continue;
        if (!gates.some(g => g.gt === gt)) gates.push({ gt, j, at: gt.axis === 'x' ? [along, gt.at] : [gt.at, along] });
      }
    }
  }
  return { names, gates };
}

// which part of its floor a place is in ("east side", "north end", "middle"): where the ZONE's footprint on that floor says
export function sideOf(t, world) {
  const sp = world.spaceAt(t.level, t.x, t.z); if (!sp) return '';
  let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
  for (const s of LAYOUT.spaces) {
    if (s.level !== t.level || s.zone !== sp.zone || s.kind === 'room' || !s.rect || s.outdoor !== sp.outdoor) continue;
    x0 = Math.min(x0, s.rect[0]); z0 = Math.min(z0, s.rect[1]); x1 = Math.max(x1, s.rect[2]); z1 = Math.max(z1, s.rect[3]);
  }
  if (x1 - x0 < 30 && z1 - z0 < 30) return '';
  const fx = (t.x - x0) / Math.max(1, x1 - x0) - 0.5, fz = (t.z - z0) / Math.max(1, z1 - z0) - 0.5;
  const ax = Math.abs(fx) * Math.max(1, x1 - x0), az = Math.abs(fz) * Math.max(1, z1 - z0);
  if (Math.max(ax, az) < 9) return 'middle';
  return ax >= az ? (fx > 0 ? 'east side' : 'west side') : (fz > 0 ? 'south side' : 'north side');
}

export function buildSteps(R, world) {
  const legs = R.legs || [], t = R.target, out = [];
  if (!t) return out;
  const push = (s) => out.push({ i: out.length, ...s });
  let i = 0;
  while (i < legs.length) {
    const lg = legs[i], last = lg.pts[lg.pts.length - 1] || [t.x, t.z];
    const r = lg.ramp >= 0 ? LAYOUT.ramps[lg.ramp] : null;
    // riding already: the leg is just the ramp we are on
    if (lg.onRamp && r) {
      const to = lg.dir > 0 ? r.upper : r.lower;
      push({ kind: 'ramp', icon: lg.dir > 0 ? 'up' : 'down', text: `Stay on the ${r.kind === 'escalator' ? 'escalator' : 'stairs'} to ${lv(to)}`, level: lg.level, to, at: last, ramp: r.kind, dir: lg.dir });
      i++; continue;
    }
    const sc = scan(lg, world);
    for (const g of sc.gates) push({ kind: 'gate', icon: 'gate', text: `Through ${g.gt.name} (${lv(lg.level)})`, level: lg.level, to: lg.level, at: g.at });
    const after = sc.gates.length ? sc.names.filter(n => n.j > sc.gates[sc.gates.length - 1].j) : sc.names;
    const names = after.length ? after : sc.names.slice(-1);
    const first = names[0], lastN = names[names.length - 1], sign = lastN && first && SIGN_NAME[lastN.key] !== SIGN_NAME[first.key] ? SIGN_NAME[lastN.key] || null : null;
    const walkLen = lg.len || 0;
    if (r) {
      // ---- walk to the ramp (a few metres of walking between two floors is not a step) ----
      if (names.length >= 2 || walkLen >= 28) {
        const mids = names.slice(1, -1).filter(n => !sign || SIGN_NAME[n.key] !== sign);
        let text;
        if (mids.length) text = `Through ${mids.map(n => n.name).join(' and ')}${sign ? `, follow “${sign}” signs` : ''}`;
        else if (sign) text = `Follow “${sign}” signs`;
        else if (names.length >= 2) text = `Walk on to ${lastN.name}`;
        else text = null;
        if (text) push({ kind: 'walk', icon: 'walk', text, level: lg.level, to: lg.level, at: last });
      }
      // ---- the ramp(s): a run of short hops in the same direction is one step ("Parks escalators up to 6F") ----
      let n = 1, to = lg.dir > 0 ? r.upper : r.lower, j = i + 1;
      while (j < legs.length && legs[j].ramp >= 0 && (legs[j].len || 0) < 16 && legs[j].dir === lg.dir && LAYOUT.ramps[legs[j].ramp].kind === r.kind) {
        const rr = LAYOUT.ramps[legs[j].ramp]; to = lg.dir > 0 ? rr.upper : rr.lower; n++; j++;
      }
      const ar = areaOf(world.spaceAt(lg.level, last[0], last[1])), pre = ar && AREA_PREFIX[ar.key] ? AREA_PREFIX[ar.key] + ' ' : '';
      const word = r.kind === 'escalator' ? (n > 1 ? 'escalators' : 'escalator') : 'stairs';
      push({ kind: 'ramp', icon: lg.dir > 0 ? 'up' : 'down', text: `${cap(pre + word)} ${lg.dir > 0 ? 'up' : 'down'} to ${lv(to)}`, level: lg.level, to, at: last, ramp: r.kind, dir: lg.dir, n });
      i = j;
    } else {
      // ---- the last leg: a walk if it crosses areas, then the place itself ----
      if (names.length >= 2) {
        const mids = names.slice(1, -1).filter(n => !sign || SIGN_NAME[n.key] !== sign);
        const text = mids.length ? `Through ${mids.map(n => n.name).join(' and ')}${sign ? `, follow “${sign}” signs` : ''}` : sign ? `Follow “${sign}” signs` : `Walk on to ${lastN.name}`;
        push({ kind: 'walk', icon: 'walk', text, level: lg.level, to: lg.level, at: last });
      }
      const side = t.kind === 'biz' || t.kind === 'fac' ? sideOf(t, world) : '';
      push({ kind: 'end', icon: 'pin', text: `${t.en}${side ? `, ${side}` : ''}`, level: lg.level, to: lg.level, at: [t.x, t.z] });
      i++;
    }
  }
  if (!out.length || out[out.length - 1].kind !== 'end') push({ kind: 'end', icon: 'pin', text: t.en, level: t.level, to: t.level, at: [t.x, t.z] });
  return out;
}

// the floors the route touches, in order, without repeats
export function routeFloors(R) {
  const f = [];
  for (const lg of R.legs || []) if (f[f.length - 1] !== lg.level) f.push(lg.level);
  if (R.target && f[f.length - 1] !== R.target.level) f.push(R.target.level);
  return f;
}
