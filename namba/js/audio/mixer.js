// =============================================================================
// Mixer: buses, master limiter, convolution reverb with crossfaded acoustic
// spaces, listener sync, positional emitters with occlusion filters, and
// one-shot playback. Works with an AudioContext or OfflineAudioContext.
//
//   source → [emitter.input] → lowpass(occlusion) → panner → bus.dry ─┐
//                                         └→ send ──────→ bus.wet ─→ reverb → master
//   bus.dry/bus.wet share the bus volume (setVolume scales both).
// =============================================================================
export const BUSES = ['music', 'sfx', 'voice', 'ambience', 'ui'];

export class Mixer {
  constructor(ac, bank) {
    this.ac = ac; this.bank = bank;
    const master = this.master = ac.createGain();
    master.gain.value = 0.9;
    // gentle glue + safety limiter
    const comp = this.comp = ac.createDynamicsCompressor();
    comp.threshold.value = -10; comp.knee.value = 8; comp.ratio.value = 6; comp.attack.value = 0.004; comp.release.value = 0.22;
    const lim = this.lim = ac.createDynamicsCompressor();
    lim.threshold.value = -2; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.08;
    master.connect(comp); comp.connect(lim); lim.connect(ac.destination);
    // reverb
    this.verbIn = ac.createGain();
    this.verbOut = ac.createGain(); this.verbOut.gain.value = 1;
    const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 110; // keep the tail out of the mud
    this.verbIn.connect(hp);
    this.slots = [0, 1].map(() => {
      const conv = ac.createConvolver(); conv.normalize = false;
      const g = ac.createGain(); g.gain.value = 0;
      hp.connect(conv); conv.connect(g); g.connect(this.verbOut);
      return { conv, g, key: null };
    });
    this.verbOut.connect(master);
    this.active = 0; this.acoustic = null; this._wantAcoustic = null;
    // buses
    this.bus = {};
    for (const name of BUSES) {
      const dry = ac.createGain(), wet = ac.createGain(), vol = ac.createGain();
      dry.connect(vol); vol.connect(master);
      wet.connect(this.verbIn);
      this.bus[name] = { dry, wet, vol, level: 1 };
    }
    this.volumes = { master: 1, music: 1, sfx: 1, voice: 1, ambience: 1, ui: 1 };
    this.listener = ac.listener;
    this._lp = { x: 0, y: 0, z: 0 };
    this.liveOneShots = 0;
    this.emitters = new Set();   // positional emitters (for distance-dependent reverb sends)
  }
  // Reverberant energy falls off much more slowly than the direct sound, but a
  // source far down a tunnel or across the complex must not excite *your* room
  // at full level. 1 within ~2.5×ref, then ∝ d^-0.8.
  wetFalloff(x, y, z, ref = 2) {
    const d = Math.hypot(x - this._lp.x, y - this._lp.y, z - this._lp.z);
    const k = ref * 2.5;
    return d <= k ? 1 : Math.pow(k / d, 0.8);
  }
  get now() { return this.ac.currentTime; }

  // ---- volumes (perceptual: v^2) -------------------------------------------------
  setVolume(bus, v) {
    v = Math.max(0, Math.min(1, +v || 0));
    this.volumes[bus] = v;
    const g = v * v;
    const t = this.now;
    if (bus === 'master') { this.master.gain.setTargetAtTime(0.9 * g, t, 0.05); return; }
    const b = this.bus[bus]; if (!b) return;
    b.vol.gain.setTargetAtTime(g, t, 0.05);
    b.wet.gain.setTargetAtTime(g, t, 0.05);
    if (bus === 'sfx') { this.setVolume('ui', v); }
  }

  // ---- acoustics -----------------------------------------------------------------
  setAcoustic(key, fade = 1.6) {
    if (key === this._wantAcoustic) return;
    this._wantAcoustic = key;
    this.bank.get('ir:' + key, 1).then((buf) => {
      if (this._wantAcoustic !== key) return; // superseded meanwhile
      const cur = this.slots[this.active];
      if (cur.key === key) return;
      const nxt = this.slots[1 - this.active];
      const t = this.now;
      try { nxt.conv.buffer = buf; } catch (e) { console.warn('[audio] convolver', e.message); return; }
      nxt.key = key;
      nxt.g.gain.cancelScheduledValues(t); cur.g.gain.cancelScheduledValues(t);
      nxt.g.gain.setValueAtTime(nxt.g.gain.value, t); cur.g.gain.setValueAtTime(cur.g.gain.value, t);
      nxt.g.gain.linearRampToValueAtTime(1, t + fade);
      cur.g.gain.linearRampToValueAtTime(0, t + fade);
      this.active = 1 - this.active;
      this.acoustic = key;
      // free the old convolver's CPU once it is silent
      const old = cur, oldKey = cur.key;
      if (this._freeTimer) clearTimeout(this._freeTimer);
      if (typeof setTimeout !== 'undefined' && this.ac instanceof (globalThis.AudioContext || Object)) {
        this._freeTimer = setTimeout(() => { if (this.slots[this.active] !== old && old.key === oldKey) { try { old.conv.buffer = null; } catch (e) { /* some browsers refuse null */ } old.key = null; } }, (fade + 4.5) * 1000);
      }
    }).catch(() => {});
  }

