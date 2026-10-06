// =============================================================================
// Architectural styles. Each layout space has `style`; this table says how its
// floor, walls, ceiling system, columns and details are built.
//   floor/wall/ceil/light  base materials (legacy fields, used by others too)
//   mood       light colour temperature key (kit.KELVIN)
//   border     floor border band along walls (material, width m)
//   skirt      skirting material + height
//   dado       lower wall cladding { mat, h }
//   band       horizontal accent band { mat | 'line', y, h } ('line' = zone colour)
//   upper      upper wall cladding above y { mat, y }
//   ceilSys    ceiling system program (arch/ceilings.js)
//   col        column type (arch/columns.js) or null
//   fascia     bulkhead material over shop openings (sign band)
// =============================================================================
export const LINE_BAND = { midosuji: 'band_midosuji', sennichimae: 'band_sennichimae', nankai: 'band_nankai', nambawalk: 'band_walk', city: 'band_city', parks: 'band_parks', link: 'band_grey', takashimaya: 'band_grey' };

const S = (o) => Object.assign({ floor: 'floor_tile_grey', wall: 'wall_panel_white', ceil: 'ceiling_plaster', light: 'light_panel', mood: 'passage', border: null, skirt: ['steel_dark', 0.1], dado: null, band: null, upper: null, ceilSys: 'flat', col: null, fascia: 'wall_panel_white' }, o);

