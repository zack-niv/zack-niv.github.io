# v3 — Story (items 1, 5, 6, 8) · owner: js/game/*, js/ui/hud.js, js/ui/title.js, css/game.css, index.html

**Scope (tightened by the lead):** keep the v2 quest flow, texts and beats. (a) Replace the 4 walkthrough cards with
a quick in-game tutorial; (b) gate the existing beats on player interaction + location instead of timers. Plus
item 6 (restart + confirm) and item 8 (caption channels). Small diffs, no new systems beyond what that needs.

## Files

| File | What |
|---|---|
| `js/game/walkthrough.js` | **deleted** (v2 card deck) |
| `js/game/tutorial.js` | new, ~150 lines: the step machine + the one-line hint (`.g-tip`) |
| `js/game/aya.js` | new, ~120 lines: Aya's outbox (typing indicator, one text at a time, reply routing, no-chips fallback) |
| `js/game/story.js` | new, ~150 lines: the 6 tutorial steps + the gating of Aya's v2 beats + the offer decision |
| `js/game/demo.js` | the old INTRO/NUDGES timers and the time/lost offer trigger removed → `this.story`; adds `progressOver(sec)`; canyon / queue / ready / arrival texts unchanged |
| `js/game/script.js` | v2 texts kept verbatim (in `AYA` / `UPGRADE`); `TUTORIAL` hint copy; `offerAt` 135 → 165 (fallback only now) |
| `js/game/game.js` | pause menu **Restart** + confirm; `game.message()` routes Aya through the outbox; `game.story` |
| `js/ui/hud.js`, `css/game.css` | caption channels; tip + restart styles; v2 walkthrough CSS removed |

## (a) The tutorial — 6 steps, ~60–90 s, validated by the real action

| # | Step | Hint (one line, where the action is) | Validated by |
|---|---|---|---|
| 1 | look | *Move the mouse to look around* (centre) | ≥ 1 rad of player yaw (intro camera excluded) |
| 2 | move | *WASD to walk · hold Shift to hurry* | 8 m walked |
| 3 | phone up | *Your phone buzzed — Q to raise it* (above the lowered phone) | `phone:pose` up / `phone:open` |
| 4 | answer Aya | *Answer Aya — tap a reply or press 1 2* (beside the raised phone; "Q to answer" when it's down) | `phone:reply` on `hello` |
| 5 | open Maps | *Open Maps — Tab or tap it in the dock* | `phone:app` maps / `phone.app==='maps'` while up |
| 6 | E | *E interacts — machines, doors, café counters* (→ *E — try it* under the prompt when one is on screen) | `interact` event |

* Any step validates as soon as the player does it (any order); the hint belongs to the first pending step, strictly in
  order (nothing shows while that step isn't available yet, e.g. while Aya types). Nudge after 12 / 26 / 42 s of
  inaction (the hint pulses; on "phone up" the 2nd nudge adds "or hold right-click"); after the 3rd it goes quiet.
* Never freezes or blocks anything. Events: `tutorial:start`, `tutorial:step {id,done,t,nudges}`, `tutorial:done`.
* A late step appears once Lodestone is offered: *Aya sent a link — Q and tap Lodestone* (6 s grace, then hint).
* Completed (core steps 3–5 done, nothing else still being taught) → `sessionStorage['namba.tutorial.v3']='done'`.
  **Restart/Replay after that: the hints stay hidden unless a step stalls (they come back on the first nudge); the
  conversation plays as always.** `?tutorial` forces hints, `?notutorial` hides them.

## (b) Aya's v2 beats, gated on the player (texts unchanged)

1. *"Landed?? Welcome to Osaka! 🛬"* — arrives when the player has walked (step 2) or 8 s after the intro look,
   with chips **"Just landed! 🙌" / "Yes! This station is HUGE 😵"**.
2. *"Meet me at Tempura Daikichi. Namba Parks, 6F! …🍤"* — follows the **answer** (or 30 s / 40 m of ignoring it). Quest active.
3. *"Where are you?? The line is moving. …"* — v2's 58 s nudge, now sent when the director says the player is
   **lost** (wrong floor 7 s, walked away, long walk no closer, stalled 25 s) from 45 s on, or at 100 s; chips
   **"I'm lost 😭" / "On my way!"**.
4. **Lodestone offer** (v2 text, the phone's link card) follows engagement: "I'm lost 😭" → offer; "On my way!" →
   *"Ask your phone! That's what it's for 😅"* (v2's 2nd nudge) and, if the player is clearly lost, the offer right
   after; otherwise the offer waits until they are. **Fallback: 165 s** whatever happens. Never before 45 s.
5. After: *"see? 😌 6F, I'm 3rd in line"*, the canyon line at the bridge, the queue lines, the arrival — unchanged.
   Every Aya text gets a typing beat first (`phone:typing`) and they never overlap.

Phone contract used (notes/v3-phone.md, FINAL): `ctx.phone.message({id,from,text,replies,link})`, `phone:reply`,
`phone:app`, `phone:typing`, `phone.reply(i)`, `phone.pendingReply`, `offerLodestone({text})`. Feature-detected: without
`message()` a question counts as answered with its first chip once the player has read it (phone up on Messages 1.5 s).

## Item 8 — caption channels: `hud.caption(textOrObj, { channel })`

* `ambient` (PA, distant voices, shop callouts): small, **top-left edge**, low contrast (~0.8 opacity, 12.5/11.5 px),
  fades on its own (≤ 9 s), max 2 (oldest retires).
* `speech` (someone addressing you: すみません, staff, the chef, Aya at arrival) and `action` (your own lines when
  ordering, gate results, your thoughts): bottom centre, prominent (action has a warm hairline).
* No channel → inferred: kind announce/platform/train, `speaker:'PA'`, or `distant` → ambient; kind
  thought/machine/action → action; else speech. `'caption'` event payloads may carry `channel`; `'announce'` and
  `crowd:callout` default to ambient. Audibility gating (`paAudible`) unchanged.

## Item 6 — Restart

Pause → **Restart 最初から** → *"Are you sure? Your progress will be lost."* [Cancel] [Restart]. Esc backs out of the
confirm. Restart = reload to the title with test/teleport flags stripped (`skip test spawn pos yaw pitch play offerat
tutorial`); the title click provides the user gesture audio + pointer lock need. Tutorial hints after a restart: see (a).

## Testing

* `scratchpad/story-probe.mjs` plays the opening like a player (mouse turn, walking, Q, 1, Tab, answering "I'm lost"),
  screenshots in `notes/v3-shots/story/`.
* The critic's full-route walk bot (`scratchpad/critic-demo/walk.mjs`) now answers Aya's questions (phone up on Messages,
  picks the "lost" chip when there is one, peeks at Maps, lowers the phone).

## Status / results

(filled in below after the verification run)
