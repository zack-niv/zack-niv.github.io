// =============================================================================
// NAMBA — master plan.
//
// The single source of truth for the place. Architecture, collision, crowd
// navigation, signage and the phone map are all derived from this data.
//
// Coordinate system: metres. +X = east, +Z = south, +Y = up. North is -Z.
// All space bounds are INTEGER metres (the walk grid is 1 m). Ramps may have a
// fractional walkWidth but their footprints are integer too.
//
// Rough geography (not exact, but faithful in spirit):
//   north  (z≈-240..-180)  Sennichimae-dori; NAMBAWALK arcade underneath (B1),
//                          Sennichimae subway line (B2, pink).
//   west   (x≈-140..-92)   Midosuji avenue; Midosuji Line (red) under it.
//   centre (x≈-80..40)     Takashimaya (depachika B1) and the Nankai Namba
//                          terminal (1F hall, 2F concourse, 3F platforms).
//   south  (z≈-40..190)    Namba CITY under the elevated tracks (B1/1F/2F).
//   far S  (z≈190..385)    Namba Parks: the canyon, terraced roof gardens,
//                          restaurant floors.
// =============================================================================

export const LEVELS = {
  'B2': { y: -14, name: 'B2', label: 'B2F' },
  'B1': { y: -7, name: 'B1', label: 'B1F' },
  '1F': { y: 0, name: '1F', label: '1F' },
  '2F': { y: 6, name: '2F', label: '2F' },
  '3F': { y: 12, name: '3F', label: '3F' },
  '4F': { y: 18, name: '4F', label: '4F' },
  '5F': { y: 24, name: '5F', label: '5F' },
  '6F': { y: 30, name: '6F', label: '6F' },
  '7F': { y: 36, name: '7F', label: '7F' },
  '8F': { y: 42, name: '8F', label: '8F' },
};
export const LEVEL_ORDER = ['B2', 'B1', '1F', '2F', '3F', '4F', '5F', '6F', '7F', '8F'];

// Zones: named districts. Used for ambience, lighting moods, signage language,
// map colouring and crowd behaviour. Every space belongs to a zone.
export const ZONES = {
  midosuji:   { name: 'Osaka Metro Midosuji Line', ja: '御堂筋線 なんば駅', mood: 'metro', color: '#e5171f' },
  sennichimae:{ name: 'Osaka Metro Sennichimae Line', ja: '千日前線 なんば駅', mood: 'metro', color: '#e44d93' },
  nambawalk:  { name: 'NAMBAWALK', ja: 'なんばウォーク', mood: 'arcade', color: '#d9a400' },
  takashimaya:{ name: 'Takashimaya Osaka', ja: '高島屋 大阪店', mood: 'department', color: '#6b8f3a' },
  plaza:      { name: 'Namba Plaza', ja: 'なんば広場', mood: 'street', color: '#7a7a7a' },
  street:     { name: 'Sennichimae-dori', ja: '千日前通', mood: 'street', color: '#7a7a7a' },
  nankai:     { name: 'Nankai Namba Station', ja: '南海なんば駅', mood: 'terminal', color: '#f08300' },
  link:       { name: 'Namba underground passage', ja: 'なんば地下街', mood: 'passage', color: '#8a8f99' },
  city:       { name: 'Namba CITY', ja: 'なんばCITY', mood: 'mall', color: '#2a7fc1' },
  parks:      { name: 'Namba Parks', ja: 'なんばパークス', mood: 'parks', color: '#4f9a4a' },
  parksGarden:{ name: 'Parks Garden', ja: 'パークスガーデン', mood: 'garden', color: '#3f8f3a' },
};

// -----------------------------------------------------------------------------
// Space kinds
//   'hall'     open walkable area; merges seamlessly with other non-room spaces
//   'room'     enclosed (shop, restaurant, office). Walls on every edge except
//              explicit doors. Shops are rooms.
//   'platform' railway platform (walkable, edge = track pit with platform doors)
// Flags
//   outdoor    no ceiling, sky lighting
//   ceil       ceiling height above floor (m)
//   style      material/architecture style key for the builder
// -----------------------------------------------------------------------------

const spaces = [];
const ramps = [];
const voids = [];
const gates = [];
const tracks = [];
const shopSlots = [];
const pois = [];
const spawns = {};
const exits = [];
const cores = [];   // solid structural blocks carved out of halls (station rooms, shafts)
const tactile = []; // tactile paving guide routes { level, pts: [[x,z],...], stops: [[x,z],...] }

let _sid = 0;
function space(o) {
  const s = Object.assign({ kind: 'hall', ceil: 3.6, style: 'default', doors: [] }, o);
  if (!s.id) s.id = `s${_sid++}`;
  // normalise bounds
  if (s.rect) {
    const [x0, z0, x1, z1] = s.rect;
    s.rect = [Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1)];
  }
  spaces.push(s);
  return s;
}

// A ramp is an escalator lane, a staircase or a sloped walk connecting two
// levels. Footprint rect [x0,z0,x1,z1]; axis 'x' or 'z'; `up` is the direction
// of ascent along the axis (+1 or -1). `move`: +1 escalator going up, -1
// going down, 0 static. walkWidth: the usable width (centred in footprint).
function ramp(o) {
  const r = Object.assign({ kind: 'stairs', move: 0 }, o);
  const [x0, z0, x1, z1] = r.rect;
  r.rect = [Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1)];
  const w = r.axis === 'x' ? r.rect[3] - r.rect[1] : r.rect[2] - r.rect[0];
  if (r.walkWidth == null) r.walkWidth = r.kind === 'escalator' ? 1.0 : w - 0.3;
  r.id = r.id || `r${ramps.length}`;
  ramps.push(r);
  return r;
}

