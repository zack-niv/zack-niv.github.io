# v2 Sound (items 2 and 3)

Owner files: `js/audio/*`. Status: done, verified headless (see "How to test").

## What changed

### 2. The PA no longer babbles
* **Every synthesized word is gone.** The `voice:` and `bark:` recipes were removed from `recipes.js`;
  `formant.js` survives only for `walla` (the crowd murmur texture, not speech). The old chatter lines are cut.
* `announcer.js` is rewritten around `window.speechSynthesis`:
  **station chime (synth) -> Japanese line (ja-JP voice) -> English line (en-* voice)**.
  * no ja-JP voice: the English line only. No voice at all (or `settings.speech = false`): chime + caption only.
  * Voices load async: `refreshVoices()` runs at construction, on `voiceschanged`, and polls every 2 s for the first
    minute. Ranking prefers Nanami / Kyoko / O-ren / Haruka / Google 日本語 for ja and Aria / Jenny / Samantha /
    Google US English for en (macOS novelty voices are excluded).
  * speechSynthesis needs a user gesture: `Audio.resume()` (title click) calls `announcer.unlock()`, which speaks one
    silent utterance. An utterance the browser rejects (`not-allowed`) is skipped, never retried.
  * **Never overlaps.** One `cur` item walks chime -> ja -> en. Queue of at most 5, sorted by priority
    (train 0, station/platform 1, crowd 2, escalator 3, shop 4, ambient 5). A train/station line interrupts anything
    lower. Items go stale (`maxAge`: train 30 s, station 20 s, escalator 10 s, shop 4 s, crowd 1.6 s) and are dropped, not
    spoken late. A newer line of the same `group` (trainId + kind) replaces an older waiting one. Items that are inaudible
    when their turn comes are dropped.
  * Captions: the announcer emits one `caption` event (speaker `PA`) at the moment the chime starts, only for lines that
    would be audible. Lines that arrive via the transit `announce` event are captioned by the HUD, not by us (as before).
* `phrases.js` is rewritten: short, real phrases. Fallback train lines (used only when there is no transit system) e.g.
  `まもなく、1番線に、関西空港行き、特急ラピートが、まいります。` / "The limited express Rapi:t bound for Kansai Airport is
  now arriving at track 1." (TTS reads `Rapi:t` as "Rapito"). Transit's own long `announce` texts are spoken by their
  first two sentences only (`firstSentences`).
* **Gate / escalator / shop / restaurant lines**, same treatment:
  * escalator landing speaker: one safety line (JA then EN, real wording: エスカレーターをご利用の際は、手すりにおつかまり
    ください。) when you come within 12 m, repeated every 50-70 s while you stay; was a babbling loop.
  * conbini door: chime + occasional "いらっしゃいませ" (real voice, by distance).
  * crowd `crowd:excuse` -> "すみません" / "失礼します"; `crowd:callout` -> "いらっしゃいませ" (cooldowns 2.5 s / 6 s, queued behind PA).
  * 6F dining: a short "いらっしゃいませ / ありがとうございました / お待たせいたしました" now and then, low volume by distance, or a plate clink.
  * IC-card gate beeps are not speech: unchanged (`gate:pass`, `crowd:gate`, `ic:tap`).
  * Ambient PA ("Thank you for using the Midosuji Line" ...) is rarer (70-150 s), faint (gain 0.28) and uncaptioned.

### 3. Area-gated trains and PA, per-area soundscapes
* New `js/audio/zones.js`:
  `platformGain(platformSpace, listener)` is 1 on the platform, ~0.2 on the concourse directly above (inside the
  platform footprint +6 m, smooth in height over 2.5-5.5 m), ~0.1 below, 0 elsewhere. Nankai's platforms sit in an open
  3F shed, so they fall off with distance on the same level instead (30 m, exponent 1.6).
  `platformLeak(L)` is the strongest platform bleed you are not standing on. `pointGain` is the distance law for point
  speakers (other levels: 0 beyond 8 m).
* **Trains** (`trains.js`): `_hears(s)` is now the platform gain; it scales roll, motor, one-shots, tunnel wind, door
  chimes, melodies and the (muffling) low-pass. The old "same level 0.4 / adjacent level 0.3 anywhere" leak is gone, so
  trains are silent away from their platform.
