# Sound — running log

Owner files: `js/audio/*`. Everything is synthesized at runtime (no asset files).

## Architecture
* `audio.js` — the system (`ctx.audio`). Creates the AudioContext on the first user gesture
  (pointerdown/keydown/touchend/click) or `ctx.audio.resume()`; in `?test` it starts at onStart.
  `?noaudio` → everything is a no-op. Per frame: listener = camera matrix, acoustic space,
  ambience, point sources, trains, announcer.
* `bank.js` + `worker.js` + `recipes.js` — every sound is a named recipe (`fs:tile:sneaker:3`,
  `mus:bossa`, `bed:hvac:tile`, `ir:platform`, `voice:ja:f:3:<kana>` …) synthesized on demand in
  a module Worker (falls back to main thread), cached as AudioBuffers, priority-queued.
* Synthesis (worker-safe, pure JS): `dsp.js` (noise, RBJ biquads, modal resonators, loop
  folding), `synth.js` (FM e-piano, modal mallets, Karplus-Strong, bass, pads, drums),
  `music.js` (original shop loops / station melodies / chimes), `foley.js` (footsteps per
  surface & shoe, UI, tempura/sizzle/kitchen loops, café machines, gacha, suitcase, escalator),
  `beds.js` (HVAC, tunnel, traffic, distant city, leaves, water, crowd step texture, birds,
  crows, crossing signals), `trainsfx.js` (VVVF inverter, roll, joints, brake squeal, air,
  doors), `formant.js` (kana→mora formant PA voice + crowd walla), `ir.js` (generated IRs).
* `mixer.js` — buses master/music/sfx/voice/ambience/ui (+wet sends), glue compressor + limiter,
  two crossfaded ConvolverNodes (old one freed after the fade), Emitter (gain → occlusion LP →
  Panner → bus, distance-dependent reverb send), one-shots with a voice cap.
* `ambience.js` — beds per mood (ZONES[].mood + space overrides: platform, nkplatform, canyon,
  shop), blended across ramps by progress; walla & granular footstep cloud scaled by crowd
  density (`ctx.crowd.densityNear` / `agentsNear` if present, else mood × `clock.rush`);
  suitcases; birds/crows/horns/buses/crossing signals/distant trains/distant PA.
* `sources.js` — shops (from `directory.js` BUSINESSES, or `ctx.shops.businesses`): music by
  category, tempura/fryer/sizzle/kitchen loops, café grinder/steam/cups, gacha, conbini chime +
  greeting; escalator machinery + looping safety announcement. Budget: 6 music, 4 activity,
  3 escalator sources; occlusion re-evaluated round-robin (other level → 420 Hz LP, no LOS to
  doorway → 900 Hz LP). Closed shops are silent (the 17:00 tempura bar really is quiet).
* `trains.js` — handles `train:approach/arrive/depart` and `announce`; trains are moving LINE
  sources (emitters sit at the nearest point of the train body). `announcer.js` — PA queue with
  priorities, TTS (ja-JP / en-US if voices exist) or formant PA voice, chimes, ducking, captions.

## APIs (ctx.audio)
* `resume()`, `setVolume(bus, v)` / `setVolume(v)` (master), `getVolume(bus)`, `setMuted(b)`,
  `useSpeech` (bool), `stats()`, `debugText()`.
* `play(name, {gain, rate, pan, pos:{x,z,level}|{x,y,z}})`. Names: gate_ok, gate_fail (=gate_ng),
  gate_low (double beep), phone_open/ui_open, phone_close/ui_close, ui_select, notify/phone_buzz,
  order, pay/charge, cup/coffee, door_chime, bell, discover, tempura, train_doors, train_depart,
  gacha, grinder, steam, rustle, pa_chime. Raw recipe names also work.
* `say({ja, en, kind, pos, gain, chime})` — PA-style line.
* Bus names: master, music, sfx (also scales ui), voice, ambience. Persisted in localStorage
  `namba.audio.v1`. Listens to `settings:change` keys volume/music/sfx/voice/ambience/speech.

## Events
* Consumed: player:step (uses `surface`, `intensity`, `final`, `foot`), player:land (comb plate),
  player:bump (rustle / thud), phone:open/close, phone:message (buzz), ic:tap (ok/low/fail),
  discover, game:pause/resume (master duck), train:approach/arrive/depart, announce.
* Emitted: `caption` `{ text, en, ja, kind, speaker:'PA', duration, distant }` for announcements
  *we* originate (approach/arrival/doors/escalator first loop/ambient PA). Lines arriving via
  `announce` are voiced but not captioned (HUD already subtitles `announce`).

## Requests to other areas
* **Transit**: `train:approach.eta` is read as *seconds until doors open* (default 30); please
  emit approach ≥ 15 s before arrival so the tunnel push / braking whine can play. Optional:
  `train:arrive.dwell` (s) lets the Nankai departure melody start before the doors close;
  `train:depart.moveIn` (s until the train moves after the doors start closing; default 4,
  Nankai 9). `track` may be the track id or number.
* **Crowd**: `ctx.crowd.densityNear(level,x,z,r)` → number of agents within r (or 0..1); used for
  walla / footstep-cloud density. If you emit an event when an agent enters a shop door,
  tell me — conbini chimes are currently stochastic + player-triggered.
