# v6 — Story (items 1, 2-tutorial/IC, 8, 9-pacing) · owner: js/game/*, js/ui/hud.js, js/ui/title.js, css/game.css, index.html

Status: **built; verifying with the walk bot.** (contract below is implemented as written, adapted to notes/v6-gates.md)

## Contract: shared IC purchases (Story → everyone)

`ctx.game.icCharge({ amount, label, ja, kind, silent? })` → `{ ok, balance, amount }`

- `kind`: `'fare'` (gates) | `'purchase'` (cafés, vignettes) | `'tap'` (tap-in, amount 0: shows "ピッ" + balance).
- `ok:false` (balance too low) charges nothing; the chip turns amber "残高不足 · Please charge".
- Drives the HUD ICOCA chip (`hud.ic`), plays `pay` for purchases (fares: the gate beep is the Gates agent's, see below).
- Emits `'ic:pay' { amount, label, ja, kind, balance, ok }`. (`'ic:charge'` stays the top-up event of the charge machine.)
- Used by: gate taps (game.js), café orders (order.js), vignettes (vignettes.js). One mechanism.

## How Story uses the Gates contract (notes/v6-gates.md) — implemented

- `gatetap` interactable (game.js `_gateTarget`): `ctx.transit.gateLaneNear(x, z, level)` returns a channel and the
  player faces the gate line → prompt **"Tap your ICOCA"** · タッチ, sub `中央改札口 Central Gate · ICOCA ¥3,000`;
  `open` → passive "Open — walk through"; `ok:false` → passive "Exit only — try the next gate".
- **E** (`_tapGate`): fare via `icCharge` first (Nankai tap-out after the rapi:t: **¥970** "関西空港 → なんば · Kansai Airport →
  Namba"; Midosuji/Sennichimae tap-out after a tap-in: ¥190; tap-in: ¥0 "ピッ"), then `tapGate(gate, lane, { sub, balance,
  fare })`. Low balance on the way in → `tapGate(..., { deny: 'balance' })` + chip + caption. A refused tap refunds.
  Tapping the same side again before walking through never charges twice (25 s window).
- game.js emits **no `ic:tap` and plays no sound** for reactive-gate taps (the gate voices itself). The v5 auto-tap on
  crossing stays only as the fallback when `tapGate` is missing; with it, crossing only records the paid side.
- Starting ICOCA balance 2,000 → **3,000** (after the fare and Aya's latte: 2,030 → 1,510).

## Tutorial (item 2)

- The old main step "{E} interacts — machines, doors, café counters" is **replaced** by a late step `gate`:
  available when the player is near the Nankai central gate on the paid side (or the `gatetap` prompt is up);
  hint *"Tap your IC card at the gate — {E}"* anchored on the prompt (center when not yet aligned with a lane);
  validated by a player `gate:tap` (or the tap itself through `icCharge`). Always taught (also on replays): you can't get
  through without it.
- `gate:blocked` with reason `notap` → a short hint for ~5 s: *"Tap your IC card first — {E}"* (late step `gate` before
  the lesson, `gateAgain` after it). Reasons `lane`/`balance` get game.js's own captions instead.
- Aimed at a channel the tip reads *"{E} interacts — here, it taps your IC card"* (under the HUD prompt); further away
  *"Tap your IC card at the gate — walk up to a lane, then {E}"*. While the lesson is pending and the player is within
  12 m on the paid side, `setGateHint(gate)` pulses the reader pads.

## Pacing (items 1 + 9)

| knob | v5 | v6 |
|---|---|---|
| "Where are you??" earliest | 45 s (any "lost" signal) | **95 s**, only when clearly stalled/wandering (no 15 m of progress in 30 s AND a lost reason), never while progressing |
| "Where are you??" fallback | 100 s | **150 s** (pushed to ≤ 175 s while the player is making clear progress) |
| engaged offer earliest | 45 s | 100 s |
| Lodestone offer fallback | 165 s | **195 s** (3:15) |

## End card (items 8 + 9)

- Actions: **Chat with my AI career agent** · **Book a call** — `<a target="_blank" rel="noopener noreferrer">`, tabbable,
  a secondary row under Keep exploring / Replay. One-line invitation above them.
- Metrics (fair per-unit, before vs after; a row only shows when both phases have enough data): mean position error
  (p90 in the caption), % of time on the wrong floor, metres walked per metre of real progress (detour factor),
  wrong turns per km — from `ctx.phone.stats()` when the Phone agent provides them, own measurement otherwise.
  "Whole trip" line stays.
