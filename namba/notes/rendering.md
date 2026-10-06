# Rendering & lighting — running log

Owner files: `js/render/lighting.js`, `js/render/lighting/*`, `js/render/post.js`,
`js/render/visibility.js`, `js/core/engine.js`, `js/render/shaders/*`.

## Contract for every builder (READ THIS — it is how your stuff gets lit)

### 1. Declare fixtures, never add THREE lights
```js
ctx.lighting.addLight({ level, x, y, z, color, intensity, range, kind, dir })
```
* `x, y, z` are **absolute world coordinates** (y = `LEVELS[level].y + height`).
  A ceiling troffer on B1 with a 3.2 m ceiling: `y: -7 + 3.2`. Put the point at the
  emitting face (a hair below the ceiling, on the sign face, …).
* `kind`: `panel` (troffer / flat panel, Lambertian, faces down), `down` (recessed
  downlight, ~60° beam), `strip` (linear LED / cove, faces down — pass `len` in m if you
  know it), `sign` (back-lit sign, screen, illuminated shop front — **pass `dir`** = the
  direction it faces), `spot` (track spot; pass `dir`, e.g. `[0,-1,0.4]`), `lamp` (omni:
  pendant, lantern, street lamp, vending machine glow).
* `intensity`: **relative**, 1 = a standard fixture of that kind (panel ≈ 3000 lm, down
  ≈ 1500 lm, sign ≈ a 1 m² light box). 0.3 = dim, 2 = strong. Default 1.
* `color`: hex number, `'#rrggbb'`, `THREE.Color` or `[r,g,b]` (0..1). Fluorescent
  metro ≈ `0xf2f6ff`, warm mall ≈ `0xffe2c0`, Edison bulbs ≈ `0xffb070`.
* `range` (m): optional; defaults per kind (panel 11, down 9, strip 8, sign 7, spot 12,
  lamp 9). Larger = more expensive bake.
* `dir`: `[x,y,z]` emission direction (normalised for you). Defaults: down for
  panel/down/strip, horizontal (+z) for sign — please always pass it for signs/spots.
* Returns an id. Lights are **baked** (see below), so register them in `init()`.
  Anything registered after `afterBuild()` is only used for specular highlights.

**Do not add `THREE.PointLight/SpotLight/HemisphereLight/AmbientLight` to the scene.**
Diffuse light from three.js punctual lights is ignored by the light-field shader
(it would double-count). The sun `DirectionalLight` is owned by Lighting (see below).

### 2. Build your own emissive fixture geometry — bright
The light *field* comes from `addLight`, but the glowing panel/sign you see is your mesh.
Use `MeshBasicMaterial` (unlit) with HDR colour so bloom picks it up:
panels/downlight discs ≈ 6–12 × colour, shop light boxes / neon ≈ 3–8 ×, screens ≈ 1.5–3 ×.
(`color.setRGB(r,g,b).multiplyScalar(k)`; MeshBasic with `toneMapped` left on.)

### 3. All lit materials are lit automatically
Every `MeshStandardMaterial / MeshPhysicalMaterial / MeshLambertMaterial /
MeshPhongMaterial` in the scene is patched at compile time (prototype hook — your own
`onBeforeCompile` still runs, chained after ours) so it receives:
baked irradiance from the light field at its world position (floor/wall/ceiling aware,
with contact AO near walls & registered obstacles), sky + sun where outdoors, reflections
from the zone environment (scaled by local brightness) and specular highlights from the
nearest real fixtures. Crowds standing under a downlight get lit by it.
* Opt out (e.g. sky dome, UI-ish meshes): `material.userData.nbUnlit = true` (or use MeshBasic).
* Don't count on `scene.environment` for diffuse light — Lighting owns it.
* Floors: up-facing surfaces with low `roughness` get screen-space reflections (high
  quality) — set `roughness` honestly (polished 0.1–0.2, terrazzo 0.3, tile 0.4–0.5,
  paving 0.8+). Force/limit with `material.userData.nbReflect = 0..1`.

### 4. Culling: use chunk groups
Put level content in `THREE.Group`s with `userData.chunk = { level, x, z, r }` under
`engine.levelRoot(level)`. Visibility hides whole level roots (own level ±1, more in
atria / outdoors) and chunks beyond the draw distance. Never toggle level roots yourself.

### 5. Outdoors / sun (Outdoors lead)
Expose `ctx.exterior.sun = { direction: Vector3 (towards the sun), color, intensity }`
(intensity: 1 = clear midday) and `ctx.exterior.isOutdoor(level,x,z)` (optional). Lighting
creates/positions the single shadowed `DirectionalLight`, masks it to open-sky cells, sets
exposure. Outdoor geometry should `castShadow = true` (I also enable it on chunks that
contain outdoor cells). Sky dome: MeshBasic / ShaderMaterial, `depthWrite:false`, HDR
colours welcome (≈ 2–6 for a midday sky so it reads brighter than interiors).

