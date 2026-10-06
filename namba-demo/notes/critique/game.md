# Game flow & interactions — experience critique (critic-exp, round 1)

**Verdict:** the writing has charm (Aya's texts, the barista lines, the "six minutes you'll never get back" wrong-train card), but almost every payoff happens *off-screen*: you press E, the world fades to black and a text card tells you what you felt. The journey is the game, yet the clock punishes the journey 6× harder than the phone admits.

**Score: 5 / 10** for "walking around is itself delightful / getting lost is fun".

How this was reviewed: I loaded without `?test` (title screen → click → intro) and drove `window.__namba` headlessly with a persistent harness (`scratchpad/critic-exp/driver.mjs`, `pilot.js`). The harness steers along the nav field like a player holding W, presses E and drives the menus. I also read `js/game/*`, `js/ui/hud.js` and `js/ui/title.js`. Screenshots are in `scratchpad/critic-exp/shots/`. In-page timers run slowly under SwiftShader, so I judge timings from code, not from wall-clock.

---

## Can the three quests be completed end to end?

This decides whether there is a #1 blocker, so it is checked first. The status is updated as the runs finish.

| Quest | Code path | Play-test status |
|---|---|---|
| Coffee (Wakakusa, `link_e03`; or Kissa Rondo) | `orderCoffee` → `setQuest('coffee','done')` for `coffee_great` / `coffee_kissa`; open 07:30–19:00 | **in progress** (run b02). The first run got from platform 4 to the 2F foot of the Nankai escalator and then stalled for 25 game-minutes. The bot cut the corner back onto the down escalator. That is partly a bot artefact, but see movement.md #2: a player turning round at an escalator foot gets re-captured by the comb plate. |
| Tempura (Daikichi `parks_6Fdw03`, opens 11:00; Kitsune from 17:00) | `daikichi` → queue card → course → `setQuest('tempura','done')` | **in progress** (run b03) |
| Midosuji to Shin-Osaka (track 2) | `_edgeInfo` needs `player.space.id === 'm_platform'` and the player within **1.1 m** of the platform edge at x = −110, facing east, with `transit.isBoardable` (which needs the body aligned with a door ± dw/2 + 0.45 m) | **in progress** (run b04). Risk: the PSD housings are collision boxes, so if they keep the body > 1.1 m from x = −110 except exactly in the door gaps, the prompt only appears in a ~1 m window per door. |

Node reachability (my `critic-exp/routes.mjs`, nav shortest paths): start → Wakakusa 425 m (3F > 2F > 1F > B1), Wakakusa → Daikichi 471 m (B1 > 1F > 2F > 3F … 6F), Daikichi → Midosuji track 2 505 m (6F … B2). Every target is reachable. The optimal whole game is **≈ 1.4 km of walking ≈ 16 real minutes ≈ 96 game minutes**.

---

## Top 10 issues (ranked by impact on the player's feeling)

### 1. The clock runs 6× faster than your feet, and the phone hides it
- **Evidence:** `core/clock.js` sets `scale = 6` (1 game minute = 10 real seconds). At 1.5 m/s you cover 15 m per game minute. In my first run, platform 4 (z = 20) to the Nankai central gate (z = −66) took **10:42 → 10:55**: 13 game minutes for a 90 m walk. Meanwhile the phone's route sheet promises `minutes = R.total / 1.3 / 60` (`mapapp.js _routeSheet`), i.e. 425 m → "5 min, arrive 10:47". You actually arrive at about **11:10**. Shinkansen pressure (`TIMED` 14:00 / 14:40) is set in game time, so a lost player's mistakes are multiplied by 6.
- **Why it matters:** the vision is "getting lost is fun". A clock that turns every wrong turn into 6× the penalty, behind a phone that lies about it, turns curiosity into anxiety. It also breaks the illusion that the phone is a real phone.
- **Fix:** run real-time walking at 1:1 and let *vignettes* (coffee, queue, meal) skip time, as they already do with `passTime`. Use `clock.scale = 1` while walking (or 1.5 at most). Shift the targets: start 11:15, Daikichi line peaks 12:30, Shinkansen 14:10 → leave Namba by 13:40. If you keep scale 6, the phone ETA must be computed in game minutes (`R.total / 1.3 / 60 * clock.scale`) and Aya's reminders need +40 min of slack.

### 2. Every "moment" is a fade-to-black text card; you never see the barista, the chef or the cup
- **Evidence:** `vignettes.js`: `orderCoffee` → `panels.menu` → `passTime(… 'You stand at the narrow counter and watch the kettle pour …')` → `hud.cup(true)`. Daikichi is a 2D card listing courses, and you never see the chef or the oil. Both train boardings, right and wrong, are black screens with text (`_wrongWay`, `_ending`).
- **Why it matters:** the vision's payoff line, "…and wow, this is incredible", must happen *in the world*. Firewatch and Edith Finch keep the camera live through every interaction: you hold the object, the scene plays around you. A fade card is a menu, not a memory.
- **Fix (in order of value):**
  1. **Coffee:** keep the camera live. Lock the view to the counter (lerp yaw/pitch to `shops.counter`), spawn a staff NPC pose (`ctx.crowd` staff_shop + `bow`/`browse` poses) and play the grinder → kettle → cup sounds positionally. Show the menu as a small diegetic paper menu on the counter, not a side panel. Skip only the 3–4 minutes of brewing with a 1.5 s dip-to-black, then hand the player a cup **in view** (a first-person cup model in the lower right while `hud.cup` is on).
  2. **Daikichi:** seat the camera at the counter (height 1.15 m), facing the fryer. Render each course as a small object on a paper sheet in front of you, with sizzle bursts. Let the course list be a caption, not a panel.
  3. **Trains:** board for real. Step through the door into the car interior (transit already renders interiors), then doors close, the station slides away (move the train for ~6 s with the player parented), and *then* fade.

### 3. Crowd reactions to you are invisible on screen
- **Evidence:** the crowd emits `crowd:excuse` (すみません) and `crowd:callout` (いらっしゃいませ). `hud.js` captions only `caption` / `announce`. Since 08:18 the sound lead voices both and emits a `caption` for an excuse within 3 m, but call-outs are never captioned and there is no on-screen reaction (glance, sidestep, bow).
- **Why it matters:** the game's tone is "you are a guest here". Being acknowledged (a shop clerk calling out as you pass, a salaryman's clipped "sumimasen") is a cheap source of delight and of guilt for blocking a gate lane.
- **Fix:** caption call-outs as small, distant-style subtitles (`kind:'distant'`, 1.6 s, no speaker label) with a 15 s per-shop cooldown. Add a tiny "you were in the way" beat. If you are bumped twice within 10 s in a gate lane, `player:bump` → a 0.4 s caption 「あ…」 and the agent turns its head (crowd needs to expose `onPlayerBump`; see crowd-behaviour.md).

