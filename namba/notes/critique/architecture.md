# Critique: Architecture and materials

Reviewer: visual critic (AAA environment art and lighting). Build reviewed 2026-10-06. The screenshots are at
`/tmp/claude-0/-home-user-zack-niv-github-io/3781fcee-d127-5006-a617-a06529c080df/scratchpad/critic-visual/<batch>/<view>.png`
(called `<batch>/<view>.png` below). Batch a = 12:10, b = 09:00, c = 17:30 (Parks), d = 12:30 close-ups,
e/f = 12:10 crowd experiments with and without post.

**Verdict:** The station shells have the right bones: zone styles, real column rhythm in Metro and Nankai, convincing signage hang points. But the spaces are oversized, under-structured and under-detailed. The world has holes and floating parts, and its materials read as procedural. Right now it looks like a clean architectural massing model, not Namba.

**Score: 4 / 10** for "walking around is itself delightful".

Harness caveat: SwiftShader drops dynamic resolution to `drsMin` 0.6, so screenshots are softer than real play. Nothing below is a resolution complaint.

---

## Top 10 issues, ranked by impact on the player's feeling

### 1. The world has holes and floating parts (immersion-killer, P0)
* **What:** `b/pose_1F_0_-203_0_6.png` is the player standing on the 1F Sennichimae-dori sidewalk (street_s_walk) looking north. There is no ground. You look straight down into NAMBAWALK: B1 ceiling panels, shop shutters, partition tops, a cut-away of the whole mall. The road beyond is a flat untextured white plane.
* `b/pose_1F_-12_68_90_12.png` and `b/city_1f.png` (Namba CITY 1F court) show stacked slab edges floating in the ceiling plane. A brown box and a grey box hang with no rods. A full shelf of 2F merchandise is visible *through* the 1F ceiling at the top-left of `city_1f.png`: the 2F shop interior pokes through, or the slab around the court ceiling (6 m = 2F floor height) is missing.
* `b/pose_1F_-70_-192_180_8.png` (plaza looking at Takashimaya): horizontal louvre rods run across the open shop entrance at head height, *in front of people*. The store has no glass line at all, so you look into an open-fronted dollhouse. Cantilevered slab chunks hang in the sky.
* **Why it breaks:** a single see-through floor tells the player "level geometry", and the illusion never recovers. TLOU2 and Hitman never let you see the back of the set.
* **Fix:**
  1. Every B1 cell under an outdoor 1F cell needs a structural sandwich: B1 ceiling at `ceil`, a plenum, then the 1F ground slab top at y = 0 (paving / asphalt) with a 0.3 m slab-edge band wherever it meets a stair well. Architecture owns the slab, Outdoors owns the top finish. Add a test to `tools/check-layout.mjs`: for every walkable 1F/2F cell, raycast down from +0.5 m against the built meshes. A miss fails the build.
  2. Slab edges at every void (City court void `[2,54,14,82]` and the Nankai 2F void): a 0.9–1.2 m deep fascia bulkhead clad in white metal panel, a soffit return, and the glass balustrade mounted on it. The 2F floor must close around the void; nothing from 2F may be visible from 1F except through the void.
  3. Any hanging object needs visible suspension: two 8 mm rods or cables to the slab, or a ceiling-flush mount.
  4. Takashimaya facade: put a 3–4 m glazed shopfront line with automatic doors behind the louvres, and stop the louvres at the canopy line (+5 m).

### 2. Halls are gymnasium-sized and empty, so the "enormous labyrinth" reads as "big empty boxes"
* **What:**
  * Takashimaya 1F (`b/pose_1F_-30_-158_90_0.png`) is a single 100 × 52 m room. A plain beige runway runs through the middle, with cosmetics counters in a thin ring at the walls.
  * The depachika (`a/depachika.png`) is 100 × 68 m with a 3.0 m brown ceiling. Islands are 10+ m apart, with whole tennis courts of bare tile between them.
  * The Sennichimae concourse (`s_free` + `s_paid`, 60 × 40 m) opens fully onto NAMBAWALK (`a/walk.png`, left). This is the known "huge empty hall off NAMBAWALK": a plaza of grey floor with a few white gate boxes 40 m away.
  * Nankai 2F (`a/nankai_2f.png`) is a 100 × 64 m coffer grid with almost nothing in it.
