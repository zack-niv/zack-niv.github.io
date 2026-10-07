# v3 critique — harsh critic + fixer

Played headless end to end (SwiftShader, `quality=low&noaudio`, walk bot driving real input along the nav field and
answering Aya like a player: phone up on Messages, "I'm lost", peek at Maps, phone down):
title → rapi:t platform → tutorial (move / raise / reply / Maps) → "Landed??" → reply → "Meet me at Daikichi" →
"Where are you??" (t≈100 s) → "I'm lost 😭" → Lodestone offer (t≈109 s) → install → calibration → reveal →
Nankai 3F→2F → Namba CITY 2F → Parks bridge → Parks 2F → escalators 2F→6F → Daikichi (arrive t≈369 s) → end card.
**The second half works under v3.** `ctx.errors` [] and zero console errors in every run (only the sandbox's
Google-Fonts cert error, filtered). Evidence: `notes/v3-shots/critic/` (+ walk shots in the critic scratchpad).

Load (machine quiet, `tools/loadprobe.mjs`, quality=high): **READY 10.9 s, errs []** — the 105 s seen by Crowd+Sound
was machine load (4 headless browsers), not a regression (v2 final: 12.9 s).

## Scorecard (before my fixes → after)

| # | Item | Before | After | Evidence |
|---|---|---|---|---|
| 1 | Progress from interaction (Aya / phone / place) | fixed | fixed | Walk event log: "Landed??" waits for 8 m walked; "Meet me…" only after the reply (`hello->yes`); "Where are you??" from the lost/stalled verdict (t 100 s); offer only after "I'm lost 😭"; typing beat before every text, never overlapping. `walk-02-aya-text-11s.png`, `walk-05-offer-full.png` |
| 2 | Easy app switching | fixed | fixed | Dock Messages · Maps · Lodestone · Apps with unread badge + Tab cap (`walk-08c-ready-full.png`); Tab cycles, 1/2/3 slots |
| 3 | Japanese-only PA | fixed (code) | fixed (code) | `announcer.js` speaks `lang:'ja'` only; English stays as caption text. Not audible headless — needs one human listen |
| 4 | Heads spinning | fixed | fixed | Root cause (mixer not rewriting unchanged bones → look-turn integrated every frame) fixed by restoring the clean pose. My spot-check **on escalator riders** (Parks 2F foot, 94 ramp samples, `ride` clip): applied yaw ≤ 60°, ≤ 6°/frame (180°/s), 0 spikes, 0 NaN — PASS |
| 5 | Real in-game tutorial | fixed | fixed (copy corrected) | 6 validated steps, one in-world hint each, nudges; `tutorial:done` at 125 s. Copy now says what the keys really do (see fixes) |
| 6 | Restart with "Are you sure?" | fixed | fixed | Pause → Restart → confirm (Story's `restart-confirm.png`; code re-read) |
| 7 | Escalators go nowhere | partly | fixed | Well ceilings / landings were done; the root cause (Nankai viaduct running through CITY 2F + Parks) was only clipped at init. Now ended upstream. `item07_parks2f_foot.png` (lit opening, 3F visible), `item07_parks3f_top_down.png` (2F floor at the bottom, no gravel), `item07_parks6f_top.png`, `item07_city2f_top.png` |
| 8 | Caption channels | fixed | fixed | ambient = small top-left, speech/action = bottom centre (Story's `caps-channels.png`) |
| 9 | Footsteps softer | fixed (code) | fixed (code) | −5 / −6.5 dB, 2.5 ms onset. Needs one human listen |
| 10 | Lodestone keeps you on track | **partly** | fixed | **False amber on the real route**: walking straight down the Namba CITY 2F mall (the longest walk of the demo) showed "Turn left" amber for ~50 m whenever you were not on the east side of the mall, and stayed amber through the whole Parks escalator ride. Fixed in `track.js` (below). Re-checked: following the route CITY 2F → canyon → escalators = `on` throughout, incl. the canyon via-point flip (no spurious reroute) |

Also fixed (not one of the 10): **"Sneaker Lab Kansai" furnished with bookshelves** (`shoes_before_bookshelves_walk_sw11.png`
→ `shoes_after_sneakerlab_city2f.png`) and the same bug class in lifestyle / zakka shops (e.g. the candle shop next to
the Parks 2F escalators, `item07_parks2f_foot.png` left).

## What I fixed (files)

1. **Nankai viaduct, upstream** (`js/world/transit.js`, `js/world/transit/env.js`)
   - `NK_VIADUCT_END = 168`: the station viaduct (deck, ballast, parapets, rails, wires, catenary portals) and the train
     draw range end at z 168, before Namba CITY's south end and the Parks; `massing.js` carries the narrower viaduct on,
     swinging west (`viaductAt` starts its swing at 170). Was z 245 = through the Parks block.
   - Deck underside lifted from 9.65 m to 10.65 m (above the CITY 2F ceiling + plenum it spans, 10.0 + 0.6); parapets
     shortened to match; the cut is capped with an end face; a last catenary portal where the wires stop.
   - Nankai cars are drawn only while entirely on the station viaduct (`along + L/2 <= end`), so departing trains never
     run through the Parks or hang off the deck end.
   - `js/render/intrusions.js` kept as a safety net (it also cuts the street stair wells out of the ground plane).
2. **Lodestone false amber** (`js/ui/phone/track.js`)
   - The grid route from a point in a wide hall runs diagonally to one side first ("45° left, then straight"); the
     6 m look-ahead therefore said "Turn left" to anyone walking straight down the middle/west of the CITY 2F mall.
     The tracker now also accepts heading towards points 12 / 20 / 30 m along the same straight stretch (capped at the
     next turn / escalator / canyon via / arrival, same floor). Facing any of them = on track; wrong way still drifts
     at 60° / turns around at 135°; "lost" metres logic unchanged.
   - Riding an escalator clears a stale `drifting` (was: "Turn left" amber for the whole 2F→3F ride). A wrong ride is
     still caught on the way off (wrong floor → reroute + buzz).
   - Probe (`scratchpad/critic3/s_track.mjs`): bot path CITY 2F (0,100) → 5F: before = `drifting` from z 124 to the
     3F landing (≈ 80 s amber); after = `on` the whole mall; one legit `drifting` at the Parks 2F hall where the bot
     ignores "Walk out into the canyon", cleared the moment it steps onto the escalator.
3. **Shop fixtures** (`js/world/env/shopbuild.js`, `packs()`): shoes are low pairs (sole, vamp, heel) on open white
   shelves, toes to the aisle (no printed product block behind them); lifestyle / zakka shelves get spaced candles,
   mugs, jars and boxes instead of upright spines; `folded` goods are flat stacks. Deterministic per-shelf RNG (layout
   RNG untouched). Lifestyle wall shelves carry zakka goods only (their third "stationery" row still read as books,
   `zakka_after_city_2sw03.png` was shot just before that last change).
4. **Tutorial / controls copy** (`js/game/script.js`, `js/game/settings.js`, `js/game/game.js`): reply hint "press 1 2 or
   click a reply"; Maps hint "Tab switches apps (or click the dock)"; install hints mention Enter (the offer card says
   "Tap the card, or press Enter"); controls card gains **V — Lodestone 3D view**; pause hint mentions Q up *and down*,
   Tab, 1 2 3, E. Everything else already matched (Q raise/lower, right-click hold quick look, E interact, Shift hurry).
5. **Walk bot** (scratchpad): backs up and re-aims when it cuts the corner into an escalator's side — that, not the
   game, is why the Story agent's and my first walk stalled at the Nankai 3F→2F escalator top (5.7, −80.5). Verified:
   a player driving straight at the lane enters it; from beside the balustrade you are (correctly) blocked.

## Verified, no change needed

- **Dock hidden while calibrating**: confirmed visually (`walk-07-calibrating-dev.png`: field lines + floor strip, no
  dock); it drops in with the amber glow at ready (`walk-08c-ready-full.png`).
- **Head spin on escalator riders**: PASS (numbers above).
- **Load time**: 10.9 s quiet.
- **End card stats sane**: before 1:58 min / 148 m / ±10.9 m / 32 s wrong floor; after 4:11 min / 361 m / ±0.4 m /
  0 s; whole trip 6:09 min, 509 m.

- **Verification walk after all fixes** (`walk.v3e`): same flow, arrive t 364 s, end card before ±7.9 m / 26 s wrong
  floor vs after ±0.4 m / 0 s, 508 m; the only `nav:track` events were one legit `drifting` at the Parks 2F hall where
  the bot ignored "Walk out into the canyon", cleared on the escalator. The init-time intrusion clip now removes 735
  triangles (was 12 490) in 151 ms.

## What remains (honest)

1. **Audio is still unverified by ear** (ja-JP voice choice, footstep level, the synthesized vibration buzz). Two
   minutes on real Chrome + Safari before sending.
2. **The canyon detour is a short peek.** Lodestone sends you out to the canyon at the Parks 2F hall and immediately
   back to the indoor escalators (`Turn left` after ~20 m). A player who ignores it and takes the escalators gets amber
   "Turn left" for a few seconds, and the glance keeps saying "Out into the canyon" while riding up 2F→3F
   (`walk-09-canyon.png`) until the 3F landing. Not wrong, slightly odd; the wonder moment depends on the player
   following the phone.
3. **Shop interiors are big and sparse** (25 m-deep CITY 2F units with two shelf walls and a few tables); fixtures now
   match the trade but a deep shop still reads as a hall. Other product kinds (gadget, souvenir, cosme) keep the
   upright "packs" — fine for those trades.
4. **Viaduct end from the platform**: the wide station deck now stops at z 168 and the narrower massing viaduct carries
   on; from the platform ends this is ~60 m away and reads as a throat, but nobody has looked at it on a real GPU.
   Departing / arriving Nankai cars appear/disappear one by one at that point (~150 m from the platform, ~230 m from
   the gates).
5. **First-frame variance**: one loadprobe took 66 s (first frame 56 s) between two at 10.9 / 11.3 s with no code
   change in between — SwiftShader shader compile under load. Not a regression, but on a slow laptop the "Drawing the
   first frame…" stage is where time goes.
6. "Look around" tutorial step validates late for a bot (needs ≥ 1 rad of yaw); real players will clear it in seconds.

## Would this impress the team? **8.5 / 10**

The opening is now a real game opening — the tutorial is the story, Aya waits for you, the offer lands because you
said you were lost, and Lodestone's install → calibration → reveal still lands. With the false amber gone from the
longest walk, the "keeps me on track" promise is credible instead of nagging. Top 3 risks:
1. **Audio on someone's machine** (no ja-JP voice → chime + captions only; footsteps/PA balance unheard).
2. **Lodestone guidance edge cases** a real player will find that a bot doesn't (side halls, the canyon peek,
   standing in a crowd at an escalator mouth); thresholds are reasoned, not playtested.
3. **Frame rate / crowd density on a laptop at `high`** (still unmeasurable here; SwiftShader only).
