# v5 — Crowd agent: escalator boarding / exit ("teleports onto it")

Owned files touched: `js/npc/sim.js`, `js/npc/render.js`. Nothing else. No clip change was needed in `humans.js`.

## Root cause (measured, not guessed)

Probe: Node, same sim code as the browser, stepped at 1/60 s, every near (tier 0) agent sampled per frame; contexts "board"
(1.6 s after `_startRide`), "exit" (1.6 s after leaving the ramp), "approach" (`rampNext >= 0`). 18 runs (6 spawns x 3 seeds,
100 s each, 1500-person crowd): 1212 boardings, 858 exits in v4.2.

`sim.js` `_startRide` -> `_placeOnRamp` (boarding) and `_ride` (exit) were three simultaneous snaps:

| | v4.2 behaviour | evidence (one boarding, 60 fps frames) |
|---|---|---|
| position | the head of the line (anywhere within 1 m x 0.8 m of the mouth) was moved onto the lane start `rs = 0`, lateral `rampU`, in one frame | step 1.154 m in one frame (0.016 m/frame before and after); worst 1.83 m |
| yaw | `a.yaw = atan2(-t)` the ramp direction, instantly | 1.981 -> 3.142 rad in one frame (66 deg); up to 10800 deg/s (180 deg) |
| speed | `a.vx = t * rspd` (belt speed) regardless of the walking speed | 0.88 m/s -> 0.97 (walker) / walking 1.2 -> 0.5 (stander) in a frame |
| clip | walk -> ride switched in the same frame (cross-fade existed, BLEND 0.28 s, but the body had already popped) | |
| exit | at `rs > 1` the rider was put 0.35 m ahead, velocity reset to `end.d * pref` | 0.37 m step, 1044 frames over 0.15 m in 858 exits. It is the 0.35 m because the cells at the end line are not walkable: without it the collider ejects the person (0.24 m) the next frame. |

v4.2 totals: **1235 frames with a step > 0.15 m** (max 1.83 m) and **1061 frames with yaw > 360 deg/s** at boardings; 1044 steps > 0.15 m
at exits (max 0.37 m).

## Fix

`sim.js`
* **Boarding continues the walk** (`_startRide`): the rider starts where the person is. Its distance outside the start line becomes
  a negative ramp parameter (`rs < 0`, or `> 1` at the top end); the speed along the ramp (`a.rsp`) starts at the walking speed
  component along the ramp and relaxes to the belt speed with tau 0.3 s (`_ride`); the small sideways error to the lane
  (`bx,bz`, `bvx,bvz`) is a critically damped spring (`BOARD_W` 7.5 /s; gentler for a big error), so position AND velocity are continuous.
* **Yaw** eases (exp rate 9 /s, capped 5.5 rad/s = 315 deg/s) towards the actual motion direction while the sideways error is
  settling, then towards the lane direction. No sideways slide: facing follows the velocity.
* **Step-on trigger** (`_rampApproach`): lateral tolerance 0.8 -> 0.6 m (the remaining error is eased out by the spring); queue aim
  point 0.45 -> 0.3 m outside the line (`RAMP_AIM`), so the person is already almost at the line.
* **Exit** (`_ride`): the rider keeps gliding `EXIT_RUN` = 0.4 m past the end line (on the landing floor, still a rider, so no
  collision ejection) and only then becomes a walker, with its own velocity (not reset to walking pace); the walking steering relaxes
  the speed up to the walking pace over ~0.4 s.
* Tier-2 (invisible) agents still snap; nobody sees them.
* `Agent` got `rsp, bw, bx, bz, bvx, bvz, bo, boardK, boardSpd0` (boarding state; `boardK` 0 -> 1 over 0.55 s).

`render.js` (`_clipFor`)
* `boardK` drives the clips: a stander keeps its walk clip until `boardK` 0.4, then `ride` cross-fades in (the existing 0.28 s BLEND);
  a walker's foot speed slides from its ground speed to its speed relative to the belt (was an instant jump of the clip rate).

## Numbers (per 1/60 s frame; 18 runs each, same seeds/spawns)

