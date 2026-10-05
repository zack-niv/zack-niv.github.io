# NAMBA — developer notes (read fully before touching code)

## The vision (from the director — this is the bar)

A first-person indoor wandering game set in the Namba complex, Osaka: Namba
Station, the vast underground passages and shopping streets, Namba CITY and
Namba Parks. The player is a tourist doing three ordinary things: **find a great
coffee, find tempura for lunch, find the right subway.** The game *is* the
journey of navigating this enormous, confusing, fascinating place.

* It must feel like a **real place**, not a maze or generic level: an
  underground city of multiple levels, subway and railway areas, endless
  corridors, shops, restaurants, ticket gates, escalators, exits, Japanese
  signage, competing directions, landmarks, unexpected connections.
* Contrast: the **spectacular openness of Namba Parks** — greenery, sunlight,
  terraces, the canyon, architecture. Moving between these worlds must create
  genuine moments of wonder.
* **Crowds are essential**, and they move with *purpose*: commuters stream to
  and from stations, rush for trains, buy tickets, pass gates, ride escalators
  (Osaka stands on the RIGHT, walks on the left); others stop for coffee,
  browse, meet friends, check signs, queue outside popular restaurants, sit and
  eat. Tourists hesitate; locals move confidently. Flows form around stations,
  entrances, escalators, stores. Sometimes the crowd guides you, sometimes it
  blocks a sign or pulls you the wrong way. Never random wanderers.
* Getting lost should be **fun**: signs, landmarks, discovery, doubling back,
  emerging somewhere unexpected, slowly building a mental model. **No giant
  arrows, no artificial maze tricks, no game-y navigation aids.**
* A **phone map** that is useful but captures indoor-navigation ambiguity: the
  destination looks close, yet you are on the wrong floor, facing the wrong
  way, or separated by a whole different part of the complex.
* Environmental fidelity is our "combat fidelity": architecture, crowds,
  lighting, signage, shops, materials, escalators, reflections, ambient sound,
  train announcements, movement and tiny details all sell the illusion.
* Three.js, pushed as far as possible **while keeping excellent performance**.
* The feeling to recreate: *"I'm lost. This place is enormous. Where the hell is
  that tempura place? …and wow, this is incredible."*

