// =============================================================================
// Small canvas atlases for the architecture detail kit (main thread, one-off):
//   kit   4x4 cells of 128 px: fire-hose cabinet, AED, exit sign, staff door,
//         coin lockers, AC diffuser, smoke detector, sprinkler, speaker, CCTV dome,
//         notice board, fire-extinguisher recess
//   wear  4x4 cells of 128 px: darkening decals (scuffs, gum, heel marks, grime)
// Cell i: col = i % 4, row = (i / 4) | 0, row 0 at the top of the canvas.
// cellUV(i) returns [u0, v0, u1, v1] for a canvas texture with flipY = true.
// =============================================================================
const C = 128;

export function cellUV(i, inset = 0.004) {
  const c = i % 4, r = (i / 4) | 0;
  return [c / 4 + inset, 1 - (r + 1) / 4 + inset, (c + 1) / 4 - inset, 1 - r / 4 - inset];
}
export const KIT = { HOSE: 0, AED: 1, EXIT: 2, DOOR: 3, LOCKER: 4, DIFFUSER: 5, DETECTOR: 6, SPRINKLER: 7, SPEAKER: 8, CCTV: 9, NOTICE: 10, EXTING: 11, PLATE: 12, VENT: 13 };
export const WEAR = { SCUFF: 0, GUM: 1, HEEL: 2, GRIME: 3, STREAK: 4, SPLAT: 5, WIPE: 6, CORNER: 7 };

function mk(w, h) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  return cv;
}
const FONT = (w, s) => `${w} ${s}px "Noto Sans JP", "Hiragino Sans", "Yu Gothic", sans-serif`;

function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// running-man exit pictogram (JIS Z 8210), white on green, in a box w x h at (x, y)
function runner(g, x, y, s) {
  g.save();
  g.translate(x, y); g.scale(s, s);
  g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); g.arc(0.5, -0.9, 0.2, 0, Math.PI * 2); g.fill();
  g.lineWidth = 0.2;
  g.beginPath(); g.moveTo(0.4, -0.6); g.lineTo(0.0, 0.0); g.lineTo(-0.5, 0.15); g.stroke();       // torso + back arm
  g.beginPath(); g.moveTo(0.35, -0.55); g.lineTo(0.85, -0.3); g.lineTo(1.05, -0.55); g.stroke();   // front arm
  g.beginPath(); g.moveTo(0.0, 0.0); g.lineTo(0.55, 0.45); g.lineTo(0.35, 1.0); g.stroke();        // front leg
  g.beginPath(); g.moveTo(0.0, 0.0); g.lineTo(-0.45, 0.55); g.lineTo(-0.95, 0.5); g.stroke();      // back leg
  g.restore();
}

