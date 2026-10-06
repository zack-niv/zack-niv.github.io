# Sound — experience critique (critic-exp, round 1)

**Verdict:** a serious, well-engineered synthesis system with real acoustic thinking, but the station doesn't *talk back*. The crowd is a low murmur, the gates never beep for anyone but you, nobody's "sumimasen" is ever heard, and in most browsers the PA is a dry TTS voice speaking from inside your head.

**Score: 5.5 / 10** for "walking around is itself delightful".

How this was reviewed: I can't listen. I read every file in `js/audio/`, traced which events are actually wired, and ran my own numbers (numpy/scipy) on the sound lead's offline renders in `scratchpad/sound/wav/` (99 files). The figures below come from that script (`critic-exp/audio/an.py`): spectral centroid, the 95 % roll-off (the frequency below which 95 % of the energy sits), loop length from envelope autocorrelation, and peak/RMS level.

---

## Top 10 issues (ranked by impact on the player's feeling)

### 1. Crowd barks and shop call-outs are emitted but nobody plays them
- **Evidence:** the crowd emits `crowd:excuse` (すみません) and `crowd:callout` (いらっしゃいませ) (`js/npc/sim.js:645`, `js/npc/behave.js:330`). `grep -rn "crowd:" js/audio js/ui js/game` finds **no listener anywhere**. Only `js/npc/bench.mjs` counts them. `phrases.js` even defines `IRASSHAI`, but it is used only for the stochastic conbini chime in `sources.js:173`.
- **Why it matters:** these are the two sounds that make the crowd *respond to you*. Walking into a stranger and hearing a soft "a, sumimasen" is the single cheapest piece of "this place is alive and I'm in it". The shop-staff chorus of irasshaimase is the soundtrack of NAMBAWALK. Right now they're silent, and they aren't captioned either (see game.md).
- **Fix:** in `audio.js init()`, add `ev.on('crowd:excuse', e => this.bark(e))` and `ev.on('crowd:callout', …)`. Play them as positional formant/TTS-free one-shots: pre-render 6–8 variants per gender ("あ、すみません", "すいません", "失礼します", "ごめんなさい"), routed through `mixer.play(…, {pos, ref: 1.5, hrtf: true})`. Do not use SpeechSynthesis here, because it can't be positioned. Call-outs should be sing-song, overlapping and staggered between neighbouring shops (a 0.3–1.2 s offset), with distance falloff from about 9 m.

### 2. Ticket gates are silent for everyone except the player
- **Evidence:** the crowd calls `transit.gatePass()`, which emits `gate:pass` and also `crowd:gate`. Audio listens only to `ic:tap` (`audio.js:73`), which only the player's own taps produce. The crowd sampler shows a lot of gate traffic at 08:30 (see crowd-behaviour.md), and all of it is soundless.
- **Why it matters:** the constant overlapping *pi… pi-pi… pi* of IC readers is THE sound of a Japanese gate line at rush hour. Its rhythm tells you how busy the station is before you see it. Without it, a 22-lane Nankai gate line reads as dead.
- **Fix:** listen to `gate:pass` and play `ui:gate_ok` positionally at the lane (x, z). Pitch-jitter ±3 % and gain-jitter ±2 dB. Every ~25th pass, play `gate_low` (the double "pi-pi" low-balance warning). Rarely (1 %), play `gate_fail` with the flap-slam. Cap it at about 6 concurrent voices, and below that let the voice cap in `mixer.js` decide.