// An escalator bank: lanes side by side, plus optional stairs. `lanes` is an
// array of 'up' | 'down' | 'stairs' from the low-coordinate side. Each
// escalator lane is 2 m of footprint (1 m steps + balustrades); stairs lanes
// use stairsWidth.
function escalatorBank({ id, level0, level1, axis, up, at, from, length, lanes, zone, stairsWidth = 3 }) {
  // at: coordinate on the cross axis where the bank starts (low side)
  // from: coordinate along the axis of the LOW end; the bank runs `length`
  //       metres in direction `up`.
  let c = at;
  const out = [];
  lanes.forEach((ln, i) => {
    const w = ln === 'stairs' ? stairsWidth : 2;
    const a0 = from, a1 = from + up * length;
    const rect = axis === 'z' ? [c, a0, c + w, a1] : [a0, c, a1, c + w];
    out.push(ramp({
      id: `${id}_${i}`, bank: id, zone, lower: level0, upper: level1, axis, up, rect,
      kind: ln === 'stairs' ? 'stairs' : 'escalator',
      move: ln === 'up' ? 1 : ln === 'down' ? -1 : 0,
    }));
    c += w;
  });
  return out;
}

// A row of shop rooms along a corridor. rowRect is the strip that gets
// subdivided; frontSide is which side of the strip faces the corridor
// ('n','s','e','w'). widths: array of shop widths along the strip.
function shopRow({ level, zone, rowRect, frontSide, widths, style = 'shop', ceil = 3.4, prefix, gaps = [] }) {
  const [x0, z0, x1, z1] = rowRect;
  const alongX = frontSide === 'n' || frontSide === 's';
  let p = alongX ? x0 : z0;
  const end = alongX ? x1 : z1;
  const out = [];
  let i = 0;
  let wi = 0;
  while (p < end - 1) {
    // skip over gaps (cross aisles, atria) — shops never straddle them
    const g = gaps.find(([a, b]) => p >= a && p < b);
    if (g) { p = g[1]; continue; }
    let w = widths[wi++ % widths.length];
    if (p + w > end) w = end - p;
    const ng = gaps.find(([a]) => a > p && a < p + w);
    if (ng) w = ng[0] - p;
    if (w < 3) { p += w; continue; }
    const rect = alongX ? [p, z0, p + w, z1] : [x0, p, x1, p + w];
    // front door: whole frontage minus 0.5 m pilasters is open (walls stay
    // at the grid's 1 m resolution, so leave 1 m pilaster on wider shops)
    const pil = w >= 6 ? 1 : 0;
    let door;
    if (frontSide === 'n') door = [rect[0] + pil, rect[1], rect[2] - pil, rect[1]];
    if (frontSide === 's') door = [rect[0] + pil, rect[3], rect[2] - pil, rect[3]];
    if (frontSide === 'w') door = [rect[0], rect[1] + pil, rect[0], rect[3] - pil];
    if (frontSide === 'e') door = [rect[2], rect[1] + pil, rect[2], rect[3] - pil];
    const id = `${prefix}${String(i + 1).padStart(2, '0')}`;
    const s = space({ id, level, zone, kind: 'room', rect, style, ceil, doors: [door], front: frontSide, shop: true });
    shopSlots.push({ id, level, zone, rect, front: frontSide, door, width: w, depth: alongX ? z1 - z0 : x1 - x0 });
    out.push(s);
    p += w;
    i++;
  }
  return out;
}

// =============================================================================
// B2 — subway platforms
// =============================================================================

// Midosuji Line island platform (red). Track 1 west, track 2 east.
space({ id: 'm_platform', level: 'B2', zone: 'midosuji', kind: 'platform', rect: [-122, -200, -110, -60], ceil: 4.2, style: 'metro_platform' });
tracks.push({ id: 'm_track1', level: 'B2', line: 'midosuji', rect: [-128, -206, -122, -54], axis: 'z', platform: 'm_platform', side: 'w',
  no: 1, dirEn: 'for Tennoji / Nakamozu', dirJa: '天王寺・なかもず方面', heading: +1 });
tracks.push({ id: 'm_track2', level: 'B2', line: 'midosuji', rect: [-110, -206, -104, -54], axis: 'z', platform: 'm_platform', side: 'e',
  no: 2, dirEn: 'for Umeda / Shin-Osaka', dirJa: '梅田・新大阪方面', heading: -1 });

// Sennichimae Line island platform (pink), running east-west.
space({ id: 's_platform', level: 'B2', zone: 'sennichimae', kind: 'platform', rect: [20, -200, 140, -188], ceil: 4.0, style: 'metro_platform' });
tracks.push({ id: 's_track1', level: 'B2', line: 'sennichimae', rect: [14, -206, 146, -200], axis: 'x', platform: 's_platform', side: 'n',
  no: 1, dirEn: 'for Nippombashi / Tsuruhashi', dirJa: '日本橋・鶴橋方面', heading: +1 });
tracks.push({ id: 's_track2', level: 'B2', line: 'sennichimae', rect: [14, -188, 146, -182], axis: 'x', platform: 's_platform', side: 's',
  no: 2, dirEn: 'for Sakuragawa / Nodahanshin', dirJa: '桜川・野田阪神方面', heading: -1 });

// =============================================================================
// B1 — the underground city
// =============================================================================

// --- Midosuji concourse ------------------------------------------------------
space({ id: 'm_north_free', level: 'B1', zone: 'midosuji', rect: [-140, -226, -92, -180], ceil: 3.4, style: 'metro_concourse' });
space({ id: 'm_paid', level: 'B1', zone: 'midosuji', rect: [-140, -180, -92, -80], ceil: 3.4, style: 'metro_concourse', paid: 'midosuji' });
space({ id: 'm_south_free', level: 'B1', zone: 'midosuji', rect: [-140, -80, -92, -48], ceil: 3.4, style: 'metro_concourse' });
gates.push({ id: 'g_m_north', level: 'B1', zone: 'midosuji', line: 'midosuji', axis: 'x', at: -180, from: -134, to: -98, lanes: 12, name: 'North Gate', ja: '北改札' });
gates.push({ id: 'g_m_south', level: 'B1', zone: 'midosuji', line: 'midosuji', axis: 'x', at: -80, from: -134, to: -98, lanes: 12, name: 'South Gate', ja: '南改札' });
// fare adjustment / ticket machine walls on either side of the gate lines are
// part of the gate object; the builder places ticket machines on free side.

