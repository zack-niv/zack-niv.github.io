# v2 — Shops agent (items 4, 6, 7-counters)

Owner files: `js/world/env/*`, `js/world/shops.js`, `js/world/props.js`, `js/world/signage.js`, `js/render/textures/*`.

## CONTRACT (published first): `ctx.counters`

Built in `Shops.init()` (logic pass, build phase) — i.e. before the crowd initialises. It is a plain array that is
filled once and never replaced (hold the reference if you like); entries may later be nudged or dropped in
`Shops._validateSpots()` (first frames after nav exists) but only to keep `order` on a nav-reachable cell.

```js
ctx.counters = [{
  slotId,                   // directory slot, e.g. 'city_2nw16'
  name,                     // business name (English)
  kind,                     // 'cafe' | 'tempura' | 'food' | 'shop'
  level,                    // level id, '2F'
  staff: { x, y, z, yaw },  // behind the counter. y = floor height of the level. yaw = player convention (0 = looking -Z,
                            // direction = (-sin yaw, -cos yaw)), already facing the order spot
  order: { x, y, z },       // WALK cell in front of the counter, reachable from the shop door; y = floor
  role,                     // 'barista' | 'chef' | 'clerk'
}]
```

* `kind`: `cafe` = cafe / kissaten / coffee stand / bakery; `tempura` = tempura + tendon places; `food` = every other
  restaurant, takoyaki, sweets; `shop` = conbini, bookstore, drugstore, phone, ticket, exchange, souvenir, florist
  (clerk at the register). The Humans agent can ignore `shop` if the staff budget is tight.
* Guaranteed entries: Pine Tree Coffee (`city_2nw16`), Sunny Side Café (`city_2nw06`), Wakakusa Coffee Stand
  (`link_e03`), Tempura Daikichi (`parks_6Fdw03`, chef at the pass-through behind the hinoki counter, order spot
  in front of the gap).
* Closed shops (`cat === 'closed'`) have no entry. A shop that is closed by opening hours keeps its entry
  (`ctx.shops.isShuttered(slotId)` tells; the staff should not be shown then).
* Order spots are inside the shop (the player walks in), except the take-away counters (sweets, takoyaki) which are
  served over a counter that faces the corridor: their `order` is the corridor cell in front of the counter.
* Crowd: the `kind:'staff'` spots of `ctx.shops.spots(slotId)` that carry `svc:true` are exactly the `staff` points of
  `ctx.counters` (so the crowd should not also spawn a figure there if Humans renders the counter staff itself). The
  matching `kind:'counter'` spot (`svc:true`) is the order point. Daikichi's staff spots keep their `outfit` hint.
* `ctx.shops.counter(slotId)` returns the same order point as before (Daikichi's unchanged), so Aya's queue scene is
  not affected.

## Item 4 — posters / ads (all paths)

Root causes found: wall posters / column ads were painted at 200x300 px on a lit sign atlas (glow 2.0) and hung at
1.0-1.5 x 1.35-1.5 m (squashed, ~130 px/m, text 9 px high: the "Koyasan Nankai" smear), pier posters were 128x192 px,
menu boards 144x200, mip bleeding between atlas neighbours (4 px gutter).

* `env/posters.js` (new): twelve designed posters (travel/Koyasan, drink, movie, expo, cosmetics, halloween, autumn,
  phone, beer, concert, ramen fair, museum/Hokusai) in a resolution independent design space, each with a PORTRAIT 2:3
  and a LANDSCAPE 16:9 composition. `draw.js: drawAd` now delegates to it.
* `env/atlas.js`: new `pad` / `aniso` options; edge bleed up to pad/2 so mips never leak a neighbour. A dedicated
  `env.poster` atlas (`env_poster`, pad 8, anisotropy 16): portrait 384x576 px, landscape 640x360 px per poster
  (>= 400 px/m on a 0.9 m poster, text >= 14 px high at 1.5 m). 2 pages.
* Every poster quad keeps the art aspect (never stretched): shop interiors (`dressWalls`, piers, back-wall banners),
  `props.js` wall posters (width follows room height, 2:3), column ads (<= 0.8 x 1.2 m), platform ads (16:9 fitted
  inside the 3.0 x 1.6 frame on plain backing), info screens (768x432, ticker rescaled).
* Menu boards: chalk 144x200 -> 252x350, photo menu 176x240 -> 264x360, tanzaku x1.4, shop fascias 72 -> 96 px high.
* `render/textures/kitatlas.js`: arch detail kit (hose cabinet, AED, exit sign, notice board, lockers, vents) is
  designed at 128/cell but rasterised x2 (1024 px canvas).
* `env/kit.js`: wood + tile floor textures rasterised x2 with anisotropy 8.

## Item 6 — interiors

New files: `env/furnish.js` (oriented furniture kit: chairs that FACE their table, stools, sofa, armchair, round/square
tables, pendants, plants, cups...), `env/seating.js` (cell based table scatter: tables on 1 m cells so every seat spot
is walkable, but shape/orientation/offset/chair wobble vary), `env/cafe.js`, `env/dining.js`.

Fixed along the way: the old `chair` calls had the backrest on the table side in several templates (cafeTable, rtable,
kissa) — they now face the table.

* **Cafés** (`cafe.js`, all `cafe` cat; wide ones get a glazed front + door): service counter with pastry case,
  register, espresso machine + grinder on a back bar, shelves of cups/jars, three framed menu boards, pendants over
  the counter; seeded mix of window bar (stools facing the glass), banquette run with 4-tops, free 2/4-tops (random
  cells, round or square, chair wobble), communal table (wide shops, 55 %), sofa corner (sofa + coffee table +
  armchair + cushions), plants, hanging plants, slat panel or framed posters, a shelf by the kitchen door. Deep
  slots (25 m) are cut to 12-14 m with a finished back wall + staff door (never shallower than the directory centre
  cell + 2). Narrow Pine Tree Coffee (4 x 25): counter + stool ledge + back loveseat.
* **Restaurants** (`dining.js`, rtable group): kitchen pass with counter stools and chefs, booths along one wall with
  slat partitions, scattered 2/4-tops, grills / teppan / lanterns per cuisine, tanzaku menus, sake shelf, kitchen noren.
* Counter restaurants (`rcounter`) and sushi (now the same template with a lit neta case): tables are scattered, not
  gridded; the first stool slot is the ordering spot.
* Kissaten, coffee stands (generic ones get espresso machine / grinder / menu boards), bakery, sweets, takoyaki, books,
  Tempura Daikichi publish explicit service points.
* The sushi template used to draw nothing at all in deep slots (its counter spanned the room and was refused because it
  cut off the directory centre cell); fixed.

## Testing notes

* `node` harness (no browser): world + logic pass + replay for all 316 slots in ~6 s (`/tmp/.../scratchpad/harness.mjs`,
  not committed). The replay must consume exactly as many logged `solid/outside` answers as the logic pass — 0
  mismatches. Logic pass for all shops stays ~0.5 s.
* Never read `S.free()/S.areaFree()` inside a template: they read the final occupancy and differ between passes.

## Status / open items

(see the end of this file, updated at the end of the round)
