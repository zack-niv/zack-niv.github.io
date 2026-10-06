# Critique: Transit (trains, platforms, gates, boards)

Screenshot paths are relative to
`/tmp/claude-0/-home-user-zack-niv-github-io/3781fcee-d127-5006-a617-a06529c080df/scratchpad/critic-visual/`.
The batches are listed in `architecture.md`. The `d/` shots are newer code with DRS pinned at 1.0, so they are sharper.

**Verdict:** Transit is the strongest area in the game. The timetable-driven trains, platform screen doors, door marks, the Midosuji platform crowd at the doors and the boards are all genuinely evocative (`d/x_mido_full.png` is the best frame in the build). What holds it back is the hardware: gates are boxes, trains are smooth extrusions without the details that make them recognisable, wall ads are blank light boxes, and the platforms have no furniture.

**Score: 6 / 10.**

---

## Top 10 issues, ranked by impact on the player's feeling

### 1. Midosuji and Sennichimae platform ad frames are blank glowing white rectangles (known issue: verified)
* **What:** `a/midosuji.png` (right wall: 4 white slabs), `a/sennichimae.png` (both walls).
* **Cause:** `arch/stations.js` creates `adFrames` (3 × 1.6 m) and exports `ctx.architecture.adFrames`, and **nothing consumes them**.
* **Why it breaks:** a lit white panel reads as a missing texture, or a hole into a light box. Real Osaka Metro walls across the track are a continuous gallery of back-lit adverts, and they are the colour of the station.
* **Fix:**
  * Transit or Environment iterates `ctx.architecture.adFrames` and maps 24 landscape posters from one 2048² atlas (the env `ad()` drawer already exists: `regions().ad(kind, seed, false)`). One GeoBatch per chunk, MeshBasic ×1.4.
  * Mix of kinds: travel (Kyoto, USJ-like theme park without the brand), property, beer, a cram school, a museum exhibit, Osaka Metro manners posters (マナー), and 1 in 6 "広告募集中 Advertising space available" in plain blue. That one is a great real-world touch.

### 2. Ticket gates are white boxes
* **What:**
  * `d/d_mido_gate.png` and `d/d_sen_gate.png`: rectangular white blocks with a red or pink stripe and a dark top.
  * `d/d_nk_gates.png`: the same with orange.
* **Real:** the Japanese automatic gate (自動改札機) is iconic and instantly recognisable:
  * a chamfered cabinet about 1.0 m high and 1.7 m long with a sloped top;
  * a blue-glowing IC reader pad at the entry end (a 25 cm circle with "IC" printed);
  * a magnetic-ticket slot and an exit slot;
  * a small green/red LCD status display facing each direction, with ⛔ or → pictograms;
  * grey flap doors at mid-length (open by default);
  * yellow tactile strips.
* **Fix:** model a single gate cabinet at about 1.2k tris, instanced:
  * tapered top, reader pad as an emissive disc (blue 0x3aa0ff ×2.5, pulsing on `gate:pass`), slot details as a normal map or geometry;
  * direction LCDs (a green arrow or red ⛔ per lane policy: `in` / `out` / `both`);
  * flap leaves.
  * Draw cost is about 3 instanced draws for all gates.
* This is the single most-touched object in the "find the right subway" quest, so it deserves hero quality.

### 3. Trains are recognisable from 30 m but turn into smooth extrusions at 3 m
* **What:**
  * `d/d_mido_wall.png` (Midosuji 30000 seen through the screen doors at about 4 m): a silver slab with a red band, flat doors and no panel lines.
  * `d/d_nk_train.png` (rapi:t, side-on at about 6 m): a smooth navy tube with porthole windows and no surface detail.
* **Real:**
  * The 30000 series has a corrugated (beaded) stainless side, a black window band, door pocket recesses, the Osaka Metro logo, car numbers, the women-only car sticker and a red window band.
  * The rapi:t 50000 has its famous riveted, "iron-man" pressed-steel look, dark metallic blue with ribbing, oval windows with chrome rims, and a big ラピート logo.
