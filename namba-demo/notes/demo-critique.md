# Demo critique: final critic (ship day)

Evidence is in the scratchpad folder `critic-demo/`:
- `walk.mjs`: a full-route play-test that drives the player's input (forward plus mouse-look yaw along the nav flow field). It never teleports.
- `walk.out`: the run log (beats, turn-by-turn changes, events, stuck log).
- `shots/w-*.png`: screenshots taken during the walk.
- `tbt.mjs`, `tbt2.mjs`: offline repros of the guidance output.

All shots are `quality=low&noaudio&nopost`. I took no high-quality hero shots because the time box ran out. The other agents' high/medium shots are in `demo-flow/shots` and `demo-phone/shots`.

## The full-route walk: what actually happened

The run walked from spawn `start` to Daikichi at walking speed (no Shift), with the ordinary map first, the natural offer, Lodestone, arrival and the end card. Times are the demo's own clock (`demo.t`, real seconds of play).

| t (s) | beat |
|---|---|
| 0 | Spawn on the Nankai 3F platform. The intro hold is 4.6 s. |
| 8.0 / 10.8 / 12.4 | Aya's two texts arrive, then the quest goes active. Fine. |
| 0–61 | A straight ~90 m walk down Platform 4 to the gates at 1.5 m/s. Nothing happens apart from Aya's texts and PA announcements. |
| 58 | Nudge 1 ("Where are you??"). |
| **64–~140** | **STUCK at the Nankai 3F gates `g_nk_central` (x −19.5, z −66).** The flow-field line leads into an ENTRY-ONLY lane. `game._refuse` pushes the player back (10 refusals logged), and the caption "Red ✕ — this lane is entry-only" appears **twice, stacked** (`w-04-maps-wrong-full.png`). The bot only got out by random strafing during the install. |
| ~62–74 | Maps (opened with Q) shows "2F · Approximate location (±8 m)" while you stand on 3F. The wrong floor is good and funny, as intended. |
| 96 | Nudge 2 ("Ask your phone!"). |
| **135.0** | **Offer fires (`why=time`)**, with 411 m left, still at the gates. The "lost" rules never fired after 70 s of zero progress, because no rule covers "not moving". |
| 138.7 / 140.8 / 144.2 | installing → calibrating → ready. The whole upgrade takes 5.5 s after the tap. It looks good: `w-07-calibrating-full.png`, `w-08-ready-reveal-dev.png`. |
| 147.2 | Aya: "see? 😌 6F, I'm 3rd in line". |
| 151.6 | TBT shows `Escalator down 3F→2F` at 18 m, then `Continue into Namba CITY 2F`. **Correct.** |
| **167.6–178** | **While riding the DOWN escalator, TBT shows `Escalator up · 2F → 3F`, and total/ETA are NaN.** This is wrong at the very first maneuver after the install (details in B1). |
| 178.8 / 184.6 | Arrive on 2F and enter Namba CITY. TBT shows `Cross the bridge` at 252 m: correct, but then there is **no new instruction for ~200 s** (Namba CITY 2F is one long corridor). |
| 340.6 | Aya: "I'm 2nd in line!!". |
| 383.8–384.1 | Enter Parks (bridge). TBT shows `Escalators up 2F→6F · 4 flights` at 32 m. **Correct.** |
| **405–458** | **Indoor escalator stack at x = −3 (esc_pk_23…56), 14 s per flight. The player never enters the canyon** (`parks_canyon` is at x 22–52). No `canyon` discovery fires and there is no sky: `w-09-canyon.png` is an indoor escalator under a ceiling. |
| 434.6 | Aya: "You can see the noren from there, right??". It fires while you are on the 4F escalator (45 m of *path* left). Minor. |
| 458.5 | Arrive on 6F. TBT shows `Arrive at Tempura Daikichi · on your right · 6F`, 21 m. **Correct**, including the door side. |
| 467.4 | `demo:arrive` triggers correctly (rem 8 m). Aya is picked and waves (`w-11-arrive-noren.png`). |
| end card | Before: **2:24 / 122 m / ±7 m / 24 s wrong floor**. After: **5:23 / 416 m / ±0.5 m / 0 s**. Total 7:47 and 539 m. Zero `ctx.errors` and zero console errors. |

Stuck events: only the gate (35 consecutive 2-second windows). Escalators, the bridge, the Namba CITY crowds (≈400 agents) and the 6F approach were all traversed without sticking. The crowds slow you to ~1 m/s in CITY 2F.

---

## (1) SHIP BLOCKERS

