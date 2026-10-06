# Critique: Environment dressing (shops, depachika, props, interiors)

Screenshot paths are relative to
`/tmp/claude-0/-home-user-zack-niv-github-io/3781fcee-d127-5006-a617-a06529c080df/scratchpad/critic-visual/`.
The batches are listed in `architecture.md`.

**Verdict:** The systems are there: per-category interiors, menus, sample cases, noren, ticket machines, posters, the depachika and Takashimaya halls, lazy interior builds. But what reaches the screen is white-on-white rooms with product *stickers* instead of products, pale fascias, sparse halls and pop-in. Namba's retail is the loudest, densest, most colourful in Japan. Here it is the quietest thing in the game.

**Score: 3.5 / 10.**

---

## Top 10 issues, ranked by impact on the player's feeling

### 1. Shop interiors read as empty white boxes (known issue: verified, two causes)
* **What:**
  * `a/walk.png` (right): the "かき氷 雪" shaved-ice shop is a white room with one white counter.
  * `d/d_walk_inshop.png` (inside CLAIRE): white walls, white floor, white ceiling, a white monolith gondola, and shelves that are flat bands of product texture.
  * `d/d_walk_front.png` (RUN RUN shoe shop): wooden floor and a staff member, but a white plinth, a few shelves and white walls.
* **Cause A: pop-in.** Interiors are built lazily in `shops.js` (`_buildInterior` under a per-frame ms budget, within `INT_R`) and shown only within 46 m. After a teleport, or when walking briskly, the shell (walls and floor) is visible before the contents. In the 8-frame harness most rooms are empty (`a/walk.png`); with 10 frames they fill (`d/d_walk_front.png`). In real play, walking at 1.5 m/s with a 46 m radius should be fine. Jogging or exiting stairs will show it.
* **Cause B, the real one: the art direction of the interiors is "white".** The materials (`FLOORS`, `wallCol`) and fixtures default to white or near-white, and merchandise is 2-D product-strip textures on shelf faces.
* **Real:** NAMBAWALK and City shops are saturated, high-contrast, cluttered:
  * a drugstore is yellow/red POP everywhere, with products stacked out into the corridor;
  * an accessory shop has dark wood or pink walls, mirror columns, spotlit jewellery trees;
  * a shaved-ice stand has a big photo menu, coloured syrups, a cold case and a queue.
* **Fix:**
  1. *Shell pass first*: build a cheap "shell" with the front batch: floor finish, a back-wall colour or graphic, a ceiling-light layout and a single back-wall feature (a lit brand wall or a shelving silhouette). Then no shop is ever white while the full interior streams in. Prioritise interior builds by *frustum and walking direction*, not just distance.
  2. *Palette*: each category gets a wall/floor/fixture palette with at least one strong colour and one dark: accessory → blush pink plus brass; shoes → charcoal plus oak; drug → white plus yellow/red POP; café → walnut plus black. Ban pure white walls (max albedo 0.85, and at most one white surface per shop).
  3. *3-D merchandise*: replace flat product strips with instanced micro-geometry: box packs (6 tris each), bottles (lathe 8 × 3), shoe pairs, folded-shirt stacks, hanging garments (cards on a rail). One InstancedMesh per kind per chunk, colour per instance, about 20–40k tris per visible shop row. Product strips stay only for shelves beyond 15 m.
  4. *Spill into the corridor*: drugstores, conbini and bakeries place wagons, baskets and A-frame boards 0.5–1.2 m into the corridor (the `wagon` and `aFrame` builders exist; use them on ≥ 50% of fronts).

### 2. Fascias are timid: small pale plaques instead of brand walls
* **What:**
  * `d/d_walk_front.png`: "RUN RUN" in pale pink on a white plaque, about 1.6 × 0.5 m.
  * `b/city_2f.png`: white name plates with grey text.
  * `d/d_city_b1_open.png`: "BA", "PE" plaques.
* **Compare:** in the same shot, CAMP KANSAI (orange) and the green ドラッグ fascia are *exactly* right.
* **Real:** fascia bands in Namba run the full shop width, are back-lit or illuminated, and have bold brand colours and logotypes, plus a perpendicular blade sign.
* **Fix:** make the full-width coloured fascia (CAMP KANSAI style) the default for ≥ 70% of shops. Allow the plaque only for luxury or minimalist categories. Fascia letters emissive ×2–3. Add blade signs to every shop (they exist; set the size to 0.45 × 0.9 m). Text contrast ≥ 4.5:1.

