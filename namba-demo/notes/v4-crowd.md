# v4 — Crowd agent (item 2 phones, item 3 seated people, escalator clump / flow)

Owned files touched: `js/npc/humans.js`, `render.js`, `sim.js`, `behave.js`, `trips.js`, `places.js`, new `js/npc/flowprobe.mjs`.
No other file was edited (see "Requests" for two small changes that belong to Shells).

## Item 2 — phones with no phone in the hand

Two independent causes, both fixed.

1. **The prop was never where the hand is** (`humans.js _accessories`). The accessory parts are authored around the idle pose, but
   the sampler skeleton was still in the pose of the last procedural clip built (`ride`, which bends the right arm onto the
   handrail). `_pose(idle, 0)` saw "same clip, same time as the last evaluation" and the AnimationMixer skipped rewriting the arm
   (the same "only write what changed" shortcut that caused v3's spinning heads). So every right-hand prop (phone, briefcase,
   second shopping bag) was built at the *ride* hand position, **0.285 m in front of the real hand** in every clip. Measured
   (`js/npc/…` skinned-vertex dump, phone centroid to WristR): 0.285 m in idle / phone / photo / browse before, **0.097 m (palm)** after.
   The same stale-pose shortcut also affected the first key of every procedural clip with the same base clip (`_resample`):
   now invalidated at the start of each clip.
2. **The flag and the clip disagreed** (`render.js`). The phone prop is switched by a per-person bit (`BIT.PHONE`) that behave.js sets
   in some places (`a.dyn |= ...`) but not in others: escalator riders (`render._clipFor` picks `phone` when `phoneUser > 0.55`),
   hesitating tourists, phone users at gates / in queues, café "phone" seats ... all played the `phone` clip with the bit unset.
   Now `CrowdRenderer._flags(a)` derives the bit from the clip that is actually playing (`phone`, `phonewalk`, `photo`, `browse`,
   the new `sitphone`; also while it is blending out). Near (SkinnedMesh) and far (instanced) both read `_flags`, so they always agree.
   The look's own phone flag (Aya etc.) still works.

## Item 3 — seated / eating people

What the screenshot showed and why:

| symptom | cause | fix |
|---|---|---|
| legs through the chair / straight out, hovering | the rig's feet are IK controls (`FootL/FootR` children of `Root`, not of the shin). The old `sit` clip aimed the shin at the *planted* foot (so it pointed diagonally) and left the foot under the hip | seated clips aim the shin along its own rest axis and move the foot control to the shin's end (`humans.js sitPose`, feet baked as position tracks) |
| bodies "sideways"/hovering on stools | one chair-height sit for everything (hips 0.57 m) on seats that are 0.5 (chair) ... 0.82 m (bar stool) | two clip families, chair (`sit/eat/sitphone`) and stool (`sit2/eat2/sitphone2`), plus per-person hip lift to the **measured** seat top (`render._anim` `_dy`, applied near and far) |
| standing pose "sitting" in mid air | cafés: 30 % of seated people used the *standing* `phone` clip; restaurants/cafés with < 3 real seats seated people on random floor cells | new `sitphone` clips; seats = real seats only (`places.spots`), people with no real seat stand and eat/phone instead (`behave._seatOn`); a sit clip is never played unless `a.seatH` > 0, otherwise `idle` |
| pushed off the seat | seated people were `MODE.STAND`, which applies personal-space repulsion | seated = rigid (`sim._move`) |
| stools 0.3 m off | environment bug: cafe.js:386-387 puts the seat spot 0.3 m from the stool it draws | `places._scanSeat` snaps to the measured furniture centre (<= 0.45 m) |

**Seat height / kind.** The seat spot (`ctx.shops.spots(slot)`, kind `seat`) carries no height, so:
`places._scanSeat` measures it from the built shop geometry (lowest flat top >= 0.43 m in a 0.36 m window around the spot: chair
0.495, stool 0.73, bar stool 0.82, sofa ~0.45) when the shop exists, and falls back to "row of 3+ same-facing seats = counter stools
(0.78), else chair (0.495)". If the spot ever provides `h` / `seatH` it is used as is. A seat where the scan finds no furniture is marked
`bad` and nobody sits there ("if a seat can't be satisfied, don't seat anyone"). People seated before the shop geometry existed (initial
fill) are measured the first time they are within 30 m of the camera (`render._anim`); a failed scan stands them up.