**B1. Lodestone gives a wrong instruction and shows "NaN" while you ride a down escalator.**
- Repro (offline, 1 s): `node critic-demo/tbt2.mjs`. Any body with `ramp: 22` (esc_nk_4_0, the down escalator on the sacred route) gets `Escalator up | 2F → 3F` with `total=NaN eta=NaN`. In the sheet that becomes "NaN metres" and "NaN min".
- This happens 20 s after the reveal, which is the first moment the Oriient team will judge "turn-by-turn that is actually right".
- Cause: `ui/phone/routes.js routeLegs()` starts with `inRamp = -1` even when the start node `v` is itself a ramp node. The next ramp node is therefore treated as a new ramp mouth, and `leg.level` is the ramp node's lower level (2F), so `dir` comes out as +1 ("up 2F→3F"). The leg has 1 point, which produces the NaN.
- Up escalators happen to work: at 2F (−3, 223) on ramp 25 the output is correct.

**B2. The end card visually says Lodestone was slower.**
- The Time row shows 2:24 "lost, searching" against **5:23** "to get there".
- The Walked row shows 122 m against **416 m**.
- The bars are proportional, so the blue "after" bars are 2–3× longer than the amber ones.
- This is structural, not bad luck: the offer fires at ≤135 s and the after-phase covers most of the 520 m route. Any player who is not dramatically lost will see the same thing.
- The two rows meant to prove the point argue the opposite, on the slide this audience will screenshot.

**B3. The guided route skips the Namba Parks canyon, which is the brief's "wonder moment".**
- Lodestone's shortest path runs bridge → `parks_2F_main` → the indoor escalator bank at x = −3 → 6F.
- The canyon (`parks_canyon`, x 22–52) is never entered. The `canyon` discovery card never fires, and at most you get a glimpse down the 20 m `canyonview` corridors.
- DEMO.md calls "canyon → Parks escalators" part of the sacred route. As built, a player who follows the hero app never sees the best-looking part of the build.

**B4. The fare-gate lane trap at 1:00.**
- Walking the natural line from the platform puts you in an entry-only lane of `g_nk_central`. The player is bounced back on every frame, and two identical captions stack up.
- A human will eventually sidestep. But "the game's collision is broken" is the first impression 60 s in. Worse, Lodestone's route (`fieldNoEntry`) also ignores lane policy, so the precise indoor app can steer you into a wrong-way gate.
- Repro: walk.mjs, or walk straight from `start` toward (−19.5, −66) on 3F.

**B5. The contact line is still a placeholder.**
- `game/script.js ENDCARD.contact = 'contact: zack@…'` renders on the end card in front of the hiring team.

**B6 (borderline). PA subtitles are broken both ways.**
- With audio OFF (or `noaudio`): `ui/hud.js` captions EVERY transit `announce` event worldwide. Walk evidence: ~120 `announce` events. On Parks 6F during the Aya moment you read "The Airport Exp. for Kansai Airport is departing from track 3" (`w-11-arrive-noren.png`; also `demo-flow/shots/H-arrive-aya.png`).
- With audio ON: `hud.js` skips captions because `audioCaptions()` is true, and `audio/trains.js` passes `caption:false` ("the HUD already subtitles…"). So the Japanese PAs, including the "Namba, Namba, last stop" intro, have **no English subtitle at all**.

## (2) TOP 8 QUICK WINS (each under 30 min, ordered by impact)

1. **Fix B1** in `js/ui/phone/routes.js routeLegs()`.
   - Initialise `inRamp = nav.rmp[v] >= 0 ? nav.rmp[v] : -1`.
   - When `v` is a ramp node, set the first leg's level to the level the field descends to: walk `stepNext` until a non-ramp node and use its level.
   - Belt and braces in `lodestone.js _renderSheet`: if `!isFinite(R.total)`, reuse the last good route.
   - Verify with `tbt2.mjs`: every row should read "Escalator down 3F→2F" or "Continue into Namba CITY", with finite totals.

