# v12 critique (critic + fixer)

**Whole demo: 8.5 / 10** (v11: 8.5). Before my fixes I'd have given it **8**. The round did good, honest work. But on a
landscape phone you could not turn at all while the new wide phone was up, and that blocks the photo beat's "send one
with a sign in it" retry. And the iPhone swipe-up fix was switched off on any iPhone that exposes `requestFullscreen`.
Zack's "the Safari bar did not go away" after Begin, which calls it, says his phone is one of those, or could be.

What v12 got right:
- **The landscape phone (2b)** is the best layout change since the canyon. It is a real landscape iPhone: the island
  on the left edge, the dock as a rail, the map pane beside the sheet. Maps route area is 10,896 → 85,088 CSS px²
  (7.8×), the Lodestone 3D band 2.7×, and Zack's shot-1 overlaps (banner over the map, toast over "Where to?") are gone.
- **The PA (3)** has a real root cause with code evidence. The unlock was spent on a finger `pointerdown` (not an
  activation), the listeners were then removed, and nothing ever retried. So no PA line has been voiced on an iPhone
  since v8. The fix is principled: unlock inside `touchend`/`click`, "proven" only on `onstart`/`onend`, retry, re-prime
  after `cancel()`. And `namba_pa` will tell us what Zack's phone did.
- **The declutter (2a)**: one PA caption at a time, a hint that clears the buttons, a pause menu where both quests and
  both contact cards fit at 393 px.

Shots: `notes/v12-shots/critic/`.

## 1. Scorecard

| # | Zack's item | Before my fixes | After | Evidence |
|---|---|---|---|---|
| 1 | iPhone Safari bars / one-click full screen | **partly**: a good swipe-up title with a cue, the title fits at 270 px, no cue on Android/desktop. But `iphoneSafari()` returned false whenever `requestFullscreen` existed, and Zack's iPhone may well expose it (Begin called it; the bars stayed). | **partly (as fixed as the web allows)**: the cue now shows on every iPhone Safari that isn't an in-app browser or standalone. Swipe → scroll 0 → 129 → bars "collapse" (852×393) → locked, Begin works at any point. LinkedIn UA: no cue, no scroll. **One swipe, not one click: iOS allows nothing better.** Only Zack's phone can prove Safari really collapses the bars. | `critic/1-title-iphone-safari-270-cue.png`, `critic/1-title-linkedin-270-nocue.png`; log below |
| 2a | "a bit crammed, in game and the menu" | **mostly fixed** | **mostly fixed** | `critic/2a-pause-852.png` (both quests and both cards, no scroll), `critic/2a-glance-852.png` (glance 233×83 at (598, 310), clear of Run/Phone, whose bottom is at 296). Shell's `after/pa-393.png`: one caption, 387×70, off the stick. Remaining: the glance text is about 9–10 CSS px. |
| 2b | "the phone looks squeezed into half … map apps crammed" | **fixed for reading, broken for looking**: with the wide phone up, the whole free strip (x < 244) sat inside the stick zone (42% = 358 px). So no touch could turn the camera. You could not aim the photo, or turn to read a sign, without lowering the phone. | **fixed**: the strip's upper half looks and the lower half walks, only while `html.ph-wide`. 3 drags of 110 px in the strip with the phone up → **98° of yaw**, phone still up, no stick. A thumb low in the strip → stick (move y 0.88). | `critic/2b-wide-phone-raised-852.png`, `critic/2b-photo-by-touch-wide-phone.png`, `critic/2b-photo-captured-world.jpg` |
| 3 | "Can't hear the station Japanese announcements" | **fixed in code, unproven on device** | same | `tools/paprobe.mjs` on the final tree. **iOS model**: the `。` unlock is engaged at the Begin tap's `touchend`, starts on Kyoko, and line 1 starts (2 speaks, 0 dropped; `unlocked true, unlockVia touchend, attempts 1, tried 1, started 1, errors []`). **Desktop model**: unlocked via a mouse `pointerdown`, line 1 starts, `errors []`. The old-code row ("5 speaks, 5 dropped, 0 started") is the PA agent's (`notes/v12-pa.md`). |

