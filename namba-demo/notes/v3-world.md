# v3 — World (item 7: escalators that "go nowhere")

Owner files touched: `js/render/intrusions.js` (new), `js/render/visibility.js`,
`js/world/arch/ceilings.js`, `js/world/arch/surfaces.js`, `js/world/arch/escalators.js`.
Screenshots: `notes/v3-shots/world/before/*.png` vs `notes/v3-shots/world/after/*.png`
(file name = `pose_<level>_<x>_<z>_<yawDeg>_<pitchDeg>`).

## Root causes (with evidence)

Found with a raycast probe (teleport + `THREE.Raycaster` against layer 0 from the camera; the
first hit's mesh / chunk / material) and the baseline screenshots.

1. **The Nankai viaduct runs through Namba CITY 2F and Namba Parks** (the player's two
   screenshots). `js/world/transit/env.js` builds the Nankai viaduct straight south from the
   platform ends (z 110) to `visRange` end z 245, across the whole track width x -51..17, at
   3F - 2.35 m. Its pieces land inside other zones' interiors:
   - deck underside at **y 9.65** — below the Namba CITY 2F ceiling (10.0) and the Parks 2F
     ceiling (10.2). Probe: from CITY 2F (0,150) every upward ray hits
     `transit_env:transit_concrete` at 9.65; from the Parks 2F escalator foot (-2,216) every
     ray above the steps hits it too. Visible whenever 3F is drawn (from 2F: always, ±1 level),
     i.e. the whole CITY 2F south mall and the Parks 2F hall have a flat, unlit concrete ceiling
     and the Parks 2F→3F escalators rise straight into it (`before/pose_2F_-2_216_180_18.png`).
   - ballast top at **y 10.89** (faces up) — from Parks 3F at the top of the 3F→2F down
     escalator the well "bottom" is this gravel plane ~1 m below your feet = the speckled
     "ground" of screenshot 2 (`before/pose_3F_-2_238.5_0_-35.png`).
   - a catenary portal at z 216: beam at **y 18.6 across the Parks 4F corridor** (probe hit at
     5.9 m from (-1,222) on 4F), posts through the Parks 3F shops.
2. **City ground plane over street stair wells.** `js/world/outdoor/street.js` lays a 1.5 km
   asphalt disc at y -0.4 (`street:ground`, global outdoor root, shown within 70 m walking of
   daylight). It has no holes, so every street stair from B1 (NAMBAWALK exits 15/18/21/24,
   Midosuji exit 1) "runs into a ground" 0.4 m below the street (probe at exit 15: rays down the
   well hit `street:ground` at -0.4).
3. **Generic: wells read as slots into a blank plane.** The well ceiling on the upper level was a
   plain, unlit continuation of the upper ceiling (`ceilings.js`, last loop), the opening in the
   lower ceiling had no edge treatment, and nothing marked the bottom landing. From the foot,
   through a 4 m x 14 m slot, all you see of the upper level is that plain ceiling.
4. **Parks 6F well opens onto black.** The 5F→6F escalator footprint (z 276-290) starts 8 m
   before the 6F dining floor does (z 284); on 6F those well cells have SOLID on three sides and
   nothing built above the floor → black void beyond the top landing
   (`before/pose_6F_-2_296_0_-25.png`).
5. Not a cause: per-level culling. `visibility.js` always draws own level ±1 and other-level
   chunks near an opening (the Nankai / CITY / subway shots show the destination level through
   every well); camera far plane 900 m, fog irrelevant at these distances. Only a small pop risk
   at the level swap (other levels used 60 % of the draw distance) — fixed below.

## What changed

- `js/render/intrusions.js` (new; called once from `Visibility.init`, before chunk records):
  - removes `transit_env:*` triangles that lie inside an indoor walkable volume (floor .. ceiling
    + 0.6 m plenum) or a ramp well of a non-transit zone (keeps nankai / midosuji / sennichimae).
    Big triangles are split along the longest edge down to ≤ 3 m first, but only where their box
    touches such a volume (per-level cell masks), so the viaduct survives over solid ground and
    over the station. Result: CITY 2F and Parks get their real ceilings back; the Parks well
    bottom is the 2F floor; the 4F beam is gone.
  - rebuilds `street:ground` as a disc with holes over every 1F opening to B1 (street stair
    wells, 1F voids, B1→1F escalator wells).
  - logs `[render] intrusion clip: …`; result in `ctx.visibility.intrusions`.
- `ceilings.js` `buildWellCeilings` (replaces the plain "ceilings over ramp wells" loop): per
  bank, on the upper level: a raised coffer over the well (up to +0.7 m, capped under the next
  slab), plaster step + warm/cool cove light on the rim where the neighbour has a ceiling, a line
  light over each lane for the full well length, declared to lighting as strip lights with a range
  that reaches the lower floor (the bake already pours upper lights through ramp holes: the steps
  and the bottom landing get lit), and **shaft walls** wherever the upper level has no floor
  beside the well (Parks 6F).
- `surfaces.js` slab edges: ramp-well openings get a lit reveal line along the lower edge of the
  slab (mood colour), so from below the opening in the ceiling reads at once and matches the well.
- `escalators.js` `_landingLights`: a "down" light pool 2 m beyond the foot of every indoor bank
  (bake only), so the patch of lower floor seen from the top reads as a lit landing.
- `visibility.js`: while riding a ramp, the destination level is drawn at the full own-level
  draw distance (was 60 %), so nothing pops at the level swap.

## Perf

See the table at the end (filled from `tools/perfshot.mjs`, headless SwiftShader, quality=high).
Architecture: +33 meshes over the whole map (new materials in some chunks), +1.8 k triangles,
+53 baked lights (offline build). Intrusion clip: -5.9 k / +7 k triangles in the transit chunk,
one-off ~15-50 ms at init (measured 170-300 ms on this 4-core box at load average 18).

## Requests (not my files)

- **Transit (`js/world/transit/env.js`)**: stop the Nankai viaduct structures (deck, ballast,
  parapets, catenary portals) where the tracks end (z ≈ 120) or at least before Namba CITY's
  south half; `massing.js` already draws the viaduct swinging west past Parks
  (`viaductAt`). `visRange` [.., 245] also lets departing trains drive through the Parks
  building at 3F — consider ending it at ~170 or following `viaductAt`. With this,
  `intrusions.js` finds nothing to clip (it stays as a guard).
- **Outdoors (`js/world/outdoor/street.js`)**: build `street:ground` with holes over 1F
  openings (or as a ring around the complex); `intrusions.js` does it at init meanwhile.
- **Layout (optional, lead)**: real escalator openings usually extend 1-3 m past the foot of
  the escalator (double-height bottom landing). Adding `voids` on the upper level just beyond the
  low end of the CITY / Parks banks (glass rail) would let you see the upper floor's ceiling
  lights and people from the foot. Not done (changes nav/collision).

## Open / unsure

- See bottom of this file after the measurements.
