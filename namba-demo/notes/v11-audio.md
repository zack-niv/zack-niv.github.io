# v11 Audio (item 5): announcements must be heard

Zack: "ambience sounds is still high enough to not hear train platform / other Namba areas announcements. they are key for
making the place feel realistic."

Files touched (all `js/audio/`): `mixer.js`, `announcer.js`, `ambience.js`, `phrases.js`, `zones.js`.
New tool: `tools/audioprobe.mjs` (level probe, below).

## What was wrong (root causes, not just "too loud")

1. **Beds were loud for the job.** Nothing sat under the bed bus except the user's slider, so the walla, step cloud and HVAC
   stayed at about -33 dBFS RMS in the zones that matter.
2. **The non-platform announcements were nearly inaudible by design.** The "distant PA" on the concourses, CITY, the arcade
   and Parks was `kind: 'ambient'`, `gain: 0.28` (speech volume handed to the browser: about 0.24), **not ducked at all**
   (prio 5 skips the duck), no caption, every 70 to 150 s, and absent from the Parks canyon and garden. Only platform train
   lines were ever loud. That is the "other Namba areas" half of the feedback.
3. **The duck came with the chime, not before it,** and let go 0.7 s after the line. Delayed platform lines (Midosuji
   melody, Nankai departure melody, 4.5 to 6 s lead-in) played their melody over a full bed and ducked only when the
   speech item started.
4. **The Nankai shed fell off too fast.** 10 m from the platform edge you heard a train line at 0.52 (speech volume 0.48).

`speechSynthesis` cannot be made louder or routed, so the levers are everything else.

## Changes

| Lever | Before (v10) | After (v11) |
|---|---|---|
| Ambience bus trim (fixed, under the slider; `BUS_TRIM` in `mixer.js`) | 0 dB | **-6 dB** |
| Music bus trim | 0 dB | **-5 dB** |
| Duck under a platform / area PA: ambience and music | -12 dB (0.25) | **-15 dB (0.18)** |
| Duck under PA: sfx (rolling stock, doors, brakes) | -9 dB (0.355) | **-10.5 dB (0.30)** |
| Duck lead | starts with the chime | starts **0.45 s before the chime**; delayed platform lines duck the beds to -9 dB (0.35) from the first melody note |
| Duck release | hold 0.7 s, tau 0.33 s | hold **1.0 s**, tau **0.45 s** (about 1.4 s swell back) |
| Area PA (concourse, gate halls, arcade, CITY, Parks, canyon) | `ambient` kind, gain 0.28, **no duck**, no caption | `station` kind with `pa: true`: gain **0.85 to 0.95** (canyon 0.55), full PA duck, PA chime level, **EN caption** on the `ambient` channel |
| Speech volume handed to the browser, area PA | about 0.24 | **0.89 to 0.98** (same square-root master curve the platform uses) |
| Nankai shed falloff (`zones.js`) | `(1 - d/30)^1.6` | `(1 - d/38)^1.4` (10 m: 0.52 to 0.65, 20 m: 0.17 to 0.35) |

Net effect on the bed during a line: **-6 dB trim and -2.9 dB deeper duck = about 9 dB lower than v10** on ambience, 8 dB on
music, 1.5 dB on sfx; on a non-platform area line the bed went from **not ducked** to **-15 dB** (about 21 dB below the v10
bed with the trim). Outdoors (canyon) the duck is scaled by the line's gain (0.55), so it dips about 5 dB: it is meant to
feel like a terrace speaker, not a station.

### Area PA lines (`AREA_PA` in `phrases.js`, replaces `AMBIENT_PA`)

Reuses the existing announcer, chime, caption channel and `cooldown`; one table, one timer in `ambience.js _events`.

