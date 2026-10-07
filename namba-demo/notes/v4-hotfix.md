# v4 hotfix — invisible accessories, lunch escalator blob

Files: `js/npc/humans.js`, `js/npc/humanMat.js` (v1 fallback, same bug class), `js/npc/trips.js`, `js/npc/flowprobe.mjs` (`--max`).
Nothing outside `js/npc/` was touched (the lighting hook `render/lighting/inject.js` is innocent, see below).
Shots: `notes/v4-shots/hotfix/` (`before_*` = the deployed v4 `humans.js` served in place of the fixed one, same staging).

## 1. Accessories (phone, bags, briefcase, backpack, cap, mask, cup...) never drawn

### Root cause: float32 rounding in the accessory switch (`humans.js` `crowdHidden`)

Accessory vertices carry `aPart = bit + 1`; the vertex shader collapses a part unless its bit is set in `flags & crMask`:

```glsl
int f = int(flags + 0.5) & int(crMask + 0.5);   // v4
```

`crMask` is the per-outfit "parts this outfit can show" mask: `0xffffff` (16 777 215) for every outfit except the backpackers.
`16777215.0 + 0.5` is not representable in float32 (spacing is 1.0 just below 2^24) and rounds ties-to-even to **16 777 216 =
1 << 24**, so `int(crMask + 0.5)` = `0x1000000` and `f` has **no bits 0..23 set: every accessory of every non-backpacker outfit
was collapsed, near (SkinnedMesh) AND far (instanced)** — the same function is used by both materials. Backpacker outfits
(`0xfffffb` → `0xfffffc`) did show their accessories, except briefcase / shoulder bag (bits 0, 1 eaten by the rounding). The same
`+ 0.5` on `flags` also corrupted any odd flag word ≥ 2^23 (e.g. GLASSES + BRIEFCASE).

This is why the critic's forced 0.45 m white phone with `_flags = () => 0xffffff` still drew nothing: the uniform side was
always zero, whatever the flags or geometry.

**Evidence** — standalone repro (scratch `maskrepro.mjs`: one-pixel WebGL2 draw in headless Chromium/SwiftShader, the exact expression,
`PHONE` flag set, mask read back from the pixel):

| crMask | expression | phone hidden? | mask seen by the GPU |
|---|---|---|---|
| 0xffffff (all non-backpacker outfits) | `int(crMask + 0.5)` (v4) | **yes** | `0x0` (i.e. 0x1000000) |
| 0xffffff | `int(round(crMask))` (fix) | no | `0xffffff` |
| 0xfffffb (backpackers) | `int(crMask + 0.5)` (v4) | no | `0xfffffc` |
| 0xfffffb | `int(round(crMask))` | no | `0xfffffb` |

Other suspects ruled out: the lighting hook only patches the fragment shader and the crowd material's own
`customProgramCacheKey` overrides the prototype one (programs in `renderer.info.programs`: `crowd_person`, `crowd_person_fade`,
`crowd_people_far`, `crowd_people_far_fade`, all compiling and in use); the accessory triangles are in the near geometry
(`_withAccessories`), `frustumCulled = false`, skin indices are the template skeleton's.

### Fix

* `crowdHidden`: `int(round(flags)) & int(round(crMask))` (exact for integers ≤ 2^24); same for `aPart`. `humanMat.js` (v1
  fallback renderer) had the same `int(iLook.z + 0.5)` on the flag word: fixed the same way.
* Phone prop (now that it renders, it was still hard to see): the box's long side ran along the fingers, so in the phone poses
  the whole phone hid behind the mitten hand, and it was near-black on dark suits. It is now gripped across the palm (long side
  across the hand, sticking out ~3 cm both sides) in a graphite-silver case (new accessory colour `phone`).

### Proof (headless SwiftShader, quality=high, 12:10, CITY 2F mall; people staged 2–2.6 m in front of the camera with a forced clip)

| shot | what you see |
|---|---|
| `before_bags_near.png` / `bags_near.png` | v4: briefcase, shopping bags, shoulder bag, tote, cup, mask, cap absent → all drawn (backpack, cap, mask, tote, both bags) |
| `before_bags_far.png` / `bags_far.png` | same people forced to the far (instanced, GPU-skinned) LOD: same accessories, no pop |
| `before_phones_near.png` / `phones_near.png` / `phones_far.png` | phone (idle-phone), phone-walk, photo, browse: v4 none → grey phone in the right hand, near and far LOD |
| `closeup_phone.png`, `closeup_phonewalk.png`, `closeup_photo.png`, `closeup_browse.png`, `closeup_briefcase.png` | ~2 m close-ups |

`ctx.errors []`, 0 console errors in all runs.

Remaining (honest): in the `phone` / `phonewalk` / `sitphone` clips the right hand is held up against the collarbone, palm to
the chest, so from straight in front the phone is mostly hidden behind the hand (a grey corner shows); it reads clearly in
`browse`, from the side and in `photo`. A better reading pose (hand ~30 cm in front of the chest, wrist supinated so the screen
faces the face) is a `_procClips` change (`phoneArm`); I tried a flatter forearm aim, it did not move the hand visibly, and
I reverted it rather than ship an unverified pose change.

## 2. Lunch blob at the CITY 2F down escalator (`esc_city_b_1`)

### Why

* **The probe under-reproduced the browser** because it ran with `crowdMax 600`; the browser at `quality=high` uses 1500
  (~600 agents). `flowprobe.mjs --max 1500` reproduces the browser exactly: max 24–27 people within 3.5 m, line 13–18, waits
  p90 45–80 s / max 85–147 s, ~0.95 boardings/s (the critic measured ~0.9/s in the browser).
