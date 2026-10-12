# v12 Phone (item 2b): the landscape phone

Zack: "the phone looks squeezed into half - making the apps within (mainly the map apps) look very crammed."

## Decision: on a phone held sideways, the raised phone turns sideways too

**Why (evidence, 844×390, same script, same state):** before, the portrait phone on a 390 px-tall screen leaves the map
13,456 CSS px² of visible map on the Maps route view (and **0** on the "Where to?" view with Aya's banner and the compass
toast, i.e. Zack's shot reproduced exactly: `before-844/2-maps-pick.png`). The phone was ~299×381 CSS px and every row of
chrome (status bar 50, banner 90, search 50, toast, chips, sheet, dock 90 device px) stacks vertically in 429 px.
Collapsing the chrome in portrait (the alternative) wins back at most the status bar, the banner and the toast:
~150 device px of height on a 316 px-wide screen, and the sheet still eats the bottom half. The landscape layout puts
the chrome *beside* the map instead of on it: map pane ~290×359 CSS px with nothing over it but the floor ladder.
People also really do turn their phone for maps.

- The **lowered (glance) phone stays the portrait one**. Raising morphs it wider (width follows the raise spring), and it
  morphs back on the way down. No pop: the views are faded out while the frame is narrow.
- **Inside (one layout for every app):** no status bar (iOS hides it in landscape), the Dynamic Island on the left edge,
  the side buttons on the long edges, the dock a vertical **rail on the right edge** (right thumb; 49×50 CSS px targets).
  - Maps: map pane left (centred anchor, no sheet over it), search + sheet = a full-height side panel.
  - Lodestone: map/3D pane left, panel = the instruction header · the route's steps · the trip card. The 3D (hero and
    "3D view") gets the whole pane: band = pane minus 10 px top, 52 px bottom (Route/Me/Done), 50 px right (ladder).
  - Calibration: the picture in the pane, the four steps beside it, the floor bar under the picture.
  - Messages: the thread full width (bubbles ≤ 66%), reply chips in one row, no fake iMessage bar.
  - The notification banner drops over the picture pane (not the panel you are reading), 2 lines max; toasts and the
    "Compass needs calibration" card sit inside the map pane (fixes the overlaps in Zack's shot).
- **Walking with the wide phone up (lead's guard):** at 70% width the world left over is a 244 px strip that holds the
  stick, and the crosshair and the look area are under the phone. So walking lowers the wide phone to the glance strip
  (which already carries Lodestone's next step + live arrow) after **1.0 s** of walking instead of 3.5 s; running still
  lowers it at once. Raised = reading (you stop, like a real person turning their phone); walking = the glance strip.
  Shots: `10-walk-phone-up.png` (0.9 s into a walk in the canyon) and `11-walk-lowered.png` (the glance while walking).
- Desktop: never (needs touch). Tablet 1180×820: not compact → unchanged portrait phone.

## Contract for Shell (touch HUD), relayed by the lead

- **When:** touch, landscape, and the `ph-compact` case (device height < 640 device px, i.e. phones).
- **`html.ph-wide`** is on `<html>` while the wide phone is raised (set on raise, removed when lowering starts).
- **Safe region:** the wide phone is right-aligned, full height, its left edge `phone.upGap` CSS px from the right edge
  (also the CSS var `--ph-wide-gap` on `<html>`, set whenever wide mode is possible, 0 otherwise).
  - 844×390: phone 597×381 CSS px at x = 238; 852×393: ≈ 596 px wide, free strip ≈ 244 px.
- `touch.js _place()` measures `ph.device.getBoundingClientRect()`, so Run + Phone + Pause already follow (verified in
  the shots: they sit in the left strip, but over the stick's ghost ring: Shell's call).
- **Request:** the tutorial hint with the phone up (`.g-tip[data-at="phoneup"]`, `.g-tip.ph-up`) uses
  `right: calc(var(--tu-phone-gap) + 16px)`; under `html.ph-wide` it lands on the phone's top-left (seen in every
  after-shot, over the Maps search / Messages header). Use `var(--ph-wide-gap)` or move it into the left strip.
- The phone re-measures on `resize` (Safari bars collapsing): `_layout()` recomputes the scale, height, width and
  `upGap`, and drops the wide layout if the screen is no longer a short landscape one.

## Files

| File | Change |
|---|---|
| `js/ui/phone.js` | `_layout()`: wide mode (`_wideOK`, `_landW` = 70% of the screen width, `upGap`, `--ph-wide-gap`). `_setLand()`: `#phone-root.ph-land` + `html.ph-wide`. `_applyPose()`: width morph with the raise spring, centred on the right edge, less tilt. `_autoPose()`: 1.0 s walk-lower when wide. |
| `js/ui/phone/lodestone.js` | `_bands()` for the wide pane; `onLayout()`; the map band = the whole pane; `--ld-hh` / `--ld-th` (header and trip card heights) for the panel's steps list. |
| `js/ui/phone/mapapp.js` | `_anchor()`: centred in the pane when wide (no sheet over the map). |
| `js/ui/phone/ldmap.js` | calibration picture centred in the pane when wide. |
| `css/phone.css` | the `.ph-land` block at the end. |
| `css/touch.css` | **unchanged.** Its 3 `#phone-root.ph-compact` rules still apply to the portrait compact phone ("play upright anyway"); the `.ph-land` rules override them by specificity / load order (phone.css loads last). |

## Numbers / shots

(filled in below after the runs; shots in `notes/v12-shots/phone/`)
