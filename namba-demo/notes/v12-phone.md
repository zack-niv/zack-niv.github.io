# v12 Phone (item 2b): the landscape phone

Zack: "the phone looks squeezed into half - making the apps within (mainly the map apps) look very crammed."

## Decision: on a phone held sideways, the raised phone turns sideways too

**Why (evidence, 844×390, same script, same state):** before, the portrait phone on a 390 px-tall screen leaves
10,896 CSS px² of visible map on the Maps route view (and **0** on the "Where to?" view with Aya's banner and the compass
toast, i.e. Zack's shot reproduced exactly: `v12-shots/phone/844-before-2-maps-pick.png`). The phone was ~299×381 CSS px and every row of
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
| `css/phone.css` | the `.ph-land` block at the end; the touch 3D view button fix (`position: absolute`, below). |
| `css/touch.css` | **unchanged.** Its 3 `#phone-root.ph-compact` rules still apply to the portrait compact phone ("play upright anyway"); the `.ph-land` rules override them by specificity / load order (phone.css loads last). |

## Numbers (same script, same states: `phoneshots.mjs` in the agent scratchpad; real touch taps; SwiftShader)

Visible map / 3D area in CSS px² (grid-sampled with `elementFromPoint`, or the 3D band × the phone's scale²):

| View | 844×390 before | 844×390 after | 852×393 after |
|---|---|---|---|
| Maps "Where to?" + Aya's banner + compass toast (Zack's shot) | **0** (banner over the map, toast over the header and "Where to?") | map pane 275×345, banner/toast inside the pane | 278×347 pane |
| Maps route | **10,896** | **85,088** (7.8×) | 86,656 |
| Lodestone floor map (guide) | **≈ 0** (header + Next chip + trip card cover the whole screen: `844-before-6`) | ≈ 98,000 (pane 287×359, band = pane) | ≈ 98,000 |
| Lodestone reveal hero / 3D view | **27,579** band (264×104 CSS px) | **75,367** (2.7×) | 76,797 |

- Phone on screen: 299×381 → 597×381 CSS px (844); 603×384 (852). Scale unchanged (0.83 / 0.836): same type size.
- Tap targets (CSS px): dock rail 49×50 (was 77×40), reply chips 96–168×36–38 (+ touch.css's invisible 6 px margin
  → ≥ 48), list rows 193–202×38–40 (+ margin), Lodestone New place / End route 97×31 (+ margin), 3D view 76×28 (+ margin).
- 1180×820 tablet: `ph-touch` only (not compact) → the same portrait phone as before (device 357×712);
  hero band 68,760 as before. **And the 3D view button now works on touch** (see below).
- `ctx.errors []`, console `[]` in every run (844 before/after, 852 after, 1180 after).

## Found on the way: the 3D view button was dead on every touch device (root cause)

`css/touch.css` gives each phone tap target `position: relative` (to hang an invisible `::after` tap margin on it). For
`.ld-x3d`, which is absolutely positioned, that pulled it into the flow, off screen. That is v11's "3D view: TAP MISS" in
touchwalk and the critic's "the 3D button was never visible". Fix in `phone.css`: `html.is-touch #phone-root .ld-x3d
{ position: absolute; }` (same specificity, loads later). Verified: tap → `view: 'stack'` at 852×393 and 1180×820.
I checked the other targets in that rule (`.ms-chip`, dock buttons, `.dl-next`, `.ld-new`, `.ld-end`, `.ld-pv-go`):
all are in-flow elements, so `relative` is harmless there.

## Shots (`notes/v12-shots/phone/`)

- `844-before-*` / `844-after-*`: 1 Messages with chips · 2 Maps pick (+ banner + compass toast) · 3 Maps route ·
  4 calibration · 5 Lodestone reveal hero (held) · 6 Lodestone floor map.
- `852-after-*`: the same plus 7 the 3D view (by touch), 8 Messages after Lodestone, 11 walking (glance).
- `844-after-10-walk-phone-up-lowering.png`: 0.9 s into a walk in the canyon, the wide phone already dropping;
  `844-after-11-walk-lowered.png`: walking, full view of the canyon, the glance strip says "Turn left".

## Unsure / for the critic

- **The tutorial hint** sits on the wide phone's top-left in every after-shot (Shell's, contract above).
- **The HUD cluster** (Pause · Run · Phone) lands on the stick's ghost ring in the 244 px strip (Shell's).
- **Walking lowers the wide phone after 1.0 s.** Right for steering by the world, but a player who wants to read the
  map while walking gets the glance strip instead. An "expand again when the stick is released" behaviour was
  considered and not built (it would fight players who stop to look around).
- **Looking around with the wide phone up:** the look area (right half) is under the phone, so you can't turn
  while it is up; you lower it (Phone button) or start walking. Before, a ~110 px gap was left for it.
- **Destination chip in the 3D** ("kakusa Coffee Sta"): a long name overflows its sprite. Pre-existing (same in the
  before-shot), only for long names (Daikichi and Café Mitsubachi fit).
- The width morph was judged from stills only; the motion itself (raise → widen) wants a look on a real phone.
- Real iPhone safe areas (the notch side) are handled by the existing `safeRight()`; not testable here.