// Escalators concourse <-> platform. Ascend north (up = -1) at the north end,
// south (up = +1) at the south end.
escalatorBank({ id: 'esc_m_n', level0: 'B2', level1: 'B1', axis: 'z', up: -1, at: -119, from: -156, length: 16, lanes: ['stairs', 'up', 'down'], zone: 'midosuji', stairsWidth: 2 });
escalatorBank({ id: 'esc_m_s', level0: 'B2', level1: 'B1', axis: 'z', up: +1, at: -119, from: -104, length: 16, lanes: ['down', 'up', 'stairs'], zone: 'midosuji', stairsWidth: 2 });

// --- NAMBAWALK ------------------------------------------------------------------
// The long east-west arcade under Sennichimae-dori. Central mall 8 m wide,
// shops either side, cross aisles to exits.
space({ id: 'walk_main', level: 'B1', zone: 'nambawalk', rect: [-92, -226, 220, -218], ceil: 3.2, style: 'arcade' });
shopRow({ level: 'B1', zone: 'nambawalk', rowRect: [-80, -236, 220, -226], frontSide: 's', widths: [7, 9, 6, 8, 10, 6, 7, 12, 8, 6], prefix: 'walk_n', gaps: [[-60, -54], [40, 46], [110, 132], [140, 146]] });
shopRow({ level: 'B1', zone: 'nambawalk', rowRect: [-80, -218, 30, -208], frontSide: 'n', widths: [8, 6, 9, 7, 6, 10, 8], prefix: 'walk_sw', gaps: [[-20, -12]] });
shopRow({ level: 'B1', zone: 'nambawalk', rowRect: [90, -218, 220, -208], frontSide: 'n', widths: [6, 8, 7, 9, 6, 8], prefix: 'walk_se', gaps: [[110, 132], [196, 202]] });
// cross aisles (override shops) leading to street exits
space({ id: 'walk_x1', level: 'B1', zone: 'nambawalk', rect: [-60, -240, -54, -226], ceil: 3.0, style: 'arcade' });
space({ id: 'walk_x2', level: 'B1', zone: 'nambawalk', rect: [40, -240, 46, -226], ceil: 3.0, style: 'arcade' });
space({ id: 'walk_x3', level: 'B1', zone: 'nambawalk', rect: [140, -240, 146, -226], ceil: 3.0, style: 'arcade' });
space({ id: 'walk_x4', level: 'B1', zone: 'nambawalk', rect: [196, -218, 202, -204], ceil: 3.0, style: 'arcade' });
// 'Crysta-style' fountain court where the arcade widens
space({ id: 'walk_court', level: 'B1', zone: 'nambawalk', rect: [110, -232, 132, -212], ceil: 4.0, style: 'arcade_court' });

// --- Sennichimae Line concourse (south of NAMBAWALK) ---------------------------
space({ id: 's_free', level: 'B1', zone: 'sennichimae', rect: [30, -218, 90, -204], ceil: 3.2, style: 'metro_concourse' });
space({ id: 's_paid', level: 'B1', zone: 'sennichimae', rect: [30, -204, 90, -178], ceil: 3.2, style: 'metro_concourse', paid: 'sennichimae' });
gates.push({ id: 'g_s', level: 'B1', zone: 'sennichimae', line: 'sennichimae', axis: 'x', at: -204, from: 36, to: 84, lanes: 10, name: 'Sennichimae Line Gate', ja: '千日前線 改札' });
escalatorBank({ id: 'esc_s', level0: 'B2', level1: 'B1', axis: 'x', up: -1, at: -196, from: 74, length: 16, lanes: ['up', 'down', 'stairs'], zone: 'sennichimae', stairsWidth: 2 });

// --- Takashimaya depachika (food hall) ---------------------------------------
space({ id: 'taka_b1', level: 'B1', zone: 'takashimaya', rect: [-80, -200, 20, -132], ceil: 3.0, style: 'depachika' });
space({ id: 'taka_b1_entry', level: 'B1', zone: 'takashimaya', rect: [-20, -218, -12, -200], ceil: 3.0, style: 'depachika' });
// west passage runs 2 m east of the Midosuji paid area (a solid wall between)
space({ id: 'link_nw', level: 'B1', zone: 'link', rect: [-92, -186, -80, -180], ceil: 3.0, style: 'passage' });
space({ id: 'taka_b1_west', level: 'B1', zone: 'link', rect: [-90, -180, -80, -150], ceil: 3.0, style: 'passage' });

// --- West passage: Metro <-> Nankai / Namba CITY ------------------------------
space({ id: 'link_west', level: 'B1', zone: 'link', rect: [-90, -150, -80, -48], ceil: 3.0, style: 'passage' });
space({ id: 'link_south', level: 'B1', zone: 'link', rect: [-90, -60, -30, -46], ceil: 3.0, style: 'passage' });
space({ id: 'link_sw', level: 'B1', zone: 'link', rect: [-92, -60, -90, -48], ceil: 3.0, style: 'passage' });
shopRow({ level: 'B1', zone: 'link', rowRect: [-80, -132, -70, -60], frontSide: 'w', widths: [6, 5, 7, 5, 6, 8, 5], prefix: 'link_e', ceil: 3.0 });

// --- Namba CITY B1 (south mall) ----------------------------------------------
space({ id: 'city_b1_north', level: 'B1', zone: 'city', rect: [-30, -62, 30, -40], ceil: 3.6, style: 'city_plaza' });
space({ id: 'city_b1_main', level: 'B1', zone: 'city', rect: [-5, -40, 5, 150], ceil: 3.4, style: 'city_mall' });
shopRow({ level: 'B1', zone: 'city', rowRect: [-30, -40, -5, 150], frontSide: 'e', widths: [10, 8, 12, 9, 8, 10, 14, 8, 9, 10], prefix: 'city_b1w', gaps: [[30, 36], [50, 86], [96, 102]] });
shopRow({ level: 'B1', zone: 'city', rowRect: [5, -40, 30, 150], frontSide: 'w', widths: [9, 12, 8, 10, 8, 9, 10, 12, 8], prefix: 'city_b1e', gaps: [[30, 36], [50, 86], [96, 102]] });
// central court — two storeys tall, the escalators and the void
space({ id: 'city_b1_court', level: 'B1', zone: 'city', rect: [-30, 50, 30, 86], ceil: 4.0, style: 'city_court' });
space({ id: 'city_b1_x1', level: 'B1', zone: 'city', rect: [-30, 30, 30, 36], ceil: 3.4, style: 'city_mall' });
space({ id: 'city_b1_x2', level: 'B1', zone: 'city', rect: [-30, 96, 30, 102], ceil: 3.4, style: 'city_mall' });
// dining street at the south end
space({ id: 'city_b1_dining', level: 'B1', zone: 'city', rect: [-8, 150, 8, 186], ceil: 3.2, style: 'dining_street' });
shopRow({ level: 'B1', zone: 'city', rowRect: [-30, 150, -8, 186], frontSide: 'e', widths: [8, 6, 7, 8, 7], prefix: 'city_dw', style: 'restaurant', ceil: 3.0 });
shopRow({ level: 'B1', zone: 'city', rowRect: [8, 150, 30, 186], frontSide: 'w', widths: [7, 8, 6, 8, 7], prefix: 'city_de', style: 'restaurant', ceil: 3.0 });

