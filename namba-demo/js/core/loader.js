// =============================================================================
// Loading screen: honest, weighted progress drawn as a little metro line.
//
//   const L = new Loader(document.getElementById('loading'));
//   L.stage('architecture', 0.4, 'Raising the walls…')   // key, fraction inside the stage, message
//   L.done()                                              // fade out
//   await L.touchGate()                                   // polite "best on a computer" card (touch devices)
//
// Weights come from the measured load timeline, so the bar moves at the real
// pace (no fake easing, no stalls at 90%). Markup is created here so index.html
// can stay as it is; `.ld-msg` keeps its class for tools/loadprobe.mjs.
// =============================================================================

// key → [weight, station index, default message]
const STAGES = {
  survey:       [0.03, 0, 'Surveying the underground…'],
  materials:    [0.02, 0, 'Mixing terrazzo and tile…'],
  lighting:     [0.04, 1, 'Hanging the ceiling lights…'],
  architecture: [0.10, 1, 'Raising platforms and concourses…'],
  props:        [0.03, 1, 'Placing benches and ticket gates…'],
  shops:        [0.03, 2, 'Opening the shops…'],
  exterior:     [0.06, 2, 'Building the street above…'],
  parks:        [0.05, 2, 'Planting Namba Parks…'],
  transit:      [0.06, 2, 'Laying the rails…'],
  signage:      [0.02, 2, 'Painting the signs…'],
  bake:         [0.10, 3, 'Lighting every passage…'],
  nav:          [0.04, 3, 'Mapping every passage…'],
  player:       [0.01, 4, 'Finding your feet…'],
  crowd:        [0.04, 4, 'Waking the commuters…'],
  audio:        [0.01, 4, 'Tuning the announcements…'],
  phone:        [0.03, 4, 'Charging your phone…'],
  hud:          [0.01, 4, 'Almost there…'],
  game:         [0.04, 4, 'Reading Aya’s message…'],
  visibility:   [0.01, 4, 'Almost there…'],
  post:         [0.01, 5, 'Setting the exposure…'],
  compile:      [0.26, 5, 'Polishing the floors…'],
};
const STATIONS = [
  ['Survey', '測量'], ['Station', '駅'], ['Streets', '街'], ['Light', '光'], ['People', '人'], ['Shaders', '仕上げ'],
];
const TIPS = [
  'In Osaka you stand on the right of the escalator and walk on the left.',
  'Yellow signs mean exits. The exit you want is never the one you are facing.',
  'Headphones on: half the atmosphere is the station announcements.',
  'Nobody here is lost. They are all just taking the long way.',
];

const TOTAL = Object.values(STAGES).reduce((a, s) => a + s[0], 0);
// v23: where each station's dot sits on the line = the progress at which its group of stages is complete, so the dot
// lights at the very moment the fill reaches it (they used to be evenly spaced and lit when their stage STARTED, up to
// 25 % ahead of the fill). The last one ends the line.
const STATION_END = (() => {
  const end = STATIONS.map(() => 0);
  for (const k in STAGES) end[STAGES[k][1]] += STAGES[k][0] / TOTAL;
  let c = 0; return end.map(w => (c += w));
})();

export class Loader {
  constructor(root) {
    this.root = root;
    this.progress = 0;
    this._done = new Set();
    this._cur = null; this._doneW = 0;
    this._tip = 0;
    this._t0 = performance.now();
    if (!root) return;
    // v8: index.html paints this exact markup before any JS runs. Adopt it as is (rebuilding it restarted the entrance
    // animation and, before v8, swapped the title). Only build it when the page did not ship it.
    if (!root.querySelector('.nbl-inner')) {
      root.innerHTML = `
      <div class="nbl-bg"></div>
      <div class="nbl-inner">
        <div class="nbl-kana" lang="ja">なんば</div>
        <div class="nbl-latin">Lost in Namba</div>
        <div class="nbl-line" role="progressbar" aria-label="Loading" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
          <div class="nbl-track"><i class="nbl-fill"></i><b class="nbl-train"></b></div>
          <ol class="nbl-stations">${STATIONS.map(([en, ja], i) => `<li style="left:${(STATION_END[i] * 100).toFixed(1)}%"><span class="nbl-dot"></span><em>${en}</em><small lang="ja">${ja}</small></li>`).join('')}</ol>
        </div>
        <div class="nbl-row"><div class="ld-msg">Loading…</div><div class="nbl-pct">0%</div></div>
        <div class="nbl-tip"></div>
      </div>
      <div class="nbl-touch" hidden role="dialog" aria-modal="true" aria-labelledby="nbl-touch-h">
        <div class="nbl-card">
          <div class="nbl-card-ico" aria-hidden="true">⌨️🖱️</div>
          <h2 id="nbl-touch-h">Best on a computer with keyboard &amp; mouse</h2>
          <p>Namba is built for walking with <b>WASD</b> and looking with a mouse. It will still run here, at reduced quality, but the controls are tricky on touch.</p>
          <button type="button" class="nbl-go">Continue anyway</button>
        </div>
      </div>`;
    }
    const q = (s) => root.querySelector(s);
    this.el = { fill: q('.nbl-fill'), train: q('.nbl-train'), pct: q('.nbl-pct'), msg: q('.ld-msg'), line: q('.nbl-line'), tip: q('.nbl-tip'),
      stations: [...root.querySelectorAll('.nbl-stations li')], touch: q('.nbl-touch'), go: q('.nbl-go') };
    this._showTip();
    this._tipTimer = setInterval(() => this._showTip(), 4200);
    // v23: ONE displayed value drives the fill, the white dot (both transforms, no CSS transitions that could disagree
    // while the main thread is busy) and the percentage; it eases towards the real progress every frame, drifts on
    // slowly when nothing new is reported (a long stage no longer looks frozen), and never goes backwards.
    this.shown = 0; this._target = 0; this._real = 0; this._tReal = performance.now(); this._last = performance.now();
    this.el.stations.forEach((li, i) => { li.style.left = `${(STATION_END[i] * 100).toFixed(1)}%`; });
    this._W = 0;
    this._measure = () => { const t = this.el.fill.parentNode; this._W = t ? t.offsetWidth : 0; };
    this._measure(); addEventListener('resize', this._measure);
    this._raf = 0;
    const tick = (now) => { this._tick(now); if (!this._dead) this._raf = requestAnimationFrame(tick); };
    this._raf = requestAnimationFrame(tick);
    // rAF can be held back while the GPU process is busy; a timer keeps the bar honest in that case
    this._tm = setInterval(() => this._tick(performance.now()), 120);
  }

