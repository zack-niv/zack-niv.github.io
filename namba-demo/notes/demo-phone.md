# Demo — Phone & Lodestone (owner: js/ui/phone.js, js/ui/phone/*, css/phone.css)

## API for the game / end card (all on `ctx.phone`)
- `offerLodestone()` — Aya texts *"you're lost aren't you 😂 install Lodestone — it actually works indoors"* with a tappable link card. Idempotent. Equivalent: emit `phone:message {from:'Aya', text, link:'lodestone'}` (the phone notices `link:'lodestone'`).
  **Fallback:** if nobody called it, the phone offers it itself after ~150 s of play (`ctx.started`, not paused).
- `installLodestone()` — opens the phone, install (~2 s) → calibration "Learning this building's magnetic fingerprint…" (~3.3 s, phone sways in a figure-8) → ready. Also triggered by clicking/tapping the link card, or pressing Enter / E / I while the phone is open and the offer is showing.
- `positioningMode` — `'gps'` | `'lodestone'`. Flips to `'lodestone'` at the START of stage `ready` (the dot snaps to the truth from then on, in Maps too).
- `upgradeStage` — `'none'|'offer'|'installing'|'calibrating'|'ready'`.
- Events: `phone:upgrade {stage:'offer'|'installing'|'calibrating'|'ready'}`; `lodestone:arrive {id}` and `phone:arrive {id:'b:parks_6Fdw03', source:'lodestone'}` when the player's TRUE position is at Daikichi's door (the game still owns `demo:arrive`; the phone listens to it and freezes the stats).
- `stats()` → exact fields (all numbers unless noted):
  `mode` ('gps'|'lodestone'), `stage`, `upgraded` (bool), `finished` (bool, frozen on `demo:arrive`),
  `meanErrorBefore`, `meanErrorAfter` (null until at least one 'after' sample), `maxErrorBefore`, `maxErrorAfter` — metres, horizontal distance between the position the phone DISPLAYS (the GPS belief before; the Lodestone position, ±0.35 m wobble, after) and the player's true position, sampled once per second;
  `wrongFloorSeconds` (= `wrongFloorSecondsBefore`), `wrongFloorSecondsAfter`;
  `secondsBefore`/`secondsAfter` (= `timeBefore`/`timeAfter`, real seconds), `minutesBefore`/`minutesAfter` (real minutes), `gameMinutesBefore`/`gameMinutesAfter` (game-clock minutes);
  `metresBefore`, `metresAfter` (walked), `samplesBefore`/`samplesAfter`, `reroutes`, `floorFlips`, `compassPrompts`, `series: [[t, errM, wrongFloor 0|1, phase 0|1], …]` (1 Hz, for a chart).
  Samples are NOT taken while `ctx.paused`/game paused, for ~2 s after `player:teleport` (or any single-frame jump > 2.5 m, which also is not counted as walking), or during the ~1.4 s snap to the truth when Lodestone turns on. The game agent's `demo.js` reads `meanErrorBefore/After`, `wrongFloorSeconds`, `wrongFloorSecondsAfter`, which exist as named.
- Default destination = Tempura Daikichi (`parks_6Fdw03`); Lodestone navigates to its door node automatically.

## What changed in the "before" phone
- `positioning.js`: terminal (3F/2F) and 1F are now properly bad (sigma 8.5/9 m, snaps, heading bias up to 18 deg); adjacent-floor guesses also on 3F/2F, roughly every 85 s for ~14 s. New `mode` + `setMode('lodestone')`: ±0.35 m residual (halo ±1 m), true yaw, floor instantly correct (also mid-escalator).
- `mapapp.js`: "GPS signal weak / lost · move to an open area" chip, figure-8 "Compass needs calibration" prompt (underground, ~every 70 s), place card shows crow-flies distance AND a walk time, ETA now in *real* walking minutes (dist/1.4 m/s, no 6x clock factor, no "arrive HH:MM"), directions on other floors: "Directions for the remaining floors will appear once we detect you on 2F. (We're not sure when that is.)". Re-routes are counted in stats.

## Lodestone (files)
- `phone/lodestone.js` — the app (install, calibration canvas, main screen, sheet, steps list, arrival).
- `phone/stack3d.js` — the 3D exploded stack (own small WebGLRenderer, built once on install behind the progress bar, renders only while the phone is open on Lodestone). Floor plates greedy-meshed from `world.grids` (zone tinted, rooms darker), slab sides, wall/partition outlines from `world.edges`, screen-space route ribbon with flowing chevrons, blue dot + pulse + ±1 m halo + heading wedge, destination pin on 6F, auto-framing, drag orbit, wheel/pinch zoom, "Route / Me" modes, double-click or the re-centre button to reset.
- `phone/guidance.js` — turn-by-turn from `routeLegs()` on the nav field (fieldNoEntry, so never through fare gates): turns > 55 deg, zone entries ("Continue into Namba CITY", "Cross the bridge"), escalators ("Escalator down 3F → 2F", chained ones merge: "Escalators up 2F → 6F · 4 flights"), arrival with the door side. Pure logic, node-testable.
- `phone/stats.js` — measurements.

## Perf / safety
- Closed phone: nothing renders (the Stack3D render and the 2D map redraw are gated on `isOpen && app`); only a 2.5 Hz O(1) arrival check runs once Lodestone is ready.
- Route/guidance recomputed at 2 Hz while Lodestone is on screen and the player moved > 0.9 m (a few hundred µs; the one-off cost field ~150–300 ms is computed behind the install progress bar).
- Zero dependence on Oriient name/logo/colours: graphite + amber, our own compass-needle mark.

## Known issues
(see bottom of this file; updated at the end of the session)
