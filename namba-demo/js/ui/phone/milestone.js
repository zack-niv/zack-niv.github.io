// =============================================================================
// v5 — "the next thing to expect" (Zack: the compass should work alongside the
// next milestone — an escalator, stairs, a lift, a passage…).
//
//   milestoneOf(step, dest, pos)   a Lodestone guidance step → the public
//                                  milestone { kind, dir, toLevel, dist, name, side, level, x, z }
//   milestoneText(m)               plain words for it: { title, long, sub, icon }
//                                  (far: "Escalator down to 1F"; under 30 m it takes
//                                  over: "Escalator down — on your left")
//   PassCue                        on long legs (> 60 m) the shop you will walk past
//                                  next, from the directory ("Straight past Sneaker Lab")
// The heading arrow itself is the Tracker's (track.js); this only says WHAT comes.
// Pure logic, no DOM. Contract: notes/v5-nav.md.
// =============================================================================
import { LEVELS } from '../../world/layout.js';
import { businessBySlot } from '../../world/directory.js';

const lvl = (l) => (LEVELS[l] ? LEVELS[l].label : String(l || '')).replace('B1F', 'B1').replace('B2F', 'B2');
export const NEAR_M = 30;            // under this the milestone takes over (with the side it is on)
export const LONG_M = 60;            // a leg longer than this gets a "past <shop>" cue

// relative bearing (deg, + = to the right) from the heading to a point
export function relBearing(pos, x, z) {
  const dx = x - pos.x, dz = z - pos.z;
  let d = Math.atan2(-dx, -dz) - pos.heading;          // yaw convention: 0 = north (-Z), + turns left
  return -Math.atan2(Math.sin(d), Math.cos(d)) * 180 / Math.PI;
}

export function milestoneOf(s, dest, pos, prevSide) {
  if (!s) return null;
  const dist = Math.max(0, Math.round(isFinite(s.at) ? s.at : 0));
  const m = { kind: 'turn', dir: null, toLevel: null, dist, level: s.level, x: s.x, z: s.z, icon: s.icon || 'straight' };
  if (s.kind === 'ramp') {
    m.kind = s.word === 'Stairs' ? 'stairs' : s.word === 'Lift' ? 'lift' : 'escalator';
    m.dir = s.up ? 'up' : 'down'; m.toLevel = s.to; m.count = s.count || 1;
  } else if (s.kind === 'arrive') {
    m.kind = 'arrive'; m.toLevel = dest ? dest.level : s.level; m.name = dest ? dest.en || dest.name : undefined;
    const sd = (String(s.sub || '').split(' · ')[0] || '');
    m.doorSide = /left/.test(sd) ? 'left' : /right/.test(sd) ? 'right' : 'ahead';
  } else if (s.kind === 'via') {
    m.kind = 'passage'; m.name = s.name; m.via = s.via; m.long = s.long; m.short = s.short;
  } else if (/^Turn/.test(s.title || '')) {
    m.kind = 'turn'; m.turn = /around/.test(s.title) ? 'around' : /left/.test(s.title) ? 'left' : 'right';
    m.into = /^(into|across)/.test(s.sub || '') ? String(s.sub).replace(/\s+(B\d|\d+F)$/, '') : '';
  } else {
    m.kind = /gate/i.test(s.title || '') ? 'gate' : 'passage';
    m.name = String(s.sub || '').replace(/^to /, '').replace(/\s+(B\d|\d+F)$/, '');
    m.title = s.title;
  }
  // where it is relative to where you face (with a little hysteresis: no left/ahead flicker)
  if (pos && isFinite(m.x) && isFinite(m.z)) {
    const a = relBearing(pos, m.x, m.z), A = Math.abs(a), k = prevSide;
    m.bearing = Math.round(a);
    m.side = A > (k === 'behind' ? 115 : 125) ? 'behind' : A < (k === 'ahead' ? 32 : 24) ? 'ahead' : a > 0 ? 'right' : 'left';
  } else m.side = null;
  return m;
}

const SIDE = { ahead: 'straight ahead', left: 'on your left', right: 'on your right', behind: 'behind you' };

