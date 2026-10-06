# Demo flow & end card — log (owner: js/game/*, ui/hud.js, ui/title.js, css/game.css, index.html)

## What the demo does now
1. **Title** (`ui/title.js`): なんば / "Lost in Namba" / one line ("Somewhere in this labyrinth, a tempura lunch is
   waiting.") / "Click to begin". Footer: "Best with keyboard & mouse · headphones on" + the four controls
   (WASD, Shift, Q, E). Touch devices get "Best on a computer with a keyboard and mouse".
2. **Intro** (`game/demo.js` `begin()`): spawn `start`, 11:20 (clock.js). The player is held ~4.6 s while the
   camera glances at the rapi:t, then at the way out; chapter card, the terminal PA announcement (transit emits it),
   the crowd alighting. Aya's two texts at 8.0 s and 10.8 s via `phone:message`; the single quest goes active
   (`quest:update` {id:'tempura'}); a quiet controls hint (`hud.hint`) fades in/out.
3. **Pacing**: all story timers are REAL seconds of play (pause-aware): see "Clock" below.
4. **Upgrade trigger** (`demo.js` `update()`): `ctx.phone.offerLodestone()` when the player is clearly lost
   (>7 s on B2/B1/1F, or >75 m further from Daikichi than their best point, or >250 m walked and still >80% of the
   original route left, or **stalled**: under 8 m of net nav-distance progress toward the Daikichi door in the last
   25 s, so a player stuck at a gate or dithering gets the offer at the peak of the frustration) or after `DEMO.offerAt` = 135 s, whichever first; never before `DEMO.offerMin` = 45 s so the
   generic map is felt. "Lost" uses the nav flow field to the Daikichi door (`ctx.nav.fieldToPoint('demo:daikichi', ...)`).
   Two vague Aya nudges (58 s, 96 s) are sent only while not yet offered. `?offerat=SECONDS` overrides (testing).
   On `phone:upgrade {stage:'ready'}` Aya answers 3 s later ("see? 😌 6F, I'm 3rd in line"); queue banter at
   170 m / 45 m remaining.
   Aya texts once (`CANYON_TEXT`, "take the canyon side — trust me 🌿") when the player reaches `parks_bridge`
   (2F, x -5..5, z 190..204). The "I can see the noren" banter (45 m) is held until the player is on 6F.
5. **Arrival**: level 6F and within 7.5 m of the Daikichi door point -> `demo:arrive` is emitted, the player is
   held and walks the last metres automatically (camera on the noren), the 3rd person in the real queue
   (`ctx.crowd.sim.places.bizBySlot[slot].queue[2]`) becomes "Aya": WAVE pose, turns to the player, a small name tag,
   camera kept centred on her head (`_lookAtAya`). She is **re-dressed** by `_dressAya()` the moment the queue is seeded (so
   there is no pop): a fresh `makeLook('shopper', …, {female:true})` with a mustard coat (`0xe3a41c`), navy legs, white
   sneakers, long dark hair, a red tote, no mask/cap/briefcase; assigned to `agent.look` / `agent.flags`, which the crowd
   renderer reads every frame (try/catch'd: if it fails she just stays as she was, flagged `agent._aya`);
   sizzle (`ctx.audio?.play?.('tempura')`), the chef's welcome, the counter view; ~7 s total, then the end card.
6. **End card** (`game/endcard.js`): left = "Indoor spaces shouldn't run on guesswork.", the note to the Oriient
   team, an optional contact line (`ENDCARD.contact` in `game/script.js`; **empty = the line is not rendered**, it is
   empty until the user supplies one), buttons *Keep exploring* / *Replay* (reload). Right = before vs after:
   1. **Position error** (mean, by the phone), 2. **Wrong-floor seconds**, 3. **Net progress toward Daikichi** in
   metres per minute, each with a bar, then a small neutral "Whole trip: m:ss min · N m on foot" line (no bars).
   Raw time/walked per phase are no longer rows: the after phase always covers more route, so they made Lodestone look
   slower. Net progress = (nav distance to the Daikichi door at the phase start - at the phase end) / phase minutes,
   with `ctx.nav.distance` sampled at begin (spawn), at `phone:upgrade {stage:'ready'}` (`demo.remReady`) and at
   arrival (`demo.remArrive`); `summary().progress = {before, after}`; null (shown as an em dash) if a phase is < 10 s
   or a sample is missing. Before can honestly be low or negative; it is printed with a true minus sign.
7. **Distraction removed**: discovery toasts off (only Parks + canyon get a soft place-name card), no
   quest toasts, pause menu = Resume / Settings / Controls (+ a "Today" panel), coffee/other shops are flavour
   only (coffee order still works, costs 2 game minutes, no quest). Tendon/Kitsune/Daikichi vignettes and the
   Midosuji boarding/ending are gone.

## Contract with the Phone & Lodestone agent
* The game calls `ctx.phone.offerLodestone()` ONCE. **The phone is responsible for Aya's offer text + the tappable
  link card** (the game sends nothing itself when the method exists). If the method is missing the game falls back to
  `phone:message {from:'Aya', text:'you're lost aren't you 😂 install Lodestone, it actually works indoors', link:'lodestone'}`.
* The game listens to `phone:upgrade {stage: 'offer'|'installing'|'calibrating'|'ready'}`; `ready` = the "after" phase
  begins (Aya reacts, stats switch to the after buckets).
* `ctx.phone.stats()` (guarded; the phone's `stats.js` now provides it). Fields read: `meanErrorBefore`, `meanErrorAfter` (metres), `wrongFloorSeconds`,
  optional `wrongFloorSecondsAfter`. Anything missing/non-finite is replaced by the game's own sampler (4 Hz,
  `ctx.phone.pos` vs the true body position, split at the `ready` event).
* The end card reads `ctx.phone.pos` ({x,z,level}) only through that sampler.
* `ctx.game.quests` now has a single key, `tempura`.
* Events emitted: `demo:offer {why,t}`, `demo:arrive {slot,t,upgraded,summary}`, `demo:end {summary}`.
* `phone:message` may carry `link:'lodestone'`.
* Colour palette on the end card (ours, not any company's): amber `#f0b45a` = guesswork, cool blue `#6fb6ff` =
  Lodestone. Change `--e-before/--e-after` at the top of `.g-end` in css/game.css if the phone picks another blue.

## Clock
core/clock.js now starts at 11:20 with scale 1.2 (done by the lead). The game no longer forces the time; all story timers are real seconds anyway.

## Queue & stats wiring (done)
* **Queue**: `demo.js _seedQueue()` seeds 5 people on Daikichi's stools (the director's own `_initialFill` recipe, via
  `ctx.crowd.behave.director`) when the player is on 6F within 70 m, and holds admission (`B.nextAdmit`) until the arrival
  moment ends. Aya = `queue[2]`. Uses crowd internals (`_create`, `_onward`, `P.qSlot`): guarded by try/catch.
* **End-card numbers** come from `ctx.phone.stats()` (phone's `samplesBefore/After`, `secondsBefore/After`,
  `metresBefore/After`, `meanErrorBefore/After`, `wrongFloorSeconds(After)`). Only if the phone has no samples for a phase does
  the game fall back to its own sampler (needs >= 8 samples, skips 1.6 s after any teleport, phase by `phone.pos.mode`);
  with no data the card shows an em dash, never an invented number.

## Known gaps
* Daikichi's queue is whatever the crowd director produces; if nobody is queueing at arrival the Aya
  wave/tag is skipped and the camera shows the counter instead (`ctx.crowd.queueLength(slot)`).
* The "lost" detection is geometric, not semantic: a player who walks the whole route correctly never sees it and
  gets the offer at 135 s anyway.

## Subtitles / HUD hygiene (ui/hud.js, css/game.css)
* PA captions (`announce` events and PA-style `caption` events) are shown whether or not audio is on (audio/trains.js
  passes `caption:false`, so the HUD is the only captioner for raw `announce`), but only when audible: payload position
  within 60 m and same level (or +-1 level while the player is in a station zone: nankai/midosuji/sennichimae). A payload
  without a position shows only while the player is in a station zone. `Hud.paAudible()` holds the rule.
* A caption whose text (ja+en) is already on screen is not added again; it only extends the life of the existing one
  (so the entry-only-lane refusal no longer stacks).
* During the arrival moment (`game.demo.arrived`, including the end card) announcement/distant captions, `hint()` pills
  and `chapter()` cards are suppressed; Aya's and the chef's lines still show.
* The phone's bottom-right message peek (`.ph-peek`) lifts the subtitle band (`body:has(.ph-peek:not([hidden])) .h-captions`),
  so the two never overlap.
