# Game flow & interactions — log

Owner files: `js/game/*`, `js/ui/hud.js`, `js/ui/title.js`, `css/game.css`, UI markup in `index.html`.

## APIs I expose (ctx.game) — stable, guard with `?.`
- `ctx.game.quests` → `{ coffee, tempura, subway }`, each `{ id, state: 'hidden'|'active'|'done', text, textJa, detail, notes: [] }`.
  The phone can render this list directly. Changes are announced with `'quest:update'`.
- `ctx.game.addInteractable({ id, level, x, y?, z, radius, prompt, promptJa, sub?, canUse?(), onUse() })` → returns a remove fn.
  `ctx.game.removeInteractable(id)`. Anything (shops, props, transit) may register interactables.
- `ctx.game.ic` → `{ balance }` (ICOCA card, starts ¥2,000). `ctx.game.paused`, `ctx.game.ended`, `ctx.game.busy` (a vignette/menu is open).
- `ctx.game.message(text, from = 'Aya')` → emits `'phone:message'`.
- `ctx.game.discover(id, en, ja)` → journal + toast (once per id).
- `ctx.paused` (bool) mirrors pause state for systems that want to freeze (crowd/transit may ignore it).
- `ctx.settings` → `{ quality, sensitivity, headBob, volume, subtitles }` (persisted in localStorage `namba.settings`).

## Events I emit (also added to js/core/events.js catalogue)
- `'phone:message'` `{ id, from, text, time }` — Aya's texts. **Wayfinding: please render these as phone notifications** (banner + thread). If `ctx.phone.handlesMessages` is truthy the HUD will NOT draw its own fallback banner.
- `'quest:update'` `{ id, state, text, textJa, detail }`
- `'caption'` `{ en, ja, speaker, duration }` — subtitle line (HUD renders; audio may use it for barks).
- `'toast'` `{ kind, title, en, ja }` — HUD toast.
- `'discover'` `{ id, en, ja }`
- `'game:pause'` / `'game:resume'`, `'game:end'` `{ summary }`
- `'ic:tap'` `{ ok, gate, balance, fare, reason }`
- `'vignette:open'` / `'vignette:close'` `{ kind }`
- `'settings:change'` `{ key, value, settings }`

## Events I listen to
`announce` (subtitles), `caption`, `player:zone`, `player:level`, `player:teleport`, `train:arrive`/`train:depart` (fallback for doors), `phone:open`/`phone:close` (don't pause while phone holds the pointer).

## Requests to other areas
- **Movement**: please keep `player.frozen` (true = no move/look), `player.vel` (zeroed when a gate refuses you), and expose `player.lookTarget` if you add one. I set `player.frozen` during title, vignettes, pause and the ending. Head bob setting: I set `ctx.player.headBob = 0..1` (multiply your bob amplitude by it if defined) and `ctx.input.sensitivity`.
- **Transit**: I use (all guarded) `ctx.transit.isBoardable(trackId, body)` or `ctx.transit.doorsOpen(trackId)`; fallback: `train:arrive`/`train:depart` events with `track` = track id. I call `ctx.transit.ticketMachines?.()` → `[{level,x,z,gate,kind:'ticket'|'charge'}]` if it exists to place charge-machine interactions, otherwise I place them on the free side of each gate line.
- **Environment**: `ctx.shops.counter(slotId)` → `{level,x,z}` if available; fallback is 2 m inside the shop door.
- **Sound**: `ctx.audio.play(name)` names I use: `gate_ok`, `gate_ng`, `charge`, `ui_open`, `ui_close`, `ui_select`, `coffee`, `tempura`, `phone_buzz`, `train_doors`, `train_depart`, `discover`. `ctx.audio.resume()`, `ctx.audio.setVolume(v)` (0..1) if present.
- **Wayfinding**: phone reads `ctx.game.quests`; my events above.

## Log

### Round 2
- Pause menu gained a **Journal** tab (places discovered with the time, distance/floors/wrong turns/coffees, meals).
- Reachability (Node, `scratchpad/game2/reach.mjs`): every featured shop door (Wakakusa, Rondo, Mocca, Daikichi, Tenmaru, Kitsune), Midosuji south gate and the Midosuji platform are reachable by nav from the `start` spawn (409-580 m of walking).
- E2E proof harness: `scratchpad/game2/e2e.mjs` (acquireSlot; teleports, presses E, drives menus, asserts quest states, screenshots every vignette).

- Critique #1 (pacing): clock.scale is core (not mine), so I re-budgeted instead: Shinkansen is now the **16:10** (next 16:40, leave-by 15:40); Aya's nudges at 12:20 / 14:30 / 15:30 / 16:10 / 17:30. Burst bug fixed: after a clock jump only the latest due nudge is sent.
- #4: intro starts Aya's texts at 6 s; goals activate silently (no "New goal" toasts, the phone Notes list fills in); toasts remain for "Done".
- #2 (partial): `passTime` now veils (dim + blur) the *live* world instead of cutting to black; the view glides to the counter/fryer (`game.lookDir(dx,dz,pitch)` / `clearLook()`), trains use a black "ride" screen with tunnel lights streaking past (`hud.ride(on)`).
- #3: shop call-outs (`crowd:callout`, within 9 m, 14 s cooldown) are captioned as quiet distant subtitles.
- #6: leaving a metro gate you tapped into costs the minimum fare (¥190); the wrong train also costs ¥190.
- #7: after the wrong-way ride you stand on the track-1 side of the island and must walk across to track 2 (no longer dropped on the right side).
- #8: only "wonder" places toast (Parks, canyon, bridge, stage, gardens, summit, Crysta court, depachika, CITY court); everything else is silent and lives in the pause Journal.
- #10: the ride to the end card has a tunnel-light screen and a closing line.
- Node logic test (`scratchpad/game2/logic.mjs`): chain/Wakakusa/Kissa/closed/tendon/Kitsune/Daikichi state transitions all PASS.

## Requests
- **Wayfinding (bug #1)**: phone route ETA = metres / 1.3 / 60 *minutes of real time*; the clock runs `clock.scale/6`... i.e. 1 game min = 10 real s at scale 6, so show `ETA * clock.scale / 1`... in practice multiply by 6 (≈ metres / 15 game-minutes) or the phone lies by 6x.
- **Crowd/Env (#5)**: a visible queue (6-14 NPCs on stools) outside Daikichi (`parks_6Fdw03`) 11:30-13:30 would make "somewhere people queue for" actually legible; `ctx.crowd.queueLength(slot)` is read if present.
- **Transit/crowd (#4)**: at game start a `train:arrive {terminal:true}` for the rapi:t (alighting wave + arrival PA) would replace the dead first seconds.
- **Movement (#9)**: allow jogging with the phone up; escalator-foot re-capture (see movement.md).

## Known issues / open
- Vignettes are veil + camera glide, not fully diegetic (no barista/chef NPC pose, no 3D cup, no real train ride).
- Time: scale stays 6; a lost player spends 6x the minutes the phone promises.
