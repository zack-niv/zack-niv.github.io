# v12 PA: the station voice on iPhone (item 3)

Owner: PA agent (Opus). Files: `js/audio/announcer.js`, `js/audio/audio.js`.

Zack (iPhone, Safari, landscape): "Can't hear the station Japanese announcements, very missing from the scene." The
captions show (`v12-shots/player/2_pa_captions_hud.png`), so the PA items run. Only the voice is missing.

## Root cause (code evidence)

There were three faults in a chain. Together they mean that on an iPhone no PA line has ever been spoken, in any version since v8.

1. **WebKit's iOS speech gate.** In WebKit's `SpeechSynthesis::speak()` (iOS only), a call made while a user gesture is
   being processed lifts the restriction for the page. Any other call `return`s: the utterance is dropped, with **no
   `start`, no `error`, no event at all**. Desktop Safari and Chrome don't have this gate (Chrome only needs sticky activation).
2. **We spent the one unlock on a non-gesture.** v8–v11 `audio.js` `init()` attached `kick` to `pointerdown`, `keydown`,
   `touchend` and `click` (capture). A finger's first event is `pointerdown`, and per the HTML spec a touch `pointerdown`
   is **not** an activation-triggering event (`touchend` and `click` are). So `kick` → `resume()` built the AudioContext.
   Then `announcer.unlock()` set `_unlocked = true` **before** anything was known, and spoke `' '` at volume 0, outside a
   gesture. WebKit dropped it silently, and `resume()` then **removed all four gesture listeners**. The `touchend` and
   `click` that followed the same tap never reached us.
3. **Nothing ever retried.** Every later `speak()` comes from the frame loop (`announcer.update` → `_speak`), never from a
   gesture, so WebKit drops each one. The announcer waited `uDeadline` (6 s) for an `onstart` that never came, logged
   `no-start: timeout`, cancelled, and moved on. The caption is emitted in `_start()` before any of that happens, which is
   why the captions show and the voice doesn't.

Web Audio was not affected in the same way: the ambience, chime and so on run on the AudioContext, and its resume isn't
gated the same way (and from v12 it is also retried on every gesture until `running`).

Secondary faults found and fixed along the way:
- the unlock text was a blank `' '`. A blank or zero-length utterance may never fire `start`/`end`, so it can't prove anything;
- `pauseSpeech()` used `speechSynthesis.pause()/resume()`. iOS can stay wedged in the paused state, and Chrome holds every
  later utterance while paused;
- there was no recovery after `cancel()`, and iOS is known to drop a `speak()` that closely follows a `cancel()`;
- iOS ignores `utterance.volume`. Once speech works, far-off shop calls and barks (which we fade with volume) would play at
  full level.

Desktop (Zack never confirmed the voice there either): the chain above does not apply. A mouse `pointerdown` *is* an
activation, and Chrome only needs sticky activation. The desktop probe below speaks. If desktop is still quiet for him, the
cause is the level or the OS voice, not the unlock. `namba_pa.ja` will name the voice in use.

## Fix (file → change)

| File | Change |
|---|---|
| `js/audio/audio.js` | The gesture listeners stay for the whole session (`_gesture(e)`, with an early return once the AudioContext is `running` and `announcer.speechReady`). Every trusted gesture resumes Web Audio. The speech unlock is tried only from `touchend`, `click`, `keydown` (not Escape or a repeat) and a **mouse** `pointerdown`; a finger's `pointerdown` is skipped. The `userActivation.isActive` unlock and the listener removal in `resume()` are gone. On touch devices, `navigator.audioSession.type = 'playback'` (Safari 16.4+) is set so the silent switch no longer mutes the game; opt out with `?ambientsession`. New `paStats()` works before the first gesture. |
| `js/audio/announcer.js` | `unlock(via)` speaks a silent Japanese `'。'` (`lang ja-JP`, the ja voice if loaded, volume 0.01) **inside** the gesture. Only that utterance's `onstart`/`onend`, or any PA line's `onstart`, sets `_unlocked` (`_proven`). There is one attempt in flight at a time; if it hasn't confirmed after 1.5 s, the next gesture retries. The cap is 24 attempts, and there are no attempts when voices are loaded but none is Japanese. Every `speechSynthesis.cancel()` goes through `_cancel()`, which sets `_needsPrime`, so the next gesture primes speech again; a later `onstart` clears it. There is a 0.3 s gap after a cancel before the next `speak()`. A line that never starts counts as `noStart` and is cancelled, which also sets `_needsPrime`. `pauseSpeech(true)` drops the line in flight and holds the queue (no `speechSynthesis.pause()`). `cancelSpeech()` interrupts properly (it no longer re-speaks a half-cut line). Voice polling no longer stops at 60 s. iOS only: non-PA lines (shop, crowd, ambient; prio ≥ 2 and not `pa`/`platform`) are voiced only when `vol ≥ 0.45`, because iOS plays every utterance at full volume. `stats()` follows the contract. |