// =============================================================================
// 1F — street level
// =============================================================================

// Sennichimae-dori south sidewalk + Namba Plaza (outdoors).
space({ id: 'street_s_walk', level: '1F', zone: 'street', rect: [-104, -206, 210, -200], outdoor: true, style: 'sidewalk' });
space({ id: 'midosuji_e_walk', level: '1F', zone: 'street', rect: [-104, -200, -96, -40], outdoor: true, style: 'sidewalk' });
space({ id: 'plaza', level: '1F', zone: 'plaza', rect: [-96, -200, -40, -184], outdoor: true, style: 'plaza' });
// Takashimaya ground floor (cosmetics hall) — a tempting shortcut.
space({ id: 'taka_1f', level: '1F', zone: 'takashimaya', rect: [-80, -184, 20, -132], ceil: 4.6, style: 'department',
  kind: 'room', doors: [[-70, -184, -50, -184], [-6, -132, 6, -132]] });
// Nankai ground hall (rotunda-style entrance under the station)
space({ id: 'nankai_1f', level: '1F', zone: 'nankai', rect: [-60, -132, 40, -100], ceil: 5.4, style: 'terminal_hall' });
space({ id: 'nankai_1f_west', level: '1F', zone: 'nankai', rect: [-96, -124, -60, -108], ceil: 4.0, style: 'terminal_hall' });
space({ id: 'nankai_1f_south', level: '1F', zone: 'nankai', rect: [-30, -100, 30, -40], ceil: 4.0, style: 'terminal_hall' });

// Namba CITY 1F
space({ id: 'city_1f_main', level: '1F', zone: 'city', rect: [-5, -40, 5, 180], ceil: 4.0, style: 'city_mall' });
shopRow({ level: '1F', zone: 'city', rowRect: [-30, -40, -5, 180], frontSide: 'e', widths: [12, 9, 10, 8, 14, 10, 8, 12, 9, 10, 9], prefix: 'city_1w', ceil: 3.8, gaps: [[40, 46], [50, 86], [130, 136]] });
shopRow({ level: '1F', zone: 'city', rowRect: [5, -40, 30, 180], frontSide: 'w', widths: [10, 8, 12, 9, 10, 8, 14, 9, 10, 8, 12], prefix: 'city_1e', ceil: 3.8, gaps: [[40, 46], [50, 86], [130, 136]] });
space({ id: 'city_1f_court', level: '1F', zone: 'city', rect: [-30, 50, 30, 86], ceil: 6.0, style: 'city_court' });
space({ id: 'city_1f_x1', level: '1F', zone: 'city', rect: [-30, 40, 30, 46], ceil: 4.0, style: 'city_mall' });
space({ id: 'city_1f_x2', level: '1F', zone: 'city', rect: [-30, 130, 30, 136], ceil: 4.0, style: 'city_mall' });
// atrium void over the B1 mall + its escalators (B1 <-> 1F)
voids.push({ level: '1F', rect: [2, 54, 14, 82], rail: 'glass' });
escalatorBank({ id: 'esc_city_a', level0: 'B1', level1: '1F', axis: 'z', up: +1, at: -4, from: 54, length: 16, lanes: ['up', 'down'], zone: 'city' });
// stairs B1 -> 1F at the north plaza (towards Nankai)
escalatorBank({ id: 'stair_city_n', level0: 'B1', level1: '1F', axis: 'x', up: +1, at: -58, from: 12, length: 13, lanes: ['stairs'], zone: 'city', stairsWidth: 4 });

// =============================================================================
// 2F — Nankai concourse, Namba CITY 2F, Parks entrance
// =============================================================================
space({ id: 'nankai_2f', level: '2F', zone: 'nankai', rect: [-60, -124, 40, -60], ceil: 5.4, style: 'terminal_concourse' });
voids.push({ level: '2F', rect: [-30, -122, 4, -108], rail: 'glass' });
space({ id: 'city_2f_north', level: '2F', zone: 'city', rect: [-5, -60, 5, 100], ceil: 4.0, style: 'city_mall' });
shopRow({ level: '2F', zone: 'city', rowRect: [-30, -60, -5, 100], frontSide: 'e', widths: [10, 12, 8, 10, 9, 11, 10, 12], prefix: 'city_2nw', ceil: 3.6, gaps: [[20, 26]] });
shopRow({ level: '2F', zone: 'city', rowRect: [5, -60, 30, 100], frontSide: 'w', widths: [9, 11, 10, 12, 8, 10, 11], prefix: 'city_2ne', ceil: 3.6, gaps: [[20, 26]] });
space({ id: 'city_2f_x1', level: '2F', zone: 'city', rect: [-30, 20, 30, 26], ceil: 4.0, style: 'city_mall' });
space({ id: 'city_2f_main', level: '2F', zone: 'city', rect: [-5, 100, 5, 200], ceil: 4.0, style: 'city_mall' });
shopRow({ level: '2F', zone: 'city', rowRect: [-30, 100, -5, 190], frontSide: 'e', widths: [10, 12, 9, 11, 10, 12, 9, 10], prefix: 'city_2sw', ceil: 3.6 });
shopRow({ level: '2F', zone: 'city', rowRect: [5, 100, 30, 190], frontSide: 'w', widths: [12, 9, 10, 11, 9, 12, 10, 9], prefix: 'city_2se', ceil: 3.6 });

