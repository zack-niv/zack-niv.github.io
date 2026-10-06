# Demo perf / load — notes (Load & perf agent)

## What the "post init takes minutes" really was
`Post.init()` costs **4 ms**. The minutes were the *first rendered frame*: three.js compiles every program lazily on
first use, and every lit material is patched with the baked light-field shader (3 atlas fetches, env, PCF shadow,
N specular fixtures), so ~65 programs link synchronously in the GPU process. In headless SwiftShader (no
`KHR_parallel_shader_compile`, software JIT) that is ~1.5-2 s per program + ~10-25 s per 1280x720 frame, and
`tools/loadprobe.mjs` could not even read `ctx.ready` because the page's main thread was blocked behind that queue.
`ctx.ready` itself was set at ~22 s.

## What changed
* `js/main.js` — loader rewrite (weighted real progress), modulepreload of every system graph (parallel fetch on a
  real server), `frame()` no longer waits on a busy GPU (rAF raced with 50 ms), per-system timings in `ctx.loadTimes`
  and `[load]` console lines. **`ctx.ready` = systems built and interactive**; the main loop starts at once and
  renders *behind* the loading screen; the loader lifts after the spawn-view shaders are compiled and 3 real frames
  are drawn (`ctx.firstFrame = true`). `game:ready` (title) fires when the loader lifts (immediately under `?test`).
* `js/core/loader.js` (new) — loading screen: metro-line progress with six stations, honest weights from the
  measured timeline, rotating tips, touch notice ("Best on a computer with keyboard & mouse — Continue anyway",
  remembered per session, not shown under `?test`). Styled in `css/style.css` (`.nbl-*`; `.ld-msg` kept for loadprobe).
* `js/render/precompile.js` (new) — staged shader warm-up: `precompileVisible` (parallel, capped 12 s, only when
  `KHR_parallel_shader_compile` exists; compiles post programs against their real render targets) then
  `precompileRest` trickles the other chunks in the background (3 chunks / 160 ms, only while the frame is healthy;
  not in `?test`).
* `js/render/lighting/inject.js` — `nbReflect` is now a per-material uniform (was a baked constant => one program
  per reflectivity value); `NB_DYN` 8 -> 4 specular fixtures (8 unrolled GGX evaluations in every lit program is what
  makes ANGLE/D3D and SwiftShader compiles slow).
* `js/core/engine.js` — conservative `detectTier()`: touch/software/weak => `low`; only clearly strong GPUs
  (RTX/GTX 20+, RX 5500+, Apple M with >= 8 cores, Arc) with >= 6 cores => `high`; everything else `medium`. `high` is
  cheaper: draw distance 160, shadow map 1536, `drsMin` 0.7, 4 spec fixtures, no CA, grain 0.006. Per-tier `callBudget`.
* `js/render/visibility.js` — own level +-1 only (+-2 only next to a void/ramp that reaches it; outdoors still all
  levels above ground); indoor draw distance x0.8 (fog already swallows it); **draw-call governor** (pulls draw
  distance in to 55% when calls exceed `callBudget`, creeps back with headroom); dynamic resolution starts at 0.88 on
  high/ultra.
* `js/render/post.js` + `shaders/post.glsl.js` — SSR: crisper (narrow 5-tap blur instead of 9, lower mip blur,
  Fresnel * gloss^1.5 weighting, 2.4 display-unit clamp); composite: local-contrast "clarity" term (uses the bloom
  buffer already sampled, free), vibrance, AgX punch 1.12 -> 1.2, per-mood contrast/saturation up, exposure -0.15 EV, CA
  off (also saves 2 taps/px and removes the magenta fringes on the dithered crowd), grain 0.006.
  Emissive fixtures dimmed ~35% (`materials.js` `light_*`, fallback fixtures in `lighting.js`) so panels keep structure
  instead of clipping to flat white.
* `js/audio/mixer.js` — `setListener` returns early on non-finite camera values (the `setValueAtTime` error).

## Tools added
* `tools/perfshot.mjs` — one browser session: load timeline, programs count, per-view calls/tris/ms + PNGs.
  `--root DIR` runs against a saved copy (used for the before/after table).

## Requests / notes for others
* index.html (flow agent): the Google Fonts `<link rel=stylesheet>` is render-blocking; consider
  `media="print" onload="this.media='all'"`. Not touched.
* Many materials get their own program only because `inject.js` puts `material.name` in the cache key when the
  builder has an `onBeforeCompile` (env_*, parks_*, out_*): ~15 extra programs. Safe to merge per-family if the
  builders give identical hooks their own `customProgramCacheKey`.

## Measurements (headless SwiftShader, 1280x720, quality=high, loaded machine: load avg 7-13 on 4 cores)
Load timeline (loadprobe): before = ready seen at 178 s (system build done ~29 s, then ~150 s blocked behind the first-frame
program compile); after = **READY 35.0 s** (`[load] systems ready` ~34 s; materials 1.4, architecture 7.7, shops 13, parks 16,
signs 21, bake 23, player 30, audio 33, game 34, first frame 35). The first drawn frame in SwiftShader still takes ~6 minutes
(62 programs + 10-25 s/frame in software) - real GPUs link in parallel and draw in ms. loadprobe `[err]`: only the sandbox's
Google-Fonts cert failure.

Draw calls / triangles per view (before = old code snapshot, after = current):
| view | before calls / tris | after calls / tris |
|---|---|---|
| start (Nankai 3F) | 597 / 910k | 636 / 825k |
| nankai_2f | 806 / 424k | 858 / 407k |
| city_2f | 849 / 354k | 465 / 185k |
| canyon | 1177 / 867k | 711 / 715k |
| parks_6f | 727 / 675k | 532 / 581k |
| pose:2F,33,222,180,10 (worst canyon) | n/a | 771 / 736k |
(start / nankai_2f differ from "before" partly because the world agent changed content and the clock moved to 11:20 between
snapshots; both are under the 900-call `high` budget, the governor trims anything above it.)
Console: clean (zero errors) apart from the sandbox font cert failure.
Left: Parks indoor chunks seen from the canyon are not occlusion-culled (needs a portal test, not safe today); merge
name-keyed programs (see above); real-GPU frame time is unmeasured.
