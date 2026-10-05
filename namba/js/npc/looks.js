// =============================================================================
// Appearance: archetype -> body proportions, clothing colours, accessories.
// Colours are packed 0xRRGGBB integers (exact in a float32 instance attribute).
// Palette: Osaka on a sunny October weekday — lots of black, navy, grey,
// beige, white; autumn layers (trench coats, cardigans); dark suits with white
// shirts; navy/black school uniforms; a few colour accents; face masks.
// =============================================================================

// accessory / variant bit flags (instance attribute iLook.z, bits 0..23)
export const BIT = {
  BRIEFCASE: 0, SHOULDERBAG: 1, BACKPACK: 2, SUITCASE: 3, SHOPBAG: 4, PHONE: 5,
  UMBRELLA: 6, CART: 7, CAP: 8, APRON: 9, TOTE: 10, SHOPBAG2: 11, CUP: 12,
  // 13..15: hair style (0 short, 1 bob, 2 long, 3 bun, 4 cropped)
  SKIRT: 16, JACKET: 17, TIGHTS: 18, MASK: 19, TIE: 20, COAT: 21, KID: 22, GLASSES: 23,
};
export const HAIR_SHIFT = 13;

const W = (list) => { const tot = list.reduce((a, x) => a + x[1], 0); return (r) => { let v = r() * tot; for (const [c, w] of list) { v -= w; if (v <= 0) return c; } return list[0][0]; }; };

const SKIN_JP = W([[0xe8c8ae, 2], [0xe0bb9c, 3], [0xd6ae8e, 3], [0xcba184, 2], [0xc09577, 1], [0xeed2bd, 1]]);
const SKIN_TOUR = W([[0xf0d4c2, 3], [0xe6bfa4, 2], [0xd8ab88, 2], [0xc08d68, 2], [0x9a6a4a, 1.5], [0x74492f, 1.2], [0x553524, 0.8], [0xe2c0a2, 2]]);
const HAIR_JP = W([[0x15110f, 6], [0x1d1714, 5], [0x261c16, 4], [0x33261c, 3], [0x47321f, 2], [0x5e4329, 1.2], [0x7a5838, 0.6], [0x93734f, 0.3]]);
const HAIR_GREY = W([[0x8e8b86, 2], [0xa9a6a1, 2], [0xc7c4bf, 1.5], [0x6f6c68, 1.5], [0x4a4744, 1]]);
const HAIR_TOUR = W([[0x1b1612, 3], [0x3a2a1e, 3], [0x5b4130, 2], [0x8a6a48, 1.5], [0xb8935c, 1.2], [0xd6bb88, 0.8], [0x7a3a20, 0.4], [0x9a9894, 0.5]]);
const SUIT = W([[0x1a1b1f, 5], [0x202329, 3], [0x1c2332, 4], [0x2a2d33, 2], [0x383b40, 1.5], [0x252a36, 2], [0x4a4c50, 0.6]]);
const SHIRT = W([[0xedebe6, 6], [0xf4f4f1, 3], [0xdde4ec, 2], [0xc9d6e4, 1.5], [0xe8e2d6, 1]]);
const TIE = W([[0x1e2c58, 3], [0x5e1c22, 2], [0x2a3828, 1], [0x47474c, 2], [0x6e5f36, 1], [0x1f3a64, 2], [0x2d2d33, 2]]);
const TOP = W([[0x19191b, 7], [0xe9e7e1, 5], [0x8b8a87, 2.5], [0x38383b, 3], [0x222838, 3], [0xc9b79b, 3.5], [0xa6845a, 2], [0xe6dcc6, 2.5],
  [0x5c5e3d, 1], [0x5d4533, 1.2], [0xc39b97, 1], [0x97a389, 1], [0xa6bad0, 1], [0xc0993a, 0.5], [0x672531, 0.5], [0x2f4a6b, 0.8], [0xb8b2a6, 1.5], [0x7c2d2a, 0.3]]);
