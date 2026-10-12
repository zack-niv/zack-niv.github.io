# v12 Phone (item 2b): the landscape phone

Status: IN PROGRESS. Contract first (for Shell, relayed by the lead).

## Contract for Shell (touch HUD)

- **When:** touch, landscape, and the existing `ph-compact` case (short screen: device height < 640 device px, i.e. phones;
  the 1180×820 tablet is NOT affected). Desktop is never affected.
- **`html.ph-wide`** is on `<html>` while the raised phone is the wide landscape phone (set on raise, removed on lower).
- **The safe region it leaves:** the wide phone is right-aligned, full height. Its left edge sits
  `phone.upGap` CSS px from the right edge of the viewport. The same number is published as the CSS custom property
  `--ph-wide-gap` on `<html>` (always set while touch + landscape-compact, so CSS can use it before the class flips).
  - 844×390 / 852×393: the phone is about 70% of the width → **free strip on the left ≈ 240 px wide, full height**.
  - The walk stick (bottom-left) stays usable; the Run + Phone cluster and Pause need to fit in that strip.
- `touch.js _place()` already measures `ph.device.getBoundingClientRect()` for the cluster, so the cluster follows
  automatically. `--tu-phone-gap` (the tutorial hint's right offset) is computed from `340 * ph._scale`: with
  `ph-wide` it should use `ph.upGap` instead (or the CSS var `--ph-wide-gap`).
- The phone re-measures on `resize` (Safari bars collapsing).
- **Request to Shell:** the tutorial hint with the phone up (`.g-tip[data-at="phoneup"]`, `.g-tip.ph-up`) uses
  `right: calc(var(--tu-phone-gap) + 16px)`; under `html.ph-wide` it must use `var(--ph-wide-gap)` (else it lands on
  the wide phone). Same for any other "left of the raised phone" placement. Pause/Run/Phone already follow the
  device rect in `_place()`.
- Numbers at 852×393: phone scale 0.836, device 713×453 device px → about 596×379 CSS px, right edge 12 px from the
  screen edge; `--ph-wide-gap` ≈ 608 px; free strip x = 0…244.

## Files

- `#phone-root.ph-compact` rules: still in `css/touch.css` (unchanged so far); the new landscape layout lives in
  `css/phone.css` under `.ph-land`.
