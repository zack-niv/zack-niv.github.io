# Demo flow & end card — log (owner: js/game/*, ui/hud.js, ui/title.js, css/game.css, index.html)

## What the demo does now
1. **Title** (`ui/title.js`): なんば / "Lost in Namba" / one line ("Somewhere in this labyrinth, a tempura lunch is
   waiting.") / "Click to begin". Footer: "Best with keyboard & mouse · headphones on" + the four controls
   (WASD, Shift, Q, E). Touch devices get "Best on a computer with a keyboard and mouse".
2. **Intro** (`game/demo.js` `begin()`): spawn `start`, 11:20 (`DEMO.startMinutes`). The player is held ~4.6 s while the
   camera glances at the rapi:t, then at the way out; chapter card, the terminal PA announcement (transit emits it),
   the crowd alighting. Aya's two texts at 8.0 s and 10.8 s via `phone:message`; the single quest goes active
   (`quest:update` {id:'tempura'}); a quiet controls hint (`hud.hint`) fades in/out.
3. **Pacing**: all story timers are REAL seconds of play (pause-aware): see "Clock" below.
4. **Upgrade trigger** (`demo.js` `update()`): `ctx.phone.offerLodestone()` when the player is clearly lost
   (>7 s on B2/B1/1F, or >75 m further from Daikichi than their best point, or >250 m walked and still >80% of the
   original route left) or after `DEMO.offerAt` = 135 s, whichever first; never before `DEMO.offerMin` = 45 s so the
   generic map is felt. "Lost" uses the nav flow field to the Daikichi door (`ctx.nav.fieldToPoint('demo:daikichi', ...)`).
   Two vague Aya nudges (58 s, 96 s) are sent only while not yet offered. `?offerat=SECONDS` overrides (testing).
   On `phone:upgrade {stage:'ready'}` Aya answers 3 s later ("see? 😌 6F, I'm 3rd in line"); queue banter at
   170 m / 45 m remaining.
5. **Arrival**: level 6F and within 7.5 m of the Daikichi door point -> `demo:arrive` is emitted, the player is
   held and walks the last metres automatically (camera on the noren), the 3rd person in the real queue
   (`ctx.crowd.sim.places.bizBySlot[slot].queue[2]`) becomes "Aya": WAVE pose, turns to the player, a small name tag;
   sizzle (`ctx.audio?.play?.('tempura')`), the chef's welcome, the counter view; ~7 s total, then the end card.
6. **End card** (`game/endcard.js`): left = "Indoor spaces shouldn't run on guesswork.", the note to the Oriient
   team, `contact: zack@…` placeholder (edit `ENDCARD.contact` in `game/script.js`), buttons *Keep exploring* /
   *Replay* (reload). Right = before vs after (time, metres, mean position error, wrong-floor seconds) with bars.
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
* `ctx.phone.stats()` (guarded). Fields read: `meanErrorBefore`, `meanErrorAfter` (metres), `wrongFloorSeconds`,
  optional `wrongFloorSecondsAfter`. Anything missing/non-finite is replaced by the game's own sampler (4 Hz,
  `ctx.phone.pos` vs the true body position, split at the `ready` event).
* The end card reads `ctx.phone.pos` ({x,z,level}) only through that sampler.
* `ctx.game.quests` now has a single key, `tempura`.
* Events emitted: `demo:offer {why,t}`, `demo:arrive {slot,t,upgraded,summary}`, `demo:end {summary}`.
* `phone:message` may carry `link:'lodestone'`.
* Colour palette on the end card (ours, not any company's): amber `#f0b45a` = guesswork, cool blue `#6fb6ff` =
  Lodestone. Change `--e-before/--e-after` at the top of `.g-end` in css/game.css if the phone picks another blue.

## Clock (REQUEST to the lead / core owner)
`js/core/clock.js` still runs `scale = 6` (1 real s = 6 game s) and starts at 10:42. I do not own it, and the
transit timetable (`new Timetable(..., {scale: ctx.clock.scale})`) bakes the scale in at init, so I cannot safely
change it from `game.js`. **Please set in `js/core/clock.js`: `this.scale = 1` (or 1.2) and `start = 11*60+20`.**
Everything in the game flow is already in real seconds, the game only forces the clock to 11:20 at start (a
`clock.update(0)` re-tick so shop shutters follow). With `scale = 6` the in-game clock advances ~48 min during an
8-minute demo (fine for Daikichi's hours, but the phone must keep multiplying ETAs by `clock.scale`, as mapapp
already does).

## Known gaps
* Daikichi's queue is whatever the crowd director produces; if nobody is queueing at arrival the Aya
  wave/tag is skipped and the camera shows the counter instead (`ctx.crowd.queueLength(slot)`).
* The "lost" detection is geometric, not semantic: a player who walks the whole route correctly never sees it and
  gets the offer at 135 s anyway.
