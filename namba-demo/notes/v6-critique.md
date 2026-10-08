# v6 critique (critic + fixer)

Two full `tools/walk.mjs` runs (walk1 = the agents' code, walk2 = after my fixes), a gate collision probe, stalled and
wandering timing probes, end-card renders, `leakprobe` (2 poses, plus the pre-v6 tree for comparison), a full-route
`zfightprobe` (24 poses) and `loadprobe`. Shots are in `notes/v6-shots/critic/`. Every run had `ctx.errors []`, and
the only console lines were the bot's own 2 `dbg` warnings (plus the sandbox font cert error and SwiftShader GL perf
notices in the shot tools).

## Scorecard (before my fixes → after)

| # | Item | Before | After | Evidence |
|---|---|---|---|---|
| 1 | "Where are you??" too early | fixed | fixed | Stalled player: fires at **95.4 s** (`stalled`). Pacing back and forth on the platform: **95.5 s**. Bot making steady progress: **175 s** (`latest` fallback). Offer: 183.7 s (bot replied "I'm lost"), **197 s** fallback for stalled or wandering players (3:17). |
| 2 | Reactive gates + E tutorial + one IC mechanism | partly | fixed | Untapped walk-in (straight, jog, ±0.5 rad diagonals, and 8 forward+strafe squeezes from inside the channel) is **always stopped at z −65.72** (flap line −66). `world.move` into the divider stops at lane ±0.126 m (= pitch/2 − 0.39, as specced). Tap → pass works. The ¥970 fare is charged **once** (a second tap on the neighbouring sub-channel, tap-in and tap-out are all ¥0). The chip renders (`gate-03-tap-chip.png`). **Bug fixed:** after a blocked walk-in and then a successful tap, "Tap your IC card first — E" stayed on screen beside "Open — walk through" (also visible in Story's `g3-03`). Shots: `gate-01-blocked-flaps.png`, `gate-03-tap-chip.png`. |
| 3 | Escalator turns blue/silver when riding | fixed | fixed | World's before/after (`world/after/esc_2_riding.png`): same dark warm steel while riding. Riding costs 929 calls on high, against a 900 budget. That is governed, not a cliff: `visibility.js` pulls the draw distance in ×0.96 per 400 ms while calls exceed the budget (×0.9 above 1170). Not re-measured on a real GPU. |
| 4 | Planter pot/soil | fixed | fixed | World's geometry fix (lid and soil are no longer coplanar). The zfight route sweep shows no planter class. |
| 5 | Bridge/floor seam | fixed | fixed | Not in the route sweep (the deck × sill classes are 0). Leak at `3F,26,239,-90,15`: **2.6 %**, against **3.3 %** on the pre-v6 tree. The same far massing/kerb back faces as before, and the old `ceiling_grid` (the floating slab) is gone, so no regression. |
| 6 | Floating slab over the canyon stairs + nav | fixed | fixed | Leak at `2F,36,224,90,20`: **0.0 %**. From Zack's angle (`views/pose_2F_31_219_60_28.png`) there is no slab. Nav: both walks reach Daikichi following Lodestone; **0 "behind" cues** in the turn-by-turn samples. |
| 7 | "Escalator behind you" while riding | fixed (Node only) | fixed + shot | **First screenshot of the raised card mid-ride** (`walk2-09r-riding-full.png`): "On the escalator · 15 m to go / Riding down to 1F / THEN Turn right". I polished the eyebrow, which wrapped as "· 15 / m to go"; it now uses non-breaking spaces (not re-shot). |
| 8 | Contact links | fixed | fixed | Both URLs are exact, `target=_blank` and `rel="noopener noreferrer"`. Tab order: agent → call → Keep exploring → Replay (`endcard-*-focus-*.png`). |
| 9 | Frustration + honest stats | partly | fixed | Maps "Recalculating…" came every ~15 s (58.9/km, 13 in 192 s), which read as noise. Now it comes every ~40 s (**18.3/km**, ~5 in 192 s), and the dot still drifts and hops, with 16–28 % wrong-floor time. The end card now always shows **4 meaningful rows** for a straight-walking player (`walk2-14-endcard.png`): ±17 m → ±0.5 m, 16 % → 0 % wrong floor, 18 → 0 reroutes/km, **arrow catches up 3.5 s → 0.1 s**. It never shows "0 % → 0 %" or "1.0× → 1.0×" (`endcard-bot0`, `endcard-lost`). |

The first 5 minutes play cleanly: Aya's hello at 11.7 s, Maps pick at 24 s, gate tap at 63 s (¥970), "Where are you??"
at 175 s for a progressing player, offer at 184 s, Lodestone ready at 192 s, latte at 266 s, arrival at 491 s
(walk2 492 s), end card shown. Route, upgrade moment, canyon loop and arrival are unchanged between walk1 and walk2.

## Files I changed

- `js/game/story.js`: a player `gate:tap` clears `f.blockedT`, so "Tap your IC card first" no longer lingers next
  to "Open — walk through".
- `js/game/endcard.js` + `js/game/demo.js`:
  - `demo.summary()` now passes the phone's `headingSettle` per phase;
  - the end card has a new row, **"Arrow catches up"** (s after a turn), ahead of compass error;
  - the wrong-floor row shows only when Maps actually got the floor wrong (≥1 % or ≥2 s);
  - rows fill up to 4 from the "genuinely differ" list (it was a fixed 2 extras).
- `js/ui/phone/mapapp.js`: the Maps off-route reroute fires at **24 m for 4 s, at most every 12 s** (was 18 m / 3 s /
  6 s). Believed-floor reroutes are unchanged.
- `js/ui/phone/lodestone.js`: non-breaking spaces in "On the escalator · 15 m to go".
- `js/world/outdoor/structures.js`: the Parks skywalk roof slab's underside sat exactly on the skywalk's wood ceiling
  (y + 3.6). It z-fought over **276 m² on 6F and 292 m² on 7F**, rendering as half wood, half cream right beside
  Daikichi (`views/pose_6F_36_328_90_35.png`). It now sits 2 cm higher. That pose went from **615.9 → 48.8 m²**
  (`views-after/…png` is clean wood).
- `tools/walk.mjs`: captures the raised Lodestone card on the first ride (`09r-riding-dev/-full`, "RIDE CARD" log).

## What remains (v6.1 candidates)

- **Shop interiors z-fight** (World's Open 1, confirmed): the full-route sweep finds 2685 fight clusters (2183 m²).
  The 6F skywalk dominated before my fix; now the bulk is `env_matte × env_matte`, `env_poster/env_sign × env_matte`
  and `steel_dark` skirting × `env_matte` at shop partitions, on every floor. It is likely one or two shared offsets in
  `env/shopbuild.js`. It is visible as flicker inside shops on a real GPU and is the next World task.
- `parks_slab_under × parks_vcol_stone` (14 m², 6F skywalk soffit) and `floor_deck 7F × canyon` (8 m²) are small.
- The Lodestone glance flickers between "Turn left" and "Escalators up" for ~4 s at the Parks 3F escalator foot (and
  the café 1F foot) when the bot brushes the down lane's mouth. This is the known bot snag spot and rare for humans.
- The NBSP ride-card tweak and the skywalk slab were not re-run through a full walk. The skywalk shot loaded clean.
  `loadprobe` (`READY 80.3s []`) ran just before the slab edit.
- A never-upgraded player sees only 2 end-card rows (by design: net progress needs an "after").
- The gate flash/LCD readout and the escalator look on a real GPU are still unseen; so are frame rate and crowd density.

## Would this impress the team? 7.5 / 10

The gate moment now reads as Japan: reader, flaps, chip, fare. Maps is genuinely irritating without spamming, and the
end card makes an honest, obvious case with the player's own numbers. Holding it back: shop-interior shimmer on a
real GPU, and SwiftShader-only verification of looks and performance.

## Top 3 risks

1. **Real-GPU z-fighting inside shops**: a large unfixed class that a curious player "keeping exploring" will see.
2. **Performance never measured on a laptop**: gates add ~34k tris, and the escalator ride sits over budget, governed.
3. **Gate confusion for first-timers**: they are stopped hard at the flaps. The hint, prompt and pulsing pads are
   clear in screenshots, but no human has tried it yet. Watch Zack's first play of the gate.