* **Why:** Namba is dense. The feeling of being lost comes from short sightlines, visual competition and layered occlusion: columns, bulkheads, shopfronts, hanging signs, people. Big empty volumes give a clear 60 m sightline and kill both wonder and confusion. Real Takashimaya B1/1F has 2.5–3.5 m aisles between counters packed edge to edge. The Sennichimae gates are reached through a 10–14 m wide hall, not a plaza.
* **Fix:**
  * Set a maximum unobstructed sightline target of about 25 m indoors, except in deliberate set-pieces (Nankai gate hall, Parks canyon).
  * Subdivide `taka_b1` and `taka_1f` with a 9 m column grid (0.9 m square, stone-clad). Give the aisles lowered bulkheads at 2.7 m and the counter zones a raised 3.4 m ceiling with brand canopies. Aisle width 3–4 m. Counters should fill ≥ 60% of the floor area. For a mass-model fix, layout.js could insert `cores` for back-of-house blocks.
  * Wall `s_free` off from `walk_main`: a shop row (5–6 shops of 6–8 m) along the shared edge, with two 8 m openings carrying a pink Sennichimae line portal sign. Shrink `s_free` to about 14 m deep.
  * Nankai 2F needs a program: ticket offices, a kiosk row, coin lockers, a gift shop island, and the void (see 6).

### 3. Ceilings are muddy brown planes with too few fixtures, which makes the whole complex feel dim and cheap
* **What:**
  * City 2F (`b/city_2f.png`): the upper 40% of the frame is an unbroken khaki/brown slab with **no visible fixture**.
  * Depachika (`a/depachika.png`) and City B1 north plaza (`b/pose_B1_0_-50_180_5.png`): a brown plane with a sparse dot grid of downlights.
* **Why:** Japanese retail ceilings are white or light grey (albedo about 0.75–0.85). They are bright, busy with services and lit by continuous coves or dense 600 mm grids. A dark ceiling over a bright floor reads as "underground car park", and it flattens the space.
* **Fix:**
  * `ceiling_plaster` albedo up to 0.8, neutral to slightly cool. No warm tint on the ceiling; let the lights carry warmth.
  * Every corridor gets a ceiling system: continuous linear coves along both edges at 0.3 m from the shopfront line, plus a centre line of 1200 × 300 troffers every 3.6 m, or a 600 mm grid in the Metro areas.
  * Add a service kit, instanced, with ≤ 3 draw calls per level chunk: sprinkler heads every 3 m, round smoke detectors, square AC diffusers every 6 m, speakers, CCTV domes every 15 m, and green 非常口 running-man exit signs every 20–30 m.
  * The green exit pictogram alone instantly says "Japan".

### 4. Materials read as procedural textures at the wrong scale
* **What:**
  * Terrazzo in the Nankai halls (`a/nankai_gate.png`, `a/nankai_1f.png`, `a/walk_court.png`) has 2–6 cm chips in saturated red, brown and black. It reads as speckled granite or cookie dough. The cause is in `textures/library.js` `terrazzo`: big chips at 5–13 px radius on 2.4 m/1024 px (2.3 mm/px), and pal entries such as `[0.62,0.38,0.28]`.
  * Marble on the court pillars and City floors (`a/walk_court.png`, `b/city_1f.png`, `b/city_2f.png`) has thin, high-contrast, map-like vein lines that look like crack decals.
  * Every material is perfectly clean.
* **Fix:**
  * Terrazzo: chips 2–8 mm, with the second (large) layer at 1/4 density and ≤ 12 mm. Palette: off-white, light grey and warm beige, plus about 5% charcoal and ≤ 2% muted red. Base `0.82` with ±0.03 variation. Roughness 0.25–0.35 so reflections are soft, not mirror-like.
  * Marble veins: soft, wide, low-contrast (ΔL ≤ 0.12), following a warped fbm direction field rather than crack lines. Tile at 0.6 × 1.2 m with per-tile rotation and offset so seams change.
  * Wear layer (one shared 2048² decal atlas, GeoBatch-merged per chunk): darkened traffic lanes (multiply 0.92) down the corridor centres, gum spots, scuffs at escalator combs and gate lanes, grout darkening near walls, rubber heel marks on stair nosings.
  * TLOU2 and Cyberpunk sell reality almost entirely through this kind of layer.

