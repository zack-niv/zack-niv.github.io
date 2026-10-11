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
