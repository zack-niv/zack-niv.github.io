# Critique: Crowd visuals (people as seen, not the simulation)

Screenshot paths are relative to
`/tmp/claude-0/-home-user-zack-niv-github-io/3781fcee-d127-5006-a617-a06529c080df/scratchpad/critic-visual/`.
The batches are listed in `architecture.md`.

**Verdict:** From 15 m and beyond the crowd *works*. The silhouettes, flows, suits and suitcases on a Midosuji platform at noon (`a/midosuji.png`) read as Osaka, and the 4-draw-call budget is excellent engineering. At 1–5 m, where a walking game spends half its time, the people are blocky mannequins: cardboard hair, near-blank faces, box limbs. They shimmer with dither speckle and pop in half-transparent in front of you. The crowd is a sim showcase wearing placeholder bodies.

**Score: 3.5 / 10** at close range (6/10 at distance).

---

## Top 10 issues, ranked by impact on the player's feeling

### 1. People materialise in front of you, half-transparent and speckled (known issue: verified, cause found)
* **What:**
  * `b/city_b1.png`: the woman at the left is see-through; the shutter shows through her torso.
  * `a/nankai_2f.png`: the woman in the centre is a speckle ghost.
  * `b/plaza.png` and `b/pose_1F_-70_-192_180_8.png`: people outdoors are covered in **magenta** speckle.
  * `a/start.png`: the legs carry red/purple dither.
* **Cause:**
  1. The fade is a 1-pixel interleaved-gradient discard (`humanMat.js` `FRAG_COLOR`). After any teleport or density move, `trips.js` places people as close as **4 m** (`placeNear(a, !burst, burst ? 4 : 12)`) and fades them in at 1.6/s (`sim.js:223`). They become visible at 4–12 m and stay partly transparent for about 0.6 s.
  2. DRS at 0.6 upscales the pattern into blotches, and post then runs chromatic aberration (0.006) and grain on that per-pixel pattern, which turns it into coloured (magenta/green) noise. See `rendering.md` #5 and the experiment below.
* **Why it breaks:** a person condensing out of thin air in front of you is the most "game-y" thing a crowd can do. Hitman and AC Unity never spawn or fade inside the near frustum.
* **Fix:**
  * Rule: no spawn, relocation or fade **inside the view frustum within 30 m**. Relocate only to nodes behind walls (no line of sight, using the 2-D LOS the player look-ray already has) or behind the camera. Burst refills after a teleport may fade in, but only *beyond 25 m*, or during a 0.3 s screen fade.
  * Make fades temporally stable and per instance: a 4×4 Bayer pattern at 2× pixel scale, offset by instance id. Better still, use alpha-to-coverage on MSAA tiers.
  * The fade must never run on people who are already visible and close.

### 2. Heads: hair is cardboard, faces are nearly blank (known issue: verified)
* **What:** `b/pose_B1_0_-50_180_5.png` is the clearest close-up in the set.
  * Faces are flat skin-coloured ellipsoids with two 11 × 5 mm slits for eyes and thin brows, and **no mouth, no nose shading, no eye sockets, no cheeks**.
  * Long hair is two flat brown planks hanging off the head like a helmet with side-boards.
  * From behind (`a/midosuji.png`, foreground) heads are smooth black eggs with no nape, no hairline and no ears.
  * At 3+ m the eye boxes vanish entirely (`humanGeo.js` eyes are `0.011 × 0.0055` m boxes), hence "blank heads".
* **Real / AAA:** even Hitman's background NPCs carry a 128–256 px face texture with painted eyes, brows, nose shadow, lips and cheek colour. Cyberpunk's crowd LODs keep a baked face texture down to about 20 m. The face is what the human eye locks onto first.
* **Fix (keep it instanced and procedural):**
  * **Face atlas:** one 1024² texture of 64 faces (128 px each): painted eyes with whites and iris, lids, brows, nose bridge shadow, nostrils, lips, and a cheek/age variant. Map it with a planar projection on the head's front hemisphere in the vertex shader (`aPart` region SKIN, head bone), selected per instance (6 bits from `iLook`).
  * Add an eye-socket and nose-shadow AO term baked into the same texture.
  * Skin shading: wrap diffuse (0.25), 2–3 skin-tone ramps, a slight red subsurface tint in shadow.
  * **Hair:**
    * Replace the shells with 6–8 styles built as a sculpted cap mesh (≈ 150 tris) plus 8–20 alpha-tested hair cards (≈ 80 tris) with a strand texture and a Kajiya-Kay anisotropic highlight.
    * Styles: short back-and-sides, side part, bob, long straight, ponytail, bun, grey thinning (elderly), school cut.
    * Hair colour: mostly black and dark brown, ~15% dyed brown, ~3% ash, ~10% grey for older people.
    * Ears: 2 × 30 tris.
  * Budget: LOD0 head ≤ 900 tris.

