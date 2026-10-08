# v6 — Story (items 1, 2-tutorial/IC, 8, 9-pacing) · owner: js/game/*, js/ui/hud.js, js/ui/title.js, css/game.css, index.html

Status: **contract published, building.**

## Contract: shared IC purchases (Story → everyone)

`ctx.game.icCharge({ amount, label, ja, kind, silent? })` → `{ ok, balance, amount }`

- `kind`: `'fare'` (gates) | `'purchase'` (cafés, vignettes) | `'tap'` (tap-in, amount 0: shows "ピッ" + balance).
- `ok:false` (balance too low) charges nothing; the chip turns amber "残高不足 · Please charge".
- Drives the HUD ICOCA chip (`hud.ic`), plays `pay` for purchases (fares: the gate beep is the Gates agent's, see below).
- Emits `'ic:pay' { amount, label, ja, kind, balance, ok }`. (`'ic:charge'` stays the top-up event of the charge machine.)
- Used by: gate taps (game.js), café orders (order.js), vignettes (vignettes.js). One mechanism.

## How Story uses the Gates contract (Gates → Story)

- An interactable `gatetap` (game.js) is in range when `ctx.transit.gateLaneNear(x, z, level)` returns a lane and the player
  faces the gate line. Prompt: **"Tap ICOCA"** · タッチ, sub `Central Gate · 中央改札口 · ICOCA ¥2,000`.
- **E** → balance check (entering needs ≥ ¥190) → `ctx.transit.tapGate(gate, lane)` → if `{ok:true}` the fare is charged with
  `icCharge` (tap-out of the Nankai gate after the rapi:t: ¥970 Kansai Airport → Namba; Midosuji/Sennichimae tap-out after a
  tap-in: ¥190; tap-in: ¥0, "ピッ" + balance). If `{ok:false, reason}` Story shows the reason (`'lane'` → "this lane is exit-only").
- **Gates agent, please:**
  1. `gate:tap`, `gate:blocked` and `gate:pass` for the **player** carry `player: true` (NPC taps/passes must not, or carry
     `player: false`), so Story can tell them apart.
  2. `gateLaneNear(...).dir`: Story reads it as `+1` = the player is on the free side (tapping IN), `-1` = on the paid side
     (tapping OUT). If you use another convention, say so in `notes/v6-gates.md` and Story adapts.
  3. The **beep + light flash** on a successful tap is yours (transit/gates); the **buzzer** on `gate:blocked` is yours.
     Story plays no gate sound when `tapGate` exists (falls back to `audio.play('gate_ok')` without it).
  4. A refused tap (wrong-way lane, Story's low balance): Story calls `tapGate` only when the balance is fine; for the
     low-balance case Story calls `ctx.transit.refuseGate?.(gate, lane)` if you expose it (flaps shut + buzzer), else nothing.
- With the new API present, game.js stops charging on line *crossing* (the old `_checkGates` auto-tap); it only tracks the
  paid side from player `gate:pass`. Without the API (old transit), the v5 behaviour stays.
- The gate's old passive "Walk through to tap" prompt is gone.

## Tutorial (item 2)

- The old main step "{E} interacts — machines, doors, café counters" is **replaced** by a late step `gate`:
  available when the player is near the Nankai central gate on the paid side (or the `gatetap` prompt is up);
  hint *"Tap your IC card at the gate — {E}"* anchored on the prompt (center when not yet aligned with a lane);
  validated by a player `gate:tap` (or the tap itself through `icCharge`). Always taught (also on replays): you can't get
  through without it.
- `gate:blocked` (player) → a short hint for ~5 s: *"Tap your IC card first — {E}"*.

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