2. **Fix B2** in `js/game/endcard.js` (the `rows` array).
   - Put **Position error** and **Wrong floor** first: those are the honest wins.
   - Drop the proportional bars from the Time and Walked rows, or replace those rows with a "Progress per minute" row. Before = (initial remaining − remaining at ready) / minutesBefore, using `demo._lost.init` and `_lost.rem` at `readyT`. After = remaining at ready / minutesAfter.
   - Rename the after caption from "to get there" to "door to door, zero wrong turns".
   - A cheap alternative: compare "re-routes / floor flips" (the phone's `reroutes` and `floorFlips` fields already exist).

3. **Fix B3** in `js/ui/phone/guidance.js` and `lodestone.js` with a scenic via-point.
   - While the player is on 2F with z < 222 and has not yet visited the canyon, compute the route to the canyon mouth (2F ≈ (33, 222), `parks_canyon`) and then from there to Daikichi. That means a second `fieldNoEntry` and two `routeLegs` concatenated, adding roughly 60 m.
   - Show it as a step: "Through the Parks canyon · then escalators 2F → 6F".
   - Have Aya text at `parks_bridge`: "take the canyon side, it's gorgeous 🌿".
   - The `canyon` discovery card (`game.onDiscover`) then fires naturally.

4. **Fix B4.**
   - In `js/world/transit/gates.js:96`, return `'both'` for every lane of `g_nk_central`, or for all lanes in the demo build. The fix is one line.
   - In `ui/hud.js caption()`, dedupe a caption whose text is already on screen. The `_refuse` throttle (1.8 s) is shorter than the caption's 3.4 s life, which is why it stacks.

5. **Add a "stalled" lost rule** in `js/game/demo.js _isLost()`.
   - If `L.best` has not improved by ≥ 8 m in the last 25 s (keep a `bestAt` timestamp in `_checkRoute`) and `t ≥ offerMin`, return `'stuck'`.
   - Today a player stuck at a gate, or dithering in the Nankai concourse, waits for the 135 s timer. The offer should land the moment the frustration peaks, which is the brief's "earlier if clearly lost".

6. **Caption hygiene** in `js/ui/hud.js` (fixes B6 and the arrival clutter).
   - In the `'announce'` handler, drop the `audioCaptions()` early return.
   - Instead, skip announcements when `a.level !== player.level` or when they are more than ~60 m away, the same rule as `audio/trains.js:226-232`.
   - While `ctx.game.busy` (the arrival moment), suppress PA captions, `hint()` pills and chapter cards.
   - Move the message toast (bottom-right) so it doesn't sit on the caption band. The flow agent's `I-arrive-counter.png` shows the chef's line cut off under the toast.

7. **Make Aya unmistakable** in `js/game/demo.js _pickAya()`.
   - The picked agent is a random crowd member. In my run the waving "Aya" reads as a man in a black suit (`w-11-arrive-noren.png`).
   - When picking, override her appearance: female body or hair, and a bright, unique jacket colour. Use whatever fields `npc/sim` uses for outfit and colour.
   - Turn the camera so she is centred: today the name-tag dot sits between two people.

8. **Add link-preview meta** to `index.html`.
   - The URL will be sent to Oriient by email or Slack and currently unfurls bare.
   - Add `og:title` ("Lost in Namba"), `og:description` and `og:image`, with the image being a 1200×630 title screenshot committed next to `index.html` (high quality, the `demo-flow/shots/T1-title.png` framing). Add `twitter:card=summary_large_image`.

Runners-up (also cheap):
- **Destination label clipped in the hero view.** "Tempura Daikic…" runs off the stack's right edge in the reveal (`w-08-ready-reveal-dev.png`, `w-08c-ready-full.png`). Clamp the label inside the canvas in `stack3d.js`.
- **Wrong icon on escalator steps.** "Escalator down" is shown next to a big orange ↑ (the live heading arrow) for the 12+ m before the ramp. In `lodestone.js _renderSheet`, use the ramp icon for ramp steps and keep the live arrow for walking steps only.
- **Invisible contact name.** The Messages header "Aya" is almost invisible: white on a light header (`w-05-offer-full.png`).

## (3) Leave for later

- **The platform walk.** The opening ~60 s is a straight walk down Platform 4, which is long for a 5–10 min demo. Options: spawn nearer the platform's concourse end, or have the intro end facing the gates with a "Shift = hurry" hint.
- **Thin turn-by-turn.** About 250 m of Namba CITY 2F has no maneuver. It is correct, but a landmark step ("Pass Namba CITY 2F, 180 m") would show off "it knows where you are".
- **Mistimed noren line.** Aya's "you can see the noren" fires on the 4F escalator. Gate it on `level === '6F'`.
- **Calibration readout overflow.** The strip `.ld-c-read` overflows at narrow phone widths ("µTANCHORS", "1,026FLOORS" in `demo-phone/shots/03b`). At 1024 px wide it fits.
- **Arrival framing.** The counter shot is blocked by foreground heads (flow agent's `I-arrive-counter.png`). Nudge the camera target or hide agents within 1.2 m of the camera during the moment.
- **Parks escalator moire**, and Parks interiors drawn from the canyon (see `demo-world.md`).
- **Unmeasured performance.** Real-GPU frame time at `quality=high` was never measured. Someone should play it once on a real laptop before sending.
- **Mobile.** The touch path is untested on a device.

## (4) Would this land with Oriient's team?

Mostly yes, and the reasons are good ones. It is a believable, original Namba. The ordinary map fails in exactly the ways their customers complain about: the wrong floor in the station, a ±8 m halo, "directions will appear once we detect you on 2F". The upgrade is fast (5.5 s from tap to a true dot) and looks like a product: the field-line calibration and the exploded floor stack with the route climbing the real escalators. Arrival and the end card close the story with their own tagline.

But this audience lives inside indoor-positioning edge cases. The three things most likely to be noticed are all in the thing they care about:
- the turn-by-turn says "Escalator up" and "NaN metres" while you ride *down* the first escalator;
- the hero app routes you into a wrong-way fare gate and past the canyon;
- the measured-live end card shows the after-phase bars longer than the before bars.

Each is a 15–30 minute fix (quick wins 1–4). With those fixed, plus the real contact line, it reads as someone who understands that "the value is not the blue dot, it's what it unlocks". Ship today, but not before B1, B2, B4 and B5 are fixed and B3 at least has the Aya "take the canyon side" text plus the via-point.
