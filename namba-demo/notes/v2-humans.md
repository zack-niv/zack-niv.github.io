# v2 — Humans agent (items 5, 8, 7-staff)

Owner files: `js/npc/*`, `assets/humans/*`, `vendor/three/addons/loaders/GLTFLoader.js` (new, from three@0.186.0,
identical to the npm tarball; `SkeletonUtils.js` / `BufferGeometryUtils.js` were already vendored and match too).

## Item 5 — people that read as people

**Models:** Quaternius *Ultimate Modular Men / Women* (CC0; see `assets/humans/LICENSE.md` for sources and the
licence text). 8 outfits: men Suit / Casual / Hoodie / Backpacker, women Suit / Casual / Dress / Backpacker.
Proportioned bodies, real clothing silhouettes (suits with shirt + tie, tees, hoodies, dresses, cargo trousers).

**Pack** (`assets/humans/tools/pack.mjs`, run by hand in Node with three@0.186.0 + meshoptimizer):
every character's ~13 primitives merged into ONE skinned mesh with a per-vertex material index; colours live in a
small table whose "tint" entries take the person's look colours (skin, hair, top, bottom, shoes, inner, bags);
welded + creased normals, int8 normals / uint8 weights; two simplified LODs (30 %, 10 %); clips Walk, Run, Idle,
Idle_Neutral, Wave, Interact. `humans_m.glb` 1.86 MB + `humans_f.glb` 1.72 MB = **3.6 MB** total.

**Runtime** (`js/npc/humans.js`, `js/npc/render.js`):
* procedural clips derived from the real ones by model-space bone aims: sit, eat, phone, phone-walk, photo, bow,
  nod, browse, look-up, cart push, suitcase pull (walk + idle), escalator stand;
* accessory parts merged into every outfit and switched per person by the `looks.js` BIT flags: briefcase,
  shoulder bag (+ strap), tote, backpack, shopping bags, rolling suitcase, phone, cup, cap, apron, face mask,
  cleaning cart;
* outfit choice from the look (`variantFor`): suits for commuters / station staff / security, dress for skirts,
  backpacker for backpack tourists, hoodie for some students / tourists, casual otherwise; the v1 Japanese urban
  palette (navy / grey / beige office wear, uniforms, autumn coats) is reused as tints;