const BOTTOM = W([[0x17171a, 6], [0x1e2333, 2.5], [0x323236, 2.5], [0xb6a588, 2], [0x3a4965, 2.5], [0x6b7f9d, 1], [0x76767a, 1], [0x4d3a2b, 1], [0xdddbd5, 0.5], [0x877b5a, 1]]);
const SKIRT_C = W([[0x17171a, 4], [0x1e2333, 2], [0xc4b294, 3], [0x6f6f72, 1.5], [0x5a4433, 1.5], [0xa98458, 1.5], [0x5b5e3e, 1], [0xe4dcc8, 1.5], [0x8c3b3b, 0.3]]);
const SHOES = W([[0x111112, 6], [0xe6e6e2, 4], [0x47301f, 2], [0x67676a, 1], [0xb7a386, 1], [0x262b3a, 1]]);
const COAT = W([[0xbca47c, 4], [0x9e784c, 2], [0x1b1b1d, 3], [0x232a3a, 2], [0x6f6f72, 1.5], [0x8a7f61, 1.5], [0xd9d2c2, 1]]);
const BAG = W([[0x141414, 6], [0x5a3b26, 2], [0x9a6e44, 1.2], [0x22283a, 1], [0xc8b598, 1], [0x6a6a6c, 0.8], [0xe6e0d4, 0.6]]);
const CASE = W([[0xb3b7bb, 3], [0x1a1a1c, 3], [0x1f2a44, 1.5], [0x9b2c2c, 0.8], [0xdcdcd8, 1.2], [0x86a5c6, 1], [0x9fcab8, 0.6], [0xd8a2aa, 0.8], [0xd6b343, 0.6]]);
const SHOPBAG = W([[0xf1efe9, 4], [0xae8a5f, 3], [0x1a1a1a, 2], [0x24304e, 1], [0xe8c8cc, 1], [0x2f5a3a, 0.6], [0xe08a2a, 0.5], [0xc32c3c, 0.4]]);
const KNIT = W([[0xd9cdb6, 2], [0x8a8a86, 1.5], [0x2b2b2e, 2], [0x6a4a36, 1], [0x94a08a, 0.8], [0xc4a0a0, 0.8], [0x2a3550, 1]]);

const hairBits = (s) => (s & 7) << 13;

