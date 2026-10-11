# v10: location-driven pacing (Progression, Opus)

Spec: `V10.md`. Zack: *"genuinely simulate and set expectations on 'how would it work in real life?' when a friend is
waiting for me… BUT also balance that on our storyline and goal here: 'what if we've had a truly useful indoor nav
app'"*.

This builds on v9.1 (HEAD e9dd151) and keeps everything from it: the turn-taking contract, the chip invariant, and the
critic's fixes (the offer answers "I'm lost", the declined-latte arrival line, the pick hint waiting while a question is
fresh, `REPLY=decline` with real keys, the thread dump).

---

## 1. The numbers that shaped the design (measured, v9 walks)

| Moment | Steady bot (1.5 m/s) | Jogger (3.2 m/s) |
|---|---|---|
| Enters Namba CITY | 113 s | 66 s |
| CITY 2F → 1F (the café's floor change) | 260 s | 138 s |
| Enters Namba Parks | 350 s (≈ 290 s without the latte) | 188 s |

V10's expectation model is `route m / 1.25 + 60 s + 20 s × floors`. It gives about **400 s for the latte leg**
(≈ 390 m, 2 floors) and **≈ 400–600 s** for the Daikichi leg. Two consequences:

1. **"Behind expectation" (elapsed > 1.1 × expected) cannot happen before the 240 s cap on these legs.** A realistic
   friend is patient. To keep "behind" meaningful, Aya also reads the **pace of your shared dot**: from 60 s into a
   leg, a projected arrival (`elapsed × route / covered`) past **1.3 ×** her expectation counts as behind.
2. **Parks entry alone can't be the good player's offer moment.** A steady walker who takes the latte reaches Parks at
   about 350 s, after the 240 s cap. So the cap would fire for exactly the players V10 says it should never fire for.
   The honest place on the latte leg is the **floor change in Namba CITY**: the café is on 1F, you're on 2F, and Maps
   can't do floors. That is literally the product's pitch. This is a design addition beyond V10's items 3–4, flagged in
   §6.

## 2. The design as built

**Aya's expectation per leg** (`demo.js`: `_startLeg`, `legState`):

- A leg starts at game start (Daikichi), when the latte is asked (café, from the first nav measurement) and when the
  latte is done or declined (Daikichi again).
- At each start, `routeM` comes from the nav-graph distance, `floors` = |target floor − current floor|, and
  `expected = routeM / 1.25 + 60 + 20 × floors`.
- Each leg emits `demo:leg {key, routeM, floors, expected}`.

**Check-ins** (`story.js` `_checkIn`), which replace v9's 150 s / 175 s Where timers:

- **When:**
  - only when the player is **really lost against the current target** (v9 rules, no progress, not on task): a wrong
    floor for **20 s** (was 7), stalled, or walking away / far;
  - **or behind** (time or pace), which is not silenced by slow-but-steady progress, only within 25 m of the door.
- **Limits:** never before 95 s, at most **2 per leg**, 40 s apart, never over any open question, not within 20 s of
  the latte order, and never after the player has said "Which way?? 😵" (the early offer handles that player).
- **Words come from what she sees:**

| Kind | Daikichi leg | Latte leg |
|---|---|---|
| floor | why are you on {floor}?? 😂 I'm on 6F | why are you on {floor}?? 😂 the café's on 1F |
| stalled | at the station: still at the station? 👀 · else: you ok? your dot hasn't moved in ages 👀 | + the café's on 1F |
| away / far | wait where are you going 😅 Parks is the other way | wait where are you going 😅 the café's the other way |
| behind | Where are you?? The line is moving… (v2's line) | how's my latte coming? 👀 the line is moving |

- **Chips:** *I'm lost 😭* / *On my way!* (latte leg: *Almost there!*).
- **Answers:**
  - *I'm lost* → offer `lost` ("lol I knew it 😂…").
  - *On my way* while behind → offer `behind` ("ok you're taking forever 😂 get this…").
  - *On my way* otherwise → "Ask your phone!", then `checkin` if they really are lost.
  - Unanswered → "hello?? 👀" at 25 s → offer at 45 s (`behind` or `silent`).

**Location beats** (each once, through the v9 contract, deferred while a question is fresh):

| Beat | Trigger | Words |
|---|---|---|
| CITY tip | latte leg, entering a `city_*` space on another floor than the café | ooh you're in CITY! the café's on 1F 👇 right at the bottom of the big escalators |
| **Offer `floors`** | latte leg, in CITY, a floor away from the café, < 150 m to go, ≥ 100 s, ≥ 15 s after the tip | it's one floor down 👇 Maps never knows floors in here though 😅 use this → |
| **Offer `parks`** | Daikichi leg, entering a `parks_*` space, ≥ 100 s | ok Parks is a maze, even I got lost 😅 use this → |
| canyon text | the Parks bridge, as before; now waits until a just-landed offer is 10 s old (dropped if 40 s late) | unchanged |

**The safety net:** the cap is **240 s** (`DEMO.offerAt`). When it fires it emits `story:timer {beat:'offer-cap',
moving, leg}`, and its words fit the place (`parks` / `floors` / `fine`). The `hello` fallback, sent when the player
hasn't walked 8 m by 12.6 s, also logs `story:timer {beat:'hello-start', moving:false}`.

**Logging:** every beat emits `story:beat {id, why}` (`why` = reply / patience / moved / standing / place / the kind / the
offer reason). `walk.mjs` prints `STORY BEATS`, `TIMERS` and `LEGS`.

`demo:offer.why` can now be: `lost`, `checkin`, `early`, `silent`, `behind`, `floors`, `parks` and `time` (cap). The
`ahead` path is gone; `parks` replaces it.

Two additions came out of the decline walk (§4). **`parks` also fires on the approach:** on the Daikichi leg, in CITY,
with Daikichi under 300 m by foot (`DEMO.parksNearM`). **A Daikichi-leg CITY tip:** *"ooh you're in CITY! keep
straight on 2F, Parks is at the far end 👉"*. Without them, a player on the direct leg reaches Parks at 282 s, the cap
fired at 240 s for a moving player, and Aya was silent for 4 minutes.

## 3. Node: `node tools/storysim.mjs` → 12/12 PASS

The sim now models the real route: Nankai 0–170 m → CITY 2F → CITY 1F café at 390 m, or Parks from 430 m. It runs the
same expectation and pace model as `demo.js`, and checks the chip invariant, the "never ask back 'lost'" rule and the
timers on every tick.

| Scenario | Predicted | Got | Timers |
|---|---|---|---|
| silent stander (never replies, never moves) | stalled check-in, then `silent` | *still at the station? 👀* 95.7 → *hello?? 👀* → **144 s `silent`** | hello-start only (didn't move) |
| never replies, walking 1.5 m/s | `floors` in CITY | **167 s `floors`** (CITY tip 119) | **none** |
| instant replier, stuck in CITY | stalled, then *I'm lost* | *you ok? your dot hasn't moved…* 148.5 → **153 s `lost`** | none |
| bot-like steady walker 1.4 m/s | `floors` | **179 s `floors`** | none |
| early *Which way??*, then stuck | `early` at the 100 s floor, no extra check-in | **102 s `early`** | hello-start |
| declines, then walks away | away check-in → *On my way* → `checkin` | *wait where are you going 😅 Parks is the other way* → **109 s `checkin`** | none |
| fast runner past the café (silent) | errand dropped, `parks` | **117 s `parks`** | none |
| jogger on the latte leg | `floors` at the 100 s floor | **102 s `floors`** | none |
| **v10 strong player** (3 m/s, declines) | `parks` | **124 s `parks`** | none |
| **v10 slow walker** 0.6 m/s, silent | behind (pace) → unanswered → `behind` | *how's my latte coming? 👀* 131 → **180 s `behind`** | hello-start |
| **v10 slow walker** says *Almost there!* | `behind` right after the answer | **101 s `behind`** (*ok you're taking forever 😂…*) | hello-start |
| **v10 wrong-floor wanderer** (B1 on the latte leg) | floor check-in → *I'm lost* | *why are you on B1?? 😂 the café's on 1F* 117.7 → **124 s `lost`** | none |

The offer cap (`offer-cap`) fired **0 times** across the 12 scenarios. `hello-start` fires only for players who
haven't walked 8 m by 12.6 s, which is not a moving player.

## 4. Browser walks (SwiftShader, `quality=low`); each has `ctx.errors []` and only the bot's 2 `dbg` warnings

| Persona | Legs (Aya's expectation) | Beats, with trigger | Offer | **Before** | Arrival | Chip checks | **Timer fires** |
|---|---|---|---|---|---|---|---|
| normal | café 311 m / 2 floors / 349 s · dk 195 m / 5 floors / 316 s | hello *moved* 10.4 · meet *reply* 15.4 · latte *reply* 23.5 · CITY tip *place* 114.1 · offer *floors* 149.3 | **149.3 `floors`** | **149 s** | 498.4 | 990 · 0 bad | **0** |
| `REPLY=none` | café 253 m / 303 s | hello *moved* 10.4 · meet *patience* 43.7 · latte *patience* 63.7 · CITY tip 111.4 · offer *floors* 146.6 | **146.6 `floors`** | 147 s | 491.5 | 971 · 0 bad | **0** |
| `REPLY=instant` | café 319 m / 355 s | hello 10.4 · meet *reply* 12.4 · latte *reply* 18.7 · CITY tip 113.6 · offer *floors* 149.4 | **149.4 `floors`** | 149 s | 501.9 | 996 · 0 bad | **0** |
| `REPLY=decline` (final code) | dk 457 m / 3 floors / 486 s | hello 10.4 · meet *reply* 15.5 · latte *reply* 24.6 (*Not today*) · CITY tip (Daikichi) *place* 112.9 · offer *parks* 152.0 | **152.0 `parks`** | 152 s | 437.7 | 869 · 0 bad | **0** |
| `&wander` | café 311 m / 349 s | hello 10.4 · meet 15.5 · latte 24.6 · **check-in *behind* 95.5** → *I'm lost 😭* (real key) · offer *lost* 100.9 · CITY tip 167.2 | **100.9 `lost`** | 101 s | 548.4 | 1091 · 0 bad | **0** |
| `REPLY=decline` (first run, before the §2 additions) | dk 457 m | … no beat from 24.6 to 240 s … | 240.2 `time` (**cap**) | 240 s | 437.7 | 868 · 0 bad | **1: `offer-cap MOVING leg=dk`** → fixed above |

The normal, none, instant and wander runs used the code just before the two Daikichi-leg additions. Those additions
only act on the Daikichi leg before any offer, and in those four runs the player is on the latte leg (or already
offered) at that point, so their results stand for the final code.

**The whereabouts path is now proven in a real walk.** The wander bot's 25 s wrong-way start put its pace behind
Aya's expectation, and she checked in at 95.5 s. In v9 every walk got Where from the 175 s timer.

**End cards (Before → After):**

- normal: On track 100 → 100 · ±25 m → ±0.5 · wrong floor 30% → 0% · blue dot within 5 m 15% → 100%;
- decline: ±27 m → ±0.5 · 29% → 0% · 16% → 100%;
- wander: On track 68% (0:26 off) → 100%, ±14 m.

Every Before has ≥ 100 s of walking (the bar is 20 s).

**Strong player's Before length:**

- browser bot, 1.5 m/s, perfect navigator: **149 s with the latte** (`floors`), **152 s declining it** (`parks`);
- sim strong player (3 m/s): 124 s (`parks`);
- jogger on the latte leg: 102 s (`floors`, held by the 100 s floor).

v9 was 183 s, entirely from the timer.

## 5. Aya's threads (from `phone.messages.msgs`)

**Normal:**

> Landed?? Welcome to Osaka! 🛬 · *me:* Just landed! 🙌 · yay!! 🎉 · Meet me at Tempura Daikichi… [card] · *me:* On my way! 🏃
> · oh!! can you bring me an iced latte from Café Mitsubachi?… [card] · *me:* Sure! ☕ · 🥹🙏 · **ooh you're in CITY! the
> café's on 1F 👇 right at the bottom of the big escalators** · **it's one floor down 👇 Maps never knows floors in here
> though 😅 use this →** [Lodestone] · see? 😌 it even knows which floor my latte is on · omg you're an angel 😭☕ ok NOW
> come… · I'm 2nd in line!! 🍤 · take the canyon way up 🌿… · You can see the noren from there, right?? 👋 · THERE you are 🥹…

**Never replies:**

> Landed?? · hello?? 👀 did you land? · ok I'll assume you landed 😂 Meet me… · oh!! can you bring me an iced latte…? · ooh
> you're in CITY! the café's on 1F 👇… · it's one floor down 👇 Maps never knows floors in here though 😅 use this → · see? 😌…
> · omg you're an angel… · …

**Declines the latte:**

> …oh!! can you bring me an iced latte…? · *me:* Not today 🙈 · 🥲 ok ok. just come then [card] · **ooh you're in CITY!
> keep straight on 2F, Parks is at the far end 👉** · **ok Parks is a maze, even I got lost 😅 use this →** · see? 😌 6F, I'm
> 3rd in line · I'm 2nd in line!! 🍤 · take the canyon way up 🌿… · noren · THERE you are 🥹 … · next latte's on you though 😌

**Wander (lost early):**

> …🥹🙏 · **how's my latte coming? 👀 the line is moving** · *me:* I'm lost 😭 · lol I knew it 😂 install Lodestone… · see? 😌 it
> even knows which floor my latte is on · ooh you're in CITY! the café's on 1F 👇… · omg you're an angel… · …

No line contradicts the player's state: no "you're lost" to someone on task, no check-in at the café counter, and no
chips under another text.

## 6. Decisions and what is still rough

- **Beyond V10's text: the `floors` offer on the latte leg.** V10 makes the offer for good players happen at Parks
  entry. With the latte, a steady walker reaches Parks at about 350 s, past the 240 s cap, so V10's own rule would give
  every latte-taker the timer. `floors` is the honest substitute: the café is a floor down in CITY, which is where Maps
  breaks, and it is Lodestone's core claim. It uses the same tone as `parks`. If you prefer the latte-takers to meet
  Lodestone only at Parks, the cap must rise to about 360 s, or they will get the timer.
- **`parks` fires on the approach (Daikichi < 300 m by foot, while still in CITY).** For the decline bot that was 130 s
  before it physically entered Parks (the crowd slows the CITY 2F stretch). The words ("ok Parks is a maze…") don't
  claim you're inside, so it reads fine, but 200 m would be closer to the bridge. One constant: `DEMO.parksNearM`.
- **"Behind" is mostly pace-based.** By V10's formula (elapsed > 1.1 × expected, about 350–490 s for these legs), it
  never triggers before the 240 s cap. Aya also reads your dot's pace (60 s into a leg, a projected arrival past 1.3 ×
  expected). That is what caught the wander bot at 95 s.
- **The CITY tip after the offer** (wander: Lodestone at 101 s, CITY tip at 167 s) is slightly redundant with Lodestone
  guiding, but harmless and friendly. Skipping it once Lodestone is ready is one line if wanted.
- `JOG=1` wasn't rerun in the browser for v10. The sim's jogger and strong player cover it (`floors` 102 s / `parks`
  124 s).
- `js/analytics.js` is untouched: `demo:offer.why` passes the new values through, and `story:where.why` now carries the
  check-in kind (`stalled` / `floor` / `away` / `behind`).
