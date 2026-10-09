# v8 Crowd: boarding through car walls (item 6)

Files: `js/npc/behave.js`, `js/npc/trips.js`, `js/npc/places.js`, new `js/npc/doorprobe.mjs`. `trains.js` / `cars.js` unchanged (door offsets there are right).

## Root cause (three things, all in the crowd)
1. **Marks of the wrong train.** The boarding queue marks (`places.js`) came from `trackInfo().stopDoors`, i.e. the doors of the track's
   STANDARD formation (comm8 on Nankai). The train that really stops (rapi:t6: 2 doors per 20.5 m car, southern8, south4, comm6/4...)
   has other door positions, so people queued at marks that are car walls and walked straight in.
2. **Boarded with closed doors.** "Open" was the director's own timer (`doorsT0 + 3.5 .. + dwell 22 s`), not the train's door state, and
   `maxWait` (200-320 s) let anyone board regardless. At game start every Nankai track fires an `initial` arrival, so all
   waiters stepped in at about t = 4 s whatever the doors were doing.
3. Alighters appeared 0.3 s after the doors-open event, before the leaves moved (open > 0.6 takes ~1.2 s).

## Fix
- `places.setTrackDoors(T, doors)`: marks rebuilt from the real door list. `trips.applyDoors / syncMarks / reseat`: on `train:arrive`
  (event `doors`) and when a boarder joins (next service of the track from `ctx.transit.trains`, doors via `transit._doorList`, guarded),
  waiting people re-queue at the nearest real door.
- `director.doorsOpen(T)`: true only while the transit train at that track is `boardable` (doors state, open > 0.6); timer only if there is no transit.
  The maxWait fallback now ends the leg instead of boarding.
- `behave._enterDoor`: walk to the nearest REAL door (apron point, then through the opening). Stepping in = fade when within 0.3 m of the door line
  (the platform-edge collision holds people ~0.25 m short). If the doors close or 10 s pass before the doorway, they go back to the queue instead of vanishing on the platform.
- Alighters: first one appears 1.3 s after the doors-open event.

## Numbers (`node js/npc/doorprobe.mjs --sec 300 [--root DIR] [--shots 0,4,8]`, headless, whole game stepped at 30 Hz)
Lateral distance (along the platform edge) from the nearest door of the stopped train, where each boarder vanishes:

| | before | after |
|---|---|---|
| boarders that finished (500 s / 300 s) | 84 | 87 |
| max | 18.9 m | 0.39 m |
| mean | 1.54 m | 0.09 m |
| p90 | 5.1 m | 0.22 m |
| > 0.5 m (at a wall) | 44 (52 %) | 0 |
| by formation (before, wall cases) | comm8 22, southern8 8, rapit6 6, south4 4, comm4 3, comm6 1 | none |

- `flowprobe --max 1500 --spawn start --time 11:20 --secs 150 --walk 1 --to -40,-62 --range 130 --seed 1`: 241 boardings (old code 231/223 on seeds 1; no new jams in the top rows).
  (Node has no transit, so this exercises only the fallback timers.)
- `loadprobe`: READY 68.7 s, `[]`.
- Start sequence (player's start view, sim t = 0 / 8 / 12 / 16 / 20 s): `notes/v8-shots/v8-crowd-start-t*.png`. The view faces away from the doors, so the proof is the table above.

## Behaviour change to know about
Waiters now board only through doors that are really open. At game start the standing Nankai trains close sooner than the old fake 22 s window,
so fewer people board in the first ~20 s; they board at the next opening. Alighting is unchanged apart from the 1.3 s delay.

## Risks
- `syncMarks` calls `transit._doorList` and reads `transit.trains` / `transit.cfg` (private-ish). Guarded; falls back to the standard marks.
- Not looked at in the live game with a camera at the doors on a rapi:t arrival (headless numbers only).
