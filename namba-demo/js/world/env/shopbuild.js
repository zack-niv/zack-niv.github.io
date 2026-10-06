// =============================================================================
// Storefronts + interiors for every shop slot. Called by world/shops.js.
//
// Everything a passer-by sees from the corridor (bulkhead, fascia sign, blade
// sign, glazing, sample cases, lanterns, menu boards, floor/wall finishes,
// ceiling lights) is merged into per-chunk batches (S.front). The furniture
// and merchandise inside goes to a per-shop batch (S.inner) that the Shops
// system hides beyond ~45 m.
// =============================================================================
import { rgb, mix, WHITE, protoUV } from './kit.js';
import * as D from './draw.js';
import { CAT, MENU, SAMPLES, LIGHT } from './catalog.js';
import { rng, hash } from '../../core/rng.js';

const K = (hex, k = 1) => rgb(hex, k);
const GLOW = 2.0;   // lit atlas multiplier (keep band colours in step)

// ----------------------------------------------------------------------------
// atlas regions (cached by key)
// ----------------------------------------------------------------------------
export function regions(env) {
  const { sign, print } = env;
  const R = {
    fascia(b, st) {
      const H = 72;
      const g = sign.pages[0].g;
      const w = Math.min(900, Math.max(H * 3, D.fasciaWidth(g, b, st, H)));
      return sign.add(`fascia|${b.en}|${b.ja}|${st.bg}|${st.fg}|${st.mode}|${st.emblem || ''}`, w, H, (g2, W2, H2) => D.drawFascia(g2, W2, H2, b, st));
    },
    blade(b, st, glyph) { return sign.add(`blade|${b.en}|${st.bg}|${glyph}`, 88, 132, (g, w, h) => D.drawBlade(g, w, h, b, st, glyph)); },
    noren(text, sub, bg, fg) { return print.add(`noren|${text}|${sub}|${bg}`, 320, 144, (g, w, h) => D.drawNoren(g, w, h, text, sub, bg, fg)); },
    lantern(text, bg) { return sign.add(`lantern|${text}|${bg}`, 160, 128, (g, w, h) => D.drawLantern(g, w, h, text, bg)); },
    chalk(title, items, seed) { return print.add(`chalk|${title}|${seed % 3}`, 144, 200, (g, w, h) => D.drawChalkMenu(g, w, h, title, items, seed)); },
    photoMenu(title, items, foods, accent) { return print.add(`photo|${title}|${accent}`, 176, 240, (g, w, h) => D.drawPhotoMenu(g, w, h, title, items, (gg, x, y, ww, hh, i) => { gg.save(); gg.translate(x, y); D.drawFood(gg, ww, hh, foods[i % foods.length], i); gg.restore(); }, accent)); },
    pop(kind, price) { return print.add(`pop|${kind}|${price}`, 96, 72, (g, w, h) => D.drawPOP(g, w, h, kind, price)); },
    food(kind) { return print.add(`food|${kind}`, 96, 96, (g, w, h) => D.drawFood(g, w, h, kind)); },
    prod(kind, v) { return print.add(`prod|${kind}|${v}`, 384, 64, (g, w, h) => D.drawProducts(g, w, h, kind, v + 1)); },
    rail(v) { return print.add(`rail|${v % 6}`, 384, 16, (g, w, h) => D.drawPriceRail(g, w, h, v + 3)); },
    ticket(cat) { return sign.add(`ticket|${cat}`, 150, 250, (g, w, h) => D.drawTicketMachine(g, w, h, MENU[cat] || MENU.ramen, cat === 'tendon' ? '#f39800' : cat === 'curry' ? '#8a4b15' : '#d81e05')); },
    vending(kind, seed) { return sign.add(`vend|${kind}|${seed % 3}`, 160, 288, (g, w, h) => D.drawVending(g, w, h, kind, seed % 3 + 1)); },
    hoarding(b) { return print.add(`hoard|${b.zone}`, 512, 300, (g, w, h) => D.drawHoarding(g, w, h, b)); },
    hours(b, fmt) { return print.add(`hours|${b.slot}`, 200, 200, (g, w, h) => D.drawHours(g, w, h, b, fmt)); },
    tanzaku(cat) { const it = (MENU[cat] || MENU.izakaya).concat(MENU.izakaya).slice(0, 10); return print.add(`tanz|${cat}`, 40 * it.length, 280, (g, w, h) => D.drawTanzaku(g, w, h, it)); },
    banner(lines, bg, fg) { return print.add(`banner|${lines.join('/')}|${bg}`, 384, 96, (g, w, h) => D.drawBanner(g, w, h, lines, bg, fg)); },
    vbanner(text, bg, fg) { return print.add(`vban|${text}|${bg}`, 64, 300, (g, w, h) => { g.fillStyle = bg; g.fillRect(0, 0, w, h); g.fillStyle = fg; D.vText(g, text, w / 2, h * 0.06, h * 0.94, w * 0.7, 900); }); },
    poster(kind, portrait = true) { return print.add(`poster|${kind}|${portrait}`, portrait ? 128 : 224, portrait ? 192 : 126, (g, w, h) => D.drawAd(g, w, h, kind, 7)); },
    ad(kind, seed, portrait = true) { return sign.add(`ad|${kind}|${portrait}`, portrait ? 200 : 352, portrait ? 300 : 198, (g, w, h) => D.drawAd(g, w, h, kind, seed)); },
    label(text, bg, fg, w = 256, h = 48, fam) { return print.add(`label|${text}|${bg}|${fg}|${w}`, w, h, (g, ww, hh) => { g.fillStyle = bg; g.fillRect(0, 0, ww, hh); g.fillStyle = fg; D.fitText(g, text, ww / 2, hh / 2, ww * 0.9, hh * 0.62, 800, fam); }); },
    litLabel(text, bg, fg, w = 256, h = 48) { return sign.add(`llabel|${text}|${bg}|${fg}|${w}`, w, h, (g, ww, hh) => { g.fillStyle = bg; g.fillRect(0, 0, ww, hh); g.fillStyle = fg; D.fitText(g, text, ww / 2, hh / 2, ww * 0.9, hh * 0.62, 800); }); },
  };
  return R;
}

// ----------------------------------------------------------------------------
// helpers
// ----------------------------------------------------------------------------
const FLOORS = {
  wood: ['env_wood', [0.85, 0.66, 0.48]], tile: ['env_tile', [0.8, 0.8, 0.78]], dark: ['env_tile', [0.32, 0.3, 0.29]],
  gloss: ['env_gloss', [0.74, 0.72, 0.7]], carpet: ['env_matte', [0.42, 0.12, 0.1]], carpetgrey: ['env_matte', [0.45, 0.46, 0.48]], concrete: ['env_matte', [0.55, 0.55, 0.53]],
};
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
function styleFor(S) {
  const c = CAT[S.b.cat] || CAT.fashion;
  const st = { ...c.styles[Math.floor(S.r() * c.styles.length)] };
  if (['ramen', 'udon', 'tendon', 'tempura', 'curry', 'sushi', 'tonkatsu', 'okonomiyaki', 'kushikatsu', 'izakaya', 'yakiniku'].includes(S.b.cat)) st.emblem = (c.blade || '').slice(0, 1);
  // bold fascias: a pale band becomes a saturated/dark brand wall with pale lettering (most shops)
  const flip = S.r() < 0.78;
  if (flip && st.mode !== 'wood' && lum(K(st.bg)) > 0.72) {
    const fgDark = lum(K(st.fg)) < 0.2;
    const bg = fgDark && lum(K(st.accent)) > 0.08 && lum(K(st.accent)) < 0.75 ? st.accent : st.fg;
    st.fg = st.bg; st.bg = bg;
  }
  return st;
}
// wall colour per group: never pure white (Namba retail is saturated and cluttered)
const WALLS = {
  fashion: ['#d6c5b0', '#2d2f33', '#c4b2a0', '#e5cfc9', '#b9c4c9'], shoes: ['#33363a', '#b69a7a', '#c8b8a2'],
  accessory: ['#e3b5bd', '#2a2227', '#d8b99a', '#c9a1a8'], cosme: ['#ecc9cf', '#e8dccd', '#2f2f35'],
  drug: ['#f5e9a6', '#f0ece0', '#dce8f2'], conbini: ['#e9e6da'], books: ['#d8c7a8', '#cfc6b8'], zakka: ['#e2d3bd', '#c9d3c4'],
  gacha: ['#2c2d5b'], service: ['#d6e1ec', '#e9e2d3'], florist: ['#cfe1cf'], sweets: ['#f6d9df', '#efe3cc', '#cfe2d3'],
  takoyaki: ['#e7c9a0'], bakery: ['#ecd9b8', '#dcc7a0'], stand: ['#e5dcc8'], cafe: ['#efe6d6', '#dfe6dc', '#3d3a36', '#c9b79c'],
  rtable: ['#e0cfb0', '#c9b08a'], rcounter: ['#e0cfb0', '#d8c3a0'], sushi: ['#e0cfb0'], kissa: ['#5a2a1e'],
};
function wallCol(S, c) {
  const list = WALLS[c.group] || ['#e6e4dc'];
  return K(list[Math.floor(S.r() * list.length)]);
}

// ----------------------------------------------------------------------------
// entry point
// ----------------------------------------------------------------------------
export function buildShop(S, R) {
  const c = CAT[S.b.cat] || CAT.fashion;
  S.cat = c;
  S.R = R;
  S.st = S.styleOverride ? { ...S.styleOverride } : styleFor(S);
  S.wall = wallCol(S, c);
  finish(S, c);
  front(S, c);
  const fn = INTERIOR[c.group] || INTERIOR.retail;
  fn(S, c);
  dressWalls(S, c);
  // shop light for the lighting system (aggregated)
  const lc = LIGHT[c.light] || LIGHT.neutral;
  if (c.group !== 'closed') S.light(S.W / 2, S.ceil - 0.3, Math.min(S.D / 2, 6), lc, 1.8, Math.max(S.W, Math.min(S.D, 14)) * 0.8, 'panel');
}

// posters / banners on the interior walls (above the shelf line), so no wall stays bare.
// Deterministic and independent of the logic-pass answers (replay-safe).
const POSTER_KINDS = {
  fashion: ['autumn', 'cosme', 'halloween'], shoes: ['autumn', 'concert'], accessory: ['cosme', 'autumn'], cosme: ['cosme', 'cosme', 'autumn'],
  drug: ['cosme', 'drink', 'autumn'], conbini: ['drink', 'ramenfair', 'autumn', 'beer'], books: ['movie', 'museum', 'expo'], zakka: ['autumn', 'travel'],
  gacha: ['movie', 'halloween'], service: ['phone', 'travel', 'concert'], florist: ['autumn'], cafe: ['autumn', 'travel'], kissa: ['museum', 'concert'], stand: ['autumn'],
  bakery: ['autumn'], sweets: ['autumn', 'halloween'], takoyaki: ['ramenfair'], rcounter: ['ramenfair', 'beer'], rtable: ['beer', 'ramenfair'], sushi: ['travel'],
};
function dressWalls(S, c) {
  const P = S.inner, R = S.R, r = S.r;
  const kinds = POSTER_KINDS[c.group];
  if (!kinds || c.group === 'closed') return;
  const dm = S.D > 16 ? 14 : S.D, W = S.W;
  const retailShelves = ['drug', 'conbini', 'books', 'zakka', 'service'].includes(c.group);
  const y0 = retailShelves ? 2.12 : 1.15, y1 = retailShelves ? Math.min(2.95, S.ceil - 0.42) : Math.min(2.4, S.ceil - 0.5);
  const port = !retailShelves;
  const ph = y1 - y0;
  if (ph < 0.45) return;
  const pw = port ? Math.min(0.9, ph * 0.667) : Math.min(1.6, ph * 1.78);
  let k = 0;
  for (const side of [0, 1]) {
    let d = 1.3 + r() * 1.2;
    while (d + pw < dm - 1.2) {
      const kind = kinds[Math.floor(r() * kinds.length)];
      const keep = r() < 0.72;
      if (keep) {
        const reg = R.poster(kind, port);
        P.ta(reg, d, d + pw, y0, y1, side ? W - 0.03 : 0.03, side ? -1 : 1);
        k++;
      }
      d += pw + 1.4 + r() * 1.8;
    }
  }
  // back wall banner
  if (S.D <= 16 && W >= 4) {
    const kind = kinds[Math.floor(r() * kinds.length)];
    const reg = R.poster(kind, false), bw = Math.min(W - 1.4, 2.4), bh = bw * reg.h / reg.w;
    const show = r() < 0.8;
    if (show && y0 + bh < S.ceil - 0.3) P.tq(reg, (W - bw) / 2, (W + bw) / 2, y0, y0 + bh, S.D - 0.03, -1);
  }
  void k;
}

// floor / walls / ceiling lights (always visible: part of the front batch)
function finish(S, c) {
  const P = S.front, W = S.W, Dp = S.D;
  const [fm, fc] = FLOORS[c.floor] || FLOORS.tile;
  if (c.group !== 'closed') P.qh(fm, 0.02, W - 0.02, 0.02, Dp - 0.02, 0.006, true, fc);
  // wall finishes (inside faces)
  const wc = S.wall, h = S.ceil - 0.02;
  const brandC = K(S.st.bg);
  const accentBack = !['rtable', 'rcounter', 'sushi', 'kissa', 'closed', 'cafe', 'stand'].includes(c.group) && lum(brandC) < 0.85;
  P.qd('env_matte', 0, W, 0, h, Dp - 0.015, -1, accentBack ? mix(wc, brandC, 0.55) : wc);
  P.qa('env_matte', 0, Dp, 0, h, 0.015, 1, mix(wc, [0, 0, 0], 0.06));
  P.qa('env_matte', 0, Dp, 0, h, W - 0.015, -1, mix(wc, [0, 0, 0], 0.06));
  // wainscot (brand-tinted lower wall + rail) and a brand cove band under the ceiling
  if (c.group !== 'closed') {
    const br = K(S.st.bg), tint = mix(wc, br, 0.3), rail = mix(br, [0, 0, 0], 0.35);
    const wy = c.group === 'kissa' || c.group === 'rtable' || c.group === 'rcounter' || c.group === 'sushi' ? 1.1 : 0.9;
    P.qd('env_matte', 0, W, 0.08, wy, Dp - 0.025, -1, tint);
    P.qa('env_matte', 0, Dp, 0.08, wy, 0.025, 1, tint);
    P.qa('env_matte', 0, Dp, 0.08, wy, W - 0.025, -1, tint);
    P.box('env_matte', 0, W, wy, wy + 0.04, Dp - 0.05, Dp - 0.015, rail);
    P.box('env_matte', 0.015, 0.05, wy, wy + 0.04, 0, Dp, rail);
    P.box('env_matte', W - 0.05, W - 0.015, wy, wy + 0.04, 0, Dp, rail);
    const cy = h - 0.28;
    P.qd('env_matte', 0, W, cy, cy + 0.12, Dp - 0.026, -1, br);
    P.qa('env_matte', 0, Dp, cy, cy + 0.12, 0.026, 1, br);
    P.qa('env_matte', 0, Dp, cy, cy + 0.12, W - 0.026, -1, br);
  }
  // skirting
  P.qd('env_matte', 0, W, 0, 0.08, Dp - 0.02, -1, [0.15, 0.15, 0.15]);
  // ceiling plane (Architecture leaves room ceilings to the shops): without it the interior opens to the sky/street
  const dk = c.group === 'kissa' || c.group === 'rtable' || c.group === 'rcounter' || c.group === 'sushi' || c.group === 'okonomiyaki';
  P.qh('env_matte', 0.02, W - 0.02, 0.02, Dp - 0.02, S.ceil - 0.006, false, dk ? [0.3, 0.22, 0.17] : [0.9, 0.9, 0.88]);
  if (c.group === 'closed') return;
  // ceiling lights
  const lc = LIGHT[c.light] || LIGHT.neutral;
  const glow = lc.map(v => v * 2.2);
  const yc = S.ceil - 0.012;
  if (c.light === 'cool' || c.group === 'drug' || c.group === 'conbini') {
    // continuous LED lines along the depth
    for (let a = 1.2; a < W - 0.6; a += 2) P.qh('env_glow', a - 0.06, a + 0.06, 0.6, Dp - 0.6, yc, false, glow);
  } else if (c.group === 'rtable' || c.group === 'kissa' || c.group === 'rcounter' || c.group === 'sushi') {
    for (let d = 1.5; d < Dp - 0.8; d += 2.4) for (let a = 1.2; a < W - 0.8; a += 2.4) P.qh('env_glow', a - 0.09, a + 0.09, d - 0.09, d + 0.09, yc, false, glow);
  } else {
    // downlight grid
    for (let d = 1.0; d < Dp - 0.5; d += 1.6) for (let a = 0.9; a < W - 0.5; a += 1.6) P.qh('env_glow', a - 0.07, a + 0.07, d - 0.07, d + 0.07, yc, false, glow);
  }
}