### 3. Bodies are box-modelled: torsos, sleeves, bags and suitcases are rectangular slabs
* **What:**
  * `b/pose_B1_0_-50_180_5.png`: the white jumper is a box with box sleeves wider than the arms, the shoulder bag is a flat slab and the shopping bag is a cube.
  * `a/sennichimae.png`: suitcases are white bricks, and skirts are rigid trapezoids.
  * `a/walk_court.png`: the cleaner's cart is a plain white box.
* **Why:** the near crowd is constantly in frame. Box silhouettes read as Roblox or PS1, and they clash with the PBR environment.
* **Fix:**
  * LOD0 needs real anatomy built with the existing lathe and ellipsoid helpers: tapered rounded torso (8–12 radial segments), shoulder caps, a neck–trapezius slope, waist, hips, elbows, knees, shoes with a toe-spring, and hands with a thumb mitten (≈ 60 tris each).
  * Garments as offset shells with a hem flare (skirts as a 12-segment cone with a vertex-wave sway driven by walk phase).
  * Accessories:
    * suitcase: rounded box with handle, 4 spinner wheels and a 2-tone shell;
    * shopping bags: paper bag with rope handles and a brand colour from a palette of 12 real-ish shop colours, printed with a logo square;
    * backpacks: rounded.
  * Budget: LOD0 ≈ 3.5–4.5k tris total, used within 10 m (≈ 30–60 people). LOD1 1.2k to 30 m, LOD2 300 beyond. That stays at 4 draw calls and about 0.5 M tris worst case.

### 4. Clothing is flat colour, with no material response or pattern
* **What:** every garment is a single colour with uniform roughness 0.82 (`makeHumanMaterial`). Suits, knitwear, denim, nylon jackets and skin all shade identically.
* **Real:** Osaka street fashion has texture: knit, denim, check shirts, pleated school skirts, glossy puffer jackets, leather shoes. Cyberpunk's crowd sells density with pattern variety even at 20 m.
* **Fix:**
  * A 512² tiling "fabric" atlas of 8 cells (knit rib, denim twill, suiting pinstripe, gingham check, puffer quilting, pleat, plain cotton, leather), applied with triplanar or body-UV mapping per garment region.
  * Choose the cell and tint per instance (3 bits per region), and vary roughness per cell: leather 0.45, nylon 0.35, wool 0.9.
  * Shoes: black leather loafers with a spec highlight on commuters, white sneakers on students and tourists.

### 5. Gait and pose read as scissors
* **What:** mid-stride walkers in `b/plaza.png`, `b/pose_B1_-85_-125_0_0.png` and `a/sennichimae.png` have straight stiff legs, feet that don't roll, arms swinging from a rigid torso and heads locked forward.
* **Fix:**
  * Heel strike → foot flat → toe-off (rotate the foot about the heel or toe by ±15°).
  * Knee flexion of about 15° at mid-stance and 60° at swing.
  * Pelvis drop of 4° and counter-rotation of the shoulders against the hips (±6°).
  * Head stabilisation: counter-pitch the head against the torso bob.
  * Variation: per-instance stride length ±10%, cadence ±8%, arm swing amplitude 0.6–1.2. Commuters swing less with a briefcase and walk faster; elderly have a 60% stride; teens do a shoulder-bag bounce.
  * Heads: glance at signage, shopfronts and other people every 4–10 s (the `iHead` channels already exist).

### 6. Density is in the wrong place: NAMBAWALK is empty at lunch
* **What:**
  * `a/walk.png` (12:10, NAMBAWALK 2番街): four people in a 150 m corridor.
  * `b/city_b1.png` (09:00, shops shut): packed.
  * `a/midosuji.png` (12:10): packed. That one is right.
* **Real:** NAMBAWALK at 12:10 on a weekday is wall-to-wall: lunch queues outside ramen and curry shops, office workers in pairs, shoppers.
* **Fix (Crowd):** check that the density-follows-player relocation targets public nodes in the player's *own* corridor, and that lunch trips weight NAMBAWALK restaurants by their queue/dwell hints. Target density for corridors at 12:00–13:00 is 0.25–0.4 people/m². The visual corollary: if near-density is low, at least fill the far end of the corridor so it *looks* busy.

