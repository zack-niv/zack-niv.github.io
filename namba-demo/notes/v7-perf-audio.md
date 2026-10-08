# v7 Perf + Audio (items 1 and 5)

## Item 1: hidden FPS overlay

**Key: Ctrl+Shift+F, or F3.** `?perf` in the URL starts it on. Off by default.

- `js/ui/perf.js` (new). Loaded by one line in `js/main.js` after the live systems
  (`import('./ui/perf.js').then(m => ctx.perf = new m.Perf(ctx))`). It is deliberately NOT a `SYSTEMS` entry: the loader's
  `finish(name)` / `stage()` sum `STAGES[k]` for every finished key and would throw on an unknown stage name.
- Keys: a capture-phase `keydown` on `window`. `Ctrl+Shift+F` is not bound by the game (`input.js` only knows KeyE/Enter, KeyQ/Tab/M,
  Escape, KeyC, WASD, Alt) and is not a Chrome shortcut; F3 is unused in the game (it is "find next" in browsers, we `preventDefault`).
  F3 is ignored while typing in an input (phone search); the Ctrl+Shift+F combo works everywhere.
- Overlay (top-left, 11 px monospace, translucent, `pointer-events:none`):
  `fps  avg ms  p95 ms / draw calls  triangles / quality tier (@drs when < 1)  levels N  gpu ms (if the timer extension exists)`.
  FPS = 1 / mean frame interval over the last 1 s; avg and p95 over the last 2 s; text refreshes twice a second.
- Calls / tris are `engine.stats` (the main scene pass, what `callBudget` is tuned against). Levels = `visibility.visibleLevels.size`.
- Cost when off: zero. No DOM node and no rAF until the first toggle; the meter is its own `requestAnimationFrame` loop (real rAF
  intervals, so it also sees long frames the game loop clamps to 50 ms) that is cancelled again when the overlay is hidden and no
  sample is running. It keeps running while the game is paused (it is independent of the game tick). Tab hide/show restarts the meter.
- Test API: `window.__namba.perf.sample(seconds = 3)` returns a Promise of
  `{ fps, avgMs, p95Ms, maxMs, frames, calls, tris, quality, drs, levels, visibleLevels, gpuMs }` (resolves after `seconds` AND at
  least 2 frames, so it also works on a slow software renderer); `perf.snapshot()` is the synchronous last-2-s version;
  `perf.show(true|false)`; `perf.on`.

## Item 5: platform PA clearly audible

All in `js/audio/announcer.js` (+ small hooks in `mixer.js`, `trains.js`, `audio.js`).

| What | Before | After |
|---|---|---|
| Speech utterance volume on a platform | `vol * voice * master` = 0.8 at the default master | `min(1, sqrt(master)*1.1)`: 0.96 to 1.0 on the platform (item has `platform`); other voices unchanged |
| PA chime (`chime:pa`) gain | 0.55 | 0.85 for platform lines (others 0.55) |
| Train melodies (metro approach, Nankai departure) gain | 0.5 to 0.55 | 0.75 to 0.8 (`trains.js`) |
| Bed ducking while a platform line plays | ambience + music -5 dB (0.55), tc 0.25 s | ambience + music **-9 dB** (0.355), sfx **-3 dB** (0.7), both dry and the reverb send; attack tc 0.1 s (about 0.3 s to settle), release tc 0.33 s (about 1 s) after a 0.7 s hold so back-to-back lines do not pump |
| Concourse above / elsewhere | faint / silent | unchanged (zones.js `platformGain`: 0.2 above, 0 elsewhere). The duck scales with how audible the platform is, so above it only dips to 0.87 (-1.2 dB); elsewhere the line is dropped and nothing ducks |

Other fixes made on the way:
- `_speak` now try/catches utterance creation: a bad voice object used to throw on every frame, leaving the PA slot (and the duck)
  stuck forever. Now the part is skipped.
- `mixer.js`: each bus has a `wetDuck` gain between `bus.wet` and the reverb input, so the announcer ducks the reverb send too (a
  dry-only duck would leave the beds' reverb tail at full level, which on a platform is half the bed).
- `audio.testPA()`: speaks a Japanese train line from whichever platform is loudest where you stand (returns `{platform, gain}` or
  null when none is audible). `audio.debug().pa.duck = { amb, sfx, ambDb, gains:{ambience,music,sfx} }` shows the live duck.
  (`gains` are AudioParam values: a bus with no live source is not processed and can read stale.)

### Verification (headless, `speechSynthesis` stubbed with a ja-JP voice, announcer driven at 10 Hz; `audio.debug()` readouts)

| Where | testPA | PA volume (`pa.last.vol`) | utterance volume | bed duck (ambience/music/sfx) |
|---|---|---|---|---|
| Nankai 3F platform nk_plat_2 | `{nk_plat_2, gain 1}` | 1.0 | 0.96 (master 0.8 in the harness) | 1 -> 0.362 at +0.5 s -> 0.355 / 0.355 / 0.70 during; 0.445 at +0.5 s after the line; 0.994 at +2 s; 1 at +5 s |
| Midosuji B2 platform | `{m_platform, 1}` | 1.0 | 0.96 | same (0.366 -> 0.355), released in about 2 s |
| B1 concourse above Midosuji | `{m_platform, 0.2}` | 0.2 | 0.19 | 0.871 / 0.871 / 0.94 (-1.2 dB), faint |
| 1F street | `null` | dropped (inaudible) | none | 1 / 1 / 1, nothing spoken |

Before this change the same platform line was spoken at 0.8 with the beds only at 0.55.
Real ja-JP voices could not be tested headless (no voices): the stub only shows the volumes we hand to `speechSynthesis`.

## Unsure about

- The depth (-9 dB) and the 0.7 s hold are judgement calls; the constants `PA_DUCK`, `DUCK_ATTACK`, `DUCK_RELEASE`, `DUCK_HOLD`,
  `PLAT_CHIME` are at the top of `announcer.js`.
- Speech is outside Web Audio: the browser's volume tops out at 1.0, so "louder" is the 1.8 dB gain plus a -9 dB bed. If it is
  still shy on Zack's laptop, the next lever is more duck on the `sfx` bus (train rumble/roll are `sfx` emitters).
- Frame-rate numbers in this sandbox are SwiftShader (several seconds per frame); the overlay itself was verified for format and
  behaviour only. Real-GPU FPS is still for Zack to read.

## Evidence

- Screenshot: `notes/v7-shots/perf/overlay_high.png` (`?perf`, high, Nankai 3F: 730 calls, 988k tris, levels 4; the "0.0 fps /
  27749 ms" is SwiftShader, not the game).
- `node tools/loadprobe.mjs`: `READY 46.2s []` (no regression; the perf import adds one tiny module after the live systems).
- `node tools/shot.mjs --extra "&perf"`: only the sandbox's `ERR_CERT_AUTHORITY_INVALID` and GL driver warnings; `ctx.errors` empty.
- Probe script (not in the repo): stubbed `speechSynthesis`, `audio.update` driven at 10 Hz, `audio.testPA()` per scenario.