* **Who rides it** (scratch `diag.mjs`, 240 s at 12:10, 1500): ~2/3 of the boarders were people the density keeper had
  **relocated** onto CITY 2F (`trips.js _keepDensity → placeNear`). Relocation moves far-away walkers *mid-trip, same destination*
  onto public nodes around the player to keep ~45 % of the population within 70 m. CITY 2F is a dead end for going down: its
  only way down is this one escalator (no stairs; the next down bank is Nankai, 230 m north). So every relocated walker heading
  to a train, a 1F/B1 shop or a 1F exit was injected straight into the single down escalator: ~2x its ~1 person/s capacity.
* Secondary: `pickPortal` ignored distance (people leaving lunch on CITY 2F / Parks picked 1F/B1 exits by weight alone,
  ignoring the Parks south exit on their own floor), and `_onward` chose the way out from where the trip *started*.
* Not the cause: escalator direction (b_0 up / b_1 down matches demand), queue folding, lane balancing (both lanes boarded).

### Fix (`trips.js`)

1. `placeNear` traces the relocated person's route (`_firstRamp`: follow the field ≤ 400 nodes to the first ramp node) and
   only places them there if that ramp end has room (`_rampRoom`): fewer than 4 waiting (8 for stairs) and ≤ 14 relocations
   routed into that escalator end in the last 40 s (20 for stairs).
2. A solo walker who would have been rejected gets a **same-floor errand** instead (`_localErrand`: a shop window / browse or
   a café within 10–60 m on the player's floor, then onward) — they were never seen, so re-planning is invisible, and the floor
   stays as lively as before (browser: `counts.near` 220 vs target 216) without feeding the line.
3. `pickPortal` weights exits by distance (+30 m for a floor change) from where the errand ends (`_onward` passes the last
   shop / restaurant), so people leaving CITY 2F / Parks often use `parks_south` (2F) instead of queueing to go down.

### Numbers (flowprobe, seed 1; before = deployed v4, after = this hotfix)

Browser population (`--max 1500`, = quality high):

| scenario (worst ramp end) | max density (3.5 m) before → after | longest line | boarded | wait median / p90 / max (s) before → after |
|---|---|---|---|---|
| CITY 2F lunch 12:10, 240 s | **27 → 10** | 18 → 7 | 198 → 76 | 15.5 / 79.8 / 147.1 → 6.4 / 11.1 / 18.8 |
| Nankai 3F start (11:20, walk) | 16 → 7 | 16 → 6 | 67 → 40 | 7.4 / 11.6 / 15.5 → 6.1 / 8.8 / 11.7 |
| Nankai 3F/2F lunch | 31 → 12 | 22 → 9 | 91 → 40 | 6.5 / 16.2 / 75 → 6.5 / 20.5 / 36 (stairs `esc_nk_4_2`, see below) |
| CITY B1 → 1F | 26 → 12 | 17 → 5 | 69 → 27 | 18.2 / 50.2 / 67.5 → 6.6 / 9.2 / 13.6 |
| CITY 1F | 16 → 6 | 9 → 4 | 47 → 13 | 6 / 12.6 / 19.2 → 5.3 / 9.1 / 9.2 |
| Parks canyon 2F → 3F | 24 → 11 | 10 → 6 | 83 → 36 | 7.7 / 21 / 42.6 → 6.7 / 10.7 / 21.1 |
| Midosuji B2 | 24 → 10 | 13 → 6 | 62 → 34 | 6.3 / 12.7 / 30.2 → 7 / 8.7 / 10 |

Default probe population (`--max 600`, the v4-crowd table's setting): no regressions — Nankai 3F start 7 → 8 (line 7 → 8, worst
wait 11.6 → 12.6 s), Nankai lunch 13 → 7, CITY B1 7 → 9, CITY 1F 10 → 6, CITY 2F (240 s) 9 → 8 (worst wait 18.2 → 12.4 s),
canyon 8 → 7, Midosuji 13 → 10.

Three more seeds of CITY 2F lunch at 1500: max density 10 / 10 / 11, p90 wait 9.5–11.1 s. The few waits > 15 s are group
followers (they start their wait when the leader joins, up to 14 m back), not single people in a stuck line.

**Browser check** (`?time=12:10&quality=high`, player at the CITY 2F escalator, 180 s of sim, 600 agents): people within 3.5 m
of the `esc_city_b_1` head every 15 s: 0, 5, 2, 3, 2, 3, 5, 2, 2, 3, 0, 1 (v4 critic: 23 → 41 queued); 44 boardings, wait median
6.0 s / p90 11.0 s / max 14.5 s; density around the player 220 within 70 m (target 216). Shot `city_esc_lunch_after.png`.
`ctx.errors []`, 0 console errors.

Watch item: with the escalator lines gone, more people use the Nankai 3F stairs (`esc_nk_4_2`) at lunch; the stairs line peaks
at 9 with p90 20 s (stairs are single-file at the mouth in the sim). Not near the demo route at 11:20.

## Checks

* `node tools/loadprobe.mjs`: READY 12.0 s, no errors (only the sandbox Google-Fonts certificate error).
* `node tools/shot.mjs --views start,city_2f --time 12:10`: loads in 13.9 s, start 723 calls / 999k tris, city_2f 554 calls / 361k
  tris; console: only the font certificate error and SwiftShader `ReadPixels` stall warnings.
* All accessory / lunch browser runs: `ctx.errors []`, 0 console errors. `node --check` on the changed modules.
* Scripts (scratchpad, not in the repo): `maskrepro.mjs` (GPU repro), `acc.mjs` (staged accessory shots, `BEFORE=1` serves the
  git-HEAD `humans.js`), `lunch.mjs` (browser lunch count), `diag.mjs` (who boards `esc_city_b_1`), `scen.sh` (all flowprobe
  scenarios against a HEAD copy and the working tree).