Clip geometry (model space, scale 1; checked with a CPU-skinned side silhouette): chair: pelvis on the seat, thighs ~6 deg down, shins
vertical, feet flat on the floor (foot y 0.046), back 0.1 m clear of the chair back; stool: pelvis 0.8, thighs 45 deg down, shins vertical,
feet 0.08 m above the floor (no footrest in the stool geometry; fine at counter distance). `eat` = the old subtle forearm/head loop
(2.4 s); arms now reach the table (chair) / counter (stool) because they are relative to the lifted body.
Cost: 4 more baked clips per rig (bone texture rows +~290).

## Clump / flow at escalators and stairs (top priority)

Measured first with `js/npc/flowprobe.mjs` (Node, same sim code, no browser): for every escalator/stair end near the viewer path,
max people within 3.5 m of the mouth/landing, longest line, time-to-board (join the line -> step on).
Reproduction of the start: transit emits **three** `train:arrive` events at game start for the Nankai platform (the player's
rapi:t `start:true`, `initial` arrivals of the other trains) and `demo.js` adds a forced one at +0.3 s. Each is a full surge (~40-50
people over 15 s). With the 100 m walk down the platform they all reach the 3F escalator head together: 30 people within 3.5 m,
22 in the line, **77 s median wait**.

Root causes found, in order of impact:

1. **The lane starved.** Two files of the line were 0.48 m apart (both lanes at +-0.24 m) and the standing personal space is 0.52, so
   neighbours pushed each other off the lane and the head of the line sat 1.4 m short of the mouth, "waiting" for 40+ s
   (`esc_city_a_0`: 9 boardings in 90 s, one person waited 73 s). Followers of a group stood in formation *between* the leader and
   the mouth, also in the lane. The head of the line was also decided by queue order, not by who is physically nearest, so
   one blocked person stopped everyone.