// Escalators Nankai 1F hall -> 2F concourse (two banks)
escalatorBank({ id: 'esc_nk_1', level0: '1F', level1: '2F', axis: 'z', up: -1, at: -40, from: -103, length: 14, lanes: ['up', 'down', 'up'], zone: 'nankai' });
escalatorBank({ id: 'esc_nk_2', level0: '1F', level1: '2F', axis: 'z', up: -1, at: 10, from: -103, length: 14, lanes: ['stairs', 'up', 'down'], zone: 'nankai', stairsWidth: 4 });
// 1F -> 2F inside Namba CITY (south end, towards Parks)
escalatorBank({ id: 'esc_city_b', level0: '1F', level1: '2F', axis: 'z', up: +1, at: -4, from: 110, length: 14, lanes: ['up', 'down'], zone: 'city' });

// =============================================================================
// 3F — Nankai platforms (the terminal)
// =============================================================================
space({ id: 'nankai_3f_concourse', level: '3F', zone: 'nankai', rect: [-52, -92, 20, -62], ceil: 9.0, style: 'terminal_concourse' });
gates.push({ id: 'g_nk_central', level: '3F', zone: 'nankai', line: 'nankai', axis: 'x', at: -66, from: -50, to: 18, lanes: 22, name: 'Central Gate', ja: '中央改札口' });
// four island platforms; tracks 1-8 numbered west to east
const nkPlat = [[-46, -39], [-29, -22], [-12, -5], [5, 12]];
nkPlat.forEach(([a, b], i) => {
  space({ id: `nk_plat_${i + 1}`, level: '3F', zone: 'nankai', kind: 'platform', rect: [a, -62, b, 110], ceil: 8.0, style: 'terminal_platform', outdoorish: true });
  tracks.push({ id: `nk_track_${i * 2 + 1}`, level: '3F', line: 'nankai', rect: [a - 5, -62, a, 120], axis: 'z', platform: `nk_plat_${i + 1}`, side: 'w', no: i * 2 + 1, heading: +1, terminal: true });
  tracks.push({ id: `nk_track_${i * 2 + 2}`, level: '3F', line: 'nankai', rect: [b, -62, b + 5, 120], axis: 'z', platform: `nk_plat_${i + 1}`, side: 'e', no: i * 2 + 2, heading: +1, terminal: true });
});
// 2F -> 3F escalators into the concourse
escalatorBank({ id: 'esc_nk_3', level0: '2F', level1: '3F', axis: 'z', up: -1, at: -48, from: -67, length: 14, lanes: ['up', 'down'], zone: 'nankai' });
escalatorBank({ id: 'esc_nk_4', level0: '2F', level1: '3F', axis: 'z', up: -1, at: 6, from: -67, length: 14, lanes: ['down', 'up', 'stairs'], zone: 'nankai', stairsWidth: 4 });

// =============================================================================
// Namba Parks
// =============================================================================
// Bridge from Namba CITY 2F
space({ id: 'parks_bridge', level: '2F', zone: 'parks', rect: [-5, 190, 5, 204], ceil: 4.0, style: 'parks_indoor' });
space({ id: 'parks_2f_hall', level: '2F', zone: 'parks', rect: [-20, 204, 50, 214], ceil: 5.0, style: 'parks_indoor' });

// The Canyon — curving open-air ravine on 2F, walls of layered strata.
// Polygon (x,z). Width ~10-14 m, wandering south.
space({ id: 'parks_canyon', level: '2F', zone: 'parks', outdoor: true, style: 'canyon',
  poly: [[22, 214], [44, 214], [48, 240], [42, 262], [46, 290], [52, 318], [48, 346], [52, 372], [30, 380], [30, 352], [26, 322], [24, 292], [20, 262], [24, 238]] });
// Amphitheatre at the south end of the canyon
space({ id: 'parks_stage', level: '2F', zone: 'parks', outdoor: true, style: 'canyon_stage', rect: [30, 372, 60, 386] });

// Parks indoor mall floors 2F-5F, west of the canyon
['2F', '3F', '4F', '5F'].forEach((lv, i) => {
  space({ id: `parks_${lv}_main`, level: lv, zone: 'parks', rect: [-6, 214, 4, 300], ceil: 4.2, style: 'parks_indoor' });
  shopRow({ level: lv, zone: 'parks', rowRect: [-20, 214, -6, 300], frontSide: 'e', widths: [10, 8, 12, 9, 11, 10, 9, 8, 9], prefix: `parks_${lv}w`, ceil: 4.0 });
  shopRow({ level: lv, zone: 'parks', rowRect: [4, 214, 20, 300], frontSide: 'w', widths: [9, 11, 10, 8, 12, 9, 10, 8, 9], prefix: `parks_${lv}e`, ceil: 4.0, gaps: [[236, 242], [276, 282]] });
  // openings onto the canyon on the east side at a few points
  space({ id: `parks_${lv}_canyonview_a`, level: lv, zone: 'parks', rect: [4, 236, 20 + (i === 0 ? 4 : 0), 242], ceil: 4.2, style: 'parks_indoor' });
  space({ id: `parks_${lv}_canyonview_b`, level: lv, zone: 'parks', rect: [4, 276, 20 + (i === 0 ? 4 : 0), 282], ceil: 4.2, style: 'parks_indoor' });
});
// central escalator cascade, each flight shifted south — a stepped well
escalatorBank({ id: 'esc_pk_23', level0: '2F', level1: '3F', axis: 'z', up: +1, at: -4, from: 222, length: 14, lanes: ['up', 'down'], zone: 'parks' });
escalatorBank({ id: 'esc_pk_34', level0: '3F', level1: '4F', axis: 'z', up: +1, at: -4, from: 240, length: 14, lanes: ['up', 'down'], zone: 'parks' });
escalatorBank({ id: 'esc_pk_45', level0: '4F', level1: '5F', axis: 'z', up: +1, at: -4, from: 258, length: 14, lanes: ['up', 'down'], zone: 'parks' });
escalatorBank({ id: 'esc_pk_56', level0: '5F', level1: '6F', axis: 'z', up: +1, at: -4, from: 276, length: 14, lanes: ['up', 'down'], zone: 'parks' });