### 7. Everyone is the same age, height and build
* **What:** `a/midosuji.png` shows a platform of about 30 people with nearly identical heights and proportions. Almost all are 20–50-year-old adults in black/navy. There are no visible children, elderly or uniformed students at this time and place.
* **Fix:**
  * Height: per-instance scale 0.92–1.08 on a normal distribution (σ 0.035), plus sex offset (Japanese average female 1.58 m, male 1.71 m).
  * Build: 3 morph weights (slim/average/heavier), applied as a radial scale on torso and limbs in the vertex shader.
  * Age silhouette: elderly with a forward stoop of 10–15° and shorter stride; children at 0.6–0.75 scale with a bigger head ratio (the code exists: `kid`). Make sure the archetype mix at noon actually includes them (≥ 8% elderly, ≥ 3% children at weekend noon).

### 8. Staff and "life" props are missing at the places they define
* **What:**
  * The depachika (`a/depachika.png`) has no aproned staff behind the counters, though `featured.js` places `H.spot('staff', …)`.
  * The Nankai gate (`a/nankai_gate.png`) shows no station staff at the booth.
  * The court cleaner pushes a plain box (`a/walk_court.png`).
* **Real:** depachika staff in caps and aprons calling いらっしゃいませ, a station attendant in the booth window, a security guard, a cleaner with a proper trolley (mop bucket, bin bag, yellow "清掃中" A-sign).
* **Fix:** Crowd should consume the `staff` spots from `featured.js` (each is a `{x, z, yaw, outfit}`). Give staff uniforms distinct silhouettes: caps, aprons, the station attendant's hat and jacket with an armband. Model a cleaning trolley: frame, bucket, bag hoop, mop (≈ 300 tris, instanced).

### 9. Shadows and grounding
* Blob shadows work at range, but at 1–3 m people float slightly. There is no contact darkening under the soles, and outdoors in the sun they cast no real shadows (`b/plaza.png`: none visible).
* **Fix:**
  * Indoors: blob shadows plus a per-foot contact blob (2 small ellipses, 0.3 opacity), still one instanced draw.
  * Outdoors: let LOD0/LOD1 cast into the sun shadow map within 30 m (a separate instanced depth pass using the same vertex animation: patch `customDepthMaterial`).

### 10. Gestures and props in use
* Phones exist as accessories, but at 12:30 in Namba half the people waiting are looking at phones, holding coffee, carrying umbrellas on rainy days or standing as a couple talking. The pose catalogue (`phone`, `talk`, `photo`, `wave`) is good. Make sure the distribution shows it: ≥ 40% of standing people in `phone` pose, 10% `talk` in pairs facing each other, and lit phone screens (emissive 1.5) so they read.

---

## Keep: this works
* At range, flow and silhouette are right: queuing in two lines at the Midosuji door marks, commuters with briefcases, tourists with suitcases (`a/midosuji.png`). This is the best crowd shot in the game.
* The rendering architecture: 3 instanced LODs, GPU vertex animation, bit-flag accessories, 4 draw calls in total. Keep it. Every fix above fits inside it.
* Face masks and glasses as accessories (`b/pose_1F_-12_68_90_12.png`, right): instantly Japanese. Use them more (≈ 20–25% mask rate is realistic).
* The commuter palette (black, navy, white shirts) is truthful for Osaka weekday mornings.

## Experiment results (Midosuji platform, 12:10)
* `d/x_mido_full.png`: 40 frames after the teleport, so every fade has finished, with DRS pinned at 1.0. **No speckle at all.** Clothing renders as clean flat colour.
* `d/x_mido_noCA_noGrain.png` (CA and grain off) and `d/x_mido_noAO_noSSR.png` (AO and SSR off as well) look identical to the full shot at full opacity.
* **Conclusion:** the "noisy dithered clothing" is the *fade-in dither caught mid-fade*. The dither pattern is then blown up by dynamic resolution at 0.6 (bilinear upscale of a 1-pixel pattern into 2-pixel blotches) and coloured by chromatic aberration (the magenta in `b/plaza.png`). In play it appears whenever the density director relocates someone into view (`placeNear(a, !burst, 4)` after a teleport) and whenever people fade out. Fix #1 above removes it.
* The same experiment shows the **real** close-range problem with no noise in the way. In the two men at the screen doors (`d/x_mido_full.png`, right), the faces are blank flat skin with no features visible at 1.5 m, there are no ears, the jackets are boxy slabs, and the arms are rectangular sticks. Issues #2–#4 are the real work.

## Performance red flags
* The crowd stays at 4 draw calls in every view (well under its 300-call budget), so there's plenty of headroom to spend on LOD0 quality: the 4k-tri bodies, face atlas and hair cards above.
* Watch the triangle count. 1800 agents × LOD mix: if 60 are LOD0 at 4.5k, that's 0.27 M, which is fine. Do *not* raise LOD1 above 1.5k.
* Teleports trigger mass refills (burst relocation of many agents) in one frame. Combined with SwiftShader, that may account for some of the first-frame cost after each teleport. Spread bursts over 10+ frames.