  // ---- listener --------------------------------------------------------------------
  setListener(px, py, pz, fx, fy, fz, ux = 0, uy = 1, uz = 0) {
    const L = this.listener, t = this.now;
    this._lp.x = px; this._lp.y = py; this._lp.z = pz;
    if (L.positionX) {
      L.positionX.setValueAtTime(px, t); L.positionY.setValueAtTime(py, t); L.positionZ.setValueAtTime(pz, t);
      L.forwardX.setValueAtTime(fx, t); L.forwardY.setValueAtTime(fy, t); L.forwardZ.setValueAtTime(fz, t);
      L.upX.setValueAtTime(ux, t); L.upY.setValueAtTime(uy, t); L.upZ.setValueAtTime(uz, t);
    } else {
      L.setPosition(px, py, pz); L.setOrientation(fx, fy, fz, ux, uy, uz);
    }
    for (const em of this.emitters) em._updateSend();
  }

  // ---- emitters --------------------------------------------------------------------
  emitter(opts = {}) { return new Emitter(this, opts); }

  // Play a one-shot. buf: AudioBuffer or recipe name (skipped if not yet synthesized,
  // unless opts.wait). opts: bus, gain, rate, when, send, pos {x,y,z} | pan, lp, hrtf, ref, loop
  play(buf, opts = {}) {
    if (typeof buf === 'string') {
      const b = this.bank.peek(buf);
      if (!b) {
        const p = this.bank.get(buf, opts.prio ?? 3);
        if (opts.wait) return p.then((bb) => this.play(bb, opts)).catch(() => null);
        return null;
      }
      buf = b;
    }
    if (this.liveOneShots > 48 && !opts.force) return null; // voice cap
    const ac = this.ac;
    const src = ac.createBufferSource();
    src.buffer = buf;
    if (opts.rate) src.playbackRate.value = opts.rate;
    if (opts.loop) src.loop = true;
    const g = ac.createGain(); g.gain.value = opts.gain ?? 1;
    src.connect(g);
    let tail = g;
    if (opts.lp) { const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = opts.lp; f.Q.value = 0.6; tail.connect(f); tail = f; }
    if (opts.hp) { const f = ac.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = opts.hp; f.Q.value = 0.6; tail.connect(f); tail = f; }
    const bus = this.bus[opts.bus || 'sfx'];
    let out = tail;
    if (opts.pos) {
      const p = ac.createPanner();
      p.panningModel = opts.hrtf ? 'HRTF' : 'equalpower';
      p.distanceModel = 'inverse'; p.refDistance = opts.ref ?? 2; p.rolloffFactor = opts.rolloff ?? 1; p.maxDistance = 400;
      setPannerPos(p, opts.pos.x, opts.pos.y, opts.pos.z, ac.currentTime);
      tail.connect(p); out = p;
    } else if (opts.pan) {
      const sp = ac.createStereoPanner(); sp.pan.value = opts.pan; tail.connect(sp); out = sp;
    }
    out.connect(bus.dry);
    if (opts.send) { const s = ac.createGain(); s.gain.value = opts.send * (opts.pos ? this.wetFalloff(opts.pos.x, opts.pos.y, opts.pos.z, opts.ref ?? 2) : 1); tail.connect(s); s.connect(bus.wet); }
    const when = opts.when ?? ac.currentTime;
    src.start(when, opts.offset || 0);
    if (opts.duration) src.stop(when + opts.duration);
    this.liveOneShots++;
    src.onended = () => { this.liveOneShots--; try { src.disconnect(); g.disconnect(); out.disconnect(); tail.disconnect(); } catch (e) { /* already */ } };
    return { src, gain: g, panner: opts.pos ? out : null, stop: (t = 0.05) => { try { g.gain.setTargetAtTime(0, ac.currentTime, t); src.stop(ac.currentTime + t * 6); } catch (e) { /* stopped */ } } };
  }
}

export function setPannerPos(p, x, y, z, t) {
  if (p.positionX) { p.positionX.setValueAtTime(x, t); p.positionY.setValueAtTime(y, t); p.positionZ.setValueAtTime(z, t); }
  else p.setPosition(x, y, z);
}

