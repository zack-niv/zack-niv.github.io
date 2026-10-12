# v12 Shell (items 1 + 2a): iPhone swipe-up full screen, a title that fits, a less crammed phone UI

Files touched: `js/ui/touch.js`, `css/touch.css`, `css/style.css` (`#view` height only), `js/ui/title.js` (the cue markup only).
Not touched: `css/game.css`, `js/game/game.js`, `index.html` (everything was doable from `touch.css`, so desktop styles cannot change).
Test rig: `/tmp/.../scratchpad/shell.mjs` (Playwright Chromium, iPhone UA, `isMobile` + `hasTouch`, `Element.requestFullscreen` deleted,
`screen` faked to 393x852 so the "full landscape height" is 393; bars = `page.setViewportSize` 852x270 -> 852x393). "Before" = commit `b13fa5c`
(old CSS/JS served by route interception), "after" = the working tree. Shots in `notes/v12-shots/shell/{before,after,after3}/`.

## 1. iPhone Safari: swipe up for full screen (no extra clicks)

Why the bars never left: `css/style.css` locks `html, body` (overflow hidden, touch-action none), and Safari collapses its bars only when
the *document* scrolls. iPhone has no element Fullscreen API (`goFullscreen()` stays for iPad/Android).

| file | change |
|---|---|
| `js/ui/touch.js` `iphoneSafari()` | the case = iPhone/iPod UA, not an in-app browser (LinkedIn/FB/Instagram/WeChat/Twitter/GSA), not `navigator.standalone` / `display-mode: standalone`, no `requestFullscreen`/`webkitRequestFullscreen`, coarse pointer |
| `js/ui/touch.js` `iosSwipe` | only in that case: adds `<div id="swipe-spacer">` (absolute, `--vh + 160px` tall, so the document can scroll while canvas/UI stay `position:fixed`), classes `ios-iphone`, `ios-swipe` (scrollable title), `ios-cue` (cue visible), `ios-lock` (no scroll). Re-evaluated on `resize`, `visualViewport` resize and orientation change |
| collapse detection | bars "showing" = visible height < full landscape height (`min(screen.w, screen.h)`) - 40 px. Collapsed = `innerHeight >= full - 40` OR grew 40 px over the smallest height seen. Collapsed: the cue fades and the page re-locks (overflow hidden) AT that scroll position (the spacer stays, so the scroll offset and the bars are not reset). If the bars return while still on the title, the cue returns |
| `TouchUI.update` | `game.started` -> `iosSwipe.begin()`: locks for good. Tap to begin never needs the swipe. In game nothing is shown or nagged when the bars come back (the lock simply stays) |
| `js/ui/title.js` | `.t-swipe` cue (touch only, markup only): chevrons + "Swipe up for full screen" + "上にスワイプで全画面". Visible only under `html.ios-cue` (CSS), fades in after the title's own stagger |
| `css/touch.css` | `#swipe-spacer`, `html.ios-swipe` (overflow-y auto, touch-action pan-y), `.ios-lock` (hidden / none), the cue, and the Settings tip: `html.ios-iphone .g-settings::after { content: 'Play full screen: Share -> Add to Home Screen' }` (pure CSS, so it shows in both the title Settings drawer and the pause Settings; iPhone only) |

Verified in emulation (log lines from `shell.mjs`): at 852x270 `html` is `ios-swipe ios-cue`, `scrollHeight` 430 > 270; a real CDP touch swipe moves
`scrollY` 0 -> 97; resizing to 852x393 gives `ios-lock`, cue opacity 0, `scrollY` kept (37); back to 852x270 the cue returns (opacity 1); Begin
-> `ios-lock`. Android UA (Fullscreen API present) and desktop: no spacer, no cue, no classes (the run with `--ua android` and `mouseshot`).

## 2. The title fits the visible height

Root cause (shot 0): at ~270 px of visible height the bottom-anchored `.t-main` (about 250 px tall in desktop typography) grew upward over
`.t-place` and pushed なんば off the top. `touch.css` now has a short-landscape tier (`pointer: coarse` and `max-height: 440px`, plus a
`300px` one): smaller kana/rule/tag/begin spacing, `.t-latin` = 15% of `--vh` clamped 32-56 px, top/foot/drawer padding from the safe-area insets
(notch side), the Settings drawer scrolls. `#view` in `style.css`: `height: 100vh; height: 100dvh` (touch already overrides to 100%).

Measured (`title-<h>` log): `.t-main` top vs `.t-place` bottom (33 px): 270 -> 105, 330 -> 137, 390 -> 190 (no overlap); `.t-begin` bottom vs `.t-foot` top: 240/249, 294/309, 354/369.
Shots: `after/title-270.png`, `title-330.png`, `title-390.png`, `title-393-collapsed.png`, `title-270-settings.png` (the tip). Before: `before/title-*.png`.