### The lead's explicit checks

| Check | Result |
|---|---|
| Wide phone and looking around | **Was blocked; fixed** (see 2b). The walk-lowers-after-1.0 s rule is unchanged: steering by the world while walking is right. |
| Photo beat on the wide phone | 📸 captures the **world** (a WebGL frame, never the DOM: `_capture()` draws the canvas). By touch at 852×393 the chip is 100×38. The bubble shows the platform, and Aya replies *"omg that's the Nankai platforms 🚃 the Central Gate is to your right, then down to 2F 👇"*. The photo is centred on the crosshair, which sits behind the phone: "the camera points ahead". It's fine, and now you can aim by dragging the strip. |
| Wide/portrait race | **Not reproduced.** Loaded in portrait (393×852: `_wideOK false`), rotated to 852×393 → `_wideOK true`, `--ph-wide-gap 608px`. The first raise by the real Phone button → `ph-land` + `html.ph-wide`, device 603×384 at x = 241. `input.touch` comes from `matchMedia` at construction, and `_layout()` runs on every `resize`, so nothing depends on load order. Phone's portrait run 1 was most likely the file swap they suspected. |
| Lowered glance | 233×83 CSS at 852×393 (visible part), 14 px clear of the Run/Phone row. "Pick a place in Maps · Aya: Café Mitsubachi" is legible but small (about 9–10 CSS px for the second line). |
| Hint copy under `ph-wide` | No stall. Steps validate on actions, not on hints (touchwalk: `look, move, raise, reply, pick` all done). A hidden "Drag on the right to look around" returns when the phone is lowered, and a drag in the strip now completes the look step anyway. |
| iPhone swipe state machine | Reviewed `iosSwipe` line by line. **Title stuck scrolled**: impossible, because `#ui` is `position: fixed` and only the spacer scrolls. **Page scrollable in game**: no; `begin()` removes `ios-swipe` and the base `overflow: hidden` returns. **Portrait**: `sync()` returns early, nothing scrolls. **Swipe starting the game**: no, Begin listens to `click`, and a pan never clicks. **In-app UAs**: LinkedIn/FB/Instagram/WeChat/Twitter/GSA were excluded; I added LINE, Snapchat and Threads (`Barcelona`). **The real trap I found**: the `requestFullscreen` gate (fixed). LinkedIn emulation (`[LinkedInApp]` UA): `is-touch` only, scrollHeight 270 = viewport. |
| PA: paprobe on the final tree, desktop mouse unlock, `audioSession` touch-only | ✓ / ✓ (`unlockVia pointerdown`) / ✓ by reading: `navigator.maxTouchPoints > 0`, and the API exists only in Safari; Mac Safari reports 0. |
| Analytics `namba_pa` with `?track` | **Not run** (browser slots went to the touch and PA proofs). By reading: `first` fires once `started`, `noStart` or `errors` are set, `summary` fires at 90 s, and the props match `stats()`. The lead should run one `Q='…&track'` pass with audio on before deploy, or trust the first real iPhone event. |
| Regressions | All green; see §2. |

## 2. Runs (final code unless marked)