* **Fix:**
  * One tiling 512² normal+roughness detail texture per car family: corrugation for the 30000 and 8300, rivet rows and panel seams for the rapi:t. Use a box-projected env map so the bodies reflect the platform lights (`envMapIntensity` 0.8, roughness 0.25 on stainless).
  * Decal atlas with car numbers, logos and the women-only sticker.
  * Underframe: equipment boxes and bogies at least as dark silhouettes. Right now the body floats over the trackbed.
  * The near-car side is seen at 1–3 m for minutes on the platform, so budget LOD0 at about 8k tris per car within 20 m.

### 4. Platforms have no furniture
* **What:**
  * `a/start.png` (Nankai platform 4, the very first frame of the game): bare tiled platform, one column, nothing else.
  * The Midosuji and Sennichimae platforms are the same.
* **Real:**
  * Nankai Namba platforms: bench rows with backs, vending machines (DyDo, Suntory), recycling bins (cans/bottles/burnable), hanging car-number and stop-position signs, clocks, a 発車標 LED board per pair of tracks, a kiosk at the concourse end, platform staff with flags, and the yellow departure-melody speaker boxes.
  * Metro: benches against the screen-door housings, the "なんば Namba" station-name board between every other door pair, emergency stop buttons (非常停止ボタン) on the columns, a fire extinguisher, a "このドアは…" sticker on each screen door.
* **Fix:** a platform prop kit, placed by Transit along `trackInfo().platformRange` every 12–20 m, alternating bench, vending pair, bins and an info column. Emergency buttons and a clock on every 2nd column. Use InstancedMesh: about 10 models and 10 draws per platform.
* The start view must be dense and *Nankai*: it sets the bar for the whole game.

### 5. The Nankai shed is dark and low; the real one is bright and soaring
* **What:** `a/start.png` and `d/d_nk_train.png` show a dark grey slatted ceiling with white beams and a strip of light at the far end.
* **Real:** Nankai Namba's 9-track terminal is under a big steel shed with skylights. At noon the platforms are daylight-bright with clean shadows from the roof structure. The platform-end "head" toward the gate concourse is a bright, wide, open band.
* **Fix:**
  * Light-grey ceiling panels (albedo 0.7).
  * Continuous skylight strips (emissive 4–6 by day) every 2nd bay, plus registered `strip` lights so the bake brightens the platforms.
  * Lighting should treat the shed as semi-outdoor (sky term about 0.3).
  * Exposure under the shed should be noticeably brighter than the 3F concourse, which is a nice "arrival" beat.

### 6. Platform floors behave like mirrors, and their lit edges read as holes
* **What:** in `d/d_nk_train.png` and `a/start.png`, the far platform's floor and the near platform edges show bright white rectangles. These are mirror reflections of the ceiling troffers, and they look like openings in the floor.
* **Real:** platform surfaces are anti-slip coated concrete or textured tile (roughness 0.7–0.85), with a yellow tactile strip and a white edge line. They are never glossy.
* **Fix:** set every `terminal_platform` and `metro_platform` floor material to roughness ≥ 0.7 and `nbReflect` 0. Keep gloss for concourses only.

### 7. Escalators and stairs into the platforms need their machinery language
* **What:** `d/d_mido_esc.png` shows the B1→B2 escalator well with glass balustrades. Good. But at the landings there are no comb plates with yellow demarcation, no stop-button pedestals, no "黄色い線の内側に…" step graphics, and no escalator-mouth signs facing the rider.
* **Fix:** a landing kit:
  * comb plate in brushed metal (0.9 × 1.0 m) with the yellow "step-edge" demarcation;
  * a black skirt brush strip;
  * an emergency stop pedestal (a red button in a clear cover);
  * a handrail-entry newel with a rubber boot;
  * a floor sticker "立ち止まらず…" or the arrows that Osaka uses for keeping right.
