# Environment dressing (shops, restaurants, props, ads) - running log

Owner files: `js/world/shops.js`, `js/world/props.js`, `js/world/directory.js`, `js/world/env/*`.
(Round 2 implementer. The round-1 lead never wrote this file; the state below was
reconstructed from the code.)

## Architecture of the area

```
js/world/directory.js   BUSINESSES for every LAYOUT.shopSlots entry (deterministic), FEATURED quest shops,
                        CATEGORIES (dwell/queue hints), isOpen(), searchBusinesses()
js/world/shops.js       Shops system (build): logic pass at init, lazy geometry replay per 32 m chunk,
                        shutters (instanced), spot/counter/queue/seat API, halls (depachika, Takashimaya 1F)
js/world/props.js       Props system (build): corridor furniture, wall art, screens, fountain
js/world/env/kit.js     materials (env_*), Frame/Painter, proto geometries, ChunkBatches, fonts
js/world/env/atlas.js   shelf-packed 2048^2 canvas atlases: env.sign (lit, MeshBasic) / env.print (standard)
js/world/env/draw.js    canvas painters: fascia, blade, noren, chochin, menus, POP, vending, ads, food, products
js/world/env/catalog.js per-category style/menus/samples/lighting
js/world/env/shopctx.js ShopCtx: one slot's local frame + occupancy grid (solid() keeps door reachable)
js/world/env/shopbuild.js  generic storefront + interior templates per category group
js/world/env/featured.js   hand-built quest shops + depachika + 1F cosmetics hall
```

Shared environment object: `envFor(ctx)` (exported from shops.js) creates `ctx._envDressing`
(atlases, tactile segments, light list). Props and shops both use it.

### Lazy build (how it works)
* `Shops.init()` runs `buildShop(S, stubRegions)` for all 311 slots with a **NullPainter**: only
  obstacle registration (`ctx.world.addBox`), spots, light declarations. ~0.4 s headless.
  Every query whose answer matters for geometry (`S.solid`, `S.outside`, `S.outsideClear`) is
  logged (`S.log`).
* Geometry is a **deterministic replay** of the same function with real painters; the logged answers
  are returned in order, so the replay draws exactly what the logic pass decided.
  Rule for template authors: never call `S.r()` conditionally on something that differs between
  passes, and always take `S.solid/outside` answers from the call (do not recompute).
* Built per 32 m chunk (front batch merged per chunk) and per shop (interior group, hidden beyond
  ~46 m / 30 m on low). Time-sliced 8 ms/frame within 80 m; synchronous within 60 m on teleport.
* `Props` do the same (logic pass at init, geometry per chunk, 6 ms/frame, 90 m).
* Gate: geometry waits for `env.fontsReady` (Noto Sans JP glyph subsets), 4 s timeout.

## Public API
* `ctx.shops.spots(slotId)` -> `[{x,z,level,yaw,kind}]`, kind: browse | counter | queue | seat | staff
* `ctx.shops.counter(slotId)` -> `{x,z,level,yaw,kind:'counter'}` where to order
* `ctx.shops.queuePoints(slotId)` -> `[{x,z,level,yaw}]` first = at the door, then along the frontage
* `ctx.shops.seats(slotId)` -> `[{x,z,level,yaw,sit:true}]` real chairs/stools (answers crowd.md request)
* `ctx.shops.hallSpots('taka_b1'|'taka_1f')`, `ctx.shops.isShuttered(slotId)`, `ctx.shops.record(slotId)`,
  `ctx.shops.buildNear(level,x,z,r)`, event `shop:shutter {slot, closed}`
* `ctx.props.seats` -> `[{level,x,z,yaw,sit:true,kind:'bench'}]` benches (answers crowd.md request)
* `ctx.props.items`, `ctx.props.list(kind)`, `ctx.props.wallItems` (posters/screens hung on walls:
  `{kind, level, x, z, nx, nz, a, y0, y1}`; wayfinding may avoid them), `ctx.props.fountain`

## Perf measurements (node harness, `tools`-free: shops+props fully built, 1400 random walk-cell views, frustum-culled by mesh)
| | before (round 1, eager) | now |
|---|---|---|
| env triangles in a view (avg / p95 / max) | n/a (2.08 M whole-scene reported) | 16 k / 56 k / 111 k |
| env draw calls in a view (avg / p95 / max) | n/a | 48 / 134 / 196 |
| atlas pages | 15 | 7 (sign 4 incl. props, print 3) |
| lights declared by env | 943 | ~800 (<= 2 per shop + 1 per vending bank/ATM/gacha/totem) |
| logic pass at init | | ~0.4 s shops + 0.2 s props (headless node) |

## Log
### Round 2
* Lazy build finished and split into three work kinds (see "Lazy build"): chunk fronts out to 190 m (cheap),
  per-shop interiors within 62 m (released beyond 125 m so memory stays bounded), halls within 110 m.
  Atlas regions are now LAZY objects: they only paint on first read, so far fronts / null painters cost no canvas work.
* Removed `Atlas.touch()` calls (it re-uploaded every 16 MB page after each build tick).
* `props.js` written from scratch (it was a stub): see Public API.
* Shop interiors: brand-tinted wainscot + rail + cove band, wall posters/banners (`dressWalls`).
* `ctx.shops.seats(slotId)`, `ctx.props.seats` for the crowd.
* Sign lights now carry `dir` (face the corridor).