Judge your work against modern AAA first-person exploration games (think the
environmental density of *The Last of Us Part II*, *Cyberpunk 2077* crowds and
signage, *Mirror's Edge* clarity of light, *Shenmue* everyday life) and real
photos of Namba. "Good for Three.js" is not the bar.

## Running

Static site, no build step. `python3 -m http.server` in `namba/` and open
`index.html`. URL params (see `js/core/params.js`): `?skip` (skip title),
`?spawn=walk`, `?pos=x,z,LEVEL&yaw=deg&pitch=deg`, `?time=12:30`,
`?quality=low|medium|high|ultra`, `?nocrowd`, `?noaudio`, `?nopost`, `?debug`,
`?freeze`.

### Headless testing (you have no GPU and no display)

* `node tools/shot.mjs --views start,walk,canyon --out /tmp/<you>/shots [--frames 20] [--time 12:30] [--extra "&nocrowd"] [--w 1280 --h 720]`
  Views are spawn names (`LAYOUT.spawns`) or explicit `pose:LEVEL,x,z,yawDeg,pitchDeg`
  (yaw 0 = looking north/-Z, 90 = west/-X, 180 = south, -90 = east).
  Prints draw calls/triangles/system errors/console errors and writes PNGs —
  **look at your screenshots** with the Read tool. SwiftShader is slow (~0.2–1
  s/frame); ms timings are only relative, draw calls and triangles are exact.
  Several agents share 4 CPU cores: keep `--frames` small and views few.
* `node tools/check-layout.mjs /tmp/<you>/plans` — rebuilds the world+nav in
  Node, verifies connectivity (every spawn & shop reachable), writes per-level
  PNG plans.
* `node tools/loadprobe.mjs [--extra "&nocrowd"]` — prints which system the
  loader is on over time + HTTP errors. Use it to keep your init fast. Budget:
  the WHOLE load ≤ ~60 s in this headless probe (≈ ≤ 6–10 s on a laptop); no
  single system > ~5 s headless. Generate lazily, cache, spread over frames.
* In page: `window.__namba` is the shared ctx (teleport, systems, stats).

## Architecture (the contract)

```
index.html → js/main.js (bootstrap, system loader, main loop)
js/core/      engine (renderer, scene roots, quality), events, input, clock, params, rng
js/world/     layout.js   ← MASTER PLAN: levels, spaces, ramps, voids, gates, tracks, shop slots, spawns, exits, POIs
              world.js    ← rasterised 1 m walk grid per level, edges (walls/rails/track edges), collision, ramp physics
              nav.js      ← nav graph + cached multi-level flow fields (crowds, phone distances, signage)
              directory.js← every business in every shop slot (names, categories, hours, ratings, quest targets)
              architecture.js, props.js, shops.js, exterior.js, parks.js, transit.js, signage.js
js/render/    materials.js (shared material library), geobatch.js (merged geometry), lighting.js, post.js, visibility.js
js/player/    player.js
js/npc/       crowd.js (+ your own helper modules)
js/audio/     audio.js (+ helpers)
js/ui/        phone.js, hud.js (+ helpers, css)
js/game/      game.js (+ helpers)
```

**Systems**: classes with `constructor(ctx)`, `async init()`, `update(dt)`,
optional `lateUpdate(dt)`, `onStart()`. Registered in `SYSTEMS` in
`js/main.js` (order matters). *build* systems run before the nav graph is
built (they may register obstacles with `ctx.world.addBox(level, cx, cz, hx, hz, rotY)`);
*live* systems after. A system that throws is isolated (game keeps running)
and logged to `ctx.errors` — still, never ship one that throws.

**Coordinates**: metres. +X east, +Z south, +Y up. North = -Z. Levels and
their floor heights in `LEVELS` (B2 -14, B1 -7, 1F 0, 2F 6, 3F 12, 4F 18 …
8F 42). Player yaw 0 looks north.

**Bodies & physics**: `{x, z, y, level, ramp}`; `world.move(body, dx, dz, radius)`
handles walls, partitions, rails, obstacles, ramps (stairs/escalators,
`rampProfile`), level transitions. `world.conveyor(body)` gives escalator
belt velocity (0.5 m/s). Same for player and NPCs.

**Edges** (`world.edges[level]`): merged unit segments with `kind` ∈
`wall | partition | rail | rampSide | track`, normal `(nx,nz)` towards the
walkable side, `spaceA/spaceB` indices. Architecture builds visuals from these.

**Scene roots**: put level content under `ctx.engine.levelRoot(level)` (ideally
in chunk groups with `userData.chunk = {level, x, z, r}`); global content
(sky, city, terrace exteriors visible from afar) under `ctx.engine.globalRoot`.
Visibility culling toggles these.

**Events** (`ctx.events`, see `js/core/events.js` for the catalogue): emit
and subscribe rather than reaching into other systems' internals. Add new
events to the catalogue comment when you introduce them.

**Lights**: builders declare light fixtures with
`ctx.lighting.addLight({level, x, y, z, color, intensity, range, kind})`
(kind: panel | down | strip | sign | spot | lamp) during `init()`, and build
the visible emissive fixture geometry themselves. The rendering area decides
how those lights are realised (baked vertex lighting, nearest-N dynamic
lights, probes…). Systems may implement `afterBuild()` (runs after all build
systems) for bake passes.

**Materials**: `ctx.materials.get(name)`; define new ones with
`ctx.materials.define(name, factory)` *inside your own module* (prefix the name
with your area, e.g. `shop_counter_wood`) so you don't edit materials.js.

**Batching**: use `GeoBatch` (js/render/geobatch.js) for static geometry and
`InstancedMesh` for repeated objects. Never add thousands of individual
meshes.

**Determinism**: use `rng(seed)` / `hash(str)` from `js/core/rng.js`, never
`Math.random()` for world content (the place must be identical every visit).

**Japanese text**: canvas-rendered textures with `'Noto Sans JP'` (loaded from
Google Fonts in index.html — `await document.fonts.load('700 32px "Noto Sans JP"')`
before drawing, fall back gracefully). Real station signage conventions:
yellow background for exits (出口), black/dark for directions, line colours
(Midosuji red #E5171F "M", Sennichimae pink #E44D93 "S", Yotsubashi blue
#0078BA "Y", Nankai orange #F08300), bilingual JA/EN (+ sometimes 中文/한국어),
pictograms, numbered exits.

## Performance budgets (real mid-range laptop GPU, 1080p, quality=high)

* 60 fps target; worst-case view ≤ ~1500 draw calls, ≤ 2.5 M triangles.
* Startup (load → playable) ≤ 10 s on a laptop. Generate textures lazily /
  cache canvases; keep total canvas texture memory modest (atlases!).
* Crowd: ≥ 1500 simulated agents in the complex at peak, LOD'd; render
  budget ~300 draw calls max for people (instancing).
* `quality=low` must run on a phone/iGPU.

## File ownership (parallel development — this matters)

Many agents work **simultaneously in the same working tree**. Edit only the
files you own. If you need a change in a file you don't own, prefer a
non-invasive extension point in your own module; if truly necessary make a
minimal, additive edit and describe it in your notes file. **Never revert or
reformat other people's code.** Do **not** run `git commit/push/checkout/stash/reset`
— the lead integrates and commits.

| Area | Owner files |
|---|---|
| Architecture & materials | `js/world/architecture.js`, `js/render/materials.js`, `js/render/geobatch.js`, `js/world/layout.js` (structural changes; others ask), `js/world/world.js` |
| Environment dressing | `js/world/props.js`, `js/world/shops.js`, `js/world/directory.js`, `js/world/env/*` |
| Outdoors & Namba Parks | `js/world/exterior.js`, `js/world/parks.js`, `js/world/outdoor/*` |
| Transit | `js/world/transit.js`, `js/world/transit/*` |
| Crowds & NPCs | `js/npc/*`, `js/world/nav.js` (performance work) |
| Movement | `js/player/*`, `js/core/input.js` |
| Rendering & lighting | `js/render/lighting.js`, `js/render/post.js`, `js/render/visibility.js`, `js/core/engine.js`, `js/render/shaders/*` |
| Sound | `js/audio/*` |
| Wayfinding (signage + phone) | `js/world/signage.js`, `js/ui/phone.js`, `js/ui/phone/*`, `css/phone.css` |
| Game & interactions | `js/game/*`, `js/ui/hud.js`, `js/ui/title.js`, `css/game.css`, `index.html` (UI markup only) |
| Lead (integration) | `js/main.js`, `DEVNOTES.md`, `tools/*` |

Each area keeps a short running log at `namba/notes/<area>.md`: what you
built, APIs you expose to others, requests for other areas, known issues.
Read the other areas' notes when you integrate with them.