"Japanese only, never English TTS" is unchanged: the unlock text is `。` and English parts are still caption-only. The v11
levels are unchanged: bus trims, `PA_DUCK`, `DUCK_PRE`, the area PA, and the sqrt master curve.

## Contract: `stats()`

`ctx.audio.announcer.stats()` (the announcer exists after the first gesture), or `ctx.audio.paStats()`, which also works
before it and then adds `state: 'waiting-for-gesture'`:

```js
{
  voices: 3,              // speechSynthesis.getVoices().length at the last refresh
  ja: 'Kyoko',            // the ja-JP voice picked (name), or null: no Japanese voice, so chime + caption only
  unlocked: true,         // speech PROVEN: an onstart/onend of our unlock utterance or of a PA line
  unlockVia: 'touchend',  // what proved it: 'touchend' | 'click' | 'keydown' | 'pointerdown' (mouse) | 'line' | 'speaking'; null if never
  attempts: 1,            // unlock utterances spoken inside gestures
  started: 4,             // PA utterances whose onstart fired
  ended: 3,               // PA utterances whose onend fired
  errors: ['no-start'],   // distinct codes, max 8: SpeechSynthesisErrorEvent.error codes (not-allowed, synthesis-failed, ...),
                          //   'unlock:<code>', 'unlock-timeout', 'unlock-throw', 'no-start', 'hard-timeout'.
                          //   Our own cancels ('interrupted'/'canceled') are not recorded.
  lastErr: 'no-start',
  // extras (not in the original contract; safe to ignore):
  tried: 5,               // PA utterances handed to speechSynthesis.speak(). started/tried is the success rate
  noStart: 1,             // utterances that never started (what iOS does to a locked speak())
  needsPrime: false,      // a cancel / no-start happened and the next gesture will prime again
  speech: true,           // speechSynthesis exists at all
}
```

How to read a `namba_pa` from Zack's iPhone:
- `tried > 0, started 0, attempts 0`: no touchend/click reached `_gesture`.
- `attempts > 0, unlocked false`: iOS doesn't honour our gestures, or `。` never starts.
- `ja null`: no Japanese voice is installed.
- `started ≈ tried`: speech works; if he still can't hear it, it's the level or the route.

## Proof (headless; Chromium with an iOS speech model)

`scratchpad/paprobe.mjs` (not in the repo). Playwright Chromium, `devices['iPhone 13']` UA, `isMobile`, `hasTouch`,
852×393, real `page.touchscreen.tap` on Begin. `addInitScript` replaces `speechSynthesis`/`SpeechSynthesisUtterance` with
the WebKit model:
- `speak()` is silently dropped until one runs while a trusted `touchend`/`click` is being dispatched;
- voices are `[]` for 1.5 s, then Kyoko (ja-JP) and Samantha, and `voiceschanged` never fires;
- `retry` mode also drops the first in-gesture speak;
- `stuck` mode wedges after `cancel()` until the next in-gesture speak;
- the desktop model is Chrome's sticky activation with a mouse click.

Old = v11 `js/audio` (HEAD) served from a copy, same page and same stub. A PA line = `audio.say({ja, en, kind:'station'})`.

