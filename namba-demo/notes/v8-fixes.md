# v8 Fixes (items 2, 5, 7) — owner: Fixes agent

Files touched: `js/audio/announcer.js`, `js/game/game.js` (gate prompt only), `index.html`, `js/core/loader.js`, `css/game.css`.
`js/ui/title.js` needed no edit (its markup already had the right two lines; the sizes swapped in `css/game.css`).

## Item 5: "Tap your ICOCA" at the escalator foot (root cause + fix)

**Root cause.** A body riding a ramp keeps the level it entered from until the foot. The Nankai 3F->2F escalators
(`esc_nk_3/4`, foot at z -67) end 1 m before the 3F central gate line (z -66), so for the last ~1.4 m of the ride you are still
"on 3F", 1 to 2.4 m from the gate line and facing south toward it. `transit.gateLaneNear` (reach 2.4 m) answered, `_gateTarget`
accepted it, and the `gatetap` prompt showed until the level flipped at the foot. The same applies at every gate next to a ramp
(Midosuji/Sennichimae stair heads).

Reproduced on the v7.4.1 tree (`?test&play`, walk script down the down-lane, per tick, `.h-prompt`):

| | prompt frames while riding | trace |
|---|---|---|
| before | **21 of 333** | z -68.37, 3F, ramp 21: `gatetap` "Tap your ICOCA" on, until the level flips to 2F at z -66.98 |
| after | **0 of 333** | no target on the ramp, none at the foot |

**Fix (`js/game/game.js`, `_gateTarget` only).** (1) No gate target while `body.ramp >= 0`. (2) Only within `GATE_PROMPT_M = 1.6` m of
the line (was gateLaneNear's 2.4 m), still while facing it. `gates.js` and the tutorial step are unchanged (the step keys off the
same `_gateTgt`, so it follows).

**Targeting sweep** (every channel of every gate, both sides, facing the line, via `game._gateTarget`):

| gate | poses per distance | 0.6 m | 1.0 m | 1.5 m | 2.0 m | on a ramp (1.0 m) |
|---|---|---|---|---|---|---|
| g_nk_central | 132 | 132 | 132 | 132 | **0** | **0** (was 132) |
| g_m_north | 72 | 72 | 72 | 72 | **0** | **0** (was 72) |
| g_m_south | 72 | 72 | 72 | 72 | **0** | **0** (was 72) |
| g_s | 100 | 100 | 100 | 100 | **0** | **0** (was 100) |

**3 gates with a real `KeyE` keydown** (same before and after, 1.2 m out, facing the line): Nankai central lane 9 (paid side):
prompt, E -> `ic:pay 970`, `gate:tap`; Midosuji north lane 4 (free side): prompt, E -> `gate:tap`; Sennichimae lane 4 (paid side):
prompt, E -> `gate:tap`. Tutorial step `gate` was the current step at Nankai.

Screenshots (`notes/v8-shots/fixes/`): `5-nankai-gate-prompt-after.png` (prompt still shows at a lane), `5-escalator-foot-after.png`
(2F foot, no prompt; the camera ends up facing a poster wall, the numeric trace above is the real evidence). The "Click to
look around" chip is the test harness's stubbed pointer lock, not the game.

## Item 2: louder Japanese announcements

**What can and cannot be measured.** The Japanese line goes through `speechSynthesis`, outside Web Audio: its volume is capped at
1.0 and its loudness is the OS voice's. Headless has no ja voice, so I cannot read the speech level; I measured the beds (analyser
on the limiter output and on each bus) and the volume handed to the browser. v7 already sends utterance volume 0.96 to 1.0 on a
platform, so the only lever left is what sits under it, plus not dropping the line.

Measured on nk_plat_2 (start platform), `testPA()`, RMS dBFS (`notes` harness: stubbed ja voice, analysers on `mixer.lim` and the
bus outputs, real-time game loop with rendering off):