  _tick(now) {
    if (this._dead || !this.el) return;
    const dt = Math.min(0.25, Math.max(0, (now - this._last) / 1000)); this._last = now;
    // drift: from the last real report, creep towards the ceiling of the current stage (never past it), slowly
    const cur = this._cur && STAGES[this._cur];
    let tgt = this._real;
    if (cur) {
      const last = this._cur === 'compile';
      const ceil = last ? 0.995 : Math.min(1, (this._doneW + cur[0] * 0.92) / TOTAL);
      const tau = Math.max(1.6, cur[0] * 40);
      if (ceil > this._real) tgt = this._real + (ceil - this._real) * (1 - Math.exp(-((now - this._tReal) / 1000) / tau));
    }
    tgt = Math.max(tgt, this._target); this._target = tgt;
    const gap = tgt - this.shown;
    this.shown = gap < 0.0004 ? Math.max(this.shown, tgt) : this.shown + gap * (1 - Math.exp(-dt / 0.22));
    this._paint();
  }
  _paint() {
    const e = this.el, v = Math.min(1, this.shown);
    const q = Math.round(v * 1000) / 1000;
    if (q !== this._q) {
      this._q = q;
      e.fill.style.transform = `scaleX(${q})`;
      e.train.style.transform = `translate3d(${(q * this._W).toFixed(1)}px,0,0)`;
      const pc = Math.min(100, Math.floor(q * 100 + 0.5));
      if (pc !== this._pc) { this._pc = pc; e.pct.textContent = `${pc}%`; e.line.setAttribute('aria-valuenow', String(pc)); }
      e.stations.forEach((li, i) => { const on = q >= STATION_END[i] - 0.002; if (on !== li.classList.contains('on')) li.classList.toggle('on', on); });
    }
  }

  _showTip() {
    const t = this.el && this.el.tip; if (!t) return;
    t.classList.remove('on');
    setTimeout(() => { t.textContent = TIPS[this._tip++ % TIPS.length]; t.classList.add('on'); }, 350);
  }

  // key: STAGES key; frac: 0..1 inside the stage; msg: optional override
  stage(key, frac = 0, msg) {
    const s = STAGES[key]; if (!s || !this.el) return;
    if (this._cur && this._cur !== key) this._done.add(this._cur);
    this._cur = key;
    let p = 0;
    for (const k of this._done) p += STAGES[k] ? STAGES[k][0] : 0;   // v11: an unknown stage (a new system) must never break loading
    this._doneW = p;
    p += s[0] * Math.max(0, Math.min(1, frac));
    this.set(p / TOTAL, msg || s[2], s[1]);
  }
  // mark a stage finished without making it current
  finish(key) { this._done.add(key); }

  set(p, msg, station) {
    p = Math.max(this.progress, Math.min(1, p)); // never goes backwards
    const moved = p > this.progress;
    this.progress = p;
    const e = this.el; if (!e) return;
    if (moved) { this._real = p; this._tReal = performance.now(); }   // v23: the drift restarts from every real report
    if (msg) e.msg.textContent = msg;
    // v23: the current station only; its dot lights (class on) in _paint() when the fill gets there
    if (station != null) e.stations.forEach((li, i) => { li.classList.toggle('cur', i === station); });
  }

  // Polite notice for touch-only devices. Resolves when the person taps "Continue anyway".
  touchGate() {
    if (!this.el) return Promise.resolve();
    return new Promise((resolve) => {
      const e = this.el;
      e.touch.hidden = false;
      this.root.classList.add('gated');
      e.go.addEventListener('click', () => {
        e.touch.hidden = true; this.root.classList.remove('gated');
        try { sessionStorage.setItem('namba.touchOK', '1'); } catch (_) { /* private mode */ }
        resolve();
      }, { once: true });
    });
  }

  done() {
    clearInterval(this._tipTimer);
    this.set(1, 'Welcome to Namba', 5);
    if (this.el) { this._real = this._target = this.shown = 1; this._paint(); }   // v23: it is over: fill, dot and 100 % together
    this._dead = true; clearInterval(this._tm); try { cancelAnimationFrame(this._raf); removeEventListener('resize', this._measure); } catch (e) { /* ignore */ }
    if (this.root) this.root.classList.add('done');
    this.seconds = (performance.now() - this._t0) / 1000;
  }
}