| Run | Result |
|---|---|
| `node tools/storysim.mjs` | **19/19** |
| `walk.mjs` normal (desktop; my edits are touch-only) | photo `city`@113.6 recognised *"by Mokume Living"* · offer `floors`@151 · arrive **504.4** · chips 1008 / **0 bad** · timers **[]** · silence **45.8 s** (0.95/min) · `ctx.errors []` · end card as v11 (`critic/desktop-endcard.png`) |
| `touchwalk.mjs` 852×393 (final code) | Begin · look 105° · stick 4.8 m · jog · the phone button · chips · Maps dock + place → café · **Use pill at the gate** (300×56) · offer · **Lodestone Get** 342×58 · calibrating · the hero · end card scrolls (505/393) · Keep exploring · Pause/Resume · **`errors []`, `ctxErrors []`**. The 2 TAP MISS lines are the walk's timing (Aya's pick is the first row before a route exists; the 3D button is hidden during the hero by design), as the Phone agent explained. |
| `critic12` (mine, scratch) iPhone UA, portrait load → landscape | wide race, strip look, photo by touch, glance, pause: `errors []`, `ctx.errors []` |
| `critic12 title` iPhone Safari UA **with `requestFullscreen` present** at 852×270 | `ios-iphone ios-swipe ios-cue`, scrollHeight 430; real touch swipe → scrollY 129; resize to 393 → `ios-lock`; LinkedIn UA → `is-touch` only, no scroll |
| `paprobe` final: `basic` (iOS) and `desktop` | both `errors []`, `ctx.errors []` (numbers in the scorecard) |
| `memprobe` 852×393 @3 (final code) | canvas+GPU: title **280**, 30 s play **288**, phone up/Maps **293**, Lodestone 3D **304**, world tour 388 MB (v11.1: 280 / 294 / 298 / 309 / 384): **no regression**; the wide phone costs nothing measurable. `ctx.errors []` |
| `mouseshot` (final code) | free chip, pause links `_blank`, backdrop click resumes (locked), phone chip, `errors []`: desktop unchanged |

A headless note: one touchwalk shot (`critic/headless-island-midmorph-artifact.png`) caught the Dynamic Island mid-morph from the glance card into the
landscape pill, a big black blob over the thread. That is SwiftShader: a frame takes seconds, so a 0.42 s CSS
transition gets photographed half-way. In every settled shot it's the correct 31×104 pill (`2b-wide-phone-raised-852.png`).
Worth one look on a real phone, though: the morph sweeps across the panel.

## 3. Fixes (files)