### 5. Kilometres of blank wall
* **What:**
  * `a/nankai_1f.png`: 40 m of identical beige block wall with one opening.
  * `a/nankai_gate.png`: a white tile wall with ticket machines and nothing else.
  * `b/pose_1F_-12_68_90_12.png` and `b/pose_B1_0_-50_180_5.png`: the court walls are plain stone, with no shops and no openings.
* **Why:** a real Namba wall is never empty. It carries fire hose cabinets (消火栓, red), AEDs, coin lockers, staff doors with push plates, floor maps, poster frames, vending banks, pillar ads, digital signage, ATMs, PS shutter slots and drinking fountains.
* **Fix:** a "wall programme" pass in Architecture or Props. Walk every wall edge; for each run of ≥ 6 m of uninterrupted wall, place one item chosen from a zone-weighted kit, aligned to the wall, ≤ 2 m wide.
  * Kit: hose cabinet 0.75 × 1.0 m red; AED box; 3–6-door staff door with signage; poster frame B0 (1.03 × 1.46 m); digital signage 55" portrait; locker bank 2.7 m; vending pair.
  * Use InstancedMesh per kit item. Poster art comes from the env atlas.
  * Target: a blank wall run never exceeds 8 m.

### 6. The Nankai station has no hero moment
* **What:** the 3F gate concourse (`a/nankai_gate.png`) is a black truss void over a flat tile wall. From the spawn you look away from the gates at a single board. The 2F and 1F are generic coffer boxes (`a/nankai_2f.png`, `a/nankai_1f.png`). The void between them isn't visible from the 2F spawn.
* **Real:** Nankai Namba's 3F central gate hall is one of Japan's great terminal spaces. A 20+ lane gate line spans the hall under a high ceiling with a giant departure board directly over the gates. Beyond it, the forest of platform ends and buffer stops sits under the bright shed. The 2F has the iconic escalator banks rising to it.
* **Fix:**
  * Rotate the `nankai_gate` spawn 180° so the first view is the gate line plus the board plus the platforms beyond.
  * Raise the 3F concourse ceiling finish to a light-grey perforated-metal vault with 3–4 continuous skylight or LED slots, not a black void. The trusses can stay, painted white.
  * Make the 2F void (`[-30,-122,4,-108]`) a 12 × 34 m slot visible from both floors, with the escalator banks rising through or beside it, a hanging banner and a big clock.
  * See `transit.md` for the shed.

### 7. Zone thresholds are raw holes cut in walls
* **What:** `a/nankai_1f.png` shows the Takashimaya entrance as a rectangle cut out of the stone wall: no frame, no doors, no change in floor, no brand portal. NAMBAWALK into City, and NAMBAWALK into the Sennichimae concourse, look the same.
* **Real:** every operator boundary in Namba is a strong, legible threshold. Department-store entrances have automatic glass doors, an air-curtain lobby, a doormat, brand lettering and a floor material change. Metro areas switch to grey tile and a red band. NAMBAWALK has its cream back-lit portal arches with the 1/2/3番街 colour tags.
* **Fix:** a portal kit with jamb returns (0.3 m deep), a lintel bulkhead (0.6 m) carrying the operator's sign, a floor transition strip (stainless 50 mm), and optional glass doors on department stores.
  * Place one at every opening between spaces of different `zone`. Add a 1–2 m material blend zone on the floor.
  * This is also wayfinding: thresholds are how people learn "I've left Nankai".

