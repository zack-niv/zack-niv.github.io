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
