# v8 — Maps (item 1: "the player should feel a bit more lost with the ordinary Maps app")

Owner: `js/ui/phone/positioning.js`, `mapapp.js` (routes.js and stats.js untouched).

## What changed

Maps mode used to be "a bad GPS": the dot always tracked you, with an Ornstein-Uhlenbeck error and hops. Indoors, real
phones have no GPS, so Maps now has three honest states, exposed as `pos.state`:

| state | what the dot does | UI text |
|---|---|---|
| `stale` | frozen (x, z, floor) for 30-55 s while you walk; accuracy circle grows 0.9 m/s up to 55 m; `pos.ageS` = seconds since the last fix | "No GPS signal · last seen 40 s ago" |
| `coarse` | a Wi-Fi/cell estimate: jumps 20-60 m to a wrong place and sits there (±1.5 m wobble, a 3-8 m re-estimate every ~14 s) for 20-38 s; sometimes the adjacent floor (first coarse 50%, forced if none yet, else 30%); a wrong-floor coarse lasts 14-24 s and is always followed by a right-floor coarse | "Approximate (Wi-Fi) ±40 m" |
| `fix` | GPS under open sky / Parks canyon / Parks glass / within 8 m of a street exit: tracks you ±4-6 m with the true floor; drops to stale 5-9 s after you leave the opening (glass/door fixes last at most 7-13 s; a 16% chance of a 4-7 s lucky blip after a coarse indoors) | "GPS · ±6 m" |

Cycle indoors: stale (first one ~38-48 s, so the first look at the map is plausible) -> coarse -> stale | rare fix blip ->
coarse ... Sky needs 2.5-5 s to lock; glass/doors lock 60% of the time after 1.2-3 s.

- Public shape kept: `x, z, level, heading, accuracy (acc), mode, wrongFloorEpisodes, hops, _lsSnap`, `noService`, `signal`, `net`, `env`.
  New: `state`, `ageS`, `lastJump`.
- `wrongFloorEpisodes` now counts each time the believed floor starts to differ from the true one off the ramps (a coarse
  guess, or a frozen floor after you took an escalator). `hops` counts every coarse jump and every fix acquisition.
- Heading: compass only, bias x1.3 and lag x1.25 without GPS (x0.8 with a fix).
- Determinism: all events (durations, jump directions, wrong-floor choice) come from a separate seeded stream `pos.S`
  (`params.seed || 7`), so runs are comparable; per-frame noise still uses `pos.R`.
- Lodestone mode untouched (`state` is set to `'fix'` there).

mapapp.js: `_accTxt()` is state-aware (home sheet, route sheet "Start" line, live every 0.5 s via `tick()`); the GPS chip
and the glance warn (static strings, since glance re-renders on change) say "No GPS signal" / "Approximate location";
the dot is grey with a dashed circle when stale, a dimmer cone, and a small tag under the dot ("No GPS · last seen 40 s
ago" / "Approximate · ±40 m"). The circle radius is capped at 170 px.

## Requests to other areas

None required. `css/phone.css` hides `.mp-gpswarn` while the route banner is up (line ~358), so during a route the state
shows in the route sheet ("Start" line) and on the canvas tag under the dot. If the Lodestone agent wants the chip during
routes, change that rule.

## Numbers (one full `walk.mjs` run, `P=m8`, quality=low; `ctx.errors` [], zero console issues beyond the walk's own dbg warnings)

| end-card "Before" | v7.3 baseline | v8 |
|---|---|---|
| error mean | 17-21 m | 34.5 m |
| error p50 / p90 | ~15 / ~30 m | 30.3 / 77.8 m (max 103 m) |
| wrong floor | 7% | 26% (49 s, 2 episodes) |
| dot within 5 m | 5% | 13% (lucky fix blips) |
| on track | 100% (bot walks the true route) | 100% |
| hops (coarse jumps + fixes) / floor flips / reroutes | | 4 / 3 / 4 (18 per km) |
| heading error | | 20 deg, settle 4.2 s |

Lodestone phase unchanged: 0.4 m mean, 0.7 m p90, 0% wrong floor, 100% within 5 m.

Lodestone offer: `demo:offer` (why `lost`) at game t = 183 s (3:03); install 187 s, ready 192 s. The offer logic reads true
progress (demo._isLost), not the phone, so it did not move. Walk finished: arrive at 499.5 s.

Screenshots (`notes/v8-shots/maps/`): `maps-stale-route.png` (route sheet, grey dot, dashed circle, "No GPS · last seen 37 s
ago" tag), `maps-stale-home.png`, `maps-coarse-route.png` ("Approximate · ±41 m" tag, the route drawn from the wrong spot),
`maps-coarse-home.png`.

## Knobs / risks

- p90 78 m is a lot: it is stale (30-56 s at 1.4 m/s = up to ~75 m behind you) plus a 20-60 m coarse jump. To soften, in
  `_enterStale` shorten `30 + S()*26`, or let the coarse anchor creep ~0.3 of the player's displacement (Wi-Fi handover).
- Maps' route is computed from the believed spot, so after a jump >24 m off the drawn leg it flashes "Recalculating..."
  (rate-limited to one per 12 s): 18 reroutes/km. Honest, but watch for noise.
- A coarse jump can land within 7 m of the destination on the right floor and trigger Maps' "You have arrived" banner
  (that is its belief, as before; `phone:arrive` has no consumers).
- Real-GPU feel (how often the fix blips land) is untested by a human.
