# Architecture & materials — running log

Owner files: `js/world/architecture.js`, `js/world/arch/*`, `js/render/materials.js`,
`js/render/textures/*`, `js/render/geobatch.js`, `js/world/layout.js`, `js/world/world.js`.

## Module map (js/world/arch/)
| file | what |
|---|---|
| `kit.js` | shared state: chunk batches (`K.B(level,x,z)`), `K.light`, `K.cell`, `K.isHole`, `K.ceilAt`, `K.reserve/clear`, `KELVIN` light colours, `K.columns` |
| `styles.js` | per-style table (floor/wall/ceiling/column/fascia/band) |
| `surfaces.js` | floors + borders + inlays, wall programme (skirt/dado/band), balustrades, slab edges, shop bulkheads, ceiling steps, **roof slabs** |
| `ceilings.js` | ceiling systems + fixtures (all declared to lighting); calls `serviceKit` per hall |
| `columns.js` | structural column grids (registered with `world.addBox`; Takashimaya 1F rooms now get them too) |
| `tactile.js` | yellow tactile paving routes from `LAYOUT.tactile` |
| `stations.js` | platform edges, subway back walls, Midosuji vault, Sennichimae ceiling, Nankai shed + concourse roof (LED slots) |
| `escalators.js` | escalators/stairs built on `rampProfile` (animated steps, scrolling handrails) |
| `details.js` | **new**: `serviceKit` (sprinklers, detectors, AC diffusers, speakers, CCTV domes, hanging 非常口 exit signs on rods), `wallKit` (wall programme: no blank wall run > ~8 m; hose cabinets, AED, staff doors, notice boards, coin lockers, extinguisher recesses, vents), `wearKit` (dark alpha wear decals) |
| `portals.js` | **new**: lintel + jamb returns at every opening between different zones (<= 16 m wide); department-store entrance frames |
| `render/textures/kitatlas.js` | **new**: canvas atlases for the detail kit (`arch_kit`, `arch_exit`) and wear decals (`arch_wear`) |

## APIs others use (`ctx.architecture`)
* `columns[]` `{ level, x, z, hx, hz, zone, space, type, id, y0, y1, signY }`
* `fascia[shopSlotId]` `{ level, ax, az, bx, bz, nx, nz, y0, y1, corridor }` sign band above each shop opening
* `adFrames[]`, `serviceBeams[]`, `platformColumns[]`, `exitCanopies[]`, `hangPoints[]`, `isClear(level,x,z,r)`, `stats`
* Rule kept from the outdoors lead: WALL edges whose walkable side is `outdoor` are not drawn by Architecture.
* New materials: `arch_kit` (lit atlas), `arch_exit` (emissive), `arch_wear` (alpha decals), `arch_slab`,
  `light_cove_green|orange|blue` (NAMBAWALK 1/2/3番街 coves).

## Round 2 (this pass) — changes
Critique `critique/architecture.md`, top-down:
1. **Holes** — new roof slab (`arch_slab`) over every indoor cell with nothing walkable above it (street carriageway, light wells)
   at (upper floor − 0.15 m) so the back of the set is never visible from outside. (Outdoors still paints road/paving on top.)
   World: `world._resolve` could divide by ~0 when a body stands exactly on a ramp side segment (teleport onto an escalator
   footprint threw the player to x = −4.5 M); fixed + a safety net in `world.move`.
2. **Layout**: Sennichimae free concourse (`s_free`) is no longer a 60 m open plaza: shop row `walk_sf*` (5 shops) along
   NAMBAWALK with three 8 m portals (`s_portal_a/b/c`, x 38–46, 56–64, 78–86); `s_free` is now 7 m deep. Tactile route at x=60 passes
   portal b. Nankai 2F gets two structural cores (ticket office `core_nk2_tickets`, lockers `core_nk2_service`). Spawns `nankai_gate`
   (now faces the gate line + shed, yaw π) and `nankai_2f` (yaw 0, faces the void) rotated.
3. **Ceilings**: plaster cooler/brighter, KELVIN mall/depachika less orange; metal ceiling PBR metalness reduced (they went black
   because metals take no baked diffuse); service kit everywhere; continuous edge coves in city_mall; depachika gets warm line
   lights; court centre lit by every disc; Taka beams on the column grid; Nankai concourse vault gets LED slots.
4. **Materials**: terrazzo rewritten (2–8 mm chips, light palette, ≤7 % charcoal, ≤2 % muted red, rough 0.3); marble veins soft,
   wide, low-contrast. New wear-decal layer (traffic lanes, scuffs, gum, heel marks, escalator run-offs).
5. **Wall programme**: `wallKit` (see above).
6. **Nankai**: hero spawn faces the gates; LED slots in the concourse vault.
7. **Portals**: `portals.js`.
8. **NAMBAWALK**: coloured coves per 番街 (green / orange / blue), corridor lights ~25 % dimmer so shopfronts glow.
9. Platform ad boxes are mid-grey backlit (env overlays posters).

## Open issues / not done
* Takashimaya street facade (glazed shopfront with auto doors behind the louvres) — Outdoors/Environment own that wall.
* Sennichimae stair housing at the platform end not touched.
* NAMBAWALK corridor ceiling is still 3.2 m (lowering to 2.9 would hide Environment's fascia band; coordinate if wanted).
* 2F shelf interior seen through the 1F court ceiling (critic #1) is Environment-side geometry; not reproduced here.
* Hall sizes (Takashimaya, depachika) are still large: columns/beams help; counters are Environment's.
