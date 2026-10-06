# Outdoors & Namba Parks — running log

Owner files: `js/world/exterior.js`, `js/world/parks.js`, `js/world/outdoor/*`.

## Cross-area edits / requests
* **architecture.js / arch/surfaces.js (one line, additive, already in):** WALL edges whose walkable side is an
  `outdoor` space are not drawn by Architecture (collision unchanged). Exterior (`outdoor/street.js`) and
  Parks (`canyon.js`, `terraces.js`) dress those boundaries (kerbs + guard rails, hedges, canyon strata,
  terrace parapets, bridge glass rails). Please keep this rule.
* Rendering: first use of each distinct shader program is the dominant "frame" cost on SwiftShader (see Perf).
  A `renderer.compileAsync(scene, camera)` warm-up for the outdoor programs at load would hide it.

## APIs (ctx.exterior)
`sun {direction, color, intensity, baseIntensity, elevation, azimuth}`, `daylight` palette (night 0..1),
`isOutdoor(level,x,z)`, `outdoorAt(level,x,z)`, `outdoorFactor`, `horizon` colour, `traffic` (signal state
`ex.traffic.signal.{A,B}` = 'g'|'y'|'r'), `timings` (ms per build step). Parks: `ctx.parks.timings`.

## Round 2 log
* FIXED shader error `out_facade_office`: `objectNormal` was used before `beginnormal_vertex`. Facade shader is now
  ONE program for every kind (office/grid/curtain/apartment/stone/shop selected by per-vertex `aKind`, see
  `MeshAcc.kv`, `facadeAcc(kind)`), instead of 5 programs.
* NEW `outdoor/street.js` (was an empty stub): Sennichimae-dori + Midosuji roads (asphalt, lane/zebra/stop-line
  markings, kerbs, guard rails, hedged planters, bays), ground plane, 4 zebra crossings, signalised Midosuji
  crossing (vehicle + pedestrian signal heads whose lamps follow the cycle), ~360 instanced vehicles (taxi, sedan,
  kei, truck, bus; car-following + stop lines, `outdoor/traffic.js`), ginkgo avenue (4 rows), plaza planters/benches
  (obstacles registered), street lamps (modest light registrations), vending machines & bicycle rows (obstacles).
* NEW `outdoor/storefront.js`: neon frontages on both sides of Sennichimae-dori, the Midosuji wall, the plaza-side
  annex block and the Exit 24 alcove: canvas shopfront atlas (24 JA/EN shops) + blade/wall/roof sign atlas, lit by
  night via emissive intensity (`updateStorefronts`).
* `skyline.js`: generic city blocks may now fill the gaps INSIDE the complex rectangle (tested against the walk grid
  of 1F..8F + keep-out rects) so views from the gardens are no longer a void; height capped 34 m there.
* `Vegetation.update(dt, cam, advanceWind=true)` — second Vegetation instances pass `false` (wind clock shared).

## Open issues (ranked) — see bottom of file for the latest after the critique pass
1. (pending measurements)
