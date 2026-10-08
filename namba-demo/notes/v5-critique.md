# v5 critique (critic + fixer)

Evidence: `notes/v5-shots/critic/` (`walk_*` = run 1 before my fixes, `walk2_*` = run 2 after; `c*` = UI probe;
`board_*` + `sheet_board_*` = in-browser boarding probes). Bot: `node tools/walk.mjs` (default = coffee leg + canyon loop),
quality low, crowd on. Probe script: scratchpad `critic/ui.mjs` (Maps link → place card, glance sides, Lodestone end/new/arrive,
link → preview → Go, stray-step check, café, canyon poses).

## Scorecard (before → after my fixes)

| # | Item | Before | After | Evidence |
|---|---|---|---|---|
| 1 | Compass + next milestone | **fixed**, one stray: "Escalator down · 4F → 3F" flashed at the Parks 3F foot (and "Escalator down · 2F → 1F" at the café exit) | **fixed** | `walk_09g-glance-151/211`, `walk_09-canyon` (`Stairs up — straight ahead · In 15 m · to 3F`), `c03_glance_side_{ahead,left,right}` + `c03_glance_side_left_full` (arrow ↖, escalator visibly on the left), `c15_parks3F_esc_foot`. Walk 2 TBT at (-1, 240): `Turn left` → `Escalators up 3F→6F` (run 1: `Escalator down 4F→3F` ×2) |
| 2 | Escalator boarding smooth | fixed (Nankai only in browser) | **fixed**, now browser-checked at CITY and Parks too | Parks `esc_pk_34_0` low end: 3 boardings, max step 0.027 m/frame, max yaw 345°/s, 0 frames over 0.15 m or 360°/s, `walk>ride` cross-fade. CITY `esc_city_b_0` low end: 4 boardings, max step 0.029 m, max yaw 196°/s, 0 pops. `sheet_board_city.png` / `sheet_board_parks.png` show the approach (the shot sequence ends before step-on, same SwiftShader limit the crowd agent hit; the per-frame numbers are the proof) |
| 4 | Canyon detour | fixed (loop) | **fixed** | `walk_09-canyon` (garden stairs ahead), `c14_garden_stairs_top`, `walk_09b-glass-bridge`; TBT: canyon → stairs 2F→3F → glass bridge → 3F→6F, nothing walked twice. Aya's canyon text arrives at the bridge. |
| 5 | Aya's place links | fixed, but Maps' **Directions sat below the fold** (`nav/02`) | **fixed** | `c01_link_cards_maps`, `c02_maps_placecard_after` (Directions + `Enter` cap visible: button 613–647 px, dock top 662), `c11_link_cards_lodestone`, `c12_lodestone_preview` (big Go ⏎); events `phone:link` → `nav:destination {via:'link', suggested:true}` in both apps |
| 6 | Lodestone End / New place | fixed | **fixed** (one cosmetic open item) | `c05` → X → `c06_lodestone_ended` ("Where to?", Aya's pick row 1) → `c07_glance_no_route` ("No route · Where to? · Aya: Café Mitsubachi") → `/` "ramen" `c08` → Enter → `c09` → teleport to door → `nav:arrived` (`c10`). Events: `nav:end` → `nav:destination(list)` → `nav:arrived` |
| 3 | Square hats | shipped in v4.3 | — | not re-graded |

Other checks
- **Trip:** run 1 8:17 · 658 m; run 2 (after fixes) **8:09 · 654 m** (nav agent's run was 8:22). Comfortably in 5–10 min.
- **Canyon snag:** the bot now loses 2 s at the garden-stairs top (52.5, 225.6) and 6 s at the Parks 3F foot. The 6 s (and a
  13 s one at the CITY 1F café exit) is the bot steering into the **down** lane's exit mouth beside the up lane, being carried
  back off it, and retrying. A person picks the up lane; I left geometry alone. The garden stairs top (`c14`) has a clear exit.
- **Diners:** the probe counted 14 seated and 23 mid-ease (`seatK < 1`) agents. `walk_12-arrive-aya` shows seated diners
  next to Daikichi and they look right. Café Mitsubachi was empty at that moment (`c13`), so I have **no close-up of
  someone sitting down**. The crowd agent's per-frame probe (0 yaw jumps > 400°/s) is the evidence for the easing.
- **loadprobe:** `READY 117.9s []` (SwiftShader, 2 browsers running). ctx.errors `[]` in every run. Console: 0, apart from the
  bot's own two `dbg` lines.
- **First 5 minutes:**
  - title, intro and Aya's first texts are good;
  - the Maps pick goes through the "From Aya" row; the Maps frustration (`walk_04`) shows the floor-only route and "directions
    for the remaining floors will appear…";
  - Aya's offer card, install, calibration and "You're on 2F" all work;
  - the ready card shows the escalator step with `PAST Bunko Hitotsubashi · 15 m`.

  Nothing regressed.

## Fixes (files)

| File | Change |
|---|---|
| `js/ui/phone/guidance.js` | If you are on a ramp with less than 2.5 m of it left (you have brushed the down lane's exit mouth, or are stepping off), no ramp maneuver is emitted. The geometry is kept. This removes the 1–2 s "Escalator down · 4F → 3F" / "2F → 1F" flashes. Riding mid-ramp is unchanged: the down lane's top still says "Escalator down 4F → 3F" when you really are on it (probe). |
| `js/ui/phone/mapapp.js`, `css/phone.css` | Maps place card now follows Google-Maps order: name → rating → floor/distance → open → **Directions / Save / Share** → photo → popular times → reviews. The primary action (and its `Enter` cap) is on screen without scrolling. The photo moved below (`.mp-photo-in`, 104 px). |
| `js/ui/phone/lodestone.js` | `nav:milestone` was firing every ~2 s on a long leg ("passage Namba Parks 68 m, 66, 63…"). The cause: its identity key used 1 m-rounded positions of a zone-entry point that drifts per recompute. The key now uses 8 m buckets plus the level, per the "on change only" contract. (I briefly broke this line with an inline comment that swallowed `: ''`. I caught it in the second walk's load (ctx.errors), fixed it, parse-checked it, and the full re-walk is clean.) |

## What remains (honest)

- **Lodestone 3D preview blank after "New place" search.** After `/` → type → Enter, the instruction card and trip card
  update, but the 3D band stays empty (`c09_lodestone_new_route`, reproduced twice, even after 12 extra frames). Picking from
  the list with `1` in the real walk renders fine (`walk_p2b`, `walk2_p2b`). It may be a probe artefact (phone opened and
  searched within the same tick), but it is unproven either way. Needs one human try: Lodestone → `/` → "ramen" → Enter.
- **Arrow vs words near a turn.** When the player is not facing along the path, the glance can say "Turn left · in 5 m"
  while the arrow points right (nav `21`). Both are right: the word is relative to the path, the arrow to you. It can
  still read as a contradiction. The arrow should win: maybe show "Turn left" only when roughly aligned.
- **Bot down-lane mouth retries** (above). A player who walks into the down lane's exit gets pushed back, which is realistic.
- **Boarding frame sequence:** no screenshot of the actual step-on moment at CITY/Parks (SwiftShader timing). The numbers are clean.
- **Nobody seen sitting down at close range.** See above.
- Real-GPU frame rate and crowd density are still unmeasured.

## Would this impress the team? **7.5 / 10**

The compass + milestone glance ("Escalator down — on your left · In 25 m · to 1F" with a live arrow) reads like a real product. The
canyon loop is now a purposeful scenic climb with a glass-bridge payoff. Aya's link cards feel like a real messenger, and
Lodestone's End/New controls make it feel like a complete app. Held back by low-quality visuals in headless captures (strata
banding on the canyon walls), a few UX seams (the arrow/turn wording, the unverified search preview), and no real-GPU data.

## Top 3 risks

1. **Lodestone search → blank 3D preview** (if it's real, a reviewer who tries "New place" sees an empty map at the climax app).
2. **Real-GPU performance / crowd density** never measured; the canyon + 3F garden are the heaviest views on the route.
3. **Glance wording contradictions** near turns (arrow right, "Turn left") when the player faces away from the path.
   Rare in a forward walk, but this is the first thing an indoor-nav team will poke at.
