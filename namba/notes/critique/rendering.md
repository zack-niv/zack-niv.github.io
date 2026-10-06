# Critique: Rendering and lighting

Screenshot paths are relative to
`/tmp/claude-0/-home-user-zack-niv-github-io/3781fcee-d127-5006-a617-a06529c080df/scratchpad/critic-visual/`.
The batches and harness caveats are listed in `architecture.md`.

**Verdict:** The pipeline is ambitious and mostly correct: a baked light field, SSR, SSAO, bloom, grading and dynamic resolution. But the image is flat, grey-beige and evenly lit. It has one fatal shader bug that deletes the whole city skyline. Floor reflections read as smeared fog, and the post stack's cheap effects (chromatic aberration and grain) fight the crowd's dithered fade.

**Score: 4.5 / 10.**

---

## Top 10 issues, ranked by impact on the player's feeling

### 1. `out_facade_*` doesn't compile: every procedural building facade is missing (P0, a five-minute fix)
* **What:** the console in every run shows `THREE.WebGLProgram: Shader Error … Material Name: out_facade_office … ERROR: 0:462: 'objectNormal' : undeclared identifier`, followed by `useProgram: program not valid`.
* **Cause:** in `js/world/outdoor/facade.js` the vertex patch injects `vFN = normalize(mat3(modelMatrix) * objectNormal);` after `#include <uv_vertex>`. That runs **before** `#include <beginnormal_vertex>` declares `objectNormal`.
* **Second bug, same file:** all five kinds (`office`, `grid`, `curtain`, `apartment`, `stone`) use an identical `onBeforeCompile` source text with the kind baked in through closure, and there is no `customProgramCacheKey`. three.js therefore hashes them to **one program**: whichever kind compiles first, every facade gets its window grid. Only one error is logged because only one program exists.
* **Impact:** the Parks Tower, the massing around Parks and the Sennichimae-dori frontages that use `facadeMat` don't draw. Outdoors reads as a sparse model with grey placeholder skyline boxes (`b/plaza.png`, `b/pose_1F_0_-203_0_6.png`). That makes the Parks "wow" moment impossible.
* **Fix (Outdoors owns the file; Rendering should review):**
  1. Move the injection to after `#include <beginnormal_vertex>`, or use `normal` directly: `vFN = normalize(mat3(modelMatrix) * normal);`.
  2. Add `m.customProgramCacheKey = () => name;`.
  3. Add a CI guard: `tools/shot.mjs` should exit non-zero on any `Shader Error`, because it currently prints it at the bottom where nobody reads it.

### 2. Floor reflections are smeared white blobs, not polished stone
* **What:** `a/nankai_gate.png`, `a/nankai_1f.png`, `a/nankai_2f.png` and `a/walk_court.png` show every ceiling panel reflected as a soft, over-bright oval that bleeds across the terrazzo. The floor ends up brighter than the walls and reads like fog or wet paint.
* **Compare:** `a/walk.png` (porcelain) is much better: rectangles with a falloff.
* **Real / AAA:** polished terrazzo or stone gives a *recognisable*, slightly blurred image of the fixture. Its intensity is about 4–8% at normal incidence, rising with Fresnel toward grazing angles. Mirror's Edge Catalyst and Hitman 3's Dubai get their "expensive" look from crisp, low-intensity floor reflections, not glow.
* **Cause:**
  * The terrazzo roughness map alternates 0.1 (chips) and 0.16–0.22 (matrix) per texel, so the SSR mip pick flickers.
  * The SSR is half-res with a 0.5–1.5-step jitter and no temporal history, so noise gets blurred into blobs.
  * The composite uses `uSSR` 1.0 with no energy clamp.