### 3. In real browsers the PA is a dry, centre-panned TTS voice, so the platform loses its acoustic
- **Evidence:** `announcer.js` prefers `speechSynthesis` whenever a ja-JP voice exists (`_canSpeak`). That is true on desktop Chrome (Google 日本語), macOS (Kyoko) and Edge (Nanami). TTS is "not routable into Web Audio" (the file says so), so the only spatial treatment is a volume scale (`u.volume = … att`). It gets no reverb, no band-limited horn and no position. It isn't paused by `game:pause` either: `_pause()` only ducks `mixer.master`, so speech keeps talking over the pause menu.
- **Why it matters:** the sound lead's best work is the PA chain: the horn EQ, the platform impulse responses (IRs), the diffuse ceiling speakers. The production path bypasses all of it for most players. A crisp assistant voice saying "まもなく、2番線に…" in your head is the opposite of standing on a tiled B2 platform.
- **Fix:** default `useSpeech = false` for station PA (`kind` station/train/escalator). Keep TTS only as an opt-in accessibility setting. Spend the effort on the formant voice instead (issue 4), or better, add a small set of pre-rendered lines. Also call `speechSynthesis.pause()/resume()` on `game:pause/resume` and `cancel()` on `visibilitychange`.

### 4. The fallback formant voice is a robot: flat pitch per mora and a constant low buzz
- **Evidence:** in `scratchpad/sound/voice2.png`, both the ja and en renders show stair-stepped, flat-pitched blocks per syllable, with no glides or declination. A continuous band of energy below 200 Hz runs under the whole utterance, including the gaps. Measured: `voice_ja_f_3_.wav` centroid 1068 Hz, 95 % roll-off 2.6 kHz, peak −1.9 dBFS.
- **Why it matters:** Japanese station announcements have a very recognisable melody: high, flowing, falling at phrase ends, ending in a polite drawn-out 「ご注意ください〜」. Monotone blocks read as a vocoder toy, which undercuts the "real place" fidelity on the very lines the player hears most.
- **Fix:** in `formant.js`, implement pitch accent and declination. Per phrase: an F0 contour that starts high (+3 st), drops on each accented mora and falls 4–6 st at the phrase end. Glide (portamento) 30–60 ms between morae and add 4–6 Hz jitter. Gate the voicing source to zero in pauses (that kills the low buzz). Lengthen the final mora by 1.6×.

