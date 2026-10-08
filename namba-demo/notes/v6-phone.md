# v6 — Phone (items 6-nav, 7, 9-realism/metrics) · owner: js/ui/phone.js, js/ui/phone/*, css/phone.css

## Contract: new `ctx.phone.stats()` fields (published FIRST — Story picks the end-card metrics from these)

All existing fields stay (`meanErrorBefore/After`, `wrongFloorSeconds`, `metresBefore`, `secondsBefore`, …).
New flat fields, each `…Before` (Maps phase) and `…After` (Lodestone phase). **`null` = not enough data to rate
honestly** (phase under 20 s of samples, or under 15 m of real progress for the detour factor). Never a fake number.

| field | unit | meaning (measured live, once a second, same rules in both phases) |
|---|---|---|
| `errP50Before/After` | m | median distance between where the phone puts the dot and where you truly are |
| `errP90Before/After` | m | 90th percentile of that error ("1 in 10 seconds it was off by more than …") |
| `errMeanBefore/After` | m | = `meanErrorBefore/After` (alias, same number) |
| `wrongFloorPctBefore/After` | % | share of the phase's samples where the phone's floor ≠ your floor (off-ramp only) |
| `walkedBefore/After` | m | metres walked in the phase (= `metresBefore/After`) |
| `progressBefore/After` | m | net metres of TRUE path progress toward the active destination (nav-graph distance drop; a destination switch re-bases, it is not progress) |
| `detourBefore/After` | × | metres walked ÷ metres of real progress (1.0 = perfect; null when progress < 15 m) |
| `wrongWaysBefore/After` | count | episodes where you walked ≥ 8 m that took you ≥ 6 m FARTHER from the destination on the true path (one count per episode) |
| `wrongWaysPerKmBefore/After` | per km walked | the same, normalised (null under 50 m walked) |
| `reroutesPerKmBefore/After` | per km walked | Maps "Recalculating…" / Lodestone reroutes per km |
| `headingErrBefore/After` | deg | mean |phone compass heading − true heading| while you walk |
| `headingSettleBefore/After` | s | median time after a ≥ 60° turn until the phone's heading is within 20° of the truth (cap 10 s; null if < 2 turns) |
| `wrongFloorEpisodesBefore` | count | times the phone switched to a floor you were not on |

Suggested end-card picks (Story decides): **p90 error** (e.g. `28 m → 1 m`), **wrong floor %** (`31% → 0%`),
**detour factor** (`2.4× → 1.1×`), **wrong turns per km** (`9 → 0`).

Also: `series` gains a 5th column: `[t, err, wrongFloor, phase, distToGoal]`.
Also `stats().fair = { before: {...}, after: {...}|null }` (same fields without the suffix), `walkedNav…`, `progress…`,
`turns…` (turn count behind headingSettle), `hopsBefore`.

**Milestone contract addition (v5 `ctx.phone.nextMilestone` / `nav:milestone`):** while you are ON an escalator / stairs
the milestone is the ride: `{ kind: 'escalator'|'stairs', dir, toLevel, riding: true, dist: metres of ride left,
x, z: the landing, side: 'ahead', then: { kind, turn?, name?, gap: metres after the landing } | undefined }`.

## Item 7 — "the app says the escalator is behind me" (root cause → fix)

**Root cause (proved in Node, `scratchpad/p6/navprobe.mjs`: walks the real route node by node, recomputes the Lodestone
route every metre and prints the glance text).** When you are ON a ramp, `routeLegs()` starts with an `onRamp` leg and
`Guidance.compute()` emits the ramp step at distance 0 with its point at the ramp's mouth `s0` (the foot you just
boarded). `milestoneOf()` judged the side from that point → `side = behind` for the whole ride, and the near-text said
**"Escalator up — behind you · Now · to 2F"**. Before: 73 samples on the route (every metre of every ride: CITY 1F→2F,
garden stairs, 3F→4F→5F→6F). The same point made the side flip left/right/behind in the last 1–2 m of an approach.

**Fix (the class, not the instance):**
- `guidance.js`: every ramp step carries an aim point `ax, az` (3 m into the ramp along the ride, not its mouth), the
  landing `ex, ez` (updated when flights chain), and `riding` (the step comes from an on-ramp leg).
- `milestone.js`: `milestoneOf(step, dest, pos, prevSide, nextStep)` — a riding step is the ride itself: `riding: true`,
  point = the landing, `dist` = metres of ride left, side always `ahead`, `then` = the next step with its gap after the
  landing. `milestoneText()` → **"Riding up to 3F" · "Then turn right"** (stairs: "Up the stairs to 3F"); "then" says
  `… in 20 m` when the next step is ≥ 8 m past the landing. Approach sides are judged on the aim point.
