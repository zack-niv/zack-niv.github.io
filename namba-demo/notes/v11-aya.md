# v11: Aya without location, the photo beat, engagement (Aya agent, Opus)

Spec: `V11.md` items 2 and 3, plus the lead's nuance: recognise what is IN the photo. Zack:

- *"'Your dot isn't getting any closer' or 'why are you on 2F' assumes Aya knows where the player is. How come? They did
  not share anything."*
- *"make sure we're not too silent; we need to keep engagement (Aya could confirm whether you're ok, on track, send a
  picture or something…)"*

This builds on v10 (HEAD 3bd805e) and keeps the v9 turn-taking contract, the chip invariant, v10's no-clock rule for
moving players, the 240 s cap as a guard only, and the analytics events.

---

## 1. The root fix: what Aya may know

`DEMO.md` now says it plainly ("How Aya knows where you are (v11): she doesn't"). She knows:

1. **Time.** How long the leg should take (v10's walking model), so she senses "this is taking a while".
2. **What you told her.** Your chip replies, plus your own texts. New: buying her latte sends *"got your latte! ☕ on
   my way"* from you (`messages.sendMine`), and her "omg you're an angel" answers that text.
3. **The photos you send.** A photo shows the place, so recognition may name it, but only when a landmark is really in
   the frame (§3).

Internal triggers (behind pace, wandering, wrong floor, stalled, entering CITY, approaching Parks) still decide
**when** she writes. Her **words** never state where you are.

### Knowledge audit: every Aya line (script.js + strings built in story.js / demo.js)

Lines that claimed knowledge she can't have, before → after (**18 found, 0 left**):

| # | Line before (v10) | Why it's impossible | After (v11) |
|---|---|---|---|
| 1 | your dot isn't getting any closer 😂 wrong floor? I'm on 6F | sees your dot | you're not getting any closer, are you? 😃 it's 6F btw, Parks |
| 2 | your dot isn't getting any closer 😂 wrong floor? the café's on 1F | sees your dot | you're not getting any closer, are you? 😃 the café's on 1F btw |
| 3 | you ok? your dot hasn't moved in ages 👀 | sees your dot | where are you now? 👀 |
| 4 | you ok? your dot hasn't moved in ages 👀 the café's on 1F | sees your dot | where are you now? 👀 the café's on CITY 1F |
| 5 | still at the station? 👀 | (a guess, but asserted on position) | probably still in the station maze lol 😅 where are you? |
| 6 | wait where are you going 😅 Parks is the other way | sees your direction | hmm that's taking a while 😅 you're heading to Parks, right? |
| 7 | wait where are you going 😅 the café's the other way | sees your direction | hmm that's taking a while 😅 you found Namba CITY, right? |
| 8 | ooh you're in CITY! the café's on 1F 👇 … | sees you in CITY | **removed.** The photo ask comes when you enter CITY, and she names the place only from the photo |
| 9 | ooh you're in CITY! the café's on 1F 👆 one floor up… | same | removed (the B1 photo says "one floor too low… 👆") |
| 10 | ooh you're in CITY! keep straight on 2F… | same | removed (the CITY 2F photo, Daikichi leg: "keep straight, Parks is at the far end 👉") |
| 11 | you're close! but Maps never knows floors in here 😅 use this, it does → | knows you're close / "in here" | heads up: Maps never knows floors in these malls 😅 use this, it does → |
| 12 | ok Parks is a maze, even I got lost 😅 use this → | timed on seeing you reach Parks | you must be near Parks by now? it's a maze in there, even I got lost 😅 use this → |
| 13 | lol your dot says otherwise 😂 get this… | sees your dot | lol ok but it's been a while 😂 get this, it actually works indoors |
| 14 | ok Parks is a maze from here 😅… (unused `ahead`) | "from here" | Parks is a maze 😅 get Lodestone… |
| 15 | You can see the noren from there, right?? 👋 | sees you near the door | you must be close now?? look for the noren with 天 on it 👋 |
| 16 | ooh, {name} first? 😂 I'll wait… / straight to the tempura? respect 😂… | sees your Maps pick | **removed.** She can't see your phone |
| 17 | no latte? 🥲 fine. FINE. … (sent when you walk past the café) | sees you pass the café | **removed.** She finds out at the counter (the arrival tease) |
| 18 | omg you're an angel 😭☕ (sent when you buy it) / see? 😌 6F… (sent when Lodestone is ready) | sees the purchase / the install | the latte reply now answers **your** text "got your latte! ☕"; the ready lines ask "did it install? 😌…" |

Kept as they were (fine): hello, Meet, the latte ask, *how's my latte coming? 👀*, *Where are you?? The line is
moving…*, her acks, *you're lost aren't you 😂* (a guess), *trust me, get Lodestone before you hit Parks*, *I'm 2nd in
line!!* (her own state), the canyon text (now "when you get into Parks, take the canyon way up…"), and the arrival
lines (in person).

**Enforced in `storysim`:** every scenario fails if any Aya line matches `/your dot|you're in CITY|you're in
Parks|why are you on|you're on \dF|from there|I can see you|I see you/`. Recognition lines are fine because they name
the place from the photo ("that's Namba CITY 2F, by …").

## 2. The photo beat (`apps.js`, `story.js`)

- **When.** As you walk into Namba CITY (internal timing; 8 s of quiet, no open question, before Lodestone), or after
  2 min of quiet. She asks: *"send me a pic of something near you 📸 I'll tell you where you are"*, with chips **📸 Send
  photo** / *I'm good 👍*.
- **Check-ins carry it too.** Every check-in now has three chips: *I'm lost 😭* · **📸 Send a pic** · *On my way!* (or
  *Almost there!*). After she reads a check-in photo, she follows with Lodestone (`why: 'photo'`, "and honestly? get
  this, it actually works indoors 😌 →"), or saves it for later before 100 s.
- **Capture** (`MessagesApp._capture`). On the 📸 chip (key or tap: chips are buttons), the game renders one frame
  (`engine.render(0)`) and copies the WebGL canvas into a 360 px-wide JPEG in the same task. That keeps the drawing
  buffer valid without `preserveDrawingBuffer`, and post-processing is included. There are no camera-attached meshes,
  so the view is the photo. A white shutter flash (`.ms-shutter`) and a click play. The photo becomes an image bubble
  (`.ms-photo`), and `phone:reply` carries `{photo: true, img}`.

## 3. Recognition: only what is in the frame (lead's nuance; `story._photoScene`)

At capture time the game knows the true pose: position, yaw, pitch. Aya reads:

1. **Pitch.** If |pitch| > 0.6 rad, it's the floor or the ceiling, so it shows nothing.
2. **Landmarks within ~22 m inside the ±35° view cone,** most specific first:
   - a directory shop (`businessBySlot`, same floor, its door);
   - a gate (`game._gates`, "the Central Gate");
   - an escalator or stairs end (`LAYOUT.ramps`).
3. **Distinctive zones:** the Nankai platforms, the Parks canyon, the Parks bridges.

- **Something recognisable:** she names it like a local, with a pointer relative to where you face (`rel()`: right
  ahead / behind you / to your left / right). Examples:
  - *omg that's Namba CITY 2F, by SOU-SOU-KA! the café's one floor down 👇 escalator right ahead*;
  - *lol that's CITY B1, by Bijou Momo 😂 one floor too low, the café's on 1F 👆 escalator behind you*;
  - *omg that's the Nankai platforms 🚃 the Central Gate is right ahead, then down to 2F 👇*.
- **Nothing recognisable:** *"hmm that could be anywhere 😅 send one with a sign or a shop in it?"*, with chips 📸 Send
  another / I'm good 👍. The **second** useless photo gets *"lol ok I'll stop playing detective 😂 shout if you're
  stuck"*, so it never loops.

## 4. Engagement (`story._engage`)

A friend waiting in a queue texts now and then:

- **When:** after **38 s with no contact** (an Aya text or a reply from you), while you **walk** (≥ 12 m in the last
  15–20 s), never over an open question, never stacking, never more often than every **40 s**, and not while Lodestone
  is being offered or installed.
- **Before Lodestone:** *"you ok? 😊"* (chips *All good 👍* / *I'm lost 😭*, which is a real way to ask for help), the
  photo ask (CITY, or after 2 min), then *take your time, it's a maze lol 😅* · *the line just moved!! 🍤 no rush tho* ·
  *the guy in front of me ordered for 6 people 😭*.
- **After Lodestone:** *is it working? 😌 told you* · *omg the tempura smell from here 🤤* · *the chef just flipped a
  prawn into the air 😳* · *ok it's almost our turn 👀* · *a kid next to me is eating a whole melon pan 😂*.
- Each line is used once.
- **After Lodestone the gap is 45 s,** and the after-pool has **9** lines. The wander run below exhausted the first
  6-line pool on its long walk; this is the fix.

## 5. Verification

### Node: `node tools/storysim.mjs` → 19/19 PASS

- **The sim world now has a pose:** Nankai platforms → the Central Gate → CITY 2F main (x 0, z 100–190, facing south,
  shops on both sides) → CITY 1F → Parks, with yaw, pitch and zones. It uses the real directory and layout, so
  recognition runs on real shop names.
- **New invariants on every scenario:**
  - the **knowledge audit** regex (§1): 0 hits in every thread;
  - the **longest silence** while walking, checked in the walking scenarios (≤ 45 s; the long walk ≤ 47 s).

| Scenario | Result |
|---|---|
| v11 photo in CITY | *omg that's Namba CITY 2F, by SOU-SOU-KA! the café's one floor down 👇 escalator right ahead*; `floors` 168.9 s; silence 40 s |
| v11 photo of the floor → retry | *hmm that could be anywhere 😅…* (`blur-floor`, pitch −1.1) → 📸 again → recognised; 1 blur |
| v11 two useless photos (pitch +1.2, ceiling) | 1 "could be anywhere", then *lol ok I'll stop playing detective 😂…*; no loop |
| v11 long Lodestone walk (arrives ~9 min) | longest silence **46 s**, 10 engagement texts in 545 s (the sim has no latte, queue or canyon beats, so real runs need fewer) |
| v10 wrong-floor wanderer (B1) | *you're not getting any closer, are you? 😃 the café's on 1F btw* → I'm lost → `lost`. A photo there reads *lol that's CITY B1, by Bijou Momo 😂 one floor too low, the café's on 1F 👆 escalator behind you* |
| all 15 earlier v9/v10 scenarios | pass. Walking scenarios: longest silence 36–41 s. The two stuck players (0.3–0.5 m/s) wait 68–72 s, because the engagement only fires while you walk; one of them already said "Which way??", so the early offer comes at 100 s |

### Browser walks (headless SwiftShader, `quality=low`, real `Digit` keys)

**Test setup caveat:** I ran these against a scratch copy of the tree, identical except for one line. During this
round, the Mobile agent's checkpoint added a `touch` system to `js/main.js`, and `js/core/loader.js` has no `touch`
stage. So `Loader.stage` throws (`Cannot read properties of undefined (reading '0')`, loader.js:102), and **the real
page never finishes loading**: both of my first walks timed out at 300 s. The copy adds
`touch: [0.01, 4, 'Almost there…']` to `STAGES`. Neither file is mine; the lead should relay this.

| Persona | Beats (why) | Offer | Arrival | Longest silence | Engagement | Chip checks | Timers | Errors |
|---|---|---|---|---|---|---|---|---|
| **normal** (`PHOTOBLUR=1`, final pool) | hello moved 10.4 · meet reply 15.1 · latte reply 23 · *you ok?* 73.1 → All good · **📸 ask (CITY) 113.8** → floor photo → **blur** 120.3 → 📸 again → **recognised 130.0** (*omg that's Namba CITY 2F, by Zoff Eye Lab! the café's one floor down 👇 escalator behind you*) · offer `floors` 152.7 · 6 after-lines | **152.7 `floors`** | **498.2** | **40.7 s** | 8 (0.96/min) | 989 · **0 bad** | **0** | `[]`, 2 bot `dbg` |
| normal (first run, 6-line pool) | same; photo blur 119.8 → recognised 129.8 (same words) | 152.4 `floors` | 502.7 | 63.3 s (the pool ran out at 430 s) → fixed | 7 (0.84/min) | 998 · 0 bad | 0 | `[]` |
| `REPLY=none` (6-line pool) | meet / latte by patience · *you ok?* 105.5 (unanswered, closes) · 📸 ask 131.9 (unanswered, closes) · `floors` 164.3 · after-lines | **164.3 `floors`** | **500.2** | 66.0 s (pool tail, as normal; fixed) | 7 (0.84/min) | 984 · **0 bad** | **0** | `[]` |
| `&wander` (6-line pool) | *you ok?* 74.1 · **check-in `behind` 95.5** (*how's my latte coming? 👀*) → I'm lost (key) → `lost` 101.3 · after-lines | **101.3 `lost`** | **546.0** | 144.9 s (the pool ran out at 389 s on the longest walk) → **fixed** by the 9-line pool and the 45 s after-gap, proven in the sim (46 s); not re-run in the browser (slots reserved for the share card) | 7 (0.77/min) | 1086 · **0 bad** | **0** | `[]` |

On track for wander: 68% (0:26 off), the same as v10. The normal end card is unchanged.

**Photo screenshots** (`notes/v11-shots/aya/`):

- `photo-blur-floor.png`: the floor-tile photo bubble, *hmm that could be anywhere 😅 send one with a sign or a shop in
  it?*, and chips **1 📸 Send another** (orange) · **2 I'm good 👍**;
- `photo-recognised-city2f.png`: the retry, showing the CITY 2F shopfronts, then *omg that's Namba CITY 2F, by Zoff Eye
  Lab! the café's one floor down 👇 escalator behind you*;
- `photo-recognised-full.png`: the full frame.

### Aya's threads (from `phone.messages.msgs`)

**Normal:**

> Landed?? · *me:* Just landed! 🙌 · yay!! 🎉 · Meet me… · *me:* On my way! 🏃 · oh!! can you bring me an iced latte…? · *me:* Sure! ☕
> · 🥹🙏 · **you ok? 😊** · *me:* All good 👍 · yay 😌 · **send me a pic of something near you 📸 I'll tell you where you are** ·
> *me:* [photo: the floor] · **hmm that could be anywhere 😅 send one with a sign or a shop in it?** · *me:* [photo: CITY 2F] ·
> **omg that's Namba CITY 2F, by Zoff Eye Lab! the café's one floor down 👇 escalator behind you** · heads up: Maps never
> knows floors in these malls 😅 use this, it does → · did it install? 😌 it even knows which floor my latte is on · omg the
> tempura smell from here 🤤 · the chef just flipped a prawn into the air 😳 · *me:* **got your latte! ☕ on my way** · omg
> you're an angel 😭☕ ok NOW come… · I'm 2nd in line!! 🍤 · a kid next to me is eating a whole melon pan 😂 · when you get
> into Parks, take the canyon way up 🌿… · I'm reading the menu like it's a novel 📖… · ok it's almost our turn 👀 · the couple in
> front just got seated!! we're next 😍 · you must be close now?? look for the noren with 天 on it 👋 · THERE you are 🥹…

**Never replies:** Landed?? · hello?? 👀 did you land? · ok I'll assume you landed 😂 Meet me… · oh!! can you bring me an
iced latte…? · you ok? 😊 · send me a pic of something near you 📸… · heads up: Maps never knows floors… · did it install? 😌… ·
… · *me:* got your latte! ☕ on my way · omg you're an angel… · …

No line claims to see the player: 0 audit hits across every thread.

## 6. Still rough / for the lead

- **The loader blocker above** (`touch` stage). Until it's fixed, nobody's browser test loads the real page.
- **Rate vs silence.** "Longest silence ≤ 45 s" and "≤ 1 engagement text per minute" pull against each other on long,
  uneventful walks. The settings (quiet 38 s, gap 40 s, 45 s after Lodestone) give 0.8–1.0/min on the bot runs and
  ~1.1/min on the sim's 9-minute walk.
- **Location-timed beats are worded neutrally but still location-timed:** the `floors` / `parks` offers, the 2nd-in-line
  and noren lines, the canyon advice, the photo ask on entering CITY. V11 allows this (sensors decide *when*), but a
  very attentive player might still find "you must be close now??" uncannily timed.
- **Touch:** the 📸 chip is a `<button>` like the other chips (tap → the same `reply(i)` → capture), so it works on touch
  in code. It wasn't exercised in a touch emulation here (the Mobile agent's `touchwalk.mjs`). The chips are about
  32 px tall; the ≥ 44 px touch target belongs to the Mobile agent's touch CSS.
- `JOG=1` and `REPLY=decline`/`instant` were not re-run for v11. The sim covers both, and nothing in v11 changes their
  offer paths.
