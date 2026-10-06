# v2 critique — harsh critic + fixer

Played headless end to end (SwiftShader, `quality=low`, walk bot driving real input along the nav field):
title → Nankai 3F (rapi:t) → walkthrough cards → wandering with Maps (offer fired at t=110 s, "stalled") → install →
calibration → reveal → Namba CITY 2F → Parks → escalators 2F→6F → Daikichi (arrive t=391 s) → end card.
**Route intact, upgrade moment intact, end card intact, `ctx.errors` [] and zero console errors in every run**
(walk, phone/order/memory probe, verify probe; the only noise is the sandbox's Google Fonts cert error).
Separate `tools/shot.mjs` wide shots at `medium` for people / pits / Parks / canyon.
Evidence: `notes/v2-shots/critic/`.

## Scorecard (before my fixes → after)

| # | Item | Before | After | Evidence |
|---|---|---|---|---|
| 1 | Floor seen through track pits | fixed | fixed | `item01_track_pits_bed.png` (full-width ballast bed, no gap; my own pit poses at 11:25 were all occluded by parked trains) |
| 2 | PA "broken Japanese" | fixed (code) | fixed (code) | `js/audio/announcer.js`: real `speechSynthesis` ja-JP then en-*, chime + caption fallback, no formant synth. Cannot be heard headless — needs one human listen |
| 3 | Train PA only on platforms / area beds | fixed (code) | fixed (code) | `audio.paVolume` → per-platform gain; HUD captions only what is audible. Same caveat |
| 4 | Pixelated posters | fixed | fixed | `item04_column_ad.png` (crisp at 1.5 m) |
| 5 | Playmobil people | fixed | fixed | `item05_people_city2f.png`, `start_9s_passengers.png` — CC0 Quaternius, proportioned, real silhouettes; stylised, not photoreal |
| 6 | Cafés like classrooms | partly | mostly | Pine Tree is believable (`item06_pinetree_from_corridor.png`: window bar, counter, menu boards). Sunny Side before: a 14 m-deep, sparsely furnished hall (`item06_sunny_side_interior.png`). After: 10–11 m with a kitchen pass in the back wall and more tables (`item06_sunny_side_after.png`, `_after_b.png`, `_order.png`). Still a little "rows of 2-tops" when nobody is seated |
| 7 | Nobody to order from | partly | fixed | `order_pinetree_paid.png` / `item07_order_ic_paid.png`: barista behind the counter, prompt "Order a coffee ☕", hand-over. Staff were short behind deep counters; chip said "運賃 Fare" for a latte |
| 8 | Crowds clump / empty / run into you | partly | partly+ | `item08_wide_route_people.png`. Before: the opening platform was almost empty (1–3 people), Nankai gates and CITY 2F empty at lunch on low/medium. After: the rapi:t's passengers step off with you (`start_9s_passengers.png`), population +22 %. Teleport shots still show a clump at the CITY 2F escalator foot and an empty Parks 2F hall (partly a teleport-refill artifact) |
| 9 | Controls walkthrough | fixed | fixed | `item09_walkthrough.png` (4 cards, X skip works, Q/right-click match the phone) |
| 10 | Phone app simpler | fixed | fixed | `item10_maps_glance.png`, `item10_offer_up.png` |
| 11 | Phone blocks vision | fixed | fixed | `item11_glance_live_walk.png`, `lode_glance_*.png`: **verified live** — the glance card is clean, no "Take the…" peeking under it |
| 12 | Lodestone helpful / digestible | partly | fixed | Before: `notes/v2-shots/phone/after_10_lode_up.png` (stack preview full of chips: ▼2F ▲6F Canyon + every floor label, labels running under the trip card). After: `lode_up_city2f.png`, `item12_lode_up_nankai3f_final.png` — one instruction, a calm preview with only the route + destination, trip card clear |

## What I fixed (files)

- **ICOCA chip** (`js/ui/hud.js`, `js/game/order.js`, `js/game/vignettes.js`): `hud.ic({label})`; café / vignette purchases now read **お支払い Paid**, train fares keep 運賃 Fare.
- **Counter staff read as sunk** (`js/npc/counters.js`): staff were the plain look height (women 1.58 m) behind a pastry case + back bar; counter staff now never below ~1.63–1.66 m. Placement (staff.y = floor, waist at counter height) was already correct.
- **Lodestone preview clutter** (`js/ui/phone/stack3d.js`, `js/ui/phone/lodestone.js`, `css/phone.css`):
  `Stack3D.compact` (guide view) hides the escalator/canyon chips and every floor label except your floor and the destination floor;
  the 3D canvas is masked to its free band (soft 18 px fade) in both views, so nothing ever draws under the instruction card,
  the trip card or the 3D-view controls. The full 3D view (V / tap) keeps all chips and labels.
- **Empty opening platform** (`js/game/demo.js`, `js/npc/trips.js`): at begin the director gets a forced `onTrainArrive` for
  `nk_track_4` (the rapi:t): ~25 passengers step out of its doors over ~15 s and head for the gates (`force` bypasses the
  population cap for 24 s only).
- **Sunny Side Café / deep cafés** (`js/world/env/cafe.js`): cafés ≥ 9 m wide and > 14 m deep are sealed at 10–11 m
  instead of 12–14 m (Sunny Side 11 × 25 m slot: 14 → 10–11 m). The template's reachability anchor (the directory's centre
  cell, which sat 12.5 m deep) moves in front of the new back wall. The back wall gets a warm-lit **kitchen pass-through** on the
  counter side (steel sill, plates waiting, heat lamps, KITCHEN sign). Table density /15 → /11 (max 10), placement tries 60 → 140.
  Counter, order spot (`ctx.counters` city_2nw06 unchanged) and barista verified in-game. All wide deep cafés' seeded layouts reshuffle.