## APIs I expose
* `ctx.lighting.addLight(o)`, `ctx.lighting.addProbe({level,x,y,z,radius,mood})` (mood hint).
* `ctx.lighting.sample(level, x, z)` → `{ r, g, b, sky }` irradiance at the floor (CPU,
  for sprites / NPC LOD tinting / audio reverb heuristics).
* `ctx.lighting.mood` → current mood string; event `'render:mood'` `{ mood, zone }`.
* `ctx.engine.quality` (tier params), `ctx.engine.qualityName`, `ctx.engine.setQuality(name)`,
  event `'render:quality'` `{ name }`.
* `ctx.post.exposure` (current linear exposure), `ctx.post.flash(amount)` (white glare pulse).

## Round 2 changes (Sonnet implementer)

### Visibility (js/render/visibility.js, js/render/visfan.js)
* `visfan.js` is a pure module (node-testable): 720-ray 2D visibility fan over the level walk grid; SOLID cells,
  `wall` and `partition` edges block (`?visleak` lets partitions leak). `fanSees(chunk)` = some ray reaches the chunk's near edge.
* Per frame: levels (own, plus neighbours only where a void/ramp opening is within reach; all of 1F+ in Parks/outdoors),
  chunk distance (small chunks r<14 stop at 0.6 x drawDist), camera-frustum sphere test, and LOS occlusion on the player's level
  (fan refreshed when the camera moves 0.45 m; chunks stay on 0.45 s after last seen). Chunks flagged `userData.nbOutdoor`
  (sun shadow casters) skip frustum/LOS.
* **Culling uses object `layers` (layer 0 enable/disable on every object in the chunk), NOT `.visible`**, because shops.js / props.js own
  `.visible` of their groups. Builders: do not use layer 0 toggling for other purposes; `.visible` is yours.
* `?novis` disables culling (A/B comparisons), `window.__namba.visibility.enabled` toggles at runtime, `visibility.stats` has per-reason counts.
* Engine owns the GPU timer (`engine.stats.gpuMs`, `engine.gpuTimerOK`); DRS uses it when present. `detectTier()` in engine.js picks the
  starting tier from GPU renderer string / cores / memory; the benchmark in visibility steps down.

### Post / image (js/render/post.js, shaders/post.glsl.js)
* Temporal reprojection + neighbourhood clamp for AO and SSR (history ping-pong at half res).  TAA-lite (Halton jitter, depth
  reprojection, clamp) + CAS sharpen on `high`/`ultra` (replaces FXAA); `?notaa` to disable. `high` drsMin 0.75, `ultra` 0.8.
* SSR: stable (mip-averaged) roughness for the reflectivity alpha, reflection colour clamped in display units (3.5), sharper cone blur.
* CA only at the lens edge (0.003), grain luminance-only fades out in highlights (0.012), bloom has a thresholded halo term (uHalo/uHaloT).
* Env maps: only the start mood is built at load; the others are built one per 0.5 s afterwards (was 10 PMREMs + 60 readbacks at load).
* `compileAsync` of the scene is started in Post.init (not in `?test` runs).

### Lighting
* Bake: per-space-style gain (shops 1.5x, corridors 0.8-0.9x) for the luminance hierarchy, less diffusion share (more pools), brighter
  neutral ceiling term. Shader desaturates the ceiling colour 55% towards neutral.
* Sun shadow: casters restricted to chunks within shadow window + 70 m; shadow map refreshed on 2 m moves or every 4 s (was 0.25 s).
* Fog halved outdoors (street 0.0021, parks 0.0017).
* inject.js guards: a builder `onBeforeCompile` that reads `objectNormal` before `beginnormal_vertex` is repaired (uses `normal`);
  `customProgramCacheKey` includes the material name when a builder hook exists (fixes `out_facade_*` collapsing into one program).

## Requests
* Outdoors (`js/world/outdoor/facade.js`): move `vFN = normalize(mat3(modelMatrix) * objectNormal)` after `#include <beginnormal_vertex>`
  (or use `normal`) and give each kind its own `customProgramCacheKey`. Rendering now repairs/keys this, but fix it at the source.
* Architecture: terrazzo `roughness` 0.28-0.35; set `material.userData.nbReflect` only on floors you want mirrored.
* Crowd: fade-in dither should be per-instance stable and never run in front of the player (CA no longer amplifies it).

## Log
* (iteration 0) contract published; implementation in progress.