### 3. The depachika is under-dense, and its hanging signs are mirrored
* **What:** `a/depachika.png`.
  * **"BAUM HAUS" and "Chocolatier" are rendered mirror-reversed.**
  * The islands are about 10 m apart across bare beige tile, under a brown 3 m ceiling.
  * No staff behind the counters.
* **Cause of the mirroring:** `env/featured.js` `island()` draws the back face of the two-sided vendor sign with `P.qd(…, cz + 0.062, 1, WHITE, sg.atlas.uv(sg, true))`. For `face = +1`, `kit.js` `qd` already orders the vertices left to right for a viewer on the +z side. The `atlas.uv(…, true)` flip therefore *mirrors* the text. Drop the `true`. Then grep `uv(.*, true)` / `tq(…, true)` for other two-sided signs with the same bug.
* **Real:** Takashimaya Osaka B1 is one of the densest food floors in Japan:
  * glass cases end to end with 2.5–3 m aisles;
  * every vendor has a lit header and a noren or banner;
  * staff in caps and aprons behind every case;
  * price POP on sticks, sampling trays, hanging seasonal banners, and a queue at the famous vendors;
  * bright, cool-white lighting (about 1500 lux) with warm accents on the bakeries.
* **Fix:**
  * Pack the islands: 2.8 m aisles, island lengths 8–14 m, vendor counters on all walls. Target ≥ 60% of the floor area under counters.
  * Hang a seasonal banner run (秋の味覚フェア) down the main aisle every 6 m.
  * Crowd: consume the `staff` spots the hall already emits.
  * Ceiling: bright white with continuous lighting troughs over each counter run.

### 4. Takashimaya 1F is a near-empty hall
* **What:** `b/pose_1F_-30_-158_90_0.png` shows about 10 small cosmetics counters on a 100 × 52 m polished floor, with a featureless runway down the centre and pendant objects floating in mid-air.
* **Real:** the department-store 1F is cosmetics and accessories brand counters (Shiseido-, Dior-, Clé de Peau-like, unbranded here) in a 3–4 m grid. Each has a lit brand wall 2.4 m high, a glass counter, beauty advisors in black uniforms and mirrors, under a classic high ceiling with chandeliers.
* **Fix:** a brand-counter generator (`brandCounter` exists): 20–30 counters on a grid, each 4 × 3 m with a back wall at 2.4 m (lit logo, product shelves), a glass counter with a lit top, 2 stools, a mirror and a staff spot. Main aisles 4 m with a marble inlay; chandeliers or cove-lit coffers every 9 m.

### 5. Hero landmarks are under-sold
* **What:**
  * The NAMBAWALK "Crystal fountain" (`d/d_walk_fountain.png`) is a low white basin with a block on it. No water, no crystal, no light.
  * The Namba CITY north plaza ("city_rocket", `b/pose_B1_0_-50_180_5.png`) has no feature at all.
  * Also, the `walk_court` spawn sits *inside* the fountain footprint (spawn 121,−222 = fountain centre), so the default court view looks away from it.
* **Why:** landmarks are how players build a mental map ("meet me at the fountain"). If they aren't memorable, getting lost stops being fun.
* **Fix:**
  * Fountain: a 6–8 m basin with a 2.5 m faceted glass/acrylic sculpture lit from inside (emissive gradient, slowly cycling hue), animated water jets (the `props:fountain-jets` group exists; make the jets 1–2 m high with a scrolling-UV water shader and a splash ring), a ring of benches, and a hanging circular sign above.
  * North plaza: a sculpture, a giant screen, or a seasonal display (a Christmas tree or Halloween pumpkins, 4–5 m) under a raised lit coffer.
  * Move the `walk_court` spawn to (108, −222) facing east.

### 6. The corridor is under-dressed between shopfronts
* **What:**
  * `a/walk.png`: 150 m of corridor with nothing in it.
  * `d/d_walk_front.png`: 3 m wide blank white piers between shops.
  * Meanwhile the court (`d/d_walk_fountain.png`) shows how good it gets with ad boxes, bins and benches.
* **Fix:**
  * Every pier ≥ 1.2 m wide gets a poster frame, a floor-guide board, a fire-hose cabinet or a mirror panel.
  * Corridor centre every 25–40 m: a bench island with a planter, a digital-signage pillar, or a pop-up wagon (a seasonal sweets stall with a cloth canopy).
  * Hanging banners every 12 m (the vertical `vbanner` drawer exists).
  * Vending pairs in the cross aisles.
  * Use InstancedMesh or GeoBatch per chunk.

