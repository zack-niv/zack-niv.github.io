# v6 — Story (items 1, 2-tutorial/IC, 8, 9-pacing) · owner: js/game/*, js/ui/hud.js, js/ui/title.js, css/game.css, index.html

Status: **done.** Walk 2 (final code) completes; see Results. (contract below is implemented as written, adapted to notes/v6-gates.md)

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

## End card (items 8 + 9) — implemented

- Under the note: one line *"I'd love to hear what you think."* + two quiet pill links **Chat with my AI career agent ↗**
  and **Book a call ↗** (`<a target="_blank" rel="noopener noreferrer">`, a visually hidden "(opens in a new tab)").
  Tab order: agent → call → Keep exploring → Replay (native Tab; the card no longer hijacks it). E / Enter / Space still
  confirm the highlighted game button, ← → switch it; with focus on a link the keys are left to the browser.
- Rows (fair per-unit, every number this player's own):
  1. **Position error**: mean, caption *"mean · 90% within ±24 m"* (p90 from the phone's `errP90*`).
  2. **On the wrong floor**: % of the phase's time (`wrongFloorPct*`).
  3–4. Up to two more, in this order, **only when the two phases genuinely differ** (equal numbers say nothing, whichever
     side they favour): detour factor (≥ 0.15 apart), wrong turns /km (≥ 0.5), **Reroutes** "Recalculating…" /km (≥ 1),
     **Compass error** ° (≥ 5). A perfect walker (the bot) gets reroutes + compass; a lost human gets detour + wrong turns.
  - Never upgraded: rows 1–2 before-only (+ net progress row when it tells the story). "Whole trip" line kept.
- Data: `demo.summary()` adds `p90, wrongPct, detour, gained, turnsPerKm, reroutesPerKm, headingErr` per phase. The
  phone's own field wins whenever it publishes it (including its `null` = not enough data); own fallbacks otherwise.

## Results

- **Gate probe (real Gates API)** `g2-*`: 8 m out *"Tap your IC card at the gate — walk up to a lane, then E"* (center) →
  at the channel prompt **E Tap your ICOCA · タッチ** + tip *"E interacts — here, it taps your IC card"* → E →
  `ic:pay fare 970`, chip *"運賃 Fare −¥970 · 関西空港 → なんば · Kansai Airport → Namba · 残額 ¥2,030"*, `gate:tap`,
  tutorial `gate` done, prompt *"Open — walk through"* → `gate:pass {player:true}`. `ctx.errors []`, 0 console issues.
- **Blocked probe** `g3-04-blocked.png`: `gate:blocked notap` → *"Tap your IC card first — E"* ✓ (but see the Gates
  finding below: the player is not physically stopped).
- **Full walk** (walk1, before the row/bot fixes): gate tap at 63 s (¥970), "Where are you??" at **175 s** (bot always
  progressing → the `whereLatest` fallback), offer 183 s (`lost`), Lodestone ready ~190 s, café order 270 s (`ic:pay
  purchase 520`, balance 1,510), arrival 496 s, end card shown. `ctx.errors []`; console: only the bot's own dbg warnings.
  End card (real numbers): ±15 m (p90 24) vs ±0.5 m · 16% vs 0% wrong floor · 27 vs 0 reroutes/km · 16° vs 0° compass.

- **Full walk 2** (final code, `walk2-14-endcard.png`): same beats — gate E at 63.4 s (¥970), where 175.2 s (latest),
  offer 183.7 s, latte 276.5 s (¥520 → 1,510), arrival 502.6 s. End card: ±18 m (p90 26) vs ±0.5 · 10% vs 0% ·
  27 vs 0 reroutes/km · 16° vs 0°. `ctx.errors []`, console: the bot's 2 dbg warnings only.
- Known bot quirk: at 104.5 s the bot also taps IN at lane 18 of `g_nk_central` (walking beside the gate line to the
  3F→2F escalator; its 10-node look-ahead crosses the line). ¥0 tap-in, no charge, harmless; a human wouldn't press E.

## Requests / findings for other agents

- **Gates (13:50 probe, `notes/v6-shots/story/g3-04-blocked.png`):** walking into channel 12.1 of `g_nk_central` from the
  platform side without tapping fires `gate:blocked {reason:'notap'}` (Story's "Tap your IC card first — E" shows), but
  the player is **not stopped**: 2.5 s of forward input later they stand at z −67.4 (flap line −66) and keep going to
  −71.7, i.e. through the gate without paying. Probe: player stepped with `ctx.systems[*].update(0.05)` (same as
  walk.mjs), `input.setScript({x:0,y:1})`. The tapped path works (g2: E → ¥970 → `gate:tap` → `gate:pass {player:true}`).
