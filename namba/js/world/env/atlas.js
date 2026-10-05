// =============================================================================
// Canvas texture atlases for environment dressing (signs, menus, POP cards,
// posters, product facings, food samples...).
//
// Every 2D thing is drawn once into a shared 2048² canvas page and referenced
// by UV rectangle, so hundreds of shopfronts cost a handful of textures and
// draw calls. Regions are cached by key: identical signs are drawn once.
//
//   const r = atlas.add('fascia:Kissa Rondo', 640, 96, (g, w, h) => { ... });
//   batch.quad(atlas.mat(r), a, b, c, d, { uv: atlas.uv(r) })
//
// Two kinds: 'lit' pages (MeshBasicMaterial, glow / bloom; back-lit signs,
// screens, light boxes) and 'print' pages (MeshStandardMaterial with a small
// self-illumination so printed matter stays readable in dim corners).
// =============================================================================
import * as THREE from 'three';

const PAD = 4;

export class Atlas {
  constructor(name, { size = 2048, lit = false, glow = 1.6, boost = 0.22 } = {}) {
    this.name = name; this.size = size; this.lit = lit; this.glow = glow; this.boost = boost;
    this.pages = []; this.cache = new Map();
    this._newPage();
  }
  _newPage() {
    const c = document.createElement('canvas');
    c.width = c.height = this.size;
    const g = c.getContext('2d');
    g.fillStyle = '#808080'; g.fillRect(0, 0, this.size, this.size);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    let mat;
    if (this.lit) {
      mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1, 1, 1).multiplyScalar(this.glow), side: THREE.FrontSide });
    } else {
      mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.62, metalness: 0, emissiveMap: tex, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: this.boost });
    }
    mat.name = `${this.name}_${this.pages.length}`;
    const page = { canvas: c, g, tex, mat, shelves: [], nextY: PAD, used: 0 };
    this.pages.push(page);
    return page;
  }
  // Allocate (or fetch cached) region of w×h pixels, drawn by draw(g, w, h).
  // Shelf packing with best-fit height classes (few wasted pixels).
  add(key, w, h, draw) {
    if (key && this.cache.has(key)) return this.cache.get(key);
    w = Math.ceil(w); h = Math.ceil(h);
    let page = null, shelf = null;
    for (const pg of this.pages) {
      for (const sh of pg.shelves) if (sh.h >= h && sh.h <= h * 1.3 + 4 && sh.x + w + PAD <= this.size && (!shelf || sh.h < shelf.h)) { shelf = sh; page = pg; }
      if (shelf) break;
    }
    if (!shelf) {
      page = this.pages.find(pg => pg.nextY + h + PAD <= this.size) || this._newPage();
      shelf = { y: page.nextY, h, x: PAD };
      page.shelves.push(shelf); page.nextY += h + PAD;
    }
    const x = shelf.x, y = shelf.y;
    shelf.x += w + PAD; page.used += w * h;
    const g = page.g;
    g.save();
    g.beginPath(); g.rect(x, y, w, h); g.clip();
    g.translate(x, y);
    try { draw(g, w, h); } catch (e) { console.warn('[atlas] draw failed', key, e); }
    g.restore();
    // bleed edge pixels into the padding (mip filtering)
    try {
      g.drawImage(page.canvas, x, y, w, 1, x, y - 2, w, 2);
      g.drawImage(page.canvas, x, y + h - 1, w, 1, x, y + h, w, 2);
      g.drawImage(page.canvas, x, y - 2, 1, h + 4, x - 2, y - 2, 2, h + 4);
      g.drawImage(page.canvas, x + w - 1, y - 2, 1, h + 4, x + w, y - 2, 2, h + 4);
    } catch (e) { /* ignore */ }
    page.tex.needsUpdate = true;
    const S = this.size;
    const r = { atlas: this, page: this.pages.indexOf(page), x, y, w, h,
      u0: (x + 0.5) / S, u1: (x + w - 0.5) / S, v0: 1 - (y + h - 0.5) / S, v1: 1 - (y + 0.5) / S };
    if (key) this.cache.set(key, r);
    return r;
  }
  mat(r) { return this.pages[r.page].mat; }
  // quad uv list for GeoBatch.quad (a=bottom-left, b=bottom-right, c=top-right, d=top-left)
  uv(r, flip = false) {
    return flip ? [[r.u1, r.v0], [r.u0, r.v0], [r.u0, r.v1], [r.u1, r.v1]]
      : [[r.u0, r.v0], [r.u1, r.v0], [r.u1, r.v1], [r.u0, r.v1]];
  }
  // sub-rectangle uv (fractions 0..1 of the region, fy measured from top)
  sub(r, fx0, fy0, fx1, fy1) {
    const du = r.u1 - r.u0, dv = r.v1 - r.v0;
    return { ...r, u0: r.u0 + du * fx0, u1: r.u0 + du * fx1, v1: r.v1 - dv * fy0, v0: r.v1 - dv * fy1 };
  }
  touch() { for (const p of this.pages) p.tex.needsUpdate = true; }
  stats() { return this.pages.map(p => ((p.used / (this.size * this.size)) * 100).toFixed(0) + '%').join(' '); }
}
