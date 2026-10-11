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