* Place it at every escalator end. It's ≤ 4 instanced draws total.

### 8. Departure boards and announcements are good; make them hero
* **What:**
  * `a/nankai_gate.png`: the Nankai main board with 9 rows, type colours, times and car counts. Excellent.
  * The Midosuji boards (`a/midosuji.png`) are small and blue.
* **Real:** the board above the Nankai central gate is huge (about 12 m wide). The rows scroll in Japanese and English alternately every 5–8 s, and type colours (区急 green, 急行 orange, 特急 red/blue) are vivid.
* **Fix:**
  * Scale the main board ×1.5–2.
  * Alternate JA/EN every 6 s (the canvas redraw is cheap at 1 Hz).
  * Add the scrolling ticker line at the bottom (運行情報, "Train service is operating normally").
  * Emissive ×2 so the board blooms slightly.

### 9. Gate-line support furniture is thin
* **What:** ticket machines exist (`a/nankai_gate.png`, `d/d_sen_gate.png`), but they read as small grey boxes with a white screen.
* **Real:** a ticket machine bank has a fare chart above it (it exists, good), touch screens with a blue UI, coin and note slots, an IC charge slot, "のりこし精算機 Fare Adjustment" yellow signs, and a queue of people in front.
* **Fix:**
  * Give machines a 256 px screen texture with the Osaka Metro blue/white UI, a coin tray, and a yellow header band.
  * Raise the fare chart to 2.4–3.2 m and light it.
  * Have Crowd send about 5% of tourists to stand at the machines.

### 10. Tunnel ends and track pits
* **What:** the tunnel ends beyond the Metro platforms are barely visible in my shots. The Sennichimae platform end has an untextured mosaic cube (`a/sennichimae.png`, centre).
* **Fix:**
  * The tunnel mouth should be a black void with a few bulkhead lamps receding in perspective (they exist; make them read with a 1.5 emissive and a bloom halo), a signal head (red/green), and cable trays on the walls.
  * The platform-end cube should be the stair or lift housing with an opening and a sign, or the 乗務員 staff room with a door.

---

## Keep: this works
* `d/x_mido_full.png`: the Midosuji platform at 12:10. Train in, screen doors open, people lined up at the door marks, the ring lights, the escalator bank and board at the end. This is the game's best frame; protect it.
* The screen doors with the destination header "新大阪 / Shin-Osaka" (`d/d_mido_wall.png`), and the strap handles visible inside the car.
* Nankai car-count floor marks (8両 / 6両 in orange and blue, `a/start.png`, `d/d_nk_train.png`) and the departure board content (`a/nankai_gate.png`).
* The Midosuji and Sennichimae gate halls (`d/d_mido_gate.png`, `d/d_sen_gate.png`): hanging black direction signs with line roundels and the yellow 出口 panels, slatted ceilings and line-colour bands. These read as Osaka Metro immediately.
* The car liveries: Nankai 8300 silver with blue/orange bands, rapi:t deep blue with portholes, Midosuji red band.

## Performance red flags
| view | calls | tris |
|---|---|---|
| `d/d_mido_gate` | 725 | **1.20 M** |
| `d/d_sen_gate` | 464 | 1.01 M |
| `d/d_mido_esc` | 464 | 0.97 M |
| `a/midosuji_gate` | 900 | 0.61 M |
| `a/start` | 493 | 0.75 M |

* The Metro gate halls are the triangle hotspots (about 1.0–1.2 M with *box* gates), and 0.6–0.7 M of that appears whenever the B2 platform level is visible beneath. Make sure trains on hidden platforms and tunnel tubes are culled when the player is on B1 and not near the escalator well. Train models (10 car types × 4 groups) should get distance LODs: beyond 40 m a 300-tri box with a texture is enough.
* The gate model I'm proposing (#2) at 1.2k tris × about 56 lanes is 67k tris, which is fine, but it must be instanced.