- **Population** (`js/npc/trips.js`): `DEMO_POP` 0.36 → 0.44 (sim cost ~2 ms at 425 agents; skinned near-LOD count unchanged).

Not changed after checking: escalators — `ESC_STAND_SIDE = +1`, lane offset = right of travel (verified the vector maths),
stairs follow the same side, the `ride` clip puts the right hand on the rail (`R` bone, outward sign consistent with the
glTF +Z-forward rig). No copy mentions a side.

## Health

- Memory across the route (Lodestone installed, phone raised/lowered at Nankai 3F, CITY 2F, canyon, Parks 6F, back to CITY 2F):
  largest Chromium process 1.54 → 1.72 → 1.66 GB, JS heap flat at 391 MB, geometries plateau (~2 000) once the Parks is streamed.
  No leak; the earlier 3.5–6.8 GB kills were the machine running 3–4 agents' browsers. (Walk run: total Chrome 6.6–7.2 GB **with
  three of my browsers alive at once**.)
- Final verify probe: ICOCA chip reads `お支払い Paid −¥580` for a latte; escalator riders' lane offsets all `+0.24` (stand
  right) with one walker at `−0.24` (`esc_parks_standright.png`); Lodestone final shots `item12_*`; `ctx.errors` [] and 0
  console issues in every run.
- `tools/loadprobe.mjs`: **READY 12.9 s, errs []** (final, after every change; 32.4 s while two other headless browsers ran).

## What remains (honest)

1. **People density / placement is still the weakest item.** Corridors at `low` (phones) are near-empty; on `medium` a
   teleport view shows a clump at the CITY 2F escalator foot and an empty Parks 2F hall. I could only judge `high` from the
   Humans agent's shots. Worth one real-GPU walk at `high` before sending.
2. **Sunny Side Café** is now a normal-sized room with a kitchen, but with nobody seated its free-standing 2-tops still line
   up a little. Seated customers (crowd) carry it on `high`; a rug + one more banquette module would finish it.
   CITY 2F escalator-foot clump: not fixed (no cheap, safe change found in the time; likely the single-file escalator
   admission queue on 1 m-wide escalators).
3. **Audio is unverified by ear** (speech voice choice, PA levels vs. beds). Needs 2 minutes on a real Chrome + Safari.
4. Lodestone guidance said "Walk out into the canyon" while my bot (own nav field) took the indoor Parks route — fine for
   players, but the canyon is only seen if the player follows the phone.
5. Minor: the phone "up" pose at 16:9 short viewports (≤ 600 px tall) leaves ~8 px under the trip card.

## Would this impress the team? **8 / 10** (8.5 if the high-tier crowd holds up on a real GPU)

The opening (busy rapi:t platform, walkthrough, Aya's texts), the Maps frustration, the install/calibration and the
calm one-instruction Lodestone are product-grade; the end card lands. Top 3 risks:
1. Sparse or clumped crowds on someone's laptop tier (the world feels empty → "demo-ish").
2. A browser with no ja-JP voice (Firefox/Linux) → chime + captions only; or a voice that sounds off.
3. Frame rate at `high` on an integrated GPU with 30+ skinned people + SSR/SSAO (unmeasurable here).