| | before (v7.4.1) | after (v8) |
|---|---|---|
| ambience bed before the line | -35.8 dBFS | -35.2 (same bed) |
| duck on ambience + music (+ reverb send) | 0.355 (-9 dB) | **0.25 (-12 dB)** |
| duck on sfx (train rumble, brakes, doors, rolling stock) | 0.70 (**-3 dB**) | **0.355 (-9 dB)** |
| bed level during the line | -35.8 - 9 = about -45 | -35.2 - 12 = about -47 |
| PA chime on the voice bus | -16.6 dBFS (about 19 dB over the bed) | -16.5 (unchanged) |
| utterance volume to `speechSynthesis` on the platform | 1.0 | 1.0 (cap) |
| no-start deadline before the line is skipped | 3 s | **6 s** |

Why sfx is the real fix: on the platform the PA is about the train, and the train is all `sfx`. v7's -3 dB left the loudest thing
in the soundscape almost untouched exactly while the line is read. The headless platform has no train sounding, so that gap is not
visible in the bed numbers above (sfx = silent in the run); it is the reasoning, not a measurement. The 3 s deadline: online or
"natural" ja voices (Edge Nanami Online, Google 日本語) can take longer than 3 s to start, and a missed deadline silently dropped the
whole line. Faint on the concourse above (platformGain 0.2, duck only about -1.4 dB there) and silent elsewhere is unchanged
(`zones.js` untouched; the debug log shows other platforms' lines at 0.38 and 0.22 on this shed, as designed).

Constants: `PA_DUCK` and `c.uDeadline` in `js/audio/announcer.js`.

## Item 7: one loading title, "Lost in Namba"

**Cause.** `index.html` painted なんば (huge) + "LOST IN NAMBA"; `loader.js` then replaced the whole `#loading` with its own markup
(なんば huge + "NAMBA"), restarting the entrance animation. The title screen then showed big なんば + "Lost in Namba" again.
Measured before: text changed from `なんば LOST IN NAMBA Loading…` to `なんば NAMBA SURVEY …` at 0.14 s -> 0.54 s.

**Fix.**
- `index.html` now paints the full loading screen (same classes and markup as the loader builds). `loader.js` adopts it as is (only
  builds it if absent), so nothing is replaced and no animation restarts. Keep the station list in sync with `STATIONS`.
- `css/game.css` (loaded after `style.css`): "Lost in Namba" is the big title; なんば is a small spaced accent above it. The title
  screen uses the same hierarchy (`.t-latin` hero, `.t-kana` accent), so there is no different title from first paint to the end.
- Measured after: title text is `なんば Lost in Namba …` at first paint (JS blocked), mid-load and at the title.

Screenshots: `notes/v8-shots/fixes/7-first-paint-0.5s.png` (JS blocked, 0.5 s, mid-fade-in), `7-mid-load.png` (42%).
`7-loader-at-100pct.png` (loader at 100%, real load, same title), `7-title-screen-static-1280.png` (the title screen's own markup
rendered statically over a grey backdrop, no world: I could not catch the real title screen frame because the loaded sandbox
takes minutes per run; titles logged from first paint: only the CSS-arrival text-transform differs).

## Checks and risks
- `node tools/loadprobe.mjs`: `READY 168.6s []` (machine load average about 19; the same page was `READY 46s` unloaded in v7, the loader changes add no work)
- `node tools/mouseshot.mjs`: free chip, pause menu (2 contact links), backdrop click resumes, phone with mouse chip: all as before, errors `[]`
- Risk: the Latin title uses Inter 800 once the Google font lands; until then the fallback (DejaVu in this sandbox) is wider.
  Sized (clamp 30 to 60 px, `display: table`) so neither clips.
- Risk (item 2): without a real ja-JP voice I could not hear it. If it is still shy on Zack's laptop, the next step is to also duck the
  `voice` bus (crowd barks) and to look at which voice Chrome picked (`audio.debug().pa.ja`).
- Another agent's `loadprobe.mjs` (pid 3974) sat 37+ min in a slot; not mine.