### 4. The first 15 seconds are dead air, and the goals arrive as toasts, not as Aya
- **Evidence:** `_intro()`: chapter card at 1 s; texts at 3.2 s, 7.4 s, 11.4 s; goals at ~14 s, 15.5 s, 17 s, each with a "New goal" toast; the thought line at ~21 s. In headless frames (`shots/a10_chapter.png`, `a02_after_begin.png`) you stand on platform 4 next to your own rapi:t, and nothing on the platform reacts to your arrival: no alighting crowd, no "なんば、終点です" PA at t = 0.
- **Why it matters:** this is the "welcome to Namba" moment. Real arrival is a wave: doors chime, everyone pours off, the PA thanks you, suitcases rumble toward the gates, and you are carried along. That is the perfect tutorial for "follow the crowd or don't".
- **Fix:** at `onStart`, trigger a `train:arrive` for the start rapi:t with `terminal:true` (crowd already alights everyone for `terminal`) plus the arrival PA. Delay the first Aya text to about 6 s, after the wave passes. Drop the "New goal" toasts: put the three goals as Aya's numbered list, already in `INTRO[1]`, and show them in Notes with a single phone buzz. That is diegetic and calmer.

### 5. Tendon and Kitsune are traps with no information; the "tempura" quest is a coin flip on the phone ranking
- **Evidence:** the phone search "tempura" (directory `searchBusinesses`) returns Daikichi (★4.6, 6F), Kitsune (★4.4, opens 17:00) and Tenmaru (★3.5). Kitsune "Remember it for later" notes the quest. But the Shinkansen deadline is 14:40, so Kitsune at 17:00 is only completable if you miss the train. Tenmaru never completes. Nothing tells you that the *line* outside Daikichi is the signal. At 11:00–11:30 the `queueLength` is small and you simply walk in.
- **Why it matters:** "Find tempura for lunch… somewhere people queue for" is the best-designed quest (it uses the crowd as a clue!), but the crowd half isn't wired into the decision. The line exists only in a panel's number.
- **Fix:** make the Daikichi queue a visible landmark: at least 6–14 NPCs on stools along the 6F wall from 11:30 to 13:30 (crowd `queue` legs exist, so force-fill them for this slot). Make the queue *the* reason players pick it. Let the interaction be "join the end of the real line": the camera shuffles forward with each admission, at 4× speed. That's the time skip, now diegetic.

