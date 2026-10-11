# v11 critique (critic + fixer)

**Whole demo: 8.5 / 10** (v10: 8). Before my fixes I'd have given it **8**: the round's work is good, but on a landscape
phone the Lodestone 3D reveal (the moment the demo exists for) was invisible, and two smaller tells remained.

What v11 got right: Aya no longer knows where you are. The root fix is in her words and in `DEMO.md`, not just a few
reworded lines. The photo beat is the best new idea since the canyon: in my normal run she said *"omg that's Namba CITY
2F, by Mokume Living!"*, and the Mokume Living sign really is in the top-left of the photo
(`critic/2-photo-recognised-normal.png`). Silence while walking dropped from 80–145 s to **45 s** in every browser
persona, at about one text a minute. The share card sells the quest, not the twist. Phones are now a real platform:
the touch walk got from Begin through Maps, the gate (Use pill), Lodestone Get, pause and the end card with
`ctx.errors []`.

Shots: `notes/v11-shots/critic/`. Walk shots: `/home/user/namba-shots/walk/cn-*` (normal), `cw-*` (wander).

## 1. Scorecard

| # | Item | Before my fixes | After | Evidence |
|---|---|---|---|---|
| 1 | Share card: quest, not twist | **fixed** | fixed | `critic/1-og-550.png`: なんば, "Six floors, four stations, one tempura lunch. Can you find it?", Aya's Meet text on the phone. No Lodestone, stack or "magnetic" in og.jpg, the meta tags, the title or the loader (grep: 0 hits). |
| 2 | Not too silent | **partly**: 45 s on the normal run, but the after-Lodestone pool was only proven in the sim, and the queue could go backwards ("we're next" … then "I'm 2nd in line!!") | **fixed** | Browser, longest silence while walking: normal **45.3 s** (0.97/min), wander **45.4 s** (0.98/min; was 144.9 s). The wander thread now reads "2nd in line → almost our turn → we're next" in order. |
| 3 | Aya can't know where you are | **mostly fixed**: 18 lines reworded, the audit regex in storysim. One tell left: the noren line "you must be close now??" fires at exactly 45 m from the door, so it's always right | **fixed** | 0 audit hits in every storysim and walk thread. The noren line no longer guesses. The photo beat recognises only what is in frame (verified visually). |
| 4 | Critiques explain the grade | n/a | done | §6 below. |
| 5 | Announcements audible | **partly** (code and numbers good; speech level unmeasurable headless; captions low contrast on CITY's white ceilings; 6 JA lines stiff) | **partly** | Beds −6 dB, PA duck −15 dB, area PA in every zone with captions (agent's numbers, `notes/v11-audio.md`). I gave the ambient caption a faint smoked backing, moved it below the tutorial strip on phones, and rewrote 6 Japanese lines. Still needs Zack's ears and a native read. |
| 6 | Mobile / tablet | **partly**: playable, but the compact phone hid the Lodestone 3D (hero and 3D view), Pause collided with the tutorial hint when the phone was up, PR 1.5 gave phones 40% more pixels than desktop low | **mostly fixed** (§3, §5): pause and pixels verified; the compact 3D fix is in, but not yet seen in a browser | `critic/6-before-compact-lodestone-no-3d.png`, `critic/6-after-touch-photo-and-pause.png`, `critic/6-tablet-photo-by-touch.png`. Real-device fps still unmeasured. |

## 2. Runs (final code unless marked)

