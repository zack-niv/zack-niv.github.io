// =============================================================================
// Floor-plan renderer shared by the phone's Maps app and the in-world floor
// guide boards ("現在地 You are here"). Draws straight from the world grid /
// edges / layout, so the map is always the truth (the *phone* lies about where
// you are, not about where things are).
//
//   drawFloor(g, world, level, theme, { bounds, businesses })
//     g: CanvasRenderingContext2D whose current transform maps world metres
//        (x east, z south) to pixels. bounds: [x0,z0,x1,z1] to limit work.
// =============================================================================
import { CELL } from '../../world/world.js';
import { LAYOUT } from '../../world/layout.js';

export const FOOD = new Set(['ramen', 'udon', 'okonomiyaki', 'kushikatsu', 'sushi', 'tonkatsu', 'curry', 'tempura', 'tendon', 'izakaya', 'yakiniku', 'omurice', 'takoyaki']);
export const CAFE = new Set(['cafe', 'kissaten', 'coffeestand', 'bakery', 'sweets']);
export const SERVICE = new Set(['drugstore', 'conbini', 'phone', 'ticket', 'exchange', 'hyakuen']);
export function catGroup(cat) {
  if (cat === 'closed') return 'closed';
  if (FOOD.has(cat)) return 'food';
  if (CAFE.has(cat)) return 'cafe';
  if (SERVICE.has(cat)) return 'service';
  return 'retail';
}

export const THEMES = {
  // clean light maps-app look
  phone: {
    bg: '#ebe8e1', hall: '#fdfcfa', outdoor: '#eeece6', garden: '#cfe8c4', canyon: '#efe4d3', deck: '#ead9c0',
    zone: { midosuji: '#f9eded', sennichimae: '#faeef4', nankai: '#fcf2e6', nambawalk: '#fdf9ea', city: '#eef4fb', parks: '#f3f7ef',
      takashimaya: '#f1f4e9', link: '#f7f7f6', plaza: '#efede7', street: '#efede7', parksGarden: '#cfe8c4' },
    shop: { food: '#fbe1cb', cafe: '#f4e3d2', retail: '#e7e2f3', service: '#dceaf7', closed: '#e2e2e2' },
    shopStroke: '#d5cbbd', wall: '#a59d90', partition: '#cfc6b8', rail: '#9fb6c4', voidFill: '#dfe9ee',
    track: '#d3d0ca', rails: '#a9a49b', platformEdge: '#f2c300', rampFill: '#d9dde4', rampLine: '#9aa3b1', stairsFill: '#e2ddd5',
    gate: '#6b7380', wallW: 0.45, shopW: 0.18,
  },
  // in-world floor guide board (printed backlit panel)
  guide: {
    bg: '#2c2f34', hall: '#f4f2ec', outdoor: '#d9d6cf', garden: '#b9d8a8', canyon: '#e2d3bb', deck: '#d8c39f',
    zone: { midosuji: '#f3e3e3', sennichimae: '#f3e4ec', nankai: '#f6e7d3', nambawalk: '#f7efd2', city: '#e2ecf7', parks: '#e7efdf',
      takashimaya: '#e6ebdc', link: '#efefed', plaza: '#e3e1db', street: '#e3e1db', parksGarden: '#b9d8a8' },
    shop: { food: '#f6cfae', cafe: '#efd5bb', retail: '#d6cfee', service: '#c6dcf2', closed: '#cfcfcf' },
    shopStroke: '#a99c88', wall: '#55504a', partition: '#b5aa98', rail: '#7d98aa', voidFill: '#c9d9e1',
    track: '#9c988f', rails: '#6d6961', platformEdge: '#e8b800', rampFill: '#bfc6d1', rampLine: '#6d7787', stairsFill: '#d0c9bd',
    gate: '#3e444d', wallW: 0.6, shopW: 0.3,
  },
};

const OUTDOOR_STYLE_FILL = { garden: 'garden', canyon: 'canyon', canyon_stage: 'deck', canyon_bridge: 'deck', garden_deck: 'deck' };

function hallFill(sp, theme) {
  if (sp.outdoor) return theme[OUTDOOR_STYLE_FILL[sp.style]] || theme.outdoor;
  return theme.zone[sp.zone] || theme.hall;
}

