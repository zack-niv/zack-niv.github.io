// Footstep surface classification. Derived from the space's `style` (or an
// explicit `space.surface` if a builder sets one) and from ramp kind.
// Surfaces: 'tile' | 'stone' | 'wood' | 'metal' | 'paving' | 'grass'
// (+ 'carpet' reserved). Audio maps these to footstep banks.
export const SURFACES = ['tile', 'stone', 'wood', 'metal', 'paving', 'grass', 'carpet'];

const BY_STYLE = {
  default: 'tile',
  metro_platform: 'stone', metro_concourse: 'tile', passage: 'tile',
  arcade: 'tile', arcade_court: 'stone',
  depachika: 'stone', department: 'stone',
  city_plaza: 'stone', city_mall: 'tile', city_court: 'stone',
  dining_street: 'wood', restaurant: 'wood', shop: 'tile',
  sidewalk: 'paving', plaza: 'paving',
  terminal_hall: 'stone', terminal_concourse: 'stone', terminal_platform: 'paving',
  parks_indoor: 'stone', parks_dining: 'wood', parks_skywalk: 'wood',
  canyon: 'paving', canyon_stage: 'wood', canyon_bridge: 'metal',
  garden: 'grass', garden_deck: 'wood',
};

export function surfaceOf(space, ramp) {
  if (ramp) {
    if (ramp.surface) return ramp.surface;
    return ramp.kind === 'escalator' ? 'metal' : ramp.kind === 'stairs' ? 'stone' : 'paving';
  }
  if (!space) return 'tile';
  if (space.surface) return space.surface;
  if (space.garden) return 'grass';
  const s = BY_STYLE[space.style];
  if (s) return s;
  // heuristics for styles added later by other areas
  const st = String(space.style || '');
  if (/wood|deck|tatami|izakaya|restaurant|dining/.test(st)) return 'wood';
  if (/garden|lawn|grass|park/.test(st) && space.outdoor) return 'grass';
  if (/metal|grate|bridge/.test(st)) return 'metal';
  if (space.outdoor) return 'paving';
  if (/stone|marble|hall|lobby|court/.test(st)) return 'stone';
  return 'tile';
}
