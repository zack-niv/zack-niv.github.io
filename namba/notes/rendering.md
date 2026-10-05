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

## Log
* (iteration 0) contract published; implementation in progress.