### 6. Gates: a nice passive prompt, but no ICOCA beat and no fare
- **Evidence:** `_tapIn` charges **¥0** (`fare: 0`), and `MIN_FARE = 190` is only a threshold. Tap-out never charges. `FARE_SHIN_OSAKA` appears only on the end card ("¥290 will come off at Shin-Osaka"). The refusal path snaps you back (`b.x = tap.prev.x`) and zeroes `vel`. That reads as hitting a wall.
- **Why it matters:** the IC tap is one of the most satisfying tactile rituals in Japan (pi!, the balance flashes, the flaps stay open). It should be a micro-moment, not a toast.
- **Fix:** charge the fare on tap-out (¥190 minimum when exiting the Metro, Nankai free on exit for the rapi:t ticket). Show the balance on the gate's reader (transit's reader-flash API) rather than as a HUD chip. On refusal, have transit close the flaps physically (they already animate) and let `world.move` block you on the flap collision instead of teleporting you back one frame.

### 7. The wrong-train vignette teleports you instead of letting you fix it
- **Evidence:** `_wrongWay()` fades, shows "次は、大国町", adds 6 minutes, then teleports you to `B2 −113.5, −128` already on the correct side, with `paidArea` set.
- **Why it matters:** the vision's "doubling back" is a core pleasure. Being cut to black and placed on the right side removes the doubling back. The joke is good, but it's the game playing itself.
- **Fix:** let the train take you one stop for real (or fake it with a 20 s ride in the car interior, the tunnel lights passing). Then drop the player on the **Daikokuchō** platform (re-use the Namba platform with different name boards and a short timetable), and they must cross over and ride back. If that is too much, at least teleport to the *wrong* side's track-1 edge and let the player walk across the island.

### 8. Discovery toasts are achievement pop-ups, which is the game-y layer the vision forbids
- **Evidence:** `journal.js`: about 30 PLACES, each giving a "Discovered · …" toast on first entry (zone and space matches). The first minute alone produces "Nankai Namba Station" (silent), then "Nankai ground-floor hall", "Namba CITY", "The long underground passage"…
- **Why it matters:** "No giant arrows, no artificial maze tricks, no game-y navigation aids." Toasts don't navigate, but they gamify: they turn wonder into a checklist.
- **Fix:** keep the journal, but make it silent and phone-side: Aya-style photo-roll entries ("📷 Namba Parks Canyon — 13:12"), visible in the pause Journal and on the end card. Show an on-screen line only for the 4–5 true wonder moments (canyon, garden summit, fountain court, the Nankai hall from the 2F balcony). Those get a *thought* caption, not a toast.