* **hybrid LOD** — nearest ≤ 32 on screen within 16 m (`high`; 18/13 m medium, 8/9 m low, 44/20 m ultra): real
  `SkinnedMesh` clones (`SkeletonUtils.clone`) with an `AnimationMixer` (shared clips), head turn towards what they
  look at, kids get a bigger head. Everyone else: **GPU-skinned instancing** from a bone texture (every clip baked at
  30 fps → 3×4 matrices, RGBA32F 186×~1000), one draw call per outfit × LOD (30 % mesh to 34 m, 10 % beyond).
  Fading people (spawn / exit / boarding) go through alpha-blended twins (v1's cross-fade, no dither).
* **Near ↔ far hand-over:** both versions play the same clip at the same clip time; the near one cross-fades over
  0.3 s on top of the far one (hysteresis 16 / 18 m), so there is no pop.
* **No foot sliding:** walk / run clips play at `speed / natural clip speed` (natural speed measured from the
  planted foot: men 1.36 m/s, women 1.09 m/s at model scale, scaled by the person's height); clip changes
  cross-fade over 0.28 s and walking-type clips keep their phase.
* **Fallback:** if the GLBs fail (or `?v1crowd`), the v1 procedural renderer (`render_v1.js`) is used; if only
  one gender loads it stands in for both. The game never runs without people.

Draw calls (high): ≤ 32 near + ≤ 16 far + ≤ 16 fade (only non-empty ones are drawn) + 1 blob draw.

## Item 8 — behaviour

* **Fewer, better placed:** demo population ×0.27 (≈ 300–360 at lunch on `high`), half of it kept within ~100 m of
  the player; train surges and platform waiters scaled to match; a train empties over ~15 s.
* **Spread placement:** no two people are placed within ~1.2 m (initial fill, mid-trip fast-forward, relocation
  around the player) — `Director.free / claim`.
* **Escalators keep LEFT** (`sim.js ESC_STAND_SIDE = -1`: standers left, walkers pass right); stairs keep left;
  corridor lanes have a slight keep-left bias. NOTE: Osaka traditionally stands on the RIGHT — the spec asked for
  left; flip the one constant if the lead prefers Osaka style.
* **No clumps at escalator mouths:** people join a single-file line per lane as soon as an escalator is ≤ 6 m
  ahead (ordered by distance), stand in their slot (0.66 m spacing) and step on in turn; lines close up faster when
  long; if the line is ≥ 5 and another escalator / stairs going the same way is within 13 m, people take that.
  Riders keep ~0.6 m (was 0.85).
* **Hesitating tourists step aside** to a wall first (never stop in the middle of the flow, not near ramps/gates);
  the "walk back" hesitation no longer skips the rest of their walk (old bug).
* **Unstick:** people blocked for > 0.7 s (pillar the nav grid doesn't know, two flows head-on) slide round,
  keeping left.
* **Yield to the player:** the player is a moving obstacle with real velocity: time-to-collision avoidance with a
  bigger radius and 3.5 s horizon, early drift to the free side when the player is in their lane (≤ 5 m; was a
  bug: v1 steered *towards* the player's side), slow down within 2.4 m, and a hard rule: nobody's centre comes
  within 0.62 m of the player's. すみません still fires if someone is truly blocked.
* **Queues:** gates (v1), restaurant doors (v1), and new: **café counters** — customers line up one step to the
  side of the player's order spot (so the player's spot stays free), the front one orders (~6 s, the barista
  nods / serves), then takes a seat with a cup.
* **Window shopping:** new `window` leg — people stand at shop windows (frontage, not the doorway, glass in
  front), look around, tourists take photos; part of shopping trips and of the initial fill.
* Cafés: seated customers use the real seats (`ctx.shops.seats`, v1).
* Metrics (Node, `scratch clump.mjs`, player walking back and forth, 15 s): standing clumps away from queues
  nankai_gate 4.5 → 0.8, at escalator mouths 19 → 0; city_2f 2.0 → 0.5; nobody within 0.5 m of the player.

## Item 7 — staff at counters (`js/npc/counters.js`)

For each `ctx.counters` entry within ~70 m of the player (despawn > 95 m; not when `ctx.shops.isShuttered` or the
shop is closed by hours) a staff person stands at `staff {x,z,yaw}`: barista (dark / green / brown apron, some
caps), chef (whites + cap), clerk (polo + apron). Idle, an occasional nod or hand-over, they look at and nod to the
player walking up (≤ 3.2 m), serve the NPC ordering, and play a hand-over on `demo:order {slotId}`. They emit
nothing and don't count against the population. Generic v1 staff posts on the same spot are skipped (no doubles).
Codes defensively: `ctx.counters` may be absent, late, or edited — it is rescanned every 0.5 s.

## APIs (unchanged unless noted)

`ctx.crowd`: `count`, `densityNear`, `countNear`, `agentsNear` (pose names now also `nod`, `serve`),
`queueLength`, `seated`, `collide`, `debugText`; events `crowd:excuse`, `crowd:callout`, `crowd:gate`.
New: `ctx.crowd.humans` (the model library or null), `ctx.crowd.counterStaff`.
`demo.js` usage (Daikichi queue seeding via `director._create / P.qSlot / _onward / B.begin`, Aya dressing via
`makeLook` + `BIT`, `a.pose = WAVE`) works as before: Aya resolves to the women's suit outfit tinted mustard with
a red tote and long dark hair, and waves with the real Wave clip.

## Requests

* **Movement / lead:** if you want the player to physically bump into people, call `ctx.crowd.collide(body)` after
  `world.move` (NPCs already never come closer than 0.62 m).
* **World / lead:** small pillars / kiosks added with `world.addBox` that don't cover a cell centre are invisible
  to the nav grid; people now slide round them, but marking them in `blocked` would route them cleanly.

## Status / what I'm unsure about

See the bottom of this file (updated at the end of the round).