- A genuine U-turn entry (CITY 2F → 1F by the café: the path walks past the down escalator's mouth and doubles back)
  now reads **"Escalator down — U-turn onto it · In 4 m"** instead of "behind you · in 4 m".
- `lodestone.js`: glance strip and instruction card use it (card: `On the escalator · 15 m to go` / `Riding up to 6F` /
  `THEN ⚑ Daikichi on your right in 20 m`); the step list says "Riding up to 6F". The arrow is the tracker's heading
  error to a point 6 m further along the ride, so it points forward along the escalator.

## Item 6 — nav QA

- Node probe over the whole route (start → café → Daikichi with the canyon loop): **73 "behind" cues → 0**; the 3 U-turn
  samples now say "U-turn onto it".
- **Turn flicker (found by the probe):** "Turn right · in 31 m" appeared for one metre on Nankai 3F and "Turn left · in
  17 m" for one metre in the Parks 2F hall, then vanished. Cause: the turn angle was measured between Douglas–Peucker
  segments, and the simplification depends on where the path starts (where you stand), so a ~55° bend was in or out
  depending on the metre. Fix (`guidance.js`): the angle at each simplified vertex is measured on the raw path over
  ±7 m around it — a property of the corner, not of the start point. Both flickers gone; real corners (café exit
  "Turn right", top of the garden stairs "Turn right") unchanged. A 90° corner cut into two 45° vertices is now caught.

## Item 9 — the ordinary Maps phase, realistically bad (`positioning.js`)

Before (v5): σ 8.5 m in the concourses, 4.5 m under the Parks glass → end card "±6 m mean, 13 s on the wrong floor".
Now, calibrated to phone location inside a multi-level station (GNSS through concrete + Wi-Fi/cell fallback):

| where (true position) | env | measured mean / p50 / p90 error (m) | heading err | wrong floor |
|---|---|---|---|---|
| Nankai 2F concourse (under the viaduct) | terminal ×1.12 | 22.3 / 23.5 / 30.5 | 21° | episodes |
| Namba CITY 2F | terminal ×1.12 | 15.8 / 15.2 / 27.8 | 29° | |
| Namba CITY 1F | ground ×1.12 | 19.1 / 19.2 / 29.3 | 21° | |
| B1 NAMBAWALK | under | 18.2 / 17.9 / 27.3 | 29° | |
| Parks 6F (glass) | glass | 13.9 / 11.8 / 25.3 | 18° | rare |
| Parks canyon (open air, tall walls) | canyon | 6.2 / 6.1 / 10.8 | 13° | never |

(`scratchpad/p6/mapsprobe.mjs`: 145 s of looping walk per spot, Maps mode, quality low.)

- **Error:** OU random walk, τ 22 s, σ by environment (table above); still map-matched onto a walkable cell of the floor
  the phone believes (within 9 m), so the dot sits in a plausible corridor — often the parallel one.
- **Hops:** every 12–30 s a re-fix lands somewhere new with probability 0.35 (canyon) … 0.8 (B2), and the dot SNAPS
  there (0.12 s ease instead of the 0.9 s glide). Underground fixes refresh every 1.7–2.4 s.
- **Floor:** lag 5–18 s after a real level change; wrong-floor episodes (7–16 s, an adjacent floor that exists there)
  every ~70 s above ground indoors, ~60 s underground, ~110 s under the Parks glass, never outdoors.
- **Heading:** drifting bias (12–36° scale by env) + lag 0.6 s (open air) … 2.0 s (B2): after a turn the arrow takes
  ~2–4 s to come round (measured median settle 3.6 s in the walk; Lodestone 0.1 s).
- Unchanged: Maps directions stop at the first escalator ("Directions for the remaining floors will appear once we
  detect you on 2F"), crow-flies distances, the GPS-weak banner, the compass prompt (no longer in the open-air canyon).
- `mapapp.js`: only Maps-mode "Recalculating…" counts as a Maps reroute (it kept counting a stale background route after
  the upgrade).

Shot: `notes/v6-shots/phone/maps_b1_dot_dev.png` / `_full.png` — B1 NAMBAWALK, true (46, −212), phone (34, −225):
18.6 m off, ±25 m circle, "Walk 460 m to the escalator · Take escalator up to 1F · directions for the remaining floors
will appear…".

### Metric definitions (honest by construction)
- Per-second samples, same code in both phases; teleports and the 1.4 s Lodestone snap are dropped.
- **Detour factor** = metres walked *with a destination set, off escalators* ÷ metres of real progress (the drop in
  the remaining length of the route being followed — true nav path; with Lodestone through the pending scenic canyon
  loop Aya asked for, so taking the scenic way is not counted as a detour). Rides are excluded from both sides (a ride's
  graph cost and its horizontal metres differ, which biased the phase with more rides). Destination switches re-base.
- **Wrong ways** = an episode of ≥ 8 m walked that left you ≥ 6 m farther from the goal on the true path; it ends when
  you win 6 m back. Per km of walking with a destination.
- **Heading settle** = after a ≥ 60° yaw change within 1.2 s, seconds until the phone heading is within 20° (cap 10 s).

### Sample values (full `tools/walk.mjs`-equivalent run, final code: `scratchpad/p6/walk6.mjs`, quality low, crowd on)

The bot follows the TRUE shortest path even in the Maps phase (it never gets lost), so its detour / wrong-turn rows
are a floor, not what a player sees. A deliberately lost Maps walk (`rideprobe.mjs`: 20 s the wrong way, then the right
way) gives `wrongWays 1 · 7.6 /km · detour 1.8×` — the metrics do move when a player wanders.

| field | before (Maps, 192 s, 264 m) | after (Lodestone, 306 s, 393 m) |
|---|---|---|
| errMean / errP50 / errP90 | 18.4 / 18.8 / 28.7 m | 0.4 / 0.4 / 0.7 m |
| wrongFloorPct (seconds) | 25 % (47 s, 4 episodes) | 0 % |
| detour (bot) | 1.0× (222 m walked / 221 m progress) | 1.0× (289 / 279) |
| wrongWaysPerKm (bot) | 0 | 0 |
| reroutesPerKm | **58.6** (13 × "Recalculating…") | **0** |
| headingErr (mean, walking) | 12° | 0° |
| headingSettle (median after a turn) | **4.5 s** | **0.1 s** |
| hops | 8 | — |

Run 1 (before the last tuning) had 43 % wrong floor and 1.0× / 1.1× detour (rides counted; fixed).

### For Story (end card) — recommendation, your call
- Rows that do not differ for this player make Lodestone look no better (the walk's card shows `1.0× → 1.0×` and
  `0/km → none`). Show a row only when it separates the phases, e.g. `detourBefore ≥ detourAfter + 0.15`,
  `wrongWaysPerKmBefore > 0`.
- Two rows that separate for EVERY player (bot included), measured the same way in both phases:
  **"Recalculating…" per km** `reroutesPerKmBefore → reroutesPerKmAfter` (58.6 → 0), and
  **"Arrow caught up after a turn"** `headingSettleBefore → headingSettleAfter` (4.5 s → 0.1 s).

## Evidence (`notes/v6-shots/phone/`)

| shot | what |
|---|---|
| `walk_ride_city_1F2F_full` | on the CITY 1F→2F escalator: glance **"Riding up to 2F · Then 70 m to the bridge"**, arrow forward (that run used the longer "then cross the bridge in 70 m", which got truncated, so the compact wording is now used for the strip) |
| `walk_ride_city_2F1F_full` | riding down to the café: **"Riding down to 1F · Then turn right"** |
| `walk_ride_garden_stairs_full` | canyon garden stairs: **"Up the stairs to 3F · Then turn right"** |
| `walk1_board_first_frame_full` | run 1, first frame on the ramp: still the approach text (route re-planned 0.5 s later). Fixed: `_routeTick` now re-plans the moment you step on or off a ramp |
| `maps_b1_dot_dev/_full` | Maps on B1 NAMBAWALK: dot 18.6 m off, ±25 m circle, directions stop at the first escalator |
| `walk_maps_nankai3F_dev` | Maps on Nankai 3F: the dot sits between the platforms, ±20 m |
| `walk_endcard` | Story's end card fed by the new fields (±18 m · p90 29 m → ±0.5 m; 25 % → 0 % wrong floor) |

Full walk (run 2, final code apart from the compact "then" wording): Maps pick 1 → offer at 183.5 s → Lodestone →
café → Daikichi with the canyon loop → arrived at 499.6 s, end card 8:18 · 657 m. **0 "behind" cues** in 1 Hz sampling
of the glance across the walk; every ride read "Riding … · Then …". `ctx.errors []`; the only console lines are the bot's
own 2 `dbg` warnings. Node probe after the last edit: 0 "behind" (the 3 U-turn samples read "U-turn onto it").
`loadprobe`: `READY 29.3s []` at the start of the work; `READY 157.3s []` at the end, with 4 browsers sharing the machine.

## Unfinished / for the reviewer
- **No screenshot of the Lodestone CARD (phone raised) while riding.** `rideprobe.mjs` kept steering into the down
  lane's mouth, and later its screenshots timed out under 4-browser load. The card code path is the same milestone
  (`On the escalator · N m to go` / `Riding up to 6F` / `THEN …`). It is untested visually.
- **No screenshot yet of the compact glance wording** ("Then 70 m to the bridge", "Then 20 m to Daikichi"). The Node
  probe prints it; the walk shots show the earlier, longer wording.
- Bot-only noise: brushing the DOWN lane's mouth beside an up lane (café 1F, Parks 3F) briefly shows "Turn left / Turn
  around · then …". That is correct for where the body is. Players rarely do this.
- Maps "Recalculating…" fires about every 15 s in the Maps phase (13 in 192 s). Every believed-floor change re-plans
  (the v4 behaviour). That is realistic and maddening; if it reads as spammy, raise the off-route threshold in
  `mapapp.js _routeTick` (18 m) or stop re-planning on a wrong-floor episode.
- A one-off console warning `WebGL: INVALID_OPERATION: texImage3D: FLIP_Y…` appeared in one probe right before its tab
  crashed under memory pressure. It never appeared in either full walk. Nothing in `js/` uses 3D textures.