* **Game**: `caption` carries both `en` and `text`.

## Testing
Offline renders (OfflineAudioContext stepped with suspend/resume, real World + Audio system,
fake player) → WAV → numpy/scipy spectrograms. Rig lives in the session scratch dir
(server.mjs, offline.html, scene.mjs, scenes.mjs, spec.py, stats.py).

## Log
* v1: full system built. Iterations (render → analyse → fix):
  1. Recipe level: tile/stone steps were thump-dominated (centroid ~200 Hz) → contact click +7 dB,
     thump −10 dB (now tile 2.3 kHz, stone 2.0 kHz, heel 2.7 kHz); wood/metal rang 0.4 s → 30/20 ms
     modes; PA voice centroid 630 Hz → horn EQ (480 Hz HP, +9 dB @2.2 kHz); walla had a dropout
     → 18 voices, shorter gaps; traffic bed masked passes; loop seams fixed (traffic, suitcase,
     escalator, fridge).
  2. Scene level: every interior dominated by <200 Hz HVAC → rumble −7 dB; tempura crackle buried
     at the door → gain ×2.5, ref 3 m (centroid at door 370 Hz → 1.5 kHz); garden birds sparse →
     ×2.5 gain, 0.7–3.9 s interval; shop music was the loudest thing in NAMBAWALK and bassy →
     speaker EQ (170 Hz–7.5 kHz) baked in, −4.4 dB; player steps +3.5 dB.
  3. Trains: arrival only +2 dB over ambience → roll ×3, distance/tunnel-dependent LP; train
     audible at full level 200 m down the tunnel because reverb sends were pre-panner → sends now
     follow distance (∝ d^-0.8 beyond 2.5×ref). Arrival now −34 dB (tunnel) → −13 dB (platform).

## Round 2 (critique: notes/critique/sound.md)
Changed (all in js/audio/*):
* **Crowd voices** (critique 1): `crowd:excuse` / `crowd:callout` → `Audio._bark` plays `bark:ja:<f|m>:<seed>:<kana>` (new recipe: dry formant voice, no PA horn),
  positional + HRTF, LOS-muffled; excuse also emits a `caption` (speaker 'Stranger'). Ambience adds sparse close-by chatter (`CHAT` list in ambience.js).
* **NPC gate beeps** (2): `gate:pass` (and `crowd:gate` only when transit has no gatePass) → positional `gate_ok` (±3 % pitch, every 25th `gate_low`, 1 % `gate_fail`),
  ≤6 per 0.6 s, same level, ≤40 m, skipped when it duplicates the player's `ic:tap`.
* **PA** (3,4): SpeechSynthesis is now OFF by default (`ctx.audio.useSpeech=false`; `settings:change` key `speech` turns it on). `game:pause` pauses speech, tab hide cancels it.
  Formant voice: Japanese accent-phrase contour (rise over 2 morae, declination, accent step, phrase-final fall + 1.5× final mora, each phrase lower), 30 ms portamento,
  no hum/noise floor in pauses. English: stress peaks + final fall.
* **Walla** (5): brighter (hp 330 Hz, +10 dB @2.6 k, +8 dB @4.3 k, lp 6.2 k; emitter lp 5.6 k): centroid 356 → 1075 Hz.
* **Shop music** (6): every loop is now A / A' (+2 st) / A'' (−2 st) = 25–48 s, and per-shop variants `mus:<genre>:<0..2>` (key −2/0/+3, tempo 0.94/1/1.06; variant by hash of slot). Music buffers at 24 kHz; unused ones are dropped (`Sources._gcMusic`).
* **Escalator** (7): loop has step-comb clicks (louder, varied), chain rattle and handrail hiss (centroid 160 → 286 Hz, 1–4 k band present); 4 announcement variants (`ESCALATOR_LINES`) rotate ja/en, caption per new variant.
* **Footsteps** (8): sneaker crest eased (~5 dB), steps −2 dB, rubber squeak (`fs:squeak:N`) on tile/stone, 45 % on turns (camera yaw change) else 4 %.
* **Indoor→outdoor** (9): `player:zone` into outdoors plays `bed:gust` and dips the reverb return for ~1 s; garden/canyon beds raised ~4–6 dB.
* **Chimes** (10): PA attention chime = low-register tubular-bell "ding-dong" (`chime:pa`); Nankai A = music-box, Nankai B = vibraphone; Midosuji glock, Sennichimae marimba.
* **Bug 5**: `Audio.play` ignores a repeat of the same non-positional recipe within 120 ms (phone:message + phone_buzz).
* **Trains** (loud at 120 m): train emitters now have panner rolloff 0 and an explicit level = distance law `1/(1+(d/16)^1.4)` × occlusion (`_occ`: on platform 1, same zone 0.65, elsewhere 0.4)
  × platform-screen-door gate (`ctx.transit.trackInfo/trackState.psdOpen`, only hides a train that is still in the tunnel) × tunnel 0.6, applied to roll/motor/one-shots so the reverb send falls with it.
* HRTF only above quality `low` (re-evaluated at runtime). `ambience._density` fixed: `crowd.densityNear` is people/m², converted to a head count in the 12 m disc.