| Mood (where) | Lines | Every | First after arriving | Gain |
|---|---|---|---|---|
| metro, passage (Midosuji / Sennichimae gate halls, B1 passages) | 5 (line on schedule, no walking with phone, don't stop at gates, no smoking, belongings) | 38 to 64 s | 14 s | 0.95 |
| terminal (Nankai concourse) | 5 (Nankai on schedule, Rapi:t all-reserved, luggage, thanks, phone) | 36 to 60 s | 12 s | 0.95 |
| arcade (NAMBAWALK) | 3 | 48 to 80 s | 18 s | 0.85 |
| department (Takashimaya, food hall) | 3 | 55 to 90 s | 20 s | 0.80 |
| mall (Namba CITY) | 5 (thanks, lost child, phone, elevator priority, belongings) | 46 to 76 s | 16 s | 0.90 |
| parks (Parks interior) | 4 (thanks, Parks Garden, lost child, escalator children) | 52 to 84 s | 18 s | 0.85 |
| canyon (open-air Parks) | 2 (planting beds, welcome) | 70 to 110 s | 30 s | 0.55 |
| platform / nkplatform (between trains, on the platform only) | 3 each (don't run, mind the gap, yellow line, doors) | 40 to 70 s | 20 s | 1.0, `platform: space` |
| shop, dining, garden, street | none (silent on purpose) | | | |

A notice only starts when the announcer is idle and at least 6 s after the last line ended (never over a train line, never back
to back), otherwise it retries in 3 to 6 s. It never repeats the previous line of that mood. Train lines come from transit as
before (about 43 `announce` events in 186 s across all 12 tracks, so a platform already hears a line every 10 to 30 s; the
platform fill-ins mostly land in the gaps).

## Measurements

Tool: `node tools/audioprobe.mjs --out file.json --ff 300` (analyser taps on each bus output, the master and the limiter;
stubbed ja voice, speech phase only; legacy = the v10 constants switched at runtime in the same page at the same crowd, so
the comparison is like for like). Headless crowd around the teleport point is thin (ppl 0 to 15), so absolute beds are lower
than on a real floor: read the deltas. Machine load was about 20 for all runs (the game ran at a few fps; waits are on state,
not on seconds). Raw: `notes/v11-audio.json` is not kept; the log is reproduced below.

Ambience bus RMS (dBFS), between announcements, legacy then v11:

| Zone (spawn) | Bed legacy | Bed v11 | Delta | During a PA line, legacy | During a PA line, v11 | Delta |
|---|---|---|---|---|---|---|
| Nankai platform (`start`, train line) | -33.0 | -37.2 | -4.2 | -45.8 | -51.7 | -5.9 |
| Midosuji platform (train line) | -27.8 | -34.1 | -6.3 | -39.1 | -47.9 | -8.8 |
| Midosuji platform (area line) | | | | -38.7 | -47.4 | -8.7 |
| Namba CITY 1F (area line) | -34.8 | -39.7 | -4.9 | -43.3 (true v10: not ducked, -34.8) | -50.6 | -7.3 (-15.8 vs true v10) |
| Namba CITY 2F (area line) | -33.4 | -39.2 | -5.8 | -42.8 (true v10: -33.4) | -50.2 | -7.4 (-16.8 vs true v10) |
| Parks canyon (area line, gain 0.55) | -31.1 | -37.4 | -6.3 | -33.8 (true v10: no line) | -39.5 | -5.7 |
| Nankai concourse at the gates (`nankai_gate`) | -47.3 | -42.6 | n/a | | | train sfx and a live train line landed in the windows; not a clean pair |

Notes on reading this: the "legacy" area rows ran the new code path with the old duck constants, so they already include the
new `pa` duck; the "true v10" figure is what v10 did (no duck on the ambient PA). The bed deltas scatter by about 2 dB
around the exact -6.0 because footstep grains and distant rumbles land differently in a 6 s window. Music bus (CITY): -40.1
to -43.4 (1F), -39.0 to -43.4 (2F), expected -5.

Duck depth (settled gain factor on the ambience bus, as read from the announcer): platform lines 0.25 to **0.18** (-12 to
-14.9 dB); sfx 0.355 to **0.30**; CITY area line 0.32 to **0.26** at gain 0.9 (scaled by audibility); canyon 0.59 to 0.55 at
gain 0.55. Previously a non-platform area line ducked nothing.

PA level: chime on the voice bus about -17 to -19 dBFS RMS at the platform (series sample), i.e. about 35 dB above the ducked
bed (-53 dBFS); limiter peak never above -3.3 dBFS in any run (the loudest was the Midosuji platform with a train in the
tunnel). Speech volume handed to `speechSynthesis`: platform 0.98, nankai_gate (shed, 10 m) **0.62 (was 0.48)**, CITY area
0.89 (was about 0.24), canyon 0.54.

Cadence, fast-forward of 300 game seconds per zone (area notices only; train lines are not simulated there), starts at:

| Zone | v10 | v11 |
|---|---|---|
| Nankai platform | about 2 per 300 s, unducked, quiet | 6: 1, 56, 112, 154, 217, 279 s |
| Nankai concourse | about 2, quiet | 5: 13, 72, 112, 206, 250 s |
| Midosuji platform | about 2, quiet | 5: 9, 52, 122, 168, 273 s |
| CITY 1F | about 2, quiet | 5: 14, 86, 137, 202, 271 s |
| CITY 2F | about 2, quiet | 5: 24, 73, 138, 211, 260 s |
| Parks canyon | none | 3: 30, 129, 223 s |

(The "1 s" start on the Nankai platform is the game-start arrival line already pending, not a fill-in.)

## What I am unsure about

- **The speech itself is not measurable** (outside Web Audio; headless has no ja voice). The ratio to the bed is reasoned, not
  measured: the bed is now about 20 dB below its v10 level while a line plays and the voice is at the browser's maximum on a
  platform and at 0.85 to 0.98 elsewhere. If it is still shy on Zack's machine, the next lever is the OS voice (log
  `audio.debug().pa.last.voiceJa`), not another dB of duck.
- **Between lines the beds are 5 to 6 dB quieter than v10.** Crowd and mall music sit further back; the vibe is intact in the
  numbers (all beds still -34 to -40 dBFS in thin crowds) but a full real crowd will be louder than headless. If it feels thin,
  raise `BUS_TRIM.ambience` to 0.56 (-5 dB).
- **Cadence.** About one notice a minute per area plus the train lines may feel busy on a long stay; every interval lives in
  `AREA_PA` (`every`, `first`) and is one-line to relax. Captions are on the `ambient` channel (small, top-left, low contrast).
- Japanese lines are my own, in the register of real Metro / Nankai / mall PAs; worth a native read before any wider push
  (the lost-child lines in particular).
- Aya and the player's phone are not ducked; an area notice can start while the phone is up. I left the story layer alone.

## Verification

- `node tools/loadprobe.mjs`: see the lead's report (READY, `[]`).
- `node tools/audioprobe.mjs --ff 300`: `errors []`, no clipping (limiter peak at most -3.3 dBFS).
- Caption screenshot of an area line in CITY 2F: `notes/v11-shots/audio/area-pa-caption-city2f.png`.