export function kitCanvas() {
  const cv = mk(C * 4, C * 4);
  const g = cv.getContext('2d');
  if (!g) return cv;
  const cell = (i, fn) => { const x = (i % 4) * C, y = ((i / 4) | 0) * C; g.save(); g.translate(x, y); g.beginPath(); g.rect(0, 0, C, C); g.clip(); fn(); g.restore(); };
  g.textAlign = 'center'; g.textBaseline = 'middle';
  // 0 fire hose cabinet (消火栓): red enamel door, white frame, label
  cell(KIT.HOSE, () => {
    g.fillStyle = '#6b6b6b'; g.fillRect(0, 0, C, C);
    g.fillStyle = '#c4161c'; rr(g, 6, 6, C - 12, C - 12, 5); g.fill();
    g.fillStyle = '#a81017'; g.fillRect(10, 10, C - 20, 6); g.fillRect(10, C - 16, C - 20, 6);
    g.fillStyle = '#fff'; g.font = FONT(700, 26); g.fillText('消火栓', C / 2, 44);
    g.font = FONT(600, 11); g.fillText('FIRE HOSE', C / 2, 66);
    g.fillStyle = '#eee'; rr(g, C / 2 - 4, 82, 8, 26, 3); g.fill();                                    // handle
    g.fillStyle = '#ffd400'; g.font = FONT(700, 10); g.fillText('押す PUSH', C / 2, 118);
  });
  // 1 AED box
  cell(KIT.AED, () => {
    g.fillStyle = '#0f8a4b'; g.fillRect(0, 0, C, C);
    g.fillStyle = '#fff'; rr(g, 8, 8, C - 16, C - 16, 10); g.fill();
    g.fillStyle = '#0f8a4b'; rr(g, 12, 12, C - 24, C - 24, 8); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(64, 92); g.bezierCurveTo(20, 62, 36, 28, 64, 50); g.bezierCurveTo(92, 28, 108, 62, 64, 92); g.fill();
    g.fillStyle = '#0f8a4b'; g.beginPath(); g.moveTo(68, 36); g.lineTo(52, 66); g.lineTo(64, 64); g.lineTo(58, 90); g.lineTo(78, 56); g.lineTo(66, 58); g.closePath(); g.fill();
    g.fillStyle = '#fff'; g.font = FONT(800, 20); g.fillText('AED', C / 2, 110);
  });
  // 2 exit sign (非常口)
  cell(KIT.EXIT, () => {
    g.fillStyle = '#00a35a'; g.fillRect(0, 0, C, C);
    g.fillStyle = '#fff'; g.fillRect(4, 4, C - 8, 3); g.fillRect(4, C - 7, C - 8, 3); g.fillRect(4, 4, 3, C - 8); g.fillRect(C - 7, 4, 3, C - 8);
    runner(g, 40, 56, 34);
    g.fillStyle = '#fff'; g.fillRect(84, 40, 28, 56); g.fillStyle = '#00a35a'; g.fillRect(90, 46, 16, 44);
    g.fillStyle = '#fff'; g.font = FONT(800, 20); g.fillText('非常口', C / 2 + 4, 114);
  });
  // 3 staff door (steel, kick plate, push plate, sign)
  cell(KIT.DOOR, () => {
    g.fillStyle = '#9aa0a6'; g.fillRect(0, 0, C, C);
    g.fillStyle = '#868c93'; g.fillRect(0, 0, 6, C); g.fillRect(C - 6, 0, 6, C);
    g.fillStyle = '#6e747b'; g.fillRect(0, C - 14, C, 14);                                                // kick plate
    g.fillStyle = '#d9dde0'; g.fillRect(C - 30, 56, 8, 26);                                               // lever
    g.fillStyle = '#f4f4f0'; g.fillRect(24, 14, 80, 30);
    g.fillStyle = '#c4161c'; g.fillRect(24, 14, 80, 5);
    g.fillStyle = '#222'; g.font = FONT(700, 10); g.fillText('関係者以外', C / 2, 28); g.fillText('立入禁止', C / 2, 39);
  });
  // 4 coin locker bank (4 cols x 5 rows of doors)
  cell(KIT.LOCKER, () => {
    g.fillStyle = '#4a4f55'; g.fillRect(0, 0, C, C);
    const cols = ['#5b86b7', '#d9dde2', '#5b86b7', '#d9dde2', '#e0b04a'];
    for (let r = 0; r < 5; r++) for (let c = 0; c < 4; c++) {
      g.fillStyle = cols[(r + c * 2) % 5]; g.fillRect(4 + c * 30, 4 + r * 24, 28, 22);
      g.fillStyle = '#222'; g.fillRect(4 + c * 30 + 20, 4 + r * 24 + 8, 5, 6);
      g.fillStyle = 'rgba(0,0,0,.45)'; g.font = FONT(700, 9); g.fillText(String(1 + c + r * 4), 4 + c * 30 + 11, 4 + r * 24 + 11);
    }
  });
  // 5 AC diffuser (square 4-way grille)
  cell(KIT.DIFFUSER, () => {
    g.fillStyle = '#eceeef'; g.fillRect(0, 0, C, C);
    g.fillStyle = '#c9ccce'; g.fillRect(8, 8, C - 16, C - 16);
    g.fillStyle = '#eceeef'; g.fillRect(14, 14, C - 28, C - 28);
    g.fillStyle = '#8c9094';
    for (let i = 0; i < 9; i++) { g.fillRect(20, 22 + i * 10.5, C - 40, 3); }
    g.fillStyle = '#d4d7d9'; g.fillRect(C / 2 - 6, 14, 12, C - 28);
  });
  // 6 smoke detector (round, white)
  cell(KIT.DETECTOR, () => {
    g.fillStyle = '#e7e8e8'; g.fillRect(0, 0, C, C);
    g.fillStyle = '#f7f7f5'; g.beginPath(); g.arc(C / 2, C / 2, 56, 0, 7); g.fill();
    g.strokeStyle = '#b8bbbd'; g.lineWidth = 4; g.beginPath(); g.arc(C / 2, C / 2, 40, 0, 7); g.stroke();
    g.fillStyle = '#cfd2d3'; g.beginPath(); g.arc(C / 2, C / 2, 22, 0, 7); g.fill();
    g.fillStyle = '#d02a2a'; g.beginPath(); g.arc(C / 2 + 34, C / 2 - 34, 5, 0, 7); g.fill();
  });
  // 7 sprinkler rose
  cell(KIT.SPRINKLER, () => {
    g.fillStyle = '#e9e9e7'; g.fillRect(0, 0, C, C);
    g.fillStyle = '#d6d6d3'; g.beginPath(); g.arc(C / 2, C / 2, 58, 0, 7); g.fill();
    g.fillStyle = '#b9bcbe'; g.beginPath(); g.arc(C / 2, C / 2, 34, 0, 7); g.fill();
    g.fillStyle = '#c9a24a'; g.beginPath(); g.arc(C / 2, C / 2, 14, 0, 7); g.fill();
  });
  // 8 ceiling speaker (grille)
  cell(KIT.SPEAKER, () => {
    g.fillStyle = '#e7e8e8'; g.fillRect(0, 0, C, C);
    g.fillStyle = '#f2f2f0'; g.beginPath(); g.arc(C / 2, C / 2, 58, 0, 7); g.fill();
    g.fillStyle = '#9ea2a5';
    for (let r = 1; r <= 4; r++) { g.beginPath(); g.arc(C / 2, C / 2, r * 12, 0, 7); g.lineWidth = 3; g.strokeStyle = '#a9adaf'; g.stroke(); }
  });
  // 9 CCTV dome
  cell(KIT.CCTV, () => {
    g.fillStyle = '#d5d7d8'; g.fillRect(0, 0, C, C);
    g.fillStyle = '#e9eaea'; g.beginPath(); g.arc(C / 2, C / 2, 60, 0, 7); g.fill();
    g.fillStyle = '#16181b'; g.beginPath(); g.arc(C / 2, C / 2, 40, 0, 7); g.fill();
    g.fillStyle = '#3a4a5c'; g.beginPath(); g.arc(C / 2 - 8, C / 2 - 8, 12, 0, 7); g.fill();
  });
  // 10 notice / poster board (frame, neutral content)
  cell(KIT.NOTICE, () => {
    g.fillStyle = '#35393e'; g.fillRect(0, 0, C, C);
    g.fillStyle = '#f2f1ec'; g.fillRect(6, 6, C - 12, C - 12);
    g.fillStyle = '#2b5fa8'; g.fillRect(6, 6, C - 12, 22);
    g.fillStyle = '#fff'; g.font = FONT(700, 13); g.fillText('お知らせ NOTICE', C / 2, 17);
    g.fillStyle = '#9a9a96';
    for (let i = 0; i < 7; i++) g.fillRect(14, 40 + i * 11, 70 + ((i * 37) % 30), 4);
    g.fillStyle = '#d9d6cc'; g.fillRect(C - 42, 40, 28, 40);
  });
  // 11 fire extinguisher recess (red pictogram on white)
  cell(KIT.EXTING, () => {
    g.fillStyle = '#f4f1ea'; g.fillRect(0, 0, C, C);
    g.fillStyle = '#c4161c'; g.fillRect(0, 0, C, 20);
    g.fillStyle = '#fff'; g.font = FONT(700, 13); g.fillText('消火器', C / 2, 11);
    g.fillStyle = '#c4161c'; rr(g, 46, 42, 36, 66, 12); g.fill(); g.fillRect(58, 30, 12, 14); g.fillRect(52, 28, 32, 6);
    g.fillStyle = '#111'; g.fillRect(48, 70, 32, 6);
  });
  // 12 stainless plate (kick / push)
  cell(KIT.PLATE, () => {
    const gr = g.createLinearGradient(0, 0, C, 0); gr.addColorStop(0, '#b9bdc2'); gr.addColorStop(0.5, '#e4e7ea'); gr.addColorStop(1, '#a9adb2');
    g.fillStyle = gr; g.fillRect(0, 0, C, C);
  });
  // 13 vent grille (louvred)
  cell(KIT.VENT, () => {
    g.fillStyle = '#d7d9db'; g.fillRect(0, 0, C, C);
    g.fillStyle = '#7d8185';
    for (let i = 0; i < 12; i++) g.fillRect(8, 8 + i * 9.5, C - 16, 4);
  });
  return cv;
}