Each row is a real page load: tap Begin with a real touch, then queue PA lines (the game's own train lines also run).
"stub" counts come from the speech model, so they are independent of our code.

| Run | What happens | stub: speak() / dropped / started | `stats()` at the end |
|---|---|---|---|
| **old, iOS** | `' '` unlock spoken at `pointerdown(touch)`, outside a gesture → dropped. The touchend and click of the same tap reach no listener (removed). Lines 1, 6, 7 and 3 → dropped, `no-start: timeout`. A **second tap changes nothing**. | 5 / **5** / **0** | (v11 had only `{voices, ja, en}`) |
| **new, iOS** | the tap's `touchend` → `'。'` engaged → `unlocked via touchend`; line 1 starts (Kyoko, vol 0.64) | 2 / 0 / 2 (`。` + line 1) | `unlocked true, unlockVia touchend, attempts 1, tried 1, started 1, noStart 0, errors []` |
| **new, iOS, first in-gesture speak rejected** | `touchend` try dropped, the same tap's `click` try engages → lines 1, 3 and 6 all start | 5 / 1 / 4 | `unlocked true, unlockVia click, attempts 2, tried 3, started 3, noStart 0, errors []` |
| **new, iOS, both of tap 1 rejected** | lines 1 and 7 dropped (`noStart 2`, `needsPrime`); tap 2 → try #3 via touchend → line 3 starts | 7 / 5 / 2 | `unlocked true, unlockVia touchend, attempts 3, tried 4, started 1, noStart 2, errors [no-start, unlock-timeout]` |
| **new, iOS, wedged after cancel** | unlocked, line 1 starts; a line is cancelled mid-flight (as on tab hide) → the model wedges → lines 2 and 7 dropped (`noStart 2`, `needsPrime true`); next tap re-primes → line 3 starts | 8 / 2 / 5 | `unlocked true, attempts 3, tried 5, started 2, noStart 2, errors [no-start]` |
| **new, desktop** (Chrome sticky-activation model, mouse click) | `unlocked via pointerdown` (mouse); line 1 starts | 3 / 0 / 3 | `unlocked true, unlockVia pointerdown, tried 1, started 1, errors []` |

Every run: console errors `[]`, `ctx.errors []`. The new iOS basic and retry rows are from the final code. The retry2, stuck and
desktop rows ran one revision earlier: back then a tap's `click` also spoke a second `。` even when the `touchend` one had
been accepted, and a superseded try was logged as `unlock-timeout`. Both are fixed now, so `attempts` there would be 1 lower.
The unlock and recovery logic is otherwise identical.

How to re-run: `node <scratchpad>/paprobe.mjs <root> <label> basic|retry|retry2|stuck|desktop`. Old code root: a copy of
`namba-demo` with `js/audio` from HEAD. Each run takes about 3 to 7 min under slot contention.

## Chime and duck levels

Unchanged (before = after): `PLAT_CHIME 0.85`, `CHIME 0.55` on the voice bus (about −17 to −19 dBFS RMS at the platform,
`v11-audio.md`), and `PA_DUCK` −15/−15/−10.5 dB. The PA chime (`chimePA`: E5 C5 D5 G4 bell, partials to about 2.7 kHz)
sits above a phone speaker's roll-off, so it's fine. On iOS the speech now plays at full device volume (iOS ignores
`utterance.volume`) while Web Audio sits at master 0.9 × 0.85² ≈ 0.65 with the beds ducked, so the voice should be the
loudest thing during a line. I didn't raise anything without ears on a device.

## What only Zack's iPhone can prove (the unsure list)

1. **That WebKit really treats `touchend`/`click` as the gesture for speech, and that `。` fires `start`/`end`.** If `。`
   never starts, `unlocked` stays false and `attempts` climbs to 24, but the speak-in-gesture itself is what lifts WebKit's
   restriction, so PA lines should still start (`started > 0`, `unlockVia: 'line'`). `namba_pa` will tell.
2. **The audio session.** `audioSession.type = 'playback'` makes the game audible with the silent switch on, but it also
   pauses his music when the game starts. I haven't verified how it interacts with the speech route. If speech is worse
   with it, `?ambientsession` turns it off for an A/B test.
3. **The stuck-after-cancel model** is my harsh version of a folklore bug. Recovery needs a tap, which is fine while
   playing (taps are constant), but a line can be lost in between.
4. **iOS ignoring `utterance.volume`** is widely reported, not measured here. If iOS does honour it, the `IOS_MIN_VOL`
   gate only mutes a few quiet far-off shop calls.
5. **Voice availability:** Kyoko (compact) ships with iOS, and O-ren/Otoya are optional downloads. `ja` in `namba_pa`
   says which one.
6. **The desktop level** (separate from this bug): speech can't be measured headless. If desktop still feels quiet, look
   at `namba_pa.ja` (a remote "Google 日本語" voice is quieter and can start late) before touching the mix.