| File | Change | Why |
|---|---|---|
| `js/core/input.js` (`touchstart`) | While `html.ph-wide`, a touch in the **upper half** of the screen is a look touch even inside the stick zone (the lower half still spawns the stick) | The wide phone leaves a ~244 px strip that is entirely stick zone, so turning was impossible with the phone up: no aiming the 📸, no turning to read a sign |
| `js/ui/touch.js` (`_build`) + `css/touch.css` | A faint **"⟷ LOOK" ghost** in the strip (the twin of the WALK ghost), shown only while `html.ph-wide`; it fades after the first strip look (`html.tu-wide-looked`, set in `input.js`) and is hidden under 300 px of height (bars showing) | Nobody would guess that the top of the strip turns the camera. `critic/2b-look-ghost-852.png` |
| `js/ui/touch.js` (`iphoneSafari()`) | No longer bails out when `requestFullscreen`/`webkitRequestFullscreen` exists on an iPhone; +LINE, Snapchat, Threads to the in-app list | iPhone builds that expose the method still keep the bars (Zack's report after Begin). The old check would have silently disabled the whole swipe-up fix on his phone. Begin still calls `goFullscreen()`, harmless if it ever works. |

All three edits are small and touch-only: desktop is untouched (`walk.mjs`, `mouseshot`). The final `touchwalk` and `memprobe` ran with the first two edits; the LOOK ghost was checked afterwards in `critic12` (2b row) only.

## 4. What remains (honest)

- **Everything in Zack's three items rests on emulation.** The bars collapsing on a scroll, the 40 px thresholds
  against real `innerHeight` values, `touchend` lifting WebKit's speech gate, `。` firing `start`, Kyoko being
  picked, and `audioSession 'playback'` coexisting with speech can only be proven on his iPhone. `namba_pa` will report
  the PA. Nothing reports the bars. Ask him for one screenshot after swiping.
- **"One click" is not achievable on iPhone Safari.** One swipe on the title, or Add to Home Screen (the Settings tip).
  Say so plainly rather than let him expect a click.
- **The strip look is a new gesture that no real thumb has tried yet.** The split at half height is a guess, and the
  LOOK ghost is the only cue. Watch Zack's first raise.
- **The glance card's second line is about 9–10 CSS px** at 0.75 scale. Legible on a retina phone, but at the limit.
- **After Lodestone, Aya is still a monologue**: 6 unanswerable one-liners in the normal walk (the v11 point, unchanged).
- **Real-device fps** is still read only from PostHog `namba_perf`; this round added DOM and layout, not geometry.

## 5. Why 8.5 (and not 8 or 9)

**What earned the points.**
- **+ Zack's biggest phone complaint is solved by design, not by squeezing**: the landscape phone gives the map
  7.8× the area and the 3D reveal 2.7×, and it looks like a real iPhone turned sideways. The Lodestone hero on a phone
  is now as strong as on desktop.
- **+ The PA has a real root cause and a self-reporting fix**: a chain of three faults with WebKit code evidence, a
  headless model of iOS's speech gate that shows old 0/5 → new 2/2, and `namba_pa` so his next play gives the answer.
- **+ The touch controls Zack loved are untouched**: the new look zone (with its LOOK ghost) only exists while the
  wide phone is up.
- **+ Invariants held**: storysim 19/19, desktop walk 0 bad chips, 0 timers, 45.8 s max silence, `ctx.errors []`
  in every run.

**What cost points (from 10).**
- **−0.5: none of the three items is proven where Zack plays.** Bars, speech and the audio session are all emulation.
  This is the second round in a row where the PA is "fixed in code"; if `namba_pa` comes back `started 0`, the demo's
  soundscape is still silent on iPhone.
- **−0.25: "one click" became "one swipe".** It's the right call technically, but it's not what he asked for, and
  the cue is a small text on a busy title (the JA line is low-contrast over the blue train).
- **−0.25: after Lodestone, Aya talks at you**: 6 unanswerable texts in a row in the normal walk.
- **−0.25: visuals unchanged since v9**: low-poly crowd, flat signage. The phone UI now outclasses the world it sits in.
- **−0.25: small phone-only rough edges**: the strip look is new and untested by a thumb, the glance second line is
  about 9–10 px, and the island morph sweeps over the panel for 0.4 s.

**To reach 9, ordered by impact per effort.**
1. **Zack plays once on the iPhone, then read PostHog `namba_pa` + `namba_perf` (input=touch)**, and ask for one
   screenshot after the swipe. *10 minutes for him. It decides whether 3 of the deductions disappear.*
2. **If `namba_pa` says `attempts > 0, unlocked false`**: speak the first real PA line itself inside the Begin
   gesture (a short platform chime line, not `。`), so the very utterance that needs the gesture is one you hear.
   *30 min.*
3. **Make 2 after-Lodestone texts answerable** ("is it working? 😌" → *it's magic 🤯* / *still lost 😭*; "send me a pic
   of the canyon 🌿" reusing the photo beat). *About an hour; it's the best conversation the demo doesn't have yet.*
4. **Glance card on phones: bump the note line to ≥ 11 CSS px** (font, not scale). *15 min.*

## 6. Top 3 risks

1. **The swipe-up never collapses the bars on Zack's iOS version** (iOS 26 Safari's compact tab bar in landscape may
   behave differently), or the `ios-lock` at the collapsed position makes the bars pop back. Mitigation: his one
   screenshot. If the bars return at the lock, keep the title scrollable until Begin (a one-line change in `sync()`).
2. **The PA is still silent on iPhone** (WebKit wants something else, or `audioSession 'playback'` interferes with
   speech). `namba_pa` will say which; `?ambientsession` is the A/B switch. Don't announce "you can hear the station
   now" to Zack until one event shows `started > 0`.
3. **LinkedIn's in-app browser is where most visitors land, and it gets none of this**: no swipe, no fullscreen, bars
   always visible, possibly portrait-locked. It works (playable, "play in portrait anyway"), but the first impression
   for the target audience is the cramped 270 px case. Worth a test on Zack's phone from a LinkedIn post before posting
   widely.