// Roads around the complex (context on every floor of the phone map).
export const ROADS = [
  { rect: [-170, -251, 260, -207], ja: '千日前通', en: 'Sennichimae-dori', axis: 'x' },
  { rect: [-150, -280, -105, 30], ja: '御堂筋', en: 'Midosuji', axis: 'z' },
];

export function drawFloor(g, world, level, theme, opt = {}) {
  const grid = world.grids[level];
  if (!grid) return;
  const L = LAYOUT;
  const biz = opt.businessBySlot || null;
  const [bx0, bz0, bx1, bz1] = opt.bounds || [grid.x0, grid.z0, grid.x0 + grid.w, grid.z0 + grid.h];
  const cx0 = Math.max(0, Math.floor(bx0 - grid.x0)), cz0 = Math.max(0, Math.floor(bz0 - grid.z0));
  const cx1 = Math.min(grid.w, Math.ceil(bx1 - grid.x0)), cz1 = Math.min(grid.h, Math.ceil(bz1 - grid.z0));
  // cache colour per space index
  const spaceCol = opt._spaceCol || (opt._spaceCol = new Map());
  const colOf = (i) => {
    const t = grid.type[i];
    if (t === CELL.WALK) {
      const si = grid.space[i];
      let c = spaceCol.get(si);
      if (!c) {
        const sp = L.spaces[si];
        if (sp.shop) {
          const b = biz && biz[sp.id];
          c = theme.shop[b ? catGroup(b.cat) : 'retail'];
        } else c = hallFill(sp, theme);
        spaceCol.set(si, c);
      }
      return c;
    }
    if (t === CELL.VOID) return theme.voidFill;
    if (t === CELL.TRACK) return theme.track;
    if (t === CELL.RAMP) return theme.rampFill;
    return null;
  };
  // run-length rows
  for (let cz = cz0; cz < cz1; cz++) {
    let run = null, rc0 = 0;
    for (let cx = cx0; cx <= cx1; cx++) {
      const c = cx < cx1 ? colOf(cz * grid.w + cx) : null;
      if (c === run) continue;
      if (run) { g.fillStyle = run; g.fillRect(grid.x0 + rc0 - 0.02, grid.z0 + cz - 0.02, cx - rc0 + 0.04, 1.04); }
      run = c; rc0 = cx;
    }
  }
  const inB = (x0, z0, x1, z1) => x1 >= bx0 && x0 <= bx1 && z1 >= bz0 && z0 <= bz1;
  // tracks: rails
  g.lineCap = 'butt';
  for (const t of L.tracks) {
    if (t.level !== level || !inB(...t.rect)) continue;
    const [x0, z0, x1, z1] = t.rect;
    g.strokeStyle = theme.rails; g.lineWidth = 0.18;
    g.beginPath();
    if (t.axis === 'z') { const c = (x0 + x1) / 2; for (const o of [-0.55, 0.55]) { g.moveTo(c + o, z0); g.lineTo(c + o, z1); } }
    else { const c = (z0 + z1) / 2; for (const o of [-0.55, 0.55]) { g.moveTo(x0, c + o); g.lineTo(x1, c + o); } }
    g.stroke();
  }
  // shop outlines
  g.strokeStyle = theme.shopStroke; g.lineWidth = theme.shopW;
  for (const s of L.shopSlots) {
    if (s.level !== level || !inB(...s.rect)) continue;
    const [x0, z0, x1, z1] = s.rect;
    g.strokeRect(x0 + 0.15, z0 + 0.15, x1 - x0 - 0.3, z1 - z0 - 0.3);
  }
  // ramps (escalators & stairs) on both their levels
  for (const r of L.ramps) {
    if (r.lower !== level && r.upper !== level) continue;
    if (!inB(...r.rect)) continue;
    drawRamp(g, r, theme, level);
  }
  // edges
  const E = world.edges[level] || [];
  const strokeKind = (kind, style, w, dash) => {
    g.strokeStyle = style; g.lineWidth = w; g.setLineDash(dash || []);
    g.beginPath();
    for (const e of E) {
      if (e.kind !== kind) continue;
      if (!inB(Math.min(e.ax, e.bx), Math.min(e.az, e.bz), Math.max(e.ax, e.bx), Math.max(e.az, e.bz))) continue;
      g.moveTo(e.ax, e.az); g.lineTo(e.bx, e.bz);
    }
    g.stroke();
  };
  strokeKind('partition', theme.partition, theme.shopW * 1.2);
  strokeKind('rail', theme.rail, 0.25);
  strokeKind('track', theme.platformEdge, 0.35);
  strokeKind('wall', theme.wall, theme.wallW);
  g.setLineDash([]);
  // gates
  for (const gt of L.gates) {
    if (gt.level !== level) continue;
    g.strokeStyle = theme.gate; g.lineWidth = 0.35;
    g.beginPath();
    const n = gt.lanes;
    for (let i = 0; i <= n; i++) {
      const a = gt.from + (gt.to - gt.from) * i / n;
      if (gt.axis === 'x') { g.moveTo(a, gt.at - 0.7); g.lineTo(a, gt.at + 0.7); } else { g.moveTo(gt.at - 0.7, a); g.lineTo(gt.at + 0.7, a); }
    }
    g.stroke();
    g.setLineDash([0.5, 0.5]); g.lineWidth = 0.12;
    g.beginPath();
    if (gt.axis === 'x') { g.moveTo(gt.from, gt.at); g.lineTo(gt.to, gt.at); } else { g.moveTo(gt.at, gt.from); g.lineTo(gt.at, gt.to); }
    g.stroke(); g.setLineDash([]);
  }
}

