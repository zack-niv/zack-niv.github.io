# v7.2 end card (owner: endcard)

Files: `js/game/endcard.js`, `js/game/demo.js` (summary only), `css/game.css` (end card section), `js/ui/phone/stats.js`.

## What changed
- **Stats: a fixed set of four rows**, each defined identically in both phases (same samples, same formula). The old
  "rows that differ" selection and the detour / wrong-turns / reroutes / compass / net-progress rows are gone from the
  card (their fields stay in `stats.summary()` and `demo.summary()`).
  1. Position error: mean ±m, caption "mean · 90% within ±X m" (lower is better)
  2. On the wrong floor: % of the time (lower is better)
  3. **NEW** Blue dot within 5 m of you: % of walking time (higher is better)
  4. Arrow catches up after a turn: median seconds (lower is better)
- A row never shows null data: "—" plus a short reason ("Lodestone not installed" when the player never upgraded,
  otherwise "not enough data").
- "Better" is visible three ways: each row label says "↓ lower is better" / "↑ higher is better", the clearly better
  side keeps full brightness while the other is dimmed, and the % bar of row 3 is on an absolute 0-100 scale (rows 1, 2,
  4 scale to the larger of the two).
- Honesty line under the table (and under "Whole trip: ..."): "Maps simulates typical indoor GPS/Wi-Fi; Lodestone
  simulates ~1 m positioning. Both measured live on your walk." (Without a Lodestone phase: "... measured live on your walk.")
- **New metric** `dotWithin5Before/After` (`stats.js`, also in `fair.before/after.dotWithin5`): share of the once-a-second
  error samples where the dot is on the right floor AND <= 5 m (horizontal) from the true position. Same samples as
  position error / wrong floor, null under 20 samples. `demo.summary()` copies it to `before.dotWithin5` / `after.dotWithin5`
  (falls back to the phone's `series` when the field is absent).
- **Layout (left column)**: headline, kicker, note, primary buttons (Keep exploring + Replay), "I'd love to hear what you
  think.", then two contact cards. DOM order = visual order, so Tab goes Keep exploring, Replay, agent, call. E / Enter /
  Space confirm the highlighted button, arrows / A D switch it (unchanged; verified, see below).
- **Contact cards**: two equal-width cards (stack under 720 px), tinted icon circle (chat bubble / calendar, inline SVG),
  title + one-line muted subtitle ("Ask anything about my experience" / "Pick a time that works for you"), accent border
  (cool blue agent, warm amber call), hover/focus lift + glow, ↗ in the corner. Same URLs, `target=_blank`,
  `rel="noopener noreferrer"`, sr-only "(opens in a new tab)". Reduced motion: no lift.

## Verification
Standalone harness (not committed; the endcard module with fake summaries on a dark backdrop) at 1280x720, 1024x576,
390x844. Shots in `notes/v7-shots/endcard/`: `normal-*`, `noup-*` (never upgraded), `lost-*` (lost player, after-side
heading "—"), `normal-focus-*` (Tab focus), `normal-hover-1280x720.png`. Zero console errors; no horizontal overflow.
Keyboard: Tab order [Keep exploring, Replay, agent, call]; E / Enter / Space -> roam; ArrowRight then E -> replay.

## Caveats
- Fonts in the harness fall back (no Inter in the sandbox), so card titles wrap a little more than they will for Zack.
- A wrong-floor sample counts as "not within 5 m" (the dot is on another floor). Same rule both phases, but it means
  Maps' row-3 number is a little lower than a purely horizontal definition would give.

## Real run (tools/walk.mjs, bot, 1024x576): `notes/v7-shots/endcard/realwalk-1024x576.png`
Position error ±17 -> ±0.5 m (p90 26 -> 0.5) · wrong floor 20% -> 0% · **blue dot within 5 m 6% -> 100%** · arrow catch-up
9.6 s -> 0.1 s. `ctx.errors []`; `loadprobe` READY 67.6 s [].