// ----------------------------------------------------------------------------
// storefront
// ----------------------------------------------------------------------------
function front(S, c) {
  const P = S.front, W = S.W, st = S.st, R = S.R;
  const dt = S.doorTop, top = S.top;
  const bandTop = Math.min(top, S.outCeil);
  const lit = st.mode === 'lightbox';
  const bg = K(st.bg), fg = K(st.fg);
  // bulkhead (both faces) — inside face wall colour
  P.box('env_matte', 0, W, dt, top, -0.06, 0.12, mix(bg, [0.1, 0.1, 0.1], 0.5));
  P.qd('env_matte', 0, W, dt, top, 0.125, 1, S.wall);
  if (c.group === 'closed') { closedFront(S); return; }
  // fascia band
  if (lit) P.qd('env_glow', 0, W, dt, bandTop, -0.065, -1, bg.map(v => v * GLOW * 0.92));
  else P.qd('env_matte', 0, W, dt, bandTop, -0.065, -1, bg);
  // pilaster cladding (front faces of the side pilasters)
  const pil = S.doorA0;
  if (pil > 0) {
    P.box('env_matte', 0, pil, 0, dt, -0.05, 0.02, mix(bg, S.wall, 0.4));
    P.box('env_matte', W - pil, W, 0, dt, -0.05, 0.02, mix(bg, S.wall, 0.4));
    // poster frame / light box on each pier (the wall between two shops is never bare)
    const pk = POSTER_KINDS[c.group] || ['autumn', 'travel'];
    for (const [p0, p1] of [[0, pil], [W - pil, W]]) {
      const show = S.r() < 0.7, kind = pk[Math.floor(S.r() * pk.length)];
      if (show && p1 - p0 >= 0.9 && dt > 2.2) {
        const reg = R.poster(kind, true), pc = (p0 + p1) / 2;
        P.box('env_metal', pc - 0.4, pc + 0.4, 0.82, 1.98, -0.075, -0.05, [0.35, 0.36, 0.38]);
        P.tq(reg, pc - 0.37, pc + 0.37, 0.85, 1.95, -0.076, -1);
      }
    }
  }
  // name panel
  const reg = R.fascia(S.b, st);
  const maxH = Math.min(0.62, bandTop - dt - 0.08);
  let sh = maxH, sw = sh * reg.w / reg.h;
  const maxW = W - 0.4;
  if (sw > maxW) { sw = maxW; sh = sw * reg.h / reg.w; }
  const a0 = (W - sw) / 2, y0 = dt + (bandTop - dt - sh) / 2;
  P.box(lit ? 'env_glow' : 'env_matte', a0 - 0.02, a0 + sw + 0.02, y0 - 0.02, y0 + sh + 0.02, -0.12, -0.066, lit ? bg.map(v => v * GLOW * 0.92) : mix(bg, [0, 0, 0], 0.2));
  P.tq(reg, a0, a0 + sw, y0, y0 + sh, -0.122, -1);
  if (c.stripes) { // conbini stripes under the sign
    P.qd('env_glow', 0, W, dt + 0.02, dt + 0.07, -0.126, -1, K(st.fg, GLOW));
    P.qd('env_glow', 0, W, dt + 0.07, dt + 0.11, -0.126, -1, K(st.accent, GLOW));
  }
  S.light(W / 2, dt + 0.3, -0.4, mix(K(st.bg), [1, 0.95, 0.85], 0.6), 1.6, 5.5, 'sign');
  // blade sign (projecting), visible down the corridor
  const glyph = c.blade || (st.primary === 'en' ? S.b.en.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase() : S.b.ja.slice(0, 2));
  if (S.outCeil >= 2.9 && W >= 4) {
    const br = R.blade(S.b, st, glyph);
    const ba = S.r() < 0.5 ? Math.min(0.4, pil * 0.4 + 0.2) : W - Math.min(0.4, pil * 0.4 + 0.2);
    const by1 = Math.min(S.outCeil - 0.08, dt + 0.45), by0 = by1 - 0.66;
    const d0 = -0.82, d1 = -0.16;
    P.box('env_matte', ba - 0.045, ba + 0.045, by0, by1, d0, d1, mix(bg, [0, 0, 0], 0.3));
    P.ta(br, d0 + 0.02, d1 - 0.02, by0 + 0.02, by1 - 0.02, ba + 0.046, 1);
    P.ta(br, d0 + 0.02, d1 - 0.02, by0 + 0.02, by1 - 0.02, ba - 0.046, -1);
    P.box('env_metal', ba - 0.015, ba + 0.015, by1 - 0.06, by1 - 0.03, d1, 0, [0.5, 0.5, 0.5]);
  }
  // frontage type
  if (c.front === 'glass') glassFront(S, c);
  else if (c.front === 'counter') { /* handled by interior template */ }
  // entrance mat
  const da0 = S.doorA0 + 0.2, da1 = S.doorA1 - 0.2;
  if (c.front === 'open') P.qh('env_matte', Math.max(da0, W / 2 - 1.2), Math.min(da1, W / 2 + 1.2), 0.15, 1.0, 0.012, true, [0.18, 0.18, 0.19]);
}

function closedFront(S) {
  const P = S.front, W = S.W, R = S.R;
  // full hoarding across the opening, slightly recessed
  const pil = S.doorA0;
  const d = 0.35;
  P.box('env_matte', pil, W - pil, 0, S.doorTop, d - 0.05, d + 0.05, [0.95, 0.94, 0.9]);
  const reg = R.hoarding(S.b);
  const hw = Math.min(W - 2 * pil - 0.4, 3.2), hh = hw * reg.h / reg.w;
  P.tq(reg, W / 2 - hw / 2, W / 2 + hw / 2, 0.5, 0.5 + hh, d - 0.055, -1);
  P.qd('env_matte', 0, W, S.doorTop, S.top, -0.066, -1, [0.92, 0.92, 0.9]);
  const lr = R.label('改装中  CLOSED FOR RENOVATION', '#1c3f6e', '#ffffff', 512, 48);
  const lw = Math.min(W - 0.6, 3.0);
  P.tq(lr, W / 2 - lw / 2, W / 2 + lw / 2, S.doorTop + 0.08, S.doorTop + 0.08 + lw * 48 / 512, -0.07, -1);
  S.solid(pil, W - pil, d - 0.05, d + 0.05, { force: true });
  S.fillBehind = d + 0.05;
}

// glazed shopfront with a door (cells), sliding doors / noren
function glassFront(S, c) {
  const P = S.front, W = S.W, dt = S.doorTop;
  const A0 = S.doorA0, A1 = S.doorA1;
  const n = A1 - A0;
  const dw = n >= 7 ? 3 : 2;
  const off = Math.floor((n - dw) / 2) + (n - dw >= 3 ? (S.r() < 0.5 ? -1 : 1) : 0);
  const dA0 = A0 + Math.max(0, Math.min(n - dw, off)), dA1 = dA0 + dw;
  S.doorCells = [dA0, dA1];
  const gd = 0.5;
  const frameCol = c.group === 'kissa' || S.st.mode === 'wood' ? [0.25, 0.16, 0.09] : [0.55, 0.56, 0.58];
  const fmat = c.group === 'kissa' || S.st.mode === 'wood' ? 'env_wood' : 'env_metal';
  const panes = [[A0, dA0], [dA1, A1]].filter(([a, b]) => b - a >= 1);
  // the reserved door row is only reserved on the door cells
  for (let i = A0; i < A1; i++) if (i < dA0 || i >= dA1) S.occ[i] = 0;
  for (const [a0, a1] of panes) {
    P.qd('env_glass', a0, a1, 0.12, dt, gd, -1, WHITE);
    P.box(fmat, a0, a1, 0, 0.12, gd - 0.04, gd + 0.04, frameCol);
    for (let a = a0; a <= a1 + 0.01; a += Math.max(1, (a1 - a0) / Math.ceil((a1 - a0) / 1.6))) P.box(fmat, a - 0.025, a + 0.025, 0, dt, gd - 0.03, gd + 0.03, frameCol);
    S.solid(a0, a1, gd - 0.05, gd + 0.05, { force: true });
    // pane returns to the front line (recess sides)
    P.qa('env_matte', 0, gd, 0, dt, a0 + 0.001, 1, mix(S.wall, [0, 0, 0], 0.2));
  }
  P.box(fmat, A0, A1, dt - 0.06, dt, gd - 0.04, gd + 0.04, frameCol);
  // sliding door leaves (open) + door frame
  P.box(fmat, dA0 - 0.03, dA0 + 0.03, 0, dt, gd - 0.06, gd + 0.06, frameCol);
  P.box(fmat, dA1 - 0.03, dA1 + 0.03, 0, dt, gd - 0.06, gd + 0.06, frameCol);
  P.qd('env_glass', dA0 - (dA1 - dA0) * 0.45, dA0 + 0.1, 0.02, dt - 0.06, gd + 0.09, -1, WHITE);
  if (dA0 - (dA1 - dA0) * 0.45 < A0) { /* leaf slides into the pilaster */ }
  // door sticker
  const R = S.R;
  const op = R.label('営業中 OPEN', '#c8102e', '#ffffff', 192, 48);
  if (panes.length) { const [a0] = panes[0]; P.tq(op, a0 + 0.2, a0 + 0.62, 1.32, 1.43, gd - 0.012, -1); }
  // noren across the door
  const nt = c.noren;
  if (nt) {
    const dark = S.st.mode === 'wood' || S.r() < 0.6;
    const bgN = S.b.key === 'tempura_great' ? '#f4f1e8' : S.b.cat === 'yakiniku' ? '#3a0a0a' : dark ? '#1d2b4a' : '#7a1612';
    const fgN = S.b.key === 'tempura_great' ? '#1a1a1a' : '#f5f1e8';
    const reg = R.noren(nt, S.b.key ? S.b.ja : null, bgN, fgN);
    const panels = 3, pw = (dA1 - dA0 - 0.06) / panels;
    const ny1 = dt - 0.03, ny0 = ny1 - Math.min(0.9, dt - 1.6);
    P.box('env_wood', dA0, dA1, ny1, ny1 + 0.04, 0.03, 0.07, [0.4, 0.28, 0.16]);
    for (let k = 0; k < panels; k++) {
      // panel k of the texture (viewer's left = high a)
      const r2 = { ...reg, u0: reg.u0 + (reg.u1 - reg.u0) * k / panels, u1: reg.u0 + (reg.u1 - reg.u0) * (k + 1) / panels };
      const ka = panels - 1 - k;
      const b0 = dA0 + 0.03 + ka * pw + 0.012, b1 = b0 + pw - 0.024;
      P.tq(r2, b0, b1, ny0, ny1, 0.05 + (k % 2) * 0.006, -1);
      P.qd(reg.atlas.mat(reg), b0, b1, ny0, ny1, 0.056 + (k % 2) * 0.006, 1, [0.7, 0.7, 0.7], reg.atlas.uv(r2, true));
    }
  }
  S.light((dA0 + dA1) / 2, 2.0, 0.8, [1, 0.85, 0.65], 0.4, 3, 'down');
  // exterior restaurant dressing
  const food = ['rcounter', 'rtable', 'sushi', 'kissa'].includes(c.group);
  if (food) restaurantOutside(S, c, panes, dA0, dA1);
}

// sample case, ticket machine, A-frame, lanterns, queue chairs
function restaurantOutside(S, c, panes, dA0, dA1) {
  const P = S.front, R = S.R, cat = S.b.cat;
  const refined = S.b.key === 'tempura_great';
  const sorted = panes.slice().sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]));
  // --- sample case (shokuhin sampuru) in front of the widest pane
  if (sorted.length && !refined && SAMPLES[cat]) {
    const [a0, a1] = sorted[0];
    const cw = Math.min(2.4, a1 - a0 - 0.2);
    if (cw >= 0.9) {
      const ca0 = (a0 + a1) / 2 - cw / 2, ca1 = ca0 + cw;
      if (S.outside(ca0, ca1, -0.55, -0.05, 2.5)) sampleCase(S, P, ca0, ca1, -0.55, 0.4, SAMPLES[cat], S.r);
    }
  }
  // --- ticket machine (食券機) next to the door
  if (c.ticket || cat === 'tendon') {
    const side = sorted.length > 1 ? sorted[1] : sorted[0];
    if (side) {
      const ta = side[0] < dA0 ? Math.max(side[0] + 0.1, dA0 - 0.75) : Math.min(side[1] - 0.75, dA1 + 0.1);
      if (S.outside(ta, ta + 0.62, -0.55, -0.05, 2.5)) ticketMachine(S, P, ta, -0.55, R.ticket(cat));
    }
  }
  // --- A-frame / photo menu stand
  const am = S.r() < 0.5 && !refined ? R.chalk(S.b.info.ja + ' メニュー', MENU[cat] || MENU.izakaya, hash(S.b.slot)) : R.photoMenu(refined ? '昼の天ぷら定食' : 'おすすめ ' + S.b.info.ja, MENU[cat] || MENU.izakaya, SAMPLES[cat] || ['tempura'], refined ? '#2b2b2b' : S.st.accent);
  const aa = dA0 > S.W / 2 ? dA0 - 0.5 : dA1 + 0.5;
  if (S.outside(aa - 0.33, aa + 0.33, -1.05, -0.65, 2.5)) aFrame(P, am, aa, -0.85);
  // --- lanterns either side of the door
  if (c.lantern) {
    const txt = { izakaya: '居酒屋', kushikatsu: '串かつ', okonomiyaki: 'お好み焼', tempura: refined ? '天ぷら' : '天ぷら', yakiniku: '焼肉' }[cat] || 'ちょうちん';
    const reg = R.lantern(txt, refined ? '#f4efe2' : '#c8231d');
    for (const la of refined ? [dA1 + 0.35] : [dA0 - 0.3, dA1 + 0.3]) {
      if (la < 0.2 || la > S.W - 0.2) continue;
      const ly = S.doorTop - 0.62;
      P.geo(reg.atlas.mat(reg), protoUV('lantern', reg), la, ly, -0.28, 0, [0.42, 0.58, 0.42]);
      P.box('env_matte', la - 0.09, la + 0.09, ly + 0.57, ly + 0.62, -0.37, -0.19, [0.1, 0.1, 0.1]);
      P.box('env_matte', la - 0.09, la + 0.09, ly - 0.04, ly + 0.01, -0.37, -0.19, [0.1, 0.1, 0.1]);
      P.box('env_metal', la - 0.01, la + 0.01, ly + 0.62, S.doorTop, -0.29, -0.27, [0.3, 0.3, 0.3]);
      S.light(la, ly + 0.3, -0.3, refined ? [1, 0.9, 0.75] : [1, 0.45, 0.25], 0.35, 2.5, 'lamp');
    }
  }
  // --- nobori flags for casual places on wide corridors
  if (['izakaya', 'kushikatsu', 'okonomiyaki', 'udon', 'curry', 'yakiniku'].includes(cat) && S.r() < 0.7) {
    const words = { izakaya: ['生ビール', '宴会予約受付中'], kushikatsu: ['名物 串かつ', '昼飲み歓迎'], okonomiyaki: ['大阪名物', 'お好み焼'], udon: ['ランチ営業中', '手打ちうどん'], curry: ['ランチ営業中', 'カツカレー'], yakiniku: ['ランチ営業中', '黒毛和牛'] }[cat];
    const cols = [['#c8102e', '#ffffff'], ['#ffd400', '#c8102e'], ['#1d2b4a', '#ffffff'], ['#00703c', '#ffffff']];
    const na = dA1 + 0.9 < S.W - 0.2 ? dA1 + 0.9 : dA0 - 0.9;
    if (na > 0.2 && S.outside(na - 0.2, na + 0.2, -1.3, -1.0, 2.5)) {
      const [bgc, fgc] = cols[Math.floor(S.r() * cols.length)];
      nobori(P, R.vbanner(words[Math.floor(S.r() * words.length)], bgc, fgc), na, -1.15);
    }
  }
  // --- popular: queue stanchions & waiting chairs along the front
  const popular = (S.b.rating >= 4.2 && S.b.info && S.b.info.queue >= 0.3) || S.b.key === 'tempura_tendon';
  queuePoints(S, dA0, dA1, popular ? 6 : 3);
  if (popular && !refined) {
    const side = sorted[0];
    if (side) {
      const n = Math.min(4, Math.floor((side[1] - side[0]) / 0.55));
      for (let k = 0; k < n; k++) {
        const a = side[1] > dA1 ? dA1 + 0.5 + k * 0.55 : dA0 - 0.5 - k * 0.55;
        if (a < 0.3 || a > S.W - 0.3) break;
        if (!S.outsideClear(a - 0.25, a + 0.25, -0.45, -0.05, 2.5)) break;
        chair(P, a, -1.0 + 0.75, Math.PI, [0.2, 0.2, 0.22], [0.75, 0.2, 0.18]);
      }
    }
  }
}

