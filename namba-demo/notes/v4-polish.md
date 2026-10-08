# v4.3 polish — arrival, names, hints, phones, bags/caps, court ceiling

Files: `js/game/demo.js`, `js/game/aya.js`, `js/ui/phone/glance.js`, `css/phone.css`, `js/game/tutorial.js`, `css/game.css`,
`js/npc/humans.js`. Nothing in `../namba/`, `layout.js`, `world.js`, `nav.js`.
Shots: `notes/v4-shots/polish/` (before = the critic's `notes/v4-shots/critic/*` and the v4.1/v4.2 `notes/v4-shots/hotfix/v41_*`).
Probes (scratchpad, not in the repo): `polish/arr.mjs` (arrival, slow-motion real clock), `polish/acc.mjs` (accessory
close-ups; `BEFORE=1` serves the pre-polish humans.js), `polish/ui.mjs` (trip card / glance / tutorial hint), `polish/court.mjs`
(court ceiling + diagnostics), `polish/grid.mjs` (node dump of the court cells).

## 1. Arrival moment (the climax)

* **Glance strip**: `Glance` listens for `demo:arrive` and from that frame shows **"You’ve arrived · Tempura Daikichi"** (check
  icon, Lodestone amber or Maps blue). Aya's text notification still takes the strip while it is fresh (that IS the payoff
  line), then it falls back to the arrival card. A new pick in free roam (`nav:destination`) clears it.
* **Payoff on real time**: the cut-scene itself runs on real `sleep()`s, but the payoff text went through Aya's outbox
  (game time + 1.2 s wait + ~2 s typing) and the thanks caption through `game.after` (game time). With slow frames game time
  crawls, so the end card came first. Now both are `setTimeout`s inside the cut-scene: text at +0.7 s after Aya appears
  (`aya.sayNow()`: new, sends immediately outside the queue), **"ありがとう〜！ Thank youuu! 🥤"** caption at +1.5 s for 3.6 s,
  cup leaves the HUD; no-coffee tease at +2.3 s.
* **Verified** (`arr.mjs`: Lodestone ready, destination Daikichi, latte in hand, ~10 m from the door, `demo.arrive()`; the
  real clock is slowed ×8 for the probe, game time is not, so this is the slow-machine worst case). In-page log, cut-scene seconds:
  `0.07 You’ve arrived · Tempura Daikichi` → `0.36 caption Over here!` → `0.98 glance: Aya "THERE you are 🥹 and you brought my
  latte??…"` → `1.86 caption ありがとう〜！ Thank youuu! 🥤` (both captions on) → `3.45 Chef` → `5.88 end card`. Shots
  `arr_after_0400.png` (arrival card), `arr_after_1800.png` (Aya + text), `arr_after_3000.png` (thanks caption), `arr_after_9_end.png`.
  (The probe's slow-motion compresses the 2.1 s walk, which measures `performance.now()`, so the end card shows at 5.9 s
  instead of 7.7 s; on real time everything lands ~1.8 s later, still before the card.) `ctx.errors []`, 0 console issues.
  Before: `critic/walk_c1-12-arrive-aya.png` ("Daikichi on your right · In 5 m", no thanks caption).

## 2. Long names on the Lodestone trip card

The ETA ("7 min" / the leg time after arrival) moved up beside "Destination · Change", so the destination name gets the whole
row, and it may wrap to a second line (`-webkit-line-clamp: 2`, `overflow-wrap: anywhere`) instead of "Tempura Da…" /
"Café Mitsub…". CSS only (`css/phone.css`, end of file). The card only grows (upward) for names that really need 2 lines.
Maps: the Next chip already hid "from Aya" (v4.2) so "Tempura Daikichi" fits; the route sheet says "to Café Mitsubachi · 1F"
in full. Glance strip titles were already 2-line; subtitles are short. Shots: `ui_lode_cafe.png`, `ui_lode_daikichi.png`,
`ui_lode_long.png` (longest directory name), `ui_maps_route_next.png`, `ui_glance_*.png` (see "verification status" below).

## 3. Tutorial hints never cover the raised phone

`tutorial.js _render`: while the phone is up (`phone.isOpen` / pose `up`) a hint whose anchor is not `phoneup` gets the class
`ph-up`, which moves it left of the phone (`right: calc(50% + 14px)`, the raised phone sits right of the crosshair); on narrow
screens (≤ 860 px) it goes to the top centre like the `phoneup` hints. It slides back when the phone is lowered (CSS transition).
Shot `ui_tip_phone_up.png`.

## 4. NPC phones read as lit phones

* New accessory colour `screen` (`TINT.SCREEN` = 12): the phone's screen face is a dim diffuse surface plus a low self-glow
  (cool white-blue `#a9c4ea`, emissive 0.55 × colour, diffuse × 0.3), injected at `emissivemap_fragment` in both the near
  (SkinnedMesh) and far (instanced, baked-bone) crowd materials, so far LOD shows it too.