2. **Surges stacked**: duplicate arrival events (above) and a 15 s alighting time for 50 people.
3. Popularity weighting `pop^2` (+x2.2 / x1.8 for the quest's tempura / coffee spots = 4.8x / 3.2x a normal place) and no distance term,
   so lunch/coffee trips converged on a few places and the same stair/escalator banks.
4. Overflow (`_rampChoice`) only looked 13 m around and only at line length.

Fixes (`sim.js`, `trips.js`):

* Lines are single file at the mouth and 0.88 m apart behind it (lane x 1.85 beyond 0.3 m back); beyond 8 people a second/third file
  forms beside the first (instead of one long line into the gate flow).
* Rank = number of people of the lane physically closer to the mouth, so the nearest person always steps on next; a head stuck within
  1.8 m for 0.8 s steps on anyway; step-on zone widened (1 m along, 0.8 m across).
* Groups queue together: when the leader is in a lane's line the followers join the same line behind it (same lane) instead of
  standing between the leader and the mouth.
* Overflow by cost in seconds (0.85 s per person in line + walk time at 1.25 m/s, stairs +3 s, no stairs for elderly / suitcases) up to 18 m,
  re-checked by the tail of a line (rank >= 4) every ~2 s.
* Train surges: one surge per train (a second event for the same track within 6 s only extends the forced flag), `initial` arrivals
  (trains already at the doors when the game loads) = 25 %; 40 % of a train comes out in the first ~12 s (lively platform), the rest is
  spread over `10 + 0.7 n` s (<= 48 s) so the lanes (~1 person / 0.8 s) absorb it.
* Destination weights: `pop^1.4` capped at 1.5, divided by `1 + queue*0.2`, and by `1 + distance/90 m` (+25 m for another floor) for
  the person choosing: more local lunches, shops and coffee, fewer cross-complex trips through the same banks.

Not changed: escalator step cadence (0.7-0.95 s stand / 0.52-0.67 s walk lane; ~1 person per 0.8 s per lane, one stander + one walker
per step), ride speeds, landing logic (exiting riders already step off at +0.35 m and keep walking; landing blockers were <= 3 people
in all runs).

### Numbers (flowprobe, same seed, before = v3 code, after = this branch)

Each run: 90-150 s of sim at 30 Hz; "max density" = most non-riding people within 3.5 m of a mouth or landing; waits only count people
who boarded (before: a 22-person line at the end of the 150 s start run never boarded). `after` max queue <= 11.

| scenario | max density | longest line | boardings | median wait | worst p90 | worst wait |
|---|---|---|---|---|---|---|
| Nankai 3F start (rapi:t wave, walk to the head) | 30 -> **6** | 22 -> 6 | 22 -> 79 | 77.3 -> 0 s (6 s at the busiest lane) | 84.6 -> 9.6 | 84.6 -> 10.3 |
| Nankai 3F/2F/1F at lunch | 20 -> 11 | 13 -> 11 | 42 -> 148 | 6 -> 3.6 | 24 -> 10.5 | 32 -> 25 |
| Namba CITY B1 -> 1F | 21 -> 11 | 11 -> 7 | 15 -> 61 | 8.8 -> 6.2 | 73.5 -> 8.7 | 73.5 -> 9.6 |
| Namba CITY 1F | 16 -> 9 | 9 -> 6 | 32 -> 57 | 6.1 -> 6.4 | 17 -> 10.7 | 19 -> 13.6 |
| Namba CITY 2F / Parks 2F->3F | 13 -> 10 | 5 -> 7 | 43 -> 69 | 5.9 -> 2.9 | 18 -> 9 | 50 -> 10.9 |
| Parks 2F -> 6F banks (canyon) | 28 -> 12 | 6 -> 3 | 50 -> 67 | 2.5 -> 0.7 | 14.7 -> 6.5 | 30.6 -> 12.5 |
| Midosuji B2 platform stairs / escalators | 34 -> 14 | 13 -> 6 | 8 -> 119 | 4.3 -> 6.6 | 10.8 -> 14.6 | 10.8 -> 18.2 |

Per ramp end (worst four per scenario):

**Nankai 3F start (rapi:t wave, 150 s, player walks to the head)**

| ramp end (level) | max density within 3.5 m, before / after | max queue | boarded in run | median / p90 / max wait to board (s) |
|---|---|---|---|---|
| esc_nk_3_1 high (3F) | 30 / 6 | 22 / 6 | 7 / 39 | 77.3 / 84.6 / 84.6 -> 6.2 / 9.6 / 10.3 |
| esc_nk_4_0 high (3F) | 22 / 6 | 5 / 1 | 11 / 29 | 0 / 0.8 / 4.7 -> 0 / 0.5 / 0.7 |
| esc_nk_4_1 high (3F) | 19 / 4 | 0 / 0 | 0 / 0 | - -> - |
| esc_nk_3_0 high (3F) | 12 / 4 | 0 / 0 | 0 / 0 | - -> - |

**Nankai 3F gate / 2F / 1F (lunch, 90 s)**

| ramp end (level) | max density within 3.5 m, before / after | max queue | boarded in run | median / p90 / max wait to board (s) |
|---|---|---|---|---|
| esc_nk_4_0 high (3F) | 20 / 7 | 9 / 7 | 13 / 69 | 16.3 / 24.2 / 32.3 -> 5.2 / 8.9 / 12.4 |
| esc_nk_3_1 high (3F) | 20 / 11 | 13 / 11 | 8 / 55 | 6 / 12.3 / 12.3 -> 6 / 10.5 / 25.2 |
| esc_nk_3_0 high (3F) | 17 / 5 | 0 / 0 | 0 / 0 | - -> - |
| esc_nk_4_1 high (3F) | 11 / 5 | 0 / 0 | 0 / 0 | - -> - |

**Namba CITY B1 -> 1F (90 s)**

| ramp end (level) | max density within 3.5 m, before / after | max queue | boarded in run | median / p90 / max wait to board (s) |
|---|---|---|---|---|
| esc_city_a_0 low (B1) | 21 / 11 | 11 / 7 | 9 / 45 | 8.8 / 73.5 / 73.5 -> 6.2 / 8.7 / 9.6 |
| esc_city_a_1 low (B1) | 18 / 8 | 0 / 0 | 0 / 0 | - -> - |
| esc_city_b_1 low (1F) | 3 / 4 | 0 / 0 | 0 / 0 | - -> - |
| esc_city_b_0 low (1F) | 3 / 4 | 1 / 4 | 6 / 16 | 4.1 / 4.8 / 4.8 -> 5.2 / 8.2 / 8.7 |

**Namba CITY 1F (90 s)**

| ramp end (level) | max density within 3.5 m, before / after | max queue | boarded in run | median / p90 / max wait to board (s) |
|---|---|---|---|---|
| esc_city_a_1 high (1F) | 16 / 8 | 9 / 6 | 18 / 32 | 6.1 / 12.5 / 12.8 -> 5.7 / 9.1 / 10.1 |
| esc_city_a_0 high (1F) | 15 / 9 | 0 / 0 | 0 / 0 | - -> - |
| esc_city_b_1 low (1F) | 12 / 5 | 0 / 0 | 0 / 0 | - -> - |
| esc_city_b_0 low (1F) | 11 / 6 | 7 / 6 | 13 / 24 | 1.2 / 17 / 19.1 -> 6.4 / 10.7 / 13.6 |

**Namba CITY 2F / Parks 2F->3F (90 s)**

| ramp end (level) | max density within 3.5 m, before / after | max queue | boarded in run | median / p90 / max wait to board (s) |
|---|---|---|---|---|
| esc_city_b_1 high (2F) | 13 / 10 | 5 / 7 | 11 / 33 | 6 / 7 / 50 -> 0.9 / 9 / 10.9 |
| esc_city_b_0 high (2F) | 11 / 5 | 0 / 0 | 0 / 0 | - -> - |
| esc_pk_23_1 low (2F) | 10 / 3 | 0 / 0 | 0 / 0 | - -> - |
| esc_pk_23_0 low (2F) | 9 / 3 | 5 / 3 | 16 / 17 | 5.9 / 18.1 / 20.1 -> 5 / 7.5 / 8.9 |

**Parks 2F -> 6F banks (canyon, 120 s)**

| ramp end (level) | max density within 3.5 m, before / after | max queue | boarded in run | median / p90 / max wait to board (s) |
|---|---|---|---|---|
| esc_pk_23_0 low (2F) | 28 / 6 | 6 / 3 | 21 / 37 | 3.9 / 14.7 / 30.6 -> 0.7 / 6.5 / 12.5 |
| esc_pk_23_1 low (2F) | 27 / 12 | 0 / 0 | 0 / 0 | - -> - |
| stair_pk_g3_0 low (2F) | 5 / 3 | 2 / 3 | 8 / 3 | 2.5 / 7.1 / 7.1 -> 6.7 / 8 / 8 |
| esc_pk_34_0 low (3F) | 3 / 3 | 1 / 2 | 16 / 27 | 0.9 / 2.4 / 2.7 -> 0 / 2.1 / 3 |

**Midosuji B2 platform stairs / escalators (90 s)**

| ramp end (level) | max density within 3.5 m, before / after | max queue | boarded in run | median / p90 / max wait to board (s) |
|---|---|---|---|---|
| esc_m_s_2 low (B2) | 34 / 14 | 12 / 6 | 0 / 22 | - -> 6.2 / 14.6 / 15.1 |
| esc_m_s_1 low (B2) | 31 / 8 | 13 / 6 | 1 / 62 | 2.7 / 2.7 / 2.7 -> 6.6 / 8.1 / 18.2 |
| esc_m_s_0 low (B2) | 22 / 10 | 0 / 0 | 0 / 0 | - -> - |
| esc_m_s_2 high (B1) | - / 7 | - / 0 | - / 0 | - -> - |

(`-` = the other end of a lane / a landing: nobody boards there. Densities at a landing include the neighbouring lane's line.)
Stability: 3 further seeds of the start scenario: max density 7 / 6 / 7, longest line 7 / 6 / 6, worst wait 11.6 / 11.1 / 10.9 s.

## Tools

* `node js/npc/flowprobe.mjs --spawn start --time 11:20 --secs 150 --walk 1 --to -40,-62 --range 130 [--train 0|1] [--seed N] [--dump esc_nk_3_1 --dumpend high] [--dumpstarve 1] [--json out.json]`
  (Node only, ~5 s per run). Reproduces the browser's start surges (`--nodouble 1` = only the forced train).
* Seat / pose / crowd screenshots: `notes/v4-shots/crowd/`.

## Requests (outside my files)

* **Shells** (`js/world/env/*`): give seat spots their real height / kind, e.g. `S.spot('seat', a, d, fa, fd, { h: 0.82 })`
  (barStool 0.82, stool 0.73, chair 0.495, sofa ~0.45) so the crowd does not have to measure it. `places.js` already prefers `h`.
  And `cafe.js:386-387`: the seat spot is 0.3 m away from the stool drawn at `(a, cj-0.2)` / `(a, cj+1.2)` (spot at `cj-0.5` / `cj+1.5`); the crowd
  now snaps to the stool, but the spot should match.

## What I'm unsure about

* Seat measurement scans shop geometry vertices (no BVH, no raycast): it works for boxes/cylinders as built today; a future seat made of
  curved/rounded meshes may not give a flat top and would then not be sat on (safe failure: nobody sits).
* Stool feet float ~8 cm above the floor (the stool has no footrest and the shin length is fixed). Not visible at counter distance, may be
  at 1 m.
* The 3F start-wave density depends on how many extra `train:arrive` events transit really sends at start (I emulated start + 2 initial
  arrivals); with fewer there is less to clear, with more the spreading limits the peak but the line will be longer.
* Queue geometry assumes room behind the mouth; at the Nankai 3F head the concourse is 5 m deep behind the mouth, so a 10+ line
  folds into a second file sideways (intended), not into the walls.
* flowprobe does not include the player's own body in the queue/avoidance beyond the existing viewer model; I did not test walking *through* a
  line in a browser session.