export function queuePoints(S, dA0, dA1, n) {
  // first point at the door, then along the frontage (away from the door)
  const dir = dA0 > S.W - dA1 ? -1 : 1;
  let a = dir > 0 ? dA1 + 0.2 : dA0 - 0.2;
  S.spot('queue', (dA0 + dA1) / 2, -0.7, 0, 1);
  for (let k = 1; k < n; k++) {
    a += dir * 0.7;
    if (a < 0.3 || a > S.W - 0.3) { a -= dir * 0.7; S.spot('queue', a, -0.7 - 0.7 * k, 0, 1); continue; }
    S.spot('queue', a, -0.7, -dir, 0);
  }
}

export function sampleCase(S, P, a0, a1, d0, d1, foods, r) {
  const R = S.R;
  // cabinet
  P.box('env_matte', a0, a1, 0, 0.78, d0 + 0.02, d1, [0.12, 0.1, 0.09]);
  P.box('env_metal', a0, a1, 0.78, 0.82, d0, d1, [0.6, 0.6, 0.62]);
  // glass box + lit header
  P.qd('env_glass_case', a0, a1, 0.82, 1.62, d0, -1, WHITE);
  P.qa('env_glass_case', d0, d1, 0.82, 1.62, a0, -1, WHITE);
  P.qa('env_glass_case', d0, d1, 0.82, 1.62, a1, 1, WHITE);
  P.box('env_metal', a0, a1, 1.62, 1.7, d0, d1, [0.3, 0.3, 0.32]);
  P.qh('env_glow', a0 + 0.04, a1 - 0.04, d0 + 0.05, d1 - 0.05, 1.615, false, [2.2, 2.1, 1.9]);
  P.qh('env_matte', a0, a1, d0, d1, 0.825, true, [0.92, 0.9, 0.86]);
  // stepped back shelf
  P.box('env_matte', a0 + 0.02, a1 - 0.02, 0.82, 1.08, (d0 + d1) / 2, d1 - 0.02, [0.9, 0.88, 0.84]);
  const n = Math.max(2, Math.floor((a1 - a0) / 0.34));
  const step = (a1 - a0) / n;
  for (let row = 0; row < 2; row++) {
    for (let k = 0; k < n; k++) {
      const a = a0 + step * (k + 0.5);
      const d = row === 0 ? d0 + 0.2 : (d0 + d1) / 2 + 0.2;
      const y = row === 0 ? 0.83 : 1.09;
      const kind = foods[(k + row * 2) % foods.length];
      foodItem(S, P, kind, a, y, d, 0.14);
      // price card
      const pr = R.label(['¥680', '¥850', '¥980', '¥1,080', '¥1,280', '¥750'][(k + row) % 6], '#ffffff', '#c00000', 96, 40, undefined);
      P.qh(pr.atlas.mat(pr), a - 0.06, a + 0.06, d - 0.2, d - 0.155, y + 0.004, true, WHITE, pr.atlas.uv(pr));
    }
  }
  S.light((a0 + a1) / 2, 1.5, (d0 + d1) / 2, [1, 0.95, 0.85], 0.3, 2, 'sign');
}

// a dish: bowl or plate with a textured top
export function foodItem(S, P, kind, a, y, d, rad) {
  const R = S.R;
  const reg = R.food(kind);
  const bowl = ['ramen', 'udon', 'tendon', 'donburi', 'parfait', 'creamsoda', 'coffee'].includes(kind);
  if (kind === 'creamsoda' || kind === 'parfait') {
    // tall glass
    P.cyl('env_glass_case', a, y, y + rad * 2.2, d, rad * 0.5, WHITE, 'cylOpen');
    P.geo(reg.atlas.mat(reg), protoUV('disk', reg), a, y + rad * 1.9, d, 0, rad * 0.48);
    P.cyl('env_gloss', a, y, y + rad * 1.85, d, rad * 0.46, kind === 'creamsoda' ? [0.2, 0.75, 0.35] : [0.95, 0.85, 0.7]);
    P.geo('env_gloss', 'sphere', a, y + rad * 2.05, d, 0, rad * 0.32, [1, 0.98, 0.9]);
    if (kind === 'creamsoda') P.geo('env_gloss', 'sphere', a + rad * 0.12, y + rad * 2.3, d, 0, rad * 0.09, [0.85, 0.05, 0.1]);
    return;
  }
  if (bowl) {
    const bc = kind === 'ramen' ? [0.75, 0.12, 0.1] : kind === 'udon' ? [0.15, 0.12, 0.1] : [0.12, 0.1, 0.09];
    P.geo('env_gloss', 'bowl', a, y, d, 0, [rad, rad * 0.75, rad], bc);
    P.geo(reg.atlas.mat(reg), protoUV('disk', reg), a, y + rad * 0.5, d, 0, rad * 0.93);
  } else {
    P.geo('env_gloss', 'plate', a, y, d, 0, [rad * 1.15, rad, rad * 1.15], [0.96, 0.95, 0.92]);
    P.geo(reg.atlas.mat(reg), protoUV('disk', reg), a, y + 0.02, d, 0, rad * 0.95);
    if (['katsu', 'tempura', 'okonomi', 'omurice', 'cake', 'toast'].includes(kind)) {
      const cc = { katsu: [0.8, 0.55, 0.25], tempura: [0.92, 0.75, 0.35], okonomi: [0.6, 0.38, 0.18], omurice: [1, 0.82, 0.2], cake: [0.98, 0.9, 0.75], toast: [0.85, 0.6, 0.3] }[kind];
      P.geo('env_gloss', 'blob', a, y + 0.03, d, 0, [rad * 0.55, rad * 0.25, rad * 0.4], cc);
    }
  }
}

export function ticketMachine(S, P, a, d0, reg) {
  P.box('env_metal', a, a + 0.62, 0, 1.78, d0, d0 + 0.48, [0.75, 0.77, 0.8]);
  P.tq(reg, a + 0.04, a + 0.58, 0.55, 1.72, d0 - 0.003, -1);
  P.box('env_matte', a + 0.06, a + 0.56, 0.08, 0.5, d0 - 0.02, d0, [0.3, 0.3, 0.32]);
  S.light(a + 0.3, 1.3, d0 - 0.3, [0.9, 0.95, 1], 0.2, 1.5, 'sign');
}

export function aFrame(P, reg, a, d) {
  if (P.isNull) return;
  P.geo('env_wood', 'aframe', a, 0, d, 0, 1, [0.45, 0.3, 0.18]);
  const f = P.f, uv = reg.atlas.uv(reg), mat = reg.atlas.mat(reg);
  const o = (u, y, dd) => f.p(a + u, y, dd);
  P.gb.quad(mat, o(0.27, 0.12, d - 0.112), o(-0.27, 0.12, d - 0.112), o(-0.27, 0.96, d - 0.027), o(0.27, 0.96, d - 0.027), { uv, col: WHITE });
  P.gb.quad(mat, o(-0.27, 0.12, d + 0.112), o(0.27, 0.12, d + 0.112), o(0.27, 0.96, d + 0.027), o(-0.27, 0.96, d + 0.027), { uv, col: WHITE });
}

export function nobori(P, reg, a, d) {
  P.cyl('env_metal', a, 0, 2.3, d, 0.015, [0.8, 0.8, 0.8]);
  P.box('env_metal', a - 0.01, a + 0.33, 2.24, 2.26, d - 0.01, d + 0.01, [0.8, 0.8, 0.8]);
  P.tq(reg, a + 0.01, a + 0.33, 0.75, 2.24, d - 0.004, -1);
  P.qd(reg.atlas.mat(reg), a + 0.01, a + 0.33, 0.75, 2.24, d + 0.004, 1, [0.8, 0.8, 0.8], reg.atlas.uv(reg, true));
  P.cyl('env_matte', a, 0, 0.12, d, 0.13, [0.15, 0.15, 0.15]);
}

export function chair(P, a, d, rot, frame, seat) {
  P.geo('env_metal', 'chair_frame', a, 0, d, rot, 1, frame);
  P.geo('env_matte', 'chair_seat', a, 0, d, rot, 1, seat);
}
function stool(P, a, d, top = [0.6, 0.15, 0.12]) { P.geo('env_metal', 'stool', a, 0, d, 0, 1, top); }

// ----------------------------------------------------------------------------
// shelving & merchandise
// ----------------------------------------------------------------------------
// A shelf run against a wall or free-standing. Defined by a base line in local
// coordinates (start point, unit run direction, unit normal towards the aisle).
// depth: shelf depth along the normal. h: height. kinds: product kinds list.
export function shelfRun(S, P, o) {
  const { a, d, ra, rd, na, nd, len, depth = 0.45, h = 1.8, kinds, levels = 5, frame = [0.92, 0.92, 0.9], back = true, rail = true, top = true, base = 0.12 } = o;
  const R = S.R;
  const L = (u, n) => ({ a: a + ra * u + na * n, d: d + rd * u + nd * n });
  const box = (mat, u0, u1, y0, y1, n0, n1, col) => {
    const p = L(u0, n0), q = L(u1, n1);
    P.box(mat, Math.min(p.a, q.a), Math.max(p.a, q.a), y0, y1, Math.min(p.d, q.d), Math.max(p.d, q.d), col);
  };
  const boxF = (mat, u0, u1, y0, y1, n0, n1, col) => {
    const p = L(u0, n0), q = L(u1, n1);
    // top + the two run-end sides only (front gets the texture, back/bottom hidden)
    const sideFaces = na !== 0 ? 'nst' : 'ewt';
    P.box(mat, Math.min(p.a, q.a), Math.max(p.a, q.a), y0, y1, Math.min(p.d, q.d), Math.max(p.d, q.d), col, sideFaces);
  };
  const face = (reg, u0, u1, y0, y1, n, col = WHITE) => {
    const p = L(u0, n), q = L(u1, n);
    if (na !== 0) P.ta(reg, Math.min(p.d, q.d), Math.max(p.d, q.d), y0, y1, p.a, na > 0 ? 1 : -1, col);
    else P.tq(reg, Math.min(p.a, q.a), Math.max(p.a, q.a), y0, y1, p.d, nd > 0 ? 1 : -1, col);
  };
  if (back) {
    // the face against the wall is never seen from inside, but IS coplanar with the architecture wall (z-fights
    // when the wall is seen from the corridor), so leave it out
    const bf = na > 0 ? 'w' : na < 0 ? 'e' : nd > 0 ? 'n' : 's';
    const p = L(0, 0), q = L(len, 0.03);
    P.box('env_matte', Math.min(p.a, q.a), Math.max(p.a, q.a), 0, h, Math.min(p.d, q.d), Math.max(p.d, q.d), frame, 'nsewtb'.replace(bf, ''));
  }
  box('env_matte', 0, len, 0, base, 0.03, depth, mix(frame, [0, 0, 0], 0.4));
  // uprights
  const segs = Math.max(1, Math.round(len / 1.2));
  const sl = len / segs;
  for (let k = 0; k <= segs; k++) box('env_matte', Math.max(0, k * sl - 0.02), Math.min(len, k * sl + 0.02), 0, h, 0.03, depth, frame);
  const lh = (h - base - 0.1) / levels;
  for (let lv = 0; lv < levels; lv++) {
    const y = base + lv * lh;
    box('env_matte', 0, len, y - 0.025, y, 0.03, depth + 0.01, frame);
    const ph = lh * (0.72 + 0.2 * S.r());
    for (let k = 0; k < segs; k++) {
      const kind = kinds[(lv + k * 3 + Math.floor(S.r() * 2)) % kinds.length];
      const reg = R.prod(kind, Math.floor(S.r() * 4));
      const u0 = k * sl + 0.03, u1 = (k + 1) * sl - 0.03;
      boxF('env_matte', u0, u1, y, y + ph, 0.05, depth - 0.03, [0.55, 0.52, 0.5]);
      face(reg, u0, u1, y, y + ph, depth - 0.029);
      if (!P.isNull) packs(S, P, { a, d, ra, rd, na, nd, kind, u0, u1, y, ph, depth, key: `${a.toFixed(1)}|${d.toFixed(1)}|${na}|${nd}|${lv}|${k}` }, L);
      if (rail) face(R.rail(lv + k), u0, u1, y - 0.045, y - 0.003, depth + 0.012);
    }
  }
  if (top) box('env_matte', 0, len, h, h + 0.03, 0, depth, frame);
}

// 3-D merchandise: little instanced-looking packs / bottles standing in front of the shelf print,
// so shelves have depth and a silhouette. Deterministic per shelf cell (own rng: layout RNG untouched).
const PACK = {
  drug: ['#ffffff', '#2f7fd0', '#1fa75a', '#f06a9a', '#ffd400', '#e8372c'], cosme: ['#f4b6c6', '#d4af37', '#ffffff', '#c9446a', '#111111', '#8fd0c0'],
  snack: ['#e60012', '#ffd400', '#f39800', '#1fa75a', '#0068b7', '#8a4b15'], drink: ['#0068b7', '#1fa75a', '#e60012', '#f39800', '#ffffff', '#6a3906'],
  book: ['#1d3557', '#c0392b', '#e9c46a', '#2a9d8f', '#f2efe8', '#6a4c93', '#222222'], magazine: ['#e63946', '#ffd400', '#2a9d8f', '#f2efe8', '#1982c4', '#ff6392'],
  stationery: ['#1982c4', '#ff595e', '#ffca3a', '#8ac926', '#ffffff', '#6a4c93'], souvenir: ['#c8102e', '#f2c14e', '#ffffff', '#1d2b4a', '#2d5a3d'],
  folded: ['#e8dfd0', '#2b3a55', '#a3405a', '#c9b79c', '#556b4a', '#d9d9d9'], shoes: ['#f2f2f2', '#222222', '#c0392b', '#2b5aa8', '#c9a56a'],
  gadget: ['#111111', '#ffffff', '#2b5aa8', '#c0c4c8'], zakka: ['#c9a56a', '#ffffff', '#6aa59a', '#d77a61', '#e8dfd0'], gacha: ['#e60012', '#0068b7', '#ffd400', '#1fa75a', '#ff6392'],
  bread: ['#c98a3a', '#e8c070', '#8a5a2a'], onigiri: ['#ffffff', '#222222', '#e60012'], toys: ['#e60012', '#ffd400', '#0068b7', '#1fa75a'],
};
const BOTTLE = new Set(['drink', 'cosme']);
function packs(S, P, o, L) {
  const { kind, u0, u1, y, ph, depth, na, nd, key } = o;
  const pal = (PACK[kind] || PACK.drug).map(h => rgb(h));
  const pr = rng(hash(S.slot.id + '|' + key));
  const front = na !== 0 ? (na > 0 ? 'e' : 'w') : (nd > 0 ? 's' : 'n');
  const faces = front + 't';
  const n0 = depth - 0.036, n1 = depth + 0.024;
  let u = u0 + 0.02;
  while (u < u1 - 0.08) {
    const w = 0.07 + pr() * 0.08, h = ph * (0.5 + pr() * 0.45);
    const uu1 = Math.min(u1 - 0.02, u + w);
    const col = pal[Math.floor(pr() * pal.length)];
    if (BOTTLE.has(kind) && pr() < 0.45) {
      const c = L((u + uu1) / 2, (n0 + n1) / 2);
      P.cyl('env_gloss', c.a, y, y + h * 0.9, c.d, Math.min(0.04, (uu1 - u) / 2), col, 'cyl6');
    } else {
      const p = L(u, n0), q = L(uu1, n1);
      P.box('env_matte', Math.min(p.a, q.a), Math.max(p.a, q.a), y, y + h, Math.min(p.d, q.d), Math.max(p.d, q.d), col, faces);
    }
    u = uu1 + 0.012;
  }
}

