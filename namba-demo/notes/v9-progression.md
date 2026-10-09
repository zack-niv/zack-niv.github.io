# v9 — Progression audit and design (Opus, Phase 1: read-only)

Zack: *"the game progresses just based on time and not the combination of time, whereabouts and responses."*
Screenshot `notes/v8-shots/player/9_aya_talks_past_reply.png`: Landed?? → Meet me… (+card) → iced latte ask, with
"1 I'm lost 😭 / 2 On my way!" chips under the latte ask. There is no reply bubble from the player anywhere in the thread.

Status: audit + design done. **No game files edited.** Implementation is Phase 2, after the v8 deploy.

---

## 0. TL;DR

His read is right, and there is one root cause. **Aya has no turn-taking model.** A question's chips live on the phone
(`MessagesApp.pending`) and its callback lives in `Aya.open`, but nothing ties either one to the conversation's flow:

- a plain statement never closes the open question, so its chips stay on screen under unrelated texts;
- the next beat fires on a timer or distance even while a question waits for an answer;
- the Lodestone offer goes around the outbox entirely.

The story also measures "lost" only against Daikichi. A player doing exactly what Aya asked (going down to the café on
CITY 1F) counts as lost, so "Where are you??" and "you're lost aren't you 😂" can contradict what the player is doing.

The fix is a small conversation contract plus a few gate changes in `story.js`, not a rewrite:

- **in `aya.js`:** questions with *patience* (a nudge, then a natural follow-up), *validity* (chips are withdrawn when the
  premise is gone), *close on topic change*, and *deferral* for location banter while a question is fresh;
- **in `story.js`:** beats gated on reply + whereabouts + time;
- **in `demo.js`:** lostness measured against the *active* target (the café during the errand, Daikichi otherwise).

Estimate: about 150 changed lines across `aya.js`, `story.js`, `script.js` and `demo.js` (plus `walk.mjs` reply modes),
and 2.5–3 h including five headless runs.

---

## 1. Evidence

- **Code read** (line numbers as of commit b153eba): `js/game/story.js`, `aya.js`, `demo.js`, `tutorial.js`,
  `script.js`, `js/ui/phone.js`, `js/ui/phone/apps.js` (MessagesApp), `js/analytics.js`, `tools/walk.mjs`.
- **Probe** `scratchpad/silent.mjs`: a player who never replies and stays near the start, with the event timeline and
  Messages screenshots at about 60, 110 and 205 s. Results are in §1.1; they are filled in once the run gets a browser slot.

### 1.1 Probe results (summary, details in §9)

The never-replier timeline in §2 is **confirmed in the live build**:

- the hello chips stay on screen from 14 s to 97 s, under Meet and the latte ask;
- the tutorial `reply` step is marked done at 45.1 s with **no reply**;
- the offer is sent at 197 s (`why: time`, "you're lost aren't you 😂") with the Where chips **still pending** at 216 s
  and 226 s.

---

## 2. The current beat table (as implemented)

Trigger key: **T** = time, **R** = reply, **L** = location/progress, **A** = player action.
⚠ marks a problem: time alone drives it, it can fire out of order, it contradicts the player's state, or it talks past
an unanswered reply.