// Returns { h, build, flags, colA: [top, bottom, shoes, hair], colB: [skin, inner, acc, acc2] }
export function makeLook(kind, r, o = {}) {
  let flags = 0;
  const set = (b) => { flags |= (1 << b); };
  const female = o.female != null ? o.female : r() < 0.5;
  let h = female ? 0.93 + r() * 0.08 : 0.98 + r() * 0.09; // relative to 1.70 m
  let build = female ? 0.9 + r() * 0.1 : 0.98 + r() * 0.14;
  let skin = SKIN_JP(r), hair = HAIR_JP(r), top = TOP(r), bottom = BOTTOM(r), shoes = SHOES(r), inner = SHIRT(r), acc = BAG(r), acc2 = TIE(r);
  let hs = female ? (r() < 0.45 ? 2 : r() < 0.6 ? 1 : 3) : (r() < 0.9 ? 0 : 4);
  if (r() < (kind === 'tourist' ? 0.04 : 0.17)) set(BIT.MASK);
  if (r() < 0.12) set(BIT.GLASSES);
  switch (kind) {
    case 'commuter': {
      // salaryman / office worker
      if (!female) {
        top = SUIT(r); bottom = r() < 0.85 ? top : SUIT(r); inner = SHIRT(r); set(BIT.JACKET);
        if (r() < 0.55) { set(BIT.TIE); acc2 = TIE(r); }
        shoes = r() < 0.9 ? 0x111112 : 0x3a2618;
        acc = r() < 0.8 ? 0x141414 : 0x4a3222;
        if (r() < 0.6) set(BIT.BRIEFCASE); else if (r() < 0.6) set(BIT.BACKPACK); else set(BIT.SHOULDERBAG);
        if (r() < 0.12) { set(BIT.COAT); top = COAT(r); }
        hs = r() < 0.92 ? 0 : 4;
      } else {
        top = r() < 0.7 ? SUIT(r) : TOP(r); inner = SHIRT(r); set(BIT.JACKET);
        if (r() < 0.45) { set(BIT.SKIRT); bottom = r() < 0.7 ? top : SKIRT_C(r); if (r() < 0.6) set(BIT.TIGHTS); } else bottom = r() < 0.7 ? top : BOTTOM(r);
        shoes = r() < 0.8 ? 0x111112 : 0x47301f;
        acc = BAG(r); if (r() < 0.7) set(BIT.TOTE); else set(BIT.SHOULDERBAG);
        if (r() < 0.15) { set(BIT.COAT); top = COAT(r); }
        hs = r() < 0.5 ? 3 : r() < 0.6 ? 1 : 2;
      }
      break;
    }
    case 'student': {
      h *= 0.97;
      const gakuran = !female && r() < 0.35;
      top = gakuran ? 0x141518 : (r() < 0.75 ? 0x1c2236 : 0x2a2a30); inner = 0xf0f0ec; set(BIT.JACKET);
      if (female) { set(BIT.SKIRT); bottom = r() < 0.6 ? 0x1e2438 : 0x50535a; if (r() < 0.5) set(BIT.TIGHTS); acc2 = r() < 0.5 ? 0x8c2430 : 0x1e2c58; set(BIT.TIE); }
      else { bottom = gakuran ? 0x141518 : (r() < 0.6 ? 0x22262f : 0x3e4048); if (!gakuran && r() < 0.6) { set(BIT.TIE); acc2 = 0x1e2c58; } }
      if (gakuran) { flags &= ~(1 << BIT.JACKET); }
      shoes = r() < 0.6 ? 0x2a1c14 : 0xe8e8e4;
      acc = r() < 0.6 ? 0x141414 : 0x1e2433;
      if (r() < 0.5) set(BIT.BACKPACK); else set(BIT.BRIEFCASE);
      if (r() < 0.25) { top = KNIT(r); flags &= ~(1 << BIT.JACKET); }
      break;
    }
    case 'tourist': {
      skin = r() < 0.55 ? SKIN_TOUR(r) : SKIN_JP(r);
      hair = r() < 0.5 ? HAIR_TOUR(r) : HAIR_JP(r);
      h *= 1.0 + r() * 0.05;
      top = TOP(r); bottom = BOTTOM(r); shoes = r() < 0.6 ? 0xe6e6e2 : SHOES(r);
      if (female && r() < 0.25) { set(BIT.SKIRT); bottom = SKIRT_C(r); }
      acc = BAG(r);
      if (o.suitcase) { set(BIT.SUITCASE); acc2 = CASE(r); }
      if (r() < 0.55) set(BIT.BACKPACK); else if (r() < 0.5) set(BIT.SHOULDERBAG);
      if (r() < 0.3) set(BIT.CAP), acc2 = o.suitcase ? acc2 : TOP(r);
      if (r() < 0.2) set(BIT.SHOPBAG), acc2 = o.suitcase ? acc2 : SHOPBAG(r);
      break;
    }
    case 'shopper': {
      top = r() < 0.35 ? KNIT(r) : TOP(r); bottom = BOTTOM(r);
      if (female && r() < 0.5) { set(BIT.SKIRT); bottom = SKIRT_C(r); if (r() < 0.3) set(BIT.TIGHTS); }
      if (r() < 0.22) { set(BIT.COAT); top = COAT(r); inner = TOP(r); }
      else if (r() < 0.25) { set(BIT.JACKET); inner = TOP(r); top = r() < 0.5 ? COAT(r) : TOP(r); }
      acc = BAG(r);
      if (female) { if (r() < 0.6) set(BIT.TOTE); else set(BIT.SHOULDERBAG); } else if (r() < 0.5) set(BIT.SHOULDERBAG); else if (r() < 0.4) set(BIT.BACKPACK);
      if (r() < (o.bags != null ? o.bags : 0.35)) { set(BIT.SHOPBAG); acc2 = SHOPBAG(r); if (r() < 0.3) set(BIT.SHOPBAG2); }
      break;
    }
    case 'elderly': {
      h *= 0.95; hair = HAIR_GREY(r); hs = female ? (r() < 0.7 ? 1 : 3) : (r() < 0.6 ? 0 : 4);
      top = r() < 0.5 ? KNIT(r) : COAT(r); bottom = r() < 0.5 ? 0x3b3a38 : BOTTOM(r);
      if (female && r() < 0.35) { set(BIT.SKIRT); bottom = SKIRT_C(r); }
      if (r() < 0.3) { set(BIT.CAP); acc2 = r() < 0.5 ? 0x8a7d66 : 0x2e2e30; }
      shoes = r() < 0.6 ? 0x2a2420 : 0x6e6a64;
      acc = BAG(r); if (r() < 0.6) set(BIT.SHOULDERBAG); else if (r() < 0.4) { set(BIT.SHOPBAG); acc2 = SHOPBAG(r); }
      if (r() < 0.35) set(BIT.MASK);
      break;
    }
    case 'child': {
      h = 0.58 + r() * 0.2; build = 0.85; set(BIT.KID);
      top = r() < 0.5 ? TOP(r) : [0xd84a3a, 0x3a7ad8, 0xe0c040, 0x5aa05a, 0xf0a0b0, 0x2a2a2e][Math.floor(r() * 6)];
      bottom = r() < 0.5 ? 0x22283a : BOTTOM(r);
      if (female && r() < 0.5) { set(BIT.SKIRT); bottom = SKIRT_C(r); }
      if (r() < 0.4) { set(BIT.BACKPACK); acc = r() < 0.5 ? 0xb02a2a : 0x1a1a1a; }
      if (r() < 0.4) { set(BIT.CAP); acc2 = [0xe0c030, 0x2a5ab0, 0xd04040, 0xf0f0f0][Math.floor(r() * 4)]; }
      hs = female ? (r() < 0.5 ? 1 : 2) : 0;
      flags &= ~(1 << BIT.MASK); flags &= ~(1 << BIT.GLASSES);
      break;
    }
    case 'staff_station': {
      top = 0x1c2640; bottom = 0x1c2640; inner = 0xcad8e8; set(BIT.JACKET); set(BIT.TIE); acc2 = 0x1c2640; set(BIT.CAP);
      shoes = 0x111112; hs = female ? 3 : 0; flags &= ~(1 << BIT.SKIRT);
      break;
    }
    case 'staff_shop': {
      top = r() < 0.6 ? 0x19191b : TOP(r); bottom = r() < 0.7 ? 0x19191b : BOTTOM(r); shoes = 0x111112;
      set(BIT.APRON); acc2 = W([[0x1a1a1a, 3], [0x5a3b26, 2], [0x2f4a36, 1.5], [0x22283a, 1.5], [0xc9b79b, 1.5], [0x8c2430, 0.5]])(r);
      if (o.cap) { set(BIT.CAP); }
      hs = female ? 3 : 0;
      break;
    }
    case 'cleaner': {
      top = r() < 0.5 ? 0x8fb0c6 : 0xc9a2b0; bottom = r() < 0.6 ? 0x2a3040 : top; inner = 0xf0f0ec; shoes = 0xe8e8e4;
      set(BIT.CAP); acc2 = top; set(BIT.CART); acc = 0xd8c040; h *= 0.96;
      if (r() < 0.6) { hair = HAIR_GREY(r); }
      hs = female ? 3 : 0;
      break;
    }
    case 'security': {
      top = 0x3b4658; bottom = 0x2a3040; inner = 0xdde4ec; set(BIT.JACKET); set(BIT.TIE); acc2 = 0x1b2232; set(BIT.CAP); shoes = 0x111112; hs = 0;
      break;
    }
    default: break;
  }
  flags |= hairBits(hs);
  if (o.phone) set(BIT.PHONE);
  if (o.umbrella) set(BIT.UMBRELLA);
  return { h, build, flags, female, colA: [top, bottom, shoes, hair], colB: [skin, inner, acc, acc2] };
}

export function hasBit(flags, b) { return (flags >> b) & 1; }