// double-sided gondola centred on lateral a, from d0 to d1
export function gondola(S, P, ac, d0, d1, h, kinds, opts = {}) {
  const w = opts.w || 0.8;
  shelfRun(S, P, { a: ac, d: d0, ra: 0, rd: 1, na: 1, nd: 0, len: d1 - d0, depth: w / 2, h, kinds, levels: opts.levels || 4, frame: opts.frame, back: false, top: false });
  shelfRun(S, P, { a: ac, d: d0, ra: 0, rd: 1, na: -1, nd: 0, len: d1 - d0, depth: w / 2, h, kinds: opts.kinds2 || kinds, levels: opts.levels || 4, frame: opts.frame, back: false, top: false });
  P.box('env_matte', ac - 0.02, ac + 0.02, 0, h, d0, d1, opts.frame || [0.92, 0.92, 0.9]);
  P.box('env_matte', ac - w / 2, ac + w / 2, h, h + 0.03, d0, d1, opts.frame || [0.92, 0.92, 0.9]);
  // end cap facing the front with a POP card
  if (opts.endcap !== false) {
    shelfRun(S, P, { a: ac + w / 2, d: d0, ra: -1, rd: 0, na: 0, nd: -1, len: w, depth: 0.32, h: h - 0.1, kinds: opts.endKinds || kinds, levels: 3, frame: opts.frame, back: false, top: false });
    if (opts.pop !== false) {
      const pr = S.R.pop(Math.floor(S.r() * 8), D.yen(98 + Math.floor(S.r() * 40) * 10));
      P.tq(pr, ac - 0.22, ac + 0.22, h + 0.05, h + 0.38, d0 - 0.33, -1);
      P.box('env_metal', ac - 0.005, ac + 0.005, h, h + 0.06, d0 - 0.33, d0 - 0.32, [0.6, 0.6, 0.6]);
    }
  }
}

function hangingPOP(S, P, a, d, y) {
  const pr = S.R.pop(Math.floor(S.r() * 8), S.r() < 0.6 ? D.yen(98 + Math.floor(S.r() * 60) * 10) : null);
  P.tq(pr, a - 0.3, a + 0.3, y, y + 0.45, d, -1);
  P.qd(pr.atlas.mat(pr), a - 0.3, a + 0.3, y, y + 0.45, d + 0.004, 1, WHITE, pr.atlas.uv(pr));
  P.box('env_metal', a - 0.004, a + 0.004, y + 0.45, S.ceil, d - 0.002, d + 0.002, [0.4, 0.4, 0.4]);
}

function register(S, P, a0, a1, d0, d1, col = [0.95, 0.95, 0.93], topCol = [0.3, 0.3, 0.32]) {
  P.box('env_matte', a0, a1, 0, 0.95, d0, d1, col);
  P.box('env_gloss', a0 - 0.02, a1 + 0.02, 0.95, 0.99, d0 - 0.03, d1, topCol);
  // POS terminal
  const am = (a0 + a1) / 2;
  P.box('env_matte', am - 0.18, am + 0.18, 0.99, 1.02, d0 + 0.1, d0 + 0.4, [0.15, 0.15, 0.16]);
  P.box('env_glow', am - 0.14, am + 0.14, 1.04, 1.24, d0 + 0.3, d0 + 0.32, [0.6, 0.85, 1.2]);
  P.box('env_matte', am - 0.15, am + 0.15, 1.02, 1.26, d0 + 0.32, d0 + 0.35, [0.15, 0.15, 0.16]);
}

// ----------------------------------------------------------------------------
// interiors
// ----------------------------------------------------------------------------
function backOfHouse(S, P, d) {
  // seal the back of deep shops as a stockroom: wall + "STAFF ONLY" door
  if (S.D - d < 2) return d;
  const W = S.W;
  if (!S.solid(0, W, d, S.D, { force: false, pocket: 0, fill: true }) && !S.solidForce) {
    // fall back: just a wall line
    if (!S.solid(0, W, d, d + 0.12, { pocket: 999 })) return S.D;
  }
  P.box('env_matte', 0, W, 0, S.ceil, d, d + 0.12, S.wall);
  const da = W * 0.75;
  P.box('env_matte', da - 0.45, da + 0.45, 0, 2.05, d - 0.02, d, [0.82, 0.82, 0.8]);
  const lr = S.R.label('STAFF ONLY 関係者以外立入禁止', '#ffffff', '#333333', 384, 40);
  P.tq(lr, da - 0.35, da + 0.35, 1.5, 1.57, d - 0.025, -1);
  return d;
}
function depthLimit(S) {
  // usable depth: deep CITY/Parks shops get a stockroom
  if (S.D > 16) return backOfHouse(S, S.inner, 14 + Math.floor(S.r() * 3));
  return S.D;
}

const INTERIOR = {};

INTERIOR.closed = (S) => {
  // seal everything behind the hoarding
  const d = S.fillBehind || 0.4;
  if (S.D - d > 1) S.solid(0, S.W, d + 0.1, S.D, { force: true });
  S.spot('browse', S.W / 2, -0.8, 0, 1);
};

// drugstore / 100-yen / stationery / souvenirs / electronics
INTERIOR.drug = (S, c) => {
  const P = S.inner, W = S.W, cat = S.b.cat;
  const Dm = depthLimit(S);
  const kinds = { drugstore: ['drug', 'cosme', 'drug', 'snack', 'drink'], hyakuen: ['zakka', 'stationery', 'toys', 'snack', 'drug'], stationery: ['stationery', 'stationery', 'zakka'], souvenir: ['souvenir', 'snack', 'souvenir'], electronics: ['gadget', 'gadget', 'stationery'] }[cat] || ['drug', 'snack'];
  const frame = cat === 'souvenir' ? [0.55, 0.38, 0.22] : [0.96, 0.96, 0.95];
  // wall shelves
  shelfRun(S, P, { a: 0, d: 1.2, ra: 0, rd: 1, na: 1, nd: 0, len: Dm - 2.2, h: 2.0, kinds, frame });
  shelfRun(S, P, { a: W, d: 1.2, ra: 0, rd: 1, na: -1, nd: 0, len: Dm - 4.2, h: 2.0, kinds: kinds.slice().reverse(), frame });
  S.solid(0, 0.45, 1.2, Dm - 1, { pocket: 4 }); S.solid(W - 0.45, W, 1.2, Dm - 3, { pocket: 4 });
  // register at the back right
  register(S, P, W - 2.6, W - 0.9, Dm - 2.6, Dm - 2.0);
  S.solid(W - 2.6, W - 0.9, Dm - 2.6, Dm - 2.0, { pocket: 4 });
  S.spot('counter', W - 1.75, Dm - 3.2, 0, 1); S.spot('staff', W - 1.75, Dm - 1.3, 0, -1);
  const sr = S.R.litLabel('お会計 REGISTER', '#e60012', '#ffffff', 256, 48);
  P.tq(sr, W - 2.4, W - 1.1, 2.3, 2.54, Dm - 2.3, -1);
  // gondolas every 2 cells
  for (let i = 2; i <= W - 3; i += 2) {
    const d0 = 2.1, d1 = Math.min(Dm - 3.1, d0 + 7);
    if (d1 - d0 < 1.5) break;
    if (S.solid(i + 0.1, i + 0.9, d0, d1)) {
      gondola(S, P, i + 0.5, d0, d1, 1.45, kinds, { frame });
      S.spot('browse', i - 0.5, (d0 + d1) / 2, 1, 0); S.spot('browse', i + 1.5, (d0 + d1) / 2 + 0.6, -1, 0);
    }
  }
  // promo wagons + hanging POP near the entrance
  for (let k = 0; k < 2; k++) {
    const a = k === 0 ? 1.4 : W - 1.6;
    if (a > 0.8 && a < W - 0.8 && S.solid(a - 0.4, a + 0.4, 0.5, 1.2)) wagon(S, P, a, 0.85, kinds[k % kinds.length]);
  }
  for (let k = 0; k < Math.min(4, W / 2); k++) hangingPOP(S, P, 1 + k * (W - 2) / Math.max(1, Math.min(4, W / 2) - 1), 1.6 + (k % 2) * 2.5, S.ceil - 0.75);
  // corridor spill: wagons and POP stands in front of the pilasters
  if (cat === 'drugstore' || cat === 'hyakuen' || cat === 'souvenir') {
    const F = S.front;
    for (const a of [0.55, W - 0.55]) {
      if (S.outside(a - 0.42, a + 0.42, -0.8, -0.1, 2.5)) {
        wagonAt(S, F, a, -0.45, kinds[Math.floor(S.r() * kinds.length)]);
        const pr = S.R.pop(Math.floor(S.r() * 8), D.yen(98 + Math.floor(S.r() * 30) * 10));
        F.box('env_metal', a - 0.01, a + 0.01, 0.8, 1.35, -0.46, -0.44, [0.7, 0.7, 0.7]);
        F.tq(pr, a - 0.2, a + 0.2, 1.35, 1.65, -0.47, -1);
      }
    }
    if (cat === 'drugstore') {
      const br = S.R.banner(['SALE', '医薬品・化粧品 毎日安い!'], '#e60012', '#ffffff');
      P.tq(br, 0.6, Math.min(W - 0.6, 3.6), S.doorTop - 0.55, S.doorTop - 0.05, 0.3, -1);
    }
  }
  S.spot('browse', 1.0, 3.5, -1, 0); S.spot('browse', W - 1.0, Dm / 2, 1, 0);
};

function wagon(S, P, a, d, kind) { wagonAt(S, P, a, d, kind); }
function wagonAt(S, P, a, d, kind) {
  P.box('env_metal', a - 0.4, a + 0.4, 0.1, 0.75, d - 0.3, d + 0.3, [0.85, 0.85, 0.86]);
  for (let k = 0; k < 4; k++) P.cyl('env_matte', a + (k < 2 ? -0.35 : 0.35), 0, 0.08, d + (k % 2 ? -0.25 : 0.25), 0.04, [0.15, 0.15, 0.15]);
  const reg = S.R.prod(kind, Math.floor(S.r() * 4));
  P.box('env_matte', a - 0.37, a + 0.37, 0.75, 0.86, d - 0.27, d + 0.27, [0.6, 0.55, 0.5]);
  P.tq(reg, a - 0.37, a + 0.37, 0.6, 0.86, d - 0.302, -1);
  P.qh(reg.atlas.mat(reg), a - 0.37, a + 0.37, d - 0.27, d + 0.27, 0.861, true, WHITE, reg.atlas.uv(reg));
}

// conbini: glass front, magazine rack at the window, counter + coffee machine, fridges at the back
INTERIOR.conbini = (S, c) => {
  const P = S.inner, W = S.W;
  const Dm = Math.min(S.D, 14);
  if (S.D > Dm + 1) backOfHouse(S, P, Dm);
  // magazine rack along the window (behind the glass row)
  const [dA0, dA1] = S.doorCells || [S.doorA0, S.doorA1];
  const runs = [[S.doorA0, dA0], [dA1, S.doorA1]].filter(([a, b]) => b - a >= 1);
  for (const [a0, a1] of runs) {
    P.box('env_matte', a0 + 0.05, a1 - 0.05, 0, 0.75, 0.6, 0.95, [0.9, 0.9, 0.9]);
    const mg = S.R.prod('magazine', Math.floor(S.r() * 4));
    for (let a = a0 + 0.05; a < a1 - 0.1; a += 1.2) {
      const e = Math.min(a1 - 0.05, a + 1.2);
      // tilted magazine faces toward the glass (outward)
      P.tq(mg, a, e, 0.78, 1.1, 0.6, -1);
      P.tq(S.R.prod('magazine', Math.floor(S.r() * 4)), a, e, 0.4, 0.72, 0.58, -1);
    }
  }
  // counter on the door side
  const leftDoor = dA0 < W / 2;
  const ca0 = leftDoor ? W - 1.9 : 0.4, ca1 = ca0 + 1.5;
  const cd0 = 2.2, cd1 = Math.min(Dm - 3, 6.2);
  if (S.solid(ca0, ca0 + 0.6, cd0, cd1, { pocket: 4 })) {
    P.box('env_matte', ca0, ca0 + 0.6, 0, 1.0, cd0, cd1, [0.94, 0.94, 0.92]);
    P.box('env_gloss', ca0 - 0.03, ca0 + 0.63, 1.0, 1.04, cd0, cd1, [0.25, 0.28, 0.3]);
    // hot snack case + coffee machine
    const hc = S.R.food('kushi');
    P.box('env_glass_case', ca0 + 0.05, ca0 + 0.55, 1.04, 1.4, cd0 + 0.2, cd0 + 0.9, WHITE);
    P.qh('env_glow', ca0 + 0.07, ca0 + 0.53, cd0 + 0.22, cd0 + 0.88, 1.39, false, [2, 1.6, 1.0]);
    P.qh(hc.atlas.mat(hc), ca0 + 0.07, ca0 + 0.53, cd0 + 0.22, cd0 + 0.88, 1.06, true, WHITE, hc.atlas.uv(hc));
    P.box('env_matte', ca0 + 0.1, ca0 + 0.5, 1.04, 1.7, cd1 - 0.6, cd1 - 0.15, [0.15, 0.15, 0.16]);
    P.box('env_glow', ca0 + 0.12, ca0 + 0.48, 1.45, 1.6, cd1 - 0.61, cd1 - 0.6, [0.4, 0.8, 1.4]);
    const side = leftDoor ? -1 : 1;
    S.spot('counter', ca0 + 0.3 + side * 0.9, (cd0 + cd1) / 2, -side, 0);
    S.spot('staff', ca0 + 0.3 - side * 0.8, (cd0 + cd1) / 2, side, 0);
    // cigarettes wall behind
    const sw = leftDoor ? W - 0.02 : 0.02;
    const sr = S.R.prod('snack', 2);
    P.ta(sr, cd0, cd1, 1.4, 2.1, sw + (leftDoor ? -0.01 : 0.01), leftDoor ? -1 : 1);
  }
  // drinks fridges along the back (lit glass doors)
  const fz = Dm - 0.7;
  if (S.solid(0.3, W - 0.3, fz, Dm, { pocket: 4 })) {
    P.box('env_matte', 0.3, W - 0.3, 0, 2.1, fz, Dm, [0.85, 0.86, 0.87]);
    for (let a = 0.35; a < W - 0.9; a += 0.75) {
      const reg = S.R.prod(a % 1.5 < 0.75 ? 'drink' : 'bottles', Math.floor(S.r() * 4));
      for (let lv = 0; lv < 5; lv++) P.tq(reg, a, a + 0.7, 0.2 + lv * 0.36, 0.5 + lv * 0.36, fz - 0.005, -1);
      P.qd('env_glow', a + 0.02, a + 0.68, 1.98, 2.02, fz - 0.01, -1, [2, 2, 2]);
      P.box('env_metal', a + 0.69, a + 0.71, 0, 2.1, fz - 0.03, fz, [0.7, 0.7, 0.7]);
    }
    S.spot('browse', W / 2, fz - 1.2, 0, 1);
  }
  // gondolas
  const ga0 = leftDoor ? 1 : 2.6, ga1 = leftDoor ? W - 2.6 : W - 1;
  for (let i = Math.ceil(ga0); i + 1 <= ga1; i += 2) {
    const d0 = 2.1, d1 = Math.min(fz - 1.3, 2.1 + 6);
    if (d1 - d0 > 1.5 && S.solid(i + 0.1, i + 0.9, d0, d1)) {
      gondola(S, P, i + 0.5, d0, d1, 1.35, i % 4 === 0 ? ['snack', 'snack', 'drink'] : ['onigiri', 'bread', 'snack', 'drug'], { endKinds: ['snack'] });
      S.spot('browse', i - 0.4, (d0 + d1) / 2, 1, 0);
    }
  }
};

