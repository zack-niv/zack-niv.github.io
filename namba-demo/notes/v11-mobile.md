# v11 — Mobile / tablet (item 6) — Mobile agent notes

Status: IN PROGRESS (contracts first; results below once measured).

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

## Measurements

(filled in below)
