// Player settings: persisted in localStorage (guarded), applied to systems.
import { params } from '../core/params.js?v=6c67dba';

const KEY = 'namba.settings';
const DEFAULTS = { quality: 'high', sensitivity: 1, headBob: 1, volume: 0.8, subtitles: true };
export const QUALITIES = ['low', 'medium', 'high', 'ultra'];

export function loadSettings() {
  let s = { ...DEFAULTS };
  try { const raw = localStorage.getItem(KEY); if (raw) Object.assign(s, JSON.parse(raw)); } catch (e) { /* private mode */ }
  if (params.quality && QUALITIES.includes(params.quality)) s.quality = params.quality;
  if (!QUALITIES.includes(s.quality)) s.quality = DEFAULTS.quality;
  s.sensitivity = clamp(+s.sensitivity || 1, 0.2, 3);
  s.headBob = clamp(+s.headBob, 0, 1);
  s.volume = clamp(+s.volume, 0, 1);
  s.subtitles = s.subtitles !== false;
  return s;
}
function clamp(v, a, b) { return Math.max(a, Math.min(b, isNaN(v) ? a : v)); }

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
}

// Apply to running systems (all guarded: other areas may not expose these).
export function applySettings(ctx, s, key) {
  ctx.settings = s;
  if (ctx.input) ctx.input.sensitivity = 0.0022 * s.sensitivity;
  if (ctx.player) { ctx.player.headBob = s.headBob; if ('bobScale' in ctx.player) ctx.player.bobScale = s.headBob; }
  const a = ctx.audio;
  if (a) {
    try {
      if (a.setVolume) a.setVolume(s.volume);
      else if (a.setMasterVolume) a.setMasterVolume(s.volume);
      else if (a.master && a.master.gain) a.master.gain.value = s.volume;
    } catch (e) { /* ignore */ }
  }
  if (key) ctx.events.emit('settings:change', { key, value: s[key], settings: s });
}

// Reload with a new ?quality= (keeps other params except skip/test when
// coming from the title so the title shows again).
export function reloadWithQuality(q) {
  const u = new URL(location.href);
  u.searchParams.set('quality', q);
  location.href = u.toString();
}

// Shared settings form (title + pause menu). Returns an element.
export function buildSettingsPanel(ctx, onChange) {
  const s = ctx.settings;
  const el = document.createElement('div');
  el.className = 'g-settings';
  const row = (label, ja, control) => {
    const r = document.createElement('div'); r.className = 'g-set-row';
    r.innerHTML = `<div class="g-set-label"><span>${label}</span><small>${ja}</small></div>`;
    r.appendChild(control); return r;
  };
  // quality: segmented
  const seg = document.createElement('div'); seg.className = 'g-seg';
  for (const q of QUALITIES) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = q[0].toUpperCase() + q.slice(1);
    if (q === s.quality) b.classList.add('on');
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (q === s.quality) return;
      s.quality = q; saveSettings(s); reloadWithQuality(q);
    });
    seg.appendChild(b);
  }
  el.appendChild(row('Graphics quality', '画質 · reloads', seg));
  const slider = (key, min, max, step, fmt) => {
    const w = document.createElement('div'); w.className = 'g-slider';
    const i = document.createElement('input'); i.type = 'range'; i.min = min; i.max = max; i.step = step; i.value = s[key];
    const v = document.createElement('output'); v.textContent = fmt(s[key]);
    i.addEventListener('input', () => { s[key] = +i.value; v.textContent = fmt(s[key]); saveSettings(s); applySettings(ctx, s, key); onChange && onChange(key); });
    i.addEventListener('click', e => e.stopPropagation());
    w.append(i, v); return w;
  };
  el.appendChild(row('Mouse sensitivity', 'マウス感度', slider('sensitivity', 0.2, 3, 0.05, v => v.toFixed(2) + '×')));
  el.appendChild(row('Head bob', '視点の揺れ', slider('headBob', 0, 1, 0.05, v => Math.round(v * 100) + '%')));
  el.appendChild(row('Master volume', '音量', slider('volume', 0, 1, 0.01, v => Math.round(v * 100) + '%')));
  const tog = document.createElement('button'); tog.type = 'button'; tog.className = 'g-toggle' + (s.subtitles ? ' on' : '');
  tog.innerHTML = '<i></i>';
  tog.setAttribute('aria-label', 'Subtitles');
  tog.addEventListener('click', (e) => { e.stopPropagation(); s.subtitles = !s.subtitles; tog.classList.toggle('on', s.subtitles); saveSettings(s); applySettings(ctx, s, 'subtitles'); onChange && onChange('subtitles'); });
  el.appendChild(row('Announcement subtitles', '字幕', tog));
  return el;
}

export const CONTROLS = [
  [['W', 'A', 'S', 'D'], 'Walk', '歩く'],
  [['Shift'], 'Hurry', '急ぐ'],
  [['Q'], 'Phone up / down', 'スマホを出す・しまう'],
  [['Right-click'], 'Hold for a quick phone look', '長押しでちらっと確認'],
  [['Tab'], 'Switch apps (phone up)', 'アプリ切り替え'],
  [['1', '2', '3'], 'Reply to Aya (phone up)', '返信'],
  [['V'], 'Lodestone 3D view (phone up)', '3D表示'],
  [['E'], 'Interact', '調べる'],
  [['Esc'], 'Pause', '一時停止'],
];
export function buildControlsCard() {
  const el = document.createElement('div'); el.className = 'g-controls';
  el.innerHTML = CONTROLS.map(([keys, en, ja]) =>
    `<div class="g-ctl"><span class="g-keys">${keys.map(k => `<kbd class="g-key${k.length > 1 ? ' wide' : ''}">${k}</kbd>`).join('')}</span><span class="g-ctl-en">${en}</span><span class="g-ctl-ja">${ja}</span></div>`).join('');
  return el;
}