// fashion / outdoor
INTERIOR.fashion = (S, c) => {
  const P = S.inner, W = S.W, r = S.r;
  const Dm = depthLimit(S);
  const pal = [[0.1, 0.1, 0.1], [0.92, 0.9, 0.86], [0.55, 0.12, 0.12], [0.2, 0.3, 0.5], [0.75, 0.65, 0.5], [0.4, 0.45, 0.3], [0.85, 0.75, 0.7], [0.3, 0.3, 0.32]];
  const shopPal = [pal[Math.floor(r() * pal.length)], pal[Math.floor(r() * pal.length)], pal[Math.floor(r() * pal.length)], pal[1]];
  const metal = r() < 0.5 ? [0.15, 0.15, 0.15] : [0.75, 0.6, 0.35];
  // wall rails with garments on both sides
  for (const side of [0, 1]) {
    const a = side ? W - 0.3 : 0.3;
    const d0 = 2.0, d1 = Dm - 1.0;
    if (!S.solid(side ? W - 0.6 : 0, side ? W : 0.6, d0, d1, { pocket: 4 })) continue;
    // two-tier on one side
    const tiers = side === 0 && S.ceil > 3.2 ? [1.7, 0.95] : [1.55];
    for (const ty of tiers) {
      P.box('env_metal', a - 0.015, a + 0.015, ty, ty + 0.03, d0, d1, metal);
      for (let d = d0 + 0.1; d < d1 - 0.1; d += 0.09 + r() * 0.07) {
        const col = shopPal[Math.floor(r() * shopPal.length)];
        const len = ty < 1.2 ? 0.55 : 0.6 + r() * 0.35;
        P.rbox('env_matte', side ? a - 0.01 : a + 0.01, ty - len / 2, d, 0.42, len, 0.035, (r() - 0.5) * 0.08, mix(col, [1, 1, 1], r() * 0.15), 'nsew');
      }
    }
    // shelf above with folded stacks
    P.box('env_wood', side ? W - 0.45 : 0, side ? W : 0.45, 2.15, 2.18, d0, d1, [0.7, 0.55, 0.4]);
    for (let d = d0 + 0.2; d < d1 - 0.3; d += 0.5) P.box('env_matte', side ? W - 0.4 : 0.05, side ? W - 0.05 : 0.4, 2.18, 2.18 + 0.12 + r() * 0.15, d, d + 0.35, shopPal[Math.floor(r() * 4)]);
    for (let d = d0 + 1; d < d1; d += 2) S.spot('browse', side ? W - 1.2 : 1.2, d, side ? 1 : -1, 0);
  }
  // mannequins at the front on a plinth
  const nm = W >= 8 ? 3 : 2;
  const pa0 = W >= 7 ? 1.1 : 0.9;
  if (S.solid(pa0, pa0 + 0.6 * nm, 0.6, 1.3)) {
    P.box('env_gloss', pa0, pa0 + 0.6 * nm, 0, 0.12, 0.6, 1.3, [0.96, 0.96, 0.95]);
    for (let k = 0; k < nm; k++) mannequin(S, P, pa0 + 0.3 + k * 0.6, 0.12, 0.95, Math.PI + (r() - 0.5) * 0.6, shopPal[k % 4], shopPal[(k + 1) % 4]);
  }
  // central tables with folded stacks
  for (let d = 3.2; d < Dm - 3; d += 3.2) {
    const ac = W / 2 + (r() - 0.5) * 0.6;
    if (W >= 7 && S.solid(ac - 0.7, ac + 0.7, d, d + 0.9)) {
      foldTable(S, P, ac, d + 0.45, 1.4, 0.9, shopPal);
      S.spot('browse', ac, d - 0.5, 0, 1);
    } else if (W >= 5 && S.solid(ac - 0.5, ac + 0.5, d, d + 0.5)) {
      // rolling rack
      P.box('env_metal', ac - 0.6, ac + 0.6, 1.45, 1.48, d + 0.24, d + 0.27, metal);
      for (const e of [-0.6, 0.6]) P.box('env_metal', ac + e - 0.015, ac + e + 0.015, 0, 1.48, d + 0.24, d + 0.27, metal);
      for (let a = ac - 0.55; a < ac + 0.55; a += 0.1) P.rbox('env_matte', a, 1.46 - 0.37, d + 0.255, 0.035, 0.74, 0.42, 0, shopPal[Math.floor(r() * 4)], 'nsew');
    }
  }
  // fitting rooms + register at the back
  const fd = Dm - 1.4;
  if (S.solid(0.2, 1.4, fd, Dm, { pocket: 3 })) {
    P.box('env_matte', 0.2, 1.4, 0, 2.3, fd, fd + 0.05, [0.9, 0.9, 0.88]);
    P.qd('env_matte', 0.25, 1.35, 0.25, 2.2, fd - 0.01, -1, mix(shopPal[0], [1, 1, 1], 0.3));
    const lr = S.R.label('FITTING ROOM 試着室', '#222', '#fff', 256, 40);
    P.tq(lr, 0.35, 1.25, 2.33, 2.47, fd - 0.02, -1);
  }
  const ra0 = W - 2.6;
  if (ra0 > 1.5 && S.solid(ra0, ra0 + 1.6, Dm - 2.2, Dm - 1.6, { pocket: 3 })) {
    register(S, P, ra0, ra0 + 1.6, Dm - 2.2, Dm - 1.6, [0.2, 0.2, 0.2], [0.85, 0.82, 0.78]);
    S.spot('counter', ra0 + 0.8, Dm - 2.8, 0, 1); S.spot('staff', ra0 + 0.8, Dm - 1.0, 0, -1);
  }
  // logo on the back wall
  const reg = S.R.fascia(S.b, S.st);
  const lw = Math.min(W - 1, 2.4), lh = lw * reg.h / reg.w;
  P.tq(reg, W / 2 - lw / 2, W / 2 + lw / 2, 2.35, 2.35 + lh, S.D - 0.03 - (S.D - Dm), -1);
  // sale banner sometimes
  if (r() < 0.35) {
    const br = S.R.banner(r() < 0.5 ? ['SALE', '秋のセール 最大50%OFF'] : ['NEW ARRIVAL', '秋冬コレクション入荷'], r() < 0.6 ? '#c8102e' : '#111111', '#ffffff');
    P.tq(br, W / 2 - 1.2, W / 2 + 1.2, S.doorTop - 0.65, S.doorTop - 0.05, 0.25, -1);
    P.qd(br.atlas.mat(br), W / 2 - 1.2, W / 2 + 1.2, S.doorTop - 0.65, S.doorTop - 0.05, 0.254, 1, WHITE, br.atlas.uv(br));
  }
  S.light(W / 2, 2.5, 1.0, [1, 0.95, 0.88], 0.5, 3, 'spot');
};

export function mannequin(S, P, a, y, d, rot, top, bottom) {
  const skin = S.r() < 0.5 ? [0.95, 0.95, 0.93] : [0.2, 0.2, 0.2];
  P.geo('env_gloss', 'mannequin', a, y, d, rot, 1, skin);
  // clothes: torso shell + skirt/trousers
  P.geo('env_matte', 'cyl', a, y + 0.98, d, rot, [0.21, 0.55, 0.15], top);
  P.geo('env_matte', 'cyl', a, y + 0.1, d, rot, [0.19, 0.88, 0.13], bottom);
  P.cyl('env_metal', a, y, y + 0.02, d, 0.2, [0.3, 0.3, 0.3]);
}

function foldTable(S, P, ac, dc, w, dp, pal) {
  P.box('env_wood', ac - w / 2, ac + w / 2, 0.68, 0.72, dc - dp / 2, dc + dp / 2, [0.75, 0.6, 0.45]);
  P.box('env_wood', ac - w / 2 + 0.05, ac + w / 2 - 0.05, 0, 0.68, dc - dp / 2 + 0.05, dc + dp / 2 - 0.05, [0.5, 0.4, 0.3]);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
    const a = ac - w / 2 + 0.25 + i * (w - 0.5) / 2, d = dc - dp / 4 + j * dp / 2;
    const h = 0.08 + S.r() * 0.18;
    P.box('env_matte', a - 0.17, a + 0.17, 0.72, 0.72 + h, d - 0.13, d + 0.13, pal[Math.floor(S.r() * pal.length)]);
  }
}

INTERIOR.shoes = (S, c) => {
  const P = S.inner, W = S.W, r = S.r;
  const Dm = depthLimit(S);
  for (const side of [0, 1]) {
    if (S.solid(side ? W - 0.4 : 0, side ? W : 0.4, 1.5, Dm - 1, { pocket: 4 }))
      shelfRun(S, P, { a: side ? W : 0, d: 1.5, ra: 0, rd: 1, na: side ? -1 : 1, nd: 0, len: Dm - 2.5, depth: 0.35, h: 2.1, kinds: ['shoes'], levels: 6, frame: [0.95, 0.95, 0.95], rail: false });
  }
  // benches/poufs in the middle
  for (let d = 3; d < Dm - 2; d += 3) {
    if (W >= 6 && S.solid(W / 2 - 0.6, W / 2 + 0.6, d, d + 0.5)) {
      P.box('env_matte', W / 2 - 0.6, W / 2 + 0.6, 0, 0.42, d, d + 0.5, [0.3, 0.32, 0.36]);
      P.box('env_matte', W / 2 - 0.15, W / 2 + 0.15, 0.42, 0.9, d + 0.2, d + 0.24, [0.8, 0.85, 0.9]);
      S.spot('seat', W / 2 - 0.3, d + 0.25, 0, -1); S.spot('seat', W / 2 + 0.3, d + 0.25, 0, -1);
    }
  }
  // display table at the front
  if (S.solid(W / 2 - 0.8, W / 2 + 0.8, 0.8, 1.5)) {
    P.box('env_gloss', W / 2 - 0.8, W / 2 + 0.8, 0, 0.6, 0.8, 1.5, [0.96, 0.96, 0.96]);
    for (let k = 0; k < 4; k++) P.geo('env_gloss', 'sphere', W / 2 - 0.6 + k * 0.4, 0.66, 1.15, 0, [0.14, 0.07, 0.06], [[0.9, 0.9, 0.9], [0.1, 0.1, 0.1], [0.8, 0.2, 0.2], [0.3, 0.4, 0.6]][k]);
  }
  register(S, P, W / 2 - 0.8, W / 2 + 0.8, Dm - 1.8, Dm - 1.2, [0.95, 0.95, 0.95]);
  S.solid(W / 2 - 0.8, W / 2 + 0.8, Dm - 1.8, Dm - 1.2, { pocket: 3 });
  S.spot('counter', W / 2, Dm - 2.4, 0, 1);
  S.spot('browse', 1.1, 3, -1, 0); S.spot('browse', W - 1.1, 5, 1, 0);
};

// accessories / eyewear: glass counters + wall panels
INTERIOR.accessory = (S, c) => {
  const P = S.inner, W = S.W;
  const Dm = Math.min(depthLimit(S), 12);
  if (S.D > Dm + 1.5) backOfHouse(S, P, Dm);
  const kinds = S.b.cat === 'eyewear' ? ['gadget', 'zakka'] : ['cosme', 'zakka', 'souvenir'];
  for (const side of [0, 1]) {
    if (S.solid(side ? W - 0.35 : 0, side ? W : 0.35, 1.2, Dm - 0.8, { pocket: 4 }))
      shelfRun(S, P, { a: side ? W : 0, d: 1.2, ra: 0, rd: 1, na: side ? -1 : 1, nd: 0, len: Dm - 2, depth: 0.3, h: 2.0, kinds, levels: 6, frame: [0.98, 0.97, 0.96], rail: false });
  }
  // lit glass showcases
  for (let d = 2.5; d < Dm - 1.5; d += 2.6) {
    const w = Math.min(2.4, W - 3);
    if (w < 1) break;
    if (S.solid(W / 2 - w / 2, W / 2 + w / 2, d, d + 0.6)) {
      showcase(S, P, W / 2 - w / 2, W / 2 + w / 2, d, d + 0.6, kinds[0]);
      S.spot('browse', W / 2, d - 0.5, 0, 1); S.spot('staff', W / 2, d + 1.1, 0, -1);
    }
  }
  // mirror
  P.qd('env_gloss', W / 2 - 0.4, W / 2 + 0.4, 0.4, 2.0, S.D - 0.03, -1, [0.75, 0.8, 0.85]);
  S.spot('counter', W / 2, Dm - 1.2, 0, 1);
};

export function showcase(S, P, a0, a1, d0, d1, kind) {
  P.box('env_gloss', a0, a1, 0, 0.8, d0, d1, [0.96, 0.95, 0.94]);
  P.qd('env_glass_case', a0, a1, 0.8, 1.05, d0, -1, WHITE);
  P.qa('env_glass_case', d0, d1, 0.8, 1.05, a0, -1, WHITE);
  P.qa('env_glass_case', d0, d1, 0.8, 1.05, a1, 1, WHITE);
  P.qh('env_glass_case', a0, a1, d0, d1, 1.05, true, WHITE);
  const reg = S.R.prod(kind, Math.floor(S.r() * 4));
  P.qh(reg.atlas.mat(reg), a0 + 0.04, a1 - 0.04, d0 + 0.04, d1 - 0.04, 0.82, true, WHITE, reg.atlas.uv(reg));
  P.qh('env_glow', a0 + 0.05, a1 - 0.05, d0 + 0.05, d0 + 0.08, 1.04, false, [2, 2, 2]);
}

// cosmetics: white gloss, lit tester walls, islands
INTERIOR.cosme = (S, c) => {
  const P = S.inner, W = S.W;
  const Dm = Math.min(depthLimit(S), 14);
  if (S.D > Dm + 1.5) backOfHouse(S, P, Dm);
  const brands = ['LUMIÈRE', 'SHIRO', 'AURÈLE', 'KISETSU', 'NOIR', 'HANAKO', 'YUKI', 'CLAIRE'];
  for (const side of [0, 1]) {
    if (!S.solid(side ? W - 0.45 : 0, side ? W : 0.45, 1.2, Dm - 0.8, { pocket: 4 })) continue;
    shelfRun(S, P, { a: side ? W : 0, d: 1.2, ra: 0, rd: 1, na: side ? -1 : 1, nd: 0, len: Dm - 2, depth: 0.4, h: 1.75, kinds: ['cosme'], levels: 5, frame: [0.99, 0.99, 0.99], rail: false });
    // backlit brand headers
    for (let d = 1.2; d < Dm - 1; d += 2.2) {
      const reg = S.R.litLabel(brands[Math.floor(S.r() * brands.length)], ['#111111', '#ffffff', '#f8e1e7'][Math.floor(S.r() * 3)], '#c9a96e', 256, 48);
      const aa = side ? W - 0.01 : 0.01;
      P.ta(reg, d + 0.1, d + 2.0, 1.85, 2.2, aa + (side ? -0.005 : 0.005), side ? -1 : 1);
    }
    for (let d = 2; d < Dm - 1; d += 2.5) S.spot('browse', side ? W - 1.1 : 1.1, d, side ? 1 : -1, 0);
  }
  for (let d = 2.5; d < Dm - 2; d += 3) {
    const w = Math.min(2.2, W - 3.2);
    if (w < 1) break;
    if (S.solid(W / 2 - w / 2, W / 2 + w / 2, d, d + 0.9)) {
      P.box('env_gloss', W / 2 - w / 2, W / 2 + w / 2, 0, 0.95, d, d + 0.9, [0.98, 0.98, 0.98]);
      P.qh('env_glow', W / 2 - w / 2 + 0.05, W / 2 + w / 2 - 0.05, d + 0.05, d + 0.85, 0.951, true, [1.8, 1.75, 1.7]);
      const reg = S.R.prod('cosme', Math.floor(S.r() * 4));
      P.box('env_gloss', W / 2 - w / 2 + 0.1, W / 2 + w / 2 - 0.1, 0.95, 1.2, d + 0.35, d + 0.55, [0.95, 0.9, 0.9]);
      P.tq(reg, W / 2 - w / 2 + 0.1, W / 2 + w / 2 - 0.1, 0.95, 1.2, d + 0.345, -1);
      P.qd('env_gloss', W / 2 - 0.25, W / 2 + 0.25, 1.2, 1.6, d + 0.45, -1, [0.8, 0.85, 0.9]);
      S.spot('browse', W / 2, d - 0.5, 0, 1); S.spot('staff', W / 2, d + 1.4, 0, -1);
    }
  }
  S.spot('counter', W / 2, Dm - 1.2, 0, 1);
};