### 9. Pause / Esc behaviour fights the phone, and there is no in-world way to check the goals
- **Evidence:** the goals live in the pause menu (`_goalsView`) and in the phone Notes. Opening the phone drops pointer lock, and `pointerlockchange` relies on a 140 ms timer to *not* pause (`game.js` init). In my harness the phone stayed up across a long walk and the player crawled at 0.85 m/s for 20 game-minutes, with no hint why. With the phone up, Shift (jog) is ignored (`player.js`: `jog = … && !this.phoneOpen`).
- **Why it matters:** phone-up walking at 57 % speed with jog disabled is a hidden handicap. Players will hold Q-up while navigating, because that is how you navigate.
- **Fix:** allow jogging with the phone up (cap 2.2 m/s), or show the "phone glance" slowdown in the UI with a small walking-person icon. When the phone has been open for > 20 s with WASD held, have the phone hint "Tip: Q to lower the phone and walk faster".

### 10. The end card is a stats sheet; the train ride, the city and Aya are missing
- **Evidence:** `_showEndCard`: duration, km, floors, places, wrong turns, coffees, and the meal/coffee/ICOCA rows. `REACTIONS.boarded` is sent 2 s after the fade.
- **Why it matters:** a 40-minute wander deserves a closing image. The stats are fun, but they should follow a moment.
- **Fix:** before the card, play 8–10 s inside the moving Midosuji car: the window black with tunnel lights flicking past, the "次は心斎橋" LED, Aya's text arriving on your phone in-world, then the card. Put the journal's photo-roll on the card (the 4–5 wonder moments).

---

## Keep — this works
- **The script voice** (`script.js`): Aya's texts, the barista and mama-san lines, PEEK one-liners per cuisine, and "six minutes you'll never get back". It has warmth and humour and is the best text in the build.
- **The quest design itself:** a *great* coffee (decoys: chain, generic cafés), *tempura somewhere people queue* (decoys: tendon, an evening bar), and *the right direction* of the right line (the wrong-way vignette). Each one is a different wayfinding skill.
- **Shops have real hours**, so a closed card at 08:30 or after 19:00 is a believable obstacle.
- **The passive gate prompt** ("Walk through to tap") and walk-in boarding (`_checkWalkIn`: hold W at the door edge). Diegetic, no button.
- **The "Board anyway?" confirmation** when quests are unfinished: a soft, funny fail state.
- **Title screen:** the drifting platform dolly behind the type, 「なんば」 large, and no menu clutter (`shots/a01_title.png`). It's tasteful and sets the tone.
- **The interactions registry** (`interact.js`): look-cone + distance scoring and `space`-scoped targets is a solid, extensible base.

## Bugs found (with repro)
1. **Phone ETA ignores the clock scale.** Repro: on platform 4 at 10:42, search "coffee" → Wakakusa → Directions. The sheet says about "5–6 min, arrive 10:47/10:48". Walk the route and you arrive after 11:05.
2. **Tap-in/tap-out never deducts a fare.** Repro: note the ICOCA balance, enter the Midosuji gates and leave again. The balance is unchanged (`_tapIn` / `_tapOut` emit `fare: 0`).
3. **`TIMED` messages fire in a burst after any clock jump** (vignette `passTime`, the wrong-way +6 min, or a debug time set). They are sent in sequence with no spacing (`_timeBased` `while` loop). Repro: be at 13:55, then any jump that crosses 14:00 and 14:40 (the wrong-way +6 min plus a Kitsune 35-min passTime, or a debug time set). Both reminders land in the same frame, and the 14:00 one ("leave by 14:40") is already stale. Fix: send at most one TIMED text per jump (the latest), with 4 s spacing.
