# Demo world fixes (route world fixes agent)

Scope: `js/world/*` (except layout/world/nav/directory) and `js/npc/*`. Harness notes: headless frames are
2-60 s each on the shared box, which creates artefacts that do not exist at 60 fps (see "Harness artefacts").

## Done

1. **Skyline / facade shader (P0)** - already fixed in this tree before I started: `outdoor/facade.js` injects
   `vFN` after `#include <beginnormal_vertex>` (objectNormal exists) and has `customProgramCacheKey` ('out_facade_v2');
   one shared program for all facade kinds via the per-vertex `aKind`. Verified at runtime:
   `renderer.info.programs` lists two `out_facade` programs, both with `diagnostics` ok, zero shader errors in the console,
   and the city skyline renders behind the canyon (canyon screenshots).
2. **Canyon cost.** The canyon strata/vegetation were not the problem; the draw calls were the architecture chunk x material
   meshes of every Parks floor (700+ meshes visible from the canyon floor).
   `arch/kit.js`: everything on 2F+ with z >= 212 (the Parks wing) is now ONE chunk per level (`PARKS_MERGE`), emitted in
   `architecture.js` as chunk `{x:49,z:300,r:132}`. Visual output identical.
   `outdoor/garden.js`: soil marching-squares now merges fully-inside cells into one quad per run (soil 72k -> small).
   `npc/render.js`: LOD distances 18/60 m -> 12/44 m (LOD0 is 5.9k tris per person).
   Numbers at `pose:2F,33,222,180,10` (canyon mouth, the heaviest view): draw calls 1394 -> 643, triangles 1263k -> 788k
   (the same numbers incl. the shadow pass; before: 1415 visible meshes, after: 579).
3. **Crowd speckle (P0).** The "dither" was the 2x2-pixel Bayer discard used for fade-in/out (after a teleport, on exits and
   boarding, a whole burst of people fades at once, and at DRS < 1 the pattern is blocky and TAA/post turns it into noise).
   Fix: agents with fade < 1 are drawn through three extra alpha-blended instanced meshes (`fadeLods`, material
   `crowd_human_fade`, define `CROWD_BLEND`) = a real cross-fade with zero speckle; the opaque meshes never discard.
   The Bayer discard remains only as a fallback if the (small) blended set is full. `places.js`: nothing else changed.
   Clothing patterns (rib/pinstripe/gingham) were already faded by pixel footprint; I did not find shadow acne.
   Close range: hair shader now has soft broad strand streaks visible to ~3 m (was < 0.5 m), hair shells 18x12 (was 13x9).
4. **Holes / z-fighting on the route.** Parks 2F hall (the first thing after the bridge) showed a comb-pattern z-fight on the
   end wall of shop `parks_2Fe01`: `shopbuild.shelfRun` drew the full box of the wall shelf back (incl. the face coplanar with
   the architecture wall). The face against the wall is now omitted for the back and the top box. Looked at the Nankai 2F void,
   the City 1F void, Nankai 3F/2F, Namba CITY 2F corridor, bridge, Parks hall, canyon: no see-through floors on the route.
   Not touched (detours, listed below): the Nankai 2F void still shows the 1F ceiling light grid from above.
5. **Shop interiors.** Most "empty white" interiors in headless shots were an artefact: a shop's interior group is built
   synchronously on teleport but stayed `visible=false` until the 0.2 s distance pass ran (a handful of frames; minutes in the
   slow harness). `shops._buildInterior` now sets visibility immediately. With that the generic interiors (rails, tables,
   gondolas, mannequins, shelves with products) are there. I did not add a new generic filler pass (time).
6. **Tempura Daikichi (`parks_6Fdw03`, 6F west side, door on x=-6, z~310).**
   * New hand-built interior `INTERIOR['key:tempura_great']` in `env/shopbuild.js`: dark wood floor and panelled walls, two
     hinoki counter runs with a pass-through, low stools (seat spots), plates of tempura on the counter, two frying stations
     (steel bench, oil pot, copper pot, dark hood) with chef spots (white apron + cap), back bar with sake and ceramics,
     kitchen noren, tanzaku menus, pendant lamps, hanging paper lanterns by the window, calligraphy panel, tables by the window,
     warm lights. No ramen/beer posters (`dressWalls` skipped for this shop).
   * Front: the koshi lattice is more open (13 cm pitch) so the counter and warm light are visible from the corridor; noren,
     lantern, wooden sign, menu stands, folding chairs and the END OF LINE sign were already there.
   * `ShopCtx.spot(kind,a,d,fa,fd,extra)` now accepts extra fields (staff `outfit`).
   * Crowd: restaurants/cafes now seat diners on the REAL seats (`ctx.shops.seats`) facing the right way instead of random
     floor cells (`places.spots`, `behave._sitDown`). At 11:20 the director already builds a queue of ~10 outside Daikichi
     (pop x2.2) in the initial fill.

## Harness artefacts (do not chase)
* After `teleport`, crowd bursts fade in over ~0.6 s of SIM time; at 5-60 s per frame that is the whole screenshot. People
  look ghosted in shots taken 3 frames after a teleport. They are now smooth ghosts, not speckle.
* The sampler error `GL_INVALID_OPERATION ... Mismatch between texture format and sampler type` on SwiftShader comes from the
  render/lighting area (a shadow/depth sampler), not from the world. Worth a look by the render owner.
* `ERR_CERT_AUTHORITY_INVALID` console error is the Google Fonts stylesheet blocked in the sandbox.

## Requests / left for the lead
* render/lighting: `lighting._markShadowCasters` makes every mesh of every chunk that touches an outdoor cell a sun-shadow
  caster, including tiny light fixtures, inlays and wear decals (335 shadow draw calls in the canyon). A one-line filter
  (skip meshes whose name starts with `arch:light`, `arch:ao_strip`, `arch:arch_wear`, `arch:inlay`) would cut ~150 calls.
* visibility: Parks indoor chunks are drawn from the canyon although the strata wall hides them.
* Escalator handrail/skirt textures show strong moire at the Parks escalators (first view of 6F approach); anisotropy or a
  lower texture frequency in `arch/escalators.js` would help (not done).
* Nankai 2F void: slab/ceiling of the lower floor visible through the void (detour only).