// Bridges across the canyon (glass-railed, lots of light). They leave the
// indoor mall through the 'canyon view' openings and land on the gardens.
space({ id: 'parks_bridge_3f', level: '3F', zone: 'parks', outdoor: true, rect: [20, 236, 50, 242], style: 'canyon_bridge' });
space({ id: 'parks_bridge_4f', level: '4F', zone: 'parks', outdoor: true, rect: [20, 276, 52, 282], style: 'canyon_bridge' });
space({ id: 'parks_bridge_5f', level: '5F', zone: 'parks', outdoor: true, rect: [20, 236, 50, 242], style: 'canyon_bridge' });

// Terraced roof gardens, stepping up towards the south-east.
const terraces = [
  ['3F', [50, 204, 120, 252]],
  ['4F', [52, 252, 120, 290]],
  ['5F', [54, 290, 120, 320]],
  ['6F', [56, 320, 120, 346]],
  ['7F', [58, 346, 120, 366]],
  ['8F', [60, 366, 120, 388]],
];
terraces.forEach(([lv, rect]) => {
  space({ id: `garden_${lv}`, level: lv, zone: 'parksGarden', outdoor: true, rect, style: 'garden', garden: true });
});
// raised timber boardwalk on 5F: from the 5F bridge, over the 4F garden, to
// the 5F terrace
space({ id: 'parks_5f_deck', level: '5F', zone: 'parksGarden', outdoor: true, rect: [50, 232, 66, 244], style: 'garden_deck' });
space({ id: 'parks_5f_deck_link', level: '5F', zone: 'parksGarden', outdoor: true, rect: [66, 236, 72, 290], style: 'garden_deck' });

// canyon 2F -> garden 3F stairs (outdoor, along x, rising east)
escalatorBank({ id: 'stair_pk_g3', level0: '2F', level1: '3F', axis: 'x', up: +1, at: 222, from: 44, length: 9, lanes: ['stairs'], zone: 'parksGarden', stairsWidth: 4 });
// terrace to terrace stairs (rising south)
escalatorBank({ id: 'stair_g34', level0: '3F', level1: '4F', axis: 'z', up: +1, at: 84, from: 243, length: 9, lanes: ['stairs'], zone: 'parksGarden', stairsWidth: 4 });
escalatorBank({ id: 'stair_g45', level0: '4F', level1: '5F', axis: 'z', up: +1, at: 100, from: 281, length: 9, lanes: ['stairs'], zone: 'parksGarden', stairsWidth: 4 });
escalatorBank({ id: 'stair_g56', level0: '5F', level1: '6F', axis: 'z', up: +1, at: 76, from: 311, length: 9, lanes: ['stairs'], zone: 'parksGarden', stairsWidth: 4 });
escalatorBank({ id: 'stair_g67', level0: '6F', level1: '7F', axis: 'z', up: +1, at: 104, from: 337, length: 9, lanes: ['stairs'], zone: 'parksGarden', stairsWidth: 4 });
escalatorBank({ id: 'stair_g78', level0: '7F', level1: '8F', axis: 'z', up: +1, at: 80, from: 357, length: 9, lanes: ['stairs'], zone: 'parksGarden', stairsWidth: 4 });
// Restaurant floors 6F-8F (indoor, west), with a glazed sky-corridor on each
// floor crossing above the canyon onto that floor's terrace.
[['6F', 284, 324, 56], ['7F', 326, 350, 58], ['8F', 354, 370, 60]].forEach(([lv, z0, oz, x1]) => {
  space({ id: `parks_${lv}_dining`, level: lv, zone: 'parks', rect: [-6, z0, 4, 388], ceil: 3.6, style: 'parks_dining' });
  shopRow({ level: lv, zone: 'parks', rowRect: [-22, z0, -6, 388], frontSide: 'e', widths: [11, 9, 12, 10, 9, 11, 10], prefix: `parks_${lv}dw`, style: 'restaurant', ceil: 3.4 });
  shopRow({ level: lv, zone: 'parks', rowRect: [4, z0, 22, 388], frontSide: 'w', widths: [10, 12, 9, 11, 10, 12], prefix: `parks_${lv}de`, style: 'restaurant', ceil: 3.4, gaps: [[oz, oz + 8]] });
  space({ id: `parks_${lv}_out`, level: lv, zone: 'parks', rect: [4, oz, x1, oz + 8], ceil: 3.6, style: 'parks_skywalk' });
});
escalatorBank({ id: 'esc_pk_67', level0: '6F', level1: '7F', axis: 'z', up: +1, at: -4, from: 318, length: 14, lanes: ['up', 'down'], zone: 'parks' });
escalatorBank({ id: 'esc_pk_78', level0: '7F', level1: '8F', axis: 'z', up: +1, at: -4, from: 346, length: 14, lanes: ['up', 'down'], zone: 'parks' });

// =============================================================================
// Street exits from NAMBAWALK (stairs B1 -> 1F sidewalk)
// =============================================================================
// stairs in cross aisles rising south onto Sennichimae-dori south sidewalk.
// NOTE: the aisles walk_x1..x3 are on the NORTH side; their stairs rise north
// to the north sidewalk which is out of bounds — so they are numbered exits
// that lead to short landings (street_n_*) with a view of the avenue.
space({ id: 'street_n_walk', level: '1F', zone: 'street', rect: [-104, -258, 210, -252], outdoor: true, style: 'sidewalk' });
[[-60, 'exit_15'], [40, 'exit_18'], [140, 'exit_21']].forEach(([x, id]) => {
  escalatorBank({ id: `stair_${id}`, level0: 'B1', level1: '1F', axis: 'z', up: -1, at: x, from: -240, length: 12, lanes: ['stairs'], zone: 'nambawalk', stairsWidth: 6 });
});
// walk_x4 stairs rise south, emerging on a small plaza by the south sidewalk
escalatorBank({ id: 'stair_exit_24', level0: 'B1', level1: '1F', axis: 'z', up: +1, at: 196, from: -204, length: 12, lanes: ['stairs'], zone: 'nambawalk', stairsWidth: 6 });
space({ id: 'street_e_plaza', level: '1F', zone: 'street', rect: [190, -200, 210, -186], outdoor: true, style: 'plaza' });
// stairs from Midosuji north-free concourse up to the plaza (west)
escalatorBank({ id: 'stair_exit_m1', level0: 'B1', level1: '1F', axis: 'x', up: +1, at: -198, from: -108, length: 12, lanes: ['stairs'], zone: 'midosuji', stairsWidth: 4 });
// plaza west edge extended to receive it
space({ id: 'plaza_west', level: '1F', zone: 'plaza', rect: [-104, -200, -96, -184], outdoor: true, style: 'plaza' });

