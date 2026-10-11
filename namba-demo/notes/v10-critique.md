# v10 critique (critic + fixer): location-driven pacing

**v10 pacing 8.5 / 10** after my fixes (7.5 before). **Realism vs purpose 8.5 / 10.** **Whole demo 8 / 10** (v9: 7.5).

The design is right. Aya stays quiet while you are on pace and speaks when her shared-location view gives her a
reason. Lodestone arrives at a place where Maps really fails: the floor change to the café, or the approach to Parks.
In the browser runs every persona arrived with `ctx.errors []`, 0 bad chip checks and **0 timer fires**.

Before my fixes, four things would have shown up on a real player before they showed up on the bot:

1. **The cap fired for typical humans.** A first-timer averaging about 1.0 m/s (looking around, reading the phone) reached
   the `floors` mark (< 150 m) or the `parks` mark (< 300 m) only after 240 s. So `offer-cap` fired for a **moving**
   player, and Aya had been silent for 146 s first (storysim, new scenarios). Live data agrees: in the last 30 days of
   v8/v9 PostHog `namba_lodestone_offer` events (n = 7), **4 were `time`** (≈ 198 s), 2 `lost`, 1 `checkin`. Real
   players are slower than the 1.5 m/s bot. **Fixed** with a CITY dwell trigger (below).
2. **Aya claimed to see your floor.** "why are you on B1?? 😂" reads funny, but shared location from a Maps-grade phone has
   no floor, and the whole story is that Maps never knows floors. An Oriient engineer would notice that in a second.
   **Reworded** so she infers it from the dot (below).
3. **The `floors` offer repeated the tip.** "the café's on 1F 👇 …" was followed 35 s later by "it's one floor down 👇 …".
   The phone peek cut off the pitch: *"it's one floor down 👇 Maps never…"*. From B1 the arrow pointed the wrong way.
   Shots: `before-floors-offer-thread.png`, `before-floors-offer-peek.png`. **Reworded.**
4. **The CITY tip arrived after Lodestone (wander).** It's now dropped once an offer is out, including a tip already
   queued (`stale` predicate).

Shots: `notes/v10-shots/critic/`. Walk shots: `/home/user/namba-shots/walk/c10{n,j,w,d}-*`.

## 1. Runs (final code unless marked)

All browser runs used `?quality=low&noaudio` on SwiftShader, and the bot answered with real `Digit1`/`Digit2` keys.

