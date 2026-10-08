# v7 Crowd: IC-card tap at ticket gates (item 4)

Files: `js/npc/sim.js`, `js/npc/humans.js`, `js/npc/render.js` (no other area touched).

## What
NPCs passing a gate (both directions, every gate that uses `_gateStep`) raise a hand to the reader, press for ~0.25 s, and lower it,
while the walk carries on (no stop, no speed change).

- **sim.js** `_gateStep` (stage 1): `a.tapAt` = sim time of the gesture's start, set when the person is 0.4 s (from current speed) short
  of the flap line. The gate's reader flash (`transit.gatePass`, called when they cross the line) therefore lands 0.40-0.43 s into the
  gesture, i.e. on the contact. `a.tapDone` makes it once per gate pass. Purely visual state, nothing reads it but render.js.
- **humans.js** `rig.tapPose.{R,L}`: two key poses (`up`, `press`) of UpperArm / LowerArm / Wrist as local quaternions, authored with the
  existing aim()/palmTo() helpers (forearm forward, palm down, hand ~1.0-1.05 m on a 1.7 m person; press = ~4 cm forward).
- **render.js** `_tap()`: a layered override applied on top of the mixer in `_near` only (far LOD skips it). Timeline (s):
  0-0.3 raise, 0.3-0.4 press in, 0.4-0.55 hold, 0.55-0.65 release, 0.65-0.95 lower. Same "clean pose" rule as the head look (arm bones
  restored before `mixer.update(0)`, override after) so nothing integrates. Right hand, or the left when the right carries a
  briefcase / shopping bag 2 / umbrella; no free hand (both busy) means no tap. The phone prop follows the right hand, so phone-walkers
  tap with the phone.

## Evidence
- Close-ups (paused sim, near LOD, tap forced at tt): `notes/v7-shots/crowd/free_side_045.png`, `free_front_045.png`, `free_q3_000.png`
  (no tap) / `free_q3_050.png` (tap). Gate-lane views with the player-side cabinet in the way: nothing extra kept (the cabinets hide the
  forearm from side views, which is why the gesture shots are in open floor next to the gate).
- Hand height / reach from the rig (WristR above floor): 0.87-0.89 hanging -> 1.04 raised (forward +0.30 m) for a 1.7 m person.
- Gate throughput, `g_nk_central`, Node sim, 150 s, seed 12345, 1500 agents, tap on vs. off (same seed): 57 passes both (22.8/min);
  57 of 57 passes got a tap. Contact-to-flash offset: min 0.40, median 0.43 s.
- `tools/headtest.mjs --secs 12 --spawns nankai_gate,midosuji_gate`: reports FAIL on `appStepY` 6.93 > 6.6, **identical with the tap
  disabled (6.94)**, so it predates this change (head-yaw rate under the stress targets; the arm layer never touches Neck/Head). No NaN,
  no yaw/pitch clamp violation.
- `tools/loadprobe.mjs`: `READY 62.2s []`. No new meshes or materials: draw calls unchanged. Console: only the sandbox font cert error.

## Unsure / for the critic
- The gesture is subtle from the front (forearm points at the viewer); best seen from the side. A real GPU look at the Nankai gates at
  normal speed is the real test.
- It is not aimed at the real reader (which side the reader is on varies by lane); the hand goes forward and a little to the hand's side.
- `a.spd` for the 0.4 s prediction is last frame's speed; agents that start the gate lane very close to the line get a shortened
  raise (the gesture starts partway in, with a small pop). Rare.