## 3. Less crammed (2a), all in `css/touch.css`, scoped to `html.is-touch` / `pointer: coarse`

| item | change | measured / shot |
|---|---|---|
| PA captions | one at a time (`.h-amb-i:not(:last-of-type)` hidden), 45% width max (380 px), top-left under the safe area, JA 11 px / EN 10 px each clamped to 2 lines, firmer backing (.55) | 387x70 px at (1,10); the stick ring starts at y 126 (270 tall) / 249 (393): never touches. `after/pa-270.png`, `pa-393.png` |
| story captions | width between the stick and the buttons (`100vw - 2*(inset+190)`), JA 13.5 / EN 12 px | - |
| tutorial hint | wraps as normal inline text (the desktop nowrap flex row split "...a lane, then [hand]" into columns), `data-at="phone"` now ends left of the Run+Phone pair (safe-area aware, level with them), max-width between stick and buttons; firmer backing (.8) and a text shadow for light floors | `after3/tip-phone-393.png` (hint ends 16 px left of Run, 0 overlap with Run/Phone/stick), `tip-gate-270.png` (the gate hint on one line) |
| pause menu | phone layout: kana 26 px, rows 40 px, the goals/quests tighter, contact cards 48 px high two-up, the right column scrolls with `touch-action: pan-y` | 852x393: both quests + both cards fit with no scroll (`after3/pause2-393.png`); 852x270: scrolls by touch (scrollTop 48), both cards `inView` after (`pause2-270-scrolled.png`) |
| `--tu-sl/sr/sb/st`, `--tu-b/r` | safe-area insets and the live cluster offsets published on `<html>` so HUD pieces outside `#touch-ui` can stay clear | - |
| Peek card | NOT done here, needs the Phone agent (see requests) | `after/peek-393.png`: 301x100 px (24% of the height) |

## Contract with the Phone agent (wide landscape phone, `html.ph-wide`)

- Pause, Run and Phone stack in a column on the free strip's right edge (just left of the phone, following `ph.device`'s rect), Pause on top.
  The stick, PA caption, hint and button column sit inside the ~245-345 px strip without overlapping (`after3/raised-393.png`, `raised-270.png`; log lines
  "overlaps ... false" for tip/amb, tip/pause, amb/pause, amb/stick, btn/stick, tip/phone, run/phone).
- `--tu-phone-gap` = `ph.upGap + 4` while wide; the phone-up hint (`data-at="phoneup"`) sits left of the button column (right = `--ph-wide-gap + 88`), wraps, no arrow.
- Hints that are not about the raised phone (e.g. "Drag on the right to look around": the right side IS the phone) are hidden while `ph-wide`
  (they come back on lowering). **Copy issue for the lead:** none needed if hidden; if you would rather show them, the words should say "left thumb".
- While wide, the PA caption is JA only, one line, under the hint (top 84 px, 62 px at <= 300 px height), width = the strip minus the button column.

## Requests (not my files)

1. **Phone / peek card**: the lowered glance card is 301x100 px at 852x393 (and rotated). Make it about 25% smaller on touch ph-compact: in `phone.js`
   use a smaller `GLANCE_S` (about 0.75 instead of 0.97) when `this._touch && dh < 640`, and `GLANCE_H` in proportion; the card lives in transforms, so it
   cannot be shrunk from CSS (an extra `scale` would pivot about the transform-origin, which is below the screen).
2. The pause/touch copy `.p-hint` is hidden on touch as before; nothing needed.

## What can only be proven on a real iPhone (honest list)

- That Safari really collapses its bars on this scroll (spacer approach is the standard trick, but Safari decides) and what `innerHeight` it reports after:
  my thresholds (`full - 40` or `+40 px growth`) are guesses from Zack's screenshot (visible about 283 pt of 393 with bars).
- That `overflow: hidden` on `html` while scrolled does not bring the bars back (I keep the spacer so the document is still taller than the viewport; lock only
  changes overflow/touch-action). If the bars pop back at the lock, remove `.ios-lock` handling during the title (the page may stay scrollable until Begin).
- `screen.width/height` on iOS landscape (I use the smaller of the two as the full landscape height).
- `visualViewport`/`resize` timing, the iOS 15 vs 17 differences, the notch/Dynamic Island insets on the title left margin.
- The Settings tip wording on the pause menu (CSS pseudo-element on `.g-settings`).

## Unsure

- Title at 390 now looks a bit denser than the desktop-typography original (kana 13 px, tag 13 px). Readable, but Zack may want 1-2 px more.
- With bars up (about 270 px) the game itself is playable (HUD verified at 852x270) but cramped; the swipe cue is the cure and only exists on the title.
- The hidden non-phone hints under `ph-wide` mean a player who raises the phone before "looking" never sees the look hint; low risk.
- `ios-lock` after `Begin` with bars still up leaves `scrollY` as is (e.g. 37) on a page whose body is overflow hidden; harmless but untested on device.
