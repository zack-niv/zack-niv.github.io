# Wayfinding (signage + phone) — experience critique (critic-exp, round 1)

**Verdict:** the signage system is conceptually the most "Namba" thing in the build: operator politics, real families, truthful arrows from the nav field. The phone UI looks and behaves like a real indoor map app. But the phone answers the coffee quest in one tap. The signs are truthful to the *nav graph*, not to the fare gates, so they send street-bound people through the ticket barriers. And the phone's ETAs are in the wrong timebase.

**Score: 5.5 / 10** for "getting lost is fun".

How this was reviewed: headless play from the title screen; the phone opened with KeyQ (`shots/b01_phone_open.png`, `c_0*.png`, `d_*.png`). I reproduced the phone search ranking in Node (`critic-exp/search.mjs`, the same formula as `mapapp.search`) and traced every sign destination's nav path for fare-gate crossings (`critic-exp/paid.mjs`). An in-page sign-coverage audit along the three quest routes is queued (run b05). This file will gain a coverage table when it lands.

---

## Top 10 issues (ranked by impact on the player's feeling)

### 1. The phone solves the coffee quest in one tap
- **Evidence:** search "coffee" from platform 4 at 10:45 (also the "☕ Coffee" chip, one click) gives **#1: Wakakusa Coffee Stand ★4.7 (1,284 reviews), B1, open, 146 m**. #2 is Café Komorebi ★4.3, #3 Kissa Rondo ★4.3. Then "➤ Directions" walks you there floor by floor. The ranking `sc = open·2 + rating − crow/500` puts the hand-made quest target on top because its rating is hand-set to 4.7, above the generated pool's ceiling of 4.4 (`directory.js`: `3.0 + r()·1.4`).
- **Why it matters:** the vision says the map should be "useful but captures indoor-navigation ambiguity". As built, the quest is "type coffee, follow the blue line". Aya's lovely hint ("a tiny standing coffee bar somewhere in the underground passage between the subway and Nankai… No chairs. Always a queue") becomes irrelevant. Nobody reads a sign.
- **Fix (make the phone honest but not oracular):**
  1. Data: list Wakakusa in Japanese only (若草珈琲) with **38 reviews and ★4.9**, category "Coffee stand", and no English name. Let the top results for "coffee" be chains and big cafés with thousands of reviews. That's how Google Maps actually behaves in Namba, and the player has to *notice* the small 4.9.
  2. Search terms: "coffee" ranks by review count × rating (popularity), not rating, so the gem sits around #5–8, below the fold.
  3. Location fuzz for small underground shops: pin Wakakusa's map point 15–25 m off (on the wrong side of the passage, or on 1F above). The "You have arrived" banner fires at the wrong place, and the player must find the real counter by sight, via its queue and its sign.