exits.push(
  { id: 'exit_15', no: '15', level: '1F', x: -57, z: -255, ja: '15番出口', en: 'Exit 15', to: 'Sennichimae-dori (north side)' },
  { id: 'exit_18', no: '18', level: '1F', x: 43, z: -255, ja: '18番出口', en: 'Exit 18', to: 'Sennichimae-dori / Dotonbori' },
  { id: 'exit_21', no: '21', level: '1F', x: 143, z: -255, ja: '21番出口', en: 'Exit 21', to: 'Nipponbashi' },
  { id: 'exit_24', no: '24', level: '1F', x: 199, z: -190, ja: '24番出口', en: 'Exit 24', to: 'Namba Hips' },
  { id: 'exit_m1', no: '1', level: '1F', x: -94, z: -197, ja: '1番出口', en: 'Exit 1', to: 'Namba Plaza / Takashimaya' },
);

// =============================================================================
// Structural cores: solid blocks carved out of halls (station offices, toilets,
// shafts). Walls are generated around them automatically.
// =============================================================================
cores.push(
  { id: 'core_m_office', level: 'B1', rect: [-140, -170, -131, -90], kind: 'station', name: 'Station office / toilets', ja: '駅務室・トイレ' },
);

// =============================================================================
// Tactile paving (点字ブロック) guide routes: yellow line blocks along the
// polyline, dot (warning) blocks at every corner and at each stop (stairs,
// gates, exits). Architecture builds them; columns keep clear of them.
// =============================================================================
tactile.push(
  // NAMBAWALK spine, with a detour around the fountain court
  { level: 'B1', pts: [[-116, -182], [-116, -219.5], [109, -219.5], [111, -214.5], [131, -214.5], [133, -219.5], [219, -219.5]] },
  // branches to NAMBAWALK exits
  { level: 'B1', pts: [[-57, -219.5], [-57, -239]], stops: [[-57, -239]] },
  { level: 'B1', pts: [[43, -219.5], [43, -239]], stops: [[43, -239]] },
  { level: 'B1', pts: [[143, -219.5], [143, -239]], stops: [[143, -239]] },
  { level: 'B1', pts: [[199, -219.5], [199, -205]], stops: [[199, -205]] },
  // Midosuji north: exit 1 stairs, gate, paid side to the platform stairs
  { level: 'B1', pts: [[-112, -219.5], [-112, -196], [-109, -196]], stops: [[-109, -196]] },
  { level: 'B1', pts: [[-116, -182]], stops: [[-116, -182]] },
  { level: 'B1', pts: [[-116, -178], [-116, -175], [-118, -175], [-118, -173]], stops: [[-118, -173]] },
  // Sennichimae: gate and paid side to the platform stairs
  { level: 'B1', pts: [[60, -219.5], [60, -206]], stops: [[60, -206]] },
  { level: 'B1', pts: [[60, -202], [60, -199], [55, -199], [55, -191], [57, -191]], stops: [[57, -191]] },
  // west passage: Midosuji north concourse -> link -> Namba CITY B1 -> north stairs
  { level: 'B1', pts: [[-96, -219.5], [-96, -183], [-85, -183], [-85, -53], [0, -53], [0, -56], [11, -56]], stops: [[11, -56]] },
  // Midosuji south gate and paid side
  { level: 'B1', pts: [[-85, -53], [-116, -53], [-116, -78]], stops: [[-116, -78]] },
  { level: 'B1', pts: [[-116, -82], [-116, -84], [-114, -84], [-114, -87]], stops: [[-114, -87]] },
  // Midosuji platform: between the two stair heads
  { level: 'B2', pts: [[-114, -105], [-114, -130], [-118, -130], [-118, -155]], stops: [[-114, -105], [-118, -155]] },
  // Nankai 3F: escalator heads to the central gate
  { level: '3F', pts: [[12, -82], [12, -86], [-46, -86], [-46, -82]], stops: [[12, -82], [-46, -82]] },
  { level: '3F', pts: [[-16, -86], [-16, -68]], stops: [[-16, -68]] },
  // Nankai 1F: west entrance -> stairs to 2F, and south to Namba CITY
  { level: '1F', pts: [[-94, -116], [-48, -116], [-48, -101], [12, -101], [12, -102]], stops: [[12, -102]] },
  { level: '1F', pts: [[0, -101], [0, -42]] },
);