// books
INTERIOR.books = (S, c) => {
  const P = S.inner, W = S.W;
  const Dm = depthLimit(S);
  const frame = [0.55, 0.4, 0.28];
  for (const side of [0, 1]) {
    if (S.solid(side ? W - 0.4 : 0, side ? W : 0.4, 1.0, Dm - 0.6, { pocket: 4 }))
      shelfRun(S, P, { a: side ? W : 0, d: 1.0, ra: 0, rd: 1, na: side ? -1 : 1, nd: 0, len: Dm - 1.6, depth: 0.35, h: 2.2, kinds: ['book', 'book', 'book', 'magazine'], levels: 7, frame, rail: false });
  }
  // new-release tables near the front
  for (const a of [W / 2]) {
    if (S.solid(a - 0.8, a + 0.8, 1.2, 2.2)) {
      P.box('env_wood', a - 0.8, a + 0.8, 0, 0.75, 1.2, 2.2, [0.6, 0.45, 0.32]);
      for (let k = 0; k < 6; k++) {
        const reg = S.R.prod('magazine', k);
        const ka = a - 0.6 + (k % 3) * 0.6, kd = 1.45 + Math.floor(k / 3) * 0.5;
        P.box('env_matte', ka - 0.21, ka + 0.21, 0.75, 0.75 + 0.05 + (k % 3) * 0.03, kd - 0.15, kd + 0.15, [0.9, 0.9, 0.9]);
        P.qh(reg.atlas.mat(reg), ka - 0.21, ka + 0.21, kd - 0.15, kd + 0.15, 0.801 + (k % 3) * 0.03, true, WHITE, reg.atlas.uv(reg.atlas.sub(reg, (k % 4) * 0.2, 0, (k % 4) * 0.2 + 0.18, 1)));
      }
      const pr = S.R.pop(3, null);
      P.tq(pr, a - 0.2, a + 0.2, 0.9, 1.2, 1.18, -1);
    }
  }
  for (let i = 2; i <= W - 3; i += 2) {
    const d0 = 3.2, d1 = Math.min(Dm - 1.6, 3.2 + 8);
    if (d1 - d0 > 1.5 && S.solid(i + 0.1, i + 0.9, d0, d1)) {
      gondola(S, P, i + 0.5, d0, d1, 1.6, ['book', 'book', 'magazine'], { frame, levels: 5, pop: false });
      S.spot('browse', i - 0.45, d0 + 1.5, 1, 0);
    }
  }
  register(S, P, W - 2.2, W - 0.8, 1.0, 1.6, [0.55, 0.4, 0.28]);
  if (S.solid(W - 2.2, W - 0.8, 1.0, 1.6)) S.spot('counter', W - 1.5, 2.2, 0, -1);
};

// lifestyle / zakka: wooden tables & shelves, plants
INTERIOR.zakka = (S, c) => {
  const P = S.inner, W = S.W;
  const Dm = depthLimit(S);
  const wood = [0.75, 0.6, 0.42];
  for (const side of [0, 1]) {
    if (S.solid(side ? W - 0.45 : 0, side ? W : 0.45, 1.5, Dm - 1, { pocket: 4 }))
      shelfRun(S, P, { a: side ? W : 0, d: 1.5, ra: 0, rd: 1, na: side ? -1 : 1, nd: 0, len: Dm - 2.5, depth: 0.42, h: 1.9, kinds: ['zakka', 'zakka', 'stationery'], levels: 4, frame: wood, rail: false });
  }
  for (let d = 1.6; d < Dm - 2.5; d += 2.8) {
    const w = Math.min(1.8, W - 3.2);
    if (w < 0.8) break;
    if (S.solid(W / 2 - w / 2, W / 2 + w / 2, d, d + 1.0)) {
      P.box('env_wood', W / 2 - w / 2, W / 2 + w / 2, 0.7, 0.75, d, d + 1.0, wood);
      for (const e of [-1, 1]) for (const f of [0, 1]) P.box('env_wood', W / 2 + e * (w / 2 - 0.06) - 0.03, W / 2 + e * (w / 2 - 0.06) + 0.03, 0, 0.7, d + 0.05 + f * 0.84, d + 0.11 + f * 0.84, mix(wood, [0, 0, 0], 0.3));
      const reg = S.R.prod('zakka', Math.floor(S.r() * 4));
      for (let k = 0; k < 5; k++) {
        const a = W / 2 - w / 2 + 0.2 + S.r() * (w - 0.4), dd = d + 0.2 + S.r() * 0.6;
        const kind = Math.floor(S.r() * 3);
        if (kind === 0) P.cyl('env_gloss', a, 0.75, 0.75 + 0.1 + S.r() * 0.15, dd, 0.06 + S.r() * 0.04, [[0.9, 0.88, 0.82], [0.35, 0.45, 0.4], [0.7, 0.5, 0.35]][k % 3]);
        else P.box('env_matte', a - 0.1, a + 0.1, 0.75, 0.75 + 0.05 + S.r() * 0.2, dd - 0.08, dd + 0.08, [[0.95, 0.9, 0.8], [0.6, 0.7, 0.6], [0.8, 0.6, 0.5]][k % 3]);
      }
      P.qh(reg.atlas.mat(reg), W / 2 - w / 2 + 0.05, W / 2 + w / 2 - 0.05, d + 0.6, d + 0.95, 0.752, true, WHITE, reg.atlas.uv(reg));
      S.spot('browse', W / 2, d - 0.5, 0, 1);
    }
  }
  // plants
  if (S.solid(0.5, 1.1, 0.4, 1.0)) { P.cyl('env_matte', 0.8, 0, 0.45, 0.7, 0.22, [0.85, 0.82, 0.78]); P.geo('env_matte', 'tallplant', 0.8, 0.3, 0.7, S.r() * 6, 0.9, [0.25, 0.45, 0.2]); }
  // pendant lamps
  for (let d = 2; d < Dm - 1; d += 2.8) {
    P.box('env_metal', W / 2 - 0.004, W / 2 + 0.004, 2.1, S.ceil, d - 0.004, d + 0.004, [0.2, 0.2, 0.2]);
    P.geo('env_glow', 'sphere', W / 2, 2.05, d, 0, 0.12, [2.2, 1.8, 1.3]);
  }
  register(S, P, W - 2.2, W - 0.8, Dm - 1.8, Dm - 1.2, wood);
  if (S.solid(W - 2.2, W - 0.8, Dm - 1.8, Dm - 1.2, { pocket: 3 })) S.spot('counter', W - 1.5, Dm - 2.4, 0, 1);
};

// gacha: walls of capsule machines
INTERIOR.gacha = (S, c) => {
  const P = S.inner, W = S.W;
  const Dm = Math.min(depthLimit(S), 14);
  if (S.D > Dm + 1.5) backOfHouse(S, P, Dm);
  const machineRow = (a, d0, d1, face) => {
    for (let d = d0; d < d1 - 0.45; d += 0.5) {
      for (let lv = 0; lv < 2; lv++) {
        const y = lv * 0.9;
        const col = [[1, 0.2, 0.5], [0.2, 0.5, 1], [1, 0.8, 0.1], [0.3, 0.8, 0.5], [0.6, 0.3, 0.9]][Math.floor(S.r() * 5)];
        const a0 = face > 0 ? a : a - 0.45, a1 = face > 0 ? a + 0.45 : a;
        P.box('env_gloss', a0, a1, y, y + 0.45, d, d + 0.47, col);
        P.box('env_glass_case', a0 + 0.02, a1 - 0.02, y + 0.45, y + 0.88, d + 0.02, d + 0.45, WHITE);
        const reg = S.R.prod('gacha', Math.floor(S.r() * 4));
        P.ta(reg, d + 0.03, d + 0.44, y + 0.46, y + 0.86, face > 0 ? a + 0.1 : a - 0.1, face);
        P.ta(S.R.pop(4 + Math.floor(S.r() * 4), '¥' + [200, 300, 400, 500][Math.floor(S.r() * 4)]), d + 0.08, d + 0.4, y + 0.12, y + 0.4, face > 0 ? a1 + 0.002 : a0 - 0.002, face);
      }
    }
  };
  if (S.solid(0, 0.5, 0.6, Dm - 0.6, { pocket: 4 })) machineRow(0.02, 0.6, Dm - 0.6, 1);
  if (S.solid(W - 0.5, W, 0.6, Dm - 0.6, { pocket: 4 })) machineRow(W - 0.02, 0.6, Dm - 0.6, -1);
  for (let i = 2; i <= W - 3; i += 2) {
    if (S.solid(i + 0.05, i + 0.95, 2, Dm - 1.5)) { machineRow(i + 0.5, 2, Dm - 1.5, 1); machineRow(i + 0.5, 2, Dm - 1.5, -1); S.spot('browse', i - 0.4, Dm / 2, 1, 0); }
  }
  S.spot('browse', 1.1, 2, -1, 0);
};

// florist: buckets spilling into the corridor
INTERIOR.florist = (S, c) => {
  const P = S.inner, W = S.W, F = S.front;
  const Dm = Math.min(S.D, 10);
  if (S.D > Dm + 1.5) backOfHouse(S, P, Dm);
  const flowers = [[0.95, 0.3, 0.45], [1, 0.85, 0.2], [0.95, 0.95, 0.95], [0.6, 0.3, 0.8], [1, 0.5, 0.2], [0.9, 0.2, 0.2], [1, 0.7, 0.8]];
  const bucket = (Pp, a, d, y = 0) => {
    Pp.cyl('env_metal', a, y, y + 0.32, d, 0.13, [0.6, 0.62, 0.65]);
    const fc = flowers[Math.floor(S.r() * flowers.length)];
    for (let k = 0; k < 4; k++) Pp.geo('env_matte', 'blob', a + (S.r() - 0.5) * 0.12, y + 0.5 + S.r() * 0.15, d + (S.r() - 0.5) * 0.12, S.r() * 6, 0.08 + S.r() * 0.04, fc);
    Pp.geo('env_matte', 'blob', a, y + 0.38, d, 0, [0.13, 0.12, 0.13], [0.2, 0.45, 0.18]);
  };
  // tiered stands both sides
  for (const side of [0, 1]) {
    const a0 = side ? W - 1.0 : 0.1;
    if (!S.solid(a0, a0 + 0.9, 1.0, Dm - 1.5, { pocket: 4 })) continue;
    for (let t = 0; t < 3; t++) P.box('env_wood', a0 + (side ? 0 : t * 0.3), a0 + 0.9 - (side ? t * 0.3 : 0), t * 0.35, t * 0.35 + 0.04, 1.0, Dm - 1.5, [0.45, 0.32, 0.2]);
    for (let d = 1.2; d < Dm - 1.6; d += 0.3) for (let t = 0; t < 3; t++) bucket(P, a0 + (side ? 0.75 - t * 0.3 : 0.15 + t * 0.3), d + (t % 2) * 0.1, t * 0.35 + 0.04);
  }
  // cooler at the back
  if (S.solid(1.2, W - 1.2, Dm - 0.8, Dm)) {
    P.box('env_matte', 1.2, W - 1.2, 0, 2.0, Dm - 0.8, Dm, [0.85, 0.87, 0.88]);
    P.qd('env_glow', 1.3, W - 1.3, 0.3, 1.9, Dm - 0.81, -1, [1.3, 1.5, 1.5]);
    for (let a = 1.5; a < W - 1.5; a += 0.35) bucket(P, a, Dm - 0.95, 0.3);
  }
  // outside: buckets in the corridor
  for (const a of [0.6, W - 0.6]) if (S.outside(a - 0.5, a + 0.5, -0.9, -0.1, 2.5)) { for (let k = 0; k < 6; k++) bucket(F, a - 0.3 + (k % 3) * 0.3, -0.3 - Math.floor(k / 3) * 0.32); }
  S.spot('counter', W / 2, Dm - 1.6, 0, 1); S.spot('staff', W / 2, Dm - 1.0, 0, -1); S.spot('browse', 1.6, 2, -1, 0);
};

// service: phone shop / tickets / exchange
INTERIOR.service = (S, c) => {
  const P = S.inner, W = S.W, cat = S.b.cat;
  const Dm = Math.min(depthLimit(S), 12);
  if (S.D > Dm + 1.5) backOfHouse(S, P, Dm);
  const cd = Math.min(Dm - 1.8, cat === 'ticket' ? 2.2 : 4);
  // service counter across
  if (S.solid(0.8, W - 0.8, cd, cd + 0.7, { pocket: 6 })) {
    P.box('env_gloss', 0.8, W - 0.8, 0, 1.0, cd, cd + 0.7, cat === 'phone' ? [1, 0.45, 0.1] : [0.95, 0.95, 0.95]);
    P.box('env_gloss', 0.75, W - 0.75, 1.0, 1.04, cd - 0.05, cd + 0.7, [0.95, 0.95, 0.95]);
    const n = Math.max(1, Math.floor((W - 1.6) / 1.4));
    for (let k = 0; k < n; k++) {
      const a = 0.8 + (k + 0.5) * (W - 1.6) / n;
      P.box('env_glow', a - 0.18, a + 0.18, 1.06, 1.32, cd + 0.35, cd + 0.37, [0.6, 0.8, 1.2]);
      if (cat !== 'ticket') chair(P, a, cd - 0.45, Math.PI, [0.3, 0.3, 0.3], [0.85, 0.85, 0.85]);
      S.spot('counter', a, cd - 0.55, 0, 1); S.spot('staff', a, cd + 1.1, 0, -1);
    }
    if (cat === 'ticket') {
      // price boards on the back wall
      const reg = S.R.label('新幹線 回数券 ¥13,480  高速バス ¥3,200  切手 ¥84', '#111111', '#ffe400', 512, 48);
      for (let k = 0; k < 4; k++) P.tq(reg, 0.6, W - 0.6, 1.2 + k * 0.32, 1.48 + k * 0.32, Dm - 0.03, -1);
    }
  }
  // posters on the side walls
  for (const side of [0, 1]) {
    const reg = S.R.ad(cat === 'phone' ? 'phone' : cat === 'ticket' ? 'concert' : 'travel', 3, true);
    P.ta(reg, 1.2, 2.2, 1.0, 2.5, side ? W - 0.02 : 0.02, side ? -1 : 1);
  }
  if (cat === 'phone') {
    // demo phone tables
    if (S.solid(W / 2 - 0.7, W / 2 + 0.7, 1.0, 1.8)) {
      P.box('env_gloss', W / 2 - 0.7, W / 2 + 0.7, 0, 0.9, 1.0, 1.8, [0.98, 0.98, 0.98]);
      for (let k = 0; k < 6; k++) P.box('env_glow', W / 2 - 0.55 + (k % 3) * 0.5, W / 2 - 0.45 + (k % 3) * 0.5, 0.91, 0.92, 1.15 + Math.floor(k / 3) * 0.4, 1.35 + Math.floor(k / 3) * 0.4, [0.5, 0.8, 1.4]);
      S.spot('browse', W / 2, 0.6, 0, 1);
    }
  }
  if (cat === 'exchange') {
    const reg = S.R.litLabel('USD 149.2  EUR 162.8  CNY 20.6  KRW 0.108', '#0b2f6b', '#7cf', 512, 48);
    P.tq(reg, 0.6, W - 0.6, 2.0, 2.0 + (W - 1.2) * 48 / 512, cd + 0.75, -1);
  }
};