### 2. Signs route street-bound people through the ticket gates
- **Evidence:** in `critic-exp/paid.mjs` (nav shortest paths for every non-line sign destination), from the **Midosuji south free concourse**, 10 destinations, among them every street exit (1, 15, 18, 21, 24), NAMBAWALK, Takashimaya, street level, lockers and taxi, route **through the Midosuji paid area and the B2 platform**. From the north free concourse, Namba CITY and Parks do the same. Visible in `shots/d_1800_mgateS.png`: the South Gate board reads **"↑ ▼B2 出口 1・15"**, telling you to go *down to B2* through the gates to reach a street exit.
- **Why it matters:** "truthful arrows" is the system's selling point, and this is the most confidently wrong sign a real station could have. A player who trusts it taps in, rides an escalator to a platform and finds no exit. That's a maze trick, the thing the vision forbids.
- **Fix:** compute sign fields per *audience*. Destinations of kind `exit/area/facility/street` use a nav field where gate-line edges are impassable (crowd already builds "paid-area penalty" fields; reuse `fields.js`' penalty or cut the gate edges). Only `line` destinations may cross gates, and only from the free side toward their own line. Check with the same script: zero non-line routes crossing a paid area.

### 3. Phone walking times are in real minutes but the clock runs 6×
- **Evidence:** `_routeSheet`: `minutes = R.total / 1.3 / 60` and `eta = clock + minutes`. With `clock.scale = 6`, a 425 m route shown as "5 min · arrive 10:47" actually takes about 28 game minutes. In my bot walk, platform 4 → the Nankai gate (90 m) took 10:42 → 10:55.
- **Why it matters:** the ETA is the phone's most trusted number. When it's off by 5×, the player stops trusting the phone *for the wrong reason*: a bug, not indoor ambiguity.
- **Fix:** see game.md #1 (prefer a 1:1 walking clock). Otherwise multiply by `ctx.clock.scale`.

### 4. The phone covers the centre of the screen
- **Evidence:** every phone-up screenshot (`b01_phone_open.png`, `c_02…`, `d_*.png`): the device occupies the centre ~25 % of the width and ~95 % of the height. `_layout` scales to `innerHeight·0.9/700`, so you can't see what's in front of you while navigating, the exact moment you need both.
- **Why it matters:** real wayfinding is a dialogue between the screen and the world (glance down, glance up at a sign). Cyberpunk's phone and Alyx's wrist UI sit at the edge of the view for that reason.
- **Fix:** hold the phone lower right: a 60 % height device anchored bottom-right, tilted 6–8°, map-only by default. Show the full-screen app only when the search field has focus. Keep the walking hand-sway (good).

### 5. Indoor ambiguity is mostly noise, not geography
- **Evidence:** `positioning.js` sigma is 16 m on B1 and 23 m on B2, with snaps, a 5–20 s floor lag and an occasional wrong adjacent floor. The route recomputes when the *estimate* is > 18 m off the leg. The arrival banner, though, uses the **true** position (`_routeTick`: `real.level === t.level && dist < 7`).
- **Why it matters:** the vision's ambiguity is spatial: "the destination looks close, yet you are on the wrong floor, facing the wrong way, or separated by a whole different part of the complex." Random dot jitter is just irritating, and a true-position arrival quietly removes the real ambiguity.
- **Fix:** shrink the jitter (B1 6–8 m), and keep the floor lag, which is great. Add structural ambiguity: crow-flies distances (already there), a "nearest entrance" line that points to the wrong building door for Parks-level shops, and route legs that end at "Take escalator up to 6F" without saying *which* escalator bank. Fire "You have arrived" from the *estimate*, so it can be 10 m off.

### 6. The map can't show the platform you're standing on
- **Evidence:** `b01_phone_open.png`: the Nankai track pins show **1, 3, 5, 7** only, and the even tracks (2/4/6/8) are culled by label collision. The quest start is "Platform 4".
- **Fix:** draw track numbers as small fixed pins at the platform heads (no collision culling), both sides.

### 7. Sign hierarchy: every sign is a list; no landmark signs, no "you're here" overview at decision points
- **Evidence:** `signage.js` places junction, interval, escalator-mouth and gate signs with 2–4 destination blocks each, and `guide` boards on walls. In the Nankai 3F concourse shot (`d_0830_nkconc.png`) the hanging sign is a row of small arrows. Nothing names the *space* you're in at the threshold (real Namba: big "なんばウォーク 1番街" portals and "南海なんば駅 2階 中央口" fascia).
- **Why it matters:** mental models are built from named places plus arrows. Without threshold names, the player knows where things are but not where they *are*.
- **Fix:** add threshold portals at every zone change (NAMBAWALK entrance arches, Namba CITY "B1 South", Parks gateway), reading the zone's `ja/en` in the operator's style, 1.5× the size of directional signs. Make guide boards (現在地) more frequent at junctions with ≥ 3 exits.

### 8. Directions are floor legs only (good), but the leg end is under-specified
- **Evidence:** the route sheet: "↗ Take escalator up to 2F · Walk 40 m · then continue on 2F". There are several banks per transition (Nankai 1F→2F has `esc_nk_1` and `esc_nk_2`).
- **Why it matters:** this is the right ambiguity, but the banner arrow ⬈ is decorative and the leg polyline is drawn on a map that's often on the wrong floor (lag). That's frustrating, not fun.
- **Fix:** name the bank by a nearby landmark ("escalators by the 2F departure board") from the nearest POI or sign. That makes the player look for the landmark (fun) rather than the line.

### 9. Tempura search at 10:45 ranks the decoy first, which is good, but nothing teaches "closed until 11:00"
- **Evidence:** "tempura" at 10:45 gives **Tendon Tenmaru (open) ★3.5** #1, then Daikichi (★4.6, *Closed · Opens 11:00*), then Kitsune (Closed · 17:00).
- **Why it matters:** this is a nice natural trap. Keep it. The risk is that players pick #1 and feel cheated when Tendon doesn't count.
- **Fix:** in the Daikichi place card, show "Popular times" bars (lunch peak 12–13 h) and a review snippet like "Get there before 11:30 or queue an hour". That uses the phone as *information*, not a pointer.

### 10. Signs aren't readable at a glance at walking distance in the screenshots
- **Evidence:** a hanging sign is `h = 0.42 m` with EN text at `0.2·H`. At 72° vertical FOV and 720 px, 10 m away, that's a 21 px sign with a **≈ 4 px** English line (`d_0830_nkconc.png`, the right-hand sign, is unreadable). The atlas is 136 px/m, so EN glyphs are about 11 px in the texture too.
- **Fix:** raise sign height to 0.5–0.55 m with EN at 0.24 H, and double PPM for the gate and escalator families (they're read from 20 m). Let the post sharpening exempt `sign_face`.

---

## Keep — this works
- **Truthful arrow pipeline** (worker flow fields per destination, ~18 m descent, level-change tags ▲2F / ▼B2). The idea is right; only the field audience is wrong (#2).
- **Operator politics** (Nankai signs never mention NAMBAWALK, Parks signs skip the subway): very Namba.
- **Real conventions**: yellow 出口 blocks, line roundels with colours, 1/2/3番街 colour tags, "Platforms のりば" on the free side. `d_1800_mgateS.png` is a convincing Osaka Metro gate board.
- **Phone look and feel**: the status bar with 4G/5G/圏外, battery drain, floor picker, ghost pins with floor badges, cached per-floor base maps. The "Approximate location (±9 m)" sheet line is a lovely touch.
- **Floor-belief lag** (5–20 s) and the occasional wrong adjacent floor: real and funny.
- **Legs end at the next escalator.** That's the right amount of help.
- **Departures in place cards** via `transit.nextDepartures`.

## Bugs found (with repro)
1. **Fare-gate routing on signs.** Repro: stand at B1 (−116, −72) facing north (the Midosuji South Gate free side). The gate board shows "↑ ▼B2 出口 1・15" (`d_1800_mgateS.png`). `node critic-exp/paid.mjs` lists all 12 offending sign routes.
2. **Phone ETA ignores `clock.scale`.** Repro: search coffee → Wakakusa → Directions at 10:45. It promises arrival around 10:50; the actual walk arrives after 11:05.
3. **Even Nankai track numbers are missing on the map.** Repro: open the phone on platform 4 at start. Only 1/3/5/7 are labelled.
4. **The arrival banner uses the true position while everything else uses the belief.** Repro: route to Wakakusa on B1 with sigma 16 m. "You have arrived" fires exactly when within 7 m of the real door, even while the blue dot sits across the passage.
