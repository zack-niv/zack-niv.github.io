// =============================================================================
// Tactile paving (点字ブロック): yellow JIS line blocks along each route in
// LAYOUT.tactile, dot (warning) blocks at corners and stop pads in front of
// stairs, gates and exits. 300 mm blocks, raised 5 mm.
// =============================================================================
const BLK = 0.3;

export function buildTactile(K) {
  const routes = K.L.tactile || [];
  let n = 0;
  for (const t of routes) {
    const lv = t.level, y = K.y(lv) + 0.006;
    const pts = t.pts;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.01) continue;
      const dx = (bx - ax) / L, dz = (bz - az) / L;
      // leave room for a dot block at interior corners
      const s0 = i > 0 ? BLK / 2 : 0, s1 = i < pts.length - 2 ? L - BLK / 2 : L;
      if (s1 - s0 <= 0.05) continue;
      const px = -dz * BLK / 2, pz = dx * BLK / 2; // half-width perpendicular
      const p0 = [ax + dx * s0, az + dz * s0], p1 = [ax + dx * s1, az + dz * s1];
      const b = K.B(lv, (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2);
      // a = p0 - perp, b = p0 + perp ... CCW seen from above (normal +Y)
      const A = [p0[0] + px, y, p0[1] + pz], Bq = [p0[0] - px, y, p0[1] - pz], C = [p1[0] - px, y, p1[1] - pz], D = [p1[0] + px, y, p1[1] + pz];
      const uv = [[0, s0], [BLK, s0], [BLK, s1], [0, s1]];
      // ensure the quad faces up
      const nY = (Bq[2] - A[2]) * (D[0] - A[0]) - (Bq[0] - A[0]) * (D[2] - A[2]);
      if (nY > 0) b.quad('tactile_line', A, Bq, C, D, { uv }); else b.quad('tactile_line', Bq, A, D, C, { uv: [uv[1], uv[0], uv[3], uv[2]] });
      n++;
      if (i > 0) dotPad(K, lv, ax, az, 1, 1, dx, dz, y);
    }
    for (const [sx, sz] of t.stops || []) {
      // orient the pad with the last segment arriving at the stop
      let dx = 0, dz = 1;
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
        if (Math.hypot(bx - sx, bz - sz) < 0.01 || Math.hypot(ax - sx, az - sz) < 0.01) { const l = Math.hypot(bx - ax, bz - az) || 1; dx = (bx - ax) / l; dz = (bz - az) / l; }
      }
      dotPad(K, lv, sx, sz, 3, 2, dx, dz, y);
    }
  }
  return n;
}

// a pad of dot blocks centred on (x, z): `across` × `deep` blocks, oriented so
// `deep` runs along (dx, dz)
function dotPad(K, lv, x, z, across, deep, dx, dz, y) {
  const b = K.B(lv, x, z);
  const ax = Math.abs(dx) >= Math.abs(dz);
  const hx = (ax ? deep : across) * BLK / 2, hz = (ax ? across : deep) * BLK / 2;
  b.rectH('tactile_dot', x - hx, z - hz, x + hx, z + hz, y + 0.0005, true, { uv: [[0, 2 * hz], [2 * hx, 2 * hz], [2 * hx, 0], [0, 0]] });
}