| # | Beat | Trigger as implemented | Kind | Problems |
|---|---|---|---|---|
| 1 | Intro hold (4.6 s), PA caption | game start | T | — |
| 2 | Tutorial `look`, `move` | yaw > 1 rad, walked ≥ 8 m | A | — |
| 3 | **"Landed?? 👋"** + chips *Just landed! / This station is HUGE* | `move` done **or** t ≥ hold + 8 s (`story.js:262`) | A/T | OK: a T fallback for a first text is natural |
| 4 | Tutorial `raise`, `reply` | hello sent / hello open | A | ⚠ `reply` counts as **done when Meet is sent** (`story.js:186`): the tutorial "passes" a player who never answered |
| 5 | **"Meet me at Tempura Daikichi…"** + place card | reply to hello **or 30 s or 40 m walked without one** (`story.js:264`; the 40 m counts from game start, not from the hello, so it often fires after about 30 m) | R/T/L | ⚠ **talks past** the unanswered "Landed??". Hello's chips **stay on screen** under Meet and the latte ask (`apps.js:116` only replaces `pending` when new chips arrive; `clearReplies()` at `apps.js:135` is never called). Answering "Just landed!" a minute later gets silence |
| 6 | **Iced latte ask** (+ café card), errand → `asked`, café suggested, quest | **chained right after Meet**, 1.4 s later (`story.js:169` → `_sendCoffee`) | none (chained) | ⚠ no turn: a demand with no way to answer. ⚠ no location check: "it's on your way" is sent whatever the whereabouts (harmless today because Meet always lands by about 45 s, but any patience on hello makes "already past CITY" possible) |
| 7 | Tutorial `pick` (Maps / Lodestone list, Aya's pick = the café) | coffee sent and Aya idle | R | OK |
| 8 | Tutorial `gate` (late) | near the Nankai gate line / aimed / blocked | L/A | OK |
| 9 | Tutorial `order` (late) | errand asked + within 13 m of the café | L | OK |
| 10 | **"Where are you??"** + chips *I'm lost 😭 / On my way!* | Meet sent, Aya idle 10 s, and: t ≥ 95 s + a lost reason + < 15 m of progress in 30 s; **or t ≥ 150 s and not moving; or t ≥ 175 s regardless** (`story.js:276-297`) | L/T | ⚠ lostness is measured **toward Daikichi only** (`demo.js:202-213`; `WRONG_LEVELS` includes 1F, `demo.js:32`), so a player walking to or standing at the café counter on CITY 1F reads as `stalled`/`away`/`floor`. Only `floor` is exempted (`story.js:293`); the 150 s `time` fallback fires **at the café counter** ("The line is moving…" while you buy her latte). ⚠ fires 2 s after "omg you're an angel" if you just ordered |
| 11 | "Ask your phone! 😅" | reply *On my way!* to Where | R | OK |
| 12 | **Lodestone offer** ("you're lost aren't you 😂" + link) | reply *I'm lost* → now; *On my way!* + lost → now; engaged + lost after 100 s; **fallback t ≥ 195 s regardless** (`story.js:271`) | R/L/T | ⚠ the fallback ignores the conversation: an **unanswered Where keeps its chips under the offer**, because `offerLodestone` (`phone.js:157`) passes `replies: undefined` and `aya.act` never closes `aya.open`. Tapping *I'm lost* afterwards → `_offer('lost')` no-ops: **silence**. ⚠ It says "you're lost aren't you 😂" to someone making good progress (why = `time`). ⚠ There is **no early way to say you're lost**: the only *I'm lost* chip is on Where (`script.js:170`), which can't arrive before 95 s |
| 13 | Tutorial `install` (late) | stage = offer | A | OK |
| 14 | "see? 😌 6F, I'm 3rd in line" / "…which floor my latte is on" | Lodestone ready + 3 s (`demo.js:246`) | A | OK, but it is a statement that doesn't close an open Where (chips linger) |
| 15 | "ooh, {name} first? 😂" / "straight to the tempura? respect…" | a pick other than Aya's (`story.js:79-91`) | A | OK |
| 16 | "omg you're an angel 😭☕ ok NOW come" (+ Daikichi card) → leg 2 `pick2` | `demo:order` at a café (`story.js:93-102`) | A | OK (leaves stale chips if Where was open) |
| 17 | "no latte? 🥲 fine. FINE." → leg 2 | nav distance to Daikichi < café's − 40 m (`story.js:145-159`) | L | Good model: whereabouts-driven |
| 18 | "take the canyon way up 🌿…" | reaching the Parks bridge (`demo.js:133-136`) | L | ⚠ queued even under an open question (chips then sit under it) |
| 19 | Queue banter (170 m, 45 m on 6F) | offered + nav distance (`demo.js:194-195`) | L | same ⚠ |
| 20 | Arrival cut-scene → end card | within 7.5 m of the door, by foot (`demo.js:139-144`) | L | OK |

**Never-replier timeline today:**

- 12.6 s: Landed??
- 42.6 s: Meet. The hello chips stay up.
- 45 s: Latte ask. The hello chips are still up (*Just landed!* now sits under the latte ask).
- 95 s (standing still = `stalled`): Where. The chips switch to *I'm lost / On my way!*.
- 195 s: offer, with the Where chips **still** under the Lodestone link.

Zack's screenshot is this state between 95 and 195 s, scrolled to the latte ask, so the Where chips read as a reply to the
latte. Even without that, Hello → Meet → Latte had already talked past him.

---

## 3. Root causes (5)

1. **No question lifecycle** (`aya.js:85-116`, `apps.js:116,135`). A question opens when sent and closes only when
   answered or superseded by another question. Statements, the offer (`aya.act` → `phone.offerLodestone`) and the
   game's own texts (`game.message`) never close it, and the phone's chips are never withdrawn. This one cause produces
   every "talks past" symptom (rows 5, 6, 12, 14, 16, 18, 19).
2. **Beats chained by time, not by turns.** Meet has a 30 s / 40 m timeout with no nudge (`story.js:264`). The latte ask
   is chained onto Meet (`story.js:169`). The offer has a hard 195 s fallback (`story.js:271`). None of these asks
   whether the player is mid-answer, or whether a natural friend's follow-up ("hello?? 👀") should come first.
3. **Lostness has the wrong goal during the errand** (`demo.js:32,181-222`). Progress, `away`, `far` and `floor` are all
   measured toward Daikichi, while the story has sent the player to CITY 1F. Patches like the `floor` exemption
   (`story.js:293`) treat symptoms; the `stalled` and `time` reasons still fire at the café.
4. **No early way to say you're lost.** *I'm lost* exists only on Where (≥ 95 s). A player who is lost at 40 s can't say
   so, and the game can't respond to it (Zack: "responses").
5. **The tutorial `reply` step can't fail** (`story.js:186`). It is marked done when Meet goes out, so the one lesson that
   makes replies matter is skipped for exactly the players who needed it, and nothing teaches replies again later.

(Not a phone bug: the probe shows Messages scrolled to the newest bubble every time (`scrollTop == max`). Zack's
screenshot was scrolled up by hand or cropped; the "Where are you??" bubble sat below the latte ask.)

---

## 4. Proposed design

### 4.1 The conversation contract (`aya.js`, ~45 lines)

A question is `aya.say(msg with replies, opts)` with these new optional fields:

| opt | meaning |
|---|---|
| `patience: [nudgeAt, giveUpAt]` | seconds since the question was sent. At `nudgeAt` (if `nudge` is set) Aya double-texts the nudge. **The nudge keeps the question open** and its chips stay. At `giveUpAt` the question closes (chips withdrawn) and `onTimeout()` runs |
| `nudge` | text, e.g. `'hello?? 👀'` |
| `onTimeout()` | the natural follow-up (e.g. she sends the plan anyway) |
| `valid()` | polled; when it turns false the question closes quietly (chips withdrawn, `onExpire`). For example, the latte question is invalid once the errand is no longer `asked` |

Rules:

1. **One topic at a time.** A *statement* (no replies) closes the open question (chips withdrawn, `onExpire`) unless it
   is that question's own nudge (`keepOpen`). A new question supersedes the old one, as today.
2. **Responses can interrupt; new topics wait.** Story beats that open a new topic (Meet, Latte, Where, the offer) are
   only *started* while no question is **fresh** (`aya.fresh()` means a question is open and younger than its `nudgeAt`).
   Replies to player actions (got the latte, Lodestone ready, a different pick) go out at once and close the open
   question, because the action answered it.
3. **Location banter defers.** The canyon text and queue lines are queued with `{ defer: 12 }`. They wait while a question
   is fresh and are dropped if still blocked after 12 s, since the moment has passed.
4. **The phone mirrors it.** Closing a question calls `ctx.phone.messages.clearReplies()`, which already exists (feature
   detected, so no phone edit is needed). Optional for the phone owner: a public `phone.clearReplies()` alias.
5. **The offer goes through the contract.** `story._offer` closes the open question before `demo.offer(why, text)`, and
   the offer text depends on *why* (§4.3).

New read-outs: `aya.fresh()`, `aya.replied` (the count of real answers), `aya.closeOpen(reason)`.

### 4.2 Lostness against the active target (`demo.js`, ~25 lines)

- `demo.setTarget('cafe' | 'dk')`. The story calls it when the errand becomes `asked` → `cafe`, and on
  done / skipped / declined / dropped → `dk`.
- A second nav field for the café door (`ctx.nav.fieldToPoint('demo:cafe', …)`, the same API as Daikichi's, built once).
  A target struct `{ field, rem, best, init, hist }` is kept for the active target. Switching resets `hist`, so `stalled`
  needs 25 s of fresh data and there is no false positive at the switch.
- `_isLost()` / `progressOver()` read the **active** target. Wrong floors are per target: Daikichi is `B2, B1, 1F` (today);
  the café is `B2, B1`.
- `_lost` (Daikichi) stays exactly as it is for arrival, queue banter and the end card's *On track* row. **No end-card
  change.**
- New `demo.onTask()`: within 15 m of the active target's door, or ≥ 15 m of progress toward it in the last 30 s.

### 4.3 The beat graph

```
           look/move ─► HELLO? ──reply──────────────────────► MEET? ──omw──► LATTE? ─yes/silence─► errand(asked)
                         │  20 s / 30 m: "hello?? 👀"           │  └─lost──► "lol it's Namba 😂 tap my link" ─┐   │
                         │  +12 s: "ok just come find me 😂"     │                                     engaged=early │
                         └──────────────────────────────────────┘ 18 s / 25 m silent ─► LATTE? (if not past café)  │
                                                                                                 │no ─► "🥲 fine" ─► leg 2
                                                                                                                   │
  WHERE? (≥ 95 s, no fresh question, really lost vs ACTIVE target, not on task, not within 20 s of an order)  ◄────┘
     ├─ lost ─────────────────────────► OFFER('lost')
     ├─ omw + lost ──► "Ask your phone!" ► OFFER('checkin');  omw + fine ► engaged
     └─ 25 s: "hello?? 👀" ─► 45 s silent ─► OFFER('silent')
  OFFER also ◄─ engaged + lost after 100 s · early-lost + not progressing after 100 s
             ◄─ reaching Parks before any offer (t ≥ 100 s, Daikichi rem < 45% of start) ─► OFFER('ahead')
             ◄─ fallback 195 s (up to +15 s grace if a question is fresh or you are at the café counter; hard cap 210 s)
```

| Beat | Conversation | Whereabouts | Time (patience / fallback) | Text |
|---|---|---|---|---|
| **HELLO** (question) | — | `move` done (≥ 8 m) | or t ≥ hold + 8 s. Nudge at 20 s **or** 30 m walked since; give up 12 s after the nudge | as today. Nudge: *"hello?? 👀 did you land?"* |
| hello ack (optional delight) | reply *Just landed!* / *HUGE* | — | at once | *"yay!! 🎉"* / *"it's a whole city down there 😂"*, then Meet 1 s later |
| **MEET** (now a question) | hello answered or given up | — | give up 18 s **or** 25 m walked since → LATTE gate | as today + card. Chips: **On my way! 🏃** / **Which way?? 😵** (`lost: true`). On give-up after a hello timeout the text opens with *"ok I'll assume you landed 😂"* |
| meet → lost | *Which way??* | — | — | *"lol it's Namba, everyone's lost 😂 tap my link, Maps will get you close"*; `engaged = 'early'` |
| **LATTE** (question) | Meet answered or given up, **no fresh question** | **not past the café** (Daikichi rem ≥ café's Daikichi distance − 10 m); else the errand is **dropped** silently and the pick step uses Meet's card | 1.2 s after *On my way!*, or when the Meet gate opens | today's text (*"oh!! can you bring me…"*). Chips: **Sure! ☕** / **Not today 🙈**. `asked` on send (suggestion + quest at once). Give up at 25 s = silence means yes (chips withdrawn, errand stays). `valid = state === 'asked'` |
| latte → no | *Not today* | — | — | *"🥲 ok ok. just come then"*; errand `declined`, quest hidden, `_leg2Start()` |
| errand done / skipped | as today (A / L) | — | — | as today; `setTarget('dk')` |
| **WHERE** (question) | no fresh question | v6 rules, **vs the active target**, and not `onTask()`, and not within 20 s of an order | ≥ 95 s; the 150 s fallback only if not on task; 175 s latest. Nudge 25 s, give up 45 s → OFFER('silent') | as today. While the errand is asked: *"how's my latte coming? 👀 the line is moving"* with chips *I'm lost 😭* / *Almost there!* (same ids) |
| **OFFER** | as in the graph | `ahead` = in Parks before any offer | floor 100 s (`offerMin`), fallback 195 s, +15 s grace, cap 210 s | `lost`/`checkin`/`early`: today's *"you're lost aren't you 😂…"*. `silent`: *"hellooo?? 👀 ok just install this, it actually works indoors"*. `ahead` / `time` while on task: *"ok Parks is a maze from here 😅 get Lodestone, it actually works indoors"* |
| ready / canyon / queue / arrival | ready text closes the open question; canyon and queue lines use `defer: 12` | as today | as today | as today |

**Tutorial changes:**

- `reply`: available while **any** question is open; done on the first **real** answer (`aya.replied > 0`) or once the
  latte has been asked (it has been taught three times by then). It no longer passes silently when Meet is sent.
- `pick`: available as today, **or** once Meet is closed when the errand was dropped or declined (so nobody is left
  without a pick step). It also waits while the latte question is fresh, so the player never sees chips 1/2 and an "Open
  Aya's link" hint at the same moment (one glance, one decision). Answering *Sure!* (or 25 s of silence) hands over to
  the pick hint.
- Everything else is unchanged: the gate, order, install and pick2 steps are late, and the main order stays strict.
  There is no deadlock because every main step is retired after three nudges (`tutorial.js:459`). The `reply` hint
  re-aims at whichever question is open.

### 4.4 Player-type timelines (expected)

| Player | Hello | Meet | Latte | Where | Offer | Notes |
|---|---|---|---|---|---|---|
| Typical (replies within a few s) | 8 s | ~15 s | ~20 s | 95–150 s if stalled | ~100–175 s (lost reply) or 195 s | same pacing as v8 |
| Instant replier | 8 s | ~10 s | ~13 s | as above | as above | nothing waits on timers |
| Never replies | 12.6 s → nudge ~33 s → plan ~45 s | ~45 s (opens *"ok I'll assume…"*) | ~63 s or 25 m later | 95 s (stalled) / 150–175 s | 140 s (Where silent 45 s) to 195–210 s | no stale chips anywhere; a nudge before each give-up |
| Early "Which way??" | 8 s | ~15 s → lost | ~17 s | — | at 100 s if not progressing, else the normal flow | earns help sooner, as Zack asked |
| Wander (`&wander`) | | | | 95 s (`away`/`stalled` vs the café) | lost reply | |
| Fast runner (JOG) | | | asked only if not past CITY | none if never lost (not until 175 s, and never while on task) | `ahead` once in Parks at ≥ 100 s, else 195 s | today's arrival is ~500 s on foot, so the offer always lands first |
| Bot (`walk.mjs`) | answers *yes* | answers *On my way!* (new: prefers `omw` except on Where) | answers *Sure!* | lost | lost | must still complete |

---

## 5. Implementation plan (Phase 2)

| File | Change | Size |
|---|---|---|
| `js/game/aya.js` | `patience` / `nudge` / `onTimeout` / `valid` / `defer` options; `fresh()`, `replied`, `closeOpen()`; statements close the open question; close → `phone.messages.clearReplies()` (feature detected) | +45 |
| `js/game/story.js` | HELLO/MEET/LATTE gates (§4.3), the errand `dropped`/`declined` states + `setTarget`, the Where gate (`!aya.fresh()`, `onTask`, order cooldown, errand text), the early-lost and `ahead` offer paths, the offer closes the question and passes `text`, tutorial `reply`/`pick` tweaks | +70 / −20 |
| `js/game/script.js` | about 9 lines: `helloNudge`, `helloAck`, `meetAnyway`, meet chips, `meetLost`, latte chips + `coffeeNo`, `whereCoffee`, `offerSilent`, `offerAhead` | +15 |
| `js/game/demo.js` | the café field + active-target struct, `setTarget`, target-aware `_isLost`/`progressOver`, `onTask()`, `offer(why, text)`, canyon/queue texts with `defer` | +25 |
| `tools/walk.mjs` | `REPLY=normal\|none\|instant` (+ answer `omw` except on Where) | +8 |
| `js/analytics.js` (optional) | `namba_reply {msg, reply, dt}` from `aya:answered`. Existing events unchanged; `demo:offer.why` gains the values `early`/`silent`/`ahead` | +1 |

No phone file edits are needed. The analytics contract keeps every existing `namba_*` event (`story:where`,
`demo:offer`, `tutorial:*`, `nav:destination`, `demo:order` with `errand`, `phone:upgrade`, `demo:arrive`, `demo:end`).

## 6. Test plan

Pass criteria for every run:

- in the Messages thread, **chips only ever sit under the question they belong to** (checked in screenshots at each beat
  plus a probe that asserts `phone.pendingReply.msgId === aya.open?.msg.id` every second);
- the offer lands ≤ 210 s;
- arrival and end card;
- `ctx.errors []`, zero console errors;
- the `namba_*` sequence is intact (`Q='…&track'` on one run).

| Run | Command | Expect |
|---|---|---|
| Normal | `node tools/walk.mjs` | Hello → Meet (omw) → Latte (sure) → café → Where/lost → offer ≤ 195 s → arrival; no Where at the café counter |
| Wander | `Q='?quality=low&noaudio&wander' node tools/walk.mjs` | Where by about 95–120 s with why `away`/`stalled` vs the café; on-track row as in v7.3 |
| Never replies | `REPLY=none node tools/walk.mjs` (+ the scratch `silent.mjs` standing-still probe) | a nudge before every give-up; offer `silent` 140–210 s; zero stale chips; the tutorial `reply` step retires rather than lying |
| Instant | `REPLY=instant node tools/walk.mjs` | no beat waits on a timer; Latte ≤ 15 s |
| Fast runner | `JOG=1 node tools/walk.mjs` | the latte is asked or dropped correctly (never "on your way" once past CITY); offer `ahead` in Parks or by 195 s; Lodestone before arrival |
| Node unit (fast) | scratch harness: an `Aya` with a fake phone/events | open/nudge/give-up/valid/close-on-statement/defer, in ms |

## 7. Risks

1. **Pacing drift.** Patience adds up to about 45 s before Meet for never-repliers, and the latte comes later, so the café
   may be "behind" them more often and the errand gets dropped more. Mitigation: the walking accelerators (30 m / 25 m)
   and the "past the café" guard. Measure the drop rate in the JOG and never-reply runs.
2. **The bot path changes.** `walk.mjs` would now answer Meet with *Which way??* (it prefers `lost`), so it needs the
   reply-mode change in the same commit, or every critic run tests the early-lost branch.
3. **More questions = more phone time.** Meet and Latte now ask. Each is one glance and one key (1/2), and silence is
   always a valid answer. Watch tutorial nudge counts in PostHog (`namba_tutorial_step.nudges`).
4. **The café field cost.** One more `fieldToPoint` (a Dijkstra over the nav graph) at the errand start. It is a one-off,
   but it should be built lazily on the first `setTarget('cafe')`, not at load.
5. **Analytics continuity.** `namba_lost_prompt` may fire less often because Where is now suppressed while on task, and
   the offer `why` distribution shifts. Old funnels stay valid, but compare like for like.

## 8. Decisions for Zack (one question)

- **Should the latte be refusable?** *Not today 🙈* gives real agency and makes replies matter, but some players will skip
  the detour he asked for in v4. The alternative is two yes-flavoured chips (*Sure! ☕* / *Only for you 😂*).
  **Recommendation:** refusable, because the game respects the answer, which is the point of this round.

## 9. Probe evidence

`notes/v9-shots/progression/silent-probe.mjs.txt` (copy of the scratch script): the real build, `?quality=low&noaudio`,
title clicked, the player stands still on the platform, never answers, and systems are stepped at 20 Hz.

Event timeline (demo seconds):

```
  14.0  phone:message  hello [chips]
  45.1  phone:message  meet                 ← hello unanswered; hello chips stay pending
  45.1  tutorial:step  reply done           ← no reply was ever given
  48.6  phone:message  coffee               ← chained 3.5 s after meet; pending chips = hello's
  95.2  story:where    why=stalled
  97.5  phone:message  where [chips]        ← replaces the hello chips
 195.2  story:engaged  why=time
 197.4  demo:offer     why=time  "you're lost aren't you 😂"
 216/226  aya.open = where, phone.pendingReply = where:"I'm lost 😭|On my way!"   ← stale chips under the offer
```

State samples: `open:"hello", chips:"hello:Just landed! 🙌|…"` at 52, 60, 64, 74, 84 and 94 s, while the thread's last
text was the latte ask. The `_isLost()` reason is `stalled` from 32 s onward.

Screenshots: `notes/v9-shots/progression/silent-110.png` (Where is the newest bubble, while the tutorial `pick` hint
"Open Aya's link — Enter" shows at the same time: two decisions in one glance) and `silent-205.png` (the offer under the
unanswered Where).

Caveat: the headless screenshots do not draw the chip tray even while `phone.pendingReply` is set. It looks like the
`msChipsIn` animation in SwiftShader captures, since Zack's real-GPU screenshot shows the chips. Phase 2 asserts on
`pendingReply` and on DOM `.ms-chip` presence, not on pixels.