// cafés (chain or independent)
INTERIOR.cafe = (S, c) => {
  const P = S.inner, W = S.W, r = S.r;
  const Dm = depthLimit(S);
  const wood = r() < 0.5 ? [0.55, 0.38, 0.24] : [0.78, 0.62, 0.45];
  const right = r() < 0.5;
  // counter along one side wall
  const ca = right ? W - 1.9 : 1.3;      // counter body a-range [ca, ca+0.6]
  const cd0 = 1.2, cd1 = Math.min(Dm - 2.5, 6.5);
  let counterOK = false;
  if (W >= 5 && S.solid(ca, ca + 0.6, cd0, cd1, { pocket: 6 })) {
    counterOK = true;
    P.box('env_wood', ca, ca + 0.6, 0, 1.0, cd0, cd1, wood);
    P.box('env_gloss', ca - 0.04, ca + 0.64, 1.0, 1.04, cd0, cd1, [0.92, 0.92, 0.9]);
    // pastry case at the front end
    showcaseFood(S, P, ca - 0.02, ca + 0.62, cd0 + 0.05, cd0 + 1.2, ['cake', 'toast', 'bread', 'cake']);
    // espresso machine + register
    P.box('env_metal', ca + 0.1, ca + 0.5, 1.04, 1.45, cd1 - 1.2, cd1 - 0.5, [0.75, 0.75, 0.78]);
    P.box('env_matte', ca + 0.15, ca + 0.45, 1.04, 1.25, cd0 + 1.7, cd0 + 2.1, [0.15, 0.15, 0.16]);
    // menu board above
    const mr = S.R.chalk('CAFE MENU', MENU.cafe, hash(S.b.slot) + 1);
    const side = right ? 1 : -1;
    P.ta(mr, cd0 + 1.4, cd0 + 3.0, 1.65, 2.75, right ? W - 0.03 : 0.03, right ? -1 : 1);
    // back bar shelves with cups
    const bw = right ? W - 0.02 : 0.02;
    for (let k = 0; k < 3; k++) {
      P.box('env_wood', right ? W - 0.3 : 0, right ? W : 0.3, 1.35 + k * 0.35, 1.38 + k * 0.35, cd0, cd1, wood);
      for (let d = cd0 + 0.1; d < cd1 - 0.1; d += 0.22) P.cyl('env_gloss', right ? W - 0.15 : 0.15, 1.38 + k * 0.35, 1.47 + k * 0.35, d, 0.045, k === 1 ? [0.2, 0.2, 0.2] : [0.97, 0.97, 0.95], 'cyl6');
    }
    void bw;
    // queue / counter / staff spots
    const qa = ca + 0.3 - side * 1.2;
    S.spot('counter', qa, cd0 + 1.8, side, 0);
    for (let k = 1; k <= 4; k++) S.spot('queue', qa, cd0 + 1.8 - k * 0.7, 0, 1);
    S.spot('staff', ca + 0.3 + side * 0.9, cd0 + 1.8, -side, 0);
    S.spot('staff', ca + 0.3 + side * 0.9, cd1 - 0.8, -side, 0);
  }
  // seating
  const seatCol = [[0.25, 0.35, 0.3], [0.55, 0.25, 0.2], [0.2, 0.2, 0.22], [0.75, 0.6, 0.4]][Math.floor(r() * 4)];
  const tA = right ? [0.5, ca - 1.6] : [ca + 1.8, W - 0.5];
  for (let d = 1.6; d < Dm - 1.2; d += 2.0) {
    for (let a = tA[0] + 0.5; a < tA[1] - 0.3; a += 1.9) {
      cafeTable(S, P, a, d, wood, seatCol);
    }
  }
  // bench seating against the far wall
  const bwA = right ? 0 : W - 0.55;
  if (S.solid(bwA, bwA + 0.55, cd1 + 0.6, Dm - 0.5, { pocket: 3 })) {
    P.box('env_matte', bwA, bwA + 0.55, 0, 0.45, cd1 + 0.6, Dm - 0.5, seatCol);
    P.box('env_matte', right ? 0 : W - 0.12, right ? 0.12 : W, 0.45, 1.0, cd1 + 0.6, Dm - 0.5, seatCol);
    for (let d = cd1 + 1; d < Dm - 0.8; d += 0.9) S.spot('seat', right ? 0.9 : W - 0.9, d, right ? -1 : 1, 0);
  }
  // pendant lamps
  for (let d = 2; d < Dm - 1; d += 2.5) {
    const a = (tA[0] + tA[1]) / 2;
    P.box('env_metal', a - 0.004, a + 0.004, 2.15, S.ceil, d - 0.004, d + 0.004, [0.2, 0.2, 0.2]);
    P.geo('env_gloss', 'bowl', a, 2.1, d, 0, [0.22, -0.14, 0.22], [0.15, 0.15, 0.15]);
    P.qh('env_glow', a - 0.1, a + 0.1, d - 0.1, d + 0.1, 2.08, false, [2.3, 1.9, 1.4]);
  }
  // plant at the entrance
  if (S.solid(0.3, 0.8, 0.4, 0.9)) { P.cyl('env_matte', 0.55, 0, 0.4, 0.65, 0.2, [0.3, 0.3, 0.3]); P.geo('env_matte', 'tallplant', 0.55, 0.3, 0.65, 1, 0.8, [0.2, 0.42, 0.18]); }
  // A-frame outside
  const am = S.R.chalk('本日のおすすめ', MENU.cafe, hash(S.b.slot));
  const aa = right ? 0.7 : S.W - 0.7;
  if (S.outside(aa - 0.33, aa + 0.33, -0.95, -0.55, 2.5)) aFrame(S.front, am, aa, -0.75);
  if (!counterOK) S.spot('counter', W / 2, 2, 0, 1);
  queuePoints(S, S.doorA0, S.doorA1, 2);
};

export function cafeTable(S, P, a, d, wood, seatCol, round = false) {
  if (!S.solid(a - 0.33, a + 0.33, d - 0.33, d + 0.33)) return false;
  P.geo('env_metal', 'table_leg', a, 0, d, 0, 1, [0.15, 0.15, 0.15]);
  if (round) P.cyl('env_wood', a, 0.72, 0.75, d, 0.36, wood);
  else P.box('env_wood', a - 0.33, a + 0.33, 0.72, 0.75, d - 0.33, d + 0.33, wood);
  chair(P, a, d - 0.62, 0, [0.15, 0.15, 0.15], seatCol);
  chair(P, a, d + 0.62, Math.PI, [0.15, 0.15, 0.15], seatCol);
  S.spot('seat', a, d - 0.62, 0, 1); S.spot('seat', a, d + 0.62, 0, -1);
  // cups
  if (S.r() < 0.4) P.cyl('env_gloss', a + 0.1, 0.75, 0.84, d - 0.1, 0.04, [0.97, 0.97, 0.95]);
  return true;
}

function showcaseFood(S, P, a0, a1, d0, d1, foods) {
  P.box('env_gloss', a0, a1, 0, 0.85, d0, d1, [0.95, 0.94, 0.92]);
  P.box('env_glass_case', a0 + 0.02, a1 - 0.02, 0.85, 1.3, d0 + 0.02, d1 - 0.02, WHITE);
  P.qh('env_glow', a0 + 0.04, a1 - 0.04, d0 + 0.04, d1 - 0.04, 1.29, false, [2, 1.9, 1.7]);
  const n = Math.max(2, Math.floor((d1 - d0) / 0.22));
  for (let k = 0; k < n; k++) foodItem(S, P, foods[k % foods.length], (a0 + a1) / 2, 0.86, d0 + 0.12 + k * (d1 - d0 - 0.2) / n, 0.08);
}

// kissaten: Showa-era coffee house
INTERIOR.kissa = (S, c) => {
  const P = S.inner, W = S.W, r = S.r;
  const Dm = depthLimit(S);
  const velvet = [0.55, 0.08, 0.1], dark = [0.28, 0.16, 0.09];
  // counter at the back with siphons
  const cd = Dm - 2.2;
  if (S.solid(0.8, W - 1.8, cd, cd + 0.6, { pocket: 6 })) {
    P.box('env_wood', 0.8, W - 1.8, 0, 1.0, cd, cd + 0.6, dark);
    P.box('env_wood', 0.75, W - 1.75, 1.0, 1.05, cd - 0.05, cd + 0.6, [0.4, 0.24, 0.12]);
    for (let a = 1.2; a < W - 2.2; a += 0.6) {
      P.cyl('env_glass_case', a, 1.05, 1.35, cd + 0.3, 0.07, WHITE);
      P.geo('env_glass_case', 'sphere', a, 1.18, cd + 0.3, 0, 0.09, WHITE);
      P.geo('env_gloss', 'sphere', a, 1.15, cd + 0.3, 0, 0.07, [0.2, 0.1, 0.05]);
      P.cyl('env_glow', a, 1.05, 1.09, cd + 0.3, 0.04, [2.4, 1.2, 0.4]);
    }
    for (let a = 1.2; a < W - 2; a += 0.7) { chair(P, a, cd - 0.45, 0, [0.2, 0.15, 0.1], velvet); S.spot('seat', a, cd - 0.5, 0, 1); }
    S.spot('counter', W - 2.6, cd - 0.6, 0, 1); S.spot('staff', W / 2, cd + 1.2, 0, -1);
    // shelves of cups & bottles behind
    for (let k = 0; k < 3; k++) {
      P.box('env_wood', 0.8, W - 1.8, 1.4 + k * 0.38, 1.43 + k * 0.38, Dm - 0.35, Dm, dark);
      for (let a = 0.9; a < W - 1.9; a += 0.24) P.cyl('env_gloss', a, 1.43 + k * 0.38, 1.55 + k * 0.38, Dm - 0.18, 0.045, [[0.95, 0.93, 0.88], [0.3, 0.5, 0.35], [0.6, 0.3, 0.1]][(Math.floor(a * 7) + k) % 3], 'cyl6');
    }
  }
  // booths along one wall: velvet benches with tables
  for (let d = 1.4; d < cd - 1.6; d += 2.2) {
    if (S.solid(0, 1.6, d, d + 1.2, { pocket: 3 })) {
      P.box('env_matte', 0.05, 0.55, 0, 0.45, d, d + 1.2, velvet);
      P.box('env_matte', 0.05, 0.2, 0.45, 1.1, d, d + 1.2, velvet);
      P.box('env_wood', 0.65, 1.35, 0.7, 0.74, d + 0.15, d + 1.05, dark);
      P.cyl('env_metal', 1.0, 0, 0.7, d + 0.6, 0.04, [0.6, 0.5, 0.3]);
      P.geo('env_matte', 'chair_seat', 1.75, 0, d + 0.6, -Math.PI / 2, [1.1, 1, 1.1], velvet);
      // cream soda on the table
      if (r() < 0.6) foodItem(S, P, r() < 0.5 ? 'creamsoda' : 'coffee', 0.85, 0.74, d + 0.4, 0.08);
      S.spot('seat', 0.35, d + 0.6, 1, 0); S.spot('seat', 1.75, d + 0.6, -1, 0);
    }
  }
  // round tables on the other side
  for (let d = 1.6; d < cd - 1.4; d += 2.2) cafeTable(S, P, W - 1.3, d, dark, velvet, true);
  // stained glass panels (lit) on the side wall + warm lamps
  const colors = [[1.6, 0.5, 0.3], [0.4, 0.8, 1.6], [1.6, 1.3, 0.3], [0.5, 1.4, 0.6], [1.4, 0.4, 1.0]];
  for (let d = 1.0; d < cd - 0.5; d += 2.2) {
    for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) P.qa('env_glow', d + i * 0.4, d + i * 0.4 + 0.38, 1.3 + j * 0.3, 1.58 + j * 0.3, W - 0.03, -1, colors[(i * 3 + j + Math.floor(d)) % colors.length]);
    P.box('env_wood', W - 0.06, W - 0.02, 1.27, 2.52, d - 0.04, d + 1.22, dark);
  }
  for (let d = 2; d < Dm - 1; d += 2.4) {
    P.box('env_metal', W / 2 - 0.004, W / 2 + 0.004, 2.0, S.ceil, d - 0.004, d + 0.004, [0.2, 0.15, 0.1]);
    P.geo('env_glow', 'sphere', W / 2, 1.95, d, 0, [0.16, 0.12, 0.16], [2.2, 1.4, 0.7]);
  }
  S.light(W / 2, 2.2, Dm / 2, [1, 0.6, 0.35], 0.6, 6, 'lamp');
};

// coffee stand (small standing bar)
INTERIOR.stand = (S, c) => {
  const P = S.inner, W = S.W;
  const wood = [0.72, 0.55, 0.36];
  // shallow room: counter parallel to the front
  const cd = Math.min(3.3, S.D - 3);
  if (S.solid(0.8, W - 0.8, cd, cd + 0.6, { pocket: 99, force: false })) {
    P.box('env_wood', 0.8, W - 0.8, 0, 1.05, cd, cd + 0.6, wood);
    P.box('env_wood', 0.75, W - 0.75, 1.05, 1.1, cd - 0.08, cd + 0.6, [0.82, 0.66, 0.46]);
    S.spot('counter', W / 2, cd - 0.5, 0, 1); S.spot('staff', W / 2, cd + 1.1, 0, -1);
  }
  backOfHouse(S, P, Math.min(S.D, cd + 2.4));
  standingLedges(S, P, cd, wood);
  queuePoints(S, S.doorA0, S.doorA1, 4);
};

export function standingLedges(S, P, cd, wood) {
  const W = S.W;
  for (const side of [0, 1]) {
    const a0 = side ? W - 0.3 : 0, a1 = a0 + 0.3;
    P.box('env_wood', a0, a1, 1.05, 1.09, 0.6, cd - 0.3, wood);
    for (let d = 0.6; d < cd - 0.6; d += 0.8) P.box('env_metal', a0 + 0.1, a0 + 0.2, 0, 1.05, d, d + 0.03, [0.2, 0.2, 0.2]);
    for (let d = 1.0; d < cd - 0.4; d += 0.8) S.spot('seat', side ? W - 0.55 : 0.55, d, side ? 1 : -1, 0);
  }
}

// bakery
INTERIOR.bakery = (S, c) => {
  const P = S.inner, W = S.W;
  const Dm = Math.min(depthLimit(S), 12);
  if (S.D > Dm + 1.5) backOfHouse(S, P, Dm);
  const wood = [0.7, 0.52, 0.34];
  for (let d = 1.4; d < Dm - 2.8; d += 2.4) {
    for (let a = 1.2; a < W - 1.2; a += 2.6) {
      if (!S.solid(a - 0.55, a + 0.55, d, d + 1.0)) continue;
      P.box('env_wood', a - 0.55, a + 0.55, 0, 0.8, d, d + 1.0, wood);
      for (let k = 0; k < 4; k++) {
        const ta = a - 0.27 + (k % 2) * 0.54, td = d + 0.27 + Math.floor(k / 2) * 0.46;
        P.box('env_wood', ta - 0.24, ta + 0.24, 0.8, 0.84, td - 0.2, td + 0.2, [0.5, 0.35, 0.2]);
        const reg = S.R.food('bread');
        P.qh(reg.atlas.mat(reg), ta - 0.22, ta + 0.22, td - 0.18, td + 0.18, 0.842, true, WHITE, reg.atlas.uv(reg));
        for (let b = 0; b < 2; b++) P.geo('env_matte', 'blob', ta - 0.08 + b * 0.16, 0.87, td + (b % 2 - 0.5) * 0.12, b, [0.08, 0.045, 0.06], [0.75, 0.48, 0.2]);
      }
      const pr = S.R.label('焼きたて', '#c0392b', '#fff', 128, 48);
      P.tq(pr, a - 0.15, a + 0.15, 0.95, 1.06, d + 0.5, -1);
      P.box('env_metal', a - 0.005, a + 0.005, 0.84, 0.96, d + 0.5, d + 0.51, [0.6, 0.6, 0.6]);
      S.spot('browse', a, d - 0.45, 0, 1);
    }
  }
  // wall racks of bread
  if (S.solid(0, 0.45, 1.2, Dm - 2, { pocket: 4 })) shelfRun(S, P, { a: 0, d: 1.2, ra: 0, rd: 1, na: 1, nd: 0, len: Dm - 3.2, depth: 0.45, h: 1.8, kinds: ['bread'], levels: 4, frame: wood, rail: false });
  // register + tray station
  register(S, P, W / 2 - 1, W / 2 + 1, Dm - 1.6, Dm - 1.0, wood);
  if (S.solid(W / 2 - 1, W / 2 + 1, Dm - 1.6, Dm - 1.0, { pocket: 3 })) { S.spot('counter', W / 2, Dm - 2.2, 0, 1); S.spot('staff', W / 2, Dm - 0.5, 0, -1); }
  queuePoints(S, S.doorA0, S.doorA1, 2);
};

