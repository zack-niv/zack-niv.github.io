# v9 critique (critic + fixer): progression

Overall: **v9 progression 8 / 10** after my fixes (7 before). **Whole demo 7.5 / 10**, unchanged from v8.

Zack asked for progression driven by time, whereabouts and responses together. The core of that is fixed in the
live build. In about 5,000 chip checks across 5 browser personas, chips never sat under the wrong text (0 bad). Every
answer went through a real `Digit1`/`Digit2` keypress. Aya nudges before she gives up, and the silent player still gets
a whole story. Two things hold the score back:

- **Talking past the player.** The offer that answered "I'm lost 😭" was still "you're lost aren't you 😂". I fixed it.
- **Whereabouts only proven in Node.** In every bot run "Where are you??" came from the 175 s *latest* timer. The
  whereabouts-driven paths are proven in Node (`storysim` 8/8). In the browser, only `stalled` is proven, by one
  standing-still probe (Where at 99.5 s). `away`, `early` and `ahead` are not proven in a real walk.

Shots: `notes/v9-shots/critic/`. Walk shots: `/home/user/namba-shots/walk/c9{n,x,i,w,d}-*`.

## 1. Playthroughs

All runs used `?quality=low&noaudio` on SwiftShader. The bot now **answers with real keys**: Messages up, then
`Digit1`/`Digit2` on window (I changed `walk.mjs`). Every answer in every run logged `(key)`, with no fallback to
`story.answer()`.

