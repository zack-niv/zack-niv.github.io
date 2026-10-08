# v6 — Gates (item 2, world side)

Owner: Gates agent. Files: `js/world/transit.js`, `js/world/transit/*`.

## API for Story (published first; stable)

All on `ctx.transit`. Lane ids are the **existing** lane indices (`gateLanes()`, `laneAt()`, `gatePass()`, the crowd
sim), so nothing else changes. Each 3–5 m "lane" of the layout is now drawn as 3 (Sennichimae: 5) real-size gate
channels ("sub-lanes", ~0.75 m clear, 1 m pitch). The crowd always uses the centre channel; the player can use any.

### `gateLaneNear(x, z, level)` → `info | null`

The gate channel the point is standing in or approaching (≤ 2.4 m in front of the gate line, inside a channel's
width), else `null`.

```js
{
  gate: 'g_nk_central', lane: 7, sub: 1,      // pass gate+lane+sub straight to tapGate
  dir: -1,                                     // +1 = entering the paid side, -1 = leaving it
  ok: true,                                    // false = this channel is the wrong way (red ✕ LED)
  open: false,                                 // already tapped and open for the player
  policy: 'both'|'in'|'out',
  line: 'nankai'|'midosuji'|'sennichimae', name: 'Central Gate', ja: '中央改札口',
  dist: 1.3,                                   // metres from the gate line
  reader: { x, y, z },                         // the IC pad the player would tap (put the E hint here)
  x, z,                                        // channel centre on the gate line
}
```

### `tapGate(gate, lane, opts?)` → `{ ok, reason }`

`opts` may be a number (`sub`) or `{ sub, deny, quiet, balance, fare }`. Without `sub` it uses the channel nearest the
player.

- **Success**: the channel opens for the player for ~3 s (it stays open while the player is in it): reader flash,
  green arrow LED, "pi" beep (`ctx.audio.play('gate_ok')`, or `gate_low` if `balance < 300`), flaps stay retracted.
  The exit-side LCD shows `fare`/`balance` if given. Emits **`gate:tap { gate, lane, sub, dir, line, level, x, z,
  player: true }`**.
- `reason: 'lane'`: wrong-way channel. Red ✕ flashes, flaps snap shut, buzzer, emits `gate:blocked` (reason `lane`).
- `opts.deny = 'balance'` (or any string): use this when `icCharge` fails. The card is refused: red flash, flaps
  shut, "pin-pon" buzzer, emits `gate:blocked` with that reason, returns `{ ok: false, reason }`.
- `reason: 'none'`: unknown gate or lane.

**Recommended Story flow on E:** `n = gateLaneNear(p.x, p.z, p.level)` → if `n && n.ok`: charge
(`icCharge({ amount: dir < 0 ? fare : 0, kind: 'fare' … })`) → `tapGate(n.gate, n.lane, { sub: n.sub, balance, fare })`
or, if the charge failed, `tapGate(n.gate, n.lane, { sub: n.sub, deny: 'balance' })`. **Please don't also
`audio.play` or emit `ic:tap` for gate taps**: the gate voices its own beep (or pass `quiet: true` and voice it
yourself).

### Events

- `gate:tap { gate, lane, sub, dir, line, level, x, z, player: true }`: the player's card was accepted.
- `gate:blocked { gate, lane, sub, dir, level, x, z, reason: 'notap'|'lane'|<deny> }`: the player walked into a
  channel without tapping (`notap`), or a tap was refused. The flaps snap shut with the buzzer and the player is
  physically stopped at the flaps (a collision segment), until they step back out of the channel or tap.
- `gate:pass { gate, lane, dir, ok, level, x, z, player? }`: unchanged for NPCs. For the player it fires once when
  they cross the flap line of an open channel (`player: true`).

### `setGateHint(gate|null, lane?, sub?)`

This pulses the IC reader pad(s) for the tutorial. With only `gate`, every channel of that gate pulses that suits the
player's direction. `setGateHint(null)` clears it.

### Notes for Story (`js/game/game.js`)

- `_checkGates()` still sees the player cross the line, but now only after a tap (or never, if blocked). Move the
  fare to `gate:tap` / your E handler. Remove the `_flaps()` → `gatePass()` calls for the player: the gate animates
  itself. `_refuse()`'s push-back is no longer needed for wrong-way lanes (the flaps stop the player), but it's
  harmless.
- The old `ic:tap` → `transit._onTap` hook is **removed** (it double-animated). `ic:tap` is still voiced by audio.js if
  you emit it, so don't emit it for gates (see above).
- **The walk bot (`tools/walk.mjs`) must now tap** at the Nankai central gate and any metro gate on its route:
  call `__namba.transit.tapGate(...)` from `gateLaneNear` when within ~1.5 m, or press E once Story wires E.
  Without that the bot gets stopped at the flaps (that is the feature working).

## Status

(see below; updated as work lands)