// sweets: case across the front, order from the corridor
INTERIOR.sweets = (S, c) => {
  const P = S.inner, W = S.W;
  const Dm = Math.min(S.D, 6);
  const foods = { 'Taiyaki Namba': ['bread'], 'Kakigōri Yuki': ['parfait'] }[S.b.en] || ['cake', 'wagashi', 'cake', 'parfait'];
  const ca0 = 0.4, ca1 = Math.max(1.2, Math.min(S.doorA1 - 1, W - 1.4));
  S.setDoor(Math.ceil(ca1 - 0.29), S.doorA1);
  if (S.solid(ca0, ca1, 0.55, 1.25, { pocket: 99 })) {
    P.box('env_gloss', ca0, ca1, 0, 0.85, 0.55, 1.25, [0.97, 0.96, 0.95]);
    P.box('env_glass_case', ca0 + 0.02, ca1 - 0.02, 0.85, 1.35, 0.57, 1.23, WHITE);
    P.qh('env_glow', ca0 + 0.04, ca1 - 0.04, 0.6, 1.2, 1.34, false, [2.1, 2.0, 1.85]);
    let k = 0;
    for (let a = ca0 + 0.15; a < ca1 - 0.1; a += 0.22, k++) {
      const f = foods[Math.floor(S.r() * foods.length)];
      const reg = S.R.food(f);
      P.qh(reg.atlas.mat(reg), a - 0.1, a + 0.1, 0.92, 1.12, 0.86, true, WHITE, reg.atlas.uv(reg));
      if (k % 3 === 0 && f !== 'wagashi' && f !== 'bread') foodItem(S, P, f, a, 0.86, 0.75, 0.07);
      else P.qh(reg.atlas.mat(reg), a - 0.1, a + 0.1, 0.65, 0.85, 0.86, true, WHITE, reg.atlas.uv(reg));
    }
    const nW = Math.floor((ca1 - ca0) / 0.9);
    for (let k = 0; k < Math.max(1, nW); k++) { const a = ca0 + 0.45 + k * 0.9; S.spot('counter', a, -0.4, 0, 1); S.spot('staff', a, 1.9, 0, -1); }
  }
  // back counter with gift boxes & a noren-like curtain to the kitchen
  if (S.solid(0.3, W - 0.3, Dm - 0.7, Dm, { pocket: 99 })) {
    P.box('env_wood', 0.3, W - 0.3, 0, 0.9, Dm - 0.7, Dm, [0.6, 0.45, 0.3]);
    for (let a = 0.5; a < W - 0.6; a += 0.4) P.box('env_matte', a, a + 0.32, 0.9, 0.9 + 0.08 + S.r() * 0.2, Dm - 0.6, Dm - 0.2, [[0.95, 0.9, 0.85], [0.8, 0.2, 0.25], [0.3, 0.5, 0.35]][Math.floor(S.r() * 3)]);
  }
  if (S.D > Dm + 1) backOfHouse(S, P, Dm);
  // menu on the bulkhead inside + POP on the case
  const pr = S.R.pop(Math.floor(S.r() * 8), MENU.sweets[0][1]);
  P.tq(pr, ca0 + 0.2, ca0 + 0.5, 1.36, 1.58, 0.56, -1);
  queuePoints(S, ca0, ca1, 4);
};

// takoyaki stand: griddle at the front + giant octopus
INTERIOR.takoyaki = (S, c) => {
  const P = S.inner, F = S.front, W = S.W;
  const ca0 = 0.4, ca1 = Math.max(1.2, Math.min(S.doorA1 - 1, W - 1.4));
  S.setDoor(Math.ceil(ca1 - 0.29), S.doorA1);
  if (S.solid(ca0, ca1, 0.4, 1.2, { pocket: 99 })) {
    P.box('env_metal', ca0, ca1, 0, 0.85, 0.4, 1.2, [0.7, 0.7, 0.72]);
    P.box('env_matte', ca0, ca1, 0, 0.85, 0.38, 0.4, K('#d6203a'));
    // griddle plates
    const reg = S.R.food('takoyaki');
    for (let a = ca0 + 0.1; a < ca1 - 0.6; a += 0.62) {
      P.box('env_metal', a, a + 0.56, 0.85, 0.92, 0.6, 1.1, [0.12, 0.12, 0.12]);
      P.qh(reg.atlas.mat(reg), a + 0.02, a + 0.54, 0.62, 1.08, 0.921, true, [0.9, 0.9, 0.9], reg.atlas.uv(reg));
    }
    S.spot('counter', (ca0 + ca1) / 2, -0.45, 0, 1); S.spot('staff', (ca0 + ca1) / 2, 1.7, 0, -1); S.spot('staff', ca0 + 0.6, 1.7, 0, -1);
  }
  // giant octopus on the bulkhead (Dotonbori style)
  const oa = W - 0.9, oy = S.doorTop + 0.05;
  if (S.outCeil > 2.9) {
    F.geo('env_gloss', 'sphere', oa, oy + 0.1, -0.35, 0, [0.42, 0.38, 0.36], K('#e0402a'));
    for (const e of [-0.15, 0.15]) { F.geo('env_gloss', 'sphere', oa + e, oy + 0.15, -0.68, 0, 0.09, [1, 1, 1]); F.geo('env_gloss', 'sphere', oa + e, oy + 0.15, -0.76, 0, 0.045, [0.05, 0.05, 0.05]); }
    F.geo('env_gloss', 'sphere', oa, oy + 0.42, -0.4, 0, [0.15, 0.06, 0.15], [1, 1, 1]);
    for (let k = 0; k < 4; k++) F.geo('env_gloss', 'cyl', oa - 0.3 + k * 0.2, oy - 0.45, -0.55, 0, [0.06, 0.4, 0.06], K('#e0402a'));
  }
  // menu panel above the counter + lanterns
  const mr = S.R.photoMenu('たこ焼き', MENU.takoyaki, ['takoyaki'], '#d6203a');
  P.tq(mr, ca0 + 0.2, ca0 + 0.2 + 0.75, 1.7, 2.7, 1.5, -1);
  const lr = S.R.lantern('たこ焼', '#c8231d');
  for (const la of [0.35, W - 0.35]) F.geo(lr.atlas.mat(lr), protoUV('lantern', lr), la, S.doorTop - 0.6, -0.3, 0, [0.38, 0.52, 0.38]);
  backOfHouse(S, P, Math.min(S.D, 3.2));
  // standing eat-in ledge on the corridor wall? keep queue
  queuePoints(S, ca0, ca1, 5);
};

// counter restaurants: ramen / udon / tendon / tempura / curry
INTERIOR.rcounter = (S, c) => {
  const P = S.inner, W = S.W, r = S.r;
  const Dm = depthLimit(S);
  const cat = S.b.cat;
  const wood = cat === 'tempura' ? [0.9, 0.78, 0.6] : [0.5, 0.33, 0.2];
  // L-shaped counter: along the back half, kitchen behind
  const right = r() < 0.5;
  const ka0 = right ? W - 2.2 : 0, ka1 = right ? W : 2.2;  // kitchen strip
  const ca0 = right ? W - 2.9 : 2.2, ca1 = ca0 + 0.7;       // counter strip
  const kd0 = 1.6, kd1 = Dm - 0.6;
  if (W >= 5 && S.solid(Math.min(ka0, ca0), Math.max(ka1, ca1), kd0, kd1, { pocket: 99 })) {
    // kitchen equipment (in the strip)
    P.box('env_metal', ka0 + 0.1, ka1 - 0.1, 0, 0.9, kd0 + 0.2, kd1 - 0.2, [0.72, 0.73, 0.75]);
    for (let d = kd0 + 0.6; d < kd1 - 0.6; d += 0.9) P.cyl('env_metal', (ka0 + ka1) / 2 + (right ? 0.3 : -0.3), 0.9, 1.4, d, 0.25, [0.78, 0.78, 0.8]);
    P.box('env_metal', ka0, ka1, 2.2, 2.6, kd0, kd1, [0.6, 0.6, 0.62]);   // hood
    // counter with stools
    P.box('env_wood', ca0, ca1, 0, 1.0, kd0, kd1, mix(wood, [0, 0, 0], 0.3));
    P.box('env_wood', ca0 - (right ? 0.15 : 0), ca1 + (right ? 0 : 0.15), 1.0, 1.05, kd0, kd1, wood);
    P.box('env_wood', ca0, ca1, 1.05, 1.25, kd0, kd1, mix(wood, [0, 0, 0], 0.2)); // raised ledge
    const sa = right ? ca0 - 0.45 : ca1 + 0.45;
    for (let d = kd0 + 0.4; d < kd1 - 0.3; d += 0.62) {
      stool(P, sa, d, cat === 'ramen' ? [0.7, 0.1, 0.1] : [0.25, 0.2, 0.15]);
      S.spot('seat', sa, d, right ? 1 : -1, 0);
      // bowl on the counter now and then
      if (r() < 0.35) foodItem(S, P, (SAMPLES[cat] || ['ramen'])[0], right ? ca0 + 0.12 : ca1 - 0.12, 1.05, d, 0.11);
      // water cups + condiments
      if (r() < 0.5) P.cyl('env_glass_case', right ? ca0 + 0.15 : ca1 - 0.15, 1.05, 1.15, d + 0.2, 0.035, WHITE);
    }
    for (let d = kd0 + 0.5; d < kd1; d += 1.3) S.spot('staff', (ka0 + ka1) / 2, d, right ? -1 : 1, 0);
    S.spot('counter', sa, kd0 - 0.2, 0, 1);
    // wall menu tanzaku above the kitchen
    const tz = S.R.tanzaku(cat);
    P.ta(tz, kd0, Math.min(kd1, kd0 + 4), 1.7, 2.5, right ? W - 0.03 : 0.03, right ? -1 : 1);
  }
  // tables on the other side
  const tA0 = right ? 0.5 : ca1 + 1.2, tA1 = right ? ca0 - 1.2 : W - 0.5;
  for (let d = 1.8; d < Dm - 1.2; d += 2.0) for (let a = tA0 + 0.35; a < tA1 - 0.3; a += 1.8) cafeTable(S, P, a, d, wood, [0.2, 0.15, 0.1]);
  // posters
  const pm = S.R.photoMenu('おすすめ ' + S.b.info.ja, MENU[cat] || MENU.ramen, SAMPLES[cat] || ['ramen'], S.st.accent);
  P.ta(pm, 1.2, 2.0, 1.2, 2.3, right ? 0.03 : W - 0.03, right ? 1 : -1);
  // noren to the kitchen at the back
  const nr = S.R.noren('厨房', null, '#1d2b4a', '#f5f1e8');
  P.tq(nr, (ka0 + ka1) / 2 - 0.5, (ka0 + ka1) / 2 + 0.5, 1.3, 2.1, Dm - 0.05, -1);
  if (S.light) S.light(W / 2, 2.4, Dm / 2, [1, 0.8, 0.6], 0.5, 6, 'down');
};

// sushi: straight counter with lit neta case
INTERIOR.sushi = (S, c) => {
  const P = S.inner, W = S.W;
  const Dm = depthLimit(S);
  const hinoki = [0.92, 0.82, 0.64];
  const cd = Math.min(Dm - 2.4, 5);
  if (S.solid(0.6, W - 0.6, cd, cd + 0.7, { pocket: 99 })) {
    P.box('env_wood', 0.6, W - 0.6, 0, 1.0, cd, cd + 0.7, mix(hinoki, [0, 0, 0], 0.15));
    P.box('env_wood', 0.5, W - 0.5, 1.0, 1.06, cd - 0.15, cd + 0.7, hinoki);
    P.box('env_glass_case', 0.8, W - 0.8, 1.06, 1.3, cd + 0.25, cd + 0.6, WHITE);
    P.qh('env_glow', 0.82, W - 0.82, cd + 0.27, cd + 0.58, 1.29, false, [2, 2, 2]);
    const reg = S.R.food('sushi');
    for (let a = 0.85; a < W - 1.2; a += 0.45) P.qh(reg.atlas.mat(reg), a, a + 0.4, cd + 0.28, cd + 0.56, 1.08, true, WHITE, reg.atlas.uv(reg));
    for (let a = 1.0; a < W - 0.9; a += 0.65) { stool(P, a, cd - 0.45, [0.3, 0.2, 0.12]); S.spot('seat', a, cd - 0.45, 0, 1); if (S.r() < 0.4) foodItem(S, P, 'sushi', a, 1.06, cd - 0.05, 0.1); }
    S.spot('staff', W / 2, cd + 1.2, 0, -1); S.spot('staff', W / 2 + 1.2, cd + 1.2, 0, -1);
    S.spot('counter', 0.7, cd - 0.6, 0, 1);
  }
  for (let d = 1.4; d < cd - 1.2; d += 1.9) for (let a = 1.0; a < W - 0.8; a += 1.9) cafeTable(S, P, a, d, hinoki, [0.25, 0.2, 0.15]);
  const tz = S.R.tanzaku('sushi');
  P.tq(tz, 0.6, Math.min(W - 0.6, 4.5), 1.6, 2.5, Dm - 0.03, -1);
};

// table restaurants: okonomiyaki / kushikatsu / tonkatsu / izakaya / yakiniku / omurice
INTERIOR.rtable = (S, c) => {
  const P = S.inner, W = S.W, r = S.r, cat = S.b.cat;
  const Dm = depthLimit(S);
  const wood = cat === 'izakaya' || cat === 'yakiniku' ? [0.38, 0.24, 0.13] : [0.6, 0.45, 0.3];
  const seat = cat === 'omurice' ? [0.55, 0.15, 0.1] : [0.22, 0.15, 0.1];
  // kitchen pass at the back
  const kd = Dm - 2.2;
  if (S.solid(0.4, W - 0.4, kd, kd + 0.6, { pocket: 99 })) {
    P.box('env_wood', 0.4, W - 0.4, 0, 1.0, kd, kd + 0.6, wood);
    P.box('env_wood', 0.35, W - 0.35, 1.0, 1.05, kd - 0.05, kd + 0.6, mix(wood, [1, 1, 1], 0.15));
    for (let a = 1; a < W - 1; a += 1.4) S.spot('staff', a, kd + 1.1, 0, -1);
    S.spot('counter', 1.0, kd - 0.5, 0, 1);
    // sake bottles / beer crates
    const bt = S.R.prod('bottles', 1);
    for (let a = 0.6; a < W - 1.8; a += 1.2) P.tq(bt, a, a + 1.15, 1.05, 1.35, kd + 0.3, -1);
  }
  // tables of four
  for (let d = 1.6; d < kd - 1.4; d += 2.4) {
    for (let a = 1.3; a < W - 1.0; a += 2.6) {
      if (!S.solid(a - 0.6, a + 0.6, d - 0.38, d + 0.38)) continue;
      P.box('env_wood', a - 0.6, a + 0.6, 0.7, 0.74, d - 0.38, d + 0.38, wood);
      P.box('env_wood', a - 0.05, a + 0.05, 0, 0.7, d - 0.05, d + 0.05, [0.15, 0.15, 0.15]);
      if (c.teppan) P.box('env_metal', a - 0.45, a + 0.45, 0.74, 0.76, d - 0.28, d + 0.28, [0.1, 0.1, 0.1]);
      if (c.grill) {
        P.cyl('env_metal', a, 0.74, 0.8, d, 0.22, [0.15, 0.15, 0.15]);
        P.cyl('env_glow', a, 0.8, 0.805, d, 0.16, [2.2, 0.7, 0.2]);
        P.cyl('env_metal', a, 1.55, S.ceil, d, 0.08, [0.6, 0.6, 0.62]);   // extraction duct
        P.cyl('env_metal', a, 1.45, 1.6, d, 0.24, [0.7, 0.7, 0.72]);
      }
      if (c.teppan || r() < 0.4) {
        const f = (SAMPLES[cat] || ['salad'])[Math.floor(r() * 2)];
        foodItem(S, P, f, a - 0.2, c.teppan ? 0.76 : 0.74, d, 0.12);
      }
      for (const [oa, od, rot] of [[-0.3, -0.62, 0], [0.3, -0.62, 0], [-0.3, 0.62, Math.PI], [0.3, 0.62, Math.PI]]) {
        chair(P, a + oa, d + od, rot, [0.15, 0.12, 0.1], seat);
        S.spot('seat', a + oa, d + od, 0, od < 0 ? 1 : -1);
      }
    }
  }
  // izakaya: wooden partitions + tanzaku menus + lanterns inside
  const tz = S.R.tanzaku(cat);
  P.ta(tz, 1.0, Math.min(kd - 0.5, 5), 1.6, 2.5, 0.03, 1);
  if (cat === 'izakaya' || cat === 'kushikatsu') {
    const lr = S.R.lantern(cat === 'izakaya' ? '酒' : '串', '#c8231d');
    for (let d = 1.5; d < kd; d += 2.4) P.geo(lr.atlas.mat(lr), protoUV('lantern', lr), W / 2, S.ceil - 0.75, d, 0, [0.32, 0.45, 0.32]);
    const pr = S.R.label('二度づけ禁止', '#ffffff', '#c00000', 256, 64);
    if (cat === 'kushikatsu') P.ta(pr, 2, 3, 2.0, 2.25, W - 0.03, -1);
  }
  if (cat === 'yakiniku' || cat === 'izakaya') S.light(W / 2, 2.2, Dm / 2, [1, 0.6, 0.35], 0.6, 6, 'lamp');
  const pm = S.R.photoMenu('おすすめ ' + S.b.info.ja, MENU[cat] || MENU.izakaya, SAMPLES[cat] || ['salad'], S.st.accent);
  P.ta(pm, 1.2, 2.0, 1.2, 2.3, W - 0.03, -1);
};

INTERIOR.retail = INTERIOR.drug;