* `phoneArm` (phone / phonewalk / sitphone / sitphone2): the palm (screen) now faces up and a little forward
  (`palmTo('R', 1, V(0, 1, 0.38))`) instead of straight at the eyes: still readable for its owner with the head bowed, and the
  lit screen faces people in front. Photo pose unchanged (its screen faces the subject — v4.2's choice, now lit).
* `MAX_MATS` 24 → 28 (the worst outfit used 23; screen + cap make 25).
* Shots: `after_closeup_phone_front.png` (head-on, dark suit: the blue screen reads clearly), `after_closeup_phone.png`,
  `after_closeup_phonewalk.png`, `after_phones_near.png` / `after_phones_far.png` (same at far LOD).
  Before: `hotfix/v41_closeup_phone.png`, `hotfix/v41_phones_near.png`.

## 5. Tote, shoulder bag, cap

* **Shoulder bag**: bevelled satchel (0.075 × 0.2 × 0.26) with a flap and a clasp on the left hip, cross-body strap as a chain
  of flat bars following the measured body surface (bag → across the chest → over the right shoulder → down the back → bag),
  new `seg()` helper (bar between two points, flat side along the surface normal). ~250 tris.
* **Tote**: thin, bevelled, tapered (wider at the mouth) bag at the left hip, two flat handles up to the left shoulder top. ~150 tris.
* **Cap** (lead follow-up, "hats look square"): a low-poly dome crown (hemisphere, 10 × 4 segments, 0.24 × 0.10 × 0.26 m) sitting
  on the head (base 0.205 m above the head bone, covers the hair top), a half-disc brim curving down 0.2 rad, ~0.08 m past the
  crown front, and a top button. ~110 tris (old: 24). New colour `cap` (`TINT.CAP` = 13): the outfit's acc2 colour, 45 %
  desaturated and darkened 20 %, so caps are muted (navy / grey / khaki; the kids' yellow caps become mustard). CAP is the only
  hat type in `looks.js`.
* Shots: `after2_closeup_cap_front.png`, `after2_closeup_cap_34.png`, `after2_closeup_cap_side.png`, `after2_closeup_tote*.png`,
  `after_closeup_shoulderbag*.png`, `after_bags_near.png` / `after_bags_far.png`. Before: `hotfix/v41_bags_near.png`.
  The far (lod2) mesh keeps the "big" parts only, as before (tote yes; shoulder bag / cap no).

## 6. 1F court ceiling over the void — not the light field: z-fighting

Diagnosis (`court.mjs diag`, view `1F,6,60,0,30`): turning the light-field AO off left the patches unchanged
(`court_before_a_noao.png`); hiding every 2F mesh removed them (`court_before_a_no2f.png`). The court's ceiling is
`ceil 6` on 1F (y 0), i.e. exactly at the 2F floor (y 6), so it z-fought with down-facing 2F slab geometry at the same height;
the ragged, view-dependent strips looked like light-field cells. Fix (`js/world/arch/ceilings.js`, 2 lines): a ceiling is kept
3 cm under the next level's floor (`H = min(y + ceil, y(above) - 0.03)`); applies to any space whose ceiling reaches the
slab above. After: `court_after_a.png` (clean), `court_after_b.png` / `court_after_c.png` (no change elsewhere, vs `court_before_*`).
Residual: a 1 px horizontal sliver at the far-left of `court_after_a` (a ceiling step face now 3 cm proud) — barely visible.

## Status per item

| # | item | status |
|---|---|---|
| 1 | Arrival glance + coffee payoff on real time | **done**, verified (arr.mjs log + shots) |
| 2 | Lodestone trip card long names | **done (CSS), not screenshot-verified** — the `ui.mjs` run timed out waiting for the intro to end (headless game time); needs one look at `ui_lode_*` in v5 |
| 3 | Tutorial hint steps aside while the phone is up | **done (code), not screenshot-verified** — same `ui.mjs` run |
| 4 | NPC phone lit screen + tilt | **done**, verified near + far LOD |
| 5 | Tote / shoulder bag / cap (+ lead's "square hats") | **done**, verified front / side / 3/4 close-ups + near/far group shots |
| 6 | Court ceiling patches | **done** (z-fight, not light field), verified |

## Checks
* `node tools/loadprobe.mjs`: READY, errors `[]` (first frame 144 s: SwiftShader with a second browser running).
* Every probe run: `ctx.errors []`, 0 console issues (sandbox font cert error excluded). Crowd programs unchanged
  (`crowd_person`, `crowd_person_fade`, `crowd_people_far`, `crowd_people_far_fade`).
* Not run: the full walk bot (`critic-demo/walk.mjs`) and `tools/shot.mjs` — out of time; the arrival path was exercised by
  `arr.mjs` instead.

## Unsure / for v5
* Item 2/3 visuals unverified (see table). Risk is low (CSS only; the tip uses existing anchor styles).
* The `photo` pose's lit screen faces the subject (v4.2 pose turns the palm out); a real photo-taker's screen faces them.
* `ui.mjs` / `arr.mjs` need the title click + intro end; `arr.mjs` worked (intro ended at ~380 s), `ui.mjs` (nocrowd) did not
  within 400 s — probably the `&tutorial` / nocrowd intro path; worth a look before reuse.
* `aya.sayNow()` bypasses the outbox (no typing beat) — used only in the arrival cut-scene.
