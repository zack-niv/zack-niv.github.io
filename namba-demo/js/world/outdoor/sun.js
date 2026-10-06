// Solar position for Namba, Osaka (34.66°N, 135.50°E, JST = UTC+9) and the
// derived daylight palette (sun colour/intensity, sky colours, ambient).
// World axes: +X east, -Z north, +Y up.
import * as THREE from 'three';

const LAT = 34.66 * Math.PI / 180, LON = 135.50;
export const DAY_OF_YEAR = 278; // 5 October

// minutes: local clock minutes since midnight (JST). Returns unit vector
// towards the sun plus elevation/azimuth in degrees.
export function sunPosition(minutes, doy = DAY_OF_YEAR, out = new THREE.Vector3()) {
  const hr = minutes / 60;
  const g = 2 * Math.PI / 365 * (doy - 1 + (hr - 12) / 24);
  const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const tst = minutes + eqt + 4 * LON - 60 * 9; // true solar time (min)
  const ha = (tst / 4 - 180) * Math.PI / 180;
  const sinEl = Math.sin(LAT) * Math.sin(decl) + Math.cos(LAT) * Math.cos(decl) * Math.cos(ha);
  const el = Math.asin(Math.max(-1, Math.min(1, sinEl)));
  const az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(LAT) - Math.tan(decl) * Math.cos(LAT)) + Math.PI;
  out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
  return { dir: out, elevation: el * 180 / Math.PI, azimuth: az * 180 / Math.PI };
}

const C = (r, g, b) => new THREE.Color(r, g, b);
// keyframes by sun elevation (deg). Colours are linear HDR.
const KEYS = [
  { e: -12, zen: C(0.004, 0.006, 0.016), hor: C(0.035, 0.03, 0.04), glow: C(0.0, 0.0, 0.0), sun: C(0, 0, 0), sunI: 0, amb: 0.05, cloudLit: C(0.04, 0.035, 0.04), cloudDark: C(0.012, 0.012, 0.02) },
  { e: -4, zen: C(0.02, 0.035, 0.09), hor: C(0.25, 0.15, 0.13), glow: C(0.6, 0.22, 0.08), sun: C(0, 0, 0), sunI: 0, amb: 0.18, cloudLit: C(0.45, 0.2, 0.15), cloudDark: C(0.05, 0.05, 0.08) },
  { e: 1, zen: C(0.06, 0.12, 0.3), hor: C(0.9, 0.5, 0.28), glow: C(1.6, 0.6, 0.18), sun: C(1.0, 0.45, 0.18), sunI: 0.9, amb: 0.4, cloudLit: C(1.4, 0.65, 0.35), cloudDark: C(0.16, 0.13, 0.17) },
  { e: 6, zen: C(0.1, 0.22, 0.52), hor: C(1.0, 0.7, 0.45), glow: C(1.5, 0.75, 0.3), sun: C(1.0, 0.62, 0.36), sunI: 2.0, amb: 0.65, cloudLit: C(1.7, 1.05, 0.65), cloudDark: C(0.3, 0.27, 0.32) },
  { e: 15, zen: C(0.13, 0.3, 0.72), hor: C(0.85, 0.85, 0.85), glow: C(0.9, 0.7, 0.45), sun: C(1.0, 0.82, 0.62), sunI: 3.0, amb: 0.85, cloudLit: C(2.0, 1.75, 1.45), cloudDark: C(0.45, 0.46, 0.52) },
  { e: 35, zen: C(0.12, 0.3, 0.8), hor: C(0.78, 0.86, 0.95), glow: C(0.6, 0.55, 0.45), sun: C(1.0, 0.93, 0.82), sunI: 3.6, amb: 1.0, cloudLit: C(2.3, 2.2, 2.1), cloudDark: C(0.55, 0.58, 0.66) },
  { e: 90, zen: C(0.1, 0.27, 0.78), hor: C(0.75, 0.85, 0.96), glow: C(0.5, 0.5, 0.45), sun: C(1.0, 0.96, 0.9), sunI: 3.8, amb: 1.0, cloudLit: C(2.4, 2.35, 2.3), cloudDark: C(0.6, 0.63, 0.7) },
];

// Interpolated palette for an elevation.
export function daylight(elev, out = {}) {
  let a = KEYS[0], b = KEYS[KEYS.length - 1];
  if (elev <= a.e) b = a;
  else for (let i = 0; i < KEYS.length - 1; i++) if (elev >= KEYS[i].e && elev <= KEYS[i + 1].e) { a = KEYS[i]; b = KEYS[i + 1]; break; }
  const t = a === b ? 0 : (elev - a.e) / (b.e - a.e);
  const s = t * t * (3 - 2 * t);
  for (const k of ['zen', 'hor', 'glow', 'sun', 'cloudLit', 'cloudDark']) (out[k] || (out[k] = new THREE.Color())).copy(a[k]).lerp(b[k], s);
  out.sunI = a.sunI + (b.sunI - a.sunI) * s;
  out.amb = a.amb + (b.amb - a.amb) * s;
  out.night = Math.max(0, Math.min(1, (2 - elev) / 8)); // 0 day .. 1 night
  return out;
}