* **Fix:**
  1. Composite: `refl *= F * (1 - rough)^2`, clamped to ≤ 0.35 of the scene luminance at the hit point.
  2. Temporal accumulation for SSR (and SSAO): reproject with the previous view-projection, history weight 0.85–0.9, neighbourhood clamp. This removes both the jitter blobs and the AO speckle.
  3. Feed SSR a material-constant roughness (a per-material uniform, not the texel roughness) so the blur is stable.
  4. Terrazzo roughness 0.28–0.35 (see `architecture.md` #4).

### 3. Lighting is flat: no pools, no contrast, no hierarchy
* **What:** almost every interior is evenly lit mid-grey or beige from wall to wall (`a/nankai_1f.png`, `a/depachika.png`, `b/pose_1F_-30_-158_90_0.png`, `b/city_2f.png`). There are no pools under downlights, no dark corners and no warm spill from shops onto corridors. Shops are *dimmer* than corridors (`a/walk.png`, right).
* **Real / AAA:** Japanese malls are bright but hierarchical. Shop interiors are 1.5–2× brighter than the corridor, signage glows, and corridors have pools every few metres. TLOU2 and Cyberpunk direct the eye with luminance; here nothing pops.
* **Fix:**
  * Target ratios: shop interior ≈ 2× corridor irradiance; feature lighting (court coves, displays) 3×; back-of-house and corners 0.5×.
  * In the bake, give `down` lights a tighter cone (40–50°) and lower the diffusion share for interiors (`r*0.45` in `bake.js` assemble), so pools survive.
  * Every lit shopfront should register a `sign` light facing the corridor at intensity 1.5–2 so its colour spills onto the floor (most of them read neutral right now).
  * Add a "luminance budget" debug view (false colour) to `?debug` so builders can see the hierarchy.

### 4. Ceilings render muddy khaki-brown
* **What:** `b/city_2f.png` (40% of the frame is a brown slab), `a/depachika.png`, `b/pose_B1_0_-50_180_5.png` and `a/walk_court.png`.
* **Cause:** in the bake, the ceiling term is luminance only (`B.a`), made of floor bounce plus 0.15 × side irradiance. That lands at about 0.3–0.4 of floor irradiance. Multiplied by a warm-tinted plaster albedo and a warm grade, it becomes khaki. Real ceilings in lit malls sit at about 50–60% of floor luminance and look *white*.
* **Fix:**
  * Ceiling term = `0.5 × floorIrr × floorAlbedo(≈0.6) + uplight`, keeping the floor bounce's *colour*, not just its luminance. Pack it in the spare channels or a second small texture.
  * Neutral ceiling albedo 0.8.
  * Have coves and linear lights add a direct up-component to the ceiling within 1.5 m.

### 5. Crowd "speckle": chromatic aberration and film grain on a 1-pixel dither pattern
* **What:** people in many shots are covered in purple or magenta speckle and look half-transparent: `a/nankai_2f.png`, `b/city_b1.png` (the left woman shows the shutter through her body), `b/plaza.png` and `b/pose_1F_-70_-192_180_8.png` (bright magenta in daylight), `a/start.png` (red/purple legs).
* **Cause, part 1:** the crowd fade is a screen-space interleaved-gradient discard (`humanMat.js` `FRAG_COLOR`). After any teleport or density refill, people fade in at 1.6/s, and the 8-frame harness (dt capped at 0.05 s, so 0.4 s of sim) catches them at about 0.6 opacity.
* **Cause, part 2:** the composite then applies **chromatic aberration (`uCA` 0.006)**. CA splits R and B by a few pixels across a pattern that alternates every pixel, which manufactures magenta/green fringes inside the bodies. The grain (0.02) adds to it.
* **Evidence:** see the experiment shots `d/x_mido_full.png` and `d/x_mido_noCA_noGrain.png`, and "Experiment results" below.
* **Fix:**
  1. Fade people with *alpha-to-coverage* when MSAA is on. Otherwise use a dither that is temporally stable per instance (seeded by instance id, 4×4 Bayer, pattern scaled to 2 px) and clamp fade-in to people **outside the view frustum or beyond 25 m**. Nobody should materialise in front of the player (that's a Crowd rule; see `crowd-visual.md`).
  2. Apply CA only beyond `r > 0.6` of the screen radius (lens-edge only), strength ≤ 0.003. Or drop it: CA in a calm walking game is a cheap "gamey" look.
  3. Film grain: luminance-only, applied *after* tonemapping at ≤ 0.012, and zero on fully saturated pixels.

### 6. Outdoor daylight has no punch: haze washes the city, and the ground and road are white
* **What:**
  * `b/plaza.png` and `b/pose_1F_0_-203_0_6.png` (09:00): the skyline is low-contrast, uniformly beige, with heavy aerial perspective at only 150–300 m.
  * The road surface renders as a flat white plane with no asphalt texture (right half of `b/plaza.png`, centre of the street shot).
  * Shadows are faint.
* **Real:** an Osaka morning has crisp, slightly blue shadows, strong contrast between the sunlit facades and shaded canyons, and dark asphalt (albedo about 0.08–0.12).
* **Fix:**
  * Check why the asphalt material is white. Either its canvas texture isn't ready when sampled, or its colour is multiplied by the sky term without albedo. It needs albedo 0.1.
  * Fog density: about half of the current value. Extinction distance ≥ 1.5 km for a clear day.
  * Sun at 09:00: intensity 1.0 with a sky fill of 0.25. Shadow strength with an ambient occlusion floor of 0.35.

### 7. Light fixtures clip to flat white with no structure
* **What:** ceiling panels (`a/nankai_2f.png`), the Midosuji wall ad frames (`a/midosuji.png`) and the Sennichimae walls (`a/sennichimae.png`) are pure (1, 1, 1) rectangles with no bloom falloff, no diffuser texture and no frame. Rendered this way, a blank ad box looks like a hole in the world.
* **Fix:**
  * Emissive panels ×3–4 (not ×6–12) with a subtle diffuser gradient: 10% darker at the edges, an LED-dot texture at 0.3 opacity close up.
  * Bloom threshold so that only values above 2.0 bloom, intensity 0.08, radius 4 mips. The halo is what sells "this is a light".
  * Blank `arch_adbox` must never ship white. See `architecture.md` #9.

### 8. Tonemapping and grade: everything converges on grey-beige
* **What:** across 25+ views the palette is beige walls, grey floors and a khaki ceiling. The saturated accents that make Namba Namba are muted by the grade: line colours, shop signage, Nankai orange, NAMBAWALK's coloured tags.
* **Fix:**
  * Use AgX or PBR Neutral with a +5–8% saturation boost in the mid-tones only. Keep `uContrast` at about 1.08.
  * Per-mood LUT tweaks:
    * Metro: cool white 5000–5500 K.
    * Nankai: neutral 4500 K.
    * NAMBAWALK and City: warm 3500 K in shops, neutral corridor.
    * Parks at golden hour: warm sun, cool shade.
  * Let signage emissives exceed 1.0 so they stay saturated after tonemapping (×1.35 is too low for back-lit signs; use 2–3 on the sign art, not the white).

### 9. Dynamic resolution and FXAA make thin detail shimmer and soften
* The high-tier floor is `drsMin: 0.6` with FXAA. When real laptops hit heavy views (canyon, City B1 plaza), the internal resolution drops to 60%. Signage text, tiles and handrails turn to mush, and FXAA can't recover thin rails.
* **Fix:** a TAA-lite (the same history buffer as #2) with a 0.6–1.0 DRS range, plus a CAS sharpen (0.3). Raise high's `drsMin` to 0.75 and fix the cost at the source.

### 10. The sky and the city fail to read as "Osaka from Namba"
* The sky dome is a generic blue gradient with stock clouds. That's fine. The skyline, though, is undifferentiated grey boxes (`b/pose_1F_0_-203_0_6.png`): no signs, no rooftop billboards, no red aircraft lights, no water tanks, no colour variation.
* **Fix:** 3–4 facade palettes (cream tile, grey concrete, dark glass, brick-brown), rooftop clutter instanced (tanks, AC units, antenna masts), and 10–15 rooftop billboards with simple brand-free art. At 17:30, light the windows (the facade `uNight` path already exists once #1 is fixed).

---

## Keep: this works
* The architecture of the pipeline: baked light field with mood env maps, per-material SSR opt-in, a sun masked to open-sky cells, and DRS. It is the right shape for a browser game.
* Porcelain-floor reflections in NAMBAWALK and City B1 (`a/walk.png`, `b/city_b1.png`): this is what all floors should look like.
* Metro concourse lighting (`a/midosuji_gate.png`): cool, even, believable, with strip lights that read correctly.
* Exit 18 (`b/pose_1F_43_-247_0_0.png`): daylight at the top of a dark stair. A good exposure transition moment.
* The vignette is subtle and natural.

## Experiment results (crowd speckle)
*Will be filled in when `d/x_mido_*.png` lands (see the bottom of `crowd-visual.md`).*

## Performance red flags
| view | calls | tris | SwiftShader ms/frame (relative only) |
|---|---|---|---|
| City B1 north plaza | 1210 | 1.07 M | 10 392 |
| plaza → Takashimaya | 1094 | 1.10 M | 5 169 |
| nankai_2f | 889 | 1.06 M | 11 130 |
| city_2f | 709 | 0.78 M | 16 086 |
| plaza (spawn) | 328 | 0.33 M | **20 157** (outdoors with shadows: the worst per-call cost) |
| Parks `garden` (4F) | — | — | **> 1 500 000 for 8 frames: never finished in 25 min** |

* **Parks is pathological.** The `garden` view didn't produce 8 frames in 25 minutes, while every other view does 8 frames in 30–160 s. During it the *renderer* process ran at 95% CPU and the GPU process at 33%, so the stall is **main-thread JavaScript**, not fill rate. Suspects, in order:
  1. Vegetation `_refresh` is throttled (every 0.5 s or 6 m) but re-uploads the *full-capacity* instance buffers of every species (`needsUpdate` on the whole array). Use `updateRange` / `addUpdateRange(0, count*16)`.
  2. Crowd tier recomputation for garden agents spread over 6 levels.
  3. Lighting spec-light selection over a large outdoor fixture count, and shadow-caster traversal.
* Per-system timings are in the "Parks profile" section below once it lands. The rule: *nothing* in `update()` may be O(instances) per frame.
* Shadows: the outdoor views cost about 2× per call. With shadows on for every chunk that contains an outdoor cell, the 2048 map renders the whole Parks massing. Cascade or restrict the caster set to ≤ 120 m and to chunks in the sun frustum.
* Everything else is inside budget (max 1210/1500 calls, 1.1 M/2.5 M tris). The trouble is that the scenes are still sparse, so expect +30–50% once the density these critiques ask for lands. Instance everything new.
