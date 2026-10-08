// =============================================================================
// Audio zones: where the player is, in terms of what they should hear.
//
// speechSynthesis cannot be spatialised, so everything spoken (and the train
// sounds that belong to a platform) is gated by *area* instead: how audible a
// platform is from where the listener stands.
//
//   platformGain(platformSpace, L)   1 on the platform, ~0.2 on the concourse
//                                    directly above (inside its footprint),
//                                    0 elsewhere. Nankai's platforms sit in an
//                                    open shed, so they fall off with distance
//                                    on the same level instead.
//   platformLeak(L)                  strongest platform bleed you are NOT on
//                                    (drives the faint tunnel rumble upstairs)
//   AREA[mood]                       soundscape label per ambience mood
// =============================================================================
import { LAYOUT, LEVELS } from '../world/layout.js?v=5f764cf';

const PLATFORMS = LAYOUT.spaces.filter(s => s.kind === 'platform' && s.rect);
const PLAT_BY_ID = Object.fromEntries(PLATFORMS.map(p => [p.id, p]));

export const AREA = {
  platform: 'platform', nkplatform: 'platform', metro: 'gate hall', terminal: 'gate hall', passage: 'underground passage',
  arcade: 'NAMBAWALK', department: 'Takashimaya', street: 'street', mall: 'Namba CITY', parks: 'Namba Parks', canyon: 'Parks canyon',
  garden: 'Parks garden', shop: 'shop', dining: 'dining',
};

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const lerp = (a, b, t) => a + (b - a) * clamp01(t);

// listener L: { x, y (feet), z }; sp: a platform space
export function platformGain(sp, L) {
  if (!sp || !sp.rect) return 0;
  const [x0, z0, x1, z1] = sp.rect;
  const dx = Math.max(x0 - L.x, 0, L.x - x1), dz = Math.max(z0 - L.z, 0, L.z - z1);
  const d = Math.hypot(dx, dz);
  const dy = L.y - LEVELS[sp.level].y;          // + above the platform floor
  const a = Math.abs(dy);
  const open = sp.zone === 'nankai';            // open shed: the whole terminal level hears it, fading with distance
  const h = open ? Math.pow(clamp01(1 - d / 30), 1.6) : clamp01(1 - d / 6);
  let v;
  if (a <= 2.5) v = 1;
  else if (dy > 0) v = a < 5.5 ? lerp(1, 0.2, (a - 2.5) / 3) : a < 10 ? 0.2 : 0.2 * clamp01(1 - (a - 10) / 3);   // the concourse above
  else v = a < 5.5 ? lerp(1, 0.1, (a - 2.5) / 3) : a < 10 ? 0.1 : 0.1 * clamp01(1 - (a - 10) / 3);              // below
  return h * v;
}
export function platformGainById(id, L) { return platformGain(PLAT_BY_ID[id], L); }

// the strongest bleed from a platform the listener is not standing on
export function platformLeak(L, exceptId = null) {
  let best = 0, bestId = null;
  for (const p of PLATFORMS) {
    if (p.id === exceptId) continue;
    const g = platformGain(p, L);
    if (g > best) { best = g; bestId = p.id; }
  }
  return { gain: best, id: bestId };
}

// best platform for an event payload ({track|platform|line, trackNo, level, x, z})
export function platformOf(e, tracks = LAYOUT.tracks) {
  if (!e) return null;
  const t = e.track;
  let tr = t && typeof t === 'object' ? t : tracks.find(x => x.id === t);
  if (!tr && e.trackNo != null) tr = tracks.find(x => x.line === e.line && String(x.no) === String(e.trackNo));
  const id = (tr && tr.platform) || e.platform;
  return id && PLAT_BY_ID[id] ? PLAT_BY_ID[id] : null;
}

// how audible a *point* PA / escalator speaker is: distance law, other levels muffled hard
export function pointGain(pos, L, ref = 3, sameLevelOnly = false) {
  if (!pos) return 1;
  const py = pos.y != null ? pos.y : L.y;
  const dy = Math.abs(py - L.y);
  if (dy > 4) { if (sameLevelOnly || dy > 8) return 0; }
  const d = Math.hypot(pos.x - L.x, pos.z - L.z, dy > 4 ? dy : 0);
  const g = Math.min(1, ref / Math.max(0.5, d));
  return dy > 4 ? g * 0.3 : g;
}