* **PA volume from distance/zone:** `utterance.volume = gain * platformGain|pointGain * voice * master`, evaluated when
  each utterance starts (an utterance cannot change volume while it speaks). A train line is only started when the
  player is in or near that platform's zone (volume >= 0.06).
* **Ambience** (`ambience.js`): mood weights are now smoothed in time (~1 s time constant) on top of the existing
  layer fades, so walking from one soundscape to the next cross-fades. New `dining` mood. Platform bleed adds faint
  tunnel rumble upstairs. Distant train rumbles roll through platform areas. Shop BGM level is scaled per area
  (`MUSIC_K` in `sources.js`).
* New: `ctx.audio.paVolume(announcePayload)` (0..1) so the HUD can caption only what is audible (see requests).

## Zone table

| Area (mood) | Where | Beds (gain) | Events | PA / voice |
|---|---|---|---|---|
| platform (`platform`) | Midosuji / Sennichimae B2 | tunnel wind .50, aux hum .07, hvac .14, walla .38 | trains (roll, VVVF, doors) at full level, distant tunnel rumbles | train PA full volume |
| Nankai platform (`nkplatform`) | 3F nk_plat_1-4 | hvac_big .12, aux .10, tunnel .14, cityfar .16, walla .40 | trains, suitcases x2.2, distant rumbles | train PA full volume |
| bleed (any non-platform) | directly above a platform / near a Nankai platform | + tunnel .34 x gain, aux .05 x gain | trains at gain 0.2 (above) or distance falloff (Nankai concourse) | train PA at volume = gain (about 0.2 above) |
| gate hall (`metro`, `terminal`) | B1 concourses, Nankai 3F/2F/1F | hvac .28, walla .55 / .50 | gate beeps (`gate:pass`), footstep cloud | ambient PA only |
| underground passage (`passage`) | link | hvac .28, walla .45 | shop BGM x.9 | - |
| NAMBAWALK (`arcade`) | B1 walk | hvac_arcade .30, walla .65 | shop BGM leaking x1.0, chatter | ambient PA |
| Namba CITY (`mall`) | city B1-2F | hvac_mall .26, mall bgm .11, walla .45 | shop BGM x.6 | ambient PA |
| Namba Parks interior (`parks`) | Parks 2F-5F | hvac_mall .22, bgm .09, walla .38 | shop BGM x.5 | - |
| Parks canyon (`canyon`) | 2F canyon, bridges, 6F+ skywalks | cityfar .38, leaves (wind) .34, water (fountain) .12, traffic .07, tunnel (low wind) .05, walla .26 | birds, crows, gust on stepping outside | - |
| Parks garden (`garden`) | 3F-8F gardens | leaves .50, cityfar .34, water .16, walla .14 | birds | - |
| 6F+ dining (`dining`) | `parks_dining` halls, restaurant rooms | kitchen .20, sizzle .15, fry .10, walla .34, hvac .08 | plate clinks, tempura / grill sources | short "irasshaimase" calls by distance |
| shop (`shop`) | non-restaurant rooms | hvac_mall .12, walla .20 | - | - |

## How to test

```js
// in the page (node tools/loadprobe.mjs loads ?test; with ?test the AudioContext starts at once)
const n = window.__namba;
n.teleport('start');                       // or 'midosuji', 'walk', 'city_b1', 'canyon', 'parks_6f', 'garden' ... or {level,x,z,yaw}
for (let i = 0; i < 30; i++) n.audio.update(0.2);   // settle the cross-fade without waiting
n.audio.debug()
// { zone:{level,zone,space,kind,mood,area,y}, weights:{mood:w}, layers:{bed:targetGain}, loading:[beds not synthesized yet],
//   platformLeak, people, trains:[{id,phase,hear}], acoustic, sources,
//   pa:{ voiceCount, ja, en, useSpeech, queue, cur, last:{kind,ja,en,vol,voiceJa,voiceEn,spoken:[{lang,voice,vol,text}]}, log } }
n.audio.paVolume({ line:'midosuji', track:'m_track1', level:'B2' })   // 0..1 for an announce payload
n.events.emit('announce', {...})            // drive the PA by hand (see js/world/transit.js for the payload shape)
```
Headless Chromium has no speech voices (`pa.voiceCount === 0`): the PA then degrades to chime + caption and `pa.log` shows
`start train vol=...`. To test the speech path I stub `window.speechSynthesis` / `SpeechSynthesisUtterance` with
`page.addInitScript` (fake ja-JP + en-US voices that record `speak()` calls and fire `onstart`/`onend`); the stub
checks ja-then-en order, volumes and that no two utterances overlap.