### 7. Products and food are pixel stickers, not objects
* **What:** `d/d_walk_inshop.png` (cosmetics as flat strips), `d/d_walk_front.png` (shoes as coloured blobs on shelves), `a/depachika.png` (food trays as flat quads in the cases).
* **Real / AAA:** a believable shop at 2 m needs depth on the shelf. Cyberpunk and Yakuza use simple instanced boxes and bottles with good textures; nobody notices the low poly count, but everyone notices flatness.
* **Fix:** see #1.3. Food: 10 instanced food meshes (onigiri, bento box with lid, cake slice, croissant, dorayaki, sushi pack, tempura on rice, karaage cup, fruit, and a drink bottle) with atlas textures. Sample cases (食品サンプル) in restaurant windows at 1:1 scale with plates and a spotlight. That's the single most "Japan" storefront detail, and it serves the tempura quest.

### 8. The 09:00 Namba is all shutters
* **What:** `b/city_b1.png`, `b/city_2f.png` at 09:00: every shop shuttered, including the drugstore.
* **Real:** at 09:00 cafés (Starbucks, Doutor-like), conbini and bakeries are open. Others have staff behind half-raised shutters doing prep, delivery trolleys and cardboard stacks, and lit interiors behind the shutter slats. The vertical-slat shutter rendering itself is good.
* **Fix:** per-category open times (café, conbini and bakery from 07:00–08:00). At 09:00–10:00, 30% of shutters are half-raised (1.2 m, with legs visible under them). Add delivery cart props. Light the shop interior behind the shutter at 0.3 so the slats glow.

### 9. Restaurants: queues and noren need to read from 20 m
* **What:** I could not find a lunch queue in any shot at 12:10–12:30. The restaurant fronts I saw lacked the dense signage a tempura or ramen shop has.
* **Fix:**
  * Restaurant fronts: noren (exists) at 1.6–1.8 m with a strong colour and white kanji, a lit menu box with photos, a sample case, a ticket machine outside for ramen and tendon, red lanterns for izakaya, and a waiting stool row.
  * Queues outside popular ones from 11:45 (Crowd uses the `queuePoints`).
  * The tempura destination must be the most legible front in the game: an indigo noren with 天ぷら, a fryer glow visible through a counter window, and a wooden lattice.

### 10. Service props are boxes
* **What:**
  * The cleaner's cart is a white cube (`a/walk_court.png`, `d/d_walk_fountain.png`).
  * The `HI-DAY` convenience store's shelves read as texture planes (`b/pose_B1_-85_-125_0_0.png`).
  * The products the crowd carries (shopping bags, suitcases) are plain boxes (see `crowd-visual.md`).
* **Fix:** a small hero-prop pass with 300–800 tris each, all instanced:
  * cleaning trolley;
  * vending machine with lit product rows and a coin slot;
  * recycling bin trio with coloured lids (they exist in the court: good, use them everywhere);
  * gacha bank (an 8-machine block with capsules);
  * ATM;
  * coin lockers with a key-panel grid;
  * wet-umbrella bag stand (傘袋);
  * the yellow 清掃中 A-sign.

---

## Keep: this works
* `d/d_city_b1_open.png`: the CAMP KANSAI fascia with a NEW ARRIVAL banner, and the green ドラッグ fascia with stocked shelves. This is the target look for every shop.
* `d/d_walk_fountain.png`: the NAMBAWALK court dressing (lit ad boxes, recycling bins, benches, toilet signage, a digital screen). The best-dressed space in the game.
* The vertical-slat shutters at 09:00 (`b/city_b1.png`): authentic, and good time-of-day storytelling.
* The variety of drawers in `env/draw.js` and `shopbuild.js` (noren, chalk menus, photo menus, tanzaku, ticket machines, vending, hoardings). The content library is there; it needs scale, colour and placement density.
* Staff at shop entrances (`d/d_walk_front.png`): a person standing at the door makes a shop feel open.

## Performance red flags
* NAMBAWALK close views are cheap (`d/d_walk_front` 197 calls / 0.31 M tris; `d/d_walk_inshop` 156 / 0.29 M), so there is lots of headroom for 3-D merchandise *if it is instanced*. Budget about 150 extra calls per view for merchandise kinds, and ≤ 0.5 M tris.
* The depachika (570 calls) and City B1 plaza (1210 calls) are already high with sparse dressing. Each shop's `S.inner` is its own batch per material. Merge interiors per 48 m chunk per material once built, or each new shop adds 5–10 calls.
* `_buildInterior` builds on the main thread within a ms budget. On low-end machines, prefer building interiors in a worker (geometry arrays only) and uploading at most 1 per frame.
