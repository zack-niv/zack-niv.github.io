// =============================================================================
// Discovery journal + journey stats (distance, floors, wrong turns, coffees).
// Discoveries are first visits to places worth remembering; each shows a
// subtle toast once ("Discovered · Namba Parks Canyon").
// =============================================================================
import { LAYOUT, ZONES } from '../world/layout.js?v=f150c03';

// place definitions: by space id (prefix match with '*'), by zone, or by point
export const PLACES = [
  { id: 'nankai', zone: 'nankai', en: 'Nankai Namba Station', ja: '南海なんば駅', silent: true },
  { id: 'nankai_hall', space: 'nankai_1f', en: 'Nankai ground-floor hall', ja: '南海なんば駅 1階' },
  { id: 'midosuji_conc', zone: 'midosuji', en: 'Midosuji Line concourse', ja: '御堂筋線 なんば駅' },
  { id: 'midosuji_plat', space: 'm_platform', en: 'Midosuji Line platform', ja: '御堂筋線 ホーム' },
  { id: 'sennichimae', zone: 'sennichimae', en: 'Sennichimae Line', ja: '千日前線 なんば駅' },
  { id: 'sen_plat', space: 's_platform', en: 'Sennichimae Line platform', ja: '千日前線 ホーム' },
  { id: 'nambawalk', zone: 'nambawalk', en: 'NAMBAWALK', ja: 'なんばウォーク' },
  { id: 'walk_court', wonder: true, space: 'walk_court', en: 'Crysta fountain court', ja: 'クリスタ広場' },
  { id: 'depachika', wonder: true, space: 'taka_b1', en: 'Takashimaya depachika', ja: '高島屋 デパ地下' },
  { id: 'taka_1f', space: 'taka_1f', en: 'Takashimaya cosmetics hall', ja: '高島屋 1階' },
  { id: 'passage', zone: 'link', en: 'The long underground passage', ja: 'なんば地下街' },
  { id: 'city', zone: 'city', en: 'Namba CITY', ja: 'なんばCITY' },
  { id: 'city_court', wonder: true, space: 'city_b1_court', en: 'Namba CITY central court', ja: 'なんばCITY 中央広場' },
  { id: 'city_dining', space: 'city_b1_dining', en: 'Namba CITY dining street', ja: 'なんばCITY 飲食街' },
  { id: 'parks', wonder: true, zone: 'parks', en: 'Namba Parks', ja: 'なんばパークス' },
  { id: 'canyon', wonder: true, space: 'parks_canyon', en: 'Namba Parks Canyon', ja: 'なんばパークス キャニオン' },
  { id: 'stage', wonder: true, space: 'parks_stage', en: 'Parks amphitheatre', ja: 'パークスステージ' },
  { id: 'bridge', wonder: true, space: 'parks_bridge_*F', en: 'Bridge over the canyon', ja: 'キャニオンブリッジ' },
  { id: 'gardens', wonder: true, zone: 'parksGarden', en: 'Parks Garden terraces', ja: 'パークスガーデン' },
  { id: 'deck', space: 'parks_5f_deck*', en: 'The timber boardwalk', ja: 'ウッドデッキ' },
  { id: 'summit', wonder: true, space: 'garden_8F', en: 'Parks Garden summit', ja: 'パークスガーデン 屋上' },
  { id: 'dining_floors', space: 'parks_*F_dining', en: 'Parks restaurant floors', ja: 'パークス レストランフロア' },
  { id: 'skywalk', space: 'parks_*F_out', en: 'Sky corridor', ja: 'スカイコリドー' },
  { id: 'plaza', zone: 'plaza', en: 'Namba Plaza, outside', ja: 'なんば広場' },
  { id: 'street', zone: 'street', en: 'Sennichimae-dori, daylight', ja: '千日前通' },
];
// numbered exits: discovered when you emerge near them
for (const ex of LAYOUT.exits) PLACES.push({ id: ex.id, point: ex, r: 9, en: `${ex.en} · ${ex.to}`, ja: ex.ja, exit: true });

function matcher(pattern) {
  if (!pattern.includes('*')) return (id) => id === pattern;
  const re = new RegExp('^' + pattern.split('*').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
  return (id) => re.test(id);
}
for (const p of PLACES) if (p.space) p.match = matcher(p.space);

export class Journal {
  constructor(ctx, game) {
    this.ctx = ctx; this.game = game;
    this.found = new Map();       // id -> { en, ja, at }
    this.distance = 0;            // metres walked/ridden
    this.floors = new Set();
    this.wrongTurns = 0;
    this.coffees = 0;
    this.meals = [];
    this.startMinutes = null;
    this._last = null;
    this._checkT = 0;
  }
  begin() {
    const b = this.ctx.player.body;
    this.startMinutes = this.ctx.clock.minutes;
    this._last = { x: b.x, z: b.z, y: b.y, level: b.level };
    this.floors.add(b.level);
  }
  // record a discovery (toast once)
  discover(id, en, ja, { silent = false } = {}) {
    if (this.found.has(id)) return false;
    this.found.set(id, { en, ja, at: this.ctx.clock.hhmm });
    this.ctx.events.emit('discover', { id, en, ja });
    // demo: no toasts. The game decides whether a place deserves a soft place-name card.
    if (!silent && this.game.started && !this.game.ended) this.game.onDiscover?.({ id, en, ja });
    return true;
  }
  resetTracking() { const b = this.ctx.player.body; this._last = { x: b.x, z: b.z, y: b.y, level: b.level }; }
  update(dt) {
    const p = this.ctx.player; if (!p || !this._last) return;
    const b = p.body;
    const d = Math.hypot(b.x - this._last.x, b.z - this._last.z);
    if (d < 4) this.distance += d; // bigger jumps are teleports
    this._last.x = b.x; this._last.z = b.z; this._last.level = b.level;
    this.floors.add(b.level);
    this._checkT -= dt;
    if (this._checkT > 0) return;
    this._checkT = 0.25;
    const sid = p.space ? p.space.id : null;
    const zone = p.zone;
    for (const pl of PLACES) {
      if (this.found.has(pl.id)) continue;
      let hit = false;
      if (pl.match && sid) hit = pl.match(sid);
      else if (pl.zone) hit = zone === pl.zone && (!!sid || !!p.zone);
      else if (pl.point) hit = b.level === pl.point.level && Math.hypot(b.x - pl.point.x, b.z - pl.point.z) < pl.r;
      if (hit) this.discover(pl.id, pl.en, pl.ja, { silent: pl.silent || !pl.wonder });
    }
  }
  get places() { return [...this.found.values()]; }
  floorsLabel() {
    const order = LAYOUT.LEVEL_ORDER.filter(l => this.floors.has(l));
    if (!order.length) return '—';
    return order.length === 1 ? order[0] : `${order[0]} – ${order[order.length - 1]}`;
  }
}
export { ZONES };