export function drawRamp(g, r, theme, level) {
  const [x0, z0, x1, z1] = r.rect;
  const esc = r.kind === 'escalator';
  g.fillStyle = esc ? theme.rampFill : theme.stairsFill;
  g.fillRect(x0 + 0.1, z0 + 0.1, x1 - x0 - 0.2, z1 - z0 - 0.2);
  g.strokeStyle = theme.rampLine; g.lineWidth = 0.08;
  g.beginPath();
  const step = esc ? 0.8 : 0.5;
  if (r.axis === 'z') for (let z = z0 + step; z < z1; z += step) { g.moveTo(x0 + 0.25, z); g.lineTo(x1 - 0.25, z); }
  else for (let x = x0 + step; x < x1; x += step) { g.moveTo(x, z0 + 0.25); g.lineTo(x, z1 - 0.25); }
  g.stroke();
  g.lineWidth = 0.14; g.strokeRect(x0 + 0.1, z0 + 0.1, x1 - x0 - 0.2, z1 - z0 - 0.2);
  // chevron pointing in the direction of travel (escalators) / up (stairs)
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  let dx = r.axis === 'x' ? r.up : 0, dz = r.axis === 'z' ? r.up : 0;
  if (r.move < 0) { dx = -dx; dz = -dz; }
  const w = Math.min(x1 - x0, z1 - z0) * 0.32;
  g.fillStyle = theme.rampLine;
  for (const o of [-1.4, 1.4]) {
    const px = cx + dx * o, pz = cz + dz * o;
    g.beginPath();
    g.moveTo(px + dx * w, pz + dz * w);
    g.lineTo(px - dx * w * 0.6 - dz * w, pz - dz * w * 0.6 + dx * w);
    g.lineTo(px - dx * w * 0.6 + dz * w, pz - dz * w * 0.6 - dx * w);
    g.closePath(); g.fill();
  }
}

// Hand-drawn little cartoon of the street network around the complex.
export function drawRoads(g, theme, alpha = 1) {
  g.save(); g.globalAlpha = alpha;
  for (const r of ROADS) {
    const [x0, z0, x1, z1] = r.rect;
    g.fillStyle = '#ffffff'; g.fillRect(x0, z0, x1 - x0, z1 - z0);
    g.strokeStyle = '#d9d3c6'; g.lineWidth = 0.6; g.strokeRect(x0, z0, x1 - x0, z1 - z0);
    g.strokeStyle = '#f3d98b'; g.lineWidth = 0.5; g.setLineDash([3, 3]);
    g.beginPath();
    if (r.axis === 'x') { const c = (z0 + z1) / 2; g.moveTo(x0, c); g.lineTo(x1, c); } else { const c = (x0 + x1) / 2; g.moveTo(c, z0); g.lineTo(c, z1); }
    g.stroke(); g.setLineDash([]);
  }
  g.restore();
}
