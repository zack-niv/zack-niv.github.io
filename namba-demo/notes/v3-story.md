# v3 — Story (items 1, 5, 6, 8) · owner: js/game/*, js/ui/hud.js, js/ui/title.js, css/game.css, index.html

Status: IN PROGRESS (plan first, so Phone can build the reply UI against it).

## What I need from Phone (contract in V3.md, restated with details)

```js
ctx.phone.message({ id, from: 'Aya', text, replies?: [{ id, text }], link?: 'lodestone', expectReply?: true })
// emits 'phone:reply' { msgId, replyId, text } once the player picks a chip (and appends the 'me' bubble)
```
* `id` is a **string** (e.g. `'hello'`, `'meet'`, `'checkin'`). Please keep the chips of a message visible until the
  player answers **or until a newer Aya message with its own replies arrives** (then the old chips can go — I never
  need two open questions at once). An answered message's chips disappear.
* A message with `replies` should feel like a question in the glance strip too (e.g. "Aya · reply ▸" or the chip count),
  so a player with the phone down knows an answer is expected. The keys you choose (1/2/3?) I will show in my hint:
  **please write the final reply keys + the app-switch keys in notes/v3-phone.md** (or expose `ctx.phone.keys =
  { reply: ['1','2','3'], apps: 'Tab' }` and I will read that).
* Typing indicator: **I emit `'phone:typing' { from: 'Aya', on: true|false }`** on the event bus ~0.8–1.8 s before each
  of her texts (and `on:false` right before the `message()` call). Phone renders "Aya is typing…" (thread + glance).
* `ctx.phone.offerLodestone(opts?)` — I call it when the player has engaged (see below). If you accept an optional
  `{ text }`, I pass Aya's line; otherwise your default text is fine. **Please remove the 150 s self-trigger.**
* Events I validate tutorial steps with: `phone:pose` {pose:'up'} (exists), `phone:app` {app}, `phone:reply`,
  `phone:open`. If `phone:app` doesn't fire on the initial app, I also read `ctx.phone.app` while the phone is up.
* Optional `nav:track { state }` — Aya reacts once to `'off'` (or `'drifting'` held > 5 s): "wrong way? 😅".

Until your API lands I feature-detect: no `ctx.phone.message` → I fall back to `phone:message` (no chips) and a
reply step validates as "the player raised the phone and looked at Messages for ~1.5 s".

## The opening = the tutorial (each step waits for the player; one small hint; nudge after ~12 s)

| # | Step | Hint (small, in-world, not modal) | Validated by | Nudge |
|---|------|------|------|------|
| – | intro hold 4.6 s (platform, chapter card, PA) | – | – | – |
| 1 | Aya: *"Landed?? Welcome to Osaka!! 🛬"* (typing first) · chips **"Just landed! 🙌" / "Yes!! This station is HUGE 😵"** | by the phone: *Your phone buzzed — **Q** to raise it* | `phone:pose` up | 12 s: buzz + "hellooo? 👀"; 25 s: "…or hold right-click" |
| 2 | (same message) | left of the raised phone: *Answer Aya — tap a reply (1 / 2)* | `phone:reply` msgId `hello` | pulse |
| 3 | Aya reacts to the answer, then *"Meet me at Tempura Daikichi — Namba Parks, 6F! I'm already in the queue 🍤"* · chips **"On my way! 🏃" / "How do I get there? 🤔"** | *Answer Aya* | `phone:reply` msgId `meet` | pulse |
| 4 | Aya: "Maps will get you there… probably 😅" | *Open **Maps*** (key from phone notes) | `phone:app` maps | pulse |
| 5 | – | *Lower the phone (Q) · **WASD** to walk, mouse to look* (+ "hold Shift to hurry" once moving) | 12 m walked | pulse |
| 6 | – | *Follow the signs to the 中央改札 Central Gate* | tapped out at the Nankai gate / left the platform level | "look up — the overhead signs" |
| side | first E prompt on screen | *Press **E*** | `interact` event | – |

Steps validate out of order when the player simply does the thing (walks first, etc.); the hint always shows the first
undone step; a hint that has been nudged 3 times goes quiet. Nothing ever freezes the player.

## After the tutorial: Aya reacts to where you are (pre-Lodestone)

* **through the Nankai gates** → "out of the gates? 🙌 Parks is south, through Namba CITY. easy 😌" · chips
  "👍" / "Which way is south?? 😅" (the second counts as *asking for help*)
* **wrong floor (B1/1F/B2) for 40 s** → "wait are you underground?? 😅 Parks is UP" · chips "I'm lost 😭" / "Just exploring 😎"
* **stalled** (no progress toward Daikichi for ~30 s) → "how's it going? 👀" · chips "Honestly? Lost 😵‍💫" / "Getting there!"
* **Namba CITY 2F** → "Namba CITY! ok you're close-ish. Parks is at the very end 🌿"
* **coffee ordered** → "did you just stop for COFFEE 😂 I'm starving"

**The Lodestone offer needs engagement:** a "lost"/"help" chip, or answering a check-in while the director's
`_isLost()` is true. Then Aya: "lol I KNEW it 😂" → `offerLodestone()`. "Getting there!" while lost → a second, teasing
check-in 35 s later. **Fallback** (nobody stuck forever): at ~165 s with no engagement she sends it anyway ("ok I'm just
sending you this 😂 no arguments"). Never before 45 s (the ordinary map has to be felt).

## After Lodestone

ready → "see? 😌 6F, I'm 3rd in line" (chips "Ok this is magic ✨" / "You're a genius 🙏"); `nav:track` off-route →
"wrong way? 😅 follow the arrow" (**once**); Parks bridge → "take the canyon side — trust me 🌿"; ~170 m → "I'm 2nd in
line!! 🍤"; 45 m → "You can see the noren from there, right?? 👋"; stalled 40 s → "everything ok? 🙂" (once). Arrival
and end card unchanged.

## Captions (item 8) — `hud.caption(textOrObj, { channel })`

* `channel: 'ambient'` — PA, distant voices, shop callouts: small, top-left edge, low contrast, auto-fades, max 2.
* `channel: 'speech'` — someone addressing you (すみません, staff, Aya at arrival): bottom centre, prominent.
* `channel: 'action'` — E interactions, ordering, gate results, the player's own thoughts: bottom centre, prominent.
* Default when absent: `kind` announce/platform/train, `speaker:'PA'` or `distant:true` → ambient; `kind`
  thought/machine → action; anything with a speaker → speech. The `'caption'` event payload may carry `channel` too.

## Restart (item 6)

Pause menu → **Restart** → "Are you sure? Your progress will be lost." [Cancel] [Restart] → reload to the title (a fresh
page; the title click is the user gesture audio + pointer lock need). If the tutorial was completed this browser session
the hints stay hidden on the next run (they only appear as a nudge when a step is stalled for ~15 s); Aya's conversation
always plays — it *is* the story. `?tutorial` forces hints, `?notutorial` turns them off.