export const STYLE = {
  default:            S({ ceil: 'ceiling_grid', ceilSys: 'grid' }),
  metro_platform:     S({ floor: 'floor_platform', wall: 'wall_tile_metro', ceil: 'ceiling_metal', light: 'light_cool', mood: 'metro', dado: { mat: 'wall_tile_dado', h: 1.0 }, band: { mat: 'line', y: 2.3, h: 0.16 }, ceilSys: 'platform', col: 'metro', skirt: ['rubber_dark', 0.1] }),
  metro_concourse:    S({ floor: 'floor_metro', wall: 'wall_tile_metro', ceil: 'ceiling_linear', light: 'light_cool', mood: 'metro', border: ['inlay_granite', 0.3], dado: { mat: 'wall_tile_dado', h: 1.0 }, band: { mat: 'line', y: 2.25, h: 0.14 }, ceilSys: 'metro', col: 'metro', skirt: ['rubber_dark', 0.1] }),
  arcade:             S({ floor: 'floor_porcelain', wall: 'wall_panel_white', ceil: 'ceiling_plaster', light: 'light_panel', mood: 'arcade', border: ['inlay_granite', 0.45], ceilSys: 'arcade', skirt: ['steel', 0.08], band: { mat: 'line', y: 2.65, h: 0.06 } }),
  arcade_court:       S({ floor: 'floor_terrazzo', wall: 'wall_stone_warm', ceil: 'ceiling_plaster', light: 'light_warm', mood: 'mall', border: ['inlay_granite', 0.45], ceilSys: 'court', col: 'stone', skirt: ['floor_granite', 0.12], fascia: 'wall_stone_warm' }),
  depachika:          S({ floor: 'floor_tile_warm', wall: 'wall_panel_white', ceil: 'ceiling_plaster', light: 'light_warm', mood: 'depachika', ceilSys: 'downlights', col: 'white', skirt: ['steel', 0.08] }),
  passage:            S({ floor: 'floor_tile_grey', wall: 'wall_tile_white', ceil: 'ceiling_grid', light: 'light_cool', mood: 'passage', dado: { mat: 'wall_tile_dado', h: 0.9 }, band: { mat: 'band_grey', y: 0.9, h: 0.08 }, ceilSys: 'grid', skirt: ['rubber_dark', 0.1] }),
  city_plaza:         S({ floor: 'floor_marble', wall: 'wall_stone_warm', ceil: 'ceiling_plaster', light: 'light_warm', mood: 'mall', border: ['inlay_granite', 0.4], ceilSys: 'downlights', col: 'stone', skirt: ['floor_granite', 0.12], fascia: 'wall_stone_warm' }),
  city_mall:          S({ floor: 'floor_porcelain', wall: 'wall_panel_white', ceil: 'ceiling_plaster', light: 'light_panel', mood: 'mall', border: ['inlay_granite', 0.35], ceilSys: 'mall', col: 'stone', skirt: ['steel', 0.08] }),
  city_court:         S({ floor: 'floor_marble', wall: 'wall_stone_warm', ceil: 'ceiling_plaster', light: 'light_warm', mood: 'mall', border: ['inlay_granite', 0.4], ceilSys: 'court', col: 'stone', skirt: ['floor_granite', 0.12], fascia: 'wall_stone_warm' }),
  dining_street:      S({ floor: 'floor_stone_dark', wall: 'wall_dark', ceil: 'ceiling_dark', light: 'light_warm', mood: 'dining', ceilSys: 'dining', skirt: ['steel_dark', 0.1], fascia: 'wall_dark' }),
  shop:               S({ floor: 'floor_tile_warm', wall: 'wall_panel_white', ceil: 'ceiling_plaster', light: 'light_panel', mood: 'mall', ceilSys: 'room' }),
  restaurant:         S({ floor: 'floor_wood', wall: 'wall_stone_warm', ceil: 'ceiling_dark', light: 'light_warm', mood: 'dining', ceilSys: 'room' }),
  sidewalk:           S({ floor: 'floor_paving', wall: 'wall_concrete', ceil: null, light: null, ceilSys: null, skirt: null }),
  plaza:              S({ floor: 'floor_paving', wall: 'wall_concrete', ceil: null, light: null, ceilSys: null, skirt: null }),
  department:         S({ floor: 'floor_marble', wall: 'wall_panel_white', ceil: 'ceiling_plaster', light: 'light_warm', mood: 'mall', ceilSys: 'downlights', col: 'white', skirt: ['steel', 0.08] }),
  terminal_hall:      S({ floor: 'floor_terrazzo', wall: 'wall_stone_warm', ceil: 'ceiling_plaster', light: 'light_panel', mood: 'terminal', border: ['inlay_granite', 0.5], upper: { mat: 'wall_panel_white', y: 3.6 }, band: { mat: 'line', y: 3.5, h: 0.1 }, ceilSys: 'coffer', col: 'terminal', skirt: ['floor_granite', 0.15], fascia: 'wall_stone_warm' }),
  terminal_concourse: S({ floor: 'floor_terrazzo', wall: 'wall_panel_white', ceil: 'ceiling_perforated', light: 'light_panel', mood: 'terminal', border: ['inlay_granite', 0.5], dado: { mat: 'wall_stone_warm', h: 3.0 }, band: { mat: 'line', y: 3.0, h: 0.12 }, ceilSys: 'coffer', col: 'terminal', skirt: ['floor_granite', 0.15] }),
  terminal_platform:  S({ floor: 'floor_platform', wall: 'wall_concrete', ceil: 'ceiling_metal', light: 'light_panel', mood: 'terminal', ceilSys: null, skirt: ['rubber_dark', 0.1] }),
  parks_indoor:       S({ floor: 'floor_porcelain_warm', wall: 'wall_strata', ceil: 'ceiling_wood', light: 'light_warm', mood: 'parks', border: ['inlay_terrazzo_dark', 0.3], ceilSys: 'parks', skirt: ['floor_granite', 0.1], fascia: 'wall_wood' }),
  parks_dining:       S({ floor: 'floor_wood', wall: 'wall_strata', ceil: 'ceiling_wood', light: 'light_warm', mood: 'dining', ceilSys: 'parks', skirt: ['floor_granite', 0.1], fascia: 'wall_wood' }),
  parks_skywalk:      S({ floor: 'floor_deck', wall: 'glass', ceil: 'ceiling_wood', light: 'light_warm', mood: 'parks', ceilSys: 'parks', skirt: null }),
  canyon:             S({ floor: 'floor_paving_warm', wall: 'wall_strata', ceil: null, light: null, ceilSys: null, skirt: null }),
  canyon_stage:       S({ floor: 'floor_deck', wall: 'wall_strata', ceil: null, light: null, ceilSys: null, skirt: null }),
  canyon_bridge:      S({ floor: 'floor_deck', wall: 'wall_strata', ceil: null, light: null, ceilSys: null, skirt: null }),
  garden:             S({ floor: 'floor_paving_warm', wall: 'wall_strata', ceil: null, light: null, ceilSys: null, skirt: null }),
  garden_deck:        S({ floor: 'floor_deck', wall: 'wall_strata', ceil: null, light: null, ceilSys: null, skirt: null }),
};
export function styleOf(space) { return STYLE[space && space.style] || STYLE.default; }
export function bandMat(style, space) {
  if (!style.band) return null;
  return style.band.mat === 'line' ? (LINE_BAND[space && space.zone] || 'band_grey') : style.band.mat;
}
// shop opening head height (relative to floor) for the bulkhead / sign band
export function doorHead(corridorCeil) { return Math.max(2.45, Math.min(3.2, corridorCeil - 0.55)); }