export function wearCanvas() {
  const cv = mk(C * 4, C * 4);
  const g = cv.getContext('2d');
  if (!g) return cv;
  const cell = (i, fn) => { const x = (i % 4) * C, y = ((i / 4) | 0) * C; g.save(); g.translate(x, y); g.beginPath(); g.rect(0, 0, C, C); g.clip(); fn(); g.restore(); };
  let s = 12345; const R = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  const blob = (x, y, r, a) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(0,0,0,${a})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); };
  // transparent base
  g.clearRect(0, 0, C * 4, C * 4);
  // 0 scuff: a few elongated soft streaks
  cell(WEAR.SCUFF, () => { for (let i = 0; i < 6; i++) { g.save(); g.translate(20 + R() * 88, 20 + R() * 88); g.rotate(R() * 3); g.scale(2.6, 0.5); blob(0, 0, 14 + R() * 10, 0.25 + R() * 0.2); g.restore(); } });
  // 1 gum spots (small, dark, sharp)
  cell(WEAR.GUM, () => { for (let i = 0; i < 14; i++) { const x = 10 + R() * 108, y = 10 + R() * 108, r = 2 + R() * 3; g.fillStyle = `rgba(30,28,26,${0.35 + R() * 0.3})`; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.fillStyle = 'rgba(0,0,0,0.12)'; g.beginPath(); g.arc(x, y, r + 2.5, 0, 7); g.fill(); } });
  // 2 heel marks: short dark arcs
  cell(WEAR.HEEL, () => { g.strokeStyle = 'rgba(10,10,10,0.5)'; g.lineCap = 'round'; for (let i = 0; i < 5; i++) { g.lineWidth = 2 + R() * 2.5; g.beginPath(); const x = 16 + R() * 96, y = 16 + R() * 96, a = R() * 6; g.arc(x, y, 8 + R() * 14, a, a + 0.8 + R() * 0.8); g.stroke(); } });
  // 3 grime: broad soft darkening
  cell(WEAR.GRIME, () => { for (let i = 0; i < 9; i++) blob(10 + R() * 108, 10 + R() * 108, 26 + R() * 30, 0.12 + R() * 0.1); });
  // 4 streak: vertical drips / wheel tracks
  cell(WEAR.STREAK, () => { for (let i = 0; i < 4; i++) { const x = 18 + R() * 92; const gr = g.createLinearGradient(0, 0, 0, C); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, `rgba(0,0,0,${0.22 + R() * 0.15})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x, 0, 3 + R() * 4, C); } });
  // 5 splat: wet-ish stains
  cell(WEAR.SPLAT, () => { for (let i = 0; i < 4; i++) { const x = 20 + R() * 88, y = 20 + R() * 88; blob(x, y, 14 + R() * 12, 0.28); for (let k = 0; k < 6; k++) blob(x + (R() - 0.5) * 50, y + (R() - 0.5) * 50, 2 + R() * 3, 0.4); } });
  // 6 wipe: mop sweeps (broad arcs)
  cell(WEAR.WIPE, () => { g.strokeStyle = 'rgba(0,0,0,0.10)'; for (let i = 0; i < 6; i++) { g.lineWidth = 8 + R() * 8; g.beginPath(); g.arc(64, 160, 100 + i * 10, -2.3, -0.8); g.stroke(); } });
  // 7 corner dirt (dark in the top-left corner fading out)
  cell(WEAR.CORNER, () => { blob(0, 0, 120, 0.4); });
  return cv;
}
