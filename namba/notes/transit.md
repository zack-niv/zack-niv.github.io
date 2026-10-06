# Transit (trains, platforms, gates, boards, timetable) — running log

Owner files: `js/world/transit.js`, `js/world/transit/*` (timetable.js, cars.js, mesh.js,
trains.js, env.js, gates.js, boards.js, textures.js). System name `transit` (build phase).

## Claimed scope (so other areas don't duplicate)
* Everything *inside the track pits* of B2 (Midosuji, Sennichimae) and 3F (Nankai):
  slab/ballast, sleepers, rails at the correct offset, third rail (metro), catenary (Nankai),
  the **ceiling over the track pits**, the **tunnel tubes** beyond the subway platform ends
  (220 m Midosuji, 85/200 m Sennichimae, black end caps), and for Nankai the **shed roof over
  the tracks** (z -62..110), **viaduct deck + parapets + catenary portals** (z 110..245), buffer stops.
* Platform screen doors (可動式ホーム柵) on Midosuji + Sennichimae (fixed housings are
  collision boxes via `world.addBox`; openings at the stopped train's doors), door-position
  floor markings (car numbers 1..10 / 1..4, women-only car 1 on Midosuji, 整列乗車 queue lines),
  Nankai boarding marks (8両/6両/rapi:t/特急) and car-stop sign at the buffer end.
* Ticket gate machines + flaps on `LAYOUT.gates` / `gt.machines`, fence visuals on `gt.fence`,
  staffed booth (有人改札, collision box), ticket/charge machines on the free side + fare chart
  above them (Osaka Metro network / Nankai line diagram, canvas), fare adjustment machines on the
  paid side (collision boxes), operational departure boards (pois `departureBoard` + hanging
  platform boards).

## Timetable model (important for everyone)
* Schedule is in **game minutes** (what boards/clock show). Physical motion (approach, braking,
  dwell, doors) is in **real seconds** (1 game min = 10 real s at clock scale 6).
* Midosuji: a train every ~80 (rush) – 115 real s **per track** (= 8–12 game min on the board),
  10 cars (scaled to 14 m so the 140 m platform holds it), dwell 22–34 s, approach at 60 km/h
  braking at 0.92 m/s² out of the tunnel. Sennichimae: 4 cars, every ~120–150 real s.
  Nankai: terminating trains, dwell 140–300 real s, then depart south; patterns per track
  (1–2 Koya line, 3–4 airport incl. rapi:t, 5–6 main line incl. 特急サザン, 7–8 locals/Semboku).
* **Player's train**: rapi:t β on **nk_track_4**, arrived 10:41, doors open at 10:42 start,
  departs **11:00** (≈3 real minutes). (Wayfinding: rapi:t is tracks 3/4, not 7.)
* Positions are a pure function of `ctx.clock.minutes` — clock jumps/pauses are safe.

## API (`ctx.transit`)
* `trains` → live trains `[{ id, line, track, trackNo, platform, level, type, typeJa, typeEn,
  typeColor, destinationJa, destinationEn, cars, arr, dep, state, speed, doors (0..1), boardable,
  x, z, front }]`. state ∈ `approach | arriving (last 14 s) | stopped | doors | closing | departing`.
* `nextDepartures(trackId, n=3)` → `[{ id, track, trackNo, line, platform, time:'10:52',
  minutes, dep, arr, type (EN label), typeKey, typeJa, typeEn, typeColor, dest, destination,
  destJa, destEn, cars }]`.
* `doorsOpen(trackId)` → `[{ x, z, level, nx, nz, car, door, along }]` (platform-edge points of
  the doors, normal points into the platform) while doors are open, else `null`.
* `isBoardable(trackId, body?)` → bool; with a body, also requires the body within 2 m of the
  edge and aligned with a door (±dw/2+0.45 m).
* `trackInfo(trackId)` → `{ id, line, lineJa, lineEn, color, no, platform, level, dirJa, dirEn,
  axis, centre, edge, inward, stopFront, platformRange, psd, stopDoors:[{x,z,level,nx,nz,car,door}] }`.
* `trackState(trackId)` → `{ state, svc, open, psdOpen, front, speed }` or null.
* `gatePass(gateId, laneIndex, dir, ok = true)` → animate a lane: reader flash; `ok=false`
  snaps the flaps shut for ~1.4 s (Japanese gates are normally OPEN — flaps retracted). Emits
  `gate:pass`. The player's own taps are picked up automatically from the game's `ic:tap`.
* `gateLanes(gateId)` → `[{ i, x, z, policy:'both'|'in'|'out', width, paidSign }]`;
  `laneAt(gateId, x, z)` → lane index or -1.
* `ticketMachines()` → `[{ level, x, z, gate, kind:'ticket'|'charge'|'adjust', facing }]`
  (x,z = standing point 0.7 m in front of the machine).
* `now()` → service-day minutes (clock minutes, +1440 before 4:00).

## Events
* `train:approach` `{ line, track, trackNo, platform, level, trainId, type, typeJa, typeEn,
  destinationJa, destinationEn, carCount, eta (game min), etaSec (real s) }` — ~26 s (metro) /
  32 s (Nankai) before the stop.
* `train:arrive` same base + `{ doors:[{x,z,level,nx,nz,car,door,along}], terminal (Nankai:
  everyone alights), initial? }` — when doors start opening. Emitted once at the first update
  (`initial:true`) for trains already standing with open doors (the start rapi:t!).
* `train:closing` base — doors start closing (stop boarding).
* `train:depart` base — train starts moving.
* `announce` `{ kind:'approach'|'arrive'|'info'|'depart', line, track, trackNo, textJa, textEn,
  ja, text, level, x, y, z, position, sound, operator, trainId }`. `sound` hints:
  `metro_approach` (接近チャイム), `metro_arrive`, `metro_door_chime` (doors closing),
  `nankai_approach`, `nankai_arrive`, `nankai_info`, `nankai_melody` (departure melody).
* `gate:pass` `{ gate, lane, dir, ok, level, x, z }`.

## Lights registered
Tunnel bulkhead lamps (every 3rd), staffed booth panel, gate-line downlights, fare-chart signs,
departure board screens (`sign`). Trains render their own emissive interiors/lamps (unlit) and
additive headlight/taillight glow sprites.

## Draw calls (mine)
Trains: one InstancedMesh per car model, 4 groups (body/glass/interior/emissive) → ≤ 4 calls per
model in view regardless of train count (Nankai with 6 trains: 3–6 models ≈ 24 calls). Static
env/PSD/markings/gates batched per 48 m chunk + material; boards 1–2 calls each.

## Requests to other areas
* **Architecture**: please drop your rails at the track-rect centre (I draw rails at the real
  offset: train centre = platform edge ∓ 1.5 m). Keep ballast/back walls. If you build a vaulted
  ceiling spanning the track pits, tell me and I'll stop drawing the flat pit ceiling.
* **Lead**: events.js catalogue comment should list the payloads above (I don't own the file).
* **Crowd**: spawn alighting passengers at `train:arrive.doors` (all of them for `terminal`),
  stop boarding on `train:closing`; call `gatePass` when an agent crosses a lane.
* **Sound**: play from `announce.sound` + `textJa` (spatial at x,y,z) and train rumble from
  `ctx.transit.trains` (x,z,speed,state).

## Log
* v1: timetable + kinematics, 10 car models (Midosuji 30000-ish, Sennichimae 25, Nankai
  8300-ish commuter, 12000 Southern, 50000 rapi:t), PSDs, markings, tunnels/shed/viaduct,
  gates/booths/machines/fare charts, boards, events/API. Lightweight harness used for
  iteration (scratch), full game load ~5 min under SwiftShader contention.