// words for a milestone. near: under NEAR_M (the milestone takes over and says where it is)
export function milestoneText(m) {
  if (!m) return null;
  const near = m.dist < NEAR_M;
  const side = SIDE[m.side] || '';
  if (m.kind === 'escalator' || m.kind === 'stairs' || m.kind === 'lift') {
    const W = m.kind === 'stairs' ? 'Stairs' : m.kind === 'lift' ? 'Lift' : m.count > 1 ? 'Escalators' : 'Escalator';
    const w = m.kind === 'stairs' ? 'the stairs' : m.kind === 'lift' ? 'the lift' : m.count > 1 ? 'the escalators' : 'the escalator';
    return near && side
      ? { icon: m.dir === 'up' ? 'up' : 'down', title: `${W} ${m.dir} — ${side}`, long: `${W} ${m.dir} — ${side}`, sub: `to ${lvl(m.toLevel)}` }
      : { icon: m.dir === 'up' ? 'up' : 'down', title: `${W} ${m.dir} to ${lvl(m.toLevel)}`, long: `Take ${w} ${m.dir} to ${lvl(m.toLevel)}` };
  }
  if (m.kind === 'arrive') {
    const n = m.name || 'Your destination', short = n.replace(/^Tempura /, '');
    const ds = SIDE[m.doorSide] || 'ahead';
    return near ? { icon: 'flag', title: `${short} — ${ds}`, long: `${n} is ${ds}` } : { icon: 'flag', title: n, long: `${n} · ${lvl(m.toLevel)}`, sub: lvl(m.toLevel) };
  }
  if (m.kind === 'turn') {
    const T = m.turn === 'around' ? 'Turn around' : `Turn ${m.turn}`;
    return { icon: m.turn === 'around' ? 'uleft' : m.turn, title: T, long: m.into ? `${T} ${m.into}` : T, sub: m.into ? m.into.replace(/^into /, 'into ') : '' };
  }
  if (m.via) return { icon: m.icon, title: m.short || m.name, long: m.long || m.name, sub: '' };
  const t = (m.title || '').replace(/\s+(B\d|\d+F)$/, '');
  if (/^Cross the bridge/.test(t)) return { icon: 'straight', title: 'Cross the bridge', long: `Cross the bridge${m.name ? ' to ' + m.name : ''}`, sub: m.name || '' };
  return { icon: 'straight', title: t.replace(/^Continue into /, 'Into '), long: t, sub: '' };
}

// ---- "Straight past <shop>": the next storefront the route walks by ----------------------------
let _byLevel = null;
function bizByLevel() {
  if (_byLevel) return _byLevel;
  _byLevel = {};
  for (const id in businessBySlot) {
    const b = businessBySlot[id]; if (!b || !b.door || !b.en || b.cat === 'closed') continue;
    (_byLevel[b.level] = _byLevel[b.level] || []).push({ id, name: b.en, x: b.door.x, z: b.door.z });
  }
  return _byLevel;
}
export class PassCue {
  constructor() { this.cur = null; }
  reset() { this.cur = null; }
  // R: a Lodestone route (pts [x, y, z, cum]); legEnd: metres to the next milestone; body: the player
  pick(R, legEnd, body) {
    if (!R || !R.ok || !(legEnd > LONG_M) || !body || body.ramp >= 0) { this.cur = null; return null; }
    const P = R.pts, y0 = P[0][1], L = bizByLevel()[body.level]; if (!L) { this.cur = null; return null; }
    const hi = Math.min(legEnd - 12, 85), lo = 16;
    let best = null, keep = null;
    for (const s of L) {
      if (Math.abs(s.x - body.x) > hi + 10 || Math.abs(s.z - body.z) > hi + 10) continue;
      let bd = 7, bs = -1;
      for (let i = 1; i < P.length; i++) {
        const a = P[i - 1], b = P[i]; if (a[3] > hi) break; if (Math.abs(a[1] - y0) > 0.5 || Math.abs(b[1] - y0) > 0.5) break;
        const dx = b[0] - a[0], dz = b[2] - a[2], l2 = dx * dx + dz * dz;
        const t = l2 > 1e-6 ? Math.max(0, Math.min(1, ((s.x - a[0]) * dx + (s.z - a[2]) * dz) / l2)) : 0;
        const d = Math.hypot(s.x - a[0] - dx * t, s.z - a[2] - dz * t);
        if (d < bd) { bd = d; bs = a[3] + (b[3] - a[3]) * t; }
      }
      if (bs < 0) continue;
      if (this.cur && s.id === this.cur.id && bs > 6) keep = { id: s.id, name: s.name, dist: bs };
      if (bs >= lo && bs <= hi && (!best || bs < best.dist)) best = { id: s.id, name: s.name, dist: bs };
    }
    this.cur = keep || best;
    return this.cur;
  }
}
