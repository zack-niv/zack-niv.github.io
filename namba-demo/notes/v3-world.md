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

## Measurements (headless SwiftShader 1280x720, quality=high, `tools/perfshot.mjs`, frames 5)

Draw calls / triangles at escalator wells (before = baseline copy, after = this build; crowd and
the call governor vary run to run by ~±5 %):

| view (pose) | before calls / tris | after calls / tris |
|---|---|---|
| Nankai 2F foot of 2F→3F `2F,-46,-61,0,18` | 924 / 758k | 929 / 765k |
| Nankai 3F top `3F,-46,-86,180,-25` | 979 / 1009k | 974 / 1004k |
| Nankai 1F foot of 1F→2F `1F,-37,-100.5,0,22` | 743 / 610k | 744 / 620k |
| Nankai 2F top `2F,-37,-123,180,-25` | 658 / 814k | 669 / 866k |
| CITY B1 foot `B1,-2,46,180,18` | 654 / 312k | 657 / 291k |
| CITY 1F top `1F,-2,76,0,-25` | 782 / 326k | 769 / 328k |
| CITY 1F foot of 1F→2F `1F,-2,104,180,18` | 708 / 439k | 696 / 379k |
| CITY 2F top `2F,-2,130,0,-25` | 942 / 992k | 1024 / 1121k |
| Parks 2F foot `2F,-2,216,180,18` | 923 / 771k | 922 / 730k |
| Parks 2F foot close `2F,-2,219,180,30` | 952 / 739k | 828 / 654k |
| Parks 3F top of 3F→2F `3F,-2,238.5,0,-35` | 1169 / 1089k | 873 / 1128k |
| Parks 6F top `6F,-2,296,0,-25` | 718 / 888k | 721 / 872k |
| Midosuji B2 foot `B2,-115,-150,0,18` | 419 / 359k | 416 / 361k |
| Midosuji B1 top `B1,-115,-176,180,-25` | 654 / 842k | 647 / 818k |
| Sennichimae B1 top `B1,54,-193,-90,-25` | 526 / 475k | 519 / 479k |

Net: neutral (±1 % typical). CITY 2F top is the one view that went up (+82 calls): the CITY 2F
south ceiling (line lights, service kit) was hidden behind the viaduct deck before and is now
actually seen; the draw-call governor (budget 900 on high) trims distance there as before.

Load (`tools/loadprobe.mjs`): systems ready 23.6 s (baseline run of the same machine: 20.3 s;
machine load average 12-18 throughout, so within noise), first frame dominated by the SwiftShader
shader compile as before (programs 72 → 72/73, no new programs). Visibility init now includes the
clip (logged `[render] intrusion clip`). Console: clean except the sandbox's Google-Fonts cert
error (pre-existing).

Screenshots that tell the story:
- Parks 2F foot: `before/pose_2F_-2_216_180_18.png` (concrete plane, no well) →
  `after/…` (timber ceiling, lit lightwell, 3F visible).
- Parks 3F top of the down escalator: `before/pose_3F_-2_238.5_0_-35.png` (ballast "ground") →
  `after/…` (2F concourse with signs and people at the bottom).
- Parks 6F: `before/pose_6F_-2_296_0_-25.png` (black) → `after/…` (strata shaft walls).
- Street exit 15: `before/pose_1F_-57_-255_180_-35.png` (stairs sink into asphalt) → `after/…`.
- Riding CITY 1F→2F near the top and just after the swap: `pose_1F_-3_121_180_12`,
  `pose_2F_-3_125.5_180_5` (before: the 2F ceiling turned into concrete at the swap because 3F,
  hence the deck, starts drawing; after: no change at the swap).

## Open / unsure

1. The clip is a render-side workaround for transit geometry; the upstream fix (request above)
   is cleaner. Departing Nankai trains still run to z 245 inside the Parks block above 3F
   (not visible from the route as far as I checked, but a critic might find it from a garden).
2. The CITY / Nankai wells were already OK-ish; for those the change is subtle (lit coffer,
   glowing slab-edge line, landing light). The single biggest remaining "reads like a slot"
   factor is the opening size = escalator footprint (see the optional layout request).
3. Lighting changes need the bake to look right on a real GPU; I verified them only in
   SwiftShader screenshots. Cove/line emissives follow the existing material levels.
4. Not re-checked in this pass: every NAMBAWALK exit (only exit 15 imaged) and the stairs
   B1→1F at the CITY north plaza; the ground cut covers all 1F openings generically.