| persona | code | legs (Aya's expectation) | beats (why @ s) | offer | **Before** (end card) | arrive | chips | timers | errors |
|---|---|---|---|---|---|---|---|---|---|
| normal | pre-fix* | café 310 m / 2 fl / 348 s · dk 195 m / 5 fl / 316 s | hello moved 10.4 · meet reply 15.5 · coffee reply 24.7 · cityTip place 113.6 · offer floors 148.8 | **148.8 `floors`** | 160 s · 213 m | 495.2 | 983 · **0 bad** | **0** | `[]` · 2 (bot `dbg`) |
| **`JOG=1`** (first v10 browser run) | pre-fix* | café 286 m / 329 s · dk 196 m / 317 s | hello 8.1 · meet 13.1 · coffee 21.3 · cityTip 62.5 · offer floors 100.4 | **100.4 `floors`** (held by the 100 s floor) | 111 s · 295 m | 260.4 | 513 · **0 bad** | **0** | `[]` · 2 |
| `&wander` | final | café 310 m / 348 s · dk 195 m / 316 s | hello 10.4 · meet 15.7 · coffee 24.7 · **check-in `behind` 95.4** → *I'm lost 😭* (key) · offer lost 100.9 · **no CITY tip** (was 167.2) | **100.9 `lost`** | 112 s · 151 m · On track **68% · 0:26 off** | 551.4 | 1099 · **0 bad** | **0** | `[]` · 2 |
| `REPLY=decline` | final | dk 457 m / 3 fl / 486 s | hello 10.4 · meet 15.7 · coffee reply 24.7 (*Not today*) · cityTip place-dk 113 · offer parks 152.6 (< 300 m approach) | **152.6 `parks`** | 163 s · 218 m | 437.0 | 868 · **0 bad** | **0** | `[]` · 2 |

\* "pre-fix" means the page loaded before my edits. My changes alter only the words of the `floors` offer for these two
personas. The new dwell trigger can't fire first: normal's tip came at 113.6 and `floors` at 148.8, before tip + 40 s;
jog's offer is held to 100 s anyway.

`node tools/storysim.mjs`: **15/15 pass** (the implementer's 12, with the wrong-floor expectation updated, plus 3 new):

| new scenario | before my fix | after |
|---|---|---|
| typical first-timer, 1.0 m/s, replies, takes the latte | **FAIL**: `offer-cap` 240.4 **MOVING**, Aya silent 32 → 178 s | **217.9 s `floors`**, 0 timers |
| first-timer who declines, 1.0 m/s | **FAIL**: `offer-cap` 240.4 **MOVING** | **217.9 s `parks`** ("trust me, get Lodestone before you hit Parks 😅…"), 0 timers |
| lost early, reaches CITY only after the offer | CITY tip after "see? 😌" (the browser wander bug) | no tip; asserted for every scenario |

I also checked the effect on the existing scenarios. Steady sim walkers now get `floors` 6–10 s earlier, because the sim's
CITY stretch is longer than the real one. The fast runner and the sim strong player get the "before you hit Parks"
offer at about 102–105 s instead of 117–124 s. That still leaves a Before of 100 s or more. The browser bots are unchanged
(the dwell never comes first at 1.5 m/s).

## 2. Aya's threads, read as Zack and as an Oriient recruiter

**Normal** (browser, pre-fix words):

> 11:20 Landed?? · *me:* Just landed! 🙌 · yay!! 🎉 · Meet me at Tempura Daikichi… · *me:* On my way! 🏃 · oh!! can you bring me
> an iced latte…? · *me:* Sure! ☕ · 🥹🙏 · *(80 s: the gate at 65 s, Maps rerouting)* · **113.6 ooh you're in CITY! the café's
> on 1F 👇 right at the bottom of the big escalators** · **148.8 it's one floor down 👇 Maps never knows floors in here though
> 😅 use this →** · see? 😌 it even knows which floor my latte is on · *(108 s with Lodestone guiding)* · omg you're an angel… ·
> I'm 2nd in line!! · take the canyon way up 🌿… · You can see the noren… · THERE you are 🥹…

Now the offer reads **"you're close! but Maps never knows floors in here 😅 use this, it does →"**. The tip gave the
floor, so the offer says only what Maps can't do, and the peek shows "Maps never knows…" first.

**Jog** (browser): the same thread, compressed. The tip comes at 62.5 and the offer at 100.4. "see? 😌 it even knows which
floor my latte is on" is the best line in the demo for Oriient: the pitch, in a friend's voice, at the moment it is true.

**Wander** (browser, final code): 

> …🥹🙏 · *(61 s)* · **97.4 how's my latte coming? 👀 the line is moving** · *me:* I'm lost 😭 · **lol I knew it 😂 install
> Lodestone, it actually works indoors** · see? 😌 it even knows which floor my latte is on · *(Lodestone guides; no stale
> "ooh you're in CITY! the café's on 1F 👇" any more)* · omg you're an angel… · I'm 2nd in line!! · canyon · noren · THERE
> you are 🥹…

This is the whereabouts path in a real walk: her pace read caught the 25 s wrong-way start at 95 s. The end card shows
it: On track 68%, 0:26 off → 100% (`wander-endcard.png`, `wander-lost-offer.png`).

**Declines** (browser, final code): 

> …*me:* Not today 🙈 · 🥲 ok ok. just come then [Daikichi card] · *(78 s)* · **115.3 ooh you're in CITY! keep straight on 2F,
> Parks is at the far end 👉** · **154.8 ok Parks is a maze, even I got lost 😅 use this →** · see? 😌 6F, I'm 3rd in line · I'm
> 2nd in line!! 🍤 · canyon · noren · THERE you are 🥹 I saved us the two seats at the counter · next latte's on you though 😌

Graceful and coherent (`decline-parks-offer.png`). "Parks is a maze" lands on the approach, still in CITY. It reads as a
warning, not as "you're inside". The trip line drops the latte ("7:17 min · 598 m on foot", `decline-endcard.png`).

**Realistic for a friend who is waiting?** Mostly yes. She is patient while you are on pace (a 400 s expectation for a
390 m leg is generous and human). She checks in with something specific: "how's my latte coming? 👀", "still at the
station?", "your dot isn't getting any closer 😂 wrong floor?". When "Almost there!" is plainly false, she now answers it
("lol your dot says otherwise 😂 get this…") instead of "ok you're taking forever", which ignored what you said.

**Does every player feel the Before?** Yes. On the end card, Before covers 111 s (jog) to 160 s (normal), 213–295 m on
foot, a position error of ±24–68 m and 8–29% on the wrong floor. The bar was 20 s. The Maps-stale and wrong-floor shots
(`c10n-04-maps-wrong-*`) are in that window. The jogger's Before is the shortest at about 100 s, but it still has the gate,
a stale Maps and the CITY tip.

**Is the pitch tied to a real need?**

- `floors`: the one moment in the latte leg where Maps truly fails. **Keep it.** The implementer's addition is right, and
  it's the most on-brand beat in the demo.
- `parks` on the approach: good.
- `parks` by dwell (new): honest words ("before you hit Parks").
- `lost` and `behind` answer what you said.

**Contradictions, repetition, dead air:**

- Contradictions and repetition are fixed (see the list at the top).
- Dead air on the latte leg: Aya is silent 36 → 116 s for the normal bot (80 s). The longest gap in **visible** beats is
  46 s (gate → CITY), so it's borderline, not broken, and realistic: a friend who is waiting doesn't text every 30 s.
  For a 1 m/s player, Aya's silence is about 146 s. The gate and the pick step fill it, but this is the biggest
  remaining pacing risk.
- After the upgrade, Aya is quiet for 108 s and later 148 s while Lodestone guides. That's the payoff walk, so it's fine.

## 3. Fixes (files)

| file | change |
|---|---|
| `js/game/story.js` | **CITY tip:** skipped once an offer is out or queued; a queued tip is dropped (`stale`); arrow 👆 from below 1F. **`_cityDwell()`:** `floors` (latte leg) and `parks` (Daikichi leg) also fire after `DEMO.cityDwell` s in CITY since her tip; the far-side `parks` uses "before you hit Parks". **The behind offer after a reply** acknowledges it. |
| `js/game/aya.js` | `say(text, { stale: fn })`: queued banter is dropped unsent if its premise is gone. |
| `js/game/script.js` | `checkin.floor` → "your dot isn't getting any closer 😂 wrong floor? I'm on 6F / the café's on 1F" (no claimed floor). `cityTipUp`. `offerFloors` → "you're close! but Maps never knows floors in here 😅 use this, it does →". `offerBehindReply`. `DEMO.cityDwell: 40`. |
| `tools/storysim.mjs` | +3 scenarios (1 m/s first-timer ×2, lost-early-then-CITY); a global "no CITY tip after the offer" invariant; the wrong-floor expectation follows the new words and the 👆. |

## 4. Regression

- `loadprobe`: `READY 113.2s []`
- End card: sane in every run. Four rows; Before is `100 / ±24 / 29% / 17%` (normal) vs After `100 / ±0.5 / 0 / 100`;
  "Whole trip: 8:15 min · 658 m on foot · 1 iced latte delivered" (`normal-endcard.png`, `jog-endcard.png`).
- Gate tap: the bot's real `KeyE` tapped at 65.5 s (`ic:pay fare 970 ok`). It drifted into the next lane once (`notap`)
  and re-tapped at 67 s. That's the bot's lane drift, as before.

## 5. Scores

| | before my fixes | after | why |
|---|---|---|---|
| v10 pacing | 7.5 | **8.5** | 0 timers in every browser run, and now in the sim's 1 m/s humans too. Real players remain unmeasured. |
| realism vs purpose | 7.5 | **8.5** | Every offer is tied to a real Maps failure or to what you told her. The floor-seeing contradiction is gone. |
| whole demo | 7.5 | **8** | Same visuals as v9. The story now earns the upgrade instead of timing it. |

## 6. Top 3 risks

1. **Real players' pace.** Live v8/v9 data had 4 of 7 offers from the cap. The dwell trigger is proven in Node only; no
   browser bot walks at 1 m/s. After deploy, watch `namba_lodestone_offer.why`: `time` should be under about 15%. If it
   isn't, lower `DEMO.cityDwell` (40 → 25), not the cap.
2. **Latte-leg quiet for slow players.** Aya can be silent for about 2.5 min (32 → 178 s) on a slow, on-pace walk. That's
   realistic, but a recruiter who isn't reading the Maps screen may feel dead air. The lever (a Maps-side "you're on
   2F, café on 1F?" nudge, or a shorter dwell) is Zack's call.
3. **The location-sharing fiction.** Aya's pace, stalled and away reads use the **true** position, while the player's own
   Maps dot is ±24–68 m off. At her coarse scale ("hasn't moved", "other way") that's believable, and floors are no
   longer claimed. A sharp viewer could still ask how she knows; one line in DEMO.md would settle it.