| Run | Result |
|---|---|
| `node tools/storysim.mjs` | **19/19** (after my edits, with the sim now emitting "I'm 2nd in line!!" like demo.js) |
| `walk.mjs` normal (code from before my story edits) | offer `floors` 152.8 · arrive 496.5 · photo recognised at 119.3 (*by Mokume Living*) · chips 989 / **0 bad** · timers **[]** · silence **45.3 s** · 8 engagement (0.97/min) · `ctx.errors []` |
| `walk.mjs &wander` (final) | `lost` offer 103.5 · arrive 550.5 · On track 68% · 0:26 off · chips 1099 / **0 bad** · timers **[]** · silence **45.4 s** (was 144.9) · 9 engagement (0.98/min) · `ctx.errors []` |
| `walk.mjs REPLY=none` | **not re-run** (slots went to the touch passes). The sim covers it (`never replies, walking steadily`: silence 40 s, 0 timers), and nothing in my changes touches the unanswered paths. |
| `touchwalk.mjs` 844×390 (agent's code, loaded before my fixes) | Begin by tap · look 119° per 3 swipes · stick 3.5 m · jog by pushing past the ring · 5 chips by tap · Maps place tap → café · **Use pill at the gate** ("Tap your ICOCA", 300×56) · Lodestone Get (216×82) · calibrating · end card scrolls (505/390) · links `_blank` · pause/resume by tap · `ctx.errors []`, console `[]`. **3D view: TAP MISS** (the bug in §3). |
| `touchcheck` (mine, scratch) 844×390, final code | 📸 by touch ✓ · pause clear of phone and hint ✓ · Maps dock and place tap ✓ · end card ✓ · `ctx.errors []`. The Lodestone part is invalid (harness, see §5). |
| `touchcheck` 1180×820 tablet (first tablet pass ever) | Begin, phone, chips, 📸 by touch ✓ · pause ✓. Stopped after the Get tap to free the slot for desktop checks. |
| `touchperf` variants | §5 |
| `loadprobe` / `mouseshot` (final) | `READY 127.1s []` · mouseshot: free chip, pause, links `_blank`, backdrop resume (locked), phone chip, `errors []` (desktop unchanged) |

## 3. Fixes (files)

| File | Change | Why |
|---|---|---|
| `js/ui/phone/lodestone.js` (`_bands`) | On the compact phone, the stack view frames the 3D into 140 px → 150 px from the bottom (it was 150 → 296 of a ~430 px screen: a negative band, so the mask hid everything). | On a landscape phone, the reveal hero and "3D view" showed no 3D at all: only a list of steps. That's the demo's money shot. |
| `css/touch.css` | Compact stack view: the steps sheet hides (the instruction card already says the next step), and the Route/Me/Done controls drop to just above the dock. With the phone raised, Pause moves into the bottom row left of Run + Phone (it sat on the tutorial hint). On short screens, PA captions start at 70 px, below the tutorial strip. | Seen in `critic/6-before-compact-lodestone-no-3d.png` and `critic/6-before-pause-over-hint.png` |
| `js/main.js` | Phones: `maxPR` 1.5 → **1.25**, `distFloor` 0.45 (tablets 0.5). | 1.25 gives the same pixel count as desktop low; see §4 for before → after |
| `js/render/visibility.js` | The call governor's floor reads `engine.quality.distFloor` (default 0.55, so desktop is unchanged). | Lets the mobile tier pull far chunks in further when over budget |
| `js/game/story.js` (`_engageLine`) | Queue-progress lines ("almost our turn", "we're next") wait until "I'm 2nd in line!!" has gone out, then come first. Each pool line is used once, by index. | The queue went backwards in a long walk |
| `js/game/script.js` | +3 after-Lodestone lines (candy from the old lady, the anago envy, "they just sold out of kisu 😱 hurry lol"). Noren line → *"I'm right by the door btw, look for the noren with 天 on it 👋"*. | Gating 2 queue lines would otherwise empty the pool on long walks (sim: 132 s silence before the extra lines, 46 s after). An always-right "you must be close now??" was the last uncanny tell. |
| `tools/storysim.mjs` | The demo stub has `_sent` and emits "I'm 2nd in line!!" under 170 m, as demo.js does. | The sim must model the queue gate |
| `js/audio/phrases.js` | 6 JA lines made more natural (and their EN): luggage (…のご迷惑にならないよう), the arcade walkway (通路が大変混み合っております), both lost-child notices (〜を着た / 〜をかぶった … カウンターまでお越しください), the Parks garden (どうぞ、お散歩をお楽しみください), the Nankai gap line (電車とホームの間が、広く空いております). | Read stiffly or as machine Japanese |
| `css/game.css` | The ambient (PA) caption gets a faint smoked backing (rgba .38 + blur). | On CITY's white ceilings it was illegible (`notes/v11-shots/audio/area-pa-caption-city2f.png`) |

## 4. Aya, read as Zack would (items 2 and 3)

**Wander thread (final code), the hardest case:** Landed?? · yay!! · Meet me… · latte ask · 🥹🙏 · *you ok? 😊* → All good
· yay 😌 · *how's my latte coming? 👀 the line is moving* → I'm lost 😭 · *lol I knew it 😂 install Lodestone* · *did it
install? 😌 it even knows which floor my latte is on* · tempura smell · prawn flip · melon pan kid · the menu · *me: got
your latte! ☕ on my way* · *omg you're an angel* · **I'm 2nd in line!! → ok it's almost our turn 👀** · canyon advice ·
**the couple in front just got seated!! we're next 😍** · sweet potato · starving · *I'm right by the door btw, look for
the noren with 天 on it 👋* · THERE you are 🥹…

- **Knowledge:** 0 lines claim to see you. She knows time ("how's my latte coming?"), what you said ("lol I knew it",
  "omg you're an angel" answers *your* text) and photos. The latte reply answering the player's own text is a small,
  very good touch.
- **The photo beat, both cases:** recognised (browser normal run: *"omg that's Namba CITY 2F, by Mokume Living! the
  café's one floor down 👇 escalator behind you"*, and the sign is in frame); "could be anywhere" → retry → recognised,
  and two useless photos → *"lol ok I'll stop playing detective 😂"* (storysim, 3 scenarios; the agent's browser shot
  `notes/v11-shots/aya/photo-blur-floor.png`). By touch: §5.
- **Uncanny timing:** the triggers are still location-based, but the words are now neutral:
  - the photo ask on entering CITY is fine (asking is never uncanny);
  - "heads up: Maps never knows floors in these malls" works as a general tip;
  - "you must be near Parks by now?" (the `parks` offer at < 300 m) is a guess with a question mark at a coarse
    distance, so I kept it;
  - "you must be close now??" at exactly 45 m was the one that would always be right, so it's now an instruction ("I'm
    right by the door btw…").
- **Recognition honesty, one nuance:** my touch harness teleported facing a wall, and she still said *"by OSAKA
  UNIFORM!"*. The shop's door was inside the 22 m / ±35° cone, but its sign is barely legible in the 360 px photo
  (`critic/6-tablet-photo-by-touch.png`). A real player usually frames a view, so this is rare. Tightening the cone to
  about 15 m, or requiring the sign face to point at the camera, would make it bulletproof.
- **Spam:** 0.97–0.98 texts/min, never over an open question. After Lodestone it's 6–9 one-liners in a row that you
  can't answer. Charming the first time; on a 9-minute walk it starts to read like a script. That's the next thing to
  improve (§6).

## 5. Mobile (item 6), emulation

All runs used Playwright mobile emulation (`isMobile`, `hasTouch`), real touch events (CDP / `touchscreen.tap`), and
SwiftShader.

| Check | 844×390 phone | 1180×820 tablet |
|---|---|---|
| Begin, look, stick, jog, the phone button, chips, dock | ✓ (touchwalk) | ✓ Begin by tap, the phone button, chips |
| **📸 Send photo chip by touch** | ✓ chip 99×39 (+ an invisible margin = 51 px), image bubble 176×85, reply *"that's Namba CITY 2F, by OSAKA UNIFORM! keep straight, Parks is at the far end 👉"* (`critic/2-touch-photo-ask.png`) | ✓ chip 120×47, image bubble, *"that's Namba CITY 2F, by OSAKA UNIFORM! keep straight…"* (`critic/6-tablet-photo-by-touch.png`) |
| Maps place tap | ✓ (a row of 242×56 → the café as destination) | not reached (run stopped for time) |
| Gate **Use** pill | ✓ "Tap your ICOCA", 300×56 → open (`critic/6-touch-gate-use.png`) | n/a (scripted only at 844) |
| Lodestone Get | ✓ 216×82 → installing → calibrating → ready | Get tapped (261×100); install not reached (harness) |
| **3D view tap / reveal 3D** | ✗ before: the stack view had no 3D at all, and the 3D button was never visible (`critic/6-before-compact-lodestone-no-3d.png`). After: **unverified in the browser**. My check harness forced the photo ask before Aya's hello, so the hello stayed pending, and the Lodestone install never ran in either of my compact runs. The fix is CSS plus band numbers, and the logic is straightforward, but **the lead should eyeball the reveal on a phone (or `touchwalk.mjs`, step 11/12) before calling it done** | not reached |
| Pause vs the raised phone | ✗ before: on the tutorial hint (`critic/6-before-pause-over-hint.png`). ✓ after: in the bottom row left of Run, no overlap (rect check), `critic/6-after-touch-photo-and-pause.png` | ✓ no overlap (pause 602–646 px, phone from 814 px) |
| End card | ✓ scrolls (505 in 390), buttons 200×44 / 141×44, links 410×53 `_blank`, Keep exploring by tap (`critic/6-touch-endcard.png`) | not reached |
| Errors | `ctx.errors []`, console `[]` in all three phone runs | none seen up to the stop |

**Performance (`touchperf` poses, 844×390 @3x, the same session, the governor reset per variant):**

| Pose | Before: PR 1.5, floor 0.55 (1266×585 = 0.74 MP) | After: PR 1.25, floor 0.45 (1055×487 = 0.51 MP) |
|---|---|---|
| start (3F platform) | 572 calls · 745k tris | **288** · 723k |
| Nankai gate | 329 · 276k | **290** · 233k |
| CITY 2F | 478 · 265k | **313** · 238k |
| canyon | 632 · 499k | **434** · 462k |

Pixels drop 31% (now equal to desktop low's 0.52 MP), and calls drop 12–50%. Desktop is unchanged (`distFloor`
defaults to 0.55 and isn't set off touch). Caveat: this is one sample per pose, and a lower floor means far chunks drop
out sooner when over budget (indoors, ≥ 25 m stays drawn). I couldn't eyeball CITY 2F's long street for pop-out in
time; `distFloor` in `main.js` is the one-line lever.

## 6. Why 8.5 (and not 8 or 9)

**What earned the points.**
- **The story is honest now** (+): Aya's knowledge is principled, documented in `DEMO.md` and enforced by a regex in
  every sim scenario. An Oriient engineer can't catch her "seeing" a dot any more.
- **The photo beat** (+): a real, player-driven interaction that a friend would actually do. It names what is in the
  frame and fails gracefully ("could be anywhere"). It is also the first time the player *gives* information instead
  of only receiving it.
- **No dead air** (+): 45 s maximum silence in all three measured personas, at under 1 text/min, with 0 timer fires and
  0 bad chip checks.
- **Reach** (+): a LinkedIn visitor on a phone can now play: rotate prompt, touch controls, a Use pill that mirrors the
  prompt, a tappable phone, a usable end card. The share card sells the premise, not the punchline.
- **Kept invariants**: v9 turn-taking, v10's no-clock rule, the fair end-card rows, `ctx.errors []` everywhere.

**What cost points** (from a 10).
- **−0.5: real-device mobile is unmeasured.** Everything is emulation on SwiftShader. Draw calls on a phone are the same
  as desktop low (~350–630). A mid-range Android could sit at 15–20 fps, and the first LinkedIn impression would be a
  slideshow. My PR cap cuts fill by about 30%, but CPU-side calls barely moved.
- **−0.25: the area PA is reasoned, not heard.** The speech level can't be measured headless, the Japanese lines are
  agent-written (I fixed six; a native read is still needed), and about one notice a minute in each area plus train
  lines may feel busy.
- **−0.25: engagement after Lodestone is a monologue.** Up to 9 chip-less one-liners. They read as a friend, but
  nothing asks for you, and nothing uses Lodestone ("which floor are you on now? 😌" with a 📸 chip would).
- **−0.25: mobile Lodestone is cramped.** I fixed the hidden 3D, but the compact guide view still gives the 2D map a
  thin band between the instruction card and the trip card. The full route by touch to Daikichi (`--full`) was never
  run (over 50 min headless).
- **−0.25: visuals unchanged since v9.** Low-poly people, flat signage, SwiftShader-era materials. The story now
  outruns the rendering.

**To reach 9, ordered by impact per effort.**
1. **Ask Zack for one real phone session plus PostHog `namba_perf` with `input: touch`** (the lead adds the super
   property in `analytics.js`). If the median is under 30 fps, cap indoor static chunks by distance on mobile
   (`visibility.js`), and drop shadows and post entirely on phones. *Small effort, decides whether mobile is a feature
   or a liability.*
2. **A native read of the JA PA lines and Zack listening on the platform and in CITY** with headphones; tune
   `AREA_PA.every` if it's busy. *15 minutes.*
3. **Make 2 of the after-Lodestone texts answerable**: "is it working? 😌" (chips: *it's magic 🤯* / *still lost
   😭*), and a mid-Parks "send me a pic of the canyon 🌿" that reuses the photo beat and the `canyon` recognition line.
   *About an hour; it turns the monologue into the demo's best conversation.*
4. **Compact guide view**: collapse the trip card to one row on `ph-compact` so the floor map gets about 120 px. *An
   hour.*
5. **Run `touchwalk --full` overnight** (or on a faster box) to prove the touch route to the end card. *Machine time
   only.*

## 7. Top 3 risks

1. **Phone frame rate on the LinkedIn launch.** It's unmeasured. If a typical Android gets about 15 fps, mobile
   visitors bounce at the title. Mitigation: PostHog `namba_perf` split by `input`, plus the levers in §6.1. Don't
   post widely before one real-phone sample.
2. **The PA may now be too present.** Area notices about every 40–80 s in every zone, train lines on platforms,
   and Aya texting about once a minute. Zack may find it busy rather than realistic. Each interval is one line in
   `AREA_PA`.
3. **Location-timed beats are still location-timed.** The words are clean now, but the photo ask on entering CITY and
   the `parks` offer at < 300 m still fire on true position. A sharp viewer who notices the timing could still ask how
   she knew. The defence is that every one of them is a question or a guess.