### 5. The crowd walla is a muffled rumble, not people
- **Evidence:** `bed_walla_14.wav`: centroid **356 Hz**, 95 % roll-off **732 Hz**, 16 s loop. Real station chatter has its intelligibility and consonant energy at 1–4 kHz. Scene totals: terminal roll-off 3.3 kHz (centroid 686 Hz in my run, 399 Hz in the lead's plot), street 2.3 kHz, platform 2.3 kHz, escalator 2.3 kHz.
- **Why it matters:** density is the core fantasy. A dense Namba concourse is bright and busy: heels on terrazzo, chatter, rolling suitcases, announcements bouncing off tile. Low-passed murmur sounds like a distant room behind a wall, and it actively flattens the transitions between zones.
- **Fix:** rebuild walla from 3 bands. (a) Low murmur (what exists now), (b) mid "syllable" grains at 0.8–3 kHz from formant fragments at random pitch, density ∝ `densityNear`, (c) sparse close-by fragments within 4 m: laughs, a phone voice, a child. Lift the walla bus roll-off to about 6 kHz in hard-surfaced spaces and keep it low only in carpeted or department moods. Aim for a terminal scene centroid of 1–1.5 kHz.

### 6. Shop BGM loops repeat every ~15 s, and NAMBAWALK is one loop per category
- **Evidence:** `mus_jpop.wav` 15.5 s, `mus_bossa.wav` 14.6 s, `mus_drug.wav` 13.6 s. Envelope autocorrelation peaks at 3.6–3.9 s (bar-level repetition, AC 0.53–0.60). `sources.js` budgets 6 music sources, chosen by category.
- **Why it matters:** NAMBAWALK is a 300 m corridor. At 1.5 m/s you spend minutes inside the same ~4-shop music field, so a 15 s loop repeats 10+ times. Repetition is the fastest way to make a "real place" feel like a game level.
- **Fix:** generate 60–90 s pieces (A/B/A'/C form with fills and variation) or vary loops per shop by seed: transpose, tempo ±6 %, instrument swaps. Add a drugstore jingle and a 100-yen-shop jingle (they are iconic). Desync identical categories.

### 7. The escalator is a 158 Hz drone; the iconic voice guidance is a single looping line
- **Evidence:** `loop_escalator.wav` centroid 158 Hz, roll-off 375 Hz, 6.4 s loop. In my movement traces a ride lasts 26–28 s (`esc_nk_down`, `esc_down`), so you hear the loop four times. `ESCALATOR` in `phrases.js` is one sentence.
- **Why it matters:** escalators are where the player has time to *listen*. Real ones add step-comb clicks (one per step ≈ 1.25 Hz at 0.5 m/s × 0.4 m steps), handrail squeak and the "手すりにおつかまり…" loop that alternates with English.
- **Fix:** add a step-click train synchronised to belt speed (one per 0.4 m of belt), with stereo position along the handrail. Add the handrail rubber hiss at about 2–4 kHz. Use 3 announcement variants that alternate ja/en, with the gap you'd expect from a cheap repeating speaker.

### 8. The player's feet are always "sneaker"
- **Evidence:** `audio.js _step()` hard-codes `fs:${surf}:sneaker:${i}`. The leather and heel recipes exist (`fs_tile_leather_2.wav`, `fs_stone_heel_0.wav`) and are used only in the crowd footstep cloud. The steps themselves are measured clicky: `fs_tile_sneaker_0` peaks at −0.9 dBFS with RMS −28.7 dB, a 28 dB crest. That's correct for a click, but it means every step is a transient spike over a quiet bed.
- **Why it matters:** this is a minor issue, but footsteps are the sound you hear most. Consider a 3–4 dB softer sneaker with a squeak layer on polished stone, which is the real "tourist in sneakers on terrazzo" sound.
- **Fix:** add a squeak layer at 1.5–3 kHz with 0–20 % probability on polished stone and tile (higher on turns, from `player:step` with a yaw-rate threshold). Ease the crest down by 3–4 dB.

### 9. Nothing marks zone transitions
- **Evidence:** ambience blends beds by ramp progress (good), but there is no "door" event. Walking from a passage into Namba CITY at the same level crossfades only through `moodOf(space)` changes. The 15:00-ish Parks canyon, the biggest wonder moment, gets `cityfar + leaves + birds`, and the garden scene measures **−33.5 dB RMS**, the quietest scene.
- **Why it matters:** the vision depends on contrast: underground enclosure → sunlight and air. That moment should *open up* sonically: a wide stereo field, wind, distant traffic washing in, the reverb tail vanishing.
- **Fix:** on the `player:zone` transitions indoor ↔ outdoor, trigger a 1.5 s "air" swell (a wind gust plus a high-shelf lift) and a 0.8 s reverb-send drop. Raise the garden bed by about 6 dB and add light music from the Parks stage plaza.

### 10. Mallet-style chimes everywhere: the Osaka Metro approach melody and the Nankai departure melody aren't distinct enough
- **Evidence:** `chime_pa.wav`, `mel_nankaiA.wav`: centroids 1033 / 1041 Hz, roll-off ~1.3–1.4 kHz, both peaking at about 1.05–1.17 kHz. They're the same timbral family.
- **Why it matters:** each operator's chime is a wayfinding cue in real life: you know which platform is announcing without reading.
- **Fix:** give each operator its own timbre and register. Metro approach: a bright synth bell around 2 kHz, 2-note up-down. Nankai departure melody: a fuller music-box or bell arrangement with a recognisable motif (original). Department store: the soft 4-note ding-dong. Do this in `music.js` by operator.

---

## Keep — this works
- **All-synthesized, worker-rendered, cached sound bank** with priority queueing: the architecture is right for a web game (`bank.js`, `worker.js`).
- **Occlusion by other level and by line of sight to the doorway** (420 Hz / 900 Hz low-pass) and distance-dependent reverb sends (`mixer.js`). The trains fix in notes (200 m tunnel leak) shows real listening discipline.
- **Train sound design:** a VVVF inverter whine (the classic gliding tones, visible at 1–2 kHz in the lead's `platform.png`), a roll and joints with tunnel-dependent low-pass; arrival rises from −34 to −13 dB. That's the right shape.
- **Closed shops are silent** (the 17:00 tempura bar). It's a lovely truth.
- **Ambience reads `crowd.densityNear`**, so density drives walla and the step cloud (`ambience.js:125`).
- **The PA duck** of the ambience and music buses during announcements.
- **Footsteps fire from `player:step` at heel strike**, per surface, with `final` closing steps and `player:land` comb-plate steps.

## Bugs found (with repro)
1. **`crowd:excuse` / `crowd:callout` are never voiced (or captioned).** Repro: walk into a queue at the Namba CITY B1 escalator (B1 −3, 49 → south) and bump people. Event logs fill with `crowd:excuse`, and there's no sound and no caption.
2. **NPC gate passes are silent.** Repro: stand at the Midosuji South Gate (B1 −116, −74) at 08:30 and watch NPCs pass. There are no beeps (no listener for `gate:pass`).
3. **TTS keeps speaking through the pause menu.** Repro: in Chrome with a ja-JP voice, open the pause menu during an approach announcement. `_pause()` only ducks master, and `speechSynthesis` keeps speaking at full volume. It is also not cancelled on tab hide.
4. **TTS announcements have no reverb and no position.** Repro: stand at the far end of the B2 platform. The PA volume scales, but it stays dry and centred.
5. **The phone notification sound plays twice per message:** `audio.js` plays `notify` on `phone:message`, and `phone.js notify()` *also* plays `phone_buzz` (mapped to the same `ui:notify` recipe). Repro: wait for Aya's first text. Two overlapping notification blips (0 – 1 frame apart) sum to +6 dB.

---

## Status check: sound lead's changes at 08:14–08:19 (code-read by critic-exp at 09:25; not re-rendered)
Most of this list was picked up within minutes. Here is what I can confirm from the code, and what is still open:
- **#1 barks:** DONE. `audio._bark` voices `crowd:excuse` (≤ 6 m, 1.2 s cooldown) and `crowd:callout` (≤ 14 m, 0.5 s stagger), with occlusion low-pass; excuses < 3 m are captioned. Call-outs are still not captioned (game.md #3).
- **#2 NPC gate beeps:** DONE. `_gatePass` handles `gate:pass` with a 6-voice cap per 0.6 s, gate_low every 25th pass and gate_fail at 1 %.
- **#3 TTS:** DONE. `useSpeech = false` by default, and `pauseSpeech` runs on pause.
- **#4 prosody:** ADDRESSED in code (accent phrases, declination, step-down after the accent nucleus). Not yet verified by render. Please re-run `voice2.png`; the gap buzz (energy < 200 Hz between words) needs checking.
- **#5 walla brightness:** PARTIAL (a "keep 1–5 kHz alive" lift in `formant.js` walla). Please re-measure `bed_walla`; the target is a centroid ≥ 900 Hz in hard-floored concourses.
- **#6 loops:** ADDRESSED (A / A′ / A″ sections, 3× length, and a drugstore earworm).
- **#7 escalator:** PARTIAL. 4 rotating ja/en lines are in. Step-comb clicks synced to the belt are not visible in the code; still open.
- **#8 footsteps:** ADDRESSED (12 % sneaker squeak on polished floors).
- **#9 indoor → outdoor:** ADDRESSED (`_zoneChange`: a gust plus a reverb dip). Garden bed level unknown.
- **#10 operator chime timbres:** not touched.
- **Bug 5 (double notify):** FIXED (`play()` de-dupes the same blip within a frame).

Provisional score after these changes: **6.5 / 10**. It stays capped until the crowd *sounds dense* where it *is* dense (walla vs `densityNear`), and until the formant PA is verified to sound like a station, not a toy.