## Verified (headless, results in the summary below)

Headless Chromium (swiftshader, `?test&quality=low`), zero audio errors (the only console error is the unrelated
`net::ERR_CERT_AUTHORITY_INVALID` for an external resource that every page in this sandbox logs).

Zone / bed targets via `audio.debug()` after teleporting (target gains; `loading` = still being synthesized by the worker):

| Teleport | zone.space -> mood / area | bed targets | platform leak |
|---|---|---|---|
| `start` | nk_plat_2 -> nkplatform / platform | hvac_big .12, aux .10, tunnel .14, cityfar .16 | 0 |
| `nankai_gate` | nankai_3f_concourse -> terminal / gate hall | hvac_big .28 + tunnel/aux bleed | .49 |
| `nankai_2f` | nankai_2f -> terminal | hvac_big .28 | .02 |
| `midosuji` | m_platform -> platform | tunnel .50, aux .07, hvac_tile .14 | 0 |
| B1 above the platform | m_paid -> metro / gate hall | hvac_tile .28, tunnel .068, aux .01 | .20 |
| `walk` | walk_main -> arcade / NAMBAWALK | hvac_arcade .30 | 0 |
| `city_b1` | city_b1_main -> mall / Namba CITY | hvac_mall .26, bgm .11 | 0 |
| `canyon` | parks_canyon -> canyon | cityfar .38, leaves .34, water .12, traffic .07, tunnel .05 | 0 |
| 6F dining hall / restaurant room | parks_6F_dining / parks_6Fdw01 -> dining | kitchen .20, sizzle .15, fry .10, hvac_mall .08 | 0 |

Train audibility (`debug().trains[].hear`): on the Midosuji platform 1.0 for its tracks and 0 for every Nankai track;
directly above 0.2; NAMBAWALK 0; Nankai start platform 1.0 for its own tracks, 0.38 for the neighbouring platform's.

Cross-fade (NAMBAWALK -> platform teleport, 0.25 s steps): arcade/platform weights 1/0, .78/.22, .61/.39, .47/.53, .37/.63,
.29/.71 (clamped dt, ~1 s time constant), tunnel target .11 -> .36 while hvac_arcade falls .23 -> .09.

PA with a stubbed speechSynthesis (fake ja-JP + en-US voices), `announce` events:

| Case | paVolume | Spoken |
|---|---|---|
| Nankai platform, approach | 1.0 | ja-JP (v0.8), then en-US (v0.8) |
| same, only an en voice | 1.0 | en-US only |
| same, no voices | 1.0 | nothing (chime + caption) |
| Midosuji platform | 1.0 | ja, en |
| concourse directly above | 0.2 | ja, en at v0.16 |
| NAMBAWALK | 0 | nothing (dropped) |
| burst: approach + arrive + escalator at once | - | approach ja/en, arrive ja/en, escalator ja/en (v0.64); `overlap` never true |


## Requests / notes for other owners
* **Flow (HUD)**: `hud.paAudible(payload)` decides which PA lines get captioned. For `announce` events it should defer
  to `ctx.audio.paVolume(payload) > 0.06` so a line that is not spoken (you are elsewhere) is not subtitled.
* **Flow+Transit**: spoken Nankai approach text is currently `まもなく、7番線に、電車がまいります。…` (no destination in
  the first sentence). The spec'd PA reads better as
  `まもなく、{no}番線に、{destJa}行き、{typeJa}が、まいります。` / "The {typeEn} bound for {destEn} is now arriving at track
  {no}." as the *first* sentence, because we speak only the first two sentences.
* `ctx.teleport` does not refresh `player.space` until the next player tick; audio now locates the body itself
  (`world.locate`) so it is correct immediately.

## What I am unsure about
* I cannot listen in headless: the voice choice, pitch/rate (ja 0.95/1.05, en 0.93/1.0) and the level of speech relative
  to the Web Audio mix (speech volume = zone gain x voice x master, linear) need a human ear on a real browser.
* Chrome's remote Google voices can be slow to start (we wait up to 3 s for `onstart`, then skip) and ignore `volume`
  changes mid-utterance (we only set it at the start).
* Nankai concourse bleed (gain ~0.5 right at the gates) is a judgement call: it is an open shed, so trains are loud there.
