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

## Numbers

See the final report (sim probe and walk.mjs).