// A positional (or 2-D) sound source with occlusion filter and reverb send.
// Holds at most one looping AudioBufferSourceNode at a time (setLoop).
export class Emitter {
  constructor(mixer, { bus = 'sfx', pos = null, hrtf = false, ref = 2, rolloff = 1, send = 0.3, gain = 1, pan = 0, lp = 20000 } = {}) {
    const ac = this.ac = mixer.ac;
    this.mixer = mixer;
    this.input = ac.createGain(); this.input.gain.value = 0;
    this.filter = ac.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.frequency.value = lp; this.filter.Q.value = 0.5;
    this.input.connect(this.filter);
    const b = mixer.bus[bus];
    if (pos) {
      const p = this.panner = ac.createPanner();
      p.panningModel = hrtf ? 'HRTF' : 'equalpower';
      p.distanceModel = 'inverse'; p.refDistance = ref; p.rolloffFactor = rolloff; p.maxDistance = 500;
      this.filter.connect(p); p.connect(b.dry);
      this.setPos(pos.x, pos.y, pos.z);
    } else if (pan) {
      this.stereo = ac.createStereoPanner(); this.stereo.pan.value = pan;
      this.filter.connect(this.stereo); this.stereo.connect(b.dry);
    } else this.filter.connect(b.dry);
    this.send = ac.createGain(); this.send.gain.value = send;
    this.filter.connect(this.send); this.send.connect(b.wet);
    this.sendBase = send; this.ref = ref; this._wf = 1;
    if (pos) { mixer.emitters.add(this); this._updateSend(true); }
    this.gainTarget = gain; this.level = 0;
    this.src = null; this.buffer = null;
    this.alive = true;
    this.pos = pos ? { ...pos } : null;
  }
  setPos(x, y, z) { if (!this.panner) return; this.pos = { x, y, z }; setPannerPos(this.panner, x, y, z, this.ac.currentTime); }
  _updateSend(force = false) {
    if (!this.pos) return;
    const wf = this.mixer.wetFalloff(this.pos.x, this.pos.y, this.pos.z, this.ref);
    if (force || Math.abs(wf - this._wf) > 0.04 * Math.max(wf, 0.05)) { this._wf = wf; this.send.gain.setTargetAtTime(this.sendBase * wf, this.ac.currentTime, force ? 0.005 : 0.08); }
  }
  rampPos(x, y, z, dt) {
    if (!this.panner) return; this.pos = { x, y, z };
    const p = this.panner, t = this.ac.currentTime;
    if (p.positionX) { p.positionX.linearRampToValueAtTime(x, t + dt); p.positionY.linearRampToValueAtTime(y, t + dt); p.positionZ.linearRampToValueAtTime(z, t + dt); }
    else p.setPosition(x, y, z);
  }
  // fade level (linear gain) with time-constant tc
  fade(v, tc = 0.4) { this.level = v; this.input.gain.setTargetAtTime(v, this.ac.currentTime, tc); }
  setLP(f, tc = 0.15) { this.filter.frequency.setTargetAtTime(Math.max(60, Math.min(20000, f)), this.ac.currentTime, tc); }
  setSend(v, tc = 0.3) { this.sendBase = v; this.send.gain.setTargetAtTime(v * this._wf, this.ac.currentTime, tc); }
  setRate(r, tc = 0.2) { if (this.src) this.src.playbackRate.setTargetAtTime(r, this.ac.currentTime, tc); }
  // start a looping buffer (crossfades from the previous one)
  setLoop(buf, { offset = null, rate = 1 } = {}) {
    if (!buf || buf === this.buffer) return;
    const ac = this.ac;
    const old = this.src, oldG = this._srcG;
    const src = ac.createBufferSource(); src.buffer = buf; src.loop = true; src.playbackRate.value = rate;
    const g = ac.createGain(); g.gain.value = 0; src.connect(g); g.connect(this.input);
    const off = offset == null ? Math.random() * buf.duration : offset;
    src.start(ac.currentTime, off % buf.duration);
    g.gain.setTargetAtTime(1, ac.currentTime, 0.08);
    this.src = src; this._srcG = g; this.buffer = buf;
    if (old) { oldG.gain.setTargetAtTime(0, ac.currentTime, 0.1); try { old.stop(ac.currentTime + 0.8); } catch (e) { /* */ } old.onended = () => { try { old.disconnect(); oldG.disconnect(); } catch (e) { /* */ } }; }
  }
  stopLoop(tc = 0.2) {
    if (!this.src) return;
    const s = this.src, g = this._srcG, ac = this.ac;
    g.gain.setTargetAtTime(0, ac.currentTime, tc);
    try { s.stop(ac.currentTime + tc * 6); } catch (e) { /* */ }
    s.onended = () => { try { s.disconnect(); g.disconnect(); } catch (e) { /* */ } };
    this.src = null; this._srcG = null; this.buffer = null;
  }
  // one-shot through this emitter's chain
  oneShot(buf, { gain = 1, rate = 1, when = null } = {}) {
    if (!buf) return null;
    const ac = this.ac;
    const s = ac.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate;
    const g = ac.createGain(); g.gain.value = gain; s.connect(g); g.connect(this.input);
    s.start(when ?? ac.currentTime);
    s.onended = () => { try { s.disconnect(); g.disconnect(); } catch (e) { /* */ } };
    return s;
  }
  dispose(tc = 0.3) {
    if (!this.alive) return;
    this.alive = false;
    this.mixer.emitters.delete(this);
    this.fade(0, tc);
    this.stopLoop(tc);
    const nodes = [this.input, this.filter, this.panner, this.stereo, this.send];
    const kill = () => { for (const n of nodes) if (n) try { n.disconnect(); } catch (e) { /* */ } };
    if (typeof setTimeout !== 'undefined') setTimeout(kill, tc * 8000); else kill();
  }
}
