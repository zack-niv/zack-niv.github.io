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

## Ship-day fixes (critic B1 / B3 + small items)
- **B1 (riding the first escalator).** `routes.js routeLegs()` now handles a route that starts ON a ramp node: the first leg is a 1-point leg that ends in that ramp, its direction is the REAL direction of travel (the level the field leaves the ramp at), `rampStart` is how far along the ride the player already is, and the next leg starts on the destination level. Guidance draws and counts only the remaining part of the ride (`at` = 0, "Escalator down 3F -> 2F"). Guards: legs with no points are dropped, `compute()` returns `{ok:false, bad:true}` if total/eta/any step distance is not finite, and `lodestone.js` keeps the last good route in that case; `fm()` / mins / dist / floor changes in `_renderSheet` never print NaN.
- **B3 (canyon via-point).** `Guidance` has a waypoint `via = {2F, 33, 222}` (canyon, ~8 m into the open air from the Parks hall). While `!viaDone`: route = `fieldNoEntry(wp)` from the player to the waypoint, then the normal field from the waypoint to Daikichi (`routeLegs` x2, concatenated; the first leg's `via` flag adds the step "Walk out into the Namba Parks canyon / Open air · 2F" and an amber "Canyon" marker in the 3D stack, and resets the turn direction so the way back is not a "turn around"). `viaDone` becomes true (and stays) as soon as the player is in an outdoor parks/parksGarden space, in any parks space above 2F (indoor escalators taken), or within 5 m of the waypoint. `Guidance.noteBody()` is also called from Lodestone's 2.5 Hz arrival check, so it works with the phone down. `compute()` returns `via: bool`. Cost: about +60 m (399 -> 459 m from the first escalator).
  Real path canyon -> 6F (check script `scratchpad/fix-phone/canyon1.mjs`): canyon (34,223) -> back through the 2F hall -> (-3,223) -> esc_pk_23/34/45/56 -> 6F dining -> Daikichi; 0 off-grid points. Steps read: "Cross the bridge" -> "Walk out into the Namba Parks canyon" -> "Escalators up 2F -> 6F · 4 flights" -> "Arrive at Tempura Daikichi · on your right".
- Escalator step icon: ramp / arrive / canyon steps always show their own glyph (up / down staircase-arrow, flag, canyon); the rotating live arrow is only for walking steps further than 12 m away; turns show the left/right/u-turn glyph within 12 m.
- Destination chip in the 3D stack is clamped inside the canvas (anchor shifts when the pin is near an edge). Messages header name "Aya" is now dark on the light header. Calibration read-out strip: separators + padding so values never touch the next label.
- Gates are two-way at `g_nk_central` now (lead): no lane logic in the phone.

## Known issues / weaknesses
- The last two tweaks (stack framing band `bandBottom` 262 so the dot clears the Route/Me controls; floor correct from the first frame of `ready` -- the reveal card could say the old believed floor) were NOT re-screenshotted (browser slots were starved for ~2 h).
- Screenshots: scratchpad `demo-phone/shots/` (30_maps_before, 31_offer, 32_installing, 33_calibrating, 34_ready_reveal, 35_* views, 36_follow, 37_steps, 38_arrival).
- Nankai-3F overview is the weakest framing: the route is a long thin diagonal so the stack is small and the dot sits near the controls.
- Full-page headless screenshots with the peek card (backdrop-filter over WebGL) crash SwiftShader: element screenshots only.
- Parks 6F top-down arrival view is zoomed in (route length 0) -- intended, but the label sits close to the pin.
- Mobile/touch: orbit and pinch implemented but not tested on a device.
- Evidence (scratchpad `fix-phone/`): `via.mjs` (Node: sheet/steps from 14 positions, all finite), `canyon1.mjs` (real canyon -> 6F path), `run.mjs`/`run2.mjs` (browser: sheet text with `body.ramp = 22`, bridge, canyon, back at the bridge; shots `03b_escalator_ride`, `05b_bridge`, `06_bridge_steps`). Not re-screenshotted after the last tweaks: the calibration strip padding (measured 3 px overflow at the worst values, then tightened by ~20 px) and the lifted "Canyon" chip in the 3D stack (it was partly under the "▲ 6F" chip in `05b_bridge`).
