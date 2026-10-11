// =============================================================================
// Canvas resolution for world textures (v11.1, the iOS crash).
//
// Every sign, menu, poster, departure board and shop atlas is drawn into a 2D canvas and uploaded as a texture.
// On desktop those canvases are 2048² pages. On an iPhone they were the single biggest memory cost: 272 MB of 2D
// canvas backing stores plus ~250 MB of their mip-mapped GPU copies, at load, before a single step (memprobe,
// notes/v11.1-ioscrash.md). iOS Safari kills a tab around there.
//
// lcanvas(w, h, kind) returns a canvas whose DRAWING space is still w × h "logical" px (the context starts with a
// scale transform), backed by fewer real pixels on mobile. Producers keep their coordinates, fonts and UVs (UVs are
// fractions of the logical size); only code that reads pixels back (drawImage from the canvas itself, getImageData)
// must multiply source rectangles by `c.ls` (real px per logical px).
//
//   setCanvasRes({ atlas: 0.5, sign: 0.71, board: 0.5 })   main.js, before any world system builds (mobile only)
//   lcanvas(2048, 2048, 'atlas')                            → 1024² on a phone, 2048² on desktop
//
// Desktop: every scale is 1, so lcanvas is exactly document.createElement('canvas') with that size.
// =============================================================================
export const CANVAS_RES = { atlas: 1, sign: 1, board: 1, misc: 1 };

export function setCanvasRes(o) { Object.assign(CANVAS_RES, o); }

export function lcanvas(w, h, kind = 'misc') {
  const s = CANVAS_RES[kind] != null ? CANVAS_RES[kind] : CANVAS_RES.misc;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
  c.lw = w; c.lh = h; c.ls = c.width / w;
  if (c.width !== w || c.height !== h) c.getContext('2d').scale(c.width / w, c.height / h);
  return c;
}