| context | metric | v4.2 | v5 |
|---|---|---|---|
| boarding (1.6 s window) | frames with step > 0.15 m | 1235 / 118,657 | 0 |
| | max step | 1.83 m | 0.033 m |
| | frames with yaw rate > 360 deg/s | 1061 | 0 |
| | max yaw rate | 10800 deg/s | 315 deg/s (the cap) |
| exit (1.6 s window) | frames with step > 0.15 m | 1044 / 73,777 | 0 |
| | max step | 0.372 m | 0.037 m |
| approach (queue -> head) | max step / yaw | 0.035 m / 344 deg/s | unchanged (0.033 / 344) |

In the real browser (SwiftShader, sim and renderer stepped by hand at 1/60, near LOD sampled via `_rx/_rz/yaw/_ac/_ap/_aw`; 10 near
boardings at Nankai 3F): max step 0.027 m, max yaw 345 deg/s, 0 steps > 0.15 m; clip switches seen `walk>ride` (cross-faded via
`_ap/_aw`), `walk>idle`.

Final-code probe sweep (6 spawns x 3 seeds x 100 s; Nankai 3F/2F, CITY 1F/2F, Parks 6F, garden): 1167 boardings, 779 exits, 0 steps
> 0.15 m, max step 0.033 m (boarding) / 0.037 m (exit), 0 frames over 360 deg/s (max 315 / 344). The sideways-relative-to-facing
speed exceeds 0.35 m/s in 0.9 % of boarding frames (max 1.3 m/s): that is the yaw (rate-capped) catching up with the motion
direction right after step-on, not a slide of a body that faces forward.

In the browser (`__namba.crowd.sim` + renderer stepped by hand at 1/60 s, near LOD, Nankai 3F down escalator `esc_nk_3_1`):
v4.2 4 boardings -> 4 pops (max 0.94 m, 6936 deg/s); v5 3 boardings -> max step 0.027 m, max yaw 345 deg/s; clip switch `walk>ride`
cross-fades through `_ap/_aw`. Not checked in the browser: CITY and Parks (probe-only, see sweep above).

Flow (`node js/npc/flowprobe.mjs --max 1500 --secs 150 --spawn S --seed N`, 6 spawns x 3 seeds, v4.2 copy vs final):

| | v4.2 | v5 |
|---|---|---|
| boardings / min, sum over the 6 spawns | 669.5 | 664.2 (-0.8 %) |
| Nankai gate (busiest) boardings / min | 191.7 | 185.3 (-3 %) |
| max density (people within 3.5 m of a mouth) | 14 | 14 |
| median wait per spawn (s) | 3.0 / 3.6 / 4.1 / 4.1 / 4.2 | 3.2 / 3.9 / 4.5 / 4.2 / 4.1 |
| p90 wait per spawn (s) | 6.1 / 7.2 / 6.9 / 7.4 / 6.3 | 5.9 / 7.4 / 7.1 / 7.6 / 6.4 |
| worst single wait (s) | 53.7 (CITY 2F) | 69.2 (CITY 2F; one tail outlier, its median and p90 are unchanged) |

Tuning history: lateral tolerance 0.3/0.4 m cost +0.6 s median wait and -5 % boardings at the Nankai gate; 0.6 m recovered it
with the same zero-pop result.

## Shots

* `notes/v5-shots/crowd/sheet_boarding_new.png` (+ `boarding_new/f00..f13.png`, 0.1 s apart): a person walks up to the Nankai 3F
  down escalator and steps on (walk -> ride cross-fade, yaw easing 1.5 -> 3.1 rad over ~0.6 s). Taken with the previous trigger
  tolerance (0.4 m); the mechanics are identical to the final code.
* `new/` and `old/` (+ `sheet_new.png`, `sheet_old.png`): final code vs v4.2, same camera, 0.1 s apart. The sequences end while the
  head is still waiting for its turn (SwiftShader screenshots take minutes under load), so they show the approach only. The per-frame
  numbers above are the evidence for the step itself.

## Not fixed / for others

* `behave.js` dining agents (`mode STAND`, leg `dine`) turn 180 deg in one frame (`faceYaw` snaps when they sit / start a meal).
  Not an escalator thing; only seen in the yaw probe ("free" context). Owner: whoever owns seating (humans/behave).
* One single-frame 0.2 m step by a non-boarding walker pressed against a mouth cell (collision ejection); same in v4.2.
* Heads that were physically blocked (the 0.8 s `headT` fallback) and step on from the side of the mouth now glide in over ~1 s
  (rare, < 1 in 100 boardings) instead of popping.