| persona | first Aya text | latte ask | Where | offer (why) | latte ordered | arrive | chip checks | ctx.errors | console |
|---|---|---|---|---|---|---|---|---|---|
| normal (`REPLY=normal`, before my fixes) | 11.7 s | 27.9 s | 175.2 *latest* | **183.0 s** (`lost`) | 270.1 | **492.8 s** | 982 · **0 bad** | `[]` | 2 (the bot's own `dbg`) |
| silent (`REPLY=none`, before) | 11.7 s | 67.0 s | 175.1 *latest* | **205.5 s** (`silent`) | 265.9 | **491.4 s** | 972 · **0 bad** | `[]` | 2 (`dbg`) |
| instant (`REPLY=instant`, after) | 11.7 s | 21.9 s | 175.1 *latest* | **180.6 s** (`lost`) | 270.0 | **495.4 s** | 986 · **0 bad** | `[]` | 2 (`dbg`) |
| lost player (`&wander`, after) | 11.7 s | 27.4 s | 175.2 *latest* | **183.0 s** (`lost`) | 324.2 | **549.4 s** | 1097 · **0 bad** | `[]` | 2 (`dbg`) |
| declines the latte (`REPLY=decline`, after) | 12.2 s | 29.0 s (*Not today* 35.7) | 175.5 *latest* (the plain Where) | **183.7 s** (`lost`) | — | **436.5 s** | 872 · **0 bad** | `[]` | 2 (`dbg`) |
| standing still, silent (`stand-probe`, after) | 14.0 s | 70.4 s | **99.5 s `stalled`** | **148.6 s** (`silent`) | — | (stops at 166 s) | — | — | — |

`node tools/storysim.mjs`: **8/8 pass**, before and after my fixes. It now also asserts that the offer never asks
"you're lost aren't you" right after the player said they were lost.

End cards (Before → After):

| row | normal | lost player (wander) |
|---|---|---|
| On track | 99% · 0:01 off → 100% | **82% · 0:26 off** → 100% (v8: 82% / 0:27) |
| Position error | ±34 m → ±0.5 m | as v8 |
| Wrong floor | 25% → 0% | |
| Blue dot within 5 m | 8% → 100% | |
| Trip | 8:13 · 655 m · 1 iced latte delivered | 9:09 · 733 m · 1 iced latte delivered |

## 2. Aya's thread, read as a human (dumped from `phone.messages.msgs`)

**Normal (before the fix).** It reads like a friend until the last turn:

> Landed?? Welcome to Osaka! 🛬 · **me:** Just landed! 🙌 · yay!! 🎉 · Meet me at Tempura Daikichi… [card] · **me:** On my
> way! 🏃 · oh!! can you bring me an iced latte from Café Mitsubachi?… [card] · **me:** Sure! ☕ · 🥹🙏 ·
> *(2:21 of silence)* · how's my latte coming? 👀 the line is moving · **me:** I'm lost 😭 ·
> **you're lost aren't you 😂 install Lodestone…** · see? 😌 it even knows which floor my latte is on · omg you're an angel
> 😭☕ ok NOW come… · I'm 2nd in line!! 🍤 · take the canyon way up 🌿… · You can see the noren from there, right?? 👋 ·
> THERE you are 🥹 and you brought my latte??…

The bolded line is the exact v8 complaint in a smaller form. You tell her you're lost and she asks you whether you're
lost. Shot: `before-lost-reply-talked-past.png`. **Fixed:** she now says "lol I knew it 😂 install Lodestone, it
actually works indoors" (`after-lost-reply-answered.png`, instant and wander runs).

**Silent (never answers).** Coherent, with a double-text before every give-up and no stale chips:

> Landed?? · hello?? 👀 did you land? · ok I'll assume you landed 😂 Meet me at Tempura Daikichi… · oh!! can you bring me an
> iced latte…? · *(silence counts as yes after 25 s)* · how's my latte coming? 👀 · hello?? 👀 · ok just install this 😅 it
> actually works indoors [Lodestone] · see? 😌 it even knows which floor my latte is on · omg you're an angel…

"hello?? 👀" appears twice, three minutes apart. That reads as a real double-texter, not a bug. Shot: `silent-offer.png`.

**Instant.** Hello → latte takes 10 s; nothing waits on a timer. Same thread as normal, with the fixed offer line.

**Lost player (wander).** Same beats. The 25 s wrong-way start ends before Where's 95 s floor, so Where again came at
175 s *latest*, which matches v9's own note.

**Declines the latte.** Graceful all the way through:

> oh!! can you bring me an iced latte…? · **me:** Not today 🙈 · 🥲 ok ok. just come then [Daikichi card] · *(Where, plain
> version)* Where are you?? … · **me:** I'm lost 😭 · lol I knew it 😂 … · see? 😌 6F, I'm 3rd in line · I'm 2nd in line!! 🍤 ·
> canyon · noren · THERE you are 🥹 I saved us the two seats at the counter · **next latte's on you though 😌**

Before my fix the last line was "…wait. where's my latte 😑 kidding. (not kidding)", which contradicted her own
"ok ok". The end card drops the latte from the trip line ("7:16 min · 597 m on foot", `decline-endcard.png`). The quest
is hidden at once and the bot routed straight to Daikichi.

**"Which way?? 😵" (sim only).** "lol it's Namba, everyone's lost 😂 tap my link, Maps will get you close", then the
latte ask. If still stuck at 100 s, before: "you're lost aren't you 😂"; **now: "still lost? 😂 ok install Lodestone…"**.
The early reply is answered at once and earns an earlier offer (102 s vs 182 s), so it is rewarding. Asking a favour
right after "Which way??" is a bit cheeky, but it is in character.

## 3. Pacing

| persona | Hello | Latte ask | Offer | Arrive |
|---|---|---|---|---|
| normal | 11.7 | 27.9 | 183.0 | 492.8 |
| instant | 11.7 | 21.9 | 180.6 | 495.4 |
| silent | 11.7 (nudge 32.2) | 67.0 | 205.5 | 491.4 |
| wander | 11.7 | 27.4 | 183.0 | 549.4 |

**Dead air** (gaps of 40 s or more in visible beats: texts, replies, tutorial steps, nav milestones, discoveries; from
`gaps.py` over the walk events):

- **Aya is silent for 141–153 s** after "🥹🙏" until the 175 s check-in, in every replying persona. The player isn't idle
  (gate at ~65 s, entering CITY at ~113 s, Maps rerouting), and v6 chose this on purpose: Maps has to be *felt*. But the
  longest gap in visible beats is 45–51 s (65→113 s and 132→177 s). It is borderline, not broken.
- **Parks leg:** Aya is silent for 144 s between the canyon text and the noren line. Lodestone's milestones fill it, and
  it's the payoff walk. Fine.
- Wander: 96 s from Lodestone ready to the next milestone on the latte leg (the bot's slow descent). Fine for a lost
  player.

**Crowding.** In the walks, no tutorial hint sat beside fresh chips. One case remained in code: a silent player standing
still gets Where at ~97 s while the `pick` hint ("Open Aya's link — Enter") can show at the same time. That is the
audit's `silent-110.png`. v9 only held `pick` back for the latte chips. **Fixed:** `pick` now waits while *any* question
is fresh. Verified in the browser by `stand-probe.mjs.txt` (silent, standing still): Where at **99.5 s, why `stalled`**
(the whereabouts path, live). The tip is `null` from 103 to 125 s while Where is fresh (`stand-112-where-no-pick-hint.png`:
chips, no hint). The pick hint returns at 130 s, after her "hello?? 👀". The offer `silent` comes at 148.6 s.

## 4. v8 regression check

| item | evidence | verdict |
|---|---|---|
| Lodestone reveal hero + map | `normal-lodestone-hero.png` (3D stack, route to Café Mitsubachi, "Escalator down to 1F"); install 186.9 → calibrating 188.8 → ready 191.8 | OK |
| Maps stale/coarse | `normal-maps-stale.png` ("Approximate (Wi-Fi) ±41 m", "Compass needs calibration", "Directions… once we detect you on 2F") | OK |
| Gate prompt | `tutorial:step gate` done at 65.5 / 62.6 / 65.2 / 64.6 s in all four walks (a real E tap) | OK |
| End card | `normal-endcard.png`, `wander-endcard.png`: fair rows, On track 99→100 / 82→100 | OK |
| Pause menu | `mouseshot.mjs`: free → paused (chip hidden) → links `_blank` + `noopener noreferrer` → backdrop click resumes → phone chip; `errors []` | OK |
| Load | `loadprobe.mjs`: `READY 109.9s []` (the machine was loaded by 2 other browsers) | OK |

## 5. Grades

| goal | before → after | evidence |
|---|---|---|
| Turn-taking (no talking past, chips only under their question) | 7 → **8.5** | 0 bad in ~5,000 checks, real keys; the "I'm lost" → "you're lost aren't you" talk-past fixed |
| Whereabouts gating | **7** | Node: café dropped when passed, `ahead` only on the Daikichi leg, no Where on task or at the counter. Browser: no false Where at the café counter in 5 walks; the standing probe proves the `stalled` path live (99.5 s); but every *walking* bot's Where came from the 175 s timer |
| Lostness vs the current target | **7.5** | `demo:target cafe → dk` at the order (and at *Not today*) in every run; the wander bot correctly not "lost" once heading to the café; the standing probe's Where is `stalled` against the café at 99.5 s; no Where at the café counter in any run |
| Offer reasons and copy | 6 → **8** | lost / early now answer the reply; silent / ahead / fine read right |
| Never-stall fallbacks | **9** | silent: nudge → follow-up at every step, offer 205.5 s (≤ 210), arrival 491 s |
| **v9 progression overall** | 7 → **8** | |
| **Whole demo** | **7.5** | same as v8; nothing regressed |

## 6. What I fixed (files)

| file | change |
|---|---|
| `js/game/script.js` | `UPGRADE.offerLost` ("lol I knew it 😂 …"), `UPGRADE.offerEarly` ("still lost? 😂 ok …"), `ARRIVAL.teaseDeclined` ("next latte's on you though 😌") |
| `js/game/story.js` | The offer's words for `lost` / `early` reply to what the player said. The `pick` hint waits while any question is fresh, not only the latte |
| `js/game/demo.js` | A declined latte gets `teaseDeclined` at arrival, not "…wait. where's my latte 😑". She already said "ok ok" to your "Not today" |
| `tools/walk.mjs` | Answers with real keys (`Digit1`/`Digit2`, phone up on Messages), with a logged `FALLBACK` if a key doesn't land. `REPLY=decline` persona. `THREAD` dump of the phone's message list at the end |
| `tools/storysim.mjs` | Invariant: the offer never asks "you're lost aren't you" right after an "I'm lost" or "Which way??" reply |

`js/analytics.js` and `js/ui/*` are untouched.

## 7. What remains (honest)

- **The whereabouts paths are proven in Node, not in a walk.** Every bot run reaches Where through `latest` (175 s),
  because the bot never stalls after 60 s. For an on-task player, the 175 s check-in and the 195 s offer are still
  timer-shaped. They're worded to fit ("how's my latte coming?", "trust me, get Lodestone before you hit Parks"), but
  they are timers. Zack may feel it if he plays well.
- **141–153 s of Aya silence** in the Maps phase for a capable player. It's deliberate (Maps must be felt), but it's the
  longest quiet stretch in the first five minutes. A whereabouts-driven light text (e.g. on entering Namba CITY) is the
  obvious lever. I didn't add it: it's a new beat, so it's Zack's call.
- **The chip tray covers the newest bubble** in Zack's own screenshot (the latte text is cut off under the chips). That's
  in `js/ui/phone/apps.js`, outside my files, and headless doesn't draw the tray.
- After Where's nudge (25 s), the `pick` hint can come back beside the still-open Where chips (130–146 s in the standing
  probe). That's one phone-down action ("Q, open Maps"), so I left it.
- Run order: normal and silent ran on the pre-fix build. Instant and wander include the offer-copy fix. Decline and the
  standing probe include all fixes. All of them pass.
- `LATTE_REFUSABLE` is still `true`, pending Zack.

## 8. Would this impress the team? **7.5 / 10**

The story now listens. She waits, double-texts, gives up gracefully, and answers what you said. Nothing in the thread
contradicts the player any more in the five personas. It's not higher because the clever whereabouts logic is mostly
invisible to a competent player (they get the 175 s check-in like before), and the v8 unknowns (JA voice, crowd at the
doors, real-GPU frame rate) are still open.

## 9. Top 3 risks

1. **"It still feels timed" for good players.** The Where check-in and the offer land at 175 / 183 s for anyone on
   task. That's honest pacing, but it's the same moment as v8.
2. **Untested human branches in the browser**: early "Which way??", stalled-at-95 s and `ahead` are proven in Node
   (8/8), plus one standing probe. A human will hit combinations the bots don't, e.g. answering an old question after
   it closed (handled: silently recorded, no reply).
3. **Phone UI.** The chip tray covering the newest text (Zack's screenshot), and chips that don't render in headless
   captures, so chip *visibility* is only verified by DOM count, not by pixels.