### 8. NAMBAWALK lacks its identity
* **What:** `a/walk.png` shows a very clean white corridor with three converging strip lights, white shopfronts and almost no colour. `a/walk_court.png` has a pleasant court with pillars, but the corridor itself could be any airport.
* **Real:** NAMBAWALK has a low ceiling (about 2.8–3.0 m clear) with a coloured ceiling band per 番街, back-lit signs hung every 20–30 m, and a dense, saturated shopfront rhythm of about 6 m. Shop light spills onto the corridor, and the corridor itself is dimmer than the shops.
* **Fix:**
  * Drop the corridor ceiling to 2.9 m with a 0.25 m perimeter bulkhead.
  * Give each 番街 a ceiling accent (a coloured linear cove, or a coloured ceiling-band panel 0.6 m wide down the centre): 1番街 green, 2番街 orange, 3番街 blue, matching the signage tags.
  * Make the corridor about 30% darker than the shop interiors (corridor 300–400 lux equivalent, shops 800–1000), so the shopfronts glow.
  * The fact that the shops are dim and white makes this read backwards (see `environment.md` #1).

### 9. Metro station shells: closest to real, but sterile
* **What:**
  * `a/midosuji_gate.png` is the most convincing interior in the game: slatted ceiling, red bands, glass-mosaic columns.
  * `a/midosuji.png` (platform): the ring lights and vault are a good idea, but the wall ad frames are **blank, glowing white rectangles** (known issue).
  * `a/sennichimae.png`: the stair or lift housing at the platform end is an untextured mosaic cube, and the same white rectangles appear again.
* **Cause:** `arch/stations.js` builds `adFrames` with `arch_adbox` and exports them as `ctx.architecture.adFrames`, but **no system consumes them**. Grep shows only `architecture.js` mentions `adFrames`. Environment was supposed to overlay art and never did.
* **Fix:**
  * Until Environment fills them, `arch_adbox` should not be pure white emissive. Make it a mid-grey back-lit panel at ×1.2, with a printed placeholder: 24 ad posters from the env `ad()` atlas, 3 × 1.6 m landscape.
  * Then Environment consumes `adFrames` (one atlas page, one draw call per chunk). Real Osaka Metro platforms are wall-to-wall ads: Glico, USJ, property ads, Osaka Expo legacy.
  * The stair housing needs a proper stair or escalator opening with a stainless balustrade and a "↑ 改札 Gates" sign.

### 10. Thresholds of scale: ceilings and door heights don't vary
* Nankai 2F (5.4 m), City (4 m) and NAMBAWALK (3.2 m) all read about the same in camera because the ceiling planes are featureless and evenly lit.
* **Fix:** the sense of compression and release (NAMBAWALK's low corridor opening into a 6 m court, City's 2-storey court) is one of the best tools for wonder. Exaggerate it:
  * corridors 2.8–3.0 m;
  * courts 6–8 m with a lit cove or skylight feature;
  * the Parks canyon (about 30 m) as the climax.
* Mirror's Edge Catalyst uses exactly this rhythm.

---

## Keep: this works
* Midosuji B1 concourse language (`a/midosuji_gate.png`): slatted ceiling with long strip lights, red line bands on mosaic columns, the gate island rhythm and the overhead black direction sign. It reads as Osaka Metro immediately.
* Exit 18 stair (`b/pose_1F_43_-247_0_0.png`): dark granite treads with yellow anti-slip nosing, steel handrails, the Metro pole sign at the top and daylight spilling down. A great "emerging into the city" moment.
* Glossy floors in NAMBAWALK and City (`a/walk.png`, `b/city_b1.png`) give real depth with SSR. Keep them, but tone down the terrazzo (see #4 and `rendering.md`).
* Nankai terminal columns, stone-clad with an orange band (`a/nankai_2f.png`), and the zone style table in `arch/styles.js`. The system is right; the content per style needs density.
* The column grid and court pillars at the NAMBAWALK court (`a/walk_court.png`) frame the hanging sign nicely.
* The link-west corridor (`b/pose_B1_-85_-125_0_0.png`): white glazed brick, a grey tile floor with the tactile strip, and a convenience store. Believable "connector passage" mood.

## Performance red flags (harness numbers vs DEVNOTES budgets: ≤ 1500 calls, ≤ 2.5 M tris)
| view | calls | tris |
|---|---|---|
| `pose:B1;0;-50;180;5` City B1 north plaza | **1210** | 1.07 M |
| `pose:1F;-70;-192;180;8` plaza → Takashimaya | **1094** | 1.10 M |
| nankai_2f | 889 | 1.06 M |
| walk | 923 | 0.55 M |
| midosuji_gate | 900 | 0.61 M |

* Nothing is over budget, but the City B1 plaza already uses **81% of the call budget with the shops shuttered and the crowd at 09:00**. The density I'm asking for (wall programme, service kit, decals) must be instanced or merged per 48 m chunk. Never per item.
* The plaza view's 1.1 M tris with near-empty geometry suggests the far skyline or Takashimaya massing isn't LOD'd. Check what's in it.
* A teleport onto an escalator footprint (`pose:B1;0;62;180;0`, inside `esc_city_a`) flung the player to x = −4,479,984. The frame then drew 19 calls, and the audio system threw "non-finite value" every frame after. Movement or World: clamp ramp entry, and reject teleports onto ramp footprints.
