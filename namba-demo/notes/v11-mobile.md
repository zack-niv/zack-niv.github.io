# v11 — Mobile / tablet (item 6) — Mobile agent notes

Status: built and verified in mobile emulation (see Measurements). Lead: please also relay request 4.

## Contracts (other agents read this)

- **`ctx.input.touch`** (bool) is the one switch. It is true on coarse-pointer devices from the start, and flips to true
  on the first real touch on the canvas (touch laptops). Everything touch-specific keys off it, or off the
  `html.is-touch` class that `js/ui/touch.js` sets at the same moment.
- **`ctx.input.tap(action)`**: what an on-screen button calls. `'interact'` raises the action AND `pressed('KeyE')`
  (so E-only code paths, such as gate taps with the phone up, the Lodestone offer and vignette panels, work
  unchanged). `'phone'` raises the action and `pressed('KeyQ')`. `'menu'` raises `pressed('Escape')`.
- **`ctx.input.runLatch`** (bool): the run toggle. `input.jog` is true while the stick moves and the latch is on, or
  when the stick is pushed well past its ring.
- **`ctx.touch`** (system `touch`, `js/ui/touch.js`): the on-screen controls (stick ring, Use, Phone, Run, Pause), the
  rotate-to-landscape card, and fullscreen plus orientation lock on Begin and Resume. The **Use** button mirrors
  the HUD prompt: it shows only while `.h-prompt.on:not(.passive)`, labelled with `.h-prompt-text`. Nothing else to
  wire.
- **Tutorial copy on touch** (Aya agent: `js/game/script.js` TUTORIAL). On touch, `js/ui/touchcopy.js` assigns
  touch wording onto the exported `TUTORIAL` object at boot. It only replaces keys that already exist, so if you
  rename a key the desktop line simply shows. **If you add a TUTORIAL key with `{k:…}` caps (e.g. the photo beat),
  tell the lead the key name and I'll add a touch line.** Inline glyphs used: `<i class="tc-g use"></i>` (Use
  button), `<i class="tc-g phone"></i>` (phone button).
- **Phone layout on touch** (`js/ui/phone.js` `_layout` / `_applyPose`): short landscape viewports get a shorter
  device (height `--ph-h` < 700 device px) at a legible scale (~0.83 on a 390-px-tall phone) instead of a tiny 0.55
  phone. Apps must lay out in flexible height: no fixed 700-px assumptions.

## Requests (the lead relays)

1. **Lead: `js/analytics.js`**: please add `input: ctx.input.touch ? 'touch' : 'kbm'` (and optionally
   `orient: innerWidth > innerHeight ? 'land' : 'port'`) to the super properties.
2. **Share: `js/ui/title.js` copy on touch** (`touch` is already computed there):
   - "Click to begin / クリックしてはじめる" → "Tap to begin / タップしてはじめる";
   - hint "Best on a computer with a keyboard and mouse" → "Left thumb walks · drag to look · headphones on 🎧";
   - the `.t-keys` row is hidden by `css/touch.css` on touch (no change needed).

   Until then `js/ui/touch.js` patches the begin label in the DOM on touch only. It's harmless once title.js does it.
3. **Aya: `js/game/game.js`**, the pause menu's `.p-esc` and `.p-hint` are keyboard-only. `css/touch.css` hides
   both on touch and `touch.js` adds a touch line. Nothing needed unless you prefer to own that copy.

4. **Aya: `js/game/demo.js:575`**, the free-roam caption "Q for your phone." On touch: "Tap your phone to raise
   it." (`ctx.input.touch`).

## What shipped (files)

| File | What |
|---|---|
| `js/core/input.js` | Floating stick (spawns where the left thumb lands in the left 42 %, ring kept on screen, base follows a drifting thumb past 1.9 R, 14 % dead zone, pushed past 1.4 R forward = hurry). Drag look anywhere else: 0.0052 rad/px (≈0.3°/px), vertical ×0.8, flick boost up to 1.8× above 700 px/s, 35 ms smoothing. `tap(action)`, `runLatch` (auto-off after 1.5 s idle), `onTouchMode(fn)`. `preventDefault` only when the event is cancelable. The old E and 📱 buttons are gone (they floated over the loading screen). |
| `css/input.css` | The stick ring and knob only (amber while hurrying). |
| `js/ui/touch.js` (new) | `bootTouch()` (html.is-touch, the rotate card's "Play upright anyway", `--vh`); `TouchUI` (registered by main.js, not a loader stage): resting ghost stick, **Use** pill mirroring the HUD prompt, **Phone** (raise/lower), **Run** toggle, **Pause**; fullscreen plus landscape lock on Begin and Resume (Android Chrome and iPad; iPhone degrades to the visible viewport); auto-pause in portrait (and resume), and on `visibilitychange`; patches the title's "Click to begin" and the pause explainer on touch. The right-hand cluster sits above the lowered phone and steps left of the raised one. |
| `js/ui/touchcopy.js` (new) | Touch wording for every TUTORIAL key that has key caps, with inline glyphs of the real buttons. |
| `css/touch.css` (new) | Rotate card, controls, HUD-on-touch (no E key cap; the centre prompt hides while Use carries it; no mouse chip), invisible hit-area margins on phone chips, dock and Lodestone buttons, tutorial hints kept clear of the controls and the raised phone, compact pause menu, compact scrollable end card, compact Lodestone pick panel. |
| `js/ui/phone.js` | Touch layout: a readable scale (0.83 on a 390-px-tall phone, was 0.55) with a **shorter device** (453 instead of 700 device px; `.ph-compact`) wholly on screen at the right edge, plus safe-area aware positions; portrait gets a screen-wide phone. Desktop path unchanged. |
| `js/main.js` | No more "best on a computer" gate. Mobile quality default (touch-only devices, unless `?quality=` is given): `low` plus crowdMax 320 (phone) / 420 (tablet), drawDist 70/80, callBudget 320/380, pixel-ratio cap 1.5/1.35. |
| `index.html` | The `#rotate` card (body), the `css/touch.css` link, and the `mobile-web-app-capable` / apple metas (home-screen launches run fullscreen). Viewport meta was already right (`viewport-fit=cover, user-scalable=no`). |
| `tools/touchwalk.mjs`, `tools/touchprobe.mjs` (new) | Touch-only playthrough and quick probe (portrait: `--w 390 --h 844 --portrait`). |

## Measurements
