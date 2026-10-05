# Architecture & materials — running log

Owner files: `js/world/architecture.js`, `js/world/arch/*`, `js/render/materials.js`,
`js/render/textures/*`, `js/render/geobatch.js`, `js/world/layout.js`, `js/world/world.js`.

(Work in progress — APIs below are the plan; will be confirmed as they land.)

## Planned APIs for other leads
* `ctx.architecture.columns` → `[{ level, x, z, hx, hz, round, zone, id, faces }]` every structural
  column (all registered with `world.addBox`). Wayfinding may wrap column signs on them.
* `ctx.architecture.fascia` → `{ [shopSlotId]: { level, ax, az, bx, bz, nx, nz, y0, y1 } }`:
  the clear sign band above each shop opening (door line a→b, normal towards the corridor,
  absolute heights y0..y1). Mount signs at +0.03 m along the normal.
* `ctx.architecture.isClear(level, x, z, r)` → false if the point is within r of a column/
  escalator/stair footprint.
* Rule kept from the outdoors lead: WALL edges whose walkable side is `outdoor` are not drawn
  by Architecture.
