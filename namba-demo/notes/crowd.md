# Crowds & NPCs — running log

Owner files: `js/npc/*`, `js/world/nav.js` (performance only, API unchanged).

## Modules
| file | what |
|---|---|
| `crowd.js` | the system (`ctx.crowd`), events, public API |
| `sim.js` | movement core (no THREE, runs in Node): flow-field following, social-force + anticipatory avoidance on a spatial hash, escalator lanes, gate lanes, groups, LOD tiers |
| `behave.js` | trip legs: go / to / wait / queue / dine / browse / board / exit / stroll / hall / meet / join / post / patrol |
| `trips.js` | Director: population vs time of day, archetypes and groups, trip planning, train surges, initial fill, keeping density around the player |
| `places.js` | portals, platforms and door markings, gates, ramps, businesses (queue slots, seats), gardens, halls, staff posts. All derived from LAYOUT, the directory and transit |
| `fields.js` / `fieldworker.js` | flow-field store (Web Worker, LRU, Uint16 decimetres), clearance and paid-area penalties, gate-fence edge cuts, grid collision, local BFS paths |
| `looks.js` | fashion palette, archetype looks, accessory bit flags |
| `humanGeo.js` / `humanMat.js` / `render.js` | procedural human (3 LODs), GPU vertex animation injected into MeshStandardMaterial, instancing, blob shadows |
| `bench.mjs` | `node --expose-gc js/npc/bench.mjs [agents] [frames] [HH:MM] [spawn]`: headless benchmark |

## Public API (`ctx.crowd`; guard with `?.`, absent members mean `?nocrowd`)
- `count`: live agents.
- `densityNear(level, x, z, r = 6)` → people per m² (for crowd murmur / reverb).
- `countNear(level, x, z, r = 6)` → number of people.
- `agentsNear(level, x, z, r = 6)` → `[{ id, x, y, z, level, yaw, speed, vx, vz, kind, pose, trip, height, female, onRamp, group }]` (copies).
  `kind` is one of `commuter`, `student`, `tourist`, `shopper`, `elderly`, `child`, `staff_station`, `staff_shop`, `cleaner` or `security`. `pose` is one of `walk`, `stand`, `phone`, `sit`, `ride`, `wave`, `photo`, `lookup`, `bow`, `cart`, `browse`, `eat` or `talk`.
- `queueLength(slotId)` → people queueing outside a business (shop slot id). `seated(slotId)` → people inside dining.
- `collide(body, radius = 0.3)` → pushes `{x,z,level}` out of nearby people, returns true if it pushed. **Movement lead:** call it after `world.move` if you want the player to bump into people (NPCs already avoid and sidestep the player).
- `debugText()` → shown in `?debug`.

## Events
Emitted (**sound / HUD**: please voice / caption these):
- `'crowd:excuse'` `{ level, x, y, z, ja: 'すみません', en: 'Excuse me', kind, female }`: someone blocked by the player says it. Cooldown is 12 s per person and 2.2 s globally.
- `'crowd:callout'` `{ level, x, y, z, ja, en, kind: 'shop' }`: shop staff call いらっしゃいませ when the player is within 9 m. Cooldown is 6 s.
- `'crowd:gate'` `{ gate, lane, dir, level, x, z, near }`: an NPC passed a gate lane. When near the player I also call `ctx.transit.gatePass(gate, lane, dir)`, which animates the flaps and emits `gate:pass`.

Listened: `train:arrive` (uses `doors[]` with `x,z,nx,nz`; spawns the alighting surge, boarders board after alighters, about 3.5 s), `train:depart`, `player:teleport` (refills around the player).

## Behaviour summary
- Every agent has a purpose. Trips are transfers (Nankai ↔ Midosuji is the biggest flow), train → exit, exit → train, lunch (queue outside, then sit and eat inside; queues use the directory's queue/dwell hints and grow toward 12:30), coffee, 1 to 3 shop visits, Parks strolls with photos at the rails, depachika browsing, and meeting a friend at a landmark (wait, wave, leave together). Through-walkers go from portal to portal.
- Archetypes:
  - commuters: dark suits, white shirts, briefcases; fast, and walk on the escalator's left
  - students: uniforms, groups sharing the same uniform
  - tourists: backpacks; rolling suitcases on the Nankai/airport line; they hesitate, look up, check phones, sometimes double back, and walk in pairs
  - shoppers: bags increase through the day
  - elderly: slow and stooped
  - families: a child holding hands or running ahead
  - staff: station staff at the gate ends, shop staff at entrances who bow and call out, cleaners with carts, security
- Escalators: standers ride the RIGHT half, hurried walkers use the LEFT. Each lane admits one person per 0.95–1.4 s (standing) or 0.6–0.9 s (walking), so surges queue at the mouths. Stairs: keep right, slower.
- Gates: people pick a lane by proximity and load, respect transit's `in` / `out` / `both` lane policy, take one person per lane at a time and slow to tap. Fences are cut out of the crowd's flow fields, so nobody walks through them.
- Platforms: people wait in two lines at transit's painted door markings (`trackInfo().stopDoors`), facing the track, and board on `train:arrive`.
- Trips that aren't catching a train get a penalty for entering paid areas, so shoppers don't cut through the ticket barriers.
- Population: `quality.crowdMax × (0.42 + 0.58·rush)`, with a night falloff. That gives about 1330 at 12:10 on high and 1800 at the 08:30 peak. If no `train:arrive` arrives for 300 s, a fallback timetable runs.
- LOD:
  - sim tier 0 (same floor, under 45 m): every frame
  - tier 1 (visible floors, inside the draw distance): every 2nd frame, extrapolated in the renderer
  - tier 2 (elsewhere): every 4th frame, hopping node to node along the field, so trips still finish on time
  - Density follows the player: far tier-2 walkers who are mid-trip are moved, with the same destination, onto public nodes 12–95 m from the player and out of view, then faded in. About 32% of the population stays within 100 m. A teleport triggers a burst.

## Rendering
- 3 instanced LOD meshes (about 1.4k / 400 / 90 tris, each one draw call) plus 1 instanced blob-shadow draw, so 4 draw calls for the whole crowd.
- Vertex animation runs in the shader: walk cycle (legs, knees, arm swing, hip bob and sway, torso twist), idle weight shift, sitting, phone, photo, wave, bow, escalator rail hand, cart push and suitcase pull.
- Hair, garments and accessories are selected per instance with bit flags. Accessories: briefcase, backpack, shoulder bag, tote, shopping bags, rolling suitcase with wheels, phone, cup, umbrella, cleaning cart, cap, apron, tie, face mask, glasses, trench coat, skirts and tights.
- Only agents on visible level roots (`engine.levels[lv].visible`), inside `quality.drawDist` and inside the frustum are drawn. Fade-in and fade-out use a dithered discard.

## Requests to other areas
- **Sound:** `densityNear` for the murmur. Please voice `crowd:excuse` and `crowd:callout` as positional barks.
- **Transit:** I use `trackInfo`, `gateLanes` and `gatePass`, plus `train:arrive.doors`. An optional `load` (0..1) field on `train:arrive` would scale the surge.
- **Environment / shops:** if you expose `ctx.shops.seats(slotId)` → `[{x, z, yaw, sit}]`, diners will use real chairs. Today they use sampled interior cells.
- **Parks:** a bench list (`ctx.parks.benches` → `[{level, x, z, yaw}]`) would let strollers sit.

## Log
- v1: full system. A Dijkstra fix in my worker and in `nav.field` (perf only): float32 rounding let equal-cost duplicates re-expand, which made fields with penalties 30–100× slower. Settled flags fixed it.
