# v4 — Shells (item 1: floating furniture, open back rooms, roofless restaurants)

Owner files touched: `js/world/arch/shells.js` (new), `js/world/architecture.js` (one step),
`js/world/arch/surfaces.js`, `js/world/arch/ceilings.js`, `js/world/outdoor/massing.js`.
Shots: `notes/v4-shots/shells/before/*.png` vs `notes/v4-shots/shells/after/*.png`
(name = `pose_<level>_<x>_<z>_<yawDeg>_<pitchDeg>[_<camera dy>]`).
No requests to layout / world / nav needed.

## How it was found

A probe (scratchpad `probe.mjs`, same idea as the v3 World agent's): one headless session,
teleport to a pose (optionally lifting the camera, e.g. +2.5 m to stand "on" an escalator mid-ride),
then cast a 32x18 grid of camera rays against every mesh that is actually rendered (layer 0,
visible chain) with all materials forced double-sided. A ray whose first opaque hit is the BACK face
of a one-sided surface is a **leak**: the renderer culls that face and shows whatever is behind it.
Coplanar opposite faces (a ceiling exactly at the next floor's level) are resolved like the GPU would
(front face wins), glass / alpha-tested foliage is looked through. The probe prints leak % and the
leaking surfaces (mesh, chunk group, hit point).

## Root cause (one, shared by all three screenshots)

Every walkable space is built as **one-sided skins seen from inside**: an up-facing floor over WALK
cells, a down-facing ceiling over the WALK cells of the space below, inward-facing walls on
`world.edges`, and shop interiors that do the same (`env/shopbuild.js finish()`). There is no slab,
no plenum closure and no outer face. That is invisible as long as you are inside a space, and the
set's back is exposed from every vantage point outside one: atrium voids, escalator wells (while
riding), the canyon and terraces, glass skywalks. Specific openings, with evidence (baseline leaks):

| screenshot | where (pose) | what the probe hit first | leak |
|---|---|---|---|
| (a) CITY B1/1F hall, books hanging from the ceiling | `1F,-6,73,0,25` top of the B1↔1F escalator | `arch:floor_*@arch:2F` back face at y 6.00 over the 1F atrium void (x 2..14, z 54..82): `ceilings.js` only ceiled WALK cells, so the court ceiling stopped at the void and you saw the 2F shop floor from underneath = the 2F bookshop's shelves "hanging". Plus the court's ceiling step at z 50 faced the wrong way (see below) | 6.1 % (32 % raw, half are coplanar ties) |
| (b) Parks 6F skywalk, open back room | `6F,12,328,-90,0` | the skywalk's walls are `glass`; behind it the restaurant's only wall face points into the restaurant → culled → through the glass the back-of-house reads as an open box (the probe needs the glass pass-through to see it; screenshot `before/pose_6F_12_328_-90_0.png`) | whole side walls |
| (c) Parks dining floors, roofless dollhouses | riding 6F→7F, `6F,-3,322,±90,0,+2.5` | `ceiling_dark / ceiling_wood @6F` seen from above at 33.4–33.6, `wall_stone_warm` from behind: `buildSlabEdges` clamped the well edge to 0.9 m where the upper (7F) neighbour cell is solid, so between the 6F ceilings (33.6) and 35.1 the plenum stood open beside the escalator: you looked sideways into it, onto the 6F restaurants from above and the 7F ones from below, sky beyond | 22 % / 32 % |
| same class, canyon | `2F,34,250,90,15` looking west from the canyon | `wall_panel_white @2F/3F/4F` at x 20 from behind: the Parks east shop row's back walls face inwards only → every floor of shops is an open dollhouse from the canyon (`before/pose_2F_34_250_90_15.png`) | 28 % |

## The fix (generic, `arch/shells.js` + 3 small corrections)

`buildShells(K)` runs once after the ceilings, merged into the same arch chunk GeoBatches, using
materials those chunks already draw (`arch_slab`, the space's wall material, `wall_strata` in the Parks)
— so essentially no new draw calls:

1. **Slab soffits.** A down-facing face 0.1 m under every indoor floor cell that has no ceiling below
   it (solid / outdoor / track below). Cells over an indoor space, its atrium void, or the top of an
   escalator (v3 well coffer) are skipped, so nothing hangs in front of an existing ceiling.
2. **Outer walls.** An outward-facing face 8 mm inside the boundary (behind glass and facades, never
   coplanar with the inward skins) on every indoor WALL edge (room or corridor, not glazed skywalks)
   and on every room partition whose other side is outdoors or glass. Height: soffit line → 0.12 m
   under the next level, so the stacked shells meet the soffits / roof slabs above. Material: the
   space's wall, `wall_strata` for the Parks (reads as the strata building from the canyon/terraces).
3. **Mouth lintels.** Where an indoor space opens onto an outdoor one (canyon-view openings, Parks
   2F hall), a lintel from the indoor ceiling up to the next slab; the plenum above the opening was open.

Corrections to existing builders (same bug class):
- `ceilings.js`: a space's ceiling now continues over its own atrium VOID cells (CITY 1F court,
  Nankai 2F void). Fixes (a).
- `surfaces.js buildSlabEdges`: well edges always reach down to the ceiling of the space below (the
  0.9 m clamp where the upper neighbour is solid is gone). Fixes (c).
- `surfaces.js` ceiling steps between adjacent spaces of different height now face the HIGH side
  (they can only be seen from there); they faced the low side, so from the CITY 1F court you looked
  through the step at z 50 into the plenum over the mall.
- `surfaces.js buildRoofSlabs` skips the Parks skywalks: `outdoor/structures.js` gives them a planted
  roof 1.6 m lower, which the arch slab was hiding from the terraces above.
- `outdoor/massing.js`: the Parks block's east face between its north face and the canyon walls
  (x 20.5, z 203.7..214.4, y 16.6..30) was missing; from the 3F garden you saw the mall roof from below.

Shops (`env/*`) needed no change: once the arch shell closes every room, the shop interiors (incl.
the stockrooms behind shortened deep rooms, `backOfHouse`) are only visible from inside the room.
Escalator wells (v3) and the viaduct clip are untouched (only the slab-edge depth changed; well
coffers / shaft walls / lit reveals are as before).

## Results

RESULTS_TABLE

## Open / unsure

1. The outer faces are plain (wall material / strata / `arch_slab`). From the skywalk glass the 6F
   restaurants now show a strata wall instead of an open box; a frosted or service-door treatment
   would read nicer.
2. Remaining probe "leaks" are not this bug class: escalator step internals at the Nankai 2F foot, the
   Nankai 3F roof slab at 17.85 inside the 9 m trussed concourse (faces up, invisible, harmless), the
   B1 court coffer (+0.8 m) letting you see the back of the 1F well's edge from just outside the well
   (you see into the well, which is open anyway), single-ray shop-front edges.
3. Bake: `ceilings.js` now also places the court's fixtures over the atrium void (declared to
   lighting). Visually checked in SwiftShader only.
4. `pkill -f` in my shell may have matched another agent's process named `*probe.mjs --root /home/user…`
   once at ~15:35 (scratchpad is shared). If someone's probe died then, that was me, sorry.
