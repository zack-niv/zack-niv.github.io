// Procedural canvas textures for the outdoors (cached per ctx.materials).
//   strata(ctx)   -> { map, bump }  near-white layered stone (multiplied by band vertex colours)
//   foliage(ctx)  -> atlas 4x2 tiles (alpha): see FOLIAGE_TILES
//   bark(ctx), groundcover(ctx), paving(ctx), deck(ctx), water normals...
import * as THREE from 'three';
import { rng } from '../../core/rng.js';

export const FOLIAGE_TILES = { broad: 0, autumn: 1, shrub: 2, ginkgo: 3, narrow: 4, grass: 5, flower: 6, pine: 7 };
export function tileUV(tile) { const c = tile % 4, r = (tile / 4) | 0; return [c / 4, 1 - (r + 1) / 2, (c + 1) / 4, 1 - r / 2]; } // u0,v0,u1,v1

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function tex(c, { srgb = true, repeat = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}
const cache = (ctx, name, f) => ctx.materials.texture('outdoor_' + name, f);

// ---------------------------------------------------------------------------
export function strata(ctx) {
  return cache(ctx, 'strata', () => {
    const S = 512, c = canvas(S, S), g = c.getContext('2d');
    const b = canvas(S, S), gb = b.getContext('2d');
    const R = rng(77);
    const img = g.createImageData(S, S), bi = gb.createImageData(S, S);
    // layer table (rows)
    const rowL = new Float32Array(S), rowB = new Float32Array(S), rowW = new Float32Array(S), rowLayer = new Int32Array(S);
    let y = 0, li = 0;
    const layers = [];
    while (y < S) {
      let th = Math.round(R.range(5, 46));
      if (y + th > S - 4) th = S - y;
      const L = { l: R.range(0.8, 1.06), w: R.range(-0.04, 0.05), joint: R.range(40, 170), off: R.range(0, 200), rough: R.range(0.02, 0.09), groove: R.chance(0.45) };
      layers.push(L);
      for (let k = 0; k < th; k++) { rowL[y + k] = L.l; rowW[y + k] = L.w; rowLayer[y + k] = li; rowB[y + k] = (L.groove && (k === 0 || k === 1)) ? 0.55 : 1; }
      y += th; li++;
    }
    const n2 = new Float32Array(S * S);
    for (let i = 0; i < S * S; i++) n2[i] = R();
    for (let yy = 0; yy < S; yy++) {
      const L = layers[rowLayer[yy]];
      const streak = 0.96 + 0.08 * Math.sin(yy * 1.7 + rowLayer[yy] * 3.1) * R.range(0.3, 1);
      for (let xx = 0; xx < S; xx++) {
        const i = yy * S + xx;
        const grain = (n2[i] - 0.5) * L.rough * 2 + (n2[(yy * S + ((xx * 7) % S))] - 0.5) * 0.03;
        let v = rowL[yy] * streak + grain;
        // vertical joints
        const jp = (xx + L.off) % L.joint;
        let bump = rowB[yy];
        if (jp < 1.2) { v *= 0.8; bump = Math.min(bump, 0.6); }
        // weathering: faint vertical streaks
        v *= 1 - 0.05 * Math.max(0, Math.sin(xx * 0.09 + Math.sin(xx * 0.013) * 4) - 0.6);
        if (rowB[yy] < 1) v *= 0.72;
        const w = rowW[yy];
        img.data[i * 4] = Math.max(0, Math.min(255, 255 * v * (1 + w)));
        img.data[i * 4 + 1] = Math.max(0, Math.min(255, 255 * v));
        img.data[i * 4 + 2] = Math.max(0, Math.min(255, 255 * v * (1 - w * 1.2)));
        img.data[i * 4 + 3] = 255;
        const bv = 255 * Math.max(0, Math.min(1, bump * (0.9 + (n2[i] - 0.5) * 0.15)));
        bi.data[i * 4] = bi.data[i * 4 + 1] = bi.data[i * 4 + 2] = bv; bi.data[i * 4 + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0); gb.putImageData(bi, 0, 0);
    return { map: tex(c), bump: tex(b, { srgb: false }) };
  });
}

// ---------------------------------------------------------------------------
// Foliage atlas: 2048x1024, 4x2 tiles of 512.
export function foliage(ctx) {
  return cache(ctx, 'foliage', () => {
    const T = 512, c = canvas(T * 4, T * 2), g = c.getContext('2d');
    const R = rng(4242);
    const tileXY = (t) => [(t % 4) * T, ((t / 4) | 0) * T];
    const hsl = (h, s, l, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;
    const leaf = (x, y, len, wid, ang, col, vein) => {
      g.save(); g.translate(x, y); g.rotate(ang);
      g.beginPath(); g.moveTo(0, 0);
      g.quadraticCurveTo(wid, len * 0.45, 0, len); g.quadraticCurveTo(-wid, len * 0.45, 0, 0);
      g.fillStyle = col; g.fill();
      if (vein) { g.strokeStyle = vein; g.lineWidth = 1; g.beginPath(); g.moveTo(0, 0); g.lineTo(0, len * 0.9); g.stroke(); }
      g.restore();
    };
    // cluster of leaves on twigs, filling a rough disc
    const cluster = (t, n, palette, len, wid, opts = {}) => {
      const [ox, oy] = tileXY(t);
      g.save(); g.beginPath(); g.rect(ox, oy, T, T); g.clip();
      // twigs
      g.strokeStyle = 'rgba(70,52,36,0.9)'; g.lineWidth = 3;
      for (let k = 0; k < 7; k++) {
        const a = R.range(0, Math.PI * 2);
        g.beginPath(); g.moveTo(ox + T / 2, oy + T / 2); g.lineTo(ox + T / 2 + Math.cos(a) * T * 0.38, oy + T / 2 + Math.sin(a) * T * 0.38); g.stroke();
      }
      for (let k = 0; k < n; k++) {
        const r = Math.pow(R(), 0.6) * T * (opts.rad || 0.42), a = R.range(0, Math.PI * 2);
        const x = ox + T / 2 + Math.cos(a) * r, y = oy + T / 2 + Math.sin(a) * r * (opts.squash || 1);
        const p = R.pick(palette);
        const shade = (1 - r / (T * 0.5)) * -8 + R.range(-6, 6);
        leaf(x, y, len * R.range(0.7, 1.2), wid * R.range(0.7, 1.2), a + R.range(-0.9, 0.9) + Math.PI / 2, hsl(p[0] + R.range(-4, 4), p[1], Math.max(8, p[2] + shade)), hsl(p[0], p[1], p[2] + 12, 0.35));
      }
      g.restore();
    };
    const G = [[95, 45, 26], [100, 50, 30], [88, 42, 34], [105, 38, 22], [80, 45, 38]];
    cluster(FOLIAGE_TILES.broad, 520, G, 46, 18);
    cluster(FOLIAGE_TILES.autumn, 520, [[95, 45, 28], [70, 55, 38], [45, 75, 45], [30, 80, 42], [12, 70, 40], [90, 40, 30], [52, 70, 48]], 44, 18);
    cluster(FOLIAGE_TILES.shrub, 1100, [[110, 45, 22], [100, 50, 26], [120, 35, 30], [95, 55, 20]], 22, 10, { rad: 0.46 });
    // ginkgo fans
    {
      const [ox, oy] = tileXY(FOLIAGE_TILES.ginkgo);
      g.save(); g.beginPath(); g.rect(ox, oy, T, T); g.clip();
      for (let k = 0; k < 340; k++) {
        const r = Math.pow(R(), 0.6) * T * 0.42, a = R.range(0, Math.PI * 2);
        const x = ox + T / 2 + Math.cos(a) * r, y = oy + T / 2 + Math.sin(a) * r;
        const hue = R.chance(0.18) ? R.range(48, 58) : R.range(72, 92);
        g.save(); g.translate(x, y); g.rotate(R.range(0, Math.PI * 2));
        g.fillStyle = hsl(hue, 55, R.range(30, 42));
        g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, R.range(18, 26), -2.2, -0.9); g.closePath(); g.fill();
        g.restore();
      }
      g.restore();
    }
    // narrow leaves (bamboo / willow-ish)
    cluster(FOLIAGE_TILES.narrow, 380, [[85, 45, 32], [92, 40, 28], [78, 50, 40]], 70, 7);
    // grass blades
    {
      const [ox, oy] = tileXY(FOLIAGE_TILES.grass);
      for (let k = 0; k < 260; k++) {
        const x = ox + R.range(20, T - 20), h = R.range(0.45, 0.95) * T, bend = R.range(-60, 60);
        const hue = R.chance(0.2) ? R.range(40, 55) : R.range(70, 100);
        g.strokeStyle = hsl(hue, R.range(30, 50), R.range(25, 48)); g.lineWidth = R.range(2, 5);
        g.beginPath(); g.moveTo(x, oy + T); g.quadraticCurveTo(x + bend * 0.3, oy + T - h * 0.6, x + bend, oy + T - h); g.stroke();
      }
      // miscanthus plumes
      for (let k = 0; k < 14; k++) {
        const x = ox + R.range(60, T - 60), y = oy + R.range(20, 140);
        g.fillStyle = hsla(R.range(30, 40), 30, 78, 0.85);
        for (let j = 0; j < 30; j++) { g.beginPath(); g.ellipse(x + R.range(-10, 10) + j * 0.6, y + j * 3, 3, 8, R.range(-0.5, 0.5), 0, 7); g.fill(); }
      }
    }
    function hsla(h, s, l, a) { return hsl(h, s, l, a); }
    // flowers: cosmos & small blooms on stems, leaves at the bottom
    {
      const [ox, oy] = tileXY(FOLIAGE_TILES.flower);
      for (let k = 0; k < 90; k++) {
        const x = ox + R.range(20, T - 20), top = oy + R.range(40, T * 0.6);
        g.strokeStyle = hsl(100, 40, 30); g.lineWidth = 2;
        g.beginPath(); g.moveTo(x, oy + T); g.quadraticCurveTo(x + R.range(-30, 30), (top + oy + T) / 2, x + R.range(-12, 12), top); g.stroke();
      }
      for (let k = 0; k < 160; k++) leaf(ox + R.range(10, T - 10), oy + T - R.range(0, 140), 34, 7, R.range(-2.6, -0.5), hsl(105, 40, R.range(22, 34)));
      const pal = [[330, 70, 72], [335, 65, 55], [0, 0, 95], [300, 45, 60], [45, 90, 58], [15, 85, 55]];
      for (let k = 0; k < 75; k++) {
        const x = ox + R.range(30, T - 30), y = oy + R.range(40, T * 0.62);
        const p = R.pick(pal), rr = R.range(12, 22);
        for (let pi = 0; pi < 8; pi++) { const a = pi / 8 * Math.PI * 2; g.fillStyle = hsl(p[0], p[1], p[2] + R.range(-6, 6)); g.beginPath(); g.ellipse(x + Math.cos(a) * rr * 0.55, y + Math.sin(a) * rr * 0.55, rr * 0.5, rr * 0.25, a, 0, 7); g.fill(); }
        g.fillStyle = hsl(48, 90, 50); g.beginPath(); g.arc(x, y, rr * 0.22, 0, 7); g.fill();
      }
    }
    // pine needles (tufts)
    {
      const [ox, oy] = tileXY(FOLIAGE_TILES.pine);
      g.save(); g.beginPath(); g.rect(ox, oy, T, T); g.clip();
      for (let k = 0; k < 90; k++) {
        const r = Math.pow(R(), 0.7) * T * 0.4, a = R.range(0, Math.PI * 2);
        const x = ox + T / 2 + Math.cos(a) * r, y = oy + T / 2 + Math.sin(a) * r * 0.6;
        for (let j = 0; j < 26; j++) {
          const b = R.range(0, Math.PI * 2), l = R.range(18, 34);
          g.strokeStyle = hsl(R.range(115, 135), 35, R.range(16, 28)); g.lineWidth = 1.6;
          g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(b) * l, y + Math.sin(b) * l * 0.7); g.stroke();
        }
      }
      g.restore();
    }
    const t = tex(c, { repeat: false });
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}

// ---------------------------------------------------------------------------
export function bark(ctx) {
  return cache(ctx, 'bark', () => {
    const W = 128, H = 256, c = canvas(W, H), g = c.getContext('2d');
    const R = rng(9);
    g.fillStyle = '#6b5d50'; g.fillRect(0, 0, W, H);
    for (let k = 0; k < 220; k++) {
      const x = R.range(0, W), w = R.range(1, 4), l = R.range(10, 60), y = R.range(0, H);
      g.fillStyle = `rgba(${R.chance(0.5) ? '40,32,26' : '150,140,125'},${R.range(0.15, 0.5)})`;
      g.fillRect(x, y, w, l);
    }
    return tex(c);
  });
}

// generic noisy surface (tinted by material colour)
function noiseTex(ctx, name, size, seed, draw) {
  return cache(ctx, name, () => { const c = canvas(size, size), g = c.getContext('2d'); draw(g, size, rng(seed)); return tex(c); });
}

export function groundcover(ctx) {
  return noiseTex(ctx, 'groundcover', 512, 31, (g, S, R) => {
    g.fillStyle = '#3d4f22'; g.fillRect(0, 0, S, S);
    for (let k = 0; k < 9000; k++) {
      const x = R.range(0, S), y = R.range(0, S), r = R.range(1.5, 5);
      const l = R.range(14, 34), h = R.chance(0.08) ? R.range(30, 45) : R.range(75, 110);
      g.fillStyle = `hsl(${h},${R.range(25, 50)}%,${l}%)`;
      g.beginPath(); g.ellipse(x, y, r, r * 0.6, R.range(0, 3), 0, 7); g.fill();
    }
    for (let k = 0; k < 500; k++) { g.fillStyle = `rgba(60,42,28,${R.range(0.2, 0.6)})`; g.fillRect(R.range(0, S), R.range(0, S), R.range(2, 6), R.range(2, 6)); }
  });
}

export function soil(ctx) {
  return noiseTex(ctx, 'soil', 256, 32, (g, S, R) => {
    g.fillStyle = '#4a3a2c'; g.fillRect(0, 0, S, S);
    for (let k = 0; k < 4000; k++) { g.fillStyle = `rgba(${R.chance(0.5) ? '30,22,16' : '120,96,70'},${R.range(0.2, 0.6)})`; g.fillRect(R.range(0, S), R.range(0, S), R.range(1, 4), R.range(1, 4)); }
  });
}

// granite / sandstone pavers: 0.6 x 0.3 m running bond, texture = 2.4 m
export function paving(ctx, name = 'paving', base = [178, 170, 158], seed = 5) {
  return noiseTex(ctx, name, 512, seed, (g, S, R) => {
    const px = S / 2.4;
    g.fillStyle = `rgb(${base.join(',')})`; g.fillRect(0, 0, S, S);
    const rows = Math.round(2.4 / 0.3), cols = Math.round(2.4 / 0.6);
    for (let r = 0; r < rows; r++) for (let cc = 0; cc < cols + 1; cc++) {
      const x0 = (cc + (r % 2) * 0.5) * 0.6 * px, y0 = r * 0.3 * px;
      const v = R.range(-14, 12);
      g.fillStyle = `rgb(${base[0] + v},${base[1] + v},${base[2] + v - R.range(0, 6)})`;
      g.fillRect(x0 % S, y0, 0.6 * px - 2, 0.3 * px - 2);
      if (x0 + 0.6 * px > S) g.fillRect(x0 - S, y0, 0.6 * px - 2, 0.3 * px - 2);
    }
    for (let k = 0; k < 14000; k++) { g.fillStyle = `rgba(${R.chance(0.5) ? '60,60,60' : '235,235,235'},${R.range(0.05, 0.25)})`; g.fillRect(R.range(0, S), R.range(0, S), 1.5, 1.5); }
  });
}

export function deck(ctx) {
  return noiseTex(ctx, 'deck', 512, 6, (g, S, R) => {
    // 0.14 m boards along U, texture = 2 m
    const px = S / 2, bw = 0.14 * px;
    for (let y = 0; y < S; y += bw) {
      const v = R.range(-18, 14);
      g.fillStyle = `rgb(${138 + v},${100 + v},${70 + v})`; g.fillRect(0, y, S, bw - 2);
      for (let k = 0; k < 40; k++) { g.fillStyle = `rgba(70,45,25,${R.range(0.05, 0.2)})`; g.fillRect(R.range(0, S), y + R.range(0, bw), R.range(20, 120), 1); }
      g.fillStyle = 'rgba(30,20,12,0.6)'; g.fillRect(0, y + bw - 2, S, 2);
      const j = R.range(0, S); g.fillRect(j, y, 2, bw);
    }
  });
}