// =============================================================================
// Named spawn points (also used by test harness ?spawn=name)
// yaw: radians, 0 = looking north (-Z), PI/2 = looking west (-X)
// =============================================================================
Object.assign(spawns, {
  start:        { level: '3F', x: -25.5, z: 20, yaw: 0, note: 'Stepping off the airport express at Nankai Namba, platform 4' },
  nankai_gate:  { level: '3F', x: -16, z: -72, yaw: 0 },
  nankai_2f:    { level: '2F', x: -10, z: -80, yaw: Math.PI },
  nankai_1f:    { level: '1F', x: -10, z: -118, yaw: 0 },
  walk:         { level: 'B1', x: 60, z: -222, yaw: Math.PI / 2 },
  walk_court:   { level: 'B1', x: 121, z: -222, yaw: Math.PI / 2 },
  midosuji:     { level: 'B2', x: -112, z: -130, yaw: 0 },
  midosuji_gate:{ level: 'B1', x: -116, z: -70, yaw: 0 },
  sennichimae:  { level: 'B2', x: 40, z: -194, yaw: -Math.PI / 2 },
  depachika:    { level: 'B1', x: -30, z: -166, yaw: 0 },
  city_b1:      { level: 'B1', x: 0, z: 40, yaw: Math.PI },
  city_1f:      { level: '1F', x: 0, z: 50, yaw: Math.PI },
  city_2f:      { level: '2F', x: 0, z: 150, yaw: Math.PI },
  canyon:       { level: '2F', x: 33, z: 230, yaw: Math.PI },
  garden:       { level: '4F', x: 85, z: 270, yaw: Math.PI },
  garden_top:   { level: '8F', x: 90, z: 376, yaw: 0 },
  parks_6f:     { level: '6F', x: -1, z: 320, yaw: Math.PI },
  plaza:        { level: '1F', x: -70, z: -192, yaw: Math.PI / 2 },
});

// =============================================================================
// Points of interest that the game logic, crowds and phone care about.
// (Shops themselves are assigned to shopSlots by world/shops.js.)
// =============================================================================
pois.push(
  { id: 'nk_board', kind: 'departureBoard', level: '2F', x: -10, z: -98, facing: Math.PI },
  { id: 'nk_board3', kind: 'departureBoard', level: '3F', x: -16, z: -83.5, facing: Math.PI },
  { id: 'm_board_n', kind: 'departureBoard', level: 'B1', x: -116, z: -178, facing: 0 },
  { id: 'walk_fountain', kind: 'landmark', level: 'B1', x: 121, z: -222, name: 'Crystal fountain', ja: 'クリスタ広場' },
  { id: 'city_rocket', kind: 'landmark', level: 'B1', x: 0, z: -51, name: 'Namba CITY North Plaza', ja: 'なんばCITY 北口広場' },
  { id: 'parks_stage', kind: 'landmark', level: '2F', x: 45, z: 379, name: 'Parks stage', ja: 'パークスステージ' },
  { id: 'garden_top', kind: 'landmark', level: '8F', x: 90, z: 376, name: 'Parks Garden summit', ja: 'パークスガーデン 屋上' },
);

// =============================================================================
// Derived lookups
// =============================================================================
export const LAYOUT = { LEVELS, LEVEL_ORDER, ZONES, spaces, ramps, voids, gates, tracks, shopSlots, pois, spawns, exits, cores, tactile };

export const spaceById = Object.fromEntries(spaces.map(s => [s.id, s]));
export const rampById = Object.fromEntries(ramps.map(r => [r.id, r]));

// Height profile along a ramp. s = 0 at the low end, 1 at the high end
// (normalised along its footprint length). Escalators have flat landing
// sections; stairs and slopes are linear with a short landing.
export const ESC_TRANSITION = 0.9;   // horizontal length of the curved transitions (m)
export const ESC_TAN = Math.tan(30 * Math.PI / 180);
// Flat landing length at each end of a ramp. Escalators size their landings so
// the incline is exactly 30° whenever the footprint is long enough (≥ 1.0 m
// landings), otherwise they steepen.
export function rampFlat(r) {
  if (r.kind === 'escalator') {
    const H = LEVELS[r.upper].y - LEVELS[r.lower].y;
    return Math.max(1.0, (rampLength(r) - ESC_TRANSITION - H / ESC_TAN) / 2);
  }
  return r.kind === 'stairs' ? 0.6 : 0;
}
// Height profile along a ramp. s = 0 at the low end, 1 at the high end
// (normalised along its footprint length). Escalators have flat landing
// sections and short curved transitions; stairs and slopes are linear with a
// short landing. Architecture builds steps / treads exactly on this profile.
export function rampProfile(r, s) {
  const len = rampLength(r);
  const flat = rampFlat(r);
  const d = s * len;
  let t;
  if (d <= flat) t = 0;
  else if (d >= len - flat) t = 1;
  else {
    t = (d - flat) / (len - 2 * flat);
    if (r.kind === 'escalator') {
      // curved transitions into the incline (parabolic blend over ESC_TRANSITION m)
      const e = ESC_TRANSITION / (len - 2 * flat);
      if (t < e) t = (t * t) / (2 * e) * (1 / (1 - e));
      else if (t > 1 - e) t = 1 - ((1 - t) * (1 - t)) / (2 * e) * (1 / (1 - e));
      else t = (t - e / 2) / (1 - e);
    }
  }
  return LEVELS[r.lower].y + t * (LEVELS[r.upper].y - LEVELS[r.lower].y);
}
export function rampLength(r) {
  return r.axis === 'x' ? r.rect[2] - r.rect[0] : r.rect[3] - r.rect[1];
}
// Convert a world point to the ramp's normalised coordinate s (0 low .. 1 high)
// and lateral offset u (metres from the ramp centreline).
export function rampLocal(r, x, z) {
  const [x0, z0, x1, z1] = r.rect;
  let s, u;
  if (r.axis === 'x') {
    s = (x - x0) / (x1 - x0); if (r.up < 0) s = 1 - s;
    u = z - (z0 + z1) / 2;
  } else {
    s = (z - z0) / (z1 - z0); if (r.up < 0) s = 1 - s;
    u = x - (x0 + x1) / 2;
  }
  return { s, u };
}
// Low-end and high-end entry lines in world space: { x, z } midpoint, plus the
// outward direction (unit vector pointing away from the ramp).
export function rampEnds(r) {
  const [x0, z0, x1, z1] = r.rect;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  if (r.axis === 'x') {
    const lowX = r.up > 0 ? x0 : x1, highX = r.up > 0 ? x1 : x0;
    return { low: { x: lowX, z: cz, dx: -r.up, dz: 0 }, high: { x: highX, z: cz, dx: r.up, dz: 0 } };
  }
  const lowZ = r.up > 0 ? z0 : z1, highZ = r.up > 0 ? z1 : z0;
  return { low: { x: cx, z: lowZ, dx: 0, dz: -r.up }, high: { x: cx, z: highZ, dx: 0, dz: r.up } };
}

export function levelY(level) { return LEVELS[level].y; }
